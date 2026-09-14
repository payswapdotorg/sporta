/**
 * Whole-story determinism (W303): the complete protocol story — admissions,
 * idempotent duplicates, a submit-retry duplicate, malformed + collision +
 * never-fit refusals, lease-expiry recovery AND claim-budget exhaustion into
 * the DLQ, worker-side retry-exhaustion into the DLQ, queued + in-flight
 * deadline timeouts, a superseded late report, worker staleness with a
 * heartbeat revive, queued + in-flight cancellations, and one REAL GpuWorker
 * agent (heartbeat loop + W104 retry loop) — run TWICE with fresh objects.
 *
 * The two runs' FULL artifacts deep-equal: the settled GpuDispatchResult
 * (stats, every job's ledger record with its event trail, dead letters, the
 * balance proof), every job's result envelope, every captured log line, and
 * the whole metrics snapshot. This is the never-silent whole-story proof the
 * W302 determinism suite set the precedent for; the package suite is also
 * double-run in two separate bun subprocesses by the verification battery.
 */
import { describe, expect, test } from "bun:test";
import { VirtualGpuClock } from "../src/clock";
import { GpuJobDispatcher } from "../src/dispatcher";
import { GpuResourceLimitError, MalformedJobError } from "../src/errors";
import type { GpuJobResult, GpuDispatchResult } from "../src/types";
import {
  RecordingGpuClock,
  capabilities,
  capturedObservability,
  expectGpuBalanced,
  job,
  requirements,
  scriptedExecutor,
  wiredWorker,
} from "./helpers";
import type { MetricsSnapshot } from "@sporta/observability";

/** One raw-port report with fully-authored deterministic timings. */
function report(
  jobId: string,
  workerId: string,
  leaseId: number,
  status: "succeeded" | "failed",
  extras: Partial<{
    output: unknown;
    errorClass: string;
    message: string;
    retryable: boolean;
    attempts: number;
    startedAtMs: number;
    finishedAtMs: number;
    executionMs: number;
  }> = {},
): {
  workerId: string;
  jobId: string;
  leaseId: number;
  status: "succeeded" | "failed";
  output?: unknown;
  errorClass?: string;
  message?: string;
  retryable?: boolean;
  attempts: number;
  timings: { startedAtMs: number; finishedAtMs: number; executionMs: number; perAttempt: [] };
} {
  return {
    workerId,
    jobId,
    leaseId,
    status,
    ...(status === "succeeded" ? { output: extras.output ?? { from: jobId } } : {}),
    ...(status === "succeeded"
      ? {}
      : {
          errorClass: extras.errorClass ?? "transient",
          message: extras.message ?? "scripted failure",
          retryable: extras.retryable ?? false,
        }),
    attempts: extras.attempts ?? 1,
    timings: {
      startedAtMs: extras.startedAtMs ?? 0,
      finishedAtMs: extras.finishedAtMs ?? 0,
      executionMs: extras.executionMs ?? 0,
      perAttempt: [],
    },
  };
}

/** One raw heartbeat for w-1 (keeps it fresh across the story's advances). */
async function beat(dispatcher: GpuJobDispatcher, sequence: number): Promise<void> {
  const ack = await dispatcher.heartbeat("w-1", {
    sequence,
    dueMs: 0,
    inFlight: 0,
    advisoryMemoryInUseMb: 0,
  });
  if (!ack.accepted) throw new Error(`story beat ${sequence} was not accepted`);
}

/** The whole protocol story. Fresh objects per call; fully deterministic. */
async function wholeStory(): Promise<{
  settled: GpuDispatchResult;
  results: Record<string, GpuJobResult>;
  lines: string[];
  metrics: MetricsSnapshot;
  sleeps: number[];
  clockNow: number;
}> {
  const clock = new RecordingGpuClock(new VirtualGpuClock(0));
  const obs = capturedObservability();
  const dispatcher = new GpuJobDispatcher({
    dispatcherId: "gpu-story",
    clock,
    leaseMs: 300,
    staleAfterMs: 10_000,
    defaultMaxAttempts: 3,
    limits: { maxQueuedJobs: 8, maxAdmittedJobs: 100, maxDlqEntries: 1 },
    observability: { logger: obs.logger, metrics: obs.metrics },
  });
  dispatcher.start();
  await dispatcher.registerWorker(capabilities("w-1"));
  await dispatcher.registerWorker(capabilities("w-ghost")); // claims, never beats/reports
  const results: Record<string, GpuJobResult> = {};
  const admit = (jobId: string, overrides: Parameters<typeof job>[1] = {}): void => {
    const handle = dispatcher.submit(job(jobId, overrides));
    if (handle.disposition !== "admitted") throw new Error(`unreachable: ${jobId}`);
    void handle.result.then((result) => {
      results[jobId] = result;
    });
  };

  // --- phase 1: clean success, non-retryable failure, worker-retry DLQ (t=0)
  admit("j1");
  let claim = await dispatcher.claimJob("w-1");
  if (claim === undefined) throw new Error("unreachable");
  await dispatcher.reportResult(
    report("j1", "w-1", claim.leaseId, "succeeded", {
      startedAtMs: 0,
      finishedAtMs: 100,
      executionMs: 100,
    }),
  );
  await beat(dispatcher, 1);
  admit("j2");
  claim = await dispatcher.claimJob("w-1");
  if (claim === undefined) throw new Error("unreachable");
  await dispatcher.reportResult(
    report("j2", "w-1", claim.leaseId, "failed", {
      errorClass: "media-invalid",
      message: "bad payload",
      retryable: false,
      startedAtMs: 0,
      finishedAtMs: 50,
      executionMs: 50,
    }),
  );
  await beat(dispatcher, 2);
  admit("j10"); // worker-side retry budget exhausted -> dead-letter
  claim = await dispatcher.claimJob("w-1");
  if (claim === undefined) throw new Error("unreachable");
  await dispatcher.reportResult(
    report("j10", "w-1", claim.leaseId, "failed", {
      errorClass: "transient",
      message: "always flaky",
      retryable: true,
      attempts: 2,
      startedAtMs: 0,
      finishedAtMs: 50,
      executionMs: 50,
    }),
  );

  // --- phase 2: lease expiry -> requeue -> recovery by another worker (t=0..350)
  admit("j3");
  claim = await dispatcher.claimJob("w-ghost");
  if (claim === undefined) throw new Error("unreachable");
  const dupInflight = dispatcher.submit(job("j-dup-inflight", { idempotencyKey: "key-j3" }));
  if (dupInflight.disposition !== "duplicate") throw new Error("unreachable"); // while in flight
  expect(dupInflight.keyState).toBe("in-flight");
  clock.advance(350);
  await beat(dispatcher, 3); // entry sweep: j3's lease expired, requeued (claims 1)
  claim = await dispatcher.claimJob("w-1");
  if (claim === undefined) throw new Error("unreachable");
  await dispatcher.reportResult(
    report("j3", "w-1", claim.leaseId, "succeeded", {
      startedAtMs: 350,
      finishedAtMs: 450,
      executionMs: 100,
    }),
  );
  await beat(dispatcher, 4);

  // --- phase 3: claim-budget exhaustion via lease expiry -> DLQ (t=350..1400)
  admit("j4");
  for (let i = 0; i < 3; i += 1) {
    claim = await dispatcher.claimJob("w-ghost");
    if (claim === undefined) throw new Error("unreachable");
    clock.advance(350); // past the 300 ms lease each time
    await beat(dispatcher, 5 + i); // sweep: expiry -> requeue, requeue, dead-letter
  }

  // --- phase 4: typed loud refusals + idempotent duplicates (t=1400)
  expect(() => dispatcher.submit(job("j-bad", { deadlineMs: 0 }))).toThrow(MalformedJobError);
  expect(() => dispatcher.submit(job("j1", { idempotencyKey: "key-collide" }))).toThrow(
    MalformedJobError,
  ); // NEW key re-using an admitted jobId
  const dupTerminal = dispatcher.submit(job("j-dup", { idempotencyKey: "key-j1" }));
  if (dupTerminal.disposition !== "duplicate") throw new Error("unreachable");
  expect(dupTerminal.keyState).toBe("succeeded");
  const dupRetry = dispatcher.submit(job("j2")); // same envelope: submit retry
  if (dupRetry.disposition !== "duplicate") throw new Error("unreachable");
  expect(dupRetry.keyState).toBe("failed");
  expect(() =>
    dispatcher.submit(job("j-fit", { requirements: requirements({ modelClass: "synthesis" }) })),
  ).toThrow(GpuResourceLimitError); // never-fit against active declarations

  // --- phase 5: deadline fires while queued (t=1400..1550)
  admit("j5", { deadlineMs: 100 });
  clock.advance(150);
  await beat(dispatcher, 8); // sweep: j5 deadline-timeout (queued)

  // --- phase 6: deadline fires while in flight + superseded late report
  admit("j6", { deadlineMs: 100 });
  claim = await dispatcher.claimJob("w-1");
  if (claim === undefined) throw new Error("unreachable");
  const j6Lease = claim.leaseId;
  clock.advance(150);
  await beat(dispatcher, 9); // sweep: j6 deadline-timeout (in-flight)
  const late = await dispatcher.reportResult(
    report("j6", "w-1", j6Lease, "succeeded", {
      startedAtMs: 1550,
      finishedAtMs: 1700,
      executionMs: 150,
    }),
  );
  if (late.status !== "superseded") throw new Error("unreachable");

  // --- phase 7: worker staleness (fail loud) + heartbeat revive (t=1700..11701)
  await dispatcher.registerWorker(capabilities("w-doomed")); // claims, then goes silent
  admit("j7");
  claim = await dispatcher.claimJob("w-doomed");
  if (claim === undefined) throw new Error("unreachable");
  clock.advance(10_001); // past staleAfter for w-doomed AND w-1 AND w-ghost
  await beat(dispatcher, 10); // sweep: 3 stale workers, j7 FAILED worker-stale; w-1 revives

  // --- phase 8: cancellation queued + in-flight + another superseded report
  admit("j8");
  expect(dispatcher.cancel("j8")).toEqual({ cancelled: true, jobId: "j8" });
  admit("j9");
  claim = await dispatcher.claimJob("w-1");
  if (claim === undefined) throw new Error("unreachable");
  const j9Lease = claim.leaseId;
  expect(dispatcher.cancel("j9")).toEqual({ cancelled: true, jobId: "j9" });
  const late9 = await dispatcher.reportResult(
    report("j9", "w-1", j9Lease, "succeeded", {
      startedAtMs: 11_701,
      finishedAtMs: 11_701,
      executionMs: 0,
    }),
  );
  if (late9.status !== "superseded") throw new Error("unreachable");

  // --- phase 9: one REAL GpuWorker agent (heartbeat loop + W104 retry loop)
  const script = scriptedExecutor(clock, {
    "j-agent": [
      { result: { errorClass: "transient", message: "flaky", retryable: true } },
      { result: { errorClass: "transient", message: "flaky", retryable: true } },
      { sleepMs: 100, result: "succeed" },
    ],
  });
  const agent = wiredWorker({
    capabilities: capabilities("w-agent", { heartbeatIntervalMs: 100 }),
    executor: script.executor,
    port: dispatcher,
    clock,
    executorRetry: { maxAttempts: 3, baseDelayMs: 50, backoffMultiplier: 2 },
  });
  await agent.start();
  admit("j-agent");
  await untilResult(results, "j-agent"); // beats + backoffs advance the clock
  await agent.stop();

  const settled = await dispatcher.shutdown();
  return {
    settled,
    results,
    lines: obs.lines(),
    metrics: obs.metrics.snapshot(),
    sleeps: [...clock.sleeps],
    clockNow: clock.now(),
  };
}

/** Polls (microtask-only) until `results[key]` resolves. */
async function untilResult(
  results: Record<string, GpuJobResult>,
  key: string,
  maxTicks: number = 100_000,
): Promise<GpuJobResult> {
  let ticks = 0;
  while (results[key] === undefined && ticks < maxTicks) {
    await Promise.resolve();
    ticks += 1;
  }
  const result = results[key];
  if (result === undefined) throw new Error(`story result '${key}' never resolved`);
  return result;
}

describe("whole-story determinism", () => {
  test("the full story settles balanced with the exact never-silent accounting", async () => {
    const { settled, results, sleeps, clockNow } = await wholeStory();
    expect(settled.outcome).toBe("stopped");
    expect(settled.balanced).toBe(true);
    expectGpuBalanced(settled.stats, {
      jobsSubmitted: 14, // 11 admitted + 3 duplicates (in-flight, terminal, submit-retry)
      admitted: 11,
      duplicates: 3,
      succeeded: 3, // j1, j3, j-agent
      failed: 4, // j2 (non-retryable), j5 + j6 (deadline), j7 (worker-stale)
      cancelled: 2, // j8 (queued), j9 (in-flight)
      deadLettered: 2, // j10 (worker retry-exhausted), j4 (lease claim-exhausted)
    });
    expect(settled.stats.malformedSubmissions).toBe(2); // bad envelope + jobId collision
    expect(settled.stats.refusedSubmissions).toBe(1); // never-fit model class
    expect(settled.stats.claimsGranted).toBe(12); // 1+1+1+2+3+1+1+1+1 (j-agent 1)
    expect(settled.stats.requeues).toBe(3); // j3 once, j4 twice
    expect(settled.stats.leaseExpiries).toBe(4); // j3 once, j4 three times
    expect(settled.stats.reportedAttempts).toBe(10); // 1+1+2+1+1+1+3 across 7 reports
    expect(settled.stats.lateResults).toBe(2); // j6 + j9 superseded reports
    // 10 story beats + 1 agent beat: the agent's beat fires at its first
    // crossed deadline (11 801, during the second backoff's sleep), and its
    // loop re-registers from the POST-ADVANCE present (11 951 + 100) — after
    // the story's last advance — the documented discretization (§8).
    expect(settled.stats.heartbeatsReceived).toBe(11);
    expect(settled.stats.staleWorkers).toBe(3); // w-ghost, w-doomed, w-1 (revived)
    expect(settled.stats.workerRejoins).toBe(1); // w-1 revived by beat 10
    expect(settled.stats.timeoutsDeadline).toBe(2); // j5, j6
    expect(settled.stats.timeoutsStale).toBe(1); // j7
    expect(settled.stats.dlqRetained).toBe(1); // j10 (first dead letter, bound 1)
    expect(settled.stats.dlqOverflow).toBe(1); // j4 (second dead letter)
    expect(settled.stats.workersRegistered).toBe(4); // w-1, w-ghost, w-doomed, w-agent
    expect(settled.stats.workersActive).toBe(2); // w-1 (revived) + w-agent
    // 11 ledger records in submission order:
    expect(settled.jobs.map((record) => record.jobId)).toEqual([
      "j1",
      "j2",
      "j10",
      "j3",
      "j4",
      "j5",
      "j6",
      "j7",
      "j8",
      "j9",
      "j-agent",
    ]);
    // The recovery story of j3, event by event:
    expect(settled.jobs[3]?.events.map((event) => event.type)).toEqual([
      "submitted",
      "claimed",
      "lease-expired",
      "requeued",
      "claimed",
      "succeeded",
    ]);
    expect(results["j3"]?.claims).toBe(2);
    expect(results["j3"]?.attempts).toBe(1);
    expect(results["j3"]?.retriesUsed).toBe(-1); // the unreported first claim
    expect(results["j3"]?.timing).toEqual({
      submittedAtMs: 0,
      startedAtMs: 350,
      queueWaitMs: 350,
      finishedAtMs: 350,
      executionMs: 100,
    });
    // The claim-budget exhaustion of j4, event by event:
    expect(settled.jobs[4]?.events.map((event) => event.type)).toEqual([
      "submitted",
      "claimed",
      "lease-expired",
      "requeued",
      "claimed",
      "lease-expired",
      "requeued",
      "claimed",
      "lease-expired",
      "dead-lettered",
    ]);
    expect(results["j4"]?.failure).toMatchObject({
      errorClass: "lease-expired",
      terminal: "retry-exhausted",
    });
    expect(results["j4"]?.claims).toBe(3);
    expect(results["j4"]?.attempts).toBe(0);
    // The stale worker failed LOUD (never reassigned):
    expect(settled.jobs[7]?.events.map((event) => event.type)).toEqual([
      "submitted",
      "claimed",
      "worker-stale",
    ]);
    expect(results["j7"]?.failure).toMatchObject({
      errorClass: "worker-stale",
      terminal: "timeout",
    });
    // The in-flight deadline + its superseded late report:
    expect(settled.jobs[6]?.events.map((event) => event.type)).toEqual([
      "submitted",
      "claimed",
      "deadline-timeout",
      "superseded-report",
    ]);
    // The real agent's retry story (W104 arithmetic 50 + 100 backoffs, 100 work):
    expect(results["j-agent"]?.status).toBe("succeeded");
    expect(results["j-agent"]?.attempts).toBe(3);
    expect(results["j-agent"]?.claims).toBe(1);
    expect(results["j-agent"]?.retriesUsed).toBe(2);
    expect(results["j-agent"]?.timing).toEqual({
      submittedAtMs: 11_701,
      startedAtMs: 11_701,
      queueWaitMs: 0,
      finishedAtMs: 11_951,
      executionMs: 100,
    });
    // The ONLY sleeps the whole story ever consumed are the agent's W104
    // backoffs (50, 100) + its work (100) — the raw-port legs advance time
    // explicitly and never sleep.
    expect(sleeps).toEqual([50, 100, 100]);
    expect(clockNow).toBe(11_951);
  });

  test("the whole story is byte-stable across reruns (deep-equal artifacts ×2)", async () => {
    const first = await wholeStory();
    const second = await wholeStory();
    expect(second.settled).toEqual(first.settled);
    expect(second.results).toEqual(first.results);
    expect(second.lines).toEqual(first.lines);
    expect(second.metrics).toEqual(first.metrics);
    expect(second.sleeps).toEqual(first.sleeps);
    expect(second.clockNow).toBe(first.clockNow);
    // The settled artifacts are not just equal: the balance identity holds
    // on BOTH runs' own counters (re-derived, the never-silent proof).
    for (const run of [first, second]) {
      expect(
        run.settled.stats.succeeded +
          run.settled.stats.failed +
          run.settled.stats.cancelled +
          run.settled.stats.deadLettered +
          run.settled.stats.duplicates,
      ).toBe(run.settled.stats.jobsSubmitted);
    }
  });
});
