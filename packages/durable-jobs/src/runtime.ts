/**
 * The worker runtime (REL-012): acquire lease -> run -> checkpoint
 * (resumable) -> complete, with lease-expiry takeover, bounded-backoff
 * retries and cooperative cancellation.
 *
 * THE DIVISION OF LABOR: the runtime drives ONE execution attempt
 * (`runAttempt`) to a terminal or failed state. RETRY TIMING is a driver
 * concern — `requeueDueRetries` requeues failed jobs whose backoff has
 * come due (measured on the injected clock), and the driver calls
 * `runAttempt` again. The runtime never sleeps and never loops forever.
 *
 * COOPERATIVE CANCELLATION: `ctx.checkpoint` persists the checkpoint,
 * then observes `cancellationRequested`; when a request is honored, the
 * runtime transitions the job to `cancelled` (the leaseholder-only edge)
 * and throws {@link JobsCancellationSignal} INTO the executor — executors
 * must let it propagate (it is how the runtime stops them AT the
 * checkpoint, never mid-step).
 */
import type { JobRecord } from "./domain";
import { JobsCancellationSignal, JobsValidationError } from "./errors";
import type { JobStore } from "./store";

/** The per-attempt execution context handed to an executor. */
export interface JobExecutorContext {
  /** The record at execution start (its checkpoints are the resume point). */
  readonly job: JobRecord;
  readonly workerId: string;
  /**
   * Records a durable checkpoint and observes cancellation. Throws
   * {@link JobsCancellationSignal} when a cancellation request is honored
   * at this checkpoint — do not catch it.
   */
  checkpoint(state: unknown): Promise<void>;
  /** The cancellation flag as of the last checkpoint (or execution start). */
  readonly cancelRequested: boolean;
}

/**
 * A job-kind executor: RESUMABLE work. `execute` receives the job (with
 * its checkpoints) and must consult the last checkpoint to skip already
 * completed work; a takeover hands the SAME contract to the new worker.
 * Returns the output artifact references (or void).
 */
export interface JobExecutor {
  readonly kind: string;
  /**
   * REL-029 — the executor's code version (e.g. "five-step/v1"). Recorded
   * on the job record at attempt start so the artifact lineage can answer
   * "which code version" produced the outputs. Optional: an executor that
   * stays silent records null (honest: undeclared).
   */
  readonly codeVersion?: string;
  execute(ctx: JobExecutorContext): Promise<readonly string[] | void>;
}

export interface WorkerRuntimeOptions {
  readonly store: JobStore;
  readonly workerId: string;
  readonly executors: readonly JobExecutor[];
  /** The lease TTL this runtime acquires (default 60_000 ms). */
  readonly leaseTtlMs?: number;
}

export interface WorkerRuntime {
  readonly workerId: string;
  /**
   * Drives one attempt: acquire (takeover when the previous lease
   * expired) -> start -> execute (checkpoints resumable) -> complete |
   * fail | cancelled. Returns the resulting record; never throws for
   * executor failures (they become the recorded failure), only for
   * store-level faults (lease law violations surface here).
   */
  runAttempt(jobId: string): Promise<JobRecord>;
  /** Requeues failed jobs whose retryAt has come due (the retry driver). */
  requeueDueRetries(): Promise<readonly JobRecord[]>;
  /** Requests cooperative cancellation of a job (see the store). */
  requestCancellation(jobId: string): Promise<JobRecord>;
}

/** Creates a worker runtime bound to a store and its executors. */
export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const { store, workerId, executors } = options;
  const leaseTtlMs = options.leaseTtlMs ?? 60_000;

  function executorFor(kind: string): JobExecutor {
    const executor = executors.find((candidate) => candidate.kind === kind);
    if (executor === undefined) {
      throw new JobsValidationError(`no executor registered for kind ${kind}`, [kind]);
    }
    return executor;
  }
  const runtime: WorkerRuntime = {
    workerId,

    async runAttempt(jobId) {
      // 1. Acquire the lease (a queued job, or a takeover of an expired one).
      await store.acquireLease(jobId, workerId, leaseTtlMs);
      let record = await store.get(jobId);

      // 2. Start (recording the executor's declared code version when the
      //    kind has a registered executor — the lineage's "which code"
      //    leg; an unregistered kind still fails through the same fail
      //    path below). A cancellation requested before any work ran is
      //    honored immediately (it is the "next checkpoint" of a
      //    not-yet-running job).
      const knownExecutor = executors.find((candidate) => candidate.kind === record.kind);
      record = await store.start(jobId, workerId, {
        codeVersion: knownExecutor?.codeVersion,
      });
      if (record.cancellationRequested) {
        await store.cancel(jobId, workerId);
        return store.get(jobId);
      }

      // 3. Execute with checkpoint/cancellation context. An unregistered
      //    kind is a configuration failure — it is recorded through the
      //    same fail path (the retry policy decides whether it retries).
      let cancelRequested = record.cancellationRequested;
      const ctx: JobExecutorContext = {
        job: record,
        workerId,
        get cancelRequested() {
          return cancelRequested;
        },
        async checkpoint(state: unknown): Promise<void> {
          const updated = await store.recordCheckpoint(jobId, workerId, state);
          if (updated.cancellationRequested) {
            // Honored AT this checkpoint: persist it, then stop.
            await store.cancel(jobId, workerId);
            throw new JobsCancellationSignal(
              `job ${jobId} cancelled at checkpoint ${updated.checkpoints.length} (the request was honored at the checkpoint boundary)`,
            );
          }
          await store.continueFromCheckpoint(jobId, workerId);
          cancelRequested = updated.cancellationRequested;
        },
      };

      try {
        const executor = executorFor(record.kind);
        const outputs = await executor.execute(ctx);
        return await store.complete(jobId, workerId, outputs ?? []);
      } catch (error) {
        if (error instanceof JobsCancellationSignal) {
          return store.get(jobId);
        }
        const message = error instanceof Error ? error.message : String(error);
        return store.fail(jobId, workerId, message);
      }
    },

    async requeueDueRetries() {
      return store.requeueDueRetries();
    },

    async requestCancellation(jobId) {
      return store.requestCancellation(jobId);
    },
  };
  return runtime;
}
