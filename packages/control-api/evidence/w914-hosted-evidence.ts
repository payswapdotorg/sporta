/**
 * W914 LOCAL REAL-HTTP END-TO-END EVIDENCE (flight 3's boundary).
 *
 * Two real topologies, real sockets, real renders:
 *
 *  A. The DEPLOYED-SHAPE WORKER ROUTE: the production `next start` server
 *     (apps/web, port 3459 — non-3000) serving `/api/compute` —
 *     GET (health + descriptor), GET ?descriptor=1, and ONE REAL render job
 *     dispatched over HTTP through POST (the result envelope).
 *
 *  B. The FULL HOSTED TOPOLOGY: a real compute worker (`Bun.serve`, port
 *     3460) + a real control plane (port 3461) whose adapter is selected by
 *     ENVIRONMENT (COMPUTE_PROVIDER=http, COMPUTE_WORKER_URL=...): dispatch
 *     async → poll the job to completion → read the artifact back through
 *     the playback-gated route.
 *
 * Run: bun packages/control-api/evidence/w914-hosted-evidence.ts   (from the repo root)
 * Everything it starts is stopped before exit; `ps` verifies afterwards.
 */
import { spawn } from "node:child_process";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";
import { canonicalJsonOf, sha256OfCanonicalJson } from "@sporta/compute-adapter";
import { createComputeWorkerServer, createComputeWorker } from "@sporta/compute-adapter-hosted";
import { resolveComputeAdapterFromEnv } from "@sporta/compute-adapter-hosted";
import { createControlServer } from "@sporta/control-api";
import { RendererRegistry } from "@sporta/renderer-contract";
import { ANIME_RENDERER_ID, createAnimePrototypeRenderer } from "@sporta/renderer-anime";
import { InMemoryRenderSegmentStore } from "@sporta/output-pipeline";
import { WorldModelEngine } from "@sporta/world-model";
import type { WorldModelEngine as WorldModelEngineInstance } from "@sporta/world-model";

const SESSION_ID = "sess-w914-evidence";
const FAR_FUTURE_ISO = "2099-12-31T23:59:59.000Z";
const NEXT_PORT = 3459;
const WORKER_PORT = 3460;
const CONTROL_PORT = 3461;

function line(label: string, value: unknown): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  console.log(`  ${label}: ${text}`);
}

/** Builds a REAL dispatch request (deterministic seeded fixtures). */
async function buildRealDispatchRequest(jobId: string): Promise<unknown> {
  const snapshot = buildWorldSnapshot({ sessionId: SESSION_ID });
  const entries = [
    {
      sequence: snapshot.watermark.sequence + 1,
      snapshotVersionAfter: 1,
      event: buildEventEnvelope({
        sessionId: SESSION_ID,
        eventTimeMs: snapshot.watermark.watermarkMs + 1,
      }),
    },
  ];
  const snapshotPayload = { snapshotVersion: 1, snapshot };
  const eventsPayload = { fromSequence: snapshot.watermark.sequence, entries };
  return {
    job: {
      schemaVersion: "1.0",
      jobId,
      idempotencyKey: `render-${SESSION_ID}-evidence-${jobId}`,
      sessionId: SESSION_ID,
      correlationId: `corr-${jobId}`,
      traceId: `trace-${jobId}`,
      renderer: { rendererId: ANIME_RENDERER_ID },
      recipe: { styleId: "style-anime-test", configSchemaVersion: "1.0", config: {} },
      inputs: [
        {
          inputId: "swm-snapshot",
          kind: "swm-snapshot",
          ref: `swm-snapshot:${SESSION_ID}:v1`,
          contentHash: await sha256OfCanonicalJson(snapshotPayload),
          byteSize: canonicalJsonOf(snapshotPayload).length,
        },
        {
          inputId: "swm-events",
          kind: "swm-event-window",
          ref: `swm-events:${SESSION_ID}:from-${snapshot.watermark.sequence}`,
          contentHash: await sha256OfCanonicalJson(eventsPayload),
          byteSize: canonicalJsonOf(eventsPayload).length,
        },
      ],
      outputProfile: {
        resolution: { w: 1170, h: 880 },
        frameRate: 1,
        codec: "svg",
        container: "svg",
        latencyClass: "offline",
      },
      rights: { policyRef: "policy-w914-evidence", canReferenceSourceFrames: true },
      constraints: { deadlineMs: 60_000, priority: 0 },
    },
    inputs: [
      { inputId: "swm-snapshot", kind: "swm-snapshot", payload: snapshotPayload },
      { inputId: "swm-events", kind: "swm-event-window", payload: eventsPayload },
    ],
  };
}

/** Waits until a URL answers 200 (bounded). */
async function waitReady(url: string, attempts = 60): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(500);
  }
  throw new Error(`server at ${url} never became ready`);
}

async function partA(): Promise<void> {
  console.log("\n=== PART A: the deployed-shape worker route (next start, /api/compute) ===");
  const child = spawn("bun", ["--bun", "run", "start"], {
    cwd: new URL("../../../apps/web", import.meta.url).pathname,
    env: { ...process.env, PORT: String(NEXT_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitReady(`http://127.0.0.1:${NEXT_PORT}/api/compute`);
    console.log(`[A] production server up on 127.0.0.1:${NEXT_PORT} (NON-3000)`);

    const health = await (await fetch(`http://127.0.0.1:${NEXT_PORT}/api/compute`)).json();
    console.log("[A] GET /api/compute ->");
    line("ok", health.ok);
    line("service", health.service);
    line("adapterId", health.adapterId);
    line("providerId", health.providerId);
    line("descriptor.supportedRenderers", health.descriptor.supportedRenderers);

    const descriptor = await (
      await fetch(`http://127.0.0.1:${NEXT_PORT}/api/compute?descriptor=1`)
    ).json();
    console.log("[A] GET /api/compute?descriptor=1 ->");
    line("adapterVersion", descriptor.adapterVersion);
    line("providerKind", descriptor.providerKind);
    line(
      "costUnits",
      descriptor.costUnits.map((u: { unitId: string }) => u.unitId),
    );

    const request = await buildRealDispatchRequest("job-next-route-1");
    const response = await fetch(`http://127.0.0.1:${NEXT_PORT}/api/compute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as {
      disposition: string;
      result: {
        status: string;
        outputs: Array<{ artifactId: string; byteLength: number; contentType: string }>;
        metering: Record<string, number>;
        consumedInputIds: string[];
      };
    };
    console.log(`[A] POST /api/compute (REAL render job over HTTP) -> HTTP ${response.status}`);
    line("disposition", body.disposition);
    line("result.status", body.result.status);
    line("artifactId (sha-256)", body.result.outputs[0]!.artifactId);
    line("contentType", body.result.outputs[0]!.contentType);
    line("byteLength", body.result.outputs[0]!.byteLength);
    line("metering", body.result.metering);
    line("consumedInputIds", body.result.consumedInputIds);
    if (body.result.status !== "succeeded") process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
    await Bun.sleep(500);
    child.kill("SIGKILL");
    console.log("[A] production server stopped (SIGTERM then SIGKILL)");
  }
}

async function partB(): Promise<void> {
  console.log("\n=== PART B: the full hosted topology (control plane --HTTP--> worker) ===");
  // 1. The real compute worker (its own Bun.serve).
  const worker = createComputeWorker({
    rendererRegistry: (() => {
      const registry = new RendererRegistry();
      registry.register(createAnimePrototypeRenderer());
      return registry;
    })(),
    outputSegmentStore: new InMemoryRenderSegmentStore(),
    nowMs: () => Date.now(),
  });
  const workerServer = createComputeWorkerServer({ worker, port: WORKER_PORT });
  console.log(`[B] compute worker up on 127.0.0.1:${WORKER_PORT}`);

  // 2. The control plane with the adapter selected BY ENVIRONMENT (http).
  const resolved = await resolveComputeAdapterFromEnv({
    env: { COMPUTE_PROVIDER: "http", COMPUTE_WORKER_URL: `http://127.0.0.1:${WORKER_PORT}` },
  });
  console.log("[B] resolveComputeAdapterFromEnv ->");
  line("provider (env-selected)", resolved.provider);
  line("adapterId", resolved.adapter?.describe().adapterId);
  const store = new InMemoryRenderSegmentStore();
  const worldModelFactory = (sessionId: string): WorldModelEngineInstance => {
    const engine = WorldModelEngine.create(sessionId, { now: () => 1_700_000_000_000 });
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
  };
  const registry = new RendererRegistry();
  registry.register(createAnimePrototypeRenderer());
  const control = createControlServer({
    port: CONTROL_PORT,
    rendererRegistry: registry,
    worldModelFactory,
    computeAdapter: resolved.adapter!,
    renderOutputStore: store,
    renderOutputWriter: store,
  });
  const controlBase = `http://127.0.0.1:${CONTROL_PORT}`;
  console.log(`[B] control plane up on 127.0.0.1:${CONTROL_PORT}`);

  try {
    // 3. Create a session.
    const created = await fetch(`${controlBase}/v1/sessions`, {
      method: "POST",
      body: JSON.stringify({
        authorizationPolicy: {
          policyId: "policy-w914-evidence",
          allowedOperations: [
            "analysis",
            "transformation",
            "liveDelivery",
            "derivativeGeneration",
            "storage",
            "sharing",
          ],
          assertedBy: "sporta-evidence",
          expiresAtIso: FAR_FUTURE_ISO,
        },
      }),
      headers: { "content-type": "application/json" },
    });
    const session = (await created.json()) as { session: { sessionId: string } };
    console.log("[B] POST /v1/sessions ->");
    line("sessionId", session.session.sessionId);

    // 4. Dispatch the async render (REAL job over the HTTP provider).
    const dispatched = await fetch(
      `${controlBase}/v1/sessions/${session.session.sessionId}/renders/async`,
      {
        method: "POST",
        body: JSON.stringify({ rendererId: ANIME_RENDERER_ID }),
        headers: { "content-type": "application/json" },
      },
    );
    const dispatch = (await dispatched.json()) as {
      disposition: string;
      jobId: string;
      idempotencyKey: string;
      jobState: string;
    };
    console.log(`[B] POST /v1/sessions/:id/renders/async -> HTTP ${dispatched.status}`);
    line("disposition", dispatch.disposition);
    line("jobId", dispatch.jobId);
    line("idempotencyKey", dispatch.idempotencyKey);
    line("jobState(at return)", dispatch.jobState);

    // 5. Poll to completion.
    const seen = new Set<string>();
    let job: Record<string, any>;
    for (let i = 0; i < 100; i += 1) {
      const response = await fetch(
        `${controlBase}/v1/sessions/${session.session.sessionId}/compute-jobs/${dispatch.jobId}`,
      );
      job = await response.json();
      if (!seen.has(job.state)) {
        seen.add(job.state);
        console.log(
          `[B] poll GET /v1/sessions/:id/compute-jobs/${dispatch.jobId} -> state ${job.state}`,
        );
      }
      if (["succeeded", "failed", "cancelled", "dead-lettered"].includes(job.state)) break;
      await Bun.sleep(20);
    }
    console.log("[B] final job document ->");
    line("state", job.state);
    line("ingest", job.ingest);
    line("renderId", job.renderId);
    line("completion.accounting", job.completion.accounting);
    line("completion.usage.costUnits", job.completion.usage.costUnits);
    line("completion.timing", job.completion.timing);
    if (job.state !== "succeeded") process.exitCode = 1;

    // 6. Read the artifact back (playback-gated route).
    const outputs = (await (
      await fetch(
        `${controlBase}/v1/sessions/${session.session.sessionId}/renders/${job.renderId}/outputs`,
      )
    ).json()) as {
      segments: Array<{
        segmentId: string;
        contentType: string;
        byteLength: number;
        contentHash: string;
      }>;
    };
    console.log("[B] GET /v1/sessions/:id/renders/:renderId/outputs ->");
    line(
      "segments",
      outputs.segments.map((s) => s.segmentId),
    );
    const segment = outputs.segments[0]!;
    const doc = (await (
      await fetch(
        `${controlBase}/v1/sessions/${session.session.sessionId}/renders/${job.renderId}/outputs/${segment.segmentId}`,
      )
    ).json()) as { contentType: string; byteLength: number; contentHash: string; content: string };
    console.log("[B] GET .../outputs/:segmentId (artifact read-back) ->");
    line("contentType", doc.contentType);
    line("byteLength", doc.byteLength);
    line("contentHash", doc.contentHash);
    line("content (first 60 chars)", doc.content.slice(0, 60));

    // 7. The worker's own per-job record + whole-worker metering.
    const record = (await (
      await fetch(`http://127.0.0.1:${WORKER_PORT}/v1/jobs/${dispatch.jobId}`)
    ).json()) as { state: string; duplicateExecutions: number };
    const wstats = worker.stats();
    console.log("[B] worker-side GET /v1/jobs/:jobId + worker.stats() ->");
    line("record.state", record.state);
    line("worker.jobsExecuted", wstats.jobsExecuted);
    line("worker.succeeded", wstats.succeeded);
    line("worker.segmentsStored", wstats.segmentsStored);
    line("worker.bytesEncoded", wstats.bytesEncoded);
    line("worker.totalExecutionMs", wstats.totalExecutionMs);
  } finally {
    control.stop(true);
    workerServer.stop(true);
    console.log("[B] control plane + compute worker stopped");
  }
}

console.log("W914 LOCAL REAL-HTTP EVIDENCE (flight 3)");
await partA();
await partB();
console.log("\nEVIDENCE COMPLETE");
