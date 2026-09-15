/**
 * In-memory reference-adapter tests (W914 Wave 1): the deterministic proof
 * that the compute-adapter contract is implementable AND that its in-memory
 * reference honors it — descriptor admission honesty, the W303 idempotency
 * posture, the lifecycle state machine on every change, accounting totality
 * on success AND failure paths, metering invariants, cancellation (including
 * the cancel-wins-during-handoff race), progress events, and the settle-time
 * accounting assertions.
 *
 * Everything is driven through the simulated provider port
 * (`adapter.provider`) and the injected counter clock — the reference reads
 * no time source of its own (pinned by test/boundary.test.ts).
 */
import { describe, expect, test } from "bun:test";
import {
  ComputeJobDescription,
  ComputeJobSnapshot,
  ComputeOutputArtifact,
  ComputeUsageRecord,
  emptyComputeStats,
} from "../src/schemas";
import type { ComputeOutputArtifact as ComputeOutputArtifactType } from "../src/schemas";
import { assertComputeAccounting } from "../src/accounting";
import { awaitCompletion } from "../src/adapter";
import type { ComputeProviderSubmission } from "../src/adapter";
import {
  ComputeAdmissionError,
  ComputeAdapterMisuseError,
  ComputeResourceLimitError,
  ComputeRightsError,
  ComputeValidationError,
  UnknownComputeJobError,
} from "../src/errors";
import {
  DEFAULT_IN_MEMORY_LIMITS,
  InMemoryComputeAdapter,
  type MeterUsageFn,
} from "../src/memory-adapter";
import { makeArtifact, makeCounter, makeDescriptor, makeJob } from "./helpers";

/** Parses the shared job fixture with per-test identity overrides. */
function jobWith(overrides: Record<string, unknown> = {}): ComputeJobDescription {
  return ComputeJobDescription.parse(makeJob(overrides));
}

/** A valid content-addressed artifact, typed for the provider seam. */
function artifact(): ComputeOutputArtifactType {
  return makeArtifact() as unknown as ComputeOutputArtifactType;
}

/** A minimal adapter with the counter clock (the standard rig). */
function makeAdapter(
  options: Partial<ConstructorParameters<typeof InMemoryComputeAdapter>[0]> = {},
): InMemoryComputeAdapter {
  const { descriptor = makeDescriptor(), nowMs = makeCounter(), ...rest } = options;
  return new InMemoryComputeAdapter({ descriptor, nowMs, ...rest });
}

describe("construction", () => {
  test("rejects an invalid descriptor loudly (misuse, not a dispatch)", () => {
    let error: unknown;
    try {
      makeAdapter({ descriptor: makeDescriptor({ maxConcurrentJobs: 0 }) });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ComputeAdapterMisuseError);
    expect((error as Error).message).toContain("valid ComputeAdapterDescriptor");
  });

  test("exposes the frozen descriptor and the test-drive provider port", () => {
    const adapter = makeAdapter();
    expect(adapter.describe()).toEqual(makeDescriptor());
    expect(adapter.provider).toBeDefined();
    expect(DEFAULT_IN_MEMORY_LIMITS.maxQueuedJobs).toBe(64);
  });
});

describe("dispatch — descriptor honesty (admission is refused before any work)", () => {
  test("admits the happy shape and queues it synchronously", async () => {
    const adapter = makeAdapter();
    const outcome = await adapter.dispatch(jobWith());
    expect(outcome.disposition).toBe("admitted");
    if (outcome.disposition !== "admitted") return;
    expect(outcome.handle.jobId).toBe("compute-job-1");
    expect(outcome.handle.adapterId).toBe("compute-test-0");
    expect(outcome.handle.rendererId).toBe("anime.prototype");
    expect(outcome.handle.admittedAtMs).toBeGreaterThan(0);
    const snapshot = await adapter.getJobOrFail("compute-job-1");
    expect(snapshot.state).toBe("queued");
    expect(snapshot.events.map((e) => e.type)).toEqual(["submitted", "dispatched"]);
  });

  test("refuses an unsupported renderer (ComputeAdmissionError, counted)", async () => {
    const adapter = makeAdapter();
    let error: unknown;
    try {
      await adapter.dispatch(jobWith({ renderer: { rendererId: "tactical.prototype" } }));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ComputeAdmissionError);
    expect((error as ComputeAdmissionError).terminalFailureClass).toBe("media-invalid");
    expect(adapter.stats().refusedAdmissions).toBe(1);
    expect(adapter.stats().admitted).toBe(0);
  });

  test("refuses an unsupported renderer VERSION but accepts a supported one", async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.dispatch(
        jobWith({ renderer: { rendererId: "anime.prototype", rendererVersion: "9.9.9" } }),
      ),
    ).rejects.toBeInstanceOf(ComputeAdmissionError);
    const ok = await adapter.dispatch(
      jobWith({
        jobId: "compute-job-2",
        idempotencyKey: "key-2",
        renderer: { rendererId: "anime.prototype", rendererVersion: "0.1.0" },
      }),
    );
    expect(ok.disposition).toBe("admitted");
    expect(adapter.stats().refusedAdmissions).toBe(1);
  });

  test("refuses an unserved latency class and out-of-bounds deadlines", async () => {
    const adapter = makeAdapter({ descriptor: makeDescriptor({ minJobDeadlineMs: 1_000 }) });
    await expect(
      adapter.dispatch(
        jobWith({
          outputProfile: {
            resolution: { w: 1, h: 1 },
            frameRate: 1,
            codec: "svg",
            container: "svg",
            latencyClass: "live",
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ComputeAdmissionError);
    await expect(
      adapter.dispatch(jobWith({ constraints: { deadlineMs: 999 } })),
    ).rejects.toBeInstanceOf(ComputeAdmissionError);
    await expect(
      adapter.dispatch(jobWith({ constraints: { deadlineMs: 600_001 } })),
    ).rejects.toBeInstanceOf(ComputeAdmissionError);
    expect(adapter.stats().refusedAdmissions).toBe(3);
  });

  test("refuses a malformed description (schema violation, own counter)", async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.dispatch(makeJob({ extraKey: true }) as unknown as ComputeJobDescription),
    ).rejects.toBeInstanceOf(ComputeValidationError);
    expect(adapter.stats().malformedDispatches).toBe(1);
    expect(adapter.stats().admitted).toBe(0);
  });

  test("refuses source-media inputs without the rights capability (fail-closed R2)", async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.dispatch(
        jobWith({
          inputs: [
            {
              inputId: "broadcast",
              kind: "source-media",
              ref: "r2://sessions/s-1/source",
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(ComputeRightsError);
    expect(adapter.stats().rightsRefusals).toBe(1);
    // The same manifest is ADMITTED when the posture grants source frames.
    const ok = await adapter.dispatch(
      jobWith({
        jobId: "compute-job-2",
        idempotencyKey: "key-2",
        inputs: [{ inputId: "broadcast", kind: "source-media", ref: "r2://sessions/s-1/source" }],
        rights: { policyRef: "policy-fixture-2", canReferenceSourceFrames: true },
      }),
    );
    expect(ok.disposition).toBe("admitted");
  });

  test("refuses on capacity (queue full / admitted budget — typed, counted)", async () => {
    const adapter = makeAdapter({ limits: { maxQueuedJobs: 1, maxAdmittedJobs: 2 } });
    await adapter.dispatch(jobWith());
    await expect(
      adapter.dispatch(jobWith({ jobId: "compute-job-2", idempotencyKey: "key-2" })),
    ).rejects.toBeInstanceOf(ComputeResourceLimitError);
    expect(adapter.stats().resourceRefusals).toBe(1);
    // Drain the queue: start + succeed the first job, then the second fits.
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "succeeded",
      outputs: [artifact()],
      consumedInputIds: ["snap-0", "events-0"],
    });
    const ok = await adapter.dispatch(jobWith({ jobId: "compute-job-2", idempotencyKey: "key-2" }));
    expect(ok.disposition).toBe("admitted");
    // admitted budget 2 is now consumed: the third refuses.
    await expect(
      adapter.dispatch(jobWith({ jobId: "compute-job-3", idempotencyKey: "key-3" })),
    ).rejects.toBeInstanceOf(ComputeResourceLimitError);
    expect(adapter.stats().resourceRefusals).toBe(2);
  });
});

describe("dispatch — the W303 idempotency posture", () => {
  test("a known key is a counted duplicate even with a DIFFERENT jobId", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    const duplicate = await adapter.dispatch(
      jobWith({ jobId: "compute-job-OTHER", idempotencyKey: "render-s1-wm-1000-seq-1" }),
    );
    expect(duplicate.disposition).toBe("duplicate");
    if (duplicate.disposition !== "duplicate") return;
    expect(duplicate.jobId).toBe("compute-job-1");
    expect(duplicate.jobState).toBe("queued");
    const stats = adapter.stats();
    expect(stats.duplicates).toBe(1);
    expect(stats.admitted).toBe(1);
    expect(stats.jobsDispatched).toBe(2);
  });

  test("the duplicate outcome reports the terminal state after completion", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "succeeded",
      outputs: [artifact()],
      consumedInputIds: ["snap-0"],
    });
    const duplicate = await adapter.dispatch(
      jobWith({ idempotencyKey: "render-s1-wm-1000-seq-1" }),
    );
    expect(duplicate.disposition).toBe("duplicate");
    if (duplicate.disposition !== "duplicate") return;
    expect(duplicate.jobState).toBe("succeeded");
  });

  test("a NEW key re-using an admitted jobId is a typed collision refusal", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    await expect(
      adapter.dispatch(jobWith({ idempotencyKey: "different-key" })),
    ).rejects.toBeInstanceOf(ComputeValidationError);
    expect(adapter.stats().malformedDispatches).toBe(1);
  });
});

describe("lifecycle — the success path with accounting totality", () => {
  test("submitted → dispatched → queued → in-flight → succeeded, one usage record", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    adapter.provider.reportStarted("compute-job-1");
    let progressSeen = 0;
    const subscription = adapter.subscribe("compute-job-1", (event) => {
      if (event.type === "progress") progressSeen += 1;
    });
    adapter.provider.reportProgress("compute-job-1", { fraction: 0.5, stage: "encoding" });
    adapter.provider.reportProgress("compute-job-1", { fraction: 1 });
    adapter.provider.reportOutcome("compute-job-1", {
      status: "succeeded",
      outputs: [artifact()],
      consumedInputIds: ["snap-0", "events-0"],
    });
    subscription.unsubscribe();
    expect(progressSeen).toBe(2);

    const snapshot = await adapter.getJobOrFail("compute-job-1");
    expect(snapshot.state).toBe("succeeded");
    expect(snapshot.events.map((e) => e.type)).toEqual([
      "submitted",
      "dispatched",
      "claimed",
      "progress",
      "progress",
      "succeeded",
    ]);
    const completion = snapshot.completion!;
    expect(completion.status).toBe("succeeded");
    expect(completion.terminalDisposition).toBe("succeeded");
    expect(completion.attempts).toBe(1);
    expect(completion.claims).toBe(1);
    expect(completion.outputs).toHaveLength(1);
    expect(completion.failure).toBeUndefined();
    // accounting totality: consumed + unconsumed partitions the manifest
    expect(completion.accounting.consumedInputIds).toEqual(["snap-0", "events-0"]);
    expect(completion.accounting.unconsumedInputs).toEqual([]);
    // metering totality: exactly one usage record, same job and disposition
    const usage = await adapter.usage();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.jobId).toBe("compute-job-1");
    expect(usage[0]!.terminalDisposition).toBe("succeeded");
    expect(usage[0]!.providerId).toBe("compute-test-0:memory");
    expect(usage[0]!.attempts).toBe(1);
    // every record validates against the contract schema
    for (const record of usage) {
      expect(ComputeUsageRecord.safeParse(record).success).toBe(true);
    }
    const stats = adapter.stats();
    expect(stats.succeeded).toBe(1);
    expect(stats.inFlight).toBe(0);
    expect(stats.inputsManifested).toBe(2);
    expect(stats.inputsConsumed).toBe(2);
    expect(stats.inputsUnconsumed).toBe(0);
    expect(stats.usageRecords).toBe(1);
  });

  test("partial consumption is accounted unconsumed-with-reason (never silent)", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "succeeded",
      outputs: [artifact()],
      consumedInputIds: ["snap-0"],
    });
    const snapshot = await adapter.getJobOrFail("compute-job-1");
    const accounting = snapshot.completion!.accounting;
    expect(accounting.consumedInputIds).toEqual(["snap-0"]);
    expect(accounting.unconsumedInputs).toEqual([
      { inputId: "events-0", reason: "not-consumed-by-execution" },
    ]);
    const stats = adapter.stats();
    expect(stats.inputsConsumed).toBe(1);
    expect(stats.inputsUnconsumed).toBe(1);
  });

  test("inline delivery byteLength follows the W504 UTF-8 convention (not UTF-16 units)", () => {
    // "héllo" is 5 UTF-16 code units but 6 UTF-8 bytes — the W504 store
    // validates byteLength as the UTF-8 byte length of content, and the
    // compute contract measures the same way.
    const wrong = makeArtifact({
      delivery: { mode: "inline", content: "héllo" },
      byteLength: 5,
    });
    const right = makeArtifact({
      delivery: { mode: "inline", content: "héllo" },
      byteLength: 6,
    });
    expect(ComputeOutputArtifact.safeParse(wrong).success).toBe(false);
    expect(ComputeOutputArtifact.safeParse(right).success).toBe(true);
  });
});

describe("lifecycle — failure paths (accounting totality on failure)", () => {
  test("a non-retryable failure resolves failed, never blind-retried", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "failed",
      errorClass: "render-refused",
      message: "renderer refused",
      retryable: false,
      consumedInputIds: [],
    });
    const completion = (await adapter.getJobOrFail("compute-job-1")).completion!;
    expect(completion.status).toBe("failed");
    expect(completion.terminalDisposition).toBe("failed");
    expect(completion.failure!.terminal).toBe("non-retryable");
    expect(completion.outputs).toEqual([]);
    expect(completion.accounting.unconsumedInputs).toHaveLength(2);
    const stats = adapter.stats();
    expect(stats.failed).toBe(1);
    expect(stats.usageRecords).toBe(1);
    expect(stats.inFlight).toBe(0);
  });

  test("retryable failures consume the claim budget, then dead-letter", async () => {
    const adapter = makeAdapter({ defaultMaxAttempts: 3 });
    await adapter.dispatch(jobWith());
    // claim 1 → retryable failure → requeue
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "failed",
      errorClass: "transient",
      message: "flaky",
      retryable: true,
      consumedInputIds: [],
    });
    expect((await adapter.getJobOrFail("compute-job-1")).state).toBe("queued");
    // claim 2 → retryable failure → requeue
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "failed",
      errorClass: "transient",
      message: "flaky again",
      retryable: true,
      consumedInputIds: [],
    });
    expect((await adapter.getJobOrFail("compute-job-1")).state).toBe("queued");
    // claim 3 → retryable failure → budget exhausted → dead-lettered
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "failed",
      errorClass: "transient",
      message: "flaky thrice",
      retryable: true,
      consumedInputIds: [],
    });
    const snapshot = await adapter.getJobOrFail("compute-job-1");
    expect(snapshot.state).toBe("dead-lettered");
    expect(snapshot.events.map((e) => e.type)).toEqual([
      "submitted",
      "dispatched",
      "claimed",
      "requeued",
      "claimed",
      "requeued",
      "claimed",
      "dead-lettered",
    ]);
    const completion = snapshot.completion!;
    expect(completion.status).toBe("failed");
    expect(completion.terminalDisposition).toBe("dead-lettered");
    expect(completion.failure!.terminal).toBe("retry-exhausted");
    expect(completion.claims).toBe(3);
    expect(completion.attempts).toBe(3);
    const stats = adapter.stats();
    expect(stats.deadLettered).toBe(1);
    expect(stats.usageRecords).toBe(1);
    expect(stats.inFlight).toBe(0);
  });

  test("a job-level maxAttempts override beats the adapter default", async () => {
    const adapter = makeAdapter({ defaultMaxAttempts: 5 });
    await adapter.dispatch(jobWith({ constraints: { deadlineMs: 60_000, maxAttempts: 1 } }));
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "failed",
      errorClass: "transient",
      message: "no budget",
      retryable: true,
      consumedInputIds: [],
    });
    expect((await adapter.getJobOrFail("compute-job-1")).state).toBe("dead-lettered");
  });

  test("a provider refusal at handoff resolves failed (non-retryable)", async () => {
    const adapter = makeAdapter({
      providerSubmit: () => ({
        accepted: false,
        reason: {
          errorClass: "provider-overloaded",
          message: "no capacity",
          terminal: "resource-limit",
        },
      }),
    });
    const outcome = await adapter.dispatch(jobWith());
    expect(outcome.disposition).toBe("admitted");
    const snapshot = await adapter.getJobOrFail("compute-job-1");
    expect(snapshot.state).toBe("failed");
    expect(snapshot.events.map((e) => e.type)).toEqual(["submitted", "dispatched", "failed"]);
    expect(snapshot.completion!.failure!.errorClass).toBe("provider-overloaded");
    expect(adapter.stats().usageRecords).toBe(1);
  });

  test("deadline expiry fails the job with the timeout classification", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    // queued-past-deadline
    adapter.simulateDeadlineExpiry("compute-job-1");
    let snapshot = await adapter.getJobOrFail("compute-job-1");
    expect(snapshot.state).toBe("failed");
    expect(snapshot.completion!.failure!.errorClass).toBe("deadline-timeout");
    expect(snapshot.completion!.failure!.terminal).toBe("timeout");
    // in-flight-past-deadline
    await adapter.dispatch(jobWith({ jobId: "compute-job-2", idempotencyKey: "key-2" }));
    adapter.provider.reportStarted("compute-job-2");
    adapter.simulateDeadlineExpiry("compute-job-2");
    snapshot = await adapter.getJobOrFail("compute-job-2");
    expect(snapshot.state).toBe("failed");
    expect(snapshot.completion!.failure!.terminal).toBe("timeout");
    const stats = adapter.stats();
    expect(stats.failed).toBe(2);
    expect(stats.usageRecords).toBe(2);
  });

  test("misused provider reports are counted, never silently absorbed", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    // reportOutcome on a QUEUED (not in-flight) job is invalid
    expect(() =>
      adapter.provider.reportOutcome("compute-job-1", {
        status: "succeeded",
        outputs: [],
        consumedInputIds: [],
      }),
    ).toThrow(ComputeAdapterMisuseError);
    // invalid progress fractions
    adapter.provider.reportStarted("compute-job-1");
    for (const fraction of [0, 1.5, Number.NaN]) {
      expect(() => adapter.provider.reportProgress("compute-job-1", { fraction })).toThrow(
        ComputeAdapterMisuseError,
      );
    }
    // unknown-job reports
    expect(() => adapter.provider.reportStarted("no-such-job")).toThrow(UnknownComputeJobError);
    expect(() => adapter.provider.reportProgress("no-such-job", { fraction: 0.5 })).toThrow(
      UnknownComputeJobError,
    );
    expect(() =>
      adapter.provider.reportOutcome("no-such-job", {
        status: "failed",
        errorClass: "x",
        message: "m",
        retryable: false,
        consumedInputIds: [],
      }),
    ).toThrow(UnknownComputeJobError);
    // consumption of an input not in the manifest
    expect(() =>
      adapter.provider.reportOutcome("compute-job-1", {
        status: "succeeded",
        outputs: [artifact()],
        consumedInputIds: ["not-in-manifest"],
      }),
    ).toThrow(ComputeAdapterMisuseError);
    // a structurally invalid output artifact
    expect(() =>
      adapter.provider.reportOutcome("compute-job-1", {
        status: "succeeded",
        outputs: [{ nope: true } as unknown as ComputeOutputArtifactType],
        consumedInputIds: [],
      }),
    ).toThrow(ComputeAdapterMisuseError);
    expect(adapter.stats().invalidProviderReports).toBe(9);
    // none of that moved the job or the ledger
    expect((await adapter.getJobOrFail("compute-job-1")).state).toBe("in-flight");
    expect(adapter.stats().succeeded).toBe(0);
  });

  test("a report racing a cancellation is counted superseded, never delivered", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    adapter.provider.reportStarted("compute-job-1");
    await adapter.cancel("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "succeeded",
      outputs: [artifact()],
      consumedInputIds: ["snap-0"],
    });
    const snapshot = await adapter.getJobOrFail("compute-job-1");
    expect(snapshot.state).toBe("cancelled");
    expect(snapshot.events.at(-1)!.type).toBe("superseded-report");
    // the completion is the CANCELLED one (the report lost the race)
    expect(snapshot.completion!.status).toBe("cancelled");
    expect(adapter.stats().supersededReports).toBe(1);
    expect(adapter.stats().succeeded).toBe(0);
    expect(adapter.stats().cancelled).toBe(1);
    expect(adapter.stats().usageRecords).toBe(1);
  });
});

describe("cancellation", () => {
  test("cancels a live job (never loses it) with a usage record", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    const outcome = await adapter.cancel("compute-job-1");
    expect(outcome).toEqual({ cancelled: true, jobId: "compute-job-1" });
    const snapshot = await adapter.getJobOrFail("compute-job-1");
    expect(snapshot.completion!.status).toBe("cancelled");
    expect(snapshot.completion!.accounting.unconsumedInputs).toHaveLength(2);
    expect(snapshot.completion!.accounting.unconsumedInputs[0]!.reason).toBe("job-cancelled");
    expect(adapter.stats().usageRecords).toBe(1);
  });

  test("cancelling a terminal job is a counted no-op returning the disposition", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    await adapter.cancel("compute-job-1");
    const second = await adapter.cancel("compute-job-1");
    expect(second).toEqual({
      cancelled: false,
      jobId: "compute-job-1",
      terminalDisposition: "cancelled",
    });
    expect(adapter.stats().cancelled).toBe(1);
  });

  test("cancelling an unknown job throws typed (never a silent success)", async () => {
    const adapter = makeAdapter();
    await expect(adapter.cancel("no-such-job")).rejects.toBeInstanceOf(UnknownComputeJobError);
    expect(adapter.stats().unknownCancelTargets).toBe(1);
  });

  test("a cancel landing during the provider handoff WINS (the race is honest)", async () => {
    let releaseSubmit!: (submission: ComputeProviderSubmission) => void;
    const gate = new Promise<ComputeProviderSubmission>((resolve) => {
      releaseSubmit = resolve;
    });
    const adapter = new InMemoryComputeAdapter({
      descriptor: makeDescriptor(),
      nowMs: makeCounter(),
      providerSubmit: () => gate,
    });
    const dispatchPromise = adapter.dispatch(jobWith());
    // The dispatch reached its await: the job is admitted, dispatched, and
    // parked at the provider handoff.
    const parked = await adapter.getJobOrFail("compute-job-1");
    expect(parked.state).toBe("dispatched");
    // Cancel while the handoff is in flight.
    const cancelOutcome = await adapter.cancel("compute-job-1");
    expect(cancelOutcome).toEqual({ cancelled: true, jobId: "compute-job-1" });
    // Now the provider accepts — the acceptance must not resurrect the job.
    releaseSubmit({ accepted: true });
    const outcome = await dispatchPromise;
    expect(outcome.disposition).toBe("admitted");
    const snapshot = await adapter.getJobOrFail("compute-job-1");
    expect(snapshot.state).toBe("cancelled");
    expect(snapshot.completion!.status).toBe("cancelled");
    const stats = adapter.stats();
    expect(stats.cancelled).toBe(1);
    expect(stats.inFlight).toBe(0);
    expect(stats.usageRecords).toBe(1);
    assertComputeAccounting(stats);
  });
});

describe("poll, subscribe, awaitCompletion", () => {
  test("getJob returns null for an unknown job; getJobOrFail throws typed", async () => {
    const adapter = makeAdapter();
    expect(await adapter.getJob("no-such-job")).toBeNull();
    await expect(adapter.getJobOrFail("no-such-job")).rejects.toBeInstanceOf(
      UnknownComputeJobError,
    );
  });

  test("every snapshot the reference emits validates as ComputeJobSnapshot", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportProgress("compute-job-1", { fraction: 0.25 });
    adapter.provider.reportOutcome("compute-job-1", {
      status: "succeeded",
      outputs: [artifact()],
      consumedInputIds: ["snap-0", "events-0"],
    });
    const live = await adapter.getJobOrFail("compute-job-1");
    expect(ComputeJobSnapshot.safeParse(live).success).toBe(true);
  });

  test("subscribe replays the past trail then live events; unsubscribe stops delivery", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    const replayed: string[] = [];
    const subscription = adapter.subscribe("compute-job-1", (event) => {
      replayed.push(event.type);
    });
    // the past trail replayed synchronously
    expect(replayed).toEqual(["submitted", "dispatched"]);
    adapter.provider.reportStarted("compute-job-1");
    expect(replayed).toEqual(["submitted", "dispatched", "claimed"]);
    subscription.unsubscribe();
    subscription.unsubscribe(); // idempotent
    adapter.provider.reportProgress("compute-job-1", { fraction: 0.5 });
    expect(replayed).toEqual(["submitted", "dispatched", "claimed"]);
  });

  test("subscribing to an unknown job throws typed", () => {
    const adapter = makeAdapter();
    expect(() => adapter.subscribe("no-such-job", () => {})).toThrow(UnknownComputeJobError);
  });

  test("awaitCompletion resolves an already-terminal job and never rejects on failure", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "failed",
      errorClass: "boom",
      message: "failed",
      retryable: false,
      consumedInputIds: [],
    });
    const completion = await awaitCompletion(adapter, "compute-job-1");
    expect(completion.status).toBe("failed");
  });

  test("awaitCompletion resolves through a live terminal transition", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    const pending = awaitCompletion(adapter, "compute-job-1");
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "succeeded",
      outputs: [artifact()],
      consumedInputIds: ["snap-0", "events-0"],
    });
    const completion = await pending;
    expect(completion.status).toBe("succeeded");
  });

  test("awaitCompletion rejects for an unknown job (fail-loud)", async () => {
    const adapter = makeAdapter();
    await expect(awaitCompletion(adapter, "no-such-job")).rejects.toBeInstanceOf(
      UnknownComputeJobError,
    );
  });
});

describe("metering invariants", () => {
  test("the default meter reports every declared unit at zero", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    await adapter.cancel("compute-job-1");
    const usage = await adapter.usage();
    expect(usage[0]!.costUnits).toEqual([
      { unitId: "compute-ms", quantity: 0 },
      { unitId: "jobs", quantity: 0 },
    ]);
  });

  test("an undeclared metering unit is a loud misuse, never a silent record", async () => {
    const adapter = makeAdapter({
      meterUsage: () => [{ unitId: "vendor-dollars", quantity: 1 }],
    });
    await adapter.dispatch(jobWith());
    adapter.provider.reportStarted("compute-job-1");
    expect(() =>
      adapter.provider.reportOutcome("compute-job-1", {
        status: "failed",
        errorClass: "x",
        message: "m",
        retryable: false,
        consumedInputIds: [],
      }),
    ).toThrow(ComputeAdapterMisuseError);
  });

  test("the meter receives the honest execution facts", async () => {
    const metered: Parameters<MeterUsageFn>[0][] = [];
    const adapter = makeAdapter({
      meterUsage: (input) => {
        metered.push(input);
        return [{ unitId: "compute-ms", quantity: input.executionMs }];
      },
    });
    await adapter.dispatch(jobWith());
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "succeeded",
      outputs: [artifact()],
      consumedInputIds: ["snap-0"],
    });
    expect(metered).toHaveLength(1);
    const facts = metered[0]!;
    expect(facts.terminalDisposition).toBe("succeeded");
    expect(facts.job.jobId).toBe("compute-job-1");
    expect(facts.claims).toBe(1);
    expect(facts.attempts).toBe(1);
    const usage = await adapter.usage();
    expect(usage[0]!.costUnits).toEqual([{ unitId: "compute-ms", quantity: facts.executionMs }]);
  });

  test("usage() filters by session and metering time", async () => {
    const adapter = makeAdapter();
    await adapter.dispatch(jobWith());
    await adapter.dispatch(
      jobWith({ jobId: "compute-job-2", idempotencyKey: "key-2", sessionId: "s-2" }),
    );
    await adapter.cancel("compute-job-1");
    await adapter.cancel("compute-job-2");
    const all = await adapter.usage();
    expect(all).toHaveLength(2);
    const s1 = await adapter.usage({ sessionId: "s-1" });
    expect(s1).toHaveLength(1);
    expect(s1[0]!.sessionId).toBe("s-1");
    const late = await adapter.usage({ sinceMs: Number.MAX_SAFE_INTEGER });
    expect(late).toHaveLength(0);
    const early = await adapter.usage({ sinceMs: 0 });
    expect(early).toHaveLength(2);
  });
});

describe("whole-adapter accounting (never silent)", () => {
  test("a mixed run closes every identity exactly; shutdown settles", async () => {
    const adapter = makeAdapter({ defaultMaxAttempts: 2 });
    // job-1: success (2 inputs, 1 consumed)
    await adapter.dispatch(jobWith());
    adapter.provider.reportStarted("compute-job-1");
    adapter.provider.reportOutcome("compute-job-1", {
      status: "succeeded",
      outputs: [artifact()],
      consumedInputIds: ["snap-0"],
    });
    // job-2: admitted then cancelled
    await adapter.dispatch(jobWith({ jobId: "compute-job-2", idempotencyKey: "key-2" }));
    await adapter.cancel("compute-job-2");
    // job-3: duplicate dispatch of job-1's key (counted, skipped)
    await adapter.dispatch(jobWith());
    // job-4: malformed (never admitted)
    await expect(
      adapter.dispatch(
        makeJob({
          jobId: "bad",
          idempotencyKey: "bad-key",
          inputs: [],
        }) as unknown as ComputeJobDescription,
      ),
    ).rejects.toBeInstanceOf(ComputeValidationError);
    // job-5: rights refusal (never admitted)
    await expect(
      adapter.dispatch(
        jobWith({
          jobId: "rights",
          idempotencyKey: "rights-key",
          inputs: [{ inputId: "m", kind: "source-media", ref: "r2://x" }],
        }),
      ),
    ).rejects.toBeInstanceOf(ComputeRightsError);
    // job-6: still live (never resolved) — shutdown must cancel it
    await adapter.dispatch(
      jobWith({ jobId: "compute-job-6", idempotencyKey: "key-6", sessionId: "s-6" }),
    );

    const settled = await adapter.shutdown();
    expect(settled.jobsDispatched).toBe(4);
    expect(settled.admitted).toBe(3);
    expect(settled.duplicates).toBe(1);
    expect(settled.succeeded).toBe(1);
    expect(settled.cancelled).toBe(2);
    expect(settled.inFlight).toBe(0);
    expect(settled.usageRecords).toBe(3);
    expect(settled.inputsManifested).toBe(6);
    expect(settled.inputsConsumed).toBe(1);
    expect(settled.inputsUnconsumed).toBe(5);
    expect(settled.malformedDispatches).toBe(1);
    expect(settled.rightsRefusals).toBe(1);
    // The identities hold on the settled snapshot (shutdown asserts too).
    assertComputeAccounting(settled);
  });

  test("assertComputeAccounting has teeth (a corrupted snapshot is caught)", () => {
    const stats = emptyComputeStats();
    stats.jobsDispatched = 1;
    stats.admitted = 1;
    // inFlight missing → identity 2 broken
    expect(() => assertComputeAccounting(stats)).toThrow(RangeError);
    expect(() => assertComputeAccounting(stats)).toThrow("identity 2");
    const balanced = emptyComputeStats();
    expect(() => assertComputeAccounting(balanced)).not.toThrow();
  });
});
