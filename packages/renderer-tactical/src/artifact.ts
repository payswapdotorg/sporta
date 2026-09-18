/**
 * The tactical artifact staging store (R301) — the W504 content-addressed
 * conventions applied to the tactical reality's MP4 output.
 *
 * Layout (mirrors `@sporta/output-pipeline`'s `OnDiskArtifactStore`):
 *
 * - the artifact bytes (the real MP4) at `<root>/objects/<contentHash>` —
 *   the sha-256 of the bytes IS the file name (content-addressed);
 * - the JSON sidecar — the frozen `RenderArtifactManifest` — at
 *   `<root>/meta/<artifactId>.json`, where `artifactId` is the
 *   identity-derived logical id (`tactical-<fnv1a32-hex8>`, deliberately NOT
 *   content-derived, the W504 segmentId precedent: a re-encode of the same
 *   render identity with different bytes fails loud as a conflict instead of
 *   silently storing a second copy under a new id).
 *
 * Honesty rules:
 * - `integrity.verified` is `true` ONLY after the written bytes were
 *   re-read from disk and re-hashed to the recorded content hash;
 * - a sha-256 collision or an identity conflict fails loud — never a merge,
 *   never a silent overwrite;
 * - the manifest is parsed through the frozen contract schema before it is
 *   written, and `manifestProvenanceIssues` must be empty (a tactical
 *   reality carries SWM provenance, never a source-asset reference).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  RenderArtifactManifest,
  type RenderArtifactManifest as ManifestDoc,
} from "@sporta/contracts";
import { manifestProvenanceIssues } from "@sporta/contracts";
import { TACTICAL_RENDERER_ID, TACTICAL_RENDERER_VERSION } from "./identity";
import { fnv1a32 } from "./palette";
import { TACTICAL_CONTAINER, TACTICAL_VIDEO_CODEC } from "./codec";

/** The artifact-store error (fail-loud, typed). */
export class TacticalArtifactError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "TacticalArtifactError";
  }
}

/** The on-disk layout of the tactical staging store. */
export const TACTICAL_STAGING_LAYOUT = {
  objectsDir: "objects",
  metaDir: "meta",
  /** The raw-frame scratch directory (cleaned per render). */
  tmpDir: "tmp",
  /** The content-addressed document path: `<root>/objects/<contentHash>`. */
  objectPath(root: string, contentHash: string): string {
    return join(root, TACTICAL_STAGING_LAYOUT.objectsDir, contentHash);
  },
  /** The manifest sidecar path: `<root>/meta/<artifactId>.json`. */
  metaPath(root: string, artifactId: string): string {
    return join(root, TACTICAL_STAGING_LAYOUT.metaDir, `${artifactId}.json`);
  },
} as const;

/** What one render produced, on disk. */
export interface StagedTacticalArtifact {
  /** The identity-derived logical artifact id. */
  artifactId: string;
  /** sha-256 of the artifact bytes (the content address). */
  contentHash: string;
  /** The measured byte size. */
  byteSize: number;
  /** Absolute path of the MP4 bytes. */
  artifactPath: string;
  /** Absolute path of the manifest sidecar. */
  manifestPath: string;
  /** The frozen manifest document (schema-parsed). */
  manifest: ManifestDoc;
  /** True when identical bytes were already staged (idempotent duplicate). */
  duplicate: boolean;
}

/** The input of one artifact put. */
export interface StageArtifactInput {
  /** The real MP4 bytes produced by the codec. */
  bytes: Buffer;
  /** The canonical session all realities of this event share (R605). */
  sessionId: string;
  /** The logical render identity string (drives `artifactId`). */
  identity: string;
  /** The SWM provenance of this derived reality (R605: never fabricated). */
  swm: { snapshotVersion: number; lastEventSequence: number };
  /** The true duration of the encoded clip, ms. */
  durationMs: number;
  /** The deterministic generation time (injected clock, never ambient). */
  generatedAtMs: number;
}

/** sha-256 of bytes, as 64 lowercase hex digits. */
export function sha256Of(bytes: Buffer): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

/** The identity-derived logical artifact id: `tactical-<fnv1a32-hex8>`. */
export function tacticalArtifactIdOf(identity: string): string {
  return `tactical-${fnv1a32(identity).toString(16).padStart(8, "0")}`;
}

/**
 * The content-addressed staging store for tactical render artifacts under a
 * DECLARED root. The constructor creates the directory tree idempotently.
 */
export class TacticalArtifactStore {
  private readonly root: string;

  constructor(root: string) {
    if (typeof root !== "string" || root.length < 1) {
      throw new TacticalArtifactError("the staging root must be a non-empty string");
    }
    this.root = root;
    mkdirSync(join(root, TACTICAL_STAGING_LAYOUT.objectsDir), { recursive: true });
    mkdirSync(join(root, TACTICAL_STAGING_LAYOUT.metaDir), { recursive: true });
    mkdirSync(join(root, TACTICAL_STAGING_LAYOUT.tmpDir), { recursive: true });
  }

  /**
   * Stages one real MP4 artifact + its frozen manifest. Idempotent by
   * content: identical bytes resolve to the same content address and the
   * duplicate is counted (the file is never re-written). Integrity is
   * verified by re-reading the bytes from disk before the manifest is
   * written with `verified: true`.
   */
  put(input: StageArtifactInput): StagedTacticalArtifact {
    if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
      throw new TacticalArtifactError("artifact bytes must be a non-empty Buffer");
    }
    const contentHash = sha256Of(input.bytes);
    const artifactId = tacticalArtifactIdOf(input.identity);
    const objectPath = TACTICAL_STAGING_LAYOUT.objectPath(this.root, contentHash);
    const manifestPath = TACTICAL_STAGING_LAYOUT.metaPath(this.root, artifactId);

    let duplicate = false;
    if (existsSync(objectPath)) {
      const existing = readFileSync(objectPath);
      if (sha256Of(existing) !== contentHash) {
        throw new TacticalArtifactError(
          `artifact '${contentHash}' is already staged with different bytes (sha-256 collision)`,
          { artifactId, contentHash },
        );
      }
      duplicate = true;
    } else {
      writeFileSync(objectPath, input.bytes);
    }

    // Integrity: re-read the bytes from disk and re-hash (never trust the
    // write path; `verified` is earned, not assumed).
    const reread = readFileSync(objectPath);
    if (sha256Of(reread) !== contentHash || reread.length !== input.bytes.length) {
      throw new TacticalArtifactError(
        `artifact '${contentHash}' failed integrity verification on re-read`,
        { artifactId, contentHash },
      );
    }

    const manifest: ManifestDoc = RenderArtifactManifest.parse({
      schemaVersion: "1.1",
      artifactId,
      sessionId: input.sessionId,
      reality: "tactical",
      contentHash,
      byteSize: reread.length,
      container: TACTICAL_CONTAINER,
      videoCodec: TACTICAL_VIDEO_CODEC,
      audioCodec: null,
      durationMs: input.durationMs,
      rendererId: TACTICAL_RENDERER_ID,
      rendererVersion: TACTICAL_RENDERER_VERSION,
      generatedAtMs: input.generatedAtMs,
      swm: {
        snapshotVersion: input.swm.snapshotVersion,
        lastEventSequence: input.swm.lastEventSequence,
      },
      integrity: { algorithm: "sha256", verified: true },
    });
    const issues = manifestProvenanceIssues(manifest);
    if (issues.length > 0) {
      throw new TacticalArtifactError(
        `the tactical manifest carries provenance issues: ${issues.join("; ")}`,
        { issues },
      );
    }

    if (existsSync(manifestPath)) {
      // An identity conflict is a loud failure, never a silent overwrite.
      const existing = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestDoc;
      if (existing.contentHash !== contentHash) {
        throw new TacticalArtifactError(
          `artifact id '${artifactId}' is already staged for a different content hash ` +
            `(identity conflict — the render identity changed meaning)`,
          { artifactId, existingContentHash: existing.contentHash, contentHash },
        );
      }
    } else {
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    }

    return {
      artifactId,
      contentHash,
      byteSize: reread.length,
      artifactPath: objectPath,
      manifestPath,
      manifest,
      duplicate,
    };
  }

  /** Reads one staged manifest sidecar (parsed through the frozen schema). */
  readManifest(artifactId: string): ManifestDoc {
    const manifestPath = TACTICAL_STAGING_LAYOUT.metaPath(this.root, artifactId);
    if (!existsSync(manifestPath)) {
      throw new TacticalArtifactError(`no staged manifest for artifact '${artifactId}'`, {
        artifactId,
        manifestPath,
      });
    }
    return RenderArtifactManifest.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  }

  /** Verifies a staged artifact's bytes against its recorded content hash. */
  verifyArtifact(contentHash: string): boolean {
    const objectPath = TACTICAL_STAGING_LAYOUT.objectPath(this.root, contentHash);
    if (!existsSync(objectPath)) return false;
    return sha256Of(readFileSync(objectPath)) === contentHash;
  }
}
