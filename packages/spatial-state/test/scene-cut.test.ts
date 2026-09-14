import { describe, expect, test } from "bun:test";
import { runTrackingBenchmark } from "@sporta/perception-tracking";
import { buildSpatialScenarioFrames, runSpatialBenchmark } from "../src/benchmark";
import type { SpatialBenchmarkScenario } from "../src/benchmark";
import { estimateSpatialState } from "../src/state";

/**
 * W206 scene-cut test: a hard camera cut at frame 70 (W204 semantics —
 * `onSceneCut: "close-all"` closes every active track at the cut frame, so
 * post-cut detections open FRESH ids). The accept checks:
 *
 * - identitySwitches 1 PER OBJECT (2 objects -> report total 2; the W204
 *   walk-based count over the GT correspondence, delegated verbatim);
 * - points remain time-aligned: sessionMs monotone ACROSS the cut (the cut
 *   breaks identity, never the timeline);
 * - outOfBounds count EXACT — 0 here, and exactly why: the fixture camera's
 *   visible window always lies inside the pitch (pan in [0, 1], zoom >= 1)
 *   and W204 fixture boxes clamp into the image, so every projected center
 *   stays in play; the out-of-play honesty path is exercised separately in
 *   `inBounds.test.ts` with off-image walking boxes.
 */

const CUT_SCENARIO: SpatialBenchmarkScenario = {
  name: "scene-cut-at-70",
  camera: { pan: 0.5, zoom: 1, jitter: 0 },
  players: [
    {
      label: "player",
      motion: { kind: "linear", from: { x: 0.4, y: 0.4 }, to: { x: 0.6, y: 0.6 } },
    },
    {
      label: "player",
      motion: { kind: "linear", from: { x: 0.7, y: 0.25 }, to: { x: 0.55, y: 0.45 } },
    },
  ],
  frames: 120,
  sceneCutFrames: new Set([70]),
};

describe("scene cut at frame 70 — fresh ids, time alignment survives, exact outOfBounds", () => {
  const { frames, groundTruth } = buildSpatialScenarioFrames(CUT_SCENARIO);
  const series = estimateSpatialState(frames);
  const [report] = runSpatialBenchmark([CUT_SCENARIO]);

  test("(pre) the cut scenario is well-formed", () => {
    expect(report).toBeDefined();
    expect(series.frames).toBe(120);
    expect(series.points).toHaveLength(240);
    expect(report!.points).toBe(240);
  });

  test("W204 semantics: fresh track ids after the cut (t1/t2 -> t3/t4)", () => {
    expect(frames[69]!.tracks.map((t) => t.trackId)).toEqual(["t1", "t2"]);
    expect(frames[70]!.frame.sceneCut).toBe(true);
    expect(frames[70]!.tracks.map((t) => t.trackId)).toEqual(["t3", "t4"]);
    expect(frames[119]!.tracks.map((t) => t.trackId)).toEqual(["t3", "t4"]);
  });

  test("identitySwitches 1 PER OBJECT (report total 2; fragments[gt] === 2)", () => {
    expect(report!.identitySwitches).toBe(2); // 1 per object x 2 objects
    const predicted = new Map(frames.map((f) => [f.frame.frameId, f.tracks]));
    const tracking = runTrackingBenchmark({ groundTruth, predicted });
    // Each ground-truth object was carried by exactly TWO distinct track
    // ids (one before the cut, one after) -> 1 switch per object.
    expect(tracking.fragments).toEqual({ p1: 2, p2: 2 });
    expect(tracking.identitySwitches).toBe(2);
    expect(tracking.matchedDetections).toBe(240);
    expect(tracking.missedDetections).toBe(0);
  });

  test("points stay time-aligned: sessionMs strictly increases ACROSS the cut", () => {
    // Frame 69 -> 70 spans the cut: 2760 ms -> 2800 ms, strictly later.
    const seen: number[] = [];
    for (const point of series.points) {
      if (seen.length === 0 || seen[seen.length - 1] !== point.sessionMs) {
        seen.push(point.sessionMs);
      }
    }
    expect(seen).toHaveLength(120);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]!);
    }
    expect(seen[69]).toBe(2760);
    expect(seen[70]).toBe(2800);
    // Per track too (each track's own consecutive points strictly later).
    for (const trackId of ["t1", "t2", "t3", "t4"]) {
      const times = series.points.filter((p) => p.trackId === trackId).map((p) => p.sessionMs);
      expect(times).toHaveLength(trackId === "t1" || trackId === "t2" ? 70 : 50);
      for (let i = 1; i < times.length; i += 1) {
        expect(times[i]).toBeGreaterThan(times[i - 1]!);
      }
    }
  });

  test("outOfBounds count EXACT: 0 (fixture window inside the pitch; boxes clamped)", () => {
    expect(series.outOfBounds).toBe(0);
    expect(report!.outOfBounds).toBe(0);
    for (const point of series.points) {
      expect(point.inBounds).toBe(true);
    }
  });

  test("coverage stays 1 and projected motion stays smooth within tracks", () => {
    expect(report!.coverage).toBe(1);
    // Jump pairs never span the cut WITHIN one track (ids change there), so
    // each track's own motion remains the smooth fixture motion.
    expect(report!.maxPerFrameJump).toBeLessThan(3);
    // Mean of bit-exact 0.9 points (float sum error -> 12-digit close).
    expect(report!.meanConfidence).toBeCloseTo(0.9, 12);
  });

  test("deterministic: run twice -> deep-equal report", () => {
    expect(runSpatialBenchmark([CUT_SCENARIO])).toEqual(runSpatialBenchmark([CUT_SCENARIO]));
    expect(runSpatialBenchmark([CUT_SCENARIO])).toEqual([report!]);
  });
});
