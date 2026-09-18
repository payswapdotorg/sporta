/**
 * Rendering-style parameterization of the software scene engine (R302).
 *
 * ONE canonical scene, MANY styles (ADR-009): the scene model
 * (`./scene.ts`) is style-free; a style is purely a MATERIAL + presentation
 * policy — how faces are shaded, whether silhouettes get outlines, and the
 * background tone. The two initial styles demonstrate the strategy the 3D
 * Game renderer (R303) and the Anime/NPR renderer (R304) build on: they
 * consume the SAME scene and produce visibly different frames.
 *
 * - `"stylized-3d"` — smooth-ish Lambert shading (ambient + diffuse) with a
 *   light sky gradient tone; the "game 3D" look.
 * - `"cel-shaded"` — the SAME geometry with two-band quantized shading and
 *   black silhouette outlines; the anime/NPR look.
 */
import type { GameEngineRenderingStyle } from "@sporta/contracts";
import { clampColor, lerpColor, vec3, type Camera, type Rgb, type Vec3 } from "./raster";

/** The fixed light direction (scene space, pointing FROM the light). */
const LIGHT_DIR: Vec3 = vec3.normalize([-0.45, 0.55, 0.7]);

/** Everything a style needs to rasterize one frame. */
export interface RenderingStyleProfile {
  /** The frozen-vocabulary style id. */
  styleId: GameEngineRenderingStyle;
  /** The default camera (the SAME for both styles — style ≠ camera). */
  defaultCamera: Camera;
  /** The aerial presentation-hint camera (top-down, the W601 tactical slot). */
  aerialCamera: Camera;
  /** The sky/clear color. */
  sky: Rgb;
  /** The ground color beyond the pitch. */
  surround: Rgb;
  /** The pitch grass tone. */
  grass: Rgb;
  /** Shades one face: base color + face normal → final color. */
  shadeFace(base: Rgb, normal: Vec3): Rgb;
  /** Whether silhouette edges are stroked black (the cel/NPR outline pass). */
  outline: boolean;
  /** The HUD accent color. */
  hudAccent: Rgb;
}

/** Lambert intensity in [0, 1] for one face normal. */
function lambertIntensity(normal: Vec3): number {
  return Math.max(0, vec3.dot(normal, LIGHT_DIR));
}

/** `stylized-3d`: ambient + diffuse Lambert, no outlines. */
function shadeStylized(base: Rgb, normal: Vec3): Rgb {
  const intensity = 0.4 + 0.6 * lambertIntensity(normal);
  return clampColor([base[0] * intensity, base[1] * intensity, base[2] * intensity]);
}

/** `cel-shaded`: two-band quantized intensity + (outline pass at raster time). */
function shadeCel(base: Rgb, normal: Vec3): Rgb {
  const intensity = lambertIntensity(normal) < 0.45 ? 0.55 : 1.0;
  return clampColor([base[0] * intensity, base[1] * intensity, base[2] * intensity]);
}

/** The broadcast-ish 3/4 view both styles share (a style is not a camera). */
const DEFAULT_CAMERA: Camera = {
  position: [52.5, -34, 30],
  target: [52.5, 34, 0],
  fovRadians: (50 * Math.PI) / 180,
};

/** The top-down aerial view (the W601 `aerial-tactical` camera slot). */
const AERIAL_CAMERA: Camera = {
  position: [52.5, 34, 60],
  target: [52.5, 34, 0],
  fovRadians: (55 * Math.PI) / 180,
};

/** The style table. IMMUTABLE: restyling rides an adapter version bump. */
export const RENDERING_STYLE_PROFILES: Record<string, RenderingStyleProfile> = {
  "stylized-3d": {
    styleId: "stylized-3d",
    defaultCamera: DEFAULT_CAMERA,
    aerialCamera: AERIAL_CAMERA,
    sky: lerpColor([52, 74, 88], [120, 150, 160], 0.5),
    surround: [34, 40, 42],
    grass: [46, 98, 52],
    shadeFace: shadeStylized,
    outline: false,
    hudAccent: [240, 200, 74],
  },
  "cel-shaded": {
    styleId: "cel-shaded",
    defaultCamera: DEFAULT_CAMERA,
    aerialCamera: AERIAL_CAMERA,
    sky: [232, 226, 210],
    surround: [58, 62, 60],
    grass: [72, 132, 78],
    shadeFace: shadeCel,
    outline: true,
    hudAccent: [214, 79, 79],
  },
};

/** The style ids this engine build supports (frozen vocabulary subset). */
export const SUPPORTED_RENDERING_STYLES: readonly GameEngineRenderingStyle[] = [
  "stylized-3d",
  "cel-shaded",
];

/** Looks up a style profile (throws for unknown ids — fail loud). */
export function styleProfileOf(styleId: string): RenderingStyleProfile {
  const profile = RENDERING_STYLE_PROFILES[styleId];
  if (profile === undefined) {
    throw new RangeError(`unknown rendering style "${styleId}"`);
  }
  return profile;
}
