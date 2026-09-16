/**
 * THE GUARDRAILS SERVICE (W919) — provider usage counters, the free-tier
 * limit ledger, spend alarms, and fail-closed admission over the REAL seams:
 *
 * - the compute adapter's per-job metering (cpu-ms / render-requests /
 *   artifact-bytes), attributed to the dispatching user, per calendar day;
 * - the R2 store's never-silent stats (stored bytes — a live stock);
 * - the RedisLike port's command volume (the Upstash monthly budget), counted
 *   by the `MeteredRedis` wrapper the composition's queue/quota/cache issue
 *   their commands through;
 * - the postgres seam's `pg_database_size` (Neon storage — a live stock, read
 *   only when DATABASE_URL is configured);
 * - the W913 bounded queue's depth (surfaced with the usage snapshot).
 *
 * Counter persistence rides the Upstash port (in-memory fallback, honest
 * per-instance health). Usage is NEVER fabricated: a seam that cannot be read
 * is reported `unmeasured` (evaluation) or REFUSES admission (the
 * fail-closed rule) — never a made-up number.
 *
 * OBSERVATION-DRIVEN ALARMS: there is no background scheduler on a
 * serverless host; alarm transitions are recorded wherever the guardrail
 * state is observed (capability builds, console reads, admission checks) —
 * see ./alarms.ts.
 */

import type { RedisLike } from "../upstash/redis";
import type { PlatformQuotaState } from "../upstash/quotas";
import { r2Configured } from "../env";
import { neonClient } from "../db/pg";
import { getHostedRenderOutputStore } from "../r2/hosted";
import type { HostedSegmentStoreStats } from "../r2/r2-store";
import {
  evaluateLimit,
  resolveLedger,
  type LimitEvaluation,
  type ProviderLimitDefinition,
  type ResolvedLedger,
} from "./ledger";
import {
  CommandCounter,
  calendarDayKey,
  calendarMonthKey,
  monthlyCommandsKey,
  readCounter,
  readUserDailyUsage,
  recordUserDailyUsage,
  type MeteredCostUnit,
} from "./usage";
import { observeAlarm, type AlarmEvaluation } from "./alarms";
import { ProviderCapacityLimitError, admissionRetryAfterSeconds } from "./admission";

/** One job usage record off the compute adapter's metering drain. */
export interface MeteredJobUsageRecord {
  jobId: string;
  meteredAtMs: number;
  costUnits: readonly MeteredCostUnit[];
}

/** The metered compute units the per-user daily admission quotas track. */
export const USER_COMPUTE_QUOTA_UNITS: readonly { limitId: string; unitId: string }[] =
  Object.freeze([
    { limitId: "compute.cpu-ms-day", unitId: "cpu-ms" },
    { limitId: "compute.artifact-bytes-day", unitId: "artifact-bytes" },
  ]);

/** Options for {@link GuardrailsService}. */
export interface GuardrailsServiceOptions {
  /** The METERED redis (its commands count toward the Upstash budget). */
  redis: RedisLike;
  /** The command counter the MeteredRedis wrapper feeds. */
  commands: CommandCounter;
  nowMs: () => number;
  /** The resolved ledger (default: documented defaults + env overrides). */
  ledger?: ResolvedLedger;
  /**
   * The compute adapter's usage drain (default: none — the composition wires
   * the real adapter; null means no adapter is configured).
   */
  computeUsage?: () => Promise<readonly MeteredJobUsageRecord[] | null>;
  /**
   * The R2 store's live stats (default: the env-configured hosted store, or
   * null when unconfigured — the limit then honestly does not apply).
   */
  r2Stats?: () => Promise<HostedSegmentStoreStats | null>;
  /**
   * Neon's live storage bytes (default: pg_database_size over the postgres
   * seam when configured; null otherwise — honestly unmeasured).
   */
  neonStorageBytes?: () => Promise<number | null>;
}

/** The evaluation snapshot (limits + the alarm transitions they imply). */
export interface GuardrailsEvaluation {
  limits: LimitEvaluation[];
  alarms: AlarmEvaluation[];
}

/** The guardrails service. */
export class GuardrailsService {
  readonly #redis: RedisLike;
  readonly #commands: CommandCounter;
  readonly #nowMs: () => number;
  readonly #ledger: ResolvedLedger;
  readonly #computeUsage: () => Promise<readonly MeteredJobUsageRecord[] | null>;
  readonly #r2Stats: () => Promise<HostedSegmentStoreStats | null>;
  readonly #neonStorageBytes: () => Promise<number | null>;
  /** Job ids whose usage was already recorded (metering idempotence). */
  readonly #notedJobs = new Set<string>();

  constructor(options: GuardrailsServiceOptions) {
    this.#redis = options.redis;
    this.#commands = options.commands;
    this.#nowMs = options.nowMs;
    this.#ledger = options.ledger ?? resolveLedger();
    this.#computeUsage =
      options.computeUsage ??
      (() => {
        throw new Error("compute usage drain is not wired for this service");
      });
    this.#r2Stats =
      options.r2Stats ??
      (async () => {
        const store = r2Configured() ? getHostedRenderOutputStore() : null;
        return store === null ? null : await store.stats();
      });
    this.#neonStorageBytes =
      options.neonStorageBytes ??
      (async () => {
        const sql = neonClient();
        if (sql === null) return null;
        const rows = await sql`SELECT pg_database_size(current_database()) AS bytes`;
        const first = rows[0] as { bytes: number | string } | undefined;
        if (first === undefined) return null;
        const parsed = Number(first.bytes);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      });
  }

  /** The resolved ledger (limits + warning ratio + applied overrides). */
  get ledger(): ResolvedLedger {
    return this.#ledger;
  }

  /** The command counter (the composition's MeteredRedis feeds it). */
  get commandCounter(): CommandCounter {
    return this.#commands;
  }

  // -------------------------------------------------------------------------
  // Usage recording (the REAL seams' write path)
  // -------------------------------------------------------------------------

  /**
   * Records one job's metered usage into the dispatching user's daily
   * counters (idempotent per job id — the terminal poll seams may observe a
   * settled job more than once). Returns false for an already-recorded job.
   */
  async noteJobUsage(
    userId: string | null,
    jobId: string,
    costUnits: readonly MeteredCostUnit[],
  ): Promise<boolean> {
    if (this.#notedJobs.has(jobId)) return false;
    this.#notedJobs.add(jobId);
    if (userId === null || costUnits.length === 0) return true;
    await recordUserDailyUsage(this.#redis, userId, costUnits, this.#nowMs());
    return true;
  }

  // -------------------------------------------------------------------------
  // Per-user quota states (the capability quotas[] + the admission input)
  // -------------------------------------------------------------------------

  /**
   * The per-user daily admission quotas as the W901 `QuotaState` shape (the
   * same vocabulary the render-requests quota uses — unreadable counters are
   * the fail-closed `quota-counter-invalid` entry).
   */
  async userQuotaStates(userId: string): Promise<PlatformQuotaState[]> {
    const states: PlatformQuotaState[] = [];
    for (const { limitId, unitId } of USER_COMPUTE_QUOTA_UNITS) {
      const definition = this.#limitOf(limitId);
      let used: number;
      try {
        // Absent counter = zero usage so far (a thrown/corrupt read is the
        // fail-closed `quota-counter-invalid` entry — never zero).
        used = (await readUserDailyUsage(this.#redis, unitId, userId, this.#nowMs())) ?? 0;
      } catch {
        states.push({
          quotaId: limitId,
          scope: "user",
          used: null,
          limit: null,
          remaining: null,
          exhausted: true,
          reasonCode: "quota-counter-invalid",
        });
        continue;
      }
      const exhausted = used >= definition.limit;
      states.push({
        quotaId: limitId,
        scope: "user",
        used,
        limit: definition.limit,
        remaining: Math.max(0, definition.limit - used),
        exhausted,
        reasonCode: exhausted ? "quota-exhausted" : "ok",
      });
    }
    return states;
  }

  // -------------------------------------------------------------------------
  // Admission (fail-closed provider capacity)
  // -------------------------------------------------------------------------

  /**
   * The W919 admission rung: refuses (typed, with the real reason) when any
   * admission-enforced limit is reached/exceeded for this user or globally,
   * or when an admission-enforced counter cannot be read (fail-closed).
   * Playback is never gated here — only new expensive work.
   */
  async checkAdmission(userId: string): Promise<void> {
    const nowMs = this.#nowMs();

    // 1. Per-user daily compute quotas (the dispatching user's metered usage).
    for (const { limitId, unitId } of USER_COMPUTE_QUOTA_UNITS) {
      const definition = this.#limitOf(limitId);
      let used: number;
      try {
        // Absent counter = zero usage; a thrown/corrupt read refuses below.
        used = (await readUserDailyUsage(this.#redis, unitId, userId, nowMs)) ?? 0;
      } catch {
        throw new ProviderCapacityLimitError({
          scope: "user",
          reasonCode: "limit-check-unreadable",
          evaluation: evaluateLimit(definition, null, this.#ledger.warningRatio),
          retryAfterSeconds: admissionRetryAfterSeconds(definition.window, nowMs),
        });
      }
      if (used >= definition.limit) {
        throw new ProviderCapacityLimitError({
          scope: "user",
          reasonCode: used > definition.limit ? "limit-exceeded" : "limit-reached",
          evaluation: evaluateLimit(definition, used, this.#ledger.warningRatio),
          retryAfterSeconds: admissionRetryAfterSeconds(definition.window, nowMs),
        });
      }
    }

    // 2. Global provider limits that admission defends (the ledger's flags).
    for (const limit of this.#ledger.limits) {
      if (limit.provider === "compute" || !limit.admissionEnforced) continue;
      let used: number | null = null;
      let unreadable = false;
      if (limit.limitId === "r2.storage-bytes") {
        try {
          const stats = await this.#r2Stats();
          used = stats === null ? null : stats.totalBytes;
        } catch {
          unreadable = true;
        }
      } else if (limit.limitId === "upstash.commands") {
        const read = await this.#readCommandTotal();
        if (read === null) {
          unreadable = true;
        } else {
          used = read;
        }
      }
      if (unreadable) {
        // Configured-but-unreadable: fail-closed. Unconfigured (null usage
        // from an absent provider) honestly does not apply.
        if (limit.limitId === "upstash.commands" || (await this.#r2ConfiguredLive())) {
          throw new ProviderCapacityLimitError({
            scope: "provider",
            reasonCode: "limit-check-unreadable",
            evaluation: evaluateLimit(limit, null, this.#ledger.warningRatio),
            retryAfterSeconds: admissionRetryAfterSeconds(limit.window, nowMs),
          });
        }
        continue;
      }
      if (used !== null && used >= limit.limit) {
        throw new ProviderCapacityLimitError({
          scope: "provider",
          reasonCode: used > limit.limit ? "limit-exceeded" : "limit-reached",
          evaluation: evaluateLimit(limit, used, this.#ledger.warningRatio),
          retryAfterSeconds: admissionRetryAfterSeconds(limit.window, nowMs),
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Limit evaluation + alarms (the capability feeds + the console panels)
  // -------------------------------------------------------------------------

  /**
   * Evaluates every ledger limit against its measured usage (never
   * fabricating: unmeasured seams report `unmeasured`), observing the alarm
   * transitions the evaluations imply.
   *
   * Compute-limit scope (documented): the per-user daily quotas are evaluated
   * WITH a `userId` against THAT user's metered counters (the per-user view
   * — the capability `quotas[]` path reads the same counters through
   * {@link userQuotaStates}). WITHOUT a `userId` (the operations console and
   * the capability provider feeds) the compute rows carry the ADAPTER's
   * daily plane totals — the real whole-plane metered quantity for today —
   * so the console's provider view and its window-scoped alarms observe one
   * consistent plane-scoped state (never a mix of per-user and plane writes
   * on the same alarm key). The plane total is a conservative aggregate: any
   * single user's usage is at most the plane total, so a plane state of
   * `under` proves no user can be over, and a crossed plane state is a real
   * spend signal for the day (the meterNote says which scope is shown).
   */
  async evaluateLimits(userId?: string): Promise<GuardrailsEvaluation> {
    const nowMs = this.#nowMs();
    const limits: LimitEvaluation[] = [];
    const alarms: AlarmEvaluation[] = [];
    let planeTotals: { unitId: string; quantity: number }[] | null | undefined;

    for (const limit of this.#ledger.limits) {
      let used: number | null = null;
      let noteOverride: string | null = null;
      if (limit.metered) {
        try {
          if (limit.limitId === "r2.storage-bytes") {
            const stats = await this.#r2Stats();
            used = stats === null ? null : stats.totalBytes;
            if (stats === null)
              noteOverride = "the R2 store is not configured (the allowance does not apply)";
          } else if (limit.limitId === "upstash.commands") {
            used = await this.#readCommandTotal();
            if (used === null) noteOverride = "the shared command counter is unreadable";
          } else if (limit.limitId === "neon.storage-bytes") {
            used = await this.#neonStorageBytes();
            if (used === null)
              noteOverride = "the postgres seam is not configured (or reported no size)";
          } else if (limit.provider === "compute") {
            const unitId = this.#unitOf(limit.limitId);
            if (unitId !== null && userId !== undefined) {
              // The per-user view: absent counter = zero usage so far.
              used = (await readUserDailyUsage(this.#redis, unitId, userId, nowMs)) ?? 0;
            } else if (unitId !== null) {
              // The provider-plane view: the adapter's real daily totals.
              planeTotals ??= await this.computeUsageTotals();
              const quantity = planeTotals?.find((total) => total.unitId === unitId)?.quantity;
              if (quantity !== undefined) {
                used = quantity;
                noteOverride =
                  "today's whole-plane metered total across all users (the admission quota itself is per-user)";
              }
            }
          }
        } catch {
          used = null;
          noteOverride = "the limit's usage seam threw while being read";
        }
      }
      const evaluation =
        noteOverride === null
          ? evaluateLimit(limit, used, this.#ledger.warningRatio)
          : { ...evaluateLimit(limit, used, this.#ledger.warningRatio), meterNote: noteOverride };
      limits.push(evaluation);
      alarms.push(await this.#observe(evaluation, nowMs));
    }
    return { limits, alarms };
  }

  /** The alarm views for the console's health panel (all limits, current window). */
  async alarmViews(): Promise<AlarmEvaluation[]> {
    return (await this.evaluateLimits()).alarms;
  }

  /**
   * The compute provider's usage counters for the console: the adapter's
   * metering drain aggregated over TODAY (UTC), per unit — plus the live
   * per-user attribution note. Null when no adapter is configured.
   */
  async computeUsageTotals(): Promise<{ unitId: string; quantity: number }[] | null> {
    let records: readonly MeteredJobUsageRecord[] | null;
    try {
      records = await this.#computeUsage();
    } catch {
      return null;
    }
    if (records === null) return null;
    const dayKey = calendarDayKey(this.#nowMs());
    const totals = new Map<string, number>();
    for (const record of records) {
      if (calendarDayKey(record.meteredAtMs) !== dayKey) continue;
      for (const unit of record.costUnits) {
        totals.set(unit.unitId, (totals.get(unit.unitId) ?? 0) + unit.quantity);
      }
    }
    return [...totals.entries()]
      .map(([unitId, quantity]) => ({ unitId, quantity }))
      .sort((a, b) => a.unitId.localeCompare(b.unitId));
  }

  /** Flushes + reads the monthly command total (null when unreadable). */
  async #readCommandTotal(): Promise<number | null> {
    const monthKey = calendarMonthKey(this.#nowMs());
    try {
      const flushed = await this.#commands.flush(this.#redis, monthKey);
      if (flushed !== null) return flushed.total;
      // Flush refused to fabricate a total for an unreadable counter: read
      // directly (an absent key is zero only if the read itself succeeds).
      return (await readCounter(this.#redis, monthlyCommandsKey(monthKey))) ?? 0;
    } catch {
      return null;
    }
  }

  /** Whether the R2 store is configured (an unreadable CONFIGURED store refuses). */
  async #r2ConfiguredLive(): Promise<boolean> {
    try {
      const stats = await this.#r2Stats();
      return stats !== null;
    } catch {
      return true;
    }
  }

  /** Observes one evaluation's alarm (window-keyed persistence). */
  async #observe(evaluation: LimitEvaluation, nowMs: number): Promise<AlarmEvaluation> {
    const windowKey =
      evaluation.window === "calendar-day"
        ? calendarDayKey(nowMs)
        : evaluation.window === "calendar-month"
          ? calendarMonthKey(nowMs)
          : "stock";
    return observeAlarm(this.#redis, evaluation, windowKey, nowMs);
  }

  #limitOf(limitId: string): ProviderLimitDefinition {
    const found = this.#ledger.limits.find((limit) => limit.limitId === limitId);
    if (found === undefined) {
      throw new Error(`the guardrail ledger has no limit '${limitId}'`);
    }
    return found;
  }

  #unitOf(limitId: string): string | null {
    return USER_COMPUTE_QUOTA_UNITS.find((entry) => entry.limitId === limitId)?.unitId ?? null;
  }
}

/** Creates the guardrails service (the composition wires the real seams). */
export function createGuardrailsService(options: GuardrailsServiceOptions): GuardrailsService {
  return new GuardrailsService(options);
}

export {
  CommandCounter,
  MeteredRedis,
  calendarDayKey,
  calendarMonthKey,
  monthlyCommandsKey,
  readCounter,
  readUserDailyUsage,
  recordUserDailyUsage,
  userDailyUsageKey,
} from "./usage";
export type { MeteredCostUnit } from "./usage";
export { observeAlarm, alarmKey, alarmTtlSeconds } from "./alarms";
export type { AlarmEvaluation, PersistedAlarmState } from "./alarms";
export { ProviderCapacityLimitError, admissionRetryAfterSeconds } from "./admission";
export {
  DEFAULT_FREE_TIER_LEDGER,
  DEFAULT_WARNING_RATIO,
  LEDGER_CHECKED_NOTE,
  classifyUsage,
  evaluateLimit,
  limitEnvName,
  resolveLedger,
  WARNING_RATIO_ENV,
} from "./ledger";
export type {
  GuardrailProvider,
  LimitEvaluation,
  LimitUsageState,
  ProviderLimitDefinition,
  ResolvedLedger,
  UsageWindowKind,
} from "./ledger";
