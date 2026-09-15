/**
 * Watermark-boundary checkpoints (W304) — the W302 posture, verbatim
 * mechanics adapted to the render vocabulary: a checkpoint is cut each time
 * a batch's TERMINAL disposition crosses the next watermark boundary, and
 * every resume anchor is derived from the CROSSING BATCH (its sequence, its
 * ordinal, the consumer grid immediately after its cut) so a replay from
 * the checkpoint re-cuts the SAME batches — the same ordinals, the same
 * watermarks, the same idempotency keys — and the W303 dispatcher's
 * key registry dedupes anything already executed (counted duplicates,
 * never double-executed).
 *
 * `processedKeys` is the CUMULATIVE RENDER-PROTOCOL terminal-disposition set
 * at cut time — the resume skip set. Only `rendered` and `render-failed`
 * keys register (batches that reached the W303 protocol and resolved);
 * skipped/evicted/refused/abandoned/cancelled batches stay UNREGISTERED so
 * recovery reprocesses them at-least-once (the W302
 * terminal-disposition-registry posture, and the streaming contract's
 * Recovery rule: downstream dedupes on the key).
 *
 * Honest limitation (inherited from W302, documented here): the key list is
 * O(distinct render-terminal keys) per checkpoint; a real deployment
 * compacts or externalizes it behind a storage seam — the in-memory list is
 * the deterministic prototype's evidence artifact.
 */
import { InvalidRenderCheckpointError } from "./errors";
import { postCutGrid } from "./batch";
import type { RenderBatch, RenderCheckpoint, RenderOrchestrationStats } from "./types";

/** The interval a tracker advances per closed window (injected per instance). */
interface TrackerOptions {
  /** The batch-grid interval in ms (finite > 0). */
  intervalMs: number;
  /** The grid boundary to start from (finite). */
  initialNextBoundaryMs: number;
  /** Checkpoint cuts already made before this tracker (integer >= 0). */
  initialCuts?: number;
}

/**
 * The checkpoint boundary tracker: decides whether a terminal disposition
 * crosses the next boundary, and mints the checkpoint when it does. One
 * instance per orchestrator session (its grid continues across resumes
 * through the checkpoint's own `nextBoundaryMs` and index). Deterministic by
 * construction — pure watermark arithmetic; `atMs` is read by the caller
 * from the injected clock.
 *
 * THE GRID IS THE CONSUMER GRID (deliberate unification, test-pinned): the
 * next boundary after a cut is the CONSUMER's next boundary after the
 * crossing batch's cut (`postCutGrid`), not a separate tracker-side grid.
 * One grid means the checkpoint's resume anchors reproduce the original cut
 * arithmetic EXACTLY — the deterministic-replay property the recovery story
 * depends on (same batches, same ordinals, same idempotency keys, same
 * subsequent checkpoints). Boundary progression stays monotone: the next
 * boundary is always at or beyond the crossing batch's watermark, and
 * watermark (like the grid) is monotone in batch ordinal, so a later
 * terminal with a smaller watermark can never un-cut or re-cut a boundary.
 */
export class RenderCheckpointTracker {
  private readonly intervalMs: number;
  private nextBoundaryMs: number;
  private cutCount: number;

  constructor(options: TrackerOptions) {
    const { intervalMs, initialNextBoundaryMs, initialCuts = 0 } = options;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError(
        `RenderCheckpointTracker intervalMs must be a finite number > 0 (got ${String(intervalMs)})`,
      );
    }
    if (!Number.isFinite(initialNextBoundaryMs)) {
      throw new RangeError(
        `RenderCheckpointTracker initialNextBoundaryMs must be finite (got ${String(initialNextBoundaryMs)})`,
      );
    }
    if (!Number.isInteger(initialCuts) || initialCuts < 0) {
      throw new RangeError(
        `RenderCheckpointTracker initialCuts must be an integer >= 0 (got ${String(initialCuts)})`,
      );
    }
    this.intervalMs = intervalMs;
    this.nextBoundaryMs = initialNextBoundaryMs;
    this.cutCount = initialCuts;
  }

  /** Number of checkpoints cut so far (across the session). */
  get cuts(): number {
    return this.cutCount;
  }

  /** The next boundary on the grid (test observability). */
  get boundary(): number {
    return this.nextBoundaryMs;
  }

  /**
   * `true` when a terminal disposition at `watermarkMs` crosses the next
   * boundary (a checkpoint should be cut for it).
   */
  crossesBoundary(watermarkMs: number): boolean {
    return watermarkMs >= this.nextBoundaryMs;
  }

  /**
   * Cuts one checkpoint ANCHORED AT THE CROSSING BATCH (see
   * `RenderCheckpoint`'s anchoring doc): the resume anchors are the batch's
   * own `toSequence`, `ordinal + 1`, and the consumer grid state after its
   * cut — never the live consumer cursor, which may already be far ahead and
   * would strand the batches cut-but-unresolved at cut time.
   */
  cut(input: {
    batch: RenderBatch;
    processedKeys: ReadonlyArray<{ key: string; disposition: "rendered" | "render-failed" }>;
    stats: RenderOrchestrationStats;
    atMs: number;
  }): RenderCheckpoint {
    const grid = postCutGrid(input.batch, this.intervalMs);
    const checkpoint: RenderCheckpoint = {
      index: this.cutCount + 1,
      watermark: {
        watermarkMs: input.batch.watermark.watermarkMs,
        sequence: input.batch.watermark.sequence,
      },
      consumedThroughSequence: input.batch.toSequence,
      nextBatchOrdinal: input.batch.ordinal + 1,
      nextBoundaryMs: grid.nextBoundaryMs,
      nextWindowStartMs: grid.nextWindowStartMs,
      processedKeys: input.processedKeys.map((entry) => ({ ...entry })),
      stats: { ...input.stats },
      atMs: input.atMs,
    };
    this.cutCount += 1;
    this.nextBoundaryMs = grid.nextBoundaryMs;
    return checkpoint;
  }
}

/**
 * Structural validation of a checkpoint handed to `resume()` (fail loud on
 * corrupt recovery state — never silently replay from a bad checkpoint).
 *
 * @throws `InvalidRenderCheckpointError` naming the exact field.
 */
export function validateRenderCheckpoint(checkpoint: RenderCheckpoint): void {
  if (checkpoint === null || typeof checkpoint !== "object") {
    throw new InvalidRenderCheckpointError("checkpoint must be an object", {
      reason: "checkpoint-not-object",
    });
  }
  if (!Number.isInteger(checkpoint.index) || checkpoint.index < 1) {
    throw new InvalidRenderCheckpointError(
      `checkpoint.index must be an integer >= 1 (got ${String(checkpoint.index)})`,
      { reason: "index-invalid", field: "index" },
    );
  }
  const watermark = checkpoint.watermark;
  if (watermark === null || typeof watermark !== "object") {
    throw new InvalidRenderCheckpointError("checkpoint.watermark must be a Watermark object", {
      reason: "watermark-missing",
      field: "watermark",
    });
  }
  if (!Number.isFinite(watermark.watermarkMs) || watermark.watermarkMs < 0) {
    throw new InvalidRenderCheckpointError(
      `checkpoint.watermark.watermarkMs must be a finite number >= 0 (got ${String(watermark.watermarkMs)})`,
      { reason: "watermark-ms-invalid", field: "watermark.watermarkMs" },
    );
  }
  if (!Number.isInteger(watermark.sequence) || watermark.sequence < 0) {
    throw new InvalidRenderCheckpointError(
      `checkpoint.watermark.sequence must be an integer >= 0 (got ${String(watermark.sequence)})`,
      { reason: "watermark-sequence-invalid", field: "watermark.sequence" },
    );
  }
  if (
    !Number.isInteger(checkpoint.consumedThroughSequence) ||
    checkpoint.consumedThroughSequence < 0
  ) {
    throw new InvalidRenderCheckpointError(
      `checkpoint.consumedThroughSequence must be an integer >= 0 (got ${String(checkpoint.consumedThroughSequence)})`,
      { reason: "consumed-through-invalid", field: "consumedThroughSequence" },
    );
  }
  if (!Number.isInteger(checkpoint.nextBatchOrdinal) || checkpoint.nextBatchOrdinal < 1) {
    throw new InvalidRenderCheckpointError(
      `checkpoint.nextBatchOrdinal must be an integer >= 1 (got ${String(checkpoint.nextBatchOrdinal)})`,
      { reason: "next-batch-ordinal-invalid", field: "nextBatchOrdinal" },
    );
  }
  if (!Number.isFinite(checkpoint.nextBoundaryMs) || checkpoint.nextBoundaryMs <= 0) {
    throw new InvalidRenderCheckpointError(
      `checkpoint.nextBoundaryMs must be a finite number > 0 (got ${String(checkpoint.nextBoundaryMs)})`,
      { reason: "next-boundary-invalid", field: "nextBoundaryMs" },
    );
  }
  if (!Number.isFinite(checkpoint.nextWindowStartMs) || checkpoint.nextWindowStartMs < 0) {
    throw new InvalidRenderCheckpointError(
      `checkpoint.nextWindowStartMs must be a finite number >= 0 (got ${String(checkpoint.nextWindowStartMs)})`,
      { reason: "next-window-start-invalid", field: "nextWindowStartMs" },
    );
  }
  if (!Array.isArray(checkpoint.processedKeys)) {
    throw new InvalidRenderCheckpointError("checkpoint.processedKeys must be an array", {
      reason: "processed-keys-not-array",
      field: "processedKeys",
    });
  }
  const seen = new Set<string>();
  for (const entry of checkpoint.processedKeys) {
    if (entry === null || typeof entry !== "object") {
      throw new InvalidRenderCheckpointError("processedKeys entries must be objects", {
        reason: "processed-key-not-object",
        field: "processedKeys",
      });
    }
    if (typeof entry.key !== "string" || entry.key.length < 1) {
      throw new InvalidRenderCheckpointError("processedKeys entries need a non-empty key", {
        reason: "processed-key-missing",
        field: "processedKeys.key",
      });
    }
    if (entry.disposition !== "rendered" && entry.disposition !== "render-failed") {
      throw new InvalidRenderCheckpointError(
        `processedKeys disposition must be "rendered" | "render-failed" (got ${String(entry.disposition)})`,
        { reason: "processed-key-disposition-invalid", field: "processedKeys.disposition" },
      );
    }
    if (seen.has(entry.key)) {
      throw new InvalidRenderCheckpointError(
        `processedKeys contains the duplicate key '${entry.key}'`,
        {
          reason: "processed-key-duplicate",
          field: "processedKeys",
        },
      );
    }
    seen.add(entry.key);
  }
  if (checkpoint.stats === null || typeof checkpoint.stats !== "object") {
    throw new InvalidRenderCheckpointError("checkpoint.stats must be a stats object", {
      reason: "stats-missing",
      field: "stats",
    });
  }
  if (!Number.isFinite(checkpoint.atMs)) {
    throw new InvalidRenderCheckpointError(
      `checkpoint.atMs must be a finite number (got ${String(checkpoint.atMs)})`,
      { reason: "at-ms-invalid", field: "atMs" },
    );
  }
}
