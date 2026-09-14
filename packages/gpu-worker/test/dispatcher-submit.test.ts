/**
 * Dispatcher submit-boundary tests (W303): admission, typed loud refusals
 * (malformed / job-id collision / resource-limit), idempotency-key dedupe,
 * the fail-loud admitted-job budget, and the never-fits declared-capacity
 * envelope — every refusal counted + logged + metered, the dispatcher
 * continues.
 */
import { describe, expect, test } from "bun:test";
import { VirtualGpuClock } from "../src/clock";
import { GpuJobDispatcher } from "../src/dispatcher";
import {
  GpuResourceLimitError,
  InvalidDispatcherStateError,
  MalformedJobError,
} from "../src/errors";
import { GPU_METRIC_NAMES as METRICS } from "../src/types";
import {
  capabilities,
  capturedObservability,
  expectGpuBalanced,
  job,
  requirements,
  wiredDispatcher,
} from "./helpers";

describe("GpuJobDispatcher.submit", () => {
  test("admit: a valid job lands queued with a pending result promise", async () => {
    const { dispatcher, clock } = wiredDispatcher({});
    const handle = dispatcher.submit(job("j1"));
    expect(handle.disposition).toBe("admitted");
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    expect(dispatcher.stats().admitted).toBe(1);
    expect(dispatcher.stats().queuedJobs).toBe(1);
    expect(dispatcher.stats().inFlight).toBe(1);
    const record = dispatcher.jobRecords()[0]!;
    expect(record.state).toBe("queued");
    expect(record.deadlineAtMs).toBe(clock.now() + 10_000);
    expect(record.maxAttempts).toBe(3); // the dispatcher default
    expect(record.correlationId).toBe("corr-gpu-gpu-test");
    const settled = await dispatcher.shutdown();
    expectGpuBalanced(settled.stats, {
      jobsSubmitted: 1,
      admitted: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 1,
      deadLettered: 0,
    });
    // The queued job was cancelled at shutdown with the documented reason.
    const result = await handle.result;
    expect(result.status).toBe("cancelled");
  });

  test("submit before start() and after end() are caller errors", async () => {
    const { dispatcher, clock } = wiredDispatcher({});
    const idle = new GpuJobDispatcher({ clock });
    expect(() => idle.submit(job("j1"))).toThrow(InvalidDispatcherStateError);
    await dispatcher.shutdown();
    expect(() => dispatcher.submit(job("j1"))).toThrow(InvalidDispatcherStateError);
  });

  test("a malformed envelope throws MalformedJobError, is counted, and the dispatcher continues", () => {
    const { logger, metrics, records } = capturedObservability();
    const { dispatcher } = wiredDispatcher({ observability: { logger, metrics } });
    expect(() => dispatcher.submit({ ...job("j1"), deadlineMs: 0 })).toThrow(MalformedJobError);
    const stats = dispatcher.stats();
    expect(stats.malformedSubmissions).toBe(1);
    expect(stats.admitted).toBe(0);
    expect(stats.jobsSubmitted).toBe(0); // refusals never became jobs
    expect(metrics.snapshot().counters.find((c) => c.name === METRICS.malformed)?.value).toBe(1);
    const warned = records().filter((r) => r.msg.includes("refused (malformed envelope)"));
    expect(warned).toHaveLength(1);
    // One corrupt job never kills a live dispatch session:
    expect(dispatcher.submit(job("j2")).disposition).toBe("admitted");
  });

  test("a null envelope is refused loudly without crashing the dispatcher", () => {
    const { dispatcher } = wiredDispatcher({});
    expect(() => dispatcher.submit(null as never)).toThrow(MalformedJobError);
    expect(dispatcher.stats().malformedSubmissions).toBe(1);
    expect(dispatcher.submit(job("j1")).disposition).toBe("admitted");
  });

  test("a NEW key re-using an admitted job's jobId is a typed loud collision refusal", () => {
    const { dispatcher } = wiredDispatcher({});
    dispatcher.submit(job("j1"));
    expect(() => dispatcher.submit(job("j1", { idempotencyKey: "key-other" }))).toThrow(
      MalformedJobError,
    );
    const stats = dispatcher.stats();
    expect(stats.malformedSubmissions).toBe(1);
    expect(stats.admitted).toBe(1);
    expect(stats.duplicates).toBe(0);
  });

  test("an idempotent submit retry (same key AND jobId) is a counted duplicate, never a collision", () => {
    const { dispatcher } = wiredDispatcher({});
    const envelope = job("j1");
    expect(dispatcher.submit(envelope).disposition).toBe("admitted");
    // The same envelope, re-submitted (a caller's submit retry): the KNOWN
    // key wins over the jobId-collision check — a duplicate, never a refusal.
    const retry = dispatcher.submit(envelope);
    expect(retry.disposition).toBe("duplicate");
    if (retry.disposition !== "duplicate") throw new Error("unreachable");
    expect(retry.jobId).toBe("j1");
    expect(retry.keyState).toBe("queued");
    const stats = dispatcher.stats();
    expect(stats.duplicates).toBe(1);
    expect(stats.jobsSubmitted).toBe(2);
    expect(stats.malformedSubmissions).toBe(0);
    expect(stats.admitted).toBe(1);
    void dispatcher.shutdown();
  });

  test("duplicate key while the job is in flight: counted, skipped, never double-claimed", async () => {
    const { dispatcher } = wiredDispatcher({});
    dispatcher.submit(job("j1"));
    const dup = dispatcher.submit(job("j1-other", { idempotencyKey: "key-j1" }));
    expect(dup.disposition).toBe("duplicate");
    if (dup.disposition !== "duplicate") throw new Error("unreachable");
    expect(dup.jobId).toBe("j1");
    expect(dup.idempotencyKey).toBe("key-j1");
    expect(dup.keyState).toBe("queued");
    const stats = dispatcher.stats();
    expect(stats.duplicates).toBe(1);
    expect(stats.admitted).toBe(1);
    expect(stats.jobsSubmitted).toBe(2); // ledger-populating submits
    const settled = await dispatcher.shutdown();
    expectGpuBalanced(settled.stats, {
      jobsSubmitted: 2,
      admitted: 1,
      duplicates: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 1,
      deadLettered: 0,
    });
  });

  test("duplicate key after a terminal disposition reports the key state (while running)", () => {
    const { dispatcher } = wiredDispatcher({});
    dispatcher.submit(job("j1"));
    // Cancel while the dispatcher is still running → the key is terminally
    // disposed; a re-submission is a counted duplicate reporting the state.
    const outcome = dispatcher.cancel("j1");
    expect(outcome).toMatchObject({ cancelled: true, jobId: "j1" });
    const dup = dispatcher.submit(job("j1-again", { idempotencyKey: "key-j1" }));
    expect(dup.disposition).toBe("duplicate");
    if (dup.disposition !== "duplicate") throw new Error("unreachable");
    expect(dup.keyState).toBe("cancelled");
    expect(dispatcher.stats().duplicates).toBe(1);
    // After the run ends, submits are caller errors (single-run lifecycle).
    void dispatcher.shutdown();
    expect(() => dispatcher.submit(job("j2"))).toThrow(InvalidDispatcherStateError);
  });

  test("ready-queue-full is a typed resource refusal (counted, dispatcher continues)", () => {
    const { dispatcher } = wiredDispatcher({ limits: { maxQueuedJobs: 1 } });
    expect(dispatcher.submit(job("j1")).disposition).toBe("admitted");
    let refusal: unknown;
    try {
      dispatcher.submit(job("j2"));
    } catch (err) {
      refusal = err;
    }
    expect(refusal).toBeInstanceOf(GpuResourceLimitError);
    expect((refusal as GpuResourceLimitError).details).toMatchObject({
      reason: "ready-queue-full",
      queued: 1,
      maxQueuedJobs: 1,
    });
    expect((refusal as GpuResourceLimitError).terminalFailureClass).toBe("resource-limit");
    const stats = dispatcher.stats();
    expect(stats.refusedSubmissions).toBe(1);
    expect(stats.admitted).toBe(1);
    // The dispatcher continues: the queued job cancels cleanly at settle.
    void dispatcher.shutdown();
  });

  test("admitted-job budget exhaustion fails the dispatcher LOUD and settles balanced", async () => {
    const { dispatcher } = wiredDispatcher({ limits: { maxAdmittedJobs: 1 } });
    const first = dispatcher.submit(job("j1"));
    expect(first.disposition).toBe("admitted");
    let refusal: unknown;
    try {
      dispatcher.submit(job("j2"));
    } catch (err) {
      refusal = err;
    }
    expect(refusal).toBeInstanceOf(GpuResourceLimitError);
    expect((refusal as GpuResourceLimitError).details).toMatchObject({
      reason: "admitted-budget-exhausted",
    });
    const settled = await dispatcher.shutdown();
    expect(settled.outcome).toBe("failed");
    expect(settled.terminalFailureClass).toBe("resource-limit");
    expect(settled.error).toContain("admitted-job budget");
    expectGpuBalanced(settled.stats, {
      jobsSubmitted: 1,
      admitted: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 1,
      deadLettered: 0,
    });
    // The submit after the terminal failure is a caller error, not a refusal.
    expect(() => dispatcher.submit(job("j4"))).toThrow(InvalidDispatcherStateError);
  });

  test("memory requirement over every active worker's declared capacity is refused never-fit", async () => {
    const { dispatcher } = wiredDispatcher({});
    await dispatcher.registerWorker(capabilities("w-1", { memoryMb: 2_048 }));
    expect(() =>
      dispatcher.submit(job("j1", { requirements: requirements({ memoryMb: 4_096 }) })),
    ).toThrow(GpuResourceLimitError);
    try {
      dispatcher.submit(job("j1b", { requirements: requirements({ memoryMb: 4_096 }) }));
    } catch (err) {
      expect((err as GpuResourceLimitError).details).toMatchObject({
        reason: "memory-over-declared-envelope",
        requiredMemoryMb: 4_096,
        maxDeclaredMemoryMb: 2_048,
      });
    }
    expect(dispatcher.stats().refusedSubmissions).toBe(2);
    expect(dispatcher.submit(job("j-ok")).disposition).toBe("admitted"); // continues
  });

  test("model class served by no active worker is refused never-fit", async () => {
    const { dispatcher } = wiredDispatcher({});
    await dispatcher.registerWorker(capabilities("w-1", { modelClasses: ["encode"] }));
    expect(() =>
      dispatcher.submit(job("j1", { requirements: requirements({ modelClass: "synthesis" }) })),
    ).toThrow(GpuResourceLimitError);
    expect(dispatcher.stats().refusedSubmissions).toBe(1);
  });

  test("with zero active workers, never-fit admission is deferred (deadline owns it)", () => {
    const { dispatcher } = wiredDispatcher({});
    // No worker registered: no capacity envelope to check against.
    expect(
      dispatcher.submit(job("j1", { requirements: requirements({ memoryMb: 999_999 }) }))
        .disposition,
    ).toBe("admitted");
    expect(dispatcher.stats().refusedSubmissions).toBe(0);
  });

  test("per-submit correlation overrides ride the ledger record", () => {
    const { dispatcher } = wiredDispatcher({});
    const handle = dispatcher.submit(job("j1"), { correlationId: "corr-x", traceId: "trace-y" });
    expect(handle.disposition).toBe("admitted");
    const record = dispatcher.jobRecords()[0]!;
    expect(record.correlationId).toBe("corr-x");
    expect(record.traceId).toBe("trace-y");
  });

  test("constructor validation is fail-closed on wiring", () => {
    const clock = new VirtualGpuClock(0);
    expect(() => new GpuJobDispatcher({ clock: null as never })).toThrow(TypeError);
    expect(() => new GpuJobDispatcher({ clock, staleAfterMs: 0 })).toThrow(RangeError);
    expect(() => new GpuJobDispatcher({ clock, leaseMs: -1 })).toThrow(RangeError);
    expect(() => new GpuJobDispatcher({ clock, defaultMaxAttempts: 0 })).toThrow(RangeError);
    expect(() => new GpuJobDispatcher({ clock, limits: { maxQueuedJobs: 0 } })).toThrow(RangeError);
    expect(() => new GpuJobDispatcher({ clock, dispatcherId: "" })).toThrow(RangeError);
  });

  test("start is idempotent-fail-loud and stats() observes the live counters", () => {
    const { dispatcher } = wiredDispatcher({});
    expect(() => dispatcher.start()).toThrow(InvalidDispatcherStateError);
    dispatcher.submit(job("j1"));
    expect(dispatcher.stats().queuedJobs).toBe(1);
    expect(dispatcher.stats().workersActive).toBe(0);
  });
});
