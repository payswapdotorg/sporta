/**
 * The container-manifest builder + fail-closed validation (R306): every
 * bridge produces an `EncodedArtifact` whose manifest follows the W504
 * container-manifest pattern — the encoded document's own identity,
 * geometry, codec parameters, per-frame timing, content hash, and the
 * RENDERER'S OWN MANIFEST VERBATIM.
 *
 * `integrity.verified` is `true` ONLY after the bytes were re-hashed to
 * the recorded content hash (the honesty rule shared with the W504 /
 * renderer artifact stores). The `generatedAtMs` clock is INJECTED (the
 * deterministic `TEST_EPOCH_MS` constant by default — a CONSTANT, so
 * fresh builds are byte-identical; production hosts MUST inject a real
 * clock).
 */
import { TEST_EPOCH_MS } from "@sporta/testing";
import { EncodingError } from "./errors";
import {
  encodedManifestIdOf,
  isFiniteNumber,
  isRecord,
  isNonEmptyString,
  sha256Of,
} from "./internal";
import type {
  EncodedArtifact,
  EncodedContainerManifest,
  EncodedFrameTiming,
  FrameEncodeResult,
} from "./types";
import type { EncodeOrigin } from "./types";

/** The schema version of this manifest shape. */
export const ENCODED_MANIFEST_SCHEMA_VERSION = "1.0";

/** The canonical identity string a manifest id derives from (the W504 segmentId precedent). */
export function encodedIdentityOf(options: {
  sessionId: string;
  origin: EncodeOrigin;
  frameCount: number;
  width: number;
  height: number;
  fps: number;
}): string {
  return [
    options.sessionId,
    options.origin.bridge,
    `${options.origin.rendererId}@${options.origin.rendererVersion}`,
    ...(options.origin.engineId === undefined
      ? []
      : [`${options.origin.engineId}@${options.origin.engineVersion ?? "?"}`]),
    `${options.frameCount}f`,
    `${options.width}x${options.height}`,
    `@${options.fps}`,
  ].join("|");
}

/** The per-frame output timing of one geometry (pure arithmetic). */
export function frameTimingsOf(frameCount: number, fps: number): EncodedFrameTiming[] {
  const timings: EncodedFrameTiming[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    timings.push({ frameIndex: i, frameMs: Math.round((i * 1_000) / fps) });
  }
  return timings;
}

/** Options for {@link buildEncodedArtifact}. */
export interface BuildEncodedArtifactOptions {
  /** The canonical session all realities of this render share. */
  sessionId: string;
  /** The SWM provenance of the encoded reality (null for raw streams without SWM ties). */
  swm?: { snapshotVersion: number; lastEventSequence: number } | null;
  /** The renderer's own manifest, VERBATIM (rides in the container manifest). */
  rendererManifest?: unknown;
  /** The injected clock (default: the deterministic TEST_EPOCH_MS constant). */
  nowMs?: () => number;
}

/**
 * Builds one `EncodedArtifact` from an encode result: verifies the bytes
 * (re-hash → `contentHash`), stamps the container manifest (identity-
 * derived id, per-frame timing, codec params, integrity), and returns the
 * bytes + manifest pair. Pure given the (injected) clock.
 */
export function buildEncodedArtifact(
  result: FrameEncodeResult,
  origin: EncodeOrigin,
  options: BuildEncodedArtifactOptions,
): EncodedArtifact {
  if (!isNonEmptyString(options.sessionId)) {
    throw new EncodingError(
      "media-invalid",
      "artifact-invalid",
      "sessionId must be a non-empty string",
    );
  }
  // Integrity: the bytes re-hash to the recorded content hash.
  const verifiedHash = sha256Of(result.bytes);
  if (verifiedHash !== result.contentHash) {
    throw new EncodingError(
      "internal",
      "artifact-invalid",
      "the encode result's content hash disagrees with a re-hash of its own bytes",
      { declared: result.contentHash, measured: verifiedHash },
    );
  }
  if (result.byteSize !== result.bytes.length) {
    throw new EncodingError(
      "internal",
      "artifact-invalid",
      "the encode result's byteSize disagrees with its own bytes",
      {
        declared: result.byteSize,
        measured: result.bytes.length,
      },
    );
  }
  const identity = encodedIdentityOf({
    sessionId: options.sessionId,
    origin,
    frameCount: result.frameCount,
    width: result.width,
    height: result.height,
    fps: result.fps,
  });
  const manifestId = encodedManifestIdOf(identity);
  const manifest: EncodedContainerManifest = {
    schemaVersion: ENCODED_MANIFEST_SCHEMA_VERSION,
    manifestId,
    sessionId: options.sessionId,
    bridge: origin.bridge,
    source: {
      rendererId: origin.rendererId,
      rendererVersion: origin.rendererVersion,
      ...(origin.engineId === undefined ? {} : { engineId: origin.engineId }),
      ...(origin.engineVersion === undefined ? {} : { engineVersion: origin.engineVersion }),
    },
    swm:
      options.swm === undefined || options.swm === null
        ? null
        : {
            snapshotVersion: options.swm.snapshotVersion,
            lastEventSequence: options.swm.lastEventSequence,
          },
    encoder: {
      kind: result.encoderKind,
      version: result.encoderVersion,
      codec: result.codec,
    },
    geometry: {
      widthPx: result.width,
      heightPx: result.height,
      fps: result.fps,
      frameCount: result.frameCount,
      durationMs: result.durationMs,
    },
    contentHash: result.contentHash,
    byteSize: result.byteSize,
    frames: frameTimingsOf(result.frameCount, result.fps),
    rendererManifest: options.rendererManifest === undefined ? null : options.rendererManifest,
    integrity: { algorithm: "sha256", verified: true },
    generatedAtMs: (options.nowMs ?? (() => TEST_EPOCH_MS))(),
  };
  // The artifact's tier: a REAL MP4 (container "mp4" — the ffmpeg adapter
  // and adopted tactical renders) vs the fixture tier (never video).
  const kind = result.codec.container === "mp4" ? "mp4" : "fixture";
  return {
    kind,
    manifestId,
    sessionId: options.sessionId,
    contentHash: result.contentHash,
    byteSize: result.byteSize,
    bytes: result.bytes,
    manifest,
  };
}

/** The result of `validateEncodedManifest`: admitted, or refused with issues. */
export type EncodedManifestValidation =
  { ok: true; value: EncodedContainerManifest } | { ok: false; issues: string[] };

/**
 * Fail-closed structural validation of a container manifest document
 * (unknown keys ignored — the camera-director policy posture). Pure.
 */
export function validateEncodedManifest(value: unknown): EncodedManifestValidation {
  const issues: string[] = [];
  const push = (path: string, message: string): void => {
    issues.push(`${path}: ${message}`);
  };
  if (!isRecord(value)) {
    return { ok: false, issues: ["manifest: must be an object"] };
  }
  if (value.schemaVersion !== ENCODED_MANIFEST_SCHEMA_VERSION) {
    push("manifest.schemaVersion", `must be "${ENCODED_MANIFEST_SCHEMA_VERSION}"`);
  }
  if (!isNonEmptyString(value.manifestId)) {
    push("manifest.manifestId", "must be a non-empty string");
  }
  if (!isNonEmptyString(value.sessionId)) {
    push("manifest.sessionId", "must be a non-empty string");
  }
  if (
    value.bridge !== "tactical" &&
    value.bridge !== "game-3d" &&
    value.bridge !== "anime-npr" &&
    value.bridge !== "raw-frames"
  ) {
    push("manifest.bridge", "must be a bridge id (tactical / game-3d / anime-npr / raw-frames)");
  }
  if (
    !isRecord(value.source) ||
    !isNonEmptyString(value.source.rendererId) ||
    !isNonEmptyString(value.source.rendererVersion)
  ) {
    push("manifest.source", "must carry rendererId + rendererVersion");
  }
  if (value.swm !== null && value.swm !== undefined) {
    if (
      !isRecord(value.swm) ||
      !isFiniteNumber(value.swm.snapshotVersion) ||
      !isFiniteNumber(value.swm.lastEventSequence)
    ) {
      push("manifest.swm", "must be null or carry snapshotVersion + lastEventSequence");
    }
  }
  if (
    !isRecord(value.encoder) ||
    !isNonEmptyString(value.encoder.kind) ||
    !isRecord(value.encoder.codec)
  ) {
    push("manifest.encoder", "must carry kind + codec");
  }
  const geometry = value.geometry;
  if (
    !isRecord(geometry) ||
    !isFiniteNumber(geometry.widthPx) ||
    !isFiniteNumber(geometry.heightPx) ||
    !isFiniteNumber(geometry.fps) ||
    geometry.fps <= 0 ||
    !isFiniteNumber(geometry.frameCount) ||
    geometry.frameCount < 1 ||
    !isFiniteNumber(geometry.durationMs)
  ) {
    push("manifest.geometry", "must carry widthPx/heightPx/fps/frameCount/durationMs");
  }
  if (typeof value.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(value.contentHash)) {
    push("manifest.contentHash", "must be 64 lowercase hex digits (sha-256)");
  }
  if (!isFiniteNumber(value.byteSize) || value.byteSize < 1) {
    push("manifest.byteSize", "must be a finite number >= 1");
  }
  if (
    !Array.isArray(value.frames) ||
    value.frames.length !== (isRecord(geometry) ? geometry.frameCount : -1)
  ) {
    push("manifest.frames", "must be an array with exactly geometry.frameCount entries");
  } else {
    for (let i = 0; i < value.frames.length; i += 1) {
      const frame = value.frames[i];
      if (!isRecord(frame) || frame.frameIndex !== i || !isFiniteNumber(frame.frameMs)) {
        push("manifest.frames", `[${i}] must be { frameIndex: ${i}, frameMs: number }`);
        break;
      }
    }
  }
  if (
    !isRecord(value.integrity) ||
    value.integrity.algorithm !== "sha256" ||
    value.integrity.verified !== true
  ) {
    push("manifest.integrity", 'must be { algorithm: "sha256", verified: true }');
  }
  if (!isFiniteNumber(value.generatedAtMs) || value.generatedAtMs < 0) {
    push("manifest.generatedAtMs", "must be a finite number >= 0");
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: value as unknown as EncodedContainerManifest };
}
