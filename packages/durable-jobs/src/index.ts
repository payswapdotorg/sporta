/**
 * @sporta/durable-jobs — the canonical durable Sporta job/worker contract
 * (REL-012, ADR-013 #14, reality-engineering-lab.md §12).
 *
 * The canonical state: `Database -> Job/Run state -> queue/worker leases ->
 * artifacts/evidence`. This slice's database is an append-only JSON-file
 * journal with atomic rename writes (no new native dependencies; the seam
 * maps to a real DB later — REL-029). Module map:
 *
 * - `domain`: the job states
 *   `queued/leased/running/checkpointed/completed/failed/cancelled`, the
 *   lease (owner + expiry), the checkpoints (JSON-safe resume blobs), the
 *   bounded-backoff retry policy + its math, and the full JobRecord — plus
 *   the documented ATTEMPTS LAW (a takeover continues the interrupted
 *   attempt; only a new attempt after a recorded failure increments)
 * - `state-machine`: the 16-edge legal-transition table with typed refusal
 *   reasons
 * - `journal`: the append-only JSON file — events, the atomic-rename
 *   writer (injectable for crash tests), the fail-closed parser, and the
 *   FOLD that rebuilds every record by replaying the journal
 * - `store`: the job store — enqueue, lease acquisition + expiry
 *   takeover, start (the attempts law), checkpoints, resume, complete,
 *   fail (bounded-backoff retryAt), requeueDueRetries, cooperative
 *   cancellation (request + leaseholder honor), and the lease discipline
 *   (a worker whose lease expired can never write again)
 * - `runtime`: the WorkerRuntime — runAttempt (acquire -> start ->
 *   execute with resumable checkpoints -> complete/fail/cancelled), the
 *   cooperative-cancellation signal thrown into executors at the honored
 *   checkpoint, and the retry driver hooks
 * - `harness`: the HarnessPort — status/plan/PROGRESS/cancellation DISPLAY
 *   reads over the reader-only seam (REL-013 extends the v0 port with the
 *   resumable-progress projection); external harnesses (OpenMuse/
 *   CopilotKit/AG-UI) are adapters, never authorities: the port cannot
 *   write job state (type-level: no mutating method exists; runtime: the
 *   surface test proves it and the views are frozen snapshots)
 * - `clock`: the injected clock + id source constitution, plus the
 *   advanceable manual clock the lease/retry tests drive time with
 * - `errors`: the typed error family (lease law, retry exhaustion, store
 *   faults, illegal transitions) + the cancellation control-flow signal
 *
 * THE INVARIANT (binding, tested): long-running state is canonical in
 * Sporta. The restart test drops a worker mid-run and a NEW worker resumes
 * from the checkpoint; the final record deep-equals an uninterrupted run
 * with wall-clock fields stripped. Interrupted writes load last-good
 * (atomic renames). Retries are bounded with growing backoff. Cancellation
 * is cooperative, honored at the next checkpoint. And no external harness
 * can ever write the canonical state.
 */
// domain
export {
  DEFAULT_RETRY_POLICY,
  JOB_STATES,
  LEASED_STATES,
  TERMINAL_JOB_STATES,
  computeBackoffMs,
  isTerminalJobState,
} from "./domain";
export type {
  EnqueueJobInput,
  JobCheckpoint,
  JobFailure,
  JobLease,
  JobRecord,
  JobState,
  LeasedState,
  RetryPolicy,
  TerminalJobState,
} from "./domain";
export { EnqueueJobInputSchema, JobStateSchema, RetryPolicySchema } from "./domain";

// state machine
export {
  JOB_EDGES,
  illegalJobTransitionReason,
  isLegalJobTransition,
  isTerminalState,
  jobEdge,
  legalJobTargetsFrom,
} from "./state-machine";
export type { JobEdge, JobTransitionOperation } from "./state-machine";

// journal
export {
  JOURNAL_FORMAT,
  foldJournal,
  parseJournal,
  readJournalFile,
  serializeJournal,
  writeJournalAtomic,
} from "./journal";
export type {
  JobEnqueuedEvent,
  JobPatchedEvent,
  JobRecordPatch,
  JournalEvent,
  JournalFileEnvelope,
  JournalWriter,
} from "./journal";

// store
export { createFileJobStore } from "./store";
export type { JobStore, JobStoreOptions } from "./store";

// runtime
export { createWorkerRuntime } from "./runtime";
export type {
  JobExecutor,
  JobExecutorContext,
  WorkerRuntime,
  WorkerRuntimeOptions,
} from "./runtime";

// harness
export { createHarnessPort } from "./harness";
export type {
  HarnessPort,
  HarnessPortOptions,
  JobCancellationView,
  JobPlanView,
  JobProgressView,
  JobStatusView,
  JobStoreReader,
} from "./harness";

// clock
export {
  JOBS_DEFAULT_EPOCH_MS,
  createDefaultJobIdSource,
  createJobsDefaultClock,
  createManualClock,
  createSequentialIdSource,
  toIsoUtc,
} from "./clock";
export type { IdSource, ManualClock } from "./clock";

// errors
export {
  JobsApiError,
  JobsCancellationSignal,
  JobsConflictError,
  JobsIllegalTransitionError,
  JobsLeaseError,
  JobsNotFoundError,
  JobsStoreError,
  JobsValidationError,
  isJobsError,
} from "./errors";
export type { JobsError, JobsFailureClass } from "./errors";
