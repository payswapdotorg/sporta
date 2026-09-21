/**
 * THE ANALYST ANNOTATIONS DOMAIN (J010) — media-time markers/clips SAVED
 * where backed by REAL session timelines, notes ATTACHED, and REVISITABLE;
 * NO fake clip bytes (a marker without real media backing is REFUSED or
 * honestly marked, never fabricated).
 *
 * THE MODEL (the honest minimum):
 *
 * - an `AnalystMarker` is a MOMENT (`atMs`) or a CLIP interval
 *   (`startMs`/`endMs`) on a session's media timeline, with an explicit
 *   `backing` record naming the REAL timeline it rides: the session's own
 *   `SessionTimeline` (the contract's `durationMs` — captured at save, the
 *   honest snapshot) or a REAL render output's timeline (via the injected
 *   render-existence port; without the port a render-backed marker is
 *   REFUSED — never a fabricated reference);
 * - an `AnalystNote` is attached text (author + timestamp) — first-class,
 *   persisted, listable;
 * - THERE ARE NO CLIP BYTES: the domain stores TIME RANGES + backing
 *   references ONLY. The "clip" is what a LATER rendering lane would cut
 *   from the real media — this seam never fabricates media (pinned by
 *   tests: the persisted documents carry no byte-shaped member at all);
 * - BACKING CHECKS (fail-closed, closed refusal vocabulary):
 *   `session-unknown` (no session), `no-timeline` (the session has no real
 *   timeline — a created-but-unprocessed session honestly cannot host
 *   media-time markers), `out-of-range` (the marker's times fall outside
 *   the real timeline's extent), `render-unknown` (the render reference
 *   does not exist), `render-lookup-unavailable` (no render port injected);
 * - ACCESS: the `analyst-annotation.read`/`write` identity actions (owner /
 *   operator / analyst grant — the closed vocabulary this lane adds);
 *   typed 401/403 denials (the same honest boundaries as the J009 seam).
 *
 * PERSISTENCE: in-memory + `bun:sqlite` (the package's own repository
 * pattern — full validated JSON documents, deep-clone-on-read, validate-on-
 * write-and-read, deterministic ids `mk-<sessionId>-<n>` /
 * `nt-<markerId>-<n>` with per-session gap-free counters).
 */
import { authorize } from "@sporta/identity";
import type { IdentityDenialReason } from "@sporta/identity";
import type { Role } from "@sporta/capability";
import { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// The domain shapes
// ---------------------------------------------------------------------------

/** The honest backing record: WHICH real timeline the marker rides on. */
export type AnalystMarkerBacking =
  | {
      /** The session's own real timeline (the `SessionTimeline.durationMs` snapshot at save). */
      kind: "session-timeline";
      /** The timeline's real extent in ms (captured at save — the honest snapshot). */
      durationMs: number;
    }
  | {
      /** A REAL render output's timeline (a render that exists on this session). */
      kind: "render-output";
      /** The render id (verified to exist via the render-existence port). */
      renderId: string;
      /** The render's real duration in ms (the caller-declared extent — the port verifies existence only). */
      durationMs: number;
    };

/** One saved media-time marker (a moment or a clip interval — never bytes). */
export interface AnalystMarker {
  /** The deterministic id (`mk-<sessionId>-<n>`, per-session gap-free). */
  markerId: string;
  sessionId: string;
  /** A moment marker (`atMs`) or a clip interval (`startMs`/`endMs`). */
  kind: "moment" | "clip";
  /** The moment's media time (ms on the session timeline; moments only). */
  atMs?: number;
  /** The clip's start (ms, inclusive; clips only). */
  startMs?: number;
  /** The clip's end (ms, inclusive; clips only). */
  endMs?: number;
  /** The author's VERIFIED account id. */
  authorUserId: string;
  /** When the marker was saved (ISO-8601 UTC — the composition's clock). */
  createdAtIso: string;
  /** The REAL timeline the marker rides on (refused without it — never fabricated). */
  backing: AnalystMarkerBacking;
  /** The human label (optional). */
  label?: string;
}

/** One attached note (first-class, persisted, revisitable). */
export interface AnalystNote {
  /** The deterministic id (`nt-<markerId>-<n>`, per-marker gap-free). */
  noteId: string;
  /** The marker the note attaches to. */
  markerId: string;
  sessionId: string;
  /** The note's text (non-empty, bounded). */
  text: string;
  /** The author's VERIFIED account id. */
  authorUserId: string;
  /** When the note was attached (ISO-8601 UTC — the composition's clock). */
  createdAtIso: string;
}

/** The closed refusal vocabulary for marker/note saves (fail-closed, honest). */
export type AnalystAnnotationRefusal =
  | "session-unknown"
  | "no-timeline"
  | "out-of-range"
  | "render-unknown"
  | "render-lookup-unavailable"
  | "marker-unknown"
  | "invalid-input";

/** The typed honest HTTP boundary an access denial carries (the API lane maps it verbatim). */
export type AnalystDenialHttpStatus = 401 | 403;

/** One access-gated answer: the allowed payload, the typed refusal, or the 401/403 denial. */
export type AnalystAnnotationResult<T> =
  | { kind: "allowed"; value: T }
  | { kind: "refused"; reason: AnalystAnnotationRefusal }
  | { kind: "denied"; reason: IdentityDenialReason; httpStatus: AnalystDenialHttpStatus };

// ---------------------------------------------------------------------------
// The session/render timeline lookups (the REAL backing sources)
// ---------------------------------------------------------------------------

/** The real session-timeline lookup (the backing check's source of truth). */
export interface SessionTimelineLookup {
  /** The session's real timeline extent (`null` = no session, or no timeline yet). */
  (sessionId: string): { exists: true; durationMs: number } | { exists: false } | null;
}

/** The real render-output lookup (render-backed markers' source of truth). */
export interface RenderOutputLookup {
  /** Whether the render exists on the session (an honest existence answer — no details). */
  (sessionId: string, renderId: string): boolean;
}

// ---------------------------------------------------------------------------
// The persistence port (in-memory + sqlite below)
// ---------------------------------------------------------------------------

/** Persistence port for analyst markers + notes. */
export interface AnalystAnnotationStore {
  /** Persists one marker (ids assigned by the store, gap-free per session). */
  putMarker(marker: Omit<AnalystMarker, "markerId">): AnalystMarker;
  /** Persists one note (ids assigned by the store, gap-free per marker). */
  putNote(note: Omit<AnalystNote, "noteId" | "markerId">, markerId: string): AnalystNote;
  /** One marker by id (deep clone; null = absent). */
  markerOf(markerId: string): AnalystMarker | null;
  /** Every marker of a session (save order; deep clones). */
  markersOf(sessionId: string): AnalystMarker[];
  /** Every note of a marker (attach order; deep clones). */
  notesOfMarker(markerId: string): AnalystNote[];
  /** Every note of a session (attach order; deep clones). */
  notesOfSession(sessionId: string): AnalystNote[];
}

// ---------------------------------------------------------------------------
// The service (the query/save seams the later UI lane consumes)
// ---------------------------------------------------------------------------

/** The caller's account shape (the authorize policy's minimum). */
export interface AnalystAccount {
  userId: string;
  roles: readonly Role[];
}

/** Options for {@link createAnalystAnnotationService}. */
export interface AnalystAnnotationServiceOptions {
  /** The persistence store. */
  store: AnalystAnnotationStore;
  /** The session-timeline lookup (REQUIRED — the primary real backing). */
  sessionTimelines: SessionTimelineLookup;
  /** The media-ownership read: the owner of a session (`null` = no ownership record → the honest unknown-resource denial). */
  ownerIdOf: (sessionId: string) => string | null;
  /** The render-output lookup (optional — render-backed markers refuse without it). */
  renderOutputs?: RenderOutputLookup;
  /** The composition's clock (ISO timestamps for saves). */
  nowMs: () => number;
}

/** A malformed service configuration or input (fail-loud). */
export class AnalystAnnotationValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`analyst annotations refused the input: ${issues.join("; ")}`);
    this.name = "AnalystAnnotationValidationError";
  }
}

/** The analyst annotations service (J010 domain seam). */
export interface AnalystAnnotationService {
  /** Saves one media-time marker where backed (moments or clips; never bytes). */
  saveMarker(
    account: AnalystAccount | null,
    input: {
      sessionId: string;
      kind: "moment" | "clip";
      atMs?: number;
      startMs?: number;
      endMs?: number;
      label?: string;
      /** When omitted, the marker rides the session's own timeline (the default backing). */
      backing?:
        "session-timeline" | { kind: "render-output"; renderId: string; durationMs: number };
    },
  ): AnalystAnnotationResult<AnalystMarker>;
  /** Attaches one note to a saved marker. */
  attachNote(
    account: AnalystAccount | null,
    input: { markerId: string; text: string },
  ): AnalystAnnotationResult<AnalystNote>;
  /** Lists a session's saved markers (the revisit seam). */
  listMarkers(
    account: AnalystAccount | null,
    sessionId: string,
  ): AnalystAnnotationResult<AnalystMarker[]>;
  /** One marker with its attached notes (the revisit seam). */
  getMarker(
    account: AnalystAccount | null,
    markerId: string,
  ): AnalystAnnotationResult<{ marker: AnalystMarker; notes: AnalystNote[] }>;
}

const DENIED_UNAUTHENTICATED = {
  kind: "denied",
  reason: "unauthenticated",
  httpStatus: 401,
} as const;

/** Creates the analyst annotations service (the J010 domain seam). */
export function createAnalystAnnotationService(
  options: AnalystAnnotationServiceOptions,
): AnalystAnnotationService {
  if (typeof options?.store?.putMarker !== "function") {
    throw new AnalystAnnotationValidationError(["store must be an AnalystAnnotationStore"]);
  }
  if (typeof options?.sessionTimelines !== "function") {
    throw new AnalystAnnotationValidationError([
      "sessionTimelines must be a SessionTimelineLookup",
    ]);
  }
  if (typeof options?.ownerIdOf !== "function") {
    throw new AnalystAnnotationValidationError(["ownerIdOf must be a function"]);
  }
  if (options.renderOutputs !== undefined && typeof options.renderOutputs !== "function") {
    throw new AnalystAnnotationValidationError([
      "renderOutputs must be a RenderOutputLookup function",
    ]);
  }
  const store = options.store;
  const sessionTimelines = options.sessionTimelines;
  const ownerIdOf = options.ownerIdOf;
  const renderOutputs = options.renderOutputs;
  const nowMs = options.nowMs;

  const denialOf = (reason: IdentityDenialReason): AnalystAnnotationResult<never> => ({
    kind: "denied",
    reason,
    httpStatus: reason === "unauthenticated" ? 401 : 403,
  });

  /** The authorize wrapper for one session-scoped action. */
  const gate = (
    account: AnalystAccount | null,
    action: "analyst-annotation.read" | "analyst-annotation.write",
    sessionId: string,
  ): { ok: true } | { ok: false; result: AnalystAnnotationResult<never> } => {
    if (account === null || account === undefined) {
      return { ok: false, result: DENIED_UNAUTHENTICATED };
    }
    // The REAL ownership context (the injected port): the owner branch
    // passes iff the caller owns the session; the operator/analyst grants
    // pass on the grant alone; an unreadable ownership record denies
    // unknown-resource (uniform — no existence oracle).
    const ownerId = ownerIdOf(sessionId);
    const decision = authorize(
      { userId: account.userId, roles: account.roles },
      action,
      ownerId === null ? {} : { ownerId },
    );
    if (decision.allowed) return { ok: true };
    return { ok: false, result: denialOf(decision.reason) };
  };

  return {
    saveMarker(account, input) {
      if (input === null || typeof input !== "object") {
        throw new AnalystAnnotationValidationError(["input must be a marker document"]);
      }
      if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
        throw new AnalystAnnotationValidationError(["input.sessionId must be a non-empty string"]);
      }
      const access = gate(account, "analyst-annotation.write", input.sessionId);
      if (!access.ok) return access.result;
      // -- The honest backing checks (fail-closed; never fabricated) ----------
      const backingInput = input.backing ?? "session-timeline";
      let backing: AnalystMarkerBacking;
      if (backingInput === "session-timeline") {
        const timeline = sessionTimelines(input.sessionId);
        if (timeline === null || timeline.exists !== true) {
          // A session without a real timeline cannot host media-time markers
          // (honest: no media, no markers — never a fabricated extent).
          return { kind: "refused", reason: timeline === null ? "session-unknown" : "no-timeline" };
        }
        backing = { kind: "session-timeline", durationMs: timeline.durationMs };
      } else {
        if (renderOutputs === undefined) {
          return { kind: "refused", reason: "render-lookup-unavailable" };
        }
        if (renderOutputs(input.sessionId, backingInput.renderId) !== true) {
          return { kind: "refused", reason: "render-unknown" };
        }
        backing = {
          kind: "render-output",
          renderId: backingInput.renderId,
          durationMs: backingInput.durationMs,
        };
      }
      // -- The extent checks (within the REAL backing's extent) ---------------
      const extent = backing.durationMs;
      if (input.kind === "moment") {
        if (typeof input.atMs !== "number" || !Number.isFinite(input.atMs)) {
          throw new AnalystAnnotationValidationError(["a moment marker requires a finite atMs"]);
        }
        if (input.atMs < 0 || input.atMs > extent) {
          return { kind: "refused", reason: "out-of-range" };
        }
      } else {
        if (
          typeof input.startMs !== "number" ||
          typeof input.endMs !== "number" ||
          !Number.isFinite(input.startMs) ||
          !Number.isFinite(input.endMs) ||
          input.startMs < 0 ||
          input.endMs < input.startMs
        ) {
          throw new AnalystAnnotationValidationError([
            "a clip marker requires finite startMs/endMs with 0 <= startMs <= endMs",
          ]);
        }
        if (input.endMs > extent) {
          return { kind: "refused", reason: "out-of-range" };
        }
      }
      const marker = store.putMarker({
        sessionId: input.sessionId,
        kind: input.kind,
        ...(input.atMs !== undefined ? { atMs: input.atMs } : {}),
        ...(input.startMs !== undefined ? { startMs: input.startMs } : {}),
        ...(input.endMs !== undefined ? { endMs: input.endMs } : {}),
        authorUserId: account!.userId,
        createdAtIso: new Date(nowMs()).toISOString(),
        backing,
        ...(typeof input.label === "string" && input.label.length > 0
          ? { label: input.label }
          : {}),
      });
      return { kind: "allowed", value: marker };
    },

    attachNote(account, input) {
      if (typeof input?.markerId !== "string" || input.markerId.length === 0) {
        throw new AnalystAnnotationValidationError(["input.markerId must be a non-empty string"]);
      }
      if (typeof input.text !== "string" || input.text.trim().length === 0) {
        throw new AnalystAnnotationValidationError(["input.text must be a non-empty string"]);
      }
      // The 401 boundary FIRST (before the marker lookup): an unauthenticated
      // caller gets the uniform denial and learns NOTHING about which
      // markers exist (no existence oracle at the auth boundary).
      if (account === null || account === undefined) return DENIED_UNAUTHENTICATED;
      if (input.text.length > 4000) {
        return { kind: "refused", reason: "invalid-input" };
      }
      const marker = store.markerOf(input.markerId);
      if (marker === null) return { kind: "refused", reason: "marker-unknown" };
      const access = gate(account, "analyst-annotation.write", marker.sessionId);
      if (!access.ok) return access.result;
      const note = store.putNote(
        {
          sessionId: marker.sessionId,
          text: input.text,
          authorUserId: account!.userId,
          createdAtIso: new Date(nowMs()).toISOString(),
        },
        input.markerId,
      );
      return { kind: "allowed", value: note };
    },

    listMarkers(account, sessionId) {
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new AnalystAnnotationValidationError(["sessionId must be a non-empty string"]);
      }
      const access = gate(account, "analyst-annotation.read", sessionId);
      if (!access.ok) return access.result;
      return { kind: "allowed", value: store.markersOf(sessionId) };
    },

    getMarker(account, markerId) {
      if (typeof markerId !== "string" || markerId.length === 0) {
        throw new AnalystAnnotationValidationError(["markerId must be a non-empty string"]);
      }
      // The 401 boundary FIRST (before the marker lookup — the same honest
      // order as attachNote: no marker existence leaks to the unauthenticated).
      if (account === null || account === undefined) return DENIED_UNAUTHENTICATED;
      const marker = store.markerOf(markerId);
      if (marker === null) return { kind: "refused", reason: "marker-unknown" };
      const access = gate(account, "analyst-annotation.read", marker.sessionId);
      if (!access.ok) return access.result;
      return { kind: "allowed", value: { marker, notes: store.notesOfMarker(markerId) } };
    },
  };
}

// ---------------------------------------------------------------------------
// The in-memory store
// ---------------------------------------------------------------------------

/** In-memory `AnalystAnnotationStore` (tests + ephemeral runs). */
export class InMemoryAnalystAnnotationStore implements AnalystAnnotationStore {
  private readonly markers: AnalystMarker[] = [];
  private readonly notes: AnalystNote[] = [];
  private readonly markerCounters = new Map<string, number>();
  private readonly noteCounters = new Map<string, number>();

  putMarker(marker: Omit<AnalystMarker, "markerId">): AnalystMarker {
    const counter = (this.markerCounters.get(marker.sessionId) ?? 0) + 1;
    this.markerCounters.set(marker.sessionId, counter);
    const saved: AnalystMarker = {
      ...clone(marker),
      markerId: `mk-${marker.sessionId}-${counter}`,
    };
    this.markers.push(saved);
    return clone(saved);
  }

  putNote(note: Omit<AnalystNote, "noteId" | "markerId">, markerId: string): AnalystNote {
    const counter = (this.noteCounters.get(markerId) ?? 0) + 1;
    this.noteCounters.set(markerId, counter);
    const saved: AnalystNote = {
      ...clone(note),
      markerId,
      noteId: `nt-${markerId}-${counter}`,
    };
    this.notes.push(saved);
    return clone(saved);
  }

  markerOf(markerId: string): AnalystMarker | null {
    return clone(this.markers.find((marker) => marker.markerId === markerId) ?? null);
  }

  markersOf(sessionId: string): AnalystMarker[] {
    return this.markers.filter((marker) => marker.sessionId === sessionId).map(clone);
  }

  notesOfMarker(markerId: string): AnalystNote[] {
    return this.notes.filter((note) => note.markerId === markerId).map(clone);
  }

  notesOfSession(sessionId: string): AnalystNote[] {
    return this.notes.filter((note) => note.sessionId === sessionId).map(clone);
  }
}

// ---------------------------------------------------------------------------
// The sqlite store (durable — the package's own repository pattern)
// ---------------------------------------------------------------------------

/**
 * Durable `AnalystAnnotationStore` on `bun:sqlite`: the full validated JSON
 * document per marker/note (`document_json`), validate-on-write-and-read,
 * deep-clone-on-read, DDL idempotent, `close()` idempotent. The id counters
 * are derived from the stored rows (restart-safe: the next id continues
 * after the persisted maximum).
 */
export class SqliteAnalystAnnotationStore implements AnalystAnnotationStore {
  private readonly db: Database;
  private readonly ownsDatabase: boolean;

  constructor(databaseOrPath: Database | string) {
    this.db = typeof databaseOrPath === "string" ? new Database(databaseOrPath) : databaseOrPath;
    this.ownsDatabase = typeof databaseOrPath === "string";
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sporta_analyst_markers (
        marker_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        document_json TEXT NOT NULL,
        save_seq INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sporta_analyst_markers_session ON sporta_analyst_markers (session_id);
      CREATE TABLE IF NOT EXISTS sporta_analyst_notes (
        note_id TEXT PRIMARY KEY,
        marker_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        document_json TEXT NOT NULL,
        save_seq INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sporta_analyst_notes_marker ON sporta_analyst_notes (marker_id);
      CREATE INDEX IF NOT EXISTS sporta_analyst_notes_session ON sporta_analyst_notes (session_id);
    `);
  }

  close(): void {
    if (this.ownsDatabase) this.db.close();
  }

  putMarker(marker: Omit<AnalystMarker, "markerId">): AnalystMarker {
    validateMarkerInput(marker);
    const counter = this.nextCounter("sporta_analyst_markers", "session_id", marker.sessionId);
    const saved: AnalystMarker = {
      ...clone(marker),
      markerId: `mk-${marker.sessionId}-${counter}`,
    };
    this.db
      .query(
        `INSERT INTO sporta_analyst_markers (marker_id, session_id, document_json, save_seq) VALUES (?, ?, ?, ?)`,
      )
      .run(saved.markerId, marker.sessionId, JSON.stringify(saved), counter);
    return clone(saved);
  }

  putNote(note: Omit<AnalystNote, "noteId" | "markerId">, markerId: string): AnalystNote {
    if (typeof note.sessionId !== "string" || note.sessionId.length === 0) {
      throw new AnalystAnnotationValidationError(["note.sessionId must be a non-empty string"]);
    }
    if (typeof note.text !== "string" || note.text.length === 0) {
      throw new AnalystAnnotationValidationError(["note.text must be a non-empty string"]);
    }
    const counter = this.nextCounter("sporta_analyst_notes", "marker_id", markerId);
    const saved: AnalystNote = { ...clone(note), markerId, noteId: `nt-${markerId}-${counter}` };
    this.db
      .query(
        `INSERT INTO sporta_analyst_notes (note_id, marker_id, session_id, document_json, save_seq) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(saved.noteId, markerId, note.sessionId, JSON.stringify(saved), counter);
    return clone(saved);
  }

  markerOf(markerId: string): AnalystMarker | null {
    const row = this.db
      .query(`SELECT document_json FROM sporta_analyst_markers WHERE marker_id = ?`)
      .get(markerId) as { document_json: string } | null;
    return row === null ? null : parseMarker(JSON.parse(row.document_json));
  }

  markersOf(sessionId: string): AnalystMarker[] {
    const rows = this.db
      .query(
        `SELECT document_json FROM sporta_analyst_markers WHERE session_id = ? ORDER BY save_seq ASC`,
      )
      .all(sessionId) as Array<{ document_json: string }>;
    return rows.map((row) => parseMarker(JSON.parse(row.document_json)));
  }

  notesOfMarker(markerId: string): AnalystNote[] {
    const rows = this.db
      .query(
        `SELECT document_json FROM sporta_analyst_notes WHERE marker_id = ? ORDER BY save_seq ASC`,
      )
      .all(markerId) as Array<{ document_json: string }>;
    return rows.map((row) => parseNote(JSON.parse(row.document_json)));
  }

  notesOfSession(sessionId: string): AnalystNote[] {
    const rows = this.db
      .query(
        `SELECT document_json FROM sporta_analyst_notes WHERE session_id = ? ORDER BY save_seq ASC`,
      )
      .all(sessionId) as Array<{ document_json: string }>;
    return rows.map((row) => parseNote(JSON.parse(row.document_json)));
  }

  /** The next gap-free per-scope counter (restart-safe: max(save_seq) + 1). */
  private nextCounter(table: string, scopeColumn: string, scopeValue: string): number {
    const row = this.db
      .query(`SELECT MAX(save_seq) AS max_seq FROM ${table} WHERE ${scopeColumn} = ?`)
      .get(scopeValue) as { max_seq: number | null } | null;
    return (row?.max_seq ?? 0) + 1;
  }
}

// ---------------------------------------------------------------------------
// Validation + clone helpers (fail-loud, never partial data)
// ---------------------------------------------------------------------------

function validateMarkerInput(marker: Omit<AnalystMarker, "markerId">): void {
  const issues: string[] = [];
  if (typeof marker.sessionId !== "string" || marker.sessionId.length === 0) {
    issues.push("sessionId must be a non-empty string");
  }
  if (marker.kind !== "moment" && marker.kind !== "clip") {
    issues.push("kind must be 'moment' or 'clip'");
  }
  if (typeof marker.authorUserId !== "string" || marker.authorUserId.length === 0) {
    issues.push("authorUserId must be a non-empty string");
  }
  if (marker.backing === null || typeof marker.backing !== "object") {
    issues.push("backing must be an AnalystMarkerBacking record");
  } else {
    if (marker.backing.kind !== "session-timeline" && marker.backing.kind !== "render-output") {
      issues.push("backing.kind must be 'session-timeline' or 'render-output'");
    }
    if (typeof marker.backing.durationMs !== "number" || !(marker.backing.durationMs > 0)) {
      issues.push("backing.durationMs must be a finite number > 0");
    }
  }
  if (issues.length > 0) throw new AnalystAnnotationValidationError(issues);
}

/** Parses one stored marker (fail-loud on drift — the validate-on-read rule). */
function parseMarker(value: unknown): AnalystMarker {
  const marker = value as AnalystMarker;
  validateMarkerInput(marker);
  if (typeof marker.markerId !== "string" || marker.markerId.length === 0) {
    throw new AnalystAnnotationValidationError(["the stored marker has no markerId"]);
  }
  return marker;
}

/** Parses one stored note (fail-loud on drift). */
function parseNote(value: unknown): AnalystNote {
  const note = value as AnalystNote;
  if (
    typeof note?.noteId !== "string" ||
    typeof note?.markerId !== "string" ||
    typeof note?.sessionId !== "string" ||
    typeof note?.text !== "string" ||
    typeof note?.authorUserId !== "string" ||
    typeof note?.createdAtIso !== "string"
  ) {
    throw new AnalystAnnotationValidationError(["the stored note is not an AnalystNote document"]);
  }
  return note;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
