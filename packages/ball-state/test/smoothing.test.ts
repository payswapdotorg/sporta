import { describe, expect, test } from "bun:test";
import { NearestBoxBallTracker, generateScenarioFrames } from "@sporta/ball-tracking";
import type { BallScenarioSpec, BallTrack } from "@sporta/ball-tracking";
import { BallStateOptionsError, estimateBallState } from "../src/state";

const BRIDGED_400: BallScenarioSpec = {
  label: "smoothing-bridged-400",
  fps: 25,
  durationMs: 2000,
  flight: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [{ fromMs: 200, toMs: 600 }],
  detectionNoise: 0,
  dropRate: 0,
};

/**
 * A fixed RAMP input for exact EMA arithmetic: 4 points at 40 ms spacing
 * (fps 25), boxes of w = h = 0.5 whose centers advance in x by 0.25 per
 * frame (0.25, 0.5, 0.75, 1.0 — all exact dyadic rationals, so center
 * reconstruction `box.x + box.w/2` is float-exact) while y stays 0.25.
 */
const RAMP_TRACK: BallTrack = {
  trackId: "bt-0-1",
  points: [
    {
      frameId: "f-0-0",
      presentationMs: 0,
      box: { x: 0, y: 0, w: 0.5, h: 0.5 },
      source: "detected",
      confidence: 0.85,
    },
    {
      frameId: "f-0-1",
      presentationMs: 40,
      box: { x: 0.25, y: 0, w: 0.5, h: 0.5 },
      source: "detected",
      confidence: 0.85,
    },
    {
      frameId: "f-0-2",
      presentationMs: 80,
      box: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      source: "detected",
      confidence: 0.7,
    },
    {
      frameId: "f-0-3",
      presentationMs: 120,
      box: { x: 0.75, y: 0, w: 0.5, h: 0.5 },
      source: "interpolated",
      confidence: 0.5,
    },
  ],
  occlusionGaps: [],
};

describe("estimateBallState — smoothing", () => {
  test('"none" (default and explicit) leaves positions identical to the track points (deep-equal)', () => {
    const { frames } = generateScenarioFrames(BRIDGED_400);
    const tracks = new NearestBoxBallTracker().track(frames);

    const defaultSeries = estimateBallState(tracks, { fps: 25 });
    const explicitSeries = estimateBallState(tracks, { fps: 25, smoothing: "none" });
    expect(defaultSeries).toEqual(explicitSeries);

    // Positions are exactly the track points' box centers, in merged order.
    const expectedCenters = tracks
      .flatMap((track) => track.points.map((point) => point))
      .map((point) => ({ x: point.box!.x + point.box!.w / 2, y: point.box!.y + point.box!.h / 2 }));
    expect(defaultSeries.points.map((point) => point.position)).toEqual(expectedCenters);
  });

  test('"none" ignores any emaAlpha (even invalid ones)', () => {
    const withJunk = estimateBallState([RAMP_TRACK], {
      fps: 25,
      smoothing: "none",
      emaAlpha: 42,
    });
    const withNaN = estimateBallState([RAMP_TRACK], {
      fps: 25,
      smoothing: "none",
      emaAlpha: Number.NaN,
    });
    const plain = estimateBallState([RAMP_TRACK], { fps: 25 });
    expect(withJunk).toEqual(plain);
    expect(withNaN).toEqual(plain);
  });

  test('"ema" alpha 0.5 on the fixed ramp: first 4 EMA values are EXACT (hand-computed)', () => {
    // Hand computation (EMA_0 = p_0 seed; EMA_k = 0.5 p_k + 0.5 EMA_{k-1}),
    // with p = (0.25, 0.5, 0.75, 1.0) in x and y = 0.25 constant:
    //
    //   EMA_0 = 0.25
    //   EMA_1 = 0.5*0.5  + 0.5*0.25   = 0.375
    //   EMA_2 = 0.5*0.75 + 0.5*0.375  = 0.5625
    //   EMA_3 = 0.5*1.0  + 0.5*0.5625 = 0.78125
    //
    // All dyadic rationals — exact in binary floating point.
    const series = estimateBallState([RAMP_TRACK], { fps: 25, smoothing: "ema", emaAlpha: 0.5 });
    expect(series.points.map((point) => point.position.x)).toEqual([0.25, 0.375, 0.5625, 0.78125]);
    for (const point of series.points) {
      expect(point.position.y).toBe(0.25);
    }
  });

  test('"ema" recomputes velocity on the smoothed positions — specific hand-computed deltas', () => {
    // Raw centered velocities (span = 2 frames = 80 ms = 0.08 s):
    //   v(1) = (p2 - p0)/0.08 = (0.75 - 0.25)/0.08 = 0.5/0.08   = 6.25
    //   v(2) = (p3 - p1)/0.08 = (1.0  - 0.5)/0.08 = 0.5/0.08    = 6.25
    // Smoothed centered velocities:
    //   v(1) = (EMA2 - EMA0)/0.08 = (0.5625  - 0.25) /0.08 = 0.3125/0.08  = 3.90625   (= 125/32)
    //   v(2) = (EMA3 - EMA1)/0.08 = (0.78125 - 0.375)/0.08 = 0.40625/0.08 = 5.078125  (= 325/64)
    // Deltas (raw - smoothed): 6.25 - 3.90625 = 2.34375 (= 75/32) and
    // 6.25 - 5.078125 = 1.171875 (= 75/64) — both exact dyadic rationals.
    const raw = estimateBallState([RAMP_TRACK], { fps: 25 });
    const smoothed = estimateBallState([RAMP_TRACK], {
      fps: 25,
      smoothing: "ema",
      emaAlpha: 0.5,
    });

    const rawV1 = raw.points[1]?.velocity;
    const rawV2 = raw.points[2]?.velocity;
    const smV1 = smoothed.points[1]?.velocity;
    const smV2 = smoothed.points[2]?.velocity;
    expect(rawV1).toBeDefined();
    expect(rawV2).toBeDefined();
    expect(smV1).toBeDefined();
    expect(smV2).toBeDefined();

    expect(rawV1?.vx).toBeCloseTo(6.25, 12);
    expect(rawV2?.vx).toBeCloseTo(6.25, 12);
    expect(smV1?.vx).toBeCloseTo(3.90625, 12);
    expect(smV2?.vx).toBeCloseTo(5.078125, 12);

    // The specific deltas (y is constant, so vy = 0 in both).
    expect(rawV1!.vx - smV1!.vx).toBeCloseTo(2.34375, 12);
    expect(rawV2!.vx - smV2!.vx).toBeCloseTo(1.171875, 12);
    expect(smV1?.vy).toBe(0);
    expect(smV2?.vy).toBe(0);

    // Smoothed velocities genuinely differ from raw ones.
    expect(smV1?.vx).not.toBeCloseTo(rawV1?.vx as number, 12);
    expect(smV2?.vx).not.toBeCloseTo(rawV2?.vx as number, 12);

    // Series ends still carry no velocity under smoothing.
    expect(smoothed.points[0]?.velocity).toBeUndefined();
    expect(smoothed.points[3]?.velocity).toBeUndefined();
  });

  test('"ema" keeps confidence and source verbatim', () => {
    const smoothed = estimateBallState([RAMP_TRACK], {
      fps: 25,
      smoothing: "ema",
      emaAlpha: 0.5,
    });
    expect(smoothed.points.map((point) => point.confidence)).toEqual([0.85, 0.85, 0.7, 0.5]);
    expect(smoothed.points.map((point) => point.source)).toEqual([
      "detected",
      "detected",
      "detected",
      "interpolated",
    ]);
    expect(smoothed.points.map((point) => point.trackId)).toEqual([
      "bt-0-1",
      "bt-0-1",
      "bt-0-1",
      "bt-0-1",
    ]);
  });

  test("invalid alpha (<= 0, >= 1, NaN) or missing alpha -> typed BallStateOptionsError", () => {
    for (const alpha of [0, 1, -0.5, 1.5, Number.NaN]) {
      expect(() =>
        estimateBallState([RAMP_TRACK], { fps: 25, smoothing: "ema", emaAlpha: alpha }),
      ).toThrow(BallStateOptionsError);
    }
    expect(() => estimateBallState([RAMP_TRACK], { fps: 25, smoothing: "ema" })).toThrow(
      BallStateOptionsError,
    );
    // A valid alpha does not throw.
    expect(() =>
      estimateBallState([RAMP_TRACK], { fps: 25, smoothing: "ema", emaAlpha: 0.5 }),
    ).not.toThrow();
  });
});
