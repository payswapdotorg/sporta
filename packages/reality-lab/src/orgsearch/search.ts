/**
 * The Organization Search driver (REL-006) — the deterministic §5→§6 search:
 * enumerate or sample the candidate space (seeded), evaluate each candidate
 * against the World Simulator through the ensemble runner, and emit an
 * IMMUTABLE `SearchResultRecord` with the REL-A3 minimum candidate metrics
 * (quality, hard-gate validity, cost, latency), the ranking, the winning
 * candidate, the mandatory baseline comparison, and full provenance.
 *
 * THE DETERMINISM CONTRACT: same (seed, config, space, evaluator, engine) ⇒
 * deep-equal search record. The record contains NO wall-clock fields at all
 * — every value is content-derived or seed-derived, so nothing needs
 * stripping. (Ensemble runs are deterministic views by construction.)
 *
 * THE MANDATORY BASELINE: every search ALWAYS evaluates the generalist
 * single-agent baseline first (contract §Required baselines; architecture
 * §5) — bounds may truncate the search AFTER it, never before it.
 *
 * THE BOUNDS (enforced, not advisory — a search that exceeds a bound STOPS
 * and records the truncation honestly):
 * - `maxCandidates`: no more than this many candidates are evaluated
 *   (baseline included);
 * - `budgetCeilingUsd`: cumulative simulated cost across ALL evaluated runs;
 *   once exceeded, no further candidate is evaluated and the overshoot is
 *   recorded;
 * - `latencyCeilingMs`: per-candidate mean simulated action latency; the
 *   candidate that breaches it is recorded (and ranked last), then the
 *   search stops.
 *
 * BOUNDARY LAW (architecture §6): the search may CHOOSE organizations and
 * parameters; it can never mutate authoritative world facts. Everything it
 * produces carries the lab-simulation provenance class — search results are
 * EVIDENCE for the registry's promotion gates, never production state.
 */
import { contentId } from "../hash";
import { LabValidationError } from "../errors";
import { LAB_SIMULATION_PROVENANCE } from "../provenance";
import type { FaultProfile } from "../domain/domain-pack";
import type { FootballDomainPack } from "../domain/football";
import type { FootballScenarioConfig } from "../domain/scenario";
import { generateFootballScenario } from "../domain/scenario";
import type { DeterministicLabRun } from "../simulation/lab-run";
import { runEnsemble } from "../robustness/ensemble";
import type { LabEvaluator } from "../evaluation/evaluator";
import { createFootballLabEvaluator } from "../evaluation/evaluator";
import type { RewardEngine } from "../reward/engine";
import { createFootballRewardEngine } from "../reward/engine";
import type {
  CandidateSpacePoint,
  MaterializedCandidate,
  OrganizationCandidateSpace,
} from "./candidates";

// ---------------------------------------------------------------------------
// The candidate metrics (REL-A3 minimum: quality, hard-gate validity, cost, latency)
// ---------------------------------------------------------------------------

/** Per-candidate metrics — the REL-A3 minimum plus the honest extras. */
export interface CandidateMetrics {
  /** Mean weighted reward aggregate over the ensemble's runs (null when nothing measurable). */
  quality: number | null;
  /** True only when EVERY ensemble run is hard-gate clean. */
  hardGateValid: boolean;
  /** Fraction of ensemble runs that were hard-gate valid. */
  validRunsFraction: number;
  /** Mean simulated cost per run (USD, simulated constants — never billing). */
  costUsd: number;
  /** Mean simulated action latency per run (ms; null when a run emitted no actions). */
  meanLatencyMs: number | null;
  /** The v0 evaluator's plain overall mean, from the ensemble aggregate. */
  expectedScoreOverall: number | null;
  /** True when meanLatencyMs exceeded the search's latency ceiling. */
  latencyCeilingExceeded: boolean;
}

/** One evaluated candidate — the point, the organization, and its metrics. */
export interface CandidateEvaluation {
  candidateId: string;
  familyId: string | null;
  point: CandidateSpacePoint;
  organizationId: string;
  organizationVersion: number;
  /** How to reproduce this candidate's ensemble (baseSeed + size). */
  ensembleRef: { baseSeed: string; size: number };
  metrics: CandidateMetrics;
  /** Honest notes (e.g. hard-invalid runs excluded from the quality mean). */
  notes: readonly string[];
  /** 1-based rank once ranked (null when unranked). */
  rank: number | null;
}

// ---------------------------------------------------------------------------
// The search record
// ---------------------------------------------------------------------------

export type OrganizationSearchMode = "exhaustive-bounded" | "sampled";

/** The truncated-by-bounds record — honest, always present. */
export interface SearchTruncationRecord {
  truncated: boolean;
  /** Which bound stopped the search (null when it ran to completion). */
  reason: null | "max-candidates" | "budget-ceiling" | "latency-ceiling";
  budget: { ceilingUsd: number; cumulativeUsd: number; exceeded: boolean };
  latency: {
    ceilingMs: number;
    breachedByCandidateId: string | null;
    measuredMs: number | null;
  };
  /** Evaluated vs planned candidate counts (planned includes the baseline). */
  evaluated: number;
  planned: number;
}

/** The winner-vs-baseline comparison (contract §Required baselines). */
export interface BaselineComparison {
  baselineCandidateId: string;
  baselineOrganizationId: string;
  baselineRank: number;
  winnerCandidateId: string | null;
  winnerIsBaseline: boolean;
  qualityDelta: number | null;
  costDeltaUsd: number | null;
  latencyDeltaMs: number | null;
  summary: string;
}

/** The immutable search result record. */
export interface SearchResultRecord {
  schemaVersion: "lab-org-search/0.1";
  searchId: string;
  seed: string;
  mode: OrganizationSearchMode;
  config: {
    spaceId: string;
    spaceVersion: string;
    maxCandidates: number;
    ensembleSize: number;
    budgetCeilingUsd: number;
    latencyCeilingMs: number;
    scenarioConfig: FootballScenarioConfig;
    faultProfileId: string | null;
    evaluatorId: string;
    evaluatorVersion: string;
    rewardEngineId: string;
    rewardEngineVersion: string;
    weightSetId: string;
    weightSetVersion: string;
  };
  /** How many valid grid points exist (what the bounds bounded). */
  availableCandidates: number;
  candidatesEvaluated: number;
  truncation: SearchTruncationRecord;
  candidates: readonly CandidateEvaluation[];
  /** Candidate ids, best first (the documented total order). */
  ranking: readonly string[];
  winner: { candidateId: string; organizationId: string; organizationVersion: number } | null;
  baseline: BaselineComparison;
  provenance: {
    provenanceClass: typeof LAB_SIMULATION_PROVENANCE;
    seed: string;
    versions: {
      domainPackId: string;
      domainPackVersion: string;
      spaceVersion: string;
      evaluatorVersion: string;
      rewardEngineVersion: string;
      weightSetVersion: string;
    };
    note: string;
  };
}

// ---------------------------------------------------------------------------
// The search options + driver
// ---------------------------------------------------------------------------

export interface OrganizationSearchOptions {
  domainPack: FootballDomainPack;
  space: OrganizationCandidateSpace;
  seed: string;
  mode: OrganizationSearchMode;
  /** BOUND: at most this many candidates evaluated (baseline included). */
  maxCandidates: number;
  /** Seeded runs per candidate (>= 1). */
  ensembleSize: number;
  /** BOUND: cumulative simulated cost ceiling across all evaluated runs. */
  budgetCeilingUsd: number;
  /** BOUND: per-candidate mean simulated action-latency ceiling (ms). */
  latencyCeilingMs: number;
  scenarioConfig?: Partial<FootballScenarioConfig>;
  faultProfile?: FaultProfile;
  evaluator?: LabEvaluator;
  rewardEngine?: RewardEngine;
  /** Defaults to the engine's default weight set. */
  weightSetId?: string;
}

function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanOfNullable(values: readonly (number | null)[]): number | null {
  return meanOf(values.filter((value): value is number => value !== null));
}

function meanActionLatency(run: DeterministicLabRun): number | null {
  if (run.actions.length === 0) return null;
  return (
    run.actions.reduce((sum, action) => sum + action.simulatedLatencyMs, 0) / run.actions.length
  );
}

/** Recursively freeze a JSON-safe record (immutability, enforced). */
export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}

/**
 * The documented total order for ranking candidate evaluations:
 * hard-gate-valid first; then non-latency-breaching; then quality desc
 * (unmeasured last); then cost asc; then latency asc (unmeasured last);
 * then candidateId asc (a total, deterministic order).
 */
export function rankCandidateEvaluations(
  evaluations: readonly CandidateEvaluation[],
): readonly CandidateEvaluation[] {
  return [...evaluations]
    .sort((a, b) => {
      if (a.metrics.hardGateValid !== b.metrics.hardGateValid) {
        return a.metrics.hardGateValid ? -1 : 1;
      }
      if (a.metrics.latencyCeilingExceeded !== b.metrics.latencyCeilingExceeded) {
        return a.metrics.latencyCeilingExceeded ? 1 : -1;
      }
      const qualityA = a.metrics.quality ?? Number.NEGATIVE_INFINITY;
      const qualityB = b.metrics.quality ?? Number.NEGATIVE_INFINITY;
      if (qualityA !== qualityB) return qualityB - qualityA;
      if (a.metrics.costUsd !== b.metrics.costUsd) return a.metrics.costUsd - b.metrics.costUsd;
      const latencyA = a.metrics.meanLatencyMs ?? Number.POSITIVE_INFINITY;
      const latencyB = b.metrics.meanLatencyMs ?? Number.POSITIVE_INFINITY;
      if (latencyA !== latencyB) return latencyA - latencyB;
      return a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0;
    })
    .map((evaluation, index) => ({ ...evaluation, rank: index + 1 }));
}

function evaluateCandidate(
  options: OrganizationSearchOptions,
  candidate: MaterializedCandidate,
  engine: RewardEngine,
  evaluator: LabEvaluator,
): { evaluation: CandidateEvaluation; runCostTotalUsd: number } {
  const baseSeed = `${options.seed}::cand:${candidate.candidateId}`;
  const ensemble = runEnsemble({
    domainPack: options.domainPack,
    organization: candidate.bundle,
    baseSeed,
    size: options.ensembleSize,
    scenarioConfig: options.scenarioConfig,
    faultProfile: options.faultProfile,
    evaluator,
  });
  const notes: string[] = [];
  const rewardAggregates: number[] = [];
  let invalidRuns = 0;
  for (const run of ensemble.runs) {
    const reward = engine.score({
      dimensionScores: run.metrics.dimensions,
      hardGateViolations: run.metrics.violations,
      weightSetId: options.weightSetId,
      provenance: {
        runId: run.runId,
        evaluatorId: run.metrics.evaluatorId,
        evaluatorVersion: run.metrics.version,
      },
    });
    if (reward.status === "hard-invalid") {
      invalidRuns += 1;
    } else if (reward.aggregate !== null) {
      rewardAggregates.push(reward.aggregate);
    }
  }
  if (invalidRuns > 0) {
    notes.push(
      `${invalidRuns} of ${ensemble.runs.length} ensemble runs hard-invalid; ` +
        "quality is the mean over runs with a measurable aggregate only — " +
        "the candidate itself is NOT hard-gate valid",
    );
  }
  const costPerRun = ensemble.runs.map((run) => run.metrics.budgetUsage.total.costUsd);
  const meanCost = meanOf(costPerRun) ?? 0;
  const meanLatency = meanOfNullable(ensemble.runs.map((run) => meanActionLatency(run)));
  const latencyCeilingExceeded = meanLatency !== null && meanLatency > options.latencyCeilingMs;
  if (latencyCeilingExceeded) {
    notes.push(
      `mean simulated action latency ${meanLatency?.toFixed(2)}ms exceeds the search ` +
        `latency ceiling ${options.latencyCeilingMs}ms — ranked last and the search stops`,
    );
  }
  const evaluation: CandidateEvaluation = {
    candidateId: candidate.candidateId,
    familyId: candidate.familyId,
    point: candidate.point,
    organizationId: candidate.definition.organizationId,
    organizationVersion: candidate.definition.version,
    ensembleRef: { baseSeed, size: options.ensembleSize },
    metrics: {
      quality: meanOf(rewardAggregates),
      hardGateValid: ensemble.runs.every((run) => run.metrics.valid),
      validRunsFraction: ensemble.aggregate.seedRobustness.validFraction,
      costUsd: meanCost,
      meanLatencyMs: meanLatency,
      expectedScoreOverall: ensemble.aggregate.expectedScore.overall,
      latencyCeilingExceeded,
    },
    notes,
    rank: null,
  };
  return { evaluation, runCostTotalUsd: costPerRun.reduce((sum, cost) => sum + cost, 0) };
}

/**
 * Run the bounded organization search. Deterministic from
 * (seed, options): the same inputs yield a deep-equal, frozen record.
 */
export function runOrganizationSearch(options: OrganizationSearchOptions): SearchResultRecord {
  if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 1) {
    throw new LabValidationError("maxCandidates must be an integer >= 1");
  }
  if (!Number.isInteger(options.ensembleSize) || options.ensembleSize < 1) {
    throw new LabValidationError("ensembleSize must be an integer >= 1");
  }
  if (options.budgetCeilingUsd < 0) {
    throw new LabValidationError("budgetCeilingUsd must be >= 0");
  }
  if (options.latencyCeilingMs < 0) {
    throw new LabValidationError("latencyCeilingMs must be >= 0");
  }
  const engine = options.rewardEngine ?? createFootballRewardEngine();
  const evaluator = options.evaluator ?? createFootballLabEvaluator({ rewardEngine: engine });
  const weightSet = engine.weightSetFor(options.weightSetId);
  const scenarioConfig = generateFootballScenario(
    `${options.seed}::config`,
    options.scenarioConfig,
  ).config;

  // The candidate plan: the MANDATORY baseline first, then the mode's
  // candidates, deduplicated by candidateId and capped at maxCandidates.
  const baselinePoint = options.space.generalistBaselinePoint();
  const baselineCandidate = options.space.materialize(baselinePoint, {
    familyId: "generalist-baseline",
  });
  const planned: MaterializedCandidate[] = [baselineCandidate];
  const plannedIds = new Set([baselineCandidate.candidateId]);
  if (options.mode === "sampled") {
    for (const point of options.space.sample(options.seed, options.maxCandidates - 1)) {
      if (planned.length >= options.maxCandidates) break;
      const candidate = options.space.materialize(point);
      if (plannedIds.has(candidate.candidateId)) continue;
      plannedIds.add(candidate.candidateId);
      planned.push(candidate);
    }
  } else {
    for (const point of options.space.iterate()) {
      if (planned.length >= options.maxCandidates) break;
      const candidate = options.space.materialize(point);
      if (plannedIds.has(candidate.candidateId)) continue;
      plannedIds.add(candidate.candidateId);
      planned.push(candidate);
    }
  }

  // Evaluate under the bounds. The baseline is ALWAYS evaluated first; the
  // budget ceiling is checked BEFORE each subsequent candidate; a latency
  // ceiling breach stops the search after the breaching candidate.
  const evaluations: CandidateEvaluation[] = [];
  let cumulativeCostUsd = 0;
  let truncationReason: SearchTruncationRecord["reason"] = null;
  let latencyBreachedBy: string | null = null;
  let latencyBreachedMeasured: number | null = null;
  for (const candidate of planned) {
    if (evaluations.length > 0 && cumulativeCostUsd > options.budgetCeilingUsd) {
      truncationReason = "budget-ceiling";
      break;
    }
    const { evaluation, runCostTotalUsd } = evaluateCandidate(
      options,
      candidate,
      engine,
      evaluator,
    );
    evaluations.push(evaluation);
    cumulativeCostUsd += runCostTotalUsd;
    if (evaluation.metrics.latencyCeilingExceeded) {
      truncationReason = "latency-ceiling";
      latencyBreachedBy = evaluation.candidateId;
      latencyBreachedMeasured = evaluation.metrics.meanLatencyMs;
      break;
    }
  }
  const availableCandidates = options.space.count();
  if (
    truncationReason === null &&
    evaluations.length >= options.maxCandidates &&
    availableCandidates > evaluations.length
  ) {
    truncationReason = "max-candidates";
  }

  const ranked = rankCandidateEvaluations(evaluations);
  const ranking = ranked.map((evaluation) => evaluation.candidateId);
  const winnerEvaluation = ranked[0] ?? null;
  const baselineEvaluation =
    ranked.find((evaluation) => evaluation.candidateId === baselineCandidate.candidateId) ?? null;
  if (baselineEvaluation === null) {
    // Unreachable: the baseline is planned first and bounds never skip it.
    throw new LabValidationError("the mandatory baseline candidate is missing from the search");
  }

  const winnerQuality = winnerEvaluation !== null ? winnerEvaluation.metrics.quality : null;
  const baselineQuality = baselineEvaluation.metrics.quality;
  const qualityDelta =
    winnerQuality !== null && baselineQuality !== null ? winnerQuality - baselineQuality : null;
  const winnerLatency = winnerEvaluation !== null ? winnerEvaluation.metrics.meanLatencyMs : null;
  const baselineLatency = baselineEvaluation.metrics.meanLatencyMs;
  const latencyDelta =
    winnerLatency !== null && baselineLatency !== null ? winnerLatency - baselineLatency : null;
  const costDelta =
    winnerEvaluation !== null
      ? winnerEvaluation.metrics.costUsd - baselineEvaluation.metrics.costUsd
      : null;
  const winnerIsBaseline = winnerEvaluation?.candidateId === baselineEvaluation.candidateId;
  const summary =
    winnerEvaluation === null
      ? "no winner — the search evaluated no candidates"
      : winnerIsBaseline
        ? "the generalist baseline won this search"
        : `candidate ${winnerEvaluation.candidateId} beat the generalist baseline by ` +
          `quality ${qualityDelta?.toFixed(4)} (cost ${costDelta?.toFixed(4)} USD, ` +
          `latency ${latencyDelta?.toFixed(2)} ms — negative deltas favor the winner)`;

  const record: SearchResultRecord = {
    schemaVersion: "lab-org-search/0.1",
    searchId: "",
    seed: options.seed,
    mode: options.mode,
    config: {
      spaceId: options.space.spaceId,
      spaceVersion: options.space.version,
      maxCandidates: options.maxCandidates,
      ensembleSize: options.ensembleSize,
      budgetCeilingUsd: options.budgetCeilingUsd,
      latencyCeilingMs: options.latencyCeilingMs,
      scenarioConfig,
      faultProfileId: options.faultProfile?.profileId ?? null,
      evaluatorId: evaluator.evaluatorId,
      evaluatorVersion: evaluator.version,
      rewardEngineId: engine.engineId,
      rewardEngineVersion: engine.engineVersion,
      weightSetId: weightSet.weightSetId,
      weightSetVersion: weightSet.version,
    },
    availableCandidates,
    candidatesEvaluated: evaluations.length,
    truncation: {
      truncated: truncationReason !== null,
      reason: truncationReason,
      budget: {
        ceilingUsd: options.budgetCeilingUsd,
        cumulativeUsd: cumulativeCostUsd,
        exceeded: cumulativeCostUsd > options.budgetCeilingUsd,
      },
      latency: {
        ceilingMs: options.latencyCeilingMs,
        breachedByCandidateId: latencyBreachedBy,
        measuredMs: latencyBreachedMeasured,
      },
      evaluated: evaluations.length,
      planned: planned.length,
    },
    candidates: ranked,
    ranking,
    winner: winnerEvaluation
      ? {
          candidateId: winnerEvaluation.candidateId,
          organizationId: winnerEvaluation.organizationId,
          organizationVersion: winnerEvaluation.organizationVersion,
        }
      : null,
    baseline: {
      baselineCandidateId: baselineEvaluation.candidateId,
      baselineOrganizationId: baselineEvaluation.organizationId,
      baselineRank: baselineEvaluation.rank ?? 0,
      winnerCandidateId: winnerEvaluation?.candidateId ?? null,
      winnerIsBaseline,
      qualityDelta,
      costDeltaUsd: costDelta,
      latencyDeltaMs: latencyDelta,
      summary,
    },
    provenance: {
      provenanceClass: LAB_SIMULATION_PROVENANCE,
      seed: options.seed,
      versions: {
        domainPackId: options.domainPack.domainPackId,
        domainPackVersion: options.domainPack.version,
        spaceVersion: options.space.version,
        evaluatorVersion: evaluator.version,
        rewardEngineVersion: engine.engineVersion,
        weightSetVersion: weightSet.version,
      },
      note:
        "organization search over lab-simulation ensembles — evidence for the " +
        "registry's promotion gates, never production state (ADR-013 §8; architecture §6)",
    },
  };
  record.searchId = contentId({
    kind: "lab-org-search/0.1",
    seed: options.seed,
    mode: options.mode,
    config: record.config,
    candidatesEvaluated: record.candidatesEvaluated,
    candidates: record.candidates.map((evaluation) => ({
      candidateId: evaluation.candidateId,
      metrics: evaluation.metrics,
    })),
    ranking: record.ranking,
  });
  return deepFreeze(record);
}
