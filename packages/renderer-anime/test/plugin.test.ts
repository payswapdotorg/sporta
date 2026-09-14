import { describe, expect, test } from "bun:test";
import {
  RendererContractError,
  RendererRegistry,
  createTestCardRenderer,
} from "@sporta/renderer-contract";
import type { RendererContext } from "@sporta/renderer-contract";
import { RenderResult } from "@sporta/contracts";
import type { RenderRequest, RenderResult as RenderResultDoc } from "@sporta/contracts";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  createAnimePrototypeRenderer,
} from "../src/index";
import type { AnimePrototypeRenderer } from "../src/index";
import {
  ALLOW_ALL,
  DENY_ALL,
  SESSION_ID,
  buildAnimeRequest,
  buildFixtureEvent,
  buildFixtureSnapshot,
} from "./helpers";

/** A fresh plugin + admitted request + fixture input, per test. */
function setup() {
  const plugin = createAnimePrototypeRenderer();
  plugin.init();
  const req = buildAnimeRequest();
  const input = {
    snapshot: buildFixtureSnapshot(0),
    events: [
      buildFixtureEvent("fe-kickoff", 1_000, "football/v1/kickoff", 11),
      buildFixtureEvent("fe-pass", 1_500, "football/v1/pass", 12),
      buildFixtureEvent("fe-shot", 2_000, "football/v1/shot", 13),
    ],
  };
  return { plugin, req, input };
}

describe("capability — the immutable identity document (R1)", () => {
  test("pinned identity: anime.prototype@0.1.0, procedural-3d, one profile, no source frames", () => {
    const plugin = createAnimePrototypeRenderer();
    const capability = plugin.capability();
    expect(capability.rendererId).toBe("anime.prototype");
    expect(capability.rendererVersion).toBe("0.1.0");
    expect(capability.rendererClass).toBe("procedural-3d");
    expect(capability.supportedOutputProfiles).toEqual([ANIME_OUTPUT_PROFILE]);
    expect(capability.requiresSourceFrames).toBe(false);
    expect(capability.minSnapshotVersion).toBe(0);
  });

  test("capability() returns deep-equal documents on every call (R1)", () => {
    const plugin = createAnimePrototypeRenderer();
    expect(plugin.capability()).toEqual(plugin.capability());
    expect(plugin.capability()).not.toBe(plugin.capability()); // fresh clone per call
  });

  test("pluginKind brands the renderer plugin contract", () => {
    expect(createAnimePrototypeRenderer().pluginKind).toBe("sporta-renderer");
  });
});

describe("validateRequest — admission gates", () => {
  test("accepts the fixture request", () => {
    const { plugin, req } = setup();
    expect(plugin.validateRequest(req)).toEqual({ ok: true });
  });

  test("rejects a wrong rendererId with media-invalid (R3)", () => {
    const { plugin } = setup();
    const rejection = plugin.validateRequest(buildAnimeRequest({ rendererId: "other.renderer" }));
    expect(rejection).toMatchObject({ ok: false, failureClass: "media-invalid" });
    expect(rejection.ok === false && rejection.reason).toContain("other.renderer");
  });

  test("rejects a wrong rendererVersion with media-invalid (R3)", () => {
    const { plugin } = setup();
    const rejection = plugin.validateRequest(buildAnimeRequest({ rendererVersion: "9.9.9" }));
    expect(rejection).toMatchObject({ ok: false, failureClass: "media-invalid" });
  });

  test("rejects an off-list output profile with media-invalid (R3)", () => {
    const { plugin } = setup();
    const rejection = plugin.validateRequest(
      buildAnimeRequest({ outputProfile: { ...ANIME_OUTPUT_PROFILE, codec: "h264" } }),
    );
    expect(rejection).toMatchObject({ ok: false, failureClass: "media-invalid" });
  });

  test("rejects a snapshotVersion below the minimum with media-invalid (R3)", () => {
    const { plugin } = setup();
    // -1 also probes below the schema floor (the harness does exactly this);
    // built by spread because the request builder itself validates.
    const bad = { ...buildAnimeRequest(), snapshotVersion: -1 };
    const rejection = plugin.validateRequest(bad);
    expect(rejection).toMatchObject({ ok: false, failureClass: "media-invalid" });
  });

  test("FAIL-CLOSED rights: source-frame references without canReferenceSourceFrames → rights-denied (R2 posture)", () => {
    const { plugin } = setup();
    const rejection = plugin.validateRequest(
      buildAnimeRequest({ rightsCapabilities: DENY_ALL, sourceFrameRefs: ["frame-17"] }),
    );
    expect(rejection).toMatchObject({ ok: false, failureClass: "rights-denied" });
    expect(rejection.ok === false && rejection.reason).toContain("canReferenceSourceFrames");
  });

  test("fail-closed even when only the source-frame right is missing (deny-all probe)", () => {
    const { plugin } = setup();
    const noSourceFrames = { ...ALLOW_ALL, canReferenceSourceFrames: false };
    const rejection = plugin.validateRequest(
      buildAnimeRequest({ rightsCapabilities: noSourceFrames, sourceFrameRefs: ["f1"] }),
    );
    expect(rejection).toMatchObject({ ok: false, failureClass: "rights-denied" });
  });

  test("SWM-only rendering proceeds under full deny rights WITHOUT references (no over-gating)", () => {
    const { plugin } = setup();
    const acceptance = plugin.validateRequest(
      buildAnimeRequest({ rightsCapabilities: DENY_ALL, sourceFrameRefs: [] }),
    );
    expect(acceptance).toEqual({ ok: true });
  });

  test("rejects invalid style config values with media-invalid", () => {
    const { plugin } = setup();
    for (const config of [0, -1, 4_000_000, "6000", null]) {
      const rejection = plugin.validateRequest(
        buildAnimeRequest({
          styleConfig: { styleId: "s", configSchemaVersion: "1.0", config: { durationMs: config } },
        }),
      );
      expect(rejection).toMatchObject({ ok: false, failureClass: "media-invalid" });
    }
  });
});

describe("render — happy path (contract projection)", () => {
  test("produces a schema-valid RenderResult echoing session/renderer identity (R8)", () => {
    const { plugin, req, input } = setup();
    const result = plugin.render(req, input);
    expect(RenderResult.safeParse(result).success).toBe(true);
    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.rendererId).toBe(ANIME_RENDERER_ID);
  });

  test("default 6000 ms at 1 fps → 6 non-overlapping frames with anime:// artifact refs", () => {
    const { plugin, req, input } = setup();
    const result = plugin.render(req, input);
    expect(result.outputSegments).toHaveLength(6);
    expect(result.outputSegments.map((segment) => segment.segmentId)).toEqual([
      "anime-0",
      "anime-1",
      "anime-2",
      "anime-3",
      "anime-4",
      "anime-5",
    ]);
    for (const segment of result.outputSegments) {
      expect(segment.startMs).toBeGreaterThanOrEqual(0);
      expect(segment.endMs).toBeGreaterThan(segment.startMs);
      expect(segment.artifactRef).toMatch(new RegExp(`^anime://${SESSION_ID}/1/\\d+$`));
    }
    // Frames tile [watermark, watermark+6000) exactly, no overlap.
    const start = input.snapshot.watermark.watermarkMs;
    expect(result.outputSegments[0]!.startMs).toBe(start);
    expect(result.outputSegments.at(-1)!.endMs).toBe(start + 6_000);
    for (let i = 1; i < result.outputSegments.length; i += 1) {
      expect(result.outputSegments[i]!.startMs).toBe(result.outputSegments[i - 1]!.endMs);
    }
  });

  test("full event application: provenance + exact R6 watermark (healthy)", () => {
    const { plugin, req, input } = setup();
    const result = plugin.render(req, input);
    // Events at 1000/1500/2000 all fall in [1000, 7000): full application.
    expect(result.provenance).toEqual({ snapshotVersion: 1, lastEventSequence: 13 });
    expect(result.watermarkAfter).toEqual({ watermarkMs: 7_000, sequence: 13 });
    expect(result.rendererHealth).toEqual({ lagMs: 0, degraded: false });
  });

  test("zero events: provenance baseline 0 and the snapshot watermark sequence (R5/R6)", () => {
    const { plugin, req, input } = setup();
    const result = plugin.render(req, { ...input, events: [] });
    expect(result.provenance.lastEventSequence).toBe(0);
    expect(result.watermarkAfter.sequence).toBe(input.snapshot.watermark.sequence);
    expect(result.rendererHealth.degraded).toBe(false);
  });

  test("styleConfig durationMs shapes the frame count (3 s → 3 frames)", () => {
    const { plugin } = setup();
    const req = buildAnimeRequest({
      styleConfig: { styleId: "s", configSchemaVersion: "1.0", config: { durationMs: 3_000 } },
    });
    const result = plugin.render(req, input3s());
    expect(result.outputSegments).toHaveLength(3);
  });

  test("sub-interval duration yields exactly one shortened frame (never zero)", () => {
    const { plugin } = setup();
    const req = buildAnimeRequest({
      styleConfig: { styleId: "s", configSchemaVersion: "1.0", config: { durationMs: 1 } },
    });
    const { input } = setup();
    const result = plugin.render(req, input);
    expect(result.outputSegments).toHaveLength(1);
    expect(result.outputSegments[0]!.endMs - result.outputSegments[0]!.startMs).toBe(1);
  });

  function input3s() {
    return {
      snapshot: buildFixtureSnapshot(0),
      events: [buildFixtureEvent("fe-kickoff", 1_000, "football/v1/kickoff", 11)],
    };
  }
});

describe("render — defense in depth (no prior validateRequest)", () => {
  test("render re-runs the identity/profile gates and throws RendererContractError (R3)", () => {
    const { plugin, input } = setup();
    const offList = buildAnimeRequest({ rendererVersion: "9.9.9" });
    expect(() => plugin.render(offList, input)).toThrow(RendererContractError);
    expect(() => plugin.render(offList, input)).toThrow(/renderer/i);
  });

  test("render re-runs the rights gate: references without rights → rights-denied throw (R2)", () => {
    const { plugin, input } = setup();
    const req = buildAnimeRequest({ rightsCapabilities: DENY_ALL, sourceFrameRefs: ["frame-1"] });
    try {
      plugin.render(req, input);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RendererContractError);
      const rejection = error as RendererContractError;
      expect(rejection.failureClass).toBe("rights-denied");
      expect(rejection.details).toMatchObject({ sessionId: SESSION_ID });
    }
  });

  test("render refuses after dispose with RendererContractError internal (R4)", () => {
    const { plugin, req, input } = setup();
    plugin.dispose();
    expect(() => plugin.render(req, input)).toThrow(RendererContractError);
    try {
      plugin.render(req, input);
    } catch (error) {
      expect((error as RendererContractError).failureClass).toBe("internal");
    }
  });

  test("dispose is idempotent and terminal; init does not resurrect (R4)", () => {
    const { plugin, req, input } = setup();
    plugin.dispose();
    plugin.dispose();
    plugin.init();
    expect(() => plugin.render(req, input)).toThrow(RendererContractError);
  });

  test("validateRequest still answers after dispose (only render is terminal)", () => {
    const { plugin, req } = setup();
    plugin.dispose();
    expect(plugin.validateRequest(req)).toEqual({ ok: true });
  });
});

describe("render — fail-loud on malformed render input", () => {
  test("schema-invalid snapshot → RendererContractError media-invalid", () => {
    const { plugin, req } = setup();
    const broken = { ...buildFixtureSnapshot(0), entities: "not-an-array" };
    try {
      plugin.render(req, { snapshot: broken as never, events: [] });
      expect.unreachable();
    } catch (error) {
      expect((error as RendererContractError).failureClass).toBe("media-invalid");
    }
  });

  test("session mismatch between snapshot and request → media-invalid", () => {
    const { plugin } = setup();
    const otherSession = buildAnimeRequest({ sessionId: "sess-other" });
    const { input } = setup();
    try {
      plugin.render(otherSession, input);
      expect.unreachable();
    } catch (error) {
      expect((error as RendererContractError).failureClass).toBe("media-invalid");
      expect((error as Error).message).toContain("sess-other");
    }
  });

  test("event from another session → media-invalid", () => {
    const { plugin, req, input } = setup();
    const foreign = buildFixtureEvent("fe-x", 1_200, "football/v1/pass", 14);
    const foreignEvent = { ...foreign, event: { ...foreign.event, sessionId: "sess-other" } };
    try {
      plugin.render(req, { ...input, events: [foreignEvent] });
      expect.unreachable();
    } catch (error) {
      expect((error as RendererContractError).failureClass).toBe("media-invalid");
    }
  });

  test("non-ascending event sequences → media-invalid (input order is the contract)", () => {
    const { plugin, req, input } = setup();
    const first = buildFixtureEvent("fe-a", 1_200, "football/v1/pass", 12);
    const second = buildFixtureEvent("fe-b", 1_300, "football/v1/pass", 12);
    try {
      plugin.render(req, { ...input, events: [first, second] });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("ascending");
    }
  });

  test("event sequence not after the snapshot watermark → media-invalid", () => {
    const { plugin, req, input } = setup();
    const stale = buildFixtureEvent("fe-old", 1_200, "football/v1/pass", 10); // watermark is 10
    try {
      plugin.render(req, { ...input, events: [stale] });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("ascending");
    }
  });
});

describe("renderDetailed — the manifest projection", () => {
  test("returns result + frames + manifest, all mutually consistent", () => {
    const plugin: AnimePrototypeRenderer = createAnimePrototypeRenderer();
    plugin.init();
    const { req, input } = setup();
    const output = plugin.renderDetailed(req, input);
    expect(output.frames).toHaveLength(6);
    expect(output.manifest.frames).toHaveLength(6);
    expect(output.manifest.frames.map((frame) => frame.frameIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(output.manifest.frames[0]!.outputTimestampMs).toBe(input.snapshot.watermark.watermarkMs);
    for (const frame of output.frames) {
      expect(frame.svg.startsWith("<svg")).toBe(true);
      expect(frame.svg.endsWith("</svg>")).toBe(true);
    }
    expect(output.result.outputSegments.map((s) => s.artifactRef)).toEqual(
      output.frames.map((frame) => `anime://${SESSION_ID}/1/${frame.frameIndex}`),
    );
  });

  test("skipped events degrade honestly: before/after window accounting + reason (R7)", () => {
    const plugin = createAnimePrototypeRenderer();
    plugin.init();
    const req = buildAnimeRequest();
    const snapshot = buildFixtureSnapshot(0); // watermark 1000
    const events = [
      buildFixtureEvent("fe-late", 500, "football/v1/kickoff", 11), // before window
      buildFixtureEvent("fe-in", 1_200, "football/v1/pass", 12), // applied (frame 0)
      buildFixtureEvent("fe-after", 7_500, "football/v1/goal", 13), // after window
    ];
    const output = plugin.renderDetailed(req, { snapshot, events });
    expect(output.manifest.skippedEvents).toEqual([
      { sequence: 11, eventId: "fe-late", eventTimeMs: 500, reason: "before-window" },
      { sequence: 13, eventId: "fe-after", eventTimeMs: 7_500, reason: "after-window" },
    ]);
    // Provenance claims ONLY the applied event (R5: never upward lies)…
    expect(output.result.provenance.lastEventSequence).toBe(12);
    // …while the watermark sequence follows R6 (last INPUT event sequence)…
    expect(output.result.watermarkAfter.sequence).toBe(13);
    // …and the staleness is flagged, never silent (R7).
    expect(output.result.rendererHealth.degraded).toBe(true);
    expect(output.result.rendererHealth.degradationReason).toBe("events-outside-render-window");
    expect(output.manifest.degradation).toEqual({
      degraded: true,
      reasons: ["events-outside-render-window"],
    });
  });

  test("an event exactly at the window END is not applied (next render's window)", () => {
    const plugin = createAnimePrototypeRenderer();
    plugin.init();
    const req = buildAnimeRequest();
    const snapshot = buildFixtureSnapshot(0); // start 1000, window [1000, 7000)
    const events = [buildFixtureEvent("fe-edge", 7_000, "football/v1/goal", 11)];
    const output = plugin.renderDetailed(req, { snapshot, events });
    expect(output.result.provenance.lastEventSequence).toBe(0);
    expect(output.manifest.skippedEvents[0]).toMatchObject({ reason: "after-window" });
  });

  test("simulateDegradation flags degraded with the fixed reason (R7 pattern)", () => {
    const plugin = createAnimePrototypeRenderer();
    plugin.init();
    const req = buildAnimeRequest({
      styleConfig: {
        styleId: "s",
        configSchemaVersion: "1.0",
        config: { simulateDegradation: true },
      },
    });
    const { input } = setup();
    const output = plugin.renderDetailed(req, input);
    expect(output.result.rendererHealth).toEqual({
      lagMs: 0,
      degraded: true,
      degradationReason: "simulated-degradation",
    });
    expect(output.manifest.degradation.reasons).toEqual(["simulated-degradation"]);
  });

  test("degradation reasons join deterministically when both apply", () => {
    const plugin = createAnimePrototypeRenderer();
    plugin.init();
    const req = buildAnimeRequest({
      styleConfig: {
        styleId: "s",
        configSchemaVersion: "1.0",
        config: { simulateDegradation: true },
      },
    });
    const snapshot = buildFixtureSnapshot(0);
    const events = [buildFixtureEvent("fe-after", 9_000, "football/v1/goal", 11)];
    const output = plugin.renderDetailed(req, { snapshot, events });
    expect(output.result.rendererHealth.degradationReason).toBe(
      "events-outside-render-window;simulated-degradation",
    );
  });

  test("entity degradation accounting: every snapshot entity appears with a disposition", () => {
    const plugin = createAnimePrototypeRenderer();
    plugin.init();
    const { req, input } = setup();
    const output = plugin.renderDetailed(req, input);
    const entities = output.manifest.frames[0]!.entities;
    const byId = new Map(entities.map((entry) => [entry.entityId, entry]));
    expect(entities).toHaveLength(7);
    expect(byId.get("player-7")).toMatchObject({ disposition: "rendered" });
    expect(byId.get("player-9")).toMatchObject({
      disposition: "rendered",
      confidence: 0.7,
      positionStatus: "uncertain",
    });
    expect(byId.get("player-11")).toMatchObject({ disposition: "omitted-no-position" });
    expect(byId.get("player-out")).toMatchObject({ disposition: "rendered-out-of-play" });
    expect(byId.get("player-far")).toMatchObject({ disposition: "omitted-out-of-play" });
    expect(byId.get("team-1")).toMatchObject({ disposition: "not-rendered-kind" });
    expect(byId.get("ball-1")).toMatchObject({ disposition: "rendered", confidence: 0.9 });
  });

  test("out-of-play honesty: TRUE unclamped meters recorded, never clamped", () => {
    const plugin = createAnimePrototypeRenderer();
    plugin.init();
    const { req, input } = setup();
    const output = plugin.renderDetailed(req, input);
    const entities = output.manifest.frames[0]!.entities;
    const near = entities.find((entry) => entry.entityId === "player-out")!;
    expect(near.positionMeters).toEqual({ x: -3, y: 34 });
    expect(near.svgPosition).toEqual({ x: 30, y: 400 }); // true projection
    const far = entities.find((entry) => entry.entityId === "player-far")!;
    expect(far.positionMeters).toEqual({ x: 120, y: 34 });
    expect(far.svgPosition).toBeUndefined(); // omitted, accounted
  });

  test("captions: verbatim phrases + honest uncaptioned accounting + status line", () => {
    const plugin = createAnimePrototypeRenderer();
    plugin.init();
    const req = buildAnimeRequest();
    const snapshot = buildFixtureSnapshot(0);
    const events = [
      buildFixtureEvent("fe-goal", 1_200, "football/v1/goal", 11),
      buildFixtureEvent("fe-weird", 1_400, "football/v9/variant-unknown", 12),
    ];
    const output = plugin.renderDetailed(req, { snapshot, events });
    const frame = output.manifest.frames[0]!;
    expect(frame.captions.events).toEqual([{ sequence: 11, eventId: "fe-goal", phrase: "GOAL!" }]);
    expect(frame.captions.uncaptionedEvents).toEqual([
      { sequence: 12, eventId: "fe-weird", eventTypeRef: "football/v9/variant-unknown" },
    ]);
    expect(frame.captions.statusLine).toBe("First half · 01:00 · 1-0?");
    expect(frame.captions.score).toEqual({
      displayed: true,
      status: "uncertain",
      text: "1-0?",
    });
    expect(frame.captions.clockText).toBe("01:00");
    // The SVG shows ONLY the table phrase (no invented text for the unknown ref).
    expect(output.frames[0]!.svg).toContain(">GOAL!</text>");
    expect(output.frames[0]!.svg).not.toContain("variant-unknown");
  });

  test("possession accounting: ring around the rendered participant, confidence verbatim", () => {
    const plugin = createAnimePrototypeRenderer();
    plugin.init();
    const { req, input } = setup();
    const output = plugin.renderDetailed(req, input);
    expect(output.manifest.frames[0]!.possession).toEqual({
      status: "uncertain",
      entityId: "player-7",
      confidence: 0.75,
      displayed: true,
    });
    expect(output.frames[0]!.svg).toContain('r="20"'); // the ring
    expect(output.frames[0]!.svg).toContain('opacity="0.838"'); // 0.35+0.65·0.75
  });
});

describe("determinism — deep-equal rerun across instances", () => {
  test("two fresh plugins over the same request/input produce deep-equal results", () => {
    const { req, input } = setup();
    const first = createAnimePrototypeRenderer();
    first.init();
    const second = createAnimePrototypeRenderer();
    second.init();
    const a: RenderResultDoc = first.render(req, input);
    const b: RenderResultDoc = second.render(req, input);
    expect(a).toEqual(b);
  });

  test("renderDetailed reruns are byte-identical (SVG) and manifest deep-equal", () => {
    const { req, input } = setup();
    const pluginA = createAnimePrototypeRenderer();
    const pluginB = createAnimePrototypeRenderer();
    const a = pluginA.renderDetailed(req, input);
    const b = pluginB.renderDetailed(req, input);
    expect(a.manifest).toEqual(b.manifest);
    expect(a.frames.map((frame) => frame.svg)).toEqual(b.frames.map((frame) => frame.svg));
    expect(a.frames[0]!.svg).toBe(b.frames[0]!.svg);
  });
});

describe("RendererRegistry integration", () => {
  test("register, resolve by exact version, and list", () => {
    const registry = new RendererRegistry();
    const plugin = createAnimePrototypeRenderer();
    registry.register(plugin);
    const resolved = registry.resolve(ANIME_RENDERER_ID, ANIME_RENDERER_VERSION);
    expect(resolved).toBe(plugin);
    expect(registry.resolve(ANIME_RENDERER_ID)).toBe(plugin);
    expect(registry.list().map((capability) => capability.rendererId)).toEqual([ANIME_RENDERER_ID]);
  });

  test("the plugin renders through the registry end-to-end", () => {
    const registry = new RendererRegistry();
    registry.register(createAnimePrototypeRenderer());
    const plugin = registry.resolve(ANIME_RENDERER_ID, ANIME_RENDERER_VERSION);
    const { req, input } = setup();
    // The registry surface types render as MaybePromise; the concrete
    // plugin is synchronous, so the value is the result itself.
    const result = plugin.render(req, input) as RenderResultDoc;
    expect(result.rendererId).toBe(ANIME_RENDERER_ID);
    expect(result.outputSegments).toHaveLength(6);
  });

  test("coexists with the W501 test-card renderer (replaceable plugins)", () => {
    const registry = new RendererRegistry();
    registry.register(createAnimePrototypeRenderer());
    registry.register(createTestCardRenderer());
    expect(
      registry
        .list()
        .map((capability) => capability.rendererId)
        .sort(),
    ).toEqual(["anime.prototype", "sporta.testcard"]);
  });

  test("duplicate registration of the same version is rejected (immutable versions)", () => {
    const registry = new RendererRegistry();
    registry.register(createAnimePrototypeRenderer());
    expect(() => registry.register(createAnimePrototypeRenderer())).toThrow(RendererContractError);
  });

  test("unknown id resolution fails loudly", () => {
    const registry = new RendererRegistry();
    expect(() => registry.resolve("anime.prototype")).toThrow(RendererContractError);
  });
});

describe("observability seam (optional, no-ops when absent)", () => {
  /** A minimal Logger/Metrics capture mock. */
  function makeSeam() {
    const lines: Array<{ msg: string; fields: Record<string, unknown> }> = [];
    const counters: Record<string, number> = {};
    const logger = {
      child: () => ({
        info: (msg: string, fields?: Record<string, unknown>) => {
          lines.push({ msg, fields: fields ?? {} });
        },
      }),
    };
    const metrics = {
      counter: (name: string) => ({
        inc: (n = 1) => {
          counters[name] = (counters[name] ?? 0) + n;
        },
      }),
    };
    return { lines, counters, logger, metrics };
  }

  test("one structured info line per render call, with request/failure counters", () => {
    const seam = makeSeam();
    const plugin = createAnimePrototypeRenderer();
    const ctx: RendererContext = {
      observability: { logger: seam.logger as never, metrics: seam.metrics as never },
    };
    plugin.init(ctx);
    const { req, input } = setup();
    plugin.render(req, input);
    expect(seam.lines).toHaveLength(1);
    expect(seam.lines[0]!.msg).toBe("anime.render");
    expect(seam.lines[0]!.fields).toMatchObject({
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: ANIME_RENDERER_VERSION,
      snapshotVersion: 1,
      eventCount: 3,
      frameCount: 6,
    });
    expect(seam.counters).toEqual({ render_requests_total: 1 });
    // A refused render bumps the failure counter and never logs success.
    expect(() => plugin.render(buildAnimeRequest({ rendererVersion: "9.9.9" }), input)).toThrow(
      RendererContractError,
    );
    expect(seam.counters).toEqual({ render_requests_total: 2, render_failures_total: 1 });
    expect(seam.lines).toHaveLength(1);
  });

  test("rendering without a seam is silent and correct (absent seam ⇒ no-op)", () => {
    const plugin = createAnimePrototypeRenderer();
    plugin.init();
    const { req, input } = setup();
    const result: RenderRequest | RenderResultDoc = plugin.render(req, input);
    expect((result as RenderResultDoc).outputSegments).toHaveLength(6);
  });

  test("health() reports a static non-degraded snapshot independent of results", () => {
    const plugin = createAnimePrototypeRenderer();
    expect(plugin.health()).toEqual({ lagMs: 0, degraded: false });
  });
});
