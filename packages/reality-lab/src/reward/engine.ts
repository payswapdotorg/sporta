/**
 * The Reward Engine (REL-007) — the full architecture §8 "Reward and hard
 * gates" engine over the v0 evaluator hook's per-run dimension scores:
 *
 * - COMPOSABLE reward dimensions: any subset of the pack's declared reward
 *   dimensions may be scored; unmeasured dimensions are excluded from the
 *   weighted aggregate's denominator (no imputation, no fake zeros);
 * - WEIGHTED AGGREGATION with VERSIONED weight sets: a registered weight set
 *   (id + version + a weight for every declared dimension) is selected per
 *   scoring call; the aggregate is the weight-normalized mean over MEASURED
 *   dimensions;
 * - per-run `RewardRecord`: dimension scores, weights, contributions, the
 *   aggregate, the weight set used, evaluator + engine versions, provenance;
 * - HARD INVALIDITY as TYPED REFUSALS: a run with hard-gate violations gets
 *   `status: "hard-invalid"` and a typed `HardInvalidRefusal` — the run is
 *   INVALID, never merely "scored low"; no reward can buy validity back
 *   (the aggregate is null for a hard-invalid run).
 *
 * The engine consumes the six ADR-013 §8 gate classes as
 * `HardInvalidityViolation` records (already checked at claim-emission time
 * by the domain pack's rules — see ../domain/football). The engine's job is
 * the VERDICT: violations present ⇒ the typed refusal, listing every rule
 * that fired, collectively.
 *
 * The v0 evaluator hook (`createFootballLabEvaluator`) delegates to this
 * engine: its result carries the full `RewardRecord` alongside the
 * backwards-compatible `overall` (plain mean) — see ../evaluation/evaluator.
 */
import { contentId } from "../hash";
import { LabNotFoundError, LabValidationError } from "../errors";
import type { HardInvalidityViolation, RewardDimension } from "../domain/domain-pack";
import { FOOTBALL_REWARD_DIMENSIONS } from "../domain/football";

// ---------------------------------------------------------------------------
// Identity + versions
// ---------------------------------------------------------------------------

export const REWARD_ENGINE_ID = "sporta-reward-engine";
export const REWARD_ENGINE_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Versioned weight sets
// ---------------------------------------------------------------------------

/** A VERSIONED weight set: a weight for every declared reward dimension. */
export interface RewardWeightSet {
  weightSetId: string;
  version: string;
  description: string;
  /** dimensionId -> weight (>= 0); must cover exactly the declared dimensions. */
  weights: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// The typed hard-invalid refusal (§8 — the run is invalid, not scored low)
// ---------------------------------------------------------------------------

/** The typed refusal a hard-gate failure produces — evidence, never a throw. */
export interface HardInvalidRefusal {
  kind: "hard-invalid";
  /** Distinct rule ids that fired, sorted. */
  ruleIds: readonly string[];
  violationCount: number;
  violations: readonly HardInvalidityViolation[];
  reason: string;
}

// ---------------------------------------------------------------------------
// The per-run reward record
// ---------------------------------------------------------------------------

/** One dimension's weighted contribution inside a reward record. */
export interface RewardDimensionContribution {
  dimensionId: string;
  score: number | null;
  measured: boolean;
  weight: number;
  /** weight x score (null when the dimension is unmeasured). */
  contribution: number | null;
  /** Honest notes (e.g. why a dimension went unmeasured, or was not in the weight set). */
  note?: string;
}

/** The per-run reward record (§8 + the §11 "reward version" lab output). */
export interface RewardRecord {
  schemaVersion: "lab-reward/0.1";
  rewardId: string;
  status: "valid" | "hard-invalid";
  /** Whose dimension scores these were (the evaluator hook). */
  evaluator: { evaluatorId: string; evaluatorVersion: string };
  engine: { engineId: string; engineVersion: string };
  weightSet: { weightSetId: string; version: string };
  dimensions: readonly RewardDimensionContribution[];
  /** Weight-normalized mean over measured dimensions; null when hard-invalid or nothing measured. */
  aggregate: number | null;
  measuredDimensions: number;
  unmeasuredDimensionIds: readonly string[];
  /** Present iff status is "hard-invalid" — the typed refusal. */
  hardInvalid: HardInvalidRefusal | null;
  provenance: {
    runId: string | null;
    note: string;
  };
}

/** Type guard: true when the record is a typed hard-invalid refusal. */
export function isHardInvalid(record: RewardRecord): boolean {
  return record.status === "hard-invalid" && record.hardInvalid !== null;
}

// ---------------------------------------------------------------------------
// The engine seam
// ---------------------------------------------------------------------------

/** A dimension score input — structurally the v0 `LabDimensionScore`. */
export interface RewardDimensionScoreInput {
  dimensionId: string;
  score: number | null;
  measured: boolean;
  note?: string;
}

export interface RewardEngineInput {
  dimensionScores: readonly RewardDimensionScoreInput[];
  /** Hard-gate violations already checked at claim-emission time (authoritative). */
  hardGateViolations?: readonly HardInvalidityViolation[];
  /** Defaults to the engine's default weight set. */
  weightSetId?: string;
  provenance?: {
    runId?: string;
    evaluatorId?: string;
    evaluatorVersion?: string;
    note?: string;
  };
}

/** The full §8 reward engine. */
export interface RewardEngine {
  readonly engineId: string;
  readonly engineVersion: string;
  readonly defaultWeightSetId: string;
  readonly weightSets: readonly RewardWeightSet[];
  /** Resolve a weight set by id (or the default). */
  weightSetFor(weightSetId?: string): RewardWeightSet;
  /** Score one run: dimensions + violations -> the immutable RewardRecord. */
  score(input: RewardEngineInput): RewardRecord;
}

// ---------------------------------------------------------------------------
// Validation + construction
// ---------------------------------------------------------------------------

function validateWeightSets(
  weightSets: readonly RewardWeightSet[],
  dimensions: readonly RewardDimension[],
  defaultWeightSetId: string,
): void {
  const problems: string[] = [];
  const declaredIds = new Set(dimensions.map((dimension) => dimension.dimensionId));
  const ids = new Set<string>();
  for (const weightSet of weightSets) {
    if (ids.has(weightSet.weightSetId)) {
      problems.push(`duplicate weightSetId ${weightSet.weightSetId}`);
    }
    ids.add(weightSet.weightSetId);
    const keys = Object.keys(weightSet.weights);
    const missing = [...declaredIds].filter((id) => !keys.includes(id));
    const unknown = keys.filter((id) => !declaredIds.has(id));
    if (missing.length > 0) {
      problems.push(
        `weight set ${weightSet.weightSetId} is missing dimensions: ${missing.join(", ")}`,
      );
    }
    if (unknown.length > 0) {
      problems.push(
        `weight set ${weightSet.weightSetId} has unknown dimensions: ${unknown.join(", ")}`,
      );
    }
    if (
      !keys.every((id) => typeof weightSet.weights[id] === "number" && weightSet.weights[id] >= 0)
    ) {
      problems.push(`weight set ${weightSet.weightSetId} has a negative or non-numeric weight`);
    }
    if (keys.length > 0 && !keys.some((id) => (weightSet.weights[id] ?? 0) > 0)) {
      problems.push(
        `weight set ${weightSet.weightSetId} is all-zero (nothing would ever be measured)`,
      );
    }
  }
  if (!ids.has(defaultWeightSetId)) {
    problems.push(
      `defaultWeightSetId ${defaultWeightSetId} is not among the registered weight sets`,
    );
  }
  if (dimensions.length === 0) {
    problems.push("the engine needs at least one declared reward dimension");
  }
  if (problems.length > 0) {
    throw new LabValidationError(
      `invalid reward engine configuration: ${problems.join("; ")}`,
      problems,
    );
  }
}

/**
 * Create a reward engine over a pack's declared reward dimensions and a
 * registry of VERSIONED weight sets. Weight sets must cover exactly the
 * declared dimensions (no missing, no unknown, no negative weights).
 */
export function createRewardEngine(options: {
  dimensions: readonly RewardDimension[];
  weightSets: readonly RewardWeightSet[];
  defaultWeightSetId: string;
}): RewardEngine {
  validateWeightSets(options.weightSets, options.dimensions, options.defaultWeightSetId);
  const weightSets = options.weightSets.map((weightSet) => ({
    ...weightSet,
    weights: { ...weightSet.weights },
  }));

  const weightSetFor = (weightSetId?: string): RewardWeightSet => {
    const id = weightSetId ?? options.defaultWeightSetId;
    const found = weightSets.find((weightSet) => weightSet.weightSetId === id);
    if (found === undefined) {
      throw new LabNotFoundError(
        `unknown reward weight set ${id} (registered: ${weightSets.map((w) => w.weightSetId).join(", ")})`,
        { weightSetId: id },
      );
    }
    return found;
  };

  return {
    engineId: REWARD_ENGINE_ID,
    engineVersion: REWARD_ENGINE_VERSION,
    defaultWeightSetId: options.defaultWeightSetId,
    weightSets,
    weightSetFor,
    score(input: RewardEngineInput): RewardRecord {
      const weightSet = weightSetFor(input.weightSetId);
      const seen = new Set<string>();
      const dimensions: RewardDimensionContribution[] = [];
      for (const entry of input.dimensionScores) {
        if (seen.has(entry.dimensionId)) {
          throw new LabValidationError(`duplicate dimension score for ${entry.dimensionId}`, [
            { dimensionId: entry.dimensionId },
          ]);
        }
        seen.add(entry.dimensionId);
        const weight = weightSet.weights[entry.dimensionId];
        dimensions.push({
          dimensionId: entry.dimensionId,
          score: entry.score,
          measured: entry.measured,
          weight: weight ?? 0,
          contribution:
            entry.measured && entry.score !== null && (weight ?? 0) > 0
              ? (weight ?? 0) * entry.score
              : null,
          note:
            weight === undefined
              ? "dimension not declared for this engine's weight set — weighted 0"
              : entry.note,
        });
      }

      const violations = [...(input.hardGateViolations ?? [])];
      const hardInvalid: HardInvalidRefusal | null =
        violations.length > 0
          ? {
              kind: "hard-invalid",
              ruleIds: [...new Set(violations.map((violation) => violation.ruleId))].sort(),
              violationCount: violations.length,
              violations,
              reason:
                `${violations.length} hard-gate violation(s) across rule(s) ` +
                `${[...new Set(violations.map((v) => v.ruleId))].sort().join(", ")} — ` +
                "the run is INVALID; no reward can buy validity back (ADR-013 §8)",
            }
          : null;

      const measured = dimensions.filter(
        (dimension) => dimension.measured && dimension.contribution !== null,
      );
      const weightSum = measured.reduce((sum, dimension) => sum + dimension.weight, 0);
      const contributionSum = measured.reduce(
        (sum, dimension) => sum + (dimension.contribution ?? 0),
        0,
      );
      const aggregate =
        hardInvalid !== null || weightSum <= 0 || measured.length === 0
          ? null
          : contributionSum / weightSum;

      const record: RewardRecord = {
        schemaVersion: "lab-reward/0.1",
        rewardId: "",
        status: hardInvalid !== null ? "hard-invalid" : "valid",
        evaluator: {
          evaluatorId: input.provenance?.evaluatorId ?? "unknown-evaluator",
          evaluatorVersion: input.provenance?.evaluatorVersion ?? "0",
        },
        engine: { engineId: REWARD_ENGINE_ID, engineVersion: REWARD_ENGINE_VERSION },
        weightSet: { weightSetId: weightSet.weightSetId, version: weightSet.version },
        dimensions,
        aggregate,
        measuredDimensions: dimensions.filter((dimension) => dimension.measured).length,
        unmeasuredDimensionIds: dimensions
          .filter((dimension) => !dimension.measured)
          .map((dimension) => dimension.dimensionId),
        hardInvalid,
        provenance: {
          runId: input.provenance?.runId ?? null,
          note:
            input.provenance?.note ??
            "per-run reward record — weighted aggregate over measured dimensions; " +
              "hard-gate failures are typed refusals, never low scores",
        },
      };
      record.rewardId = contentId({
        kind: "lab-reward/0.1",
        status: record.status,
        evaluator: record.evaluator,
        weightSet: record.weightSet,
        dimensions: record.dimensions,
        hardInvalid: record.hardInvalid,
        runId: record.provenance.runId,
      });
      return Object.freeze(record);
    },
  };
}

// ---------------------------------------------------------------------------
// The standard weight-set family (REL-032) + the football engine convenience
// ---------------------------------------------------------------------------

const QUALITY_DIMENSIONS = [
  "event-source-fidelity",
  "identity-continuity",
  "temporal-consistency",
  "motion-fidelity",
  "camera-scene-correctness",
  "stylization-quality",
] as const;
const EFFICIENCY_DIMENSIONS = ["latency", "cost", "reliability", "compute-usage"] as const;

function doubledWeights(
  dimensions: readonly RewardDimension[],
  boost: readonly string[],
): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const dimension of dimensions) {
    weights[dimension.dimensionId] = boost.includes(dimension.dimensionId)
      ? dimension.weight * 2
      : dimension.weight;
  }
  return weights;
}

/**
 * The standard VERSIONED weight-set family for any domain pack (REL-032):
 * the balanced set (the pack's declared weights, verbatim), a quality-first
 * set (fidelity/continuity/consistency/motion/scene/stylization doubled),
 * and an efficiency-first set (latency/cost/reliability/compute doubled) —
 * parameterized by the domain id, so every pack gets the same three-set
 * registry shape. `footballRewardWeightSets` (below) delegates with
 * "football" and produces byte-identical sets to the v0 inline form; the
 * basketball engine binds the same helper with "basketball".
 */
export function standardRewardWeightSets(
  domainId: string,
  dimensions: readonly RewardDimension[],
): readonly RewardWeightSet[] {
  return [
    {
      weightSetId: `${domainId}-balanced`,
      version: "0.1",
      description: `The ${domainId} pack's declared weights, verbatim.`,
      weights: Object.fromEntries(dimensions.map((d) => [d.dimensionId, d.weight])),
    },
    {
      weightSetId: `${domainId}-quality-first`,
      version: "0.1",
      description: `Quality dimensions (fidelity, continuity, consistency, motion, scene, stylization) doubled.`,
      weights: doubledWeights(dimensions, QUALITY_DIMENSIONS),
    },
    {
      weightSetId: `${domainId}-efficiency-first`,
      version: "0.1",
      description: "Efficiency dimensions (latency, cost, reliability, compute) doubled.",
      weights: doubledWeights(dimensions, EFFICIENCY_DIMENSIONS),
    },
  ];
}

/**
 * The versioned football weight sets: the balanced set (the pack's declared
 * weights), a quality-first set (fidelity/consistency/stylization doubled),
 * and an efficiency-first set (latency/cost/reliability/compute doubled).
 * Since REL-032 this delegates to `standardRewardWeightSets("football", ...)`
 * — the produced sets are byte-identical to the v0 inline form (ids,
 * versions, descriptions, weights), pinned by the reward-engine tests.
 */
export function footballRewardWeightSets(
  dimensions: readonly RewardDimension[],
): readonly RewardWeightSet[] {
  return standardRewardWeightSets("football", dimensions);
}

/** The versioned football weight sets over the pack's declared dimensions. */
export const FOOTBALL_REWARD_WEIGHT_SETS: readonly RewardWeightSet[] = footballRewardWeightSets(
  FOOTBALL_REWARD_DIMENSIONS,
);

/** The football reward engine: the pack's dimensions + the three weight sets. */
export function createFootballRewardEngine(): RewardEngine {
  return createRewardEngine({
    dimensions: FOOTBALL_REWARD_DIMENSIONS,
    weightSets: FOOTBALL_REWARD_WEIGHT_SETS,
    defaultWeightSetId: "football-balanced",
  });
}
