/**
 * ViewerCore tests (W702): the full state-machine walk (every transition),
 * EVERY failure class surfaced as a structured error view-model, retry and
 * dismiss semantics, fail-closed postures (no partial data), pending/dropped
 * commands, the live-tab honesty constant, and deep-equal determinism reruns.
 */
import { describe, expect, test } from "bun:test";
import { createViewerCore } from "../src/viewer-core.ts";
import type { ViewerCommand, ViewerViewModel } from "../src/viewer-core.ts";
import { LIVE_UNAVAILABLE_NOTE } from "../src/viewer-core.ts";
import type { ControlClient } from "../src/ports.ts";
import {
  asFrameOutput,
  buildHandOutput,
  buildHandSegment,
  fakeClock,
  fullAllowPolicy,
  rej,
  res,
  scriptClient,
  scriptOutput,
  sessionDoc,
  sessionResult,
  sessionSummary,
  rendererCapability,
  renderResult,
  viewerFailure,
} from "./helpers.ts";

/** Flushes the microtask queue (scripted promises resolve immediately). */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const HAND_OUTPUT = buildHandOutput([0, 1_000]); // duration 2000, 2 frames

/** The scripted happy-path script for the golden walk. */
function happyScript() {
  return scriptClient({
    listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
    getSession: [res(sessionResult("sess-1"))],
    listRenders: [res({ renders: [] })],
    listRenderers: [res({ renderers: [rendererCapability("anime.prototype")] })],
    createRender: [res({ renderId: "r-1", result: renderResult("sess-1", "anime.prototype", 2) })],
    getRender: [res({ renderId: "r-1", result: renderResult("sess-1", "anime.prototype", 2) })],
  });
}

function makeCore(client: ControlClient, clock = fakeClock()) {
  const output = scriptOutput({ loadOutput: [res(asFrameOutput(HAND_OUTPUT))] });
  const core = createViewerCore({ client, output, nowMs: () => clock.now() });
  return { core, clock, output };
}

describe("ViewerCore — the golden walk through every state", () => {
  test("connect → browse → open → select renderer → create render → play → ended", async () => {
    const client = happyScript();
    const { core, clock } = makeCore(client);

    expect(core.view().status).toBe("disconnected");
    expect(core.view().live).toEqual({ available: false, note: LIVE_UNAVAILABLE_NOTE });

    core.dispatch({ type: "connect" });
    expect(core.view().status).toBe("connecting");
    expect(core.view().pendingOperation).toBe("connect");
    await settle();
    let view = core.view();
    expect(view.status).toBe("browsing-sessions");
    expect(view.connection).toBe("connected");
    expect(view.sessions).toEqual([sessionSummary("sess-1")]);
    expect(view.connectedAtMs).not.toBe(null);

    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    expect(core.view().pendingOperation).toBe("openSession");
    await settle();
    view = core.view();
    expect(view.status).toBe("session-detail");
    expect(view.session?.sessionId).toBe("sess-1");
    expect(view.session?.rights.canStoreDerivatives).toBe(true);
    expect(view.session?.renders).toEqual([]);

    core.dispatch({ type: "beginRender" });
    await settle();
    view = core.view();
    expect(view.status).toBe("renderer-selection");
    // W703: the selection view carries the DERIVED options — the capability
    // verbatim plus the affordance (session rights are full-allow here).
    const options = view.rendererSelection?.renderers ?? [];
    expect(options).toHaveLength(1);
    expect(options[0]?.capability).toEqual(rendererCapability("anime.prototype"));
    expect(options[0]?.selectable).toBe(true);
    expect(options[0]?.blockedReason).toBeNull();
    expect(options[0]?.blockedNote).toBe("");

    core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
    expect(core.view().status).toBe("render-queued");
    expect(core.view().pendingOperation).toBe("createRender");
    await settle();
    view = core.view();
    // createRender succeeded → loading-output → output loaded → ready.
    expect(view.status).toBe("ready");
    expect(view.session?.renders).toHaveLength(1);
    expect(view.session?.renders[0]?.renderId).toBe("r-1");
    expect(view.playback).not.toBeNull();
    expect(view.playback?.playback).toBe("ready");
    expect(view.playback?.frameCount).toBe(2);
    expect(view.playback?.durationMs).toBe(2_000);

    core.dispatch({ type: "play" });
    expect(core.view().status).toBe("playing");
    clock.advance(1_500);
    core.dispatch({ type: "tick" });
    view = core.view();
    expect(view.status).toBe("playing");
    expect(view.playback?.positionMs).toBe(1_500);
    expect(view.playback?.frameIndex).toBe(1);

    core.dispatch({ type: "pause" });
    expect(core.view().status).toBe("paused");

    core.dispatch({ type: "play" });
    clock.advance(500);
    core.dispatch({ type: "tick" });
    view = core.view();
    expect(view.status).toBe("ended"); // position 2000 >= duration 2000
    expect(view.playback?.positionMs).toBe(2_000);

    core.dispatch({ type: "closePlayback" });
    expect(core.view().status).toBe("session-detail");
    expect(core.view().playback).toBeNull();

    // The control calls were exactly the scripted ones, in order.
    expect(client.calls.map((call) => call.method)).toEqual([
      "listSessions",
      "getSession",
      "listRenders",
      "listRenderers",
      "createRender",
      "getRender",
    ]);
  });

  test("selectRender plays an existing render through getRender + loadOutput", async () => {
    const client = scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [
        res({
          renders: [
            {
              renderId: "r-1",
              rendererId: "anime.prototype",
              segmentCount: 2,
              provenance: { snapshotVersion: 1, lastEventSequence: 0 },
              watermarkAfter: { watermarkMs: 2000, sequence: 0 },
            },
          ],
        }),
      ],
      getRender: [res({ renderId: "r-1", result: renderResult("sess-1", "anime.prototype", 2) })],
    });
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    expect(core.view().status).toBe("loading-output");
    await settle();
    const view = core.view();
    expect(view.status).toBe("ready");
    expect(view.playback?.frameCount).toBe(2);
  });

  test("disconnect resets everything (and kills an in-flight connect)", async () => {
    // A manually-controlled client: listSessions resolves only when we say.
    let release: (value: { sessions: ReturnType<typeof sessionSummary>[] }) => void = () => {};
    const pending = new Promise<{ sessions: ReturnType<typeof sessionSummary>[] }>((resolve) => {
      release = resolve;
    });
    const client: ControlClient = {
      createSession: () => Promise.reject(new Error("unused")),
      getSession: () => Promise.reject(new Error("unused")),
      listSessions: () => pending,
      terminateSession: () => Promise.reject(new Error("unused")),
      listRenderers: () => Promise.reject(new Error("unused")),
      createRender: () => Promise.reject(new Error("unused")),
      getRender: () => Promise.reject(new Error("unused")),
      listRenders: () => Promise.reject(new Error("unused")),
    };
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    expect(core.view().status).toBe("connecting");

    core.dispatch({ type: "disconnect" });
    expect(core.view().status).toBe("disconnected");
    expect(core.view().sessions).toEqual([]);

    // The late resolution must NOT zombie-mutate the reset machine.
    release({ sessions: [sessionSummary("sess-9")] });
    await settle();
    expect(core.view().status).toBe("disconnected");
    expect(core.view().sessions).toEqual([]);
  });
});

describe("ViewerCore — every typed error family surfaces as an error view-model", () => {
  const CASES: Array<{
    failureClass: Parameters<typeof viewerFailure>[0];
    label: string;
    retryable: boolean;
    message: string;
  }> = [
    {
      failureClass: "rights-denied",
      label: "Rights denied",
      retryable: false,
      message: "playback access denied: rightsCapabilities.canStoreDerivatives is false",
    },
    {
      failureClass: "media-invalid",
      label: "Invalid render request",
      retryable: false,
      message: "renderer rejected the request",
    },
    {
      failureClass: "validation",
      label: "Invalid request",
      retryable: false,
      message: "authorizationPolicy is not a valid AuthorizationPolicy",
    },
    {
      failureClass: "resource-limit",
      label: "Resource limit",
      retryable: true,
      message: "queue capacity exceeded",
    },
    {
      failureClass: "internal",
      label: "Server error",
      retryable: true,
      message: "unexpected control-plane failure",
    },
    {
      failureClass: "unknown-session",
      label: "Unknown session",
      retryable: false,
      message: "media session 'sess-404' was not found",
    },
    {
      failureClass: "unknown-render",
      label: "Unknown render",
      retryable: false,
      message: "render 'r-404' was not found",
    },
    {
      failureClass: "unknown-route",
      label: "Unknown route",
      retryable: false,
      message: "no route for GET /v1/nope",
    },
    {
      failureClass: "method-not-allowed",
      label: "Method not allowed",
      retryable: false,
      message: "method DELETE is not allowed",
    },
    {
      failureClass: "network",
      label: "Connection failed",
      retryable: true,
      message: "control server could not be reached",
    },
    {
      failureClass: "unsupported-output",
      label: "Output not available",
      retryable: false,
      message: "stored render output is not available yet",
    },
  ];

  for (const testCase of CASES) {
    test(`connect failure "${testCase.failureClass}" → error view with class/label/retryability`, async () => {
      const client = scriptClient({
        listSessions: [rej(viewerFailure(testCase.failureClass, testCase.message))],
      });
      const { core } = makeCore(client);
      core.dispatch({ type: "connect" });
      await settle();
      const view = core.view();
      expect(view.status).toBe("error");
      expect(view.connection).toBe("disconnected");
      expect(view.error).toEqual({
        failureClass: testCase.failureClass,
        label: testCase.label,
        message: testCase.message,
        retryable: testCase.retryable,
        operation: "connect",
        details: {},
      });
    });
  }

  test("an untyped thrown value from a port is surfaced as internal (never swallowed)", async () => {
    const client = scriptClient({ listSessions: [rej(new Error("raw port failure"))] });
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("error");
    expect(view.error?.failureClass).toBe("internal");
    expect(view.error?.message).toBe("raw port failure");
  });
});

describe("ViewerCore — retry and dismiss semantics", () => {
  test("retry re-issues a retryable operation and recovers when the port recovers", async () => {
    const client = scriptClient({
      listSessions: [
        rej(viewerFailure("network", "control server could not be reached")),
        res({ sessions: [sessionSummary("sess-1")] }),
      ],
    });
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    expect(core.view().status).toBe("error");
    expect(core.view().error?.retryable).toBe(true);

    core.dispatch({ type: "retry" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("browsing-sessions");
    expect(view.error).toBeNull();
    expect(view.sessions).toEqual([sessionSummary("sess-1")]);
    expect(client.calls).toHaveLength(2); // both connect attempts hit the port
  });

  test("retry on a non-retryable error is a no-op (stays in error)", async () => {
    const client = scriptClient({
      listSessions: [rej(viewerFailure("rights-denied", "denied"))],
    });
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "retry" });
    await settle();
    expect(core.view().status).toBe("error");
    expect(client.calls).toHaveLength(1);
  });

  test("dismissError returns to the last stable status with data intact", async () => {
    const client = scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [rej(viewerFailure("unknown-session", "media session 'sess-404' was not found"))],
    });
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-404" });
    await settle();
    expect(core.view().status).toBe("error");

    core.dispatch({ type: "dismissError" });
    const view = core.view();
    expect(view.status).toBe("browsing-sessions");
    expect(view.error).toBeNull();
    expect(view.sessions).toEqual([sessionSummary("sess-1")]);
  });
});

describe("ViewerCore — fail-closed posture (no partial data)", () => {
  test("a denied render list fails the whole session open — no partial session view", async () => {
    const client = scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [
        rej(viewerFailure("rights-denied", "playback access denied", { sessionId: "sess-1" })),
      ],
    });
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("error");
    expect(view.error?.failureClass).toBe("rights-denied");
    expect(view.error?.details).toEqual({ sessionId: "sess-1" });
    expect(view.session).toBeNull(); // nothing partial leaked
  });

  test("createRender succeeds but output load is denied → the render stays listed (honesty about what succeeded)", async () => {
    const client = happyScript();
    const output = scriptOutput({
      loadOutput: [rej(viewerFailure("rights-denied", "playback access denied"))],
    });
    const core = createViewerCore({ client, output, nowMs: () => fakeClock().now() });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "beginRender" });
    await settle();
    core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("error");
    expect(view.error?.failureClass).toBe("rights-denied");
    expect(view.error?.operation).toBe("createRender");
    // The render WAS created — it remains listed; no playback mounted.
    expect(view.session?.renders).toHaveLength(1);
    expect(view.playback).toBeNull();

    core.dispatch({ type: "dismissError" });
    expect(core.view().status).toBe("session-detail");
  });

  test("selectRender hitting the playback gate (getRender denied) → error, playback null", async () => {
    const client = scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [
        res({
          renders: [
            {
              renderId: "r-1",
              rendererId: "anime.prototype",
              segmentCount: 2,
              provenance: { snapshotVersion: 1, lastEventSequence: 0 },
              watermarkAfter: { watermarkMs: 2000, sequence: 0 },
            },
          ],
        }),
      ],
      getRender: [rej(viewerFailure("rights-denied", "playback access denied"))],
    });
    const output = scriptOutput({ loadOutput: [res(asFrameOutput(HAND_OUTPUT))] });
    const core = createViewerCore({ client, output, nowMs: () => fakeClock().now() });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("error");
    expect(view.error?.operation).toBe("selectRender");
    expect(view.playback).toBeNull();
  });
});

describe("ViewerCore — createSession and terminateSession transitions (state machine pins)", () => {
  test("createSession refreshes the list from the source of truth and stays browsing", async () => {
    const client = scriptClient({
      listSessions: [
        res({ sessions: [sessionSummary("sess-1")] }),
        res({ sessions: [sessionSummary("sess-1"), sessionSummary("sess-2")] }),
      ],
      createSession: [res(sessionResult("sess-2"))],
    });
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    expect(core.view().sessions).toHaveLength(1);

    core.dispatch({ type: "createSession", policy: fullAllowPolicy, sourceLabel: "clip-2" });
    expect(core.view().pendingOperation).toBe("createSession");
    await settle();
    const view = core.view();
    // The new session is listed by the control plane (never synthesized
    // locally): the second listSessions refresh carried it.
    expect(view.status).toBe("browsing-sessions");
    expect(view.sessions).toEqual([sessionSummary("sess-1"), sessionSummary("sess-2")]);
    expect(view.session).toBeNull();
    expect(client.calls[1]?.args[0]).toEqual({
      authorizationPolicy: fullAllowPolicy,
      sourceLabel: "clip-2",
    });
  });

  test("createSession whose refresh fails lands in error with the create operation", async () => {
    const client = scriptClient({
      listSessions: [
        res({ sessions: [sessionSummary("sess-1")] }),
        rej(viewerFailure("network", "control server could not be reached")),
      ],
      createSession: [res(sessionResult("sess-2"))],
    });
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "createSession", policy: fullAllowPolicy });
    await settle();
    const view = core.view();
    expect(view.status).toBe("error");
    expect(view.error?.operation).toBe("createSession");
    expect(view.error?.failureClass).toBe("network");
    expect(view.error?.retryable).toBe(true);
    // The list from the LAST successful refresh stays (honest about what succeeded).
    expect(view.sessions).toEqual([sessionSummary("sess-1")]);
  });

  test("terminating the OPEN session tears it down and returns to browsing", async () => {
    const client = scriptClient({
      listSessions: [
        res({ sessions: [sessionSummary("sess-1"), sessionSummary("sess-2")] }),
        res({ sessions: [sessionSummary("sess-2")] }),
      ],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [res({ renders: [] })],
      terminateSession: [res({ session: { ...sessionDoc("sess-1"), status: "cancelled" } })],
    });
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    expect(core.view().status).toBe("session-detail");

    core.dispatch({ type: "terminateSession", sessionId: "sess-1" });
    expect(core.view().pendingOperation).toBe("terminateSession");
    await settle();
    const view = core.view();
    expect(view.status).toBe("browsing-sessions");
    expect(view.session).toBeNull(); // the open session was torn down
    expect(view.playback).toBeNull();
    // The refreshed list reflects the termination (sess-1 gone).
    expect(view.sessions).toEqual([sessionSummary("sess-2")]);
  });

  test("terminating a DIFFERENT session keeps the open session-detail intact", async () => {
    const client = scriptClient({
      listSessions: [
        res({ sessions: [sessionSummary("sess-1"), sessionSummary("sess-2")] }),
        res({ sessions: [sessionSummary("sess-1")] }),
      ],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [res({ renders: [] })],
      terminateSession: [res({ session: { ...sessionDoc("sess-2"), status: "cancelled" } })],
    });
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "terminateSession", sessionId: "sess-2" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("session-detail"); // still in the open session
    expect(view.session?.sessionId).toBe("sess-1");
    expect(view.sessions).toEqual([sessionSummary("sess-1")]);
  });

  test("a failed terminateSession surfaces its class and keeps the open session", async () => {
    const client = scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [res({ renders: [] })],
      terminateSession: [rej(viewerFailure("rights-denied", "termination denied"))],
    });
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "terminateSession", sessionId: "sess-1" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("error");
    expect(view.error?.failureClass).toBe("rights-denied");
    expect(view.error?.operation).toBe("terminateSession");
    // The session stays open and listed — nothing was torn down.
    expect(view.session?.sessionId).toBe("sess-1");
  });
});

describe("ViewerCore — pending/dropped commands and live honesty", () => {
  test("an async command issued while an operation is pending is dropped (one in-flight op)", async () => {
    const client = happyScript();
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    core.dispatch({ type: "refreshSessions" }); // dropped: connect is in flight
    await settle();
    expect(core.view().status).toBe("browsing-sessions");
    // Only the connect's listSessions call reached the port.
    expect(client.calls.map((call) => call.method)).toEqual(["listSessions"]);
  });

  test("without a live client the live section is the honest unavailable note (W704: the seam is the boundary)", () => {
    const { core } = makeCore(happyScript());
    const view = core.view();
    expect(view.live.available).toBe(false);
    // Narrowing the union is the test's own job — the note exists only on
    // the unavailable branch.
    if (!view.live.available) {
      expect(view.live.note).toContain("W704");
      expect(view.live.note).toContain("no real RTCPeerConnection");
    } else {
      throw new Error("live must be unavailable without an injected live client");
    }
  });

  test("createRender passes styleId + OPAQUE config through verbatim (W703 boundary: no renderer-specific keys in the core)", async () => {
    const client = happyScript();
    const { core } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "beginRender" });
    await settle();
    core.dispatch({
      type: "createRender",
      rendererId: "anime.prototype",
      rendererVersion: "0.1.0",
      styleId: "style-bold",
      config: { anySchema: { nested: [1, 2] }, durationMs: 4_000 },
    });
    await settle();
    expect(core.view().status).toBe("ready");
    const createRenderCall = client.calls.find((call) => call.method === "createRender");
    expect(createRenderCall?.args[1]).toEqual({
      rendererId: "anime.prototype",
      rendererVersion: "0.1.0",
      styleConfig: {
        styleId: "style-bold",
        config: { anySchema: { nested: [1, 2] }, durationMs: 4_000 },
      },
    });
  });

  test("a malformed manifest from the output port is a classified load failure", async () => {
    const client = happyScript();
    const broken = buildHandOutput([0, 1_000]);
    const badManifest = structuredClone(broken);
    badManifest.manifest.output.durationMs = 1_234; // inconsistent with windows
    const output = scriptOutput({ loadOutput: [res(asFrameOutput(badManifest))] });
    const core = createViewerCore({ client, output, nowMs: () => fakeClock().now() });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "beginRender" });
    await settle();
    core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("error");
    expect(view.error?.failureClass).toBe("media-invalid");
    expect(view.error?.operation).toBe("createRender");
    expect(view.playback).toBeNull();
  });
});

describe("ViewerCore — the W705 outputs-pending state (the honest processing state)", () => {
  function pendingScript(): ReturnType<typeof scriptClient> {
    return scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [res({ renders: [] })],
      listRenderers: [res({ renderers: [rendererCapability("anime.prototype")] })],
      createRender: [
        res({ renderId: "r-1", result: renderResult("sess-1", "anime.prototype", 2) }),
      ],
      getRender: [
        res({ renderId: "r-1", result: renderResult("sess-1", "anime.prototype", 2) }),
        res({ renderId: "r-1", result: renderResult("sess-1", "anime.prototype", 2) }),
      ],
    });
  }

  test("createRender → the render exists but no stored outputs → outputs-pending (never an error, never a fake player)", async () => {
    const client = pendingScript();
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [res({ kind: "outputs-pending" })] }),
      nowMs: () => fakeClock().now(),
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "beginRender" });
    await settle();
    core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("outputs-pending");
    expect(view.pendingOperation).toBeNull(); // a RESTING state, not in-flight
    expect(view.pendingRenderId).toBe("r-1");
    expect(view.playback).toBeNull(); // never a fake player
    expect(view.error).toBeNull(); // never an invented error
    // The render WAS created — it stays listed (that part succeeded).
    expect(view.session?.renders.map((r) => r.renderId)).toEqual(["r-1"]);
    // No pending state leak: the view-model hides the id outside the status.
    core.dispatch({ type: "closeSession" });
    expect(core.view().status).toBe("browsing-sessions");
    expect(core.view().pendingRenderId).toBeNull();
  });

  test("outputs-pending is STABLE: dismissError-free flow, and re-selecting re-checks (pending → ready)", async () => {
    const segment = buildHandSegment({ timestamps: [0, 1_000, 2_000] });
    const client = pendingScript();
    const core = createViewerCore({
      client,
      output: scriptOutput({
        loadOutput: [res({ kind: "outputs-pending" }), res({ kind: "animated-segment", segment })],
      }),
      nowMs: () => fakeClock().now(),
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
    await settle();
    expect(core.view().status).toBe("outputs-pending");
    // The user re-selects the render ("check again" — the host step has now
    // stored the segment).
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    expect(core.view().status).toBe("loading-output");
    await settle();
    const view = core.view();
    expect(view.status).toBe("ready");
    expect(view.pendingRenderId).toBeNull();
    // The real W504 path mounted the SEGMENT player (the union view).
    expect(view.playback?.kind).toBe("segment");
    if (view.playback?.kind === "segment") {
      expect(view.playback.frameCount).toBe(3);
      expect(view.playback.durationMs).toBe(3_000);
      expect(view.playback.document).toBe(segment.content);
      expect(view.playback.smil).toEqual({ paused: true, seekMs: 0 });
    }
  });
});

describe("ViewerCore — the W705 segment playback path (the real W504 wiring)", () => {
  test("a segment output mounts the segment player; playback commands drive the declared timeline", async () => {
    const segment = buildHandSegment({ timestamps: [0, 1_000, 2_000] });
    const clock = fakeClock();
    const client = scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [
        res({
          renders: [
            {
              renderId: "r-1",
              rendererId: "anime.prototype",
              segmentCount: 2,
              provenance: { snapshotVersion: 1, lastEventSequence: 0 },
              watermarkAfter: { watermarkMs: 2000, sequence: 0 },
            },
          ],
        }),
      ],
      getRender: [res({ renderId: "r-1", result: renderResult("sess-1", "anime.prototype", 2) })],
    });
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [res({ kind: "animated-segment", segment })] }),
      nowMs: () => clock.now(),
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    await settle();
    expect(core.view().status).toBe("ready");

    core.dispatch({ type: "play" });
    expect(core.view().status).toBe("playing");
    clock.advance(1_500);
    core.dispatch({ type: "tick" });
    let view = core.view();
    expect(view.status).toBe("playing");
    if (view.playback?.kind === "segment") {
      expect(view.playback.positionMs).toBe(1_500);
      expect(view.playback.frameIndex).toBe(1);
    }
    core.dispatch({ type: "pause" });
    expect(core.view().status).toBe("paused");
    core.dispatch({ type: "play" });
    clock.advance(2_000);
    core.dispatch({ type: "tick" });
    view = core.view();
    expect(view.status).toBe("ended");
    core.dispatch({ type: "closePlayback" });
    expect(core.view().status).toBe("session-detail");
    expect(core.view().playback).toBeNull();
  });

  test("a malformed segment (the player's rejection) is a classified load failure", async () => {
    const badSegment = buildHandSegment();
    badSegment.content = "not an svg document";
    const client = scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [
        res({
          renders: [
            {
              renderId: "r-1",
              rendererId: "anime.prototype",
              segmentCount: 2,
              provenance: { snapshotVersion: 1, lastEventSequence: 0 },
              watermarkAfter: { watermarkMs: 2000, sequence: 0 },
            },
          ],
        }),
      ],
      getRender: [res({ renderId: "r-1", result: renderResult("sess-1", "anime.prototype", 2) })],
    });
    const core = createViewerCore({
      client,
      output: scriptOutput({
        loadOutput: [res({ kind: "animated-segment", segment: badSegment })],
      }),
      nowMs: () => fakeClock().now(),
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("error");
    expect(view.error?.failureClass).toBe("media-invalid");
    expect(view.error?.message).toContain("<svg");
    // Fail-closed: no player mounted, the render stays listed.
    expect(view.playback).toBeNull();
    expect(view.session?.renders.map((r) => r.renderId)).toEqual(["r-1"]);
  });
});

describe("ViewerCore — determinism (deep-equal reruns)", () => {
  test("the same command script over the same clock yields a deep-equal trace", async () => {
    async function runScript(): Promise<string[]> {
      const client = happyScript();
      const { core, clock } = makeCore(client);
      const trace: string[] = [];
      core.subscribe((view: ViewerViewModel) => trace.push(JSON.stringify(view)));
      const commands: ViewerCommand[] = [
        { type: "connect" },
        { type: "openSession", sessionId: "sess-1" },
        { type: "beginRender" },
        { type: "createRender", rendererId: "anime.prototype" },
        { type: "play" },
        { type: "seek", positionMs: 500 },
        { type: "stepForward" },
        { type: "setLoop", loop: true },
        { type: "replay" },
        { type: "pause" },
        { type: "closePlayback" },
        { type: "closeSession" },
        { type: "disconnect" },
      ];
      for (const command of commands) {
        core.dispatch(command);
        await settle();
        clock.advance(250);
        core.dispatch({ type: "tick" });
        await settle();
      }
      return trace;
    }
    expect(await runScript()).toEqual(await runScript());
  });
});
