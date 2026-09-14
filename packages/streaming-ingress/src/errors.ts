/**
 * Typed streaming-ingress errors (W301), in the W101/W102 style: every
 * classified refusal carries a `terminalFailureClass` value from the
 * `@sporta/contracts` enum (so the W004 `ProcessingStateService` /
 * `SessionLifecycle.fail` can record it), a short `failureClass` alias, and a
 * structured, JSON-safe `details` object for logs and metric labels.
 */

/** Structured, JSON-safe details carried on every streaming-ingress error. */
export type StreamingIngressErrorDetails = Record<string, unknown>;

/**
 * The authorization policy denied the live session (fail-closed rights gate,
 * architecture-lock §11). Thrown at ADMISSION by `start()` (the stream never
 * begins) and mid-stream by the per-segment re-check (defense in depth, the
 * W102 posture — a policy that becomes invalid terminates the session
 * loudly, never a silent mid-stream drop). Details typically carry `reason`,
 * `requiredOperation`, and `policyId`.
 */
export class RightsDeniedError extends Error {
  readonly terminalFailureClass: "rights-denied";
  /** Alias of {@link RightsDeniedError.terminalFailureClass}. */
  readonly failureClass: "rights-denied";
  readonly details: StreamingIngressErrorDetails;

  constructor(message: string, details: StreamingIngressErrorDetails = {}) {
    super(message);
    this.name = "RightsDeniedError";
    this.terminalFailureClass = "rights-denied";
    this.failureClass = "rights-denied";
    this.details = details;
  }
}

/**
 * A live delivery is malformed: the segment does not satisfy the W102
 * normalized-representation invariants (rgb24 byte math, audio sample-math,
 * non-negative upstream timestamps) or re-uses an idempotency key with
 * DIFFERENT content. The refusal is classified `media-invalid`, counted,
 * logged, and recorded in the rejection ledger — the stream CONTINUES with
 * the next segment (one corrupt segment never kills a live match), and the
 * structured error is never swallowed.
 */
export class MalformedSegmentError extends Error {
  readonly terminalFailureClass: "media-invalid";
  /** Alias of {@link MalformedSegmentError.terminalFailureClass}. */
  readonly failureClass: "media-invalid";
  readonly details: StreamingIngressErrorDetails;

  constructor(message: string, details: StreamingIngressErrorDetails = {}) {
    super(message);
    this.name = "MalformedSegmentError";
    this.terminalFailureClass = "media-invalid";
    this.failureClass = "media-invalid";
    this.details = details;
  }
}

/**
 * The live-session API was misused (start twice, stop before start, …). This
 * is a CALLER error, not a session terminal failure: it carries no
 * `terminalFailureClass` because the session was never in a media/rights
 * failure state.
 */
export class InvalidLiveSessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLiveSessionStateError";
  }
}

/** Union of the classified streaming-ingress errors. */
export type StreamingIngressError = RightsDeniedError | MalformedSegmentError;

/**
 * Type guard: `true` when `value` is one of the classified streaming-ingress
 * errors (a deliberate boundary refusal rather than an internal fault).
 */
export function isStreamingIngressError(value: unknown): value is StreamingIngressError {
  return value instanceof RightsDeniedError || value instanceof MalformedSegmentError;
}
