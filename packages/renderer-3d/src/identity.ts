/**
 * The immutable identity of the avatar/field 3D prototype renderer
 * (W602, extended in place by W603).
 *
 * Renderer IDs are stable logical identifiers and renderer versions are
 * immutable (docs/contracts/renderer.md, Versioning). This module owns the
 * constants; {@link avatarFieldCapability} composes the deep-equal-stable
 * capability document (R1). Bumping `AVATAR_FIELD_RENDERER_VERSION` is a
 * deliberate restyle: identity-stable entity styling is a pure function of
 * the style key derived from these constants (see `./style.ts`).
 *
 * **The 0.2.0 bump (W603)**: the capability gained the animated output
 * profiles (5 and 25 fps — additive), so 0.1.0's immutable capability could
 * not simply change under the same version. The bump follows the W602
 * documented restyle semantics: the style key re-keys
 * (`avatar-field.prototype:0.2.0`), palette assignments shift per entity,
 * and identity stability remains a WITHIN-version property across frames
 * (the no-flicker rule, unchanged).
 */
import type { OutputProfile, RendererCapability } from "@sporta/contracts";

/** The stable logical renderer id of the avatar/field 3D prototype. */
export const AVATAR_FIELD_RENDERER_ID = "avatar-field.prototype";

/** The immutable renderer version of the avatar/field prototype (W603 bump). */
export const AVATAR_FIELD_RENDERER_VERSION = "0.2.0";

/**
 * The W602 output profile (unchanged): a 1280×720 SVG frame sequence at
 * 1 fps, offline — one deterministic perspective projection per frame, no
 * encoder dependency (the W502 precedent; real media encoding is the
 * output pipeline's concern). `codec`/`container` honestly name the
 * artifact format: `svg`.
 */
export const AVATAR_FIELD_OUTPUT_PROFILE: OutputProfile = {
  resolution: { w: 1280, h: 720 },
  frameRate: 1,
  codec: "svg",
  container: "svg",
  latencyClass: "offline",
};

/**
 * The W603 animated review profile: the same 1280×720 SVG documents at
 * 5 fps (200 ms frame interval) — a hand-inspectable animation cadence for
 * the interpolated match timeline (fractions land on 0.2 steps between
 * 1 s snapshots, directly verifiable by hand).
 */
export const AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE: OutputProfile = {
  resolution: { w: 1280, h: 720 },
  frameRate: 5,
  codec: "svg",
  container: "svg",
  latencyClass: "offline",
};

/**
 * The W603 game-style profile: the same 1280×720 SVG documents at 25 fps
 * (40 ms frame interval) — the game-style playback cadence for the
 * interpolated match timeline (W603: "match progression rendered from SWM
 * rather than replaying broadcast pixels").
 */
export const AVATAR_FIELD_GAME_OUTPUT_PROFILE: OutputProfile = {
  resolution: { w: 1280, h: 720 },
  frameRate: 25,
  codec: "svg",
  container: "svg",
  latencyClass: "offline",
};

/**
 * The per-render frame budget: at most 3600 frames per render call (the
 * W602 worst case — 1 fps × the 3 600 000 ms maximum duration — now the
 * UNIVERSAL bound across every profile). A 25 fps render may therefore
 * span at most 144 s per call; longer animated timelines are the
 * watermark-batched orchestration seam's concern (W304 renders in bounded
 * batches — each `render` call stays inside this budget). Exceeding the
 * budget is a fail-loud `media-invalid` (bounded render work, never a
 * memory runaway).
 */
export const MAX_RENDER_FRAMES = 3_600;

/** Default rendered clip duration in milliseconds (style-config default). */
export const DEFAULT_DURATION_MS = 6_000;

/** Minimum accepted clip duration in milliseconds. */
export const MIN_DURATION_MS = 1;

/** Maximum accepted clip duration in milliseconds (bounded render work). */
export const MAX_DURATION_MS = 3_600_000;

/**
 * The camera slot rendered from when the style configuration names none —
 * `main-touchline`, the classic broadcast framing. A DOCUMENTED PRESENTATION
 * DEFAULT, not a direction policy: the renderer never CHOOSES between slots
 * based on scene content or events (that is W604's camera-director concern);
 * callers that want an explicit frame pass `styleConfig.config.cameraSlotId`.
 */
export const DEFAULT_CAMERA_SLOT_ID = "main-touchline";

/**
 * The immutable capability document (a fresh clone per call — R1 deep-equal
 * stability; hosts must not rely on reference identity).
 *
 * `rendererClass: "procedural-3d"` is the contract's "Procedural/3D
 * renderer" class — and here it is literal: the plugin projects SWM state
 * into the W601 synthetic 3D scene and renders it with deterministic
 * graphics (a dependency-free perspective camera; see `./camera.ts`), and
 * since W603 interpolates deterministic constant-velocity motion between
 * snapshots (still pure graphics — no engine, no physics integration).
 *
 * `supportedOutputProfiles` lists the W602 1 fps profile FIRST (the
 * historical default — profile order is capability data, not preference)
 * followed by the W603 animated profiles (5 and 25 fps).
 *
 * `requiresSourceFrames: false`: this is a pure SWM projection — it needs
 * no source pixels. The fail-closed rights posture (R2 + the plugin's
 * extra carried-refs gate) is documented in `./plugin.ts`.
 */
export function avatarFieldCapability(): RendererCapability {
  return {
    rendererId: AVATAR_FIELD_RENDERER_ID,
    rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
    rendererClass: "procedural-3d",
    supportedOutputProfiles: [
      AVATAR_FIELD_OUTPUT_PROFILE,
      AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
      AVATAR_FIELD_GAME_OUTPUT_PROFILE,
    ],
    requiresSourceFrames: false,
    minSnapshotVersion: 0,
  };
}
