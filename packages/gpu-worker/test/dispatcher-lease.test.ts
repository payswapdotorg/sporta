/**
 * Dispatch + lease tests (W303): grant semantics, deterministic priority
 * order, claim capacity, requirements matching, job-major claimer matching,
 * lease expiry → requeue (counted) → claim-budget exhaustion → dead-letter,
 * and lease renewal on heartbeat. Uses the RAW port (the dispatcher itself)
 * — the protocol level below GpuWorker.
 */
import { describe, expect, test } from "bun:test";
import { GPU_METRIC_NAMES as METRICS } from "../src/types";
import type { GpuAttemptReport, GpuJobClaim } from "../src/types";
import {
  capabilities,
  capturedObservability,
  expectGpuBalanced,
  job,
  requirements,
  until,
  wiredDispatcher,
} from "./helpers";

describe("dispatch + lease semantics", () => {
  test("register + claim grants a lease with the full claim envelope", async () => {
    const { dispatcher, clock } = wiredDispatcher({
      leaseMs: 300,
      defaultMaxAttempts: 2,
    });
    await dispatcher.registerWorker(capabilities("w-1"));
    dispatcher.submit(job("j1", { requirements: requirements() }));
    const claim = await dispatcher.claimJob("w-1");
    expect(claim).toBeDefined();
    if (claim === undefined) throw new Error("unreachable");
    expect(claim.job).toEqual(job("j1", { requirements: requirements() })); // value-identical
    expect(claim.claimOrdinal).toBe(1);
    expect(claim.leaseId).toBe(1);
    expect(claim.leaseExpiresAtMs).toBe(clock.now() + 300);
    expect(claim.deadlineAtMs).toBe(clock.now() + 10_000);
    expect(claim.maxAttempts).toBe(2);
    const stats = dispatcher.stats();
    expect(stats.claimsGranted).toBe(1);
    expect(stats.executingJobs).toBe(1);
    expect(stats.inFlight).toBe(1);
    const record = dispatcher.jobRecords()[0]!;
    expect(record.state).toBe("in-flight");
    expect(record.claims).toBe(1);
    expect(record.lease?.workerId).toBe("w-1");
    expect(record.events.map((event) => event.type)).toEqual(["submitted", "claimed"]);
    void dispatcher.shutdown();
  });

  test("claims run in priority order, ties by submission sequence (deterministic)", async () => {
    const { dispatcher } = wiredDispatcher({});
    await dispatcher.registerWorker(capabilities("w-1", { maxConcurrentJobs: 4 }));
    dispatcher.submit(job("low", { priority: 0 }));
    dispatcher.submit(job("high-2", { priority: 5 }));
    dispatcher.submit(job("high-1", { priority: 5 }));
    dispatcher.submit(job("mid", { priority: 2 }));
    const claimed: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const claim = await dispatcher.claimJob("w-1");
      claimed.push(claim!.job.jobId);
    }
    expect(claimed).toEqual(["high-2", "high-1", "mid", "low"]);
    void dispatcher.shutdown();
  });

  test("a job envelope's maxAttempts overrides the dispatcher default", async () => {
    const { dispatcher } = wiredDispatcher({ defaultMaxAttempts: 2 });
    await dispatcher.registerWorker(capabilities("w-1"));
    dispatcher.submit(job("j1", { maxAttempts: 7 }));
    const claim = await dispatcher.claimJob("w-1");
    expect(claim?.maxAttempts).toBe(7);
    expect(dispatcher.jobRecords()[0]?.maxAttempts).toBe(7);
    void dispatcher.shutdown();
  });

  test("claim matching honors maxConcurrentJobs (a full worker parks)", async () => {
    const { dispatcher } = wiredDispatcher({});
    await dispatcher.registerWorker(capabilities("w-1", { maxConcurrentJobs: 1 }));
    dispatcher.submit(job("j1"));
    dispatcher.submit(job("j2"));
    const first = await dispatcher.claimJob("w-1");
    expect(first?.job.jobId).toBe("j1");
    // The second claim parks: nothing resolves until the lease is released.
    const second = dispatcher.claimJob("w-1");
    let resolved = false;
    void second.then(() => {
      resolved = true;
    });
    await until(() => false, 200);
    expect(resolved).toBe(false);
    expect(dispatcher.stats().executingJobs).toBe(1);
    void dispatcher.shutdown();
  });

  test("claim matching honors declared memory and model classes", async () => {
    const { dispatcher } = wiredDispatcher({});
    // w-big makes both jobs admit (the never-fit envelope sees its capacity);
    // w-small is the matching target: it can run ONLY the fitting job.
    await dispatcher.registerWorker(
      capabilities("w-big", { memoryMb: 8_192, modelClasses: ["encode", "detect"] }),
    );
    await dispatcher.registerWorker(
      capabilities("w-small", { memoryMb: 1_024, modelClasses: ["encode"] }),
    );
    dispatcher.submit(job("j-big", { requirements: requirements({ memoryMb: 2_048 }) }));
    dispatcher.submit(job("j-class", { requirements: requirements({ modelClass: "detect" }) }));
    dispatcher.submit(
      job("j-fit", { requirements: requirements({ memoryMb: 1_024, modelClass: "encode" }) }),
    );
    const claim = await dispatcher.claimJob("w-small");
    expect(claim?.job.jobId).toBe("j-fit"); // the only runnable job for w-small
    void dispatcher.shutdown();
  });

  test("claimJob from an unknown or stale worker is counted and refuses (stop signal)", async () => {
    const { dispatcher } = wiredDispatcher({});
    await dispatcher.registerWorker(capabilities("w-1"));
    dispatcher.submit(job("j1"));
    // A stale worker: registered, then never heartbeats past the threshold.
    const { dispatcher: d2, clock } = wiredDispatcher({ staleAfterMs: 100 });
    await d2.registerWorker(capabilities("w-2"));
    clock.advance(101);
    const claim = await d2.claimJob("w-2");
    expect(claim).toBeUndefined();
    expect(d2.stats().rejectedClaims).toBe(1);
    const unknown = await dispatcher.claimJob("nope");
    expect(unknown).toBeUndefined();
    expect(dispatcher.stats().rejectedClaims).toBe(1);
    void dispatcher.shutdown();
    void d2.shutdown();
  });

  test("parked claimers: submit pumps the FIFO queue (no claim polling needed)", async () => {
    const { dispatcher } = wiredDispatcher({});
    await dispatcher.registerWorker(capabilities("w-1"));
    const parked = dispatcher.claimJob("w-1");
    let granted: GpuJobClaim | undefined;
    void parked.then((claim) => {
      granted = claim;
    });
    await until(() => false, 200);
    expect(granted).toBeUndefined(); // still parked with nothing ready
    dispatcher.submit(job("j1"));
    expect(await until(() => granted !== undefined)).toBe(true);
    expect(granted?.job.jobId).toBe("j1");
    void dispatcher.shutdown();
  });

  test("job-major matching: an ineligible parked claimer never head-of-line-blocks", async () => {
    const { dispatcher } = wiredDispatcher({});
    // Y (classes: ["other"]) parks FIRST; X (classes: ["encode"]) parks second.
    await dispatcher.registerWorker(capabilities("w-y", { modelClasses: ["other"] }));
    await dispatcher.registerWorker(capabilities("w-x", { modelClasses: ["encode"] }));
    const yClaim = dispatcher.claimJob("w-y");
    const xClaim = dispatcher.claimJob("w-x");
    // Then a job only X can run arrives, followed by one anyone can run.
    dispatcher.submit(job("j-encoded", { requirements: requirements({ modelClass: "encode" }) }));
    dispatcher.submit(job("j-any"));
    const x = await xClaim;
    const y = await yClaim;
    expect(x?.job.jobId).toBe("j-encoded");
    expect(y?.job.jobId).toBe("j-any");
    void dispatcher.shutdown();
  });

  test("lease expiry requeues within the claim budget (counted, ledgered, loud)", async () => {
    const { dispatcher, clock } = wiredDispatcher({
      leaseMs: 300,
      staleAfterMs: 10_000,
      defaultMaxAttempts: 3,
    });
    // A raw worker that claims but never reports or beats (the crash model
    // — its declared heartbeat interval is legal; it simply never sends one).
    await dispatcher.registerWorker(capabilities("w-raw"));
    dispatcher.submit(job("j1"));
    const first = await dispatcher.claimJob("w-raw");
    expect(first?.claimOrdinal).toBe(1);
    clock.advance(350); // past the lease (300), far from staleness (10 000)
    dispatcher.sweep(); // the public monitor seam
    const stats = dispatcher.stats();
    expect(stats.leaseExpiries).toBe(1);
    expect(stats.requeues).toBe(1);
    expect(stats.executingJobs).toBe(0);
    expect(stats.queuedJobs).toBe(1);
    const record = dispatcher.jobRecords()[0]!;
    expect(record.state).toBe("queued");
    expect(record.claims).toBe(1);
    expect(record.events.map((event) => event.type)).toEqual([
      "submitted",
      "claimed",
      "lease-expired",
      "requeued",
    ]);
    // The requeued job is claimable again (claimOrdinal 2).
    const second = await dispatcher.claimJob("w-raw");
    expect(second?.claimOrdinal).toBe(2);
    expect(second?.job.jobId).toBe("j1");
    void dispatcher.shutdown();
  });

  test("claim-budget exhaustion via lease expiry dead-letters (retry-exhausted, lease-expired)", async () => {
    const { dispatcher, clock } = wiredDispatcher({
      leaseMs: 300,
      staleAfterMs: 10_000,
      defaultMaxAttempts: 2,
    });
    await dispatcher.registerWorker(capabilities("w-raw"));
    const handle = dispatcher.submit(job("j1"));
    if (handle.disposition !== "admitted") throw new Error("unreachable");
    const first = await dispatcher.claimJob("w-raw");
    expect(first?.claimOrdinal).toBe(1);
    clock.advance(350);
    dispatcher.sweep();
    const second = await dispatcher.claimJob("w-raw");
    expect(second?.claimOrdinal).toBe(2);
    clock.advance(350);
    dispatcher.sweep();
    const result = await handle.result;
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      errorClass: "lease-expired",
      terminal: "retry-exhausted",
    });
    expect(result.claims).toBe(2);
    expect(result.attempts).toBe(0); // no attempt was ever reported
    expect(result.retriesUsed).toBe(-2); // the honest negative signal (§ PROTOCOL 4)
    const dlq = dispatcher.deadLetters();
    expect(dlq).toHaveLength(1);
    expect(dlq[0]).toMatchObject({
      jobId: "j1",
      errorClass: "lease-expired",
      terminal: "retry-exhausted",
      attempts: 0,
      claims: 2,
      retriesUsed: -2,
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
    expect(settled.stats.leaseExpiries).toBe(2);
    expect(settled.stats.requeues).toBe(1);
  });

  test("lease expiry fires at the boundary (>=, not >)", async () => {
    const { dispatcher, clock } = wiredDispatcher({ leaseMs: 300, staleAfterMs: 10_000 });
    await dispatcher.registerWorker(capabilities("w-raw"));
    dispatcher.submit(job("j1"));
    await dispatcher.claimJob("w-raw");
    clock.advance(299);
    dispatcher.sweep();
    expect(dispatcher.stats().leaseExpiries).toBe(0); // still leased
    clock.advance(1); // exactly at the expiry
    dispatcher.sweep();
    expect(dispatcher.stats().leaseExpiries).toBe(1);
    void dispatcher.shutdown();
  });

  test("a report racing its lease expiry LOSES to the sweep (counted superseded)", async () => {
    const { dispatcher, clock } = wiredDispatcher({ leaseMs: 300, staleAfterMs: 10_000 });
    await dispatcher.registerWorker(capabilities("w-raw"));
    dispatcher.submit(job("j1"));
    const claim = await dispatcher.claimJob("w-raw");
    clock.advance(350); // lease expired; nothing swept yet
    const ack = await dispatcher.reportResult(reportFor(claim!, "w-raw", "succeeded"));
    // reportResult sweeps at entry: the job was requeued; the report is superseded.
    expect(ack.status).toBe("superseded");
    expect(dispatcher.stats().lateResults).toBe(1);
    expect(dispatcher.stats().succeeded).toBe(0);
    const record = dispatcher.jobRecords()[0]!;
    expect(record.state).toBe("queued");
    // The executor invocations still happened: attempts counted on the record.
    expect(record.attempts).toBe(1);
    void dispatcher.shutdown();
  });

  test("every accepted heartbeat renews live leases forward (forward only)", async () => {
    const { dispatcher, clock } = wiredDispatcher({ leaseMs: 300, staleAfterMs: 10_000 });
    await dispatcher.registerWorker(
      capabilities("w-1", { heartbeatIntervalMs: 100, maxConcurrentJobs: 1 }),
    );
    dispatcher.submit(job("j1"));
    await dispatcher.claimJob("w-1");
    expect(dispatcher.jobRecords()[0]?.lease?.leaseExpiresAtMs).toBe(300);
    // Heartbeats at 100 and 200 extend the lease to 400, then 500.
    clock.advance(100);
    await beat(dispatcher, "w-1", 1);
    expect(dispatcher.jobRecords()[0]?.lease?.leaseExpiresAtMs).toBe(400);
    clock.advance(100);
    await beat(dispatcher, "w-1", 2);
    expect(dispatcher.jobRecords()[0]?.lease?.leaseExpiresAtMs).toBe(500);
    // Far past the ORIGINAL expiry, the renewed lease still holds:
    clock.advance(150); // now = 350 > 300
    dispatcher.sweep();
    expect(dispatcher.stats().leaseExpiries).toBe(0);
    void dispatcher.shutdown();
  });

  test("the claims metric counts every grant", async () => {
    const { metrics } = capturedObservability();
    const { dispatcher } = wiredDispatcher({ observability: { metrics } });
    await dispatcher.registerWorker(capabilities("w-raw"));
    dispatcher.submit(job("j1"));
    await dispatcher.claimJob("w-raw");
    expect(metrics.snapshot().counters.find((c) => c.name === METRICS.claims)?.value).toBe(1);
    void dispatcher.shutdown();
  });
});

/** Emits one heartbeat for `workerId` with the given sequence. */
async function beat(
  dispatcher: {
    heartbeat: (
      id: string,
      hb: { sequence: number; dueMs: number; inFlight: number; advisoryMemoryInUseMb: number },
    ) => Promise<{ accepted: boolean }>;
  },
  workerId: string,
  sequence: number,
): Promise<void> {
  const ack = await dispatcher.heartbeat(workerId, {
    sequence,
    dueMs: 0,
    inFlight: 0,
    advisoryMemoryInUseMb: 0,
  });
  if (!ack.accepted) throw new Error("expected heartbeat acceptance");
}

/** A raw-port report payload for a claim (minimal valid shape, caller-tuned). */
function reportFor(
  claim: GpuJobClaim,
  workerId: string,
  status: "succeeded" | "failed" | "timeout",
  extras: Partial<{
    output: unknown;
    errorClass: string;
    message: string;
    retryable: boolean;
    attempts: number;
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
    timings: {
      startedAtMs: 0,
      finishedAtMs: 1,
      executionMs: 1,
      perAttempt: [{ startedAtMs: 0, durationMs: 1 }],
    },
  };
}
