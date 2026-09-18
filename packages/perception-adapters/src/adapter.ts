/**
 * Perception adapter family interfaces (R201) — the stable per-family seams
 * of the perception adapter plane, built on the frozen Wave-0
 * `PerceptionAdapterDescriptor` binding (schema 1.1).
 *
 * DESIGN LAW (one interface per family, wrapping — never forking — the
 * delivered W201/W202/W203/W204 seams):
 *
 * - the INPUT/OUTPUT data types are RE-EXPORTED from the seam packages that
 *   own them (`@sporta/perception-detection`'s `DetectorFrameInput` /
 *   `DetectedBox`, `@sporta/perception-tracking`'s `TrackedBox`,
 *   `@sporta/ball-tracking`'s `BallTrack`, `@sporta/field-mapping`'s
 *   corner/homography types) — the adapter plane consumes, never
 *   re-declares, so the two can never drift;
 * - every implementation exposes `descriptor: PerceptionAdapterDescriptor`
 *   conforming to the frozen `PERCEPTION_TASK_BINDINGS` table, validated
 *   FAIL-CLOSED at construction (`assertDescriptorBinding`);
 * - at least two MATERIALLY DIFFERENT implementations exist per family
 *   (R201's acceptance criterion) and they conform WITHOUT any
 *   SWM/observation-contract change — that is the whole point of the seam;
 * - the runtime technology REGISTRY is another lane's Wave-1 deliverable:
 *   this package proves BINDING-READINESS via `registry-bindings.ts`
 *   (TechnologyCandidate-shaped records) and the Tech Lead wires the
 *   registry at integration.
 */
import type { EntityId, FieldMappingPayload, PitchPoint } from "@sporta/contracts";
import type { BallTrack } from "@sporta/ball-tracking";
import type { DetectedBox, DetectorFrameInput, NormalizedBox } from "@sporta/perception-detection";
import type { TrackedBox } from "@sporta/perception-tracking";
import type { FieldCornerSet, Homography, Point2D } from "@sporta/field-mapping";
import type {
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import type { FailureClassRecord } from "@sporta/contracts";

// Re-exports (consume-only; the seams own the shapes).
export type { DetectedBox, DetectorFrameInput, NormalizedBox };
export type { TrackedBox };
export type { BallTrack };
export type { FieldCornerSet, Homography, PitchPoint, Point2D };

/**
 * The evaluation metadata every perception-adapter candidate carries
 * alongside its family method — the honest records the (future, another
 * lane's) Technology Registry lifts into a full `TechnologyProfile`:
 *
 * - `license` — the per-component license record (code/model/dataset/assets
 *   reviewed SEPARATELY; unreviewed commercial-use verdicts recorded as
 *   absent, never fabricated);
 * - `failureClasses` — the candidate's documented, named failure semantics
 *   (what a deliberate refusal looks like, and whether it is retryable);
 * - `resourceRequirements` — what a scheduler must respect to run it.
 */
export interface TechnologyBoundedAdapter {
  /** Frozen binding descriptor (validated fail-closed at construction). */
  readonly descriptor: PerceptionAdapterDescriptor;
  /** Honest per-component license record for THIS candidate. */
  readonly license: TechnologyLicenseRecord;
  /** Documented failure classes of THIS candidate. */
  readonly failureClasses: readonly FailureClassRecord[];
  /** Deployment resource requirements of THIS candidate. */
  readonly resourceRequirements: ResourceRequirements;
}

/**
 * One detection-annotated frame of a detection sequence: the full normalized
 * video frame (pixels available to pixel-space candidates) plus the frame's
 * detections (the `contracts/observation.detection-sequence@1` evidence
 * stream). Detection-driven candidates consume `detections`; pixel-space
 * candidates may consume `frame.bytes` instead — each candidate documents
 * which evidence it uses. `sceneCut` marks a hard scene boundary (camera
 * cut) as flagged upstream — the same marker the W204 tracking seam accepts.
 */
export interface DetectionSequenceFrame {
  /** The normalized video frame (W102 fields; rgb24 pixels). */
  readonly frame: DetectorFrameInput;
  /** The frame's detections (label-filtered upstream where applicable). */
  readonly detections: readonly DetectedBox[];
  /** Hard scene boundary marker (camera cut) for this frame, if flagged. */
  readonly sceneCut?: boolean;
}

// ---------------------------------------------------------------------------
// R202 family: detection (player / ball)
// ---------------------------------------------------------------------------

/**
 * Player detection (family task `perception.player-detection`): per-frame
 * `DetectedBox` output, exactly the W201 `DetectorAdapter` method shape
 * (sync-or-async return union) with the R201 descriptor bolted on. Identity
 * and tracking are downstream families — a detection never carries an id.
 */
export interface PlayerDetectionAdapter extends TechnologyBoundedAdapter {
  /** Component id used on observations emitted from this adapter's output. */
  readonly detectorId: string;
  /** Runs detection on one frame; one {@link DetectedBox} per found object. */
  detect(frame: DetectorFrameInput): Promise<readonly DetectedBox[]> | readonly DetectedBox[];
}

/**
 * Ball detection (family task `perception.ball-detection`): the same method
 * shape as {@link PlayerDetectionAdapter}, but every emitted box MUST carry
 * the ball class label — implementations filter/relabel their raw output to
 * `BALL_DETECTION_LABEL` before returning (a ball detector that also emits
 * players would violate the family's output semantics).
 */
export interface BallDetectionAdapter extends TechnologyBoundedAdapter {
  /** Component id used on observations emitted from this adapter's output. */
  readonly detectorId: string;
  /** Runs ball detection on one frame; every box carries the ball label. */
  detect(frame: DetectorFrameInput): Promise<readonly DetectedBox[]> | readonly DetectedBox[];
}

/** The ball class label every {@link BallDetectionAdapter} output carries. */
export const BALL_DETECTION_LABEL = "ball";

// ---------------------------------------------------------------------------
// R203 family: player tracking
// ---------------------------------------------------------------------------

/** The typed identity-continuity report of one player-tracking run. */
export interface PlayerTrackingResult {
  /** Tracked boxes per input frame, in input frame order. */
  readonly perFrame: readonly (readonly TrackedBox[])[];
  /**
   * APPARENT identity switches counted by the adapter's documented
   * continuity criterion (see {@link PLAYER_TRACKING_SWITCH_IOU}): adjacent
   * frame pairs whose most-overlapping same-label detections carry different
   * track ids. This is an honest adapter-level PROXY — without ground truth
   * no tracker can count true switches; the benchmark's ground-truth switch
   * count (from synthetic fixtures) is the evaluative metric.
   */
  readonly identitySwitches: number;
}

/**
 * Minimum same-label IoU between a frame-k detection and the frame-(k+1)
 * detection it most overlaps for the pair to count toward the APPARENT
 * identity-switch heuristic (see {@link PlayerTrackingResult.identitySwitches}).
 */
export const PLAYER_TRACKING_SWITCH_IOU = 0.5;

/**
 * Player tracking (family task `perception.player-tracking`): consumes a
 * detection sequence (one {@link DetectionSequenceFrame} per frame, decode
 * order) and assigns persistent, session-scoped track ids — the W204
 * `TrackedBox` output shape, plus a typed apparent identity-switch count.
 */
export interface PlayerTrackingAdapter extends TechnologyBoundedAdapter {
  /** Component id used on observations emitted from this adapter's output. */
  readonly trackerId: string;
  /** Tracks players across the detection sequence (decode-ordered frames). */
  track(sequence: readonly DetectionSequenceFrame[]): PlayerTrackingResult;
}

// ---------------------------------------------------------------------------
// R204 family: ball tracking
// ---------------------------------------------------------------------------

/**
 * Ball tracking (family task `perception.ball-tracking`): consumes a
 * detection-annotated frame sequence and emits image-space ball continuity
 * in the W202 `BallTrack` shape (detected vs interpolated points, occlusion
 * gaps, never-extrapolated edges). Detection-driven candidates consume the
 * per-frame `detections`; pixel-space candidates derive their own ball
 * evidence from `frame.bytes` — both must implement the honest gap/occlusion
 * semantics documented by W202 (never extrapolate across unbridged gaps,
 * carry confidence).
 */
export interface BallTrackingAdapter extends TechnologyBoundedAdapter {
  /** Component id used on observations emitted from this adapter's output. */
  readonly trackerId: string;
  /** Tracks the ball across the given frames (presentation-ordered). */
  track(frames: readonly DetectionSequenceFrame[]): BallTrack[];
}

// ---------------------------------------------------------------------------
// R205 family: pitch calibration
// ---------------------------------------------------------------------------

/** One image <-> pitch correspondence used by calibration candidates. */
export interface CalibrationCorrespondence {
  /** Position in normalized image coordinates (`[0, 1]` frame span). */
  readonly image: Point2D;
  /** Position in canonical pitch meters (the frozen 105 x 68 frame). */
  readonly pitch: PitchPoint;
}

/** The input record of one calibration call (see {@link PitchCalibrationAdapter}). */
export interface PitchCalibrationInput {
  /**
   * Frame sequence (presentation-ordered normalized video frames). Line-
   * based candidates detect their own correspondence evidence in these
   * pixels; correspondence-driven candidates use the frames only for
   * sequence validation and metadata.
   */
  readonly frames: readonly DetectorFrameInput[];
  /**
   * Externally-supplied corner-set evidence (the W203 `FieldCornerSet`
   * shape, canonical `"tl, tr, br, bl"` order): the "input corner
   * correspondences" the baseline homography calibrator consumes. Absent for
   * pixel-driven candidates that detect their own anchors.
   */
  readonly cornerSet?: FieldCornerSet;
}

/**
 * The output of one calibration run: a `FieldMappingPayload`-CONFORMANT
 * mapping (the frozen binding's output contract) plus the W203 artifacts
 * downstream needs — the solved homography (canonical `h[8] = 1` form) and
 * the corner set `createPitchProjector` consumes for the inBounds-flagged
 * projection semantics.
 */
export interface CalibrationResult {
  /** Contract payload (`kind: "field-mapping"`, 4 image-space pitch corners). */
  readonly mapping: FieldMappingPayload;
  /** Solved image -> pitch homography (W203 `solveHomography`, `h[8] = 1`). */
  readonly homography: Homography;
  /** The corner set in W203 shape (feeds `createPitchProjector`). */
  readonly cornerSet: FieldCornerSet;
  /** The calibrator's confidence in `[0, 1]` (honest per anchor count). */
  readonly confidence: number;
  /** How many correspondence anchors the calibration actually used. */
  readonly correspondenceCount: number;
}

/**
 * Pitch calibration (family task `perception.pitch-calibration`): consumes
 * frame sequences (plus, for correspondence-driven candidates, an external
 * corner set) and emits a `FieldMappingPayload`-conformant mapping with the
 * W203 homography + inBounds semantics. Degenerate correspondence geometry
 * is a typed refusal (W203 `DegenerateCorrespondenceError`), never a
 * silently wrong mapping.
 */
export interface PitchCalibrationAdapter extends TechnologyBoundedAdapter {
  /** Component id used on observations emitted from this adapter's output. */
  readonly calibratorId: string;
  /** Calibrates the image -> pitch mapping from one input record. */
  calibrate(input: PitchCalibrationInput): CalibrationResult;
}

// ---------------------------------------------------------------------------
// R206 family: team identity
// ---------------------------------------------------------------------------

/** The team a track was assigned to; `unknown` is a first-class honest value. */
export type TeamId = "home" | "away" | "unknown";

/** One team-assignment decision for one track. */
export interface TeamAssignment {
  /** The track the assignment was made for. */
  readonly trackId: EntityId;
  /** `home` / `away` — or `unknown` when the evidence is too weak (honest). */
  readonly teamId: TeamId;
  /** Assignment confidence in `[0, 1]`; LOW when `teamId` is `"unknown"`. */
  readonly confidence: number;
  /** The documented method id that produced the assignment (e.g. "jersey-color"). */
  readonly method: string;
}

/** One frame of the track sequence with per-frame crop access (R206 input). */
export interface TrackSequenceFrame {
  /** The normalized video frame (rgb24 pixels for crop extraction). */
  readonly frame: DetectorFrameInput;
  /** The frame's tracked boxes (the tracked players visible in this frame). */
  readonly tracked: readonly TrackedBox[];
}

/**
 * Team identity (family task `perception.team-identity`): consumes track
 * sequences with per-frame crop access and emits {@link TeamAssignment}
 * records with EXPLICIT uncertainty — `unknown` with LOW confidence is a
 * first-class honest output, never a silent guess.
 */
export interface TeamIdentityAdapter extends TechnologyBoundedAdapter {
  /** Component id used on observations emitted from this adapter's output. */
  readonly assignerId: string;
  /** Assigns teams to every track seen in the sequence. */
  assign(sequence: readonly TrackSequenceFrame[]): readonly TeamAssignment[];
}
