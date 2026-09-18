/**
 * Durable media-platform repositories (R101-R104) — the persistence layer
 * for the real-media loop's frozen records: uploaded `SourceAsset`, the
 * normalized `MediaManifest`, every `RenderArtifactManifest`, and the
 * media-job ledger.
 *
 * The pattern is VERBATIM `@sporta/session`'s repository precedent:
 *
 * - two implementations per port — an in-memory store for hermetic tests /
 *   ephemeral runs, and a durable `bun:sqlite` store (the built-in SQLite;
 *   no new dependency);
 * - the FULL validated contract document is stored as JSON
 *   (`document_json`) — schema-versioned, vendor-neutral; a denormalized
 *   index column (state / id) maintained by the repository; the JSON
 *   document is the source of truth;
 * - every write AND read validates against the contract's zod schema and
 *   fails loudly on drift (a corrupted row is a typed validation error,
 *   never partial data);
 * - deep-clone-on-read so callers can never mutate stored state through
 *   handed-out references.
 */
import type { MediaManifest, RenderArtifactManifest, SourceAsset } from "@sporta/contracts";
import { MediaManifest as MediaManifestSchema } from "@sporta/contracts";
import { RenderArtifactManifest as RenderArtifactManifestSchema } from "@sporta/contracts";
import { SourceAsset as SourceAssetSchema } from "@sporta/contracts";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { MediaJobRecord, MediaJobState } from "./jobs";
import { MediaJobRecordSchema } from "./jobs";

// ---------------------------------------------------------------------------
// Validation helpers (parse-or-throw, the session-repository precedent)
// ---------------------------------------------------------------------------

/** A stored document failed contract validation (corruption or drift). */
export class MediaDocumentValidationError extends Error {
  constructor(kind: string, id: string, issues: string) {
    super(`stored ${kind} '${id}' failed contract validation: ${issues}`);
    this.name = "MediaDocumentValidationError";
  }
}

function parseOrThrow<T>(
  schema: {
    safeParse: (input: unknown) => {
      success: boolean;
      data?: T;
      error?: { issues: Array<{ message: string }> };
    };
  },
  kind: string,
  id: string,
  document: unknown,
): T {
  const parsed = schema.safeParse(document);
  if (!parsed.success || parsed.data === undefined) {
    throw new MediaDocumentValidationError(
      kind,
      id,
      parsed.error?.issues.map((issue) => issue.message).join("; ") ?? "unknown",
    );
  }
  return parsed.data;
}

function clone<T>(document: T): T {
  return structuredClone(document);
}

// ---------------------------------------------------------------------------
// SourceAsset repository
// ---------------------------------------------------------------------------

/** Persistence port for uploaded {@link SourceAsset} records. */
export interface SourceAssetRepository {
  /** Persists a new asset (typed conflict when the id exists). */
  create(asset: SourceAsset): SourceAsset;
  /** The stored asset, or `null` when absent. */
  get(assetId: string): SourceAsset | null;
  /** The asset whose uploaded content hash matches, or `null`. */
  getByContentHash(contentHash: string): SourceAsset | null;
  /** Replaces a stored asset (typed not-found when absent). */
  update(asset: SourceAsset): void;
}

/** Thrown when creating an asset whose id already exists. */
export class SourceAssetConflictError extends Error {
  constructor(assetId: string) {
    super(`source asset '${assetId}' already exists`);
    this.name = "SourceAssetConflictError";
  }
}

/** Thrown when updating an asset that does not exist. */
export class SourceAssetNotFoundError extends Error {
  constructor(assetId: string) {
    super(`source asset '${assetId}' was not found`);
    this.name = "SourceAssetNotFoundError";
  }
}

/** In-memory {@link SourceAssetRepository} (hermetic tests / ephemeral runs). */
export class InMemorySourceAssetRepository implements SourceAssetRepository {
  private readonly assets = new Map<string, SourceAsset>();

  create(asset: SourceAsset): SourceAsset {
    const doc = parseOrThrow(SourceAssetSchema, "source asset", asset.assetId, asset);
    if (this.assets.has(doc.assetId)) throw new SourceAssetConflictError(doc.assetId);
    this.assets.set(doc.assetId, clone(doc));
    return clone(doc);
  }

  get(assetId: string): SourceAsset | null {
    const stored = this.assets.get(assetId);
    return stored === undefined ? null : clone(stored);
  }

  getByContentHash(contentHash: string): SourceAsset | null {
    for (const asset of this.assets.values()) {
      if (asset.contentHash === contentHash) return clone(asset);
    }
    return null;
  }

  update(asset: SourceAsset): void {
    const doc = parseOrThrow(SourceAssetSchema, "source asset", asset.assetId, asset);
    if (!this.assets.has(doc.assetId)) throw new SourceAssetNotFoundError(doc.assetId);
    this.assets.set(doc.assetId, clone(doc));
  }
}

// ---------------------------------------------------------------------------
// MediaManifest repository
// ---------------------------------------------------------------------------

/** Persistence port for normalized {@link MediaManifest} records. */
export interface MediaManifestRepository {
  /** Persists a new manifest (typed conflict when the id exists). */
  create(manifest: MediaManifest): MediaManifest;
  /** The stored manifest, or `null` when absent. */
  get(manifestId: string): MediaManifest | null;
  /** The manifest derived from one source asset, or `null` when none. */
  getBySourceAssetId(sourceAssetId: string): MediaManifest | null;
}

/** Thrown when creating a manifest whose id already exists. */
export class MediaManifestConflictError extends Error {
  constructor(manifestId: string) {
    super(`media manifest '${manifestId}' already exists`);
    this.name = "MediaManifestConflictError";
  }
}

/** In-memory {@link MediaManifestRepository}. */
export class InMemoryMediaManifestRepository implements MediaManifestRepository {
  private readonly manifests = new Map<string, MediaManifest>();

  create(manifest: MediaManifest): MediaManifest {
    const doc = parseOrThrow(MediaManifestSchema, "media manifest", manifest.manifestId, manifest);
    if (this.manifests.has(doc.manifestId)) throw new MediaManifestConflictError(doc.manifestId);
    this.manifests.set(doc.manifestId, clone(doc));
    return clone(doc);
  }

  get(manifestId: string): MediaManifest | null {
    const stored = this.manifests.get(manifestId);
    return stored === undefined ? null : clone(stored);
  }

  getBySourceAssetId(sourceAssetId: string): MediaManifest | null {
    for (const manifest of this.manifests.values()) {
      if (manifest.sourceAssetId === sourceAssetId) return clone(manifest);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// RenderArtifactManifest repository
// ---------------------------------------------------------------------------

/** Persistence port for produced {@link RenderArtifactManifest} records. */
export interface RenderArtifactRepository {
  /** Persists a new artifact manifest (typed conflict when the id exists). */
  create(artifact: RenderArtifactManifest): RenderArtifactManifest;
  /** The stored artifact manifest, or `null` when absent. */
  get(artifactId: string): RenderArtifactManifest | null;
  /** Every artifact produced for one session (reality order stable). */
  listBySession(sessionId: string): RenderArtifactManifest[];
}

/** Thrown when creating an artifact whose id already exists. */
export class RenderArtifactConflictError extends Error {
  constructor(artifactId: string) {
    super(`render artifact '${artifactId}' already exists`);
    this.name = "RenderArtifactConflictError";
  }
}

/** In-memory {@link RenderArtifactRepository}. */
export class InMemoryRenderArtifactRepository implements RenderArtifactRepository {
  private readonly artifacts = new Map<string, RenderArtifactManifest>();

  create(artifact: RenderArtifactManifest): RenderArtifactManifest {
    const doc = parseOrThrow(
      RenderArtifactManifestSchema,
      "render artifact",
      artifact.artifactId,
      artifact,
    );
    if (this.artifacts.has(doc.artifactId)) throw new RenderArtifactConflictError(doc.artifactId);
    this.artifacts.set(doc.artifactId, clone(doc));
    return clone(doc);
  }

  get(artifactId: string): RenderArtifactManifest | null {
    const stored = this.artifacts.get(artifactId);
    return stored === undefined ? null : clone(stored);
  }

  listBySession(sessionId: string): RenderArtifactManifest[] {
    const out: RenderArtifactManifest[] = [];
    for (const artifact of this.artifacts.values()) {
      if (artifact.sessionId === sessionId) out.push(clone(artifact));
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Media job ledger
// ---------------------------------------------------------------------------

/** Persistence port for {@link MediaJobRecord}s (the R103 ledger). */
export interface MediaJobRepository {
  /** Persists a new job (typed conflict when the id exists). */
  create(job: MediaJobRecord): MediaJobRecord;
  /** The stored job, or `null` when absent. */
  get(jobId: string): MediaJobRecord | null;
  /** Replaces a stored job — the ONLY mutation path (typed not-found). */
  update(job: MediaJobRecord): MediaJobRecord;
  /** Every job for one source asset, oldest first. */
  listBySourceAsset(sourceAssetId: string): MediaJobRecord[];
  /** Every live (non-terminal) job — the restart-reconciliation query. */
  listLive(): MediaJobRecord[];
}

/** Thrown when creating a job whose id already exists. */
export class MediaJobConflictError extends Error {
  constructor(jobId: string) {
    super(`media job '${jobId}' already exists`);
    this.name = "MediaJobConflictError";
  }
}

/** Thrown when updating a job that does not exist. */
export class MediaJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`media job '${jobId}' was not found`);
    this.name = "MediaJobNotFoundError";
  }
}

/** In-memory {@link MediaJobRepository}. */
export class InMemoryMediaJobRepository implements MediaJobRepository {
  private readonly jobs = new Map<string, MediaJobRecord>();

  create(job: MediaJobRecord): MediaJobRecord {
    const doc = parseOrThrow(MediaJobRecordSchema, "media job", job.jobId, job);
    if (this.jobs.has(doc.jobId)) throw new MediaJobConflictError(doc.jobId);
    this.jobs.set(doc.jobId, clone(doc));
    return clone(doc);
  }

  get(jobId: string): MediaJobRecord | null {
    const stored = this.jobs.get(jobId);
    return stored === undefined ? null : clone(stored);
  }

  update(job: MediaJobRecord): MediaJobRecord {
    const doc = parseOrThrow(MediaJobRecordSchema, "media job", job.jobId, job);
    if (!this.jobs.has(doc.jobId)) throw new MediaJobNotFoundError(doc.jobId);
    this.jobs.set(doc.jobId, clone(doc));
    return clone(doc);
  }

  listBySourceAsset(sourceAssetId: string): MediaJobRecord[] {
    const out: MediaJobRecord[] = [];
    for (const job of this.jobs.values()) {
      if (job.sourceAssetId === sourceAssetId) out.push(clone(job));
    }
    return out.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  listLive(): MediaJobRecord[] {
    const terminal = new Set<MediaJobState>(["succeeded", "failed", "cancelled", "dead-lettered"]);
    const out: MediaJobRecord[] = [];
    for (const job of this.jobs.values()) {
      if (!terminal.has(job.state)) out.push(clone(job));
    }
    return out.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }
}

// ---------------------------------------------------------------------------
// The durable SQLite store (one database, four tables)
// ---------------------------------------------------------------------------

const CREATE_MEDIA_PLATFORM_SQL = `
  CREATE TABLE IF NOT EXISTS media_source_assets (
    asset_id TEXT PRIMARY KEY,
    upload_state TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    document_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS media_source_assets_hash_idx ON media_source_assets (content_hash);
  CREATE TABLE IF NOT EXISTS media_manifests (
    manifest_id TEXT PRIMARY KEY,
    source_asset_id TEXT NOT NULL,
    document_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS media_manifests_source_idx ON media_manifests (source_asset_id);
  CREATE TABLE IF NOT EXISTS media_render_artifacts (
    artifact_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    reality TEXT NOT NULL,
    document_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS media_render_artifacts_session_idx ON media_render_artifacts (session_id);
  CREATE TABLE IF NOT EXISTS media_jobs (
    job_id TEXT PRIMARY KEY,
    source_asset_id TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    document_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS media_jobs_source_idx ON media_jobs (source_asset_id);
`;

interface DocumentRow {
  document_json: string;
}

/**
 * The durable SQLite-backed store for every media-platform record — one
 * database, four tables, the session-repository schema convention
 * (`<id> TEXT PRIMARY KEY, <index columns>, document_json TEXT, updated_at
 * INTEGER`). Construct with a file path (created if absent) or an open
 * `bun:sqlite` `Database` (tests pass `":memory:"`). DDL is idempotent;
 * reads validate every row against the frozen contracts (corruption fails
 * loudly, never partial data).
 */
export class SqliteMediaPlatformStore {
  private readonly db: Database;
  private closed = false;

  readonly sourceAssets: SourceAssetRepository & { close(): void };
  readonly manifests: MediaManifestRepository & { close(): void };
  readonly artifacts: RenderArtifactRepository & { close(): void };
  readonly jobs: MediaJobRepository & { close(): void };

  constructor(dbOrPath: string | Database) {
    if (typeof dbOrPath === "string" && dbOrPath !== ":memory:") {
      // A file-backed store creates its parent directory on demand (the
      // composition's default `db/` path must not pre-exist).
      mkdirSync(dirname(dbOrPath), { recursive: true });
    }
    this.db = typeof dbOrPath === "string" ? new Database(dbOrPath) : dbOrPath;
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.exec(CREATE_MEDIA_PLATFORM_SQL);
    const db = this.db;
    const assertOpen = (): void => {
      if (this.closed) throw new Error("the sqlite media-platform store is closed");
    };

    // -- source assets ------------------------------------------------------
    const assetInsert = db.query(
      "INSERT INTO media_source_assets (asset_id, upload_state, content_hash, document_json, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    const assetGet = db.query("SELECT document_json FROM media_source_assets WHERE asset_id = ?");
    const assetByHash = db.query(
      "SELECT document_json FROM media_source_assets WHERE content_hash = ? LIMIT 1",
    );
    const assetExists = db.query("SELECT 1 FROM media_source_assets WHERE asset_id = ?");
    const assetUpdate = db.query(
      "UPDATE media_source_assets SET upload_state = ?, content_hash = ?, document_json = ?, updated_at = ? WHERE asset_id = ?",
    );
    this.sourceAssets = {
      create(asset: SourceAsset): SourceAsset {
        assertOpen();
        const doc = parseOrThrow(SourceAssetSchema, "source asset", asset.assetId, asset);
        if (assetExists.get(doc.assetId) !== null) throw new SourceAssetConflictError(doc.assetId);
        assetInsert.run(
          doc.assetId,
          doc.uploadState,
          doc.contentHash,
          JSON.stringify(doc),
          Date.now(),
        );
        return clone(doc);
      },
      get(assetId: string): SourceAsset | null {
        assertOpen();
        const row = assetGet.get(assetId) as DocumentRow | null;
        return row === null
          ? null
          : parseOrThrow(SourceAssetSchema, "source asset", assetId, JSON.parse(row.document_json));
      },
      getByContentHash(contentHash: string): SourceAsset | null {
        assertOpen();
        const row = assetByHash.get(contentHash) as DocumentRow | null;
        return row === null
          ? null
          : parseOrThrow(
              SourceAssetSchema,
              "source asset",
              "by-hash",
              JSON.parse(row.document_json),
            );
      },
      update(asset: SourceAsset): void {
        assertOpen();
        const doc = parseOrThrow(SourceAssetSchema, "source asset", asset.assetId, asset);
        if (assetExists.get(doc.assetId) === null) throw new SourceAssetNotFoundError(doc.assetId);
        assetUpdate.run(
          doc.uploadState,
          doc.contentHash,
          JSON.stringify(doc),
          Date.now(),
          doc.assetId,
        );
      },
      close(): void {
        /* closed by the owning store */
      },
    };

    // -- manifests ----------------------------------------------------------
    const manifestInsert = db.query(
      "INSERT INTO media_manifests (manifest_id, source_asset_id, document_json, updated_at) VALUES (?, ?, ?, ?)",
    );
    const manifestGet = db.query("SELECT document_json FROM media_manifests WHERE manifest_id = ?");
    const manifestBySource = db.query(
      "SELECT document_json FROM media_manifests WHERE source_asset_id = ? LIMIT 1",
    );
    const manifestExists = db.query("SELECT 1 FROM media_manifests WHERE manifest_id = ?");
    this.manifests = {
      create(manifest: MediaManifest): MediaManifest {
        assertOpen();
        const doc = parseOrThrow(
          MediaManifestSchema,
          "media manifest",
          manifest.manifestId,
          manifest,
        );
        if (manifestExists.get(doc.manifestId) !== null) {
          throw new MediaManifestConflictError(doc.manifestId);
        }
        manifestInsert.run(doc.manifestId, doc.sourceAssetId, JSON.stringify(doc), Date.now());
        return clone(doc);
      },
      get(manifestId: string): MediaManifest | null {
        assertOpen();
        const row = manifestGet.get(manifestId) as DocumentRow | null;
        return row === null
          ? null
          : parseOrThrow(
              MediaManifestSchema,
              "media manifest",
              manifestId,
              JSON.parse(row.document_json),
            );
      },
      getBySourceAssetId(sourceAssetId: string): MediaManifest | null {
        assertOpen();
        const row = manifestBySource.get(sourceAssetId) as DocumentRow | null;
        return row === null
          ? null
          : parseOrThrow(
              MediaManifestSchema,
              "media manifest",
              "by-source",
              JSON.parse(row.document_json),
            );
      },
      close(): void {
        /* closed by the owning store */
      },
    };

    // -- artifacts ----------------------------------------------------------
    const artifactInsert = db.query(
      "INSERT INTO media_render_artifacts (artifact_id, session_id, reality, document_json, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    const artifactGet = db.query(
      "SELECT document_json FROM media_render_artifacts WHERE artifact_id = ?",
    );
    const artifactBySession = db.query(
      "SELECT document_json FROM media_render_artifacts WHERE session_id = ? ORDER BY artifact_id ASC",
    );
    const artifactExists = db.query("SELECT 1 FROM media_render_artifacts WHERE artifact_id = ?");
    this.artifacts = {
      create(artifact: RenderArtifactManifest): RenderArtifactManifest {
        assertOpen();
        const doc = parseOrThrow(
          RenderArtifactManifestSchema,
          "render artifact",
          artifact.artifactId,
          artifact,
        );
        if (artifactExists.get(doc.artifactId) !== null) {
          throw new RenderArtifactConflictError(doc.artifactId);
        }
        artifactInsert.run(
          doc.artifactId,
          doc.sessionId,
          doc.reality,
          JSON.stringify(doc),
          Date.now(),
        );
        return clone(doc);
      },
      get(artifactId: string): RenderArtifactManifest | null {
        assertOpen();
        const row = artifactGet.get(artifactId) as DocumentRow | null;
        return row === null
          ? null
          : parseOrThrow(
              RenderArtifactManifestSchema,
              "render artifact",
              artifactId,
              JSON.parse(row.document_json),
            );
      },
      listBySession(sessionId: string): RenderArtifactManifest[] {
        assertOpen();
        const rows = artifactBySession.all(sessionId) as DocumentRow[];
        return rows.map((row) =>
          parseOrThrow(
            RenderArtifactManifestSchema,
            "render artifact",
            "by-session",
            JSON.parse(row.document_json),
          ),
        );
      },
      close(): void {
        /* closed by the owning store */
      },
    };

    // -- jobs ---------------------------------------------------------------
    const jobInsert = db.query(
      "INSERT INTO media_jobs (job_id, source_asset_id, state, created_at, document_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const jobGet = db.query("SELECT document_json FROM media_jobs WHERE job_id = ?");
    const jobExists = db.query("SELECT 1 FROM media_jobs WHERE job_id = ?");
    const jobUpdate = db.query(
      "UPDATE media_jobs SET source_asset_id = ?, state = ?, document_json = ?, updated_at = ? WHERE job_id = ?",
    );
    const jobBySource = db.query(
      "SELECT document_json FROM media_jobs WHERE source_asset_id = ? ORDER BY created_at ASC",
    );
    const jobLive = db.query(
      "SELECT document_json FROM media_jobs WHERE state IN ('admitted', 'dispatched', 'queued', 'in-flight') ORDER BY created_at ASC",
    );
    this.jobs = {
      create(job: MediaJobRecord): MediaJobRecord {
        assertOpen();
        const doc = parseOrThrow(MediaJobRecordSchema, "media job", job.jobId, job);
        if (jobExists.get(doc.jobId) !== null) throw new MediaJobConflictError(doc.jobId);
        jobInsert.run(
          doc.jobId,
          doc.sourceAssetId,
          doc.state,
          doc.createdAtMs,
          JSON.stringify(doc),
          Date.now(),
        );
        return clone(doc);
      },
      get(jobId: string): MediaJobRecord | null {
        assertOpen();
        const row = jobGet.get(jobId) as DocumentRow | null;
        return row === null
          ? null
          : parseOrThrow(MediaJobRecordSchema, "media job", jobId, JSON.parse(row.document_json));
      },
      update(job: MediaJobRecord): MediaJobRecord {
        assertOpen();
        const doc = parseOrThrow(MediaJobRecordSchema, "media job", job.jobId, job);
        if (jobExists.get(doc.jobId) === null) throw new MediaJobNotFoundError(doc.jobId);
        jobUpdate.run(doc.sourceAssetId, doc.state, JSON.stringify(doc), Date.now(), doc.jobId);
        return clone(doc);
      },
      listBySourceAsset(sourceAssetId: string): MediaJobRecord[] {
        assertOpen();
        const rows = jobBySource.all(sourceAssetId) as DocumentRow[];
        return rows.map((row) =>
          parseOrThrow(
            MediaJobRecordSchema,
            "media job",
            "by-source",
            JSON.parse(row.document_json),
          ),
        );
      },
      listLive(): MediaJobRecord[] {
        assertOpen();
        const rows = jobLive.all() as DocumentRow[];
        return rows.map((row) =>
          parseOrThrow(MediaJobRecordSchema, "media job", "live", JSON.parse(row.document_json)),
        );
      },
      close(): void {
        /* closed by the owning store */
      },
    };
  }

  /** Closes the underlying connection (idempotent). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
