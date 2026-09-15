/**
 * @sporta/renderer-3d — the W602 avatar/field 3D prototype renderer,
 * extended in place by W603 match progression.
 *
 * Everything a host needs to render validated SWM snapshots into a
 * deterministic 3D-look field scene (docs/work-items/work-items.md, W602:
 * "benchmark SWM state becomes coherent playable-style field scene using
 * original/proprietary-safe assets"; W603: "match progression rendered
 * from SWM rather than replaying broadcast pixels"):
 *
 * - `identity`: the immutable renderer identity + capability document
 *   (`avatar-field.prototype@0.2.0`, rendererClass `procedural-3d`, the
 *   1280×720 SVG output profiles — W602's 1 fps plus the W603 animated
 *   5/25 fps profiles)
 * - `camera`: the deterministic pinhole perspective camera at a W601 named
 *   camera slot (look-at basis, straight-down fallback, near-plane
 *   clipping) — the renderer frames FROM a carried slot, never chooses one
 * - `style`: identity-stable avatar stylization (a pure function of the
 *   style key + entityId — the no-flicker rule) + the documented
 *   presentation constants (avatar figure size, ball radius) and the
 *   height/heading carried-absent producer decision
 * - `furniture`: the 3D field geometry derived VERBATIM from the spec's
 *   `world.pitch` block (IFAB Law 1 furniture, goals as 3D frames)
 * - `hud`: the fixed phrase tables + verbatim clock/score/marker text
 * - `scene`: `resolve3dFrame` — one `SceneSpecification` → drawable frame +
 *   per-entity manifest accounting (dispositions consumed, never
 *   re-derived; camera-space honesty added)
 * - `svg`: `composeFrame3dSvg` — the deterministic SVG document composition
 * - `interpolate`: the W603 motion model — deterministic constant-velocity
 *   interpolation between consecutive scene specifications with honest
 *   discontinuity handling (declared scene cuts, disposition changes,
 *   missing positions, physical-velocity bounds) and INFERRED provenance
 * - `render`: `render3dFromSnapshot` (the W501 contract path),
 *   `render3dClip` (the multi-spec benchmark path), and `render3dMatch`
 *   (the W603 interpolated match-progression path)
 * - `plugin`: `createAvatarFieldRenderer` — the `RendererPlugin`
 *   implementation (R1–R8)
 * - `types`: the public render manifest + frame types (including the W603
 *   interpolation-provenance vocabulary)
 *
 * The normative decision record — the presentation-format decision, the
 * height/heading producer decision, the camera model, the motion model,
 * the disposition vocabulary, and the honest boundaries — lives in
 * RENDERER.md next to this package's sources.
 */
export {
  AVATAR_FIELD_RENDERER_ID,
  AVATAR_FIELD_RENDERER_VERSION,
  AVATAR_FIELD_OUTPUT_PROFILE,
  AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
  AVATAR_FIELD_GAME_OUTPUT_PROFILE,
  MAX_RENDER_FRAMES,
  DEFAULT_CAMERA_SLOT_ID,
  DEFAULT_DURATION_MS,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
  avatarFieldCapability,
} from "./identity";
export {
  AVATAR_PALETTE,
  OFFICIAL_STYLE,
  BALL_STYLE,
  AVATAR_BODY_HEIGHT_METERS,
  AVATAR_LEG_TOP_METERS,
  AVATAR_SHOULDER_METERS,
  AVATAR_SHOULDER_HALF_WIDTH_METERS,
  AVATAR_LEG_HALF_WIDTH_METERS,
  AVATAR_HEAD_CENTER_METERS,
  AVATAR_HEAD_RADIUS_METERS,
  AVATAR_HEAD_COLOR,
  AVATAR_FACING_LENGTH_METERS,
  AVATAR_FACING_HALF_WIDTH_METERS,
  AVATAR_FACING_HEIGHT_METERS,
  AVATAR_SHADOW_RADIUS_METERS,
  HALO_RADIUS_METERS,
  OUT_OF_PLAY_RING_RADIUS_METERS,
  AVATAR_TOPVIEW_RADIUS_METERS,
  BALL_RADIUS_METERS,
  POSSESSION_RING_RADIUS_METERS,
  fnv1a32,
  stableAvatarStyle,
  avatarFieldStyleKey,
  avatarEntityStyle,
  opacityFromConfidence,
} from "./style";
export type { AvatarStyle } from "./style";
export {
  FOCAL_PX,
  NEAR_PLANE_METERS,
  MIN_MARKER_RADIUS_PX,
  cameraFromSlot,
  toCameraSpace,
  projectCameraPoint,
  projectPoint,
  clipSegmentNear,
  clipPolygonNear,
  projectedRadius,
} from "./camera";
export type { CameraPoint, CameraFrame, ProjectedPoint } from "./camera";
export {
  STRIPE_COUNT,
  CIRCLE_SEGMENTS,
  CORNER_ARC_SEGMENTS,
  PENALTY_ARC_SEGMENTS,
  FIELD_DOT_RADIUS_METERS,
  APRON_WIDTH_METERS,
  buildFieldGeometry,
} from "./furniture";
export type { FieldLine, GroundPolygon, FieldDot, FieldGeometry } from "./furniture";
export {
  EVENT_PHRASES,
  PERIOD_PHRASES,
  STATUS_SEPARATOR,
  SCORE_UNCONFIRMED_MARK,
  STOPPAGE_MARK,
  CAMERA_LABEL_PREFIX,
  eventPhrase,
  eventChipText,
  formatClock,
  scorePart,
  statusLine,
  cameraLabel,
} from "./hud";
export {
  HUD_HEIGHT,
  GROUND_CIRCLE_SEGMENTS,
  OVERHEAD_FORWARD_Z,
  inDrawableRegion,
  resolve3dFrame,
} from "./scene";
export type {
  ScreenPoint,
  ScreenPolygon,
  AvatarFigureDrawable,
  AvatarTopViewDrawable,
  AvatarDrawable,
  BallDrawable,
  EntityDrawable,
  PossessionDrawable,
  Resolved3dFrame,
  CanvasSize,
} from "./scene";
export { FIELD_PALETTE, composeFrame3dSvg } from "./svg";
export type { Svg3dFrameInput } from "./svg";
export {
  PLAYER_MAX_SPEED_MPS,
  BALL_MAX_SPEED_MPS,
  SPEED_EPSILON_MPS,
  PLAYER_INTERPOLATION_BOUND_MPS,
  BALL_INTERPOLATION_BOUND_MPS,
  interpolateMatchFrame,
  sceneCutHeldProvenance,
} from "./interpolate";
export type { InterpolatedMatchFrame } from "./interpolate";
export {
  MAX_EVENT_CHIPS,
  parseStyleConfig,
  admitRequest,
  render3dFromSnapshot,
  render3dClip,
  render3dMatch,
} from "./render";
export type { RequestAdmission } from "./render";
export { createAvatarFieldRenderer } from "./plugin";
export type { AvatarFieldRenderer } from "./plugin";
export type {
  AvatarField3dClipStep,
  AvatarField3dMatchStep,
  MatchHeldReason,
  MatchEntityProvenance,
  MatchEntityProvenanceEntry,
  Render3dMatchInterpolation,
  Render3dEntityDisposition,
  Render3dStyleKind,
  Render3dEntityEntry,
  Render3dMarkerEntry,
  Render3dPossessionEntry,
  Render3dHudState,
  Render3dFrameEntry,
  Render3dSkippedMarker,
  Render3dCameraBlock,
  AvatarField3dManifest,
  AvatarField3dFrame,
  AvatarField3dStyleConfig,
  AvatarField3dRenderOutput,
} from "./types";
