/**
 * Reward engine tests (REL-007, architecture §8): composable dimensions,
 * weighted aggregation (hand-checked arithmetic), VERSIONED weight sets,
 * and the six hard-invalidity gate classes as TYPED REFUSALS — plus the
 * v0 evaluator hook's delegation to the engine (additive `reward` field).
 */
import { describe, expect, test } from "bun:test";
import {
  FOOTBALL_LAB_EVALUATOR_ID,
  FOOTBALL_LAB_EVALUATOR_VERSION,
  FOOTBALL_REWARD_WEIGHT_SETS,
  checkFootballClaims,
  createFootballLabEvaluator,
  createFootballRewardEngine,
  createRewardEngine,
  createScriptedModelRuntime,
  footballDomainPack,
  generateFootballScenario,
  isHardInvalid,
  runLab,
  type HardInvalidityContext,
  type LabClaim,
  type RewardDimension,
} from "../src";
import { SMALL_SCENARIO, generalistBundle } from "./fixtures";

const DIMENSIONS: readonly RewardDimension[] = [
  { dimensionId: "a", description: "dimension a", weight: 1 },
  { dimensionId: "b", description: "dimension b", weight: 0.5 },
];

function syntheticEngine() {
  return createRewardEngine({
    dimensions: DIMENSIONS,
    weightSets: [
      {
        weightSetId: "ws-1",
        version: "0.1",
        description: "test weights",
        weights: { a: 1, b: 0.5 },
      },
      { weightSetId: "ws-2", version: "0.2", description: "reweighted", weights: { a: 0.5, b: 1 } },
      {
        weightSetId: "ws-zero-a",
        version: "0.1",
        description: "a ignored",
        weights: { a: 0, b: 1 },
      },
    ],
    defaultWeightSetId: "ws-1",
  });
}

describe("dimension composition + weighted aggregation (hand-checked)", () => {
  test("weighted mean over measured dimensions: (1x0.5 + 0.5x1.0)/1.5 = 2/3", () => {
    const engine = syntheticEngine();
    const record = engine.score({
      dimensionScores: [
        { dimensionId: "a", score: 0.5, measured: true },
        { dimensionId: "b", score: 1.0, measured: true },
      ],
    });
    expect(record.status).toBe("valid");
    expect(record.aggregate).toBeCloseTo(2 / 3, 12);
    expect(record.measuredDimensions).toBe(2);
    expect(
      record.dimensions.find((dimension) => dimension.dimensionId === "a")?.contribution,
    ).toBeCloseTo(0.5, 12);
    expect(
      record.dimensions.find((dimension) => dimension.dimensionId === "b")?.contribution,
    ).toBeCloseTo(0.5, 12);
  });

  test("unmeasured dimensions are excluded from the denominator (no imputation)", () => {
    const record = syntheticEngine().score({
      dimensionScores: [
        { dimensionId: "a", score: 1.0, measured: true },
        { dimensionId: "b", score: 0, measured: false, note: "no evidence" },
      ],
    });
    expect(record.aggregate).toBe(1.0);
    expect(record.measuredDimensions).toBe(1);
    expect(record.unmeasuredDimensionIds).toEqual(["b"]);
    expect(record.dimensions.find((d) => d.dimensionId === "b")?.contribution).toBeNull();
  });

  test("a measured dimension with zero weight is excluded from the denominator", () => {
    const record = syntheticEngine().score({
      dimensionScores: [
        { dimensionId: "a", score: 0.25, measured: true },
        { dimensionId: "b", score: 0.9, measured: true },
      ],
      weightSetId: "ws-zero-a", // a: 0, b: 1 -> only b counts
    });
    expect(record.aggregate).toBeCloseTo(0.9, 12);
    const a = record.dimensions.find((d) => d.dimensionId === "a");
    expect(a?.weight).toBe(0);
    expect(a?.contribution).toBeNull();
  });

  test("nothing measured ⇒ honest null aggregate (never a fake zero)", () => {
    const record = syntheticEngine().score({
      dimensionScores: [
        { dimensionId: "a", score: null, measured: false },
        { dimensionId: "b", score: null, measured: false },
      ],
    });
    expect(record.aggregate).toBeNull();
    expect(record.status).toBe("valid");
  });

  test("a subset of dimensions composes (calibration/search use case)", () => {
    const record = syntheticEngine().score({
      dimensionScores: [{ dimensionId: "b", score: 0.8, measured: true }],
    });
    expect(record.aggregate).toBeCloseTo(0.8, 12);
  });

  test("a dimension outside the weight set is weighted 0, noted, never scored", () => {
    const record = syntheticEngine().score({
      dimensionScores: [
        { dimensionId: "a", score: 0.5, measured: true },
        { dimensionId: "unknown-dim", score: 1.0, measured: true },
      ],
    });
    expect(record.aggregate).toBeCloseTo(0.5, 12);
    const unknown = record.dimensions.find((d) => d.dimensionId === "unknown-dim");
    expect(unknown?.weight).toBe(0);
    expect(unknown?.note).toContain("not declared");
  });

  test("duplicate dimension scores are refused with a typed error", () => {
    expect(() =>
      syntheticEngine().score({
        dimensionScores: [
          { dimensionId: "a", score: 1, measured: true },
          { dimensionId: "a", score: 0.5, measured: true },
        ],
      }),
    ).toThrow(/duplicate dimension score/);
  });
});

describe("versioned weight sets", () => {
  const scoreA = 0.5;
  const scoreB = 1.0;

  test("the same scores aggregate differently under different weight sets (hand-checked)", () => {
    const engine = syntheticEngine();
    const first = engine.score({
      dimensionScores: [
        { dimensionId: "a", score: scoreA, measured: true },
        { dimensionId: "b", score: scoreB, measured: true },
      ],
      weightSetId: "ws-1",
    });
    const second = engine.score({
      dimensionScores: [
        { dimensionId: "a", score: scoreA, measured: true },
        { dimensionId: "b", score: scoreB, measured: true },
      ],
      weightSetId: "ws-2",
    });
    // ws-1: (1*0.5 + 0.5*1.0)/1.5 = 2/3; ws-2: (0.5*0.5 + 1*1.0)/1.5 = 5/6.
    expect(first.weightSet).toEqual({ weightSetId: "ws-1", version: "0.1" });
    expect(second.weightSet).toEqual({ weightSetId: "ws-2", version: "0.2" });
    expect(first.aggregate).toBeCloseTo(2 / 3, 12);
    expect(second.aggregate).toBeCloseTo(5 / 6, 12);
  });

  test("the three football weight sets on fixed scores: balanced 2/3, quality-first 0.6, efficiency-first 0.75", () => {
    const engine = createFootballRewardEngine();
    const scores = [
      { dimensionId: "event-source-fidelity", score: 0.5, measured: true },
      { dimensionId: "latency", score: 1.0, measured: true },
    ];
    // balanced: esf 1.0, latency 0.5 -> (0.5 + 0.5)/1.5 = 2/3
    expect(engine.score({ dimensionScores: scores }).aggregate).toBeCloseTo(2 / 3, 12);
    // quality-first: esf 2.0, latency 0.5 -> (1.0 + 0.5)/2.5 = 0.6
    expect(
      engine.score({ dimensionScores: scores, weightSetId: "football-quality-first" }).aggregate,
    ).toBeCloseTo(0.6, 12);
    // efficiency-first: esf 1.0, latency 1.0 -> (0.5 + 1.0)/2.0 = 0.75
    expect(
      engine.score({ dimensionScores: scores, weightSetId: "football-efficiency-first" }).aggregate,
    ).toBeCloseTo(0.75, 12);
    // All three registered weight sets are versioned and cover all ten dimensions.
    expect(FOOTBALL_REWARD_WEIGHT_SETS.map((set) => set.weightSetId)).toEqual([
      "football-balanced",
      "football-quality-first",
      "football-efficiency-first",
    ]);
    for (const weightSet of FOOTBALL_REWARD_WEIGHT_SETS) {
      expect(weightSet.version).toBe("0.1");
      expect(Object.keys(weightSet.weights)).toHaveLength(10);
    }
  });

  test("an unknown weight set id is a typed not-found error", () => {
    expect(() =>
      syntheticEngine().score({
        dimensionScores: [{ dimensionId: "a", score: 1, measured: true }],
        weightSetId: "no-such-set",
      }),
    ).toThrow(/unknown reward weight set/);
  });

  test("engine construction validates the weight-set registry (collectively)", () => {
    const base = {
      dimensions: DIMENSIONS,
      defaultWeightSetId: "ws-1",
    };
    expect(() =>
      createRewardEngine({
        ...base,
        weightSets: [{ weightSetId: "ws-1", version: "0.1", description: "", weights: { a: 1 } }],
      }),
    ).toThrow(/missing dimensions: b/);
    expect(() =>
      createRewardEngine({
        ...base,
        weightSets: [
          { weightSetId: "ws-1", version: "0.1", description: "", weights: { a: 1, b: 1, c: 1 } },
        ],
      }),
    ).toThrow(/unknown dimensions: c/);
    expect(() =>
      createRewardEngine({
        ...base,
        weightSets: [
          { weightSetId: "ws-1", version: "0.1", description: "", weights: { a: -1, b: 1 } },
        ],
      }),
    ).toThrow(/negative/);
    expect(() =>
      createRewardEngine({
        ...base,
        weightSets: [
          { weightSetId: "ws-1", version: "0.1", description: "", weights: { a: 0, b: 0 } },
        ],
      }),
    ).toThrow(/all-zero/);
    expect(() =>
      createRewardEngine({
        dimensions: DIMENSIONS,
        weightSets: [
          { weightSetId: "ws-1", version: "0.1", description: "", weights: { a: 1, b: 1 } },
        ],
        defaultWeightSetId: "missing-default",
      }),
    ).toThrow(/defaultWeightSetId/);
  });
});

// ---------------------------------------------------------------------------
// The six hard-invalidity gate classes, as TYPED REFUSALS
// ---------------------------------------------------------------------------

const gateContext: HardInvalidityContext = {
  runId: "run-gates",
  knownEvidenceRefs: new Set(["obs-evt-1", "obs-ts-1"]),
  renderTargetIds: ["tactical", "anime-npr", "three-d-game", "original"],
  scenarioDurationMs: 600_000,
};

/** One CONSTRUCTED violating claim per ADR-013 §8 gate class. */
const GATE_CLAIMS: readonly { ruleId: string; claim: LabClaim }[] = [
  {
    ruleId: "fabricated-canonical-event",
    claim: {
      claimKind: "canonical-event",
      claimId: "gate-1",
      eventKindId: "goal",
      clockMs: 1_000,
      evidenceRefs: [],
      provenanceClass: "lab-simulation",
    },
  },
  {
    ruleId: "fabricated-identity-as-fact",
    claim: {
      claimKind: "identity-assertion",
      claimId: "gate-2",
      entityId: "home-7",
      presentedAs: "fact",
      basis: "inferred",
      evidenceRefs: ["obs-ts-1"],
      provenanceClass: "lab-simulation",
    },
  },
  {
    ruleId: "rights-policy-violation",
    claim: {
      claimKind: "output-claim",
      claimId: "gate-3",
      renderTargetId: "tactical",
      rightsBasis: null,
      artifactLineage: ["run-gates"],
      clockMs: 5_000,
      provenanceClass: "lab-simulation",
    },
  },
  {
    ruleId: "impossible-output-claim",
    claim: {
      claimKind: "output-claim",
      claimId: "gate-4",
      renderTargetId: "holo-deck",
      rightsBasis: "lab-simulation-only",
      artifactLineage: ["run-gates"],
      clockMs: 5_000,
      provenanceClass: "lab-simulation",
    },
  },
  {
    ruleId: "provenance-bypass",
    claim: {
      claimKind: "canonical-event",
      claimId: "gate-5",
      eventKindId: "goal",
      clockMs: 1_000,
      evidenceRefs: ["obs-evt-1"],
      provenanceClass: "real-observation",
    },
  },
  {
    ruleId: "invalid-artifact-lineage",
    claim: {
      claimKind: "output-claim",
      claimId: "gate-6",
      renderTargetId: "tactical",
      rightsBasis: "lab-simulation-only",
      artifactLineage: ["somebody-elses-run"],
      clockMs: 5_000,
      provenanceClass: "lab-simulation",
    },
  },
];

describe("hard invalidity gates — typed refusals, never low scores", () => {
  const engine = createFootballRewardEngine();
  const cleanScores = [
    { dimensionId: "event-source-fidelity", score: 1.0, measured: true },
    { dimensionId: "identity-continuity", score: 1.0, measured: true },
  ];

  for (const { ruleId, claim } of GATE_CLAIMS) {
    test(`gate ${ruleId} ⇒ HardInvalid with the rule listed and a NULL aggregate`, () => {
      const violations = checkFootballClaims([claim], gateContext);
      expect(violations.map((violation) => violation.ruleId)).toContain(ruleId);
      const record = engine.score({
        dimensionScores: cleanScores,
        hardGateViolations: violations,
      });
      expect(record.status).toBe("hard-invalid");
      expect(isHardInvalid(record)).toBe(true);
      expect(record.aggregate).toBeNull(); // invalid, never "scored low"
      expect(record.hardInvalid?.kind).toBe("hard-invalid");
      expect(record.hardInvalid?.ruleIds).toContain(ruleId);
      expect(record.hardInvalid?.violationCount).toBeGreaterThan(0);
      expect(record.hardInvalid?.reason).toContain("no reward can buy validity back");
      // The dimension evidence is still recorded (a refusal is evidence).
      expect(record.dimensions).toHaveLength(2);
      expect(record.provenance.runId).toBeNull();
    });
  }

  test("multiple violations across rules: distinct sorted ruleIds, collective refusal", () => {
    // One claim tripping two rules (fabrication + impossible clock).
    const dualClaim: LabClaim = {
      claimKind: "canonical-event",
      claimId: "gate-dual",
      eventKindId: "goal",
      clockMs: 999_999_999,
      evidenceRefs: ["never-provided"],
      provenanceClass: "lab-simulation",
    };
    const violations = checkFootballClaims([dualClaim], gateContext);
    expect(violations.length).toBeGreaterThanOrEqual(2);
    const record = engine.score({
      dimensionScores: cleanScores,
      hardGateViolations: violations,
    });
    expect(record.hardInvalid?.ruleIds).toEqual([
      "fabricated-canonical-event",
      "impossible-output-claim",
    ]);
    expect(record.hardInvalid?.violationCount).toBe(violations.length);
  });

  test("clean scores ⇒ valid record, no refusal, frozen", () => {
    const record = engine.score({
      dimensionScores: cleanScores,
      provenance: { runId: "run-clean", evaluatorId: "e", evaluatorVersion: "1" },
    });
    expect(record.status).toBe("valid");
    expect(record.hardInvalid).toBeNull();
    expect(isHardInvalid(record)).toBe(false);
    expect(record.aggregate).toBeCloseTo(1.0, 12);
    expect(record.provenance.runId).toBe("run-clean");
    expect(Object.isFrozen(record)).toBe(true);
    // The record identity is content-derived and reproducible.
    const again = engine.score({
      dimensionScores: cleanScores,
      provenance: { runId: "run-clean", evaluatorId: "e", evaluatorVersion: "1" },
    });
    expect(again.rewardId).toBe(record.rewardId);
  });
});

describe("the v0 evaluator hook delegates to the engine (REL-007 upgrade)", () => {
  test("a clean run's metrics carry the full RewardRecord, recomputable by the engine", () => {
    const { bundle } = generalistBundle();
    const record = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("reward-upgrade", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(record.metrics.valid).toBe(true);
    expect(record.metrics.reward).toBeDefined();
    expect(record.metrics.reward?.status).toBe("valid");
    expect(record.metrics.reward?.weightSet.weightSetId).toBe("football-balanced");
    expect(record.metrics.reward?.evaluator.evaluatorId).toBe(FOOTBALL_LAB_EVALUATOR_ID);
    expect(record.metrics.reward?.evaluator.evaluatorVersion).toBe(FOOTBALL_LAB_EVALUATOR_VERSION);
    // The engine reproduces the attached record exactly from the same inputs.
    const engine = createFootballRewardEngine();
    const recomputed = engine.score({
      dimensionScores: record.metrics.dimensions,
      hardGateViolations: record.metrics.violations,
      provenance: {
        runId: record.runId,
        evaluatorId: record.metrics.evaluatorId,
        evaluatorVersion: record.metrics.version,
      },
    });
    expect(JSON.stringify(recomputed)).toBe(JSON.stringify(record.metrics.reward));
    // Backwards compatibility: overall stays the plain mean of measured dims.
    const measured = record.metrics.dimensions
      .filter((dimension) => dimension.measured && dimension.score !== null)
      .map((dimension) => dimension.score as number);
    const plainMean = measured.reduce((sum, score) => sum + score, 0) / measured.length;
    expect(record.metrics.overall).toBeCloseTo(plainMean, 12);
  });

  test("a fabricating run's reward is the typed HardInvalid refusal", () => {
    // The lab-run suite's fabricating pattern: a runtime that emits a
    // canonical event citing evidence the run never provided.
    const { bundle, definition } = generalistBundle();
    const fabricatingRuntime = createScriptedModelRuntime({
      modelId: "fabricating-policy",
      modelVersion: "0.1.0",
      handler: (input) => ({
        actions: [
          {
            actionId: "emit-canonical-event",
            claimId: "claim-fabricated",
            eventKindId: "goal",
            evidenceRef: "obs-never-provided",
            clockMs: input.clockMs,
          },
        ],
      }),
    });
    const badBundle = {
      definition: {
        ...definition,
        nodes: [
          {
            ...definition.nodes[0]!,
            binding: {
              modelId: "fabricating-policy",
              modelVersion: "0.1.0",
              runtimeId: fabricatingRuntime.runtimeId,
              runtimeVersion: "0.1.0",
            },
          },
        ],
      },
      bodies: bundle.bodies,
      runtimes: new Map([[fabricatingRuntime.runtimeId, fabricatingRuntime]]),
    };
    const record = runLab({
      domainPack: footballDomainPack,
      organization: badBundle,
      scenario: generateFootballScenario("reward-fabricated", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(record.metrics.valid).toBe(false);
    expect(record.metrics.reward?.status).toBe("hard-invalid");
    expect(isHardInvalid(record.metrics.reward!)).toBe(true);
    expect(record.metrics.reward?.hardInvalid?.ruleIds).toContain("fabricated-canonical-event");
    expect(record.metrics.reward?.aggregate).toBeNull();
  });
});
