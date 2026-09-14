/**
 * The player DOM adapter (W702) — the thin, BROWSER-ONLY layer that applies
 * {@link PlayerDomPlan} to a container element.
 *
 * Honest testing boundary (deliberate, no DOM-testing dependency): all
 * DECISION logic lives in the pure `playerViewToDomPlan`
 * (`./dom-plan.ts`, tested headlessly). This module only performs the DOM
 * writes: swapping the SVG string into the stage, toggling the buffering
 * overlay, and setting the status line. It is compile-checked but NOT
 * unit-tested — real-browser E2E arrives with W705/W706.
 */
import { playerViewToDomPlan } from "./dom-plan.ts";
import type { PlayerDomPlan } from "./dom-plan.ts";
import type { PlayerViewModel } from "./player.ts";

/** The mounted player DOM handle. */
export interface PlayerDom {
  /** Applies one view-model snapshot (computes the plan, then writes). */
  update(view: PlayerViewModel): void;
  /** Reads back the last applied plan (test/debug convenience). */
  lastPlan(): PlayerDomPlan | null;
  /** Removes everything this adapter created from the container. */
  unmount(): void;
}

/**
 * Mounts a player stage into `container`: an SVG stage element, a buffering
 * overlay (hidden unless the plan says buffering), and a status line.
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
  let lastPlan: PlayerDomPlan | null = null;

  return {
    update(view: PlayerViewModel): void {
      const plan = playerViewToDomPlan(view, currentSvg);
      lastPlan = plan;
      if (plan.swapSvg !== null) {
        // The W502 frame is a full `<svg>` document; injecting it as markup.
        stage.innerHTML = plan.swapSvg;
        currentSvg = plan.swapSvg;
      }
      overlay.hidden = !plan.showBuffering;
      if (plan.showBuffering && plan.bufferingText !== null) {
        overlay.textContent = plan.bufferingText;
      }
      statusLine.textContent = plan.statusText;
    },
    lastPlan(): PlayerDomPlan | null {
      return lastPlan;
    },
    unmount(): void {
      container.replaceChildren();
      currentSvg = null;
      lastPlan = null;
    },
  };
}
