/**
 * THE MANAGED COMPUTE SEAM (R409): the provider-INDEPENDENT allowance and
 * concurrency controls that prepare product-plan (Sporta managed compute)
 * functionality WITHOUT coupling to any specific infrastructure provider.
 *
 * ## What "provider-independent" means here, precisely
 *
 * - the seam composes the FROZEN R401 `ComputeBrokerPort` (dispatch
 *   delegates VERBATIM — the seam adds no execution semantics);
 * - allowances are declared in ABSTRACT units (unitIds like `compute-ms`
 *   or `jobs` — the W914 descriptor-cost-unit vocabulary), never a vendor
 *   currency, never a provider name;
 * - refusals REUSE the R401 closed vocabulary verbatim: every admission
 *   refusal is `quota-exhausted` (the one member that means "a bounded
 *   resource refused the job") carried as typed DATA — no new reason
 *   string is invented, and no provider id appears in any contract
 *   member (test-pinned);
 * - usage settlement consumes the W914 `ComputeUsageRecord` VALUES (the
 *   metering-drain vocabulary) and records them in the R408 BYOC usage
 *   ledger with the `sporta-managed` responsibility label.
 *
 * ## The W919 guardrail posture (fail-closed, by construction)
 *
 * - **Admission fails closed**: no entitlement, an exhausted allowance, a
 *   spent period, or a full concurrency slot → the typed
 *   {@link ManagedAdmissionRefusalError} BEFORE any dispatch (a job is
 *   never admitted on hope);
 * - admission checks what is KNOWABLE at admission time (the `jobs`
 *   count-unit and the concurrency bound); `compute-ms`-style quantities
 *   are metered at SETTLEMENT and fail-close the NEXT admission once the
 *   limit is reached (the honest one-step-late guardrail — documented,
 *   never hidden, never silently over);
 * - **spend alarms**: settlement emits threshold-alarm events (the policy's
 *   `alarmThresholds` — the W919 "spend alarms") whenever a unit's
 *   consumption crosses a fraction of its limit.
 */
import { Database } from "bun:sqlite";
import { z } from "zod";
import type {
  ComputeBrokerRefusal,
  ComputeJobDescription,
  ComputeUsageRecord as UsageRecordDoc,
} from "@sporta/compute-adapter";
import type { ComputeBrokerPort } from "@sporta/compute-adapter";
import { ComputeUsageRecord } from "@sporta/compute-adapter";
import { CONNECTION_SCHEMA_VERSION } from "./schema";
import { UsageLedger } from "./ledger";
import type { ByocLedgerStore, ExecutionOwnership, LedgerPutOutcome } from "./ledger";
import { InMemoryByocLedgerStore } from "./ledger";
import { DEFAULT_CONNECTION_POLICY } from "./policy";
import type { ConnectionCenterPolicy } from "./policy";

// ---------------------------------------------------------------------------
// The entitlement document (versioned DATA — the product plan's allowance)
// ---------------------------------------------------------------------------

/**
 * One account's managed-compute entitlement: the plan's allowance window,
 * the ABSTRACT-unit allowances, and the concurrency bound. All DATA —
 * unitIds are abstract (the W914 cost-unit vocabulary), the plan id is a
 * product label, and NO provider is named anywhere.
 */
export const ManagedComputeEntitlement = z
  .object({
    schemaVersion: z.literal(CONNECTION_SCHEMA_VERSION),
    accountId: z.string().min(1),
    /** The product plan this entitlement grants (DATA — a label). */
    planId: z.string().min(1),
    /** When the allowance window opens (epoch ms, inclusive). */
    periodStartMs: z.number().finite().min(0),
    /** When the allowance window closes (epoch ms, EXCLUSIVE). */
    periodEndMs: z.number().finite().min(0),
    /** The abstract-unit allowances (unique unitIds; limits > 0). */
    allowances: z
      .array(
        z
          .object({
            unitId: z.string().min(1),
            limit: z.number().finite().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    /** The maximum simultaneously in-flight (admitted, unsettled) jobs. */
    maxConcurrentJobs: z.number().int().min(1),
  })
  .strict()
  .superRefine((entitlement, ctx) => {
    if (entitlement.periodEndMs <= entitlement.periodStartMs) {
      ctx.addIssue({
        code: "custom",
        path: ["periodEndMs"],
        message: "periodEndMs must exceed periodStartMs (a non-empty allowance window)",
      });
    }
    const seen = new Set<string>();
    for (const allowance of entitlement.allowances) {
      if (seen.has(allowance.unitId)) {
        ctx.addIssue({
          code: "custom",
          path: ["allowances"],
          message: `duplicate allowance unitId '${allowance.unitId}'`,
        });
        return;
      }
      seen.add(allowance.unitId);
    }
  });
export type ManagedComputeEntitlement = z.infer<typeof ManagedComputeEntitlement>;

// ---------------------------------------------------------------------------
// The entitlement store (the W004 repository seam — in-memory + sqlite)
// ---------------------------------------------------------------------------

/** The honest entitlement-store counters. */
export interface EntitlementStoreStats {
  entitlements: number;
  duplicatePuts: number;
  deletes: number;
}

/** Base class for the typed entitlement-store errors. */
export class EntitlementStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntitlementStoreError";
  }
}

/** A different entitlement overwrote a live one (never silently replaced). */
export class EntitlementConflictError extends EntitlementStoreError {
  readonly accountId: string;

  constructor(accountId: string) {
    super(
      `account '${accountId}' already holds a DIFFERENT managed-compute entitlement — revoke it before granting another (never silently replaced)`,
    );
    this.name = "EntitlementConflictError";
    this.accountId = accountId;
  }
}

/** The entitlement store port. */
export interface EntitlementStore {
  /** Puts one entitlement (same content → counted duplicate). */
  putEntitlement(entitlement: ManagedComputeEntitlement): Promise<{
    disposition: "granted" | "duplicate";
  }>;
  /** One account's entitlement (or `null`). */
  findEntitlement(accountId: string): Promise<ManagedComputeEntitlement | null>;
  /** Removes one account's entitlement (returns it, or `null`). */
  deleteEntitlement(accountId: string): Promise<ManagedComputeEntitlement | null>;
  /** The honest counters. */
  stats(): EntitlementStoreStats;
  /** Closes the store (idempotent). */
  close(): void;
}

/** Options for both entitlement-store implementations. */
export interface EntitlementStoreOptions {
  /** Bound on stored entitlements (default 100_000). */
  maxEntitlements?: number;
  /** The injected clock for row stamps (default: deterministic counter). */
  nowMs?: () => number;
}

export const DEFAULT_MAX_ENTITLEMENTS = 100_000;

/** Shared put semantics (conflict / duplicate / validation). */
function putSemantics<Store extends EntitlementStore>(
  store: Store,
  state: { entitlements: Map<string, ManagedComputeEntitlement>; duplicatePuts: number },
  maxEntitlements: number,
  entitlement: ManagedComputeEntitlement,
): { disposition: "granted" | "duplicate" } {
  const parsed = ManagedComputeEntitlement.safeParse(entitlement);
  if (!parsed.success) {
    throw new EntitlementStoreError(
      "entitlement failed validation: " +
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  if (entitlement.accountId.length === 0 || entitlement.accountId.includes("\u0000")) {
    throw new EntitlementStoreError(
      `entitlement accountId must be non-empty and NUL-free (got '${entitlement.accountId.replaceAll("\u0000", "\\0")}')`,
    );
  }
  const existing = state.entitlements.get(entitlement.accountId);
  if (existing !== undefined) {
    if (JSON.stringify(existing) === JSON.stringify(parsed.data)) {
      state.duplicatePuts += 1;
      return { disposition: "duplicate" };
    }
    throw new EntitlementConflictError(entitlement.accountId);
  }
  if (state.entitlements.size >= maxEntitlements) {
    throw new EntitlementStoreError(
      `entitlement bound exceeded: ${state.entitlements.size} > ${maxEntitlements} (never silently evicted)`,
    );
  }
  state.entitlements.set(entitlement.accountId, structuredClone(parsed.data));
  return { disposition: "granted" };
}

/** The in-memory entitlement store. */
export class InMemoryEntitlementStore implements EntitlementStore {
  private readonly state = {
    entitlements: new Map<string, ManagedComputeEntitlement>(),
    duplicatePuts: 0,
  };
  private readonly maxEntitlements: number;
  private deletes = 0;
  private closed = false;

  constructor(options: EntitlementStoreOptions = {}) {
    this.maxEntitlements = options.maxEntitlements ?? DEFAULT_MAX_ENTITLEMENTS;
  }

  async putEntitlement(
    entitlement: ManagedComputeEntitlement,
  ): Promise<{ disposition: "granted" | "duplicate" }> {
    this.guardOpen();
    return putSemantics(this, this.state, this.maxEntitlements, entitlement);
  }

  async findEntitlement(accountId: string): Promise<ManagedComputeEntitlement | null> {
    this.guardOpen();
    const entitlement = this.state.entitlements.get(accountId);
    return entitlement === undefined ? null : structuredClone(entitlement);
  }

  async deleteEntitlement(accountId: string): Promise<ManagedComputeEntitlement | null> {
    this.guardOpen();
    const entitlement = this.state.entitlements.get(accountId);
    if (entitlement === undefined) return null;
    this.state.entitlements.delete(accountId);
    this.deletes += 1;
    return structuredClone(entitlement);
  }

  stats(): EntitlementStoreStats {
    this.guardOpen();
    return {
      entitlements: this.state.entitlements.size,
      duplicatePuts: this.state.duplicatePuts,
      deletes: this.deletes,
    };
  }

  close(): void {
    this.closed = true;
  }

  private guardOpen(): void {
    if (this.closed) throw new EntitlementStoreError("the entitlement store is closed");
  }
}

/** The durable entitlement store (`bun:sqlite`). */
export class SqliteEntitlementStore implements EntitlementStore {
  private readonly db: Database;
  private readonly ownsDb: boolean;
  private readonly maxEntitlements: number;
  private readonly nowMs: () => number;
  private duplicatePuts = 0;
  private deletes = 0;
  private closed = false;

  constructor(target: string | Database, options: EntitlementStoreOptions = {}) {
    this.db = typeof target === "string" ? new Database(target) : target;
    this.ownsDb = typeof target === "string";
    this.maxEntitlements = options.maxEntitlements ?? DEFAULT_MAX_ENTITLEMENTS;
    this.nowMs = options.nowMs ?? createDeterministicEntitlementClock();
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS managed_entitlements (
        account_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        written_at_ms INTEGER NOT NULL
      );
    `);
  }

  private parseRow(row: { payload: string }): ManagedComputeEntitlement {
    const parsed = ManagedComputeEntitlement.safeParse(JSON.parse(row.payload));
    if (!parsed.success) {
      throw new EntitlementStoreError(
        "stored entitlement failed integrity re-validation: " +
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
      );
    }
    return parsed.data;
  }

  async putEntitlement(
    entitlement: ManagedComputeEntitlement,
  ): Promise<{ disposition: "granted" | "duplicate" }> {
    this.guardOpen();
    const parsed = ManagedComputeEntitlement.safeParse(entitlement);
    if (!parsed.success) {
      throw new EntitlementStoreError(
        "entitlement failed validation: " +
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
      );
    }
    const row = this.db
      .query("SELECT payload FROM managed_entitlements WHERE account_id = ?")
      .get(entitlement.accountId) as { payload: string } | null;
    if (row !== null) {
      const existing = this.parseRow(row);
      if (JSON.stringify(existing) === JSON.stringify(parsed.data)) {
        this.duplicatePuts += 1;
        return { disposition: "duplicate" };
      }
      throw new EntitlementConflictError(entitlement.accountId);
    }
    const count = this.db.query("SELECT COUNT(*) AS n FROM managed_entitlements").get() as {
      n: number;
    };
    if (count.n >= this.maxEntitlements) {
      throw new EntitlementStoreError(
        `entitlement bound exceeded: ${count.n} > ${this.maxEntitlements} (never silently evicted)`,
      );
    }
    this.db
      .query(
        "INSERT INTO managed_entitlements (account_id, payload, written_at_ms) VALUES (?, ?, ?)",
      )
      .run(entitlement.accountId, JSON.stringify(parsed.data), this.nowMs());
    return { disposition: "granted" };
  }

  async findEntitlement(accountId: string): Promise<ManagedComputeEntitlement | null> {
    this.guardOpen();
    const row = this.db
      .query("SELECT payload FROM managed_entitlements WHERE account_id = ?")
      .get(accountId) as { payload: string } | null;
    return row === null ? null : this.parseRow(row);
  }

  async deleteEntitlement(accountId: string): Promise<ManagedComputeEntitlement | null> {
    this.guardOpen();
    const row = this.db
      .query("SELECT payload FROM managed_entitlements WHERE account_id = ?")
      .get(accountId) as { payload: string } | null;
    if (row === null) return null;
    this.db.query("DELETE FROM managed_entitlements WHERE account_id = ?").run(accountId);
    this.deletes += 1;
    return this.parseRow(row);
  }

  stats(): EntitlementStoreStats {
    this.guardOpen();
    const count = this.db.query("SELECT COUNT(*) AS n FROM managed_entitlements").get() as {
      n: number;
    };
    return { entitlements: count.n, duplicatePuts: this.duplicatePuts, deletes: this.deletes };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ownsDb) this.db.close();
  }

  private guardOpen(): void {
    if (this.closed) throw new EntitlementStoreError("the entitlement store is closed");
  }
}

/** Deterministic per-store clock (the W003 posture). */
function createDeterministicEntitlementClock(): () => number {
  let ticks = 0;
  return (): number => 1_700_000_000_000 + (ticks += 1);
}

// ---------------------------------------------------------------------------
// The admission vocabulary (fail-closed, R401 reuse)
// ---------------------------------------------------------------------------

/** The closed refusal-bound vocabulary (WHICH bound refused — data). */
export const MANAGED_REFUSAL_BOUNDS = [
  "no-entitlement",
  "period-exhausted",
  "concurrency-full",
  "unit-exhausted",
] as const;
export type ManagedRefusalBound = (typeof MANAGED_REFUSAL_BOUNDS)[number];

/**
 * The typed fail-closed admission refusal. The refusal reason REUSES the
 * R401 closed vocabulary verbatim (`quota-exhausted` — a bounded resource
 * refused the job); the BOUND that fired travels as data, and the class
 * is `resource-limit` (the W914 mapping for quota refusals).
 */
export class ManagedAdmissionRefusalError extends Error {
  readonly failureClass: "resource-limit";
  readonly terminalFailureClass: "resource-limit";
  /** The R401 closed-vocabulary reason (reused, never invented). */
  readonly refusalReason: ComputeBrokerRefusal;
  /** Which bound refused (closed vocabulary — data). */
  readonly bound: ManagedRefusalBound;
  readonly accountId: string;
  readonly detail: string;

  constructor(options: { bound: ManagedRefusalBound; accountId: string; detail: string }) {
    super(`managed compute admission refused (${options.bound}): ${options.detail}`);
    this.name = "ManagedAdmissionRefusalError";
    this.failureClass = "resource-limit";
    this.terminalFailureClass = "resource-limit";
    this.refusalReason = "quota-exhausted";
    this.bound = options.bound;
    this.accountId = options.accountId;
    this.detail = options.detail;
  }
}

/** A dispatch without a live admission (the sequencing contract). */
export class ManagedSequenceError extends Error {
  constructor(accountId: string, jobId: string) {
    super(
      `dispatch for (account '${accountId}', job '${jobId}') has no live admission — admit() precedes dispatch() (fail-closed sequencing, never admitted-on-hope)`,
    );
    this.name = "ManagedSequenceError";
  }
}

// ---------------------------------------------------------------------------
// The admission / status / alarm documents
// ---------------------------------------------------------------------------

/** The honest admission snapshot at admit time. */
export interface ManagedAdmission {
  schemaVersion: "1.0";
  accountId: string;
  jobId: string;
  admittedAtMs: number;
  /** The concurrency state at admission. */
  inFlight: number;
  maxConcurrentJobs: number;
  /** Every allowance's (knowable) state at admission. */
  allowances: Array<{ unitId: string; limit: number; consumed: number; remaining: number }>;
}

/** One spend-alarm event (the W919 posture — recorded at settlement). */
export interface ManagedAlarmEvent {
  schemaVersion: "1.0";
  accountId: string;
  unitId: string;
  /** The threshold fraction that was crossed (from the policy). */
  threshold: number;
  /** The consumption AFTER the settling record, in the unit. */
  consumed: number;
  limit: number;
  atMs: number;
  message: string;
}

/** The account's managed-compute status (the honest live view). */
export interface ManagedStatus {
  schemaVersion: "1.0";
  accountId: string;
  entitlement: ManagedComputeEntitlement | null;
  inFlight: number;
  consumption: Array<{ unitId: string; limit: number; consumed: number; remaining: number }>;
  /** The fail-closed admission posture RIGHT NOW (no job admitted). */
  admission: { open: boolean; closedBound?: ManagedRefusalBound; closedDetail?: string };
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** Options for {@link ManagedComputeSeam}. */
export interface ManagedComputeSeamOptions {
  /** The R401 broker the seam dispatches through (verbatim delegation). */
  broker: ComputeBrokerPort;
  /** The R408 usage ledger settlements record into (default: in-memory). */
  ledger?: UsageLedger;
  /** A ledger STORE to construct the default ledger over (ignored with `ledger`). */
  ledgerStore?: ByocLedgerStore;
  /** The entitlement store (default: in-memory). */
  entitlementStore?: EntitlementStore;
  /** The injected clock (REQUIRED). */
  nowMs: () => number;
  /** The policy (default: the shipped policy — thresholds + fail-closed). */
  policy?: ConnectionCenterPolicy;
  /** Bound on in-memory alarm events (default 1_000 — bounded, never silent). */
  maxAlarmEvents?: number;
}

/** One in-flight (admitted, unsettled) job. */
interface InFlightJob {
  accountId: string;
  jobId: string;
  providerId: string;
  admittedAtMs: number;
}

/** What one settlement answered. */
export interface SettlementOutcome {
  ledger: LedgerPutOutcome;
  consumption: Array<{ unitId: string; limit: number; consumed: number; remaining: number }>;
  alarms: ManagedAlarmEvent[];
}

/**
 * THE managed compute seam (R409): entitlement-gated admission → verbatim
 * broker dispatch → settlement (ledger record + allowance metering +
 * threshold alarms). One seam per product plane; account-scoped by
 * construction; provider-independent by construction (abstract units, the
 * R401 vocabulary, the R401 broker seam).
 */
export class ManagedComputeSeam {
  private readonly broker: ComputeBrokerPort;
  private readonly ledger: UsageLedger;
  private readonly entitlementStore: EntitlementStore;
  private readonly nowMs: () => number;
  private readonly policy: ConnectionCenterPolicy;
  private readonly maxAlarmEvents: number;
  private readonly inFlight = new Map<string, InFlightJob>();
  private readonly alarms: ManagedAlarmEvent[] = [];
  /** The consumption cache: account → unit → consumed (ledger-derived). */
  private readonly consumption = new Map<string, Map<string, number>>();

  constructor(options: ManagedComputeSeamOptions) {
    this.broker = options.broker;
    this.ledger =
      options.ledger ??
      new UsageLedger({
        store: options.ledgerStore ?? new InMemoryByocLedgerStore(),
        nowMs: options.nowMs,
      });
    this.entitlementStore = options.entitlementStore ?? new InMemoryEntitlementStore();
    this.nowMs = options.nowMs;
    this.policy = options.policy ?? DEFAULT_CONNECTION_POLICY;
    this.maxAlarmEvents = options.maxAlarmEvents ?? 1_000;
  }

  // -------------------------------------------------------------------------
  // Entitlements
  // -------------------------------------------------------------------------

  /** Grants (or re-records, idempotently) one account's entitlement. */
  async grantEntitlement(
    entitlement: ManagedComputeEntitlement,
  ): Promise<{ disposition: "granted" | "duplicate" }> {
    return this.entitlementStore.putEntitlement(entitlement);
  }

  /** Revokes one account's entitlement (in-flight jobs still settle honestly). */
  async revokeEntitlement(accountId: string): Promise<ManagedComputeEntitlement | null> {
    return this.entitlementStore.deleteEntitlement(accountId);
  }

  /** One account's entitlement (or `null`). */
  async entitlementOf(accountId: string): Promise<ManagedComputeEntitlement | null> {
    return this.entitlementStore.findEntitlement(accountId);
  }

  // -------------------------------------------------------------------------
  // admit (fail-closed)
  // -------------------------------------------------------------------------

  /**
   * The fail-closed admission gate: checks the entitlement, the window,
   * the concurrency bound, the `jobs` count-unit, and (one-step-late, the
   * documented honest posture) every other unit's EXISTING consumption —
   * then registers the job as in-flight. A refused admission throws the
   * typed {@link ManagedAdmissionRefusalError} and admits NOTHING.
   */
  async admit(accountId: string, job: ComputeJobDescription): Promise<ManagedAdmission> {
    const entitlement = await this.entitlementStore.findEntitlement(accountId);
    if (entitlement === null) {
      throw new ManagedAdmissionRefusalError({
        bound: "no-entitlement",
        accountId,
        detail:
          "the account holds no managed-compute entitlement (grant one first — admission never happens on hope)",
      });
    }
    const now = this.nowMs();
    if (now < entitlement.periodStartMs || now >= entitlement.periodEndMs) {
      throw new ManagedAdmissionRefusalError({
        bound: "period-exhausted",
        accountId,
        detail: `the allowance window [${entitlement.periodStartMs}, ${entitlement.periodEndMs}) does not contain now (${now})`,
      });
    }
    const inFlight = this.countInFlight(accountId);
    if (inFlight >= entitlement.maxConcurrentJobs) {
      throw new ManagedAdmissionRefusalError({
        bound: "concurrency-full",
        accountId,
        detail: `${inFlight} in-flight jobs already hold the concurrency bound ${entitlement.maxConcurrentJobs}`,
      });
    }
    const consumption = await this.consumptionOf(accountId, entitlement);
    for (const allowance of entitlement.allowances) {
      const consumed = consumption.get(allowance.unitId) ?? 0;
      const unitInFlight = allowance.unitId === "jobs" ? inFlight : 0;
      if (consumed + unitInFlight >= allowance.limit) {
        throw new ManagedAdmissionRefusalError({
          bound: "unit-exhausted",
          accountId,
          detail: `allowance unit '${allowance.unitId}' is exhausted: ${consumed} consumed + ${unitInFlight} in-flight >= limit ${allowance.limit}`,
        });
      }
    }
    const jobKey = this.jobKey(accountId, job.jobId);
    this.inFlight.set(jobKey, {
      accountId,
      jobId: job.jobId,
      providerId: "",
      admittedAtMs: now,
    });
    return {
      schemaVersion: CONNECTION_SCHEMA_VERSION,
      accountId,
      jobId: job.jobId,
      admittedAtMs: now,
      inFlight,
      maxConcurrentJobs: entitlement.maxConcurrentJobs,
      allowances: entitlement.allowances.map((allowance) => ({
        unitId: allowance.unitId,
        limit: allowance.limit,
        consumed: consumption.get(allowance.unitId) ?? 0,
        remaining: Math.max(0, allowance.limit - (consumption.get(allowance.unitId) ?? 0)),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // dispatch (verbatim delegation + sequencing)
  // -------------------------------------------------------------------------

  /**
   * Dispatches an ADMITTED job through the broker VERBATIM (the seam adds
   * no execution semantics): the broker routes to the chosen provider's
   * adapter exactly as R401 prescribes. A dispatch without a live
   * admission is the typed {@link ManagedSequenceError}; a broker-side
   * refusal releases the admission (the allowance was never consumed).
   */
  async dispatch(
    accountId: string,
    providerId: string,
    job: ComputeJobDescription,
  ): Promise<ReturnType<ComputeBrokerPort["dispatch"]>> {
    const jobKey = this.jobKey(accountId, job.jobId);
    const entry = this.inFlight.get(jobKey);
    if (entry === undefined) {
      throw new ManagedSequenceError(accountId, job.jobId);
    }
    entry.providerId = providerId;
    try {
      const outcome = await this.broker.dispatch(providerId, job);
      return outcome;
    } catch (error) {
      // The job never entered execution: the admission is void, the
      // allowance unconsumed (the broker's typed refusal propagates).
      this.inFlight.delete(jobKey);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // settle (ledger record + metering + alarms)
  // -------------------------------------------------------------------------

  /**
   * Settles one terminal job: records the W914 usage record into the R408
   * ledger (`sporta-managed` responsibility), removes the in-flight entry,
   * meters every declared allowance unit, and emits the threshold-alarm
   * events the settlement crossed (the W919 spend alarms). Idempotent via
   * the ledger (the same record re-settles as a counted duplicate).
   */
  async settle(
    accountId: string,
    providerId: string,
    usage: UsageRecordDoc,
  ): Promise<SettlementOutcome> {
    const parsed = ComputeUsageRecord.safeParse(usage);
    if (!parsed.success) {
      throw new Error(
        "settlement usage record failed W914 validation: " +
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
      );
    }
    const ownership: ExecutionOwnership = "sporta-managed";
    const ledgerOutcome = await this.ledger.record(accountId, providerId, ownership, parsed.data);
    this.inFlight.delete(this.jobKey(accountId, parsed.data.jobId));

    const entitlement = await this.entitlementStore.findEntitlement(accountId);
    const fired: ManagedAlarmEvent[] = [];
    const now = this.nowMs();
    const consumption = this.mutableConsumption(accountId);
    // Metering happens on the FIRST settlement only (the ledger outcome is
    // the idempotency gate — a re-settle is a counted duplicate, never a
    // double-consumption).
    if (entitlement !== null && ledgerOutcome.disposition === "recorded") {
      for (const allowance of entitlement.allowances) {
        const previous = consumption.get(allowance.unitId) ?? 0;
        let delta = 0;
        if (allowance.unitId === "jobs") {
          delta = 1;
        } else {
          const unit = parsed.data.costUnits.find((entry) => entry.unitId === allowance.unitId);
          delta = unit !== undefined ? unit.quantity : 0;
        }
        if (delta === 0) continue;
        const next = previous + delta;
        consumption.set(allowance.unitId, next);
        for (const threshold of this.policy.managed.alarmThresholds) {
          const tripAt = allowance.limit * threshold;
          if (previous < tripAt && next >= tripAt && tripAt > 0) {
            const alarm: ManagedAlarmEvent = {
              schemaVersion: CONNECTION_SCHEMA_VERSION,
              accountId,
              unitId: allowance.unitId,
              threshold,
              consumed: next,
              limit: allowance.limit,
              atMs: now,
              message: `allowance unit '${allowance.unitId}' crossed ${threshold * 100}% of its limit (${next} / ${allowance.limit})`,
            };
            this.pushAlarm(alarm);
            fired.push(alarm);
          }
        }
      }
    }
    return {
      ledger: ledgerOutcome,
      consumption: await this.consumptionSnapshot(accountId),
      alarms: fired,
    };
  }

  // -------------------------------------------------------------------------
  // status
  // -------------------------------------------------------------------------

  /** The account's honest managed-compute status (admission posture included). */
  async status(accountId: string): Promise<ManagedStatus> {
    const entitlement = await this.entitlementStore.findEntitlement(accountId);
    const inFlight = this.countInFlight(accountId);
    const consumption = await this.consumptionSnapshot(accountId);
    if (entitlement === null) {
      return {
        schemaVersion: CONNECTION_SCHEMA_VERSION,
        accountId,
        entitlement: null,
        inFlight,
        consumption,
        admission: {
          open: false,
          closedBound: "no-entitlement",
          closedDetail: "the account holds no managed-compute entitlement",
        },
      };
    }
    const now = this.nowMs();
    if (now < entitlement.periodStartMs || now >= entitlement.periodEndMs) {
      return {
        schemaVersion: CONNECTION_SCHEMA_VERSION,
        accountId,
        entitlement,
        inFlight,
        consumption,
        admission: {
          open: false,
          closedBound: "period-exhausted",
          closedDetail: `the allowance window [${entitlement.periodStartMs}, ${entitlement.periodEndMs}) does not contain now (${now})`,
        },
      };
    }
    if (inFlight >= entitlement.maxConcurrentJobs) {
      return {
        schemaVersion: CONNECTION_SCHEMA_VERSION,
        accountId,
        entitlement,
        inFlight,
        consumption,
        admission: {
          open: false,
          closedBound: "concurrency-full",
          closedDetail: `${inFlight} in-flight jobs already hold the concurrency bound ${entitlement.maxConcurrentJobs}`,
        },
      };
    }
    for (const allowance of entitlement.allowances) {
      const consumed =
        consumption.find((entry) => entry.unitId === allowance.unitId)?.consumed ?? 0;
      const unitInFlight = allowance.unitId === "jobs" ? inFlight : 0;
      if (consumed + unitInFlight >= allowance.limit) {
        return {
          schemaVersion: CONNECTION_SCHEMA_VERSION,
          accountId,
          entitlement,
          inFlight,
          consumption,
          admission: {
            open: false,
            closedBound: "unit-exhausted",
            closedDetail: `allowance unit '${allowance.unitId}' is exhausted: ${consumed} consumed + ${unitInFlight} in-flight >= limit ${allowance.limit}`,
          },
        };
      }
    }
    return {
      schemaVersion: CONNECTION_SCHEMA_VERSION,
      accountId,
      entitlement,
      inFlight,
      consumption,
      admission: { open: true },
    };
  }

  /** The recent alarm events (bounded; newest-first). */
  recentAlarms(accountId: string, limit: number = 100): ManagedAlarmEvent[] {
    const out: ManagedAlarmEvent[] = [];
    for (let i = this.alarms.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const alarm = this.alarms[i]!;
      if (alarm.accountId === accountId) out.push(alarm);
    }
    return out;
  }

  /** The honest store counters (entitlements + ledger). */
  storeStats(): {
    entitlements: EntitlementStoreStats;
    ledger: ReturnType<UsageLedger["storeStats"]>;
  } {
    return { entitlements: this.entitlementStore.stats(), ledger: this.ledger.storeStats() };
  }

  /** The R408 ledger settlements record into (the durable usage truth). */
  get usageLedger(): UsageLedger {
    return this.ledger;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private jobKey(accountId: string, jobId: string): string {
    return `${accountId}\u0000${jobId}`;
  }

  private countInFlight(accountId: string): number {
    let count = 0;
    for (const entry of this.inFlight.values()) {
      if (entry.accountId === accountId) count += 1;
    }
    return count;
  }

  /** The consumption cache (account → unit → consumed), ledger-derived. */
  private mutableConsumption(accountId: string): Map<string, number> {
    let account = this.consumption.get(accountId);
    if (account === undefined) {
      account = new Map<string, number>();
      this.consumption.set(accountId, account);
    }
    return account;
  }

  /** Consumption per unit for one account, seeded from the LEDGER (restart-safe). */
  private async consumptionOf(
    accountId: string,
    entitlement: ManagedComputeEntitlement,
  ): Promise<Map<string, number>> {
    const cached = this.mutableConsumption(accountId);
    const knownUnits = new Set([
      ...entitlement.allowances.map((allowance) => allowance.unitId),
      ...cached.keys(),
    ]);
    // The ledger is the durable truth: any unit NOT in the cache is
    // re-derived from the records inside the entitlement's window.
    for (const unitId of knownUnits) {
      if (cached.has(unitId)) continue;
      const records = await this.ledger.history(accountId, {
        sinceRecordedAtMs: entitlement.periodStartMs,
      });
      let total = 0;
      for (const record of records) {
        if (unitId === "jobs") total += 1;
        else {
          const unit = record.usage.costUnits.find((entry) => entry.unitId === unitId);
          total += unit?.quantity ?? 0;
        }
      }
      cached.set(unitId, total);
    }
    return cached;
  }

  /** The read-only consumption snapshot for status/admission payloads. */
  private async consumptionSnapshot(
    accountId: string,
  ): Promise<Array<{ unitId: string; limit: number; consumed: number; remaining: number }>> {
    const entitlement = await this.entitlementStore.findEntitlement(accountId);
    const cached = this.mutableConsumption(accountId);
    const out: Array<{ unitId: string; limit: number; consumed: number; remaining: number }> = [];
    if (entitlement !== null) {
      const consumption = await this.consumptionOf(accountId, entitlement);
      for (const allowance of entitlement.allowances) {
        const consumed = consumption.get(allowance.unitId) ?? 0;
        out.push({
          unitId: allowance.unitId,
          limit: allowance.limit,
          consumed,
          remaining: Math.max(0, allowance.limit - consumed),
        });
      }
      return out;
    }
    for (const [unitId, consumed] of cached.entries()) {
      out.push({ unitId, limit: Number.NaN, consumed, remaining: Number.NaN });
    }
    return out;
  }

  /** Pushes one alarm (bounded; the bound is an explicit error, never silent). */
  private pushAlarm(alarm: ManagedAlarmEvent): void {
    if (this.alarms.length >= this.maxAlarmEvents) {
      throw new Error(
        `managed-alarm bound exceeded: ${this.alarms.length} > ${this.maxAlarmEvents} (drain recentAlarms — never silently dropped)`,
      );
    }
    this.alarms.push(alarm);
  }
}
