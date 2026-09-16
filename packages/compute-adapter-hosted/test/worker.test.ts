/**
 * The worker application tests (W914 Wave 2): honest descriptor, jobId
 * idempotence, fail-closed capacity, per-job records, whole-worker metering.
 */
import { describe, expect, it } from "bun:test";
import { ComputeAdapterDescriptor } from "@sporta/compute-adapter";
import {
  HOSTED_COMPUTE_ADAPTER_ID,
  HOSTED_COMPUTE_ADAPTER_VERSION,
  HOSTED_COMPUTE_COST_UNITS,
} from "../src/index";
import {
  ANIME_OUTPUT_PROFILE,
  TEST_EPOCH_MS,
  buildDispatchRequest,
  createTestWorker,
  manualClock,
  workerRegistry,
} from "./helpers";

describe("describe() — the honest descriptor", () => {
  it("derives from the REAL registry (nothing advertised that cannot resolve)", () => {
    const worker = createTestWorker();
    const descriptor = worker.describe();
    expect(ComputeAdapterDescriptor.safeParse(descriptor).success).toBe(true);
    expect(descriptor.adapterId).toBe(HOSTED_COMPUTE_ADAPTER_ID);
    expect(descriptor.adapterVersion).toBe(HOSTED_COMPUTE_ADAPTER_VERSION);
    // Provider identity lives on the worker, never the descriptor (vendor
    // neutrality: the descriptor carries providerKind only).
    expect(descriptor.providerKind).toBe("cpu-worker");
    // The real registry: anime prototype + test card.
    expect(descriptor.supportedRenderers).toEqual([
      { rendererId: "anime.prototype", rendererVersions: ["0.1.0"] },
      { rendererId: "sporta.testcard", rendererVersions: ["0.1.0"] },
    ]);
    // Latency classes derived from the plugins' supported profiles.
    expect(descriptor.supportedLatencyClasses).toContain("offline");
    expect(descriptor.costUnits).toEqual(HOSTED_COMPUTE_COST_UNITS);
  });

  it("is identity-stable (clones, never re-derived drift)", () => {
    const worker = createTestWorker();
    expect(worker.describe()).toEqual(worker.describe());
  });

  it("reports the budget-derived bounds (the documented Hobby limits)", () => {
    const worker = createTestWorker();
    const descriptor = worker.describe();
    expect(descriptor.maxConcurrentJobs).toBe(4);
    expect(descriptor.dispatchTimeoutMs).toBe(5_000);
    expect(descriptor.maxJobDeadlineMs).toBe(60_000);
    expect(descriptor.minJobDeadlineMs).toBe(1_000);
  });
});

describe("execute() — idempotence and capacity", () => {
  it("executes a real job and records it", async () => {
    const worker = createTestWorker();
    const request = await buildDispatchRequest();
    const execution = await worker.execute(request);

    expect(execution.kind).toBe("executed");
    if (execution.kind !== "executed") return;
    expect(execution.result.status).toBe("succeeded");
    const record = worker.getJob(request.job.jobId);
    expect(record).not.toBeNull();
    expect(record?.state).toBe("succeeded");
    expect(record?.sessionId).toBe("sess-w914-e2e");
    expect(record?.result?.outputs).toHaveLength(1);
    expect(record?.metering?.segmentsStored).toBe(1);
  });

  it("a re-POST of an executed job answers the SAME envelope and counts a duplicate", async () => {
    const worker = createTestWorker();
    const request = await buildDispatchRequest();
    const first = await worker.execute(request);
    const second = await worker.execute(request);

    expect(first.kind).toBe("executed");
    expect(second.kind).toBe("duplicate");
    if (second.kind !== "duplicate") return;
    expect(second.duplicateExecutions).toBe(1);
    if (first.kind !== "executed") return;
    expect(second.result).toEqual(first.result);
    // The worker-side stats count both.
    expect(worker.stats().duplicateExecutions).toBe(1);
    expect(worker.stats().jobsExecuted).toBe(1);
  });

  it("over-budget concurrency is refused determinately (never queued silently)", async () => {
    // Hold the first execution open: a stub plugin whose (awaited) `render`
    // returns a gated promise keeps the job "executing" in the worker.
    let releaseRender: (() => void) | undefined;
    const slowPlugin = {
      capability: () => ({
        rendererId: "sporta.slow",
        rendererVersion: "0.1.0",
        rendererClass: "tactical" as const,
        supportedOutputProfiles: [ANIME_OUTPUT_PROFILE],
        requiresSourceFrames: false,
        minSnapshotVersion: 0,
      }),
      init: async () => undefined,
      validateRequest: () => ({ ok: true }),
      render: () =>
        new Promise((resolve) => {
          releaseRender = () => resolve({ not: "a valid RenderResult" });
        }),
    };
    const registry = workerRegistry();
    registry.register(slowPlugin as never);
    const gated = createTestWorker({
      budgets: { maxConcurrentJobs: 1 },
      rendererRegistry: registry,
    });
    const first = await buildDispatchRequest({
      jobId: "job-a",
      idempotencyKey: "key-a",
      rendererId: "sporta.slow",
    });
    const second = await buildDispatchRequest({
      jobId: "job-b",
      idempotencyKey: "key-b",
      rendererId: "sporta.slow",
    });

    const firstPromise = gated.execute(first);
    // Let the first job reach its render call.
    await Bun.sleep(20);
    expect(releaseRender).toBeDefined(); // the render is genuinely held open
    const refusal = await gated.execute(second);
    expect(refusal.kind).toBe("refused");
    if (refusal.kind !== "refused") return;
    expect(refusal.reason.errorClass).toBe("capacity");
    expect(refusal.reason.terminal).toBe("resource-limit");
    expect(gated.stats().capacityRefusals).toBe(1);
    // The held job is still honestly "executing" (observable, not silent).
    expect(gated.getJob("job-a")?.state).toBe("executing");
    releaseRender?.();
    const done = await firstPromise;
    expect(done.kind).toBe("executed");
    expect(gated.getJob("job-a")?.state).toBe("failed"); // determinate, classified
  });

  it("whole-worker metering accumulates across jobs (never silent)", async () => {
    const worker = createTestWorker();
    await worker.execute(await buildDispatchRequest({ jobId: "j-1", idempotencyKey: "k-1" }));
    await worker.execute(await buildDispatchRequest({ jobId: "j-2", idempotencyKey: "k-2" }));
    // A determinate failure (unknown renderer) still counts honestly.
    await worker.execute(
      await buildDispatchRequest({ jobId: "j-3", idempotencyKey: "k-3", rendererId: "no.such" }),
    );

    const stats = worker.stats();
    expect(stats.jobsExecuted).toBe(3);
    expect(stats.succeeded).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.duplicateExecutions).toBe(0);
    expect(stats.capacityRefusals).toBe(0);
    expect(stats.segmentsEncoded).toBe(2);
    expect(stats.segmentsStored).toBe(2);
    expect(stats.bytesEncoded).toBeGreaterThan(0);
    expect(stats.totalExecutionMs).toBeGreaterThanOrEqual(0);
  });

  it("unknown jobs answer null (never fabricated)", () => {
    const worker = createTestWorker();
    expect(worker.getJob("never-dispatched")).toBeNull();
  });

  it("the injected clock drives all timestamps", async () => {
    const clock = manualClock(TEST_EPOCH_MS, 7);
    const worker = createTestWorker({ nowMs: clock });
    const request = await buildDispatchRequest();
    const execution = await worker.execute(request);
    if (execution.kind !== "executed") throw new Error("expected executed");
    // The worker's own record read is the first clock read; the executor's
    // envelope startedAtMs is the second (same injected function).
    expect(worker.getJob(request.job.jobId)?.startedAtMs).toBe(TEST_EPOCH_MS);
    expect(execution.result.metering.startedAtMs).toBe(TEST_EPOCH_MS + 7);
    expect(execution.result.metering.finishedAtMs).toBeGreaterThan(TEST_EPOCH_MS + 7);
  });
});
