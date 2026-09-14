/**
 * Core pipeline tests (W302): N-stage flow, FIFO order, VERBATIM watermark
 * pass-through (never re-stamped, never reordered — the W301 rule), payload
 * identity end-to-end, correlation ids flowing (W007), idempotent duplicate
 * re-submission, malformed submit accounting, and lifecycle misuse errors.
 */
import { describe, expect, test } from "bun:test";
import type { StageMessage } from "@sporta/contracts";
import { SCHEMA_VERSION } from "@sporta/contracts";
import { MalformedSegmentError, InvalidPipelineStateError } from "../src/errors";
import { VirtualProcessingClock } from "../src/clock";
import type { PipelineSegment } from "../src/segment";
import { PROCESSING_METRIC_NAMES as METRICS } from "../src/types";
import type { PipelineStageSpec, StageOutcome } from "../src/types";
import {
  backgroundConsumer,
  capturedObservability,
  drainOutput,
  identityStage,
  markingStage,
  payloadOf,
  segment,
  until,
  wiredPipeline,
  expectBalanced,
} from "./helpers";

const SESSION_ID = "sess-w302-core";

describe("multi-stage flow", () => {
  test("one segment flows through three identity stages unchanged", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("a"), identityStage("b"), identityStage("c")],
    });
    pipeline.start();
    const original = segment("k0", 1_234, 5, 20);
    const outcome = await pipeline.submit(original);
    expect(outcome).toEqual({ disposition: "admitted", sequence: 0 });

    const result = await pipeline.stop();
    expectBalanced(result, { segmentsIn: 1, segmentsOut: 1 });

    const received = await drainOutput(output);
    expect(received).toHaveLength(1);
    const message = received[0]!;
    // The envelope: session, schema version, sequence, correlation defaults.
    expect(message.sessionId).toBe(SESSION_ID);
    expect(message.schemaVersion).toBe(SCHEMA_VERSION);
    expect(message.sequence).toBe(0);
    expect(message.correlationId).toBe(`corr-pipe-${SESSION_ID}`);
    expect(message.traceId).toBe(`trace-pipe-${SESSION_ID}`);
    // VERBATIM: watermark deep-equal AND the payload is the SAME object the
    // caller submitted (zero copies through the whole chain).
    expect(message.watermark).toEqual({ watermarkMs: 1_234, sequence: 0 });
    expect(message.payload).toBe(original);
    expect(payloadOf(message)).toBe(original);
  });

  test("many segments keep FIFO order through every stage (submission order)", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("a"), identityStage("b")],
      queue: { capacity: 3 },
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    for (let i = 0; i < 12; i += 1) {
      await pipeline.submit(segment(`k${i}`, i * 40, i));
    }
    const result = await pipeline.stop();
    const received = await consumer.done;
    expectBalanced(result, { segmentsIn: 12, segmentsOut: 12 });
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual(
      Array.from({ length: 12 }, (_, i) => `k${i}`),
    );
    // Sequences are assigned at submission, in order, and carried verbatim.
    expect(received.map((m) => m.sequence)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  test("out-of-order watermarks pass through VERBATIM, never re-sorted or re-stamped", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [markingStage("enrich", "enriched"), identityStage("pack")],
      queue: { capacity: 2 },
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    const watermarks = [900, 100, 500, 200, 700, 300];
    for (const [i, ms] of watermarks.entries()) {
      await pipeline.submit(segment(`k${i}`, ms, i));
    }
    const result = await pipeline.stop();
    const received = await consumer.done;
    expectBalanced(result, { segmentsIn: 6, segmentsOut: 6 });
    // Emission order = submission order (never re-sorted) …
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual([
      "k0",
      "k1",
      "k2",
      "k3",
      "k4",
      "k5",
    ]);
    // …and each watermark is its OWN authored value (never re-stamped).
    expect(received.map((m) => payloadOf(m).watermark.watermarkMs)).toEqual(watermarks);
    expect(received.map((m) => m.watermark.watermarkMs)).toEqual(watermarks);
  });

  test("stages can transform payloads while timing stays VERBATIM", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [markingStage("enrich", "enriched")],
    });
    pipeline.start();
    const original = segment("k0", 777, 9);
    await pipeline.submit(original);
    await pipeline.stop();
    const received = await drainOutput(output);
    const out = payloadOf(received[0]!);
    expect(out.payload).toEqual({ value: 9, enriched: true });
    expect(out.idempotencyKey).toBe(original.idempotencyKey);
    expect(out.watermark).toEqual(original.watermark);
    expect(out.watermark).toBe(original.watermark); // same reference: not re-stamped
  });

  test("per-stage stats reconcile with the flow (received/emitted per stage)", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("a"), identityStage("b")],
      queue: { capacity: 4 },
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    for (let i = 0; i < 5; i += 1) {
      await pipeline.submit(segment(`k${i}`, i * 10, i));
    }
    const result = await pipeline.stop();
    await consumer.done;
    expectBalanced(result, { segmentsIn: 5, segmentsOut: 5 });
    expect(result.stages.map((s) => s.stage)).toEqual(["a", "b"]);
    for (const stage of result.stages) {
      expect(stage.received).toBe(5);
      expect(stage.emitted).toBe(5);
      expect(stage.failed).toBe(0);
      expect(stage.inFlight).toBe(0);
    }
  });
});

describe("idempotency and validation at the boundary", () => {
  test("re-submission of an emitted key counts as a duplicate, is skipped, never re-emitted", async () => {
    const obs = capturedObservability();
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("a")],
      observability: obs.options,
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0, 0));
    // Wait for the emission (the registry records at last-stage admission).
    expect(await until(() => pipeline.stats().segmentsOut === 1)).toBe(true);
    const duplicate = await pipeline.submit(segment("k0", 0, 0));
    expect(duplicate).toEqual({
      disposition: "duplicate",
      idempotencyKey: "k0",
      firstDisposition: "emitted",
    });
    const result = await pipeline.stop();
    const received = await consumer.done;
    expectBalanced(result, { segmentsIn: 2, segmentsOut: 1, duplicates: 1 });
    expect(received).toHaveLength(1);
    // Never silent: counted, logged (info), metered.
    expect(
      obs.records().filter((r) => r.msg === "pipeline segment re-submitted (idempotent duplicate)"),
    ).toHaveLength(1);
    expect(
      obs.metrics.snapshot().counters.find((c) => c.name === METRICS.duplicatesTotal)?.value,
    ).toBe(1);
  });

  test("a malformed segment rejects the submit promise, is counted and ledgered, and the pipeline continues", async () => {
    const obs = capturedObservability();
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("a")],
      observability: obs.options,
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0, 0));
    const bad = segment("k1", -5); // negative watermark: malformed
    await expect(pipeline.submit(bad)).rejects.toThrow(MalformedSegmentError);
    await pipeline.submit(segment("k2", 20, 2));
    const result = await pipeline.stop();
    const received = await consumer.done;
    expectBalanced(result, { segmentsIn: 3, segmentsOut: 2, rejected: 1 });
    expect(result.stats.rejectedMalformed).toBe(1);
    // The refusal left structured evidence: ledger + warn log + metric.
    const ledger = pipeline.rejections();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      bucket: "rejected",
      failureClass: "media-invalid",
      idempotencyKey: "k1",
    });
    expect(
      obs.records().filter((r) => r.msg === "pipeline segment refused or abandoned"),
    ).toHaveLength(1);
    expect(
      obs.metrics
        .snapshot()
        .counters.find(
          (c) => c.name === METRICS.rejectedTotal && c.labels.failure_class === "media-invalid",
        )?.value,
    ).toBe(1);
    // The stream continued: k2 flowed through.
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual(["k0", "k2"]);
  });

  test("submit before start / after stop / after settle are caller errors (nothing accounted)", async () => {
    const { pipeline } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("a")],
    });
    await expect(pipeline.submit(segment("k0", 0))).rejects.toThrow(InvalidPipelineStateError);
    pipeline.start();
    const result = await pipeline.stop();
    expectBalanced(result, { segmentsIn: 0, segmentsOut: 0 });
    await expect(pipeline.submit(segment("k0", 0))).rejects.toThrow(InvalidPipelineStateError);
    expect(pipeline.currentPhase).toBe("ended");
  });

  test("double start is a caller error", () => {
    const { pipeline } = wiredPipeline({ sessionId: SESSION_ID, stages: [identityStage("a")] });
    pipeline.start();
    expect(() => pipeline.start()).toThrow(InvalidPipelineStateError);
  });

  test("done() before start is a caller error; stop() before start too", () => {
    const { pipeline } = wiredPipeline({ sessionId: SESSION_ID, stages: [identityStage("a")] });
    expect(() => pipeline.done()).toThrow(InvalidPipelineStateError);
    void expect(pipeline.stop()).rejects.toThrow(InvalidPipelineStateError);
  });
});

describe("multi-worker stages (concurrency > 1)", () => {
  test("4 workers over 20 segments: every segment emitted exactly once, balance exact, per-stage identity holds", async () => {
    // concurrency > 1 runs N independent receive→transform→send loops, so
    // the OUTPUT ORDER is not guaranteed (the W104 StageRunner caveat) —
    // the honest assertions are the exactly-once set, the exact balance,
    // and the per-stage disposition identity.
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [
        { ...identityStage("fan"), concurrency: 4 },
        { ...identityStage("pack"), concurrency: 2 },
      ],
      queue: { capacity: 8, policy: "block" },
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    const TOTAL = 20;
    for (let i = 0; i < TOTAL; i += 1) {
      await pipeline.submit(segment(`k${i}`, i * 25, i));
    }
    const result = await pipeline.stop();
    const received = await consumer.done;
    expectBalanced(result, { segmentsIn: TOTAL, segmentsOut: TOTAL });
    // Every key emitted EXACTLY once (sorted — order is not claimed).
    expect([...received.map((m) => payloadOf(m).idempotencyKey)].sort()).toEqual(
      Array.from({ length: TOTAL }, (_, i) => `k${i}`).sort(),
    );
    expect(new Set(received.map((m) => payloadOf(m).idempotencyKey)).size).toBe(TOTAL);
    // Sequences are unique (assigned at submission) and watermarks verbatim.
    expect(new Set(received.map((m) => m.sequence)).size).toBe(TOTAL);
    expect(
      [...received.map((m) => payloadOf(m).watermark.watermarkMs)].sort((a, b) => a - b),
    ).toEqual(Array.from({ length: TOTAL }, (_, i) => i * 25));
    // The per-stage disposition identity holds under concurrency.
    for (const stage of result.stages) {
      expect(stage.received).toBe(TOTAL);
      expect(stage.emitted).toBe(TOTAL);
      expect(stage.inFlight).toBe(0);
    }
  });
});

describe("correlation and budget hints", () => {
  test("per-submit correlation overrides flow end-to-end on every stage message", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("a"), identityStage("b")],
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0, 0), {
      correlationId: "corr-req-42",
      traceId: "trace-req-42",
    });
    await pipeline.submit(segment("k1", 10, 1)); // defaults
    const result = await pipeline.stop();
    const received = await consumer.done;
    expectBalanced(result, { segmentsIn: 2, segmentsOut: 2 });
    expect(received[0]).toMatchObject({ correlationId: "corr-req-42", traceId: "trace-req-42" });
    expect(received[1]).toMatchObject({
      correlationId: `corr-pipe-${SESSION_ID}`,
      traceId: `trace-pipe-${SESSION_ID}`,
    });
  });

  test("a resource budget hint rides every stage message (streaming contract)", async () => {
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("a")],
      resourceBudget: { maxMemoryMb: 512 },
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0));
    await pipeline.stop();
    const received = await consumer.done;
    expect(received[0]!.resourceBudget).toEqual({ maxMemoryMb: 512 });
  });

  test("live stats expose queue depths and distinct processed keys", async () => {
    const { pipeline } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("a"), identityStage("b")],
      queue: { capacity: 4 },
    });
    pipeline.start();
    expect(pipeline.stats().queueDepths).toEqual([0, 0, 0]);
    await pipeline.submit(segment("k0", 0));
    // The segment eventually leaves every queue (workers run eagerly).
    expect(await until(() => pipeline.stats().queueDepths.every((d) => d === 0))).toBe(true);
    expect(await until(() => pipeline.stats().segmentsOut === 1)).toBe(true);
    expect(pipeline.stats().distinctProcessed).toBe(1);
    await pipeline.stop();
  });

  test("the stage-latency histogram observes exact injected-clock latencies (never Date.now)", async () => {
    const obs = capturedObservability();
    const clock = new VirtualProcessingClock(0);
    const sleeping: PipelineStageSpec = {
      stage: "slow",
      transform: async (seg: PipelineSegment): Promise<StageOutcome> => {
        // k0 consumes 5ms of processing time, k1 consumes 9ms — measured by
        // the injected clock, never a wall clock.
        await clock.sleep(seg.idempotencyKey === "k0" ? 5 : 9);
        return { status: "emitted", segment: seg };
      },
    };
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [sleeping],
      clock,
      observability: obs.options,
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0));
    await pipeline.submit(segment("k1", 10));
    const result = await pipeline.stop();
    await consumer.done;
    expectBalanced(result, { segmentsIn: 2, segmentsOut: 2 });
    const histogram = obs.metrics
      .snapshot()
      .histograms.find((h) => h.name === METRICS.stageLatencyMs);
    expect(histogram?.stats).toMatchObject({ count: 2, min: 5, max: 9, mean: 7 });
    // The latencies were consumed from the injected clock (14ms total).
    expect(clock.now()).toBe(14);
  });
});

describe("constructor validation (fail-loud wiring)", () => {
  const clock = { now: () => 0, sleep: async () => {} };

  test("rejects an empty session id, no stages, and a bad clock", async () => {
    const { ProcessingPipeline } = await import("../src/pipeline");
    expect(
      () => new ProcessingPipeline({ sessionId: "", stages: [identityStage("a")], clock }),
    ).toThrow(RangeError);
    expect(() => new ProcessingPipeline({ sessionId: "s", stages: [], clock })).toThrow(RangeError);
    expect(
      () =>
        new ProcessingPipeline({
          sessionId: "s",
          stages: [identityStage("a")],
          clock: {} as never,
        }),
    ).toThrow(TypeError);
  });

  test("rejects duplicate stage ids and invalid queue specs", async () => {
    const { ProcessingPipeline } = await import("../src/pipeline");
    expect(
      () =>
        new ProcessingPipeline({
          sessionId: "s",
          stages: [identityStage("a"), identityStage("a")],
          clock,
        }),
    ).toThrow(/duplicate stage id/);
    expect(
      () =>
        new ProcessingPipeline({
          sessionId: "s",
          stages: [identityStage("a")],
          queues: [{ capacity: 1, policy: "block" }],
          clock,
        }),
    ).toThrow(/exactly 2/);
    expect(
      () =>
        new ProcessingPipeline({
          sessionId: "s",
          stages: [identityStage("a")],
          queues: [
            { capacity: 0, policy: "block" },
            { capacity: 1, policy: "block" },
          ],
          clock,
        }),
    ).toThrow(/capacity/);
    expect(
      () =>
        new ProcessingPipeline({
          sessionId: "s",
          stages: [identityStage("a")],
          queues: [
            { capacity: 1, policy: "nope" as "block" },
            { capacity: 1, policy: "block" },
          ],
          clock,
        }),
    ).toThrow(/policy/);
    expect(
      () =>
        new ProcessingPipeline({
          sessionId: "s",
          stages: [identityStage("a")],
          queue: { capacity: 1, policy: "block" },
          queues: [
            { capacity: 1, policy: "block" },
            { capacity: 1, policy: "block" },
          ],
          clock,
        }),
    ).toThrow(/not both/);
  });

  test("rejects invalid checkpoint intervals and limits", async () => {
    const { ProcessingPipeline } = await import("../src/pipeline");
    expect(
      () =>
        new ProcessingPipeline({
          sessionId: "s",
          stages: [identityStage("a")],
          clock,
          checkpointEveryMs: 0,
        }),
    ).toThrow(/checkpointEveryMs/);
    expect(
      () =>
        new ProcessingPipeline({
          sessionId: "s",
          stages: [identityStage("a")],
          clock,
          limits: { maxDeadLetterEntries: 0, maxAdmittedSegments: 10 },
        }),
    ).toThrow(/maxDeadLetterEntries/);
    expect(
      () =>
        new ProcessingPipeline({
          sessionId: "s",
          stages: [identityStage("a")],
          clock,
          limits: { maxDeadLetterEntries: 1, maxAdmittedSegments: 0 },
        }),
    ).toThrow(/maxAdmittedSegments/);
  });
});

/** Import-only guard: the module compiles with strict types (compile-time proof). */
test("type smoke: a PipelineSegment round-trips", () => {
  const seg: PipelineSegment = segment("k", 1, 1, 1);
  const msg: StageMessage["watermark"] = seg.watermark;
  expect(msg.sequence).toBe(0);
});
