/**
 * REL-029 / Gate REL-A8 — the long-run recovery harness suite, reproducible
 * on ACCELERATED clocks (hour-scale jumps stand in for the multi-hour wall
 * clock; the durability semantics are real on disk — the journal file is
 * the truth, every crash is a real abandoned runtime, every recovery is a
 * real fold + takeover):
 *
 * - WORKER RESTART MID-JOB, twice: kill the worker actor between
 *   checkpoints (its gate never resolves), a new worker resumes from the
 *   durable checkpoint, exactly ONE authoritative completion, and the final
 *   record + artifact lineage deep-equal an uninterrupted run;
 * - HARNESS RECONNECT after a simulated disconnect: the client view
 *   reconciles from the durable log — no lost lineage, no duplicate
 *   completion (also across a retry backoff window and a storm of
 *   duplicate re-submissions, which converge onto the one running job);
 * - CANCELLATION AT EVERY CHECKPOINT BOUNDARY: queued, each mid-run
 *   boundary, and the honest post-final race — no partial authoritative
 *   output, ever;
 * - ARTIFACT LINEAGE: which run, which inputs, which code version —
 *   surviving restarts, reconnects, storms and cancellations.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createFileJobStore,
  createHarnessPort,
  createManualClock,
  createWorkerRuntime,
  lineageEquals,
  lineageOf,
} from "../src";
import type { JobExecutor, JobRecord } from "../src";
import {
  FIVE_STEPS,
  checkpointSignal,
  fiveStepExecutor,
  releaseGate,
  removeScratchDir,
  scratchDir,
  stripWallClock,
} from "./helpers";

let dir = "";
beforeAll(() => {
  dir = scratchDir("long-run");
});
afterAll(() => {
  removeScratchDir(dir);
});

/** The five-step steps, for readability in the cancellation battery. */
const HOUR_MS = 3_600_000;

/** A five-step executor that parks BEFORE RETURNING its outputs (the post-final boundary). */
function fiveStepWithReturnGate(
  gate: Promise<void>,
  onCheckpoint?: (step: string) => void,
): JobExecutor {
  return {
    kind: "five-step",
    codeVersion: "five-step/v1",
    async execute(ctx) {
      const last = ctx.job.checkpoints[ctx.job.checkpoints.length - 1];
      const completed = new Set<string>(
        (last?.state as { completedSteps?: string[] } | undefined)?.completedSteps ?? [],
      );
      for (const step of FIVE_STEPS) {
        if (completed.has(step)) continue;
        completed.add(step);
        await ctx.checkpoint({ completedSteps: [...completed] });
        onCheckpoint?.(step);
      }
      await gate; // the request lands here: AFTER the last checkpoint, BEFORE completion
      return ["artifact://five-step/result"];
    },
  };
}

/** A flaky executor: one checkpoint, then fails until the attempt reaches succeedAt. */
function flakyExecutor(succeedAtAttempt: number): JobExecutor {
  return {
    kind: "flaky-long",
    codeVersion: "flaky-long/v2",
    async execute(ctx) {
      await ctx.checkpoint({ sawAttempt: ctx.job.attempts });
      if (ctx.job.attempts < succeedAtAttempt) {
        throw new Error(`boom on attempt ${ctx.job.attempts}`);
      }
      return [`artifact://flaky-long/attempt-${ctx.job.attempts}`];
    },
  };
}

/** Counts the journal's `complete` / `enqueued` ops (the authoritative-completion audit). */
async function journalOps(store: ReturnType<typeof createFileJobStore>) {
  const events = await store.readJournal();
  return {
    completions: events.filter((event) => event.type === "patched" && event.op === "complete")
      .length,
    enqueues: events.filter((event) => event.type === "enqueued").length,
  };
}

describe("worker restart mid-job, TWICE, on a multi-hour accelerated clock", () => {
  test("two crashes between checkpoints resume from the durable log: exactly one completion, record + lineage deep-equal the uninterrupted run", async () => {
    const path = join(dir, "double-crash.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({
      jobId: "job-1",
      kind: "five-step",
      input: { match: "w12", hours: 4 },
      inputArtifactRefs: ["artifact://inputs/match-w12"],
      idempotencyKey: "long-run-1",
    });

    // -- Crash 1: the first worker stalls before s3's work (2 checkpoints durable).
    const crash1 = releaseGate();
    const afterTwo = checkpointSignal(2);
    const worker1 = createWorkerRuntime({
      store,
      workerId: "w-crash-1",
      leaseTtlMs: 500,
      executors: [
        fiveStepExecutor({
          blockBeforeStep: "s3",
          gate: crash1.gate,
          onCheckpoint: afterTwo.notify,
        }),
      ],
    });
    const abandoned1 = worker1.runAttempt("job-1").catch(() => "abandoned-1");
    await afterTwo.promise;
    clock.advance(2 * HOUR_MS); // two simulated hours pass (accelerated)

    // -- Crash 2: the replacement worker resumes from checkpoint 2, does
    // s3 + s4, then stalls before s5's work (4 checkpoints durable).
    const crash2 = releaseGate();
    const afterFour = checkpointSignal(2); // s3 + s4 persist under worker 2
    const worker2 = createWorkerRuntime({
      store,
      workerId: "w-crash-2",
      leaseTtlMs: 500,
      executors: [
        fiveStepExecutor({
          blockBeforeStep: "s5",
          gate: crash2.gate,
          onCheckpoint: afterFour.notify,
        }),
      ],
    });
    const abandoned2 = worker2.runAttempt("job-1").catch(() => "abandoned-2");
    await afterFour.promise;
    expect((await store.get("job-1")).checkpoints).toHaveLength(4);
    clock.advance(2 * HOUR_MS); // two more simulated hours

    // -- Recovery: a THIRD worker resumes from checkpoint 4 and completes.
    const worker3 = createWorkerRuntime({
      store,
      workerId: "w-recovery",
      leaseTtlMs: 500,
      executors: [fiveStepExecutor()],
    });
    const resumed = await worker3.runAttempt("job-1");
    expect(resumed.state).toBe("completed");
    expect(resumed.checkpoints).toHaveLength(5);
    expect(resumed.attempts).toBe(1); // both takeovers CONTINUED the interrupted attempt
    expect(resumed.outputArtifactRefs).toEqual(["artifact://five-step/result"]);
    expect(resumed.lease).toBeNull();

    // EXACTLY ONE authoritative completion (and one enqueue) in the journal.
    expect(await journalOps(store)).toEqual({ completions: 1, enqueues: 1 });

    // The abandoned workers wake: both refused, the record untouched.
    crash1.release();
    crash2.release();
    await abandoned1;
    await abandoned2;
    expect((await store.get("job-1")).state).toBe("completed");

    // -- The uninterrupted twin (identical payload, one worker, no crashes).
    const cleanPath = join(dir, "uninterrupted.journal.json");
    const cleanClock = createManualClock(10_000);
    const cleanStore = createFileJobStore(cleanPath, { clock: cleanClock });
    await cleanStore.enqueue({
      jobId: "job-1",
      kind: "five-step",
      input: { match: "w12", hours: 4 },
      inputArtifactRefs: ["artifact://inputs/match-w12"],
      idempotencyKey: "long-run-1",
    });
    const cleanWorker = createWorkerRuntime({
      store: cleanStore,
      workerId: "w-clean",
      leaseTtlMs: 500,
      executors: [fiveStepExecutor()],
    });
    const clean = await cleanWorker.runAttempt("job-1");

    // THE deep-equality (wall-clock fields stripped).
    const strip = (record: JobRecord): unknown => stripWallClock(record);
    expect(strip(resumed)).toEqual(strip(clean));

    // THE ARTIFACT LINEAGE: which run, which inputs, which code version.
    const lineage = await lineageOf(resumed);
    const cleanLineage = await lineageOf(clean);
    expect(lineageEquals(lineage, cleanLineage)).toBe(true); // same meaning, survived everything
    expect(lineage).toMatchObject({
      jobId: "job-1", // which run
      kind: "five-step",
      attempts: 1,
      state: "completed",
      inputArtifactRefs: ["artifact://inputs/match-w12"], // which inputs (refs)
      codeVersion: "five-step/v1", // which code version
      outputArtifactRefs: ["artifact://five-step/result"],
      idempotencyKey: "long-run-1",
      checkpointCount: 5,
    });
    expect(lineage.inputDigest).toBe(cleanLineage.inputDigest); // which inputs (digest)
    expect(lineage.inputDigest).toMatch(/^[0-9a-f]{64}$/);

    // The lineage re-derives from a FRESH store folded from the journal
    // (it survives process death by construction).
    const reloaded = createFileJobStore(path, { clock });
    expect(lineageEquals(await lineageOf(await reloaded.get("job-1")), lineage)).toBe(true);
  });
});

describe("harness reconnect after a simulated disconnect", () => {
  test("the client view reconciles from the durable log across a crash + takeover: no lost lineage, no duplicate completion", async () => {
    const path = join(dir, "reconnect.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({
      jobId: "job-1",
      kind: "five-step",
      input: { session: "client-1" },
      idempotencyKey: "reconnect-1",
    });

    // Session #1 opens and observes the mid-flight state.
    const session1 = createHarnessPort(store, { clock });
    const crash = releaseGate();
    const afterTwo = checkpointSignal(2);
    const worker1 = createWorkerRuntime({
      store,
      workerId: "w-crash",
      leaseTtlMs: 500,
      executors: [
        fiveStepExecutor({
          blockBeforeStep: "s3",
          gate: crash.gate,
          onCheckpoint: afterTwo.notify,
        }),
      ],
    });
    const abandoned = worker1.runAttempt("job-1").catch(() => "abandoned");
    await afterTwo.promise;
    const beforeDrop = await session1.progress("job-1");
    expect(beforeDrop.timeline.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(beforeDrop.resumable).toBe(true);
    // ...and then the session DROPS (the object is simply abandoned).

    // Hours pass; the lease expires; a new worker takes over and completes.
    clock.advance(3 * HOUR_MS);
    const worker2 = createWorkerRuntime({
      store,
      workerId: "w-takeover",
      leaseTtlMs: 5_000,
      executors: [fiveStepExecutor()],
    });
    await worker2.runAttempt("job-1");
    crash.release();
    await abandoned;

    // RECONNECT: a fresh store folded from the same journal + a new port.
    const reloaded = createFileJobStore(path, { clock });
    const session2 = createHarnessPort(reloaded, { clock });
    const status = await session2.status("job-1");
    expect(status).toMatchObject({
      jobId: "job-1",
      state: "completed",
      attempts: 1,
      checkpointCount: 5,
      leaseOwner: null,
    });
    const progress = await session2.progress("job-1");
    expect(progress.timeline.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]); // continuous — no lost lineage
    expect(progress.resumable).toBe(false);
    const plan = await session2.plan("job-1");
    expect(plan.resumeFrom).toEqual({ seq: 5, state: { completedSteps: [...FIVE_STEPS] } });
    expect(plan.outputArtifactRefs).toEqual(["artifact://five-step/result"]);

    // No duplicate completion, in the reloaded view AND the writer's own.
    expect(await journalOps(reloaded)).toEqual({ completions: 1, enqueues: 1 });
    expect(await journalOps(store)).toEqual({ completions: 1, enqueues: 1 });

    // The lineage reconciles identically from both sides of the disconnect.
    expect(
      lineageEquals(
        await lineageOf(await reloaded.get("job-1")),
        await lineageOf(await store.get("job-1")),
      ),
    ).toBe(true);
  });

  test("reconnect DURING the retry backoff window reconciles; the retry then completes exactly once, lineage intact", async () => {
    const path = join(dir, "backoff-reconnect.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({
      jobId: "job-1",
      kind: "flaky-long",
      input: { flaky: true },
      retryPolicy: {
        maxAttempts: 2,
        initialBackoffMs: HOUR_MS, // a one-hour accelerated backoff
        backoffFactor: 2,
        maxBackoffMs: 4 * HOUR_MS,
      },
      idempotencyKey: "backoff-1",
    });
    const worker = createWorkerRuntime({
      store,
      workerId: "w1",
      leaseTtlMs: 5_000,
      executors: [flakyExecutor(2)],
    });

    // Attempt 1 fails; the retry is scheduled an hour out.
    const failed = await worker.runAttempt("job-1");
    expect(failed.state).toBe("failed");
    expect(failed.retryAt).toBe(10_000 + HOUR_MS);

    // The client observes the mid-backoff state, then DROPS.
    const session1 = createHarnessPort(store, { clock });
    const beforeDrop = await session1.progress("job-1");
    expect(beforeDrop.state).toBe("failed");
    expect(beforeDrop.resumable).toBe(true); // the policy-bounded retry is scheduled

    // RECONNECT mid-backoff: a fresh store + port reconcile the same view.
    const reloadedMidBackoff = createFileJobStore(path, { clock });
    const session2 = createHarnessPort(reloadedMidBackoff, { clock });
    const reconciled = await session2.progress("job-1");
    expect(reconciled).toEqual(beforeDrop);
    expect(reconciled.timeline.map((entry) => entry.seq)).toEqual([1]); // the failed attempt's checkpoint survived

    // The hour passes; the retry requeues; attempt 2 completes.
    clock.advance(HOUR_MS + 1);
    const requeued = await worker.requeueDueRetries();
    expect(requeued.map((record) => record.jobId)).toEqual(["job-1"]);
    const done = await worker.runAttempt("job-1");
    expect(done.state).toBe("completed");
    expect(done.attempts).toBe(2);
    expect(done.outputArtifactRefs).toEqual(["artifact://flaky-long/attempt-2"]);

    // Final reconnect: one completion, one enqueue, lineage answers the questions.
    const finalStore = createFileJobStore(path, { clock });
    expect(await journalOps(finalStore)).toEqual({ completions: 1, enqueues: 1 });
    const lineage = await lineageOf(await finalStore.get("job-1"));
    expect(lineage).toMatchObject({
      jobId: "job-1",
      kind: "flaky-long",
      attempts: 2, // which run: one crash-free retry cycle
      state: "completed",
      codeVersion: "flaky-long/v2", // which code version
      checkpointCount: 2, // one per attempt, all durable
      outputArtifactRefs: ["artifact://flaky-long/attempt-2"],
      idempotencyKey: "backoff-1",
    });
  });

  test("a reconnected client's duplicate submission converges onto the RUNNING job (storm + reconnect)", async () => {
    const path = join(dir, "storm-reconnect.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({
      jobId: "job-1",
      kind: "five-step",
      input: { storm: "reconnect" },
      idempotencyKey: "storm-reconnect-1",
    });

    // The worker is mid-run (2 checkpoints durable) when the client drops.
    const crash = releaseGate();
    const afterTwo = checkpointSignal(2);
    const worker1 = createWorkerRuntime({
      store,
      workerId: "w-crash",
      leaseTtlMs: 500,
      executors: [
        fiveStepExecutor({
          blockBeforeStep: "s3",
          gate: crash.gate,
          onCheckpoint: afterTwo.notify,
        }),
      ],
    });
    const abandoned = worker1.runAttempt("job-1").catch(() => "abandoned");
    await afterTwo.promise;

    // The client reconnects through a FRESH store and re-submits the SAME
    // request (same key, same payload): it must converge onto the ONE
    // running job — never a second job.
    const reconnected = createFileJobStore(path, { clock });
    const resubmission = await reconnected.enqueue({
      jobId: "job-1",
      kind: "five-step",
      input: { storm: "reconnect" },
      idempotencyKey: "storm-reconnect-1",
    });
    expect(resubmission.jobId).toBe("job-1");
    expect(resubmission.state).toBe("running"); // the very job, mid-flight
    expect(await reconnected.getByIdempotencyKey("storm-reconnect-1")).toMatchObject({
      jobId: "job-1",
    });

    // The crash + takeover + completion follow; still exactly one of each.
    clock.advance(HOUR_MS);
    const worker2 = createWorkerRuntime({
      store,
      workerId: "w-takeover",
      leaseTtlMs: 5_000,
      executors: [fiveStepExecutor()],
    });
    const done = await worker2.runAttempt("job-1");
    expect(done.state).toBe("completed");
    crash.release();
    await abandoned;
    expect(await journalOps(store)).toEqual({ completions: 1, enqueues: 1 });
    expect(lineageEquals(await lineageOf(done), await lineageOf(await store.get("job-1")))).toBe(
      true,
    );
  });
});

describe("cancellation at every checkpoint boundary (no partial authoritative output, ever)", () => {
  test("QUEUED (before the first boundary): immediate, zero checkpoints, no output", async () => {
    const path = join(dir, "cancel-queued.journal.json");
    const store = createFileJobStore(path, { clock: createManualClock(10_000) });
    await store.enqueue({ jobId: "job-1", kind: "five-step", input: null });

    const cancelled = await store.requestCancellation("job-1");
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.checkpoints).toHaveLength(0);
    expect(cancelled.outputArtifactRefs).toEqual([]);
    expect(await journalOps(store)).toEqual({ completions: 0, enqueues: 1 });
    const lineage = await lineageOf(cancelled);
    expect(lineage).toMatchObject({
      state: "cancelled",
      outputArtifactRefs: [],
      checkpointCount: 0,
    });
  });

  for (const k of [1, 2, 3, 4]) {
    test(`after checkpoint ${k}: honored AT boundary ${k + 1} — cancelled, no output, lineage preserved`, async () => {
      const path = join(dir, `cancel-after-${k}.journal.json`);
      const clock = createManualClock(10_000);
      const store = createFileJobStore(path, { clock });
      await store.enqueue({ jobId: "job-1", kind: "five-step", input: { cancelAfter: k } });

      // The worker parks before step k+1's work (checkpoint k is durable).
      const { gate, release } = releaseGate();
      const afterK = checkpointSignal(k);
      const worker = createWorkerRuntime({
        store,
        workerId: "w1",
        leaseTtlMs: 5_000,
        executors: [
          fiveStepExecutor({
            blockBeforeStep: FIVE_STEPS[k],
            gate,
            onCheckpoint: afterK.notify,
          }),
        ],
      });
      const settled = worker.runAttempt("job-1");
      await afterK.promise;
      expect((await store.get("job-1")).checkpoints).toHaveLength(k);

      // The cancellation request lands while the executor is parked.
      const requested = await store.requestCancellation("job-1");
      expect(requested.cancellationRequested).toBe(true);
      expect(requested.state).toBe("running"); // cooperative: NOT cancelled yet

      release(); // the request is honored at the NEXT checkpoint boundary
      const final = await settled;
      expect(final.state).toBe("cancelled");
      expect(final.checkpoints).toHaveLength(k + 1); // the boundary checkpoint persisted FIRST
      expect(final.cancellationRequested).toBe(true);
      expect(final.lease).toBeNull();

      // NO partial authoritative output, ever: no artifacts, no completion.
      expect(final.outputArtifactRefs).toEqual([]);
      expect(await journalOps(store)).toEqual({ completions: 0, enqueues: 1 });
      const lineage = await lineageOf(final);
      expect(lineage).toMatchObject({
        state: "cancelled",
        checkpointCount: k + 1, // the lineage survived the cancellation
        outputArtifactRefs: [],
        codeVersion: "five-step/v1",
      });
      // And the lineage survives the reload.
      const reloaded = createFileJobStore(path, { clock });
      expect(lineageEquals(await lineageOf(await reloaded.get("job-1")), lineage)).toBe(true);
    });
  }

  test("after the FINAL checkpoint (the honest race-loss): completed with the WHOLE output", async () => {
    const path = join(dir, "cancel-post-final.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "five-step", input: null });

    // The executor parks AFTER checkpoint 5 but BEFORE returning its outputs.
    const { gate, release } = releaseGate();
    const afterFive = checkpointSignal(5);
    const worker = createWorkerRuntime({
      store,
      workerId: "w1",
      leaseTtlMs: 5_000,
      executors: [fiveStepWithReturnGate(gate, afterFive.notify)],
    });
    const settled = worker.runAttempt("job-1");
    await afterFive.promise;

    // The request lands after the final checkpoint: there is no NEXT
    // checkpoint to honor it at — the completion races it honestly.
    await store.requestCancellation("job-1");
    release();
    const final = await settled;
    expect(final.state).toBe("completed"); // the request lost the race
    expect(final.cancellationRequested).toBe(true); // ...and the request is still recorded evidence
    expect(final.checkpoints).toHaveLength(5);
    // The output is WHOLE (all five steps), never partial.
    expect(final.outputArtifactRefs).toEqual(["artifact://five-step/result"]);
    expect(await journalOps(store)).toEqual({ completions: 1, enqueues: 1 });
    const lineage = await lineageOf(final);
    expect(lineage).toMatchObject({
      state: "completed",
      checkpointCount: 5,
      outputArtifactRefs: ["artifact://five-step/result"],
    });
  });
});
