/**
 * The D3 STALLED / DEGRADED transition battery — the state machine's live
 * arcs driven with hand-built precision batches (exact event times, emission
 * watermarks and render-clock ticks; no scenario knobs in the way):
 *
 * - the STALLED latch: no in-window progress for the stall budget of
 *   RENDER-CLOCK time → latch + in-order buffer flush (drainReason "stall"),
 *   counted, never a silent hold; the latch is idempotent (a second stall
 *   tick flushes nothing);
 * - an in-window arrival clears the latch (the post-reconnect recovery
 *   path); a LATE-only arrival does NOT (an out-of-window arrival is not
 *   recovery);
 * - DEGRADED (the frozen §4 rule): `renderClock − watermark > lagBudget` is
 *   EXPOSED, never pretended away — while the watermark keeps advancing
 *   honestly underneath; catch-up returns to NOMINAL;
 * - the degenerate stall recovery (a short gap the render clock did not
 *   outrun) re-evaluates straight to NOMINAL, honestly skipping DEGRADED;
 * - the full D3 recovery arc: STALLED → recovery accounting → DEGRADED
 *   (recovery window) → NOMINAL;
 * - hand-built reconnect accounting: the L002 `recovery` member consumed
 *   VERBATIM (marker + counters + the frontier walking past the accounted
 *   gap — a visible hole, never renumbered);
 * - BOOT: the D3 entry state — pinned through the PURE evaluator (a source
 *   surfaces in the engine's accounting only after its first admission, and
 *   a first admission can never be late nor a duplicate, so the engine never
 *   shows a BOOT ghost: no fabricated sources).
 */
import { describe, expect, test } from "bun:test";
import { createTemporalBufferEngine, evaluateSourceState } from "../src/index";
import { buildBatch, HARNESS_SESSION_ID } from "./helpers";

/** One in-order batch at `sequence`, event time = sequence * step. */
function orderedBatch(sequence: number, stepMs = 100) {
  return buildBatch({
    sequence,
    eventTimeMs: sequence * stepMs,
    watermark: { watermarkMs: sequence * stepMs, sequence },
  });
}

describe("the STALLED latch (no in-window progress for the budget)", () => {
  test("a quiet period past the budget latches STALLED and flushes the window in-order", () => {
    const engine = createTemporalBufferEngine({
      sessionId: HARNESS_SESSION_ID,
      stallBudgetMs: 500,
    });
    // Ten in-order arrivals: the window holds the newest ~3 at any time.
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      engine.admit(orderedBatch(sequence));
    }
    const progress = engine.tick(1000); // arrivals happened → progress, no stall
    expect(progress.sources[0]!.stats.state).toBe("NOMINAL");
    const stalled = engine.tick(1600); // 600 ms quiet > 500 budget
    expect(stalled.sources[0]!.stats.state).toBe("STALLED");
    // The held window batches (e800, e900, e1000 vs watermark 750) flushed
    // in event-time order with the honest stall drain reason.
    expect(stalled.applied.map((entry) => entry.batch.sequence)).toEqual([8, 9, 10]);
    for (const entry of stalled.applied) {
      expect(entry.drainReason).toBe("stall");
    }
    expect(stalled.sources[0]!.stats.stallFlushes).toBe(3);
  });

  test("the latch is idempotent: a second stall tick flushes nothing", () => {
    const engine = createTemporalBufferEngine({
      sessionId: HARNESS_SESSION_ID,
      stallBudgetMs: 500,
    });
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      engine.admit(orderedBatch(sequence));
    }
    engine.tick(1000);
    const first = engine.tick(1600);
    expect(first.sources[0]!.stats.state).toBe("STALLED");
    const second = engine.tick(2200);
    expect(second.sources[0]!.stats.state).toBe("STALLED");
    expect(second.applied).toHaveLength(0);
    expect(second.sources[0]!.stats.stallFlushes).toBe(first.sources[0]!.stats.stallFlushes);
  });

  test("a source with no observations never stalls (BOOT, not STALLED)", () => {
    const engine = createTemporalBufferEngine({
      sessionId: HARNESS_SESSION_ID,
      stallBudgetMs: 100,
    });
    // No admissions at all: ticks observe an engine with no sources — there
    // is no progress mark to age out, so no source, no stall, no fabrication.
    engine.tick(0);
    engine.tick(10_000);
    expect(engine.stats()).toHaveLength(0);
  });

  test("a LATE-only arrival during STALLED is counted but is NOT recovery", () => {
    const engine = createTemporalBufferEngine({
      sessionId: HARNESS_SESSION_ID,
      stallBudgetMs: 1000,
    });
    // Thirty arrivals advance the watermark to 2750; then a quiet stall.
    for (let sequence = 1; sequence <= 30; sequence += 1) {
      engine.admit(orderedBatch(sequence));
    }
    engine.tick(3100);
    const stalled = engine.tick(4200); // 1100 ms quiet > 1000 budget
    expect(stalled.sources[0]!.stats.state).toBe("STALLED");
    // A late new-sequence batch (event time below the watermark 2750).
    const late = engine.admit(buildBatch({ sequence: 31, eventTimeMs: 2749 }));
    expect(late.sources[0]!.stats.state).toBe("STALLED"); // the latch holds
    expect(late.sources[0]!.stats.lateDropped).toBe(1);
    expect(late.applied).toHaveLength(0);
    // The in-window recovery arrival clears the latch — and honestly leaves
    // the late-dropped sequence 31 as an OPEN hole (revealed by 32): the
    // state re-evaluates to REORDERING, not a pretended NOMINAL.
    const recovery = engine.admit(orderedBatch(32));
    expect(recovery.sources[0]!.stats.state).toBe("REORDERING");
    expect(recovery.sources[0]!.stats.stallFlushes).toBe(3); // the stall flush stands
    // The window closes the hole: sequence 31 is accounted (dropped, marker).
    engine.admit(orderedBatch(33));
    engine.admit(orderedBatch(34));
    const closed = engine.admit(orderedBatch(35)); // watermark 3250 ≥ e32
    expect(closed.gaps.filter((marker) => marker.kind === "sequence-hole")).toHaveLength(1);
    expect(closed.sources[0]!.stats.state).toBe("NOMINAL");
    expect(closed.sources[0]!.stats.droppedObservations).toBe(1);
  });
});

describe("DEGRADED — the frozen §4 rule, exposed never pretended", () => {
  test("a racing render clock surfaces DEGRADED while the watermark keeps advancing", () => {
    const engine = createTemporalBufferEngine({ sessionId: HARNESS_SESSION_ID });
    engine.admit(orderedBatch(1)); // e100, watermark floor 0
    engine.tick(1100);
    expect(engine.stats()[0]!.stats.state).toBe("NOMINAL"); // lag 1100 < 2000
    engine.admit(orderedBatch(2)); // e200
    const degraded = engine.tick(2200); // lag 2200 > 2000
    expect(degraded.sources[0]!.stats.state).toBe("DEGRADED");
    expect(degraded.sources[0]!.stats.watermarkLagMs).toBe(2200);
    // The watermark still advances honestly underneath (never frozen).
    for (let sequence = 3; sequence <= 30; sequence += 1) {
      engine.admit(orderedBatch(sequence)); // contiguous catch-up: e3000
    }
    const caughtUp = engine.tick(2300); // render clock held; lag clamps to 0
    expect(caughtUp.sources[0]!.stats.state).toBe("NOMINAL");
    expect(caughtUp.sources[0]!.stats.watermarkLagMs).toBe(0);
  });

  test("DEGRADED outranks REORDERING (the operator-facing alarm wins)", () => {
    const engine = createTemporalBufferEngine({ sessionId: HARNESS_SESSION_ID });
    // A hole at sequence 2 (arrival 3 jumped past it) AND a racing clock.
    engine.admit(buildBatch({ sequence: 1, eventTimeMs: 100 }));
    engine.admit(buildBatch({ sequence: 3, eventTimeMs: 300 }));
    engine.tick(1000);
    expect(engine.stats()[0]!.stats.state).toBe("REORDERING");
    engine.tick(3000); // lag 3000 - 50 = 2950 > 2000 → DEGRADED wins
    const stats = engine.stats()[0]!;
    expect(stats.stats.state).toBe("DEGRADED");
    // The hole AND the in-flight buffered batches hold the sequence member
    // back (nothing has passed the window yet: watermark 50 < e100).
    expect(stats.watermark.sequence).toBe(0);
    expect(stats.stats.bufferedBatches).toBe(2);
  });
});

describe("the degenerate stall recovery — straight back to NOMINAL", () => {
  test("a short gap the render clock did not outrun skips DEGRADED honestly", () => {
    const engine = createTemporalBufferEngine({
      sessionId: HARNESS_SESSION_ID,
      stallBudgetMs: 1000,
    });
    for (let sequence = 1; sequence <= 30; sequence += 1) {
      engine.admit(orderedBatch(sequence));
    }
    engine.tick(3100);
    const stalled = engine.tick(4200);
    expect(stalled.sources[0]!.stats.state).toBe("STALLED");
    // Recovery arrival: e3100, watermark 2850; the clock (4200) is only 1350
    // ahead — under the 2000 budget → straight to NOMINAL, no DEGRADED hop.
    const recovery = engine.admit(orderedBatch(31));
    expect(recovery.sources[0]!.stats.state).toBe("NOMINAL");
    expect(recovery.sources[0]!.stats.reconnects).toBe(0); // no recovery member — plain resume
  });
});

describe("the full D3 recovery arc — STALLED → DEGRADED (recovery window) → NOMINAL", () => {
  test("a recovery behind a racing render clock surfaces DEGRADED, then catches up", () => {
    const engine = createTemporalBufferEngine({
      sessionId: HARNESS_SESSION_ID,
      stallBudgetMs: 500,
    });
    for (let sequence = 1; sequence <= 20; sequence += 1) {
      engine.admit(orderedBatch(sequence));
    }
    engine.tick(2000);
    const stalled = engine.tick(2600); // 600 ms quiet → STALLED
    expect(stalled.sources[0]!.stats.state).toBe("STALLED");
    // The render clock raced to 5500 during the outage.
    engine.tick(5500);
    expect(engine.stats()[0]!.stats.state).toBe("STALLED");
    // The post-reconnect arrival carries the gap accounting (sequences
    // 21..28 missed) and lands at e2900 with a far-ahead render clock.
    const recovery = engine.admit(
      buildBatch({
        sequence: 29,
        eventTimeMs: 2900,
        watermark: { watermarkMs: 2900, sequence: 29 },
        recovery: {
          reason: "reconnect",
          fromSequence: 21,
          toSequence: 28,
          missedUpdates: 8,
          gapDurationMs: 800,
        },
      }),
    );
    // The latch cleared; the lag (5500 − 2650 = 2850) surfaces DEGRADED —
    // the honest recovery window (never pretended current).
    expect(recovery.sources[0]!.stats.state).toBe("DEGRADED");
    expect(recovery.sources[0]!.stats.reconnects).toBe(1);
    expect(recovery.gaps).toHaveLength(1);
    expect(recovery.gaps[0]).toEqual({
      sourceId: "synthetic-tracking-1",
      kind: "reconnect",
      fromSequence: 21,
      toSequence: 28,
      gapDurationMs: 800,
      missedUpdates: 8,
    });
    // The source catches up while the renderer waits: NOMINAL again.
    for (let sequence = 30; sequence <= 40; sequence += 1) {
      engine.admit(orderedBatch(sequence));
    }
    const caughtUp = engine.tick(5500);
    expect(caughtUp.sources[0]!.stats.state).toBe("NOMINAL");
  });
});

describe("hand-built reconnect accounting — verbatim, never smoothed", () => {
  test("the recovery member resolves the frontier past the accounted gap", () => {
    const engine = createTemporalBufferEngine({ sessionId: HARNESS_SESSION_ID });
    engine.admit(orderedBatch(1));
    engine.admit(orderedBatch(2));
    // Sequences 3..9 are missed; sequence 10 arrives with the accounting.
    const drain = engine.admit(
      buildBatch({
        sequence: 10,
        eventTimeMs: 1000,
        watermark: { watermarkMs: 1000, sequence: 10 },
        recovery: {
          reason: "reconnect",
          fromSequence: 3,
          toSequence: 9,
          missedUpdates: 7,
          gapDurationMs: 700,
        },
      }),
    );
    const source = drain.sources[0]!;
    expect(source.stats.reconnects).toBe(1);
    expect(source.stats.droppedObservations).toBe(7);
    expect(drain.gaps[0]!.missedUpdates).toBe(7);
    expect(drain.gaps[0]!.gapDurationMs).toBe(700);
    // The frontier walked PAST the accounted gap (sequences 1, 2 applied;
    // 3..9 accounted; 10 itself still in flight inside the window) — the
    // hole stays visible in the numbering: 2 → 9, never renumbered.
    expect(source.watermark.sequence).toBe(9);
    expect(source.watermark.watermarkMs).toBe(750); // min(1000, 1000 − 250)
  });
});

describe("BOOT — the pre-arrival state (D3's closed vocabulary)", () => {
  test("the pure evaluator expresses BOOT; the engine never ghosts a source", () => {
    // The evaluator pin: no observations + no latch = BOOT (the vocabulary's
    // pre-arrival member — the D3 machine's entry state).
    expect(
      evaluateSourceState({
        hasObserved: false,
        stalled: false,
        openHoles: 0,
        watermarkLagMs: 0,
        lagBudgetMs: 2000,
      }),
    ).toBe("BOOT");
    // The engine-level honesty: a source exists in the accounting only after
    // its first admission, and a first admission can never be late (the
    // watermark starts at 0 and event times are >= 0) nor a duplicate — so
    // every surfaced source has already left BOOT. No ghost sources are
    // fabricated for ticks alone.
    const engine = createTemporalBufferEngine({ sessionId: HARNESS_SESSION_ID });
    engine.tick(0);
    engine.tick(10_000);
    expect(engine.stats()).toHaveLength(0);
  });
});
