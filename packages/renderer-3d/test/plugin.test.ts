import { describe, expect, test } from "bun:test";
import {
  RendererContractError,
  RendererRegistry,
  createTestCardRenderer,
} from "@sporta/renderer-contract";
import type { RendererContext } from "@sporta/renderer-contract";
import { RenderResult } from "@sporta/contracts";
import type { RenderResult as RenderResultDoc } from "@sporta/contracts";
import {
  AVATAR_FIELD_RENDERER_ID,
  AVATAR_FIELD_RENDERER_VERSION,
  createAvatarFieldRenderer,
} from "../src/index";
import type { AvatarFieldRenderer } from "../src/index";
import {
  ALLOW_ALL,
  DENY_ALL,
  build3dRequest,
  buildFixtureEvent,
  buildFixtureSnapshot,
} from "./helpers";

/** A fresh plugin + admitted request + fixture input, per test. */
function setup() {
  const plugin = createAvatarFieldRenderer();
  plugin.init();
  const req = build3dRequest();
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

describe("validateRequest — admission gates (R3 + rights + style)", () => {
  test("accepts the fixture request", () => {
    const { plugin, req } = setup();
    expect(plugin.validateRequest(req)).toEqual({ ok: true });
  });

  test("rejects a wrong rendererId with media-invalid (R3)", () => {
    const { plugin } = setup();
    const rejection = plugin.validateRequest(build3dRequest({ rendererId: "other.renderer" }));
    expect(rejection).toMatchObject({ ok: false, failureClass: "media-invalid" });
    expect(rejection.ok === false && rejection.reason).toContain("other.renderer");
  });

  test("rejects a wrong rendererVersion with media-invalid (R3)", () => {
    const { plugin } = setup();
    const rejection = plugin.validateRequest(build3dRequest({ rendererVersion: "9.9.9" }));
    expect(rejection).toMatchObject({ ok: false, failureClass: "media-invalid" });
    expect(rejection.ok === false && rejection.reason).toContain("9.9.9");
  });

  test("rejects an off-list output profile with media-invalid (R3)", () => {
    const { plugin } = setup();
    const rejection = plugin.validateRequest(
      build3dRequest({ outputProfile: { ...build3dRequest().outputProfile, frameRate: 30 } }),
    );
    expect(rejection).toMatchObject({ ok: false, failureClass: "media-invalid" });
  });

  test("rejects a stale snapshot version with media-invalid (R3)", () => {
    const { plugin } = setup();
    const rejection = plugin.validateRequest({ ...build3dRequest(), snapshotVersion: -1 });
    expect(rejection).toMatchObject({ ok: false, failureClass: "media-invalid" });
  });

  test("fail-closed rights (beyond R2): carried refs without rights → rights-denied", () => {
    const { plugin } = setup();
    const rejection = plugin.validateRequest(
      build3dRequest({ rightsCapabilities: DENY_ALL, sourceFrameRefs: ["frame-9"] }),
    );
    expect(rejection).toMatchObject({ ok: false, failureClass: "rights-denied" });
    // …and the SAME refusal fires from render (defense in depth) below.
  });

  test("carried refs WITH rights is accepted (the capability is real)", () => {
    const { plugin } = setup();
    expect(
      plugin.validateRequest(
        build3dRequest({ rightsCapabilities: ALLOW_ALL, sourceFrameRefs: ["frame-9"] }),
      ),
    ).toEqual({ ok: true });
  });

  test("rejects an invalid style config with media-invalid", () => {
    const { plugin } = setup();
    const rejection = plugin.validateRequest(
      build3dRequest({
        styleConfig: { styleId: "s", configSchemaVersion: "1.0", config: { durationMs: 0 } },
      }),
    );
    expect(rejection).toMatchObject({ ok: false, failureClass: "media-invalid" });
  });

  test("validateRequest has no side effects: a rejected request still renders after admission", () => {
    const { plugin, req, input } = setup();
    const rejected = build3dRequest({ rendererId: "other.renderer" });
    expect(plugin.validateRequest(rejected).ok).toBe(false);
    const result = plugin.render(req, input);
    expect(result.outputSegments).toHaveLength(6);
  });
});

describe("render — the contract surface", () => {
  test("returns a schema-valid RenderResult (R8 + session identity)", () => {
    const { plugin, req, input } = setup();
    const result = plugin.render(req, input);
    const parsed = RenderResult.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.sessionId).toBe(req.sessionId);
    expect(result.rendererId).toBe(AVATAR_FIELD_RENDERER_ID);
  });

  test("renderDetailed returns the frames + manifest (the evaluation surface)", () => {
    const { plugin, req, input } = setup();
    const output = plugin.renderDetailed(req, input);
    expect(output.frames).toHaveLength(6);
    expect(output.manifest.frames).toHaveLength(6);
    expect(output.result.outputSegments).toHaveLength(6);
    // The contract result IS the detailed result's result.
    expect(plugin.render(req, input)).toEqual(output.result);
  });

  test("R4: dispose is terminal — post-dispose render throws internal", () => {
    const { plugin, req, input } = setup();
    plugin.dispose();
    expect(() => plugin.render(req, input)).toThrow(RendererContractError);
    expect(() => plugin.render(req, input)).toThrow(/disposed/);
    // The failure class is internal (R4).
    try {
      plugin.render(req, input);
      expect.unreachable();
    } catch (error) {
      expect((error as RendererContractError).failureClass).toBe("internal");
    }
  });

  test("dispose is idempotent", () => {
    const plugin = createAvatarFieldRenderer();
    plugin.dispose();
    expect(() => plugin.dispose()).not.toThrow();
  });

  test("init does NOT resurrect a disposed instance (R4 terminality)", () => {
    const { plugin, req, input } = setup();
    plugin.dispose();
    plugin.init();
    expect(() => plugin.render(req, input)).toThrow(/disposed/);
  });

  test("defense in depth: render re-runs every validateRequest gate", () => {
    const { plugin, input } = setup();
    // Rights refusal (validateRequest rejected the same request above).
    const denied = build3dRequest({ rightsCapabilities: DENY_ALL, sourceFrameRefs: ["frame-9"] });
    expect(() => plugin.render(denied, input)).toThrow(RendererContractError);
    try {
      plugin.render(denied, input);
      expect.unreachable();
    } catch (error) {
      expect((error as RendererContractError).failureClass).toBe("rights-denied");
    }
    // Identity refusal.
    expect(() => plugin.render(build3dRequest({ rendererId: "x" }), input)).toThrow(
      RendererContractError,
    );
  });

  test("malformed input fails loud with media-invalid (fail-loud, never garbage)", () => {
    const { plugin, req } = setup();
    const bad = { ...buildFixtureSnapshot(0), sessionId: 42 } as never;
    expect(() => plugin.render(req, { snapshot: bad, events: [] })).toThrow(RendererContractError);
    try {
      plugin.render(req, { snapshot: bad, events: [] });
      expect.unreachable();
    } catch (error) {
      expect((error as RendererContractError).failureClass).toBe("media-invalid");
    }
  });

  test("R7: degradation is explicit with a reason (never silent staleness)", () => {
    const plugin = createAvatarFieldRenderer();
    plugin.init();
    const req = build3dRequest({
      styleConfig: {
        styleId: "s",
        configSchemaVersion: "1.0",
        config: { simulateDegradation: true },
      },
    });
    const result = plugin.render(req, { snapshot: buildFixtureSnapshot(0), events: [] });
    expect(result.rendererHealth.degraded).toBe(true);
    expect(result.rendererHealth.degradationReason).toBe("simulated-degradation");
  });

  test("health() reports a static non-degraded snapshot independent of results", () => {
    const { plugin } = setup();
    expect(plugin.health()).toEqual({ lagMs: 0, degraded: false });
  });
});

describe("determinism — deep-equal rerun across instances", () => {
  test("two fresh plugins over the same request/input produce deep-equal results", () => {
    const { req, input } = setup();
    const first = createAvatarFieldRenderer();
    first.init();
    const second = createAvatarFieldRenderer();
    second.init();
    const a: RenderResultDoc = first.render(req, input);
    const b: RenderResultDoc = second.render(req, input);
    expect(a).toEqual(b);
  });

  test("renderDetailed reruns are byte-identical (SVG) and manifest deep-equal", () => {
    const { req, input } = setup();
    const pluginA = createAvatarFieldRenderer();
    const pluginB = createAvatarFieldRenderer();
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
    const plugin = createAvatarFieldRenderer();
    registry.register(plugin);
    const resolved = registry.resolve(AVATAR_FIELD_RENDERER_ID, AVATAR_FIELD_RENDERER_VERSION);
    expect(resolved).toBe(plugin);
    expect(registry.resolve(AVATAR_FIELD_RENDERER_ID)).toBe(plugin);
    expect(registry.list().map((capability) => capability.rendererId)).toEqual([
      AVATAR_FIELD_RENDERER_ID,
    ]);
  });

  test("the plugin renders through the registry end-to-end", () => {
    const registry = new RendererRegistry();
    registry.register(createAvatarFieldRenderer());
    const plugin = registry.resolve(AVATAR_FIELD_RENDERER_ID, AVATAR_FIELD_RENDERER_VERSION);
    const { req, input } = setup();
    // The registry surface types render as MaybePromise; the concrete
    // plugin is synchronous, so the value is the result itself.
    const result = plugin.render(req, input) as RenderResultDoc;
    expect(result.rendererId).toBe(AVATAR_FIELD_RENDERER_ID);
    expect(result.outputSegments).toHaveLength(6);
  });

  test("coexists with the W501 test-card renderer (replaceable plugins)", () => {
    const registry = new RendererRegistry();
    registry.register(createAvatarFieldRenderer());
    registry.register(createTestCardRenderer());
    expect(
      registry
        .list()
        .map((capability) => capability.rendererId)
        .sort(),
    ).toEqual(["avatar-field.prototype", "sporta.testcard"]);
  });

  test("duplicate registration of the same version is rejected (immutable versions)", () => {
    const registry = new RendererRegistry();
    registry.register(createAvatarFieldRenderer());
    expect(() => registry.register(createAvatarFieldRenderer())).toThrow(RendererContractError);
  });

  test("unknown id resolution fails loudly", () => {
    const registry = new RendererRegistry();
    expect(() => registry.resolve(AVATAR_FIELD_RENDERER_ID)).toThrow(RendererContractError);
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
    const plugin: AvatarFieldRenderer = createAvatarFieldRenderer();
    const ctx: RendererContext = {
      observability: { logger: seam.logger as never, metrics: seam.metrics as never },
    };
    plugin.init(ctx);
    const { req, input } = setup();
    plugin.render(req, input);
    expect(seam.lines).toHaveLength(1);
    expect(seam.lines[0]!.msg).toBe("avatar-field.render");
    expect(seam.lines[0]!.fields).toMatchObject({
      rendererId: AVATAR_FIELD_RENDERER_ID,
      rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
      snapshotVersion: 1,
      eventCount: 3,
      frameCount: 6,
    });
    expect(seam.counters).toEqual({ render_requests_total: 1 });
    // A refused render bumps the failure counter and never logs success.
    expect(() => plugin.render(build3dRequest({ rendererVersion: "9.9.9" }), input)).toThrow(
      RendererContractError,
    );
    expect(seam.counters).toEqual({ render_requests_total: 2, render_failures_total: 1 });
    expect(seam.lines).toHaveLength(1);
  });

  test("rendering without a seam is silent and correct (absent seam ⇒ no-op)", () => {
    const plugin = createAvatarFieldRenderer();
    plugin.init();
    const { req, input } = setup();
    const result = plugin.render(req, input);
    expect(result.outputSegments).toHaveLength(6);
  });
});
