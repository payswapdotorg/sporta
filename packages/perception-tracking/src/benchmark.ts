/**
 * Identity continuity benchmark (W204) — the acceptance-criteria instrument:
 * "identity continuity metric is implemented and benchmarked across
 * cuts/occlusion."
 *
 * Pure and deterministic: no RNG, no clock, no I/O. The same inputs always
 * produce a deep-equal {@link TrackingBenchmarkReport}.
 *
 * Correspondence rule (documented): per frame, ground-truth entries are
 * matched against the predicted `TrackedBox`es with W201's
 * `matchDetections` — greedy one-to-one IoU matching, label-gated, IoU >=
 * threshold (inclusive), candidates sorted IoU-descending with
 * ground-truth-array-order then prediction-array-order tie-breaks. This is
 * the SAME correspondence rule W201's detection benchmark uses, applied to
 * (GT object, predicted track) pairs; `TrackedBox` is structurally a
 * `DetectedBox` plus the track id, so the matcher is reused VERBATIM.
 *
 * Walk order (documented): frames are processed in the `groundTruth` array
 * order — generateFixtureFrames emits decode order, which the metrics below
 * rely on (identity switches are defined over consecutive frames).
 */
import { matchDetections } from "@sporta/perception-detection";
import type { GroundTruthFrame } from "./fixture";
import type { TrackedBox } from "./tracker";

/** Identity-continuity report — all fields pure functions of the inputs. */
export interface TrackingBenchmarkReport {
  /** The IoU threshold used for the GT-vs-predicted correspondence. */
  readonly iouThreshold: number;
  /** Total GT boxes matched to a predicted track across all frames. */
  readonly matchedDetections: number;
  /** Total GT boxes NOT matched to any predicted track (missed by the tracker). */
  readonly missedDetections: number;
  /**
   * Sum over GT objects of identity switches: for each object, the walk over
   * its MATCHED detections (in frame order) forms consecutive pairs —
   * frames where the object was present-but-unmatched are simply not in the
   * walk, and absent (occluded) frames likewise — and each pair whose
   * predicted trackId CHANGED counts one switch.
   */
  readonly identitySwitches: number;
  /**
   * Identity-preserving consecutive pairs / total consecutive pairs
   * (0 when there are no pairs — documented convention: an empty or fully
   * unmatched scenario reports 0, not NaN).
   */
  readonly continuityScore: number;
  /**
   * Per GT object (key: gtId, including never-matched objects with value 0):
   * the number of DISTINCT predicted track ids ever matched to that object.
   * 1 = perfect continuity for that object; more = fragmentation.
   */
  readonly fragments: Readonly<Record<string, number>>;
  /**
   * Per predicted track (key: trackId, tracks with >= 1 matched detection
   * only): the fraction of that track's matched detections whose GT object
   * equals its majority GT object. 1 = pure track (no id mixing); < 1 = the
   * track carried detections of more than one physical object. A majority
   * COUNT tie yields the same fraction regardless of which tied gtId is
   * named "majority", so the reported value is unambiguous.
   */
  readonly trackPurity: Readonly<Record<string, number>>;
  /**
   * Mean of {@link trackPurity} over tracks with >= 1 matched detection
   * (0 when there are none — documented convention).
   */
  readonly meanTrackPurity: number;
}

/** Input for {@link runTrackingBenchmark}. */
export interface TrackingBenchmarkInput {
  /**
   * Ground-truth frames (the output of `generateFixtureFrames`), in decode
   * order — the walk order for identity switches.
   */
  readonly groundTruth: readonly GroundTruthFrame[];
  /** Predicted tracks per frame id (the tracker's output map). */
  readonly predicted: ReadonlyMap<string, readonly TrackedBox[]>;
  /** Correspondence IoU threshold (default 0.5, inclusive). */
  readonly iouThreshold?: number;
}

/**
 * Computes the identity-continuity report.
 *
 * Per frame the correspondence is W201's `matchDetections` (see module docs);
 * matched pairs feed the per-object walks and the per-track purity counts;
 * unmatched GT entries count as `missedDetections`. Predicted tracks that
 * match no GT box are NOT penalized here (detection-level false positives
 * are W201's detection benchmark; this report is identity-level — a track
 * matched to nothing simply does not appear in `trackPurity`).
 *
 * Note (documented): frames present in `predicted` but absent from
 * `groundTruth` are ignored (there is no GT to score against); frames with
 * GT but no predictions contribute all their GT boxes as missed.
 */
export function runTrackingBenchmark(input: TrackingBenchmarkInput): TrackingBenchmarkReport {
  const iouThreshold = input.iouThreshold ?? 0.5;

  let matchedDetections = 0;
  let missedDetections = 0;
  let identitySwitches = 0;
  let identityPreservingPairs = 0;
  let totalPairs = 0;

  /** gtId -> ordered list of matched track ids (frame order). */
  const gtWalk = new Map<string, string[]>();
  /** trackId -> gtId -> matched count. */
  const trackCounts = new Map<string, Map<string, number>>();

  for (const gtFrame of input.groundTruth) {
    const predicted = input.predicted.get(gtFrame.frame.frameId) ?? [];
    const result = matchDetections(
      {
        frameId: gtFrame.frame.frameId,
        boxes: gtFrame.groundTruth.map((entry) => ({ box: entry.box, label: entry.label })),
      },
      predicted,
      iouThreshold,
    );

    matchedDetections += result.matched.length;
    missedDetections += result.unmatchedGroundTruthIndices.length;

    for (const pair of result.matched) {
      const gtEntry = gtFrame.groundTruth[pair.gtIndex];
      const track = predicted[pair.predictedIndex];
      if (gtEntry === undefined || track === undefined) continue;

      let walk = gtWalk.get(gtEntry.gtId);
      if (walk === undefined) {
        walk = [];
        gtWalk.set(gtEntry.gtId, walk);
      }
      walk.push(track.trackId);

      let counts = trackCounts.get(track.trackId);
      if (counts === undefined) {
        counts = new Map();
        trackCounts.set(track.trackId, counts);
      }
      counts.set(gtEntry.gtId, (counts.get(gtEntry.gtId) ?? 0) + 1);
    }
  }

  // Identity switches + continuity: walk each object's matched track ids in
  // frame order; consecutive entries form pairs (frames where the object was
  // absent or present-but-unmatched are not in the walk — the pair spans
  // them); a pair whose trackId changed counts one switch.
  for (const walk of gtWalk.values()) {
    for (let i = 1; i < walk.length; i += 1) {
      totalPairs += 1;
      if (walk[i - 1] === walk[i]) {
        identityPreservingPairs += 1;
      } else {
        identitySwitches += 1;
      }
    }
  }
  const continuityScore = totalPairs > 0 ? identityPreservingPairs / totalPairs : 0;

  // Fragments: distinct track ids ever matched per object — INCLUDING
  // objects that appear in the ground truth but never match (value 0), so
  // the record is complete over the annotated scene.
  const fragments: Record<string, number> = {};
  const seenGtIds = new Set<string>();
  for (const gtFrame of input.groundTruth) {
    for (const entry of gtFrame.groundTruth) seenGtIds.add(entry.gtId);
  }
  for (const gtId of seenGtIds) {
    fragments[gtId] = new Set(gtWalk.get(gtId) ?? []).size;
  }

  // Track purity: per track (with >= 1 matched detection), the majority gtId
  // share of its matched detections. Keys are inserted in first-matched
  // order (deterministic given the inputs).
  const trackPurity: Record<string, number> = {};
  let puritySum = 0;
  for (const [trackId, counts] of trackCounts) {
    let total = 0;
    let majority = 0;
    for (const count of counts.values()) {
      total += count;
      if (count > majority) majority = count;
    }
    const purity = total > 0 ? majority / total : 0;
    trackPurity[trackId] = purity;
    puritySum += purity;
  }
  const trackCount = Object.keys(trackPurity).length;
  const meanTrackPurity = trackCount > 0 ? puritySum / trackCount : 0;

  return {
    iouThreshold,
    matchedDetections,
    missedDetections,
    identitySwitches,
    continuityScore,
    fragments,
    trackPurity,
    meanTrackPurity,
  };
}
