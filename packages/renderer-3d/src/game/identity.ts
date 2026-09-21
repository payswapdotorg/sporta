/**
 * The immutable identities, capabilities, and budgets of the R303/R304
 * engine-consumer renderers (`game-3d.prototype` / `anime-npr.prototype`)
 * and of their shared reference engine (`sporta.software-3d`).
 *
 * Layering (the frozen `@sporta/contracts` game-engine seam): BOTH renderer
 * plugins are `RendererPlugin`s (W501) whose scene input is the canonical
 * SWM — projected through W601 `projectScene` INSIDE the engine adapter —
 * and whose pixel/video production is delegated to one
 * {@link GameEngineAdapter} implementation (`Software3DEngine`, the
 * reference software engine; a headless Godot 4 swap is the documented
 * future behind the same seam, NOT part of this wave).
 *
 * Honesty posture shared by both identities:
 *
 * - `requiresSourceFrames: false` — a pure SWM → scene → pixels pipeline;
 *   no source video pixels are consumed (plus the fail-closed carried-refs
 *   gate documented in `./plugin.ts`);
 * - output profiles are REAL playable MP4 profiles (h264 in mp4, yuv420p,
 *   baseline profile — HTML5 `<video>` compatible); the profile list is
 *   capability data, not preference (the SD profile is first: the
 *   historical default the W501 conformance harness probes);
 * - `rendererVersion` is immutable per the contract; both plugins started at
 *   `0.1.0`. The Anime/NPR renderer moved to `0.2.0` with the Wave-3
 *   default-profile slimming (see {@link ANIME_MP4_SD_TWOS_PROFILE}) — a
 *   deliberate restyle in the identity.ts doctrine's own words, so the
 *   version the old capability advertised stays what it was.
 */
import type { GameEngineDescriptor, OutputProfile, RendererCapability } from "@sporta/contracts";
import { SCHEMA_VERSION } from "@sporta/contracts";

/** The stable logical renderer id of the R303 3D game-style renderer. */
export const GAME_3D_RENDERER_ID = "game-3d.prototype";

/** The immutable renderer version of the R303 renderer. */
export const GAME_3D_RENDERER_VERSION = "0.1.0";

/** The stable logical renderer id of the R304 Anime/NPR renderer. */
export const ANIME_NPR_RENDERER_ID = "anime-npr.prototype";

/** The immutable renderer version of the R304 renderer (0.2.0 since the Wave-3 default-profile slimming). */
export const ANIME_NPR_RENDERER_VERSION = "0.2.0";

/** The engine id of the reference software 3D engine (R302 seam consumer). */
export const SOFTWARE_3D_ENGINE_ID = "sporta.software-3d";

/** The engine version of the reference software 3D engine. */
export const SOFTWARE_3D_ENGINE_VERSION = "1.0.0";

/** The adapter version of the reference software 3D engine. */
export const SOFTWARE_3D_ADAPTER_VERSION = "1.0.0";

/** The reference engine's frame output format id (raw rgb24 byte stream). */
export const SOFTWARE_3D_OUTPUT_FORMAT = "frames-rgb24";

/**
 * The SD output profile (the DEFAULT profile — first in both capability
 * lists): 640×360 @ 25 fps, h264 in mp4, offline. A REAL playable MP4
 * profile sized for the software engine's bounded render budget.
 */
export const GAME_MP4_SD_PROFILE: OutputProfile = {
  resolution: { w: 640, h: 360 },
  frameRate: 25,
  codec: "h264",
  container: "mp4",
  latencyClass: "offline",
};

/**
 * The HD output profile: 1280×720 @ 25 fps, h264 in mp4, offline — the
 * product-facing cadence for hosts with render budget (roughly 4× the SD
 * pixel cost; still bounded by the frame budget).
 */
export const GAME_MP4_HD_PROFILE: OutputProfile = {
  resolution: { w: 1280, h: 720 },
  frameRate: 25,
  codec: "h264",
  container: "mp4",
  latencyClass: "offline",
};

/**
 * The per-render frame budget of the reference engine: at most
 * {@link MAX_ENGINE_FRAMES} frames per `renderScene` call (2400 = the
 * 20 000 ms maximum duration at 25 fps, with headroom). A render implying
 * more frames TRUNCATES to the budget with an explicit degraded flag and
 * an honest `droppedFrames` count (never a memory runaway, never silent).
 */
export const MAX_ENGINE_FRAMES = 2_400;

/**
 * The maximum number of scene entities the reference engine carries per
 * scene (the descriptor's `maxConcurrentEntities`). Above the envelope the
 * engine renders the FIRST N projected entities and reports degradation
 * with an explicit reason (never a silent drop — the W502 accounted
 * disposition posture).
 */
export const MAX_SCENE_ENTITIES = 64;

/** The maximum number of concurrently live scenes per engine instance. */
export const MAX_LIVE_SCENES = 256;

/** Default rendered clip duration in milliseconds (style-config default). */
export const GAME_DEFAULT_DURATION_MS = 4_000;

/** Minimum accepted clip duration in milliseconds. */
export const GAME_MIN_DURATION_MS = 200;

/** Maximum accepted clip duration in milliseconds (bounded render work). */
export const GAME_MAX_DURATION_MS = 20_000;

/** The default camera behavior key when the style configuration names none. */
export const GAME_DEFAULT_CAMERA = "aerial-follow" as const;

/** The closed camera-behavior vocabulary the engine interprets. */
export const GAME_CAMERA_KEYS = ["aerial-follow", "sideline-follow"] as const;

/** A camera behavior key from the closed vocabulary. */
export type GameCameraKey = (typeof GAME_CAMERA_KEYS)[number];

/** The parsed style configuration shared by both plugins. */
export interface GameStyleConfig {
  /** Clip duration in milliseconds (bounded by the documented min/max). */
  durationMs: number;
  /** Camera behavior key (presentation hint forwarded to the engine). */
  camera: GameCameraKey;
  /**
   * Presentation seed (deterministic cosmetic variation: stripe phase,
   * halftone dither, speed-line angles). Any integer is accepted; the same
   * seed + the same SWM input produce byte-identical artifacts.
   */
  seed: number;
}

/**
 * The immutable capability document of the R303 3D game-style renderer.
 * `rendererClass: "procedural-3d"` is literal: SWM → W601 scene →
 * deterministic software 3D rasterization through the engine seam.
 */
export function game3dCapability(): RendererCapability {
  return {
    rendererId: GAME_3D_RENDERER_ID,
    rendererVersion: GAME_3D_RENDERER_VERSION,
    rendererClass: "procedural-3d",
    supportedOutputProfiles: [GAME_MP4_SD_PROFILE, GAME_MP4_HD_PROFILE],
    requiresSourceFrames: false,
    minSnapshotVersion: 0,
  };
}

/**
 * The Anime/NPR DEFAULT profile (Wave-3, first in the anime capability's
 * list): the SAME SD geometry at 12 fps — "on twos", the traditional
 * cel-animation cadence (each animation frame held for two film frames).
 *
 * WHY THIS PROFILE EXISTS (the J013 honest finding, resolved renderer-side):
 * the populated-pitch cel-shaded render at the previous default (SD @ 25 fps
 * × the 4 000 ms default duration = 100 frames) measured 1 038 993–1 082 922
 * bytes through the real pipeline — OVER the hosted compute plane's
 * fail-closed 1 000 000-byte artifact budget (packages/compute-adapter-
 * hosted/src/budgets.ts, the platform guardrail this renderer must fit at
 * its DEFAULTS — the budget itself is TL-gated and untouched). The frame
 * BUDGET is the renderer-local knob: 12 fps × 4 000 ms = 48 frames, and the
 * same real-pipeline measurements land at 650 036–671 203 bytes (≈ 65 % of
 * the budget — real margin against content variance, not a shaved pass).
 *
 * THE HONEST QUALITY TRADE-OFF: motion renders at half the temporal
 * resolution of the historical SD profile (12 fps instead of 25 fps). This
 * is BOTH a budget fit AND the authentic cel-animation cadence (anime is
 * traditionally animated on twos) — but it is still a real trade-off and is
 * documented as one (docs/research/l014-anime-budget-resolution.md). The
 * historical SD @ 25 fps and HD @ 25 fps profiles REMAIN SUPPORTED (explicit
 * requests for them are honored; an explicit heavier profile may still
 * exceed the platform budget and fail closed there — the guardrail's own
 * honest answer, never a renderer-side silent downgrade).
 *
 * Determinism pins are unchanged: the same profile + the same SWM input
 * produce byte-identical artifacts (the codec argv is the frozen template;
 * the profile only feeds the frame-source geometry/framerate inputs).
 */
export const ANIME_MP4_SD_TWOS_PROFILE: OutputProfile = {
  resolution: { w: 640, h: 360 },
  frameRate: 12,
  codec: "h264",
  container: "mp4",
  latencyClass: "offline",
};

/**
 * The immutable capability document of the R304 Anime/NPR renderer.
 * `rendererClass: "stylized-video"`: the same SWM scene through the same
 * engine seam, presented with the cel-shaded/NPR style (flat two-tone
 * shading, bold outlines, posterized palette, halftone pitch, speed-line
 * accents) — the ADR-009 visibly-different reality.
 */
export function animeNprCapability(): RendererCapability {
  return {
    rendererId: ANIME_NPR_RENDERER_ID,
    rendererVersion: ANIME_NPR_RENDERER_VERSION,
    rendererClass: "stylized-video",
    supportedOutputProfiles: [ANIME_MP4_SD_TWOS_PROFILE, GAME_MP4_SD_PROFILE, GAME_MP4_HD_PROFILE],
    requiresSourceFrames: false,
    minSnapshotVersion: 0,
  };
}

/**
 * The immutable descriptor of the reference software 3D engine (deep-equal
 * on every `describe()` call — the frozen seam's requirement).
 */
export function software3dDescriptor(): GameEngineDescriptor {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineKind: "game-engine",
    engineId: SOFTWARE_3D_ENGINE_ID,
    engineVersion: SOFTWARE_3D_ENGINE_VERSION,
    adapterVersion: SOFTWARE_3D_ADAPTER_VERSION,
    renderingStyles: ["stylized-3d", "cel-shaded"],
    maxConcurrentEntities: MAX_SCENE_ENTITIES,
    outputFormats: [SOFTWARE_3D_OUTPUT_FORMAT],
  };
}
