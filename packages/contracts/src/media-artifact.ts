/**
 * Media artifact contracts — Wave-0 freeze of the real-media loop
 * (R101/R102/R104, docs/testing/mvp-reality-engine-acceptance.md §D).
 *
 * These are the durable, integrity-verifiable records for the real upload
 * path: the uploaded {@link SourceAsset}, the normalized {@link MediaManifest},
 * and the {@link RenderArtifactManifest} for every produced reality. All
 * three are content-addressed (sha-256, 64 lowercase hex — the repo-wide
 * convention shared with the compute canonical layer and W504 output
 * pipeline).
 *
 * Honesty rules encoded here:
 * - an artifact is not "complete" until its content hash is verified;
 * - the four MVP realities are a CLOSED vocabulary (`RealityKind`) so the
 *   same-event gate (R605) can verify that Original/Tactical/3D/Anime
 *   manifests share one session/SWM lineage;
 * - derived realities MUST carry their SWM provenance (snapshot version +
 *   applied event sequence) — "no renderer silently invents or changes
 *   canonical events".
 */
import { z } from "zod";
import { schemaVersionField } from "./versioning";

/** sha-256 content address: 64 lowercase hex digits. */
export const ContentAddress = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "content hash must be 64 lowercase hex digits");
export type ContentAddress = z.infer<typeof ContentAddress>;

/**
 * The closed reality vocabulary of the MVP (R604 four-output gate). Adding
 * a reality is an additive contract change; the four MVP outputs are
 * Original, Tactical, 3D Game and Anime/NPR.
 */
export const RealityKind = z.enum(["original", "tactical", "three-d-game", "anime-npr"]);
export type RealityKind = z.infer<typeof RealityKind>;

/** Upload states of a source asset (R101). */
export const SourceAssetUploadState = z.enum(["uploading", "uploaded", "stored", "rejected"]);
export type SourceAssetUploadState = z.infer<typeof SourceAssetUploadState>;

/** Normalized video stream descriptor (post R102 validation). */
export const NormalizedVideoStream = z.object({
  codec: z.string().min(1),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  frameRateFps: z.number().positive(),
  bitrateKbps: z.number().positive().optional(),
});

/** Normalized audio stream descriptor (null when the source has no audio). */
export const NormalizedAudioStream = z.object({
  codec: z.string().min(1),
  channels: z.number().int().positive(),
  sampleRateHz: z.number().int().positive(),
});

/**
 * One authorized source upload: content-addressed, rights-declared,
 * lifecycle-tracked. `declaredRightsPolicyId` must reference the
 * authorization policy declared at the ingestion boundary (fail-closed
 * rights, architecture-lock §11).
 */
export const SourceAsset = z.object({
  schemaVersion: schemaVersionField,
  assetId: z.string().min(1),
  /** sha-256 of the uploaded bytes — REQUIRED before `stored`. */
  contentHash: ContentAddress,
  byteSize: z.number().int().positive(),
  /** Container/file extension as validated (e.g. "mp4"). */
  container: z.string().min(1),
  durationMs: z.number().int().positive(),
  videoStreamCount: z.number().int().min(1),
  audioStreamCount: z.number().int().min(0),
  declaredRightsPolicyId: z.string().min(1),
  uploadState: SourceAssetUploadState,
  uploadedAtMs: z.number().int().min(0),
  /** Whether the stored bytes have been re-read and hash-verified. */
  checksumVerified: z.boolean(),
});
export type SourceAsset = z.infer<typeof SourceAsset>;

/**
 * The normalization output (R102): what the canonical encoding of the
 * source IS, so every downstream consumer (perception, renderers, playback)
 * binds to one declared timeline.
 */
export const MediaManifest = z.object({
  schemaVersion: schemaVersionField,
  manifestId: z.string().min(1),
  sourceAssetId: z.string().min(1),
  /** sha-256 of the normalized media bytes. */
  contentHash: ContentAddress,
  byteSize: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  frameCount: z.number().int().positive(),
  video: NormalizedVideoStream,
  /** `null` when the source carries no audio track. */
  audio: NormalizedAudioStream.nullable(),
  normalizedAtMs: z.number().int().min(0),
});
export type MediaManifest = z.infer<typeof MediaManifest>;

/**
 * The SWM lineage every DERIVED reality must carry (R605 same-event
 * integrity). The `original` reality references the source manifest instead.
 */
export const SwmProvenance = z.object({
  /** The SWM snapshot version the render consumed. */
  snapshotVersion: z.number().int().min(0),
  /** The highest applied event sequence (0 when rendering a snapshot only). */
  lastEventSequence: z.number().int().min(0),
});
export type SwmProvenance = z.infer<typeof SwmProvenance>;

/**
 * The integrity-verifiable record of one produced reality output
 * (acceptance contract §D: "content-addressed or otherwise
 * integrity-verifiable artifact manifest, playable in a normal HTML5 video
 * element").
 */
export const RenderArtifactManifest = z.object({
  schemaVersion: schemaVersionField,
  artifactId: z.string().min(1),
  /** The canonical session all realities of this event share (R605). */
  sessionId: z.string().min(1),
  reality: RealityKind,
  /** sha-256 of the artifact bytes. */
  contentHash: ContentAddress,
  byteSize: z.number().int().positive(),
  /** Container + codecs as produced (e.g. "mp4" + "avc1.42E01E"/"mp4a.40.2"). */
  container: z.string().min(1),
  videoCodec: z.string().min(1),
  audioCodec: z.string().min(1).nullable(),
  durationMs: z.number().int().positive(),
  /** Producing renderer identity (for `original`: the normalization pipeline). */
  rendererId: z.string().min(1),
  rendererVersion: z.string().min(1),
  generatedAtMs: z.number().int().min(0),
  /** REQUIRED for derived realities; forbidden to fabricate (R605). */
  swm: SwmProvenance.nullable(),
  /** For `original`: the source asset/manifest it derives from. */
  sourceAssetId: z.string().min(1).optional(),
  integrity: z.object({
    algorithm: z.literal("sha256"),
    /** True only after the stored bytes were re-read and hash-verified. */
    verified: z.boolean(),
  }),
});
export type RenderArtifactManifest = z.infer<typeof RenderArtifactManifest>;

/**
 * Structural rule: derived realities (tactical/3d/anime) MUST carry SWM
 * provenance; the original reality must reference its source asset instead.
 */
export function manifestProvenanceIssues(manifest: RenderArtifactManifest): string[] {
  const issues: string[] = [];
  if (manifest.reality === "original") {
    if (!manifest.sourceAssetId) {
      issues.push("original reality must reference its sourceAssetId");
    }
    if (manifest.swm) {
      issues.push("original reality carries SWM provenance it cannot have");
    }
  } else if (!manifest.swm) {
    issues.push(`${manifest.reality} reality must carry SWM provenance`);
  }
  return issues;
}
