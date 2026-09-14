/**
 * Typed control-API errors (W701).
 *
 * The control plane's deliberate, classified rejections. Every error carries:
 *
 * - `failureClass` — the machine-readable classification. Reuses the
 *   session-level `TerminalFailureClass` values (`rights-denied`,
 *   `media-invalid`, `resource-limit`, `internal`) so refusals map onto the
 *   existing failure handling, plus the control-plane-only classes
 *   `validation` (malformed caller input), `unknown-session`,
 *   `unknown-render`, and `unknown-segment` (the 404-style classes; the
 *   segment class serves the W504 playback routes);
 * - `httpStatus` — the transport status derived from `failureClass`
 *   (rights-denied → 403; media-invalid/validation → 400; resource-limit →
 *   413; internal → 500; unknown-session/unknown-render → 404);
 * - `details` — structured, JSON-safe evidence (ids, versions, reasons);
 *   never secrets.
 *
 * Underlying errors from `@sporta/renderer-contract` and `@sporta/session`
 * are WRAPPED here (cause + details preserved) — never re-implemented.
 */
import type { TerminalFailureClass } from "@sporta/contracts";
import { RendererContractError } from "@sporta/renderer-contract";
import { RightsDeniedError } from "@sporta/session";

/** Failure classification for control-plane rejections. */
export type ControlFailureClass =
  TerminalFailureClass | "validation" | "unknown-session" | "unknown-render" | "unknown-segment";

/**
 * The canonical typed-error → HTTP status mapping. Mirrors the W701 brief:
 * rights-denied → 403; media-invalid/validation → 400; resource-limit → 413;
 * internal → 500; unknown-session/unknown-render/unknown-segment → 404.
 */
export const CONTROL_HTTP_STATUS: Readonly<Record<ControlFailureClass, number>> = {
  "rights-denied": 403,
  "media-invalid": 400,
  validation: 400,
  "resource-limit": 413,
  internal: 500,
  "unknown-session": 404,
  "unknown-render": 404,
  "unknown-segment": 404,
};

/** Structured, JSON-safe details carried on every control error. */
export type ControlErrorDetails = Record<string, unknown>;

/**
 * The base of the control-API error family: a classified rejection with the
 * derived `httpStatus` and structured `details`.
 */
export class ControlApiError extends Error {
  readonly failureClass: ControlFailureClass;
  readonly httpStatus: number;
  readonly details: ControlErrorDetails;

  constructor(
    failureClass: ControlFailureClass,
    message: string,
    details: ControlErrorDetails = {},
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ControlApiError";
    this.failureClass = failureClass;
    this.httpStatus = CONTROL_HTTP_STATUS[failureClass];
    this.details = details;
  }
}

/** Caller input failed validation (malformed body, bad policy document, ...). */
export class ControlValidationError extends ControlApiError {
  constructor(message: string, details: ControlErrorDetails = {}) {
    super("validation", message, details);
    this.name = "ControlValidationError";
  }
}

/**
 * The fail-closed rights gate denied the operation (architecture-lock §11).
 * Details typically carry `policyId` and a `reason`.
 */
export class ControlRightsDeniedError extends ControlApiError {
  constructor(message: string, details: ControlErrorDetails = {}, options?: { cause?: unknown }) {
    super("rights-denied", message, details, options);
    this.name = "ControlRightsDeniedError";
  }
}

/**
 * The renderer side of the request is invalid (unknown renderer id/version,
 * plugin rejections). Wraps `RendererContractError` evidence.
 */
export class ControlMediaInvalidError extends ControlApiError {
  constructor(message: string, details: ControlErrorDetails = {}, options?: { cause?: unknown }) {
    super("media-invalid", message, details, options);
    this.name = "ControlMediaInvalidError";
  }
}

/** A resource bound was exceeded on the control plane. */
export class ControlResourceLimitError extends ControlApiError {
  constructor(message: string, details: ControlErrorDetails = {}) {
    super("resource-limit", message, details);
    this.name = "ControlResourceLimitError";
  }
}

/** An unexpected internal control-plane fault (never carries secrets). */
export class ControlInternalError extends ControlApiError {
  constructor(message: string, details: ControlErrorDetails = {}, options?: { cause?: unknown }) {
    super("internal", message, details, options);
    this.name = "ControlInternalError";
  }
}

/** 404-style: no media session with the given id. */
export class ControlUnknownSessionError extends ControlApiError {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super("unknown-session", `media session '${sessionId}' was not found`, { sessionId });
    this.name = "ControlUnknownSessionError";
    this.sessionId = sessionId;
  }
}

/** 404-style: no render with the given id under the given session. */
export class ControlUnknownRenderError extends ControlApiError {
  readonly sessionId: string;
  readonly renderId: string;

  constructor(sessionId: string, renderId: string) {
    super("unknown-render", `render '${renderId}' was not found for session '${sessionId}'`, {
      sessionId,
      renderId,
    });
    this.name = "ControlUnknownRenderError";
    this.sessionId = sessionId;
    this.renderId = renderId;
  }
}

/**
 * 404-style: no stored render-output segment with the given id under the
 * given render (W504 playback routes; the render itself may exist).
 */
export class ControlUnknownSegmentError extends ControlApiError {
  readonly sessionId: string;
  readonly renderId: string;
  readonly segmentId: string;

  constructor(sessionId: string, renderId: string, segmentId: string) {
    super(
      "unknown-segment",
      `render output segment '${segmentId}' was not found for render '${renderId}' on session '${sessionId}'`,
      { sessionId, renderId, segmentId },
    );
    this.name = "ControlUnknownSegmentError";
    this.sessionId = sessionId;
    this.renderId = renderId;
    this.segmentId = segmentId;
  }
}

/** Union of the typed control-API errors. */
export type ControlError =
  | ControlApiError
  | ControlValidationError
  | ControlRightsDeniedError
  | ControlMediaInvalidError
  | ControlResourceLimitError
  | ControlInternalError
  | ControlUnknownSessionError
  | ControlUnknownRenderError
  | ControlUnknownSegmentError;

/** Type guard: `true` when `value` is a typed control-API error. */
export function isControlApiError(value: unknown): value is ControlApiError {
  return value instanceof ControlApiError;
}

/** Best-effort message for arbitrary thrown values. */
export function errMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * Wraps a {@link RendererContractError} (plugin `render` refusal, post-dispose
 * use, ...) as a control error PRESERVING its failure class and details.
 */
export function wrapRendererContractError(
  err: RendererContractError,
  messagePrefix = "renderer refused",
): ControlApiError {
  return new ControlApiError(
    err.failureClass,
    `${messagePrefix}: ${err.message}`,
    { ...err.details },
    { cause: err },
  );
}

/**
 * Wraps a registry resolution failure (unknown rendererId, or a rendererId
 * without the requested version) as a `media-invalid` control error. The
 * registry classifies its own errors as `internal` (registry misuse); for the
 * control plane an unresolvable renderer is a caller-input problem, so the
 * wrap reclassifies to `media-invalid` while preserving the original message,
 * details, and cause.
 */
export function wrapRendererResolutionError(err: RendererContractError): ControlApiError {
  return new ControlMediaInvalidError(err.message, { ...err.details }, { cause: err });
}

/**
 * Wraps a fail-closed rights denial from `@sporta/session`
 * ({@link RightsDeniedError}) as a control error, preserving the reason,
 * required operation, and policy id.
 */
export function wrapSessionRightsDenied(err: RightsDeniedError): ControlRightsDeniedError {
  return new ControlRightsDeniedError(
    err.message,
    {
      reason: err.reason,
      requiredOperation: err.requiredOperation,
      ...(err.policyId !== undefined ? { policyId: err.policyId } : {}),
    },
    { cause: err },
  );
}

/**
 * Normalizes any thrown value into a {@link ControlApiError}: typed errors
 * pass through; `RendererContractError` and session `RightsDeniedError` are
 * wrapped (class preserved); anything else becomes an `internal` fault.
 */
export function asControlError(value: unknown): ControlApiError {
  if (value instanceof ControlApiError) return value;
  if (value instanceof RendererContractError) return wrapRendererContractError(value);
  if (value instanceof RightsDeniedError) return wrapSessionRightsDenied(value);
  return new ControlInternalError(
    value instanceof Error ? value.message : "unexpected control-api failure",
    { message: errMessage(value) },
    { cause: value },
  );
}
