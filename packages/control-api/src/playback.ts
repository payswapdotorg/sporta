/**
 * W504 playback access — the render-output store port and result types the
 * control plane consumes (ADDITIVE W701 extension; no existing behavior is
 * touched).
 *
 * The control plane does NOT depend on `@sporta/output-pipeline`: the port
 * below is a STRUCTURAL interface. The W504 store
 * (`@sporta/output-pipeline` `RenderSegmentStore` implementations) satisfies
 * it by structural typing (the same method names and shapes), the same way
 * `MetricsRegistry` satisfies the renderer contract's `Metrics` seam. This
 * keeps the dependency direction one-way: the e2e (in the output-pipeline
 * package, dev-only) wires the real store into `createControlServer`.
 *
 * Error contract: a store implementation may throw its own typed errors
 * carrying a string `failureClass` of `"rights-denied" | "media-invalid" |
 * "resource-limit" | "internal"` (the `TerminalFailureClass` values). The
 * control plane recognizes those STRUCTURALLY ({@link asRenderOutputStoreError})
 * and preserves the class, so a store-side rights denial answers 403 and a
 * store-side limit rejection answers 413 — exactly the existing
 * typed-error → HTTP-status conventions.
 */
import type { AuthorizationPolicy } from "@sporta/contracts";
import { ControlApiError, ControlInternalError, errMessage } from "./errors";

/** Rights context for render-output retrieval (the W701 fail-closed posture). */
export interface PlaybackRightsContext {
  /**
   * The caller-supplied authorization policy for the session (the trust
   * boundary — W701: no user authentication yet). Implementations re-derive
   * the capabilities fail-closed at `nowMs`; without `canStoreDerivatives`
   * retrieval denies BEFORE anything is revealed.
   */
  policy: AuthorizationPolicy;
  /**
   * Evaluation time for the policy derivation (an injected clock value).
   * Implementations must treat a non-finite value as a DENIAL: every expiry
   * comparison against a non-finite time is vacuously false, which would
   * otherwise let an expired policy pass the gate.
   */
  nowMs: number;
}

/** One entry of {@link RenderOutputStore.listSegments}. */
export interface RenderOutputSegmentSummary {
  segmentId: string;
  /** Media type of the segment document (e.g. `image/svg+xml`). */
  contentType: string;
  /** UTF-8 byte length of the segment document. */
  byteLength: number;
  /** Content hash of the segment document (as stored). */
  contentHash: string;
}

/** A full stored render-output segment document. */
export interface RenderOutputSegmentDocument extends RenderOutputSegmentSummary {
  sessionId: string;
  renderId: string;
  segmentId: string;
  /** The encoded segment document text (e.g. the animated SVG source). */
  content: string;
  /** The deterministic container manifest document, VERBATIM (opaque here). */
  manifest: unknown;
}

/** Retrieval query for one exact stored segment. */
export interface RenderOutputRetrieval extends PlaybackRightsContext {
  sessionId: string;
  renderId: string;
  segmentId: string;
}

/** Listing query for all segments stored under one render. */
export interface RenderOutputListQuery extends PlaybackRightsContext {
  sessionId: string;
  renderId: string;
}

/**
 * The render-output store port the control plane consumes (W504). The scope
 * `(sessionId, renderId, segmentId)` is the store's key space; render ids
 * for stored outputs are assigned host-side by the output pipeline (e.g.
 * one id per clip render), and the control plane gates access — it does not
 * interpret manifest contents.
 */
export interface RenderOutputStore {
  /**
   * Fail-closed retrieval: `null` only when the key is absent; a rights
   * denial throws (typed, with `failureClass: "rights-denied"`) before
   * anything is revealed.
   */
  getSegment(input: RenderOutputRetrieval): RenderOutputSegmentDocument | null;
  /**
   * Fail-closed listing (same rights posture): every segment stored under
   * `(sessionId, renderId)`, in insertion order.
   */
  listSegments(input: RenderOutputListQuery): RenderOutputSegmentSummary[];
}

/**
 * W914 (ADDITIVE): the WRITE side of the render-output store — a structural
 * port satisfied by `@sporta/output-pipeline`'s `RenderSegmentStore`
 * (`storeSegment`). The async compute surface stores the artifacts of a
 * completed job's render through this port under the control plane's own
 * render id; absent by default (the sync path never writes, and without a
 * writer the async path's renders are observable but their outputs are not
 * playback-served — exactly like an unconfigured reader store).
 */
export interface RenderOutputWriter {
  /**
   * Stores one encoded segment under `(sessionId, renderId, segmentId)`.
   * May resolve synchronously OR return a promise (async landings — e.g.
   * the R508-R510 derived-reality MP4 registration into the media plane);
   * the control plane awaits the return either way.
   */
  storeSegment(input: {
    sessionId: string;
    renderId: string;
    segment: {
      segmentId: string;
      contentType: string;
      content: string;
      byteLength: number;
      contentHash: string;
      manifest: unknown;
    };
  }): unknown;
}

/** Result of {@link ControlApp.getRenderOutput}. */
export interface RenderOutputDocument {
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentType: string;
  byteLength: number;
  contentHash: string;
  /** The encoded segment document text (e.g. the animated SVG source). */
  content: string;
  /** The deterministic container manifest document, verbatim. */
  manifest: unknown;
}

/** Result of {@link ControlApp.listRenderOutputs}. */
export interface RenderOutputListResult {
  sessionId: string;
  renderId: string;
  segments: RenderOutputSegmentSummary[];
}

/** The failure classes a render-output store may report structurally. */
const STORE_FAILURE_CLASSES = [
  "rights-denied",
  "media-invalid",
  "resource-limit",
  "internal",
] as const;

type StoreFailureClass = (typeof STORE_FAILURE_CLASSES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalizes an error thrown by a render-output store into a typed control
 * error, PRESERVING the store's structural `failureClass` (rights-denied →
 * 403, media-invalid → 400, resource-limit → 413, internal → 500) plus any
 * JSON-safe `details`. Anything unrecognized becomes an `internal` fault —
 * never silent, never a raw leak.
 */
export function asRenderOutputStoreError(err: unknown): ControlApiError {
  if (err instanceof ControlApiError) return err;
  if (isRecord(err)) {
    const failureClass = err.failureClass;
    if (
      typeof failureClass === "string" &&
      (STORE_FAILURE_CLASSES as readonly string[]).includes(failureClass)
    ) {
      const details = isRecord(err.details) ? (err.details as Record<string, unknown>) : {};
      // A structural (non-Error) store failure may carry its message as a
      // plain `message` field — use it when present instead of a useless
      // "[object Object]" stringification.
      const message =
        typeof err.message === "string" && err.message.length > 0 ? err.message : errMessage(err);
      return new ControlApiError(failureClass as StoreFailureClass, message, details, {
        cause: err,
      });
    }
  }
  return new ControlInternalError(
    "render output store failed",
    { message: errMessage(err) },
    { cause: err },
  );
}
