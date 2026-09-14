/**
 * The content-addressed artifact store (W504): sha-256 artifact id → artifact.
 *
 * This is the bytes layer of the output pipeline. An artifact is one
 * immutable encoded document (for the anime encoder: one animated SVG
 * segment) addressed by the sha-256 of its content — the same content is the
 * same id everywhere, so puts are IDEMPOTENT by construction: the same bytes
 * resolve to the same id, the duplicate is COUNTED, and the stored bytes are
 * NEVER re-written (content-addressing makes re-writing the same id a hash
 * collision, which fails loud instead of ever merging).
 *
 * Backends (injectable, no dependencies):
 *
 * - {@link InMemoryArtifactStore} — process-local (tests, ephemeral runs);
 * - {@link OnDiskArtifactStore} — durable under a DECLARED ROOT with
 *   DETERMINISTIC PATHS: the document lives at
 *   `<root>/objects/<artifactId>` and its JSON sidecar at
 *   `<root>/meta/<artifactId>.json`; reopen continues the insertion
 *   sequence, so ordering is stable across restarts.
 *
 * Every read is integrity-verified (the content is re-hashed and must equal
 * the artifact id; the byte length must match) — corrupted data fails loud
 * with {@link SegmentIntegrityError}, never partial data. Size bounds
 * (artifact count, per-artifact bytes, total bytes) REJECT with
 * {@link SegmentStoreLimitError} — never silent eviction.
 *
 * Rights are NOT derived here: this layer is the content-addressed bytes
 * seam (the W101 receipt posture — checksums are trust anchors, not
 * authorization). Playback rights are enforced one layer up (the
 * `RenderSegmentStore` retrieval gate and the W701 control plane), and the
 * pipeline's `locateAnimeRef` re-derives them fail-closed BEFORE any
 * artifact is revealed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { SegmentIntegrityError, SegmentStoreLimitError, SegmentValidationError } from "./errors";
import { byteLengthOf, contentHashOf } from "./encode";
import type {
  AnimeArtifactMetadata,
  ArtifactStore,
  ArtifactStoreLimits,
  ArtifactStoreStats,
  PutArtifactInput,
  PutArtifactOutcome,
  StoredArtifact,
  StoredArtifactSummary,
} from "./types";

// ---------------------------------------------------------------------------
// Options, limits, clock
// ---------------------------------------------------------------------------

/** Options for both artifact-store implementations. */
export interface ArtifactStoreOptions {
  /**
   * Size bounds. Exceeding any bound REJECTS the put with
   * `SegmentStoreLimitError` — never silent eviction. Defaults:
   * {@link DEFAULT_ARTIFACT_LIMITS}.
   */
  limits?: Partial<ArtifactStoreLimits>;
  /**
   * Clock in epoch milliseconds (default: deterministic per-store counter
   * `TEST_EPOCH_MS + ticks`). Production callers MUST inject a real wall
   * clock; the deterministic default keeps unseeded runs reproducible
   * (docs/testing/HARNESS.md).
   */
  nowMs?: () => number;
}

/**
 * The default artifact-store bounds: 1000 artifacts, 16 MiB per artifact,
 * 256 MiB total. Bounded by default — a store never grows unbounded
 * silently.
 */
export const DEFAULT_ARTIFACT_LIMITS: ArtifactStoreLimits = {
  maxArtifacts: 1_000,
  maxArtifactBytes: 16 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

/** Merges partial limits onto the defaults. */
export function resolveArtifactLimits(limits?: Partial<ArtifactStoreLimits>): ArtifactStoreLimits {
  return { ...DEFAULT_ARTIFACT_LIMITS, ...limits };
}

/** Deterministic per-store clock: `TEST_EPOCH_MS + ticks`. */
function createDeterministicArtifactClock(): () => number {
  let ticks = 0;
  return (): number => TEST_EPOCH_MS + (ticks += 1);
}

// ---------------------------------------------------------------------------
// Structural helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new SegmentValidationError(
      `${field} must be a non-empty string (got ${describeValue(value)})`,
      { field },
    );
  }
  return value;
}

/**
 * Structural validation of an artifact's scope metadata (JSON-space, the
 * same validation on the write path and on every on-disk sidecar read).
 */
export function parseArtifactMetadata(
  value: unknown,
): { ok: true; value: AnimeArtifactMetadata } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: "artifact metadata must be an object" };
  for (const field of ["sessionId", "renderId", "segmentId"] as const) {
    const entry = value[field];
    if (typeof entry !== "string" || entry.length < 1) {
      return { ok: false, reason: `artifact metadata ${field} must be a non-empty string` };
    }
  }
  const snapshotVersion = value.snapshotVersion;
  if (
    typeof snapshotVersion !== "number" ||
    !Number.isInteger(snapshotVersion) ||
    snapshotVersion < 0
  ) {
    return { ok: false, reason: "artifact metadata snapshotVersion must be an integer >= 0" };
  }
  const frameCount = value.frameCount;
  if (typeof frameCount !== "number" || !Number.isInteger(frameCount) || frameCount < 1) {
    return { ok: false, reason: "artifact metadata frameCount must be an integer >= 1" };
  }
  const totalDurationMs = value.totalDurationMs;
  if (
    typeof totalDurationMs !== "number" ||
    !Number.isFinite(totalDurationMs) ||
    totalDurationMs < 1
  ) {
    return { ok: false, reason: "artifact metadata totalDurationMs must be a finite number >= 1" };
  }
  return { ok: true, value: value as unknown as AnimeArtifactMetadata };
}

/**
 * Validates a `putArtifact` input fail-loud (never a partial put): non-empty
 * content and content type, structurally valid metadata. Returns the
 * measured byte length (never trusting a declared one — there is none).
 */
function validatePutInput(input: unknown): {
  content: string;
  contentType: string;
  metadata: AnimeArtifactMetadata;
} {
  if (!isRecord(input)) {
    throw new SegmentValidationError("putArtifact input must be an object", {});
  }
  const content = requireNonEmptyString(input.content, "input.content");
  const contentType = requireNonEmptyString(input.contentType, "input.contentType");
  const metadataCheck = parseArtifactMetadata(input.metadata);
  if (!metadataCheck.ok) {
    throw new SegmentValidationError(`input.metadata is invalid: ${metadataCheck.reason}`, {
      reason: metadataCheck.reason,
    });
  }
  return { content, contentType, metadata: metadataCheck.value };
}

/** Limit enforcement (explicit reject, never silent eviction). */
function enforceArtifactLimits(
  limits: ArtifactStoreLimits,
  usage: { artifactBytes: number; artifactsAfterPut: number; totalBytesAfterPut: number },
  scope: { artifactId: string },
): void {
  if (usage.artifactBytes > limits.maxArtifactBytes) {
    throw new SegmentStoreLimitError(
      `artifact '${scope.artifactId}' is ${usage.artifactBytes} bytes, above the per-artifact limit ${limits.maxArtifactBytes} (rejected; nothing was evicted)`,
      { ...scope, limit: "maxArtifactBytes", artifactBytes: usage.artifactBytes },
    );
  }
  if (usage.totalBytesAfterPut > limits.maxTotalBytes) {
    throw new SegmentStoreLimitError(
      `storing artifact '${scope.artifactId}' would raise the store to ${usage.totalBytesAfterPut} bytes, above the total limit ${limits.maxTotalBytes} (rejected; nothing was evicted)`,
      { ...scope, limit: "maxTotalBytes", totalBytesAfterPut: usage.totalBytesAfterPut },
    );
  }
  if (usage.artifactsAfterPut > limits.maxArtifacts) {
    throw new SegmentStoreLimitError(
      `storing artifact '${scope.artifactId}' would raise the store to ${usage.artifactsAfterPut} artifacts, above the count limit ${limits.maxArtifacts} (rejected; nothing was evicted)`,
      { ...scope, limit: "maxArtifacts", artifactsAfterPut: usage.artifactsAfterPut },
    );
  }
}

/**
 * Read-side integrity verification: the content re-hashes to exactly the
 * artifact id and the byte length is the measured one. Corruption fails
 * loud — never partial data.
 */
function verifyArtifactIntegrity(record: {
  artifactId: string;
  content: string;
  byteLength: number;
  contentType: string;
}): void {
  const recomputedHash = contentHashOf(record.content);
  if (record.artifactId !== recomputedHash) {
    throw new SegmentIntegrityError(
      `artifact '${record.artifactId}' failed integrity verification: the stored content hashes to '${recomputedHash}'`,
      { artifactId: record.artifactId, recomputedContentHash: recomputedHash },
    );
  }
  const recomputedBytes = byteLengthOf(record.content);
  if (record.byteLength !== recomputedBytes) {
    throw new SegmentIntegrityError(
      `artifact '${record.artifactId}' failed integrity verification: byte length drift (${record.byteLength} declared, ${recomputedBytes} measured)`,
      {
        artifactId: record.artifactId,
        declaredByteLength: record.byteLength,
        measuredByteLength: recomputedBytes,
      },
    );
  }
  if (record.contentType.length < 1) {
    throw new SegmentIntegrityError(
      `artifact '${record.artifactId}' failed integrity verification: an empty content type`,
      { artifactId: record.artifactId },
    );
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

/**
 * Process-local `ArtifactStore`: a `Map` keyed by the sha-256 artifact id.
 * Stores deep clones and hands out deep clones, so neither the put input
 * nor a returned record can mutate store-internal state.
 */
export class InMemoryArtifactStore implements ArtifactStore {
  private readonly artifacts = new Map<string, StoredArtifact>();
  private readonly limits: ArtifactStoreLimits;
  private readonly nowMs: () => number;
  private nextSequence = 1;
  private totalBytes = 0;
  private duplicatePuts = 0;

  constructor(options: ArtifactStoreOptions = {}) {
    this.limits = resolveArtifactLimits(options.limits);
    this.nowMs = options.nowMs ?? createDeterministicArtifactClock();
  }

  putArtifact(input: PutArtifactInput): PutArtifactOutcome {
    const validated = validatePutInput(input);
    const { content, contentType, metadata } = validated;
    const artifactId = contentHashOf(content);
    const existing = this.artifacts.get(artifactId);
    if (existing !== undefined) {
      if (existing.content !== content) {
        // Same sha-256 id with different bytes: a hash collision. Never
        // merge, never re-write — fail loud.
        throw new SegmentIntegrityError(
          `artifact '${artifactId}' is already stored with different content (sha-256 collision)`,
          {
            artifactId,
            storedByteLength: existing.byteLength,
            receivedByteLength: byteLengthOf(content),
          },
        );
      }
      // Idempotent no-op duplicate — COUNTED, never re-written.
      const record: StoredArtifact = {
        ...existing,
        duplicateCount: existing.duplicateCount + 1,
      };
      this.artifacts.set(artifactId, record);
      this.duplicatePuts += 1;
      return {
        outcome: "duplicate",
        record: structuredClone(record),
        duplicateCount: record.duplicateCount,
      };
    }
    const byteLength = byteLengthOf(content);
    enforceArtifactLimits(
      this.limits,
      {
        artifactBytes: byteLength,
        artifactsAfterPut: this.artifacts.size + 1,
        totalBytesAfterPut: this.totalBytes + byteLength,
      },
      { artifactId },
    );
    const record: StoredArtifact = {
      artifactId,
      contentType,
      content,
      byteLength,
      metadata: structuredClone(metadata),
      storedAtMs: this.nowMs(),
      storeSequence: this.nextSequence,
      duplicateCount: 0,
    };
    this.nextSequence += 1;
    this.artifacts.set(artifactId, record);
    this.totalBytes += byteLength;
    return { outcome: "stored", record: structuredClone(record) };
  }

  getArtifact(artifactId: string): StoredArtifact | null {
    requireNonEmptyString(artifactId, "artifactId");
    const stored = this.artifacts.get(artifactId);
    if (stored === undefined) return null;
    const record = structuredClone(stored);
    verifyArtifactIntegrity(record);
    return record;
  }

  listArtifacts(): StoredArtifactSummary[] {
    const matches = [...this.artifacts.values()];
    // Insertion order (storeSequence), like the on-disk implementation.
    matches.sort((a, b) => a.storeSequence - b.storeSequence);
    return matches.map((record) => ({
      artifactId: record.artifactId,
      contentType: record.contentType,
      byteLength: record.byteLength,
      metadata: structuredClone(record.metadata),
    }));
  }

  deleteArtifact(artifactId: string): void {
    requireNonEmptyString(artifactId, "artifactId");
    const stored = this.artifacts.get(artifactId);
    if (stored !== undefined) {
      this.artifacts.delete(artifactId);
      this.totalBytes -= stored.byteLength;
    }
  }

  stats(): ArtifactStoreStats {
    return {
      artifacts: this.artifacts.size,
      totalBytes: this.totalBytes,
      duplicatePuts: this.duplicatePuts,
    };
  }
}

// ---------------------------------------------------------------------------
// On-disk implementation (declared root, deterministic paths)
// ---------------------------------------------------------------------------

/** The JSON sidecar of one on-disk artifact (fixed key order). */
interface ArtifactSidecar {
  artifactId: string;
  contentType: string;
  byteLength: number;
  metadata: AnimeArtifactMetadata;
  storedAtMs: number;
  storeSequence: number;
  duplicateCount: number;
}

/** The on-disk layout of the store under `root`. */
export const ON_DISK_LAYOUT = {
  objectsDir: "objects",
  metaDir: "meta",
  /** The deterministic document path: `<root>/objects/<artifactId>`. */
  objectPath(root: string, artifactId: string): string {
    return join(root, ON_DISK_LAYOUT.objectsDir, artifactId);
  },
  /** The deterministic sidecar path: `<root>/meta/<artifactId>.json`. */
  metaPath(root: string, artifactId: string): string {
    return join(root, ON_DISK_LAYOUT.metaDir, `${artifactId}.json`);
  },
} as const;

/**
 * Durable `ArtifactStore` under a DECLARED ROOT with deterministic paths:
 *
 * - the artifact document (verbatim content) at `<root>/objects/<artifactId>`;
 * - the JSON sidecar (content type, byte length, metadata, timestamps,
 *   counters) at `<root>/meta/<artifactId>.json`;
 *
 * both keyed by the sha-256 artifact id, so the path IS the content address.
 * The constructor creates the directory tree idempotently and continues the
 * insertion sequence from the persisted sidecars, so ordering is stable
 * across close/reopen. Puts are idempotent by content: a duplicate bumps the
 * persisted `duplicateCount` in the sidecar (the document itself is NEVER
 * re-written); a sha-256 collision fails loud. Reads re-hash the document
 * and fail loud on drift.
 */
export class OnDiskArtifactStore implements ArtifactStore {
  private readonly root: string;
  private readonly limits: ArtifactStoreLimits;
  private readonly nowMs: () => number;
  private nextSequence: number;

  constructor(root: string, options: ArtifactStoreOptions = {}) {
    requireNonEmptyString(root, "root");
    this.root = root;
    this.limits = resolveArtifactLimits(options.limits);
    this.nowMs = options.nowMs ?? createDeterministicArtifactClock();
    mkdirSync(join(root, ON_DISK_LAYOUT.objectsDir), { recursive: true });
    mkdirSync(join(root, ON_DISK_LAYOUT.metaDir), { recursive: true });
    // Continue the insertion sequence from the persisted sidecars, so
    // ordering is stable across close/reopen. Duplicate counters live in
    // the sidecars (every bump is persisted), so stats() reads them there.
    let maxSequence = 0;
    for (const entry of this.readSidecars()) {
      maxSequence = Math.max(maxSequence, entry.storeSequence);
    }
    this.nextSequence = maxSequence + 1;
  }

  putArtifact(input: PutArtifactInput): PutArtifactOutcome {
    const validated = validatePutInput(input);
    const { content, contentType, metadata } = validated;
    const artifactId = contentHashOf(content);
    const objectPath = ON_DISK_LAYOUT.objectPath(this.root, artifactId);
    const metaPath = ON_DISK_LAYOUT.metaPath(this.root, artifactId);
    const sidecarExists = existsSync(metaPath);
    if (sidecarExists) {
      const sidecar = this.readSidecar(artifactId, metaPath);
      const storedContent = this.readDocument(artifactId, objectPath);
      if (storedContent !== content) {
        // Same sha-256 id with different bytes: a hash collision. Never
        // merge, never re-write — fail loud.
        throw new SegmentIntegrityError(
          `artifact '${artifactId}' is already stored with different content (sha-256 collision)`,
          {
            artifactId,
            storedByteLength: sidecar.byteLength,
            receivedByteLength: byteLengthOf(content),
          },
        );
      }
      // Idempotent no-op duplicate — COUNTED (persisted), document never
      // re-written.
      const updated: ArtifactSidecar = {
        ...sidecar,
        duplicateCount: sidecar.duplicateCount + 1,
      };
      writeFileSync(metaPath, `${JSON.stringify(updated)}\n`);
      return {
        outcome: "duplicate",
        record: this.sidecarToRecord(updated, storedContent),
        duplicateCount: updated.duplicateCount,
      };
    }
    const byteLength = byteLengthOf(content);
    const stats = this.stats();
    enforceArtifactLimits(
      this.limits,
      {
        artifactBytes: byteLength,
        artifactsAfterPut: stats.artifacts + 1,
        totalBytesAfterPut: stats.totalBytes + byteLength,
      },
      { artifactId },
    );
    const sidecar: ArtifactSidecar = {
      artifactId,
      contentType,
      byteLength,
      metadata,
      storedAtMs: this.nowMs(),
      storeSequence: this.nextSequence,
      duplicateCount: 0,
    };
    this.nextSequence += 1;
    // Write the document, then the sidecar. A failed sidecar write leaves
    // an UNINDEXED document file (never listed, never served — only a
    // sidecar makes an artifact visible); honest and documented.
    writeFileSync(objectPath, content);
    writeFileSync(metaPath, `${JSON.stringify(sidecar)}\n`);
    return { outcome: "stored", record: this.sidecarToRecord(sidecar, content) };
  }

  getArtifact(artifactId: string): StoredArtifact | null {
    requireNonEmptyString(artifactId, "artifactId");
    const metaPath = ON_DISK_LAYOUT.metaPath(this.root, artifactId);
    if (!existsSync(metaPath)) return null;
    const sidecar = this.readSidecar(artifactId, metaPath);
    const content = this.readDocument(artifactId, ON_DISK_LAYOUT.objectPath(this.root, artifactId));
    const record = this.sidecarToRecord(sidecar, content);
    verifyArtifactIntegrity(record);
    return record;
  }

  listArtifacts(): StoredArtifactSummary[] {
    const sidecars = this.readSidecars();
    sidecars.sort((a, b) => a.storeSequence - b.storeSequence);
    return sidecars.map((sidecar) => ({
      artifactId: sidecar.artifactId,
      contentType: sidecar.contentType,
      byteLength: sidecar.byteLength,
      metadata: structuredClone(sidecar.metadata),
    }));
  }

  deleteArtifact(artifactId: string): void {
    requireNonEmptyString(artifactId, "artifactId");
    const objectPath = ON_DISK_LAYOUT.objectPath(this.root, artifactId);
    const metaPath = ON_DISK_LAYOUT.metaPath(this.root, artifactId);
    if (existsSync(objectPath)) rmSync(objectPath);
    if (existsSync(metaPath)) rmSync(metaPath);
  }

  stats(): ArtifactStoreStats {
    // Live scan of the sidecars (the sidecar is what makes an artifact
    // countable; an unindexed document file is not a stored artifact).
    // Duplicate counters are persisted per sidecar, so the sum is the
    // all-time count — stable across reopen.
    let artifacts = 0;
    let totalBytes = 0;
    let duplicatePuts = 0;
    for (const sidecar of this.readSidecars()) {
      artifacts += 1;
      totalBytes += sidecar.byteLength;
      duplicatePuts += sidecar.duplicateCount;
    }
    return { artifacts, totalBytes, duplicatePuts };
  }

  /** Reads one sidecar (a corrupted sidecar fails loud). */
  private readSidecar(artifactId: string, metaPath: string): ArtifactSidecar {
    const text = readFileSync(metaPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new SegmentIntegrityError(
        `artifact '${artifactId}' has an unparsable sidecar at ${metaPath}`,
        { artifactId, metaPath },
        { cause: err },
      );
    }
    if (!isRecord(parsed) || parsed.artifactId !== artifactId) {
      throw new SegmentIntegrityError(
        `artifact '${artifactId}' has an invalid sidecar (missing or mismatched artifactId)`,
        { artifactId, metaPath },
      );
    }
    const contentType = parsed.contentType;
    if (typeof contentType !== "string" || contentType.length < 1) {
      throw new SegmentIntegrityError(
        `artifact '${artifactId}' has an invalid sidecar content type`,
        { artifactId, metaPath },
      );
    }
    const byteLength = parsed.byteLength;
    if (typeof byteLength !== "number" || !Number.isInteger(byteLength) || byteLength < 1) {
      throw new SegmentIntegrityError(
        `artifact '${artifactId}' has an invalid sidecar byte length`,
        { artifactId, metaPath },
      );
    }
    const metadataCheck = parseArtifactMetadata(parsed.metadata);
    if (!metadataCheck.ok) {
      throw new SegmentIntegrityError(
        `artifact '${artifactId}' has an invalid sidecar metadata: ${metadataCheck.reason}`,
        { artifactId, metaPath, reason: metadataCheck.reason },
      );
    }
    for (const field of ["storedAtMs", "storeSequence", "duplicateCount"] as const) {
      const entry = parsed[field];
      if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) {
        throw new SegmentIntegrityError(
          `artifact '${artifactId}' has an invalid sidecar ${field}`,
          { artifactId, metaPath },
        );
      }
    }
    return {
      artifactId,
      contentType,
      byteLength,
      metadata: metadataCheck.value,
      storedAtMs: parsed.storedAtMs as number,
      storeSequence: parsed.storeSequence as number,
      duplicateCount: parsed.duplicateCount as number,
    };
  }

  /**
   * Reads one artifact document (a missing document with a present sidecar —
   * e.g. after an interrupted put or external tampering — fails LOUD with a
   * typed {@link SegmentIntegrityError}, never an untyped filesystem error;
   * indexed-but-absent bytes are corrupted store state, not a null miss).
   */
  private readDocument(artifactId: string, objectPath: string): string {
    try {
      return readFileSync(objectPath, "utf8");
    } catch (err) {
      throw new SegmentIntegrityError(
        `artifact '${artifactId}' is indexed by its sidecar but its document is missing at ${objectPath}`,
        { artifactId, objectPath },
        { cause: err },
      );
    }
  }

  /** Reads and parses every sidecar under `<root>/meta/`. */
  private readSidecars(): ArtifactSidecar[] {
    const metaDir = join(this.root, ON_DISK_LAYOUT.metaDir);
    const out: ArtifactSidecar[] = [];
    for (const name of readdirSync(metaDir)) {
      if (!name.endsWith(".json")) continue;
      const artifactId = name.slice(0, -".json".length);
      out.push(this.readSidecar(artifactId, join(metaDir, name)));
    }
    return out;
  }

  /** Sidecar + document → record (deep clone; integrity verified upstream). */
  private sidecarToRecord(sidecar: ArtifactSidecar, content: string): StoredArtifact {
    return structuredClone({
      artifactId: sidecar.artifactId,
      contentType: sidecar.contentType,
      content,
      byteLength: sidecar.byteLength,
      metadata: sidecar.metadata,
      storedAtMs: sidecar.storedAtMs,
      storeSequence: sidecar.storeSequence,
      duplicateCount: sidecar.duplicateCount,
    });
  }
}
