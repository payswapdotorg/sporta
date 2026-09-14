/**
 * `ProcessingPipeline` (W302) — the bounded multi-stage processing engine.
 *
 * N stages, N+1 bounded queues (`BoundedChannel`, W104 semantics VERBATIM):
 * `submit()` feeds queue 0; stage i's workers pull queue i, run the stage's
 * async transform under `withRetries` (W104 — injectable clock, pure
 * arithmetic backoff, non-retryable failures NEVER blind-retried), and push
 * the transformed segment into queue i+1; queue N is the output the consumer
 * drains. Backpressure propagates upstream through the channels' own park
 * semantics: a full `block` output parks the last stage's send, which fills
 * the inter-stage queues, which parks every stage up to the producer —
 * bounded memory end to end (architecture-lock §8/§13), proven by the burst
 * tests.
 *
 * Every segment ends in EXACTLY ONE terminal bucket —
 * `segmentsIn === segmentsOut + rejected + duplicates + deadLettered +
 * abandoned + dropped` — with the four balance invariants and the
 * per-stage/per-channel flow identities runtime-asserted BEFORE the result
 * settles (an imbalance rejects `done()` instead of returning a lying
 * result — the W301 fail-loud posture). Every decision is counted, logged,
 * metered, and ledgered; correlation ids flow end-to-end on every stage
 * message (W007).
 *
 * Cancellation is idempotent with two honest modes:
 *
 * - `stop()` (default, `drain`): the input queue closes, in-flight stage
 *   work COMPLETES, every admitted segment flows to the output queue, the
 *   output closes, then the result settles (the W104 StageRunner cascade —
 *   internal queues are PROVEN empty at settle). A submit parked on the
 *   input queue at close-time is accounted `abandoned` (the W301
 *   parked-send precedent). Drain requires the consumer to keep receiving
 *   the output — otherwise the final sends park (documented, the W104
 *   behavior);
 * - `stop({ mode: "cancel" })`: every queue closes immediately; in-flight
 *   transforms still complete-or-fail (a promise cannot be killed), but
 *   their results cannot be delivered — parked sends, un-sent results, and
 *   every segment still queued in an internal queue are accounted
 *   ABANDONED, one ledger record each, never silent.
 *
 * Recovery (streaming contract): terminal dispositions (last-stage emission,
 * dead-letter) register the segment's idempotency key; re-submissions of a
 * registered key are counted duplicates (skipped); watermark-boundary
 * checkpoints (`checkpointEveryMs`) snapshot the cumulative processed-key
 * set so `resumePipeline` can resume from a safe point — at-least-once for
 * everything not yet terminally disposed.
 *
 * Determinism: the ONLY clock is the injected `ProcessingClock` (retry
 * backoff sleeping, latency, DLQ/checkpoint timestamps); no `Date.now`, no
 * `Math.random`, no real timers anywhere in this module.
 */
import { SCHEMA_VERSION } from "@sporta/contracts";
import type { StageMessage, StageResult } from "@sporta/contracts";
import { MetricsRegistry, bindLogger, createLogger, fromStageMessage } from "@sporta/observability";
import type { CorrelationContext, Logger } from "@sporta/observability";
import {
  BoundedChannel,
  ChannelClosedError,
  ResourceLimitError,
  validateRetryOptions,
  withRetries,
} from "@sporta/transport";
import type { RetryOptions } from "@sporta/transport";
import { CheckpointTracker } from "./checkpoint";
import { DeadLetterQueue } from "./dlq";
import { InvalidPipelineStateError, MalformedSegmentError } from "./errors";
import { TerminalDispositionRegistry } from "./registry";
import type { PipelineSegment } from "./segment";
import { validatePipelineSegment } from "./segment";
import {
  DEFAULT_PROCESSING_LIMITS,
  PROCESSING_METRIC_NAMES as METRICS,
  assertAccountingBalance,
  emptyStageStats,
  emptyStats,
  reconcileStageFlows,
} from "./types";
import type {
  DeadLetterEntry,
  PipelineCheckpoint,
  PipelineRejectionRecord,
  PipelineResult,
  PipelineStats,
  PipelineStageSpec,
  ProcessingPipelineOptions,
  ProcessingLimits,
  StageQueueSpec,
  StageStats,
  StageOutcome,
  SubmitOutcome,
} from "./types";

/** Log/metric stage name for pipeline-boundary records. */
const PIPELINE_STAGE = "processing-pipeline";

/** Label key carrying the failure class on the rejection counter. */
const FAILURE_CLASS_LABEL = "failure_class";

/** Label key carrying the stage id on the retries counter. */
const STAGE_LABEL = "stage";

/** Retry options for stages that declared none — NO retries by default (W104). */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 1,
  baseDelayMs: 0,
  backoffMultiplier: 1,
};

/** Options for {@link ProcessingPipeline.submit}. */
export interface SubmitOptions {
  /** Correlation id for this submission (default: the pipeline's context id). */
  correlationId?: string;
  /** Trace id for this submission (default: the pipeline's context id). */
  traceId?: string;
}

/** How a stop was requested. */
export type StopMode = "drain" | "cancel";

/** Lifecycle phase of one pipeline run. */
export type PipelinePhase = "created" | "running" | "stopping" | "ended";

/** The queue policies a `StageQueueSpec.policy` may take (W104). */
const QUEUE_POLICIES: ReadonlyArray<StageQueueSpec["policy"]> = ["block", "reject", "drop-oldest"];

/** The pipeline's byte sizer: a segment's own declared `byteSize`. */
function segmentSizer(msg: StageMessage): number {
  const segment = msg.payload as PipelineSegment;
  const size = segment?.byteSize;
  return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : 0;
}

/** Structural validation of one stage outcome (fail-loud on bad shapes). */
function isValidOutcome(outcome: StageOutcome): boolean {
  if (outcome === null || typeof outcome !== "object") return false;
  if (outcome.status === "emitted") {
    return outcome.segment !== null && typeof outcome.segment === "object";
  }
  if (outcome.status === "failed") {
    return (
      typeof outcome.retryable === "boolean" &&
      typeof outcome.errorClass === "string" &&
      outcome.errorClass.length > 0 &&
      typeof outcome.message === "string"
    );
  }
  return false;
}

/**
 * The bounded multi-stage processing pipeline. Construct with the wiring
 * (session, stages, queues, clock, limits, observability); `start()` spins
 * the stage workers; `submit()` feeds segments; `stop()` settles; `done()`
 * awaits the settled result; `stats()`, `stageStats()`, `deadLetters()`,
 * `checkpoints()`, `rejections()`, `outputChannel()` observe.
 */
export class ProcessingPipeline {
  private readonly sessionId: string;
  private readonly stages: PipelineStageSpec[];
  private readonly channels: BoundedChannel<StageMessage>[] = [];
  private readonly clock: ProcessingPipelineOptions["clock"];
  private readonly limits: ProcessingLimits;
  private readonly logger: Logger;
  private readonly metrics: MetricsRegistry;
  private readonly correlation: CorrelationContext;
  private readonly resourceBudget: ProcessingPipelineOptions["resourceBudget"];
  private readonly registry = new TerminalDispositionRegistry();
  private readonly dlq: DeadLetterQueue;
  private readonly tracker: CheckpointTracker | undefined;
  private readonly queueSpecs: StageQueueSpec[] = [];
  private readonly cutCheckpoints: PipelineCheckpoint[] = [];
  private readonly rejectionLedger: PipelineRejectionRecord[] = [];
  private readonly stageAccounting: StageStats[] = [];
  private readonly retryOptions: RetryOptions[];
  private readonly counters: PipelineCounters = emptyStats() as PipelineCounters;

  private phase: PipelinePhase = "created";
  private settlePromise: Promise<PipelineResult> | undefined;
  private stopGate: Promise<void> | undefined;
  private stopGateResolve: (() => void) | undefined;
  private stopRequested = false;
  private cancelRequested = false;
  private cancelling = false;
  private fatalRecorded = false;
  private pendingAdmission = 0;
  private nextSequence = 0;
  private terminal: { failureClass: "resource-limit" | "internal"; message: string } | undefined;
  private settledResult: PipelineResult | undefined;

  constructor(options: ProcessingPipelineOptions) {
    if (typeof options.sessionId !== "string" || options.sessionId.length < 1) {
      throw new RangeError("ProcessingPipeline requires a non-empty sessionId");
    }
    if (!Array.isArray(options.stages) || options.stages.length < 1) {
      throw new RangeError("ProcessingPipeline requires at least one stage");
    }
    if (options.queues !== undefined && options.queue !== undefined) {
      throw new RangeError("ProcessingPipeline accepts either `queues` or `queue`, not both");
    }
    if (
      options.clock === null ||
      typeof options.clock !== "object" ||
      typeof options.clock.now !== "function" ||
      typeof options.clock.sleep !== "function"
    ) {
      throw new TypeError(
        "ProcessingPipeline requires an injected ProcessingClock (now() + sleep())",
      );
    }

    // --- stages (unique ids, valid transforms/concurrency/retry specs) -----
    const stageIds = new Set<string>();
    this.retryOptions = [];
    for (const spec of options.stages) {
      if (spec === null || typeof spec !== "object") {
        throw new TypeError("PipelineStageSpec must be an object");
      }
      if (typeof spec.stage !== "string" || spec.stage.length < 1) {
        throw new RangeError(
          `PipelineStageSpec.stage must be a non-empty string (got ${String(spec.stage)})`,
        );
      }
      if (stageIds.has(spec.stage)) {
        throw new RangeError(`duplicate stage id '${spec.stage}' — stage ids must be unique`);
      }
      stageIds.add(spec.stage);
      if (typeof spec.transform !== "function") {
        throw new TypeError(`stage '${spec.stage}' requires a transform function`);
      }
      if (
        spec.concurrency !== undefined &&
        (!Number.isInteger(spec.concurrency) || spec.concurrency < 1)
      ) {
        throw new RangeError(
          `stage '${spec.stage}' concurrency must be an integer >= 1 ` +
            `(got ${String(spec.concurrency)})`,
        );
      }
      if (spec.retry !== undefined) validateRetryOptions(spec.retry);
      this.retryOptions.push(spec.retry ?? DEFAULT_RETRY_OPTIONS);
      this.stageAccounting.push(emptyStageStats(spec.stage));
    }
    this.stages = [...options.stages];

    // --- queues (exactly N+1 channels, W104 semantics verbatim) ------------
    const queueCount = this.stages.length + 1;
    let specs: StageQueueSpec[];
    if (options.queues !== undefined) {
      if (!Array.isArray(options.queues) || options.queues.length !== queueCount) {
        throw new RangeError(
          `ProcessingPipeline queues must have exactly ${queueCount} entries ` +
            `(stages + 1: input, inter-stage, output) — got ${String(options.queues?.length)}`,
        );
      }
      specs = [...options.queues];
    } else if (options.queue !== undefined) {
      specs = Array.from({ length: queueCount }, () => options.queue as StageQueueSpec);
    } else {
      specs = Array.from({ length: queueCount }, () => ({ capacity: 16, policy: "block" }));
    }

    // --- clock, limits, observability --------------------------------------
    this.sessionId = options.sessionId;
    this.clock = options.clock;
    this.limits = options.limits ?? DEFAULT_PROCESSING_LIMITS;
    if (
      !Number.isInteger(this.limits.maxDeadLetterEntries) ||
      this.limits.maxDeadLetterEntries < 1
    ) {
      throw new RangeError(
        `ProcessingLimits.maxDeadLetterEntries must be an integer >= 1 ` +
          `(got ${String(this.limits.maxDeadLetterEntries)})`,
      );
    }
    if (!Number.isInteger(this.limits.maxAdmittedSegments) || this.limits.maxAdmittedSegments < 1) {
      throw new RangeError(
        `ProcessingLimits.maxAdmittedSegments must be an integer >= 1 ` +
          `(got ${String(this.limits.maxAdmittedSegments)})`,
      );
    }
    if (options.checkpointEveryMs !== undefined) {
      if (!Number.isFinite(options.checkpointEveryMs) || options.checkpointEveryMs <= 0) {
        throw new RangeError(
          `ProcessingPipeline checkpointEveryMs must be a finite number > 0 ` +
            `(got ${String(options.checkpointEveryMs)})`,
        );
      }
      this.tracker = new CheckpointTracker(options.checkpointEveryMs);
    }

    const noopLogger = createLogger({ minLevel: "error", sink: () => {} });
    this.logger = options.observability?.logger ?? noopLogger;
    this.metrics = options.observability?.metrics ?? new MetricsRegistry();
    this.correlation = options.observability?.correlation ?? {
      sessionId: this.sessionId,
      correlationId: `corr-pipe-${this.sessionId}`,
      traceId: `trace-pipe-${this.sessionId}`,
    };
    this.resourceBudget = options.resourceBudget;
    this.dlq = new DeadLetterQueue(this.limits.maxDeadLetterEntries, this.logger, this.metrics);

    for (const preloaded of options.preloadedDispositions ?? []) {
      if (preloaded === null || typeof preloaded !== "object") {
        throw new TypeError("preloadedDispositions entries must be objects");
      }
      if (typeof preloaded.key !== "string" || preloaded.key.length < 1) {
        throw new RangeError("preloadedDispositions entries need a non-empty key");
      }
      if (preloaded.disposition !== "emitted" && preloaded.disposition !== "dead-lettered") {
        throw new RangeError(
          `preloadedDispositions disposition must be "emitted" | "dead-lettered" ` +
            `(got ${String(preloaded.disposition)})`,
        );
      }
      this.registry.put(preloaded.key, preloaded.disposition);
    }

    // --- channels (created LAST: they observe logger/metrics) --------------
    const channelObservability = { logger: this.logger, metrics: this.metrics };
    for (const spec of specs) {
      if (!Number.isInteger(spec.capacity) || spec.capacity < 1) {
        throw new RangeError(
          `StageQueueSpec.capacity must be an integer >= 1 (got ${String(spec.capacity)})`,
        );
      }
      if (spec.maxBytes !== undefined && (!Number.isFinite(spec.maxBytes) || spec.maxBytes < 0)) {
        throw new RangeError(
          `StageQueueSpec.maxBytes must be a finite number >= 0 (got ${String(spec.maxBytes)})`,
        );
      }
      if (!QUEUE_POLICIES.includes(spec.policy)) {
        throw new RangeError(
          `StageQueueSpec.policy must be one of "block" | "reject" | "drop-oldest" ` +
            `(got ${String(spec.policy)})`,
        );
      }
      this.queueSpecs.push({ ...spec });
      this.channels.push(
        new BoundedChannel<StageMessage>(
          {
            capacity: spec.capacity,
            maxBytes: spec.maxBytes,
            policy: spec.policy,
            sizer: segmentSizer,
          },
          channelObservability,
        ),
      );
    }
  }

  // --- lifecycle -----------------------------------------------------------

  /** Current lifecycle phase (`created` until `start()`, `ended` after settle). */
  get currentPhase(): PipelinePhase {
    return this.phase;
  }

  /**
   * Spins the stage workers and begins processing. Throws
   * {@link InvalidPipelineStateError} when already started or ended.
   */
  start(): void {
    if (this.phase !== "created") {
      throw new InvalidPipelineStateError(`pipeline is already ${this.phase}`);
    }
    this.phase = "running";
    this.stopGate = new Promise<void>((resolve) => {
      this.stopGateResolve = resolve;
    });
    this.settlePromise = this.orchestrate();
    this.stageLogger().info("pipeline started", {
      stages: this.stages.map((spec) => spec.stage),
      queueCount: this.queueSpecs.length,
      queuePolicies: this.queueSpecs.map((spec) => spec.policy),
      queueCapacities: this.queueSpecs.map((spec) => spec.capacity),
    });
  }

  /**
   * Settles the pipeline (idempotent). Default `drain` mode: the input queue
   * closes, in-flight stage work COMPLETES, every admitted segment reaches
   * the output queue, the output closes, the result settles (internal queues
   * proven empty). `cancel` mode: every queue closes immediately and
   * everything unresolved is accounted ABANDONED (never silent). Returns the
   * settled {@link PipelineResult}; the balance assertions run BEFORE the
   * result is returned — an imbalance rejects this promise.
   */
  async stop(options: { mode?: StopMode } = {}): Promise<PipelineResult> {
    const mode = options.mode ?? "drain";
    if (mode !== "drain" && mode !== "cancel") {
      throw new RangeError(`stop mode must be "drain" | "cancel" (got ${String(mode)})`);
    }
    if (this.phase === "created") {
      throw new InvalidPipelineStateError("cannot stop a pipeline before start()");
    }
    if (this.phase === "ended" && this.settledResult !== undefined) {
      return this.settledResult;
    }
    if (this.phase === "stopping") {
      return await this.done();
    }
    this.stopRequested = true;
    this.cancelRequested = mode === "cancel";
    this.phase = "stopping";
    this.stopGateResolve?.();
    return await this.done();
  }

  /**
   * Resolves with the settled {@link PipelineResult} when the pipeline ends
   * (`stop()` or terminal failure). Rejects on an accounting-imbalance bug —
   * a result that cannot be trusted is never returned. Throws when called
   * before `start()`.
   */
  done(): Promise<PipelineResult> {
    if (this.settlePromise === undefined) {
      throw new InvalidPipelineStateError("pipeline has not been started");
    }
    return this.settlePromise;
  }

  // --- producer boundary ---------------------------------------------------

  /**
   * Submits one segment to the pipeline. Resolves with the accounted
   * disposition:
   *
   * - `admitted` — the segment entered the input queue (bounded; under the
   *   `block` policy the promise parks until space frees — natural
   *   backpressure);
   * - `rejected` — the input queue refused the segment under its `reject`
   *   policy, or the segment can never fit the byte budget, or the admitted
   *   budget is exhausted (each counted + ledgered + logged + metered, the
   *   W104 `ResourceLimitError` details carried on the outcome);
   * - `duplicate` — the key is terminally-disposed already (counted, skipped);
   * - `abandoned` — the pipeline stopped before the segment was admitted
   *   (e.g. a parked send closed by `stop()` — the W301 precedent).
   *
   * A MALFORMED segment rejects the returned promise with
   * {@link MalformedSegmentError} (fail-loud, counted `rejectedMalformed`,
   * ledgered — the pipeline continues with the next segment). Calls after
   * `stop()`/settle throw {@link InvalidPipelineStateError} (caller error,
   * nothing accounted).
   */
  async submit(segment: PipelineSegment, options: SubmitOptions = {}): Promise<SubmitOutcome> {
    if (this.phase !== "running") {
      throw new InvalidPipelineStateError(
        `submit() requires a running pipeline (phase: ${this.phase})`,
      );
    }
    if (options.correlationId !== undefined && options.correlationId.length < 1) {
      throw new RangeError("submit correlationId must be a non-empty string when given");
    }
    if (options.traceId !== undefined && options.traceId.length < 1) {
      throw new RangeError("submit traceId must be a non-empty string when given");
    }

    this.counters.segmentsIn += 1;
    this.metrics.counter(METRICS.segmentsIn).inc();
    const line = this.stageLogger();

    // --- validation (fail-loud; the pipeline continues) ---------------------
    try {
      validatePipelineSegment(segment);
    } catch (err) {
      if (err instanceof MalformedSegmentError) {
        this.counters.rejected += 1;
        this.counters.rejectedMalformed += 1;
        this.recordRejection(
          typeof segment?.idempotencyKey === "string" ? segment.idempotencyKey : null,
          "rejected",
          "media-invalid",
          typeof err.details.reason === "string" ? err.details.reason : "malformed-segment",
          err.message,
          null,
          err.details,
        );
        throw err;
      }
      throw err;
    }

    // --- idempotency (the streaming-contract Recovery rule) -----------------
    const known = this.registry.get(segment.idempotencyKey);
    if (known !== undefined) {
      this.counters.duplicates += 1;
      this.metrics.counter(METRICS.duplicatesTotal).inc();
      line.info("pipeline segment re-submitted (idempotent duplicate)", {
        idempotencyKey: segment.idempotencyKey,
        firstDisposition: known.disposition,
        sequence: this.nextSequence,
      });
      return {
        disposition: "duplicate",
        idempotencyKey: segment.idempotencyKey,
        firstDisposition: known.disposition,
      };
    }

    // --- admitted-segment budget (fail-loud, the W301 posture) --------------
    if (this.counters.admitted + this.pendingAdmission + 1 > this.limits.maxAdmittedSegments) {
      this.counters.rejected += 1;
      this.counters.rejectedLimit += 1;
      const message =
        `pipeline exceeded its admitted-segment budget: ` +
        `${this.counters.admitted + this.pendingAdmission + 1} > ${this.limits.maxAdmittedSegments}`;
      this.recordRejection(
        segment.idempotencyKey,
        "rejected",
        "resource-limit",
        "segment-budget-exhausted",
        message,
        null,
        { admitted: this.counters.admitted, maxAdmittedSegments: this.limits.maxAdmittedSegments },
      );
      this.terminate("resource-limit", message);
      return {
        disposition: "rejected",
        rejection: {
          reason: "segment-budget-exhausted",
          failureClass: "resource-limit",
          details: { maxAdmittedSegments: this.limits.maxAdmittedSegments },
        },
      };
    }

    // --- bounded input send (the channel owns the policy) -------------------
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    const message: StageMessage = {
      sessionId: this.sessionId,
      schemaVersion: SCHEMA_VERSION,
      sequence,
      // The payload's OWN watermark, VERBATIM (never re-stamped; multi-track
      // feeds are not forced monotone — the W301 rule).
      watermark: { ...segment.watermark },
      payload: segment,
      correlationId: options.correlationId ?? this.correlation.correlationId,
      traceId: options.traceId ?? this.correlation.traceId,
      ...(this.resourceBudget === undefined ? {} : { resourceBudget: this.resourceBudget }),
    };
    this.pendingAdmission += 1;
    let sendError: unknown;
    try {
      await this.channels[0]!.send(message);
    } catch (err) {
      sendError = err;
    }
    this.pendingAdmission -= 1;

    if (sendError === undefined) {
      this.counters.admitted += 1;
      line.info("pipeline segment admitted", {
        idempotencyKey: segment.idempotencyKey,
        sequence,
        watermarkMs: segment.watermark.watermarkMs,
        byteSize: segment.byteSize,
      });
      return { disposition: "admitted", sequence };
    }
    if (sendError instanceof ResourceLimitError) {
      this.counters.rejected += 1;
      this.counters.rejectedBackpressure += 1;
      const details = { ...sendError.details, segmentId: segment.idempotencyKey, sequence };
      this.recordRejection(
        segment.idempotencyKey,
        "rejected",
        "resource-limit",
        "input-queue-full",
        `input queue refused the segment under its backpressure policy: ${sendError.message}`,
        null,
        details,
      );
      return {
        disposition: "rejected",
        rejection: {
          reason: "input-queue-full",
          failureClass: "resource-limit",
          details,
        },
      };
    }
    if (sendError instanceof ChannelClosedError) {
      this.accountAbandonedAdmission(
        segment,
        sequence,
        this.stopRequested ? "stop-closed-input" : "input-closed-externally",
      );
      return {
        disposition: "abandoned",
        idempotencyKey: segment.idempotencyKey,
        reason: this.stopRequested ? "stop-closed-input" : "input-closed-externally",
      };
    }
    // Unexpected send failure: account the in-flight attempt (never a silent
    // loss) and terminate with an internal failure — the W301 posture.
    this.accountAbandonedAdmission(segment, sequence, "send-failed");
    this.terminate(
      "internal",
      `input send failed unexpectedly: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
    );
    return {
      disposition: "abandoned",
      idempotencyKey: segment.idempotencyKey,
      reason: "send-failed",
    };
  }

  // --- observation ---------------------------------------------------------

  /** The output channel the consumer drains (the pipeline's last queue). */
  outputChannel(): BoundedChannel<StageMessage> {
    return this.channels[this.channels.length - 1]!;
  }

  /** Fresh whole-pipeline accounting snapshot (live counters + queue depths). */
  stats(): PipelineStats {
    return this.statsSnapshot();
  }

  /** Fresh per-stage stats snapshot (stage order). */
  stageStats(): StageStats[] {
    return this.stageAccounting.map((stage) => ({ ...stage }));
  }

  /** Retained dead-letter entries in occurrence order (frozen entries). */
  deadLetters(): DeadLetterEntry[] {
    return this.dlq.list();
  }

  /** Retained DLQ entry count. */
  get deadLetterCount(): number {
    return this.dlq.size;
  }

  /** DLQ entries beyond the retention bound (counted + logged + metered). */
  get deadLetterOverflow(): number {
    return this.dlq.overflow;
  }

  /** Cut checkpoints in cut order (fresh shallow copies; entries frozen). */
  checkpoints(): PipelineCheckpoint[] {
    return [...this.cutCheckpoints];
  }

  /** The latest cut checkpoint, when any. */
  latestCheckpoint(): PipelineCheckpoint | undefined {
    return this.cutCheckpoints.length === 0
      ? undefined
      : { ...this.cutCheckpoints[this.cutCheckpoints.length - 1]! };
  }

  /** The fail-loud rejection/abandonment ledger (fresh copies, order of occurrence). */
  rejections(): PipelineRejectionRecord[] {
    return this.rejectionLedger.map((record) => ({
      ...record,
      details: { ...record.details },
    }));
  }

  // --- the orchestration ----------------------------------------------------

  /**
   * Runs the stage workers until stop/terminal-failure, applies the drain
   * cascade or the cancel sweep, reconciles every accounting identity, and
   * settles the result. Imbalance THROWS (rejects `done()`) — never a lying
   * result.
   */
  private async orchestrate(): Promise<PipelineResult> {
    const stagePromises = this.stages.map((_, i) => this.runStageWorkers(i));
    await this.stopGate;

    let drainedAll = false;
    if (!this.cancelRequested && !this.fatalRecorded) {
      let completed = true;
      for (let i = 0; i < this.stages.length; i += 1) {
        if (this.fatalRecorded || this.cancelRequested) {
          completed = false;
          break;
        }
        this.channels[i]!.close();
        await stagePromises[i]!;
      }
      drainedAll = completed && !this.fatalRecorded && !this.cancelRequested;
    }

    if (drainedAll) {
      // Orderly drain: every worker exited on a closed-and-drained input, so
      // the output closes now (queued emitted messages stay receivable —
      // no loss after admission, W104). Internal queues are PROVEN empty.
      this.channels[this.channels.length - 1]!.close();
      this.assertInternalQueuesEmpty();
    } else {
      // Cancel (or fatal): close everything, let in-flight transforms
      // complete-or-fail, then sweep every segment still queued internally.
      this.cancelling = true;
      for (const channel of this.channels) channel.close();
      await Promise.all(stagePromises);
      this.sweepInternalQueues();
    }

    // --- reconcile + settle (the never-silent proof) ------------------------
    this.phase = "ended";
    const stats = this.statsSnapshot();
    const stageSnapshot = this.stageStats();
    assertAccountingBalance(stats);
    reconcileStageFlows(
      stats,
      stageSnapshot,
      this.channels.slice(0, this.stages.length).map((channel) => channel.dropped),
    );
    const lastStage = stageSnapshot[stageSnapshot.length - 1];
    if (lastStage !== undefined && lastStage.emitted !== stats.segmentsOut) {
      throw new RangeError(
        `last-stage emissions do not match segmentsOut: ${lastStage.emitted} != ${stats.segmentsOut}`,
      );
    }
    if (this.pendingAdmission !== 0) {
      throw new RangeError(
        `input sends still pending at settle (${this.pendingAdmission}) — cannot settle`,
      );
    }
    for (const stage of stageSnapshot) {
      if (stage.inFlight !== 0) {
        throw new RangeError(
          `stage '${stage.stage}' still has ${stage.inFlight} segment(s) in flight at settle`,
        );
      }
    }

    const result = this.buildResult(stats, stageSnapshot);
    this.settledResult = result;
    this.stageLogger().info("pipeline settled", {
      outcome: result.outcome,
      ...(result.terminalFailureClass === undefined
        ? {}
        : { terminalFailureClass: result.terminalFailureClass, error: result.error }),
      stats,
    });
    return result;
  }

  /** One stage's worker set as a single promise (fatal errors recorded, not thrown). */
  private runStageWorkers(stageIndex: number): Promise<void> {
    const concurrency = this.stages[stageIndex]!.concurrency ?? 1;
    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i += 1) {
      workers.push(this.stageWorkerLoop(stageIndex));
    }
    return Promise.all(workers).then(() => undefined);
  }

  /** One receive → transform → send loop; exits on orderly end or cancel. */
  private async stageWorkerLoop(stageIndex: number): Promise<void> {
    const input = this.channels[stageIndex]!;
    try {
      for (;;) {
        if (this.cancelling) return;
        let msg: StageMessage;
        try {
          msg = await input.receive();
        } catch (err) {
          if (err instanceof ChannelClosedError) return; // orderly end of input
          this.recordFatal(err, this.stages[stageIndex]!.stage);
          return;
        }
        await this.processOne(stageIndex, msg);
      }
    } catch (err) {
      // Internal bug (not a classified boundary decision): fail loud, wind
      // down through the cancel path, keep every segment accounted.
      this.recordFatal(err, this.stages[stageIndex]!.stage);
    }
  }

  /** Processes one segment through one stage: retries, DLQ, bounded send. */
  private async processOne(stageIndex: number, msg: StageMessage): Promise<void> {
    const spec = this.stages[stageIndex]!;
    const stage = this.stageAccounting[stageIndex]!;
    const segment = msg.payload as PipelineSegment;
    const isLast = stageIndex === this.stages.length - 1;
    const line = bindLogger(this.logger, fromStageMessage(msg), spec.stage);

    stage.received += 1;
    stage.inFlight += 1;

    // The retry-wrapped handler (W104 `withRetries`, injectable clock):
    // per-attempt latency summed; thrown/invalid transforms become internal
    // NON-retryable failures — never retried blindly (the W104 rule).
    let emittedSegment: PipelineSegment | undefined;
    let failureMessage = "";
    let latencyTotal = 0;
    const handler = async (m: StageMessage): Promise<StageResult> => {
      const startedAt = this.clock.now();
      try {
        const outcome = await spec.transform(segment);
        const elapsed = this.clock.now() - startedAt;
        latencyTotal += elapsed;
        if (!isValidOutcome(outcome)) {
          failureMessage = `stage '${spec.stage}' returned an invalid outcome shape`;
          return {
            sessionId: m.sessionId,
            stage: spec.stage,
            status: "failed",
            watermarkAfter: segment.watermark,
            latencyMs: elapsed,
            retryable: false,
            errorClass: "internal",
          };
        }
        if (outcome.status === "emitted") {
          try {
            validatePipelineSegment(outcome.segment);
          } catch {
            failureMessage = `stage '${spec.stage}' emitted an invalid segment (idempotency key '${segment.idempotencyKey}')`;
            return {
              sessionId: m.sessionId,
              stage: spec.stage,
              status: "failed",
              watermarkAfter: segment.watermark,
              latencyMs: elapsed,
              retryable: false,
              errorClass: "internal",
            };
          }
          emittedSegment = outcome.segment;
          return {
            sessionId: m.sessionId,
            stage: spec.stage,
            status: "ok",
            watermarkAfter: outcome.segment.watermark,
            latencyMs: elapsed,
            retryable: false,
          };
        }
        failureMessage = outcome.message;
        return {
          sessionId: m.sessionId,
          stage: spec.stage,
          status: "failed",
          watermarkAfter: segment.watermark,
          latencyMs: elapsed,
          retryable: outcome.retryable,
          errorClass: outcome.errorClass,
        };
      } catch (err) {
        const elapsed = this.clock.now() - startedAt;
        latencyTotal += elapsed;
        failureMessage = err instanceof Error ? err.message : String(err);
        return {
          sessionId: m.sessionId,
          stage: spec.stage,
          status: "failed",
          watermarkAfter: segment.watermark,
          latencyMs: elapsed,
          retryable: false,
          errorClass: "internal",
        };
      }
    };

    const outcome = await withRetries(msg, handler, {
      ...this.retryOptions[stageIndex]!,
      clock: { sleep: (ms) => this.clock.sleep(ms) },
    });
    stage.retries += outcome.retriesUsed;
    if (outcome.retriesUsed > 0) {
      this.metrics
        .counter(METRICS.retriesTotal, { [STAGE_LABEL]: spec.stage })
        .inc(outcome.retriesUsed);
    }
    this.metrics.histogram(METRICS.stageLatencyMs).observe(latencyTotal);

    // ONE info line per segment per stage (the W104 contract), correlated.
    line.info("stage segment processed", {
      idempotencyKey: segment.idempotencyKey,
      sequence: msg.sequence,
      status: outcome.status,
      attempts: outcome.attempts,
      retriesUsed: outcome.retriesUsed,
      latencyMs: latencyTotal,
      ...(outcome.errorClass === undefined ? {} : { errorClass: outcome.errorClass }),
    });

    if (outcome.status !== "failed") {
      // Emitted: bounded send downstream (the channel owns the policy).
      const outSegment = emittedSegment as PipelineSegment;
      const outMessage: StageMessage = {
        sessionId: msg.sessionId,
        schemaVersion: msg.schemaVersion,
        sequence: msg.sequence,
        watermark: { ...outSegment.watermark },
        payload: outSegment,
        correlationId: msg.correlationId,
        traceId: msg.traceId,
        ...(msg.resourceBudget === undefined ? {} : { resourceBudget: msg.resourceBudget }),
      };
      try {
        await this.channels[stageIndex + 1]!.send(outMessage);
      } catch (err) {
        stage.inFlight -= 1;
        if (err instanceof ResourceLimitError) {
          stage.refused += 1;
          this.accountRefusedDownstream(stageIndex, msg, outSegment, err);
          return;
        }
        if (err instanceof ChannelClosedError) {
          stage.abandonedInFlight += 1;
          this.accountAbandonedProcessing(
            stageIndex,
            msg,
            outSegment,
            this.cancelling ? "cancel-closed-queue" : "queue-closed-externally",
          );
          return;
        }
        // Unexpected send error (a channel bug — W104 channels only throw
        // the two classified types above): the segment still lands in its
        // ONE terminal bucket (abandoned), the failure is recorded, and the
        // pipeline terminates fail-loud — never a silent loss.
        stage.abandonedInFlight += 1;
        this.accountAbandonedProcessing(stageIndex, msg, outSegment, "send-failed-unexpectedly");
        this.recordFatal(err, spec.stage);
        return;
      }
      stage.inFlight -= 1;
      stage.emitted += 1;
      if (isLast) {
        this.accountEmitted(msg, outSegment);
      }
      return;
    }

    // Failed (final, after retries): straight to the DLQ — the final error
    // is never swallowed (W104), and the key's terminal disposition is
    // registered so resume will not reprocess it.
    stage.inFlight -= 1;
    stage.failed += 1;
    this.accountDeadLettered(stageIndex, msg, segment, outcome, failureMessage);
  }

  // --- terminal disposition accounting --------------------------------------

  /** Last-stage emission: `segmentsOut`, registry, checkpoint boundary. */
  private accountEmitted(msg: StageMessage, segment: PipelineSegment): void {
    this.counters.segmentsOut += 1;
    this.metrics.counter(METRICS.segmentsOut).inc();
    const newly = this.registry.put(segment.idempotencyKey, "emitted");
    this.stageLogger().info("pipeline segment emitted", {
      idempotencyKey: segment.idempotencyKey,
      sequence: msg.sequence,
      watermarkMs: segment.watermark.watermarkMs,
    });
    if (newly) this.maybeCutCheckpoint(segment, msg.sequence);
  }

  /** Terminal failure: DLQ entry (bounded), registry, checkpoint boundary. */
  private accountDeadLettered(
    stageIndex: number,
    msg: StageMessage,
    segment: PipelineSegment,
    outcome: { attempts: number; retriesUsed: number; retryable: boolean; errorClass?: string },
    failureMessage: string,
  ): void {
    const spec = this.stages[stageIndex]!;
    const errorClass = outcome.errorClass ?? "unclassified";
    const terminal: DeadLetterEntry["terminal"] =
      errorClass === "internal"
        ? "internal"
        : outcome.retryable && outcome.attempts >= this.retryOptions[stageIndex]!.maxAttempts
          ? "retry-exhausted"
          : "non-retryable";
    this.counters.deadLettered += 1;
    this.dlq.record({
      idempotencyKey: segment.idempotencyKey,
      stage: spec.stage,
      errorClass,
      message: failureMessage.length > 0 ? failureMessage : "unspecified stage failure",
      terminal,
      attempts: outcome.attempts,
      retriesUsed: outcome.retriesUsed,
      atMs: this.clock.now(),
      segment,
      sequence: msg.sequence,
      correlationId: msg.correlationId,
      traceId: msg.traceId,
    });
    const newly = this.registry.put(segment.idempotencyKey, "dead-lettered");
    if (newly) this.maybeCutCheckpoint(segment, msg.sequence);
  }

  /** Downstream queue refused a stage's send (counted, stream continues). */
  private accountRefusedDownstream(
    stageIndex: number,
    msg: StageMessage,
    segment: PipelineSegment,
    err: ResourceLimitError,
  ): void {
    this.counters.rejected += 1;
    this.counters.rejectedDownstream += 1;
    this.recordRejection(
      segment.idempotencyKey,
      "rejected",
      "resource-limit",
      "downstream-queue-full",
      `downstream queue refused the segment under its backpressure policy: ${err.message}`,
      this.stages[stageIndex]!.stage,
      { ...err.details, idempotencyKey: segment.idempotencyKey, sequence: msg.sequence },
    );
  }

  /** Stage-side abandonment (cancel/close while in flight or parked). */
  private accountAbandonedProcessing(
    stageIndex: number,
    msg: StageMessage,
    segment: PipelineSegment,
    reason: string,
  ): void {
    this.counters.abandoned += 1;
    this.counters.abandonedProcessing += 1;
    this.recordRejection(
      segment.idempotencyKey,
      "abandoned",
      "internal",
      reason,
      `segment '${segment.idempotencyKey}' abandoned at stage '${this.stages[stageIndex]!.stage}' (${reason}): work completed, never delivered downstream`,
      this.stages[stageIndex]!.stage,
      { idempotencyKey: segment.idempotencyKey, sequence: msg.sequence, reason },
    );
  }

  /** Submit-side abandonment (parked input send closed at stop, W301 precedent). */
  private accountAbandonedAdmission(
    segment: PipelineSegment,
    sequence: number,
    reason: string,
  ): void {
    this.counters.abandoned += 1;
    this.counters.abandonedAdmission += 1;
    this.recordRejection(
      segment.idempotencyKey,
      "abandoned",
      "internal",
      reason,
      `segment '${segment.idempotencyKey}' abandoned at submission (${reason}): never admitted to the pipeline`,
      null,
      { idempotencyKey: segment.idempotencyKey, sequence, reason },
    );
  }

  /** Appends one structured record to the fail-loud rejection ledger. */
  private recordRejection(
    idempotencyKey: string | null,
    bucket: PipelineRejectionRecord["bucket"],
    failureClass: PipelineRejectionRecord["failureClass"],
    reason: string,
    message: string,
    stage: string | null,
    details: Record<string, unknown>,
  ): void {
    this.rejectionLedger.push({
      idempotencyKey,
      bucket,
      failureClass,
      reason,
      message,
      stage,
      atMs: this.clock.now(),
      details,
    });
    this.metrics.counter(METRICS.rejectedTotal).inc();
    this.metrics.counter(METRICS.rejectedTotal, { [FAILURE_CLASS_LABEL]: failureClass }).inc();
    if (bucket === "abandoned") {
      this.metrics.counter(METRICS.abandonedTotal).inc();
      this.metrics.counter(METRICS.abandonedTotal, { reason }).inc();
    }
    this.stageLogger().warn("pipeline segment refused or abandoned", {
      bucket,
      failureClass,
      reason,
      error: message,
      ...details,
    });
  }

  // --- checkpoints -----------------------------------------------------------

  /** Cuts a checkpoint when a terminal disposition crosses the boundary. */
  private maybeCutCheckpoint(segment: PipelineSegment, sequence: number): void {
    if (this.tracker === undefined) return;
    if (!this.tracker.crossesBoundary(segment.watermark.watermarkMs)) return;
    const checkpoint = this.tracker.cut({
      watermarkMs: segment.watermark.watermarkMs,
      sequence,
      processedKeys: this.registry.processedKeys(),
      stats: this.statsSnapshot(),
      atMs: this.clock.now(),
    });
    this.cutCheckpoints.push(Object.freeze(checkpoint));
    this.metrics.counter(METRICS.checkpointsTotal).inc();
    this.stageLogger().info("pipeline checkpoint cut", {
      index: checkpoint.index,
      watermarkMs: checkpoint.watermark.watermarkMs,
      sequence,
      processedKeys: checkpoint.processedKeys.length,
      atMs: checkpoint.atMs,
    });
  }

  // --- wind-down helpers ------------------------------------------------------

  /**
   * Sweeps every segment still queued in the INPUT and INTER-stage queues
   * (cancel/fatal wind-down): each becomes an explicit ABANDONED ledger
   * record on the stage that would have processed it — never silent loss.
   */
  private sweepInternalQueues(): void {
    for (let j = 0; j < this.stages.length; j += 1) {
      const channel = this.channels[j]!;
      for (;;) {
        const msg = channel.tryReceive();
        if (msg === undefined) break;
        const segment = msg.payload as PipelineSegment;
        this.stageAccounting[j]!.abandonedQueued += 1;
        this.counters.abandoned += 1;
        this.counters.abandonedProcessing += 1;
        this.recordRejection(
          segment.idempotencyKey,
          "abandoned",
          "internal",
          "cancel-swept-queue",
          `segment '${segment.idempotencyKey}' abandoned (cancel-swept-queue): queued for stage '${this.stages[j]!.stage}', never processed`,
          this.stages[j]!.stage,
          { idempotencyKey: segment.idempotencyKey, sequence: msg.sequence, queueIndex: j },
        );
      }
    }
  }

  /**
   * The pure-drain completeness proof: after the orderly cascade every
   * internal queue is empty by construction — a residue would be an
   * invariant breach, so it fails LOUD instead of being reclassified.
   */
  private assertInternalQueuesEmpty(): void {
    for (let j = 0; j < this.stages.length; j += 1) {
      const channel = this.channels[j]!;
      if (channel.size !== 0) {
        throw new RangeError(
          `internal queue ${j} (stage '${this.stages[j]!.stage}') holds ${channel.size} ` +
            `segment(s) after an orderly drain — drain-completeness breach`,
        );
      }
    }
  }

  /** Records a terminal failure and releases the stop gate (first wins). */
  private terminate(failureClass: "resource-limit" | "internal", message: string): void {
    if (this.terminal === undefined) {
      this.terminal = { failureClass, message };
    }
    if (this.phase === "running") {
      this.phase = "stopping";
      this.stopRequested = true;
      this.stopGateResolve?.();
    }
    this.stageLogger().error("pipeline terminating", { failureClass, error: message });
  }

  /** A worker-level internal fault (defensive: classified errors never land here). */
  private recordFatal(err: unknown, stage: string): void {
    this.fatalRecorded = true;
    this.terminate(
      "internal",
      `stage '${stage}' crashed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- snapshots ---------------------------------------------------------------

  /** Live whole-pipeline snapshot: counters + reconciled dropped + depths. */
  private statsSnapshot(): PipelineStats {
    const internal = this.channels.slice(0, this.stages.length);
    const dropped = internal.reduce((sum, channel) => sum + channel.dropped, 0);
    return {
      ...this.counters,
      dropped,
      distinctProcessed: this.registry.size,
      dlqRetained: this.dlq.size,
      dlqOverflow: this.dlq.overflow,
      queueDepths: this.channels.map((channel) => channel.size),
    };
  }

  /** The settled end-of-run result (balances already asserted). */
  private buildResult(stats: PipelineStats, stages: StageStats[]): PipelineResult {
    return {
      sessionId: this.sessionId,
      outcome: this.terminal === undefined ? "stopped" : "failed",
      ...(this.terminal === undefined
        ? {}
        : { terminalFailureClass: this.terminal.failureClass, error: this.terminal.message }),
      stats,
      stages,
      balanced: true,
    };
  }

  /** Binds correlation + pipeline stage onto a child logger. */
  private stageLogger(): Logger {
    return bindLogger(this.logger, this.correlation, PIPELINE_STAGE);
  }
}

/** The mutable counter subset the pipeline owns (snapshot projects the rest). */
type PipelineCounters = Omit<
  PipelineStats,
  "dropped" | "distinctProcessed" | "dlqRetained" | "dlqOverflow" | "queueDepths"
>;
