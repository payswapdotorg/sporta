/**
 * Detail-pane plan tests (W702): the PURE layout decision for the shell's
 * right pane. The critical invariant (the fix for a real inherited bug): once
 * a playback section is mounted, every subsequent playback-status view plans
 * `update-playback` — the mounted section is reused in place and NEVER
 * replaced by a fresh node. Before this plan existed, the bootstrap rendered
 * an EMPTY replacement section on every playback re-render, detaching the
 * live player stage (player visually vanished on the first tick).
 */
import { describe, expect, test } from "bun:test";
import { detailModeOf, detailPanePlan } from "../src/detail-plan.ts";
import type { DetailMode, DetailPaneAction } from "../src/detail-plan.ts";
import type { ViewerStatus } from "../src/viewer-core.ts";

const PLAYBACK_STATUSES: ViewerStatus[] = ["ready", "playing", "paused", "ended"];
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
    ["error", "error"],
  ] as const)("%s → %s", (status: ViewerStatus, mode: DetailMode) => {
    expect(detailModeOf(status)).toBe(mode);
  });
});

describe("detailPanePlan — the update-in-place invariant (bug pin)", () => {
  test("every playback status with a MOUNTED section plans update-playback (never a fresh section)", () => {
    for (const status of PLAYBACK_STATUSES) {
      expect(detailPanePlan(status, true)).toEqual({ kind: "update-playback" });
    }
  });

  test("every playback status WITHOUT a mounted section plans mount-playback", () => {
    for (const status of PLAYBACK_STATUSES) {
      expect(detailPanePlan(status, false)).toEqual({ kind: "mount-playback" });
    }
  });

  test("a non-playback status with a MOUNTED section plans render-static WITH teardown", () => {
    for (const status of STATIC_STATUSES) {
      const action: DetailPaneAction = detailPanePlan(status, true);
      expect(action.kind).toBe("render-static");
      if (action.kind === "render-static") {
        expect(action.teardownPlayback).toBe(true);
        expect(action.mode === detailModeOf(status)).toBe(true);
        expect(action.mode).not.toBe("playback");
      }
    }
  });

  test("a non-playback status with NO mounted section plans render-static WITHOUT teardown", () => {
    for (const status of STATIC_STATUSES) {
      const action: DetailPaneAction = detailPanePlan(status, false);
      expect(action.kind).toBe("render-static");
      if (action.kind === "render-static") {
        expect(action.teardownPlayback).toBe(false);
        expect(action.mode === detailModeOf(status)).toBe(true);
      }
    }
  });

  test("the plan is a pure function (same inputs, same output)", () => {
    for (const status of [...PLAYBACK_STATUSES, ...STATIC_STATUSES]) {
      expect(detailPanePlan(status, true)).toEqual(detailPanePlan(status, true));
      expect(detailPanePlan(status, false)).toEqual(detailPanePlan(status, false));
    }
  });
});

describe("detailPanePlan — the mounted section is never orphaned", () => {
  test("a full status walk yields mount → updates → teardown exactly once", () => {
    // The walk a real playback session produces: load (ready) → play
    // (playing) → pause → ended → closePlayback (session-detail).
    const walk: Array<{ status: ViewerStatus; mounted: boolean; expected: DetailPaneAction }> = [
      { status: "ready", mounted: false, expected: { kind: "mount-playback" } },
      { status: "ready", mounted: true, expected: { kind: "update-playback" } },
      { status: "playing", mounted: true, expected: { kind: "update-playback" } },
      { status: "paused", mounted: true, expected: { kind: "update-playback" } },
      { status: "ended", mounted: true, expected: { kind: "update-playback" } },
      {
        status: "session-detail",
        mounted: true,
        expected: { kind: "render-static", mode: "session", teardownPlayback: true },
      },
      {
        status: "browsing-sessions",
        mounted: false,
        expected: { kind: "render-static", mode: "browsing", teardownPlayback: false },
      },
    ];
    for (const step of walk) {
      expect(detailPanePlan(step.status, step.mounted)).toEqual(step.expected);
    }
  });
});
