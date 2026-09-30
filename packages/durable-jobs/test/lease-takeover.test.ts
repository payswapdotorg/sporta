/**
 * REL-012 lease tests: acquisition, the live-lease refusal, expiry
 * takeover (from leased, running and checkpointed), and the lease law —
 * an expired owner's writes are refused, typed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { JobsLeaseError, createFileJobStore, createManualClock } from "../src";
import { removeScratchDir, scratchDir } from "./helpers";

let dir = "";
beforeAll(() => {
  dir = scratchDir("lease");
});
afterAll(() => {
  removeScratchDir(dir);
});

describe("lease acquisition", () => {
  test("a queued job leases to the acquiring worker with an expiry", async () => {
    const path = join(dir, "acquire.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: null });

    const leased = await store.acquireLease("job-1", "w1", 500);
    expect(leased.state).toBe("leased");
    expect(leased.lease).toEqual({ owner: "w1", acquiredAt: 10_000, expiresAt: 10_500 });
  });

  test("the same worker re-acquiring its own live lease is idempotent", async () => {
    const path = join(dir, "idem.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: null });
    const first = await store.acquireLease("job-1", "w1", 500);
    const again = await store.acquireLease("job-1", "w1", 500);
    expect(again).toEqual(first); // no second event, no lease churn
    expect((await store.readJournal()).filter((event) => event.type === "patched")).toHaveLength(1);
  });

  test("another worker is refused while the lease is live (typed, fail closed)", async () => {
    const path = join(dir, "held.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: null });
    await store.acquireLease("job-1", "w1", 500);

    let caught: unknown;
    try {
      await store.acquireLease("job-1", "w2", 500);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JobsLeaseError);
    expect((caught as JobsLeaseError).code).toBe("jobs.lease-held");
    expect((caught as JobsLeaseError).details.owner).toBe("w1");
  });
});

describe("lease-expiry takeover", () => {
  test("another worker takes over a leased job after expiry (the interrupted attempt continues)", async () => {
    const path = join(dir, "takeover-leased.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: null });
    await store.acquireLease("job-1", "w1", 500);

    clock.advance(501);
    const takenOver = await store.acquireLease("job-1", "w2", 500);
    expect(takenOver.state).toBe("leased");
    expect(takenOver.lease?.owner).toBe("w2");
    expect(takenOver.lease?.expiresAt).toBe(11_001);

    // The journal records the takeover as its two edges.
    const ops = (await store.readJournal())
      .filter((event) => event.type === "patched")
      .map((event) => (event.type === "patched" ? event.op : ""));
    expect(ops).toEqual(["acquire", "requeue-takeover", "acquire"]);
  });

  test("the expired previous owner's writes are refused (lease-expired, typed)", async () => {
    const path = join(dir, "expired-writes.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: null });
    await store.acquireLease("job-1", "w1", 500);
    await store.start("job-1", "w1");

    clock.advance(501);
    // No takeover yet: the record still carries w1's (now expired) lease.
    await expect(store.recordCheckpoint("job-1", "w1", { step: 1 })).rejects.toMatchObject({
      code: "jobs.lease-expired",
      failureClass: "lease",
    });
    await expect(store.complete("job-1", "w1")).rejects.toMatchObject({
      code: "jobs.lease-expired",
    });
    expect((await store.get("job-1")).state).toBe("running");
  });

  test("the expired owner is refused after a takeover too (lease-not-held)", async () => {
    const path = join(dir, "not-held.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: null });
    await store.acquireLease("job-1", "w1", 500);

    clock.advance(501);
    await store.acquireLease("job-1", "w2", 500);
    await expect(store.start("job-1", "w1")).rejects.toMatchObject({ code: "jobs.lease-not-held" });
  });

  test("takeover from a checkpointed job preserves the checkpoints", async () => {
    const path = join(dir, "takeover-checkpointed.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: null });
    await store.acquireLease("job-1", "w1", 500);
    await store.start("job-1", "w1");
    await store.recordCheckpoint("job-1", "w1", { done: ["a", "b"] });
    expect((await store.get("job-1")).state).toBe("checkpointed");

    clock.advance(501);
    const takenOver = await store.acquireLease("job-1", "w3", 500);
    expect(takenOver.state).toBe("leased");
    expect(takenOver.checkpoints).toHaveLength(1);
    expect(takenOver.checkpoints[0]?.state).toEqual({ done: ["a", "b"] });
    expect(takenOver.attempts).toBe(1);
  });

  test("acquiring a failed job directly is refused (requeue only through the retry)", async () => {
    const path = join(dir, "acquire-failed.journal.json");
    const clock = createManualClock(10_000);
    const store = createFileJobStore(path, { clock });
    await store.enqueue({ jobId: "job-1", kind: "noop", input: null });
    await store.acquireLease("job-1", "w1", 500);
    await store.start("job-1", "w1");
    await store.fail("job-1", "w1", "boom");

    await expect(store.acquireLease("job-1", "w2", 500)).rejects.toMatchObject({
      code: "jobs.illegal-transition",
    });
  });
});
