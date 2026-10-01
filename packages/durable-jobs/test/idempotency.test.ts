/**
 * REL-029 — IDEMPOTENCY KEYS: duplicate submissions converge to one job;
 * the keys HOLD (including across restart, through completion, and under
 * concurrent retry storms). The store's law (src/store.ts):
 * - same key + same payload -> the SAME record (convergence — the storm
 *   collapses onto the one job; the journal shows exactly one `enqueued`
 *   event for the key);
 * - same key + different payload -> typed `jobs.conflict` (a mutation is
 *   never silently re-run);
 * - the key + digest map is REBUILT by the journal fold, so a fresh store
 *   over the same file converges and conflicts exactly like the writer.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  JobsConflictError,
  createFileJobStore,
  createManualClock,
  createWorkerRuntime,
  isJobsError,
} from "../src";
import type { JobExecutor } from "../src";
import { fiveStepExecutor, removeScratchDir, scratchDir } from "./helpers";

let dir = "";
beforeAll(() => {
  dir = scratchDir("idempotency");
});
afterAll(() => {
  removeScratchDir(dir);
});

/** A trivial executor that completes immediately. */
const immediate: JobExecutor = {
  kind: "immediate",
  codeVersion: "immediate/v1",
  async execute() {
    return ["artifact://immediate/result"];
  },
};

describe("duplicate submissions converge to the one job", () => {
  test("the same key + the same payload returns the SAME record, one enqueued event", async () => {
    const path = join(dir, "converge.journal.json");
    const store = createFileJobStore(path, { clock: createManualClock(10_000) });
    const payload = { kind: "immediate", input: { storm: "yes" }, idempotencyKey: "storm-1" };

    const first = await store.enqueue(payload);
    const second = await store.enqueue({ ...payload });
    const third = await store.enqueue({ ...payload }); // the storm's third retry

    expect(second.jobId).toBe(first.jobId);
    expect(third.jobId).toBe(first.jobId);
    expect(third).toEqual(first); // the converged record, verbatim

    // The storm collapsed: exactly ONE enqueued event in the journal.
    const events = await store.readJournal();
    expect(events.filter((event) => event.type === "enqueued")).toHaveLength(1);
    // And the key query finds the one job.
    expect((await store.getByIdempotencyKey("storm-1"))?.jobId).toBe(first.jobId);
    expect(await store.getByIdempotencyKey("never-used")).toBeNull();
  });

  test("the same key + a DIFFERENT payload is a typed conflict (never silently re-run)", async () => {
    const path = join(dir, "conflict.journal.json");
    const store = createFileJobStore(path, { clock: createManualClock(10_000) });
    await store.enqueue({ kind: "immediate", input: { storm: "yes" }, idempotencyKey: "storm-2" });

    let caught: unknown;
    try {
      await store.enqueue({ kind: "immediate", input: { storm: "NO" }, idempotencyKey: "storm-2" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JobsConflictError);
    const typed = caught as JobsConflictError;
    expect(typed.code).toBe("jobs.conflict");
    expect(typed.failureClass).toBe("conflict");
    expect(isJobsError(typed)).toBe(true);
    // Fail-closed: the original job is untouched and still the only one.
    expect((await store.list()).map((record) => record.jobId)).toEqual(["job-1"]);
    expect((await store.getByIdempotencyKey("storm-2"))?.input).toEqual({ storm: "yes" });
  });

  test("a key used with a different KIND or policy is also a conflict", async () => {
    const path = join(dir, "conflict-kind.journal.json");
    const store = createFileJobStore(path, { clock: createManualClock(10_000) });
    await store.enqueue({ kind: "immediate", input: null, idempotencyKey: "storm-3" });
    await expect(
      store.enqueue({ kind: "five-step", input: null, idempotencyKey: "storm-3" }),
    ).rejects.toMatchObject({ code: "jobs.conflict" });
    await expect(
      store.enqueue({
        kind: "immediate",
        input: null,
        idempotencyKey: "storm-3",
        retryPolicy: { maxAttempts: 9, initialBackoffMs: 1, backoffFactor: 1, maxBackoffMs: 1 },
      }),
    ).rejects.toMatchObject({ code: "jobs.conflict" });
  });

  test("different keys over the same payload create distinct jobs (no accidental merge)", async () => {
    const path = join(dir, "distinct.journal.json");
    const store = createFileJobStore(path, { clock: createManualClock(10_000) });
    const a = await store.enqueue({ kind: "immediate", input: { x: 1 }, idempotencyKey: "key-a" });
    const b = await store.enqueue({ kind: "immediate", input: { x: 1 }, idempotencyKey: "key-b" });
    const keyless = await store.enqueue({ kind: "immediate", input: { x: 1 } });
    expect(new Set([a.jobId, b.jobId, keyless.jobId]).size).toBe(3);
    expect(a.idempotencyKey).toBe("key-a");
    expect(keyless.idempotencyKey).toBeNull();
  });
});

describe("retry storms under concurrency", () => {
  test("8 simultaneous duplicate submissions all converge; exactly one job, one execution, one completion", async () => {
    const path = join(dir, "storm.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    const payload = { kind: "five-step", input: { storm: 8 }, idempotencyKey: "storm-8" };

    // The storm: 8 concurrent duplicate submissions.
    const submissions = await Promise.all(
      Array.from({ length: 8 }, () => store.enqueue({ ...payload })),
    );
    expect(new Set(submissions.map((record) => record.jobId)).size).toBe(1);
    // Plus one rogue submission with the same key but a different payload:
    // it must refuse typed even under concurrency.
    const rogue = store
      .enqueue({ kind: "five-step", input: { storm: 9 }, idempotencyKey: "storm-8" })
      .then(
        () => "unexpectedly-enqueued",
        (error: unknown) => (error as { code: string }).code,
      );
    expect(await rogue).toBe("jobs.conflict");

    // ONE execution, ONE authoritative completion.
    const worker = createWorkerRuntime({
      store,
      workerId: "w1",
      leaseTtlMs: 5_000,
      executors: [fiveStepExecutor(), immediate],
    });
    const done = await worker.runAttempt(submissions[0]!.jobId);
    expect(done.state).toBe("completed");
    expect(done.outputArtifactRefs).toEqual(["artifact://five-step/result"]);

    const events = await store.readJournal();
    expect(events.filter((event) => event.type === "enqueued")).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "patched" && event.op === "complete"),
    ).toHaveLength(1);
  });
});

describe("the keys HOLD across restart and completion", () => {
  test("a fresh store folded from the same journal still converges and conflicts", async () => {
    const path = join(dir, "restart.journal.json");
    const clock = createManualClock(10_000);
    const writer = createFileJobStore(path, { clock });
    await writer.enqueue({ kind: "immediate", input: { hold: true }, idempotencyKey: "hold-1" });

    // "Process restart": a brand-new store over the same journal file.
    const reloaded = createFileJobStore(path, { clock });
    const converged = await reloaded.enqueue({
      kind: "immediate",
      input: { hold: true },
      idempotencyKey: "hold-1",
    });
    expect(converged.jobId).toBe("job-1");
    expect((await reloaded.getByIdempotencyKey("hold-1"))?.jobId).toBe("job-1");
    // And the conflict still refuses typed after the reload.
    await expect(
      reloaded.enqueue({ kind: "immediate", input: { hold: false }, idempotencyKey: "hold-1" }),
    ).rejects.toMatchObject({ code: "jobs.conflict" });
    // No new event was appended by the convergence.
    expect(
      (await reloaded.readJournal()).filter((event) => event.type === "enqueued"),
    ).toHaveLength(1);
  });

  test("a key on a COMPLETED job replays the completed record (no re-run)", async () => {
    const path = join(dir, "completed.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    const enqueued = await store.enqueue({
      kind: "immediate",
      input: null,
      idempotencyKey: "done-1",
    });
    const worker = createWorkerRuntime({
      store,
      workerId: "w1",
      leaseTtlMs: 5_000,
      executors: [immediate],
    });
    await worker.runAttempt(enqueued.jobId);

    // The late duplicate replays the COMPLETED record — idempotent replay,
    // never a second execution.
    const replay = await store.enqueue({
      kind: "immediate",
      input: null,
      idempotencyKey: "done-1",
    });
    expect(replay.state).toBe("completed");
    expect(replay.outputArtifactRefs).toEqual(["artifact://immediate/result"]);
    const events = await store.readJournal();
    expect(
      events.filter((event) => event.type === "patched" && event.op === "complete"),
    ).toHaveLength(1);
    // And after a restart the replay behaves identically.
    const reloaded = createFileJobStore(path, { clock });
    const replayAfterRestart = await reloaded.enqueue({
      kind: "immediate",
      input: null,
      idempotencyKey: "done-1",
    });
    expect(replayAfterRestart.state).toBe("completed");
  });
});
