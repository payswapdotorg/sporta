/**
 * The detail-pane plan (W702): the PURE decision layer for the shell's right
 * pane — which section mode the current view-model status maps to, and
 * whether the mounted playback section must be MOUNTED, UPDATED IN PLACE, or
 * torn down.
 *
 * The split exists so the browser bootstrap (compile-checked, never unit
 * tested — no DOM-testing dependency by constitution) makes no layout
 * decisions: it consumes this plan. The critical invariant the plan encodes
 * (and tests pin): while the status is a playback status and a playback
 * section is ALREADY mounted, the plan is ALWAYS `update-playback` — the
 * mounted section (player stage, SVG, seek input, listeners) is reused in
 * place and never replaced by a fresh node. A re-render may never detach the
 * live player.
 */
import type { ViewerStatus } from "./viewer-core.ts";

/** The right-pane section mode (the bootstrap renders one mode per plan). */
export type DetailMode =
  "disconnected" | "browsing" | "session" | "renderer-selection" | "pending" | "playback" | "error";

/** Maps a viewer status onto the detail-pane section mode. */
export function detailModeOf(status: ViewerStatus): DetailMode {
  switch (status) {
    case "disconnected":
    case "connecting":
      return "disconnected";
    case "browsing-sessions":
      return "browsing";
    case "session-detail":
      return "session";
    case "renderer-selection":
      return "renderer-selection";
    case "render-queued":
    case "loading-output":
      return "pending";
    case "ready":
    case "playing":
    case "paused":
    case "ended":
      return "playback";
    case "error":
      return "error";
  }
}

/** What the bootstrap's detail-pane renderer must do for one status. */
export type DetailPaneAction =
  /** Build the playback section (player stage + controls) and mount it. */
  | { kind: "mount-playback" }
  /**
   * Update the ALREADY-MOUNTED playback section in place. The mounted
   * section must be reused — never replaced by a fresh node (see the module
   * docs: a re-render may never detach the live player).
   */
  | { kind: "update-playback" }
  /**
   * Render a fresh non-playback section. `teardownPlayback` is `true` when a
   * playback section is currently mounted (it must be torn down first).
   */
  | { kind: "render-static"; mode: Exclude<DetailMode, "playback">; teardownPlayback: boolean };

/**
 * Derives the detail-pane action. Deterministic pure function over
 * `(status, playbackMounted)` — deep-equal pinned by tests, including the
 * update-in-place invariant for every playback status.
 */
export function detailPanePlan(status: ViewerStatus, playbackMounted: boolean): DetailPaneAction {
  const mode = detailModeOf(status);
  if (mode !== "playback") {
    return { kind: "render-static", mode, teardownPlayback: playbackMounted };
  }
  return playbackMounted ? { kind: "update-playback" } : { kind: "mount-playback" };
}
