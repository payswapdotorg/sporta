/**
 * @sporta/renderer-anime — the anime renderer prototype (work item W502).
 *
 * A procedural, deterministic, stylized renderer plugin over the Sports
 * World Model: short authorized football clips (a timeline of SWM
 * snapshots + event windows) render into a coherent flat-color anime-style
 * SVG frame sequence with a per-frame provenance/accounting manifest.
 *
 * Architecture (architecture-lock §5, §6; docs/contracts/renderer.md):
 *
 * - `identity`: the immutable plugin identity (`anime.prototype@0.1.0`) and
 *   capability document;
 * - `palette`: identity-stable entity styling — a pure function of
 *   (entityId, renderer version) via a fixed palette table + FNV-1a hash;
 *   flicker-free by construction (no per-frame randomness);
 * - `geometry`: the documented pitch-meters → SVG-canvas affine mapping
 *   (never clamped; honest out-of-play classification);
 * - `captions`: verbatim caption derivation (fixed phrase tables; no
 *   invented text);
 * - `scene` + `svg`: pure snapshot → frame resolution and deterministic
 *   SVG synthesis (flat anime palette, standard pitch markings);
 * - `render`: the two render paths (`renderAnimeFromSnapshot` for the
 *   renderer-contract input; `renderAnimeClip` for snapshot timelines) and
 *   the fail-closed request admission shared by both;
 * - `plugin`: `createAnimePrototypeRenderer` — the `RendererPlugin`
 *   implementation that passes the full W501 conformance harness
 *   (13 checks).
 *
 * Package boundary (isolation rule): runtime dependencies are
 * `@sporta/renderer-contract`, `@sporta/contracts`, and `@sporta/testing`
 * only — no fusion/perception internals, no graphics/ML frameworks, no
 * proprietary game assets. `@sporta/temporal` / `@sporta/world-model` are
 * dev-only (integration tests exercise the W402 `stateAt`/`eventWindow`
 * seams as the snapshot source).
 */
export {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  DEFAULT_DURATION_MS,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  animeCapability,
} from "./identity";
export {
  BALL_STYLE,
  PLAYER_PALETTE,
  animeEntityStyle,
  animeStyleKey,
  fnv1a32,
  opacityFromConfidence,
  round3,
  stableEntityStyle,
} from "./palette";
export type { PlayerStyle } from "./palette";
export {
  CANVAS_H,
  CANVAS_W,
  CAPTION_BAND_H,
  CAPTION_BAND_Y,
  MARGIN,
  PITCH_CENTER_X,
  PITCH_CENTER_Y,
  PITCH_LEFT,
  PITCH_MARKINGS,
  PITCH_RECT,
  PITCH_TOP,
  SCALE,
  classifyPosition,
  round2,
  toCanvas,
  toCanvasRounded,
} from "./geometry";
export type { CanvasPoint, PitchPointMeters, PositionDisposition } from "./geometry";
export {
  EVENT_PHRASES,
  PERIOD_PHRASES,
  SCORE_UNCONFIRMED_MARK,
  STATUS_SEPARATOR,
  STOPPAGE_MARK,
  captionForEvent,
  formatClock,
  scorePart,
  statusLine,
} from "./captions";
export { FIELD_PALETTE, composeFrameSvg, escapeXml, possessionRingSvg } from "./svg";
export type { SvgFrameInput, SvgMarker, SvgPossession } from "./svg";
export { POSITION_SLOT_KEY, resolveFrame } from "./scene";
export type { ResolvedFrame } from "./scene";
export {
  admitRequest,
  deepEqual,
  parseStyleConfig,
  renderAnimeClip,
  renderAnimeFromSnapshot,
} from "./render";
export type { RequestAdmission } from "./render";
export { createAnimePrototypeRenderer } from "./plugin";
export type { AnimePrototypeRenderer } from "./plugin";
export type {
  AnimeCaptionEvent,
  AnimeClipManifest,
  AnimeClipStep,
  AnimeEntityDisposition,
  AnimeEntityEntry,
  AnimeFrame,
  AnimeFrameCaptions,
  AnimeFrameEntry,
  AnimePossessionEntry,
  AnimeRenderOutput,
  AnimeSkippedEvent,
  AnimeStyleConfig,
  AnimeUncaptionedEvent,
} from "./types";
