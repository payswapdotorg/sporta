/**
 * Backpressure tests (W302) — THE acceptance core: bounded memory proven,
 * policies explicit, accounting exact, never a silent drop.
 *
 * - `block` (natural backpressure): a large burst into a capacity-c
 *   multi-stage pipeline with a slow consumer — the in-pipeline segment
 *   count holds at the bounded plateau (channels never exceed capacity,
 *   everything admitted is out / queued / in a stage worker), then
 *   everything flows in order;
 * - concurrent un-awaited submits: the W104 channel keeps its OWN buffer
 *   bounded while parked senders hold their own references (caller-owned);
 * - `reject` at the input: typed `ResourceLimitError` refusals, counted +
 *   ledgered + logged + metered, the stream continues;
 * - `reject` downstream: `rejectedDownstream` accounting;
 * - `drop-oldest`: channel-owned evictions reconciled into the pipeline's
 *   `dropped` stat — including the byte-budget eviction and the
 *   cross-boundary output identity (W301's
 *   `segmentsOut === received + output.dropped`).
 * - byte-budget queue limits: capacity high, bytes low → parking by bytes;
 *   a never-fitting segment → typed refusal under block/reject.
 */
import { describe, expect, test } from "bun:test";
import type { StageMessage } from "@sporta/contracts";
import { PROCESSING_METRIC_NAMES as METRICS } from "../src/types";
import {
  backgroundConsumer,
  capturedObservability,
  drainMicrotasks,
  drainOutput,
  identityStage,
  payloadOf,
  segment,
  slowIdentityStage,
  until,
  wiredPipeline,
  expectBalanced,
} from "./helpers";

const SESSION_ID = "sess-w302-bp";

describe("block policy — bounded memory end-to-end (the burst proof)", () => {
  test("a paced 120-segment burst into capacity-2 x 3 stages with a slow consumer holds the plateau", async () => {
    const TOTAL = 120;
    const CAPACITY = 2;
    const STAGES = 3;
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [slowIdentityStage("s0", 1), slowIdentityStage("s1", 1), slowIdentityStage("s2", 1)],
      queue: { capacity: CAPACITY, policy: "block" },
    });
    pipeline.start();

    // Paced producer: the loop only advances when submit() resolves, so the
    // producer is parked by the pipeline whenever every queue is full —
    // backpressure propagates upstream channel-by-channel.
    let submitted = 0;
    const producer = (async () => {
      while (submitted < TOTAL) {
        await pipeline.submit(segment(`k${submitted}`, submitted * 40, submitted));
        submitted += 1;
      }
    })();

    // Slow consumer: receive, then verify the bounded-memory invariant at
    // EVERY observation (this is the "segmentsIn holds at capacity" proof:
    // everything admitted is out, in a bounded queue, or in one stage worker).
    const channelCap = (STAGES + 1) * CAPACITY; // 4 queues x capacity 2
    const maxInPipeline = channelCap + STAGES; // + one in-flight per stage
    let maxObserved = 0;
    const invariantsHeld: boolean[] = [];
    const received: StageMessage[] = [];
    for (let i = 0; i < TOTAL; i += 1) {
      received.push(await output.receive());
      await drainMicrotasks(2); // the "slow" consumer
      const stats = pipeline.stats();
      const inPipeline = stats.admitted - stats.segmentsOut - stats.deadLettered;
      maxObserved = Math.max(maxObserved, inPipeline);
      invariantsHeld.push(
        inPipeline <= maxInPipeline && stats.queueDepths.every((depth) => depth <= CAPACITY),
      );
    }
    expect(invariantsHeld.every(Boolean)).toBe(true);
    expect(maxObserved).toBeLessThanOrEqual(maxInPipeline);
    // The plateau is REACHED (the bound is real, not vacuous).
    expect(maxObserved).toBeGreaterThan(CAPACITY);
    expect(maxObserved).toBeLessThan(TOTAL);

    await producer;
    const result = await pipeline.stop();
    expectBalanced(result, { segmentsIn: TOTAL, segmentsOut: TOTAL });
    // Everything arrived, in submission order, watermarks verbatim.
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual(
      Array.from({ length: TOTAL }, (_, i) => `k${i}`),
    );
    expect(received.map((m) => payloadOf(m).watermark.watermarkMs)).toEqual(
      Array.from({ length: TOTAL }, (_, i) => i * 40),
    );
  });

  test("200 concurrent un-awaited submits: the channel buffers stay bounded; parked senders hold their own references", async () => {
    const TOTAL = 200;
    const CAPACITY = 2;
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("s0"), identityStage("s1")],
      queue: { capacity: CAPACITY, policy: "block" },
    });
    pipeline.start();
    // Fire every submit without awaiting (NO consumer yet): they park in
    // the channel's sender-FIFO; each parked sender keeps its OWN message
    // (caller-owned reference) — the channel's buffer itself never exceeds
    // capacity.
    const pending = Array.from({ length: TOTAL }, (_, i) =>
      pipeline.submit(segment(`k${i}`, i * 10, i)),
    );
    expect(await until(() => pipeline.stats().segmentsIn === TOTAL)).toBe(true);
    // The fully-parked steady state: every queue at capacity (the output
    // has no consumer, so backpressure propagated to every boundary).
    expect(await until(() => pipeline.stats().queueDepths.every((d) => d === CAPACITY))).toBe(true);
    const parked = pipeline.stats().segmentsIn - pipeline.stats().admitted;
    expect(parked).toBeGreaterThan(0); // senders really are parked
    expect(parked).toBe(TOTAL - pipeline.stats().admitted);
    // The structural bound: every queue at capacity, nothing queued beyond.
    expect(pipeline.stats().queueDepths.every((d) => d <= CAPACITY)).toBe(true);

    // NOW the consumer starts: the parked chain releases, every parked
    // submitter resolves admitted, everything flows in order.
    const received: StageMessage[] = [];
    const consumer = backgroundConsumer(output, received);
    await Promise.all(pending);
    const result = await pipeline.stop();
    await consumer.done;
    expectBalanced(result, { segmentsIn: TOTAL, segmentsOut: TOTAL });
    expect(received).toHaveLength(TOTAL);
    for (const outcome of await Promise.all(pending)) {
      expect(outcome.disposition).toBe("admitted");
    }
  });
});

describe("reject policy — explicit typed refusal accounting", () => {
  test("full input queue refuses with ResourceLimitError details; counted, ledgered, logged, metered; stream continues", async () => {
    const obs = capturedObservability();
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [slowIdentityStage("s0", 2)],
      queues: [
        { capacity: 2, policy: "reject" },
        { capacity: 16, policy: "block" },
      ],
      observability: obs.options,
    });
    pipeline.start();
    const received: StageMessage[] = [];
    const consumer = backgroundConsumer(output, received);

    // The worker is 2 ticks slow, the input queue holds 2, reject policy:
    // submits that arrive while the queue is full are REFUSED with the W104
    // typed error — counted, ledgered, logged, metered, never silent.
    const outcomes = [];
    for (let i = 0; i < 6; i += 1) {
      outcomes.push(await pipeline.submit(segment(`k${i}`, i * 10, i)));
    }
    const result = await pipeline.stop();
    await consumer.done;
    const refused = outcomes.filter((o) => o.disposition === "rejected");
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.length).toBe(6 - received.length);
    expectBalanced(result, {
      segmentsIn: 6,
      segmentsOut: received.length,
      rejected: refused.length,
    });
    for (const outcome of refused) {
      if (outcome.disposition === "rejected") {
        expect(outcome.rejection.reason).toBe("input-queue-full");
        expect(outcome.rejection.failureClass).toBe("resource-limit");
        expect(outcome.rejection.details).toMatchObject({ policy: "reject", capacity: 2 });
      }
    }
    // Never silent: every refusal left a ledger record, a warn line, a metric.
    expect(pipeline.rejections()).toHaveLength(refused.length);
    for (const record of pipeline.rejections()) {
      expect(record).toMatchObject({
        bucket: "rejected",
        failureClass: "resource-limit",
        reason: "input-queue-full",
      });
    }
    expect(
      obs.metrics
        .snapshot()
        .counters.find(
          (c) => c.name === METRICS.rejectedTotal && c.labels.failure_class === "resource-limit",
        )?.value,
    ).toBe(refused.length);
    expect(
      obs.records().filter((r) => r.msg === "pipeline segment refused or abandoned").length,
    ).toBe(refused.length);
    // And the stream continued: the exact deterministic split — k0 is
    // handed directly to the parked worker (W104 receive-bypass), k1/k2
    // fill the queue, k3/k4 are REFUSED (reject refuses the INCOMING
    // segment), and k5 arrives after the worker freed a slot.
    expect(refused.length).toBe(2);
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual(["k0", "k1", "k2", "k5"]);
    expect(result.stats.rejectedBackpressure).toBe(2);
    expect(result.stats.rejectedDownstream).toBe(0);
  });

  test("typed refusals surface when the worker parks downstream and the input fills", async () => {
    const obs = capturedObservability();
    // 3 stages, all reject, capacity 1, slow consumer so queues fill.
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("s0"), identityStage("s1"), identityStage("s2")],
      queue: { capacity: 1, policy: "reject" },
      observability: obs.options,
    });
    pipeline.start();
    const received: StageMessage[] = [];
    const consumer = backgroundConsumer(output, received);
    // A slow consumer (started, but paced) keeps queues full so capacity-1
    // reject queues refuse in-flight submissions.
    const outcomes = [];
    for (let i = 0; i < 8; i += 1) {
      outcomes.push(await pipeline.submit(segment(`k${i}`, i * 10, i)));
      await drainMicrotasks(1);
    }
    const refused = outcomes.filter((o) => o.disposition === "rejected");
    // With capacity-1 reject queues and a paced consumer, some submits are
    // refused: each refusal carries the W104 typed details.
    expect(refused.length).toBeGreaterThan(0);
    for (const outcome of refused) {
      expect(outcome.disposition).toBe("rejected");
      if (outcome.disposition === "rejected") {
        expect(outcome.rejection.reason).toBe("input-queue-full");
        expect(outcome.rejection.failureClass).toBe("resource-limit");
        expect(outcome.rejection.details).toMatchObject({ policy: "reject", capacity: 1 });
      }
    }
    const result = await pipeline.stop();
    await consumer.done;
    expectBalanced(result, {
      segmentsIn: 8,
      segmentsOut: received.length,
      rejected: refused.length,
    });
    // Never silent: every refusal left a ledger record, a warn line, a metric.
    expect(pipeline.rejections()).toHaveLength(refused.length);
    for (const record of pipeline.rejections()) {
      expect(record).toMatchObject({
        bucket: "rejected",
        failureClass: "resource-limit",
        reason: "input-queue-full",
      });
    }
    expect(
      obs.metrics
        .snapshot()
        .counters.find(
          (c) => c.name === METRICS.rejectedTotal && c.labels.failure_class === "resource-limit",
        )?.value,
    ).toBe(refused.length);
    expect(
      obs.records().filter((r) => r.msg === "pipeline segment refused or abandoned").length,
    ).toBe(refused.length);
  });

  test("a segment that can never fit the byte budget is refused immediately under block", async () => {
    const { pipeline } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("s0")],
      queue: { capacity: 16, policy: "block", maxBytes: 50 },
    });
    pipeline.start();
    await pipeline.submit(segment("k0", 0, 0, 20));
    const outcome = await pipeline.submit(segment("huge", 0, 0, 80)); // > whole budget
    expect(outcome.disposition).toBe("rejected");
    if (outcome.disposition === "rejected") {
      expect(outcome.rejection.reason).toBe("input-queue-full");
      expect(outcome.rejection.details).toMatchObject({
        policy: "block",
        capacity: 16,
        maxBytes: 50,
      });
    }
    const result = await pipeline.stop();
    expectBalanced(result, { segmentsIn: 2, segmentsOut: 1, rejected: 1 });
    expect(result.stats.rejectedBackpressure).toBe(1);
  });

  test("reject on an intermediate queue refuses the stage's send: rejectedDownstream, stream continues", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("s0"), slowIdentityStage("s1", 3)],
      queues: [
        { capacity: 16, policy: "block" },
        { capacity: 1, policy: "reject" },
        { capacity: 16, policy: "block" },
      ],
    });
    pipeline.start();
    // s1 is slow while s0 is eager: s0's sends fill the capacity-1
    // intermediate queue; further sends are REFUSED under the reject
    // policy — the segment is counted `rejectedDownstream` (never silent),
    // and BOTH workers keep running (the stream continues).
    const received: StageMessage[] = [];
    const consumer = backgroundConsumer(output, received);
    const outcomes = [];
    for (let i = 0; i < 6; i += 1) {
      outcomes.push(await pipeline.submit(segment(`k${i}`, i * 10, i)));
    }
    const result = await pipeline.stop();
    await consumer.done;
    const downstreamRefused = 6 - received.length;
    expect(downstreamRefused).toBeGreaterThan(0);
    expectBalanced(result, {
      segmentsIn: 6,
      segmentsOut: received.length,
      rejected: downstreamRefused,
    });
    expect(result.stats.rejectedDownstream).toBe(downstreamRefused);
    expect(result.stats.rejectedBackpressure).toBe(0);
    expect(outcomes.every((o) => o.disposition === "admitted")).toBe(true);
    // Refused sends have their own ledger reason + stage attribution.
    expect(pipeline.rejections()).toHaveLength(downstreamRefused);
    for (const record of pipeline.rejections()) {
      expect(record).toMatchObject({
        bucket: "rejected",
        failureClass: "resource-limit",
        reason: "downstream-queue-full",
        stage: "s0",
      });
    }
    // The survivors flowed through BOTH stages (the stream continued).
    expect(result.stages[1]!.received).toBe(result.stages[1]!.emitted);
    expect(result.stages[1]!.emitted).toBe(received.length);
  });
});

describe("drop-oldest — channel-owned eviction accounting, reconciled", () => {
  test("input-queue evictions land in the pipeline `dropped` stat; the balance closes exactly", async () => {
    const obs = capturedObservability();
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [slowIdentityStage("s0", 3)],
      queues: [
        { capacity: 2, policy: "drop-oldest" },
        { capacity: 16, policy: "block" },
      ],
      observability: obs.options,
    });
    pipeline.start();
    // The worker is 3 ticks slow; the capacity-2 drop-oldest input queue
    // evicts the OLDEST queued segment on each submit while the worker is
    // busy (W104 semantics, channel-owned accounting).
    const received: StageMessage[] = [];
    const consumer = backgroundConsumer(output, received);
    for (let i = 0; i < 6; i += 1) {
      await pipeline.submit(segment(`k${i}`, i * 10, i));
    }
    const result = await pipeline.stop();
    await consumer.done;
    const evicted = 6 - received.length;
    expect(evicted).toBeGreaterThan(0);
    expectBalanced(result, { segmentsIn: 6, segmentsOut: received.length, dropped: evicted });
    // The dropped stat is the CHANNEL's own counter, reconciled (never invented).
    expect(result.stats.dropped).toBe(evicted);
    // Evicted segments never reached terminal disposition — their keys are
    // NOT registered, so re-submission would be fresh work (recovery).
    expect(result.stats.distinctProcessed).toBe(received.length);
    // The channel metered its own evictions through the shared registry.
    expect(
      obs.metrics
        .snapshot()
        .counters.find(
          (c) => c.name === "transport_channel_dropped_total" && c.labels.policy === "drop-oldest",
        )?.value,
    ).toBe(evicted);
    // The exact deterministic split: k0 is handed directly to the parked
    // worker (W104 receive-bypass — never queued, never evictable); k1/k2
    // fill the queue; k3/k4/k5 each EVICT the oldest queued segment
    // (k1, k2, k3) — the survivors are k0, k4, k5.
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual(["k0", "k4", "k5"]);
    expect(result.stats.dropped).toBe(3);
  });

  test("output-queue evictions are delivery losses: the cross-boundary identity holds (W301 pattern)", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("s0")],
      queues: [
        { capacity: 16, policy: "block" },
        { capacity: 2, policy: "drop-oldest" },
      ],
    });
    pipeline.start();
    for (let i = 0; i < 6; i += 1) {
      await pipeline.submit(segment(`k${i}`, i * 10, i));
    }
    const result = await pipeline.stop();
    // Every segment completed the pipeline (terminal `emitted`), but the
    // output queue evicted all but the newest two BEFORE the consumer ran.
    expect(result.stats.segmentsOut).toBe(6);
    expect(result.stats.dropped).toBe(0); // output evictions are NOT pipeline-terminal drops
    expectBalanced(result, { segmentsIn: 6, segmentsOut: 6 });
    const received = await drainOutput(output);
    // The W301 cross-boundary identity, test-pinned:
    expect(received.length + output.dropped + output.size).toBe(result.stats.segmentsOut);
    expect(output.dropped).toBe(4);
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual(["k4", "k5"]);
    // The evicted segments still count as terminally emitted (registry).
    expect(result.stats.distinctProcessed).toBe(6);
  });

  test("byte-budget evictions under drop-oldest reconcile too", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [slowIdentityStage("s0", 3)],
      queues: [
        { capacity: 8, policy: "drop-oldest", maxBytes: 24 },
        { capacity: 8, policy: "block" },
      ],
    });
    pipeline.start();
    // 24-byte budget, 10-byte segments, a slow worker: three bytes fit two
    // segments; each further submit evicts the oldest (byte-budget
    // eviction, channel-owned accounting).
    const received: StageMessage[] = [];
    const consumer = backgroundConsumer(output, received);
    for (let i = 0; i < 6; i += 1) {
      await pipeline.submit(segment(`k${i}`, i * 10, i, 10));
    }
    const result = await pipeline.stop();
    await consumer.done;
    const evicted = 6 - received.length;
    expect(evicted).toBeGreaterThan(0);
    expectBalanced(result, { segmentsIn: 6, segmentsOut: received.length, dropped: evicted });
  });
});

describe("byte-budget queue limits (count AND bytes)", () => {
  test("capacity high, byte budget low: producers park by BYTES (block), then flow", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("s0")],
      queues: [
        { capacity: 100, policy: "block", maxBytes: 20 },
        { capacity: 100, policy: "block", maxBytes: 20 },
      ],
    });
    pipeline.start();
    const received: StageMessage[] = [];
    const consumer = backgroundConsumer(output, received);
    // Two 10-byte segments fill the 20-byte input budget; the third submit
    // parks (block) until the worker frees bytes.
    const submits = [];
    for (let i = 0; i < 6; i += 1) {
      submits.push(pipeline.submit(segment(`k${i}`, i * 10, i, 10)));
    }
    expect(await until(() => pipeline.stats().admitted >= 2)).toBe(true);
    await Promise.all(submits);
    const result = await pipeline.stop();
    await consumer.done;
    expectBalanced(result, { segmentsIn: 6, segmentsOut: 6 });
    expect(received).toHaveLength(6);
  });
});
