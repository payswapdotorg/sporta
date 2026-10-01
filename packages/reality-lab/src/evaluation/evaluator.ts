/**
 * The Lab Evaluator v0.2 (REL-002/003's supporting evaluator hook, upgraded
 * by REL-007 to delegate to the full reward engine).
 *
 * What it does (honestly):
 * - records the pack's reward dimensions PER RUN, measuring the seven
 *   dimensions that have evidence in a v0 lab run and marking the three
 *   renderer-in-the-loop dimensions (motion fidelity, camera/scene
 *   correctness, stylization quality) as NOT MEASURED with the reason;
 * - applies the pack's hard invalidity gates and returns their typed
 *   refusal records (`HardInvalidityViolation`) alongside the scores — a
 *   hard-invalid run has `valid: false` and NO reward can buy validity
 *   back (the refusal is evidence, never an exception — repo convention);
 * - REL-007: delegates the aggregation to the full reward engine and
 *   attaches the per-run `RewardRecord` (weighted aggregate under the
 *   default football weight set + the typed `HardInvalid` classification)
 *   as `result.reward` — ADDITIVE: `overall` stays the plain mean of
 *   measured dimensions so the v0 signature and semantics are unchanged.
 */
import type { HardInvalidityViolation, LabClaim, RewardDimension } from "../domain/domain-pack";
import {
  FOOTBALL_LAB_EVALUATOR_ID,
  FOOTBALL_LAB_EVALUATOR_VERSION,
  FOOTBALL_REWARD_DIMENSIONS,
} from "../domain/football";
import { createFootballRewardEngine, type RewardRecord, type RewardEngine } from "../reward/engine";

// ---------------------------------------------------------------------------
// The evaluator seam
// ---------------------------------------------------------------------------

/** The evidence a run hands the evaluator (all deterministic). */
export interface LabEvaluatorEvidence {
  runId: string;
  tickCount: number;
  /** Every observation id the organization received (the evidence universe). */
  knownEvidenceRefs: readonly string[];
  /** Event-record observations the organization received. */
  eventRecordObservationCount: number;
  /** Ticks on which at least one event record was available. */
  ticksWithEventRecords: number;
  /** Of those, ticks on which the organization emitted at least one action. */
  ticksWithEventRecordsAndAction: number;
  /** All canonical-event claims emitted. */
  canonicalEventClaims: readonly LabClaim[];
  /** All identity-assertion claims emitted. */
  identityClaims: readonly LabClaim[];
  /** Ground-truth entity ids (identity continuity ground truth). */
  knownEntityIds: readonly string[];
  actionCount: number;
  simulatedLatencyMsMean: number | null;
  simulatedCostUsd: number;
  invocationCount: number;
  budgetMaxCalls: number;
  budgetMaxCostUsd: number;
  latencyHardMs: number;
  faultTicks: number;
  faultTicksWithAction: number;
  /** Precomputed hard-invalidity refusals (checked at claim emission time). */
  violations: readonly HardInvalidityViolation[];
}

/** One reward-dimension score (or an honest not-measured marker). */
export interface LabDimensionScore {
  dimensionId: string;
  score: number | null;
  measured: boolean;
  note?: string;
  raw?: Record<string, unknown>;
}

/** The evaluator's typed result — scores + typed hard-gate refusals. */
export interface LabEvaluatorResult {
  evaluatorId: string;
  version: string;
  dimensions: readonly LabDimensionScore[];
  /** Mean of MEASURED dimension scores (null when nothing measurable). */
  overall: number | null;
  /** False when any hard invalidity gate fired. */
  valid: boolean;
  violations: readonly HardInvalidityViolation[];
  /**
   * REL-007: the full reward-engine record for this run (weighted aggregate
   * under the default football weight set + the typed HardInvalid refusal).
   * Additive field — absent on legacy/synthetic results.
   */
  reward?: RewardRecord;
}

/** The evaluator seam the simulator/ensemble call. */
export interface LabEvaluator {
  evaluatorId: string;
  version: string;
  evaluate(evidence: LabEvaluatorEvidence): LabEvaluatorResult;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// ---------------------------------------------------------------------------
// The football v0 evaluator
// ---------------------------------------------------------------------------

/** True when the claim is a canonical-event claim citing only-received evidence. */
function isWellEvidencedClaim(claim: LabClaim, knownEvidence: ReadonlySet<string>): boolean {
  if (claim.claimKind !== "canonical-event") return false;
  return claim.evidenceRefs.length > 0 && claim.evidenceRefs.every((ref) => knownEvidence.has(ref));
}

/**
 * The football lab evaluator v0.2: seven measured dimensions, three honest
 * not-measured markers, hard gates as typed refusals, and the FULL reward
 * engine attached per run (REL-007 delegation).
 */
export function createFootballLabEvaluator(
  options: { rewardEngine?: RewardEngine } = {},
): LabEvaluator {
  const rewardEngine = options.rewardEngine ?? createFootballRewardEngine();
  return {
    evaluatorId: FOOTBALL_LAB_EVALUATOR_ID,
    version: FOOTBALL_LAB_EVALUATOR_VERSION,
    evaluate(evidence: LabEvaluatorEvidence): LabEvaluatorResult {
      const dimensions: LabDimensionScore[] = [];
      // --- event-source-fidelity: F1 over (claims <-> event-record observations).
      const knownEvidence = new Set(evidence.knownEvidenceRefs);
      const totalClaims = evidence.canonicalEventClaims.length;
      const wellEvidenced = evidence.canonicalEventClaims.filter((claim) =>
        isWellEvidencedClaim(claim, knownEvidence),
      ).length;
      const observed = evidence.eventRecordObservationCount;
      const distinctClaimedRefs = new Set<string>();
      for (const claim of evidence.canonicalEventClaims) {
        if (claim.claimKind !== "canonical-event") continue;
        for (const ref of claim.evidenceRefs) distinctClaimedRefs.add(ref);
      }
      const precision = totalClaims > 0 ? wellEvidenced / totalClaims : 0;
      const recall = observed > 0 ? Math.min(1, distinctClaimedRefs.size / observed) : 0;
      const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
      dimensions.push({
        dimensionId: "event-source-fidelity",
        score: observed > 0 || totalClaims > 0 ? f1 : null,
        measured: observed > 0 || totalClaims > 0,
        note: observed === 0 && totalClaims === 0 ? "no events in scenario window" : undefined,
        raw: {
          claims: totalClaims,
          wellEvidenced,
          distinctClaimedObservations: distinctClaimedRefs.size,
          eventRecordObservations: observed,
        },
      });

      // --- identity-continuity: fraction of identity claims over real entities.
      const identityTotal = evidence.identityClaims.length;
      const identityMatching = evidence.identityClaims.filter(
        (claim) =>
          claim.claimKind === "identity-assertion" &&
          evidence.knownEntityIds.includes(claim.entityId),
      ).length;
      dimensions.push({
        dimensionId: "identity-continuity",
        score: identityTotal > 0 ? identityMatching / identityTotal : null,
        measured: identityTotal > 0,
        note: identityTotal === 0 ? "no identity assertions emitted" : undefined,
        raw: { assertions: identityTotal, matchingGroundTruth: identityMatching },
      });

      // --- temporal-consistency: action coverage of event-record ticks.
      dimensions.push({
        dimensionId: "temporal-consistency",
        score:
          evidence.ticksWithEventRecords > 0
            ? evidence.ticksWithEventRecordsAndAction / evidence.ticksWithEventRecords
            : null,
        measured: evidence.ticksWithEventRecords > 0,
        note: evidence.ticksWithEventRecords === 0 ? "no event-record ticks" : undefined,
        raw: {
          ticksWithEventRecords: evidence.ticksWithEventRecords,
          acted: evidence.ticksWithEventRecordsAndAction,
        },
      });

      // --- latency: simulated decision latency against the hard limit.
      dimensions.push({
        dimensionId: "latency",
        score:
          evidence.actionCount > 0 && evidence.simulatedLatencyMsMean !== null
            ? clamp01(1 - evidence.simulatedLatencyMsMean / evidence.latencyHardMs)
            : null,
        measured: evidence.actionCount > 0 && evidence.simulatedLatencyMsMean !== null,
        note: evidence.actionCount === 0 ? "no actions emitted" : undefined,
        raw: {
          simulatedLatencyMsMean: evidence.simulatedLatencyMsMean,
          latencyHardMs: evidence.latencyHardMs,
        },
      });

      // --- cost: simulated cost against the organization budget.
      dimensions.push({
        dimensionId: "cost",
        score:
          evidence.budgetMaxCostUsd > 0
            ? clamp01(1 - evidence.simulatedCostUsd / evidence.budgetMaxCostUsd)
            : null,
        measured: evidence.budgetMaxCostUsd > 0,
        raw: { simulatedCostUsd: evidence.simulatedCostUsd, budget: evidence.budgetMaxCostUsd },
      });

      // --- reliability: action continuity under injected faults.
      dimensions.push({
        dimensionId: "reliability",
        score: evidence.faultTicks > 0 ? evidence.faultTicksWithAction / evidence.faultTicks : null,
        measured: evidence.faultTicks > 0,
        note: evidence.faultTicks === 0 ? "no faults injected" : undefined,
        raw: {
          faultTicks: evidence.faultTicks,
          faultTicksWithAction: evidence.faultTicksWithAction,
        },
      });

      // --- compute-usage: invocations against the call budget.
      dimensions.push({
        dimensionId: "compute-usage",
        score:
          evidence.budgetMaxCalls > 0
            ? clamp01(1 - evidence.invocationCount / evidence.budgetMaxCalls)
            : null,
        measured: evidence.budgetMaxCalls > 0,
        raw: { invocations: evidence.invocationCount, budgetCalls: evidence.budgetMaxCalls },
      });

      // --- the three renderer-in-the-loop dimensions (REL-007 territory).
      for (const dimension of FOOTBALL_REWARD_DIMENSIONS) {
        if (
          dimension.dimensionId === "motion-fidelity" ||
          dimension.dimensionId === "camera-scene-correctness" ||
          dimension.dimensionId === "stylization-quality"
        ) {
          dimensions.push({
            dimensionId: dimension.dimensionId,
            score: null,
            measured: false,
            note: "requires renderer-in-the-loop evaluation — the full reward engine is REL-007",
          });
        }
      }

      const measuredScores = dimensions
        .filter((dimension) => dimension.measured && dimension.score !== null)
        .map((dimension) => dimension.score as number);
      // REL-007: the full engine — weighted aggregate + typed hard-invalid
      // refusal — attached alongside the unchanged v0 fields.
      const reward = rewardEngine.score({
        dimensionScores: dimensions,
        hardGateViolations: evidence.violations,
        provenance: {
          runId: evidence.runId,
          evaluatorId: FOOTBALL_LAB_EVALUATOR_ID,
          evaluatorVersion: FOOTBALL_LAB_EVALUATOR_VERSION,
        },
      });
      return {
        evaluatorId: FOOTBALL_LAB_EVALUATOR_ID,
        version: FOOTBALL_LAB_EVALUATOR_VERSION,
        dimensions,
        overall: meanOf(measuredScores),
        valid: evidence.violations.length === 0,
        violations: [...evidence.violations],
        reward,
      };
    },
  };
}

/** The declared reward dimensions this v0 evaluator knows how to score. */
export function footballEvaluatorRewardDimensions(): readonly RewardDimension[] {
  return FOOTBALL_REWARD_DIMENSIONS;
}
