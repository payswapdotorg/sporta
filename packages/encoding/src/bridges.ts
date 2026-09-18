/**
 * THE three renderer bridges (R306): thin, ADDITIVE adapters over the
 * renderers' own outputs — the renderers stay untouched. Every bridge
 * produces an `EncodedArtifact` with the source renderer id + version,
 * frame count, duration, codec params, sha-256 content hash, per-frame
 * timing, and the renderer's own manifest VERBATIM (the W504
 * container-manifest pattern).
 *
 * - **tactical** — R301 already emits its own REAL MP4s (staged,
 *   content-addressed, with the frozen `RenderArtifactManifest`): the
 *   bridge ADOPTS + VERIFIES them (reads the staged bytes, re-hashes
 *   against BOTH the staged record's hash and the frozen manifest's
 *   hash, parses the manifest through the frozen contract schema).
 * - **game-3d / anime-npr** — R303/R304 emit rgb24 frame streams behind
 *   the frozen `GameEngineAdapter` seam (`GameEngineFrameOutput`: a
 *   staged, content-addressed frame-sequence file): the bridge encodes
 *   the stream into a REAL MP4 through the `FrameEncoderPort` (the real
 *   ffmpeg adapter — or the fixture adapter in tests).
 * - **raw-frames** — in-memory rgb24 frames through the same port (the
 *   decode/in-memory tier of the seam).
 *
 * All three are synchronous (the W501/tactical precedent), fail-closed
 * (typed `EncodingError` on any inconsistency), and pure given the
 * injected clock.
 */
import { readFileSync } from "node:fs";
import {
  RenderArtifactManifest,
  type GameEngineFrameOutput,
  type RenderRequest,
  type RenderResult,
  type SwmProvenance,
} from "@sporta/contracts";
import type { RenderInput } from "@sporta/renderer-contract";
import { EncodingError } from "./errors";
import { isNonEmptyString, isRecord, sha256Of } from "./internal";
import { buildEncodedArtifact, type BuildEncodedArtifactOptions } from "./manifest";
import {
  countEncode,
  countEncodeFailure,
  logEncode,
  type EncodingObservability,
} from "./observability";
import type { EncodedArtifact, EncodeOrigin, FrameEncoderPort } from "./types";

// ---------------------------------------------------------------------------
// The tactical bridge (adopt + verify R301's own staged MP4)
// ---------------------------------------------------------------------------

/** The staged-artifact record R301's `renderDetailed` details carry (STRUCTURAL — the renderer stays untouched). */
export interface TacticalStagedArtifactLike {
  artifactId: string;
  contentHash: string;
  byteSize: number;
  artifactPath: string;
  manifestPath: string;
  manifest: unknown;
  duplicate: boolean;
}

/** The tactical renderer's detailed surface (STRUCTURAL — satisfies R301's `TacticalRenderer`). */
export interface TacticalRendererLike {
  renderDetailed(
    req: RenderRequest,
    input: RenderInput,
  ): {
    result: RenderResult;
    details: {
      artifact: TacticalStagedArtifactLike;
      frameCount: number;
      durationMs: number;
    };
  };
}

/** Options for {@link bridgeTacticalRenderer}. */
export interface BridgeTacticalOptions extends Omit<
  BuildEncodedArtifactOptions,
  "rendererManifest" | "sessionId"
> {
  /** The R301 tactical renderer (structural — the real plugin satisfies this). */
  renderer: TacticalRendererLike;
  /** The request the caller rendered with (its output profile carries the geometry/fps). */
  req: RenderRequest;
  /** The render input (the same SWM documents the renderer consumed). */
  input: RenderInput;
  /** The observability seam (optional; silent by default). */
  observability?: EncodingObservability;
}

/**
 * The tactical bridge: renders through the REAL R301 plugin and ADOPTS
 * its staged MP4 — the bytes are read, re-hashed against the staged
 * record's hash AND the frozen `RenderArtifactManifest`'s hash, the
 * manifest is parsed through the frozen contract schema (with provenance
 * issues surfaced), and the container manifest carries the frozen
 * manifest VERBATIM.
 */
export function bridgeTacticalRenderer(options: BridgeTacticalOptions): EncodedArtifact {
  const { renderer, req, input } = options;
  const detailed = renderer.renderDetailed(req, input);
  const staged = detailed.details.artifact;
  if (
    !isRecord(staged) ||
    !isNonEmptyString(staged.artifactPath) ||
    !isNonEmptyString(staged.contentHash)
  ) {
    throw new EncodingError(
      "media-invalid",
      "artifact-invalid",
      "the tactical renderer's staged artifact is malformed",
      {},
    );
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(staged.artifactPath);
  } catch (cause) {
    throw new EncodingError(
      "media-invalid",
      "artifact-invalid",
      "the tactical staged artifact could not be read",
      {
        path: staged.artifactPath,
        cause: String(cause),
      },
    );
  }
  const measuredHash = sha256Of(bytes);
  if (measuredHash !== staged.contentHash) {
    throw new EncodingError(
      "internal",
      "artifact-invalid",
      "the tactical staged artifact's bytes do not re-hash to its recorded content hash",
      { path: staged.artifactPath, declared: staged.contentHash, measured: measuredHash },
    );
  }
  // The frozen manifest: parsed through the contract schema, provenance-checked.
  const parsed = RenderArtifactManifest.safeParse(staged.manifest);
  if (!parsed.success) {
    throw new EncodingError(
      "media-invalid",
      "artifact-invalid",
      "the tactical manifest failed the frozen contract schema",
      {
        issues: parsed.error.message.slice(0, 500),
      },
    );
  }
  const frozenManifest = parsed.data;
  if (frozenManifest.contentHash !== measuredHash) {
    throw new EncodingError(
      "internal",
      "artifact-invalid",
      "the tactical manifest's content hash disagrees with the staged bytes",
      { manifestHash: frozenManifest.contentHash, measured: measuredHash },
    );
  }
  if (frozenManifest.reality !== "tactical") {
    throw new EncodingError(
      "media-invalid",
      "artifact-invalid",
      "the tactical manifest's reality is not tactical",
      {
        reality: frozenManifest.reality,
      },
    );
  }
  const origin: EncodeOrigin = {
    rendererId: frozenManifest.rendererId,
    rendererVersion: frozenManifest.rendererVersion,
    bridge: "tactical",
  };
  const fps = req.outputProfile.frameRate;
  const width = req.outputProfile.resolution.w;
  const height = req.outputProfile.resolution.h;
  const frameCount = detailed.details.frameCount;
  if (frameCount < 1 || !Number.isInteger(frameCount)) {
    throw new EncodingError(
      "media-invalid",
      "artifact-invalid",
      "the tactical render's frame count is invalid",
      {
        frameCount,
      },
    );
  }
  // The adopted encode result (the renderer's OWN encode — adopted, not re-encoded).
  const adoptedResult = {
    bytes,
    byteSize: bytes.length,
    contentHash: measuredHash,
    frameCount,
    width,
    height,
    fps,
    durationMs: detailed.details.durationMs,
    encoderKind: "tactical-adopted",
    encoderVersion: null,
    codec: {
      container: frozenManifest.container,
      videoCodec: frozenManifest.videoCodec,
      encoder: `adopted from ${frozenManifest.rendererId}@${frozenManifest.rendererVersion} (the renderer's own real MP4)`,
      preset: "adopted",
      tune: null,
      profile: "baseline",
      level: "3.0",
      crf: null,
      pixFmt: "yuv420p",
      gop: null,
      threads: 1,
      bitexact: true,
    },
  };
  const swm: SwmProvenance | null = frozenManifest.swm === null ? null : { ...frozenManifest.swm };
  const artifact = buildEncodedArtifact(adoptedResult, origin, {
    sessionId: frozenManifest.sessionId,
    swm,
    rendererManifest: frozenManifest,
    ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
  });
  // The adopted artifact is a REAL MP4 (the renderer encoded it — the
  // container IS "mp4", so the builder's tier derivation holds).
  logEncode(options.observability, {
    bridge: "tactical",
    rendererId: origin.rendererId,
    frameCount,
    byteSize: bytes.length,
    contentHash: measuredHash,
    adopted: true,
  });
  countEncode(options.observability, {
    encoderKind: "tactical-adopted",
    bridge: "tactical",
    frameCount,
    byteSize: bytes.length,
  });
  return artifact;
}

// ---------------------------------------------------------------------------
// The game bridges (frame stream → MP4 through the FrameEncoderPort)
// ---------------------------------------------------------------------------

/** Options for {@link bridgeGameFrameOutput}. */
export interface BridgeGameFrameOptions extends BuildEncodedArtifactOptions {
  /** The encoder (the real ffmpeg adapter — or the fixture adapter in tests). */
  encoder: FrameEncoderPort;
  /** The engine's frame output (the frozen `GameEngineFrameOutput` shape). */
  frameOutput: GameEngineFrameOutput;
  /** The provenance of the stream (renderer id/version + bridge + engine). */
  origin: EncodeOrigin;
  /** The observability seam (optional; silent by default). */
  observability?: EncodingObservability;
}

/** Admits a game-engine frame output (fail-closed: rgb24 staged streams only). */
function admitFrameOutput(frameOutput: GameEngineFrameOutput): void {
  if (frameOutput.kind !== "frame-output") {
    throw new EncodingError(
      "media-invalid",
      "frames-invalid",
      "the engine output is not a frame-output",
      {
        kind: (frameOutput as { kind?: string }).kind,
      },
    );
  }
  if (frameOutput.pixelFormat !== "rgb24") {
    throw new EncodingError(
      "media-invalid",
      "frames-invalid",
      "only rgb24 frame streams are encodable (this plane)",
      {
        pixelFormat: frameOutput.pixelFormat,
      },
    );
  }
  if (!isNonEmptyString(frameOutput.stagingRef)) {
    throw new EncodingError(
      "media-invalid",
      "frames-invalid",
      "the frame output carries no stagingRef",
    );
  }
}

/**
 * The game bridge (R303 `game-3d` / R304 `anime-npr`): the engine's staged
 * rgb24 frame stream (the frozen `GameEngineFrameOutput` seam) encoded
 * into a REAL MP4 through the `FrameEncoderPort`.
 */
export function bridgeGameFrameOutput(options: BridgeGameFrameOptions): EncodedArtifact {
  admitFrameOutput(options.frameOutput);
  const { frameOutput, encoder, origin } = options;
  const bridge = origin.bridge;
  if (bridge !== "game-3d" && bridge !== "anime-npr") {
    throw new EncodingError(
      "media-invalid",
      "frames-invalid",
      "the game bridge requires a game origin",
      {
        bridge,
      },
    );
  }
  let artifact: EncodedArtifact;
  try {
    const result = encoder.encode({
      source: {
        kind: "rgb24-file",
        path: frameOutput.stagingRef,
        frameCount: frameOutput.frameCount,
        width: frameOutput.widthPx,
        height: frameOutput.heightPx,
      },
      fps: frameOutput.fps,
      origin,
    });
    artifact = buildEncodedArtifact(result, origin, {
      sessionId: options.sessionId,
      ...(options.swm === undefined ? {} : { swm: options.swm }),
      ...(options.rendererManifest === undefined
        ? {}
        : { rendererManifest: options.rendererManifest }),
      ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    });
  } catch (error) {
    if (error instanceof EncodingError) {
      countEncodeFailure(options.observability, { encoderKind: encoder.kind, kind: error.kind });
    }
    throw error;
  }
  logEncode(options.observability, {
    bridge,
    rendererId: origin.rendererId,
    frameCount: frameOutput.frameCount,
    byteSize: artifact.byteSize,
    contentHash: artifact.contentHash,
  });
  return artifact;
}

/** Options for {@link bridgeRgbFrames}. */
export interface BridgeRgbFramesOptions extends BuildEncodedArtifactOptions {
  encoder: FrameEncoderPort;
  frames: readonly Uint8Array[];
  width: number;
  height: number;
  fps: number;
  origin: EncodeOrigin;
  observability?: EncodingObservability;
}

/**
 * The in-memory bridge: decoded rgb24 frames (each exactly
 * `width × height × 3` bytes) encoded through the same
 * `FrameEncoderPort`.
 */
export function bridgeRgbFrames(options: BridgeRgbFramesOptions): EncodedArtifact {
  const { encoder, origin } = options;
  let artifact: EncodedArtifact;
  try {
    const result = encoder.encode({
      source: {
        kind: "rgb24-frames",
        frames: options.frames,
        width: options.width,
        height: options.height,
      },
      fps: options.fps,
      origin,
    });
    artifact = buildEncodedArtifact(result, origin, {
      sessionId: options.sessionId,
      ...(options.swm === undefined ? {} : { swm: options.swm }),
      ...(options.rendererManifest === undefined
        ? {}
        : { rendererManifest: options.rendererManifest }),
      ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    });
  } catch (error) {
    if (error instanceof EncodingError) {
      countEncodeFailure(options.observability, { encoderKind: encoder.kind, kind: error.kind });
    }
    throw error;
  }
  logEncode(options.observability, {
    bridge: origin.bridge,
    rendererId: origin.rendererId,
    frameCount: options.frames.length,
    byteSize: artifact.byteSize,
    contentHash: artifact.contentHash,
  });
  return artifact;
}
