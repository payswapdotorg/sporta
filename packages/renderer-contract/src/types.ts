/**
 * Core value types of the renderer plugin contract (W501).
 *
 * Renderers are plugins behind a stable interface
 * (docs/contracts/renderer.md, architecture-lock §5): they consume validated
 * plain documents from `@sporta/contracts` — never live engine internals —
 * and answer requests with an explicit acceptance/rejection union so that
 * refusals carry a machine-readable failure class.
 */
import type { TerminalFailureClass, WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import type { Logger } from "@sporta/observability";

/**
 * What a renderer renders: an immutable SWM snapshot plus the ordered event
 * stream entries to apply after the snapshot watermark. Both are validated
 * plain objects produced upstream — a plugin never receives live engine state.
 */
export interface RenderInput {
  /** The immutable snapshot selected by `RenderRequest.snapshotVersion`. */
  snapshot: WorldSnapshot;
  /** Ordered events since the snapshot watermark (ascending `sequence`). */
  events: WorldEventStreamEntry[];
}

/** `validateRequest` accepted the request. */
export interface RequestAcceptance {
  ok: true;
}

/**
 * `validateRequest` refused the request. `reason` is human-readable evidence;
 * `failureClass` is the machine-readable classification the session layer
 * maps onto terminal failure handling.
 */
export interface RequestRejection {
  ok: false;
  reason: string;
  failureClass: TerminalFailureClass;
}

/** The result of `validateRequest`. */
export type RequestValidation = RequestAcceptance | RequestRejection;

/** Plugin lifecycle and render methods may resolve synchronously or not. */
export type MaybePromise<T> = T | Promise<T>;

/**
 * The metrics seam a host can hand to a plugin. Structural: the
 * `MetricsRegistry` from `@sporta/observability` satisfies it, as does any
 * Prometheus-style registry with get-or-create counters. Renderer-specific
 * metric names (e.g. `render_requests_total`) are agreed between host and
 * plugin; the seam only fixes the shape.
 */
export interface Metrics {
  /** Returns the get-or-create counter handle for `name` (+ optional labels). */
  counter(
    name: string,
    labels?: Record<string, string>,
  ): {
    /** Increments the counter by `n` (default 1). */
    inc(n?: number): void;
  };
}

/**
 * Host-provided context, injected via `RendererPlugin.init`. Every field is
 * optional; an absent seam (or an absent member) means silent no-ops — a
 * plugin must never require observability to function.
 */
export interface RendererContext {
  observability?: {
    /** Structured logger (one JSON line per call; see `@sporta/observability`). */
    logger?: Logger;
    /** Metrics registry seam (see {@link Metrics}). */
    metrics?: Metrics;
  };
}
