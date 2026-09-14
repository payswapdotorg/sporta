/**
 * W705 playback E2E — the REAL chain, headless end-to-end: the viewer plays
 * REAL stored W504 artifacts through the REAL control-plane playback routes.
 *
 * The golden harness is `serveViewer` — the composition the browser
 * bootstrap consumes: a REAL control server with the REAL output pipeline
 * wired as its `renderOutputStore` (the playback routes serve from it) and
 * the REAL anime plugin registered through the W705 encoding wrapper (every
 * successful render is encoded + stored HOST-side during the render call —
 * the dev-host posture). The viewer core talks through the SAME-ORIGIN
 * `/control` proxy with the HTTP control client + the REAL playback
 * provider — the exact module graph `web/bootstrap.ts` wires.
 *
 * Pinned:
 *
 * - the golden walk: connect → session → render (the real anime plugin via
 *   the registry) → READY with the SMIL segment player presenting the REAL
 *   encoded document (frame count/duration from the W502 single-snapshot
 *   path, sha-256 + byte length re-verified over the SERVED bytes, the
 *   encoder's frame-group/SMIL shape, declared-timeline playback math, the
 *   smil sync instructions, the ONE-document presentation, ended/replay);
 * - the outputs list over the real wire agrees with the presented view;
 * - the processing states over the REAL surface (a DECOUPLED host — the
 *   plain plugin, the pipeline as the playback store, NO encoding wrapper —
 *   the production posture): the render exists but `outputs-pending` (a
 *   RESTING state: never an error, never a fake player), then the host
 *   encode→store step runs (the W504 e2e host-equivalence approach: the
 *   local `renderAnimeFromSnapshot` output deep-equals the HTTP `getRender`
 *   `RenderResult` — PROOF the stored segment is the same render), then
 *   "check again" (`selectRender`) lands in `ready`;
 * - error paths over the real wire, VERBATIM: rights-denied 403 on BOTH
 *   playback routes (and deny BEFORE existence is revealed — an unknown
 *   render id still answers 403, never 404), unknown-render 404 (the
 *   core's getRender gate — the product path that surfaces it; the LIST
 *   route itself is a pure store projection, pinned as such),
 *   unknown-segment 404 (the segment route), and the no-storage-rights
 *   policy through the CORE (the W701 playback gate denies at session
 *   open: typed error, no partial view);
 * - determinism: the golden walk's view trace is deep-equal across two
 *   fresh servers + cores.
 *
 * Constitution: no `Date.now`/`Math.random`; the only `new Date(...)` uses
 * an explicit injected constant (`TEST_EPOCH_MS` — the harness convention);
 * `setTimeout(0)` in `settleUntil` is a macrotask yield (loopback HTTP
 * resolution), not a wall-clock read.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createControlServer } from "@sporta/control-api";
import type { ControlServer } from "@sporta/control-api";
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
import type { RenderRequest, WorldSnapshot } from "@sporta/contracts";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { byteLengthOf, contentHashOf, createAnimeOutputPipeline } from "@sporta/output-pipeline";
import type { AnimeOutputPipeline } from "@sporta/output-pipeline";
import { createHttpControlClient } from "../src/http-client.ts";
import type { ControlClient } from "../src/ports.ts";
import { createHttpPlaybackProvider } from "../src/playback-provider.ts";
import type { HttpPlaybackProvider } from "../src/playback-provider.ts";
import { createViewerCore } from "../src/viewer-core.ts";
import type { ViewerCore, ViewerViewModel } from "../src/viewer-core.ts";
import { isViewerControlError } from "../src/errors.ts";
import { serveViewer } from "../src/serve.ts";
import type { ViewerServer } from "../src/serve.ts";
import { analysisTransformationPolicy, fakeClock, fullAllowPolicy } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Shared harness: serveViewer's REAL chain (golden + error paths)
// ---------------------------------------------------------------------------

let server: ViewerServer;

beforeAll(() => {
  server = serveViewer({ port: 0 });
});

afterAll(() => {
  server.stop();
});

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

/** The browser composition: client + REAL playback provider, both same-origin. */
function makeCore(clock: ReturnType<typeof fakeClock>) {
  const client = createHttpControlClient({ baseUrl: `${server.url}/control` });
  const output = createHttpPlaybackProvider({ baseUrl: `${server.url}/control` });
  const core = createViewerCore({ client, output, nowMs: () => clock.now() });
  return { core, clock, client, output };
}

// ---------------------------------------------------------------------------
// The golden walk — the real W504 playback chain, presented by the viewer
// ---------------------------------------------------------------------------

describe("W705 playback e2e — golden walk: session → render → stored segment → presented", () => {
  test("connect → create session → render → ready (the SMIL segment player over the real routes)", async () => {
    const { core } = makeCore(fakeClock());

    expect(core.view().status).toBe("disconnected");
    core.dispatch({ type: "connect" });
    let view = await settleUntil(core, (v) => v.status === "browsing-sessions");
    expect(view.connection).toBe("connected");

    core.dispatch({ type: "createSession", policy: fullAllowPolicy, sourceLabel: "playback-e2e" });
    view = await settleUntil(core, (v) => v.sessions.length === 1);
    expect(view.sessions[0]).toMatchObject({ id: "sess-1", sourceLabel: "playback-e2e" });

    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    view = await settleUntil(core, (v) => v.status === "session-detail");
    expect(view.session?.rights.canStoreDerivatives).toBe(true);

    core.dispatch({ type: "beginRender" });
    view = await settleUntil(core, (v) => v.status === "renderer-selection");
    expect(view.rendererSelection?.renderers.map((r) => r.rendererId)).toEqual(["anime.prototype"]);

    // createRender drives the REAL plugin through the registry; the W705
    // encoding wrapper encodes + stores the segment HOST-side during the
    // render call, so the playback routes answer immediately.
    core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
    view = await settleUntil(core, (v) => v.status === "ready" || v.status === "error");
    expect(view.status).toBe("ready");
    expect(view.session?.renders.map((r) => r.renderId)).toEqual(["r-1"]);

    // The REAL W504 path mounted the SEGMENT player (the union view).
    expect(view.playback).not.toBeNull();
    if (view.playback?.kind !== "segment") {
      throw new Error(`expected the animated-segment path, got ${String(view.playback?.kind)}`);
    }
    const playback = view.playback;
    // The single-snapshot render path: 6000 ms @ 1 fps → 6 frames.
    expect(playback.frameCount).toBe(6);
    expect(playback.durationMs).toBe(6_000);
    expect(playback.segmentId).toMatch(/^anime-clip-[0-9a-f]{8}$/);
    expect(playback.contentType).toBe("image/svg+xml");
    expect(playback.renderer).toEqual({
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: ANIME_RENDERER_VERSION,
      styleId: "default",
    });
    expect(playback.output.frameIntervalMs).toBe(1_000);
    expect(playback.buffering).toBe(false); // the document is complete at load
    // The load re-locked the document clock: ready, paused, at 0.
    expect(playback.smil).toEqual({ paused: true, seekMs: 0 });
    // The document IS the encoder's output shape: ONE svg root, six frame
    // groups, six SMIL <set> toggles, the last one freezing the final frame.
    expect(playback.document.startsWith("<svg")).toBe(true);
    expect(playback.document.endsWith("</svg>")).toBe(true);
    expect(playback.document.match(/data-frame-index="/g)).toHaveLength(6);
    expect(playback.document.match(/<set attributeName="display"/g)).toHaveLength(6);
    expect(playback.document.match(/fill="freeze"/g)).toHaveLength(1);
    // Independent integrity re-verification over the SERVED bytes (the
    // provider already checked; this pins it against the pipeline's own
    // canonical hasher at the e2e level).
    expect(contentHashOf(playback.document)).toBe(playback.contentHash);
    expect(byteLengthOf(playback.document)).toBe(playback.byteLength);
  });

  test("the outputs list over the real wire agrees with the presented view (one segment)", async () => {
    const provider = createHttpPlaybackProvider({ baseUrl: `${server.url}/control` });
    const segments = await provider.listSegments("sess-1", "r-1");
    expect(segments).toHaveLength(1);
    const summary = segments[0]!;
    expect(summary.segmentId).toMatch(/^anime-clip-[0-9a-f]{8}$/);
    expect(summary.contentType).toBe("image/svg+xml");
    // The viewer's own core presented exactly this segment (the golden-walk
    // pins): the summary's integrity fields are the served document's.
    const fetched = await provider.fetchSegment("sess-1", "r-1", summary.segmentId);
    expect(contentHashOf(fetched.content)).toBe(summary.contentHash);
    expect(byteLengthOf(fetched.content)).toBe(summary.byteLength);
    // The manifest agrees with the document it describes.
    expect(fetched.manifest.segmentId).toBe(summary.segmentId);
    expect(fetched.manifest.frameCount).toBe(6);
    expect(fetched.manifest.totalDurationMs).toBe(6_000);
  });

  test("playback drives the declared timeline: play → tick → pause → end → replay", async () => {
    const { core, clock } = makeCore(fakeClock());
    core.dispatch({ type: "connect" });
    await settleUntil(core, (v) => v.status === "browsing-sessions");
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settleUntil(core, (v) => v.status === "session-detail");
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    const view = await settleUntil(core, (v) => v.status === "ready");
    expect(view.playback?.kind).toBe("segment");
    const documentAtLoad = view.playback?.kind === "segment" ? view.playback.document : "";

    core.dispatch({ type: "play" });
    expect(core.view().status).toBe("playing");
    clock.advance(3_500);
    core.dispatch({ type: "tick" });
    let current = core.view();
    expect(current.status).toBe("playing");
    if (current.playback?.kind !== "segment") throw new Error("expected the segment path");
    expect(current.playback.positionMs).toBe(3_500);
    expect(current.playback.frameIndex).toBe(3);
    // Natural tick advancement NEVER re-seeks the document clock.
    expect(current.playback.smil).toEqual({ paused: false, seekMs: null });
    // ONE self-animating document — never swapped per frame.
    expect(current.playback.document).toBe(documentAtLoad);

    core.dispatch({ type: "pause" });
    expect(core.view().status).toBe("paused");
    current = core.view();
    if (current.playback?.kind !== "segment") throw new Error("expected the segment path");
    // Pause re-locks the document clock to the model's playhead.
    expect(current.playback.smil).toEqual({ paused: true, seekMs: 3_500 });

    core.dispatch({ type: "play" });
    clock.advance(2_500);
    core.dispatch({ type: "tick" });
    current = core.view();
    expect(current.status).toBe("ended"); // 6000 >= 6000, exact
    if (current.playback?.kind !== "segment") throw new Error("expected the segment path");
    expect(current.playback.positionMs).toBe(6_000);
    expect(current.playback.frameIndex).toBe(5);
    // The ending tick pauses the document (frozen last frame) without a seek.
    expect(current.playback.smil).toEqual({ paused: true, seekMs: null });
    expect(current.playback.document).toBe(documentAtLoad);

    core.dispatch({ type: "replay" });
    current = core.view();
    expect(current.status).toBe("playing");
    if (current.playback?.kind !== "segment") throw new Error("expected the segment path");
    // Replay re-locks the document clock to 0 and resumes.
    expect(current.playback.positionMs).toBe(0);
    expect(current.playback.smil).toEqual({ paused: false, seekMs: 0 });

    core.dispatch({ type: "closePlayback" });
    expect(core.view().status).toBe("session-detail");
    expect(core.view().playback).toBeNull();

    // Live output stays honestly unavailable through the whole walk.
    expect(core.view().live.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error paths over the real wire — classes VERBATIM (the W705 contract)
// ---------------------------------------------------------------------------

describe("W705 playback e2e — error paths over the real wire (verbatim classes)", () => {
  let client: ControlClient;
  let provider: HttpPlaybackProvider;
  let deniedSessionId: string;
  let deniedRenderId: string;

  beforeAll(async () => {
    client = createHttpControlClient({ baseUrl: `${server.url}/control` });
    provider = createHttpPlaybackProvider({ baseUrl: `${server.url}/control` });
    // A no-storage-rights session: analysis+transformation RENDERS fine, but
    // every playback route must deny fail-closed.
    const session = await client.createSession({
      authorizationPolicy: analysisTransformationPolicy,
      sourceLabel: "playback-e2e-denied",
    });
    deniedSessionId = session.session.sessionId;
    const envelope = await client.createRender(deniedSessionId, { rendererId: "anime.prototype" });
    deniedRenderId = envelope.renderId;
  });

  test("rights-denied (403) VERBATIM on BOTH playback routes — never a retryable server error", async () => {
    const listErr = await provider.loadOutput(deniedSessionId, deniedRenderId).catch((e) => e);
    expect(isViewerControlError(listErr)).toBe(true);
    if (isViewerControlError(listErr)) {
      expect(listErr.failureClass).toBe("rights-denied");
      expect(listErr.details.httpStatus).toBe(403);
      expect(listErr.message).toContain("canStoreDerivatives");
      expect(listErr.details.wireFailureClass).toBeUndefined(); // verbatim, not reclassified
    }

    const segmentErr = await provider
      .fetchSegment(deniedSessionId, deniedRenderId, "anime-clip-00000000")
      .catch((e) => e);
    expect(isViewerControlError(segmentErr)).toBe(true);
    if (isViewerControlError(segmentErr)) {
      expect(segmentErr.failureClass).toBe("rights-denied");
      expect(segmentErr.details.httpStatus).toBe(403);
    }
  });

  test("deny BEFORE existence revealed: an unknown render under a denied policy is still 403 rights-denied", async () => {
    const err = await provider.loadOutput(deniedSessionId, "r-999999").catch((e) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      // NOT unknown-render (404): the rights gate fires first, so the
      // control plane never reveals which renders exist.
      expect(err.failureClass).toBe("rights-denied");
      expect(err.details.httpStatus).toBe(403);
    }
  });

  test("unknown-render (404) through the CORE: the getRender gate classifies it, typed, no partial data", async () => {
    const local = makeCore(fakeClock());
    local.core.dispatch({ type: "connect" });
    await settleUntil(local.core, (v) => v.status === "browsing-sessions");
    local.core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settleUntil(local.core, (v) => v.status === "session-detail");
    // The W705 composition guarantees render existence BEFORE the provider
    // runs: the core's loadRenderOutput calls getRender first (the W701
    // playback gate), which classifies the unknown render 404 on the wire.
    local.core.dispatch({ type: "selectRender", renderId: "r-999999" });
    const view = await settleUntil(local.core, (v) => v.status === "error");
    expect(view.error).toEqual({
      failureClass: "unknown-render",
      label: "Unknown render",
      message: expect.any(String),
      retryable: false,
      operation: "selectRender",
      details: expect.objectContaining({ httpStatus: 404, renderId: "r-999999" }),
    });
    // Fail-closed: no player mounted, the session view stays intact.
    expect(view.playback).toBeNull();
    expect(view.session?.sessionId).toBe("sess-1");
    // Dismiss returns to the session detail (the stable status).
    local.core.dispatch({ type: "dismissError" });
    expect(local.core.view().status).toBe("session-detail");
  });

  test("provider-level honest seam pin: the W504 LIST route is a pure store projection (unknown render → outputs-pending, NOT 404)", async () => {
    // HONEST SEAM DOCUMENTATION (pinned so it can never drift silently):
    // the merged W504 list route answers `200 { segments: [] }` for ANY
    // (session, renderId) scope with nothing stored — it does not classify
    // unknown renders (unlike the W701 getRender/listRenders routes, and
    // unlike the SEGMENT route, which 404s unknown-segment). The provider
    // therefore reports the honest "nothing stored under this scope" as
    // `outputs-pending`; the render-EXISTS guarantee is the CALLER's — the
    // viewer core's getRender gate (pinned in the test above). A future
    // control-api change that classifies unknown renders here will flip
    // this pin and force a conscious contract update, never a silent one.
    const result = await provider.loadOutput("sess-1", "r-999999");
    expect(result).toEqual({ kind: "outputs-pending" });
  });

  test("unknown-segment → 404 unknown-segment (real render, real session)", async () => {
    const err = await provider.fetchSegment("sess-1", "r-1", "anime-clip-00000000").catch((e) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("unknown-segment");
      expect(err.details.httpStatus).toBe(404);
    }
  });

  test("no-storage-rights policy through the CORE: session open denied at the W701 gate, typed, no partial view", async () => {
    const local = makeCore(fakeClock());
    local.core.dispatch({ type: "connect" });
    await settleUntil(local.core, (v) => v.status === "browsing-sessions");
    local.core.dispatch({ type: "openSession", sessionId: deniedSessionId });
    const view = await settleUntil(local.core, (v) => v.status === "error");
    expect(view.error).toEqual({
      failureClass: "rights-denied",
      label: "Rights denied",
      message: expect.stringContaining("canStoreDerivatives is false"),
      retryable: false,
      operation: "openSession",
      details: expect.objectContaining({ httpStatus: 403, sessionId: deniedSessionId }),
    });
    // Fail-closed: no partial session view, no player, no pending render.
    expect(view.session).toBeNull();
    expect(view.playback).toBeNull();
    expect(view.pendingRenderId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Processing states over the REAL surface — the DECOUPLED host posture
// ---------------------------------------------------------------------------

/**
 * The host-side detailed render that reproduces the control plane's render
 * for a fresh session (the W504 e2e host-equivalence approach): the same
 * request the app built (style `default`, the plugin's first supported
 * profile, the fresh engine's snapshot version 1, watermark sequence 0, the
 * derived full-allow capabilities, the frozen clock) plus the same genesis
 * snapshot (watermark 0/0, no entities, generatedAtMs TEST_EPOCH_MS). The
 * decoupled harness's clock is frozen at TEST_EPOCH_MS, so the equivalence
 * assertion below holds exactly.
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

describe("W705 playback e2e — processing states: outputs-pending → host stores → ready", () => {
  let control: ControlServer;
  let pipeline: AnimeOutputPipeline;
  let baseUrl: string;

  beforeAll(() => {
    // The DECOUPLED production posture: the control plane serves playback
    // from the REAL pipeline, but the plugin is registered WITHOUT the
    // encoding wrapper — the host-side encode→store step is a separate step
    // that has not run yet (exactly the real W504 contract: createRender
    // returns the RenderResult; storing the playable segment is the host's).
    pipeline = createAnimeOutputPipeline();
    const registry = new RendererRegistry();
    registry.register(createAnimePrototypeRenderer());
    control = createControlServer({
      port: 0,
      rendererRegistry: registry,
      renderOutputStore: pipeline,
      nowMs: () => TEST_EPOCH_MS, // frozen — the host equivalence depends on it
    });
    baseUrl = `http://127.0.0.1:${control.port}`;
  });

  afterAll(() => {
    control.stop(true);
  });

  test("the render exists, no stored outputs → outputs-pending (resting state, never an error, never a fake player)", async () => {
    const clock = fakeClock();
    const client = createHttpControlClient({ baseUrl });
    const output = createHttpPlaybackProvider({ baseUrl });
    const core = createViewerCore({ client, output, nowMs: () => clock.now() });

    core.dispatch({ type: "connect" });
    await settleUntil(core, (v) => v.status === "browsing-sessions");
    core.dispatch({
      type: "createSession",
      policy: fullAllowPolicy,
      sourceLabel: "playback-e2e-decoupled",
    });
    await settleUntil(core, (v) => v.sessions.length === 1);
    const sessionId = core.view().sessions[0]!.id;
    core.dispatch({ type: "openSession", sessionId });
    await settleUntil(core, (v) => v.status === "session-detail");
    core.dispatch({ type: "beginRender" });
    await settleUntil(core, (v) => v.status === "renderer-selection");
    core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
    const view = await settleUntil(
      core,
      (v) => v.status === "outputs-pending" || v.status === "error",
    );

    expect(view.status).toBe("outputs-pending");
    expect(view.pendingRenderId).toBe("r-1");
    expect(view.pendingOperation).toBeNull(); // a RESTING state, not in-flight
    expect(view.playback).toBeNull(); // never a fake player
    expect(view.error).toBeNull(); // never an invented error
    // The render WAS created — that part of the story stays visible.
    expect(view.session?.renders.map((r) => r.renderId)).toEqual(["r-1"]);

    // --- the host step runs (out-of-band, the real W504 flow) -----------
    // Equivalence PROOF first: the local detailed render is the same render
    // the control plane stored (deep-equal RenderResult through getRender).
    const localOutput = equivalentDetailedRender(sessionId);
    const envelope = await client.getRender(sessionId, "r-1");
    expect(envelope.result).toEqual(localOutput.result);
    // Encode + store through the REAL pipeline under the real render id.
    const stored = pipeline.encodeAndStore({
      sessionId,
      renderId: "r-1",
      output: localOutput,
    });
    expect(stored.outcome).toBe("stored");
    expect(stored.frameCount).toBe(6);

    // --- "check again": the user re-selects the render -------------------
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    const ready = await settleUntil(core, (v) => v.status === "ready" || v.status === "error");
    expect(ready.status).toBe("ready");
    expect(ready.pendingRenderId).toBeNull();
    expect(ready.playback?.kind).toBe("segment");
    if (ready.playback?.kind === "segment") {
      expect(ready.playback.frameCount).toBe(6);
      expect(ready.playback.durationMs).toBe(6_000);
      expect(ready.playback.smil).toEqual({ paused: true, seekMs: 0 });
    }

    // And it PLAYS: the declared timeline advances from the injected clock.
    core.dispatch({ type: "play" });
    expect(core.view().status).toBe("playing");
    clock.advance(1_000);
    core.dispatch({ type: "tick" });
    const playing = core.view();
    expect(playing.status).toBe("playing");
    if (playing.playback?.kind !== "segment") throw new Error("expected the segment path");
    expect(playing.playback.positionMs).toBe(1_000);
    expect(playing.playback.frameIndex).toBe(1);
  });

  test("a pending render stays pending until the host stores (no invented transitions)", async () => {
    const clock = fakeClock();
    const client = createHttpControlClient({ baseUrl });
    const output = createHttpPlaybackProvider({ baseUrl });
    const core = createViewerCore({ client, output, nowMs: () => clock.now() });
    core.dispatch({ type: "connect" });
    await settleUntil(core, (v) => v.status === "browsing-sessions");
    core.dispatch({
      type: "createSession",
      policy: fullAllowPolicy,
      sourceLabel: "playback-e2e-still-pending",
    });
    await settleUntil(core, (v) => v.sessions.length === 2);
    const sessionId = core.view().sessions[1]!.id;
    core.dispatch({ type: "openSession", sessionId });
    await settleUntil(core, (v) => v.status === "session-detail");
    core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
    const view = await settleUntil(core, (v) => v.status === "outputs-pending");
    // The second render on this app is r-2 (r-1 belongs to the first test's
    // session — the app counter is per-app, not per-session).
    expect(view.pendingRenderId).toBe("r-2");
    // Re-selecting WITHOUT the host step: still pending (honest — the state
    // does not invent progress, and nothing errors).
    core.dispatch({ type: "selectRender", renderId: "r-2" });
    const again = await settleUntil(core, (v) => v.status === "outputs-pending");
    expect(again.pendingRenderId).toBe("r-2");
    expect(again.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Determinism — the golden walk trace, deep-equal across fresh servers
// ---------------------------------------------------------------------------

describe("W705 playback e2e — determinism (deep-equal trace rerun)", () => {
  test("the same command script over a fresh server+core yields a deep-equal view trace", async () => {
    async function run(): Promise<string[]> {
      const local = serveViewer({ port: 0 });
      try {
        const client = createHttpControlClient({ baseUrl: `${local.url}/control` });
        const output = createHttpPlaybackProvider({ baseUrl: `${local.url}/control` });
        const clock = fakeClock();
        const core = createViewerCore({ client, output, nowMs: () => clock.now() });
        const trace: string[] = [];
        core.subscribe((view: ViewerViewModel) => trace.push(JSON.stringify(view)));
        core.dispatch({ type: "connect" });
        await settleUntil(core, (v) => v.status === "browsing-sessions");
        core.dispatch({ type: "createSession", policy: fullAllowPolicy });
        await settleUntil(core, (v) => v.status === "browsing-sessions" && v.sessions.length === 1);
        core.dispatch({ type: "openSession", sessionId: "sess-1" });
        await settleUntil(core, (v) => v.status === "session-detail");
        core.dispatch({ type: "beginRender" });
        await settleUntil(core, (v) => v.status === "renderer-selection");
        core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
        await settleUntil(core, (v) => v.status === "ready");
        core.dispatch({ type: "play" });
        clock.advance(6_000);
        core.dispatch({ type: "tick" });
        return trace;
      } finally {
        local.stop();
      }
    }
    expect(await run()).toEqual(await run());
  });
});
