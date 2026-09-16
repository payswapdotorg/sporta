/**
 * The viewer-shell error model (W702): every failure the shell can surface,
 * classified, labeled, and retry-classified — nothing swallowed.
 *
 * The control plane (W701 + W504 playback routes) answers every deliberate
 * refusal as
 * `{ error: { failureClass, message, details? } }` with the classes
 * `rights-denied | media-invalid | validation | resource-limit | internal |
 * unknown-session | unknown-render | unknown-segment` (app + playback)
 * plus `unknown-route` and `method-not-allowed` (transport). The viewer
 * consumes those classes VERBATIM and adds exactly two viewer-side classes:
 *
 * - `network` — the control server could not be reached at all (fetch
 *   refused/timeout); the server never answered, so no server-side class
 *   exists yet;
 * - `unsupported-output` — the render's playable OUTPUT is not available
 *   through any existing seam. This is the honest W704 gap: W702 can list and
 *   create renders, but stored-output retrieval behind the control plane
 *   arrives with W504/W705. The shell surfaces the gap instead of faking a
 *   player state.
 *
 * Every {@link ErrorView} (the error view-model) is derived through
 * {@link errorViewFrom} so the classification, human label, and retryability
 * come from ONE table — test-pinned for every class.
 */

/**
 * Failure classes the viewer can surface. `rights-denied`, `media-invalid`,
 * `validation`, `resource-limit`, `internal`, `unknown-session`,
 * `unknown-render`, `unknown-segment` (W504 playback 404 family) come from
 * the control plane's error family (W701 `ControlFailureClass`);
 * `compute-unavailable`/`unknown-compute-job` are its W914 async-compute
 * classes (503 Service Unavailable / 404 semantics);
 * `unknown-route`/`method-not-allowed` from its transport; `network` and
 * `unsupported-output` are viewer-side.
 */
export type ViewerFailureClass =
  | "rights-denied"
  | "media-invalid"
  | "validation"
  | "resource-limit"
  | "internal"
  | "unknown-session"
  | "unknown-render"
  | "unknown-segment"
  | "compute-unavailable"
  | "unknown-compute-job"
  | "unknown-route"
  | "method-not-allowed"
  | "network"
  | "unsupported-output";

/** Every class the viewer recognizes (used to validate wire classes). */
export const VIEWER_FAILURE_CLASSES: readonly ViewerFailureClass[] = [
  "rights-denied",
  "media-invalid",
  "validation",
  "resource-limit",
  "internal",
  "unknown-session",
  "unknown-render",
  "unknown-segment",
  "compute-unavailable",
  "unknown-compute-job",
  "unknown-route",
  "method-not-allowed",
  "network",
  "unsupported-output",
];

/** Type guard: `true` when `value` is a recognized failure class. */
export function isViewerFailureClass(value: unknown): value is ViewerFailureClass {
  return typeof value === "string" && VIEWER_FAILURE_CLASSES.includes(value as ViewerFailureClass);
}

/**
 * Human labels for the error banner (one per class; test-pinned so the UI
 * never renders an undefined label).
 */
export const FAILURE_CLASS_LABELS: Readonly<Record<ViewerFailureClass, string>> = {
  "rights-denied": "Rights denied",
  "media-invalid": "Invalid render request",
  validation: "Invalid request",
  "resource-limit": "Resource limit",
  internal: "Server error",
  "unknown-session": "Unknown session",
  "unknown-render": "Unknown render",
  "unknown-segment": "Unknown output segment",
  // W914 async-compute classes (additive): 503/404 semantics per the
  // control plane's own CONTROL_HTTP_STATUS mapping.
  "compute-unavailable": "Service unavailable",
  "unknown-compute-job": "Unknown compute job",
  "unknown-route": "Unknown route",
  "method-not-allowed": "Method not allowed",
  network: "Connection failed",
  "unsupported-output": "Output not available",
};

/**
 * The retryability table (documented decision, test-pinned):
 *
 * - `network` — retryable: the connection may recover;
 * - `internal` — retryable: a server-side fault may clear;
 * - `resource-limit` — retryable: limits are transient states;
 * - everything else — NOT retryable: rights/validation/media/unknown classes
 *   require a caller action (change policy, change input, refresh the list)
 *   rather than repeating the same call. This includes the W914
 *   async-compute classes: `compute-unavailable` answers 503 but means the
 *   control plane has NO compute adapter configured (a configuration state,
 *   not a transient fault — repeating the same call cannot fix it), and
 *   `unknown-compute-job` is the 404 family (refresh, not repeat).
 */
export const RETRYABLE_FAILURE_CLASSES: ReadonlySet<ViewerFailureClass> = new Set([
  "network",
  "internal",
  "resource-limit",
]);

/**
 * The typed viewer error. Every viewer port (control client, render-output
 * provider) rejects with this — never a raw control-plane error, never a raw
 * fetch failure. Transport-independent: the in-process adapter maps
 * `ControlApiError` instances onto it; the HTTP adapter maps the wire error
 * body onto it.
 */
export class ViewerControlError extends Error {
  readonly failureClass: ViewerFailureClass;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: ViewerFailureClass,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ViewerControlError";
    this.failureClass = failureClass;
    this.details = details;
  }
}

/** `true` when `value` is a {@link ViewerControlError}. */
export function isViewerControlError(value: unknown): value is ViewerControlError {
  return value instanceof ViewerControlError;
}

/** The error view-model surfaced in every error state (never swallowed). */
export interface ErrorView {
  /** Machine-readable classification (see {@link ViewerFailureClass}). */
  failureClass: ViewerFailureClass;
  /** Human label for the banner (from {@link FAILURE_CLASS_LABELS}). */
  label: string;
  /** The verbatim message from the failing seam. */
  message: string;
  /** Whether repeating the same operation can succeed (see the table above). */
  retryable: boolean;
  /** Which viewer operation failed (e.g. `"connect"`, `"createRender"`). */
  operation: string;
  /** Structured, JSON-safe evidence from the failing seam (never secrets). */
  details: Record<string, unknown>;
}

/** Builds an {@link ErrorView} from classified parts (label + retry from the tables). */
export function toErrorView(
  operation: string,
  failureClass: ViewerFailureClass,
  message: string,
  details: Record<string, unknown> = {},
): ErrorView {
  const view: ErrorView = {
    failureClass,
    label: FAILURE_CLASS_LABELS[failureClass],
    message,
    retryable: RETRYABLE_FAILURE_CLASSES.has(failureClass),
    operation,
    details,
  };
  if (Object.keys(details).length === 0) view.details = {};
  return view;
}

/** Best-effort message for arbitrary thrown values (never throws). */
function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}

/**
 * Normalizes any thrown value into an {@link ErrorView}:
 * {@link ViewerControlError} keeps its class/details; anything else becomes
 * an `internal` view carrying the message — an untyped failure is surfaced,
 * never swallowed.
 */
export function errorViewFrom(operation: string, value: unknown): ErrorView {
  if (isViewerControlError(value)) {
    return toErrorView(operation, value.failureClass, value.message, value.details);
  }
  const message = messageOf(value);
  return toErrorView(
    operation,
    "internal",
    message.length > 0 ? message : "unexpected viewer failure",
    { thrown: typeof value },
  );
}
