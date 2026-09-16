/**
 * THE RIGHTS-POLICY STORE + AUDIT LOG (W917) — the app-layer home of each
 * session's EFFECTIVE authorization policy and the append-only record of
 * every rights/publication decision change.
 *
 * WHY THIS EXISTS (the honest boundary): the control plane
 * (`@sporta/control-api`'s `createControlApp`) stores each session's policy
 * in an internal map and exposes no update route — by design, its policy is
 * the CREATION-time attestation. Rights holders nevertheless must be able
 * to inspect and CHANGE policies after creation (W917 acceptance). This
 * store is the composition's answer: it records every policy the control
 * plane accepts (see ./rights-governed-control.ts — the decorator that
 * observes `createSession`), holds any later EDIT as an explicit override,
 * and answers the EFFECTIVE policy (override ?? recorded) that the playback
 * path re-derives rights from, fail-closed, at every read.
 *
 * SEMANTICS (never invented — `@sporta/contracts` owns them):
 * - an override is a FULL `AuthorizationPolicy`, validated by the contract's
 *   own zod schema before it is ever stored here;
 * - revocation is the contract's own time-bound: a policy whose
 *   `expiresAtIso` is in the past derives DENY_ALL
 *   (`deriveRightsCapabilities` — the REAL derivation, reused verbatim);
 * - an override can only NARROW effective rights below the control plane's
 *   stored attestation: the raw control app still applies its own internal
 *   gate underneath every delegated call, so an edit can never widen access
 *   past the creation-time policy (documented, pinned by tests).
 *
 * ⚠️ HONEST LIMITATION: the backing is IN-MEMORY, process-local — exactly
 * where the composition keeps the rest of the control plane this wave. A
 * restart forgets the overrides (sessions fall back to their creation-time
 * policies). The durable seam is the hosted persistence layer behind this
 * same port.
 */
import type { AuthorizationPolicy } from "@sporta/contracts";

/**
 * The per-session policy registry: the creation-time record plus any later
 * override. The EFFECTIVE policy is `override ?? recorded`.
 */
export class EffectivePolicyStore {
  private readonly recordedAtCreation = new Map<string, AuthorizationPolicy>();
  private readonly overrides = new Map<string, AuthorizationPolicy>();

  /** Records the policy a session was created with (decorator call sites only). */
  recordAtCreation(sessionId: string, policy: AuthorizationPolicy): void {
    this.recordedAtCreation.set(sessionId, policy);
  }

  /** Records a rights holder's EDIT (a full, contract-validated policy). */
  setOverride(sessionId: string, policy: AuthorizationPolicy): void {
    this.overrides.set(sessionId, policy);
  }

  /** The creation-time policy, when this composition observed the creation. */
  recordedOf(sessionId: string): AuthorizationPolicy | null {
    return this.recordedAtCreation.get(sessionId) ?? null;
  }

  /** The current EDIT, when one exists (`null` = never edited). */
  overrideOf(sessionId: string): AuthorizationPolicy | null {
    return this.overrides.get(sessionId) ?? null;
  }

  /** The EFFECTIVE policy: the edit when one exists, else the creation record. */
  effectiveOf(sessionId: string): AuthorizationPolicy | null {
    return this.overrides.get(sessionId) ?? this.recordedAtCreation.get(sessionId) ?? null;
  }

  /** Whether an edit is in force for this session. */
  hasOverride(sessionId: string): boolean {
    return this.overrides.has(sessionId);
  }
}

/** The closed vocabulary of policy-change kinds (the audit's "what"). */
export type PolicyChangeKind = "visibility" | "policy" | "revocation";

/** One append-only audit record: WHO changed WHAT, on WHICH session, WHEN. */
export interface PolicyAuditEntry {
  /** When the change was applied (ISO-8601 UTC, the composition's clock). */
  atIso: string;
  /** The VERIFIED account that made the change (never a caller's claim). */
  actorUserId: string;
  /** The session whose rights/publication decision changed. */
  sessionId: string;
  /** Which surface changed. */
  changeKind: PolicyChangeKind;
  /** The change, in the entry's own words (human-readable). */
  summary: string;
  /** The prior decision (policy, visibility record, or both for revocation). */
  from: unknown;
  /** The decision after the change. */
  to: unknown;
}

/**
 * The append-only policy-change record. Entries are written ONLY by the
 * rights-center service after a change has been applied, and are never
 * rewritten or removed (the audit trail is the evidence trail).
 *
 * ⚠️ IN-MEMORY dev backing (documented): same process-local boundary as the
 * policy store above.
 */
export class PolicyAuditLog {
  private readonly entries: PolicyAuditEntry[] = [];

  /** Appends one record (nothing else ever mutates the log). */
  append(entry: PolicyAuditEntry): void {
    this.entries.push(entry);
  }

  /** The full trail for one session (oldest first). */
  of(sessionId: string): PolicyAuditEntry[] {
    return this.entries.filter((entry) => entry.sessionId === sessionId);
  }

  /** The trail for a set of sessions (oldest first) — callers pass their scope. */
  ofSessions(sessionIds: ReadonlySet<string>): PolicyAuditEntry[] {
    return this.entries.filter((entry) => sessionIds.has(entry.sessionId));
  }

  /** The newest entry for a session (`null` when it was never changed). */
  lastOf(sessionId: string): PolicyAuditEntry | null {
    const scoped = this.entries.filter((entry) => entry.sessionId === sessionId);
    return scoped.length > 0 ? (scoped[scoped.length - 1] ?? null) : null;
  }

  /** Every entry (oldest first) — for the operator's full audit view. */
  all(): PolicyAuditEntry[] {
    return [...this.entries];
  }
}
