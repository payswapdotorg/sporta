/**
 * The REAL execution tests (W914 Wave 2): one materialized dispatch request
 * through the REAL anime renderer plugin, the REAL W504 encoder, and the
 * REAL W504 in-memory store — plus every determinate failure path.
 */
import { describe, expect, it } from "bun:test";
import { executeRenderJob } from "../src/index";
import type { RenderJobExecutorDeps } from "../src/index";
import { InMemoryRenderSegmentStore } from "@sporta/output-pipeline";
import { RendererRegistry } from "@sporta/renderer-contract";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  TEST_EPOCH_MS,
  buildDispatchRequest,
  frozenClock,
  manualClock,
  workerRegistry,
} from "./helpers";

/** The real executor deps (fresh per test). */
function deps(overrides: Partial<RenderJobExecutorDeps> = {}): RenderJobExecutorDeps {
  return {
    rendererRegistry: workerRegistry(),
    outputSegmentStore: new InMemoryRenderSegmentStore(),
    nowMs: manualClock(),
    budgets: {
      maxExecutionMs: 10_000,
      maxArtifactBytes: 1_000_000,
      maxJobDeadlineMs: 60_000,
      minJobDeadlineMs: 1_000,
      dispatchTimeoutMs: 5_000,
      maxConcurrentJobs: 4,
    },
    ...overrides,
  };
}

describe("executeRenderJob — the REAL success path", () => {
  it("executes a real anime render and hands back a content-addressed artifact", async () => {
    const request = await buildDispatchRequest();
    const envelope = await executeRenderJob(request, deps());

    expect(envelope.status).toBe("succeeded");
    expect(envelope.jobId).toBe("render-job-w914-1");
    expect(envelope.outputs).toHaveLength(1);
    const artifact = envelope.outputs[0]!;
    // Content-addressed identity: sha-256, 64 lowercase hex.
    expect(artifact.artifactId).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.contentHash).toBe(artifact.artifactId);
    expect(artifact.contentType).toBe("image/svg+xml");
    expect(artifact.byteLength).toBeGreaterThan(0);
    expect(artifact.delivery.mode).toBe("inline");
    if (artifact.delivery.mode !== "inline") throw new Error("expected inline");
    expect(typeof artifact.delivery.content).toBe("string");
    expect(artifact.delivery.content).toContain("<svg");
    // W504 store-scope metadata: the compute job id IS the render id here.
    expect(artifact.metadata).toMatchObject({
      sessionId: "sess-w914-e2e",
      renderId: "render-job-w914-1",
      snapshotVersion: 1,
    });
    expect(typeof artifact.metadata.segmentId).toBe("string");
    expect((artifact.manifest as { frameCount: number }).frameCount).toBeGreaterThan(0);
    // The renderer's own contract result rides verbatim.
    expect(envelope.renderResult).toMatchObject({
      rendererId: ANIME_RENDERER_ID,
      sessionId: "sess-w914-e2e",
    });
    // Consumed-input accounting: both manifest inputs.
    expect(envelope.consumedInputIds).toEqual(["swm-snapshot", "swm-events"]);
  });

  it("metering counters describe the real work (frames, segments, bytes, duration)", async () => {
    const request = await buildDispatchRequest();
    const envelope = await executeRenderJob(request, deps());

    const metering = envelope.metering;
    expect(metering.framesRendered).toBe(
      (envelope.outputs[0]!.manifest as { frameCount: number }).frameCount,
    );
    expect(metering.segmentsEncoded).toBe(1);
    expect(metering.segmentsStored).toBe(1);
    expect(metering.bytesEncoded).toBe(envelope.outputs[0]!.byteLength);
    expect(metering.duplicateStores).toBe(0);
    expect(metering.startedAtMs).toBeGreaterThanOrEqual(TEST_EPOCH_MS);
    expect(metering.finishedAtMs).toBeGreaterThan(metering.startedAtMs);
    expect(metering.executionMs).toBe(metering.finishedAtMs - metering.startedAtMs);
  });

  it("re-executing the same job stores idempotently (the W504 duplicate count)", async () => {
    const store = new InMemoryRenderSegmentStore();
    const request = await buildDispatchRequest();
    const first = await executeRenderJob(request, deps({ outputSegmentStore: store }));
    const second = await executeRenderJob(request, deps({ outputSegmentStore: store }));

    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    expect(second.metering.duplicateStores).toBe(1);
    expect(second.outputs[0]!.contentHash).toBe(first.outputs[0]!.contentHash);
  });
});

describe("executeRenderJob — determinate failures (never throws)", () => {
  it("malformed dispatch requests fail closed with invalid-dispatch", async () => {
    const envelope = await executeRenderJob({ nope: true }, deps());
    expect(envelope.status).toBe("failed");
    expect(envelope.jobId).toBe("unknown");
    expect(envelope.failure?.errorClass).toBe("invalid-dispatch");
    expect(envelope.failure?.terminal).toBe("non-retryable");
    expect(envelope.failure?.retryable).toBe(false);
    expect(envelope.outputs).toHaveLength(0);
  });

  it("an unknown renderer fails with renderer-unknown", async () => {
    const request = await buildDispatchRequest({ rendererId: "no.such.renderer" });
    const envelope = await executeRenderJob(request, deps());
    expect(envelope.status).toBe("failed");
    expect(envelope.failure?.errorClass).toBe("renderer-unknown");
  });

  it("a mismatched renderer VERSION fails with renderer-unknown", async () => {
    const request = await buildDispatchRequest({ rendererVersion: "9.9.9" });
    const envelope = await executeRenderJob(request, deps());
    expect(envelope.status).toBe("failed");
    expect(envelope.failure?.errorClass).toBe("renderer-unknown");
  });

  it("a snapshot that is not a valid WorldSnapshot fails with invalid-inputs", async () => {
    const request = await buildDispatchRequest();
    (request.inputs[0]!.payload as { snapshot: unknown }).snapshot = { garbage: true };
    const envelope = await executeRenderJob(request, deps());
    expect(envelope.status).toBe("failed");
    expect(envelope.failure?.errorClass).toBe("invalid-inputs");
    // The snapshot input is counted consumed (it was read before validation).
    expect(envelope.consumedInputIds).toEqual(["swm-snapshot"]);
  });

  it("exactly one snapshot + one event window is required (extra input refused)", async () => {
    const request = await buildDispatchRequest();
    request.inputs.push({ ...request.inputs[0]!, inputId: "swm-snapshot-2" });
    (request.job.inputs as Array<Record<string, unknown>>).push({
      ...(request.job.inputs as Array<Record<string, unknown>>)[0]!,
      inputId: "swm-snapshot-2",
    });
    const envelope = await executeRenderJob(request, deps());
    expect(envelope.status).toBe("failed");
    expect(envelope.failure?.errorClass).toBe("invalid-inputs");
    expect(envelope.failure?.message).toContain("exactly one swm-snapshot");
  });

  it("a renderer that requires source frames fails closed on the traveling rights posture", async () => {
    // The anime prototype does NOT require source frames; force the check
    // by dispatching with the capability denied while carrying a renderer
    // that declares the requirement — simulated through a stub plugin whose
    // capability requires source frames (the G8-minimum posture check).
    const registry = new RendererRegistry();
    const requiring = {
      capability: () => ({
        rendererId: "sporta.requires-frames",
        rendererVersion: "0.1.0",
        rendererClass: "tactical",
        supportedOutputProfiles: [ANIME_OUTPUT_PROFILE],
        requiresSourceFrames: true,
        minSnapshotVersion: 0,
      }),
      init: async () => undefined,
      validateRequest: () => ({ ok: true }),
      render: async () => {
        throw new Error("must not render");
      },
    };
    registry.register(requiring as never);
    const request = await buildDispatchRequest({
      rendererId: "sporta.requires-frames",
      rightsCanReferenceSourceFrames: false,
    });
    const envelope = await executeRenderJob(request, deps({ rendererRegistry: registry }));
    expect(envelope.status).toBe("failed");
    expect(envelope.failure?.errorClass).toBe("rights-denied");
    expect(envelope.failure?.message).toContain("canReferenceSourceFrames");
  });

  it("a renderer without the W502 detailed surface fails honestly (renderer-not-encodable)", async () => {
    // The reference test-card renderer renders but exposes no renderDetailed.
    const request = await buildDispatchRequest({
      rendererId: "sporta.testcard",
      outputProfile: {
        resolution: { w: 1280, h: 720 },
        frameRate: 30,
        codec: "h264",
        container: "mp4",
      },
    });
    const envelope = await executeRenderJob(request, deps());
    expect(envelope.status).toBe("failed");
    expect(envelope.failure?.errorClass).toBe("renderer-not-encodable");
    expect(envelope.failure?.terminal).toBe("non-retryable");
  });

  it("a renderer that rejects the request fails with render-refused", async () => {
    // Wrong profile for the anime renderer: it validates deep equality.
    const request = await buildDispatchRequest({ outputProfileLatencyClass: "live" });
    const envelope = await executeRenderJob(request, deps());
    expect(envelope.status).toBe("failed");
    expect(envelope.failure?.errorClass).toBe("render-refused");
    expect(envelope.failure?.message).toContain("outputProfile");
  });

  it("an artifact over the fail-closed size budget is never handed back", async () => {
    const request = await buildDispatchRequest();
    const tight = deps({
      budgets: {
        maxExecutionMs: 10_000,
        maxArtifactBytes: 10,
        maxJobDeadlineMs: 60_000,
        minJobDeadlineMs: 1_000,
        dispatchTimeoutMs: 5_000,
        maxConcurrentJobs: 4,
      },
    });
    const envelope = await executeRenderJob(request, tight);
    expect(envelope.status).toBe("failed");
    expect(envelope.failure?.errorClass).toBe("artifact-too-large");
    expect(envelope.outputs).toHaveLength(0);
    expect(envelope.failure?.message).toContain("fail-closed budget");
  });

  it("an execution over the fail-closed duration budget discards its outputs", async () => {
    const request = await buildDispatchRequest();
    const slowClock = manualClock(TEST_EPOCH_MS, 100_000); // each read +100s
    const envelope = await executeRenderJob(request, deps({ nowMs: slowClock }));
    expect(envelope.status).toBe("failed");
    expect(envelope.failure?.errorClass).toBe("budget-exceeded");
    expect(envelope.failure?.terminal).toBe("timeout");
    expect(envelope.outputs).toHaveLength(0);
    expect(envelope.metering.executionMs).toBeGreaterThan(10_000);
  });

  it("the tighter of the worker budget and the job deadline binds", async () => {
    const request = await buildDispatchRequest({ deadlineMs: 2_000 });
    // Worker budget 10s > job deadline 2s; clock advances 100s per read.
    const slowClock = manualClock(TEST_EPOCH_MS, 100_000);
    const envelope = await executeRenderJob(request, deps({ nowMs: slowClock }));
    expect(envelope.failure?.errorClass).toBe("budget-exceeded");
    expect(envelope.failure?.message).toContain("job deadline 2000ms");
  });

  it("a store failure fails closed with store-failed", async () => {
    const throwing = {
      storeSegment: () => {
        throw new Error("store is down");
      },
    };
    const request = await buildDispatchRequest();
    const envelope = await executeRenderJob(
      request,
      deps({ outputSegmentStore: throwing as never }),
    );
    expect(envelope.status).toBe("failed");
    expect(envelope.failure?.errorClass).toBe("store-failed");
    expect(envelope.failure?.terminal).toBe("internal");
  });

  it("a frozen clock still produces a valid (zero-duration) success", async () => {
    const request = await buildDispatchRequest();
    const envelope = await executeRenderJob(request, deps({ nowMs: frozenClock() }));
    expect(envelope.status).toBe("succeeded");
    expect(envelope.metering.executionMs).toBe(0);
  });
});
