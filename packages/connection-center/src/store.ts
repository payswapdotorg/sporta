/**
 * The connection RECORD store (R406): bounded, account-isolated storage for
 * provider connection records and the connection audit trail, in memory and
 * on `bun:sqlite`.
 *
 * W004 repository patterns, followed exactly (the `@sporta/output-pipeline`
 * `store.ts` precedent — its own module docs list them):
 *
 * - a port interface (`ConnectionStore`) + two implementations
 *   (`InMemoryConnectionStore` for tests/ephemeral runs,
 *   `SqliteConnectionStore` for durable storage; DDL applied
 *   idempotently; constructor takes a file path or an open `Database`;
 *   `close()` is idempotent);
 * - validation on write AND on read (stored documents are re-verified
 *   against the zod schemas and a corrupted row fails loudly with
 *   `ConnectionStoreIntegrityError`, never partial data);
 * - deep-clone-on-read and clone-on-write (callers can never mutate stored
 *   state through handed-out references, and mutating an input after a
 *   write never leaks in);
 * - idempotency with conflict semantics: re-presenting the SAME credential
 *   (same fingerprint) for an already-connected (account, provider) is a
 *   counted no-op duplicate; presenting a DIFFERENT credential without
 *   disconnecting first is a fail-loud `ConnectionConflictError` (a
 *   connection is never silently replaced);
 * - NUL-free scope ids: the composite key is `\u0000`-separated, so a NUL
 *   inside an id would make the key AMBIGUOUS. Such ids are rejected loudly
 *   on every path — the key space is unambiguous BY VALIDATION;
 * - bounded size: `maxRecords` and `maxAuditEntries` are enforced with an
 *   explicit `ConnectionStoreLimitError` reject — never silent eviction.
 *
 * Deliberate deviation from the W004 precedent, documented: the record
 * carries a monotone `revision` (incremented on every update) so a stale
 * read-modify-write races loudly (a `ConnectionConflictError`) instead of
 * silently clobbering a concurrent verify/disconnect — the W004
 * never-silently-replace posture applied to updates.
 *
 * NO CREDENTIAL VALUE EVER ENTERS THIS STORE: records hold the
 * `CredentialReference` (kind + sha-256 fingerprint prefix + presented-at)
 * only (./credentials.ts). The audit trail likewise carries outcomes and
 * evidence strings, never values.
 */
import { Database } from "bun:sqlite";
import { z } from "zod";
import { ConnectionRecordSchema } from "./schema";
import type { ConnectionRecord } from "./schema";

export type { ConnectionRecord };

// ---------------------------------------------------------------------------
// The audit vocabulary (closed — every connection attempt is accounted)
// ---------------------------------------------------------------------------

/** The closed audit-outcome vocabulary (never a bespoke string). */
export const CONNECTION_AUDIT_OUTCOMES = [
  /** A new connection was created. */
  "connected",
  /** The same credential was re-presented (counted no-op). */
  "connect-duplicate",
  /** A different credential was presented over a live connection (refused). */
  "connect-conflict",
  /** A password-class presentation was refused fail-closed (recorded, never dropped). */
  "connect-refused-master-password",
  /** A verification call answered `verified`. */
  "verified",
  /** A verification call could not complete (network/timeout — honest unknown). */
  "verify-failed",
  /** The provider rejected the credential (a real 401/403 was observed). */
  "credential-invalid",
  /** Verification was skipped honestly (the provider needs no credential). */
  "verify-skipped",
  /** The connection was removed. */
  "disconnected",
] as const;
export type ConnectionAuditOutcome = (typeof CONNECTION_AUDIT_OUTCOMES)[number];

/** One audited connection attempt (the never-dropped refusal record). */
export const ConnectionAuditEntry = z
  .object({
    schemaVersion: z.literal("1.0"),
    accountId: z.string().min(1),
    providerId: z.string().min(1),
    outcome: z.enum(CONNECTION_AUDIT_OUTCOMES),
    atMs: z.number().finite().min(0),
    /** Honest evidence (never a credential value; never empty when present). */
    detail: z.string().min(1).optional(),
  })
  .strict();
export type ConnectionAuditEntry = z.infer<typeof ConnectionAuditEntry>;

// ---------------------------------------------------------------------------
// The store port + typed errors
// ---------------------------------------------------------------------------

/** The disposition of an `insertRecord` call. */
export type InsertOutcome =
  | { disposition: "created"; record: ConnectionRecord }
  | { disposition: "duplicate"; record: ConnectionRecord; duplicates: number };

/** The disposition of an `updateRecord` call. */
export type UpdateOutcome = { disposition: "updated"; record: ConnectionRecord };

/** The store stats (honest counters — the W004 counted-duplicates posture). */
export interface ConnectionStoreStats {
  records: number;
  auditEntries: number;
  duplicatePuts: number;
  updates: number;
  deletes: number;
  integrityChecksPassed: number;
}

/** Base class for the typed store errors (all fail-loud, none silent). */
export class ConnectionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionStoreError";
  }
}

/** A scope id carried a NUL (the key space must stay unambiguous). */
export class ConnectionScopeInvalidError extends ConnectionStoreError {
  constructor(accountId: string, providerId: string) {
    super(
      `connection scope ids must be non-empty and NUL-free (accountId='${accountId.replaceAll("\u0000", "\\0")}', providerId='${providerId.replaceAll("\u0000", "\\0")}')`,
    );
    this.name = "ConnectionScopeInvalidError";
  }
}

/** A record failed (re-)validation — corrupted storage fails loudly. */
export class ConnectionStoreIntegrityError extends ConnectionStoreError {
  constructor(accountId: string, providerId: string, issues: string) {
    super(
      `connection record for (account '${accountId}', provider '${providerId}') failed integrity re-validation: ${issues}`,
    );
    this.name = "ConnectionStoreIntegrityError";
  }
}

/** A different credential was presented over a live connection. */
export class ConnectionConflictError extends ConnectionStoreError {
  readonly accountId: string;
  readonly providerId: string;
  readonly existingFingerprint: string | null;
  readonly presentedFingerprint: string | null;

  constructor(options: {
    accountId: string;
    providerId: string;
    existingFingerprint: string | null;
    presentedFingerprint: string | null;
  }) {
    super(
      `account '${options.accountId}' already has a different credential connected for provider '${options.providerId}' (existing ${options.existingFingerprint ?? "none"}, presented ${options.presentedFingerprint ?? "none"}) — disconnect before connecting a different credential (never silently replaced)`,
    );
    this.name = "ConnectionConflictError";
    this.accountId = options.accountId;
    this.providerId = options.providerId;
    this.existingFingerprint = options.existingFingerprint;
    this.presentedFingerprint = options.presentedFingerprint;
  }
}

/** A bound was exceeded (never silent eviction). */
export class ConnectionStoreLimitError extends ConnectionStoreError {
  constructor(bound: string, limit: number, current: number) {
    super(
      `connection store bound '${bound}' exceeded: ${current} > ${limit} (never silently evicted)`,
    );
    this.name = "ConnectionStoreLimitError";
  }
}

/** An update named a scope that does not exist (never a silent create). */
export class ConnectionRecordAbsentError extends ConnectionStoreError {
  constructor(accountId: string, providerId: string) {
    super(
      `no connection record for (account '${accountId}', provider '${providerId}') — the update path never silently creates`,
    );
    this.name = "ConnectionRecordAbsentError";
  }
}

/** A stale revision was written (a concurrent update won). */
export class ConnectionStaleWriteError extends ConnectionStoreError {
  constructor(accountId: string, providerId: string, attemptedRevision: number) {
    super(
      `stale write for (account '${accountId}', provider '${providerId}'): revision ${attemptedRevision} was superseded — re-read and retry`,
    );
    this.name = "ConnectionStaleWriteError";
  }
}

/** The connection store port (the W004 repository seam). */
export interface ConnectionStore {
  /** Creates a record (duplicate same-fingerprint re-presents are counted). */
  insertRecord(record: ConnectionRecord): Promise<InsertOutcome>;
  /** Updates an EXISTING record (revision must advance; absent scope fails). */
  updateRecord(record: ConnectionRecord): Promise<UpdateOutcome>;
  /** Finds one record (deep-cloned; `null` when absent). */
  findRecord(accountId: string, providerId: string): Promise<ConnectionRecord | null>;
  /** Lists one account's records (deep-cloned; provider-order stable). */
  listRecords(accountId: string): Promise<ConnectionRecord[]>;
  /** Removes one record, returning it (or `null` when absent). */
  deleteRecord(accountId: string, providerId: string): Promise<ConnectionRecord | null>;
  /** Appends one audit entry (bounded; counted). */
  appendAudit(entry: ConnectionAuditEntry): Promise<void>;
  /** Lists the account's audit entries, newest-first, bounded by `limit`. */
  listAudit(accountId: string, limit?: number): Promise<ConnectionAuditEntry[]>;
  /** The honest counters. */
  stats(): ConnectionStoreStats;
  /** Closes the store (idempotent). */
  close(): void;
}

// ---------------------------------------------------------------------------
// Shared validation + scope guards
// ---------------------------------------------------------------------------

/** Options shared by both implementations. */
export interface ConnectionStoreOptions {
  /** Bound on stored records (default 10_000; exceeding rejects). */
  maxRecords?: number;
  /** Bound on audit entries (default 100_000; exceeding rejects). */
  maxAuditEntries?: number;
  /**
   * Bound on one record's history length (default 64; the center trims to
   * it BEFORE writing — a record that exceeds it via direct store use
   * rejects loudly, never silently truncated).
   */
  maxHistoryEntries?: number;
  /** Clock in epoch ms (default: deterministic `TEST_EPOCH_MS + ticks`). */
  nowMs?: () => number;
}

export const DEFAULT_MAX_RECORDS = 10_000;
export const DEFAULT_MAX_AUDIT_ENTRIES = 100_000;
export const DEFAULT_MAX_HISTORY_ENTRIES = 64;

/** Validates scope ids (non-empty, NUL-free) on every path. */
export function assertScopeValid(accountId: string, providerId: string): void {
  const badAccount = accountId.length === 0 || accountId.includes("\u0000");
  const badProvider = providerId.length === 0 || providerId.includes("\u0000");
  if (badAccount || badProvider) {
    throw new ConnectionScopeInvalidError(accountId, providerId);
  }
}

/** The composite scope key. */
function scopeKey(accountId: string, providerId: string): string {
  return `${accountId}\u0000${providerId}`;
}

/** Deep-clone helper (structuredClone: values are JSON-safe documents). */
function clone<T>(value: T): T {
  return structuredClone(value);
}

// ---------------------------------------------------------------------------
// The in-memory implementation
// ---------------------------------------------------------------------------

/**
 * The in-memory connection store: the test/ephemeral substrate. Honest
 * counters, deep-clone-on-read/write, the same conflict/limit/integrity
 * semantics as the sqlite implementation (they share the validation path).
 */
export class InMemoryConnectionStore implements ConnectionStore {
  private readonly records = new Map<string, ConnectionRecord>();
  private readonly audit: ConnectionAuditEntry[] = [];
  private readonly maxRecords: number;
  private readonly maxAuditEntries: number;
  private readonly maxHistoryEntries: number;
  private readonly nowMs: () => number;
  private duplicatePuts = 0;
  private updates = 0;
  private deletes = 0;
  private integrityChecksPassed = 0;
  private closed = false;

  constructor(options: ConnectionStoreOptions = {}) {
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.maxAuditEntries = options.maxAuditEntries ?? DEFAULT_MAX_AUDIT_ENTRIES;
    this.maxHistoryEntries = options.maxHistoryEntries ?? DEFAULT_MAX_HISTORY_ENTRIES;
    this.nowMs = options.nowMs ?? createDeterministicStoreClock();
  }

  private guardOpen(): void {
    if (this.closed) throw new ConnectionStoreError("the connection store is closed");
  }

  private validateRecord(record: ConnectionRecord): void {
    const parsed = ConnectionRecordSchema.safeParse(record);
    if (!parsed.success) {
      throw new ConnectionStoreIntegrityError(
        record.accountId,
        record.providerId,
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }
    if (record.history.length > this.maxHistoryEntries) {
      throw new ConnectionStoreLimitError(
        "record.history",
        this.maxHistoryEntries,
        record.history.length,
      );
    }
    this.integrityChecksPassed += 1;
  }

  async insertRecord(record: ConnectionRecord): Promise<InsertOutcome> {
    this.guardOpen();
    assertScopeValid(record.accountId, record.providerId);
    this.validateRecord(record);
    const key = scopeKey(record.accountId, record.providerId);
    const existing = this.records.get(key);
    if (existing !== undefined) {
      const existingFp = existing.credential?.fingerprint ?? null;
      const presentedFp = record.credential?.fingerprint ?? null;
      if (existingFp === presentedFp) {
        this.duplicatePuts += 1;
        return {
          disposition: "duplicate",
          record: clone(existing),
          duplicates: this.duplicatePuts,
        };
      }
      throw new ConnectionConflictError({
        accountId: record.accountId,
        providerId: record.providerId,
        existingFingerprint: existingFp,
        presentedFingerprint: presentedFp,
      });
    }
    if (this.records.size >= this.maxRecords) {
      throw new ConnectionStoreLimitError("records", this.maxRecords, this.records.size);
    }
    this.records.set(key, clone(record));
    return { disposition: "created", record: clone(record) };
  }

  async updateRecord(record: ConnectionRecord): Promise<UpdateOutcome> {
    this.guardOpen();
    assertScopeValid(record.accountId, record.providerId);
    this.validateRecord(record);
    const key = scopeKey(record.accountId, record.providerId);
    const existing = this.records.get(key);
    if (existing === undefined) {
      throw new ConnectionRecordAbsentError(record.accountId, record.providerId);
    }
    if (record.revision !== existing.revision + 1) {
      throw new ConnectionStaleWriteError(record.accountId, record.providerId, record.revision);
    }
    if (
      existing.credential?.fingerprint !== record.credential?.fingerprint ||
      existing.credential?.kind !== record.credential?.kind
    ) {
      // The update path never replaces a credential (that is connect's
      // conflict-checked job).
      throw new ConnectionConflictError({
        accountId: record.accountId,
        providerId: record.providerId,
        existingFingerprint: existing.credential?.fingerprint ?? null,
        presentedFingerprint: record.credential?.fingerprint ?? null,
      });
    }
    this.records.set(key, clone(record));
    this.updates += 1;
    return { disposition: "updated", record: clone(record) };
  }

  async findRecord(accountId: string, providerId: string): Promise<ConnectionRecord | null> {
    this.guardOpen();
    assertScopeValid(accountId, providerId);
    const record = this.records.get(scopeKey(accountId, providerId));
    if (record === undefined) return null;
    this.validateRecord(record);
    return clone(record);
  }

  async listRecords(accountId: string): Promise<ConnectionRecord[]> {
    this.guardOpen();
    assertScopeValid(accountId, "list-scope");
    const out: ConnectionRecord[] = [];
    for (const record of this.records.values()) {
      if (record.accountId === accountId) {
        this.validateRecord(record);
        out.push(clone(record));
      }
    }
    return out;
  }

  async deleteRecord(accountId: string, providerId: string): Promise<ConnectionRecord | null> {
    this.guardOpen();
    assertScopeValid(accountId, providerId);
    const key = scopeKey(accountId, providerId);
    const record = this.records.get(key);
    if (record === undefined) return null;
    this.records.delete(key);
    this.deletes += 1;
    return clone(record);
  }

  async appendAudit(entry: ConnectionAuditEntry): Promise<void> {
    this.guardOpen();
    assertScopeValid(entry.accountId, entry.providerId);
    const parsed = ConnectionAuditEntry.safeParse(entry);
    if (!parsed.success) {
      throw new ConnectionStoreIntegrityError(
        entry.accountId,
        entry.providerId,
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }
    if (this.audit.length >= this.maxAuditEntries) {
      throw new ConnectionStoreLimitError("auditEntries", this.maxAuditEntries, this.audit.length);
    }
    this.audit.push(clone(entry));
    this.integrityChecksPassed += 1;
  }

  async listAudit(accountId: string, limit: number = 100): Promise<ConnectionAuditEntry[]> {
    this.guardOpen();
    assertScopeValid(accountId, "audit-scope");
    const out: ConnectionAuditEntry[] = [];
    for (let i = this.audit.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const entry = this.audit[i]!;
      if (entry.accountId === accountId) out.push(clone(entry));
    }
    return out;
  }

  stats(): ConnectionStoreStats {
    this.guardOpen();
    return {
      records: this.records.size,
      auditEntries: this.audit.length,
      duplicatePuts: this.duplicatePuts,
      updates: this.updates,
      deletes: this.deletes,
      integrityChecksPassed: this.integrityChecksPassed,
    };
  }

  close(): void {
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// The sqlite implementation
// ---------------------------------------------------------------------------

/**
 * The durable connection store (`bun:sqlite`): same semantics as the
 * in-memory store (shared validation path), plus idempotent DDL, an
 * idempotent `close()`, and integrity re-validation of every row read back.
 * The constructor takes a file path or an already-open `Database`.
 */
export class SqliteConnectionStore implements ConnectionStore {
  private readonly db: Database;
  private readonly ownsDb: boolean;
  private readonly maxRecords: number;
  private readonly maxAuditEntries: number;
  private readonly maxHistoryEntries: number;
  private readonly nowMs: () => number;
  private duplicatePuts = 0;
  private updates = 0;
  private deletes = 0;
  private integrityChecksPassed = 0;
  private closed = false;

  constructor(target: string | Database, options: ConnectionStoreOptions = {}) {
    this.db = typeof target === "string" ? new Database(target) : target;
    this.ownsDb = typeof target === "string";
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.maxAuditEntries = options.maxAuditEntries ?? DEFAULT_MAX_AUDIT_ENTRIES;
    this.maxHistoryEntries = options.maxHistoryEntries ?? DEFAULT_MAX_HISTORY_ENTRIES;
    this.nowMs = options.nowMs ?? createDeterministicStoreClock();
    this.applyDdl();
  }

  /** Idempotent DDL (the W004 precedent). */
  private applyDdl(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS connection_records (
        scope TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        written_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS connection_records_account
        ON connection_records (account_id);
      CREATE TABLE IF NOT EXISTS connection_audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS connection_audit_account
        ON connection_audit (account_id, seq);
    `);
  }

  private guardOpen(): void {
    if (this.closed) throw new ConnectionStoreError("the connection store is closed");
  }

  /** Validates + re-parses a stored payload (integrity on read AND write). */
  private parsePayload(accountId: string, providerId: string, payload: string): ConnectionRecord {
    let raw: unknown;
    try {
      raw = JSON.parse(payload);
    } catch (error) {
      throw new ConnectionStoreIntegrityError(
        accountId,
        providerId,
        `payload is not JSON (${String(error)})`,
      );
    }
    const parsed = ConnectionRecordSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectionStoreIntegrityError(
        accountId,
        providerId,
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }
    const record = parsed.data;
    if (record.accountId !== accountId || record.providerId !== providerId) {
      throw new ConnectionStoreIntegrityError(
        accountId,
        providerId,
        "payload scope does not match its row (key-space ambiguity)",
      );
    }
    if (record.history.length > this.maxHistoryEntries) {
      throw new ConnectionStoreLimitError(
        "record.history",
        this.maxHistoryEntries,
        record.history.length,
      );
    }
    this.integrityChecksPassed += 1;
    return record;
  }

  async insertRecord(record: ConnectionRecord): Promise<InsertOutcome> {
    this.guardOpen();
    assertScopeValid(record.accountId, record.providerId);
    const validated = this.parsePayload(
      record.accountId,
      record.providerId,
      JSON.stringify(record),
    );
    const key = scopeKey(record.accountId, record.providerId);
    const existing = this.readRow(key);
    if (existing !== null) {
      const existingFp = existing.credential?.fingerprint ?? null;
      const presentedFp = validated.credential?.fingerprint ?? null;
      if (existingFp === presentedFp) {
        this.duplicatePuts += 1;
        return { disposition: "duplicate", record: existing, duplicates: this.duplicatePuts };
      }
      throw new ConnectionConflictError({
        accountId: record.accountId,
        providerId: record.providerId,
        existingFingerprint: existingFp,
        presentedFingerprint: presentedFp,
      });
    }
    const count = this.db.query("SELECT COUNT(*) AS n FROM connection_records").get() as {
      n: number;
    };
    if (count.n >= this.maxRecords) {
      throw new ConnectionStoreLimitError("records", this.maxRecords, count.n);
    }
    this.db
      .query(
        "INSERT INTO connection_records (scope, account_id, provider_id, revision, payload, written_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        key,
        record.accountId,
        record.providerId,
        record.revision,
        JSON.stringify(record),
        this.nowMs(),
      );
    return { disposition: "created", record: validated };
  }

  async updateRecord(record: ConnectionRecord): Promise<UpdateOutcome> {
    this.guardOpen();
    assertScopeValid(record.accountId, record.providerId);
    const validated = this.parsePayload(
      record.accountId,
      record.providerId,
      JSON.stringify(record),
    );
    const key = scopeKey(record.accountId, record.providerId);
    const existing = this.readRow(key);
    if (existing === null) {
      throw new ConnectionRecordAbsentError(record.accountId, record.providerId);
    }
    if (record.revision !== existing.revision + 1) {
      throw new ConnectionStaleWriteError(record.accountId, record.providerId, record.revision);
    }
    if (
      existing.credential?.fingerprint !== validated.credential?.fingerprint ||
      existing.credential?.kind !== validated.credential?.kind
    ) {
      throw new ConnectionConflictError({
        accountId: record.accountId,
        providerId: record.providerId,
        existingFingerprint: existing.credential?.fingerprint ?? null,
        presentedFingerprint: validated.credential?.fingerprint ?? null,
      });
    }
    const result = this.db
      .query(
        "UPDATE connection_records SET revision = ?, payload = ?, written_at_ms = ? WHERE scope = ? AND revision = ?",
      )
      .run(record.revision, JSON.stringify(record), this.nowMs(), key, existing.revision);
    if (result.changes !== 1) {
      throw new ConnectionStaleWriteError(record.accountId, record.providerId, record.revision);
    }
    this.updates += 1;
    return { disposition: "updated", record: validated };
  }

  private readRow(key: string): ConnectionRecord | null {
    const row = this.db
      .query("SELECT account_id, provider_id, payload FROM connection_records WHERE scope = ?")
      .get(key) as { account_id: string; provider_id: string; payload: string } | null;
    if (row === null) return null;
    return this.parsePayload(row.account_id, row.provider_id, row.payload);
  }

  async findRecord(accountId: string, providerId: string): Promise<ConnectionRecord | null> {
    this.guardOpen();
    assertScopeValid(accountId, providerId);
    return this.readRow(scopeKey(accountId, providerId));
  }

  async listRecords(accountId: string): Promise<ConnectionRecord[]> {
    this.guardOpen();
    assertScopeValid(accountId, "list-scope");
    const rows = this.db
      .query(
        "SELECT account_id, provider_id, payload FROM connection_records WHERE account_id = ? ORDER BY provider_id",
      )
      .all(accountId) as Array<{ account_id: string; provider_id: string; payload: string }>;
    return rows.map((row) => this.parsePayload(row.account_id, row.provider_id, row.payload));
  }

  async deleteRecord(accountId: string, providerId: string): Promise<ConnectionRecord | null> {
    this.guardOpen();
    assertScopeValid(accountId, providerId);
    const key = scopeKey(accountId, providerId);
    const existing = this.readRow(key);
    if (existing === null) return null;
    this.db.query("DELETE FROM connection_records WHERE scope = ?").run(key);
    this.deletes += 1;
    return existing;
  }

  async appendAudit(entry: ConnectionAuditEntry): Promise<void> {
    this.guardOpen();
    assertScopeValid(entry.accountId, entry.providerId);
    const parsed = ConnectionAuditEntry.safeParse(entry);
    if (!parsed.success) {
      throw new ConnectionStoreIntegrityError(
        entry.accountId,
        entry.providerId,
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }
    const count = this.db.query("SELECT COUNT(*) AS n FROM connection_audit").get() as {
      n: number;
    };
    if (count.n >= this.maxAuditEntries) {
      throw new ConnectionStoreLimitError("auditEntries", this.maxAuditEntries, count.n);
    }
    this.db
      .query("INSERT INTO connection_audit (account_id, provider_id, payload) VALUES (?, ?, ?)")
      .run(entry.accountId, entry.providerId, JSON.stringify(entry));
    this.integrityChecksPassed += 1;
  }

  async listAudit(accountId: string, limit: number = 100): Promise<ConnectionAuditEntry[]> {
    this.guardOpen();
    assertScopeValid(accountId, "audit-scope");
    const rows = this.db
      .query("SELECT payload FROM connection_audit WHERE account_id = ? ORDER BY seq DESC LIMIT ?")
      .all(accountId, limit) as Array<{ payload: string }>;
    const out: ConnectionAuditEntry[] = [];
    for (const row of rows) {
      let raw: unknown;
      try {
        raw = JSON.parse(row.payload);
      } catch (error) {
        throw new ConnectionStoreIntegrityError(
          accountId,
          "unknown",
          `audit payload is not JSON (${String(error)})`,
        );
      }
      const parsed = ConnectionAuditEntry.safeParse(raw);
      if (!parsed.success) {
        throw new ConnectionStoreIntegrityError(
          accountId,
          "unknown",
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        );
      }
      out.push(parsed.data);
    }
    return out;
  }

  stats(): ConnectionStoreStats {
    this.guardOpen();
    const records = this.db.query("SELECT COUNT(*) AS n FROM connection_records").get() as {
      n: number;
    };
    const auditEntries = this.db.query("SELECT COUNT(*) AS n FROM connection_audit").get() as {
      n: number;
    };
    return {
      records: records.n,
      auditEntries: auditEntries.n,
      duplicatePuts: this.duplicatePuts,
      updates: this.updates,
      deletes: this.deletes,
      integrityChecksPassed: this.integrityChecksPassed,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ownsDb) this.db.close();
  }
}

// ---------------------------------------------------------------------------
// The deterministic default clock
// ---------------------------------------------------------------------------

/** Deterministic per-store clock: `TEST_EPOCH_MS + ticks` (W003 posture). */
export function createDeterministicStoreClock(): () => number {
  let ticks = 0;
  return (): number => 1_700_000_000_000 + (ticks += 1);
}
