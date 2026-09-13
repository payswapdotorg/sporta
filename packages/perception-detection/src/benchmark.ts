/**
 * Detection benchmark harness (W201).
 *
 * Deterministic, pure IoU-based evaluation of per-frame detection output
 * against labeled ground truth — the "fixture benchmark reports
 * precision/recall" acceptance for W201. No RNG, no clock, no I/O: the same
 * inputs always produce a deep-equal {@link DetectionBenchmarkReport}.
 *
 * The metrics are DETECTION-level (box + label), matching W201's scope;
 * identity-continuity metrics are W204.
 */
import type { DetectedBox, NormalizedBox } from "./detector";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Intersection over union of two normalized boxes, in [0, 1].
 *
 * Math (each box's edges are first clamped into the unit square — normalized
 * coordinates, and the contract schema bounds fields individually so
 * hand-built boxes may extend past a frame edge):
 *
 * ```text
 * x1 = max(a.x, b.x)          x2 = min(a.x + a.w, b.x + b.w)
 * y1 = max(a.y, b.y)          y2 = min(a.y + a.h, b.y + b.h)
 * inter = max(0, x2 - x1) * max(0, y2 - y1)
 * union = area(a) + area(b) - inter
 * iou   = clamp01(inter / union)
 * ```
 *
 * - identical (non-degenerate) boxes → inter = union → exactly 1;
 * - disjoint boxes → inter = 0 → 0;
 * - both boxes degenerate to zero area after clamping (union ≤ 0): 1 iff
 *   every clamped edge coincides, else 0 (documented convention for the
 *   0/0 corner);
 * - inputs are contract-shaped numbers; NaN behavior is unspecified.
 */
export function iou(a: NormalizedBox, b: NormalizedBox): number {
  const ax1 = clamp01(a.x);
  const ay1 = clamp01(a.y);
  const ax2 = clamp01(a.x + a.w);
  const ay2 = clamp01(a.y + a.h);
  const bx1 = clamp01(b.x);
  const by1 = clamp01(b.y);
  const bx2 = clamp01(b.x + b.w);
  const by2 = clamp01(b.y + b.h);

  const interWidth = Math.min(ax2, bx2) - Math.max(ax1, bx1);
  const interHeight = Math.min(ay2, by2) - Math.max(ay1, by1);
  const inter = Math.max(0, interWidth) * Math.max(0, interHeight);

  const areaA = (ax2 - ax1) * (ay2 - ay1);
  const areaB = (bx2 - bx1) * (by2 - by1);
  const union = areaA + areaB - inter;

  if (union <= 0) {
    // Both boxes have zero area after clamping. The only non-arbitrary
    // answer for the 0/0 corner is the identity test on the clamped edges.
    return ax1 === bx1 && ay1 === by1 && ax2 === bx2 && ay2 === by2 ? 1 : 0;
  }
  return clamp01(inter / union);
}

/** One ground-truth box with its class label. */
export interface GroundTruthBox {
  readonly box: NormalizedBox;
  readonly label: string;
}

/** Labeled ground truth for one frame. */
export interface LabeledGroundTruth {
  readonly frameId: string;
  readonly boxes: readonly GroundTruthBox[];
}

/** One matched (ground truth, prediction) pair. */
export interface MatchedPair {
  /** Index into the ground-truth frame's `boxes` array. */
  readonly gtIndex: number;
  /** Index into the predicted detection array. */
  readonly predictedIndex: number;
  /** IoU of the matched pair (≥ the threshold used). */
  readonly iou: number;
  /** The pair's shared label (matching requires label equality). */
  readonly label: string;
}

/** Result of matching one frame's predictions against its ground truth. */
export interface MatchDetectionsResult {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  /** Matched pairs, in match order (IoU descending — see `matchDetections`). */
  readonly matched: readonly MatchedPair[];
  /** Indices of unmatched predictions (each a false positive). */
  readonly unmatchedPredictionIndices: readonly number[];
  /** Indices of unmatched ground-truth boxes (each a false negative). */
  readonly unmatchedGroundTruthIndices: readonly number[];
}

/**
 * Greedy one-to-one matching of one frame's predictions against its ground
 * truth at `iouThreshold` (default 0.5).
 *
 * Candidates are (GT, prediction) pairs with the SAME label and IoU ≥
 * threshold — an IoU exactly equal to the threshold matches (inclusive). The
 * candidates are sorted by IoU DESCENDING, ties broken by ground-truth array
 * order, then prediction array order (documented deterministic tie-break),
 * and consumed greedily: a pair matches only if BOTH its GT box and its
 * prediction are still unmatched, so each prediction matches at most one GT
 * box and vice versa. A GT box therefore ends up with the best-IoU
 * still-available same-label prediction.
 *
 * After matching: matched pairs are TPs, unmatched predictions are FPs,
 * unmatched GT boxes are FNs. Pure function of the inputs.
 */
export function matchDetections(
  gt: LabeledGroundTruth,
  predicted: readonly DetectedBox[],
  iouThreshold: number = 0.5,
): MatchDetectionsResult {
  interface Candidate {
    gtIndex: number;
    predictedIndex: number;
    iou: number;
  }

  const candidates: Candidate[] = [];
  for (const [gtIndex, gtBox] of gt.boxes.entries()) {
    for (const [predictedIndex, prediction] of predicted.entries()) {
      if (gtBox.label !== prediction.label) continue;
      const overlap = iou(gtBox.box, prediction.box);
      if (overlap >= iouThreshold) {
        candidates.push({ gtIndex, predictedIndex, iou: overlap });
      }
    }
  }

  candidates.sort(
    (a, b) => b.iou - a.iou || a.gtIndex - b.gtIndex || a.predictedIndex - b.predictedIndex,
  );

  const gtMatched = new Array<boolean>(gt.boxes.length).fill(false);
  const predictedMatched = new Array<boolean>(predicted.length).fill(false);
  const matched: MatchedPair[] = [];
  for (const candidate of candidates) {
    if (gtMatched[candidate.gtIndex] || predictedMatched[candidate.predictedIndex]) continue;
    gtMatched[candidate.gtIndex] = true;
    predictedMatched[candidate.predictedIndex] = true;
    matched.push({
      gtIndex: candidate.gtIndex,
      predictedIndex: candidate.predictedIndex,
      iou: candidate.iou,
      label: gt.boxes[candidate.gtIndex]?.label ?? "",
    });
  }

  const unmatchedPredictionIndices = predictedMatched
    .map((wasMatched, index) => (wasMatched ? -1 : index))
    .filter((index) => index >= 0);
  const unmatchedGroundTruthIndices = gtMatched
    .map((wasMatched, index) => (wasMatched ? -1 : index))
    .filter((index) => index >= 0);

  return {
    truePositives: matched.length,
    falsePositives: unmatchedPredictionIndices.length,
    falseNegatives: unmatchedGroundTruthIndices.length,
    matched,
    unmatchedPredictionIndices,
    unmatchedGroundTruthIndices,
  };
}

/** Precision / recall / F1 for one bucket of counts. */
export interface LabelMetrics {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

/**
 * Aggregate detection benchmark report (global plus per-label buckets).
 *
 * Convention (documented): `precision`, `recall`, and `f1` are 0 whenever
 * their denominator is 0 — a bucket with no predictions and no ground truth
 * (or TPs only from an empty set) reports 0 rather than NaN.
 */
export interface DetectionBenchmarkReport {
  /** The IoU threshold the report was computed at. */
  readonly iouThreshold: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  /** Per-label metrics keyed by class label (labels seen in GT or predictions). */
  readonly perLabel: Readonly<Record<string, LabelMetrics>>;
}

/** Precision/recall/F1 with the zero-denominator convention applied. */
function metricsFor(tp: number, fp: number, fn: number): LabelMetrics {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

/**
 * Aggregates the benchmark across frames (global + per-label).
 *
 * Frames are the ground-truth array order, followed by any predicted-only
 * frame ids (in `predicted` map order): a frame with predictions but no
 * ground-truth entry contributes ALL its predictions as false positives —
 * hallucinating on unannotated frames must cost precision. A ground-truth
 * frame missing from `predicted` contributes all its boxes as false
 * negatives. Per-label buckets: matched pairs count toward their (shared)
 * label; unmatched predictions toward the prediction's label; unmatched GT
 * toward the GT label.
 *
 * Pure: same inputs → deep-equal report (all outputs are counts and ratios
 * computed from them, so aggregation order cannot change the result).
 */
export function runDetectionBenchmark(input: {
  readonly groundTruth: readonly LabeledGroundTruth[];
  readonly predicted: ReadonlyMap<string, readonly DetectedBox[]>;
  readonly iouThreshold?: number;
}): DetectionBenchmarkReport {
  const iouThreshold = input.iouThreshold ?? 0.5;

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const perLabelCounts = new Map<string, { tp: number; fp: number; fn: number }>();
  const bucketFor = (label: string): { tp: number; fp: number; fn: number } => {
    let bucket = perLabelCounts.get(label);
    if (bucket === undefined) {
      bucket = { tp: 0, fp: 0, fn: 0 };
      perLabelCounts.set(label, bucket);
    }
    return bucket;
  };

  const accountFrame = (gt: LabeledGroundTruth, predicted: readonly DetectedBox[]): void => {
    const result = matchDetections(gt, predicted, iouThreshold);
    truePositives += result.truePositives;
    falsePositives += result.falsePositives;
    falseNegatives += result.falseNegatives;
    for (const pair of result.matched) bucketFor(pair.label).tp += 1;
    for (const index of result.unmatchedPredictionIndices) {
      bucketFor(predicted[index]?.label ?? "").fp += 1;
    }
    for (const index of result.unmatchedGroundTruthIndices) {
      bucketFor(gt.boxes[index]?.label ?? "").fn += 1;
    }
  };

  const seenFrameIds = new Set<string>();
  for (const gt of input.groundTruth) {
    seenFrameIds.add(gt.frameId);
    accountFrame(gt, input.predicted.get(gt.frameId) ?? []);
  }
  for (const [frameId, predicted] of input.predicted) {
    if (!seenFrameIds.has(frameId)) {
      accountFrame({ frameId, boxes: [] }, predicted);
    }
  }

  const perLabel: Record<string, LabelMetrics> = {};
  for (const [label, counts] of perLabelCounts) {
    perLabel[label] = metricsFor(counts.tp, counts.fp, counts.fn);
  }

  return {
    iouThreshold,
    truePositives,
    falsePositives,
    falseNegatives,
    ...metricsFor(truePositives, falsePositives, falseNegatives),
    perLabel,
  };
}
