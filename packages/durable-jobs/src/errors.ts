/**
 * Typed durable-jobs errors (REL-012) — the repo conventions (identity's
 * and organization-registry's errors.ts): a classified `failureClass`, a
 * stable machine-readable `code`, JSON-safe details.
 *
 * `JobsCancellationSignal` is special: it is not an Api error but the
 * cooperative-cancellation control-flow signal the runtime throws INTO an
 * executor at the checkpoint that honors a cancellation request. Executors
 * must let it propagate (documented on the executor interface).
 */

/** Failure classification for durable-jobs rejections. */
export type JobsFailureClass =
  "validation" | "not-found" | "conflict" | "illegal-transition" | "lease" | "store";

/** The base of the durable-jobs error family. */
export class JobsApiError extends Error {
  readonly failureClass: JobsFailureClass;
  /** The stable machine-readable error code, e.g. "jobs.lease-held". */
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: JobsFailureClass,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "JobsApiError";
    this.failureClass = failureClass;
    this.code = code;
    this.details = details;
  }
}

/** Malformed caller input at the store boundary (issue list attached). */
export class JobsValidationError extends JobsApiError {
  constructor(message: string, issues: readonly unknown[] = []) {
    super("validation", "jobs.validation", message, { issues });
    this.name = "JobsValidationError";
  }
}

/** Unknown jobId. */
export class JobsNotFoundError extends JobsApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("not-found", "jobs.not-found", message, details);
    this.name = "JobsNotFoundError";
  }
}

/** A jobId conflict (duplicate enqueue). */
export class JobsConflictError extends JobsApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("conflict", "jobs.conflict", message, details);
    this.name = "JobsConflictError";
  }
}

/** An illegal state transition (typed refusal with the machine reason). */
export class JobsIllegalTransitionError extends JobsApiError {
  constructor(
    message: string,
    details: { readonly from: string; readonly to: string; readonly reason: string },
  ) {
    super("illegal-transition", "jobs.illegal-transition", message, { ...details });
    this.name = "JobsIllegalTransitionError";
  }
}

/** A lease-law violation (held / not held / expired / takeover refused). */
export class JobsLeaseError extends JobsApiError {
  constructor(
    code: "jobs.lease-held" | "jobs.lease-not-held" | "jobs.lease-expired",
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super("lease", code, message, details);
    this.name = "JobsLeaseError";
  }
}

/** A journal/file persistence failure (the store poisons itself after one). */
export class JobsStoreError extends JobsApiError {
  constructor(
    code: "jobs.store-write-failed" | "jobs.store-read-failed" | "jobs.store-poisoned",
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super("store", code, message, details);
    this.name = "JobsStoreError";
  }
}

/** Union of the typed durable-jobs errors. */
export type JobsError =
  | JobsApiError
  | JobsValidationError
  | JobsNotFoundError
  | JobsConflictError
  | JobsIllegalTransitionError
  | JobsLeaseError
  | JobsStoreError;

/** Type guard: `true` when `value` is a typed durable-jobs error. */
export function isJobsError(value: unknown): value is JobsApiError {
  return value instanceof JobsApiError;
}

/**
 * The cooperative-cancellation signal: thrown into an executor by the
 * runtime's checkpoint when a cancellation request is honored. Executors
 * must NOT catch it — it is how the runtime stops them at the checkpoint
 * boundary where the cancellation became effective.
 */
export class JobsCancellationSignal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobsCancellationSignal";
  }
}
