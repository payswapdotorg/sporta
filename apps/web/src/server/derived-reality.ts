/**
 * THE derived-reality plane composition (R508-R510) — the web composition's
 * wiring of the compute plane's derived-reality MP4 renderer over the REAL
 * toolchain:
 *
 * - the REAL R301 tactical renderer (`tactical.prototype`) — its own
 *   ffmpeg/libx264 encode, staged content-addressed (the plugin's own
 *   discipline; the R306 bridge adopts + verifies it);
 * - the R303/R304 game-reality renderer plugins (`game-3d.prototype`,
 *   `anime-npr.prototype`) — registered for the W501 admission gates and
 *   the catalog's producer declarations; their RENDERS execute through
 *   the frozen R302 engine seam + the R306 `bridgeGameFrameOutput` encode
 *   (the compute plane's derived-reality renderer, not the plugins' own
 *   internal encode path);
 * - the R306 REAL frame encoder (`FfmpegFrameEncoder`) shared by the game
 *   bridges.
 *
 * HONEST AVAILABILITY: the plane exists ONLY when the real encode toolchain
 * probes available (ffmpeg + libx264 — the repo's system-ffmpeg
 * convention). When it does not, this returns `null` and the derived
 * realities stay honestly `producer-unavailable` in the catalog — the
 * wave-4 posture, never a silent fallback to SVG review artifacts.
 *
 * The SWM stays the single match truth: every renderer here READS the
 * canonical snapshot + ordered events the control plane materialized; none
 * writes the world model; the session id is the constant of every render.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDerivedRealityRenderer } from "@sporta/compute-adapter-hosted";
import type { DerivedRealityRendererPort } from "@sporta/compute-adapter-hosted";
import { createFfmpegFrameEncoder } from "@sporta/encoding";
import {
  Software3DEngine,
  createAnimeNprRenderer,
  createGame3DRenderer,
} from "@sporta/renderer-3d";
import type { GameRealityRenderer } from "@sporta/renderer-3d";
import { createFfmpegH264Codec, createTacticalRenderer } from "@sporta/renderer-tactical";
import type { TacticalRenderer } from "@sporta/renderer-tactical";
import type { RendererPlugin } from "@sporta/renderer-contract";
import type { RendererRegistry } from "@sporta/renderer-contract";
import type { GameEngineAdapter, RealityKind } from "@sporta/contracts";
import type {
  GameEngineDescriptor,
  GameSceneBuildRequest,
  GameSceneHandle,
  GameSceneRenderRequest,
  GameSceneRenderResult,
  GameSceneUpdateResult,
} from "@sporta/contracts";
import type { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";

/**
 * One fresh reference engine per render, OWNING its staging lifecycle: the
 * wrapper delegates every seam method to the real `Software3DEngine` and
 * releases the engine's staging root on `dispose()` (the R303/R304 plugin's
 * own cleanup precedent — the staged frame stream is pipeline scratch once
 * the encode consumed it).
 */
function createDisposingSoftware3DEngine(): GameEngineAdapter & { dispose(): void } {
  const engine = new Software3DEngine();
  const root = engine.stagingRootPath();
  return {
    describe: (): GameEngineDescriptor => engine.describe(),
    buildScene: (
      request: GameSceneBuildRequest,
      snapshot: WorldSnapshot,
      events: WorldEventStreamEntry[],
    ): GameSceneHandle => engine.buildScene(request, snapshot, events),
    applySceneEvents: (
      handle: GameSceneHandle,
      events: WorldEventStreamEntry[],
    ): GameSceneUpdateResult => engine.applySceneEvents(handle, events),
    renderScene: (request: GameSceneRenderRequest): GameSceneRenderResult =>
      engine.renderScene(request),
    dispose: (): void => {
      engine.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The renderer → reality declarations this plane contributes (R503). */
export const DERIVED_REALITY_PRODUCERS: ReadonlyArray<[string, RealityKind]> = Object.freeze([
  ["tactical.prototype", "tactical"],
  ["game-3d.prototype", "three-d-game"],
  ["anime-npr.prototype", "anime-npr"],
]);

/** The composed derived-reality plane. */
export interface DerivedRealityPlane {
  /** Registers the plane's renderer plugins into the composition registry. */
  registerRenderers(registry: RendererRegistry): void;
  /** The derived-reality MP4 renderer (the compute plane's R508-R510 seam). */
  derivedRealityRenderer: DerivedRealityRendererPort;
  /** The renderer → reality declarations (composition DATA, operator-visible). */
  producers: ReadonlyMap<string, RealityKind>;
  /** The declared staging roots (honesty: the plane's own scratch space). */
  stagingRoots: string[];
}

/** Options for {@link createDerivedRealityPlane}. */
export interface DerivedRealityPlaneOptions {
  /** The composition's clock (manifest generation times). */
  nowMs: () => number;
  /** Override the tactical staging root (tests; default: a fresh tmpdir). */
  tacticalStagingDir?: string;
  /** Override the game-engine staging root (tests; default: the engine's own tmpdir). */
  gameStagingRoot?: string;
}

/**
 * Composes the derived-reality plane over the REAL toolchain, or `null`
 * when the encode toolchain is unavailable (the honest producer-
 * unavailable posture — the derived realities never fall back to SVG).
 */
export function createDerivedRealityPlane(
  options: DerivedRealityPlaneOptions,
): DerivedRealityPlane | null {
  // The R306 real encoder + the R301 tactical codec: BOTH must probe
  // available (the same system-ffmpeg binary the repo's conventions pin).
  const frameEncoder = createFfmpegFrameEncoder();
  const tacticalCodec = createFfmpegH264Codec();
  if (frameEncoder === null || tacticalCodec === null) {
    return null;
  }
  const tacticalStagingDir =
    options.tacticalStagingDir ?? mkdtempSync(join(tmpdir(), "sporta-tactical-staging-"));
  const gameStagingRoot = options.gameStagingRoot;

  // The REAL R301 tactical plugin (its own encode; the R306 bridge adopts
  // + verifies the staged artifact — one render, one artifact).
  const tacticalRenderer: TacticalRenderer = createTacticalRenderer({
    stagingDir: tacticalStagingDir,
    codec: tacticalCodec,
    nowMs: options.nowMs,
  });

  // The R303/R304 plugins: registered for the W501 admission gates and the
  // producer declarations; the compute plane's derived-reality renderer
  // drives the frozen engine seam + the R306 bridge for their renders.
  const gameRenderers: GameRealityRenderer[] = [
    createGame3DRenderer(gameStagingRoot === undefined ? {} : { artifactRoot: gameStagingRoot }),
    createAnimeNprRenderer(gameStagingRoot === undefined ? {} : { artifactRoot: gameStagingRoot }),
  ];

  const derivedRealityRenderer = createDerivedRealityRenderer({
    tacticalRenderer,
    createGameEngine: createDisposingSoftware3DEngine,
    frameEncoder,
  });

  return {
    registerRenderers(registry: RendererRegistry): void {
      registry.register(tacticalRenderer satisfies RendererPlugin);
      for (const plugin of gameRenderers) {
        registry.register(plugin satisfies RendererPlugin);
      }
    },
    derivedRealityRenderer,
    producers: new Map<string, RealityKind>(DERIVED_REALITY_PRODUCERS),
    stagingRoots: [tacticalStagingDir, ...(gameStagingRoot === undefined ? [] : [gameStagingRoot])],
  };
}
