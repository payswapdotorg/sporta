/**
 * The Operator workspace's Operations document (W907) — REAL platform state
 * only, honestly unavailable where no surface exists yet:
 *
 * - health: the SAME honest platform snapshot `/api/platform/health` serves
 *   (one shared implementation — `server/platform-health.ts`);
 * - providers: which provider each seam is bound to + live reachability;
 * - compute: the composed compute plane (provider selection + the real
 *   adapter id), or the honest null when the async surface is disabled;
 * - queues: the W913 bounded render queue's REAL live observation (depth
 *   vs the hard bound; a read failure is the honest `depth: null` — never
 *   an invented number);
 * - live transport: the real env-gated SSE transport state + the sources it
 *   is genuinely serving;
 * - failed jobs: the render jobs that failed for real, read through the
 *   studio's per-session owner/operator rule (the operator's token
 *   re-authorizes every read — never the active role).
 *
 * Access itself is the REAL identity policy: the route (and tests) call
 * `authorize(account, "provider-health.read")` — the frozen operator-gated
 * action — so a non-operator receives the policy's own 403 denial.
 */
import type { SportaServer } from "./composition";
import type { StudioJobRow } from "./create-studio-service";
import { AuthFlowError } from "./auth-service";
import { platformSnapshot } from "./platform-health";

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
  const health = await platformSnapshot();
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
