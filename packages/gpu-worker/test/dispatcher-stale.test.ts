/**
 * Heartbeat + staleness tests (W303): monotone sequences, receipt on the
 * DISPATCHER clock, the missed-heartbeat threshold → stale worker with its
 * in-flight jobs FAILED-LOUD (timeout classification, never silently
 * reassigned), rejoins, and the fail-closed registration validations.
 */
import { describe, expect, test } from "bun:test";
import { GPU_METRIC_NAMES as METRICS } from "../src/types";
import type { GpuHeartbeat, GpuHeartbeatAck } from "../src/types";
import {
  capabilities,
  capturedObservability,
  expectGpuBalanced,
  job,
  scriptedExecutor,
  until,
  wiredDispatcher,
  wiredWorker,
} from "./helpers";

/** Emits one heartbeat (the raw-port heartbeat call). */
async function beat(
  dispatcher: { heartbeat: (id: string, hb: GpuHeartbeat) => Promise<GpuHeartbeatAck> },
  workerId: string,
  sequence: number,
  extras: Partial<GpuHeartbeat> = {},
): Promise<GpuHeartbeatAck> {
  return await dispatcher.heartbeat(workerId, {
    sequence,
    dueMs: 0,
    inFlight: 0,
    advisoryMemoryInUseMb: 0,
    ...extras,
  });
}

describe("heartbeats + staleness", () => {
  test("heartbeats are accepted while monotone and counted", async () => {
    const { dispatcher, clock } = wiredDispatcher({});
    await dispatcher.registerWorker(capabilities("w-1"));
    expect((await beat(dispatcher, "w-1", 1)).accepted).toBe(true);
    expect((await beat(dispatcher, "w-1", 2)).accepted).toBe(true);
    clock.advance(10);
    expect((await beat(dispatcher, "w-1", 5)).accepted).toBe(true);
    const stats = dispatcher.stats();
    expect(stats.heartbeatsReceived).toBe(3);
    expect(stats.rejectedHeartbeats).toBe(0);
    const worker = dispatcher.workers()[0]!;
    expect(worker.lastSequence).toBe(5);
    expect(worker.lastHeartbeatAtMs).toBe(10); // the DISPATCHER clock reading
    void dispatcher.shutdown();
  });

  test("non-monotone sequences are refused and counted (never silently ignored)", async () => {
    const { dispatcher } = wiredDispatcher({});
    await dispatcher.registerWorker(capabilities("w-1"));
    await beat(dispatcher, "w-1", 3);
    const repeat = await beat(dispatcher, "w-1", 3);
    expect(repeat).toMatchObject({ accepted: false, reason: "sequence-not-monotone" });
    const back = await beat(dispatcher, "w-1", 2);
    expect(back).toMatchObject({ accepted: false, reason: "sequence-not-monotone" });
    const zero = await beat(dispatcher, "w-1", 0);
    expect(zero).toMatchObject({ accepted: false, reason: "sequence-not-monotone" });
    expect(dispatcher.stats().rejectedHeartbeats).toBe(3);
    expect(dispatcher.stats().heartbeatsReceived).toBe(1);
    // The worker recovers with a higher sequence:
    expect((await beat(dispatcher, "w-1", 4)).accepted).toBe(true);
    void dispatcher.shutdown();
  });

  test("heartbeats from unknown workers are refused and counted", async () => {
    const { dispatcher } = wiredDispatcher({});
    const ack = await beat(dispatcher, "ghost", 1);
    expect(ack).toMatchObject({ accepted: false, reason: "unknown-worker" });
    expect(dispatcher.stats().rejectedHeartbeats).toBe(1);
    void dispatcher.shutdown();
  });

  test("heartbeats after the dispatcher ended are refused with the end state", async () => {
    const { dispatcher } = wiredDispatcher({});
    await dispatcher.registerWorker(capabilities("w-1"));
    await dispatcher.shutdown();
    const ack = await beat(dispatcher, "w-1", 1);
    expect(ack).toMatchObject({
      accepted: false,
      reason: "dispatcher-ended",
      dispatcherState: "ended",
    });
    expect(dispatcher.stats().rejectedHeartbeats).toBe(1);
  });

  test("staleness threshold missed-heartbeat → in-flight jobs FAILED LOUD (timeout class)", async () => {
    const { dispatcher, clock } = wiredDispatcher({ leaseMs: 5_000, staleAfterMs: 600 });
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    await dispatcher.registerWorker(capabilities("w-raw"));
    await dispatcher.claimJob("w-raw");
    // No heartbeat from w-raw; time moves past the threshold; the sweep
    // (the public monitor seam) declares it stale.
    clock.advance(601);
    dispatcher.sweep();
    const stats = dispatcher.stats();
    expect(stats.staleWorkers).toBe(1);
    expect(stats.workersActive).toBe(0);
    expect(stats.timeoutsStale).toBe(1);
    expect(stats.failed).toBe(1);
    const result = await handle.result;
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      errorClass: "worker-stale",
      terminal: "timeout",
    });
    expect(result.failure?.message).toContain("never silently reassigned");
    // The job was NOT requeued: failed loud, not reassigned.
    expect(dispatcher.stats().queuedJobs).toBe(0);
    expect(dispatcher.jobRecords()[0]?.events.map((event) => event.type)).toEqual([
      "submitted",
      "claimed",
      "worker-stale",
    ]);
    const settled = await dispatcher.shutdown();
    expectGpuBalanced(settled.stats, {
      jobsSubmitted: 1,
      admitted: 1,
      succeeded: 0,
      failed: 1,
      cancelled: 0,
      deadLettered: 0,
    });
  });

  test("the heartbeat stream IS the monitor: a live worker's beat detects the dead peer", async () => {
    const { dispatcher, clock } = wiredDispatcher({ leaseMs: 5_000, staleAfterMs: 600 });
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    await dispatcher.registerWorker(capabilities("w-dead"));
    await dispatcher.claimJob("w-dead");
    // A LIVE worker (the real agent) parks its first heartbeat deadline at
    // 100; no timers exist anywhere — the beat fires only when time moves.
    const worker = wiredWorker({
      capabilities: capabilities("w-live", { heartbeatIntervalMs: 100 }),
      executor: scriptedExecutor(clock, {}).executor,
      port: dispatcher,
      clock,
    });
    await worker.start();
    // Stepwise advances (the exact-timestamp convention): beat 1 lands at
    // 100 and marks w-live fresh; beat 2 lands at 700 — its entry sweep sees
    // w-dead 700 ms silent (> 600 threshold) and fails the job LOUD, while
    // w-live itself is exactly at the threshold (not stale).
    clock.advance(100);
    expect(await until(() => dispatcher.stats().heartbeatsReceived === 1)).toBe(true);
    clock.advance(600);
    expect(await until(() => dispatcher.stats().staleWorkers === 1)).toBe(true);
    expect(await until(() => dispatcher.stats().failed === 1)).toBe(true);
    expect(dispatcher.stats().heartbeatsReceived).toBe(2); // the monitor beats
    expect((await handle.result).status).toBe("failed");
    expect(worker.stats().heartbeatsEmitted).toBe(2);
    await worker.stop();
    void dispatcher.shutdown();
  });

  test("stale worker rejoin via registerWorker: fresh liveness, old jobs stay failed", async () => {
    const { dispatcher, clock } = wiredDispatcher({ leaseMs: 5_000, staleAfterMs: 600 });
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    await dispatcher.registerWorker(capabilities("w-1"));
    await dispatcher.claimJob("w-1");
    clock.advance(601);
    dispatcher.sweep();
    expect((await handle.result).status).toBe("failed");
    // The SAME id rejoins: a fresh registration, counted as a rejoin.
    await dispatcher.registerWorker(capabilities("w-1"));
    const stats = dispatcher.stats();
    expect(stats.workerRejoins).toBe(1);
    expect(stats.workersRegistered).toBe(1); // one worker id, one registration
    expect(stats.workersActive).toBe(1);
    expect(stats.failed).toBe(1); // the old job is still failed
    // The rejoined worker can claim fresh work.
    const handle2 = dispatcher.submit(job("j2"));
    if (handle2.disposition !== "admitted") throw new Error("unreachable");
    const claim = await dispatcher.claimJob("w-1");
    expect(claim?.job.jobId).toBe("j2");
    void dispatcher.shutdown();
  });

  test("a stale worker revived by a heartbeat is a rejoin (not a resurrection)", async () => {
    const { dispatcher, clock } = wiredDispatcher({ staleAfterMs: 600 });
    await dispatcher.registerWorker(capabilities("w-1", { heartbeatIntervalMs: 100 }));
    await beat(dispatcher, "w-1", 1);
    clock.advance(700);
    dispatcher.sweep();
    expect(dispatcher.stats().staleWorkers).toBe(1);
    // The overdue heartbeat fires the sweep FIRST (its jobs already failed),
    // then revives the worker as a rejoin.
    const ack = await beat(dispatcher, "w-1", 2);
    expect(ack.accepted).toBe(true);
    const stats = dispatcher.stats();
    expect(stats.workerRejoins).toBe(1);
    expect(stats.workersActive).toBe(1);
    void dispatcher.shutdown();
  });

  test("a revived worker with a RESET sequence is refused until it re-registers (fail-closed)", async () => {
    const { dispatcher, clock } = wiredDispatcher({ staleAfterMs: 600 });
    await dispatcher.registerWorker(capabilities("w-1", { heartbeatIntervalMs: 100 }));
    await beat(dispatcher, "w-1", 5);
    clock.advance(700);
    dispatcher.sweep();
    expect(dispatcher.stats().staleWorkers).toBe(1);
    // A restarted process that LOST its heartbeat sequence restarts at 1:
    // the heartbeat-revive path refuses it (the dispatcher still remembers
    // sequence 5 — no sequence-reset ambiguity). It must re-register, which
    // is the documented fresh-registration rejoin (sequence reset to 0).
    const reset = await beat(dispatcher, "w-1", 1);
    expect(reset).toMatchObject({ accepted: false, reason: "sequence-not-monotone" });
    expect(dispatcher.stats().workerRejoins).toBe(0); // not revived by the beat
    await dispatcher.registerWorker(capabilities("w-1"));
    expect(dispatcher.stats().workerRejoins).toBe(1);
    expect((await beat(dispatcher, "w-1", 1)).accepted).toBe(true); // fresh sequence
    void dispatcher.shutdown();
  });

  test("registration validations are fail-closed on misconfigurations", async () => {
    const { dispatcher } = wiredDispatcher({ leaseMs: 300, staleAfterMs: 600 });
    // lease shorter than the heartbeat cadence: refused.
    await expect(
      dispatcher.registerWorker(capabilities("w-bad", { heartbeatIntervalMs: 500 })),
    ).rejects.toThrow(/leaseMs 300 must be >= heartbeatIntervalMs 500/);
    // threshold shorter than the cadence: refused.
    const { dispatcher: d2 } = wiredDispatcher({ leaseMs: 1_000, staleAfterMs: 50 });
    await expect(
      d2.registerWorker(capabilities("w-bad", { heartbeatIntervalMs: 100 })),
    ).rejects.toThrow(/staleAfterMs 50 must be >= heartbeatIntervalMs 100/);
    // Structural capability violations:
    const { dispatcher: d3 } = wiredDispatcher({});
    await expect(
      d3.registerWorker(capabilities("w-bad", { maxConcurrentJobs: 0 })),
    ).rejects.toThrow(RangeError);
    await expect(d3.registerWorker(capabilities("w-bad", { memoryMb: -1 }))).rejects.toThrow(
      RangeError,
    );
    await expect(
      d3.registerWorker(capabilities("w-bad", { modelClasses: ["", "x"] })),
    ).rejects.toThrow(RangeError);
    await expect(
      d3.registerWorker(capabilities("w-bad", { heartbeatIntervalMs: 0 })),
    ).rejects.toThrow(RangeError);
    void dispatcher.shutdown();
    void d2.shutdown();
    void d3.shutdown();
  });

  test("a duplicate live worker id is a refused misconfiguration", async () => {
    const { dispatcher } = wiredDispatcher({});
    await dispatcher.registerWorker(capabilities("w-1"));
    await expect(dispatcher.registerWorker(capabilities("w-1"))).rejects.toThrow(
      /already registered and active/,
    );
    void dispatcher.shutdown();
  });

  test("registration, staleness, and heartbeats are all metered", async () => {
    const { metrics } = capturedObservability();
    const { dispatcher, clock } = wiredDispatcher({
      observability: { metrics },
      staleAfterMs: 600,
    });
    await dispatcher.registerWorker(capabilities("w-1"));
    await beat(dispatcher, "w-1", 1);
    clock.advance(700);
    dispatcher.sweep();
    await beat(dispatcher, "w-1", 2); // rejoin beat
    const snapshot = metrics.snapshot();
    const value = (name: string): number | undefined =>
      snapshot.counters.find((counter) => counter.name === name)?.value;
    expect(value(METRICS.heartbeats)).toBe(2);
    expect(value(METRICS.staleWorkers)).toBe(1);
    expect(value(METRICS.rejectedHeartbeats)).toBeUndefined(); // none refused
    void dispatcher.shutdown();
  });

  test("staleness fires at the boundary (strictly greater than the threshold)", async () => {
    const { dispatcher, clock } = wiredDispatcher({ staleAfterMs: 600 });
    await dispatcher.registerWorker(capabilities("w-1"));
    clock.advance(600);
    dispatcher.sweep();
    expect(dispatcher.stats().staleWorkers).toBe(0); // exactly at: still fresh
    clock.advance(1);
    dispatcher.sweep();
    expect(dispatcher.stats().staleWorkers).toBe(1);
    void dispatcher.shutdown();
  });

  test("heartbeat telemetry is advisory load only (in-flight + derived memory)", async () => {
    const { dispatcher } = wiredDispatcher({});
    await dispatcher.registerWorker(
      capabilities("w-1", { heartbeatIntervalMs: 100, maxConcurrentJobs: 1 }),
    );
    const ack = await beat(dispatcher, "w-1", 1, { inFlight: 3, advisoryMemoryInUseMb: 1_024 });
    expect(ack.accepted).toBe(true);
    // The heartbeat fields never touch the dispatcher's own executing count:
    expect(dispatcher.stats().executingJobs).toBe(0);
    void dispatcher.shutdown();
  });
});
