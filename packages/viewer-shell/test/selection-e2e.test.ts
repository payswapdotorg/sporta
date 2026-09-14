/**
 * W703 renderer/style selection E2E — the REAL chain, headless end-to-end:
 * the viewer's renderer selection is capability-driven and validated against
 * the REAL control plane, REAL registry, and REAL renderer plugins.
 *
 * Two harnesses:
 *
 * - **A — `serveViewer`** (the real W705 composition: control server + the
 *   REAL anime plugin through the encoding wrapper + the real output
 *   pipeline as the playback store). Pinned:
 *   - the capability list over the real wire (`GET /v1/renderers`) returns
 *     the REAL anime capability document verbatim (deep-equal
 *     `animeCapability()` — W701's listing seam was already
 *     capability-shaped; W703 consumes it);
 *   - the golden selection walk: connect → session (full-allow) → open →
 *     `beginRender` → the selection view carries the DERIVED option
 *     (selectable, capability verbatim) → `createRender` with the plan's
 *     renderer-only payload → the render SUCCEEDS through the real registry
 *     + real anime plugin and composes with W705's playback path (ready,
 *     the SMIL segment player presenting the real stored segment);
 *   - the STYLE-CHOICE SEAM: a second render carrying a style choice
 *     (`styleId` + the plugin's real config surface) lands in the presented
 *     manifest VERBATIM (`renderer.styleId`, frame count/duration follow the
 *     config) — the seam carries a renderer + style choice honestly, with
 *     schema knowledge staying behind the plugin;
 *   - INVALID selections through the CORE fail closed with the server's
 *     real typed errors: an unknown renderer id and a capability-violating
 *     output profile both surface `media-invalid` with the server's
 *     VERBATIM messages;
 *   - determinism: the golden walk's view trace is deep-equal across two
 *     fresh servers + cores.
 *
 * - **B — a REAL multi-renderer registry** (the REAL anime plugin, the REAL
 *   reference testcard plugin, and ONE test fixture whose capability
 *   declares `requiresSourceFrames: true` — no real renderer declares that
 *   today; the fixture implements the REAL contract R2 gate so the
 *   rights-driven derivation is exercised end-to-end; the PRODUCT
 *   derivation stays purely data-driven). Pinned:
 *   - the capability list over the real wire returns all three real/fixture
 *     capabilities in registry order;
 *   - the core's derived selection against REAL capabilities + a
 *     no-transformation session (storage granted, no source-frame rights):
 *     the anime option SELECTABLE, the source-frames fixture BLOCKED
 *     (`rights-required`), the testcard option BLOCKED
 *     (`unsupported-output` — h264/mp4 is not presentable by this viewer);
 *   - the server fails closed for the R2 fixture over the real wire: the
 *     plugin's gate rejects the request (the control plane answers its
 *     real `media-invalid` refusal — the W701 `validateRequest` mapping),
 *     while the same fixture with a full-allow session RENDERS (200);
 *   - the grey-out is the viewer's AFFORDANCE, not a server denial: a
 *     direct `createRender` for the testcard over HTTP SUCCEEDS (rendering
 *     is compute — the server renders non-presentable output kinds fine);
 *   - the anime plugin's real R3 gate over the wire: an unsupported
 *     `outputProfile` answers `media-invalid` with the plugin's message.
 *
 * Constitution: no `Date.now`/`Math.random`/`new Date()` (the injected
 * `fakeClock` is the only time source; `setTimeout(0)` in `settleUntil` is a
 * macrotask yield for loopback HTTP resolution, not a wall-clock read).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createControlServer } from "@sporta/control-api";
import type { ControlServer } from "@sporta/control-api";
import {
  RendererContractError,
  RendererRegistry,
  createTestCardRenderer,
} from "@sporta/renderer-contract";
import type { RendererPlugin } from "@sporta/renderer-contract";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  animeCapability,
  createAnimePrototypeRenderer,
} from "@sporta/renderer-anime";
import type {
  AuthorizationPolicy,
  OutputProfile,
  RenderRequest,
  RenderResult,
  RendererCapability,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";
import { createHttpControlClient } from "../src/http-client.ts";
import { createHttpPlaybackProvider } from "../src/playback-provider.ts";
import { selectionRequestOf } from "../src/selection-plan.ts";
import { createViewerCore } from "../src/viewer-core.ts";
import type { ViewerCore, ViewerViewModel } from "../src/viewer-core.ts";
import { serveViewer } from "../src/serve.ts";
import type { ViewerServer } from "../src/serve.ts";
import { fakeClock, fullAllowPolicy, scriptOutput } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Yields the event loop until the view-model satisfies `predicate` (bounded
 * by `maxYields` macrotask turns — loopback HTTP resolves within a few).
 */
async function settleUntil(
  core: ViewerCore,
  predicate: (view: ViewerViewModel) => boolean,
  maxYields = 200,
): Promise<ViewerViewModel> {
  for (let i = 0; i < maxYields; i += 1) {
    const view = core.view();
    if (predicate(view)) return view;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return core.view();
}

/** A no-transformation policy: storage granted, NO source-frame rights. */
const noTransformationPolicy: AuthorizationPolicy = {
  policyId: "policy-no-transformation",
  allowedOperations: ["analysis", "derivativeGeneration", "storage"],
  assertedBy: "sporta-test-operator",
  expiresAtIso: "2099-12-31T23:59:59.000Z",
};

/** Performs one JSON call and returns { status, body }. */
async function callJson<T>(baseUrl: string, path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

/** JSON POST helper. */
function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  };
}

/** Creates a session over HTTP and returns its id. */
async function createSession(baseUrl: string, policy: AuthorizationPolicy): Promise<string> {
  const response = await callJson<{ session: { sessionId: string } }>(
    baseUrl,
    "/v1/sessions",
    postJson({
      authorizationPolicy: policy,
    }),
  );
  if (response.status !== 200) {
    throw new Error(`createSession failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.session.sessionId;
}

// ---------------------------------------------------------------------------
// Harness B fixture: a REAL-contract plugin whose capability declares
// requiresSourceFrames: true (no real renderer does today). Implements the
// R2 gate faithfully (reject in BOTH validateRequest and render) plus the R3
// identity/profile gates; the render result is a minimal valid RenderResult.
// ---------------------------------------------------------------------------

const FIXTURE_RENDERER_ID = "fixture.requires-frames";
const FIXTURE_RENDERER_VERSION = "0.1.0";
const FIXTURE_PROFILE: OutputProfile = {
  resolution: { w: 640, h: 360 },
  frameRate: 25,
  codec: "h264",
  container: "mp4",
  latencyClass: "offline",
};
const FIXTURE_CAPABILITY: RendererCapability = {
  rendererId: FIXTURE_RENDERER_ID,
  rendererVersion: FIXTURE_RENDERER_VERSION,
  rendererClass: "stylized-video",
  supportedOutputProfiles: [FIXTURE_PROFILE],
  requiresSourceFrames: true,
  minSnapshotVersion: 0,
};
const FIXTURE_R2_REASON =
  "fixture renderer requires source frames but rightsCapabilities.canReferenceSourceFrames is false";

function fixtureRejects(req: RenderRequest): string | null {
  // R3 identity gate.
  if (req.rendererId !== FIXTURE_RENDERER_ID || req.rendererVersion !== FIXTURE_RENDERER_VERSION) {
    return `request targets renderer ${req.rendererId}@${req.rendererVersion}, but this plugin is ${FIXTURE_RENDERER_ID}@${FIXTURE_RENDERER_VERSION}`;
  }
  // R3 profile gate.
  if (JSON.stringify(req.outputProfile) !== JSON.stringify(FIXTURE_PROFILE)) {
    return "outputProfile is not one of the supported output profiles";
  }
  // R2 fail-closed source-frame rights gate (the real contract rule).
  if (FIXTURE_CAPABILITY.requiresSourceFrames && !req.rightsCapabilities.canReferenceSourceFrames) {
    return FIXTURE_R2_REASON;
  }
  return null;
}

/** The test fixture plugin (see the harness B docs — a REAL-contract R2 probe). */
function createRequiresFramesFixture(): RendererPlugin {
  const reject = (reason: string, req: RenderRequest): RendererContractError =>
    new RendererContractError(`render refused: ${reason}`, "media-invalid", {
      rendererId: FIXTURE_RENDERER_ID,
      rendererVersion: FIXTURE_RENDERER_VERSION,
      sessionId: req.sessionId,
      reason,
    });
  return {
    pluginKind: "sporta-renderer",
    capability: () => structuredClone(FIXTURE_CAPABILITY),
    init: () => {},
    validateRequest: (req) => {
      const reason = fixtureRejects(req);
      if (reason !== null) {
        // The R2 leg answers rights-denied per the contract; the R3 legs
        // answer media-invalid (the control plane's validateRequest mapping
        // classifies both as its real media-invalid refusal — pinned below).
        return {
          ok: false,
          reason,
          failureClass: reason === FIXTURE_R2_REASON ? "rights-denied" : "media-invalid",
        };
      }
      return { ok: true };
    },
    render: (req, input) => {
      const reason = fixtureRejects(req);
      if (reason !== null) {
        throw reject(reason, req);
      }
      const snapshot: WorldSnapshot = input.snapshot;
      const events: WorldEventStreamEntry[] = input.events;
      const result: RenderResult = {
        sessionId: req.sessionId,
        rendererId: req.rendererId,
        outputSegments: [
          {
            segmentId: "ff-0",
            startMs: snapshot.watermark.watermarkMs,
            endMs: snapshot.watermark.watermarkMs + 1_000,
            artifactRef: `fixture://${req.sessionId}/${req.snapshotVersion}/0`,
          },
        ],
        watermarkAfter: {
          watermarkMs: snapshot.watermark.watermarkMs + 1_000,
          sequence:
            events.length > 0 ? events[events.length - 1]!.sequence : snapshot.watermark.sequence,
        },
        rendererHealth: { lagMs: 0, degraded: false },
        provenance: {
          snapshotVersion: req.snapshotVersion,
          lastEventSequence: events.length > 0 ? events[events.length - 1]!.sequence : 0,
        },
      };
      return result;
    },
    health: () => ({ lagMs: 0, degraded: false }),
    dispose: () => {},
  };
}

// ---------------------------------------------------------------------------
// Harness A: serveViewer (the real W705 composition)
// ---------------------------------------------------------------------------

let server: ViewerServer;

beforeAll(() => {
  server = serveViewer({ port: 0 });
});

afterAll(() => {
  server.stop();
});

/** The browser composition: http client + REAL playback provider, same-origin. */
function makeCore(viewerServer: ViewerServer) {
  const client = createHttpControlClient({ baseUrl: `${viewerServer.url}/control` });
  const output = createHttpPlaybackProvider({ baseUrl: `${viewerServer.url}/control` });
  const core = createViewerCore({ client, output, nowMs: () => fakeClock().now() });
  return { core, client, output };
}

describe("W703 selection e2e (harness A) — the capability data path over the real wire", () => {
  test("GET /v1/renderers returns the REAL anime capability document verbatim", async () => {
    const response = await callJson<{ renderers: RendererCapability[] }>(
      server.control!.url,
      "/v1/renderers",
    );
    expect(response.status).toBe(200);
    expect(response.body.renderers).toHaveLength(1);
    // Deep-equal against the plugin's own capability() — the listing seam
    // (W701) answers the full capability document, not just ids.
    expect(response.body.renderers[0]).toEqual(animeCapability());
  });

  test("golden selection walk: derived option → plan payload → real render → W705 playback", async () => {
    const { core } = makeCore(server);

    core.dispatch({ type: "connect" });
    let view = await settleUntil(core, (v) => v.status === "browsing-sessions");
    expect(view.connection).toBe("connected");

    core.dispatch({ type: "createSession", policy: fullAllowPolicy, sourceLabel: "selection-e2e" });
    view = await settleUntil(core, (v) => v.sessions.length === 1);
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    view = await settleUntil(core, (v) => v.status === "session-detail");
    expect(view.session?.rights.canReferenceSourceFrames).toBe(true);

    core.dispatch({ type: "beginRender" });
    view = await settleUntil(core, (v) => v.status === "renderer-selection");
    // The DERIVED option over the REAL capability: selectable, verbatim.
    const options = view.rendererSelection?.renderers ?? [];
    expect(options).toHaveLength(1);
    expect(options[0]?.capability).toEqual(animeCapability());
    expect(options[0]?.selectable).toBe(true);
    expect(options[0]?.blockedReason).toBeNull();

    // The plan's renderer-only payload drives the REAL render.
    const option = options[0];
    if (option === undefined) throw new Error("expected one selection option");
    const request = selectionRequestOf(option);
    core.dispatch({
      type: "createRender",
      rendererId: request.rendererId,
      rendererVersion: request.rendererVersion,
    });
    view = await settleUntil(core, (v) => v.status === "ready" || v.status === "error");
    expect(view.status).toBe("ready");
    expect(view.session?.renders.map((render) => render.renderId)).toEqual(["r-1"]);
    // Composes with W705's real playback path: the SMIL segment player.
    if (view.playback?.kind !== "segment") {
      throw new Error(`expected the animated-segment path, got ${String(view.playback?.kind)}`);
    }
    expect(view.playback.renderer).toEqual({
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: "0.1.0",
      styleId: "default", // the control plane's documented default
    });
    expect(view.playback.frameCount).toBe(6);
    expect(view.playback.durationMs).toBe(6_000);
  });

  test("the STYLE-CHOICE SEAM: a style selection lands in the presented manifest VERBATIM", async () => {
    const { core } = makeCore(server);

    core.dispatch({ type: "connect" });
    await settleUntil(core, (v) => v.status === "browsing-sessions");
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settleUntil(core, (v) => v.status === "session-detail");
    core.dispatch({ type: "beginRender" });
    await settleUntil(core, (v) => v.status === "renderer-selection");

    // A renderer + style choice (the plugin's real style surface: the
    // free-form styleId + its documented config). The viewer holds no
    // schema knowledge — the choice is carried verbatim and the REAL plugin
    // honors it (styleId verbatim in the manifest; durationMs honored).
    core.dispatch({
      type: "createRender",
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: "0.1.0",
      styleId: "selection-e2e-style",
      config: { durationMs: 3_000 },
    });
    const view = await settleUntil(core, (v) => v.status === "ready" || v.status === "error");
    expect(view.status).toBe("ready");
    expect(view.session?.renders.map((render) => render.renderId)).toEqual(["r-1", "r-2"]);
    if (view.playback?.kind !== "segment") {
      throw new Error("expected the animated-segment path");
    }
    expect(view.playback.renderer.styleId).toBe("selection-e2e-style");
    // The real config surface honored: 3000 ms @ 1 fps → 3 frames.
    expect(view.playback.frameCount).toBe(3);
    expect(view.playback.durationMs).toBe(3_000);
  });

  test("INVALID selection (unknown renderer) → the server's real media-invalid error, VERBATIM", async () => {
    const { core } = makeCore(server);
    core.dispatch({ type: "connect" });
    await settleUntil(core, (v) => v.status === "browsing-sessions");
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settleUntil(core, (v) => v.status === "session-detail");
    core.dispatch({ type: "beginRender" });
    await settleUntil(core, (v) => v.status === "renderer-selection");
    // A stale/unknown selection (e.g. the registry changed after listing).
    core.dispatch({ type: "createRender", rendererId: "no.such.renderer" });
    const view = await settleUntil(core, (v) => v.status === "error");
    expect(view.error?.failureClass).toBe("media-invalid");
    expect(view.error?.message).toBe('no renderer registered for rendererId "no.such.renderer"');
    expect(view.error?.operation).toBe("createRender");
    expect(view.error?.retryable).toBe(false);
    // Fail-closed: no render listed, no player, selection consumed.
    expect(view.session?.renders.map((render) => render.renderId)).toEqual(["r-1", "r-2"]);
    expect(view.playback).toBeNull();
    expect(view.rendererSelection).toBeNull();
  });

  test("INVALID selection (capability-violating outputProfile) → the plugin's real R3 error, VERBATIM", async () => {
    const { core } = makeCore(server);
    core.dispatch({ type: "connect" });
    await settleUntil(core, (v) => v.status === "browsing-sessions");
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settleUntil(core, (v) => v.status === "session-detail");
    core.dispatch({ type: "beginRender" });
    await settleUntil(core, (v) => v.status === "renderer-selection");
    const violatingProfile: OutputProfile = {
      resolution: { w: 640, h: 360 },
      frameRate: 24,
      codec: "h264",
      container: "mp4",
      latencyClass: "offline",
    };
    core.dispatch({
      type: "createRender",
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: "0.1.0",
      outputProfile: violatingProfile,
    });
    const view = await settleUntil(core, (v) => v.status === "error");
    expect(view.error?.failureClass).toBe("media-invalid");
    expect(view.error?.message).toBe(
      "renderer rejected the request: outputProfile is not one of the supported output profiles",
    );
    expect(view.error?.operation).toBe("createRender");
    expect(view.playback).toBeNull();
  });

  test("determinism: the golden selection walk is deep-equal across fresh servers + cores", async () => {
    async function walk(): Promise<string[]> {
      const freshServer = serveViewer({ port: 0 });
      try {
        const { core } = makeCore(freshServer);
        const trace: string[] = [];
        core.subscribe((view: ViewerViewModel) => trace.push(JSON.stringify(view)));
        core.dispatch({ type: "connect" });
        await settleUntil(core, (v) => v.status === "browsing-sessions");
        core.dispatch({ type: "createSession", policy: fullAllowPolicy, sourceLabel: "det" });
        await settleUntil(core, (v) => v.sessions.length === 1);
        core.dispatch({ type: "openSession", sessionId: "sess-1" });
        await settleUntil(core, (v) => v.status === "session-detail");
        core.dispatch({ type: "beginRender" });
        await settleUntil(core, (v) => v.status === "renderer-selection");
        core.dispatch({
          type: "createRender",
          rendererId: ANIME_RENDERER_ID,
          rendererVersion: "0.1.0",
        });
        await settleUntil(core, (v) => v.status === "ready");
        return trace;
      } finally {
        freshServer.stop();
      }
    }
    expect(await walk()).toEqual(await walk());
  });
});

// ---------------------------------------------------------------------------
// Harness B: a REAL multi-renderer registry (real anime + real testcard +
// the requires-frames fixture)
// ---------------------------------------------------------------------------

let registryServer: ControlServer;
let registryBaseUrl: string;

beforeAll(() => {
  const registry = new RendererRegistry();
  registry.register(createAnimePrototypeRenderer());
  registry.register(createTestCardRenderer());
  registry.register(createRequiresFramesFixture());
  registryServer = createControlServer({ port: 0, rendererRegistry: registry });
  registryBaseUrl = `http://127.0.0.1:${registryServer.port}`;
});

afterAll(() => {
  registryServer.stop(true);
});

/** A core over harness B with an output port that fails loud if called. */
function makeRegistryCore() {
  const client = createHttpControlClient({ baseUrl: registryBaseUrl });
  const core = createViewerCore({
    client,
    output: scriptOutput({ loadOutput: [] }),
    nowMs: () => fakeClock().now(),
  });
  return { core, client };
}

describe("W703 selection e2e (harness B) — capability-gated selection over a real multi-renderer registry", () => {
  test("GET /v1/renderers lists all three capabilities in registry order", async () => {
    const response = await callJson<{ renderers: RendererCapability[] }>(
      registryBaseUrl,
      "/v1/renderers",
    );
    expect(response.status).toBe(200);
    expect(response.body.renderers.map((capability) => capability.rendererId)).toEqual([
      ANIME_RENDERER_ID,
      FIXTURE_RENDERER_ID,
      "sporta.testcard",
    ]);
    // The two REAL capability documents, verbatim.
    expect(response.body.renderers[0]).toEqual(animeCapability());
    expect(response.body.renderers[2]).toEqual(createTestCardRenderer().capability());
    // The fixture declaration (requiresSourceFrames: true).
    expect(response.body.renderers[1]?.requiresSourceFrames).toBe(true);
  });

  test("derived options against REAL capabilities + a no-frame-rights session: selectable / rights-required / unsupported-output", async () => {
    const { core } = makeRegistryCore();
    core.dispatch({ type: "connect" });
    await settleUntil(core, (v) => v.status === "browsing-sessions");
    core.dispatch({
      type: "createSession",
      policy: noTransformationPolicy,
      sourceLabel: "no-frames",
    });
    await settleUntil(core, (v) => v.sessions.length === 1);
    // sess-1 in THIS server: no-transformation rights.
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    const view = await settleUntil(core, (v) => v.status === "session-detail");
    expect(view.session?.rights.canReferenceSourceFrames).toBe(false);
    expect(view.session?.rights.canStoreDerivatives).toBe(true);

    core.dispatch({ type: "beginRender" });
    await settleUntil(core, (v) => v.status === "renderer-selection");
    const options = core.view().rendererSelection?.renderers ?? [];
    expect(options.map((option) => option.capability.rendererId)).toEqual([
      ANIME_RENDERER_ID,
      FIXTURE_RENDERER_ID,
      "sporta.testcard",
    ]);
    // The REAL anime capability needs no source frames → selectable even
    // without frame rights (rendering is compute).
    expect(options[0]?.selectable).toBe(true);
    // The fixture declares requiresSourceFrames → blocked rights-required.
    expect(options[1]?.selectable).toBe(false);
    expect(options[1]?.blockedReason).toBe("rights-required");
    // The REAL testcard capability declares h264/mp4 → blocked
    // unsupported-output (this viewer presents animated-SVG only).
    expect(options[2]?.selectable).toBe(false);
    expect(options[2]?.blockedReason).toBe("unsupported-output");
    expect(options[2]?.blockedNote).toContain("h264/mp4");
  });

  test("the server fails closed for the R2 fixture: real refusal over the wire, render with full rights", async () => {
    // No-frame-rights session (sess-1 exists): the plugin's R2 gate rejects.
    const denied = await callJson<{ error: { failureClass: string; message: string } }>(
      registryBaseUrl,
      "/v1/sessions/sess-1/renders",
      postJson({ rendererId: FIXTURE_RENDERER_ID, rendererVersion: FIXTURE_RENDERER_VERSION }),
    );
    expect(denied.status).toBe(400);
    // The control plane's REAL answer for a validateRequest rejection (the
    // W701 mapping classifies plugin refusals as media-invalid; the plugin's
    // own failureClass stays behind the app seam — honest, pinned verbatim).
    expect(denied.body.error.failureClass).toBe("media-invalid");
    expect(denied.body.error.message).toBe(`renderer rejected the request: ${FIXTURE_R2_REASON}`);

    // The same fixture over a full-allow session renders (R2 passes).
    const sessionId = await createSession(registryBaseUrl, fullAllowPolicy);
    const allowed = await callJson<{ renderId: string; result: RenderResult }>(
      registryBaseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: FIXTURE_RENDERER_ID, rendererVersion: FIXTURE_RENDERER_VERSION }),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body.result.outputSegments).toHaveLength(1);
    expect(allowed.body.result.rendererId).toBe(FIXTURE_RENDERER_ID);
  });

  test("the grey-out is the viewer's AFFORDANCE, not a server denial: the testcard renders over HTTP", async () => {
    const sessionId = await createSession(registryBaseUrl, fullAllowPolicy);
    const response = await callJson<{ renderId: string; result: RenderResult }>(
      registryBaseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard" }),
    );
    expect(response.status).toBe(200);
    // Real testcard math: 10s / 2s segments → 5 segments.
    expect(response.body.result.outputSegments).toHaveLength(5);
    expect(response.body.result.outputSegments[0]?.segmentId).toBe("tc-0");
  });

  test("the REAL anime R3 gate over the wire: an unsupported outputProfile answers media-invalid", async () => {
    const sessionId = await createSession(registryBaseUrl, fullAllowPolicy);
    const response = await callJson<{ error: { failureClass: string; message: string } }>(
      registryBaseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({
        rendererId: ANIME_RENDERER_ID,
        rendererVersion: "0.1.0",
        outputProfile: {
          resolution: { w: 640, h: 360 },
          frameRate: 24,
          codec: "h264",
          container: "mp4",
          latencyClass: "offline",
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("media-invalid");
    expect(response.body.error.message).toBe(
      "renderer rejected the request: outputProfile is not one of the supported output profiles",
    );
  });

  test("the real anime profile IS the declared one: a capability-satisfying render at the SVG profile succeeds", async () => {
    const sessionId = await createSession(registryBaseUrl, fullAllowPolicy);
    const response = await callJson<{ renderId: string; result: RenderResult }>(
      registryBaseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({
        rendererId: ANIME_RENDERER_ID,
        rendererVersion: "0.1.0",
        outputProfile: ANIME_OUTPUT_PROFILE, // exactly the declared profile
      }),
    );
    expect(response.status).toBe(200);
    expect(response.body.result.rendererId).toBe(ANIME_RENDERER_ID);
    // The real single-snapshot anime math: 6000 ms @ 1 fps → 6 segments.
    expect(response.body.result.outputSegments).toHaveLength(6);
  });
});
