/**
 * Attempt-report tests (W303): the worker→dispatcher result channel. Every
 * disposition path — succeeded, non-retryable failed, retry-exhausted
 * dead-letter, internal dead-letter, timeout — plus supersession (wrong
 * lease / worker / state / after end), unknown jobs, malformed reports, and
 * the exact result-envelope + timing accounting.
 */
import { describe, expect, test } from "bun:test";
import { GPU_METRIC_NAMES as METRICS } from "../src/types";
import type { GpuAttemptReport, GpuJobClaim, GpuJobResult } from "../src/types";
import {
  capabilities,
  capturedObservability,
  expectGpuBalanced,
  job,
  wiredDispatcher,
} from "./helpers";

/** A raw-port report payload (minimal valid shape, caller-tuned). */
function report(
  claim: GpuJobClaim,
  workerId: string,
  status: "succeeded" | "failed" | "timeout",
  extras: Partial<{
    output: unknown;
    errorClass: string;
    message: string;
    retryable: boolean;
    attempts: number;
    timings: GpuAttemptReport["timings"];
  }> = {},
): GpuAttemptReport {
  return {
    workerId,
    jobId: claim.job.jobId,
    leaseId: claim.leaseId,
    status,
    ...(status === "succeeded" ? { output: extras.output ?? { from: claim.job.jobId } } : {}),
    ...(status === "succeeded" ? {} : { errorClass: extras.errorClass ?? "transient" }),
    ...(status === "succeeded" ? {} : { message: extras.message ?? "scripted failure" }),
    ...(status === "failed" ? { retryable: extras.retryable ?? true } : {}),
    attempts: extras.attempts ?? 1,
    timings: extras.timings ?? {
      startedAtMs: 10,
      finishedAtMs: 40,
      executionMs: 30,
      perAttempt: [{ startedAtMs: 10, durationMs: 30 }],
    },
  };
}

/** Registers a raw worker, submits, and claims — the raw client setup. */
async function rawSetup(input: { leaseMs?: number } = {}): Promise<{
  dispatcher: ReturnType<typeof wiredDispatcher>["dispatcher"];
  clock: ReturnType<typeof wiredDispatcher>["clock"];
  claim: GpuJobClaim;
  result: Promise<GpuJobResult>;
}> {
  const { dispatcher, clock } = wiredDispatcher({
    leaseMs: input.leaseMs ?? 5_000,
    staleAfterMs: 10_000,
  });
  await dispatcher.registerWorker(capabilities("w-raw"));
  const handle = dispatcher.submit(job("j1"));
  if (handle.disposition !== "admitted") throw new Error("unreachable");
  const claim = await dispatcher.claimJob("w-raw");
  if (claim === undefined) throw new Error("claim failed");
  return { dispatcher, clock, claim, result: handle.result };
}

describe("attempt reports (worker -> dispatcher)", () => {
  test("a succeeded report resolves the result envelope with exact timing", async () => {
    const { dispatcher, clock, claim, result } = await rawSetup();
    const ack = await dispatcher.reportResult(report(claim, "w-raw", "succeeded"));
    expect(ack).toMatchObject({ status: "recorded" });
    const outcome = await result;
    expect(outcome.status).toBe("succeeded");
    expect(outcome.output).toEqual({ from: "j1" });
    expect(outcome.attempts).toBe(1);
    expect(outcome.claims).toBe(1);
    expect(outcome.retriesUsed).toBe(0);
    expect(outcome.timing).toEqual({
      submittedAtMs: 0,
      startedAtMs: 10,
      queueWaitMs: 10,
      finishedAtMs: clock.now(),
      executionMs: 30,
    });
    expect(dispatcher.jobRecords()[0]?.events.map((event) => event.type)).toEqual([
      "submitted",
      "claimed",
      "succeeded",
    ]);
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

  test("a non-retryable failure resolves FAILED (not dead-lettered — W104 rule)", async () => {
    const { dispatcher, claim, result } = await rawSetup();
    const ack = await dispatcher.reportResult(
      report(claim, "w-raw", "failed", { retryable: false, errorClass: "media-invalid" }),
    );
    expect(ack.status).toBe("recorded");
    const outcome = await result;
    expect(outcome.status).toBe("failed");
    expect(outcome.failure).toMatchObject({
      errorClass: "media-invalid",
      terminal: "non-retryable",
    });
    expect(dispatcher.stats().failed).toBe(1);
    expect(dispatcher.deadLetters()).toHaveLength(0);
    void dispatcher.shutdown();
  });

  test("a retryable failure (budget exhausted worker-side) dead-letters retry-exhausted", async () => {
    const { dispatcher, claim, result } = await rawSetup();
    const ack = await dispatcher.reportResult(
      report(claim, "w-raw", "failed", {
        retryable: true,
        errorClass: "transient",
        attempts: 3,
      }),
    );
    expect(ack.status).toBe("recorded");
    const outcome = await result;
    expect(outcome.status).toBe("failed");
    expect(outcome.failure).toMatchObject({ errorClass: "transient", terminal: "retry-exhausted" });
    expect(outcome.attempts).toBe(3);
    expect(outcome.retriesUsed).toBe(2); // 3 attempts - 1 claim
    const dlq = dispatcher.deadLetters();
    expect(dlq).toHaveLength(1);
    expect(dlq[0]).toMatchObject({
      jobId: "j1",
      errorClass: "transient",
      terminal: "retry-exhausted",
      attempts: 3,
      claims: 1,
      retriesUsed: 2,
    });
    expect(dlq[0]!.job).toEqual(job("j1"));
    const settled = await dispatcher.shutdown();
    expectGpuBalanced(settled.stats, {
      jobsSubmitted: 1,
      admitted: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      deadLettered: 1,
    });
  });

  test("an internal errorClass dead-letters as internal (the thrown-fault mapping)", async () => {
    const { dispatcher, claim, result } = await rawSetup();
    await dispatcher.reportResult(
      report(claim, "w-raw", "failed", { errorClass: "internal", retryable: true }),
    );
    const outcome = await result;
    expect(outcome.failure?.terminal).toBe("internal");
    expect(dispatcher.deadLetters()[0]?.terminal).toBe("internal");
    void dispatcher.shutdown();
  });

  test("a timeout report resolves FAILED with the deadline classification", async () => {
    const { dispatcher, claim, result } = await rawSetup();
    await dispatcher.reportResult(
      report(claim, "w-raw", "timeout", {
        attempts: 0,
        // The reference worker's honest zero-attempt timings: no execution
        // happened, so no execution time and a placeholder start the
        // dispatcher ignores.
        timings: { startedAtMs: 40, finishedAtMs: 40, executionMs: 0, perAttempt: [] },
      }),
    );
    const outcome = await result;
    expect(outcome.status).toBe("failed");
    expect(outcome.failure).toMatchObject({
      errorClass: "deadline-timeout",
      terminal: "timeout",
    });
    expect(outcome.attempts).toBe(0); // never executed
    expect(dispatcher.stats().timeoutsDeadline).toBe(1);
    // A never-executed job has no startedAtMs/queueWaitMs in its timing:
    expect(outcome.timing.startedAtMs).toBeUndefined();
    expect(outcome.timing.queueWaitMs).toBeUndefined();
    expect(outcome.timing.executionMs).toBe(0);
    void dispatcher.shutdown();
  });

  test("superseded: a report with the wrong leaseId is counted, never delivered", async () => {
    const { dispatcher, claim } = await rawSetup();
    const stale = { ...report(claim, "w-raw", "succeeded"), leaseId: claim.leaseId + 99 };
    const ack = await dispatcher.reportResult(stale);
    expect(ack).toMatchObject({ status: "superseded", reason: "in-flight" });
    const stats = dispatcher.stats();
    expect(stats.lateResults).toBe(1);
    expect(stats.succeeded).toBe(0);
    expect(stats.reportedAttempts).toBe(1); // the invocations still happened
    expect(dispatcher.jobRecords()[0]?.attempts).toBe(1);
    void dispatcher.shutdown();
  });

  test("superseded: a report from a worker that does not own the lease", async () => {
    const { dispatcher, claim } = await rawSetup();
    await dispatcher.registerWorker(capabilities("w-other"));
    const ack = await dispatcher.reportResult(report(claim, "w-other", "succeeded"));
    expect(ack.status).toBe("superseded");
    expect(dispatcher.stats().lateResults).toBe(1);
    void dispatcher.shutdown();
  });

  test("superseded: a report for a terminally-disposed job (after a cancel)", async () => {
    const { dispatcher, claim } = await rawSetup();
    dispatcher.cancel("j1");
    const ack = await dispatcher.reportResult(report(claim, "w-raw", "succeeded"));
    expect(ack.status).toBe("superseded");
    expect(dispatcher.stats().lateResults).toBe(1);
    expect(dispatcher.jobRecords()[0]?.events.map((event) => event.type)).toEqual([
      "submitted",
      "claimed",
      "cancelled",
      "superseded-report",
    ]);
    void dispatcher.shutdown();
  });

  test("superseded: a report after the dispatcher ended (counted, ledgered)", async () => {
    const { dispatcher, claim } = await rawSetup();
    await dispatcher.shutdown();
    const ack = await dispatcher.reportResult(report(claim, "w-raw", "succeeded"));
    expect(ack).toMatchObject({ status: "superseded", reason: "dispatcher-ended" });
    expect(dispatcher.stats().lateResults).toBe(1);
    // The settled result is NOT retroactively mutated:
    expect(dispatcher.jobRecords()[0]?.state).toBe("cancelled");
    void dispatcher.shutdown();
  });

  test("unknown-job: a report naming a never-submitted job is counted and refused", async () => {
    const { dispatcher } = wiredDispatcher({});
    const ack = await dispatcher.reportResult({
      workerId: "w-1",
      jobId: "ghost",
      leaseId: 1,
      status: "succeeded",
      attempts: 1,
      timings: { startedAtMs: 0, finishedAtMs: 1, executionMs: 1, perAttempt: [] },
    });
    expect(ack.status).toBe("unknown-job");
    expect(dispatcher.stats().unknownReports).toBe(1);
    void dispatcher.shutdown();
  });

  test("malformed reports are refused, counted, and never increment reportedAttempts", async () => {
    const { dispatcher } = wiredDispatcher({});
    const bads: unknown[] = [
      null,
      { workerId: "w", jobId: "j", leaseId: 1 }, // no status/attempts/timings
      { workerId: "", jobId: "j", leaseId: 1, status: "succeeded", attempts: 1, timings: {} },
      {
        workerId: "w",
        jobId: "j",
        leaseId: 0,
        status: "succeeded",
        attempts: 1,
        timings: { startedAtMs: 0, finishedAtMs: 1, executionMs: 1, perAttempt: [] },
      },
    ];
    for (const bad of bads) {
      const ack = await dispatcher.reportResult(bad as never);
      expect(ack).toMatchObject({ status: "unknown-job", reason: "malformed-report" });
    }
    expect(dispatcher.stats().unknownReports).toBe(bads.length);
    expect(dispatcher.stats().reportedAttempts).toBe(0);
    void dispatcher.shutdown();
  });

  test("attempts accumulate across claims (the honest total)", async () => {
    const { dispatcher, clock, claim, result } = await rawSetup({ leaseMs: 300 });
    // Claim 1 reports late — after its lease already expired — so it is
    // counted superseded (its 1 invocation still lands on the record);
    // claim 2 (by w-2) reports 2 more invocations and succeeds. The result
    // envelope carries the HONEST SUM across both claims.
    await dispatcher.registerWorker(capabilities("w-2"));
    clock.advance(350); // past the 300 ms lease, before the sweep runs
    const late = await dispatcher.reportResult(report(claim, "w-raw", "succeeded"));
    expect(late.status).toBe("superseded");
    expect(dispatcher.stats().lateResults).toBe(1);
    const second = await dispatcher.claimJob("w-2");
    if (second === undefined) throw new Error("unreachable");
    expect(second.claimOrdinal).toBe(2);
    const ack = await dispatcher.reportResult(report(second, "w-2", "succeeded", { attempts: 2 }));
    expect(ack.status).toBe("recorded");
    const outcome = await result;
    expect(outcome.status).toBe("succeeded");
    expect(outcome.attempts).toBe(3); // 1 (superseded) + 2 (recorded)
    expect(outcome.claims).toBe(2);
    expect(outcome.retriesUsed).toBe(1); // 3 attempts - 2 claims
    expect(dispatcher.stats().reportedAttempts).toBe(3);
    expect(dispatcher.jobRecords()[0]?.attempts).toBe(3);
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

  test("attempts are metered by disposition (recorded vs superseded)", async () => {
    const { metrics } = capturedObservability();
    const { dispatcher, claim } = await rawWithMetrics(metrics);
    await dispatcher.reportResult(
      report(claim, "w-raw", "failed", { attempts: 2, retryable: true }),
    );
    dispatcher.submit(job("j2"));
    const claim2 = await dispatcher.claimJob("w-raw");
    await dispatcher.cancel("j2");
    await dispatcher.reportResult(report(claim2!, "w-raw", "succeeded", { attempts: 1 }));
    const snapshot = metrics.snapshot();
    const recorded = snapshot.counters.find(
      (c) => c.name === METRICS.attempts && c.labels.disposition === "recorded",
    );
    const superseded = snapshot.counters.find(
      (c) => c.name === METRICS.attempts && c.labels.disposition === "superseded",
    );
    expect(recorded?.value).toBe(2);
    expect(superseded?.value).toBe(1);
    void dispatcher.shutdown();
  });

  test("the result promise NEVER rejects — failures are values", async () => {
    const { dispatcher, claim, result } = await rawSetup();
    await dispatcher.reportResult(
      report(claim, "w-raw", "failed", { retryable: false, errorClass: "boom" }),
    );
    let rejected = false;
    void result.catch(() => {
      rejected = true;
    });
    await result;
    expect(rejected).toBe(false);
    void dispatcher.shutdown();
  });
});

/** rawSetup with captured metrics. */
async function rawWithMetrics(
  metrics: ReturnType<typeof capturedObservability>["metrics"],
): Promise<{
  dispatcher: ReturnType<typeof wiredDispatcher>["dispatcher"];
  claim: GpuJobClaim;
}> {
  const { dispatcher } = wiredDispatcher({ observability: { metrics } });
  await dispatcher.registerWorker(capabilities("w-raw"));
  const handle = dispatcher.submit(job("j1"));
  if (handle.disposition !== "admitted") throw new Error("unreachable");
  const claim = await dispatcher.claimJob("w-raw");
  if (claim === undefined) throw new Error("claim failed");
  return { dispatcher, claim };
}
