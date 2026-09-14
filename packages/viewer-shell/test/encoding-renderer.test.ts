/**
 * Encoding renderer tests (W705): the HOST-SIDE wrapper that runs the real
 * W504 output pipeline step (encode → store) for every successful render.
 *
 * Pinned over the REAL anime plugin + REAL pipeline:
 *
 * - the DELEGATION contract (every plugin call unchanged; the wrapper's
 *   surface is the same `AnimePrototypeRenderer`, so it composes with the
 *   W702 capturing wrapper);
 * - the host step itself: a successful `renderDetailed` encodes + stores
 *   through the pipeline (stats + a servable segment under the predicted
 *   id);
 * - the `r-<n>` mapping invariant against a REAL `createControlApp`
 *   (the app's render ids match the pipeline's stored scopes, in order);
 * - the failure path: a REAL store-limit rejection (no mock — a bounded
 *   `InMemoryRenderSegmentStore`) fails the createRender LOUD, stores
 *   nothing, and ROLLS the wrapper's counter back so the ids stay aligned
 *   for the next successful render;
 * - a plugin rejection (dispose) stores nothing.
 */
import { describe, expect, test } from "bun:test";
import { createControlApp } from "@sporta/control-api";
import { createAnimePrototypeRenderer } from "@sporta/renderer-anime";
import type { AnimePrototypeRenderer } from "@sporta/renderer-anime";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
} from "@sporta/renderer-anime";
import { RendererRegistry } from "@sporta/renderer-contract";
import { InMemoryRenderSegmentStore } from "@sporta/output-pipeline";
import { createAnimeOutputPipeline, encodeAnimeClip } from "@sporta/output-pipeline";
import type { AnimeOutputPipeline } from "@sporta/output-pipeline";
import { buildRenderRequest, buildWorldSnapshot, TEST_EPOCH_MS } from "@sporta/testing";
import { createEncodingRenderer } from "../src/encoding-renderer.ts";
import {
  createCapturingRenderer,
  createRenderOutputCaptureStore,
} from "../src/render-output-store.ts";
import { fullAllowPolicy } from "./helpers.ts";

const ALLOW_ALL = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** A real anime render request (the W701 control-app render path). */
function animeRequest(sessionId: string) {
  return buildRenderRequest({
    sessionId,
    rendererId: ANIME_RENDERER_ID,
    rendererVersion: ANIME_RENDERER_VERSION,
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: ANIME_OUTPUT_PROFILE,
    styleConfig: { styleId: "style-encoding-test", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: ALLOW_ALL,
    sourceFrameRefs: [],
  });
}

/** A real anime clip input (the genesis snapshot + an empty event tail). */
function animeInput(sessionId: string) {
  return {
    snapshot: buildWorldSnapshot(
      { sessionId, watermark: { watermarkMs: 0, sequence: 1 }, entities: [] },
      42,
    ),
    events: [],
  };
}

describe("encoding renderer — the delegation contract over the REAL anime plugin", () => {
  function makePair(): {
    plugin: AnimePrototypeRenderer;
    pipeline: AnimeOutputPipeline;
    wrapped: AnimePrototypeRenderer;
  } {
    const plugin = createAnimePrototypeRenderer();
    const pipeline = createAnimeOutputPipeline();
    const wrapped = createEncodingRenderer(plugin, { pipeline });
    return { plugin, pipeline, wrapped };
  }

  test("capability/validateRequest/health delegate verbatim", () => {
    const { plugin, wrapped } = makePair();
    expect(wrapped.capability()).toEqual(plugin.capability());
    expect(wrapped.capability()).toEqual(wrapped.capability()); // R1 holds through the wrap
    expect(wrapped.pluginKind).toBe(plugin.pluginKind);
    expect(wrapped.validateRequest(animeRequest("sess-1"))).toEqual(
      plugin.validateRequest(animeRequest("sess-1")),
    );
    expect(wrapped.health()).toEqual(plugin.health());
  });

  test("render delegates to the contract result; renderDetailed returns the detailed output", () => {
    const { wrapped } = makePair();
    const req = animeRequest("sess-1");
    const input = animeInput("sess-1");
    const result = wrapped.render(req, input);
    expect(result.rendererId).toBe(ANIME_RENDERER_ID);
    // The single-snapshot render path: 6000 ms @ 1 fps → 6 frames.
    expect(result.outputSegments).toHaveLength(6);
    const detailed = wrapped.renderDetailed(req, input);
    expect(detailed.result).toEqual(result);
    expect(detailed.frames).toHaveLength(6);
  });

  test("a plugin rejection (dispose) propagates and stores NOTHING", () => {
    const { pipeline, wrapped } = makePair();
    wrapped.dispose();
    expect(() => wrapped.renderDetailed(animeRequest("sess-1"), animeInput("sess-1"))).toThrow(
      /disposed/,
    );
    expect(pipeline.stats().segments).toBe(0);
    expect(pipeline.stats().artifacts).toBe(0);
  });
});

describe("encoding renderer — the host step (encode → store through the real pipeline)", () => {
  test("a successful renderDetailed stores one servable segment under the predicted id", () => {
    const pipeline = createAnimeOutputPipeline();
    const wrapped = createEncodingRenderer(createAnimePrototypeRenderer(), { pipeline });
    const output = wrapped.renderDetailed(animeRequest("sess-1"), animeInput("sess-1"));
    expect(pipeline.stats().segments).toBe(1);
    expect(pipeline.stats().artifacts).toBe(1);
    // The stored scope is the predicted id, and the served content is the
    // canonical encoding of the same render.
    const stored = pipeline.getSegment({
      sessionId: "sess-1",
      renderId: "r-1",
      segmentId: encodeAnimeClip(output).segmentId,
      policy: fullAllowPolicy,
      nowMs: TEST_EPOCH_MS,
    });
    expect(stored).not.toBeNull();
    expect(stored!.content).toBe(encodeAnimeClip(output).content);
    // Second render → the second predicted id.
    wrapped.renderDetailed(animeRequest("sess-1"), animeInput("sess-1"));
    expect(pipeline.stats().segments).toBe(2);
    expect(
      pipeline.listSegments({
        sessionId: "sess-1",
        renderId: "r-2",
        policy: fullAllowPolicy,
        nowMs: TEST_EPOCH_MS,
      }),
    ).toHaveLength(1);
  });

  test("composes with the W702 capturing wrapper (both stores fed, ONE plugin render)", () => {
    const pipeline = createAnimeOutputPipeline();
    const captureStore = createRenderOutputCaptureStore();
    const plugin = createAnimePrototypeRenderer();
    const wrapped = createCapturingRenderer(
      createEncodingRenderer(plugin, { pipeline }),
      captureStore,
    );
    wrapped.render(animeRequest("sess-1"), animeInput("sess-1"));
    expect(captureStore.size()).toBe(1);
    expect(pipeline.stats().segments).toBe(1);
    expect(captureStore.resolve("r-1")?.sessionId).toBe("sess-1");
  });
});

describe("encoding renderer — the r-<n> mapping invariant against a REAL control app", () => {
  test("the app's render ids match the pipeline's stored scopes, in order", async () => {
    const pipeline = createAnimeOutputPipeline();
    const registry = new RendererRegistry();
    registry.register(createEncodingRenderer(createAnimePrototypeRenderer(), { pipeline }));
    const app = createControlApp({
      rendererRegistry: registry,
      renderOutputStore: pipeline,
      nowMs: () => TEST_EPOCH_MS,
    });
    for (let i = 1; i <= 2; i += 1) {
      const session = await app.createSession({
        authorizationPolicy: fullAllowPolicy,
        ...(i === 1 ? { sourceLabel: "encoding-renderer-test" } : {}),
      });
      const envelope = await app.createRender(session.session.sessionId, {
        rendererId: ANIME_RENDERER_ID,
      });
      expect(envelope.renderId).toBe(`r-${i}`);
      const segments = pipeline.listSegments({
        sessionId: session.session.sessionId,
        renderId: envelope.renderId,
        policy: fullAllowPolicy,
        nowMs: TEST_EPOCH_MS,
      });
      expect(segments).toHaveLength(1);
      expect(segments[0]!.segmentId).toMatch(/^anime-clip-[0-9a-f]{8}$/);
    }
    expect(pipeline.stats().segments).toBe(2);
  });

  test("a REAL store-limit rejection fails the createRender LOUD and rolls the counter back (ids stay aligned)", async () => {
    // A bounded REAL store (maxSegments: 1) — no mock failure injection.
    const segmentStore = new InMemoryRenderSegmentStore({ limits: { maxSegments: 1 } });
    const pipeline = createAnimeOutputPipeline({ segmentStore });
    const registry = new RendererRegistry();
    registry.register(createEncodingRenderer(createAnimePrototypeRenderer(), { pipeline }));
    const app = createControlApp({
      rendererRegistry: registry,
      renderOutputStore: pipeline,
      nowMs: () => TEST_EPOCH_MS,
    });
    const session = await app.createSession({ authorizationPolicy: fullAllowPolicy });

    // Render #1: stored, the app assigns r-1.
    const first = await app.createRender(session.session.sessionId, {
      rendererId: ANIME_RENDERER_ID,
    });
    expect(first.renderId).toBe("r-1");
    expect(pipeline.stats().segments).toBe(1);

    // Render #2: the segment store rejects (limit) → the wrapper propagates
    // (the app answers its internal class — the pipeline's structural class
    // mapping is wired on the playback routes, not the createRender plugin
    // path) and rolls its counter back.
    await expect(
      app.createRender(session.session.sessionId, { rendererId: ANIME_RENDERER_ID }),
    ).rejects.toThrow(/above the count limit/i);
    expect(pipeline.stats().segments).toBe(1); // nothing new stored

    // Free the store (the host may delete), then render #3: the wrapper
    // predicts r-2 — the app's counter agrees (the failed render was never
    // counted on either side).
    const listed = pipeline.listSegments({
      sessionId: session.session.sessionId,
      renderId: "r-1",
      policy: fullAllowPolicy,
      nowMs: TEST_EPOCH_MS,
    });
    segmentStore.deleteSegment(session.session.sessionId, "r-1", listed[0]!.segmentId);
    const third = await app.createRender(session.session.sessionId, {
      rendererId: ANIME_RENDERER_ID,
    });
    expect(third.renderId).toBe("r-2");
    expect(pipeline.stats().segments).toBe(1);
    expect(
      pipeline.listSegments({
        sessionId: session.session.sessionId,
        renderId: "r-2",
        policy: fullAllowPolicy,
        nowMs: TEST_EPOCH_MS,
      }),
    ).toHaveLength(1);
  });
});
