/**
 * Neon PostgreSQL adapter for the durable control-plane record store (W921).
 *
 * Implements the {@link ControlPlaneRecordStore} port over real PostgreSQL —
 * the same posture as the W911 identity stores: semantics mirror the in-memory
 * reference exactly (idempotent upserts, fail-closed parsing on read, fresh
 * objects per read). Requires migrations 0001 + 0002 applied (the composition
 * root ensures them once per runtime instance before this store is used).
 *
 * JSON columns (`rights_declaration`, `visibility`, `recipe`, `result`) are
 * parsed defensively on read: a row that does not parse throws loudly — never
 * a silently-degraded record served as control-plane state.
 */
import type { AuthorizationPolicy, RenderResult } from "@sporta/contracts";
import type { Role } from "@sporta/capability";
import { ROLES } from "@sporta/capability";
import type { PostgresSql } from "../db/pg";
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
        (role): role is Role => typeof role === "string" && (ROLES as readonly string[]).includes(role),
      ) as Role[])
    : [];
  return kind === "role-scoped" && roles.length === 0
    ? { kind: "private", roles: [] } // fail closed: a scope-less role record
    : { kind, roles };
}

function asInt(value: unknown, field: string): number {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isSafeInteger(num)) {
    throw new Error(`pg control store: ${field} is not a safe integer`);
  }
  return num;
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
    throw new Error("pg control store: session row shape invalid");
  }
  let rights: unknown;
  try {
    rights =
      typeof row["rights_declaration"] === "string"
        ? JSON.parse(row["rights_declaration"])
        : row["rights_declaration"];
  } catch {
    throw new Error("pg control store: rights_declaration is not valid JSON");
  }
  if (typeof rights !== "object" || rights === null) {
    throw new Error("pg control store: rights_declaration is not a policy object");
  }
  let visibilityRaw: unknown;
  try {
    visibilityRaw =
      typeof row["visibility"] === "string" ? JSON.parse(row["visibility"]) : row["visibility"];
  } catch {
    throw new Error("pg control store: visibility is not valid JSON");
  }
  const published = row["published_at_ms"];
  return {
    sessionId: row["session_id"],
    ownerUserId: row["owner_user_id"],
    sourceKey: row["source_key"],
    label: row["label"],
    rightsDeclaration: rights as AuthorizationPolicy,
    visibility: parseVisibility(visibilityRaw),
    status: row["status"],
    publishedAtMs: published === null || published === undefined ? null : asInt(published, "published_at_ms"),
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
    throw new Error("pg control store: render row shape invalid");
  }
  let recipe: unknown;
  let result: unknown;
  let storedIds: unknown;
  try {
    recipe = typeof row["recipe"] === "string" ? JSON.parse(row["recipe"]) : row["recipe"];
    result = typeof row["result"] === "string" ? JSON.parse(row["result"]) : row["result"];
    storedIds =
      row["stored_segment_ids"] === undefined || row["stored_segment_ids"] === null
        ? []
        : typeof row["stored_segment_ids"] === "string"
          ? JSON.parse(row["stored_segment_ids"])
          : row["stored_segment_ids"];
  } catch {
    throw new Error("pg control store: render recipe/result is not valid JSON");
  }
  if (typeof result !== "object" || result === null) {
    throw new Error("pg control store: render result is not an object");
  }
  if (!Array.isArray(storedIds) || storedIds.some((id) => typeof id !== "string")) {
    throw new Error("pg control store: stored_segment_ids is not a string array");
  }
  return {
    sessionId: row["session_id"],
    renderOrdinal: asInt(row["render_ordinal"], "render_ordinal"),
    renderId: row["render_id"],
    rendererId: row["renderer_id"],
    recipe: (recipe ?? {}) as ControlRenderRecipe,
    result: result as RenderResult,
    storedSegmentIds: storedIds as string[],
    createdAtMs: asInt(row["created_at_ms"], "created_at_ms"),
  };
}

/** `ControlPlaneRecordStore` over Neon PostgreSQL. */
export class PgControlPlaneRecordStore implements ControlPlaneRecordStore {
  readonly #sql: PostgresSql;
  readonly #nowMs: () => number;

  constructor(sql: PostgresSql, nowMs: () => number = Date.now) {
    this.#sql = sql;
    this.#nowMs = nowMs;
  }

  async upsertSession(record: ControlSessionRecord): Promise<void> {
    await this.#sql`
      INSERT INTO sporta_control_sessions
        (session_id, owner_user_id, source_key, label, rights_declaration, visibility,
         status, published_at_ms, created_at_iso, updated_at_ms)
      VALUES (
        ${record.sessionId},
        ${record.ownerUserId},
        ${record.sourceKey},
        ${record.label},
        ${JSON.stringify(record.rightsDeclaration)}::jsonb,
        ${JSON.stringify({ kind: record.visibility.kind, roles: [...record.visibility.roles] })}::jsonb,
        ${record.status},
        ${record.publishedAtMs ?? null},
        ${record.createdAtIso},
        ${this.#nowMs()}
      )
      ON CONFLICT (session_id) DO UPDATE SET
        owner_user_id = EXCLUDED.owner_user_id,
        source_key = EXCLUDED.source_key,
        label = EXCLUDED.label,
        rights_declaration = EXCLUDED.rights_declaration,
        visibility = EXCLUDED.visibility,
        status = EXCLUDED.status,
        updated_at_ms = EXCLUDED.updated_at_ms
    `;
  }

  async recordRender(record: ControlRenderRecord): Promise<void> {
    // Idempotent per (session_id, render_id): the unique index backs the
    // conflict target; a re-observation of the SAME render is a counted
    // no-op (the W912 mirror posture), never a duplicate row.
    await this.#sql`
      INSERT INTO sporta_control_renders
        (session_id, render_ordinal, render_id, renderer_id, recipe, result,
         stored_segment_ids, created_at_ms)
      VALUES (
        ${record.sessionId},
        ${record.renderOrdinal},
        ${record.renderId},
        ${record.rendererId},
        ${JSON.stringify(record.recipe)}::jsonb,
        ${JSON.stringify(record.result)}::jsonb,
        ${JSON.stringify([...record.storedSegmentIds])}::jsonb,
        ${record.createdAtMs}
      )
      ON CONFLICT (session_id, render_id) DO NOTHING
    `;
  }

  async findSession(sessionId: string): Promise<ControlSessionRecord | null> {
    const rows = await this.#sql`
      SELECT session_id, owner_user_id, source_key, label, rights_declaration, visibility,
             status, published_at_ms, created_at_iso, updated_at_ms
      FROM sporta_control_sessions WHERE session_id = ${sessionId}
    `;
    return rows.length === 0 ? null : rowToSession(rows[0]!);
  }

  async listSessions(): Promise<ControlSessionRecord[]> {
    const rows = await this.#sql`
      SELECT session_id, owner_user_id, source_key, label, rights_declaration, visibility,
             status, published_at_ms, created_at_iso, updated_at_ms
      FROM sporta_control_sessions ORDER BY created_at_iso, session_id
    `;
    return rows.map(rowToSession);
  }

  async findRenders(sessionId: string): Promise<ControlRenderRecord[]> {
    const rows = await this.#sql`
      SELECT session_id, render_ordinal, render_id, renderer_id, recipe, result,
             stored_segment_ids, created_at_ms
      FROM sporta_control_renders WHERE session_id = ${sessionId}
      ORDER BY render_ordinal
    `;
    return rows.map(rowToRender);
  }

  async setVisibility(sessionId: string, visibility: ControlVisibilityRecord): Promise<void> {
    const now = this.#nowMs();
    const rows = await this.#sql`
      UPDATE sporta_control_sessions
      SET visibility = ${JSON.stringify({ kind: visibility.kind, roles: [...visibility.roles] })}::jsonb,
          published_at_ms = CASE
            WHEN ${visibility.kind}::text = 'public' AND published_at_ms IS NULL THEN ${now}
            ELSE published_at_ms
          END,
          updated_at_ms = ${now}
      WHERE session_id = ${sessionId}
      RETURNING session_id
    `;
    if (rows.length === 0) {
      throw new Error(`control-plane record store: unknown session '${sessionId}'`);
    }
  }
}
