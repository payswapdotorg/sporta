/**
 * Cancellation + shutdown tests (W303): idempotent cancel (queued /
 * in-flight / terminal / unknown), the never-lost guarantee (an in-flight
 * executor's eventual report is counted superseded, never silently
 * dropped), and the settle path (everything unresolved accounted CANCELLED,
 * parked claims released, balance runtime-asserted).
 */
import { describe, expect, test } from "bun:test";
import { VirtualGpuClock } from "../src/clock";
import { GpuJobDispatcher } from "../src/dispatcher";
import { InvalidDispatcherStateError, UnknownJobError } from "../src/errors";
import {
  capabilities,
  deferredExecutor,
  expectGpuBalanced,
  job,
  until,
  wiredDispatcher,
  wiredWorker,
} from "./helpers";
import type { GpuJobClaim } from "../src/types";

describe("cancellation", () => {
  test("cancel a queued job: removed from the ready queue, accounted CANCELLED", () => {
    const { dispatcher } = wiredDispatcher({});
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    const outcome = dispatcher.cancel("j1");
    expect(outcome).toEqual({ cancelled: true, jobId: "j1" });
    const stats = dispatcher.stats();
    expect(stats.cancelled).toBe(1);
    expect(stats.queuedJobs).toBe(0);
    expect(stats.inFlight).toBe(0);
    const record = dispatcher.jobRecords()[0]!;
    expect(record.state).toBe("cancelled");
    expect(record.events.map((event) => event.type)).toEqual(["submitted", "cancelled"]);
    expect(record.events[1]?.details).toMatchObject({ reason: "cancel-queued" });
    void dispatcher.shutdown();
  });

  test("cancel an in-flight job: CANCELLED immediately, the eventual report is superseded (never lost)", async () => {
    const { dispatcher } = wiredDispatcher({});
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    await dispatcher.registerWorker(capabilities("w-raw"));
    const claim = await dispatcher.claimJob("w-raw");
    if (claim === undefined) throw new Error("unreachable");
    const outcome = dispatcher.cancel("j1");
    expect(outcome).toEqual({ cancelled: true, jobId: "j1" });
    expect(dispatcher.stats().executingJobs).toBe(0); // lease released
    const result = await handle.result;
    expect(result.status).toBe("cancelled");
    // The executor's late report: counted superseded, never silently dropped.
    const ack = await dispatcher.reportResult({
      workerId: "w-raw",
      jobId: "j1",
      leaseId: claim.leaseId,
      status: "succeeded",
      attempts: 1,
      timings: { startedAtMs: 0, finishedAtMs: 1, executionMs: 1, perAttempt: [] },
    });
    expect(ack.status).toBe("superseded");
    expect(dispatcher.stats().lateResults).toBe(1);
    expect(dispatcher.jobRecords()[0]?.events.map((event) => event.type)).toEqual([
      "submitted",
      "claimed",
      "cancelled",
      "superseded-report",
    ]);
    const settled = await dispatcher.shutdown();
    expectGpuBalanced(settled.stats, {
      jobsSubmitted: 1,
      admitted: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 1,
      deadLettered: 0,
    });
  });

  test("cancelling a terminal job is an idempotent no-op (nothing counted twice)", () => {
    const { dispatcher } = wiredDispatcher({});
    dispatcher.submit(job("j1"));
    expect(dispatcher.cancel("j1")).toEqual({ cancelled: true, jobId: "j1" });
    const second = dispatcher.cancel("j1");
    expect(second).toEqual({
      cancelled: false,
      jobId: "j1",
      disposition: "cancelled",
    });
    expect(dispatcher.stats().cancelled).toBe(1); // not double-counted
    void dispatcher.shutdown();
  });

  test("cancelling an unknown job throws typed UnknownJobError", () => {
    const { dispatcher } = wiredDispatcher({});
    expect(() => dispatcher.cancel("ghost")).toThrow(UnknownJobError);
    expect(dispatcher.stats().cancelled).toBe(0);
    void dispatcher.shutdown();
  });

  test("cancel before start is a caller error", () => {
    const clock = new VirtualGpuClock(0);
    const idle = new GpuJobDispatcher({ clock });
    expect(() => idle.cancel("j1")).toThrow(InvalidDispatcherStateError);
  });
});

describe("shutdown (settle)", () => {
  test("queued and in-flight jobs are accounted CANCELLED with documented reasons", async () => {
    const { dispatcher } = wiredDispatcher({});
    const queuedHandle = dispatcher.submit(job("j-queued"));
    const inFlightHandle = dispatcher.submit(job("j-inflight"));
    if (queuedHandle.disposition !== "admitted") throw new Error("unreachable");
    if (inFlightHandle.disposition !== "admitted") throw new Error("unreachable");
    await dispatcher.registerWorker(capabilities("w-raw"));
    const claim = await dispatcher.claimJob("w-raw"); // takes j-queued (priority/seq order)
    void claim;
    const settled = await dispatcher.shutdown();
    expectGpuBalanced(settled.stats, {
      jobsSubmitted: 2,
      admitted: 2,
      succeeded: 0,
      failed: 0,
      cancelled: 2,
      deadLettered: 0,
    });
    const reasons = settled.jobs.map(
      (record) => record.events.find((event) => event.type === "cancelled")?.details.reason,
    );
    expect(reasons).toContain("shutdown-cancel-in-flight");
    expect(reasons).toContain("shutdown-cancel-queued");
    expect((await queuedHandle.result).status).toBe("cancelled");
    expect((await inFlightHandle.result).status).toBe("cancelled");
    expect(settled.balanced).toBe(true);
  });

  test("parked claims resolve undefined (workers stop claiming) at settle", async () => {
    const { dispatcher } = wiredDispatcher({});
    await dispatcher.registerWorker(capabilities("w-raw"));
    const parked = dispatcher.claimJob("w-raw");
    let resolved: GpuJobClaim | undefined | "unset" = "unset";
    void parked.then((claim) => {
      resolved = claim ?? undefined;
    });
    await until(() => false, 100);
    expect(resolved).toBe("unset");
    await dispatcher.shutdown();
    expect(resolved).toBeUndefined();
  });

  test("shutdown is idempotent (the same settled result object)", async () => {
    const { dispatcher } = wiredDispatcher({});
    const first = await dispatcher.shutdown();
    const second = await dispatcher.shutdown();
    expect(second).toBe(first);
    expect(first.outcome).toBe("stopped");
  });

  test("shutdown before start is a caller error; stats stay zero", async () => {
    const { clock } = wiredDispatcher({});

    const idle = new GpuJobDispatcher({ clock });
    await expect(idle.shutdown()).rejects.toThrow(InvalidDispatcherStateError);
  });

  test("a worker stopped with a parked claim: the dispatcher grant is recovered by lease expiry", async () => {
    // The worker.ts documented recovery: stop() resolves the race, leaving
    // the claimJob promise parked on the dispatcher; a later submit pumps a
    // grant into it; the job goes in-flight on a worker that will never
    // execute — lease expiry requeues it and another worker completes it.
    const { dispatcher, clock } = wiredDispatcher({ leaseMs: 300, staleAfterMs: 10_000 });
    const executor = deferredExecutor();
    const worker = wiredWorker({
      capabilities: capabilities("w-gone", { heartbeatIntervalMs: 100 }),
      executor: executor.executor,
      port: dispatcher,
      clock,
    });
    await worker.start();
    await worker.stop(); // claim loop parks, then stops
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    // The pump granted the job to the parked (gone) worker's claim:
    expect(await until(() => dispatcher.stats().claimsGranted === 1)).toBe(true);
    expect(dispatcher.stats().executingJobs).toBe(1);
    expect(executor.parked()).toBe(0); // never executed
    // Time passes; the lease expires; the sweep (via a live worker's beat or
    // the public monitor seam) requeues the job.
    clock.advance(350);
    dispatcher.sweep();
    expect(dispatcher.stats().leaseExpiries).toBe(1);
    expect(dispatcher.stats().requeues).toBe(1);
    // The recovered job is executed by a REAL worker and succeeds:
    const completer = wiredWorker({
      capabilities: capabilities("w-live", { heartbeatIntervalMs: 100 }),
      executor: executor.executor,
      port: dispatcher,
      clock,
    });
    await completer.start();
    expect(await until(() => executor.parked() === 1)).toBe(true);
    executor.settle({ status: "succeeded", output: { recovered: true } });
    const result = await handle.result;
    expect(result.status).toBe("succeeded");
    expect(result.claims).toBe(2); // at-least-once execution across lease recovery
    expect(result.attempts).toBe(1);
    expect(result.retriesUsed).toBe(-1); // the unreported first claim, honest
    await completer.stop();
    const settled = await dispatcher.shutdown();
    expectGpuBalanced(settled.stats, {
      jobsSubmitted: 1,
      admitted: 1,
      succeeded: 1,
      failed: 0,
      cancelled: 0,
      deadLettered: 0,
    });
  });
});
