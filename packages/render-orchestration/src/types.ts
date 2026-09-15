/**
 * render-orchestration domain types (W304): the SWM-update consumption seam,
 * the batch unit, the degradation policy, the never-silent accounting stats
 * and their BALANCE ASSERTIONS, checkpoints, options, and the metric
 * vocabulary.
 *
 * THE MASTER ACCOUNTING INVARIANT (the W304 work-item formula — "batches in =
 * batches rendered + batches skipped + batches dropped-by-policy, never
 * silent"), runtime-asserted at every settle (an imbalance REJECTS the
 * settle promise instead of returning a lying result — the W301/W302/W303
 * fail-loud posture), with the shutdown vocabulary the brief's formula
 * extends to:
 *
 *   `batchesIn === batchesRendered + batchesSkippedStale + batchesDropped +
 *                 batchesCancelled + batchesDuplicateSkips + batchesInFlight`
 *
 * (`batchesInFlight` is 0 at every settle — drain waits for every in-flight
 * job; cancel accounts everything unresolved.)
 *
 * Split into exact, independently-mutatable checks (§
 * {@link assertRenderAccounting}):
 *
 * 1. `batchesIn === batchesDuplicateSkipsAtConsume +
 *    batchesSkippedStaleAtAdmission + batchesSentToQueue +
 *    batchesQueueRefused + batchesAbandoned` — every cut batch either was a
 *    checkpoint duplicate (skipped at consume — a dispatcher-resolved
 *    duplicate instead ENTERED the queue, so it is counted in
 *    `batchesSentToQueue` and never here: the two duplicate sources must not
 *    double-count one batch), a degradation skip at admission, entered the
 *    bounded render queue (including a send the channel itself resolved by
 *    dropping the incoming oversized message — attributed `queue-evicted`),
 *    or was refused/abandoned at the queue boundary;
 * 2. `batchesSentToQueue === batchesReceivedFromQueue + batchesQueueEvicted +
 *    queuedNow` — the CROSS-BOUNDARY identity with the W104 channel (evicted
 *    stays channel-owned: `batchesQueueEvicted === channel.dropped` is
 *    asserted separately at settle); `queuedNow` is 0 at settle (the queue is
 *    proven drained or cancelled);
 * 3. `batchesReceivedFromQueue === renderJobsSubmitted + renderJobsDuplicate +
 *    batchesSkippedStaleInQueue + batchesRenderQueueRefused +
 *    batchesCancelledInQueue` — every dequeued batch either became a W303
 *    job, was a counted protocol duplicate, was skipped by the degradation
 *    policy, was refused by the dispatcher's capacity (typed
 *    `GpuResourceLimitError` — the W104 posture), or was cancelled at
 *    dequeue during a cancel stop;
 * 4. `renderJobsSubmitted === batchesRendered + batchesRenderFailed +
 *    batchesRenderCancelled + batchesReorderOverflow +
 *    batchesRenderOutputInvalid + renderJobsInFlight` — every ADMITTED job
 *    resolves to exactly one batch disposition (in-flight 0 at settle);
 * 5. `batchesDropped === batchesQueueEvicted + batchesQueueRefused +
 *    batchesAbandoned + batchesRenderQueueRefused + batchesRenderFailed +
 *    batchesReorderOverflow + batchesRenderOutputInvalid` — the
 *    dropped-by-policy bucket is an exact sum of labeled reasons (never a
 *    silent lump).
 */
import type {
  RenderRequest,
  TerminalFailureClass,
  Watermark,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";
import type { GpuClock, GpuJobResultTiming, GpuWorkerRetryPolicy } from "@sporta/gpu-worker";
import type { AnimeRenderOutput } from "@sporta/renderer-anime";
import type { BackpressurePolicy } from "@sporta/transport";
import type { CorrelationContext, Logger, MetricsRegistry } from "@sporta/observability";

// ---------------------------------------------------------------------------
// The SWM-update consumption seam (the W402-style incremental source)
// ---------------------------------------------------------------------------

/**
 * One incremental SWM update — the consumption unit. The store author
 * derives it exactly the way the W402 consumer seams do (the fixture in this
 * package's tests uses `stateAt(engine, t)` + `eventWindow(entries, ...)`
 * over a growing W006 engine): a snapshot plus the events attributed to its
 * window, both carrying the SWM's own watermark VERBATIM.
 *
 * Invariants (store-authored, consumed verbatim — the orchestrator never
 * re-stamps): `sequence` strictly increases across updates;
 * `watermark.watermarkMs` strictly increases (the W502 clip-step invariant —
 * a store that violates it will see its batch refused by the renderer,
 * counted `render-failed`, never silently coerced).
 */
export interface SwmUpdate {
  /** Store-assigned monotone sequence (strictly increasing, >= 0). */
  sequence: number;
  /** The update's progress marker — the snapshot's own watermark, VERBATIM. */
  watermark: Watermark;
  /** Best-known coherent state at `watermark.watermarkMs` (e.g. `stateAt`). */
  snapshot: WorldSnapshot;
  /** Ordered events attributed to this update's window (e.g. `eventWindow`). */
  events: WorldEventStreamEntry[];
  /** Declared payload bytes (deterministic; the W104 sizer evidence). */
  byteSize: number;
}

/**
 * The growing-store seam the orchestrator consumes INCREMENTALLY: queries
 * are sequence-anchored (`updatesAfter(afterSequence, ...)`) with an explicit
 * bound — a whole-history re-read is structurally impossible through this
 * surface (the fixture proves it by counting materialized entries per
 * query). Vendor-neutral by construction: no protocol, no network, no clock
 * reads (growth is observed through `availableWatermark`/`nextGrowthAtMs`).
 */
export interface SwmUpdateStore {
  /** The stream head — the highest watermark currently available. */
  availableWatermark(): Watermark;
  /** `true` when no further updates will ever arrive. */
  isComplete(): boolean;
  /**
   * The updates with `sequence > afterSequence` AND
   * `watermark.watermarkMs <= toMs` (inclusive — the W402 `eventWindow` bound
   * convention), in sequence order, at most `limit` of them. `more` reports
   * whether additional matching updates remain beyond the returned slice
   * (never silent truncation). `toMs` may be `Infinity` for a final flush.
   */
  updatesAfter(
    afterSequence: number,
    toMs: number,
    limit: number,
  ): { updates: SwmUpdate[]; more: boolean };
  /** Whether any update with `sequence > afterSequence` exists at all. */
  hasUpdatesAfter(afterSequence: number): boolean;
  /**
   * The earliest future clock time at which the stream head could advance
   * (the consumer's passive `waitUntil` target), or `undefined` when the
   * store is complete.
   */
  nextGrowthAtMs(): number | undefined;
}

// ---------------------------------------------------------------------------
// Batches (the render work unit)
// ---------------------------------------------------------------------------

/** How one batch's update slice was closed. */
export type BatchClosedBy =
  /** The batch's last update ends at (or beyond) the window boundary. */
  | "watermark-boundary"
  /** `maxUpdatesPerBatch` cut the window short — the next batch continues it. */
  | "size-limit"
  /** The stream completed before the boundary — the final partial window. */
  | "stream-complete";

/**
 * One watermark-aligned batch of SWM updates — the unit of render work.
 * Batches are cut in consumption order; ordinals are strictly increasing and
 * continue across a resume from the checkpoint (a deterministic replay cuts
 * the same batches with the same ordinals).
 */
export interface RenderBatch {
  /** Orchestrator-assigned identity (unique per orchestrator, stable across resume replays). */
  batchId: string;
  /** Session the batch belongs to. */
  sessionId: string;
  /** Cut ordinal (strictly increasing; continues across resume). */
  ordinal: number;
  /** Inclusive update-sequence range `[fromSequence, toSequence]`. */
  fromSequence: number;
  toSequence: number;
  /** The nominal window (EXCLUSIVE start, INCLUSIVE end) on the watermark timeline. */
  windowMs: { startMs: number; endMs: number };
  /** The batch's own watermark — its LAST update's watermark, VERBATIM. */
  watermark: Watermark;
  /** The updates, in sequence order (bounded by `maxUpdatesPerBatch`). */
  updates: readonly SwmUpdate[];
  /** How the batch was closed (honest boundary vs size-limit vs stream-end). */
  closedBy: BatchClosedBy;
  /** Declared payload bytes (sum of update byteSize; the channel sizer). */
  byteSize: number;
  /**
   * The idempotency key derived from the batch watermark (the streaming
   * contract's Recovery rule): the same watermark NEVER double-submits — a
   * re-submission is a counted duplicate at the W303 dispatcher.
   */
  idempotencyKey: string;
}

// ---------------------------------------------------------------------------
// Degradation policy (unbounded-backlog prevention — the acceptance core)
// ---------------------------------------------------------------------------

/** The skip-stale degradation configuration. */
export interface SkipStalePolicy {
  /**
   * Batches whose watermark lags the stream head by MORE than this many
   * milliseconds are SKIPPED — counted, logged, metered, ledgered, with the
   * original watermark preserved (never re-stamped, never rendered as if
   * fresh). Checked at admission (before the render queue) and again at
   * dequeue (a batch can go stale while queued).
   */
  maxWatermarkLagMs: number;
}

/**
 * The explicit degradation policy. `skipStale: "disabled"` (the default) is
 * the honest baseline: nothing is skipped and the queue's own backpressure
 * policy plus the reorder bound are the only protections (both bounded, both
 * loud). Skipping is an explicit, configured decision — never a silent
 * default (docs/contracts/streaming.md backpressure rule).
 */
export type DegradationPolicy = { skipStale: SkipStalePolicy } | { skipStale: "disabled" };

/** The measured stale-skip decision for one batch at one point in time. */
export interface StaleDecision {
  stale: boolean;
  /** Measured lag at decision time: `head.watermarkMs − batchWatermarkMs`. */
  lagMs: number;
  /** The stream head watermark at decision time (evidence, verbatim). */
  head: Watermark;
}

// ---------------------------------------------------------------------------
// Render work seam + outputs
// ---------------------------------------------------------------------------

/**
 * The render executor seam (the W304 work unit): renders one batch to one
 * `AnimeRenderOutput`, or a classified failure. The outcome shape mirrors
 * the W303 `GpuExecutorOutcome` on purpose — the orchestrator's internal
 * adapter re-shapes it directly, so lease/retry/DLQ semantics are inherited
 * VERBATIM: `retryable: false` failures are never blind-retried; thrown
 * faults propagate to the W303 worker (classified `internal`, dead-lettered);
 * a thrown `RendererContractError` (a render REFUSAL — malformed request,
 * rights, profile) is mapped by the provided anime executor to a
 * non-retryable `render-refused` failure.
 */
export interface RenderBatchExecutor {
  execute(
    batch: RenderBatch,
    request: RenderRequest,
    context: RenderExecutorContext,
  ): Promise<RenderBatchOutcome>;
}

/** The context handed to every render execution. */
export interface RenderExecutorContext {
  /** The shared injected protocol clock (render work consumes clock time via `sleep`). */
  clock: GpuClock;
}

/** One render attempt's outcome (see {@link RenderBatchExecutor}). */
export type RenderBatchOutcome =
  | { status: "succeeded"; output: AnimeRenderOutput }
  | { status: "failed"; errorClass: string; message: string; retryable: boolean };

/** One emitted render output with its provenance (watermark order). */
export interface RenderOutputRecord {
  /** The rendered clip (the W502 anime plugin output, verbatim). */
  output: AnimeRenderOutput;
  provenance: {
    sessionId: string;
    /** The source batch identity. */
    batchId: string;
    batchOrdinal: number;
    /** The source batch's watermark, VERBATIM (never re-stamped). */
    sourceWatermark: Watermark;
    /** The W303 job that rendered this batch. */
    jobId: string;
    /** The renderer identity, verbatim from the output manifest. */
    rendererId: string;
    rendererVersion: string;
    /** The job's measured timing, verbatim from the W303 result envelope. */
    jobTiming: GpuJobResultTiming;
  };
}

// ---------------------------------------------------------------------------
// Ledger (the never-silent proof)
// ---------------------------------------------------------------------------

/** Why one batch terminated without a rendered output (machine reasons). */
export type BatchDropReason =
  | "queue-evicted"
  | "queue-refused"
  | "abandoned-at-stop"
  | "render-queue-refused"
  | "render-failed"
  | "reorder-overflow"
  | "render-output-invalid";

/** One batch's terminal disposition record (every batch gets exactly one). */
export interface RenderBatchLedgerEntry {
  batchId: string;
  ordinal: number;
  /** The batch's idempotency key (the Recovery-rule identity). */
  idempotencyKey: string;
  /** The batch's watermark, VERBATIM. */
  watermark: Watermark;
  /** Exactly one terminal disposition. */
  disposition: "rendered" | "skipped-stale" | "dropped" | "cancelled" | "duplicate";
  /** Present iff `disposition === "dropped"`. */
  dropReason?: BatchDropReason;
  /** Present iff `disposition === "skipped-stale"`. */
  skipPhase?: "admission" | "dequeue";
  /** The W303 job id, when the batch reached the render protocol. */
  jobId?: string;
  /** The terminal W303 failure classification, when one applies. */
  terminalClass?: string;
  /** Protocol-clock reading at the terminal decision. */
  atMs: number;
}

// ---------------------------------------------------------------------------
// Checkpoints (the W302 recovery posture)
// ---------------------------------------------------------------------------

/**
 * A watermark-boundary checkpoint — the streaming contract's recovery rule
 * ("Stateful stages checkpoint enough information to resume from a safe
 * watermark"). Cut each time a batch's TERMINAL disposition crosses the next
 * boundary; `processedKeys` carries only the RENDER-protocol terminal
 * dispositions (`rendered` / `render-failed`) — batches that never reached
 * the protocol (skipped, evicted, refused, abandoned, cancelled) stay
 * UNREGISTERED so recovery reprocesses them at-least-once (the W302
 * terminal-disposition-registry posture).
 *
 * ANCHORING (the deterministic-replay property, test-pinned): every resume
 * anchor is derived from the CROSSING BATCH — `consumedThroughSequence` is
 * the crossing batch's `toSequence`, `nextBatchOrdinal` is its `ordinal +
 * 1`, and the grid fields (`nextBoundaryMs`, `nextWindowStartMs`) are the
 * consumer's cut state immediately AFTER that batch's cut (see
 * `postCutGrid`). Replaying from those anchors over the same store re-cuts
 * the SAME batches with the SAME ordinals and watermarks — so a re-cut
 * batch's idempotency key equals the original's and the W303 dispatcher
 * dedupes it as a counted duplicate (never double-executed), and the
 * checkpoint grid continues exactly (same subsequent checkpoints). A
 * checkpoint that instead snapshotted the LIVE consumer cursor would
 * silently lose the batches cut-but-unresolved at cut time under
 * fresh-process recovery — the at-least-once violation this anchoring
 * closes.
 */
export interface RenderCheckpoint {
  /** 1-based cut ordinal (monotone across the whole session). */
  index: number;
  /** The crossing batch's watermark. */
  watermark: Watermark;
  /** The crossing batch's last update sequence — the resume anchor. */
  consumedThroughSequence: number;
  /** The next cut batch's ordinal (`crossingBatch.ordinal + 1`). */
  nextBatchOrdinal: number;
  /** The consumer's next grid boundary after the crossing batch's cut. */
  nextBoundaryMs: number;
  /** The consumer's next window start after the crossing batch's cut. */
  nextWindowStartMs: number;
  /** Cumulative render-protocol terminal dispositions at cut (the resume skip set). */
  processedKeys: ReadonlyArray<{ key: string; disposition: "rendered" | "render-failed" }>;
  /** Accounting snapshot at cut (evidence). */
  stats: RenderOrchestrationStats;
  /** Protocol-clock reading at cut. */
  atMs: number;
}

// ---------------------------------------------------------------------------
// Accounting stats + assertions
// ---------------------------------------------------------------------------

/** Whole-orchestration accounting (invariants in the module doc). */
export interface RenderOrchestrationStats {
  /** Batches cut by the consumer (the input count). */
  batchesIn: number;
  /** Outputs emitted in watermark order. */
  batchesRendered: number;
  /** Degradation skips (admission + dequeue). */
  batchesSkippedStale: number;
  /** Dropped by policy — the exact sum of the seven labeled reasons (identity 5). */
  batchesDropped: number;
  /** Cancelled at stop (dequeue sweep + W303 job cancels). */
  batchesCancelled: number;
  /** Duplicate skips (checkpoint skip at consume + dispatcher-resolved duplicates). */
  batchesDuplicateSkips: number;
  /** Cut-but-not-yet-terminal batches (0 at settle). */
  batchesInFlight: number;
  /** Sub-counters (identities and labeled evidence). */
  batchesSkippedStaleAtAdmission: number;
  batchesSkippedStaleInQueue: number;
  batchesDuplicateSkipsAtConsume: number;
  batchesDuplicateSubmits: number;
  /** Batches closed by `maxUpdatesPerBatch` (a window split across batches). */
  batchSplits: number;
  batchesQueueEvicted: number;
  batchesQueueRefused: number;
  batchesAbandoned: number;
  batchesRenderQueueRefused: number;
  batchesRenderFailed: number;
  batchesReorderOverflow: number;
  batchesRenderOutputInvalid: number;
  batchesSentToQueue: number;
  batchesReceivedFromQueue: number;
  /** Batches in the bounded queue right now (0 at settle). */
  queuedNow: number;
  batchesCancelledInQueue: number;
  batchesRenderCancelled: number;
  renderJobsSubmitted: number;
  renderJobsDuplicate: number;
  renderJobsInFlight: number;
  /** Sends attempted while the queue was already full (must park under `block`). */
  consumerSendParkAttempts: number;
  outputsEmitted: number;
  checkpointsCut: number;
  /**
   * Peak batches simultaneously inside the system (queued + submitted +
   * executing + reorder-held) — THE bounded-memory evidence: it plateaus at
   * the configured bounds, never at stream length.
   */
  peakBatchesInSystem: number;
  peakQueuedNow: number;
  peakReorderSize: number;
  /** Highest measured stream-head-minus-emitted-watermark lag at emission (ms). */
  maxEmissionLagMs: number;
}

/** A fresh all-zero stats snapshot. */
export function emptyStats(): RenderOrchestrationStats {
  return {
    batchesIn: 0,
    batchesRendered: 0,
    batchesSkippedStale: 0,
    batchesDropped: 0,
    batchesCancelled: 0,
    batchesDuplicateSkips: 0,
    batchesInFlight: 0,
    batchesSkippedStaleAtAdmission: 0,
    batchesSkippedStaleInQueue: 0,
    batchesDuplicateSkipsAtConsume: 0,
    batchesDuplicateSubmits: 0,
    batchSplits: 0,
    batchesQueueEvicted: 0,
    batchesQueueRefused: 0,
    batchesAbandoned: 0,
    batchesRenderQueueRefused: 0,
    batchesRenderFailed: 0,
    batchesReorderOverflow: 0,
    batchesRenderOutputInvalid: 0,
    batchesSentToQueue: 0,
    batchesReceivedFromQueue: 0,
    queuedNow: 0,
    batchesCancelledInQueue: 0,
    batchesRenderCancelled: 0,
    renderJobsSubmitted: 0,
    renderJobsDuplicate: 0,
    renderJobsInFlight: 0,
    consumerSendParkAttempts: 0,
    outputsEmitted: 0,
    checkpointsCut: 0,
    peakBatchesInSystem: 0,
    peakQueuedNow: 0,
    peakReorderSize: 0,
    maxEmissionLagMs: 0,
  };
}

/** Each master-identity check, spelled out for the assertion message. */
const IDENTITY_LABELS = [
  "batchesIn === duplicateSkipsAtConsume + staleAtAdmission + sentToQueue + queueRefused + abandoned",
  "batchesSentToQueue === receivedFromQueue + queueEvicted + queuedNow",
  "batchesReceivedFromQueue === jobsSubmitted + jobDuplicates + staleInQueue + renderQueueRefused + cancelledInQueue",
  "renderJobsSubmitted === rendered + renderFailed + renderCancelled + reorderOverflow + outputInvalid + jobsInFlight",
  "batchesDropped === queueEvicted + queueRefused + abandoned + renderQueueRefused + renderFailed + reorderOverflow + outputInvalid",
  "master: batchesIn === rendered + skippedStale + dropped + cancelled + duplicateSkips + inFlight",
  "batchesSkippedStale === staleAtAdmission + staleInQueue",
  "batchesDuplicateSkips === duplicateSkipsAtConsume + duplicateSubmits",
  "batchesRendered === outputsEmitted",
] as const;

/**
 * Asserts every accounting invariant (throws `RangeError` with the identity's
 * label and the full breakdown on imbalance). Called internally at every
 * settle before a result is returned; exported so tests and operators
 * re-verify any snapshot.
 */
export function assertRenderAccounting(stats: RenderOrchestrationStats): void {
  const checks: Array<[boolean, string]> = [
    [
      stats.batchesIn ===
        stats.batchesDuplicateSkipsAtConsume +
          stats.batchesSkippedStaleAtAdmission +
          stats.batchesSentToQueue +
          stats.batchesQueueRefused +
          stats.batchesAbandoned,
      IDENTITY_LABELS[0]!,
    ],
    [
      stats.batchesSentToQueue ===
        stats.batchesReceivedFromQueue + stats.batchesQueueEvicted + stats.queuedNow,
      IDENTITY_LABELS[1]!,
    ],
    [
      stats.batchesReceivedFromQueue ===
        stats.renderJobsSubmitted +
          stats.renderJobsDuplicate +
          stats.batchesSkippedStaleInQueue +
          stats.batchesRenderQueueRefused +
          stats.batchesCancelledInQueue,
      IDENTITY_LABELS[2]!,
    ],
    [
      stats.renderJobsSubmitted ===
        stats.batchesRendered +
          stats.batchesRenderFailed +
          stats.batchesRenderCancelled +
          stats.batchesReorderOverflow +
          stats.batchesRenderOutputInvalid +
          stats.renderJobsInFlight,
      IDENTITY_LABELS[3]!,
    ],
    [
      stats.batchesDropped ===
        stats.batchesQueueEvicted +
          stats.batchesQueueRefused +
          stats.batchesAbandoned +
          stats.batchesRenderQueueRefused +
          stats.batchesRenderFailed +
          stats.batchesReorderOverflow +
          stats.batchesRenderOutputInvalid,
      IDENTITY_LABELS[4]!,
    ],
    [
      stats.batchesIn ===
        stats.batchesRendered +
          stats.batchesSkippedStale +
          stats.batchesDropped +
          stats.batchesCancelled +
          stats.batchesDuplicateSkips +
          stats.batchesInFlight,
      IDENTITY_LABELS[5]!,
    ],
    [
      stats.batchesSkippedStale ===
        stats.batchesSkippedStaleAtAdmission + stats.batchesSkippedStaleInQueue,
      IDENTITY_LABELS[6]!,
    ],
    [
      stats.batchesDuplicateSkips ===
        stats.batchesDuplicateSkipsAtConsume + stats.batchesDuplicateSubmits,
      IDENTITY_LABELS[7]!,
    ],
    [stats.batchesRendered === stats.outputsEmitted, IDENTITY_LABELS[8]!],
  ];
  for (const [ok, label] of checks) {
    if (!ok) {
      throw new RangeError(
        `render-orchestration identity broken: ${label} — ${JSON.stringify(stats)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Limits, workers, options, results
// ---------------------------------------------------------------------------

/** Bounded-resource limits for one orchestrator run. */
export interface RenderOrchestrationLimits {
  /** Maximum updates in one batch (integer >= 1). */
  maxUpdatesPerBatch: number;
  /** Batch boundary interval on the watermark timeline, ms (finite > 0). */
  batchIntervalMs: number;
  /** The batch channel's message capacity (integer >= 1). */
  maxQueuedBatches: number;
  /** The batch channel's payload-byte budget (finite >= 0; 0 = count-bound only). */
  maxQueuedBatchBytes: number;
  /** Maximum completed outputs held for in-order emission (integer >= 1). */
  maxReorderOutputs: number;
  /** The W303 dispatcher's ready-queue bound (integer >= 1). */
  maxQueuedRenderJobs: number;
  /** The W303 dispatcher's admitted-job budget (integer >= 1). */
  maxAdmittedJobs: number;
  /** The W303 dispatcher's DLQ retention (integer >= 1). */
  maxDlqEntries: number;
}

/** Frozen default limits (magnitudes from the W302/W303 defaults). */
export const DEFAULT_RENDER_LIMITS: RenderOrchestrationLimits = Object.freeze({
  maxUpdatesPerBatch: 8,
  batchIntervalMs: 1_000,
  maxQueuedBatches: 16,
  maxQueuedBatchBytes: 0,
  maxReorderOutputs: 16,
  maxQueuedRenderJobs: 64,
  maxAdmittedJobs: 1_000_000,
  maxDlqEntries: 1_000,
});

/** One declared render worker (the W303 capabilities declaration). */
export interface RenderWorkerSpec {
  /** Worker identity (non-empty; unique among live workers). */
  workerId: string;
  /** Maximum simultaneously leased render jobs (integer >= 1). */
  maxConcurrentJobs: number;
  /** Declared memory capacity in MB (finite >= 0; default 4096, advisory). */
  memoryMb?: number;
  /** Heartbeat period in ms (finite > 0; default 100). */
  heartbeatIntervalMs?: number;
}

/** Observability seams for the orchestrator; every field optional. */
export interface RenderOrchestrationObservability {
  logger?: Logger;
  metrics?: MetricsRegistry;
  correlation?: CorrelationContext;
}

/** How a stop treats work still inside the system. */
export type RenderStopMode = "drain" | "cancel";

/**
 * Options for {@link ./orchestrator!RenderOrchestrator}. The orchestrator
 * owns the whole in-process wiring: the W104 `BoundedChannel` between
 * consumption and render work, the W303 dispatcher + reference workers (one
 * per {@link RenderWorkerSpec}), and the two pumps; the caller provides the
 * store seam, the render executor seam, the request template, and the
 * injected clock (shared by every component — no wall time anywhere).
 */
export interface RenderOrchestrationOptions {
  sessionId: string;
  /** The growing SWM store to consume incrementally. */
  store: SwmUpdateStore;
  /** The render executor (the W304 seam; see {@link RenderBatchExecutor}). */
  renderExecutor: RenderBatchExecutor;
  /**
   * The request template for per-batch renders: validated once at
   * construction (`RenderRequest.parse`); each batch renders with
   * `snapshotVersion` kept verbatim and `eventsSinceSequence` set to the
   * batch's `fromSequence` (honest provenance — the W502 manifest echoes
   * both). The executor interprets it (the provided anime executor targets
   * `anime.prototype@0.1.0`).
   */
  renderRequest: RenderRequest;
  /** The injected protocol clock — REQUIRED (never a wall clock). */
  clock: GpuClock;
  /** Batch grid origin: the first boundary is `startMs + batchIntervalMs` (default 0). */
  startMs?: number;
  limits?: Partial<RenderOrchestrationLimits>;
  /** Degradation policy (default: `skipStale: "disabled"` — explicit opt-in). */
  degradation?: DegradationPolicy;
  /** Worker declarations (default: one worker `render-worker-0`, 2 concurrent). */
  workers?: RenderWorkerSpec[];
  /** Whole-job render deadline in ms (finite > 0; default 60_000). */
  renderDeadlineMs?: number;
  /**
   * Executor retry policy within one claim (default: NO retries — the
   * W302/W303/W104 explicit-opt-in posture). Lease-expiry requeue is the
   * dispatcher-level retry layer.
   */
  executorRetry?: GpuWorkerRetryPolicy;
  /** Dispatcher lease/staleness/claim-budget tuning (defaults: W303's). */
  leaseMs?: number;
  staleAfterMs?: number;
  defaultMaxAttempts?: number;
  /** The batch-channel backpressure policy (default `block`; W104 semantics verbatim). */
  backpressure?: BackpressurePolicy;
  /** The output sink — called in watermark order, awaited (backpressure propagates). */
  onOutput?: (record: RenderOutputRecord) => Promise<void> | void;
  observability?: RenderOrchestrationObservability;
}

/**
 * The settled end-of-run result: accounting runtime-asserted BEFORE this
 * value exists (an imbalance rejects the settle promise — never a lying
 * result).
 */
export interface RenderOrchestrationResult {
  sessionId: string;
  /** `completed` = stream fully consumed and drained; `stopped` = drain-mode stop; `cancelled` = cancel-mode stop; `failed` = terminal failure. */
  outcome: "completed" | "stopped" | "cancelled" | "failed";
  /** Present iff `outcome === "failed"`. */
  terminalFailureClass?: TerminalFailureClass;
  /** Present iff `outcome === "failed"`. */
  error?: string;
  /** Final accounting snapshot (all invariants hold). */
  stats: RenderOrchestrationStats;
  /** Emitted outputs in watermark order (this run). */
  outputs: RenderOutputRecord[];
  /** This run's checkpoint cuts (boundary-crossing order). */
  checkpoints: RenderCheckpoint[];
  /** Every batch's terminal disposition record, in terminal order (this run). */
  ledger: RenderBatchLedgerEntry[];
  /** The batch channel's own drop counter (cross-boundary identity evidence). */
  channelDropped: number;
  /** Accounting-balance proof (runtime-asserted before settling). */
  balanced: true;
}

/** Options for {@link ./orchestrator!RenderOrchestrator.resume}. */
export interface RenderResumeOptions {
  /** The checkpoint to resume from (validated fail-loud). */
  checkpoint: RenderCheckpoint;
  /**
   * `skip` (the Recovery rule): re-consumed batches whose idempotency key is
   * in the checkpoint are counted duplicates and NEVER re-submitted.
   * `reprocess`: the skip is disabled — every re-cut batch is re-submitted,
   * and the W303 dispatcher's own key registry dedupes the previously
   * submitted ones (counted duplicates, never double-executed). Reprocessing
   * is EXPLICIT, never a silent default.
   */
  mode: "skip" | "reprocess";
}

// ---------------------------------------------------------------------------
// Metric vocabulary
// ---------------------------------------------------------------------------

/**
 * Metric names emitted by the render-orchestration boundary (W007 seam),
 * package-prefixed so unlabeled series cannot collide with other stages'
 * series in a shared registry (the W302/W303 precedent).
 */
export const RENDER_METRIC_NAMES = {
  batchesIn: "render_batches_in_total",
  batchesRendered: "render_batches_rendered_total",
  batchesSkippedStale: "render_batches_skipped_stale_total",
  batchesDropped: "render_batches_dropped_total",
  batchesCancelled: "render_batches_cancelled_total",
  batchesDuplicate: "render_batches_duplicate_total",
  outputsEmitted: "render_outputs_emitted_total",
  checkpointsCut: "render_checkpoints_cut_total",
  consumerParkAttempts: "render_consumer_park_attempts_total",
  watermarkLagAtEmissionMs: "render_watermark_lag_at_emission_ms",
} as const;
