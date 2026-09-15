/**
 * The W306 benchmark driver: ONE end-to-end run of the REAL W304 streaming
 * pipeline (`RenderOrchestrator` — the public API, never a mock) over the
 * controlled live-stream fixture, instrumented at every stage boundary in
 * the injected clock domain.
 *
 * The wiring (all real seams):
 *
 * - the fixture (`buildLiveFixture`) — a seeded, checked-in schedule of real
 *   W006/W402 SWM updates whose arrivals advance the ONE injected
 *   `VirtualGpuClock` (`driveLiveSource`);
 * - `LiveSwmStore` — the growing `SwmUpdateStore` seam with per-update
 *   consumption instrumentation;
 * - `createAnimeRenderBatchExecutor` — W304's OWN provided executor (one
 *   REAL W502 anime render per batch, consuming the authored render
 *   duration on the clock), wrapped ONLY by the entry/exit instrumentation;
 * - `RenderOrchestrator` — the real consumer/scheduler pumps, W303 job
 *   scheduling, bounded channel, reorder buffer, and never-silent settle.
 *
 * After `done()` settles (the orchestrator's own accounting asserted), the
 * driver assembles the trace, asserts the W306 frame-level accounting
 * (fail-loud), builds + schema-validates the report, and returns everything.
 *
 * Determinism: the same options produce byte-identical `serialized` bytes —
 * the clock is virtual (time moves only through the authored sleeps), every
 * timestamp is a deterministic clock read, and the microtask interleaving of
 * a fixed program is FIFO-deterministic. Pinned by tests, in-process and
 * across subprocesses.
 */
import type { RenderRequest } from "@sporta/contracts";
import { VirtualGpuClock } from "@sporta/gpu-worker";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { CorrelationContext, Logger } from "@sporta/observability";
import { RenderOrchestrator, createAnimeRenderBatchExecutor } from "@sporta/render-orchestration";
import type { RenderOrchestrationResult } from "@sporta/render-orchestration";
import { buildRenderRequest, TEST_EPOCH_MS } from "@sporta/testing";
import { buildLiveFixture, LIVE_FIXTURE_PROFILE } from "./fixture";
import type { LiveFixtureProfile } from "./fixture";
import { LiveSwmStore, driveLiveSource } from "./store";
import { instrumentedExecutor, outputTap } from "./instrument";
import { assembleTrace } from "./trace";
import type { LatencyTrace } from "./trace";
import {
  buildLatencyReport,
  BENCHMARK_PIPELINE,
  renderHumanSummary,
  serializeLatencyReport,
} from "./report";
import type { BenchmarkPipelineConfig } from "./report";
import { assertLatencyAccounting } from "./accounting";
import { IncompleteBenchmarkRunError } from "./errors";
import type { LatencyBenchmarkReport } from "./schema";

/** Options for {@link runLatencyBenchmark}. */
export interface LatencyBenchmarkOptions {
  /** The live-stream fixture profile (default: the checked-in W306 profile). */
  readonly profile?: LiveFixtureProfile;
  /** Pipeline overrides on the default {@link BENCHMARK_PIPELINE}. */
  readonly pipeline?: Partial<BenchmarkPipelineConfig>;
  /**
   * A replacement render executor (TEST-ONLY seam: the loss-injection tests
   * wrap the real executor to fail scripted batches; production runs use
   * the real one).
   */
  readonly testExecutor?: Parameters<typeof instrumentedExecutor>[1];
}

/** One completed benchmark run: the report plus the raw evidence. */
export interface LatencyBenchmarkRun {
  readonly report: LatencyBenchmarkReport;
  /** The canonical (sorted-keys) serialization — byte-identical on rerun. */
  readonly serialized: string;
  /** The deterministic human-readable summary. */
  readonly summary: string;
  /** The settled W304 orchestrator result, VERBATIM (the raw evidence). */
  readonly result: RenderOrchestrationResult;
  /** The assembled per-frame/per-batch trace. */
  readonly trace: LatencyTrace;
}

/**
 * The render request template (the W304 integration's own template,
 * VERBATIM — `anime.prototype@0.1.0`, 1170×880 SVG, 1 fps, the offline
 * latency class the anime plugin declares; the benchmark measures the W304
 * streaming pipeline's latency structure, and the renderer is the real
 * plugin W304 itself executes).
 */
export function benchmarkRenderRequest(sessionId: string): RenderRequest {
  return buildRenderRequest({
    sessionId,
    rendererId: "anime.prototype",
    rendererVersion: "0.1.0",
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: {
      resolution: { w: 1170, h: 880 },
      frameRate: 1,
      codec: "svg",
      container: "svg",
      latencyClass: "offline",
    },
    styleConfig: { styleId: "style-w306-latency", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: {
      canReferenceSourceFrames: true,
      canDeliverLive: false,
      canStoreDerivatives: true,
      canShare: false,
    },
    sourceFrameRefs: [],
  });
}

/** The captured observability (deterministic; evidence only, never reported). */
function capturedObservability(): {
  logger: Logger;
  metrics: MetricsRegistry;
  correlation: CorrelationContext;
} {
  const lines: string[] = [];
  const logger = createLogger({ sink: (line) => lines.push(line), now: () => TEST_EPOCH_MS });
  return {
    logger,
    metrics: new MetricsRegistry(),
    correlation: {
      sessionId: "sess-w306-latency",
      correlationId: "corr-w306-latency",
      traceId: "trace-w306-latency",
    },
  };
}

/**
 * Runs the W306 end-to-end latency benchmark. Fails loud (typed errors) on
 * any structural problem: invalid options, a broken fixture, a replay
 * divergence, an accounting imbalance, or an unvalidatable report.
 */
export async function runLatencyBenchmark(
  options: LatencyBenchmarkOptions = {},
): Promise<LatencyBenchmarkRun> {
  const profile = options.profile ?? LIVE_FIXTURE_PROFILE;
  const pipeline: BenchmarkPipelineConfig = { ...BENCHMARK_PIPELINE, ...options.pipeline };
  const fixture = buildLiveFixture(profile);
  const clock = new VirtualGpuClock(0);
  const store = new LiveSwmStore(fixture, clock);
  const realExecutor = createAnimeRenderBatchExecutor({
    renderDurationMs: pipeline.renderDurationMs,
  });
  const { executor, invocations } = instrumentedExecutor(
    clock,
    options.testExecutor ?? realExecutor,
  );
  const { onOutput, emissions } = outputTap(clock);
  const observability = capturedObservability();

  const orchestrator = new RenderOrchestrator({
    sessionId: fixture.sessionId,
    store,
    renderExecutor: executor,
    renderRequest: benchmarkRenderRequest(fixture.sessionId),
    clock,
    startMs: 0,
    limits: {
      maxUpdatesPerBatch: pipeline.maxUpdatesPerBatch,
      batchIntervalMs: pipeline.batchIntervalMs,
      maxQueuedBatches: pipeline.maxQueuedBatches,
      maxQueuedBatchBytes: pipeline.maxQueuedBatchBytes,
      maxReorderOutputs: pipeline.maxReorderOutputs,
      maxQueuedRenderJobs: pipeline.maxQueuedRenderJobs,
      maxAdmittedJobs: pipeline.maxAdmittedJobs,
    },
    workers: pipeline.workers.map((worker) => ({ ...worker })),
    backpressure: pipeline.backpressure,
    degradation:
      pipeline.degradation.kind === "disabled"
        ? { skipStale: "disabled" }
        : { skipStale: { maxWatermarkLagMs: pipeline.degradation.maxWatermarkLagMs } },
    onOutput,
    observability,
  });

  const clockStartMs = clock.now();
  const source = driveLiveSource(clock, fixture);
  await orchestrator.start();
  await source;
  const result = await orchestrator.done();
  const clockEndMs = clock.now();
  // The report characterizes a COMPLETE run: every fixture update consumed,
  // every batch terminal, the stream drained. An early termination (stop,
  // cancel, or the W303 terminal resource-limit) leaves batches uncut and
  // frames un-attributed — the evidence is incomplete and is REFUSED loudly
  // (never a partial report that silently understates the stream).
  if (result.outcome !== "completed") {
    throw new IncompleteBenchmarkRunError(
      `the orchestrator settled "${result.outcome}"` +
        (result.terminalFailureClass === undefined
          ? ""
          : ` (terminal failure class: ${result.terminalFailureClass})`) +
        " — a latency report requires a completed run over the whole fixture; " +
        "check the pipeline bounds (the W303 admitted budget / render deadline " +
        "are the usual terminators)",
    );
  }

  const trace = assembleTrace({
    fixture,
    store,
    invocations,
    emissions,
    result,
    // The full limits set the orchestrator ran with (the pipeline config now
    // carries every bound the benchmark can configure; only the DLQ retention
    // stays at the W304 DEFAULT_RENDER_LIMITS magnitude — it has no
    // loss-path relevance at these batch counts).
    limits: {
      ...pipeline,
      maxDlqEntries: 1_000,
    },
    startMs: 0,
  });
  const emittedManifestFrames = result.outputs.reduce(
    (sum, record) => sum + record.output.frames.length,
    0,
  );
  assertLatencyAccounting(trace, result, emittedManifestFrames);
  const report = buildLatencyReport({
    trace,
    result,
    emittedManifestFrames,
    clockStartMs,
    clockEndMs,
    pipeline,
  });
  return {
    report,
    serialized: serializeLatencyReport(report),
    summary: renderHumanSummary(report),
    result,
    trace,
  };
}
