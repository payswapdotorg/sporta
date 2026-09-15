/**
 * Typed compute-adapter boundary errors (W914 Wave 1), in the W303 error
 * style: every classified boundary refusal carries a `terminalFailureClass`
 * from the `@sporta/contracts` enum (`"rights-denied" | "media-invalid" |
 * "resource-limit" | "internal"` — mirrored here so the contract layer stays
 * `zod`-only), plus a structured, JSON-safe `details` object.
 *
 * Caller-misuse errors (`UnknownComputeJobError`, `ComputeAdapterMisuseError`)
 * carry no failure class: nothing was accounted (the W303
 * `InvalidDispatcherStateError` posture).
 */

/** The contracts `TerminalFailureClass` enum, mirrored (see module docs). */
export const COMPUTE_FAILURE_CLASSES = [
  "rights-denied",
  "media-invalid",
  "resource-limit",
  "internal",
] as const;
export type ComputeFailureClass = (typeof COMPUTE_FAILURE_CLASSES)[number];

/** Structured, JSON-safe details carried on every classified error. */
export type ComputeAdapterErrorDetails = Record<string, unknown>;

/** The classified base: a deliberate adapter-boundary refusal. */
export class ComputeAdapterError extends Error {
  readonly terminalFailureClass: ComputeFailureClass;
  /** Alias of {@link ComputeAdapterError.terminalFailureClass}. */
  readonly failureClass: ComputeFailureClass;
  readonly details: ComputeAdapterErrorDetails;

  constructor(
    message: string,
    failureClass: ComputeFailureClass,
    details: ComputeAdapterErrorDetails = {},
  ) {
    super(message);
    this.name = "ComputeAdapterError";
    this.terminalFailureClass = failureClass;
    this.failureClass = failureClass;
    this.details = details;
  }
}

/**
 * A dispatched job description does not satisfy the `ComputeJobDescription`
 * schema (including a jobId collision against a different job's id).
 * Classified `media-invalid`: counted, logged, metered — the adapter
 * CONTINUES (one corrupt dispatch never kills a live adapter, the W301/W302/
 * W303 posture).
 */
export class ComputeValidationError extends ComputeAdapterError {
  constructor(message: string, details: ComputeAdapterErrorDetails = {}) {
    super(message, "media-invalid", details);
    this.name = "ComputeValidationError";
  }
}

/**
 * The adapter's own descriptor refuses the job at admission — a renderer the
 * descriptor does not declare, an output latency class it does not serve, or
 * a deadline outside its bounds. Classified `media-invalid` (the W501 R3
 * compatibility-gate precedent: an unsupported request is a request the
 * adapter cannot honestly accept). Descriptor honesty: declaring an
 * unsupported renderer is rejected HERE, before any provider sees work.
 */
export class ComputeAdmissionError extends ComputeAdapterError {
  constructor(message: string, details: ComputeAdapterErrorDetails = {}) {
    super(message, "media-invalid", details);
    this.name = "ComputeAdmissionError";
  }
}

/**
 * Bounded resources refused the job (concurrency/queue capacity, or a
 * requirements shape no declared capacity can ever fit — the W104/W303
 * never-fits posture). Classified `resource-limit`: loud and typed, never a
 * silent queue-forever.
 */
export class ComputeResourceLimitError extends ComputeAdapterError {
  constructor(message: string, details: ComputeAdapterErrorDetails = {}) {
    super(message, "resource-limit", details);
    this.name = "ComputeResourceLimitError";
  }
}

/**
 * The job's rights posture denies what its inputs require (`source-media`
 * inputs without `canReferenceSourceFrames` — the R2 fail-closed gate of the
 * W501 renderer contract; architecture-lock §11: transformation never
 * clears rights). Classified `rights-denied`: refused BEFORE any bytes or
 * existence are revealed.
 */
export class ComputeRightsError extends ComputeAdapterError {
  constructor(message: string, details: ComputeAdapterErrorDetails = {}) {
    super(message, "rights-denied", details);
    this.name = "ComputeRightsError";
  }
}

/**
 * A cancel/lookup named a job the adapter never admitted. Fail-loud: a
 * cancellation that "succeeds" against an unknown job would be a silent lie
 * (the W303 `UnknownJobError` posture). No failure class — nothing was
 * accounted.
 */
export class UnknownComputeJobError extends Error {
  readonly details: ComputeAdapterErrorDetails;

  constructor(message: string, details: ComputeAdapterErrorDetails = {}) {
    super(message);
    this.name = "UnknownComputeJobError";
    this.details = details;
  }
}

/**
 * The adapter API was misused (settling twice, subscribing after settle,
 * mutating a frozen descriptor). A CALLER error, not a compute terminal
 * failure: nothing was accounted (the W303 `InvalidDispatcherStateError`
 * posture).
 */
export class ComputeAdapterMisuseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputeAdapterMisuseError";
  }
}

/** Union of the classified compute-adapter boundary errors. */
export type ClassifiedComputeError =
  ComputeValidationError | ComputeAdmissionError | ComputeResourceLimitError | ComputeRightsError;

/**
 * Type guard: `true` when `value` is one of the classified compute-adapter
 * boundary errors (a deliberate refusal rather than an internal fault).
 */
export function isClassifiedComputeError(value: unknown): value is ClassifiedComputeError {
  return (
    value instanceof ComputeValidationError ||
    value instanceof ComputeAdmissionError ||
    value instanceof ComputeResourceLimitError ||
    value instanceof ComputeRightsError
  );
}
