import { describe, expect, test } from "bun:test";
import { FixtureDetectorAdapter } from "@sporta/perception-detection";
import { detectionsFromGroundTruth, generateFixtureFrames } from "../src/fixture";
import type { FixtureTrackSpec } from "../src/fixture";
import { FIXTURE_DETECTION_CONFIDENCE } from "../src/fixture";

/**
 * W204 fixture tests: hand-computed boxes from the documented interpolation
 * law (IDENTICAL to W201 — proven by deep-equality against the W201 fixture
 * detector), visibility windows, occlusions, frame conventions, degrade
 * transforms (dropEveryNth, swapAt), and validation. Constants only.
 */

// Dyadic (binary-exact) geometry so expected boxes are EXACT: with
// frames = 9, t = d/8 is dyadic, and 0.125 + 0.5 * (d/8) has no rounding —
// every asserted box below is hand-computed AND float-exact.
const LINEAR_PLAYER = {
  gtId: "p1",
  label: "player",
  motion: { kind: "linear", from: { x: 0.125, y: 0.5 }, to: { x: 0.625, y: 0.5 } } as const,
  size: { w: 0.25, h: 0.25 },
};

const STATIC_BALL = {
  gtId: "b1",
  label: "ball",
  motion: { kind: "static", at: { x: 0.75, y: 0.25 } } as const,
  size: { w: 0.125, h: 0.125 },
};

describe("generateFixtureFrames", () => {
  test("hand-computed boxes: linear motion follows t = d / max(frames - 1, 1)", () => {
    // 9 frames: t = d / 8 (dyadic). Player center x = 0.125 + 0.5 * d/8.
    //   d = 0 -> 0.125   (box x 0,      w 0.25)
    //   d = 3 -> 0.3125  (box x 0.1875)
    //   d = 8 -> 0.625   (box x 0.5)
    // y stays 0.5 -> box y 0.375, h 0.25. Ball static at (0.75, 0.25) ->
    // box (0.6875, 0.1875, 0.125, 0.125). All values dyadic -> exact.
    const frames = generateFixtureFrames([LINEAR_PLAYER, STATIC_BALL], { frames: 9 });
    expect(frames).toHaveLength(9);

    expect(frames[0]?.frame).toEqual({
      frameId: "f-0-0",
      presentationMs: 0,
      decodeOrder: 0,
    });
    expect(frames[0]?.groundTruth).toEqual([
      { gtId: "p1", label: "player", box: { x: 0, y: 0.375, w: 0.25, h: 0.25 } },
      { gtId: "b1", label: "ball", box: { x: 0.6875, y: 0.1875, w: 0.125, h: 0.125 } },
    ]);
    expect(frames[3]?.groundTruth[0]?.box).toEqual({ x: 0.1875, y: 0.375, w: 0.25, h: 0.25 });
    expect(frames[8]?.groundTruth[0]?.box).toEqual({ x: 0.5, y: 0.375, w: 0.25, h: 0.25 });
    // Every frame: 2 GT entries, spec order preserved.
    for (const frame of frames) {
      expect(frame.groundTruth).toHaveLength(2);
      expect(frame.groundTruth.map((e) => e.gtId)).toEqual(["p1", "b1"]);
    }
  });

  test("W201-consistency: GT boxes are deep-equal to the W201 fixture detector's output", () => {
    // The interpolation law and clamping are IDENTICAL to W201 — proven by
    // feeding the equivalent W201 spec and comparing every frame.
    const frames = 25;
    const w201 = new FixtureDetectorAdapter({
      detectorId: "det-consistency",
      frames,
      labels: [
        {
          label: "player",
          confidence: FIXTURE_DETECTION_CONFIDENCE,
          motion: LINEAR_PLAYER.motion,
          size: LINEAR_PLAYER.size,
        },
      ],
    });
    const ours = generateFixtureFrames([LINEAR_PLAYER], { frames });
    for (let d = 0; d < frames; d += 1) {
      const w201Boxes = w201.detect({
        frameId: `f-0-${d}`,
        presentationMs: d * 40,
        width: 4,
        height: 4,
        bytes: new Uint8Array(4 * 4 * 3),
        decodeOrder: d,
        streamIndex: 0,
      });
      expect(ours[d]?.groundTruth[0]?.box).toEqual(w201Boxes[0]?.box);
    }
  });

  test("frame conventions: f-0-<d>, presentationMs = d * frameMs, sceneCut markers", () => {
    const frames = generateFixtureFrames([LINEAR_PLAYER], {
      frames: 5,
      frameMs: 33,
      sceneCutFrames: new Set([2]),
    });
    expect(frames[1]?.frame).toEqual({ frameId: "f-0-1", presentationMs: 33, decodeOrder: 1 });
    expect(frames[2]?.frame).toEqual({
      frameId: "f-0-2",
      presentationMs: 66,
      decodeOrder: 2,
      sceneCut: true,
    });
    expect(frames[3]?.frame?.sceneCut).toBeUndefined(); // absent, not false
  });

  test("visibility window is inclusive and defaults to the full span", () => {
    const frames = generateFixtureFrames([{ ...LINEAR_PLAYER, visibleFrom: 2, visibleUntil: 4 }], {
      frames: 8,
    });
    expect(frames[1]?.groundTruth).toHaveLength(0);
    expect(frames[2]?.groundTruth).toHaveLength(1); // inclusive lower bound
    expect(frames[4]?.groundTruth).toHaveLength(1); // inclusive upper bound
    expect(frames[5]?.groundTruth).toHaveLength(0);
    // Motion interpolates over the FULL span regardless of the window:
    // frame 4 -> t = 4/7 -> center x = 0.125 + 0.5*4/7.
    expect(frames[4]?.groundTruth[0]?.box?.x).toBeCloseTo(0.125 + 0.5 * (4 / 7) - 0.125, 12);
  });

  test("occludedFrames remove GT entries inside the visibility window", () => {
    const occluded = new Set([2, 3, 4]);
    const frames = generateFixtureFrames([{ ...LINEAR_PLAYER, occludedFrames: occluded }], {
      frames: 8,
    });
    for (let d = 0; d < 8; d += 1) {
      expect(frames[d]?.groundTruth).toHaveLength(occluded.has(d) ? 0 : 1);
    }
    // The motion CONTINUES through the occlusion (frame 5 position uses
    // t = 5/7, not a re-parameterized window): center x = 0.125 + 0.5*5/7.
    expect(frames[5]?.groundTruth[0]?.box?.x).toBeCloseTo(0.125 + 0.5 * (5 / 7) - 0.125, 12);
  });

  test("boxes are clamped into the unit square exactly like W201", () => {
    // Center near the left edge with a wide box: left edge clamps to 0.
    // Dyadic values keep the expected box exact.
    const near = generateFixtureFrames(
      [
        {
          gtId: "n",
          label: "player",
          motion: { kind: "static", at: { x: 0.0625, y: 0.5 } },
          size: { w: 0.25, h: 0.25 },
        },
      ],
      { frames: 2 },
    );
    expect(near[0]?.groundTruth[0]?.box).toEqual({ x: 0, y: 0.375, w: 0.1875, h: 0.25 });
    // Center outside the frame: box pinned to the edge (zero-area here).
    const outside = generateFixtureFrames(
      [
        {
          gtId: "o",
          label: "player",
          motion: { kind: "static", at: { x: 1.25, y: 0.5 } },
          size: { w: 0.25, h: 0.25 },
        },
      ],
      { frames: 2 },
    );
    expect(outside[0]?.groundTruth[0]?.box).toEqual({ x: 1, y: 0.375, w: 0, h: 0.25 });
  });

  test("single frame: t = 0 via the max(frames - 1, 1) guard", () => {
    const frames = generateFixtureFrames([LINEAR_PLAYER], { frames: 1 });
    expect(frames).toHaveLength(1);
    expect(frames[0]?.groundTruth[0]?.box).toEqual({ x: 0, y: 0.375, w: 0.25, h: 0.25 }); // at `from`
  });

  test("deterministic: two generations are deep-equal", () => {
    const specs = [
      { ...LINEAR_PLAYER, occludedFrames: new Set([3]) },
      { ...STATIC_BALL, visibleFrom: 2 },
    ];
    expect(generateFixtureFrames(specs, { frames: 12, sceneCutFrames: new Set([7]) })).toEqual(
      generateFixtureFrames(specs, { frames: 12, sceneCutFrames: new Set([7]) }),
    );
  });

  test("rejects invalid specs and options", () => {
    expect(() => generateFixtureFrames([{ ...LINEAR_PLAYER, gtId: "" }], { frames: 5 })).toThrow(
      RangeError,
    );
    expect(() => generateFixtureFrames([{ ...LINEAR_PLAYER, label: "" }], { frames: 5 })).toThrow(
      RangeError,
    );
    expect(() => generateFixtureFrames([LINEAR_PLAYER], { frames: 0 })).toThrow(RangeError);
    expect(() => generateFixtureFrames([LINEAR_PLAYER], { frames: 2.5 })).toThrow(RangeError);
    expect(() => generateFixtureFrames([LINEAR_PLAYER], { frames: 5, frameMs: -1 })).toThrow(
      RangeError,
    );
  });
});

describe("detectionsFromGroundTruth", () => {
  test("strips gtId: boxes + labels + the fixed confidence, order preserved", () => {
    const frames = generateFixtureFrames([LINEAR_PLAYER, STATIC_BALL], { frames: 9 });
    const detections = detectionsFromGroundTruth(frames[2]!);
    expect(detections).toHaveLength(2);
    const gtPlayerBox = frames[2]!.groundTruth[0]!.box;
    const gtBallBox = frames[2]!.groundTruth[1]!.box;
    expect(detections[0]).toEqual({
      box: gtPlayerBox,
      label: "player",
      confidence: FIXTURE_DETECTION_CONFIDENCE,
    });
    expect(detections[1]).toEqual({
      box: gtBallBox,
      label: "ball",
      confidence: FIXTURE_DETECTION_CONFIDENCE,
    });
    // Identity never leaks into the tracker's input.
    expect(JSON.stringify(detections)).not.toContain("gtId");
    // Boxes are copies, not aliases of the GT.
    expect(detections[0]?.box).not.toBe(gtPlayerBox);
  });

  test("custom confidence replaces the fixed default", () => {
    const frames = generateFixtureFrames([LINEAR_PLAYER], { frames: 2 });
    const detections = detectionsFromGroundTruth(frames[0]!, { confidence: 0.55 });
    expect(detections[0]?.confidence).toBe(0.55);
  });

  test("dropEveryNth: drops every Nth entry per frame (1-based modulo)", () => {
    // 3 GT entries per frame; N = 2 drops the 2nd; N = 3 drops the 3rd.
    const specs = [
      { ...LINEAR_PLAYER, gtId: "a" },
      {
        ...LINEAR_PLAYER,
        gtId: "b",
        motion: { kind: "static", at: { x: 0.4375, y: 0.5 } } as const,
      },
      {
        ...LINEAR_PLAYER,
        gtId: "c",
        motion: { kind: "static", at: { x: 0.6875, y: 0.5 } } as const,
      },
    ];
    const frames = generateFixtureFrames(specs, { frames: 2 });
    const every2 = detectionsFromGroundTruth(frames[0]!, { degrade: { dropEveryNth: 2 } });
    expect(every2.map((d) => d.label)).toHaveLength(2); // entries 1 and 3 survive
    const every3 = detectionsFromGroundTruth(frames[0]!, { degrade: { dropEveryNth: 3 } });
    expect(every3).toHaveLength(2); // entries 1 and 2 survive
    const every1 = detectionsFromGroundTruth(frames[0]!, { degrade: { dropEveryNth: 1 } });
    expect(every1).toHaveLength(0); // degenerate: drops everything (documented)
  });

  test("swapAt: the two named entries' boxes are exchanged from the frame on", () => {
    // Two static players at distinct dyadic positions; swap gtA/gtB boxes
    // from frame 1 on. Before: boxes in natural order; from frame 1:
    // exchanged.
    const specs: FixtureTrackSpec[] = [
      {
        gtId: "a",
        label: "player",
        motion: { kind: "static", at: { x: 0.3125, y: 0.5 } },
        size: { w: 0.25, h: 0.25 },
      },
      {
        gtId: "b",
        label: "player",
        motion: { kind: "static", at: { x: 0.5625, y: 0.5 } },
        size: { w: 0.25, h: 0.25 },
      },
    ];
    const frames = generateFixtureFrames(specs, { frames: 3 });
    const degrade = { swapAt: { frame: 1, gtA: "a", gtB: "b" } } as const;

    const before = detectionsFromGroundTruth(frames[0]!, { degrade });
    expect(before[0]?.box).toEqual({ x: 0.1875, y: 0.375, w: 0.25, h: 0.25 }); // a's own box
    expect(before[1]?.box).toEqual({ x: 0.4375, y: 0.375, w: 0.25, h: 0.25 }); // b's own box

    const after = detectionsFromGroundTruth(frames[1]!, { degrade });
    expect(after[0]?.box).toEqual({ x: 0.4375, y: 0.375, w: 0.25, h: 0.25 }); // slot a carries b's box
    expect(after[1]?.box).toEqual({ x: 0.1875, y: 0.375, w: 0.25, h: 0.25 }); // slot b carries a's box
    // Labels stay with their slots (the "detector" confused the boxes).
    expect(after.map((d) => d.label)).toEqual(["player", "player"]);
    // The GT itself is untouched (the swap is detection-side only).
    expect(frames[1]?.groundTruth[0]?.box).toEqual({ x: 0.1875, y: 0.375, w: 0.25, h: 0.25 });
  });

  test("swapAt is a no-op on frames where either object is missing (occlusion)", () => {
    const specs: FixtureTrackSpec[] = [
      {
        gtId: "a",
        label: "player",
        motion: { kind: "static", at: { x: 0.3125, y: 0.5 } },
        size: { w: 0.25, h: 0.25 },
      },
      {
        gtId: "b",
        label: "player",
        motion: { kind: "static", at: { x: 0.5625, y: 0.5 } },
        size: { w: 0.25, h: 0.25 },
        occludedFrames: new Set([1]),
      },
    ];
    const frames = generateFixtureFrames(specs, { frames: 3 });
    const degrade = { swapAt: { frame: 0, gtA: "a", gtB: "b" } } as const;
    // Frame 1: b is occluded -> only a's detection, unswapped.
    const frame1 = detectionsFromGroundTruth(frames[1]!, { degrade });
    expect(frame1).toHaveLength(1);
    expect(frame1[0]?.box).toEqual({ x: 0.1875, y: 0.375, w: 0.25, h: 0.25 });
  });

  test("rejects invalid degrade options", () => {
    const frames = generateFixtureFrames([LINEAR_PLAYER], { frames: 2 });
    expect(() => detectionsFromGroundTruth(frames[0]!, { confidence: 1.5 })).toThrow(RangeError);
    expect(() => detectionsFromGroundTruth(frames[0]!, { degrade: { dropEveryNth: 0 } })).toThrow(
      RangeError,
    );
    expect(() => detectionsFromGroundTruth(frames[0]!, { degrade: { dropEveryNth: 1.5 } })).toThrow(
      RangeError,
    );
    expect(() =>
      detectionsFromGroundTruth(frames[0]!, {
        degrade: { swapAt: { frame: -1, gtA: "a", gtB: "b" } },
      }),
    ).toThrow(RangeError);
    expect(() =>
      detectionsFromGroundTruth(frames[0]!, {
        degrade: { swapAt: { frame: 0, gtA: "a", gtB: "a" } },
      }),
    ).toThrow(RangeError);
  });
});
