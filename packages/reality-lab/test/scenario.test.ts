/**
 * Scenario generator seed-determinism (REL-001): same seed ⇒ BYTE-IDENTICAL
 * scenario record (JSON-serialization identical, ids included); different
 * seed ⇒ different record; config is applied-with-defaults before hashing.
 */
import { describe, expect, test } from "bun:test";
import { FootballScenarioConfigSchema, generateFootballScenario } from "../src";
import { SMALL_SCENARIO } from "./fixtures";

describe("seed determinism", () => {
  test("same seed ⇒ byte-identical record (ids included)", () => {
    const a = generateFootballScenario("scenario-seed-1", SMALL_SCENARIO);
    const b = generateFootballScenario("scenario-seed-1", SMALL_SCENARIO);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.scenarioId).toBe(b.scenarioId);
    expect(a).toEqual(b);
  });

  test("different seed ⇒ different record (kickoff side and/or formation differ)", () => {
    const a = generateFootballScenario("scenario-seed-1", SMALL_SCENARIO);
    const b = generateFootballScenario("scenario-seed-2", SMALL_SCENARIO);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(a.scenarioId).not.toBe(b.scenarioId);
  });

  test("scenario ids are content-derived: explicit defaults equal omitted defaults", () => {
    const omitted = generateFootballScenario("same-seed", {});
    const explicit = generateFootballScenario("same-seed", {
      matchDurationMs: 600_000,
      tickMs: 100,
      playersPerSide: 7,
      sourceProfile: "clean",
      competitionLabel: "lab-friendly",
    });
    // Defaults applied BEFORE hashing: identical effective config ⇒ identical id.
    expect(omitted.scenarioId).toBe(explicit.scenarioId);
    expect(JSON.stringify(omitted)).toBe(JSON.stringify(explicit));
  });

  test("config overrides change the record and the id", () => {
    const base = generateFootballScenario("override-seed", SMALL_SCENARIO);
    const overridden = generateFootballScenario("override-seed", {
      ...SMALL_SCENARIO,
      playersPerSide: 5,
    });
    expect(overridden.scenarioId).not.toBe(base.scenarioId);
    expect(overridden.config.playersPerSide).toBe(5);
    expect(overridden.initialConditions.players).toHaveLength(10);
  });
});

describe("the record's shape", () => {
  test("initial conditions: formation, kickoff team, ball at center, tick math", () => {
    const scenario = generateFootballScenario("shape-seed", {
      ...SMALL_SCENARIO,
      playersPerSide: 7,
    });
    expect(scenario.initialConditions.players).toHaveLength(14);
    const jerseys = new Set(scenario.initialConditions.players.map((p) => `${p.team}-${p.jersey}`));
    expect(jerseys.size).toBe(14); // (team, jersey) is the natural key — unique
    expect(scenario.initialConditions.ball.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(["home", "away"]).toContain(scenario.initialConditions.kickoffTeam);
    expect(scenario.initialConditions.expectedTickCount).toBe(
      Math.ceil(scenario.config.matchDurationMs / scenario.config.tickMs),
    );
  });

  test("pack identity is pinned on the record", () => {
    const scenario = generateFootballScenario("shape-seed", SMALL_SCENARIO);
    expect(scenario.domainPackId).toBe("football");
    expect(scenario.domainPackVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("config validation", () => {
  test("the zod config schema fills defaults and validates ranges", () => {
    const parsed = FootballScenarioConfigSchema.parse({});
    expect(parsed.matchDurationMs).toBe(600_000);
    expect(parsed.tickMs).toBe(100);
    expect(parsed.playersPerSide).toBe(7);
    expect(parsed.sourceProfile).toBe("clean");
    expect(FootballScenarioConfigSchema.safeParse({ matchDurationMs: 5 }).success).toBe(false); // below the 10s minimum
    expect(FootballScenarioConfigSchema.safeParse({ playersPerSide: 12 }).success).toBe(false); // above the 11 maximum
  });

  test("generate refuses malformed configs with a typed RangeError", () => {
    expect(() => generateFootballScenario("bad-seed", { matchDurationMs: 5 })).toThrow(RangeError);
    expect(() => generateFootballScenario("bad-seed", { tickMs: 5 })).toThrow(RangeError);
  });
});
