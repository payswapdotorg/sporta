/**
 * Typed corpus errors (REL-009) — following `@sporta/identity`'s and
 * `@sporta/organization-registry`'s errors.ts conventions: a classified
 * `failureClass`, a stable machine-readable `code`, and structured
 * JSON-safe details.
 *
 * THE INVARIANT ERROR: `CorpusRightsBasisRequiredError` (code
 * `corpus.rights-basis-required`) — fired whenever an acquisition path is
 * attempted without an explicit rights/policy basis record. Both paths are
 * covered: provider-reference authorization and user-fed upload ingestion.
 * No bypass path exists; the branded access token (src/provider-adapter.ts)
 * cannot be forged outside this package, at the type level or at runtime.
 */

/** Failure classification for corpus rejections. */
export type CorpusFailureClass =
  | "validation"
  | "not-found"
  | "conflict"
  | "rights"
  | "restriction"
  | "illegal-transition"
  | "internal";

/** The base of the corpus error family. */
export class CorpusApiError extends Error {
  readonly failureClass: CorpusFailureClass;
  /** The stable machine-readable error code, e.g. "corpus.rights-basis-required". */
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: CorpusFailureClass,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CorpusApiError";
    this.failureClass = failureClass;
    this.code = code;
    this.details = details;
  }
}

/** Malformed caller input at the corpus boundary (issue list attached). */
export class CorpusValidationError extends CorpusApiError {
  constructor(message: string, issues: readonly unknown[] = []) {
    super("validation", "corpus.validation", message, { issues });
    this.name = "CorpusValidationError";
  }
}

/** Unknown sourceId / fixture reference. */
export class CorpusNotFoundError extends CorpusApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("not-found", "corpus.not-found", message, details);
    this.name = "CorpusNotFoundError";
  }
}

/** A uniqueness conflict (canonical URL already registered with different metadata). */
export class CorpusConflictError extends CorpusApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("conflict", "corpus.conflict", message, details);
    this.name = "CorpusConflictError";
  }
}

/**
 * THE INVARIANT ERROR: an acquisition path was attempted without an
 * explicit rights/policy basis record. "A URL is a source reference, not
 * proof of transformation rights" — the store refuses, fail-closed, and
 * the source record stays where it was.
 */
export class CorpusRightsBasisRequiredError extends CorpusApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("rights", "corpus.rights-basis-required", message, details);
    this.name = "CorpusRightsBasisRequiredError";
  }
}

/**
 * A declared source restriction forbids the attempted operation. Fail
 * closed: a rights basis cannot lift a source's own declared restriction
 * (`reference-only` blocks byte access authorization; `no-transformation`
 * blocks normalization).
 */
export class CorpusRestrictionError extends CorpusApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("restriction", "corpus.restriction-forbidden", message, details);
    this.name = "CorpusRestrictionError";
  }
}

/** An illegal acquisition-state transition (typed refusal with the reason). */
export class CorpusIllegalTransitionError extends CorpusApiError {
  constructor(
    message: string,
    details: { readonly from: string; readonly to: string; readonly reason: string },
  ) {
    super("illegal-transition", "corpus.illegal-transition", message, { ...details });
    this.name = "CorpusIllegalTransitionError";
  }
}

/**
 * An access token is invalid: forged (the brand is missing — only the
 * store can mint tokens) or scoped to a different source than the one it
 * was presented for.
 */
export class CorpusAccessInvalidError extends CorpusApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("rights", "corpus.access-invalid", message, details);
    this.name = "CorpusAccessInvalidError";
  }
}

/** The adapter has no bytes for the reference (availability is honest, never fabricated). */
export class CorpusBytesUnavailableError extends CorpusApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("not-found", "corpus.bytes-unavailable", message, details);
    this.name = "CorpusBytesUnavailableError";
  }
}

/** A benchmark fixture does not match the source it was presented for. */
export class CorpusFixtureMismatchError extends CorpusApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("conflict", "corpus.fixture-mismatch", message, details);
    this.name = "CorpusFixtureMismatchError";
  }
}

/** An unexpected internal corpus fault. */
export class CorpusInternalError extends CorpusApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("internal", "corpus.internal", message, details);
    this.name = "CorpusInternalError";
  }
}

/** Union of the typed corpus errors. */
export type CorpusError =
  | CorpusApiError
  | CorpusValidationError
  | CorpusNotFoundError
  | CorpusConflictError
  | CorpusRightsBasisRequiredError
  | CorpusRestrictionError
  | CorpusIllegalTransitionError
  | CorpusAccessInvalidError
  | CorpusBytesUnavailableError
  | CorpusFixtureMismatchError
  | CorpusInternalError;

/** Type guard: `true` when `value` is a typed corpus error. */
export function isCorpusError(value: unknown): value is CorpusApiError {
  return value instanceof CorpusApiError;
}
