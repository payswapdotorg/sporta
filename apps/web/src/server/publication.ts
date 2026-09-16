/**
 * The session CONTENT MODEL (W906 → W916) — the real visibility decision
 * behind discoverability, watch access and the operational views.
 *
 * W906 established an explicit per-session visibility flag
 * (`public` | `private`) with REAL, enforced effects:
 *
 * - the PUBLIC CATALOG listed `public` sessions only;
 * - the WATCH SURFACE served a private session ONLY to its owner or an
 *   operator (uniform 404 for everyone else — no existence oracle);
 * - the OWNER'S LIBRARY listed their own sessions regardless of visibility.
 *
 * W916 extends that flag into a content model with four visibility kinds and
 * role-scoped access rules (per `docs/architecture/role-experience-matrix.md`):
 *
 * - `public` — discoverable by everyone (anonymous included).
 * - `private` — discoverable by the owner and operators only; watchable by
 *   the owner and operators (the W906 rule, unchanged).
 * - `unlisted` — NOT listed in any catalog/search answer (except the owner's
 *   own view and the operator's operational view), but DIRECTLY WATCHABLE by
 *   anyone who holds the session id: the link is the capability (the standard
 *   unlisted semantic — a deliberate, documented exception to listing, never
 *   to playback).
 * - `role-scoped` — discoverable (and watchable) by the roles named on the
 *   record, plus the owner and operators. The roles are GRANTS checked
 *   server-side against the requester's account (never the presentation
 *   `activeRole` — the W902 rule).
 *
 * FAIL-CLOSED on the unknown (W916 acceptance):
 *
 * - `set` REFUSES to store an invalid decision (unknown kind, role-scoped
 *   without roles, or a role outside the frozen vocabulary) — loudly, so a
 *   producer bug can never smuggle an undefined visibility in.
 * - `contentOf` PARSES DEFENSIVELY: a stored value that is not a valid
 *   record (e.g. written by a version-skewed producer) reads back as `null`,
 *   and a `null` record is NOT discoverable by ANYONE and watchable only by
 *   its owner or an operator — never by anonymous callers. Unknown means
 *   denied, never public.
 *
 * DEFAULT: `public` — the dev seed's sessions (and any session created by a
 * path that does not declare a visibility, e.g. direct control-plane calls)
 * stay discoverable exactly as they were before W906/W916. The Create Studio
 * creates its sessions `private` (fail-closed) and publishing is an explicit
 * owner action.
 *
 * ⚠️ HONEST LIMITATION (unchanged from W906): the store is IN-MEMORY,
 * process-local — it lives exactly where the composition stores the rest of
 * the control plane this wave. A restart forgets the flags (back to the
 * `public` default). Durable publication state belongs to the hosted
 * persistence seam behind this same port.
 */
import { ROLES, type Role } from "@sporta/capability";

/** A session's publication decision (the W906 legacy form). */
export type SessionVisibility = "public" | "private";

/**
 * The full W916 visibility vocabulary.
 *
 * `unlisted` = never listed, but the direct link watches (link-is-capability);
 * `role-scoped` = listed/watchable for the named grants + owner + operator.
 */
export type ContentVisibilityKind = "public" | "private" | "unlisted" | "role-scoped";

/** The parsed, validated visibility record (the content model's value type). */
export interface ContentVisibilityRecord {
  kind: ContentVisibilityKind;
  /** The grants that may discover/watch a `role-scoped` session (else empty). */
  roles: readonly Role[];
  /** Who recorded the decision (account userId audit trail; null = legacy). */
  setBy: string | null;
  /** When the decision was recorded (ISO-8601 UTC; null = legacy). */
  setAtIso: string | null;
}

/** What {@link PublicationStore.set} accepts (legacy string or full record). */
export type ContentVisibilityInput =
  | SessionVisibility
  | {
      kind: ContentVisibilityKind;
      /** Required for `role-scoped` (at least one valid grant); else omitted. */
      roles?: readonly Role[];
      /** Who records the decision (audited on {@link ContentVisibilityRecord}). */
      setBy?: string;
    };

/** The closed set of visibility kinds (for parsing + validation). */
const CONTENT_VISIBILITY_KINDS: readonly ContentVisibilityKind[] = [
  "public",
  "private",
  "unlisted",
  "role-scoped",
];

/**
 * Parses an arbitrary stored value into a valid {@link ContentVisibilityRecord}.
 * FAIL-CLOSED: anything that is not a valid decision parses to `null`
 * (never to a permissive default). Exported for unit tests of the fail-closed
 * property itself; the store calls this on every read.
 */
export function parseContentVisibility(raw: unknown): ContentVisibilityRecord | null {
  // The W906 legacy form: the two original string decisions.
  if (raw === "public" || raw === "private") {
    return { kind: raw, roles: [], setBy: null, setAtIso: null };
  }
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.kind !== "string") return null;
  const kind = value.kind as ContentVisibilityKind;
  if (!CONTENT_VISIBILITY_KINDS.includes(kind)) return null;

  const hasRoles = value.roles !== undefined;
  if (kind === "role-scoped") {
    // A role-scoped decision without a non-empty list of valid grants is
    // meaningless — fail closed rather than guessing a scope.
    if (!Array.isArray(value.roles) || value.roles.length === 0) return null;
    const roles: Role[] = [];
    for (const entry of value.roles) {
      if (typeof entry !== "string" || !(ROLES as readonly string[]).includes(entry)) return null;
      roles.push(entry as Role);
    }
    return {
      kind,
      roles,
      setBy: typeof value.setBy === "string" ? value.setBy : null,
      setAtIso: typeof value.setAtIso === "string" ? value.setAtIso : null,
    };
  }
  // The other kinds carry no scope; a stray `roles` array on them is ignored
  // (normalized away) — the kind alone decides.
  return {
    kind,
    roles: [],
    setBy: typeof value.setBy === "string" ? value.setBy : null,
    setAtIso: typeof value.setAtIso === "string" ? value.setAtIso : null,
  };
}

/** Builds the validated record for a {@link PublicationStore.set} input (throws on invalid). */
function recordOfInput(input: ContentVisibilityInput, nowIso: string): ContentVisibilityRecord {
  if (typeof input === "string") {
    // Legacy strings are the two original decisions by definition — valid.
    return { kind: input, roles: [], setBy: null, setAtIso: null };
  }
  const parsed = parseContentVisibility({
    kind: input.kind,
    roles: input.roles ?? (input.kind === "role-scoped" ? [] : undefined),
    setBy: input.setBy ?? null,
    setAtIso: nowIso,
  });
  if (parsed === null) {
    throw new Error(
      `invalid content visibility decision: kind=${String(input.kind)} roles=${JSON.stringify(
        input.roles ?? null,
      )} (fail closed — the store never records an undefined visibility)`,
    );
  }
  return parsed;
}

/** The in-memory content-model store (this wave's deployment of the port). */
export class PublicationStore {
  private readonly bySession = new Map<string, unknown>();

  /** Records (or changes) one session's visibility. Refuses invalid decisions. */
  set(sessionId: string, visibility: ContentVisibilityInput): void {
    this.bySession.set(sessionId, recordOfInput(visibility, new Date().toISOString()));
  }

  /** The session's parsed visibility record; `null` when unknown/invalid (fail-closed). */
  contentOf(sessionId: string): ContentVisibilityRecord | null {
    return parseContentVisibility(this.bySession.get(sessionId));
  }

  /**
   * The session's visibility in the W906 legacy form: `public` only when the
   * record is explicitly `public`; EVERYTHING else (private, unlisted,
   * role-scoped, unknown) reads as `private` — never permissively.
   */
  visibilityOf(sessionId: string): SessionVisibility {
    return this.contentOf(sessionId)?.kind === "public" ? "public" : "private";
  }

  /** `true` only when the session is explicitly published. */
  isPublic(sessionId: string): boolean {
    return this.contentOf(sessionId)?.kind === "public";
  }

  /**
   * TEST-ONLY (never called by app code): injects an UNVALIDATED stored value
   * so the fail-closed read path can be proven against realistic garbage a
   * version-skewed producer might write. Reads afterwards go through the same
   * {@link contentOf} parse every request uses.
   */
  setUnvalidatedForTests(sessionId: string, raw: unknown): void {
    this.bySession.set(sessionId, raw);
  }
}

/**
 * The RIGHTS-ATTESTATION index (W916) — who attested each session's rights
 * policy, recorded at the REAL creation events.
 *
 * The control plane stores only the policy id on the session doc, and its
 * policy map is internal — but the identity gate (the only creation path
 * that attests) OVERWRITES `assertedBy` with the VERIFIED account id of the
 * caller, so recording "this account created/attested this session" at the
 * gate call sites is faithful to the gate's own attestation, never invented.
 * This is the rights-holder POLICY SCOPE's data: a rights holder discovers
 * sessions whose rights they attested.
 *
 * ⚠️ HONEST LIMITATION: only sessions created through the recording paths
 * (the dev seed, the Create Studio) are indexed. A session created by a
 * direct control-plane call has no recorded attestation — and is therefore
 * outside every rights holder's policy scope (fail-closed, documented).
 */
export class PolicyAttestationIndex {
  private readonly bySession = new Map<string, string>();

  /** Records that `attestedByUserId` attested the session's rights (gate sites only). */
  record(sessionId: string, attestedByUserId: string): void {
    this.bySession.set(sessionId, attestedByUserId);
  }

  /** The attesting account's id, when one was recorded (`null` = unrecorded). */
  attestedByOf(sessionId: string): string | null {
    return this.bySession.get(sessionId) ?? null;
  }
}
