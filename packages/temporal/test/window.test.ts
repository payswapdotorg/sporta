/**
 * W402 §3.1 tests: `eventWindow` — exact inclusive filtering, input-order
 * preservation (a deliberately out-of-event-time-order log stays in sequence
 * order — pinned), superseded entries included (honest evidence record), and
 * window validation (fromMs > toMs, negative, non-finite → RangeError).
 */
import { describe, expect, test } from "bun:test";
import { eventWindow } from "../src/index";
import { makeEngine, makeEntry, makeEvent } from "./helpers";

/** A log whose ARRAY order is sequence order but whose event times zig-zag. */
function outOfOrderLog() {
  const engine = makeEngine();
  // Arrival (application) order: t=5_000 (seq 1), then t=3_000 (seq 2 —
  // accepted within the default 5_000ms bounded reorder window), then t=4_000
  // (seq 3). The engine's log (event-time order) is 3_000, 4_000, 5_000 —
  // the ARRIVAL order differs, and only the arrival order is the engine's
  // actual application order.
  engine.applyEvent(makeEvent({ eventId: "evt-a", eventTimeMs: 5_000 }));
  engine.applyEvent(makeEvent({ eventId: "evt-b", eventTimeMs: 3_000 }));
  engine.applyEvent(makeEvent({ eventId: "evt-c", eventTimeMs: 4_000 }));
  return engine.eventsSince(0);
}

describe("eventWindow: exact filtering with inclusive bounds", () => {
  const entries = [
    makeEntry(1, makeEvent({ eventId: "evt-1", eventTimeMs: 1_000 })),
    makeEntry(2, makeEvent({ eventId: "evt-2", eventTimeMs: 2_000 })),
    makeEntry(3, makeEvent({ eventId: "evt-3", eventTimeMs: 3_000 })),
    makeEntry(4, makeEvent({ eventId: "evt-4", eventTimeMs: 4_000 })),
  ];

  test("both bounds are inclusive (entries exactly at fromMs/toMs are kept)", () => {
    const result = eventWindow(entries, { fromMs: 2_000, toMs: 3_000 });
    expect(result.map((entry) => entry.event.eventId)).toEqual(["evt-2", "evt-3"]);
  });

  test("a window covering everything returns every entry", () => {
    const result = eventWindow(entries, { fromMs: 0, toMs: 10_000 });
    expect(result).toHaveLength(4);
  });

  test("a window between event times returns nothing (no boundary rounding)", () => {
    expect(eventWindow(entries, { fromMs: 1_500, toMs: 1_999 })).toEqual([]);
  });

  test("an empty input yields an empty output (no error)", () => {
    expect(eventWindow([], { fromMs: 0, toMs: 100 })).toEqual([]);
  });

  test("the output holds the same (frozen) entry references, in a fresh array", () => {
    const result = eventWindow(entries, { fromMs: 0, toMs: 10_000 });
    expect(result[0]).toBe(entries[0]);
    expect(result).not.toBe(entries);
  });
});

describe("eventWindow: sequence order preserved (pinned)", () => {
  test("a deliberately out-of-event-time-order log stays in the input order", () => {
    // Build the entries MANUALLY in sequence order with descending event
    // times — an order no honest event-time sort would produce. The window
    // must return them EXACTLY as passed: re-sorting by event time would lie
    // about the engine's actual application order.
    const entries = [
      makeEntry(1, makeEvent({ eventId: "evt-first", eventTimeMs: 5_000 })),
      makeEntry(2, makeEvent({ eventId: "evt-second", eventTimeMs: 3_000 })),
      makeEntry(3, makeEvent({ eventId: "evt-third", eventTimeMs: 4_000 })),
    ];
    const result = eventWindow(entries, { fromMs: 0, toMs: 6_000 });
    expect(result.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(result.map((entry) => entry.event.eventTimeMs)).toEqual([5_000, 3_000, 4_000]);
  });

  test("an engine log reordered by event time is returned in the engine's log order", () => {
    // The engine's own eventsSince(0) is event-time ordered (3_000, 4_000,
    // 5_000) even though arrival/sequence order differs — the window keeps
    // the order the CALLER passed, verbatim.
    const entries = outOfOrderLog();
    const result = eventWindow(entries, { fromMs: 0, toMs: 6_000 });
    expect(result.map((entry) => entry.event.eventTimeMs)).toEqual([3_000, 4_000, 5_000]);
    expect(result.map((entry) => entry.sequence)).toEqual([2, 3, 1]);
  });

  test("filtering a middle span keeps the surviving entries' relative input order", () => {
    const entries = outOfOrderLog();
    const result = eventWindow(entries, { fromMs: 2_500, toMs: 4_500 });
    expect(result.map((entry) => entry.event.eventTimeMs)).toEqual([3_000, 4_000]);
  });
});

describe("eventWindow: superseded entries included (honest evidence record)", () => {
  test("a correction AND its superseded target are both inside the window", () => {
    const entries = [
      makeEntry(1, makeEvent({ eventId: "evt-x", eventTimeMs: 1_000 })),
      makeEntry(2, makeEvent({ eventId: "evt-c", eventTimeMs: 2_000, correctionOf: "evt-x" })),
    ];
    const result = eventWindow(entries, { fromMs: 0, toMs: 5_000 });
    expect(result.map((entry) => entry.event.eventId)).toEqual(["evt-x", "evt-c"]);
    expect(result[1]!.event.correctionOf).toBe("evt-x");
  });

  test("a window that contains ONLY the correction still shows its correctionOf chain", () => {
    const entries = [
      makeEntry(1, makeEvent({ eventId: "evt-x", eventTimeMs: 1_000 })),
      makeEntry(2, makeEvent({ eventId: "evt-c", eventTimeMs: 2_000, correctionOf: "evt-x" })),
    ];
    const result = eventWindow(entries, { fromMs: 1_500, toMs: 5_000 });
    expect(result.map((entry) => entry.event.eventId)).toEqual(["evt-c"]);
  });
});

describe("eventWindow: validation (fail loud, RangeError)", () => {
  const entries = [makeEntry(1, makeEvent({ eventId: "evt-1", eventTimeMs: 1_000 }))];

  test("fromMs > toMs throws", () => {
    expect(() => eventWindow(entries, { fromMs: 2_000, toMs: 1_000 })).toThrow(RangeError);
    expect(() => eventWindow(entries, { fromMs: 2_000, toMs: 1_000 })).toThrow(
      "eventWindow: fromMs (2000) must be <= toMs (1000)",
    );
  });

  test("negative bounds throw", () => {
    expect(() => eventWindow(entries, { fromMs: -1, toMs: 1_000 })).toThrow(RangeError);
    expect(() => eventWindow(entries, { fromMs: 0, toMs: -5 })).toThrow(
      "eventWindow: toMs must be a finite number >= 0 (got -5)",
    );
  });

  test("non-finite bounds throw (NaN, +Infinity, -Infinity)", () => {
    expect(() => eventWindow(entries, { fromMs: Number.NaN, toMs: 1_000 })).toThrow(RangeError);
    expect(() => eventWindow(entries, { fromMs: 0, toMs: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
    expect(() => eventWindow(entries, { fromMs: Number.NEGATIVE_INFINITY, toMs: 1_000 })).toThrow(
      RangeError,
    );
  });

  test("non-number bounds throw", () => {
    expect(() => eventWindow(entries, { fromMs: "0" as unknown as number, toMs: 1_000 })).toThrow(
      RangeError,
    );
  });

  test("malformed entries fail loud instead of being silently dropped", () => {
    expect(() =>
      eventWindow([{ sequence: 1, snapshotVersionAfter: 2, event: null as never }], {
        fromMs: 0,
        toMs: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      eventWindow(
        [
          {
            sequence: 1,
            snapshotVersionAfter: 2,
            event: { eventId: "evt-bad" },
          } as never,
        ],
        { fromMs: 0, toMs: 1 },
      ),
    ).toThrow("eventWindow: entries[0].event.eventTimeMs must be a finite number >= 0");
    expect(() => eventWindow(null as never, { fromMs: 0, toMs: 1 })).toThrow(RangeError);
  });
});
