/**
 * Typed user-lab errors (REL-020..023) — following `@sporta/identity`'s and
 * `@sporta/organization-registry`'s errors.ts conventions: a classified
 * `failureClass` and structured JSON-safe details.
 *
 * Scope discipline mirrors the registry's split exactly:
 * - STORAGE-BOUNDARY failures throw typed errors here (malformed caller
 *   input, unknown ids, duplicate policy versions) — including the tenant
 *   isolation boundary (`LabIsolationError`), which is a HARD boundary, not
 *   a convention: every cross-tenant path in this package refuses by
 *   throwing it, and every one of those paths is tested.
 * - DOMAIN decisions (budget exceeded, incomplete candidate at publication,
 *   unsatisfiable import dependency, ...) never throw — those operations
 *   return TYPED REFUSAL RECORDS because a refusal is evidence the caller
 *   must be able to record, not an exceptional control-flow event.
 */

/** Failure classification for user-lab rejections. */
export type LabFailureClass = "validation" | "not-found" | "conflict" | "isolation" | "internal";

/** The base of the user-lab error family. */
export class LabApiError extends Error {
  readonly failureClass: LabFailureClass;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: LabFailureClass,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LabApiError";
    this.failureClass = failureClass;
    this.details = details;
  }
}

/** Malformed caller input at a user-lab boundary (issue list attached). */
export class LabValidationError extends LabApiError {
  constructor(message: string, issues: readonly unknown[] = []) {
    super("validation", message, { issues });
    this.name = "LabValidationError";
  }
}

/** Unknown lab / run / candidate / publication / policy version / request. */
export class LabNotFoundError extends LabApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("not-found", message, details);
    this.name = "LabNotFoundError";
  }
}

/** A uniqueness / state conflict (duplicate policy version, double withdrawal). */
export class LabConflictError extends LabApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("conflict", message, details);
    this.name = "LabConflictError";
  }
}

/**
 * THE TENANT ISOLATION BOUNDARY (REL-020): a tenant attempted to touch a
 * resource owned by another tenant. Tenant isolation is a hard boundary, not
 * a convention — this error is thrown (never swallowed, never returned as a
 * soft value) on every cross-tenant path, and each path is tested.
 */
export class LabIsolationError extends LabApiError {
  constructor(
    message: string,
    details: {
      attemptingTenantId: string;
      owningTenantId: string;
      resourceType: string;
      resourceId: string;
    },
  ) {
    super("isolation", message, { ...details });
    this.name = "LabIsolationError";
  }
}

/** An unexpected internal user-lab fault (an invariant blew up). */
export class LabInternalError extends LabApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("internal", message, details);
    this.name = "LabInternalError";
  }
}

/** Union of the typed user-lab errors. */
export type LabError =
  | LabApiError
  | LabValidationError
  | LabNotFoundError
  | LabConflictError
  | LabIsolationError
  | LabInternalError;

/** Type guard: `true` when `value` is a typed user-lab error. */
export function isLabError(value: unknown): value is LabApiError {
  return value instanceof LabApiError;
}
