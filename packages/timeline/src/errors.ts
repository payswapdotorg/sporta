/**
 * Typed timeline errors (W103), in the same style as the W101/W102 boundary
 * errors: every rejection at the timeline-synchronization boundary throws
 * this, carrying a `terminalFailureClass` value from the `@sporta/contracts`
 * `TerminalFailureClass` enum so a session can record the failure via
 * `ProcessingStateService.classifyFailure`. The error also exposes
 * `failureClass` as a short alias and a structured, JSON-safe `details`
 * object for logs and metrics labels.
 *
 * Classification: every timeline rejection is `media-invalid` — the track
 * timing data handed to the synchronizer is derived from decoded (untrusted,
 * architecture-lock §13) media, so corrupt timing (zero-length tracks,
 * inverted sample spans, non-finite timestamps, non-positive sample
 * durations) is classified bad media, not an internal fault.
 */

/** Structured, JSON-safe details carried on every timeline error. */
export type TimelineErrorDetails = Record<string, unknown>;

/**
 * The track timing data is invalid: a track with no samples (zero-length),
 * a last sample earlier than the first (inverted span), non-finite
 * timestamps or sample durations, a non-positive sample duration, a kind
 * mismatch (a video `TrackTiming` in the audio slot or vice versa), or a
 * missing/non-finite sample field in `extractTrackTiming` input.
 */
export class InvalidTimelineError extends Error {
  readonly terminalFailureClass: "media-invalid";
  /** Alias of {@link InvalidTimelineError.terminalFailureClass}. */
  readonly failureClass: "media-invalid";
  readonly details: TimelineErrorDetails;

  constructor(message: string, details: TimelineErrorDetails = {}) {
    super(message);
    this.name = "InvalidTimelineError";
    this.terminalFailureClass = "media-invalid";
    this.failureClass = "media-invalid";
    this.details = details;
  }
}

/** Union of the typed timeline errors. */
export type TimelineError = InvalidTimelineError;

/**
 * Type guard: `true` when `value` is one of the typed timeline errors (i.e. a
 * deliberate, classified timeline refusal rather than an internal fault).
 */
export function isTimelineError(value: unknown): value is TimelineError {
  return value instanceof InvalidTimelineError;
}
