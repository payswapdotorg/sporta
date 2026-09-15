/**
 * The live-output ports (W704): the seams `ViewerCore` consumes for live
 * playback — the typed contract between the headless state machine and a
 * live output transport (W305's contract, structurally).
 *
 * This module is part of the served BROWSER module graph, so it imports
 * ONLY TYPES from `@sporta/webrtc-output` (type-only imports are erased at
 * transpile — the W702 rule: the browser cannot resolve bare `@sporta/*`
 * specifiers, test-enforced in `../test/serve.test.ts`). The runtime
 * composition lives in `./live-client.ts` (the in-process adapter over a
 * REAL W305 `LoopbackLiveOutputTransport` — node-side, exactly like
 * `./control-client.ts`).
 *
 * THE FLOW (one `openLive`):
 *
 * 1. the viewer checks the open session's fail-closed derived rights —
 *    live delivery requires the `liveDelivery` capability; a session
 *    without it never sends a request (the W701 rights surface is real
 *    data; the live host's own gate re-derives at the offer — W305's
 *    fail-closed posture holds on BOTH sides);
 * 2. {@link LiveClient.requestLive} asks the host for an offer, validates
 *    it against W305's zod grammar (typed rejects, never guesses — an
 *    unknown field is a reject, a foreign protocol version is a typed
 *    reject answer, a document that is not offer-shaped is a typed
 *    protocol error), and answers it;
 * 3. on an ACCEPT the host establishes the session and the client returns
 *    the attached {@link LiveStreamHandle} — the consuming surface the
 *    core pulls delivery events from;
 * 4. the core mounts the live player (`./live-player.ts`), drives the
 *    presentation from its injected clock, and reconnects through
 *    `./live-backoff.ts` when the connection drops.
 */
import type {
  LiveDeliveryEvent,
  LiveOutputAnswer,
  LiveOutputFailureClass,
  LiveOutputOffer,
  LiveSessionPhase,
} from "@sporta/webrtc-output";
import type { ViewerFailureClass } from "./errors.ts";

// Re-exported TYPE-ONLY (erased at transpile — the browser-module-graph rule
// holds): the W305 delivery-event shape and failure-class vocabulary are
// part of this port's contract, so the core and the plans type against the
// same names the in-process adapter consumes.
export type {
  LiveDeliveryEvent,
  LiveOutputFailureClass,
  LiveOutputAnswer,
  LiveOutputOffer,
  LiveSessionPhase,
} from "@sporta/webrtc-output";

// ---------------------------------------------------------------------------
// The W305 failure-class map (browser-safe — pure data)
// ---------------------------------------------------------------------------

/**
 * The W305 live failure classes → the viewer error-model classes (documented
 * decision, test-pinned for every class): the user-facing label/retryability
 * come from the viewer class, and the W305 class ALWAYS travels verbatim in
 * `details.liveFailureClass` (the W702 verbatim-evidence pattern — the
 * terminal state names the failure honestly both ways).
 *
 * `rights-denied`/`rights-lapsed` map to the fail-closed rights class (never
 * retryable); `transport-failed` to `network` (retryable — the connection
 * may recover); the negotiation/protocol/integrity verdicts to the honest
 * non-transient classes.
 */
export const LIVE_FAILURE_CLASS_MAP: Readonly<
  Record<LiveOutputFailureClass, ViewerFailureClass>
> = Object.freeze({
  "rights-denied": "rights-denied",
  "rights-lapsed": "rights-denied",
  "transport-failed": "network",
  "negotiation-failed": "unsupported-output",
  "negotiation-violation": "media-invalid",
  "integrity-violation": "media-invalid",
  "protocol-violation": "media-invalid",
});

// ---------------------------------------------------------------------------
// Views (in-package, JSON-safe — what the core + plan layers consume)
// ---------------------------------------------------------------------------

/** The negotiated offer, summarized for the user-facing view (verbatim fields). */
export interface LiveOfferView {
  /** The offer's protocol version, verbatim (e.g. `sporta.live-output/v1`). */
  protocolVersion: string;
  sessionId: string;
  streamId: string;
  /** The number of negotiated tracks (the offer's `tracks.length`). */
  trackCount: number;
  /** The video track's output profile, verbatim. */
  profile: {
    resolution: { w: number; h: number };
    frameRate: number;
    codec: string;
    container: string;
    latencyClass: string;
  } | null;
  /** The session controls, verbatim (the negotiated bounds). */
  sessionControls: {
    backpressurePolicy: string;
    linkCapacity: number;
    retransmitRetention: number;
  };
}

/**
 * The consumer-side live accounting snapshot (W305's never-silent receipts,
 * verbatim counts): the identity `appliedWindows + skippedWindows ===
 * accountedOrdinals` is W305's own test-pinned invariant; this view carries
 * the counts so the viewer's status surface (and the accounting backstop
 * test) can prove it.
 */
export interface LiveAccountingView {
  /** Windows applied exactly once (idempotent application). */
  appliedWindows: number;
  /** Re-deliveries suppressed by the idempotency key (counted duplicates). */
  duplicateWindows: number;
  /** Ordinals the stream accounted as skipped (stale/evicted/reconnect-gap). */
  skippedWindows: number;
  /** Every ordinal accounted for this viewer (applied + skipped). */
  accountedOrdinals: number;
  /** The last applied delivery ordinal (`null` before the first). */
  lastAppliedOrdinal: number | null;
}

/** The honest live-state snapshot (W305's `LiveViewerStatus`, structural). */
export interface LiveStreamStatusView {
  phase: LiveSessionPhase;
  /** Whether THIS viewer connection is currently live. */
  connected: boolean;
  /** Why the session is degraded (empty when established). */
  degradationReasons: readonly string[];
  /** Link depth right now (queued frame windows — the buffer-depth seam). */
  bufferDepth: number;
  /**
   * Protocol-clock latency of the newest applied window (`now −
   * window.emittedAtMs`, the shared INJECTED clock domain — comparable with
   * W306's stage latencies). `null` before the first application: absent
   * metrics stay absent, never a faked latency. Real network latency
   * measurement is W306's; SLO formalization is W802's.
   */
  latencyToLatestWindowMs: number | null;
  /**
   * Media-time lag of the newest applied window (newest observed watermark
   * − applied watermark — clock-independent media milliseconds). `null`
   * before the first application.
   */
  mediaLagMs: number | null;
  /** The terminal session outcome, when the session has ended. */
  terminal: { outcome: "completed" | "stopped" | "failed"; failureClass?: string } | null;
  accounting: LiveAccountingView;
}

/** The report of one reconnect (W305's `LiveReconnectReport`, structural). */
export interface LiveReconnectReportView {
  /** The ordinal the viewer resumed from. */
  resumeFromOrdinal: number;
  /** Windows re-delivered from the retention buffer. */
  replayCount: number;
  /** Ordinals skipped because the resume point is older than retention. */
  gapSkipped: number;
}

// ---------------------------------------------------------------------------
// The ports
// ---------------------------------------------------------------------------

/**
 * The attached live stream: the consuming surface. `nextEvent` is
 * viewer-driven backpressure — the pull is the only thing that drains the
 * bounded link (W305's design). Deterministic consumption: one pull at a
 * time; the terminal `connection-lost` event ENDS the current pull stream
 * (a reconnect opens the next one).
 */
export interface LiveStreamHandle {
  /**
   * Pulls the next delivery event in order. Resolves `null` when no stream
   * is currently consumable — the connection is lost awaiting a reconnect,
   * or the session is terminally closed (the core knows which from the
   * events it already applied; `null` is never a silent skip — it is the
   * typed "not consumable now" answer).
   */
  nextEvent(): Promise<LiveDeliveryEvent | null>;
  /** The honest live-state snapshot (see {@link LiveStreamStatusView}). */
  status(): LiveStreamStatusView;
  /**
   * Reconnects from a resume ordinal: retained windows at or after the
   * resume point are re-delivered (idempotent re-application — counted
   * duplicates); a resume point older than the retention covers surfaces a
   * counted `reconnect-gap` (never a silent skip).
   */
  reconnect(resumeFromOrdinal: number): LiveReconnectReportView;
  /**
   * Disconnects this viewer connection (the transport surfaces
   * `connection-lost` on the active pull; the stream becomes
   * reconnectable). Idempotent.
   */
  disconnect(): void;
}

/** The typed result of one accepted live open (see {@link LiveClient}). */
export interface LiveAttached {
  /** The consuming stream handle (established session, connected). */
  stream: LiveStreamHandle;
  /** The validated offer, summarized verbatim for the view. */
  offer: LiveOfferView;
  /** The accept answer document (the negotiation evidence). */
  answer: LiveOutputAnswer;
  /** The viewer endpoint id that answered the offer. */
  viewerId: string;
}

/**
 * The live client port: opens ONE live stream for a session. The adapter
 * (`./live-client.ts`, in-process over a REAL W305 transport) runs the full
 * negotiation — request the offer (the host's fail-closed `canDeliverLive`
 * gate throws a typed rights error without it), validate + decide via W305's
 * zod grammar, submit the answer, connect the consuming session. Failures
 * reject with the viewer's typed {@link ViewerControlError} carrying the
 * mapped class with the W305 class verbatim in `details.liveFailureClass`
 * (the W702 verbatim-evidence pattern).
 */
export interface LiveClient {
  /** The raw offer document (W305's `LiveOutputOffer` shape after validation). */
  requestLive(sessionId: string): Promise<LiveAttached>;
}

/** Convenience alias: the W305 offer type, re-exported for the adapter docs. */
export type LiveOfferDocument = LiveOutputOffer;
