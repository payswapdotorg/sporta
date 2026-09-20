/**
 * THE derived-reality MP4 renderer (R508/R509/R510): the compute plane's
 * derived-reality handoff over the R306 encoding bridges — the seam that
 * turns the three DERIVED realities (tactical, 3D game, anime/NPR) into
 * REAL MP4 `EncodedArtifact`s.
 *
 * Why this module exists: the W504 encode seam (`encodeAnimeClip`) is
 * SVG-only, so the derived realities could only stage animated-SVG review
 * artifacts — the Watch surface honestly 415'd them. The acceptance
 * contract (§D) requires ALL FOUR realities of an accepted session to be
 * actual MP4 videos, each integrity-verifiable and playable in a normal
 * HTML5 `<video>` element. The R306 bridges (wave-3 C, `@sporta/encoding`)
 * are the shipped encoding plane; this module WIRES them (never forks
 * them) into one render surface the hosted executor dispatches to:
 *
 * - **tactical** (R508): ONE `renderDetailed` call on the REAL R301
 *   tactical plugin produces the renderer's own REAL MP4; the captured
 *   output is REPLAYED to `bridgeTacticalRenderer` so the bridge's whole
 *   adopt+verify pipeline runs (bytes re-read from the staged artifact,
 *   re-hashed against BOTH the staged record's hash and the frozen
 *   `RenderArtifactManifest`'s hash, the manifest parsed through the
 *   frozen contract schema) — one render, one artifact, zero double
 *   encodes.
 * - **game-3d** (R509) / **anime-npr** (R510): the frozen R302
 *   `GameEngineAdapter` seam (the reference `Software3DEngine`) renders
 *   the CANONICAL SWM snapshot into a staged rgb24 frame stream, and
 *   `bridgeGameFrameOutput` encodes it through the REAL
 *   `FrameEncoderPort` (ffmpeg/libx264) into an MP4 with the engine
 *   provenance carried verbatim.
 *
 * Hard invariants (acceptance contract §C/§E/§K — enforced here):
 * - renderers READ the canonical SWM; nothing in this module writes the
 *   snapshot or the event stream, and no canonical event is invented or
 *   reordered (the events are applied to the engine VERBATIM, in order);
 * - every artifact references the SAME session id the request names;
 * - the SWM provenance (`snapshotVersion` + the engine's own
 *   `lastEventSequence` accounting) rides into the container manifest;
 * - fail-closed: every refusal is a typed `EncodingError` (never a
 *   partially rendered artifact, never a guessed encode).
 */
import {
  RenderRequest,
  RenderResult,
  SCHEMA_VERSION,
} from "@sporta/contracts";
import type {
  GameEngineAdapter,
  RenderRequest as RenderRequestDoc,
  RenderResult as RenderResultDoc,
  WorldEventStreamEntry as WorldEventStreamEntryDoc,
  WorldSnapshot as WorldSnapshotDoc,
} from "@sporta/contracts";
import { parseGameStyleConfig } from "@sporta/renderer-3d";
import {
  bridgeGameFrameOutput,
  bridgeTacticalRenderer,
  EncodingError,
} from "@sporta/encoding";
import type {
  EncodedArtifact,
  FrameEncoderPort,
  TacticalRendererLike,
} from "@sporta/encoding";

/** The closed derived-reality bridge vocabulary (the R306 bridge ids). */
export type DerivedRealityBridge = "tactical" | "game-3d" | "anime-npr";

/**
 * The derived-reality renderers this plane hosts, keyed by the W501
 * renderer id the dispatch names (the repo's product renderer identities).
 */
export const DERIVED_REALITY_RENDERERS: Readonly<
  Record<string, DerivedRealityBridge>
> = Object.freeze({
  "tactical.prototype": "tactical",
  "game-3d.prototype": "game-3d",
  "anime-npr.prototype": "anime-npr",
});

/** One derived-reality render request (everything the render consumes). */
export interface DerivedRealityRenderRequest {
  /** The canonical session (the constant every reality shares). */
  sessionId: string;
  /** The W501 renderer identity the dispatch named. */
  rendererId: string;
  rendererVersion: string;
  /** The CANONICAL SWM snapshot (READ ONLY — never written, never mutated). */
  snapshot: WorldSnapshotDoc;
  /** The ordered canonical event tail (applied verbatim, in order). */
  events: WorldEventStreamEntryDoc[];
  /** The snapshot version the dispatch materialized. */
  snapshotVersion: number;
  /** The event window's origin sequence (provenance honesty). */
  eventsSinceSequence: number;
  /** The recipe's style config (renderer-interpreted). */
  styleConfig: { styleId: string; configSchemaVersion: string; config: unknown };
  /** The dispatch's output profile (the renderer's own supported profile). */
  outputProfile: {
    resolution: { w: number; h: number };
    frameRate: number;
    codec: string;
    container: string;
    latencyClass: string;
  };
  /** The injected clock (manifest generation times + measured lag). */
  nowMs: () => number;
}

/** The result of one derived-reality render: the contract result + the MP4. */
export interface DerivedRealityRenderOutput {
  /** The W501 contract result (honest provenance/watermark/segments). */
  result: RenderResultDoc;
  /** The REAL MP4 artifact the R306 bridge produced (kind "mp4"). */
  artifact: EncodedArtifact;
  /** The number of frames rendered (the engine/renderer's own count). */
  frameCount: number;
}

/**
 * THE derived-reality renderer port. The hosted executor resolves the
 * W501 plugin for admission (identity/profile/style gates) and, when the
 * resolved renderer is one this plane hosts, executes the render through
 * it instead of the SVG-only W504 seam.
 */
export interface DerivedRealityRendererPort {
  /** Whether this plane renders the named renderer id. */
  supports(rendererId: string): boolean;
  /** Renders one derived-reality render into a REAL MP4 artifact. */
  renderDerivedReality(request: DerivedRealityRenderRequest): DerivedRealityRenderOutput;
}

/** Options for {@link createDerivedRealityRenderer}. */
export interface DerivedRealityRendererDeps {
  /** The REAL R301 tactical renderer plugin (structural — the plugin satisfies it). */
  tacticalRenderer: TacticalRendererLike;
  /**
   * The frozen R302 game-engine seam factory (one fresh engine per render).
   * The engines own their staging lifecycle: `dispose()` (when the adapter
   * exposes it) must release the staged frame stream's storage — the
   * composition's factory wires the reference engine with root cleanup.
   */
  createGameEngine: () => GameEngineAdapter;
  /** The R306 REAL frame encoder (the ffmpeg/libx264 adapter). */
  frameEncoder: FrameEncoderPort;
}

/** Unwraps a MaybePromise engine result (the R303/R304 plugin posture). */
function syncEngineResult<T>(value: T | Promise<T>, method: string, rendererId: string): T {
  if (value instanceof Promise) {
    throw new EncodingError(
      "internal",
      "encode-failed",
      `the game-engine adapter resolved ${method} asynchronously; this renderer requires a synchronous adapter`,
      { rendererId, method },
    );
  }
  return value;
}

/** The rendering style each game bridge selects at the engine seam. */
const GAME_RENDERING_STYLE: Readonly<Record<"game-3d" | "anime-npr", "stylized-3d" | "cel-shaded">> =
  Object.freeze({ "game-3d": "stylized-3d", "anime-npr": "cel-shaded" });

/** The output-segment id prefix per derived renderer (the R303/R304 convention). */
const SEGMENT_PREFIX: Readonly<Record<DerivedRealityBridge, string>> = Object.freeze({
  tactical: "tac",
  "game-3d": "game3d",
  "anime-npr": "animenpr",
});

/** Builds the W501 RenderResult of one game-reality render (honest numbers only). */
function gameRenderResultOf(options: {
  request: DerivedRealityRenderRequest;
  artifact: EncodedArtifact;
  frameCount: number;
  degraded: boolean;
  degradationReason: string | undefined;
  lastEventSequence: number;
  lagMs: number;
}): RenderResultDoc {
  const { request, artifact, frameCount } = options;
  const startMs = request.snapshot.watermark.watermarkMs;
  // The artifact's OWN manifest geometry is the honest duration (the
  // bridge measured it from the encoded stream — never asserted).
  const durationMs = artifact.manifest.geometry.durationMs;
  const endMs = startMs + durationMs;
  const lastEvent =
    request.events.length > 0 ? request.events[request.events.length - 1] : undefined;
  const result = {
    sessionId: request.sessionId,
    rendererId: request.rendererId,
    outputSegments: [
      {
        segmentId: `${SEGMENT_PREFIX[bridgeOf(request.rendererId)]}-0`,
        startMs,
        endMs,
        artifactRef: `artifact://${artifact.contentHash}`,
      },
    ],
    watermarkAfter: {
      sequence: lastEvent !== undefined ? lastEvent.sequence : request.snapshot.watermark.sequence,
      watermarkMs: endMs,
    },
    rendererHealth: {
      lagMs: options.lagMs,
      degraded: options.degraded,
      ...(options.degraded && options.degradationReason !== undefined
        ? { degradationReason: options.degradationReason }
        : {}),
    },
    provenance: {
      snapshotVersion: request.snapshotVersion,
      lastEventSequence: options.lastEventSequence,
    },
  };
  const parsed = RenderResult.safeParse(result);
  if (!parsed.success) {
    throw new EncodingError(
      "internal",
      "encode-failed",
      "the derived-reality render result failed its own contract schema",
      { rendererId: request.rendererId, issues: parsed.error.message.slice(0, 500) },
    );
  }
  void frameCount;
  return parsed.data;
}

/** Resolves the bridge of a renderer id (fail-loud on an unknown id). */
function bridgeOf(rendererId: string): DerivedRealityBridge {
  const bridge = DERIVED_REALITY_RENDERERS[rendererId];
  if (bridge === undefined) {
    throw new EncodingError(
      "media-invalid",
      "frames-invalid",
      `renderer '${rendererId}' is not a derived-reality renderer this plane hosts`,
      { rendererId },
    );
  }
  return bridge;
}

/** Parses the game style config ({durationMs, camera, seed} — renderer-3d's own parser, REUSED). */
function parseGameStyle(config: unknown): { durationMs: number; camera: string; seed: number } {
  // The R303/R304 style contract: durationMs in [min, max], camera one of
  // the engine's keys, seed an integer. parseGameStyleConfig is the
  // renderers' own parser — REUSED, never reimplemented.
  const parsed = parseGameStyleConfig(config);
  if (!parsed.ok) {
    throw new EncodingError("media-invalid", "frames-invalid", parsed.reason, {});
  }
  return parsed.value;
}

/**
 * Creates the derived-reality renderer. Pure composition over the REAL
 * bridges — no clocks of its own (the request carries the injected clock),
 * the only I/O is the staged frame stream the engine writes and the
 * bridge-encoded MP4 it hands back.
 */
export function createDerivedRealityRenderer(
  deps: DerivedRealityRendererDeps,
): DerivedRealityRendererPort {
  return {
    supports(rendererId: string): boolean {
      return DERIVED_REALITY_RENDERERS[rendererId] !== undefined;
    },

    renderDerivedReality(request: DerivedRealityRenderRequest): DerivedRealityRenderOutput {
      const bridge = bridgeOf(request.rendererId);
      if (bridge === "tactical") {
        return renderTactical(deps, request);
      }
      return renderGame(deps, request, bridge);
    },
  };
}

// ---------------------------------------------------------------------------
// R508 — the tactical bridge (ONE renderDetailed call, adopted + verified)
// ---------------------------------------------------------------------------

/** The captured tactical detailed render (replayed to the bridge — one render). */
type CapturedTacticalRender = ReturnType<TacticalRendererLike["renderDetailed"]>;

/**
 * The tactical path: the plugin's OWN `renderDetailed` runs ONCE (the
 * renderer drives its real encode — the MP4 is the renderer's own); the
 * captured output is REPLAYED to `bridgeTacticalRenderer`, which re-reads
 * the staged bytes, re-hashes them against the staged record AND the
 * frozen manifest, parses the manifest through the frozen contract
 * schema, and builds the `EncodedArtifact` (manifest.bridge "tactical",
 * `rendererManifest` = the frozen `RenderArtifactManifest` VERBATIM).
 */
function renderTactical(
  deps: DerivedRealityRendererDeps,
  request: DerivedRealityRenderRequest,
): DerivedRealityRenderOutput {
  const req = tacticalRenderRequestOf(request);
  const input = { snapshot: request.snapshot, events: request.events };
  // ONE render: the executor needs the contract result AND the bridge
  // needs the render's staged artifact — both from the SAME call. (The
  // R301 plugin's own surface carries MORE fields — the canonical scene,
  // the view-model — which the structural bridge type simply ignores.)
  const captured: CapturedTacticalRender = deps.tacticalRenderer.renderDetailed(req, input);
  if (
    typeof captured?.details?.frameCount !== "number" ||
    !Number.isInteger(captured.details.frameCount) ||
    captured.details.frameCount < 1
  ) {
    throw new EncodingError(
      "media-invalid",
      "artifact-invalid",
      "the tactical render's frame accounting is invalid",
      { rendererId: request.rendererId, frameCount: captured?.details?.frameCount },
    );
  }
  // The replaying renderer: the bridge calls renderDetailed itself, so the
  // CAPTURED output answers (the plugin is never re-rendered, never
  // re-encoded — the bridge's adopt+verify pipeline runs over the one
  // render's real artifact).
  const replaying: TacticalRendererLike = {
    renderDetailed: () => captured,
  };
  const artifact = bridgeTacticalRenderer({
    renderer: replaying,
    req,
    input,
  });
  return {
    result: captured.result,
    artifact,
    frameCount: captured.details.frameCount,
  };
}

/** Builds the tactical RenderRequest (the W501 document the plugin gates on). */
function tacticalRenderRequestOf(request: DerivedRealityRenderRequest): RenderRequestDoc {
  const doc = {
    sessionId: request.sessionId,
    schemaVersion: SCHEMA_VERSION,
    rendererId: request.rendererId,
    rendererVersion: request.rendererVersion,
    styleConfig: {
      styleId: request.styleConfig.styleId,
      configSchemaVersion: request.styleConfig.configSchemaVersion,
      config: request.styleConfig.config,
    },
    snapshotVersion: request.snapshotVersion,
    eventsSinceSequence: request.eventsSinceSequence,
    outputProfile: request.outputProfile,
    rightsCapabilities: {
      canReferenceSourceFrames: false,
      canDeliverLive: false,
      canStoreDerivatives: false,
      canShare: false,
    },
    sourceFrameRefs: [],
  };
  const parsed = RenderRequest.safeParse(doc);
  if (!parsed.success) {
    throw new EncodingError(
      "media-invalid",
      "frames-invalid",
      "the tactical render request failed the contracts schema",
      { rendererId: request.rendererId, issues: parsed.error.message.slice(0, 500) },
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// R509/R510 — the game bridges (frozen engine seam -> bridgeGameFrameOutput)
// ---------------------------------------------------------------------------

/**
 * The game path (R509 `game-3d` / R510 `anime-npr`): the frozen R302
 * engine seam renders the CANONICAL SWM (build -> apply -> render) into a
 * staged rgb24 frame stream, and `bridgeGameFrameOutput` encodes it
 * through the REAL `FrameEncoderPort` into an MP4 whose manifest carries
 * the engine provenance and the SWM provenance verbatim.
 */
function renderGame(
  deps: DerivedRealityRendererDeps,
  request: DerivedRealityRenderRequest,
  bridge: "game-3d" | "anime-npr",
): DerivedRealityRenderOutput {
  const startedAtMs = request.nowMs();
  const style = parseGameStyle(request.styleConfig.config);
  const width = request.outputProfile.resolution.w;
  const height = request.outputProfile.resolution.h;
  const fps = request.outputProfile.frameRate;
  const engine = deps.createGameEngine();
  try {
    // The frozen seam: build (the CANONICAL SWM, READ ONLY) -> apply (the
    // ordered events, VERBATIM) -> render (the staged frame stream).
    const handle = syncEngineResult(
      engine.buildScene(
        {
          schemaVersion: SCHEMA_VERSION,
          sessionId: request.sessionId,
          snapshotVersion: request.snapshotVersion,
          renderingStyle: GAME_RENDERING_STYLE[bridge],
        },
        request.snapshot,
        [],
      ),
      "buildScene",
      request.rendererId,
    );
    const update = syncEngineResult(
      engine.applySceneEvents(handle, request.events),
      "applySceneEvents",
      request.rendererId,
    );
    const rendered = syncEngineResult(
      engine.renderScene({
        schemaVersion: SCHEMA_VERSION,
        sceneId: handle.sceneId,
        outputProfile: {
          widthPx: width,
          heightPx: height,
          fps,
          durationMs: style.durationMs,
          format: "frames-rgb24",
        },
        presentation: {
          camera: style.camera,
          seed: String(style.seed),
        },
      }),
      "renderScene",
      request.rendererId,
    );
    if (rendered.output.kind !== "frame-output") {
      throw new EncodingError(
        "media-invalid",
        "frames-invalid",
        `the engine returned ${rendered.output.kind}, but this renderer only consumes staged frame output`,
        { rendererId: request.rendererId },
      );
    }
    const frameOutput = rendered.output;

    // The bridge: the staged rgb24 stream -> REAL MP4 (the R306 plane).
    const descriptor = syncEngineResult(engine.describe(), "describe", request.rendererId);
    const artifact = bridgeGameFrameOutput({
      encoder: deps.frameEncoder,
      frameOutput,
      sessionId: request.sessionId,
      origin: {
        rendererId: request.rendererId,
        rendererVersion: request.rendererVersion,
        bridge,
        engineId: descriptor.engineId,
        engineVersion: descriptor.engineVersion,
      },
      swm: {
        snapshotVersion: request.snapshotVersion,
        lastEventSequence: rendered.provenance.lastEventSequence,
      },
      nowMs: request.nowMs,
    });
    const lagMs = Math.max(0, request.nowMs() - startedAtMs);
    const result = gameRenderResultOf({
      request,
      artifact,
      frameCount: frameOutput.frameCount,
      degraded: rendered.degraded || update.degraded,
      degradationReason:
        [
          rendered.degraded ? rendered.degradationReason : undefined,
          update.degraded ? update.degradationReason : undefined,
        ]
          .filter((reason): reason is string => reason !== undefined)
          .join("; ") || undefined,
      lastEventSequence: rendered.provenance.lastEventSequence,
      lagMs,
    });
    return { result, artifact, frameCount: frameOutput.frameCount };
  } finally {
    // The staged frame stream was CONSUMED by the encode (the R303/R304
    // plugin's own cleanup precedent): pipeline scratch, released through
    // the ENGINE's own lifecycle (the factory's engines own their staging
    // root — dispose cleans it); the durable artifact is the
    // content-addressed MP4 the bridge produced.
    const dispose = (engine as { dispose?: () => void }).dispose;
    if (typeof dispose === "function") dispose.call(engine);
  }
}
