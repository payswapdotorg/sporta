/**
 * THE R303/R304 renderer plugins — `createGame3DRenderer` (stylized 3D,
 * reality `three-d-game`) and `createAnimeNprRenderer` (cel-shaded/NPR,
 * reality `anime-npr`).
 *
 * Both are `RendererPlugin`s (W501) with the SAME structure by design
 * (ADR-009: two visibly different realities over ONE canonical SWM scene):
 * a render projects nothing renderer-side — it hands the validated SWM
 * snapshot + ordered events to a `GameEngineAdapter` (the frozen R302
 * seam; the reference `Software3DEngine` by default) through
 * `buildScene` → `applySceneEvents` → `renderScene`, encodes the staged
 * frames through the typed ffmpeg codec wrapper, stores the MP4
 * content-addressed with an integrity-verified `RenderArtifactManifest`,
 * and answers the W501 `RenderResult` with honest provenance and
 * degradation. The ONLY differences between the two plugins are their
 * identities and the rendering style they select at the engine seam.
 *
 * Contract rules honored here (the W501 set, see
 * `@sporta/renderer-contract`):
 *
 * - **R1** capability deep-equal per call; **R2** fail-closed rights —
 *   `requiresSourceFrames` is `false` (pure SWM → scene → pixels), and the
 *   avatar-field posture applies: a request that CARRIES source-frame
 *   references without `canReferenceSourceFrames` is rejected
 *   (`rights-denied`) in BOTH `validateRequest` and `render`;
 * - **R3** identity/profile/snapshot gates in both paths; **R4** disposal
 *   is terminal; **R5/R6** provenance + watermark honesty (the numbers
 *   come from the engine's own applied-sequence accounting — never
 *   asserted); **R7** degradation is always flagged with a reason;
 * - **R8** segments are well-formed; the single segment's `artifactRef`
 *   is the content-addressed `artifact://<sha-256>` URI of the REAL
 *   playable MP4 this render produced.
 */
import { readFileSync, unlinkSync } from "node:fs";
import {
  RenderRequest,
  RenderResult,
  SCHEMA_VERSION,
  WorldEventStreamEntry,
  WorldSnapshot,
  type GameEngineAdapter,
  type GameEngineDescriptor,
  type RealityKind,
  type RendererCapability,
} from "@sporta/contracts";
import { RendererContractError } from "@sporta/renderer-contract";
import type {
  Metrics,
  RenderInput,
  RendererContext,
  RendererPlugin,
  RequestValidation,
} from "@sporta/renderer-contract";
import { RenderArtifactStore, type StoredRenderArtifact } from "./artifact";
import { CodecError, encodeFramesToMp4, probeCodec, type ProbedArtifact } from "./codec";
import { Software3DEngine } from "./engine";
import {
  GAME_CAMERA_KEYS,
  GAME_DEFAULT_CAMERA,
  GAME_DEFAULT_DURATION_MS,
  GAME_MAX_DURATION_MS,
  GAME_MIN_DURATION_MS,
  animeNprCapability,
  game3dCapability,
  type GameCameraKey,
  type GameStyleConfig,
} from "./identity";
import { deepEqual, describeValue, isRecord } from "../internal";

type Logger = NonNullable<NonNullable<RendererContext["observability"]>["logger"]>;

/** The per-plugin identity+style configuration (the ONLY delta between R303/R304). */
export interface GameRealityRendererConfig {
  rendererId: string;
  rendererVersion: string;
  /** The engine rendering style this renderer selects. */
  renderingStyle: "stylized-3d" | "cel-shaded";
  /** The frozen reality vocabulary member this renderer produces. */
  reality: RealityKind;
  /** The output-segment id prefix (identity-derived). */
  segmentPrefix: string;
  /** The immutable capability document. */
  capability: () => RendererCapability;
}

/** The detailed render output (the W501 result + the real-artifact chain). */
export interface GameRealityRenderOutput {
  result: RenderResult;
  /** The integrity-verified manifest of the produced MP4. */
  manifest: StoredRenderArtifact["manifest"];
  /** The absolute path of the stored artifact. */
  artifactPath: string;
  /** The artifact's sha-256 content address. */
  contentHash: string;
  /** The ffprobe-validated view of the artifact (honest geometry/duration). */
  probe: ProbedArtifact;
  /** The engine's own render telemetry + descriptor echo (honest numbers). */
  engine: {
    descriptor: GameEngineDescriptor;
    renderMs: number;
    framesRendered: number;
    droppedFrames: number;
  };
}

/** Options for both plugin factories. */
export interface GameRealityRendererOptions {
  /**
   * The game-engine adapter to drive (default: a fresh reference
   * `Software3DEngine`). Inject your own `GameEngineAdapter` to swap the
   * engine behind the frozen seam without touching this plugin.
   */
  engine?: GameEngineAdapter;
  /** The artifact store root (default: a fresh tmpdir root). */
  artifactRoot?: string;
}

/**
 * The shared plugin implementation behind both renderer identities. Every
 * `MaybePromise` method is synchronous (the W501 conformance harness is
 * synchronous).
 */
export interface GameRealityRenderer extends RendererPlugin {
  capability(): RendererCapability;
  init(ctx?: RendererContext): void;
  validateRequest(req: RenderRequest): RequestValidation;
  render(req: RenderRequest, input: RenderInput): RenderResult;
  /**
   * The detailed render: the contract result PLUS the manifest, artifact
   * path/content hash, and the engine telemetry. Package-level surface
   * for hosts and tests — not part of the W501 interface.
   */
  renderDetailed(req: RenderRequest, input: RenderInput): GameRealityRenderOutput;
  health(): { lagMs: number; degraded: boolean };
  dispose(): void;
}

/** Creates the shared implementation for one renderer identity. */
export function createGameRealityRenderer(
  config: GameRealityRendererConfig,
  options: GameRealityRendererOptions = {},
): GameRealityRenderer {
  const engine: GameEngineAdapter = options.engine ?? new Software3DEngine();
  const store = new RenderArtifactStore(
    options.artifactRoot !== undefined ? { artifactRoot: options.artifactRoot } : {},
  );
  let disposed = false;
  let logger: Logger | undefined;
  let metrics: Metrics | undefined;
  let renderCount = 0;

  const bump = (name: string): void => {
    if (metrics === undefined) return; // absent seam: silent no-op
    metrics.counter(name, { rendererId: config.rendererId }).inc();
  };

  const admitRequest = (req: RenderRequest): RequestValidation => {
    const capability = config.capability();
    if (req.rendererId !== config.rendererId || req.rendererVersion !== config.rendererVersion) {
      return {
        ok: false,
        reason: `request targets renderer ${req.rendererId}@${req.rendererVersion}, but this plugin is ${config.rendererId}@${config.rendererVersion}`,
        failureClass: "media-invalid",
      };
    }
    if (
      !capability.supportedOutputProfiles.some((profile) => deepEqual(req.outputProfile, profile))
    ) {
      return {
        ok: false,
        reason: "outputProfile is not one of the supported output profiles",
        failureClass: "media-invalid",
      };
    }
    if (
      req.snapshotVersion < capability.minSnapshotVersion ||
      !Number.isInteger(req.snapshotVersion)
    ) {
      return {
        ok: false,
        reason: `snapshotVersion ${String(req.snapshotVersion)} is below the minimum supported ${capability.minSnapshotVersion} or not an integer`,
        failureClass: "media-invalid",
      };
    }
    if (req.sourceFrameRefs.length > 0 && !req.rightsCapabilities.canReferenceSourceFrames) {
      return {
        ok: false,
        reason: `request carries ${req.sourceFrameRefs.length} source-frame reference(s) but rightsCapabilities.canReferenceSourceFrames is false`,
        failureClass: "rights-denied",
      };
    }
    const style = parseGameStyleConfig(req.styleConfig.config);
    return style.ok
      ? { ok: true }
      : { ok: false, reason: style.reason, failureClass: "media-invalid" };
  };

  const renderDetailed = (req: RenderRequest, input: RenderInput): GameRealityRenderOutput => {
    if (disposed) {
      throw new RendererContractError(
        `${config.rendererId}@${config.rendererVersion} is disposed; render refused`,
        "internal",
        {
          rendererId: config.rendererId,
          rendererVersion: config.rendererVersion,
          sessionId: req.sessionId,
        },
      );
    }
    bump("render_requests_total");
    const startedAt = Date.now();
    try {
      // ---- admission (defense in depth: render re-runs every gate) -------
      const admission = admitRequest(req);
      if (!admission.ok) {
        throw new RendererContractError(
          `render refused: ${admission.reason}`,
          admission.failureClass,
          { rendererId: config.rendererId, sessionId: req.sessionId, reason: admission.reason },
        );
      }
      const style = parseGameStyleConfig(req.styleConfig.config);
      if (!style.ok) {
        // Unreachable (admission parsed it first) — kept for exhaustiveness.
        throw new RendererContractError(`render refused: ${style.reason}`, "media-invalid", {
          sessionId: req.sessionId,
        });
      }

      // ---- input validation (fail-loud on malformed SWM documents) -------
      enforceValidSnapshot(req, input.snapshot);
      enforceValidEvents(req, input.events);

      // ---- codec availability (honest, typed — never a fake encode) ------
      const codec = probeCodec();
      if (!codec.available) {
        throw new RendererContractError(
          `render refused: the h264 codec pipeline is unavailable on this host (${codec.reason ?? "unknown reason"})`,
          "resource-limit",
          { rendererId: config.rendererId, sessionId: req.sessionId, reason: codec.reason },
        );
      }

      // ---- the frozen engine seam: build → apply → render ----------------
      // (This plugin consumes the seam SYNCHRONOUSLY — the W501 conformance
      // path is synchronous; an adapter that resolves asynchronously is
      // refused loudly, never silently awaited or faked.)
      const handle = syncEngineResult(
        engine.buildScene(
          {
            schemaVersion: SCHEMA_VERSION,
            sessionId: req.sessionId,
            snapshotVersion: req.snapshotVersion,
            renderingStyle: config.renderingStyle,
          },
          input.snapshot,
          [],
        ),
        "buildScene",
        config.rendererId,
      );
      const update = syncEngineResult(
        engine.applySceneEvents(handle, input.events),
        "applySceneEvents",
        config.rendererId,
      );
      const render = syncEngineResult(
        engine.renderScene({
          schemaVersion: SCHEMA_VERSION,
          sceneId: handle.sceneId,
          outputProfile: {
            widthPx: req.outputProfile.resolution.w,
            heightPx: req.outputProfile.resolution.h,
            fps: req.outputProfile.frameRate,
            durationMs: style.value.durationMs,
            format: "frames-rgb24",
          },
          presentation: {
            camera: style.value.camera,
            seed: String(style.value.seed),
          },
        }),
        "renderScene",
        config.rendererId,
      );
      if (render.output.kind !== "frame-output") {
        throw new RendererContractError(
          `render refused: the engine returned ${render.output.kind}, but this plugin only consumes staged frame output`,
          "internal",
          { rendererId: config.rendererId, sessionId: req.sessionId },
        );
      }

      // ---- codec: staged frames → real MP4 --------------------------------
      const tempPath = `${store.artifactRootPath()}/encode-tmp-${(renderCount += 1)}.mp4`;
      try {
        encodeFramesToMp4({
          stagingRef: render.output.stagingRef,
          widthPx: render.output.widthPx,
          heightPx: render.output.heightPx,
          fps: render.output.fps,
          frameCount: render.output.frameCount,
          outputPath: tempPath,
        });
      } catch (cause) {
        if (cause instanceof CodecError) {
          throw new RendererContractError(
            `render failed in the codec pipeline: ${cause.message}`,
            "resource-limit",
            { sessionId: req.sessionId, details: cause.details },
          );
        }
        throw cause;
      }
      const mp4Bytes = readFileSync(tempPath);
      try {
        unlinkSync(tempPath);
        // The staged frames were CONSUMED by the encode: the intermediate
        // staging file is pipeline scratch (renderScene re-writes it on
        // every call), so it is removed after a successful encode — the
        // durable artifact is the content-addressed MP4 the store holds.
        unlinkSync(render.output.stagingRef);
      } catch {
        // Best-effort temp cleanup; the artifact itself is already durable.
      }

      // ---- content-addressed store + integrity-verified manifest ---------
      const artifact = store.putEncodedArtifact({
        bytes: mp4Bytes,
        sessionId: req.sessionId,
        reality: config.reality,
        rendererId: config.rendererId,
        rendererVersion: config.rendererVersion,
        snapshotVersion: render.provenance.snapshotVersion,
        lastEventSequence: render.provenance.lastEventSequence,
        expectedWidthPx: render.output.widthPx,
        expectedHeightPx: render.output.heightPx,
        expectedFrameCount: render.output.frameCount,
        expectedFps: render.output.fps,
      });

      // ---- the W501 result --------------------------------------------------
      const startMs = input.snapshot.watermark.watermarkMs;
      const endMs = startMs + style.value.durationMs;
      const lastEvent = input.events.length > 0 ? input.events[input.events.length - 1] : undefined;
      const result: RenderResult = RenderResult.parse({
        sessionId: req.sessionId,
        rendererId: req.rendererId,
        outputSegments: [
          {
            segmentId: `${config.segmentPrefix}-0`,
            startMs,
            endMs,
            artifactRef: `artifact://${artifact.contentHash}`,
          },
        ],
        watermarkAfter: {
          sequence:
            lastEvent !== undefined ? lastEvent.sequence : input.snapshot.watermark.sequence,
          watermarkMs: endMs,
        },
        rendererHealth: {
          lagMs: Date.now() - startedAt,
          degraded: render.degraded || update.degraded,
          ...(render.degraded || update.degraded
            ? {
                degradationReason:
                  [
                    render.degraded ? render.degradationReason : undefined,
                    update.degraded ? update.degradationReason : undefined,
                  ]
                    .filter((reason): reason is string => reason !== undefined)
                    .join("; ") || "engine reported degradation",
              }
            : {}),
        },
        provenance: {
          snapshotVersion: req.snapshotVersion,
          lastEventSequence: render.provenance.lastEventSequence,
        },
      });

      if (logger !== undefined) {
        logger
          .child({ sessionId: req.sessionId, stage: "render" })
          .info(`${config.segmentPrefix}.render`, {
            rendererId: config.rendererId,
            rendererVersion: config.rendererVersion,
            snapshotVersion: req.snapshotVersion,
            eventCount: input.events.length,
            frames: render.output.frameCount,
            contentHash: artifact.contentHash,
            degraded: result.rendererHealth.degraded,
          });
      }
      return {
        result,
        manifest: artifact.manifest,
        artifactPath: artifact.path,
        contentHash: artifact.contentHash,
        probe: artifact.probe,
        engine: {
          descriptor: syncEngineResult(engine.describe(), "describe", config.rendererId),
          renderMs: render.telemetry.renderMs,
          framesRendered: render.telemetry.framesRendered,
          droppedFrames: render.telemetry.droppedFrames,
        },
      };
    } catch (error) {
      bump("render_failures_total");
      throw error;
    }
  };

  return {
    pluginKind: "sporta-renderer",
    capability: config.capability, // R1: the frozen document (fresh object per call)
    init: (ctx?: RendererContext): void => {
      logger = ctx?.observability?.logger;
      metrics = ctx?.observability?.metrics;
    },
    validateRequest: admitRequest,
    render: (req: RenderRequest, input: RenderInput): RenderResult =>
      renderDetailed(req, input).result,
    renderDetailed,
    health: (): { lagMs: number; degraded: boolean } => ({ lagMs: 0, degraded: false }),
    dispose: (): void => {
      disposed = true; // idempotent; terminal for this instance
    },
  };
}

// ---------------------------------------------------------------------------
// The two deliverable identities
// ---------------------------------------------------------------------------

/**
 * Creates the R303 3D game-style renderer (`game-3d.prototype@0.1.0`):
 * the SWM scene presented in the `stylized-3d` engine style, reality
 * `three-d-game`.
 */
export function createGame3DRenderer(
  options: GameRealityRendererOptions = {},
): GameRealityRenderer {
  return createGameRealityRenderer(
    {
      rendererId: "game-3d.prototype",
      rendererVersion: "0.1.0",
      renderingStyle: "stylized-3d",
      reality: "three-d-game",
      segmentPrefix: "game3d",
      capability: game3dCapability,
    },
    options,
  );
}

/**
 * Creates the R304 Anime/NPR renderer (`anime-npr.prototype@0.2.0`): the
 * SAME SWM scene through the SAME engine seam, presented in the
 * `cel-shaded` style, reality `anime-npr`. (0.2.0 = the Wave-3 default-
 * profile slimming — the "on twos" SD default; see ./identity.ts.)
 */
export function createAnimeNprRenderer(
  options: GameRealityRendererOptions = {},
): GameRealityRenderer {
  return createGameRealityRenderer(
    {
      rendererId: "anime-npr.prototype",
      rendererVersion: "0.2.0",
      renderingStyle: "cel-shaded",
      reality: "anime-npr",
      segmentPrefix: "animenpr",
      capability: animeNprCapability,
    },
    options,
  );
}

// ---------------------------------------------------------------------------
// Style-config parsing + input validation (the avatar-field discipline)
// ---------------------------------------------------------------------------

/** Parses the shared style configuration (documented keys, unknown keys ignored). */
export function parseGameStyleConfig(
  config: unknown,
): { ok: true; value: GameStyleConfig } | { ok: false; reason: string } {
  if (config === undefined) {
    return {
      ok: true,
      value: { durationMs: GAME_DEFAULT_DURATION_MS, camera: GAME_DEFAULT_CAMERA, seed: 0 },
    };
  }
  if (!isRecord(config)) {
    return {
      ok: false,
      reason: `styleConfig.config must be an object (got ${describeValue(config)})`,
    };
  }
  let durationMs = GAME_DEFAULT_DURATION_MS;
  if (config.durationMs !== undefined) {
    if (
      typeof config.durationMs !== "number" ||
      !Number.isFinite(config.durationMs) ||
      config.durationMs < GAME_MIN_DURATION_MS ||
      config.durationMs > GAME_MAX_DURATION_MS
    ) {
      return {
        ok: false,
        reason: `styleConfig.config.durationMs must be a finite number in [${GAME_MIN_DURATION_MS}, ${GAME_MAX_DURATION_MS}] (got ${describeValue(config.durationMs)})`,
      };
    }
    durationMs = Math.round(config.durationMs);
  }
  let camera: GameCameraKey = GAME_DEFAULT_CAMERA;
  if (config.camera !== undefined) {
    if (
      typeof config.camera !== "string" ||
      !(GAME_CAMERA_KEYS as readonly string[]).includes(config.camera)
    ) {
      return {
        ok: false,
        reason: `styleConfig.config.camera must be one of ${GAME_CAMERA_KEYS.join(", ")} (got ${describeValue(config.camera)})`,
      };
    }
    camera = config.camera as GameCameraKey;
  }
  let seed = 0;
  if (config.seed !== undefined) {
    if (typeof config.seed !== "number" || !Number.isInteger(config.seed)) {
      return {
        ok: false,
        reason: `styleConfig.config.seed must be an integer (got ${describeValue(config.seed)})`,
      };
    }
    seed = config.seed;
  }
  return { ok: true, value: { durationMs, camera, seed } };
}

/**
 * Unwraps a MaybePromise engine result, refusing asynchronous adapters
 * loudly (this plugin's render is synchronous end to end — the W501
 * conformance harness requirement; async adapters are a host-level
 * integration concern, not silently awaited here).
 */
function syncEngineResult<T>(value: T | Promise<T>, method: string, rendererId: string): T {
  if (value instanceof Promise) {
    throw new RendererContractError(
      `the game-engine adapter resolved ${method} asynchronously; this plugin requires a synchronous adapter`,
      "internal",
      { rendererId, method },
    );
  }
  return value;
}

/** Formats zod issues as `path: message; ...` (the repo's reporting shape). */
function issuesOf(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

/** Validates the SWM snapshot a render consumes (schema + session match). */
function enforceValidSnapshot(req: RenderRequest, snapshot: WorldSnapshot): void {
  const parsed = WorldSnapshot.safeParse(snapshot);
  if (!parsed.success) {
    throw new RendererContractError(
      `render input snapshot is not a valid WorldSnapshot: ${issuesOf(parsed.error)}`,
      "media-invalid",
      { sessionId: req.sessionId, issues: issuesOf(parsed.error) },
    );
  }
  if (snapshot.sessionId !== req.sessionId) {
    throw new RendererContractError(
      `render input snapshot belongs to session "${snapshot.sessionId}", not the requested "${req.sessionId}"`,
      "media-invalid",
      { sessionId: req.sessionId, snapshotSessionId: snapshot.sessionId },
    );
  }
}

/** Validates the event tail (schema, session match, ascending sequences). */
function enforceValidEvents(req: RenderRequest, events: readonly unknown[]): void {
  let previousSequence: number | undefined;
  for (let i = 0; i < events.length; i += 1) {
    const parsed = WorldEventStreamEntry.safeParse(events[i]);
    if (!parsed.success) {
      throw new RendererContractError(
        `render input events[${i}] is not a valid WorldEventStreamEntry: ${issuesOf(parsed.error)}`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    const entry = parsed.data;
    if (entry.event.sessionId !== req.sessionId) {
      throw new RendererContractError(
        `render input events[${i}] belongs to session "${entry.event.sessionId}", not the requested "${req.sessionId}"`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    if (previousSequence !== undefined && entry.sequence <= previousSequence) {
      throw new RendererContractError(
        `render input events[${i}] has sequence ${entry.sequence}, not above the previous ${previousSequence}`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    previousSequence = entry.sequence;
  }
}
