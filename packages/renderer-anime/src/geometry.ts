/**
 * Pitch-space → SVG-canvas mapping for the anime prototype (W502).
 *
 * ## The mapping (documented math, never clamped)
 *
 * The canonical football pitch frame (`@sporta/contracts` `PitchFrame`) is
 * 105 m along x (touchline) × 68 m along y (goal line), origin at a corner.
 * The SVG canvas is 1170 × 880 units:
 *
 * - `SCALE = 10` SVG units per meter;
 * - `MARGIN = 60` units (6 m) of grass on every side of the pitch — the
 *   out-of-play allowance where honestly-out-of-bounds markers still draw;
 * - the pitch rectangle therefore spans canvas x `[60, 1110]`, y `[60, 740]`;
 * - the caption band occupies canvas y `[800, 880]` (below the pitch
 *   margin).
 *
 * The projection is an exact affine map (no rotation, no perspective):
 *
 * ```
 * canvasX = MARGIN + SCALE * x      canvasY = MARGIN + SCALE * y
 * ```
 *
 * **Never clamped.** Out-of-bounds positions are classified, never moved:
 *
 * - `in-play`: `0 <= x <= 105 && 0 <= y <= 68` (boundary inclusive — the
 *   lines are part of the pitch);
 * - `out-of-play-near`: outside the pitch rectangle but the TRUE projected
 *   position still lands on the drawable canvas above the caption band
 *   (`0 <= canvasX <= 1170 && 0 <= canvasY < 800`): drawn at the TRUE
 *   position with explicit out-of-play styling;
 * - `out-of-play-off-canvas`: the true projection would fall outside the
 *   canvas or into the caption band: the marker is OMITTED (with full
 *   accounting — the true unclamped meters are recorded in the manifest).
 *
 * Serialization rounds SVG coordinates to 2 decimals
 * (`Math.round(v * 100) / 100`); the true unrounded position is always
 * preserved verbatim in the manifest — rounding is a display concern,
 * never a data mutation.
 */
import { PITCH_LENGTH_AXIS_METERS, PITCH_WIDTH_AXIS_METERS } from "@sporta/contracts";

/** SVG units per meter (exact integer scale). */
export const SCALE = 10;

/** Canvas margin around the pitch, in SVG units (6 m equivalent). */
export const MARGIN = 60;

/** Caption band height in SVG units. */
export const CAPTION_BAND_H = 80;

/** Canvas width in SVG units: 2 × margin + 105 m × scale = 1170. */
export const CANVAS_W = 2 * MARGIN + PITCH_LENGTH_AXIS_METERS * SCALE;

/** Canvas height in SVG units: margin + 68 m × scale + margin + band = 880. */
export const CANVAS_H = MARGIN + PITCH_WIDTH_AXIS_METERS * SCALE + MARGIN + CAPTION_BAND_H;

/** Caption band: y range `[CAPTION_BAND_Y, CANVAS_H)` (80 units tall). */
export const CAPTION_BAND_Y = MARGIN + PITCH_WIDTH_AXIS_METERS * SCALE + MARGIN; // 800

/** Canvas x of the left goal line. */
export const PITCH_LEFT = MARGIN; // 60

/** Canvas y of the top touchline. */
export const PITCH_TOP = MARGIN; // 60

/** The pitch rectangle in canvas coordinates (x, y, width, height). */
export const PITCH_RECT = {
  x: PITCH_LEFT,
  y: PITCH_TOP,
  w: PITCH_LENGTH_AXIS_METERS * SCALE, // 1050
  h: PITCH_WIDTH_AXIS_METERS * SCALE, // 680
} as const;

/** Canvas x of the halfway line (52.5 m). */
export const PITCH_CENTER_X = MARGIN + (PITCH_LENGTH_AXIS_METERS / 2) * SCALE; // 585

/** Canvas y of the pitch center line (34 m). */
export const PITCH_CENTER_Y = MARGIN + (PITCH_WIDTH_AXIS_METERS / 2) * SCALE; // 400

/** Penalty-area depth 16.5 m and width 40.32 m (Laws-of-the-Game standard). */
const PENALTY_DEPTH = 16.5 * SCALE; // 165
const PENALTY_WIDTH = 40.32 * SCALE; // 403.2

/** Goal-area depth 5.5 m and width 18.32 m. */
const GOAL_AREA_DEPTH = 5.5 * SCALE; // 55
const GOAL_AREA_WIDTH = 18.32 * SCALE; // 183.2

/** Center circle radius 9.15 m. */
const CENTER_CIRCLE_R = 9.15 * SCALE; // 91.5

/** Penalty spot distance from the goal line: 11 m. */
const PENALTY_SPOT_OFFSET = 11 * SCALE; // 110

/** How a pitch position classifies against the drawable canvas. */
export type PositionDisposition =
  /** In pitch bounds (boundary inclusive): drawn with normal styling. */
  | "in-play"
  /**
   * Out of pitch bounds but drawable: drawn at the TRUE position with
   * out-of-play styling.
   */
  | "out-of-play-near"
  /**
   * Out of pitch bounds and beyond the drawable canvas (or inside the
   * caption band): omitted with accounting.
   */
  | "out-of-play-off-canvas";

/** A pitch-space point in canonical meters. */
export interface PitchPointMeters {
  x: number;
  y: number;
}

/** A canvas-space point in SVG units. */
export interface CanvasPoint {
  x: number;
  y: number;
}

/** The exact affine projection: pitch meters → SVG canvas units. */
export function toCanvas(position: PitchPointMeters): CanvasPoint {
  return {
    x: MARGIN + SCALE * position.x,
    y: MARGIN + SCALE * position.y,
  };
}

/** Serialization rounding to 2 decimals (SVG coordinates), pinned by tests. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The rounded canvas point actually serialized into the SVG. */
export function toCanvasRounded(position: PitchPointMeters): CanvasPoint {
  const canvas = toCanvas(position);
  return { x: round2(canvas.x), y: round2(canvas.y) };
}

/**
 * Classifies a pitch position against the drawable canvas. Pure; never
 * clamps or moves the position — the classification drives styling and
 * accounting only. Boundary semantics (test-pinned):
 *
 * - `(0, 0)` / `(105, 68)` are in-play (lines are part of the pitch);
 * - `(-6, 34)` projects to canvas x 0 → out-of-play-near (canvas edge);
 * - `(-6.1, 34)` projects to canvas x −1 → out-of-play-off-canvas;
 * - `(52.5, 74)` projects to canvas y 800, where the caption band starts →
 *   out-of-play-off-canvas; `(52.5, 73.9)` → canvas y 799 → near.
 */
export function classifyPosition(position: PitchPointMeters): PositionDisposition {
  if (
    position.x >= 0 &&
    position.x <= PITCH_LENGTH_AXIS_METERS &&
    position.y >= 0 &&
    position.y <= PITCH_WIDTH_AXIS_METERS
  ) {
    return "in-play";
  }
  const canvas = toCanvas(position);
  if (canvas.x >= 0 && canvas.x <= CANVAS_W && canvas.y >= 0 && canvas.y < CAPTION_BAND_Y) {
    return "out-of-play-near";
  }
  return "out-of-play-off-canvas";
}

/**
 * The penalty arc on one side: the part of the 9.15 m circle around the
 * penalty spot that lies outside the penalty area. The chord sits on the
 * penalty-area front line (16.5 m from the goal line); half the chord
 * height is `sqrt(r² − (16.5 m − 11 m)²)`.
 */
function penaltyArcPath(side: "left" | "right"): string {
  const spotX =
    side === "left" ? PITCH_LEFT + PENALTY_SPOT_OFFSET : CANVAS_W - MARGIN - PENALTY_SPOT_OFFSET;
  const chordX = side === "left" ? PITCH_LEFT + PENALTY_DEPTH : CANVAS_W - MARGIN - PENALTY_DEPTH;
  const dx = Math.abs(chordX - spotX); // 55 units
  const dy = Math.sqrt(CENTER_CIRCLE_R * CENTER_CIRCLE_R - dx * dx);
  const yTop = round2(PITCH_CENTER_Y - dy);
  const yBottom = round2(PITCH_CENTER_Y + dy);
  // Top chord point → bottom chord point along the far side of the circle
  // (the bulge toward field center): sweep-flag 1 (clockwise) for the left
  // arc, 0 (counterclockwise) for the right arc.
  const sweep = side === "left" ? 1 : 0;
  return `M ${chordX} ${yTop} A ${CENTER_CIRCLE_R} ${CENTER_CIRCLE_R} 0 0 ${sweep} ${chordX} ${yBottom}`;
}

/**
 * Standard pitch marking geometry (Laws-of-the-Game dimensions — public
 * standard rules, not proprietary assets), precomputed in canvas units.
 * Corner arcs and goal frames are deliberate prototype omissions
 * (documented cosmetic simplification).
 */
export const PITCH_MARKINGS = {
  penaltyDepth: PENALTY_DEPTH,
  penaltyWidth: PENALTY_WIDTH,
  goalAreaDepth: GOAL_AREA_DEPTH,
  goalAreaWidth: GOAL_AREA_WIDTH,
  centerCircleR: CENTER_CIRCLE_R,
  penaltySpotOffset: PENALTY_SPOT_OFFSET,
  penaltySpotLeft: { x: PITCH_LEFT + PENALTY_SPOT_OFFSET, y: PITCH_CENTER_Y }, // (170, 400)
  penaltySpotRight: { x: CANVAS_W - MARGIN - PENALTY_SPOT_OFFSET, y: PITCH_CENTER_Y }, // (1000, 400)
  leftPenaltyArcPath: penaltyArcPath("left"),
  rightPenaltyArcPath: penaltyArcPath("right"),
} as const;
