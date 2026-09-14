/**
 * Streaming-ingress domain types (W301).
 *
 * The payload shapes are the W102 normalized representations
 * (`NormalizedVideoFrame` / `NormalizedAudioChunk` — see
 * `packages/decoding/src/types.ts`): a live segment is one such payload,
 * upstream timestamps included, delivered over time by a {@link ./source!LiveSource}.
 *
 * THE TIMESTAMP RULE (the W301 acceptance criterion): every normalized
 * segment emitted downstream carries its upstream timestamps VERBATIM. The
 * ingest service measures the arrival-clock vs upstream-timestamp
 * relationship (`arrivalLagMs`) and REPORTS it on the receipt — it never
 * rewrites, re-stamps, or clamps upstream time. W103 timeline correlation is
 * downstream territory.
 */
import type {
  AuthorizationPolicy,
  ResourceBudget,
  StageMessage,
  TerminalFailureClass,
} from "@sporta/contracts";
import type { NormalizedAudioChunk, NormalizedVideoFrame } from "@sporta/decoding";
import type { BoundedChannel } from "@sporta/transport";
import type { CorrelationContext, Logger, MetricsRegistry } from "@sporta/observability";
import type { LiveClock } from "./clock";
import type { LiveSource } from "./source";

// ---------------------------------------------------------------------------
// Live segments (input side)
// ---------------------------------------------------------------------------

/** One live-delivered video frame (W102 normalized shape, timestamps verbatim). */
export interface LiveVideoSegment {
  /** Upstream-assigned delivery id — the idempotency key for re-deliveries. */
  segmentId: string;
  kind: "video";
  /** The normalized frame; `presentationMs` is the upstream timestamp. */
  frame: NormalizedVideoFrame;
}

/** One live-delivered audio chunk (W102 normalized shape, timestamps verbatim). */
export interface LiveAudioSegment {
  /** Upstream-assigned delivery id — the idempotency key for re-deliveries. */
  segmentId: string;
  kind: "audio";
  /** The normalized chunk; `startMs` is the upstream timestamp. */
  chunk: NormalizedAudioChunk;
}

/** One live delivery: a W102 normalized payload plus its idempotency key. */
export type LiveSegment = LiveVideoSegment | LiveAudioSegment;

// ---------------------------------------------------------------------------
// Receipts (the W101 posture applied per segment)
// ---------------------------------------------------------------------------

/**
 * The receipt minted for one ACCEPTED live segment (first delivery only —
 * idempotent re-deliveries return this same receipt, they do not mint a new
 * one, exactly like the W101 `IngestionReceipt`/`SourceRegistry` posture).
 * Frozen on creation.
 */
export interface LiveSegmentReceipt {
  /** Session the segment was ingested into. */
  sessionId: string;
  /** The upstream delivery id (idempotency key). */
  segmentId: string;
  /** sha-256 of the canonical segment encoding (see `checksumLiveSegment`). */
  checksum: string;
  /**
   * Arrival-clock reading when the segment was RECEIVED from the source
   * (measured, injected clock — never a wall-clock read).
   */
  arrivalMs: number;
  /**
   * The payload's OWN upstream timestamp, copied VERBATIM
   * (`presentationMs` for video, `startMs` for audio) — never re-stamped.
   */
  upstreamMs: number;
  /**
   * MEASURED arrival-vs-upstream relationship: `arrivalMs - upstreamMs`.
   * Positive = the segment arrived after its upstream position (live
   * latency); negative = the arrival clock is behind upstream (skew). This is
   * a REPORTED measurement only — correction is W103, downstream.
   */
  arrivalLagMs: number;
}

// ---------------------------------------------------------------------------
// Normalized output segments (the emitted stage-message payloads)
// ---------------------------------------------------------------------------

/** One normalized video segment emitted downstream: payload VERBATIM + receipt. */
export interface IngestedLiveVideoSegment {
  segmentId: string;
  kind: "video";
  /** The frame exactly as delivered upstream — no field is rewritten. */
  frame: NormalizedVideoFrame;
  /** Receipt minted at acceptance (frozen). */
  receipt: LiveSegmentReceipt;
}

/** One normalized audio segment emitted downstream: payload VERBATIM + receipt. */
export interface IngestedLiveAudioSegment {
  segmentId: string;
  kind: "audio";
  /** The chunk exactly as delivered upstream — no field is rewritten. */
  chunk: NormalizedAudioChunk;
  /** Receipt minted at acceptance (frozen). */
  receipt: LiveSegmentReceipt;
}

/**
 * The payload of every `StageMessage` this service emits: the W102 normalized
 * payload (timestamps VERBATIM) plus the acceptance receipt that carries the
 * measured arrival relationship.
 */
export type IngestedLiveSegment = IngestedLiveVideoSegment | IngestedLiveAudioSegment;

// ---------------------------------------------------------------------------
// Accounting (the honest-accounting constitution)
// ---------------------------------------------------------------------------

/**
 * The live-session accounting snapshot. The two invariants asserted at every
 * session end (see {@link assertAccountingBalance}):
 *
 * 1. `rejected === rejectedRights + rejectedMalformed + rejectedBackpressure + rejectedLimit`
 * 2. `segmentsIn === segmentsOut + rejected + duplicates + abandoned`
 *
 * Every delivered segment lands in EXACTLY one bucket — no silent loss, no
 * silent collapse, anywhere.
 */
export interface LiveIngressStats {
  /** Deliveries RECEIVED from the live source (every pull). */
  segmentsIn: number;
  /** Segments admitted to the output channel (emitted downstream). */
  segmentsOut: number;
  /** Deliveries refused, total (the four sub-counters below). */
  rejected: number;
  /** Refused by the fail-closed rights gate (mid-stream expiry/re-check). */
  rejectedRights: number;
  /** Refused as malformed (payload validation / idempotency-key conflict). */
  rejectedMalformed: number;
  /** Refused by the output channel at capacity (`reject` backpressure). */
  rejectedBackpressure: number;
  /** Refused because the session segment budget was exhausted. */
  rejectedLimit: number;
  /** Idempotent re-deliveries of already-receipted segments (counted, never re-emitted). */
  duplicates: number;
  /** Accepted segments whose delivery could not complete at shutdown (explicit, never silent). */
  abandoned: number;
  /** Distinct receipted segments (registry size). */
  distinctSegments: number;
}

/**
 * One recorded refusal (the fail-loud ledger): every rejected or abandoned
 * segment leaves exactly one of these, with the structured error evidence.
 */
export interface RejectionRecord {
  /** The refused segment's id when known (upstream authoring bugs may omit it). */
  segmentId: string | null;
  /** Terminal failure classification of the refusal. */
  failureClass: TerminalFailureClass;
  /** Short machine reason (e.g. `rgb24-byte-mismatch`, `channel-full`). */
  reason: string;
  /** Full human-readable message. */
  message: string;
  /** Arrival-clock reading when the refusal was recorded. */
  atMs: number;
  /** Structured, JSON-safe error details. */
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Session lifecycle result
// ---------------------------------------------------------------------------

/** How a live ingest session ended. */
export type LiveSessionOutcome = "completed" | "stopped" | "failed";

/**
 * The settled result of one live ingest session, returned by `stop()` and
 * `done()`. `balanced` is `true` by construction AND by runtime assertion:
 * the service verifies the accounting invariants before settling and THROWS
 * on imbalance (an internal bug) instead of returning a lying result.
 */
export interface LiveSessionResult {
  sessionId: string;
  /** `completed` = feed naturally exhausted; `stopped` = ended via `stop()`; `failed` = terminal failure. */
  outcome: LiveSessionOutcome;
  /** Terminal failure classification (present iff `outcome === "failed"`). */
  terminalFailureClass?: TerminalFailureClass;
  /** Terminal failure detail (present iff `outcome === "failed"`). */
  error?: string;
  /** Final accounting snapshot (the balance invariants hold). */
  stats: LiveIngressStats;
  /** Accounting-balance proof (runtime-asserted before settling). */
  balanced: true;
}

// ---------------------------------------------------------------------------
// Resource limits
// ---------------------------------------------------------------------------

/** Resource bounds for one live ingest session (architecture-lock §13). */
export interface LiveIngressLimits {
  /**
   * Maximum accepted deliveries (total, across the whole session). The
   * delivery that would exceed the budget is refused (`rejectedLimit`) and
   * the session terminates with the `resource-limit` class — fail-loud, the
   * W102 byte-budget posture.
   */
  maxSegments: number;
}

/** 1,000,000 deliveries — comfortably above a full match (25 fps video + 4 Hz audio ≈ 160k for 90 minutes). */
const DEFAULT_MAX_SEGMENTS = 1_000_000;

/** Frozen default limits. */
export const DEFAULT_LIVE_INGRESS_LIMITS: LiveIngressLimits = Object.freeze({
  maxSegments: DEFAULT_MAX_SEGMENTS,
});

// ---------------------------------------------------------------------------
// Service options
// ---------------------------------------------------------------------------

/** Observability seams for the streaming ingest service; every field optional. */
export interface StreamingIngressObservability {
  /** Structured logger from `@sporta/observability` (default: silent no-op). */
  logger?: Logger;
  /** Metrics registry (default: private silent registry). */
  metrics?: MetricsRegistry;
  /**
   * Correlation context bound onto every log line and carried on every
   * emitted stage message (default: deterministic ids derived from the
   * session id — `corr-live-<sessionId>` / `trace-live-<sessionId>`).
   */
  correlation?: CorrelationContext;
}

/** Options for {@link ./service!StreamingIngressService}. */
export interface StreamingIngressOptions {
  /** The media session this live feed is ingested into. */
  sessionId: string;
  /** The live input (injectable; no vendor protocol hard-wired here). */
  source: LiveSource;
  /**
   * The session's authorization policy decision. `null`/`undefined` means NO
   * decision exists, which the fail-closed admission gate treats as DENY
   * (architecture-lock §11).
   */
  authorizationPolicy: AuthorizationPolicy | null | undefined;
  /**
   * The W104 bounded output channel. Owned by the caller (the pipeline
   * owner); the service emits one `StageMessage` per accepted segment and
   * applies the channel's backpressure policy (block = natural backpressure;
   * reject = explicit refusal accounting). Never silent drop: `drop-oldest`
   * channels account their own evictions (channel-owned, W104).
   */
  output: BoundedChannel<StageMessage>;
  /**
   * The injected arrival clock (REQUIRED — this package never reads a wall
   * clock; the deterministic fixture path shares one instance with the
   * source).
   */
  clock: LiveClock;
  /** Resource bounds (default: {@link DEFAULT_LIVE_INGRESS_LIMITS}). */
  limits?: LiveIngressLimits;
  /** Observability seams (default: silent no-ops). */
  observability?: StreamingIngressObservability;
  /**
   * Rights-evaluation time (epoch milliseconds) for the fail-closed gate —
   * the W101/W102 posture. A static number (default 0, which leaves the
   * expiry leg inert in tests — production callers MUST inject a real epoch)
   * or a function for mid-stream re-evaluation as time advances (e.g. derived
   * from the arrival clock).
   */
  rightsNowMs?: number | (() => number);
  /**
   * Resource budget hint carried on every emitted stage message (the
   * streaming contract's stage input vocabulary); omitted when not set.
   */
  resourceBudget?: ResourceBudget;
}

// ---------------------------------------------------------------------------
// Metric vocabulary
// ---------------------------------------------------------------------------

/** Metric names emitted by the streaming ingest boundary (W007 seam). */
export const STREAMING_METRIC_NAMES = {
  /** Counter bumped once per delivery received from the live source. */
  segmentsIn: "streaming_segments_in_total",
  /** Counter bumped once per segment admitted to the output channel. */
  segmentsOut: "streaming_segments_out_total",
  /** Counter bumped once per refused delivery (labeled with the failure class). */
  rejectedTotal: "streaming_rejected_total",
  /** Counter bumped once per idempotent duplicate re-delivery. */
  duplicatesTotal: "streaming_duplicate_segments_total",
  /** Counter bumped once per segment abandoned at shutdown. */
  abandonedTotal: "streaming_abandoned_segments_total",
  /** Counter bumped once per explicit backpressure refusal event. */
  backpressureTotal: "streaming_backpressure_events_total",
  /** Histogram observing the MEASURED arrival lag per accepted segment. */
  arrivalLagMs: "streaming_arrival_lag_ms",
  /** Histogram observing output-send wait time per accepted segment. */
  sendWaitMs: "streaming_send_wait_ms",
} as const;

// ---------------------------------------------------------------------------
// Balance assertion
// ---------------------------------------------------------------------------

/**
 * Asserts the honest-accounting invariants of a stats snapshot (throws
 * `RangeError` with the full breakdown on imbalance). Called internally at
 * every session end before the result settles; exported so tests and
 * operators can re-verify any snapshot.
 */
export function assertAccountingBalance(stats: LiveIngressStats): void {
  const rejectedSum =
    stats.rejectedRights +
    stats.rejectedMalformed +
    stats.rejectedBackpressure +
    stats.rejectedLimit;
  if (rejectedSum !== stats.rejected) {
    throw new RangeError(
      `rejected sub-counters do not sum to the total: ${stats.rejected} != ` +
        `${stats.rejectedRights} rights + ${stats.rejectedMalformed} malformed + ` +
        `${stats.rejectedBackpressure} backpressure + ${stats.rejectedLimit} limit`,
    );
  }
  const accounted = stats.segmentsOut + stats.rejected + stats.duplicates + stats.abandoned;
  if (accounted !== stats.segmentsIn) {
    throw new RangeError(
      `live ingress accounting does not balance: segmentsIn ${stats.segmentsIn} != ` +
        `segmentsOut ${stats.segmentsOut} + rejected ${stats.rejected} + ` +
        `duplicates ${stats.duplicates} + abandoned ${stats.abandoned} (accounted: ${accounted})`,
    );
  }
}

/** A fresh all-zero stats snapshot. */
export function emptyStats(): LiveIngressStats {
  return {
    segmentsIn: 0,
    segmentsOut: 0,
    rejected: 0,
    rejectedRights: 0,
    rejectedMalformed: 0,
    rejectedBackpressure: 0,
    rejectedLimit: 0,
    duplicates: 0,
    abandoned: 0,
    distinctSegments: 0,
  };
}
