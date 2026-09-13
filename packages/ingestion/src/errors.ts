/**
 * Typed ingestion errors (W101).
 *
 * Every rejection at the ingestion boundary throws one of these, carrying a
 * `terminalFailureClass` value from the `@sporta/contracts`
 * `TerminalFailureClass` enum so a session can record the failure via
 * `ProcessingStateService.classifyFailure` (W004). Each error also exposes
 * `failureClass` as a short alias of {@link IngestionError.terminalFailureClass}
 * and a structured, JSON-safe `details` object for logs and metrics labels.
 */

/** Structured, JSON-safe details carried on every ingestion error. */
export type IngestionErrorDetails = Record<string, unknown>;

/**
 * The authorization policy denied ingestion (fail-closed rights gate,
 * architecture-lock §11). Details typically carry `reason`
 * ("missing-policy" | "expired-policy" | "missing-operation"),
 * `requiredOperation`, and `policyId`.
 */
export class RightsDeniedError extends Error {
  readonly terminalFailureClass: "rights-denied";
  /** Alias of {@link RightsDeniedError.terminalFailureClass}. */
  readonly failureClass: "rights-denied";
  readonly details: IngestionErrorDetails;

  constructor(message: string, details: IngestionErrorDetails = {}) {
    super(message);
    this.name = "RightsDeniedError";
    this.terminalFailureClass = "rights-denied";
    this.failureClass = "rights-denied";
    this.details = details;
  }
}

/**
 * The media is invalid or unsupported for this boundary (unknown or
 * non-allowlisted container). Details typically carry `detectedContainer`,
 * `detectedMimeType`, `detectedBy`, `allowedContainers`, and `byteLength`.
 */
export class UnsupportedMediaError extends Error {
  readonly terminalFailureClass: "media-invalid";
  /** Alias of {@link UnsupportedMediaError.terminalFailureClass}. */
  readonly failureClass: "media-invalid";
  readonly details: IngestionErrorDetails;

  constructor(message: string, details: IngestionErrorDetails = {}) {
    super(message);
    this.name = "UnsupportedMediaError";
    this.terminalFailureClass = "media-invalid";
    this.failureClass = "media-invalid";
    this.details = details;
  }
}

/**
 * A resource bound was exceeded (e.g. source size over `policy.maxBytes`).
 * Details typically carry `byteLength` and `maxBytes`.
 */
export class ResourceLimitError extends Error {
  readonly terminalFailureClass: "resource-limit";
  /** Alias of {@link ResourceLimitError.terminalFailureClass}. */
  readonly failureClass: "resource-limit";
  readonly details: IngestionErrorDetails;

  constructor(message: string, details: IngestionErrorDetails = {}) {
    super(message);
    this.name = "ResourceLimitError";
    this.terminalFailureClass = "resource-limit";
    this.failureClass = "resource-limit";
    this.details = details;
  }
}

/** Union of the typed ingestion errors. */
export type IngestionError = RightsDeniedError | UnsupportedMediaError | ResourceLimitError;

/**
 * Type guard: `true` when `value` is one of the typed ingestion errors
 * (i.e. a deliberate, classified ingestion rejection rather than an internal
 * fault).
 */
export function isIngestionError(value: unknown): value is IngestionError {
  return (
    value instanceof RightsDeniedError ||
    value instanceof UnsupportedMediaError ||
    value instanceof ResourceLimitError
  );
}
