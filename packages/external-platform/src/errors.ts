/**
 * Typed external-platform errors (REL-014) — the repo conventions
 * (identity's / corpus's / jobs's / registry's errors.ts): a classified
 * `failureClass`, a stable machine-readable `code`, JSON-safe details.
 *
 * The platform's own family covers the surface-specific failures
 * (validation, isolation-aware not-found, idempotency conflicts, job-state
 * refusals, organization-selection policy). Rights/policy enforcement is
 * DELEGATED to the corpus state machine and promotion to the registry's
 * gates: their typed errors (`corpus.*`, `registry.*`, `jobs.*`) propagate
 * through the surfaces unchanged — the surfaces map every family's
 * `failureClass` + `code` into useful typed transport states.
 */

/** Failure classification for external-platform rejections. */
export type PlatformFailureClass =
  "validation" | "not-found" | "conflict" | "unauthorized" | "job-state" | "policy" | "internal";

/** The base of the external-platform error family. */
export class PlatformApiError extends Error {
  readonly failureClass: PlatformFailureClass;
  /** The stable machine-readable error code, e.g. "platform.not-found". */
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: PlatformFailureClass,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PlatformApiError";
    this.failureClass = failureClass;
    this.code = code;
    this.details = details;
  }
}

/** Malformed caller input at the platform boundary (issue list attached). */
export class PlatformValidationError extends PlatformApiError {
  constructor(message: string, issues: readonly unknown[] = []) {
    super("validation", "platform.validation", message, { issues });
    this.name = "PlatformValidationError";
  }
}

/**
 * Unknown resource — OR a resource outside the caller's tenant/platform
 * scope, presented identically (isolation: existence is not leaked).
 */
export class PlatformNotFoundError extends PlatformApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("not-found", "platform.not-found", message, details);
    this.name = "PlatformNotFoundError";
  }
}

/** An idempotency-key reuse with a DIFFERENT request (never silently re-run). */
export class PlatformConflictError extends PlatformApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("conflict", "platform.conflict", message, details);
    this.name = "PlatformConflictError";
  }
}

/** A job-state refusal: output/evidence before completion, terminal cancels. */
export class PlatformJobStateError extends PlatformApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("job-state", "platform.job-state", message, details);
    this.name = "PlatformJobStateError";
  }
}

/**
 * An organization-selection policy refusal: the requested organization is
 * not selectable for production work (draft/benchmarked carry unproven
 * evidence; retired is dead), or no eligible organization exists.
 */
export class PlatformOrganizationPolicyError extends PlatformApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("policy", "platform.organization-not-selectable", message, details);
    this.name = "PlatformOrganizationPolicyError";
  }
}

/** An unexpected internal platform fault. */
export class PlatformInternalError extends PlatformApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("internal", "platform.internal", message, details);
    this.name = "PlatformInternalError";
  }
}

/** Union of the typed external-platform errors. */
export type PlatformError =
  | PlatformApiError
  | PlatformValidationError
  | PlatformNotFoundError
  | PlatformConflictError
  | PlatformJobStateError
  | PlatformOrganizationPolicyError
  | PlatformInternalError;

/** Type guard: `true` when `value` is a typed external-platform error. */
export function isPlatformError(value: unknown): value is PlatformApiError {
  return value instanceof PlatformApiError;
}

/**
 * The transport-neutral error shape every surface maps typed errors into:
 * any of the four families (platform/corpus/registry/jobs) carries a
 * `failureClass` + `code` + JSON-safe `details`.
 */
export interface TypedErrorRecord {
  readonly failureClass: string;
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

/** Projects any typed Api error of the four families into the neutral shape. */
export function toTypedErrorRecord(error: unknown): TypedErrorRecord {
  if (typeof error === "object" && error !== null && "failureClass" in error) {
    const typed = error as {
      failureClass: unknown;
      code?: unknown;
      message?: unknown;
      details?: unknown;
    };
    if (typeof typed.failureClass === "string") {
      // The registry's error family predates the `code` convention (it
      // carries failureClass + details only) — derive an honest, stable
      // upstream code from the constructor name instead of inventing one.
      const code =
        typeof typed.code === "string"
          ? typed.code
          : `upstream.${error.constructor?.name ?? "UnknownError"}`;
      return {
        failureClass: typed.failureClass,
        code,
        message: String(typed.message ?? error),
        details:
          typeof typed.details === "object" && typed.details !== null
            ? (typed.details as Record<string, unknown>)
            : {},
      };
    }
  }
  return {
    failureClass: "internal",
    code: "platform.internal",
    message: error instanceof Error ? error.message : String(error),
    details: {},
  };
}
