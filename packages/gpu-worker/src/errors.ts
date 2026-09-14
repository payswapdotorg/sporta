/**
 * Typed gpu-worker errors (W303), in the W301/W302 style: every classified
 * boundary refusal carries a `terminalFailureClass` value from the
 * `@sporta/contracts` enum (so the W004 `ProcessingStateService` /
 * `SessionLifecycle.fail` can record it), a `failureClass` alias, and a
 * structured, JSON-safe `details` object for logs and metric labels.
 *
 * The caller-misuse error (`InvalidDispatcherStateError`) carries no
 * failure class: no media was in a failure state — nothing was accounted.
 */

/** Structured, JSON-safe details carried on every classified error. */
export type GpuWorkerErrorDetails = Record<string, unknown>;

/**
 * A submitted job envelope does not satisfy the `GpuJobEnvelope`
 * invariants (including a jobId collision against a different job).
 * Classified `media-invalid`: the refusal is counted, logged, metered —
 * the dispatcher CONTINUES (one corrupt job never kills a live dispatch
 * session, the W301/W302 posture).
 */
export class MalformedJobError extends Error {
  readonly terminalFailureClass: "media-invalid";
  /** Alias of {@link MalformedJobError.terminalFailureClass}. */
  readonly failureClass: "media-invalid";
  readonly details: GpuWorkerErrorDetails;

  constructor(message: string, details: GpuWorkerErrorDetails = {}) {
    super(message);
    this.name = "MalformedJobError";
    this.terminalFailureClass = "media-invalid";
    this.failureClass = "media-invalid";
    this.details = details;
  }
}

/**
 * Bounded resources refused the job at a boundary (queue at capacity,
 * admitted-job budget exhausted, or no active worker's DECLARED capacity
 * can ever fit the job's requirements — the W104 never-fits posture).
 * Classified `resource-limit`: counted, logged, metered; the refusal is
 * loud and typed, never a silent queue-forever.
 */
export class GpuResourceLimitError extends Error {
  readonly terminalFailureClass: "resource-limit";
  /** Alias of {@link GpuResourceLimitError.terminalFailureClass}. */
  readonly failureClass: "resource-limit";
  readonly details: GpuWorkerErrorDetails;

  constructor(message: string, details: GpuWorkerErrorDetails = {}) {
    super(message);
    this.name = "GpuResourceLimitError";
    this.terminalFailureClass = "resource-limit";
    this.failureClass = "resource-limit";
    this.details = details;
  }
}

/**
 * The dispatcher API was misused (submit/cancel/sweep before `start()`,
 * submit after the dispatcher ended). A CALLER error, not a dispatch
 * terminal failure: nothing was accounted.
 */
export class InvalidDispatcherStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDispatcherStateError";
  }
}

/**
 * A cancel/lookup named a job the dispatcher never admitted. Fail-loud:
 * a cancellation that "succeeds" against an unknown job would be a silent
 * lie (the W301 posture).
 */
export class UnknownJobError extends Error {
  readonly details: GpuWorkerErrorDetails;

  constructor(message: string, details: GpuWorkerErrorDetails = {}) {
    super(message);
    this.name = "UnknownJobError";
    this.details = details;
  }
}

/** Union of the classified gpu-worker boundary errors. */
export type GpuWorkerError = MalformedJobError | GpuResourceLimitError;

/**
 * Type guard: `true` when `value` is one of the classified gpu-worker
 * boundary errors (a deliberate refusal rather than an internal fault).
 */
export function isGpuWorkerError(value: unknown): value is GpuWorkerError {
  return value instanceof MalformedJobError || value instanceof GpuResourceLimitError;
}
