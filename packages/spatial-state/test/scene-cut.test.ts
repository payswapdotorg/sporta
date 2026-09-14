import { describe, expect, test } from "bun:test";
import type { FixtureTrackSpec } from "@sporta/perception-tracking";
import { runSpatialBenchmark } from "../src/benchmark";
import type { SpatialBenchmarkScenario } from "../src/benchmark";
import { fuseFixtureScenario } from "./helpers";

/**
 * Scene-cut tests (the brief's §3.6 group): a camera cut at frame 70 — W204
 * semantics close every active track BEFORE association on the cut frame, so
 * fresh ids appear after the cut. The W206 accept claims: identitySwitches
 * exactly 1 per object, points still time-aligned across the cut, and the
 * outOfBounds count exact. Hand-derived numbers only.
 */
const FRAMES = 90;
const CUT = 70;

const CUT_PLAYERS = [
  {
    label: "player",
    motion: { kind: "linear" as const, from: { x: 0.3, y: 0.45 }, to: { x: 0.4, y: 0.5 } },
  },
  {
    label: "player",
    motion: { kind: "linear" as const, from: { x: 0.6, y: 0.55 }, to: { x: 0.65, y: 0.5 } },
  },
];

const CUT_SPECS: FixtureTrackSpec[] = CUT_PLAYERS.map((player, index) => ({
  gtId: `cut-p${index + 1}`,
  label: player.label,
  motion: player.motion,
  size: { w: 0.2, h: 0.2 },
}));

const CUT_SCENARIO: SpatialBenchmarkScenario = {
  name: "scene-cut",
  camera: { pan: 0.5, zoom: 1, jitter: 0 },
  players: CUT_PLAYERS,
  frames: FRAMES,
  sceneCutFrames: new Set([CUT]),
};

describe("scene cut at frame 70 — fresh ids, still time-aligned", () => {
  const series = fuseFixtureScenario({
    specs: CUT_SPECS,
    frames: FRAMES,
    sceneCutFrames: new Set([CUT]),
    cameraAt: () => ({ pan: 0.5, zoom: 1, jitter: 0 }),
  });
  const report = runSpatialBenchmark([CUT_SCENARIO])[0]!;

  test("identitySwitches is exactly 1 per object (2 total for two players)", () => {
    // W204 walk semantics: p1's matched-id walk is [t1 x 70, t3 x 20] — one
    // changing pair at the cut; same for p2 ([t2 x 70, t4 x 20]). Total 2.
    expect(report.identitySwitches).toBe(2);
  });

  test("ids switch exactly AT the cut frame (direct evidence)", () => {
    const idsByFrame = new Map<string, Set<string>>();
    for (const point of series.points) {
      const ids = idsByFrame.get(point.frameId) ?? new Set<string>();
      ids.add(point.trackId);
      idsByFrame.set(point.frameId, ids);
    }
    // Before the cut (frames 0..69): t1, t2. After (70..89): t3, t4.
    expect(idsByFrame.get("f-0-69")).toEqual(new Set(["t1", "t2"]));
    expect(idsByFrame.get("f-0-70")).toEqual(new Set(["t3", "t4"]));
    expect(idsByFrame.get("f-0-89")).toEqual(new Set(["t3", "t4"]));
    // Exactly four distinct ids across the run (two objects x two sides).
    expect(new Set(series.points.map((p) => p.trackId))).toEqual(new Set(["t1", "t2", "t3", "t4"]));
  });

  test("points are still time-aligned: session times are monotone across the cut", () => {
    const times = series.points.map((p) => p.sessionMs);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]!);
    }
    // The cut boundary itself: frame 69 -> 2760 ms, frame 70 -> 2800 ms.
    const byFrame = new Map<string, number>();
    for (const point of series.points) byFrame.set(point.frameId, point.sessionMs);
    expect(byFrame.get("f-0-69")).toBe(69 * 40);
    expect(byFrame.get("f-0-70")).toBe(70 * 40);
    expect(byFrame.get("f-0-70")).toBeGreaterThan(byFrame.get("f-0-69")!);
    // And every track's own consecutive times strictly increase (each track
    // lives on one side of the cut).
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

  test("outOfBounds count is exact: 0 (in-image boxes, centered window)", () => {
    // Hand-derived: fixture box centers saturate within the image [0, 1],
    // and the pan-0.5 zoom-1 window [26.25, 78.75] x [17, 51] lies inside the
    // pitch — so every point of this scenario is in bounds. EXACTLY 0.
    expect(series.outOfBounds).toBe(0);
    expect(report.outOfBounds).toBe(0);
  });

  test("series shape and coverage survive the cut untouched", () => {
    expect(series.frames).toBe(FRAMES);
    expect(series.points).toHaveLength(FRAMES * 2); // both players always visible
    expect(report.points).toBe(FRAMES * 2);
    expect(report.coverage).toBe(1); // the cut fragments identity, not coverage
  });

  test("deterministic: the cut scenario reproduces bit-for-bit", () => {
    expect(runSpatialBenchmark([CUT_SCENARIO])).toEqual(runSpatialBenchmark([CUT_SCENARIO]));
  });
});
