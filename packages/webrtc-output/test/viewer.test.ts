/**
 * `LiveViewerSession` + `createEndpoint` (W305) — the viewer-side consumption
 * contract, verified INDEPENDENTLY of the loopback transport: the session is
 * constructed over the `LiveViewerTransportBinding` interface (the seam a
 * real WebRTC data channel satisfies), so these tests drive a SCRIPTED
 * binding — pre-authored delivery events, recorded calls — and pin the
 * session's own guarantees: idempotent application (the Recovery rule),
 * in-order windows, exactly-once ordinal accounting, the defense-in-depth
 * integrity check, reconnect-gap accounting, the single-pull-stream rule,
 * and the terminal latch.
 */
import { describe, expect, test } from "bun:test";
import { LiveOutputIntegrityError, LiveOutputProtocolError } from "../src/errors";
import { LiveViewerSession, createEndpoint } from "../src/viewer";
import type {
  LiveOutputEndpoint,
  LiveOutputHostWiring,
  LiveViewerSessionOptions,
} from "../src/viewer";
import type { LiveViewerTransportBinding, LiveReconnectReport } from "../src/transport";
import type { LiveSessionPhase } from "../src/state";
import type { LiveDeliveryEvent, LiveOutputStats } from "../src/types";
import { ManualLiveClock, emptyLiveStats } from "../src/types";
import { buildLiveFrameWindow } from "../src/window";
import { fixtureEmission } from "./helpers";

// ---------------------------------------------------------------------------
// The scripted binding (the seam a real WebRTC implementation satisfies)
// ---------------------------------------------------------------------------

/** Everything the scripted binding records (call evidence for asserts). */
interface BindingCalls {
  disconnects: number;
  reconnects: number[];
  integrityConflicts: string[];
}

/** A binding over a pre-authored event queue + call recording. */
function scriptedBinding(options: { events: LiveDeliveryEvent[]; phase?: LiveSessionPhase }): {
  binding: LiveViewerTransportBinding;
  calls: BindingCalls;
} {
  const queue = [...options.events];
  const calls: BindingCalls = { disconnects: 0, reconnects: [], integrityConflicts: [] };
  const clock = new ManualLiveClock(1_000);
  let disconnected = false;
  const binding: LiveViewerTransportBinding = {
    pullNext: async () => {
      // Faithful to the real transport: a disconnected viewer is told so
      // FIRST, before any queued event is served.
      if (disconnected) return { kind: "connection-lost" };
      const next = queue.shift();
      if (next === undefined) {
        // Park like a real transport would: a promise that never settles
        // (typed `never` — the queue is the only wake source).
        return await new Promise<never>(() => {});
      }
      return next;
    },
    reconnect: (resumeFromOrdinal: number): LiveReconnectReport => {
      calls.reconnects.push(resumeFromOrdinal);
      disconnected = false;
      return { resumeFromOrdinal, replayCount: 0, gapSkipped: 0 };
    },
    disconnect: () => {
      calls.disconnects += 1;
      disconnected = true;
    },
    reportIntegrityConflict: (window) => {
      calls.integrityConflicts.push(window.windowId);
    },
    linkDepth: () => 0,
    latestObservedWatermark: () => null,
    phase: () => options.phase ?? "established",
    degradationReasons: () => [],
    terminal: () => null,
    liveStats: (): LiveOutputStats => emptyLiveStats(),
    clock: () => clock,
  };
  return { binding, calls };
}

/** A real, verified envelope for one emission (tamperable per test). */
function windowEvent(ordinal: number, watermarkMs: number): LiveDeliveryEvent {
  const emission = fixtureEmission({ ordinal, watermarkMs });
  const envelope = buildLiveFrameWindow(emission, {
    streamId: "live-s",
    ordinal,
    emittedAtMs: 500,
  });
  return {
    kind: "window",
    window: envelope.window,
    payload: envelope.payload,
    redelivered: false,
    timing: {
      emittedAtMs: 500,
      admittedAtMs: 600,
      deliveredAtMs: 700,
      transitLagMs: 100,
      deliveryLagMs: 200,
      linkDepthAtEmission: 0,
      watermarkLagAtDeliveryMs: 0,
    },
  };
}

/** The default session options (deterministic identity). */
function sessionOptions(): LiveViewerSessionOptions {
  return { viewerId: "viewer-7", streamId: "live-s", sessionId: "sess-live-out" };
}

/** Builds one session over a scripted binding (the common wiring). */
function scriptedSession(options: { events: LiveDeliveryEvent[]; phase?: LiveSessionPhase }): {
  session: LiveViewerSession;
  calls: BindingCalls;
} {
  const { binding, calls } = scriptedBinding(options);
  return { session: new LiveViewerSession(binding, sessionOptions()), calls };
}

// ---------------------------------------------------------------------------
// Idempotent application + accounting (the consumer never-silent identity)
// ---------------------------------------------------------------------------

describe("idempotent, in-order application", () => {
  test("windows apply once; a re-delivery under a stable id is a counted duplicate", async () => {
    const first = windowEvent(0, 1_000);
    const again = {
      ...(first as Extract<LiveDeliveryEvent, { kind: "window" }>),
      redelivered: true,
    };
    const { session } = scriptedSession({ events: [first, again] });

    const iterator = session.events();
    const eventA = (await iterator.next()).value;
    const eventB = (await iterator.next()).value;
    expect(eventA?.kind).toBe("window");
    expect(eventB?.kind).toBe("window");

    const status = session.status();
    expect(status.appliedWindows).toBe(1);
    expect(status.duplicateWindows).toBe(1);
    expect(status.accountedOrdinals).toBe(1);
    expect(status.lastAppliedOrdinal).toBe(0);
    // The applied record keeps the transport's timing verbatim.
    expect(session.applied()[0]!.deliveryTiming).toEqual(
      (first as Extract<LiveDeliveryEvent, { kind: "window" }>).timing,
    );
    // The presentation plan derives from the payload's OWN timestamps.
    expect(session.applied()[0]!.presentation).toEqual(
      (first as Extract<LiveDeliveryEvent, { kind: "window" }>).payload.frames.map((frame) => ({
        frameIndex: frame.frameIndex,
        outputTimestampMs: frame.outputTimestampMs,
      })),
    );
    await iterator.return?.();
  });

  test("an out-of-order window is a typed protocol violation (fail-loud)", async () => {
    const { session } = scriptedSession({ events: [windowEvent(3, 4_000), windowEvent(1, 2_000)] });
    const iterator = session.events();
    await iterator.next(); // ordinal 3 applies
    await expect(iterator.next()).rejects.toBeInstanceOf(LiveOutputProtocolError);
  });

  test("a re-accounted ordinal under a NEW id is a double-accounting violation", async () => {
    const { session } = scriptedSession({ events: [windowEvent(0, 1_000), windowEvent(0, 5_000)] });
    const iterator = session.events();
    await iterator.next(); // ordinal 0 applies (watermark 1000)
    // A DIFFERENT window id claiming the SAME ordinal: not a duplicate — a
    // lying transport. Fail loud, never a silent double-apply.
    await expect(iterator.next()).rejects.toBeInstanceOf(LiveOutputProtocolError);
    expect(session.status().appliedWindows).toBe(1);
  });

  test("a window-skipped event twice for one ordinal is a violation", async () => {
    const skip: LiveDeliveryEvent = {
      kind: "window-skipped",
      ordinal: 0,
      windowId: "w-0",
      watermark: { watermarkMs: 1_000, sequence: 1 },
      reason: "skipped-stale",
    };
    const { session } = scriptedSession({ events: [skip, { ...skip }] });
    const iterator = session.events();
    await iterator.next();
    await expect(iterator.next()).rejects.toBeInstanceOf(LiveOutputProtocolError);
  });

  test("window-skipped events account their ordinals exactly once", async () => {
    const skipA: LiveDeliveryEvent = {
      kind: "window-skipped",
      ordinal: 0,
      windowId: "w-0",
      watermark: { watermarkMs: 1_000, sequence: 1 },
      reason: "link-evicted",
    };
    const skipB: LiveDeliveryEvent = {
      kind: "window-skipped",
      ordinal: 1,
      windowId: "w-1",
      watermark: { watermarkMs: 2_000, sequence: 2 },
      reason: "skipped-stale",
      lagMs: 900,
    };
    const { session } = scriptedSession({ events: [skipA, skipB, windowEvent(2, 3_000)] });
    const iterator = session.events();
    await iterator.next();
    await iterator.next();
    await iterator.next();
    const status = session.status();
    expect(status.appliedWindows).toBe(1);
    expect(status.skippedWindows).toBe(2);
    expect(status.accountedOrdinals).toBe(3);
    await iterator.return?.();
  });
});

// ---------------------------------------------------------------------------
// Reconnect-gap accounting (unseen ordinals are skips, seen ones are no-ops)
// ---------------------------------------------------------------------------

describe("reconnect-gap accounting", () => {
  test("gap ordinals never seen are counted skipped; already-seen ones are not", async () => {
    const { session } = scriptedSession({
      events: [
        windowEvent(0, 1_000),
        windowEvent(1, 2_000),
        {
          kind: "reconnect-gap",
          fromOrdinal: 0,
          toOrdinal: 4,
          skippedCount: 4,
        },
        windowEvent(4, 5_000),
      ],
    });
    const iterator = session.events();
    await iterator.next(); // window 0
    await iterator.next(); // window 1
    await iterator.next(); // the gap: [0,4) — 0 and 1 seen, 2 and 3 unseen
    await iterator.next(); // window 4
    const status = session.status();
    expect(status.appliedWindows).toBe(3);
    expect(status.skippedWindows).toBe(2); // ordinals 2 and 3 only
    expect(status.accountedOrdinals).toBe(5); // {0,1,2,3,4} — the identity
    expect(status.appliedWindows + status.skippedWindows).toBe(status.accountedOrdinals);
    await iterator.return?.();
  });
});

// ---------------------------------------------------------------------------
// The defense-in-depth integrity check (the viewer verifies too)
// ---------------------------------------------------------------------------

describe("the viewer-side integrity boundary (defense in depth)", () => {
  test("a tampered payload fails loud and reports the conflict to the transport", async () => {
    const event = windowEvent(0, 1_000) as Extract<LiveDeliveryEvent, { kind: "window" }>;
    // Tamper the payload AFTER the window was built: the declared hashes no
    // longer match the payload's own bytes.
    event.payload.frames[0]!.svg = "<svg>tampered in transit</svg>";
    const { session, calls } = scriptedSession({ events: [event] });
    const iterator = session.events();
    await expect(iterator.next()).rejects.toBeInstanceOf(LiveOutputIntegrityError);
    // The transport was told (its own fail-terminal seam).
    expect(calls.integrityConflicts).toEqual([event.window.windowId]);
    // Nothing was applied — never a presented corrupted frame.
    expect(session.status().appliedWindows).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Connection lifecycle + the terminal latch
// ---------------------------------------------------------------------------

describe("connection lifecycle + the terminal latch", () => {
  test("connection-lost ends the stream reconnectably; reconnect delegates to the binding", async () => {
    const { session, calls } = scriptedSession({
      events: [windowEvent(0, 1_000)],
    });
    const iterator = session.events();
    const applied = (await iterator.next()).value;
    expect(applied?.kind).toBe("window");
    // The consumer drops the connection: the binding knows, the session ends
    // its stream with connection-lost on the next pull.
    session.disconnect();
    expect(session.connected).toBe(false);
    await iterator.return?.();
    const again = await session.events().next();
    expect(again.value).toEqual({ kind: "connection-lost" });
    // Reconnect: the binding's report, the connection live again.
    const report = session.reconnect(0);
    expect(report).toEqual({ resumeFromOrdinal: 0, replayCount: 0, gapSkipped: 0 });
    expect(calls.reconnects).toEqual([0]);
    expect(calls.disconnects).toBe(1);
    expect(session.connected).toBe(true);
  });

  test("disconnect() delegates to the binding exactly once (idempotent)", () => {
    const { session, calls } = scriptedSession({ events: [] });
    session.disconnect();
    session.disconnect();
    expect(calls.disconnects).toBe(1);
    expect(session.connected).toBe(false);
  });

  test("session-closed latches terminally: later events() replays it and nothing else", async () => {
    const { session } = scriptedSession({
      events: [{ kind: "session-closed", outcome: "failed", failureClass: "rights-lapsed" }],
    });
    const stream = session.events();
    const first = await stream.next();
    expect(first.value).toEqual({
      kind: "session-closed",
      outcome: "failed",
      failureClass: "rights-lapsed",
    });
    expect(session.terminated).toBe(true);
    // The latched event replays ONCE on the next open, then the stream ends.
    const replay = session.events();
    const replayed = await replay.next();
    expect(replayed.value).toEqual(first.value);
    const ended = await replay.next();
    expect(ended.done).toBe(true);
    // Reconnect on a terminal session is a typed violation.
    expect(() => session.reconnect(0)).toThrow(LiveOutputProtocolError);
  });

  test("only ONE pull stream may be active at a time", async () => {
    const { session } = scriptedSession({
      events: [windowEvent(0, 1_000), windowEvent(1, 2_000)],
    });
    const first = session.events();
    await first.next(); // the first stream is now active (pulling = true)
    await expect(session.events().next()).rejects.toBeInstanceOf(LiveOutputProtocolError);
    await first.return?.(); // releasing re-enables
    const reopened = session.events();
    const applied = await reopened.next();
    expect(applied.value?.kind).toBe("window");
    await reopened.return?.();
  });
});

// ---------------------------------------------------------------------------
// The endpoint (connect gating over the binding's phase)
// ---------------------------------------------------------------------------

describe("createEndpoint (the connect gate)", () => {
  function endpointOver(phase: LiveSessionPhase): {
    endpoint: LiveOutputEndpoint;
    attached: number[];
  } {
    const attached: number[] = [];
    const host: LiveOutputHostWiring = {
      streamId: "live-s",
      sessionId: "sess-live-out",
      attachViewer: () => {
        attached.push(attached.length);
      },
    };
    const { binding } = scriptedBinding({ events: [], phase });
    return { endpoint: createEndpoint(host, binding, "viewer-9"), attached };
  }

  test("connect() before establishment is a typed protocol error", () => {
    const { endpoint, attached } = endpointOver("negotiating");
    expect(() => endpoint.connect()).toThrow(LiveOutputProtocolError);
    expect(attached).toHaveLength(0);
  });

  test("connect() attaches the viewer; a second live connection refuses", () => {
    const { endpoint, attached } = endpointOver("established");
    const session = endpoint.connect();
    expect(attached).toHaveLength(1);
    expect(session.connected).toBe(true);
    expect(() => endpoint.connect()).toThrow(LiveOutputProtocolError);
    // Disconnect, then connect again: the SAME session object, re-attached.
    session.disconnect();
    const reconnected = endpoint.connect();
    expect(reconnected).toBe(session);
    expect(attached).toHaveLength(2);
  });
});
