/**
 * THE MEDIA STORAGE SEAM (R101/R104) — the provider-neutral port behind
 * every stored byte of the real-media loop (uploaded sources, normalized
 * canonical MP4s, produced reality artifacts).
 *
 * The port is deliberately ASYNC and RANGE-AWARE:
 *
 * - ASYNC because the production backing is object storage (an R2/S3-class
 *   private bucket — the W912 posture); the local-filesystem adapter here
 *   is the drop-in dev/localhost implementation, and an R2 adapter
 *   satisfies the SAME port WITHOUT any route or service change (the
 *   composition root is the only wiring point — the repo's seam rule);
 * - RANGE-AWARE because the artifact playback route serves HTML5 video
 *   semantics: `open(key, { range })` answers a bounded byte view with the
 *   object's total size, so a 206 Partial Content response never has to
 *   materialize the whole object in memory;
 * - CONTENT-VERIFIED because the honesty rules of the media-artifact
 *   contracts require `checksumVerified`/`integrity.verified` to mean "the
 *   stored bytes were RE-READ and hash-verified" — `put` returns the
 *   measured sha-256 of the bytes it actually persisted, and `verify`
 *   re-reads and re-hashes on the caller's demand.
 */
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { MediaIntegrityError } from "./errors";

/** A stored object's content-addressed identity. */
export interface StoredObjectInfo {
  /** The storage key the object was written under. */
  key: string;
  /** sha-256 of the bytes ACTUALLY persisted (measured on write). */
  contentHash: string;
  /** Persisted byte length. */
  byteSize: number;
}

/** A byte-range view over one stored object. */
export interface StoredObjectView {
  /** The requested key (present on the stored object). */
  key: string;
  /** The bounded byte slice (a copy owned by the caller). */
  bytes: Uint8Array;
  /** The slice's offset within the object (0 for whole-object reads). */
  offset: number;
  /** The slice's length in bytes. */
  length: number;
  /** The WHOLE object's byte size (for Content-Range: bytes a-b/total). */
  totalSize: number;
  /** sha-256 of the WHOLE object, when the adapter knows it cheaply. */
  contentHash: string | null;
}

/** A put is idempotent per (key, content) and fail-loud per conflict. */
export type PutOutcome =
  { outcome: "stored"; info: StoredObjectInfo } | { outcome: "duplicate"; info: StoredObjectInfo };

/** Range constraint for {@link MediaStoragePort.open}. */
export interface ByteRange {
  /** Inclusive start offset (>= 0). */
  start: number;
  /** INCLUSIVE end offset (the HTTP Range convention), or the object's last byte. */
  end?: number;
}

/**
 * THE storage port. Implementations MUST:
 *
 * - reject keys that escape the store's namespace (path traversal is a
 *   `MediaIntegrityError`, never a filesystem write outside the root);
 * - measure the persisted bytes' sha-256 themselves (never trust the
 *   caller's claim);
 * - treat a same-key put with DIFFERENT content as a fail-loud conflict
 *   (stored media is never silently replaced).
 */
export interface MediaStoragePort {
  /** The store's identity (surfaces in health/operator views). */
  readonly storeId: string;

  /**
   * Persists bytes under a key. Idempotent per identical content; a
   * different-content collision is a typed integrity error.
   */
  put(key: string, bytes: Uint8Array): Promise<PutOutcome>;

  /** Reads the whole object (a caller-owned copy), or `null` when absent. */
  get(key: string): Promise<Uint8Array | null>;

  /**
   * Opens a bounded view over the object (the playback path's Range
   * primitive): `null` when absent; a clamped view when the range exceeds
   * the object; a typed integrity error when the range is malformed
   * (start > object size, negative).
   */
  open(key: string, range?: ByteRange): Promise<StoredObjectView | null>;

  /** The object's byte size, or `null` when absent. */
  size(key: string): Promise<number | null>;

  /**
   * Re-reads the object and verifies its CURRENT sha-256 equals
   * `expectedHash` — the "stored bytes were re-read and verified"
   * primitive the artifact contracts require. Returns the measured hash.
   */
  verify(key: string, expectedHash: string): Promise<string>;

  /** Removes an object (idempotent; used by tests and retention jobs). */
  remove(key: string): Promise<void>;
}

/** sha-256 of a byte view, as 64 lowercase hex digits. */
export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Validates a key against the store's namespace rules (no traversal). */
export function assertSafeKey(storeId: string, key: string): void {
  if (key.length === 0) {
    throw new MediaIntegrityError(`storage key must be non-empty`, { storeId, key });
  }
  const normalized = normalize(key);
  if (
    normalized.startsWith("..") ||
    normalized.startsWith("/") ||
    normalized.includes("../") ||
    normalized.includes("..\\")
  ) {
    throw new MediaIntegrityError(`storage key '${key}' escapes the store namespace`, {
      storeId,
      key,
    });
  }
}

/**
 * The LOCAL FILESYSTEM adapter (the dev/localhost backing; the R2 adapter
 * is a future drop-in behind the same port).
 *
 * Layout: `<rootDir>/<key>` with parent directories created on demand. The
 * measured sha-256 of the written bytes is returned by every put; `verify`
 * re-reads the file and re-hashes it. Same-key different-content puts are
 * fail-loud conflicts (stored media is never silently replaced).
 */
export class LocalFilesystemStorage implements MediaStoragePort {
  readonly storeId: string;
  private readonly rootDir: string;

  constructor(rootDir: string, storeId = "media-local-fs") {
    this.rootDir = resolve(rootDir);
    this.storeId = storeId;
  }

  /** The resolved root (tests and operators may inspect it). */
  get root(): string {
    return this.rootDir;
  }

  private pathOf(key: string): string {
    assertSafeKey(this.storeId, key);
    const path = resolve(join(this.rootDir, key));
    if (!path.startsWith(this.rootDir)) {
      // Defense in depth (resolve already clamps; this is the belt to the
      // suspenders — a store must never write outside its root).
      throw new MediaIntegrityError(`storage key '${key}' escapes the store root`, {
        storeId: this.storeId,
        key,
        rootDir: this.rootDir,
      });
    }
    return path;
  }

  async put(key: string, bytes: Uint8Array): Promise<PutOutcome> {
    const path = this.pathOf(key);
    const existing = await this.size(key);
    if (existing !== null) {
      const current = await readFile(path);
      if (sha256OfBytes(current) === sha256OfBytes(bytes)) {
        return {
          outcome: "duplicate",
          info: { key, contentHash: sha256OfBytes(bytes), byteSize: bytes.byteLength },
        };
      }
      throw new MediaIntegrityError(
        `storage key '${key}' already holds different content (stored media is never silently replaced)`,
        { storeId: this.storeId, key },
      );
    }
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    return {
      outcome: "stored",
      info: { key, contentHash: sha256OfBytes(bytes), byteSize: bytes.byteLength },
    };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.pathOf(key)));
    } catch {
      return null;
    }
  }

  async open(key: string, range?: ByteRange): Promise<StoredObjectView | null> {
    const totalSize = await this.size(key);
    if (totalSize === null) return null;
    const offset = range?.start ?? 0;
    if (offset < 0 || offset > totalSize) {
      throw new MediaIntegrityError(
        `range start ${offset} is outside the stored object (size ${totalSize})`,
        { storeId: this.storeId, key, totalSize, offset },
      );
    }
    const endExclusive = Math.min(range?.end !== undefined ? range.end + 1 : totalSize, totalSize);
    const length = Math.max(0, endExclusive - offset);
    const path = this.pathOf(key);
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      if (length > 0) {
        await handle.read(buffer, 0, length, offset);
      }
      return {
        key,
        bytes: new Uint8Array(buffer),
        offset,
        length,
        totalSize,
        contentHash: null,
      };
    } finally {
      await handle.close();
    }
  }

  async size(key: string): Promise<number | null> {
    try {
      const stats = await stat(this.pathOf(key));
      return stats.isFile() ? stats.size : null;
    } catch {
      return null;
    }
  }

  async verify(key: string, expectedHash: string): Promise<string> {
    const bytes = await this.get(key);
    if (bytes === null) {
      throw new MediaIntegrityError(`cannot verify absent storage key '${key}'`, {
        storeId: this.storeId,
        key,
      });
    }
    const measured = sha256OfBytes(bytes);
    if (measured !== expectedHash) {
      throw new MediaIntegrityError(
        `stored bytes at '${key}' hash to ${measured}, expected ${expectedHash}`,
        { storeId: this.storeId, key, measured, expectedHash },
      );
    }
    return measured;
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }
}

/** An in-memory storage adapter (tests and hermetic compositions). */
export class InMemoryStorage implements MediaStoragePort {
  readonly storeId: string;
  private readonly objects = new Map<string, Uint8Array>();

  constructor(storeId = "media-in-memory") {
    this.storeId = storeId;
  }

  async put(key: string, bytes: Uint8Array): Promise<PutOutcome> {
    assertSafeKey(this.storeId, key);
    const existing = this.objects.get(key);
    if (existing !== undefined) {
      if (sha256OfBytes(existing) === sha256OfBytes(bytes)) {
        return {
          outcome: "duplicate",
          info: { key, contentHash: sha256OfBytes(bytes), byteSize: bytes.byteLength },
        };
      }
      throw new MediaIntegrityError(
        `storage key '${key}' already holds different content (stored media is never silently replaced)`,
        { storeId: this.storeId, key },
      );
    }
    const copy = new Uint8Array(bytes);
    this.objects.set(key, copy);
    return {
      outcome: "stored",
      info: { key, contentHash: sha256OfBytes(copy), byteSize: copy.byteLength },
    };
  }

  async get(key: string): Promise<Uint8Array | null> {
    const stored = this.objects.get(key);
    return stored === undefined ? null : new Uint8Array(stored);
  }

  async open(key: string, range?: ByteRange): Promise<StoredObjectView | null> {
    const bytes = this.objects.get(key);
    if (bytes === undefined) return null;
    const totalSize = bytes.byteLength;
    const offset = range?.start ?? 0;
    if (offset < 0 || offset > totalSize) {
      throw new MediaIntegrityError(
        `range start ${offset} is outside the stored object (size ${totalSize})`,
        { storeId: this.storeId, key, totalSize, offset },
      );
    }
    const endExclusive = Math.min(range?.end !== undefined ? range.end + 1 : totalSize, totalSize);
    const slice = bytes.slice(offset, endExclusive);
    return {
      key,
      bytes: new Uint8Array(slice),
      offset,
      length: slice.byteLength,
      totalSize,
      contentHash: null,
    };
  }

  async size(key: string): Promise<number | null> {
    return this.objects.get(key)?.byteLength ?? null;
  }

  async verify(key: string, expectedHash: string): Promise<string> {
    const bytes = this.objects.get(key);
    if (bytes === undefined) {
      throw new MediaIntegrityError(`cannot verify absent storage key '${key}'`, {
        storeId: this.storeId,
        key,
      });
    }
    const measured = sha256OfBytes(bytes);
    if (measured !== expectedHash) {
      throw new MediaIntegrityError(
        `stored bytes at '${key}' hash to ${measured}, expected ${expectedHash}`,
        { storeId: this.storeId, key, measured, expectedHash },
      );
    }
    return measured;
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
