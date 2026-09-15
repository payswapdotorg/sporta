/**
 * The W306 machine-readable report schema (zod v4, the @sporta/contracts
 * precedent — zod is the repo's allowed runtime validation dependency).
 *
 * The report shape is VERSIONED by {@link REPORT_SCHEMA_TAG}: any change to
 * the shape bumps the tag (an old report fails loud on parse, never partially
 * accepted). `parseLatencyReport` is the fail-loud entry: unknown keys,
 * wrong types, negative latencies, non-monotonic boundaries, unknown stage
 * keys, and unbalanced accounting all throw
 * `LatencyReportValidationError` (the zod issues included) — the
 * machine-readable report is VALIDATED, never trusted.
 */
import { z } from "zod";
import { LatencyReportValidationError } from "./errors";

/** Canonical latency-report schema tag (bump on any report shape change). */
export const REPORT_SCHEMA_TAG = "sporta/latency-benchmark/report@1";

const nonNegativeInt = z.number().int().min(0);
const nonNegativeNumber = z.number().finite().min(0);
const nonEmptyString = z.string().min(1);

const latencyStatsSchema = z.strictObject({
  count: nonNegativeInt,
  minMs: nonNegativeNumber,
  maxMs: nonNegativeNumber,
  p50Ms: nonNegativeNumber,
  p95Ms: nonNegativeNumber,
});

const batchStageKeySchema = z.enum([
  "swm-to-batch",
  "batch-queue",
  "w303-schedule",
  "render-execution",
  "finish-to-emit",
  "end-to-end",
]);
const frameStageKeySchema = z.enum(["swm-store-sojourn", "end-to-end"]);

const jobTimingSchema = z.strictObject({
  submittedAtMs: nonNegativeNumber,
  startedAtMs: nonNegativeNumber.optional(),
  finishedAtMs: nonNegativeNumber,
  queueWaitMs: nonNegativeNumber.optional(),
  executionMs: nonNegativeNumber,
});

const batchTraceRowSchema = z.strictObject({
  batchId: nonEmptyString,
  ordinal: nonNegativeInt,
  sequences: z.array(nonNegativeInt).min(1),
  watermarkMs: nonNegativeNumber,
  windowMs: z.strictObject({ startMs: nonNegativeNumber, endMs: nonNegativeNumber }),
  closedBy: z.enum(["watermark-boundary", "size-limit", "stream-complete"]),
  disposition: z.enum(["rendered", "skipped-stale", "dropped", "cancelled", "duplicate"]),
  dropReason: z.string().nullable(),
  executorInvocations: nonNegativeInt,
  visibleFirstAtMs: nonNegativeNumber,
  visibleLastAtMs: nonNegativeNumber,
  cutAtMs: nonNegativeNumber.nullable(),
  executorEntryAtMs: nonNegativeNumber.nullable(),
  executorExitAtMs: nonNegativeNumber.nullable(),
  emittedAtMs: nonNegativeNumber.nullable(),
  jobTiming: jobTimingSchema.nullable(),
  stageMs: z.strictObject({
    "swm-to-batch": nonNegativeNumber.nullable(),
    "batch-queue": nonNegativeNumber.nullable(),
    "w303-schedule": nonNegativeNumber.nullable(),
    "render-execution": nonNegativeNumber.nullable(),
    "finish-to-emit": nonNegativeNumber.nullable(),
    "end-to-end": nonNegativeNumber.nullable(),
  }),
});

const frameTraceRowSchema = z.strictObject({
  sequence: nonNegativeInt,
  batchId: nonEmptyString,
  observedAtMs: nonNegativeNumber,
  visibleAtMs: nonNegativeNumber,
  deriveMs: nonNegativeNumber,
  firstQueriedAtMs: nonNegativeNumber.nullable(),
  emittedAtMs: nonNegativeNumber.nullable(),
  swmStoreSojournMs: nonNegativeNumber.nullable(),
  endToEndMs: nonNegativeNumber.nullable(),
});

/**
 * The W304 `RenderOrchestrationStats`, VERBATIM (every counter the settled
 * orchestrator reports — a stats-field addition in W304 must be mirrored
 * here consciously, bumping the report tag).
 */
const orchestratorStatsSchema = z.strictObject({
  batchesIn: nonNegativeInt,
  batchesRendered: nonNegativeInt,
  batchesSkippedStale: nonNegativeInt,
  batchesDropped: nonNegativeInt,
  batchesCancelled: nonNegativeInt,
  batchesDuplicateSkips: nonNegativeInt,
  batchesInFlight: nonNegativeInt,
  batchesSkippedStaleAtAdmission: nonNegativeInt,
  batchesSkippedStaleInQueue: nonNegativeInt,
  batchesDuplicateSkipsAtConsume: nonNegativeInt,
  batchesDuplicateSubmits: nonNegativeInt,
  batchSplits: nonNegativeInt,
  batchesQueueEvicted: nonNegativeInt,
  batchesQueueRefused: nonNegativeInt,
  batchesAbandoned: nonNegativeInt,
  batchesRenderQueueRefused: nonNegativeInt,
  batchesRenderFailed: nonNegativeInt,
  batchesReorderOverflow: nonNegativeInt,
  batchesRenderOutputInvalid: nonNegativeInt,
  batchesSentToQueue: nonNegativeInt,
  batchesReceivedFromQueue: nonNegativeInt,
  queuedNow: nonNegativeInt,
  batchesCancelledInQueue: nonNegativeInt,
  batchesRenderCancelled: nonNegativeInt,
  renderJobsSubmitted: nonNegativeInt,
  renderJobsDuplicate: nonNegativeInt,
  renderJobsInFlight: nonNegativeInt,
  consumerSendParkAttempts: nonNegativeInt,
  outputsEmitted: nonNegativeInt,
  checkpointsCut: nonNegativeInt,
  peakBatchesInSystem: nonNegativeInt,
  peakQueuedNow: nonNegativeInt,
  peakReorderSize: nonNegativeInt,
  maxEmissionLagMs: nonNegativeNumber,
});

const reportSchema = z.strictObject({
  reportSchema: z.literal(REPORT_SCHEMA_TAG),
  benchmark: z.strictObject({
    benchmarkId: nonEmptyString,
    clockDomain: z.literal("injected-virtual"),
    clockStartMs: nonNegativeNumber,
    clockEndMs: nonNegativeNumber,
    percentileMethod: z.literal("nearest-rank"),
    driver: z.strictObject({
      /** The interleaving model (see `driveLiveSource`): pipeline microtask quanta granted after each authored arrival. */
      settleQuantaPerArrival: z.number().int().min(1),
    }),
    fixture: z.strictObject({
      profileId: nonEmptyString,
      profileVersion: nonNegativeInt,
      seed: nonEmptyString,
      seconds: nonNegativeInt,
      updateCount: nonNegativeInt,
      burstEventFromMs: nonNegativeNumber,
      burstEventToMs: nonNegativeNumber,
    }),
    pipeline: z.strictObject({
      renderDurationMs: nonNegativeNumber,
      batchIntervalMs: nonNegativeNumber,
      maxUpdatesPerBatch: nonNegativeInt,
      maxQueuedBatches: nonNegativeInt,
      maxQueuedBatchBytes: nonNegativeInt,
      maxReorderOutputs: nonNegativeInt,
      maxQueuedRenderJobs: nonNegativeInt,
      maxAdmittedJobs: nonNegativeInt,
      workers: z
        .array(z.strictObject({ workerId: nonEmptyString, maxConcurrentJobs: nonNegativeInt }))
        .min(1),
      backpressure: z.enum(["block", "reject", "drop-oldest"]),
      degradation: z.union([
        z.strictObject({ kind: z.literal("disabled") }),
        z.strictObject({ kind: z.literal("skip-stale"), maxWatermarkLagMs: nonNegativeNumber }),
      ]),
    }),
    orchestratorOutcome: z.enum(["completed", "stopped", "cancelled", "failed"]),
  }),
  stages: z.strictObject({
    batch: z.record(batchStageKeySchema, latencyStatsSchema),
    frame: z.record(frameStageKeySchema, latencyStatsSchema),
    sourceModel: z.strictObject({
      worldModelUpdateDeriveMs: latencyStatsSchema,
      authoredNotMeasured: z.literal(true),
    }),
  }),
  stageDefinitions: z.record(z.string().min(1), nonEmptyString),
  accounting: z.strictObject({
    orchestratorStats: orchestratorStatsSchema,
    frames: z.strictObject({
      framesIn: nonNegativeInt,
      framesEmitted: nonNegativeInt,
      framesSkippedStale: nonNegativeInt,
      framesDropped: nonNegativeInt,
      framesCancelled: nonNegativeInt,
      framesDuplicate: nonNegativeInt,
      dropReasons: z.record(z.string().min(1), nonNegativeInt),
      emittedManifestFrames: nonNegativeInt,
      balanced: z.literal(true),
    }),
  }),
  trace: z.strictObject({
    frames: z.array(frameTraceRowSchema),
    batches: z.array(batchTraceRowSchema),
  }),
});

/** The parsed report document (the zod-inferred shape). */
export type LatencyBenchmarkReport = z.infer<typeof reportSchema>;

/**
 * Parses + validates a latency report document. Fail-loud: any zod issue
 * becomes a {@link LatencyReportValidationError} carrying the rendered issue
 * list (JSON paths included) — never a partial parse.
 */
export function parseLatencyReport(value: unknown): LatencyBenchmarkReport {
  const outcome = reportSchema.safeParse(value);
  if (!outcome.success) {
    const issues = outcome.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new LatencyReportValidationError(issues);
  }
  // Cross-consistency beyond the static shape: the frame identity must hold
  // inside the parsed document (the never-silent rule extends to consumers
  // reading a report from disk).
  const report = outcome.data;
  const frames = report.accounting.frames;
  if (
    frames.framesIn !==
    frames.framesEmitted +
      frames.framesSkippedStale +
      frames.framesDropped +
      frames.framesCancelled +
      frames.framesDuplicate
  ) {
    throw new LatencyReportValidationError(
      "accounting.frames does not balance (framesIn !== emitted + skippedStale + dropped + cancelled + duplicate)",
    );
  }
  if (report.trace.frames.length !== frames.framesIn) {
    throw new LatencyReportValidationError(
      "trace.frames length does not equal accounting.frames.framesIn",
    );
  }
  if (report.trace.batches.length !== report.accounting.orchestratorStats.batchesIn) {
    throw new LatencyReportValidationError(
      "trace.batches length does not equal accounting.orchestratorStats.batchesIn",
    );
  }
  if (report.benchmark.clockEndMs < report.benchmark.clockStartMs) {
    throw new LatencyReportValidationError("benchmark clock readings are non-monotonic");
  }
  return report;
}
