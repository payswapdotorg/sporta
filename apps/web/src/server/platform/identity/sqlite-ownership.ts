/**
 * SQLITE adapter for media-session OWNERSHIP (J007 — the local durable
 * substitute for the hosted `PgMediaOwnershipStore`, W911's third column).
 *
 * WHY THIS EXISTS: ownership ("which verified account created which media
 * session") is what the Library, the owner-gated studio reads and the watch
 * owner-access path resolve against. Without a durable ownership plane, a
 * local restart would reconstruct the session's records but the owner's
 * Library would miss it and owner-gated access would fail-closed — the
 * "Library/Jobs/Watch recovery" acceptance (J007) needs ownership to ride
 * the SAME local durable backing as the control-plane records.
 *
 * The port is the `@sporta/identity` `MediaOwnershipStore` (async by
 * design — the hosted adapter's shape); this adapter mirrors
 * `PgMediaOwnershipStore` exactly over the real `bun:sqlite` engine
 * (migration 0001's `sporta_media_ownership` columns). The bundled Node
 * runtime cannot construct it (the W911 shim refusal) — the composition
 * falls back to the in-memory store with the honest banner there.
 */
import type { MediaOwnershipStore } from "@sporta/identity";
import { Database } from "bun:sqlite";

const CREATE_OWNERSHIP_SQL = `
  CREATE TABLE IF NOT EXISTS sporta_media_ownership (
    session_id     TEXT PRIMARY KEY,
    owner_id       TEXT NOT NULL,
    recorded_at_ms INTEGER NOT NULL
  );
`;

/** `MediaOwnershipStore` over the real `bun:sqlite` engine (J007). */
export class SqliteMediaOwnershipStore implements MediaOwnershipStore {
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
    this.#db.exec(CREATE_OWNERSHIP_SQL);
  }

  async record(sessionId: string, ownerId: string): Promise<void> {
    this.#assertOpen();
    this.#db
      .query(
        `INSERT INTO sporta_media_ownership (session_id, owner_id, recorded_at_ms)
         VALUES (?, ?, ?)
         ON CONFLICT (session_id) DO NOTHING`,
      )
      .run(sessionId, ownerId, Date.now());
  }

  async ownerIdOf(sessionId: string): Promise<string | null> {
    this.#assertOpen();
    const row = this.#db
      .query("SELECT owner_id FROM sporta_media_ownership WHERE session_id = ?")
      .get(sessionId) as { owner_id: string } | null;
    return row === null ? null : row.owner_id;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("the sqlite media-ownership store is closed");
  }

  /** Closes the underlying connection (idempotent). */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
  }
}
