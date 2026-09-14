/**
 * W402 §3.1 tests: `eventWindow` (inclusive bounds, input-order preservation,
 * superseded events included, fail-loud validation) and `stateAt` (verbatim
 * at-T snapshots on a fusion-fed engine, `InvalidTimelineQueryError`
 * pass-through).
 */
import { describe, expect, test } from "bun:test";
import { InvalidTimelineQueryError } from "@sporta/world-model";
import { runWorldFusion } from "@sporta/fusion";
import { eventWindow, stateAt } from "../src/index";
import {
  SESSION_ID,
  buildMultiStreamObservations,
  makeEngine,
  makeEntries,
  makeEvent,
  makeFootballState,
  makeStore,
} from "./helpers";

/** A fusion-fed engine over the multi-stream fixture (the W401 seam). */
function fusedEngine() {
  const engine = makeEngine({ football: makeFootballState() });
  runWorldFusion({
    store: makeStore(buildMultiStreamObservations()),
    engine,
    sessionId: SESSION_ID,
  });
  return engine;
}

describe("eventWindow (time-windowed consumer query)", () => {
  const entries = makeEntries([
    makeEvent({ eventId: "e1", t: 1_000 }),
    makeEvent({ eventId: "e2", t: 2_000 }),
    makeEvent({ eventId: "e3", t: 3_000 }),
  ]);

  test("filters by event time with INCLUSIVE bounds on both ends", () => {
    expect(eventWindow(entries, { fromMs: 1_500, toMs: 2_500 })).toEqual([entries[1]!]);
    expect(eventWindow(entries, { fromMs: 1_000, toMs: 3_000 })).toEqual(entries);
    expect(eventWindow(entries, { fromMs: 2_000, toMs: 2_000 })).toEqual([entries[1]!]);
    expect(eventWindow(entries, { fromMs: 0, toMs: 999 })).toEqual([]);
  });

  test("preserves the INPUT's order — no event-time re-sorting (pinned)", () => {
    // A deliberately out-of-event-time-order log: the window must keep the
    // input order verbatim. Re-sorting by event time would lie about the
    // engine's actual application order (§3.1).
    const outOfOrder = makeEntries([
      makeEvent({ eventId: "e1", t: 3_000 }),
      makeEvent({ eventId: "e2", t: 1_000 }),
      makeEvent({ eventId: "e3", t: 2_000 }),
    ]);
    const windowed = eventWindow(outOfOrder, { fromMs: 0, toMs: 4_000 });
    expect(windowed.map((entry) => entry.event.eventId)).toEqual(["e1", "e2", "e3"]);
    expect(windowed.map((entry) => entry.event.eventTimeMs)).toEqual([3_000, 1_000, 2_000]);
  });

  test("keeps the ENGINE's log order for a bounded-late event (eventsSince passthrough)", () => {
    // The engine accepted a bounded-late event (within the 5000ms reorder
    // window): the log re-orders it to its event-time position, so
    // eventsSince(0) returns event-time order with sequences [2, 1] — the
    // window preserves exactly that.
    const engine = makeEngine();
    engine.applyEvent(makeEvent({ eventId: "late-arrival", t: 10_000 }));
    engine.applyEvent(makeEvent({ eventId: "accepted-late", t: 6_000 }));
    const log = engine.eventsSince(0);
    expect(log.map((entry) => entry.event.eventTimeMs)).toEqual([6_000, 10_000]);
    expect(log.map((entry) => entry.sequence)).toEqual([2, 1]);
    const windowed = eventWindow(log, { fromMs: 0, toMs: 20_000 });
    expect(windowed).toEqual(log);
  });

  test("includes SUPERSEDED events (the full evidence record)", () => {
    const withCorrection = makeEntries([
      makeEvent({ eventId: "x", t: 1_000 }),
      makeEvent({ eventId: "c", t: 2_000, correctionOf: "x" }),
    ]);
    const windowed = eventWindow(withCorrection, { fromMs: 0, toMs: 3_000 });
    expect(windowed).toEqual(withCorrection);
    expect(windowed[1]?.event.correctionOf).toBe("x");
  });

  test("returns the input entries verbatim (same references, no cloning)", () => {
    const windowed = eventWindow(entries, { fromMs: 0, toMs: 2_000 });
    expect(windowed[0]).toBe(entries[0]);
    expect(windowed[1]).toBe(entries[1]);
  });

  test("validation fails loud: fromMs > toMs", () => {
    expect(() => eventWindow(entries, { fromMs: 2_000, toMs: 1_000 })).toThrow(RangeError);
    expect(() => eventWindow(entries, { fromMs: 2_000, toMs: 1_000 })).toThrow(
      "fromMs (2000) must be <= toMs (1000)",
    );
  });

  test("validation fails loud: negative bounds", () => {
    expect(() => eventWindow(entries, { fromMs: -1, toMs: 1_000 })).toThrow(RangeError);
    expect(() => eventWindow(entries, { fromMs: 0, toMs: -5 })).toThrow(RangeError);
  });

  test("validation fails loud: non-finite bounds", () => {
    expect(() => eventWindow(entries, { fromMs: Number.NaN, toMs: 1_000 })).toThrow(RangeError);
    expect(() => eventWindow(entries, { fromMs: 0, toMs: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
    expect(() => eventWindow(entries, { fromMs: Number.NEGATIVE_INFINITY, toMs: 1_000 })).toThrow(
      RangeError,
    );
  });

  test("validation fails loud: malformed entries", () => {
    expect(() => eventWindow(null as never, { fromMs: 0, toMs: 1 })).toThrow(RangeError);
    expect(() => eventWindow([null as never], { fromMs: 0, toMs: 1 })).toThrow(RangeError);
    expect(() => eventWindow([null as never], { fromMs: 0, toMs: 1 })).toThrow(
      "entries[0] is not a valid WorldEventStreamEntry",
    );
    const badEvent = { sequence: 1, snapshotVersionAfter: 2, event: { eventId: "" } };
    expect(() => eventWindow([badEvent as never], { fromMs: 0, toMs: 1 })).toThrow(RangeError);
  });
});

describe("stateAt (state at time T)", () => {
  test("equals engine.snapshot(atMs) field-for-field on a fusion-fed engine", () => {
    const engine = fusedEngine();
    const atBoundary = stateAt(engine, 7_000).snapshot;
    expect(atBoundary).toEqual(engine.snapshot(7_000));
    const atEnd = stateAt(engine, 15_000).snapshot;
    expect(atEnd).toEqual(engine.snapshot(15_000));
    // Verbatim includes the engine's own clock: generatedAtMs is the ENGINE's
    // fixed test epoch — NOT the replay's forced constant (no state added).
    expect(atBoundary.generatedAtMs).toBe(atEnd.generatedAtMs);
  });

  test("the engine's InvalidTimelineQueryError passes through unchanged", () => {
    const engine = fusedEngine();
    expect(() => stateAt(engine, Number.NaN)).toThrow(InvalidTimelineQueryError);
    expect(() => stateAt(engine, Number.NaN)).toThrow("snapshot: atMs must be a number (got NaN)");
  });

  test("a non-engine argument fails loud", () => {
    expect(() => stateAt({} as never, 1_000)).toThrow(RangeError);
    expect(() => stateAt(null as never, 1_000)).toThrow(RangeError);
  });

  test("returns a fresh snapshot per call (no shared mutable state)", () => {
    const engine = fusedEngine();
    const first = stateAt(engine, 7_000).snapshot;
    const second = stateAt(engine, 7_000).snapshot;
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
