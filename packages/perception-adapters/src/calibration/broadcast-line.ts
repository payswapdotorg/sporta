/**
 * W303-class candidate: `BroadcastLineCalibrator` — REAL broadcast
 * perspective pitch calibration from frame PIXELS: local-contrast line
 * evidence, motion-compensated temporal aggregation, Hough lines, a
 * boundary-quad hypothesis search, and coordinate-descent refinement —
 * feeding the SAME W203 homography solver (wrap, never fork).
 *
 * WHY THIS CANDIDATE EXISTS (the R606 failure evidence, recorded in the
 * status ledger): the line-based candidate's envelope is near-axis-aligned
 * views with a bright-white (r,g,b >= 190) line predicate; real 640x360
 * broadcast frames carry pitch lines at brightness ~(130-180) on ~(90-120)
 * grass — the bright-white predicate fires on stands/scoreboards instead —
 * and real main-camera perspective smears the projection histograms. The
 * in-play R606 run therefore collapsed at the CALIBRATION stage (both
 * shipped candidates refusing or mapping nothing). This candidate is the
 * measured fix: LOCAL CONTRAST catches markings at ANY absolute brightness
 * (a 130-180 line on 90-120 grass exceeds its 13x13 neighborhood mean by
 * 40-70, exactly like a 245 line on synthetic 87 grass), and
 * motion-compensated temporal aggregation separates STATIC lines from
 * MOVING players.
 *
 * ALGORITHM (documented in full — every constant is part of the tested
 * contract; every step is pure and deterministic with a fixed scan order):
 *
 * 1. GREEN UNION: per frame, pitch-green pixels (`isPitchGreen`); the
 *    UNION over all frames (players punch holes that MOVE — the union
 *    robustly fills them); the union is dilated 3 iterations of 3x3
 *    (border-replicate edges), which fills the static white line "holes"
 *    and gives boundary-line pixels just outside the grass a green margin.
 *    Union < `minPitchFraction` (default 0.2) of the frame → typed refusal
 *    `broadcast-line.no-pitch-visible` (not enough pitch in view to
 *    calibrate honestly). An EMPTY frame sequence carries no line evidence
 *    → typed refusal `broadcast-line.insufficient-line-evidence` (mirrors
 *    the line-based candidate's empty-sequence refusal).
 * 2. MOTION ESTIMATION (the static-camera check WITH compensation): per
 *    frame, the green column-profile and row-profile (per-column /
 *    per-row green counts), smoothed with a 9-tap zero-padded box; each
 *    frame's profiles are cross-correlated against the MIDDLE (anchor)
 *    frame's over integer shifts in [-60, +60] px — the shift maximizing
 *    the dot product, first shift in ascending scan order on ties —
 *    yielding the frame's content translation (dx, dy) relative to the
 *    anchor. Any |dx| or |dy| > 40 — beyond the compensation envelope —
 *    is the typed refusal `broadcast-line.camera-motion` (panning
 *    cameras refuse honestly). [Documented constant deviation: the search
 *    window is +-60 px, not the +-30 of the original design note — a +-30
 *    search can never MEASURE a >40 px motion, which would make the >40
 *    refusal unreachable and the panning refusal untestable; +-60 covers
 *    the +-40 envelope with margin so the refusal fires on real evidence.]
 *    The pipeline passes every-25th-frame subsamples, so per-frame shifts
 *    against the anchor measure the slow wobble; integer compensation
 *    handles it.
 * 3. PER-FRAME LINE MASK (LOCAL CONTRAST — the reason this candidate sees
 *    real broadcast lines): an integral image of brightness (r+g+b) gives
 *    the local mean over a 13x13 box (radius 6, edge-clamped counts); a
 *    pixel is a LINE pixel when brightness − localMean > 14 AND it lies
 *    inside the dilated green union. The box mean ADAPTS to the local
 *    surface, so absolute brightness never matters — the documented
 *    reason the bright-white predicate fails on real broadcasts.
 * 4. MOTION-COMPENSATED TEMPORAL AGGREGATION: each frame's line mask is
 *    shifted by its measured (−dx, −dy) into anchor coordinates, dilated
 *    2 iterations of 3x3 (absorbs sub-pixel jitter), and accumulated; the
 *    STATIC mask = pixels set in >= 50% of frames. Lines are static →
 *    present in every frame; players move → excluded. Static mask < 500
 *    px → typed refusal `broadcast-line.insufficient-line-evidence`.
 * 5. HOUGH: 180 theta bins over [0, π), integer rho over [−diag, diag]
 *    (diag = ceil(hypot(width, height))); every static pixel votes for
 *    every theta. Iterative peak extraction: take the accumulator max
 *    (first in (theta, rho) scan order on ties), suppress theta ±4 bins ×
 *    rho ±12 (no cyclic theta wrap), repeat — up to 16 peaks, stopping
 *    early once the max falls below 30 votes (sub-30 peaks can never pass
 *    the vote filter). A peak becomes a DETECTED line when its votes >= 30
 *    AND its supporting pixels (static pixels within 2.5 px of the line)
 *    span >= 60 px along it (the extent filter keeps segments, kills
 *    circle/arc chords).
 * 6. HYPOTHESIS SEARCH (the solve): enumerate assignments of 4 detected
 *    lines to the 4 boundary roles — near touchline (y=0), far touchline
 *    (y=68), left goal line (x=0), right goal line (x=105). Only orderings
 *    consistent with the elevated main-camera prior survive the
 *    enumeration (the near-role line's mean supporting-pixel y > the
 *    far-role line's; the left-role line's mean x < the right-role
 *    line's) — the documented envelope cost. Intersect the two
 *    touchline-role lines with the two goal-line-role lines → 4 image
 *    corners (pixel → normalized); the quad must be finite, inside the
 *    plausible-view bounds ([−1, 2]² normalized — one frame-width of
 *    margin around the frame), strictly convex, and free of collinear
 *    triples; W203 `solveHomography` then maps [near∩left, near∩right,
 *    far∩right, far∩left] (the canonical tl, tr, br, bl corner roles)
 *    onto CANONICAL_PITCH_CORNERS. Score = the fraction of SCORED static
 *    pixels whose projection lands within 1.0 m of a model line/arc,
 *    looked up in the pitch-plane distance field (0.5 m cells over
 *    [−5, 110] × [−5, 73] to ALL canonical model lines and arcs —
 *    touchlines, goal lines, halfway, penalty fronts/tops/bottoms,
 *    goal-area fronts/tops/bottoms, the center circle, and the penalty
 *    arcs CLIPPED outside their penalty areas). HOARDINGS SUPPRESSION
 *    (hoardings are the documented dominant noise — static, bright,
 *    near-grass boards above the pitch, typically in the top rows of the
 *    frame): a static pixel is EXCLUDED from scoring when its row is
 *    above (green top row + 4) of its column, where the green top row is
 *    the topmost row of the DILATED green union in that column (columns
 *    with no green at all exclude everything). The search scores a
 *    deterministic row-major strided subsample of the scored set (<= 2000
 *    points) — the same subsample scores the refinement — while the
 *    final validation uses the FULL scored set (documented efficiency
 *    note, deterministic). Fewer than 4 detected lines, or no hypothesis
 *    surviving the sanity checks, → typed refusal
 *    `broadcast-line.no-consistent-homography`.
 * 7. REFINEMENT: the best hypothesis's 8 homography parameters (h0..h7,
 *    h8 = 1) are refined by coordinate descent on the combined objective —
 *    forward (the step-6 score) + backward chamfer reward (model line
 *    sample points — every 0.5 m along every model segment/arc —
 *    projected into the image through H⁻¹ via W203 `invertHomography`;
 *    in-frame points earn clamp(1 − d/12, 0, 1), where d is their 2-pass
 *    3-4 chamfer distance to the static mask) + green containment (the
 *    fraction of a deterministic row-major strided subsample of
 *    green-union pixels projecting inside the pitch + 3 m margin). Equal
 *    weights (each term in [0, 1]; documented). Per-parameter step =
 *    max(|h_i| * 0.008, 1e-5) (the floor only matters for exactly-zero
 *    parameters), halved when neither direction improves, 60 fixed
 *    rounds over the 8 parameters, strictly-greater acceptance —
 *    deterministic. Non-finite or non-invertible candidates score −∞ and
 *    are rejected.
 * 8. VALIDATION + CONFIDENCE (honest): final metrics over the FULL
 *    evidence — lineFit = fraction of scored static pixels within 1.0 m
 *    of model lines; backward = mean chamfer distance (px) of in-frame
 *    projected model points to the mask. lineFit < 0.55 or backward >
 *    12 px → typed refusal `broadcast-line.no-consistent-homography`
 *    (not good enough to project with — never a guessed mapping).
 *    Confidence (documented formula):
 *    clamp(0.25 + 0.45 * lineFit + 0.3 * max(0, 1 − backward / 12), 0, 1).
 * 9. OUTPUT: the refined H (image-normalized → pitch, h[8] = 1); the
 *    corner set = the four canonical pitch corners mapped through H⁻¹
 *    (W203 `invertHomography` + `applyHomography`) back to normalized
 *    image coordinates in "tl, tr, br, bl" order carrying the confidence;
 *    the `FieldMappingPayload` mapping with cameraHomographyRef
 *    `homography-<calibratorId>-<anchorFrame.frameId>`;
 *    correspondenceCount = 4 (the boundary anchors).
 *
 * ENVELOPE (honest, like the line-based candidate's):
 *
 * - Requires a STATIC camera across the input window: measured wobble is
 *   compensated up to ±40 px per frame against the anchor; panning beyond
 *   refuses (`broadcast-line.camera-motion`).
 * - Partial visibility OK — the hypothesis search and the refinement work
 *   from whatever boundary lines are visible — but the ENUMERATION needs
 *   the boundary quad anchors: views lacking 2 touchline-role + 2
 *   goal-line-role lines refuse `broadcast-line.no-consistent-homography`.
 * - Elevated main-camera geometry: the search's ordering prior assumes
 *   the near touchline below the far touchline and the left goal line
 *   left of the right goal line in the image; corner-mounted, inverted,
 *   or heavily rotated geometries fall outside the envelope and refuse
 *   honestly.
 * - 640x360-class web-rendered broadcast frames; works at other
 *   resolutions with the same constants (all thresholds are in pixels).
 * - Real lines are caught by LOCAL CONTRAST (the documented reason the
 *   bright-white predicate fails on real broadcasts): any marking ~40+
 *   brightness units above its 13x13 neighborhood inside the green union.
 * - The backward metric penalizes in-frame model points without painted
 *   evidence (occluded or unpainted line regions) — heavy occlusion of
 *   line regions drives backward up and the candidate refuses honestly
 *   rather than project through a wrong H.
 */
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import {
  CANONICAL_PITCH_CORNERS,
  applyHomography,
  invertHomography,
  solveHomography,
} from "@sporta/field-mapping";
import type { FieldCornerSet, Homography, PitchPoint, Point2D } from "@sporta/field-mapping";
import type { FieldMappingPayload } from "@sporta/contracts";
import type { DetectorFrameInput } from "@sporta/perception-detection";
import { assertDescriptorBinding, CandidateFailureError, perceptionDescriptor } from "../errors";
import { BROADCAST_LINE_FIELD_CALIBRATOR_LICENSE } from "../licenses";
import { isPitchGreen } from "../pixels";
import type { CalibrationResult, PitchCalibrationAdapter, PitchCalibrationInput } from "../adapter";

/** Stable technology identity of this candidate. */
export const BROADCAST_LINE_FIELD_CALIBRATOR_ID = "broadcast-line-calibrator";
export const BROADCAST_LINE_FIELD_CALIBRATOR_VERSION = "0.1.0";
export const BROADCAST_LINE_FIELD_CALIBRATOR_ADAPTER_VERSION = "0.1.0";

/**
 * Options for {@link BroadcastLineCalibrator}; every field is optional,
 * every field is validated fail-loud with `RangeError` at construction.
 */
export interface BroadcastLineCalibratorOptions {
  /** Component id (default `broadcast-line-calibrator-v1`). */
  readonly calibratorId?: string;
  /** Minimum green-union fraction of the frame (default 0.2). */
  readonly minPitchFraction?: number;
  /**
   * Local-contrast threshold in brightness units: line pixels must exceed
   * their 13x13 local mean by more than this (default 14 — real broadcast
   * lines measure 40-70 above grass).
   */
  readonly lineContrastThreshold?: number;
}

const BROADCAST_LINE_DEFAULTS = {
  calibratorId: "broadcast-line-calibrator-v1",
  minPitchFraction: 0.2,
  lineContrastThreshold: 14,
} as const;

/** Documented failure classes of the broadcast-line field calibrator. */
export const BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "broadcast-line.no-pitch-visible",
    description:
      "The green-pitch union (over the whole sequence, dilated) covers less than " +
        "minPitchFraction of the frame, or a frame is degenerately small: not enough " +
        "pitch in view to calibrate honestly. Typed refusal, never a guessed mapping.",
    retryable: false,
  },
  {
    failureClassId: "broadcast-line.camera-motion",
    description:
      "A frame's measured content translation against the anchor frame exceeds the " +
        "±40 px compensation envelope (panning or cut cameras). The candidate needs a " +
        "static camera across the window; it refuses honestly instead of aggregating " +
        "across a moving viewpoint.",
    retryable: false,
  },
  {
    failureClassId: "broadcast-line.insufficient-line-evidence",
    description:
      "An empty frame sequence, or a motion-compensated static line mask below 500 " +
        "pixels: too little static line evidence to search for a homography. Typed " +
        "refusal.",
    retryable: false,
  },
  {
    failureClassId: "broadcast-line.no-consistent-homography",
    description:
      "No boundary hypothesis survived the quad sanity checks, or the best refined " +
        "homography failed validation (lineFit < 0.55 or backward chamfer > 12 px), " +
        "or the refined H is not invertible to image coordinates. Honest refusal: " +
        "not good enough to project with. Views lacking 2 touchline-role + 2 " +
        "goal-line-role lines land here (the documented partial-visibility limit).",
    retryable: false,
  },
];

/** Resource requirements: pure CPU, one core. */
export const BROADCAST_LINE_FIELD_CALIBRATOR_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minCpuCores: 1,
};

// ---------------------------------------------------------------------------
// Frozen algorithm constants (each is part of the tested contract).
// ---------------------------------------------------------------------------

/** Dilations (3x3, border-replicate) of the per-frame green union. */
const GREEN_UNION_DILATIONS = 3;
/** Box taps for profile smoothing before cross-correlation. */
const PROFILE_SMOOTHING_TAPS = 9;
/**
 * Motion search window: integer shifts searched when correlating each
 * frame's green profiles against the anchor's. ±60 px (documented
 * deviation — see the module docs, step 2).
 */
const MOTION_SEARCH_LIMIT_PX = 60;
/** Motion refusal bound: the documented ±40 px compensation envelope. */
const MOTION_REFUSAL_LIMIT_PX = 40;
/** Local-mean radius for the line-mask local contrast: 13x13 box. */
const LOCAL_CONTRAST_RADIUS = 6;
/** Dilations (3x3) of each motion-compensated frame mask before counting. */
const MASK_DILATIONS = 2;
/** Static-mask threshold: pixel present in >= this fraction of frames. */
const STATIC_MASK_THRESHOLD = 0.5;
/** Minimum static line pixels to proceed (typed refusal below). */
const MIN_STATIC_LINE_PIXELS = 500;
/** Hough: theta bins over [0, π). */
const HOUGH_THETA_BINS = 180;
/**
 * Hough: maximum extracted peaks. 28 (not 16): the family split below
 * needs the WEAK minority-orientation lines too — on real 640x360 masks
 * the near-vertical family survives at ~50 votes while 16+ near-horizontal
 * peaks outrank it; a 16-line cap starves the minority family exactly where
 * it is needed (the measured R606 windows).
 */
const HOUGH_MAX_LINES = 28;
/** Hough: per-orientation-family quota within the 28-line cap (see below). */
const HOUGH_FAMILY_QUOTA = 14;
/** Hough: suppression-iteration bound (quota-driven loop safety cap). */
const HOUGH_MAX_ITERATIONS = 160;
/** Hough: minimum votes for a peak to become a detected line. */
const HOUGH_MIN_VOTES = 30;
/**
 * Hough: minimum supporting-pixel extent along the line (px). 30 (not 60):
 * the minority-orientation (near-vertical) family on real 640x360 partial
 * views carries SHORT straight support — the halfway-line segments measured
 * ~38 px and the converging boundary segments ~50 px — and they are exactly
 * the anchors the family search needs; 60 (and even 40) rejected them all
 * and starved the search (measured R606). 30 px still implies line-ness;
 * blob noise rarely sustains 30 px of collinear support at >= 30 votes.
 */
const HOUGH_MIN_EXTENT_PX = 30;
/** Hough: supporting pixels lie within this distance of the line (px). */
const HOUGH_LINE_TOLERANCE_PX = 2.5;
/** Hough: peak suppression neighborhood, theta bins. */
const HOUGH_THETA_SUPPRESSION = 4;
/** Hough: peak suppression neighborhood, rho bins. */
const HOUGH_RHO_SUPPRESSION = 12;
/** Scoring: distance-to-model radius (m). */
const SCORE_RADIUS_M = 1.0;
/** Green containment: pitch + margin (m). */
const GREEN_CONTAINMENT_MARGIN_M = 3;
/** Hoardings suppression: rows above (green top row + this) are excluded. */
const HOARDINGS_ROW_MARGIN = 4;
/** Search + refinement forward scoring: subsample cap (points). */
const SEARCH_SCORE_MAX_POINTS = 2000;
/** Green-containment subsample cap (pixels). */
const GREEN_SAMPLE_MAX_POINTS = 2000;
/** Refinement: rounds of coordinate descent over h0..h7. */
const REFINEMENT_ROUNDS = 60;
/** Refinement: per-parameter step = max(|h_i| * this, STEP_FLOOR). */
const REFINEMENT_STEP_FRACTION = 0.008;
/** Refinement: step floor (only reachable for exactly-zero parameters). */
const REFINEMENT_STEP_FLOOR = 1e-5;
/** Validation: minimum acceptable lineFit (0.60: the behind-goal R606
 * window measured a 0.55-0.79 false-accept whose overlay was visually
 * misaligned — the gate is calibrated so a PASS means aligned). */
const VALIDATION_LINE_FIT_MIN = 0.6;
/** Validation: maximum acceptable backward chamfer (px). */
const VALIDATION_BACKWARD_MAX_PX = 10;
/** Plausible-view bound: pitch corners within [−1, 2]² normalized. */
const CORNER_BOUND = 1;

// ---------------------------------------------------------------------------
// The canonical pitch model (105 x 68) — lines, arcs, distance field.
// ---------------------------------------------------------------------------

/** One straight model marking, in canonical pitch meters. */
interface ModelSegment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * One circular model marking (center circle or penalty arc), in canonical
 * pitch meters; `xMin`/`xMax` clip the circle to the painted arc (the
 * penalty arcs exist only OUTSIDE their penalty areas).
 */
interface ModelArc {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly xMin?: number;
  readonly xMax?: number;
}

/** Penalty-area front depth + half-heights (canonical 105 x 68 model). */
const PENALTY_FRONT_X = 16.5;
const PENALTY_HALF_HEIGHT = 20.16;
/** Goal-area front depth + half-heights (canonical 105 x 68 model). */
const GOAL_AREA_FRONT_X = 5.5;
const GOAL_AREA_HALF_HEIGHT = 9.16;
/** Center circle + penalty-arc radius (canonical model). */
const ARC_RADIUS_M = 9.15;
/** Penalty-spot centers, 11 m from each goal line. */
const PENALTY_SPOT_LEFT_X = 11;
const PENALTY_SPOT_RIGHT_X = 94;

const PITCH_LENGTH = 105;
const PITCH_WIDTH = 68;
const MID_X = PITCH_LENGTH / 2;
const MID_Y = PITCH_WIDTH / 2;

/** Every straight marking of the canonical model. */
const MODEL_SEGMENTS: readonly ModelSegment[] = [
  // Touchlines (y = 0 / y = 68) and goal lines (x = 0 / x = 105).
  { x0: 0, y0: 0, x1: PITCH_LENGTH, y1: 0 },
  { x0: 0, y0: PITCH_WIDTH, x1: PITCH_LENGTH, y1: PITCH_WIDTH },
  { x0: 0, y0: 0, x1: 0, y1: PITCH_WIDTH },
  { x0: PITCH_LENGTH, y0: 0, x1: PITCH_LENGTH, y1: PITCH_WIDTH },
  // Halfway line.
  { x0: MID_X, y0: 0, x1: MID_X, y1: PITCH_WIDTH },
  // Penalty-area fronts (x = 16.5 / 88.5, y 13.84..54.16).
  { x0: PENALTY_FRONT_X, y0: MID_Y - PENALTY_HALF_HEIGHT, x1: PENALTY_FRONT_X, y1: MID_Y + PENALTY_HALF_HEIGHT },
  { x0: PITCH_LENGTH - PENALTY_FRONT_X, y0: MID_Y - PENALTY_HALF_HEIGHT, x1: PITCH_LENGTH - PENALTY_FRONT_X, y1: MID_Y + PENALTY_HALF_HEIGHT },
  // Penalty-area tops/bottoms (goal line -> front, both ends).
  { x0: 0, y0: MID_Y - PENALTY_HALF_HEIGHT, x1: PENALTY_FRONT_X, y1: MID_Y - PENALTY_HALF_HEIGHT },
  { x0: 0, y0: MID_Y + PENALTY_HALF_HEIGHT, x1: PENALTY_FRONT_X, y1: MID_Y + PENALTY_HALF_HEIGHT },
  { x0: PITCH_LENGTH - PENALTY_FRONT_X, y0: MID_Y - PENALTY_HALF_HEIGHT, x1: PITCH_LENGTH, y1: MID_Y - PENALTY_HALF_HEIGHT },
  { x0: PITCH_LENGTH - PENALTY_FRONT_X, y0: MID_Y + PENALTY_HALF_HEIGHT, x1: PITCH_LENGTH, y1: MID_Y + PENALTY_HALF_HEIGHT },
  // Goal-area fronts (x = 5.5 / 99.5, y 24.84..43.16).
  { x0: GOAL_AREA_FRONT_X, y0: MID_Y - GOAL_AREA_HALF_HEIGHT, x1: GOAL_AREA_FRONT_X, y1: MID_Y + GOAL_AREA_HALF_HEIGHT },
  { x0: PITCH_LENGTH - GOAL_AREA_FRONT_X, y0: MID_Y - GOAL_AREA_HALF_HEIGHT, x1: PITCH_LENGTH - GOAL_AREA_FRONT_X, y1: MID_Y + GOAL_AREA_HALF_HEIGHT },
  // Goal-area tops/bottoms (goal line -> front, both ends).
  { x0: 0, y0: MID_Y - GOAL_AREA_HALF_HEIGHT, x1: GOAL_AREA_FRONT_X, y1: MID_Y - GOAL_AREA_HALF_HEIGHT },
  { x0: 0, y0: MID_Y + GOAL_AREA_HALF_HEIGHT, x1: GOAL_AREA_FRONT_X, y1: MID_Y + GOAL_AREA_HALF_HEIGHT },
  { x0: PITCH_LENGTH - GOAL_AREA_FRONT_X, y0: MID_Y - GOAL_AREA_HALF_HEIGHT, x1: PITCH_LENGTH, y1: MID_Y - GOAL_AREA_HALF_HEIGHT },
  { x0: PITCH_LENGTH - GOAL_AREA_FRONT_X, y0: MID_Y + GOAL_AREA_HALF_HEIGHT, x1: PITCH_LENGTH, y1: MID_Y + GOAL_AREA_HALF_HEIGHT },
];

/** Every circular marking: the center circle + both clipped penalty arcs. */
const MODEL_ARCS: readonly ModelArc[] = [
  { cx: MID_X, cy: MID_Y, r: ARC_RADIUS_M },
  { cx: PENALTY_SPOT_LEFT_X, cy: MID_Y, r: ARC_RADIUS_M, xMin: PENALTY_FRONT_X },
  { cx: PENALTY_SPOT_RIGHT_X, cy: MID_Y, r: ARC_RADIUS_M, xMax: PITCH_LENGTH - PENALTY_FRONT_X },
];

/** Point-to-segment distance, canonical pitch meters. */
function pointSegmentDistance(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSquared));
  }
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** Point-to-clipped-arc distance, canonical pitch meters. */
function pointArcDistance(px: number, py: number, arc: ModelArc): number {
  const vx = px - arc.cx;
  const vy = py - arc.cy;
  const distance = Math.hypot(vx, vy);
  if (distance > 1e-12) {
    const nx = vx / distance;
    const ny = vy / distance;
    const onX = (arc.xMin === undefined || arc.cx + arc.r * nx >= arc.xMin) &&
      (arc.xMax === undefined || arc.cx + arc.r * nx <= arc.xMax);
    if (onX) return Math.abs(distance - arc.r);
  } else if (arc.xMin === undefined && arc.xMax === undefined) {
    return arc.r;
  }
  // Nearest point is an arc endpoint: the clip planes' chord ends.
  let best = Number.POSITIVE_INFINITY;
  for (const clip of [arc.xMin, arc.xMax]) {
    if (clip === undefined) continue;
    const halfChord = Math.sqrt(Math.max(0, arc.r * arc.r - (clip - arc.cx) ** 2));
    for (const sign of [-1, 1]) {
      best = Math.min(best, Math.hypot(px - clip, py - (arc.cy + sign * halfChord)));
    }
  }
  return best;
}

/** Distance-field grid constants: 0.5 m cells over [−5, 110] × [−5, 73]. */
const FIELD_ORIGIN_M = -5;
const FIELD_CELL_M = 0.5;
const FIELD_COLS = 230;
const FIELD_ROWS = 156;

/**
 * The pitch-plane distance field to ALL model lines + arcs, memoized at
 * module level: it is a pure function of the frozen canonical model (no
 * input dependency), so the cache is deterministic — identical values on
 * every call. Nearest-cell lookup (<= 0.25 m per-axis quantization).
 */
let cachedDistanceField: Float32Array | undefined;

function pitchModelDistanceField(): Float32Array {
  if (cachedDistanceField === undefined) {
    const field = new Float32Array(FIELD_COLS * FIELD_ROWS);
    for (let row = 0; row < FIELD_ROWS; row += 1) {
      const y = FIELD_ORIGIN_M + (row + 0.5) * FIELD_CELL_M;
      for (let col = 0; col < FIELD_COLS; col += 1) {
        const x = FIELD_ORIGIN_M + (col + 0.5) * FIELD_CELL_M;
        let best = Number.POSITIVE_INFINITY;
        for (const segment of MODEL_SEGMENTS) {
          best = Math.min(best, pointSegmentDistance(x, y, segment.x0, segment.y0, segment.x1, segment.y1));
        }
        for (const arc of MODEL_ARCS) {
          best = Math.min(best, pointArcDistance(x, y, arc));
        }
        field[row * FIELD_COLS + col] = best;
      }
    }
    cachedDistanceField = field;
  }
  return cachedDistanceField;
}

/** Distance (m) from a pitch point to the nearest model line/arc. */
function modelDistanceAt(x: number, y: number): number {
  const field = pitchModelDistanceField();
  const col = Math.min(
    FIELD_COLS - 1,
    Math.max(0, Math.round((x - FIELD_ORIGIN_M) / FIELD_CELL_M - 0.5)),
  );
  const row = Math.min(
    FIELD_ROWS - 1,
    Math.max(0, Math.round((y - FIELD_ORIGIN_M) / FIELD_CELL_M - 0.5)),
  );
  return field[row * FIELD_COLS + col]!;
}

/** Model sampling step for the backward chamfer term (m along the line). */
const MODEL_SAMPLE_STEP_M = 0.5;

/**
 * Model line sample points (pitch meters, `[x, y, ...]`), every
 * MODEL_SAMPLE_STEP_M along every segment and arc — memoized at module
 * level (a pure function of the frozen model, deterministic).
 */
let cachedModelSamples: Float64Array | undefined;

function pitchModelSamplePoints(): Float64Array {
  if (cachedModelSamples === undefined) {
    const points: number[] = [];
    for (const segment of MODEL_SEGMENTS) {
      const length = Math.hypot(segment.x1 - segment.x0, segment.y1 - segment.y0);
      const steps = Math.max(1, Math.ceil(length / MODEL_SAMPLE_STEP_M));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        points.push(segment.x0 + (segment.x1 - segment.x0) * t, segment.y0 + (segment.y1 - segment.y0) * t);
      }
    }
    for (const arc of MODEL_ARCS) {
      // The visible angle span: full circle, or the clipped arc sector.
      let angle0 = 0;
      let angleSpan = Math.PI * 2;
      if (arc.xMin !== undefined) {
        const half = Math.acos(Math.min(1, Math.max(-1, (arc.xMin - arc.cx) / arc.r)));
        angle0 = -half;
        angleSpan = 2 * half;
      } else if (arc.xMax !== undefined) {
        const half = Math.acos(Math.min(1, Math.max(-1, (arc.cx - arc.xMax) / arc.r)));
        angle0 = Math.PI - half;
        angleSpan = 2 * half;
      }
      const arcLength = arc.r * angleSpan;
      const steps = Math.max(1, Math.ceil(arcLength / MODEL_SAMPLE_STEP_M));
      for (let step = 0; step <= steps; step += 1) {
        const angle = angle0 + (angleSpan * step) / steps;
        points.push(arc.cx + arc.r * Math.cos(angle), arc.cy + arc.r * Math.sin(angle));
      }
    }
    cachedModelSamples = Float64Array.from(points);
  }
  return cachedModelSamples;
}

// ---------------------------------------------------------------------------
// Pure pixel machinery (fixed scan orders, no allocation-visible state).
// ---------------------------------------------------------------------------

/**
 * Binary 3x3 dilation, `iterations` rounds, border-replicate edges
 * (documented: clamped coordinates behave as replicated borders).
 * Returns a NEW mask (the input is never mutated). Deterministic.
 */
function dilate3x3(
  mask: Uint8Array,
  width: number,
  height: number,
  iterations: number,
): Uint8Array {
  let current = mask;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const up = y > 0 ? y - 1 : y;
      const down = y < height - 1 ? y + 1 : y;
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (current[index] !== 0) {
          next[index] = 1;
          continue;
        }
        const left = x > 0 ? x - 1 : x;
        const right = x < width - 1 ? x + 1 : x;
        if (
          current[up * width + left] !== 0 ||
          current[up * width + x] !== 0 ||
          current[up * width + right] !== 0 ||
          current[y * width + left] !== 0 ||
          current[y * width + right] !== 0 ||
          current[down * width + left] !== 0 ||
          current[down * width + x] !== 0 ||
          current[down * width + right] !== 0
        ) {
          next[index] = 1;
        }
      }
    }
    current = next;
  }
  return current;
}

/**
 * Shifts a mask's content by (−dx, −dy): `out(x, y) = mask(x + dx, y + dy)`
 * — the frame's content (measured at +dx/+dy relative to the anchor) moves
 * back into anchor coordinates. Out-of-range source pixels read as 0.
 * Deterministic.
 */
function shiftMask(
  mask: Uint8Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const sourceY = y + dy;
    if (sourceY < 0 || sourceY >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const sourceX = x + dx;
      if (sourceX < 0 || sourceX >= width) continue;
      out[y * width + x] = mask[sourceY * width + sourceX]!;
    }
  }
  return out;
}

/**
 * One frame's green mask (row-major scan) — `isPitchGreen` per pixel.
 * Deterministic.
 */
function greenMaskOf(frame: DetectorFrameInput): Uint8Array {
  const { width, height, bytes } = frame;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      if (isPitchGreen(bytes[index]!, bytes[index + 1]!, bytes[index + 2]!)) {
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * One frame's green profiles: per-column and per-row green counts
 * (row-major scan). Deterministic.
 */
function greenProfiles(
  mask: Uint8Array,
  width: number,
  height: number,
): { column: Float64Array; row: Float64Array } {
  const column = new Float64Array(width);
  const row = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] !== 0) {
        column[x] += 1;
        row[y] += 1;
      }
    }
  }
  return { column, row };
}

/**
 * Smooths a profile with a zero-padded 9-tap box (each output = the mean
 * of the 9 window values; out-of-range taps read as 0). Deterministic.
 */
function boxSmooth9(profile: Float64Array): Float64Array {
  const smoothed = new Float64Array(profile.length);
  const half = Math.floor(PROFILE_SMOOTHING_TAPS / 2);
  for (let i = 0; i < profile.length; i += 1) {
    let sum = 0;
    for (let k = -half; k <= half; k += 1) {
      const j = i + k;
      if (j >= 0 && j < profile.length) sum += profile[j]!;
    }
    smoothed[i] = sum / PROFILE_SMOOTHING_TAPS;
  }
  return smoothed;
}

/**
 * The integer shift in [−limit, +limit] maximizing the dot product
 * `Σ frame(x + s) · anchor(x)` (out-of-range reads as 0) — the frame's
 * content translation relative to the anchor. Ascending scan with strict
 * `>` (the SMALLEST maximizing shift wins ties; deterministic). The
 * correlation peaks where the profiles align: content translated by t
 * maximizes at s = t.
 */
function bestProfileShift(frame: Float64Array, anchor: Float64Array, limit: number): number {
  let bestShift = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let shift = -limit; shift <= limit; shift += 1) {
    let dot = 0;
    for (let x = 0; x < anchor.length; x += 1) {
      const shifted = x + shift;
      if (shifted < 0 || shifted >= frame.length) continue;
      dot += frame[shifted]! * anchor[x]!;
    }
    if (dot > bestScore) {
      bestScore = dot;
      bestShift = shift;
    }
  }
  return bestShift;
}

/**
 * One frame's line mask: LOCAL CONTRAST — integral image of brightness
 * (r+g+b) gives the local mean over a 13x13 edge-clamped box; a pixel is
 * a line pixel when `brightness − localMean > contrastThreshold` AND it
 * lies inside the dilated green union. Integer-exact comparison:
 * `b3 * boxCount − boxSum > 3 * threshold * boxCount`. Deterministic
 * (row-major scan).
 */
function lineMaskOf(
  frame: DetectorFrameInput,
  dilatedGreenUnion: Uint8Array,
  contrastThreshold: number,
): Uint8Array {
  const { width, height, bytes } = frame;
  const stride = width + 1;
  const integral = new Int32Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 3;
      rowSum += bytes[pixel]! + bytes[pixel + 1]! + bytes[pixel + 2]!;
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)]! + rowSum;
    }
  }
  const mask = new Uint8Array(width * height);
  const thresholdTimes3 = 3 * contrastThreshold;
  for (let y = 0; y < height; y += 1) {
    const boxY0 = Math.max(0, y - LOCAL_CONTRAST_RADIUS);
    const boxY1 = Math.min(height - 1, y + LOCAL_CONTRAST_RADIUS);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (dilatedGreenUnion[index] === 0) continue;
      const boxX0 = Math.max(0, x - LOCAL_CONTRAST_RADIUS);
      const boxX1 = Math.min(width - 1, x + LOCAL_CONTRAST_RADIUS);
      const boxCount = (boxX1 - boxX0 + 1) * (boxY1 - boxY0 + 1);
      const boxSum =
        integral[(boxY1 + 1) * stride + (boxX1 + 1)]! -
        integral[boxY0 * stride + (boxX1 + 1)]! -
        integral[(boxY1 + 1) * stride + boxX0]! +
        integral[boxY0 * stride + boxX0]!;
      const brightness3 =
        bytes[index * 3]! + bytes[index * 3 + 1]! + bytes[index * 3 + 2]!;
      if (brightness3 * boxCount - boxSum > thresholdTimes3 * boxCount) {
        mask[index] = 1;
      }
    }
  }
  return mask;
}

/**
 * 2-pass 3-4 chamfer distance transform of a binary mask, in pixels
 * (forward pass top-left → bottom-right, backward pass reversed; the 3-4
 * weights are divided by 3). Deterministic.
 */
function chamferDistanceTransform(mask: Uint8Array, width: number, height: number): Float64Array {
  const large = Number.POSITIVE_INFINITY;
  const distance = new Float64Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) distance[i] = mask[i] !== 0 ? 0 : large;
  const at = (x: number, y: number): number =>
    x < 0 || x >= width || y < 0 || y >= height ? large : distance[y * width + x]!;
  // Forward pass: west, north, north-west, north-east.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (distance[index] === 0) continue;
      distance[index] = Math.min(
        distance[index]!,
        at(x - 1, y) + 3,
        at(x, y - 1) + 3,
        at(x - 1, y - 1) + 4,
        at(x + 1, y - 1) + 4,
      );
    }
  }
  // Backward pass: east, south, south-east, south-west.
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (distance[index] === 0) continue;
      distance[index] = Math.min(
        distance[index]!,
        at(x + 1, y) + 3,
        at(x, y + 1) + 3,
        at(x + 1, y + 1) + 4,
        at(x - 1, y + 1) + 4,
      );
    }
  }
  for (let i = 0; i < distance.length; i += 1) {
    distance[i] = distance[i]! === large ? large : distance[i]! / 3;
  }
  return distance;
}

// ---------------------------------------------------------------------------
// Hough line extraction.
// ---------------------------------------------------------------------------

/** One Hough-extracted line: theta/rho (px), votes, support statistics. */
interface HoughLine {
  /** Line angle in radians: rho = x·cosθ + y·sinθ. */
  readonly theta: number;
  /** Signed perpendicular distance from the origin (px). */
  readonly rho: number;
  /** Accumulator votes at the extracted peak. */
  readonly votes: number;
  /** Mean supporting-pixel x (px) — the ordering-prior statistic. */
  readonly meanX: number;
  /** Mean supporting-pixel y (px) — the ordering-prior statistic. */
  readonly meanY: number;
}

/**
 * Iterative Hough peak extraction over the static pixel list (`[x, y, ...]`
 * pairs, row-major order): 180 theta bins over [0, π), integer rho over
 * [−diag, diag]; every static pixel votes for every theta; peaks are taken
 * by accumulator max (first in (theta, rho) scan order on ties), suppressed
 * theta ±4 × rho ±12, up to 16 peaks; a peak becomes a detected line when
 * votes >= 30 AND the supporting pixels (within 2.5 px) span >= 60 px.
 * Deterministic.
 */
function houghExtractLines(
  staticPixels: readonly number[],
  width: number,
  height: number,
): HoughLine[] {
  const cos = new Float64Array(HOUGH_THETA_BINS);
  const sin = new Float64Array(HOUGH_THETA_BINS);
  for (let theta = 0; theta < HOUGH_THETA_BINS; theta += 1) {
    const angle = (theta * Math.PI) / HOUGH_THETA_BINS;
    cos[theta] = Math.cos(angle);
    sin[theta] = Math.sin(angle);
  }
  const diagonal = Math.ceil(Math.hypot(width, height));
  const rhoBins = 2 * diagonal + 1;
  const accumulator = new Int32Array(HOUGH_THETA_BINS * rhoBins);
  for (let p = 0; p < staticPixels.length; p += 2) {
    const x = staticPixels[p]!;
    const y = staticPixels[p + 1]!;
    for (let theta = 0; theta < HOUGH_THETA_BINS; theta += 1) {
      const rho = Math.round(x * cos[theta]! + y * sin[theta]!);
      accumulator[theta * rhoBins + rho + diagonal] += 1;
    }
  }
  const lines: HoughLine[] = [];
  let horizontalQuota = HOUGH_FAMILY_QUOTA;
  let verticalQuota = HOUGH_FAMILY_QUOTA;
  let iterations = 0;
  // Iteration bound: the loop is QUOTA-driven (it continues suppressing
  // majority-family peaks past the extraction cap so minority-family peaks
  // can surface); the bound guards pathological accumulator landscapes.
  while (iterations < HOUGH_MAX_ITERATIONS) {
    iterations += 1;
    if (horizontalQuota <= 0 && verticalQuota <= 0) break;
    // Scan-order max: the first (theta, rho) in scan order wins ties.
    let bestTheta = -1;
    let bestRhoIndex = -1;
    let bestVotes = 0;
    for (let theta = 0; theta < HOUGH_THETA_BINS; theta += 1) {
      const base = theta * rhoBins;
      for (let rhoIndex = 0; rhoIndex < rhoBins; rhoIndex += 1) {
        const votes = accumulator[base + rhoIndex]!;
        if (votes > bestVotes) {
          bestVotes = votes;
          bestTheta = theta;
          bestRhoIndex = rhoIndex;
        }
      }
    }
    // Early stop (documented): sub-30 peaks can never pass the vote filter.
    if (bestVotes < HOUGH_MIN_VOTES) break;
    const theta = bestTheta;
    const rho = bestRhoIndex - diagonal;
    // PER-FAMILY QUOTA (the starvation fix): every peak is ALWAYS
    // suppressed (below), but a peak whose orientation family's quota is
    // full is not EXTRACTED — the weaker minority family (the near-vertical
    // anchors on real broadcast partial views, measured at ~31-55 votes
    // against 43-312 for the horizontal fan cluster) still gets its share
    // of the cap. A single shared 28-line cap let the fan cluster of arc
    // segments occupy every slot and starved the vertical family to zero
    // (measured R606).
    const thetaDegrees = (theta * 180) / HOUGH_THETA_BINS;
    const familyIsHorizontal = thetaDegrees >= 40 && thetaDegrees <= 140;
    const familyQuotaRemaining = familyIsHorizontal ? horizontalQuota : verticalQuota;
    // Suppress the neighborhood (no cyclic theta wrap; clamped bounds).
    const thetaLow = Math.max(0, bestTheta - HOUGH_THETA_SUPPRESSION);
    const thetaHigh = Math.min(HOUGH_THETA_BINS - 1, bestTheta + HOUGH_THETA_SUPPRESSION);
    const rhoLow = Math.max(0, bestRhoIndex - HOUGH_RHO_SUPPRESSION);
    const rhoHigh = Math.min(rhoBins - 1, bestRhoIndex + HOUGH_RHO_SUPPRESSION);
    for (let t = thetaLow; t <= thetaHigh; t += 1) {
      for (let r = rhoLow; r <= rhoHigh; r += 1) {
        accumulator[t * rhoBins + r] = -1;
      }
    }
    // Support pass: pixels within HOUGH_LINE_TOLERANCE_PX of the line.
    const c = cos[theta]!;
    const s = sin[theta]!;
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minAlong = Number.POSITIVE_INFINITY;
    let maxAlong = Number.NEGATIVE_INFINITY;
    for (let p = 0; p < staticPixels.length; p += 2) {
      const x = staticPixels[p]!;
      const y = staticPixels[p + 1]!;
      if (Math.abs(x * c + y * s - rho) <= HOUGH_LINE_TOLERANCE_PX) {
        const along = -x * s + y * c;
        count += 1;
        sumX += x;
        sumY += y;
        if (along < minAlong) minAlong = along;
        if (along > maxAlong) maxAlong = along;
      }
    }
    const extent = count > 0 ? maxAlong - minAlong : 0;
    if (count > 0 && extent >= HOUGH_MIN_EXTENT_PX && familyQuotaRemaining > 0) {
      lines.push({ theta: (theta * Math.PI) / HOUGH_THETA_BINS, rho, votes: bestVotes, meanX: sumX / count, meanY: sumY / count });
      if (familyIsHorizontal) horizontalQuota -= 1;
      else verticalQuota -= 1;
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Hypothesis search machinery.
// ---------------------------------------------------------------------------

/** Pixel Point2D -> normalized [0, 1] image coordinates. Deterministic. */
function normalized(point: Point2D, width: number, height: number): Point2D {
  return { x: point.x / width, y: point.y / height };
}

/**
 * Intersects two Hough lines; `undefined` when (near-)parallel. Pixel
 * coordinates. Deterministic.
 */
function intersectHoughLines(a: HoughLine, b: HoughLine): Point2D | undefined {
  const det = Math.cos(a.theta) * Math.sin(b.theta) - Math.cos(b.theta) * Math.sin(a.theta);
  if (Math.abs(det) < 1e-9) return undefined;
  const x = (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / det;
  const y = (Math.cos(a.theta) * b.rho - Math.cos(b.theta) * a.rho) / det;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

/**
 * Quad sanity (normalized coordinates): all four corners finite and within
 * the plausible-view bounds [−1, 2]²; strictly convex (the four
 * consecutive-edge cross products share a sign); no three corners
 * collinear (each cross exceeds the degeneracy epsilon — the same
 * computation covers both). Deterministic.
 */
function quadIsSane(corners: readonly Point2D[]): boolean {
  for (const corner of corners) {
    if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) return false;
    if (corner.x < -CORNER_BOUND || corner.x > 2 || corner.y < -CORNER_BOUND || corner.y > 2) {
      return false;
    }
  }
  let orientation = 0;
  for (let k = 0; k < 4; k += 1) {
    const p0 = corners[k]!;
    const p1 = corners[(k + 1) % 4]!;
    const p2 = corners[(k + 2) % 4]!;
    const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
    if (Math.abs(cross) <= 1e-9) return false;
    const sign = cross > 0 ? 1 : -1;
    if (orientation === 0) orientation = sign;
    else if (sign !== orientation) return false;
  }
  return true;
}

/**
 * Safe (non-throwing) projection for SEARCH/SCORING inner loops: `undefined`
 * maps to "outlier" (a point at infinity is never within 1 m of a model
 * line). The canonical W203 `applyHomography` remains the contract
 * boundary; this local helper exists so enumeration loops never throw.
 * Assumes the canonical `h[8] = 1` form (always true in this module).
 */
function projectSafe(h: Homography, u: number, v: number): { x: number; y: number } | undefined {
  const denominator = h[6]! * u + h[7]! * v + 1;
  if (Math.abs(denominator) < 1e-12) return undefined;
  return {
    x: (h[0]! * u + h[1]! * v + h[2]!) / denominator,
    y: (h[3]! * u + h[4]! * v + h[5]!) / denominator,
  };
}

// ---------------------------------------------------------------------------
// The generalized family hypothesis search (step 6).
// ---------------------------------------------------------------------------

/**
 * The pitch model's two parallel line FAMILIES (canonical meters). Every
 * painted straight marking belongs to exactly one: the x-family runs along
 * the pitch WIDTH at a constant x; the y-family runs along the LENGTH at a
 * constant y. Under ANY projective camera the images of one family's lines
 * stay mutually non-crossing in the visible region, so a detected-line pair
 * from one image orientation family can anchor a MODEL pair from one family
 * — the (2+2)-line rectangle grid: the four pairwise intersections are the
 * image of a known model rectangle, and `solveHomography` closes over the
 * four corner correspondences. The full-pitch boundary quad (touchlines ×
 * goal lines) is the special case (0, 105) x (0, 68).
 */
const MODEL_X_FAMILY: readonly number[] = [
  0,
  GOAL_AREA_FRONT_X,
  PENALTY_FRONT_X,
  52.5,
  105 - PENALTY_FRONT_X,
  105 - GOAL_AREA_FRONT_X,
  105,
];
const MODEL_Y_FAMILY: readonly number[] = [
  0,
  34 - PENALTY_HALF_HEIGHT,
  34 - GOAL_AREA_HALF_HEIGHT,
  34 + GOAL_AREA_HALF_HEIGHT,
  34 + PENALTY_HALF_HEIGHT,
  68,
];

/** Image-orientation family split: theta (line NORMAL angle) in degrees. */
function lineThetaDegrees(line: HoughLine): number {
  return (line.theta * 180) / Math.PI;
}
/** `true` when the line's DIRECTION is near-horizontal (normal 40°-140°). */
function isHorizontalish(line: HoughLine): boolean {
  const deg = lineThetaDegrees(line);
  return deg >= 40 && deg <= 140;
}
/**
 * Angle between two lines' DIRECTIONS (degrees, [0, 90]). Lines whose
 * directions differ by less than the hypothesis guard never form a
 * rectangle grid — near-parallel families are the documented degeneracy
 * the boundary-only search fell into on real partial-visibility masks.
 */
function lineDirectionAngle(line: HoughLine): number {
  return lineThetaDegrees(line) + 90;
}
function directionAngleDelta(a: number, b: number): number {
  let delta = Math.abs(((a - b) % 180) + 180) % 180;
  if (delta > 90) delta = 180 - delta;
  return delta;
}

/**
 * Aspect-ratio consistency (the model-pair prune): the ratio of the two
 * image side lengths of the corner grid must be within a factor of
 * `ASPECT_TOLERANCE` of the model rectangle's side ratio — perspective
 * warps aspect, but not by unbounded factors within one view.
 */
const ASPECT_TOLERANCE = 1.2;
function aspectIsConsistent(
  imageSideA: number,
  imageSideB: number,
  modelSideA: number,
  modelSideB: number,
): boolean {
  if (imageSideA <= 1e-6 || imageSideB <= 1e-6 || modelSideA <= 0 || modelSideB <= 0) return false;
  return Math.abs(Math.log(imageSideA / imageSideB) - Math.log(modelSideA / modelSideB)) <= ASPECT_TOLERANCE;
}

/** Hypothesis families: max lines per orientation family entering the search. */
const FAMILY_MAX_LINES = 6;
/** Hypothesis guard: minimum direction angle between the two line pairs. */
const FAMILY_MIN_ANGLE_DEG = 20;
/** Quick-score subsample (points) during hypothesis enumeration. */
const QUICK_SCORE_POINTS = 96;
/** Hypotheses promoted from quick score to the full-score pass. */
const HYPOTHESIS_FINALISTS = 8;
/** Projection-spread guard (the anti-collapse guard, meters). */
const SPREAD_MIN_X_M = 20;
const SPREAD_MIN_Y_M = 8;
/** Quick green-containment floor during enumeration. */
const QUICK_GREEN_MIN = 0.35;

// ---------------------------------------------------------------------------
// The candidate.
// ---------------------------------------------------------------------------

/**
 * The W303-class broadcast-line field calibrator (the R606 fix path).
 *
 * Construct with options; call {@link calibrate} with the frame sequence —
 * the pixels are the evidence (the input's optional `cornerSet` is IGNORED
 * by this candidate, documented: it detects its own anchors). The input
 * sequence must share one frame size (media-derived input is untrusted —
 * a mismatch refuses loudly with `InvalidAdapterInputError`).
 */
export class BroadcastLineCalibrator implements PitchCalibrationAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = BROADCAST_LINE_FIELD_CALIBRATOR_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] =
    BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = BROADCAST_LINE_FIELD_CALIBRATOR_RESOURCES;
  readonly calibratorId: string;
  private readonly minPitchFraction: number;
  private readonly lineContrastThreshold: number;

  constructor(options: BroadcastLineCalibratorOptions = {}) {
    const calibratorId = options.calibratorId ?? BROADCAST_LINE_DEFAULTS.calibratorId;
    const minPitchFraction = options.minPitchFraction ?? BROADCAST_LINE_DEFAULTS.minPitchFraction;
    const lineContrastThreshold =
      options.lineContrastThreshold ?? BROADCAST_LINE_DEFAULTS.lineContrastThreshold;
    if (typeof calibratorId !== "string" || calibratorId.length < 1) {
      throw new RangeError("BroadcastLineCalibrator: calibratorId must be a non-empty string");
    }
    if (!Number.isFinite(minPitchFraction) || minPitchFraction <= 0 || minPitchFraction > 1) {
      throw new RangeError(
        `BroadcastLineCalibrator: minPitchFraction must be in (0, 1] (got ${minPitchFraction})`,
      );
    }
    if (!Number.isFinite(lineContrastThreshold) || lineContrastThreshold <= 0) {
      throw new RangeError(
        `BroadcastLineCalibrator: lineContrastThreshold must be > 0 (got ${lineContrastThreshold})`,
      );
    }
    this.calibratorId = calibratorId;
    this.minPitchFraction = minPitchFraction;
    this.lineContrastThreshold = lineContrastThreshold;
    this.descriptor = perceptionDescriptor({
      technologyId: BROADCAST_LINE_FIELD_CALIBRATOR_ID,
      technologyVersion: BROADCAST_LINE_FIELD_CALIBRATOR_VERSION,
      adapterVersion: BROADCAST_LINE_FIELD_CALIBRATOR_ADAPTER_VERSION,
      task: "perception.pitch-calibration",
      inputContract: "contracts/normalized-video-frame-sequence@1",
      outputContract: "contracts/observation.field-mapping@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.pitch-calibration");
  }

  calibrate(input: PitchCalibrationInput): CalibrationResult {
    // -- 0. Input shape (untrusted media input, architecture-lock §13). ------
    if (input.frames.length === 0) {
      throw new CandidateFailureError(
        "BroadcastLineCalibrator: an empty frame sequence carries no line evidence",
        { failureClassId: "broadcast-line.insufficient-line-evidence" },
      );
    }
    const width = input.frames[0]!.width;
    const height = input.frames[0]!.height;
    if (width <= 1 || height <= 1) {
      throw new CandidateFailureError(
        "BroadcastLineCalibrator: frame too small to carry line evidence",
        { failureClassId: "broadcast-line.no-pitch-visible", width, height },
      );
    }
    for (const frame of input.frames) {
      if (frame.width !== width || frame.height !== height) {
        throw new RangeError(
          `BroadcastLineCalibrator: all frames must share one size (got ${frame.width}x${frame.height} ` +
            `after ${width}x${height}) — the masks are dimension-bound`,
        );
      }
    }
    const frameCount = input.frames.length;
    const anchorIndex = Math.floor((frameCount - 1) / 2);
    const anchorFrame = input.frames[anchorIndex]!;

    // -- 1. Green union (players' holes filled by the union; dilation fills
    //       the static white line holes + gives boundary lines a margin). ---
    const greenMasks = input.frames.map((frame) => greenMaskOf(frame));
    const union = new Uint8Array(width * height);
    let unionCount = 0;
    for (const mask of greenMasks) {
      for (let i = 0; i < union.length; i += 1) {
        if (mask[i] !== 0 && union[i] === 0) {
          union[i] = 1;
          unionCount += 1;
        }
      }
    }
    const unionFraction = unionCount / (width * height);
    if (unionFraction < this.minPitchFraction) {
      throw new CandidateFailureError(
        `BroadcastLineCalibrator: green-union fraction ${unionFraction.toFixed(4)} below the ` +
          `minimum ${this.minPitchFraction} — not enough pitch in view to calibrate honestly`,
        { failureClassId: "broadcast-line.no-pitch-visible", unionFraction },
      );
    }
    const dilatedUnion = dilate3x3(union, width, height, GREEN_UNION_DILATIONS);

    // -- 2. Motion estimation against the anchor (the static-camera check
    //       WITH compensation; panning beyond ±40 px refuses). --------------
    const anchorProfiles = greenProfiles(greenMasks[anchorIndex]!, width, height);
    const anchorColumn = boxSmooth9(anchorProfiles.column);
    const anchorRow = boxSmooth9(anchorProfiles.row);
    const dxs: number[] = [];
    const dys: number[] = [];
    for (const mask of greenMasks) {
      const profiles = greenProfiles(mask, width, height);
      dxs.push(bestProfileShift(boxSmooth9(profiles.column), anchorColumn, MOTION_SEARCH_LIMIT_PX));
      dys.push(bestProfileShift(boxSmooth9(profiles.row), anchorRow, MOTION_SEARCH_LIMIT_PX));
    }
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (Math.abs(dxs[frame]!) > MOTION_REFUSAL_LIMIT_PX || Math.abs(dys[frame]!) > MOTION_REFUSAL_LIMIT_PX) {
        throw new CandidateFailureError(
          `BroadcastLineCalibrator: frame ${frame} content shift (${dxs[frame]}, ${dys[frame]}) px ` +
            `against the anchor exceeds the ±${MOTION_REFUSAL_LIMIT_PX} px compensation envelope — ` +
            `a panning camera; the candidate requires a static window`,
          {
            failureClassId: "broadcast-line.camera-motion",
            frame,
            dx: dxs[frame]!,
            dy: dys[frame]!,
          },
        );
      }
    }

    // -- 3+4. Per-frame local-contrast masks, motion-compensated into anchor
    //         coordinates, dilated, counted; static mask = >= 50% of frames.
    const counts = new Uint16Array(width * height);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const lineMask = lineMaskOf(input.frames[frame]!, dilatedUnion, this.lineContrastThreshold);
      const compensated = shiftMask(lineMask, width, height, dxs[frame]!, dys[frame]!);
      const dilated = dilate3x3(compensated, width, height, MASK_DILATIONS);
      for (let i = 0; i < counts.length; i += 1) {
        if (dilated[i] !== 0) counts[i] += 1;
      }
    }
    const staticMask = new Uint8Array(width * height);
    const staticPixels: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (counts[index]! / frameCount >= STATIC_MASK_THRESHOLD) {
          staticMask[index] = 1;
          staticPixels.push(x, y);
        }
      }
    }
    if (staticPixels.length / 2 < MIN_STATIC_LINE_PIXELS) {
      throw new CandidateFailureError(
        `BroadcastLineCalibrator: static line mask carries only ${staticPixels.length / 2} px ` +
          `(minimum ${MIN_STATIC_LINE_PIXELS}) — insufficient line evidence for a homography search`,
        { failureClassId: "broadcast-line.insufficient-line-evidence", staticPixels: staticPixels.length / 2 },
      );
    }

    // -- 5. Hough lines. -----------------------------------------------------
    const lines = houghExtractLines(staticPixels, width, height);
    const horizontalCount = lines.filter((line) => isHorizontalish(line)).length;
    const verticalCount = lines.length - horizontalCount;
    if (horizontalCount < 2 || verticalCount < 2) {
      throw new CandidateFailureError(
        `BroadcastLineCalibrator: Hough families carry ${horizontalCount} near-horizontal and ` +
          `${verticalCount} near-vertical lines — the (2+2)-line rectangle-grid search needs at ` +
          `least two of each (partial-visibility views whose boundary/interior lines of one ` +
          `orientation are all sub-threshold refuse honestly)`,
        {
          failureClassId: "broadcast-line.no-consistent-homography",
          detectedLines: lines.length,
          horizontalCount,
          verticalCount,
        },
      );
    }

    // -- 6. Scored static set + hoardings suppression + the search. ----------
    // Per-column top edge of the dilated green union; rows above (top + 4)
    // are hoardings and never score. Columns with no green exclude all.
    const greenTop = new Int32Array(width).fill(height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (dilatedUnion[y * width + x] !== 0 && greenTop[x]! === height) {
          greenTop[x] = y;
        }
      }
    }
    const scoredFull: number[] = [];
    for (let p = 0; p < staticPixels.length; p += 2) {
      const x = staticPixels[p]!;
      const y = staticPixels[p + 1]!;
      if (y >= greenTop[x]! + HOARDINGS_ROW_MARGIN) {
        scoredFull.push(x / width, y / height);
      }
    }
    // Deterministic row-major strided subsample for search + refinement.
    const pointCount = scoredFull.length / 2;
    const stride = Math.max(1, Math.ceil(pointCount / SEARCH_SCORE_MAX_POINTS));
    const scoredSub: number[] = [];
    for (let point = 0; point < pointCount; point += stride) {
      scoredSub.push(scoredFull[point * 2]!, scoredFull[point * 2 + 1]!);
    }
    // Green-union pixels (row-major) with the same strided subsampling.
    const greenPixels: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (dilatedUnion[y * width + x] !== 0) greenPixels.push(x / width, y / height);
      }
    }
    const greenStride = Math.max(1, Math.ceil(greenPixels.length / 2 / GREEN_SAMPLE_MAX_POINTS));
    const greenSub: number[] = [];
    for (let point = 0; point < greenPixels.length / 2; point += greenStride) {
      greenSub.push(greenPixels[point * 2]!, greenPixels[point * 2 + 1]!);
    }

    const best = this.searchFamilyHypotheses(lines, width, height, scoredSub, greenSub);
    if (best === undefined) {
      throw new CandidateFailureError(
        "BroadcastLineCalibrator: no family hypothesis survived the guards (quad sanity, " +
          "direction-angle spread, aspect consistency, projection spread, green containment) " +
          "over any (2+2)-line rectangle grid — no consistent homography on this evidence",
        { failureClassId: "broadcast-line.no-consistent-homography", detectedLines: lines.length },
      );
    }

    // -- 7. Refinement: coordinate descent on forward + backward + green. ----
    const chamfer = chamferDistanceTransform(staticMask, width, height);
    const modelSamples = pitchModelSamplePoints();
    const chamferAt = (u: number, v: number): number => {
      const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
      const y = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
      return chamfer[y * width + x]!;
    };
    const forwardScore = (h: Homography): number => {
      if (scoredSub.length === 0) return 0;
      let inliers = 0;
      for (let p = 0; p < scoredSub.length; p += 2) {
        const projected = projectSafe(h, scoredSub[p]!, scoredSub[p + 1]!);
        if (projected !== undefined && modelDistanceAt(projected.x, projected.y) <= SCORE_RADIUS_M) {
          inliers += 1;
        }
      }
      return inliers / (scoredSub.length / 2);
    };
    const objective = (h: Homography): number => {
      if (!h.every((value) => Number.isFinite(value))) return Number.NEGATIVE_INFINITY;
      let inverse: Homography;
      try {
        inverse = invertHomography(h);
      } catch {
        return Number.NEGATIVE_INFINITY;
      }
      const forward = forwardScore(h);
      let reward = 0;
      let inFrame = 0;
      for (let p = 0; p < modelSamples.length; p += 2) {
        const projected = projectSafe(inverse, modelSamples[p]!, modelSamples[p + 1]!);
        if (projected === undefined) continue;
        if (projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) continue;
        inFrame += 1;
        reward += Math.min(1, Math.max(0, 1 - chamferAt(projected.x, projected.y) / VALIDATION_BACKWARD_MAX_PX));
      }
      const backwardReward = inFrame > 0 ? reward / inFrame : 0;
      let contained = 0;
      for (let p = 0; p < greenSub.length; p += 2) {
        const projected = projectSafe(h, greenSub[p]!, greenSub[p + 1]!);
        if (
          projected !== undefined &&
          projected.x >= -GREEN_CONTAINMENT_MARGIN_M &&
          projected.x <= PITCH_LENGTH + GREEN_CONTAINMENT_MARGIN_M &&
          projected.y >= -GREEN_CONTAINMENT_MARGIN_M &&
          projected.y <= PITCH_WIDTH + GREEN_CONTAINMENT_MARGIN_M
        ) {
          contained += 1;
        }
      }
      const greenFraction = greenSub.length > 0 ? contained / (greenSub.length / 2) : 0;
      return forward + backwardReward + greenFraction;
    };
    let refined = [...best.homography];
    let currentScore = objective(refined);
    const steps = refined.map((value) =>
      Math.max(Math.abs(value) * REFINEMENT_STEP_FRACTION, REFINEMENT_STEP_FLOOR),
    );
    for (let round = 0; round < REFINEMENT_ROUNDS; round += 1) {
      for (let parameter = 0; parameter < 8; parameter += 1) {
        if (steps[parameter]! <= 1e-12) continue;
        const up = [...refined];
        up[parameter] = up[parameter]! + steps[parameter]!;
        const upScore = objective(up);
        if (upScore > currentScore) {
          refined = up;
          currentScore = upScore;
          continue;
        }
        const down = [...refined];
        down[parameter] = down[parameter]! - steps[parameter]!;
        const downScore = objective(down);
        if (downScore > currentScore) {
          refined = down;
          currentScore = downScore;
          continue;
        }
        steps[parameter] = steps[parameter]! / 2;
      }
    }

    // -- 8. Validation over the FULL scored set + honest confidence. ---------
    let inliers = 0;
    for (let p = 0; p < scoredFull.length; p += 2) {
      const projected = projectSafe(refined, scoredFull[p]!, scoredFull[p + 1]!);
      if (projected !== undefined && modelDistanceAt(projected.x, projected.y) <= SCORE_RADIUS_M) {
        inliers += 1;
      }
    }
    const lineFit = scoredFull.length > 0 ? inliers / (scoredFull.length / 2) : 0;
    let inverse: Homography;
    try {
      inverse = invertHomography(refined);
    } catch {
      throw new CandidateFailureError(
        "BroadcastLineCalibrator: the refined homography is not invertible to image coordinates — " +
          "refusing rather than emit an unmappable calibration",
        { failureClassId: "broadcast-line.no-consistent-homography", lineFit },
      );
    }
    let backwardSum = 0;
    let backwardCount = 0;
    for (let p = 0; p < modelSamples.length; p += 2) {
      const projected = projectSafe(inverse, modelSamples[p]!, modelSamples[p + 1]!);
      if (projected === undefined) continue;
      if (projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) continue;
      backwardCount += 1;
      backwardSum += chamferAt(projected.x, projected.y);
    }
    const backward = backwardCount > 0 ? backwardSum / backwardCount : Number.POSITIVE_INFINITY;
    if (lineFit < VALIDATION_LINE_FIT_MIN || backward > VALIDATION_BACKWARD_MAX_PX) {
      throw new CandidateFailureError(
        `BroadcastLineCalibrator: refined homography failed validation (lineFit ${lineFit.toFixed(3)} ` +
          `< ${VALIDATION_LINE_FIT_MIN}, backward ${backwardCount > 0 ? backward.toFixed(2) : "∞"} px > ` +
          `${VALIDATION_BACKWARD_MAX_PX}) — not good enough to project with; refusing honestly`,
        {
          failureClassId: "broadcast-line.no-consistent-homography",
          lineFit,
          backwardPx: backwardCount > 0 ? backward : undefined,
          scoredPixels: scoredFull.length / 2,
        },
      );
    }
    const confidence = Math.min(
      1,
      Math.max(0, 0.25 + 0.45 * lineFit + 0.3 * Math.max(0, 1 - backward / VALIDATION_BACKWARD_MAX_PX)),
    );

    // -- 9. Output: refined H, canonical corners back through H⁻¹. -----------
    const imageCorners: Point2D[] = [];
    for (const pitchCorner of CANONICAL_PITCH_CORNERS) {
      imageCorners.push(applyHomography(inverse, { x: pitchCorner.x, y: pitchCorner.y }));
    }
    const cornerSet: FieldCornerSet = {
      corners: [
        imageCorners[0]!,
        imageCorners[1]!,
        imageCorners[2]!,
        imageCorners[3]!,
      ],
      cornerOrder: "tl, tr, br, bl",
      confidence,
    };
    const mapping: FieldMappingPayload = {
      kind: "field-mapping",
      pitchCorners: imageCorners.map((corner) => ({ x: corner.x, y: corner.y })),
      cameraHomographyRef: `homography-${this.calibratorId}-${anchorFrame.frameId}`,
    };
    return {
      mapping,
      homography: refined,
      cornerSet,
      confidence,
      correspondenceCount: 4,
    };
  }

  /**
   * The step-6 GENERALIZED family hypothesis search. Detected lines split
   * into two image-orientation families (near-horizontal / near-vertical);
   * each family anchors a MODEL line family (x-const / y-const — both
   * assignments tried: the swap covers behind-goal / rotated cameras). For
   * every (2 detected H-lines x 2 detected V-lines) pair combination whose
   * directions differ by >= FAMILY_MIN_ANGLE_DEG and whose corner-grid quad
   * passes the sanity check, every model pair from both families with an
   * aspect-consistent rectangle and every line-identity orientation solves
   * a W203 `solveHomography` over the four grid-corner correspondences.
   * Every solved hypothesis passes the ANTI-COLLAPSE guards (projection
   * spread over the scored subsample; quick green containment) and a
   * QUICK forward score (first QUICK_SCORE_POINTS scored points); the
   * HYPOTHESIS_FINALISTS best by quick score get the FULL forward score.
   * Deterministic: strict `>` acceptance — the FIRST hypothesis in
   * enumeration order wins ties; enumeration order is (swap, H-pair,
   * V-pair, model pair, orientation), all in index order.
   */
  private searchFamilyHypotheses(
    lines: readonly HoughLine[],
    width: number,
    height: number,
    scoredSub: readonly number[],
    greenSub: readonly number[],
  ): { homography: Homography; score: number } | undefined {
    // Family split + per-family caps (top votes first — the strongest
    // evidence anchors first; index order breaks vote ties).
    const horizontal: HoughLine[] = [];
    const vertical: HoughLine[] = [];
    for (const line of lines) {
      if (isHorizontalish(line)) horizontal.push(line);
      else vertical.push(line);
    }
    horizontal.sort((a, b) => b.votes - a.votes);
    vertical.sort((a, b) => b.votes - a.votes);
    const familyH = horizontal.slice(0, FAMILY_MAX_LINES);
    const familyV = vertical.slice(0, FAMILY_MAX_LINES);

    // Quick-scoring sets: EVEN strided subsamples spanning the whole scored
    // set (a row-major PREFIX would score only the top rows — the far
    // touchline region that near-degenerate hypotheses also align, which
    // tied every finalist at the same quick score and starved the correct
    // hypothesis; measured on the synthetic recovery fixture).
    const quickStride = Math.max(1, Math.ceil(scoredSub.length / 2 / QUICK_SCORE_POINTS));
    const quickPoints: number[] = [];
    for (let point = 0; point * quickStride < scoredSub.length / 2; point += 1) {
      const index = point * quickStride * 2;
      quickPoints.push(scoredSub[index]!, scoredSub[index + 1]!);
    }
    const quickGreen = greenSub.slice(0, 32 * 2);

    // Finalists by quick score (bounded insertion, deterministic order).
    const finalists: Array<{ homography: Homography; quick: number }> = [];
    const pushFinalist = (homography: Homography, quick: number): void => {
      if (quick <= 0) return;
      if (finalists.length < HYPOTHESIS_FINALISTS) {
        finalists.push({ homography, quick });
        return;
      }
      let worstIndex = 0;
      for (let i = 1; i < finalists.length; i += 1) {
        if (finalists[i]!.quick < finalists[worstIndex]!.quick) worstIndex = i;
      }
      if (quick > finalists[worstIndex]!.quick) {
        finalists[worstIndex] = { homography, quick };
      }
    };

    for (let swap = 0; swap < 2; swap += 1) {
      // swap=0: image-horizontal family <-> model y-family (the elevated
      // sideline-camera geometry); swap=1: <-> model x-family (behind-goal
      // and rotated views). The OTHER image family takes the other model
      // family in both cases.
      const modelFamilyForH = swap === 0 ? MODEL_Y_FAMILY : MODEL_X_FAMILY;
      const modelFamilyForV = swap === 0 ? MODEL_X_FAMILY : MODEL_Y_FAMILY;
      for (let hA = 0; hA < familyH.length; hA += 1) {
        for (let hB = hA + 1; hB < familyH.length; hB += 1) {
          const lineHA = familyH[hA]!;
          const lineHB = familyH[hB]!;
          for (let vA = 0; vA < familyV.length; vA += 1) {
            for (let vB = vA + 1; vB < familyV.length; vB += 1) {
              const lineVA = familyV[vA]!;
              const lineVB = familyV[vB]!;
              // Angle guard: the two pairs' directions must differ.
              const angleH = lineDirectionAngle(lineHA);
              const angleV = lineDirectionAngle(lineVA);
              if (directionAngleDelta(angleH, angleV) < FAMILY_MIN_ANGLE_DEG) continue;
              // The four grid corners (pixel coords), computed once per
              // (H-pair, V-pair): c00 = HA x VA, c01 = HA x VB,
              // c11 = HB x VB, c10 = HB x VA.
              const c00 = intersectHoughLines(lineHA, lineVA);
              const c01 = intersectHoughLines(lineHA, lineVB);
              const c11 = intersectHoughLines(lineHB, lineVB);
              const c10 = intersectHoughLines(lineHB, lineVA);
              if (c00 === undefined || c01 === undefined || c11 === undefined || c10 === undefined) {
                continue;
              }
              const cornersPx: readonly Point2D[] = [c00, c01, c11, c10];
              const sideH0 = Math.hypot(c01.x - c00.x, c01.y - c00.y);
              const sideH1 = Math.hypot(c11.x - c10.x, c11.y - c10.y);
              const sideV0 = Math.hypot(c10.x - c00.x, c10.y - c00.y);
              const sideV1 = Math.hypot(c11.x - c01.x, c11.y - c01.y);
              const imageSideH = Math.max(sideH0, sideH1);
              const imageSideV = Math.max(sideV0, sideV1);
              // Model pairs (both orders handled by the orientation loop).
              for (let mA = 0; mA < modelFamilyForH.length; mA += 1) {
                for (let mB = mA + 1; mB < modelFamilyForH.length; mB += 1) {
                  const valueH0 = modelFamilyForH[mA]!;
                  const valueH1 = modelFamilyForH[mB]!;
                  const spanH = Math.abs(valueH1 - valueH0);
                  for (let mC = 0; mC < modelFamilyForV.length; mC += 1) {
                    for (let mD = mC + 1; mD < modelFamilyForV.length; mD += 1) {
                      const valueV0 = modelFamilyForV[mC]!;
                      const valueV1 = modelFamilyForV[mD]!;
                      const spanV = Math.abs(valueV1 - valueV0);
                      // Aspect prune (the image grid vs the model rectangle).
                      if (!aspectIsConsistent(imageSideH, imageSideV, spanH, spanV)) continue;
                      // Orientations: which detected line anchors the
                      // smaller model value in each family (4 combinations).
                      for (let flipH = 0; flipH < 2; flipH += 1) {
                        for (let flipV = 0; flipV < 2; flipV += 1) {
                          // The two documented ordering priors (the same
                          // "elevated main-camera" convention the line-based
                          // candidate documents): (a) the model-FAR (larger
                          // y) line sits HIGHER in the image than the
                          // model-NEAR one; (b) the model-LARGER-x line sits
                          // RIGHT of the smaller-x one. Without (b) the
                          // mirror-symmetric line evidence cannot resolve
                          // x <-> 105-x and the search picks mirrored
                          // homographies with the same forward score
                          // (measured: 0.817 vs the truth's symmetry).
                          const lineForSmallModelValue = flipH === 0 ? lineHA : lineHB;
                          const lineForLargeModelValue = flipH === 0 ? lineHB : lineHA;
                          if (swap === 0) {
                            // H family anchors the model y-family: far line above.
                            if (lineForLargeModelValue.meanY >= lineForSmallModelValue.meanY) continue;
                          } else {
                            // H family anchors the model x-family: larger-x right.
                            if (lineForLargeModelValue.meanX <= lineForSmallModelValue.meanX) continue;
                          }
                          const vLineForSmallModelValue = flipV === 0 ? lineVA : lineVB;
                          const vLineForLargeModelValue = flipV === 0 ? lineVB : lineVA;
                          if (swap === 0) {
                            // V family anchors the model x-family: larger-x right.
                            if (vLineForLargeModelValue.meanX <= vLineForSmallModelValue.meanX) continue;
                          } else {
                            // V family anchors the model y-family: far line above.
                            if (vLineForLargeModelValue.meanY >= vLineForSmallModelValue.meanY) continue;
                          }
                          // The corner pairing in canonical order
                          // (small-x,small-y), (large-x,small-y), (large-x,large-y), (small-x,large-y).
                          // Whichever family anchors the model X coordinate supplies the
                          // X-lines (small/large by the flip); the other family supplies the
                          // Y-lines. Corner (i, j) = Y-line_i x X-line_j — the grid, in
                          // canonical traversal order.
                          const lineXSmall = swap === 0
                            ? (flipV === 0 ? lineVA : lineVB)
                            : (flipH === 0 ? lineHA : lineHB);
                          const lineXLarge = swap === 0
                            ? (flipV === 0 ? lineVB : lineVA)
                            : (flipH === 0 ? lineHB : lineHA);
                          const lineYSmall = swap === 0
                            ? (flipH === 0 ? lineHA : lineHB)
                            : (flipV === 0 ? lineVA : lineVB);
                          const lineYLarge = swap === 0
                            ? (flipH === 0 ? lineHB : lineHA)
                            : (flipV === 0 ? lineVB : lineVA);
                          const cornerPx: Array<Point2D | undefined> = [
                            intersectHoughLines(lineYSmall, lineXSmall),
                            intersectHoughLines(lineYSmall, lineXLarge),
                            intersectHoughLines(lineYLarge, lineXLarge),
                            intersectHoughLines(lineYLarge, lineXSmall),
                          ];
                          if (cornerPx.some((corner) => corner === undefined)) continue;
                          const imageCorners: Point2D[] = cornerPx.map((corner) =>
                            normalized(corner!, width, height),
                          );
                          const xSmallValue = swap === 0
                            ? (flipV === 0 ? valueV0 : valueV1)
                            : (flipH === 0 ? valueH0 : valueH1);
                          const xLargeValue = swap === 0
                            ? (flipV === 0 ? valueV1 : valueV0)
                            : (flipH === 0 ? valueH1 : valueH0);
                          const ySmallValue = swap === 0
                            ? (flipH === 0 ? valueH0 : valueH1)
                            : (flipV === 0 ? valueV0 : valueV1);
                          const yLargeValue = swap === 0
                            ? (flipH === 0 ? valueH1 : valueH0)
                            : (flipV === 0 ? valueV1 : valueV0);
                          const pitchCorners: PitchPoint[] = [
                            { x: xSmallValue, y: ySmallValue },
                            { x: xLargeValue, y: ySmallValue },
                            { x: xLargeValue, y: yLargeValue },
                            { x: xSmallValue, y: yLargeValue },
                          ];
                          if (!quadIsSane(imageCorners)) continue;
                          let homography: Homography;
                          try {
                            homography = solveHomography(imageCorners, pitchCorners);
                          } catch {
                            continue;
                          }
                          // Anti-collapse guards + quick score.
                          if (!this.passesQuickGuards(homography, quickPoints, quickGreen)) continue;
                          const quick = this.forwardScoreOn(homography, quickPoints);
                          pushFinalist(homography, quick);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    let best: { homography: Homography; score: number } | undefined;
    for (const finalist of finalists) {
      const score = this.forwardScoreOn(finalist.homography, scoredSub);
      if (best === undefined || score > best.score) {
        best = { homography: finalist.homography, score };
      }
    }
    return best;
  }

  /**
   * The anti-collapse quick guards: the scored static evidence must project
   * SPREAD over a real pitch extent (>= SPREAD_MIN_X_M x SPREAD_MIN_Y_M —
   * degenerate solutions that collapse the image onto one dense line
   * cluster fail here), and the quick green-containment floor. The collapse
   * failure class is the measured real-mask degeneracy of the un-guarded
   * score (a solution mapping everything near the x=105 goal-area line
   * cluster scores ~1.0 forward but is geometric garbage).
   */
  private passesQuickGuards(
    homography: Homography,
    quickPoints: readonly number[],
    quickGreen: readonly number[],
  ): boolean {
    if (quickPoints.length === 0) return false;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let p = 0; p < quickPoints.length; p += 2) {
      const projected = projectSafe(homography, quickPoints[p]!, quickPoints[p + 1]!);
      if (projected === undefined) continue;
      if (projected.x < minX) minX = projected.x;
      if (projected.x > maxX) maxX = projected.x;
      if (projected.y < minY) minY = projected.y;
      if (projected.y > maxY) maxY = projected.y;
    }
    if (maxX - minX < SPREAD_MIN_X_M || maxY - minY < SPREAD_MIN_Y_M) return false;
    if (quickGreen.length === 0) return true;
    let contained = 0;
    for (let p = 0; p < quickGreen.length; p += 2) {
      const projected = projectSafe(homography, quickGreen[p]!, quickGreen[p + 1]!);
      if (
        projected !== undefined &&
        projected.x >= -GREEN_CONTAINMENT_MARGIN_M &&
        projected.x <= PITCH_LENGTH + GREEN_CONTAINMENT_MARGIN_M &&
        projected.y >= -GREEN_CONTAINMENT_MARGIN_M &&
        projected.y <= PITCH_WIDTH + GREEN_CONTAINMENT_MARGIN_M
      ) {
        contained += 1;
      }
    }
    return contained / (quickGreen.length / 2) >= QUICK_GREEN_MIN;
  }

  /** Forward score over a normalized `[u, v, ...]` point list. */
  private forwardScoreOn(homography: Homography, points: readonly number[]): number {
    if (points.length === 0) return 0;
    let inliers = 0;
    for (let p = 0; p < points.length; p += 2) {
      const projected = projectSafe(homography, points[p]!, points[p + 1]!);
      if (projected !== undefined && modelDistanceAt(projected.x, projected.y) <= SCORE_RADIUS_M) {
        inliers += 1;
      }
    }
    return inliers / (points.length / 2);
  }
}
