/**
 * Media session persistence (W004).
 *
 * Two `MediaSessionRepository` implementations:
 *
 * - {@link InMemorySessionRepository} — process-local store for tests and
 *   ephemeral runs;
 * - {@link SqliteSessionRepository} — durable store on `bun:sqlite` (built-in;
 *   no new dependency).
 *
 * Both store the FULL validated `MediaSession` JSON (`document_json` for
 * sqlite) — a schema-versioned, vendor-neutral document. Every write and read
 * validates against the `MediaSession` zod schema from `@sporta/contracts` and
 * fails loudly on drift. Deep-clone-on-read means callers can never mutate
 * stored state through handed-out references.
 */
import type { MediaSession as MediaSessionDoc, SessionStatus } from "@sporta/contracts";
import { Database } from "bun:sqlite";
import { parseSessionDocument, SessionDocumentValidationError } from "./validation";

/**
 * Persistence port for media sessions.
 *
 * Documents are the vendor-neutral `MediaSession` contract documents; the
 * repository is responsible for validating them on write AND on read.
 */
export interface MediaSessionRepository {
  /**
   * Validates and persists a new session. Throws
   * {@link SessionDocumentValidationError} on invalid documents and
   * {@link SessionConflictError} when `sessionId` already exists. Returns a
   * deep copy owned by the caller.
   */
  create(session: MediaSessionDoc): MediaSessionDoc;
  /** Returns a deep copy of the stored session, or `null` when absent. */
  get(sessionId: string): MediaSessionDoc | null;
  /**
   * Validates and replaces a stored session. Throws
   * {@link SessionDocumentValidationError} on invalid documents and
   * {@link SessionNotFoundError} when the session does not exist.
   */
  update(session: MediaSessionDoc): void;
  /** All stored sessions currently in `status`, as deep copies. */
  listByStatus(status: SessionStatus): MediaSessionDoc[];
  /** Removes the session; idempotent (deleting an absent id is a no-op). */
  delete(sessionId: string): void;
}

/** Thrown when updating or reading a session that does not exist. */
export class SessionNotFoundError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`media session '${sessionId}' was not found`);
    this.name = "SessionNotFoundError";
    this.sessionId = sessionId;
  }
}

/** Thrown when creating a session whose id already exists. */
export class SessionConflictError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`media session '${sessionId}' already exists`);
    this.name = "SessionConflictError";
    this.sessionId = sessionId;
  }
}

/** Deep copy that preserves the vendor-neutral document shape. */
function cloneSession(session: MediaSessionDoc): MediaSessionDoc {
  return structuredClone(session);
}

/**
 * Process-local `MediaSessionRepository`. Stores deep clones and hands out
 * deep clones: mutating a returned document never affects the store, and
 * mutating the store input after `create`/`update` never affects what was
 * stored.
 */
export class InMemorySessionRepository implements MediaSessionRepository {
  private readonly sessions = new Map<string, MediaSessionDoc>();

  create(session: MediaSessionDoc): MediaSessionDoc {
    const doc = parseSessionDocument(session);
    if (this.sessions.has(doc.sessionId)) {
      throw new SessionConflictError(doc.sessionId);
    }
    this.sessions.set(doc.sessionId, cloneSession(doc));
    return cloneSession(doc);
  }

  get(sessionId: string): MediaSessionDoc | null {
    const stored = this.sessions.get(sessionId);
    return stored === undefined ? null : cloneSession(stored);
  }

  update(session: MediaSessionDoc): void {
    const doc = parseSessionDocument(session);
    if (!this.sessions.has(doc.sessionId)) {
      throw new SessionNotFoundError(doc.sessionId);
    }
    this.sessions.set(doc.sessionId, cloneSession(doc));
  }

  listByStatus(status: SessionStatus): MediaSessionDoc[] {
    const out: MediaSessionDoc[] = [];
    for (const session of this.sessions.values()) {
      if (session.status === status) out.push(cloneSession(session));
    }
    return out;
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS media_sessions (
    session_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    document_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

const CREATE_STATUS_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS media_sessions_status_idx ON media_sessions (status)";

interface SessionRow {
  document_json: string;
}

/**
 * Durable `MediaSessionRepository` on `bun:sqlite`.
 *
 * Schema (per the W004 brief):
 *
 * `media_sessions (session_id TEXT PRIMARY KEY, status TEXT, document_json
 * TEXT, updated_at INTEGER)`
 *
 * `document_json` holds the full validated `MediaSession` JSON
 * (schema-versioned, vendor-neutral). `status` is a denormalized index
 * column maintained by the repository — the JSON document is the source of
 * truth. Both writes and reads validate against the `MediaSession` zod
 * schema; a corrupted row fails loudly with
 * {@link SessionDocumentValidationError}.
 */
export class SqliteSessionRepository implements MediaSessionRepository {
  private readonly db: Database;
  private closed = false;

  private readonly stmtInsert: ReturnType<Database["query"]>;
  private readonly stmtGet: ReturnType<Database["query"]>;
  private readonly stmtExists: ReturnType<Database["query"]>;
  private readonly stmtUpdate: ReturnType<Database["query"]>;
  private readonly stmtDelete: ReturnType<Database["query"]>;
  private readonly stmtListByStatus: ReturnType<Database["query"]>;

  /**
   * @param dbOrPath file path to a sqlite database (created if absent) or an
   *   open `bun:sqlite` `Database` instance. DDL is applied idempotently.
   *   `.close()` closes the underlying connection — do not close while other
   *   users of a shared instance still need it.
   */
  constructor(dbOrPath: string | Database) {
    this.db = typeof dbOrPath === "string" ? new Database(dbOrPath) : dbOrPath;
    this.db.run(CREATE_TABLE_SQL);
    this.db.run(CREATE_STATUS_INDEX_SQL);
    this.stmtInsert = this.db.query(
      "INSERT INTO media_sessions (session_id, status, document_json, updated_at) VALUES (?, ?, ?, ?)",
    );
    this.stmtGet = this.db.query("SELECT document_json FROM media_sessions WHERE session_id = ?");
    this.stmtExists = this.db.query("SELECT 1 FROM media_sessions WHERE session_id = ?");
    this.stmtUpdate = this.db.query(
      "UPDATE media_sessions SET status = ?, document_json = ?, updated_at = ? WHERE session_id = ?",
    );
    this.stmtDelete = this.db.query("DELETE FROM media_sessions WHERE session_id = ?");
    this.stmtListByStatus = this.db.query(
      "SELECT document_json FROM media_sessions WHERE status = ? ORDER BY session_id ASC",
    );
  }

  create(session: MediaSessionDoc): MediaSessionDoc {
    this.assertOpen();
    const doc = parseSessionDocument(session);
    if (this.stmtExists.get(doc.sessionId) !== null) {
      throw new SessionConflictError(doc.sessionId);
    }
    this.stmtInsert.run(doc.sessionId, doc.status, JSON.stringify(doc), Date.now());
    return cloneSession(doc);
  }

  get(sessionId: string): MediaSessionDoc | null {
    this.assertOpen();
    const row = this.stmtGet.get(sessionId) as SessionRow | null;
    return row === null ? null : this.readDocument(row.document_json, sessionId);
  }

  update(session: MediaSessionDoc): void {
    this.assertOpen();
    const doc = parseSessionDocument(session);
    if (this.stmtExists.get(doc.sessionId) === null) {
      throw new SessionNotFoundError(doc.sessionId);
    }
    this.stmtUpdate.run(doc.status, JSON.stringify(doc), Date.now(), doc.sessionId);
  }

  listByStatus(status: SessionStatus): MediaSessionDoc[] {
    this.assertOpen();
    const rows = this.stmtListByStatus.all(status) as SessionRow[];
    return rows.map((row) => this.readDocument(row.document_json));
  }

  delete(sessionId: string): void {
    this.assertOpen();
    this.stmtDelete.run(sessionId);
  }

  /** Closes the underlying sqlite connection. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("SqliteSessionRepository is closed");
    }
  }

  private readDocument(raw: string, sessionId?: string): MediaSessionDoc {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new SessionDocumentValidationError(
        `stored document${sessionId !== undefined ? ` for session '${sessionId}'` : ""} is not valid JSON`,
        { sessionId, cause: err },
      );
    }
    return parseSessionDocument(parsed, sessionId);
  }
}
