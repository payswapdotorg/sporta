/**
 * Provider-neutral ball-tracking seam (W202).
 *
 * IMAGE-SPACE tracking only: continuity of the ball object across frames with
 * occlusion handling. The seam consumes per-frame DETECTION output (W201's
 * `DetectedBox`) and emits honest track structure; it never re-detects.
 *
 * Scope boundary (architecture-lock §4 + §6, and the W202 work item):
 *
 * - the tracker does NOT emit `TrackPayload` or entity ids into the SWM —
 *   ball STATE in pitch coordinates (position/velocity/confidence feed) is
 *   W205's state estimator, which consumes this package's output;
 * - INTERPOLATED positions (occlusion bridging) carry explicitly DISCOUNTED
 *   confidence rather than invented certainty: they live in the track
 *   structure, never in emitted observations (`observe.ts` emits detected
 *   points only);
 * - label matching is the CALLER's filter: the seam accepts any detections
 *   (typical usage filters to label "ball" upstream, at the detector output).
 *
 * Frames are shaped after the W102 `NormalizedVideoFrame` fields a tracker
 * needs (`frameId`/`presentationMs`/`decodeOrder` — the same convention as
 * W201's `DetectorFrameInput`); the pipeline maps decoded frames onto this
 * input at the boundary.
 */
import type { DetectedBox, NormalizedBox } from "@sporta/perception-detection";

/**
 * One frame offered to a ball tracker: the frame's timeline position plus the
 * frame's candidate ball detections (already label-filtered upstream; may be
 * empty — an empty detection list means "not detected in this frame", e.g.
 * occlusion).
 */
export interface BallObservationFrame {
  /** Frame id (`f-<streamIndex>-<decodeOrder>` in the decoding convention). */
  readonly frameId: string;
  /** Presentation position on the normalized media timeline (milliseconds). */
  readonly presentationMs: number;
  /** Decode-order position within the decode call, starting at 0. */
  readonly decodeOrder: number;
  /** Candidate ball detections this frame (may be empty = occluded). */
  readonly detections: readonly DetectedBox[];
}

/**
 * One point of a ball track: where the tracker believes the ball is in one
 * frame.
 *
 * - `source: "detected"`: the point IS an observed detection — `box` is the
 *   detection's box and `confidence` is the detection's confidence verbatim
 *   (architecture-lock §6: no silent confidence collapse);
 * - `source: "interpolated"`: the point spans an occlusion gap — `box` is the
 *   linear interpolation between the gap's observed anchor boxes and
 *   `confidence` is the anchor confidence DISCOUNTED exponentially (see
 *   `nearest-box.ts`; explicit, decaying uncertainty — architecture-lock §4).
 */
export interface BallTrackPoint {
  /** Frame id this point belongs to. */
  readonly frameId: string;
  /** Presentation position of the frame (milliseconds). */
  readonly presentationMs: number;
  /** The point's box: observed when detected, interpolated when bridging. */
  readonly box?: NormalizedBox;
  /** Whether this point was observed or interpolated across an occlusion. */
  readonly source: "detected" | "interpolated";
  /** Detected: detection confidence. Interpolated: discounted (see docs). */
  readonly confidence: number;
}

/**
 * One recorded occlusion gap inside a track: the timeline window the track
 * was blind, and whether the gap was bridged by interpolation.
 *
 * - bridged `true`: the window between two observed anchor points; fromMs is
 *   the first interpolated frame's presentationMs, toMs the last one's;
 * - bridged `false`: the gap was never resolved — fromMs is the first
 *   non-associated frame's presentationMs, toMs the presentationMs of the
 *   frame where the track gave up (the too-late re-observation, or the last
 *   input frame when the gap ran to the end of input). A `toMs` on an
 *   unbridged gap is a bookkeeping endpoint, never a re-observation.
 */
export interface BallOcclusionGap {
  readonly fromMs: number;
  readonly toMs: number;
  readonly bridged: boolean;
}

/**
 * A ball track: the ball's image-space continuity across a span of frames.
 * `points` are ordered by `presentationMs`; tracks always START and END on
 * OBSERVED boxes (never extrapolated past the first/last detection — no
 * invented certainty at the edges).
 */
export interface BallTrack {
  /** Track id: `bt-<seed frame decodeOrder>-<seq>` (seq starts at 1). */
  readonly trackId: string;
  /** Track points ordered by presentationMs. */
  readonly points: BallTrackPoint[];
  /** Occlusion gaps encountered inside the track's span. */
  readonly occlusionGaps: readonly BallOcclusionGap[];
}

/**
 * The provider-neutral tracker seam (architecture-lock §9, vendor
 * neutrality): tracking algorithms — the deterministic nearest-box tracker
 * shipped here, or a future learned/real-time backend behind the same
 * interface — consume detection frames and produce tracks. `trackerId`
 * doubles as the `componentId` stamped on observations emitted from this
 * adapter's output, so every record names the producing component.
 */
export interface BallTrackerAdapter {
  /** Component id used on observations emitted from this adapter's output. */
  readonly trackerId: string;
  /** Tracks the ball across the given frames (must be presentation-ordered). */
  track(frames: readonly BallObservationFrame[]): BallTrack[];
}
