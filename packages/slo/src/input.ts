/**
 * The W802 latency-SLO evaluation input: the structural projection of a W306
 * latency-benchmark report (`sporta/latency-benchmark/report@1`) onto exactly
 * what the SLO machinery consumes.
 *
 * ## Why a structural projection, not a dependency
 *
 * `@sporta/slo` has NO runtime dependency on `@sporta/latency-benchmark`: the
 * input schema below is the strict, versioned shape of the evidence subset
 * (stage percentile tables + the frame accounting + the domain/pipeline
 * identity), and a W306 report satisfies it STRUCTURALLY — the projector
 * {@link projectBenchmarkReport} is typed against a local structural subset
 * (`LatencyBenchmarkReportSubset`) and pinned by tests that run the REAL
 * benchmark (dev dependency) and feed its real report through. This keeps the
 * package's runtime dependency set at exactly `zod` (the @sporta/contracts
 * precedent; @sporta/observability keeps the same zero-runtime-dep posture),
 * so W805 dashboards can consume alert definitions without dragging the
 * whole real-pipeline benchmark graph.
 *
 * ## The honest scope of every number that enters here
 *
 * All latencies are readings of the ONE injected virtual clock the benchmark
 * pipeline shares (the W306 boundary, verbatim): they characterize the
 * pipeline's ALGORITHMIC latency structure on the controlled fixture, never
 * wall-clock or real-network latency. The schema pins the domain literals
 * (`clockDomain: "injected-virtual"`, `percentileMethod: "nearest-rank"`) —
 * a document from any other domain fails loud, never partially accepted.
 */
import { z } from "zod";
import { SloInputValidationError } from "./errors";

/** Canonical latency-SLO-input schema tag (bump on any input shape change). */
export const LATENCY_SLO_INPUT_SCHEMA_TAG = "sporta/slo/input@1";

/**
 * The batch-stage vocabulary — the W306 benchmark's `BATCH_STAGE_KEYS`,
 * mirrored locally (no runtime dep; pinned against the real export by
 * `test/slos.test.ts` and against the real report by
 * `test/benchmark-integration.test.ts`).
 */
export const BATCH_STAGE_KEYS = [
  "swm-to-batch",
  "batch-queue",
  "w303-schedule",
  "render-execution",
  "finish-to-emit",
  "end-to-end",
] as const;

/** The frame-stage vocabulary — the W306 benchmark's `FRAME_STAGE_KEYS`. */
export const FRAME_STAGE_KEYS = ["swm-store-sojourn", "end-to-end"] as const;

export type BatchStageKey = (typeof BATCH_STAGE_KEYS)[number];
export type FrameStageKey = (typeof FRAME_STAGE_KEYS)[number];

const nonNegativeInt = z.number().int().min(0);
const nonNegativeNumber = z.number().finite().min(0);
const nonEmptyString = z.string().min(1);

/** One stage's percentile summary (the benchmark's `LatencyStats`, verbatim shape). */
const latencyStatsSchema = z.strictObject({
  count: nonNegativeInt,
  minMs: nonNegativeNumber,
  maxMs: nonNegativeNumber,
  p50Ms: nonNegativeNumber,
  p95Ms: nonNegativeNumber,
});

const batchStageKeySchema = z.enum(BATCH_STAGE_KEYS);
const frameStageKeySchema = z.enum(FRAME_STAGE_KEYS);

const degradationSchema = z.union([
  z.strictObject({ kind: z.literal("disabled") }),
  z.strictObject({ kind: z.literal("skip-stale"), maxWatermarkLagMs: nonNegativeNumber }),
]);

const backpressureSchema = z.enum(["block", "reject", "drop-oldest"]);

const latencySloInputSchema = z.strictObject({
  inputSchema: z.literal(LATENCY_SLO_INPUT_SCHEMA_TAG),
  domain: z.strictObject({
    clockDomain: z.literal("injected-virtual"),
    percentileMethod: z.literal("nearest-rank"),
    fixtureProfileId: nonEmptyString,
    fixtureProfileVersion: nonNegativeInt,
    fixtureSeed: nonEmptyString,
  }),
  pipeline: z.strictObject({
    backpressure: backpressureSchema,
    degradation: degradationSchema,
  }),
  stages: z.strictObject({
    batch: z.record(batchStageKeySchema, latencyStatsSchema),
    frame: z.record(frameStageKeySchema, latencyStatsSchema),
  }),
  accounting: z.strictObject({
    frames: z.strictObject({
      framesIn: nonNegativeInt,
      framesEmitted: nonNegativeInt,
      framesSkippedStale: nonNegativeInt,
      framesDropped: nonNegativeInt,
      framesCancelled: nonNegativeInt,
      framesDuplicate: nonNegativeInt,
    }),
  }),
});

/** The parsed, validated latency-SLO input document. */
export type LatencySloInput = z.infer<typeof latencySloInputSchema>;

/**
 * Parses + validates a latency-SLO input document. Fail-loud: any zod issue
 * (unknown key, wrong type, negative latency, missing stage — the record
 * schemas are exhaustive over the stage vocabularies) becomes an
 * {@link SloInputValidationError} carrying the rendered issue list with JSON
 * paths — never a partial parse.
 */
export function parseLatencySloInput(value: unknown): LatencySloInput {
  const outcome = latencySloInputSchema.safeParse(value);
  if (!outcome.success) {
    const issues = outcome.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new SloInputValidationError(issues);
  }
  // Cross-consistency beyond the static shape: the frame accounting must
  // balance — the never-silent rule extends to the SLO consumer (the W306
  // parser applies the identical identity; re-checking keeps a hand-built
  // input honest).
  const frames = outcome.data.accounting.frames;
  if (
    frames.framesIn !==
    frames.framesEmitted +
      frames.framesSkippedStale +
      frames.framesDropped +
      frames.framesCancelled +
      frames.framesDuplicate
  ) {
    throw new SloInputValidationError(
      "accounting.frames does not balance " +
        "(framesIn !== emitted + skippedStale + dropped + cancelled + duplicate)",
    );
  }
  return outcome.data;
}

/**
 * The structural subset of a `sporta/latency-benchmark/report@1` document the
 * projector reads (field names/types are the report's, verbatim — the
 * full report is a structural superset; the pin tests feed the REAL report).
 */
export interface LatencyBenchmarkReportSubset {
  readonly benchmark: {
    readonly clockDomain: "injected-virtual";
    readonly percentileMethod: "nearest-rank";
    readonly fixture: {
      readonly profileId: string;
      readonly profileVersion: number;
      readonly seed: string;
    };
    readonly pipeline: {
      readonly backpressure: "block" | "reject" | "drop-oldest";
      readonly degradation:
        | { readonly kind: "disabled" }
        | { readonly kind: "skip-stale"; readonly maxWatermarkLagMs: number };
    };
  };
  readonly stages: {
    readonly batch: Readonly<Record<BatchStageKey, LatencyStatsSubset>>;
    readonly frame: Readonly<Record<FrameStageKey, LatencyStatsSubset>>;
  };
  readonly accounting: {
    readonly frames: {
      readonly framesIn: number;
      readonly framesEmitted: number;
      readonly framesSkippedStale: number;
      readonly framesDropped: number;
      readonly framesCancelled: number;
      readonly framesDuplicate: number;
    };
  };
}

/** One stage's percentile summary (the structural report shape). */
export interface LatencyStatsSubset {
  readonly count: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

/**
 * Projects a W306 latency-benchmark report (or its structural subset) onto
 * the SLO evaluation input. Pure: picks the evidence fields verbatim, adds
 * the versioned input tag, drops everything else (traces, orchestrator
 * counters, clock readings — the SLO machinery reads exactly what the schema
 * declares, nothing more).
 */
export function projectBenchmarkReport(report: LatencyBenchmarkReportSubset): LatencySloInput {
  return {
    inputSchema: LATENCY_SLO_INPUT_SCHEMA_TAG,
    domain: {
      clockDomain: report.benchmark.clockDomain,
      percentileMethod: report.benchmark.percentileMethod,
      fixtureProfileId: report.benchmark.fixture.profileId,
      fixtureProfileVersion: report.benchmark.fixture.profileVersion,
      fixtureSeed: report.benchmark.fixture.seed,
    },
    pipeline: {
      backpressure: report.benchmark.pipeline.backpressure,
      degradation: report.benchmark.pipeline.degradation,
    },
    stages: {
      batch: {
        "swm-to-batch": report.stages.batch["swm-to-batch"],
        "batch-queue": report.stages.batch["batch-queue"],
        "w303-schedule": report.stages.batch["w303-schedule"],
        "render-execution": report.stages.batch["render-execution"],
        "finish-to-emit": report.stages.batch["finish-to-emit"],
        "end-to-end": report.stages.batch["end-to-end"],
      },
      frame: {
        "swm-store-sojourn": report.stages.frame["swm-store-sojourn"],
        "end-to-end": report.stages.frame["end-to-end"],
      },
    },
    accounting: {
      frames: {
        framesIn: report.accounting.frames.framesIn,
        framesEmitted: report.accounting.frames.framesEmitted,
        framesSkippedStale: report.accounting.frames.framesSkippedStale,
        framesDropped: report.accounting.frames.framesDropped,
        framesCancelled: report.accounting.frames.framesCancelled,
        framesDuplicate: report.accounting.frames.framesDuplicate,
      },
    },
  };
}
