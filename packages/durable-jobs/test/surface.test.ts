/**
 * REL-012 public-surface tests: the vocabularies, the retry math, the
 * boundary schemas, the clock/id constitution and the typed error family —
 * pinned here so nothing ships untested.
 */
import { describe, expect, test } from "bun:test";
import {
  EnqueueJobInputSchema,
  JOB_STATES,
  JOBS_DEFAULT_EPOCH_MS,
  JobsApiError,
  JobsCancellationSignal,
  JobsConflictError,
  JobsIllegalTransitionError,
  JobsLeaseError,
  JobsNotFoundError,
  JobsStoreError,
  JobsValidationError,
  LEASED_STATES,
  RetryPolicySchema,
  TERMINAL_JOB_STATES,
  computeBackoffMs,
  createJobsDefaultClock,
  createManualClock,
  createSequentialIdSource,
  isJobsError,
  isTerminalJobState,
  toIsoUtc,
} from "../src";
import type { JobsFailureClass } from "../src";

describe("the frozen vocabularies", () => {
  test("the state vocabulary and its layers are pinned", () => {
    expect(JOB_STATES).toHaveLength(7);
    expect(TERMINAL_JOB_STATES).toEqual(["completed", "cancelled"]);
    expect(LEASED_STATES).toEqual(["leased", "running", "checkpointed"]);
    for (const state of TERMINAL_JOB_STATES) {
      expect(isTerminalJobState(state)).toBe(true);
    }
    expect(isTerminalJobState("queued")).toBe(false);
    // `failed` is NOT edge-terminal: the bounded retry requeues it.
    expect(isTerminalJobState("failed")).toBe(false);
  });
});

describe("the retry math (bounded backoff)", () => {
  const policy = {
    maxAttempts: 5,
    initialBackoffMs: 100,
    backoffFactor: 2,
    maxBackoffMs: 300,
  };

  test("grows exponentially per attempt", () => {
    expect(computeBackoffMs(policy, 1)).toBe(100);
    expect(computeBackoffMs(policy, 2)).toBe(200);
    expect(computeBackoffMs(policy, 3)).toBe(300); // capped: min(400, 300)
    expect(computeBackoffMs(policy, 4)).toBe(300);
    expect(computeBackoffMs(policy, 99)).toBe(300);
  });

  test("a zero backoff stays zero (immediate retries are legal)", () => {
    const zero = { maxAttempts: 2, initialBackoffMs: 0, backoffFactor: 1, maxBackoffMs: 0 };
    expect(computeBackoffMs(zero, 1)).toBe(0);
    expect(computeBackoffMs(zero, 2)).toBe(0);
  });

  test("RetryPolicySchema refuses malformed policies", () => {
    expect(
      RetryPolicySchema.safeParse({
        maxAttempts: 1,
        initialBackoffMs: 10,
        backoffFactor: 1,
        maxBackoffMs: 100,
      }).success,
    ).toBe(true);
    expect(
      RetryPolicySchema.safeParse({
        maxAttempts: 0,
        initialBackoffMs: 10,
        backoffFactor: 1,
        maxBackoffMs: 100,
      }).success,
    ).toBe(false);
    expect(
      RetryPolicySchema.safeParse({
        maxAttempts: 1,
        initialBackoffMs: 10,
        backoffFactor: 0.5,
        maxBackoffMs: 100,
      }).success,
    ).toBe(false);
    expect(
      RetryPolicySchema.safeParse({
        maxAttempts: 1,
        initialBackoffMs: 200,
        backoffFactor: 2,
        maxBackoffMs: 100,
      }).success,
    ).toBe(false);
  });

  test("EnqueueJobInputSchema defaults the policy and artifact refs", () => {
    const parsed = EnqueueJobInputSchema.safeParse({ kind: "noop", input: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.retryPolicy).toEqual({
        maxAttempts: 3,
        initialBackoffMs: 1_000,
        backoffFactor: 2,
        maxBackoffMs: 30_000,
      });
      expect(parsed.data.inputArtifactRefs).toEqual([]);
    }
    expect(EnqueueJobInputSchema.safeParse({ input: null }).success).toBe(false);
    expect(EnqueueJobInputSchema.safeParse({ kind: "", input: null }).success).toBe(false);
  });
});

describe("the clock/id constitution", () => {
  test("the deterministic default clock ticks from the shared epoch", () => {
    const clock = createJobsDefaultClock();
    expect(JOBS_DEFAULT_EPOCH_MS).toBe(Date.parse("2025-01-06T12:00:00.000Z"));
    expect(clock()).toBe(JOBS_DEFAULT_EPOCH_MS + 1);
    expect(clock()).toBe(JOBS_DEFAULT_EPOCH_MS + 2);
  });

  test("the manual clock advances time (lease/retry tests drive it)", () => {
    const clock = createManualClock(1_000);
    expect(clock()).toBe(1_000);
    expect(clock.advance(99)).toBe(1_099);
    expect(clock()).toBe(1_099);
    expect(clock.advance(1)).toBe(1_100);
    // The default start is the shared epoch.
    expect(createManualClock()()).toBe(JOBS_DEFAULT_EPOCH_MS);
  });

  test("the sequential id source is deterministic and namespaced", () => {
    const ids = createSequentialIdSource("job");
    expect(ids.nextId()).toBe("job-1");
    expect(ids.nextId()).toBe("job-2");
  });

  test("toIsoUtc formats the epoch", () => {
    expect(toIsoUtc(JOBS_DEFAULT_EPOCH_MS)).toBe("2025-01-06T12:00:00.000Z");
  });
});

describe("the typed error family", () => {
  test("every constructor carries its stable code and failure class", () => {
    const cases: Array<[JobsApiError, string, JobsFailureClass]> = [
      [new JobsValidationError("v", ["i"]), "jobs.validation", "validation"],
      [new JobsNotFoundError("n"), "jobs.not-found", "not-found"],
      [new JobsConflictError("c"), "jobs.conflict", "conflict"],
      [
        new JobsIllegalTransitionError("i", { from: "a", to: "b", reason: "r" }),
        "jobs.illegal-transition",
        "illegal-transition",
      ],
      [new JobsLeaseError("jobs.lease-held", "h"), "jobs.lease-held", "lease"],
      [new JobsLeaseError("jobs.lease-expired", "e"), "jobs.lease-expired", "lease"],
      [new JobsLeaseError("jobs.lease-not-held", "nh"), "jobs.lease-not-held", "lease"],
      [new JobsStoreError("jobs.store-write-failed", "w"), "jobs.store-write-failed", "store"],
      [new JobsStoreError("jobs.store-poisoned", "p"), "jobs.store-poisoned", "store"],
    ];
    for (const [error, code, failureClass] of cases) {
      expect(error.code).toBe(code);
      expect(error.failureClass).toBe(failureClass);
      expect(isJobsError(error)).toBe(true);
      expect(error).toBeInstanceOf(JobsApiError);
    }
    expect(isJobsError(new Error("plain"))).toBe(false);
    expect(isJobsError(new JobsCancellationSignal("x"))).toBe(false);
  });

  test("details ride along, JSON-safe", () => {
    const error = new JobsLeaseError("jobs.lease-held", "held by w1", { jobId: "job-1" });
    expect(error.details).toEqual({ jobId: "job-1" });
    expect(JSON.parse(JSON.stringify(error.details))).toEqual({ jobId: "job-1" });
  });

  test("the cancellation signal is control flow, not an Api error", () => {
    const signal = new JobsCancellationSignal("cancelled");
    expect(signal).toBeInstanceOf(Error);
    expect(signal.name).toBe("JobsCancellationSignal");
  });
});
