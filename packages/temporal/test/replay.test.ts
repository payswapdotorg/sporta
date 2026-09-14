/**
 * W402 §3.2 tests: `replayForward` — the deterministic bounded forward replay.
 *
 * Covers the accept-criterion determinism chain (fusion-fed engine → event
 * window → replay twice → deep-equal), correction supersession and orphan
 * accounting, sequence-order application (pinned with a log whose event-time
 * order precedes a correction's target), checkpoint cadence (hand-checked
 * boundary math), limits enforcement (pinned message shapes), and input
 * validation/purity.
 */
import { describe, expect, test } from "bun:test";
import { EventSessionMismatchError } from "@sporta/world-model";
import {
  EMPTY_REPLAY_SESSION_ID,
  REPLAY_NOW_MS,
  TemporalLimitsError,
  eventWindow,
  replayForward,
} from "../src/index";
import type { ReplayLimits } from "../src/index";
import {
  buildE2EObservations,
  fuse,
  makeEngine,
  makeEntry,
  makeEvent,
  makeFootballState,
} from "./helpers";

const LIMITS: ReplayLimits = { maxEvents: 100, maxSpanMs: 60_000, checkpointEveryMs: 500 };

describe("replay determinism (accept criterion: fusion-fed chain)", () => {
  const { engine: engineA } = fuse(buildE2EObservations(), { football: makeFootballState() });
  const window = eventWindow(engineA.eventsSince(0), { fromMs: 2_500, toMs: 6_500 });
  const init = { football: makeFootballState() };

  test("the middle-span window holds the pass and goal events", () => {
    expect(window.map((entry) => entry.event.eventId)).toEqual(["fe-ceu-ec-2", "fe-ceu-ec-3"]);
  });

  test("replayForward twice on the same window → deep-equal results", () => {
    const first = replayForward({ entries: window, limits: LIMITS, init });
    const second = replayForward({ entries: window, limits: LIMITS, init });
    expect(first).toEqual(second);
  });

  test("replayForward over a fresh identical fusion chain → deep-equal results", () => {
    // W401 fusion is deterministic; the temporal layer on top of it is too.
    const { engine: engineA2 } = fuse(buildE2EObservations(), { football: makeFootballState() });
    const window2 = eventWindow(engineA2.eventsSince(0), { fromMs: 2_500, toMs: 6_500 });
    const first = replayForward({ entries: window, limits: LIMITS, init });
    const third = replayForward({ entries: window2, limits: LIMITS, init });
    expect(third).toEqual(first);
  });

  test("all counters are exact for the two-event window", () => {
    const result = replayForward({ entries: window, limits: LIMITS, init });
    expect(result.eventsApplied).toBe(2);
    expect(result.correctionsApplied).toBe(0);
    expect(result.supersededSkipped).toBe(0);
    expect(result.correctionsOrphaned).toBe(0);
    expect(result.eventsDeduplicated).toBe(0);
  });

  test("checkpoints land on the cadence: after t=3_000 (crossed 2_000) and t=6_000 (crossed 4_000), plus final", () => {
    const result = replayForward({
      entries: window,
      limits: { maxEvents: 100, maxSpanMs: 60_000, checkpointEveryMs: 2_000 },
      init,
    });
    expect(result.checkpoints).toHaveLength(3);
    expect(result.checkpoints[0]!.watermark).toEqual({ watermarkMs: 3_000, sequence: 1 });
    expect(result.checkpoints[1]!.watermark).toEqual({ watermarkMs: 6_000, sequence: 2 });
    expect(result.checkpoints[2]!.watermark).toEqual({ watermarkMs: 6_000, sequence: 2 });
  });

  test("net effect equivalence at the same boundary (documented intentional differences)", () => {
    const result = replayForward({
      entries: window,
      limits: { maxEvents: 100, maxSpanMs: 60_000, checkpointEveryMs: 2_000 },
      init,
    });
    const boundary = result.final.watermark.watermarkMs;

    // ENTITY POSITIONS at the same boundary: the replay's entities equal
    // engine A's at the same boundary — both EMPTY here, and that is the
    // honest equivalence: events carry NO entity state (A's entities live at
    // t=10_000, past this boundary), so the event-log rebuild matches A's
    // state at the boundary exactly. Entity state at T is `stateAt`'s job.
    expect(result.final.entities).toEqual(engineA.snapshot(boundary).entities);

    // The timeline POSITION matches engine A at the boundary; the sequence
    // differs exactly by the events the window excluded (the kickoff event
    // before fromMs) — the replay numbers sequences within the window.
    expect(result.final.watermark.watermarkMs).toBe(boundary);
    expect(engineA.snapshot(boundary).watermark).toEqual({ watermarkMs: boundary, sequence: 3 });
    expect(result.final.watermark).toEqual({ watermarkMs: boundary, sequence: 2 });

    // generatedAtMs: the replay's forced deterministic constant vs the live
    // engine's fixed test wall-clock — pinned intentional difference.
    expect(result.final.generatedAtMs).toBe(REPLAY_NOW_MS);
    expect(engineA.snapshot().generatedAtMs).not.toBe(REPLAY_NOW_MS);

    // Football state is carried from the window-start seed, verbatim.
    expect(result.final.football).toEqual(makeFootballState());
  });
});

describe("replay corrections (supersession, orphans, chains)", () => {
  test("a window containing X + C(of X): C applies, X is superseded-skipped", () => {
    const entries = [
      makeEntry(1, makeEvent({ eventId: "evt-x", eventTimeMs: 5_000 })),
      makeEntry(2, makeEvent({ eventId: "evt-c", eventTimeMs: 5_200, correctionOf: "evt-x" })),
    ];
    const result = replayForward({
      entries,
      limits: LIMITS,
      init: { football: makeFootballState() },
    });
    expect(result.correctionsApplied).toBe(1);
    expect(result.supersededSkipped).toBe(1);
    // Counting X as applied TOO would double-count evidence — only C counts.
    expect(result.eventsApplied).toBe(1);
    expect(result.correctionsOrphaned).toBe(0);
    expect(result.eventsDeduplicated).toBe(0);
    // The superseded original IS in the replay engine's log (the engine needs
    // the target present to record the supersession — the live log keeps
    // superseded events queryable): the final watermark sequence covers BOTH
    // entries.
    expect(result.final.watermark).toEqual({ watermarkMs: 5_200, sequence: 2 });
  });

  test("an orphaned correction (target outside the window) is skipped and counted — no throw, no silent loss", () => {
    const entries = [
      makeEntry(
        1,
        makeEvent({ eventId: "evt-c", eventTimeMs: 5_000, correctionOf: "evt-elsewhere" }),
      ),
    ];
    const result = replayForward({
      entries,
      limits: LIMITS,
      init: { football: makeFootballState() },
    });
    expect(result.correctionsOrphaned).toBe(1);
    expect(result.eventsApplied).toBe(0);
    expect(result.correctionsApplied).toBe(0);
    // The orphan was NOT applied: the replay engine's log is empty.
    expect(result.final.watermark).toEqual({ watermarkMs: 0, sequence: 0 });
    expect(result.checkpoints).toHaveLength(1);
  });

  test("a correction chain replays to the latest correction", () => {
    const entries = [
      makeEntry(1, makeEvent({ eventId: "evt-x", eventTimeMs: 1_000 })),
      makeEntry(2, makeEvent({ eventId: "evt-c1", eventTimeMs: 2_000, correctionOf: "evt-x" })),
      makeEntry(3, makeEvent({ eventId: "evt-c2", eventTimeMs: 3_000, correctionOf: "evt-c1" })),
    ];
    const result = replayForward({ entries, limits: LIMITS });
    // X is superseded by C1; C1 is superseded by C2 — only C2 counts.
    expect(result.supersededSkipped).toBe(2);
    expect(result.correctionsApplied).toBe(1);
    expect(result.eventsApplied).toBe(1);
    expect(result.correctionsOrphaned).toBe(0);
  });

  test("corrections apply in SEQUENCE order even when the log's event-time order precedes the target (pinned)", () => {
    // Engine-built log: X (t=5_000, seq 1) applied first; the correction C
    // (of X, t=3_000, seq 2) arrives LATER but EARLIER in event time —
    // accepted within the 5_000ms bounded reorder window. eventsSince(0)
    // returns event-time order [C, X]; replaying in EVENT-TIME order would
    // orphan C. The replay applies in SEQUENCE order [X, C], so C applies.
    const engine = makeEngine();
    engine.applyEvent(makeEvent({ eventId: "evt-x", eventTimeMs: 5_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt-c", eventTimeMs: 3_000, correctionOf: "evt-x" }));
    const entries = engine.eventsSince(0);
    expect(entries.map((entry) => entry.event.eventTimeMs)).toEqual([3_000, 5_000]);
    expect(entries.map((entry) => entry.sequence)).toEqual([2, 1]);
    const result = replayForward({ entries, limits: LIMITS });
    expect(result.correctionsApplied).toBe(1);
    expect(result.correctionsOrphaned).toBe(0);
    expect(result.supersededSkipped).toBe(1);
  });

  test("duplicate event ids within the window are counted and skipped (idempotent inputs)", () => {
    const event = makeEvent({ eventId: "evt-dup", eventTimeMs: 1_000 });
    const entries = [makeEntry(1, event), makeEntry(2, event)];
    const result = replayForward({ entries, limits: LIMITS });
    expect(result.eventsApplied).toBe(1);
    expect(result.eventsDeduplicated).toBe(1);
    expect(result.final.watermark).toEqual({ watermarkMs: 1_000, sequence: 1 });
  });
});

describe("replay checkpoints (cadence, hand-checked boundary math)", () => {
  function entriesAt(times: readonly number[]) {
    return times.map((time, index) =>
      makeEntry(index + 1, makeEvent({ eventId: `evt-${index + 1}`, eventTimeMs: time })),
    );
  }

  test("events at t=0,400,800,1200 with checkpointEveryMs 500 → checkpoints at 800 and 1200 + final", () => {
    // Hand-checked: NO checkpoint after the t=400 event — checkpoints land
    // after the FIRST event whose time CROSSES each 500 boundary: t=800
    // crossed 500; t=1200 crossed 1000. Plus the always-present final.
    const result = replayForward({
      entries: entriesAt([0, 400, 800, 1_200]),
      limits: { maxEvents: 10, maxSpanMs: 10_000, checkpointEveryMs: 500 },
    });
    expect(result.checkpoints).toHaveLength(3);
    expect(result.checkpoints[0]!.watermark).toEqual({ watermarkMs: 800, sequence: 3 });
    expect(result.checkpoints[1]!.watermark).toEqual({ watermarkMs: 1_200, sequence: 4 });
    expect(result.checkpoints[2]!.watermark).toEqual({ watermarkMs: 1_200, sequence: 4 });
    expect(result.final).toBe(result.checkpoints[2]!);
  });

  test("equal-time events produce one checkpoint per boundary, not per event", () => {
    const result = replayForward({
      entries: entriesAt([800, 800]),
      limits: { maxEvents: 10, maxSpanMs: 10_000, checkpointEveryMs: 500 },
    });
    expect(result.checkpoints).toHaveLength(2);
    expect(result.checkpoints[0]!.watermark).toEqual({ watermarkMs: 800, sequence: 1 });
    expect(result.checkpoints[1]!.watermark).toEqual({ watermarkMs: 800, sequence: 2 });
  });

  test("a sparse event jumping several boundaries collapses them into ONE checkpoint (documented)", () => {
    const result = replayForward({
      entries: entriesAt([1_200]),
      limits: { maxEvents: 10, maxSpanMs: 10_000, checkpointEveryMs: 500 },
    });
    // The event crossed BOTH 500 and 1000 — one checkpoint: the intermediate
    // boundary recorded no state change.
    expect(result.checkpoints).toHaveLength(2);
    expect(result.checkpoints[0]!.watermark).toEqual({ watermarkMs: 1_200, sequence: 1 });
  });

  test("an event exactly ON a boundary checkpoints; the next pending boundary advances past it", () => {
    const result = replayForward({
      entries: entriesAt([500, 999, 1_500]),
      limits: { maxEvents: 10, maxSpanMs: 10_000, checkpointEveryMs: 500 },
    });
    // t=500 crosses 500 → checkpoint; t=999 crosses nothing (next is 1000);
    // t=1_500 crosses 1_000 AND lands on 1_500 → one checkpoint. + final.
    expect(result.checkpoints).toHaveLength(3);
    expect(result.checkpoints[0]!.watermark).toEqual({ watermarkMs: 500, sequence: 1 });
    expect(result.checkpoints[1]!.watermark).toEqual({ watermarkMs: 1_500, sequence: 3 });
  });

  test("final is ALWAYS present, even with zero events", () => {
    const result = replayForward({
      entries: [],
      limits: LIMITS,
      init: { football: makeFootballState() },
    });
    expect(result.checkpoints).toHaveLength(1);
    expect(result.eventsApplied).toBe(0);
    expect(result.final.watermark).toEqual({ watermarkMs: 0, sequence: 0 });
    expect(result.final.sessionId).toBe(EMPTY_REPLAY_SESSION_ID);
    expect(result.final.football).toEqual(makeFootballState());
    expect(result.final.generatedAtMs).toBe(REPLAY_NOW_MS);
  });

  test("checkpoints (and the final) are deep-frozen engine clones — verified", () => {
    const result = replayForward({ entries: entriesAt([800, 1_200]), limits: LIMITS });
    for (const checkpoint of [...result.checkpoints, result.final]) {
      expect(Object.isFrozen(checkpoint)).toBe(true);
      expect(Object.isFrozen(checkpoint.watermark)).toBe(true);
      expect(Object.isFrozen(checkpoint.entities)).toBe(true);
    }
  });
});

describe("replay limits (fail loud, bounded by design)", () => {
  function twoEntries() {
    return [
      makeEntry(1, makeEvent({ eventId: "evt-1", eventTimeMs: 1_000 })),
      makeEntry(2, makeEvent({ eventId: "evt-2", eventTimeMs: 7_000 })),
    ];
  }

  test("maxEvents exceeded → TemporalLimitsError with the pinned message shape", () => {
    let caught: unknown;
    try {
      replayForward({
        entries: twoEntries(),
        limits: { maxEvents: 1, maxSpanMs: 60_000, checkpointEveryMs: 500 },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TemporalLimitsError);
    expect(caught).toBeInstanceOf(RangeError);
    expect((caught as TemporalLimitsError).message).toBe(
      "replayForward: events-to-apply count 2 exceeds maxEvents 1",
    );
    expect((caught as TemporalLimitsError).exceeded).toBe("maxEvents");
    expect((caught as TemporalLimitsError).actual).toBe(2);
    expect((caught as TemporalLimitsError).limit).toBe(1);
  });

  test("maxSpanMs exceeded → TemporalLimitsError with the pinned message shape", () => {
    let caught: unknown;
    try {
      replayForward({
        entries: twoEntries(),
        limits: { maxEvents: 100, maxSpanMs: 5_000, checkpointEveryMs: 500 },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TemporalLimitsError);
    expect((caught as TemporalLimitsError).message).toBe(
      "replayForward: window span 6000ms exceeds maxSpanMs 5000ms",
    );
    expect((caught as TemporalLimitsError).exceeded).toBe("maxSpanMs");
    expect((caught as TemporalLimitsError).actual).toBe(6_000);
    expect((caught as TemporalLimitsError).limit).toBe(5_000);
  });

  test("the limits are echoed in the result (as a copy)", () => {
    const limits: ReplayLimits = { maxEvents: 7, maxSpanMs: 12_345, checkpointEveryMs: 250 };
    const result = replayForward({
      entries: [makeEntry(1, makeEvent({ eventId: "evt-1", eventTimeMs: 1_000 }))],
      limits,
    });
    expect(result.limits).toEqual(limits);
    expect(result.limits).not.toBe(limits);
  });

  test("a zero-span window within maxSpanMs 0 is legal; an empty window within maxEvents 0 is legal", () => {
    const sameTime = [
      makeEntry(1, makeEvent({ eventId: "evt-1", eventTimeMs: 4_000 })),
      makeEntry(2, makeEvent({ eventId: "evt-2", eventTimeMs: 4_000 })),
    ];
    expect(() =>
      replayForward({
        entries: sameTime,
        limits: { maxEvents: 2, maxSpanMs: 0, checkpointEveryMs: 500 },
      }),
    ).not.toThrow();
    expect(() =>
      replayForward({ entries: [], limits: { maxEvents: 0, maxSpanMs: 0, checkpointEveryMs: 1 } }),
    ).not.toThrow();
  });

  test("malformed limits fail loud with RangeError", () => {
    const entries = [makeEntry(1, makeEvent({ eventId: "evt-1", eventTimeMs: 1_000 }))];
    expect(() =>
      replayForward({
        entries,
        limits: { maxEvents: 1, maxSpanMs: 1_000, checkpointEveryMs: 0 },
      }),
    ).toThrow("replayForward: checkpointEveryMs must be a finite number >= 1 (got 0)");
    expect(() =>
      replayForward({
        entries,
        limits: { maxEvents: -1, maxSpanMs: 1_000, checkpointEveryMs: 500 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      replayForward({
        entries,
        limits: { maxEvents: 1, maxSpanMs: Number.NaN, checkpointEveryMs: 500 },
      }),
    ).toThrow(RangeError);
  });
});

describe("replay input validation and purity", () => {
  test("malformed entries fail loud (RangeError) before any work", () => {
    expect(() => replayForward({ entries: null as never, limits: LIMITS })).toThrow(RangeError);
    expect(() =>
      replayForward({
        entries: [
          {
            sequence: 1,
            snapshotVersionAfter: 2,
            event: makeEvent({ eventId: "evt-1", eventTimeMs: 1_000 }),
          },
        ],
        limits: LIMITS,
      }),
    ).not.toThrow();
    expect(() =>
      replayForward({
        entries: [
          {
            sequence: 1.5,
            snapshotVersionAfter: 2,
            event: makeEvent({ eventId: "evt-1", eventTimeMs: 1_000 }),
          } as never,
        ],
        limits: LIMITS,
      }),
    ).toThrow("replayForward: entries[0].sequence must be an integer >= 0 (got 1.5)");
    // A NaN eventTimeMs placed AFTER the fixture builder's parse — the
    // replay's own per-entry guard must catch it before the span math.
    const valid = makeEvent({ eventId: "evt-1", eventTimeMs: 1_000 });
    expect(() =>
      replayForward({
        entries: [
          {
            sequence: 1,
            snapshotVersionAfter: 2,
            event: { ...valid, eventTimeMs: Number.NaN },
          } as never,
        ],
        limits: LIMITS,
      }),
    ).toThrow(RangeError);
    expect(() =>
      replayForward({
        entries: [{ sequence: 1, snapshotVersionAfter: 2, event: null as never }],
        limits: LIMITS,
      }),
    ).toThrow(RangeError);
  });

  test("events from a foreign session fail loud (the engine's error propagates)", () => {
    const entries = [
      makeEntry(1, makeEvent({ eventId: "evt-a", eventTimeMs: 1_000 })),
      makeEntry(2, makeEvent({ eventId: "evt-b", eventTimeMs: 2_000, sessionId: "sess-other" })),
    ];
    expect(() => replayForward({ entries, limits: LIMITS })).toThrow(EventSessionMismatchError);
  });

  test("the input array is never mutated (the replay sorts a copy)", () => {
    const entries = [
      makeEntry(2, makeEvent({ eventId: "evt-b", eventTimeMs: 3_000 })),
      makeEntry(1, makeEvent({ eventId: "evt-a", eventTimeMs: 5_000 })),
    ];
    const inputCopy = [...entries];
    const result = replayForward({ entries, limits: LIMITS });
    expect(entries).toEqual(inputCopy);
    expect(entries[0]!.sequence).toBe(2);
    // Sequence order applied: evt-a (seq 1, t=5_000) first, then evt-b
    // (seq 2, t=3_000 — within the default reorder window). The replay
    // engine's own sequences follow the application order.
    expect(result.eventsApplied).toBe(2);
    expect(result.final.watermark).toEqual({ watermarkMs: 5_000, sequence: 2 });
  });

  test("a caller-provided init.now is REPLACED by the forced deterministic constant", () => {
    const entries = [makeEntry(1, makeEvent({ eventId: "evt-1", eventTimeMs: 1_000 }))];
    const result = replayForward({
      entries,
      limits: LIMITS,
      init: { now: () => 1_234_567_890 },
    });
    expect(result.final.generatedAtMs).toBe(REPLAY_NOW_MS);
  });
});
