/**
 * Schema-validation tests (W914 Wave 1): strictness (unknown-key rejection),
 * closed vocabularies (invented values reject), cross-field invariants
 * (status/disposition coupling, content addressing, input-accounting
 * partition, cost-unit uniqueness, timing ordering), and the versioned
 * schemaVersion literal.
 */
import { describe, expect, it } from "bun:test";
import {
  COMPUTE_SCHEMA_VERSION,
  ComputeAdapterDescriptor,
  ComputeCancelOutcome,
  ComputeDispatchOutcome,
  ComputeInputAccounting,
  ComputeJobCompletion,
  ComputeJobDescription,
  ComputeJobEvent,
  ComputeJobSnapshot,
  ComputeJobState,
  ComputeJobTiming,
  ComputeOutputArtifact,
  ComputeUsageRecord,
} from "../src/schemas";
import { makeArtifact, makeCompletion, makeDescriptor, makeJob } from "./helpers";

describe("ComputeJobDescription (the transport-safe job description)", () => {
  it("accepts the happy shape", () => {
    const parsed = ComputeJobDescription.safeParse(makeJob());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.jobId).toBe("compute-job-1");
      expect(parsed.data.inputs).toHaveLength(2);
      expect(parsed.data.renderer.rendererId).toBe("anime.prototype");
    }
  });

  it("rejects unknown top-level keys (wire-safe strictness)", () => {
    const parsed = ComputeJobDescription.safeParse({ ...makeJob(), gpuVendor: "acme" });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown keys in every nested shape", () => {
    for (const override of [
      { renderer: { ...makeJob().renderer, extra: 1 } },
      { recipe: { ...makeJob().recipe, extra: 1 } },
      { outputProfile: { ...(makeJob().outputProfile as object), extra: 1 } },
      { rights: { ...(makeJob().rights as object), extra: 1 } },
      { constraints: { ...(makeJob().constraints as object), extra: 1 } },
    ]) {
      expect(ComputeJobDescription.safeParse(makeJob(override)).success).toBe(false);
    }
  });

  it("rejects unknown keys in an inputs-manifest entry and in resourceHints", () => {
    expect(
      ComputeJobDescription.safeParse(
        makeJob({ inputs: [{ ...(makeJob().inputs as object[])[0], extra: 1 }] }),
      ).success,
    ).toBe(false);
    expect(
      ComputeJobDescription.safeParse({
        constraints: { deadlineMs: 1000, resourceHints: { memoryMb: 1, gpu: "acme" } },
      }).success,
    ).toBe(false);
  });

  it("pins the schemaVersion literal (cross-version negotiation is explicit)", () => {
    expect(ComputeJobDescription.safeParse(makeJob({ schemaVersion: "2.0" })).success).toBe(
      false,
    );
    expect(ComputeJobDescription.safeParse(makeJob({ schemaVersion: "1.1" })).success).toBe(
      false,
    );
    expect(COMPUTE_SCHEMA_VERSION).toBe("1.0");
  });

  it("closed vocabulary: an invented input kind rejects", () => {
    expect(
      ComputeJobDescription.safeParse(
        makeJob({ inputs: [{ inputId: "x", kind: "swm-whatnot", ref: "r" }] }),
      ).success,
    ).toBe(false);
  });

  it("closed vocabulary: an invented latency class rejects", () => {
    expect(
      ComputeJobDescription.safeParse({
        outputProfile: {
          resolution: { w: 1, h: 1 },
          frameRate: 1,
          codec: "svg",
          container: "svg",
          latencyClass: "realtime",
        },
      }).success,
    ).toBe(false);
  });

  it("requires at least one input and unique inputIds", () => {
    expect(ComputeJobDescription.safeParse(makeJob({ inputs: [] })).success).toBe(false);
    expect(
      ComputeJobDescription.safeParse(
        makeJob({
          inputs: [
            { inputId: "dup", kind: "swm-snapshot", ref: "r1" },
            { inputId: "dup", kind: "swm-snapshot", ref: "r2" },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("deadline and attempt constraints follow the W303 envelope rules", () => {
    expect(ComputeJobDescription.safeParse(makeJob({ constraints: { deadlineMs: 0 } })).success).toBe(
      false,
    );
    expect(
      ComputeJobDescription.safeParse(makeJob({ constraints: { deadlineMs: -1 } })).success,
    ).toBe(false);
    expect(
      ComputeJobDescription.safeParse(makeJob({ constraints: { deadlineMs: Number.POSITIVE_INFINITY } }))
        .success,
    ).toBe(false);
    expect(
      ComputeJobDescription.safeParse(makeJob({ constraints: { deadlineMs: 1000, maxAttempts: 0 } }))
        .success,
    ).toBe(false);
    expect(
      ComputeJobDescription.safeParse(makeJob({ constraints: { deadlineMs: 1000, priority: 0.5 } }))
        .success,
    ).toBe(false);
  });

  it("content hashes must be 64 lowercase hex digits (the W504 convention)", () => {
    expect(
      ComputeJobDescription.safeParse(
        makeJob({
          inputs: [{ inputId: "x", kind: "swm-snapshot", ref: "r", contentHash: "XYZ" }],
        }),
      ).success,
    ).toBe(false);
    expect(
      ComputeJobDescription.safeParse(
        makeJob({
          inputs: [{ inputId: "x", kind: "swm-snapshot", ref: "r", contentHash: "A".repeat(64) }],
        }),
      ).success,
    ).toBe(false);
  });
});

describe("ComputeAdapterDescriptor (provider-neutral capability declaration)", () => {
  it("accepts the honest test descriptor", () => {
    expect(ComputeAdapterDescriptor.safeParse(makeDescriptor()).success).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(ComputeAdapterDescriptor.safeParse({ ...makeDescriptor(), region: "eu" }).success).toBe(
      false,
    );
  });

  it("closed vocabulary: a VENDOR provider kind rejects (architecture-lock §9)", () => {
    expect(ComputeAdapterDescriptor.safeParse(makeDescriptor({ providerKind: "aws-ec2" })).success).toBe(
      false,
    );
    expect(ComputeAdapterDescriptor.safeParse(makeDescriptor({ providerKind: "gcp" })).success).toBe(
      false,
    );
  });

  it("closed vocabulary: an invented cost-unit kind rejects", () => {
    expect(
      ComputeAdapterDescriptor.safeParse({
        ...makeDescriptor(),
        costUnits: [{ unitId: "usd", unitKind: "currency" }],
      }).success,
    ).toBe(false);
  });

  it("requires at least one supported renderer and one cost unit (metering is not optional)", () => {
    expect(ComputeAdapterDescriptor.safeParse(makeDescriptor({ supportedRenderers: [] })).success).toBe(
      false,
    );
    expect(ComputeAdapterDescriptor.safeParse(makeDescriptor({ costUnits: [] })).success).toBe(false);
  });

  it("rejects duplicate renderer ids and duplicate cost-unit ids", () => {
    expect(
      ComputeAdapterDescriptor.safeParse({
        ...makeDescriptor(),
        supportedRenderers: [
          { rendererId: "anime.prototype" },
          { rendererId: "anime.prototype", rendererVersions: ["0.1.0"] },
        ],
      }).success,
    ).toBe(false);
    expect(
      ComputeAdapterDescriptor.safeParse({
        ...makeDescriptor(),
        costUnits: [
          { unitId: "compute-ms", unitKind: "time-ms" },
          { unitId: "compute-ms", unitKind: "count" },
        ],
      }).success,
    ).toBe(false);
  });

  it("deadline bounds must be self-consistent", () => {
    expect(
      ComputeAdapterDescriptor.safeParse({
        ...makeDescriptor(),
        minJobDeadlineMs: 700_000,
        maxJobDeadlineMs: 600_000,
      }).success,
    ).toBe(false);
  });

  it("adapterVersion must be MAJOR.MINOR", () => {
    expect(ComputeAdapterDescriptor.safeParse(makeDescriptor({ adapterVersion: "1" })).success).toBe(
      false,
    );
    expect(
      ComputeAdapterDescriptor.safeParse(makeDescriptor({ adapterVersion: "v1.0" })).success,
    ).toBe(false);
  });
});

describe("lifecycle/event vocabularies (closed)", () => {
  it("the state vocabulary is exactly the 8 aligned states", () => {
    expect(ComputeJobState.safeParse("admitted").success).toBe(true);
    expect(ComputeJobState.safeParse("dispatched").success).toBe(true);
    expect(ComputeJobState.safeParse("queued").success).toBe(true);
    expect(ComputeJobState.safeParse("in-flight").success).toBe(true);
    for (const state of ["running", "pending", "processing", "completed", "error", "retrying"]) {
      expect(ComputeJobState.safeParse(state).success).toBe(false);
    }
  });

  it("an invented event type rejects", () => {
    expect(
      ComputeJobEvent.safeParse({
        schemaVersion: "1.0",
        jobId: "j",
        type: "began",
        atMs: 1,
      }).success,
    ).toBe(false);
  });

  it("progress events carry a legal fraction (0 < fraction <= 1)", () => {
    const base = { schemaVersion: "1.0", jobId: "j", type: "progress", atMs: 1 } as const;
    expect(ComputeJobEvent.safeParse({ ...base, fraction: 0.5 }).success).toBe(true);
    expect(ComputeJobEvent.safeParse({ ...base, fraction: 1 }).success).toBe(true);
    expect(ComputeJobEvent.safeParse({ ...base, fraction: 0 }).success).toBe(false);
    expect(ComputeJobEvent.safeParse({ ...base, fraction: 1.5 }).success).toBe(false);
    expect(
      ComputeJobEvent.safeParse({ ...base, fraction: Number.NaN }).success,
    ).toBe(false);
  });

  it("progress events may carry a stage label; other events may carry JSON details", () => {
    expect(
      ComputeJobEvent.safeParse({ schemaVersion: "1.0", jobId: "j", type: "progress", atMs: 1, fraction: 0.5, stage: "encoding" })
        .success,
    ).toBe(true);
    expect(
      ComputeJobEvent.safeParse({
        schemaVersion: "1.0",
        jobId: "j",
        type: "claimed",
        atMs: 1,
        details: { claimOrdinal: 1 },
      }).success,
    ).toBe(true);
  });
});

describe("ComputeOutputArtifact (the W504-aligned handoff)", () => {
  it("accepts the content-addressed happy shape (inline delivery)", () => {
    expect(ComputeOutputArtifact.safeParse(makeArtifact()).success).toBe(true);
  });

  it("contentHash MUST equal artifactId (content addressing is identity)", () => {
    expect(
      ComputeOutputArtifact.safeParse(makeArtifact({ contentHash: "b".repeat(64) })).success,
    ).toBe(false);
  });

  it("inline delivery must report the true byte length", () => {
    expect(ComputeOutputArtifact.safeParse(makeArtifact({ byteLength: 4 })).success).toBe(false);
  });

  it("stored delivery carries a store receipt instead of content", () => {
    expect(
      ComputeOutputArtifact.safeParse(
        makeArtifact({ delivery: { mode: "stored", receipt: { storeId: "r2-primary", storedAtMs: 1 } } }),
      ).success,
    ).toBe(true);
    expect(
      ComputeOutputArtifact.safeParse(makeArtifact({ delivery: { mode: "stored" } })).success,
    ).toBe(false);
  });

  it("rejects unknown metadata keys (the W504 AnimeArtifactMetadata field names)", () => {
    expect(
      ComputeOutputArtifact.safeParse(makeArtifact({ metadata: { ...(makeArtifact().metadata as object), bucket: "x" } }))
        .success,
    ).toBe(false);
  });
});

describe("ComputeInputAccounting (never-silent partition)", () => {
  it("accepts a clean partition", () => {
    expect(
      ComputeInputAccounting.safeParse({
        consumedInputIds: ["a"],
        unconsumedInputs: [{ inputId: "b", reason: "job-cancelled" }],
      }).success,
    ).toBe(true);
  });

  it("rejects an input accounted in BOTH lists", () => {
    expect(
      ComputeInputAccounting.safeParse({
        consumedInputIds: ["a"],
        unconsumedInputs: [{ inputId: "a", reason: "x" }],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate entries within a list and reasons are required", () => {
    expect(
      ComputeInputAccounting.safeParse({
        consumedInputIds: ["a", "a"],
        unconsumedInputs: [],
      }).success,
    ).toBe(false);
    expect(
      ComputeInputAccounting.safeParse({
        consumedInputIds: [],
        unconsumedInputs: [{ inputId: "a", reason: "" }],
      }).success,
    ).toBe(false);
  });
});

describe("ComputeJobCompletion (the terminal envelope)", () => {
  const job = ComputeJobDescription.parse(makeJob());

  it("accepts the succeeded happy shape", () => {
    expect(ComputeJobCompletion.safeParse(makeCompletion(job)).success).toBe(true);
  });

  it("dead-lettered resolves status failed; every other disposition maps 1:1", () => {
    expect(
      ComputeJobCompletion.safeParse(
        makeCompletion(job, {
          status: "failed",
          terminalDisposition: "dead-lettered",
          outputs: [],
          failure: { errorClass: "render-error", message: "boom", terminal: "retry-exhausted" },
        }),
      ).success,
    ).toBe(true);
    expect(
      ComputeJobCompletion.safeParse(makeCompletion(job, { status: "succeeded", terminalDisposition: "dead-lettered" }))
        .success,
    ).toBe(false);
    expect(
      ComputeJobCompletion.safeParse(makeCompletion(job, { status: "cancelled", terminalDisposition: "succeeded" }))
        .success,
    ).toBe(false);
  });

  it("failure presence couples to status failed", () => {
    const failure = { errorClass: "render-refused", message: "no", terminal: "non-retryable" };
    expect(
      ComputeJobCompletion.safeParse(
        makeCompletion(job, { status: "failed", terminalDisposition: "failed", outputs: [], failure }),
      ).success,
    ).toBe(true);
    expect(
      ComputeJobCompletion.safeParse(
        makeCompletion(job, { status: "failed", terminalDisposition: "failed", outputs: [] }),
      ).success,
    ).toBe(false);
    expect(
      ComputeJobCompletion.safeParse(makeCompletion(job, { status: "cancelled", terminalDisposition: "cancelled", outputs: [], failure }))
        .success,
    ).toBe(false);
  });

  it("outputs are only legal on success", () => {
    expect(
      ComputeJobCompletion.safeParse(
        makeCompletion(job, { status: "cancelled", terminalDisposition: "cancelled", outputs: [makeArtifact()] }),
      ).success,
    ).toBe(false);
  });

  it("terminal class couples to the bucket (W303 §7)", () => {
    // failed bucket: non-retryable / timeout only.
    expect(
      ComputeJobCompletion.safeParse(
        makeCompletion(job, {
          status: "failed",
          terminalDisposition: "failed",
          outputs: [],
          failure: { errorClass: "x", message: "m", terminal: "retry-exhausted" },
        }),
      ).success,
    ).toBe(false);
    // dead-lettered bucket: retry-exhausted / internal only.
    expect(
      ComputeJobCompletion.safeParse(
        makeCompletion(job, {
          status: "failed",
          terminalDisposition: "dead-lettered",
          outputs: [],
          failure: { errorClass: "x", message: "m", terminal: "timeout" },
        }),
      ).success,
    ).toBe(false);
  });

  it("the usage record must meter the SAME job and disposition", () => {
    const withWrongJob = makeCompletion(job);
    const usage = withWrongJob.usage as Record<string, unknown>;
    expect(
      ComputeJobCompletion.safeParse(
        makeCompletion(job, { usage: { ...usage, jobId: "other-job" } }),
      ).success,
    ).toBe(false);
    expect(
      ComputeJobCompletion.safeParse(
        makeCompletion(job, {
          status: "cancelled",
          terminalDisposition: "cancelled",
          outputs: [],
          usage: { ...usage, terminalDisposition: "cancelled" },
        }),
      ).success,
    ).toBe(true);
    expect(
      ComputeJobCompletion.safeParse(
        makeCompletion(job, {
          status: "cancelled",
          terminalDisposition: "cancelled",
          outputs: [],
          usage: { ...usage, terminalDisposition: "failed" },
        }),
      ).success,
    ).toBe(false);
  });

  it("timing must be internally ordered", () => {
    expect(ComputeJobTiming.safeParse({ submittedAtMs: 5, startedAtMs: 3, finishedAtMs: 9, executionMs: 1 }).success).toBe(
      false,
    );
    expect(ComputeJobTiming.safeParse({ submittedAtMs: 5, finishedAtMs: 3, executionMs: 0 }).success).toBe(
      false,
    );
    expect(
      ComputeJobTiming.safeParse({ submittedAtMs: 5, startedAtMs: 6, finishedAtMs: 9, executionMs: 3 }).success,
    ).toBe(true);
    expect(ComputeJobTiming.safeParse({ submittedAtMs: 5, finishedAtMs: 9, executionMs: 0 }).success).toBe(true);
  });
});

describe("ComputeUsageRecord (metering)", () => {
  const base = {
    schemaVersion: "1.0",
    jobId: "j",
    idempotencyKey: "k",
    sessionId: "s",
    adapterId: "a",
    providerId: "p",
    terminalDisposition: "succeeded",
    timing: { queueWaitMs: 1, executionMs: 2 },
    attempts: 1,
    claims: 1,
    costUnits: [{ unitId: "compute-ms", quantity: 3 }],
    meteredAtMs: 9,
  };

  it("accepts the happy shape", () => {
    expect(ComputeUsageRecord.safeParse(base).success).toBe(true);
  });

  it("rejects duplicate cost units, negative quantities, negative timing, and unknown keys", () => {
    expect(
      ComputeUsageRecord.safeParse({
        ...base,
        costUnits: [
          { unitId: "compute-ms", quantity: 1 },
          { unitId: "compute-ms", quantity: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      ComputeUsageRecord.safeParse({ ...base, costUnits: [{ unitId: "compute-ms", quantity: -1 }] })
        .success,
    ).toBe(false);
    expect(ComputeUsageRecord.safeParse({ ...base, timing: { queueWaitMs: -1, executionMs: 0 } }).success).toBe(
      false,
    );
    expect(ComputeUsageRecord.safeParse({ ...base, currency: "EUR" }).success).toBe(false);
  });

  it("requires at least one cost quantity (a terminal job with NO metering rejects)", () => {
    expect(ComputeUsageRecord.safeParse({ ...base, costUnits: [] }).success).toBe(false);
  });
});

describe("dispatch / cancel outcome discriminators", () => {
  it("dispatch outcomes are admitted|duplicate only", () => {
    expect(
      ComputeDispatchOutcome.safeParse({
        disposition: "admitted",
        handle: {
          schemaVersion: "1.0",
          jobId: "j",
          idempotencyKey: "k",
          sessionId: "s",
          rendererId: "anime.prototype",
          adapterId: "a",
          admittedAtMs: 1,
        },
      }).success,
    ).toBe(true);
    expect(
      ComputeDispatchOutcome.safeParse({ disposition: "queued", jobId: "j" }).success,
    ).toBe(false);
  });

  it("cancel outcomes follow the W303 GpuCancelOutcome shape", () => {
    expect(ComputeCancelOutcome.safeParse({ cancelled: true, jobId: "j" }).success).toBe(true);
    expect(
      ComputeCancelOutcome.safeParse({ cancelled: false, jobId: "j", terminalDisposition: "succeeded" })
        .success,
    ).toBe(true);
    expect(ComputeCancelOutcome.safeParse({ cancelled: false, jobId: "j" }).success).toBe(false);
  });
});

describe("ComputeJobSnapshot (poll result)", () => {
  const job = ComputeJobDescription.parse(makeJob());

  it("terminal snapshots REQUIRE the completion envelope", () => {
    expect(
      ComputeJobSnapshot.safeParse({
        schemaVersion: "1.0",
        jobId: "j",
        idempotencyKey: "k",
        sessionId: "s",
        state: "succeeded",
        events: [],
      }).success,
    ).toBe(false);
  });

  it("live snapshots must NOT carry a completion envelope", () => {
    expect(
      ComputeJobSnapshot.safeParse({
        schemaVersion: "1.0",
        jobId: "j",
        idempotencyKey: "k",
        sessionId: "s",
        state: "queued",
        events: [],
        completion: makeCompletion(job),
      }).success,
    ).toBe(false);
  });

  it("the state must equal the completion's terminalDisposition", () => {
    expect(
      ComputeJobSnapshot.safeParse({
        schemaVersion: "1.0",
        jobId: "j",
        idempotencyKey: "k",
        sessionId: "s",
        state: "cancelled",
        events: [],
        completion: makeCompletion(job),
      }).success,
    ).toBe(false);
  });

  it("the live happy shape parses", () => {
    expect(
      ComputeJobSnapshot.safeParse({
        schemaVersion: "1.0",
        jobId: "j",
        idempotencyKey: "k",
        sessionId: "s",
        state: "in-flight",
        events: [
          { schemaVersion: "1.0", jobId: "j", type: "submitted", atMs: 1 },
          { schemaVersion: "1.0", jobId: "j", type: "progress", atMs: 2, fraction: 0.5 },
        ],
      }).success,
    ).toBe(true);
  });
});
