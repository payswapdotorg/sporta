/**
 * Typed registry errors (REL-017) — following `@sporta/identity`'s errors.ts
 * conventions: a classified `failureClass` and structured JSON-safe details.
 *
 * Scope discipline: these are STORAGE-BOUNDARY errors only (malformed
 * registration input, duplicate organizationId, unknown record). The
 * PROMOTION domain never throws its refusals — `requestPromotion` /
 * `requestRollback` return TYPED REFUSAL RECORDS (see src/promotion.ts)
 * because a refusal is evidence the caller must be able to record, not an
 * exceptional control-flow event.
 */

/** Failure classification for registry rejections. */
export type RegistryFailureClass = "validation" | "not-found" | "conflict" | "internal";

/** The base of the registry error family. */
export class RegistryApiError extends Error {
  readonly failureClass: RegistryFailureClass;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: RegistryFailureClass,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RegistryApiError";
    this.failureClass = failureClass;
    this.details = details;
  }
}

/** Malformed caller input at the registry boundary (issue list attached). */
export class RegistryValidationError extends RegistryApiError {
  constructor(message: string, issues: readonly unknown[] = []) {
    super("validation", message, { issues });
    this.name = "RegistryValidationError";
  }
}

/** Unknown organizationId / version. */
export class RegistryNotFoundError extends RegistryApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("not-found", message, details);
    this.name = "RegistryNotFoundError";
  }
}

/** A uniqueness conflict (organizationId already registered). */
export class RegistryConflictError extends RegistryApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("conflict", message, details);
    this.name = "RegistryConflictError";
  }
}

/** An unexpected internal registry fault. */
export class RegistryInternalError extends RegistryApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("internal", message, details);
    this.name = "RegistryInternalError";
  }
}

/** Union of the typed registry errors. */
export type RegistryError =
  | RegistryApiError
  | RegistryValidationError
  | RegistryNotFoundError
  | RegistryConflictError
  | RegistryInternalError;

/** Type guard: `true` when `value` is a typed registry error. */
export function isRegistryError(value: unknown): value is RegistryApiError {
  return value instanceof RegistryApiError;
}
