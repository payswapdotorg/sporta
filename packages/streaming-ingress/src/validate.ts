/**
 * Live-segment payload validation (W301).
 *
 * Live input is UNTRUSTED (architecture-lock §13), so every delivery is
 * checked against the W102 normalized-representation invariants before it is
 * receipted or emitted downstream:
 *
 * - video frames: `pixelFormat === "rgb24"`, positive integer geometry,
 *   `bytes.byteLength === width * height * 3` (the rgb24 packing invariant
 *   enforced by `DecodingService` on the batch path), a finite non-negative
 *   upstream `presentationMs` (the `Watermark` contract requires >= 0), and
 *   integer `streamIndex`/`decodeOrder`;
 * - audio chunks: positive integer `sampleRate`/`channels`, a
 *   `Float32Array` whose length is a positive whole number of interleaved
 *   sample frames, and a finite non-negative upstream `startMs`.
 *
 * NOTE the deliberate difference from W102's `DecodingService`: the batch
 * service validates audio against a REQUESTED target (it re-samples); the
 * live boundary has no requested target — the upstream declares its own — so
 * the invariant is structural consistency, not target equality.
 *
 * NOTHING is rewritten here: validation only READS the payload. A violation
 * throws {@link MalformedSegmentError} with a machine `reason` and structured
 * details; the caller (the ingest service) counts it, logs it, records it,
 * and continues the stream — never a silent skip.
 */
import { MalformedSegmentError } from "./errors";
import type { LiveSegment } from "./types";

/** Throws `RangeError`-style failures for malformed segment structure. */
function fail(
  segment: LiveSegment,
  reason: string,
  message: string,
  details: Record<string, unknown>,
): never {
  throw new MalformedSegmentError(message, { reason, segmentId: segment.segmentId, ...details });
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Validates one live delivery and returns its VERBATIM upstream timestamp
 * (`presentationMs` for video, `startMs` for audio). Throws
 * {@link MalformedSegmentError} on any invariant violation.
 */
export function validateLiveSegment(segment: LiveSegment): number {
  if (segment === null || typeof segment !== "object") {
    throw new MalformedSegmentError("live segment must be an object", {
      reason: "segment-not-object",
      segmentId: null,
    });
  }
  if (!isNonEmptyString(segment.segmentId)) {
    throw new MalformedSegmentError("live segment needs a non-empty string segmentId", {
      reason: "missing-segment-id",
      segmentId: null,
    });
  }
  if (segment.kind === "video") {
    return validateVideo(segment);
  }
  if (segment.kind === "audio") {
    return validateAudio(segment);
  }
  return fail(segment, "unknown-kind", `live segment kind must be "video" or "audio"`, {
    kind: String((segment as { kind?: unknown }).kind),
  });
}

/** Video invariants; returns the verbatim `presentationMs`. */
function validateVideo(segment: Extract<LiveSegment, { kind: "video" }>): number {
  const { frame } = segment;
  if (frame === null || typeof frame !== "object") {
    fail(segment, "missing-frame", "video segment carries no frame object", {});
  }
  if (!isNonEmptyString(frame.frameId)) {
    fail(segment, "bad-frame-id", "video frame needs a non-empty string frameId", {
      frameId: String(frame.frameId),
    });
  }
  if (!isNonNegativeInteger(frame.streamIndex)) {
    fail(segment, "bad-stream-index", "video frame streamIndex must be an integer >= 0", {
      streamIndex: frame.streamIndex,
    });
  }
  if (!isNonNegativeFinite(frame.presentationMs)) {
    fail(segment, "bad-presentation-ms", "video frame presentationMs must be finite and >= 0", {
      presentationMs: frame.presentationMs,
    });
  }
  if (!isNonNegativeInteger(frame.decodeOrder)) {
    fail(segment, "bad-decode-order", "video frame decodeOrder must be an integer >= 0", {
      decodeOrder: frame.decodeOrder,
    });
  }
  if (frame.pixelFormat !== "rgb24") {
    fail(segment, "bad-pixel-format", `video frame pixelFormat must be "rgb24"`, {
      pixelFormat: String(frame.pixelFormat),
    });
  }
  if (!isPositiveInteger(frame.width) || !isPositiveInteger(frame.height)) {
    fail(segment, "bad-geometry", "video frame width/height must be positive integers", {
      width: frame.width,
      height: frame.height,
    });
  }
  if (!(frame.bytes instanceof Uint8Array)) {
    fail(segment, "missing-bytes", "video frame bytes must be a Uint8Array", {
      bytesType: typeof frame.bytes,
    });
  }
  const expected = frame.width * frame.height * 3;
  if (frame.bytes.byteLength !== expected) {
    fail(
      segment,
      "rgb24-byte-mismatch",
      `video frame byte count does not match rgb24 geometry: ${frame.bytes.byteLength} bytes ` +
        `for ${frame.width}x${frame.height} (expected ${expected})`,
      { byteLength: frame.bytes.byteLength, width: frame.width, height: frame.height, expected },
    );
  }
  return frame.presentationMs;
}

/** Audio invariants; returns the verbatim `startMs`. */
function validateAudio(segment: Extract<LiveSegment, { kind: "audio" }>): number {
  const { chunk } = segment;
  if (chunk === null || typeof chunk !== "object") {
    fail(segment, "missing-chunk", "audio segment carries no chunk object", {});
  }
  if (!isNonEmptyString(chunk.chunkId)) {
    fail(segment, "bad-chunk-id", "audio chunk needs a non-empty string chunkId", {
      chunkId: String(chunk.chunkId),
    });
  }
  if (!isNonNegativeInteger(chunk.streamIndex)) {
    fail(segment, "bad-stream-index", "audio chunk streamIndex must be an integer >= 0", {
      streamIndex: chunk.streamIndex,
    });
  }
  if (!isNonNegativeFinite(chunk.startMs)) {
    fail(segment, "bad-start-ms", "audio chunk startMs must be finite and >= 0", {
      startMs: chunk.startMs,
    });
  }
  if (!isPositiveInteger(chunk.sampleRate)) {
    fail(segment, "bad-sample-rate", "audio chunk sampleRate must be a positive integer", {
      sampleRate: chunk.sampleRate,
    });
  }
  if (!isPositiveInteger(chunk.channels)) {
    fail(segment, "bad-channels", "audio chunk channels must be a positive integer", {
      channels: chunk.channels,
    });
  }
  if (!(chunk.samples instanceof Float32Array)) {
    fail(segment, "missing-samples", "audio chunk samples must be a Float32Array", {
      samplesType: typeof chunk.samples,
    });
  }
  if (chunk.samples.length <= 0 || chunk.samples.length % chunk.channels !== 0) {
    fail(
      segment,
      "bad-sample-count",
      `audio chunk sample count must be a positive whole number of interleaved sample frames: ` +
        `${chunk.samples.length} samples across ${chunk.channels} channels`,
      { sampleCount: chunk.samples.length, channels: chunk.channels },
    );
  }
  return chunk.startMs;
}
