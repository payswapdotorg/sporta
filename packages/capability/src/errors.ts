/**
 * Typed errors for `@sporta/capability` (W901).
 *
 * Follows `@sporta/control-api`'s errors.ts conventions: a classified
 * failureClass, an HTTP status mapping (for the future transport), and
 * structured JSON-safe details. The two classes:
 *
 * - `CapabilityInputError` (`validation`, 400) — the caller's input was
 *   structurally unusable (not an object, unknown keys, missing `session`,
 *   inconsistent identity data). The service REFUSES to build a response:
 *   fail-closed means never inventing a response from broken input.
 * - `CapabilityParseError` (`validation`, 400) — response bytes failed
 *   schema validation (unknown keys, closed-vocabulary violations, or a
 *   cross-field invariant).
 */

/** Failure classes for the capability package. */
export type CapabilityFailureClass = "validation" | "internal";

/** The canonical failureClass → HTTP status mapping (transport-agnostic). */
export const CAPABILITY_HTTP_STATUS: Readonly<Record<CapabilityFailureClass, number>> = {
  validation: 400,
  internal: 500,
};

/** Base of the capability error family. */
export class CapabilityError extends Error {
  readonly failureClass: CapabilityFailureClass;
  readonly httpStatus: number;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: CapabilityFailureClass,
    message: string,
    details: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CapabilityError";
    this.failureClass = failureClass;
    this.httpStatus = CAPABILITY_HTTP_STATUS[failureClass];
    this.details = details;
  }
}

/**
 * The capability service input was structurally invalid. No response was
 * built (fail-closed: a broken input never produces an invented response).
 */
export class CapabilityInputError extends CapabilityError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("validation", message, details);
    this.name = "CapabilityInputError";
  }
}

/** Capability response bytes failed schema validation. */
export class CapabilityParseError extends CapabilityError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("validation", message, details);
    this.name = "CapabilityParseError";
  }
}

/** The composition produced a response that failed its own schema. */
export class CapabilityInternalError extends CapabilityError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("internal", message, details);
    this.name = "CapabilityInternalError";
  }
}

/** Type guard: `true` when `value` is a typed capability error. */
export function isCapabilityError(value: unknown): value is CapabilityError {
  return value instanceof CapabilityError;
}
