import { describe, expect, test } from "bun:test";
import { runTrackingBenchmark } from "../src/benchmark";
import type { TrackingBenchmarkReport } from "../src/benchmark";
import { NearestBoxBallTracker } from "../src/nearest-box";
import { generateScenarioFrames } from "../src/scenario";
import type { BallScenarioSpec, ScenarioGroundTruth } from "../src/scenario";

const LINEAR_CLEAN: BallScenarioSpec = {
  label: "linear-clean",
  fps: 25,
  durationMs: 2000, // 50 frames
  flight: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [],
  detectionNoise: 0,
  dropRate: 0,
};

/** Occlusion [200, 600): frames 5..14 (10 frames <= 12) missing -> bridged. */
const OCCLUDED_BRIDGED: BallScenarioSpec = {
  label: "occluded-bridged",
  fps: 25,
  durationMs: 2000,
  flight: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [{ fromMs: 200, toMs: 600 }],
  detectionNoise: 0.01,
  dropRate: 0,
};

/** Occlusion [400, 1400): frames 10..34 (25 frames > 12) missing -> unbridged. */
const LONG_OCCLUSION: BallScenarioSpec = {
  label: "long-occlusion",
  fps: 25,
  durationMs: 3000, // 75 frames
  flight: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [{ fromMs: 400, toMs: 1400 }],
  detectionNoise: 0,
  dropRate: 0,
};

/** Parabolic flight with two short (10-frame) occlusions, both bridged. */
const PARABOLIC_TWO_GAPS: BallScenarioSpec = {
  label: "parabolic-two-gaps",
  fps: 25,
  durationMs: 2000,
  flight: { kind: "parabolic", from: { x: 0.2, y: 0.8 }, to: { x: 0.8, y: 0.2 }, apex: 0.2 },
  occlusions: [
    { fromMs: 200, toMs: 600 }, // frames 5..14
    { fromMs: 1200, toMs: 1600 }, // frames 30..39
  ],
  detectionNoise: 0,
  dropRate: 0,
};

/** Parabolic flight with noise and every 5th frame dropped. */
const PARABOLIC_NOISY_DROPS: BallScenarioSpec = {
  label: "parabolic-noisy-drops",
  fps: 25,
  durationMs: 2000,
  flight: { kind: "parabolic", from: { x: 0.2, y: 0.8 }, to: { x: 0.8, y: 0.2 }, apex: 0.2 },
  occlusions: [],
  detectionNoise: 0.01,
  dropRate: 5,
};

/** The representative case set — the W202 acceptance criterion. */
const REPRESENTATIVE_CASES: readonly BallScenarioSpec[] = [
  LINEAR_CLEAN,
  PARABOLIC_TWO_GAPS,
  LONG_OCCLUSION,
  PARABOLIC_NOISY_DROPS,
];

const reportFor = (
  reports: readonly TrackingBenchmarkReport[],
  scenario: string,
): TrackingBenchmarkReport => {
  const report = reports.find((entry) => entry.scenario === scenario);
  if (report === undefined) throw new Error(`no report for scenario "${scenario}"`);
  return report;
};

describe("runTrackingBenchmark", () => {
  const tracker = new NearestBoxBallTracker();

  test("clean scenario: coverage 1, rmse 0, idSwitches 0", () => {
    const [report] = runTrackingBenchmark([LINEAR_CLEAN], tracker);
    if (report === undefined) throw new Error("report missing");
    expect(report).toMatchObject({
      scenario: "linear-clean",
      frames: 50,
      occlusionGaps: 0,
      idSwitches: 0,
      trackedFrames: 50,
      coverage: 1,
      recoveredGaps: 0,
      meanInterpolatedConfidence: 0,
    });
    // No noise, no interpolation: every track center is the exact truth
    // (only float round-trip dust through the box center, < 1e-12).
    expect(report.positionRmse).toBeLessThan(1e-12);
    expect(report.interpolatedRmse).toBe(0);
  });

  test("occluded + bridged: recoveredGaps 1, interpolatedRmse > 0 but < noise*2", () => {
    const [report] = runTrackingBenchmark([OCCLUDED_BRIDGED], tracker);
    if (report === undefined) throw new Error("report missing");
    expect(report).toMatchObject({
      scenario: "occluded-bridged",
      frames: 50,
      occlusionGaps: 1,
      idSwitches: 0,
      trackedFrames: 50,
      coverage: 1,
      recoveredGaps: 1,
    });
    // Interpolated points are lerps between two noisy anchors: their error
    // stays strictly inside the noise magnitude (and above 0: noise != 0).
    expect(report.interpolatedRmse).toBeGreaterThan(0);
    expect(report.interpolatedRmse).toBeLessThan(0.01 * 2);
    expect(report.positionRmse).toBeGreaterThan(0);
    expect(report.positionRmse).toBeLessThan(0.01 * 2);
    // Decay schedule over the 10 interpolated frames (gapElapsed 1..10):
    // [0.425 x4, 0.2125 x4, 0.10625 x2] -> mean 0.27625.
    expect(report.meanInterpolatedConfidence).toBeCloseTo(0.27625, 12);
  });

  test("long occlusion: idSwitches >= 1, coverage < 1 (the switch costs a visible frame)", () => {
    const [report] = runTrackingBenchmark([LONG_OCCLUSION], tracker);
    if (report === undefined) throw new Error("report missing");
    expect(report).toMatchObject({
      scenario: "long-occlusion",
      frames: 75,
      occlusionGaps: 1,
      idSwitches: 1,
      trackedFrames: 49, // 10 (track 1) + 39 (track 2, seeded at frame 36)
      coverage: 0.98, // 49 of 50 visible frames: frame 35's rejected detection
      recoveredGaps: 0,
      interpolatedRmse: 0, // no interpolated points: the gap never bridged
      meanInterpolatedConfidence: 0,
    });
    // Noise 0 and detected-only points: exact positions.
    expect(report.positionRmse).toBeLessThan(1e-12);
  });

  test("representative case set (accept criterion): per-case tight expectations", () => {
    const reports = runTrackingBenchmark(REPRESENTATIVE_CASES, tracker);
    expect(reports.map((report) => report.scenario)).toEqual([
      "linear-clean",
      "parabolic-two-gaps",
      "long-occlusion",
      "parabolic-noisy-drops",
    ]);

    // Case 1: linear clean.
    const clean = reportFor(reports, "linear-clean");
    expect(clean.coverage).toBe(1);
    expect(clean.idSwitches).toBe(0);
    expect(clean.occlusionGaps).toBe(0);
    expect(clean.recoveredGaps).toBe(0);
    expect(clean.positionRmse).toBeLessThan(1e-12);

    // Case 2: parabolic with 2 short occlusions — both bridged, one track.
    const twoGaps = reportFor(reports, "parabolic-two-gaps");
    expect(twoGaps).toMatchObject({
      frames: 50,
      occlusionGaps: 2,
      idSwitches: 0,
      trackedFrames: 50, // 30 detected + 20 interpolated
      coverage: 1,
      recoveredGaps: 1, // 2/2
    });
    expect(twoGaps.meanInterpolatedConfidence).toBeCloseTo(0.27625, 12);
    // Interpolation error: the chord-vs-curve deviation of the parabola —
    // positive (curved flight) but small (< 0.02).
    expect(twoGaps.interpolatedRmse).toBeGreaterThan(0);
    expect(twoGaps.interpolatedRmse).toBeLessThan(0.02);
    // Detected points are exact (noise 0), so the overall RMSE is the
    // interpolated error diluted by 20/50 of the points.
    expect(twoGaps.positionRmse).toBeCloseTo(twoGaps.interpolatedRmse * Math.sqrt(0.4), 12);

    // Pointwise: interpolated centers are the exact lerps of the anchor
    // TRUTH centers (independent check against the generator's math).
    const { groundTruth } = generateScenarioFrames(PARABOLIC_TWO_GAPS);
    const truthAt = (k: number): ScenarioGroundTruth => {
      const truth = groundTruth[k];
      if (truth === undefined) throw new Error(`truth for frame ${k} missing`);
      return truth;
    };
    const tracks = tracker.track(generateScenarioFrames(PARABOLIC_TWO_GAPS).frames);
    expect(tracks).toHaveLength(1);
    const interpolated = tracks[0]?.points.filter((point) => point.source === "interpolated");
    if (interpolated === undefined) throw new Error("interpolated points missing");
    expect(interpolated).toHaveLength(20);
    const gapAnchors: Array<[number, number]> = [
      [4, 15], // frames 5..14
      [29, 40], // frames 30..39
    ];
    for (const [gapIndex, [anchorA, anchorB]] of gapAnchors.entries()) {
      for (let offset = 1; offset <= 10; offset += 1) {
        const k = anchorA + offset;
        const point = interpolated[gapIndex * 10 + offset - 1];
        if (point === undefined || point.box === undefined) throw new Error("point missing");
        const u = (k - anchorA) / (anchorB - anchorA);
        const a = truthAt(anchorA).center;
        const b = truthAt(anchorB).center;
        // The interpolated box is the lerp of the anchor boxes (which are
        // the truth centers +/- 0.02 at noise 0), so the interpolated BOX
        // CENTER is the lerp of the anchor truth centers.
        expect(point.box.x + point.box.w / 2).toBeCloseTo(a.x + (b.x - a.x) * u, 12);
        expect(point.box.y + point.box.h / 2).toBeCloseTo(a.y + (b.y - a.y) * u, 12);
      }
    }

    // Case 3: linear with 1 long occlusion (see the dedicated test above).
    const long = reportFor(reports, "long-occlusion");
    expect(long.idSwitches).toBeGreaterThanOrEqual(1);
    expect(long.coverage).toBeLessThan(1);
    expect(long.occlusionGaps).toBe(1);
    expect(long.recoveredGaps).toBe(0);

    // Case 4: parabolic + noise 0.01 + dropRate 5 — every mid-flight drop
    // gap (1 frame, well under maxGapFrames) bridges; the FINAL dropped
    // frame (49) is a never-resolved trailing gap, honestly reported
    // unbridged and WITHOUT a point (extrapolation never).
    const noisyDrops = reportFor(reports, "parabolic-noisy-drops");
    expect(noisyDrops).toMatchObject({
      frames: 50,
      occlusionGaps: 10, // 9 bridged drop gaps + 1 trailing unbridged gap
      idSwitches: 0,
      trackedFrames: 49, // 40 detected + 9 interpolated
      coverage: 1,
    });
    expect(noisyDrops.recoveredGaps).toBeCloseTo(9 / 10, 12);
    // Every interpolated point bridges a single dropped frame (gapElapsed 1):
    // confidence = 0.85 * 0.5^ceil(1/4) = 0.425 exactly.
    expect(noisyDrops.meanInterpolatedConfidence).toBeCloseTo(0.425, 12);
    // Interpolation across 1-frame gaps: noise average + a tiny chord sag.
    expect(noisyDrops.interpolatedRmse).toBeGreaterThan(0);
    expect(noisyDrops.interpolatedRmse).toBeLessThan(0.01 * 2);
    expect(noisyDrops.positionRmse).toBeGreaterThan(0);
    expect(noisyDrops.positionRmse).toBeLessThan(0.02);
  });

  test("pure and deterministic: running twice produces deep-equal reports", () => {
    const first = runTrackingBenchmark(REPRESENTATIVE_CASES, tracker);
    const second = runTrackingBenchmark(REPRESENTATIVE_CASES, tracker);
    expect(first).toEqual(second);
  });
});
