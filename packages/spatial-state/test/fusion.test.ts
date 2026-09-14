import { describe, expect, test } from "bun:test";
import type { FixtureTrackSpec } from "@sporta/perception-tracking";
import { runSpatialBenchmark } from "../src/benchmark";
import type { SpatialBenchmarkScenario } from "../src/benchmark";
import { estimateSpatialState } from "../src/state";
import type { SpatialStatePoint } from "../src/state";
import { fuseFixtureScenario } from "./helpers";

/**
 * W206 accept-criterion proof (the brief's fusion e2e): a 120-frame scenario
 * with a slow pan sweep (0.4 -> 0.6, zoom 1, jitter 0) and two fixture
 * players on linear motion, fused through the full pipeline
 * (W204 fixture + tracker -> W203 fixture calibrator -> W206 fusion).
 *
 * PRECISE assertion statement for criterion (a): "every point's sessionMs
 * strictly increasing across the series (time-aligned)" is realized as —
 * (i) the whole sorted series never regresses, (ii) the DEDUPLICATED frame
 * times strictly increase (multiple players share a frame's sessionMs by
 * construction; the series is (sessionMs, trackId)-sorted, so global
 * strictness is impossible with two players), and (iii) every track's own
 * consecutive sessionMs values strictly increase.
 *
 * No `Math.random`, no `Date.now` — every number is hand-derived from the
 * documented W203 camera model and W204 fixture laws.
 */
const FRAMES = 120;

const E2E_PLAYERS = [
  {
    label: "player",
    motion: { kind: "linear" as const, from: { x: 0.25, y: 0.45 }, to: { x: 0.35, y: 0.5 } },
  },
  {
    label: "player",
    motion: { kind: "linear" as const, from: { x: 0.6, y: 0.55 }, to: { x: 0.7, y: 0.6 } },
  },
];

const E2E_SPECS: FixtureTrackSpec[] = E2E_PLAYERS.map((player, index) => ({
  gtId: `e2e-p${index + 1}`,
  label: player.label,
  motion: player.motion,
  size: { w: 0.2, h: 0.2 },
}));

const E2E_SCENARIO: SpatialBenchmarkScenario = {
  name: "e2e-pan-sweep",
  camera: { pan: 0.4, zoom: 1, jitter: 0 },
  players: E2E_PLAYERS,
  frames: FRAMES,
  panSweep: { from: 0.4, to: 0.6 },
};

/** The pan sweep (bit-identical to the benchmark's panSweep expression). */
function sweepCamera(decodeOrder: number) {
  // Same IEEE-754 expression as the benchmark's panAt: 0.4 + (0.6 - 0.4) * t
  // — note (0.6 - 0.4) !== literal 0.2 in floating point, so the test MUST
  // mirror the exact arithmetic to keep the cross-check bit-exact.
  return { pan: 0.4 + (0.6 - 0.4) * (decodeOrder / (FRAMES - 1)), zoom: 1, jitter: 0 };
}

/** Max pitch-space jump between any track's consecutive points (meters). */
function maxJump(points: readonly SpatialStatePoint[]): number {
  const byTrack = new Map<string, SpatialStatePoint[]>();
  for (const point of points) {
    const trackPoints = byTrack.get(point.trackId);
    if (trackPoints === undefined) byTrack.set(point.trackId, [point]);
    else trackPoints.push(point);
  }
  let max = 0;
  for (const trackPoints of byTrack.values()) {
    for (let i = 1; i < trackPoints.length; i += 1) {
      const a = trackPoints[i - 1]!;
      const b = trackPoints[i]!;
      max = Math.max(max, Math.hypot(b.pitch.x - a.pitch.x, b.pitch.y - a.pitch.y));
    }
  }
  return max;
}

describe("fusion e2e — the W206 accept criterion (120-frame pan sweep)", () => {
  const series = fuseFixtureScenario({
    specs: E2E_SPECS,
    frames: FRAMES,
    cameraAt: sweepCamera,
  });
  const report = runSpatialBenchmark([E2E_SCENARIO])[0]!;

  test("(shape) 120 frames, 2 players, 240 fused points, nothing dropped", () => {
    expect(series.frames).toBe(FRAMES);
    expect(series.points).toHaveLength(FRAMES * 2);
    expect(report.frames).toBe(FRAMES);
    expect(report.points).toBe(FRAMES * 2);
    expect(report.coverage).toBe(1); // (d) every visible GT entry became a point
  });

  test("(a) time-aligned: session times strictly increase per frame and per track", () => {
    const times = series.points.map((p) => p.sessionMs);
    // (i) the sorted series never regresses.
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]!);
    }
    // (ii) deduplicated frame times strictly increase — and are exactly the
    // 25 fps fixture cadence on the identity clock: 0, 40, ..., 4760 ms.
    const distinct: number[] = [];
    for (const t of times) if (distinct[distinct.length - 1] !== t) distinct.push(t);
    expect(distinct).toHaveLength(FRAMES);
    for (let i = 0; i < distinct.length; i += 1) {
      expect(distinct[i]).toBe(40 * i);
    }
    for (let i = 1; i < distinct.length; i += 1) {
      expect(distinct[i]).toBeGreaterThan(distinct[i - 1]!);
    }
    // (iii) per track strictly increasing.
    const byTrack = new Map<string, number[]>();
    for (const point of series.points) {
      const trackTimes = byTrack.get(point.trackId);
      if (trackTimes === undefined) byTrack.set(point.trackId, [point.sessionMs]);
      else trackTimes.push(point.sessionMs);
    }
    for (const trackTimes of byTrack.values()) {
      for (let i = 1; i < trackTimes.length; i += 1) {
        expect(trackTimes[i]).toBeGreaterThan(trackTimes[i - 1]!);
      }
    }
  });

  test("(b) smooth projected motion: every track's consecutive pitch distance < 3 m", () => {
    // Hand-derived bound: per frame the pan contributes 52.5 * 0.2 / 119
    // ~ 0.088 m, the players' own x motion 52.5 * 0.1 / 119 ~ 0.044 m, the y
    // motion 34 * 0.05 / 119 ~ 0.014 m -> ~0.13 m per frame — far below 3 m.
    expect(maxJump(series.points)).toBeLessThan(3);
    expect(report.maxPerFrameJump).toBe(maxJump(series.points));
    expect(report.maxPerFrameJump).toBeGreaterThan(0.05); // motion is visible
    expect(report.maxPerFrameJump).toBeLessThan(0.5); // and smooth (tight bound)
  });

  test("(c) identity stable: 0 switches, exactly two track ids for the whole run", () => {
    expect(report.identitySwitches).toBe(0);
    expect(new Set(series.points.map((p) => p.trackId))).toEqual(new Set(["t1", "t2"]));
  });

  test("players stay in play across the whole sweep (flagged count is exact)", () => {
    // Box centers live inside the image; the fixture camera's visible window
    // lies inside the pitch — so outOfBounds is EXACTLY 0 here (the
    // out-of-play case is covered in bounds.test.ts with pan 1).
    expect(series.outOfBounds).toBe(0);
    expect(report.outOfBounds).toBe(0);
    for (const point of series.points) expect(point.inBounds).toBe(true);
  });

  test("honest confidence: the fused mean is the min-fused 0.9, never inflated", () => {
    expect(report.meanConfidence).toBeLessThan(1);
    expect(report.meanConfidence).toBeCloseTo(0.9, 10);
  });

  test("(e) determinism: benchmark and series are deep-equal on re-run", () => {
    expect(runSpatialBenchmark([E2E_SCENARIO])).toEqual(runSpatialBenchmark([E2E_SCENARIO]));
    expect(
      fuseFixtureScenario({ specs: E2E_SPECS, frames: FRAMES, cameraAt: sweepCamera }),
    ).toEqual(series);
    // The estimator itself (already-sorted input path) is also stable:
    expect(estimateSpatialState([], {})).toEqual({ frames: 0, points: [], outOfBounds: 0 });
  });
});
