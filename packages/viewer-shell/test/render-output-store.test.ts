/**
 * Render-output capture store tests (W702): the server-side stand-in for the
 * W504 stored-output API. Pins the store's record/resolve semantics
 * (structuredClone isolation — a mutated record can never corrupt the
 * store), the capturing renderer's DELEGATION contract (every plugin call
 * unchanged; rejections propagate and record NOTHING), and the render-id
 * mapping invariant (`r-<n>`) against a REAL `createControlApp` with the
 * wrapped anime renderer registered.
 */
import { describe, expect, test } from "bun:test";
import { createControlApp } from "@sporta/control-api";
import { createAnimePrototypeRenderer } from "@sporta/renderer-anime";
import type { AnimePrototypeRenderer } from "@sporta/renderer-anime";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  renderAnimeClip,
} from "@sporta/renderer-anime";
import type { AnimeClipStep } from "@sporta/renderer-anime";
import { RendererRegistry } from "@sporta/renderer-contract";
import { buildRenderRequest, buildWorldSnapshot } from "@sporta/testing";
import { TEST_EPOCH_MS } from "@sporta/testing";
import {
  createCapturingRenderer,
  createRenderOutputCaptureStore,
} from "../src/render-output-store.ts";
import type { RenderOutputCaptureStore } from "../src/render-output-store.ts";
import { fullAllowPolicy } from "./helpers.ts";

const ALLOW_ALL = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** A real anime render over one snapshot (the W701 control-app render path). */
function animeRequest(sessionId: string, overrides: { rendererId?: string } = {}) {
  return buildRenderRequest({
    sessionId,
    rendererId: overrides.rendererId ?? ANIME_RENDERER_ID,
    rendererVersion: ANIME_RENDERER_VERSION,
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: ANIME_OUTPUT_PROFILE,
    styleConfig: { styleId: "style-store-test", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: ALLOW_ALL,
    sourceFrameRefs: [],
  });
}

function animeInput(sessionId: string) {
  return {
    snapshot: buildWorldSnapshot(
      { sessionId, watermark: { watermarkMs: 0, sequence: 1 }, entities: [] },
      42,
    ),
    events: [],
  };
}

/** A real anime clip output (the W502 document the store captures). */
function realClipOutput(sessionId: string) {
  const steps: AnimeClipStep[] = [0, 1_000].map((atMs, index) => ({
    atMs,
    snapshot: buildWorldSnapshot(
      { sessionId, watermark: { watermarkMs: atMs, sequence: 10 + index }, entities: [] },
      100 + index,
    ),
    events: [],
  }));
  return renderAnimeClip(animeRequest(sessionId), steps);
}

describe("capture store — record/resolve semantics", () => {
  test("record assigns deterministic r-<n> ids; resolve and records agree", () => {
    const store = createRenderOutputCaptureStore();
    const output = realClipOutput("sess-1");
    expect(store.record("sess-1", output)).toBe("r-1");
    expect(store.record("sess-1", output)).toBe("r-2");
    expect(store.size()).toBe(2);
    expect(store.resolve("r-1")?.sessionId).toBe("sess-1");
    expect(store.resolve("r-2")?.renderId).toBe("r-2");
    expect(store.resolve("r-404")).toBeUndefined();
    expect(store.records().map((record) => record.renderId)).toEqual(["r-1", "r-2"]);
  });

  test("records are structurally cloned — mutating a resolved record cannot corrupt the store", () => {
    const store = createRenderOutputCaptureStore();
    const output = realClipOutput("sess-1");
    store.record("sess-1", output);
    // Mutate the ORIGINAL after recording: the store keeps its own copy.
    output.frames[0]!.svg = "<svg>mutated</svg>";
    output.manifest.output.durationMs = 1;
    const record = store.resolve("r-1");
    expect(record?.output.frames[0]?.svg).not.toBe("<svg>mutated</svg>");
    expect(record?.output.manifest.output.durationMs).not.toBe(1);
    // Mutate the RESOLVED record: the store keeps its own copy.
    if (record !== undefined) {
      record.output.frames[0]!.svg = "<svg>mutated-again</svg>";
      record.output.manifest.output.durationMs = 2;
    }
    expect(store.resolve("r-1")?.output.frames[0]?.svg).not.toBe("<svg>mutated-again</svg>");
    expect(store.resolve("r-1")?.output.manifest.output.durationMs).not.toBe(2);
    // records() also returns copies.
    store.records()[0]!.output.frames[0]!.svg = "<svg>mutated-3</svg>";
    expect(store.resolve("r-1")?.output.frames[0]?.svg).not.toBe("<svg>mutated-3</svg>");
  });
});

describe("capturing renderer — delegation contract over the REAL anime plugin", () => {
  function makePair(): {
    plugin: AnimePrototypeRenderer;
    store: RenderOutputCaptureStore;
    wrapped: ReturnType<typeof createCapturingRenderer>;
  } {
    const plugin = createAnimePrototypeRenderer();
    const store = createRenderOutputCaptureStore();
    const wrapped = createCapturingRenderer(plugin, store);
    return { plugin, store, wrapped };
  }

  test("capability delegates verbatim (deep-equal to the wrapped plugin's)", () => {
    const { plugin, wrapped } = makePair();
    expect(wrapped.capability()).toEqual(plugin.capability());
    expect(wrapped.capability()).toEqual(wrapped.capability()); // R1 holds through the wrap
    expect(wrapped.pluginKind).toBe("sporta-renderer");
  });

  test("validateRequest delegates: acceptance AND rejection identical to the wrapped plugin", () => {
    const { plugin, wrapped } = makePair();
    const good = animeRequest("sess-1");
    expect(wrapped.validateRequest(good)).toEqual(plugin.validateRequest(good));
    // R3 rejection: a request whose rendererId does not match the plugin.
    const bad = animeRequest("sess-1", { rendererId: "no.such.renderer" });
    expect(wrapped.validateRequest(bad)).toEqual(plugin.validateRequest(bad));
    expect(wrapped.validateRequest(bad).ok).toBe(false);
  });

  test("render delegates, returns the contract result, and records the detailed output", async () => {
    const { wrapped, store } = makePair();
    const req = animeRequest("sess-1");
    const result = await wrapped.render(req, animeInput("sess-1"));
    expect(store.size()).toBe(1);
    const record = store.resolve("r-1");
    // Fail-loud guard (strict tsc): the record must exist before it is read.
    if (record === undefined) throw new Error("expected the captured record r-1 to exist");
    expect(record.sessionId).toBe("sess-1");
    // The contract result is the recorded output's result document.
    expect(result.provenance).toEqual(record.output.manifest.provenance);
    expect(result.watermarkAfter).toEqual(record.output.manifest.watermarkAfter);
    expect(record.output.frames.length).toBeGreaterThan(0);
    expect(record.output.manifest.renderer.rendererId).toBe(ANIME_RENDERER_ID);
    // The returned RenderResult matches the manifest's contract fields.
    expect(result.rendererId).toBe(ANIME_RENDERER_ID);
    expect(result.sessionId).toBe("sess-1");
    expect(result.outputSegments.length).toBe(record.output.frames.length);
  });

  test("a plugin rejection propagates and records NOTHING", () => {
    const { wrapped, store } = makePair();
    const bad = animeRequest("sess-1", { rendererId: "no.such.renderer" });
    expect(() => wrapped.render(bad, animeInput("sess-1"))).toThrow();
    expect(store.size()).toBe(0);
    expect(store.resolve("r-1")).toBeUndefined();
  });

  test("health and dispose delegate (health stays healthy until dispose)", () => {
    const { wrapped } = makePair();
    expect(wrapped.health()).toEqual({ lagMs: 0, degraded: false });
    wrapped.dispose();
    expect(wrapped.health()).toEqual({ lagMs: 0, degraded: false });
    // R4 through the wrap: post-dispose render throws (and records nothing).
    const { store } = makePair();
    const plugin2 = createAnimePrototypeRenderer();
    const wrapped2 = createCapturingRenderer(plugin2, store);
    wrapped2.dispose();
    expect(() => wrapped2.render(animeRequest("sess-2"), animeInput("sess-2"))).toThrow();
    expect(store.size()).toBe(0);
  });
});

describe("the r-<n> mapping invariant — against a REAL control app", () => {
  test("the app's render ids match the store's capture ids, in order", async () => {
    const store = createRenderOutputCaptureStore();
    const registry = new RendererRegistry();
    registry.register(createCapturingRenderer(createAnimePrototypeRenderer(), store));
    const app = createControlApp({
      rendererRegistry: registry,
      nowMs: () => TEST_EPOCH_MS,
    });

    await app.createSession({ authorizationPolicy: fullAllowPolicy, sourceLabel: "store-1" });
    const first = await app.createRender("sess-1", { rendererId: ANIME_RENDERER_ID });
    expect(first.renderId).toBe("r-1");
    expect(store.resolve("r-1")?.sessionId).toBe("sess-1");
    expect(store.resolve("r-1")?.output.frames.length).toBe(first.result.outputSegments.length);

    const second = await app.createRender("sess-1", { rendererId: ANIME_RENDERER_ID });
    expect(second.renderId).toBe("r-2");
    expect(store.resolve("r-2")?.renderId).toBe("r-2");
    expect(store.size()).toBe(2);

    // The captured output IS the playable W502 document for the render: the
    // manifest's contract fields match the envelope the app returned.
    const captured = store.resolve("r-1")?.output;
    expect(captured?.manifest.session.sessionId).toBe("sess-1");
    expect(captured?.manifest.provenance.snapshotVersion).toBe(
      first.result.provenance.snapshotVersion,
    );
  });

  test("a FAILED createRender records nothing (the ids stay aligned)", async () => {
    const store = createRenderOutputCaptureStore();
    const registry = new RendererRegistry();
    registry.register(createCapturingRenderer(createAnimePrototypeRenderer(), store));
    const app = createControlApp({
      rendererRegistry: registry,
      nowMs: () => TEST_EPOCH_MS,
    });
    await app.createSession({ authorizationPolicy: fullAllowPolicy });
    // Unknown renderer: the app rejects BEFORE the plugin runs.
    const rejected = await app
      .createRender("sess-1", { rendererId: "no.such.renderer" })
      .catch((err: unknown) => err);
    expect(String(rejected)).toContain("no.such.renderer");
    expect(store.size()).toBe(0);
    // The next successful render still lands on r-1 in BOTH counters.
    const ok = await app.createRender("sess-1", { rendererId: ANIME_RENDERER_ID });
    expect(ok.renderId).toBe("r-1");
    expect(store.resolve("r-1")).toBeDefined();
  });
});
