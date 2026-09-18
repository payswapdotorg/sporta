/**
 * The reference `GameEngineAdapter` implementation (R302): the
 * `SoftwareSceneEngine` — an in-repo deterministic software 3D-ish compositor
 * behind the frozen provider-neutral seam (`@sporta/contracts`
 * `GameEngineAdapter`).
 *
 * ENGINE NEUTRALITY: the engine id (`sporta.software-raster`) is a neutral
 * self-description, never a vendor name; product/domain code references only
 * the frozen seam. The engine is REPLACEABLE — the documented next-wave
 * upgrade is headless Godot 4 (ADR-009's initial engine candidate), swapped
 * in behind this same seam without touching any consumer.
 *
 * Data flow (the frozen seam's documented flow):
 *
 * ```text
 * SWM snapshot + events
 *   -> buildScene()          (scene handle bound to the snapshot watermark)
 *   -> applySceneEvents()    (event-driven presentation updates)
 *   -> renderScene()         (frames or pre-encoded segments + telemetry)
 *   -> codec/output pipeline (RenderArtifactManifest, media-artifact.ts)
 * ```
 *
 * Honesty rules (mirroring renderer R5/R6/R7):
 * - the handle reports the applied event sequence honestly (the snapshot
 *   watermark plus every actually-applied event; replays are idempotent
 *   no-ops, unsupported events are counted and surface as degradation at
 *   render time — never silently dropped);
 * - `renderScene` reports the snapshot version and the highest applied
 *   sequence in `provenance`, and EXACTLY ONE output kind;
 * - telemetry counters are measured, never fabricated: `renderMs` comes
 *   from the injected clock seam (the default clock is the deterministic
 *   `TEST_EPOCH_MS + ticks` — production hosts inject a real one, the
 *   output-pipeline precedent), `framesRendered`/`droppedFrames` are the
 *   true raster accounting (a frame budget overrun drops frames and
 *   degrades loudly);
 * - `frames-rgb24` output stages REAL raw frame bytes on disk under a
 *   DECLARED staging root (never inline pixels, never phantom refs).
 */
import {
  GameSceneBuildRequest,
  GameSceneRenderRequest,
  GameSceneUpdateResult,
  GameEngineDescriptor,
  WorldEventStreamEntry,
  WorldSnapshot,
  SCHEMA_VERSION,
} from "@sporta/contracts";
import type {
  GameEngineAdapter,
  GameEngineRenderOutput,
  GameSceneHandle,
  GameSceneRenderResult,
} from "@sporta/contracts";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GameEngineAdapterError } from "./errors";
import { DepthRaster, fnv1a32, type Rgb, type Vec3 } from "./raster";
import { SUPPORTED_RENDERING_STYLES, styleProfileOf, type RenderingStyleProfile } from "./styles";
import { applyEventsToScene, buildSceneState, type SceneState } from "./scene";

/** Parses a request through its frozen schema, wrapping failures in the typed error. */
function parseOrThrow<T>(
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
  },
  value: unknown,
  code: "invalid-build-request" | "invalid-output-profile",
  what: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new GameEngineAdapterError(
      `${what} does not parse against its frozen contract schema`,
      code,
      { issues: parsed.error.issues.map((issue) => issue.message).slice(0, 3) },
    );
  }
  return parsed.data;
}

/** The neutral engine identity of this build (never a vendor name). */
export const SOFTWARE_ENGINE_ID = "sporta.software-raster";

/** The engine build version. */
export const SOFTWARE_ENGINE_VERSION = "1";

/** The adapter version. */
export const SOFTWARE_ADAPTER_VERSION = "0.1.0";

/** The one output format this engine build stages. */
export const SOFTWARE_ENGINE_FORMAT = "frames-rgb24";

/** The default maximum concurrent scene entities. */
export const DEFAULT_MAX_CONCURRENT_ENTITIES = 64;

/** The default per-render frame budget (overruns drop frames, loudly). */
export const DEFAULT_MAX_FRAMES_PER_RENDER = 10_000;

/** The engine's entity palette (identity-stable via fnv1a32, 8 entries). */
const ENGINE_PALETTE: readonly Rgb[] = [
  [214, 79, 79],
  [232, 135, 58],
  [240, 200, 74],
  [63, 174, 122],
  [142, 91, 192],
  [201, 79, 142],
  [216, 216, 200],
  [94, 60, 36],
];

/** The ball's base color. */
const BALL_COLOR: Rgb = [251, 251, 244];

/** The pitch line color. */
const LINE_COLOR: Rgb = [240, 243, 233];

/** The outline color for cel shading. */
const OUTLINE_COLOR: Rgb = [16, 18, 20];

/** Options for {@link SoftwareSceneEngine}. */
export interface SoftwareSceneEngineOptions {
  /**
   * The DECLARED staging root for rendered frame sequences
   * (`<root>/frames/<stagingRef>.rgb24`). Required — the engine never
   * writes to an implicit working directory.
   */
  stagingDir: string;
  /** Maximum concurrent scene entities (default 64; over-capacity builds fail loud). */
  maxConcurrentEntities?: number;
  /** Per-render frame budget (default 10000; overruns drop frames + degrade). */
  maxFramesPerRender?: number;
  /**
   * The clock in epoch milliseconds (default: the deterministic
   * `TEST_EPOCH_MS + ticks` seam — production hosts MUST inject a real wall
   * clock, the output-pipeline precedent).
   */
  nowMs?: () => number;
}

/** The scene's staged frame sequence record (package-level detail surface). */
export interface StagedFrameSequence {
  /** The staging reference (an absolute file path). */
  stagingRef: string;
  frameCount: number;
  widthPx: number;
  heightPx: number;
  fps: number;
  pixelFormat: "rgb24";
  /** The staged byte length (frameCount × w × h × 3 — measured, not asserted). */
  byteLength: number;
}

/**
 * The reference adapter. All methods are synchronous (the conformance
 * harness is synchronous, the W501 precedent); the `MaybePromise` seam
 * types accept that covariantly.
 */
export class SoftwareSceneEngine implements GameEngineAdapter {
  private readonly scenes = new Map<string, SceneState>();
  private readonly stagingFramesDir: string;
  private readonly maxConcurrentEntities: number;
  private readonly maxFramesPerRender: number;
  private ticks = 0;
  private readonly nowMs: () => number;

  constructor(options: SoftwareSceneEngineOptions) {
    if (typeof options.stagingDir !== "string" || options.stagingDir.length < 1) {
      throw new GameEngineAdapterError(
        "SoftwareSceneEngine requires a declared stagingDir",
        "staging-unavailable",
      );
    }
    this.stagingFramesDir = join(options.stagingDir, "frames");
    mkdirSync(this.stagingFramesDir, { recursive: true });
    this.maxConcurrentEntities = options.maxConcurrentEntities ?? DEFAULT_MAX_CONCURRENT_ENTITIES;
    this.maxFramesPerRender = options.maxFramesPerRender ?? DEFAULT_MAX_FRAMES_PER_RENDER;
    this.ticks = 0;
    this.nowMs =
      options.nowMs ??
      ((): number => {
        this.ticks += 1;
        return TEST_EPOCH_MS + this.ticks;
      });
  }

  /** R1-mirror: the immutable descriptor, deep-equal on every call. */
  describe(): GameEngineDescriptor {
    return GameEngineDescriptor.parse({
      schemaVersion: SCHEMA_VERSION,
      engineKind: "game-engine",
      engineId: SOFTWARE_ENGINE_ID,
      engineVersion: SOFTWARE_ENGINE_VERSION,
      adapterVersion: SOFTWARE_ADAPTER_VERSION,
      renderingStyles: [...SUPPORTED_RENDERING_STYLES],
      maxConcurrentEntities: this.maxConcurrentEntities,
      outputFormats: [SOFTWARE_ENGINE_FORMAT],
    });
  }

  /** Builds a scene from an SWM snapshot + the initial event tail. */
  buildScene(
    request: GameSceneBuildRequest,
    snapshot: WorldSnapshot,
    events: WorldEventStreamEntry[],
  ): GameSceneHandle {
    const parsed = parseOrThrow(
      GameSceneBuildRequest,
      request,
      "invalid-build-request",
      "the build request",
    );
    const descriptor = this.describe();
    if (!descriptor.renderingStyles.includes(parsed.renderingStyle)) {
      throw new GameEngineAdapterError(
        `rendering style "${parsed.renderingStyle}" is not supported by ${SOFTWARE_ENGINE_ID}` +
          ` (supported: ${descriptor.renderingStyles.join(", ")})`,
        "unsupported-style",
        { requested: parsed.renderingStyle, supported: descriptor.renderingStyles },
      );
    }
    const checkedSnapshot = WorldSnapshot.parse(snapshot);
    if (checkedSnapshot.sessionId !== parsed.sessionId) {
      throw new GameEngineAdapterError(
        `build request session "${parsed.sessionId}" does not match the snapshot session ` +
          `"${checkedSnapshot.sessionId}" — a scene belongs to exactly one session`,
        "invalid-build-request",
        { requestSession: parsed.sessionId, snapshotSession: checkedSnapshot.sessionId },
      );
    }
    for (let i = 0; i < events.length; i += 1) {
      const check = WorldEventStreamEntry.safeParse(events[i]);
      if (!check.success) {
        throw new GameEngineAdapterError(
          `events[${i}] does not parse against the WorldEventStreamEntry contract`,
          "invalid-event",
          { index: i, issues: check.error.issues.map((issue) => issue.message).slice(0, 3) },
        );
      }
    }
    const sceneId = `scene-${fnv1a32(
      `${parsed.sessionId}|${parsed.snapshotVersion}|${parsed.renderingStyle}`,
    )
      .toString(16)
      .padStart(8, "0")}`;
    const state = buildSceneState(parsed, checkedSnapshot, events, sceneId);
    if (state.entities.length > this.maxConcurrentEntities) {
      throw new GameEngineAdapterError(
        `the snapshot places ${state.entities.length} entities, above this engine's ` +
          `maximum of ${this.maxConcurrentEntities} concurrent scene entities`,
        "scene-capacity-exceeded",
        { placed: state.entities.length, maxConcurrentEntities: this.maxConcurrentEntities },
      );
    }
    // Same identity rebuilds the same scene (the map entry is replaced).
    this.scenes.set(sceneId, state);
    return {
      sceneId,
      sessionId: parsed.sessionId,
      snapshotVersion: parsed.snapshotVersion,
      appliedEventSequence: state.appliedEventSequence,
      entityCount: state.entities.length,
    };
  }

  /** Applies ordered events; skipped events are counted (replays + unsupported). */
  applySceneEvents(
    handle: GameSceneHandle,
    events: WorldEventStreamEntry[],
  ): GameSceneUpdateResult {
    const state = this.requireScene(handle.sceneId);
    for (let i = 0; i < events.length; i += 1) {
      const check = WorldEventStreamEntry.safeParse(events[i]);
      if (!check.success) {
        throw new GameEngineAdapterError(
          `events[${i}] does not parse against the WorldEventStreamEntry contract`,
          "invalid-event",
          { index: i, issues: check.error.issues.map((issue) => issue.message).slice(0, 3) },
        );
      }
    }
    const outcome = applyEventsToScene(state, events);
    const skipped = outcome.skippedUnsupported + outcome.skippedReplay;
    return {
      appliedEventSequence: state.appliedEventSequence,
      skippedEvents: skipped,
      degraded: outcome.skippedUnsupported > 0,
      ...(outcome.skippedUnsupported > 0
        ? {
            degradationReason:
              `${outcome.skippedUnsupported} event(s) outside the scene's ` +
              `supported envelope (unknown taxonomy or session) were skipped`,
          }
        : {}),
    };
  }

  /** Renders the scene: staged RGB24 frames + honest telemetry + provenance. */
  renderScene(request: GameSceneRenderRequest): GameSceneRenderResult {
    const parsed = parseOrThrow(
      GameSceneRenderRequest,
      request,
      "invalid-output-profile",
      "the render request",
    );
    const state = this.requireScene(parsed.sceneId);
    const descriptor = this.describe();
    if (!descriptor.outputFormats.includes(parsed.outputProfile.format)) {
      throw new GameEngineAdapterError(
        `output format "${parsed.outputProfile.format}" is not supported by ${SOFTWARE_ENGINE_ID}` +
          ` (supported: ${descriptor.outputFormats.join(", ")})`,
        "unsupported-format",
        {
          requested: parsed.outputProfile.format,
          supported: descriptor.outputFormats,
        },
      );
    }
    const { widthPx, heightPx, fps, durationMs } = parsed.outputProfile;
    if (
      !Number.isInteger(widthPx) ||
      widthPx < 8 ||
      !Number.isInteger(heightPx) ||
      heightPx < 8 ||
      !Number.isFinite(fps) ||
      fps <= 0 ||
      !Number.isInteger(durationMs) ||
      durationMs < 1
    ) {
      throw new GameEngineAdapterError(
        "outputProfile is invalid (integers >= 8 for width/height, fps > 0, durationMs >= 1)",
        "invalid-output-profile",
        { outputProfile: parsed.outputProfile },
      );
    }

    const startedAtMs = this.nowMs();
    const requestedFrames = Math.max(1, Math.round((fps * durationMs) / 1000));
    const frameCount = Math.min(requestedFrames, this.maxFramesPerRender);
    const droppedFrames = requestedFrames - frameCount;
    const style = styleProfileOf(state.renderingStyle);
    const camera =
      parsed.presentation?.camera === "aerial" ? style.aerialCamera : style.defaultCamera;

    // Deterministic staging reference: scene + profile + presentation +
    // event state identity (same render → same ref → same bytes; a different
    // camera hint or a changed event tail is a different sequence — never a
    // silent overwrite of a prior render's staged frames).
    const stagingRef = join(
      this.stagingFramesDir,
      `${state.sceneId}-${fnv1a32(
        `${widthPx}x${heightPx}@${fps}for${durationMs}ms|${JSON.stringify(
          parsed.presentation ?? {},
        )}|seq${state.appliedEventSequence}|ov${state.overlays.length}`,
      )
        .toString(16)
        .padStart(8, "0")}.rgb24`,
    );
    const frames = renderSceneFrames(state, style, camera, {
      widthPx,
      heightPx,
      frameCount,
      fps,
      durationMs,
    });
    const staged = Buffer.alloc(frameCount * widthPx * heightPx * 3);
    let offset = 0;
    for (const frame of frames) {
      staged.set(frame, offset);
      offset += frame.length;
    }
    writeFileSync(stagingRef, staged);
    const reread = readFileSync(stagingRef);
    if (reread.length !== staged.length) {
      throw new GameEngineAdapterError(
        `the staged frame sequence at "${stagingRef}" failed integrity verification on re-read`,
        "staging-unavailable",
        { stagingRef, expectedBytes: staged.length, measuredBytes: reread.length },
      );
    }

    const output: GameEngineRenderOutput = {
      kind: "frame-output",
      stagingRef,
      frameCount,
      widthPx,
      heightPx,
      fps,
      pixelFormat: "rgb24",
    };
    const degradationReasons: string[] = [];
    if (state.skippedUnsupported > 0) {
      degradationReasons.push(
        `${state.skippedUnsupported} event(s) outside the scene's supported envelope were skipped`,
      );
    }
    if (droppedFrames > 0) {
      degradationReasons.push(
        `frame budget exceeded: rendered ${frameCount} of ${requestedFrames} frames`,
      );
    }
    return {
      output,
      telemetry: {
        renderMs: Math.max(0, this.nowMs() - startedAtMs),
        framesRendered: frameCount,
        droppedFrames,
      },
      provenance: {
        snapshotVersion: state.snapshotVersion,
        lastEventSequence: state.appliedEventSequence,
      },
      degraded: degradationReasons.length > 0,
      ...(degradationReasons.length > 0
        ? { degradationReason: degradationReasons.join("; ") }
        : {}),
    };
  }

  /** Reads back a staged frame sequence (package-level detail surface). */
  readStagedFrames(result: GameSceneRenderResult): StagedFrameSequence {
    if (result.output.kind !== "frame-output") {
      throw new GameEngineAdapterError(
        "only frame-output renders carry a staged frame sequence",
        "invalid-output-profile",
        { kind: (result.output as { kind: string }).kind },
      );
    }
    const output = result.output;
    const bytes = readFileSync(output.stagingRef);
    const expected = output.frameCount * output.widthPx * output.heightPx * 3;
    if (bytes.length !== expected) {
      throw new GameEngineAdapterError(
        `the staged frame sequence at "${output.stagingRef}" has ${bytes.length} bytes, ` +
          `expected ${expected} (${output.frameCount} × ${output.widthPx}×${output.heightPx}×3)`,
        "staging-unavailable",
        { stagingRef: output.stagingRef, bytes: bytes.length, expected },
      );
    }
    return {
      stagingRef: output.stagingRef,
      frameCount: output.frameCount,
      widthPx: output.widthPx,
      heightPx: output.heightPx,
      fps: output.fps,
      pixelFormat: "rgb24",
      byteLength: bytes.length,
    };
  }

  /** Resolves a scene id or throws (fail loud). */
  private requireScene(sceneId: string): SceneState {
    const state = this.scenes.get(sceneId);
    if (state === undefined) {
      throw new GameEngineAdapterError(
        `no scene with id "${sceneId}" is built on this engine instance`,
        "unknown-scene",
        { sceneId },
      );
    }
    return state;
  }
}

/** Renders every frame of one scene render (pure — deterministic bytes). */
function renderSceneFrames(
  state: SceneState,
  style: RenderingStyleProfile,
  camera: { position: Vec3; target: Vec3; fovRadians: number },
  plan: { widthPx: number; heightPx: number; frameCount: number; fps: number; durationMs: number },
): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let index = 0; index < plan.frameCount; index += 1) {
    const elapsedMs = Math.min(plan.durationMs - 1, Math.round((index * 1000) / plan.fps));
    const raster = new DepthRaster(plan.widthPx, plan.heightPx, camera, style.sky);
    drawWorld(raster, style);
    for (const entity of state.entities) {
      if (entity.kind === "ball") continue;
      drawEntityPrism(raster, style, entity);
    }
    for (const entity of state.entities) {
      if (entity.kind === "ball") drawBall(raster, style, entity);
    }
    drawHud(raster, style, state, elapsedMs, plan.durationMs);
    frames.push(raster.data);
  }
  return frames;
}

/** Draws the ground, pitch, and markings (canonical W601 geometry). */
function drawWorld(raster: DepthRaster, style: RenderingStyleProfile): void {
  // The surrounding apron (below the pitch plane).
  fillGroundQuad(raster, style, -12, -12, 105 + 12, 68 + 12, style.surround);
  // The pitch itself, a hair above the apron (no z-fighting).
  fillGroundQuad(raster, style, 0, 0, 105, 68, style.grass, 0.05);
  // Markings (z above the pitch).
  const z = 0.12;
  const segment = (a: Vec3, b: Vec3) => raster.drawSegment3D(a, b, LINE_COLOR);
  segment([0, 0, z], [105, 0, z]);
  segment([0, 68, z], [105, 68, z]);
  segment([0, 0, z], [0, 68, z]);
  segment([105, 0, z], [105, 68, z]);
  segment([52.5, 0, z], [52.5, 68, z]);
  // Center circle (r = 9.15) + center mark.
  for (let i = 0; i < 48; i += 1) {
    const a1 = (2 * Math.PI * i) / 48;
    const a2 = (2 * Math.PI * (i + 1)) / 48;
    segment(
      [52.5 + 9.15 * Math.cos(a1), 34 + 9.15 * Math.sin(a1), z],
      [52.5 + 9.15 * Math.cos(a2), 34 + 9.15 * Math.sin(a2), z],
    );
  }
  segment([52.5 - 0.4, 34, z], [52.5 + 0.4, 34, z]);
  segment([52.5, 34 - 0.4, z], [52.5, 34 + 0.4, z]);
  // Penalty areas (16.5 m deep, 40.32 m wide) + goal areas (5.5 m, 18.32 m).
  for (const [depth, halfWidth] of [
    [16.5, 20.16],
    [5.5, 9.16],
  ] as const) {
    segment([0, 34 - halfWidth, z], [depth, 34 - halfWidth, z]);
    segment([0, 34 + halfWidth, z], [depth, 34 + halfWidth, z]);
    segment([depth, 34 - halfWidth, z], [depth, 34 + halfWidth, z]);
    segment([105 - depth, 34 - halfWidth, z], [105, 34 - halfWidth, z]);
    segment([105 - depth, 34 + halfWidth, z], [105, 34 + halfWidth, z]);
    segment([105 - depth, 34 - halfWidth, z], [105 - depth, 34 + halfWidth, z]);
  }
  // Penalty spots (11 m).
  for (const x of [11, 94]) {
    segment([x - 0.3, 34, z], [x + 0.3, 34, z]);
    segment([x, 34 - 0.3, z], [x, 34 + 0.3, z]);
  }
  // Goals (7.32 m wide): uprights behind each goal line.
  for (const x of [0, 105]) {
    const direction = x === 0 ? -1 : 1;
    segment([x, 34 - 3.66, 0], [x, 34 - 3.66, 2.44]);
    segment([x, 34 + 3.66, 0], [x, 34 + 3.66, 2.44]);
    segment([x, 34 - 3.66, 2.44], [x + direction * 1.5, 34 - 3.66, 2.44]);
    segment([x, 34 + 3.66, 2.44], [x + direction * 1.5, 34 + 3.66, 2.44]);
    segment([x + direction * 1.5, 34 - 3.66, 2.44], [x + direction * 1.5, 34 + 3.66, 2.44]);
  }
}

/** Fills one ground quad (two z-buffered triangles; z-lift avoids z-fighting). */
function fillGroundQuad(
  raster: DepthRaster,
  style: RenderingStyleProfile,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
  color: Rgb,
  zLift = 0,
): void {
  const a = raster.project([xMin, yMin, zLift]);
  const b = raster.project([xMax, yMin, zLift]);
  const c = raster.project([xMax, yMax, zLift]);
  const d = raster.project([xMin, yMax, zLift]);
  if (a === null || b === null || c === null || d === null) return;
  const up: Vec3 = [0, 0, 1];
  const shaded = style.shadeFace(color, up);
  raster.fillTriangle(a, b, c, shaded);
  raster.fillTriangle(a, c, d, shaded);
}

/** Draws one entity as an 8-sided vertical prism (identity-stable color). */
function drawEntityPrism(
  raster: DepthRaster,
  style: RenderingStyleProfile,
  entity: { entityId: string; x: number; y: number; outOfBounds: boolean },
): void {
  const radius = 0.8;
  const height = 1.8;
  const sides = 8;
  const base = ENGINE_PALETTE[fnv1a32(entity.entityId) % ENGINE_PALETTE.length]!;
  const tinted: Rgb = entity.outOfBounds
    ? [Math.min(255, base[0] + 40), Math.min(255, base[1] + 40), Math.min(255, base[2] + 40)]
    : base;
  const sidesProjected: Array<Array<{ x: number; y: number; z: number }>> = [];
  for (let i = 0; i < sides; i += 1) {
    const a1 = (2 * Math.PI * i) / sides;
    const a2 = (2 * Math.PI * (i + 1)) / sides;
    const p1 = [entity.x + radius * Math.cos(a1), entity.y + radius * Math.sin(a1)] as const;
    const p2 = [entity.x + radius * Math.cos(a2), entity.y + radius * Math.sin(a2)] as const;
    const bottom1 = raster.project([p1[0], p1[1], 0.05]);
    const bottom2 = raster.project([p2[0], p2[1], 0.05]);
    const top1 = raster.project([p1[0], p1[1], height]);
    const top2 = raster.project([p2[0], p2[1], height]);
    if (bottom1 === null || bottom2 === null || top1 === null || top2 === null) continue;
    const normal: Vec3 = [Math.cos((a1 + a2) / 2), Math.sin((a1 + a2) / 2), 0];
    const shaded = style.shadeFace(tinted, normal);
    raster.fillTriangle(bottom1, bottom2, top2, shaded);
    raster.fillTriangle(bottom1, top2, top1, shaded);
    if (style.outline) {
      raster.strokePolygonOutline([bottom1, bottom2, top2, top1], OUTLINE_COLOR);
    }
    sidesProjected.push([bottom1, bottom2, top2, top1]);
  }
  // The prism's top cap (an octagonal fan).
  const center = raster.project([entity.x, entity.y, height]);
  if (center !== null && sidesProjected.length === sides) {
    const shaded = style.shadeFace(tinted, [0, 0, 1]);
    for (let i = 0; i < sides; i += 1) {
      const quad = sidesProjected[i]!;
      raster.fillTriangle(center, quad[0]!, quad[3]!, shaded);
    }
  }
}

/** Draws the ball as a small 6-sided prism (white, on its carried height). */
function drawBall(
  raster: DepthRaster,
  style: RenderingStyleProfile,
  entity: { x: number; y: number; z: number },
): void {
  const radius = 0.45;
  const sides = 6;
  const z0 = 0.05 + Math.max(0, entity.z);
  const z1 = z0 + 0.5;
  for (let i = 0; i < sides; i += 1) {
    const a1 = (2 * Math.PI * i) / sides;
    const a2 = (2 * Math.PI * (i + 1)) / sides;
    const p1 = [entity.x + radius * Math.cos(a1), entity.y + radius * Math.sin(a1)] as const;
    const p2 = [entity.x + radius * Math.cos(a2), entity.y + radius * Math.sin(a2)] as const;
    const b1 = raster.project([p1[0], p1[1], z0]);
    const b2 = raster.project([p2[0], p2[1], z0]);
    const t1 = raster.project([p1[0], p1[1], z1]);
    const t2 = raster.project([p2[0], p2[1], z1]);
    if (b1 === null || b2 === null || t1 === null || t2 === null) continue;
    const normal: Vec3 = [Math.cos((a1 + a2) / 2), Math.sin((a1 + a2) / 2), 0];
    const shaded = style.shadeFace(BALL_COLOR, normal);
    raster.fillTriangle(b1, b2, t2, shaded);
    raster.fillTriangle(b1, t2, t1, shaded);
    if (style.outline) {
      raster.strokePolygonOutline([b1, b2, t2, t1], OUTLINE_COLOR);
    }
  }
  const center = raster.project([entity.x, entity.y, z1]);
  if (center !== null) {
    const shaded = style.shadeFace(BALL_COLOR, [0, 0, 1]);
    for (let i = 0; i < sides; i += 1) {
      const a1 = (2 * Math.PI * i) / sides;
      const a2 = (2 * Math.PI * (i + 1)) / sides;
      const q1 = raster.project([
        entity.x + radius * Math.cos(a1),
        entity.y + radius * Math.sin(a1),
        z1,
      ]);
      const q2 = raster.project([
        entity.x + radius * Math.cos(a2),
        entity.y + radius * Math.sin(a2),
        z1,
      ]);
      if (q1 === null || q2 === null) continue;
      raster.fillTriangle(center, q1, q2, shaded);
    }
  }
}

/** Draws the bottom HUD strip: the render timeline + applied-event marks. */
function drawHud(
  raster: DepthRaster,
  style: RenderingStyleProfile,
  state: SceneState,
  elapsedMs: number,
  durationMs: number,
): void {
  const bandHeight = Math.max(10, Math.round(raster.height * 0.08));
  const bandY = raster.height - bandHeight;
  raster.fillRect(0, bandY, raster.width, bandHeight, [16, 18, 20]);
  // Timeline track.
  const marginX = Math.max(4, Math.round(raster.width * 0.02));
  const trackY = bandY + Math.floor(bandHeight / 2) - 1;
  const trackW = raster.width - marginX * 2;
  raster.fillRect(marginX, trackY, trackW, 3, [40, 44, 48]);
  // Progress fill (presentation time — the scene state itself is static).
  const progress = durationMs > 0 ? Math.min(1, Math.max(0, elapsedMs / durationMs)) : 0;
  raster.fillRect(marginX, trackY, progress * trackW, 3, style.hudAccent);
  // Applied-event marks: one tick per overlay, at its clamped time offset
  // (the scene's watermark anchors the timeline; events carry no position).
  for (const overlay of state.overlays) {
    const offset = Math.min(
      Math.max(overlay.eventTimeMs - state.watermarkMs, 0),
      Math.max(0, durationMs - 1),
    );
    const at = marginX + (offset / durationMs) * trackW;
    raster.fillRect(
      Math.round(at) - 1,
      trackY - 3,
      3,
      9,
      overlay.isCorrection ? [142, 91, 192] : [235, 238, 228],
    );
  }
}
