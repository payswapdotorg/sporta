/**
 * The harness port (REL-012 + REL-013) — THE INVARIANT: long-running state
 * is canonical in Sporta; external harnesses (OpenMuse/CopilotKit/AG-UI)
 * are ADAPTERS, never authorities.
 *
 * Source of truth: ADR-013 #14 ("Their internal state is never the
 * canonical Sporta job state") and reality-engineering-lab.md §12 ("An
 * external harness is a presentation/interaction and orchestration
 * integration, not a persistence authority").
 *
 * REL-013 extends the v0 bare port into a WORKING port with a
 * RESUMABLE-PROGRESS PROJECTION (`progress`): the durable checkpoint
 * timeline, the progress cursor (the resume point), whether execution may
 * resume (active, or failed with a policy-bounded retry scheduled), and
 * whether the current lease has expired (takeover eligible) — the display
 * an OpenMuse/CopilotKit/AG-UI thread renders for a long job. Reconnect
 * semantics (Gate REL-A8): the port is STATELESS — a session drop + a NEW
 * port (or a whole new store folded from the same journal) sees exactly
 * the canonical state; no duplicate completion, no lost lineage.
 *
 * The port exposes STATUS, PLAN, PROGRESS and CANCELLATION DISPLAY — reads
 * only. Enforcement, three times:
 * - TYPE LEVEL: `HarnessPort`'s surface is four read methods; the factory
 *   takes the NARROW `JobStoreReader` (get + list), so the port's closure
 *   structurally cannot mutate — there is no mutating method to call.
 * - RUNTIME: a dedicated test enumerates the port's surface and asserts no
 *   mutating method exists (requestCancellation/cancel/complete/fail/
 *   enqueue/acquire are all absent), and that the views are frozen
 *   snapshots — mutating a view cannot touch the store.
 * - CLOCK DISCIPLINE: the lease-expiry DISPLAY reads the injected clock
 *   (default: the deterministic jobs clock) — never wall time.
 *
 * Cancellation REQUESTS (when a harness user clicks "cancel") flow through
 * the Sporta application service (the harness adapter wires the button to
 * `requestCancellation` over the application API) — never through this
 * port. The port only DISPLAYS the cancellation state.
 */
import type { JobRecord, JobState } from "./domain";
import { createJobsDefaultClock } from "./clock";

/**
 * The reader seam the port is built over: get + list, nothing else. The
 * full `JobStore` structurally satisfies it; a test also constructs a port
 * over a reader that HAS no mutating methods, proving the port cannot be
 * writing through them.
 */
export interface JobStoreReader {
  get(jobId: string): Promise<JobRecord>;
  list(filter?: {
    readonly state?: JobState;
    readonly kind?: string;
  }): Promise<readonly JobRecord[]>;
}

/** The status view a harness displays. */
export interface JobStatusView {
  readonly jobId: string;
  readonly kind: string;
  readonly state: JobState;
  readonly attempts: number;
  readonly cancellationRequested: boolean;
  readonly checkpointCount: number;
  /** The current lease owner (display only), or null. */
  readonly leaseOwner: string | null;
  readonly updatedAt: number;
}

/** The plan/progress view a harness displays (the checkpoint plan). */
export interface JobPlanView {
  readonly jobId: string;
  readonly state: JobState;
  readonly checkpoints: readonly { readonly seq: number; readonly state: unknown }[];
  /** The resume point after a crash/takeover, or null. */
  readonly resumeFrom: { readonly seq: number; readonly state: unknown } | null;
  readonly outputArtifactRefs: readonly string[];
}

/**
 * The resumable-progress projection (REL-013): what a harness renders for a
 * long-running job — the durable progress timeline (checkpoint seqs), the
 * progress cursor (the last checkpoint — the resume point), whether
 * execution may RESUME, and whether the current lease has EXPIRED (the
 * takeover-eligible display). All of it derives from the canonical record;
 * none of it is harness-local state.
 */
export interface JobProgressView {
  readonly jobId: string;
  readonly kind: string;
  readonly state: JobState;
  readonly attempts: number;
  /** The durable checkpoint timeline (seq + when, in order). */
  readonly timeline: readonly { readonly seq: number; readonly at: number }[];
  /** The progress cursor: the last checkpoint, or null before the first. */
  readonly progressCursor: { readonly seq: number; readonly at: number } | null;
  /**
   * May execution continue (or start)? True for the active states and for
   * a failed job with a policy-bounded retry scheduled — false only for
   * the terminal states (completed/cancelled) and an exhausted failure.
   */
  readonly resumable: boolean;
  /** Has the current lease expired (takeover eligible)? Display only. */
  readonly leaseExpired: boolean;
  readonly cancellationRequested: boolean;
  readonly updatedAt: number;
}

/** The cancellation display view. */
export interface JobCancellationView {
  readonly jobId: string;
  readonly state: JobState;
  readonly cancellationRequested: boolean;
  /** True exactly when the state IS cancelled. */
  readonly cancelled: boolean;
}

/** The read-only harness port: status / plan / progress / cancellation display. */
export interface HarnessPort {
  status(jobId: string): Promise<JobStatusView>;
  plan(jobId: string): Promise<JobPlanView>;
  progress(jobId: string): Promise<JobProgressView>;
  cancellation(jobId: string): Promise<JobCancellationView>;
}

/** Options for {@link createHarnessPort}. */
export interface HarnessPortOptions {
  /**
   * The clock the lease-expiry DISPLAY reads (default: the deterministic
   * jobs clock — never wall time; production injects the real one).
   */
  readonly clock?: () => number;
}

/** Builds the harness port over the reader seam. READS ONLY, by construction. */
export function createHarnessPort(
  reader: JobStoreReader,
  options: HarnessPortOptions = {},
): HarnessPort {
  const clock = options.clock ?? createJobsDefaultClock();

  /** The resumable-progress law (see {@link JobProgressView.resumable}). */
  function resumableOf(record: JobRecord): boolean {
    if (
      record.state === "queued" ||
      record.state === "leased" ||
      record.state === "running" ||
      record.state === "checkpointed"
    ) {
      return true;
    }
    return record.state === "failed" && record.retryAt !== null;
  }

  return {
    async status(jobId) {
      const record = await reader.get(jobId);
      return deepFreeze({
        jobId: record.jobId,
        kind: record.kind,
        state: record.state,
        attempts: record.attempts,
        cancellationRequested: record.cancellationRequested,
        checkpointCount: record.checkpoints.length,
        leaseOwner: record.lease?.owner ?? null,
        updatedAt: record.updatedAt,
      });
    },

    async plan(jobId) {
      const record = await reader.get(jobId);
      const checkpoints = record.checkpoints.map((checkpoint) => ({
        seq: checkpoint.seq,
        state: checkpoint.state,
      }));
      const last = record.checkpoints[record.checkpoints.length - 1];
      return deepFreeze({
        jobId: record.jobId,
        state: record.state,
        checkpoints,
        resumeFrom: last === undefined ? null : { seq: last.seq, state: last.state },
        outputArtifactRefs: [...record.outputArtifactRefs],
      });
    },

    async progress(jobId) {
      const record = await reader.get(jobId);
      const timeline = record.checkpoints.map((checkpoint) => ({
        seq: checkpoint.seq,
        at: checkpoint.at,
      }));
      const last = record.checkpoints[record.checkpoints.length - 1];
      return deepFreeze({
        jobId: record.jobId,
        kind: record.kind,
        state: record.state,
        attempts: record.attempts,
        timeline,
        progressCursor: last === undefined ? null : { seq: last.seq, at: last.at },
        resumable: resumableOf(record),
        leaseExpired: record.lease !== null && record.lease.expiresAt <= clock(),
        cancellationRequested: record.cancellationRequested,
        updatedAt: record.updatedAt,
      });
    },

    async cancellation(jobId) {
      const record = await reader.get(jobId);
      return deepFreeze({
        jobId: record.jobId,
        state: record.state,
        cancellationRequested: record.cancellationRequested,
        cancelled: record.state === "cancelled",
      });
    },
  };
}

/** Deep freeze: the views are immutable snapshots. */
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
