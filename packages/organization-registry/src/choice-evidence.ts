/**
 * The choice-evidence view (REL-033): the REL-A5 visibility law as a
 * machine-checkable read model.
 *
 * THE LAW (docs/testing/reality-engineering-lab-acceptance.md, Gate REL-A5):
 * "The UI must display version/evidence/limits and allow the user to change
 * selection." The delivered choice surface (src/choice.ts) already carries
 * everything on the candidate; this module projects it into the exact view
 * the law names — and, honestly, names every VISIBILITY GAP a selectable
 * candidate still has (a candidate may legally stand in `validated` or
 * `canary` without benchmark/robustness evidence on its record; the law
 * demands the user SEE that absence, not have it imputed away).
 *
 * Pure projection, no state: `choiceEvidenceFor` maps one
 * {@link ChoiceCandidate} to its {@link ChoiceEvidenceView}. An empty
 * `visibilityGaps` list is the A5 law fully satisfied — what the REL-033
 * proof battery asserts for its production candidates.
 */
import type {
  BenchmarkSummary,
  ChoiceCandidate,
  ProvenanceSummary,
  RobustnessSummary,
} from "./choice";
import type { OrganizationStatus, RightsRequirement } from "./domain";

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** The visible operating envelope (the choice candidate's declared profile). */
export interface CostLatencyView {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  perRunUsd: number;
}

/**
 * What the A5 law says the user must see for one eligible organization:
 * identity + version + status, quality evidence (benchmark metrics +
 * uncertainty), robustness evidence, the cost/latency envelope, the rights
 * requirements, the known limitations, and the provenance — plus the named
 * gaps where any of that is absent.
 */
export interface ChoiceEvidenceView {
  organizationId: string;
  version: number;
  displayName: string;
  status: OrganizationStatus;
  benchmark: BenchmarkSummary | null;
  robustness: RobustnessSummary | null;
  costLatency: CostLatencyView;
  rightsRequirements: readonly RightsRequirement[];
  knownLimitations: readonly string[];
  provenance: ProvenanceSummary;
  /**
   * Every A5 visibility gap, in words. Empty = the law is fully satisfied
   * for this candidate. Gaps are NEVER silently filled — an absent evidence
   * object is a named absence the UI must show.
   */
  visibilityGaps: string[];
}

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

/**
 * Projects a choice candidate into the A5 visibility view. Deterministic and
 * total: every selectable candidate yields a view; missing evidence yields
 * named gaps, never imputed values.
 */
export function choiceEvidenceFor(candidate: ChoiceCandidate): ChoiceEvidenceView {
  const gaps: string[] = [];
  if (candidate.evidence.benchmark === null) {
    gaps.push(
      "benchmark evidence (quality metrics + uncertainty) is not visible: the record carries no benchmark evidence",
    );
  }
  if (candidate.evidence.robustness === null) {
    gaps.push(
      "robustness evidence (seeds, OOD, simulator-model agreement, corpus coverage) is not visible: the record carries no robustness evidence",
    );
    gaps.push(
      "known limitations are not declared: limitations come from the robustness evidence's failure envelope",
    );
  }
  return {
    organizationId: candidate.organizationId,
    version: candidate.version,
    displayName: candidate.displayName,
    status: candidate.status,
    benchmark: candidate.evidence.benchmark,
    robustness: candidate.evidence.robustness,
    costLatency: {
      p50Ms: candidate.profile.latency.p50Ms,
      p95Ms: candidate.profile.latency.p95Ms,
      p99Ms: candidate.profile.latency.p99Ms,
      perRunUsd: candidate.profile.cost.perRunUsd,
    },
    rightsRequirements: candidate.evidence.rightsRequirements,
    knownLimitations: candidate.knownLimitations,
    provenance: candidate.evidence.provenance,
    visibilityGaps: gaps,
  };
}
