/**
 * Typed ASR errors (W207), in the same style as the W101/W102/W103 boundary
 * errors: every rejection at the speech-to-text boundary throws one of these,
 * carrying a `terminalFailureClass` value from the `@sporta/contracts`
 * `TerminalFailureClass` enum so a session can record the failure via
 * `ProcessingStateService.classifyFailure`. The error also exposes
 * `failureClass` as a short alias and a structured, JSON-safe `details` object
 * for logs and metrics labels.
 *
 * Classification:
 *
 * - `"media-invalid"` — the normalized audio handed to the adapter is
 *   corrupt: a non-monotonic chunk stream, mixed sample rates or channel
 *   counts, truncated sample frames, zero-sample chunks, or (at the fixture
 *   boundary) bytes that are not a parseable WAV. Decoded output is untrusted
 *   (architecture-lock §13), so corrupt normalized audio is classified bad
 *   media, not an internal fault.
 * - `"internal"` — the ASR backend itself failed: the SDK could not be
 *   loaded, the network call failed, the backend returned a malformed result,
 *   or the fixture backend was asked for a window it has no result mapped
 *   for (a fixture misconfiguration).
 */
import type { TerminalFailureClass } from "@sporta/contracts";

/** Structured, JSON-safe details carried on every ASR error. */
export type AsrErrorDetails = Record<string, unknown>;

/**
 * A typed, classified ASR refusal or failure. `failureClass` is a short alias
 * of {@link AsrError.terminalFailureClass}.
 */
export class AsrError extends Error {
  readonly terminalFailureClass: TerminalFailureClass;
  /** Alias of {@link AsrError.terminalFailureClass}. */
  readonly failureClass: TerminalFailureClass;
  readonly details: AsrErrorDetails;

  constructor(failureClass: TerminalFailureClass, message: string, details: AsrErrorDetails = {}) {
    super(message);
    this.name = "AsrError";
    this.terminalFailureClass = failureClass;
    this.failureClass = failureClass;
    this.details = details;
  }
}

/** Union of the typed ASR errors. */
export type AsrFailure = AsrError;

/**
 * Type guard: `true` when `value` is the typed ASR error (i.e. a deliberate,
 * classified ASR refusal or backend failure rather than an unrelated fault).
 */
export function isAsrError(value: unknown): value is AsrError {
  return value instanceof AsrError;
}

/** Maximum characters kept from a backend failure cause (the head, never the stack). */
export const ASR_CAUSE_LIMIT = 300;

/**
 * Bounded failure-cause excerpt for error details: the FIRST
 * {@link ASR_CAUSE_LIMIT} characters of the cause's message only. Provider
 * and network errors are untrusted-derived and potentially huge (stack
 * traces, response bodies), so the full cause is NEVER attached — same
 * bounding discipline as the W102 `stderrTail`.
 */
export function boundedCause(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length <= ASR_CAUSE_LIMIT ? raw : raw.slice(0, ASR_CAUSE_LIMIT);
}
