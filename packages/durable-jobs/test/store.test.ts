/**
 * REL-012 store tests: persistence round-trips, the append-only journal
 * (events never rewritten or removed), atomic-write crash safety
 * (interrupted write -> last-good reload), corruption refusal, frozen
 * records and boundary validation.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  JobsConflictError,
  JobsStoreError,
  JobsValidationError,
  JOURNAL_FORMAT,
  createFileJobStore,
  createManualClock,
  parseJournal,
  serializeJournal,
} from "../src";
import type { JournalEvent, JournalWriter } from "../src";
import { removeScratchDir, scratchDir } from "./helpers";

let dir = "";
beforeAll(() => {
  dir = scratchDir("store");
});
afterAll(() => {
  removeScratchDir(dir);
});

describe("persistence round-trip", () => {
  test("a fresh store over the same file rebuilds the identical record (the fold)", async () => {
    const path = join(dir, "roundtrip.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: { n: 1 } });
    await store.acquireLease("job-1", "w1", 500);
    await store.start("job-1", "w1");
    await store.recordCheckpoint("job-1", "w1", { done: ["a"] });
    await store.continueFromCheckpoint("job-1", "w1");
    await store.complete("job-1", "w1", ["artifact://done"]);

    const reloaded = createFileJobStore(path, { clock });
    const before = await store.get("job-1");
    const after = await reloaded.get("job-1");
    expect(after).toEqual(before); // the fold reproduces the record exactly
    expect(after.state).toBe("completed");
    expect(after.checkpoints[0]?.state).toEqual({ done: ["a"] });
  });

  test("records handed out are deeply frozen", async () => {
    const path = join(dir, "frozen.journal.json");
    const store = createFileJobStore(path, { clock: createManualClock() });
    const record = await store.enqueue({ jobId: "job-1", kind: "noop", input: { a: [1, 2] } });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.inputArtifactRefs)).toBe(true);
    expect(() => {
      (record as unknown as { state: string }).state = "completed";
    }).toThrow();
  });
});

describe("the append-only journal", () => {
  test("events only grow — new writes keep the old events as an exact prefix", async () => {
    const path = join(dir, "append-only.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: null });
    await store.acquireLease("job-1", "w1", 500);

    const eventsAfterTwoOps: readonly JournalEvent[] = parseJournal(
      readFileSync(path, "utf8"),
    ).events;

    await store.start("job-1", "w1");
    await store.recordCheckpoint("job-1", "w1", { done: [] });
    await store.complete("job-1", "w1");

    const eventsAfterFiveOps: readonly JournalEvent[] = parseJournal(
      readFileSync(path, "utf8"),
    ).events;
    expect(eventsAfterFiveOps.length).toBeGreaterThan(eventsAfterTwoOps.length);
    expect(eventsAfterFiveOps.slice(0, eventsAfterTwoOps.length)).toEqual([...eventsAfterTwoOps]);

    // The in-memory journal view matches the file.
    expect(await store.readJournal()).toEqual(eventsAfterFiveOps);

    // Sequence numbers are dense and monotonic from 1.
    expect(eventsAfterFiveOps.map((event) => event.seq)).toEqual(
      eventsAfterFiveOps.map((_, index) => index + 1),
    );
  });

  test("the journal file carries the format envelope", async () => {
    const path = join(dir, "envelope.journal.json");
    const store = createFileJobStore(path, { clock: createManualClock() });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: null });
    const envelope = parseJournal(readFileSync(path, "utf8"));
    expect(envelope.format).toBe(JOURNAL_FORMAT);
    expect(envelope.events).toHaveLength(1);
    expect(envelope.events[0]?.type).toBe("enqueued");
  });

  test("serializeJournal/parseJournal round-trip", () => {
    const events: JournalEvent[] = [{ seq: 1, at: 1, type: "enqueued", record: {} as never }];
    expect(parseJournal(serializeJournal(events))).toEqual({ format: JOURNAL_FORMAT, events });
  });
});

describe("atomic-write crash safety (interrupted write -> last-good)", () => {
  test("a write that dies before the rename poisons the store; a fresh store loads the LAST GOOD state", async () => {
    const path = join(dir, "crash.journal.json");
    const clock = createManualClock(10_000);

    // Two committed operations.
    const good = createFileJobStore(path, { clock });
    await good.enqueue({ jobId: "job-1", kind: "noop", input: null });
    await good.acquireLease("job-1", "w1", 500);
    const lastGood = await good.get("job-1");

    // The crash: the temp file is written, the rename NEVER happens (the
    // process died), the store's persist throws.
    const crashingWriter: JournalWriter = (target, data) => {
      writeFileSync(`${target}.tmp-crashed`, data, "utf8");
      throw new Error("simulated crash: died before the rename");
    };
    const crashing = createFileJobStore(path, { clock, writer: crashingWriter });
    await expect(crashing.start("job-1", "w1")).rejects.toMatchObject({
      code: "jobs.store-write-failed",
      failureClass: "store",
    });

    // The poisoned store refuses everything further (honest: memory may
    // no longer match disk).
    await expect(crashing.get("job-1")).rejects.toMatchObject({ code: "jobs.store-poisoned" });

    // The reload: the main file was never torn — the last committed state.
    const reloaded = createFileJobStore(path, { clock });
    const afterCrash = await reloaded.get("job-1");
    expect(afterCrash).toEqual(lastGood); // the start never landed

    // And the stray temp file (written but never renamed) is ignored: the
    // loader reads only the main journal path.
    const reloadedAgain = createFileJobStore(path, { clock });
    expect(await reloadedAgain.get("job-1")).toEqual(lastGood);

    // The reloaded store can CONTINUE from the last-good state.
    await reloaded.start("job-1", "w1");
    expect((await reloaded.get("job-1")).state).toBe("running");
  });
});

describe("corruption refusal (fail closed)", () => {
  test("a garbage journal file refuses a typed read error", () => {
    const path = join(dir, "garbage.journal.json");
    writeFileSync(path, "{ this is not json", "utf8");
    expect(() => createFileJobStore(path, { clock: createManualClock() })).toThrow(JobsStoreError);
  });

  test("a wrong-format envelope refuses too", () => {
    const path = join(dir, "wrong-format.journal.json");
    writeFileSync(path, JSON.stringify({ format: "someone-else/v9", events: [] }), "utf8");
    expect(() => createFileJobStore(path, { clock: createManualClock() })).toThrow(JobsStoreError);
  });
});

describe("the enqueue boundary", () => {
  test("missing kind refuses typed validation", async () => {
    const store = createFileJobStore(join(dir, "validation.journal.json"), {
      clock: createManualClock(),
    });
    // @ts-expect-error — the runtime surface is tested against malformed input
    await expect(store.enqueue({ jobId: "job-1", input: null })).rejects.toThrow(
      JobsValidationError,
    );
  });

  test("a malformed retry policy refuses (factor < 1, ceiling under floor, maxAttempts 0)", async () => {
    const store = createFileJobStore(join(dir, "policy.journal.json"), {
      clock: createManualClock(),
    });
    await expect(
      store.enqueue({
        kind: "noop",
        input: null,
        retryPolicy: {
          maxAttempts: 1,
          initialBackoffMs: 10,
          backoffFactor: 0.5,
          maxBackoffMs: 100,
        },
      }),
    ).rejects.toThrow(JobsValidationError);
    await expect(
      store.enqueue({
        kind: "noop",
        input: null,
        retryPolicy: { maxAttempts: 1, initialBackoffMs: 200, backoffFactor: 2, maxBackoffMs: 100 },
      }),
    ).rejects.toThrow(JobsValidationError);
    await expect(
      store.enqueue({
        kind: "noop",
        input: null,
        retryPolicy: { maxAttempts: 0, initialBackoffMs: 10, backoffFactor: 2, maxBackoffMs: 100 },
      }),
    ).rejects.toThrow(JobsValidationError);
  });

  test("a duplicate jobId refuses typed conflict", async () => {
    const store = createFileJobStore(join(dir, "duplicate.journal.json"), {
      clock: createManualClock(),
    });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: null });
    await expect(store.enqueue({ jobId: "job-1", kind: "noop", input: null })).rejects.toThrow(
      JobsConflictError,
    );
  });

  test("a non-JSON-safe input refuses (what is on disk is what is replayed)", async () => {
    const store = createFileJobStore(join(dir, "jsonsafe.journal.json"), {
      clock: createManualClock(),
    });
    const fn = () => undefined;
    await expect(store.enqueue({ kind: "noop", input: fn })).rejects.toThrow(JobsValidationError);
  });

  test("listing filters by state and kind; unknown jobs refuse not-found", async () => {
    const store = createFileJobStore(join(dir, "list.journal.json"), {
      clock: createManualClock(),
    });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: null });
    await store.enqueue({ jobId: "job-2", kind: "batch", input: null });
    expect((await store.list()).map((record) => record.jobId)).toEqual(["job-1", "job-2"]);
    expect((await store.list({ kind: "batch" })).map((record) => record.jobId)).toEqual(["job-2"]);
    expect((await store.list({ state: "queued" })).map((record) => record.jobId)).toEqual([
      "job-1",
      "job-2",
    ]);
    await expect(store.get("job-404")).rejects.toMatchObject({ code: "jobs.not-found" });
  });
});
