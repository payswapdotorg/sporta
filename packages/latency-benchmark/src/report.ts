/**
 * The W306 report: the machine-readable document built PURELY from the
 * recorded trace + the settled orchestrator result, its canonical byte form,
 * and the deterministic human-readable summary.
 *
 * The report is BUILT then VALIDATED (parsed back through the versioned zod
 * schema) before it is returned — a construction bug is a crash, never a
 * subtly-malformed artifact. The canonical byte form is the W403 serializer's
 * semantics (sorted keys, 2-space indent, trailing newline; NaN/undefined
 * rejected) re-implemented locally so the benchmark's dependency set stays
 * exactly what it uses.
 */
import type { LatencyTrace, LatencyStageStats } from "./trace";
import { computeStageStats, STAGE_DEFINITIONS } from "./trace";
import { buildAccounting, type LatencyAccounting } from "./accounting";
import type { RenderOrchestrationResult } from "@sporta/render-orchestration";
import { parseLatencyReport, REPORT_SCHEMA_TAG, type LatencyBenchmarkReport } from "./schema";
import { SETTLE_QUANTA_PER_ARRIVAL } from "./store";
import { LatencyReportValidationError } from "./errors";

/** The degradation configuration the benchmark ran (echoed verbatim). */
export type BenchmarkDegradation =
  | { readonly kind: "disabled" }
  | { readonly kind: "skip-stale"; readonly maxWatermarkLagMs: number };

/** The pipeline configuration the benchmark ran (echoed verbatim). */
export interface BenchmarkPipelineConfig {
  readonly renderDurationMs: number;
  readonly batchIntervalMs: number;
  readonly maxUpdatesPerBatch: number;
  readonly maxQueuedBatches: number;
  /** The batch channel's payload-byte budget (0 = count-bound only; W104). */
  readonly maxQueuedBatchBytes: number;
  readonly maxReorderOutputs: number;
  /** The W303 dispatcher's ready-queue bound (the render-queue-refused path). */
  readonly maxQueuedRenderJobs: number;
  /** The W303 dispatcher's admitted-job budget (the terminal resource-limit path). */
  readonly maxAdmittedJobs: number;
  readonly workers: ReadonlyArray<{ workerId: string; maxConcurrentJobs: number }>;
  readonly backpressure: "block" | "reject" | "drop-oldest";
  readonly degradation: BenchmarkDegradation;
}

/** Everything `buildLatencyReport` needs (all measured/assembled evidence). */
export interface ReportInputs {
  readonly trace: LatencyTrace;
  readonly result: RenderOrchestrationResult;
  readonly emittedManifestFrames: number;
  readonly clockStartMs: number;
  readonly clockEndMs: number;
  readonly pipeline: BenchmarkPipelineConfig;
}

/**
 * Builds the machine-readable report from the evidence: stats via the pure
 * percentile core, accounting via the never-silent assertions, the stage
 * definitions echoed verbatim, and the full per-frame/per-batch trace. The
 * result is re-parsed through the versioned schema before it is returned
 * (fail-loud on any construction bug).
 */
export function buildLatencyReport(inputs: ReportInputs): LatencyBenchmarkReport {
  const { trace, result, emittedManifestFrames, clockStartMs, clockEndMs, pipeline } = inputs;
  const stats: LatencyStageStats = computeStageStats(trace);
  const accounting: LatencyAccounting = buildAccounting(trace, result, emittedManifestFrames);
  const report = {
    reportSchema: REPORT_SCHEMA_TAG,
    benchmark: {
      benchmarkId: `w306-latency-${trace.fixture.profileId}`,
      clockDomain: "injected-virtual" as const,
      clockStartMs,
      clockEndMs,
      percentileMethod: "nearest-rank" as const,
      driver: { settleQuantaPerArrival: SETTLE_QUANTA_PER_ARRIVAL },
      fixture: { ...trace.fixture },
      pipeline: {
        renderDurationMs: pipeline.renderDurationMs,
        batchIntervalMs: pipeline.batchIntervalMs,
        maxUpdatesPerBatch: pipeline.maxUpdatesPerBatch,
        maxQueuedBatches: pipeline.maxQueuedBatches,
        maxQueuedBatchBytes: pipeline.maxQueuedBatchBytes,
        maxReorderOutputs: pipeline.maxReorderOutputs,
        maxQueuedRenderJobs: pipeline.maxQueuedRenderJobs,
        maxAdmittedJobs: pipeline.maxAdmittedJobs,
        workers: pipeline.workers.map((worker) => ({ ...worker })),
        backpressure: pipeline.backpressure,
        degradation:
          pipeline.degradation.kind === "disabled"
            ? { kind: "disabled" as const }
            : {
                kind: "skip-stale" as const,
                maxWatermarkLagMs: pipeline.degradation.maxWatermarkLagMs,
              },
      },
      orchestratorOutcome: trace.orchestratorOutcome,
    },
    stages: {
      batch: stats.batchStages,
      frame: stats.frameStages,
      sourceModel: { ...stats.sourceModel, authoredNotMeasured: true as const },
    },
    stageDefinitions: { ...STAGE_DEFINITIONS },
    accounting: {
      orchestratorStats: { ...accounting.orchestratorStats },
      frames: { ...accounting.frames },
    },
    trace: {
      frames: trace.frames.map((frame) => ({ ...frame })),
      batches: trace.batches.map((batch) => ({
        ...batch,
        sequences: [...batch.sequences],
        windowMs: { ...batch.windowMs },
        stageMs: { ...batch.stageMs },
        jobTiming: batch.jobTiming === null ? null : { ...batch.jobTiming },
      })),
    },
  };
  // Validate our own construction (never trust the builder).
  return parseLatencyReport(report);
}

/**
 * Canonicalizes a JSON value: object keys sorted recursively, arrays kept in
 * order, `undefined`/`NaN`/non-finite numbers REJECTED (volatile values have
 * no canonical form). The W403 serializer semantics, local.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new LatencyReportValidationError(
        `a non-finite number (${String(value)}) has no canonical form — the report is volatile/invalid`,
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry !== undefined) {
      sorted[key] = canonicalize(entry);
    }
  }
  return sorted;
}

/** Serializes a report into its canonical bytes (sorted keys, 2-space, newline). */
export function serializeLatencyReport(report: LatencyBenchmarkReport): string {
  return `${JSON.stringify(canonicalize(report), null, 2)}\n`;
}

/** Renders the deterministic human-readable summary (no clock reads, no hostnames). */
export function renderHumanSummary(report: LatencyBenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`W306 end-to-end latency benchmark — ${report.benchmark.benchmarkId}`);
  lines.push(
    `clock domain: injected-virtual (NOT wall time) — characterizes the pipeline's algorithmic latency structure only`,
  );
  lines.push(
    `fixture: ${report.benchmark.fixture.profileId} v${String(report.benchmark.fixture.profileVersion)} ` +
      `(seed ${report.benchmark.fixture.seed}, ${String(report.benchmark.fixture.seconds)}s event time, ` +
      `${String(report.benchmark.fixture.updateCount)} updates)`,
  );
  const degradationText =
    report.benchmark.pipeline.degradation.kind === "disabled"
      ? "disabled"
      : `skip-stale(lag ${String(report.benchmark.pipeline.degradation.maxWatermarkLagMs)}ms)`;
  lines.push(
    `pipeline: render ${String(report.benchmark.pipeline.renderDurationMs)}ms, ` +
      `batch interval ${String(report.benchmark.pipeline.batchIntervalMs)}ms, ` +
      `max ${String(report.benchmark.pipeline.maxUpdatesPerBatch)} updates/batch, ` +
      `${report.benchmark.pipeline.workers.map((w) => `${w.workerId}(${String(w.maxConcurrentJobs)})`).join(", ")}, ` +
      `backpressure ${report.benchmark.pipeline.backpressure}, degradation ${degradationText}`,
  );
  lines.push(`orchestrator outcome: ${report.benchmark.orchestratorOutcome}`);
  lines.push("");
  lines.push("stage latencies (nearest-rank, injected-clock ms):");
  lines.push("  batch stages:");
  for (const [key, stats] of Object.entries(report.stages.batch)) {
    lines.push(
      `    ${key.padEnd(18)} n=${String(stats.count).padStart(3)}  p50=${String(stats.p50Ms).padStart(7)}  p95=${String(stats.p95Ms).padStart(7)}  max=${String(stats.maxMs).padStart(7)}`,
    );
  }
  lines.push("  frame stages:");
  for (const [key, stats] of Object.entries(report.stages.frame)) {
    lines.push(
      `    ${key.padEnd(18)} n=${String(stats.count).padStart(3)}  p50=${String(stats.p50Ms).padStart(7)}  p95=${String(stats.p95Ms).padStart(7)}  max=${String(stats.maxMs).padStart(7)}`,
    );
  }
  lines.push(
    `  source model (AUTHORED, not measured): world-model update derive ` +
      `p50=${String(report.stages.sourceModel.worldModelUpdateDeriveMs.p50Ms)}ms ` +
      `p95=${String(report.stages.sourceModel.worldModelUpdateDeriveMs.p95Ms)}ms`,
  );
  lines.push("");
  const frames = report.accounting.frames;
  lines.push("never-silent accounting (balanced):");
  lines.push(
    `  frames in ${String(frames.framesIn)} = emitted ${String(frames.framesEmitted)}` +
      ` + skipped-stale ${String(frames.framesSkippedStale)}` +
      ` + dropped ${String(frames.framesDropped)}` +
      ` + cancelled ${String(frames.framesCancelled)}` +
      ` + duplicate ${String(frames.framesDuplicate)}`,
  );
  lines.push(
    `  batches in ${String(report.accounting.orchestratorStats.batchesIn)}, ` +
      `rendered ${String(report.accounting.orchestratorStats.batchesRendered)}, ` +
      `splits ${String(report.accounting.orchestratorStats.batchSplits)}, ` +
      `peak-in-system ${String(report.accounting.orchestratorStats.peakBatchesInSystem)}`,
  );
  lines.push(
    `  emitted manifest frames ${String(frames.emittedManifestFrames)} === emitted frames ${String(frames.framesEmitted)}`,
  );
  return lines.join("\n");
}

/**
 * The benchmark's default pipeline configuration (the single place the W306
 * render-model lives; echoed into the report verbatim). The render duration
 * is the AUTHORED model of one real W502 anime render's cost on the injected
 * clock — the benchmark's queueing structure depends on it, which is exactly
 * why it is recorded in every report.
 */
const BENCHMARK_PIPELINE_DEGRADATION: BenchmarkDegradation = { kind: "disabled" };

export const BENCHMARK_PIPELINE: BenchmarkPipelineConfig = Object.freeze({
  renderDurationMs: 400,
  batchIntervalMs: 1_000,
  maxUpdatesPerBatch: 3,
  maxQueuedBatches: 8,
  maxQueuedBatchBytes: 0,
  maxReorderOutputs: 16,
  maxQueuedRenderJobs: 64,
  maxAdmittedJobs: 1_000_000,
  workers: [{ workerId: "render-worker-0", maxConcurrentJobs: 2 }],
  backpressure: "block",
  degradation: BENCHMARK_PIPELINE_DEGRADATION,
});
