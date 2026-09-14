import { describe, expect, test } from "bun:test";
import { runTrackingBenchmark } from "@sporta/perception-tracking";
import { buildSpatialScenarioFrames, runSpatialBenchmark } from "../src/benchmark";
import type { SpatialBenchmarkScenario } from "../src/benchmark";
import { estimateSpatialState } from "../src/state";

/**
 * W206 fusion end-to-end — THE ACCEPT-CRITERION PROOF: "player locations /
 * projected coordinates are time-aligned". 120-frame scenario, slow camera
 * pan sweep (0.4 -> 0.6, zoom 1, jitter 0 — the corner set and therefore
 * the homography differ PER FRAME), two fixture players on linear motion.
 *
 * Hand-derived motion (both players' box centers, image space):
 *
 *   p1: (0.4, 0.4) -> (0.6, 0.6)     p2: (0.7, 0.25) -> (0.55, 0.45)
 *
 * With pan(d) = 0.4 + 0.2t and t = d / 119, the pitch paths close-form to
 *
 *   p1: X = 42 + 21t,   Y = 30.6 + 6.8t   (per-frame step ~0.185 m)
 *   p2: X = 57.75 + 2.625t, Y = 25.5 + 6.8t (per-frame step ~0.061 m)
 *
 * so every consecutive-frame jump is far below the 3 m smoothness bound.
 * Constants only; deterministic (asserted by running the benchmark twice).
 */

const E2E_SCENARIO: SpatialBenchmarkScenario = {
  name: "e2e-pan-sweep",
  camera: { pan: 0.4, zoom: 1, jitter: 0 },
  panTo: 0.6,
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
};

/** Distinct session times across the series, in order (one per frame). */
function distinctSessionMs(series: ReturnType<typeof estimateSpatialState>): number[] {
  const seen: number[] = [];
  for (const point of series.points) {
    if (seen.length === 0 || seen[seen.length - 1] !== point.sessionMs) {
      seen.push(point.sessionMs);
    }
  }
  return seen;
}

/** Per-track consecutive pitch distances, in series (appearance) order. */
function trackJumps(series: ReturnType<typeof estimateSpatialState>): number[] {
  const jumps: number[] = [];
  const lastByTrack = new Map<string, { x: number; y: number }>();
  for (const point of series.points) {
    const previous = lastByTrack.get(point.trackId);
    if (previous !== undefined) {
      const dx = point.pitch.x - previous.x;
      const dy = point.pitch.y - previous.y;
      jumps.push(Math.sqrt(dx * dx + dy * dy));
    }
    lastByTrack.set(point.trackId, { x: point.pitch.x, y: point.pitch.y });
  }
  return jumps;
}

describe("fusion e2e (accept criterion) — 120 frames, pan sweep 0.4 -> 0.6", () => {
  const { frames, groundTruth } = buildSpatialScenarioFrames(E2E_SCENARIO);
  const series = estimateSpatialState(frames);
  const [report] = runSpatialBenchmark([E2E_SCENARIO]);

  test("(pre) the scenario itself is well-formed", () => {
    expect(report).toBeDefined();
    expect(frames).toHaveLength(120);
    expect(series.frames).toBe(120);
    expect(series.points).toHaveLength(240); // 2 players x 120 frames
    expect(report!.frames).toBe(120);
    expect(report!.points).toBe(240);
  });

  test("(a) every point's sessionMs is time-aligned and strictly increasing per frame", () => {
    // Default identity clock: sessionMs === presentationMs = d * 40.
    const sessionTimes = distinctSessionMs(series);
    expect(sessionTimes).toHaveLength(120);
    for (let i = 0; i < 120; i += 1) {
      expect(sessionTimes[i]).toBe(i * 40); // time-aligned to the timeline
    }
    for (let i = 1; i < sessionTimes.length; i += 1) {
      expect(sessionTimes[i]).toBeGreaterThan(sessionTimes[i - 1]!); // strictly increasing
    }
    // Per track: consecutive points strictly increase in session time.
    for (const trackId of ["t1", "t2"]) {
      const times = series.points.filter((p) => p.trackId === trackId).map((p) => p.sessionMs);
      expect(times).toHaveLength(120);
      for (let i = 1; i < times.length; i += 1) {
        expect(times[i]).toBeGreaterThan(times[i - 1]!);
      }
    }
  });

  test("(b) every track's consecutive-frame pitch distance < 3 m (maxPerFrameJump < 3)", () => {
    const jumps = trackJumps(series);
    expect(jumps).toHaveLength(238); // 2 tracks x 119 consecutive pairs
    for (const jump of jumps) {
      expect(jump).toBeLessThan(3);
    }
    expect(report!.maxPerFrameJump).toBeLessThan(3);
    // The report's number IS the max over the same pairs (cross-check).
    expect(report!.maxPerFrameJump).toBe(Math.max(...jumps));
    // Non-degenerate: real smooth motion was measured (~0.185 m per frame).
    expect(report!.maxPerFrameJump).toBeGreaterThan(0.1);
  });

  test("(c) both players' track ids are stable across the whole run (0 switches, fragments = 1)", () => {
    expect(report!.identitySwitches).toBe(0);
    // Per-object ground truth: each GT object matched exactly ONE distinct
    // track id (fragments[gt] === 1 — identitySwitches 0 per object).
    const predicted = new Map(frames.map((f) => [f.frame.frameId, f.tracks]));
    const tracking = runTrackingBenchmark({ groundTruth, predicted });
    expect(tracking.fragments).toEqual({ p1: 1, p2: 1 });
    expect(tracking.identitySwitches).toBe(0);
    expect(tracking.continuityScore).toBe(1);
    // The track ids themselves: t1 and t2 from the first frame to the last.
    expect(new Set(series.points.map((p) => p.trackId))).toEqual(new Set(["t1", "t2"]));
    expect(frames[0]!.tracks.map((t) => t.trackId)).toEqual(["t1", "t2"]);
    expect(frames[119]!.tracks.map((t) => t.trackId)).toEqual(["t1", "t2"]);
  });

  test("(d) coverage 1 — every ground-truth appearance became a spatial point", () => {
    expect(report!.coverage).toBe(1);
    expect(report!.outOfBounds).toBe(0); // the whole path stays in play
    for (const point of series.points) {
      expect(point.inBounds).toBe(true);
      expect(point.label).toBe("player"); // label carried through the fusion
    }
  });

  test("(e) run twice -> deep-equal report (pure and deterministic)", () => {
    expect(runSpatialBenchmark([E2E_SCENARIO])).toEqual(runSpatialBenchmark([E2E_SCENARIO]));
    expect(runSpatialBenchmark([E2E_SCENARIO])).toEqual([report!]);
    // The series itself is deterministic too.
    expect(estimateSpatialState(frames)).toEqual(series);
  });

  test("fused confidence is the honest min of the fixture sources (0.9, 0.9)", () => {
    // Per-point confidence is bit-exact 0.9 (min of 0.9, 0.9); the report's
    // mean accumulates ~1e-16 float error over the 240-point running sum.
    expect(report!.meanConfidence).toBeCloseTo(0.9, 12);
    for (const point of series.points) {
      expect(point.confidence).toBe(0.9);
      expect(point.sourceConfidences).toEqual({ track: 0.9, corners: 0.9 });
    }
  });
});
