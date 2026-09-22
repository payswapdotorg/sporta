/**
 * THE RIGHTS-AUDIT DISCOVERABILITY SERVICE (J009 — wave 4, Worker B) — the
 * route-facing composition over `@sporta/session`'s role-gated audit query
 * seam (the wave-3 domain service): the Rights Holder and Operator
 * workspaces reach the REAL rights audit trail without guessing URLs.
 *
 * THE SEAM (the domain service's own boundaries, answered verbatim):
 * - UNAUTHENTICATED callers get the honest 401 (`unauthenticated`);
 * - OPERATORS reach every trail (the operational view);
 * - RIGHTS HOLDERS reach the trails of sessions THEY OWN;
 * - every other standing denies 403 uniformly (`role-not-granted` for the
 *   workspace scope; `not-resource-owner` / `unknown-resource` for a
 *   specific session — no existence oracle).
 *
 * THE ASYNC→SYNC BRIDGE (documented, never a semantic change): the domain
 * query service's lookups (`ownerIdOf`, `sessionIdsOfOwner`) are
 * synchronous ports over an app whose ownership store is async. This
 * service resolves the REAL ownership through the REAL async store FIRST,
 * then constructs the domain query service per call with closures that
 * answer the pre-resolved REAL values — the domain seam still makes every
 * authorize decision (the identity policy, the closed vocabularies, the
 * fail-closed rules); only the I/O timing is bridged. A pre-read that races
 * a concurrent ownership write fails CLOSED (an unresolved owner denies
 * unknown-resource), never open.
 *
 * WHAT THE TRAIL CONTAINS: the domain-vocabulary rights entries —
 * policy edits and revocations with the J008 `editKind` classification,
 * read from the SAME append-only log the Rights Center's policy console
 * shows. Publication-visibility events are W916 publication decisions
 * (outside the domain vocabulary): they stay on the policy console's own
 * trail, which the audit surface links to honestly.
 */
import { createRightsAuditQueryService } from "@sporta/session";
import type { RightsAuditEntry } from "@sporta/session";
import type { Account } from "@sporta/identity";
import { AuthFlowError } from "./auth-service";
import type { SportaServer } from "./composition";

/** One domain-vocabulary audit entry, as the audit surface answers it. */
export type RightsAuditTrailEntry = RightsAuditEntry;

/** The audit-trail document (the workspace scope, or one session's trail). */
export interface RightsAuditTrailModel {
  /** The caller's scope for this answer (the domain seam's own). */
  scope: "own" | "operator";
  /**
   * The session the trail is focused on (`null` = the whole workspace
   * scope). For a focused trail the scope still names the standing the
   * caller reached it by.
   */
  sessionId: string | null;
  entries: RightsAuditTrailEntry[];
  /** The honest boundary note (what this trail covers, what it does not). */
  note: string;
}

/** The honest note for every allowed answer (one wording, both scopes). */
const TRAIL_NOTE =
  "Every entry is append-only — who changed which session's rights, when, and what the change did (grant, widen, narrow, revoke), classified by the domain rights editor. Publication-visibility changes are recorded on the Rights Center's policy console trail.";

/**
 * Builds the caller's WORKSPACE audit trail (the /audit surface's default
 * view) through the domain seam's `auditTrailInScope`.
 */
export async function buildRightsAuditTrail(
  server: SportaServer,
  token: string,
): Promise<RightsAuditTrailModel> {
  const account = await resolveAccount(server, token);
  if (account === null) {
    // The domain seam's own 401 — exercised through it, verbatim.
    const anonymous = createRightsAuditQueryService({
      audit: server.domainRightsAudit,
      ownerIdOf: () => null,
      sessionIdsOfOwner: () => [],
    });
    const denied = anonymous.auditTrailInScope(null);
    if (denied.kind === "denied") {
      throw denialOf(denied.reason, denied.httpStatus);
    }
    throw new AuthFlowError(
      401,
      "unauthenticated",
      "the rights audit trail requires a signed-in account",
    );
  }
  // Pre-resolve the REAL owned-session list (the rights-holder workspace
  // scope) through the REAL async ownership store + the real session list.
  const owned = await ownedSessionIdsOf(server, account.userId);
  const query = createRightsAuditQueryService({
    audit: server.domainRightsAudit,
    // The workspace-scope query never resolves a per-session owner (its
    // answer is role-scoped); the fail-closed null keeps the port honest.
    ownerIdOf: () => null,
    sessionIdsOfOwner: (ownerId) => (ownerId === account.userId ? owned : []),
  });
  const result = query.auditTrailInScope({ userId: account.userId, roles: [...account.roles] });
  if (result.kind === "denied") throw denialOf(result.reason, result.httpStatus);
  return {
    scope: result.scope,
    sessionId: null,
    entries: result.entries,
    note: TRAIL_NOTE,
  };
}

/** The uniform sentinel for "no mediated session has this id" (no oracle). */
const NOT_OWNED = "\u0000not-a-user";

/**
 * Builds ONE session's rights audit trail through the domain seam's
 * `auditTrailFor` (the drill-down view, e.g. from a Rights Center entry).
 */
export async function buildRightsAuditTrailFor(
  server: SportaServer,
  token: string,
  sessionId: string,
): Promise<RightsAuditTrailModel> {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new AuthFlowError(400, "validation", "sessionId must be a non-empty string");
  }
  const account = await resolveAccount(server, token);
  // Pre-resolve the REAL ownership of THIS session (the domain seam's
  // authorize resource context) before the seam decides. The ownership
  // SENTINEL (the control gate's own composition rule): an unreadable
  // ownership record feeds the identity layer a real-but-nobody owner, so a
  // non-owner sees exactly the same denial as for someone else's session —
  // uniform, existence-free (no oracle).
  const resolvedOwnerId = await server.ownership.ownerIdOf(sessionId);
  const ownerId = resolvedOwnerId === null ? NOT_OWNED : resolvedOwnerId;
  const query = createRightsAuditQueryService({
    audit: server.domainRightsAudit,
    ownerIdOf: (id) => (id === sessionId ? ownerId : null),
    sessionIdsOfOwner: () => [],
  });
  const result = query.auditTrailFor(
    account === null ? null : { userId: account.userId, roles: [...account.roles] },
    sessionId,
  );
  if (result.kind === "denied") throw denialOf(result.reason, result.httpStatus);
  return {
    scope: result.scope,
    sessionId,
    entries: result.entries,
    note: TRAIL_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Resolves the caller's account (`null` = anonymous — the seam decides). */
async function resolveAccount(server: SportaServer, token: string): Promise<Account | null> {
  const resolved = await server.auth.resolve(token);
  return resolved === null ? null : resolved.account;
}

/**
 * The REAL owned-session ids (the async pre-resolution behind the domain
 * seam's synchronous `sessionIdsOfOwner` port). The session list + the
 * ownership store are the same sources every other scoped surface uses.
 */
async function ownedSessionIdsOf(server: SportaServer, userId: string): Promise<string[]> {
  const { sessions } = await server.control.listSessions();
  const owned: string[] = [];
  for (const summary of sessions) {
    const ownerId = await server.ownership.ownerIdOf(summary.id);
    if (ownerId === userId) owned.push(summary.id);
  }
  return owned;
}

/** Maps one domain denial onto the app's typed error convention (verbatim status). */
function denialOf(reason: string, httpStatus: 401 | 403): AuthFlowError {
  return new AuthFlowError(
    httpStatus,
    httpStatus === 401 ? "unauthenticated" : "permission-denied",
    httpStatus === 401
      ? "the rights audit trail requires a signed-in account"
      : reason === "not-resource-owner"
        ? "this account does not own the session (and holds no operator grant) — the rights audit trail denies uniformly"
        : reason === "unknown-resource"
          ? "the session's ownership is not readable, so the audit trail denies (fail-closed — no existence oracle)"
          : "the rights audit trail requires the rights-holder or operator grant (roles are grants — switching the active role never grants one)",
    { seam: "rights-audit-query", reason },
  );
}
