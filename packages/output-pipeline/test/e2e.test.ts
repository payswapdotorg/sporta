/**
 * W504 in-process E2E — the FULL accept-criterion chain through a REAL
 * control server (`Bun.serve` on port 0, real `fetch`): a session and a
 * render-ref are created through the viewer API (the REAL anime plugin
 * registered in the control plane's registry), the host-side pipeline
 * encodes the equivalent detailed render (equivalence PROVEN by deep-equal
 * against the HTTP `RenderResult`), stores it (segment store + content
 * addressed artifact store), and the playback fetch returns the
 * byte-identical artifact. Plus: the rights-denial path, the
 * missing-artifact path, malformed requests, the `anime://` ref resolution,
 * full-chain determinism, and a durable (sqlite + on-disk) wiring variant.
 *
 * Determinism: the clock is the frozen `TEST_EPOCH_MS` injection (the app's
 * engine snapshots and the test's genesis snapshot then agree exactly — the
 * equivalence assertion below depends on it and would fail otherwise).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RendererRegistry } from "@sporta/renderer-contract";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  createAnimePrototypeRenderer,
  renderAnimeFromSnapshot,
} from "@sporta/renderer-anime";
import type { AnimeRenderOutput } from "@sporta/renderer-anime";
import { SCHEMA_VERSION, deriveRightsCapabilities } from "@sporta/contracts";
import type {
  AuthorizationPolicy,
  RenderRequest,
  RenderResult,
  WorldSnapshot,
} from "@sporta/contracts";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { createControlServer } from "@sporta/control-api";
import {
  OnDiskArtifactStore,
  SqliteRenderSegmentStore,
  contentHashOf,
  createAnimeOutputPipeline,
  encodeAnimeClip,
} from "../src/index";
import type { AnimeOutputPipeline, PipelineStoreResult } from "../src/index";
import { analysisTransformationPolicy, fullAllowPolicy } from "./helpers";

// ---------------------------------------------------------------------------
// Harness: a real control server with the anime plugin + the real pipeline
// ---------------------------------------------------------------------------

interface E2eHarness {
  server: ReturnType<typeof createControlServer>;
  baseUrl: string;
  pipeline: AnimeOutputPipeline;
  lines: string[];
  metrics: MetricsRegistry;
}

/** A fresh registry with the REAL anime prototype plugin registered. */
function animeRegistry(): RendererRegistry {
  const registry = new RendererRegistry();
  registry.register(createAnimePrototypeRenderer());
  return registry;
}

/** Creates a harness whose playback store is the REAL output pipeline. */
function createE2eHarness(pipeline: AnimeOutputPipeline = createAnimeOutputPipeline()): E2eHarness {
  const lines: string[] = [];
  const logger = createLogger({
    sink: (line: string) => {
      lines.push(line);
    },
    now: () => TEST_EPOCH_MS,
  });
  const metrics = new MetricsRegistry();
  const server = createControlServer({
    port: 0,
    observability: { logger, metrics },
    // FROZEN clock: the app's world-model engine snapshots then carry
    // generatedAtMs = TEST_EPOCH_MS, exactly like the test's genesis
    // snapshot below — the equivalence proof depends on this.
    nowMs: () => TEST_EPOCH_MS,
    rendererRegistry: animeRegistry(),
    renderOutputStore: pipeline,
  });
  return { server, baseUrl: `http://127.0.0.1:${server.port}`, pipeline, lines, metrics };
}

/** Creates a session over HTTP and returns its id. */
async function createSession(baseUrl: string, policy: AuthorizationPolicy): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/sessions`, {
    method: "POST",
    body: JSON.stringify({ authorizationPolicy: policy }),
    headers: { "content-type": "application/json" },
  });
  const body = (await response.json()) as { session: { sessionId: string } };
  expect(response.status).toBe(200);
  return body.session.sessionId;
}

/** One HTTP call, parsed as JSON. */
async function callJson<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T; headers: Headers }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as T;
  return { status: response.status, body, headers: response.headers };
}

/** POST-JSON helper. */
function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  };
}

interface RenderResponse {
  renderId: string;
  result: RenderResult;
}

interface ErrorBody {
  error: { failureClass: string; message: string; details?: Record<string, unknown> };
}

interface PlaybackDocument {
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentType: string;
  byteLength: number;
  contentHash: string;
  content: string;
  manifest: {
    segmentId: string;
    frameCount: number;
    contentHash: string;
    sourceManifest: { frames: unknown[]; session: { sessionId: string } };
  };
}

interface PlaybackList {
  sessionId: string;
  renderId: string;
  segments: Array<{
    segmentId: string;
    contentType: string;
    byteLength: number;
    contentHash: string;
  }>;
}

// ---------------------------------------------------------------------------
// The golden path: session → render-ref → encode → store → playback fetch
// ---------------------------------------------------------------------------

const harness: E2eHarness = createE2eHarness();
afterAll(async () => {
  harness.server.stop(true);
});

/**
 * The host-side detailed render that reproduces the control plane's render
 * for a fresh session: the same request the app built (the app's defaults
 * are all reconstructible: style `default`, the plugin's first supported
 * profile, the fresh engine's snapshot version 1, watermark sequence 0, the
 * derived full-allow capabilities, the frozen clock) plus the same genesis
 * snapshot (watermark 0/0, no entities, generatedAtMs TEST_EPOCH_MS).
 */
function equivalentDetailedRender(sessionId: string): AnimeRenderOutput {
  const snapshot: WorldSnapshot = {
    sessionId,
    schemaVersion: SCHEMA_VERSION,
    watermark: { watermarkMs: 0, sequence: 0 },
    entities: [],
    generatedAtMs: TEST_EPOCH_MS,
  };
  const request: RenderRequest = {
    sessionId,
    schemaVersion: SCHEMA_VERSION,
    rendererId: ANIME_RENDERER_ID,
    rendererVersion: ANIME_RENDERER_VERSION,
    styleConfig: { styleId: "default", configSchemaVersion: SCHEMA_VERSION, config: {} },
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: ANIME_OUTPUT_PROFILE,
    rightsCapabilities: deriveRightsCapabilities(fullAllowPolicy, new Date(TEST_EPOCH_MS)),
    sourceFrameRefs: [],
  };
  return renderAnimeFromSnapshot(request, { snapshot, events: [] });
}

describe("W504 golden path — session → render-ref → encode → store → playback fetch", () => {
  let sessionId: string;
  let renderId: string;
  let httpResult: RenderResult;
  let stored: PipelineStoreResult;
  let localOutput: AnimeRenderOutput;

  test("steps 1-2: session + render-ref through the viewer API (the REAL anime plugin)", async () => {
    sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: ANIME_RENDERER_ID }),
    );
    expect(response.status).toBe(200);
    renderId = response.body.renderId;
    httpResult = response.body.result;
    expect(renderId).toMatch(/^r-\d+$/);
    expect(httpResult.rendererId).toBe(ANIME_RENDERER_ID);
    expect(httpResult.outputSegments).toHaveLength(6);
    // The W502 opaque artifact refs, as produced by the real plugin:
    expect(httpResult.outputSegments.map((segment) => segment.artifactRef)).toEqual(
      [0, 1, 2, 3, 4, 5].map((index) => `anime://${sessionId}/1/${index}`),
    );
  });

  test("step 3: the host-side detailed render is EQUIVALENT (deep-equal RenderResult)", () => {
    localOutput = equivalentDetailedRender(sessionId);
    expect(localOutput.result).toEqual(httpResult);
  });

  test("step 4: encode → store through the pipeline (both layers)", () => {
    stored = harness.pipeline.encodeAndStore({ sessionId, renderId, output: localOutput });
    expect(stored.outcome).toBe("stored");
    expect(stored.artifactOutcome).toBe("stored");
    expect(stored.segmentId).toMatch(/^anime-clip-[0-9a-f]{8}$/);
    expect(stored.artifactId).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.frameCount).toBe(6);
    // The artifact id is the sha-256 of the canonically encoded document.
    expect(stored.artifactId).toBe(contentHashOf(encodeAnimeClip(localOutput).content));
  });

  test("step 5: every W502 anime:// artifactRef resolves to the served coordinates", () => {
    for (const segment of httpResult.outputSegments) {
      const locations = harness.pipeline.locateAnimeRef({
        ref: segment.artifactRef,
        policy: fullAllowPolicy,
        nowMs: TEST_EPOCH_MS,
      });
      expect(locations).toHaveLength(1);
      expect(locations[0]!.renderId).toBe(renderId);
      expect(locations[0]!.segmentId).toBe(stored.segmentId);
      expect(locations[0]!.artifactId).toBe(stored.artifactId);
      expect(locations[0]!.sessionId).toBe(sessionId);
      expect(locations[0]!.frameIndex).toBe(Number(segment.artifactRef.split("/").pop()));
    }
  });

  test("step 6: GET …/outputs lists the stored segment summary", async () => {
    const response = await callJson<PlaybackList>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/${renderId}/outputs`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      sessionId,
      renderId,
      segments: [
        {
          segmentId: stored.segmentId,
          contentType: "image/svg+xml",
          byteLength: stored.byteLength,
          contentHash: stored.artifactId,
        },
      ],
    });
  });

  test("step 7: GET …/outputs/:segmentId returns the BYTE-IDENTICAL artifact + verbatim manifest", async () => {
    const response = await callJson<PlaybackDocument>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/${renderId}/outputs/${stored.segmentId}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe(sessionId);
    expect(response.body.renderId).toBe(renderId);
    expect(response.body.segmentId).toBe(stored.segmentId);
    expect(response.body.contentType).toBe("image/svg+xml");
    // BYTE-IDENTICAL: the served content equals the canonical encoding of
    // the equivalent render — the whole chain is byte-stable end to end.
    expect(response.body.content).toBe(encodeAnimeClip(localOutput).content);
    expect(response.body.byteLength).toBe(stored.byteLength);
    expect(response.body.byteLength).toBe(new TextEncoder().encode(response.body.content).length);
    expect(response.body.contentHash).toBe(stored.artifactId);
    // The sha-256 of the served content re-verifies as the artifact id.
    expect(contentHashOf(response.body.content)).toBe(stored.artifactId);
    // The container manifest is carried verbatim (source manifest intact).
    expect(response.body.manifest.segmentId).toBe(stored.segmentId);
    expect(response.body.manifest.frameCount).toBe(6);
    expect(response.body.manifest.contentHash).toBe(stored.artifactId);
    expect(response.body.manifest.sourceManifest.frames).toHaveLength(6);
    expect(response.body.manifest.sourceManifest.session.sessionId).toBe(sessionId);
  });
});

// ---------------------------------------------------------------------------
// Rights denial through the viewer API (the playback side of the gate)
// ---------------------------------------------------------------------------

describe("W504 rights denial — playback denied before any artifact byte is served", () => {
  test("rendering stays allowed without storage rights; playback denies 403 (list + get)", async () => {
    const deniedSession = await createSession(harness.baseUrl, analysisTransformationPolicy);
    // The compute side of the gate: the render itself succeeds.
    const renderResponse = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${deniedSession}/renders`,
      postJson({ rendererId: ANIME_RENDERER_ID }),
    );
    expect(renderResponse.status).toBe(200);
    // The playback side: BOTH playback routes deny before existence.
    const getList = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${deniedSession}/renders/${renderResponse.body.renderId}/outputs`,
    );
    expect(getList.status).toBe(403);
    expect(getList.body.error.failureClass).toBe("rights-denied");
    expect(getList.body.error.message).toContain("canStoreDerivatives");
    const getSegment = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${deniedSession}/renders/${renderResponse.body.renderId}/outputs/anime-clip-00000000`,
    );
    expect(getSegment.status).toBe(403);
    expect(getSegment.body.error.failureClass).toBe("rights-denied");
  });
});

// ---------------------------------------------------------------------------
// Missing artifacts + malformed requests
// ---------------------------------------------------------------------------

describe("W504 missing artifacts + malformed requests", () => {
  test("unknown render (no stored outputs) → 404 unknown-render; list → 200 []", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const list = await callJson<PlaybackList>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-999999/outputs`,
    );
    expect(list.status).toBe(200);
    expect(list.body.segments).toEqual([]);
    const get = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-999999/outputs/anime-clip-00000000`,
    );
    expect(get.status).toBe(404);
    expect(get.body.error.failureClass).toBe("unknown-render");
  });

  test("known render, wrong segment id → 404 unknown-segment", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const render = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: ANIME_RENDERER_ID }),
    );
    harness.pipeline.encodeAndStore({
      sessionId,
      renderId: render.body.renderId,
      output: equivalentDetailedRender(sessionId),
    });
    const get = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/${render.body.renderId}/outputs/anime-clip-00000000`,
    );
    expect(get.status).toBe(404);
    expect(get.body.error.failureClass).toBe("unknown-segment");
  });

  test("malformed requests: POST on a GET route → 405; deeper unknown route → 404", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const post = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-1/outputs`,
      postJson({}),
    );
    expect(post.status).toBe(405);
    expect(post.body.error.failureClass).toBe("method-not-allowed");
    expect(post.headers.get("allow")).toBe("GET");
    const deeper = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-1/outputs/anime-clip-01234567/extra`,
    );
    expect(deeper.status).toBe(404);
    expect(deeper.body.error.failureClass).toBe("unknown-route");
  });

  test("a NUL-crafted segment id (%00) → 400 media-invalid from the REAL store (typed, never served)", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const render = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: ANIME_RENDERER_ID }),
    );
    harness.pipeline.encodeAndStore({
      sessionId,
      renderId: render.body.renderId,
      output: equivalentDetailedRender(sessionId),
    });
    // The NUL id is rejected loudly by the store's key-space validation
    // (mapped structurally onto the control taxonomy) — a NUL-ambiguous
    // composite key can never address another scope's stored output.
    const nul = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/${render.body.renderId}/outputs/${encodeURIComponent(`c\u0000anime-clip-00000000`)}`,
    );
    expect(nul.status).toBe(400);
    expect(nul.body.error.failureClass).toBe("media-invalid");
    expect(nul.body.error.message).toContain("NUL");
  });
});

// ---------------------------------------------------------------------------
// Determinism: the whole chain is reproducible
// ---------------------------------------------------------------------------

describe("W504 determinism — the full chain twice is deep-equal", () => {
  test("two independent servers + pipelines produce byte-identical served artifacts", async () => {
    async function runChain(): Promise<{
      result: PipelineStoreResult;
      document: PlaybackDocument;
      stats: ReturnType<AnimeOutputPipeline["stats"]>;
    }> {
      const local = createE2eHarness();
      try {
        const sessionId = await createSession(local.baseUrl, fullAllowPolicy);
        const render = await callJson<RenderResponse>(
          local.baseUrl,
          `/v1/sessions/${sessionId}/renders`,
          postJson({ rendererId: ANIME_RENDERER_ID }),
        );
        const result = local.pipeline.encodeAndStore({
          sessionId,
          renderId: render.body.renderId,
          output: equivalentDetailedRender(sessionId),
        });
        const document = await callJson<PlaybackDocument>(
          local.baseUrl,
          `/v1/sessions/${sessionId}/renders/${render.body.renderId}/outputs/${result.segmentId}`,
        );
        return { result, document: document.body, stats: local.pipeline.stats() };
      } finally {
        local.server.stop(true);
      }
    }
    const first = await runChain();
    const second = await runChain();
    expect(first.result).toEqual(second.result);
    expect(first.document).toEqual(second.document);
    expect(first.document.content).toBe(second.document.content);
    expect(first.stats).toEqual(second.stats);
  });
});

// ---------------------------------------------------------------------------
// Durable wiring: sqlite segment store + on-disk artifact store
// ---------------------------------------------------------------------------

describe("W504 durable wiring — sqlite + on-disk artifacts through the control server", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sporta-w504-e2e-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("the golden path over durable backends (reopened stores serve the same bytes)", async () => {
    const dbPath = join(tempDir, "segments.sqlite");
    const artifactRoot = join(tempDir, "artifacts");
    const pipeline = createAnimeOutputPipeline({
      segmentStore: new SqliteRenderSegmentStore(dbPath),
      artifactStore: new OnDiskArtifactStore(artifactRoot),
    });
    const durable = createE2eHarness(pipeline);
    try {
      const sessionId = await createSession(durable.baseUrl, fullAllowPolicy);
      const render = await callJson<RenderResponse>(
        durable.baseUrl,
        `/v1/sessions/${sessionId}/renders`,
        postJson({ rendererId: ANIME_RENDERER_ID }),
      );
      const storedResult = pipeline.encodeAndStore({
        sessionId,
        renderId: render.body.renderId,
        output: equivalentDetailedRender(sessionId),
      });
      // Serve through HTTP.
      const document = await callJson<PlaybackDocument>(
        durable.baseUrl,
        `/v1/sessions/${sessionId}/renders/${render.body.renderId}/outputs/${storedResult.segmentId}`,
      );
      expect(document.status).toBe(200);
      expect(contentHashOf(document.body.content)).toBe(storedResult.artifactId);
      // Refs resolve.
      const ref = render.body.result.outputSegments[0]!.artifactRef;
      const locations = pipeline.locateAnimeRef({
        ref,
        policy: fullAllowPolicy,
        nowMs: TEST_EPOCH_MS,
      });
      expect(locations).toHaveLength(1);
      expect(locations[0]!.segmentId).toBe(storedResult.segmentId);

      // Worker "restart": NEW store instances over the same files serve the
      // same bytes (store-level rehydration — the W504-owned layer).
      const rehydratedPipeline = createAnimeOutputPipeline({
        segmentStore: new SqliteRenderSegmentStore(dbPath),
        artifactStore: new OnDiskArtifactStore(artifactRoot),
      });
      const record = rehydratedPipeline.getSegment({
        sessionId,
        renderId: render.body.renderId,
        segmentId: storedResult.segmentId,
        policy: fullAllowPolicy,
        nowMs: TEST_EPOCH_MS,
      });
      expect(record).not.toBeNull();
      expect(record!.content).toBe(document.body.content);
      expect(record!.contentHash).toBe(storedResult.artifactId);
      expect(
        rehydratedPipeline.locateAnimeRef({ ref, policy: fullAllowPolicy, nowMs: TEST_EPOCH_MS }),
      ).toHaveLength(1);
      // The content-addressed bytes layer agrees by artifact id.
      const artifact = rehydratedPipeline.artifactStore.getArtifact(storedResult.artifactId);
      expect(artifact!.content).toBe(document.body.content);

      // A fresh control plane over the SAME durable stores serves a NEW
      // session's render byte-deterministically (the control plane's
      // session state is in-memory by W701 design — a full HTTP restart
      // demo would additionally need a durable session repository, an
      // honest limitation documented in the file header).
      const rehydrated = createE2eHarness(rehydratedPipeline);
      try {
        const freshSession = await createSession(rehydrated.baseUrl, fullAllowPolicy);
        const freshRender = await callJson<RenderResponse>(
          rehydrated.baseUrl,
          `/v1/sessions/${freshSession}/renders`,
          postJson({ rendererId: ANIME_RENDERER_ID }),
        );
        const freshStored = rehydratedPipeline.encodeAndStore({
          sessionId: freshSession,
          renderId: freshRender.body.renderId,
          output: equivalentDetailedRender(freshSession),
        });
        // Same logical render identity fields except the session scope —
        // the content is session-bound, so compare per-session determinism:
        const freshDocument = await callJson<PlaybackDocument>(
          rehydrated.baseUrl,
          `/v1/sessions/${freshSession}/renders/${freshRender.body.renderId}/outputs/${freshStored.segmentId}`,
        );
        expect(freshDocument.status).toBe(200);
        expect(freshDocument.body.content).toBe(
          encodeAnimeClip(equivalentDetailedRender(freshSession)).content,
        );
        expect(contentHashOf(freshDocument.body.content)).toBe(freshStored.artifactId);
      } finally {
        rehydrated.server.stop(true);
      }
    } finally {
      durable.server.stop(true);
    }
  });
});
