/**
 * The artifact-registration layer (R306): every encoded artifact is
 * registered in the `@sporta/output-pipeline` CONTENT-ADDRESSED artifact
 * store — REUSED, never forked (`InMemoryArtifactStore` /
 * `OnDiskArtifactStore` behind the `ArtifactStore` port).
 *
 * ## The honest representation (documented, never silently transcoded)
 *
 * The W504 store's seam is STRING content (the store hashes the UTF-8
 * bytes of the document and writes it as text). A raw MP4 is binary — it
 * cannot ride that seam undistorted — so an encoded artifact registers as
 * its **base64 representation**: the stored document is the base64 text
 * of the MP4 bytes (`contentType: "video/mp4+base64"`, a self-describing
 * label). Two hashes are therefore recorded, both honestly:
 *
 * - `manifest.contentHash` — sha-256 of the RAW MP4 bytes (the frozen
 *   `RenderArtifactManifest` convention — the artifact's own content
 *   address);
 * - the store's `artifactId` — sha-256 of the STORED base64 document
 *   (the store's own content address, returned by the put).
 *
 * Reads are integrity-verified TWICE: the store re-hashes the stored
 * document on every read (its own contract), and `loadEncodedArtifact`
 * re-decodes the base64 and re-hashes the RAW bytes against the expected
 * MP4 content hash. Puts are idempotent with counted duplicates (the
 * store's own semantics — identical bytes never re-written).
 */
import type {
  AnimeArtifactMetadata,
  ArtifactStore,
  PutArtifactOutcome,
  StoredArtifact,
} from "@sporta/output-pipeline";
import { EncodingError } from "./errors";
import { sha256Of } from "./internal";
import type { EncodedArtifact } from "./types";

/** The media type of a stored encoded-artifact document (a base64 MP4 representation). */
export const ENCODED_ARTIFACT_CONTENT_TYPE = "video/mp4+base64";

/** The result of one registration. */
export interface RegisteredEncodedArtifact {
  /** The store's content address of the stored base64 document (64 hex). */
  artifactId: string;
  /** "stored" (first put) or "duplicate" (identical content already present). */
  outcome: "stored" | "duplicate";
  /** The duplicate count when "duplicate" (the store's own count). */
  duplicateCount: number;
  /** The metadata the artifact registered under (the W504 six-field shape). */
  metadata: AnimeArtifactMetadata;
}

/** The result of one load. */
export interface LoadedEncodedArtifact {
  /** The store's record (integrity-verified by the store's own read). */
  record: StoredArtifact;
  /** The decoded RAW MP4 bytes. */
  bytes: Uint8Array;
  /** sha-256 of the decoded bytes (verified against `expectedContentHash` when supplied). */
  contentHash: string;
}

/** base64 of bytes (the stored-document representation). */
export function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** The W504 store metadata of one encoded artifact (the six-field shape). */
export function encodedArtifactMetadataOf(artifact: EncodedArtifact): AnimeArtifactMetadata {
  return {
    sessionId: artifact.sessionId,
    renderId: artifact.manifest.source.rendererId,
    segmentId: artifact.manifest.manifestId,
    snapshotVersion: artifact.manifest.swm?.snapshotVersion ?? 0,
    frameCount: artifact.manifest.geometry.frameCount,
    totalDurationMs: artifact.manifest.geometry.durationMs,
  };
}

/**
 * Registers one encoded artifact in the W504 content-addressed store
 * (idempotent puts, counted duplicates, explicit limits). The raw-bytes
 * hash is cross-verified at registration time (decode-back + re-hash).
 */
export function registerEncodedArtifact(
  store: ArtifactStore,
  artifact: EncodedArtifact,
): RegisteredEncodedArtifact {
  const content = base64Of(artifact.bytes);
  const metadata = encodedArtifactMetadataOf(artifact);
  let outcome: PutArtifactOutcome;
  try {
    outcome = store.putArtifact({ content, contentType: ENCODED_ARTIFACT_CONTENT_TYPE, metadata });
  } catch (cause) {
    throw new EncodingError(
      "resource-limit",
      "store-rejected",
      "the artifact store rejected the put",
      {
        cause: String(cause),
        manifestId: artifact.manifest.manifestId,
      },
    );
  }
  // Cross-verify: the stored document decodes back to the exact bytes.
  const decoded = Buffer.from(outcome.record.content, "base64");
  const decodedHash = sha256Of(decoded);
  if (decodedHash !== artifact.contentHash || decoded.length !== artifact.byteSize) {
    throw new EncodingError(
      "internal",
      "store-rejected",
      "the stored base64 document does not decode back to the artifact's own bytes",
      {
        manifestId: artifact.manifest.manifestId,
        expected: artifact.contentHash,
        measured: decodedHash,
      },
    );
  }
  return {
    artifactId: outcome.record.artifactId,
    outcome: outcome.outcome,
    duplicateCount: outcome.outcome === "duplicate" ? outcome.duplicateCount : 0,
    metadata,
  };
}

/**
 * Loads one encoded artifact's document from the store (the store's own
 * integrity-verified read) and re-verifies the RAW bytes against the
 * expected MP4 content hash. A mismatch is a typed integrity failure —
 * never silently served.
 */
export function loadEncodedArtifact(
  store: ArtifactStore,
  artifactId: string,
  expectedContentHash?: string,
): LoadedEncodedArtifact {
  let record: StoredArtifact | null;
  try {
    record = store.getArtifact(artifactId);
  } catch (cause) {
    throw new EncodingError("internal", "store-rejected", "the artifact store threw on read", {
      cause: String(cause),
      artifactId,
    });
  }
  if (record === null) {
    throw new EncodingError(
      "media-invalid",
      "artifact-invalid",
      `no artifact "${artifactId}" is stored`,
      {
        artifactId,
      },
    );
  }
  if (record.contentType !== ENCODED_ARTIFACT_CONTENT_TYPE) {
    throw new EncodingError(
      "media-invalid",
      "artifact-invalid",
      `artifact "${artifactId}" is not an encoded artifact (contentType "${record.contentType}")`,
      { artifactId, contentType: record.contentType },
    );
  }
  const bytes = Buffer.from(record.content, "base64");
  const contentHash = sha256Of(bytes);
  if (expectedContentHash !== undefined && contentHash !== expectedContentHash) {
    throw new EncodingError(
      "internal",
      "verify-failed",
      `artifact "${artifactId}" decodes to bytes whose sha-256 ${contentHash} disagrees with the expected ${expectedContentHash}`,
      { artifactId, expected: expectedContentHash, measured: contentHash },
    );
  }
  return { record, bytes, contentHash };
}
