/**
 * The live output transport CONTRACT (W305): typed, versioned, zod-validated
 * protocol documents plus the never-silent accounting vocabulary.
 *
 * WORK-ITEM HONESTY (the W301 precedent, applied at the output boundary):
 * "live rendered output is viewable end-to-end in supported browsers" is
 * delivered here as the **transport contract + a deterministic in-process
 * loopback implementation + the viewer-side consumption seams**. A REAL
 * WebRTC stack (SDP/ICE/DTLS/SRTP plus a browser) is not implementable under
 * this monorepo's zero-external-runtime-dependency and vendor-neutrality
 * rules (architecture-lock §9); the protocol documents below are the
 * WebRTC-shaped negotiation/delivery vocabulary a real implementation
 * satisfies behind the same seams — exactly how W301 delivered "supported
 * live input" as `LiveSource` + a fixture feed without claiming RTMP/SRT.
 *
 * THE MASTER ACCOUNTING INVARIANT (the W305 formula — "delivered = emitted −
 * dropped-by-policy − failed, exact, fail-loud"), runtime-asserted at every
 * settle (an imbalance REJECTS the settle promise instead of returning a
 * lying result — the W301/W302/W303/W304 fail-loud posture):
 *
 *   `windowsIn === windowsDelivered + windowsSkippedStale +
 *                  windowsDroppedByPolicy + windowsRefused +
 *                  windowsAbandoned + windowsFailed + windowsInFlight`
 *
 * (`windowsInFlight` is 0 at every settle — a drain-close waits for the
 * consumer; a cancel-close abandons everything unresolved.) Split into two
 * exact, independently-mutatable receipt/terminal checks (§
 * {@link assertLiveOutputAccounting}):
 *
 * 1. `windowsIn === receiptsAdmitted + receiptsSkippedStale +
 *    receiptsRefused + receiptsAbandoned` — every `sendWindow` call resolves
 *    to EXACTLY one receipt kind;
 * 2. `receiptsAdmitted === windowsDelivered + windowsSkippedStaleAtDequeue +
 *    windowsDroppedByPolicy + windowsFailed + windowsInFlight +
 *    windowsAbandonedFromLink` — every window admitted to the link lands in
 *    exactly ONE terminal bucket (or is still in flight).
 *
 * Malformed send documents are REFUSED at the door with typed errors and
 * counted `windowsRejectedInvalid` — they never enter `windowsIn` (the ledger
 * tracks accepted-for-transport windows only; protocol garbage never joins
 * the delivery accounting).
 *
 * Constitution: no wall-clock reads (the only clock is the injected
 * {@link LiveOutputClock}), no `Math.random`, no real network, no real
 * WebRTC stack — zero external runtime dependencies besides the already
 * locked `zod` (the same validation library `@sporta/contracts` is built
 * on) and workspace packages.
 */
import { z } from "zod";
import { OutputProfile, Watermark } from "@sporta/contracts";

// ---------------------------------------------------------------------------
// Protocol identity
// ---------------------------------------------------------------------------

/** The live-output protocol version this package speaks (wire vocabulary v1). */
export const LIVE_OUTPUT_PROTOCOL_VERSION = "sporta.live-output/v1" as const;

/** zod literal for the protocol version field on every wire document. */
export const LiveOutputProtocolVersion = z.literal(LIVE_OUTPUT_PROTOCOL_VERSION);

/** 64 lowercase hex digits (the sha-256 content-hash shape, W504 posture). */
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex digits");

// ---------------------------------------------------------------------------
// Session negotiation documents (offer / answer)
// ---------------------------------------------------------------------------

/**
 * The transport-level backpressure policy, declared in the offer (the W104
 * mechanism vocabulary: `block`/`reject`/`drop-oldest` — the same primitive
 * `@sporta/transport`'s BoundedChannel enforces; the contract-level policies
 * of `docs/contracts/streaming.md` map onto these exactly as in W104).
 */
export const LiveBackpressurePolicy = z.enum(["block", "reject", "drop-oldest"]);
export type LiveBackpressurePolicy = z.infer<typeof LiveBackpressurePolicy>;

/** Track kinds the v1 protocol carries. Video only — audio is future work. */
export const LiveTrackKind = z.enum(["video"]);
export type LiveTrackKind = z.infer<typeof LiveTrackKind>;

/**
 * One negotiated track: the codec/profile declaration, carried VERBATIM from
 * the renderer's output profile (the host renders under an `OutputProfile`;
 * the offer declares it; every delivered frame window must match it —
 * a mismatch is a typed `negotiation-violation`).
 */
export const LiveOutputTrackDescriptor = z.object({
  trackId: z.string().min(1),
  kind: LiveTrackKind,
  profile: OutputProfile,
});
export type LiveOutputTrackDescriptor = z.infer<typeof LiveOutputTrackDescriptor>;

/** The offer's session-control declarations (bounded, never-silent posture). */
export const LiveOutputSessionControls = z.object({
  /** The link's bounded backpressure policy (W104 vocabulary). */
  backpressurePolicy: LiveBackpressurePolicy,
  /** Link capacity in frame windows (>= 1). */
  linkCapacity: z.number().int().min(1),
  /** Link payload-byte budget (>= 0), when configured. */
  maxLinkBytes: z.number().int().min(0).nullable(),
  /**
   * Skip-stale degradation threshold in media-time milliseconds: frame
   * windows whose watermark lags the newest observed watermark by MORE than
   * this are skipped — counted, logged, metered, original watermark
   * preserved. `null` disables the policy (the honest baseline: nothing is
   * skipped; the bounded link's own policy is the only protection).
   */
  maxWatermarkLagMs: z.number().gt(0).nullable(),
  /** Delivered windows retained for reconnect re-delivery (bounded, >= 0). */
  retransmitRetention: z.number().int().min(0),
});
export type LiveOutputSessionControls = z.infer<typeof LiveOutputSessionControls>;

/**
 * The session negotiation offer (the SDP-analog, vendor-neutral): the host's
 * declared session identity, tracks, and controls. Purely declarative —
 * admission decisions never depend on it alone (rights are re-derived
 * fail-closed at the host gate; payload validity is checked per window).
 */
export const LiveOutputOffer = z.object({
  protocolVersion: LiveOutputProtocolVersion,
  sessionId: z.string().min(1),
  streamId: z.string().min(1),
  tracks: z.array(LiveOutputTrackDescriptor).min(1),
  sessionControls: LiveOutputSessionControls,
  /** Injected-protocol-clock reading when the offer was minted. */
  offeredAtMs: z.number(),
});
export type LiveOutputOffer = z.infer<typeof LiveOutputOffer>;

/** Typed reasons a viewer endpoint may reject an offer. */
export const LiveOutputRejectionReason = z.enum([
  "unsupported-protocol-version",
  "no-video-track",
  "unsupported-codec",
  "unsupported-latency-class",
  "viewer-unavailable",
]);
export type LiveOutputRejectionReason = z.infer<typeof LiveOutputRejectionReason>;

/**
 * The session negotiation answer (accept or typed reject). An accept echoes
 * the protocol version (version mismatch is a typed reject, never a
 * downgrade).
 */
export const LiveOutputAnswer = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("accept"),
    protocolVersion: LiveOutputProtocolVersion,
    viewerId: z.string().min(1),
    /** Injected-protocol-clock reading when the answer was minted. */
    acceptedAtMs: z.number(),
  }),
  z.object({
    kind: z.literal("reject"),
    reason: LiveOutputRejectionReason,
    rejectedAtMs: z.number(),
  }),
]);
export type LiveOutputAnswer = z.infer<typeof LiveOutputAnswer>;

// ---------------------------------------------------------------------------
// Frame window documents (the delivery unit)
// ---------------------------------------------------------------------------

/**
 * One frame descriptor: the transport-level view of one rendered frame. The
 * presentation timestamp is the payload's OWN `outputTimestampMs`, copied
 * VERBATIM — never re-stamped (the W301 timestamps-verbatim rule; presentation
 * timing is derived from the payloads' own timestamps, never from any clock).
 */
export const LiveFrameDescriptor = z.object({
  frameIndex: z.number().int().min(0),
  /** The payload frame's own output timestamp (media timeline, verbatim). */
  presentationTimestampMs: z.number().min(0),
  /** UTF-8 byte length of the frame document. */
  byteSize: z.number().int().min(0),
  /** sha-256 of the frame document's UTF-8 bytes (64 lowercase hex). */
  contentHash: Sha256Hex,
});
export type LiveFrameDescriptor = z.infer<typeof LiveFrameDescriptor>;

/**
 * The frame window's provenance: the W304 emission provenance, VERBATIM (the
 * transport never rewrites renderer identity, batch identity, or source
 * watermarks — end-to-end provenance is the acceptance core).
 */
export const LiveWindowProvenance = z.object({
  sessionId: z.string().min(1),
  batchId: z.string().min(1),
  batchOrdinal: z.number().int().min(0),
  sourceWatermark: Watermark,
  jobId: z.string().min(1),
  rendererId: z.string().min(1),
  rendererVersion: z.string().min(1),
});
export type LiveWindowProvenance = z.infer<typeof LiveWindowProvenance>;

/**
 * One frame window: the ordered delivery unit (the emission shape of W304 —
 * one rendered output = one frame window). The idempotency key
 * (`windowId`) is derived from the source watermark: the same watermark
 * NEVER double-delivers — a re-delivery is a counted duplicate at the viewer
 * (the streaming contract's Recovery rule).
 */
export const LiveFrameWindow = z.object({
  protocolVersion: LiveOutputProtocolVersion,
  streamId: z.string().min(1),
  sessionId: z.string().min(1),
  /** Delivery sequence over ADMITTED windows: contiguous, strictly increasing. */
  ordinal: z.number().int().min(0),
  /** The idempotency key (`liveout-<stream>-wm-<ms>-seq-<seq>`). */
  windowId: z.string().min(1),
  /** The source render output's watermark, VERBATIM. */
  watermark: Watermark,
  frames: z.array(LiveFrameDescriptor).min(1),
  frameCount: z.number().int().min(1),
  /** Sum of frame byte sizes (the link sizer's evidence). */
  byteSize: z.number().int().min(0),
  /** sha-256 over the ordered frame documents' UTF-8 bytes, concatenated. */
  contentHash: Sha256Hex,
  /** The profile this window was rendered under (must match the track). */
  profile: OutputProfile,
  provenance: LiveWindowProvenance,
  /**
   * Host-declared emission timestamp (injected protocol clock) — the
   * viewer-side latency surface derives `now − emittedAtMs` from it.
   */
  emittedAtMs: z.number(),
});
export type LiveFrameWindow = z.infer<typeof LiveFrameWindow>;

// ---------------------------------------------------------------------------
// The payload seam (structural, moved VERBATIM)
// ---------------------------------------------------------------------------

/** One rendered frame document (the W502 frame shape, structural). */
export const LiveFrameDocument = z.object({
  frameIndex: z.number().int().min(0),
  outputTimestampMs: z.number().min(0),
  svg: z.string().min(1),
});
export type LiveFrameDocument = z.infer<typeof LiveFrameDocument>;

/**
 * The wire-validation schema for a render output payload (unknown extra
 * manifest fields are passed through at runtime, never rejected).
 */
export const LiveOutputPayload = z.object({
  frames: z.array(LiveFrameDocument).min(1),
  manifest: z
    .object({
      renderer: z.object({ rendererId: z.string().min(1), rendererVersion: z.string().min(1) }),
      output: z.object({
        profile: OutputProfile,
        startMs: z.number().min(0),
        frameIntervalMs: z.number().gt(0),
        durationMs: z.number().min(0),
      }),
    })
    .passthrough(),
});

/**
 * The STRUCTURAL payload seam (hand-written, like `LiveOutputEmission`
 * below): a real W502 `AnimeRenderOutput` — and therefore every W304
 * `RenderOutputRecord.output` — satisfies this shape STRUCTURALLY at the
 * type level too (the zod-inferred `.passthrough()` type carries an index
 * signature that concrete interfaces like `AnimeClipManifest` can never
 * satisfy, which would make the documented adapter seam a lie). Unknown
 * extra fields (`result`, the full manifest table, …) are carried VERBATIM
 * by reference — the transport moves the payload object itself, never a
 * rebuild, so they survive regardless of the static type. Keep this
 * interface and {@link LiveOutputPayload} (the schema above) in agreement:
 * the schema's declared fields are exactly the interface's.
 */
export interface LiveOutputPayload {
  frames: LiveFrameDocument[];
  manifest: {
    renderer: { rendererId: string; rendererVersion: string };
    output: {
      profile: OutputProfile;
      startMs: number;
      frameIntervalMs: number;
      durationMs: number;
    };
  };
}

/**
 * One frame window envelope: the protocol document plus the payload it
 * describes, moving together through the link (metadata is validated and
 * hashed; the payload is moved verbatim by reference).
 */
export interface LiveFrameWindowEnvelope {
  window: LiveFrameWindow;
  payload: LiveOutputPayload;
}

/**
 * The structural intake shape for the adapter (W304's `RenderOutputRecord`
 * satisfies it: `output` is a payload-shaped render output, `provenance`
 * carries the emission provenance; extra fields are structurally allowed).
 */
export interface LiveOutputEmission {
  output: LiveOutputPayload;
  provenance: {
    sessionId: string;
    batchId: string;
    batchOrdinal: number;
    sourceWatermark: Watermark;
    jobId: string;
    rendererId: string;
    rendererVersion: string;
  };
}

// ---------------------------------------------------------------------------
// Typed failure classes + terminal outcomes
// ---------------------------------------------------------------------------

/**
 * Classification of live-output session failures (this package's protocol
 * vocabulary; the media-session lifecycle's own `TerminalFailureClass` is
 * reported by the host and stays separate).
 */
export const LiveOutputFailureClass = z.enum([
  /** The viewer endpoint rejected the offer / the answer rejected the session. */
  "negotiation-failed",
  /** A delivered window violates the negotiated track profile. */
  "negotiation-violation",
  /** Recomputed content hashes do not match the declared ones. */
  "integrity-violation",
  /** Malformed documents, illegal transitions, in-order violations. */
  "protocol-violation",
  /** The underlying transport died (fixtures simulate; hosts may report). */
  "transport-failed",
  /** The authorization policy lapsed mid-stream (fail-closed, loud). */
  "rights-lapsed",
  /** Live delivery was attempted without `canDeliverLive`. */
  "rights-denied",
]);
export type LiveOutputFailureClass = z.infer<typeof LiveOutputFailureClass>;

/** The terminal outcome vocabulary for a settled live output session. */
export const LiveSessionOutcomeKind = z.enum(["completed", "stopped", "failed"]);
export type LiveSessionOutcomeKind = z.infer<typeof LiveSessionOutcomeKind>;

/**
 * Why a frame window was never delivered (machine reasons, one per
 * non-delivered admitted window — every reason counted + logged + metered).
 */
export type LiveWindowDisposition =
  | "delivered"
  | "skipped-stale"
  | "dropped-by-policy"
  | "refused"
  | "abandoned"
  | "failed"
  | "in-flight";

// ---------------------------------------------------------------------------
// Clock + limits
// ---------------------------------------------------------------------------

/**
 * The injectable protocol clock (the ONLY time source in this package; a
 * shared clock domain keeps W306's per-stage latency measurements comparable
 * across stages — e.g. the W303 `VirtualGpuClock` satisfies this
 * structurally, so one domain can drive the whole pipeline).
 */
export interface LiveOutputClock {
  /** Current protocol-clock reading (milliseconds). */
  now(): number;
}

/**
 * A deterministic manual clock: time moves ONLY when a fixture advances it
 * (the constitution's injectable-clock rule; no wall-clock reads anywhere).
 */
export class ManualLiveClock implements LiveOutputClock {
  private currentMs: number;

  constructor(startMs: number = 0) {
    if (!Number.isFinite(startMs)) {
      throw new RangeError(`ManualLiveClock start time must be finite (got ${String(startMs)})`);
    }
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  /** Advances virtual time by `ms` (finite, >= 0; loud on violation). */
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`ManualLiveClock.advance requires a finite duration >= 0`);
    }
    this.currentMs += ms;
  }

  /** Moves virtual time to the absolute reading `untilMs` (never backwards). */
  advanceTo(untilMs: number): void {
    if (!Number.isFinite(untilMs)) {
      throw new RangeError(`ManualLiveClock.advanceTo requires a finite target`);
    }
    if (untilMs < this.currentMs) {
      throw new RangeError(
        `ManualLiveClock.advanceTo cannot move time backwards (${String(untilMs)} < ${String(this.currentMs)})`,
      );
    }
    this.currentMs = untilMs;
  }
}

/** Resource bounds for one live output session (all bounded, all loud). */
export interface LiveOutputLimits {
  /** Link capacity in frame windows (integer >= 1). */
  linkCapacity: number;
  /** Link payload-byte budget (`null` = no byte budget). */
  maxLinkBytes: number | null;
  /** Retained delivered windows for reconnect re-delivery (>= 0). */
  retransmitRetention: number;
  /** Skip-stale threshold in media-time ms (`null` = disabled). */
  maxWatermarkLagMs: number | null;
  /** Hard session ceiling on counted sends (loud `session-limit` refusals). */
  maxWindowsInSession: number;
}

/** The default limits (the honest baseline: degradation DISABLED). */
export const DEFAULT_LIVE_OUTPUT_LIMITS: LiveOutputLimits = Object.freeze({
  linkCapacity: 16,
  maxLinkBytes: 1_048_576,
  retransmitRetention: 8,
  maxWatermarkLagMs: null,
  maxWindowsInSession: 10_000,
});

// ---------------------------------------------------------------------------
// Receipts (the host-side send contract)
// ---------------------------------------------------------------------------

/** Typed refusal classes (policy outcomes — loud, never silent, not faults). */
export type LiveSendRefusalClass = "resource-limit" | "rights" | "session-limit" | "session-closed";

/** The receipt returned by one `sendWindow` call (exactly one kind). */
export type LiveWindowSendReceipt =
  | {
      kind: "admitted";
      /** The assigned delivery ordinal (contiguous over admitted windows). */
      ordinal: number;
      windowId: string;
      /** Protocol-clock reading when the send resolved (post-park under block). */
      admittedAtMs: number;
    }
  | {
      kind: "skipped-stale";
      windowId: string;
      /** Measured lag at the skip decision (head watermark − window watermark). */
      lagMs: number;
      /** The stream-head watermark at decision time (evidence, verbatim). */
      head: Watermark;
    }
  | {
      kind: "refused";
      windowId: string;
      refusalClass: LiveSendRefusalClass;
      /** Structured details (typed, JSON-safe — see `LiveSendRefusalDetails`). */
      details: LiveSendRefusalDetails;
    }
  | {
      /**
       * The drop-oldest byte-budget outcome: the policy dropped the INCOMING
       * window itself (a window that can never fit the byte budget — W104
       * verbatim, accounted, never silently buffered).
       */
      kind: "dropped";
      windowId: string;
      reason: "exceeds-byte-budget";
    }
  | {
      kind: "abandoned";
      windowId: string;
      /** Why the send was abandoned (closed-under while parked under block). */
      reason: "closed-under";
    };

/** Structured, JSON-safe refusal details (the W104 `ResourceLimitError` shape). */
export interface LiveSendRefusalDetails {
  policy: LiveBackpressurePolicy;
  capacity: number;
  size: number;
  maxBytes?: number;
  byteSize: number;
  attemptedBytes?: number;
}

// ---------------------------------------------------------------------------
// Delivery events (the viewer-side stream contract)
// ---------------------------------------------------------------------------

/**
 * One item from the viewer session's delivery stream. Every ADMITTED ordinal
 * appears EXACTLY ONCE in the stream — as a `window` or an accounted
 * `window-skipped` — in ordinal order; the consumer-side identity
 * `streamEvents === admittedOrdinals` is test-pinned (never-silent at the
 * consumer too: the viewer sees exactly what the transport did).
 */
export type LiveDeliveryEvent =
  | {
      kind: "window";
      window: LiveFrameWindow;
      /** The payload, VERBATIM (by reference — never rebuilt). */
      payload: LiveOutputPayload;
      /** `true` when re-delivered from the reconnect retention buffer. */
      redelivered: boolean;
      /** The transport-measured timing record for this delivery. */
      timing: LiveDeliveryTiming;
    }
  | {
      /** An admitted window the transport did not deliver (accounted inline). */
      kind: "window-skipped";
      ordinal: number;
      windowId: string;
      /** The skipped window's original watermark, VERBATIM (never re-stamped). */
      watermark: Watermark;
      /** `skipped-stale` (degradation) or `link-evicted` (capacity policy). */
      reason: "skipped-stale" | "link-evicted";
      /** Measured media-time lag for stale skips (absent for evictions). */
      lagMs?: number;
    }
  | {
      /** A reconnect retention gap: ordinals the viewer will never receive. */
      kind: "reconnect-gap";
      fromOrdinal: number;
      toOrdinal: number;
      skippedCount: number;
    }
  | {
      /** The viewer's connection was lost; the iterator ends (reconnectable). */
      kind: "connection-lost";
    }
  | {
      /** The session ended terminally; the iterator ends after this event. */
      kind: "session-closed";
      outcome: LiveSessionOutcomeKind;
      failureClass?: LiveOutputFailureClass;
    };

/** Transport-measured timing for one delivered window (injected clock). */
export interface LiveDeliveryTiming {
  /** Protocol-clock reading at `sendWindow` call time. */
  emittedAtMs: number;
  /** Protocol-clock reading at link admission (post-park under `block`). */
  admittedAtMs: number;
  /** Protocol-clock reading at verified hand-over to the viewer. */
  deliveredAtMs: number;
  /** `deliveredAtMs − admittedAtMs` (the link's transit latency, measured). */
  transitLagMs: number;
  /** `deliveredAtMs − emittedAtMs` (emission→delivery latency, measured). */
  deliveryLagMs: number;
  /** Link depth (queued windows) at the emission of this window. */
  linkDepthAtEmission: number;
  /** Media-time lag at delivery: newest observed watermark − this watermark. */
  watermarkLagAtDeliveryMs: number;
}

// ---------------------------------------------------------------------------
// Stats + balance assertions
// ---------------------------------------------------------------------------

/**
 * The live output session ledger (the never-silent proof). See the module
 * doc for the master identity and its two exact sub-identities.
 *
 * Receipt kinds (every `sendWindow` call that returns resolves to EXACTLY
 * one): `receiptsAdmitted + receiptsSkippedStale + receiptsRefused +
 * receiptsDropped + receiptsAbandoned === windowsIn`. `receiptsDropped` is
 * the drop-oldest byte-budget case where the policy drops the INCOMING
 * window (W104 verbatim); admitted-then-evicted windows are counted
 * `windowsLinkEvicted`.
 */
export interface LiveOutputStats {
  /** `sendWindow` calls that resolved with a receipt. */
  windowsIn: number;
  /** Receipts of each kind (their sum is EXACTLY `windowsIn`). */
  receiptsAdmitted: number;
  receiptsSkippedStale: number;
  receiptsRefused: number;
  receiptsDropped: number;
  receiptsAbandoned: number;
  /** Refusals by class (their sum is EXACTLY `receiptsRefused`). */
  refusalsByClass: Record<LiveSendRefusalClass, number>;
  /** Malformed send documents refused at the door (typed throws, loud). */
  windowsRejectedInvalid: number;
  /** Terminal dispositions of ADMITTED windows. */
  windowsDelivered: number;
  windowsSkippedStaleAtDequeue: number;
  /** Admitted windows evicted from the link by the capacity policy. */
  windowsLinkEvicted: number;
  windowsFailed: number;
  windowsAbandonedFromLink: number;
  /** Admitted windows not yet terminal (0 at every settle). */
  windowsInFlight: number;
  /** Headline roll-ups (maintained on every mutation, deep-equal-stable). */
  windowsSkippedStale: number;
  windowsDroppedByPolicy: number;
  windowsAbandoned: number;
  /** Re-deliveries handed to the viewer from the retention buffer. */
  windowsRedelivered: number;
  /** Retention-buffer evictions (bounded memory, counted + logged). */
  retentionEvictions: number;
  /** Retention-gap ordinals surfaced at reconnect (never silently skipped). */
  windowsSkippedAtReconnect: number;
  /** Replay entries discarded at a cancel-close (counted, logged). */
  replaysDiscardedAtClose: number;
  /** Viewer connections established (initial connect + reconnects). */
  viewerConnections: number;
  viewerDisconnects: number;
  /** Frame/frame-byte accounting over delivered vs lost windows. */
  framesDelivered: number;
  framesDropped: number;
  bytesDelivered: number;
  bytesDropped: number;
  /** The phase machine's transitions, keyed `"from->to"`. */
  stateTransitions: Record<string, number>;
  /** Observed maxima (the W306 seams). */
  maxLinkDepth: number;
  maxTransitLagMs: number;
  maxDeliveryLagMs: number;
  maxWatermarkLagAtDeliveryMs: number;
}

/** A fresh zeroed stats document (the exact mutation base). */
export function emptyLiveStats(): LiveOutputStats {
  return {
    windowsIn: 0,
    receiptsAdmitted: 0,
    receiptsSkippedStale: 0,
    receiptsRefused: 0,
    receiptsDropped: 0,
    receiptsAbandoned: 0,
    refusalsByClass: {
      "resource-limit": 0,
      rights: 0,
      "session-limit": 0,
      "session-closed": 0,
    },
    windowsRejectedInvalid: 0,
    windowsDelivered: 0,
    windowsSkippedStaleAtDequeue: 0,
    windowsLinkEvicted: 0,
    windowsFailed: 0,
    windowsAbandonedFromLink: 0,
    windowsInFlight: 0,
    windowsSkippedStale: 0,
    windowsDroppedByPolicy: 0,
    windowsAbandoned: 0,
    windowsRedelivered: 0,
    retentionEvictions: 0,
    windowsSkippedAtReconnect: 0,
    replaysDiscardedAtClose: 0,
    viewerConnections: 0,
    viewerDisconnects: 0,
    framesDelivered: 0,
    framesDropped: 0,
    bytesDelivered: 0,
    bytesDropped: 0,
    stateTransitions: {},
    maxLinkDepth: 0,
    maxTransitLagMs: 0,
    maxDeliveryLagMs: 0,
    maxWatermarkLagAtDeliveryMs: 0,
  };
}

/**
 * The never-silent balance assertion. Throws a descriptive `Error` (never
 * returns a boolean lie) on ANY imbalance between the receipt ledger and the
 * terminal dispositions. Invoked at every settle; an imbalance rejects the
 * settle promise instead of producing a result.
 */
export function assertLiveOutputAccounting(stats: LiveOutputStats): void {
  const refusalSum =
    stats.refusalsByClass["resource-limit"] +
    stats.refusalsByClass["rights"] +
    stats.refusalsByClass["session-limit"] +
    stats.refusalsByClass["session-closed"];
  const receipts =
    stats.receiptsAdmitted +
    stats.receiptsSkippedStale +
    stats.receiptsRefused +
    stats.receiptsDropped +
    stats.receiptsAbandoned;
  const admittedTerminal =
    stats.windowsDelivered +
    stats.windowsSkippedStaleAtDequeue +
    stats.windowsLinkEvicted +
    stats.windowsFailed +
    stats.windowsAbandonedFromLink +
    stats.windowsInFlight;
  const master =
    stats.windowsDelivered +
    stats.windowsSkippedStale +
    stats.windowsDroppedByPolicy +
    stats.receiptsRefused +
    stats.windowsAbandoned +
    stats.windowsFailed +
    stats.windowsInFlight;
  if (stats.windowsIn !== receipts) {
    throw new Error(
      `live output receipt imbalance: windowsIn ${stats.windowsIn} != ` +
        `admitted ${stats.receiptsAdmitted} + skippedStale ${stats.receiptsSkippedStale} + ` +
        `refused ${stats.receiptsRefused} + dropped ${stats.receiptsDropped} + ` +
        `abandoned ${stats.receiptsAbandoned} (= ${receipts})`,
    );
  }
  if (stats.receiptsRefused !== refusalSum) {
    throw new Error(
      `live output refusal-class imbalance: refused ${stats.receiptsRefused} != ` +
        `by-class sum ${refusalSum}`,
    );
  }
  if (stats.receiptsAdmitted !== admittedTerminal) {
    throw new Error(
      `live output admitted-terminal imbalance: admitted ${stats.receiptsAdmitted} != ` +
        `delivered ${stats.windowsDelivered} + skippedStaleDequeue ${stats.windowsSkippedStaleAtDequeue} + ` +
        `linkEvicted ${stats.windowsLinkEvicted} + failed ${stats.windowsFailed} + ` +
        `abandonedFromLink ${stats.windowsAbandonedFromLink} + inFlight ${stats.windowsInFlight} ` +
        `(= ${admittedTerminal})`,
    );
  }

  if (
    stats.windowsSkippedStale !==
    stats.receiptsSkippedStale + stats.windowsSkippedStaleAtDequeue
  ) {
    throw new Error(
      `live output skip roll-up imbalance: windowsSkippedStale ${stats.windowsSkippedStale} != ` +
        `receipts ${stats.receiptsSkippedStale} + dequeue ${stats.windowsSkippedStaleAtDequeue}`,
    );
  }
  if (stats.windowsDroppedByPolicy !== stats.windowsLinkEvicted + stats.receiptsDropped) {
    throw new Error(
      `live output drop roll-up imbalance: windowsDroppedByPolicy ${stats.windowsDroppedByPolicy} != ` +
        `linkEvicted ${stats.windowsLinkEvicted} + incomingDropped ${stats.receiptsDropped}`,
    );
  }
  if (stats.windowsAbandoned !== stats.receiptsAbandoned + stats.windowsAbandonedFromLink) {
    throw new Error(
      `live output abandon roll-up imbalance: windowsAbandoned ${stats.windowsAbandoned} != ` +
        `receipts ${stats.receiptsAbandoned} + fromLink ${stats.windowsAbandonedFromLink}`,
    );
  }
  if (stats.windowsIn !== master) {
    throw new Error(
      `live output master imbalance: windowsIn ${stats.windowsIn} != ` +
        `delivered ${stats.windowsDelivered} + skippedStale ${stats.windowsSkippedStale} + ` +
        `dropped ${stats.windowsDroppedByPolicy} + refused ${stats.receiptsRefused} + ` +
        `abandoned ${stats.windowsAbandoned} + failed ${stats.windowsFailed} + ` +
        `inFlight ${stats.windowsInFlight} (= ${master})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Metric vocabulary (the observability surface)
// ---------------------------------------------------------------------------

/** The settled session result (only minted after the balance assert holds). */
export interface LiveSessionResult {
  streamId: string;
  sessionId: string;
  phase: "closed";
  outcome: LiveSessionOutcomeKind;
  failureClass?: LiveOutputFailureClass;
  /** The failure message for failed sessions (absent otherwise). */
  failureMessage?: string;
  stats: LiveOutputStats;
  /** The transport-side per-window timing records (the W306 seam). */
  telemetry: ReadonlyArray<import("./telemetry").LiveWindowTimingRecord>;
  /** `true` by construction: the settle asserts the balance BEFORE minting. */
  balanced: true;
}

/** The metric names this boundary emits (the W306 data vocabulary). */
export const LIVE_OUTPUT_METRIC_NAMES = {
  windowsIn: "live_output_windows_in_total",
  windowsDelivered: "live_output_windows_delivered_total",
  windowsSkippedStale: "live_output_windows_skipped_stale_total",
  windowsDroppedByPolicy: "live_output_windows_dropped_by_policy_total",
  windowsRefused: "live_output_windows_refused_total",
  windowsAbandoned: "live_output_windows_abandoned_total",
  windowsFailed: "live_output_windows_failed_total",
  windowsRedelivered: "live_output_windows_redelivered_total",
  windowsSkippedAtReconnect: "live_output_windows_skipped_at_reconnect_total",
  viewerReconnects: "live_output_viewer_reconnects_total",
  stateTransitions: "live_output_state_transitions_total",
  sessionEnds: "live_output_session_ends_total",
  /** Viewer-session counters (the W704 consumption seam). */
  viewerWindowsApplied: "live_output_viewer_windows_applied_total",
  viewerWindowsDuplicate: "live_output_viewer_windows_duplicate_total",
  viewerWindowsSkipped: "live_output_viewer_windows_skipped_total",
  /** Histograms. */
  transitLagMs: "live_output_transit_lag_ms",
  deliveryLagMs: "live_output_delivery_lag_ms",
  watermarkLagAtDeliveryMs: "live_output_watermark_lag_at_delivery_ms",
  linkDepth: "live_output_link_depth",
} as const;
