/**
 * Fault injection tests (REL-003): the schedule is deterministic from seed,
 * typed and replayable; injection changes the trajectory deterministically;
 * every fault kind is reachable under the adversarial profile; active
 * windows are exact.
 *
 * Pinned values are MEASURED on the fixed seeds named below.
 */
import { describe, expect, test } from "bun:test";
import {
  FAULT_KINDS,
  FOOTBALL_FAULT_PROFILES,
  activeFaultsAt,
  createFootballWorldSimulator,
  generateFaultSchedule,
  generateFootballScenario,
  hasActiveFault,
} from "../src";
import { SMALL_SCENARIO } from "./fixtures";

const adversarial = FOOTBALL_FAULT_PROFILES.find((p) => p.profileId === "football-adversarial")!;

describe("schedule determinism", () => {
  test("same (seed, tickCount, profile) ⇒ byte-identical schedule", () => {
    const a = generateFaultSchedule({ seed: "fault-seed", tickCount: 200, profile: adversarial });
    const b = generateFaultSchedule({ seed: "fault-seed", tickCount: 200, profile: adversarial });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.scheduleId).toBe(b.scheduleId);
  });

  test("different seed ⇒ different schedule", () => {
    const a = generateFaultSchedule({ seed: "fault-seed", tickCount: 200, profile: adversarial });
    const b = generateFaultSchedule({ seed: "fault-seed-2", tickCount: 200, profile: adversarial });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  test("the clean profile injects nothing", () => {
    const clean = FOOTBALL_FAULT_PROFILES.find((p) => p.profileId === "football-clean")!;
    const schedule = generateFaultSchedule({ seed: "any", tickCount: 500, profile: clean });
    expect(schedule.entries).toEqual([]);
  });

  test("all five fault kinds are reachable (pinned: 25 entries, 5 kinds)", () => {
    // Measured on ("fault-seed", 200 ticks, adversarial).
    const schedule = generateFaultSchedule({
      seed: "fault-seed",
      tickCount: 200,
      profile: adversarial,
    });
    expect(schedule.entries).toHaveLength(25);
    expect(new Set(schedule.entries.map((e) => e.faultKind))).toEqual(new Set(FAULT_KINDS));
  });

  test("entries are typed, sorted, and carry their params", () => {
    const schedule = generateFaultSchedule({
      seed: "fault-seed",
      tickCount: 200,
      profile: adversarial,
    });
    for (const entry of schedule.entries) {
      expect(FAULT_KINDS).toContain(entry.faultKind);
      expect(entry.tickIndex).toBeGreaterThanOrEqual(0);
      expect(entry.durationTicks).toBeGreaterThanOrEqual(1);
      expect(typeof entry.params).toBe("object");
    }
    for (let i = 1; i < schedule.entries.length; i++) {
      expect(schedule.entries[i]!.tickIndex).toBeGreaterThanOrEqual(
        schedule.entries[i - 1]!.tickIndex,
      );
    }
  });
});

describe("active windows", () => {
  test("activeFaultsAt covers exactly [start, start + duration)", () => {
    const schedule = generateFaultSchedule({
      seed: "fault-seed",
      tickCount: 200,
      profile: adversarial,
    });
    const first = schedule.entries[0]!;
    expect(hasActiveFault(schedule, first.tickIndex, first.faultKind)).toBe(true);
    expect(
      hasActiveFault(schedule, first.tickIndex + first.durationTicks - 1, first.faultKind),
    ).toBe(true);
    expect(hasActiveFault(schedule, first.tickIndex + first.durationTicks, first.faultKind)).toBe(
      false,
    );
    expect(activeFaultsAt(schedule, first.tickIndex).map((e) => e.faultKind)).toContain(
      first.faultKind,
    );
  });
});

describe("injection into the simulator", () => {
  const schedule = generateFaultSchedule({
    seed: "fault-seed",
    tickCount: 200,
    profile: adversarial,
  });

  test("a faulted trajectory differs from the clean one", () => {
    const scenario = generateFootballScenario("fault-seed", SMALL_SCENARIO);
    const clean = createFootballWorldSimulator({ scenario }).ticks();
    const dirty = createFootballWorldSimulator({ scenario, faultSchedule: schedule }).ticks();
    expect(JSON.stringify(clean)).not.toBe(JSON.stringify(dirty));
  });

  test("applied faults surface on the affected ticks (pinned: 82 fault ticks)", () => {
    // Measured on ("fault-seed", 20s window, the schedule above).
    const scenario = generateFootballScenario("fault-seed", SMALL_SCENARIO);
    const dirty = createFootballWorldSimulator({ scenario, faultSchedule: schedule }).ticks();
    expect(dirty.filter((t) => t.appliedFaults.length > 0)).toHaveLength(82);
    const kinds = new Set(dirty.flatMap((t) => t.appliedFaults.map((f) => f.faultKind)));
    expect(kinds.size).toBeGreaterThan(1);
  });

  test("the same schedule replays byte-identically", () => {
    const scenario = generateFootballScenario("fault-seed", SMALL_SCENARIO);
    const first = createFootballWorldSimulator({ scenario, faultSchedule: schedule }).ticks();
    const second = createFootballWorldSimulator({ scenario, faultSchedule: schedule }).ticks();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test("a compute-provider failure blacks out the broadcast source", () => {
    // Rate 1.0 with duration 3: the provider fails at ticks 0, 4, 8 — after
    // each 3-tick window the re-draw guard keeps one quiet tick (3, 7), and
    // both are odd ticks with no broadcast slot anyway, so the whole
    // 10-tick window delivers zero broadcast frames (measured: 3 entries).
    const blackout = generateFaultSchedule({
      seed: "provider-seed",
      tickCount: 10,
      profile: {
        profileId: "provider-only",
        description: "test profile: provider failures only",
        rates: {
          "compute-provider-failure": 1,
          "source-disagreement": 0,
          occlusion: 0,
          "processing-latency": 0,
          "dropped-frames": 0,
        },
        params: { "compute-provider-failure": { durationTicks: 3 } },
      },
    });
    expect(blackout.entries).toHaveLength(3);
    expect(blackout.entries.map((e) => e.tickIndex)).toEqual([0, 4, 8]);
    expect(blackout.entries.every((e) => e.faultKind === "compute-provider-failure")).toBe(true);
    // A minimum-duration scenario (10s at a 1s tick = 10 ticks) covers
    // exactly the schedule window.
    const scenario = generateFootballScenario("provider-seed", {
      matchDurationMs: 10_000,
      tickMs: 1_000,
    });
    const ticks = createFootballWorldSimulator({ scenario, faultSchedule: blackout }).ticks();
    // No broadcast observation exists anywhere; faults are active exactly on
    // the window ticks (0-2, 4-6, 8-9) with the quiet gaps at 3 and 7.
    const faultedTicks = new Set([0, 1, 2, 4, 5, 6, 8, 9]);
    for (const tick of ticks) {
      expect(tick.observations.every((o) => o.kindId !== "broadcast-frame")).toBe(true);
      expect(tick.appliedFaults.some((f) => f.faultKind === "compute-provider-failure")).toBe(
        faultedTicks.has(tick.tickIndex),
      );
      if (tick.tickIndex % 2 === 0) {
        expect(tick.timing.broadcastAvailableAtMs).toBeNull();
      }
    }
  });
});
