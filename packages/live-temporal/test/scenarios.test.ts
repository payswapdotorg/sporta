/**
 * THE D4 SIX-SCENARIO MATRIX (the L004 acceptance battery) — every L002
 * delivery scenario driven through the time-driven bridge harness, with the
 * engine's per-scenario behavior PINNED:
 *
 * | scenario     | pinned behavior |
 * | --- | --- |
 * | normal | NOMINAL throughout; watermark = min(emission, maxEvent − window); zero drops; the extrapolation count equals the source's own carries EXACTLY (the engine adds none — the honest reading of the design's "zero extrapolations" row: the ENGINE fabricates nothing; the source's `detected:false` rows are counted data) |
 * | jitter | arrival pacing is irregular but ORDER is preserved: NOMINAL, zero drops, the dual-clock latency within the plan's offsets |
 * | delay (delayMs 3000) | the watermark falls behind the racing render clock beyond the lag budget → DEGRADED for the window's duration; the delayed data is still IN-WINDOW when it arrives (in-order) → zero drops; the catch-up burst recovers → NOMINAL |
 * | drop | sequence holes → REORDERING while open; closed holes increment droppedObservations and emit gap markers whose members EXACTLY match the plan's dropped ticks (the two books agree); the watermark still advances |
 * | out-of-order | swapped arrivals re-sort in the buffer; zero lateDropped when the penalty < window; the updater receives the corrected (event-time) order |
 * | reconnect | STALLED after the stall budget; the recovery accounting consumed VERBATIM (marker + counters); the missed window stays a visible hole (sequences 41-48 never applied, never renumbered); recovery → NOMINAL |
 *
 * §9 COUNTER ASSERTIONS: every counter this stage owns (watermark lag,
 * dropped observations, extrapolated observations, reconnects, effective
 * update rate, source-to-ingest latency) is asserted per scenario.
 *
 * DETERMINISM: the same (seed, scenario, config) run twice must produce a
 * byte-identical drain stream (canonical JSON).
 */
import { describe, expect, test } from "bun:test";
import { buildDeliveryPlan, type LiveScenarioConfig } from "@sporta/live-source";
import { TemporalBufferEngine, canonicalStatsJson, createTemporalBufferEngine } from "../src/index";
import type { AppliedBatch } from "../src/index";
import { buildBatch, runLiveScenario, statsOf, type ScenarioRun } from "./helpers";

const SEED = 20260921;
const RATE_MS = 100;
const TICKS = 600;

/** The extrapolation equality pin: the engine counts exactly the source's carries. */
function expectExtrapolationHonesty(run: ScenarioRun, sourceId: string): void {
  const stats = statsOf(run, sourceId).stats;
  expect(stats.extrapolatedObservations).toBe(run.undetectedRowsInApplied);
  expect(stats.extrapolatedObservations).toBe(
    run.applied.reduce(
      (acc, entry) => acc + entry.batch.entityObservations.filter((row) => !row.detected).length,
      0,
    ),
  );
}

/** The applied stream is event-time ascending (the corrected order). */
function expectAppliedInOrder(applied: readonly AppliedBatch[]): void {
  for (let i = 1; i < applied.length; i += 1) {
    const previous = applied[i - 1]!;
    const current = applied[i]!;
    expect(current.batch.eventTimeMs).toBeGreaterThanOrEqual(previous.batch.eventTimeMs);
  }
}

describe("scenario: normal — the quiet baseline", () => {
  const run = runLiveScenario({
    scenario: "normal",
    seed: SEED,
    tickCount: TICKS,
    rateMs: RATE_MS,
  });

  test("state stays NOMINAL after the first arrival", () => {
    // BOOT is the pre-arrival state — an admitted in-window observation lands
    // as NOMINAL immediately (the harness observes drains, never a ghost).
    expect(run.statesVisited).toEqual(["NOMINAL"]);
  });

  test("every planned observation applies; the stream is event-time ordered", () => {
    expect(run.applied).toHaveLength(TICKS);
    expectAppliedInOrder(run.applied);
    expect(run.applied.map((entry) => entry.batch.sequence)).toEqual(
      Array.from({ length: TICKS }, (_, i) => i + 1),
    );
  });

  test("zero drops of every kind (§9 dropped observations = 0)", () => {
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    expect(stats.lateDropped).toBe(0);
    expect(stats.droppedObservations).toBe(0);
    expect(stats.duplicateDropped).toBe(0);
    expect(stats.bufferOverflows).toBe(0);
    expect(stats.reconnects).toBe(0);
  });

  test("the watermark is min(emission, maxEvent − window) and hole-free", () => {
    const source = statsOf(run, "synthetic-tracking-1");
    const finalEventMs = (TICKS - 1) * RATE_MS;
    expect(source.watermark.watermarkMs).toBe(finalEventMs - 250);
    expect(source.watermark.sequence).toBe(TICKS);
  });

  test("extrapolation is marked exactly (the engine adds no carries of its own)", () => {
    expectExtrapolationHonesty(run, "synthetic-tracking-1");
  });

  test("§9 telemetry: rate + dual-clock latency are measured, not invented", () => {
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    // 10 Hz plan: (600 - 1) batches across the 59.9 s event-time span.
    expect(stats.effectiveUpdateRate).toBe(10);
    // Every normal offset is the base latency: exactly 120 ms.
    expect(stats.meanSourceToIngestMs).toBe(120);
    expect(stats.watermarkLagMs).toBeGreaterThanOrEqual(0);
    expect(stats.finalized).toBe(true);
  });
});

describe("scenario: jitter — irregular pacing, preserved order", () => {
  const run = runLiveScenario({
    scenario: "jitter",
    seed: SEED,
    tickCount: TICKS,
    rateMs: RATE_MS,
  });

  test("jitter never reorders: NOMINAL, zero drops, every batch applied", () => {
    expect(run.statesVisited).toEqual(["NOMINAL"]);
    expect(run.applied).toHaveLength(TICKS);
    expectAppliedInOrder(run.applied);
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    expect(stats.lateDropped).toBe(0);
    expect(stats.droppedObservations).toBe(0);
    expect(stats.reconnects).toBe(0);
  });

  test("the dual-clock latency lands inside the plan's jittered offsets (§9)", () => {
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    // Offsets are base(120) + jitter in [0, 60): the mean must sit inside.
    expect(stats.meanSourceToIngestMs).toBeGreaterThanOrEqual(120);
    expect(stats.meanSourceToIngestMs).toBeLessThan(180);
    // Event-time span is jitter-invariant: the rate is exactly the plan's.
    expect(stats.effectiveUpdateRate).toBe(10);
  });
});

describe("scenario: delay (+3000 ms window) — lag exposed, never pretended", () => {
  const run = runLiveScenario({
    scenario: { kind: "delay", delayAtTick: 30, delayWindowTicks: 5, delayMs: 3000 },
    seed: SEED,
    tickCount: TICKS,
    rateMs: RATE_MS,
  });

  test("DEGRADED surfaces while the render clock outruns the watermark (the §4 rule)", () => {
    expect(run.statesVisited).toContain("DEGRADED");
    expect(run.maxLagMs).toBeGreaterThan(2000);
  });

  test("the delayed data is still in-window when it arrives: zero drops", () => {
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    expect(stats.lateDropped).toBe(0);
    expect(stats.droppedObservations).toBe(0);
    expect(stats.duplicateDropped).toBe(0);
  });

  test("the catch-up burst recovers: every batch applied, final state NOMINAL", () => {
    expect(run.applied).toHaveLength(TICKS);
    const last = run.drains[run.drains.length - 1]!;
    const source = last.sources.find((entry) => entry.sourceId === "synthetic-tracking-1")!;
    expect(source.stats.state).toBe("NOMINAL");
    expect(source.watermark.sequence).toBe(TICKS);
  });

  test("§9 telemetry: the lag is measured continuously (the counter is fed)", () => {
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    expect(stats.watermarkLagMs).toBeGreaterThanOrEqual(0);
    expect(stats.effectiveUpdateRate).toBe(10);
    expect(stats.meanSourceToIngestMs).toBeGreaterThan(120); // the window inflates it
  });
});

describe("scenario: drop (15% scattered loss) — holes visible, both books agree", () => {
  const dropScenario: LiveScenarioConfig = { kind: "drop", dropRate: 0.15 };
  const plan = buildDeliveryPlan({
    seed: SEED,
    scenario: dropScenario,
    rateMs: RATE_MS,
    tickCount: TICKS,
    baseLatencyMs: 120,
  });
  const droppedTicks = plan.dispositions.filter((disposition) => disposition === "dropped").length;
  const droppedSequences = new Set(
    plan.dispositions
      .map((disposition, tick) => (disposition === "dropped" ? tick + 1 : null))
      .filter((sequence): sequence is number => sequence !== null),
  );

  const run = runLiveScenario({
    scenario: dropScenario,
    seed: SEED,
    tickCount: TICKS,
    rateMs: RATE_MS,
  });

  test("the drop rate actually dropped a bounded, non-trivial window", () => {
    expect(droppedTicks).toBeGreaterThan(30);
    expect(droppedTicks).toBeLessThan(TICKS * 0.5);
  });

  test("REORDERING surfaces while a hole is open, NOMINAL at the end", () => {
    expect(run.statesVisited).toContain("REORDERING");
    expect(run.statesVisited).not.toContain("STALLED");
    expect(run.statesVisited).not.toContain("DEGRADED");
    const last = run.drains[run.drains.length - 1]!;
    expect(last.sources[0]!.stats.state).toBe("NOMINAL");
  });

  test("the engine's hole accounting EXACTLY matches the plan's dropped ticks", () => {
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    expect(stats.droppedObservations).toBe(droppedTicks);
    // The gap markers' members are exactly the plan's dropped sequences.
    const markerMembers = run.gaps
      .filter((marker) => marker.kind === "sequence-hole")
      .flatMap((marker) => {
        const members: number[] = [];
        for (let seq = marker.fromSequence; seq <= marker.toSequence; seq += 1) {
          members.push(seq);
        }
        return members;
      });
    expect(markerMembers).toHaveLength(droppedTicks);
    for (const member of markerMembers) {
      expect(droppedSequences.has(member)).toBe(true);
    }
    expect(new Set(markerMembers).size).toBe(markerMembers.length); // no double accounting
  });

  test("scattered drops are holes, not late arrivals: lateDropped = 0", () => {
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    expect(stats.lateDropped).toBe(0);
    expect(stats.reconnects).toBe(0);
  });

  test("the watermark still advances past accounted holes (bounded staleness)", () => {
    const source = statsOf(run, "synthetic-tracking-1");
    expect(source.watermark.sequence).toBe(TICKS); // applied + accounted = every sequence
    expect(run.applied).toHaveLength(TICKS - droppedTicks);
    expectAppliedInOrder(run.applied);
    // A dropped sequence never re-appears in the applied stream.
    for (const entry of run.applied) {
      expect(droppedSequences.has(entry.batch.sequence)).toBe(false);
    }
  });

  test("extrapolation is marked exactly (§9)", () => {
    expectExtrapolationHonesty(run, "synthetic-tracking-1");
  });
});

describe("scenario: out-of-order (adjacent swaps, penalty 200 < window 250)", () => {
  const run = runLiveScenario({
    scenario: { kind: "out-of-order", swapRate: 0.5, reorderPenaltyMs: 200 },
    seed: SEED,
    tickCount: TICKS,
    rateMs: RATE_MS,
  });

  test("the arrival order actually contains inversions (the scenario precondition)", () => {
    let inversions = 0;
    for (let i = 1; i < run.arrivalSequences.length; i += 1) {
      if (run.arrivalSequences[i]! < run.arrivalSequences[i - 1]!) inversions += 1;
    }
    expect(inversions).toBeGreaterThan(0);
  });

  test("the updater receives the CORRECTED order (event-time ascending)", () => {
    expectAppliedInOrder(run.applied);
    expect(run.applied).toHaveLength(TICKS);
    const appliedSequences = run.applied.map((entry) => entry.batch.sequence);
    expect([...appliedSequences].sort((a, b) => a - b)).toEqual(
      Array.from({ length: TICKS }, (_, i) => i + 1),
    );
  });

  test("the penalty stays inside the window: zero drops (§9)", () => {
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    expect(stats.lateDropped).toBe(0);
    expect(stats.droppedObservations).toBe(0);
    expect(stats.reconnects).toBe(0);
  });

  test("REORDERING surfaces while a swap is in flight; NOMINAL at the end", () => {
    expect(run.statesVisited).toContain("REORDERING");
    const source = statsOf(run, "synthetic-tracking-1");
    expect(source.watermark.sequence).toBe(TICKS);
    expect(source.stats.state).toBe("NOMINAL");
  });
});

describe("scenario: reconnect (8-tick gap, recovery window, stall budget 500)", () => {
  const run = runLiveScenario({
    scenario: {
      kind: "reconnect",
      reconnectAtTick: 40,
      reconnectGapTicks: 8,
      recoveryWindowTicks: 3,
    },
    seed: SEED,
    tickCount: TICKS,
    rateMs: RATE_MS,
    engine: { stallBudgetMs: 500 },
  });

  test("STALLED latches after the stall budget (the 800 ms gap outruns it)", () => {
    expect(run.statesVisited).toContain("STALLED");
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    // At the stall tick the reorder window still holds arrivals 37, 38, 39
    // (e3700..e3900 vs the held watermark 3650): all three flush in-order.
    expect(stats.stallFlushes).toBe(3);
    expect(stats.reconnects).toBe(1);
  });

  test("the recovery accounting is consumed VERBATIM (never smoothed)", () => {
    const reconnectMarkers = run.gaps.filter((marker) => marker.kind === "reconnect");
    expect(reconnectMarkers).toHaveLength(1);
    const marker = reconnectMarkers[0]!;
    // L002's accounting for the 8-tick window at ticks 40..47 (sequences 41..48).
    expect(marker.fromSequence).toBe(41);
    expect(marker.toSequence).toBe(48);
    expect(marker.missedUpdates).toBe(8);
    expect(marker.gapDurationMs).toBe(8 * RATE_MS);
  });

  test("the missed window is a VISIBLE hole: never applied, never renumbered", () => {
    const appliedSequences = new Set(run.applied.map((entry) => entry.batch.sequence));
    for (let sequence = 41; sequence <= 48; sequence += 1) {
      expect(appliedSequences.has(sequence)).toBe(false);
    }
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    expect(stats.droppedObservations).toBe(8);
    // The frontier resolves PAST the gap (the hole is visible in the numbering:
    // 40 → 49, never renumbered to hide the gap).
    expect(run.applied.map((entry) => entry.batch.sequence)).toContain(49);
    expect(statsOf(run, "synthetic-tracking-1").watermark.sequence).toBe(TICKS);
  });

  test("recovery: the latch clears, the stream resumes, final state NOMINAL", () => {
    expect(run.applied).toHaveLength(TICKS - 8);
    const source = statsOf(run, "synthetic-tracking-1");
    expect(source.stats.state).toBe("NOMINAL");
    expectAppliedInOrder(run.applied);
  });

  test("the degraded-quality recovery window passes through honestly (§9)", () => {
    expect(run.degradedQualityApplied).toBe(3);
    expectExtrapolationHonesty(run, "synthetic-tracking-1");
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    expect(stats.effectiveUpdateRate).toBeGreaterThan(0);
    expect(stats.meanSourceToIngestMs).toBe(120);
  });
});

describe("scenario: reconnect with the DEFAULT stall budget — no false stall", () => {
  const run = runLiveScenario({
    scenario: "reconnect",
    seed: SEED,
    tickCount: TICKS,
    rateMs: RATE_MS,
    // default stallBudgetMs = 3000 — the 800 ms gap must NOT trip it
  });

  test("a sub-budget gap never latches STALLED (the budget is the only trigger)", () => {
    expect(run.statesVisited).not.toContain("STALLED");
    expect(run.statesVisited).toContain("NOMINAL");
    const stats = statsOf(run, "synthetic-tracking-1").stats;
    expect(stats.reconnects).toBe(1);
    expect(stats.droppedObservations).toBe(8);
    expect(stats.stallFlushes).toBe(0);
  });
});

describe("determinism — the same inputs replay byte-identically", () => {
  const options = {
    scenario: { kind: "drop", dropRate: 0.15 } as LiveScenarioConfig,
    seed: SEED,
    tickCount: 200,
    rateMs: RATE_MS,
    engine: { stallBudgetMs: 500, lagBudgetMs: 2000 },
  } as const;

  test("the drain stream replays byte-identically (canonical JSON)", () => {
    const first = runLiveScenario(options);
    const second = runLiveScenario(options);
    const serialize = (run: ScenarioRun): string =>
      JSON.stringify({
        applied: run.applied.map((entry) => ({
          ...entry,
          batch: entry.batch,
          drainReason: entry.drainReason,
        })),
        gaps: run.gaps,
        stats: run.finalStats.map((entry) => ({
          sourceId: entry.sourceId,
          watermark: entry.watermark,
          stats: canonicalStatsJson(entry.stats),
        })),
      });
    expect(serialize(second)).toBe(serialize(first));
    expect(second.statesVisited).toEqual(first.statesVisited);
  });
});

describe("admission accounting (D2) — hand-built precision batches", () => {
  test("an arrival older than the watermark is LATE: counted, dropped, never applied", () => {
    const engine = createTemporalBufferEngine({ sessionId: "s-live-harness" });
    // Advance the watermark: event 0..5 with emission guarantees through 5000.
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      engine.admit(
        buildBatch({
          sequence,
          eventTimeMs: sequence * 1000,
          watermark: { watermarkMs: 5000, sequence: 5 },
        }),
      );
    }
    engine.tick(5200);
    const before = engine.stats()[0]!;
    // A new-sequence batch whose event time sits below the watermark.
    const late = engine.admit(
      buildBatch({ sequence: 6, eventTimeMs: before.watermark.watermarkMs - 1 }),
    );
    expect(late.applied).toHaveLength(0);
    const after = engine.stats()[0]!;
    expect(after.stats.lateDropped).toBe(1);
    expect(after.stats.appliedBatches).toBe(before.stats.appliedBatches);
  });

  test("an exact-sequence duplicate and a below-frontier replay are counted, never re-applied", () => {
    const engine = createTemporalBufferEngine({ sessionId: "s-live-harness" });
    // Sequences 1..3 in order: 1 and 2 pass the window and apply; 3 buffers.
    const first = engine.admit(buildBatch({ sequence: 1, eventTimeMs: 1000 }));
    expect(first.applied).toHaveLength(0); // still inside the window
    engine.admit(buildBatch({ sequence: 2, eventTimeMs: 2000 }));
    engine.admit(buildBatch({ sequence: 3, eventTimeMs: 3000 }));
    engine.tick(4000);
    const before = engine.stats()[0]!;
    expect(before.stats.appliedBatches).toBe(2); // sequences 1 and 2 released
    // An exact re-arrival of an applied sequence…
    engine.admit(buildBatch({ sequence: 2, eventTimeMs: 2000 }));
    // …and a replay below the resolved frontier (sequence 1 <= frontier 2).
    engine.admit(buildBatch({ sequence: 1, eventTimeMs: 1000 }));
    const after = engine.stats()[0]!;
    expect(after.stats.duplicateDropped).toBe(2);
    expect(after.stats.appliedBatches).toBe(before.stats.appliedBatches);
  });

  test("the buffer is bounded: the oldest batch flushes ahead of closure, counted", () => {
    const engine = createTemporalBufferEngine({
      sessionId: "s-live-harness",
      maxBufferedBatches: 2,
      reorderWindowMs: 10_000, // nothing releases inside this window
    });
    engine.admit(buildBatch({ sequence: 1, eventTimeMs: 1000 }));
    engine.admit(buildBatch({ sequence: 2, eventTimeMs: 2000 }));
    const overflow = engine.admit(buildBatch({ sequence: 3, eventTimeMs: 3000 }));
    // The OLDEST buffered batch (sequence 1) flushed ahead of watermark closure.
    expect(overflow.applied.map((entry) => entry.batch.sequence)).toEqual([1]);
    expect(overflow.applied[0]!.drainReason).toBe("overflow");
    const stats = engine.stats()[0]!;
    expect(stats.stats.bufferOverflows).toBe(1);
    expect(stats.stats.bufferedBatches).toBe(2);
  });

  test("per-source isolation: one source's holes never hold another source's watermark", () => {
    const engine = createTemporalBufferEngine({ sessionId: "s-live-harness" });
    // Source A: sequences 1, 3 (a hole at 2, held open — the emission
    // watermarks only guarantee each arrival's own event time).
    engine.admit(buildBatch({ sequence: 1, eventTimeMs: 1000, sourceId: "source-a" }));
    engine.admit(buildBatch({ sequence: 3, eventTimeMs: 3000, sourceId: "source-a" }));
    // Source B: the same event times, but a CLEAN contiguous stream.
    engine.admit(buildBatch({ sequence: 1, eventTimeMs: 1000, sourceId: "source-b" }));
    engine.admit(buildBatch({ sequence: 2, eventTimeMs: 2000, sourceId: "source-b" }));
    engine.admit(buildBatch({ sequence: 3, eventTimeMs: 3000, sourceId: "source-b" }));
    engine.tick(4000);
    const stats = engine.stats();
    expect(stats).toHaveLength(2);
    const a = stats.find((entry) => entry.sourceId === "source-a")!;
    const b = stats.find((entry) => entry.sourceId === "source-b")!;
    // A's hole at sequence 2 holds A's frontier at 1 and surfaces REORDERING…
    expect(a.watermark.sequence).toBe(1);
    expect(a.stats.state).toBe("REORDERING");
    expect(a.stats.droppedObservations).toBe(0); // the hole is still OPEN
    // …while B's contiguous stream advances freely (2 of 3 released past the
    // window 750..2750; sequence 3 at e3000 is still inside it).
    expect(b.watermark.sequence).toBe(2);
    expect(b.stats.state).toBe("NOMINAL");
  });
});

describe("engine constitution (fail-loud boundaries)", () => {
  test("invalid configurations are refused with the typed error", () => {
    expect(() => createTemporalBufferEngine({ sessionId: "s", reorderWindowMs: 0 })).toThrow();
    expect(() => createTemporalBufferEngine({ sessionId: "", reorderWindowMs: 100 })).toThrow();
    expect(() => createTemporalBufferEngine({ sessionId: "s", maxBufferedBatches: 0 })).toThrow();
  });

  test("a wrong-session admission is refused, never partially applied", () => {
    const engine = createTemporalBufferEngine({ sessionId: "s-live-harness" });
    const wrong = buildBatch({ sequence: 1, eventTimeMs: 1000 });
    const wrongSession = { ...wrong, sessionId: "s-other" };
    expect(() => engine.admit(wrongSession)).toThrow(/wrongSession/);
    expect(engine.stats()).toHaveLength(0);
  });

  test("a regressing render clock is refused (a render clock cannot move backwards)", () => {
    const engine = createTemporalBufferEngine({ sessionId: "s-live-harness" });
    engine.admit(buildBatch({ sequence: 1, eventTimeMs: 1000 }));
    engine.tick(2000);
    expect(() => engine.tick(1999)).toThrow(/regressed/);
  });

  test("admissions and finalize are refused after the live window closes", () => {
    const engine = createTemporalBufferEngine({ sessionId: "s-live-harness" });
    engine.admit(buildBatch({ sequence: 1, eventTimeMs: 1000 }));
    engine.finalize();
    expect(() => engine.admit(buildBatch({ sequence: 2, eventTimeMs: 2000 }))).toThrow(/finalized/);
    expect(() => engine.finalize()).toThrow(/finalized/);
  });

  test("a malformed observation is refused fail-loud (the contract, never a guess)", () => {
    const engine = createTemporalBufferEngine({ sessionId: "s-live-harness" });
    const malformed = { ...buildBatch({ sequence: 1, eventTimeMs: 1000 }), sequence: -1 };
    expect(() => engine.admit(malformed as never)).toThrow();
  });

  test("the engine class is exported and constructible directly (typed consumers)", () => {
    const engine = new TemporalBufferEngine({ sessionId: "s-live-harness" });
    expect(engine.sessionId).toBe("s-live-harness");
    expect(engine.configuration.reorderWindowMs).toBe(250);
    expect(engine.isFinalized).toBe(false);
  });
});
