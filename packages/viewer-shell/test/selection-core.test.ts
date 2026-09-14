/**
 * W703 viewer-core selection tests — the DERIVED selection view-model and the
 * verbatim selection payload seams.
 *
 * The core's `beginRender` now stores the `./selection-plan.ts` derivation
 * (capability documents + the open session's fail-closed rights → selectable
 * / blocked + reason + note) in the view-model, and `createRender` carries
 * the selection payload through VERBATIM — renderer identity, an optional
 * capability-declared `outputProfile`, and the opaque style choice. Pinned
 * here headlessly (the scripted-client seam); the REAL-wire versions live in
 * `selection-e2e.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { createViewerCore } from "../src/viewer-core.ts";
import type { OutputProfile, RendererCapability, RightsCapabilities } from "@sporta/contracts";
import {
  fakeClock,
  rej,
  res,
  scriptClient,
  scriptOutput,
  sessionSummary,
  sessionResult,
  viewerFailure,
} from "./helpers.ts";

/** Flushes the microtask queue (scripted promises resolve immediately). */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** The SVG (presentable) declared profile. */
const SVG_PROFILE: RendererCapability["supportedOutputProfiles"][number] = {
  resolution: { w: 1170, h: 880 },
  frameRate: 1,
  codec: "svg",
  container: "svg",
  latencyClass: "offline",
};

/** A non-presentable declared profile. */
const H264_PROFILE: RendererCapability["supportedOutputProfiles"][number] = {
  resolution: { w: 1280, h: 720 },
  frameRate: 30,
  codec: "h264",
  container: "mp4",
  latencyClass: "offline",
};

/** Rights without source-frame references (storage granted). */
const NO_FRAME_RIGHTS: RightsCapabilities = {
  canReferenceSourceFrames: false,
  canDeliverLive: false,
  canStoreDerivatives: true,
  canShare: false,
};

/** A synthetic presentable capability (arbitrary id — never matched). */
function svgCapability(rendererId: string): RendererCapability {
  return {
    rendererId,
    rendererVersion: "0.1.0",
    rendererClass: "procedural-3d",
    supportedOutputProfiles: [SVG_PROFILE],
    requiresSourceFrames: false,
    minSnapshotVersion: 0,
  };
}

/** A get-session result with overridden rights. */
function sessionWithRights(sessionId: string, rights: RightsCapabilities) {
  return { ...sessionResult(sessionId), rightsCapabilities: rights };
}

describe("ViewerCore — beginRender stores the DERIVED selection options (W703)", () => {
  test("presentable + non-presentable capabilities over full-allow rights → selectable + blocked(unsupported-output)", async () => {
    const client = scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [res({ renders: [] })],
      listRenderers: [
        res({
          renderers: [svgCapability("zzz.presentable"), svgCapability("mmm.video")].map(
            (capability, index) =>
              index === 1 ? { ...capability, supportedOutputProfiles: [H264_PROFILE] } : capability,
          ),
        }),
      ],
    });
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [] }),
      nowMs: () => fakeClock().now(),
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "beginRender" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("renderer-selection");
    const options = view.rendererSelection?.renderers ?? [];
    expect(options).toHaveLength(2);
    expect(options[0]?.capability.rendererId).toBe("zzz.presentable");
    expect(options[0]?.selectable).toBe(true);
    expect(options[0]?.blockedReason).toBeNull();
    expect(options[1]?.capability.rendererId).toBe("mmm.video");
    expect(options[1]?.selectable).toBe(false);
    expect(options[1]?.blockedReason).toBe("unsupported-output");
    expect(options[1]?.blockedNote).toContain("h264/mp4");
  });

  test("requiresSourceFrames capability against a session without frame rights → blocked(rights-required)", async () => {
    const client = scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [res(sessionWithRights("sess-1", NO_FRAME_RIGHTS))],
      listRenders: [res({ renders: [] })],
      listRenderers: [
        res({
          renderers: [{ ...svgCapability("fff.frames"), requiresSourceFrames: true }],
        }),
      ],
    });
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [] }),
      nowMs: () => fakeClock().now(),
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "beginRender" });
    await settle();
    const options = core.view().rendererSelection?.renderers ?? [];
    expect(options).toHaveLength(1);
    expect(options[0]?.selectable).toBe(false);
    expect(options[0]?.blockedReason).toBe("rights-required");
    expect(options[0]?.blockedNote).toContain("requiresSourceFrames");
    // (The same capability against GRANTED frame rights stays selectable —
    // pinned in selection-plan.test.ts, the pure derivation.)
  });

  test("beginRender with NO open session → options derived fail-closed (no-session), never assumed rights", async () => {
    const client = scriptClient({
      listSessions: [res({ sessions: [] })],
      listRenderers: [res({ renderers: [svgCapability("zzz.any")] })],
    });
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [] }),
      nowMs: () => fakeClock().now(),
    });
    core.dispatch({ type: "connect" });
    await settle();
    // No openSession: the selection list still renders, but the rights
    // context is unknown → fail-closed (the plan never assumes rights).
    core.dispatch({ type: "beginRender" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("renderer-selection");
    const options = view.rendererSelection?.renderers ?? [];
    expect(options).toHaveLength(1);
    expect(options[0]?.selectable).toBe(false);
    expect(options[0]?.blockedReason).toBe("no-session");
  });
});

describe("ViewerCore — createRender carries the selection payload VERBATIM (W703 seams)", () => {
  const happyScript = () =>
    scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [res({ renders: [] })],
      listRenderers: [res({ renderers: [svgCapability("zzz.presentable")] })],
      createRender: [
        res({
          renderId: "r-1",
          result: {
            sessionId: "sess-1",
            rendererId: "zzz.presentable",
            outputSegments: [
              { segmentId: "s-0", startMs: 0, endMs: 1_000, artifactRef: "x://sess-1/1/0" },
            ],
            watermarkAfter: { watermarkMs: 1_000, sequence: 0 },
            rendererHealth: { lagMs: 0, degraded: false },
            provenance: { snapshotVersion: 1, lastEventSequence: 0 },
          },
        }),
      ],
      getRender: [
        res({
          renderId: "r-1",
          result: {
            sessionId: "sess-1",
            rendererId: "zzz.presentable",
            outputSegments: [
              { segmentId: "s-0", startMs: 0, endMs: 1_000, artifactRef: "x://sess-1/1/0" },
            ],
            watermarkAfter: { watermarkMs: 1_000, sequence: 0 },
            rendererHealth: { lagMs: 0, degraded: false },
            provenance: { snapshotVersion: 1, lastEventSequence: 0 },
          },
        }),
      ],
    });

  test("outputProfile + styleId + opaque config all pass through VERBATIM", async () => {
    const client = happyScript();
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [rej(viewerFailure("unsupported-output", "stand-in"))] }),
      nowMs: () => fakeClock().now(),
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "beginRender" });
    await settle();
    const outputProfile: OutputProfile = { ...SVG_PROFILE };
    core.dispatch({
      type: "createRender",
      rendererId: "zzz.presentable",
      rendererVersion: "0.1.0",
      outputProfile,
      styleId: "style-e2e",
      config: { anySchema: [1, 2], durationMs: 4_000 },
    });
    await settle();
    const createRenderCall = client.calls.find((call) => call.method === "createRender");
    expect(createRenderCall?.args[1]).toEqual({
      rendererId: "zzz.presentable",
      rendererVersion: "0.1.0",
      outputProfile,
      styleConfig: {
        styleId: "style-e2e",
        config: { anySchema: [1, 2], durationMs: 4_000 },
      },
    });
  });

  test("omitted optional fields stay omitted (renderer-only payload unchanged)", async () => {
    const client = happyScript();
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [rej(viewerFailure("unsupported-output", "stand-in"))] }),
      nowMs: () => fakeClock().now(),
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "beginRender" });
    await settle();
    core.dispatch({ type: "createRender", rendererId: "zzz.presentable" });
    await settle();
    const createRenderCall = client.calls.find((call) => call.method === "createRender");
    expect(createRenderCall?.args[1]).toEqual({
      rendererId: "zzz.presentable",
      styleConfig: {},
    });
  });
});

describe("ViewerCore — a capability-violating selection fails closed with the server's real error", () => {
  test("media-invalid rejection → the classified error view carries the class and message VERBATIM", async () => {
    const client = scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [res({ renders: [] })],
      listRenderers: [res({ renderers: [svgCapability("zzz.presentable")] })],
      createRender: [
        rej(
          viewerFailure(
            "media-invalid",
            "renderer rejected the request: outputProfile is not one of the supported output profiles",
            {
              rendererId: "zzz.presentable",
              reason: "outputProfile is not one of the supported output profiles",
            },
          ),
        ),
      ],
    });
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [] }),
      nowMs: () => fakeClock().now(),
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "beginRender" });
    await settle();
    core.dispatch({
      type: "createRender",
      rendererId: "zzz.presentable",
      outputProfile: { ...H264_PROFILE },
    });
    await settle();
    const view = core.view();
    expect(view.status).toBe("error");
    expect(view.error?.failureClass).toBe("media-invalid");
    expect(view.error?.label).toBe("Invalid render request");
    expect(view.error?.operation).toBe("createRender");
    expect(view.error?.message).toBe(
      "renderer rejected the request: outputProfile is not one of the supported output profiles",
    );
    expect(view.error?.retryable).toBe(false);
    // Fail-closed: the selection was consumed, no render listed, no player.
    expect(view.rendererSelection).toBeNull();
    expect(view.session?.renders).toEqual([]);
    expect(view.playback).toBeNull();
    // Dismiss returns to the stable session detail.
    core.dispatch({ type: "dismissError" });
    expect(core.view().status).toBe("session-detail");
  });
});
