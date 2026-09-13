import { describe, expect, test } from "bun:test";
import type { DetectedBox, NormalizedBox } from "../src/detector";
import { iou, matchDetections } from "../src/benchmark";
import type { LabeledGroundTruth } from "../src/benchmark";

const box = (x: number, y: number, w: number, h: number): NormalizedBox => ({ x, y, w, h });

const detection = (x: number, y: number, w: number, h: number, label: string): DetectedBox => ({
  box: box(x, y, w, h),
  label,
  confidence: 0.9,
});

const frame = (boxes: Array<{ box: NormalizedBox; label: string }>): LabeledGroundTruth => ({
  frameId: "f-0-0",
  boxes,
});

describe("matchDetections", () => {
  test("one prediction overlapping two GT boxes matches exactly ONE (best IoU)", () => {
    // pred == GT2's box: IoU(pred, GT2) = 1, IoU(pred, GT1) = 0.8223 (>= 0.5).
    // The prediction is consumed by GT2; GT1 has no other prediction -> FN.
    const gt = frame([
      { box: box(0, 0, 0.4, 0.4), label: "player" },
      { box: box(0.02, 0.02, 0.4, 0.4), label: "player" },
    ]);
    const predicted = [detection(0.02, 0.02, 0.4, 0.4, "player")];

    const result = matchDetections(gt, predicted);

    expect(result.truePositives).toBe(1);
    expect(result.falsePositives).toBe(0);
    expect(result.falseNegatives).toBe(1);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.gtIndex).toBe(1);
    expect(result.matched[0]?.predictedIndex).toBe(0);
    expect(result.unmatchedGroundTruthIndices).toEqual([0]);
    expect(result.unmatchedPredictionIndices).toEqual([]);
  });

  test("label mismatch never matches, even at IoU 1", () => {
    const gt = frame([{ box: box(0, 0, 0.4, 0.4), label: "player" }]);
    const predicted = [detection(0, 0, 0.4, 0.4, "ball")];

    const result = matchDetections(gt, predicted);

    expect(result.truePositives).toBe(0);
    expect(result.falsePositives).toBe(1);
    expect(result.falseNegatives).toBe(1);
  });

  test("below-threshold overlap is FP + FN", () => {
    // IoU = 0.01 / 0.31 = 0.0323 < 0.5.
    const gt = frame([{ box: box(0, 0, 0.4, 0.4), label: "player" }]);
    const predicted = [detection(0.3, 0.3, 0.4, 0.4, "player")];

    const result = matchDetections(gt, predicted);

    expect(result.truePositives).toBe(0);
    expect(result.falsePositives).toBe(1);
    expect(result.falseNegatives).toBe(1);
  });

  test("threshold boundary: IoU exactly equal to the threshold matches", () => {
    // All values binary-exact: inter = 0.375, union = 0.75, iou = 0.5 exactly.
    const gtBox = box(0, 0, 0.75, 0.75);
    const predBox = box(0.25, 0, 0.75, 0.75);
    expect(iou(gtBox, predBox)).toBe(0.5);

    const gt = frame([{ box: gtBox, label: "player" }]);
    const predicted = [{ box: predBox, label: "player", confidence: 0.9 }];

    expect(matchDetections(gt, predicted).truePositives).toBe(1);
    expect(matchDetections(gt, predicted, 0.5).truePositives).toBe(1);
    expect(matchDetections(gt, predicted, 0.500001).truePositives).toBe(0);
  });

  test("deterministic tie-break: equal IoU -> lower GT index wins", () => {
    // pred is equidistant from GT1 and GT2; both candidate IoUs are exactly
    // 0.6 (inter = 0.1875, union = 0.3125 on both sides). The tie is broken
    // by GT array order, so GT1 (index 0) consumes the prediction.
    const gt = frame([
      { box: box(0, 0, 0.5, 0.5), label: "player" },
      { box: box(0.25, 0, 0.5, 0.5), label: "player" },
    ]);
    const predicted = [detection(0.125, 0, 0.5, 0.5, "player")];

    const result = matchDetections(gt, predicted);

    expect(result.truePositives).toBe(1);
    expect(result.falseNegatives).toBe(1);
    expect(result.matched[0]?.gtIndex).toBe(0);
    expect(result.matched[0]?.predictedIndex).toBe(0);
    expect(result.matched[0]?.label).toBe("player");
  });

  test("deterministic tie-break: equal IoU -> lower prediction index wins", () => {
    // Both predictions have IoU exactly 0.6 with the single GT box.
    const gt = frame([{ box: box(0, 0, 0.5, 0.5), label: "player" }]);
    const p1 = detection(0.125, 0, 0.5, 0.5, "player");
    const p2 = detection(0, 0.125, 0.5, 0.5, "player");

    const result = matchDetections(gt, [p1, p2]);

    expect(result.matched[0]?.predictedIndex).toBe(0);
    expect(result.truePositives).toBe(1);
    expect(result.falsePositives).toBe(1);
    expect(result.falseNegatives).toBe(0);
  });

  test("highest IoU wins regardless of array order", () => {
    const gt = frame([{ box: box(0, 0, 0.5, 0.5), label: "player" }]);
    const iouSix = detection(0.125, 0, 0.5, 0.5, "player"); // IoU 0.6
    const iouOne = detection(0, 0, 0.5, 0.5, "player"); // IoU 1.0

    // Lower-index prediction has the LOWER IoU; the higher IoU still wins.
    const first = matchDetections(gt, [iouSix, iouOne]);
    expect(first.matched[0]?.predictedIndex).toBe(1);
    expect(first.falsePositives).toBe(1);

    // Reversed array: same winner, now at index 0.
    const second = matchDetections(gt, [iouOne, iouSix]);
    expect(second.matched[0]?.predictedIndex).toBe(0);
    expect(second.falsePositives).toBe(1);
  });

  test("empty ground truth -> every prediction is a false positive", () => {
    const result = matchDetections(frame([]), [detection(0, 0, 0.2, 0.2, "player")]);
    expect(result.truePositives).toBe(0);
    expect(result.falsePositives).toBe(1);
    expect(result.falseNegatives).toBe(0);
  });

  test("empty predictions -> every GT box is a false negative", () => {
    const gt = frame([
      { box: box(0, 0, 0.2, 0.2), label: "player" },
      { box: box(0.5, 0.5, 0.2, 0.2), label: "ball" },
    ]);
    const result = matchDetections(gt, []);
    expect(result.truePositives).toBe(0);
    expect(result.falsePositives).toBe(0);
    expect(result.falseNegatives).toBe(2);
    expect(result.unmatchedGroundTruthIndices).toEqual([0, 1]);
  });
});
