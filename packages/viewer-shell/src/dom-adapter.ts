/**
 * The player DOM adapter (W702 + W705) — the thin, BROWSER-ONLY layer that
 * applies the pure DOM plans to a container element.
 *
 * Honest testing boundary (deliberate, no DOM-testing dependency): all
 * DECISION logic lives in the pure plan modules (`./dom-plan.ts` — the frame
 * plan `playerViewToDomPlan` and the W705 segment plan
 * `segmentViewToDomPlan`, both tested headlessly). This module only performs
 * the DOM writes:
 *
 * - frame-sequence views: swap the current frame's SVG string into the
 *   stage, toggle the buffering overlay, set the status line;
 * - segment views (W705): mount the ONE self-animating SVG document when it
 *   changes, then command the presented document's REAL SMIL timeline per
 *   the view's `smil` sync instruction — `pauseAnimations` /
 *   `unpauseAnimations` for the paused flag, `setCurrentTime(ms / 1000)` to
 *   re-lock the document clock on discontinuous playhead moves. These are
 *   the standard `SVGSVGElement` animation controls — the browser genuinely
 *   pauses/seeks the document's animation timeline; nothing is faked
 *   headlessly (the pure model is the declared timeline; the DOM edge owns
 *   the actual one).
 *
 * It is compile-checked but NOT unit-tested — real-browser E2E arrives with
 * W706 (paint-level); the data path through the real provider/player is
 * exercised headlessly end-to-end in `test/playback-e2e.test.ts`.
 */
import { playerViewToDomPlan, segmentViewToDomPlan } from "./dom-plan.ts";
import type { PlayerDomPlan, SegmentDomPlan } from "./dom-plan.ts";
import type { PlayerViewModel } from "./player.ts";
import type { SegmentPlayerViewModel } from "./segment-player.ts";

/** The union of playback view-models the adapter can present. */
export type PlaybackViewModel = PlayerViewModel | SegmentPlayerViewModel;

/** The mounted player DOM handle. */
export interface PlayerDom {
  /** Applies one view-model snapshot (computes the plan, then writes). */
  update(view: PlaybackViewModel): void;
  /** Reads back the last applied plan (test/debug convenience). */
  lastPlan(): PlayerDomPlan | SegmentDomPlan | null;
  /** Removes everything this adapter created from the container. */
  unmount(): void;
}

/**
 * Mounts a player stage into `container`: an SVG stage element, a buffering
 * overlay (hidden unless the plan says buffering — never for segments), and
 * a status line.
 */
export function mountPlayer(container: HTMLElement): PlayerDom {
  container.replaceChildren();

  const stage = document.createElement("div");
  stage.className = "player-stage";

  const overlay = document.createElement("div");
  overlay.className = "player-buffering";
  overlay.setAttribute("role", "status");
  overlay.hidden = true;

  const statusLine = document.createElement("p");
  statusLine.className = "player-status";

  container.append(stage, overlay, statusLine);

  let currentSvg: string | null = null;
  let lastPlan: PlayerDomPlan | SegmentDomPlan | null = null;
  let lastPaused: boolean | null = null;

  /**
   * Applies one segment plan: mount the document when it changes, then sync
   * the presented document's SMIL timeline (`seekMs` re-locks the clock;
   * `paused` pauses/unpauses the animations). A fresh document starts with
   * its SMIL clock at 0, so the very first sync after a swap applies BOTH
   * the current position and the paused state.
   */
  function applySegmentPlan(plan: SegmentDomPlan): void {
    if (plan.swapSvg !== null) {
      // The W504 segment is a full `<svg>` document; injecting it as markup
      // makes its SMIL timeline live in this DOM.
      stage.innerHTML = plan.swapSvg;
      currentSvg = plan.swapSvg;
      lastPaused = null; // a fresh document: re-apply the paused state
    }
    const svg = stage.querySelector("svg");
    if (svg !== null && svg instanceof SVGSVGElement) {
      if (plan.smil.seekMs !== null) {
        svg.setCurrentTime(plan.smil.seekMs / 1000);
      }
      if (lastPaused !== plan.smil.paused) {
        if (plan.smil.paused) {
          svg.pauseAnimations();
        } else {
          svg.unpauseAnimations();
        }
        lastPaused = plan.smil.paused;
      }
    }
  }

  return {
    update(view: PlaybackViewModel): void {
      if (view.kind === "segment") {
        const plan = segmentViewToDomPlan(view, currentSvg);
        lastPlan = plan;
        applySegmentPlan(plan);
        overlay.hidden = true;
        statusLine.textContent = plan.statusText;
        return;
      }
      const plan = playerViewToDomPlan(view, currentSvg);
      lastPlan = plan;
      if (plan.swapSvg !== null) {
        // The W502 frame is a full `<svg>` document; injecting it as markup.
        stage.innerHTML = plan.swapSvg;
        currentSvg = plan.swapSvg;
        lastPaused = null;
      }
      overlay.hidden = !plan.showBuffering;
      if (plan.showBuffering && plan.bufferingText !== null) {
        overlay.textContent = plan.bufferingText;
      }
      statusLine.textContent = plan.statusText;
    },
    lastPlan(): PlayerDomPlan | SegmentDomPlan | null {
      return lastPlan;
    },
    unmount(): void {
      container.replaceChildren();
      currentSvg = null;
      lastPlan = null;
      lastPaused = null;
    },
  };
}
