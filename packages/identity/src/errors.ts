/**
 * Typed identity errors (W902), following `@sporta/control-api`'s errors.ts
 * conventions: a classified `failureClass`, a derived `httpStatus`, and
 * structured JSON-safe details (never secrets, never password material).
 *
 * NO USER ENUMERATION: `IdentityAuthInvalidError` (login failures) and
 * `IdentityUnauthenticatedError` (missing/expired/revoked session) carry
 * GENERIC messages that do not depend on whether the username or token
 * exists — the tests pin byte-identical responses for both branches.
 */
import { AccountConflictError, AccountNotFoundError } from "./accounts";

/** Failure classification for identity rejections. */
export type IdentityFailureClass =
  "validation" | "auth-invalid" | "unauthenticated" | "permission-denied" | "conflict" | "internal";

/**
 * The canonical typed-error → HTTP status mapping:
 * validation → 400; auth-invalid/unauthenticated → 401;
 * permission-denied → 403; conflict → 409; internal → 500.
 */
export const IDENTITY_HTTP_STATUS: Readonly<Record<IdentityFailureClass, number>> = {
  validation: 400,
  "auth-invalid": 401,
  unauthenticated: 401,
  "permission-denied": 403,
  conflict: 409,
  internal: 500,
};

/** Structured, JSON-safe details carried on every identity error. */
export type IdentityErrorDetails = Record<string, unknown>;

/**
 * The base of the identity error family (mirrors `@sporta/control-api`'s
 * `ControlApiError`): a classified rejection with the derived `httpStatus`
 * and structured `details`.
 */
export class IdentityApiError extends Error {
  readonly failureClass: IdentityFailureClass;
  readonly httpStatus: number;
  readonly details: IdentityErrorDetails;

  constructor(
    failureClass: IdentityFailureClass,
    message: string,
    details: IdentityErrorDetails = {},
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "IdentityApiError";
    this.failureClass = failureClass;
    this.httpStatus = IDENTITY_HTTP_STATUS[failureClass];
    this.details = details;
  }
}

/** Malformed caller input (bad username/password shape, bad JSON body). */
export class IdentityValidationError extends IdentityApiError {
  constructor(message: string, details: IdentityErrorDetails = {}) {
    super("validation", message, details);
    this.name = "IdentityValidationError";
  }
}

/**
 * Credentials did not verify. GENERIC by design: the message is identical
 * for an unknown username and a wrong password (no user enumeration).
 */
export class IdentityAuthInvalidError extends IdentityApiError {
  constructor(message = "invalid credentials") {
    super("auth-invalid", message);
    this.name = "IdentityAuthInvalidError";
  }
}

/**
 * No valid session backs the call (missing, expired, revoked, or unknown
 * token). GENERIC by design: identical whether the token never existed or
 * was revoked.
 */
export class IdentityUnauthenticatedError extends IdentityApiError {
  constructor(message = "authentication required") {
    super("unauthenticated", message);
    this.name = "IdentityUnauthenticatedError";
  }
}

/**
 * The authenticated account is not allowed to do this (missing grant,
 * unheld role switch, not their resource).
 */
export class IdentityPermissionDeniedError extends IdentityApiError {
  constructor(message: string, details: IdentityErrorDetails = {}) {
    super("permission-denied", message, details);
    this.name = "IdentityPermissionDeniedError";
  }
}

/** A uniqueness conflict (username already registered). */
export class IdentityConflictError extends IdentityApiError {
  constructor(message: string, details: IdentityErrorDetails = {}) {
    super("conflict", message, details);
    this.name = "IdentityConflictError";
  }
}

/** An unexpected internal identity fault (never carries secrets). */
export class IdentityInternalError extends IdentityApiError {
  constructor(message: string, details: IdentityErrorDetails = {}, options?: { cause?: unknown }) {
    super("internal", message, details, options);
    this.name = "IdentityInternalError";
  }
}

/** Union of the typed identity errors. */
export type IdentityError =
  | IdentityApiError
  | IdentityValidationError
  | IdentityAuthInvalidError
  | IdentityUnauthenticatedError
  | IdentityPermissionDeniedError
  | IdentityConflictError
  | IdentityInternalError;

/** Type guard: `true` when `value` is a typed identity error. */
export function isIdentityError(value: unknown): value is IdentityApiError {
  return value instanceof IdentityApiError;
}

/** Best-effort message for arbitrary thrown values. */
export function errMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * Normalizes any thrown value into an {@link IdentityApiError}: typed errors
 * pass through; account-store typed errors map to their identity classes;
 * anything else becomes an `internal` fault.
 */
export function asIdentityError(value: unknown): IdentityApiError {
  if (value instanceof IdentityApiError) return value;
  if (value instanceof AccountConflictError) {
    return new IdentityConflictError(value.message, { username: value.username });
  }
  if (value instanceof AccountNotFoundError) {
    return new IdentityInternalError(value.message, { userId: value.userId }, { cause: value });
  }
  return new IdentityInternalError(
    value instanceof Error ? value.message : "unexpected identity failure",
    { message: errMessage(value) },
    { cause: value },
  );
}
