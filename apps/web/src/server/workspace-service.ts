/**
 * The role-workspace data service (W907) — the REAL server-side backing for
 * the per-role surfaces beyond the existing catalog/watch/studio reads:
 *
 * - the Rights Center (Rights Holder): the rights-policy state of the
 *   sessions the account owns — or, for operators, controls — every record
 *   read through the REAL identity control gate (owner/operator rule,
 *   deny-before-existence);
 * - the Jobs overview (Creator + Operator): the account's render jobs with
 *   their REAL compute state, each session re-read through the gate's
 *   resource rule (owner or operator — never the active role);
 * - pending work (the role switcher's badges): counts computed from the
 *   same real data planes, ONLY for roles the account holds.
 *
 * HONESTY RULES:
 * - Roles are GRANTS, not authority: every grant check here reads the
 *   account's stored grants, and every per-session read re-authorizes
 *   through `@sporta/identity`'s policy (ownership/operator) — the session's
 *   `activeRole` is never consulted (it is presentation context only).
 * - Denials are the REAL 403/401 paths (classified bodies, explanations),
 *   never UI-side hiding.
 * - No data plane exists for viewer/analyst/rights-holder pending work —
 *   those roles simply carry no badge (nothing is invented).
 */
import type { Role } from "@sporta/capability";
import type { Account } from "@sporta/identity";
import { formatPendingWork } from "../lib/role-workspaces";
import type { SportaServer } from "./composition";
import type { StudioJobRow, StudioSessionJobs } from "./create-studio-service";
import { AuthFlowError } from "./auth-service";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The compute job states that mean "not settled yet" (in-flight work). */
const NON_TERMINAL_JOB_STATES: readonly string[] = [
  "admitted",
  "dispatched",
  "queued",
  "in-flight",
];

/** Requires a live session (the real 401 path). */
async function requireAccount(
  server: SportaServer,
  token: string,
): Promise<{ account: Account; token: string }> {
  const resolved = await server.auth.resolve(token);
  if (resolved === null) {
    throw new AuthFlowError(401, "unauthenticated", "this workspace requires a signed-in account");
  }
  return { account: resolved.account, token };
}

/** Whether the account holds a grant (roles are grants — never authority). */
function holds(account: Account, role: Role): boolean {
  return account.roles.includes(role);
}

/**
 * The sessions this account may read for the surface's scope: an operator
 * controls the platform's sessions; everyone else is scoped to the sessions
 * the account OWNS (the recorded ownership — the same rule the identity
 * policy enforces per action).
 */
async function scopedSessions(
  server: SportaServer,
  account: Account,
  scope: "owned" | "all",
): Promise<string[]> {
  const { sessions } = await server.control.listSessions();
  if (scope === "all") return sessions.map((entry) => entry.id);
  const owned: string[] = [];
  for (const entry of sessions) {
    const ownerId = await server.ownership.ownerIdOf(entry.id);
    if (ownerId === account.userId) owned.push(entry.id);
  }
  return owned;
}

/** Counts the rows whose state is not terminal (real pending work). */
export function countInFlight(rows: readonly { state: string }[]): number {
  return rows.filter((row) => NON_TERMINAL_JOB_STATES.includes(row.state)).length;
}

/** Counts the rows that failed for real (terminal failed completions). */
export function countFailed(rows: readonly { state: string }[]): number {
  return rows.filter((row) => row.state === "failed" || row.state === "dead-lettered").length;
}

// ---------------------------------------------------------------------------
// The Rights Center (Rights Holder workspace)
// ---------------------------------------------------------------------------

/** One rights-policy record, as the Rights Center renders it. */
export interface RightsCenterEntry {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  /** The session's policy record id (the control plane's real reference). */
  policyId: string;
  /** The REAL fail-closed derived capability decision at request time. */
  rightsCapabilities: {
    canReferenceSourceFrames: boolean;
    canDeliverLive: boolean;
    canStoreDerivatives: boolean;
    canShare: boolean;
  };
  /** The real publication visibility flag. */
  visibility: "public" | "private";
  /** Why the record is in this caller's scope. */
  access: "owned" | "operator";
  /** ADDITIVE (J008): the effective policy document, when one is recorded. */
  policy: {
    policyId: string;
    allowedOperations: string[];
    assertedBy: string;
    expiresAtIso?: string;
    storageDurationDays?: number;
    sharingScope?: string;
  } | null;
  /** ADDITIVE (J008): the creation record vs a rights-holder edit. */
  effectiveSource: "creation" | "edited" | "unrecorded";
  /** ADDITIVE (J008): whether the effective policy is currently out of force. */
  revoked: boolean;
  /** ADDITIVE (J008): the newest rights change (the domain editKind rides). */
  lastChange: {
    atIso: string;
    actorUserId: string;
    changeKind: string;
    editKind?: "grant" | "widen" | "narrow" | "revoke";
  } | null;
}

/** The Rights Center document. */
export interface RightsCenterModel {
  /** The caller's scope for this answer. */
  scope: "owned" | "operator";
  entries: RightsCenterEntry[];
  /**
   * The honest boundary note: the control plane exposes each session's
   * policy id + derived capability decision; editing rights policies is
   * W917 scope (this center is read-only by design).
   */
  note: string;
}

/** The gate's media-session read answer (the control plane's real shape). */
type GatedSession = {
  session: { status: string; createdAtIso: string; authorizationPolicyId: string };
  rightsCapabilities: RightsCenterEntry["rightsCapabilities"];
};

/**
 * Builds the Rights Center: every session the account owns (operators: every
 * session), each policy record read through the REAL control gate — the
 * owner/operator resource rule with deny-before-existence, exactly the same
 * authorization the watch/studio surfaces re-run per request.
 */
export async function buildRightsCenter(
  server: SportaServer,
  token: string,
): Promise<RightsCenterModel> {
  const { account } = await requireAccount(server, token);
  const isOperator = holds(account, "operator");
  if (!isOperator && !holds(account, "rights-holder")) {
    throw new AuthFlowError(
      403,
      "permission-denied",
      "the Rights Center requires the rights-holder grant (roles are grants — switching the active role never grants one)",
      { requiredGrant: "rights-holder" },
    );
  }
  const scope = isOperator ? "operator" : "owned";
  const sessionIds = await scopedSessions(server, account, isOperator ? "all" : "owned");
  const { sessions } = await server.control.listSessions();
  const entries: RightsCenterEntry[] = [];
  for (const sessionId of sessionIds) {
    // The REAL gate read: owner or operator, denial uniform whether or not
    // the session exists (no existence oracle).
    const gated = (await server.gate.getMediaSession(token, sessionId)) as GatedSession;
    const label = sessions.find((entry) => entry.id === sessionId)?.sourceLabel ?? sessionId;
    const policy = server.rightsPolicies.effectiveOf(sessionId);
    const edited = server.rightsPolicies.hasOverride(sessionId);
    const last = server.rightsAudit.lastOf(sessionId);
    entries.push({
      sessionId,
      label,
      status: gated.session.status,
      createdAtIso: gated.session.createdAtIso,
      policyId: gated.session.authorizationPolicyId,
      rightsCapabilities: gated.rightsCapabilities,
      visibility: server.publication.visibilityOf(sessionId),
      access: isOperator ? "operator" : "owned",
      policy:
        policy === null
          ? null
          : {
              policyId: policy.policyId,
              allowedOperations: [...policy.allowedOperations],
              assertedBy: policy.assertedBy,
              ...(policy.expiresAtIso !== undefined ? { expiresAtIso: policy.expiresAtIso } : {}),
              ...(policy.storageDurationDays !== undefined
                ? { storageDurationDays: policy.storageDurationDays }
                : {}),
              ...(policy.sharingScope !== undefined ? { sharingScope: policy.sharingScope } : {}),
            },
      effectiveSource: policy === null ? "unrecorded" : edited ? "edited" : "creation",
      revoked:
        policy !== null &&
        policy.expiresAtIso !== undefined &&
        Date.parse(policy.expiresAtIso) <= server.nowMs(),
      lastChange:
        last === null
          ? null
          : {
              atIso: last.atIso,
              actorUserId: last.actorUserId,
              changeKind: last.changeKind,
              ...(last.editKind !== undefined ? { editKind: last.editKind } : {}),
            },
    });
  }
  return {
    scope,
    entries,
    note: "Each record is the session's effective rights policy (the creation record or a rights-holder edit through the domain rights editor) with its fail-closed derived capability decision at request time, read through the identity control gate. Edits narrow only — an edit can never widen past the creation-time attestation — and revocation stops playback and publication fail-closed. Every change is recorded in the append-only audit trail.",
  };
}

// ---------------------------------------------------------------------------
// The Jobs overview (Creator + Operator workspaces)
// ---------------------------------------------------------------------------

/** The Jobs workspace document. */
export interface JobsOverviewModel {
  scope: "owned" | "operator";
  sessions: StudioSessionJobs[];
}

/**
 * Builds the Jobs overview: the account's sessions (operators: every
 * session) with their dispatched jobs' REAL compute state. Every session is
 * re-read through the studio's owner/operator rule — the active role is
 * never consulted (it is presentation context only).
 */
export async function buildJobsOverview(
  server: SportaServer,
  token: string,
): Promise<JobsOverviewModel> {
  const { account } = await requireAccount(server, token);
  const isOperator = holds(account, "operator");
  if (!isOperator && !holds(account, "creator")) {
    throw new AuthFlowError(
      403,
      "permission-denied",
      "the Jobs workspace requires a creator or operator grant (roles are grants — switching the active role never grants one)",
      { requiredGrants: ["creator", "operator"] },
    );
  }
  const scope = isOperator ? "operator" : "owned";
  const sessionIds = await scopedSessions(server, account, isOperator ? "all" : "owned");
  const sessions: StudioSessionJobs[] = [];
  for (const sessionId of sessionIds) {
    sessions.push(await server.studio.sessionJobs(token, sessionId));
  }
  return { scope, sessions };
}

// ---------------------------------------------------------------------------
// Pending work (the role switcher's badges)
// ---------------------------------------------------------------------------

/** Per-role pending work, ONLY for roles the account holds (real data). */
export interface PendingWorkModel {
  roles: Partial<Record<Role, { label: string; count: number }>>;
}

/**
 * Builds the pending-work badges from the real data planes:
 * - creator: jobs not yet settled across the account's OWN sessions;
 * - operator: failed jobs across the platform's sessions;
 * - viewer/analyst/rights-holder: no pending-work data plane exists —
 *   no badge (honest absence, never a fabricated zero).
 */
export async function buildPendingWork(
  server: SportaServer,
  token: string,
): Promise<PendingWorkModel> {
  const { account } = await requireAccount(server, token);
  const roles: PendingWorkModel["roles"] = {};

  if (holds(account, "creator")) {
    const sessionIds = await scopedSessions(server, account, "owned");
    const rows: StudioJobRow[] = [];
    for (const sessionId of sessionIds) {
      rows.push(...(await server.studio.sessionJobs(token, sessionId)).jobs);
    }
    // The badge the switcher renders is the lib's OWN formatPendingWork —
    // one formatting rule, so the server's badge and the client's model
    // can never drift apart.
    const badge = formatPendingWork("creator-jobs", countInFlight(rows));
    if (badge !== null) roles.creator = badge;
  }

  if (holds(account, "operator")) {
    const sessionIds = await scopedSessions(server, account, "all");
    const rows: StudioJobRow[] = [];
    for (const sessionId of sessionIds) {
      rows.push(...(await server.studio.sessionJobs(token, sessionId)).jobs);
    }
    const badge = formatPendingWork("operator-failures", countFailed(rows));
    if (badge !== null) roles.operator = badge;
  }

  return { roles };
}
