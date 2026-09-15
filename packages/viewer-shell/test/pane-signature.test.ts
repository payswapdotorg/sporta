/**
 * Pane-signature tests (W702): the memo keys that stop the bootstrap from
 * re-rendering the sessions pane and error banner on every per-tick
 * view-model emission while a clip plays (the bug: the create-session form
 * was destroyed at tick rate — focus lost mid-typing, text reset). The
 * signatures must be INVARIANT across playback-only changes and SENSITIVE
 * to every field the panes actually render.
 */
import { describe, expect, test } from "bun:test";
import { errorBannerSignature, sessionsPaneSignature } from "../src/pane-signature.ts";
import type { LiveView, ViewerViewModel } from "../src/viewer-core.ts";
import type { LivePlayerViewModel } from "../src/live-player.ts";

/** A deterministic base view-model (the fields under test are overridden). */
function vmOf(overrides: Partial<ViewerViewModel>): ViewerViewModel {
  return {
    status: "playing",
    connection: "connected",
    pendingOperation: null,
    sessions: [{ id: "sess-1", state: "authorized", createdAt: "2026-09-14T00:00:00.000Z" }],
    session: null,
    rendererSelection: null,
    playback: {
      kind: "frames",
      playback: "playing",
      buffering: false,
      positionMs: 1_234,
      durationMs: 6_000,
      timelineMs: 1_234,
      frameIndex: 1,
      frameCount: 6,
      frameSvg: "<svg>frame-1</svg>",
      availableFrames: 6,
      loop: false,
      renderer: { rendererId: "anime.prototype", rendererVersion: "0.1.0", styleId: "default" },
      output: { startMs: 0, frameIntervalMs: 1_000 },
    },
    pendingRenderId: null,
    live: { available: false, note: "live note constant" },
    telemetry: { enabled: true },
    error: null,
    connectedAtMs: 1,
    ...overrides,
  };
}

/** A deterministic AVAILABLE live section (fields overridden per test; W704). */
function liveOf(overrides: Partial<Extract<LiveView, { available: true }>>): LiveView {
  return {
    available: true,
    state: "playing",
    sessionId: "sess-1",
    streamId: "live-sess-1",
    offer: null,
    viewerId: "viewer-shell",
    player: null,
    accounting: null,
    degradationReasons: [],
    reconnect: null,
    outcome: null,
    ...overrides,
  };
}

describe("sessionsPaneSignature — invariant across playback-only changes (the bug pin)", () => {
  test("per-tick playback changes NEVER change the signature (the pane is not re-rendered)", () => {
    const base = sessionsPaneSignature(vmOf({}));
    // Everything a playing clip emits per tick:
    const ticked = sessionsPaneSignature(
      vmOf({
        status: "playing",
        playback: {
          kind: "frames",
          playback: "playing",
          buffering: false,
          positionMs: 5_999,
          durationMs: 6_000,
          timelineMs: 5_999,
          frameIndex: 5,
          frameCount: 6,
          frameSvg: "<svg>frame-5</svg>",
          availableFrames: 6,
          loop: false,
          renderer: { rendererId: "anime.prototype", rendererVersion: "0.1.0", styleId: "default" },
          output: { startMs: 0, frameIntervalMs: 1_000 },
        },
      }),
    );
    expect(ticked).toBe(base);
    // Playback transitions (playing → paused → ended) and the whole playback
    // teardown also leave the pane's inputs untouched.
    for (const status of ["paused", "ended", "ready", "session-detail"] as const) {
      expect(sessionsPaneSignature(vmOf({ status }))).toBe(base);
    }
    expect(sessionsPaneSignature(vmOf({ playback: null, status: "session-detail" }))).toBe(base);
    // The fields the pane does NOT render: session detail, renderer
    // selection, connectedAtMs, and the status label inputs above.
    expect(
      sessionsPaneSignature(
        vmOf({
          session: {
            sessionId: "sess-1",
            status: "authorized",
            createdAt: "2026-09-14T00:00:00.000Z",
            rights: {
              canReferenceSourceFrames: true,
              canDeliverLive: true,
              canStoreDerivatives: true,
              canShare: true,
            },
            renders: [],
          },
          rendererSelection: { renderers: [] },
          connectedAtMs: 999_999,
        }),
      ),
    ).toBe(base);
  });

  test("every rendered field changes the signature (sessions, connection, pending, live note)", () => {
    const base = sessionsPaneSignature(vmOf({}));
    // The session list.
    expect(
      sessionsPaneSignature(
        vmOf({
          sessions: [
            { id: "sess-1", state: "authorized", createdAt: "2026-09-14T00:00:00.000Z" },
            { id: "sess-2", state: "cancelled", createdAt: "2026-09-14T01:00:00.000Z" },
          ],
        }),
      ),
    ).not.toBe(base);
    // A session's state/label changes (the list content, not just length).
    expect(
      sessionsPaneSignature(
        vmOf({
          sessions: [{ id: "sess-1", state: "cancelled", createdAt: "2026-09-14T00:00:00.000Z" }],
        }),
      ),
    ).not.toBe(base);
    // The connection badge.
    for (const connection of ["disconnected", "connecting"] as const) {
      expect(sessionsPaneSignature(vmOf({ connection }))).not.toBe(base);
    }
    // The busy state (button disabled).
    expect(sessionsPaneSignature(vmOf({ pendingOperation: "openSession" }))).not.toBe(base);
    // The live note (constant today; the signature stays total over the pane).
    expect(
      sessionsPaneSignature(vmOf({ live: { available: false, note: "different note" } })),
    ).not.toBe(base);
  });

  test("W704: the live line — per-tick live PLAYER changes keep the signature; live SECTION state changes flip it", () => {
    // The pane renders the live section's COARSE state only; the per-tick
    // player facts (frame, latency, buffering) live in the detail pane's
    // live section (updated in place) — the sessions pane must NOT re-render
    // while a live stream plays (the form keeps its focus).
    const liveBase = liveOf({});
    const base = sessionsPaneSignature(vmOf({ live: liveBase }));
    // Two different player snapshots under the SAME coarse state:
    const playerA: LivePlayerViewModel = {
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
    const playerB: LivePlayerViewModel = {
      ...playerA,
      buffering: true,
      playheadMs: 9_999,
      frame: { windowOrdinal: 4, frameIndex: 0, timestampMs: 9_000 },
      frameSvg: "<svg>live-2</svg>",
      frameCount: 9,
      bufferedAhead: 0,
      latencyMs: 2_500,
      lastDisplayedFrame: 8,
    };
    expect(
      sessionsPaneSignature(
        vmOf({ live: liveOf({ player: playerA }) }),
      ),
    ).toBe(base);
    expect(
      sessionsPaneSignature(
        vmOf({ live: liveOf({ player: playerB }) }),
      ),
    ).toBe(base);
    // The coarse state IS a rendered field — each transition flips it.
    for (const state of ["idle", "connecting", "reconnecting", "ended"] as const) {
      expect(sessionsPaneSignature(vmOf({ live: liveOf({ state }) }))).not.toBe(base);
    }
    // And the available/unavailable boundary flips it (note vs state).
    expect(
      sessionsPaneSignature(vmOf({ live: { available: false, note: "live note constant" } })),
    ).not.toBe(base);
  });

  test("the signature is pure (same view, same string) and JSON-deterministic", () => {
    const view = vmOf({});
    expect(sessionsPaneSignature(view)).toBe(sessionsPaneSignature(view));
    expect(sessionsPaneSignature(vmOf({}))).toBe(sessionsPaneSignature(vmOf({})));
  });
});

describe("errorBannerSignature — the banner re-renders only on error changes", () => {
  test("null-to-null and playback-only changes keep the signature (banner untouched)", () => {
    expect(errorBannerSignature(vmOf({ error: null }))).toBe(
      errorBannerSignature(vmOf({ error: null, playback: null, status: "ended" })),
    );
  });

  test("every error-field change flips the signature", () => {
    const errorA = {
      failureClass: "rights-denied",
      label: "Rights denied",
      message: "denied once",
      retryable: false,
      operation: "openSession",
      details: { sessionId: "sess-1" },
    } as const;
    expect(errorBannerSignature(vmOf({ error: { ...errorA } }))).not.toBe(
      errorBannerSignature(vmOf({ error: null })),
    );
    // Message change.
    expect(errorBannerSignature(vmOf({ error: { ...errorA, message: "denied twice" } }))).not.toBe(
      errorBannerSignature(vmOf({ error: { ...errorA } })),
    );
    // Retryability change (Retry button appears/disappears).
    expect(errorBannerSignature(vmOf({ error: { ...errorA, retryable: true } }))).not.toBe(
      errorBannerSignature(vmOf({ error: { ...errorA } })),
    );
    // Class/label change.
    expect(errorBannerSignature(vmOf({ error: { ...errorA, failureClass: "network" } }))).not.toBe(
      errorBannerSignature(vmOf({ error: { ...errorA } })),
    );
  });

  test("the signature is pure (same view, same string)", () => {
    const view = vmOf({});
    expect(errorBannerSignature(view)).toBe(errorBannerSignature(view));
  });
});
