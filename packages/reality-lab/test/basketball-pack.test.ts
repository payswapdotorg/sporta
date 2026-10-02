/**
 * Basketball Domain Pack tests (REL-032): the pack-contract completeness —
 * EVERY §3 field present and shaped at football's v0 depth — plus the
 * seed-determinism law of the scenario generator, and the six §8 hard
 * invalidity gate classes as TYPED REFUSALS with constructed violations
 * (built through the same shared rule factory football uses).
 */
import { describe, expect, test } from "bun:test";
import {
  BASKETBALL_ACTION_SPACE,
  BASKETBALL_CAPABILITIES,
  BASKETBALL_ENTITY_TYPES,
  BASKETBALL_EVENT_TAXONOMY,
  BASKETBALL_FAULT_PROFILES,
  BASKETBALL_HARD_INVALIDITY_RULES,
  BASKETBALL_LAB_EVALUATOR_ID,
  BASKETBALL_LAB_EVALUATOR_VERSION,
  BASKETBALL_OBSERVATION_TAXONOMY,
  BASKETBALL_QUALITY_EVALUATORS,
  BASKETBALL_RENDER_TARGETS,
  BASKETBALL_REWARD_DIMENSIONS,
  BASKETBALL_DOMAIN_PACK_ID,
  BASKETBALL_DOMAIN_PACK_VERSION,
  BasketballWorldStateSchema,
  basketballDomainPack,
  basketballScenarioGenerator,
  checkBasketballClaims,
  createBasketballLabEvaluator,
  createBasketballRewardEngine,
  generateBasketballScenario,
  type HardInvalidityContext,
  type LabClaim,
} from "../src";
import { BASKETBALL_SMALL_SCENARIO } from "./fixtures";

function gateContext(overrides: Partial<HardInvalidityContext> = {}): HardInvalidityContext {
  return {
    runId: "run-1",
    knownEvidenceRefs: new Set(["obs-evt-ev-3-0"]),
    renderTargetIds: BASKETBALL_RENDER_TARGETS.map((target) => target.targetId),
    scenarioDurationMs: 20_000,
    ...overrides,
  };
}

describe("the basketball pack contract (§3 completeness, football's v0 depth)", () => {
  test("identity: domainPackId basketball, version 0.1.0, evaluator ref wired", () => {
    expect(BASKETBALL_DOMAIN_PACK_ID).toBe("basketball");
    expect(BASKETBALL_DOMAIN_PACK_VERSION).toBe("0.1.0");
    expect(basketballDomainPack.domainPackId).toBe("basketball");
    expect(basketballDomainPack.version).toBe("0.1.0");
    expect(BASKETBALL_QUALITY_EVALUATORS).toHaveLength(1);
    expect(BASKETBALL_QUALITY_EVALUATORS[0]?.evaluatorId).toBe(BASKETBALL_LAB_EVALUATOR_ID);
    expect(BASKETBALL_QUALITY_EVALUATORS[0]?.version).toBe(BASKETBALL_LAB_EVALUATOR_VERSION);
    expect(BASKETBALL_QUALITY_EVALUATORS[0]?.rewardDimensionIds).toHaveLength(
      BASKETBALL_REWARD_DIMENSIONS.length,
    );
  });

  test("§3 bullet 1 — entity types with identity semantics (player/ball/official/court-frame)", () => {
    expect(BASKETBALL_ENTITY_TYPES.map((entity) => entity.typeId)).toEqual([
      "player",
      "ball",
      "official",
      "court-frame",
    ]);
    const player = BASKETBALL_ENTITY_TYPES[0]?.identitySemantics;
    expect(player?.persistentId).toBe(true);
    expect(player?.naturalKey).toEqual(["team", "jersey"]);
    expect(player?.singular).toBe(false);
    expect(BASKETBALL_ENTITY_TYPES[1]?.identitySemantics.singular).toBe(true); // the ball
    expect(BASKETBALL_ENTITY_TYPES[3]?.identitySemantics.singular).toBe(true); // the court frame
    for (const entity of BASKETBALL_ENTITY_TYPES) {
      expect(entity.description.length).toBeGreaterThan(0);
      expect(entity.identitySemantics.notes.length).toBeGreaterThan(0);
    }
  });

  test("§3 bullet 2 — the zod world-state schema pins the lab-simulation provenance", () => {
    const scenario = generateBasketballScenario("pack-schema", BASKETBALL_SMALL_SCENARIO);
    const state = {
      schemaVersion: "basketball-world-state/0.1" as const,
      provenanceClass: "lab-simulation" as const,
      clockMs: 0,
      period: 1 as const,
      players: [],
      ball: {
        position: { x: 0, y: 0, z: 1.95 },
        velocity: { vx: 0, vy: 0, vz: 0 },
        possessedBy: null,
        confidence: 1,
      },
      officials: [
        {
          officialId: "official-crew-chief",
          role: "crew-chief" as const,
          position: { x: 0, y: 2 },
          confidence: 0.99,
        },
      ],
      courtFrame: {
        frameId: "court" as const,
        lengthM: 28,
        widthM: 15,
        units: "meters" as const,
        origin: "center-court" as const,
      },
    };
    expect(BasketballWorldStateSchema.safeParse(state).success).toBe(true);
    // The provenance law is machine-checked: a production-truth claim refuses.
    expect(
      BasketballWorldStateSchema.safeParse({ ...state, provenanceClass: "real-observation" })
        .success,
    ).toBe(false);
    // The quarter label is 1..4 (the pack's period semantics).
    expect(BasketballWorldStateSchema.safeParse({ ...state, period: 5 }).success).toBe(false);
    expect(BasketballWorldStateSchema.safeParse({ ...state, period: 4 }).success).toBe(true);
    expect(scenario.initialConditions.expectedTickCount).toBe(200);
  });

  test("§3 bullet 3 — observation + event taxonomies (3 generic source kinds, 8 events)", () => {
    expect(BASKETBALL_OBSERVATION_TAXONOMY.map((kind) => kind.kindId)).toEqual([
      "broadcast-frame",
      "tracking-sample",
      "event-record",
    ]);
    for (const kind of BASKETBALL_OBSERVATION_TAXONOMY) {
      expect(kind.sourceRole.length).toBeGreaterThan(0);
      expect(kind.description.length).toBeGreaterThan(0);
    }
    expect(BASKETBALL_EVENT_TAXONOMY).toHaveLength(8);
    expect(BASKETBALL_EVENT_TAXONOMY.map((event) => event.eventKindId)).toEqual([
      "jump-ball",
      "pass",
      "shot",
      "made-basket",
      "block",
      "rebound",
      "turnover",
      "free-throw",
    ]);
    for (const event of BASKETBALL_EVENT_TAXONOMY) {
      expect(event.participantEntityTypes).toContain("ball");
      expect(event.description.length).toBeGreaterThan(0);
    }
  });

  test("§3 bullets 4-7 — action space, capabilities, render targets, evaluator refs", () => {
    expect(BASKETBALL_ACTION_SPACE.map((action) => action.actionId)).toEqual([
      "emit-canonical-event",
      "emit-identity-assertion",
      "request-render",
      "escalate-uncertainty",
    ]);
    expect(BASKETBALL_CAPABILITIES).toHaveLength(8);
    expect(BASKETBALL_RENDER_TARGETS.map((target) => target.targetId)).toEqual([
      "tactical",
      "anime-npr",
      "three-d-game",
      "original",
    ]);
    expect(BASKETBALL_REWARD_DIMENSIONS).toHaveLength(10);
    // The §8 reward dimension list is domain-neutral — same ids as football's.
    expect(BASKETBALL_REWARD_DIMENSIONS.map((dimension) => dimension.dimensionId)).toEqual([
      "event-source-fidelity",
      "identity-continuity",
      "temporal-consistency",
      "motion-fidelity",
      "camera-scene-correctness",
      "stylization-quality",
      "latency",
      "cost",
      "reliability",
      "compute-usage",
    ]);
  });

  test("§3 bullets 10-11 — scenario generator, fault profiles, replay + calibration adapters", () => {
    expect(basketballDomainPack.scenarioGenerator).toBe(basketballScenarioGenerator);
    expect(BASKETBALL_FAULT_PROFILES.map((profile) => profile.profileId)).toEqual([
      "basketball-clean",
      "basketball-noisy-broadcast",
      "basketball-adversarial",
    ]);
    expect(basketballDomainPack.replayAdapter.adapterId).toBe("basketball-list-replay/0.1");
    expect(basketballDomainPack.calibrationAdapter.adapterId).toBe(
      "basketball-mean-error-calibration/0.1",
    );
    // The basketball reward engine + evaluator are constructible and versioned.
    const engine = createBasketballRewardEngine();
    expect(engine.defaultWeightSetId).toBe("basketball-balanced");
    expect(engine.weightSets.map((set) => set.weightSetId)).toEqual([
      "basketball-balanced",
      "basketball-quality-first",
      "basketball-efficiency-first",
    ]);
    const evaluator = createBasketballLabEvaluator();
    expect(evaluator.evaluatorId).toBe("basketball-lab-evaluator");
    expect(evaluator.version).toBe("0.1.0");
  });
});

describe("the basketball scenario generator (the §3 seed-determinism law)", () => {
  test("same seed ⇒ byte-identical record (JSON string equality, ids included)", () => {
    const first = generateBasketballScenario(
      "basketball-scenario-seed-1",
      BASKETBALL_SMALL_SCENARIO,
    );
    const second = generateBasketballScenario(
      "basketball-scenario-seed-1",
      BASKETBALL_SMALL_SCENARIO,
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.scenarioId).toBe(second.scenarioId);
  });

  test("different seed ⇒ different record; overrides apply before hashing", () => {
    const first = generateBasketballScenario(
      "basketball-scenario-seed-1",
      BASKETBALL_SMALL_SCENARIO,
    );
    const second = generateBasketballScenario(
      "basketball-scenario-seed-2",
      BASKETBALL_SMALL_SCENARIO,
    );
    expect(first.scenarioId).not.toBe(second.scenarioId);
    const short = generateBasketballScenario("basketball-scenario-seed-1", {
      matchDurationMs: 12_000,
    });
    expect(short.config.matchDurationMs).toBe(12_000);
    expect(short.initialConditions.expectedTickCount).toBe(120);
    expect(short.scenarioId).not.toBe(first.scenarioId);
  });

  test("defaults apply deterministically (10-minute, 100ms tick, 5-on-court)", () => {
    const record = generateBasketballScenario("basketball-defaults");
    expect(record.config.matchDurationMs).toBe(600_000);
    expect(record.config.tickMs).toBe(100);
    expect(record.config.playersPerSide).toBe(5);
    expect(record.config.sourceProfile).toBe("clean");
    expect(record.initialConditions.players).toHaveLength(10);
    // Jersey 0 is legal in basketball: the first slot of each side wears it.
    expect(record.initialConditions.players[0]?.jersey).toBe(0);
    expect(record.initialConditions.officials).toHaveLength(3);
  });
});

describe("the basketball hard gates (§8 — six classes, typed refusals, shared factory)", () => {
  const rules = BASKETBALL_HARD_INVALIDITY_RULES;
  const baseClaim = {
    claimKind: "canonical-event" as const,
    claimId: "claim-1",
    eventKindId: "pass",
    clockMs: 100,
    evidenceRefs: ["obs-evt-ev-3-0"],
    provenanceClass: "lab-simulation" as const,
  };

  test("the rule set is the shared factory's six classes, in order", () => {
    expect(rules.map((rule) => rule.ruleId)).toEqual([
      "fabricated-canonical-event",
      "fabricated-identity-as-fact",
      "rights-policy-violation",
      "impossible-output-claim",
      "provenance-bypass",
      "invalid-artifact-lineage",
    ]);
  });

  test("class 1 — fabricated canonical event (zero evidence / unreceived evidence)", () => {
    const zero = checkBasketballClaims([{ ...baseClaim, evidenceRefs: [] }], gateContext());
    expect(zero).toHaveLength(1);
    expect(zero[0]?.ruleId).toBe("fabricated-canonical-event");
    const unreceived = checkBasketballClaims(
      [{ ...baseClaim, evidenceRefs: ["obs-evt-ev-99-0"] }],
      gateContext(),
    );
    expect(unreceived[0]?.ruleId).toBe("fabricated-canonical-event");
    // A well-evidenced claim is clean across all six rules.
    expect(checkBasketballClaims([baseClaim], gateContext())).toHaveLength(0);
  });

  test("class 2 — fabricated identity presented as fact (inference laundered into fact)", () => {
    const claim: LabClaim = {
      claimKind: "identity-assertion",
      claimId: "claim-id-1",
      entityId: "home-0",
      presentedAs: "fact",
      basis: "inferred",
      evidenceRefs: ["obs-ts-1-home-0"],
      provenanceClass: "lab-simulation",
    };
    const violations = checkBasketballClaims([claim], gateContext());
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe("fabricated-identity-as-fact");
    // Presented as an honest inference, the same assertion is clean.
    expect(
      checkBasketballClaims([{ ...claim, presentedAs: "inference" }], gateContext()),
    ).toHaveLength(0);
  });

  test("class 3 — rights/policy violation (output claim with no rights basis)", () => {
    const claim: LabClaim = {
      claimKind: "output-claim",
      claimId: "claim-render-1",
      renderTargetId: "tactical",
      rightsBasis: null,
      artifactLineage: ["run-1"],
      clockMs: 100,
      provenanceClass: "lab-simulation",
    };
    const violations = checkBasketballClaims([claim], gateContext());
    expect(violations[0]?.ruleId).toBe("rights-policy-violation");
  });

  test("class 4 — impossible output claim (undeclared target / beyond the clock)", () => {
    const undeclared: LabClaim = {
      claimKind: "output-claim",
      claimId: "claim-render-2",
      renderTargetId: "highlight-reel",
      rightsBasis: "lab-simulation-only",
      artifactLineage: ["run-1"],
      clockMs: 100,
      provenanceClass: "lab-simulation",
    };
    expect(checkBasketballClaims([undeclared], gateContext())[0]?.ruleId).toBe(
      "impossible-output-claim",
    );
    const late: LabClaim = {
      claimKind: "output-claim",
      claimId: "claim-render-3",
      renderTargetId: "tactical",
      rightsBasis: "lab-simulation-only",
      artifactLineage: ["run-1"],
      clockMs: 999_999,
      provenanceClass: "lab-simulation",
    };
    expect(checkBasketballClaims([late], gateContext())[0]?.ruleId).toBe("impossible-output-claim");
    const lateEvent: LabClaim = { ...baseClaim, clockMs: 999_999 };
    expect(checkBasketballClaims([lateEvent], gateContext())[0]?.ruleId).toBe(
      "impossible-output-claim",
    );
  });

  test("class 5 — provenance bypass (a non-lab-simulation class inside a lab run)", () => {
    const laundered: LabClaim = {
      ...baseClaim,
      provenanceClass: "real-observation" as const,
    };
    const violations = checkBasketballClaims([laundered], gateContext());
    expect(violations[0]?.ruleId).toBe("provenance-bypass");
    expect(violations[0]?.evidence.provenanceClass).toBe("real-observation");
  });

  test("class 6 — invalid artifact lineage (lineage not rooting at the run)", () => {
    const claim: LabClaim = {
      claimKind: "output-claim",
      claimId: "claim-render-4",
      renderTargetId: "tactical",
      rightsBasis: "lab-simulation-only",
      artifactLineage: ["some-other-run"],
      clockMs: 100,
      provenanceClass: "lab-simulation",
    };
    expect(checkBasketballClaims([claim], gateContext())[0]?.ruleId).toBe(
      "invalid-artifact-lineage",
    );
    expect(
      checkBasketballClaims([{ ...claim, artifactLineage: [] }], gateContext())[0]?.ruleId,
    ).toBe("invalid-artifact-lineage");
  });

  test("violations are typed refusal records, never exceptions, and collective", () => {
    const bad: LabClaim = {
      ...baseClaim,
      evidenceRefs: [],
      provenanceClass: "historical-replay" as const,
    };
    const violations = checkBasketballClaims([bad], gateContext());
    // Both firing rules are collected in one pass: fabricated evidence AND bypass.
    expect(violations.map((violation) => violation.ruleId).sort()).toEqual([
      "fabricated-canonical-event",
      "provenance-bypass",
    ]);
    for (const violation of violations) {
      expect(typeof violation.reason).toBe("string");
      expect(violation.claimId).toBe("claim-1");
    }
  });
});
