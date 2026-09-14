/**
 * GpuWorker tests (W303): the reference agent — heartbeat cadence with
 * monotone sequences and advisory telemetry, the claim/execute/report loop,
 * the W104 retry arithmetic with deadline checkpoints (non-retryable NEVER
 * blind-retried; thrown faults map to `internal`), stop modes, and the
 * dispatcher-ended stop signals.
 */
import { describe, expect, test } from "bun:test";
import { VirtualGpuClock } from "../src/clock";
import type { GpuClock } from "../src/clock";
import { GpuJobDispatcher } from "../src/dispatcher";
import { GpuWorker } from "../src/worker";
import type { GpuDispatcherPort, GpuJobExecutor } from "../src/types";
import {
  RecordingGpuClock,
  capabilities,
  deferredExecutor,
  job,
  recordingPort,
  requirements,
  scriptedExecutor,
  until,
  wiredWorker,
} from "./helpers";

/** Dispatcher + worker wiring with a recording port (worker-side evidence). */
async function wired(input: {
  leaseMs?: number;
  staleAfterMs?: number;
  clock?: GpuClock;
  capabilities?: Partial<ReturnType<typeof capabilities>>;
  executor: GpuJobExecutor;
  executorRetry?: Parameters<typeof wiredWorker>[0]["executorRetry"];
}): Promise<{
  dispatcher: GpuJobDispatcher;
  clock: GpuClock;
  worker: ReturnType<typeof wiredWorker>;
  port: ReturnType<typeof recordingPort>["port"];
  heartbeats: ReturnType<typeof recordingPort>["heartbeats"];
  reports: ReturnType<typeof recordingPort>["reports"];
}> {
  const clock: GpuClock = input.clock ?? new VirtualGpuClock(0);
  const dispatcher = new GpuJobDispatcher({
    dispatcherId: "gpu-worker-test",
    clock,
    ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
    ...(input.staleAfterMs === undefined ? {} : { staleAfterMs: input.staleAfterMs }),
  });
  dispatcher.start();
  const rec = recordingPort(dispatcher);
  const worker = wiredWorker({
    capabilities: capabilities("w-1", input.capabilities ?? {}),
    executor: input.executor,
    port: rec.port,
    clock,
    ...(input.executorRetry === undefined ? {} : { executorRetry: input.executorRetry }),
  });
  await worker.start();
  return {
    dispatcher,
    clock,
    worker,
    port: rec.port,
    heartbeats: rec.heartbeats,
    reports: rec.reports,
  };
}

describe("GpuWorker heartbeats", () => {
  test("heartbeats fire at the declared period with monotone sequences and telemetry", async () => {
    const clock = new VirtualGpuClock(0);
    const { worker, heartbeats } = await wired({
      clock,
      capabilities: { heartbeatIntervalMs: 100, maxConcurrentJobs: 2 },
      executor: deferredExecutor().executor,
    });
    // Stepwise advances (the exact-timestamp convention): each beat fires
    // when the advance crosses the PARKED deadline — the test gates on the
    // waiter being re-registered before the next advance.
    for (let i = 1; i <= 3; i += 1) {
      clock.advance(100);
      expect(await until(() => worker.stats().heartbeatsEmitted === i)).toBe(true);
      expect(await until(() => clock.pendingWaiters === 1)).toBe(true);
    }
    expect(heartbeats.map((beat) => beat.heartbeat.sequence)).toEqual([1, 2, 3]);
    for (const beat of heartbeats) {
      expect(beat.workerId).toBe("w-1");
      expect(beat.heartbeat.inFlight).toBe(0);
      expect(beat.heartbeat.advisoryMemoryInUseMb).toBe(0);
    }
    expect(worker.stats().lastHeartbeatSequence).toBe(3);
    await worker.stop();
  });

  test("heartbeats carry advisory load telemetry derived from in-flight requirements", async () => {
    const clock = new VirtualGpuClock(0);
    const deferred = deferredExecutor();
    const { dispatcher, worker, heartbeats } = await wired({
      clock,
      capabilities: { heartbeatIntervalMs: 100 },
      executor: deferred.executor,
    });
    dispatcher.submit(job("j1", { requirements: requirements({ memoryMb: 1_024 }) }));
    expect(await until(() => executorBusy(worker, deferred))).toBe(true);
    clock.advance(100); // a beat fires during the parked execution
    expect(await until(() => heartbeats.length === 1)).toBe(true);
    expect(heartbeats[0]?.heartbeat.inFlight).toBe(1);
    expect(heartbeats[0]?.heartbeat.advisoryMemoryInUseMb).toBe(1_024);
    deferred.settle({ status: "succeeded", output: null });
    await worker.stop();
    void dispatcher.shutdown();
  });

  test("an idle worker consumes no time and emits no heartbeats (honest idle)", async () => {
    const clock = new VirtualGpuClock(0);
    const { worker, heartbeats } = await wired({
      clock,
      executor: deferredExecutor().executor,
    });
    await until(() => false, 500);
    expect(heartbeats).toHaveLength(0);
    expect(worker.stats().heartbeatsEmitted).toBe(0);
    await worker.stop();
  });
});

describe("GpuWorker claim/execute/report", () => {
  test("the round trip: claim, execute on the clock, report, result resolves", async () => {
    const clock = new VirtualGpuClock(0);
    const script = scriptedExecutor(clock, { j1: [{ sleepMs: 100, result: "succeed" }] });
    const { dispatcher, worker, reports } = await wired({ clock, executor: script.executor });
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    const result = await handle.result;
    expect(result.status).toBe("succeeded");
    expect(result.output).toEqual({ from: "j1" });
    expect(result.attempts).toBe(1);
    expect(result.timing).toEqual({
      submittedAtMs: 0,
      startedAtMs: 0,
      queueWaitMs: 0,
      finishedAtMs: 100,
      executionMs: 100,
    });
    // The worker's report carried the per-attempt timing on the clock:
    expect(reports).toHaveLength(1);
    expect(reports[0]?.timings.perAttempt).toEqual([{ startedAtMs: 0, durationMs: 100 }]);
    expect(worker.stats().jobsClaimed).toBe(1);
    expect(worker.stats().attemptsExecuted).toBe(1);
    await worker.stop();
    void dispatcher.shutdown();
  });

  test("worker capacity: only maxConcurrentJobs execute concurrently", async () => {
    const clock = new VirtualGpuClock(0);
    const deferred = deferredExecutor();
    const { dispatcher, worker } = await wired({
      clock,
      capabilities: { maxConcurrentJobs: 2 },
      executor: deferred.executor,
    });
    dispatcher.submit(job("j1"));
    dispatcher.submit(job("j2"));
    dispatcher.submit(job("j3"));
    expect(await until(() => worker.stats().jobsClaimed === 2)).toBe(true);
    await until(() => false, 200);
    expect(worker.stats().jobsClaimed).toBe(2); // j3 stays queued
    expect(dispatcher.stats().executingJobs).toBe(2);
    expect(worker.stats().inFlight).toBe(2);
    // Settling one execution releases capacity for the third claim.
    deferred.settle({ status: "succeeded", output: null });
    expect(await until(() => worker.stats().jobsClaimed === 3)).toBe(true);
    deferred.settle({ status: "succeeded", output: null });
    deferred.settle({ status: "succeeded", output: null });
    await until(() => dispatcher.stats().succeeded === 3);
    await worker.stop();
    void dispatcher.shutdown();
  });
});

describe("GpuWorker retries + deadlines", () => {
  test("retryable failures back off with the W104 pure arithmetic on the clock", async () => {
    const clock = new RecordingGpuClock(new VirtualGpuClock(0));
    const script = scriptedExecutor(clock, {
      j1: [
        { result: { errorClass: "transient", message: "flaky", retryable: true } },
        { result: { errorClass: "transient", message: "flaky", retryable: true } },
        { sleepMs: 10, result: "succeed" },
      ],
    });
    const { dispatcher, worker } = await wired({
      clock,
      executor: script.executor,
      executorRetry: { maxAttempts: 3, baseDelayMs: 50, backoffMultiplier: 2 },
    });
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    const result = await handle.result;
    expect(result.status).toBe("succeeded");
    expect(result.attempts).toBe(3);
    expect(result.retriesUsed).toBe(2);
    // The RecordingGpuClock captures EVERY sleep: the two backoffs are the
    // W104 arithmetic (50, 100); the final 10 is the scripted work.
    expect(clock.sleeps).toEqual([50, 100, 10]);
    expect(clock.now()).toBe(160);
    expect(worker.stats().attemptsExecuted).toBe(3);
    await worker.stop();
    void dispatcher.shutdown();
  });

  test("non-retryable failures are NEVER blind-retried (one invocation only)", async () => {
    const clock = new RecordingGpuClock(new VirtualGpuClock(0));
    const script = scriptedExecutor(clock, {
      j1: [{ result: { errorClass: "media-invalid", message: "bad input", retryable: false } }],
    });
    const { dispatcher, worker } = await wired({
      clock,
      executor: script.executor,
      executorRetry: { maxAttempts: 5, baseDelayMs: 50, backoffMultiplier: 2 },
    });
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    const result = await handle.result;
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      errorClass: "media-invalid",
      terminal: "non-retryable",
    });
    expect(script.invocations("j1")).toBe(1);
    expect(clock.sleeps).toEqual([]); // no backoff was ever consumed
    expect(result.attempts).toBe(1);
    await worker.stop();
    void dispatcher.shutdown();
  });

  test("retry-budget exhaustion reports the retryable failure; the dispatcher dead-letters", async () => {
    const clock = new RecordingGpuClock(new VirtualGpuClock(0));
    const script = scriptedExecutor(clock, {
      j1: [
        { result: { errorClass: "transient", message: "always", retryable: true } },
        { result: { errorClass: "transient", message: "always", retryable: true } },
      ],
    });
    const { dispatcher, worker } = await wired({
      clock,
      executor: script.executor,
      executorRetry: { maxAttempts: 2, baseDelayMs: 30, backoffMultiplier: 1 },
    });
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    const result = await handle.result;
    expect(result.status).toBe("failed");
    expect(result.failure?.terminal).toBe("retry-exhausted");
    expect(result.attempts).toBe(2);
    expect(dispatcher.deadLetters()).toHaveLength(1);
    expect(clock.sleeps).toEqual([30]);
    await worker.stop();
    void dispatcher.shutdown();
  });

  test("a thrown executor fault maps to the reserved internal class (never retried)", async () => {
    const clock = new RecordingGpuClock(new VirtualGpuClock(0));
    const script = scriptedExecutor(clock, {
      j1: [
        { result: "throw" },
        { result: "throw" }, // would prove a blind retry happened
      ],
    });
    const { dispatcher, worker } = await wired({
      clock,
      executor: script.executor,
      executorRetry: { maxAttempts: 3, baseDelayMs: 10, backoffMultiplier: 1 },
    });
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    const result = await handle.result;
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ errorClass: "internal", terminal: "internal" });
    expect(script.invocations("j1")).toBe(1); // the fault is not retried
    await worker.stop();
    void dispatcher.shutdown();
  });

  test("deadline checkpoint 1: a claim granted already past its deadline never executes", async () => {
    // Clock-skew seam: the worker's own clock sits past the claim's absolute
    // deadline, so checkpoint 1 refuses to invoke the executor at all.
    const workerClock = new VirtualGpuClock(0);
    const dispatcherClock = new VirtualGpuClock(0);
    const dispatcher = new GpuJobDispatcher({
      dispatcherId: "gpu-skew",
      clock: dispatcherClock,
      leaseMs: 5_000,
      staleAfterMs: 10_000,
    });
    dispatcher.start();
    const script = scriptedExecutor(workerClock, {
      j1: [{ result: "succeed" }], // would prove an execution happened
    });
    const worker = wiredWorker({
      capabilities: capabilities("w-1", { heartbeatIntervalMs: 100 }),
      executor: script.executor,
      port: dispatcher,
      clock: workerClock,
    });
    await worker.start();
    const handle = dispatcher.submit(job("j1", { deadlineMs: 5_000 }));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    workerClock.advance(6_000); // worker-side time passes the deadline
    const result = await handle.result;
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ errorClass: "deadline-timeout", terminal: "timeout" });
    expect(result.attempts).toBe(0); // never executed
    expect(script.invocations("j1")).toBe(0);
    expect(result.timing.startedAtMs).toBeUndefined(); // no fake start
    expect(result.timing.executionMs).toBe(0);
    await worker.stop();
    void dispatcher.shutdown();
  });

  test("deadline checkpoint 2: a failing attempt that crosses the deadline reports timeout (no retry)", async () => {
    const clock = new VirtualGpuClock(0);
    const script = scriptedExecutor(clock, {
      j1: [
        { sleepMs: 150, result: { errorClass: "transient", message: "slow", retryable: true } },
        { result: "succeed" }, // would prove a retry happened
      ],
    });
    const { dispatcher, worker } = await wired({
      clock,
      executor: script.executor,
      executorRetry: { maxAttempts: 3, baseDelayMs: 10, backoffMultiplier: 1 },
    });
    const handle = dispatcher.submit(job("j1", { deadlineMs: 100 }));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    const result = await handle.result;
    // The dispatcher's sweep fails the in-flight job at the deadline; the
    // worker's timeout report (or the superseded report) keeps the
    // classification deadline-timeout either way.
    expect(result.status).toBe("failed");
    expect(result.failure?.errorClass).toBe("deadline-timeout");
    expect(result.failure?.terminal).toBe("timeout");
    expect(script.invocations("j1")).toBe(1); // no retry past the deadline
    await worker.stop();
    void dispatcher.shutdown();
  });

  test("deadline checkpoint 3: a backoff that crosses the deadline reports timeout", async () => {
    const clock = new VirtualGpuClock(0);
    const script = scriptedExecutor(clock, {
      j1: [
        { result: { errorClass: "transient", message: "flaky", retryable: true } },
        { result: "succeed" }, // would prove a retry happened
      ],
    });
    const { dispatcher, worker } = await wired({
      clock,
      executor: script.executor,
      executorRetry: { maxAttempts: 3, baseDelayMs: 500, backoffMultiplier: 1 },
    });
    const handle = dispatcher.submit(job("j1", { deadlineMs: 100 }));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    const result = await handle.result;
    expect(result.status).toBe("failed");
    expect(result.failure?.errorClass).toBe("deadline-timeout");
    expect(script.invocations("j1")).toBe(1);
    expect(result.attempts).toBe(1);
    await worker.stop();
    void dispatcher.shutdown();
  });
});

describe("GpuWorker lifecycle", () => {
  test("stop await waits for in-flight executions to settle and report", async () => {
    const clock = new VirtualGpuClock(0);
    const deferred = deferredExecutor();
    const { dispatcher, worker } = await wired({ clock, executor: deferred.executor });
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    expect(await until(() => deferred.parked() === 1)).toBe(true);
    deferred.settle({ status: "succeeded", output: { late: true } });
    await worker.stop();
    const result = await handle.result;
    expect(result.status).toBe("succeeded");
    await worker.stop(); // idempotent
    expect(worker.stats().stopped).toBe(true);
    void dispatcher.shutdown();
  });

  test("stop abandon returns immediately; the parked execution reports later (never lost)", async () => {
    const clock = new VirtualGpuClock(0);
    const deferred = deferredExecutor();
    const { dispatcher, worker } = await wired({ clock, executor: deferred.executor });
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    expect(await until(() => deferred.parked() === 1)).toBe(true);
    await worker.stop({ mode: "abandon" });
    expect(worker.stats().stopped).toBe(true);
    expect(dispatcher.stats().executingJobs).toBe(1); // still leased
    deferred.settle({ status: "succeeded", output: { abandoned: true } });
    const result = await handle.result;
    expect(result.status).toBe("succeeded"); // the late report was recorded
    void dispatcher.shutdown();
  });

  test("a rejected heartbeat reason is logged and the worker keeps beating", async () => {
    const clock = new VirtualGpuClock(0);
    // A mock port: heartbeats rejected as unknown-worker (never dispatcher-ended).
    const { dispatcher } = (() => {
      const d = new GpuJobDispatcher({ dispatcherId: "gpu-mock", clock, staleAfterMs: 10_000 });
      d.start();
      return { dispatcher: d };
    })();
    const flakyPort: GpuDispatcherPort = {
      registerWorker: (caps) => dispatcher.registerWorker(caps),
      heartbeat: async () => ({
        accepted: false,
        reason: "unknown-worker",
        dispatcherState: "running",
      }),
      claimJob: (workerId) => dispatcher.claimJob(workerId),
      reportResult: (report) => dispatcher.reportResult(report),
    };
    const worker = wiredWorker({
      capabilities: capabilities("w-1", { heartbeatIntervalMs: 100 }),
      executor: deferredExecutor().executor,
      port: flakyPort,
      clock,
    });
    await worker.start();
    clock.advance(100);
    expect(await until(() => worker.stats().heartbeatsEmitted === 1)).toBe(true);
    clock.advance(100);
    expect(await until(() => worker.stats().heartbeatsEmitted === 2)).toBe(true); // keeps beating
    await worker.stop();
    void dispatcher.shutdown();
  });

  test("the heartbeat sees dispatcher-ended and the worker stops itself", async () => {
    const clock = new VirtualGpuClock(0);
    const { dispatcher, worker } = await wired({
      clock,
      capabilities: { heartbeatIntervalMs: 100 },
      executor: deferredExecutor().executor,
    });
    await dispatcher.shutdown();
    clock.advance(100); // the next beat learns the dispatcher ended
    expect(await until(() => worker.stats().stopped === true)).toBe(true);
    await worker.stop(); // resolves immediately (already stopped)
  });

  test("claimJob resolving undefined (dispatcher ended) stops the claim loop", async () => {
    const clock = new VirtualGpuClock(0);
    const { dispatcher, worker } = await wired({ clock, executor: deferredExecutor().executor });
    await dispatcher.shutdown();
    // The claim loop's next claim resolves undefined; the worker stops.
    expect(await until(() => worker.stats().stopped === true, 20_000)).toBe(true);
    await worker.stop();
  });

  test("constructor validation is fail-closed on wiring", () => {
    const clock = new VirtualGpuClock(0);
    const executor = deferredExecutor().executor;
    const port: GpuDispatcherPort = {
      registerWorker: async () => ({ leaseMs: 1, staleAfterMs: 1 }),
      heartbeat: async () => ({ accepted: true, dispatcherState: "running" }),
      claimJob: async () => undefined,
      reportResult: async () => ({ status: "recorded" }),
    };
    expect(
      () =>
        new GpuWorker({
          capabilities: capabilities("w-1"),
          executor,
          port,
          clock: null as never,
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new GpuWorker({
          capabilities: capabilities("w-1"),
          executor: {} as never,
          port,
          clock,
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new GpuWorker({
          capabilities: capabilities("w-1"),
          executor,
          port: {} as never,
          clock,
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new GpuWorker({
          capabilities: capabilities("w-1"),
          executor,
          port,
          clock,
          executorRetry: { maxAttempts: 0, baseDelayMs: 0, backoffMultiplier: 1 },
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new GpuWorker({
          capabilities: capabilities("w-1"),
          executor,
          port,
          clock,
          executorRetry: { maxAttempts: 1, baseDelayMs: -1, backoffMultiplier: 1 },
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new GpuWorker({
          capabilities: capabilities("w-1"),
          executor,
          port,
          clock,
          executorRetry: { maxAttempts: 1, baseDelayMs: 1, backoffMultiplier: 0.5 },
        }),
    ).toThrow(RangeError);
  });

  test("start is fail-loud on a double start", async () => {
    const clock = new VirtualGpuClock(0);
    const { worker } = await wired({ clock, executor: deferredExecutor().executor });
    await expect(worker.start()).rejects.toThrow(/already started/);
    await worker.stop();
  });
});

/** True when the worker has a parked deferred execution. */
function executorBusy(
  worker: ReturnType<typeof wiredWorker>,
  deferred: ReturnType<typeof deferredExecutor>,
): boolean {
  void worker;
  return deferred.parked() > 0;
}
