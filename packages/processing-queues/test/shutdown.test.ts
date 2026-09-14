/**
 * Idempotent-cancellation tests (W302) — deliverable 3 of the brief:
 * "stop() semantics — in-flight stage work completes or is accounted
 * ABANDONED (W301 precedent). Every segment ends in EXACTLY ONE terminal
 * bucket... stop() is idempotent."
 *
 * - `drain` mode: in-flight work COMPLETES, internal queues are PROVEN empty
 *   at settle, and a submit parked on the input queue at close-time is
 *   accounted `abandoned` (the W301 parked-send precedent) —
 *   `segmentsIn === segmentsOut + abandoned` exactly;
 * - `cancel` mode: every queue closes immediately; the in-flight transform
 *   still completes (a promise cannot be killed) but its result cannot be
 *   delivered — parked admission sends, closed-queue sends, and every
 *   segment still queued internally are each accounted ABANDONED with one
 *   ledger record — never a silent loss;
 * - the admitted-segment budget terminates the pipeline fail-loud
 *   (`resource-limit`) with exact `rejectedLimit` accounting;
 * - `stop()` is idempotent: a second stop returns the SAME settled result.
 */
import { describe, expect, test } from "bun:test";
import type { StageMessage } from "@sporta/contracts";
import { InvalidPipelineStateError } from "../src/errors";
import type { PipelineSegment } from "../src/segment";
import { PROCESSING_METRIC_NAMES as METRICS } from "../src/types";
import type { StageOutcome } from "../src/types";
import {
  backgroundConsumer,
  capturedObservability,
  drainOutput,
  identityStage,
  payloadOf,
  segment,
  slowIdentityStage,
  until,
  wiredPipeline,
  expectBalanced,
} from "./helpers";

const SESSION_ID = "sess-w302-shutdown";

describe("stop() drain mode — in-flight work completes", () => {
  test("a stop right after the submits completes every segment: no abandonment, internal queues PROVEN empty", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [slowIdentityStage("s0", 2), slowIdentityStage("s1", 2), slowIdentityStage("s2", 2)],
      queue: { capacity: 2, policy: "block" },
    });
    pipeline.start();
    const received: StageMessage[] = [];
    const consumer = backgroundConsumer(output, received);
    for (let i = 0; i < 8; i += 1) {
      await pipeline.submit(segment(`k${i}`, i * 30, i));
    }
    // Stop while segments are still mid-flight (slow stages, 8 submitted).
    const result = await pipeline.stop();
    await consumer.done;

    expectBalanced(result, { segmentsIn: 8, segmentsOut: 8 });
    expect(result.stats.abandoned).toBe(0);
    expect(result.stats.abandonedAdmission).toBe(0);
    expect(result.stats.abandonedProcessing).toBe(0);
    expect(result.outcome).toBe("stopped");
    // The drain-completeness proof: every INTERNAL queue (input + inter-stage)
    // is empty at settle; the output holds only undelivered emissions.
    expect(result.stats.queueDepths.slice(0, 3).every((depth) => depth === 0)).toBe(true);
    for (const stage of result.stages) {
      expect(stage.inFlight).toBe(0);
      expect(stage.abandonedInFlight).toBe(0);
      expect(stage.abandonedQueued).toBe(0);
      expect(stage.received).toBe(stage.emitted);
    }
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual(
      Array.from({ length: 8 }, (_, i) => `k${i}`),
    );
  });

  test("a submit parked on the FULL input queue at stop-time is abandoned (the W301 parked-send precedent)", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [slowIdentityStage("s0", 3), slowIdentityStage("s1", 3)],
      queue: { capacity: 1, policy: "block" },
    });
    pipeline.start();
    // A slow consumer keeps the whole chain busy so the input fills.
    const drainPromise = drainOutput(output, 2);

    // Five submits: k0 goes straight to the parked worker (receive-bypass),
    // k1 fills the capacity-1 input queue, k2/k3/k4 park in the sender FIFO.
    const submits = Array.from({ length: 5 }, (_, i) =>
      pipeline.submit(segment(`k${i}`, i * 40, i)),
    );
    expect(await until(() => pipeline.stats().segmentsIn === 5)).toBe(true);
    expect(await until(() => pipeline.stats().segmentsIn - pipeline.stats().admitted === 3)).toBe(
      true,
    );

    // Drain-mode stop: the input queue closes; the three parked sends reject
    // with ChannelClosedError and are each accounted ABANDONED — while the
    // admitted k0/k1 complete their stage work and flow to the output.
    const result = await pipeline.stop();
    const outcomes = await Promise.all(submits);
    const received = await drainPromise;

    expectBalanced(result, { segmentsIn: 5, segmentsOut: 2, abandoned: 3 });
    expect(result.stats.abandonedAdmission).toBe(3);
    expect(result.stats.abandonedProcessing).toBe(0);
    // The parked sends resolved `abandoned`, never `admitted`, never lost.
    expect(outcomes.map((o) => o.disposition)).toEqual([
      "admitted",
      "admitted",
      "abandoned",
      "abandoned",
      "abandoned",
    ]);
    for (const record of pipeline.rejections()) {
      expect(record).toMatchObject({
        bucket: "abandoned",
        reason: "stop-closed-input",
        failureClass: "internal",
      });
    }
    expect(pipeline.rejections()).toHaveLength(3);
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual(["k0", "k1"]);
  });
});

describe("stop() cancel mode — everything unresolved is ABANDONED (never silent)", () => {
  test("in-flight completes-but-undelivered, queued swept, parked send closed — exact buckets + ledger", async () => {
    const completed: string[] = [];
    const slowDetect = {
      stage: "detect",
      transform: async (seg: PipelineSegment): Promise<StageOutcome> => {
        await until(() => true, 1); // several microtask ticks
        for (let i = 0; i < 40; i += 1) await Promise.resolve();
        completed.push(seg.idempotencyKey);
        return { status: "emitted", segment: seg };
      },
    };
    const { pipeline } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [slowDetect, identityStage("pack")],
      queues: [
        { capacity: 4, policy: "block" },
        { capacity: 4, policy: "block" },
        { capacity: 16, policy: "block" },
      ],
    });
    pipeline.start();
    // k0: handed straight to the (slow) worker; k1..k4 fill the input queue;
    // k5 parks on the full input queue.
    const outcomes = [];
    for (let i = 0; i < 5; i += 1) {
      outcomes.push(await pipeline.submit(segment(`k${i}`, i * 30, i)));
    }
    const parked = pipeline.submit(segment("k5", 150, 5));
    expect(await until(() => pipeline.stats().segmentsIn === 6)).toBe(true);
    expect(await until(() => completed.includes("k0") === false)).toBe(true);

    // CANCEL: every queue closes immediately; the worker's in-flight k0
    // transform still COMPLETES (observable above) but cannot be delivered.
    const result = await pipeline.stop({ mode: "cancel" });
    const parkedOutcome = await parked;
    expect(outcomes.every((o) => o.disposition === "admitted")).toBe(true);
    expect(parkedOutcome).toEqual({
      disposition: "abandoned",
      idempotencyKey: "k5",
      reason: "stop-closed-input",
    });

    // The exact split: 6 in = 0 out + 6 abandoned (1 admission + 1 in-flight
    // + 4 swept from the input queue).
    expectBalanced(result, { segmentsIn: 6, segmentsOut: 0, abandoned: 6 });
    expect(result.stats.abandonedAdmission).toBe(1);
    expect(result.stats.abandonedProcessing).toBe(5);
    expect(result.outcome).toBe("stopped");
    // The in-flight transform really completed — its WORK finished, only the
    // delivery became impossible (the documented cancel semantics).
    expect(completed).toEqual(["k0"]);
    // Stage-level buckets: detect received k0 (abandoned in-flight) and owned
    // the swept queue (4); pack never received anything.
    const [detect, pack] = result.stages;
    expect(detect).toMatchObject({
      received: 1,
      emitted: 0,
      abandonedInFlight: 1,
      abandonedQueued: 4,
      inFlight: 0,
    });
    expect(pack).toMatchObject({ received: 0, inFlight: 0 });
    // EVERY abandonment left one structured ledger record with its reason.
    const ledger = pipeline.rejections();
    expect(ledger).toHaveLength(6);
    expect(ledger.filter((r) => r.reason === "stop-closed-input")).toHaveLength(1);
    expect(ledger.filter((r) => r.reason === "cancel-closed-queue")).toHaveLength(1);
    expect(ledger.filter((r) => r.reason === "cancel-swept-queue")).toHaveLength(4);
    for (const record of ledger) {
      expect(record.bucket).toBe("abandoned");
      expect(record.idempotencyKey).not.toBeNull();
    }
  });

  test("cancel-mode accounting is metered and logged (never silent)", async () => {
    const obs = capturedObservability();
    const { pipeline } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [slowIdentityStage("s0", 3), identityStage("s1")],
      queue: { capacity: 4, policy: "block" },
      observability: obs.options,
    });
    pipeline.start();
    for (let i = 0; i < 3; i += 1) {
      await pipeline.submit(segment(`k${i}`, i * 30, i));
    }
    const result = await pipeline.stop({ mode: "cancel" });
    expect(result.stats.abandoned).toBeGreaterThan(0);
    expect(
      obs.metrics.snapshot().counters.find((c) => c.name === METRICS.abandonedTotal)?.value,
    ).toBe(result.stats.abandoned);
    const warnLines = obs
      .records()
      .filter((r) => r.msg === "pipeline segment refused or abandoned");
    expect(warnLines).toHaveLength(result.stats.abandoned);
    for (const line of warnLines) {
      expect(line.fields).toMatchObject({ bucket: "abandoned" });
      expect(line.fields).toHaveProperty("reason");
    }
  });

  test("stop() is idempotent: a second stop returns the SAME settled result object", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("s0")],
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0));
    const first = await pipeline.stop();
    const second = await pipeline.stop();
    const third = await pipeline.stop({ mode: "cancel" }); // mode is moot after settle
    await consumer.done;
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(await pipeline.done()).toBe(first);
  });

  test("stop() before start() is a caller error; concurrent stops settle once", async () => {
    const { pipeline } = wiredPipeline({ sessionId: SESSION_ID, stages: [identityStage("s0")] });
    await expect(pipeline.stop()).rejects.toThrow(InvalidPipelineStateError);
    pipeline.start();
    await pipeline.submit(segment("k0", 0));
    const [a, b] = await Promise.all([pipeline.stop(), pipeline.stop()]);
    expect(a).toBe(b);
  });
});

describe("admitted-segment budget — fail-loud terminal (resource limit)", () => {
  test("the submit past the budget is refused, the pipeline terminates resource-limit, accounting closes", async () => {
    const obs = capturedObservability();
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("s0")],
      queue: { capacity: 16, policy: "block" },
      limits: { maxAdmittedSegments: 2 },
      observability: obs.options,
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    expect((await pipeline.submit(segment("k0", 0))).disposition).toBe("admitted");
    expect((await pipeline.submit(segment("k1", 10))).disposition).toBe("admitted");
    const over = await pipeline.submit(segment("k2", 20));
    expect(over).toEqual({
      disposition: "rejected",
      rejection: {
        reason: "segment-budget-exhausted",
        failureClass: "resource-limit",
        details: { maxAdmittedSegments: 2 },
      },
    });

    const result = await pipeline.stop();
    await consumer.done;
    // Fail-loud terminal: the result records the resource-limit failure.
    expect(result.outcome).toBe("failed");
    expect(result.terminalFailureClass).toBe("resource-limit");
    expect(result.error).toContain("admitted-segment budget");
    expectBalanced(result, { segmentsIn: 3, segmentsOut: 2, rejected: 1 });
    expect(result.stats.rejectedLimit).toBe(1);
    // The refusal left its ledger record + metric (never silent).
    expect(pipeline.rejections()[0]).toMatchObject({
      bucket: "rejected",
      failureClass: "resource-limit",
      reason: "segment-budget-exhausted",
    });
    // After settle, submits are caller errors (nothing accounted).
    await expect(pipeline.submit(segment("k3", 30))).rejects.toThrow(InvalidPipelineStateError);
    expect((await pipeline.done()).stats.segmentsIn).toBe(3);
  });
});
