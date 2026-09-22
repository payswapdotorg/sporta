/**
 * THE RIGHTS CENTER SERVICE (W917) — the rights/publication backend: policy
 * INSPECTION, policy EDITING, VISIBILITY editing and REVOCATION for the
 * content an account owns or controls, over the REAL semantics.
 *
 * AUTHORIZATION (who is a "rights holder" here — fail-closed, no invention):
 * a caller may inspect/edit the rights + publication decisions of a session
 * when they are
 * - the session's OWNER (the ownership store + the identity layer's resource
 *   rule — `authorize(account, "media-session.read", { ownerId })`, the same
 *   decision the watch/studio surfaces re-run per request), or
 * - an OPERATOR (the matrix's operational view — the same resource rule's
 *   operator branch), or
 * - a RIGHTS HOLDER (the real grant) over a session whose rights policy THEY
 *   attested (the W916 attestation index: the gate records the VERIFIED
 *   account id at creation — never a caller's claim).
 * Everyone else receives a uniform 403 whether or not the session exists
 * (the ownership sentinel) — no existence oracle. Anonymous callers receive
 * the real 401.
 *
 * SEMANTICS (the REAL contracts, never re-invented here):
 * - a policy edit is validated by `AuthorizationPolicy` (the contracts'
 *   own zod schema) and re-attested with the EDITOR's verified account id
 *   (the W902 gate pattern: a caller never asserts their own `assertedBy`);
 * - an edit is stored as the session's policy OVERRIDE and takes effect on
 *   every subsequent rights read through the rights-governed control plane
 *   (./rights-governed-control.ts — fail-closed re-derivation per read);
 * - REVOCATION is the contract's own time-bound: the effective policy's
 *   `expiresAtIso` is set to the revocation moment, so
 *   `deriveRightsCapabilities` derives DENY_ALL — playback, rendering and
 *   live delivery stop — and the publication decision is set to `private`
 *   (the W916 content model), so the catalog, search and the anonymous watch
 *   surface stop serving it. Both stops are enforced by the EXISTING gates;
 *   this service only records the decisions.
 * - every change appends to the {@link PolicyAuditLog} (who/what/when —
 *   in-memory dev backing, documented there).
 */
import { deriveRightsCapabilities } from "@sporta/contracts";
import { RightsEditorValidationError } from "@sporta/session";
import type {
  AllowedOperation,
  AuthorizationPolicy as AuthorizationPolicyDoc,
  RightsCapabilities,
  SharingScope,
} from "@sporta/contracts";
import { ROLES, type Role } from "@sporta/capability";
import { authorize } from "@sporta/identity";
import { IdentityPermissionDeniedError } from "@sporta/identity";
import type { Account } from "@sporta/identity";
import { AuthFlowError } from "./auth-service";
import type { SportaServer } from "./composition";
import type { ContentVisibilityKind, ContentVisibilityRecord } from "./publication";
import type { PolicyAuditEntry, PolicyChangeKind } from "./rights-policy-store";
import type { RightsEditKind } from "@sporta/session";

/** The uniform sentinel for "no mediated session has this id" (no oracle). */
const NOT_OWNED = "\u0000not-a-user";

/** The policy document as the Rights Center answers it (contract-shaped). */
export interface RightsPolicyView {
  policyId: string;
  allowedOperations: AllowedOperation[];
  assertedBy: string;
  expiresAtIso?: string;
  storageDurationDays?: number;
  sharingScope?: SharingScope;
}

/** How a session's rights record reached the caller's scope. */
export type RightsAccess = "owned" | "attested" | "operator";

/** One session's rights/publication state (the Rights Center entry). */
export interface RightsPolicyEntry {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  /** Why this record is in the caller's scope. */
  access: RightsAccess;
  /** The effective policy (contract-shaped); `null` = unrecorded (honest). */
  policy: RightsPolicyView | null;
  /** Whether the effective policy is a rights-holder EDIT or the creation record. */
  effectiveSource: "creation" | "edited" | "unrecorded";
  /** The REAL fail-closed derivation at request time (never asserted). */
  rightsCapabilities: RightsCapabilities;
  /** `true` when the effective policy is currently out of force (expired). */
  revoked: boolean;
  /** The session's full publication record (`null` = unknown visibility). */
  visibility: ContentVisibilityRecord | null;
  /** The newest policy-change record, when one exists. */
  lastChange: {
    atIso: string;
    actorUserId: string;
    changeKind: PolicyChangeKind;
    editKind?: RightsEditKind;
  } | null;
}

/** The scoped list answer. */
export interface RightsCenterList {
  viewer: { userId: string; grants: readonly Role[] };
  entries: RightsPolicyEntry[];
  note: string;
}

/** The one-session inspection answer (entry + the session's audit trail). */
export interface RightsCenterInspect {
  entry: RightsPolicyEntry;
  audit: PolicyAuditEntry[];
}

/** The caller's audit trail (only entries for sessions in their scope). */
export interface RightsAuditView {
  viewer: { userId: string; grants: readonly Role[] };
  entries: PolicyAuditEntry[];
}

/** Options for {@link RightsCenterService}. */
export interface RightsCenterServiceOptions {
  getServer: () => SportaServer;
  nowMs: () => number;
}

/** The visibility edit input (the W916 kinds; `role-scoped` carries grants). */
export type VisibilityEdit =
  Exclude<ContentVisibilityKind, "role-scoped"> | { kind: "role-scoped"; roles: unknown };

/** The W917 Rights Center service. */
export class RightsCenterService {
  private readonly getServer: () => SportaServer;
  private readonly nowMs: () => number;

  constructor(options: RightsCenterServiceOptions) {
    this.getServer = options.getServer;
    this.nowMs = options.nowMs;
  }

  // -----------------------------------------------------------------------
  // Authorization
  // -----------------------------------------------------------------------

  /** Resolves the caller's account (the real 401 otherwise). */
  private async requireAccount(token: string): Promise<Account> {
    return this.getServer().gate.requireAccount(token);
  }

  /**
   * The rights-policy access rule (owner / operator / attesting rights
   * holder). A denial is uniform whether or not the session exists — the
   * ownership sentinel feeds the identity layer's own resource rule.
   */
  private async requirePolicyAccess(
    server: SportaServer,
    account: Account,
    sessionId: string,
  ): Promise<RightsAccess> {
    const ownerId = (await server.ownership.ownerIdOf(sessionId)) ?? NOT_OWNED;
    const decision = authorize(account, "media-session.read", { ownerId });
    if (decision.allowed) {
      return decision.via === "grant:operator" ? "operator" : "owned";
    }
    if (
      account.roles.includes("rights-holder") &&
      server.attestations.attestedByOf(sessionId) === account.userId
    ) {
      return "attested"; // the rights-holder grant over content they attested
    }
    throw new IdentityPermissionDeniedError(
      "rights policy access is not authorized for this account",
      { action: "media-session.read" },
    );
  }

  // -----------------------------------------------------------------------
  // Inspection
  // -----------------------------------------------------------------------

  /**
   * Lists every session's rights/publication state in the CALLER's scope:
   * owned sessions, plus (with the rights-holder grant) sessions whose
   * rights they attested, plus (operators) every session. No other user's
   * policies are ever included.
   */
  async listPolicies(token: string): Promise<RightsCenterList> {
    const server = this.getServer();
    const account = await this.requireAccount(token);
    const isOperator = account.roles.includes("operator");
    const mayAttestScope = account.roles.includes("rights-holder");
    const { sessions } = await server.control.listSessions();
    const entries: RightsPolicyEntry[] = [];
    for (const summary of sessions) {
      const ownerId = await server.ownership.ownerIdOf(summary.id);
      const attestedBy = server.attestations.attestedByOf(summary.id);
      let access: RightsAccess;
      if (isOperator) {
        access = "operator";
      } else if (ownerId === account.userId) {
        access = "owned";
      } else if (mayAttestScope && attestedBy === account.userId) {
        access = "attested";
      } else {
        continue; // not in this caller's scope — never listed
      }
      entries.push(
        await this.buildEntry(server, summary.id, summary.sourceLabel ?? summary.id, access),
      );
    }
    return {
      viewer: { userId: account.userId, grants: [...account.roles] },
      entries,
      note: "Each record is the session's effective rights policy (creation record or rights-holder edit) with its fail-closed derived capabilities at request time, plus its publication record. Edits and revocations are recorded in the policy audit log.",
    };
  }

  /**
   * Inspects ONE session's rights/publication state + its audit trail.
   * Requires policy access for that session (uniform 403 otherwise).
   */
  async inspectPolicy(token: string, sessionId: string): Promise<RightsCenterInspect> {
    const server = this.getServer();
    const account = await this.requireAccount(token);
    const access = await this.requirePolicyAccess(server, account, sessionId);
    const { sessions } = await server.control.listSessions();
    const label = sessions.find((entry) => entry.id === sessionId)?.sourceLabel ?? sessionId;
    const entry = await this.buildEntry(server, sessionId, label, access);
    return { entry, audit: server.rightsAudit.of(sessionId) };
  }

  /** The caller's policy-change audit trail (only their scope's sessions). */
  async auditTrail(token: string): Promise<RightsAuditView> {
    const server = this.getServer();
    const account = await this.requireAccount(token);
    const isOperator = account.roles.includes("operator");
    const mayAttestScope = account.roles.includes("rights-holder");
    const { sessions } = await server.control.listSessions();
    const inScope = new Set<string>();
    for (const summary of sessions) {
      const ownerId = await server.ownership.ownerIdOf(summary.id);
      if (
        isOperator ||
        ownerId === account.userId ||
        (mayAttestScope && server.attestations.attestedByOf(summary.id) === account.userId)
      ) {
        inScope.add(summary.id);
      }
    }
    const entries = isOperator ? server.rightsAudit.all() : server.rightsAudit.ofSessions(inScope);
    return { viewer: { userId: account.userId, grants: [...account.roles] }, entries };
  }

  // -----------------------------------------------------------------------
  // Editing
  // -----------------------------------------------------------------------

  /**
   * EDITS the session's rights policy — through the J008 DOMAIN EDITOR
   * (`@sporta/session`'s rights-editor `editPolicy`, wave 4): the ONE editor
   * behind both edit surfaces (this service's routes and the J008 Rights
   * Center UI). The domain seam validates the input against the REAL
   * `AuthorizationPolicy` contract schema (a malformed edit is a 400 and is
   * NEVER applied), REFUSES an already-expired edit (use revocation),
   * RE-ATTESTS with the editor's VERIFIED account id (the W902 rule — a
   * caller never asserts their own `assertedBy`), stores the override in the
   * SAME store the serving seams re-derive from (fail-closed on every
   * subsequent read), and appends ONE classified audit entry (`editKind`:
   * grant/widen/narrow — the deterministic domain classification).
   *
   * W917 narrow-only, unchanged: the effective capabilities remain the
   * intersection of the creation-time attestation and the current override —
   * a widening edit is stored + audited honestly (as a widen) but has NO
   * capability effect at any serving seam.
   */
  async setPolicy(
    token: string,
    sessionId: string,
    policyInput: unknown,
  ): Promise<RightsCenterInspect> {
    const server = this.getServer();
    const account = await this.requireAccount(token);
    await this.requirePolicyAccess(server, account, sessionId);
    await server.control.getSession(sessionId); // existence (the typed 404)

    try {
      // The domain seam owns every semantic from here (validation,
      // re-attestation, the override store, the classified audit entry).
      server.rightsEditor.editPolicy(sessionId, { userId: account.userId }, policyInput);
    } catch (err) {
      if (err instanceof RightsEditorValidationError) {
        // The domain's own refusal, mapped typed: a 400 that never applied.
        throw new AuthFlowError(400, "validation", err.message, {
          seam: "rights-editor",
        });
      }
      throw err;
    }
    return this.inspectPolicy(token, sessionId);
  }

  /**
   * EDITS the session's publication visibility (the W916 kinds). The input
   * is validated by the publication store's own rules (an unknown kind or a
   * role-scoped decision without valid grants is a 400, never stored) and
   * recorded as one audit entry.
   */
  async setVisibility(
    token: string,
    sessionId: string,
    visibility: VisibilityEdit,
  ): Promise<RightsCenterInspect> {
    const server = this.getServer();
    const account = await this.requireAccount(token);
    await this.requirePolicyAccess(server, account, sessionId);
    await server.control.getSession(sessionId); // existence (the typed 404)

    const from = server.publication.contentOf(sessionId);
    const input = this.visibilityInputOf(visibility, account.userId);
    server.publication.set(sessionId, input);
    const to = server.publication.contentOf(sessionId);
    // W921 write-through (fail-loud): the flip is durable so every instance
    // reconstructs the SAME publication state (fail-closed to private when
    // the parsed record is somehow invalid — never public).
    if (server.durable !== null) {
      await server.durable.noteVisibility(sessionId, {
        kind: to?.kind ?? "private",
        roles: [...(to?.roles ?? [])],
      });
    }
    this.appendAudit(server, account.userId, sessionId, "visibility", {
      summary: `set visibility to ${to?.kind ?? "unknown"}`,
      from,
      to,
    });
    return this.inspectPolicy(token, sessionId);
  }

  /**
   * REVOKES the session's rights — the policy half through the J008 DOMAIN
   * EDITOR (`@sporta/session`'s rights-editor `revoke`, wave 4), the
   * publication half the app-layer composition it already was:
   *
   * - the domain editor takes the effective policy out of force (its
   *   `expiresAtIso` = the revocation moment — the contracts' own
   *   time-bound; every later `deriveRightsCapabilities` answers DENY_ALL,
   *   so the watch model, the playback byte reads, the render dispatch and
   *   the live stream all stop fail-closed), re-attests the revoking actor,
   *   and appends the classified audit entry (`editKind: "revoke"`);
   * - the publication decision becomes `private` (the catalog, search and
   *   the anonymous watch surface stop serving the session — enforced by the
   *   existing watch gate, byte-identical to an unknown session), with the
   *   W921 durable write-through and its OWN visibility audit entry.
   */
  async revoke(token: string, sessionId: string, reason?: string): Promise<RightsCenterInspect> {
    const server = this.getServer();
    const account = await this.requireAccount(token);
    await this.requirePolicyAccess(server, account, sessionId);
    await server.control.getSession(sessionId); // existence (the typed 404)

    if (server.rightsPolicies.effectiveOf(sessionId) === null) {
      // Unreachable in this composition (every createSession is recorded),
      // but fail closed and honest if it ever happens.
      throw new AuthFlowError(
        400,
        "validation",
        "this session has no recorded rights policy — there is nothing to revoke through the rights center",
      );
    }
    const visibilityFrom = server.publication.contentOf(sessionId);

    // The RIGHTS half — the domain editor's own semantics (time-bound,
    // re-attestation, the classified revocation audit entry).
    try {
      server.rightsEditor.revoke(sessionId, { userId: account.userId }, reason);
    } catch (err) {
      if (err instanceof RightsEditorValidationError) {
        throw new AuthFlowError(400, "validation", err.message, { seam: "rights-editor" });
      }
      throw err;
    }

    // The PUBLICATION half — the app-layer content model (W916) + the W921
    // durable write-through, with its own append-only audit entry (each
    // entry records ONE decision: the rights revocation above, this
    // visibility flip here).
    server.publication.set(sessionId, { kind: "private", setBy: account.userId });
    if (server.durable !== null) {
      await server.durable.noteVisibility(sessionId, { kind: "private", roles: [] });
    }
    const visibilityTo = server.publication.contentOf(sessionId);
    this.appendAudit(server, account.userId, sessionId, "visibility", {
      summary:
        `revocation set visibility to private` +
        (reason !== undefined && reason.length > 0 ? ` (revocation reason: ${reason})` : ""),
      from: visibilityFrom,
      to: visibilityTo,
    });
    return this.inspectPolicy(token, sessionId);
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** Normalizes + validates the visibility edit into the store's own input. */
  private visibilityInputOf(
    visibility: VisibilityEdit,
    actorUserId: string,
  ): { kind: ContentVisibilityKind; roles?: readonly Role[]; setBy: string } {
    if (typeof visibility === "string") {
      if (visibility !== "public" && visibility !== "private" && visibility !== "unlisted") {
        throw new AuthFlowError(
          400,
          "validation",
          `unknown visibility kind "${visibility}" (closed vocabulary: public, private, unlisted, role-scoped)`,
        );
      }
      return { kind: visibility, setBy: actorUserId };
    }
    if (typeof visibility !== "object" || visibility === null || Array.isArray(visibility)) {
      throw new AuthFlowError(
        400,
        "validation",
        'visibility must be "public" | "private" | "unlisted" or { kind: "role-scoped", roles: [...] }',
      );
    }
    if (visibility.kind !== "role-scoped") {
      throw new AuthFlowError(
        400,
        "validation",
        `unknown visibility kind "${String(visibility.kind)}" (closed vocabulary: public, private, unlisted, role-scoped)`,
      );
    }
    if (!Array.isArray(visibility.roles) || visibility.roles.length === 0) {
      throw new AuthFlowError(
        400,
        "validation",
        "a role-scoped visibility requires a non-empty roles array (the grants that may discover and watch it)",
      );
    }
    const roles: Role[] = [];
    for (const entry of visibility.roles) {
      if (typeof entry !== "string" || !(ROLES as readonly string[]).includes(entry)) {
        throw new AuthFlowError(
          400,
          "validation",
          `unknown role "${String(entry)}" (closed vocabulary: ${ROLES.join(", ")})`,
        );
      }
      roles.push(entry as Role);
    }
    return { kind: "role-scoped", roles, setBy: actorUserId };
  }

  /** Appends one audit record (who/what/when — the composition's clock). */
  private appendAudit(
    server: SportaServer,
    actorUserId: string,
    sessionId: string,
    changeKind: PolicyChangeKind,
    record: { summary: string; from: unknown; to: unknown },
  ): void {
    server.rightsAudit.append({
      atIso: new Date(this.nowMs()).toISOString(),
      actorUserId,
      sessionId,
      changeKind,
      summary: record.summary,
      from: record.from,
      to: record.to,
    });
  }

  /** Builds one inspection entry from the REAL control-plane state. */
  private async buildEntry(
    server: SportaServer,
    sessionId: string,
    label: string,
    access: RightsAccess,
  ): Promise<RightsPolicyEntry> {
    const { session, rightsCapabilities } = await server.control.getSession(sessionId);
    const policy = server.rightsPolicies.effectiveOf(sessionId);
    const edited = server.rightsPolicies.hasOverride(sessionId);
    const last = server.rightsAudit.lastOf(sessionId);
    return {
      sessionId,
      label,
      status: session.status,
      createdAtIso: session.createdAtIso,
      access,
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
      rightsCapabilities, // the rights-governed control plane's re-derivation
      revoked:
        policy !== null &&
        policy.expiresAtIso !== undefined &&
        Date.parse(policy.expiresAtIso) <= this.nowMs(),
      visibility: server.publication.contentOf(sessionId),
      lastChange:
        last === null
          ? null
          : {
              atIso: last.atIso,
              actorUserId: last.actorUserId,
              changeKind: last.changeKind,
              ...(last.editKind !== undefined ? { editKind: last.editKind } : {}),
            },
    };
  }

  /** The REAL contract derivation, exposed for the UI's honest preview. */
  static capabilitiesOf(policy: AuthorizationPolicyDoc | null, nowMs: number): RightsCapabilities {
    return deriveRightsCapabilities(policy, new Date(nowMs));
  }
}
