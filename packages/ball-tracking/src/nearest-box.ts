/**
 * Deterministic greedy nearest-box ball tracker (W202).
 *
 * ALGORITHM (documented in full — every rule is part of the contract the
 * benchmark asserts against):
 *
 * 1. SEED: the scan starts at the first frame that carries an unclaimed
 *    detection and seeds a track from that frame's FIRST unclaimed detection
 *    (detection array order). Label matching is the CALLER's filter — the
 *    tracker accepts any detections; typical usage filters to label "ball"
 *    upstream. `trackId = "bt-<seed frame decodeOrder>-<seq>"`, seq starting
 *    at 1 and incrementing per track — an id switch is therefore VISIBLE by
 *    construction (every additional track is a switch).
 *
 * 2. EXTEND: per subsequent frame j, among the frame's UNCLAIMED detections
 *    choose the one with minimal box-center displacement from the track's
 *    last OBSERVED box center (ties broken by detection array order). The
 *    candidate associates IFF its displacement is within the step gate
 *
 *    ```text
 *    gate(j) = maxStep * (j - lastObservedFrameIndex)
 *    ```
 *
 *    `maxStep` (default 0.15 normalized units per frame) is a PER-FRAME
 *    motion budget: over the `j - i` frame steps since the last observation
 *    at frame i the ball may legitimately travel up to `maxStep` per step,
 *    so the gate accumulates linearly. For consecutive frames this is
 *    exactly the spec's base case `displacement <= maxStep`.
 *
 * 3. OCCLUSION GAP: a frame with no detection (or none within the gate)
 *    extends an occlusion gap — the track stays OPEN (however long the gap
 *    grows; its length is only decided when the next detection arrives or
 *    the input ends). When a detection finally re-associates at frame j with
 *    anchor frame i and gap length `j - i - 1 <= maxGapFrames` (default 12),
 *    the gap is BRIDGED: frames i+1 .. j-1 are filled with INTERPOLATED
 *    points, each the linear interpolation of the whole box between the
 *    anchor boxes at parameter `u = (k - i) / (j - i)` (interpolation of
 *    values within [0, 1] stays within [0, 1], so interpolated boxes remain
 *    contract-valid). Interpolated confidence decays exponentially from the
 *    anchor detection's confidence:
 *
 *    ```text
 *    confidence(k) = anchorConfidence * 0.5 ^ ceil(gapElapsed / 4)
 *    gapElapsed    = k - i            (1 for the first interpolated frame)
 *    ```
 *
 *    i.e. the discount halves every 4 frames of elapsed gap (explicit,
 *    decaying uncertainty — architecture-lock §4: an interpolated position
 *    NEVER claims detection-level confidence, and never full confidence at
 *    all: the first interpolated frame is already at half).
 *
 * 4. CLOSE: a detection arriving at frame j with gap length
 *    `j - i - 1 > maxGapFrames` CANNOT be bridged — the track closes with
 *    an UNBRIDDED gap record (`bridged: false`, `toMs` = the rejected
 *    re-observation's presentationMs — a bookkeeping endpoint, not an
 *    observation), and that detection is REJECTED: it was evaluated against
 *    this track and arrived too late, so it is not claimed and does not seed
 *    the next track — a LATER detection does (the scan resumes at frame
 *    j + 1, so the switch costs one visible frame, which the benchmark's
 *    coverage metric reports honestly). A gap still open at the END of input
 *    is likewise recorded unbridged (`toMs` = last input frame).
 *
 * 5. EDGES: extrapolation NEVER happens — tracks start on the seed
 *    detection and end on their last OBSERVED box; there are no points
 *    before the first detection or after the last one (no invented
 *    certainty, architecture-lock §4). A trailing gap (ball lost at the end
 *    of input) is recorded, never extrapolated across.
 *
 * 6. CLUTTER: the scan is strictly forward. Detections that fail a gate
 *    while a track is open, and extra candidates in a multi-detection frame
 *    (the tracker claims only the nearest), remain unclaimed and are never
 *    re-examined — for a single-ball tracker, leftover candidates are
 *    clutter, not new balls.
 *
 * Purity: no RNG, no clock, no I/O — the same input always produces a
 * deep-equal output (docs/testing/HARNESS.md).
 */
import type {
  BallObservationFrame,
  BallOcclusionGap,
  BallTrack,
  BallTrackPoint,
  BallTrackerAdapter,
} from "./tracker";
import type { DetectedBox, NormalizedBox } from "@sporta/perception-detection";

/** Default per-frame association budget in normalized units (0.15/frame). */
export const DEFAULT_MAX_STEP = 0.15;
/** Default maximum occlusion gap length (in frames) that can be bridged. */
export const DEFAULT_MAX_GAP_FRAMES = 12;
/** Default component id stamped on observations emitted from this tracker. */
export const DEFAULT_TRACKER_ID = "nearest-box-v1";

/** Options for {@link NearestBoxBallTracker}; every field is optional. */
export interface NearestBoxTrackerOptions {
  /** Component id (default {@link DEFAULT_TRACKER_ID}). */
  readonly trackerId?: string;
  /** Per-frame association budget (default 0.15 normalized units). */
  readonly maxStep?: number;
  /** Max bridgable gap length in frames (default 12). */
  readonly maxGapFrames?: number;
}

/** Center of a normalized box (used for displacement computations). */
function boxCenter(box: NormalizedBox): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** Euclidean center displacement between two boxes, in normalized units. */
function centerDisplacement(a: NormalizedBox, b: NormalizedBox): number {
  const ca = boxCenter(a);
  const cb = boxCenter(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Linear interpolation of a whole box at parameter `u` (`0` -> a, `1` -> b). */
function lerpBox(a: NormalizedBox, b: NormalizedBox, u: number): NormalizedBox {
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    w: a.w + (b.w - a.w) * u,
    h: a.h + (b.h - a.h) * u,
  };
}

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`ball tracking: ${what} must be a finite number (got ${value})`);
  }
}

/**
 * Fails loud on malformed input (the repo convention — media and model
 * output are untrusted, architecture-lock §13): non-empty/unique frame ids,
 * non-negative finite presentation times in STRICTLY ASCENDING order (the
 * caller passes presentation-ordered frames; decode-order emission with
 * reordering is normalized upstream), integer decode orders, and
 * contract-shaped detections (finite box fields in [0, 1], confidence in
 * [0, 1], non-empty labels).
 */
function validateFrames(frames: readonly BallObservationFrame[]): void {
  const seenFrameIds = new Set<string>();
  let previousMs: number | undefined;
  for (const frame of frames) {
    if (typeof frame.frameId !== "string" || frame.frameId.length < 1) {
      throw new RangeError("ball tracking: every frame needs a non-empty frameId");
    }
    if (seenFrameIds.has(frame.frameId)) {
      throw new RangeError(`ball tracking: duplicate frameId "${frame.frameId}"`);
    }
    seenFrameIds.add(frame.frameId);
    assertFinite(frame.presentationMs, "presentationMs");
    if (frame.presentationMs < 0) {
      throw new RangeError(
        `ball tracking: presentationMs must be >= 0 (got ${frame.presentationMs})`,
      );
    }
    if (previousMs !== undefined && frame.presentationMs <= previousMs) {
      throw new RangeError(
        `ball tracking: frames must be strictly ascending in presentationMs ` +
          `(frame "${frame.frameId}" at ${frame.presentationMs} follows ${previousMs})`,
      );
    }
    previousMs = frame.presentationMs;
    if (!Number.isInteger(frame.decodeOrder) || frame.decodeOrder < 0) {
      throw new RangeError(
        `ball tracking: decodeOrder must be an integer >= 0 (got ${frame.decodeOrder})`,
      );
    }
    for (const detection of frame.detections) {
      if (typeof detection.label !== "string" || detection.label.length < 1) {
        throw new RangeError("ball tracking: every detection needs a non-empty label");
      }
      assertFinite(detection.confidence, "detection confidence");
      if (detection.confidence < 0 || detection.confidence > 1) {
        throw new RangeError(
          `ball tracking: detection confidence must be in [0, 1] (got ${detection.confidence})`,
        );
      }
      for (const field of [detection.box.x, detection.box.y, detection.box.w, detection.box.h]) {
        assertFinite(field, "detection box field");
        if (field < 0 || field > 1) {
          throw new RangeError(
            `ball tracking: detection box fields must be in [0, 1] (got ${field})`,
          );
        }
      }
    }
  }
}

/**
 * The deterministic greedy nearest-box {@link BallTrackerAdapter}.
 *
 * `track` consumes presentation-ordered frames and returns tracks per the
 * module algorithm docs. Multi-detection frames are resolved greedily
 * (nearest unclaimed candidate); the scan is strictly forward. Pure: the
 * same frames always produce a deep-equal track list.
 */
export class NearestBoxBallTracker implements BallTrackerAdapter {
  readonly trackerId: string;
  private readonly maxStep: number;
  private readonly maxGapFrames: number;

  constructor(options: NearestBoxTrackerOptions = {}) {
    const trackerId = options.trackerId ?? DEFAULT_TRACKER_ID;
    const maxStep = options.maxStep ?? DEFAULT_MAX_STEP;
    const maxGapFrames = options.maxGapFrames ?? DEFAULT_MAX_GAP_FRAMES;
    if (typeof trackerId !== "string" || trackerId.length < 1) {
      throw new RangeError("ball tracking: trackerId must be a non-empty string");
    }
    assertFinite(maxStep, "maxStep");
    if (maxStep <= 0) {
      throw new RangeError(`ball tracking: maxStep must be > 0 (got ${maxStep})`);
    }
    if (!Number.isInteger(maxGapFrames) || maxGapFrames < 0) {
      throw new RangeError(
        `ball tracking: maxGapFrames must be an integer >= 0 (got ${maxGapFrames})`,
      );
    }
    this.trackerId = trackerId;
    this.maxStep = maxStep;
    this.maxGapFrames = maxGapFrames;
  }

  track(frames: readonly BallObservationFrame[]): BallTrack[] {
    validateFrames(frames);

    // Claimed detections, keyed `<frameIndex>:<detectionIndex>`.
    const claimed = new Set<string>();
    const claim = (frameIndex: number, detectionIndex: number): void => {
      claimed.add(`${frameIndex}:${detectionIndex}`);
    };
    const isClaimed = (frameIndex: number, detectionIndex: number): boolean =>
      claimed.has(`${frameIndex}:${detectionIndex}`);

    const tracks: BallTrack[] = [];
    let scanFrom = 0; // forward-only cursor: where the next track may seed
    let seq = 0;

    // Seed scan: first frame >= scanFrom with an unclaimed detection.
    const findSeed = (from: number): number => {
      for (let index = from; index < frames.length; index += 1) {
        const frame = frames[index];
        if (frame === undefined) continue;
        for (
          let detectionIndex = 0;
          detectionIndex < frame.detections.length;
          detectionIndex += 1
        ) {
          if (!isClaimed(index, detectionIndex)) return index;
        }
      }
      return -1;
    };

    let seedIndex = findSeed(scanFrom);
    while (seedIndex >= 0) {
      seq += 1;
      const { track, resumeFrom } = this.growTrack(frames, isClaimed, claim, seedIndex, seq);
      tracks.push(track);
      scanFrom = resumeFrom;
      seedIndex = findSeed(scanFrom);
    }

    return tracks;
  }

  /**
   * Grows one track from the unclaimed seed detection in frame
   * `seedIndex` (guaranteed to exist — the caller found it via findSeed) and
   * returns where the forward scan resumes afterwards.
   */
  private growTrack(
    frames: readonly BallObservationFrame[],
    isClaimed: (frameIndex: number, detectionIndex: number) => boolean,
    claim: (frameIndex: number, detectionIndex: number) => void,
    seedIndex: number,
    seq: number,
  ): { track: BallTrack; resumeFrom: number } {
    const seedFrame = frames[seedIndex];
    if (seedFrame === undefined) {
      throw new RangeError(`ball tracking: seed frame index ${seedIndex} out of range`);
    }
    let seedDetectionIndex = -1;
    let seedDetection: DetectedBox | undefined;
    for (const [detectionIndex, detection] of seedFrame.detections.entries()) {
      if (!isClaimed(seedIndex, detectionIndex)) {
        seedDetectionIndex = detectionIndex;
        seedDetection = detection;
        break;
      }
    }
    if (seedDetection === undefined || seedDetectionIndex < 0) {
      throw new RangeError(`ball tracking: no unclaimed detection in seed frame ${seedIndex}`);
    }

    const points: BallTrackPoint[] = [
      {
        frameId: seedFrame.frameId,
        presentationMs: seedFrame.presentationMs,
        box: seedDetection.box,
        source: "detected",
        confidence: seedDetection.confidence,
      },
    ];
    const occlusionGaps: BallOcclusionGap[] = [];
    claim(seedIndex, seedDetectionIndex);

    // Last observed anchor: index, box, and the confidence the decay
    // discounts from.
    let anchorIndex = seedIndex;
    let anchorBox = seedDetection.box;
    let anchorConfidence = seedDetection.confidence;

    for (let j = seedIndex + 1; j < frames.length; j += 1) {
      const frame = frames[j];
      if (frame === undefined) continue;

      // Best unclaimed candidate: minimal center displacement from the
      // anchor, ties broken by detection array order.
      let bestIndex = -1;
      let bestDisplacement = Number.POSITIVE_INFINITY;
      for (const [detectionIndex, detection] of frame.detections.entries()) {
        if (isClaimed(j, detectionIndex)) continue;
        const displacement = centerDisplacement(anchorBox, detection.box);
        if (displacement < bestDisplacement) {
          bestIndex = detectionIndex;
          bestDisplacement = displacement;
        }
      }

      if (bestIndex >= 0) {
        const gapFrames = j - anchorIndex - 1;
        if (gapFrames > this.maxGapFrames) {
          // CLOSE (algorithm step 4): the re-observation arrived too late.
          // The detection is rejected (not claimed, not re-seeded from).
          occlusionGaps.push({
            fromMs: frames[anchorIndex + 1]?.presentationMs ?? frame.presentationMs,
            toMs: frame.presentationMs,
            bridged: false,
          });
          return {
            track: {
              trackId: `bt-${seedFrame.decodeOrder}-${seq}`,
              points,
              occlusionGaps,
            },
            resumeFrom: j + 1,
          };
        }

        const gate = this.maxStep * (j - anchorIndex);
        if (bestDisplacement <= gate) {
          // ASSOCIATE (algorithm step 2/3); bridge the gap when present.
          const bestDetection = frame.detections[bestIndex];
          if (bestDetection === undefined) {
            throw new RangeError(`ball tracking: candidate ${bestIndex} missing in frame ${j}`);
          }
          if (gapFrames >= 1) {
            for (let k = anchorIndex + 1; k < j; k += 1) {
              const gapFrame = frames[k];
              if (gapFrame === undefined) continue;
              const u = (k - anchorIndex) / (j - anchorIndex);
              const gapElapsed = k - anchorIndex;
              points.push({
                frameId: gapFrame.frameId,
                presentationMs: gapFrame.presentationMs,
                box: lerpBox(anchorBox, bestDetection.box, u),
                source: "interpolated",
                confidence: anchorConfidence * Math.pow(0.5, Math.ceil(gapElapsed / 4)),
              });
            }
            occlusionGaps.push({
              fromMs: frames[anchorIndex + 1]?.presentationMs ?? frame.presentationMs,
              toMs: frames[j - 1]?.presentationMs ?? frame.presentationMs,
              bridged: true,
            });
          }
          points.push({
            frameId: frame.frameId,
            presentationMs: frame.presentationMs,
            box: bestDetection.box,
            source: "detected",
            confidence: bestDetection.confidence,
          });
          claim(j, bestIndex);
          anchorIndex = j;
          anchorBox = bestDetection.box;
          anchorConfidence = bestDetection.confidence;
          continue;
        }
        // Gate failure: the frame's detection stays unclaimed (clutter for
        // this pass) and the gap continues — fall through.
      }
      // No association this frame: the gap continues; the track stays OPEN
      // (no mid-gap close — the gap's length is decided at re-observation
      // or end of input, per algorithm steps 3/4).
    }

    // END OF INPUT (algorithm step 5): the track ends on its last observed
    // point. A still-open trailing gap is recorded unbridged — never
    // extrapolated across.
    const lastFrame = frames[frames.length - 1];
    if (anchorIndex < frames.length - 1 && lastFrame !== undefined) {
      occlusionGaps.push({
        fromMs: frames[anchorIndex + 1]?.presentationMs ?? lastFrame.presentationMs,
        toMs: lastFrame.presentationMs,
        bridged: false,
      });
    }

    return {
      track: {
        trackId: `bt-${seedFrame.decodeOrder}-${seq}`,
        points,
        occlusionGaps,
      },
      // Forward-only scan: unclaimed detections behind the consumed span are
      // clutter (algorithm step 6) — no seeds resume before the input end.
      resumeFrom: frames.length,
    };
  }
}
