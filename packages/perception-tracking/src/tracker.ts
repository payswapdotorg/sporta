/**
 * Greedy-IoU association tracker (W204).
 *
 * Consumes per-frame detections (W201 output: `DetectedBox` — box + label +
 * confidence, no identity) and assigns persistent, session-scoped track ids.
 * This is the deterministic baseline tracker: real ML trackers (deep
 * association, appearance embeddings) arrive with the GPU worker protocol
 * (W303); the association seam they will replace is exactly the one
 * implemented here (architecture-lock §9, vendor neutrality).
 *
 * Determinism contract (architecture-lock §6 — temporal consistency without
 * invented certainty): `assign` is a PURE function of
 * `(tracker state, frame, detections, options)`. No RNG, no clock, no
 * `Date.now`, no environment reads. Two trackers constructed with the same
 * options and fed identical input frames produce IDENTICAL track ids
 * (documented scheme below), so benchmark scenarios are reproducible
 * bit-for-bit.
 *
 * Identity scope: track ids are opaque, session-scoped `EntityId`s in the
 * `t<seq>` scheme — `seq` is a per-tracker counter starting at 1 (`t1`, `t2`,
 * …, matching `[A-Za-z0-9_-]{1,64}`). The ids carry NO certainty claim: the
 * tracker's association is a greedy geometric hypothesis, and its confidence
 * output is the detection's confidence passed through VERBATIM
 * (architecture-lock §6: no silent confidence collapse).
 *
 * Scope boundary (documented): a camera cut is a HARD boundary — with the
 * default `onSceneCut: "close-all"` every active track closes at a cut frame
 * and association across cuts is not attempted. Re-identification after cuts
 * (or across occlusions beyond `maxGap`) is a downstream concern (embeddings,
 * W303; fusion, W206), not the tracker's — the identity-continuity benchmark
 * in `benchmark.ts` exists precisely to MEASURE the fragmentation this
 * deliberate conservatism produces.
 */
import type { EntityId } from "@sporta/contracts";
import { iou } from "@sporta/perception-detection";
import type { DetectedBox, NormalizedBox } from "@sporta/perception-detection";

/**
 * One tracked object in one frame: the detection's box/label plus the
 * persistent track id the association assigned to it.
 *
 * `confidence` is the detection's confidence passed through verbatim — the
 * tracker never averages, floors, or otherwise collapses it.
 */
export interface TrackedBox {
  readonly box: NormalizedBox;
  readonly label: string;
  readonly confidence: number;
  readonly trackId: EntityId;
}

/**
 * One frame offered to the tracker: the identity-relevant subset of the W201
 * `DetectorFrameInput` (id + timeline position + decode order). Pixel
 * content is not needed — association is geometric over the W201 detections.
 *
 * `sceneCut` marks a hard scene boundary (camera cut) as flagged upstream
 * (decoding/ingestion); see {@link GreedyIouTrackerOptions.onSceneCut}.
 */
export interface TrackerFrameInput {
  /** Frame id (`f-<streamIndex>-<decodeOrder>` in the decoding convention). */
  readonly frameId: string;
  /** Presentation position on the media timeline (milliseconds). */
  readonly presentationMs: number;
  /** Decode-order position within the decode call, starting at 0. */
  readonly decodeOrder: number;
  /** Hard scene boundary marker (camera cut) for this frame, if flagged. */
  readonly sceneCut?: boolean;
}

/** How the tracker treats a frame marked `sceneCut`. */
export type SceneCutPolicy = "close-all" | "ignore";

/**
 * Tracker options. All fields are optional; documented defaults apply.
 *
 * - `iouThreshold` (default 0.5): association gate — a detection can extend a
 *   track only if `iou(track.lastBox, detection.box) >= threshold` (an IoU
 *   exactly equal to the threshold associates — inclusive, same convention
 *   as W201's `matchDetections`);
 * - `maxGap` (default 0): missed-frames tolerance — an unmatched track's gap
 *   increments per frame with no matching detection, and the track CLOSES
 *   (terminal state) once `gap > maxGap`. `maxGap: 0` closes a track after a
 *   single missed frame; `maxGap: 2` survives two consecutive misses;
 * - `onSceneCut` (default "close-all"): `"close-all"` closes every active
 *   track at a `sceneCut` frame BEFORE association (ids after the cut are
 *   fresh); `"ignore"` treats the marker as informational and still
 *   associates across it.
 */
export interface GreedyIouTrackerOptions {
  /** Association gate; IoU exactly equal to the threshold associates. */
  readonly iouThreshold?: number;
  /** Missed-frames tolerance before a track closes (integer >= 0). */
  readonly maxGap?: number;
  /** Scene-cut policy; see the interface docs. */
  readonly onSceneCut?: SceneCutPolicy;
}

/** Internal mutable state of one active track. */
interface ActiveTrack {
  readonly trackId: EntityId;
  readonly label: string;
  /** Last matched detection's box (the association anchor). */
  lastBox: NormalizedBox;
  /** Decode order of the frame the track was last matched on. */
  lastSeenDecodeOrder: number;
  /** Consecutive frames with no matching detection since the last match. */
  gap: number;
  /** Monotonic creation sequence; deterministic tie-break for association. */
  readonly creationOrder: number;
}

const ENTITY_ID_MAX_LENGTH = 64;

function validateOptions(options: GreedyIouTrackerOptions): void {
  // Fail loud at construction (the repo convention) rather than associating
  // garbage later: an out-of-range gate or a negative/ fractional gap would
  // silently change association semantics mid-stream.
  const threshold = options.iouThreshold ?? 0.5;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError(
      `GreedyIouTracker options: iouThreshold must be in [0, 1] (got ${threshold})`,
    );
  }
  const maxGap = options.maxGap ?? 0;
  if (!Number.isInteger(maxGap) || maxGap < 0) {
    throw new RangeError(
      `GreedyIouTracker options: maxGap must be an integer >= 0 (got ${maxGap})`,
    );
  }
  const policy = options.onSceneCut ?? "close-all";
  if (policy !== "close-all" && policy !== "ignore") {
    throw new RangeError(
      `GreedyIouTracker options: onSceneCut must be "close-all" or "ignore" (got ${policy})`,
    );
  }
}

function validateTrackerId(trackerId: string): void {
  if (
    typeof trackerId !== "string" ||
    trackerId.length < 1 ||
    trackerId.length > ENTITY_ID_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(trackerId)
  ) {
    throw new RangeError(
      `GreedyIouTracker: trackerId must be 1-64 characters of [A-Za-z0-9_-] (got "${trackerId}")`,
    );
  }
}

/**
 * The deterministic greedy-IoU tracker.
 *
 * Construct with `(options, trackerId)`; call {@link assign} once per frame,
 * in decode order (the tracker is a pure state machine over the call
 * sequence). `trackerId` identifies the tracker instance — conventionally
 * used as the `componentId` when the caller emits observations from this
 * tracker's output (`observe.ts` takes it explicitly; it is not auto-wired),
 * and it does NOT prefix track ids: track ids are exactly `t<seq>`.
 *
 * Association per frame (documented algorithm — the greedy loop is
 * implemented HERE rather than reusing W201's `matchDetections`, because
 * `matchDetections` matches ground-truth-vs-predictions with
 * gt-index/prediction-index tie-breaks, while track association must tie-
 * break on detection array order and TRACK CREATION order, and must gate on
 * live track state (label, lastBox, gap). The IoU MATH is reused verbatim
 * from W201's exported `iou`):
 *
 * 1. if the frame is a `sceneCut` and the policy is `"close-all"`: every
 *    active track CLOSES first (terminal — never re-opens), then association
 *    proceeds against the now-empty active set, so every detection on the
 *    cut frame opens a fresh track;
 * 2. candidate pairs are (detection, active track) with the SAME label and
 *    `iou(track.lastBox, detection.box) >= iouThreshold`;
 * 3. candidates are sorted best-IoU-first with the DETERMINISTIC tie-break
 *    (IoU descending, then detection array order ascending, then track
 *    creation order ascending) and consumed greedily: a pair matches only if
 *    BOTH its detection and its track are still unmatched — each detection
 *    extends at most one track, each track absorbs at most one detection per
 *    frame (two detections can never join one track);
 * 4. a matched detection extends its track: `lastBox` updated to the
 *    detection's box, `gap` reset to 0, `lastSeenDecodeOrder` updated; the
 *    output `TrackedBox.confidence` is the detection's confidence passed
 *    through verbatim;
 * 5. an unmatched detection opens a NEW track with id `t<seq>` (`seq` starts
 *    at 1 and increments per tracker instance — never reused, even after a
 *    track closes);
 * 6. an unmatched ACTIVE track's `gap` increments; once `gap > maxGap` the
 *    track CLOSES (terminal state — a later matching detection opens a NEW
 *    id, which the continuity benchmark exposes as fragmentation).
 *
 * The return array is in the INPUT DETECTION ORDER (one `TrackedBox` per
 * input detection — every detection is tracked: matched ones extend tracks,
 * unmatched ones open new ones). Boxes are shallow-copied so callers never
 * alias tracker-internal state.
 */
export class GreedyIouTracker {
  /** Opaque instance id (see the class docs — does not prefix track ids). */
  readonly trackerId: string;
  private readonly iouThreshold: number;
  private readonly maxGap: number;
  private readonly onSceneCut: SceneCutPolicy;
  private active: ActiveTrack[] = [];
  /** Next track sequence number (ids so far: t1..t<seq - 1>). */
  private seq = 1;

  constructor(options: GreedyIouTrackerOptions, trackerId: string) {
    validateOptions(options);
    validateTrackerId(trackerId);
    this.iouThreshold = options.iouThreshold ?? 0.5;
    this.maxGap = options.maxGap ?? 0;
    this.onSceneCut = options.onSceneCut ?? "close-all";
    this.trackerId = trackerId;
  }

  /**
   * Assigns track ids to one frame's detections and advances the tracker
   * state. Pure with respect to external inputs (no clock/RNG); mutating
   * only the tracker's own state. See the class docs for the algorithm.
   */
  assign(frame: TrackerFrameInput, detections: readonly DetectedBox[]): TrackedBox[] {
    // 1. Scene cut: a hard boundary. All active tracks close BEFORE
    //    association; association then runs against the empty active set.
    if (frame.sceneCut === true && this.onSceneCut === "close-all") {
      this.active = [];
    }

    // 2. Candidate pairs: same label, IoU >= threshold (inclusive).
    interface Candidate {
      readonly detectionIndex: number;
      readonly trackIndex: number;
      readonly iou: number;
    }
    const candidates: Candidate[] = [];
    for (const [detectionIndex, detection] of detections.entries()) {
      for (const [trackIndex, track] of this.active.entries()) {
        if (track.label !== detection.label) continue;
        const overlap = iou(track.lastBox, detection.box);
        if (overlap >= this.iouThreshold) {
          candidates.push({ detectionIndex, trackIndex, iou: overlap });
        }
      }
    }

    // 3. Best-IoU-first, deterministic tie-break: IoU desc, detection array
    //    order asc, track creation order asc.
    candidates.sort(
      (a, b) =>
        b.iou - a.iou ||
        a.detectionIndex - b.detectionIndex ||
        this.active[a.trackIndex]!.creationOrder - this.active[b.trackIndex]!.creationOrder,
    );

    // 4. Greedy one-to-one consumption: detection -> matched active-track
    //    index (and which active tracks got a detection this frame).
    const detectionToTrack = new Map<number, number>();
    const trackMatched = new Array<boolean>(this.active.length).fill(false);
    for (const candidate of candidates) {
      if (detectionToTrack.has(candidate.detectionIndex) || trackMatched[candidate.trackIndex]) {
        continue;
      }
      detectionToTrack.set(candidate.detectionIndex, candidate.trackIndex);
      trackMatched[candidate.trackIndex] = true;
    }

    // 5. Extend matched tracks; open new tracks for unmatched detections.
    //    Output is in INPUT DETECTION ORDER; boxes are shallow-copied.
    //    New tracks are collected separately and appended AFTER the gap
    //    accounting below (they were matched by construction — the frame's
    //    detection that opened them — so they must not be aged this frame).
    const newTracks: ActiveTrack[] = [];
    const output: TrackedBox[] = detections.map((detection, detectionIndex) => {
      const trackIndex = detectionToTrack.get(detectionIndex);
      if (trackIndex === undefined) {
        // Unmatched detection -> fresh track id t<seq> (ids are never
        // reissued, so a closed track's id can never come back).
        const trackId = `t${this.seq}` as EntityId;
        const creationOrder = this.seq;
        this.seq += 1;
        newTracks.push({
          trackId,
          label: detection.label,
          lastBox: { ...detection.box },
          lastSeenDecodeOrder: frame.decodeOrder,
          gap: 0,
          creationOrder,
        });
        return {
          box: { ...detection.box },
          label: detection.label,
          confidence: detection.confidence,
          trackId,
        };
      }
      const track = this.active[trackIndex]!;
      track.lastBox = { ...detection.box };
      track.lastSeenDecodeOrder = frame.decodeOrder;
      track.gap = 0;
      return {
        box: { ...detection.box },
        label: detection.label,
        confidence: detection.confidence,
        trackId: track.trackId,
      };
    });

    // 6. Age unmatched active tracks; close those past the gap tolerance.
    //    Closed tracks are removed from the active set (a later matching
    //    detection opens a NEW id — the fragmentation the benchmark
    //    measures); closed ids are never reissued. Only tracks that were
    //    active BEFORE this frame's association are aged.
    this.active = this.active
      .filter((track, index) => {
        if (trackMatched[index]) return true;
        track.gap += 1;
        return track.gap <= this.maxGap;
      })
      .concat(newTracks);

    return output;
  }
}
