/**
 * @sporta/gpu-worker — the GPU worker protocol (W303): jobs, heartbeats,
 * results, retries, timeouts, and resource metadata, defined and test-proven
 * with in-process fixtures.
 *
 * A PROTOCOL package, deterministic and vendor-neutral by construction
 * (architecture-lock §9: no GPU provider, model vendor, cloud, or transport
 * is hard-coded): the dispatcher (`GpuJobDispatcher`) and the reference
 * worker (`GpuWorker`) talk over the narrow async `GpuDispatcherPort` seam
 * — in-process fixtures wire them directly; real deployments put a wire
 * behind the port and real GPU work behind the `GpuJobExecutor` seam. No
 * process is spawned, no network is opened, no real timer is read: every
 * timing decision (heartbeat receipt, lease expiry, staleness, deadline,
 * backoff, latency) reads the injected `GpuClock`, and the timer machinery
 * is the timers-first `sweep()` at every port entry — the heartbeat stream
 * IS the monitor in a live system.
 *
 * The never-silent constitution, runtime-asserted at every settle:
 * `jobsSubmitted === succeeded + failed + cancelled + deadLettered +
 * duplicates` (in-flight during a run, 0 at settle) — an imbalance REJECTS
 * shutdown() instead of returning a lying result. Stale workers fail their
 * in-flight jobs LOUD with timeout classification (never silently
 * reassigned); lease expiry requeues within the claim budget and
 * dead-letters at exhaustion; idempotency keys dedupe claims (in flight
 * and terminally disposed alike — exactly-once claim, at-least-once
 * execution, honestly documented); cancellation is idempotent and never
 * loses a job; every attempt, timeout, retry, requeue, supersession, and
 * refusal is counted + logged + metered + ledgered.
 *
 * Module map:
 *
 * - `clock`: the `GpuClock` seam (self-advancing `sleep`, passive
 *   `waitUntil`) + `VirtualGpuClock` (deterministic virtual time — the
 *   runaway rule keeps periodic waits passive);
 * - `job`: the `GpuJobEnvelope` (jobId, idempotency key, kind, payload
 *   descriptor, priority, requirements, deadline, claim budget) +
 *   fail-loud validation;
 * - `types`: capabilities, heartbeats, claims, attempt reports, result
 *   envelopes, ledger records/events, DLQ entries, stats, options, the
 *   metric vocabulary, and the balance assertions;
 * - `errors`: typed boundary errors carrying the contracts
 *   `terminalFailureClass` (`MalformedJobError` `media-invalid`,
 *   `GpuResourceLimitError` `resource-limit`) plus the caller-misuse and
 *   unknown-job errors;
 * - `ledger`: the job ledger (records, frozen event trails, the
 *   idempotency-key and job-id indexes);
 * - `dlq`: the BOUNDED dead-letter queue (overflow counted + logged +
 *   metered, never silent);
 * - `dispatcher`: `GpuJobDispatcher` — the queue, leases, staleness,
 *   deadlines, budgets, cancellation, accounting;
 * - `worker`: `GpuWorker` — the reference agent (heartbeat loop, claim
 *   loop, deadline-aware W104 retry loop, reporting).
 *
 * The protocol contract itself (envelope tables, semantics, decisions,
 * compatibility policy, honest limitations) is PROTOCOL.md in this
 * package — the W302/W504 precedent for package-local protocol types:
 * these types are package-local TypeScript interfaces (no schema
 * dependency added), and promotion into `@sporta/contracts` is a
 * tech-lead-owned change for when W304+ needs cross-package wire
 * stability.
 *
 * Honest limitations (documented in PROTOCOL.md, repeated for the record):
 * resource metadata is ADVISORY (declarations are trusted for admission,
 * never measured); execution is at-least-once across lease recovery
 * (claims are exactly-once, executions are not); unreported attempts of
 * crashed workers are unknowable (never invented); the ledger is
 * in-memory (bounded only by the admitted-job budget); there is no wire
 * protocol or serialization format (the port is an in-process interface —
 * W304+ owns transport); an executor that never settles cannot be killed
 * (abandon-mode stop leaves it running, its eventual report counted);
 * virtual-clock heartbeats fire at advance-crossings (one per crossed
 * deadline — timestamps exact under the stepwise-advance test convention).
 */
export type { GpuClock } from "./clock";
export { VirtualGpuClock } from "./clock";
export type { GpuJobEnvelope, GpuJobRequirements } from "./job";
export { validateJobEnvelope } from "./job";
export type {
  GpuAttemptReport,
  GpuAttemptTiming,
  GpuCancelOutcome,
  GpuDeadLetterEntry,
  GpuDispatchLimits,
  GpuDispatchResult,
  GpuDispatchStats,
  GpuDispatcherOptions,
  GpuDispatcherPort,
  GpuExecutorOutcome,
  GpuHeartbeat,
  GpuHeartbeatAck,
  GpuJobClaim,
  GpuJobEvent,
  GpuJobEventDetails,
  GpuJobEventType,
  GpuJobExecutor,
  GpuJobFailure,
  GpuJobLease,
  GpuJobRecord,
  GpuJobResult,
  GpuJobResultTiming,
  GpuJobState,
  GpuObservability,
  GpuRegistrationAck,
  GpuReportAck,
  GpuSubmitHandle,
  GpuTerminalClass,
  GpuTerminalDisposition,
  GpuWorkerCapabilities,
  GpuWorkerRetryPolicy,
  GpuWorkerStatus,
} from "./types";
export {
  DEFAULT_GPU_LIMITS,
  DEFAULT_WORKER_RETRY,
  GPU_METRIC_NAMES,
  assertGpuAccounting,
  assertGpuLedgerConsistency,
  emptyGpuStats,
} from "./types";
export {
  GpuResourceLimitError,
  InvalidDispatcherStateError,
  MalformedJobError,
  UnknownJobError,
  isGpuWorkerError,
} from "./errors";
export type { GpuWorkerError, GpuWorkerErrorDetails } from "./errors";
export { GpuJobLedger } from "./ledger";
export { GpuDeadLetterQueue } from "./dlq";
export { GpuJobDispatcher, type GpuDispatcherPhase, type SubmitOptions } from "./dispatcher";
export {
  GpuWorker,
  type GpuWorkerOptions,
  type GpuWorkerObservability,
  type GpuWorkerStats,
  type GpuWorkerStopMode,
} from "./worker";
