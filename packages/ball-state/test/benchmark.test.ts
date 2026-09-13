import { describe, expect, test } from "bun:test";
import { NearestBoxBallTracker, generateScenarioFrames } from "@sporta/ball-tracking";
import type { BallScenarioSpec } from "@sporta/ball-tracking";
import { runBallStateBenchmark } from "../src/benchmark";
import { estimateBallState } from "../src/state";
import type { BallStateEstimatorOptions } from "../src/state";

/**
 * The accept-criterion proof cases (plus the bridged-linear case that pins
 * the "interpolated points of a bridged linear gap have EXACT analytic
 * velocity" claim per-point). All at 25 fps, detectionNoise 0:
 *
 * 1. linear clean — 25 frames, no occlusion;
 * 2. parabolic with 2 short (160 ms) occlusions — 50 frames;
 * 3. linear with 1 long (1000 ms) unbridged occlusion — 24 state points;
 * 4. linear with 1 bridged 400 ms occlusion — 50 state points.
 */
const LINEAR_CLEAN: BallScenarioSpec = {
  label: "linear-clean",
  fps: 25,
  durationMs: 1000,
  flight: { kind: "linear", from: { x: 0.2, y: 0.2 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [],
  detectionNoise: 0,
  dropRate: 0,
};

const PARABOLIC_TWO_SHORT: BallScenarioSpec = {
  label: "parabolic-two-short-occlusions",
  fps: 25,
  durationMs: 2000,
  // y = 0.5 + 0.1 sin(pi t) on top of constant y: the analytic vy is
  // 0.1 * pi * 1000/1960 * cos(pi t) — nonzero and varying.
  flight: { kind: "parabolic", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, apex: 0.1 },
  occlusions: [
    { fromMs: 200, toMs: 360 }, // frames 5..8 (4 frames)
    { fromMs: 1000, toMs: 1160 }, // frames 25..28 (4 frames)
  ],
  detectionNoise: 0,
  dropRate: 0,
};

const LINEAR_LONG_UNBRIDGED: BallScenarioSpec = {
  label: "linear-long-unbridged-occlusion",
  fps: 25,
  durationMs: 2000,
  flight: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [{ fromMs: 200, toMs: 1200 }], // frames 5..29 lost; re-seed at 31
  detectionNoise: 0,
  dropRate: 0,
};

const LINEAR_BRIDGED: BallScenarioSpec = {
  label: "linear-bridged-occlusion",
  fps: 25,
  durationMs: 2000,
  flight: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [{ fromMs: 200, toMs: 600 }], // frames 5..14 interpolated
  detectionNoise: 0,
  dropRate: 0,
};

const SPECS = [LINEAR_CLEAN, PARABOLIC_TWO_SHORT, LINEAR_LONG_UNBRIDGED, LINEAR_BRIDGED];
const OPTIONS: BallStateEstimatorOptions = { fps: 25 }; // per-spec fps overrides this

describe("runBallStateBenchmark — accept-criterion proof", () => {
  const reports = runBallStateBenchmark(SPECS, OPTIONS);

  test("linear clean: exact analytic velocity and position (hand-computed 0 up to float dust)", () => {
    const report = reports[0];
    if (report === undefined) throw new Error("report missing");

    // Hand counts: 25 points, all detected; the 23 interior points carry
    // velocity (both neighbors, 80 ms <= 100 ms window); coverage 23/25.
    expect(report.scenario).toBe("linear-clean");
    expect(report.points).toBe(25);
    expect(report.velocityDefined).toBe(23);
    expect(report.velocityCoverage).toBe(23 / 25);

    // Every position is the exact ground-truth center (noise 0) and every
    // defined velocity is the exact analytic constant
    // (0.6 * 1000/960, 0.3 * 1000/960) = (0.625, 0.3125) image-units/s: a
    // centered difference over a linear flight is exact. The residual is
    // float reconstruction dust from the box-center convention (~1e-16),
    // hence the 1e-12 pin.
    expect(report.velocityRmse).toBeLessThan(1e-12);
    expect(report.positionRmse).toBeLessThan(1e-12);

    expect(report.meanConfidence).toBeCloseTo(0.85, 12);
    expect(report.detectedFraction).toBe(1);
    expect(report.gapCount).toBe(0);
    expect(report.bridgedGapFraction).toBe(0);
  });

  test("parabolic, 2 short occlusions: honest nonzero interpolation error within hand-derived bounds", () => {
    const report = reports[1];
    if (report === undefined) throw new Error("report missing");

    // Hand counts: 50 points (42 detected + 8 interpolated, both gaps
    // 4 frames <= maxGapFrames 12 -> bridged); 48 interior points with
    // velocity (the series is continuous); coverage 48/50; both gaps
    // bridged; mean confidence (42*0.85 + 8*0.425)/50 = 0.782.
    expect(report.scenario).toBe("parabolic-two-short-occlusions");
    expect(report.points).toBe(50);
    expect(report.velocityDefined).toBe(48);
    expect(report.velocityCoverage).toBe(48 / 50);
    expect(report.detectedFraction).toBe(42 / 50);
    expect(report.gapCount).toBe(2);
    expect(report.bridgedGapFraction).toBe(1);
    expect(report.meanConfidence).toBeCloseTo(0.782, 12);

    // Hand-derived velocity error budget (documented):
    // - DETECTED points: the centered difference of sin is the analytic
    //   derivative times sin(h)/h (h = pi/49 per half-window), an
    //   underestimate by the factor (1 - sin(h)/h) ~ 6.85e-4, so the vy
    //   error is at most 0.1 * pi/1.96 * 6.85e-4 ~ 1.1e-4;
    // - INTERPOLATED points (12 points in/adjacent to the two gaps): the
    //   chord slope between the gap anchors vs the analytic derivative of
    //   sin — errors of ~4e-3..1.6e-2 per point (gap 2's chord crosses the
    //   sin peak, so its deviation is the largest);
    // RMS over the 48 defined points lands at ~4.2e-3 (computed). The
    // asserted band (2e-3, 7e-3) brackets that with margin on both sides.
    expect(report.velocityRmse).toBeGreaterThan(2e-3);
    expect(report.velocityRmse).toBeLessThan(7e-3);

    // Position error: only the 8 interpolated points err (chord vs sin
    // curve): gap 1 ~5e-4 max deviation, gap 2 (crossing the peak)
    // ~1.24e-3 max -> RMS over 50 points ~3.2e-4 (computed). The asserted
    // band brackets that with margin.
    expect(report.positionRmse).toBeGreaterThan(1e-4);
    expect(report.positionRmse).toBeLessThan(8e-4);
  });

  test("linear, 1 long unbridged occlusion: the gap costs COVERAGE, not accuracy", () => {
    const report = reports[2];
    if (report === undefined) throw new Error("report missing");

    // Hand counts: 24 state points (frames 0..4 from bt-0-1, 31..49 from
    // bt-31-2); velocity defined exactly on frames {1,2,3} (span 80 ms)
    // and {32..48} (span 80 ms) = 20 points; the boundary spans are
    // 1120 ms > 100 ms so frames 4 and 31 are omitted; coverage 20/24.
    expect(report.scenario).toBe("linear-long-unbridged-occlusion");
    expect(report.points).toBe(24);
    expect(report.velocityDefined).toBe(20);
    expect(report.velocityCoverage).toBe(20 / 24);

    // Every REMAINING point is an exact detection on the linear flight:
    // position and velocity are exact (float dust only). The honest cost
    // of the unbridged gap is the 4 missing velocities and the 26 missing
    // points, never a fabricated value.
    expect(report.velocityRmse).toBeLessThan(1e-12);
    expect(report.positionRmse).toBeLessThan(1e-12);

    expect(report.meanConfidence).toBeCloseTo(0.85, 12); // all points detected
    expect(report.detectedFraction).toBe(1);
    expect(report.gapCount).toBe(1);
    expect(report.bridgedGapFraction).toBe(0);
  });

  test("linear, 1 bridged occlusion: full coverage with decayed confidence and exact velocity", () => {
    const report = reports[3];
    if (report === undefined) throw new Error("report missing");

    // Hand counts: 50 points (40 detected + 10 interpolated); 48 defined
    // velocities; mean confidence (40*0.85 + 4*0.425 + 4*0.2125 +
    // 2*0.10625)/50 = 36.7625/50 = 0.73525.
    expect(report.scenario).toBe("linear-bridged-occlusion");
    expect(report.points).toBe(50);
    expect(report.velocityDefined).toBe(48);
    expect(report.velocityCoverage).toBe(48 / 50);
    expect(report.detectedFraction).toBe(40 / 50);
    expect(report.gapCount).toBe(1);
    expect(report.bridgedGapFraction).toBe(1);
    expect(report.meanConfidence).toBeCloseTo(0.73525, 12);

    // Interpolation between exact anchors on a uniform linear flight
    // reproduces the analytic positions and velocities exactly (float
    // dust only) — an honest consequence of the W202 bridging model.
    expect(report.velocityRmse).toBeLessThan(1e-12);
    expect(report.positionRmse).toBeLessThan(1e-12);
  });

  test("interpolated points of a bridged linear gap have EXACT analytic velocity (per point)", () => {
    // Direct pipeline for the bridged-linear scenario; analytic
    // vx = (to.x - from.x) * 1000 / totalMs = 0.6 * 1000/1960, vy = 0
    // (constant y flight).
    const { frames } = generateScenarioFrames(LINEAR_BRIDGED);
    const tracks = new NearestBoxBallTracker().track(frames);
    const series = estimateBallState(tracks, { fps: 25 });
    const totalMs = (frames.length - 1) * (1000 / 25);
    const analyticVx = ((0.8 - 0.2) * 1000) / totalMs;

    const interpolated = series.points.filter((point) => point.source === "interpolated");
    expect(interpolated).toHaveLength(10);
    for (const point of interpolated) {
      expect(point.velocity).toBeDefined();
      expect(point.velocity?.vx).toBeCloseTo(analyticVx, 12);
      expect(point.velocity?.vy).toBe(0);
    }
  });
});

describe("runBallStateBenchmark — determinism", () => {
  test("the full benchmark run twice -> deep-equal reports", () => {
    const first = runBallStateBenchmark(SPECS, OPTIONS);
    const second = runBallStateBenchmark(SPECS, OPTIONS);
    expect(first).toEqual(second);
  });
});
