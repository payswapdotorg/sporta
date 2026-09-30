/**
 * The durable job store (REL-012): the canonical `Job/Run state ->
 * queue/worker leases` layers over an append-only JSON-file journal with
 * atomic rename writes.
 *
 * Source of truth: docs/architecture/reality-engineering-lab.md §12: "The
 * canonical state remains: Database -> Job/Run state -> queue/worker
 * leases -> artifacts/evidence. An external harness is a
 * presentation/interaction and orchestration integration, not a
 * persistence authority." The journal file IS this slice's database; the
 * store interface is the port-friendly seam a real DB adapter
 * implements later (REL-029) without changing the discipline.
 *
 * THE LAWS, enforced here:
 * - LEASE DISCIPLINE: every mutating operation on an active job requires a
 *   LIVE lease held by the caller (owner match + unexpired against the
 *   injected clock). A worker whose lease expired is refused, typed — its
 *   writes can never land after a takeover.
 * - TAKEOVER: an expired lease on an active job is claimable by another
 *   worker (requeue-takeover -> queued -> acquire). The takeover CONTINUES
 *   the interrupted attempt (see the attempts law, src/domain.ts).
 * - RETRIES ARE BOUNDED: `fail` schedules `retryAt` only while
 *   attempts < maxAttempts; `requeueDueRetries` requeues only failed jobs
 *   whose retryAt has come due. A terminal failure never requeues.
 * - CANCELLATION IS COOPERATIVE: `requestCancellation` sets the flag (a
 *   queued job cancels immediately); the running worker HONORS it at its
 *   next checkpoint via `cancel` (the leaseholder-only edge).
 * - STATE IS THE FOLD OF THE JOURNAL: every operation appends one event
 *   and persists atomically (temp file + rename). A failed persist
 *   poisons the store (memory may no longer match disk); reload from disk
 *   for the last committed state.
 */
import type { JobRecord, JobState } from "./domain";
import { EnqueueJobInputSchema, computeBackoffMs } from "./domain";
import type { EnqueueJobInput } from "./domain";
import { createDefaultJobIdSource, createJobsDefaultClock } from "./clock";
import type { IdSource } from "./clock";
import {
  JobsConflictError,
  JobsIllegalTransitionError,
  JobsLeaseError,
  JobsNotFoundError,
  JobsStoreError,
  JobsValidationError,
} from "./errors";
import {
  foldJournal,
  parseJournal,
  readJournalFile,
  serializeJournal,
  writeJournalAtomic,
} from "./journal";
import type { JournalEvent, JobRecordPatch, JournalWriter } from "./journal";
import { illegalJobTransitionReason, isLegalJobTransition } from "./state-machine";
import { isTerminalJobState } from "./domain";

// ---------------------------------------------------------------------------
// Options + the store port
// ---------------------------------------------------------------------------

export interface JobStoreOptions {
  /** Injected clock (default: the deterministic jobs clock). */
  readonly clock?: () => number;
  /** Injected job-id source (default: `job-1`, `job-2`, ...). */
  readonly idSource?: IdSource;
  /**
   * The journal writer (default: temp file + atomic rename). INJECTABLE so
   * tests simulate interrupted writes (write the temp, die before the
   * rename) and verify the last-good reload.
   */
  readonly writer?: JournalWriter;
}

export interface JobStore {
  /** Enqueues a job (state `queued`). Duplicate jobIds refuse typed. */
  enqueue(input: EnqueueJobInput): Promise<JobRecord>;
  /** Looks a record up (typed not-found). */
  get(jobId: string): Promise<JobRecord>;
  /** Lists records, optionally filtered by state and/or kind. */
  list(filter?: {
    readonly state?: JobState;
    readonly kind?: string;
  }): Promise<readonly JobRecord[]>;
  /**
   * Acquires the lease on a queued job — or TAKES OVER an active job whose
   * lease expired (requeue-takeover -> queued -> acquire). A live lease
   * held by anyone (including the caller) refuses typed `jobs.lease-held`.
   */
  acquireLease(jobId: string, workerId: string, ttlMs: number): Promise<JobRecord>;
  /**
   * Starts execution (leased -> running). Applies the attempts law: a new
   * attempt after a recorded failure increments `attempts`; a takeover
   * continuation does not.
   */
  start(jobId: string, workerId: string): Promise<JobRecord>;
  /**
   * Records a durable checkpoint (running -> checkpointed). Requires a
   * live lease held by the caller. Returns the updated record (the runtime
   * observes `cancellationRequested` here).
   */
  recordCheckpoint(jobId: string, workerId: string, checkpointState: unknown): Promise<JobRecord>;
  /** Continues execution from the last checkpoint (checkpointed -> running). */
  continueFromCheckpoint(jobId: string, workerId: string): Promise<JobRecord>;
  /** Completes the job (running|checkpointed -> completed), recording output artifact refs. */
  complete(
    jobId: string,
    workerId: string,
    outputArtifactRefs?: readonly string[],
  ): Promise<JobRecord>;
  /**
   * Fails the current attempt (running|checkpointed -> failed). Schedules
   * `retryAt` per the bounded-backoff policy while attempts < maxAttempts;
   * otherwise the failure is terminal (retryAt null).
   */
  fail(jobId: string, workerId: string, message: string): Promise<JobRecord>;
  /** Requeues failed jobs whose retryAt has come due (the retry driver calls this). */
  requeueDueRetries(): Promise<readonly JobRecord[]>;
  /**
   * Requests cooperative cancellation. A queued job cancels immediately;
   * an active or failed job gets the flag (the running worker honors it at
   * its next checkpoint; a failed job's retry, if it requeues, is cancelled
   * the same way). An edge-terminal record (completed/cancelled) refuses
   * typed.
   */
  requestCancellation(jobId: string): Promise<JobRecord>;
  /** The leaseholder-only cooperative honor (leased|running|checkpointed -> cancelled). */
  cancel(jobId: string, workerId: string): Promise<JobRecord>;
  /** Reads the journal (the evidence trail; the append-only audit view). */
  readJournal(): Promise<readonly JournalEvent[]>;
}

/** Creates the file-backed job store. */
export function createFileJobStore(path: string, options: JobStoreOptions = {}): JobStore {
  const clock = options.clock ?? createJobsDefaultClock();
  const idSource = options.idSource ?? createDefaultJobIdSource();
  const writer = options.writer ?? writeJournalAtomic;

  // The durable state: the event journal (the file is the source of truth;
  // the records map is its fold).
  let events: readonly JournalEvent[] = [];
  let records = new Map<string, JobRecord>();
  let poisoned = false;

  // -- initial load (the fold) ----------------------------------------------
  const initial = readJournalFile(path);
  if (initial !== null) {
    const envelope = parseJournal(initial);
    const folded = foldJournal(envelope.events);
    events = envelope.events;
    records = new Map([...folded.entries()].map(([id, record]) => [id, deepFreeze(record)]));
  }

  // -- helpers --------------------------------------------------------------

  function ensureHealthy(): void {
    if (poisoned) {
      throw new JobsStoreError(
        "jobs.store-poisoned",
        "this store failed to persist an earlier operation (memory may no longer match disk); reload a fresh store from the journal for the last committed state",
        { path },
      );
    }
  }

  function mustGet(jobId: string): JobRecord {
    const record = records.get(jobId);
    if (record === undefined) {
      throw new JobsNotFoundError(`no job with id ${jobId}`, { jobId });
    }
    return record;
  }

  /** Requires a LIVE lease held by workerId (the lease discipline). */
  function requireLiveLease(record: JobRecord, workerId: string): void {
    const now = clock();
    if (record.lease === null || record.lease.owner !== workerId) {
      throw new JobsLeaseError(
        "jobs.lease-not-held",
        `job ${record.jobId} is not leased by ${workerId} (mutating an active job requires holding its lease)`,
        { jobId: record.jobId, workerId },
      );
    }
    if (record.lease.expiresAt <= now) {
      throw new JobsLeaseError(
        "jobs.lease-expired",
        `the lease on job ${record.jobId} held by ${workerId} expired at ${record.lease.expiresAt} (now ${now}); the job is claimable by takeover and the previous owner's writes are refused`,
        { jobId: record.jobId, workerId, expiresAt: record.lease.expiresAt, now },
      );
    }
  }

  /** Refuses an illegal from -> to transition with the machine reason. */
  function requireTransition(record: JobRecord, to: JobState): void {
    if (!isLegalJobTransition(record.state, to)) {
      const reason = illegalJobTransitionReason(record.state, to);
      throw new JobsIllegalTransitionError(
        `refusing ${record.state} -> ${to} for job ${record.jobId}: ${reason}`,
        { from: record.state, to, reason: reason ?? "unknown" },
      );
    }
  }

  /**
   * THE commit: applies the patch in memory, appends ONE journal event,
   * persists the whole document atomically. A persist failure poisons the
   * store and leaves both the events and the records untouched (the
   * in-memory state stays at the last committed state).
   */
  function commit(jobId: string, op: string, patch: JobRecordPatch): JobRecord {
    ensureHealthy();
    const current = mustGet(jobId);
    const next: JobRecord = deepFreeze({ ...current, ...patch });
    const event: JournalEvent = {
      seq: events.length + 1,
      at: clock(),
      type: "patched",
      jobId,
      op,
      patch,
    };
    const nextEvents = [...events, event];
    try {
      writer(path, serializeJournal(nextEvents));
    } catch (error) {
      poisoned = true;
      throw new JobsStoreError(
        "jobs.store-write-failed",
        `failed to persist the journal for job ${jobId} operation ${op} (the store is now poisoned; the file holds the last committed state)`,
        { path, op, jobId, cause: String(error) },
      );
    }
    events = nextEvents;
    records.set(jobId, next);
    return next;
  }

  /** JSON-safety: what is on disk is exactly what is replayed. */
  function jsonSafe(value: unknown, what: string): unknown {
    const text = JSON.stringify(value);
    if (text === undefined) {
      throw new JobsValidationError(`${what} must be JSON-safe (a bare undefined cannot persist)`, [
        value,
      ]);
    }
    return JSON.parse(text);
  }

  // -- the store ------------------------------------------------------------

  return {
    async enqueue(input) {
      ensureHealthy();
      const parsed = EnqueueJobInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new JobsValidationError(
          "the enqueue input violates the job contract shape",
          parsed.error.issues,
        );
      }
      const clean = parsed.data;
      const jobId = clean.jobId ?? idSource.nextId();
      if (records.has(jobId)) {
        throw new JobsConflictError(`job ${jobId} already exists (job ids are unique)`, { jobId });
      }
      const now = clock();
      const record: JobRecord = deepFreeze({
        jobId,
        kind: clean.kind,
        input: jsonSafe(clean.input, "the job input"),
        inputArtifactRefs: [...clean.inputArtifactRefs],
        state: "queued",
        lease: null,
        checkpoints: [],
        attempts: 0,
        retryPolicy: { ...clean.retryPolicy },
        cancellationRequested: false,
        failure: null,
        retryAt: null,
        outputArtifactRefs: [],
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      });
      const event: JournalEvent = { seq: events.length + 1, at: now, type: "enqueued", record };
      const nextEvents = [...events, event];
      try {
        writer(path, serializeJournal(nextEvents));
      } catch (error) {
        poisoned = true;
        throw new JobsStoreError(
          "jobs.store-write-failed",
          `failed to persist the journal for the enqueue of ${jobId}`,
          { path, jobId, cause: String(error) },
        );
      }
      events = nextEvents;
      records.set(jobId, record);
      return record;
    },

    async get(jobId) {
      ensureHealthy();
      return mustGet(jobId);
    },

    async list(filter) {
      ensureHealthy();
      return [...records.values()]
        .filter((record) => {
          if (filter?.state !== undefined && record.state !== filter.state) return false;
          if (filter?.kind !== undefined && record.kind !== filter.kind) return false;
          return true;
        })
        .sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0));
    },

    async acquireLease(jobId, workerId, ttlMs) {
      ensureHealthy();
      if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
        throw new JobsValidationError("the lease ttl must be a positive integer of ms", [ttlMs]);
      }
      const record = mustGet(jobId);
      const now = clock();
      if (record.state === "queued") {
        return commit(jobId, "acquire", {
          state: "leased",
          lease: { owner: workerId, acquiredAt: now, expiresAt: now + ttlMs },
          updatedAt: now,
        });
      }
      if (
        record.state === "leased" ||
        record.state === "running" ||
        record.state === "checkpointed"
      ) {
        if (record.lease !== null && record.lease.expiresAt > now) {
          if (record.lease.owner === workerId) {
            // Idempotent: this worker already holds the live lease.
            return record;
          }
          throw new JobsLeaseError(
            "jobs.lease-held",
            `job ${jobId} holds a live lease (owner ${record.lease.owner}, expires ${record.lease.expiresAt}); takeover is refused until it expires`,
            { jobId, owner: record.lease.owner, expiresAt: record.lease.expiresAt, now },
          );
        }
        // Takeover: the interrupted attempt continues (attempts unchanged).
        commit(jobId, "requeue-takeover", { state: "queued", lease: null, updatedAt: now });
        return commit(jobId, "acquire", {
          state: "leased",
          lease: { owner: workerId, acquiredAt: now, expiresAt: now + ttlMs },
          updatedAt: now,
        });
      }
      // failed / completed / cancelled: refused typed. A failed job requeues
      // only through its bounded retry; terminal records are frozen.
      const reason =
        record.state === "failed"
          ? "failed jobs requeue only through requeueDueRetries (the bounded retry)"
          : (illegalJobTransitionReason(record.state, "queued") ?? "terminal");
      throw new JobsIllegalTransitionError(
        `refusing to acquire job ${jobId} in state ${record.state}: ${reason}`,
        { from: record.state, to: "leased", reason },
      );
    },

    async start(jobId, workerId) {
      ensureHealthy();
      const record = mustGet(jobId);
      requireLiveLease(record, workerId);
      requireTransition(record, "running");
      const now = clock();
      // The attempts law: a new attempt after a recorded failure increments;
      // a takeover continuation (no failure on record) does not.
      const attempts = record.failure !== null ? record.attempts + 1 : Math.max(record.attempts, 1);
      return commit(jobId, "start", {
        state: "running",
        attempts,
        failure: null,
        updatedAt: now,
      });
    },

    async recordCheckpoint(jobId, workerId, checkpointState) {
      ensureHealthy();
      const record = mustGet(jobId);
      requireLiveLease(record, workerId);
      requireTransition(record, "checkpointed");
      const now = clock();
      const last = record.checkpoints[record.checkpoints.length - 1];
      const seq = (last?.seq ?? 0) + 1;
      return commit(jobId, "checkpoint", {
        state: "checkpointed",
        checkpoints: [
          ...record.checkpoints,
          { seq, at: now, state: jsonSafe(checkpointState, "the checkpoint state") },
        ],
        updatedAt: now,
      });
    },

    async continueFromCheckpoint(jobId, workerId) {
      ensureHealthy();
      const record = mustGet(jobId);
      requireLiveLease(record, workerId);
      requireTransition(record, "running");
      return commit(jobId, "resume", { state: "running", updatedAt: clock() });
    },

    async complete(jobId, workerId, outputArtifactRefs = []) {
      ensureHealthy();
      const record = mustGet(jobId);
      requireLiveLease(record, workerId);
      requireTransition(record, "completed");
      const now = clock();
      return commit(jobId, "complete", {
        state: "completed",
        lease: null,
        outputArtifactRefs: [...outputArtifactRefs],
        completedAt: now,
        updatedAt: now,
      });
    },

    async fail(jobId, workerId, message) {
      ensureHealthy();
      const record = mustGet(jobId);
      requireLiveLease(record, workerId);
      requireTransition(record, "failed");
      const now = clock();
      const canRetry = record.attempts < record.retryPolicy.maxAttempts;
      return commit(jobId, "fail", {
        state: "failed",
        lease: null,
        failure: { message, at: now, attempt: record.attempts },
        retryAt: canRetry ? now + computeBackoffMs(record.retryPolicy, record.attempts) : null,
        completedAt: now,
        updatedAt: now,
      });
    },

    async requeueDueRetries() {
      ensureHealthy();
      const now = clock();
      const requeued: JobRecord[] = [];
      for (const record of records.values()) {
        if (record.state !== "failed" || record.retryAt === null || record.retryAt > now) continue;
        requireTransition(record, "queued");
        requeued.push(
          commit(record.jobId, "retry", { state: "queued", retryAt: null, updatedAt: now }),
        );
      }
      return requeued;
    },

    async requestCancellation(jobId) {
      ensureHealthy();
      const record = mustGet(jobId);
      if (isTerminalJobState(record.state)) {
        const reason = illegalJobTransitionReason(record.state, "cancelled");
        throw new JobsIllegalTransitionError(
          `refusing ${record.state} -> cancelled for job ${jobId}: ${reason}`,
          { from: record.state, to: "cancelled", reason: reason ?? "unknown" },
        );
      }
      const now = clock();
      if (record.state === "queued") {
        return commit(jobId, "cancel", {
          state: "cancelled",
          lease: null,
          completedAt: now,
          updatedAt: now,
        });
      }
      return commit(jobId, "cancel-requested", { cancellationRequested: true, updatedAt: now });
    },

    async cancel(jobId, workerId) {
      ensureHealthy();
      const record = mustGet(jobId);
      requireLiveLease(record, workerId);
      requireTransition(record, "cancelled");
      const now = clock();
      return commit(jobId, "cancel", {
        state: "cancelled",
        lease: null,
        completedAt: now,
        updatedAt: now,
      });
    },

    async readJournal() {
      ensureHealthy();
      return [...events];
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Deep freeze (the repo precedent): records handed out are immutable —
 * arrays, nested objects, the whole tree.
 */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}
