/**
 * GPU worker protocol domain types (W303): capabilities, heartbeats, claims,
 * attempt reports, result envelopes, ledger records/events, dead-letter
 * entries, accounting stats, options, and the metric vocabulary — plus the
 * BALANCE ASSERTIONS, the heart of the never-silent constitution.
 *
 * THE ACCOUNTING INVARIANT (the W303 work-item formula, runtime-asserted at
 * every settle — an imbalance REJECTS the shutdown() promise instead of
 * returning a lying result, the W301/W302 fail-loud posture):
 *
 *   `jobsSubmitted === jobsSucceeded + jobsFailed + jobsCancelled +
 *    jobsDeadLettered + duplicates`  (+ in-flight during a run; 0 at settle)
 *
 * Split into exact, independently-mutatable checks:
 *
 * 1. `jobsSubmitted === admitted + duplicates` — every ledger-populating
 *    submit either became a job or was a counted idempotent duplicate;
 * 2. `admitted === succeeded + failed + cancelled + deadLettered + inFlight`
 *    — every admitted job lands in EXACTLY ONE terminal bucket:
 *    `succeeded` / `failed` / `cancelled` / `dead-lettered`, with the
 *    not-yet-terminal jobs (queued + executing) as `inFlight` (0 at
 *    settle — shutdown cancels everything unresolved);
 * 3. `inFlight === queuedJobs + executingJobs` — the two live sub-states;
 * 4. `deadLettered === dlqRetained + dlqOverflow` — the bounded DLQ ledger
 *    identity (the W302 posture: overflow is counted + logged + metered,
 *    never silent).
 *
 * DELIBERATE DIVERGENCE FROM W302, documented (the W303 brief's identity
 * has NO rejected term): boundary refusals at `submit()` — malformed
 * envelopes and typed `GpuResourceLimitError` capacity refusals — THROW
 * typed errors and carry their OWN counters (`malformedSubmissions`,
 * `refusedSubmissions`); they never entered the ledger, so they are not in
 * the terminal identity. The W302 pipeline counted its input refusals
 * inside `segmentsIn` because a pipeline admit is a channel send; a W303
 * submit that never became a job has nothing to account downstream — the
 * caller learned the refusal synchronously and loudly.
 *
 * FAILED vs DEAD-LETTERED (the two failure buckets, exactly one per job):
 *
 * - `failed` — a DETERMINATE terminal failure: the executor classified the
 *   work non-retryable, or the job's deadline fired (`deadline-timeout`),
 *   or the executing worker went stale (`worker-stale` — fail-LOUD with
 *   timeout classification, never silently reassigned);
 * - `deadLettered` — a RECOVERY-BUDGET exhaustion: retryable executor
 *   failures consumed the worker retry budget (`retry-exhausted`, the W104
 *   rule — non-retryable failures are NEVER blind-retried), lease-expiry
 *   requeues consumed the claim budget (`lease-expired` →
 *   `retry-exhausted`), or an internal bug (`internal`, the W302 mapping
 *   of thrown executor faults). These land in the bounded DLQ with the
 *   W302 terminal classification.
 *
 * Both resolve their result envelope with status `"failed"`; the ledger
 * buckets stay disjoint so the identity closes exactly.
 */
import type { TerminalFailureClass } from "@sporta/contracts";
import type { CorrelationContext, Logger, MetricsRegistry } from "@sporta/observability";
import type { GpuClock } from "./clock";
import type { GpuJobEnvelope, GpuJobRequirements } from "./job";

// ---------------------------------------------------------------------------
// Worker-side contracts
// ---------------------------------------------------------------------------

/**
 * A worker's declared capabilities and resource capacity (ABSTRACT, not
 * GPU-specific — architecture-lock §9 vendor neutrality). Declarations are
 * the worker's own claims; the protocol trusts them for admission and
 * never measures actual usage (the honest limitation documented in
 * PROTOCOL.md §6).
 */
export interface GpuWorkerCapabilities {
  /** Worker identity (non-empty; unique among live workers). */
  workerId: string;
  /** Maximum simultaneously leased jobs (integer >= 1). */
  maxConcurrentJobs: number;
  /** Declared memory capacity in MB (finite >= 0; advisory). */
  memoryMb: number;
  /** Declared abstract model classes served (non-empty strings). */
  modelClasses: string[];
  /** The worker's heartbeat period in ms (finite > 0). */
  heartbeatIntervalMs: number;
}

/** Registration acknowledgment: the lease/staleness contract in force. */
export interface GpuRegistrationAck {
  /** Lease duration granted per claim (renewed on every heartbeat). */
  leaseMs: number;
  /** Staleness threshold: no heartbeat for this long = stale. */
  staleAfterMs: number;
}

/** One worker heartbeat — liveness + advisory load telemetry. */
export interface GpuHeartbeat {
  /** Monotone sequence (>= 1, strictly increasing per worker). */
  sequence: number;
  /** The deadline this heartbeat was scheduled for (worker telemetry). */
  dueMs: number;
  /** Jobs currently executing on the worker (advisory load). */
  inFlight: number;
  /**
   * Advisory memory in use (MB) — DERIVED from in-flight job requirements,
   * never measured (the honest resource-metadata posture).
   */
  advisoryMemoryInUseMb: number;
}

/** Heartbeat receipt outcome. */
export interface GpuHeartbeatAck {
  accepted: boolean;
  /** Short machine reason when not accepted. */
  reason?: string;
  /** Dispatcher lifecycle state, for worker-side decisions. */
  dispatcherState: "running" | "ended";
}

/** One granted claim: the job plus its lease and budgets. */
export interface GpuJobClaim {
  /** The job envelope, verbatim. */
  job: GpuJobEnvelope;
  /** 1-based claim ordinal (lease epoch) for this job. */
  claimOrdinal: number;
  /** The lease's id (reports must carry it to be valid). */
  leaseId: number;
  /** Absolute lease expiry (renewed on every heartbeat). */
  leaseExpiresAtMs: number;
  /** Absolute whole-job deadline (submittedAtMs + deadlineMs). */
  deadlineAtMs: number;
  /** The job's claim budget (lease-epoch bound). */
  maxAttempts: number;
}

// ---------------------------------------------------------------------------
// Executor seam (vendor-neutral, in-process fixtures in tests)
// ---------------------------------------------------------------------------

/**
 * The outcome of ONE executor invocation over one job (the injectable seam
 * — no real GPU, no process, no network; deterministic fixtures prove the
 * protocol around it):
 *
 * - `succeeded` — work completed, `output` opaque;
 * - `failed` — classified failure: `retryable` failures get bounded
 *   deterministic retries (worker-side W104 backoff); NON-retryable
 *   failures are never blind-retried. `errorClass === "internal"` is
 *   RESERVED for the worker's own mapping of thrown executor faults (the
 *   W302 convention).
 */
export type GpuExecutorOutcome =
  | { status: "succeeded"; output: unknown }
  | { status: "failed"; errorClass: string; message: string; retryable: boolean };

/** The executor seam: one job in, one attempt outcome out. */
export interface GpuJobExecutor {
  execute(job: GpuJobEnvelope): Promise<GpuExecutorOutcome>;
}

/**
 * Worker-side executor retry policy (the W104 `RetryOptions` arithmetic,
 * deadline-aware). Default: NO retries — retries are an explicit,
 * deterministic/idempotent-only policy choice (the W302 default posture).
 */
export interface GpuWorkerRetryPolicy {
  /** Total executor invocations per claim, including the first (>= 1). */
  maxAttempts: number;
  /** Delay before the second attempt (>= 0). */
  baseDelayMs: number;
  /** Exponential backoff factor (>= 1). */
  backoffMultiplier: number;
}

/** The frozen no-retries default (the W104/W302 posture). */
export const DEFAULT_WORKER_RETRY: GpuWorkerRetryPolicy = Object.freeze({
  maxAttempts: 1,
  baseDelayMs: 0,
  backoffMultiplier: 1,
});

// ---------------------------------------------------------------------------
// Attempt reports (worker -> dispatcher)
// ---------------------------------------------------------------------------

/** Timing of one executor invocation, measured on the injected clock. */
export interface GpuAttemptTiming {
  startedAtMs: number;
  durationMs: number;
  /** The attempt's error class, when it failed. */
  errorClass?: string;
}

/** The worker's report for one claim (after its bounded retries). */
export interface GpuAttemptReport {
  workerId: string;
  jobId: string;
  /** The claim's lease id (mismatch = superseded report). */
  leaseId: number;
  status: "succeeded" | "failed" | "timeout";
  /** Present iff `status === "succeeded"` (opaque executor output). */
  output?: unknown;
  /** Present iff `status !== "succeeded"`. */
  errorClass?: string;
  /** Present iff `status !== "succeeded"`. */
  message?: string;
  /** The executor's final retryability (present iff `status === "failed"`). */
  retryable?: boolean;
  /** Executor invocations consumed by this claim (>= 0). */
  attempts: number;
  timings: {
    /**
     * REQUIRED-SHAPE field: the first executor invocation's start when
     * `attempts > 0`; when `attempts === 0` (deadline before the attempt
     * started) the worker sends a placeholder and the DISPATCHER ignores
     * it — a never-executed job reports no execution start.
     */
    startedAtMs: number;
    finishedAtMs: number;
    executionMs: number;
    perAttempt: GpuAttemptTiming[];
  };
}

/** Report receipt outcome (never silent — every report is accounted). */
export interface GpuReportAck {
  status: "recorded" | "superseded" | "unknown-job";
  reason?: string;
}

// ---------------------------------------------------------------------------
// Result envelopes (dispatcher -> submitter)
// ---------------------------------------------------------------------------

/**
 * The terminal classification of a failed job (the W302 DLQ taxonomy,
 * extended with the W303 timeout class):
 *
 * - `non-retryable` — the executor classified the failure never-retry;
 * - `retry-exhausted` — a bounded recovery budget ran out (executor
 *   retries, or lease-expiry requeues);
 * - `timeout` — a time budget fired (deadline or stale worker);
 * - `internal` — a thrown/invalid executor fault (the W302 mapping).
 */
export type GpuTerminalClass = "non-retryable" | "retry-exhausted" | "timeout" | "internal";

/** Failure details on a result envelope (present iff status `"failed"`). */
export interface GpuJobFailure {
  /** Machine error class (executor's, or protocol: `deadline-timeout`,
   *  `worker-stale`, `lease-expired`, `internal`). */
  errorClass: string;
  /** Human-readable message. */
  message: string;
  /** The W303 terminal classification. */
  terminal: GpuTerminalClass;
}

/** Result timing, measured on the injected clocks (see PROTOCOL.md §5). */
export interface GpuJobResultTiming {
  /** Dispatcher clock at submit. */
  submittedAtMs: number;
  /** Worker clock at the first executor invocation (absent if never executed). */
  startedAtMs?: number;
  /** Dispatcher clock at the terminal disposition. */
  finishedAtMs: number;
  /** `startedAtMs - submittedAtMs` (present iff the job ever executed). */
  queueWaitMs?: number;
  /** Total worker-reported execution time (0 when never executed). */
  executionMs: number;
}

/**
 * The settled result of one job — resolved by the dispatcher when the job
 * reaches its EXACTLY-ONE terminal disposition. Failures are VALUES (the
 * promise never rejects): awaiting a failed job yields status `"failed"`
 * with the classification. Dead-lettered jobs resolve with status
 * `"failed"` and `failure.terminal` `"retry-exhausted"`/`"internal"`.
 */
export interface GpuJobResult {
  jobId: string;
  idempotencyKey: string;
  status: "succeeded" | "failed" | "cancelled";
  /** The executor's output, verbatim (present iff succeeded). */
  output?: unknown;
  /** Present iff failed. */
  failure?: GpuJobFailure;
  /** TOTAL executor invocations reported across all claims (honest sum). */
  attempts: number;
  /** Total claims (lease epochs) the job consumed. */
  claims: number;
  /** `attempts - claims` — every invocation beyond one-per-claim. */
  retriesUsed: number;
  timing: GpuJobResultTiming;
  correlationId: string;
  traceId: string;
}

// ---------------------------------------------------------------------------
// The dispatcher port (the vendor-neutral seam)
// ---------------------------------------------------------------------------

/**
 * The dispatcher-facing surface a worker talks to. In-process fixtures
 * wire `GpuJobDispatcher` directly; real deployments put a wire (RPC,
 * queue, socket) behind this interface — the protocol never assumes a
 * specific transport (architecture-lock §9).
 */
export interface GpuDispatcherPort {
  registerWorker(capabilities: GpuWorkerCapabilities): Promise<GpuRegistrationAck>;
  heartbeat(workerId: string, heartbeat: GpuHeartbeat): Promise<GpuHeartbeatAck>;
  /**
   * Claims the next job this worker can run. Parks while nothing eligible
   * is available; resolves `undefined` when the worker should stop
   * claiming (dispatcher ended, or worker unknown/stale).
   */
  claimJob(workerId: string): Promise<GpuJobClaim | undefined>;
  reportResult(report: GpuAttemptReport): Promise<GpuReportAck>;
}

// ---------------------------------------------------------------------------
// Submit / cancel outcomes (dispatcher public API)
// ---------------------------------------------------------------------------

/** The resolved disposition of one `submit()` call. */
export type GpuSubmitHandle =
  | {
      disposition: "admitted";
      jobId: string;
      /** Resolves with the job's terminal result (never rejects). */
      result: Promise<GpuJobResult>;
    }
  | {
      /** The key is known (in flight or terminally disposed) — counted
       *  duplicate, skipped, never double-claimed. */
      disposition: "duplicate";
      jobId: string;
      idempotencyKey: string;
      /** The known key's state at refusal. */
      keyState: GpuJobState;
    };

/** The resolved disposition of one `cancel()` call. */
export type GpuCancelOutcome =
  | { cancelled: true; jobId: string }
  | {
      /** Idempotent no-op: the job is already terminal (nothing counted). */
      cancelled: false;
      jobId: string;
      disposition: GpuTerminalDisposition;
    };

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/** A job's live or terminal state. */
export type GpuJobState =
  "queued" | "in-flight" | "succeeded" | "failed" | "cancelled" | "dead-lettered";

/** A job's terminal disposition (exactly one per job). */
export type GpuTerminalDisposition = "succeeded" | "failed" | "cancelled" | "dead-lettered";

/** The decision types a job's event trail records (never-silent ledger). */
export type GpuJobEventType =
  | "submitted"
  | "claimed"
  | "lease-expired"
  | "requeued"
  | "worker-stale"
  | "deadline-timeout"
  | "cancelled"
  | "superseded-report"
  | "succeeded"
  | "failed"
  | "dead-lettered";

/** Structured, JSON-safe details carried on ledger events. */
export type GpuJobEventDetails = Record<string, unknown>;

/** One frozen decision event on a job's trail. */
export interface GpuJobEvent {
  type: GpuJobEventType;
  /** Dispatcher clock at the decision. */
  atMs: number;
  /** Structured, JSON-safe evidence (attempt breakdown, worker ids, …). */
  details: GpuJobEventDetails;
}

/** The active lease of an in-flight job. */
export interface GpuJobLease {
  leaseId: number;
  workerId: string;
  claimedAtMs: number;
  leaseExpiresAtMs: number;
  claimOrdinal: number;
}

/** One job's full ledger record (the never-silent trail). */
export interface GpuJobRecord {
  jobId: string;
  idempotencyKey: string;
  kind: string;
  priority: number;
  requirements?: GpuJobRequirements;
  /** Submission sequence (priority ties break by this, ascending). */
  sequence: number;
  submittedAtMs: number;
  deadlineAtMs: number;
  maxAttempts: number;
  state: GpuJobState;
  /** The active lease (present iff in-flight). */
  lease?: GpuJobLease;
  /** Claims (lease epochs) granted so far. */
  claims: number;
  /** Executor invocations reported so far (recorded + superseded reports). */
  attempts: number;
  /** Total worker-reported execution time across all reports. */
  reportedExecutionMs: number;
  /** Absolute first-executor-invocation time, when any report arrived. */
  startedAtMs?: number;
  /** The frozen decision trail in occurrence order. */
  events: GpuJobEvent[];
  correlationId: string;
  traceId: string;
}

/** One bounded dead-letter entry (the W302 shape, W303 semantics). */
export interface GpuDeadLetterEntry {
  jobId: string;
  idempotencyKey: string;
  /** Machine error class of the final failure. */
  errorClass: string;
  message: string;
  /** Why dead-lettered: retry budget exhausted (executor or lease), or internal. */
  terminal: "retry-exhausted" | "internal";
  /** Total executor invocations reported. */
  attempts: number;
  /** Total claims (lease epochs) consumed. */
  claims: number;
  /** `attempts - claims`. */
  retriesUsed: number;
  /** Dispatcher clock at dead-letter time. */
  atMs: number;
  /** The job envelope, verbatim. */
  job: GpuJobEnvelope;
  correlationId: string;
  traceId: string;
}

// ---------------------------------------------------------------------------
// Worker observation (dispatcher-side)
// ---------------------------------------------------------------------------

/** Dispatcher-side liveness snapshot of one registered worker. */
export interface GpuWorkerStatus {
  workerId: string;
  active: boolean;
  registeredAtMs: number;
  lastHeartbeatAtMs: number;
  lastSequence: number;
  inFlightJobs: number;
}

// ---------------------------------------------------------------------------
// Accounting stats + assertions
// ---------------------------------------------------------------------------

/** Whole-dispatcher accounting (invariants in the module doc). */
export interface GpuDispatchStats {
  /** Ledger-populating submits (admitted + duplicates). */
  jobsSubmitted: number;
  /** Unique jobs admitted to the ready queue. */
  admitted: number;
  /** Re-submissions of known idempotency keys (counted, skipped). */
  duplicates: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  deadLettered: number;
  /** Not-yet-terminal jobs (queued + executing; 0 at settle). */
  inFlight: number;
  queuedJobs: number;
  executingJobs: number;
  /** Malformed envelope refusals at submit (typed throw, own counter). */
  malformedSubmissions: number;
  /** Typed resource-limit refusals at submit (own counter). */
  refusedSubmissions: number;
  claimsGranted: number;
  /** Lease-expiry requeues. */
  requeues: number;
  /** Lease expiries detected (all outcomes). */
  leaseExpiries: number;
  /** Executor invocations reported (recorded + superseded + unknown-job). */
  reportedAttempts: number;
  /** Reports for jobs no longer owned by the reporter (counted, never delivered). */
  lateResults: number;
  /** Reports naming unknown jobs (counted, logged). */
  unknownReports: number;
  heartbeatsReceived: number;
  /** Heartbeats refused (unknown worker, non-monotone, post-end). */
  rejectedHeartbeats: number;
  /** Stale workers that rejoined via a later heartbeat. */
  workerRejoins: number;
  /** Workers that went stale (transitions). */
  staleWorkers: number;
  /** Claims refused (unknown worker). */
  rejectedClaims: number;
  /** Deadline timeouts fired (queued + in-flight + sweep-detected). */
  timeoutsDeadline: number;
  /** Stale-worker failures (fail-loud, timeout classification). */
  timeoutsStale: number;
  /** Retained dead-letter entries (the inspectable window). */
  dlqRetained: number;
  /** Dead letters beyond the retention bound (counted + logged + metered). */
  dlqOverflow: number;
  /** Workers ever registered. */
  workersRegistered: number;
  /** Workers currently active (non-stale). */
  workersActive: number;
}

/** A fresh all-zero stats snapshot (for tests and assertions). */
export function emptyGpuStats(): GpuDispatchStats {
  return {
    jobsSubmitted: 0,
    admitted: 0,
    duplicates: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    deadLettered: 0,
    inFlight: 0,
    queuedJobs: 0,
    executingJobs: 0,
    malformedSubmissions: 0,
    refusedSubmissions: 0,
    claimsGranted: 0,
    requeues: 0,
    leaseExpiries: 0,
    reportedAttempts: 0,
    lateResults: 0,
    unknownReports: 0,
    heartbeatsReceived: 0,
    rejectedHeartbeats: 0,
    workerRejoins: 0,
    staleWorkers: 0,
    rejectedClaims: 0,
    timeoutsDeadline: 0,
    timeoutsStale: 0,
    dlqRetained: 0,
    dlqOverflow: 0,
    workersRegistered: 0,
    workersActive: 0,
  };
}

/**
 * Asserts the whole-dispatcher accounting invariants (throws `RangeError`
 * with the full breakdown on imbalance). Called internally at every settle
 * before the result is returned; exported so tests and operators
 * re-verify any snapshot.
 */
export function assertGpuAccounting(stats: GpuDispatchStats): void {
  if (stats.jobsSubmitted !== stats.admitted + stats.duplicates) {
    throw new RangeError(
      `gpu-worker identity 1 broken: jobsSubmitted ${stats.jobsSubmitted} != ` +
        `admitted ${stats.admitted} + duplicates ${stats.duplicates}`,
    );
  }
  const terminalSum = stats.succeeded + stats.failed + stats.cancelled + stats.deadLettered;
  const accounted = terminalSum + stats.inFlight;
  if (stats.admitted !== accounted) {
    throw new RangeError(
      `gpu-worker identity 2 broken: admitted ${stats.admitted} != succeeded ` +
        `${stats.succeeded} + failed ${stats.failed} + cancelled ${stats.cancelled} + ` +
        `deadLettered ${stats.deadLettered} + inFlight ${stats.inFlight} (accounted: ${accounted})`,
    );
  }
  if (stats.inFlight !== stats.queuedJobs + stats.executingJobs) {
    throw new RangeError(
      `gpu-worker identity 3 broken: inFlight ${stats.inFlight} != queuedJobs ` +
        `${stats.queuedJobs} + executingJobs ${stats.executingJobs}`,
    );
  }
  if (stats.deadLettered !== stats.dlqRetained + stats.dlqOverflow) {
    throw new RangeError(
      `gpu-worker identity 4 broken: deadLettered ${stats.deadLettered} != ` +
        `dlqRetained ${stats.dlqRetained} + dlqOverflow ${stats.dlqOverflow}`,
    );
  }
}

/**
 * Cross-checks the ledger against the stats (the per-job never-silent
 * proof): every record is terminally disposed, the terminal buckets match
 * the stats exactly, and the per-record claim counters sum to
 * `claimsGranted`. Throws `RangeError` naming the breach.
 */
export function assertGpuLedgerConsistency(
  records: readonly GpuJobRecord[],
  stats: GpuDispatchStats,
): void {
  const buckets: Record<GpuTerminalDisposition, number> = {
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    "dead-lettered": 0,
  };
  let claims = 0;
  for (const record of records) {
    if (
      record.state !== "succeeded" &&
      record.state !== "failed" &&
      record.state !== "cancelled" &&
      record.state !== "dead-lettered"
    ) {
      throw new RangeError(
        `gpu-worker ledger breach: job '${record.jobId}' is still '${record.state}' at settle`,
      );
    }
    buckets[record.state] += 1;
    claims += record.claims;
  }
  const bucketPairs: Array<[GpuTerminalDisposition, number]> = [
    ["succeeded", stats.succeeded],
    ["failed", stats.failed],
    ["cancelled", stats.cancelled],
    ["dead-lettered", stats.deadLettered],
  ];
  for (const [disposition, expected] of bucketPairs) {
    if (buckets[disposition] !== expected) {
      throw new RangeError(
        `gpu-worker ledger breach: ${disposition} records ${buckets[disposition]} != ` +
          `stats ${expected}`,
      );
    }
  }
  if (claims !== stats.claimsGranted) {
    throw new RangeError(
      `gpu-worker ledger breach: summed claims ${claims} != claimsGranted ${stats.claimsGranted}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Bounded-resource limits for one dispatcher. */
export interface GpuDispatchLimits {
  /** Maximum jobs waiting in the ready queue (integer >= 1). */
  maxQueuedJobs: number;
  /**
   * Maximum ADMITTED jobs over the dispatcher's lifetime (integer >= 1,
   * the W302 admitted-budget posture). The submit that would exceed it is
   * refused (`GpuResourceLimitError`) and the dispatcher terminates
   * fail-loud with the `resource-limit` class.
   */
  maxAdmittedJobs: number;
  /** Maximum retained dead-letter entries (integer >= 1). */
  maxDlqEntries: number;
}

/** Frozen default limits (the W302 magnitudes). */
export const DEFAULT_GPU_LIMITS: GpuDispatchLimits = Object.freeze({
  maxQueuedJobs: 1_000,
  maxAdmittedJobs: 1_000_000,
  maxDlqEntries: 1_000,
});

/** Observability seams; every field optional. */
export interface GpuObservability {
  /** Structured logger (default: silent no-op — instrumentation is unconditional). */
  logger?: Logger;
  /** Metrics registry (default: private throwaway registry). */
  metrics?: MetricsRegistry;
  /**
   * Correlation context bound onto every log line and carried on every
   * ledger record and result envelope (default: deterministic ids derived
   * from the dispatcher id — the W007 end-to-end posture).
   */
  correlation?: CorrelationContext;
}

/** Options for {@link ./dispatcher!GpuJobDispatcher}. */
export interface GpuDispatcherOptions {
  /** Dispatcher identity (default `"gpu-0"`; names logs, metrics, correlation). */
  dispatcherId?: string;
  /**
   * The injected protocol clock (REQUIRED — this package never reads a
   * wall clock; heartbeat receipt, lease, deadline, backoff and latency
   * timings all read it).
   */
  clock: GpuClock;
  /**
   * Staleness threshold in ms (finite > 0, default 10_000): a worker with
   * no accepted heartbeat for this long is stale — its in-flight jobs fail
   * LOUD with timeout classification, never silently reassigned.
   */
  staleAfterMs?: number;
  /** Lease duration in ms (finite > 0, default 30_000; renewed on heartbeat). */
  leaseMs?: number;
  /**
   * Default claim budget (lease epochs per job, integer >= 1, default 3);
   * a job envelope's `maxAttempts` overrides it.
   */
  defaultMaxAttempts?: number;
  /** Resource bounds (default: {@link DEFAULT_GPU_LIMITS}). */
  limits?: Partial<GpuDispatchLimits>;
  /** Observability seams (default: silent no-ops). */
  observability?: GpuObservability;
}

/** The settled end-of-run result of one dispatcher. */
export interface GpuDispatchResult {
  dispatcherId: string;
  /** `stopped` = orderly shutdown; `failed` = terminal failure (resource-limit). */
  outcome: "stopped" | "failed";
  /** Terminal failure classification (present iff `outcome === "failed"`). */
  terminalFailureClass?: TerminalFailureClass;
  /** Terminal failure detail (present iff `outcome === "failed"`). */
  error?: string;
  /** Final accounting snapshot (all invariants hold). */
  stats: GpuDispatchStats;
  /** Every job's ledger record, in submission order (fresh isolated copies). */
  jobs: GpuJobRecord[];
  /** Retained dead-letter entries in occurrence order. */
  deadLetters: GpuDeadLetterEntry[];
  /** Accounting-balance proof (runtime-asserted before settling). */
  balanced: true;
}

// ---------------------------------------------------------------------------
// Metric vocabulary
// ---------------------------------------------------------------------------

/**
 * Metric names emitted by the gpu-worker boundary (W007 seam),
 * package-prefixed so unlabeled series cannot collide with other stages'
 * series in a shared registry (the W302 precedent).
 */
export const GPU_METRIC_NAMES = {
  jobsSubmitted: "gpu_jobs_submitted_total",
  admitted: "gpu_jobs_admitted_total",
  duplicates: "gpu_duplicate_jobs_total",
  succeeded: "gpu_jobs_succeeded_total",
  failed: "gpu_jobs_failed_total",
  cancelled: "gpu_jobs_cancelled_total",
  deadLettered: "gpu_jobs_dead_lettered_total",
  dlqEntries: "gpu_dlq_entries_total",
  malformed: "gpu_malformed_submissions_total",
  refused: "gpu_refused_submissions_total",
  claims: "gpu_job_claims_total",
  requeues: "gpu_job_requeues_total",
  leaseExpiries: "gpu_lease_expiries_total",
  attempts: "gpu_job_attempts_total",
  lateResults: "gpu_late_results_total",
  heartbeats: "gpu_worker_heartbeats_total",
  rejectedHeartbeats: "gpu_worker_heartbeats_rejected_total",
  staleWorkers: "gpu_stale_workers_total",
  timeouts: "gpu_job_timeouts_total",
  jobLatencyMs: "gpu_job_latency_ms",
  queueWaitMs: "gpu_job_queue_wait_ms",
} as const;
