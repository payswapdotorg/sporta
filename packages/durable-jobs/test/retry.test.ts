/**
 * REL-012 retry tests: bounded-backoff retries — the growing backoff, the
 * exact retryAt arithmetic on the injected clock, the requeue timing gate,
 * and the exhaustion bar (a terminal failure never requeues).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  DEFAULT_RETRY_POLICY,
  createFileJobStore,
  createManualClock,
  createWorkerRuntime,
} from "../src";
import type { JobExecutor } from "../src/runtime";
import { removeScratchDir, scratchDir } from "./helpers";

let dir = "";
beforeAll(() => {
  dir = scratchDir("retry");
});
afterAll(() => {
  removeScratchDir(dir);
});

/** Fails until the attempt number reaches succeedAtAttempt, then completes. */
function flakyExecutor(succeedAtAttempt: number): JobExecutor {
  return {
    kind: "flaky",
    async execute(ctx) {
      if (ctx.job.attempts < succeedAtAttempt) {
        throw new Error(`boom on attempt ${ctx.job.attempts}`);
      }
      return [`artifact://flaky/attempt-${ctx.job.attempts}`];
    },
  };
}

describe("bounded-backoff retries (the full cycle)", () => {
  test("fail -> backoff -> requeue -> retry succeeds on attempt 3 with growing backoff", async () => {
    const path = join(dir, "flaky.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({
      jobId: "job-1",
      kind: "flaky",
      input: null,
      retryPolicy: { maxAttempts: 3, initialBackoffMs: 100, backoffFactor: 2, maxBackoffMs: 400 },
    });
    const worker = createWorkerRuntime({
      store,
      workerId: "w1",
      leaseTtlMs: 500,
      executors: [flakyExecutor(3)],
    });

    // Attempt 1: fails; retryAt = failure time + backoff(1) = 10_000 + 100.
    const failed1 = await worker.runAttempt("job-1");
    expect(failed1.state).toBe("failed");
    expect(failed1.attempts).toBe(1);
    expect(failed1.failure).toMatchObject({ message: "boom on attempt 1", attempt: 1 });
    expect(failed1.retryAt).toBe(10_100);
    expect(failed1.retryAt! - failed1.failure!.at).toBe(100);

    // Not due yet: 99ms is not 100ms.
    clock.advance(99);
    expect(await worker.requeueDueRetries()).toEqual([]);

    // Due exactly at retryAt.
    clock.advance(1);
    const requeued = await worker.requeueDueRetries();
    expect(requeued.map((record) => record.state)).toEqual(["queued"]);
    expect((await store.get("job-1")).retryAt).toBeNull();

    // Attempt 2: fails again; backoff doubles (failure time 10_100 + 200).
    const failed2 = await worker.runAttempt("job-1");
    expect(failed2.state).toBe("failed");
    expect(failed2.attempts).toBe(2);
    expect(failed2.retryAt).toBe(10_300);
    expect(failed2.retryAt! - failed2.failure!.at).toBe(200);

    clock.advance(200);
    expect(await worker.requeueDueRetries()).toHaveLength(1);

    // Attempt 3: succeeds — the retry budget was spent exactly to the bar.
    const done = await worker.runAttempt("job-1");
    expect(done.state).toBe("completed");
    expect(done.attempts).toBe(3);
    expect(done.failure).toBeNull();
    expect(done.outputArtifactRefs).toEqual(["artifact://flaky/attempt-3"]);
  });
});

describe("retry exhaustion (the bound)", () => {
  test("a job that always fails stays failed after the budget — requeueDueRetries never fires again", async () => {
    const path = join(dir, "exhausted.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({
      jobId: "job-1",
      kind: "flaky",
      input: null,
      retryPolicy: { maxAttempts: 2, initialBackoffMs: 50, backoffFactor: 2, maxBackoffMs: 400 },
    });
    const worker = createWorkerRuntime({
      store,
      workerId: "w1",
      leaseTtlMs: 500,
      executors: [flakyExecutor(99)], // never succeeds within the budget
    });

    const failed1 = await worker.runAttempt("job-1");
    expect(failed1.state).toBe("failed");
    expect(failed1.attempts).toBe(1);
    expect(failed1.retryAt).toBe(10_050); // requeue is scheduled...

    clock.advance(50);
    await worker.requeueDueRetries();
    const failed2 = await worker.runAttempt("job-1");
    expect(failed2.state).toBe("failed");
    expect(failed2.attempts).toBe(2);
    // ...but the SECOND failure is terminal: attempts(2) is not < maxAttempts(2).
    expect(failed2.retryAt).toBeNull();

    clock.advance(1_000_000);
    expect(await worker.requeueDueRetries()).toEqual([]);
    expect((await store.get("job-1")).state).toBe("failed");
  });
});

describe("the retry policy defaults and math", () => {
  test("the repo default policy is pinned", () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({
      maxAttempts: 3,
      initialBackoffMs: 1_000,
      backoffFactor: 2,
      maxBackoffMs: 30_000,
    });
  });

  test("enqueue applies the default policy when none is given", async () => {
    const path = join(dir, "default-policy.journal.json");
    const store = createFileJobStore(path, { clock: createManualClock() });
    const record = await store.enqueue({ jobId: "job-1", kind: "noop", input: null });
    expect(record.retryPolicy).toEqual(DEFAULT_RETRY_POLICY);
    expect(record.inputArtifactRefs).toEqual([]);
  });
});
