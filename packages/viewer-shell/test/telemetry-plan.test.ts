/**
 * Telemetry plan tests (W706): the PURE feedback-affordance derivation —
 * visibility (a playback is mounted AND a sink is wired), the closed
 * feedback kinds + labels in fixed order, the constant privacy disclosure,
 * the honest not-configured status, and purity (deep-equal, no mutation).
 */
import { describe, expect, test } from "bun:test";
import { TELEMETRY_PRIVACY_NOTE, telemetryAffordance } from "../src/telemetry-plan.ts";
import type { ViewerViewModel } from "../src/viewer-core.ts";

/** A deterministic base view-model (the pane-signature test convention). */
function vmOf(overrides: Partial<ViewerViewModel>): ViewerViewModel {
  return {
    status: "playing",
    connection: "connected",
    pendingOperation: null,
    sessions: [{ id: "sess-1", state: "authorized", createdAt: "2026-09-14T00:00:00.000Z" }],
    session: null,
    rendererSelection: null,
    playback: {
      kind: "segment",
      playback: "playing",
      buffering: false,
      positionMs: 1_234,
      durationMs: 6_000,
      frameIndex: 1,
      frameCount: 6,
      document: "<svg>…</svg>",
      segmentId: "anime-clip-0badcafe",
      contentType: "image/svg+xml",
      contentHash: "a".repeat(64),
      byteLength: 17_551,
      loop: false,
      smil: { paused: false, seekMs: null },
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

describe("telemetryAffordance — the pure W706 decision layer", () => {
  test("visible exactly while a presentation is mounted AND telemetry is enabled", () => {
    expect(telemetryAffordance(vmOf({})).visible).toBe(true);
    // No playback mounted (any non-playback status): hidden.
    for (const status of [
      "session-detail",
      "outputs-pending",
      "browsing-sessions",
      "error",
    ] as const) {
      expect(telemetryAffordance(vmOf({ status, playback: null })).visible, status).toBe(false);
    }
    // A sink is not wired: hidden, honestly marked not-configured.
    const unconfigured = telemetryAffordance(vmOf({ telemetry: { enabled: false } }));
    expect(unconfigured.visible).toBe(false);
    expect(unconfigured.status).toBe("not-configured");
  });

  test("W704: a mounted LIVE presentation is rateable too (the user is watching something)", () => {
    // The live player owns the live section's `player` view-model; with one
    // mounted the affordance shows exactly like a batch playback.
    const livePlayer = {
      kind: "live" as const,
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
    const liveView = vmOf({
      playback: null,
      status: "live-playing",
      live: {
        available: true,
        state: "playing",
        sessionId: "sess-1",
        streamId: "live-sess-1",
        offer: null,
        viewerId: "viewer-shell",
        player: livePlayer,
        accounting: null,
        degradationReasons: [],
        reconnect: null,
        outcome: null,
      },
    });
    const affordance = telemetryAffordance(liveView);
    expect(affordance.visible).toBe(true);
    expect(affordance.feedbackChoices).toHaveLength(3);
    expect(affordance.status).toBe("recording");
    // The live section with NO player mounted (idle/connecting/before an
    // attach) hides the row — nothing is rateable yet.
    const idleLive = telemetryAffordance(
      vmOf({
        playback: null,
        status: "session-detail",
        live: {
          available: true,
          state: "idle",
          sessionId: "sess-1",
          streamId: "live-sess-1",
          offer: null,
          viewerId: "viewer-shell",
          player: null,
          accounting: null,
          degradationReasons: [],
          reconnect: null,
          outcome: null,
        },
      }),
    );
    expect(idleLive.visible).toBe(false);
  });

  test("the offered feedback kinds + labels are the closed vocabulary in fixed order", () => {
    const affordance = telemetryAffordance(vmOf({}));
    expect(affordance.feedbackChoices).toEqual([
      { kind: "playback-good", label: "Good" },
      { kind: "playback-stalled", label: "Stalled" },
      { kind: "playback-poor", label: "Poor" },
    ]);
    // Hidden affordances offer nothing.
    expect(telemetryAffordance(vmOf({ playback: null })).feedbackChoices).toEqual([]);
  });

  test("the privacy note is the constant disclosure (non-empty, states the scope and the never-carries)", () => {
    const note = telemetryAffordance(vmOf({})).privacyNote;
    expect(note).toBe(TELEMETRY_PRIVACY_NOTE);
    expect(note.length > 50).toBe(true);
    expect(note).toContain("opaque session id");
    expect(note).toContain("never records");
  });

  test("status mirrors the view-model telemetry marker", () => {
    expect(telemetryAffordance(vmOf({})).status).toBe("recording");
    expect(telemetryAffordance(vmOf({ telemetry: { enabled: false } })).status).toBe(
      "not-configured",
    );
  });

  test("purity: the same view yields a deep-equal affordance; the input is never mutated", () => {
    const view = vmOf({});
    const snapshot = JSON.stringify(view);
    const first = telemetryAffordance(view);
    const second = telemetryAffordance(JSON.parse(JSON.stringify(view)) as ViewerViewModel);
    expect(first).toEqual(second);
    expect(JSON.stringify(view)).toBe(snapshot);
    // Per-tick playback changes do not change the affordance's decisions.
    const ticked = vmOf({
      playback: { ...vmOf({}).playback!, positionMs: 5_999, frameIndex: 5 },
    });
    expect(telemetryAffordance(ticked)).toEqual(first);
  });
});
