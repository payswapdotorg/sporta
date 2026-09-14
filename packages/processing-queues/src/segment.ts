/**
 * The processing segment (W302) — the unit of work a bounded pipeline
 * carries between stages.
 *
 * A segment is domain-agnostic BY DESIGN (vendor neutrality,
 * architecture-lock §9): the pipeline carries `payload: unknown` plus the
 * four fields the QUEUE contract needs —
 *
 * - `idempotencyKey` — the streaming-contract Recovery rule
 *   ("Duplicate messages are tolerated through idempotency keys",
 *   docs/contracts/streaming.md): terminally-disposed keys are registered,
 *   re-submissions are counted duplicates, checkpoints resume on them;
 * - `watermark` — the segment's OWN timeline position, carried VERBATIM
 *   end-to-end (the W301 rule: never re-stamped, never re-ordered by the
 *   pipeline — a stage that transforms timing does so explicitly in its
 *   returned segment);
 * - `byteSize` — the payload's declared size, enforced by the per-channel
 *   byte budgets (the W104 `maxBytes` precedent);
 * - `payload` — the stage-domain data (JSON-safe by convention).
 *
 * Validation is fail-loud (`MalformedSegmentError`): malformed segments are
 * refused at `submit()` — counted, logged, metered, ledgered — and the
 * pipeline continues (one corrupt segment never kills a live match, the
 * W301/W102 posture). A stage transform that RETURNS an invalid segment is
 * an internal failure (never propagated downstream).
 */
import type { Watermark } from "@sporta/contracts";
import { MalformedSegmentError } from "./errors";

/** One unit of pipeline work. */
export interface PipelineSegment {
  /** Idempotency key — dedupe and resume identity (non-empty string). */
  idempotencyKey: string;
  /** The segment's own timeline position, carried VERBATIM end-to-end. */
  watermark: Watermark;
  /** Declared payload size in bytes (non-negative integer; byte budgets read this). */
  byteSize: number;
  /** Stage-domain payload (JSON-safe by convention). */
  payload: unknown;
}

/**
 * Structural validation of one segment (the W301 `validateLiveSegment`
 * posture — hand-written structural checks, fail-loud with a short machine
 * `reason` on the error details). Throws `MalformedSegmentError` naming the
 * exact field; returns void when the segment satisfies the invariants.
 */
export function validatePipelineSegment(segment: PipelineSegment): void {
  if (segment === null || typeof segment !== "object") {
    throw new MalformedSegmentError("segment must be an object", {
      reason: "segment-not-object",
    });
  }
  if (typeof segment.idempotencyKey !== "string" || segment.idempotencyKey.length < 1) {
    throw new MalformedSegmentError(
      "segment.idempotencyKey must be a non-empty string " +
        `(got ${String(segment.idempotencyKey)})`,
      { reason: "idempotency-key-missing", field: "idempotencyKey" },
    );
  }
  const watermark = segment.watermark;
  if (watermark === null || typeof watermark !== "object") {
    throw new MalformedSegmentError("segment.watermark must be a Watermark object", {
      reason: "watermark-missing",
      field: "watermark",
    });
  }
  if (!Number.isFinite(watermark.watermarkMs) || (watermark.watermarkMs as number) < 0) {
    throw new MalformedSegmentError(
      "segment.watermark.watermarkMs must be a finite number >= 0 " +
        `(got ${String(watermark.watermarkMs)})`,
      { reason: "watermark-ms-invalid", field: "watermark.watermarkMs" },
    );
  }
  if (!Number.isInteger(watermark.sequence) || (watermark.sequence as number) < 0) {
    throw new MalformedSegmentError(
      "segment.watermark.sequence must be an integer >= 0 " + `(got ${String(watermark.sequence)})`,
      { reason: "watermark-sequence-invalid", field: "watermark.sequence" },
    );
  }
  if (!Number.isInteger(segment.byteSize) || segment.byteSize < 0) {
    throw new MalformedSegmentError(
      `segment.byteSize must be an integer >= 0 (got ${String(segment.byteSize)})`,
      { reason: "byte-size-invalid", field: "byteSize" },
    );
  }
}
