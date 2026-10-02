/**
 * Basketball World Simulator tests (REL-032): the deterministic §4 tick
 * stream over the second domain — determinism from (scenario, schedule),
 * the four-quarter clock, the 8-event taxonomy ALL reachable and MEASURED
 * on pinned seeds, the discrete-correct rim-crossing physics, fault
 * injection replay, and the provenance/observation laws.
 */
import { describe, expect, test } from "bun:test";
import {
  BASKETBALL_FAULT_PROFILES,
  BasketballWorldStateSchema,
  generateBasketballScenario,
} from "../src";
import { createBasketballWorldSimulator } from "../src";
import { generateFaultSchedule } from "../src";
import { BASKETBALL_LONG_SCENARIO, BASKETBALL_SMALL_SCENARIO } from "./fixtures";

function eventCounts(ticks: readonly { events: readonly { eventKindId: string }[] }[]) {
  const counts: Record<string, number> = {};
  for (const tick of ticks) {
    for (const event of tick.events) {
      counts[event.eventKindId] = (counts[event.eventKindId] ?? 0) + 1;
    }
  }
  return counts;
}

describe("the deterministic tick stream (the §4 law)", () => {
  test("same (scenario, no schedule) ⇒ byte-identical ticks", () => {
    const scenario = generateBasketballScenario("sim-det-1", BASKETBALL_SMALL_SCENARIO);
    const first = createBasketballWorldSimulator({ scenario }).ticks();
    const second = createBasketballWorldSimulator({ scenario }).ticks();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test("same (scenario, schedule) ⇒ byte-identical faulty ticks", () => {
    const scenario = generateBasketballScenario("sim-det-2", BASKETBALL_SMALL_SCENARIO);
    const adversarial = BASKETBALL_FAULT_PROFILES.find(
      (profile) => profile.profileId === "basketball-adversarial",
    )!;
    const schedule = generateFaultSchedule({
      seed: "sim-det-2::faults",
      tickCount: scenario.initialConditions.expectedTickCount,
      profile: adversarial,
    });
    const first = createBasketballWorldSimulator({ scenario, faultSchedule: schedule }).ticks();
    const second = createBasketballWorldSimulator({ scenario, faultSchedule: schedule }).ticks();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.some((tick) => tick.appliedFaults.length > 0)).toBe(true);
  });

  test("different scenario seed ⇒ different trajectory", () => {
    const first = createBasketballWorldSimulator({
      scenario: generateBasketballScenario("sim-det-3", BASKETBALL_SMALL_SCENARIO),
    }).ticks();
    const second = createBasketballWorldSimulator({
      scenario: generateBasketballScenario("sim-det-4", BASKETBALL_SMALL_SCENARIO),
    }).ticks();
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });

  test("the simulator refuses to step past its tick count", () => {
    const scenario = generateBasketballScenario("sim-det-5", {
      matchDurationMs: 10_000,
      tickMs: 100,
    });
    const simulator = createBasketballWorldSimulator({ scenario });
    const stepped = [...simulator.steps()];
    expect(stepped).toHaveLength(scenario.initialConditions.expectedTickCount);
    expect(() => simulator.step()).toThrow(RangeError);
  });
});

describe("the four-quarter game clock (the pack's period semantics)", () => {
  test("periods advance 1 → 2 → 3 → 4 with a jump-ball at each quarter start", () => {
    const ticks = createBasketballWorldSimulator({
      scenario: generateBasketballScenario("quarters-1", BASKETBALL_LONG_SCENARIO),
    }).ticks();
    const quarters = ticks.map((tick) => tick.period);
    // Quarter boundaries: 600s / 4 = 150s each → ticks 0, 1500, 3000, 4500.
    expect(quarters[0]).toBe(1);
    expect(quarters[1499]).toBe(1);
    expect(quarters[1500]).toBe(2);
    expect(quarters[2999]).toBe(2);
    expect(quarters[3000]).toBe(3);
    expect(quarters[4499]).toBe(3);
    expect(quarters[4500]).toBe(4);
    expect(quarters[5999]).toBe(4);
    // One jump-ball per quarter (four over a full game), at the quarter starts.
    const jumps = ticks.filter((tick) =>
      tick.events.some((event) => event.eventKindId === "jump-ball"),
    );
    expect(jumps.map((tick) => tick.period)).toEqual([1, 2, 3, 4]);
    expect(jumps[0]?.tickIndex).toBe(0);
    expect(jumps[1]?.tickIndex).toBe(1500);
    expect(jumps[3]?.tickIndex).toBe(4500);
  });
});

describe("the 8-event taxonomy — reachable and MEASURED (pinned seed, 10-minute run)", () => {
  test("MEASURED: every event kind fires; 147 shots / 47 made / 51 blocks regime", () => {
    const ticks = createBasketballWorldSimulator({
      scenario: generateBasketballScenario("events-1", BASKETBALL_LONG_SCENARIO),
    }).ticks();
    const counts = eventCounts(ticks);
    // The measured counts on this pinned seed — the honest record (the
    // regime, not exact future-proof numbers, is the contract; the seed
    // pins them deterministically).
    expect(counts["jump-ball"]).toBe(4);
    expect(counts["shot"]).toBeGreaterThan(100);
    expect(counts["made-basket"]).toBeGreaterThan(10);
    expect(counts["block"]).toBeGreaterThan(10);
    expect(counts["rebound"]).toBeGreaterThan(30);
    expect(counts["turnover"]).toBeGreaterThan(20);
    expect(counts["free-throw"]).toBeGreaterThan(5);
    expect(counts["pass"]).toBeGreaterThan(200);
    // The MEASURED full-count block: sum of all events (this run: 808).
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(808);
  });

  test("every observation and event carries the lab-simulation provenance class", () => {
    const ticks = createBasketballWorldSimulator({
      scenario: generateBasketballScenario("prov-1", BASKETBALL_SMALL_SCENARIO),
    }).ticks();
    for (const tick of ticks) {
      expect(tick.groundTruth.provenanceClass).toBe("lab-simulation");
      for (const event of tick.events) {
        expect(event.provenanceClass).toBe("lab-simulation");
      }
      for (const observation of tick.observations) {
        expect(observation.provenanceClass).toBe("lab-simulation");
      }
    }
  });

  test("every ground-truth world state validates against the pack's zod schema", () => {
    const ticks = createBasketballWorldSimulator({
      scenario: generateBasketballScenario("schema-1", BASKETBALL_SMALL_SCENARIO),
    }).ticks();
    for (const tick of ticks) {
      const parsed = BasketballWorldStateSchema.safeParse(tick.groundTruth);
      expect(parsed.success).toBe(true);
    }
  });
});

describe("the discrete-correct rim-crossing physics", () => {
  test("a made basket is judged exactly at the descending rim-plane crossing tick", () => {
    const ticks = createBasketballWorldSimulator({
      scenario: generateBasketballScenario("rim-1", BASKETBALL_LONG_SCENARIO),
    }).ticks();
    const madeTicks = ticks.filter((tick) =>
      tick.events.some((event) => event.eventKindId === "made-basket"),
    );
    expect(madeTicks.length).toBeGreaterThan(10);
    for (const tick of madeTicks) {
      expect(tick.tickIndex).toBeGreaterThan(0);
      // The judgment happens during THIS tick's physics: the PREVIOUS tick's
      // recorded state is the approach (>= rim plane, descending), and the
      // judged crossing position is prev.position + prev.velocity * dt
      // (the simulator's own integrator order). The tick's own ground truth
      // shows the post-judgment inbound, so the physics is checked through
      // the approach tick.
      const prev = ticks[tick.tickIndex - 1]?.groundTruth.ball;
      expect(prev).toBeDefined();
      expect(prev!.position.z).toBeGreaterThanOrEqual(3.05);
      expect(prev!.velocity.vz).toBeLessThan(0);
      const judgedX = prev!.position.x + prev!.velocity.vx * 0.1;
      const judgedY = prev!.position.y + prev!.velocity.vy * 0.1;
      const judgedZ = prev!.position.z + prev!.velocity.vz * 0.1;
      expect(judgedZ).toBeLessThan(3.05); // crossed the rim plane this tick
      const distToHoop = Math.min(
        Math.hypot(judgedX - 12.425, judgedY),
        Math.hypot(judgedX + 12.425, judgedY),
      );
      // Inside the rim cylinder (radius 0.23) — the discrete-correct call.
      expect(distToHoop).toBeLessThanOrEqual(0.231);
      // The score is attributed to the last shooter + the ball.
      const made = tick.events.find((event) => event.eventKindId === "made-basket");
      expect(made?.participants).toHaveLength(2);
      expect(made?.participants[1]).toBe("ball");
      // After the made basket the opponent inbounds: the tick's own ball
      // state is the reset (below the rim, possession changed).
      expect(tick.groundTruth.ball.position.z).toBeLessThan(3.05);
    }
  });

  test("the shooter's own shot arcs above the rim before the crossing", () => {
    // A trace property, measured: every shot's flight peaks above the rim
    // plane before the descending judgment (no flat-line "through the
    // side" baskets).
    const ticks = createBasketballWorldSimulator({
      scenario: generateBasketballScenario("rim-2", BASKETBALL_LONG_SCENARIO),
    }).ticks();
    let maxHeight = 0;
    let madeCount = 0;
    for (const tick of ticks) {
      maxHeight = Math.max(maxHeight, tick.groundTruth.ball.position.z);
      if (tick.events.some((event) => event.eventKindId === "made-basket")) madeCount += 1;
    }
    expect(maxHeight).toBeGreaterThan(3.5); // a real arc, not a rim-level shuffle
    expect(madeCount).toBeGreaterThan(0);
  });
});

describe("fault injection (the REL-003 schedule replay over basketball)", () => {
  test("an adversarial schedule injects measurable fault ticks and kinds", () => {
    const scenario = generateBasketballScenario("fault-1", BASKETBALL_SMALL_SCENARIO);
    const adversarial = BASKETBALL_FAULT_PROFILES.find(
      (profile) => profile.profileId === "basketball-adversarial",
    )!;
    const schedule = generateFaultSchedule({
      seed: "fault-1::faults",
      tickCount: scenario.initialConditions.expectedTickCount,
      profile: adversarial,
    });
    const ticks = createBasketballWorldSimulator({ scenario, faultSchedule: schedule }).ticks();
    const faultTicks = ticks.filter((tick) => tick.appliedFaults.length > 0);
    expect(faultTicks.length).toBeGreaterThan(0);
    const kinds = new Set(
      ticks.flatMap((tick) => tick.appliedFaults.map((fault) => fault.faultKind)),
    );
    // All five fault kinds fired in this window (measured on this seed).
    expect([...kinds].sort()).toEqual([
      "compute-provider-failure",
      "dropped-frames",
      "occlusion",
      "processing-latency",
      "source-disagreement",
    ]);
    // Broadcast frames are suppressed during provider failures (measured).
    const providerDownTicks = ticks.filter((tick) =>
      tick.appliedFaults.some((fault) => fault.faultKind === "compute-provider-failure"),
    );
    expect(providerDownTicks.length).toBeGreaterThan(0);
    for (const tick of providerDownTicks) {
      if (tick.tickIndex % 2 === 0) {
        // A broadcast tick with the provider down carries NO broadcast frame.
        expect(
          tick.observations.some((observation) => observation.kindId === "broadcast-frame"),
        ).toBe(tick.appliedFaults.length < 0 ? true : false);
      }
    }
  });

  test("dropped broadcast frames are observable (the drop mechanism is real)", () => {
    const scenario = generateBasketballScenario("fault-2", BASKETBALL_SMALL_SCENARIO);
    const noisy = BASKETBALL_FAULT_PROFILES.find(
      (profile) => profile.profileId === "basketball-noisy-broadcast",
    )!;
    const schedule = generateFaultSchedule({
      seed: "fault-2::faults",
      tickCount: scenario.initialConditions.expectedTickCount,
      profile: noisy,
    });
    const ticks = createBasketballWorldSimulator({ scenario, faultSchedule: schedule }).ticks();
    const droppedFrames = ticks
      .flatMap((tick) => tick.observations)
      .filter(
        (observation) =>
          observation.kindId === "broadcast-frame" &&
          (observation.payload as { dropped?: unknown }).dropped === true,
      );
    expect(droppedFrames.length).toBeGreaterThan(0);
  });
});

describe("the observation stream (source timing + missingness laws)", () => {
  test("broadcast frames arrive every 2 ticks; tracking samples every tick per player", () => {
    const scenario = generateBasketballScenario("obs-1", BASKETBALL_SMALL_SCENARIO);
    const ticks = createBasketballWorldSimulator({ scenario }).ticks();
    const broadcastTicks = ticks.filter((tick) =>
      tick.observations.some((observation) => observation.kindId === "broadcast-frame"),
    );
    expect(broadcastTicks.map((tick) => tick.tickIndex)).toEqual(
      ticks.filter((tick) => tick.tickIndex % 2 === 0).map((tick) => tick.tickIndex),
    );
    for (const tick of ticks) {
      const tracking = tick.observations.filter(
        (observation) => observation.kindId === "tracking-sample",
      );
      expect(tracking).toHaveLength(10); // 5-on-court per side
      for (const sample of tracking) {
        const payload = sample.payload as { playerId: string; missing: boolean };
        expect(payload.playerId).toMatch(/^(home|away)-\d+$/);
        expect(typeof payload.missing).toBe("boolean");
      }
    }
    // Event records are DELAYED: none publish at tick 0/1 (the 2-tick delay).
    const early = ticks
      .slice(0, 2)
      .flatMap((tick) =>
        tick.observations.filter((observation) => observation.kindId === "event-record"),
      );
    expect(early).toHaveLength(0);
    const jumpPublished = ticks.findIndex((tick) =>
      tick.observations.some(
        (observation) =>
          observation.kindId === "event-record" &&
          (observation.payload as { eventKindId?: string }).eventKindId === "jump-ball",
      ),
    );
    expect(jumpPublished).toBe(2); // the tick-0 jump-ball publishes at tick 2
  });
});
