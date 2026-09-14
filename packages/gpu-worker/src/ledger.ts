/**
 * The job ledger (W303) — the never-silent record behind duplicate
 * counting, claim budgeting, and the settle-time consistency proof.
 *
 * One {@link GpuJobLedger} per dispatcher. It owns:
 *
 * - the JOB records (submission order), each with its frozen decision
 *   event trail (`submitted`, `claimed`, `lease-expired`, `requeued`,
 *   `worker-stale`, `deadline-timeout`, `cancelled`, `superseded-report`,
 *   `succeeded`, `failed`, `dead-lettered` — every disposition decision
 *   leaves exactly one event, timestamped on the dispatcher's clock);
 * - the IDEMPOTENCY-KEY index: a known key is never double-claimed —
 *   while its job is in flight, a re-submission counts a duplicate and is
 *   skipped; after a terminal disposition the same (exactly-once claim;
 *   lease recovery re-acquires, at-least-once execution — the honest
 *   semantics documented in PROTOCOL.md §4);
 * - the JOB-ID index: a caller-authored `jobId` must be unique among
 *   admitted jobs (a collision refuses loudly at submit).
 *
 * ISOLATION (architecture-lock §13 — worker output is untrusted): the
 * ledger never hands out a live internal reference. `open()` stores a
 * fully-isolated copy of the submitted envelope; `envelopeOf()` returns a
 * FRESH copy per call (claim grants and DLQ entries each get their own — a
 * worker that mutates its `claim.job` cannot contaminate the ledger, a
 * later claim of the same job, or a dead-letter entry); `records()` returns
 * fresh copies whose `events` arrays, `lease`, and `requirements` are
 * copy-isolated (an observer cannot append to or mutate a live trail). All
 * copies are VALUE-IDENTICAL to the ledger's state — pinned deep-equal by
 * the test suite; only aliasing is severed.
 *
 * Honest limitation (the W302 `processedKeys` posture): the ledger is
 * in-memory and unbounded by anything but the dispatcher's admitted-job
 * budget — a real deployment persists/compacts it behind a storage seam.
 */
import type { GpuClock } from "./clock";
import type { GpuJobEnvelope } from "./job";
import type { GpuJobEvent, GpuJobEventType, GpuJobRecord, GpuJobState } from "./types";

/** Ledger-open parameters (the submit boundary supplies them). */
export interface LedgerOpenParams {
  sequence: number;
  submittedAtMs: number;
  deadlineAtMs: number;
  maxAttempts: number;
  correlationId: string;
  traceId: string;
}

/**
 * Maps job ids and idempotency keys to job records; appends frozen events;
 * exposes the submission-ordered record list for observation and the
 * settle-time consistency walk.
 */
export class GpuJobLedger {
  private readonly byJobId = new Map<string, GpuJobRecord>();
  private readonly byKey = new Map<string, GpuJobRecord>();
  private readonly envelopes = new Map<string, GpuJobEnvelope>();
  private readonly order: GpuJobRecord[] = [];
  private readonly clock: GpuClock;

  constructor(clock: GpuClock) {
    this.clock = clock;
  }

  /** The admitted job's envelope as a FRESH copy (value-identical, alias-severed). */
  envelopeOf(jobId: string): GpuJobEnvelope | undefined {
    const job = this.envelopes.get(jobId);
    if (job === undefined) return undefined;
    return copyEnvelope(job);
  }

  /** `true` when a job with this job id is already admitted. */
  hasJobId(jobId: string): boolean {
    return this.byJobId.has(jobId);
  }

  /** The record a known idempotency key maps to, if any. */
  keyRecord(idempotencyKey: string): GpuJobRecord | undefined {
    return this.byKey.get(idempotencyKey);
  }

  /** The record for a job id, if any. */
  jobRecord(jobId: string): GpuJobRecord | undefined {
    return this.byJobId.get(jobId);
  }

  /** Opens a new job record (first event: `submitted`). */
  open(job: GpuJobEnvelope, params: LedgerOpenParams): GpuJobRecord {
    const record: GpuJobRecord = {
      jobId: job.jobId,
      idempotencyKey: job.idempotencyKey,
      kind: job.kind,
      priority: job.priority,
      ...(job.requirements === undefined ? {} : { requirements: { ...job.requirements } }),
      sequence: params.sequence,
      submittedAtMs: params.submittedAtMs,
      deadlineAtMs: params.deadlineAtMs,
      maxAttempts: params.maxAttempts,
      state: "queued",
      claims: 0,
      attempts: 0,
      reportedExecutionMs: 0,
      events: [],
      correlationId: params.correlationId,
      traceId: params.traceId,
    };
    this.byJobId.set(record.jobId, record);
    this.byKey.set(record.idempotencyKey, record);
    this.envelopes.set(record.jobId, copyEnvelope(job));
    this.order.push(record);
    this.append(record, "submitted", {
      priority: record.priority,
      deadlineMs: job.deadlineMs,
      maxAttempts: record.maxAttempts,
      ...(job.requirements === undefined ? {} : { requirements: job.requirements }),
    });
    return record;
  }

  /**
   * Appends one frozen decision event (timestamped on the dispatcher's
   * injected clock). Every disposition decision goes through here — the
   * trail is the never-silent proof.
   */
  append(record: GpuJobRecord, type: GpuJobEventType, details: Record<string, unknown>): void {
    const event: GpuJobEvent = Object.freeze({
      type,
      atMs: this.clock.now(),
      details: Object.freeze({ ...details }),
    });
    record.events.push(event);
  }

  /**
   * Marks a record's state. Only the dispatcher's disposition paths call
   * this; the state is the ledger's single source of truth for the
   * identity buckets.
   */
  setState(record: GpuJobRecord, state: GpuJobState): void {
    record.state = state;
  }

  /**
   * All records in submission order — fresh copies with `events`, `lease`,
   * and `requirements` isolated (the internal trail is never handed out;
   * the frozen event objects themselves are shared, immutably).
   */
  records(): GpuJobRecord[] {
    return this.order.map((record) => ({
      ...record,
      ...(record.requirements === undefined ? {} : { requirements: { ...record.requirements } }),
      ...(record.lease === undefined ? {} : { lease: { ...record.lease } }),
      events: [...record.events],
    }));
  }

  /** Live record list reference (dispatcher-internal iteration only). */
  liveRecords(): readonly GpuJobRecord[] {
    return this.order;
  }
}

/**
 * A fully-isolated copy of one job envelope (flat fields + one flat optional
 * requirements object — the envelope has no deeper nesting). The submitted
 * object is never aliased into ledger storage, and stored envelopes are
 * never aliased out (lock §13: worker-side mutations stay worker-side).
 */
function copyEnvelope(job: GpuJobEnvelope): GpuJobEnvelope {
  return {
    jobId: job.jobId,
    idempotencyKey: job.idempotencyKey,
    kind: job.kind,
    payloadRef: job.payloadRef,
    priority: job.priority,
    deadlineMs: job.deadlineMs,
    ...(job.requirements === undefined ? {} : { requirements: { ...job.requirements } }),
    ...(job.maxAttempts === undefined ? {} : { maxAttempts: job.maxAttempts }),
  };
}
