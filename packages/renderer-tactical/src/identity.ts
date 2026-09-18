/**
 * The tactical renderer's identity and capability (R301).
 *
 * `tactical.prototype@0.1.0` — a `RendererClass: "tactical"` plugin that
 * consumes the canonical SWM scene (`@sporta/scene-projection`) and produces
 * a REAL h264/MP4 artifact via the package's own deterministic pixel
 * compositor plus the typed ffmpeg codec wrapper. `requiresSourceFrames` is
 * `false`: the tactical view is a pure SWM projection — no source pixels.
 */
import type { OutputProfile, RendererCapability } from "@sporta/contracts";

/** The renderer's stable logical identity. */
export const TACTICAL_RENDERER_ID = "tactical.prototype";

/** The renderer's immutable version. */
export const TACTICAL_RENDERER_VERSION = "0.1.0";

/**
 * The default (fast) profile: 640×360 @ 12.5 fps — small enough for fast
 * deterministic tests, real h264 output. The 1280×720 @ 25 profile is the
 * quality tier.
 */
export const TACTICAL_OUTPUT_PROFILES: readonly OutputProfile[] = [
  {
    resolution: { w: 640, h: 360 },
    frameRate: 12.5,
    codec: "h264",
    container: "mp4",
    latencyClass: "offline",
  },
  {
    resolution: { w: 1280, h: 720 },
    frameRate: 25,
    codec: "h264",
    container: "mp4",
    latencyClass: "offline",
  },
] as const;

/** The immutable capability document (deep-cloned on every `capability()`). */
export const TACTICAL_CAPABILITY: RendererCapability = {
  rendererId: TACTICAL_RENDERER_ID,
  rendererVersion: TACTICAL_RENDERER_VERSION,
  rendererClass: "tactical",
  supportedOutputProfiles: [...TACTICAL_OUTPUT_PROFILES],
  requiresSourceFrames: false,
  minSnapshotVersion: 0,
};

/** The default tactical clip duration (ms) when styleConfig omits it. */
export const DEFAULT_TACTICAL_DURATION_MS = 4_000;

/** The default on-screen event-badge lifetime (ms) for badge animations. */
export const DEFAULT_BADGE_LIFETIME_MS = 1_500;
