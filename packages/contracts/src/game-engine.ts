/**
 * Game-engine adapter contracts — Wave-0 freeze of the game-engine renderer
 * seam (R302, ADR-009: the initial candidate is Godot 4, but the engine is
 * REPLACEABLE behind this contract — no engine name may appear in it).
 *
 * Layering: a game engine is NOT a renderer plugin. The renderer
 * (`@sporta/renderer-contract` RendererPlugin) is the product-facing plugin
 * seam; a game-engine adapter is the SECOND-level, provider-neutral seam a
 * renderer implementation may delegate scene construction and frame/video
 * production to. This keeps "which engine" out of the renderer contract
 * while allowing the 3D Game (R303) and Anime/NPR (R304) renderers to share
 * one canonical SWM scene.
 *
 * Data flow (all inputs are validated plain documents from
 * `@sporta/contracts`; an engine adapter never receives live engine
 * internals — architecture-lock §5):
 *
 * ```text
 * SWM snapshot + events
 *   -> buildScene()          (scene handle bound to the snapshot watermark)
 *   -> applySceneEvents()    (event-driven presentation updates)
 *   -> renderScene()         (frames or pre-encoded segments + telemetry)
 *   -> codec/output pipeline (RenderArtifactManifest, media-artifact.ts)
 * ```
 *
 * Provenance honesty (renderer contract R5/R6/R7 mirrored here): the render
 * result MUST report the snapshot version and the highest event sequence
 * actually applied, and degradation MUST be explicit.
 */
import { z } from "zod";
import { schemaVersionField } from "./versioning";
import type { WorldEventStreamEntry, WorldSnapshot } from "./world-model";

/** Rendering styles an engine may support (additive vocabulary). */
export const GameEngineRenderingStyle = z.enum([
  "stylized-3d",
  "cel-shaded",
  "npr",
  "photorealistic-lite",
]);
export type GameEngineRenderingStyle = z.infer<typeof GameEngineRenderingStyle>;

/** The neutral descriptor every game-engine adapter must expose. */
export const GameEngineDescriptor = z.object({
  schemaVersion: schemaVersionField,
  /** Abstract kind marker (closed at "game-engine" — never a vendor name). */
  engineKind: z.literal("game-engine"),
  engineId: z.string().min(1),
  engineVersion: z.string().min(1),
  adapterVersion: z.string().min(1),
  renderingStyles: z.array(GameEngineRenderingStyle).min(1),
  /** Maximum concurrent scene entities the engine supports. */
  maxConcurrentEntities: z.number().int().positive(),
  /** Output formats the adapter can produce (e.g. "frames-rgb24", "mp4-h264"). */
  outputFormats: z.array(z.string().min(1)).min(1),
});
export type GameEngineDescriptor = z.infer<typeof GameEngineDescriptor>;

/** The scene-construction request: a canonical SWM snapshot + ordered events. */
export const GameSceneBuildRequest = z.object({
  schemaVersion: schemaVersionField,
  sessionId: z.string().min(1),
  snapshotVersion: z.number().int().min(0),
  /** Requested rendering style (must be in the descriptor's styles). */
  renderingStyle: GameEngineRenderingStyle,
});
export type GameSceneBuildRequest = z.infer<typeof GameSceneBuildRequest>;

/** The handle to a built scene (the engine keeps its own scene state). */
export const GameSceneHandle = z.object({
  sceneId: z.string().min(1),
  sessionId: z.string().min(1),
  /** The snapshot version the scene was built from. */
  snapshotVersion: z.number().int().min(0),
  /** The highest event sequence applied into the scene at build time. */
  appliedEventSequence: z.number().int().min(0),
  entityCount: z.number().int().min(0),
});
export type GameSceneHandle = z.infer<typeof GameSceneHandle>;

/** The result of applying events to a built scene. */
export const GameSceneUpdateResult = z.object({
  appliedEventSequence: z.number().int().min(0),
  /** Events that were NOT applied (outside the scene's supported envelope). */
  skippedEvents: z.number().int().min(0),
  degraded: z.boolean(),
  degradationReason: z.string().min(1).optional(),
});
export type GameSceneUpdateResult = z.infer<typeof GameSceneUpdateResult>;

/** Output profile for a scene render. */
export const GameSceneOutputProfile = z.object({
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  fps: z.number().positive(),
  durationMs: z.number().int().positive(),
  /** Engine output format id (must be in the descriptor's outputFormats). */
  format: z.string().min(1),
});
export type GameSceneOutputProfile = z.infer<typeof GameSceneOutputProfile>;

/** Raw frame output staged for the codec pipeline. */
export const GameEngineFrameOutput = z.object({
  kind: z.literal("frame-output"),
  /** Reference to the staged frame sequence (never inline pixels). */
  stagingRef: z.string().min(1),
  frameCount: z.number().int().positive(),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  fps: z.number().positive(),
  pixelFormat: z.enum(["rgb24", "rgba32", "png-sequence"]),
});
export type GameEngineFrameOutput = z.infer<typeof GameEngineFrameOutput>;

/** Pre-encoded segment output (engine-side encoding). */
export const GameEngineEncodedSegment = z.object({
  segmentId: z.string().min(1),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  artifactRef: z.string().min(1),
  container: z.string().min(1),
  codec: z.string().min(1),
});
export type GameEngineEncodedSegment = z.infer<typeof GameEngineEncodedSegment>;

export const GameEngineEncodedOutput = z.object({
  kind: z.literal("encoded-output"),
  segments: z.array(GameEngineEncodedSegment).min(1),
});
export type GameEngineEncodedOutput = z.infer<typeof GameEngineEncodedOutput>;

/** A render produces EXACTLY ONE output kind. */
export const GameEngineRenderOutput = z.discriminatedUnion("kind", [
  GameEngineFrameOutput,
  GameEngineEncodedOutput,
]);
export type GameEngineRenderOutput = z.infer<typeof GameEngineRenderOutput>;

/** Render telemetry (honest counters — never fabricated). */
export const GameEngineRenderTelemetry = z.object({
  renderMs: z.number().int().min(0),
  framesRendered: z.number().int().min(0),
  droppedFrames: z.number().int().min(0),
});
export type GameEngineRenderTelemetry = z.infer<typeof GameEngineRenderTelemetry>;

/** The full render result with provenance (mirror of renderer R5/R6/R7). */
export const GameSceneRenderResult = z.object({
  output: GameEngineRenderOutput,
  telemetry: GameEngineRenderTelemetry,
  provenance: z.object({
    snapshotVersion: z.number().int().min(0),
    lastEventSequence: z.number().int().min(0),
  }),
  degraded: z.boolean(),
  degradationReason: z.string().min(1).optional(),
});
export type GameSceneRenderResult = z.infer<typeof GameSceneRenderResult>;

/** The render request: a built scene + output profile + presentation hints. */
export const GameSceneRenderRequest = z.object({
  schemaVersion: schemaVersionField,
  sceneId: z.string().min(1),
  outputProfile: GameSceneOutputProfile,
  /** Presentation hints (e.g. camera behavior keys) — engine-interpreted. */
  presentation: z.record(z.string(), z.string()).optional(),
});
export type GameSceneRenderRequest = z.infer<typeof GameSceneRenderRequest>;

/**
 * THE provider-neutral game-engine seam (type-level interface — the concrete
 * adapters live behind it in their own packages). Product/domain code never
 * references an engine by name; the initial implementation is an
 * implementation choice behind this seam.
 */
export interface GameEngineAdapter {
  /** The immutable descriptor (deep-equal on every call). */
  describe(): MaybePromise<GameEngineDescriptor>;
  /**
   * Build a scene from an SWM snapshot (+ the events to apply after the
   * snapshot watermark). The handle reports the applied sequence honestly.
   */
  buildScene(
    request: GameSceneBuildRequest,
    snapshot: WorldSnapshot,
    events: WorldEventStreamEntry[],
  ): MaybePromise<GameSceneHandle>;
  /** Apply ordered events to a built scene; skipped events are counted. */
  applySceneEvents(
    handle: GameSceneHandle,
    events: WorldEventStreamEntry[],
  ): MaybePromise<GameSceneUpdateResult>;
  /** Render the scene: frames for the codec pipeline, or encoded segments. */
  renderScene(request: GameSceneRenderRequest): MaybePromise<GameSceneRenderResult>;
}

/** Plugin lifecycle and render methods may resolve synchronously or not. */
export type MaybePromise<T> = T | Promise<T>;
