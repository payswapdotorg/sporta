/**
 * THE REALITY-SWITCH STATE MACHINE (W905 — Simulation G, made executable).
 *
 * `docs/testing/ux-operational-simulation.md` Simulation G: "The same match
 * session is held constant while the renderer changes. The control plane
 * issues a new renderer request against the same SWM-backed session; the
 * player does not reload the match page. Renderer-specific controls remain
 * scoped to that renderer."
 *
 * This module is that invariant, as a pure state machine the watch page
 * runs client-side:
 *
 * - the MATCH SESSION is part of the machine's identity and can NEVER
 *   change (no transition accepts or produces a different session — a
 *   switch is `state → state` on the SAME session, provably no reload);
 * - a switch to a renderer that is not `ready` is REJECTED with the
 *   option's real reason (capability-driven + rights-aware);
 * - every successful switch is recorded (the epoch/switch counters let
 *   tests and the UI prove the page stayed up across N switches);
 * - the machine never performs I/O or navigation — the component's only
 *   effect per switch is fetching the newly-selected renderer's output for
 *   the SAME session (the Simulation G fetch).
 */

import type { RealityOption } from "./surface-state";

/** The machine's state — the session is FROZEN at creation. */
export interface RealityMachineState {
  /** The match session — CONSTANT for the machine's whole life. */
  readonly sessionId: string;
  /** The currently-selected reality (a renderer id). */
  readonly selectedRendererId: string | null;
  /** How many successful switches have happened (never resets). */
  readonly switches: number;
  /** Increments on every accepted switch (a "no reload" witness). */
  readonly epoch: number;
}

/** The result of one switch attempt. */
export type RealityTransition =
  | { status: "switched"; state: RealityMachineState }
  | { status: "rejected"; state: RealityMachineState; reason: string };

/** Creates the machine for ONE match session. The session never changes. */
export function createRealityMachine(
  sessionId: string,
  options: readonly RealityOption[],
  preferredRendererId: string | null,
): RealityMachineState {
  const initial = { sessionId, selectedRendererId: null as string | null, switches: 0, epoch: 0 };
  const preferred =
    preferredRendererId !== null
      ? options.find((o) => o.rendererId === preferredRendererId)
      : undefined;
  if (preferred !== undefined && preferred.state === "ready") {
    return { ...initial, selectedRendererId: preferred.rendererId };
  }
  const firstReady = options.find((option) => option.state === "ready");
  return firstReady === undefined
    ? initial
    : { ...initial, selectedRendererId: firstReady.rendererId };
}

/**
 * Attempts one reality switch — SAME session, new renderer. A switch only
 * happens for an option that is `ready` (a stored output exists for THIS
 * session under that renderer); every other attempt is rejected with the
 * real reason the capability/watch data carries.
 */
export function switchReality(
  state: RealityMachineState,
  options: readonly RealityOption[],
  rendererId: string,
): RealityTransition {
  const option = options.find((entry) => entry.rendererId === rendererId);
  if (option === undefined) {
    return {
      status: "rejected",
      state,
      reason: "unknown renderer — it is not offered for this match",
    };
  }
  if (option.state !== "ready") {
    return { status: "rejected", state, reason: option.reason };
  }
  if (state.selectedRendererId === rendererId) {
    return {
      status: "rejected",
      state,
      reason: "this reality is already showing",
    };
  }
  // The ONLY accepted transition: same session, new selected renderer.
  return {
    status: "switched",
    state: {
      sessionId: state.sessionId,
      selectedRendererId: rendererId,
      switches: state.switches + 1,
      epoch: state.epoch + 1,
    },
  };
}
