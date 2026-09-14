/**
 * Retries and dead-letter tests (W302) — the W104 rules proven at pipeline
 * level:
 *
 * - retryable failures get BOUNDED retries with the INJECTED clock and
 *   DETERMINISTIC backoff (pure arithmetic `base * multiplier^(n-1)`,
 *   pinned exactly via a recording clock — no wall time anywhere);
 * - NON-retryable failures go STRAIGHT to the DLQ, never blind-retried
 *   (attempts === 1);
 * - retry-budget exhaustion dead-letters with `terminal: retry-exhausted`
 *   and exact attempt counters;
 * - a transform that THROWS is an internal bug: classified non-retryable
 *   (`internal`), DLQ'd, the pipeline continues;
 * - DLQ entries carry the segment, stage id, error class, and the injected
 *   clock's timestamp (including consumed backoff);
 * - the DLQ is bounded; overflow is counted + logged + metered, never silent.
 */
import { describe, expect, test } from "bun:test";
import type { StageMessage } from "@sporta/contracts";
import { PROCESSING_METRIC_NAMES as METRICS } from "../src/types";
import type { PipelineStageSpec, StageOutcome } from "../src/types";
import { VirtualProcessingClock } from "../src/clock";
import type { PipelineSegment } from "../src/segment";
import {
  backgroundConsumer,
  capturedObservability,
  identityStage,
  payloadOf,
  segment,
  scriptedStage,
  wiredPipeline,
  expectBalanced,
  RecordingClock,
} from "./helpers";

const SESSION_ID = "sess-w302-retry";

describe("retryable failures — bounded, deterministic, injectable clock", () => {
  test("a retryable failure retries with exact deterministic backoff, then succeeds", async () => {
    const clock = new VirtualProcessingClock(0);
    const recording = new RecordingClock(clock);
    const scripted = scriptedStage(
      "detect",
      { k0: { retryable: true, errorClass: "transient", message: "model timeout", times: 2 } },
      { maxAttempts: 4, baseDelayMs: 100, backoffMultiplier: 2 },
    );
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [scripted.spec],
      clock: recording,
    });
    pipeline.start();
    const received: StageMessage[] = [];
    const consumer = backgroundConsumer(output, received);
    await pipeline.submit(segment("k0", 0, 0));
    const result = await pipeline.stop();
    await consumer.done;

    expectBalanced(result, { segmentsIn: 1, segmentsOut: 1 });
    // Two failures then success: 3 attempts, 2 retries, W104 arithmetic
    // backoff 100 * 2^0 = 100, 100 * 2^1 = 200 (pure arithmetic, injected
    // clock — no wall time).
    expect(recording.sleeps).toEqual([100, 200]);
    expect(scripted.calls("k0")).toBe(3);
    expect(result.stages[0]!.retries).toBe(2);
    // Virtual time consumed the backoff: 300ms of processing time.
    expect(clock.now()).toBe(300);
    expect(pipeline.deadLetters()).toHaveLength(0);
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual(["k0"]);
  });

  test("the retries metric is labeled per stage", async () => {
    const obs = capturedObservability();
    const scripted = scriptedStage(
      "detect",
      { k0: { retryable: true, errorClass: "transient", message: "flaky", times: 1 } },
      { maxAttempts: 3, baseDelayMs: 10, backoffMultiplier: 1 },
    );
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [scripted.spec],
      observability: obs.options,
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0));
    await pipeline.stop();
    await consumer.done;
    expect(
      obs.metrics
        .snapshot()
        .counters.find((c) => c.name === METRICS.retriesTotal && c.labels.stage === "detect")
        ?.value,
    ).toBe(1);
  });

  test("retry-budget exhaustion dead-letters with exact attempts and terminal class", async () => {
    const clock = new VirtualProcessingClock(0);
    const scripted = scriptedStage(
      "detect",
      { k0: { retryable: true, errorClass: "transient", message: "model timeout", times: 99 } },
      { maxAttempts: 3, baseDelayMs: 50, backoffMultiplier: 2 },
    );
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [scripted.spec],
      clock,
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0, 0));
    const result = await pipeline.stop();
    await consumer.done;

    expectBalanced(result, { segmentsIn: 1, segmentsOut: 0, deadLettered: 1 });
    expect(scripted.calls("k0")).toBe(3);
    const dlq = pipeline.deadLetters();
    expect(dlq).toHaveLength(1);
    expect(dlq[0]).toMatchObject({
      idempotencyKey: "k0",
      stage: "detect",
      errorClass: "transient",
      message: "model timeout",
      terminal: "retry-exhausted",
      attempts: 3,
      retriesUsed: 2,
      // The injected clock's reading AT dead-letter time includes the
      // consumed backoff: 50 + 100 = 150.
      atMs: 150,
    });
    // The DLQ entry carries the SEGMENT itself (verbatim reference).
    expect(dlq[0]!.segment.idempotencyKey).toBe("k0");
    // The failed key is terminally disposed: re-submission would be a
    // duplicate (recovery does NOT reprocess it).
    expect(result.stats.distinctProcessed).toBe(1);
  });
});

describe("non-retryable failures — straight to the DLQ, never blind-retried", () => {
  test("a non-retryable failure is dead-lettered on the FIRST attempt (the W104 rule)", async () => {
    const clock = new VirtualProcessingClock(0);
    const scripted = scriptedStage(
      "detect",
      {
        k0: {
          retryable: false,
          errorClass: "media-invalid",
          message: "corrupt payload",
          times: 99,
        },
      },
      { maxAttempts: 5, baseDelayMs: 100, backoffMultiplier: 2 }, // retries CONFIGURED but never used
    );
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [scripted.spec],
      clock,
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0, 0));
    const result = await pipeline.stop();
    await consumer.done;

    expectBalanced(result, { segmentsIn: 1, segmentsOut: 0, deadLettered: 1 });
    // NEVER blind-retried: one invocation, one attempt, zero sleeps.
    expect(scripted.calls("k0")).toBe(1);
    expect(clock.now()).toBe(0);
    expect(pipeline.deadLetters()[0]).toMatchObject({
      terminal: "non-retryable",
      attempts: 1,
      retriesUsed: 0,
      errorClass: "media-invalid",
      atMs: 0,
    });
    expect(result.stages[0]!.retries).toBe(0);
  });

  test("a stage without retry config gets NO retries (explicit policy choice)", async () => {
    const scripted = scriptedStage("detect", {
      k0: { retryable: true, errorClass: "transient", message: "flaky", times: 99 },
    });
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [scripted.spec],
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0));
    const result = await pipeline.stop();
    await consumer.done;
    expectBalanced(result, { segmentsIn: 1, segmentsOut: 0, deadLettered: 1 });
    expect(scripted.calls("k0")).toBe(1);
    expect(pipeline.deadLetters()[0]!.terminal).toBe("retry-exhausted");
    expect(pipeline.deadLetters()[0]!.attempts).toBe(1);
  });

  test("a transform that THROWS is an internal failure: DLQ'd, never retried, pipeline continues", async () => {
    const clock = new VirtualProcessingClock(0);
    const throwing: PipelineStageSpec = {
      stage: "enrich",
      transform: async (seg: PipelineSegment): Promise<StageOutcome> => {
        if (seg.idempotencyKey === "k1") {
          throw new Error("null pointer in enrich");
        }
        return { status: "emitted", segment: seg };
      },
      retry: { maxAttempts: 3, baseDelayMs: 10, backoffMultiplier: 1 },
    };
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [throwing],
      clock,
    });
    pipeline.start();
    const received: StageMessage[] = [];
    const consumer = backgroundConsumer(output, received);
    await pipeline.submit(segment("k0", 0, 0));
    await pipeline.submit(segment("k1", 10, 1)); // throws
    await pipeline.submit(segment("k2", 20, 2));
    const result = await pipeline.stop();
    await consumer.done;

    // The stream continued: k0 and k2 flowed; k1 was DLQ'd as internal.
    expectBalanced(result, { segmentsIn: 3, segmentsOut: 2, deadLettered: 1 });
    expect(pipeline.deadLetters()[0]).toMatchObject({
      idempotencyKey: "k1",
      stage: "enrich",
      errorClass: "internal",
      terminal: "internal",
      attempts: 1,
      message: "null pointer in enrich",
    });
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual(["k0", "k2"]);
  });

  test("a transform returning an invalid outcome shape is an internal failure, DLQ'd", async () => {
    const clock = new VirtualProcessingClock(0);
    const bogus: PipelineStageSpec = {
      stage: "weird",
      transform: (async () => "not an outcome") as unknown as PipelineStageSpec["transform"],
    };
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [bogus],
      clock,
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0));
    const result = await pipeline.stop();
    await consumer.done;
    expectBalanced(result, { segmentsIn: 1, segmentsOut: 0, deadLettered: 1 });
    expect(pipeline.deadLetters()[0]).toMatchObject({
      errorClass: "internal",
      terminal: "internal",
    });
  });

  test("a transform emitting an INVALID segment is an internal failure (never propagated downstream)", async () => {
    const invalid: PipelineStageSpec = {
      stage: "broken",
      transform: async (seg: PipelineSegment): Promise<StageOutcome> => ({
        status: "emitted",
        segment: { ...seg, idempotencyKey: "" }, // invalid: empty key
      }),
    };
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [invalid],
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0));
    const result = await pipeline.stop();
    await consumer.done;
    expectBalanced(result, { segmentsIn: 1, segmentsOut: 0, deadLettered: 1 });
    expect(pipeline.deadLetters()[0]!.errorClass).toBe("internal");
    // Nothing malformed was ever delivered downstream.
    expect(consumer.count()).toBe(0);
  });
});

describe("DLQ evidence and bounds", () => {
  test("DLQ entries carry correlation ids end-to-end (W007 posture)", async () => {
    const scripted = scriptedStage("detect", {
      k0: { retryable: false, errorClass: "media-invalid", message: "bad", times: 99 },
    });
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [scripted.spec],
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0), {
      correlationId: "corr-req-9",
      traceId: "trace-req-9",
    });
    await pipeline.stop();
    await consumer.done;
    expect(pipeline.deadLetters()[0]).toMatchObject({
      correlationId: "corr-req-9",
      traceId: "trace-req-9",
    });
  });

  test("the DLQ is bounded: overflow counted + logged + metered, never silent", async () => {
    const obs = capturedObservability();
    const scripted = scriptedStage("detect", {
      k0: { retryable: false, errorClass: "bad", message: "x", times: 99 },
      k1: { retryable: false, errorClass: "bad", message: "x", times: 99 },
      k2: { retryable: false, errorClass: "bad", message: "x", times: 99 },
    });
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [scripted.spec],
      limits: { maxDeadLetterEntries: 2 },
      observability: obs.options,
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    for (let i = 0; i < 3; i += 1) {
      await pipeline.submit(segment(`k${i}`, i * 10, i));
    }
    const result = await pipeline.stop();
    await consumer.done;

    expectBalanced(result, { segmentsIn: 3, segmentsOut: 0, deadLettered: 3 });
    expect(pipeline.deadLetterCount).toBe(2); // retained window
    expect(pipeline.deadLetterOverflow).toBe(1); // counted, never silent
    expect(result.stats.dlqOverflow).toBe(1);
    expect(result.stats.dlqRetained).toBe(2);
    expect(
      obs.metrics.snapshot().counters.find((c) => c.name === METRICS.deadLetteredTotal)?.value,
    ).toBe(3);
    expect(
      obs
        .records()
        .filter((r) => r.msg === "dead-letter queue overflow (entry counted, not retained)"),
    ).toHaveLength(1);
  });

  test("dead-letter latency evidence: transform time is measured with the injected clock", async () => {
    const clock = new VirtualProcessingClock(0);
    const slowFail: PipelineStageSpec = {
      stage: "slow",
      transform: async (): Promise<StageOutcome> => {
        await clock.sleep(5);
        return { status: "failed", retryable: false, errorClass: "bad", message: "slow failure" };
      },
    };
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [slowFail],
      clock,
    });
    pipeline.start();
    const consumer = backgroundConsumer(output, []);
    await pipeline.submit(segment("k0", 0));
    const result = await pipeline.stop();
    await consumer.done;
    expectBalanced(result, { segmentsIn: 1, segmentsOut: 0, deadLettered: 1 });
    // The dead-letter timestamp includes the measured transform time (5)
    // read from the injected clock — never a wall-clock read.
    expect(pipeline.deadLetters()[0]!.atMs).toBe(5);
  });

  test("a dead-lettered segment in a MULTI-stage pipeline dead-letters at its stage, later stages never see it", async () => {
    const scripted = scriptedStage("detect", {
      k1: { retryable: false, errorClass: "media-invalid", message: "corrupt", times: 99 },
    });
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [scripted.spec, identityStage("enrich")],
    });
    pipeline.start();
    const received: StageMessage[] = [];
    const consumer = backgroundConsumer(output, received);
    await pipeline.submit(segment("k0", 0, 0));
    await pipeline.submit(segment("k1", 10, 1));
    const result = await pipeline.stop();
    await consumer.done;
    expectBalanced(result, { segmentsIn: 2, segmentsOut: 1, deadLettered: 1 });
    expect(result.stages[0]!.failed).toBe(1);
    expect(result.stages[1]!.received).toBe(1); // enrich never saw k1
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual(["k0"]);
    expect(pipeline.deadLetters()[0]!.stage).toBe("detect");
  });
});
