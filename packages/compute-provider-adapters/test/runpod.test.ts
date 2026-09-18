/**
 * The `provider.runpod` adapter (R404) — the recorded-fixture tier: the
 * SHARED credential/failure matrix over the pinned fixtures in
 * fixtures/runpod/ (see ./remote-suite.ts), plus the RunPod-specific pins
 * (the pods REST surface, the POD-NOT-FOUND posture dead-lettering
 * `internal` with the real cause, the pod-exited-without-result honesty,
 * and the pay-as-you-go null-quote posture).
 *
 * The conditional integration tier lives in ./runpod.integration.test.ts
 * (guard: `RUNPOD_API_KEY`).
 */
import { describe, expect, test } from "bun:test";
import type { ComputeJobSnapshot } from "@sporta/compute-adapter";
import { RunPodComputeAdapter } from "../src/runpod/adapter";
import {
  RUNPOD_API_BASE_DEFAULT,
  RUNPOD_WORKER_IMAGE_DEFAULT,
  RunPodRestClient,
} from "../src/runpod/api";
import { suiteRemoteAdapter } from "./remote-suite";
import {
  FixtureTransport,
  buildProviderJob,
  loadFixture,
  manualClock,
  microtaskSleep,
  until,
} from "./helpers";

suiteRemoteAdapter({
  label: "R404 RunPodComputeAdapter (provider.runpod)",
  fixtureDir: "runpod",
  expectedAdapterId: "provider.runpod",
  expectedProviderKind: "gpu-worker",
  expectedAuthHeader: "Authorization",
  // THE R404 posture: a 404 status poll dead-letters with the
  // provider-native pod-not-found error class + the real cause.
  deadLetterClassFor404: "pod-not-found",
  succeededExecutionMs: 15_000,
  runningReportsProgress: false,
  cancelMethod: "DELETE",
  createAdapter: (options) =>
    new RunPodComputeAdapter({
      apiKey: options.withCredentials ? "runpod-api-key-fixture" : "",
      nowMs: options.nowMs,
      fetchFn: options.fetchFn,
      ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      ...(options.callTimeoutMs !== undefined ? { callTimeoutMs: options.callTimeoutMs } : {}),
    }),
});

describe("R404 RunPodComputeAdapter — provider-specific pins", () => {
  test("the pod-not-found posture: a 404 status poll dead-letters internal with the REAL cause", async () => {
    const transport = new FixtureTransport([
      loadFixture("runpod", "submit-accepted"),
      loadFixture("runpod", "status-404"),
    ]);
    const adapter = new RunPodComputeAdapter({
      apiKey: "runpod-api-key-fixture",
      nowMs: manualClock(),
      fetchFn: transport.fetch,
      sleep: microtaskSleep,
      pollIntervalMs: 0,
      callTimeoutMs: 250,
    });
    const job = buildProviderJob({});
    await adapter.dispatch(job);
    const terminal = await until(
      () => adapter.getJob(job.jobId),
      (snap): snap is ComputeJobSnapshot => snap !== null && snap.state === "dead-lettered",
    );
    const failure = terminal.completion!.failure!;
    expect(failure.errorClass).toBe("pod-not-found");
    expect(failure.terminal).toBe("internal");
    expect(failure.message).toContain("pod-not-found");
    expect(failure.message).toContain("pod-0001");
    expect(failure.message).toContain("already terminated");
  });

  test("a pod that exited without a job result fails honestly (no fabricated outcome)", async () => {
    const transport = new FixtureTransport([
      loadFixture("runpod", "submit-accepted"),
      loadFixture("runpod", "status-pod-exited-without-result"),
    ]);
    const adapter = new RunPodComputeAdapter({
      apiKey: "runpod-api-key-fixture",
      nowMs: manualClock(),
      fetchFn: transport.fetch,
      sleep: microtaskSleep,
      pollIntervalMs: 0,
      callTimeoutMs: 250,
    });
    const job = buildProviderJob({});
    await adapter.dispatch(job);
    // The work is UNKNOWABLE (an exited pod, no result envelope): the
    // honest W303 posture is the internal bucket — dead-lettered.
    const terminal = await until(
      () => adapter.getJob(job.jobId),
      (snap): snap is ComputeJobSnapshot => snap !== null && snap.state === "dead-lettered",
    );
    const failure = terminal.completion!.failure!;
    expect(failure.errorClass).toBe("pod-exited-without-result");
    expect(failure.terminal).toBe("internal");
    expect(failure.message).toContain("without a job result envelope");
  });

  test("the pods create surface targets the documented REST family with the worker image", async () => {
    const transport = new FixtureTransport([
      loadFixture("runpod", "submit-accepted"),
      loadFixture("runpod", "status-running"),
      loadFixture("runpod", "status-succeeded"),
    ]);
    const adapter = new RunPodComputeAdapter({
      apiKey: "runpod-api-key-fixture",
      nowMs: manualClock(),
      fetchFn: transport.fetch,
      sleep: microtaskSleep,
      pollIntervalMs: 0,
      callTimeoutMs: 250,
    });
    const job = buildProviderJob({});
    await adapter.dispatch(job);
    await until(
      () => adapter.getJob(job.jobId),
      (snap) => snap !== null && snap.state === "succeeded",
    );
    const createCall = transport.calls[0]!;
    expect(createCall.method).toBe("POST");
    expect(createCall.url).toBe(`${RUNPOD_API_BASE_DEFAULT}/v1/pods`);
    const body = createCall.body as Record<string, unknown>;
    expect(body["imageName"]).toBe(RUNPOD_WORKER_IMAGE_DEFAULT);
    expect(body["name"]).toBe(`sporta-${job.jobId}`);
    expect((body["job"] as Record<string, unknown>)["jobId"]).toBe(job.jobId);
  });

  test("pay-as-you-go honesty: the descriptor meters no price it cannot know", () => {
    const adapter = new RunPodComputeAdapter({ apiKey: "", nowMs: manualClock() });
    const descriptor = adapter.describe();
    // Only the MEASURED unit is declared — no per-second price unit, no
    // fabricated currency (broker quotes stay null; test/broker.test.ts).
    expect(descriptor.costUnits).toEqual([
      expect.objectContaining({ unitId: "compute-ms", unitKind: "time-ms" }),
    ]);
    const transport = new FixtureTransport([]);
    void transport;
    const client = new RunPodRestClient({
      apiKey: "runpod-api-key-fixture",
      fetchFn: (() => undefined) as unknown as typeof fetch,
    });
    expect(client.endpointFamily).toBe("runpod:pods");
  });
});
