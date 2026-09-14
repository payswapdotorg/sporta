import { describe, expect, test } from "bun:test";
import { CANONICAL_CORNER_ORDER } from "@sporta/field-mapping";
import type { FieldCornerSet } from "@sporta/field-mapping";
import { estimateSpatialState } from "../src/state";
import type { SpatialFrame } from "../src/state";
import { runSpatialBenchmark } from "../src/benchmark";
import type { SpatialBenchmarkScenario } from "../src/benchmark";

/**
 * W206 confidence-fusion tests — explicit, no inflation: min/product of
 * (track confidence, corner-set confidence), raw values preserved in
 * sourceConfidences, and meanConfidence over a scenario strictly below 1.
 * Constants only; all expected values hand-computed.
 */

function cornerSet(confidence: number): FieldCornerSet {
  return {
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    cornerOrder: CANONICAL_CORNER_ORDER,
    confidence,
  };
}

function spatialFrame(trackConfidence: number, cornerConfidence: number): SpatialFrame {
  return {
    frame: { frameId: "f-0-0", presentationMs: 0, decodeOrder: 0 },
    cornerSet: cornerSet(cornerConfidence),
    tracks: [
      {
        box: { x: 0.25, y: 0.375, w: 0.5, h: 0.25 },
        label: "player",
        confidence: trackConfidence,
        trackId: "t1",
      },
    ],
  };
}

describe("confidence fusion — explicit, no inflation", () => {
  test("track 0.9 x corners 0.9: min -> 0.9, product -> 0.81", () => {
    const minSeries = estimateSpatialState([spatialFrame(0.9, 0.9)]);
    expect(minSeries.points[0]!.confidence).toBe(0.9);

    const productSeries = estimateSpatialState([spatialFrame(0.9, 0.9)], {
      confidenceCombination: "product",
    });
    // 0.9 * 0.9 is bit-exact 0.81 in IEEE-754 (verified against the seam).
    expect(productSeries.points[0]!.confidence).toBe(0.81);
  });

  test("track 0.4 x corners 0.9: min -> 0.4 (the bottleneck is honest)", () => {
    const series = estimateSpatialState([spatialFrame(0.4, 0.9)]);
    expect(series.points[0]!.confidence).toBe(0.4);

    const productSeries = estimateSpatialState([spatialFrame(0.4, 0.9)], {
      confidenceCombination: "product",
    });
    // Bit-identical to the same arithmetic the fusion performs.
    expect(productSeries.points[0]!.confidence).toBe(0.4 * 0.9);
    expect(productSeries.points[0]!.confidence).toBeCloseTo(0.36, 12);
  });

  test("raw source confidences are preserved verbatim for re-fusion", () => {
    const series = estimateSpatialState([spatialFrame(0.4, 0.9)]);
    expect(series.points[0]!.sourceConfidences).toEqual({ track: 0.4, corners: 0.9 });

    const productSeries = estimateSpatialState([spatialFrame(0.4, 0.9)], {
      confidenceCombination: "product",
    });
    // The combination choice changes the FUSED value, never the sources.
    expect(productSeries.points[0]!.sourceConfidences).toEqual({ track: 0.4, corners: 0.9 });
  });

  test("confidence 0 boundaries are legal (no inflation, no rejection)", () => {
    const series = estimateSpatialState([spatialFrame(0, 0.9)]);
    expect(series.points[0]!.confidence).toBe(0);
    expect(series.points[0]!.sourceConfidences).toEqual({ track: 0, corners: 0.9 });
  });

  test("meanConfidence over a scenario is strictly below 1", () => {
    // Fixture defaults: detection confidence 0.9 (W204), fixture calibrator
    // confidence 0.9 (W203) -> fused min 0.9 everywhere; mean 0.9 < 1.
    const scenario: SpatialBenchmarkScenario = {
      name: "confidence-mean",
      camera: { pan: 0.5, zoom: 1, jitter: 0 },
      players: [
        {
          label: "player",
          motion: { kind: "linear", from: { x: 0.4, y: 0.4 }, to: { x: 0.6, y: 0.6 } },
        },
      ],
      frames: 25,
    };
    const [report] = runSpatialBenchmark([scenario]);
    expect(report).toBeDefined();
    // Mean of 0.9 over 25 points: per-point values are bit-exact 0.9; the
    // running sum accumulates ~1e-16 float error, so the mean is 0.9 to
    // within 12 decimal digits (and honestly below 1).
    expect(report!.meanConfidence).toBeCloseTo(0.9, 12);
    expect(report!.meanConfidence).toBeLessThan(1);
  });

  test("out-of-range confidences fail loud (they must survive into zod [0, 1] slots)", () => {
    expect(() => estimateSpatialState([spatialFrame(1.2, 0.9)])).toThrow(RangeError);
    expect(() => estimateSpatialState([spatialFrame(0.4, -0.1)])).toThrow(RangeError);
    expect(() =>
      estimateSpatialState([spatialFrame(0.4, 0.9)], {
        // Runtime garbage in the combination slot (JS callers):
        confidenceCombination: "average" as "min" | "product",
      }),
    ).toThrow(RangeError);
  });
});
