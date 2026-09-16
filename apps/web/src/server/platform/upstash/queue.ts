/**
 * The bounded job queue (W913).
 *
 * The free-tier rule made mechanical: the queue has a HARD depth bound and
 * admission is FAIL-CLOSED — when the queue is at its bound, `offer` REFUSES
 * the job (the caller surfaces a degraded state; work is never silently
 * dropped, and a full queue never spills into unbounded memory).
 *
 * Backing: a `RedisLike` list (LPUSH for enqueue, LRANGE+LTRIM for a bounded
 * drain). The in-memory fallback gives the same semantics per process.
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
  /** Wall clock (default: real time). */
  nowMs?: () => number;
}

/** The bounded job queue over a `RedisLike` backend. */
export class BoundedJobQueue {
  readonly #redis: RedisLike;
  readonly #key: string;
  readonly #maxDepth: number;
  readonly #takeBatchSize: number;
  readonly #nowMs: () => number;

  constructor(options: BoundedJobQueueOptions) {
    if (!Number.isInteger(options.maxDepth) || options.maxDepth < 1) {
      throw new Error("BoundedJobQueue: maxDepth must be a positive integer");
    }
    this.#redis = options.redis;
    this.#key = options.key;
    this.#maxDepth = options.maxDepth;
    this.#takeBatchSize = options.takeBatchSize ?? 10;
    this.#nowMs = options.nowMs ?? Date.now;
  }

  /** Attempts admission. Refuses (fail-closed) when the queue is at its bound. */
  async offer(job: Omit<QueuedJob, "enqueuedAtMs">): Promise<AdmissionOutcome> {
    const depth = await this.#redis.llen(this.#key);
    if (depth >= this.#maxDepth) {
      return { accepted: false, reason: "queue-full", depth, maxDepth: this.#maxDepth };
    }
    const record: QueuedJob = { ...job, enqueuedAtMs: this.#nowMs() };
    const newDepth = await this.#redis.lpush(this.#key, JSON.stringify(record));
    return { accepted: true, depth: newDepth };
  }

  /** Drains up to a batch of jobs (oldest first — the list is LPUSH-fed). */
  async take(): Promise<QueuedJob[]> {
    const batch = await this.#redis.lrange(this.#key, -this.#takeBatchSize, -1);
    if (batch.length === 0) return [];
    await this.#redis.ltrim(this.#key, 0, -batch.length - 1);
    return batch.map((encoded) => JSON.parse(encoded) as QueuedJob);
  }

  /** Current depth. */
  async depth(): Promise<number> {
    return this.#redis.llen(this.#key);
  }
}
