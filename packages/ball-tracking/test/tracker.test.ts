import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_GAP_FRAMES,
  DEFAULT_MAX_STEP,
  DEFAULT_TRACKER_ID,
  NearestBoxBallTracker,
} from "../src/nearest-box";
import type { BallObservationFrame } from "../src/tracker";
import { generateScenarioFrames } from "../src/scenario";
import type { BallScenarioSpec } from "../src/scenario";

const LINEAR_SPEC: BallScenarioSpec = {
  label: "tracker-linear",
  fps: 25,
  durationMs: 2000,
  flight: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [],
  detectionNoise: 0,
  dropRate: 0,
};

/** Linear flight helper: exact ground-truth center of frame k (50 frames). */
const linearCenterX = (k: number): number => 0.2 + 0.6 * (k / 49);

/** Hand-built single-ball frame at 25 fps with a 0.04x0.04 box. */
function ballFrame(k: number, center: { x: number; y: number }): BallObservationFrame {
  return {
    frameId: `f-0-${k}`,
    presentationMs: k * 40,
    decodeOrder: k,
    detections: [
      {
        box: { x: center.x - 0.02, y: center.y - 0.02, w: 0.04, h: 0.04 },
        label: "ball",
        confidence: 0.85,
      },
    ],
  };
}

function boxCenterOf(point: { box?: { x: number; y: number; w: number; h: number } }): {
  x: number;
  y: number;
} {
  const box = point.box;
  if (box === undefined) throw new Error("point has no box");
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

describe("NearestBoxBallTracker", () => {
  test("clean linear scenario: ONE track, 0 gaps, all points detected", () => {
    const { frames } = generateScenarioFrames(LINEAR_SPEC);
    expect(frames).toHaveLength(50);

    const tracks = new NearestBoxBallTracker().track(frames);
    expect(tracks).toHaveLength(1);

    const [track] = tracks;
    if (track === undefined) throw new Error("track missing");
    expect(track.trackId).toBe("bt-0-1");
    expect(track.points).toHaveLength(50);
    expect(track.occlusionGaps).toEqual([]);
    expect(track.points.every((point) => point.source === "detected")).toBe(true);
    expect(track.points.every((point) => point.confidence === 0.85)).toBe(true);

    // Edges: the track starts and ends on the observed endpoints of the flight.
    const first = track.points[0];
    const last = track.points[49];
    if (first === undefined || last === undefined) throw new Error("points missing");
    expect(first.frameId).toBe("f-0-0");
    expect(first.presentationMs).toBe(0);
    expect(boxCenterOf(first).x).toBeCloseTo(linearCenterX(0), 12);
    expect(last.frameId).toBe("f-0-49");
    expect(last.presentationMs).toBe(1960);
    expect(boxCenterOf(last).x).toBeCloseTo(linearCenterX(49), 12);

    // Every detected point sits exactly on the flight (positions linear).
    for (const [k, point] of track.points.entries()) {
      expect(boxCenterOf(point).x).toBeCloseTo(linearCenterX(k), 12);
      expect(boxCenterOf(point).y).toBeCloseTo(0.5, 12);
    }
  });

  test("contract hygiene: trackerId defaults and is overridable; options validated", () => {
    expect(new NearestBoxBallTracker().trackerId).toBe(DEFAULT_TRACKER_ID);
    expect(new NearestBoxBallTracker({ trackerId: "bt-test" }).trackerId).toBe("bt-test");
    // Defaults are the documented ones.
    expect(DEFAULT_MAX_STEP).toBe(0.15);
    expect(DEFAULT_MAX_GAP_FRAMES).toBe(12);

    expect(() => new NearestBoxBallTracker({ trackerId: "" })).toThrow(RangeError);
    expect(() => new NearestBoxBallTracker({ maxStep: 0 })).toThrow(RangeError);
    expect(() => new NearestBoxBallTracker({ maxGapFrames: -1 })).toThrow(RangeError);
    expect(() => new NearestBoxBallTracker({ maxGapFrames: 1.5 })).toThrow(RangeError);
  });

  test("occlusion 400ms @ 25fps (10 frames < 12): gap bridged, interpolation exact", () => {
    const spec: BallScenarioSpec = {
      ...LINEAR_SPEC,
      label: "tracker-occluded-bridged",
      occlusions: [{ fromMs: 200, toMs: 600 }], // frames 5..14 (ms 200..560) occluded
    };
    const { frames } = generateScenarioFrames(spec);
    const tracks = new NearestBoxBallTracker().track(frames);

    expect(tracks).toHaveLength(1);
    const [track] = tracks;
    if (track === undefined) throw new Error("track missing");
    expect(track.points).toHaveLength(50); // 40 detected + 10 interpolated
    expect(track.occlusionGaps).toEqual([{ fromMs: 200, toMs: 560, bridged: true }]);

    const detectedCount = track.points.filter((p) => p.source === "detected").length;
    const interpolated = track.points.filter((p) => p.source === "interpolated");
    expect(detectedCount).toBe(40);
    expect(interpolated).toHaveLength(10);
    // Interpolated frames are exactly the occluded ones, in order.
    expect(interpolated.map((p) => p.frameId)).toEqual(
      Array.from({ length: 10 }, (_, i) => `f-0-${5 + i}`),
    );

    // Confidence decay EXACT: 0.85 -> 0.425 (gapElapsed 1..4) -> 0.2125
    // (5..8) -> 0.10625 (9..10); the halving schedule is
    // base * 0.5^ceil(gapElapsed/4) with base = the anchor detection's 0.85.
    expect(interpolated.map((p) => p.confidence)).toEqual([
      0.425,
      0.425,
      0.425,
      0.425, // gapElapsed 1..4
      0.2125,
      0.2125,
      0.2125,
      0.2125, // gapElapsed 5..8
      0.10625,
      0.10625, // gapElapsed 9..10
    ]);

    // Positions linear: each interpolated box is the exact lerp between the
    // observed anchor boxes (frames 4 and 15), and the flight is linear so
    // the centers coincide with the ground-truth flight.
    const anchorA = frames[4]?.detections[0]?.box;
    const anchorB = frames[15]?.detections[0]?.box;
    if (anchorA === undefined || anchorB === undefined) throw new Error("anchors missing");
    for (const [i, point] of interpolated.entries()) {
      const k = 5 + i;
      const u = (k - 4) / 11;
      const expectedBox = {
        x: anchorA.x + (anchorB.x - anchorA.x) * u,
        y: anchorA.y + (anchorB.y - anchorA.y) * u,
        w: anchorA.w + (anchorB.w - anchorA.w) * u,
        h: anchorA.h + (anchorB.h - anchorA.h) * u,
      };
      expect(point.box).toEqual(expectedBox);
      const center = boxCenterOf(point);
      expect(center.x).toBeCloseTo(linearCenterX(k), 12);
      expect(center.y).toBeCloseTo(0.5, 12);
    }

    // The anchors around the gap are detected points.
    expect(track.points[4]?.source).toBe("detected");
    expect(track.points[15]?.source).toBe("detected");
  });

  test("occlusion 1000ms @ 25fps (25 frames > 12): track closed unbridged, new track after the gap", () => {
    const spec: BallScenarioSpec = {
      ...LINEAR_SPEC,
      label: "tracker-occluded-long",
      fps: 25,
      durationMs: 3000, // 75 frames, ms 0..2960
      occlusions: [{ fromMs: 400, toMs: 1400 }], // frames 10..34 (25 frames) occluded
    };
    const { frames } = generateScenarioFrames(spec);
    const tracks = new NearestBoxBallTracker().track(frames);

    // Two tracks => one id switch by construction.
    expect(tracks).toHaveLength(2);

    const [first, second] = tracks;
    if (first === undefined || second === undefined) throw new Error("tracks missing");

    // Track 1: frames 0..9 observed; the gap is closed UNBRIDDED when the
    // too-late re-observation (frame 35, ms 1400) is rejected.
    expect(first.trackId).toBe("bt-0-1");
    expect(first.points).toHaveLength(10);
    expect(first.points[0]?.frameId).toBe("f-0-0");
    expect(first.points[9]?.frameId).toBe("f-0-9");
    expect(first.points.every((p) => p.source === "detected")).toBe(true);
    expect(first.occlusionGaps).toEqual([{ fromMs: 400, toMs: 1400, bridged: false }]);

    // Track 2: seeded one frame AFTER the rejected re-observation (a later
    // detection seeds the new track), running to the end of input.
    expect(second.trackId).toBe("bt-36-2");
    expect(second.points).toHaveLength(39); // frames 36..74
    expect(second.points[0]?.frameId).toBe("f-0-36");
    expect(second.points[0]?.presentationMs).toBe(1440);
    expect(second.points[38]?.frameId).toBe("f-0-74");
    expect(second.occlusionGaps).toEqual([]);
  });

  test("maxStep enforcement: a ball beyond the per-frame step is never claimed", () => {
    // Steps of 0.3/frame exceed maxStep 0.15; the accumulated gate
    // (maxStep * frameSteps) can never catch a constant-overspeed ball, so
    // the detections stay unclaimed and the (single) track honestly reports
    // an unresolved trailing gap. No association is invented.
    const frames = [
      ballFrame(0, { x: 0.1, y: 0.5 }),
      ballFrame(1, { x: 0.4, y: 0.5 }),
      ballFrame(2, { x: 0.7, y: 0.5 }),
    ];
    const tracks = new NearestBoxBallTracker().track(frames);
    expect(tracks).toHaveLength(1);
    const [track] = tracks;
    if (track === undefined) throw new Error("track missing");
    expect(track.points).toHaveLength(1);
    expect(track.points[0]?.frameId).toBe("f-0-0");
    expect(track.occlusionGaps).toEqual([{ fromMs: 40, toMs: 80, bridged: false }]);
  });

  test("maxStep boundary: displacement exactly maxStep associates (inclusive gate)", () => {
    const frames = [
      ballFrame(0, { x: 0.1, y: 0.5 }),
      ballFrame(1, { x: 0.25, y: 0.5 }), // displacement exactly 0.15
    ];
    const tracks = new NearestBoxBallTracker().track(frames);
    expect(tracks).toHaveLength(1);
    const [track] = tracks;
    if (track === undefined) throw new Error("track missing");
    expect(track.points).toHaveLength(2);
    expect(track.occlusionGaps).toEqual([]);
    expect(track.points[1]?.frameId).toBe("f-0-1");
  });

  test("maxStep enforcement (overspeed streak): the too-long unassociable gap closes the track; a LATER detection re-seeds", () => {
    // Ball at 0.02/frame (overspeed vs maxStep 0.01) for frames 1..8, then
    // 0.001/frame (trackable). The overspeed streak makes the frame gap
    // grow past maxGapFrames (12): when frame 14's detection arrives with a
    // 13-frame gap, the track closes (the detection is rejected), and the
    // NEXT detection (frame 15) seeds track 2 — which now tracks the slowed
    // ball fully.
    const centers: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < 30; k += 1) {
      const fast = Math.min(k, 8) * 0.02;
      const slow = Math.max(0, k - 8) * 0.001;
      centers.push({ x: 0.1 + fast + slow, y: 0.5 });
    }
    const frames = centers.map((center, k) => ballFrame(k, center));
    const tracker = new NearestBoxBallTracker({ maxStep: 0.01 });
    const tracks = tracker.track(frames);

    expect(tracks).toHaveLength(2);
    const [first, second] = tracks;
    if (first === undefined || second === undefined) throw new Error("tracks missing");

    // Track 1: only the seed observation; closed by rejecting the frame-14
    // re-observation (gap 13 > 12), gap recorded unbridged.
    expect(first.trackId).toBe("bt-0-1");
    expect(first.points).toHaveLength(1);
    expect(first.occlusionGaps).toEqual([{ fromMs: 40, toMs: 560, bridged: false }]);

    // Track 2: seeded at the first detection AFTER the rejected one.
    expect(second.trackId).toBe("bt-15-2");
    expect(second.points).toHaveLength(15); // frames 15..29, all associated
    expect(second.points[0]?.frameId).toBe("f-0-15");
    expect(second.occlusionGaps).toEqual([]);
  });

  test("label-agnostic seam: accepts any detections (label filtering is the caller's)", () => {
    const frames = [
      {
        frameId: "f-0-0",
        presentationMs: 0,
        decodeOrder: 0,
        detections: [
          {
            box: { x: 0.28, y: 0.48, w: 0.04, h: 0.04 },
            label: "player",
            confidence: 0.7,
          },
        ],
      },
      {
        frameId: "f-0-1",
        presentationMs: 40,
        decodeOrder: 1,
        detections: [
          {
            box: { x: 0.3, y: 0.48, w: 0.04, h: 0.04 },
            label: "player",
            confidence: 0.7,
          },
        ],
      },
    ];
    const tracks = new NearestBoxBallTracker().track(frames);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.points).toHaveLength(2);
    expect(tracks[0]?.points.every((p) => p.confidence === 0.7)).toBe(true);
  });

  test("greedy multi-candidate frames: the nearest unclaimed candidate wins the extension", () => {
    // Seed = the frame's FIRST unclaimed detection (array order); extension
    // picks the NEAREST candidate in later frames — the other candidates are
    // clutter and never seed tracks of their own (forward-only scan).
    const frames: BallObservationFrame[] = [
      {
        frameId: "f-0-0",
        presentationMs: 0,
        decodeOrder: 0,
        detections: [
          {
            box: { x: 0.48, y: 0.48, w: 0.04, h: 0.04 },
            label: "ball",
            confidence: 0.85,
          },
          {
            box: { x: 0.18, y: 0.48, w: 0.04, h: 0.04 },
            label: "ball",
            confidence: 0.6,
          },
        ],
      },
      {
        frameId: "f-0-1",
        presentationMs: 40,
        decodeOrder: 1,
        detections: [
          {
            box: { x: 0.38, y: 0.48, w: 0.04, h: 0.04 },
            label: "ball",
            confidence: 0.85,
          }, // displacement 0.1 from the seed — the nearest
          {
            box: { x: 0.22, y: 0.48, w: 0.04, h: 0.04 },
            label: "ball",
            confidence: 0.6,
          },
        ],
      },
    ];
    const tracks = new NearestBoxBallTracker().track(frames);
    expect(tracks).toHaveLength(1);
    const [track] = tracks;
    if (track === undefined) throw new Error("track missing");
    expect(track.points).toHaveLength(2);
    const first = track.points[0];
    const second = track.points[1];
    if (first === undefined || second === undefined) throw new Error("points missing");
    expect(boxCenterOf(first)).toEqual({ x: 0.5, y: 0.5 });
    expect(boxCenterOf(second)).toEqual({ x: 0.4, y: 0.5 });
    expect(track.occlusionGaps).toEqual([]);
  });

  test("determinism: the same frames produce deep-equal tracks", () => {
    const spec: BallScenarioSpec = {
      ...LINEAR_SPEC,
      label: "tracker-determinism",
      occlusions: [{ fromMs: 200, toMs: 600 }],
    };
    const { frames } = generateScenarioFrames(spec);
    const tracker = new NearestBoxBallTracker();
    expect(tracker.track(frames)).toEqual(tracker.track(frames));
  });

  test("input hygiene: fails loud on malformed frame sequences", () => {
    const good = generateScenarioFrames(LINEAR_SPEC).frames;
    const frame0 = good[0];
    const frame1 = good[1];
    if (frame0 === undefined || frame1 === undefined) throw new Error("frames missing");
    expect(new NearestBoxBallTracker().track([])).toEqual([]);
    expect(
      new NearestBoxBallTracker().track([
        { frameId: "f-0-0", presentationMs: 0, decodeOrder: 0, detections: [] },
      ]),
    ).toEqual([]);

    // Non-ascending presentationMs.
    expect(() => new NearestBoxBallTracker().track([frame1, frame0])).toThrow(RangeError);
    // Duplicate frameId.
    expect(() => new NearestBoxBallTracker().track([frame0, frame0])).toThrow(RangeError);
    // Out-of-range detection confidence.
    expect(() =>
      new NearestBoxBallTracker().track([
        {
          frameId: "f-0-0",
          presentationMs: 0,
          decodeOrder: 0,
          detections: [
            { box: { x: 0.4, y: 0.4, w: 0.04, h: 0.04 }, label: "ball", confidence: 1.5 },
          ],
        },
      ]),
    ).toThrow(RangeError);
    // Out-of-range box field.
    expect(() =>
      new NearestBoxBallTracker().track([
        {
          frameId: "f-0-0",
          presentationMs: 0,
          decodeOrder: 0,
          detections: [
            { box: { x: 1.4, y: 0.4, w: 0.04, h: 0.04 }, label: "ball", confidence: 0.85 },
          ],
        },
      ]),
    ).toThrow(RangeError);
  });
});
