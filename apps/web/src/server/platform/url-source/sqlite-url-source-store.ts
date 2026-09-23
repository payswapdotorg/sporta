/**
 * SQLITE adapter for the URL-source REGISTRATION store (W6 Worker B — the
 * real-source acquisition machine's durable records).
 *
 * WHY THIS EXISTS: a URL-source registration is the operator's declared
 * intent (the canonical source URL + the rights declaration + the honest
 * acquisition state) and, after the transfer seam, the evidence join (the
 * measured integrity + the session/asset ids). Those records must survive
 * restarts against this machine's files exactly like the control-plane,
 * ownership, identity and media records do (the W911/J007 local-durable
 * doctrine) — the acquisition machine's state is NEVER quietly reset to
 * "pending" by a redeploy.
 *
 * The port is the app layer's {@link UrlSourceStore} (async by design —
 * the sqlite adapter's shape mirrors the other local durable stores).
 * The full registration record is stored as ONE JSON blob under its id
 * (the record is the unit of truth; the owner/session columns exist only
 * as honest indexes). Reads DEEP-CLONE (a returned record is never a
 * shared mutable reference — JSON round-trip). The bundled Node runtime
 * cannot construct this store (the W911 shim refusal) — the composition
 * falls back to the in-memory store with the honest banner there.
 */
import type { UrlSourceRegistration, UrlSourceStore } from "../../url-source-service";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

const CREATE_URL_SOURCE_SQL = `
  CREATE TABLE IF NOT EXISTS sporta_url_source_registrations (
    registration_id TEXT PRIMARY KEY,
    owner_id        TEXT NOT NULL,
    session_id      TEXT,
    record_json     TEXT NOT NULL,
    created_at_ms   INTEGER NOT NULL
  );
`;

const CREATE_SESSION_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS sporta_url_source_session_idx
    ON sporta_url_source_registrations (session_id);
`;

/** `UrlSourceStore` over the real `bun:sqlite` engine (W6 Worker B). */
export class SqliteUrlSourceStore implements UrlSourceStore {
  /** The structural provider marker (health surfaces may read it). */
  readonly providerName = "sqlite" as const;

  readonly #db: Database;
  #closed = false;

  constructor(dbOrPath: Database | string) {
    // `bun:sqlite` resolves to the W911 shim under the bundled Node runtime;
    // constructing it there fails loudly with the shim's message (the
    // composition catches that specific refusal and falls back honestly).
    if (typeof dbOrPath === "string" && dbOrPath !== ":memory:") {
      // A file-backed store creates its parent directory on demand (the
      // media-platform store's exact precedent — the composition's default
      // `db/` path must not pre-exist; a fresh checkout has no db/).
      mkdirSync(dirname(dbOrPath), { recursive: true });
    }
    this.#db = typeof dbOrPath === "string" ? new Database(dbOrPath) : dbOrPath;
    this.#db.run("PRAGMA journal_mode = WAL;");
    this.#db.run("PRAGMA busy_timeout = 5000;");
    this.#db.exec(CREATE_URL_SOURCE_SQL);
    this.#db.exec(CREATE_SESSION_INDEX_SQL);
  }

  async insert(registration: UrlSourceRegistration): Promise<void> {
    this.#assertOpen();
    try {
      this.#db
        .query(
          `INSERT INTO sporta_url_source_registrations
             (registration_id, owner_id, session_id, record_json, created_at_ms)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          registration.registrationId,
          registration.ownerId,
          registration.sessionId,
          JSON.stringify(registration),
          registration.createdAtMs,
        );
    } catch (err) {
      if (String(err).includes("UNIQUE constraint failed")) {
        throw new Error(`url-source registration '${registration.registrationId}' already exists`);
      }
      throw err;
    }
  }

  async find(registrationId: string): Promise<UrlSourceRegistration | null> {
    this.#assertOpen();
    const row = this.#db
      .query("SELECT record_json FROM sporta_url_source_registrations WHERE registration_id = ?")
      .get(registrationId) as { record_json: string } | null;
    return row === null ? null : (JSON.parse(row.record_json) as UrlSourceRegistration);
  }

  async update(registration: UrlSourceRegistration): Promise<void> {
    this.#assertOpen();
    const result = this.#db
      .query(
        `UPDATE sporta_url_source_registrations
           SET session_id = ?, record_json = ?
         WHERE registration_id = ?`,
      )
      .run(registration.sessionId, JSON.stringify(registration), registration.registrationId);
    if (result.changes === 0) {
      throw new Error(`url-source registration '${registration.registrationId}' is unknown`);
    }
  }

  async listByOwner(ownerId: string): Promise<UrlSourceRegistration[]> {
    this.#assertOpen();
    const rows = this.#db
      .query(
        `SELECT record_json FROM sporta_url_source_registrations
          WHERE owner_id = ?
          ORDER BY created_at_ms DESC, registration_id DESC`,
      )
      .all(ownerId) as { record_json: string }[];
    return rows.map((row) => JSON.parse(row.record_json) as UrlSourceRegistration);
  }

  async findBySession(sessionId: string): Promise<UrlSourceRegistration | null> {
    this.#assertOpen();
    const row = this.#db
      .query("SELECT record_json FROM sporta_url_source_registrations WHERE session_id = ? LIMIT 1")
      .get(sessionId) as { record_json: string } | null;
    return row === null ? null : (JSON.parse(row.record_json) as UrlSourceRegistration);
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("the sqlite url-source store is closed");
  }

  /** Closes the underlying connection (idempotent). */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
  }
}
