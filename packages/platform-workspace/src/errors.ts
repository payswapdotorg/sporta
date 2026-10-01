/**
 * Typed platform-workspace errors (REL-024) — the repo conventions
 * (identity's / corpus's / jobs's / registry's / external-platform's
 * errors.ts): a classified `failureClass`, a stable machine-readable
 * `code`, JSON-safe details.
 *
 * THE DIVISION (the workspace is a COMPOSITION, never a second authority):
 * the workspace's own family covers only the staging-discipline failures —
 * a request that violates the journey's stage shapes, a source that was
 * never uploaded through THIS session, an auto-selection with no eligible
 * organization. The underlying authorities' typed errors propagate
 * unchanged: `corpus.rights-basis-required` from the corpus (the upload
 * boundary), `platform.*` from the external-platform services (the job /
 * output / evidence boundary), `registry.*` from the registry (the
 * organization record boundary). Nothing is re-wrapped, nothing is
 * swallowed — the boundary that owns the refusal throws it.
 */

/** Failure classification for platform-workspace rejections. */
export type WorkspaceFailureClass =
  "validation" | "not-found" | "conflict" | "job-state" | "policy" | "internal";

/** The base of the platform-workspace error family. */
export class WorkspaceApiError extends Error {
  readonly failureClass: WorkspaceFailureClass;
  /** The stable machine-readable error code, e.g. "workspace.not-found". */
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: WorkspaceFailureClass,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "WorkspaceApiError";
    this.failureClass = failureClass;
    this.code = code;
    this.details = details;
  }
}

/** Malformed caller input at a workspace stage boundary (issue list attached). */
export class WorkspaceValidationError extends WorkspaceApiError {
  constructor(message: string, issues: readonly unknown[] = []) {
    super("validation", "workspace.validation", message, { issues });
    this.name = "WorkspaceValidationError";
  }
}

/**
 * A journey-stage resource this session never created — OR one outside the
 * session's platform/tenant scope, presented identically (isolation:
 * existence is not leaked; the underlying services enforce the same law for
 * jobs).
 */
export class WorkspaceNotFoundError extends WorkspaceApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("not-found", "workspace.not-found", message, details);
    this.name = "WorkspaceNotFoundError";
  }
}

/** A stage-ordering violation (the journey's stages are typed, in order). */
export class WorkspaceConflictError extends WorkspaceApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("conflict", "workspace.conflict", message, details);
    this.name = "WorkspaceConflictError";
  }
}

/** A job-state refusal at a workspace stage (premature reads, dead jobs). */
export class WorkspaceJobStateError extends WorkspaceApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("job-state", "workspace.job-state", message, details);
    this.name = "WorkspaceJobStateError";
  }
}

/**
 * An organization-selection refusal: no eligible organization exists for an
 * auto-selection query (the choice model's honest empty answer, refused
 * typed here — an auto-selection with no candidate is a caller-visible
 * failure, never a silent no-op).
 */
export class WorkspaceOrganizationSelectionError extends WorkspaceApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("policy", "workspace.organization-selection", message, details);
    this.name = "WorkspaceOrganizationSelectionError";
  }
}

/** An unexpected internal workspace fault. */
export class WorkspaceInternalError extends WorkspaceApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("internal", "workspace.internal", message, details);
    this.name = "WorkspaceInternalError";
  }
}

/** Union of the typed platform-workspace errors. */
export type WorkspaceError =
  | WorkspaceApiError
  | WorkspaceValidationError
  | WorkspaceNotFoundError
  | WorkspaceConflictError
  | WorkspaceJobStateError
  | WorkspaceOrganizationSelectionError
  | WorkspaceInternalError;

/** Type guard: `true` when `value` is a typed platform-workspace error. */
export function isWorkspaceError(value: unknown): value is WorkspaceApiError {
  return value instanceof WorkspaceApiError;
}
