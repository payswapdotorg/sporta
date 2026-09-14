/**
 * Field geometry for the avatar/field 3D prototype (W602): the 3D scene
 * primitives the renderer draws, derived VERBATIM from the W601
 * `SceneSpecification`'s `world` block.
 *
 * HONESTY RULE (the W601 contract, S2): every geometric value below is
 * either copied from the spec (`pitch.bounds`, `pitch.planeZMeters`, the
 * `furniture` records — goals, areas, spots, center circle, corner arcs)
 * or derived from spec fields by a DOCUMENTED rule in this module. The
 * only presentation constants are discretization counts and radii of
 * POINT MARKERS (spots), all documented inline — no dimension is invented
 * (the Law 1 geometry lives IN the spec; this module never re-states it).
 *
 * The pitch plane is the spec's own `planeZMeters` (0 — the frame's
 * definition of "up"); every marking lies ON that plane; the goal frames
 * rise to the spec's `heightMeters` (2.44) and span its `widthMeters`
 * (7.32). Curves (center circle, penalty arcs, corner arcs) discretize to
 * polylines with fixed segment counts (a display concern, never a data
 * mutation — the spec keeps the exact radii).
 */
import type {
  SceneCameraSlot,
  ScenePitchFurniture,
  SceneSpecification,
} from "@sporta/scene-projection";
import type { Vec3 } from "./internal";

/** A straight line on the pitch plane (or in space, for goal frames). */
export interface FieldLine {
  /** The line kind (stable serialization + test pinning). */
  kind:
    | "boundary"
    | "halfway"
    | "penalty-area"
    | "goal-area"
    | "center-circle"
    | "penalty-arc"
    | "corner-arc"
    | "goal-frame"
    | "goal-line";
  /** The two endpoints, in scene coordinates (meters). */
  from: Vec3;
  to: Vec3;
}

/** A filled ground polygon (apron / pitch / mow stripe). */
export interface GroundPolygon {
  kind: "apron" | "pitch" | "stripe";
  /** Polygon vertices in scene coordinates, in winding order. */
  points: Vec3[];
  /** The flat fill (see FIELD_PALETTE in `./svg.ts`). */
  fill: "apron" | "pitch" | "stripe-a" | "stripe-b";
}

/** A small ground dot (penalty spots, center mark). */
export interface FieldDot {
  kind: "penalty-spot" | "center-mark";
  /** Dot center in scene coordinates. */
  center: Vec3;
}

/** Everything the renderer draws for the field, derived from one spec. */
export interface FieldGeometry {
  /** The spec's camera slots, verbatim (framing selection is the caller's). */
  cameraSlots: SceneCameraSlot[];
  /** The ground polygons, painter order (apron → pitch → stripes). */
  polygons: GroundPolygon[];
  /** Every marking line, fixed order (serialization determinism). */
  lines: FieldLine[];
  /** The point markers, fixed order. */
  dots: FieldDot[];
}

// ---------------------------------------------------------------------------
// Presentation constants (documented; never entity data — see RENDERER.md)
// ---------------------------------------------------------------------------

/**
 * Mow-stripe count across the pitch length: 10 alternating stripes derived
 * from `pitch.bounds` (each `width / 10` wide) — a presentation
 * discretization of the spec's own bounds, not a marking.
 */
export const STRIPE_COUNT = 10;

/**
 * Discretization segment counts (presentation constants): a full circle
 * renders as 64 segments, a quarter-arc (corner arc) as 8, a penalty arc
 * as 16. Deterministic polylines; the spec keeps the exact radii.
 */
export const CIRCLE_SEGMENTS = 64;
export const CORNER_ARC_SEGMENTS = 8;
export const PENALTY_ARC_SEGMENTS = 16;

/**
 * The rendered radius of the point markers (penalty spots / center mark):
 * 0.2 m. Law 1 gives no spot radius — this is a documented marker-size
 * presentation constant (the W502 "penalty spot dot" precedent).
 */
export const FIELD_DOT_RADIUS_METERS = 0.2;

/**
 * The grass apron width beyond the pitch bounds, in meters (6 m, like the
 * W502 canvas margin): the ground context strip around the pitch, derived
 * from `pitch.bounds`.
 */
export const APRON_WIDTH_METERS = 6;

// ---------------------------------------------------------------------------
// Pure derivations from the spec's world block
// ---------------------------------------------------------------------------

/** The pitch-center x/y from the spec's own center mark. */
function centerOf(furniture: ScenePitchFurniture): { x: number; y: number } {
  return { x: furniture.centerMark.position.x, y: furniture.centerMark.position.y };
}

/** A plane point at the spec's plane height. */
function planePoint(x: number, y: number, planeZ: number): Vec3 {
  return { x, y, z: planeZ };
}

/** The rectangle outline (4 lines) of `bounds`, in fixed order. */
function rectangleLines(
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  planeZ: number,
  kind: FieldLine["kind"],
): FieldLine[] {
  const a = planePoint(bounds.xMin, bounds.yMin, planeZ);
  const b = planePoint(bounds.xMax, bounds.yMin, planeZ);
  const c = planePoint(bounds.xMax, bounds.yMax, planeZ);
  const d = planePoint(bounds.xMin, bounds.yMax, planeZ);
  return [
    { kind, from: a, to: b },
    { kind, from: b, to: c },
    { kind, from: c, to: d },
    { kind, from: d, to: a },
  ];
}

/** The polyline points of a circle at `center`, radius `r`, on the plane. */
function circlePoints(
  center: { x: number; y: number },
  radius: number,
  planeZ: number,
  segments: number,
  angleFrom: number,
  angleTo: number,
): Vec3[] {
  const points: Vec3[] = [];
  const step = (angleTo - angleFrom) / segments;
  for (let i = 0; i <= segments; i += 1) {
    const angle = angleFrom + i * step;
    points.push(
      planePoint(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle), planeZ),
    );
  }
  return points;
}

/** Converts a polyline into consecutive line segments. */
function polylineLines(points: readonly Vec3[], kind: FieldLine["kind"]): FieldLine[] {
  const lines: FieldLine[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    lines.push({ kind, from: points[i]!, to: points[i + 1]! });
  }
  return lines;
}

/**
 * The penalty arc on one side: the part of the circle around the penalty
 * spot (radius = the spec's own `centerCircle.radiusMeters` — Law 1 pins
 * the SAME 9.15 m radius for the penalty arc, so the value is read from
 * the spec, never re-stated) that lies OUTSIDE the penalty area. The arc's
 * angular half-width is `acos(depth / radius)` where `depth` is the
 * distance from the spot to the penalty-area front line (derived from the
 * spec's penalty-area bounds and penalty-spot position).
 */
function penaltyArcLines(
  furniture: ScenePitchFurniture,
  sideIndex: 0 | 1,
  planeZ: number,
): FieldLine[] {
  const radius = furniture.centerCircle.radiusMeters;
  const spot = furniture.penaltySpots[sideIndex]!;
  const area = furniture.penaltyAreas[sideIndex]!;
  const isX0 = sideIndex === 0;
  // The penalty-area front line x (the chord): the edge of the area that
  // faces the pitch center, derived from the spec's area bounds.
  const chordX = isX0 ? area.bounds.xMax : area.bounds.xMin;
  // Distance from the spot to the chord, along ±x (the goal direction).
  const depth = Math.abs(chordX - spot.position.x);
  if (depth >= radius) return []; // Degenerate spec: no visible arc.
  const halfAngle = Math.acos(depth / radius);
  // The arc bulges TOWARD the pitch center: measured from the direction
  // pointing away from the goal line (+x for the x0 side, −x for x105).
  const baseAngle = isX0 ? 0 : Math.PI;
  const points = circlePoints(
    spot.position,
    radius,
    planeZ,
    PENALTY_ARC_SEGMENTS,
    baseAngle - halfAngle,
    baseAngle + halfAngle,
  );
  return polylineLines(points, "penalty-arc");
}

/**
 * The corner arc at one corner: the quarter circle of the spec's radius
 * that sweeps INTO the pitch (the quadrant toward the pitch center),
 * derived from the spec's OWN `corner` id and center (the id travels with
 * the record — a reordered cornerArcs array still draws each arc in its
 * true quadrant).
 */
function cornerArcLines(
  corner: "x0y0" | "x105y0" | "x0y68" | "x105y68",
  center: { x: number; y: number },
  radius: number,
  planeZ: number,
): FieldLine[] {
  // The quadrant direction toward the pitch center, from the corner id.
  const signX = corner.startsWith("x0") ? 1 : -1;
  const signY = corner.endsWith("y0") ? 1 : -1;
  // The in-pitch quadrant spans angles [start, start + π/2] measured so
  // that (cos θ, sin θ) points into that quadrant.
  const start = Math.atan2(signY, signX);
  const points = circlePoints(
    center,
    radius,
    planeZ,
    CORNER_ARC_SEGMENTS,
    start,
    start + Math.PI / 2,
  );
  return polylineLines(points, "corner-arc");
}

/**
 * The goal frame on one side, from the spec's goal record: two posts
 * (center ± width/2 along y, ground → heightMeters) plus the crossbar
 * between the post tops. All values verbatim from the spec.
 */
function goalFrameLines(goal: ScenePitchFurniture["goals"][number], planeZ: number): FieldLine[] {
  const x = goal.center.x;
  const halfWidth = goal.widthMeters / 2;
  const y1 = goal.center.y - halfWidth;
  const y2 = goal.center.y + halfWidth;
  const ground = planeZ; // The spec's pitch plane (its own definition of up).
  const top = planeZ + goal.heightMeters;
  return [
    { kind: "goal-frame", from: { x, y: y1, z: ground }, to: { x, y: y1, z: top } },
    { kind: "goal-frame", from: { x, y: y2, z: ground }, to: { x, y: y2, z: top } },
    { kind: "goal-frame", from: { x, y: y1, z: top }, to: { x, y: y2, z: top } },
  ];
}

/**
 * Builds the complete field geometry of one scene specification. Pure: a
 * pure function of the spec's `world` block (fixed element order — the
 * serialization order). The halfway line is the documented derivation
 * "the line through the spec's center mark, parallel to the goal lines
 * (along y), spanning the spec's bounds"; the goal lines are the bounds'
 * x = xMin / x = xMax edges.
 */
export function buildFieldGeometry(scene: SceneSpecification): FieldGeometry {
  const pitch = scene.world.pitch;
  const furniture = pitch.furniture;
  const planeZ = pitch.planeZMeters;
  const bounds = pitch.bounds;
  const center = centerOf(furniture);

  // --- Ground polygons (painter order: apron, pitch, stripes) -------------
  const apron = [
    planePoint(bounds.xMin - APRON_WIDTH_METERS, bounds.yMin - APRON_WIDTH_METERS, planeZ),
    planePoint(bounds.xMax + APRON_WIDTH_METERS, bounds.yMin - APRON_WIDTH_METERS, planeZ),
    planePoint(bounds.xMax + APRON_WIDTH_METERS, bounds.yMax + APRON_WIDTH_METERS, planeZ),
    planePoint(bounds.xMin - APRON_WIDTH_METERS, bounds.yMax + APRON_WIDTH_METERS, planeZ),
  ];
  const pitchPolygon = [
    planePoint(bounds.xMin, bounds.yMin, planeZ),
    planePoint(bounds.xMax, bounds.yMin, planeZ),
    planePoint(bounds.xMax, bounds.yMax, planeZ),
    planePoint(bounds.xMin, bounds.yMax, planeZ),
  ];
  const stripeWidth = (bounds.xMax - bounds.xMin) / STRIPE_COUNT;
  const stripes: GroundPolygon[] = [];
  for (let i = 0; i < STRIPE_COUNT; i += 1) {
    const x0 = bounds.xMin + i * stripeWidth;
    const x1 = x0 + stripeWidth;
    stripes.push({
      kind: "stripe",
      points: [
        planePoint(x0, bounds.yMin, planeZ),
        planePoint(x1, bounds.yMin, planeZ),
        planePoint(x1, bounds.yMax, planeZ),
        planePoint(x0, bounds.yMax, planeZ),
      ],
      fill: i % 2 === 0 ? "stripe-a" : "stripe-b",
    });
  }

  // --- Marking lines (fixed order) ----------------------------------------
  const lines: FieldLine[] = [
    ...rectangleLines(bounds, planeZ, "boundary"),
    // The halfway line: through the center mark, parallel to the goal lines.
    {
      kind: "halfway",
      from: planePoint(center.x, bounds.yMin, planeZ),
      to: planePoint(center.x, bounds.yMax, planeZ),
    },
    ...rectangleLines(furniture.goalAreas[0]!.bounds, planeZ, "goal-area"),
    ...rectangleLines(furniture.goalAreas[1]!.bounds, planeZ, "goal-area"),
    ...rectangleLines(furniture.penaltyAreas[0]!.bounds, planeZ, "penalty-area"),
    ...rectangleLines(furniture.penaltyAreas[1]!.bounds, planeZ, "penalty-area"),
    ...polylineLines(
      circlePoints(
        center,
        furniture.centerCircle.radiusMeters,
        planeZ,
        CIRCLE_SEGMENTS,
        0,
        2 * Math.PI,
      ),
      "center-circle",
    ),
    ...penaltyArcLines(furniture, 0, planeZ),
    ...penaltyArcLines(furniture, 1, planeZ),
    ...cornerArcLines(
      furniture.cornerArcs[0]!.corner,
      furniture.cornerArcs[0]!.center,
      furniture.cornerArcs[0]!.radiusMeters,
      planeZ,
    ),
    ...cornerArcLines(
      furniture.cornerArcs[1]!.corner,
      furniture.cornerArcs[1]!.center,
      furniture.cornerArcs[1]!.radiusMeters,
      planeZ,
    ),
    ...cornerArcLines(
      furniture.cornerArcs[2]!.corner,
      furniture.cornerArcs[2]!.center,
      furniture.cornerArcs[2]!.radiusMeters,
      planeZ,
    ),
    ...cornerArcLines(
      furniture.cornerArcs[3]!.corner,
      furniture.cornerArcs[3]!.center,
      furniture.cornerArcs[3]!.radiusMeters,
      planeZ,
    ),
    ...goalFrameLines(furniture.goals[0]!, planeZ),
    ...goalFrameLines(furniture.goals[1]!, planeZ),
  ];

  // --- Point markers (fixed order) ----------------------------------------
  const dots: FieldDot[] = [
    ...furniture.penaltySpots.map((spot) => ({
      kind: "penalty-spot" as const,
      center: planePoint(spot.position.x, spot.position.y, planeZ),
    })),
    { kind: "center-mark", center: planePoint(center.x, center.y, planeZ) },
  ];

  return {
    // DEEP clone: a consumer mutating the geometry's slots must never be
    // able to reach the input spec's slot objects (a shallow `{...slot}`
    // would share the nested position/target records).
    cameraSlots: scene.cameraSlots.map((slot) => ({
      ...slot,
      position: { ...slot.position },
      target: { ...slot.target },
    })),
    polygons: [
      { kind: "apron", points: apron, fill: "apron" },
      { kind: "pitch", points: pitchPolygon, fill: "pitch" },
      ...stripes,
    ],
    lines,
    dots,
  };
}
