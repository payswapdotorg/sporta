/**
 * THE scene specification schema (W601): the typed, versioned, zod-validated
 * document a Sports World Model snapshot projects into
 * (docs/work-items/work-items.md, M6 → W601: "SWM can be projected into a
 * deterministic 3D scene specification").
 *
 * Versioning follows the `@sporta/contracts` convention
 * (docs/contracts/COMPATIBILITY.md): `sceneSchemaVersion` is `MAJOR.MINOR`;
 * MINOR bumps are additive (a previously valid scene stays valid), MAJOR
 * bumps are breaking. The scene schema is OWNED BY THIS PACKAGE — it extends
 * the frozen SWM contracts but never modifies them: every verbatim block
 * REUSES the contracts' own zod schemas (`PitchFrame`, `MatchClock`, `Score`,
 * `WorldEventStreamEntry`, `Watermark`, `EntityId`, `EntityKind`,
 * `UncertaintyStatus`), so the scene can never drift from the documents it
 * projects from.
 *
 * Honesty rules baked into the schema (see CONTRACT.md for the full rule
 * text, S1–S8):
 *
 * - every entity position/height/heading is optional and carries the SWM
 *   uncertainty status (and confidence, when the SWM had one) VERBATIM;
 * - there is NO default position, NO default height (a ball without a
 *   carried height simply has no `z` — never a faked 0), NO default
 *   confidence;
 * - event markers are the SWM stream entries VERBATIM plus an
 *   `anchoring: "timeline"` literal — they carry no scene position (placing
 *   an event spatially would invent data the `EventEnvelope` does not have);
 * - the pitch furniture and camera slots are explicit constants with
 *   versioned constant-set ids (schema literals pin the IFAB Law 1
 *   dimensions).
 */
import { z } from "zod";
import {
  EntityId,
  EntityKind,
  MatchClock,
  PitchFrame,
  Score,
  UncertaintyStatus,
  Watermark,
  WorldEventStreamEntry,
  uncertainValue,
} from "@sporta/contracts";
import {
  CAMERA_SLOT_IDS,
  CENTER_CIRCLE_RADIUS_METERS,
  CORNER_ARC_RADIUS_METERS,
  FURNITURE_CONSTANTS_VERSION,
  GOAL_HEIGHT_METERS,
  GOAL_WIDTH_METERS,
} from "./constants";

// ---------------------------------------------------------------------------
// Scene schema version
// ---------------------------------------------------------------------------

/** Current scene specification major version (breaking changes bump this). */
export const SCENE_SCHEMA_MAJOR = 1;

/** Current scene specification minor version (additive changes bump this). */
export const SCENE_SCHEMA_MINOR = 0;

/** Current scene schema version as `"MAJOR.MINOR"`. */
export const SCENE_SCHEMA_VERSION = `${SCENE_SCHEMA_MAJOR}.${SCENE_SCHEMA_MINOR}`;

const SCENE_SCHEMA_VERSION_PATTERN = /^\d+\.\d+$/;

/** The `sceneSchemaVersion` field pattern (same form as the contracts). */
export const sceneSchemaVersionField = z
  .string()
  .regex(SCENE_SCHEMA_VERSION_PATTERN, 'sceneSchemaVersion must be "MAJOR.MINOR" (e.g. "1.0")');

/**
 * Returns `true` when a scene declaring version `v` is consumable by the
 * current schema: same MAJOR and declared MINOR <= current MINOR (the
 * compatibility posture of `docs/contracts/COMPATIBILITY.md` — consumers
 * reject newer-minor payloads rather than partially parsing them).
 */
export function isSceneVersionCompatible(v: string): boolean {
  if (!SCENE_SCHEMA_VERSION_PATTERN.test(v)) return false;
  const [major, minor] = v.split(".").map((part) => Number.parseInt(part, 10)) as [number, number];
  return major === SCENE_SCHEMA_MAJOR && minor <= SCENE_SCHEMA_MINOR;
}

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

/** A finite number (positions, heights, headings, confidences). */
const finiteNumber = z
  .number()
  .refine((n) => Number.isFinite(n), { message: "must be a finite number" });

const unitConfidence = finiteNumber.min(0).max(1);

/** A 3D point in scene coordinates (meters, right-handed, z up). */
export const ScenePoint = z.object({
  x: finiteNumber,
  y: finiteNumber,
  z: finiteNumber.optional(),
});
export type ScenePoint = z.infer<typeof ScenePoint>;

// ---------------------------------------------------------------------------
// Entities (one entry per snapshot entity — total accounting, rule S3)
// ---------------------------------------------------------------------------

/**
 * How one snapshot entity was treated. The vocabulary is closed and TOTAL:
 * every snapshot entity gets exactly one disposition (W502's
 * accounted-dispositions posture — never a silent drop).
 */
export const SCENE_ENTITY_DISPOSITIONS = [
  /** On the pitch plane, in bounds [0, 105] × [0, 68] (inclusive). */
  "projected",
  /** Outside the pitch bounds: TRUE coordinates kept and flagged (never clamped). */
  "projected-out-of-bounds",
  /** No position slot at all, or the slot is `unknown`/valueless (never invented). */
  "omitted-no-position",
  /** The slot's value is not a finite `{x, y}` number pair (never coerced). */
  "omitted-invalid-position",
  /**
   * A usable position exists but is not pitch-framed: the W401 fusion
   * `position` slot without a `known "pitch"` `spatialFrame` (e.g. an
   * image-framed track). It is accounted, never placed (that would invent a
   * mapping).
   */
  "omitted-non-pitch-frame",
  /** Entity kind is not projectable onto the pitch plane (match, competition, team, venue, camera). */
  "not-projected-kind",
] as const;
export type SceneEntityDisposition = (typeof SCENE_ENTITY_DISPOSITIONS)[number];

/** The height slot record (ball only): the SWM `height` slot, verbatim. */
export const SceneHeightSlot = z.object({
  status: UncertaintyStatus,
  meters: finiteNumber.optional(),
  confidence: unitConfidence.optional(),
});
export type SceneHeightSlot = z.infer<typeof SceneHeightSlot>;

/** The heading slot record: the SWM `heading` slot, verbatim. */
export const SceneHeadingSlot = z.object({
  status: UncertaintyStatus,
  radians: finiteNumber.optional(),
  confidence: unitConfidence.optional(),
});
export type SceneHeadingSlot = z.infer<typeof SceneHeadingSlot>;

/** Which documented position slot key the projection consulted. */
export const ScenePositionSlotKey = z.enum(["pitchPosition", "position"]);
export type ScenePositionSlotKey = z.infer<typeof ScenePositionSlotKey>;

/** Slot keys whose present-but-unusable values were accounted (never dropped silently). */
export const SceneInvalidSlotKey = z.enum(["height", "heading"]);

/**
 * One snapshot entity projected into the scene. `entityId`, `kind`,
 * `version`, and `lastEventTimeMs` are verbatim (rule S1); the position is
 * the SWM slot value verbatim (x, y) with `z` per rule S4/S6:
 * participants/officials sit ON the plane (`z: 0`, a documented frame
 * constant), the ball's `z` is its carried height and is ABSENT when the SWM
 * carries none (never a faked 0).
 */
export const SceneEntity = z.object({
  entityId: EntityId,
  kind: EntityKind,
  version: z.number().int().min(1),
  lastEventTimeMs: z.number().min(0),
  disposition: z.enum(SCENE_ENTITY_DISPOSITIONS),
  /** Present iff the disposition is `projected` or `projected-out-of-bounds`. */
  position: ScenePoint.optional(),
  /** Which documented position slot the position came from, when a slot was consulted. */
  positionSlotKey: ScenePositionSlotKey.optional(),
  /** The position slot's uncertainty status, verbatim, when a slot was consulted. */
  positionStatus: UncertaintyStatus.optional(),
  /** The position slot's confidence, verbatim, when the slot carried one. */
  positionConfidence: unitConfidence.optional(),
  /** Ball only: the SWM `height` slot record, verbatim, whenever the slot exists. */
  height: SceneHeightSlot.optional(),
  /**
   * Projectable kinds: the SWM `heading` slot record, verbatim, whenever the
   * slot exists (radians in the pitch plane from +x toward +y).
   */
  heading: SceneHeadingSlot.optional(),
  /** Slot keys whose value was present but unusable (non-finite number) — accounted. */
  invalidSlotKeys: z.array(SceneInvalidSlotKey).min(1).optional(),
});
export type SceneEntity = z.infer<typeof SceneEntity>;

// ---------------------------------------------------------------------------
// Pitch geometry (world block) — explicit, versioned constants (rule S2)
// ---------------------------------------------------------------------------

/** A closed rectangle on the pitch plane. */
export const SceneBounds = z
  .object({
    xMin: finiteNumber,
    xMax: finiteNumber,
    yMin: finiteNumber,
    yMax: finiteNumber,
  })
  .refine((b) => b.xMax >= b.xMin && b.yMax >= b.yMin, {
    message: "bounds must satisfy xMax >= xMin and yMax >= yMin",
    path: ["xMax"],
  });
export type SceneBounds = z.infer<typeof SceneBounds>;

/** Which goal line a piece of furniture belongs to. */
const GoalLine = z.enum(["x0", "x105"]);

/** Which pitch corner a corner arc is centered on (canonical order). */
const PitchCorner = z.enum(["x0y0", "x105y0", "x0y68", "x105y68"]);

/**
 * The pitch furniture: the IFAB Law 1 standard-pitch markings as explicit
 * constants. Every dimension is schema-pinned (zod literals); the projected
 * values are pure derivations from the canonical frame (see
 * `buildPitchFurniture`); the constant set is versioned
 * (`constantsVersion`) so a consumer can trace every constant (rule S2).
 */
export const ScenePitchFurniture = z.object({
  constantsVersion: z.literal(FURNITURE_CONSTANTS_VERSION),
  /** The two goals, goal-line order x0 then x105. */
  goals: z
    .array(
      z.object({
        goalLine: GoalLine,
        /** Goal-line midpoint: (0, 34) / (105, 34). */
        center: ScenePoint,
        widthMeters: z.literal(GOAL_WIDTH_METERS),
        heightMeters: z.literal(GOAL_HEIGHT_METERS),
      }),
    )
    .length(2),
  /** The two goal areas ("six-yard boxes"), goal-line order. */
  goalAreas: z.array(z.object({ goalLine: GoalLine, bounds: SceneBounds })).length(2),
  /** The two penalty areas ("18-yard boxes"), goal-line order. */
  penaltyAreas: z.array(z.object({ goalLine: GoalLine, bounds: SceneBounds })).length(2),
  /** The two penalty spots, goal-line order. */
  penaltySpots: z.array(z.object({ goalLine: GoalLine, position: ScenePoint })).length(2),
  /** The center circle (radius 9.15 m around the pitch center). */
  centerCircle: z.object({
    center: ScenePoint,
    radiusMeters: z.literal(CENTER_CIRCLE_RADIUS_METERS),
  }),
  /** The center mark (the pitch center). */
  centerMark: z.object({ position: ScenePoint }),
  /** The four corner arcs (radius 1 m), canonical corner order. */
  cornerArcs: z
    .array(
      z.object({
        corner: PitchCorner,
        center: ScenePoint,
        radiusMeters: z.literal(CORNER_ARC_RADIUS_METERS),
      }),
    )
    .length(4),
});
export type ScenePitchFurniture = z.infer<typeof ScenePitchFurniture>;

/**
 * The scene pitch: the canonical pitch frame (verbatim from the snapshot's
 * football state when present, otherwise the identical contracts constant),
 * the play bounds, the plane height, and the furniture.
 */
export const ScenePitch = z.object({
  frame: PitchFrame,
  /**
   * Where the frame came from: `"snapshot-football"` when the snapshot
   * carried football state (copied verbatim), `"contracts-constant"` when it
   * did not (the identical locked constant — the frame never varies, only
   * its provenance does).
   */
  frameSource: z.enum(["snapshot-football", "contracts-constant"]),
  /** Inclusive play bounds: [0, 105] × [0, 68] meters. */
  bounds: z.object({
    xMin: z.literal(0),
    xMax: z.literal(105),
    yMin: z.literal(0),
    yMax: z.literal(68),
  }),
  /** The pitch plane sits at z = 0 (the frame's definition of "up"). */
  planeZMeters: z.literal(0),
  furniture: ScenePitchFurniture,
});
export type ScenePitch = z.infer<typeof ScenePitch>;

/** The scene coordinate system (rule S4, pinned by literals). */
export const SceneCoordinateSystem = z.object({
  units: z.literal("meters"),
  handedness: z.literal("right-handed"),
  origin: z.literal("pitch-corner-0-0-0"),
  axes: z.object({
    x: z.literal("touchline"),
    y: z.literal("goal-line"),
    z: z.literal("up"),
  }),
});
export type SceneCoordinateSystem = z.infer<typeof SceneCoordinateSystem>;

// ---------------------------------------------------------------------------
// Score / clock display state (verbatim football extension, rule S6)
// ---------------------------------------------------------------------------

/**
 * The score/clock display state: the snapshot's football extension copied
 * VERBATIM (presentation strings are W602/W604 territory — this is the state
 * to display, not a rendering of it). Every block is absent when the
 * snapshot carried no football state; `footballState` says which.
 */
export const SceneScoreClock = z.object({
  /** Whether the snapshot carried football extension state. */
  footballState: z.boolean(),
  /** The score, verbatim (reuse of the contracts `Score` schema). */
  score: Score.optional(),
  /** The match clock, verbatim (reuse of the contracts `MatchClock` schema). */
  clock: MatchClock.optional(),
  /** The possession candidate slot, verbatim. */
  possession: uncertainValue(z.object({ entityId: EntityId })).optional(),
  /** The football event taxonomy version in use, verbatim. */
  eventTaxonomyVersion: z.string().min(1).optional(),
});
export type SceneScoreClock = z.infer<typeof SceneScoreClock>;

// ---------------------------------------------------------------------------
// Event markers (verbatim stream entries, timeline-anchored — rule S7)
// ---------------------------------------------------------------------------

/**
 * One event marker: the SWM stream entry VERBATIM (reuse of the contracts
 * `WorldEventStreamEntry` schema) plus the `anchoring` literal. Markers
 * carry NO scene position: the `EventEnvelope` has no spatial data, and
 * inventing a marker position would violate rule S2.
 */
export const SceneEventMarker = WorldEventStreamEntry.extend({
  anchoring: z.literal("timeline"),
});
export type SceneEventMarker = z.infer<typeof SceneEventMarker>;

// ---------------------------------------------------------------------------
// Camera slots (named positions — the slots, not the direction policy)
// ---------------------------------------------------------------------------

/**
 * One named camera slot: a fixed position and aim in scene coordinates plus
 * its derivation string. W604 (camera director) will SELECT and DIRECT these
 * slots; this schema fixes only the named geometry.
 */
export const SceneCameraSlot = z.object({
  slotId: z.enum(CAMERA_SLOT_IDS as [string, ...string[]]),
  position: z.object({ x: finiteNumber, y: finiteNumber, z: finiteNumber }),
  target: z.object({ x: finiteNumber, y: finiteNumber, z: finiteNumber }),
  derivation: z.string().min(1),
});
export type SceneCameraSlot = z.infer<typeof SceneCameraSlot>;

// ---------------------------------------------------------------------------
// Source provenance (rule S1/S3)
// ---------------------------------------------------------------------------

/**
 * Where the scene came from: the SWM snapshot's own identity and watermark,
 * copied verbatim, plus the accounting count.
 */
export const SceneSource = z.object({
  /** The snapshot's `schemaVersion`, verbatim. */
  schemaVersion: z.string().min(1),
  /** The snapshot's watermark, verbatim. */
  watermark: Watermark,
  /** The snapshot's `generatedAtMs`, verbatim. */
  generatedAtMs: z.number(),
  /** Whether the snapshot carried football extension state. */
  footballState: z.boolean(),
  /** The number of entities in the source snapshot (the accounting total). */
  entityCount: z.number().int().min(0),
});
export type SceneSource = z.infer<typeof SceneSource>;

// ---------------------------------------------------------------------------
// The scene specification document
// ---------------------------------------------------------------------------

/**
 * THE scene specification: the deterministic 3D scene projection of one SWM
 * snapshot (plus the caller's ordered event tail as markers). See
 * `CONTRACT.md` for the normative rules S1–S8.
 */
export const SceneSpecification = z.object({
  sceneSchemaVersion: sceneSchemaVersionField,
  /** The media session id, verbatim from the snapshot. */
  sessionId: z.string().min(1),
  source: SceneSource,
  world: z.object({
    coordinateSystem: SceneCoordinateSystem,
    pitch: ScenePitch,
  }),
  /** EVERY snapshot entity, in snapshot order, with its disposition. */
  entities: z.array(SceneEntity),
  scoreClock: SceneScoreClock,
  /** The projected event tail, input order, verbatim. */
  eventMarkers: z.array(SceneEventMarker),
  /** The selected camera slots, canonical order (default: all). */
  cameraSlots: z.array(SceneCameraSlot).min(1),
});
export type SceneSpecification = z.infer<typeof SceneSpecification>;
