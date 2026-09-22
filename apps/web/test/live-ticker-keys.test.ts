import { describe, expect, test } from "bun:test";
import type { LiveWorldFrameDoc } from "../src/lib/live-sse";
import { EVENT_TICKER_DEPTH, tickerRowsForFrame } from "../src/lib/use-live-world-stream";

/**
 * THE TICKER-KEY PIN (the wave-3 cross-lane finding, fixed in wave 4): a
 * fresh live window's FIRST frame emits ~24 `entity-appeared` events at the
 * SAME `atMs` — the old `${worldVersion}:${type}:${atMs}` key collided on
 * every one of them (duplicate React keys, cosmetic console warnings). The
 * fix adds each entry's own per-frame discriminator (its index); these tests
 * pin uniqueness by construction, determinism, and the wire-shape invariants
 * the fix must preserve (order, phrase, world version, bounded depth).
 */

/** A minimal wire-shaped frame (only what tickerRowsForFrame reads). */
function frame(input: {
  worldVersion: number;
  events: LiveWorldFrameDoc["eventsSincePreviousFrame"];
}): LiveWorldFrameDoc {
  return {
    schemaVersion: "sporta.live-tactical/1",
    sessionId: "live-tactical-synthetic",
    ordinal: input.worldVersion,
    worldVersion: input.worldVersion,
    eventTimeMs: 0,
    watermark: { watermarkMs: 0, sequence: 1 },
    sourceSequence: 1,
    quality: "nominal",
    confidence: { min: 1, mean: 1 },
    entities: [],
    eventsSincePreviousFrame: input.events,
    generatedAtMs: 1_799_999_999_000,
    renderDurationMs: 1,
    telemetry: { watermarkLagMs: 0, undetectedEntities: 0, replayCycle: false },
  };
}

/** The fresh-window first frame: every entity appears at the same atMs. */
function freshWindowFirstFrame(entityCount: number): LiveWorldFrameDoc {
  return frame({
    worldVersion: 1,
    events: Array.from({ length: entityCount }, (_, index) => ({
      type: "entity-appeared" as const,
      atMs: 0,
      detail: { entityRef: `home-1/player-${index + 1}` },
    })),
  });
}

describe("tickerRowsForFrame — unique React keys (the wave-3 finding, pinned)", () => {
  test("a fresh window's first frame: 24 entity-appeared events at one atMs yield 24 DISTINCT keys", () => {
    const rows = tickerRowsForFrame(freshWindowFirstFrame(24));
    expect(rows).toHaveLength(24);
    expect(new Set(rows.map((row) => row.key)).size).toBe(24);
  });

  test("the old collision shape (same type + same atMs, no discriminator) is provably gone", () => {
    const events = [
      { type: "entity-appeared" as const, atMs: 5_000, detail: { entityRef: "home-1/player-1" } },
      { type: "entity-appeared" as const, atMs: 5_000, detail: { entityRef: "home-1/player-2" } },
      { type: "entity-appeared" as const, atMs: 5_000, detail: { entityRef: "home-1/ball" } },
    ];
    const rows = tickerRowsForFrame(frame({ worldVersion: 9, events }));
    const keys = rows.map((row) => row.key);
    // Under the old key template all three collapsed to "9:entity-appeared:5000".
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) {
      expect(keys.filter((other) => other === key)).toHaveLength(1);
    }
  });

  test("mixed event kinds at one atMs stay distinct too", () => {
    const events = [
      { type: "quality-degraded" as const, atMs: 1_200 },
      { type: "entity-lost" as const, atMs: 1_200, detail: { entityRef: "home-1/player-7" } },
      { type: "entity-regained" as const, atMs: 1_200, detail: { entityRef: "home-1/player-7" } },
    ];
    const rows = tickerRowsForFrame(frame({ worldVersion: 4, events }));
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
  });

  test("deterministic: the same frame always yields the same keys (replay-safe)", () => {
    const doc = freshWindowFirstFrame(24);
    expect(tickerRowsForFrame(doc)).toEqual(tickerRowsForFrame(doc));
  });

  test("rows preserve the frame's own order, world version and phrases", () => {
    const events = [
      { type: "entity-appeared" as const, atMs: 0, detail: { entityRef: "home-1/player-1" } },
      {
        type: "source-recovery" as const,
        atMs: 40,
        detail: { missedUpdates: 2, gapDurationMs: 900 },
      },
    ];
    const rows = tickerRowsForFrame(frame({ worldVersion: 7, events }));
    expect(rows.map((row) => row.worldVersion)).toEqual([7, 7]);
    expect(rows[0]!.phrase).toContain("player-1");
    expect(rows[1]!.phrase).toContain("reconnect");
  });

  test("a frame with no events yields no rows (the ticker stays empty)", () => {
    expect(tickerRowsForFrame(frame({ worldVersion: 2, events: [] }))).toEqual([]);
  });

  test("the bounded ticker depth stays the exported contract (8)", () => {
    expect(EVENT_TICKER_DEPTH).toBe(8);
  });
});
