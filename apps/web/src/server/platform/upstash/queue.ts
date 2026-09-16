/**
 * The bounded job queue (W913).
 *
 * The free-tier rule made mechanical: the queue has a HARD depth bound and
 * admission is FAIL-CLOSED — when the queue is at its bound, `offer` REFUSES
 * the job (Simulation E: new expensive jobs stop admitting BEFORE the
 * provider hard-fails; work is never silently dropped, and a full queue never
 * spills into unbounded memory).
 *
 * Backing: a `RedisLike` list. RPUSH appends to the TAIL; the OLDEST job is
 * at the HEAD — `take()` drains head-first (LRANGE 0..batch-1 + LTRIM), the
 * documented FIFO shape. The in-memory fallback gives the same semantics per
 * process.
 *
 * LIFECYCLE (the hosted compute lane's admission ledger):
 * - `offer` admits a job (bounded, fail-closed) BEFORE the expensive
 *   dispatch runs;
 * - `release` returns the slot when the caller observes the job settled
 *   (the studio's job poll releases on the terminal state);
 * - an ADMISSION LEASE bounds the worst case: a record older than
 *   `admissionLeaseMs` is swept at the next `offer`, so abandoned clients
 *   cannot pin the queue full forever. The lease is deliberately LONGER
 *   than any legitimate render (a slow render is still executing; the
 *   sweep is the leak guard, not the timeout).
 */
import type { RedisLike } from "./redis";

/** A queued job's persisted form (opaque payload; the queue never inspects it). */
export interface QueuedJob {
  jobId: string;
  /** The enqueueing user (null for operator/system jobs). */
  userId: string | null;
  /** Closed job-kind vocabulary owned by the compute lane (W914). */
  kind: string;
  /** JSON-encoded payload (the queue never needs to read it). */
  payloadJson: string;
  enqueuedAtMs: number;
}

/** One queued job plus its live age (the per-job state view for ops/tests). */
export interface QueuedJobView extends QueuedJob {
  ageMs: number;
}

/** The outcome of an admission attempt (never silent). */
export type AdmissionOutcome =
  | { accepted: true; depth: number }
  | { accepted: false; reason: "queue-full"; depth: number; maxDepth: number };

/** Options for {@link BoundedJobQueue}. */
export interface BoundedJobQueueOptions {
  redis: RedisLike;
  /** The queue's Redis key (one queue per key). */
  key: string;
  /** HARD depth bound — admission at/above this depth refuses (fail-closed). */
  maxDepth: number;
  /** How many jobs a single `take` may drain (default 10). */
  takeBatchSize?: number;
  /** Admission lease: records older than this are swept on offer (ms). */
  admissionLeaseMs?: number;
  /** Wall clock (default: real time). */
  nowMs?: () => number;
}

/** The bounded job queue over a `RedisLike` backend. */
export class BoundedJobQueue {
  readonly #redis: RedisLike;
  readonly #key: string;
  readonly #maxDepth: number;
  readonly #takeBatchSize: number;
  readonly #admissionLeaseMs: number;
  readonly #nowMs: () => number;

  constructor(options: BoundedJobQueueOptions) {
    if (!Number.isInteger(options.maxDepth) || options.maxDepth < 1) {
      throw new Error("BoundedJobQueue: maxDepth must be a positive integer");
    }
    this.#redis = options.redis;
    this.#key = options.key;
    this.#maxDepth = options.maxDepth;
    this.#takeBatchSize = options.takeBatchSize ?? 10;
    this.#admissionLeaseMs = options.admissionLeaseMs ?? 900_000;
    this.#nowMs = options.nowMs ?? Date.now;
  }

  /** The queue's configured bound (surfaced in health/errors). */
  get maxDepth(): number {
    return this.#maxDepth;
  }

  /** The queue's configured admission lease (surfaced in health/errors). */
  get admissionLeaseMs(): number {
    return this.#admissionLeaseMs;
  }

  /**
   * Attempts admission. Sweeps expired admission leases first (abandoned
   * jobs return their slots), then REFUSES (fail-closed) when the queue is
   * at its bound.
   */
  async offer(job: Omit<QueuedJob, "enqueuedAtMs">): Promise<AdmissionOutcome> {
    await this.#sweepExpired();
    const depth = await this.#redis.llen(this.#key);
    if (depth >= this.#maxDepth) {
      return { accepted: false, reason: "queue-full", depth, maxDepth: this.#maxDepth };
    }
    const record: QueuedJob = { ...job, enqueuedAtMs: this.#nowMs() };
    const newDepth = await this.#redis.rpush(this.#key, JSON.stringify(record));
    return { accepted: true, depth: newDepth };
  }

  /** Drains up to a batch of jobs (oldest first — the list is RPUSH-fed). */
  async take(): Promise<QueuedJob[]> {
    const batch = await this.#redis.lrange(this.#key, 0, this.#takeBatchSize - 1);
    if (batch.length === 0) return [];
    await this.#redis.ltrim(this.#key, batch.length, -1);
    return batch.map((encoded) => JSON.parse(encoded) as QueuedJob);
  }

  /**
   * Releases one settled job's admission slot (idempotent; `false` when the
   * record is already gone — swept or released).
   */
  async release(jobId: string): Promise<boolean> {
    const records = await this.#redis.lrange(this.#key, 0, -1);
    for (const encoded of records) {
      try {
        const record = JSON.parse(encoded) as QueuedJob;
        if (record.jobId === jobId) {
          const removed = await this.#redis.lrem(this.#key, 1, encoded);
          return removed > 0;
        }
      } catch {
        // An unparseable record is not ours to release; skip it.
      }
    }
    return false;
  }

  /** The per-job state view (ops/tests; oldest first). */
  async snapshot(): Promise<QueuedJobView[]> {
    const now = this.#nowMs();
    const records = await this.#redis.lrange(this.#key, 0, -1);
    const views: QueuedJobView[] = [];
    for (const encoded of records) {
      try {
        const record = JSON.parse(encoded) as QueuedJob;
        views.push({ ...record, ageMs: Math.max(0, now - record.enqueuedAtMs) });
      } catch {
        // Skip unparseable records (never fabricate per-job state).
      }
    }
    return views;
  }

  /** Current depth. */
  async depth(): Promise<number> {
    return this.#redis.llen(this.#key);
  }

  /** Drops admission records whose lease has lapsed (the leak guard). */
  async #sweepExpired(): Promise<void> {
    const cutoff = this.#nowMs() - this.#admissionLeaseMs;
    const records = await this.#redis.lrange(this.#key, 0, -1);
    for (const encoded of records) {
      try {
        const record = JSON.parse(encoded) as QueuedJob;
        if (record.enqueuedAtMs < cutoff) {
          await this.#redis.lrem(this.#key, 1, encoded);
        }
      } catch {
        // An unparseable record cannot be age-checked; keep it (fail-closed
        // means the queue may refuse earlier, never admit past the bound).
      }
    }
  }
}
