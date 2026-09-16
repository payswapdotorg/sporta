/**
 * The hosted package's own schema + budget teeth (W914 Wave 2).
 */
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_HOSTED_COMPUTE_BUDGETS,
  HostedJobExecution,
  resolveHostedComputeBudgets,
} from "../src/index";
import { TEST_EPOCH_MS } from "./helpers";

/** A minimal valid success envelope. */
function successEnvelope(): Record<string, unknown> {
  return {
    jobId: "j-1",
    status: "succeeded",
    outputs: [
      {
        schemaVersion: "1.0",
        artifactId: "a".repeat(64),
        contentHash: "a".repeat(64),
        contentType: "image/svg+xml",
        byteLength: 6,
        manifest: { frameCount: 1 },
        metadata: { sessionId: "s", renderId: "j-1", segmentId: "seg-1" },
        delivery: { mode: "inline", content: "<svg/>" },
      },
    ],
    consumedInputIds: ["in-1"],
    metering: {
      startedAtMs: TEST_EPOCH_MS,
      finishedAtMs: TEST_EPOCH_MS + 1,
      executionMs: 1,
      framesRendered: 1,
      segmentsEncoded: 1,
      segmentsStored: 1,
      bytesEncoded: 6,
      duplicateStores: 0,
    },
  };
}

describe("HostedJobExecution (the wire schema)", () => {
  it("accepts a valid success envelope", () => {
    expect(HostedJobExecution.safeParse(successEnvelope()).success).toBe(true);
  });

  it("rejects a failed envelope without failure details (never silent)", () => {
    const doc = { ...successEnvelope(), status: "failed", outputs: [] };
    expect(HostedJobExecution.safeParse(doc).success).toBe(false);
  });

  it("rejects a succeeded envelope with failure details attached", () => {
    const doc = {
      ...successEnvelope(),
      failure: { errorClass: "x", message: "y", terminal: "non-retryable", retryable: false },
    };
    expect(HostedJobExecution.safeParse(doc).success).toBe(false);
  });

  it("rejects a succeeded render job with NO outputs (renderer must be encodable)", () => {
    const doc = { ...successEnvelope(), outputs: [] };
    expect(HostedJobExecution.safeParse(doc).success).toBe(false);
  });

  it("is strict (unknown keys reject — wire-safe drift fails loud)", () => {
    const doc = { ...successEnvelope(), extra: true };
    expect(HostedJobExecution.safeParse(doc).success).toBe(false);
  });

  it("rejects negative metering counters", () => {
    const doc = JSON.parse(JSON.stringify(successEnvelope())) as Record<string, unknown>;
    (doc.metering as Record<string, unknown>).executionMs = -1;
    expect(HostedJobExecution.safeParse(doc).success).toBe(false);
  });
});

describe("HostedComputeBudgets", () => {
  it("the defaults derive from the documented Vercel Hobby limits", () => {
    expect(DEFAULT_HOSTED_COMPUTE_BUDGETS).toEqual({
      maxExecutionMs: 10_000,
      maxArtifactBytes: 1_000_000,
      maxJobDeadlineMs: 60_000,
      minJobDeadlineMs: 1_000,
      dispatchTimeoutMs: 5_000,
      maxConcurrentJobs: 4,
    });
  });

  it("caller overrides land on top of the defaults", () => {
    const resolved = resolveHostedComputeBudgets({ maxExecutionMs: 1, maxConcurrentJobs: 2 });
    expect(resolved.maxExecutionMs).toBe(1);
    expect(resolved.maxConcurrentJobs).toBe(2);
    expect(resolved.maxArtifactBytes).toBe(DEFAULT_HOSTED_COMPUTE_BUDGETS.maxArtifactBytes);
  });
});
