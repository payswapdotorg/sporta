/**
 * Full-stack headless E2E — the W702 STAND-IN frame-sequence path (kept for
 * its own seam): the browser viewer's data path driven through every REAL
 * seam — `serveViewer` (static shell + same-origin control proxy + stand-in
 * output route, self-hosted control app with the capturing anime renderer),
 * the HTTP control client, the HTTP render-output provider, the viewer core,
 * and the real frame player. This is the W702 accept-criterion evidence
 * ("browser viewer plays supported batch outputs and exposes clear
 * state/errors") minus the actual browser paint (real-browser E2E is W706).
 * The W705 REAL-W504 path (stored animated-SVG segments through the playback
 * routes) has its own e2e: `playback-e2e.test.ts`.
 *
 * Both postures are pinned: the golden playback walk AND the fail-closed
 * rights leg (a policy that renders but cannot store derivatives → the W701
 * playback gate denies `listRenders` from the WIRE at session open → the
 * shell surfaces a typed rights-denied error and never shows a partial
 * session view).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHttpControlClient } from "../src/http-client.ts";
import { createHttpRenderOutputProvider } from "../src/output-provider.ts";
import { createViewerCore } from "../src/viewer-core.ts";
import type { ViewerCore, ViewerViewModel } from "../src/viewer-core.ts";
import { serveViewer } from "../src/serve.ts";
import type { ViewerServer } from "../src/serve.ts";
import { fakeClock, fullAllowPolicy, analysisTransformationPolicy } from "./helpers.ts";

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
 * No wall-clock reads: the bound is an iteration count, and each turn is an
 * explicit 0 ms yield.
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

function makeCore(clock: ReturnType<typeof fakeClock>) {
  const client = createHttpControlClient({ baseUrl: `${server.url}/control` });
  const output = createHttpRenderOutputProvider({ baseUrl: server.url });
  const core = createViewerCore({ client, output, nowMs: () => clock.now() });
  return { core, clock };
}

describe("full-stack e2e — golden playback walk through every real seam", () => {
  test("connect → create session → render → play → ended (real HTTP + real W502 output)", async () => {
    const { core, clock } = makeCore(fakeClock());

    expect(core.view().status).toBe("disconnected");
    core.dispatch({ type: "connect" });
    let view = await settleUntil(core, (v) => v.status === "browsing-sessions");
    expect(view.connection).toBe("connected");

    core.dispatch({
      type: "createSession",
      policy: fullAllowPolicy,
      sourceLabel: "e2e-clip",
    });
    view = await settleUntil(core, (v) => v.sessions.length === 1);
    expect(view.status).toBe("browsing-sessions");
    // The session is listed by the control plane (not synthesized locally).
    expect(view.sessions[0]).toMatchObject({ id: "sess-1", sourceLabel: "e2e-clip" });

    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    view = await settleUntil(core, (v) => v.status === "session-detail");
    expect(view.session?.rights.canStoreDerivatives).toBe(true);

    core.dispatch({ type: "beginRender" });
    view = await settleUntil(core, (v) => v.status === "renderer-selection");
    // Capability-driven: the list came over the wire from the registry; the
    // view carries the DERIVED options (W703) — full-allow session → selectable.
    expect(view.rendererSelection?.renderers.map((option) => option.capability.rendererId)).toEqual(
      ["anime.prototype"],
    );
    expect(view.rendererSelection?.renderers[0]?.selectable).toBe(true);

    core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
    view = await settleUntil(core, (v) => v.status === "ready");
    // The real single-snapshot anime output: 6000 ms @ 1 fps → 6 frames.
    expect(view.session?.renders.map((r) => r.renderId)).toEqual(["r-1"]);
    expect(view.playback).not.toBeNull();
    if (view.playback?.kind !== "frames") throw new Error("expected the frame-sequence path");
    expect(view.playback.frameCount).toBe(6);
    expect(view.playback.durationMs).toBe(6_000);
    expect(view.playback.renderer.rendererId).toBe("anime.prototype");
    expect(view.playback.frameSvg).toContain("<svg");

    core.dispatch({ type: "play" });
    expect(core.view().status).toBe("playing");
    clock.advance(3_500);
    core.dispatch({ type: "tick" });
    view = core.view();
    expect(view.status).toBe("playing");
    expect(view.playback?.positionMs).toBe(3_500);
    expect(view.playback?.frameIndex).toBe(3);
    expect(view.playback?.buffering).toBe(false);

    core.dispatch({ type: "pause" });
    expect(core.view().status).toBe("paused");

    core.dispatch({ type: "play" });
    clock.advance(2_500);
    core.dispatch({ type: "tick" });
    view = core.view();
    expect(view.status).toBe("ended"); // 6000 >= duration 6000, exact
    expect(view.playback?.positionMs).toBe(6_000);

    core.dispatch({ type: "closePlayback" });
    expect(core.view().status).toBe("session-detail");
    expect(core.view().playback).toBeNull();

    // Live output stays honestly unavailable through the whole walk.
    expect(view.live.available).toBe(false);
  });

  test("selectRender re-plays the stored render (getRender gate + output route)", async () => {
    const { core, clock } = makeCore(fakeClock());
    core.dispatch({ type: "connect" });
    await settleUntil(core, (v) => v.status === "browsing-sessions");
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settleUntil(core, (v) => v.status === "session-detail");
    expect(core.view().session?.renders.map((r) => r.renderId)).toEqual(["r-1"]);
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    await settleUntil(core, (v) => v.status === "ready");
    expect(core.view().playback?.frameCount).toBe(6);
    core.dispatch({ type: "replay" });
    clock.advance(6_000);
    core.dispatch({ type: "tick" });
    expect(core.view().playback?.playback).toBe("ended");
  });
});

describe("full-stack e2e — the fail-closed rights leg (real 403 from the wire)", () => {
  test("a gated session open is denied by the W701 playback gate: typed error, no partial session view", async () => {
    const { core } = makeCore(fakeClock());
    core.dispatch({ type: "connect" });
    await settleUntil(core, (v) => v.status === "browsing-sessions");

    core.dispatch({
      type: "createSession",
      policy: analysisTransformationPolicy,
      sourceLabel: "e2e-gated",
    });
    await settleUntil(core, (v) => v.sessions.length === 2);
    // sess-2: analysis+transformation — renders, but canStoreDerivatives is
    // false, so the playback gate denies the render list at session open.
    core.dispatch({ type: "openSession", sessionId: "sess-2" });
    const view = await settleUntil(core, (v) => v.status === "error");
    expect(view.error).toEqual({
      failureClass: "rights-denied",
      label: "Rights denied",
      message: expect.stringContaining("canStoreDerivatives is false"),
      retryable: false,
      operation: "openSession",
      details: expect.objectContaining({ httpStatus: 403, sessionId: "sess-2" }),
    });
    // Fail-closed: no partial session view leaked.
    expect(view.session).toBeNull();
    expect(view.playback).toBeNull();

    // Dismiss returns to browsing with the session list intact.
    core.dispatch({ type: "dismissError" });
    const after = core.view();
    expect(after.status).toBe("browsing-sessions");
    expect(after.error).toBeNull();
    expect(after.sessions).toHaveLength(2);
  });
});

describe("full-stack e2e — determinism (deep-equal trace rerun)", () => {
  test("the same command script over a fresh server+core yields a deep-equal view trace", async () => {
    async function run(): Promise<string[]> {
      const local = serveViewer({ port: 0 });
      try {
        const client = createHttpControlClient({ baseUrl: `${local.url}/control` });
        const output = createHttpRenderOutputProvider({ baseUrl: local.url });
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
