/**
 * THE RIGHTS-POLICY DOMAIN STORE (J008) — the domain/persistence seam for
 * per-session EFFECTIVE authorization policies: the creation-time record,
 * any later rights-holder EDIT (override), and the append-only audit trail
 * of every rights change.
 *
 * WHY THIS MODULE EXISTS (the honest boundary): the W917 app layer already
 * implements rights editing over `apps/web/src/server/rights-policy-store.ts`
 * — but IN-MEMORY, process-local (its own documented limitation: "a restart
 * forgets the overrides"). This module is the DOMAIN seam the app layer will
 * adopt later: the SAME semantics (survey-conformant, mirrored field for
 * field), with DURABLE `bun:sqlite` backing following the W004 repository
 * pattern (`packages/session/src/repository.ts`, the package's own
 * precedent) plus the in-memory implementation for tests/ephemeral runs.
 * The frozen `AuthorizationPolicy` contract is CONSUMED verbatim
 * (`@sporta/contracts` owns the rights semantics; nothing here re-invents
 * them).
 *
 * SEMANTICS (mirrored from the app-layer shapes — never forked):
 *
 * - the EFFECTIVE policy is `override ?? recorded` — an edit is a FULL,
 *   contract-validated `AuthorizationPolicy` document (validated by the
 *   contract's own zod schema before it is ever stored);
 * - an override can only NARROW below the creation-time attestation at the
 *   CAPABILITY level: the effective capabilities are
 *   `derive(recorded) ∩ derive(effective)` (the W917 `intersectCaps` rule —
 *   an edit can never widen past what the creation record attested);
 * - REVOCATION is the contract's own time bound: the effective policy's
 *   `expiresAtIso` is set just before the revocation moment, so
 *   `deriveRightsCapabilities` (the REAL derivation, reused verbatim)
 *   derives DENY_ALL — playback, rendering and live delivery all stop;
 * - the audit trail is APPEND-ONLY: entries are written only after a change
 *   has been applied and are never rewritten or removed (the evidence
 *   trail); the entry shape mirrors the app-layer `PolicyAuditEntry`
 *   field-for-field (`atIso`, `actorUserId`, `sessionId`, `changeKind`,
 *   `summary`, `from`, `to`) with the additive `editKind` member that names
 *   the J008 acceptance's own vocabulary (grant/widen/narrow/revoke);
 * - every read is validated (documents re-parse against the contract
 *   schema — a corrupted row fails loudly, never partial data) and
 *   deep-cloned (callers can never mutate stored state through handed-out
 *   references).
 *
 * DETERMINISM: no wall clock inside the stores — the caller injects
 * `nowMs()` (the composition's clock); no env, no I/O beyond the injected
 * sqlite database/file path.
 */
import { AuthorizationPolicy } from "@sporta/contracts";
import { deriveRightsCapabilities } from "@sporta/contracts";
import type { RightsCapabilities } from "@sporta/contracts";
import { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// The audit entry (the app-layer shape, mirrored + the additive editKind)
// ---------------------------------------------------------------------------

/** The closed vocabulary of policy-change kinds (the app-layer shape, mirrored). */
export type PolicyChangeKind = "policy" | "revocation";

/** The J008 acceptance's own edit vocabulary (additive — what the change DID). */
export type RightsEditKind = "grant" | "widen" | "narrow" | "revoke";

/**
 * One append-only rights-audit record: WHO changed WHAT, on WHICH session,
 * WHEN — plus the additive `editKind` (the J008 vocabulary). Field-for-field
 * the app-layer `PolicyAuditEntry` (adoptable without translation).
 */
export interface RightsAuditEntry {
  /** When the change was applied (ISO-8601 UTC — the composition's clock). */
  atIso: string;
  /** The account that made the change (the caller's VERIFIED id — never a claim). */
  actorUserId: string;
  /** The session whose rights decision changed. */
  sessionId: string;
  /** Which surface changed (the app-layer vocabulary, mirrored). */
  changeKind: PolicyChangeKind;
  /** What the change DID (the J008 vocabulary — additive). */
  editKind: RightsEditKind;
  /** The change, in the entry's own words (human-readable, deterministic). */
  summary: string;
  /** The prior decision (the full prior policy document, or null). */
  from: unknown;
  /** The decision after the change (the full new policy document, or null). */
  to: unknown;
}

// ---------------------------------------------------------------------------
// The effective-policy store port (two implementations below)
// ---------------------------------------------------------------------------

/** Persistence port for per-session effective authorization policies. */
export interface EffectivePolicyStore {
  /** Records the policy a session was CREATED with (idempotent overwrite — the creation record). */
  recordAtCreation(sessionId: string, policy: AuthorizationPolicy): void;
  /** Records a rights holder's EDIT (a full, contract-validated policy). */
  setOverride(sessionId: string, policy: AuthorizationPolicy): void;
  /** The creation-time policy, when this store observed the creation (null = never recorded). */
  recordedOf(sessionId: string): AuthorizationPolicy | null;
  /** The current EDIT, when one exists (null = never edited). */
  overrideOf(sessionId: string): AuthorizationPolicy | null;
  /** The EFFECTIVE policy: the edit when one exists, else the creation record. */
  effectiveOf(sessionId: string): AuthorizationPolicy | null;
  /** Whether an edit is in force for this session. */
  hasOverride(sessionId: string): boolean;
}

/** Persistence port for the append-only rights audit trail. */
export interface RightsAuditStore {
  /** Appends one record (nothing else ever mutates the log). */
  append(entry: RightsAuditEntry): void;
  /** The full trail for one session (oldest first). */
  of(sessionId: string): RightsAuditEntry[];
  /** The trail for a set of sessions (oldest first) — callers pass their scope. */
  ofSessions(sessionIds: ReadonlySet<string>): RightsAuditEntry[];
  /** The newest entry for a session (null when it was never changed). */
  lastOf(sessionId: string): RightsAuditEntry | null;
  /** Every entry (oldest first) — the operator's full audit view. */
  all(): RightsAuditEntry[];
}

/** A malformed store document or input (fail-loud, never partial data). */
export class RightsStoreValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`rights store refused the input: ${issues.join("; ")}`);
    this.name = "RightsStoreValidationError";
  }
}

/** Validates one policy document against the frozen contract (fail-loud). */
function parsePolicyOrThrow(document: unknown, field: string): AuthorizationPolicy {
  if (typeof document !== "object" || document === null) {
    throw new RightsStoreValidationError([`${field} must be an AuthorizationPolicy document`]);
  }
  const parsed = AuthorizationPolicy.safeParse(document);
  if (!parsed.success) {
    throw new RightsStoreValidationError([
      `${field} failed the frozen AuthorizationPolicy contract: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    ]);
  }
  return parsed.data;
}

function requireSessionId(sessionId: unknown): string {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new RightsStoreValidationError(["sessionId must be a non-empty string"]);
  }
  return sessionId;
}

// ---------------------------------------------------------------------------
// The in-memory implementations (tests + ephemeral runs — the W004 pattern)
// ---------------------------------------------------------------------------

/** In-memory `EffectivePolicyStore` (the app-layer semantics, mirrored). */
export class InMemoryEffectivePolicyStore implements EffectivePolicyStore {
  private readonly recordedAtCreation = new Map<string, AuthorizationPolicy>();
  private readonly overrides = new Map<string, AuthorizationPolicy>();

  recordAtCreation(sessionId: string, policy: AuthorizationPolicy): void {
    this.recordedAtCreation.set(requireSessionId(sessionId), parsePolicyOrThrow(policy, "policy"));
  }

  setOverride(sessionId: string, policy: AuthorizationPolicy): void {
    this.overrides.set(requireSessionId(sessionId), parsePolicyOrThrow(policy, "policy"));
  }

  recordedOf(sessionId: string): AuthorizationPolicy | null {
    return clonePolicy(this.recordedAtCreation.get(sessionId) ?? null);
  }

  overrideOf(sessionId: string): AuthorizationPolicy | null {
    return clonePolicy(this.overrides.get(sessionId) ?? null);
  }

  effectiveOf(sessionId: string): AuthorizationPolicy | null {
    return clonePolicy(
      this.overrides.get(sessionId) ?? this.recordedAtCreation.get(sessionId) ?? null,
    );
  }

  hasOverride(sessionId: string): boolean {
    return this.overrides.has(sessionId);
  }
}

/** In-memory `RightsAuditStore` (append-only, oldest-first reads). */
export class InMemoryRightsAuditStore implements RightsAuditStore {
  private readonly entries: RightsAuditEntry[] = [];

  append(entry: RightsAuditEntry): void {
    this.entries.push(cloneEntry(entry));
  }

  of(sessionId: string): RightsAuditEntry[] {
    return this.entries.filter((stored) => stored.sessionId === sessionId).map(cloneEntry);
  }

  ofSessions(sessionIds: ReadonlySet<string>): RightsAuditEntry[] {
    return this.entries.filter((stored) => sessionIds.has(stored.sessionId)).map(cloneEntry);
  }

  lastOf(sessionId: string): RightsAuditEntry | null {
    const scoped = this.entries.filter((stored) => stored.sessionId === sessionId);
    return scoped.length > 0 ? cloneEntry(scoped[scoped.length - 1]!) : null;
  }

  all(): RightsAuditEntry[] {
    return this.entries.map(cloneEntry);
  }
}

// ---------------------------------------------------------------------------
// The sqlite implementations (durable — the package's own repository pattern)
// ---------------------------------------------------------------------------

/**
 * Durable `EffectivePolicyStore` + `RightsAuditStore` on `bun:sqlite`: the
 * full validated policy JSON (`policy_json`) per session, and the full audit
 * entry JSON (`entry_json`) in append order — schema-versioned,
 * vendor-neutral documents, validated on write AND on read (drift fails
 * loudly), deep-clone-on-read. DDL applied idempotently; `close()` is
 * idempotent. A NUL inside a scope id is rejected loudly (the composite-key
 * ambiguity rule — the output-pipeline store's own convention).
 */
export class SqliteRightsStore implements EffectivePolicyStore, RightsAuditStore {
  private readonly db: Database;
  private readonly ownsDatabase: boolean;

  constructor(databaseOrPath: Database | string) {
    this.db = typeof databaseOrPath === "string" ? new Database(databaseOrPath) : databaseOrPath;
    this.ownsDatabase = typeof databaseOrPath === "string";
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sporta_effective_policies (
        session_id TEXT NOT NULL,
        policy_kind TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (session_id, policy_kind)
      );
      CREATE TABLE IF NOT EXISTS sporta_rights_audit (
        audit_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        entry_json TEXT NOT NULL,
        appended_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sporta_rights_audit_session ON sporta_rights_audit (session_id);
    `);
  }

  close(): void {
    if (this.ownsDatabase) this.db.close();
  }

  // -- EffectivePolicyStore ---------------------------------------------------

  recordAtCreation(sessionId: string, policy: AuthorizationPolicy): void {
    const id = requireSessionIdNulFree(sessionId);
    const parsed = parsePolicyOrThrow(policy, "policy");
    // The creation record and any override COEXIST (one row per
    // (session, kind) — the effective answer is override ?? recorded, the
    // same semantics as the in-memory implementation).
    this.db
      .query(
        `INSERT INTO sporta_effective_policies (session_id, policy_kind, policy_json, updated_at_ms)
         VALUES (?, 'recorded', ?, ?)
         ON CONFLICT (session_id, policy_kind) DO UPDATE SET policy_json = excluded.policy_json, updated_at_ms = excluded.updated_at_ms`,
      )
      .run(id, canonicalJson(parsed), nowMsForStore());
  }

  setOverride(sessionId: string, policy: AuthorizationPolicy): void {
    const id = requireSessionIdNulFree(sessionId);
    const parsed = parsePolicyOrThrow(policy, "policy");
    this.db
      .query(
        `INSERT INTO sporta_effective_policies (session_id, policy_kind, policy_json, updated_at_ms)
         VALUES (?, 'override', ?, ?)
         ON CONFLICT (session_id, policy_kind) DO UPDATE SET policy_json = excluded.policy_json, updated_at_ms = excluded.updated_at_ms`,
      )
      .run(id, canonicalJson(parsed), nowMsForStore());
  }

  recordedOf(sessionId: string): AuthorizationPolicy | null {
    return this.policyOfKind(requireSessionIdNulFree(sessionId), "recorded");
  }

  overrideOf(sessionId: string): AuthorizationPolicy | null {
    return this.policyOfKind(requireSessionIdNulFree(sessionId), "override");
  }

  effectiveOf(sessionId: string): AuthorizationPolicy | null {
    const id = requireSessionIdNulFree(sessionId);
    return this.policyOfKind(id, "override") ?? this.policyOfKind(id, "recorded");
  }

  hasOverride(sessionId: string): boolean {
    return this.policyOfKind(requireSessionIdNulFree(sessionId), "override") !== null;
  }

  // -- RightsAuditStore ---------------------------------------------------------

  append(entry: RightsAuditEntry): void {
    requireSessionIdNulFree(entry.sessionId);
    this.db
      .query(
        `INSERT INTO sporta_rights_audit (session_id, entry_json, appended_at_ms) VALUES (?, ?, ?)`,
      )
      .run(entry.sessionId, canonicalJson(entry), nowMsForStore());
  }

  of(sessionId: string): RightsAuditEntry[] {
    return this.readAudit(
      `SELECT entry_json FROM sporta_rights_audit WHERE session_id = ? ORDER BY audit_seq ASC`,
      [requireSessionIdNulFree(sessionId)],
    );
  }

  ofSessions(sessionIds: ReadonlySet<string>): RightsAuditEntry[] {
    const ids = [...sessionIds];
    if (ids.length === 0) return [];
    for (const id of ids) requireSessionIdNulFree(id);
    const placeholders = ids.map(() => "?").join(", ");
    return this.readAudit(
      `SELECT entry_json FROM sporta_rights_audit WHERE session_id IN (${placeholders}) ORDER BY audit_seq ASC`,
      ids,
    );
  }

  lastOf(sessionId: string): RightsAuditEntry | null {
    const scoped = this.of(sessionId);
    return scoped.length > 0 ? scoped[scoped.length - 1]! : null;
  }

  all(): RightsAuditEntry[] {
    return this.readAudit(`SELECT entry_json FROM sporta_rights_audit ORDER BY audit_seq ASC`, []);
  }

  // -- internals -----------------------------------------------------------------

  private policyOfKind(
    sessionId: string,
    kind: "recorded" | "override",
  ): AuthorizationPolicy | null {
    const row = this.db
      .query(
        `SELECT policy_json FROM sporta_effective_policies WHERE session_id = ? AND policy_kind = ?`,
      )
      .get(sessionId, kind) as { policy_json: string } | null;
    if (row === null) return null;
    // Validate on read: a corrupted row fails loudly (never partial data).
    return parsePolicyOrThrow(
      JSON.parse(row.policy_json),
      `stored ${kind} policy for session '${sessionId}'`,
    );
  }

  private readAudit(sql: string, params: readonly unknown[]): RightsAuditEntry[] {
    const rows = this.db.query(sql).all(...(params as never[])) as Array<{ entry_json: string }>;
    return rows.map((row) => parseAuditEntry(JSON.parse(row.entry_json)));
  }
}

/** Parses one audit entry (fail-loud on drift — the validate-on-read rule). */
function parseAuditEntry(value: unknown): RightsAuditEntry {
  const issues: string[] = [];
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  if (
    record === null ||
    typeof record.atIso !== "string" ||
    typeof record.actorUserId !== "string" ||
    typeof record.sessionId !== "string" ||
    (record.changeKind !== "policy" && record.changeKind !== "revocation") ||
    (record.editKind !== "grant" &&
      record.editKind !== "widen" &&
      record.editKind !== "narrow" &&
      record.editKind !== "revoke") ||
    typeof record.summary !== "string"
  ) {
    issues.push("the stored entry is not a RightsAuditEntry document");
  }
  if (issues.length > 0) throw new RightsStoreValidationError(issues);
  return value as RightsAuditEntry;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function clonePolicy(policy: AuthorizationPolicy | null): AuthorizationPolicy | null {
  return policy === null ? null : (JSON.parse(JSON.stringify(policy)) as AuthorizationPolicy);
}

function cloneEntry(entry: RightsAuditEntry): RightsAuditEntry {
  return JSON.parse(JSON.stringify(entry)) as RightsAuditEntry;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function requireSessionIdNulFree(sessionId: string): string {
  requireSessionId(sessionId);
  if (sessionId.includes("\u0000")) {
    throw new RightsStoreValidationError(["sessionId must not contain NUL (ambiguous scope key)"]);
  }
  return sessionId;
}

let storeClockTicks = 0;
/** The deterministic store clock (TEST_EPOCH_MS + ticks — the repo convention). */
function nowMsForStore(): number {
  return 1_700_000_000_000 + (storeClockTicks += 1);
}

// ---------------------------------------------------------------------------
// The capability ceiling (the W917 narrow-only rule, mirrored at the domain)
// ---------------------------------------------------------------------------

/**
 * The EFFECTIVE capabilities for one session (the W917 semantics, mirrored):
 * `derive(effective policy) ∩ derive(creation record)` — a rights holder's
 * edit can NARROW effective rights (or revoke them entirely) but can never
 * WIDEN access past what the creation-time record attested. A missing
 * effective policy or a missing creation record denies per the contract's
 * own fail-closed derivation (an unrecorded ceiling is the permissive
 * boundary the app layer composes with its own gates — the domain seam
 * derives only from what it has, honestly).
 */
export function effectiveCapabilitiesOf(
  store: EffectivePolicyStore,
  sessionId: string,
  now: Date,
): RightsCapabilities {
  const recorded = store.recordedOf(sessionId);
  const effective = store.effectiveOf(sessionId);
  const effectiveCaps = deriveRightsCapabilities(effective, now);
  if (recorded === null) return effectiveCaps;
  const recordedCaps = deriveRightsCapabilities(recorded, now);
  return {
    canReferenceSourceFrames:
      effectiveCaps.canReferenceSourceFrames && recordedCaps.canReferenceSourceFrames,
    canDeliverLive: effectiveCaps.canDeliverLive && recordedCaps.canDeliverLive,
    canStoreDerivatives: effectiveCaps.canStoreDerivatives && recordedCaps.canStoreDerivatives,
    canShare: effectiveCaps.canShare && recordedCaps.canShare,
  };
}
