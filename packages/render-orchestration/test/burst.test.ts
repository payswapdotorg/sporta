/**
 * The bounded-memory burst proof (W304's ACCEPTANCE CORE — "incremental SWM
 * updates can drive renderer work without unbounded backlog"):
 *
 * A large burst of SWM updates against a deliberately slow downstream (an
 * async sink and/or a slow executor) must keep `peakBatchesInSystem` — the
 * count of cut-but-not-terminal batches — PLATEAUED at the configured bounds
 * (`maxQueuedBatches + maxQueuedRenderJobs + workerConcurrency +
 * maxReorderOutputs`, plus the two transient hand slots: one parked consumer
 * send and one mid-dequeue batch), never at stream length. The same bounds
 * under a DOUBLE stream length must plateau at the SAME value: the peak is a
 * function of the BOUNDS, not of the input.
 *
 * Every batch the bounds refuse is a counted, ledgered, metered drop (the
 * W104 reject posture inherited by the W303 ready queue) — the run still
 * completes and the accounting still closes (the never-silent constitution).
 */
import { describe, expect, test } from "bun:test";
import { VirtualGpuClock } from "@sporta/gpu-worker";
import { createAnimeRenderBatchExecutor } from "../src/executor";
import { RenderOrchestrator } from "../src/orchestrator";
import type { RenderBatchOutcome } from "../src/types";
import {
  FixtureSwmStore,
  buildSwmStory,
  capturedObservability,
  drainMicrotasks,
  expectBalanced,
  wiredOrchestrator,
} from "./helpers";

/**
 * One burst run: `seconds` updates (one batch per update on the 1000ms grid)
 * against a sink that takes `sinkTicks` microtask hops per emitted record
 * (the slow-downstream knob — the serialized emission chain is the system's
 * natural pacing). Bounded exactly like the README's formula.
 */
async function burstRun(options: {
  sessionId: string;
  seconds: number;
  sinkTicks?: number;
  execTicks?: number;
  limits?: {
    maxQueuedBatches?: number;
    maxQueuedRenderJobs?: number;
    maxReorderOutputs?: number;
  };
  workers?: Array<{ workerId: string; maxConcurrentJobs: number }>;
}): Promise<{ result: Awaited<ReturnType<RenderOrchestrator["done"]>> }> {
  const clock = new VirtualGpuClock(0);
  const obs = capturedObservability();
  const { updates } = buildSwmStory({ sessionId: options.sessionId, seconds: options.seconds });
  const store = new FixtureSwmStore(updates);
  const real = createAnimeRenderBatchExecutor();
  const executor = options.execTicks
    ? {
        execute: async (
          batch: Parameters<typeof real.execute>[0],
          request: Parameters<typeof real.execute>[1],
          context: Parameters<typeof real.execute>[2],
        ): Promise<RenderBatchOutcome> => {
          await drainMicrotasks(options.execTicks ?? 0);
          return real.execute(batch, request, context);
        },
      }
    : real;
  const orchestrator = wiredOrchestrator(
    {
      store,
      clock,
      sessionId: options.sessionId,
      executor,
      ...(options.limits === undefined ? {} : { limits: options.limits }),
      ...(options.workers === undefined ? {} : { workers: options.workers }),
      ...(options.sinkTicks === undefined
        ? {}
        : {
            onOutput: async () => {
              await drainMicrotasks(options.sinkTicks ?? 0);
            },
          }),
    },
    obs,
  );
  await orchestrator.start();
  const result = await orchestrator.done();
  return { result };
}

describe("bounded-memory burst (the acceptance core)", () => {
  test("a 60-burst against a slow sink plateaus at the configured bounds, never at stream length", async () => {
    // Bounds: channel 2 + dispatcher queue 2 + worker concurrency 1 +
    // reorder 2 = 7 (+2 transient hand slots); stream length 60.
    const { result } = await burstRun({
      sessionId: "sess-burst-60",
      seconds: 60,
      sinkTicks: 10,
      limits: { maxQueuedBatches: 2, maxQueuedRenderJobs: 2, maxReorderOutputs: 2 },
      workers: [{ workerId: "w0", maxConcurrentJobs: 1 }],
    });
    const { stats } = result;
    expect(stats.batchesIn).toBe(60);
    // THE plateau: bounded by the configured bounds, reached under load.
    expect(stats.peakBatchesInSystem).toBeLessThanOrEqual(9);
    expect(stats.peakBatchesInSystem).toBeGreaterThan(4);
    expect(stats.peakBatchesInSystem).toBeLessThan(60);
    // The consumer genuinely PARKED under the block policy (backpressure
    // engaged — the honest load signal).
    expect(stats.consumerSendParkAttempts).toBeGreaterThan(0);
    // Everything the bounds admitted is accounted: rendered or
    // render-queue-refused (a loud counted drop, never a silent hole).
    expect(stats.batchesRendered + stats.batchesRenderQueueRefused).toBe(60);
    expect(stats.batchesRenderQueueRefused).toBeGreaterThan(0);
    // Emission stayed strictly in watermark order and honest under load.
    const watermarks = result.outputs.map((r) => r.provenance.sourceWatermark.watermarkMs);
    expect(watermarks).toEqual([...watermarks].sort((a, b) => a - b));
    expect(stats.maxEmissionLagMs).toBeGreaterThan(0);
    expectBalanced(result);
  });

  test("the plateau is a function of the BOUNDS: double the stream, same peak", async () => {
    const bounds = {
      maxQueuedBatches: 2,
      maxQueuedRenderJobs: 2,
      maxReorderOutputs: 2,
    };
    const workers = [{ workerId: "w0", maxConcurrentJobs: 1 }];
    const short = await burstRun({
      sessionId: "sess-burst-short",
      seconds: 60,
      sinkTicks: 10,
      limits: bounds,
      workers,
    });
    const long = await burstRun({
      sessionId: "sess-burst-long",
      seconds: 120,
      sinkTicks: 10,
      limits: bounds,
      workers,
    });
    // Same bounds, double the stream: the SAME plateau (the memory bound is
    // independent of the input length — the acceptance criterion).
    expect(long.result.stats.peakBatchesInSystem).toBe(short.result.stats.peakBatchesInSystem);
    expect(short.result.stats.peakBatchesInSystem).toBeLessThanOrEqual(9);
    expect(long.result.stats.batchesIn).toBe(120);
    expectBalanced(long.result);
  });

  test("a generous dispatcher bound becomes the dominant buffer: the plateau tracks it, not the stream", async () => {
    // maxQueuedRenderJobs 64 absorbs the burst (the W303 ready queue IS a
    // bounded buffer); with a slow executor the plateau sits at the
    // dispatcher bound — reached, bounded by the bounds sum, far below the
    // 100-batch stream length.
    const { result } = await burstRun({
      sessionId: "sess-burst-wide",
      seconds: 100,
      execTicks: 20,
      limits: { maxQueuedBatches: 2, maxQueuedRenderJobs: 64, maxReorderOutputs: 4 },
      workers: [{ workerId: "w0", maxConcurrentJobs: 2 }],
    });
    const { stats } = result;
    expect(stats.batchesIn).toBe(100);
    // The ready-queue bound was REACHED (the plateau is the bound, not an
    // accident) and stayed within the bounds sum (+ the hand slots).
    expect(stats.peakBatchesInSystem).toBeGreaterThanOrEqual(64);
    expect(stats.peakBatchesInSystem).toBeLessThanOrEqual(2 + 64 + 2 + 4 + 2);
    expect(stats.peakBatchesInSystem).toBeLessThan(100);
    expect(stats.batchesRendered + stats.batchesRenderQueueRefused).toBe(100);
    expectBalanced(result);
  });
});
