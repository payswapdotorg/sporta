/**
 * The never-silent frame accounting: every input frame lands in exactly one
 * terminal bucket, runtime-asserted — an imbalance throws a typed
 * `LatencyAccountingError` with the full breakdown, never a lying `balanced`.
 */
import { describe, expect, test } from "bun:test";
import { emptyStats } from "@sporta/render-orchestration";
import type { RenderOrchestrationResult } from "@sporta/render-orchestration";
import { assertLatencyAccounting, buildAccounting } from "../src/accounting";
import type { LatencyTrace } from "../src/trace";
import { LatencyAccountingError } from "../src/errors";

/** Builds a minimal trace with the given per-disposition frame counts. */
function traceWith(buckets: {
  rendered?: number;
  skippedStale?: number;
  dropped?: number;
  cancelled?: number;
  duplicate?: number;
  dropReason?: string | null;
}): LatencyTrace {
  const framesIn =
    (buckets.rendered ?? 0) +
    (buckets.skippedStale ?? 0) +
    (buckets.dropped ?? 0) +
    (buckets.cancelled ?? 0) +
    (buckets.duplicate ?? 0);
  const batch = (
    ordinal: number,
    disposition: "rendered" | "skipped-stale" | "dropped" | "cancelled" | "duplicate",
    updates: number,
  ) => ({
    batchId: `b-${ordinal}`,
    ordinal,
    sequences: Array.from({ length: updates }, (_, i) => i),
    watermarkMs: ordinal * 1_000,
    windowMs: { startMs: 0, endMs: ordinal * 1_000 },
    closedBy: "watermark-boundary" as const,
    disposition,
    dropReason: disposition === "dropped" ? (buckets.dropReason ?? "queue-refused") : null,
    executorInvocations: disposition === "rendered" ? 1 : 0,
    visibleFirstAtMs: 0,
    visibleLastAtMs: 100,
    cutAtMs: 200,
    executorEntryAtMs: disposition === "rendered" ? 300 : null,
    executorExitAtMs: disposition === "rendered" ? 700 : null,
    emittedAtMs: disposition === "rendered" ? 800 : null,
    jobTiming:
      disposition === "rendered"
        ? { submittedAtMs: 250, finishedAtMs: 750, executionMs: 400, queueWaitMs: 50 }
        : null,
    stageMs: {
      "swm-to-batch": disposition === "rendered" ? 100 : null,
      "batch-queue": disposition === "rendered" ? 50 : null,
      "w303-schedule": disposition === "rendered" ? 50 : null,
      "render-execution": disposition === "rendered" ? 400 : null,
      "finish-to-emit": disposition === "rendered" ? 50 : null,
      "end-to-end": disposition === "rendered" ? 800 : null,
    },
  });
  const batches = [
    ...(buckets.rendered ? [batch(1, "rendered", buckets.rendered)] : []),
    ...(buckets.skippedStale ? [batch(2, "skipped-stale", buckets.skippedStale)] : []),
    ...(buckets.dropped ? [batch(3, "dropped", buckets.dropped)] : []),
    ...(buckets.cancelled ? [batch(4, "cancelled", buckets.cancelled)] : []),
    ...(buckets.duplicate ? [batch(5, "duplicate", buckets.duplicate)] : []),
  ];
  return {
    fixture: {
      profileId: "p",
      profileVersion: 1,
      seed: "s",
      seconds: 3,
      updateCount: framesIn,
      burstEventFromMs: 0,
      burstEventToMs: 0,
    },
    sessionId: "sess-accounting-test",
    orchestratorOutcome: "completed" as const,
    frames: Array.from({ length: framesIn }, (_, i) => ({
      sequence: i,
      batchId: "b-?",
      observedAtMs: 0,
      visibleAtMs: 10,
      deriveMs: 10,
      firstQueriedAtMs: 20,
      emittedAtMs: null,
      swmStoreSojournMs: 10,
      endToEndMs: null,
    })),
    batches,
  };
}

/**
 * A settled orchestrator result whose stats are INTERNALLY CONSISTENT with
 * the trace's buckets (every W304 identity holds): one batch per non-empty
 * bucket, `queue-refused` drops refused at the channel, `render-failed`
 * drops failed at the protocol.
 */
function resultFor(buckets: {
  rendered?: number;
  skippedStale?: number;
  dropped?: number;
  cancelled?: number;
  duplicate?: number;
  dropReason?: string | null;
}): RenderOrchestrationResult {
  const rendered = buckets.rendered ? 1 : 0;
  const skippedStale = buckets.skippedStale ? 1 : 0;
  const dropped = buckets.dropped ? 1 : 0;
  const cancelled = buckets.cancelled ? 1 : 0;
  const duplicate = buckets.duplicate ? 1 : 0;
  const batchesIn = rendered + skippedStale + dropped + cancelled + duplicate;
  const renderFailed = (buckets.dropReason ?? "queue-refused") === "render-failed" ? 1 : 0;
  const queueRefused = dropped > 0 && renderFailed === 0 ? 1 : 0;
  const sentToQueue = rendered + cancelled + renderFailed;
  return {
    sessionId: "sess-accounting-test",
    outcome: "completed",
    stats: {
      ...emptyStats(),
      batchesIn,
      batchesRendered: rendered,
      batchesSkippedStale: skippedStale,
      batchesDropped: dropped,
      batchesCancelled: cancelled,
      batchesDuplicateSkips: duplicate,
      batchesSkippedStaleAtAdmission: skippedStale,
      batchesDuplicateSkipsAtConsume: duplicate,
      batchesQueueRefused: queueRefused,
      batchesSentToQueue: sentToQueue,
      batchesReceivedFromQueue: sentToQueue,
      batchesCancelledInQueue: cancelled,
      renderJobsSubmitted: rendered + renderFailed,
      batchesRenderFailed: renderFailed,
      outputsEmitted: rendered,
    },
    outputs: [],
    checkpoints: [],
    ledger: [],
    channelDropped: 0,
    balanced: true,
  };
}

describe("assertLatencyAccounting (the frame identities)", () => {
  test("an all-rendered trace balances", () => {
    const trace = traceWith({ rendered: 5 });
    const result = resultFor({ rendered: 5 });
    expect(() => assertLatencyAccounting(trace, result, 5)).not.toThrow();
  });

  test("every loss sink balances (skipped + dropped + cancelled + duplicate)", () => {
    const trace = traceWith({
      rendered: 3,
      skippedStale: 2,
      dropped: 4,
      cancelled: 1,
      duplicate: 2,
    });
    const result = resultFor({
      rendered: 3,
      skippedStale: 2,
      dropped: 4,
      cancelled: 1,
      duplicate: 2,
    });
    expect(() => assertLatencyAccounting(trace, result, 3)).not.toThrow();
  });

  test("a missing frame row (silent loss) is refused — the fixture-count check fires first", () => {
    const result = resultFor({ rendered: 3, dropped: 4 });
    // Tamper: the fixture claims 8 updates but only 7 frame rows exist. The
    // FIRST fired check is the fixture-count-vs-frame-rows identity (a missing
    // row IS a silent loss — caught before the bucket identity is summed).
    const lying: LatencyTrace = {
      ...traceWith({ rendered: 3, dropped: 4 }),
      fixture: {
        ...traceWith({ rendered: 3, dropped: 4 }).fixture,
        updateCount: 8,
      },
    };
    try {
      assertLatencyAccounting(lying, result, 3);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LatencyAccountingError);
      const message = (err as Error).message;
      expect(message).toContain("authors 8 updates");
      expect(message).toContain("7 frame rows");
    }
  });

  test("a vanishing frame bucket (silent loss) is refused with the full breakdown", () => {
    const result = resultFor({ rendered: 3, dropped: 4 });
    // Tamper: rows and updateCount AGREE (8), but the bucket sum is 7 — the
    // terminal-bucket identity fires with the full breakdown attached.
    const honest = traceWith({ rendered: 3, dropped: 4 });
    const lying: LatencyTrace = {
      ...honest,
      fixture: { ...honest.fixture, updateCount: 8 },
      frames: [
        ...honest.frames,
        {
          sequence: 7,
          batchId: "b-3",
          observedAtMs: 0,
          visibleAtMs: 10,
          deriveMs: 10,
          firstQueriedAtMs: 20,
          emittedAtMs: null,
          swmStoreSojournMs: 10,
          endToEndMs: null,
        },
      ],
    };
    try {
      assertLatencyAccounting(lying, result, 3);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LatencyAccountingError);
      const message = (err as Error).message;
      expect(message).toContain("identity broken");
      expect(message).toContain("framesIn");
      expect(message).toContain("emittedManifestFrames");
    }
  });

  test("emitted manifest frames must equal emitted frames", () => {
    const trace = traceWith({ rendered: 5 });
    const result = resultFor({ rendered: 5 });
    expect(() => assertLatencyAccounting(trace, result, 4)).toThrow(LatencyAccountingError);
  });

  test("trace batch count must equal the orchestrator's batchesIn", () => {
    const trace = traceWith({ rendered: 3, dropped: 2 });
    const result = resultFor({ rendered: 3 }); // internally consistent, but batchesIn=1≠2
    expect(() => assertLatencyAccounting(trace, result, 3)).toThrow(LatencyAccountingError);
  });

  test("trace rendered count must equal the orchestrator's batchesRendered", () => {
    const trace = traceWith({ rendered: 5 });
    const result = resultFor({ rendered: 5, dropped: 2, dropReason: "render-failed" });
    expect(() => assertLatencyAccounting(trace, result, 5)).toThrow(LatencyAccountingError);
  });

  test("the frame rows must equal the fixture's update count", () => {
    const honest = traceWith({ rendered: 5 });
    const lying: LatencyTrace = { ...honest, frames: honest.frames.slice(0, 4) }; // a frame row vanished
    const result = resultFor({ rendered: 5 });
    expect(() => assertLatencyAccounting(lying, result, 5)).toThrow(LatencyAccountingError);
  });

  test("the W304 identities are re-asserted (a lying stats block is refused)", () => {
    const trace = traceWith({ rendered: 5 });
    const honest = resultFor({ rendered: 5 });
    // Break a W304 sub-identity: a batch was received but never sent.
    const lying: RenderOrchestrationResult = {
      ...honest,
      stats: { ...honest.stats, batchesSentToQueue: 0 },
    };
    expect(() => assertLatencyAccounting(trace, lying, 5)).toThrow(RangeError);
  });
});

describe("buildAccounting (the report's accounting block)", () => {
  test("the block carries the exact buckets, the drop-reason histogram, and the stats verbatim", () => {
    const trace = traceWith({ rendered: 3, dropped: 4, skippedStale: 2 });
    const result = resultFor({ rendered: 3, dropped: 4, skippedStale: 2 });
    const accounting = buildAccounting(trace, result, 3);
    expect(accounting.frames).toEqual({
      framesIn: 9,
      framesEmitted: 3,
      framesSkippedStale: 2,
      framesDropped: 4,
      framesCancelled: 0,
      framesDuplicate: 0,
      dropReasons: { "queue-refused": 4 },
      emittedManifestFrames: 3,
      balanced: true,
    });
    expect(accounting.orchestratorStats).toEqual(result.stats);
  });

  test("buildAccounting asserts first (an unbalanced input throws, never builds a lying block)", () => {
    const trace = traceWith({ rendered: 5 });
    const result = resultFor({ rendered: 5 });
    expect(() => buildAccounting(trace, result, 4)).toThrow(LatencyAccountingError);
  });

  test("the drop-reason histogram distinguishes reasons exactly", () => {
    const trace = traceWith({ dropped: 4, dropReason: "render-failed" });
    const result = resultFor({ dropped: 4, dropReason: "render-failed" });
    const accounting = buildAccounting(trace, result, 0);
    expect(accounting.frames.dropReasons).toEqual({ "render-failed": 4 });
  });
});
