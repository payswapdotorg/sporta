/**
 * W704 live playback E2E — the REAL chain, headless end-to-end: the viewer
 * state machine consumes a REAL W305 `LoopbackLiveOutputTransport` through
 * the REAL in-process live client (offer → exact-key + zod-grammar
 * validation → answer → attach), presents the delivered frame windows
 * through the live player, and reconnects through the PURE backoff
 * schedule — the acceptance core of W704 ("live output reconnects safely
 * and displays latency/status telemetry appropriate for users").
 *
 * The composition mirrors `web/bootstrap.ts`'s honest boundary: the dev
 * server does NOT bridge live over HTTP, so this file IS the live path the
 * served module graph would run, exercised headlessly (the W705
 * `playback-e2e.test.ts` posture for the batch path). ONE clock is shared
 * by the W305 transport and the viewer core — the in-process seam's
 * latency-domain honesty (`now − emittedAtMs` means the same `now`; see
 * `LIVE.md`).
 *
 * Pinned:
 *
 * - the golden walk: connect → open session → openLive → live-playing with
 *   the validated offer VERBATIM in the view; host-sent windows applied at
 *   the live edge (frame facts, injected-domain latency, never faked),
 *   W305's never-silent accounting identity at every step
 *   (`appliedWindows + skippedWindows === accountedOrdinals`), and the
 *   W706 telemetry spine (state transitions, the timed `openLive`
 *   operation, the user feedback affordance on a live presentation);
 * - THE RECONNECT PATH (the audit's real-bug pin): a connection drop lands
 *   in `live-reconnecting` with the scheduled attempt, the attempt fires on
 *   the tick when due, and NEW windows sent after the drop are APPLIED —
 *   the inherited code had the consumption loop die on the first
 *   post-reconnect pull (a silently frozen live stream; found by probing
 *   the exact `consumeLive`/`nextEvent` interplay over the REAL seams,
 *   fixed in `src/live-client.ts` by completing the suspended pull stream
 *   before answering `null`); each reconnect report is carried verbatim;
 * - the attempt cap: four fired attempts, then the next loss is TERMINAL
 *   (`attempts-exhausted`, named honestly in the error state — never a
 *   fifth attempt, never a retry storm);
 * - fail-closed rights BOTH ways: the core's derived-rights pre-check (no
 *   request ever leaves without `canDeliverLive`) and W305's own gate (a
 *   transport policy without live delivery denies at the offer);
 * - a failed open resets the live section to idle (never a permanent
 *   "connecting" claim — the audit's second fix);
 * - the honest skip accounting: a skip-stale window is accounted as skipped
 *   (degradation surfaced verbatim) and the identity still holds;
 * - one presentation at a time: `openLive` tears down a mounted batch
 *   playback, `selectRender` tears down a mounted live stream;
 * - determinism: the golden live walk's view trace is deep-equal across
 *   two fresh cores + transports.
 *
 * Constitution: no `Date.now`/`Math.random`; every time is a reading of
 * the shared injected clock; `setTimeout(0)` in `settleUntil` is a
 * macrotask yield (loopback pull-chain resolution), not a wall-clock read.
 */
import { describe, expect, test } from "bun:test";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { ManualLiveClock } from "@sporta/webrtc-output";
import { createViewerCore } from "../src/viewer-core.ts";
import type { ViewerCore, ViewerViewModel } from "../src/viewer-core.ts";
import { createInProcessLiveClient } from "../src/live-client.ts";
import { createInMemoryTelemetrySink } from "../src/telemetry-sink.ts";
import type { InMemoryTelemetrySink } from "../src/telemetry-sink.ts";
import type { ControlClient } from "../src/ports.ts";
import {
  asFrameOutput,
  buildHandOutput,
  renderResult,
  rendererCapability,
  res,
  scriptClient,
  scriptOutput,
  sessionResult,
  sessionSummary,
} from "./helpers.ts";
import { captureSessionTransport, liveEmission } from "./live-helpers.ts";
import type { CapturedLiveTransport } from "./live-helpers.ts";

// ---------------------------------------------------------------------------
// The harness: one core over the scripted control plane + a REAL W305
// transport per open (the in-process live client draws a fresh one), ONE
// shared injected clock.
// ---------------------------------------------------------------------------

/**
 * Yields the event loop until the view-model satisfies `predicate` (bounded
 * by `maxYields` macrotask turns — the loopback pull chains resolve within
 * a few).
 */
async function settleUntil(
  core: ViewerCore,
  predicate: (view: ViewerViewModel) => boolean,
  maxYields = 400,
): Promise<ViewerViewModel> {
  for (let i = 0; i < maxYields; i += 1) {
    const view = core.view();
    if (predicate(view)) return view;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return core.view();
}

/** The control-plane script every live walk begins with. */
function liveScript(): ControlClient {
  return scriptClient({
    listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
    getSession: [res(sessionResult("sess-1"))],
    listRenders: [res({ renders: [] })],
    listRenderers: [res({ renderers: [] })],
    createRender: [],
  });
}

/** The harness surface (see {@link makeLiveHarness}). */
interface LiveHarness {
  core: ViewerCore;
  clock: ManualLiveClock;
  sink: InMemoryTelemetrySink;
  /** The host-side handle of the LAST opened transport (null before open). */
  currentHost(): CapturedLiveTransport | null;
}

/**
 * One harness: the core (scripted control plane, in-memory telemetry sink)
 * + the live client whose every open draws a FRESH captured transport.
 */
function makeLiveHarness(
  options: { transportLimits?: { maxWatermarkLagMs: number } } = {},
): LiveHarness {
  const clock = new ManualLiveClock(TEST_EPOCH_MS);
  const sink = createInMemoryTelemetrySink();
  let host: CapturedLiveTransport | null = null;
  const client = createInProcessLiveClient({
    createTransport: () => {
      host = captureSessionTransport({
        sessionId: "sess-1",
        clock,
        ...(options.transportLimits === undefined ? {} : { limits: options.transportLimits }),
      });
      return host.clientTransport;
    },
  });
  const core = createViewerCore({
    client: liveScript(),
    output: scriptOutput({ loadOutput: [res(asFrameOutput(buildHandOutput([0, 1_000])))] }),
    live: client,
    telemetrySink: sink,
    nowMs: () => clock.now(),
  });
  return { core, clock, sink, currentHost: () => host };
}

/** Connects + opens the session, then attaches the live stream. */
async function openLiveWalk(harness: LiveHarness): Promise<ViewerViewModel> {
  harness.core.dispatch({ type: "connect" });
  await settleUntil(harness.core, (v) => v.status === "browsing-sessions");
  harness.core.dispatch({ type: "openSession", sessionId: "sess-1" });
  await settleUntil(harness.core, (v) => v.status === "session-detail");
  harness.core.dispatch({ type: "openLive" });
  const view = await settleUntil(harness.core, (v) => v.status === "live-playing");
  expect(view.status).toBe("live-playing");
  return view;
}

/** The never-silent identity: applied + skipped === accounted (W305's own). */
function expectAccountingBalanced(view: ViewerViewModel): void {
  const live = view.live;
  if (!live.available) throw new Error("expected the live section to be available");
  if (live.accounting === null) throw new Error("expected an accounting snapshot");
  expect(live.accounting.appliedWindows + live.accounting.skippedWindows).toBe(
    live.accounting.accountedOrdinals,
  );
}

/** Narrows the live section + player (fails loud outside tests that mount one). */
function livePlayerOf(view: ViewerViewModel) {
  const live = view.live;
  if (!live.available) throw new Error("expected the live section available");
  if (live.player === null) throw new Error("expected a mounted live player");
  return { live, player: live.player };
}

// ---------------------------------------------------------------------------
// The golden walk
// ---------------------------------------------------------------------------

describe("W704 live e2e — golden walk: open, attach, present, telemetry", () => {
  test("connect → open session → openLive → live-playing; windows apply at the live edge; accounting balances", async () => {
    const harness = makeLiveHarness();
    const view0 = await openLiveWalk(harness);

    // The offer is in the view VERBATIM (the validated document's summary).
    const { live: live0, player: player0 } = livePlayerOf(view0);
    expect(live0.sessionId).toBe("sess-1");
    expect(live0.streamId).toBe("live-sess-1");
    expect(live0.viewerId).toBe("viewer-shell");
    expect(live0.offer).toEqual({
      protocolVersion: "sporta.live-output/v1",
      sessionId: "sess-1",
      streamId: "live-sess-1",
      trackCount: 1,
      profile: {
        resolution: { w: 1170, h: 880 },
        frameRate: 1,
        codec: "svg",
        container: "svg",
        latencyClass: "live",
      },
      sessionControls: {
        backpressurePolicy: "block",
        linkCapacity: 16,
        retransmitRetention: 8,
      },
    });
    // Absent metrics stay absent before the first window.
    expect(player0.frame).toBe(null);
    expect(player0.latencyMs).toBe(null);
    expect(player0.frameCount).toBe(0);
    expect(live0.accounting).toBe(null);

    // The host sends window 0 (2 frames @ the 1 fps cadence, watermark 1000).
    const host = harness.currentHost()!;
    await host.real.sendWindow(
      liveEmission({ sessionId: "sess-1", ordinal: 0, watermarkMs: 1_000 }),
    );
    let view = await settleUntil(
      harness.core,
      (v) => v.live.available && v.live.player !== null && v.live.player.frameCount === 2,
    );
    expectAccountingBalanced(view);
    const { live, player } = livePlayerOf(view);
    // The presentation joined at the live edge (the newest frame).
    expect(player.windowsApplied).toBe(1);
    expect(player.frame).toEqual({ windowOrdinal: 0, frameIndex: 1, timestampMs: 1_000 });
    expect(player.frameSvg).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1170 880"><text x="10" y="20">live w0 f1 @1000ms</text></svg>`,
    );
    expect(player.playheadMs).toBe(1_000);
    expect(player.buffering).toBe(false);
    // Latency is INJECTED-DOMAIN (now − emittedAtMs), never faked: the
    // shared clock has not advanced since the send, so it is exactly 0.
    expect(player.latencyMs).toBe(0);
    expect(live.accounting).toEqual({
      appliedWindows: 1,
      duplicateWindows: 0,
      skippedWindows: 0,
      accountedOrdinals: 1,
      lastAppliedOrdinal: 0,
    });

    // A second window; the playhead keeps up as ticks drive it.
    harness.clock.advance(1_000);
    await host.real.sendWindow(
      liveEmission({ sessionId: "sess-1", ordinal: 1, watermarkMs: 2_000, startMs: 2_000 }),
    );
    view = await settleUntil(
      harness.core,
      (v) => v.live.available && v.live.player !== null && v.live.player.windowsApplied === 2,
    );
    expectAccountingBalanced(view);
    // The new window's frames (@2000/@3000) are buffered AHEAD of the
    // playhead (still at 1000 — nothing but a tick moves it).
    {
      const { player: awaiting } = livePlayerOf(view);
      expect(awaiting.bufferedAhead).toBe(2);
      expect(awaiting.frame).toEqual({ windowOrdinal: 0, frameIndex: 1, timestampMs: 1_000 });
    }
    harness.core.dispatch({ type: "tick" });
    {
      const { player: caughtUp } = livePlayerOf(harness.core.view());
      expect(caughtUp.frame).toEqual({ windowOrdinal: 1, frameIndex: 0, timestampMs: 2_000 });
      // now (EPOCH+1000) − emittedAt (EPOCH+1000 at send time) — the shared
      // clock makes the injected-domain latency exactly checkable.
      expect(caughtUp.latencyMs).toBe(0);
    }
    harness.clock.advance(1_000);
    harness.core.dispatch({ type: "tick" });
    {
      const { player: atEdge } = livePlayerOf(harness.core.view());
      expect(atEdge.frame).toEqual({ windowOrdinal: 1, frameIndex: 1, timestampMs: 3_000 });
      expect(atEdge.latencyMs).toBe(1_000);
    }

    // The W706 telemetry spine: transitions through the live statuses and
    // the TIMED openLive operation.
    const transitions = harness.sink.events
      .filter((event) => event.kind === "state-transition")
      .map((event) => (event.kind === "state-transition" ? `${event.from}→${event.to}` : ""));
    expect(transitions).toContain("session-detail→live-connecting");
    expect(transitions).toContain("live-connecting→live-playing");
    const timing = harness.sink.events.find(
      (event) => event.kind === "operation-timing" && event.operation === "openLive",
    );
    expect(timing).toBeDefined();

    // The user feedback affordance is live-rateable (the W706/W704 seam).
    harness.core.dispatch({ type: "sendFeedback", feedback: "playback-good" });
    await settleUntil(harness.core, (v) => v.status === "live-playing");
    const feedback = harness.sink.events.find((event) => event.kind === "user-feedback");
    expect(feedback).toBeDefined();

    // closeLive: back to the session, the section honestly idle.
    harness.core.dispatch({ type: "closeLive" });
    view = await settleUntil(harness.core, (v) => v.status === "session-detail");
    const closed = view.live;
    if (!closed.available) throw new Error("unreachable");
    expect(closed.state).toBe("idle");
    expect(closed.player).toBe(null);
    expect(closed.sessionId).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// THE RECONNECT PATH (the W704 acceptance core; the audit's real-bug pin)
// ---------------------------------------------------------------------------

describe("W704 live e2e — reconnect safely (drop → schedule → attempt → resume)", () => {
  test("a connection drop lands in live-reconnecting; the attempt fires when due; NEW windows apply afterwards", async () => {
    const harness = makeLiveHarness();
    await openLiveWalk(harness);
    const host = harness.currentHost()!;
    await host.real.sendWindow(
      liveEmission({ sessionId: "sess-1", ordinal: 0, watermarkMs: 1_000 }),
    );
    await settleUntil(
      harness.core,
      (v) => v.live.available && v.live.player !== null && v.live.player.windowsApplied === 1,
    );
    const before = livePlayerOf(harness.core.view());
    expect(before.live.accounting?.appliedWindows).toBe(1);

    // THE DROP: the raw session's disconnect, exactly as a network death
    // would (behind the adapter's back).
    host.session()!.disconnect();
    const dropped = await settleUntil(harness.core, (v) => v.status === "live-reconnecting");
    expect(dropped.status).toBe("live-reconnecting");
    const { live: reconnectView, player } = livePlayerOf(dropped);
    expect(reconnectView.state).toBe("reconnecting");
    // The scheduled first attempt: attempt 1 of 4, 500 ms out, the
    // connection-lost class carried verbatim.
    expect(reconnectView.reconnect).toEqual({
      attempts: 1,
      maxAttempts: 4,
      nextAttemptAtMs: TEST_EPOCH_MS + 500,
      lastFailureClass: "connection-lost",
      lastReport: null,
    });
    // The presentation HOLDS its frame (no fake stall, no teardown).
    expect(player.frame).toEqual({ windowOrdinal: 0, frameIndex: 1, timestampMs: 1_000 });

    // Ticks BEFORE the attempt is due: still reconnecting, nothing fires.
    harness.clock.advance(499);
    harness.core.dispatch({ type: "tick" });
    expect(harness.core.view().status).toBe("live-reconnecting");

    // The attempt fires when due.
    harness.clock.advance(1);
    harness.core.dispatch({ type: "tick" });
    const resumed = await settleUntil(harness.core, (v) => v.status === "live-playing");
    expect(resumed.status).toBe("live-playing");
    const { live: after } = livePlayerOf(resumed);
    expect(after.state).toBe("playing");
    expect(after.reconnect?.attempts).toBe(1);
    expect(after.reconnect?.nextAttemptAtMs).toBe(null);
    expect(after.reconnect?.lastReport).toEqual({
      resumeFromOrdinal: 1,
      replayCount: 0,
      gapSkipped: 0,
    });

    // NEW windows sent after the drop APPLY — THE PIN (the inherited bug
    // froze the presentation here: the restarted pull died on the first
    // post-reconnect nextEvent).
    await host.real.sendWindow(
      liveEmission({ sessionId: "sess-1", ordinal: 1, watermarkMs: 2_000, startMs: 2_000 }),
    );
    const view = await settleUntil(
      harness.core,
      (v) => v.live.available && v.live.player !== null && v.live.player.windowsApplied === 2,
    );
    expectAccountingBalanced(view);
    const { live, player: liveFrame } = livePlayerOf(view);
    expect(liveFrame.windowsApplied).toBe(2);
    // The playhead was HELD during the reconnect (content was not flowing);
    // the new window's frames are buffered ahead of it.
    expect(liveFrame.bufferedAhead).toBe(2);
    expect(liveFrame.frame).toEqual({ windowOrdinal: 0, frameIndex: 1, timestampMs: 1_000 });
    expect(live.accounting).toEqual({
      appliedWindows: 2,
      duplicateWindows: 0,
      skippedWindows: 0,
      accountedOrdinals: 2,
      lastAppliedOrdinal: 1,
    });
    // Ticks drive the playhead onto the resumed stream's newest frame.
    harness.clock.advance(2_000);
    harness.core.dispatch({ type: "tick" });
    expect(livePlayerOf(harness.core.view()).player.frame).toEqual({
      windowOrdinal: 1,
      frameIndex: 1,
      timestampMs: 3_000,
    });
    // The reconnect transitions are telemetry events.
    const transitions = harness.sink.events
      .filter((event) => event.kind === "state-transition")
      .map((event) => (event.kind === "state-transition" ? `${event.from}→${event.to}` : ""));
    expect(transitions).toContain("live-playing→live-reconnecting");
    expect(transitions).toContain("live-reconnecting→live-playing");
  });

  test("closing the live view mid-reconnect cancels the pending attempt (never fires after teardown)", async () => {
    const harness = makeLiveHarness();
    await openLiveWalk(harness);
    const host = harness.currentHost()!;
    await host.real.sendWindow(
      liveEmission({ sessionId: "sess-1", ordinal: 0, watermarkMs: 1_000 }),
    );
    await settleUntil(
      harness.core,
      (v) => v.live.available && v.live.player !== null && v.live.player.windowsApplied === 1,
    );
    host.session()!.disconnect();
    await settleUntil(harness.core, (v) => v.status === "live-reconnecting");

    // closeLive during the window: back to the session, section idle.
    harness.core.dispatch({ type: "closeLive" });
    const view = await settleUntil(harness.core, (v) => v.status === "session-detail");
    const closed = view.live;
    if (!closed.available) throw new Error("unreachable");
    expect(closed.state).toBe("idle");
    expect(closed.reconnect).toBe(null);

    // The pending attempt never fires (ticks are no-ops now).
    harness.clock.advance(10_000);
    harness.core.dispatch({ type: "tick" });
    expect(harness.core.view().status).toBe("session-detail");

    // A fresh open draws a FRESH transport (the per-open lifetime rule)
    // and plays again.
    harness.core.dispatch({ type: "openLive" });
    const reopened = await settleUntil(harness.core, (v) => v.status === "live-playing");
    expect(reopened.status).toBe("live-playing");
    const fresh = harness.currentHost()!;
    expect(fresh).not.toBe(host);
    await fresh.real.sendWindow(
      liveEmission({ sessionId: "sess-1", ordinal: 0, watermarkMs: 1_000 }),
    );
    const applied = await settleUntil(
      harness.core,
      (v) => v.live.available && v.live.player !== null && v.live.player.windowsApplied === 1,
    );
    expectAccountingBalanced(applied);
  });
});

// ---------------------------------------------------------------------------
// The attempt cap (bounded reconnects — never a retry storm)
// ---------------------------------------------------------------------------

describe("W704 live e2e — the attempt cap: 4 fired attempts, then the honest terminal", () => {
  test("repeated drops consume the schedule; the loss after the 4th fired attempt is terminal attempts-exhausted", async () => {
    const harness = makeLiveHarness();
    await openLiveWalk(harness);
    const host = harness.currentHost()!;
    await host.real.sendWindow(
      liveEmission({ sessionId: "sess-1", ordinal: 0, watermarkMs: 1_000 }),
    );
    await settleUntil(
      harness.core,
      (v) => v.live.available && v.live.player !== null && v.live.player.windowsApplied === 1,
    );

    // The schedule's delays (500/1000/2000/4000): fire all 4 attempts.
    const delays = [500, 1_000, 2_000, 4_000];
    for (let index = 0; index < delays.length; index += 1) {
      const delay = delays[index]!;
      host.session()!.disconnect();
      const reconnecting = await settleUntil(harness.core, (v) => v.status === "live-reconnecting");
      const { live: rv } = livePlayerOf(reconnecting);
      expect(rv.reconnect?.nextAttemptAtMs).toBe(harness.clock.now() + delay);
      harness.clock.advance(delay);
      harness.core.dispatch({ type: "tick" });
      const resumed = await settleUntil(harness.core, (v) => v.status === "live-playing");
      const { live: after } = livePlayerOf(resumed);
      expect(after.reconnect?.attempts).toBe(index + 1);
    }

    // The FIFTH loss: terminal immediately — no window, no 5th attempt.
    host.session()!.disconnect();
    const terminal = await settleUntil(harness.core, (v) => v.status === "error");
    expect(terminal.status).toBe("error");
    expect(terminal.error).not.toBeNull();
    const error = terminal.error!;
    expect(error.failureClass).toBe("network");
    expect(error.operation).toBe("openLive");
    expect(error.message).toContain("attempts-exhausted");
    expect(error.message).toContain("4 reconnect attempts");
    expect(error.retryable).toBe(true); // a user-initiated fresh open, never a storm
    // The structured evidence of the terminal state: the retryable-family
    // W305 class standing in for the CLASSLESS connection loss, the class
    // that actually triggered the window, and the fired count (the
    // honest-evidence completion — pinned).
    expect(error.details).toEqual({
      liveFailureClass: "transport-failed",
      triggeringFailureClass: "connection-lost",
      attempts: 4,
    });
    // The live section is torn down honestly (idle, no player, no window).
    const live = terminal.live;
    if (!live.available) throw new Error("unreachable");
    expect(live.state).toBe("idle");
    expect(live.reconnect).toBe(null);
    expect(live.player).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed rights (both gates) + the failed-open reset
// ---------------------------------------------------------------------------

describe("W704 live e2e — fail-closed rights on both sides of the seam", () => {
  test("a session without canDeliverLive never sends a request (no transport drawn)", async () => {
    const clock = new ManualLiveClock(TEST_EPOCH_MS);
    let draws = 0;
    // The transport factory would draw a REAL transport — the test asserts
    // it is NEVER called (the rights pre-check fires first).
    const client = createInProcessLiveClient({
      createTransport: () => {
        draws += 1;
        return captureSessionTransport({ sessionId: "sess-1", clock }).clientTransport;
      },
    });
    // A session document whose derived rights LACK live delivery.
    const detail = sessionResult("sess-1");
    detail.rightsCapabilities.canDeliverLive = false;
    const control = scriptClient({
      listSessions: [res({ sessions: [sessionSummary("sess-1")] })],
      getSession: [res(detail)],
      listRenders: [res({ renders: [] })],
    });
    const core = createViewerCore({
      client: control,
      output: scriptOutput({ loadOutput: [res(asFrameOutput(buildHandOutput([0, 1_000])))] }),
      live: client,
      telemetrySink: createInMemoryTelemetrySink(),
      nowMs: () => clock.now(),
    });
    core.dispatch({ type: "connect" });
    await settleUntil(core, (v) => v.status === "browsing-sessions");
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settleUntil(core, (v) => v.status === "session-detail");
    core.dispatch({ type: "openLive" });
    const view = await settleUntil(core, (v) => v.status === "error");
    expect(view.error?.failureClass).toBe("rights-denied");
    expect(view.error?.retryable).toBe(false); // never a retry storm on denial
    expect(view.error?.message).toContain("canDeliverLive");
    expect(draws).toBe(0); // the request never left the viewer
    const live = view.live;
    if (!live.available) throw new Error("unreachable");
    expect(live.state).toBe("idle");
  });

  test("W305's own gate denies at the offer when the transport policy lacks live delivery (the open fails; the section resets to idle)", async () => {
    // The control-plane rights PASS but the W305 host-side policy denies —
    // both gates are real and independent; the adapter maps the typed
    // rights error and the failed open leaves NO stale connecting state.
    const clock = new ManualLiveClock(TEST_EPOCH_MS);
    const sink = createInMemoryTelemetrySink();
    const made = captureSessionTransport({
      sessionId: "sess-1",
      clock,
      policy: {
        policyId: "policy-no-live-e2e",
        allowedOperations: ["analysis"],
        assertedBy: "sporta-w704-test",
      },
    });
    const core = createViewerCore({
      client: liveScript(),
      output: scriptOutput({ loadOutput: [res(asFrameOutput(buildHandOutput([0, 1_000])))] }),
      live: createInProcessLiveClient({ createTransport: () => made.clientTransport }),
      telemetrySink: sink,
      nowMs: () => clock.now(),
    });
    core.dispatch({ type: "connect" });
    await settleUntil(core, (v) => v.status === "browsing-sessions");
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settleUntil(core, (v) => v.status === "session-detail");
    core.dispatch({ type: "openLive" });
    const view = await settleUntil(core, (v) => v.status === "error");
    expect(view.error?.failureClass).toBe("rights-denied");
    expect(view.error?.details.liveFailureClass).toBe("rights-denied");
    // THE AUDIT PIN: the section is IDLE, not stuck "connecting" (the
    // inherited code left liveSection === "connecting" after a failed open).
    const live = view.live;
    if (!live.available) throw new Error("unreachable");
    expect(live.state).toBe("idle");
    expect(live.sessionId).toBe(null);
    expect(live.player).toBe(null);
    // The honest error is a W706 event.
    expect(sink.events.some((event) => event.kind === "error-occurred")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The never-silent accounting backstop (a real skipped window)
// ---------------------------------------------------------------------------

describe("W704 live e2e — accounting: skips are counted, the identity always balances", () => {
  test("windows gone stale during a disconnect are accounted as skipped at resume; applied + skipped === accounted", async () => {
    // The honest degradation composition: while THIS viewer is
    // disconnected the host keeps emitting (the stream lives on); by the
    // time the pull resumes, the older windows are more than the
    // `maxWatermarkLagMs` budget (2s) behind the observed head, so W305
    // skips them AT DELIVERY — each skip is a counted `window-skipped`
    // event the viewer accounts, never a silent loss.
    const harness = makeLiveHarness({ transportLimits: { maxWatermarkLagMs: 2_000 } });
    await openLiveWalk(harness);
    const host = harness.currentHost()!;

    // THE DROP.
    host.session()!.disconnect();
    await settleUntil(harness.core, (v) => v.status === "live-reconnecting");

    // The host keeps sending while the viewer is away: watermarks 1_000
    // through 12_000 (12 windows — within the link capacity, all admitted).
    for (let ordinal = 0; ordinal < 12; ordinal += 1) {
      const watermarkMs = (ordinal + 1) * 1_000;
      await host.real.sendWindow(
        liveEmission({
          sessionId: "sess-1",
          ordinal,
          watermarkMs,
          startMs: watermarkMs - 1_000,
        }),
      );
    }

    // The attempt fires; the pull resumes and delivers the backlog in
    // order. Windows more than 2s behind the head (watermarks 1_000..9_000)
    // arrive as `window-skipped`; the fresh tail (10_000..12_000) applies.
    // Every emitted view is recorded: the degradation reason must surface
    // WHILE the stream is degraded, then clear on recovery (W305's own
    // recover-if-caught-up semantics).
    const seenDegradationReasons: string[][] = [];
    const unsubscribe = harness.core.subscribe((v) => {
      if (v.live.available) seenDegradationReasons.push([...v.live.degradationReasons]);
    });
    harness.clock.advance(500);
    harness.core.dispatch({ type: "tick" });
    const view = await settleUntil(
      harness.core,
      (v) =>
        v.live.available &&
        v.live.accounting !== null &&
        v.live.accounting.accountedOrdinals === 12,
    );
    unsubscribe();
    expectAccountingBalanced(view);
    const { live, player } = livePlayerOf(view);
    expect(live.accounting).toEqual({
      appliedWindows: 3,
      duplicateWindows: 0,
      skippedWindows: 9,
      accountedOrdinals: 12,
      lastAppliedOrdinal: 11,
    });
    // The presentation holds content through the drop and shows the tail.
    expect(player.windowsApplied).toBe(3);
    expect(player.frameCount).toBe(6);
    // The degradation surfaced VERBATIM while degraded (W305's own
    // vocabulary) and cleared once the fresh tail was delivered.
    expect(seenDegradationReasons.some((reasons) => reasons.includes("skip-stale"))).toBe(true);
    expect(live.degradationReasons).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// One presentation at a time (the machine's honest shape)
// ---------------------------------------------------------------------------

describe("W704 live e2e — one presentation at a time", () => {
  test("openLive tears down a mounted batch playback; selectRender tears down a mounted live stream", async () => {
    // The full control-plane script for BOTH presentations (batch + live).
    const clock = new ManualLiveClock(TEST_EPOCH_MS);
    let host: CapturedLiveTransport | null = null;
    const control = scriptClient({
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
    const core = createViewerCore({
      client: control,
      output: scriptOutput({
        loadOutput: [
          res(asFrameOutput(buildHandOutput([0, 1_000]))),
          res(asFrameOutput(buildHandOutput([0, 1_000]))),
        ],
      }),
      live: createInProcessLiveClient({
        createTransport: () => {
          host = captureSessionTransport({ sessionId: "sess-1", clock });
          return host.clientTransport;
        },
      }),
      telemetrySink: createInMemoryTelemetrySink(),
      nowMs: () => clock.now(),
    });
    core.dispatch({ type: "connect" });
    await settleUntil(core, (v) => v.status === "browsing-sessions");
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settleUntil(core, (v) => v.status === "session-detail");
    core.dispatch({ type: "beginRender" });
    await settleUntil(core, (v) => v.status === "renderer-selection");
    core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
    const playing = await settleUntil(core, (v) => v.status === "ready" || v.status === "error");
    expect(playing.status).toBe("ready");
    expect(playing.playback).not.toBeNull();

    // openLive: the batch playback is torn down; the live section mounts.
    core.dispatch({ type: "openLive" });
    const liveView = await settleUntil(core, (v) => v.status === "live-playing");
    expect(liveView.playback).toBe(null);
    const liveSection = liveView.live;
    if (!liveSection.available) throw new Error("unreachable");
    expect(liveSection.state).toBe("playing");

    // selectRender: the live stream is torn down; the batch playback mounts.
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    const batchView = await settleUntil(core, (v) => v.status === "ready" || v.status === "error");
    expect(batchView.status).toBe("ready");
    expect(batchView.playback).not.toBeNull();
    const after = batchView.live;
    if (!after.available) throw new Error("unreachable");
    expect(after.state).toBe("idle");
    expect(after.player).toBe(null);
    expect(host).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Determinism (the same script over fresh cores/transports)
// ---------------------------------------------------------------------------

describe("W704 live e2e — determinism", () => {
  test("the golden live walk's view trace is deep-equal across two fresh cores + transports", async () => {
    async function trace(): Promise<string[]> {
      const harness = makeLiveHarness();
      const views: string[] = [];
      const unsubscribe = harness.core.subscribe((view) => {
        views.push(JSON.stringify(view));
      });
      await openLiveWalk(harness);
      const host = harness.currentHost()!;
      await host.real.sendWindow(
        liveEmission({ sessionId: "sess-1", ordinal: 0, watermarkMs: 1_000 }),
      );
      await settleUntil(
        harness.core,
        (v) => v.live.available && v.live.player !== null && v.live.player.windowsApplied === 1,
      );
      harness.clock.advance(1_500);
      harness.core.dispatch({ type: "tick" });
      harness.core.dispatch({ type: "closeLive" });
      await settleUntil(harness.core, (v) => v.status === "session-detail");
      unsubscribe();
      return views;
    }

    const first = await trace();
    const second = await trace();
    expect(second).toEqual(first);
    // The trace is non-trivial (the walk actually emitted views).
    expect(first.length).toBeGreaterThan(5);
  });
});
