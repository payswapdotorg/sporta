/**
 * @sporta/game-engine-adapter — the reference implementation of the frozen
 * `GameEngineAdapter` seam (R302).
 *
 * The `SoftwareSceneEngine` is an in-repo deterministic software 3D-ish
 * compositor behind the provider-neutral seam from `@sporta/contracts`:
 *
 * - `buildScene` projects the SWM snapshot through the canonical W601
 *   `@sporta/scene-projection` (one shared scene for every style) and
 *   applies the event tail as presentation overlays (no invented
 *   trajectories — the `EventEnvelope` carries no spatial data);
 * - `applySceneEvents` counts skipped events honestly (replays are
 *   idempotent no-ops; out-of-envelope events surface as degradation);
 * - `renderScene` stages REAL `frames-rgb24` sequences under a declared
 *   staging root, with honest telemetry (measured from the injected clock)
 *   and honest provenance (snapshot version + highest applied sequence);
 * - two rendering styles (`stylized-3d`, `cel-shaded`) render the SAME
 *   scene differently — the ADR-009 strategy the 3D Game (R303) and
 *   Anime/NPR (R304) renderers share.
 *
 * ENGINE REPLACEABILITY: no vendor name leaks into any contract; headless
 * Godot 4 is the documented next-wave engine candidate behind this same
 * seam. `runGameEngineConformance` (G1-G13) is the reusable conformance
 * suite for ANY adapter behind the seam — this engine is its reference
 * green case.
 */
export { GameEngineAdapterError, type GameEngineViolationCode } from "./errors";
export {
  buildSceneState,
  applyEventsToScene,
  type SceneState,
  type SceneEntityModel,
  type SceneEventOverlay,
} from "./scene";
export {
  DepthRaster,
  fnv1a32,
  clampColor,
  lerpColor,
  vec3,
  type Camera,
  type Rgb,
  type Vec3,
  type ProjectedVertex,
} from "./raster";
export {
  RENDERING_STYLE_PROFILES,
  SUPPORTED_RENDERING_STYLES,
  styleProfileOf,
  type RenderingStyleProfile,
} from "./styles";
export {
  SoftwareSceneEngine,
  SOFTWARE_ENGINE_ID,
  SOFTWARE_ENGINE_VERSION,
  SOFTWARE_ADAPTER_VERSION,
  SOFTWARE_ENGINE_FORMAT,
  DEFAULT_MAX_CONCURRENT_ENTITIES,
  DEFAULT_MAX_FRAMES_PER_RENDER,
  type SoftwareSceneEngineOptions,
  type StagedFrameSequence,
} from "./engine";
export {
  runGameEngineConformance,
  GAME_ENGINE_CONFORMANCE_CHECK_IDS,
  type GameEngineConformanceCheck,
  type GameEngineConformanceReport,
  type GameEngineConformanceOptions,
} from "./conformance";
