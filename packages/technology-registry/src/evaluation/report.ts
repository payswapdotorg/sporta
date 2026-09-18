/**
 * Evaluation-report construction and comparison (R003): turns one or more
 * frozen `BenchmarkRun` records that share a fixture-set version into a
 * machine-readable `EvaluationReport` — the comparison record keyed by
 * candidate plus a `promote | hold | reject` recommendation with a rationale
 * that cites the numbers.
 *
 * Two entry points:
 *
 * - {@link buildEvaluationReport}: the HUMAN path — the caller states the
 *   recommendation + rationale; this validates coherence (one fixture-set
 *   version, one run per candidate, promote ⇔ recommended candidate, the
 *   recommended candidate must be among the compared runs) and mechanically
 *   assembles the comparison record.
 * - {@link recommendFromRuns}: the POLICY path — a deterministic, documented
 *   comparison policy produces the recommendation (see
 *   {@link ComparisonPolicy}) so machine consumers get a reproducible
 *   verdict, never a vibes-based one.
 */
import { EvaluationReport } from "@sporta/contracts";
import type {
  BenchmarkRun as BenchmarkRunDoc,
  EvaluationRecommendation as EvaluationRecommendationType,
} from "@sporta/contracts";
import { EvaluationValidationError } from "../errors";
import { metricDeltaPct } from "./runner";

/** The stable comparison key of a run: `technologyId@version+adapterVersion`. */
export function candidateKeyOf(run: {
  technologyId: string;
  technologyVersion: string;
  adapterVersion: string;
}): string {
  return `${run.technologyId}@${run.technologyVersion}+${run.adapterVersion}`;
}

/**
 * The machine-readable comparison row for one run: its metrics plus the
 * benchmark meta-values (`benchmark.*`), so consumers can rank on quality
 * AND cost/runtime/failures without re-reading the raw runs.
 */
function comparisonRowFor(run: BenchmarkRunDoc): Record<string, number> {
  const row: Record<string, number> = { ...run.metrics };
  row["benchmark.failures"] = run.failureSummary.failures;
  row["benchmark.runtimeSeconds"] = run.runtimeSeconds;
  if (run.costEstimateUsd !== null) {
    row["benchmark.costEstimateUsd"] = run.costEstimateUsd;
  }
  return row;
}

/** Parameters for the human-path report builder. */
export interface BuildEvaluationReportParams {
  reportId: string;
  runs: BenchmarkRunDoc[];
  recommendation: EvaluationRecommendationType;
  /** Required iff the recommendation is `promote`; must match a compared run. */
  recommendedCandidate?: string;
  /** The human rationale, citing the comparison. */
  rationale: string;
  decidedAtMs: number;
}

/** Shared coherence validation over the compared runs. */
function assertComparableRuns(runs: BenchmarkRunDoc[], reportId: string): void {
  if (runs.length === 0) {
    throw new EvaluationValidationError(
      `evaluation report '${reportId}': at least one benchmark run is required`,
    );
  }
  const fixtureSetVersion = runs[0]!.fixtureSetVersion;
  const keys = new Set<string>();
  for (const run of runs) {
    if (run.fixtureSetVersion !== fixtureSetVersion) {
      throw new EvaluationValidationError(
        `evaluation report '${reportId}': runs must share one fixture-set version ` +
          `(run '${run.runId}' uses '${run.fixtureSetVersion}', expected '${fixtureSetVersion}')`,
      );
    }
    const key = candidateKeyOf(run);
    if (keys.has(key)) {
      throw new EvaluationValidationError(
        `evaluation report '${reportId}': multiple runs for candidate '${key}' ` +
          `(compare ONE run per candidate — e.g. the rerun-verified one)`,
      );
    }
    keys.add(key);
  }
}

/**
 * Build (and validate) an evaluation report from compared runs. The
 * recommendation is the caller's; coherence is enforced fail-closed:
 * `promote` requires a `recommendedCandidate` matching one of the runs, and
 * a named candidate is meaningless with `hold`/`reject`.
 */
export function buildEvaluationReport(params: BuildEvaluationReportParams): EvaluationReport {
  assertComparableRuns(params.runs, params.reportId);

  const issues: string[] = [];
  if (params.recommendation === "promote" && params.recommendedCandidate === undefined) {
    issues.push("a 'promote' recommendation must name its recommendedCandidate");
  }
  if (params.recommendation !== "promote" && params.recommendedCandidate !== undefined) {
    issues.push(
      `recommendedCandidate is only meaningful for a 'promote' recommendation ` +
        `(got '${params.recommendation}')`,
    );
  }

  const comparison: Record<string, Record<string, number>> = {};
  for (const run of params.runs) {
    comparison[candidateKeyOf(run)] = comparisonRowFor(run);
  }
  if (params.recommendedCandidate !== undefined && !(params.recommendedCandidate in comparison)) {
    issues.push(
      `recommendedCandidate '${params.recommendedCandidate}' does not match any compared run`,
    );
  }
  if (issues.length > 0) {
    throw new EvaluationValidationError(
      `evaluation report '${params.reportId}' is incoherent: ${issues.join("; ")}`,
      issues,
    );
  }

  const report: EvaluationReport = {
    schemaVersion: "1.1",
    reportId: params.reportId,
    fixtureSetVersion: params.runs[0]!.fixtureSetVersion,
    benchmarkRunIds: params.runs.map((run) => run.runId),
    comparison,
    recommendation: params.recommendation,
    ...(params.recommendedCandidate !== undefined
      ? { recommendedCandidate: params.recommendedCandidate }
      : {}),
    rationale: params.rationale,
    decidedAtMs: params.decidedAtMs,
  };
  return EvaluationReport.parse(report);
}

/**
 * A deterministic comparison policy: how to turn the runs' metric rows into
 * a recommendation. Fail-closed defaults: `maxFailures` is 0 (a candidate
 * that failed ANY fixture is not promotable unless the caller explicitly
 * relaxes the gate) and `minLeadPct` is 0 (an exact tie never promotes).
 */
export interface ComparisonPolicy {
  /** The metric every compared run must report to be eligible. */
  primaryMetric: string;
  direction: "higher-is-better" | "lower-is-better";
  /** Minimum relative lead (percent) over the runner-up to justify promotion. */
  minLeadPct?: number;
  /** Maximum total failures an eligible run may carry (default 0). */
  maxFailures?: number;
}

/** Parameters for the policy-path recommender. */
export interface RecommendFromRunsParams {
  reportId: string;
  runs: BenchmarkRunDoc[];
  policy: ComparisonPolicy;
  decidedAtMs: number;
  /** Extra human context appended to the generated rationale. */
  rationaleNote?: string;
}

/**
 * Produce a full evaluation report from the runs under a deterministic
 * policy:
 *
 * 1. runs must be comparable (one fixture-set version, one per candidate);
 * 2. eligibility: `failures <= maxFailures` AND the primary metric present;
 *    every ineligible run is named in the rationale;
 * 3. no eligible candidate -> `reject`;
 * 4. one eligible candidate -> `promote` it (it passed the failure gate);
 * 5. several: rank by primary metric (ties broken by candidate key);
 *    promote the leader iff its lead over the runner-up is `> 0` and
 *    `>= minLeadPct`; otherwise `hold` (insufficient separation).
 */
export function recommendFromRuns(params: RecommendFromRunsParams): EvaluationReport {
  assertComparableRuns(params.runs, params.reportId);
  const { policy, reportId } = params;
  const maxFailures = policy.maxFailures ?? 0;
  const minLeadPct = policy.minLeadPct ?? 0;

  const ineligible: string[] = [];
  const eligible: BenchmarkRunDoc[] = [];
  for (const run of params.runs) {
    const key = candidateKeyOf(run);
    if (run.failureSummary.failures > maxFailures) {
      ineligible.push(
        `${key}: ${run.failureSummary.failures} failure(s) > maxFailures ${maxFailures}`,
      );
      continue;
    }
    if (!(policy.primaryMetric in run.metrics)) {
      ineligible.push(`${key}: does not report primary metric '${policy.primaryMetric}'`);
      continue;
    }
    eligible.push(run);
  }

  const comparison: Record<string, Record<string, number>> = {};
  for (const run of params.runs) {
    comparison[candidateKeyOf(run)] = comparisonRowFor(run);
  }

  const buildReport = (
    recommendation: EvaluationRecommendationType,
    rationale: string,
    recommendedCandidate?: string,
  ): EvaluationReport =>
    EvaluationReport.parse({
      schemaVersion: "1.1",
      reportId,
      fixtureSetVersion: params.runs[0]!.fixtureSetVersion,
      benchmarkRunIds: params.runs.map((run) => run.runId),
      comparison,
      recommendation,
      ...(recommendedCandidate !== undefined ? { recommendedCandidate } : {}),
      rationale,
      decidedAtMs: params.decidedAtMs,
    });

  const ineligibleNote = ineligible.length > 0 ? ` Ineligible: ${ineligible.join("; ")}.` : "";

  if (eligible.length === 0) {
    return buildReport(
      "reject",
      `no candidate is eligible under the policy (primary metric '${policy.primaryMetric}', ` +
        `maxFailures ${maxFailures}).${ineligibleNote}${params.rationaleNote ?? ""}`,
    );
  }

  if (eligible.length === 1) {
    const sole = eligible[0]!;
    return buildReport(
      "promote",
      `sole eligible candidate ${candidateKeyOf(sole)} reports ` +
        `'${policy.primaryMetric}' = ${sole.metrics[policy.primaryMetric]!} with ` +
        `${sole.failureSummary.failures} failure(s) <= maxFailures ${maxFailures}.` +
        `${ineligibleNote}${params.rationaleNote ?? ""}`,
      candidateKeyOf(sole),
    );
  }

  const sorted = [...eligible].sort((a, b) => {
    const va = a.metrics[policy.primaryMetric]!;
    const vb = b.metrics[policy.primaryMetric]!;
    const cmp = policy.direction === "higher-is-better" ? vb - va : va - vb;
    return cmp !== 0 ? cmp : candidateKeyOf(a).localeCompare(candidateKeyOf(b));
  });
  const leader = sorted[0]!;
  const runnerUp = sorted[1]!;
  const leadPct = metricDeltaPct(
    { [policy.primaryMetric]: leader.metrics[policy.primaryMetric]! },
    { [policy.primaryMetric]: runnerUp.metrics[policy.primaryMetric]! },
  );

  const leadSentence =
    `leader ${candidateKeyOf(leader)} '${policy.primaryMetric}' = ` +
    `${leader.metrics[policy.primaryMetric]!} vs runner-up ${candidateKeyOf(runnerUp)} ` +
    `${runnerUp.metrics[policy.primaryMetric]!} (lead ${leadPct.toFixed(3)}%)`;

  if (leadPct > 0 && leadPct >= minLeadPct) {
    return buildReport(
      "promote",
      `${leadSentence} >= minLeadPct ${minLeadPct}.${ineligibleNote}${params.rationaleNote ?? ""}`,
      candidateKeyOf(leader),
    );
  }
  return buildReport(
    "hold",
    `${leadSentence} does not clear minLeadPct ${minLeadPct} (exact ties never promote).` +
      `${ineligibleNote}${params.rationaleNote ?? ""}`,
  );
}
