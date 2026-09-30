/**
 * REL-012 cooperative-cancellation tests: cancel honored at the next
 * checkpoint — never mid-step; a queued job cancels immediately; a
 * terminal record refuses typed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  JobsCancellationSignal,
  JobsIllegalTransitionError,
  createFileJobStore,
  createManualClock,
  createWorkerRuntime,
} from "../src";
import type { JobExecutor } from "../src/runtime";
import { checkpointSignal, removeScratchDir, scratchDir } from "./helpers";

let dir = "";
beforeAll(() => {
  dir = scratchDir("cancel");
});
afterAll(() => {
  removeScratchDir(dir);
});

/** Three steps, one checkpoint each; blocks before `blockBefore` on the gate. */
function threeStepExecutor(options: {
  blockBefore: string;
  gate: Promise<void>;
  onCheckpoint?: (step: string) => void;
}): JobExecutor {
  return {
    kind: "three-step",
    async execute(ctx) {
      const last = ctx.job.checkpoints[ctx.job.checkpoints.length - 1];
      const completed = new Set<string>(
        (last?.state as { completedSteps?: string[] } | undefined)?.completedSteps ?? [],
      );
      for (const step of ["s1", "s2", "s3"]) {
        if (completed.has(step)) continue;
        if (step === options.blockBefore) await options.gate;
        completed.add(step);
        await ctx.checkpoint({ completedSteps: [...completed] });
        options.onCheckpoint?.(step);
      }
      return ["artifact://three-step/result"];
    },
  };
}

describe("cancellation of a queued job", () => {
  test("cancels immediately (nothing to cooperate with)", async () => {
    const path = join(dir, "queued.journal.json");
    const store = createFileJobStore(path, { clock: createManualClock() });
    await store.enqueue({ jobId: "job-1", kind: "three-step", input: null });

    const cancelled = await store.requestCancellation("job-1");
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.completedAt).not.toBeNull();
    expect(cancelled.lease).toBeNull();
  });
});

describe("cooperative cancellation mid-run", () => {
  test("the request is honored AT the next checkpoint — the checkpoint persists first", async () => {
    const path = join(dir, "midrun.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "three-step", input: null });

    // The executor completes s1, then blocks before s2's work until the
    // test lets it continue (the cancellation request lands in between).
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const afterOne = checkpointSignal(1);
    const worker = createWorkerRuntime({
      store,
      workerId: "w1",
      leaseTtlMs: 500,
      executors: [threeStepExecutor({ blockBefore: "s2", gate, onCheckpoint: afterOne.notify })],
    });

    let signalEscaped = false;
    const settled = worker.runAttempt("job-1").then(
      (record) => record,
      (error: unknown) => {
        signalEscaped = true; // the runtime absorbs the signal — it must never escape
        throw error;
      },
    );

    await afterOne.promise; // s1 checkpointed; the executor is parked before s2
    expect((await store.get("job-1")).state).toBe("running");

    // The cancellation request arrives while the executor is mid-step.
    const requested = await store.requestCancellation("job-1");
    expect(requested.cancellationRequested).toBe(true);
    expect(requested.state).toBe("running"); // NOT cancelled yet — cooperative

    release(); // the executor proceeds: s2's checkpoint persists, THEN the
    // request is honored at that checkpoint boundary.

    const final = await settled;
    expect(signalEscaped).toBe(false); // runAttempt returns the record; the
    // signal was absorbed by the runtime (it stops the executor, not the caller)
    expect(final.state).toBe("cancelled");
    expect(final.checkpoints).toHaveLength(2); // s1 AND s2 persisted first
    expect(final.checkpoints[1]?.state).toEqual({ completedSteps: ["s1", "s2"] });
    expect(final.cancellationRequested).toBe(true);
    expect(final.lease).toBeNull();
  });

  test("the cancellation signal is the runtime's control flow, not an Api error", () => {
    const signal = new JobsCancellationSignal("cancelled at checkpoint 2");
    expect(signal).toBeInstanceOf(Error);
    expect(signal.name).toBe("JobsCancellationSignal");
  });
});

describe("cancellation requested before work starts (a leased job)", () => {
  test("runAttempt honors it immediately after start", async () => {
    const path = join(dir, "leased.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "three-step", input: null });

    // The scheduler holds the lease; the cancellation request lands while
    // the job is leased-but-not-started.
    const leased = await store.acquireLease("job-1", "w1", 500);
    expect(leased.state).toBe("leased");
    const requested = await store.requestCancellation("job-1");
    expect(requested.cancellationRequested).toBe(true);
    expect(requested.state).toBe("leased");

    const worker = createWorkerRuntime({
      store,
      workerId: "w1", // the same worker holds the lease
      leaseTtlMs: 500,
      executors: [threeStepExecutor({ blockBefore: "never", gate: Promise.resolve() })],
    });
    const final = await worker.runAttempt("job-1");
    expect(final.state).toBe("cancelled");
    expect(final.checkpoints).toHaveLength(0); // no work was started
  });
});

describe("cancellation of a terminal job", () => {
  test("refuses typed (terminal records are frozen evidence)", async () => {
    const path = join(dir, "terminal.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "three-step", input: null });
    const worker = createWorkerRuntime({
      store,
      workerId: "w1",
      leaseTtlMs: 500,
      executors: [threeStepExecutor({ blockBefore: "never", gate: Promise.resolve() })],
    });
    const done = await worker.runAttempt("job-1");
    expect(done.state).toBe("completed");

    let caught: unknown;
    try {
      await store.requestCancellation("job-1");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JobsIllegalTransitionError);
    expect((caught as JobsIllegalTransitionError).code).toBe("jobs.illegal-transition");
    expect((await store.get("job-1")).state).toBe("completed");
  });
});
