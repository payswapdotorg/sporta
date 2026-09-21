/**
 * Server-side authorization policy (W902) — the authority half of "roles are
 * grants, not authority" (role-experience-matrix).
 *
 * `authorize` is a PURE function of (account, action, resource): it decides
 * from the account's ROLE GRANTS and the resource's OWNER — never from the
 * session's `activeRole` (that is presentation context only; switching it can
 * never change a decision — pinned by tests).
 *
 * FAIL-CLOSED on everything unknown:
 *
 * - an unauthenticated caller (no account) denies every action;
 * - an unknown action denies (`unknown-action` — a typo in the action name
 *   can never fall through to allow);
 * - an unknown/unreadable resource denies (`unknown-resource`).
 *
 * The action vocabulary encodes the role-experience matrix rows the W902
 * boundary enforces (matrix rows not listed here — e.g. rights-policy
 * editing — are W917 and deny until that work order lands).
 */
import { ROLES, type Role } from "@sporta/capability";

/** The closed action vocabulary this wave enforces server-side. */
export const IDENTITY_ACTIONS = [
  "account.read",
  "account.switch-role",
  "media-session.create",
  "media-session.read",
  "media-session.terminate",
  "render-output.read",
  "provider-health.read",
  // J009 (rights/audit discoverability): who may READ the rights/policy
  // audit trails — rights holders reach their OWN sessions' trails (the
  // resource-owner branch), operators reach every trail (the matrix's
  // operational view). Every other role denies (role-not-granted);
  // unauthenticated denies (unauthenticated → the HTTP 401 boundary).
  "rights-audit.read",
  // J010 (analyst clips/notes): who may read/write analyst annotations on a
  // session — the session's owner, operators, and the analyst grant (the
  // annotations workspace). Every other role denies; unauthenticated denies.
  "analyst-annotation.read",
  "analyst-annotation.write",
] as const;
export type IdentityAction = (typeof IDENTITY_ACTIONS)[number];

/** Why a decision was denied (closed vocabulary). */
export type IdentityDenialReason =
  | "unauthenticated"
  | "unknown-action"
  | "unknown-resource"
  | "role-not-granted"
  | "not-resource-owner";

/** The allow verdict plus WHY (audit evidence, closed vocabulary). */
export type IdentityAllowVia =
  | "authenticated-self"
  | "grant:creator"
  | "grant:rights-holder"
  | "grant:analyst"
  | "grant:operator"
  | "resource-owner"
  | "grant:operator-or-resource-owner"
  | "grant:operator-or-resource-owner-or-analyst";

/** A policy decision: allow with provenance, or deny with a reason. */
export type AuthorizationDecision =
  { allowed: true; via: IdentityAllowVia } | { allowed: false; reason: IdentityDenialReason };

/** The minimum account shape the policy needs (grants + stable id). */
export interface PolicyAccount {
  userId: string;
  roles: readonly Role[];
}

/** The resource context an action targets (all fields optional). */
export interface ResourceContext {
  /** The account that owns the targeted resource, when it has an owner. */
  ownerId?: string;
  /** The role a `account.switch-role` action wants to activate. */
  targetRole?: Role;
}

/** Roles that may upload authorized source per the matrix (Creator, RightsHolder, Operator). */
const MEDIA_CREATE_GRANTS: readonly Role[] = ["creator", "rights-holder", "operator"];

/**
 * Decides `action` for `account` over `resource`. PURE and total: every
 * (account, action, resource) triple yields a decision — unknown anything
 * denies. See the module docs for the fail-closed rules.
 */
export function authorize(
  account: PolicyAccount | null | undefined,
  action: IdentityAction,
  resource: ResourceContext = {},
): AuthorizationDecision {
  if (account === null || account === undefined) {
    return { allowed: false, reason: "unauthenticated" };
  }
  const grants = new Set<Role>(account.roles);
  switch (action) {
    case "account.read":
      return { allowed: true, via: "authenticated-self" };
    case "account.switch-role": {
      const target = resource.targetRole;
      if (target === undefined || !ROLES.includes(target)) {
        return { allowed: false, reason: "unknown-resource" };
      }
      if (!grants.has(target)) {
        return { allowed: false, reason: "role-not-granted" };
      }
      return { allowed: true, via: "authenticated-self" };
    }
    case "media-session.create": {
      const via = MEDIA_CREATE_GRANTS.find((role) => grants.has(role));
      return via === undefined
        ? { allowed: false, reason: "role-not-granted" }
        : { allowed: true, via: `grant:${via}` as IdentityAllowVia };
    }
    case "media-session.read":
    case "media-session.terminate":
    case "render-output.read": {
      if (resource.ownerId === undefined) {
        return { allowed: false, reason: "unknown-resource" };
      }
      if (resource.ownerId === account.userId) {
        return { allowed: true, via: "resource-owner" };
      }
      if (grants.has("operator")) {
        return { allowed: true, via: "grant:operator" };
      }
      return { allowed: false, reason: "not-resource-owner" };
    }
    case "provider-health.read": {
      return grants.has("operator")
        ? { allowed: true, via: "grant:operator" }
        : { allowed: false, reason: "role-not-granted" };
    }
    case "rights-audit.read": {
      // J009: the rights/policy audit trails — an operator reaches every
      // trail (the operational view); a rights-holder reaches their OWN
      // sessions' trails (the resource-owner branch, exactly like
      // media-session.read); every other role denies.
      if (resource.ownerId === undefined) {
        return { allowed: false, reason: "unknown-resource" };
      }
      if (resource.ownerId === account.userId) {
        return { allowed: true, via: "resource-owner" };
      }
      if (grants.has("operator")) {
        return { allowed: true, via: "grant:operator" };
      }
      return { allowed: false, reason: "not-resource-owner" };
    }
    case "analyst-annotation.read":
    case "analyst-annotation.write": {
      // J010: the analyst annotations workspace — the session's owner, an
      // operator, or the analyst grant (an annotation is authored work on
      // an accessible session; the role-scoped publication visibility stays
      // an app-layer composition over this seam).
      if (resource.ownerId === undefined) {
        return { allowed: false, reason: "unknown-resource" };
      }
      if (resource.ownerId === account.userId) {
        return { allowed: true, via: "resource-owner" };
      }
      if (grants.has("operator")) {
        return { allowed: true, via: "grant:operator" };
      }
      if (grants.has("analyst")) {
        return { allowed: true, via: "grant:analyst" };
      }
      return { allowed: false, reason: "not-resource-owner" };
    }
    default: {
      // Exhaustiveness guard + fail-closed: an action outside the closed
      // vocabulary denies (this includes values typed as the union but not
      // present at runtime — e.g. a version-skewed producer).
      return { allowed: false, reason: "unknown-action" };
    }
  }
}

/** Type guard for runtime (untrusted) action strings. */
export function isIdentityAction(value: unknown): value is IdentityAction {
  return typeof value === "string" && (IDENTITY_ACTIONS as readonly string[]).includes(value);
}
