/**
 * Typed render-orchestration errors (W304), in the W301/W302/W303 style:
 * every classified boundary refusal carries a `terminalFailureClass` value
 * from the `@sporta/contracts` enum (so the W004 `SessionLifecycle.fail` can
 * record it), a `failureClass` alias, and a structured, JSON-safe `details`
 * object for logs and metric labels.
 *
 * Caller-misuse errors (invalid options, wrong lifecycle phase, an unknown
 * payload reference) carry no failure class: no media was in a failure state
 * — nothing was accounted.
 */

/** Structured, JSON-safe details carried on every classified error. */
export type RenderOrchestrationErrorDetails = Record<string, unknown>;

/**
 * A caller handed the orchestrator something structurally invalid (a
 * malformed request template, a corrupt checkpoint, an invalid policy or
 * limits). Classified `media-invalid`: nothing was accounted — the caller
 * learned the refusal synchronously and loudly.
 */
export class InvalidRenderSetupError extends Error {
  readonly terminalFailureClass: "media-invalid";
  /** Alias of {@link InvalidRenderSetupError.terminalFailureClass}. */
  readonly failureClass: "media-invalid";
  readonly details: RenderOrchestrationErrorDetails;

  constructor(message: string, details: RenderOrchestrationErrorDetails = {}) {
    super(message);
    this.name = "InvalidRenderSetupError";
    this.terminalFailureClass = "media-invalid";
    this.failureClass = "media-invalid";
    this.details = details;
  }
}

/**
 * A checkpoint handed to `resume()` does not satisfy the W304 checkpoint
 * invariants (fail loud on corrupt recovery state — never silently replay
 * from a bad checkpoint; the W302 `InvalidCheckpointError` posture).
 */
export class InvalidRenderCheckpointError extends Error {
  readonly terminalFailureClass: "media-invalid";
  /** Alias of {@link InvalidRenderCheckpointError.terminalFailureClass}. */
  readonly failureClass: "media-invalid";
  readonly details: RenderOrchestrationErrorDetails;

  constructor(message: string, details: RenderOrchestrationErrorDetails = {}) {
    super(message);
    this.name = "InvalidRenderCheckpointError";
    this.terminalFailureClass = "media-invalid";
    this.failureClass = "media-invalid";
    this.details = details;
  }
}

/**
 * The orchestrator API was misused (start/resume/stop in a phase that does
 * not allow it, double start). A CALLER error, not a terminal failure:
 * nothing was accounted.
 */
export class InvalidOrchestratorPhaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOrchestratorPhaseError";
  }
}

/**
 * An internal state invariant was breached (a settled run without a settled
 * result). Fail-loud: never return a fabricated result.
 */
export class InvalidOrchestratorStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOrchestratorStateError";
  }
}

/**
 * A protocol invariant was breached at the render boundary: an executor
 * returned something that is not an `AnimeRenderOutput`, or a job payload
 * reference named an unknown batch. Classified `internal` — this is a bug in
 * a composed component, never a media state; the batch is accounted dropped
 * with the reason recorded (never silent), and the error carries the
 * evidence.
 */
export class RenderOutputInvalidError extends Error {
  readonly terminalFailureClass: "internal";
  /** Alias of {@link RenderOutputInvalidError.terminalFailureClass}. */
  readonly failureClass: "internal";
  readonly details: RenderOrchestrationErrorDetails;

  constructor(message: string, details: RenderOrchestrationErrorDetails = {}) {
    super(message);
    this.name = "RenderOutputInvalidError";
    this.terminalFailureClass = "internal";
    this.failureClass = "internal";
    this.details = details;
  }
}

/** Union of the classified render-orchestration errors. */
export type RenderOrchestrationError =
  InvalidRenderSetupError | InvalidRenderCheckpointError | RenderOutputInvalidError;

/**
 * Type guard: `true` when `value` is one of the classified
 * render-orchestration errors (a deliberate refusal or protocol fault rather
 * than a caller bug).
 */
export function isRenderOrchestrationError(value: unknown): value is RenderOrchestrationError {
  return (
    value instanceof InvalidRenderSetupError ||
    value instanceof InvalidRenderCheckpointError ||
    value instanceof RenderOutputInvalidError
  );
}
