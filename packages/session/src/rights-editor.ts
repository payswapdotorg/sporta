/**
 * THE RIGHTS EDITOR SERVICE (J008 domain) — grant/widen/narrow/revoke over
 * the per-session effective authorization policies, with capability
 * RE-DERIVATION from the edited rights, the audit records, and the
 * fail-closed enforcement composition at the serving seams.
 *
 * THE SEAM (survey-conformant — the J006 B/C split precedent): the W917 app
 * layer implements the rights-center flows over IN-MEMORY app-layer stores;
 * THIS module is the DOMAIN service with the same semantics (mirrored,
 * never forked) over the durable `packages/session` rights stores, exposed
 * for the later UI lane to compose. The user-facing edit surface is NOT
 * here (the J-item stays honestly PARTIAL until that lane lands).
 *
 * THE RULES (each mapped to its authority):
 *
 * - CONTRACT-OWNED SEMANTICS: policies are validated by the frozen
 *   `AuthorizationPolicy` zod schema; capabilities come ONLY from
 *   `deriveRightsCapabilities` (the REAL derivation, reused verbatim);
 *   revocation is the contract's own time bound (the effective policy's
 *   `expiresAtIso` just before the revocation moment → DENY_ALL).
 * - RE-ATTESTATION (the W902 gate pattern): a caller NEVER asserts their own
 *   `assertedBy` — the editor overwrites it with the VERIFIED editor id
 *   before storing; the audit entry records the same verified actor.
 * - NARROW-ONLY CEILING (the W917 `intersectCaps` rule): an edit that widens
 *   past the creation-time attestation is STORED (honestly, audited as a
 *   widen) but has NO capability effect — `effectiveCapabilitiesOf`
 *   intersects the derivations. Documented, pinned by tests.
 * - EXPIRY SANITY: an edit whose `expiresAtIso` is in the past at edit time
 *   is REFUSED (fail-loud — the W917 400-equivalent); the REVOKE operation
 *   is the one deliberate exception (it sets exactly `now - 1ms`).
 * - AUDIT EVERY CHANGE: every grant/edit/revoke appends one append-only
 *   `RightsAuditEntry` (who/what/when/from/to + the J008 editKind
 *   classification: grant | widen | narrow | revoke — deterministic, from
 *   the derived-capability comparison).
 * - FAIL-LOUD SESSION CHECK: an edit/revoke on a session the composition
 *   has never observed (no creation record, no override, and — when a
 *   session lookup is injected — no session document) is REFUSED typed
 *   (never a silent no-op, never a fabricated record).
 */
import { AuthorizationPolicy, deriveRightsCapabilities } from "@sporta/contracts";
import type { AuthorizationPolicy as AuthorizationPolicyDoc } from "@sporta/contracts";
import type { RightsCapabilities } from "@sporta/contracts";
import {
  effectiveCapabilitiesOf,
  type EffectivePolicyStore,
  type RightsAuditStore,
  type RightsEditKind,
} from "./rights-store";

/** A refused rights edit (fail-loud, never a silent no-op). */
export class RightsEditorValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`rights editor refused the input: ${issues.join("; ")}`);
    this.name = "RightsEditorValidationError";
  }
}

/** The verified editor identity (the caller's authenticated account id). */
export interface RightsEditorActor {
  /** The VERIFIED account id (re-attested onto the policy — never a caller claim). */
  userId: string;
}

/** An optional session-existence lookup (refuse edits on unknown sessions). */
export type SessionLookup = (sessionId: string) => { exists: boolean } | null;

/** Options for {@link createRightsEditor}. */
export interface RightsEditorOptions {
  /** The effective-policy store (creation records + overrides). */
  policies: EffectivePolicyStore;
  /** The append-only audit trail. */
  audit: RightsAuditStore;
  /** The composition's clock (epoch ms — every derivation/re-attestation time). */
  nowMs: () => number;
  /**
   * An optional session-existence lookup (the media-session repository read
   * seam): edits for sessions that do not exist refuse fail-loud. When
   * absent, the store's own records are the existence boundary (honest —
   * documented).
   */
  sessions?: SessionLookup;
}

/** One session's rights state as the editor answers it (the inspect seam). */
export interface RightsStateView {
  sessionId: string;
  /** The EFFECTIVE policy (`null` = unrecorded — honestly unknown). */
  effectivePolicy: AuthorizationPolicyDoc | null;
  /** Whether the effective policy is an EDIT rather than the creation record. */
  isEdit: boolean;
  /** The REAL fail-closed derivation at the requested time (never asserted). */
  capabilities: RightsCapabilities;
  /** Whether the effective policy is currently revoked (expired by a revocation). */
  revoked: boolean;
  /** The newest audit entry, when one exists. */
  lastChange: { atIso: string; actorUserId: string; editKind: RightsEditKind } | null;
}

/** The result of one applied change (the audit entry + the re-derived state). */
export interface RightsEditResult {
  /** The applied policy (re-attested, contract-validated). */
  policy: AuthorizationPolicyDoc;
  /** The capabilities re-derived from the EDITED rights at the edit time. */
  capabilities: RightsCapabilities;
  /** The audit entry appended for the change. */
  audit: { atIso: string; editKind: RightsEditKind };
}

/** The ISO timestamp of an epoch-ms clock value (UTC — the audit's `atIso`). */
function isoOf(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

/** Classifies an edit against the prior effective policy (deterministic). */
function classifyEdit(prior: RightsCapabilities | null, next: RightsCapabilities): RightsEditKind {
  if (prior === null) return "grant"; // the first record for the session
  // A capability the prior derivation lacked → the edit WIDENS (the
  // ceiling-relevant direction); otherwise it narrows (or re-asserts —
  // conservatively "narrow", documented).
  for (const key of Object.keys(prior) as (keyof RightsCapabilities)[]) {
    if (next[key] && !prior[key]) return "widen";
  }
  return "narrow";
}

/**
 * The rights editor service (J008 domain). Created through
 * {@link createRightsEditor}; stateless over the injected stores (the
 * stores own the persistence, the editor owns the rules).
 */
export interface RightsEditor {
  /** Records the policy a session was CREATED with (the initial grant). */
  recordCreation(sessionId: string, actor: RightsEditorActor, policy: unknown): RightsEditResult;
  /** Edits the session's rights (a full policy document; re-attested + audited). */
  editPolicy(sessionId: string, actor: RightsEditorActor, policy: unknown): RightsEditResult;
  /** Revokes the session's rights (the time-bound → DENY_ALL; audited). */
  revoke(sessionId: string, actor: RightsEditorActor, reason?: string): RightsEditResult;
  /** The session's current rights state (the inspect seam — honest unknowns). */
  inspect(sessionId: string, nowMs?: number): RightsStateView;
}

/** Creates the rights editor (J008 domain service). */
export function createRightsEditor(options: RightsEditorOptions): RightsEditor {
  const policies = options.policies;
  const audit = options.audit;
  const nowMs = options.nowMs;
  const sessions = options.sessions;

  const requireSession = (sessionId: string): void => {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new RightsEditorValidationError(["sessionId must be a non-empty string"]);
    }
    if (sessions !== undefined) {
      const session = sessions(sessionId);
      if (session === null || session.exists !== true) {
        throw new RightsEditorValidationError([
          `session '${sessionId}' does not exist (the rights editor never fabricates a record for an unknown session)`,
        ]);
      }
    }
  };

  const requireActor = (actor: RightsEditorActor): void => {
    if (typeof actor?.userId !== "string" || actor.userId.length === 0) {
      throw new RightsEditorValidationError([
        "actor.userId must be a non-empty string (the VERIFIED editor id)",
      ]);
    }
  };

  const appendAudit = (
    sessionId: string,
    actorUserId: string,
    changeKind: "policy" | "revocation",
    editKind: RightsEditKind,
    summary: string,
    from: unknown,
    to: unknown,
  ): { atIso: string; editKind: RightsEditKind } => {
    const atIso = isoOf(nowMs());
    audit.append({
      atIso,
      actorUserId,
      sessionId,
      changeKind,
      editKind,
      summary,
      from,
      to,
    });
    return { atIso, editKind };
  };

  const deriveAt = (policy: AuthorizationPolicyDoc | null, atMs: number): RightsCapabilities =>
    deriveRightsCapabilities(policy, new Date(atMs));

  return {
    recordCreation(sessionId, actor, policy) {
      requireSession(sessionId);
      requireActor(actor);
      const atMs = nowMs();
      const parsed = parsePolicyDocument(policy, atMs);
      // The creation record is the initial GRANT (the re-attestation rule
      // applies — the VERIFIED creator id, never a caller claim).
      const reAttested: AuthorizationPolicyDoc = { ...parsed, assertedBy: actor.userId };
      policies.recordAtCreation(sessionId, reAttested);
      const capabilities = deriveAt(reAttested, atMs);
      const auditEntry = appendAudit(
        sessionId,
        actor.userId,
        "policy",
        "grant",
        `rights granted at creation: policy '${reAttested.policyId}' allows [${reAttested.allowedOperations.join(", ")}]`,
        null,
        reAttested,
      );
      return { policy: reAttested, capabilities, audit: auditEntry };
    },

    editPolicy(sessionId, actor, policy) {
      requireSession(sessionId);
      requireActor(actor);
      const atMs = nowMs();
      const parsed = parsePolicyDocument(policy, atMs);
      // The prior state (honest unknown when never recorded — the edit
      // becomes the session's first record, honestly classified "grant").
      const priorEffective = policies.effectiveOf(sessionId);
      if (
        priorEffective === null &&
        sessions === undefined &&
        policies.recordedOf(sessionId) === null &&
        !policies.hasOverride(sessionId)
      ) {
        throw new RightsEditorValidationError([
          `session '${sessionId}' has no rights record to edit (record the creation grant first — never a silent edit into the void)`,
        ]);
      }
      if (priorEffective === null && sessions !== undefined) {
        // The session exists (requireSession passed) but has no record: an
        // edit can honestly be the first record (the creation record was
        // never observed by this composition — recorded as a grant).
      }
      const reAttested: AuthorizationPolicyDoc = { ...parsed, assertedBy: actor.userId };
      policies.setOverride(sessionId, reAttested);
      const priorCaps = deriveAt(priorEffective, atMs);
      const nextCaps = deriveAt(reAttested, atMs);
      const editKind = classifyEdit(priorEffective === null ? null : priorCaps, nextCaps);
      const auditEntry = appendAudit(
        sessionId,
        actor.userId,
        "policy",
        editKind,
        `rights edited (${editKind}): policy '${reAttested.policyId}' now allows [${reAttested.allowedOperations.join(", ")}]${priorEffective !== null ? ` (was [${priorEffective.allowedOperations.join(", ")}])` : ""}`,
        priorEffective,
        reAttested,
      );
      return { policy: reAttested, capabilities: nextCaps, audit: auditEntry };
    },

    revoke(sessionId, actor, reason) {
      requireSession(sessionId);
      requireActor(actor);
      const atMs = nowMs();
      const priorEffective = policies.effectiveOf(sessionId);
      if (priorEffective === null) {
        throw new RightsEditorValidationError([
          `session '${sessionId}' has no rights record to revoke (nothing to revoke — never a fabricated revocation)`,
        ]);
      }
      // Revocation is the contract's own time bound: the effective policy,
      // expired just before the revocation moment (DENY_ALL by the REAL
      // derivation). The re-attestation rule applies to the revoking actor.
      const revoked: AuthorizationPolicyDoc = {
        ...priorEffective,
        assertedBy: actor.userId,
        expiresAtIso: isoOf(atMs - 1),
      };
      policies.setOverride(sessionId, revoked);
      const capabilities = deriveAt(revoked, atMs); // DENY_ALL (expired)
      const auditEntry = appendAudit(
        sessionId,
        actor.userId,
        "revocation",
        "revoke",
        `rights REVOKED at ${isoOf(atMs)}${reason !== undefined && reason.length > 0 ? ` — ${reason}` : ""} (the effective policy now expires ${revoked.expiresAtIso}: playback/publication fail closed)`,
        priorEffective,
        revoked,
      );
      return { policy: revoked, capabilities, audit: auditEntry };
    },

    inspect(sessionId, nowMsAt) {
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new RightsEditorValidationError(["sessionId must be a non-empty string"]);
      }
      const atMs = nowMsAt ?? nowMs();
      const effective = policies.effectiveOf(sessionId);
      const capabilities = effectiveCapabilitiesOf(policies, sessionId, new Date(atMs));
      const revoked =
        effective !== null &&
        effective.expiresAtIso !== undefined &&
        Date.parse(effective.expiresAtIso) <= atMs;
      const last = audit.lastOf(sessionId);
      return {
        sessionId,
        effectivePolicy: effective,
        isEdit: policies.hasOverride(sessionId),
        capabilities,
        revoked,
        lastChange:
          last === null
            ? null
            : { atIso: last.atIso, actorUserId: last.actorUserId, editKind: last.editKind },
      };
    },
  };
}

/** Parses + sanity-checks one policy document (fail-loud, the contract's own schema). */
function parsePolicyDocument(policy: unknown, atMs: number): AuthorizationPolicyDoc {
  if (typeof policy !== "object" || policy === null) {
    throw new RightsEditorValidationError(["policy must be an AuthorizationPolicy document"]);
  }
  const parsed = AuthorizationPolicy.safeParse(policy);
  if (!parsed.success) {
    throw new RightsEditorValidationError([
      `policy failed the frozen AuthorizationPolicy contract: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    ]);
  }
  const document = parsed.data;
  if (document.expiresAtIso !== undefined && Date.parse(document.expiresAtIso) <= atMs) {
    // The revoke operation is the ONE deliberate exception (it sets exactly
    // now - 1ms); a caller-supplied already-expired edit is refused.
    throw new RightsEditorValidationError([
      `policy '${document.policyId}' expires at ${document.expiresAtIso}, which is in the past at edit time (an edit may not arrive already expired — use revoke)`,
    ]);
  }
  return document;
}
