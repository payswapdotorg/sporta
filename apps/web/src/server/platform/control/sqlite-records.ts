/**
 * SQLITE adapter for the durable control-plane record store (J007 — the
 * LOCAL durable substitute for Neon, the W921 port's third implementation).
 *
 * WHY THIS EXISTS: the Wave 0 record established that NO hosted Neon/R2
 * credentials exist in this sandbox, so the hosted durability gate cannot
 * run here. The frozen deployment architecture places control-plane state
 * in "Neon PostgreSQL" — but the PORT (`ControlPlaneRecordStore`) is the
 * seam, and the repo is Bun-native: the real `bun:sqlite` engine runs the
 * media loop's durable store today (`SqliteMediaPlatformStore`, the exact
 * precedent). This adapter implements the SAME port over the SAME engine
 * with the SAME semantics as {@link PgControlPlaneRecordStore}, so the
 * W921 write-through/reconstruct path is provable end-to-end LOCALLY:
 * create-on-instance-A / read-on-instance-B and redeploy-does-not-erase
 * are real file-backed properties, honestly labeled `sqlite` (never
 * claimed as the hosted Neon gate — that stays blocked on credentials).
 *
 * Semantics mirror the pg adapter EXACTLY (the port's contract):
 * - idempotent `upsertSession` (last write wins per session id) and
 *   idempotent `recordRender` (a re-observation of the same
 *   (session, renderId) is a NO-OP, never a duplicate row);
 * - fail-closed parsing on read: a row that does not parse/validate
 *   throws loudly — never a silently-degraded record served as
 *   control-plane state;
 * - fresh objects per read (callers can never alias stored state);
 * - `setVisibility` throws on an unknown session (the flip is lost
 *   in-process only — never a silent nothing).
 *
 * The bundled Node runtime (Turbopack/webpack alias `bun:sqlite` to the
 * loud W911 shim) cannot construct this store: the constructor fails with
 * the shim's message and the honest fallback is the composition WITHOUT a
 * durable layer (in-memory control plane, health-labeled). See
 * docs/deployment/J007-local-durability-and-deployment-shapes.md.
 */
import type { AuthorizationPolicy, RenderResult } from "@sporta/contracts";
import type { Role } from "@sporta/capability";
import { ROLES } from "@sporta/capability";
import { Database } from "bun:sqlite";
import type {
  ControlPlaneRecordStore,
  ControlRenderRecipe,
  ControlRenderRecord,
  ControlSessionRecord,
  ControlVisibilityRecord,
} from "./records";

/** Parses a visibility JSON value (fail-closed to `private` on garbage). */
function parseVisibility(raw: unknown): ControlVisibilityRecord {
  if (typeof raw !== "object" || raw === null) return { kind: "private", roles: [] };
  const value = raw as Record<string, unknown>;
  const kind = value["kind"];
  if (kind !== "public" && kind !== "private" && kind !== "unlisted" && kind !== "role-scoped") {
    return { kind: "private", roles: [] };
  }
  const roles: Role[] = Array.isArray(value["roles"])
    ? (value["roles"].filter(
        (role): role is Role =>
          typeof role === "string" && (ROLES as readonly string[]).includes(role),
      ) as Role[])
    : [];
  return kind === "role-scoped" && roles.length === 0
    ? { kind: "private", roles: [] } // fail closed: a scope-less role record
    : { kind, roles };
}

function asInt(value: unknown, field: string): number {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isSafeInteger(num)) {
    throw new Error(`sqlite control store: ${field} is not a safe integer`);
  }
  return num;
}

function parseJsonField(raw: unknown, field: string): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`sqlite control store: ${field} is not valid JSON`);
  }
}

function rowToSession(row: Record<string, unknown>): ControlSessionRecord {
  if (
    typeof row["session_id"] !== "string" ||
    typeof row["owner_user_id"] !== "string" ||
    typeof row["source_key"] !== "string" ||
    typeof row["label"] !== "string" ||
    typeof row["status"] !== "string" ||
    typeof row["created_at_iso"] !== "string"
  ) {
    throw new Error("sqlite control store: session row shape invalid");
  }
  const rights = parseJsonField(row["rights_declaration"], "rights_declaration");
  if (typeof rights !== "object" || rights === null) {
    throw new Error("sqlite control store: rights_declaration is not a policy object");
  }
  const visibilityRaw = parseJsonField(row["visibility"], "visibility");
  const published = row["published_at_ms"];
  return {
    sessionId: row["session_id"],
    ownerUserId: row["owner_user_id"],
    sourceKey: row["source_key"],
    label: row["label"],
    rightsDeclaration: rights as AuthorizationPolicy,
    visibility: parseVisibility(visibilityRaw),
    status: row["status"],
    publishedAtMs:
      published === null || published === undefined ? null : asInt(published, "published_at_ms"),
    createdAtIso: row["created_at_iso"],
    updatedAtMs: asInt(row["updated_at_ms"], "updated_at_ms"),
  };
}

function rowToRender(row: Record<string, unknown>): ControlRenderRecord {
  if (
    typeof row["session_id"] !== "string" ||
    typeof row["render_id"] !== "string" ||
    typeof row["renderer_id"] !== "string"
  ) {
    throw new Error("sqlite control store: render row shape invalid");
  }
  const recipe = parseJsonField(row["recipe"] ?? {}, "recipe");
  const result = parseJsonField(row["result"], "result");
  const storedIdsRaw =
    row["stored_segment_ids"] === undefined || row["stored_segment_ids"] === null
      ? []
      : parseJsonField(row["stored_segment_ids"], "stored_segment_ids");
  if (typeof result !== "object" || result === null) {
    throw new Error("sqlite control store: render result is not an object");
  }
  if (!Array.isArray(storedIdsRaw) || storedIdsRaw.some((id) => typeof id !== "string")) {
    throw new Error("sqlite control store: stored_segment_ids is not a string array");
  }
  return {
    sessionId: row["session_id"],
    renderOrdinal: asInt(row["render_ordinal"], "render_ordinal"),
    renderId: row["render_id"],
    rendererId: row["renderer_id"],
    recipe: (recipe ?? {}) as ControlRenderRecipe,
    result: result as RenderResult,
    storedSegmentIds: storedIdsRaw as string[],
    createdAtMs: asInt(row["created_at_ms"], "created_at_ms"),
  };
}

// The schema mirrors migration 0002 (JSONB → TEXT JSON; same columns, same
// keys, same indexes) — one durable file, two tables, idempotent DDL.
const CREATE_SQLITE_CONTROL_SQL = `
  CREATE TABLE IF NOT EXISTS sporta_control_sessions (
    session_id         TEXT PRIMARY KEY,
    owner_user_id      TEXT NOT NULL,
    source_key         TEXT NOT NULL,
    label              TEXT NOT NULL,
    rights_declaration TEXT NOT NULL,
    visibility         TEXT NOT NULL,
    status             TEXT NOT NULL,
    published_at_ms    INTEGER,
    created_at_iso     TEXT NOT NULL,
    updated_at_ms      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sporta_control_sessions_owner_idx
    ON sporta_control_sessions (owner_user_id);
  CREATE TABLE IF NOT EXISTS sporta_control_renders (
    session_id         TEXT NOT NULL,
    render_ordinal     INTEGER NOT NULL,
    render_id          TEXT NOT NULL,
    renderer_id        TEXT NOT NULL,
    recipe             TEXT NOT NULL,
    result             TEXT NOT NULL,
    stored_segment_ids TEXT NOT NULL DEFAULT '[]',
    created_at_ms      INTEGER NOT NULL,
    PRIMARY KEY (session_id, render_ordinal)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sporta_control_renders_id_idx
    ON sporta_control_renders (session_id, render_id);
`;

/** `ControlPlaneRecordStore` over the real `bun:sqlite` engine (J007). */
export class SqliteControlPlaneRecordStore implements ControlPlaneRecordStore {
  /** The structural provider marker (the composition's health labels read it). */
  readonly providerName = "sqlite" as const;

  readonly #db: Database;
  readonly #nowMs: () => number;
  #closed = false;

  constructor(
    dbOrPath: Database | string,
    nowMs: () => number = Date.now,
  ) {
    // `bun:sqlite` resolves to the W911 shim under the bundled Node runtime;
    // constructing it there fails loudly with the shim's message (the
    // composition catches that specific refusal and falls back honestly).
    this.#db = typeof dbOrPath === "string" ? new Database(dbOrPath) : dbOrPath;
    this.#db.run("PRAGMA journal_mode = WAL;");
    this.#db.run("PRAGMA busy_timeout = 5000;");
    this.#db.exec(CREATE_SQLITE_CONTROL_SQL);
    this.#nowMs = nowMs;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("the sqlite control-plane record store is closed");
  }

  async upsertSession(record: ControlSessionRecord): Promise<void> {
    this.#assertOpen();
    this.#db
      .query(
        `INSERT INTO sporta_control_sessions
           (session_id, owner_user_id, source_key, label, rights_declaration, visibility,
            status, published_at_ms, created_at_iso, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_id) DO UPDATE SET
           owner_user_id = excluded.owner_user_id,
           source_key = excluded.source_key,
           label = excluded.label,
           rights_declaration = excluded.rights_declaration,
           visibility = excluded.visibility,
           status = excluded.status,
           published_at_ms = excluded.published_at_ms,
           updated_at_ms = excluded.updated_at_ms`,
      )
      .run(
        record.sessionId,
        record.ownerUserId,
        record.sourceKey,
        record.label,
        JSON.stringify(record.rightsDeclaration),
        JSON.stringify({ kind: record.visibility.kind, roles: [...record.visibility.roles] }),
        record.status,
        record.publishedAtMs ?? null,
        record.createdAtIso,
        this.#nowMs(),
      );
  }

  async recordRender(record: ControlRenderRecord): Promise<void> {
    this.#assertOpen();
    // Idempotent per (session_id, render_id): the unique index backs the
    // conflict target; a re-observation of the SAME render is a no-op.
    this.#db
      .query(
        `INSERT INTO sporta_control_renders
           (session_id, render_ordinal, render_id, renderer_id, recipe, result,
            stored_segment_ids, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_id, render_id) DO NOTHING`,
      )
      .run(
        record.sessionId,
        record.renderOrdinal,
        record.renderId,
        record.rendererId,
        JSON.stringify(record.recipe),
        JSON.stringify(record.result),
        JSON.stringify([...record.storedSegmentIds]),
        record.createdAtMs,
      );
  }

  async findSession(sessionId: string): Promise<ControlSessionRecord | null> {
    this.#assertOpen();
    const row = this.#db
      .query(
        `SELECT session_id, owner_user_id, source_key, label, rights_declaration, visibility,
                status, published_at_ms, created_at_iso, updated_at_ms
         FROM sporta_control_sessions WHERE session_id = ?`,
      )
      .get(sessionId) as Record<string, unknown> | null;
    return row === null ? null : rowToSession(row);
  }

  async listSessions(): Promise<ControlSessionRecord[]> {
    this.#assertOpen();
    const rows = this.#db
      .query(
        `SELECT session_id, owner_user_id, source_key, label, rights_declaration, visibility,
                status, published_at_ms, created_at_iso, updated_at_ms
         FROM sporta_control_sessions ORDER BY created_at_iso, session_id`,
      )
      .all() as Record<string, unknown>[];
    return rows.map(rowToSession);
  }

  async findRenders(sessionId: string): Promise<ControlRenderRecord[]> {
    this.#assertOpen();
    const rows = this.#db
      .query(
        `SELECT session_id, render_ordinal, render_id, renderer_id, recipe, result,
                stored_segment_ids, created_at_ms
         FROM sporta_control_renders WHERE session_id = ? ORDER BY render_ordinal`,
      )
      .all(sessionId) as Record<string, unknown>[];
    return rows.map(rowToRender);
  }

  async setVisibility(sessionId: string, visibility: ControlVisibilityRecord): Promise<void> {
    this.#assertOpen();
    const now = this.#nowMs();
    const parsed = parseVisibility(visibility);
    const existing = await this.findSession(sessionId);
    if (existing === null) {
      throw new Error(`control-plane record store: unknown session '${sessionId}'`);
    }
    this.#db
      .query(
        `UPDATE sporta_control_sessions
         SET visibility = ?,
             published_at_ms = ?,
             updated_at_ms = ?
         WHERE session_id = ?`,
      )
      .run(
        JSON.stringify({ kind: parsed.kind, roles: [...parsed.roles] }),
        parsed.kind === "public" && existing.publishedAtMs === null ? now : existing.publishedAtMs,
        now,
        sessionId,
      );
  }

  /** Closes the underlying connection when this store owns it (idempotent). */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
  }
}
