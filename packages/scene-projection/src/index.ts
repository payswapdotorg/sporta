/**
 * @sporta/scene-projection — the W601 scene projection contract.
 *
 * Everything a consumer needs to project validated SWM snapshots into the
 * deterministic 3D scene specification of M6 (docs/work-items/work-items.md,
 * W601: "SWM can be projected into a deterministic 3D scene specification")
 * and to check scene documents against the contract rules S1–S8:
 *
 * - `schema`: the versioned, zod-validated `SceneSpecification` document
 *   (every verbatim block REUSES the frozen `@sporta/contracts` schemas)
 * - `slots`: the documented SWM state-slot keys the projection reads (incl.
 *   the W401 fusion `position`/`spatialFrame` reconciliation)
 * - `constants`: the explicit IFAB Law 1 pitch furniture + canonical camera
 *   slots, each with its documented derivation
 * - `project`: `projectScene(snapshot, options?)` — pure, total,
 *   deterministic
 * - `serialize`: `serializeScene` (canonical byte-stable JSON form) +
 *   `parseSceneSpecification` (fail-closed parse)
 * - `validate`: `runSceneConformance(scene, options?)` — the fail-soft
 *   harness proving a scene honors the rules (12 stable checks)
 * - `errors`: `SceneProjectionError` — fail-loud input validation
 *
 * The normative contract text — rules S1–S8, the disposition vocabulary,
 * the coordinate system, every constant's derivation, and the honest
 * boundaries — lives in CONTRACT.md next to this package's sources.
 */
export {
  FURNITURE_CONSTANTS_VERSION,
  CAMERA_SLOT_SET_VERSION,
  GOAL_WIDTH_METERS,
  GOAL_HEIGHT_METERS,
  GOAL_AREA_DEPTH_METERS,
  PENALTY_AREA_DEPTH_METERS,
  PENALTY_SPOT_DISTANCE_METERS,
  CENTER_CIRCLE_RADIUS_METERS,
  CORNER_ARC_RADIUS_METERS,
  CANONICAL_CAMERA_SLOTS,
  CAMERA_SLOT_IDS,
  CANONICAL_PITCH_FRAME,
} from "./constants";
export type { SceneCameraSlotConstant } from "./constants";
export {
  SCENE_SCHEMA_MAJOR,
  SCENE_SCHEMA_MINOR,
  SCENE_SCHEMA_VERSION,
  isSceneVersionCompatible,
  sceneSchemaVersionField,
  SceneSpecification,
  SceneEntity,
  SceneEventMarker,
  SceneCameraSlot,
  SceneScoreClock,
  ScenePitch,
  ScenePitchFurniture,
  SceneCoordinateSystem,
  SceneSource,
  SceneBounds,
  ScenePoint,
  SceneHeightSlot,
  SceneHeadingSlot,
  SCENE_ENTITY_DISPOSITIONS,
} from "./schema";
export type { SceneEntityDisposition, ScenePositionSlotKey, SceneInvalidSlotKey } from "./schema";
export {
  PITCH_POSITION_SLOT_KEY,
  FUSION_POSITION_SLOT_KEY,
  SPATIAL_FRAME_SLOT_KEY,
  HEIGHT_SLOT_KEY,
  HEADING_SLOT_KEY,
  PROJECTABLE_KINDS,
  PLANE_KINDS,
  isProjectableKind,
  asFinitePitchPoint,
  resolvePositionSlot,
  readNumericSlot,
} from "./slots";
export type { ProjectableKind, PositionSlotResolution, CarriedSlot } from "./slots";
export { SceneProjectionError } from "./errors";
export {
  projectScene,
  buildPitchFurniture,
  resolveSceneEntity,
  resolveScoreClock,
} from "./project";
export type { ProjectionOptions } from "./project";
export { serializeScene, parseSceneSpecification } from "./serialize";
export { runSceneConformance } from "./validate";
export type {
  SceneConformanceCheck,
  SceneConformanceReport,
  SceneConformanceOptions,
} from "./validate";
