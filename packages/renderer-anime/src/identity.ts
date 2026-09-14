/**
 * The immutable identity of the anime prototype renderer (W502).
 *
 * Renderer IDs are stable logical identifiers and renderer versions are
 * immutable (docs/contracts/renderer.md, Versioning). This module owns the
 * constants; {@link animeCapability} composes the deep-equal-stable
 * capability document (R1). Bumping `ANIME_RENDERER_VERSION` is a
 * deliberate restyle: identity-stable entity styling is a pure function of
 * the style key derived from these constants (see `./palette.ts`).
 */
import type { OutputProfile, RendererCapability } from "@sporta/contracts";

/** The stable logical renderer id of the anime prototype. */
export const ANIME_RENDERER_ID = "anime.prototype";

/** The immutable renderer version of the anime prototype. */
export const ANIME_RENDERER_VERSION = "0.1.0";

/**
 * The single supported output profile: a 1170×880 SVG frame sequence at
 * 1 fps, offline. The prototype emits SVG documents (deterministic
 * procedural graphics — no encoder dependency); real media encoding is the
 * W504 output-pipeline concern. `codec`/`container` honestly name the
 * artifact format: `svg`.
 */
export const ANIME_OUTPUT_PROFILE: OutputProfile = {
  resolution: { w: 1170, h: 880 },
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
 * The immutable capability document (a fresh clone per call — R1 deep-equal
 * stability; hosts must not rely on reference identity).
 *
 * `rendererClass: "procedural-3d"` follows the contract's class list: the
 * prototype projects SWM state into a synthetic world and renders it with
 * deterministic graphics (the "Procedural/3D renderer" class in
 * docs/contracts/renderer.md; the projection is 2D here, the class is the
 * deterministic-graphics bucket, not a claim about dimensionality).
 *
 * `requiresSourceFrames: false`: the anime prototype is a pure SWM
 * projection — it needs no source pixels. The fail-closed rights posture
 * (R2 + the plugin's extra gate) is documented in `./plugin.ts`.
 */
export function animeCapability(): RendererCapability {
  return {
    rendererId: ANIME_RENDERER_ID,
    rendererVersion: ANIME_RENDERER_VERSION,
    rendererClass: "procedural-3d",
    supportedOutputProfiles: [ANIME_OUTPUT_PROFILE],
    requiresSourceFrames: false,
    minSnapshotVersion: 0,
  };
}
