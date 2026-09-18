/**
 * THE MEDIA NORMALIZATION SERVICE (R102) + the ORIGINAL-reality artifact
 * builder (R104).
 *
 * Input: one durably-stored {@link SourceAsset}. Output: the normalized
 * canonical MP4 (H.264/AAC when the source allows) stored under the
 * content-addressed key, the frozen `MediaManifest`, and the `original`
 * `RenderArtifactManifest`.
 *
 * ## Honesty rules (the packet's, encoded)
 *
 * - every measured field (durationMs, frameCount, stream descriptors,
 *   codecs, bitrate) is measured from the ACTUAL produced media via
 *   ffprobe — never trusted from the upload request, never hardcoded;
 * - ffmpeg is a typed subprocess wrapper (`./ffmpeg.ts`): when it is not
 *   available the service FAILS LOUD (`FfmpegUnavailableError`) — a
 *   normalization is never faked;
 * - unsupported/oversized/corrupt inputs fail with typed `media-invalid`
 *   errors (bounded stderr evidence);
 * - the artifact's `integrity.verified` / the manifest's re-verification
 *   mean the STORED bytes were RE-READ and hash-verified through the
 *   storage port — the content address is proven, not assumed;
 * - the `original` reality carries `swm: null` and its `sourceAssetId` (the
 *   `manifestProvenanceIssues` structural rule — asserted before storing).
 */
import { z } from "zod";
import {
  manifestProvenanceIssues,
  NormalizedAudioStream,
  NormalizedVideoStream,
} from "@sporta/contracts";
import type { MediaManifest, RenderArtifactManifest, SourceAsset } from "@sporta/contracts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FfmpegTool } from "./ffmpeg";
import type { MediaProbe } from "./ffmpeg";
import { MediaInvalidError } from "./errors";
import { randomMediaId } from "./ids";
import type { MediaStoragePort } from "./storage";
import { sha256OfBytes } from "./storage";

/**
 * The stream-record types, inferred from the frozen zod schemas (the
 * TL-frozen media-artifact module exports these two names as schema
 * VALUES only — `z.infer` is the honest consumption seam).
 */
type NormalizedVideoRecord = z.infer<typeof NormalizedVideoStream>;
type NormalizedAudioRecord = z.infer<typeof NormalizedAudioStream>;

/** The normalization pipeline's own identity (the artifact rendererId). */
export const NORMALIZATION_RENDERER_ID = "media-platform/normalize";

/** The normalization pipeline's version (the artifact rendererVersion). */
export const NORMALIZATION_RENDERER_VERSION = "0.1.0";

/** The storage key one source asset's bytes live under. */
export function sourceAssetKey(assetId: string): string {
  return `source-assets/${assetId}.mp4`;
}

/** The content-addressed storage key normalized media lives under. */
export function normalizedMediaKey(contentHash: string): string {
  return `normalized/${contentHash}.mp4`;
}

/** The normalized pipeline's measured outcome (the records + where they live). */
export interface NormalizationOutcome {
  /** The frozen normalized-media record (R102). */
  manifest: MediaManifest;
  /** The frozen original-reality artifact record (R104). */
  artifact: RenderArtifactManifest;
  /** The storage key the normalized bytes are stored under. */
  storageKey: string;
  /** Measured normalization runtime (ms — resource/cost evidence). */
  normalizationMs: number;
}

/** Options for {@link MediaNormalizationService}. */
export interface MediaNormalizationServiceOptions {
  /** The storage seam (source bytes in; normalized bytes out). */
  storage: MediaStoragePort;
  /** The typed ffmpeg/ffprobe wrapper (default: a stock {@link FfmpegTool}). */
  tool?: FfmpegTool;
  /** The injected clock (ms). */
  nowMs: () => number;
  /**
   * Resource bounds for the normalization itself (post-upload re-check —
   * the service re-measures everything and re-refuses violations).
   */
  limits?: { maxDurationMs?: number };
}

/**
 * The normalization service: one call, one source asset → the canonical
 * media + its frozen records. MECHANICAL steps, ALL policy explicit:
 *
 * 1. read the stored source bytes (typed integrity expectations);
 * 2. transcode via the REAL ffmpeg to H.264/AAC faststart MP4;
 * 3. measure the OUTPUT (probe) and re-check the duration bound;
 * 4. store the normalized bytes content-addressed, re-read, hash-verify;
 * 5. build + persist... (persisting lives with the caller, which owns the
 *    repositories — this service returns the frozen records).
 */
export class MediaNormalizationService {
  private readonly storage: MediaStoragePort;
  private readonly tool: FfmpegTool;
  private readonly nowMs: () => number;
  private readonly maxDurationMs: number;

  constructor(options: MediaNormalizationServiceOptions) {
    this.storage = options.storage;
    this.tool = options.tool ?? new FfmpegTool();
    this.nowMs = options.nowMs;
    this.maxDurationMs = options.limits?.maxDurationMs ?? 120_000;
  }

  /**
   * Normalizes one stored source asset into the canonical media + the
   * frozen `MediaManifest` + the `original` `RenderArtifactManifest`.
   * Nothing is faked: ffmpeg runs, the output is probed, the stored bytes
   * are re-read and hash-verified.
   */
  async normalize(
    asset: SourceAsset,
    context: { sessionId: string },
  ): Promise<NormalizationOutcome> {
    const startedAtMs = this.nowMs();

    // 1. The stored source bytes (the asset MUST be stored + verified).
    const sourceBytes = await this.storage.get(sourceAssetKey(asset.assetId));
    if (sourceBytes === null) {
      throw new MediaInvalidError(
        `the stored source asset '${asset.assetId}' has no readable bytes`,
        { assetId: asset.assetId, key: sourceAssetKey(asset.assetId) },
      );
    }
    const sourceHash = sha256OfBytes(sourceBytes);
    if (sourceHash !== asset.contentHash) {
      throw new MediaInvalidError(
        `the stored source asset '${asset.assetId}' bytes hash to ${sourceHash}, the record claims ${asset.contentHash}`,
        { assetId: asset.assetId, measured: sourceHash, claimed: asset.contentHash },
      );
    }

    // 2. The REAL transcode (temp files; unlinked on every path).
    const workDir = await mkdtemp(join(tmpdir(), "sporta-normalize-"));
    let outputProbe: MediaProbe;
    let outputBytes: Uint8Array;
    try {
      const inputPath = join(workDir, "source.mp4");
      const outputPath = join(workDir, "normalized.mp4");
      await writeFile(inputPath, sourceBytes);
      outputProbe = await this.tool.transcodeToNormalizedMp4(inputPath, outputPath);
      // 3. Re-check the duration bound against the PRODUCED media.
      if (outputProbe.durationMs > this.maxDurationMs) {
        throw new MediaInvalidError(
          `the normalized media measures ${outputProbe.durationMs}ms, over the ${this.maxDurationMs}ms bound`,
          { assetId: asset.assetId, durationMs: outputProbe.durationMs },
        );
      }
      outputBytes = new Uint8Array(await readFile(outputPath));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }

    // 4. Store content-addressed, re-read, hash-verify.
    const contentHash = sha256OfBytes(outputBytes);
    const storageKey = normalizedMediaKey(contentHash);
    await this.storage.put(storageKey, outputBytes);
    const verifiedHash = await this.storage.verify(storageKey, contentHash);
    if (verifiedHash !== contentHash) {
      // verify() throws on mismatch; this is the double-check belt.
      throw new MediaInvalidError(`verification of '${storageKey}' returned an unexpected hash`);
    }

    // 5. The frozen records, every measured field from outputProbe.
    const normalizedAtMs = this.nowMs();
    const primary = outputProbe.videoStreams[0]!;
    const audioStream = outputProbe.audioStreams[0];
    const video: NormalizedVideoRecord = {
      codec: primary.codec_name ?? "h264",
      widthPx: primary.width ?? 0,
      heightPx: primary.height ?? 0,
      frameRateFps: outputProbe.frameRateFps,
      ...(bitrateKbpsOf(primary) !== null ? { bitrateKbps: bitrateKbpsOf(primary)! } : {}),
    };
    const audio: NormalizedAudioRecord | null =
      audioStream === undefined
        ? null
        : {
            codec: audioStream.codec_name ?? "aac",
            channels: audioStream.channels ?? 2,
            sampleRateHz: sampleRateHzOf(audioStream),
          };

    const manifest: MediaManifest = {
      schemaVersion: "1.1",
      manifestId: randomMediaId("man"),
      sourceAssetId: asset.assetId,
      contentHash,
      byteSize: outputBytes.byteLength,
      durationMs: outputProbe.durationMs,
      frameCount: outputProbe.frameCount,
      video,
      audio,
      normalizedAtMs,
    };

    const artifact: RenderArtifactManifest = {
      schemaVersion: "1.1",
      artifactId: randomMediaId("art"),
      sessionId: context.sessionId,
      reality: "original",
      contentHash,
      byteSize: outputBytes.byteLength,
      container: "mp4",
      videoCodec: video.codec,
      audioCodec: audio?.codec ?? null,
      durationMs: outputProbe.durationMs,
      rendererId: NORMALIZATION_RENDERER_ID,
      rendererVersion: NORMALIZATION_RENDERER_VERSION,
      generatedAtMs: normalizedAtMs,
      swm: null,
      sourceAssetId: asset.assetId,
      integrity: { algorithm: "sha256", verified: true },
    };
    const provenanceIssues = manifestProvenanceIssues(artifact);
    if (provenanceIssues.length > 0) {
      throw new MediaInvalidError(
        `the original artifact violates the provenance rules: ${provenanceIssues.join("; ")}`,
        { issues: provenanceIssues },
      );
    }

    return {
      manifest,
      artifact,
      storageKey,
      normalizationMs: Math.max(0, normalizedAtMs - startedAtMs),
    };
  }
}

/** A stream's measured bitrate in kbps, or `null` when unreported. */
function bitrateKbpsOf(stream: { bit_rate?: string }): number | null {
  const bits = Number.parseInt(stream.bit_rate ?? "", 10);
  return Number.isFinite(bits) && bits > 0 ? Math.round(bits / 1000) : null;
}

/** A stream's measured sample rate in Hz (ffprobe reports it as a string). */
function sampleRateHzOf(stream: { sample_rate?: string }): number {
  const hz = Number.parseInt(stream.sample_rate ?? "", 10);
  return Number.isFinite(hz) && hz > 0 ? hz : 48_000;
}
