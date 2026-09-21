/**
 * THE RIGHTS-AUDIT DISCOVERABILITY QUERY SEAM (J009 domain) — the role-gated
 * domain queries the workspace navigation (a LATER UI lane) will consume:
 * the rights/policy audit trails are REACHABLE by role (Rights Holder /
 * Operator) through a discoverable service seam, with HONEST 401/403
 * boundaries for every other role.
 *
 * THE SEAM (the J006 B/C split precedent): the app layer has HTTP routes
 * (`/api/rights/audit`) over its own in-memory log — that surface is NOT
 * this lane's (no `apps/web` ownership). THIS module is the DOMAIN query
 * seam over `@sporta/session`'s durable audit store, composed with
 * `@sporta/identity`'s `authorize` (the pure, fail-closed policy — the same
 * decision the app routes re-run per request): every query answers either
 * the allowed scoped entries or a TYPED denial carrying the honest HTTP
 * boundary (401 unauthenticated / 403 not-allowed) the API lane will map
 * verbatim.
 *
 * BOUNDARIES (closed, uniform — no existence oracle):
 * - unauthenticated callers deny 401 (`unauthenticated`);
 * - OPERATORS reach every trail (the operational view);
 * - RIGHTS HOLDERS (and owners) reach the trails of sessions THEY OWN —
 *   a caller without the owner/operator standing denies 403 uniformly,
 *   whether or not the session exists (`not-resource-owner`;
 *   `unknown-resource` when the ownership itself is unreadable).
 *
 * The OPERATIONS audit trail (jobs/failures) is the app layer's
 * (W918) — this seam serves the RIGHTS/policy trail the J009 acceptance
 * names for both roles; the operations-trail domain seam is recorded as a
 * boundary for the TL (see the delivery report).
 */
import { authorize } from "@sporta/identity";
import type { IdentityDenialReason } from "@sporta/identity";
import type { Role } from "@sporta/capability";
import type { RightsAuditEntry, RightsAuditStore } from "./rights-store";

/** The caller's account shape (the authorize policy's minimum). */
export interface AuditQueryAccount {
  userId: string;
  roles: readonly Role[];
}

/** The typed honest HTTP boundary a denial carries (the API lane maps it verbatim). */
export type AuditDenialHttpStatus = 401 | 403;

/**
 * One audit query's answer: the allowed scoped entries, or the typed denial
 * with the honest 401/403 boundary.
 */
export type RightsAuditQueryResult =
  | { kind: "allowed"; entries: RightsAuditEntry[]; scope: "own" | "operator" }
  | { kind: "denied"; reason: IdentityDenialReason; httpStatus: AuditDenialHttpStatus };

/** Options for {@link createRightsAuditQueryService}. */
export interface RightsAuditQueryOptions {
  /** The append-only rights audit trail (the domain store). */
  audit: RightsAuditStore;
  /** The media-ownership read: the owner of a session (`null` = no ownership record). */
  ownerIdOf: (sessionId: string) => string | null;
  /** The ownership listing: every session id the owner has (the rights-holder workspace scope). */
  sessionIdsOfOwner: (ownerId: string) => readonly string[];
}

/** A malformed query service configuration or input (fail-loud). */
export class RightsAuditQueryValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`rights audit query refused the input: ${issues.join("; ")}`);
    this.name = "RightsAuditQueryValidationError";
  }
}

/** The rights-audit discoverability query service (J009 domain seam). */
export interface RightsAuditQueryService {
  /** One session's rights audit trail — role/ownership gated (the honest 401/403 boundaries). */
  auditTrailFor(account: AuditQueryAccount | null, sessionId: string): RightsAuditQueryResult;
  /** The caller's workspace scope: every trail the role reaches (own sessions, or all for operators). */
  auditTrailInScope(account: AuditQueryAccount | null): RightsAuditQueryResult;
}

/** The typed denial for an unauthenticated caller (the 401 boundary). */
const UNAUTHENTICATED: RightsAuditQueryResult = {
  kind: "denied",
  reason: "unauthenticated",
  httpStatus: 401,
};

/** Creates the rights-audit query service (the J009 domain seam). */
export function createRightsAuditQueryService(
  options: RightsAuditQueryOptions,
): RightsAuditQueryService {
  if (typeof options?.audit?.of !== "function") {
    throw new RightsAuditQueryValidationError(["audit must be a RightsAuditStore"]);
  }
  if (typeof options?.ownerIdOf !== "function") {
    throw new RightsAuditQueryValidationError(["ownerIdOf must be a function"]);
  }
  if (typeof options?.sessionIdsOfOwner !== "function") {
    throw new RightsAuditQueryValidationError(["sessionIdsOfOwner must be a function"]);
  }
  const audit = options.audit;

  const requireSessionId = (sessionId: unknown): string => {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new RightsAuditQueryValidationError(["sessionId must be a non-empty string"]);
    }
    return sessionId;
  };

  const denialOf = (reason: IdentityDenialReason): RightsAuditQueryResult => ({
    kind: "denied",
    reason,
    httpStatus: reason === "unauthenticated" ? 401 : 403,
  });

  return {
    auditTrailFor(account, sessionId) {
      requireSessionId(sessionId);
      if (account === null || account === undefined) return UNAUTHENTICATED;
      // The ownership context: an unreadable ownership record denies
      // unknown-resource (uniform — no existence oracle: a 403 either way).
      const ownerId = options.ownerIdOf(sessionId);
      const decision = authorize(
        { userId: account.userId, roles: account.roles },
        "rights-audit.read",
        ownerId === null ? {} : { ownerId },
      );
      if (!decision.allowed) return denialOf(decision.reason);
      return {
        kind: "allowed",
        entries: audit.of(sessionId),
        scope: decision.via === "grant:operator" ? "operator" : "own",
      };
    },

    auditTrailInScope(account) {
      if (account === null || account === undefined) return UNAUTHENTICATED;
      // The operator's operational view: every trail.
      if (account.roles.includes("operator")) {
        return { kind: "allowed", entries: audit.all(), scope: "operator" };
      }
      // The rights-holder workspace: their OWN sessions' trails. Every other
      // role denies 403 (the honest boundary — a viewer/creator/analyst has
      // no audit workspace at all, even an empty one).
      if (!account.roles.includes("rights-holder")) {
        return denialOf("role-not-granted");
      }
      const owned = options.sessionIdsOfOwner(account.userId);
      return { kind: "allowed", entries: audit.ofSessions(new Set(owned)), scope: "own" };
    },
  };
}
