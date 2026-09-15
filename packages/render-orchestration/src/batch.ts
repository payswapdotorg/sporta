/**
 * Batch cutting (W304): the pure arithmetic that turns incremental store
 * slices into watermark-aligned {@link RenderBatch} units, plus the
 * idempotency-key derivation (the streaming contract's Recovery rule).
 *
 * PURE module — no clocks, no I/O, no state beyond its inputs. The
 * orchestrator owns the waiting (the injected clock) and the accounting; the
 * functions here are the deterministic decisions those pumps execute:
 *
 * - {@link idempotencyKeyOf}: the key derived from the batch watermark —
 *   the same watermark NEVER double-submits at the W303 dispatcher (a
 *   re-submission resolves a counted duplicate);
 * - {@link cutBatch}: assembles one batch from a bounded update slice
 *   (never re-stamps any watermark: the batch's watermark IS its last
 *   update's watermark, verbatim);
 * - {@link nextBoundary}: the watermark-grid arithmetic (the batch interval
 *   from the origin, monotone by construction).
 */
import type { Watermark } from "@sporta/contracts";
import type { BatchClosedBy, RenderBatch, SwmUpdate } from "./types";

/**
 * The idempotency key derived from a batch watermark: one key per
 * (session, watermark) — a re-submission of the same watermark resolves a
 * COUNTED duplicate at the W303 dispatcher and is never double-claimed
 * (exactly-once claim, at-least-once execution — the protocol's own
 * semantics, inherited verbatim).
 */
export function idempotencyKeyOf(sessionId: string, watermark: Watermark): string {
  return `render-${sessionId}-wm-${watermark.watermarkMs}-seq-${watermark.sequence}`;
}

/**
 * The job id derived from a batch ordinal. Ordinals are deterministic
 * functions of the cut position, so a resume replay re-cuts the same batches
 * with the same ordinals — a re-submission of a known key carries the same
 * jobId and resolves a duplicate (the W303 idempotent-retry rule), while a
 * genuinely new key colliding on an admitted jobId refuses loudly.
 */
export function jobIdOf(sessionId: string, ordinal: number): string {
  return `render-job-${sessionId}-${ordinal}`;
}

/** The batch-grid boundary `k` steps after the origin. */
export function boundaryAt(startMs: number, intervalMs: number, k: number): number {
  return startMs + k * intervalMs;
}

/** The next grid boundary strictly after `fromMs` (monotone by construction). */
export function nextBoundary(startMs: number, intervalMs: number, fromMs: number): number {
  if (fromMs < startMs) return boundaryAt(startMs, intervalMs, 1);
  const k = Math.floor((fromMs - startMs) / intervalMs) + 1;
  return boundaryAt(startMs, intervalMs, k);
}

/**
 * Assembles one batch from a bounded, sequence-ordered update slice.
 *
 * Honesty rules (the module doc): the batch's watermark is its LAST update's
 * watermark, VERBATIM — never re-stamped, never advanced to the nominal
 * boundary; `windowMs` records the nominal window (exclusive start,
 * inclusive end); `closedBy` says whether the slice ended at the boundary,
 * was cut short by the size limit, or flushed at stream completion.
 */
export function cutBatch(input: {
  sessionId: string;
  ordinal: number;
  windowMs: { startMs: number; endMs: number };
  updates: readonly SwmUpdate[];
  closedBy: BatchClosedBy;
}): RenderBatch {
  const { sessionId, ordinal, windowMs, updates, closedBy } = input;
  if (updates.length === 0) {
    throw new RangeError("cutBatch requires a non-empty update slice");
  }
  const first = updates[0]!;
  const last = updates[updates.length - 1]!;
  const byteSize = updates.reduce((sum, update) => sum + update.byteSize, 0);
  return {
    batchId: `render-batch-${sessionId}-${ordinal}`,
    sessionId,
    ordinal,
    fromSequence: first.sequence,
    toSequence: last.sequence,
    windowMs: { startMs: windowMs.startMs, endMs: windowMs.endMs },
    watermark: { watermarkMs: last.watermark.watermarkMs, sequence: last.watermark.sequence },
    updates: [...updates],
    closedBy,
    byteSize,
    idempotencyKey: idempotencyKeyOf(sessionId, last.watermark),
  };
}

/**
 * The consumer's grid state immediately AFTER one batch's cut — the
 * deterministic-replay anchors a checkpoint carries (the pure inverse of
 * `consumeSlice`'s grid bookkeeping):
 *
 * - `size-limit` (the window continues in the next batch): the boundary
 *   STAYS at the window's nominal end and the next window starts at the
 *   batch's own watermark (the last update consumed);
 * - `watermark-boundary` (the window closed): the next window starts at the
 *   nominal end and the boundary advances one interval past it;
 * - `stream-complete`: the terminal case — nothing further is ever cut, so
 *   the boundary formula is only monotone bookkeeping (a resume from a
 *   stream-complete checkpoint consumes nothing and completes immediately).
 */
export function postCutGrid(
  batch: RenderBatch,
  intervalMs: number,
): { nextBoundaryMs: number; nextWindowStartMs: number } {
  if (batch.closedBy === "size-limit") {
    return {
      nextBoundaryMs: batch.windowMs.endMs,
      nextWindowStartMs: batch.watermark.watermarkMs,
    };
  }
  return {
    nextBoundaryMs: batch.windowMs.endMs + intervalMs,
    nextWindowStartMs: batch.windowMs.endMs,
  };
}
