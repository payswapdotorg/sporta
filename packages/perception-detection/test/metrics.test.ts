import { describe, expect, test } from "bun:test";
import type { DetectedBox, NormalizedBox } from "../src/detector";
import { runDetectionBenchmark } from "../src/benchmark";
import type { LabeledGroundTruth } from "../src/benchmark";

const box = (x: number, y: number, w: number, h: number): NormalizedBox => ({ x, y, w, h });

const detection = (x: number, y: number, w: number, h: number, label: string): DetectedBox => ({
  box: box(x, y, w, h),
  label,
  confidence: 0.9,
});

const gtFrame = (
  frameId: string,
  boxes: Array<{ box: NormalizedBox; label: string }>,
): LabeledGroundTruth => ({ frameId, boxes });

describe("runDetectionBenchmark metrics", () => {
  test("hand-computed: 3 GT, 4 predictions, 2 TP -> precision 0.5, recall 2/3, f1 4/7", () => {
    // Frame f-1: GT {A, B}; predictions {A-match, B-match} -> 2 TP.
    // Frame f-2: GT {C}; predictions {junk-1, junk-2} -> 2 FP + 1 FN.
    // Totals: TP 2, FP 2, FN 1 ->
    //   precision = 2 / 4          = 0.5
    //   recall    = 2 / 3          = 0.6667
    //   f1        = 2PR / (P + R)  = 4/7 = 0.5714
    const groundTruth = [
      gtFrame("f-1", [
        { box: box(0, 0, 0.4, 0.4), label: "player" },
        { box: box(0.5, 0.5, 0.4, 0.4), label: "player" },
      ]),
      gtFrame("f-2", [{ box: box(0.2, 0.2, 0.3, 0.3), label: "ball" }]),
    ];
    const predicted = new Map<string, readonly DetectedBox[]>([
      ["f-1", [detection(0, 0, 0.4, 0.4, "player"), detection(0.5, 0.5, 0.4, 0.4, "player")]],
      ["f-2", [detection(0.6, 0.6, 0.3, 0.3, "player"), detection(0.7, 0.7, 0.2, 0.2, "ball")]],
    ]);

    const report = runDetectionBenchmark({ groundTruth, predicted });

    expect(report.iouThreshold).toBe(0.5);
    expect(report.truePositives).toBe(2);
    expect(report.falsePositives).toBe(2);
    expect(report.falseNegatives).toBe(1);
    expect(report.precision).toBeCloseTo(0.5, 12);
    expect(report.recall).toBeCloseTo(2 / 3, 12);
    expect(report.f1).toBeCloseTo(4 / 7, 12);
  });

  test("zero predictions -> precision 0, recall 0 (zero-denominator convention)", () => {
    const groundTruth = [
      gtFrame("f-1", [
        { box: box(0, 0, 0.2, 0.2), label: "player" },
        { box: box(0.5, 0.5, 0.2, 0.2), label: "ball" },
      ]),
    ];
    const report = runDetectionBenchmark({ groundTruth, predicted: new Map() });

    expect(report.truePositives).toBe(0);
    expect(report.falsePositives).toBe(0);
    expect(report.falseNegatives).toBe(2);
    expect(report.precision).toBe(0);
    expect(report.recall).toBe(0);
    expect(report.f1).toBe(0);
    expect(report.perLabel.player).toEqual({ precision: 0, recall: 0, f1: 0 });
    expect(report.perLabel.ball).toEqual({ precision: 0, recall: 0, f1: 0 });
  });

  test("empty GT and empty predictions -> all-zero report with no labels", () => {
    const report = runDetectionBenchmark({ groundTruth: [], predicted: new Map() });
    expect(report.truePositives).toBe(0);
    expect(report.falsePositives).toBe(0);
    expect(report.falseNegatives).toBe(0);
    expect(report.perLabel).toEqual({});
  });

  test("per-label buckets bucket by class label", () => {
    // One frame: GT {player-1, player-2, ball}; predictions {player-1 match,
    // ball junk}. Global: TP 1, FP 1, FN 2 -> precision 0.5, recall 1/3.
    // player: TP 1, FN 1 -> precision 1, recall 0.5, f1 2/3.
    // ball:   TP 0, FP 1, FN 1 -> precision 0, recall 0, f1 0.
    const groundTruth = [
      gtFrame("f-1", [
        { box: box(0, 0, 0.4, 0.4), label: "player" },
        { box: box(0.5, 0.5, 0.4, 0.4), label: "player" },
        { box: box(0.2, 0.2, 0.2, 0.2), label: "ball" },
      ]),
    ];
    const predicted = new Map<string, readonly DetectedBox[]>([
      ["f-1", [detection(0, 0, 0.4, 0.4, "player"), detection(0.8, 0.8, 0.1, 0.1, "ball")]],
    ]);

    const report = runDetectionBenchmark({ groundTruth, predicted });

    expect(report.truePositives).toBe(1);
    expect(report.falsePositives).toBe(1);
    expect(report.falseNegatives).toBe(2);
    expect(report.precision).toBeCloseTo(0.5, 12);
    expect(report.recall).toBeCloseTo(1 / 3, 12);

    expect(report.perLabel.player?.precision).toBeCloseTo(1, 12);
    expect(report.perLabel.player?.recall).toBeCloseTo(0.5, 12);
    expect(report.perLabel.player?.f1).toBeCloseTo(2 / 3, 12);

    expect(report.perLabel.ball).toEqual({ precision: 0, recall: 0, f1: 0 });
  });

  test("GT frame missing from predictions -> all its boxes are FN; predicted-only frame -> all FPs", () => {
    const groundTruth = [gtFrame("f-gt", [{ box: box(0, 0, 0.3, 0.3), label: "player" }])];
    const predicted = new Map<string, readonly DetectedBox[]>([
      ["f-pred", [detection(0.6, 0.6, 0.3, 0.3, "player")]],
    ]);

    const report = runDetectionBenchmark({ groundTruth, predicted });

    expect(report.truePositives).toBe(0);
    expect(report.falsePositives).toBe(1); // the hallucinated frame
    expect(report.falseNegatives).toBe(1); // the un-predicted GT frame
    expect(report.perLabel.player).toEqual({ precision: 0, recall: 0, f1: 0 });
  });

  test("custom iouThreshold is honored and reported", () => {
    // IoU(GT, pred) = 0.4286: below the default 0.5, above 0.3.
    const groundTruth = [gtFrame("f-1", [{ box: box(0, 0, 0.5, 0.5), label: "player" }])];
    const predicted = new Map<string, readonly DetectedBox[]>([
      ["f-1", [detection(0.2, 0, 0.5, 0.5, "player")]],
    ]);

    const strict = runDetectionBenchmark({ groundTruth, predicted });
    expect(strict.iouThreshold).toBe(0.5);
    expect(strict.truePositives).toBe(0);
    expect(strict.falsePositives).toBe(1);
    expect(strict.falseNegatives).toBe(1);

    const loose = runDetectionBenchmark({ groundTruth, predicted, iouThreshold: 0.3 });
    expect(loose.iouThreshold).toBe(0.3);
    expect(loose.truePositives).toBe(1);
    expect(loose.falsePositives).toBe(0);
    expect(loose.falseNegatives).toBe(0);
  });

  test("pure: the same inputs produce a deep-equal report (built twice)", () => {
    const build = (): {
      groundTruth: LabeledGroundTruth[];
      predicted: Map<string, readonly DetectedBox[]>;
    } => ({
      groundTruth: [
        gtFrame("f-1", [
          { box: box(0, 0, 0.3, 0.3), label: "player" },
          { box: box(0.5, 0.5, 0.3, 0.3), label: "ball" },
        ]),
        gtFrame("f-2", [{ box: box(0.1, 0.1, 0.2, 0.2), label: "ball" }]),
      ],
      predicted: new Map<string, readonly DetectedBox[]>([
        ["f-1", [detection(0, 0, 0.3, 0.3, "player"), detection(0.9, 0.9, 0.05, 0.05, "ball")]],
        ["f-3", [detection(0.4, 0.4, 0.1, 0.1, "player")]],
      ]),
    });

    const first = runDetectionBenchmark(build());
    const second = runDetectionBenchmark(build());
    expect(first).toEqual(second);
  });
});
