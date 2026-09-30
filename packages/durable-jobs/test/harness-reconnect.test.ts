/**
 * REL-013 reconnect-semantics tests (Gate REL-A8 through the port): a
 * harness session drop + reconnect sees CONSISTENT canonical job state — no
 * duplicate completion, no lost lineage — proven with a checkpointed
 * multi-stage job driven through the port, including a full worker crash +
 * takeover between the drop and the reconnect.
 *
 * The harness port is STATELESS: a "session" is just a port instance, and a
 * "reconnect" is a NEW port (over a whole NEW store instance folded from
 * the same journal file — the durable truth). What must hold: the timeline
 * is continuous (no gaps, no duplicates), the interrupted attempt CONTINUES
 * (attempts unchanged), exactly ONE completion event exists, and the
 * pre-drop and post-reconnect projections agree at every observed point.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createFileJobStore,
  createHarnessPort,
  createManualClock,
  createWorkerRuntime,
} from "../src";
import {
  checkpointSignal,
  fiveStepExecutor,
  releaseGate,
  removeScratchDir,
  scratchDir,
} from "./helpers";

let dir = "";
beforeAll(() => {
  dir = scratchDir("harness-reconnect");
});
afterAll(() => {
  removeScratchDir(dir);
});

describe("a session drop + reconnect over a checkpointed multi-stage job", () => {
  test("reconnect sees consistent state across a worker crash + takeover: one completion, no lost lineage", async () => {
    const path = join(dir, "reconnect.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "five-step", input: null });

    // Harness session #1 opens.
    const session1 = createHarnessPort(store, { clock });

    // The worker starts; the crash point is BEFORE step s3 (2 checkpoints
    // will have persisted when the worker stalls).
    const seen = checkpointSignal(2);
    const { gate, release } = releaseGate();
    const crashedWorker = createWorkerRuntime({
      store,
      workerId: "w-crashed",
      leaseTtlMs: 500,
      executors: [
        fiveStepExecutor({ blockBeforeStep: "s3", gate, onCheckpoint: () => seen.notify() }),
      ],
    });
    const abandoned = crashedWorker.runAttempt("job-1"); // never awaited to completion
    await seen.promise; // s1 + s2 checkpointed and persisted

    // The session observes the mid-flight state, then DROPS.
    const midFlight = await session1.progress("job-1");
    expect(midFlight.state).toBe("running");
    expect(midFlight.timeline.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(midFlight.progressCursor?.seq).toBe(2);
    expect(midFlight.resumable).toBe(true);

    // The worker "crashes": it stalls on the gate and never writes again.
    // (The abandoned promise is released at the end of the test.)

    // The lease expires; worker #2 TAKES OVER and resumes from the checkpoint.
    clock.advance(1_000);
    const worker2 = createWorkerRuntime({
      store,
      workerId: "w2",
      leaseTtlMs: 5_000,
      executors: [fiveStepExecutor()],
    });
    const done = await worker2.runAttempt("job-1");
    expect(done.state).toBe("completed");
    expect(done.checkpoints.length).toBe(5); // 2 from before + 3 resumed — no duplicates
    expect(done.outputArtifactRefs).toEqual(["artifact://five-step/result"]);

    // RECONNECT: a brand-new store instance folded from the same journal +
    // a brand-new port. The canonical state is what it is.
    const reloadedStore = createFileJobStore(path, { clock });
    const session2 = createHarnessPort(reloadedStore, { clock });

    const status = await session2.status("job-1");
    expect(status).toMatchObject({
      jobId: "job-1",
      state: "completed",
      attempts: 1, // the takeover CONTINUED the interrupted attempt
      checkpointCount: 5,
      leaseOwner: null,
      cancellationRequested: false,
    });

    const progress = await session2.progress("job-1");
    expect(progress.timeline.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]); // continuous
    expect(progress.resumable).toBe(false); // completed is terminal
    expect(progress.leaseExpired).toBe(false); // the lease was released at completion
    expect(progress.progressCursor?.seq).toBe(5);

    const plan = await session2.plan("job-1");
    expect(plan.resumeFrom).toEqual({
      seq: 5,
      state: { completedSteps: ["s1", "s2", "s3", "s4", "s5"] },
    });
    expect(plan.outputArtifactRefs).toEqual(["artifact://five-step/result"]);

    // NO DUPLICATE COMPLETION: exactly one "complete" op in the journal, and
    // the enqueued event exists exactly once (no lost lineage either).
    const events = await reloadedStore.readJournal();
    const completions = events.filter(
      (event) => event.type === "patched" && event.op === "complete",
    );
    expect(completions.length).toBe(1);
    const enqueues = events.filter((event) => event.type === "enqueued");
    expect(enqueues.length).toBe(1);

    // Release the abandoned worker's gate (it may now observe its loss; its
    // writes were already refused by the lease law).
    release();
    await abandoned.then(
      (record) => {
        // The crashed worker's attempt either failed on the expired lease
        // (store-level fault surfaces) or recorded a failure — it can NEVER
        // have produced a second completion.
        expect(record.state === "completed").toBe(false);
      },
      () => {
        // A lease-law rejection is also an honest outcome for the loser.
        expect(true).toBe(true);
      },
    );
    // And the canonical record is STILL the single completed truth.
    expect((await reloadedStore.get("job-1")).state).toBe("completed");
    expect(
      (await reloadedStore.readJournal()).filter(
        (event) => event.type === "patched" && event.op === "complete",
      ).length,
    ).toBe(1);
  });

  test("a cancelled mid-processing job displays its cancellation after reconnect", async () => {
    const path = join(dir, "reconnect-cancel.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "five-step", input: null });

    const session1 = createHarnessPort(store, { clock });
    const seen = checkpointSignal(1);
    const worker = createWorkerRuntime({
      store,
      workerId: "w1",
      leaseTtlMs: 60_000,
      executors: [fiveStepExecutor({ onCheckpoint: () => seen.notify() })],
    });
    const running = worker.runAttempt("job-1");
    await seen.promise; // s1 checkpointed

    // The user requests cancellation through the APPLICATION service (the
    // store) — never through the port (the port only displays it).
    await store.requestCancellation("job-1");
    const pending = await session1.cancellation("job-1");
    expect(pending.cancellationRequested).toBe(true);
    expect(pending.cancelled).toBe(false); // honored at the NEXT checkpoint

    const final = await running; // honored at the s2 checkpoint boundary
    expect(final.state).toBe("cancelled");

    // Reconnect: the display is the canonical cancelled state. The request
    // flag stays true on the record — it is the evidence the cancellation
    // was requested and honored (the v0 store never resets it).
    const session2 = createHarnessPort(createFileJobStore(path, { clock }), { clock });
    const cancellation = await session2.cancellation("job-1");
    expect(cancellation).toEqual({
      jobId: "job-1",
      state: "cancelled",
      cancellationRequested: true,
      cancelled: true,
    });
    const progress = await session2.progress("job-1");
    expect(progress.state).toBe("cancelled");
    expect(progress.resumable).toBe(false); // cancelled is terminal
    expect(progress.timeline.length).toBeGreaterThan(0); // lineage preserved
  });
});
