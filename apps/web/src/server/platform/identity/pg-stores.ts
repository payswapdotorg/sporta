/**
 * Neon PostgreSQL adapters for the `@sporta/identity` persistence ports (W911).
 *
 * These implement the W902 PORT INTERFACES (`AccountStore`, `SessionStore`,
 * `MediaOwnershipStore`) over real PostgreSQL — the hosted persistence the
 * ports were shaped for (their methods are async by design). Semantics mirror
 * the in-memory references EXACTLY:
 *
 * - `create` assigns the user id (Postgres side: `u-<hex-uuid>`), throws the
 *   typed `AccountConflictError` on a taken username, `AccountNotFoundError`
 *   on unknown update — same classes, same fields, so the transport layer
 *   above cannot tell the stores apart by behavior;
 * - sessions store ONLY the SHA-256 token hash (the opaque token never
 *   touches the database — pinned by integration test);
 * - rows are re-validated on read (closed role vocabulary, hash shapes) and
 *   handed out as FRESH objects (no aliasing across requests).
 *
 * Constraint: requires migration 0001 applied (see `./db/migrations`).
 */
import type { Role } from "@sporta/capability";
import { ROLES } from "@sporta/capability";
import {
  AccountConflictError,
  AccountNotFoundError,
  type Account,
  type AccountStore,
  type MediaOwnershipStore,
  type NewAccountInput,
  type SessionRecord,
  type SessionStore,
} from "@sporta/identity";
import type { PostgresSql } from "../db/pg";

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

function parseRoles(json: string): Role[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("pg identity store: roles column is not valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.some((role) => typeof role !== "string" || !ROLE_SET.has(role))) {
    throw new Error("pg identity store: roles column is not a valid role array");
  }
  return parsed as Role[];
}

function asInt(value: unknown, field: string): number {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isSafeInteger(num)) {
    throw new Error(`pg identity store: ${field} is not a safe integer`);
  }
  return num;
}

function rowToAccount(row: Record<string, unknown>): Account {
  if (
    typeof row["user_id"] !== "string" ||
    typeof row["username"] !== "string" ||
    typeof row["password_hash"] !== "string" ||
    typeof row["created_at_iso"] !== "string"
  ) {
    throw new Error("pg identity store: account row shape invalid");
  }
  const email = row["email"];
  return {
    userId: row["user_id"],
    username: row["username"],
    email: typeof email === "string" ? email : undefined,
    passwordHash: row["password_hash"],
    roles: parseRoles(row["roles"] as string),
    createdAtIso: row["created_at_iso"],
  };
}

function rowToSession(row: Record<string, unknown>): SessionRecord {
  if (
    typeof row["token_hash"] !== "string" ||
    typeof row["user_id"] !== "string" ||
    typeof row["active_role"] !== "string" &&
      row["active_role"] !== null
  ) {
    throw new Error("pg identity store: session row shape invalid");
  }
  const activeRole = row["active_role"];
  if (activeRole !== null && (typeof activeRole !== "string" || !ROLE_SET.has(activeRole))) {
    throw new Error("pg identity store: session active_role is not a valid role");
  }
  const revoked = row["revoked_at_ms"];
  return {
    tokenHash: row["token_hash"],
    userId: row["user_id"],
    issuedAtMs: asInt(row["issued_at_ms"], "issued_at_ms"),
    expiresAtMs: asInt(row["expires_at_ms"], "expires_at_ms"),
    activeRole: activeRole as Role | null,
    revokedAtMs: revoked === null || revoked === undefined ? null : asInt(revoked, "revoked_at_ms"),
  };
}

/** Postgres unique-violation detector (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

// ---------------------------------------------------------------------------
// AccountStore
// ---------------------------------------------------------------------------

/** `AccountStore` over Neon PostgreSQL. */
export class PgAccountStore implements AccountStore {
  readonly #sql: PostgresSql;

  constructor(sql: PostgresSql) {
    this.#sql = sql;
  }

  async create(input: NewAccountInput): Promise<Account> {
    try {
      const rows = await this.#sql`
        INSERT INTO sporta_accounts (user_id, username, email, password_hash, roles, created_at_iso)
        VALUES (
          'u-' || replace(gen_random_uuid()::text, '-', ''),
          ${input.username},
          ${input.email ?? null},
          ${input.passwordHash},
          ${JSON.stringify([...input.roles])},
          ${input.createdAtIso}
        )
        RETURNING user_id, username, email, password_hash, roles, created_at_iso
      `;
      return rowToAccount(rows[0]!);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AccountConflictError(input.username);
      throw err;
    }
  }

  async findByUsername(username: string): Promise<Account | null> {
    const rows = await this.#sql`
      SELECT user_id, username, email, password_hash, roles, created_at_iso
      FROM sporta_accounts WHERE username = ${username}
    `;
    return rows.length === 0 ? null : rowToAccount(rows[0]!);
  }

  async findByUserId(userId: string): Promise<Account | null> {
    const rows = await this.#sql`
      SELECT user_id, username, email, password_hash, roles, created_at_iso
      FROM sporta_accounts WHERE user_id = ${userId}
    `;
    return rows.length === 0 ? null : rowToAccount(rows[0]!);
  }

  async update(account: Account): Promise<void> {
    try {
      const rows = await this.#sql`
        UPDATE sporta_accounts
        SET username = ${account.username},
            email = ${account.email ?? null},
            password_hash = ${account.passwordHash},
            roles = ${JSON.stringify([...account.roles])},
            created_at_iso = ${account.createdAtIso}
        WHERE user_id = ${account.userId}
        RETURNING user_id
      `;
      if (rows.length === 0) throw new AccountNotFoundError(account.userId);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AccountConflictError(account.username);
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

/** `SessionStore` over Neon PostgreSQL (token hashes only — never tokens). */
export class PgSessionStore implements SessionStore {
  readonly #sql: PostgresSql;

  constructor(sql: PostgresSql) {
    this.#sql = sql;
  }

  async create(record: SessionRecord): Promise<void> {
    try {
      await this.#sql`
        INSERT INTO sporta_sessions
          (token_hash, user_id, issued_at_ms, expires_at_ms, active_role, revoked_at_ms)
        VALUES (
          ${record.tokenHash},
          ${record.userId},
          ${record.issuedAtMs},
          ${record.expiresAtMs},
          ${record.activeRole ?? null},
          ${record.revokedAtMs ?? null}
        )
      `;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(`session store: duplicate token hash '${record.tokenHash}'`);
      }
      throw err;
    }
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const rows = await this.#sql`
      SELECT token_hash, user_id, issued_at_ms, expires_at_ms, active_role, revoked_at_ms
      FROM sporta_sessions WHERE token_hash = ${tokenHash}
    `;
    return rows.length === 0 ? null : rowToSession(rows[0]!);
  }

  async update(record: SessionRecord): Promise<void> {
    const rows = await this.#sql`
      UPDATE sporta_sessions
      SET user_id = ${record.userId},
          issued_at_ms = ${record.issuedAtMs},
          expires_at_ms = ${record.expiresAtMs},
          active_role = ${record.activeRole ?? null},
          revoked_at_ms = ${record.revokedAtMs ?? null}
      WHERE token_hash = ${record.tokenHash}
      RETURNING token_hash
    `;
    if (rows.length === 0) {
      throw new Error(`session store: unknown token hash '${record.tokenHash}'`);
    }
  }
}

// ---------------------------------------------------------------------------
// MediaOwnershipStore (the control gate's ownership record)
// ---------------------------------------------------------------------------

/** `MediaOwnershipStore` over Neon PostgreSQL. */
export class PgMediaOwnershipStore implements MediaOwnershipStore {
  readonly #sql: PostgresSql;
  readonly #nowMs: () => number;

  /** `nowMs` defaults to the REAL wall clock (the hosted composition is a production caller). */
  constructor(sql: PostgresSql, nowMs: () => number = Date.now) {
    this.#sql = sql;
    this.#nowMs = nowMs;
  }

  async record(sessionId: string, ownerId: string): Promise<void> {
    await this.#sql`
      INSERT INTO sporta_media_ownership (session_id, owner_id, recorded_at_ms)
      VALUES (${sessionId}, ${ownerId}, ${this.#nowMs()})
      ON CONFLICT (session_id) DO UPDATE SET owner_id = EXCLUDED.owner_id
    `;
  }

  async ownerIdOf(sessionId: string): Promise<string | null> {
    const rows = await this.#sql`
      SELECT owner_id FROM sporta_media_ownership WHERE session_id = ${sessionId}
    `;
    return rows.length === 0 ? null : (rows[0]!["owner_id"] as string);
  }
}
