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
import type { SegmentPlayerViewModel } from "./segment-player.ts";
import type { LivePlayerViewModel } from "./live-player.ts";

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

// ---------------------------------------------------------------------------
// The live presentation plan (W704)
// ---------------------------------------------------------------------------

/**
 * What the DOM adapter should do for one LIVE view-model snapshot: swap the
 * displayed frame when it differs, toggle the buffering overlay (the live
 * player's honest stall seam — content overdue by more than one declared
 * interval), and the status line. The richer live status surface (headline,
 * accounting, reconnect countdown) is the PURE `./live-plan.ts` plan.
 */
export interface LiveDomPlan {
  /** The SVG to render when it differs from the displayed one; else `null`. */
  swapSvg: string | null;
  /** Whether the buffering overlay must be visible. */
  showBuffering: boolean;
  /** The overlay text (defined iff `showBuffering`). */
  bufferingText: string | null;
  /** The status line (always defined; deterministic from the view-model). */
  statusText: string;
}

/**
 * Derives the live DOM plan. Deterministic pure function — the same inputs
 * yield the same plan (deep-equal pinned by tests).
 */
export function liveViewToDomPlan(
  view: LivePlayerViewModel,
  previousSvg: string | null,
): LiveDomPlan {
  const buffering = view.buffering;
  const swapSvg = view.frameSvg !== null && view.frameSvg !== previousSvg ? view.frameSvg : null;
  if (view.frame === null) {
    return {
      swapSvg,
      showBuffering: false,
      bufferingText: null,
      statusText: "Live — waiting for the stream…",
    };
  }
  const latencyLabel =
    view.latencyMs === null ? "" : ` — delivery latency ${(view.latencyMs / 1000).toFixed(1)}s`;
  return {
    swapSvg,
    showBuffering: buffering,
    bufferingText: buffering
      ? `Buffering — the live edge is overdue (last frame @ ${String(view.frame.timestampMs)} ms, ${String(view.bufferedAhead)} frame${view.bufferedAhead === 1 ? "" : "s"} buffered ahead)`
      : null,
    statusText:
      `Live — frame ${String(view.frame.frameIndex)} @ ${String(view.frame.timestampMs)} ms` +
      ` — ${String(view.bufferedAhead)} frame${view.bufferedAhead === 1 ? "" : "s"} buffered ahead` +
      latencyLabel,
  };
}

// ---------------------------------------------------------------------------
// The SMIL segment presentation plan (W705)
// ---------------------------------------------------------------------------

/**
 * What the DOM adapter should do for one SEGMENT view-model snapshot: swap
 * the (single, self-animating) document when it changes, and — the W705
 * honest-control contract — the `smil` sync instruction from the pure player
 * (`seekMs` non-null exactly on discontinuous playhead moves: the adapter
 * re-locks the presented document's SMIL clock with `setCurrentTime`; the
 * `paused` flag drives `pauseAnimations`/`unpauseAnimations`). The buffering
 * overlay never shows for a complete segment document (constant `false`).
 */
export interface SegmentDomPlan {
  /** The document to mount when it differs from the displayed one; else `null`. */
  swapSvg: string | null;
  /** Constantly `false` — the segment document is complete at load. */
  showBuffering: false;
  /** Constantly `null` (paired with `showBuffering: false`). */
  bufferingText: null;
  /** The status line (always defined; deterministic from the view-model). */
  statusText: string;
  /** SMIL sync instruction, VERBATIM from the pure player's view. */
  smil: SegmentPlayerViewModel["smil"];
}

/**
 * Derives the segment DOM plan. Deterministic pure function — the same
 * inputs yield the same plan (deep-equal pinned by tests).
 */
export function segmentViewToDomPlan(
  view: SegmentPlayerViewModel,
  previousSvg: string | null,
): SegmentDomPlan {
  const swapSvg = view.document !== previousSvg ? view.document : null;
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
    showBuffering: false,
    bufferingText: null,
    statusText: `${playbackLabel} — ${frameLabel} — ${timeLabel} — self-animating SMIL document${view.loop ? " — loop" : ""}`,
    smil: view.smil,
  };
}
