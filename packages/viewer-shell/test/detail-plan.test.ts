/**
 * Detail-pane plan tests (W702 + W704): the PURE layout decision for the
 * shell's right pane. The critical invariant (the fix for a real inherited
 * bug): once a playback section is mounted, every subsequent playback-status
 * view plans `update-playback` — the mounted section is reused in place and
 * NEVER replaced by a fresh node. Before this plan existed, the bootstrap
 * rendered an EMPTY replacement section on every playback re-render,
 * detaching the live player stage (player visually vanished on the first
 * tick). W704 extends the same invariant to the LIVE section: while a live
 * status holds, the mounted live section (stage + status lines) updates in
 * place; a playback section and a live section can never be mounted
 * together (one presentation at a time), and every non-presentation status
 * tears down whatever is mounted.
 */
import { describe, expect, test } from "bun:test";
import { detailModeOf, detailPanePlan } from "../src/detail-plan.ts";
import type { DetailMode, DetailPaneAction, DetailPaneMounted } from "../src/detail-plan.ts";
import type { ViewerStatus } from "../src/viewer-core.ts";

const PLAYBACK_STATUSES: ViewerStatus[] = ["ready", "playing", "paused", "ended"];
const LIVE_STATUSES: ViewerStatus[] = [
  "live-connecting",
  "live-playing",
  "live-reconnecting",
  "live-ended",
];
const STATIC_STATUSES: ViewerStatus[] = [
  "disconnected",
  "connecting",
  "browsing-sessions",
  "session-detail",
  "renderer-selection",
  "render-queued",
  "loading-output",
  "error",
];

describe("detailModeOf — status → section mode (total, no default case)", () => {
  test.each([
    ["disconnected", "disconnected"],
    ["connecting", "disconnected"],
    ["browsing-sessions", "browsing"],
    ["session-detail", "session"],
    ["renderer-selection", "renderer-selection"],
    ["render-queued", "pending"],
    ["loading-output", "pending"],
    ["ready", "playback"],
    ["playing", "playback"],
    ["paused", "playback"],
    ["ended", "playback"],
    ["live-connecting", "live"],
    ["live-playing", "live"],
    ["live-reconnecting", "live"],
    ["live-ended", "live"],
    ["error", "error"],
  ] as const)("%s → %s", (status: ViewerStatus, mode: DetailMode) => {
    expect(detailModeOf(status)).toBe(mode);
  });
});

describe("detailPanePlan — the update-in-place invariant (bug pin)", () => {
  test("every playback status with a MOUNTED section plans update-playback (never a fresh section)", () => {
    for (const status of PLAYBACK_STATUSES) {
      expect(detailPanePlan(status, { playback: true, live: false })).toEqual({
        kind: "update-playback",
      });
    }
  });

  test("every playback status WITHOUT a mounted section plans mount-playback", () => {
    for (const status of PLAYBACK_STATUSES) {
      expect(detailPanePlan(status, { playback: false, live: false })).toEqual({
        kind: "mount-playback",
      });
    }
  });

  test("every live status with a MOUNTED section plans update-live (the W704 analog of the bug pin)", () => {
    for (const status of LIVE_STATUSES) {
      expect(detailPanePlan(status, { playback: false, live: true })).toEqual({
        kind: "update-live",
      });
    }
  });

  test("every live status WITHOUT a mounted section plans mount-live", () => {
    for (const status of LIVE_STATUSES) {
      expect(detailPanePlan(status, { playback: false, live: false })).toEqual({
        kind: "mount-live",
      });
    }
  });

  test("a live status with a PLAYBACK section mounted plans mount-live (one presentation at a time — the playback section is torn down by the mount)", () => {
    for (const status of LIVE_STATUSES) {
      expect(detailPanePlan(status, { playback: true, live: false })).toEqual({
        kind: "mount-live",
      });
    }
  });

  test("a playback status with a LIVE section mounted plans mount-playback (the mirror)", () => {
    for (const status of PLAYBACK_STATUSES) {
      expect(detailPanePlan(status, { playback: false, live: true })).toEqual({
        kind: "mount-playback",
      });
    }
  });

  test("a non-presentation status with a MOUNTED section plans render-static WITH the teardown", () => {
    for (const status of STATIC_STATUSES) {
      const action: DetailPaneAction = detailPanePlan(status, { playback: true, live: true });
      expect(action.kind).toBe("render-static");
      if (action.kind === "render-static") {
        expect(action.teardownPlayback).toBe(true);
        expect(action.teardownLive).toBe(true);
        expect(action.mode === detailModeOf(status)).toBe(true);
        expect(action.mode).not.toBe("playback");
        expect(action.mode).not.toBe("live");
      }
    }
  });

  test("a non-presentation status with NO mounted section plans render-static WITHOUT teardown", () => {
    for (const status of STATIC_STATUSES) {
      const action: DetailPaneAction = detailPanePlan(status, { playback: false, live: false });
      expect(action.kind).toBe("render-static");
      if (action.kind === "render-static") {
        expect(action.teardownPlayback).toBe(false);
        expect(action.teardownLive).toBe(false);
        expect(action.mode === detailModeOf(status)).toBe(true);
      }
    }
  });

  test("a non-presentation status tears down only what is mounted", () => {
    const playbackOnly = detailPanePlan("session-detail", { playback: true, live: false });
    if (playbackOnly.kind !== "render-static") throw new Error("expected render-static");
    expect(playbackOnly.teardownPlayback).toBe(true);
    expect(playbackOnly.teardownLive).toBe(false);
    const liveOnly = detailPanePlan("session-detail", { playback: false, live: true });
    if (liveOnly.kind !== "render-static") throw new Error("expected render-static");
    expect(liveOnly.teardownPlayback).toBe(false);
    expect(liveOnly.teardownLive).toBe(true);
  });

  test("the plan is a pure function (same inputs, same output)", () => {
    const mountedOptions: DetailPaneMounted[] = [
      { playback: false, live: false },
      { playback: true, live: false },
      { playback: false, live: true },
      { playback: true, live: true },
    ];
    for (const status of [...PLAYBACK_STATUSES, ...LIVE_STATUSES, ...STATIC_STATUSES]) {
      for (const mounted of mountedOptions) {
        expect(detailPanePlan(status, mounted)).toEqual(detailPanePlan(status, mounted));
      }
    }
  });
});

describe("detailPanePlan — the mounted section is never orphaned", () => {
  test("a full status walk yields mount → updates → teardown exactly once", () => {
    // The walk a real playback session produces: load (ready) → play
    // (playing) → pause → ended → closePlayback (session-detail).
    const walk: Array<{
      status: ViewerStatus;
      mounted: DetailPaneMounted;
      expected: DetailPaneAction;
    }> = [
      { status: "ready", mounted: { playback: false, live: false }, expected: { kind: "mount-playback" } },
      { status: "ready", mounted: { playback: true, live: false }, expected: { kind: "update-playback" } },
      { status: "playing", mounted: { playback: true, live: false }, expected: { kind: "update-playback" } },
      { status: "paused", mounted: { playback: true, live: false }, expected: { kind: "update-playback" } },
      { status: "ended", mounted: { playback: true, live: false }, expected: { kind: "update-playback" } },
      {
        status: "session-detail",
        mounted: { playback: true, live: false },
        expected: { kind: "render-static", mode: "session", teardownPlayback: true, teardownLive: false },
      },
      {
        status: "browsing-sessions",
        mounted: { playback: false, live: false },
        expected: {
          kind: "render-static",
          mode: "browsing",
          teardownPlayback: false,
          teardownLive: false,
        },
      },
    ];
    for (const step of walk) {
      expect(detailPanePlan(step.status, step.mounted)).toEqual(step.expected);
    }
  });

  test("a full LIVE walk yields mount → updates → teardown exactly once (W704)", () => {
    // The walk a real live session produces: openLive (live-connecting →
    // live-playing) → connection lost (live-reconnecting) → attempt fires
    // (live-playing) → session ends (live-ended) → closeLive (session-detail).
    const walk: Array<{
      status: ViewerStatus;
      mounted: DetailPaneMounted;
      expected: DetailPaneAction;
    }> = [
      { status: "live-connecting", mounted: { playback: false, live: false }, expected: { kind: "mount-live" } },
      { status: "live-playing", mounted: { playback: false, live: true }, expected: { kind: "update-live" } },
      { status: "live-reconnecting", mounted: { playback: false, live: true }, expected: { kind: "update-live" } },
      { status: "live-playing", mounted: { playback: false, live: true }, expected: { kind: "update-live" } },
      { status: "live-ended", mounted: { playback: false, live: true }, expected: { kind: "update-live" } },
      {
        status: "session-detail",
        mounted: { playback: false, live: true },
        expected: { kind: "render-static", mode: "session", teardownPlayback: false, teardownLive: true },
      },
      {
        status: "browsing-sessions",
        mounted: { playback: false, live: false },
        expected: {
          kind: "render-static",
          mode: "browsing",
          teardownPlayback: false,
          teardownLive: false,
        },
      },
    ];
    for (const step of walk) {
      expect(detailPanePlan(step.status, step.mounted)).toEqual(step.expected);
    }
  });
});
