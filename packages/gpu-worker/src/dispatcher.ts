/**
 * `GpuJobDispatcher` (W303) — the dispatcher half of the GPU worker
 * protocol: the bounded job queue, lease grants, heartbeat/staleness
 * detection, deadline enforcement, retry/claim budgets, the dead-letter
 * queue, idempotent cancellation, and the exact never-silent ledger.
 *
 * THE TIMERS-FIRST DISCIPLINE: there is NO background monitor loop and NO
 * real timer anywhere (the constitution). Every time-dependent decision —
 * worker staleness, lease expiry, queued/in-flight deadlines — is
 * evaluated by {@link GpuJobDispatcher.sweep}, which runs at EVERY port
 * entry (register, heartbeat, claim, report) and at every public entry
 * (submit, cancel, shutdown), BEFORE the entering operation applies. The
 * heartbeat stream IS the monitor in a live system: live workers'
 * heartbeats keep sweeping, so a dead peer is detected by the first
 * heartbeat after the staleness threshold. Real deployments that want
 * timer-driven detection call the public `sweep()` from their own monitor
 * (the vendor-neutral seam — the protocol owns no timers).
 *
 * Consequences of timers-first, all deterministic on the injected clock:
 *
 * - a report racing its own lease expiry LOSES to the sweep if the expiry
 *   already passed (the job was requeued or dead-lettered; the report is
 *   counted `superseded`, never silently dropped);
 * - a heartbeat arriving after its worker went stale first FAILS that
 *   worker's in-flight jobs LOUD (timeout classification — never silently
 *   reassigned), then revives the worker as a rejoin (fresh liveness, old
 *   jobs stay failed);
 * - an in-flight job past its deadline is failed by the sweep even while
 *   a live-but-slow executor keeps running (the eventual report is
 *   counted superseded) — the deadline is enforced absolutely,
 *   fail-closed.
 *
 * Accounting: every admitted job lands in EXACTLY ONE terminal bucket —
 * `jobsSubmitted === succeeded + failed + cancelled + deadLettered +
 * duplicates` (in-flight during a run, 0 at settle) — runtime-asserted
 * before the settled result is returned; an imbalance REJECTS shutdown()
 * instead of returning a lying result (the W301/W302 fail-loud posture).
 */
import type { TerminalFailureClass } from "@sporta/contracts";
import { MetricsRegistry, bindLogger, createLogger } from "@sporta/observability";
import type { CorrelationContext, Logger } from "@sporta/observability";
import type { GpuClock } from "./clock";
import { GpuDeadLetterQueue } from "./dlq";
import {
  InvalidDispatcherStateError,
  MalformedJobError,
  GpuResourceLimitError,
  UnknownJobError,
} from "./errors";
import { GpuJobLedger } from "./ledger";
import type { GpuJobEnvelope } from "./job";
import { validateJobEnvelope } from "./job";
import {
  DEFAULT_GPU_LIMITS,
  GPU_METRIC_NAMES as METRICS,
  assertGpuAccounting,
  assertGpuLedgerConsistency,
  emptyGpuStats,
} from "./types";
import type {
  GpuAttemptReport,
  GpuCancelOutcome,
  GpuDeadLetterEntry,
  GpuDispatchLimits,
  GpuDispatchResult,
  GpuDispatchStats,
  GpuDispatcherOptions,
  GpuDispatcherPort,
  GpuHeartbeat,
  GpuHeartbeatAck,
  GpuJobClaim,
  GpuJobEventDetails,
  GpuJobFailure,
  GpuJobRecord,
  GpuJobResult,
  GpuObservability,
  GpuRegistrationAck,
  GpuReportAck,
  GpuSubmitHandle,
  GpuWorkerCapabilities,
  GpuWorkerStatus,
} from "./types";

/** Log/metric stage name for dispatcher-boundary records. */
const DISPATCHER_STAGE = "gpu-dispatcher";

/** Label key carrying the failure class on the timeouts counter. */
const TIMEOUT_KIND_LABEL = "kind";

/** Label key carrying the reason on rejected-heartbeat counters. */
const REASON_LABEL = "reason";

/** Label key carrying the report disposition on the attempts counter. */
const REPORT_LABEL = "disposition";

/** Default staleness threshold (ms without an accepted heartbeat). */
const DEFAULT_STALE_AFTER_MS = 10_000;

/** Default lease duration (ms, renewed on every accepted heartbeat). */
const DEFAULT_LEASE_MS = 30_000;

/** Default claim budget (lease epochs per job). */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Lifecycle phase of one dispatcher. */
export type GpuDispatcherPhase = "created" | "running" | "ended";

/** The dispatcher-internal worker state. */
interface WorkerState {
  workerId: string;
  active: boolean;
  registeredAtMs: number;
  lastHeartbeatAtMs: number;
  lastSequence: number;
  capabilities: GpuWorkerCapabilities;
  /** In-flight job records leased to this worker (claim order). */
  jobs: Set<GpuJobRecord>;
}

/** One parked `claimJob` waiter (FIFO among eligible claimers). */
interface ClaimWaiter {
  workerId: string;
  resolve: (claim: GpuJobClaim | undefined) => void;
}

/** The mutable counter subset the dispatcher owns. */
type MutableCounters = Omit<
  GpuDispatchStats,
  "inFlight" | "queuedJobs" | "executingJobs" | "dlqRetained" | "dlqOverflow" | "workersActive"
>;

/**
 * The GPU job dispatcher. Construct with the wiring (id, clock, staleness,
 * lease, limits, observability); `start()` opens the port; `submit()`
 * admits jobs (typed loud refusals); workers claim through the
 * {@link GpuDispatcherPort} surface; `cancel()` is idempotent; `sweep()`
 * is the public timer tick; `shutdown()` cancels everything unresolved and
 * settles with the balance asserted.
 */
export class GpuJobDispatcher implements GpuDispatcherPort {
  private readonly dispatcherId: string;
  private readonly clock: GpuClock;
  private readonly staleAfterMs: number;
  private readonly leaseMs: number;
  private readonly defaultMaxAttempts: number;
  private readonly limits: GpuDispatchLimits;
  private readonly logger: Logger;
  private readonly metrics: MetricsRegistry;
  private readonly correlation: CorrelationContext;
  private readonly ledger: GpuJobLedger;
  private readonly dlq: GpuDeadLetterQueue;
  private readonly workerStates = new Map<string, WorkerState>();
  private readonly ready: GpuJobRecord[] = [];
  private readonly claimers: ClaimWaiter[] = [];
  private readonly resultResolvers = new Map<string, (result: GpuJobResult) => void>();
  private readonly counters: MutableCounters = emptyGpuStats();
  private nextSequence = 0;
  private nextLeaseId = 0;
  private phase: GpuDispatcherPhase = "created";
  private terminal: { failureClass: TerminalFailureClass; message: string } | undefined;
  private settledResult: GpuDispatchResult | undefined;

  constructor(options: GpuDispatcherOptions) {
    if (options.dispatcherId !== undefined && options.dispatcherId.length < 1) {
      throw new RangeError("GpuJobDispatcher dispatcherId must be a non-empty string when given");
    }
    if (
      options.clock === null ||
      typeof options.clock !== "object" ||
      typeof options.clock.now !== "function" ||
      typeof options.clock.sleep !== "function" ||
      typeof options.clock.waitUntil !== "function"
    ) {
      throw new TypeError("GpuJobDispatcher requires an injected GpuClock (now/sleep/waitUntil)");
    }
    if (
      options.staleAfterMs !== undefined &&
      (!Number.isFinite(options.staleAfterMs) || options.staleAfterMs <= 0)
    ) {
      throw new RangeError(
        `GpuJobDispatcher staleAfterMs must be a finite number > 0 (got ${String(options.staleAfterMs)})`,
      );
    }
    if (
      options.leaseMs !== undefined &&
      (!Number.isFinite(options.leaseMs) || options.leaseMs <= 0)
    ) {
      throw new RangeError(
        `GpuJobDispatcher leaseMs must be a finite number > 0 (got ${String(options.leaseMs)})`,
      );
    }
    if (
      options.defaultMaxAttempts !== undefined &&
      (!Number.isInteger(options.defaultMaxAttempts) || options.defaultMaxAttempts < 1)
    ) {
      throw new RangeError(
        `GpuJobDispatcher defaultMaxAttempts must be an integer >= 1 ` +
          `(got ${String(options.defaultMaxAttempts)})`,
      );
    }
    const limits = { ...DEFAULT_GPU_LIMITS, ...(options.limits ?? {}) };
    for (const [field, value] of Object.entries(limits) as Array<
      [keyof GpuDispatchLimits, number]
    >) {
      if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(
          `GpuDispatchLimits.${field} must be an integer >= 1 (got ${String(value)})`,
        );
      }
    }

    this.dispatcherId = options.dispatcherId ?? "gpu-0";
    this.clock = options.clock;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.defaultMaxAttempts = options.defaultMaxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.limits = limits;

    const noopLogger = createLogger({ minLevel: "error", sink: () => {} });
    const observability: GpuObservability = options.observability ?? {};
    this.logger = observability.logger ?? noopLogger;
    this.metrics = observability.metrics ?? new MetricsRegistry();
    this.correlation = observability.correlation ?? {
      sessionId: this.dispatcherId,
      correlationId: `corr-gpu-${this.dispatcherId}`,
      traceId: `trace-gpu-${this.dispatcherId}`,
    };
    this.ledger = new GpuJobLedger(this.clock);
    this.dlq = new GpuDeadLetterQueue(limits.maxDlqEntries, this.logger, this.metrics);
  }

  // --- lifecycle -----------------------------------------------------------

  /** Current lifecycle phase (`created` until `start()`, `ended` after settle). */
  get currentPhase(): GpuDispatcherPhase {
    return this.phase;
  }

  /** Opens the port for workers and submitters. Idempotent-safe fail-loud. */
  start(): void {
    if (this.phase !== "created") {
      throw new InvalidDispatcherStateError(`dispatcher is already ${this.phase}`);
    }
    this.phase = "running";
    this.stageLogger().info("gpu dispatcher started", {
      staleAfterMs: this.staleAfterMs,
      leaseMs: this.leaseMs,
      defaultMaxAttempts: this.defaultMaxAttempts,
      limits: this.limits,
    });
  }

  /**
   * Settles the dispatcher (idempotent). Everything unresolved is
   * accounted CANCELLED — queued jobs immediately, in-flight jobs with
   * their eventual executor results counted superseded (never lost).
   * Parked claims resolve `undefined` (workers stop claiming). The
   * accounting identities and the ledger consistency are runtime-asserted
   * BEFORE the result is returned — an imbalance rejects this promise
   * instead of returning a lying result.
   */
  async shutdown(): Promise<GpuDispatchResult> {
    if (this.phase === "created") {
      throw new InvalidDispatcherStateError("cannot shutdown a dispatcher before start()");
    }
    if (this.phase === "ended" && this.settledResult !== undefined) {
      return this.settledResult;
    }
    return await this.settle();
  }

  // --- producer boundary ----------------------------------------------------

  /**
   * Submits one job. Synchronous admission (a bounded-counter and envelope
   * check — the W104 `reject` posture; there is no admission parking in
   * W303): refusals THROW typed errors and carry their own counters
   * outside the terminal identity (they never became jobs):
   *
   * - `MalformedJobError` — the envelope is invalid, or a NEW key re-uses
   *   the `jobId` of an already-admitted job (counted
   *   `malformedSubmissions`);
   * - `GpuResourceLimitError` — the ready queue is at `maxQueuedJobs`, the
   *   admitted-job budget is exhausted (the dispatcher then terminates
   *   fail-loud), or no ACTIVE worker's declared capacity can ever fit
   *   the job's requirements (the W104 never-fits posture; with zero
   *   active workers admission is deferred — the deadline machinery fails
   *   the job loudly if capacity never arrives);
   * - a KNOWN idempotency key is NOT a refusal — it is checked FIRST and
   *   unconditionally: it resolves `{ disposition: "duplicate" }` —
   *   counted, skipped, never double-claimed (in flight or terminally
   *   disposed alike, and even when the jobId matches the known job's
   *   own id: an idempotent submit retry is a duplicate, never a
   *   collision).
   *
   * An admitted job resolves its `result` promise exactly once, with the
   * job's ONE terminal disposition (the promise never rejects — failures
   * are values).
   */
  submit(job: GpuJobEnvelope, options: SubmitOptions = {}): GpuSubmitHandle {
    if (this.phase !== "running") {
      throw new InvalidDispatcherStateError(
        `submit() requires a running dispatcher (phase: ${this.phase})`,
      );
    }
    if (options.correlationId !== undefined && options.correlationId.length < 1) {
      throw new RangeError("submit correlationId must be a non-empty string when given");
    }
    if (options.traceId !== undefined && options.traceId.length < 1) {
      throw new RangeError("submit traceId must be a non-empty string when given");
    }
    const line = this.stageLogger();
    this.sweep();

    // --- validation (fail-loud; the dispatcher continues) --------------------
    try {
      validateJobEnvelope(job);
    } catch (err) {
      if (err instanceof MalformedJobError) {
        this.counters.malformedSubmissions += 1;
        this.metrics.counter(METRICS.malformed).inc();
        line.warn("gpu job submission refused (malformed envelope)", {
          jobId: typeof job?.jobId === "string" ? job.jobId : null,
          reason: err.details,
        });
        throw err;
      }
      throw err;
    }
    // --- idempotency (the streaming-contract Recovery rule) ------------------
    // CHECKED FIRST, deliberately: "same key = counted duplicate" is
    // UNCONDITIONAL (the W303 brief / PROTOCOL.md §4) — an idempotent retry
    // of an already-known submit (same key, same jobId) resolves as a
    // duplicate, exactly like a new jobId carrying the key. The jobId
    // collision refusal below is reachable only for a NEW key re-using an
    // already-admitted jobId — a genuine identity conflict (the W301
    // same-content-duplicate / conflicting-id posture).
    const known = this.ledger.keyRecord(job.idempotencyKey);
    if (known !== undefined) {
      this.counters.duplicates += 1;
      this.counters.jobsSubmitted += 1;
      this.metrics.counter(METRICS.duplicates).inc();
      this.metrics.counter(METRICS.jobsSubmitted).inc();
      line.info("gpu job re-submitted (idempotent duplicate, never double-claimed)", {
        idempotencyKey: job.idempotencyKey,
        jobId: known.jobId,
        keyState: known.state,
      });
      return {
        disposition: "duplicate",
        jobId: known.jobId,
        idempotencyKey: job.idempotencyKey,
        keyState: known.state,
      };
    }
    if (this.ledger.hasJobId(job.jobId)) {
      this.counters.malformedSubmissions += 1;
      this.metrics.counter(METRICS.malformed).inc();
      const err = new MalformedJobError(
        `jobId '${job.jobId}' collides with an admitted job — job ids must be unique per dispatcher`,
        { reason: "job-id-collision", field: "jobId" },
      );
      line.warn("gpu job submission refused (job id collision)", { jobId: job.jobId });
      throw err;
    }

    // --- admitted-job budget (fail-loud, the W302 posture) -------------------
    if (this.counters.admitted + 1 > this.limits.maxAdmittedJobs) {
      this.counters.refusedSubmissions += 1;
      this.metrics.counter(METRICS.refused).inc();
      const message =
        `dispatcher exceeded its admitted-job budget: ${this.counters.admitted + 1} > ` +
        `${this.limits.maxAdmittedJobs}`;
      line.error("gpu dispatcher terminating (admitted-job budget exhausted)", {
        admitted: this.counters.admitted,
        maxAdmittedJobs: this.limits.maxAdmittedJobs,
      });
      this.terminate("resource-limit", message);
      throw new GpuResourceLimitError(message, {
        reason: "admitted-budget-exhausted",
        admitted: this.counters.admitted,
        maxAdmittedJobs: this.limits.maxAdmittedJobs,
      });
    }

    // --- ready-queue bound (the W104 reject posture) --------------------------
    if (this.ready.length >= this.limits.maxQueuedJobs) {
      this.counters.refusedSubmissions += 1;
      this.metrics.counter(METRICS.refused).inc();
      const message = `ready queue is full: ${this.ready.length} of ${this.limits.maxQueuedJobs} jobs queued`;
      line.warn("gpu job submission refused (ready queue full)", {
        jobId: job.jobId,
        queued: this.ready.length,
        maxQueuedJobs: this.limits.maxQueuedJobs,
      });
      throw new GpuResourceLimitError(message, {
        reason: "ready-queue-full",
        queued: this.ready.length,
        maxQueuedJobs: this.limits.maxQueuedJobs,
      });
    }

    // --- declared-capacity envelope (the W104 never-fits posture) -------------
    const activeWorkers = [...this.workerStates.values()].filter((worker) => worker.active);
    if (activeWorkers.length > 0 && job.requirements !== undefined) {
      const maxMemoryMb = activeWorkers.reduce(
        (max, worker) => Math.max(max, worker.capabilities.memoryMb),
        0,
      );
      if (job.requirements.memoryMb !== undefined && job.requirements.memoryMb > maxMemoryMb) {
        this.counters.refusedSubmissions += 1;
        this.metrics.counter(METRICS.refused).inc();
        const message =
          `no active worker declares enough memory: job needs ${job.requirements.memoryMb} MB, ` +
          `envelope maximum ${maxMemoryMb} MB`;
        line.warn("gpu job submission refused (memory over declared envelope)", {
          jobId: job.jobId,
          requiredMemoryMb: job.requirements.memoryMb,
          maxDeclaredMemoryMb: maxMemoryMb,
        });
        throw new GpuResourceLimitError(message, {
          reason: "memory-over-declared-envelope",
          requiredMemoryMb: job.requirements.memoryMb,
          maxDeclaredMemoryMb: maxMemoryMb,
        });
      }
      if (job.requirements.modelClass !== undefined) {
        const served = activeWorkers.some((worker) =>
          worker.capabilities.modelClasses.includes(job.requirements!.modelClass!),
        );
        if (!served) {
          this.counters.refusedSubmissions += 1;
          this.metrics.counter(METRICS.refused).inc();
          const message = `no active worker serves model class '${job.requirements.modelClass}'`;
          line.warn("gpu job submission refused (model class not served)", {
            jobId: job.jobId,
            modelClass: job.requirements.modelClass,
          });
          throw new GpuResourceLimitError(message, {
            reason: "model-class-not-served",
            modelClass: job.requirements.modelClass,
          });
        }
      }
    }

    // --- admit -----------------------------------------------------------------
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    const submittedAtMs = this.clock.now();
    const correlationId = options.correlationId ?? this.correlation.correlationId;
    const traceId = options.traceId ?? this.correlation.traceId;
    const record = this.ledger.open(job, {
      sequence,
      submittedAtMs,
      deadlineAtMs: submittedAtMs + job.deadlineMs,
      maxAttempts: job.maxAttempts ?? this.defaultMaxAttempts,
      correlationId,
      traceId,
    });
    const result = new Promise<GpuJobResult>((resolve) => {
      this.resultResolvers.set(record.jobId, resolve);
    });
    this.insertReady(record);
    this.counters.admitted += 1;
    this.counters.jobsSubmitted += 1;
    this.metrics.counter(METRICS.admitted).inc();
    this.metrics.counter(METRICS.jobsSubmitted).inc();
    line.info("gpu job admitted", {
      jobId: job.jobId,
      idempotencyKey: job.idempotencyKey,
      kind: job.kind,
      priority: job.priority,
      sequence,
      deadlineMs: job.deadlineMs,
      maxAttempts: record.maxAttempts,
    });
    this.pumpClaimers();
    return { disposition: "admitted", jobId: job.jobId, result };
  }

  /**
   * Cancels one job (idempotent, never lost):
   *
   * - QUEUED — removed from the ready queue, accounted CANCELLED;
   * - IN-FLIGHT — the disposition is set CANCELLED immediately (the
   *   executor's eventual result is counted superseded — a promise cannot
   *   be killed, and its outcome is never silently dropped);
   * - already TERMINAL — an idempotent no-op returning the existing
   *   disposition (nothing is counted twice);
   * - UNKNOWN — typed `UnknownJobError` (a cancel that "succeeds" against
   *   an unknown job would be a silent lie).
   */
  cancel(jobId: string): GpuCancelOutcome {
    if (this.phase !== "running") {
      throw new InvalidDispatcherStateError(
        `cancel() requires a running dispatcher (phase: ${this.phase})`,
      );
    }
    this.sweep();
    const record = this.ledger.jobRecord(jobId);
    if (record === undefined) {
      throw new UnknownJobError(`cancel() named an unknown job '${jobId}'`, { jobId });
    }
    if (
      record.state === "succeeded" ||
      record.state === "failed" ||
      record.state === "cancelled" ||
      record.state === "dead-lettered"
    ) {
      this.stageLogger().info("gpu job cancel is an idempotent no-op (already terminal)", {
        jobId,
        disposition: record.state,
      });
      return { cancelled: false, jobId, disposition: record.state };
    }
    if (record.state === "queued") {
      this.removeFromReady(record);
      this.terminalCancel(record, "cancel-queued");
    } else {
      this.releaseLease(record);
      this.terminalCancel(record, "cancel-in-flight");
    }
    this.pumpClaimers();
    return { cancelled: true, jobId };
  }

  /**
   * The public timer tick (the vendor-neutral monitor seam): evaluates
   * worker staleness, lease expiry, and queued/in-flight deadlines, in
   * that order, all on the injected clock. Runs automatically at every
   * port/public entry; deployments wire their own monitor to call it.
   */
  sweep(): void {
    if (this.phase === "created") {
      throw new InvalidDispatcherStateError("sweep() before start()");
    }
    if (this.phase !== "running") return; // ended: nothing left to sweep
    // --- 1. staleness (fail-loud, never silent reassignment) ------------------
    for (const worker of this.workerStates.values()) {
      if (!worker.active) continue;
      if (this.clock.now() - worker.lastHeartbeatAtMs > this.staleAfterMs) {
        worker.active = false;
        this.counters.staleWorkers += 1;
        this.metrics.counter(METRICS.staleWorkers).inc();
        this.stageLogger().warn("gpu worker went stale (missed-heartbeat threshold)", {
          workerId: worker.workerId,
          lastHeartbeatAtMs: worker.lastHeartbeatAtMs,
          staleAfterMs: this.staleAfterMs,
          inFlightJobs: worker.jobs.size,
        });
        for (const record of [...worker.jobs]) {
          this.releaseLease(record);
          this.terminalFail(record, {
            errorClass: "worker-stale",
            message:
              `executing worker '${worker.workerId}' went stale ` +
              `(no accepted heartbeat for ${this.clock.now() - worker.lastHeartbeatAtMs} ms, ` +
              `threshold ${this.staleAfterMs} ms) — job failed loud, never silently reassigned`,
            terminal: "timeout",
            eventType: "worker-stale",
            timeoutKind: "stale-worker",
            details: { workerId: worker.workerId, lastHeartbeatAtMs: worker.lastHeartbeatAtMs },
          });
        }
      }
    }
    // --- 2. lease expiry (active workers; requeue or dead-letter) -------------
    for (const worker of this.workerStates.values()) {
      if (!worker.active) continue;
      for (const record of [...worker.jobs]) {
        const lease = record.lease;
        if (lease === undefined || this.clock.now() < lease.leaseExpiresAtMs) continue;
        this.releaseLease(record);
        this.counters.leaseExpiries += 1;
        this.metrics.counter(METRICS.leaseExpiries).inc();
        this.ledger.append(record, "lease-expired", {
          leaseId: lease.leaseId,
          workerId: lease.workerId,
          claimOrdinal: lease.claimOrdinal,
          leaseExpiresAtMs: lease.leaseExpiresAtMs,
        });
        if (record.claims >= record.maxAttempts) {
          this.terminalDeadLetter(record, {
            errorClass: "lease-expired",
            message:
              `lease expired after ${record.claims} claim(s) (budget ${record.maxAttempts}) ` +
              `on worker '${lease.workerId}' — claim budget exhausted, job dead-lettered`,
            terminal: "retry-exhausted",
          });
        } else {
          this.requeue(record, lease);
        }
      }
    }
    // --- 3. deadlines (queued AND in-flight; enforced absolutely) --------------
    for (const record of this.ledger.liveRecords()) {
      if (this.clock.now() < record.deadlineAtMs) continue;
      if (record.state === "queued") {
        this.removeFromReady(record);
        this.terminalFail(record, {
          errorClass: "deadline-timeout",
          message:
            `job deadline fired while queued (${record.deadlineAtMs} ms) — ` +
            `never executed, failed loud`,
          terminal: "timeout",
          eventType: "deadline-timeout",
          timeoutKind: "deadline",
          details: { while: "queued" },
        });
      } else if (record.state === "in-flight") {
        this.releaseLease(record);
        this.terminalFail(record, {
          errorClass: "deadline-timeout",
          message:
            `job deadline fired while in flight (${record.deadlineAtMs} ms) — ` +
            `the executing worker's eventual report is counted superseded`,
          terminal: "timeout",
          eventType: "deadline-timeout",
          timeoutKind: "deadline",
          details: { while: "in-flight" },
        });
      }
    }
    this.pumpClaimers();
  }

  // --- worker port (the vendor-neutral seam) ----------------------------------

  async registerWorker(capabilities: GpuWorkerCapabilities): Promise<GpuRegistrationAck> {
    if (this.phase !== "running") {
      throw new InvalidDispatcherStateError(
        `registerWorker() requires a running dispatcher (phase: ${this.phase})`,
      );
    }
    this.sweep();
    validateCapabilities(capabilities);
    if (this.leaseMs < capabilities.heartbeatIntervalMs) {
      throw new RangeError(
        `worker '${capabilities.workerId}': leaseMs ${this.leaseMs} must be >= ` +
          `heartbeatIntervalMs ${capabilities.heartbeatIntervalMs} (a shorter lease would ` +
          `expire between heartbeat renewals — misconfiguration, refused fail-closed)`,
      );
    }
    if (this.staleAfterMs < capabilities.heartbeatIntervalMs) {
      throw new RangeError(
        `worker '${capabilities.workerId}': staleAfterMs ${this.staleAfterMs} must be >= ` +
          `heartbeatIntervalMs ${capabilities.heartbeatIntervalMs} (a shorter threshold would ` +
          `declare every live worker stale — misconfiguration, refused fail-closed)`,
      );
    }
    const existing = this.workerStates.get(capabilities.workerId);
    const now = this.clock.now();
    if (existing !== undefined && existing.active) {
      throw new RangeError(
        `worker '${capabilities.workerId}' is already registered and active — ` +
          `duplicate live worker ids are a misconfiguration`,
      );
    }
    if (existing !== undefined) {
      // Stale worker rejoining (crash-restart with the same id): fresh
      // liveness, fresh heartbeat sequence, old in-flight jobs stay failed.
      existing.active = true;
      existing.lastHeartbeatAtMs = now;
      existing.lastSequence = 0;
      existing.capabilities = capabilities;
      this.counters.workerRejoins += 1;
      this.stageLogger().info("gpu stale worker rejoined", {
        workerId: capabilities.workerId,
        maxConcurrentJobs: capabilities.maxConcurrentJobs,
        memoryMb: capabilities.memoryMb,
        modelClasses: capabilities.modelClasses,
      });
    } else {
      this.workerStates.set(capabilities.workerId, {
        workerId: capabilities.workerId,
        active: true,
        registeredAtMs: now,
        lastHeartbeatAtMs: now,
        lastSequence: 0,
        capabilities,
        jobs: new Set<GpuJobRecord>(),
      });
      this.counters.workersRegistered += 1;
      this.stageLogger().info("gpu worker registered", {
        workerId: capabilities.workerId,
        maxConcurrentJobs: capabilities.maxConcurrentJobs,
        memoryMb: capabilities.memoryMb,
        modelClasses: capabilities.modelClasses,
        heartbeatIntervalMs: capabilities.heartbeatIntervalMs,
      });
    }
    return { leaseMs: this.leaseMs, staleAfterMs: this.staleAfterMs };
  }

  async heartbeat(workerId: string, heartbeat: GpuHeartbeat): Promise<GpuHeartbeatAck> {
    if (this.phase === "created") {
      throw new InvalidDispatcherStateError("heartbeat() before start()");
    }
    if (this.phase === "ended") {
      this.counters.rejectedHeartbeats += 1;
      this.metrics
        .counter(METRICS.rejectedHeartbeats, { [REASON_LABEL]: "dispatcher-ended" })
        .inc();
      this.stageLogger().warn("gpu heartbeat after dispatcher ended (counted, refused)", {
        workerId,
        sequence: heartbeat.sequence,
      });
      return {
        accepted: false,
        reason: "dispatcher-ended",
        dispatcherState: "ended",
      };
    }
    // Timers-first: an overdue heartbeat lets the sweep fail its own
    // worker's in-flight jobs BEFORE the heartbeat revives it (a rejoin,
    // not a resurrection of the failed jobs).
    this.sweep();
    const worker = this.workerStates.get(workerId);
    if (worker === undefined) {
      this.counters.rejectedHeartbeats += 1;
      this.metrics.counter(METRICS.rejectedHeartbeats, { [REASON_LABEL]: "unknown-worker" }).inc();
      this.stageLogger().warn("gpu heartbeat from unknown worker (counted, refused)", {
        workerId,
        sequence: heartbeat.sequence,
      });
      return { accepted: false, reason: "unknown-worker", dispatcherState: "running" };
    }
    if (
      typeof heartbeat.sequence !== "number" ||
      !Number.isInteger(heartbeat.sequence) ||
      heartbeat.sequence < 1 ||
      heartbeat.sequence <= worker.lastSequence
    ) {
      this.counters.rejectedHeartbeats += 1;
      this.metrics
        .counter(METRICS.rejectedHeartbeats, { [REASON_LABEL]: "sequence-not-monotone" })
        .inc();
      this.stageLogger().warn("gpu heartbeat refused (sequence not monotone)", {
        workerId,
        sequence: heartbeat.sequence,
        lastSequence: worker.lastSequence,
      });
      return { accepted: false, reason: "sequence-not-monotone", dispatcherState: "running" };
    }

    // Receipt time is the DISPATCHER's clock reading — worker time claims
    // (dueMs) are telemetry, never trust for staleness arithmetic.
    const now = this.clock.now();
    worker.lastSequence = heartbeat.sequence;
    worker.lastHeartbeatAtMs = now;
    if (!worker.active) {
      worker.active = true;
      this.counters.workerRejoins += 1;
      this.stageLogger().info("gpu stale worker revived by heartbeat", { workerId });
    }
    // Lease renewal on heartbeat (the protocol's renewal channel).
    let renewed = 0;
    for (const record of worker.jobs) {
      const lease = record.lease;
      if (lease === undefined) continue;
      const renewedExpiry = now + this.leaseMs;
      if (renewedExpiry > lease.leaseExpiresAtMs) {
        lease.leaseExpiresAtMs = renewedExpiry;
        renewed += 1;
      }
    }
    this.counters.heartbeatsReceived += 1;
    this.metrics.counter(METRICS.heartbeats).inc();
    this.stageLogger().info("gpu worker heartbeat accepted", {
      workerId,
      sequence: heartbeat.sequence,
      dueMs: heartbeat.dueMs,
      inFlight: heartbeat.inFlight,
      advisoryMemoryInUseMb: heartbeat.advisoryMemoryInUseMb,
      leasesRenewed: renewed,
    });
    return { accepted: true, dispatcherState: "running" };
  }

  async claimJob(workerId: string): Promise<GpuJobClaim | undefined> {
    if (this.phase === "created") {
      throw new InvalidDispatcherStateError("claimJob() before start()");
    }
    if (this.phase === "ended") return undefined; // stop signal
    this.sweep();
    const worker = this.workerStates.get(workerId);
    if (worker === undefined || !worker.active) {
      this.counters.rejectedClaims += 1;
      this.stageLogger().warn("gpu claim from unknown or stale worker (counted, refused)", {
        workerId,
        active: worker?.active ?? null,
      });
      return undefined; // stop claiming
    }
    const record = this.firstRunnableFor(worker);
    if (record !== undefined) {
      return this.grant(record, worker);
    }
    // Park (FIFO among claimers; matching is job-major, see pumpClaimers).
    return await new Promise<GpuJobClaim | undefined>((resolve) => {
      this.claimers.push({ workerId, resolve });
    });
  }

  async reportResult(report: GpuAttemptReport): Promise<GpuReportAck> {
    if (this.phase === "created") {
      throw new InvalidDispatcherStateError("reportResult() before start()");
    }
    if (!isValidReport(report)) {
      this.counters.unknownReports += 1;
      this.stageLogger().warn("gpu report refused (malformed shape, counted)", {
        workerId: report?.workerId,
        jobId: report?.jobId,
      });
      return { status: "unknown-job", reason: "malformed-report" };
    }
    // Every structurally-valid report's attempts count (recorded,
    // superseded, or unknown-job — the executor invocations the reporter
    // claims happened are counted, never silently ignored; unreported
    // attempts of crashed workers are unknowable and the protocol never
    // invents them).
    this.counters.reportedAttempts += report.attempts;
    const record = this.ledger.jobRecord(report.jobId);
    if (record === undefined) {
      this.counters.unknownReports += 1;
      this.stageLogger().warn("gpu report for an unknown job (counted, refused)", {
        workerId: report.workerId,
        jobId: report.jobId,
      });
      return { status: "unknown-job" };
    }
    record.attempts += report.attempts;
    record.reportedExecutionMs += report.timings.executionMs;
    // `startedAtMs` records the FIRST EXECUTOR INVOCATION: a report with
    // zero attempts never executed (deadline before the attempt started),
    // and its `timings.startedAtMs` is a required-shape placeholder the
    // protocol deliberately ignores — a never-executed job must not grow a
    // fake execution start (or queueWaitMs) in its result envelope.
    if (
      record.startedAtMs === undefined &&
      report.attempts > 0 &&
      Number.isFinite(report.timings.startedAtMs)
    ) {
      record.startedAtMs = report.timings.startedAtMs;
    }
    if (this.phase === "ended") {
      this.counters.lateResults += 1;
      this.metrics.counter(METRICS.lateResults).inc();
      this.metrics.counter(METRICS.attempts, { [REPORT_LABEL]: "superseded" }).inc(report.attempts);
      this.ledger.append(record, "superseded-report", {
        workerId: report.workerId,
        reason: "dispatcher-ended",
        attempts: report.attempts,
      });
      this.stageLogger().warn("gpu report after end (counted superseded)", {
        workerId: report.workerId,
        jobId: report.jobId,
        attempts: report.attempts,
      });
      return { status: "superseded", reason: "dispatcher-ended" };
    }
    this.sweep();
    const lease = record.lease;
    if (
      record.state !== "in-flight" ||
      lease === undefined ||
      lease.workerId !== report.workerId ||
      lease.leaseId !== report.leaseId
    ) {
      this.counters.lateResults += 1;
      this.metrics.counter(METRICS.lateResults).inc();
      this.metrics.counter(METRICS.attempts, { [REPORT_LABEL]: "superseded" }).inc(report.attempts);
      this.ledger.append(record, "superseded-report", {
        workerId: report.workerId,
        leaseId: report.leaseId,
        state: record.state,
        attempts: report.attempts,
      });
      this.stageLogger().warn("gpu report superseded (job no longer owned by the reporter)", {
        workerId: report.workerId,
        jobId: report.jobId,
        state: record.state,
        attempts: report.attempts,
      });
      return { status: "superseded", reason: record.state };
    }

    // A valid report on the live lease: release it and dispose the job.
    this.releaseLease(record);
    this.metrics.counter(METRICS.attempts, { [REPORT_LABEL]: "recorded" }).inc(report.attempts);
    const line = this.stageLogger();
    if (report.status === "succeeded") {
      this.terminalSucceed(record, report);
      line.info("gpu job succeeded", {
        jobId: record.jobId,
        workerId: report.workerId,
        attempts: report.attempts,
        claims: record.claims,
        executionMs: report.timings.executionMs,
      });
    } else if (report.status === "timeout") {
      this.terminalFail(record, {
        errorClass: "deadline-timeout",
        message:
          report.message ??
          `job deadline fired during execution (worker '${report.workerId}' deadline check)`,
        terminal: "timeout",
        eventType: "deadline-timeout",
        timeoutKind: "deadline",
        details: { source: "worker-report", workerId: report.workerId },
      });
    } else if (report.errorClass === "internal") {
      this.terminalDeadLetter(record, {
        errorClass: "internal",
        message: report.message ?? "executor fault (internal)",
        terminal: "internal",
      });
    } else if (report.retryable === true) {
      this.terminalDeadLetter(record, {
        errorClass: report.errorClass ?? "unclassified",
        message: report.message ?? "retryable failure exhausted the worker retry budget",
        terminal: "retry-exhausted",
      });
    } else {
      this.terminalFail(record, {
        errorClass: report.errorClass ?? "unclassified",
        message: report.message ?? "non-retryable executor failure",
        terminal: "non-retryable",
        eventType: "failed",
        details: { workerId: report.workerId, source: "worker-report" },
      });
    }
    this.pumpClaimers();
    return { status: "recorded" };
  }

  // --- observation -------------------------------------------------------------

  /** Fresh whole-dispatcher accounting snapshot (live counters + derived). */
  stats(): GpuDispatchStats {
    return this.statsSnapshot();
  }

  /** Worker liveness snapshots in registration order. */
  workers(): GpuWorkerStatus[] {
    return [...this.workerStates.values()].map((worker) => ({
      workerId: worker.workerId,
      active: worker.active,
      registeredAtMs: worker.registeredAtMs,
      lastHeartbeatAtMs: worker.lastHeartbeatAtMs,
      lastSequence: worker.lastSequence,
      inFlightJobs: worker.jobs.size,
    }));
  }

  /** Every job's ledger record, in submission order (fresh isolated copies). */
  jobRecords(): GpuJobRecord[] {
    return this.ledger.records();
  }

  /** Retained dead-letter entries in occurrence order (frozen entries). */
  deadLetters(): GpuDeadLetterEntry[] {
    return this.dlq.list();
  }

  // --- internals: claim/lease machinery -----------------------------------------

  /** `true` when the worker can run the record (capacity + requirements). */
  private canRun(worker: WorkerState, record: GpuJobRecord): boolean {
    if (!worker.active) return false;
    if (worker.jobs.size >= worker.capabilities.maxConcurrentJobs) return false;
    const requirements = record.requirements;
    if (requirements === undefined) return true;
    if (
      requirements.memoryMb !== undefined &&
      requirements.memoryMb > worker.capabilities.memoryMb
    ) {
      return false;
    }
    if (
      requirements.modelClass !== undefined &&
      !worker.capabilities.modelClasses.includes(requirements.modelClass)
    ) {
      return false;
    }
    return true;
  }

  /** The first ready job (priority, sequence) this worker can run. */
  private firstRunnableFor(worker: WorkerState): GpuJobRecord | undefined {
    for (const record of this.ready) {
      if (this.canRun(worker, record)) return record;
    }
    return undefined;
  }

  /**
   * Grants `record` to `worker`: the lease, the claim accounting, the
   * ledger event, the metrics, the log line.
   */
  private grant(record: GpuJobRecord, worker: WorkerState): GpuJobClaim {
    this.removeFromReady(record);
    const now = this.clock.now();
    this.nextLeaseId += 1;
    const lease = {
      leaseId: this.nextLeaseId,
      workerId: worker.workerId,
      claimedAtMs: now,
      leaseExpiresAtMs: now + this.leaseMs,
      claimOrdinal: record.claims + 1,
    };
    record.claims += 1;
    record.lease = lease;
    record.state = "in-flight";
    worker.jobs.add(record);
    this.counters.claimsGranted += 1;
    this.metrics.counter(METRICS.claims).inc();
    this.ledger.append(record, "claimed", {
      leaseId: lease.leaseId,
      workerId: worker.workerId,
      claimOrdinal: lease.claimOrdinal,
      leaseExpiresAtMs: lease.leaseExpiresAtMs,
    });
    this.stageLogger().info("gpu job claimed", {
      jobId: record.jobId,
      workerId: worker.workerId,
      claimOrdinal: lease.claimOrdinal,
      workerInFlight: worker.jobs.size,
    });
    return {
      job: this.ledger.envelopeOf(record.jobId) ?? unknownEnvelope(record.jobId),
      claimOrdinal: lease.claimOrdinal,
      leaseId: lease.leaseId,
      leaseExpiresAtMs: lease.leaseExpiresAtMs,
      deadlineAtMs: record.deadlineAtMs,
      maxAttempts: record.maxAttempts,
    };
  }

  /** Releases a record's lease (frees the worker slot). Idempotent. */
  private releaseLease(record: GpuJobRecord): void {
    const lease = record.lease;
    if (lease === undefined) return;
    record.lease = undefined;
    const worker = this.workerStates.get(lease.workerId);
    worker?.jobs.delete(record);
  }

  /** Requeues a lease-expired job within its claim budget (counted, loud). */
  private requeue(record: GpuJobRecord, lease: { leaseId: number; workerId: string }): void {
    this.counters.requeues += 1;
    this.metrics.counter(METRICS.requeues).inc();
    this.ledger.setState(record, "queued");
    this.insertReady(record);
    this.ledger.append(record, "requeued", {
      leaseId: lease.leaseId,
      fromWorkerId: lease.workerId,
      claims: record.claims,
      maxAttempts: record.maxAttempts,
    });
    this.stageLogger().warn("gpu job requeued (lease expired, claim budget remains)", {
      jobId: record.jobId,
      fromWorkerId: lease.workerId,
      claims: record.claims,
      maxAttempts: record.maxAttempts,
    });
  }

  /**
   * Job-major claimer matching: for each ready job in (priority desc,
   * sequence asc) order, grant it to the FIRST parked claimer that can run
   * it (FIFO among eligible); repeat while matches happen. Stale or
   * unknown workers never match (their claimers stay parked; a rejoin
   * revives them). No head-of-line blocking by non-matching claimers.
   */
  private pumpClaimers(): void {
    let matched = true;
    while (matched && this.claimers.length > 0 && this.ready.length > 0) {
      matched = false;
      for (const record of this.ready) {
        let found = -1;
        for (let j = 0; j < this.claimers.length; j += 1) {
          const claimer = this.claimers[j]!;
          const worker = this.workerStates.get(claimer.workerId);
          if (worker !== undefined && this.canRun(worker, record)) {
            found = j;
            break;
          }
        }
        if (found < 0) continue;
        const claimer = this.claimers.splice(found, 1)[0]!;
        const worker = this.workerStates.get(claimer.workerId)!;
        claimer.resolve(this.grant(record, worker));
        matched = true;
        break;
      }
    }
  }

  /** Sorted insert into the ready queue: priority DESC, sequence ASC. */
  private insertReady(record: GpuJobRecord): void {
    let index = this.ready.length;
    for (let i = 0; i < this.ready.length; i += 1) {
      const other = this.ready[i]!;
      if (
        other.priority < record.priority ||
        (other.priority === record.priority && other.sequence > record.sequence)
      ) {
        index = i;
        break;
      }
    }
    this.ready.splice(index, 0, record);
  }

  /** Removes a record from the ready queue (identity match). */
  private removeFromReady(record: GpuJobRecord): void {
    const index = this.ready.indexOf(record);
    if (index >= 0) this.ready.splice(index, 1);
  }

  // --- internals: terminal dispositions ------------------------------------------

  /** Records the terminal SUCCEEDED disposition (one event, one resolution). */
  private terminalSucceed(record: GpuJobRecord, report: GpuAttemptReport): void {
    this.assertTerminalable(record);
    this.ledger.setState(record, "succeeded");
    this.counters.succeeded += 1;
    this.metrics.counter(METRICS.succeeded).inc();
    const details: GpuJobEventDetails = {
      workerId: report.workerId,
      attempts: report.attempts,
      claims: record.claims,
      executionMs: report.timings.executionMs,
      attemptCount: report.timings.perAttempt.length,
    };
    this.ledger.append(record, "succeeded", details);
    this.observeLatency(record);
    this.resolveResult(record, {
      status: "succeeded",
      ...(report.output === undefined ? {} : { output: report.output }),
    });
  }

  /** Records a terminal FAILED disposition (fail-loud, classified). */
  private terminalFail(
    record: GpuJobRecord,
    failure: {
      errorClass: string;
      message: string;
      terminal: "timeout" | "non-retryable";
      eventType: "worker-stale" | "deadline-timeout" | "failed";
      timeoutKind?: "deadline" | "stale-worker";
      details?: GpuJobEventDetails;
    },
  ): void {
    this.assertTerminalable(record);
    this.ledger.setState(record, "failed");
    this.counters.failed += 1;
    this.metrics.counter(METRICS.failed).inc();
    if (failure.timeoutKind !== undefined) {
      this.counters.timeoutsDeadline += failure.timeoutKind === "deadline" ? 1 : 0;
      this.counters.timeoutsStale += failure.timeoutKind === "stale-worker" ? 1 : 0;
      this.metrics.counter(METRICS.timeouts, { [TIMEOUT_KIND_LABEL]: failure.timeoutKind }).inc();
    }
    this.ledger.append(record, failure.eventType, {
      errorClass: failure.errorClass,
      terminal: failure.terminal,
      ...(failure.details ?? {}),
    });
    this.observeLatency(record);
    this.resolveResult(record, {
      status: "failed",
      failure: {
        errorClass: failure.errorClass,
        message: failure.message,
        terminal: failure.terminal,
      },
    });
  }

  /** Records the terminal DEAD-LETTERED disposition (bounded DLQ entry). */
  private terminalDeadLetter(
    record: GpuJobRecord,
    failure: {
      errorClass: string;
      message: string;
      terminal: "retry-exhausted" | "internal";
    },
  ): void {
    this.assertTerminalable(record);
    this.ledger.setState(record, "dead-lettered");
    this.counters.deadLettered += 1;
    this.ledger.append(record, "dead-lettered", {
      errorClass: failure.errorClass,
      terminal: failure.terminal,
      attempts: record.attempts,
      claims: record.claims,
    });
    const entry: GpuDeadLetterEntry = {
      jobId: record.jobId,
      idempotencyKey: record.idempotencyKey,
      errorClass: failure.errorClass,
      message: failure.message,
      terminal: failure.terminal,
      attempts: record.attempts,
      claims: record.claims,
      retriesUsed: record.attempts - record.claims,
      atMs: this.clock.now(),
      job: this.ledger.envelopeOf(record.jobId) ?? unknownEnvelope(record.jobId),
      correlationId: record.correlationId,
      traceId: record.traceId,
    };
    this.dlq.record(entry);
    this.observeLatency(record);
    this.resolveResult(record, {
      status: "failed",
      failure: {
        errorClass: failure.errorClass,
        message: failure.message,
        terminal: failure.terminal,
      },
    });
  }

  /** Records the terminal CANCELLED disposition. */
  private terminalCancel(record: GpuJobRecord, reason: string): void {
    this.assertTerminalable(record);
    this.ledger.setState(record, "cancelled");
    this.counters.cancelled += 1;
    this.metrics.counter(METRICS.cancelled).inc();
    this.ledger.append(record, "cancelled", { reason });
    this.observeLatency(record);
    this.resolveResult(record, { status: "cancelled" });
  }

  /** Resolves the job's result promise exactly once (never rejects). */
  private resolveResult(
    record: GpuJobRecord,
    outcome:
      | { status: "succeeded"; output?: unknown }
      | { status: "failed"; failure: GpuJobFailure }
      | { status: "cancelled" },
  ): void {
    const resolve = this.resultResolvers.get(record.jobId);
    if (resolve === undefined) return; // internal breach — the settle assertions catch it
    this.resultResolvers.delete(record.jobId);
    const finishedAtMs = this.clock.now();
    const timing = {
      submittedAtMs: record.submittedAtMs,
      ...(record.startedAtMs === undefined
        ? {}
        : {
            startedAtMs: record.startedAtMs,
            queueWaitMs: record.startedAtMs - record.submittedAtMs,
          }),
      finishedAtMs,
      executionMs: record.reportedExecutionMs,
    };
    const result: GpuJobResult = {
      jobId: record.jobId,
      idempotencyKey: record.idempotencyKey,
      status: outcome.status,
      ...(outcome.status === "succeeded" && outcome.output !== undefined
        ? { output: outcome.output }
        : {}),
      ...(outcome.status === "failed" ? { failure: outcome.failure } : {}),
      attempts: record.attempts,
      claims: record.claims,
      retriesUsed: record.attempts - record.claims,
      timing,
      correlationId: record.correlationId,
      traceId: record.traceId,
    };
    this.metrics.histogram(METRICS.jobLatencyMs).observe(finishedAtMs - record.submittedAtMs);
    resolve(result);
  }

  /** Latency/queue-wait histograms (sweep-settled jobs measured honestly). */
  private observeLatency(record: GpuJobRecord): void {
    if (record.startedAtMs === undefined) return;
    this.metrics.histogram(METRICS.queueWaitMs).observe(record.startedAtMs - record.submittedAtMs);
  }

  /** Fail-loud guard: a terminal disposition path ran on a terminal record. */
  private assertTerminalable(record: GpuJobRecord): void {
    if (
      record.state === "succeeded" ||
      record.state === "failed" ||
      record.state === "cancelled" ||
      record.state === "dead-lettered"
    ) {
      throw new RangeError(
        `internal breach: terminal disposition attempted on job '${record.jobId}' ` +
          `already '${record.state}'`,
      );
    }
  }

  // --- internals: settle ---------------------------------------------------------

  /** Terminal-failure wind-down (the W302 budget posture). */
  private terminate(failureClass: TerminalFailureClass, message: string): void {
    if (this.terminal === undefined) {
      this.terminal = { failureClass, message };
    }
    if (this.phase === "running") {
      void this.settle().catch((err: unknown) => {
        this.stageLogger().error("gpu dispatcher failed while settling", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  /**
   * The settle path: final sweep, cancel-everything (each unresolved job
   * accounted CANCELLED — never lost), release parked claims, assert every
   * accounting identity and the ledger consistency, return the settled
   * result. An imbalance THROWS (rejects shutdown()) — never a lying
   * result.
   */
  private async settle(): Promise<GpuDispatchResult> {
    if (this.phase === "ended") {
      return this.settledResult as GpuDispatchResult;
    }
    this.sweep();
    for (const record of this.ledger.liveRecords()) {
      if (record.state === "queued") {
        this.removeFromReady(record);
        this.terminalCancel(record, "shutdown-cancel-queued");
      } else if (record.state === "in-flight") {
        this.releaseLease(record);
        this.terminalCancel(record, "shutdown-cancel-in-flight");
      }
    }
    for (const claimer of this.claimers.splice(0)) {
      claimer.resolve(undefined);
    }
    this.phase = "ended";

    const stats = this.statsSnapshot();
    assertGpuAccounting(stats);
    assertGpuLedgerConsistency(this.ledger.records(), stats);
    if (stats.inFlight !== 0) {
      throw new RangeError(`gpu dispatcher cannot settle with ${stats.inFlight} in-flight job(s)`);
    }

    const result: GpuDispatchResult = {
      dispatcherId: this.dispatcherId,
      outcome: this.terminal === undefined ? "stopped" : "failed",
      ...(this.terminal === undefined
        ? {}
        : {
            terminalFailureClass: this.terminal.failureClass,
            error: this.terminal.message,
          }),
      stats,
      jobs: this.ledger.records(),
      deadLetters: this.dlq.list(),
      balanced: true,
    };
    this.settledResult = result;
    this.stageLogger().info("gpu dispatcher settled", {
      outcome: result.outcome,
      stats,
    });
    return result;
  }

  /** Live snapshot: counters + derived queue/worker/DLQ projections. */
  private statsSnapshot(): GpuDispatchStats {
    const queuedJobs = this.ready.length;
    const executingJobs = [...this.workerStates.values()].reduce(
      (sum, worker) => sum + worker.jobs.size,
      0,
    );
    return {
      ...this.counters,
      queuedJobs,
      executingJobs,
      inFlight: queuedJobs + executingJobs,
      dlqRetained: this.dlq.size,
      dlqOverflow: this.dlq.overflow,
      workersActive: [...this.workerStates.values()].filter((worker) => worker.active).length,
    };
  }

  /** Binds correlation + dispatcher stage onto a child logger. */
  private stageLogger(): Logger {
    return bindLogger(this.logger, this.correlation, DISPATCHER_STAGE);
  }
}

/** Defensive fallback for an envelope the ledger must hold (never reachable). */
function unknownEnvelope(jobId: string): GpuJobEnvelope {
  return {
    jobId,
    idempotencyKey: jobId,
    kind: "unknown",
    payloadRef: "unknown",
    priority: 0,
    deadlineMs: 1,
  };
}

/** Correlation overrides for one submit. */
export interface SubmitOptions {
  /** Correlation id for this submission (default: the dispatcher's context). */
  correlationId?: string;
  /** Trace id for this submission (default: the dispatcher's context). */
  traceId?: string;
}

/** Structural validation of worker capabilities (config errors, fail-loud). */
function validateCapabilities(capabilities: GpuWorkerCapabilities): void {
  if (capabilities === null || typeof capabilities !== "object") {
    throw new RangeError("GpuWorkerCapabilities must be an object");
  }
  if (typeof capabilities.workerId !== "string" || capabilities.workerId.length < 1) {
    throw new RangeError(
      `GpuWorkerCapabilities.workerId must be a non-empty string (got ${String(capabilities.workerId)})`,
    );
  }
  if (!Number.isInteger(capabilities.maxConcurrentJobs) || capabilities.maxConcurrentJobs < 1) {
    throw new RangeError(
      `GpuWorkerCapabilities.maxConcurrentJobs must be an integer >= 1 ` +
        `(got ${String(capabilities.maxConcurrentJobs)})`,
    );
  }
  if (!Number.isFinite(capabilities.memoryMb) || capabilities.memoryMb < 0) {
    throw new RangeError(
      `GpuWorkerCapabilities.memoryMb must be a finite number >= 0 (got ${String(capabilities.memoryMb)})`,
    );
  }
  if (!Array.isArray(capabilities.modelClasses)) {
    throw new RangeError("GpuWorkerCapabilities.modelClasses must be an array of strings");
  }
  for (const modelClass of capabilities.modelClasses) {
    if (typeof modelClass !== "string" || modelClass.length < 1) {
      throw new RangeError(
        `GpuWorkerCapabilities.modelClasses entries must be non-empty strings (got ${String(modelClass)})`,
      );
    }
  }
  if (!Number.isFinite(capabilities.heartbeatIntervalMs) || capabilities.heartbeatIntervalMs <= 0) {
    throw new RangeError(
      `GpuWorkerCapabilities.heartbeatIntervalMs must be a finite number > 0 ` +
        `(got ${String(capabilities.heartbeatIntervalMs)})`,
    );
  }
}

/** Structural validation of one attempt report (trust-boundary guard). */
function isValidReport(report: GpuAttemptReport): boolean {
  if (report === null || typeof report !== "object") return false;
  if (typeof report.workerId !== "string" || report.workerId.length < 1) return false;
  if (typeof report.jobId !== "string" || report.jobId.length < 1) return false;
  if (!Number.isInteger(report.leaseId) || report.leaseId < 1) return false;
  if (report.status !== "succeeded" && report.status !== "failed" && report.status !== "timeout") {
    return false;
  }
  if (!Number.isInteger(report.attempts) || report.attempts < 0) return false;
  const timings = report.timings;
  if (timings === null || typeof timings !== "object") return false;
  if (!Number.isFinite(timings.startedAtMs)) return false;
  if (!Number.isFinite(timings.finishedAtMs)) return false;
  if (!Number.isFinite(timings.executionMs) || timings.executionMs < 0) return false;
  if (!Array.isArray(timings.perAttempt)) return false;
  return true;
}
