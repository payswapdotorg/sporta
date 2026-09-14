/**
 * `GpuWorker` (W303) — the worker half of the GPU worker protocol: the
 * in-process reference agent that talks to a {@link GpuDispatcherPort}.
 *
 * Responsibilities, all on the injected clock:
 *
 * - REGISTRATION: declares capabilities (abstract resource metadata —
 *   advisory, never measured); the dispatcher acks the lease/staleness
 *   contract in force;
 * - HEARTBEATS: a periodic emitter — `heartbeatIntervalMs` of clock time
 *   between beats, monotone sequence numbers, advisory load telemetry
 *   (in-flight count + DECLARED memory in use). The loop parks on
 *   `clock.waitUntil` (passive): it never consumes time and never spins
 *   the microtask queue; beats fire when other actors' work (or a
 *   fixture's `advance`) crosses the deadlines;
 * - CLAIMS: pulls jobs while below `maxConcurrentJobs` (the dispatcher
 *   grants leases; claims resolve `undefined` when the worker should stop
 *   claiming);
 * - EXECUTION: bounded executor retries around the injectable
 *   {@link GpuJobExecutor} seam — W104 pure-arithmetic backoff
 *   (`baseDelayMs * backoffMultiplier^(attempt-1)`) slept through the
 *   injected clock, with the W104 rule VERBATIM (non-retryable failures
 *   are NEVER blind-retried) and three deadline checkpoints (before the
 *   first attempt, before each backoff, after each backoff) — a deadline
 *   breach reports `timeout` and stops retrying;
 * - REPORTING: one report per claim with per-attempt timings measured on
 *   the injected clock; the ack is checked (a superseded report — lease
 *   lost to expiry, job cancelled/timed-out elsewhere — is logged, never
 *   retried, never resubmitted: the dispatcher owns the job's outcome).
 *
 * Honest semantics (PROTOCOL.md): an executor invocation that never
 * settles cannot be killed (the W302 posture) — `stop({ mode: "await" })`
 * waits for it, `stop({ mode: "abandon" })` leaves it running in the
 * background (its eventual report is counted superseded or recorded by
 * the still-open port). A claim granted but not yet executed when stop
 * wins the race is recovered by lease expiry on the dispatcher side —
 * counted, never lost.
 */
import { bindLogger, createLogger } from "@sporta/observability";
import type { CorrelationContext, Logger } from "@sporta/observability";
import type { GpuClock } from "./clock";
import type { GpuJobEnvelope } from "./job";
import type { GpuDispatcherPort } from "./types";
import { DEFAULT_WORKER_RETRY } from "./types";
import type {
  GpuAttemptReport,
  GpuAttemptTiming,
  GpuExecutorOutcome,
  GpuJobClaim,
  GpuJobExecutor,
  GpuRegistrationAck,
  GpuWorkerCapabilities,
  GpuWorkerRetryPolicy,
} from "./types";

/** Worker-side observability seams (defaults: silent no-ops). */
export interface GpuWorkerObservability {
  /** Structured logger (default: silent). */
  logger?: Logger;
  /** Correlation context (default: deterministic ids from the worker id). */
  correlation?: CorrelationContext;
}

/** Options for {@link GpuWorker}. */
export interface GpuWorkerOptions {
  capabilities: GpuWorkerCapabilities;
  executor: GpuJobExecutor;
  port: GpuDispatcherPort;
  clock: GpuClock;
  /**
   * Executor retry policy within one claim (default: NO retries — the
   * W302/W104 explicit-opt-in posture). Lease-expiry requeue is the
   * dispatcher-level retry layer and is configured on the dispatcher.
   */
  executorRetry?: GpuWorkerRetryPolicy;
  observability?: GpuWorkerObservability;
}

/** How `stop()` treats in-flight executions. */
export type GpuWorkerStopMode = "await" | "abandon";

/** Worker-side activity snapshot (determinism evidence). */
export interface GpuWorkerStats {
  workerId: string;
  started: boolean;
  stopped: boolean;
  heartbeatsEmitted: number;
  lastHeartbeatSequence: number;
  jobsClaimed: number;
  attemptsExecuted: number;
  inFlight: number;
}

/**
 * The in-process reference worker. Construct with capabilities + executor
 * + port + clock; `start()` registers and spins the heartbeat/claim
 * loops; `stop()` settles them (idempotent).
 */
export class GpuWorker {
  private readonly capabilities: GpuWorkerCapabilities;
  private readonly executor: GpuJobExecutor;
  private readonly port: GpuDispatcherPort;
  private readonly clock: GpuClock;
  private readonly executorRetry: GpuWorkerRetryPolicy;
  private readonly logger: Logger;
  private readonly correlation: CorrelationContext;
  private registration: GpuRegistrationAck | undefined;

  private readonly executions = new Set<Promise<void>>();
  private readonly activeClaims = new Map<string, GpuJobClaim>();
  private readonly executionNotifiers: Array<() => void> = [];
  private heartbeatLoop: Promise<void> | undefined;
  private claimLoop: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;
  private readonly stopSignal: Promise<void>;
  private stopResolve: (() => void) | undefined;
  private started = false;
  private stopped = false;
  private heartbeatSequence = 0;
  private heartbeatsEmitted = 0;
  private jobsClaimed = 0;
  private attemptsExecuted = 0;

  constructor(options: GpuWorkerOptions) {
    if (options.capabilities === null || typeof options.capabilities !== "object") {
      throw new RangeError("GpuWorker requires capabilities");
    }
    if (typeof options.executor?.execute !== "function") {
      throw new TypeError("GpuWorker requires an executor with an execute() function");
    }
    if (
      options.port === null ||
      typeof options.port !== "object" ||
      typeof options.port.registerWorker !== "function" ||
      typeof options.port.heartbeat !== "function" ||
      typeof options.port.claimJob !== "function" ||
      typeof options.port.reportResult !== "function"
    ) {
      throw new TypeError("GpuWorker requires a GpuDispatcherPort (all four methods)");
    }
    if (
      options.clock === null ||
      typeof options.clock !== "object" ||
      typeof options.clock.now !== "function" ||
      typeof options.clock.sleep !== "function" ||
      typeof options.clock.waitUntil !== "function"
    ) {
      throw new TypeError("GpuWorker requires an injected GpuClock (now/sleep/waitUntil)");
    }
    const retry = options.executorRetry ?? DEFAULT_WORKER_RETRY;
    if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1) {
      throw new RangeError(
        `GpuWorker executorRetry.maxAttempts must be an integer >= 1 (got ${String(retry.maxAttempts)})`,
      );
    }
    if (!Number.isFinite(retry.baseDelayMs) || retry.baseDelayMs < 0) {
      throw new RangeError(
        `GpuWorker executorRetry.baseDelayMs must be a finite number >= 0 (got ${String(retry.baseDelayMs)})`,
      );
    }
    if (!Number.isFinite(retry.backoffMultiplier) || retry.backoffMultiplier < 1) {
      throw new RangeError(
        `GpuWorker executorRetry.backoffMultiplier must be a finite number >= 1 ` +
          `(got ${String(retry.backoffMultiplier)})`,
      );
    }
    this.capabilities = options.capabilities;
    this.executor = options.executor;
    this.port = options.port;
    this.clock = options.clock;
    this.executorRetry = retry;
    const workerId = this.capabilities.workerId;
    const noopLogger = createLogger({ minLevel: "error", sink: () => {} });
    this.logger = options.observability?.logger ?? noopLogger;
    this.correlation = options.observability?.correlation ?? {
      sessionId: `worker-${workerId}`,
      correlationId: `corr-worker-${workerId}`,
      traceId: `trace-worker-${workerId}`,
    };
    this.stopSignal = new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });
  }

  /** The worker id (capabilities). */
  get workerId(): string {
    return this.capabilities.workerId;
  }

  /** The registration ack, once `start()` resolved. */
  get registrationAck(): GpuRegistrationAck | undefined {
    return this.registration;
  }

  /**
   * Registers with the dispatcher and spins the heartbeat + claim loops.
   * Rejects loudly on a misconfiguration (duplicate live id, impossible
   * lease/heartbeat relation — the dispatcher's fail-closed validation).
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new RangeError(`GpuWorker '${this.workerId}' already started`);
    }
    const ack = await this.port.registerWorker(this.capabilities);
    this.registration = ack;
    this.started = true;
    this.workerLogger().info("gpu worker started", {
      leaseMs: ack.leaseMs,
      staleAfterMs: ack.staleAfterMs,
      heartbeatIntervalMs: this.capabilities.heartbeatIntervalMs,
      maxConcurrentJobs: this.capabilities.maxConcurrentJobs,
    });
    this.heartbeatLoop = this.runHeartbeatLoop();
    this.claimLoop = this.runClaimLoop();
  }

  /**
   * Stops the worker (idempotent). `await` mode (default) waits for every
   * in-flight execution to settle and report; `abandon` mode returns
   * immediately, leaving executions running in the background (their
   * eventual reports are counted superseded or recorded — never lost).
   */
  async stop(options: { mode?: GpuWorkerStopMode } = {}): Promise<void> {
    const mode = options.mode ?? "await";
    if (mode !== "await" && mode !== "abandon") {
      throw new RangeError(`stop mode must be "await" | "abandon" (got ${String(mode)})`);
    }
    if (this.stopPromise === undefined) {
      this.stopPromise = this.doStop(mode);
    }
    return await this.stopPromise;
  }

  private async doStop(mode: GpuWorkerStopMode): Promise<void> {
    this.stopped = true;
    this.stopResolve?.();
    if (mode === "await") {
      await Promise.allSettled([...this.executions]);
    }
    await this.heartbeatLoop;
    await this.claimLoop;
    this.workerLogger().info("gpu worker stopped", {
      mode,
      heartbeatsEmitted: this.heartbeatsEmitted,
      jobsClaimed: this.jobsClaimed,
      attemptsExecuted: this.attemptsExecuted,
    });
  }

  /** Worker-side activity snapshot (determinism evidence). */
  stats(): GpuWorkerStats {
    return {
      workerId: this.workerId,
      started: this.started,
      stopped: this.stopped,
      heartbeatsEmitted: this.heartbeatsEmitted,
      lastHeartbeatSequence: this.heartbeatSequence,
      jobsClaimed: this.jobsClaimed,
      attemptsExecuted: this.attemptsExecuted,
      inFlight: this.executions.size,
    };
  }

  // --- heartbeat loop ---------------------------------------------------------

  private async runHeartbeatLoop(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      const dueMs = this.clock.now() + this.capabilities.heartbeatIntervalMs;
      await Promise.race([this.clock.waitUntil(dueMs), this.stopSignal]);
      if (this.stopped) return;
      this.heartbeatSequence += 1;
      this.heartbeatsEmitted += 1;
      const ack = await this.port.heartbeat(this.workerId, {
        sequence: this.heartbeatSequence,
        dueMs,
        inFlight: this.executions.size,
        advisoryMemoryInUseMb: this.advisoryMemoryInUseMb(),
      });
      if (!ack.accepted) {
        if (ack.reason === "dispatcher-ended") {
          this.stopped = true;
          this.stopResolve?.();
          this.workerLogger().info("gpu worker heartbeat saw dispatcher ended — stopping");
          return;
        }
        // Unknown worker / non-monotone: log loud, keep beating (the claim
        // loop stops itself when claims resolve undefined — documented).
        this.workerLogger().warn("gpu worker heartbeat rejected", {
          sequence: this.heartbeatSequence,
          reason: ack.reason,
        });
      }
    }
  }

  /** Advisory declared memory in use (Σ in-flight requirements; never measured). */
  private advisoryMemoryInUseMb(): number {
    let total = 0;
    for (const claim of this.activeClaims.values()) {
      total += claim.job.requirements?.memoryMb ?? 0;
    }
    return total;
  }

  // --- claim loop ---------------------------------------------------------------

  private async runClaimLoop(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      if (this.executions.size >= this.capabilities.maxConcurrentJobs) {
        await Promise.race([this.waitForAnyExecution(), this.stopSignal]);
        continue;
      }
      const claim = await Promise.race([
        this.port.claimJob(this.workerId),
        this.stopSignal.then(() => undefined),
      ]);
      if (claim === undefined) {
        // Dispatcher ended (or the worker is unknown/stale to it): stop.
        this.stopped = true;
        this.stopResolve?.();
        return;
      }
      this.jobsClaimed += 1;
      const execution = this.executeClaim(claim);
      this.executions.add(execution);
      void execution.then(() => {
        this.executions.delete(execution);
        this.activeClaims.delete(claim.job.jobId);
        const notifiers = this.executionNotifiers.splice(0);
        for (const notify of notifiers) notify();
      });
    }
  }

  /** Resolves when any in-flight execution settles (capacity semaphore). */
  private waitForAnyExecution(): Promise<void> {
    if (this.executions.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.executionNotifiers.push(resolve);
    });
  }

  // --- execution ------------------------------------------------------------------

  /**
   * Executes one claim: bounded executor retries with deadline checkpoints,
   * then one report. Never throws (faults are logged and the job is left to
   * lease-expiry recovery on the dispatcher side — counted, never lost).
   */
  private async executeClaim(claim: GpuJobClaim): Promise<void> {
    this.activeClaims.set(claim.job.jobId, claim);
    try {
      if (this.stopped) return; // claim consumed, never executed — lease-expiry recovers
      await this.executeClaimInner(claim);
    } catch (err) {
      this.workerLogger().error("gpu worker execution failed to report", {
        jobId: claim.job.jobId,
        leaseId: claim.leaseId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async executeClaimInner(claim: GpuJobClaim): Promise<void> {
    const job: GpuJobEnvelope = claim.job;
    const deadlineAtMs = claim.deadlineAtMs;
    const line = this.workerLogger();
    const perAttempt: GpuAttemptTiming[] = [];
    let attempts = 0;
    let executionMs = 0;
    let firstAttemptStart: number | undefined;

    const timings = (): GpuAttemptReport["timings"] => ({
      startedAtMs: firstAttemptStart ?? this.clock.now(),
      finishedAtMs: this.clock.now(),
      executionMs,
      perAttempt: [...perAttempt],
    });
    const report = async (
      outcome:
        | { status: "succeeded"; output: unknown }
        | { status: "failed"; errorClass: string; message: string; retryable: boolean }
        | { status: "timeout"; message: string },
    ): Promise<void> => {
      const payload: GpuAttemptReport = {
        workerId: this.workerId,
        jobId: job.jobId,
        leaseId: claim.leaseId,
        status: outcome.status,
        ...(outcome.status === "succeeded" ? { output: outcome.output } : {}),
        ...(outcome.status === "failed"
          ? {
              errorClass: outcome.errorClass,
              message: outcome.message,
              retryable: outcome.retryable,
            }
          : {}),
        ...(outcome.status === "timeout"
          ? { errorClass: "deadline-timeout", message: outcome.message }
          : {}),
        attempts,
        timings: timings(),
      };
      const ack = await this.port.reportResult(payload);
      line.info("gpu worker reported claim outcome", {
        jobId: job.jobId,
        leaseId: claim.leaseId,
        status: payload.status,
        attempts,
        ackStatus: ack.status,
        ...(ack.reason === undefined ? {} : { ackReason: ack.reason }),
      });
    };

    for (;;) {
      // Deadline checkpoint 1: before every attempt.
      if (this.clock.now() >= deadlineAtMs) {
        await report({ status: "timeout", message: "deadline reached before the attempt started" });
        return;
      }
      attempts += 1;
      this.attemptsExecuted += 1;
      const attemptStart = this.clock.now();
      if (firstAttemptStart === undefined) firstAttemptStart = attemptStart;
      let outcome: GpuExecutorOutcome;
      try {
        outcome = await this.executor.execute(job);
      } catch (err) {
        // A thrown executor fault maps to the reserved `internal` class —
        // never retried blindly, dead-lettered by the dispatcher (W302 rule).
        outcome = {
          status: "failed",
          errorClass: "internal",
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        };
      }
      const durationMs = this.clock.now() - attemptStart;
      executionMs += durationMs;
      perAttempt.push({
        startedAtMs: attemptStart,
        durationMs,
        ...(outcome.status === "failed" ? { errorClass: outcome.errorClass } : {}),
      });
      if (outcome.status === "succeeded") {
        await report({ status: "succeeded", output: outcome.output });
        return;
      }
      if (!outcome.retryable || attempts >= this.executorRetry.maxAttempts) {
        await report({
          status: "failed",
          errorClass: outcome.errorClass,
          message: outcome.message,
          retryable: outcome.retryable,
        });
        return;
      }
      // Deadline checkpoint 2: before the backoff.
      if (this.clock.now() >= deadlineAtMs) {
        await report({ status: "timeout", message: "deadline reached before the retry backoff" });
        return;
      }
      // W104 pure arithmetic backoff, slept through the injected clock.
      const delayMs =
        this.executorRetry.baseDelayMs *
        Math.pow(this.executorRetry.backoffMultiplier, attempts - 1);
      await this.clock.sleep(delayMs);
      // Deadline checkpoint 3: after the backoff.
      if (this.clock.now() >= deadlineAtMs) {
        await report({ status: "timeout", message: "deadline crossed during the retry backoff" });
        return;
      }
    }
  }

  /** Binds correlation + worker stage onto a child logger. */
  private workerLogger(): Logger {
    return bindLogger(this.logger, this.correlation, "gpu-worker");
  }
}
