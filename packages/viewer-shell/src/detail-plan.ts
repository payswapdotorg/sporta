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
  | "disconnected"
  | "browsing"
  | "session"
  | "renderer-selection"
  | "pending"
  | "playback"
  | "live"
  | "error";

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
    case "outputs-pending":
      return "pending";
    case "ready":
    case "playing":
    case "paused":
    case "ended":
      return "playback";
    case "live-connecting":
    case "live-playing":
    case "live-reconnecting":
    case "live-ended":
      return "live";
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
  /** Build the live section (live stage + status surface) and mount it (W704). */
  | { kind: "mount-live" }
  /**
   * Update the ALREADY-MOUNTED live section in place (the W704 analog of
   * `update-playback`: the live stage, status/accounting lines, and the
   * reconnect countdown update in place — never a fresh node).
   */
  | { kind: "update-live" }
  /**
   * Render a fresh non-playback section. `teardownPlayback` is `true` when a
   * playback section is currently mounted (it must be torn down first);
   * `teardownLive` likewise for a mounted live section.
   */
  | {
      kind: "render-static";
      mode: Exclude<DetailMode, "playback" | "live">;
      teardownPlayback: boolean;
      teardownLive: boolean;
    };

/** Which presentation sections are currently mounted in the detail pane. */
export interface DetailPaneMounted {
  playback: boolean;
  live: boolean;
}

/**
 * Derives the detail-pane action. Deterministic pure function over
 * `(status, mounted)` — deep-equal pinned by tests, including the
 * update-in-place invariants for every playback AND live status.
 */
export function detailPanePlan(status: ViewerStatus, mounted: DetailPaneMounted): DetailPaneAction {
  const mode = detailModeOf(status);
  if (mode === "playback") {
    return mounted.playback ? { kind: "update-playback" } : { kind: "mount-playback" };
  }
  if (mode === "live") {
    return mounted.live ? { kind: "update-live" } : { kind: "mount-live" };
  }
  return {
    kind: "render-static",
    mode,
    teardownPlayback: mounted.playback,
    teardownLive: mounted.live,
  };
}
