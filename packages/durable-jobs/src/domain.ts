/**
 * The durable-jobs domain model (REL-012, ADR-013 #14 + reality-engineering-
 * lab.md §12 Long-running execution).
 *
 * Source of truth:
 * - docs/architecture/reality-engineering-lab.md §12: "Long tasks run
 *   through durable Sporta jobs/workers. An optional external harness
 *   adapter may provide an interactive plan/thread UI. The canonical state
 *   remains: Database -> Job/Run state -> queue/worker leases ->
 *   artifacts/evidence. An external harness is a presentation/interaction
 *   and orchestration integration, not a persistence authority."
 * - ADR-013 #14: "Their internal state is never the canonical Sporta job
 *   state."
 *
 * THE INVARIANT (binding, tested): long-running state is canonical in
 * Sporta — external harnesses (OpenMuse/CopilotKit/AG-UI) are ADAPTERS,
 * never authorities. The `HarnessPort` (src/harness.ts) READS job state
 * and cannot write it, enforced at the type level (the port is built over
 * the reader-only `JobStoreReader` interface and exposes no mutating
 * method) and at runtime (a dedicated surface test).
 *
 * The attempts law (documented precisely, tested): `attempts` is the
 * current execution attempt number, 1-based. A lease TAKEOVER after a
 * worker crash CONTINUES the interrupted attempt (attempts is unchanged)
 * because the attempt was interrupted, not failed; only a NEW attempt
 * started after a recorded failure increments the count. The retry budget
 * (`retryPolicy.maxAttempts`) therefore bounds FAILURES, not crashes — and
 * the restart test's deep-equality (interrupted vs uninterrupted final
 * records, wall-clock fields stripped) depends on exactly this law.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Job states (the frozen vocabulary)
// ---------------------------------------------------------------------------

/**
 * The job state machine:
 *
 * ```
 * queued -> leased -> running <-> checkpointed -> completed
 *                        |                |
 *                        v                v
 *                      failed <-------- (fail)
 *                        |
 *                     (retry, policy-bounded)
 *                        v
 *                      queued
 *   any active state --(cancel)--> cancelled
 *   active state + EXPIRED lease --(requeue-takeover)--> queued
 * ```
 *
 * `completed`, `failed` (with retryAt null) and `cancelled` are terminal.
 */
export const JOB_STATES = [
  "queued",
  "leased",
  "running",
  "checkpointed",
  "completed",
  "failed",
  "cancelled",
] as const;

export type JobState = (typeof JOB_STATES)[number];

/** Zod schema for {@link JobState}. */
export const JobStateSchema = z.enum(JOB_STATES);

/**
 * The edge-table terminal states — no outgoing legal edge of any kind.
 * (`failed` is NOT terminal: the retry edge exists; a failed job whose
 * budget is exhausted is POLICY-terminal, recorded by `retryAt: null`.)
 */
export const TERMINAL_JOB_STATES = ["completed", "cancelled"] as const;

export type TerminalJobState = (typeof TERMINAL_JOB_STATES)[number];

/** Type guard: is this state terminal? */
export function isTerminalJobState(state: JobState): boolean {
  return (TERMINAL_JOB_STATES as readonly string[]).includes(state);
}

/** The states in which a worker holds (or may hold) a lease. */
export const LEASED_STATES = ["leased", "running", "checkpointed"] as const;

export type LeasedState = (typeof LEASED_STATES)[number];

// ---------------------------------------------------------------------------
// The lease (queue/worker leases — the §12 layer)
// ---------------------------------------------------------------------------

/**
 * A worker's lease on a job. `expiresAt` is the takeover boundary: after it
 * passes (measured on the injected clock), another worker may take the
 * job over, and the previous owner's writes are refused (typed, fail
 * closed).
 */
export interface JobLease {
  readonly owner: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
}

// ---------------------------------------------------------------------------
// Checkpoints (resumable execution evidence)
// ---------------------------------------------------------------------------

/**
 * A durable checkpoint: the resume blob is JSON-safe (the store round-trips
 * it before persisting so what is on disk is exactly what is replayed) and
 * `seq` is 1-based monotonic per job.
 */
export interface JobCheckpoint {
  readonly seq: number;
  readonly at: number;
  readonly state: unknown;
}

// ---------------------------------------------------------------------------
// Failure + retry policy (bounded backoff)
// ---------------------------------------------------------------------------

/** The last recorded failure (the journal preserves the full history). */
export interface JobFailure {
  readonly message: string;
  readonly at: number;
  readonly attempt: number;
}

/** The bounded-backoff retry policy. */
export const RetryPolicySchema = z
  .object({
    /** Maximum number of execution attempts total (1 = no retries). */
    maxAttempts: z.number().int().min(1),
    /** Backoff after the first failure, in ms. */
    initialBackoffMs: z.number().int().min(0),
    /** Exponential growth factor per subsequent failure (>= 1). */
    backoffFactor: z.number().min(1),
    /** The backoff ceiling, in ms. */
    maxBackoffMs: z.number().int().min(0),
  })
  .refine((policy) => policy.maxBackoffMs >= policy.initialBackoffMs, {
    message: "maxBackoffMs must be >= initialBackoffMs (the ceiling cannot undercut the floor)",
  });

export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

/** The repo default: 3 attempts, exponential 1s -> 2s, capped at 30s. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialBackoffMs: 1_000,
  backoffFactor: 2,
  maxBackoffMs: 30_000,
};

/**
 * The backoff after attempt {@link attempt} fails:
 * `initialBackoffMs * backoffFactor^(attempt-1)`, capped at `maxBackoffMs`.
 */
export function computeBackoffMs(policy: RetryPolicy, attempt: number): number {
  const growth = Math.max(0, attempt - 1);
  const raw = policy.initialBackoffMs * Math.pow(policy.backoffFactor, growth);
  return Math.min(Math.round(raw), policy.maxBackoffMs);
}

// ---------------------------------------------------------------------------
// The job record
// ---------------------------------------------------------------------------

/** The enqueue input at the store boundary. */
export const EnqueueJobInputSchema = z.object({
  /** Caller-chosen id, or the store mints one (`job-1`, `job-2`, ...). */
  jobId: z.string().min(1).optional(),
  /** The job kind — selects the executor at runtime. */
  kind: z.string().min(1),
  /** The JSON-safe job input (round-tripped on persist, see the store). */
  input: z.unknown(),
  /** References to input artifacts (the artifact store owns the bytes). */
  inputArtifactRefs: z.array(z.string().min(1)).default([]),
  /** The bounded-backoff retry policy (default: the repo policy). */
  retryPolicy: RetryPolicySchema.default(DEFAULT_RETRY_POLICY),
});

/** The enqueue input at the store boundary (the INPUT side: defaulted fields optional). */
export type EnqueueJobInput = z.input<typeof EnqueueJobInputSchema>;

/**
 * The canonical job record — the "Job/Run state" layer of §12. The record
 * is the durable truth: state, lease, checkpoints, attempts, retry policy,
 * cancellation flag, failure, output artifact references. Records handed
 * out are deeply frozen; updates are copy-on-write through the journal.
 */
export interface JobRecord {
  readonly jobId: string;
  readonly kind: string;
  readonly input: unknown;
  readonly inputArtifactRefs: readonly string[];
  readonly state: JobState;
  readonly lease: JobLease | null;
  readonly checkpoints: readonly JobCheckpoint[];
  /** The current execution attempt number (see the attempts law above). */
  readonly attempts: number;
  readonly retryPolicy: RetryPolicy;
  readonly cancellationRequested: boolean;
  readonly failure: JobFailure | null;
  /** When a failed job may be requeued (null = no retry scheduled). */
  readonly retryAt: number | null;
  readonly outputArtifactRefs: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
}
