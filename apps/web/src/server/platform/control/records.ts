/**
 * The durable CONTROL-PLANE record store port (W921).
 *
 * The frozen deployment architecture places control-plane state in Neon
 * PostgreSQL ("Neon PostgreSQL <--- control-plane state"). W911 landed identity
 * there; W912 artifacts in R2; this port carries the REMAINING control-plane
 * records — user-created media sessions (id, owner, source, rights
 * declaration, publication state) and their renders (the render envelope each
 * instance allocated) — so a session created on one serverless instance is
 * watchable, previewable, publishable and catalog-listed from ANY instance.
 *
 * PORT SHAPE (mirrors the W902/W911 store ports):
 * - methods are async by design (the production adapter is PostgreSQL over
 *   the WAN; the hermetic adapter is an in-memory map — see
 *   {@link InMemoryControlPlaneRecordStore});
 * - records are re-validated on read (closed vocabularies, JSON shapes) and
 *   handed out as FRESH objects (no aliasing across requests);
 * - writes are IDEMPOTENT: `upsertSession` and `recordRender` are safe to
 *   re-run (reconciliation, cold-start re-seed, retries).
 *
 * ⚠️ HONEST SCOPE: the DEV-SEED sessions (sess-1/2/3) are NOT recorded — they
 * are deterministically re-created per boot by the seed itself (the W912
 * posture), and the seeded id namespace stays untouched. Only USER-created
 * sessions (the Create Studio path) and their renders are durable here.
 */

import type { AuthorizationPolicy, RenderResult } from "@sporta/contracts";
import type { ContentVisibilityKind } from "../../publication";
import type { Role } from "@sporta/capability";

/** The recorded publication decision (the W916 four-kind vocabulary). */
export interface ControlVisibilityRecord {
  kind: ContentVisibilityKind;
  /** The grants that may discover/watch a `role-scoped` session (else empty). */
  roles: readonly Role[];
}

/** One durable control-plane session record (a user-created media session). */
export interface ControlSessionRecord {
  sessionId: string;
  /** The creating (identity-attesting) account — from the W911 ownership row. */
  ownerUserId: string;
  /** The fixture source key the session was created from (the studio's source). */
  sourceKey: string;
  /** The session's source label. */
  label: string;
  /** The identity-attested rights declaration (the AuthorizationPolicy). */
  rightsDeclaration: AuthorizationPolicy;
  /** The recorded publication decision. */
  visibility: ControlVisibilityRecord;
  /** The session's real lifecycle status at record time. */
  status: string;
  /** When the session was published (the visibility flip), when it is public. */
  publishedAtMs: number | null;
  /** The session's RECORDED creation time (ISO-8601 UTC) — not the replay clock. */
  createdAtIso: string;
  /** Last write-through time (epoch ms). */
  updatedAtMs: number;
}

/** The recorded dispatch recipe of one render (what was asked, for audit). */
export interface ControlRenderRecipe {
  rendererVersion?: string;
  styleConfig?: { styleId?: string; config?: unknown };
  outputProfile?: unknown;
}

/** One durable control-plane render record. */
export interface ControlRenderRecord {
  sessionId: string;
  /** The per-session dispatch order (1-based). */
  renderOrdinal: number;
  /**
   * The render id the CREATING instance allocated (`r-<seq>`). Stored because
   * the control plane's render-sequence counter is PER-INSTANCE — a replay on
   * another instance cannot re-derive it; the record IS the source of truth.
   */
  renderId: string;
  rendererId: string;
  /** The recorded dispatch recipe (audit; see {@link ControlRenderRecipe}). */
  recipe: ControlRenderRecipe;
  /**
   * The render result document VERBATIM (watermark, provenance, renderer
   * health, output-segment references) — what `getRender` answers.
   */
  result: RenderResult;
  /**
   * The stored output segment ids under this render (the pipeline's
   * content-addressed ids). The reconstruction re-encodes deterministically
   * and ASSERTS these — never trusts them blindly.
   */
  storedSegmentIds: readonly string[];
  /** When the render was recorded (epoch ms). */
  createdAtMs: number;
}

/** The durable control-plane record-store port (Neon in production). */
export interface ControlPlaneRecordStore {
  /** Inserts or updates one session record (idempotent by session id). */
  upsertSession(record: ControlSessionRecord): Promise<void>;
  /**
   * Records one render (idempotent by (sessionId, renderId) — a re-run of the
   * same observation is a counted no-op, never a duplicate row).
   */
  recordRender(record: ControlRenderRecord): Promise<void>;
  /** One session's record, or null when the id is not durable. */
  findSession(sessionId: string): Promise<ControlSessionRecord | null>;
  /** Every durable session record (the catalog/library listing merge). */
  listSessions(): Promise<ControlSessionRecord[]>;
  /** One session's render records in dispatch order (ordinal ascending). */
  findRenders(sessionId: string): Promise<ControlRenderRecord[]>;
  /**
   * Records a publication flip (visibility + published-at + updated-at).
   * Throws when the session is not durable (the flip is lost in-process only).
   */
  setVisibility(sessionId: string, visibility: ControlVisibilityRecord): Promise<void>;
}

// ---------------------------------------------------------------------------
// The hermetic in-memory implementation (tests / the two-instance scenario)
// ---------------------------------------------------------------------------

/** Parses + validates a stored visibility value (fail-closed to `private`). */
function parseVisibility(raw: unknown): ControlVisibilityRecord {
  if (typeof raw !== "object" || raw === null) return { kind: "private", roles: [] };
  const value = raw as Record<string, unknown>;
  const kind = value["kind"];
  if (kind !== "public" && kind !== "private" && kind !== "unlisted" && kind !== "role-scoped") {
    return { kind: "private", roles: [] };
  }
  const roles: Role[] = Array.isArray(value["roles"])
    ? (value["roles"].filter((role): role is Role => typeof role === "string") as Role[])
    : [];
  return kind === "role-scoped" && roles.length === 0
    ? { kind: "private", roles: [] } // fail closed: a scope-less role record
    : { kind, roles };
}

/** Clone helper (fresh objects, no aliasing across reads). */
function cloneSession(record: ControlSessionRecord): ControlSessionRecord {
  return {
    ...record,
    rightsDeclaration: structuredClone(record.rightsDeclaration),
    visibility: { ...record.visibility, roles: [...record.visibility.roles] },
  };
}

/** Clone helper for render records. */
function cloneRender(record: ControlRenderRecord): ControlRenderRecord {
  return {
    ...record,
    recipe: structuredClone(record.recipe),
    result: structuredClone(record.result),
    storedSegmentIds: [...record.storedSegmentIds],
  };
}

/**
 * The in-memory {@link ControlPlaneRecordStore} — the hermetic deployment of
 * the port (one process's map). Used by the two-instances-over-one-store test
 * and available as a documented dev backing; it is NOT a durability claim
 * (a restart forgets it — exactly the W904-era boundary, honestly labeled).
 */
export class InMemoryControlPlaneRecordStore implements ControlPlaneRecordStore {
  private readonly sessions = new Map<string, ControlSessionRecord>();
  private readonly rendersBySession = new Map<string, ControlRenderRecord[]>();

  async upsertSession(record: ControlSessionRecord): Promise<void> {
    this.sessions.set(record.sessionId, cloneSession(record));
  }

  async recordRender(record: ControlRenderRecord): Promise<void> {
    const list = this.rendersBySession.get(record.sessionId) ?? [];
    if (list.some((entry) => entry.renderId === record.renderId)) return; // counted no-op
    list.push(cloneRender(record));
    this.rendersBySession.set(record.sessionId, list);
  }

  async findSession(sessionId: string): Promise<ControlSessionRecord | null> {
    const record = this.sessions.get(sessionId);
    return record === undefined ? null : cloneSession(record);
  }

  async listSessions(): Promise<ControlSessionRecord[]> {
    return [...this.sessions.values()].map(cloneSession);
  }

  async findRenders(sessionId: string): Promise<ControlRenderRecord[]> {
    const list = this.rendersBySession.get(sessionId) ?? [];
    return [...list].sort((a, b) => a.renderOrdinal - b.renderOrdinal).map(cloneRender);
  }

  async setVisibility(sessionId: string, visibility: ControlVisibilityRecord): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (record === undefined) {
      throw new Error(`control-plane record store: unknown session '${sessionId}'`);
    }
    const parsed = parseVisibility(visibility);
    this.sessions.set(sessionId, {
      ...record,
      visibility: parsed,
      publishedAtMs: parsed.kind === "public" ? Date.now() : record.publishedAtMs,
    });
  }
}
