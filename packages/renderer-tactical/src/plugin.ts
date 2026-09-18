/**
 * `createTacticalRenderer` — the R301 `RendererPlugin` implementation
 * (`tactical.prototype@0.1.0`): a REAL playable h264/MP4 tactical
 * visualization of the SWM.
 *
 * Data flow (architecture-lock §5 — the plugin consumes validated plain
 * `@sporta/contracts` documents only):
 *
 * ```text
 * RenderRequest + RenderInput (SWM snapshot + ordered events)
 *   -> projectScene (the canonical W601 scene — @sporta/scene-projection)
 *   -> buildTacticalView (the 2D view-model; no renderer-specific truth)
 *   -> FrameBuffer frames (the package's own pure-TS RGB24 compositor)
 *   -> FfmpegH264Codec (typed wrapper — REAL h264/MP4 bytes)
 *   -> TacticalArtifactStore (staging + content-addressed artifact name,
 *      the W504 conventions) + the frozen RenderArtifactManifest
 * ```
 *
 * Contract posture (W501 rules, proven by `runConformance`):
 *
 * - **R1**: `capability()` returns a deep-equal clone on every call.
 * - **R2**: `requiresSourceFrames` is `false` (pure SWM projection — no
 *   source pixels); the reference fail-closed gate is kept for the day the
 *   renderer needs source frames.
 * - **R3**: renderer identity, output profile, and snapshot-version gates in
 *   BOTH `validateRequest` and `render` (defense in depth).
 * - **R4**: `dispose` is terminal — a post-dispose `render` throws
 *   `RendererContractError` (`internal`).
 * - **R5**: `provenance.lastEventSequence` is the last input event's sequence
 *   (all events are applied through the canonical scene projection; `0`
 *   with no events) and `provenance.snapshotVersion` echoes the request.
 * - **R6**: `watermarkAfter` = the last event sequence (or the snapshot's
 *   watermark sequence without events), with `watermarkMs` advancing from
 *   the snapshot watermark by the true encoded duration.
 * - **R7**: degradation only ever via the explicit `simulateDegradation`
 *   style flag, always with a reason.
 * - **R8**: one well-formed segment covering the encoded window, with a
 *   non-empty artifact reference.
 *
 * Determinism: `render` is a pure function of `(req, input)` plus the
 * DECLARED staging root — no RNG, no ambient clock (the default clock is the
 * deterministic `TEST_EPOCH_MS + ticks` seam; production hosts inject a real
 * one, the output-pipeline precedent). The same request over the same input
 * in a fresh staging root produces byte-identical MP4 artifacts and
 * deep-equal manifests (pinned by the determinism test).
 *
 * Encode toolchain honesty: the plugin REQUIRES a working
 * {@link TacticalVideoCodec} (default: ffmpeg/libx264, probed at
 * construction). When the encoder is unavailable the constructor fails loud
 * with a `TacticalCodecError` — the renderer never fabricates an MP4 or
 * claims video that was not produced.
 */
import type {
  RenderRequest,
  RenderResult,
  RendererCapability,
  RendererHealth,
} from "@sporta/contracts";
import { RendererContractError } from "@sporta/renderer-contract";
import type {
  Metrics,
  RenderInput,
  RendererContext,
  RendererPlugin,
  RequestValidation,
} from "@sporta/renderer-contract";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { projectScene, serializeScene, type SceneSpecification } from "@sporta/scene-projection";
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  TacticalArtifactStore,
  tacticalArtifactIdOf,
  type StagedTacticalArtifact,
} from "./artifact";
import { TacticalCodecError, createFfmpegH264Codec, type TacticalVideoCodec } from "./codec";
import { FrameBuffer } from "./canvas";
import { drawTacticalFrame } from "./draw";
import {
  DEFAULT_TACTICAL_DURATION_MS,
  TACTICAL_CAPABILITY,
  TACTICAL_RENDERER_ID,
  TACTICAL_RENDERER_VERSION,
} from "./identity";
import { buildTacticalView, type TacticalSceneView } from "./scene";
import { fnv1a32 } from "./palette";
import { pitchLayout } from "./pitch";

type Logger = NonNullable<NonNullable<RendererContext["observability"]>["logger"]>;

/** The parsed `styleConfig.config` of the tactical renderer. */
export interface TacticalStyleConfig {
  /** The clip duration in ms (default 4000, min 100). */
  durationMs: number;
  /** Explicit degradation simulation (R7 evidence). */
  simulateDegradation: boolean;
}

/** The package-level detailed render output (beyond the contract result). */
export interface TacticalRenderDetails {
  /** The canonical W601 scene the render consumed (for hosts/evaluators). */
  scene: SceneSpecification;
  /** The 2D tactical view-model of the same scene. */
  view: TacticalSceneView;
  /** The number of frames actually rendered. */
  frameCount: number;
  /** The true duration of the encoded clip, ms. */
  durationMs: number;
  /** The staged artifact record (real MP4 on disk + the frozen manifest). */
  artifact: StagedTacticalArtifact;
}

/** The result of one detailed render. */
export interface TacticalDetailedRender {
  result: RenderResult;
  details: TacticalRenderDetails;
}

/**
 * The synchronous plugin surface (the W501 conformance harness is
 * synchronous); assignable to {@link RendererPlugin} (return-type narrowing
 * is covariant).
 */
export interface TacticalRenderer extends RendererPlugin {
  capability(): RendererCapability;
  init(ctx?: RendererContext): void;
  render(req: RenderRequest, input: RenderInput): RenderResult;
  /**
   * The detailed render: the contract result PLUS the canonical scene, the
   * view-model, the frame accounting, and the staged artifact record.
   */
  renderDetailed(req: RenderRequest, input: RenderInput): TacticalDetailedRender;
  health(): RendererHealth;
  dispose(): void;
}

/** Options for {@link createTacticalRenderer}. */
export interface TacticalRendererOptions {
  /**
   * The DECLARED staging root for artifacts (W504 layout:
   * `<root>/objects/<sha256>` + `<root>/meta/<artifactId>.json`). Required —
   * the renderer never writes to an implicit working directory.
   */
  stagingDir: string;
  /**
   * The video codec (default: the ffmpeg/libx264 wrapper, probed at
   * construction — a missing encoder fails loud).
   */
  codec?: TacticalVideoCodec;
  /**
   * The clock in epoch milliseconds (default: the deterministic
   * `TEST_EPOCH_MS + ticks` seam — production hosts MUST inject a real wall
   * clock, the output-pipeline precedent).
   */
  nowMs?: () => number;
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return `string "${value}"`;
  if (typeof value === "number") return `number ${String(value)}`;
  if (typeof value === "boolean") return `boolean ${String(value)}`;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Parses `styleConfig.config` (undefined → defaults; unknown keys ignored). */
function parseStyleConfig(
  config: unknown,
): { ok: true; value: TacticalStyleConfig } | { ok: false; reason: string } {
  if (config === undefined) {
    return {
      ok: true,
      value: { durationMs: DEFAULT_TACTICAL_DURATION_MS, simulateDegradation: false },
    };
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return {
      ok: false,
      reason: `styleConfig.config must be an object (got ${describeValue(config)})`,
    };
  }
  const record = config as Record<string, unknown>;
  let durationMs = DEFAULT_TACTICAL_DURATION_MS;
  if (record.durationMs !== undefined) {
    if (
      typeof record.durationMs !== "number" ||
      !Number.isFinite(record.durationMs) ||
      record.durationMs < 100
    ) {
      return {
        ok: false,
        reason: `styleConfig.config.durationMs must be a finite number >= 100 (got ${describeValue(record.durationMs)})`,
      };
    }
    durationMs = Math.round(record.durationMs);
  }
  let simulateDegradation = false;
  if (record.simulateDegradation !== undefined) {
    if (typeof record.simulateDegradation !== "boolean") {
      return {
        ok: false,
        reason: `styleConfig.config.simulateDegradation must be a boolean (got ${describeValue(record.simulateDegradation)})`,
      };
    }
    simulateDegradation = record.simulateDegradation;
  }
  return { ok: true, value: { durationMs, simulateDegradation } };
}

/** A fresh deep clone of the capability document (R1). */
function cloneCapability(): RendererCapability {
  return {
    ...TACTICAL_CAPABILITY,
    supportedOutputProfiles: TACTICAL_CAPABILITY.supportedOutputProfiles.map((p) => ({
      ...p,
      resolution: { ...p.resolution },
    })),
  };
}

/**
 * Creates the tactical renderer. Fails loud (typed) when the encode toolchain
 * is unavailable — never a half-constructed renderer.
 */
export function createTacticalRenderer(options: TacticalRendererOptions): TacticalRenderer {
  if (typeof options.stagingDir !== "string" || options.stagingDir.length < 1) {
    throw new RendererContractError(
      "createTacticalRenderer requires a declared stagingDir",
      "internal",
    );
  }
  const codec = options.codec ?? createFfmpegH264Codec();
  if (codec === null || !codec.available()) {
    throw new TacticalCodecError(
      "the tactical renderer requires a working video encoder (ffmpeg/libx264) — none was found",
    );
  }
  const store = new TacticalArtifactStore(options.stagingDir);

  let disposed = false;
  let logger: Logger | undefined;
  let metrics: Metrics | undefined;
  let ticks = 0;
  const nowMs =
    options.nowMs ??
    ((): number => {
      ticks += 1;
      return TEST_EPOCH_MS + ticks;
    });

  const bump = (name: string): void => {
    if (metrics === undefined) return; // absent seam: silent no-op
    metrics.counter(name, { rendererId: TACTICAL_RENDERER_ID }).inc();
  };

  const logRenderCall = (req: RenderRequest, input: RenderInput, frameCount: number): void => {
    if (logger === undefined) return; // absent seam: silent no-op
    logger.child({ sessionId: req.sessionId, stage: "render" }).info("tactical.render", {
      rendererId: TACTICAL_RENDERER_ID,
      rendererVersion: TACTICAL_RENDERER_VERSION,
      snapshotVersion: req.snapshotVersion,
      eventCount: input.events.length,
      frameCount,
    });
  };

  const validateRequest = (req: RenderRequest): RequestValidation => {
    // R3: the request must target this exact renderer identity.
    if (
      req.rendererId !== TACTICAL_RENDERER_ID ||
      req.rendererVersion !== TACTICAL_RENDERER_VERSION
    ) {
      return {
        ok: false,
        reason: `request targets renderer ${req.rendererId}@${req.rendererVersion}, but this plugin is ${TACTICAL_RENDERER_ID}@${TACTICAL_RENDERER_VERSION}`,
        failureClass: "media-invalid",
      };
    }
    // R3: the output profile must be one of the supported profiles.
    const profileSupported = TACTICAL_CAPABILITY.supportedOutputProfiles.some(
      (supported) =>
        supported.resolution.w === req.outputProfile.resolution.w &&
        supported.resolution.h === req.outputProfile.resolution.h &&
        supported.frameRate === req.outputProfile.frameRate &&
        supported.codec === req.outputProfile.codec &&
        supported.container === req.outputProfile.container &&
        supported.latencyClass === req.outputProfile.latencyClass,
    );
    if (!profileSupported) {
      return {
        ok: false,
        reason: "outputProfile is not one of the supported output profiles",
        failureClass: "media-invalid",
      };
    }
    // R3: snapshot-version gate.
    if (req.snapshotVersion < TACTICAL_CAPABILITY.minSnapshotVersion) {
      return {
        ok: false,
        reason: `snapshotVersion ${req.snapshotVersion} is below the minimum supported ${TACTICAL_CAPABILITY.minSnapshotVersion}`,
        failureClass: "media-invalid",
      };
    }
    // R2: fail-closed source-frame rights (n/a today — the tactical view is
    // a pure SWM projection — but the gate is the reference pattern).
    if (
      TACTICAL_CAPABILITY.requiresSourceFrames &&
      !req.rightsCapabilities.canReferenceSourceFrames
    ) {
      return {
        ok: false,
        reason:
          "renderer requires source frames but rightsCapabilities.canReferenceSourceFrames is false",
        failureClass: "rights-denied",
      };
    }
    const config = parseStyleConfig(req.styleConfig.config);
    if (!config.ok) {
      return { ok: false, reason: config.reason, failureClass: "media-invalid" };
    }
    return { ok: true };
  };

  const renderDetailed = (req: RenderRequest, input: RenderInput): TacticalDetailedRender => {
    // R4: post-dispose use is a contract violation.
    if (disposed) {
      throw new RendererContractError(
        `${TACTICAL_RENDERER_ID}@${TACTICAL_RENDERER_VERSION} is disposed; render refused`,
        "internal",
        {
          rendererId: TACTICAL_RENDERER_ID,
          rendererVersion: TACTICAL_RENDERER_VERSION,
          sessionId: req.sessionId,
        },
      );
    }
    const startedAtMs = nowMs();
    bump("render_requests_total");

    // Defense in depth: render re-runs every validateRequest gate.
    const validation = validateRequest(req);
    if (!validation.ok) {
      bump("render_failures_total");
      throw new RendererContractError(
        `render refused: ${validation.reason}`,
        validation.failureClass,
        {
          rendererId: TACTICAL_RENDERER_ID,
          rendererVersion: TACTICAL_RENDERER_VERSION,
          sessionId: req.sessionId,
          reason: validation.reason,
        },
      );
    }
    const style = parseStyleConfig(req.styleConfig.config);
    if (!style.ok) {
      bump("render_failures_total");
      throw new RendererContractError(`render refused: ${style.reason}`, "media-invalid", {
        reason: style.reason,
      });
    }

    // The canonical scene: SWM snapshot + ordered events → W601 spec.
    let scene: SceneSpecification;
    try {
      scene = projectScene(input.snapshot, { events: input.events });
    } catch (cause) {
      bump("render_failures_total");
      throw new RendererContractError(
        `render refused: the render input does not project to a canonical scene (${(cause as Error).message})`,
        "media-invalid",
        { reason: (cause as Error).message },
      );
    }
    const view = buildTacticalView(scene);

    // Frame plan (deterministic arithmetic only). The layout is pre-computed
    // so an unusable resolution fails loud BEFORE any frame is rendered.
    const width = req.outputProfile.resolution.w;
    const height = req.outputProfile.resolution.h;
    const fps = req.outputProfile.frameRate;
    pitchLayout(width, height);
    const frameCount = Math.max(1, Math.round((style.value.durationMs * fps) / 1000));
    const durationMs = Math.round((frameCount * 1000) / fps);
    const videoOriginMs = input.snapshot.watermark.watermarkMs;

    // The logical artifact identity (content-INdependent, the W504 segmentId
    // precedent). The identity carries the renderer/style/session/scope/
    // output fields AND a digest of the canonical scene serialization — two
    // renders of the same request over DIFFERENT SWM inputs are different
    // artifacts (different ids), so a re-encode that changes content under
    // one id fails loud as a conflict instead of silently double-storing.
    const identity = [
      TACTICAL_RENDERER_ID,
      TACTICAL_RENDERER_VERSION,
      req.styleConfig.styleId,
      req.styleConfig.configSchemaVersion,
      req.sessionId,
      req.snapshotVersion,
      req.eventsSinceSequence,
      videoOriginMs,
      durationMs,
      frameCount,
      width,
      height,
      fps,
      req.outputProfile.codec,
      req.outputProfile.container,
      fnv1a32(serializeScene(scene)).toString(16).padStart(8, "0"),
    ]
      .map(String)
      .join("|");

    // Render + stage the raw RGB24 frame sequence, then encode it. The temp
    // file name is identity-derived (deterministic; the renderer is
    // synchronous, and the file is removed after the encode).
    const rawPath = join(options.stagingDir, "tmp", `${tacticalArtifactIdOf(identity)}.rgb24`);
    rmSync(rawPath, { force: true });
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const elapsedMs = Math.min(durationMs - 1, Math.round((frameIndex * 1000) / fps));
      const buffer = new FrameBuffer(width, height);
      drawTacticalFrame(buffer, {
        scene,
        view,
        elapsedMs,
        durationMs,
        videoOriginMs,
      });
      if (frameIndex === 0) {
        writeFileSync(rawPath, buffer.data);
      } else {
        appendFileSync(rawPath, buffer.data);
      }
    }

    let bytes: Buffer;
    try {
      bytes = codec.encode({ rawFrameSequencePath: rawPath, frameCount, width, height, fps });
    } finally {
      rmSync(rawPath, { force: true });
    }

    // Stage the real artifact (content-addressed, integrity-verified on
    // re-read) + the frozen manifest with the SWM provenance.
    const lastEventSequence =
      input.events.length > 0 ? input.events[input.events.length - 1]!.sequence : 0;
    const artifact = store.put({
      bytes,
      sessionId: req.sessionId,
      identity,
      swm: { snapshotVersion: req.snapshotVersion, lastEventSequence },
      durationMs,
      generatedAtMs: startedAtMs,
    });

    const lagMs = Math.max(0, nowMs() - startedAtMs);
    logRenderCall(req, input, frameCount);

    const result: RenderResult = {
      sessionId: req.sessionId,
      rendererId: req.rendererId,
      outputSegments: [
        {
          segmentId: "tac-0",
          startMs: videoOriginMs,
          endMs: videoOriginMs + durationMs,
          artifactRef: `tactical-artifact://${artifact.contentHash}`,
        },
      ],
      watermarkAfter: {
        watermarkMs: videoOriginMs + durationMs,
        sequence: input.events.length > 0 ? lastEventSequence : input.snapshot.watermark.sequence,
      },
      rendererHealth: {
        lagMs,
        degraded: style.value.simulateDegradation,
        ...(style.value.simulateDegradation ? { degradationReason: "simulated-degradation" } : {}),
      },
      provenance: { snapshotVersion: req.snapshotVersion, lastEventSequence },
    };

    return {
      result,
      details: {
        scene,
        view,
        frameCount,
        durationMs,
        artifact,
      },
    };
  };

  return {
    pluginKind: "sporta-renderer",
    capability: (): RendererCapability => cloneCapability(), // R1: deep-equal per call
    init: (ctx?: RendererContext): void => {
      logger = ctx?.observability?.logger;
      metrics = ctx?.observability?.metrics;
    },
    validateRequest,
    render: (req: RenderRequest, input: RenderInput): RenderResult =>
      renderDetailed(req, input).result,
    renderDetailed,
    health: (): RendererHealth => ({ lagMs: 0, degraded: false }),
    dispose: (): void => {
      disposed = true; // idempotent; terminal for this instance
    },
  };
}
