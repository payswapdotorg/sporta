/**
 * W402 §3.2 tests: the deterministic bounded forward replay — the accept
 * criterion (same input → deep-equal result, net-effect equivalence against
 * the fusion-fed engine), corrections (supersession skip, orphaned
 * corrections, chains, duplicates), checkpoint cadence (hand-checked
 * boundary math), limits enforcement (exact message shapes), and fail-loud
 * input validation.
 */
import { describe, expect, test } from "bun:test";
import { runWorldFusion } from "@sporta/fusion";
import { LateEventError } from "@sporta/world-model";
import {
  EMPTY_WINDOW_SESSION_ID,
  REPLAY_GENERATED_AT_MS,
  TemporalLimitsError,
  eventWindow,
  replayForward,
} from "../src/index";
import type { ReplayLimits } from "../src/index";
import {
  SESSION_ID,
  buildMultiStreamObservations,
  makeEntries,
  makeEngine,
  makeEvent,
  makeFootballState,
  makeStore,
} from "./helpers";

const LIMITS: ReplayLimits = { maxEvents: 10, maxSpanMs: 6_000, checkpointEveryMs: 2_000 };

/** A fusion-fed engine A plus its full event stream (the W401 seam). */
function fusedEngineA() {
  const engine = makeEngine({ football: makeFootballState() });
  const report = runWorldFusion({
    store: makeStore(buildMultiStreamObservations()),
    engine,
    sessionId: SESSION_ID,
  });
  return { engine, report, entries: engine.eventsSince(0) };
}

describe("replay determinism (accept criterion)", () => {
  test("a fusion-fed middle-span window replays twice → deep-equal (checkpoints, final, all counts)", () => {
    const { entries } = fusedEngineA();
    // The full fusion-fed stream: kickoff (500), pass (3000), goal (6000).
    expect(entries.map((entry) => entry.event.eventTimeMs)).toEqual([500, 3_000, 6_000]);
    const window = eventWindow(entries, { fromMs: 2_500, toMs: 7_000 });
    expect(window.map((entry) => entry.event.eventId)).toEqual(["fe-ceu-ec-2", "fe-ceu-ec-3"]);

    const first = replayForward({ entries: window, limits: LIMITS });
    const second = replayForward({ entries: window, limits: LIMITS });
    expect(first).toEqual(second);

    expect(first.eventsApplied).toBe(2);
    expect(first.correctionsApplied).toBe(0);
    expect(first.supersededSkipped).toBe(0);
    expect(first.correctionsOrphaned).toBe(0);
    expect(first.duplicatesSkipped).toBe(0);
    // pass (3000) crosses 2000; goal (6000) crosses 4000; + final.
    expect(first.checkpoints.length).toBe(3);
  });

  test("every snapshot is generatedAtMs = the forced deterministic constant (never a wall clock)", () => {
    const { entries } = fusedEngineA();
    const window = eventWindow(entries, { fromMs: 2_500, toMs: 7_000 });
    const result = replayForward({ entries: window, limits: LIMITS });
    expect(result.final.generatedAtMs).toBe(REPLAY_GENERATED_AT_MS);
    expect(result.checkpoints.every((c) => c.generatedAtMs === REPLAY_GENERATED_AT_MS)).toBe(true);
  });

  test("init.now is IGNORED — the replay clock is forced deterministic", () => {
    const window = makeEntries([makeEvent({ eventId: "e1", t: 1_000 })]);
    const result = replayForward({
      entries: window,
      limits: LIMITS,
      init: { now: () => 123_456 },
    });
    expect(result.final.generatedAtMs).toBe(REPLAY_GENERATED_AT_MS);
  });

  test("input order does not matter: the window is applied in SEQUENCE order", () => {
    const { entries } = fusedEngineA();
    const window = eventWindow(entries, { fromMs: 2_500, toMs: 7_000 });
    const inOrder = replayForward({ entries: window, limits: LIMITS });
    const reversed = replayForward({ entries: [...window].reverse(), limits: LIMITS });
    expect(inOrder).toEqual(reversed);
  });

  test("net effect equivalence against engine A at the window boundary (differences documented)", () => {
    const { engine } = fusedEngineA();
    const atBoundary = engine.snapshot(7_000);
    const { entries } = fusedEngineA();
    const window = eventWindow(entries, { fromMs: 2_500, toMs: 7_000 });
    const result = replayForward({ entries: window, limits: LIMITS });

    // Entity positions: with this fixture A's at-boundary entity state is
    // empty (every entity's last update is the t=10000 final frame, beyond
    // the boundary), and the replay's is empty because the event stream
    // carries no entity state at all — INTENTIONAL difference: entity state
    // comes from W401's entity pass (upserts), which is not part of the
    // event window; an event-only replay cannot reconstruct it.
    expect(result.final.entities).toEqual(atBoundary.entities);

    // The temporal position matches: the replayed watermark sits at the same
    // event-time boundary as A's at-T state.
    expect(result.final.watermark.watermarkMs).toBe(atBoundary.watermark.watermarkMs);

    // Documented intentional differences:
    // 1. watermark.sequence is REPLAY-LOCAL (2 vs A's 3): the fresh engine
    //    numbers only the window's events; A's pre-window kickoff (seq 1) is
    //    not in the window.
    expect(result.final.watermark.sequence).toBe(2);
    expect(atBoundary.watermark.sequence).toBe(3);
    // 2. generatedAtMs: the replay's forced constant vs A's engine clock.
    expect(result.final.generatedAtMs).toBe(REPLAY_GENERATED_AT_MS);
    expect(atBoundary.generatedAtMs).not.toBe(REPLAY_GENERATED_AT_MS);
    // 3. football: not passed via init in this replay → absent (the football
    //    context is caller-provided; see the e2e tests).
    expect(result.final.football).toBeUndefined();
  });

  test("checkpoints are deep-frozen engine clones (W006 snapshot semantics)", () => {
    const { entries } = fusedEngineA();
    const window = eventWindow(entries, { fromMs: 2_500, toMs: 7_000 });
    const result = replayForward({ entries: window, limits: LIMITS });
    for (const checkpoint of result.checkpoints) {
      expect(Object.isFrozen(checkpoint)).toBe(true);
      expect(Object.isFrozen(checkpoint.entities)).toBe(true);
    }
  });
});

describe("replay corrections (versioned supersession)", () => {
  test("event X + correction C(of X): C applies, X is superseded-skipped", () => {
    const window = makeEntries([
      makeEvent({ eventId: "x", t: 1_000 }),
      makeEvent({ eventId: "c", t: 2_000, correctionOf: "x" }),
    ]);
    const result = replayForward({
      entries: window,
      limits: { maxEvents: 10, maxSpanMs: 6_000, checkpointEveryMs: 500 },
    });
    expect(result.eventsApplied).toBe(1);
    expect(result.correctionsApplied).toBe(1);
    expect(result.supersededSkipped).toBe(1);
    expect(result.correctionsOrphaned).toBe(0);
    expect(result.duplicatesSkipped).toBe(0);
    // The corrected value replayed at the CORRECTION's position: the final
    // watermark carries C's time and the replay-local sequence 1.
    expect(result.final.watermark).toEqual({ watermarkMs: 2_000, sequence: 1 });
    // The superseded X never checkpoints; C (applied, t=2000 >= 500) does.
    expect(result.checkpoints.length).toBe(2);
    expect(result.checkpoints[0]?.watermark).toEqual({ watermarkMs: 2_000, sequence: 1 });
  });

  test("an orphaned correction (target outside the window) is skipped and counted — no throw, no silent loss", () => {
    const window = makeEntries([
      makeEvent({ eventId: "e1", t: 100 }),
      makeEvent({ eventId: "c", t: 900, correctionOf: "elsewhere" }),
    ]);
    const result = replayForward({
      entries: window,
      limits: { maxEvents: 10, maxSpanMs: 6_000, checkpointEveryMs: 500 },
    });
    expect(result.eventsApplied).toBe(1);
    expect(result.correctionsApplied).toBe(0);
    expect(result.correctionsOrphaned).toBe(1);
    expect(result.final.watermark).toEqual({ watermarkMs: 100, sequence: 1 });
  });

  test("a lone orphaned correction still yields a final snapshot (empty engine state)", () => {
    const window = makeEntries([makeEvent({ eventId: "c", t: 100, correctionOf: "elsewhere" })]);
    const result = replayForward({ entries: window, limits: LIMITS });
    expect(result.eventsApplied).toBe(0);
    expect(result.correctionsOrphaned).toBe(1);
    expect(result.checkpoints.length).toBe(1);
    expect(result.final.entities).toEqual([]);
    expect(result.final.watermark).toEqual({ watermarkMs: 0, sequence: 0 });
  });

  test("a correction chain X → C(of X) → D(of C): only the FINAL correction's content applies", () => {
    const window = makeEntries([
      makeEvent({ eventId: "x", t: 100 }),
      makeEvent({ eventId: "c", t: 200, correctionOf: "x" }),
      makeEvent({ eventId: "d", t: 300, correctionOf: "c" }),
    ]);
    const result = replayForward({
      entries: window,
      limits: { maxEvents: 10, maxSpanMs: 6_000, checkpointEveryMs: 500 },
    });
    // X and C are both superseded (by C and D respectively); D carries the
    // chain's net effect and applies at its own position.
    expect(result.supersededSkipped).toBe(2);
    expect(result.eventsApplied).toBe(1);
    expect(result.correctionsApplied).toBe(1);
    expect(result.correctionsOrphaned).toBe(0);
    expect(result.final.watermark).toEqual({ watermarkMs: 300, sequence: 1 });
  });

  test("duplicate event ids are skipped idempotently (DuplicateEventError → count + skip)", () => {
    const event = makeEvent({ eventId: "e1", t: 100 });
    const window = makeEntries([event, { ...event }]);
    const result = replayForward({ entries: window, limits: LIMITS });
    expect(result.eventsApplied).toBe(1);
    expect(result.duplicatesSkipped).toBe(1);
  });

  test("a correction whose target is only LATER in the window is orphaned (incoherent order)", () => {
    // Hand-built incoherence: the correction precedes its target in
    // sequence order — no real engine produces this, and the replay must
    // not paper over it with a reorder.
    const events = [
      makeEvent({ eventId: "c", t: 100, correctionOf: "x" }),
      makeEvent({ eventId: "x", t: 200 }),
    ];
    const window = makeEntries(events);
    const result = replayForward({ entries: window, limits: LIMITS });
    expect(result.correctionsOrphaned).toBe(1);
    expect(result.eventsApplied).toBe(1);
  });
});

describe("replay checkpoints (cadence)", () => {
  const CADENCE_LIMITS: ReplayLimits = { maxEvents: 10, maxSpanMs: 6_000, checkpointEveryMs: 500 };

  test("boundary-crossing math, hand-checked: events at 0, 400, 800, 1200 with cadence 500", () => {
    // t=0 and t=400 cross NO uncrossed boundary; t=800 crosses 500;
    // t=1200 crosses 1000 — one checkpoint per TRIGGERING event — plus the
    // always-present final: exactly 3 checkpoints.
    const window = makeEntries([
      makeEvent({ eventId: "e1", t: 0 }),
      makeEvent({ eventId: "e2", t: 400 }),
      makeEvent({ eventId: "e3", t: 800 }),
      makeEvent({ eventId: "e4", t: 1_200 }),
    ]);
    const result = replayForward({ entries: window, limits: CADENCE_LIMITS });
    expect(result.checkpoints.length).toBe(3);
    expect(result.checkpoints.map((c) => c.watermark.sequence)).toEqual([3, 4, 4]);
    expect(result.checkpoints.map((c) => c.watermark.watermarkMs)).toEqual([800, 1_200, 1_200]);
    expect(result.checkpoints.at(-1)).toEqual(result.final);
  });

  test("an event landing exactly ON a boundary checkpoints (inclusive crossing)", () => {
    const window = makeEntries([
      makeEvent({ eventId: "e1", t: 0 }),
      makeEvent({ eventId: "e2", t: 500 }),
    ]);
    const result = replayForward({ entries: window, limits: CADENCE_LIMITS });
    expect(result.checkpoints.length).toBe(2);
    expect(result.checkpoints.map((c) => c.watermark.sequence)).toEqual([2, 2]);
  });

  test("one event skipping several boundaries yields ONE checkpoint (then the boundary jumps past it)", () => {
    const window = makeEntries([makeEvent({ eventId: "e1", t: 1_300 })]);
    const result = replayForward({ entries: window, limits: CADENCE_LIMITS });
    expect(result.checkpoints.length).toBe(2);
    expect(result.checkpoints[0]?.watermark.watermarkMs).toBe(1_300);
  });

  test("final is ALWAYS present, even with zero events", () => {
    const result = replayForward({ entries: [], limits: CADENCE_LIMITS });
    expect(result.checkpoints.length).toBe(1);
    expect(result.checkpoints[0]).toBe(result.final);
    expect(result.eventsApplied).toBe(0);
    expect(result.final.entities).toEqual([]);
    expect(result.final.watermark).toEqual({ watermarkMs: 0, sequence: 0 });
    expect(result.final.sessionId).toBe(EMPTY_WINDOW_SESSION_ID);
  });

  test("skipped events (superseded) never trigger checkpoints", () => {
    const window = makeEntries([
      makeEvent({ eventId: "x", t: 100 }),
      makeEvent({ eventId: "c", t: 10_000, correctionOf: "x" }),
    ]);
    const result = replayForward({
      entries: window,
      limits: { maxEvents: 10, maxSpanMs: 20_000, checkpointEveryMs: 500 },
    });
    // Only C applied (t=10000): one boundary checkpoint + final.
    expect(result.checkpoints.length).toBe(2);
  });
});

describe("replay limits (fail loud, bounded by design)", () => {
  const EVENTS = makeEntries([
    makeEvent({ eventId: "e1", t: 100 }),
    makeEvent({ eventId: "e2", t: 200 }),
    makeEvent({ eventId: "e3", t: 300 }),
  ]);

  test("exceeding maxEvents throws TemporalLimitsError with the exact message shape", () => {
    let caught: unknown;
    try {
      replayForward({
        entries: EVENTS,
        limits: { maxEvents: 2, maxSpanMs: 6_000, checkpointEveryMs: 500 },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TemporalLimitsError);
    expect(caught).toBeInstanceOf(RangeError);
    expect((caught as TemporalLimitsError).limitKind).toBe("maxEvents");
    expect((caught as TemporalLimitsError).limit).toBe(2);
    expect((caught as TemporalLimitsError).actual).toBe(3);
    expect((caught as TemporalLimitsError).message).toBe(
      "replayForward: 3 events to apply exceeds maxEvents=2 " +
        "(replay is a bounded operation by design — narrow the window or raise the limit)",
    );
  });

  test("superseded entries do NOT count towards maxEvents (they are provably never applied)", () => {
    const window = makeEntries([
      makeEvent({ eventId: "x", t: 100 }),
      makeEvent({ eventId: "c", t: 200, correctionOf: "x" }),
      makeEvent({ eventId: "e3", t: 300 }),
    ]);
    // 3 entries, 2 to apply (x is superseded): within maxEvents=2.
    const result = replayForward({
      entries: window,
      limits: { maxEvents: 2, maxSpanMs: 6_000, checkpointEveryMs: 500 },
    });
    expect(result.eventsApplied).toBe(2);
    expect(result.supersededSkipped).toBe(1);
  });

  test("exceeding maxSpanMs throws TemporalLimitsError with the exact message shape", () => {
    const window = makeEntries([
      makeEvent({ eventId: "e1", t: 0 }),
      makeEvent({ eventId: "e2", t: 10_000 }),
    ]);
    let caught: unknown;
    try {
      replayForward({
        entries: window,
        limits: { maxEvents: 10, maxSpanMs: 5_000, checkpointEveryMs: 500 },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TemporalLimitsError);
    expect((caught as TemporalLimitsError).limitKind).toBe("maxSpanMs");
    expect((caught as TemporalLimitsError).actual).toBe(10_000);
    expect((caught as TemporalLimitsError).message).toBe(
      "replayForward: window span 10000ms exceeds maxSpanMs=5000 " +
        "(replay is a bounded operation by design — narrow the window or raise the limit)",
    );
  });

  test("a span exactly AT the limit is accepted (the limit is inclusive)", () => {
    const window = makeEntries([
      makeEvent({ eventId: "e1", t: 0 }),
      makeEvent({ eventId: "e2", t: 5_000 }),
    ]);
    const result = replayForward({
      entries: window,
      limits: { maxEvents: 10, maxSpanMs: 5_000, checkpointEveryMs: 500 },
    });
    expect(result.eventsApplied).toBe(2);
  });

  test("the enforced limits are echoed in the result", () => {
    const limits: ReplayLimits = { maxEvents: 10, maxSpanMs: 6_000, checkpointEveryMs: 2_000 };
    const result = replayForward({ entries: EVENTS, limits });
    expect(result.limits).toEqual(limits);
    expect(Object.isFrozen(result.limits)).toBe(true);
  });

  test("malformed limits fail loud (RangeError)", () => {
    const base = { maxSpanMs: 6_000, checkpointEveryMs: 500 };
    expect(() =>
      replayForward({ entries: EVENTS, limits: { ...base, maxEvents: 0 } as never }),
    ).toThrow(RangeError);
    expect(() =>
      replayForward({ entries: EVENTS, limits: { ...base, maxEvents: 1.5 } as never }),
    ).toThrow(RangeError);
    expect(() =>
      replayForward({
        entries: EVENTS,
        limits: { maxEvents: 10, maxSpanMs: Number.NaN, checkpointEveryMs: 500 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      replayForward({
        entries: EVENTS,
        limits: { maxEvents: 10, maxSpanMs: 6_000, checkpointEveryMs: 0 },
      }),
    ).toThrow(RangeError);
    expect(() => replayForward({ entries: EVENTS, limits: null as never })).toThrow(RangeError);
  });

  test("malformed input fails loud BEFORE any application", () => {
    expect(() => replayForward(null as never)).toThrow(RangeError);
    expect(() => replayForward({ entries: null as never, limits: LIMITS })).toThrow(RangeError);
    expect(() => replayForward({ entries: [null as never], limits: LIMITS })).toThrow(
      "entries[0] is not a valid WorldEventStreamEntry",
    );
  });

  test("a window spanning multiple sessions fails loud", () => {
    const foreign = { ...makeEvent({ eventId: "foreign", t: 100 }), sessionId: "sess-other" };
    const window = makeEntries([makeEvent({ eventId: "local", t: 200 }), foreign]);
    expect(() => replayForward({ entries: window, limits: LIMITS })).toThrow(RangeError);
    expect(() => replayForward({ entries: window, limits: LIMITS })).toThrow(
      "entries span multiple sessions",
    );
  });

  test("a window incoherent with the engine's bounded reorder propagates LateEventError (fail loud)", () => {
    // Sequence order demands applying t=100000 before t=0 — 100000ms behind
    // the high-water is far beyond the 5000ms reorder window. Real
    // engine-derived windows can never produce this (a subsequence of an
    // accepted arrival order stays acceptable); hand-built incoherence
    // surfaces the engine's own guarantee instead of hiding it.
    const window = makeEntries([
      makeEvent({ eventId: "e1", t: 100_000 }),
      makeEvent({ eventId: "e2", t: 0 }),
    ]);
    // maxSpanMs must admit the 100000ms span so the ENGINE's own reorder
    // guarantee is what surfaces (limits are enforced first, by design).
    const limits: ReplayLimits = { maxEvents: 10, maxSpanMs: 200_000, checkpointEveryMs: 500 };
    expect(() => replayForward({ entries: window, limits })).toThrow(LateEventError);
  });
});
