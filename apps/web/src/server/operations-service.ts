/**
 * THE OPERATIONS SERVICE (W918) — the operator console's server side, over
 * the REAL seams only:
 *
 * - ACCESS: every surface and action re-authorizes the caller against the
 *   identity layer's CLOSED vocabulary — `provider-health.read`, the one
 *   OPERATOR-only action (a non-operator gets the real typed 403, an
 *   anonymous caller the real 401; no console surface is reachable by
 *   grant-less accounts);
 * - HEALTH: the honest platform snapshot — the same provider probes the
 *   public health route runs (Neon/R2/Upstash reachability + the honest
 *   `unconfigured` states), PLUS the compute provider selection and the live
 *   transport state (the console's own wider frame);
 * - QUEUES: the W913 bounded render queue's live state — depth vs the hard
 *   bound, the per-job admission views, and the admission refusals counted
 *   at the studio dispatch seam (where a full queue actually refuses);
 * - PROVIDERS: usage counters ONLY where a real provider seam exposes them
 *   (the R2 store's never-silent stats; the compute adapter's accounting
 *   identities; the queue depth) and HONEST `unknown` where none exists
 *   (Neon exposes no usage counter over our seam; Upstash's REST port has no
 *   INFO/SCAN) — the documented free-tier limits ride along as the W919
 *   seam, never as measured facts;
 * - JOBS: the compute ledger — every studio-dispatched job with its live
 *   state and, once terminal, the never-silent completion envelope
 *   (failure errorClass/message, input accounting, metered usage);
 * - REMEDIATION (safe actions ONLY): `retry` re-dispatches a FAILED job
 *   through the REAL studio dispatch path (a NEW job id, the full W913
 *   admission ladder — quota charged to the OPERATOR, bounded-queue
 *   admission, no bypass; never a status flip), `cancel` runs the compute
 *   adapter's real `cancel` (idempotent, never loses a job) and returns the
 *   bounded-queue admission slot. Every action is AUDIT-LOGGED with actor,
 *   target, outcome and refusal reasons.
 *
 * HONEST LIMITATIONS: the audit trail and the studio job index are
 * in-memory with the composition's other control-plane state (the durable
 * seam is W919/W920); admission refusals are counted at the app's dispatch
 * seam only (jobs the queue refuses before this process sees them are not
 * observable); provider usage beyond the exposed seams is honestly `unknown`.
 */
import type { StudioJobRow } from "./create-studio-service";
import { AuthFlowError } from "./auth-service";
import {
  controlPlaneOverrideOf,
  identityPlaneOverrideOf,
  platformSnapshot,
} from "./platform-health";

import {
  IdentityPermissionDeniedError,
  IdentityValidationError,
  authorize,
} from "@sporta/identity";
import type { Account } from "@sporta/identity";
import type { ComputeAdapterPort } from "@sporta/compute-adapter";
import type { SportaServer } from "./composition";
import { deployMarker, platformEnv, r2Configured, upstashConfigured } from "./platform/env";
import { neonClient } from "./platform/db/pg";
import { getHostedRenderOutputStore } from "./platform/r2/hosted";
import type { R2RenderOutputStore } from "./platform/r2/r2-store";
import { getHostedTransientState } from "./platform/upstash/redis";
import { HOSTED_QUEUE_KEY, RENDER_REQUESTS_QUOTA } from "./platform/upstash/hosted";
import { QueueFullError, RateLimitedError } from "./platform/upstash/guards";

/** The console's closed remediation-action vocabulary. */
export type OperationsAction = "job.retry" | "job.cancel";

/** One audit-recorded remediation attempt (both outcomes are recorded). */
export interface OperationsAuditRecord {
  atMs: number;
  actorUserId: string;
  actorUsername: string;
  action: OperationsAction;
  targetJobId: string;
  sessionId: string | null;
  outcome: "succeeded" | "refused";
  /** What happened (the new job id on retry; the refusal reason otherwise). */
  detail: string;
}

/** One provider's live check (never a secret value). */
export interface OperationsProviderCheck {
  provider: "neon" | "r2" | "upstash";
  configured: boolean;
  state: "ok" | "unconfigured" | "error";
  detail: string;
}

/** One spend alarm in the health view (the W919 limit states). */
export interface OperationsSpendAlarmView {
  limitId: string;
  provider: string;
  state: "under" | "approaching" | "reached" | "exceeded" | "unmeasured";
  used: number | null;
  limit: number;
  unit: string;
  changedAtMs: number;
  /** True when THIS observation changed the persisted (window-scoped) alarm. */
  transitioned: boolean;
  /** The state before this observation (null on first observation). */
  previousState: string | null;
}

/** The health panel's snapshot (the honest platform state). */
export interface OperationsHealthView {
  env: ReturnType<typeof platformEnv>;
  deployMarker: string | null;
  overall: "ok" | "degraded" | "error";
  providers: {
    identity: OperationsProviderCheck;
    artifacts: OperationsProviderCheck;
    transientState: OperationsProviderCheck;
  };
  /**
   * The W919 spend alarms (window-scoped, persisted): the current limit
   * states with their transition stamps — a warning is `approaching`, the
   * degraded state is `reached`/`exceeded`.
   */
  spendAlarms: OperationsSpendAlarmView[];
  compute: {
    configured: boolean;
    provider: string | null;
    adapterId: string | null;
  };
  liveTransport: { state: string; note: string };
  renderQueue: {
    key: string;
    maxDepth: number;
    admissionLeaseMs: number;
    /** Live depth (null = the queue could not be read — never invented). */
    depth: number | null;
  };
}

/** One admitted (queued) job's console view. */
export interface OperationsQueueEntryView {
  jobId: string;
  userId: string | null;
  kind: string;
  enqueuedAtMs: number;
  ageMs: number;
}

/** The queues panel's snapshot (the W913 bounded queue state). */
export interface OperationsQueuesView {
  provider: "upstash" | "in-memory";
  queue: {
    key: string;
    maxDepth: number;
    admissionLeaseMs: number;
    depth: number | null;
    utilization: number | null;
    entries: OperationsQueueEntryView[];
  };
  /** Refusals counted at the studio dispatch seam (where 503s happen). */
  admissionRefusals: {
    count: number;
    last: { atMs: number; depth: number; maxDepth: number } | null;
    note: string;
  };
}

/** One provider's quota/usage row (only real counters; honest unknowns). */
export interface OperationsProviderUsageView {
  provider: "r2" | "neon" | "upstash" | "compute";
  usage: "measured" | "unknown";
  counters: { name: string; value: number }[];
  limits: { name: string; value: number | string }[];
  /**
   * The W919 ledger evaluations for this provider: measured usage vs the
   * documented threshold (or the honest `unmeasured` state), with the
   * checked-date source note and the approaching/reached state.
   */
  limitStates: {
    limitId: string;
    name: string;
    used: number | null;
    limit: number;
    unit: string;
    state: "under" | "approaching" | "reached" | "exceeded" | "unmeasured";
    admissionEnforced: boolean;
    meterNote: string;
    source: string;
  }[];
  note: string;
}

/** The providers panel's snapshot. */
export interface OperationsProvidersView {
  providers: OperationsProviderUsageView[];
  notes: string[];
}

/** One job row in the compute ledger (the console's jobs table). */
export interface OperationsJobView {
  jobId: string;
  sessionId: string;
  state: string;
  rendererId: string | null;
  dispatchedByUserId: string | null;
  dispatchedAtMs: number;
  admission: { released: boolean; admissionId: string | null };
  renderId: string | null;
  /** Present once terminal — the never-silent completion envelope. */
  completion: {
    status: string;
    failure: { errorClass: string; message: string; terminal: string } | null;
    outputs: number;
    accounting: {
      consumedInputs: number;
      unconsumedInputs: { inputId: string; reason: string }[];
    } | null;
    usage: { unitId: string; quantity: number }[];
  } | null;
  /** Set when the control-plane projection is unavailable (honest). */
  unavailableReason: string | null;
}

/** The jobs panel's snapshot. */
export interface OperationsJobsView {
  jobs: OperationsJobView[];
  totals: { all: number; failed: number; inFlight: number; cancelled: number; succeeded: number };
  computeUnavailable: boolean;
}

/** The audit panel's snapshot. */
export interface OperationsAuditView {
  records: OperationsAuditRecord[];
  note: string;
}

/** The retry action's result. */
export interface OperationsRetryResult {
  originalJobId: string;
  newJobId: string;
  disposition: string;
  note: string;
}

/** The cancel action's result. */
export interface OperationsCancelResult {
  jobId: string;
  cancelled: boolean;
  /** Present when the job was already terminal (cancel is a counted no-op). */
  alreadyTerminal: string | null;
}

/** Options for {@link OperationsService}. */
export interface OperationsServiceOptions {
  /** The composed server (resolved lazily — the service outlives the literal). */
  getServer: () => SportaServer;
  /** Wall clock (audit records are stamped with it). */
  nowMs: () => number;
}

/** How many audit records the in-memory trail retains (the bounded window). */
const AUDIT_TRAIL_LIMIT = 200;

/** The store-limits note (the W504 bounds the health route also surfaces). */
const STORE_LIMITS_NOTE =
  "R2 store bounds (W504): 1,000 segments / 16 MiB per segment / 256 MiB total; provider usage meters are W919 scope.";

/** The operations console service (operator grant-gated). */
export class OperationsService {
  private readonly getServer: OperationsServiceOptions["getServer"];
  private readonly nowMs: () => number;
  private readonly auditRecords: OperationsAuditRecord[] = [];
  private admissionRefusalCount = 0;
  private lastAdmissionRefusal: { atMs: number; depth: number; maxDepth: number } | null = null;

  constructor(options: OperationsServiceOptions) {
    this.getServer = options.getServer;
    this.nowMs = options.nowMs;
  }

  // -----------------------------------------------------------------------
  // The operator gate (every surface + action calls this first)
  // -----------------------------------------------------------------------

  /**
   * The console's ONE access rule, from the identity layer's CLOSED action
   * vocabulary: `provider-health.read` is operator-only. Anonymous callers
   * get the identity layer's typed 401; non-operators the typed 403.
   */
  async requireOperator(token: string): Promise<Account> {
    const account = await this.getServer().gate.requireAccount(token);
    const decision = authorize(account, "provider-health.read");
    if (!decision.allowed) {
      throw new IdentityPermissionDeniedError("the operations console requires an operator grant", {
        action: "provider-health.read",
        reason: decision.reason,
      });
    }
    return account;
  }

  // -----------------------------------------------------------------------
  // Panels
  // -----------------------------------------------------------------------

  /** The health board: the honest platform snapshot, operator-gated. */
  async healthSnapshot(token: string): Promise<OperationsHealthView> {
    await this.requireOperator(token);
    const server = this.getServer();
    const [identity, artifacts, transientState] = await Promise.all([
      this.checkNeon(),
      this.checkR2(),
      this.checkUpstash(),
    ]);
    const queue = server.transientState.queue;
    let depth: number | null;
    try {
      depth = await queue.depth();
    } catch {
      depth = null;
    }
    // W919: the spend alarms (the ledger evaluation observes the current
    // window's alarm states — every limit, honest `unmeasured` included).
    let spendAlarms: OperationsSpendAlarmView[] = [];
    try {
      spendAlarms = (await server.guardrails.evaluateLimits()).alarms.map((alarm) => ({
        limitId: alarm.limitId,
        provider: alarm.provider,
        state: alarm.state,
        used: alarm.used,
        limit: alarm.limit,
        unit:
          server.guardrails.ledger.limits.find((limit) => limit.limitId === alarm.limitId)?.unit ??
          "",
        changedAtMs: alarm.changedAtMs,
        transitioned: alarm.transitioned,
        previousState: alarm.previousState,
      }));
    } catch {
      // The alarm evaluation itself failed: an empty view would lie — the
      // console says so instead (never fabricated alarm states).
      spendAlarms = [];
    }
    const states = [identity.state, artifacts.state, transientState.state];
    const overall: OperationsHealthView["overall"] = states.includes("error")
      ? "error"
      : states.includes("unconfigured")
        ? "degraded"
        : "ok";
    return {
      env: platformEnv(),
      deployMarker: deployMarker(),
      overall,
      providers: { identity, artifacts, transientState },
      spendAlarms,
      compute: {
        configured: server.compute !== null,
        provider: server.compute?.provider ?? null,
        adapterId: server.compute?.adapterId ?? null,
      },
      liveTransport: {
        state: server.live.state(),
        note: "live-network only while a real transport is serving (W915)",
      },
      renderQueue: {
        key: HOSTED_QUEUE_KEY,
        maxDepth: queue.maxDepth,
        admissionLeaseMs: queue.admissionLeaseMs,
        depth,
      },
    };
  }
  /** The queue panel: the W913 bounded queue's live state, operator-gated. */
  async queuesSnapshot(token: string): Promise<OperationsQueuesView> {
    await this.requireOperator(token);
    const server = this.getServer();
    const queue = server.transientState.queue;
    let depth: number | null;
    let entries: OperationsQueueEntryView[] = [];
    try {
      depth = await queue.depth();
      const snapshot = await queue.snapshot();
      entries = snapshot.map((entry) => ({
        jobId: entry.jobId,
        userId: entry.userId,
        kind: entry.kind,
        enqueuedAtMs: entry.enqueuedAtMs,
        ageMs: entry.ageMs,
      }));
    } catch {
      depth = null;
      entries = [];
    }
    return {
      provider: server.transientState.provider,
      queue: {
        key: HOSTED_QUEUE_KEY,
        maxDepth: queue.maxDepth,
        admissionLeaseMs: queue.admissionLeaseMs,
        depth,
        utilization: depth === null ? null : depth / queue.maxDepth,
        entries,
      },
      admissionRefusals: {
        count: this.admissionRefusalCount,
        last: this.lastAdmissionRefusal,
        note: "refusals counted at the studio dispatch seam (the only app path that offers jobs)",
      },
    };
  }

  /**
   * The provider panel: real usage counters where a seam exposes them, the
   * W919 free-tier ledger evaluated against the measured usage (usage vs
   * limit, approaching/reached states, checked-date source notes), honest
   * `unmeasured` rows where no counter exists over our seams.
   */
  async providersSnapshot(token: string): Promise<OperationsProvidersView> {
    await this.requireOperator(token);
    const server = this.getServer();

    // The W919 ledger evaluation (usage vs limit per provider; also observes
    // the window-scoped alarm transitions — the health panel reads those).
    const guardrail = await server.guardrails.evaluateLimits();
    const limitStatesOf = (provider: OperationsProviderUsageView["provider"]) =>
      guardrail.limits
        .filter((limit) => limit.provider === provider)
        .map((limit) => ({
          limitId: limit.limitId,
          name: limit.name,
          used: limit.used,
          limit: limit.limit,
          unit: limit.unit,
          state: limit.state,
          admissionEnforced: limit.admissionEnforced,
          meterNote: limit.meterNote,
          source: limit.source,
        }));

    // R2 — the W504 store's own never-silent counters, live.
    let r2Counters: { name: string; value: number }[] = [];
    let r2Usage: "measured" | "unknown" = "unknown";
    let r2Note = "R2 artifact store not configured (health reports in-memory artifacts).";
    const r2Store: R2RenderOutputStore | null = r2Configured()
      ? getHostedRenderOutputStore()
      : null;
    if (r2Store !== null) {
      try {
        const stats = await r2Store.stats();
        r2Counters = [
          { name: "stored-segments", value: stats.segments },
          { name: "stored-bytes", value: stats.totalBytes },
          { name: "duplicate-stores", value: stats.duplicateStores },
        ];
        r2Usage = "measured";
        r2Note = "measured live by the W504 store's own counters";
      } catch {
        r2Usage = "unknown";
        r2Note = "the configured R2 store could not be read (state error)";
      }
    }
    const r2Limits: { name: string; value: number | string }[] = [
      { name: "max-segments (store bound)", value: 1_000 },
      { name: "max-total-bytes (store bound)", value: 256 * 1024 * 1024 },
    ];

    // Neon — W919 measures the live database storage over the postgres seam
    // when configured (pg_database_size); CU-hours stay honestly unmeasured.
    const neonStorage = guardrail.limits.find((limit) => limit.limitId === "neon.storage-bytes");
    const neonCounters: { name: string; value: number }[] =
      neonStorage?.used !== undefined && neonStorage.used !== null
        ? [{ name: "database-storage-bytes", value: neonStorage.used }]
        : [];
    const neon: OperationsProviderUsageView = {
      provider: "neon",
      usage: neonCounters.length > 0 ? "measured" : "unknown",
      counters: neonCounters,
      limits: [],
      limitStates: limitStatesOf("neon"),
      note:
        neonCounters.length > 0
          ? "database storage measured live (pg_database_size over the postgres seam); CU-hours are honestly unmeasured (no counter over our seam)"
          : "the postgres seam is not configured — storage and CU-hours are honestly unmeasured",
    };

    // Upstash — the queue depth and the W919 port command counter are real;
    // data size needs INFO/SCAN the REST port does not expose.
    let upstashCounters: { name: string; value: number }[] = [];
    let upstashNote = "transient state runs on the in-memory fallback (no Upstash configured).";
    let upstashUsage: "measured" | "unknown" = "unknown";
    if (upstashConfigured()) {
      const state = getHostedTransientState();
      if (state.provider === "upstash") {
        try {
          const pong = await state.redis.ping();
          const depth = await server.transientState.queue.depth();
          upstashCounters = [
            { name: "ping", value: pong === "PONG" ? 1 : 0 },
            { name: "render-queue-depth", value: depth },
          ];
          upstashUsage = "measured";
          upstashNote =
            "queue depth measured live; data-size usage needs INFO/SCAN the port does not expose";
        } catch {
          upstashUsage = "unknown";
          upstashNote = "the Upstash REST client could not be reached";
        }
      }
    }
    const commandsEvaluation = guardrail.limits.find(
      (limit) => limit.limitId === "upstash.commands",
    );
    if (commandsEvaluation?.used !== undefined && commandsEvaluation.used !== null) {
      upstashCounters = [
        ...upstashCounters,
        { name: "commands-this-month (port meter)", value: commandsEvaluation.used },
      ];
      // The port command counter is real over BOTH backings (it counts what
      // this app issues through the port — the honest would-be Upstash volume
      // on the in-memory fallback).
      upstashUsage = "measured";
      if (!upstashConfigured()) {
        upstashNote =
          "commands counted at the port (the in-memory fallback's would-be Upstash volume); data-size usage needs INFO/SCAN the port does not expose";
      }
    }
    const upstash: OperationsProviderUsageView = {
      provider: "upstash",
      usage: upstashUsage,
      counters: upstashCounters,
      limits: [],
      limitStates: limitStatesOf("upstash"),
      note: upstashNote,
    };

    // Compute — the adapter's whole-plane accounting identities are real
    // counters, plus the W919 per-user daily metered totals (today, UTC).
    const adapter: ComputeAdapterPort | null = server.computeAdapter;
    let computeCounters: { name: string; value: number }[] = [];
    if (adapter !== null) {
      const stats = await adapter.stats();
      computeCounters = [
        { name: "jobs-dispatched", value: stats.jobsDispatched },
        { name: "admitted", value: stats.admitted },
        { name: "succeeded", value: stats.succeeded },
        { name: "failed", value: stats.failed },
        { name: "cancelled", value: stats.cancelled },
        { name: "dead-lettered", value: stats.deadLettered },
        { name: "in-flight", value: stats.inFlight },
        { name: "refused-admissions (adapter)", value: stats.refusedAdmissions },
        { name: "duplicate-dispatches", value: stats.duplicates },
      ];
      const dailyTotals = await server.guardrails.computeUsageTotals();
      if (dailyTotals !== null) {
        for (const total of dailyTotals) {
          computeCounters.push({ name: `${total.unitId} (today, metered)`, value: total.quantity });
        }
      }
    }
    const compute: OperationsProviderUsageView = {
      provider: "compute",
      usage: adapter === null ? "unknown" : "measured",
      counters: computeCounters,
      limits: [
        {
          name: "render-requests per user per hour",
          value: RENDER_REQUESTS_QUOTA.limit,
        },
      ],
      limitStates: limitStatesOf("compute"),
      note:
        adapter === null
          ? "no compute adapter is configured (COMPUTE_PROVIDER=none)"
          : "the compute adapter's own accounting identities (never silent) + today's metered usage; the per-user daily quotas are the W919 admission guard",
    };

    return {
      providers: [
        {
          provider: "r2",
          usage: r2Usage,
          counters: r2Counters,
          limits: r2Limits,
          limitStates: limitStatesOf("r2"),
          note: r2Note,
        },
        neon,
        upstash,
        compute,
      ],
      notes: [
        STORE_LIMITS_NOTE,
        "the W919 ledger evaluates measured usage against the documented free-tier thresholds (checked 2026-09-15 — docs/deployment/free-tier-matrix.md); unmeasured limits are honest unknowns, never estimates",
      ],
    };
  }

  /** The jobs panel: the compute ledger with FAILED jobs and their reasons. */
  async jobsListing(token: string): Promise<OperationsJobsView> {
    await this.requireOperator(token);
    return this.jobListingInternal();
  }

  /** The audit panel: the remediation trail (both outcomes). */
  async auditTrail(token: string): Promise<OperationsAuditView> {
    await this.requireOperator(token);
    return {
      records: [...this.auditRecords].reverse(),
      note: "in-memory with the composition's control-plane state (the durable seam is W919/W920)",
    };
  }

  // -----------------------------------------------------------------------
  // Remediation (safe actions only — reauthorized + audit-logged)
  // -----------------------------------------------------------------------

  /**
   * Retries one FAILED job by re-dispatching it through the REAL studio
   * path: a NEW job id, the full W913 admission ladder (the operator's own
   * per-user quota is charged, bounded-queue admission enforced) — never a
   * status flip of the failed job (which stays, honestly, in the ledger).
   */
  async retryFailedJob(token: string, jobId: string): Promise<OperationsRetryResult> {
    const operator = await this.requireOperator(token);
    const server = this.getServer();
    const entry = server.studio.jobLedger().find((job) => job.jobId === jobId);
    if (entry === undefined) {
      throw new IdentityValidationError(`unknown console job '${jobId}'`);
    }
    const current = await this.projectionOf(entry.sessionId, jobId);
    if (current.state !== "failed") {
      const refusal = `refused: job is '${current.state}', not 'failed' (retry is a failed-job remediation)`;
      this.record(operator, "job.retry", jobId, entry.sessionId, "refused", refusal);
      throw new IdentityValidationError(
        `only failed jobs can be retried — job '${jobId}' is '${current.state}'`,
      );
    }
    if (entry.dispatch === null) {
      const refusal = "refused: the original dispatch parameters are not recorded";
      this.record(operator, "job.retry", jobId, entry.sessionId, "refused", refusal);
      throw new IdentityValidationError(
        `the original dispatch parameters of job '${jobId}' are not recorded (cannot re-dispatch)`,
      );
    }
    try {
      const dispatch = await server.studio.dispatchRender({
        // The OPERATOR's own token: the retry passes the same identity gate
        // (owner-or-operator read) and the same quota/admission ladder as
        // any dispatch — there is no bypass path.
        token,
        sessionId: entry.sessionId,
        rendererId: entry.dispatch.rendererId,
        ...(entry.dispatch.rendererVersion !== undefined
          ? { rendererVersion: entry.dispatch.rendererVersion }
          : {}),
        ...(entry.dispatch.styleId !== undefined ? { styleId: entry.dispatch.styleId } : {}),
      });
      this.record(
        operator,
        "job.retry",
        jobId,
        entry.sessionId,
        "succeeded",
        `re-dispatched as new job ${dispatch.jobId} (renderer ${entry.dispatch.rendererId})`,
      );
      return {
        originalJobId: jobId,
        newJobId: dispatch.jobId,
        disposition: dispatch.disposition,
        note: "the failed job stays in the ledger; the retry is a NEW real job through the full admission ladder",
      };
    } catch (err) {
      const reason =
        err instanceof RateLimitedError || err instanceof QueueFullError
          ? `refused by the admission ladder: ${err.message}`
          : `refused: ${err instanceof Error ? err.message : String(err)}`;
      this.record(operator, "job.retry", jobId, entry.sessionId, "refused", reason);
      throw err;
    }
  }

  /**
   * Cancels one admitted (non-terminal) job through the compute adapter's
   * REAL `cancel` (idempotent, never loses a job — a racing provider report
   * is accounted superseded, never dropped) and returns the bounded-queue
   * admission slot. A terminal job is an honest counted no-op.
   */
  async cancelAdmittedJob(token: string, jobId: string): Promise<OperationsCancelResult> {
    const operator = await this.requireOperator(token);
    const server = this.getServer();
    const entry = server.studio.jobLedger().find((job) => job.jobId === jobId);
    if (entry === undefined) {
      throw new IdentityValidationError(`unknown console job '${jobId}'`);
    }
    const adapter = server.computeAdapter;
    if (adapter === null) {
      const refusal = "refused: no compute adapter is configured";
      this.record(operator, "job.cancel", jobId, entry.sessionId, "refused", refusal);
      throw new IdentityValidationError("no compute adapter is configured");
    }
    try {
      const outcome = await adapter.cancel(jobId);
      if (outcome.cancelled) {
        // The admission slot returns now (not waiting for a poll/lease).
        await server.studio.releaseAdmissionOf(jobId);
        this.record(
          operator,
          "job.cancel",
          jobId,
          entry.sessionId,
          "succeeded",
          "cancelled via the compute adapter; bounded-queue admission slot released",
        );
        return { jobId, cancelled: true, alreadyTerminal: null };
      }
      const disposition = `already-terminal (${outcome.terminalDisposition})`;
      this.record(
        operator,
        "job.cancel",
        jobId,
        entry.sessionId,
        "refused",
        `no-op: ${disposition}`,
      );
      return {
        jobId,
        cancelled: false,
        alreadyTerminal: outcome.terminalDisposition,
      };
    } catch (err) {
      const reason = `refused: ${err instanceof Error ? err.message : String(err)}`;
      this.record(operator, "job.cancel", jobId, entry.sessionId, "refused", reason);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // The dispatch-seam refusal counter (called by the studio's real path)
  // -----------------------------------------------------------------------

  /** Counts one bounded-queue admission refusal where it actually happens. */
  noteAdmissionRefusal(depth: number, maxDepth: number): void {
    this.admissionRefusalCount += 1;
    this.lastAdmissionRefusal = { atMs: this.nowMs(), depth, maxDepth };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** One provider's live check (no secret values, no invented states). */
  private async checkNeon(): Promise<OperationsProviderCheck> {
    const sql = neonClient();
    if (sql === null) {
      return { provider: "neon", configured: false, state: "unconfigured", detail: "postgres" };
    }
    try {
      await sql`SELECT 1`;
      return { provider: "neon", configured: true, state: "ok", detail: "postgres" };
    } catch {
      return { provider: "neon", configured: true, state: "error", detail: "postgres" };
    }
  }

  private async checkR2(): Promise<OperationsProviderCheck> {
    const store = r2Configured() ? getHostedRenderOutputStore() : null;
    if (store === null) {
      return { provider: "r2", configured: false, state: "unconfigured", detail: "in-memory" };
    }
    try {
      await store.stats();
      return { provider: "r2", configured: true, state: "ok", detail: store.describe().bucket };
    } catch {
      return { provider: "r2", configured: true, state: "error", detail: store.describe().bucket };
    }
  }

  private async checkUpstash(): Promise<OperationsProviderCheck> {
    const state = getHostedTransientState();
    if (state.provider === "in-memory") {
      return {
        provider: "upstash",
        configured: false,
        state: "unconfigured",
        detail: "in-memory",
      };
    }
    try {
      const pong = await state.redis.ping();
      return pong === "PONG"
        ? { provider: "upstash", configured: true, state: "ok", detail: "upstash" }
        : { provider: "upstash", configured: true, state: "error", detail: "upstash" };
    } catch {
      return { provider: "upstash", configured: true, state: "error", detail: "upstash" };
    }
  }

  /** The control-plane projection of one job (the app's canonical view). */
  private async projectionOf(
    sessionId: string,
    jobId: string,
  ): Promise<{
    state: string;
    projection: OperationsJobView["completion"];
    renderId: string | null;
  }> {
    const job = await this.getServer().control.getComputeJob(sessionId, jobId);
    // W919: the console's projection is a terminal-observation seam too — the
    // job's metered usage is recorded into the dispatching user's daily
    // counters (idempotent per job, attributed from the studio's recorded
    // dispatch — the same write seam the client poll paths use).
    if (job.completion !== undefined) {
      const dispatchedBy =
        this.getServer()
          .studio.jobLedger()
          .find((entry) => entry.jobId === jobId)?.dispatch?.dispatchedByUserId ?? null;
      await this.getServer().guardrails.noteJobUsage(
        dispatchedBy,
        jobId,
        job.completion.usage.costUnits,
      );
    }
    return {
      state: job.state,
      renderId: job.renderId ?? null,
      projection:
        job.completion === undefined
          ? null
          : {
              status: job.completion.status,
              failure: job.completion.failure ?? null,
              outputs: job.completion.outputs.length,
              accounting: {
                consumedInputs: job.completion.accounting.consumedInputIds.length,
                unconsumedInputs: job.completion.accounting.unconsumedInputs.map((input) => ({
                  inputId: input.inputId,
                  reason: input.reason,
                })),
              },
              usage: job.completion.usage.costUnits.map((unit) => ({
                unitId: unit.unitId,
                quantity: unit.quantity,
              })),
            },
    };
  }

  /** Builds the jobs listing over the studio's real ledger index. */
  private async jobListingInternal(): Promise<OperationsJobsView> {
    const server = this.getServer();
    const ledger = server.studio.jobLedger();
    const jobs: OperationsJobView[] = [];
    for (const entry of ledger) {
      let state = "unknown";
      let completion: OperationsJobView["completion"] = null;
      let renderId: string | null = null;
      let unavailableReason: string | null = null;
      try {
        const projection = await this.projectionOf(entry.sessionId, entry.jobId);
        state = projection.state;
        completion = projection.projection;
        renderId = projection.renderId;
      } catch (err) {
        // Honest: a job whose session (or projection) is gone says so —
        // the console never fabricates a state for it.
        state = "unavailable";
        unavailableReason = err instanceof Error ? err.message : String(err);
      }
      jobs.push({
        jobId: entry.jobId,
        sessionId: entry.sessionId,
        state,
        rendererId: entry.dispatch?.rendererId ?? null,
        dispatchedByUserId: entry.dispatch?.dispatchedByUserId ?? null,
        dispatchedAtMs: entry.dispatch?.dispatchedAtMs ?? 0,
        admission: {
          released: entry.admissionId === null,
          admissionId: entry.admissionId,
        },
        renderId,
        completion,
        unavailableReason,
      });
    }
    return {
      jobs,
      totals: {
        all: jobs.length,
        failed: jobs.filter((job) => job.state === "failed").length,
        inFlight: jobs.filter(
          (job) => job.state === "dispatched" || job.state === "executing" || job.state === "live",
        ).length,
        cancelled: jobs.filter((job) => job.state === "cancelled").length,
        succeeded: jobs.filter((job) => job.state === "succeeded").length,
      },
      computeUnavailable: server.compute === null,
    };
  }

  /** Records one audit row (bounded trail, newest retrievable first). */
  private record(
    operator: Account,
    action: OperationsAction,
    targetJobId: string,
    sessionId: string | null,
    outcome: OperationsAuditRecord["outcome"],
    detail: string,
  ): void {
    this.auditRecords.push({
      atMs: this.nowMs(),
      actorUserId: operator.userId,
      actorUsername: operator.username,
      action,
      targetJobId,
      sessionId,
      outcome,
      detail,
    });
    if (this.auditRecords.length > AUDIT_TRAIL_LIMIT) {
      this.auditRecords.splice(0, this.auditRecords.length - AUDIT_TRAIL_LIMIT);
    }
  }
}

/** Creates the operations console service. */
export function createOperationsService(options: OperationsServiceOptions): OperationsService {
  return new OperationsService(options);
}

/** One failed job row (operator scope). */
export interface FailedJobRow {
  sessionId: string;
  jobId: string;
  state: string;
  failureMessage?: string;
}

/** The Operations document (operator-only, real data). */
export interface OperationsModel {
  health: Awaited<ReturnType<typeof platformSnapshot>>;
  compute: {
    provider: string;
    adapterId: string;
  } | null;
  /** The W913 render queue's real observation (depth null = unreadable). */
  queues: {
    key: string;
    maxDepth: number;
    admissionLeaseMs: number;
    depth: number | null;
  };
  live: {
    state: "unavailable" | "active";
    detail: string;
    servingSources: number;
  };
  failedJobs: FailedJobRow[];
}

/** Builds the Operations document (callers must have passed the operator gate). */
export async function buildOperations(
  server: SportaServer,
  token: string,
): Promise<OperationsModel> {
  // J007/J014: the health board's control-plane AND identity rows report the
  // RUNNING composition's actual backing (the local sqlite stores the Bun
  // runtime constructed are invisible to the env-derived rows).
  const health = await platformSnapshot({
    ...controlPlaneOverrideOf(server),
    ...identityPlaneOverrideOf(server),
  });
  const live = server.live;

  // Failed jobs, operator scope: every session's dispatched jobs, read
  // through the studio's real owner/operator rule per session.
  const { sessions } = await server.control.listSessions();
  const failedJobs: FailedJobRow[] = [];
  const rows: StudioJobRow[] = [];
  for (const entry of sessions) {
    const jobs = await server.studio.sessionJobs(token, entry.id);
    rows.push(...jobs.jobs);
  }
  for (const row of rows) {
    if (row.state === "failed" || row.state === "dead-lettered") {
      failedJobs.push({
        sessionId: row.sessionId,
        jobId: row.jobId,
        state: row.state,
        ...(row.completion?.failureMessage !== undefined
          ? { failureMessage: row.completion.failureMessage }
          : {}),
      });
    }
  }

  return {
    health,
    compute:
      server.compute === null
        ? null
        : { provider: server.compute.provider, adapterId: server.compute.adapterId },
    // The SAME queue observation the health snapshot serves (one shared
    // implementation — the two surfaces can never drift).
    queues: health.renderQueue,
    live: {
      state: live.state(),
      detail: live.detail(),
      servingSources: live.listSources().length,
    },
    failedJobs,
  };
}

/** The operator gate for the Operations surface: the REAL identity policy. */
export async function requireOperationsAccess(
  server: SportaServer,
  token: string,
): Promise<{ userId: string }> {
  const resolved = await server.auth.resolve(token);
  if (resolved === null) {
    throw new AuthFlowError(401, "unauthenticated", "operations requires a signed-in account");
  }
  return { userId: resolved.account.userId };
}
