/**
 * SQLITE adapter for the SESSION store (J014 — the local durable identity
 * plane; the documented follow-up to J007's deployment-shape analysis).
 *
 * WHY THIS EXISTS: J014's acceptance is that the USER'S SESSION survives
 * a real process restart — a login token riding the in-memory
 * `InMemorySessionStore` dies with the process (every browser goes 401
 * after a restart and must sign in again). This adapter mirrors the port
 * exactly (`@sporta/identity` `SessionStore` — the W911
 * `PgSessionStore`'s shape): only SHA-256 token HASHES are stored (the
 * service hashes before the store sees anything — a database dump can
 * never be replayed), records hand out deep clones, and the same
 * create/find/update semantics hold. The bundled Node runtime cannot
 * construct it (the W911 shim refusal) — the composition falls back to
 * the in-memory store with the honest banner there.
 */
import type { SessionRecord, SessionStore } from "@sporta/identity";
import { Database } from "bun:sqlite";

const CREATE_SESSIONS_SQL = `
  CREATE TABLE IF NOT EXISTS sporta_identity_sessions (
    token_hash     TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    issued_at_ms   INTEGER NOT NULL,
    expires_at_ms  INTEGER NOT NULL,
    active_role    TEXT,
    revoked_at_ms  INTEGER
  );
`;

/** `SessionStore` over the real `bun:sqlite` engine (J014). */
export class SqliteSessionStore implements SessionStore {
  /** The structural provider marker (health surfaces may read it). */
  readonly providerName = "sqlite" as const;

  readonly #db: Database;
  #closed = false;

  constructor(dbOrPath: Database | string) {
    // `bun:sqlite` resolves to the W911 shim under the bundled Node runtime;
    // constructing it there fails loudly with the shim's message (the
    // composition catches that specific refusal and falls back honestly).
    this.#db = typeof dbOrPath === "string" ? new Database(dbOrPath) : dbOrPath;
    this.#db.run("PRAGMA journal_mode = WAL;");
    this.#db.run("PRAGMA busy_timeout = 5000;");
    this.#db.exec(CREATE_SESSIONS_SQL);
  }

  async create(record: SessionRecord): Promise<void> {
    this.#assertOpen();
    const result = this.#db
      .query(
        `INSERT INTO sporta_identity_sessions
           (token_hash, user_id, issued_at_ms, expires_at_ms, active_role, revoked_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.tokenHash,
        record.userId,
        record.issuedAtMs,
        record.expiresAtMs,
        record.activeRole ?? null,
        record.revokedAtMs,
      );
    if (result.changes === 0) {
      throw new Error(`session store: duplicate token hash '${record.tokenHash}'`);
    }
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    this.#assertOpen();
    const row = this.#db
      .query("SELECT * FROM sporta_identity_sessions WHERE token_hash = ?")
      .get(tokenHash) as SessionRow | null;
    return row === null ? null : this.#toRecord(row);
  }

  async update(record: SessionRecord): Promise<void> {
    this.#assertOpen();
    const result = this.#db
      .query(
        `UPDATE sporta_identity_sessions
           SET user_id = ?, issued_at_ms = ?, expires_at_ms = ?, active_role = ?, revoked_at_ms = ?
         WHERE token_hash = ?`,
      )
      .run(
        record.userId,
        record.issuedAtMs,
        record.expiresAtMs,
        record.activeRole ?? null,
        record.revokedAtMs,
        record.tokenHash,
      );
    if (result.changes === 0) {
      throw new Error(`session store: unknown token hash '${record.tokenHash}'`);
    }
  }

  #toRecord(row: SessionRow): SessionRecord {
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      issuedAtMs: row.issued_at_ms,
      expiresAtMs: row.expires_at_ms,
      activeRole: (row.active_role ?? null) as SessionRecord["activeRole"],
      revokedAtMs: (row.revoked_at_ms ?? null) as SessionRecord["revokedAtMs"],
    };
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("the sqlite session store is closed");
  }

  /** Closes the underlying connection (idempotent). */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
  }
}

/** One stored session row (the sqlite naming, camelCase at the port). */
interface SessionRow {
  token_hash: string;
  user_id: string;
  issued_at_ms: number;
  expires_at_ms: number;
  active_role: string | null;
  revoked_at_ms: number | null;
}
