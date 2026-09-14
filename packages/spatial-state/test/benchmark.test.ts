import { describe, expect, test } from "bun:test";
import { runSpatialBenchmark } from "../src/benchmark";
import type { SpatialBenchmarkScenario } from "../src/benchmark";

/**
 * Benchmark tests (the brief's §3.6 groups: "meanConfidence over a scenario
 * < 1" and the report's documented semantics). The static scenario is fully
 * hand-derived: one static player at the image center, fixture camera pan
 * 0.5 zoom 1 jitter 0, 10 frames at the 25 fps fixture cadence — every
 * metric is exact. Constants only — no RNG, no clock reads.
 */
const STATIC_SCENARIO: SpatialBenchmarkScenario = {
  name: "static-center",
  camera: { pan: 0.5, zoom: 1, jitter: 0 },
  players: [{ label: "player", motion: { kind: "static", at: { x: 0.5, y: 0.5 } } }],
  frames: 10,
};

describe("runSpatialBenchmark — the static hand-derived scenario", () => {
  const report = runSpatialBenchmark([STATIC_SCENARIO])[0]!;

  test("shape: frames, points, coverage, identity, jumps — all exact", () => {
    expect(report.scenario).toBe("static-center");
    expect(report.frames).toBe(10);
    // One player, always visible: 10 GT entries -> 10 fused points.
    expect(report.points).toBe(10);
    expect(report.coverage).toBe(1);
    // Static player + static camera: the tracker never switches ids (IoU is
    // 1 every frame) and no track ever moves.
    expect(report.identitySwitches).toBe(0);
    expect(report.maxPerFrameJump).toBe(0);
    // Box centers saturate within the image and the pan-0.5 window lies
    // inside the pitch — exactly zero out-of-play points.
    expect(report.outOfBounds).toBe(0);
  });

  test("meanConfidence over a scenario is < 1 (honest min fusion, ~0.9)", () => {
    // Fixture detection confidence 0.9 (W204) x fixture calibrator
    // confidence 0.9 (W203), fused by "min" -> 0.9 for every point.
    expect(report.meanConfidence).toBeLessThan(1);
    expect(report.meanConfidence).toBeCloseTo(0.9, 10);
  });

  test("deterministic: the same specs produce a deep-equal report array", () => {
    expect(runSpatialBenchmark([STATIC_SCENARIO])).toEqual(runSpatialBenchmark([STATIC_SCENARIO]));
  });
});

describe("runSpatialBenchmark — scenario composition", () => {
  test("reports come back in spec order with their names", () => {
    const reports = runSpatialBenchmark([
      STATIC_SCENARIO,
      { ...STATIC_SCENARIO, name: "second", frames: 5 },
    ]);
    expect(reports.map((r) => r.scenario)).toEqual(["static-center", "second"]);
    expect(reports[1]!.frames).toBe(5);
    expect(reports[1]!.points).toBe(5);
  });

  test("an empty players array is a documented degenerate: zeros, no crash", () => {
    const report = runSpatialBenchmark([{ ...STATIC_SCENARIO, name: "empty", players: [] }])[0]!;
    expect(report.points).toBe(0);
    expect(report.coverage).toBe(0); // zero denominator -> 0, never NaN
    expect(report.meanConfidence).toBe(0);
    expect(report.maxPerFrameJump).toBe(0);
    expect(report.identitySwitches).toBe(0);
  });
});

describe("runSpatialBenchmark — fail-loud scenario validation", () => {
  test("specs must be an array", () => {
    expect(() => runSpatialBenchmark("nope" as never)).toThrow(RangeError);
  });

  test("scenario name / frames / players surface is validated", () => {
    expect(() => runSpatialBenchmark([{ ...STATIC_SCENARIO, name: "" }])).toThrow(RangeError);
    expect(() => runSpatialBenchmark([{ ...STATIC_SCENARIO, frames: 0 }])).toThrow(RangeError);
    expect(() => runSpatialBenchmark([{ ...STATIC_SCENARIO, players: "nope" as never }])).toThrow(
      RangeError,
    );
    expect(() =>
      runSpatialBenchmark([
        {
          ...STATIC_SCENARIO,
          players: [{ label: "", motion: { kind: "static", at: { x: 0.5, y: 0.5 } } }],
        },
      ]),
    ).toThrow(RangeError);
  });

  test("panSweep bounds must stay in [0, 1]", () => {
    expect(() =>
      runSpatialBenchmark([{ ...STATIC_SCENARIO, panSweep: { from: -0.1, to: 0.6 } }]),
    ).toThrow(RangeError);
    expect(() =>
      runSpatialBenchmark([{ ...STATIC_SCENARIO, panSweep: { from: 0.4, to: 1.4 } }]),
    ).toThrow(RangeError);
  });

  test("a malformed clock fails loud (deeper W103 validation fires on mapping)", () => {
    expect(() =>
      runSpatialBenchmark([
        { ...STATIC_SCENARIO, clock: { trackId: "", offsetMs: 0, driftPpm: 0 } },
      ]),
    ).toThrow(RangeError);
  });
});
