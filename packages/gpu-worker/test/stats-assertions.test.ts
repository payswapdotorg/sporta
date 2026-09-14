/**
 * Accounting-assertion tests (W303): the four identities and the ledger
 * consistency walk are the never-silent constitution — each check broken one
 * at a time must throw `RangeError` with the full breakdown (the W302
 * stats-assertions posture, mutation-detection teeth included).
 */
import { describe, expect, test } from "bun:test";
import { assertGpuAccounting, assertGpuLedgerConsistency, emptyGpuStats } from "../src/types";
import type { GpuDispatchStats, GpuJobRecord } from "../src/types";

/** A balanced stats snapshot with distinct, hand-derived bucket values. */
function balancedStats(): GpuDispatchStats {
  return {
    ...emptyGpuStats(),
    jobsSubmitted: 10,
    admitted: 8,
    duplicates: 2,
    succeeded: 3,
    failed: 2,
    cancelled: 1,
    deadLettered: 2,
    inFlight: 0,
    queuedJobs: 0,
    executingJobs: 0,
    dlqRetained: 2,
    dlqOverflow: 0,
    workersActive: 0,
  };
}

describe("assertGpuAccounting", () => {
  test("accepts a balanced snapshot", () => {
    expect(() => assertGpuAccounting(balancedStats())).not.toThrow();
  });

  test("accepts a balanced mid-run snapshot (in-flight > 0)", () => {
    const stats = {
      ...balancedStats(),
      jobsSubmitted: 10,
      admitted: 8,
      duplicates: 2,
      succeeded: 3,
      failed: 1,
      cancelled: 0,
      deadLettered: 1,
      dlqRetained: 1,
      inFlight: 3,
      queuedJobs: 2,
      executingJobs: 1,
    };
    expect(() => assertGpuAccounting(stats)).not.toThrow();
  });

  test("identity 1: jobsSubmitted != admitted + duplicates throws with the breakdown", () => {
    const stats = { ...balancedStats(), jobsSubmitted: 11 };
    expect(() => assertGpuAccounting(stats)).toThrow(RangeError);
    expect(() => assertGpuAccounting(stats)).toThrow(/jobsSubmitted 11 != /);
    expect(() => assertGpuAccounting(stats)).toThrow(/admitted 8 \+ duplicates 2/);
  });

  test("identity 2: admitted != terminal buckets + inFlight throws", () => {
    const stats = { ...balancedStats(), failed: 3 };
    expect(() => assertGpuAccounting(stats)).toThrow(/admitted 8 != succeeded 3 \+ failed 3/);
  });

  test("identity 3: inFlight != queued + executing throws", () => {
    // Identity 2 must hold so identity 3 is the check that fires: the
    // terminal buckets leave 3 admitted jobs in flight, but only 2 accounted
    // as queued/executing.
    const stats = {
      ...balancedStats(),
      succeeded: 3,
      failed: 1,
      cancelled: 0,
      deadLettered: 1,
      dlqRetained: 1,
      inFlight: 3,
      queuedJobs: 1,
      executingJobs: 1,
    };
    expect(() => assertGpuAccounting(stats)).toThrow(
      /inFlight 3 != queuedJobs 1 \+ executingJobs 1/,
    );
  });

  test("identity 4: deadLettered != retained + overflow throws", () => {
    const stats = { ...balancedStats(), dlqRetained: 1 };
    expect(() => assertGpuAccounting(stats)).toThrow(
      /deadLettered 2 != dlqRetained 1 \+ dlqOverflow 0/,
    );
  });

  test("empty stats balance trivially (all zeros)", () => {
    expect(() => assertGpuAccounting(emptyGpuStats())).not.toThrow();
  });
});

describe("assertGpuLedgerConsistency", () => {
  /** balancedStats() with the claims sum the balanced ledger below grants (10). */
  const ledgerStats = (): GpuDispatchStats => ({ ...balancedStats(), claimsGranted: 10 });

  /** A terminal ledger matching ledgerStats(). */
  function balancedRecords(): GpuJobRecord[] {
    const record = (jobId: string, state: GpuJobRecord["state"], claims: number): GpuJobRecord => ({
      jobId,
      idempotencyKey: `key-${jobId}`,
      kind: "encode",
      priority: 0,
      sequence: 0,
      submittedAtMs: 0,
      deadlineAtMs: 1_000,
      maxAttempts: 3,
      state,
      claims,
      attempts: claims,
      reportedExecutionMs: 0,
      events: [],
      correlationId: "corr",
      traceId: "trace",
    });
    return [
      record("a", "succeeded", 1),
      record("b", "succeeded", 2),
      record("c", "succeeded", 1),
      record("d", "failed", 1),
      record("e", "failed", 1),
      record("f", "cancelled", 0),
      record("g", "dead-lettered", 3),
      record("h", "dead-lettered", 1),
    ];
  }

  test("accepts a consistent ledger (buckets + claims sum match)", () => {
    expect(() => assertGpuLedgerConsistency(balancedRecords(), ledgerStats())).not.toThrow();
  });

  test("a live record at settle throws naming the job", () => {
    const records = balancedRecords();
    records.push({
      ...records[0]!,
      jobId: "live",
      state: "queued",
    });
    expect(() => assertGpuLedgerConsistency(records, ledgerStats())).toThrow(
      /job 'live' is still 'queued' at settle/,
    );
  });

  test("a bucket mismatch between ledger and stats throws", () => {
    const stats = { ...ledgerStats(), succeeded: 4 };
    expect(() => assertGpuLedgerConsistency(balancedRecords(), stats)).toThrow(
      /succeeded records 3 != stats 4/,
    );
  });

  test("a claims-sum mismatch throws", () => {
    const stats = { ...ledgerStats(), claimsGranted: 99 };
    expect(() => assertGpuLedgerConsistency(balancedRecords(), stats)).toThrow(
      /summed claims 10 != claimsGranted 99/,
    );
  });

  test("empty ledger + zero stats is consistent", () => {
    expect(() => assertGpuLedgerConsistency([], emptyGpuStats())).not.toThrow();
  });

  test("emptyGpuStats is all-zero and JSON-shaped like the dispatcher's stats", () => {
    const stats = emptyGpuStats();
    expect(stats.jobsSubmitted).toBe(0);
    expect(stats.admitted).toBe(0);
    expect(stats.inFlight).toBe(0);
    expect(stats.queuedJobs).toBe(0);
    expect(stats.executingJobs).toBe(0);
    expect(stats.workersActive).toBe(0);
    expect(JSON.parse(JSON.stringify(stats))).toEqual(stats);
  });
});
