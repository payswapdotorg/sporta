/**
 * Technology Evaluation Plane contracts — Wave-0 freeze (ADR-009,
 * docs/architecture/technology-plane.md Benchmark contract).
 *
 * Candidates are evaluated on the SAME frozen fixture set, producing
 * machine-readable {@link BenchmarkRun} records; {@link EvaluationReport}
 * compares runs; {@link PromotionRecord} is the auditable decision trail for
 * every lifecycle transition (R005: "production profile changes are
 * auditable").
 *
 * Honesty rules encoded here:
 * - `costEstimateUsd: null` means "not measurable for this run" — never a
 *   fabricated zero.
 * - `reproducibility.deterministic` must be backed by at least one rerun
 *   (`rerunDeltaPct` present) before a promotion may rely on it.
 * - A promotion record MUST cite its evidence (evaluation report id +
 *   benchmark run ids) — no evidence, no promotion.
 */
import { z } from "zod";
import { schemaVersionField } from "./versioning";
import { AdapterTaskKind, TechnologyStatus } from "./technology";

/** One candidate technology executed against a frozen fixture set. */
export const BenchmarkRun = z.object({
  schemaVersion: schemaVersionField,
  runId: z.string().min(1),
  technologyId: z.string().min(1),
  technologyVersion: z.string().min(1),
  adapterVersion: z.string().min(1),
  task: AdapterTaskKind,
  /** The frozen fixture-set version this run is comparable against. */
  fixtureSetVersion: z.string().min(1),
  startedAtMs: z.number().int().min(0),
  completedAtMs: z.number().int().min(0),
  /** Task-specific metric values (metric id -> value). Higher/lower is metric-defined. */
  metrics: z.record(z.string(), z.number()),
  /** Measured resource usage (e.g. gpuSeconds, cpuMs, peakVramGb). */
  resourceUsage: z.record(z.string(), z.number()),
  /** Wall-clock runtime in seconds. */
  runtimeSeconds: z.number().positive(),
  /** Estimated cost in USD, or `null` when the run cannot be metered honestly. */
  costEstimateUsd: z.number().min(0).nullable(),
  /** Counted failures + at least one example per class when failures > 0. */
  failureSummary: z.object({
    failures: z.number().int().min(0),
    failureExamples: z.array(z.string().min(1)),
  }),
  reproducibility: z.object({
    deterministic: z.boolean(),
    /** Observed metric delta across a rerun, in percent, when one was performed. */
    rerunDeltaPct: z.number().min(0).optional(),
    /** The seed/pin used, when the run is seeded. */
    seed: z.string().min(1).optional(),
  }),
  /** License check outcome for THIS run's artifacts. */
  licenseCheck: z.enum(["pass", "fail", "not-applicable"]),
  /** References to raw result artifacts (never inline payloads). */
  artifactRefs: z.array(z.string().min(1)),
});
export type BenchmarkRun = z.infer<typeof BenchmarkRun>;

/** The comparison verdict an evaluation report may recommend. */
export const EvaluationRecommendation = z.enum(["promote", "hold", "reject"]);
export type EvaluationRecommendation = z.infer<typeof EvaluationRecommendation>;

/**
 * A comparison of candidate runs on the SAME fixture set, ending in at most
 * one recommendation. Machine-readable summary + the human rationale.
 */
export const EvaluationReport = z.object({
  schemaVersion: schemaVersionField,
  reportId: z.string().min(1),
  fixtureSetVersion: z.string().min(1),
  /** The benchmark runs compared (all must share the fixture set version). */
  benchmarkRunIds: z.array(z.string().min(1)).min(1),
  /** Machine-readable comparison values (candidate key -> metric -> value). */
  comparison: z.record(z.string(), z.record(z.string(), z.number())),
  recommendation: EvaluationRecommendation,
  /** The candidate key the report recommends acting on, when promoting. */
  recommendedCandidate: z.string().min(1).optional(),
  /** Human rationale citing the comparison. */
  rationale: z.string().min(1),
  decidedAtMs: z.number().int().min(0),
});
export type EvaluationReport = z.infer<typeof EvaluationReport>;

/** The auditable record of one lifecycle transition decision (R005). */
export const PromotionRecord = z.object({
  schemaVersion: schemaVersionField,
  promotionId: z.string().min(1),
  technologyId: z.string().min(1),
  technologyVersion: z.string().min(1),
  adapterVersion: z.string().min(1),
  task: AdapterTaskKind,
  fromStatus: TechnologyStatus,
  toStatus: TechnologyStatus,
  decidedAtMs: z.number().int().min(0),
  /** Actor id — the deciding principal (human or service), never blank. */
  decidedBy: z.string().min(1),
  /** The evidence chain: evaluation report + the runs it cites. */
  evidence: z.object({
    evaluationReportId: z.string().min(1),
    benchmarkRunIds: z.array(z.string().min(1)).min(1),
    /** License/security review reference (required for approved+ transitions). */
    licenseReviewRef: z.string().min(1).optional(),
  }),
  rationale: z.string().min(1),
});
export type PromotionRecord = z.infer<typeof PromotionRecord>;

/**
 * Evidence requirements per transition (the promotion pipeline's
 * fail-closed gates):
 * - `candidate -> benchmarked`: at least one run id (a benchmark exists);
 * - `benchmarked -> approved`: a license review reference is REQUIRED
 *   (ADR-009 promotion lifecycle: benchmark, then license/security review);
 * - any transition toward `production`: license review REQUIRED.
 * Rejections/deprecations need only the rationale (documented exits).
 */
export function missingPromotionEvidence(record: PromotionRecord): string[] {
  const missing: string[] = [];
  if (record.evidence.benchmarkRunIds.length === 0) {
    missing.push("at least one benchmark run id");
  }
  const towardApproved = record.toStatus === "approved";
  const towardProduction = record.toStatus === "canary" || record.toStatus === "production";
  if ((towardApproved || towardProduction) && !record.evidence.licenseReviewRef) {
    missing.push("license review reference");
  }
  return missing;
}
