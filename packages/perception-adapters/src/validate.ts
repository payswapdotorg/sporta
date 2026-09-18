/**
 * Shared input validation for detection-annotated frame sequences (R203/R204
 * families) — the untrusted-input gate (architecture-lock §13): media-derived
 * frames and model-derived detections are validated LOUD before any adapter
 * consumes them; a malformed sequence throws {@link InvalidAdapterInputError}
 * rather than silently degrading downstream association semantics.
 *
 * Validation mirrors the W202 `nearest-box.ts` conventions: non-empty UNIQUE
 * frame ids, non-negative finite presentation times, integer decode orders,
 * contract-shaped detections (finite box fields in [0, 1], confidence in
 * [0, 1], non-empty labels). Player-tracking additionally requires STRICTLY
 * ASCENDING decode order (the documented W204 call order); ball-tracking
 * requires strictly ascending presentationMs (the W202 convention).
 */
import type { DetectedBox } from "@sporta/perception-detection";
import { InvalidAdapterInputError } from "./errors";
import type { DetectionSequenceFrame } from "./adapter";

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new InvalidAdapterInputError(`perception adapter input: ${what} must be finite`, {
      field: what,
      value,
    });
  }
}

function validateDetection(detection: DetectedBox, frameId: string, index: number): void {
  if (typeof detection.label !== "string" || detection.label.length < 1) {
    throw new InvalidAdapterInputError(
      `perception adapter input: detection ${index} of frame "${frameId}" needs a non-empty label`,
      { frameId, detectionIndex: index },
    );
  }
  assertFinite(detection.confidence, `detection confidence (frame "${frameId}", index ${index})`);
  if (detection.confidence < 0 || detection.confidence > 1) {
    throw new InvalidAdapterInputError(
      `perception adapter input: detection confidence must be in [0, 1] ` +
        `(frame "${frameId}", index ${index}: ${detection.confidence})`,
      { frameId, detectionIndex: index, confidence: detection.confidence },
    );
  }
  for (const field of [
    detection.box.x,
    detection.box.y,
    detection.box.w,
    detection.box.h,
  ] as const) {
    assertFinite(field, `detection box field (frame "${frameId}", index ${index})`);
    if (field < 0 || field > 1) {
      throw new InvalidAdapterInputError(
        `perception adapter input: detection box fields must be in [0, 1] ` +
          `(frame "${frameId}", index ${index}: ${field})`,
        { frameId, detectionIndex: index, field },
      );
    }
  }
}

/**
 * Validates a detection-annotated frame sequence in decode order (R203
 * player-tracking): unique non-empty frame ids, finite non-negative
 * presentation times, strictly ascending integer decode orders, and
 * contract-shaped detections per frame.
 */
export function validateDetectionSequence(sequence: readonly DetectionSequenceFrame[]): void {
  const seenFrameIds = new Set<string>();
  let previousDecodeOrder: number | undefined;
  for (const { frame, detections } of sequence) {
    if (typeof frame.frameId !== "string" || frame.frameId.length < 1) {
      throw new InvalidAdapterInputError(
        "perception adapter input: every frame needs a non-empty frameId",
        {},
      );
    }
    if (seenFrameIds.has(frame.frameId)) {
      throw new InvalidAdapterInputError(
        `perception adapter input: duplicate frameId "${frame.frameId}"`,
        { frameId: frame.frameId },
      );
    }
    seenFrameIds.add(frame.frameId);
    assertFinite(frame.presentationMs, `presentationMs (frame "${frame.frameId}")`);
    if (frame.presentationMs < 0) {
      throw new InvalidAdapterInputError(
        `perception adapter input: presentationMs must be >= 0 (frame ` +
          `"${frame.frameId}": ${frame.presentationMs})`,
        { frameId: frame.frameId, presentationMs: frame.presentationMs },
      );
    }
    if (!Number.isInteger(frame.decodeOrder) || frame.decodeOrder < 0) {
      throw new InvalidAdapterInputError(
        `perception adapter input: decodeOrder must be an integer >= 0 (frame ` +
          `"${frame.frameId}": ${frame.decodeOrder})`,
        { frameId: frame.frameId, decodeOrder: frame.decodeOrder },
      );
    }
    if (previousDecodeOrder !== undefined && frame.decodeOrder <= previousDecodeOrder) {
      throw new InvalidAdapterInputError(
        `perception adapter input: frames must be strictly ascending in decodeOrder ` +
          `(frame "${frame.frameId}" at ${frame.decodeOrder} follows ${previousDecodeOrder})`,
        { frameId: frame.frameId, decodeOrder: frame.decodeOrder },
      );
    }
    previousDecodeOrder = frame.decodeOrder;
    for (const [index, detection] of detections.entries()) {
      validateDetection(detection, frame.frameId, index);
    }
  }
}

/**
 * Validates a detection-annotated frame sequence in presentation order
 * (R204 ball-tracking): the decode-order checks of
 * {@link validateDetectionSequence} PLUS strictly ascending presentationMs
 * (the W202 convention — ball tracks are ordered on the media timeline).
 */
export function validatePresentationOrderedSequence(
  frames: readonly DetectionSequenceFrame[],
): void {
  validateDetectionSequence(frames);
  let previousMs: number | undefined;
  for (const { frame } of frames) {
    if (previousMs !== undefined && frame.presentationMs <= previousMs) {
      throw new InvalidAdapterInputError(
        `perception adapter input: frames must be strictly ascending in presentationMs ` +
          `(frame "${frame.frameId}" at ${frame.presentationMs} follows ${previousMs})`,
        { frameId: frame.frameId, presentationMs: frame.presentationMs },
      );
    }
    previousMs = frame.presentationMs;
  }
}
