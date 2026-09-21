/**
 * SQLITE adapter for the ACCOUNT store (J014 — the local durable identity
 * plane; the documented follow-up to J007's deployment-shape analysis:
 * "making identity locally durable would require sqlite account/session
 * stores").
 *
 * WHY THIS EXISTS: J014's acceptance is that the USER survives a real
 * process restart/redeploy — accounts riding the in-memory
 * `InMemoryAccountStore` die with the process (users must re-register;
 * a restart would orphan every session's ownership rows). This adapter
 * mirrors the port's semantics exactly (`@sporta/identity`
 * `AccountStore` — the W911 `PgAccountStore`'s shape) over the real
 * `bun:sqlite` engine, so the local durable shape keeps accounts AND
 * login sessions across restarts while the hosted Neon gate remains the
 * production shape (DEPLOYMENT.md §6).
 *
 * The store owns id assignment (`u-<n>`, a durable monotonic counter —
 * the in-memory convention, now restart-stable). The bundled Node runtime
 * cannot construct it (the W911 shim refusal) — the composition falls
 * back to the in-memory store with the honest banner there.
 */
import {
  AccountConflictError,
  AccountNotFoundError,
  type Account,
  type AccountStore,
  type NewAccountInput,
} from "@sporta/identity";
import { Database } from "bun:sqlite";

const CREATE_ACCOUNTS_SQL = `
  CREATE TABLE IF NOT EXISTS sporta_identity_accounts (
    user_id       TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT,
    password_hash TEXT NOT NULL,
    roles_json    TEXT NOT NULL,
    created_at_iso TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sporta_identity_seq (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
`;

/** `AccountStore` over the real `bun:sqlite` engine (J014). */
export class SqliteAccountStore implements AccountStore {
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
    this.#db.exec(CREATE_ACCOUNTS_SQL);
  }

  async create(input: NewAccountInput): Promise<Account> {
    this.#assertOpen();
    const existing = this.#rowByUsername(input.username);
    if (existing !== null) throw new AccountConflictError(input.username);
    // The durable monotonic id counter (the in-memory `u-<n>` convention,
    // restart-stable: the counter table survives with the accounts).
    const userId = `u-${this.#nextSeq("accounts")}`;
    const stored: Account = {
      ...structuredClone({ ...input, roles: [...input.roles] }),
      userId,
    };
    const result = this.#db
      .query(
        `INSERT INTO sporta_identity_accounts
           (user_id, username, email, password_hash, roles_json, created_at_iso)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        stored.userId,
        stored.username,
        stored.email ?? null,
        stored.passwordHash,
        JSON.stringify(stored.roles),
        stored.createdAtIso,
      );
    if (result.changes === 0) throw new AccountConflictError(input.username);
    return structuredClone(stored);
  }

  async findByUsername(username: string): Promise<Account | null> {
    this.#assertOpen();
    const row = this.#rowByUsername(username);
    return row === null ? null : this.#toAccount(row);
  }

  async findByUserId(userId: string): Promise<Account | null> {
    this.#assertOpen();
    const row = this.#db
      .query("SELECT * FROM sporta_identity_accounts WHERE user_id = ?")
      .get(userId) as AccountRow | null;
    return row === null ? null : this.#toAccount(row);
  }

  async update(account: Account): Promise<void> {
    this.#assertOpen();
    const result = this.#db
      .query(
        `UPDATE sporta_identity_accounts
           SET username = ?, email = ?, password_hash = ?, roles_json = ?, created_at_iso = ?
         WHERE user_id = ?`,
      )
      .run(
        account.username,
        account.email ?? null,
        account.passwordHash,
        JSON.stringify([...account.roles]),
        account.createdAtIso,
        account.userId,
      );
    if (result.changes === 0) throw new AccountNotFoundError(account.userId);
  }

  #rowByUsername(username: string): AccountRow | null {
    return (
      (this.#db
        .query("SELECT * FROM sporta_identity_accounts WHERE username = ?")
        .get(username) as AccountRow | null) ?? null
    );
  }

  #toAccount(row: AccountRow): Account {
    return {
      userId: row.user_id,
      username: row.username,
      email: row.email ?? undefined,
      passwordHash: row.password_hash,
      roles: JSON.parse(row.roles_json) as Account["roles"],
      createdAtIso: row.created_at_iso,
    };
  }

  /** Advances (and seeds) one named counter, returning its new value. */
  #nextSeq(name: string): number {
    this.#db
      .query(
        `INSERT INTO sporta_identity_seq (name, value) VALUES (?, 0)
         ON CONFLICT (name) DO NOTHING`,
      )
      .run(name);
    const result = this.#db
      .query("UPDATE sporta_identity_seq SET value = value + 1 WHERE name = ? RETURNING value")
      .get(name) as { value: number };
    return result.value;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("the sqlite account store is closed");
  }

  /** Closes the underlying connection (idempotent). */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
  }
}

/** One stored account row (the sqlite naming, camelCase at the port). */
interface AccountRow {
  user_id: string;
  username: string;
  email: string | null;
  password_hash: string;
  roles_json: string;
  created_at_iso: string;
}
