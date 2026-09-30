/**
 * The DomainPack contract completeness tests (REL-001): the football pack
 * satisfies the frozen §3 seam — every bullet, by name — and the generic
 * seams (replay, calibration, provenance classes) behave.
 */
import { describe, expect, test } from "bun:test";
import {
  FOOTBALL_ENTITY_TYPES,
  FOOTBALL_EVENT_TAXONOMY,
  FOOTBALL_FAULT_PROFILES,
  FOOTBALL_HARD_INVALIDITY_RULES,
  FOOTBALL_OBSERVATION_TAXONOMY,
  FOOTBALL_RENDER_TARGETS,
  FOOTBALL_REWARD_DIMENSIONS,
  FootballWorldStateSchema,
  LabProvenanceClass,
  LabSimulationProvenanceLiteral,
  LAB_SIMULATION_PROVENANCE,
  createFootballWorldSimulator,
  createGeneralistBody,
  footballDomainPack,
  generateFootballScenario,
  isLabProvenanceClass,
  type DomainPack,
} from "../src";
import { FOOTBALL_LAB_EVALUATOR_ID, FOOTBALL_LAB_EVALUATOR_VERSION } from "../src";
import { LONG_SCENARIO } from "./fixtures";

describe("the football pack satisfies the frozen §3 DomainPack seam", () => {
  test("is structurally a DomainPack (compile-time + runtime presence)", () => {
    // Compile-time: the typed pack assigns to the un-parameterized seam.
    const asSeam: DomainPack = footballDomainPack;
    expect(asSeam.domainPackId).toBe("football");
    // Runtime: every §3 member is present.
    for (const member of [
      "entityTypes",
      "worldStateSchema",
      "observationTaxonomy",
      "eventTaxonomy",
      "actionSpace",
      "capabilities",
      "renderTargets",
      "qualityEvaluators",
      "hardInvalidityRules",
      "rewardDimensions",
      "scenarioGenerator",
      "faultProfiles",
      "replayAdapter",
      "calibrationAdapter",
    ] as const) {
      expect(footballDomainPack[member], `§3 member ${member}`).toBeDefined();
    }
  });

  test("entity types carry identity semantics (players keyed team+jersey, ball singular)", () => {
    expect(FOOTBALL_ENTITY_TYPES.map((t) => t.typeId).sort()).toEqual(
      ["official", "ball", "pitch-frame", "player"].sort(),
    );
    const player = FOOTBALL_ENTITY_TYPES.find((t) => t.typeId === "player");
    expect(player?.identitySemantics.persistentId).toBe(true);
    expect(player?.identitySemantics.naturalKey).toEqual(["team", "jersey"]);
    const ball = FOOTBALL_ENTITY_TYPES.find((t) => t.typeId === "ball");
    expect(ball?.identitySemantics.singular).toBe(true);
    const pitch = FOOTBALL_ENTITY_TYPES.find((t) => t.typeId === "pitch-frame");
    expect(pitch?.identitySemantics.singular).toBe(true);
  });

  test("observation taxonomy: broadcast-frame, tracking-sample, event-record with source roles", () => {
    expect(FOOTBALL_OBSERVATION_TAXONOMY.map((k) => k.kindId).sort()).toEqual(
      ["broadcast-frame", "event-record", "tracking-sample"].sort(),
    );
    for (const kind of FOOTBALL_OBSERVATION_TAXONOMY) {
      expect(kind.sourceRole.length).toBeGreaterThan(0);
      expect(typeof kind.carriesConfidence).toBe("boolean");
    }
  });

  test("event taxonomy covers the v0 progression kinds", () => {
    const ids = FOOTBALL_EVENT_TAXONOMY.map((k) => k.eventKindId);
    for (const expected of [
      "kickoff",
      "pass",
      "shot",
      "goal",
      "save",
      "throw-in",
      "goal-kick",
      "recovery",
    ]) {
      expect(ids).toContain(expected);
    }
  });

  test("action space, capabilities and render targets are declared and versioned", () => {
    expect(footballDomainPack.actionSpace.map((a) => a.actionId)).toContain("emit-canonical-event");
    for (const capability of footballDomainPack.capabilities) {
      expect(capability.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(FOOTBALL_RENDER_TARGETS.map((t) => t.targetId).sort()).toEqual(
      ["anime-npr", "original", "tactical", "three-d-game"].sort(),
    );
  });

  test("quality evaluator refs point at the v0 evaluator and its dimensions", () => {
    expect(footballDomainPack.qualityEvaluators).toHaveLength(1);
    const ref = footballDomainPack.qualityEvaluators[0];
    expect(ref?.evaluatorId).toBe(FOOTBALL_LAB_EVALUATOR_ID);
    expect(ref?.version).toBe(FOOTBALL_LAB_EVALUATOR_VERSION);
    expect(ref?.rewardDimensionIds).toHaveLength(FOOTBALL_REWARD_DIMENSIONS.length);
  });

  test("reward dimensions are the ADR-013 §8 axes (all ten)", () => {
    expect(FOOTBALL_REWARD_DIMENSIONS.map((d) => d.dimensionId).sort()).toEqual(
      [
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
      ].sort(),
    );
    for (const dimension of FOOTBALL_REWARD_DIMENSIONS) {
      expect(dimension.weight).toBeGreaterThan(0);
    }
  });

  test("hard invalidity rules are the six ADR-013 §8 gates", () => {
    expect(FOOTBALL_HARD_INVALIDITY_RULES.map((r) => r.ruleId).sort()).toEqual(
      [
        "fabricated-canonical-event",
        "fabricated-identity-as-fact",
        "rights-policy-violation",
        "impossible-output-claim",
        "provenance-bypass",
        "invalid-artifact-lineage",
      ].sort(),
    );
  });

  test("fault profiles: clean has zero rates; adversarial spans all five kinds", () => {
    const clean = FOOTBALL_FAULT_PROFILES.find((p) => p.profileId === "football-clean");
    expect(clean).toBeDefined();
    for (const rate of Object.values(clean?.rates ?? {})) expect(rate).toBe(0);
    const adversarial = FOOTBALL_FAULT_PROFILES.find((p) => p.profileId === "football-adversarial");
    expect(Object.values(adversarial?.rates ?? {}).every((rate) => rate > 0)).toBe(true);
    expect(Object.keys(adversarial?.rates ?? {})).toHaveLength(5);
  });

  test("scenario generator is the pack's own (seed-deterministic)", () => {
    const a = footballDomainPack.scenarioGenerator.generate("pack-seed", LONG_SCENARIO);
    const b = footballDomainPack.scenarioGenerator.generate("pack-seed", LONG_SCENARIO);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("the world-state schema enforces the lab-simulation law", () => {
  test("accepts a simulator-produced state", () => {
    const scenario = generateFootballScenario("schema-seed", LONG_SCENARIO);
    const tick = createFootballWorldSimulator({ scenario }).step();
    expect(FootballWorldStateSchema.safeParse(tick.groundTruth).success).toBe(true);
    expect(tick.groundTruth.provenanceClass).toBe(LAB_SIMULATION_PROVENANCE);
  });

  test("REJECTS a world state claiming real-observation provenance", () => {
    const scenario = generateFootballScenario("schema-seed", LONG_SCENARIO);
    const tick = createFootballWorldSimulator({ scenario }).step();
    const laundered = {
      ...tick.groundTruth,
      provenanceClass: "real-observation" as const,
    };
    expect(FootballWorldStateSchema.safeParse(laundered).success).toBe(false);
  });

  test("the provenance literal + class guard", () => {
    expect(LabSimulationProvenanceLiteral.parse("lab-simulation")).toBe("lab-simulation");
    expect(LabSimulationProvenanceLiteral.safeParse("real-observation").success).toBe(false);
    for (const legal of ["real-observation", "historical-replay", "lab-simulation"]) {
      expect(isLabProvenanceClass(legal)).toBe(true);
    }
    expect(isLabProvenanceClass("vibes")).toBe(false);
    expect(LabProvenanceClass.options).toHaveLength(3);
  });
});

describe("the replay + calibration adapters (§3 bullet 11)", () => {
  test("replay regroups the recorded stream by kind, order-preserving", () => {
    const scenario = generateFootballScenario("replay-seed", LONG_SCENARIO);
    const sim = createFootballWorldSimulator({ scenario });
    const observations = [
      ...sim.step().observations,
      ...sim.step().observations,
      ...sim.step().observations,
    ];
    const stream = footballDomainPack.replayAdapter.replay(observations);
    expect(stream.observations).toHaveLength(observations.length);
    const tracking = stream.byKind("tracking-sample");
    expect(tracking.every((o) => o.kindId === "tracking-sample")).toBe(true);
    expect(tracking.length).toBe(observations.filter((o) => o.kindId === "tracking-sample").length);
  });

  test("calibration pairs predicted vs observed and reports the mean error (hand-checked)", () => {
    // errors: 1-2 = -1, 2-4 = -2 → mean -1.5.
    const result = footballDomainPack.calibrationAdapter.compare([1, 2], [2, 4]);
    expect(result.pairs).toEqual([
      { predicted: 1, observed: 2, error: -1 },
      { predicted: 2, observed: 4, error: -2 },
    ]);
    expect(result.meanError).toBe(-1.5);
  });
});

describe("the generalist body binds to the pack", () => {
  test("domain compatibility names the football pack", () => {
    const body = createGeneralistBody({
      domainPackId: footballDomainPack.domainPackId,
      evaluator: {
        evaluatorId: FOOTBALL_LAB_EVALUATOR_ID,
        version: FOOTBALL_LAB_EVALUATOR_VERSION,
      },
      hardRuleIds: FOOTBALL_HARD_INVALIDITY_RULES.map((r) => r.ruleId),
    });
    expect(body.domainCompatibility.domainPackIds).toContain("football");
    // The safety policy declares the pack's hard rules as binding.
    expect(body.safetyPolicy.hardRules).toHaveLength(FOOTBALL_HARD_INVALIDITY_RULES.length);
  });
});
