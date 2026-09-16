/**
 * THE FREE-TIER LIMIT LEDGER (W919) — the documented provider limits we can
 * METER, as configurable thresholds with checked-date source notes.
 *
 * Sources (checked 2026-09-15 — docs/deployment/free-tier-matrix.md):
 * - Cloudflare R2 free: 10 GB-month storage, 1M Class A / 10M Class B
 *   operations per month, free egress.
 * - Upstash Redis free: 256 MB data, 10 GB bandwidth, 500K commands/month.
 * - Neon free: 50 CU-hours/project/month, 0.5 GB storage/project.
 *
 * METERED vs HONESTLY UNKNOWN — the ledger never fabricates usage:
 *
 * - `r2.storage-bytes` — METERED live by the W504/W912 R2 store's own
 *   never-silent `stats().totalBytes` (a stock, not a flow).
 * - `r2.class-a-operations` / `r2.class-b-operations` — UNMETERED: the
 *   store seam exposes no operation counter (Class A/B are provider-side
 *   meters). Reported as `unmeasured`, never estimated.
 * - `upstash.data-bytes` — UNMETERED: the REST port exposes no INFO/SCAN.
 * - `upstash.commands` — METERED at the RedisLike port: the metered redis
 *   wrapper (./usage.ts) counts every command this application issues
 *   through the port, in the calendar-month window the allowance is for.
 * - `neon.storage-bytes` — METERED when `DATABASE_URL` is configured, by a
 *   live `pg_database_size(current_database())` read over the postgres
 *   seam; honestly `unmeasured` in the local (unconfigured) state.
 * - `neon.compute-cu-hours` — UNMETERED (documented): Neon exposes no
 *   CU-hour counter over our seam.
 * - `compute.cpu-ms-day` / `compute.artifact-bytes-day` — PRODUCT admission
 *   quotas (per-user daily windows), METERED from the compute adapter's
 *   per-job usage records (the W914 metering drain the studio notes at the
 *   terminal poll seam). These are the deployment contract's "per-user/job
 *   quotas" (docs/architecture/deployment-architecture.md § Cost safety).
 *
 * CONFIGURABILITY: every threshold is overridable through the environment
 * (`SPORTA_LIMIT_<ID>` with `_` for `.`/`-`; e.g.
 * `SPORTA_LIMIT_R2_STORAGE_BYTES`, `SPORTA_LIMIT_COMPUTE_CPU_MS_DAY`) plus
 * `SPORTA_LIMIT_WARNING_RATIO` for the approaching/warning threshold. A
 * present-but-invalid override FAILS LOUD (a bad guardrail config must never
 * silently run with the default it replaced).
 */

/** The provider a limit belongs to. */
export type GuardrailProvider = "r2" | "upstash" | "neon" | "compute";

/** The window a usage counter aggregates over. */
export type UsageWindowKind = "calendar-day" | "calendar-month" | "stock";

/** One documented limit (id + threshold + how usage is — or is not — metered). */
export interface ProviderLimitDefinition {
  /** Stable id (`provider.measure[-window]`), used in quotas[] + alarms + env overrides. */
  limitId: string;
  provider: GuardrailProvider;
  /** Human label for the console. */
  name: string;
  /** The threshold (the configurable part). */
  limit: number;
  /** The unit (bytes / commands / ms / cu-hours). */
  unit: string;
  /** The provider-side window the allowance is defined over. */
  window: UsageWindowKind;
  /** Whether a REAL seam meters usage for this limit. */
  metered: boolean;
  /** The seam that meters it, or the honest reason none does. */
  meterNote: string;
  /** Where the threshold was checked (date + document). */
  source: string;
  /** Whether admission refuses at this limit (hard guardrail) or only alarms. */
  admissionEnforced: boolean;
}

/** The default warning threshold (usage >= limit * ratio => approaching). */
export const DEFAULT_WARNING_RATIO = 0.8;

/** Where the documented limits were checked (rides with every evaluation). */
export const LEDGER_CHECKED_NOTE = "checked 2026-09-15 — docs/deployment/free-tier-matrix.md";

const R2_GIB = 10 * 1024 * 1024 * 1024;
const UPSTASH_MB = 256 * 1024 * 1024;
const NEON_STORAGE = 512 * 1024 * 1024;

/**
 * The DEFAULT ledger. Constants (not invented runtime knobs): the values are
 * the documented free allowances, overridable per deployment through env.
 */
export const DEFAULT_FREE_TIER_LEDGER: readonly ProviderLimitDefinition[] = Object.freeze([
  {
    limitId: "r2.storage-bytes",
    provider: "r2",
    name: "R2 stored bytes",
    limit: R2_GIB,
    unit: "bytes",
    window: "stock",
    metered: true,
    meterNote: "the R2 artifact store's never-silent stats().totalBytes (live stock)",
    source: LEDGER_CHECKED_NOTE,
    admissionEnforced: true,
  },
  {
    limitId: "r2.class-a-operations",
    provider: "r2",
    name: "R2 Class A operations",
    limit: 1_000_000,
    unit: "operations",
    window: "calendar-month",
    metered: false,
    meterNote: "no operation counter exists at the store seam (Class A is a provider-side meter)",
    source: LEDGER_CHECKED_NOTE,
    admissionEnforced: false,
  },
  {
    limitId: "r2.class-b-operations",
    provider: "r2",
    name: "R2 Class B operations",
    limit: 10_000_000,
    unit: "operations",
    window: "calendar-month",
    metered: false,
    meterNote: "no operation counter exists at the store seam (Class B is a provider-side meter)",
    source: LEDGER_CHECKED_NOTE,
    admissionEnforced: false,
  },
  {
    limitId: "upstash.data-bytes",
    provider: "upstash",
    name: "Upstash data size",
    limit: UPSTASH_MB,
    unit: "bytes",
    window: "stock",
    metered: false,
    meterNote: "the REST port exposes no INFO/SCAN (no data-size counter over our seam)",
    source: LEDGER_CHECKED_NOTE,
    admissionEnforced: false,
  },
  {
    limitId: "upstash.commands",
    provider: "upstash",
    name: "Upstash commands",
    limit: 500_000,
    unit: "commands",
    window: "calendar-month",
    metered: true,
    meterNote: "counted at the RedisLike port (every command this app issues through it)",
    source: LEDGER_CHECKED_NOTE,
    admissionEnforced: true,
  },
  {
    limitId: "neon.storage-bytes",
    provider: "neon",
    name: "Neon database storage",
    limit: NEON_STORAGE,
    unit: "bytes",
    window: "stock",
    metered: true,
    meterNote:
      "pg_database_size(current_database()) over the postgres seam when DATABASE_URL is configured; honestly unmeasured in the local state",
    source: LEDGER_CHECKED_NOTE,
    admissionEnforced: false,
  },
  {
    limitId: "neon.compute-cu-hours",
    provider: "neon",
    name: "Neon compute CU-hours",
    limit: 50,
    unit: "cu-hours/project",
    window: "calendar-month",
    metered: false,
    meterNote: "Neon exposes no CU-hour counter over our seam (honestly unmeasured)",
    source: LEDGER_CHECKED_NOTE,
    admissionEnforced: false,
  },
  {
    limitId: "compute.cpu-ms-day",
    provider: "compute",
    name: "Metered compute per user per day",
    limit: 600_000,
    unit: "ms",
    window: "calendar-day",
    metered: true,
    meterNote: "the compute adapter's per-job cpu-ms usage records, attributed to the dispatching user",
    source: "product admission quota (deployment-architecture.md § Cost safety: per-user quotas)",
    admissionEnforced: true,
  },
  {
    limitId: "compute.artifact-bytes-day",
    provider: "compute",
    name: "Encoded artifact bytes per user per day",
    limit: 100_000_000,
    unit: "bytes",
    window: "calendar-day",
    metered: true,
    meterNote: "the compute adapter's per-job artifact-bytes usage records, attributed to the dispatching user",
    source: "product admission quota (deployment-architecture.md § Cost safety: per-user quotas)",
    admissionEnforced: true,
  },
] as const);

/** The env-var name a limit's override lives under. */
export function limitEnvName(limitId: string): string {
  return `SPORTA_LIMIT_${limitId.toUpperCase().replace(/[.-]/g, "_")}`;
}

/** The env-var name of the approaching/warning ratio override. */
export const WARNING_RATIO_ENV = "SPORTA_LIMIT_WARNING_RATIO";

function parsePositiveNumber(raw: string, envName: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `${envName} must be a positive number (got '${raw}') — a bad guardrail config fails loud, never silently`,
    );
  }
  return parsed;
}

/** The resolved ledger: documented defaults + validated env overrides. */
export interface ResolvedLedger {
  /** The limits with their effective (possibly overridden) thresholds. */
  limits: readonly ProviderLimitDefinition[];
  /** The effective warning ratio. */
  warningRatio: number;
  /** Which env overrides were applied (env name -> value), for honest notes. */
  overrides: { envName: string; value: number }[];
}

/**
 * Resolves the ledger for this process: every documented default, with any
 * present env override applied (fail-loud on invalid overrides).
 */
export function resolveLedger(env: Record<string, string | undefined> = process.env): ResolvedLedger {
  const overrides: { envName: string; value: number }[] = [];
  const limits = DEFAULT_FREE_TIER_LEDGER.map((limit) => {
    const envName = limitEnvName(limit.limitId);
    const raw = env[envName];
    if (raw === undefined) return limit;
    const value = parsePositiveNumber(raw, envName);
    overrides.push({ envName, value });
    return { ...limit, limit: value };
  });
  let warningRatio = DEFAULT_WARNING_RATIO;
  const rawRatio = env[WARNING_RATIO_ENV];
  if (rawRatio !== undefined) {
    const parsed = parsePositiveNumber(rawRatio, WARNING_RATIO_ENV);
    if (parsed >= 1) {
      throw new Error(
        `${WARNING_RATIO_ENV} must be below 1 (got '${rawRatio}') — the warning threshold precedes the hard limit`,
      );
    }
    warningRatio = parsed;
    overrides.push({ envName: WARNING_RATIO_ENV, value: parsed });
  }
  return { limits, warningRatio, overrides };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** The evaluated state of one limit against its measured usage. */
export type LimitUsageState = "under" | "approaching" | "reached" | "exceeded" | "unmeasured";

/** One evaluated ledger row (usage vs limit — the W918 providers-panel upgrade). */
export interface LimitEvaluation {
  limitId: string;
  provider: GuardrailProvider;
  name: string;
  unit: string;
  window: UsageWindowKind;
  /** The measured usage (null when unmeasured — never fabricated). */
  used: number | null;
  limit: number;
  /** used/limit (null when unmeasured). */
  ratio: number | null;
  state: LimitUsageState;
  admissionEnforced: boolean;
  meterNote: string;
  source: string;
}

/** Classifies measured usage against a limit + warning ratio. */
export function classifyUsage(
  used: number,
  limit: number,
  warningRatio: number,
): Exclude<LimitUsageState, "unmeasured"> {
  if (used > limit) return "exceeded";
  if (used >= limit) return "reached";
  if (used >= limit * warningRatio) return "approaching";
  return "under";
}

/** Evaluates one limit from a (possibly null) measurement. */
export function evaluateLimit(
  limit: ProviderLimitDefinition,
  used: number | null,
  warningRatio: number,
): LimitEvaluation {
  if (used === null || !limit.metered) {
    return {
      limitId: limit.limitId,
      provider: limit.provider,
      name: limit.name,
      unit: limit.unit,
      window: limit.window,
      used: null,
      limit: limit.limit,
      ratio: null,
      state: "unmeasured",
      admissionEnforced: limit.admissionEnforced,
      meterNote: limit.meterNote,
      source: limit.source,
    };
  }
  const state = classifyUsage(used, limit.limit, warningRatio);
  return {
    limitId: limit.limitId,
    provider: limit.provider,
    name: limit.name,
    unit: limit.unit,
    window: limit.window,
    used,
    limit: limit.limit,
    ratio: used / limit.limit,
    state,
    admissionEnforced: limit.admissionEnforced,
    meterNote: limit.meterNote,
    source: limit.source,
  };
}
