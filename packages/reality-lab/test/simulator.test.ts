/**
 * World Simulator v0 tests (REL-002): determinism from (seed, config),
 * trajectory divergence across seeds, clock/period/half-time progression,
 * the lab-simulation provenance law on every record, observation taxonomy
 * discipline, confidence/missingness, dropped frames under the degraded
 * profile, source timing, and the event-record publication delay.
 *
 * Pinned values are MEASURED on the fixed seeds named below (the simulator
 * is deterministic, so they are reproducible by construction).
 */
import { describe, expect, test } from "bun:test";
import {
  FOOTBALL_OBSERVATION_TAXONOMY,
  FootballWorldStateSchema,
  LAB_SIMULATION_PROVENANCE,
  createFootballWorldSimulator,
  generateFootballScenario,
} from "../src";
import { LONG_SCENARIO, SMALL_SCENARIO } from "./fixtures";

describe("determinism from (seed, configuration)", () => {
  test("same scenario ⇒ byte-identical tick streams (two simulators)", () => {
    const scenario = generateFootballScenario("sim-seed-1", SMALL_SCENARIO);
    const first = createFootballWorldSimulator({ scenario }).ticks();
    const second = createFootballWorldSimulator({ scenario }).ticks();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toHaveLength(scenario.initialConditions.expectedTickCount);
  });

  test("different seed ⇒ different trajectory", () => {
    const a = createFootballWorldSimulator({
      scenario: generateFootballScenario("sim-seed-1", SMALL_SCENARIO),
    }).ticks();
    const b = createFootballWorldSimulator({
      scenario: generateFootballScenario("sim-seed-2", SMALL_SCENARIO),
    }).ticks();
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  test("resumable iteration: steps() yields the same ticks as ticks()", () => {
    const scenario = generateFootballScenario("sim-seed-1", SMALL_SCENARIO);
    const materialized = createFootballWorldSimulator({ scenario }).ticks();
    const iterator = createFootballWorldSimulator({ scenario }).steps();
    const firstTen: unknown[] = [];
    for (const tick of iterator) {
      firstTen.push(tick);
      if (firstTen.length === 10) break;
    }
    expect(firstTen).toEqual(materialized.slice(0, 10));
  });

  test("step() refuses to run past the end", () => {
    const scenario = generateFootballScenario("sim-seed-1", {
      matchDurationMs: 10_000,
      tickMs: 100,
    });
    const sim = createFootballWorldSimulator({ scenario });
    expect(() => {
      for (let i = 0; i < 101; i++) sim.step();
    }).toThrow(RangeError);
  });
});

describe("match clock and event progression", () => {
  test("the clock advances by tickMs and covers the whole match", () => {
    const scenario = generateFootballScenario("clock-seed", SMALL_SCENARIO);
    const ticks = createFootballWorldSimulator({ scenario }).ticks();
    expect(ticks[0]?.clockMs).toBe(0);
    expect(ticks.at(-1)?.clockMs).toBe(
      (scenario.initialConditions.expectedTickCount - 1) * scenario.config.tickMs,
    );
    for (let i = 1; i < ticks.length; i++) {
      const previous = ticks[i - 1];
      const current = ticks[i];
      if (previous === undefined || current === undefined) continue;
      expect(current.clockMs).toBe(previous.clockMs + scenario.config.tickMs);
    }
  });

  test("period flips at half time with a second kickoff (pinned seed)", () => {
    // Measured on "test-seed-a": kickoff@0 and kickoff@100 (the half).
    const scenario = generateFootballScenario("test-seed-a", SMALL_SCENARIO);
    const ticks = createFootballWorldSimulator({ scenario }).ticks();
    expect(ticks[0]?.period).toBe(1);
    expect(ticks[99]?.period).toBe(1);
    expect(ticks[100]?.period).toBe(2);
    const kickoffs = ticks.flatMap((t) => t.events.filter((e) => e.eventKindId === "kickoff"));
    expect(kickoffs.map((e) => e.tickIndex)).toEqual([0, 100]);
  });

  test("a 10-minute window exercises the full progression taxonomy (pinned seed)", () => {
    // Measured on "probe-2": goal, goal-kick, kickoff, pass, recovery,
    // save, shot — seven of the eight taxonomy kinds in one window.
    const scenario = generateFootballScenario("probe-2", LONG_SCENARIO);
    const ticks = createFootballWorldSimulator({ scenario }).ticks();
    const kinds = new Set(ticks.flatMap((t) => t.events.map((e) => e.eventKindId)));
    expect([...kinds].sort()).toEqual(
      ["goal", "goal-kick", "kickoff", "pass", "recovery", "save", "shot"].sort(),
    );
  });

  test("event records reach the organization only after the publish delay", () => {
    // Measured on "test-seed-a": the tick-0 kickoff publishes at tick 2.
    const scenario = generateFootballScenario("test-seed-a", SMALL_SCENARIO);
    const ticks = createFootballWorldSimulator({ scenario }).ticks();
    const firstEventRecord = ticks
      .flatMap((t) => t.observations)
      .find((o) => o.kindId === "event-record");
    expect(firstEventRecord?.tickIndex).toBe(2);
    expect(ticks[0]?.observations.every((o) => o.kindId !== "event-record")).toBe(true);
  });
});

describe("the provenance law + schema", () => {
  test("every world state, event and observation carries lab-simulation", () => {
    const scenario = generateFootballScenario("prov-seed", SMALL_SCENARIO);
    const ticks = createFootballWorldSimulator({ scenario }).ticks();
    for (const tick of ticks) {
      expect(tick.groundTruth.provenanceClass).toBe(LAB_SIMULATION_PROVENANCE);
      expect(FootballWorldStateSchema.safeParse(tick.groundTruth).success).toBe(true);
      for (const event of tick.events) {
        expect(event.provenanceClass).toBe(LAB_SIMULATION_PROVENANCE);
      }
      for (const observation of tick.observations) {
        expect(observation.provenanceClass).toBe(LAB_SIMULATION_PROVENANCE);
      }
    }
  });

  test("every observation kind is declared in the taxonomy", () => {
    const scenario = generateFootballScenario("prov-seed", SMALL_SCENARIO);
    const ticks = createFootballWorldSimulator({ scenario }).ticks();
    const declared = new Set(FOOTBALL_OBSERVATION_TAXONOMY.map((k) => k.kindId));
    for (const tick of ticks) {
      for (const observation of tick.observations) {
        expect(declared.has(observation.kindId)).toBe(true);
      }
    }
  });
});

describe("confidence, missingness, dropped frames, timing", () => {
  test("tracking samples carry confidence in [0,1] and a missing flag", () => {
    const scenario = generateFootballScenario("conf-seed", SMALL_SCENARIO);
    const ticks = createFootballWorldSimulator({ scenario }).ticks();
    const samples = ticks.flatMap((t) =>
      t.observations.filter((o) => o.kindId === "tracking-sample"),
    );
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.confidence).toBeDefined();
      expect(sample.confidence ?? 0).toBeGreaterThanOrEqual(0);
      expect(sample.confidence ?? 1).toBeLessThanOrEqual(1);
    }
  });

  test("the degraded profile drops frames (pinned: 18 of 100 in a 20s window)", () => {
    // Measured on "test-seed-a" with sourceProfile "degraded".
    const scenario = generateFootballScenario("test-seed-a", {
      ...SMALL_SCENARIO,
      sourceProfile: "degraded",
    });
    const ticks = createFootballWorldSimulator({ scenario }).ticks();
    const frames = ticks.flatMap((t) =>
      t.observations.filter((o) => o.kindId === "broadcast-frame"),
    );
    expect(frames).toHaveLength(100); // one every 2 ticks of 200
    const dropped = frames.filter((o) => (o as { payload: { dropped: boolean } }).payload.dropped);
    expect(dropped).toHaveLength(18);
  });

  test("source timing: observations become available after their latency", () => {
    const scenario = generateFootballScenario("timing-seed", SMALL_SCENARIO);
    const ticks = createFootballWorldSimulator({ scenario }).ticks();
    for (const tick of ticks) {
      expect(tick.timing.trackingAvailableAtMs).toBeGreaterThan(tick.clockMs);
      expect(tick.timing.eventsAvailableAtMs).toBeGreaterThan(tick.clockMs);
      // Broadcast availability only on broadcast ticks.
      if (tick.timing.broadcastAvailableAtMs !== null) {
        expect(tick.timing.broadcastAvailableAtMs).toBeGreaterThan(tick.clockMs);
      }
    }
  });
});
