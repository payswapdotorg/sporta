/**
 * The W914 ADDITIVE async compute surface over real HTTP (flight 3): the
 * control plane dispatching REAL render jobs through the REAL hosted
 * compute adapter (a `ComputeWorker` over the REAL anime renderer + the
 * REAL W504 store), with job observability, never-silent accounting, and
 * playback-gated artifact read-back. Every existing (synchronous) route is
 * untouched — the additive proof is part of the suite.
 */
import { describe, expect, it } from "bun:test";
import { createControlServer } from "../../src/index";
import { RendererRegistry, createTestCardRenderer } from "@sporta/renderer-contract";
import { ANIME_RENDERER_ID, createAnimePrototypeRenderer } from "@sporta/renderer-anime";
import { InMemoryRenderSegmentStore } from "@sporta/output-pipeline";
import { ComputeWorker, HostedComputeAdapter } from "@sporta/compute-adapter-hosted";
import type { ComputeAdapterPort } from "@sporta/compute-adapter";
import { WorldModelEngine } from "@sporta/world-model";
import type { WorldModelEngine as WorldModelEngineInstance } from "@sporta/world-model";
import type { AuthorizationPolicy } from "@sporta/contracts";
import { analysisOnlyPolicy, fullAllowPolicy } from "../helpers";

/** Deterministic epoch (the repo's testing convention). */
const TEST_EPOCH_MS = 1_700_000_000_000;

/** The policies this suite uses (the shared, untouched helper fixtures). */
const allowAll: AuthorizationPolicy = fullAllowPolicy;
const analysisOnly: AuthorizationPolicy = analysisOnlyPolicy;

/** One full composition: control server + REAL compute adapter + W504 store. */
interface ComputeHarness {
  baseUrl: string;
  server: ReturnType<typeof createControlServer>;
  adapter: ComputeAdapterPort;
}

/** A deterministic clock shared by the app and the adapter. */
function sharedClock(): () => number {
  let ticks = 0;
  return (): number => TEST_EPOCH_MS + (ticks += 1);
}

/** Builds the world-model factory with two positioned entities (renderable). */
function seededWorldModel(sessionId: string): WorldModelEngineInstance {
  const engine = WorldModelEngine.create(sessionId, { now: () => TEST_EPOCH_MS });
  engine.upsertEntity({
    entityId: "p1",
    kind: "participant",
    version: 1,
    lastEventTimeMs: 1_000,
    state: { pitchPosition: { status: "known", value: { x: 52, y: 34 } } },
  });
  engine.upsertEntity({
    entityId: "b1",
    kind: "ball",
    version: 1,
    lastEventTimeMs: 1_000,
    state: { pitchPosition: { status: "uncertain", value: { x: 51, y: 34 }, confidence: 0.9 } },
  });
  return engine;
}

/** Creates the harness: the REAL production composition, in-process. */
function createComputeHarness(options: { withAdapter?: boolean } = {}): ComputeHarness {
  const nowMs = sharedClock();
  const registry = new RendererRegistry();
  registry.register(createAnimePrototypeRenderer());
  registry.register(createTestCardRenderer());
  const store = new InMemoryRenderSegmentStore();
  const worker = new ComputeWorker({
    rendererRegistry: registry,
    outputSegmentStore: store,
    nowMs,
  });
  const adapter: ComputeAdapterPort = new HostedComputeAdapter({
    descriptor: worker.describe(),
    execute: async (job, materialized) => {
      if (materialized === undefined) {
        throw new Error("in-process execution requires materialized inputs");
      }
      const execution = await worker.execute({ job, inputs: materialized });
      if (execution.kind === "refused") throw new Error(execution.reason.message);
      return execution.result;
    },
    nowMs,
  });
  const server = createControlServer({
    port: 0,
    nowMs,
    rendererRegistry: registry,
    worldModelFactory: seededWorldModel,
    ...(options.withAdapter === false ? {} : { computeAdapter: adapter }),
    renderOutputStore: store,
    renderOutputWriter: store,
  });
  return { baseUrl: `http://127.0.0.1:${server.port}`, server, adapter };
}

/** A loose parsed-JSON document: the HTTP wire's answer, pinned field-by-field by the assertions below (a deliberate test seam, not a domain type). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WireJson = any;

/** JSON POST helper. */
async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: WireJson }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return { status: response.status, body: await response.json() };
}

/** JSON GET helper. */
async function getJson(baseUrl: string, path: string): Promise<{ status: number; body: WireJson }> {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  const parsed = response.headers.get("content-type")?.includes("application/json")
    ? JSON.parse(text)
    : text;
  return { status: response.status, body: parsed };
}

/** Creates a session and returns its id (fails loud on surprise). */
async function newSession(baseUrl: string, policy: AuthorizationPolicy): Promise<string> {
  const created = await postJson(baseUrl, "/v1/sessions", { authorizationPolicy: policy });
  if (created.status !== 200)
    throw new Error(`createSession failed: ${JSON.stringify(created.body)}`);
  return created.body.session.sessionId as string;
}

function isTerminal(state: string): boolean {
  return (
    state === "succeeded" ||
    state === "failed" ||
    state === "cancelled" ||
    state === "dead-lettered"
  );
}

/** Polls a compute job to a terminal state (bounded). */
async function pollJob(
  baseUrl: string,
  sessionId: string,
  jobId: string,
): Promise<{ status: number; body: WireJson }> {
  let job = await getJson(baseUrl, `/v1/sessions/${sessionId}/compute-jobs/${jobId}`);
  for (let i = 0; i < 50 && job.status === 200 && !isTerminal(job.body.state); i += 1) {
    await Bun.sleep(5);
    job = await getJson(baseUrl, `/v1/sessions/${sessionId}/compute-jobs/${jobId}`);
  }
  return job;
}

describe("createRenderAsync — the additive async surface (W914)", () => {
  it("answers the typed 503 when no compute adapter is configured", async () => {
    const harness = createComputeHarness({ withAdapter: false });
    try {
      const sessionId = await newSession(harness.baseUrl, allowAll);
      const response = await postJson(harness.baseUrl, `/v1/sessions/${sessionId}/renders/async`, {
        rendererId: ANIME_RENDERER_ID,
      });
      expect(response.status).toBe(503);
      expect(response.body.error.failureClass).toBe("compute-unavailable");
      expect(response.body.error.message).toContain("compute adapter");
    } finally {
      harness.server.stop(true);
    }
  });

  it("dispatches a REAL render job through the REAL adapter and ingests its artifact", async () => {
    const harness = createComputeHarness();
    try {
      const sessionId = await newSession(harness.baseUrl, allowAll);
      const dispatched = await postJson(
        harness.baseUrl,
        `/v1/sessions/${sessionId}/renders/async`,
        {
          rendererId: ANIME_RENDERER_ID,
        },
      );

      expect(dispatched.status).toBe(200);
      expect(dispatched.body.disposition).toBe("admitted");
      expect(dispatched.body.jobId).toMatch(/^render-job-/);
      expect(dispatched.body.idempotencyKey).toMatch(/^render-/);
      expect(dispatched.body.adapterId).toBe("sporta.compute.hosted");
      expect(["admitted", "queued", "in-flight"]).toContain(dispatched.body.jobState);

      const job = await pollJob(harness.baseUrl, sessionId, dispatched.body.jobId);
      expect(job.body.state).toBe("succeeded");
      expect(job.body.ingest).toEqual({ status: "stored" });
      expect(job.body.renderId).toMatch(/^r-\d+$/);

      // Never-silent accounting + metering.
      const completion = job.body.completion;
      expect(completion.status).toBe("succeeded");
      expect(completion.accounting.consumedInputIds).toEqual(["swm-snapshot", "swm-events"]);
      expect(completion.accounting.unconsumedInputs).toEqual([]);
      expect(completion.usage.costUnits).toEqual([
        { unitId: "cpu-ms", quantity: completion.timing.executionMs },
        { unitId: "render-requests", quantity: 1 },
        { unitId: "artifact-bytes", quantity: completion.outputs[0].byteLength },
      ]);
      expect(completion.outputs[0].artifactId).toMatch(/^[0-9a-f]{64}$/);
      // The decision trail is observable.
      expect(job.body.events.map((e: { type: string }) => e.type)).toEqual(
        expect.arrayContaining(["submitted", "claimed", "succeeded"]),
      );

      // The ingested artifact is playback-served under the control plane's
      // render id (the REAL W504 read path).
      const outputs = await getJson(
        harness.baseUrl,
        `/v1/sessions/${sessionId}/renders/${job.body.renderId}/outputs`,
      );
      expect(outputs.status).toBe(200);
      const segment = outputs.body.segments[0];
      expect(segment.contentType).toBe("image/svg+xml");
      expect(segment.byteLength).toBe(completion.outputs[0].byteLength);

      const read = await getJson(
        harness.baseUrl,
        `/v1/sessions/${sessionId}/renders/${job.body.renderId}/outputs/${segment.segmentId}`,
      );
      expect(read.status).toBe(200);
      // The W504 segment document: the encoded SVG content rides verbatim.
      expect(read.body.contentType).toBe("image/svg+xml");
      expect(read.body.content).toContain("<svg");
      expect(read.body.byteLength).toBe(completion.outputs[0].byteLength);
      expect(read.body.contentHash).toBe(completion.outputs[0].artifactId);

      // The stored render is listed like a synchronous one.
      const renders = await getJson(harness.baseUrl, `/v1/sessions/${sessionId}/renders`);
      expect(renders.status).toBe(200);
      expect(renders.body.renders.map((r: { renderId: string }) => r.renderId)).toContain(
        job.body.renderId,
      );
    } finally {
      harness.server.stop(true);
    }
  });

  it("an explicit idempotency key re-dispatch is a counted duplicate", async () => {
    const harness = createComputeHarness();
    try {
      const sessionId = await newSession(harness.baseUrl, allowAll);
      const body = {
        rendererId: ANIME_RENDERER_ID,
        jobId: "job-dup-1",
        idempotencyKey: "key-dup-1",
      };
      const first = await postJson(
        harness.baseUrl,
        `/v1/sessions/${sessionId}/renders/async`,
        body,
      );
      expect(first.status).toBe(200);
      expect(first.body.disposition).toBe("admitted");

      await pollJob(harness.baseUrl, sessionId, "job-dup-1");

      const second = await postJson(
        harness.baseUrl,
        `/v1/sessions/${sessionId}/renders/async`,
        body,
      );
      expect(second.status).toBe(200);
      expect(second.body.disposition).toBe("duplicate");
      expect(second.body.jobId).toBe("job-dup-1");
      // The duplicate answer carries the ingested render id.
      expect(second.body.renderId).toMatch(/^r-\d+$/);
    } finally {
      harness.server.stop(true);
    }
  });

  it("a rights-denied policy never reaches dispatch (the control gate refuses it)", async () => {
    const harness = createComputeHarness();
    try {
      // The all-denied policy is refused AT SESSION CREATION (the fail-closed
      // gate) — no job can ever be dispatched for it (defense before depth).
      const response = await postJson(harness.baseUrl, "/v1/sessions", {
        authorizationPolicy: analysisOnly,
      });
      expect(response.status).toBe(403);
      expect(response.body.error.failureClass).toBe("rights-denied");
      expect(response.body.error.message).toContain("grants no rights capabilities");
    } finally {
      harness.server.stop(true);
    }
  });

  it("an unknown renderer answers 400 (the same admission as the sync path)", async () => {
    const harness = createComputeHarness();
    try {
      const sessionId = await newSession(harness.baseUrl, allowAll);
      const response = await postJson(harness.baseUrl, `/v1/sessions/${sessionId}/renders/async`, {
        rendererId: "no.such.renderer",
      });
      expect(response.status).toBe(400);
      expect(response.body.error.failureClass).toBe("media-invalid");
    } finally {
      harness.server.stop(true);
    }
  });

  it("a deadline below the adapter bound is refused at admission (400)", async () => {
    const harness = createComputeHarness();
    try {
      const sessionId = await newSession(harness.baseUrl, allowAll);
      const response = await postJson(harness.baseUrl, `/v1/sessions/${sessionId}/renders/async`, {
        rendererId: ANIME_RENDERER_ID,
        deadlineMs: 1, // the adapter's minJobDeadlineMs is 1_000
      });
      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("below the adapter bound");
    } finally {
      harness.server.stop(true);
    }
  });

  it("a determinate worker failure settles failed with ingest 'none' (no artifacts)", async () => {
    const harness = createComputeHarness();
    try {
      const sessionId = await newSession(harness.baseUrl, allowAll);
      // The test-card renderer has no W502 detailed surface: a determinate
      // renderer-not-encodable failure through the REAL worker.
      const dispatched = await postJson(
        harness.baseUrl,
        `/v1/sessions/${sessionId}/renders/async`,
        {
          rendererId: "sporta.testcard",
          outputProfile: {
            resolution: { w: 1280, h: 720 },
            frameRate: 30,
            codec: "h264",
            container: "mp4",
            latencyClass: "offline",
          },
        },
      );
      expect(dispatched.status).toBe(200);

      const job = await pollJob(harness.baseUrl, sessionId, dispatched.body.jobId);
      expect(job.body.state).toBe("failed");
      expect(job.body.ingest).toEqual({ status: "none" });
      expect(job.body.completion.failure.errorClass).toBe("renderer-not-encodable");
      // Honest accounting: the inputs WERE consumed by the failed execution.
      expect(job.body.completion.accounting.consumedInputIds).toEqual([
        "swm-snapshot",
        "swm-events",
      ]);
      expect(job.body.completion.accounting.unconsumedInputs).toEqual([]);
      expect(job.body.completion.usage.costUnits.length).toBeGreaterThan(0);
    } finally {
      harness.server.stop(true);
    }
  });

  it("job observation is session-scoped (a cross-session probe 404s)", async () => {
    const harness = createComputeHarness();
    try {
      const owner = await newSession(harness.baseUrl, allowAll);
      const other = await newSession(harness.baseUrl, allowAll);
      const dispatched = await postJson(harness.baseUrl, `/v1/sessions/${owner}/renders/async`, {
        rendererId: ANIME_RENDERER_ID,
        jobId: "job-scoped-1",
        idempotencyKey: "key-scoped-1",
      });
      expect(dispatched.status).toBe(200);

      const foreign = await getJson(
        harness.baseUrl,
        `/v1/sessions/${other}/compute-jobs/job-scoped-1`,
      );
      expect(foreign.status).toBe(404);
      expect(foreign.body.error.failureClass).toBe("unknown-compute-job");
      const own = await getJson(harness.baseUrl, `/v1/sessions/${owner}/compute-jobs/job-scoped-1`);
      expect(own.status).toBe(200);
    } finally {
      harness.server.stop(true);
    }
  });

  it("getComputeJob answers the typed 503 without an adapter; unknown jobs 404", async () => {
    const harness = createComputeHarness({ withAdapter: false });
    try {
      const sessionId = await newSession(harness.baseUrl, allowAll);
      const response = await getJson(harness.baseUrl, `/v1/sessions/${sessionId}/compute-jobs/any`);
      expect(response.status).toBe(503);
      expect(response.body.error.failureClass).toBe("compute-unavailable");
    } finally {
      harness.server.stop(true);
    }

    const withAdapter = createComputeHarness();
    try {
      const sessionId = await newSession(withAdapter.baseUrl, allowAll);
      const unknown = await getJson(
        withAdapter.baseUrl,
        `/v1/sessions/${sessionId}/compute-jobs/nope`,
      );
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.failureClass).toBe("unknown-compute-job");
    } finally {
      withAdapter.server.stop(true);
    }
  });

  it("W921 flight 8: a caller-supplied renderId is honored through the async ingest (never renumbered)", async () => {
    const harness = createComputeHarness();
    try {
      const sessionId = await newSession(harness.baseUrl, allowAll);
      const dispatched = await postJson(harness.baseUrl, `/v1/sessions/${sessionId}/renders/async`, {
        rendererId: ANIME_RENDERER_ID,
        renderId: "r-u-2a7d41f0c9b8e356",
      });
      expect(dispatched.status).toBe(200);
      const job = await pollJob(harness.baseUrl, sessionId, dispatched.body.jobId);
      expect(job.body.state).toBe("succeeded");
      expect(job.body.ingest).toEqual({ status: "stored" });
      expect(job.body.renderId).toBe("r-u-2a7d41f0c9b8e356");

      // The ingested artifact is playback-served under the caller's id.
      const outputs = await getJson(
        harness.baseUrl,
        `/v1/sessions/${sessionId}/renders/r-u-2a7d41f0c9b8e356/outputs`,
      );
      expect(outputs.status).toBe(200);
      expect(outputs.body.segments.length).toBeGreaterThan(0);
      const renders = await getJson(harness.baseUrl, `/v1/sessions/${sessionId}/renders`);
      expect(renders.body.renders.map((r: { renderId: string }) => r.renderId)).toEqual([
        "r-u-2a7d41f0c9b8e356",
      ]);
    } finally {
      harness.server.stop(true);
    }
  });

  it("W921 flight 8: a duplicate caller renderId fails the dispatch (typed 400, never renumbered)", async () => {
    const harness = createComputeHarness();
    try {
      const sessionId = await newSession(harness.baseUrl, allowAll);
      const taken = await postJson(harness.baseUrl, `/v1/sessions/${sessionId}/renders`, {
        rendererId: ANIME_RENDERER_ID,
        renderId: "r-u-conflict",
      });
      expect(taken.status).toBe(200);
      expect(taken.body.renderId).toBe("r-u-conflict");
      const dispatched = await postJson(harness.baseUrl, `/v1/sessions/${sessionId}/renders/async`, {
        rendererId: ANIME_RENDERER_ID,
        renderId: "r-u-conflict",
      });
      expect(dispatched.status).toBe(400);
      expect(dispatched.body.error.failureClass).toBe("validation");
      expect(dispatched.body.error.message).toContain("already in use");
      // The original render is untouched and nothing was renumbered.
      const renders = await getJson(harness.baseUrl, `/v1/sessions/${sessionId}/renders`);
      expect(renders.body.renders.map((r: { renderId: string }) => r.renderId)).toEqual([
        "r-u-conflict",
      ]);
    } finally {
      harness.server.stop(true);
    }
  });

  it("W921 flight 8: an invalid caller renderId is a 400 before anything runs", async () => {
    const harness = createComputeHarness();
    try {
      const sessionId = await newSession(harness.baseUrl, allowAll);
      const dispatched = await postJson(harness.baseUrl, `/v1/sessions/${sessionId}/renders/async`, {
        rendererId: ANIME_RENDERER_ID,
        renderId: "r_u-bad",
      });
      expect(dispatched.status).toBe(400);
      expect(dispatched.body.error.failureClass).toBe("validation");
      expect(dispatched.body.error.message).toContain("renderId");
    } finally {
      harness.server.stop(true);
    }
  });

  it("the synchronous createRender path is UNAFFECTED (the additive proof)", async () => {
    const harness = createComputeHarness();
    try {
      const sessionId = await newSession(harness.baseUrl, allowAll);
      const response = await postJson(harness.baseUrl, `/v1/sessions/${sessionId}/renders`, {
        rendererId: ANIME_RENDERER_ID,
      });
      expect(response.status).toBe(200);
      expect(response.body.renderId).toMatch(/^r-\d+$/);
      expect(response.body.result.rendererId).toBe(ANIME_RENDERER_ID);
      // And both paths coexist: async after sync.
      const asynch = await postJson(harness.baseUrl, `/v1/sessions/${sessionId}/renders/async`, {
        rendererId: ANIME_RENDERER_ID,
      });
      expect(asynch.status).toBe(200);
      const job = await pollJob(harness.baseUrl, sessionId, asynch.body.jobId);
      expect(job.body.state).toBe("succeeded");
    } finally {
      harness.server.stop(true);
    }
  });
});
