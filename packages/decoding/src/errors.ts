/**
 * Typed decoding errors (W102), in the same style as the W101 ingestion
 * errors: every rejection at the decode boundary throws one of these,
 * carrying a `terminalFailureClass` value from the `@sporta/contracts`
 * `TerminalFailureClass` enum so a session can record the failure via
 * `ProcessingStateService.classifyFailure`. Each error also exposes
 * `failureClass` as a short alias and a structured, JSON-safe `details`
 * object for logs and metrics labels.
 */

/** Structured, JSON-safe details carried on every decoding error. */
export type DecodeErrorDetails = Record<string, unknown>;

/**
 * The authorization policy denied decoding (fail-closed rights gate,
 * architecture-lock §11 — re-checked here as defense in depth even though
 * ingestion gated earlier). Details typically carry `reason`
 * (`"missing-policy" | "expired-policy" | "missing-operation"`),
 * `requiredOperation`, and `policyId`.
 */
export class RightsDeniedError extends Error {
  readonly terminalFailureClass: "rights-denied";
  /** Alias of {@link RightsDeniedError.terminalFailureClass}. */
  readonly failureClass: "rights-denied";
  readonly details: DecodeErrorDetails;

  constructor(message: string, details: DecodeErrorDetails = {}) {
    super(message);
    this.name = "RightsDeniedError";
    this.terminalFailureClass = "rights-denied";
    this.failureClass = "rights-denied";
    this.details = details;
  }
}

/**
 * The media is invalid or unsupported at the decode boundary: unparseable
 * demuxer output, decoder subprocess failures, or CORRUPT NORMALIZED OUTPUT
 * (a lying decoder result whose byte/sample math does not hold —
 * architecture-lock §13 treats decoder output as attacker-controlled).
 *
 * `details.stderrTail` carries the LAST 2,000 characters of a failed
 * subprocess's stderr — bounded, never the full stderr (which is
 * untrusted-derived and potentially huge).
 */
export class UnsupportedMediaError extends Error {
  readonly terminalFailureClass: "media-invalid";
  /** Alias of {@link UnsupportedMediaError.terminalFailureClass}. */
  readonly failureClass: "media-invalid";
  readonly details: DecodeErrorDetails;

  constructor(message: string, details: DecodeErrorDetails = {}) {
    super(message);
    this.name = "UnsupportedMediaError";
    this.terminalFailureClass = "media-invalid";
    this.failureClass = "media-invalid";
    this.details = details;
  }
}

/**
 * A decode resource bound was exceeded (frame bytes, chunk samples, track
 * count, or the cumulative window byte budget). Decoder output volume is
 * attacker-controlled (architecture-lock §13), so exceeding a bound is a
 * classified refusal, not an internal fault.
 */
export class ResourceLimitError extends Error {
  readonly terminalFailureClass: "resource-limit";
  /** Alias of {@link ResourceLimitError.terminalFailureClass}. */
  readonly failureClass: "resource-limit";
  readonly details: DecodeErrorDetails;

  constructor(message: string, details: DecodeErrorDetails = {}) {
    super(message);
    this.name = "ResourceLimitError";
    this.terminalFailureClass = "resource-limit";
    this.failureClass = "resource-limit";
    this.details = details;
  }
}

/** Union of the typed decoding errors. */
export type DecodeError = RightsDeniedError | UnsupportedMediaError | ResourceLimitError;

/**
 * Type guard: `true` when `value` is one of the typed decoding errors (i.e. a
 * deliberate, classified decode refusal rather than an internal fault).
 */
export function isDecodeError(value: unknown): value is DecodeError {
  return (
    value instanceof RightsDeniedError ||
    value instanceof UnsupportedMediaError ||
    value instanceof ResourceLimitError
  );
}

/** Maximum characters kept in `details.stderrTail` (the TAIL of stderr). */
export const STDERR_TAIL_LIMIT = 2000;

/**
 * Bounded stderr excerpt for error details: the LAST
 * {@link STDERR_TAIL_LIMIT} characters only — the full stderr of a failed
 * decode subprocess is untrusted-derived and potentially unbounded, so it is
 * NEVER attached in full.
 */
export function stderrTail(stderr: string): string {
  return stderr.length <= STDERR_TAIL_LIMIT ? stderr : stderr.slice(-STDERR_TAIL_LIMIT);
}
