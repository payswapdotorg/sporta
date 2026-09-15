/**
 * The W306 pipeline integration suite: the REAL W304 streaming pipeline
 * (`RenderOrchestrator` over the W303 gpu-worker protocol through the REAL
 * W502 anime executor) driven end-to-end by `runLatencyBenchmark` on the
 * controlled live-stream fixture.
 *
 * Three tiers:
 *
 * 1. **The default evidence run** — the checked-in fixture + pipeline (exactly
 *    what SLOs.md documents). The measured p50/p95 per stage are PINNED here so
 *    the documented evidence can never silently drift from the code (a byte-drift
 *    is also caught by the determinism suite, but these pins read as evidence).
 * 2. **The loss paths** — tighter bounds exercise every loss sink the pipeline
 *    defines (queue-evicted, queue-refused, render-queue-refused,
 *    skipped-stale, render-failed, reorder-overflow), each with the
 *    never-silent frame accounting STILL balancing (`frames in = emitted +
 *    every sink`). The cancel/abandon paths require mid-run `stop()` calls the
 *    benchmark driver never makes (it runs to settlement by design) — they are
 *    W304's own test suite's territory, documented here as an honest boundary.
 * 3. **The fail-loud refusals** — an all-loss run (no stage samples) and an
 *    early-terminated run (the W303 admitted-budget resource limit) are REFUSED
 *    with typed errors, never reported with fabricated zeros or partial traces.
 */
import { describe, expect, test } from "bun:test";
import { createAnimeRenderBatchExecutor } from "@sporta/render-orchestration";
import type { RenderBatchExecutor } from "@sporta/render-orchestration";
import { runLatencyBenchmark } from "../src/benchmark";
import { LIVE_FIXTURE_PROFILE } from "../src/fixture";
import { checkSloCandidates, SLO_CANDIDATE_PROFILE_ID } from "../src/slo";
import { IncompleteBenchmarkRunError, InvalidBenchmarkOptionsError } from "../src/errors";

/** A small live profile with a dense burst (fast loss-path runs). */
const lossProfile = {
  ...LIVE_FIXTURE_PROFILE,
  profileId: "w306-loss-fixture",
  seed: "w306-loss-seed",
  seconds: 14,
  burstEventFromMs: 4_000,
  burstEventToMs: 8_000,
  burstUpdatesPerSecond: 16,
};

/** The frame-accounting balance assertion (the never-silent core). */
function expectBalancedFrames(frames: {
  framesIn: number;
  framesEmitted: number;
  framesSkippedStale: number;
  framesDropped: number;
  framesCancelled: number;
  framesDuplicate: number;
}): void {
  expect(
    frames.framesIn ===
      frames.framesEmitted +
        frames.framesSkippedStale +
        frames.framesDropped +
        frames.framesCancelled +
        frames.framesDuplicate,
  ).toBe(true);
}

describe("the default evidence run (the checked-in fixture + pipeline — SLOs.md's numbers)", () => {
  test("completes, balances, and carries the pinned measured evidence", async () => {
    const run = await runLatencyBenchmark(); // LIVE_FIXTURE_PROFILE + BENCHMARK_PIPELINE
    expect(run.report.benchmark.orchestratorOutcome).toBe("completed");
    expect(run.report.benchmark.fixture.profileId).toBe("w306-live-fixture");
    expect(run.report.benchmark.pipeline.renderDurationMs).toBe(400);

    // --- never-silent accounting (all 240 frames land somewhere) ------------
    const frames = run.report.accounting.frames;
    expect(frames.framesIn).toBe(240);
    expect(frames.framesEmitted).toBe(240);
    expect(frames.framesSkippedStale).toBe(0);
    expect(frames.framesDropped).toBe(0);
    expect(frames.framesCancelled).toBe(0);
    expect(frames.framesDuplicate).toBe(0);
    expect(frames.emittedManifestFrames).toBe(240);
    expectBalancedFrames(frames);

    const stats = run.report.accounting.orchestratorStats;
    expect(stats.batchesIn).toBe(140);
    expect(stats.batchesRendered).toBe(140);
    expect(stats.batchSplits).toBe(50);
    // The W304 bounded-memory evidence under this load: the peak sits at the
    // configured bounds, never at stream length (SLOs.md §Interpretation).
    expect(stats.peakBatchesInSystem).toBe(13);
    expect(stats.peakQueuedNow).toBe(0);
    expect(stats.consumerSendParkAttempts).toBe(0);

    // --- the measured stage table, pinned (SLOs.md §Evidence) ---------------
    const batch = run.report.stages.batch;
    expect(batch["swm-to-batch"]).toEqual({
      count: 140,
      minMs: 0,
      maxMs: 5_027,
      p50Ms: 102,
      p95Ms: 4_478,
    });
    expect(batch["batch-queue"]).toEqual({
      count: 140,
      minMs: 0,
      maxMs: 400,
      p50Ms: 0,
      p95Ms: 400,
    });
    expect(batch["w303-schedule"]).toEqual({
      count: 140,
      minMs: 0,
      maxMs: 4_400,
      p50Ms: 0,
      p95Ms: 4_000,
    });
    expect(batch["render-execution"]).toEqual({
      count: 140,
      minMs: 400,
      maxMs: 400,
      p50Ms: 400,
      p95Ms: 400,
    });
    expect(batch["finish-to-emit"]).toEqual({
      count: 140,
      minMs: 0,
      maxMs: 400,
      p50Ms: 0,
      p95Ms: 400,
    });
    expect(batch["end-to-end"]).toEqual({
      count: 140,
      minMs: 400,
      maxMs: 9_762,
      p50Ms: 2_029,
      p95Ms: 8_849,
    });
    const frame = run.report.stages.frame;
    expect(frame["swm-store-sojourn"]).toEqual({
      count: 240,
      minMs: 0,
      maxMs: 5_027,
      p50Ms: 2_121,
      p95Ms: 4_680,
    });
    expect(frame["end-to-end"]).toEqual({
      count: 240,
      minMs: 400,
      maxMs: 9_762,
      p50Ms: 3_968,
      p95Ms: 9_080,
    });
    // The AUTHORED source model (labeled as such, never presented as measured).
    expect(run.report.stages.sourceModel.worldModelUpdateDeriveMs.p50Ms).toBe(82);
    expect(run.report.stages.sourceModel.worldModelUpdateDeriveMs.p95Ms).toBe(117);

    // --- every SLO candidate holds with headroom (the W802 handoff) ---------
    const verdicts = checkSloCandidates(run.report);
    expect(SLO_CANDIDATE_PROFILE_ID).toBe("w306-candidate-v1");
    expect(verdicts).toHaveLength(12); // 6 stages × {p50, p95}
    for (const verdict of verdicts) {
      expect(
        verdict.pass,
        `${verdict.stage} ${verdict.metric}: measured ${verdict.measuredMs} vs target ${verdict.targetMs}`,
      ).toBe(true);
    }
  }, 30_000);
});

describe("the loss paths (tighter bounds; the accounting STILL balances)", () => {
  test("channel byte budget + block: oversized batches are queue-REFUSED and every frame is accounted", async () => {
    const run = await runLatencyBenchmark({
      profile: lossProfile,
      pipeline: { maxQueuedBatchBytes: 4_096, backpressure: "block" },
    });
    expect(run.report.benchmark.orchestratorOutcome).toBe("completed");
    const stats = run.report.accounting.orchestratorStats;
    expect(stats.batchesQueueRefused).toBeGreaterThan(0);
    expect(stats.batchesDropped).toBe(stats.batchesQueueRefused);
    const frames = run.report.accounting.frames;
    expect(frames.framesDropped).toBeGreaterThan(0);
    expect(frames.dropReasons).toEqual({ "queue-refused": frames.framesDropped });
    expectBalancedFrames(frames);
    // The stage table covers only batches that RENDERED (the survivors).
    expect(run.report.stages.batch["end-to-end"].count).toBe(stats.batchesRendered);
  }, 30_000);

  test("channel byte budget + drop-oldest: oversized batches are queue-EVICTED (the channel's own accounting)", async () => {
    const run = await runLatencyBenchmark({
      profile: lossProfile,
      pipeline: { maxQueuedBatchBytes: 4_096, backpressure: "drop-oldest" },
    });
    expect(run.report.benchmark.orchestratorOutcome).toBe("completed");
    const stats = run.report.accounting.orchestratorStats;
    expect(stats.batchesQueueEvicted).toBeGreaterThan(0);
    expect(stats.batchesQueueEvicted).toBe(run.result.channelDropped); // the cross-boundary identity
    expect(run.report.accounting.frames.dropReasons).toEqual({
      "queue-evicted": run.report.accounting.frames.framesDropped,
    });
    expectBalancedFrames(run.report.accounting.frames);
  }, 30_000);

  test("W303 ready-queue bound: submissions past the bound are render-queue-REFUSED", async () => {
    const run = await runLatencyBenchmark({
      profile: lossProfile,
      pipeline: { maxQueuedRenderJobs: 1, workers: [{ workerId: "w", maxConcurrentJobs: 1 }] },
    });
    expect(run.report.benchmark.orchestratorOutcome).toBe("completed");
    const stats = run.report.accounting.orchestratorStats;
    expect(stats.batchesRenderQueueRefused).toBeGreaterThan(0);
    expect(run.report.accounting.frames.dropReasons).toEqual({
      "render-queue-refused": run.report.accounting.frames.framesDropped,
    });
    expectBalancedFrames(run.report.accounting.frames);
  }, 30_000);

  test("skip-stale degradation: lagging batches are SKIPPED with their frames in the skipped bucket", async () => {
    const run = await runLatencyBenchmark({
      profile: lossProfile,
      pipeline: { degradation: { kind: "skip-stale", maxWatermarkLagMs: 500 } },
    });
    expect(run.report.benchmark.orchestratorOutcome).toBe("completed");
    const stats = run.report.accounting.orchestratorStats;
    expect(stats.batchesSkippedStale).toBeGreaterThan(0);
    expect(stats.batchesSkippedStaleAtAdmission + stats.batchesSkippedStaleInQueue).toBe(
      stats.batchesSkippedStale,
    );
    const frames = run.report.accounting.frames;
    expect(frames.framesSkippedStale).toBeGreaterThan(0);
    expectBalancedFrames(frames);
    // Skipped batches never reach the renderer: their executor invocation
    // count is exactly zero.
    for (const row of run.report.trace.batches) {
      if (row.disposition === "skipped-stale") {
        expect(row.executorInvocations).toBe(0);
      }
    }
  }, 30_000);

  test("scripted executor failures: batches are render-FAILED (a classified, non-retryable refusal)", async () => {
    const failing: RenderBatchExecutor = {
      async execute(batch, request, context) {
        if (batch.ordinal % 3 === 0) {
          return {
            status: "failed",
            errorClass: "render-refused",
            message: "scripted render refusal (loss-path fixture)",
            retryable: false,
          };
        }
        const real = createAnimeRenderBatchExecutor({ renderDurationMs: 400 });
        return await real.execute(batch, request, context);
      },
    };
    const run = await runLatencyBenchmark({ profile: lossProfile, testExecutor: failing });
    expect(run.report.benchmark.orchestratorOutcome).toBe("completed");
    const stats = run.report.accounting.orchestratorStats;
    expect(stats.batchesRenderFailed).toBeGreaterThan(0);
    expect(run.report.accounting.frames.dropReasons).toEqual({
      "render-failed": run.report.accounting.frames.framesDropped,
    });
    expectBalancedFrames(run.report.accounting.frames);
  }, 30_000);

  test("bounded reorder buffer: out-of-order completions overflow into the reorder-overflow bucket", async () => {
    // The W304 `slowFirstExecutor` recipe adapted to the live fixture: the
    // first batch's execution holds microtask hops before its render, so the
    // next completions arrive out of order and pile against the 1-slot bound —
    // the INCOMING output is dropped (never an evicted held one).
    const slowFirst: RenderBatchExecutor = {
      async execute(batch, request, context) {
        if (batch.ordinal === 1) {
          for (let i = 0; i < 400; i += 1) {
            await Promise.resolve();
          }
        }
        const real = createAnimeRenderBatchExecutor({ renderDurationMs: 400 });
        return await real.execute(batch, request, context);
      },
    };
    const run = await runLatencyBenchmark({
      profile: lossProfile,
      pipeline: { maxReorderOutputs: 1, workers: [{ workerId: "w", maxConcurrentJobs: 2 }] },
      testExecutor: slowFirst,
    });
    expect(run.report.benchmark.orchestratorOutcome).toBe("completed");
    const stats = run.report.accounting.orchestratorStats;
    expect(stats.batchesReorderOverflow).toBeGreaterThan(0);
    expect(run.report.accounting.frames.dropReasons).toEqual({
      "reorder-overflow": run.report.accounting.frames.framesDropped,
    });
    expectBalancedFrames(run.report.accounting.frames);
  }, 30_000);
});

describe("fail-loud refusals (never a fabricated or partial report)", () => {
  test("an all-loss run (every batch oversized) refuses: stage statistics are undefined", async () => {
    // byteSize 2048/update; even a single-update batch exceeds the budget.
    try {
      await runLatencyBenchmark({
        profile: lossProfile,
        pipeline: { maxQueuedBatchBytes: 1_000, backpressure: "reject" },
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidBenchmarkOptionsError);
      expect((err as { code: string }).code).toBe("invalid-benchmark-options");
      expect((err as Error).message).toContain("no samples");
    }
  }, 30_000);

  test("an early-terminated run (W303 admitted budget exhausted) refuses: the evidence is incomplete", async () => {
    try {
      await runLatencyBenchmark({
        profile: lossProfile,
        pipeline: { maxAdmittedJobs: 2, workers: [{ workerId: "w", maxConcurrentJobs: 1 }] },
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IncompleteBenchmarkRunError);
      expect((err as { code: string }).code).toBe("incomplete-benchmark-run");
      expect((err as Error).message).toContain("resource-limit");
    }
  }, 30_000);
});
