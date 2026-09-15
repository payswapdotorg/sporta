/**
 * Pure batch arithmetic (W304): idempotency keys, job ids, the watermark
 * grid, cut honesty, and the post-cut grid (the checkpoint's resume
 * anchors). All inputs authored; no orchestrator, no clocks.
 */
import { describe, expect, test } from "bun:test";
import {
  boundaryAt,
  cutBatch,
  idempotencyKeyOf,
  jobIdOf,
  nextBoundary,
  postCutGrid,
} from "../src/batch";
import type { RenderBatch, SwmUpdate } from "../src/types";

/** One authored update (the minimal honest shape for arithmetic tests). */
function update(sequence: number, watermarkMs: number, byteSize = 100): SwmUpdate {
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
    byteSize,
  };
}

describe("idempotencyKeyOf / jobIdOf", () => {
  test("the key is derived from the session + watermark (ms and sequence)", () => {
    expect(idempotencyKeyOf("sess-a", { watermarkMs: 1_500, sequence: 3 })).toBe(
      "render-sess-a-wm-1500-seq-3",
    );
  });

  test("the same watermark NEVER double-submits: one key per (session, watermark)", () => {
    const first = idempotencyKeyOf("sess-a", { watermarkMs: 1_500, sequence: 3 });
    const again = idempotencyKeyOf("sess-a", { watermarkMs: 1_500, sequence: 3 });
    expect(again).toBe(first);
    expect(idempotencyKeyOf("sess-a", { watermarkMs: 1_501, sequence: 3 })).not.toBe(first);
    expect(idempotencyKeyOf("sess-b", { watermarkMs: 1_500, sequence: 3 })).not.toBe(first);
    expect(idempotencyKeyOf("sess-a", { watermarkMs: 1_500, sequence: 4 })).not.toBe(first);
  });

  test("job ids derive from the session + batch ordinal", () => {
    expect(jobIdOf("sess-a", 7)).toBe("render-job-sess-a-7");
    expect(jobIdOf("sess-a", 8)).not.toBe(jobIdOf("sess-a", 7));
  });
});

describe("boundaryAt / nextBoundary", () => {
  test("boundaryAt is start + k*interval (k >= 1 for real boundaries)", () => {
    expect(boundaryAt(0, 1_000, 1)).toBe(1_000);
    expect(boundaryAt(0, 1_000, 3)).toBe(3_000);
    expect(boundaryAt(500, 250, 2)).toBe(1_000);
  });

  test("nextBoundary is the first grid boundary strictly after fromMs", () => {
    expect(nextBoundary(0, 1_000, 0)).toBe(1_000);
    expect(nextBoundary(0, 1_000, 999)).toBe(1_000);
    expect(nextBoundary(0, 1_000, 1_000)).toBe(2_000);
    expect(nextBoundary(0, 1_000, 1_001)).toBe(2_000);
    expect(nextBoundary(500, 250, 600)).toBe(750);
  });

  test("a fromMs before the origin clamps to the first boundary", () => {
    expect(nextBoundary(500, 250, 0)).toBe(750);
  });
});

describe("cutBatch", () => {
  test("assembles one batch with the LAST update's watermark VERBATIM", () => {
    const batch = cutBatch({
      sessionId: "sess",
      ordinal: 3,
      windowMs: { startMs: 1_000, endMs: 2_000 },
      updates: [update(4, 1_250), update(5, 1_750)],
      closedBy: "watermark-boundary",
    });
    expect(batch.batchId).toBe("render-batch-sess-3");
    expect(batch.sessionId).toBe("sess");
    expect(batch.ordinal).toBe(3);
    expect(batch.fromSequence).toBe(4);
    expect(batch.toSequence).toBe(5);
    expect(batch.windowMs).toEqual({ startMs: 1_000, endMs: 2_000 });
    expect(batch.watermark).toEqual({ watermarkMs: 1_750, sequence: 5 });
    expect(batch.closedBy).toBe("watermark-boundary");
    expect(batch.updates).toHaveLength(2);
    expect(batch.idempotencyKey).toBe(
      idempotencyKeyOf("sess", { watermarkMs: 1_750, sequence: 5 }),
    );
  });

  test("byteSize is the exact sum of update byteSize", () => {
    const batch = cutBatch({
      sessionId: "sess",
      ordinal: 1,
      windowMs: { startMs: 0, endMs: 1_000 },
      updates: [update(0, 250, 120), update(1, 500, 80), update(2, 750, 30)],
      closedBy: "size-limit",
    });
    expect(batch.byteSize).toBe(230);
  });

  test("the batch holds its own copy of the update slice (tamper proof)", () => {
    const updates = [update(0, 250)];
    const batch = cutBatch({
      sessionId: "sess",
      ordinal: 1,
      windowMs: { startMs: 0, endMs: 1_000 },
      updates,
      closedBy: "watermark-boundary",
    });
    updates.push(update(1, 500));
    expect(batch.updates).toHaveLength(1);
  });

  test("an empty slice refuses loudly", () => {
    expect(() =>
      cutBatch({
        sessionId: "sess",
        ordinal: 1,
        windowMs: { startMs: 0, endMs: 1_000 },
        updates: [],
        closedBy: "watermark-boundary",
      }),
    ).toThrow(RangeError);
  });
});

describe("postCutGrid (the checkpoint's resume anchors)", () => {
  function batchOf(
    closedBy: RenderBatch["closedBy"],
    windowMs: { startMs: number; endMs: number },
    watermarkMs: number,
  ): RenderBatch {
    return cutBatch({
      sessionId: "sess",
      ordinal: 1,
      windowMs,
      updates: [update(0, watermarkMs)],
      closedBy,
    });
  }

  test("size-limit: the boundary STAYS at the window end; the next window starts at the watermark", () => {
    const batch = batchOf("size-limit", { startMs: 0, endMs: 1_000 }, 750);
    expect(postCutGrid(batch, 1_000)).toEqual({
      nextBoundaryMs: 1_000,
      nextWindowStartMs: 750,
    });
  });

  test("watermark-boundary: the window advances and the boundary advances one interval", () => {
    const batch = batchOf("watermark-boundary", { startMs: 0, endMs: 1_000 }, 1_000);
    expect(postCutGrid(batch, 1_000)).toEqual({
      nextBoundaryMs: 2_000,
      nextWindowStartMs: 1_000,
    });
  });

  test("stream-complete: monotone bookkeeping (nothing further is ever cut)", () => {
    const batch = batchOf("stream-complete", { startMs: 0, endMs: 900 }, 900);
    expect(postCutGrid(batch, 1_000)).toEqual({
      nextBoundaryMs: 1_900,
      nextWindowStartMs: 900,
    });
  });

  test("the next boundary is always at or beyond the crossing batch's watermark (monotone)", () => {
    for (const closedBy of ["size-limit", "watermark-boundary", "stream-complete"] as const) {
      const batch = batchOf(closedBy, { startMs: 0, endMs: 1_000 }, 1_000);
      expect(postCutGrid(batch, 1_000).nextBoundaryMs).toBeGreaterThanOrEqual(
        batch.watermark.watermarkMs,
      );
    }
  });
});
