/**
 * DOM plan tests (W702): the PURE decision layer between the player
 * view-model and the DOM adapter — svg swaps only on change, buffering
 * overlay derivation, and deterministic status text. This is the headless
 * stand-in for DOM testing (the adapter itself is thin/browser-only; see
 * `src/dom-adapter.ts`).
 */
import { describe, expect, test } from "bun:test";
import { playerViewToDomPlan } from "../src/dom-plan.ts";
import type { PlayerViewModel } from "../src/player.ts";
import { buildHandOutput } from "./helpers.ts";
import { createFramePlayer } from "../src/player.ts";
import { fakeClock } from "./helpers.ts";

function vmOf(overrides: Partial<PlayerViewModel>): PlayerViewModel {
  return {
    playback: "ready",
    buffering: false,
    positionMs: 0,
    durationMs: 5_000,
    timelineMs: 1_000,
    frameIndex: 0,
    frameCount: 5,
    frameSvg: "<svg>frame-0</svg>",
    availableFrames: 5,
    loop: false,
    renderer: { rendererId: "r", rendererVersion: "0.1.0", styleId: "s" },
    output: { startMs: 1_000, frameIntervalMs: 1_000 },
    ...overrides,
  };
}

describe("playerViewToDomPlan — svg swap decisions", () => {
  test("a new frame swaps; the same frame does not (no flicker)", () => {
    const vm = vmOf({ frameSvg: "<svg>a</svg>" });
    expect(playerViewToDomPlan(vm, null)).toEqual({
      swapSvg: "<svg>a</svg>",
      showBuffering: false,
      bufferingText: null,
      statusText: "Ready — frame 1/5 — 0.0s / 5.0s",
    });
    expect(playerViewToDomPlan(vm, "<svg>a</svg>").swapSvg).toBe(null);
    expect(playerViewToDomPlan(vm, "<svg>b</svg>").swapSvg).toBe("<svg>a</svg>");
  });

  test("a missing frame never swaps and shows the buffering overlay with text", () => {
    const vm = vmOf({ frameSvg: null, frameIndex: 2, frameCount: 6, availableFrames: 2 });
    const plan = playerViewToDomPlan(vm, "<svg>previous</svg>");
    expect(plan.swapSvg).toBe(null);
    expect(plan.showBuffering).toBe(true);
    expect(plan.bufferingText).toBe("Buffering frame 3 of 6 (2 available)");
  });

  test("an available frame hides the overlay and clears its text", () => {
    const plan = playerViewToDomPlan(vmOf({}), null);
    expect(plan.showBuffering).toBe(false);
    expect(plan.bufferingText).toBe(null);
  });
});

describe("playerViewToDomPlan — deterministic status text", () => {
  test.each([
    ["ready", "Ready"],
    ["playing", "Playing"],
    ["paused", "Paused"],
    ["ended", "Ended"],
  ] as const)("playback %s renders %s", (playback, label) => {
    const plan = playerViewToDomPlan(vmOf({ playback, positionMs: 1_234 }), null);
    expect(plan.statusText).toBe(`${label} — frame 1/5 — 1.2s / 5.0s`);
  });

  test("loop is appended when armed", () => {
    const plan = playerViewToDomPlan(vmOf({ loop: true }), null);
    expect(plan.statusText).toBe("Ready — frame 1/5 — 0.0s / 5.0s — loop");
  });

  test("the plan is a pure function (same inputs, same output)", () => {
    const vm = vmOf({ playback: "playing", positionMs: 2_500, frameIndex: 2 });
    expect(playerViewToDomPlan(vm, null)).toEqual(playerViewToDomPlan(vm, null));
  });
});

describe("playerViewToDomPlan — driven by a real player (integration with the view-model)", () => {
  test("playing through a stall keeps the previous svg while buffering", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = buildHandOutput([0, 1_000]);
    player.load({ manifest: output.manifest, frames: [] });
    player.play();

    clock.advance(500);
    player.tick();
    let plan = playerViewToDomPlan(player.view(), null);
    expect(plan.showBuffering).toBe(true); // frame 0 not supplied yet
    expect(plan.swapSvg).toBe(null);

    player.supplyFrame(output.frames[0]!);
    plan = playerViewToDomPlan(player.view(), null);
    expect(plan.showBuffering).toBe(false);
    expect(plan.swapSvg).toBe(output.frames[0]!.svg);
  });
});
