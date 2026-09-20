/**
 * THE PER-SCENARIO BEHAVIOR TESTS (L002): each scenario exhibits exactly its
 * documented delivery pathology — and NOTHING else (the scenarios are
 * isolated by construction):
 *
 * - normal: every tick in order, constant latency, watermark = eventTime;
 * - jitter: irregular inter-arrival, order preserved;
 * - delay: a contiguous window arrives late (in order), watermark lags;
 * - drop: VISIBLE sequence gaps, counted, never smoothed;
 * - out-of-order: bounded adjacent swaps; the watermark HOLDS until the
 *   overtaken update lands, then catches up;
 * - reconnect: the missed window is never emitted; the first post-reconnect
 *   observation carries explicit recovery accounting + degraded quality.
 */
import { describe, expect, test } from "bun:test";
import { LIVE_SCENARIO_DEFAULTS, createDeterministicLiveSource, drainSource } from "../src/index";
import type { LiveObservation, LiveScenarioConfig, LiveScenarioKind } from "../src/index";

const BASE = {
  sessionId: "sess-l002-scenarios",
  seed: 42,
  tickCount: 200,
  rateMs: 100,
  playersPerTeam: 6,
  referees: 1,
} as const;

function run(scenario: LiveScenarioKind | LiveScenarioConfig): LiveObservation[] {
  return drainSource(createDeterministicLiveSource({ ...BASE, scenario }));
}

function sequencesOf(observations: readonly LiveObservation[]): number[] {
  return observations.map((observation) => observation.sequence);
}

describe("scenario 'normal'", () => {
  const observations = run("normal");
  test("emits every tick exactly once, in order", () => {
    expect(sequencesOf(observations)).toEqual(
      Array.from({ length: BASE.tickCount }, (_, i) => i + 1),
    );
  });
  test("carries a constant delivery latency", () => {
    for (const observation of observations) {
      expect(observation.ingestTimeMs - observation.eventTimeMs).toBe(120);
    }
  });
  test("the watermark equals the emitted event time (no lag)", () => {
    for (const observation of observations) {
      expect(observation.watermark.watermarkMs).toBe(observation.eventTimeMs);
      expect(observation.watermark.sequence).toBe(observation.sequence);
    }
  });
  test("stats: zero drops, zero gaps, full rate", () => {
    const source = createDeterministicLiveSource({ ...BASE, scenario: "normal" });
    drainSource(source);
    const stats = source.stats();
    expect(stats.emitted).toBe(BASE.tickCount);
    expect(stats.droppedTicks).toBe(0);
    expect(stats.reconnectGapTicks).toBe(0);
    expect(stats.reconnects).toBe(0);
    expect(stats.watermarkLagMs).toBe(0);
    expect(stats.exhausted).toBe(true);
    // 10 Hz nominal, constant latency → the effective rate is exactly 10.
    expect(stats.effectiveEmissionRateHz).toBe(10);
  });
});

describe("scenario 'jitter'", () => {
  const observations = run("jitter");
  test("preserves arrival ORDER (jitter is pacing, not reordering)", () => {
    expect(sequencesOf(observations)).toEqual(
      Array.from({ length: BASE.tickCount }, (_, i) => i + 1),
    );
  });
  test("inter-arrival is irregular (at least 8 distinct gaps)", () => {
    const gaps = new Set<number>();
    for (let i = 1; i < observations.length; i += 1) {
      gaps.add(observations[i]!.ingestTimeMs - observations[i - 1]!.ingestTimeMs);
    }
    expect(gaps.size).toBeGreaterThanOrEqual(8);
  });
  test("every latency stays within [base, base + jitterMax]", () => {
    for (const observation of observations) {
      const latency = observation.ingestTimeMs - observation.eventTimeMs;
      expect(latency).toBeGreaterThanOrEqual(120);
      expect(latency).toBeLessThan(120 + LIVE_SCENARIO_DEFAULTS.jitterMaxMs);
    }
  });
});

describe("scenario 'delay'", () => {
  const observations = run({ kind: "delay", delayAtTick: 50, delayWindowTicks: 6, delayMs: 1500 });
  test("preserves arrival ORDER (a late window, not a reorder)", () => {
    expect(sequencesOf(observations)).toEqual(
      Array.from({ length: BASE.tickCount }, (_, i) => i + 1),
    );
  });
  test("exactly the window's updates arrive with the extra delay", () => {
    const delayed = observations.filter(
      (observation) => observation.ingestTimeMs - observation.eventTimeMs === 120 + 1500,
    );
    expect(delayed.map((observation) => observation.sequence)).toEqual([51, 52, 53, 54, 55, 56]);
  });
  test("the watermark keeps pace (in-order delivery — frontier follows)", () => {
    for (const observation of observations) {
      expect(observation.watermark.watermarkMs).toBe(observation.eventTimeMs);
    }
  });
});

describe("scenario 'drop'", () => {
  const source = createDeterministicLiveSource({
    ...BASE,
    scenario: { kind: "drop", dropRate: 0.25 },
  });
  const observations = drainSource(source);
  test("the dropped updates are VISIBLE sequence gaps (never renumbered)", () => {
    const sequences = sequencesOf(observations);
    const gaps = sequences.filter(
      (sequence, index) => index > 0 && sequence !== sequences[index - 1]! + 1,
    );
    expect(gaps.length).toBeGreaterThan(0);
    // No duplicates, strictly increasing (a gap is a hole, never a repeat).
    for (let i = 1; i < sequences.length; i += 1) {
      expect(sequences[i]!).toBeGreaterThan(sequences[i - 1]!);
    }
  });
  test("the drops are COUNTED (stats), and every planned tick is accounted", () => {
    const stats = source.stats();
    expect(stats.droppedTicks).toBe(BASE.tickCount - stats.emitted);
    expect(stats.emitted + stats.droppedTicks).toBe(stats.plannedTicks);
    expect(stats.maxConsecutiveMisses).toBeGreaterThanOrEqual(1);
  });
  test("the watermark advances past accounted drops (the gap is the guarantee)", () => {
    // After a drop, the next observation's watermark is at least its own
    // event time (the source guarantees nothing older will arrive).
    for (const observation of observations) {
      expect(observation.watermark.watermarkMs).toBeGreaterThanOrEqual(observation.eventTimeMs);
    }
  });
});

describe("scenario 'out-of-order'", () => {
  const observations = run({ kind: "out-of-order", swapRate: 0.3, reorderPenaltyMs: 200 });
  const sequences = sequencesOf(observations);
  test("some adjacent pairs are swapped (bounded reorder actually happens)", () => {
    const swaps = sequences.filter(
      (sequence, index) => index > 0 && sequence === sequences[index - 1]! + 2,
    );
    expect(swaps.length).toBeGreaterThan(0);
  });
  test("every tick is delivered exactly once (a reorder, never a loss)", () => {
    expect([...sequences].sort((a, b) => a - b)).toEqual(
      Array.from({ length: BASE.tickCount }, (_, i) => i + 1),
    );
  });
  test("reorder depth is bounded to ONE (no long-range shuffles)", () => {
    for (let i = 0; i < sequences.length; i += 1) {
      expect(Math.abs(sequences[i]! - (i + 1))).toBeLessThanOrEqual(1);
    }
  });
  test("the watermark HOLDS behind an overtaken update, then catches up", () => {
    let heldBehind = 0;
    let caughtUp = 0;
    for (const observation of observations) {
      if (observation.watermark.watermarkMs < observation.eventTimeMs) heldBehind += 1;
      else caughtUp += 1;
    }
    expect(heldBehind).toBeGreaterThan(0); // the conservative frontier in action
    expect(caughtUp).toBeGreaterThan(0); // and it does catch up
  });
  test("the final watermark covers the whole window", () => {
    const last = observations[observations.length - 1]!;
    expect(last.watermark.watermarkMs).toBe(last.eventTimeMs);
    expect(last.watermark.sequence).toBe(BASE.tickCount);
  });
});

describe("scenario 'reconnect'", () => {
  const source = createDeterministicLiveSource({
    ...BASE,
    scenario: {
      kind: "reconnect",
      reconnectAtTick: 60,
      reconnectGapTicks: 10,
      recoveryWindowTicks: 3,
    },
  });
  const observations = drainSource(source);
  const sequences = sequencesOf(observations);
  test("the missed window is NEVER emitted (a contiguous sequence gap)", () => {
    // Ticks 61..70 (1-based) are missed: the sequence jumps 60 → 71.
    expect(sequences).not.toContain(65);
    expect(sequences.filter((sequence) => sequence >= 61 && sequence <= 70)).toEqual([]);
    expect(sequences).toContain(60);
    expect(sequences).toContain(71);
  });
  test("the first post-reconnect update carries EXPLICIT gap accounting", () => {
    const recovered = observations.find((observation) => observation.recovery !== undefined);
    expect(recovered).toBeDefined();
    expect(recovered!.sequence).toBe(71);
    expect(recovered!.recovery).toEqual({
      reason: "reconnect",
      fromSequence: 61,
      toSequence: 70,
      missedUpdates: 10,
      gapDurationMs: 1000,
    });
  });
  test("exactly one recovery observation is emitted (the gap is accounted once)", () => {
    expect(observations.filter((observation) => observation.recovery !== undefined).length).toBe(1);
  });
  test("the recovery window emits DEGRADED quality with lowered confidence", () => {
    const nominalConfidences = observations
      .filter((observation) => observation.quality === "nominal")
      .map((observation) => observation.confidence);
    const degraded = observations.filter((observation) => observation.quality === "degraded");
    expect(degraded.length).toBe(3); // recoveryWindowTicks = 3
    for (const observation of degraded) {
      expect(observation.confidence).toBeLessThan(Math.max(...nominalConfidences));
    }
  });
  test("the reconnect is counted; stats account every tick", () => {
    const stats = source.stats();
    expect(stats.reconnects).toBe(1);
    expect(stats.reconnectGapTicks).toBe(10);
    expect(stats.emitted).toBe(BASE.tickCount - 10);
    expect(stats.degradedObservations).toBe(3);
    expect(stats.emitted + stats.reconnectGapTicks).toBe(stats.plannedTicks);
  });
  test("the post-reconnect watermark advances past the accounted gap", () => {
    const recovered = observations.find((observation) => observation.sequence === 71)!;
    expect(recovered.watermark.watermarkMs).toBeGreaterThanOrEqual(recovered.eventTimeMs);
  });
});

describe("cross-scenario honesty (never invented)", () => {
  test("no scenario fabricates updates for missed ticks", () => {
    for (const scenario of ["drop", "reconnect"] as const) {
      const source = createDeterministicLiveSource({
        ...BASE,
        scenario:
          scenario === "drop"
            ? { kind: "drop", dropRate: 0.3 }
            : { kind: "reconnect", reconnectAtTick: 50, reconnectGapTicks: 12 },
      });
      const stats = drainAndStats(source);
      // Emitted + accounted misses = planned: nothing invented, nothing lost
      // silently.
      expect(stats.emitted + stats.droppedTicks + stats.reconnectGapTicks).toBe(stats.plannedTicks);
    }
  });

  function drainAndStats(source: ReturnType<typeof createDeterministicLiveSource>) {
    drainSource(source);
    return source.stats();
  }

  test("plannedIngestTimeMs paces the bridge and nulls at exhaustion", () => {
    const source = createDeterministicLiveSource({ ...BASE, scenario: "normal", tickCount: 3 });
    expect(source.plannedIngestTimeMs()).toBe(120);
    source.next();
    expect(source.plannedIngestTimeMs()).toBe(220);
    source.next();
    source.next();
    expect(source.plannedIngestTimeMs()).toBeNull();
    expect(source.next()).toBeNull();
  });

  test("close() is idempotent and stats remain readable", () => {
    const source = createDeterministicLiveSource({ ...BASE, scenario: "jitter" });
    source.next();
    source.close();
    source.close();
    expect(source.next()).toBeNull();
    expect(source.stats().emitted).toBe(1);
  });
});
