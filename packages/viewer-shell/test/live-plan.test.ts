/**
 * Live plan tests (W704): the PURE status-surface decision module — every
 * section state's headline/status line, the accounting line from W305's
 * verbatim receipts (absent before the first snapshot), the degradation
 * line, the reconnect countdown (the schedule's own numbers, "now" when
 * due), the terminal outcome line, and purity (deep-equal reruns,
 * absent-metrics-absent).
 */
import { describe, expect, test } from "bun:test";
import { liveStatusPlan } from "../src/live-plan.ts";
import { LIVE_UNAVAILABLE_NOTE } from "../src/viewer-core.ts";
import type { LiveView } from "../src/viewer-core.ts";
import type { LivePlayerViewModel } from "../src/live-player.ts";
import { LIVE_RECONNECT_MAX_ATTEMPTS } from "../src/live-backoff.ts";

const LIVE_PLAYER: LivePlayerViewModel = {
  kind: "live",
  buffering: false,
  playheadMs: 4_000,
  frame: { windowOrdinal: 3, frameIndex: 1, timestampMs: 4_000 },
  frameSvg: "<svg>live-1</svg>",
  frameCount: 8,
  bufferedAhead: 3,
  windowsApplied: 4,
  frameIntervalMs: 1_000,
  liveEdgeMs: 7_000,
  latencyMs: 120,
  lastDisplayedFrame: 7,
};

/** A deterministic available live view (fields overridden per test). */
function liveOf(overrides: Partial<Extract<LiveView, { available: true }>>): LiveView {
  return {
    available: true,
    state: "playing",
    sessionId: "sess-1",
    streamId: "live-sess-1",
    offer: {
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
    },
    viewerId: "viewer-shell",
    player: LIVE_PLAYER,
    accounting: {
      appliedWindows: 4,
      duplicateWindows: 0,
      skippedWindows: 1,
      accountedOrdinals: 5,
      lastAppliedOrdinal: 3,
    },
    degradationReasons: [],
    reconnect: null,
    outcome: null,
    ...overrides,
  };
}

describe("liveStatusPlan — the unavailable branch (the honest note)", () => {
  test("without a live client the plan is the note and nothing else", () => {
    const plan = liveStatusPlan({ available: false, note: LIVE_UNAVAILABLE_NOTE }, 0);
    expect(plan).toEqual({
      headline: "Live output",
      statusText: LIVE_UNAVAILABLE_NOTE,
      accountingText: null,
      degradationText: null,
      reconnectHint: null,
      outcomeText: null,
      canClose: false,
    });
  });
});

describe("liveStatusPlan — every section state (headline + status line)", () => {
  test("idle: the open invitation", () => {
    const plan = liveStatusPlan(
      liveOf({ state: "idle", player: null, offer: null, accounting: null }),
      0,
    );
    expect(plan.headline).toBe("Live output");
    expect(plan.statusText).toBe("Not connected — open the live stream for this session.");
    expect(plan.canClose).toBe(false);
    expect(plan.accountingText).toBe(null);
  });

  test("connecting: the honest wait for the offer", () => {
    const plan = liveStatusPlan(
      liveOf({ state: "connecting", player: null, offer: null, accounting: null }),
      0,
    );
    expect(plan.statusText).toBe("Requesting the live offer…");
    expect(plan.canClose).toBe(true);
  });

  test("reconnecting: the honest connection-lost line", () => {
    const plan = liveStatusPlan(
      liveOf({ state: "reconnecting", player: null, accounting: null }),
      0,
    );
    expect(plan.statusText).toBe("Connection lost — reconnecting…");
  });

  test("ended: the stream-over line", () => {
    const plan = liveStatusPlan(liveOf({ state: "ended" }), 0);
    expect(plan.statusText).toBe("The live stream has ended.");
    expect(plan.canClose).toBe(true);
  });

  test("playing with no frame yet: waiting for the stream (absent metrics absent)", () => {
    const plan = liveStatusPlan(
      liveOf({ state: "playing", player: { ...LIVE_PLAYER, frame: null, frameSvg: null } }),
      0,
    );
    expect(plan.statusText).toBe("Waiting for the live stream…");
    expect(plan.accountingText).not.toBe(null); // accounting may exist already
  });

  test("playing: the status line carries the REAL seams (frame, buffered ahead, delivery latency)", () => {
    const plan = liveStatusPlan(liveOf({ state: "playing" }), 0);
    expect(plan.statusText).toBe("Live · frame 1 @ 4.0s · 3 frames buffered ahead · delivery latency 0.1s");
    // Latency absent → the term is absent (never a faked 0.0s).
    const noLatency = liveStatusPlan(
      liveOf({ state: "playing", player: { ...LIVE_PLAYER, latencyMs: null } }),
      0,
    );
    expect(noLatency.statusText).toBe("Live · frame 1 @ 4.0s · 3 frames buffered ahead");
    // Buffering flips the label; singular grammar is honest.
    const buffering = liveStatusPlan(
      liveOf({ state: "playing", player: { ...LIVE_PLAYER, buffering: true, bufferedAhead: 1 } }),
      0,
    );
    expect(buffering.statusText).toBe("Buffering · frame 1 @ 4.0s · 1 frame buffered ahead · delivery latency 0.1s");
  });
});

describe("liveStatusPlan — the accounting + degradation lines (W305's verbatim receipts)", () => {
  test("the accounting line formats every count verbatim", () => {
    const plan = liveStatusPlan(liveOf({}), 0);
    expect(plan.accountingText).toBe("4 windows applied · 1 skipped · 0 duplicates · 5 accounted");
  });

  test("no accounting snapshot yet: the line is absent (never a faked 0)", () => {
    const plan = liveStatusPlan(liveOf({ accounting: null }), 0);
    expect(plan.accountingText).toBe(null);
  });

  test("degradation reasons are joined verbatim; empty means no line", () => {
    expect(liveStatusPlan(liveOf({ degradationReasons: [] }), 0).degradationText).toBe(null);
    expect(
      liveStatusPlan(liveOf({ degradationReasons: ["skip-stale", "reconnect-gap"] }), 0)
        .degradationText,
    ).toBe("Degraded: skip-stale, reconnect-gap");
  });
});

describe("liveStatusPlan — the reconnect countdown (the schedule's own numbers)", () => {
  test("outside a reconnect window: no hint (even mid-play)", () => {
    expect(liveStatusPlan(liveOf({ reconnect: null }), 0).reconnectHint).toBe(null);
  });

  test("inside a window: attempt N of the cap + the remaining delay", () => {
    const view = liveOf({
      state: "reconnecting",
      reconnect: {
        attempts: 2,
        maxAttempts: LIVE_RECONNECT_MAX_ATTEMPTS,
        nextAttemptAtMs: 5_000,
        lastFailureClass: "connection-lost",
        lastReport: null,
      },
    });
    // 1_500 ms until the attempt, from `now` = 3_500.
    expect(liveStatusPlan(view, 3_500).reconnectHint).toBe("attempt 2 of 4 — next try 1.5s");
    // The first window: attempt 1, the base delay.
    const first = liveOf({
      state: "reconnecting",
      reconnect: {
        attempts: 1,
        maxAttempts: LIVE_RECONNECT_MAX_ATTEMPTS,
        nextAttemptAtMs: 500,
        lastFailureClass: "connection-lost",
        lastReport: null,
      },
    });
    expect(liveStatusPlan(first, 0).reconnectHint).toBe("attempt 1 of 4 — next try 0.5s");
  });

  test("due or overdue: 'now' (never a negative countdown)", () => {
    const view = liveOf({
      state: "reconnecting",
      reconnect: {
        attempts: 3,
        maxAttempts: LIVE_RECONNECT_MAX_ATTEMPTS,
        nextAttemptAtMs: 2_000,
        lastFailureClass: "transport-failed",
        lastReport: null,
      },
    });
    expect(liveStatusPlan(view, 2_000).reconnectHint).toBe("attempt 3 of 4 — next try now");
    expect(liveStatusPlan(view, 9_999).reconnectHint).toBe("attempt 3 of 4 — next try now");
  });

  test("a fired attempt (nextAttemptAtMs null) shows no countdown even mid-state", () => {
    const view = liveOf({
      state: "reconnecting",
      reconnect: {
        attempts: 1,
        maxAttempts: LIVE_RECONNECT_MAX_ATTEMPTS,
        nextAttemptAtMs: null,
        lastFailureClass: "connection-lost",
        lastReport: { resumeFromOrdinal: 3, replayCount: 2, gapSkipped: 0 },
      },
    });
    expect(liveStatusPlan(view, 0).reconnectHint).toBe(null);
  });
});

describe("liveStatusPlan — the terminal outcome line", () => {
  test("null while the stream is live/awaited", () => {
    expect(liveStatusPlan(liveOf({}), 0).outcomeText).toBe(null);
  });

  test("verbatim outcome + failureClass when the session ended", () => {
    expect(
      liveStatusPlan(liveOf({ outcome: { outcome: "completed" } }), 0).outcomeText,
    ).toBe("Live stream ended (completed)");
    expect(
      liveStatusPlan(liveOf({ outcome: { outcome: "failed", failureClass: "rights-lapsed" } }), 0)
        .outcomeText,
    ).toBe("Live stream ended (failed — rights-lapsed)");
    expect(
      liveStatusPlan(liveOf({ outcome: { outcome: "stopped" } }), 0).outcomeText,
    ).toBe("Live stream ended (stopped)");
  });
});

describe("liveStatusPlan — purity", () => {
  test("the same view + now yield the deep-equal plan; the view is never mutated", () => {
    const view = liveOf({
      state: "reconnecting",
      reconnect: {
        attempts: 2,
        maxAttempts: LIVE_RECONNECT_MAX_ATTEMPTS,
        nextAttemptAtMs: 5_000,
        lastFailureClass: "connection-lost",
        lastReport: null,
      },
    });
    const snapshot = JSON.stringify(view);
    const first = liveStatusPlan(view, 3_500);
    const second = liveStatusPlan(JSON.parse(snapshot) as typeof view, 3_500);
    expect(first).toEqual(second);
    expect(JSON.stringify(view)).toBe(snapshot);
  });
});
