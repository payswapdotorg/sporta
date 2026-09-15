/**
 * The pure batch-cut replay + the stage-stat computation: hand-computed grid
 * walks over synthetic updates (the deterministic-replay property), plus the
 * `assembleTrace` fail-loud cross-checks exercised through the REAL pipeline
 * (tampered evidence must throw typed accounting errors — never a lying trace).
 */
import { describe, expect, test } from "bun:test";
import { buildWorldSnapshot } from "@sporta/testing";
import { VirtualGpuClock } from "@sporta/gpu-worker";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import { RenderOrchestrator, createAnimeRenderBatchExecutor } from "@sporta/render-orchestration";
import type {
  RenderOrchestrationLimits,
  RenderOrchestrationResult,
  SwmUpdate,
} from "@sporta/render-orchestration";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { buildLiveFixture, LIVE_FIXTURE_PROFILE } from "../src/fixture";
import type { LiveFixture } from "../src/fixture";
import { LiveSwmStore, driveLiveSource } from "../src/store";
import { instrumentedExecutor, outputTap } from "../src/instrument";
import type { EmissionRecord, ExecutorInvocation } from "../src/instrument";
import { assembleTrace, computeStageStats, replayBatchCuts } from "../src/trace";
import type { BatchTraceRow, FrameTraceRow, LatencyTrace } from "../src/trace";
import { assertLatencyAccounting } from "../src/accounting";
import { benchmarkRenderRequest, runLatencyBenchmark } from "../src/benchmark";
import { BENCHMARK_PIPELINE } from "../src/report";
import type { LatencyBenchmarkReport } from "../src/schema";
import { LatencyAccountingError } from "../src/errors";

/** Builds one synthetic update with a controlled watermark (content irrelevant to the grid). */
function updateAt(sequence: number, watermarkMs: number): SwmUpdate {
  const snapshot = buildWorldSnapshot({
    sessionId: "sess-replay-test",
    watermark: { watermarkMs, sequence },
  });
  return {
    sequence,
    watermark: { ...snapshot.watermark },
    snapshot,
    events: [],
    byteSize: 100,
  };
}

describe("replayBatchCuts (the pure grid walk)", () => {
  test("empty input cuts nothing", () => {
    expect(
      replayBatchCuts("sess", [], { batchIntervalMs: 1_000, maxUpdatesPerBatch: 3 }, 0),
    ).toEqual([]);
  });

  test("one update per grid window: one watermark-boundary batch per second, ordinals 1-based", () => {
    const updates = [updateAt(0, 1_000), updateAt(1, 2_000), updateAt(2, 3_000)];
    const batches = replayBatchCuts(
      "sess-r",
      updates,
      { batchIntervalMs: 1_000, maxUpdatesPerBatch: 3 },
      0,
    );
    expect(batches).toHaveLength(3);
    // The third update sits EXACTLY AT its boundary (head 3000 >= boundary
    // 3000): the real W304 consumer cuts it as a normal watermark-boundary
    // batch — "stream-complete" is reserved for the partial window cut by the
    // final flush (head strictly BELOW the next boundary), which never runs
    // here (the loop ends once the last sequence is consumed).
    expect(batches.map((b) => b.closedBy)).toEqual([
      "watermark-boundary",
      "watermark-boundary",
      "watermark-boundary",
    ]);
    expect(batches.map((b) => b.ordinal)).toEqual([1, 2, 3]);
    expect(batches.map((b) => b.batchId)).toEqual([
      "render-batch-sess-r-1",
      "render-batch-sess-r-2",
      "render-batch-sess-r-3",
    ]);
    // Each batch carries exactly its own update; windows walk the grid.
    expect(batches[0]!.updates.map((u) => u.sequence)).toEqual([0]);
    expect(batches[0]!.windowMs).toEqual({ startMs: 0, endMs: 1_000 });
    expect(batches[1]!.windowMs).toEqual({ startMs: 1_000, endMs: 2_000 });
    expect(batches[2]!.windowMs).toEqual({ startMs: 2_000, endMs: 3_000 });
  });

  test("a size-limit split: 4 updates in one window with max 3 → 3+1, window continues at the watermark", () => {
    const updates = [
      updateAt(0, 1_100),
      updateAt(1, 1_200),
      updateAt(2, 1_300),
      updateAt(3, 1_400),
    ];
    const batches = replayBatchCuts(
      "sess-r",
      updates,
      { batchIntervalMs: 1_000, maxUpdatesPerBatch: 3 },
      0,
    );
    expect(batches).toHaveLength(2);
    expect(batches[0]!.closedBy).toBe("size-limit");
    expect(batches[0]!.updates).toHaveLength(3);
    // The continuation window starts at the split batch's own watermark.
    expect(batches[1]!.closedBy).toBe("stream-complete");
    expect(batches[1]!.updates.map((u) => u.sequence)).toEqual([3]);
    expect(batches[1]!.windowMs.startMs).toBe(1_300);
  });

  test("an empty window (the head jumped past a boundary) advances the grid without a batch", () => {
    const updates = [updateAt(0, 5_000), updateAt(1, 6_000)];
    const batches = replayBatchCuts(
      "sess-r",
      updates,
      { batchIntervalMs: 1_000, maxUpdatesPerBatch: 3 },
      0,
    );
    expect(batches).toHaveLength(2);
    // Boundaries 1000..4000 were empty; each empty advance sets windowStart to
    // THAT boundary (the real W304 consumer's grid arithmetic) — so the first
    // batch's window starts at the LAST empty boundary (4000), not at 0.
    expect(batches[0]!.windowMs.startMs).toBe(4_000);
    expect(batches[0]!.windowMs.endMs).toBe(5_000);
    expect(batches[1]!.windowMs).toEqual({ startMs: 5_000, endMs: 6_000 });
  });

  test("the batch watermark is the LAST update's watermark, verbatim (never the boundary)", () => {
    const updates = [updateAt(0, 1_050), updateAt(1, 1_900)];
    const batches = replayBatchCuts(
      "sess-r",
      updates,
      { batchIntervalMs: 1_000, maxUpdatesPerBatch: 3 },
      0,
    );
    expect(batches[0]!.watermark.watermarkMs).toBe(1_900);
    // The head (1900) sits strictly below the next boundary (2000): the
    // complete stream's tail is a PARTIAL window, closed by the final flush
    // at the LAST update's own watermark (the real W304 consumer's
    // cutFinalFlush arithmetic) — never stretched to the boundary.
    expect(batches[0]!.closedBy).toBe("stream-complete");
    expect(batches[0]!.windowMs).toEqual({ startMs: 1_000, endMs: 1_900 });
  });

  test("deterministic: the same inputs re-cut the same batches (deep-equal)", () => {
    const updates = [
      updateAt(0, 1_100),
      updateAt(1, 1_200),
      updateAt(2, 1_300),
      updateAt(3, 2_500),
      updateAt(4, 2_600),
      updateAt(5, 2_700),
      updateAt(6, 2_800),
    ];
    const limits = { batchIntervalMs: 1_000, maxUpdatesPerBatch: 3 };
    expect(replayBatchCuts("sess-r", updates, limits, 0)).toEqual(
      replayBatchCuts("sess-r", updates, limits, 0),
    );
  });
});

describe("computeStageStats (pure over a synthetic trace)", () => {
  test("batch/frame stage stats aggregate exactly the non-null samples", () => {
    const batch = (ordinal: number, e2e: number | null): BatchTraceRow => ({
      batchId: `b-${ordinal}`,
      ordinal,
      sequences: [ordinal],
      watermarkMs: ordinal * 1_000,
      windowMs: { startMs: 0, endMs: ordinal * 1_000 },
      closedBy: "watermark-boundary",
      disposition: "rendered",
      dropReason: null,
      executorInvocations: 1,
      visibleFirstAtMs: 0,
      visibleLastAtMs: 100,
      cutAtMs: 200,
      executorEntryAtMs: 300,
      executorExitAtMs: 700,
      emittedAtMs: e2e === null ? null : 800,
      jobTiming: {
        submittedAtMs: 250,
        finishedAtMs: 750,
        executionMs: 400,
        queueWaitMs: 50,
      },
      stageMs: {
        "swm-to-batch": 100,
        "batch-queue": 50,
        "w303-schedule": 50,
        "render-execution": 400,
        "finish-to-emit": 50,
        "end-to-end": e2e,
      },
    });
    const frame = (
      sequence: number,
      sojourn: number | null,
      e2e: number | null,
    ): FrameTraceRow => ({
      sequence,
      batchId: `b-${sequence}`,
      observedAtMs: 0,
      visibleAtMs: 10,
      deriveMs: 10,
      firstQueriedAtMs: sojourn === null ? null : sojourn + 10,
      emittedAtMs: e2e,
      swmStoreSojournMs: sojourn,
      endToEndMs: e2e,
    });
    const trace: LatencyTrace = {
      fixture: {
        profileId: "p",
        profileVersion: 1,
        seed: "s",
        seconds: 3,
        updateCount: 3,
        burstEventFromMs: 0,
        burstEventToMs: 0,
      },
      sessionId: "sess",
      orchestratorOutcome: "completed",
      frames: [frame(0, 10, 100), frame(1, 20, null), frame(2, null, null)],
      batches: [batch(1, 100), batch(2, 200), batch(3, null)],
    };
    const stats = computeStageStats(trace);
    expect(stats.batchStages["end-to-end"]).toEqual({
      count: 2,
      minMs: 100,
      maxMs: 200,
      p50Ms: 100,
      p95Ms: 200,
    });
    expect(stats.batchStages["render-execution"].count).toBe(3);
    expect(stats.frameStages["swm-store-sojourn"]).toEqual({
      count: 2,
      minMs: 10,
      maxMs: 20,
      p50Ms: 10,
      p95Ms: 20,
    });
    expect(stats.frameStages["end-to-end"].count).toBe(1);
    expect(stats.sourceModel.worldModelUpdateDeriveMs).toEqual({
      count: 3,
      minMs: 10,
      maxMs: 10,
      p50Ms: 10,
      p95Ms: 10,
    });
  });
});

describe("assembleTrace cross-checks (fail loud on tampered real-pipeline evidence)", () => {
  /** The small profile the tamper fixtures run (fast, with one burst). */
  const tamperProfile = {
    ...LIVE_FIXTURE_PROFILE,
    profileId: "w306-tamper-fixture",
    seed: "w306-tamper-seed",
    seconds: 8,
    burstEventFromMs: 3_000,
    burstEventToMs: 5_000,
  };

  /** Runs the REAL pipeline manually over the small fixture, capturing raw evidence. */
  async function smallRun(): Promise<{
    fixture: LiveFixture;
    store: LiveSwmStore;
    invocations: readonly ExecutorInvocation[];
    emissions: readonly EmissionRecord[];
    result: RenderOrchestrationResult;
    limits: RenderOrchestrationLimits;
  }> {
    const fixture = buildLiveFixture(tamperProfile);
    const clock = new VirtualGpuClock(0);
    const store = new LiveSwmStore(fixture, clock);
    const { executor, invocations } = instrumentedExecutor(
      clock,
      createAnimeRenderBatchExecutor({ renderDurationMs: BENCHMARK_PIPELINE.renderDurationMs }),
    );
    const { onOutput, emissions } = outputTap(clock);
    const orchestrator = new RenderOrchestrator({
      sessionId: fixture.sessionId,
      store,
      renderExecutor: executor,
      renderRequest: benchmarkRenderRequest(fixture.sessionId),
      clock,
      startMs: 0,
      limits: {
        maxUpdatesPerBatch: BENCHMARK_PIPELINE.maxUpdatesPerBatch,
        batchIntervalMs: BENCHMARK_PIPELINE.batchIntervalMs,
        maxQueuedBatches: BENCHMARK_PIPELINE.maxQueuedBatches,
        maxReorderOutputs: BENCHMARK_PIPELINE.maxReorderOutputs,
      },
      workers: BENCHMARK_PIPELINE.workers.map((worker) => ({ ...worker })),
      backpressure: BENCHMARK_PIPELINE.backpressure,
      degradation: { skipStale: "disabled" },
      onOutput,
      observability: {
        logger: createLogger({ sink: () => undefined, now: () => TEST_EPOCH_MS }),
        metrics: new MetricsRegistry(),
        correlation: { sessionId: "s", correlationId: "c", traceId: "t" },
      },
    });
    const source = driveLiveSource(clock, fixture);
    await orchestrator.start();
    await source;
    const result = await orchestrator.done();
    return {
      fixture,
      store,
      invocations,
      emissions,
      result,
      limits: {
        maxUpdatesPerBatch: BENCHMARK_PIPELINE.maxUpdatesPerBatch,
        batchIntervalMs: BENCHMARK_PIPELINE.batchIntervalMs,
        maxQueuedBatches: BENCHMARK_PIPELINE.maxQueuedBatches,
        maxReorderOutputs: BENCHMARK_PIPELINE.maxReorderOutputs,
        maxQueuedBatchBytes: 0,
        maxQueuedRenderJobs: 64,
        maxAdmittedJobs: 1_000_000,
        maxDlqEntries: 1_000,
      },
    };
  }

  test("the untampered evidence assembles and the accounting closes", async () => {
    const evidence = await smallRun();
    const trace = assembleTrace({ ...evidence, startMs: 0 });
    expect(trace.batches.length).toBe(evidence.result.stats.batchesIn);
    expect(trace.frames).toHaveLength(evidence.fixture.steps.length);
    const emittedManifestFrames = evidence.result.outputs.reduce(
      (sum, record) => sum + record.output.frames.length,
      0,
    );
    expect(() =>
      assertLatencyAccounting(trace, evidence.result, emittedManifestFrames),
    ).not.toThrow();
  }, 30_000);

  test("a bogus executor invocation (a batch the replay never cut) is refused", async () => {
    const evidence = await smallRun();
    expect(() =>
      assembleTrace({
        ...evidence,
        startMs: 0,
        invocations: [
          ...evidence.invocations,
          {
            batchId: "render-batch-never-cut-999",
            ordinal: 999,
            sequences: [0],
            watermarkMs: 1,
            entryAtMs: 0,
            exitAtMs: 1,
            outcome: "succeeded",
          },
        ],
      }),
    ).toThrow(LatencyAccountingError);
  }, 30_000);

  test("a dropped emission (tap count ≠ settled outputs) is refused", async () => {
    const evidence = await smallRun();
    expect(evidence.emissions.length).toBeGreaterThan(1);
    expect(() =>
      assembleTrace({ ...evidence, startMs: 0, emissions: evidence.emissions.slice(1) }),
    ).toThrow(LatencyAccountingError);
  }, 30_000);

  test("a duplicate emission record (double delivery) is refused", async () => {
    const evidence = await smallRun();
    expect(() =>
      assembleTrace({
        ...evidence,
        startMs: 0,
        emissions: [...evidence.emissions, evidence.emissions[0]!],
      }),
    ).toThrow(LatencyAccountingError);
  }, 30_000);

  test("an executor window escaping the W303 job lifetime is refused", async () => {
    const evidence = await smallRun();
    const first = evidence.invocations[0]!;
    expect(() =>
      assembleTrace({
        ...evidence,
        startMs: 0,
        invocations: evidence.invocations.map((invocation) =>
          invocation === first ? { ...invocation, entryAtMs: -1 } : invocation,
        ),
      }),
    ).toThrow(LatencyAccountingError);
  }, 30_000);

  test("runLatencyBenchmark's own run and the manual wiring agree on the settled stats", async () => {
    const run: { report: LatencyBenchmarkReport } = await runLatencyBenchmark({
      profile: tamperProfile,
    });
    const evidence = await smallRun();
    expect(evidence.result.stats.batchesIn).toBe(run.report.accounting.orchestratorStats.batchesIn);
  }, 30_000);
});
