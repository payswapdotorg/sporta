/**
 * The immutable identity of the avatar/field 3D prototype renderer (W602).
 *
 * Renderer IDs are stable logical identifiers and renderer versions are
 * immutable (docs/contracts/renderer.md, Versioning). This module owns the
 * constants; {@link avatarFieldCapability} composes the deep-equal-stable
 * capability document (R1). Bumping `AVATAR_FIELD_RENDERER_VERSION` is a
 * deliberate restyle: identity-stable entity styling is a pure function of
 * the style key derived from these constants (see `./style.ts`).
 */
import type { OutputProfile, RendererCapability } from "@sporta/contracts";

/** The stable logical renderer id of the avatar/field 3D prototype. */
export const AVATAR_FIELD_RENDERER_ID = "avatar-field.prototype";

/** The immutable renderer version of the avatar/field 3D prototype. */
export const AVATAR_FIELD_RENDERER_VERSION = "0.1.0";

/**
 * The single supported output profile: a 1280×720 SVG frame sequence at
 * 1 fps, offline. The prototype emits self-contained SVG documents — one
 * deterministic perspective projection per frame, no encoder dependency
 * (the W502 precedent; real media encoding is the output pipeline's
 * concern). `codec`/`container` honestly name the artifact format: `svg`.
 */
export const AVATAR_FIELD_OUTPUT_PROFILE: OutputProfile = {
  resolution: { w: 1280, h: 720 },
  frameRate: 1,
  codec: "svg",
  container: "svg",
  latencyClass: "offline",
};

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
 * graphics (a dependency-free perspective camera; see `./camera.ts`).
 *
 * `requiresSourceFrames: false`: this is a pure SWM projection — it needs no
 * source pixels. The fail-closed rights posture (R2 + the plugin's extra
 * carried-refs gate) is documented in `./plugin.ts`.
 */
export function avatarFieldCapability(): RendererCapability {
  return {
    rendererId: AVATAR_FIELD_RENDERER_ID,
    rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
    rendererClass: "procedural-3d",
    supportedOutputProfiles: [AVATAR_FIELD_OUTPUT_PROFILE],
    requiresSourceFrames: false,
    minSnapshotVersion: 0,
  };
}
