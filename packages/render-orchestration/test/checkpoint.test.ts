/**
 * Watermark-boundary checkpoints (W304): the anchored tracker semantics and
 * the fail-loud checkpoint validation.
 */
import { describe, expect, test } from "bun:test";
import { cutBatch } from "../src/batch";
import { RenderCheckpointTracker, validateRenderCheckpoint } from "../src/checkpoint";
import { emptyStats } from "../src/types";
import type { RenderCheckpoint, SwmUpdate } from "../src/types";
import { InvalidRenderCheckpointError } from "../src/errors";

/** One authored update (minimal honest shape). */
function update(sequence: number, watermarkMs: number): SwmUpdate {
  return {
    sequence,
    watermark: { watermarkMs, sequence },
    snapshot: {
      sessionId: "sess",
      schemaVersion: "1.0",
      entities: [],
      watermark: { watermarkMs, sequence },
      generatedAtMs: 0,
    },
    events: [],
    byteSize: 100,
  };
}

function batchOf(
  ordinal: number,
  closedBy: "size-limit" | "watermark-boundary" | "stream-complete",
  window: { startMs: number; endMs: number },
  updates: SwmUpdate[],
): ReturnType<typeof cutBatch> {
  return cutBatch({ sessionId: "sess", ordinal, windowMs: window, updates, closedBy });
}

describe("RenderCheckpointTracker (anchored at the crossing batch)", () => {
  test("a cut anchors every resume field at the CROSSING BATCH, not the live cursor", () => {
    const tracker = new RenderCheckpointTracker({
      intervalMs: 1_000,
      initialNextBoundaryMs: 1_000,
    });
    const batch = batchOf(5, "watermark-boundary", { startMs: 4_000, endMs: 5_000 }, [
      update(9, 4_250),
      update(10, 5_000),
    ]);
    expect(tracker.crossesBoundary(5_000)).toBe(true);
    const checkpoint = tracker.cut({
      batch,
      processedKeys: [{ key: "render-sess-wm-5000-seq-10", disposition: "rendered" }],
      stats: emptyStats(),
      atMs: 12_345,
    });
    // Anchored at the crossing batch: its sequence, its ordinal + 1, and
    // the consumer grid right after its cut (postCutGrid).
    expect(checkpoint.index).toBe(1);
    expect(checkpoint.watermark).toEqual({ watermarkMs: 5_000, sequence: 10 });
    expect(checkpoint.consumedThroughSequence).toBe(10);
    expect(checkpoint.nextBatchOrdinal).toBe(6);
    expect(checkpoint.nextBoundaryMs).toBe(6_000);
    expect(checkpoint.nextWindowStartMs).toBe(5_000);
    expect(checkpoint.atMs).toBe(12_345);
  });

  test("a size-limit crossing keeps the window's boundary (the window continues)", () => {
    const tracker = new RenderCheckpointTracker({
      intervalMs: 1_000,
      initialNextBoundaryMs: 1_000,
    });
    const batch = batchOf(2, "size-limit", { startMs: 1_000, endMs: 2_000 }, [
      update(3, 1_250),
      update(4, 1_750),
    ]);
    const checkpoint = tracker.cut({
      batch,
      processedKeys: [],
      stats: emptyStats(),
      atMs: 0,
    });
    expect(checkpoint.nextBoundaryMs).toBe(2_000);
    expect(checkpoint.nextWindowStartMs).toBe(1_750);
    expect(checkpoint.consumedThroughSequence).toBe(4);
    expect(checkpoint.nextBatchOrdinal).toBe(3);
  });

  test("cuts are monotone: a later, smaller watermark cannot un-cut a boundary", () => {
    const tracker = new RenderCheckpointTracker({
      intervalMs: 1_000,
      initialNextBoundaryMs: 1_000,
    });
    const first = tracker.cut({
      batch: batchOf(1, "watermark-boundary", { startMs: 0, endMs: 1_000 }, [update(1, 1_000)]),
      processedKeys: [],
      stats: emptyStats(),
      atMs: 0,
    });
    expect(tracker.boundary).toBe(2_000);
    expect(tracker.crossesBoundary(1_500)).toBe(false);
    // A late terminal at 1_500 does not cut; 2_000 does.
    const second = tracker.cut({
      batch: batchOf(2, "watermark-boundary", { startMs: 1_000, endMs: 2_000 }, [update(2, 2_000)]),
      processedKeys: [],
      stats: emptyStats(),
      atMs: 5,
    });
    expect(second.index).toBe(2);
    expect(first.index).toBe(1);
    expect(tracker.cuts).toBe(2);
  });

  test("initialCuts continues the session's cut ordinal across resumes", () => {
    const tracker = new RenderCheckpointTracker({
      intervalMs: 1_000,
      initialNextBoundaryMs: 6_000,
      initialCuts: 4,
    });
    const checkpoint = tracker.cut({
      batch: batchOf(5, "watermark-boundary", { startMs: 5_000, endMs: 6_000 }, [
        update(10, 6_000),
      ]),
      processedKeys: [],
      stats: emptyStats(),
      atMs: 0,
    });
    expect(checkpoint.index).toBe(5);
    expect(tracker.cuts).toBe(5);
  });

  test("constructor refuses invalid intervals and boundaries (fail-loud)", () => {
    expect(
      () => new RenderCheckpointTracker({ intervalMs: 0, initialNextBoundaryMs: 1_000 }),
    ).toThrow(RangeError);
    expect(
      () => new RenderCheckpointTracker({ intervalMs: Number.NaN, initialNextBoundaryMs: 1_000 }),
    ).toThrow(RangeError);
    expect(
      () => new RenderCheckpointTracker({ intervalMs: 1_000, initialNextBoundaryMs: Infinity }),
    ).toThrow(RangeError);
    expect(
      () =>
        new RenderCheckpointTracker({
          intervalMs: 1_000,
          initialNextBoundaryMs: 1_000,
          initialCuts: -1,
        }),
    ).toThrow(RangeError);
  });

  test("processedKeys and stats are copied (tamper proof)", () => {
    const tracker = new RenderCheckpointTracker({
      intervalMs: 1_000,
      initialNextBoundaryMs: 1_000,
    });
    // Union-typed fixture: the tracker's skip set carries BOTH render-terminal
    // dispositions ("rendered" and "render-failed").
    const processedKeys: Array<{ key: string; disposition: "rendered" | "render-failed" }> = [
      { key: "k1", disposition: "rendered" },
    ];
    const stats = emptyStats();
    const checkpoint = tracker.cut({
      batch: batchOf(1, "watermark-boundary", { startMs: 0, endMs: 1_000 }, [update(1, 1_000)]),
      processedKeys,
      stats,
      atMs: 0,
    });
    processedKeys.push({ key: "k2", disposition: "render-failed" });
    stats.batchesIn = 99;
    expect(checkpoint.processedKeys).toHaveLength(1);
    expect(checkpoint.stats.batchesIn).toBe(0);
  });
});

describe("validateRenderCheckpoint (fail loud on corrupt recovery state)", () => {
  function validCheckpoint(): RenderCheckpoint {
    return {
      index: 3,
      watermark: { watermarkMs: 5_000, sequence: 10 },
      consumedThroughSequence: 10,
      nextBatchOrdinal: 6,
      nextBoundaryMs: 6_000,
      nextWindowStartMs: 5_000,
      processedKeys: [{ key: "k1", disposition: "rendered" }],
      stats: emptyStats(),
      atMs: 12_345,
    };
  }

  test("the valid shape passes", () => {
    expect(() => validateRenderCheckpoint(validCheckpoint())).not.toThrow();
  });

  test("each structural breach names the exact field (fail-loud, never silent replay)", () => {
    const cases: Array<[Partial<RenderCheckpoint>, string]> = [
      [{ index: 0 }, "index"],
      [{ consumedThroughSequence: -1 }, "consumedThroughSequence"],
      [{ nextBatchOrdinal: 0 }, "nextBatchOrdinal"],
      [{ nextBoundaryMs: 0 }, "nextBoundaryMs"],
      [{ nextBoundaryMs: Number.NaN }, "nextBoundaryMs"],
      [{ nextWindowStartMs: -1 }, "nextWindowStartMs"],
      [{ atMs: Number.POSITIVE_INFINITY }, "atMs"],
    ];
    for (const [override, field] of cases) {
      const checkpoint = { ...validCheckpoint(), ...override };
      try {
        validateRenderCheckpoint(checkpoint);
        expect.unreachable(`expected ${field} breach to throw`);
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidRenderCheckpointError);
        const details = (err as InvalidRenderCheckpointError).details as Record<string, unknown>;
        expect(details.field).toBe(field);
      }
    }
  });

  test("watermark breaches are named", () => {
    for (const watermark of [
      { watermarkMs: -1, sequence: 1 },
      { watermarkMs: Number.NaN, sequence: 1 },
      { watermarkMs: 5_000, sequence: -1 },
      { watermarkMs: 5_000, sequence: 1.5 },
    ]) {
      const checkpoint = { ...validCheckpoint(), watermark };
      expect(() => validateRenderCheckpoint(checkpoint)).toThrow(InvalidRenderCheckpointError);
    }
  });

  test("duplicate processed keys refuse (a skip set can never double-count)", () => {
    const checkpoint = {
      ...validCheckpoint(),
      processedKeys: [
        { key: "k1", disposition: "rendered" as const },
        { key: "k1", disposition: "render-failed" as const },
      ],
    };
    expect(() => validateRenderCheckpoint(checkpoint)).toThrow(InvalidRenderCheckpointError);
  });

  test("unknown dispositions refuse", () => {
    const checkpoint = {
      ...validCheckpoint(),
      processedKeys: [{ key: "k1", disposition: "evicted" as "rendered" }],
    };
    expect(() => validateRenderCheckpoint(checkpoint)).toThrow(InvalidRenderCheckpointError);
  });
});
