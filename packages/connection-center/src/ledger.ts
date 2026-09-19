/**
 * THE BYOC USAGE LEDGER (R408): transparent per-(account, provider, job)
 * usage records for connected user-owned providers — the W919
 * guardrail-posture substrate ("provider usage counters, user/job quotas,
 * spend alarms and fail-closed admission exist" — the counters half is
 * THIS; the fail-closed admission half is the R409 managed seam).
 *
 * ## Honesty rules (the R408 deliverable, restated)
 *
 * - The usage vocabulary is the W914 `ComputeUsageRecord` VERBATIM
 *   (imported, never forked): wall-clock timing (`queueWaitMs`,
 *   `executionMs`), exit states (`terminalDisposition`), counts
 *   (`attempts`, `claims`), and cost quantities in the units the
 *   adapter's descriptor declared. The ledger adds the ACCOUNT dimension
 *   and the RESPONSIBILITY boundary (`user-owned-provider` vs
 *   `sporta-managed`) — data the W914 record legitimately lacks;
 * - UNKNOWN quantities stay `null` — a BYOC provider's price is not
 *   known to Sporta, so `summary().spendUsd` is HONESTLY `null`, never a
 *   fabricated number (the R401 quote posture, applied to accounting);
 * - every record is idempotent per (account, provider, job): re-recording
 *   the SAME record is a counted no-op; recording a DIFFERENT record for
 *   the same key is a fail-loud `LedgerConflictError` (a job's usage is
 *   never silently replaced);
 * - the store follows the W004 repository patterns exactly (the
 *   connection-store precedent: port + in-memory + sqlite, validation on
 *   write AND read with `LedgerIntegrityError`, deep-clone-on-read/write,
 *   NUL-free scope guards, bounded with explicit limit errors, never
 *   silent eviction).
 */
import { Database } from "bun:sqlite";
import { z } from "zod";
import type { ComputeAdapterPort } from "@sporta/compute-adapter";
import { ComputeUsageRecord } from "@sporta/compute-adapter";
import type {
  ComputeTerminalDisposition,
  ComputeUsageRecord as UsageRecordDoc,
} from "@sporta/compute-adapter";
import { CONNECTION_SCHEMA_VERSION } from "./schema";

// ---------------------------------------------------------------------------
// The responsibility boundary (the R408 "responsibility boundaries" axis)
// ---------------------------------------------------------------------------

/** Whose compute executed the job (closed vocabulary — data on the record). */
export const EXECUTION_OWNERSHIPS = [
  /** The user's connected provider (bring-your-own-compute). */
  "user-owned-provider",
  /** Sporta-managed infrastructure (the R409 managed plane). */
  "sporta-managed",
] as const;
export type ExecutionOwnership = (typeof EXECUTION_OWNERSHIPS)[number];

// ---------------------------------------------------------------------------
// The BYOC usage record
// ---------------------------------------------------------------------------

/**
 * One account-scoped usage record: the W914 usage record VERBATIM plus
 * the account and responsibility dimensions. `.strict()` — a future field
 * is a schema change, never a silent rider.
 */
export const ByocUsageRecord = z
  .object({
    schemaVersion: z.literal(CONNECTION_SCHEMA_VERSION),
    accountId: z.string().min(1),
    /** The provider-plane id (DATA — which provider executed). */
    providerId: z.string().min(1),
    /** Whose compute executed (the responsibility boundary). */
    executionOwnership: z.enum(EXECUTION_OWNERSHIPS),
    /** The W914 usage record, VERBATIM (zod-validated on write and read). */
    usage: ComputeUsageRecord,
    /** When the ledger recorded this entry (the injected ledger clock). */
    recordedAtMs: z.number().finite().min(0),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.usage.jobId.length === 0) {
      ctx.addIssue({ code: "custom", path: ["usage", "jobId"], message: "jobId is never empty" });
    }
  });
export type ByocUsageRecord = z.infer<typeof ByocUsageRecord>;

// ---------------------------------------------------------------------------
// The store port + typed errors (the W004 repository seam)
// ---------------------------------------------------------------------------

/** The disposition of a `put` call. */
export type LedgerPutOutcome =
  | { disposition: "recorded"; record: ByocUsageRecord }
  | { disposition: "duplicate"; record: ByocUsageRecord; duplicates: number };

/** The honest store counters. */
export interface ByocLedgerStoreStats {
  records: number;
  duplicatePuts: number;
  integrityChecksPassed: number;
}

/** Base class for the typed ledger errors (all fail-loud). */
export class ByocLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ByocLedgerError";
  }
}

/** A scope id carried a NUL. */
export class ByocLedgerScopeInvalidError extends ByocLedgerError {
  constructor(scope: string) {
    super(
      `ledger scope ids must be non-empty and NUL-free (got '${scope.replaceAll("\u0000", "\\0")}')`,
    );
    this.name = "ByocLedgerScopeInvalidError";
  }
}

/** A record failed (re-)validation — corrupted storage fails loudly. */
export class ByocLedgerIntegrityError extends ByocLedgerError {
  constructor(scope: string, issues: string) {
    super(
      `ledger record '${scope.replaceAll("\u0000", "\\0")}' failed integrity re-validation: ${issues}`,
    );
    this.name = "ByocLedgerIntegrityError";
  }
}

/** A different usage record arrived for an already-recorded job. */
export class ByocLedgerConflictError extends ByocLedgerError {
  readonly accountId: string;
  readonly providerId: string;
  readonly jobId: string;

  constructor(options: { accountId: string; providerId: string; jobId: string }) {
    super(
      `usage for (account '${options.accountId}', provider '${options.providerId}', job '${options.jobId}') is already recorded — a job's usage is never silently replaced (drain raced, or a job id was reused)`,
    );
    this.name = "ByocLedgerConflictError";
    this.accountId = options.accountId;
    this.providerId = options.providerId;
    this.jobId = options.jobId;
  }
}

/** A bound was exceeded (never silent eviction). */
export class ByocLedgerLimitError extends ByocLedgerError {
  constructor(limit: number, current: number) {
    super(`ledger record bound exceeded: ${current} > ${limit} (never silently evicted)`);
    this.name = "ByocLedgerLimitError";
  }
}

/** Options shared by both store implementations. */
export interface ByocLedgerStoreOptions {
  /** Bound on stored records (default 1_000_000 — the W303 magnitude). */
  maxRecords?: number;
  /** Clock in epoch ms (default: deterministic `TEST_EPOCH_MS + ticks`). */
  nowMs?: () => number;
}

export const DEFAULT_MAX_LEDGER_RECORDS = 1_000_000;

/** The BYOC ledger store port (the W004 repository seam). */
export interface ByocLedgerStore {
  /** Puts one record (idempotent per key; conflicts fail loudly). */
  putRecord(record: ByocUsageRecord): Promise<LedgerPutOutcome>;
  /** Finds one record (deep-cloned; `null` when absent). */
  findRecord(accountId: string, providerId: string, jobId: string): Promise<ByocUsageRecord | null>;
  /** Lists one account's records (deep-cloned; filters optional). */
  listRecords(
    accountId: string,
    filter?: { providerId?: string; sinceRecordedAtMs?: number },
  ): Promise<ByocUsageRecord[]>;
  /** The honest counters. */
  stats(): ByocLedgerStoreStats;
  /** Closes the store (idempotent). */
  close(): void;
}

// ---------------------------------------------------------------------------
// Shared guards
// ---------------------------------------------------------------------------

/** Scope validation + the composite key. */
function ledgerKey(accountId: string, providerId: string, jobId: string): string {
  for (const part of [accountId, providerId, jobId]) {
    if (part.length === 0 || part.includes("\u0000")) {
      throw new ByocLedgerScopeInvalidError(part);
    }
  }
  return `${accountId}\u0000${providerId}\u0000${jobId}`;
}

/** Validates one record (the shared write/read integrity path). */
function validateRecord(record: ByocUsageRecord): ByocUsageRecord {
  const parsed = ByocUsageRecord.safeParse(record);
  if (!parsed.success) {
    throw new ByocLedgerIntegrityError(
      `${record.accountId}\u0000${record.providerId}\u0000${record.usage.jobId}`,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// The in-memory implementation
// ---------------------------------------------------------------------------

/** The in-memory BYOC ledger store (test/ephemeral substrate). */
export class InMemoryByocLedgerStore implements ByocLedgerStore {
  private readonly records = new Map<string, ByocUsageRecord>();
  private readonly maxRecords: number;
  private duplicatePuts = 0;
  private integrityChecksPassed = 0;
  private closed = false;

  constructor(options: ByocLedgerStoreOptions = {}) {
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_LEDGER_RECORDS;
  }

  private guardOpen(): void {
    if (this.closed) throw new ByocLedgerError("the ledger store is closed");
  }

  async putRecord(record: ByocUsageRecord): Promise<LedgerPutOutcome> {
    this.guardOpen();
    const key = ledgerKey(record.accountId, record.providerId, record.usage.jobId);
    const validated = validateRecord(record);
    const existing = this.records.get(key);
    if (existing !== undefined) {
      // Idempotent: the SAME record is a counted no-op; a DIFFERENT one
      // for the same job is a conflict (never silently replaced).
      if (JSON.stringify(existing) === JSON.stringify(validated)) {
        this.duplicatePuts += 1;
        return {
          disposition: "duplicate",
          record: structuredClone(existing),
          duplicates: this.duplicatePuts,
        };
      }
      throw new ByocLedgerConflictError({
        accountId: record.accountId,
        providerId: record.providerId,
        jobId: record.usage.jobId,
      });
    }
    if (this.records.size >= this.maxRecords) {
      throw new ByocLedgerLimitError(this.maxRecords, this.records.size);
    }
    this.records.set(key, structuredClone(validated));
    this.integrityChecksPassed += 1;
    return { disposition: "recorded", record: structuredClone(validated) };
  }

  async findRecord(
    accountId: string,
    providerId: string,
    jobId: string,
  ): Promise<ByocUsageRecord | null> {
    this.guardOpen();
    const record = this.records.get(ledgerKey(accountId, providerId, jobId));
    if (record === undefined) return null;
    return structuredClone(validateRecord(record));
  }

  async listRecords(
    accountId: string,
    filter?: { providerId?: string; sinceRecordedAtMs?: number },
  ): Promise<ByocUsageRecord[]> {
    this.guardOpen();
    const out: ByocUsageRecord[] = [];
    for (const record of this.records.values()) {
      if (record.accountId !== accountId) continue;
      if (filter?.providerId !== undefined && record.providerId !== filter.providerId) continue;
      if (filter?.sinceRecordedAtMs !== undefined && record.recordedAtMs < filter.sinceRecordedAtMs)
        continue;
      out.push(structuredClone(validateRecord(record)));
    }
    return out;
  }

  stats(): ByocLedgerStoreStats {
    this.guardOpen();
    return {
      records: this.records.size,
      duplicatePuts: this.duplicatePuts,
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

/** The durable BYOC ledger store (`bun:sqlite`). */
export class SqliteByocLedgerStore implements ByocLedgerStore {
  private readonly db: Database;
  private readonly ownsDb: boolean;
  private readonly maxRecords: number;
  private duplicatePuts = 0;
  private integrityChecksPassed = 0;
  private closed = false;

  constructor(target: string | Database, options: ByocLedgerStoreOptions = {}) {
    this.db = typeof target === "string" ? new Database(target) : target;
    this.ownsDb = typeof target === "string";
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_LEDGER_RECORDS;
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS byoc_usage_records (
        ledger_key TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        recorded_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS byoc_usage_records_account
        ON byoc_usage_records (account_id, recorded_at_ms);
    `);
  }

  private guardOpen(): void {
    if (this.closed) throw new ByocLedgerError("the ledger store is closed");
  }

  private parseRow(row: { ledger_key: string; payload: string }): ByocUsageRecord {
    let raw: unknown;
    try {
      raw = JSON.parse(row.payload);
    } catch (error) {
      throw new ByocLedgerIntegrityError(row.ledger_key, `payload is not JSON (${String(error)})`);
    }
    const parsed = ByocUsageRecord.safeParse(raw);
    if (!parsed.success) {
      throw new ByocLedgerIntegrityError(
        row.ledger_key,
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }
    this.integrityChecksPassed += 1;
    return parsed.data;
  }

  async putRecord(record: ByocUsageRecord): Promise<LedgerPutOutcome> {
    this.guardOpen();
    const key = ledgerKey(record.accountId, record.providerId, record.usage.jobId);
    const validated = validateRecord(record);
    const payload = JSON.stringify(validated);
    const existingRow = this.db
      .query("SELECT ledger_key, payload FROM byoc_usage_records WHERE ledger_key = ?")
      .get(key) as { ledger_key: string; payload: string } | null;
    if (existingRow !== null) {
      const existing = this.parseRow(existingRow);
      if (JSON.stringify(existing) === payload) {
        this.duplicatePuts += 1;
        return { disposition: "duplicate", record: existing, duplicates: this.duplicatePuts };
      }
      throw new ByocLedgerConflictError({
        accountId: record.accountId,
        providerId: record.providerId,
        jobId: record.usage.jobId,
      });
    }
    const count = this.db.query("SELECT COUNT(*) AS n FROM byoc_usage_records").get() as {
      n: number;
    };
    if (count.n >= this.maxRecords) {
      throw new ByocLedgerLimitError(this.maxRecords, count.n);
    }
    this.db
      .query(
        "INSERT INTO byoc_usage_records (ledger_key, account_id, provider_id, job_id, payload, recorded_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        key,
        record.accountId,
        record.providerId,
        record.usage.jobId,
        payload,
        record.recordedAtMs,
      );
    return { disposition: "recorded", record: validated };
  }

  async findRecord(
    accountId: string,
    providerId: string,
    jobId: string,
  ): Promise<ByocUsageRecord | null> {
    this.guardOpen();
    const key = ledgerKey(accountId, providerId, jobId);
    const row = this.db
      .query("SELECT ledger_key, payload FROM byoc_usage_records WHERE ledger_key = ?")
      .get(key) as { ledger_key: string; payload: string } | null;
    return row === null ? null : this.parseRow(row);
  }

  async listRecords(
    accountId: string,
    filter?: { providerId?: string; sinceRecordedAtMs?: number },
  ): Promise<ByocUsageRecord[]> {
    this.guardOpen();
    const rows = this.db
      .query(
        "SELECT ledger_key, payload FROM byoc_usage_records WHERE account_id = ? AND (? IS NULL OR provider_id = ?) AND (? IS NULL OR recorded_at_ms >= ?) ORDER BY recorded_at_ms, ledger_key",
      )
      .all(
        accountId,
        filter?.providerId ?? null,
        filter?.providerId ?? null,
        filter?.sinceRecordedAtMs ?? null,
        filter?.sinceRecordedAtMs ?? null,
      ) as Array<{ ledger_key: string; payload: string }>;
    return rows.map((row) => this.parseRow(row));
  }

  stats(): ByocLedgerStoreStats {
    this.guardOpen();
    const count = this.db.query("SELECT COUNT(*) AS n FROM byoc_usage_records").get() as {
      n: number;
    };
    return {
      records: count.n,
      duplicatePuts: this.duplicatePuts,
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
// The ledger service (the R408 product surface)
// ---------------------------------------------------------------------------

/** The honest per-account usage summary (unknowns stay `null`). */
export interface UsageSummary {
  schemaVersion: "1.0";
  accountId: string;
  /** Optional provider filter the summary was computed over. */
  providerId?: string;
  /** Job counts per terminal disposition (the W914 exit states). */
  jobs: { total: number; perDisposition: Record<ComputeTerminalDisposition, number> };
  /** Totals over the W914 timing envelope (measured, never invented). */
  timing: { totalExecutionMs: number; totalQueueWaitMs: number };
  /** Metered cost quantities aggregated per declared unit id. */
  costUnits: Array<{ unitId: string; totalQuantity: number; jobs: number }>;
  /**
   * Estimated spend in USD — HONESTLY `null`: a BYOC provider's price is
   * not known to Sporta (the adapters meter abstract units; the provider
   * bills in its own currency). Never a fabricated number.
   */
  spendUsd: null;
}

/** Options for {@link UsageLedger}. */
export interface UsageLedgerOptions {
  /** The store (default: in-memory). */
  store?: ByocLedgerStore;
  /** The injected ledger clock (REQUIRED). */
  nowMs: () => number;
}

/** What one `record` call answered. */
export type RecordOutcome = LedgerPutOutcome;

/**
 * THE BYOC usage ledger (R408): the transparent accounting surface. The
 * metering TOTALITY posture rides the W914 seam (exactly one usage record
 * per terminally-disposed job, drained from the adapter); this ledger
 * makes those records ACCOUNT-SCOPED, responsibility-labeled, queryable,
 * and idempotently durable.
 */
export class UsageLedger {
  private readonly store: ByocLedgerStore;
  private readonly nowMs: () => number;

  constructor(options: UsageLedgerOptions) {
    this.store = options.store ?? new InMemoryByocLedgerStore();
    this.nowMs = options.nowMs;
  }

  /**
   * Records one usage record for one (account, provider, job):
   * zod-validates the W914 record verbatim, stamps the ledger clock, and
   * puts it idempotently — the W914 DOCUMENT is the identity (an
   * identical re-record is a counted duplicate regardless of the ledger
   * stamp; a DIFFERENT document for the same job conflicts fail-loudly).
   */
  async record(
    accountId: string,
    providerId: string,
    executionOwnership: ExecutionOwnership,
    usage: UsageRecordDoc,
  ): Promise<RecordOutcome> {
    // Idempotency short-circuit: an identical W914 document already
    // recorded re-records as the ORIGINAL (counted duplicate — the
    // ledger stamp is the ledger's own, never the job's identity).
    const existing = await this.store.findRecord(accountId, providerId, usage.jobId);
    if (
      existing !== null &&
      existing.executionOwnership === executionOwnership &&
      JSON.stringify(existing.usage) === JSON.stringify(usage)
    ) {
      return this.store.putRecord(existing);
    }
    const record: ByocUsageRecord = {
      schemaVersion: CONNECTION_SCHEMA_VERSION,
      accountId,
      providerId,
      executionOwnership,
      usage,
      recordedAtMs: this.nowMs(),
    };
    return this.store.putRecord(record);
  }

  /**
   * Drains an adapter's metering surface into the ledger: every usage
   * record `adapter.usage()` answers is recorded (idempotently — a
   * re-drain is all-duplicates, counted). This is the W914 "metering
   * drain" composed with the R408 account dimension.
   */
  async drain(
    accountId: string,
    providerId: string,
    executionOwnership: ExecutionOwnership,
    adapter: ComputeAdapterPort,
  ): Promise<{ recorded: number; duplicates: number }> {
    const usages = await adapter.usage();
    let recorded = 0;
    let duplicates = 0;
    for (const usage of usages) {
      const outcome = await this.record(accountId, providerId, executionOwnership, usage);
      if (outcome.disposition === "recorded") recorded += 1;
      else duplicates += 1;
    }
    return { recorded, duplicates };
  }

  /** One job's record (or `null`). */
  async perJob(
    accountId: string,
    providerId: string,
    jobId: string,
  ): Promise<ByocUsageRecord | null> {
    return this.store.findRecord(accountId, providerId, jobId);
  }

  /** The account's records (optionally per provider / since a stamp). */
  async history(
    accountId: string,
    filter?: { providerId?: string; sinceRecordedAtMs?: number },
  ): Promise<ByocUsageRecord[]> {
    return this.store.listRecords(accountId, filter);
  }

  /**
   * The honest per-account summary: W914 exit-state counts, measured
   * timing totals, metered cost-unit totals — and `spendUsd: null`
   * (a BYOC provider's price is unknowable here; never fabricated).
   */
  async summary(accountId: string, providerId?: string): Promise<UsageSummary> {
    const records = await this.store.listRecords(
      accountId,
      providerId !== undefined ? { providerId } : undefined,
    );
    const perDisposition: Record<ComputeTerminalDisposition, number> = {
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      "dead-lettered": 0,
    };
    let totalExecutionMs = 0;
    let totalQueueWaitMs = 0;
    const unitTotals = new Map<string, { totalQuantity: number; jobs: number }>();
    for (const record of records) {
      perDisposition[record.usage.terminalDisposition] += 1;
      totalExecutionMs += record.usage.timing.executionMs;
      totalQueueWaitMs += record.usage.timing.queueWaitMs;
      for (const unit of record.usage.costUnits) {
        const existing = unitTotals.get(unit.unitId) ?? { totalQuantity: 0, jobs: 0 };
        existing.totalQuantity += unit.quantity;
        existing.jobs += 1;
        unitTotals.set(unit.unitId, existing);
      }
    }
    const total =
      perDisposition.succeeded +
      perDisposition.failed +
      perDisposition.cancelled +
      perDisposition["dead-lettered"];
    return {
      schemaVersion: CONNECTION_SCHEMA_VERSION,
      accountId,
      ...(providerId !== undefined ? { providerId } : {}),
      jobs: { total, perDisposition },
      timing: { totalExecutionMs, totalQueueWaitMs },
      costUnits: [...unitTotals.entries()]
        .map(([unitId, totals]) => ({ unitId, ...totals }))
        .sort((a, b) => (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0)),
      spendUsd: null,
    };
  }

  /** The honest store counters. */
  storeStats(): ByocLedgerStoreStats {
    return this.store.stats();
  }

  /** The store (for durable runs' lifecycle). */
  get backingStore(): ByocLedgerStore {
    return this.store;
  }
}
