/**
 * REL-012 harness-port tests — THE INVARIANT: the port READS job state and
 * CANNOT write it. The surface enumeration proves no mutating method
 * exists; the reader-only construction proves the port functions without
 * any mutating capability; the views are frozen snapshots; and the
 * compile-time law is pinned with @ts-expect-error.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createFileJobStore,
  createHarnessPort,
  createManualClock,
  createWorkerRuntime,
} from "../src";
import type { JobStoreReader } from "../src";
import { fiveStepExecutor, removeScratchDir, scratchDir } from "./helpers";

let dir = "";
beforeAll(() => {
  dir = scratchDir("harness");
});
afterAll(() => {
  removeScratchDir(dir);
});

describe("the port surface exposes NO mutating method", () => {
  test("the method inventory is exactly status/plan/cancellation", async () => {
    const store = createFileJobStore(join(dir, "surface.journal.json"), {
      clock: createManualClock(),
    });
    await store.enqueue({ jobId: "job-1", kind: "five-step", input: null });
    const port = createHarnessPort(store);
    expect(Object.keys(port).sort()).toEqual(["cancellation", "plan", "status"]);
  });

  test("every mutating operation is absent from the port", async () => {
    const store = createFileJobStore(join(dir, "absent.journal.json"), {
      clock: createManualClock(),
    });
    await store.enqueue({ jobId: "job-1", kind: "five-step", input: null });
    const port = createHarnessPort(store) as unknown as Record<string, unknown>;
    for (const mutating of [
      "enqueue",
      "acquireLease",
      "start",
      "recordCheckpoint",
      "continueFromCheckpoint",
      "complete",
      "fail",
      "requeueDueRetries",
      "requestCancellation",
      "cancel",
    ]) {
      expect(port[mutating]).toBeUndefined();
    }
  });

  test("the type level refuses the obvious mutation (compile-time, and the runtime absence bites)", async () => {
    const store = createFileJobStore(join(dir, "compile.journal.json"), {
      clock: createManualClock(),
    });
    const port = createHarnessPort(store);
    // @ts-expect-error — HarnessPort has no requestCancellation: a harness
    // cannot even ASK through this port; cancellation requests flow through
    // the application service. If this ever compiles, the invariant broke.
    const ask: () => unknown = () => port.requestCancellation("job-1");
    expect(ask).toThrow(TypeError); // and at runtime the method is absent
    // @ts-expect-error — and no writing of state through any alias.
    const write: () => unknown = () => port.write("job-1", { state: "completed" });
    expect(write).toThrow(TypeError);
  });
});

describe("the port works over a READER-ONLY object (no mutating capability)", () => {
  test("a port built from get+list alone serves every view", async () => {
    const path = join(dir, "reader-only.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "five-step", input: null });
    const worker = createWorkerRuntime({
      store,
      workerId: "w1",
      leaseTtlMs: 500,
      executors: [fiveStepExecutor()],
    });
    const done = await worker.runAttempt("job-1");
    expect(done.state).toBe("completed");

    // The reader seam: ONLY get + list — no mutating method exists on it.
    const reader: JobStoreReader = {
      get: (jobId) => store.get(jobId),
      list: (filter) => store.list(filter),
    };
    expect(Object.keys(reader).sort()).toEqual(["get", "list"]);

    const port = createHarnessPort(reader);
    const status = await port.status("job-1");
    expect(status).toMatchObject({
      jobId: "job-1",
      kind: "five-step",
      state: "completed",
      attempts: 1,
      checkpointCount: 5,
      leaseOwner: null,
      cancellationRequested: false,
    });
    const plan = await port.plan("job-1");
    expect(plan.checkpoints.map((checkpoint) => checkpoint.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.resumeFrom).toEqual({
      seq: 5,
      state: { completedSteps: ["s1", "s2", "s3", "s4", "s5"] },
    });
    expect(plan.outputArtifactRefs).toEqual(["artifact://five-step/result"]);
    const cancellation = await port.cancellation("job-1");
    expect(cancellation).toEqual({
      jobId: "job-1",
      state: "completed",
      cancellationRequested: false,
      cancelled: false,
    });
  });
});

describe("the views are frozen snapshots (display data, never authority)", () => {
  test("mutating a view is impossible and never touches the store", async () => {
    const path = join(dir, "snapshots.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "five-step", input: null });
    const worker = createWorkerRuntime({
      store,
      workerId: "w1",
      leaseTtlMs: 500,
      executors: [fiveStepExecutor()],
    });
    await worker.runAttempt("job-1");

    const port = createHarnessPort(store);
    const status = await port.status("job-1");
    expect(Object.isFrozen(status)).toBe(true);
    expect(() => {
      (status as unknown as { state: string }).state = "failed";
    }).toThrow();
    expect((await store.get("job-1")).state).toBe("completed"); // untouched

    const plan = await port.plan("job-1");
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.checkpoints)).toBe(true);
  });

  test("a cancelled job displays its cancellation state (read-only)", async () => {
    const path = join(dir, "cancelled-display.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "five-step", input: null });
    await store.requestCancellation("job-1");

    const port = createHarnessPort(store);
    const cancellation = await port.cancellation("job-1");
    expect(cancellation.cancelled).toBe(true);
    expect(cancellation.state).toBe("cancelled");
    const status = await port.status("job-1");
    expect(status.state).toBe("cancelled");
    expect(status.cancellationRequested).toBe(false); // honoured, not pending
  });

  test("an unknown job surfaces the typed not-found through the reader", async () => {
    const store = createFileJobStore(join(dir, "notfound.journal.json"), {
      clock: createManualClock(),
    });
    const port = createHarnessPort(store);
    await expect(port.status("job-404")).rejects.toMatchObject({ code: "jobs.not-found" });
  });
});
