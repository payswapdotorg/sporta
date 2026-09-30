/**
 * The harness port (REL-012) — THE INVARIANT: long-running state is
 * canonical in Sporta; external harnesses (OpenMuse/CopilotKit/AG-UI) are
 * ADAPTERS, never authorities.
 *
 * Source of truth: ADR-013 #14 ("Their internal state is never the
 * canonical Sporta job state") and reality-engineering-lab.md §12 ("An
 * external harness is a presentation/interaction and orchestration
 * integration, not a persistence authority").
 *
 * The port exposes STATUS, PLAN and CANCELLATION DISPLAY — reads only.
 * Enforcement, twice:
 * - TYPE LEVEL: `HarnessPort`'s surface is three read methods; the factory
 *   takes the NARROW `JobStoreReader` (get + list), so the port's closure
 *   structurally cannot mutate — there is no mutating method to call.
 * - RUNTIME: a dedicated test enumerates the port's surface and asserts no
 *   mutating method exists (requestCancellation/cancel/complete/fail/
 *   enqueue/acquire are all absent), and that the views are frozen
 *   snapshots — mutating a view cannot touch the store.
 *
 * Cancellation REQUESTS (when a harness user clicks "cancel") flow through
 * the Sporta application service (REL-013's harness adapter wires the
 * button to `requestCancellation` over the application API) — never through
 * this port. The port only DISPLAYS the cancellation state.
 */
import type { JobRecord, JobState } from "./domain";

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

/** The cancellation display view. */
export interface JobCancellationView {
  readonly jobId: string;
  readonly state: JobState;
  readonly cancellationRequested: boolean;
  /** True exactly when the state IS cancelled. */
  readonly cancelled: boolean;
}

/** The read-only harness port: status / plan / cancellation display. */
export interface HarnessPort {
  status(jobId: string): Promise<JobStatusView>;
  plan(jobId: string): Promise<JobPlanView>;
  cancellation(jobId: string): Promise<JobCancellationView>;
}

/** Builds the harness port over the reader seam. READS ONLY, by construction. */
export function createHarnessPort(reader: JobStoreReader): HarnessPort {
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
