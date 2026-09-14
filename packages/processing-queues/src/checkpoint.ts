/**
 * Watermark-boundary checkpoints (W302) — the streaming contract's recovery
 * rule: "Stateful stages checkpoint enough information to resume from a safe
 * watermark" (docs/contracts/streaming.md).
 *
 * A checkpoint is cut each time a segment's TERMINAL disposition (emitted by
 * the last stage, or dead-lettered anywhere) crosses the next watermark
 * boundary. Boundaries advance to `crossingWatermark + interval`, so
 * checkpoints stay monotone even when segment watermarks arrive
 * out-of-order (a later, smaller watermark cannot un-cut a checkpoint).
 *
 * `processedKeys` is the CUMULATIVE terminal-disposition set at cut time —
 * the resume point. Honest limitation (documented in the package docs): the
 * key list is O(distinct terminally-disposed keys) per checkpoint; a real
 * deployment compacts or externalizes it behind a storage seam — the
 * in-memory list is the deterministic prototype's evidence artifact.
 */
import { InvalidCheckpointError } from "./errors";
import type { PipelineCheckpoint } from "./types";

/**
 * The checkpoint boundary tracker: decides whether a terminal disposition
 * crosses the next boundary, and mints the checkpoint when it does. One
 * instance per pipeline; deterministic by construction (pure watermark
 * arithmetic, no clocks — `atMs` is read by the caller from the injected
 * clock).
 */
export class CheckpointTracker {
  private nextBoundaryMs: number;
  private cutCount = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly startMs: number = 0,
  ) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError(
        `CheckpointTracker intervalMs must be a finite number > 0 (got ${String(intervalMs)})`,
      );
    }
    if (!Number.isFinite(startMs)) {
      throw new RangeError(`CheckpointTracker startMs must be finite (got ${String(startMs)})`);
    }
    this.nextBoundaryMs = startMs + intervalMs;
  }

  /** Number of checkpoints cut so far. */
  get cuts(): number {
    return this.cutCount;
  }

  /**
   * `true` when a terminal disposition at `watermarkMs` crosses the next
   * boundary (a checkpoint should be cut for it).
   */
  crossesBoundary(watermarkMs: number): boolean {
    return watermarkMs >= this.nextBoundaryMs;
  }

  /**
   * Cuts one checkpoint at the crossing disposition and advances the next
   * boundary to `watermarkMs + intervalMs` (monotone progression —
   * out-of-order later watermarks cannot un-cut or re-cut a boundary).
   */
  cut(input: {
    watermarkMs: number;
    sequence: number;
    processedKeys: ReadonlyArray<{ key: string; disposition: "emitted" | "dead-lettered" }>;
    stats: import("./types").PipelineStats;
    atMs: number;
  }): PipelineCheckpoint {
    const checkpoint: PipelineCheckpoint = {
      index: this.cutCount + 1,
      watermark: { watermarkMs: input.watermarkMs, sequence: input.sequence },
      sequence: input.sequence,
      processedKeys: input.processedKeys.map((k) => ({ ...k })),
      stats: { ...input.stats, queueDepths: [...input.stats.queueDepths] },
      atMs: input.atMs,
    };
    this.cutCount += 1;
    this.nextBoundaryMs = input.watermarkMs + this.intervalMs;
    return checkpoint;
  }
}

/**
 * Structural validation of a checkpoint handed to `resumePipeline` (fail
 * loud on corrupt recovery state — never silently replay from a bad
 * checkpoint).
 *
 * @throws `InvalidCheckpointError` naming the exact field.
 */
export function validateCheckpoint(checkpoint: PipelineCheckpoint): void {
  if (checkpoint === null || typeof checkpoint !== "object") {
    throw new InvalidCheckpointError("checkpoint must be an object", {
      reason: "checkpoint-not-object",
    });
  }
  if (!Number.isInteger(checkpoint.index) || checkpoint.index < 1) {
    throw new InvalidCheckpointError(
      `checkpoint.index must be an integer >= 1 (got ${String(checkpoint.index)})`,
      { reason: "index-invalid", field: "index" },
    );
  }
  const watermark = checkpoint.watermark;
  if (watermark === null || typeof watermark !== "object") {
    throw new InvalidCheckpointError("checkpoint.watermark must be a Watermark object", {
      reason: "watermark-missing",
      field: "watermark",
    });
  }
  if (!Number.isFinite(watermark.watermarkMs) || watermark.watermarkMs < 0) {
    throw new InvalidCheckpointError(
      `checkpoint.watermark.watermarkMs must be a finite number >= 0 ` +
        `(got ${String(watermark.watermarkMs)})`,
      { reason: "watermark-ms-invalid", field: "watermark.watermarkMs" },
    );
  }
  if (!Number.isInteger(watermark.sequence) || watermark.sequence < 0) {
    throw new InvalidCheckpointError(
      `checkpoint.watermark.sequence must be an integer >= 0 ` +
        `(got ${String(watermark.sequence)})`,
      { reason: "watermark-sequence-invalid", field: "watermark.sequence" },
    );
  }
  if (!Array.isArray(checkpoint.processedKeys)) {
    throw new InvalidCheckpointError("checkpoint.processedKeys must be an array", {
      reason: "processed-keys-not-array",
      field: "processedKeys",
    });
  }
  const seen = new Set<string>();
  for (const entry of checkpoint.processedKeys) {
    if (entry === null || typeof entry !== "object") {
      throw new InvalidCheckpointError("processedKeys entries must be objects", {
        reason: "processed-key-not-object",
        field: "processedKeys",
      });
    }
    if (typeof entry.key !== "string" || entry.key.length < 1) {
      throw new InvalidCheckpointError("processedKeys entries need a non-empty key", {
        reason: "processed-key-missing",
        field: "processedKeys.key",
      });
    }
    if (entry.disposition !== "emitted" && entry.disposition !== "dead-lettered") {
      throw new InvalidCheckpointError(
        `processedKeys disposition must be "emitted" | "dead-lettered" ` +
          `(got ${String(entry.disposition)})`,
        { reason: "processed-key-disposition-invalid", field: "processedKeys.disposition" },
      );
    }
    if (seen.has(entry.key)) {
      throw new InvalidCheckpointError(`processedKeys contains duplicate key '${entry.key}'`, {
        reason: "processed-key-duplicated",
        field: "processedKeys",
        key: entry.key,
      });
    }
    seen.add(entry.key);
  }
  if (!Number.isFinite(checkpoint.atMs)) {
    throw new InvalidCheckpointError(
      `checkpoint.atMs must be a finite number (got ${String(checkpoint.atMs)})`,
      { reason: "at-ms-invalid", field: "atMs" },
    );
  }
}
