/**
 * `RenderOrchestrator` (W304) — the streaming render orchestration service:
 * incremental SWM updates in, watermark-ordered rendered outputs out, with
 * bounded memory and exact never-silent accounting.
 *
 * THE WIRING (one orchestrator owns the whole in-process chain):
 *
 * ```
 * store (SwmUpdateStore, W402-style incremental queries)
 *   └─ consumer pump: cut watermark-aligned bounded batches
 *        ├─ resume skip (counted duplicates — never re-submitted)
 *        ├─ degradation: skip-stale at admission (counted, never re-stamped)
 *        └─ W104 BoundedChannel (block / reject / drop-oldest, verbatim)
 *             └─ scheduler pump: dequeue → skip-stale re-check → submit
 *                  └─ W303 GpuJobDispatcher (job envelopes, idempotency keys
 *                     from batch watermarks, leases, retries, DLQ — VERBATIM)
 *                       └─ GpuWorker(s) → render executor seam (the real
 *                          W502 anime plugin) → job results
 *                            └─ emitter: bounded reorder → outputs in
 *                               watermark order + provenance
 * ```
 *
 * THE ACCEPTANCE CORE (W304: "incremental SWM updates can drive renderer work
 * without unbounded backlog"): every buffer in the chain is bounded and loud
 * — the batch channel (capacity + optional byte budget, W104 policies), the
 * W303 ready queue (typed `GpuResourceLimitError` refusals), the reorder
 * buffer (overflow counted `reorder-overflow`, never a silent drop), and the
 * explicit skip-stale degradation policy. `stats.peakBatchesInSystem` is the
 * bounded-memory PROOF: it plateaus at the configured bounds under any
 * burst, never at stream length (test-pinned in `test/burst.test.ts`).
 *
 * THE NEVER-SILENT CONSTITUTION, runtime-asserted at every settle (an
 * imbalance REJECTS the settle promise — never a lying result):
 * `batchesIn === rendered + skippedStale + dropped + cancelled +
 * duplicates + inFlight(0 at settle)` plus the five sub-identities in
 * `types.ts`. Every terminal decision is counted + logged + metered +
 * ledgered (one `RenderBatchLedgerEntry` per batch, exactly one). Emission
 * is SERIALIZED through one drain chain, so the sink is called strictly in
 * watermark order even when jobs complete out of order or the sink resolves
 * out of order (test-pinned in `test/emission.test.ts`).
 *
 * RECOVERY (the streaming contract's Recovery rule): checkpoints are cut at
 * watermark boundaries whenever a batch's terminal disposition crosses the
 * next boundary (the W302 posture), and every resume anchor is derived from
 * the CROSSING BATCH — its `toSequence`, its `ordinal + 1`, and the
 * consumer-grid state right after its cut (`postCutGrid`) — so a replay
 * re-cuts the SAME batches (same ordinals, same watermarks, same
 * idempotency keys) and the W303 dispatcher's key registry dedupes anything
 * already executed. `resume({ mode: "skip" })` skips checkpointed keys at
 * consume (counted duplicates); `resume({ mode: "reprocess" })` re-submits
 * every re-cut batch and the dispatcher dedupes (counted duplicates, never
 * double-executed). In-process recovery keeps the dispatcher's ledger alive
 * across runs (that IS the idempotency registry); a crash that loses it is
 * a W303 documented limitation (the ledger is in-memory).
 *
 * DETERMINISM (the constitution): the ONLY clock is the injected `GpuClock`
 * shared by the orchestrator, the dispatcher, the workers, and the render
 * executor — no `Date.now`, no `Math.random`, no real timers anywhere. The
 * pumps wait passively (`waitUntil` + a stop signal raced against it) or on
 * the channel's own bounded sends; a store that announces a non-future
 * growth time is refused loudly (it would spin the consumer); the whole
 * story is deep-equal across two fresh runs (test-pinned,
 * `test/determinism.test.ts`).
 */
import {
  RenderRequest as RenderRequestSchema,
  SCHEMA_VERSION,
  type RenderRequest,
  type StageMessage,
  type TerminalFailureClass,
} from "@sporta/contracts";
import {
  GpuJobDispatcher,
  GpuResourceLimitError,
  GpuWorker,
  InvalidDispatcherStateError,
  MalformedJobError,
  type GpuClock,
  type GpuDispatchStats,
  type GpuDispatcherPort,
  type GpuExecutorOutcome,
  type GpuJobEnvelope,
  type GpuJobExecutor,
  type GpuJobResult,
  type GpuSubmitHandle,
  type GpuWorkerCapabilities,
} from "@sporta/gpu-worker";
import type { AnimeRenderOutput } from "@sporta/renderer-anime";
import { MetricsRegistry, bindLogger, createLogger } from "@sporta/observability";
import type { CorrelationContext, Logger } from "@sporta/observability";
import { BoundedChannel, ChannelClosedError, ResourceLimitError } from "@sporta/transport";
import { boundaryAt, cutBatch, jobIdOf } from "./batch";
import { RenderCheckpointTracker, validateRenderCheckpoint } from "./checkpoint";
import { assertAnimeRenderOutputShape } from "./executor";
import { InvalidOrchestratorPhaseError, InvalidOrchestratorStateError } from "./errors";
import { evaluateStaleSkip } from "./policy";
import { BatchRegistry } from "./registry";
import {
  DEFAULT_RENDER_LIMITS,
  RENDER_METRIC_NAMES as METRICS,
  assertRenderAccounting,
  emptyStats,
} from "./types";
import type {
  BatchClosedBy,
  BatchDropReason,
  DegradationPolicy,
  RenderBatch,
  RenderBatchLedgerEntry,
  RenderCheckpoint,
  RenderOrchestrationLimits,
  RenderOrchestrationOptions,
  RenderOrchestrationResult,
  RenderOrchestrationStats,
  RenderOutputRecord,
  RenderResumeOptions,
  RenderStopMode,
  RenderWorkerSpec,
  StaleDecision,
  SwmUpdate,
  SwmUpdateStore,
} from "./types";

/** Lifecycle phase of one orchestrator. */
export type RenderOrchestratorPhase = "created" | "running" | "stopped" | "ended";

/** Log/metric stage name for every record this boundary emits. */
const ORCHESTRATOR_STAGE = "render-orchestration";

/** The terminal-outcome vocabulary (see `RenderBatchLedgerEntry`). */
type TerminalOutcome =
  | { disposition: "rendered" }
  | { disposition: "duplicate"; jobId?: string; details?: Record<string, unknown> }
  | { disposition: "cancelled"; jobId?: string; details?: Record<string, unknown> }
  | {
      disposition: "skipped-stale";
      phase: "admission" | "dequeue";
      decision: StaleDecision;
    }
  | {
      disposition: "dropped";
      dropReason: BatchDropReason;
      jobId?: string;
      terminalClass?: string;
      details?: Record<string, unknown>;
    };

/** The abstract W303 job class for render work (vendor-neutral by design). */
const RENDER_JOB_CLASS = "render";

/** The W303 `payloadRef` prefix (opaque to the protocol; resolved by the adapter). */
const PAYLOAD_REF_PREFIX = "render-batch:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertFinitePositive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a finite number > 0 (got ${String(value)})`);
  }
  return value;
}

function assertIntegerMin(value: unknown, min: number, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new RangeError(`${field} must be an integer >= ${min} (got ${String(value)})`);
  }
  return value;
}

/**
 * The streaming render orchestrator. Construct with the wiring (store,
 * executor, request template, clock); `start()` spins the dispatcher, the
 * workers, and the two pumps; `stop()` drains or cancels with exact
 * accounting; `resume()` restarts from a checkpoint; `done()` settles;
 * `shutdown()` tears the whole chain down.
 */
export class RenderOrchestrator {
  // --- wiring ---------------------------------------------------------------
  private readonly sessionId: string;
  private readonly store: SwmUpdateStore;
  private readonly renderExecutor: RenderOrchestrationOptions["renderExecutor"];
  private readonly requestTemplate: RenderRequest;
  private readonly clock: GpuClock;
  private readonly limits: RenderOrchestrationLimits;
  private readonly degradation: DegradationPolicy;
  private readonly renderDeadlineMs: number;
  private readonly backpressure: NonNullable<RenderOrchestrationOptions["backpressure"]>;
  private readonly onOutput: RenderOrchestrationOptions["onOutput"];
  private readonly logger: Logger;
  private readonly metrics: MetricsRegistry;
  private readonly correlation: CorrelationContext;
  private readonly workerSpecs: RenderWorkerSpec[];
  private readonly stageLogger: Logger;

  // --- owned components (persist across resumes) -----------------------------
  private readonly registry = new BatchRegistry();
  private readonly dispatcher: GpuJobDispatcher;
  private readonly workers: GpuWorker[] = [];
  /** Recreated per run (a closed channel cannot be re-sent). */
  private channel: BoundedChannel<StageMessage>;
  private tracker: RenderCheckpointTracker;

  // --- run state -------------------------------------------------------------
  private phase: RenderOrchestratorPhase = "created";
  private accounting: RenderOrchestrationStats = emptyStats();
  private runOutputs: RenderOutputRecord[] = [];
  private runLedger: RenderBatchLedgerEntry[] = [];
  private runCheckpoints: RenderCheckpoint[] = [];
  /** Cumulative render-protocol terminal keys (the checkpoint source). */
  private readonly sessionTerminalKeys = new Map<string, "rendered" | "render-failed">();
  private lastConsumedSequence = -1;
  private nextBatchOrdinal = 1;
  private boundaryMs: number;
  private windowStartMs: number;
  private skipSet: Set<string> | undefined;
  /** Ordinals that reached a terminal disposition (the emitter's advance set). */
  private readonly terminalOrdinals = new Set<number>();
  /** Completed outputs awaiting in-order emission, keyed by batch ordinal. */
  private readonly reorder = new Map<number, { batch: RenderBatch; record: RenderOutputRecord }>();
  private nextEmitOrdinal = 1;

  // --- pump state --------------------------------------------------------------
  private runPromise: Promise<void> | undefined;
  private consumerPromise: Promise<void> | undefined;
  private schedulerPromise: Promise<void> | undefined;
  private readonly pendingJobs = new Set<Promise<void>>();
  private stopRequested = false;
  private stopMode: RenderStopMode = "drain";
  private stopSignal: Promise<void>;
  private stopResolve: (() => void) | undefined;
  private settledResult: RenderOrchestrationResult | undefined;
  private lastChannelDropped = 0;
  /** Jobs submitted this session (jobId → batch), for cancel sweeps. */
  private readonly submittedJobs = new Map<string, RenderBatch>();
  private terminalFailure: { failureClass: TerminalFailureClass; message: string } | undefined;
  /**
   * The single serialized emission chain: exactly one drain pass runs at a
   * time (FIFO), so sink calls happen strictly in batch-ordinal order and
   * `runOutputs` can never invert — even under an async `onOutput` sink
   * whose promises resolve out of order (test-pinned in emission.test.ts).
   */
  private emissionTail: Promise<void> = Promise.resolve();

  constructor(options: RenderOrchestrationOptions) {
    if (typeof options.sessionId !== "string" || options.sessionId.length < 1) {
      throw new RangeError("RenderOrchestrator requires a non-empty sessionId");
    }
    if (!isRecord(options.store) || typeof options.store.availableWatermark !== "function") {
      throw new TypeError("RenderOrchestrator requires an SwmUpdateStore");
    }
    if (!isRecord(options.renderExecutor) || typeof options.renderExecutor.execute !== "function") {
      throw new TypeError("RenderOrchestrator requires a render executor with execute()");
    }
    if (options.renderRequest === null || typeof options.renderRequest !== "object") {
      throw new TypeError("RenderOrchestrator requires a render request template");
    }
    const parsedRequest = RenderRequestSchema.safeParse(options.renderRequest);
    if (!parsedRequest.success) {
      throw new RangeError(
        `RenderOrchestrator render request template is not a valid RenderRequest: ${parsedRequest.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    if (parsedRequest.data.sessionId !== options.sessionId) {
      throw new RangeError(
        `render request template belongs to session '${parsedRequest.data.sessionId}', ` +
          `not the orchestrated '${options.sessionId}'`,
      );
    }
    if (
      options.clock === null ||
      typeof options.clock !== "object" ||
      typeof options.clock.now !== "function" ||
      typeof options.clock.sleep !== "function" ||
      typeof options.clock.waitUntil !== "function"
    ) {
      throw new TypeError("RenderOrchestrator requires an injected GpuClock (now/sleep/waitUntil)");
    }
    const limits: RenderOrchestrationLimits = {
      ...DEFAULT_RENDER_LIMITS,
      ...(options.limits ?? {}),
    };
    assertIntegerMin(limits.maxUpdatesPerBatch, 1, "limits.maxUpdatesPerBatch");
    assertFinitePositive(limits.batchIntervalMs, "limits.batchIntervalMs");
    assertIntegerMin(limits.maxQueuedBatches, 1, "limits.maxQueuedBatches");
    if (!Number.isFinite(limits.maxQueuedBatchBytes) || limits.maxQueuedBatchBytes < 0) {
      throw new RangeError(
        `limits.maxQueuedBatchBytes must be a finite number >= 0 (got ${String(limits.maxQueuedBatchBytes)})`,
      );
    }
    assertIntegerMin(limits.maxReorderOutputs, 1, "limits.maxReorderOutputs");
    assertIntegerMin(limits.maxQueuedRenderJobs, 1, "limits.maxQueuedRenderJobs");
    assertIntegerMin(limits.maxAdmittedJobs, 1, "limits.maxAdmittedJobs");
    assertIntegerMin(limits.maxDlqEntries, 1, "limits.maxDlqEntries");
    const degradation = options.degradation ?? { skipStale: "disabled" as const };
    if (degradation.skipStale !== "disabled") {
      assertFinitePositive(
        degradation.skipStale.maxWatermarkLagMs,
        "degradation.skipStale.maxWatermarkLagMs",
      );
    }
    const startMs = options.startMs ?? 0;
    if (!Number.isFinite(startMs) || startMs < 0) {
      throw new RangeError(`startMs must be a finite number >= 0 (got ${String(startMs)})`);
    }
    const renderDeadlineMs = options.renderDeadlineMs ?? 60_000;
    assertFinitePositive(renderDeadlineMs, "renderDeadlineMs");
    const workerSpecs = options.workers ?? [{ workerId: "render-worker-0", maxConcurrentJobs: 2 }];
    if (!Array.isArray(workerSpecs) || workerSpecs.length === 0) {
      throw new RangeError("workers must be a non-empty array of RenderWorkerSpec");
    }
    for (const spec of workerSpecs) {
      if (typeof spec.workerId !== "string" || spec.workerId.length < 1) {
        throw new RangeError("worker specs need a non-empty workerId");
      }
      assertIntegerMin(spec.maxConcurrentJobs, 1, `workers[${spec.workerId}].maxConcurrentJobs`);
      if (spec.memoryMb !== undefined && (!Number.isFinite(spec.memoryMb) || spec.memoryMb < 0)) {
        throw new RangeError(
          `workers[${spec.workerId}].memoryMb must be a finite number >= 0 (got ${String(spec.memoryMb)})`,
        );
      }
      if (
        spec.heartbeatIntervalMs !== undefined &&
        (!Number.isFinite(spec.heartbeatIntervalMs) || spec.heartbeatIntervalMs <= 0)
      ) {
        throw new RangeError(
          `workers[${spec.workerId}].heartbeatIntervalMs must be a finite number > 0 (got ${String(spec.heartbeatIntervalMs)})`,
        );
      }
    }

    this.sessionId = options.sessionId;
    this.store = options.store;
    this.renderExecutor = options.renderExecutor;
    this.requestTemplate = parsedRequest.data;
    this.clock = options.clock;
    this.limits = limits;
    this.degradation = degradation;
    this.renderDeadlineMs = renderDeadlineMs;
    this.backpressure = options.backpressure ?? "block";
    this.onOutput = options.onOutput;
    this.workerSpecs = workerSpecs;

    const noopLogger = createLogger({ minLevel: "error", sink: () => {} });
    this.logger = options.observability?.logger ?? noopLogger;
    this.metrics = options.observability?.metrics ?? new MetricsRegistry();
    this.correlation = options.observability?.correlation ?? {
      sessionId: options.sessionId,
      correlationId: `corr-render-${options.sessionId}`,
      traceId: `trace-render-${options.sessionId}`,
    };
    this.stageLogger = bindLogger(this.logger, this.correlation, ORCHESTRATOR_STAGE);

    // --- the owned W303 chain (dispatcher + workers stay alive across resumes) ---
    this.dispatcher = new GpuJobDispatcher({
      dispatcherId: `render-${this.sessionId}`,
      clock: this.clock,
      ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
      ...(options.staleAfterMs === undefined ? {} : { staleAfterMs: options.staleAfterMs }),
      ...(options.defaultMaxAttempts === undefined
        ? {}
        : { defaultMaxAttempts: options.defaultMaxAttempts }),
      limits: {
        maxQueuedJobs: limits.maxQueuedRenderJobs,
        maxAdmittedJobs: limits.maxAdmittedJobs,
        maxDlqEntries: limits.maxDlqEntries,
      },
      observability: { logger: this.logger, metrics: this.metrics, correlation: this.correlation },
    });
    const gpuExecutor: GpuJobExecutor = {
      execute: async (job: GpuJobEnvelope): Promise<GpuExecutorOutcome> => {
        const batch = this.registry.resolve(job.payloadRef);
        const request = this.requestFor(batch);
        const outcome = await this.renderExecutor.execute(batch, request, { clock: this.clock });
        if (outcome.status === "succeeded") {
          return { status: "succeeded", output: outcome.output };
        }
        return {
          status: "failed",
          errorClass: outcome.errorClass,
          message: outcome.message,
          retryable: outcome.retryable,
        };
      },
    };
    const port: GpuDispatcherPort = this.dispatcher;
    for (const spec of this.workerSpecs) {
      const capabilities: GpuWorkerCapabilities = {
        workerId: spec.workerId,
        maxConcurrentJobs: spec.maxConcurrentJobs,
        memoryMb: spec.memoryMb ?? 4_096,
        modelClasses: [RENDER_JOB_CLASS],
        heartbeatIntervalMs: spec.heartbeatIntervalMs ?? 100,
      };
      this.workers.push(
        new GpuWorker({
          capabilities,
          executor: gpuExecutor,
          port,
          clock: this.clock,
          ...(options.executorRetry === undefined ? {} : { executorRetry: options.executorRetry }),
          observability: { logger: this.logger, correlation: this.correlation },
        }),
      );
    }

    // --- the owned W104 channel + the checkpoint grid --------------------------
    this.channel = this.freshChannel();
    this.boundaryMs = boundaryAt(startMs, limits.batchIntervalMs, 1);
    this.windowStartMs = startMs;
    this.tracker = new RenderCheckpointTracker({
      intervalMs: this.limits.batchIntervalMs,
      initialNextBoundaryMs: this.boundaryMs,
    });
    this.stopSignal = new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });
  }

  // --- public surface ---------------------------------------------------------

  /** Current lifecycle phase. */
  get currentPhase(): RenderOrchestratorPhase {
    return this.phase;
  }

  /** Live accounting snapshot (mid-run observability; a copy). */
  stats(): RenderOrchestrationStats {
    return { ...this.accounting };
  }

  /** This run's emitted outputs, in watermark order (a copy). */
  outputs(): RenderOutputRecord[] {
    return [...this.runOutputs];
  }

  /** This run's terminal ledger (a copy). */
  ledger(): RenderBatchLedgerEntry[] {
    return [...this.runLedger];
  }

  /** This run's checkpoint cuts (a copy). */
  checkpoints(): RenderCheckpoint[] {
    return [...this.runCheckpoints];
  }

  /** The W303 dispatcher's live stats (the inherited job-level ledger). */
  dispatchStats(): GpuDispatchStats {
    return this.dispatcher.stats();
  }

  /**
   * Starts the run: opens the dispatcher, starts the workers, spins the
   * consumer and scheduler pumps. Fail-loud (double start throws; use
   * `resume()` to restart after `stop()`).
   */
  async start(): Promise<void> {
    if (this.phase !== "created") {
      throw new InvalidOrchestratorPhaseError(
        `start() requires phase 'created' (got '${this.phase}')`,
      );
    }
    this.dispatcher.start();
    for (const worker of this.workers) {
      await worker.start();
    }
    this.phase = "running";
    this.stageLogger.info("render orchestration started", {
      backpressure: this.backpressure,
      limits: this.limits,
      degradation: this.degradation,
      renderDeadlineMs: this.renderDeadlineMs,
      workers: this.workerSpecs.length,
    });
    this.startPumps();
  }

  /**
   * Resolves when the run settles (natural completion, stop, or a terminal
   * failure) with the runtime-asserted result. An accounting imbalance or a
   * sink failure REJECTS this promise — never a lying result.
   */
  async done(): Promise<RenderOrchestrationResult> {
    if (this.phase === "created") {
      throw new InvalidOrchestratorPhaseError("done() requires a started orchestrator");
    }
    if (this.runPromise === undefined) {
      throw new InvalidOrchestratorStateError("done() on an unstarted run");
    }
    await this.runPromise;
    if (this.settledResult === undefined) {
      throw new InvalidOrchestratorStateError("run settled without a result");
    }
    return this.settledResult;
  }

  /**
   * Stops the run (idempotent — the second call returns the settled result).
   *
   * - `drain` (default): no NEW batches are cut; everything already inside
   *   the system completes — queued batches render, in-flight jobs settle,
   *   outputs emit in order, the reorder is proven empty. A consumer send
   *   parked on a full channel unblocks as the queue drains (only a stopped
   *   scheduler would strand it — that cannot happen before settle).
   * - `cancel`: the channel closes immediately (a parked send is accounted
   *   ABANDONED — the W301 posture), queued batches are accounted CANCELLED
   *   at dequeue, in-flight jobs are cancelled at the dispatcher (their
   *   eventual reports counted superseded by the protocol), and completed
   *   outputs still emit (completed work is never thrown away).
   */
  async stop(options: { mode?: RenderStopMode } = {}): Promise<RenderOrchestrationResult> {
    const mode = options.mode ?? "drain";
    if (mode !== "drain" && mode !== "cancel") {
      throw new RangeError(`stop mode must be "drain" | "cancel" (got ${String(mode)})`);
    }
    if ((this.phase === "stopped" || this.phase === "ended") && this.settledResult !== undefined) {
      return this.settledResult;
    }
    if (this.phase !== "running") {
      throw new InvalidOrchestratorPhaseError(
        `stop() requires phase 'running' (got '${this.phase}')`,
      );
    }
    this.stopRequested = true;
    this.stopMode = mode;
    this.stopResolve?.();
    if (mode === "cancel") {
      this.channel.close();
      for (const [jobId] of this.submittedJobs) {
        this.dispatcher.cancel(jobId);
      }
    }
    return await this.done();
  }

  /**
   * Restarts the pumps from a checkpoint (the streaming contract's Recovery
   * rule). The dispatcher and workers keep running — their ledger IS the
   * idempotency registry. `mode: "skip"` counts checkpointed keys as
   * duplicates (never re-submitted); `mode: "reprocess"` re-submits every
   * re-cut batch and lets the dispatcher's key registry dedupe (counted
   * duplicates, never double-executed). Batches that never reached the
   * render protocol (skipped, evicted, refused, cancelled) are reprocessed
   * in BOTH modes — at-least-once recovery, deduped on the key.
   */
  async resume(options: RenderResumeOptions): Promise<void> {
    if (this.phase !== "stopped") {
      throw new InvalidOrchestratorPhaseError(
        `resume() requires phase 'stopped' (got '${this.phase}')`,
      );
    }
    validateRenderCheckpoint(options.checkpoint);
    if (options.mode !== "skip" && options.mode !== "reprocess") {
      throw new RangeError(
        `resume mode must be "skip" | "reprocess" (got ${String(options.mode)})`,
      );
    }
    this.accounting = emptyStats();
    this.runOutputs = [];
    this.runLedger = [];
    this.runCheckpoints = [];
    this.lastConsumedSequence = options.checkpoint.consumedThroughSequence;
    this.nextBatchOrdinal = options.checkpoint.nextBatchOrdinal;
    this.nextEmitOrdinal = options.checkpoint.nextBatchOrdinal;
    this.boundaryMs = options.checkpoint.nextBoundaryMs;
    this.windowStartMs = options.checkpoint.nextWindowStartMs;
    this.terminalOrdinals.clear();
    this.reorder.clear();
    this.emissionTail = Promise.resolve();
    this.skipSet =
      options.mode === "skip"
        ? new Set(options.checkpoint.processedKeys.map((entry) => entry.key))
        : undefined;
    this.tracker = new RenderCheckpointTracker({
      intervalMs: this.limits.batchIntervalMs,
      initialNextBoundaryMs: options.checkpoint.nextBoundaryMs,
      initialCuts: options.checkpoint.index,
    });
    this.channel = this.freshChannel();
    this.lastChannelDropped = 0;
    this.stopRequested = false;
    this.stopMode = "drain";
    this.terminalFailure = undefined;
    this.settledResult = undefined;
    this.stopSignal = new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });
    this.phase = "running";
    this.stageLogger.info("render orchestration resumed", {
      checkpointIndex: options.checkpoint.index,
      checkpointWatermark: options.checkpoint.watermark,
      mode: options.mode,
      processedKeys: options.checkpoint.processedKeys.length,
    });
    this.startPumps();
  }

  /**
   * Tears the whole chain down (idempotent): drains the run (if still
   * running), stops the workers (await mode), and settles the dispatcher —
   * the W303 shutdown itself asserts the job-level accounting identity. The
   * orchestrator's own batch-level result (already runtime-asserted) is
   * returned. Requires a started orchestrator (nothing was wired before
   * `start()`).
   */
  async shutdown(): Promise<RenderOrchestrationResult> {
    if (this.phase === "created") {
      throw new InvalidOrchestratorPhaseError(
        "shutdown() requires a started orchestrator (call start() first)",
      );
    }
    if (this.phase === "ended") {
      if (this.settledResult === undefined) {
        throw new InvalidOrchestratorStateError("shutdown() on an ended run without a result");
      }
      return this.settledResult;
    }
    if (this.phase === "running") {
      await this.stop({ mode: "drain" });
    }
    for (const worker of this.workers) {
      await worker.stop({ mode: "await" });
    }
    await this.dispatcher.shutdown();
    this.phase = "ended";
    this.stageLogger.info("render orchestration ended", {});
    if (this.settledResult === undefined) {
      throw new InvalidOrchestratorStateError("shutdown() completed without a settled result");
    }
    return this.settledResult;
  }

  // --- pumps -------------------------------------------------------------------

  private startPumps(): void {
    this.runPromise = this.runToSettlement();
  }

  /** The full run: consumer → scheduler → pending jobs → settlement. */
  private async runToSettlement(): Promise<void> {
    this.consumerPromise = this.guardPump("consumer", () => this.consumeLoop());
    this.schedulerPromise = this.guardPump("scheduler", () => this.scheduleLoop());
    await this.consumerPromise;
    await this.schedulerPromise;
    const settled = await Promise.allSettled([...this.pendingJobs]);
    const rejection = settled.find((outcome) => outcome.status === "rejected");
    if (rejection !== undefined) {
      this.recordSinkFailure((rejection as PromiseRejectedResult).reason);
    }
    await this.finalizeRun();
  }

  /**
   * Records a sink/continuation failure — a tracked job promise REJECTED,
   * which can only mean the emission chain's `onOutput` sink (or its
   * continuation) threw: the terminal failure is captured (first failure
   * wins) and the reason is logged LOUD. Without this, the rejection would
   * surface only as the settle-time in-flight backstop ("N cut but never
   * terminally disposed") with NO trace of the root cause — fail-loud, but
   * about the WRONG thing. The batch itself is deliberately left un-disposed
   * (never a lying `rendered`): the settle-time assertion is the backstop
   * that rejects `done()`.
   */
  private recordSinkFailure(
    reason: unknown,
    evidence: { jobId: string; batchId: string; batchOrdinal: number } = {
      jobId: "unknown",
      batchId: "unknown",
      batchOrdinal: -1,
    },
  ): void {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (this.terminalFailure === undefined) {
      this.terminalFailure = {
        failureClass: "internal",
        message: `output sink or render continuation failed: ${message}`,
      };
    }
    this.stageLogger.error(`output sink or render continuation failed: ${message}`, {
      failureClass: "internal",
      ...evidence,
    });
  }

  /**
   * Runs one pump, converting an uncaught pump failure into a terminal
   * failure (outcome `"failed"`, message preserved) instead of a hang: the
   * stop signal fires and the channel ALWAYS closes (a scheduler parked on a
   * channel whose consumer died would otherwise wait forever). The run then
   * settles — either honestly failed, or (if the failure left accounting
   * imbalanced) with the settle-time assertion rejecting `done()` — never a
   * silent hole, never a hang.
   */
  private async guardPump(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.terminalFailure === undefined) {
        this.terminalFailure = {
          failureClass: "internal",
          message: `render ${name} pump failed: ${message}`,
        };
      }
      this.stopRequested = true;
      this.stopResolve?.();
      this.channel.close();
      this.stageLogger.error(`render ${name} pump failed (terminal)`, { error: message });
    }
  }

  /**
   * The consumer pump: cuts watermark-aligned bounded batches from the
   * growing store and pushes them through the bounded channel. Waits
   * PASSIVELY for stream growth (`waitUntil`, raced against the stop signal
   * — no busy loop, no timers). Exits when the stream is fully consumed, the
   * store stalls (neither complete nor growing — an honest `"stopped"`,
   * never a fake `"completed"`), or a stop was requested; ALWAYS closes the
   * channel on exit (finally — even on an unexpected throw) so the scheduler
   * can drain and terminate.
   */
  private async consumeLoop(): Promise<void> {
    try {
      while (!this.stopRequested) {
        const acted = await this.cutOneStep();
        if (acted) continue;
        if (this.store.isComplete()) {
          // Final flush: consume the remaining tail (the last partial window).
          const flushed = await this.cutFinalFlush();
          if (flushed) continue;
          break;
        }
        const next = this.store.nextGrowthAtMs();
        if (next === undefined) {
          // Neither complete nor growing: an honest stall. The run settles
          // "stopped" (the outcome gate requires isComplete() for
          // "completed") — never a fabricated completion.
          this.stageLogger.warn(
            "render consumer stalled: store announces no further growth and is not complete",
            {
              batchesIn: this.accounting.batchesIn,
              lastConsumedSequence: this.lastConsumedSequence,
            },
          );
          break;
        }
        if (next <= this.clock.now()) {
          throw new RangeError(
            `SwmUpdateStore.nextGrowthAtMs returned ${next} at clock ${this.clock.now()} ` +
              "— a growth time not strictly in the future would spin the consumer forever",
          );
        }
        await Promise.race([this.clock.waitUntil(next), this.stopSignal]);
      }
    } finally {
      this.channel.close();
    }
    this.stageLogger.info("render consumer exited", {
      stopRequested: this.stopRequested,
      batchesIn: this.accounting.batchesIn,
    });
  }

  /** One consumer step: cut one batch (or advance one empty window). */
  private async cutOneStep(): Promise<boolean> {
    const head = this.store.availableWatermark();
    if (head.watermarkMs < this.boundaryMs) {
      return false;
    }
    const slice = this.store.updatesAfter(
      this.lastConsumedSequence,
      this.boundaryMs,
      this.limits.maxUpdatesPerBatch,
    );
    if (slice.updates.length === 0) {
      // Empty window (the stream head jumped past it): advance the grid.
      this.windowStartMs = this.boundaryMs;
      this.boundaryMs += this.limits.batchIntervalMs;
      return true;
    }
    const closedBy: BatchClosedBy = slice.more ? "size-limit" : "watermark-boundary";
    await this.consumeSlice(slice.updates, closedBy, this.boundaryMs);
    return true;
  }

  /** The end-of-stream flush: the final partial window, honestly closed. */
  private async cutFinalFlush(): Promise<boolean> {
    const slice = this.store.updatesAfter(
      this.lastConsumedSequence,
      Number.POSITIVE_INFINITY,
      this.limits.maxUpdatesPerBatch,
    );
    if (slice.updates.length === 0) {
      return false;
    }
    const lastUpdate = slice.updates[slice.updates.length - 1]!;
    const closedBy: BatchClosedBy = slice.more ? "size-limit" : "stream-complete";
    const endMs = slice.more ? this.boundaryMs : lastUpdate.watermark.watermarkMs;
    await this.consumeSlice(slice.updates, closedBy, endMs);
    return true;
  }

  /** Consumes one bounded update slice as one batch (accounting + policy + send). */
  private async consumeSlice(
    updates: readonly SwmUpdate[],
    closedBy: BatchClosedBy,
    windowEndMs: number,
  ): Promise<void> {
    const batch = cutBatch({
      sessionId: this.sessionId,
      ordinal: this.nextBatchOrdinal,
      windowMs: { startMs: this.windowStartMs, endMs: windowEndMs },
      updates,
      closedBy,
    });
    this.nextBatchOrdinal += 1;
    this.lastConsumedSequence = batch.toSequence;
    this.registry.register(batch);
    this.accounting.batchesIn += 1;
    this.accounting.batchesInFlight += 1;
    this.observePeak();
    this.metrics.counter(METRICS.batchesIn).inc();
    this.stageLogger.debug("render batch cut", {
      batchId: batch.batchId,
      ordinal: batch.ordinal,
      watermark: batch.watermark,
      updates: batch.updates.length,
      closedBy: batch.closedBy,
      windowMs: batch.windowMs,
    });
    if (closedBy === "size-limit") {
      this.accounting.batchSplits += 1;
      this.windowStartMs = batch.watermark.watermarkMs;
    } else {
      this.windowStartMs = this.boundaryMs;
      this.boundaryMs += this.limits.batchIntervalMs;
    }

    // --- resume skip (the Recovery rule): checkpointed keys are duplicates ---
    if (this.skipSet !== undefined && this.skipSet.has(batch.idempotencyKey)) {
      this.accounting.batchesDuplicateSkips += 1;
      this.accounting.batchesDuplicateSkipsAtConsume += 1;
      await this.terminalBatch(batch, {
        disposition: "duplicate",
        details: { mode: "checkpoint-skip" },
      });
      return;
    }

    // --- degradation: skip-stale at admission (never re-stamped) ---
    const admission = evaluateStaleSkip(
      this.degradation,
      batch.watermark.watermarkMs,
      this.store.availableWatermark(),
    );
    if (admission.stale) {
      await this.terminalBatch(batch, {
        disposition: "skipped-stale",
        phase: "admission",
        decision: admission,
      });
      return;
    }

    await this.sendToQueue(batch);
  }

  /** Sends one batch into the bounded channel, accounting every outcome. */
  private async sendToQueue(batch: RenderBatch): Promise<void> {
    const message: StageMessage = {
      sessionId: this.sessionId,
      schemaVersion: SCHEMA_VERSION,
      sequence: batch.ordinal,
      watermark: { watermarkMs: batch.watermark.watermarkMs, sequence: batch.watermark.sequence },
      payload: batch,
      correlationId: this.correlation.correlationId,
      traceId: this.correlation.traceId,
      resourceBudget: { maxGpuMs: this.renderDeadlineMs },
    };
    if (this.channel.size >= this.limits.maxQueuedBatches || this.sendCannotFitBytes(batch)) {
      this.accounting.consumerSendParkAttempts += 1;
      this.metrics.counter(METRICS.consumerParkAttempts).inc();
    }
    // The incoming message alone exceeds the whole byte budget (W104
    // verbatim): under `drop-oldest` the channel itself drops it with its own
    // accounting and the send resolves; under `block`/`reject` the channel
    // throws the typed `ResourceLimitError` (block would otherwise wait
    // forever). Detected deterministically BEFORE the send so the accounting
    // stays exact and the doomed batch never enters the in-queue ledger.
    const neverFits =
      this.limits.maxQueuedBatchBytes > 0 && batch.byteSize > this.limits.maxQueuedBatchBytes;
    // Ledger BEFORE the send: on the direct-handoff path (a receiver is
    // parked, the channel hands the message straight to it), the DEQUEUE
    // continuation runs before this send's continuation — marking queued
    // after the send would leave a STALE ledger entry that breaks the
    // settle-time in-queue drain proof (test-pinned in emission.test.ts).
    if (!neverFits) {
      this.registry.markQueued(batch.batchId);
    }
    try {
      await this.channel.send(message);
    } catch (err) {
      this.registry.markDequeued(batch.batchId);
      if (err instanceof ChannelClosedError) {
        this.accounting.batchesAbandoned += 1;
        await this.terminalBatch(batch, {
          disposition: "dropped",
          dropReason: "abandoned-at-stop",
          details: { policy: this.backpressure },
        });
        return;
      }
      if (err instanceof ResourceLimitError) {
        this.accounting.batchesQueueRefused += 1;
        await this.terminalBatch(batch, {
          disposition: "dropped",
          dropReason: "queue-refused",
          details: { policy: this.backpressure, limit: err.details },
        });
        return;
      }
      throw err;
    }
    // The send resolved: admitted, or (neverFits) the channel itself dropped
    // the incoming message with its own accounting — attributed exactly. A
    // never-fits send DID reach the queue boundary (the send resolved at the
    // channel), so it counts in `batchesSentToQueue` AND in
    // `batchesQueueEvicted` (the channel-owned drop): identity 1
    // (`sent === received + evicted + queuedNow`) stays exact for BOTH the
    // evicted-oldest and the dropped-incoming shapes.
    await this.reconcileChannelDrops(neverFits ? 1 : 0);
    if (neverFits) {
      this.accounting.batchesSentToQueue += 1;
      this.accounting.batchesQueueEvicted += 1;
      await this.terminalBatch(batch, {
        disposition: "dropped",
        dropReason: "queue-evicted",
        details: {
          channelReason: "exceeds-byte-budget",
          byteSize: batch.byteSize,
          maxQueuedBatchBytes: this.limits.maxQueuedBatchBytes,
        },
      });
      return;
    }
    this.accounting.batchesSentToQueue += 1;
    this.observeQueued();
  }

  /**
   * Attributes channel-owned `drop-oldest` evictions to SPECIFIC batches:
   * the delta of the channel's own `dropped` counter since the last
   * reconciliation, minus `incomingDrops` (the incoming message itself),
   * removes the OLDEST entries from the in-queue FIFO ledger — each evicted
   * batch lands in the ledger with its own record. The cross-boundary
   * identity (attributed evictions === channel.dropped) is asserted at
   * settle.
   */
  private async reconcileChannelDrops(incomingDrops: number): Promise<void> {
    const droppedNow = this.channel.dropped;
    const delta = droppedNow - this.lastChannelDropped;
    this.lastChannelDropped = droppedNow;
    const evictedOldest = Math.max(0, delta - incomingDrops);
    if (evictedOldest > 0) {
      for (const batchId of this.registry.takeEvicted(evictedOldest)) {
        const batch = this.registry.resolve(PAYLOAD_REF_PREFIX + batchId);
        this.accounting.batchesQueueEvicted += 1;
        await this.terminalBatch(batch, {
          disposition: "dropped",
          dropReason: "queue-evicted",
          details: { channelReason: "evicted-oldest" },
        });
      }
      this.observeQueued();
    }
  }

  /**
   * The scheduler pump: dequeues batches from the channel, applies the
   * dequeue-side degradation re-check, and maps each surviving batch to a
   * W303 job (idempotency key derived from the batch watermark). Exits when
   * the channel is closed AND drained.
   */
  private async scheduleLoop(): Promise<void> {
    while (true) {
      let message: StageMessage;
      try {
        message = await this.channel.receive();
      } catch (err) {
        if (err instanceof ChannelClosedError) break;
        throw err;
      }
      const batch = message.payload as RenderBatch;
      this.registry.markDequeued(batch.batchId);
      this.accounting.batchesReceivedFromQueue += 1;
      this.observeQueued();
      if (this.stopRequested && this.stopMode === "cancel") {
        this.accounting.batchesCancelledInQueue += 1;
        await this.terminalBatch(batch, {
          disposition: "cancelled",
          details: { phase: "dequeue-sweep" },
        });
        continue;
      }
      const dequeue = evaluateStaleSkip(
        this.degradation,
        batch.watermark.watermarkMs,
        this.store.availableWatermark(),
      );
      if (dequeue.stale) {
        await this.terminalBatch(batch, {
          disposition: "skipped-stale",
          phase: "dequeue",
          decision: dequeue,
        });
        continue;
      }
      await this.submitBatch(batch);
    }
  }

  /** Maps one dequeued batch onto the W303 job protocol. */
  private async submitBatch(batch: RenderBatch): Promise<void> {
    const jobId = jobIdOf(this.sessionId, batch.ordinal);
    const envelope: GpuJobEnvelope = {
      jobId,
      idempotencyKey: batch.idempotencyKey,
      kind: RENDER_JOB_CLASS,
      payloadRef: `${PAYLOAD_REF_PREFIX}${batch.batchId}`,
      priority: 0,
      requirements: { modelClass: RENDER_JOB_CLASS },
      deadlineMs: this.renderDeadlineMs,
    };
    let handle: GpuSubmitHandle;
    try {
      handle = this.dispatcher.submit(envelope);
    } catch (err) {
      if (err instanceof GpuResourceLimitError || err instanceof MalformedJobError) {
        this.accounting.batchesRenderQueueRefused += 1;
        // The dispatcher TERMINATED (its admitted-job budget is exhausted —
        // the W303 fail-loud posture): the run fails LOUD with the
        // protocol's own resource-limit class and the consumer stops
        // cutting (the batch itself is still accounted, never a silent
        // hole). A ready-queue-full refusal is bounded and CONTINUES (the
        // W104 reject posture).
        const reason = (err.details as Record<string, unknown> | undefined)?.["reason"];
        if (err instanceof GpuResourceLimitError && reason === "admitted-budget-exhausted") {
          if (this.terminalFailure === undefined) {
            this.terminalFailure = { failureClass: "resource-limit", message: err.message };
          }
          this.stopRequested = true;
          this.stopResolve?.();
        }
        await this.terminalBatch(batch, {
          disposition: "dropped",
          dropReason: "render-queue-refused",
          jobId,
          details: { failureClass: err.failureClass, details: err.details },
        });
        return;
      }
      if (err instanceof InvalidDispatcherStateError) {
        // The dispatcher terminated fail-loud (its admitted budget): the
        // batch is still accounted (never a silent hole) and the RUN fails
        // loudly with the protocol's own message.
        this.accounting.batchesRenderQueueRefused += 1;
        if (this.terminalFailure === undefined) {
          this.terminalFailure = { failureClass: "resource-limit", message: err.message };
        }
        this.stopRequested = true;
        this.stopResolve?.();
        await this.terminalBatch(batch, {
          disposition: "dropped",
          dropReason: "render-queue-refused",
          jobId,
          details: { failureClass: "resource-limit", reason: "dispatcher-ended" },
        });
        return;
      }
      throw err;
    }
    if (handle.disposition === "duplicate") {
      this.accounting.renderJobsDuplicate += 1;
      this.accounting.batchesDuplicateSkips += 1;
      this.accounting.batchesDuplicateSubmits += 1;
      await this.terminalBatch(batch, {
        disposition: "duplicate",
        jobId: handle.jobId,
        details: { keyState: handle.keyState, mode: "dispatcher-duplicate" },
      });
      return;
    }
    this.accounting.renderJobsSubmitted += 1;
    this.accounting.renderJobsInFlight += 1;
    this.submittedJobs.set(jobId, batch);
    this.observePeak();
    this.stageLogger.info("render job submitted", {
      jobId,
      idempotencyKey: batch.idempotencyKey,
      batchOrdinal: batch.ordinal,
      watermark: batch.watermark,
      deadlineMs: this.renderDeadlineMs,
    });
    const tracked = this.trackJobResult(batch, handle.result);
    this.pendingJobs.add(tracked);
    void tracked.then(
      () => this.pendingJobs.delete(tracked),
      (reason) => {
        // The ONLY place a sink/continuation failure would otherwise be
        // swallowed: this handler observes the rejection first (it deletes
        // the promise from `pendingJobs`, so the settle-time `allSettled`
        // scan below can no longer see it). Record it LOUD here — without
        // this, the settle-time in-flight backstop would reject `done()`
        // with no trace of the root cause (never silent).
        this.recordSinkFailure(reason, {
          jobId,
          batchId: batch.batchId,
          batchOrdinal: batch.ordinal,
        });
        this.pendingJobs.delete(tracked);
      },
    );
  }

  /** Awaits one job's terminal result and accounts its batch. */
  private async trackJobResult(batch: RenderBatch, result: Promise<GpuJobResult>): Promise<void> {
    const resolved = await result;
    this.accounting.renderJobsInFlight -= 1;
    const jobId = jobIdOf(this.sessionId, batch.ordinal);
    if (resolved.status === "succeeded") {
      let output: AnimeRenderOutput;
      try {
        output = assertAnimeRenderOutputShape(resolved.output, {
          jobId,
          batchId: batch.batchId,
        });
      } catch (err) {
        // A LYING EXECUTOR is an internal fault: accounted dropped with the
        // reason recorded (never silent), the run continues.
        this.accounting.batchesRenderOutputInvalid += 1;
        this.stageLogger.error("render job output failed validation", {
          jobId,
          batchId: batch.batchId,
          error: err instanceof Error ? err.message : String(err),
        });
        await this.terminalBatch(batch, {
          disposition: "dropped",
          dropReason: "render-output-invalid",
          jobId,
          details: { error: err instanceof Error ? err.message : String(err) },
        });
        return;
      }
      // A failure from HERE (a throwing output sink, an emission-continuation
      // fault) is NOT an output-validation failure: it propagates, the run
      // fails LOUD, and the batch never lands a lying disposition — the
      // settle-time in-flight assertion is the backstop that REJECTS
      // `done()` (README §9). Misclassifying it `render-output-invalid`
      // would write a lying reason into the ledger.
      await this.enqueueOutput(batch, resolved, output, jobId);
      return;
    }
    if (resolved.status === "failed") {
      this.accounting.batchesRenderFailed += 1;
      await this.terminalBatch(batch, {
        disposition: "dropped",
        dropReason: "render-failed",
        jobId,
        terminalClass: resolved.failure?.terminal,
        details: {
          errorClass: resolved.failure?.errorClass,
          message: resolved.failure?.message,
          terminal: resolved.failure?.terminal,
          attempts: resolved.attempts,
          claims: resolved.claims,
        },
      });
      return;
    }
    this.accounting.batchesRenderCancelled += 1;
    await this.terminalBatch(batch, {
      disposition: "cancelled",
      jobId,
      details: { phase: "job-cancelled" },
    });
  }

  /**
   * Inserts one completed output into the bounded reorder buffer and emits
   * in watermark order. Overflow drops the INCOMING output (never a
   * closer-to-head one) with full accounting.
   */
  private async enqueueOutput(
    batch: RenderBatch,
    result: GpuJobResult,
    output: AnimeRenderOutput,
    jobId: string,
  ): Promise<void> {
    if (this.reorder.size >= this.limits.maxReorderOutputs) {
      this.accounting.batchesReorderOverflow += 1;
      this.stageLogger.warn("render output dropped (reorder buffer full — bounded memory)", {
        jobId,
        batchId: batch.batchId,
        batchOrdinal: batch.ordinal,
        reorderSize: this.reorder.size,
        maxReorderOutputs: this.limits.maxReorderOutputs,
        watermark: batch.watermark,
      });
      this.metrics.counter(METRICS.batchesDropped, { reason: "reorder-overflow" }).inc();
      await this.terminalBatch(batch, {
        disposition: "dropped",
        dropReason: "reorder-overflow",
        jobId,
      });
      return;
    }
    const record: RenderOutputRecord = {
      output,
      provenance: {
        sessionId: this.sessionId,
        batchId: batch.batchId,
        batchOrdinal: batch.ordinal,
        sourceWatermark: {
          watermarkMs: batch.watermark.watermarkMs,
          sequence: batch.watermark.sequence,
        },
        jobId,
        rendererId: output.manifest.renderer.rendererId,
        rendererVersion: output.manifest.renderer.rendererVersion,
        jobTiming: { ...result.timing },
      },
    };
    this.reorder.set(batch.ordinal, { batch, record });
    if (this.reorder.size > this.accounting.peakReorderSize) {
      this.accounting.peakReorderSize = this.reorder.size;
    }
    await this.emitInOrder();
  }

  /**
   * Schedules one emission drain pass on the SERIALIZED chain (exactly one
   * drain runs at a time, FIFO). Returns a promise that resolves after a
   * pass scheduled at/after this call: if the record is blocked behind a
   * lower ordinal still in flight, the pass returns without it and a LATER
   * pass (triggered by that lower ordinal's terminal accounting) emits it —
   * `runToSettlement` awaits every tracked job AND both pumps, so every
   * drain is complete before settlement (the settle-time reorder-empty
   * assertion is the proof).
   */
  private emitInOrder(): Promise<void> {
    const task = this.emissionTail.then(() => this.drainEmissions());
    this.emissionTail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  /**
   * The drain pass (only ever invoked through the serialized chain): emits
   * outputs strictly in batch-ordinal order (== watermark order), advancing
   * the head past terminal-without-output ordinals, calling the sink
   * AWAITED (one at a time — backpressure propagates, order is absolute),
   * and accounting each emitted batch `rendered` with its lag measured
   * against the stream head.
   */
  private async drainEmissions(): Promise<void> {
    while (true) {
      const entry = this.reorder.get(this.nextEmitOrdinal);
      if (entry === undefined) {
        if (this.terminalOrdinals.has(this.nextEmitOrdinal)) {
          this.nextEmitOrdinal += 1;
          continue;
        }
        return;
      }
      this.reorder.delete(this.nextEmitOrdinal);
      this.nextEmitOrdinal += 1;
      const { batch, record } = entry;
      const head = this.store.availableWatermark();
      const lagMs = head.watermarkMs - batch.watermark.watermarkMs;
      if (lagMs > this.accounting.maxEmissionLagMs) {
        this.accounting.maxEmissionLagMs = lagMs;
      }
      this.metrics.histogram(METRICS.watermarkLagAtEmissionMs).observe(lagMs);
      await this.onOutput?.(record);
      this.runOutputs.push(record);
      this.accounting.outputsEmitted += 1;
      this.metrics.counter(METRICS.outputsEmitted).inc();
      this.stageLogger.info("render output emitted", {
        batchId: batch.batchId,
        batchOrdinal: batch.ordinal,
        watermark: batch.watermark,
        rendererId: record.provenance.rendererId,
        lagMs,
      });
      this.terminalBatchCore(batch, { disposition: "rendered" });
    }
  }

  // --- terminal accounting ------------------------------------------------------

  /**
   * Records one batch's EXACTLY-ONE terminal disposition: the ledger entry,
   * the counters, the log line, the metric, and (at watermark boundaries)
   * the checkpoint cut — ANCHORED AT THIS BATCH (see
   * `RenderCheckpointTracker.cut`). Pure bookkeeping, no emission.
   */
  private terminalBatchCore(batch: RenderBatch, outcome: TerminalOutcome): void {
    const atMs = this.clock.now();
    const entry: RenderBatchLedgerEntry = {
      batchId: batch.batchId,
      ordinal: batch.ordinal,
      idempotencyKey: batch.idempotencyKey,
      watermark: { watermarkMs: batch.watermark.watermarkMs, sequence: batch.watermark.sequence },
      disposition: outcome.disposition,
      atMs,
      ...(outcome.disposition === "dropped" ? { dropReason: outcome.dropReason } : {}),
      ...(outcome.disposition === "skipped-stale" ? { skipPhase: outcome.phase } : {}),
      ...(outcome.disposition !== "skipped-stale" &&
      "jobId" in outcome &&
      outcome.jobId !== undefined
        ? { jobId: outcome.jobId }
        : {}),
      ...(outcome.disposition === "dropped" && outcome.terminalClass !== undefined
        ? { terminalClass: outcome.terminalClass }
        : {}),
    };
    this.runLedger.push(entry);
    this.terminalOrdinals.add(batch.ordinal);
    this.accounting.batchesInFlight -= 1;
    switch (outcome.disposition) {
      case "rendered":
        this.accounting.batchesRendered += 1;
        this.sessionTerminalKeys.set(batch.idempotencyKey, "rendered");
        break;
      case "skipped-stale":
        this.accounting.batchesSkippedStale += 1;
        if (outcome.phase === "admission") {
          this.accounting.batchesSkippedStaleAtAdmission += 1;
        } else {
          this.accounting.batchesSkippedStaleInQueue += 1;
        }
        this.stageLogger.warn("render batch skipped (stale — degradation policy)", {
          batchId: batch.batchId,
          batchOrdinal: batch.ordinal,
          watermark: batch.watermark,
          phase: outcome.phase,
          lagMs: outcome.decision.lagMs,
          head: outcome.decision.head,
          skip: { originalWatermark: batch.watermark, neverRestamped: true },
        });
        this.metrics.counter(METRICS.batchesSkippedStale, { phase: outcome.phase }).inc();
        break;
      case "dropped":
        this.accounting.batchesDropped += 1;
        this.metrics.counter(METRICS.batchesDropped, { reason: outcome.dropReason }).inc();
        if (outcome.dropReason === "render-failed") {
          this.sessionTerminalKeys.set(batch.idempotencyKey, "render-failed");
        }
        this.stageLogger.warn("render batch dropped (policy — never silent)", {
          batchId: batch.batchId,
          batchOrdinal: batch.ordinal,
          watermark: batch.watermark,
          reason: outcome.dropReason,
          ...("details" in outcome && outcome.details !== undefined ? outcome.details : {}),
        });
        break;
      case "cancelled":
        this.accounting.batchesCancelled += 1;
        this.metrics.counter(METRICS.batchesCancelled).inc();
        this.stageLogger.info("render batch cancelled", {
          batchId: batch.batchId,
          batchOrdinal: batch.ordinal,
          watermark: batch.watermark,
          ...("details" in outcome && outcome.details !== undefined ? outcome.details : {}),
        });
        break;
      case "duplicate":
        this.metrics.counter(METRICS.batchesDuplicate).inc();
        this.stageLogger.info(
          "render batch counted duplicate (idempotency key — never re-submitted)",
          {
            batchId: batch.batchId,
            batchOrdinal: batch.ordinal,
            watermark: batch.watermark,
            idempotencyKey: batch.idempotencyKey,
            ...("details" in outcome && outcome.details !== undefined ? outcome.details : {}),
          },
        );
        break;
    }
    this.observePeak();
    // Checkpoint at watermark boundaries (the W302 posture), anchored at
    // THIS batch — never the live consumer cursor.
    if (this.tracker.crossesBoundary(batch.watermark.watermarkMs)) {
      const checkpoint = this.tracker.cut({
        batch,
        processedKeys: [...this.sessionTerminalKeys].map(([key, disposition]) => ({
          key,
          disposition,
        })),
        stats: { ...this.accounting },
        atMs,
      });
      this.accounting.checkpointsCut += 1;
      this.runCheckpoints.push(checkpoint);
      this.metrics.counter(METRICS.checkpointsCut).inc();
      this.stageLogger.info("render checkpoint cut", {
        index: checkpoint.index,
        watermark: checkpoint.watermark,
        processedKeys: checkpoint.processedKeys.length,
        consumedThroughSequence: checkpoint.consumedThroughSequence,
      });
    }
  }

  /**
   * The terminal bookkeeping plus the emission trigger: a terminal
   * disposition can un-block the ordinal head (this batch will never produce
   * an output), so one drain pass is scheduled after the bookkeeping. The
   * drain pass itself never calls back into this method's trigger half —
   * `drainEmissions` uses `terminalBatchCore` directly (no re-entrancy).
   */
  private async terminalBatch(batch: RenderBatch, outcome: TerminalOutcome): Promise<void> {
    this.terminalBatchCore(batch, outcome);
    await this.emitInOrder();
  }

  // --- settlement ---------------------------------------------------------------

  private async finalizeRun(): Promise<void> {
    // "completed" is an EARNED claim: only a store that says it is complete
    // (and was fully consumed) completes the run. A stalled store (neither
    // complete nor growing) or an early break settles "stopped" — never a
    // fabricated completion.
    const outcome: RenderOrchestrationResult["outcome"] =
      this.terminalFailure !== undefined
        ? "failed"
        : this.stopRequested
          ? this.stopMode === "cancel"
            ? "cancelled"
            : "stopped"
          : this.store.isComplete()
            ? "completed"
            : "stopped";
    if (this.reorder.size > 0) {
      throw new RangeError(
        `render-orchestration reorder buffer not empty at settle (${this.reorder.size} held outputs)`,
      );
    }
    if (this.accounting.batchesInFlight !== 0) {
      // The backstop behind the sink-failure path (README §9): a batch that
      // never reached ANY terminal disposition (e.g. its output was rendered
      // but the sink threw before the emission accounting) means an internal
      // fault — the settle promise REJECTS with this evidence instead of
      // returning a result with a lying or missing disposition.
      throw new RangeError(
        `render-orchestration batches still in flight at settle ` +
          `(${this.accounting.batchesInFlight} cut but never terminally disposed)`,
      );
    }
    if (this.channel.size !== 0) {
      throw new RangeError(
        `render-orchestration channel not drained at settle (${this.channel.size} queued batches)`,
      );
    }
    if (this.accounting.batchesQueueEvicted !== this.channel.dropped) {
      throw new RangeError(
        `render-orchestration cross-boundary identity broken: attributed evictions ` +
          `${this.accounting.batchesQueueEvicted} != channel.dropped ${this.channel.dropped}`,
      );
    }
    this.accounting.queuedNow = this.registry.queuedCount;
    if (this.accounting.queuedNow !== 0) {
      throw new RangeError(
        `render-orchestration in-queue ledger not drained at settle (${this.accounting.queuedNow})`,
      );
    }
    assertRenderAccounting(this.accounting);
    this.phase = "stopped";
    this.settledResult = {
      sessionId: this.sessionId,
      outcome,
      ...(this.terminalFailure === undefined
        ? {}
        : {
            terminalFailureClass: this.terminalFailure.failureClass,
            error: this.terminalFailure.message,
          }),
      stats: { ...this.accounting },
      outputs: [...this.runOutputs],
      checkpoints: this.runCheckpoints.map((checkpoint) => ({
        ...checkpoint,
        processedKeys: checkpoint.processedKeys.map((entry) => ({ ...entry })),
      })),
      ledger: [...this.runLedger],
      channelDropped: this.channel.dropped,
      balanced: true,
    };
    this.stageLogger.info("render orchestration settled", {
      outcome,
      stats: this.accounting,
      channelDropped: this.channel.dropped,
    });
  }

  // --- helpers --------------------------------------------------------------------

  private freshChannel(): BoundedChannel<StageMessage> {
    const options = {
      capacity: this.limits.maxQueuedBatches,
      policy: this.backpressure,
      ...(this.limits.maxQueuedBatchBytes > 0 ? { maxBytes: this.limits.maxQueuedBatchBytes } : {}),
      sizer: (msg: StageMessage): number => (msg.payload as RenderBatch).byteSize,
    };
    return new BoundedChannel(options, { logger: this.logger, metrics: this.metrics });
  }

  private requestFor(batch: RenderBatch): RenderRequest {
    return { ...this.requestTemplate, eventsSinceSequence: batch.fromSequence };
  }

  /**
   * Whether this batch's payload can no longer fit the channel's byte budget
   * as things stand (the count bound is checked separately): an honest
   * "queue already full for THIS send" signal for the park-attempt counter
   * (the README's documented hedge — under `drop-oldest` such a send evicts
   * instead of parking, under `block`/`reject` a never-fits send refuses).
   */
  private sendCannotFitBytes(batch: RenderBatch): boolean {
    return (
      this.limits.maxQueuedBatchBytes > 0 &&
      this.channel.byteSize + batch.byteSize > this.limits.maxQueuedBatchBytes
    );
  }

  private observePeak(): void {
    if (this.accounting.batchesInFlight > this.accounting.peakBatchesInSystem) {
      this.accounting.peakBatchesInSystem = this.accounting.batchesInFlight;
    }
  }

  private observeQueued(): void {
    this.accounting.queuedNow = this.registry.queuedCount;
    if (this.accounting.queuedNow > this.accounting.peakQueuedNow) {
      this.accounting.peakQueuedNow = this.accounting.queuedNow;
    }
  }
}
