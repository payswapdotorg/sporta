import { describe, expect, test } from "bun:test";
import { NearestBoxBallTracker, generateScenarioFrames } from "@sporta/ball-tracking";
import type { BallScenarioSpec, BallTrack, BallTrackPoint } from "@sporta/ball-tracking";
import { BallStateInputError, BallStateOptionsError, estimateBallState } from "../src/state";

/** Local structural box type (the normalized-box shape of a track point). */
type HandBox = { x: number; y: number; w: number; h: number };

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * Clean linear flight, no occlusion, no noise, 25 fps, 1 s: 25 frames
 * (k = 0..24, presentationMs = 40k, totalMs = 960). The center moves from
 * (0.2, 0.2) to (0.8, 0.5): dx = 0.6, dy = 0.3.
 *
 * Analytic velocity (hand-computed): per 2 frames the center advances
 * dx * 2/24 = 0.05 and dy * 2/24 = 0.025 over 80 ms = 0.08 s, so
 * vx = 0.05/0.08 = 0.625 and vy = 0.025/0.08 = 0.3125 image-units/s —
 * the units are per SECOND with times in milliseconds.
 */
const CLEAN_LINEAR: BallScenarioSpec = {
  label: "state-clean-linear",
  fps: 25,
  durationMs: 1000,
  flight: { kind: "linear", from: { x: 0.2, y: 0.2 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [],
  detectionNoise: 0,
  dropRate: 0,
};

/**
 * Linear flight with a 400 ms BRIDGED occlusion (frames 5..14): 50 frames
 * (k = 0..49, presentationMs = 40k, totalMs = 1960), center x from 0.2 to
 * 0.8, y constant 0.5. Analytic vx = 0.6 * 1000/1960 = 0.306122448...,
 * vy = 0.
 */
const BRIDGED_400: BallScenarioSpec = {
  label: "state-bridged-400",
  fps: 25,
  durationMs: 2000,
  flight: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [{ fromMs: 200, toMs: 600 }],
  detectionNoise: 0,
  dropRate: 0,
};

/**
 * Linear flight with a 1000 ms UNBRIDGED occlusion [200, 1200): frames
 * 5..29 lose the detection, the re-observation at frame 30 is too late
 * (gap 25 > maxGapFrames 12), so the tracker closes track bt-0-1 (frames
 * 0..4) and track bt-31-2 re-seeds at frame 31 (frames 31..49). Merged
 * series: 24 points. Default maxSpanMs = 2.5 * 40 = 100 ms.
 */
const UNBRIDGED_1000: BallScenarioSpec = {
  label: "state-unbridged-1000",
  fps: 25,
  durationMs: 2000,
  flight: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [{ fromMs: 200, toMs: 1200 }],
  detectionNoise: 0,
  dropRate: 0,
};

/** Runs the W202 pipeline + estimator for a scenario. */
function seriesForSpec(spec: BallScenarioSpec) {
  const { frames } = generateScenarioFrames(spec);
  const tracks = new NearestBoxBallTracker().track(frames);
  const series = estimateBallState(tracks, { fps: spec.fps });
  return { series, tracks };
}

/** Hand-built track point with a center-derived 0.04x0.04 box. */
function handPoint(
  frameId: string,
  presentationMs: number,
  source: "detected" | "interpolated",
  confidence: number,
  box: HandBox,
): BallTrackPoint {
  return { frameId, presentationMs, box, source, confidence };
}

describe("estimateBallState — merge, tie-break, gap union", () => {
  const BOX: HandBox = { x: 0.48, y: 0.48, w: 0.04, h: 0.04 };

  test("points merge by presentationMs with the documented tie-break (frameId, then trackId)", () => {
    // Two tracks with points at the SAME presentationMs: "f-a" must sort
    // before "f-b" regardless of track order; equal frameIds break the tie
    // by trackId ("bt-3-1" before "bt-9-2").
    const trackLate: BallTrack = {
      trackId: "bt-9-2",
      points: [handPoint("f-b", 100, "detected", 0.85, BOX)],
      occlusionGaps: [],
    };
    const trackEarly: BallTrack = {
      trackId: "bt-3-1",
      points: [
        handPoint("f-a", 100, "detected", 0.85, BOX),
        handPoint("f-x", 100, "detected", 0.85, BOX),
      ],
      occlusionGaps: [],
    };
    const trackOther: BallTrack = {
      trackId: "bt-5-1",
      points: [handPoint("f-x", 100, "interpolated", 0.4, BOX)],
      occlusionGaps: [],
    };
    // Presentation order dominates: ms 40 first, then the ms-100 cluster.
    const trackFirst: BallTrack = {
      trackId: "bt-7-3",
      points: [handPoint("f-z", 40, "detected", 0.85, BOX)],
      occlusionGaps: [],
    };

    const series = estimateBallState([trackLate, trackEarly, trackOther, trackFirst], { fps: 25 });
    expect(series.points.map((point) => point.frameId)).toEqual([
      "f-z",
      "f-a",
      "f-b",
      "f-x",
      "f-x",
    ]);
    // The two "f-x" points tie on frameId: trackId "bt-3-1" < "bt-5-1".
    expect(series.points[3]?.trackId).toBe("bt-3-1");
    expect(series.points[4]?.trackId).toBe("bt-5-1");
    // Velocity eligibility on the tie-break fixture, index by index:
    // index 0 (series start), indices 2..3 (degenerate zero time span
    // between equal-ms neighbors), and index 4 (series end) are all
    // undefined; index 1 is bracketed by 40 ms and 100 ms (span 60 ms <=
    // 100) and DOES carry a velocity.
    expect(series.points[0]?.velocity).toBeUndefined();
    expect(series.points[1]?.velocity).toBeDefined();
    expect(series.points[2]?.velocity).toBeUndefined();
    expect(series.points[3]?.velocity).toBeUndefined();
    expect(series.points[4]?.velocity).toBeUndefined();
  });

  test("gap union merges overlapping/touching windows; bridged is the conjunction; output sorted by fromMs", () => {
    // Sorted input: [80,160,false], [80,200,true], [400,500,true].
    // 80 <= 160 (touching) -> merge into [80,200] with bridged false&&true
    // = false (an unbridged constituent must not overstate coverage);
    // 400 > 200 -> a separate window.
    const trackA: BallTrack = {
      trackId: "bt-0-1",
      points: [
        handPoint("f-0-0", 0, "detected", 0.85, BOX),
        handPoint("f-0-1", 40, "detected", 0.85, BOX),
      ],
      occlusionGaps: [{ fromMs: 80, toMs: 200, bridged: true }],
    };
    const trackB: BallTrack = {
      trackId: "bt-5-2",
      points: [
        handPoint("f-0-2", 80, "detected", 0.85, BOX),
        handPoint("f-0-3", 240, "detected", 0.85, BOX),
      ],
      occlusionGaps: [
        { fromMs: 400, toMs: 500, bridged: true },
        { fromMs: 80, toMs: 160, bridged: false },
      ],
    };
    const series = estimateBallState([trackA, trackB], { fps: 25 });
    expect(series.gaps).toEqual([
      { fromMs: 80, toMs: 200, bridged: false },
      { fromMs: 400, toMs: 500, bridged: true },
    ]);
  });

  test("empty track list -> empty series with the canonical ball entity", () => {
    const series = estimateBallState([], { fps: 25 });
    expect(series.entityId).toBe("ball");
    expect(series.points).toEqual([]);
    expect(series.gaps).toEqual([]);
  });
});

describe("estimateBallState — velocity on a clean linear run", () => {
  const { series } = seriesForSpec(CLEAN_LINEAR);

  test("25 points, all detected, one track, no gaps, ordered by presentationMs", () => {
    expect(series.points).toHaveLength(25);
    expect(series.entityId).toBe("ball");
    expect(new Set(series.points.map((point) => point.trackId))).toEqual(new Set(["bt-0-1"]));
    expect(series.gaps).toEqual([]);
    expect(series.points.map((point) => point.presentationMs)).toEqual(
      Array.from({ length: 25 }, (_, k) => k * 40),
    );
    for (const point of series.points) {
      expect(point.source).toBe("detected");
      expect(point.confidence).toBe(0.85);
    }
  });

  test("every interior point carries the analytic constant velocity (within 1e-9)", () => {
    // Hand-computed frame pair: p(0) = (0.2, 0.2), p(1) = (0.225, 0.2125),
    // p(2) = (0.25, 0.225); v(1) = (p(2) - p(0)) / 0.08s = (0.05, 0.025)/0.08
    // = (0.625, 0.3125) image-units per SECOND.
    for (const [index, point] of series.points.entries()) {
      if (index === 0 || index === series.points.length - 1) continue;
      expect(point.velocity).toBeDefined();
      expect(point.velocity?.vx).toBeCloseTo(0.625, 9);
      expect(point.velocity?.vy).toBeCloseTo(0.3125, 9);
    }
    // Exactly the 23 interior points (indices 1..23).
    expect(series.points.filter((point) => point.velocity !== undefined)).toHaveLength(23);
  });

  test("series endpoints have NO velocity — omission, not zero-fill", () => {
    const first = series.points[0];
    const last = series.points[series.points.length - 1];
    expect(first?.velocity).toBeUndefined();
    expect(last?.velocity).toBeUndefined();
    expect("velocity" in (first ?? {})).toBe(false);
    expect("velocity" in (last ?? {})).toBe(false);
  });
});

describe("estimateBallState — velocity across gaps", () => {
  test("400 ms BRIDGED occlusion: interior interpolated points keep velocity (near-constant, matching linear interpolation)", () => {
    const { series } = seriesForSpec(BRIDGED_400);
    expect(series.points).toHaveLength(50); // frames 0..49, no frame missing

    // The gap is bridged: frames 5..14 are interpolated, gap record
    // [200, 560] bridged (fromMs = first interpolated frame, toMs = last).
    expect(series.gaps).toEqual([{ fromMs: 200, toMs: 560, bridged: true }]);
    for (const k of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      expect(series.points[k]?.source).toBe("interpolated");
    }

    // The span rule holds everywhere (consecutive 80 ms <= 100 ms), so all
    // 48 interior points carry velocity — including every interpolated one.
    expect(series.points.filter((point) => point.velocity !== undefined)).toHaveLength(48);

    // Interpolated velocities match the linear flight's analytic constant
    // (linear interpolation between exact anchors on a uniform linear
    // flight reproduces the slope exactly):
    const analyticVx = ((0.8 - 0.2) * 1000) / 1960;
    for (const k of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      const velocity = series.points[k]?.velocity;
      expect(velocity).toBeDefined();
      expect(velocity?.vx).toBeCloseTo(analyticVx, 9);
      expect(velocity?.vy).toBe(0);
    }
  });

  test("the FIRST and LAST points of the whole series never carry velocity", () => {
    const { series } = seriesForSpec(BRIDGED_400);
    expect(series.points[0]?.velocity).toBeUndefined();
    expect(series.points[49]?.velocity).toBeUndefined();
  });

  test("1000 ms UNBRIDGED gap: points adjacent to the gap boundary have NO velocity — hand-computed index set", () => {
    const { series } = seriesForSpec(UNBRIDGED_1000);
    expect(series.points).toHaveLength(24); // frames 0..4 + 31..49

    // Fragmentation stays visible: 5 points from bt-0-1, 19 from bt-31-2.
    expect(series.points.slice(0, 5).map((point) => point.trackId)).toEqual(
      Array.from({ length: 5 }, () => "bt-0-1"),
    );
    expect(series.points.slice(5).every((point) => point.trackId === "bt-31-2")).toBe(true);

    // Hand-computed eligibility (default maxSpanMs = 2.5 * 40 = 100 ms):
    //   frame 1..3 (indices 1..3): bracketed by 40 ms-apart neighbors (span
    //     80 ms <= 100) -> DEFINED;
    //   frame 4 (index 4): neighbors frame 3 (120 ms) and frame 31
    //     (1240 ms) -> span 1120 ms > 100 -> OMITTED;
    //   frame 31 (index 5): neighbors frame 4 (160 ms) and frame 32
    //     (1280 ms) -> span 1120 ms > 100 -> OMITTED;
    //   frames 32..48 (indices 6..22): span 80 ms -> DEFINED;
    //   frame 0 and frame 49: series ends -> OMITTED.
    const eligible = new Set([
      "f-0-1",
      "f-0-2",
      "f-0-3",
      ...Array.from({ length: 17 }, (_, i) => `f-0-${32 + i}`),
    ]);
    for (const point of series.points) {
      if (eligible.has(point.frameId)) {
        expect(point.velocity).toBeDefined();
      } else {
        expect(point.velocity).toBeUndefined();
      }
    }
    expect(series.points.filter((point) => point.velocity !== undefined)).toHaveLength(20);

    // The unbridged gap is passthrough (fromMs = first lost frame, toMs =
    // the too-late re-observation's presentationMs — a bookkeeping
    // endpoint, not an observation).
    expect(series.gaps).toEqual([{ fromMs: 200, toMs: 1200, bridged: false }]);
  });

  test("widening maxSpanMs flips the gap-boundary points to defined (the rule is the span, not the gap)", () => {
    const { frames } = generateScenarioFrames(UNBRIDGED_1000);
    const tracks = new NearestBoxBallTracker().track(frames);
    const series = estimateBallState(tracks, { fps: 25, velocity: { maxSpanMs: 1200 } });
    // With a 1200 ms window the 1120 ms boundary spans qualify: frames 4
    // and 31 gain velocity; 20 + 2 = 22 defined points.
    expect(series.points.filter((point) => point.velocity !== undefined)).toHaveLength(22);
    expect(series.points[4]?.velocity).toBeDefined();
    expect(series.points[5]?.velocity).toBeDefined();
  });
});

describe("estimateBallState — confidence honesty", () => {
  const { series } = seriesForSpec(BRIDGED_400);

  test("detected points pass 0.85 through verbatim", () => {
    for (const point of series.points) {
      if (point.source === "detected") {
        expect(point.confidence).toBe(0.85);
      }
    }
  });

  test("interpolated points carry the exact W202 decay", () => {
    // W202 formula (copied from nearest-box.ts): with anchor frame i = 4
    // and interpolated frame k, gapElapsed = k - i and
    //   confidence(k) = anchorConfidence * 0.5 ^ ceil(gapElapsed / 4)
    // anchorConfidence = 0.85 (the scenario's BALL_DETECTION_CONFIDENCE).
    for (const k of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      const point = series.points[k];
      const expected = 0.85 * Math.pow(0.5, Math.ceil((k - 4) / 4));
      expect(point?.confidence).toBe(expected);
    }
    // The documented schedule in plain numbers:
    expect(series.points.slice(5, 9).map((p) => p.confidence)).toEqual([
      0.425, 0.425, 0.425, 0.425,
    ]);
    expect(series.points.slice(9, 13).map((p) => p.confidence)).toEqual([
      0.2125, 0.2125, 0.2125, 0.2125,
    ]);
    expect(series.points.slice(13, 15).map((p) => p.confidence)).toEqual([0.10625, 0.10625]);
  });

  test("mean confidence over the occluded scenario is BELOW the detection level (no inflation)", () => {
    // (40 detected * 0.85 + 4*0.425 + 4*0.2125 + 2*0.10625) / 50
    //   = (34 + 1.7 + 0.85 + 0.2125) / 50 = 36.7625 / 50 = 0.73525.
    const mean =
      series.points.reduce((sum, point) => sum + point.confidence, 0) / series.points.length;
    expect(mean).toBeCloseTo(0.73525, 12);
    expect(mean).toBeLessThan(0.85);
  });

  test("confidence never increases across a gap (monotone non-increasing within the gap run)", () => {
    // The gap run is frames 5..14 (the consecutive interpolated points).
    for (let k = 5; k < 14; k += 1) {
      const current = series.points[k]?.confidence;
      const next = series.points[k + 1]?.confidence;
      expect(current).toBeDefined();
      expect(next).toBeDefined();
      if (current === undefined || next === undefined) throw new Error("missing");
      expect(next).toBeLessThanOrEqual(current);
    }
  });
});

describe("estimateBallState — determinism", () => {
  test("same tracks + options -> deep-equal series", () => {
    const { frames } = generateScenarioFrames(BRIDGED_400);
    const tracks = new NearestBoxBallTracker().track(frames);
    const first = estimateBallState(tracks, { fps: 25 });
    const second = estimateBallState(tracks, { fps: 25 });
    expect(first).toEqual(second);

    // Also across gap-merging and multi-track inputs.
    const { frames: framesB2 } = generateScenarioFrames(UNBRIDGED_1000);
    const tracksB2 = new NearestBoxBallTracker().track(framesB2);
    expect(estimateBallState(tracksB2, { fps: 25 })).toEqual(
      estimateBallState(tracksB2, { fps: 25 }),
    );
  });
});

describe("estimateBallState — fail-loud validation (typed errors)", () => {
  const { tracks } = seriesForSpec(BRIDGED_400);
  const [track] = tracks;
  if (track === undefined) throw new Error("track missing");

  test("invalid options -> BallStateOptionsError", () => {
    expect(() => estimateBallState(tracks, { fps: 0 })).toThrow(BallStateOptionsError);
    expect(() => estimateBallState(tracks, { fps: Number.NaN })).toThrow(BallStateOptionsError);
    expect(() => estimateBallState(tracks, { fps: 25, velocity: { maxSpanMs: 0 } })).toThrow(
      BallStateOptionsError,
    );
    expect(() => estimateBallState(tracks, { fps: 25, velocity: { maxSpanMs: -5 } })).toThrow(
      BallStateOptionsError,
    );
    expect(() =>
      estimateBallState(tracks, {
        fps: 25,
        smoothing: "bogus" as unknown as "none",
      }),
    ).toThrow(BallStateOptionsError);
  });

  test("invalid track input -> BallStateInputError", () => {
    expect(() => estimateBallState("nope" as unknown as BallTrack[], { fps: 25 })).toThrow(
      BallStateInputError,
    );

    // A point without a box cannot yield a position — never invented.
    const boxless = track.points.map((point) => ({ ...point, box: undefined }));
    expect(() => estimateBallState([{ ...track, points: boxless }], { fps: 25 })).toThrow(
      BallStateInputError,
    );

    const outOfRange = track.points.map((point) => ({
      ...point,
      confidence: 1.5,
    }));
    expect(() => estimateBallState([{ ...track, points: outOfRange }], { fps: 25 })).toThrow(
      BallStateInputError,
    );

    const badSource = track.points.map((point) => ({
      ...point,
      source: "guessed" as unknown as "detected",
    }));
    expect(() => estimateBallState([{ ...track, points: badSource }], { fps: 25 })).toThrow(
      BallStateInputError,
    );

    expect(() =>
      estimateBallState(
        [{ ...track, occlusionGaps: [{ fromMs: 500, toMs: 200, bridged: true }] }],
        { fps: 25 },
      ),
    ).toThrow(BallStateInputError);
  });
});
