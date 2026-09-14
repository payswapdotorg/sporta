/**
 * ViewerCore telemetry wiring tests (W706): the emitter is wired at the REAL
 * lifecycle moments and every event is observable through an in-memory sink
 * — state transitions (exact subsequence), startup timings on the injected
 * clock (exact arithmetic), error events from the typed error model
 * (verbatim class/message + the remediation hint), playback health from the
 * players' honest seams (rebuffer-stall episodes with the real frame player;
 * integrity-verified on the real W504 segment path), structured user
 * feedback, correlation (opaque sessionId set/cleared), the best-effort
 * guard (a failing sink or an over-bound message NEVER breaks the viewer),
 * and deep-equal determinism ×2.
 */
import { describe, expect, test } from "bun:test";
import { createViewerCore } from "../src/viewer-core.ts";
import type { PlayerFactory } from "../src/viewer-core.ts";
import { createFramePlayer } from "../src/player.ts";
import type { FramePlayer } from "../src/player.ts";
import { createInMemoryTelemetrySink } from "../src/telemetry-sink.ts";
import type { InMemoryTelemetrySink, TelemetrySink } from "../src/telemetry-sink.ts";
import { REMEDIATION_HINTS, TELEMETRY_MESSAGE_MAX_LENGTH } from "../src/telemetry-events.ts";
import type { UserFeedbackKind, ViewerTelemetryEvent } from "../src/telemetry-events.ts";
import { TEST_EPOCH_MS } from "@sporta/testing";
import {
  asFrameOutput,
  buildHandOutput,
  buildHandSegment,
  fakeClock,
  rej,
  res,
  rendererCapability,
  renderResult,
  scriptClient,
  scriptOutput,
  sessionResult,
  sessionSummary,
  viewerFailure,
} from "./helpers.ts";

/** Flushes the microtask queue (scripted promises resolve immediately). */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const HAND_OUTPUT = buildHandOutput([0, 1_000]); // 2 frames, 2000 ms

/** The scripted happy-path client (the viewer-core test convention). */
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

/** A core with an in-memory telemetry sink + the real default players. */
function makeCore(
  client = happyScript(),
  clock = fakeClock(),
  output = scriptOutput({ loadOutput: [res(asFrameOutput(HAND_OUTPUT))] }),
  telemetrySink = createInMemoryTelemetrySink(),
) {
  const core = createViewerCore({
    client,
    output,
    nowMs: () => clock.now(),
    telemetrySink,
  });
  return { core, clock, sink: telemetrySink };
}

/** Compact projection of an event for readable failure messages. */
function kinds(events: readonly ViewerTelemetryEvent[]): string[] {
  return events.map((event) => event.kind);
}

describe("viewer-core telemetry — state transitions at the real moments", () => {
  test("the golden walk emits the exact transition subsequence with sessionId correlation", async () => {
    const { core, sink } = makeCore();
    expect(core.view().telemetry).toEqual({ enabled: true });

    core.dispatch({ type: "connect" });
    expect(core.view().status).toBe("connecting");
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "beginRender" });
    await settle();
    core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
    await settle();

    // Events 1-3 predate the open session (sessionId null); the open lands
    // the correlation id BEFORE its transition event.
    const events = sink.events;
    expect(kinds(events)).toEqual([
      "state-transition",
      "operation-timing",
      "state-transition",
      "state-transition",
      "state-transition",
      "state-transition",
      "state-transition",
      "state-transition",
      "state-transition",
      "operation-timing",
    ]);
    expect(events[0]).toEqual({
      schemaVersion: 1,
      kind: "state-transition",
      sequence: 1,
      atMs: TEST_EPOCH_MS,
      sessionId: null,
      from: "disconnected",
      to: "connecting",
    });
    expect(events[2]).toEqual({
      schemaVersion: 1,
      kind: "state-transition",
      sequence: 3,
      atMs: TEST_EPOCH_MS,
      sessionId: null,
      from: "connecting",
      to: "browsing-sessions",
    });
    expect(events[3]).toEqual({
      schemaVersion: 1,
      kind: "state-transition",
      sequence: 4,
      atMs: TEST_EPOCH_MS,
      sessionId: "sess-1",
      from: "browsing-sessions",
      to: "session-detail",
    });
    expect(events[4]).toEqual({
      schemaVersion: 1,
      kind: "state-transition",
      sequence: 5,
      atMs: TEST_EPOCH_MS,
      sessionId: "sess-1",
      from: "session-detail",
      to: "renderer-selection",
    });
    // createRender begin: renderer-selection → session-detail → render-queued,
    // then loading-output → ready once the output mounts.
    expect(events[5]).toMatchObject({ from: "renderer-selection", to: "session-detail" });
    expect(events[6]).toMatchObject({ from: "session-detail", to: "render-queued" });
    expect(events[7]).toMatchObject({ from: "render-queued", to: "loading-output" });
    expect(events[8]).toMatchObject({ from: "loading-output", to: "ready" });

    // Playback state changes are transitions too (the player mirror).
    core.dispatch({ type: "play" });
    expect(core.view().status).toBe("playing");
    core.dispatch({ type: "pause" });
    expect(core.view().status).toBe("paused");
    expect(kinds(sink.events.slice(-2))).toEqual(["state-transition", "state-transition"]);
    expect(sink.events.at(-2)).toMatchObject({ from: "ready", to: "playing" });
    expect(sink.events.at(-1)).toMatchObject({ from: "playing", to: "paused" });
  });

  test("closing / terminating / disconnecting clears the opaque session correlation", async () => {
    const client = scriptClient({
      listSessions: [
        res({ sessions: [sessionSummary("sess-1")] }),
        res({ sessions: [sessionSummary("sess-1")] }),
      ],
      getSession: [res(sessionResult("sess-1"))],
      listRenders: [res({ renders: [] })],
    });
    const { core, sink } = makeCore(client);
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "closeSession" });
    core.dispatch({ type: "connect" });
    await settle();
    // seq 4 (the open transition) is the last event with the correlation id;
    // closeSession cleared it BEFORE its own transition, and every later
    // event (the reconnect walk) carries null again.
    expect(sink.events[3]?.sessionId).toBe("sess-1");
    for (const event of sink.events.filter((event) => event.sequence > 4)) {
      expect(event.sessionId).toBe(null);
    }
  });

  test("no sink → telemetry disabled marker, and the machine runs identically", async () => {
    const client = happyScript();
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [res(asFrameOutput(HAND_OUTPUT))] }),
      nowMs: () => fakeClock().now(),
    });
    expect(core.view().telemetry).toEqual({ enabled: false });
    core.dispatch({ type: "connect" });
    await settle();
    expect(core.view().status).toBe("browsing-sessions");
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    expect(core.view().status).toBe("session-detail");
    core.dispatch({ type: "sendFeedback", feedback: "playback-good" });
    expect(core.view().status).toBe("session-detail");
  });
});

describe("viewer-core telemetry — startup timing on the injected clock", () => {
  test("connect durationMs is the exact clock delta begin → success", async () => {
    const clock = fakeClock();
    const client = happyScript();
    const sink = createInMemoryTelemetrySink();
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [] }),
      nowMs: () => clock.now(),
      telemetrySink: sink,
    });
    core.dispatch({ type: "connect" });
    clock.advance(250);
    await settle();
    expect(core.view().connectedAtMs).toBe(TEST_EPOCH_MS + 250);
    const timing = sink.events.find((event) => event.kind === "operation-timing");
    expect(timing).toEqual({
      schemaVersion: 1,
      kind: "operation-timing",
      sequence: 2,
      atMs: TEST_EPOCH_MS + 250,
      sessionId: null,
      operation: "connect",
      durationMs: 250,
    });
  });

  test("load-output timing on the selectRender path; NO timing on a failed load", async () => {
    const clock = fakeClock();
    const client = happyScript();
    const client2 = happyScript(); // second walk (the failure leg)
    const sink = createInMemoryTelemetrySink();
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [res(asFrameOutput(HAND_OUTPUT))] }),
      nowMs: () => clock.now(),
      telemetrySink: sink,
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    clock.advance(120);
    await settle();
    const timing = sink.events.filter((event) => event.kind === "operation-timing").at(-1);
    expect(timing).toEqual({
      schemaVersion: 1,
      kind: "operation-timing",
      sequence: 7,
      atMs: TEST_EPOCH_MS + 120,
      sessionId: "sess-1",
      operation: "load-output",
      durationMs: 120,
    });

    // The failure leg: loadOutput rejects → error-occurred, no timing event.
    const sink2 = createInMemoryTelemetrySink();
    const core2 = createViewerCore({
      client: client2,
      output: scriptOutput({
        loadOutput: [rej(viewerFailure("media-invalid", "segment hash mismatch"))],
      }),
      nowMs: () => clock.now(),
      telemetrySink: sink2,
    });
    core2.dispatch({ type: "connect" });
    await settle();
    core2.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core2.dispatch({ type: "selectRender", renderId: "r-1" });
    await settle();
    expect(core2.view().status).toBe("error");
    expect(
      sink2.events.filter(
        (event) => event.kind === "operation-timing" && event.operation === "load-output",
      ),
    ).toHaveLength(0);
    expect(sink2.events.at(-2)?.kind).toBe("error-occurred");
  });
});

describe("viewer-core telemetry — error events from the typed error model", () => {
  test("a classified port failure emits error-occurred BEFORE the error transition, verbatim", async () => {
    const client = happyScript();
    const sink = createInMemoryTelemetrySink();
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [] }),
      nowMs: () => fakeClock().now(),
      telemetrySink: sink,
    });
    core.dispatch({ type: "connect" });
    await settle();
    // A zero-arg function is assignable to the method signature (and keeps
    // eslint's no-unused-vars clean).
    client.getSession = () =>
      Promise.reject(viewerFailure("rights-denied", "session policy does not grant playback"));
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    expect(core.view().status).toBe("error");
    const errorEvent = sink.events.at(-2);
    expect(errorEvent).toEqual({
      schemaVersion: 1,
      kind: "error-occurred",
      sequence: 4,
      atMs: TEST_EPOCH_MS,
      sessionId: null,
      operation: "openSession",
      failureClass: "rights-denied",
      message: "session policy does not grant playback",
      remediationHint: REMEDIATION_HINTS["rights-denied"],
    });
    expect(sink.events.at(-1)).toMatchObject({ kind: "state-transition", to: "error" });
  });

  test("an untyped thrown value surfaces as internal with its message", async () => {
    const client = happyScript();
    const sink = createInMemoryTelemetrySink();
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [] }),
      nowMs: () => fakeClock().now(),
      telemetrySink: sink,
    });
    core.dispatch({ type: "connect" });
    await settle();
    (client as { listSessions: () => Promise<unknown> }).listSessions = () =>
      Promise.reject(new Error("boom inside the client"));
    core.dispatch({ type: "refreshSessions" });
    await settle();
    const errorEvent = sink.events.find((event) => event.kind === "error-occurred");
    expect(errorEvent).toMatchObject({
      operation: "refreshSessions",
      failureClass: "internal",
      message: "boom inside the client",
    });
  });

  test("an over-bound message is DROPPED (counted) — the viewer still reaches the error state", async () => {
    const client = happyScript();
    const sink: InMemoryTelemetrySink = createInMemoryTelemetrySink();
    // A sink wrapper that also counts drops is the emitter's job; here we
    // observe the drop through the sink: the error event never lands.
    const core = createViewerCore({
      client,
      output: scriptOutput({ loadOutput: [] }),
      nowMs: () => fakeClock().now(),
      telemetrySink: sink,
    });
    core.dispatch({ type: "connect" });
    await settle();
    client.getSession = () =>
      Promise.reject(viewerFailure("internal", "x".repeat(TELEMETRY_MESSAGE_MAX_LENGTH + 1)));
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    expect(core.view().status).toBe("error");
    expect(core.view().error?.message.length).toBe(TELEMETRY_MESSAGE_MAX_LENGTH + 1);
    expect(sink.events.filter((event) => event.kind === "error-occurred")).toHaveLength(0);
    // The transition still lands (only the error event was dropped).
    expect(sink.events.at(-1)).toMatchObject({ kind: "state-transition", to: "error" });
  });
});

describe("viewer-core telemetry — playback health from the players' honest seams", () => {
  /** A factory that exposes the real mounted frame player to the test. */
  function exposingFactory(): { factory: PlayerFactory; player(): FramePlayer | null } {
    let exposed: FramePlayer | null = null;
    return {
      factory: (options: { clock: () => number }) => {
        exposed = createFramePlayer(options);
        return exposed;
      },
      player: () => exposed,
    };
  }

  test("rebuffer-stall: one event per (playing && buffering) episode, with the seam's counts", async () => {
    const { factory, player } = exposingFactory();
    const sink = createInMemoryTelemetrySink();
    const clock = fakeClock();
    const core = createViewerCore({
      client: happyScript(),
      output: scriptOutput({
        loadOutput: [
          res({ kind: "frame-sequence", output: { frames: [], manifest: HAND_OUTPUT.manifest } }),
        ],
      }),
      nowMs: () => clock.now(),
      telemetrySink: sink,
      playerFactory: factory,
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    await settle();
    expect(core.view().status).toBe("ready");
    // All frames missing: playing immediately stalls (episode 1).
    core.dispatch({ type: "play" });
    expect(core.view().playback).toMatchObject({ playback: "playing", buffering: true });
    let stalls = sink.events.filter((event) => event.kind === "rebuffer-stall");
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toMatchObject({
      frameIndex: 0,
      frameCount: 2,
      availableFrames: 0,
      sessionId: "sess-1",
    });
    // Repeated ticks while stalled do NOT re-emit (one event per episode).
    clock.advance(300);
    core.dispatch({ type: "tick" });
    clock.advance(300);
    core.dispatch({ type: "tick" });
    expect(sink.events.filter((event) => event.kind === "rebuffer-stall")).toHaveLength(1);

    // Frame 0 arrives: the episode ends.
    const mounted = player();
    if (mounted === null) throw new Error("frame player was never mounted");
    expect(mounted.supplyFrame(HAND_OUTPUT.frames[0]!)).toEqual({ ok: true });
    expect(core.view().playback).toMatchObject({ buffering: false });

    // Playback advances into the missing frame 1: a NEW episode.
    clock.advance(1_500);
    core.dispatch({ type: "tick" });
    stalls = sink.events.filter((event) => event.kind === "rebuffer-stall");
    expect(stalls).toHaveLength(2);
    expect(stalls[1]).toMatchObject({
      frameIndex: 1,
      frameCount: 2,
      availableFrames: 1,
    });
  });

  test("integrity-verified on the real W504 segment path; none on the frame path", async () => {
    const segment = buildHandSegment();
    const sink = createInMemoryTelemetrySink();
    const core = createViewerCore({
      client: happyScript(),
      output: scriptOutput({ loadOutput: [res({ kind: "animated-segment", segment })] }),
      nowMs: () => fakeClock().now(),
      telemetrySink: sink,
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    await settle();
    expect(core.view().status).toBe("ready");
    const integrity = sink.events.filter((event) => event.kind === "integrity-verified");
    expect(integrity).toHaveLength(1);
    expect(integrity[0]).toEqual({
      schemaVersion: 1,
      kind: "integrity-verified",
      sequence: 6,
      atMs: TEST_EPOCH_MS,
      sessionId: "sess-1",
      byteLength: segment.byteLength,
      frameCount: 2,
    });
    // The integrity event sits between the loading-output transition and
    // the mounted/ready transition (the fact is established when the
    // verified segment arrives, before the player mounts), with the load
    // timing closing the sequence.
    expect(sink.events.slice(4).map((event) => event.kind)).toEqual([
      "state-transition",
      "integrity-verified",
      "state-transition",
      "operation-timing",
    ]);
  });

  test("outputs-pending emits the transition + timing, no player, no integrity", async () => {
    const sink = createInMemoryTelemetrySink();
    const core = createViewerCore({
      client: happyScript(),
      output: scriptOutput({ loadOutput: [res({ kind: "outputs-pending" })] }),
      nowMs: () => fakeClock().now(),
      telemetrySink: sink,
    });
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    await settle();
    expect(core.view().status).toBe("outputs-pending");
    expect(sink.events.filter((event) => event.kind === "integrity-verified")).toHaveLength(0);
    expect(sink.events.at(-2)).toMatchObject({ kind: "state-transition", to: "outputs-pending" });
    expect(sink.events.at(-1)).toMatchObject({
      kind: "operation-timing",
      operation: "load-output",
    });
  });
});

describe("viewer-core telemetry — structured user feedback", () => {
  test("sendFeedback records the closed-vocabulary event; an invalid kind is dropped, not thrown", async () => {
    const { core, sink } = makeCore();
    core.dispatch({ type: "connect" });
    await settle();
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    core.dispatch({ type: "sendFeedback", feedback: "playback-stalled" });
    core.dispatch({ type: "sendFeedback", feedback: "playback-good" });
    const feedback = sink.events.filter((event) => event.kind === "user-feedback");
    expect(feedback).toHaveLength(2);
    expect(feedback[0]).toEqual({
      schemaVersion: 1,
      kind: "user-feedback",
      sequence: 5,
      atMs: TEST_EPOCH_MS,
      sessionId: "sess-1",
      feedback: "playback-stalled",
    });
    expect(feedback[1]).toMatchObject({ feedback: "playback-good", sequence: 6 });

    // The view does not change (fire-and-forget affordance).
    expect(core.view().status).toBe("session-detail");

    // A hostile host bypassing the types: counted drop, never a crash.
    expect(() =>
      core.dispatch({
        type: "sendFeedback",
        feedback: "the subtitles were wrong and my name is…" as UserFeedbackKind,
      }),
    ).not.toThrow();
    expect(sink.events.filter((event) => event.kind === "user-feedback")).toHaveLength(2);
  });
});

describe("viewer-core telemetry — best-effort guard (a failing sink never breaks the viewer)", () => {
  test("a throwing sink: every event is counted as a drop and the machine still walks", async () => {
    const calls: number[] = [];
    const exploding: TelemetrySink = {
      record(event) {
        calls.push(event.sequence);
        throw new Error("sink exploded");
      },
    };
    const core = createViewerCore({
      client: happyScript(),
      output: scriptOutput({ loadOutput: [res(asFrameOutput(HAND_OUTPUT))] }),
      nowMs: () => fakeClock().now(),
      telemetrySink: exploding,
    });
    core.dispatch({ type: "connect" });
    await settle();
    expect(core.view().status).toBe("browsing-sessions");
    core.dispatch({ type: "openSession", sessionId: "sess-1" });
    await settle();
    expect(core.view().status).toBe("session-detail");
    core.dispatch({ type: "selectRender", renderId: "r-1" });
    await settle();
    expect(core.view().status).toBe("ready");
    // The machine survived and the sink was invoked for every event
    // (3 connect + 1 open + 1 loading transition + 1 ready transition +
    // 1 load timing — the same event count the in-memory walk pins).
    expect(calls).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(calls).size).toBe(calls.length); // sequences still unique
  });
});

describe("viewer-core telemetry — determinism ×2", () => {
  test("the full scripted story yields a deep-equal event trace across two fresh runs", async () => {
    async function run(): Promise<{ events: string; views: string[] }> {
      const sink = createInMemoryTelemetrySink();
      const clock = fakeClock();
      const views: string[] = [];
      const core = createViewerCore({
        client: happyScript(),
        output: scriptOutput({ loadOutput: [res(asFrameOutput(HAND_OUTPUT))] }),
        nowMs: () => clock.now(),
        telemetrySink: sink,
      });
      core.subscribe((view) => views.push(JSON.stringify(view)));
      core.dispatch({ type: "connect" });
      clock.advance(250);
      await settle();
      core.dispatch({ type: "openSession", sessionId: "sess-1" });
      await settle();
      core.dispatch({ type: "beginRender" });
      await settle();
      core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
      await settle();
      core.dispatch({ type: "play" });
      clock.advance(1_500);
      core.dispatch({ type: "tick" });
      core.dispatch({ type: "pause" });
      core.dispatch({ type: "sendFeedback", feedback: "playback-poor" });
      core.dispatch({ type: "closePlayback" });
      core.dispatch({ type: "disconnect" });
      return { events: JSON.stringify(sink.events), views };
    }
    const first = await run();
    const second = await run();
    expect(first.events).toEqual(second.events);
    expect(first.views).toEqual(second.views);
  });
});
