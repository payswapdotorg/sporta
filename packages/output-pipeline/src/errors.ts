/**
 * Typed output-pipeline errors (W504).
 *
 * The anime output pipeline's deliberate, classified rejections. Every error
 * carries:
 *
 * - `failureClass` — the machine-readable classification, reusing the
 *   session-level `TerminalFailureClass` values (`rights-denied`,
 *   `media-invalid`, `resource-limit`, `internal`) so hosts (e.g. the W701
 *   control plane) can map refusals onto their typed-error families without
 *   depending on this package — the control plane recognizes these errors
 *   STRUCTURALLY (an error object with a string `failureClass` from that
 *   set) and preserves the class;
 * - `details` — structured, JSON-safe evidence (ids, hashes, reasons); never
 *   secrets.
 *
 * Fail-loud is the rule: nothing in this package silently drops, silently
 * truncates, or silently degrades — every refusal is a thrown typed error.
 */
import type { TerminalFailureClass } from "@sporta/contracts";

/** Failure classification for output-pipeline rejections. */
export type OutputPipelineFailureClass = TerminalFailureClass;

/** Structured, JSON-safe details carried on every output-pipeline error. */
export type OutputPipelineErrorDetails = Record<string, unknown>;

/** The base of the output-pipeline error family. */
export class OutputPipelineError extends Error {
  readonly failureClass: OutputPipelineFailureClass;
  readonly details: OutputPipelineErrorDetails;

  constructor(
    failureClass: OutputPipelineFailureClass,
    message: string,
    details: OutputPipelineErrorDetails = {},
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "OutputPipelineError";
    this.failureClass = failureClass;
    this.details = details;
  }
}

/**
 * `encodeAnimeClip` refused to encode: the W502 render output does not
 * satisfy the encoding contract (frame/manifest mismatch, non-contiguous
 * output windows, malformed SVG frames, ...). Never a guessed encoding.
 */
export class SegmentEncodingError extends OutputPipelineError {
  constructor(message: string, details: OutputPipelineErrorDetails = {}) {
    super("media-invalid", message, details);
    this.name = "SegmentEncodingError";
  }
}

/**
 * A segment document handed to the store is malformed or incoherent (hash
 * mismatch, byte-length mismatch, manifest/segment id drift, session-scope
 * drift, ...). Fail-loud on write, never a silent partial store.
 */
export class SegmentValidationError extends OutputPipelineError {
  constructor(message: string, details: OutputPipelineErrorDetails = {}) {
    super("media-invalid", message, details);
    this.name = "SegmentValidationError";
  }
}

/**
 * A segment was stored under an existing key with DIFFERENT content. The
 * store never silently replaces stored output (the same logical render id
 * must not change content); versioning is a future concern.
 */
export class SegmentConflictError extends OutputPipelineError {
  readonly sessionId: string;
  readonly renderId: string;
  readonly segmentId: string;

  constructor(
    sessionId: string,
    renderId: string,
    segmentId: string,
    storedContentHash: string,
    receivedContentHash: string,
  ) {
    super(
      "media-invalid",
      `render output segment '${segmentId}' for render '${renderId}' on session '${sessionId}' is already stored with different content`,
      {
        sessionId,
        renderId,
        segmentId,
        storedContentHash,
        receivedContentHash,
      },
    );
    this.name = "SegmentConflictError";
    this.sessionId = sessionId;
    this.renderId = renderId;
    this.segmentId = segmentId;
  }
}

/**
 * A store size bound was exceeded. The store REJECTS the write explicitly —
 * it never evicts, never silently drops, and never silently degrades to
 * unbounded growth.
 */
export class SegmentStoreLimitError extends OutputPipelineError {
  constructor(message: string, details: OutputPipelineErrorDetails = {}) {
    super("resource-limit", message, details);
    this.name = "SegmentStoreLimitError";
  }
}

/**
 * A stored segment failed integrity verification on read (content hash or
 * byte-length drift, or an unparsable stored manifest). Corrupted data is
 * never served — the read fails loudly instead of returning partial data.
 */
export class SegmentIntegrityError extends OutputPipelineError {
  constructor(
    message: string,
    details: OutputPipelineErrorDetails = {},
    options?: { cause?: unknown },
  ) {
    super("internal", message, details, options);
    this.name = "SegmentIntegrityError";
  }
}

/**
 * Fail-closed playback rights denial (the W701 posture): retrieving a stored
 * render output requires a caller-supplied authorization policy from which
 * `canStoreDerivatives` can be derived at the evaluation time; anything else
 * denies BEFORE any data is revealed.
 */
export class PlaybackRightsDeniedError extends OutputPipelineError {
  constructor(message: string, details: OutputPipelineErrorDetails = {}) {
    super("rights-denied", message, details);
    this.name = "PlaybackRightsDeniedError";
  }
}

/** Union of the typed output-pipeline errors. */
export type OutputPipelineErrorFamily =
  | OutputPipelineError
  | SegmentEncodingError
  | SegmentValidationError
  | SegmentConflictError
  | SegmentStoreLimitError
  | SegmentIntegrityError
  | PlaybackRightsDeniedError;

/** Type guard: `true` when `value` is a typed output-pipeline error. */
export function isOutputPipelineError(value: unknown): value is OutputPipelineError {
  return value instanceof OutputPipelineError;
}
