/**
 * REL-012 restart/reconnect tests — THE durability proof: run a
 * 5-checkpoint job, DROP the worker mid-run (its gate never resolves), and
 * a NEW worker resumes from the checkpoint and completes; the final record
 * deep-equals an uninterrupted run with wall-clock fields stripped. Then
 * the abandoned worker wakes and its writes are REFUSED — the completed
 * record is untouched.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createFileJobStore, createManualClock, createWorkerRuntime, isJobsError } from "../src";
import type { JobRecord } from "../src";
import {
  checkpointSignal,
  fiveStepExecutor,
  releaseGate,
  removeScratchDir,
  scratchDir,
  stripWallClock,
} from "./helpers";

let dir = "";
beforeAll(() => {
  dir = scratchDir("restart");
});
afterAll(() => {
  removeScratchDir(dir);
});

describe("worker restart mid-run (the 5-checkpoint job)", () => {
  test("a NEW worker resumes from the checkpoint and the final record deep-equals the uninterrupted run", async () => {
    // -- The interrupted run ------------------------------------------------
    const interruptedPath = join(dir, "interrupted.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(interruptedPath, { clock });
    const record0 = await store.enqueue({
      jobId: "job-1",
      kind: "five-step",
      input: { match: "w12" },
    });
    expect(record0.state).toBe("queued");

    const { gate, release } = releaseGate();
    const afterTwo = checkpointSignal(2);
    const crashedWorker = createWorkerRuntime({
      store,
      workerId: "w1",
      leaseTtlMs: 500,
      executors: [fiveStepExecutor({ blockBeforeStep: "s3", gate, onCheckpoint: afterTwo.notify })],
    });

    let abandoned: unknown;
    const settled = crashedWorker.runAttempt("job-1").catch((error: unknown) => {
      abandoned = error;
      return undefined;
    });

    // Wait until checkpoint 2 is durably persisted, then "crash": the
    // worker object is dropped (its gate stays closed; nothing records a
    // failure — a crash is silent by definition).
    await afterTwo.promise;
    const midRun = await store.get("job-1");
    expect(midRun.state).toBe("running");
    expect(midRun.checkpoints).toHaveLength(2);
    expect(midRun.lease?.owner).toBe("w1");

    // The lease expires (time passes; the dropped worker never renewed).
    clock.advance(501);

    // A NEW worker on the SAME store resumes from checkpoint 2.
    const replacement = createWorkerRuntime({
      store,
      workerId: "w2",
      leaseTtlMs: 500,
      executors: [fiveStepExecutor()],
    });
    const resumed = await replacement.runAttempt("job-1");
    expect(resumed.state).toBe("completed");
    expect(resumed.checkpoints).toHaveLength(5);
    expect(resumed.attempts).toBe(1); // the takeover CONTINUED the interrupted attempt
    expect(resumed.outputArtifactRefs).toEqual(["artifact://five-step/result"]);
    expect(resumed.lease).toBeNull();

    // -- The uninterrupted run ------------------------------------------------
    const cleanPath = join(dir, "uninterrupted.journal.json");
    const cleanClock = createManualClock(10_000);
    const cleanStore = createFileJobStore(cleanPath, { clock: cleanClock });
    await cleanStore.enqueue({ jobId: "job-1", kind: "five-step", input: { match: "w12" } });
    const cleanWorker = createWorkerRuntime({
      store: cleanStore,
      workerId: "u1",
      leaseTtlMs: 500,
      executors: [fiveStepExecutor()],
    });
    const clean = await cleanWorker.runAttempt("job-1");
    expect(clean.state).toBe("completed");
    expect(clean.checkpoints).toHaveLength(5);

    // -- THE deep-equality (wall-clock fields stripped) -----------------------
    const strip = (record: JobRecord): unknown => stripWallClock(record);
    expect(strip(resumed)).toEqual(strip(clean));
    expect(resumed.checkpoints.map((checkpoint) => checkpoint.state)).toEqual(
      clean.checkpoints.map((checkpoint) => checkpoint.state),
    );

    // -- The abandoned worker wakes: its writes are refused --------------------
    release();
    await settled;
    expect(isJobsError(abandoned)).toBe(true);
    expect((abandoned as { code: string }).code).toBe("jobs.lease-not-held");
    const afterWake = await store.get("job-1");
    expect(afterWake.state).toBe("completed"); // untouched — the law held
    expect(afterWake.checkpoints).toHaveLength(5);
    expect(strip(afterWake)).toEqual(strip(clean));
  });
});

describe("restart through a FRESH store instance (reconnect after process death)", () => {
  test("a new process (new store object, same file) resumes and completes", async () => {
    const path = join(dir, "reconnect.journal.json");
    const clock = createManualClock(20_000);
    const storeA = createFileJobStore(path, { clock });
    await storeA.enqueue({ jobId: "job-9", kind: "five-step", input: null });

    // Worker 1 in "process A" starts, checkpoints twice, then the process
    // dies: the store object is simply abandoned (no failure recorded).
    const { gate } = releaseGate();
    const afterTwo = checkpointSignal(2);
    const workerA = createWorkerRuntime({
      store: storeA,
      workerId: "proc-a",
      leaseTtlMs: 500,
      executors: [fiveStepExecutor({ blockBeforeStep: "s3", gate, onCheckpoint: afterTwo.notify })],
    });
    void workerA.runAttempt("job-9").catch(() => undefined);
    await afterTwo.promise;
    clock.advance(501);

    // "Process B": a FRESH store instance over the same journal file, and a
    // new worker — the reconnect path.
    const storeB = createFileJobStore(path, { clock });
    const midRun = await storeB.get("job-9");
    expect(midRun.checkpoints).toHaveLength(2);
    const workerB = createWorkerRuntime({
      store: storeB,
      workerId: "proc-b",
      leaseTtlMs: 500,
      executors: [fiveStepExecutor()],
    });
    const final = await workerB.runAttempt("job-9");
    expect(final.state).toBe("completed");
    expect(final.checkpoints).toHaveLength(5);
    expect(final.attempts).toBe(1);
  });
});
