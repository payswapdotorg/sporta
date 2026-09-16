import { describe, expect, test } from "bun:test";
import { createRealityMachine, switchReality } from "../src/lib/reality-machine";
import type { RealityMachineState } from "../src/lib/reality-machine";
import type { RealityOption } from "../src/lib/surface-state";

/**
 * THE REALITY-SWITCH STATE MACHINE (W905, Simulation G) — the pure core the
 * watch page runs. These tests pin the simulation's own invariants:
 *
 * - the MATCH SESSION is frozen into the machine and NO transition can ever
 *   produce or accept a different session (switching is not navigation);
 * - only `ready` options switch; every other attempt is rejected WITH the
 *   option's real reason (capability-driven + rights-aware);
 * - unknown renderers are rejected and never part of the machine's world;
 * - the switches/epoch counters are the "the page stayed up" witness.
 *
 * The option lists below are fixtures FOR the machine's logic (the route-level
 * test drives the real seeded data end-to-end).
 */

function option(
  rendererId: string,
  state: RealityOption["state"],
  reason: string,
  extra: { renderId?: string; segmentId?: string } = {},
): RealityOption {
  return {
    rendererId,
    state,
    reason,
    ...(extra.renderId !== undefined ? { renderId: extra.renderId } : {}),
    ...(extra.segmentId !== undefined ? { segmentId: extra.segmentId } : {}),
  };
}

const READY_A = option("anime.prototype", "ready", "a stored output is available for this match", {
  renderId: "r-2",
  segmentId: "seg-1",
});
const READY_B = option("sporta.testcard", "ready", "a stored output is available for this match", {
  renderId: "r-1",
  segmentId: "seg-9",
});
const NO_OUTPUT = option(
  "sporta.testcard",
  "no-stored-output",
  "a render exists (r-1) but no stored output is available for it in this format yet",
  { renderId: "r-1" },
);
const REQUIRES_RENDER = option(
  "tactical.3d",
  "requires-render",
  "no render has been requested for this match with this renderer yet",
);
const RIGHTS = option(
  "anime.prototype",
  "rights-denied",
  "this content's rights do not permit stored playback",
);
const UNAVAILABLE = option(
  "anime.prototype",
  "renderer-unavailable",
  "the renderer is degraded (provider-degraded)",
);

const MIXED: readonly RealityOption[] = [READY_A, NO_OUTPUT, REQUIRES_RENDER];

describe("createRealityMachine (the session is the machine's identity)", () => {
  test("the machine is created for ONE session — the session can never change", () => {
    const state = createRealityMachine("ms-derby", MIXED, null);
    expect(state.sessionId).toBe("ms-derby");
    expect(state.switches).toBe(0);
    expect(state.epoch).toBe(0);
  });

  test("with no preferred renderer, the FIRST ready option is selected", () => {
    const state = createRealityMachine("ms-derby", MIXED, null);
    expect(state.selectedRendererId).toBe("anime.prototype");
  });

  test("a preferred renderer is honored only when it is ready", () => {
    const state = createRealityMachine("ms-derby", MIXED, "sporta.testcard");
    // testcard is no-stored-output in MIXED — the machine falls back to ready.
    expect(state.selectedRendererId).toBe("anime.prototype");
    const preferred = createRealityMachine("ms-derby", MIXED, "anime.prototype");
    expect(preferred.selectedRendererId).toBe("anime.prototype");
  });

  test("no ready option at all selects nothing (the page shows its honest verdict)", () => {
    const state = createRealityMachine(
      "ms-denied",
      [NO_OUTPUT, REQUIRES_RENDER, RIGHTS, UNAVAILABLE],
      null,
    );
    expect(state.selectedRendererId).toBeNull();
  });

  test("an empty option list selects nothing", () => {
    const state = createRealityMachine("ms-x", [], null);
    expect(state.selectedRendererId).toBeNull();
  });
});

describe("switchReality (same session, new renderer)", () => {
  test("an accepted switch bumps switches+epoch and keeps the SAME session", () => {
    const start = createRealityMachine("ms-derby", [READY_A, READY_B], null);
    const transition = switchReality(start, [READY_A, READY_B], "sporta.testcard");
    expect(transition.status).toBe("switched");
    if (transition.status !== "switched") return;
    expect(transition.state.sessionId).toBe("ms-derby");
    expect(transition.state.selectedRendererId).toBe("sporta.testcard");
    expect(transition.state.switches).toBe(1);
    expect(transition.state.epoch).toBe(1);
  });

  test("N successive switches keep the session constant (Simulation G, executable)", () => {
    const options = [READY_A, READY_B];
    let state: RealityMachineState = createRealityMachine("ms-derby", options, null);
    for (let i = 0; i < 5; i += 1) {
      const target = i % 2 === 0 ? "sporta.testcard" : "anime.prototype";
      const transition = switchReality(state, options, target);
      expect(transition.state.sessionId).toBe("ms-derby");
      state = transition.state;
    }
    // All five hops were accepted (each flipped to the other renderer).
    expect(state.selectedRendererId).toBe("sporta.testcard");
    expect(state.switches).toBe(5);
    expect(state.epoch).toBe(5);
  });

  test("switching to the already-showing reality is rejected — nothing happens", () => {
    const state = createRealityMachine("ms-derby", MIXED, null); // anime selected
    const transition = switchReality(state, MIXED, "anime.prototype");
    expect(transition.status).toBe("rejected");
    if (transition.status !== "rejected") return;
    expect(transition.reason).toBe("this reality is already showing");
    expect(transition.state).toBe(state);
  });

  test("a non-ready option is rejected WITH ITS REAL REASON and no state change", () => {
    const state = createRealityMachine("ms-derby", MIXED, null);
    const noOutput = switchReality(state, MIXED, "sporta.testcard");
    expect(noOutput.status).toBe("rejected");
    expect(noOutput.status === "rejected" && noOutput.reason).toBe(NO_OUTPUT.reason);

    const rights = switchReality(state, [RIGHTS, READY_B], "anime.prototype");
    expect(rights.status).toBe("rejected");
    expect(rights.status === "rejected" && rights.reason).toBe(RIGHTS.reason);

    const requires = switchReality(state, [REQUIRES_RENDER, READY_A], "tactical.3d");
    expect(requires.status).toBe("rejected");
    expect(requires.status === "rejected" && requires.reason).toBe(REQUIRES_RENDER.reason);

    const unavailable = switchReality(state, [UNAVAILABLE, READY_B], "anime.prototype");
    expect(unavailable.status).toBe("rejected");
    expect(unavailable.status === "rejected" && unavailable.reason).toBe(UNAVAILABLE.reason);

    for (const transition of [noOutput, rights, requires, unavailable]) {
      if (transition.status === "rejected") expect(transition.state).toBe(state);
    }
  });

  test("an unknown renderer is rejected and never offered", () => {
    const state = createRealityMachine("ms-derby", MIXED, null);
    const transition = switchReality(state, MIXED, "holo.deck");
    expect(transition.status).toBe("rejected");
    expect(transition.status === "rejected" && transition.reason).toBe(
      "unknown renderer — it is not offered for this match",
    );
    expect(MIXED.some((o) => o.rendererId === "holo.deck")).toBe(false);
  });

  test("the machine is pure — the same inputs always yield the same transition", () => {
    const state = createRealityMachine("ms-derby", [READY_A, READY_B], null);
    const a = switchReality(state, [READY_A, READY_B], "sporta.testcard");
    const b = switchReality(state, [READY_A, READY_B], "sporta.testcard");
    expect(a).toEqual(b);
    expect(state.switches).toBe(0); // untouched
  });
});
