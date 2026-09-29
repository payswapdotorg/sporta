/**
 * Organization choice (REL-019): the read model a UI will consume later.
 *
 * For a request (domain / task / latency / budget) the choice query returns
 * ALL eligible organizations — every one with VISIBLE evidence: benchmark
 * summary (metrics + uncertainty), robustness summary, cost/latency profile,
 * provenance/rights requirements, and the exact version (the registry
 * contract's user-choice list).
 *
 * HONESTY BY CONSTRUCTION:
 * - no hidden ranking fields — the candidate carries exactly what the record
 *   carries; there is no score, no weight, no rank;
 * - any ordering is by DECLARED, RECORDED criteria: the caller names the
 *   ordering (cost-ascending / latency-ascending / quality-descending on a
 *   named axis / registry-order) and the RESULT records both the ordering and
 *   a human-readable `orderedBy` statement of what was actually applied;
 * - a simulator reward, when present, is shown as what it is (a lab search
 *   measurement) — never merged into quality evidence;
 * - organizations without the data an ordering needs sort LAST, visibly
 *   (no imputation, no silent defaults).
 *
 * Eligibility is the registry's own rule (SELECTABLE_STATUSES +
 * `matchesQuery`) — one truth, two read models. The UI must never imply that
 * an organization is universally optimal (the frozen contract's own
 * sentence); returning the evidence IS the mechanism for that.
 */
import type {
  CostEnvelope,
  DomainCompatibility,
  EligibilityQuery,
  LabRunRef,
  LatencyDistribution,
  OrganizationRecord,
  RightsRequirement,
} from "./domain";
import type { OrganizationRegistry } from "./registry";

// ---------------------------------------------------------------------------
// The candidate read model
// ---------------------------------------------------------------------------

/** The visible benchmark summary (metrics + uncertainty per axis). */
export interface BenchmarkSummary {
  corpusVersion: string;
  evaluatorVersion: string;
  metrics: readonly { axis: string; value: number }[];
  uncertainty: readonly { axis: string; ciLow: number; ciHigh: number }[];
}

/** The visible robustness summary (lab architecture §9's record). */
export interface RobustnessSummary {
  seedsTested: number;
  seedsPassed: number;
  outOfDistributionScore: number;
  simulatorModelAgreement: number;
  benchmarkCorpusCoverage: number;
}

/** The simulator reward, shown as what it is — a lab measurement, never a gate. */
export interface SimulatorRewardSummary {
  score: number;
  rewardVersion: string;
}

/** The visible provenance/rights requirements. */
export interface ProvenanceSummary {
  owner: string;
  lineage: readonly string[];
  createdFrom: LabRunRef | null;
}

/**
 * One eligible organization as the user sees it: identity + version + status
 * + domain support + VISIBLE evidence + operating profile + known
 * limitations. Deliberately NO rank, NO score, NO hidden weight.
 */
export interface ChoiceCandidate {
  organizationId: string;
  version: number;
  displayName: string;
  status: OrganizationRecord["status"];
  domain: DomainCompatibility;
  evidence: {
    benchmark: BenchmarkSummary | null;
    robustness: RobustnessSummary | null;
    simulatorReward: SimulatorRewardSummary | null;
    rightsRequirements: readonly RightsRequirement[];
    provenance: ProvenanceSummary;
  };
  profile: {
    latency: LatencyDistribution;
    cost: CostEnvelope;
  };
  /** The declared known limitations (robustness evidence's failure envelope). */
  knownLimitations: readonly string[];
}

// ---------------------------------------------------------------------------
// The declared ordering
// ---------------------------------------------------------------------------

/**
 * The declared, recorded ordering. `quality-descending` names the benchmark
 * axis it sorts by — an unnamed quality sort would be a hidden criterion.
 */
export type ChoiceOrdering =
  | { kind: "registry-order" }
  | { kind: "cost-ascending" }
  | { kind: "latency-ascending" }
  | { kind: "quality-descending"; axis: string };

/** The choice result: the request, the ordering actually applied, the candidates. */
export interface ChoiceResult {
  request: EligibilityQuery;
  /** The declared ordering that was applied — recorded, never hidden. */
  ordering: ChoiceOrdering;
  /** The ordering stated in words (what a UI shows next to a sorted list). */
  orderedBy: string;
  /** All eligible organizations (empty when none — an honest empty answer). */
  candidates: readonly ChoiceCandidate[];
}

// ---------------------------------------------------------------------------
// Building candidates
// ---------------------------------------------------------------------------

/** Projects a registry record into the user-visible choice candidate. */
export function toChoiceCandidate(record: OrganizationRecord): ChoiceCandidate {
  const benchmark = record.evidence.benchmark;
  const robustness = record.evidence.robustness;
  const reward = record.evidence.simulatorReward;
  return {
    organizationId: record.organizationId,
    version: record.version,
    displayName: record.displayName,
    status: record.status,
    domain: record.domain,
    evidence: {
      benchmark:
        benchmark === undefined
          ? null
          : {
              corpusVersion: benchmark.corpusVersion,
              evaluatorVersion: benchmark.evaluatorVersion,
              metrics: benchmark.metrics.map((m) => ({ axis: m.axis, value: m.value })),
              uncertainty: benchmark.uncertainty.map((u) => ({
                axis: u.axis,
                ciLow: u.ciLow,
                ciHigh: u.ciHigh,
              })),
            },
      robustness:
        robustness === undefined
          ? null
          : {
              seedsTested: robustness.seedsTested,
              seedsPassed: robustness.seedsPassed,
              outOfDistributionScore: robustness.outOfDistributionScore,
              simulatorModelAgreement: robustness.simulatorModelAgreement,
              benchmarkCorpusCoverage: robustness.benchmarkCorpusCoverage,
            },
      simulatorReward:
        reward === undefined ? null : { score: reward.score, rewardVersion: reward.rewardVersion },
      rightsRequirements: record.provenance.rightsRequirements.map((r) => ({ ...r })),
      provenance: {
        owner: record.provenance.owner,
        lineage: [...record.provenance.lineage],
        createdFrom:
          record.provenance.createdFrom === null ? null : { ...record.provenance.createdFrom },
      },
    },
    profile: {
      latency: { ...record.profile.latency },
      cost: { ...record.profile.cost },
    },
    knownLimitations: robustness === undefined ? [] : [...robustness.knownFailureEnvelope],
  };
}

// ---------------------------------------------------------------------------
// The declared ordering, applied + described
// ---------------------------------------------------------------------------

/** Sorts candidates by the DECLARED criterion; missing data sorts LAST. */
export function applyChoiceOrdering(
  candidates: readonly ChoiceCandidate[],
  ordering: ChoiceOrdering,
): ChoiceCandidate[] {
  const sorted = [...candidates];
  switch (ordering.kind) {
    case "registry-order":
      return sorted; // registration order — the registry's own sequence
    case "cost-ascending":
      sorted.sort((a, b) => {
        const av = a.profile.cost.perRunUsd;
        const bv = b.profile.cost.perRunUsd;
        if (av !== bv) return av - bv;
        return a.organizationId < b.organizationId
          ? -1
          : a.organizationId > b.organizationId
            ? 1
            : 0;
      });
      return sorted;
    case "latency-ascending":
      sorted.sort((a, b) => {
        const av = a.profile.latency.p95Ms;
        const bv = b.profile.latency.p95Ms;
        if (av !== bv) return av - bv;
        return a.organizationId < b.organizationId
          ? -1
          : a.organizationId > b.organizationId
            ? 1
            : 0;
      });
      return sorted;
    case "quality-descending":
      sorted.sort((a, b) => {
        const av = qualityAxisValue(a, ordering.axis);
        const bv = qualityAxisValue(b, ordering.axis);
        // Missing the axis sorts LAST (visible absence, never imputed).
        if (av === null && bv === null) {
          return a.organizationId < b.organizationId
            ? -1
            : a.organizationId > b.organizationId
              ? 1
              : 0;
        }
        if (av === null) return 1;
        if (bv === null) return -1;
        if (av !== bv) return bv - av; // descending: better quality first
        return a.organizationId < b.organizationId
          ? -1
          : a.organizationId > b.organizationId
            ? 1
            : 0;
      });
      return sorted;
  }
}

/** The declared axis's benchmark value, or null when absent (sorts last). */
function qualityAxisValue(candidate: ChoiceCandidate, axis: string): number | null {
  const metric = candidate.evidence.benchmark?.metrics.find((m) => m.axis === axis);
  return metric?.value ?? null;
}

/** Human-readable statement of the ordering actually applied. */
export function describeChoiceOrdering(ordering: ChoiceOrdering): string {
  switch (ordering.kind) {
    case "registry-order":
      return "registry order (registration sequence; no ranking applied)";
    case "cost-ascending":
      return "cost ascending (per-run USD, ties broken by organization id)";
    case "latency-ascending":
      return "latency ascending (p95 milliseconds, ties broken by organization id)";
    case "quality-descending":
      return `quality descending (benchmark axis '${ordering.axis}'; organizations without that axis sort last, ties broken by organization id)`;
  }
}

// ---------------------------------------------------------------------------
// The choice query
// ---------------------------------------------------------------------------

/**
 * Runs the choice query: ALL eligible organizations for the request, each
 * with visible evidence, ordered (only) by the declared criterion.
 */
export async function choiceForRequest(
  registry: OrganizationRegistry,
  request: EligibilityQuery,
  ordering: ChoiceOrdering = { kind: "registry-order" },
): Promise<ChoiceResult> {
  const eligible = await registry.queryEligible(request);
  const candidates = eligible.map(toChoiceCandidate);
  return {
    request,
    ordering,
    orderedBy: describeChoiceOrdering(ordering),
    candidates: applyChoiceOrdering(candidates, ordering),
  };
}
