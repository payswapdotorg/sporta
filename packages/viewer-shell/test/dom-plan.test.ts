/**
 * DOM plan tests (W702 + W705 + W704): the PURE decision layer between the
 * player view-model and the DOM adapter — svg swaps only on change, buffering
 * overlay derivation, and deterministic status text (the W702 frame plan),
 * plus the W705 SEGMENT plan (the ONE self-animating document's mount
 * decision and the smil sync instruction the DOM edge consumes), and the
 * W704 LIVE plan (the live frame swap + the honest re-buffer overlay + the
 * status line; no SMIL timeline exists for a live stream). This is the
 * headless stand-in for DOM testing (the adapter itself is
 * thin/browser-only; see `src/dom-adapter.ts`).
 */
import { describe, expect, test } from "bun:test";
import { playerViewToDomPlan, segmentViewToDomPlan, liveViewToDomPlan } from "../src/dom-plan.ts";
import type { PlayerViewModel } from "../src/player.ts";
import type { SegmentPlayerViewModel } from "../src/segment-player.ts";
import type { LivePlayerViewModel } from "../src/live-player.ts";
import { buildHandOutput, buildHandSegment, fakeClock } from "./helpers.ts";
import { createFramePlayer } from "../src/player.ts";
import { createSegmentPlayer } from "../src/segment-player.ts";

function vmOf(overrides: Partial<PlayerViewModel>): PlayerViewModel {
  return {
    kind: "frames",
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

// ---------------------------------------------------------------------------
// The W705 segment plan (segmentViewToDomPlan)
// ---------------------------------------------------------------------------

describe("segmentViewToDomPlan — the W705 SMIL segment decisions", () => {
  function segmentVmOf(overrides: Partial<SegmentPlayerViewModel>): SegmentPlayerViewModel {
    return {
      kind: "segment",
      playback: "ready",
      buffering: false,
      positionMs: 0,
      durationMs: 3_000,
      frameIndex: 0,
      frameCount: 3,
      document: "<svg>segment-doc</svg>",
      segmentId: "anime-clip-0badcafe",
      contentType: "image/svg+xml",
      contentHash: "a".repeat(64),
      byteLength: 100,
      loop: false,
      smil: { paused: true, seekMs: 0 },
      renderer: { rendererId: "anime.prototype", rendererVersion: "0.1.0", styleId: "default" },
      output: { startMs: 0, frameIntervalMs: 1_000 },
      ...overrides,
    };
  }

  test("a fresh mount swaps the ONE document; the same document never re-swaps (no flicker)", () => {
    const vm = segmentVmOf({});
    expect(segmentViewToDomPlan(vm, null).swapSvg).toBe("<svg>segment-doc</svg>");
    expect(segmentViewToDomPlan(vm, "<svg>segment-doc</svg>").swapSvg).toBe(null);
    expect(segmentViewToDomPlan(vm, "<svg>other</svg>").swapSvg).toBe("<svg>segment-doc</svg>");
  });

  test("the buffering overlay is a constant never (the document is complete at load)", () => {
    const plan = segmentViewToDomPlan(
      segmentVmOf({ playback: "playing", positionMs: 1_234 }),
      null,
    );
    expect(plan.showBuffering).toBe(false);
    expect(plan.bufferingText).toBe(null);
  });

  test("the smil sync instruction passes through VERBATIM (the DOM-edge contract)", () => {
    const seek = segmentViewToDomPlan(
      segmentVmOf({ smil: { paused: false, seekMs: 1_234 } }),
      "<svg>segment-doc</svg>",
    );
    expect(seek.smil).toEqual({ paused: false, seekMs: 1_234 });
    const natural = segmentViewToDomPlan(
      segmentVmOf({ smil: { paused: false, seekMs: null } }),
      "<svg>segment-doc</svg>",
    );
    expect(natural.smil).toEqual({ paused: false, seekMs: null });
  });

  test.each([
    ["ready", "Ready"],
    ["playing", "Playing"],
    ["paused", "Paused"],
    ["ended", "Ended"],
  ] as const)("playback %s renders %s with the self-animating note", (playback, label) => {
    const plan = segmentViewToDomPlan(segmentVmOf({ playback, positionMs: 1_234 }), null);
    expect(plan.statusText).toBe(
      `${label} — frame 1/3 — 1.2s / 3.0s — self-animating SMIL document`,
    );
  });

  test("loop is appended when armed; the frame index and time track the view", () => {
    const plan = segmentViewToDomPlan(
      segmentVmOf({ loop: true, playback: "paused", frameIndex: 2, positionMs: 2_500 }),
      "<svg>segment-doc</svg>",
    );
    expect(plan.statusText).toBe(
      "Paused — frame 3/3 — 2.5s / 3.0s — self-animating SMIL document — loop",
    );
  });

  test("the plan is a pure function (same inputs, same output)", () => {
    const vm = segmentVmOf({ playback: "playing", positionMs: 2_000, frameIndex: 2 });
    expect(segmentViewToDomPlan(vm, null)).toEqual(segmentViewToDomPlan(vm, null));
  });

  test("driven by a real segment player: swap exactly at load, smil sync flows, ticks never swap", () => {
    const clock = fakeClock();
    const player = createSegmentPlayer({ clock: () => clock.now() });
    const segment = buildHandSegment({ timestamps: [0, 1_000, 2_000] });

    // Before load the view's document is the empty string (the composition
    // never renders an unmounted playback — the detail pane mounts the
    // playback section only once `view.playback` is non-null), so the pure
    // plan answers an empty swap against a null previous document.
    let plan = segmentViewToDomPlan(player.view(), null);
    expect(plan.swapSvg).toBe("");

    expect(player.load({ segment, manifest: segment.manifest }).ok).toBe(true);
    plan = segmentViewToDomPlan(player.view(), null);
    expect(plan.swapSvg).toBe(segment.content); // the ONE document mounts
    expect(segmentViewToDomPlan(player.view(), segment.content).swapSvg).toBe(null);

    player.play();
    plan = segmentViewToDomPlan(player.view(), segment.content);
    expect(plan.swapSvg).toBe(null); // play re-locks, never re-swaps
    expect(plan.smil).toEqual({ paused: false, seekMs: 0 });

    clock.advance(1_500);
    player.tick();
    plan = segmentViewToDomPlan(player.view(), segment.content);
    expect(plan.swapSvg).toBe(null); // natural ticks animate the document
    expect(plan.smil).toEqual({ paused: false, seekMs: null });
    expect(plan.statusText).toContain("frame 2/3");

    player.pause();
    plan = segmentViewToDomPlan(player.view(), segment.content);
    expect(plan.smil).toEqual({ paused: true, seekMs: 1_500 });
  });
});

// ---------------------------------------------------------------------------
// The W704 live plan (liveViewToDomPlan)
// ---------------------------------------------------------------------------

describe("liveViewToDomPlan — the W704 live presentation decisions", () => {
  function liveVmOf(overrides: Partial<LivePlayerViewModel>): LivePlayerViewModel {
    return {
      kind: "live",
      buffering: false,
      playheadMs: 4_000,
      frame: { windowOrdinal: 3, frameIndex: 1, timestampMs: 4_000 },
      frameSvg: "<svg>live-1</svg>",
      frameCount: 8,
      bufferedAhead: 3,
      windowsApplied: 4,
      frameIntervalMs: 1_000,
      liveEdgeMs: 7_000,
      latencyMs: 120,
      lastDisplayedFrame: 7,
      ...overrides,
    };
  }

  test("swaps the frame svg only when it differs from the displayed one", () => {
    const view = liveVmOf({});
    expect(liveViewToDomPlan(view, null).swapSvg).toBe("<svg>live-1</svg>");
    expect(liveViewToDomPlan(view, "<svg>live-1</svg>").swapSvg).toBe(null);
    expect(
      liveViewToDomPlan(liveVmOf({ frameSvg: "<svg>live-2</svg>" }), "<svg>live-1</svg>").swapSvg,
    ).toBe("<svg>live-2</svg>");
  });

  test("before the first applied window: no frame, no overlay, the honest waiting line", () => {
    const view = liveVmOf({
      frame: null,
      frameSvg: null,
      playheadMs: null,
      frameCount: 0,
      bufferedAhead: 0,
      windowsApplied: 0,
      frameIntervalMs: null,
      liveEdgeMs: null,
      latencyMs: null,
      lastDisplayedFrame: null,
    });
    const plan = liveViewToDomPlan(view, null);
    expect(plan.swapSvg).toBe(null);
    expect(plan.showBuffering).toBe(false);
    expect(plan.bufferingText).toBe(null);
    expect(plan.statusText).toBe("Live — waiting for the stream…");
  });

  test("the buffering overlay shows exactly while re-buffering, with the honest evidence line", () => {
    const plan = liveViewToDomPlan(liveVmOf({}), null);
    expect(plan.showBuffering).toBe(false);
    const stalled = liveViewToDomPlan(
      liveVmOf({
        buffering: true,
        bufferedAhead: 0,
        frame: { windowOrdinal: 3, frameIndex: 1, timestampMs: 4_000 },
      }),
      "<svg>live-1</svg>",
    );
    expect(stalled.showBuffering).toBe(true);
    expect(stalled.bufferingText).toContain("Buffering");
    expect(stalled.bufferingText).toContain("0 frames buffered ahead");
    expect(stalled.swapSvg).toBe(null); // the stalled frame stays presented
  });

  test("the status line carries the real seams: frame, buffered ahead, and the delivery latency only when present", () => {
    const plan = liveViewToDomPlan(liveVmOf({}), null);
    expect(plan.statusText).toBe(
      "Live — frame 1 @ 4000 ms — 3 frames buffered ahead — delivery latency 0.1s",
    );
    // Absent latency stays absent (never a faked 0.0s).
    const noLatency = liveViewToDomPlan(liveVmOf({ latencyMs: null }), null);
    expect(noLatency.statusText).toBe("Live — frame 1 @ 4000 ms — 3 frames buffered ahead");
    // Singular grammar.
    const singular = liveViewToDomPlan(liveVmOf({ bufferedAhead: 1 }), null);
    expect(singular.statusText).toContain("1 frame buffered ahead");
  });

  test("purity: the same inputs yield the deep-equal plan (deep-equal rerun)", () => {
    const view = liveVmOf({});
    expect(liveViewToDomPlan(view, null)).toEqual(
      liveViewToDomPlan(JSON.parse(JSON.stringify(view)) as LivePlayerViewModel, null),
    );
    expect(liveViewToDomPlan(view, "<svg>live-1</svg>")).toEqual(
      liveViewToDomPlan(view, "<svg>live-1</svg>"),
    );
  });
});
