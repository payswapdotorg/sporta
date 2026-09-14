/**
 * Processing-queues domain types (W302): stage outcomes, accounting stats,
 * submit outcomes, dead-letter entries, checkpoints, results, options, and
 * the metric vocabulary — plus the BALANCE ASSERTIONS, the heart of the
 * never-silent constitution.
 *
 * THE ACCOUNTING INVARIANTS (asserted at every settle, before the result is
 * returned — an imbalance REJECTS the done() promise instead of returning a
 * lying result, the W301 fail-loud posture):
 *
 * 1. `rejected === rejectedMalformed + rejectedBackpressure + rejectedDownstream + rejectedLimit`
 * 2. `abandoned === abandonedAdmission + abandonedProcessing`
 * 3. `segmentsIn === segmentsOut + rejected + duplicates + deadLettered + abandoned + dropped`
 *    — every submitted segment lands in EXACTLY ONE terminal bucket:
 *    emitted / rejected / dead-lettered / abandoned / dropped-evicted, with
 *    duplicates skipped (the brief's formula plus the never-silent `dropped`
 *    term the W104 `drop-oldest` policy adds; `dropped` is 0 unless a
 *    drop-oldest queue is configured, and it is always reconciled against
 *    the channels' own eviction counters);
 * 4. `admitted === segmentsOut + deadLettered + dropped + rejectedDownstream + abandonedProcessing`
 *    — everything that entered the pipeline either completed, failed
 *    terminally, was evicted, was refused by a downstream queue, or was
 *    abandoned mid-flight. (`dropped` covers the INPUT and INTER-stage
 *    queues only — a segment evicted from the OUTPUT queue already reached
 *    its terminal `emitted` disposition; its delivery loss stays
 *    channel-owned (W104), pinned by the cross-boundary identity
 *    `consumerReceived + outputQueue.dropped + outputQueue.size === segmentsOut`.)
 *
 * Per-stage and per-channel flow identities (see `reconcileStageFlows`) close
 * the loop stage-by-stage: nothing is lost between any pair of stages.
 */
import type {
  ResourceBudget,
  StageMessage,
  TerminalFailureClass,
  Watermark,
} from "@sporta/contracts";
import type { CorrelationContext, Logger, MetricsRegistry } from "@sporta/observability";
import type { BoundedChannel, RetryOptions } from "@sporta/transport";
import type { ProcessingClock } from "./clock";
import type { PipelineSegment } from "./segment";
import type { TerminalDisposition } from "./registry";

// ---------------------------------------------------------------------------
// Stage contracts
// ---------------------------------------------------------------------------

/**
 * The outcome of one stage transform over one segment:
 *
 * - `emitted` — the segment (possibly transformed) flows downstream;
 * - `failed` — classified failure: `retryable` segments get bounded
 *   deterministic retries (W104 `withRetries` — injectable clock, pure
 *   arithmetic backoff); NON-retryable failures go straight to the DLQ,
 *   never blind-retried (the W104 rule). `errorClass` + `message` travel to
 *   the dead-letter entry.
 */
export type StageOutcome =
  | { status: "emitted"; segment: PipelineSegment }
  | {
      status: "failed";
      retryable: boolean;
      errorClass: string;
      message: string;
    };

/** The wiring specification of one pipeline stage. */
export interface PipelineStageSpec {
  /** Stage id — non-empty; used on logs, metrics, dead-letter entries. */
  stage: string;
  /** The stage's async transform. Throwing is a bug (converted to an internal
   * non-retryable failure — never retried blindly, the W104 rule). */
  transform: (segment: PipelineSegment) => Promise<StageOutcome>;
  /** Independent in-flight workers (default 1 = FIFO outputs; > 1 makes the
   * output order non-deterministic — the W104 StageRunner caveat). */
  concurrency?: number;
  /**
   * Retry semantics for this stage. Absent means NO retries: retries are an
   * explicit, deterministic/idempotent-only policy choice (the streaming
   * contract). The retry CLOCK is always the pipeline's injected
   * {@link ProcessingClock} (backoff sleeping is deterministic).
   */
  retry?: RetryOptions;
}

/** The bounded-queue specification of one channel (W104 semantics VERBATIM). */
export interface StageQueueSpec {
  /** Maximum queued messages (integer >= 1). */
  capacity: number;
  /**
   * Optional maximum total `segment.byteSize` across queued messages
   * (>= 0) — the W104 byte-budget precedent, fed by the segment's declared
   * size.
   */
  maxBytes?: number;
  /**
   * The explicit policy when the queue is full (W104 `BackpressurePolicy`):
   * `block` parks the producer (natural backpressure, propagates upstream);
   * `reject` refuses with a typed `ResourceLimitError` (counted + logged +
   * metered, stream continues); `drop-oldest` evicts the oldest with
   * channel-owned count/log/metric — never silent.
   */
  policy: "block" | "reject" | "drop-oldest";
}

// ---------------------------------------------------------------------------
// Submit outcomes (the producer-facing API)
// ---------------------------------------------------------------------------

/** The typed refusal details of a `rejected` submit (the W104 error body). */
export interface SubmitRejectionDetails {
  /** Short machine reason (e.g. `input-channel-full`). */
  reason: string;
  /** Terminal failure classification of the refusal. */
  failureClass: "media-invalid" | "resource-limit";
  /** Structured, JSON-safe details. */
  details: Record<string, unknown>;
}

/** The resolved disposition of one `submit()` attempt. */
export type SubmitOutcome =
  | {
      /** The segment was admitted to the input queue (bounded). */
      disposition: "admitted";
      /** The pipeline input sequence assigned to the segment. */
      sequence: number;
    }
  | {
      /** The input queue refused the segment under its policy. */
      disposition: "rejected";
      rejection: SubmitRejectionDetails;
    }
  | {
      /** The key is terminally-disposed already — counted duplicate, skipped. */
      disposition: "duplicate";
      idempotencyKey: string;
      /** The terminal disposition the key already had. */
      firstDisposition: TerminalDisposition;
    }
  | {
      /** The pipeline stopped before the segment was admitted (never silent). */
      disposition: "abandoned";
      idempotencyKey: string;
      reason: string;
    };

// ---------------------------------------------------------------------------
// Dead-letter queue
// ---------------------------------------------------------------------------

/**
 * One dead-letter entry: a segment that failed TERMINALLY at a stage —
 * non-retryable, retry-budget-exhausted, or internal (a transform that
 * threw / returned an invalid outcome). Carries the segment, the stage id,
 * the error class, and the injected clock's timestamp.
 */
export interface DeadLetterEntry {
  idempotencyKey: string;
  /** The stage at which the segment terminally failed. */
  stage: string;
  /** The stage's error class (e.g. `media-invalid`, `transient`, `internal`). */
  errorClass: string;
  /** The failure message. */
  message: string;
  /** Why it was dead-lettered: classified non-retryable, retries exhausted, or internal bug. */
  terminal: "non-retryable" | "retry-exhausted" | "internal";
  /** Total attempts including the first. */
  attempts: number;
  /** Retries consumed (`attempts - 1`). */
  retriesUsed: number;
  /** The injected clock's reading at dead-letter time. */
  atMs: number;
  /** The segment as it entered the failing stage (VERBATIM reference). */
  segment: PipelineSegment;
  /** The pipeline input sequence the segment carried. */
  sequence: number;
  correlationId: string;
  traceId: string;
}

/** Bounded DLQ + resource limits for one pipeline. */
export interface ProcessingLimits {
  /**
   * Maximum retained dead-letter entries (integer >= 1). Failures beyond the
   * bound are still counted, logged, and metered (`dlqOverflow` — never
   * silent) but not retained.
   */
  maxDeadLetterEntries: number;
  /**
   * Maximum ADMITTED segments over the pipeline's lifetime (integer >= 1,
   * the W301 segment-budget posture). The submit that would exceed the
   * budget is refused (`rejectedLimit`) and the pipeline terminates
   * fail-loud with the `resource-limit` class.
   */
  maxAdmittedSegments: number;
}

/** 1,000 retained dead letters — a loud, inspectable ledger slice. */
const DEFAULT_MAX_DEAD_LETTER_ENTRIES = 1_000;

/** 1,000,000 admitted segments — far above a full match's segment count. */
const DEFAULT_MAX_ADMITTED = 1_000_000;

/** Frozen default limits. */
export const DEFAULT_PROCESSING_LIMITS: ProcessingLimits = Object.freeze({
  maxDeadLetterEntries: DEFAULT_MAX_DEAD_LETTER_ENTRIES,
  maxAdmittedSegments: DEFAULT_MAX_ADMITTED,
});

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

/**
 * One watermark-boundary checkpoint: everything needed to resume the
 * pipeline from a safe point. `processedKeys` are the idempotency keys that
 * reached a TERMINAL disposition (emitted or dead-lettered) at or before the
 * boundary watermark — `resumePipeline` skips them as counted duplicates
 * (or reprocesses them when explicitly configured).
 */
export interface PipelineCheckpoint {
  /** 1-based cut ordinal. */
  index: number;
  /** The watermark of the terminal disposition that crossed the boundary. */
  watermark: Watermark;
  /** The pipeline input sequence of that segment. */
  sequence: number;
  /**
   * ALL terminally-disposed keys at cut time, in disposition order — the
   * cumulative resume set (a real deployment compacts/externalizes this;
   * see the honest-limitation note in the package docs).
   */
  processedKeys: ReadonlyArray<{ key: string; disposition: TerminalDisposition }>;
  /** The pipeline stats snapshot at cut time. */
  stats: PipelineStats;
  /** The injected clock's reading at cut time. */
  atMs: number;
}

// ---------------------------------------------------------------------------
// Accounting stats
// ---------------------------------------------------------------------------

/** Whole-pipeline accounting (the invariants live in the module doc). */
export interface PipelineStats {
  /** Submit attempts accounted (the W301 `segmentsIn` analog). */
  segmentsIn: number;
  /** Attempts whose input-queue send resolved (segment entered the pipeline). */
  admitted: number;
  /** Segments admitted to the OUTPUT queue by the last stage (terminal `emitted`). */
  segmentsOut: number;
  /** Refusals, total (the four sub-counters below). */
  rejected: number;
  /** Refused as malformed at submit (typed `MalformedSegmentError`). */
  rejectedMalformed: number;
  /** Refused by the INPUT queue at capacity (typed `ResourceLimitError`). */
  rejectedBackpressure: number;
  /** Refused by an INTERMEDIATE/OUTPUT queue at capacity (stage send refused). */
  rejectedDownstream: number;
  /** Refused because the admitted-segment budget was exhausted. */
  rejectedLimit: number;
  /** Re-submissions of terminally-disposed keys (counted, skipped). */
  duplicates: number;
  /** Terminally failed segments (retained + overflowed DLQ entries). */
  deadLettered: number;
  /** DLQ entries beyond the retention bound (counted + logged + metered, not retained). */
  dlqOverflow: number;
  /** Retained DLQ entries (the inspectable window). */
  dlqRetained: number;
  /** Segments whose work could not complete at shutdown, total (the two below). */
  abandoned: number;
  /** Submit-side: parked input sends closed at stop. */
  abandonedAdmission: number;
  /** Stage-side: in-flight transforms / queued sweeps / refused sends at cancel. */
  abandonedProcessing: number;
  /**
   * `drop-oldest` evictions across the INPUT and INTER-stage queues,
   * reconciled live from the channels' own `dropped` counters
   * (channel-owned accounting, W104 — the pipeline reports, never invents).
   * Output-queue evictions are deliberately NOT here: an evicted emitted
   * segment already reached its terminal disposition; its delivery loss is
   * the output channel's own never-silent accounting.
   */
  dropped: number;
  /** Distinct terminally-disposed idempotency keys (registry size). */
  distinctProcessed: number;
  /** Current per-channel queue depths (input first, output last). */
  queueDepths: number[];
}

/** Per-stage accounting (flow identities in `reconcileStageFlows`). */
export interface StageStats {
  stage: string;
  /** Segments pulled from this stage's input queue. */
  received: number;
  /** Segments sent downstream (last stage: admitted to the output queue). */
  emitted: number;
  /** Terminally failed segments → DLQ (after retries). */
  failed: number;
  /** Sends refused by the downstream queue (`reject` policy, counted, stream continues). */
  refused: number;
  /** Retry attempts consumed (Σ `retriesUsed`). */
  retries: number;
  /** Received but not yet terminally disposed (0 at settle). */
  inFlight: number;
  /** In-flight work that could not complete at cancel (parked send / closed queue). */
  abandonedInFlight: number;
  /** Segments swept from this stage's input queue at cancel (never received). */
  abandonedQueued: number;
}

// ---------------------------------------------------------------------------
// Rejection ledger
// ---------------------------------------------------------------------------

/**
 * One recorded refusal or abandonment (the fail-loud ledger): every
 * rejected or abandoned segment leaves exactly one of these, with the
 * structured error evidence. (Dropped evictions are channel-owned — the W104
 * channel logs each one; the pipeline's `dropped` stat is the reconciled
 * counter, so evictions deliberately leave no pipeline ledger entry.)
 */
export interface PipelineRejectionRecord {
  /** The segment's idempotency key when known. */
  idempotencyKey: string | null;
  /** Which terminal bucket the record landed in. */
  bucket: "rejected" | "abandoned";
  /** Terminal failure classification of the refusal. */
  failureClass: TerminalFailureClass;
  /** Short machine reason (e.g. `input-queue-full`, `stop-closed-input`). */
  reason: string;
  /** Full human-readable message. */
  message: string;
  /** Stage id when the decision happened inside a stage, else `null`. */
  stage: string | null;
  /** Clock reading when the record was made. */
  atMs: number;
  /** Structured, JSON-safe details. */
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Session result
// ---------------------------------------------------------------------------

/** How a pipeline ended. */
export type PipelineOutcome = "stopped" | "failed";

/**
 * The settled result of one pipeline run, returned by `stop()` and `done()`.
 * `balanced` is `true` by construction AND by runtime assertion: the
 * pipeline verifies every accounting invariant before settling and THROWS on
 * imbalance (an internal bug) instead of returning a lying result.
 */
export interface PipelineResult {
  sessionId: string;
  /** `stopped` = ended via stop(); `failed` = terminal failure (internal/resource-limit). */
  outcome: PipelineOutcome;
  /** Terminal failure classification (present iff `outcome === "failed"`). */
  terminalFailureClass?: "resource-limit" | "internal";
  /** Terminal failure detail (present iff `outcome === "failed"`). */
  error?: string;
  /** Final accounting snapshot (all invariants hold). */
  stats: PipelineStats;
  /** Per-stage final stats, in stage order. */
  stages: StageStats[];
  /** Accounting-balance proof (runtime-asserted before settling). */
  balanced: true;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Observability seams for the pipeline; every field optional. */
export interface ProcessingObservability {
  /** Structured logger (default: silent no-op — instrumentation is unconditional). */
  logger?: Logger;
  /** Metrics registry (default: private throwaway registry). */
  metrics?: MetricsRegistry;
  /**
   * Correlation context bound onto every log line and carried on every
   * stage message (default: deterministic ids derived from the session id —
   * `corr-pipe-<sessionId>` / `trace-pipe-<sessionId>`; per-submit overrides
   * supported, the W007 end-to-end posture).
   */
  correlation?: CorrelationContext;
}

/** Options for {@link ./pipeline!ProcessingPipeline}. */
export interface ProcessingPipelineOptions {
  /** The media session this pipeline processes. */
  sessionId: string;
  /** The stage chain (1..N stages; each feeds the next through a bounded queue). */
  stages: PipelineStageSpec[];
  /**
   * Queue specifications, one per CHANNEL (exactly `stages.length + 1`:
   * queue 0 = pipeline input, queues 1..N-1 = inter-stage, queue N = output),
   * OR `queue` for one spec applied to every channel. Exactly one of
   * `queues` / `queue` may be given; neither defaults to capacity 16 /
   * `block`.
   */
  queues?: StageQueueSpec[];
  /** Uniform queue spec for every channel (see `queues`). */
  queue?: StageQueueSpec;
  /**
   * The injected processing clock (REQUIRED — this package never reads a
   * wall clock; retry backoff, latency, DLQ and checkpoint times all read it).
   */
  clock: ProcessingClock;
  /** Resource bounds (default: {@link DEFAULT_PROCESSING_LIMITS}). */
  limits?: ProcessingLimits;
  /**
   * Checkpoint interval in WATERMARK milliseconds: a checkpoint is cut each
   * time a terminal disposition's watermark crosses the next boundary
   * (boundaries advance to crossing-watermark + interval). Absent = no
   * checkpoints. Must be > 0 when given.
   */
  checkpointEveryMs?: number;
  /** Observability seams (default: silent no-ops). */
  observability?: ProcessingObservability;
  /**
   * Terminal-disposition keys to PRELOAD into the idempotency registry
   * (recovery: `resumePipeline` wires this from a checkpoint). Preloaded
   * keys re-submitted during the run count as duplicates.
   */
  preloadedDispositions?: ReadonlyArray<{ key: string; disposition: TerminalDisposition }>;
  /** Resource budget hint carried on every stage message (streaming contract). */
  resourceBudget?: ResourceBudget;
}

// ---------------------------------------------------------------------------
// Metric vocabulary
// ---------------------------------------------------------------------------

/**
 * Metric names emitted by the processing-queues boundary (W007 seam). The
 * latency histogram is package-prefixed (`processing_stage_latency_ms`, not
 * the W007 `stage_latency_ms`) so its unlabeled series cannot collide with
 * other stages' series in a shared registry.
 */
export const PROCESSING_METRIC_NAMES = {
  /** Counter bumped once per accounted submit attempt. */
  segmentsIn: "processing_segments_in_total",
  /** Counter bumped once per segment admitted to the output queue. */
  segmentsOut: "processing_segments_out_total",
  /** Counter bumped once per refused attempt (labeled with the failure class). */
  rejectedTotal: "processing_rejected_total",
  /** Counter bumped once per idempotent duplicate submission. */
  duplicatesTotal: "processing_duplicate_segments_total",
  /** Counter bumped once per terminally failed segment. */
  deadLetteredTotal: "processing_dead_lettered_total",
  /** Counter bumped once per segment abandoned at shutdown. */
  abandonedTotal: "processing_abandoned_segments_total",
  /** Counter bumped once per retained+overflowed DLQ entry (labeled with `terminal`). */
  dlqEntriesTotal: "processing_dlq_entries_total",
  /** Counter bumped once per retry attempt consumed (labeled with `stage`). */
  retriesTotal: "processing_retries_total",
  /** Counter bumped once per checkpoint cut. */
  checkpointsTotal: "processing_checkpoints_total",
  /** Histogram observing per-stage transform latency (summed handler latency per segment). */
  stageLatencyMs: "processing_stage_latency_ms",
} as const;

// ---------------------------------------------------------------------------
// Balance assertions + stats helpers
// ---------------------------------------------------------------------------

/** A fresh all-zero pipeline stats snapshot (queueDepths filled by the owner). */
export function emptyStats(queueDepths: number[] = []): PipelineStats {
  return {
    segmentsIn: 0,
    admitted: 0,
    segmentsOut: 0,
    rejected: 0,
    rejectedMalformed: 0,
    rejectedBackpressure: 0,
    rejectedDownstream: 0,
    rejectedLimit: 0,
    duplicates: 0,
    deadLettered: 0,
    dlqOverflow: 0,
    abandoned: 0,
    abandonedAdmission: 0,
    abandonedProcessing: 0,
    dropped: 0,
    distinctProcessed: 0,
    dlqRetained: 0,
    queueDepths: [...queueDepths],
  };
}

/** A fresh all-zero stage stats snapshot. */
export function emptyStageStats(stage: string): StageStats {
  return {
    stage,
    received: 0,
    emitted: 0,
    failed: 0,
    refused: 0,
    retries: 0,
    inFlight: 0,
    abandonedInFlight: 0,
    abandonedQueued: 0,
  };
}

/**
 * Asserts the whole-pipeline accounting invariants (throws `RangeError`
 * with the full breakdown on imbalance). Called internally at every settle
 * before the result settles; exported so tests and operators re-verify any
 * snapshot.
 */
export function assertAccountingBalance(stats: PipelineStats): void {
  const rejectedSum =
    stats.rejectedMalformed +
    stats.rejectedBackpressure +
    stats.rejectedDownstream +
    stats.rejectedLimit;
  if (rejectedSum !== stats.rejected) {
    throw new RangeError(
      `rejected sub-counters do not sum to the total: ${stats.rejected} != ` +
        `${stats.rejectedMalformed} malformed + ${stats.rejectedBackpressure} backpressure + ` +
        `${stats.rejectedDownstream} downstream + ${stats.rejectedLimit} limit`,
    );
  }
  const abandonedSum = stats.abandonedAdmission + stats.abandonedProcessing;
  if (abandonedSum !== stats.abandoned) {
    throw new RangeError(
      `abandoned sub-counters do not sum to the total: ${stats.abandoned} != ` +
        `${stats.abandonedAdmission} admission + ${stats.abandonedProcessing} processing`,
    );
  }
  const accounted =
    stats.segmentsOut +
    stats.rejected +
    stats.duplicates +
    stats.deadLettered +
    stats.abandoned +
    stats.dropped;
  if (accounted !== stats.segmentsIn) {
    throw new RangeError(
      `processing-queues accounting does not balance: segmentsIn ${stats.segmentsIn} != ` +
        `segmentsOut ${stats.segmentsOut} + rejected ${stats.rejected} + ` +
        `duplicates ${stats.duplicates} + deadLettered ${stats.deadLettered} + ` +
        `abandoned ${stats.abandoned} + dropped ${stats.dropped} (accounted: ${accounted})`,
    );
  }
  const admittedAccounted =
    stats.segmentsOut +
    stats.deadLettered +
    stats.dropped +
    stats.rejectedDownstream +
    stats.abandonedProcessing;
  if (admittedAccounted !== stats.admitted) {
    throw new RangeError(
      `admitted segments do not balance: admitted ${stats.admitted} != ` +
        `segmentsOut ${stats.segmentsOut} + deadLettered ${stats.deadLettered} + ` +
        `dropped ${stats.dropped} + rejectedDownstream ${stats.rejectedDownstream} + ` +
        `abandonedProcessing ${stats.abandonedProcessing} (accounted: ${admittedAccounted})`,
    );
  }
  if (stats.deadLettered !== stats.dlqRetained + stats.dlqOverflow) {
    throw new RangeError(
      `deadLettered does not match the DLQ ledger: deadLettered ${stats.deadLettered} != ` +
        `dlqRetained ${stats.dlqRetained} + dlqOverflow ${stats.dlqOverflow}`,
    );
  }
}

/**
 * The per-stage flow identity inputs: channel evictions and the stage stats
 * array. Asserts, for every stage j, that what left the upstream producer
 * equals what stage j received + what its input queue evicted + what was
 * swept from that queue at cancel — the stage-by-stage never-silent proof.
 *
 * - Stage 0's input producer is the submit boundary (`admitted`);
 * - Stage j > 0's input producer is stage j-1's `emitted`;
 * - Each stage: `received === emitted + failed + refused + abandonedInFlight + inFlight`.
 */
export function reconcileStageFlows(
  stats: PipelineStats,
  stageStats: readonly StageStats[],
  inputQueueDropped: readonly number[],
): void {
  for (const [j, stage] of stageStats.entries()) {
    const dropped = inputQueueDropped[j] ?? 0;
    const inflow = j === 0 ? stats.admitted : (stageStats[j - 1]?.emitted ?? 0);
    const outflow = stage.received + dropped + stage.abandonedQueued;
    if (inflow !== outflow) {
      throw new RangeError(
        `stage-flow identity broken at stage '${stage.stage}' (index ${j}): ` +
          `inflow ${inflow} != received ${stage.received} + dropped ${dropped} + ` +
          `abandonedQueued ${stage.abandonedQueued} (outflow ${outflow})`,
      );
    }
    const disposed =
      stage.emitted + stage.failed + stage.refused + stage.abandonedInFlight + stage.inFlight;
    if (disposed !== stage.received) {
      throw new RangeError(
        `stage disposition identity broken at stage '${stage.stage}' (index ${j}): ` +
          `received ${stage.received} != emitted ${stage.emitted} + failed ${stage.failed} + ` +
          `refused ${stage.refused} + abandonedInFlight ${stage.abandonedInFlight} + ` +
          `inFlight ${stage.inFlight} (disposed ${disposed})`,
      );
    }
  }
}

/** The stage-message payload type the pipeline emits (the segment, verbatim). */
export type PipelinePayload = PipelineSegment;

/** Convenience re-export used by consumers of the output channel. */
export type OutputChannel = BoundedChannel<StageMessage>;
