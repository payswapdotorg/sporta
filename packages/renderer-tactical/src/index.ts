/**
 * @sporta/renderer-tactical — the R301 tactical MP4 renderer.
 *
 * A `RendererPlugin` (`tactical.prototype@0.1.0`, `RendererClass: "tactical"`)
 * that renders a REAL playable h264/MP4 tactical visualization of the Sports
 * World Model:
 *
 * - the scene is the CANONICAL W601 `SceneSpecification`
 *   (`@sporta/scene-projection/projectScene`) — deterministic 2D pitch view
 *   with players as marked entities positioned from the SWM state
 *   (UncertainValue positions drawn with explicit uncertainty rings), the
 *   ball, event overlays from the verbatim event stream, and the clock/score
 *   from the verbatim football state;
 * - frames are painted by the package's own pure-TS RGB24 compositor (no
 *   external rendering services, no GPU, no canvas API);
 * - encoding goes through the typed ffmpeg/libx264 codec wrapper
 *   (`FfmpegH264Codec`) — REAL bytes, deterministic flags, Constrained
 *   Baseline L3.0 for HTML5 `<video>` compatibility;
 * - output is staged per the W504 conventions (`objects/<sha256>` +
 *   `meta/<artifactId>.json`) together with the frozen
 *   `RenderArtifactManifest` (reality `"tactical"`, honest SWM provenance,
 *   `integrity.verified` only after the bytes were re-read and re-hashed).
 *
 * The renderer never fabricates video: when the encoder is unavailable the
 * constructor fails loud with a `TacticalCodecError`.
 */
export {
  TACTICAL_RENDERER_ID,
  TACTICAL_RENDERER_VERSION,
  TACTICAL_OUTPUT_PROFILES,
  TACTICAL_CAPABILITY,
  DEFAULT_TACTICAL_DURATION_MS,
} from "./identity";
export { FrameBuffer, blend, clampColor, darken, lighten, type Rgb } from "./canvas";
export { glyphOf, measureText, GLYPH_WIDTH, GLYPH_HEIGHT } from "./font";
export { pitchLayout, toPixels, PITCH_MARGIN_PX, OVERLAY_BAND_PX, type PitchLayout } from "./pitch";
export { TACTICAL_PALETTE, TACTICAL_BALL_STYLE, fnv1a32, markerStyleOf } from "./palette";
export {
  buildTacticalView,
  type TacticalSceneView,
  type TacticalEntity,
  type TacticalEventBadge,
} from "./scene";
export { drawTacticalFrame, type TacticalFrameInput } from "./draw";
export {
  TacticalCodecError,
  FfmpegH264Codec,
  createFfmpegH264Codec,
  TACTICAL_VIDEO_CODEC,
  TACTICAL_CONTAINER,
  type TacticalVideoCodec,
  type EncodeFramesRequest,
} from "./codec";
export {
  TacticalArtifactError,
  TacticalArtifactStore,
  TACTICAL_STAGING_LAYOUT,
  sha256Of,
  tacticalArtifactIdOf,
  type StagedTacticalArtifact,
  type StageArtifactInput,
} from "./artifact";
export {
  createTacticalRenderer,
  type TacticalRenderer,
  type TacticalRendererOptions,
  type TacticalStyleConfig,
  type TacticalRenderDetails,
  type TacticalDetailedRender,
} from "./plugin";
