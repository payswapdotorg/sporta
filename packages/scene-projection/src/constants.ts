/**
 * Explicit scene constants of the W601 scene projection contract.
 *
 * Every value here is either an IFAB Laws-of-the-Game dimension (Law 1, The
 * Field of Play, standard pitch) or a camera-slot construction derived from
 * the canonical pitch frame — all documented inline. These are GEOMETRIC
 * CONSTANTS of the scene specification, not match data: they never vary per
 * snapshot, they are pinned by the schema literals / goldens, and their
 * version is recorded in the spec (`furniture.constantsVersion`,
 * `CAMERA_SLOT_SET_VERSION`) so a consumer can attribute a constant to a
 * named constant set (rule S2: no invented data — verbatim SWM values OR
 * explicit documented constants, never anything else).
 *
 * G7 boundary (roadmap): the constants describe GEOMETRY ONLY — there are no
 * asset references, no branding, no proprietary game dimensions; the pitch
 * furniture is the public Laws-of-the-Game standard.
 */
import {
  PITCH_LENGTH_AXIS_METERS,
  PITCH_WIDTH_AXIS_METERS,
  type PitchFrame,
} from "@sporta/contracts";

// ---------------------------------------------------------------------------
// Version ids of the constant sets
// ---------------------------------------------------------------------------

/**
 * Version of the pitch-furniture constant set (IFAB Law 1 dimensions on the
 * canonical 105 × 68 m frame). Bumping this is an additive scene-schema
 * change (MINOR) only when accompanied by new furniture fields; changing a
 * DIMENSION is breaking (MAJOR).
 */
export const FURNITURE_CONSTANTS_VERSION = "ifab-law1-standard@1";

/**
 * Version of the camera-slot constant set. Adding a slot is additive (MINOR
 * bump of the scene schema); moving/renaming a slot is breaking.
 */
export const CAMERA_SLOT_SET_VERSION = "camera-slots@1";

// ---------------------------------------------------------------------------
// IFAB Law 1 dimensions (meters) — the standard pitch furniture
// ---------------------------------------------------------------------------

/** Law 1: distance between the inner edges of the goal posts. */
export const GOAL_WIDTH_METERS = 7.32;

/** Law 1: distance from the lower edge of the crossbar to the ground. */
export const GOAL_HEIGHT_METERS = 2.44;

/** Law 1: goal-area lines extend 5.5 m from each goalpost, 5.5 m into play. */
export const GOAL_AREA_DEPTH_METERS = 5.5;

/** Law 1: penalty-area lines extend 16.5 m from each goalpost, into play. */
export const PENALTY_AREA_DEPTH_METERS = 16.5;

/** Law 1: penalty mark 11 m from the goal-line midpoint. */
export const PENALTY_SPOT_DISTANCE_METERS = 11;

/** Law 1: center circle radius 9.15 m. */
export const CENTER_CIRCLE_RADIUS_METERS = 9.15;

/** Law 1: corner arc radius 1 m. */
export const CORNER_ARC_RADIUS_METERS = 1;

// ---------------------------------------------------------------------------
// Derived half-pitch helpers (pure arithmetic on the canonical frame)
// ---------------------------------------------------------------------------

/** Midpoint of the touchline-length axis (105 / 2). */
export const PITCH_CENTER_X = PITCH_LENGTH_AXIS_METERS / 2;

/** Midpoint of the goal-line width axis (68 / 2). */
export const PITCH_CENTER_Y = PITCH_WIDTH_AXIS_METERS / 2;

/** Goal-line midpoint y = the pitch center y (goals sit on the goal lines). */
export const GOAL_CENTER_Y = PITCH_CENTER_Y;

/** Half the goal width (7.32 / 2), for y ranges around the goal center. */
export const GOAL_HALF_WIDTH_METERS = GOAL_WIDTH_METERS / 2;

/** Goal center height (2.44 / 2) — the target height of behind-goal cameras. */
export const GOAL_CENTER_HEIGHT_METERS = GOAL_HEIGHT_METERS / 2;

// Camera constructions (documented per slot in CAMERA_SLOTS below).

/** How far the touchline cameras stand beyond their touchline. */
export const TOUCHLINE_CAMERA_SETBACK_METERS = 25;

/** Height of the two elevated touchline cameras above the pitch plane. */
export const TOUCHLINE_CAMERA_HEIGHT_METERS = 20;

/** How far the behind-goal cameras stand behind their goal line. */
export const BEHIND_GOAL_CAMERA_SETBACK_METERS = 20;

/** Height of the behind-goal cameras above the pitch plane. */
export const BEHIND_GOAL_CAMERA_HEIGHT_METERS = 8;

/** Height of the aerial tactical camera directly above the pitch center. */
export const AERIAL_CAMERA_HEIGHT_METERS = 60;

// ---------------------------------------------------------------------------
// The canonical camera slots (named positions; W604 directs them)
// ---------------------------------------------------------------------------

/**
 * One named camera slot: a position and aim in scene coordinates, plus the
 * derivation of the construction. Slots are NAMED POSITIONS ONLY — the
 * DIRECTION POLICY (which slot is active when, cuts, replays, emphasis) is
 * W604's concern and is deliberately absent here.
 */
export interface SceneCameraSlotConstant {
  readonly slotId: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly target: { readonly x: number; readonly y: number; readonly z: number };
  readonly derivation: string;
}

/**
 * The canonical camera slot set, in canonical order. The five constructions:
 *
 * 1. `main-touchline` — the classic broadcast position: halfway line, 25 m
 *    beyond the y=0 touchline, 20 m above the plane, aimed at the pitch
 *    center.
 * 2. `opposite-touchline` — the mirror position beyond the y=68 touchline.
 * 3. `behind-goal-x0` — 20 m behind the x=0 goal line, on the goal-line
 *    midpoint, 8 m above the plane, aimed at that goal's center (height
 *    2.44/2 = 1.22 m).
 * 4. `behind-goal-x105` — the mirror position behind the x=105 goal line.
 * 5. `aerial-tactical` — 60 m directly above the pitch center, aimed
 *    straight down (the tactical/analysis view).
 */
export const CANONICAL_CAMERA_SLOTS: readonly SceneCameraSlotConstant[] = [
  {
    slotId: "main-touchline",
    position: {
      x: PITCH_CENTER_X,
      y: -TOUCHLINE_CAMERA_SETBACK_METERS,
      z: TOUCHLINE_CAMERA_HEIGHT_METERS,
    },
    target: { x: PITCH_CENTER_X, y: PITCH_CENTER_Y, z: 0 },
    derivation:
      "halfway line (x=52.5); 25 m beyond the y=0 touchline; 20 m above the pitch plane; aimed at the pitch center (52.5, 34, 0)",
  },
  {
    slotId: "opposite-touchline",
    position: {
      x: PITCH_CENTER_X,
      y: PITCH_WIDTH_AXIS_METERS + TOUCHLINE_CAMERA_SETBACK_METERS,
      z: TOUCHLINE_CAMERA_HEIGHT_METERS,
    },
    target: { x: PITCH_CENTER_X, y: PITCH_CENTER_Y, z: 0 },
    derivation:
      "halfway line (x=52.5); 25 m beyond the y=68 touchline (68+25=93); 20 m above the pitch plane; aimed at the pitch center (52.5, 34, 0)",
  },
  {
    slotId: "behind-goal-x0",
    position: {
      x: -BEHIND_GOAL_CAMERA_SETBACK_METERS,
      y: GOAL_CENTER_Y,
      z: BEHIND_GOAL_CAMERA_HEIGHT_METERS,
    },
    target: { x: 0, y: GOAL_CENTER_Y, z: GOAL_CENTER_HEIGHT_METERS },
    derivation:
      "20 m behind the x=0 goal line; goal-line midpoint (y=34); 8 m above the pitch plane; aimed at the goal center (0, 34, 1.22)",
  },
  {
    slotId: "behind-goal-x105",
    position: {
      x: PITCH_LENGTH_AXIS_METERS + BEHIND_GOAL_CAMERA_SETBACK_METERS,
      y: GOAL_CENTER_Y,
      z: BEHIND_GOAL_CAMERA_HEIGHT_METERS,
    },
    target: { x: PITCH_LENGTH_AXIS_METERS, y: GOAL_CENTER_Y, z: GOAL_CENTER_HEIGHT_METERS },
    derivation:
      "20 m behind the x=105 goal line (105+20=125); goal-line midpoint (y=34); 8 m above the pitch plane; aimed at the goal center (105, 34, 1.22)",
  },
  {
    slotId: "aerial-tactical",
    position: { x: PITCH_CENTER_X, y: PITCH_CENTER_Y, z: AERIAL_CAMERA_HEIGHT_METERS },
    target: { x: PITCH_CENTER_X, y: PITCH_CENTER_Y, z: 0 },
    derivation:
      "60 m directly above the pitch center (52.5, 34); aimed straight down at the pitch center (the tactical/analysis view)",
  },
];

/** The camera slot ids, in canonical order. */
export const CAMERA_SLOT_IDS: readonly string[] = CANONICAL_CAMERA_SLOTS.map((slot) => slot.slotId);

// ---------------------------------------------------------------------------
// Canonical pitch frame (verbatim shape of the contracts PitchFrame)
// ---------------------------------------------------------------------------

/**
 * The canonical pitch frame as carried by the scene when the snapshot has no
 * football state: identical to the contracts constants (the frame is locked
 * by `PitchFrame`'s zod literals, so this is the same document every
 * contract-valid football state carries — recorded with
 * `frameSource: "contracts-constant"` instead of `"snapshot-football"`).
 */
export const CANONICAL_PITCH_FRAME: PitchFrame = {
  lengthAxisMeters: PITCH_LENGTH_AXIS_METERS,
  widthAxisMeters: PITCH_WIDTH_AXIS_METERS,
  origin: "corner",
  axes: "x=touchline, y=goal-line",
};
