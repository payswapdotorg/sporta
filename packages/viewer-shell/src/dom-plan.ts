/**
 * The player DOM plan (W702): the PURE decision layer between the player
 * view-model and the DOM adapter.
 *
 * The split exists so the player's DOM logic (which frame to swap, when to
 * show the buffering overlay, what the status line says) is testable
 * HEADLESSLY — `playerViewToDomPlan` is a pure function over
 * `(view-model, previous svg)`. The actual DOM writes (browser-only) are the
 * thin `applyPlayerDomPlan` in `./dom-adapter.ts`.
 */
import type { PlayerViewModel } from "./player.ts";

/** What the DOM adapter should do for one view-model snapshot. */
export interface PlayerDomPlan {
  /**
   * The SVG to render when it differs from the currently displayed one;
   * `null` means "keep the current frame" (no swap, no flicker).
   */
  swapSvg: string | null;
  /** Whether the buffering overlay must be visible. */
  showBuffering: boolean;
  /** The overlay text (defined iff `showBuffering`). */
  bufferingText: string | null;
  /** The status line (always defined; deterministic from the view-model). */
  statusText: string;
}

/** Formats milliseconds as `s.d s` (one decimal, deterministic). */
function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Derives the DOM plan. Deterministic pure function — the same inputs yield
 * the same plan (deep-equal pinned by tests).
 */
export function playerViewToDomPlan(
  view: PlayerViewModel,
  previousSvg: string | null,
): PlayerDomPlan {
  const buffering = view.frameSvg === null;
  const swapSvg = view.frameSvg !== null && view.frameSvg !== previousSvg ? view.frameSvg : null;
  const playbackLabel =
    view.playback === "ready"
      ? "Ready"
      : view.playback === "playing"
        ? "Playing"
        : view.playback === "paused"
          ? "Paused"
          : "Ended";
  const frameLabel = `frame ${String(view.frameIndex + 1)}/${String(view.frameCount)}`;
  const timeLabel = `${formatMs(view.positionMs)} / ${formatMs(view.durationMs)}`;
  return {
    swapSvg,
    showBuffering: buffering,
    bufferingText: buffering
      ? `Buffering frame ${String(view.frameIndex + 1)} of ${String(view.frameCount)} (${String(view.availableFrames)} available)`
      : null,
    statusText: `${playbackLabel} — ${frameLabel} — ${timeLabel}${view.loop ? " — loop" : ""}`,
  };
}
