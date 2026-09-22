/**
 * THE ANALYST ANNOTATIONS SERVICE (J010 — wave 4, Worker B) — the
 * route-facing composition over `@sporta/session`'s analyst-annotations
 * domain service (the wave-3 seam): media-time markers (moments and clip
 * intervals) saved ONLY where a REAL session timeline backs them, notes
 * attached to saved markers, both revisitable — with the domain's
 * NO-BYTES invariant intact (this service never touches, stores, mints or
 * streams media: the API answers time ranges + backing references only).
 *
 * THE ACCESS RULES (the domain seam's own, answered verbatim):
 * - the `analyst-annotation.read`/`write` identity actions — the session's
 *   OWNER, an OPERATOR, or the ANALYST grant (over any session whose
 *   ownership is readable);
 * - unauthenticated callers get the uniform 401 (the seam's own boundary —
 *   it fires BEFORE any marker existence is revealed);
 * - a refusal speaks the domain's CLOSED vocabulary:
 *   `session-unknown` (no such session — honestly told to an authorized
 *   caller), `no-timeline` (the session exists but has no REAL media
 *   timeline — a dev-seeded story cannot host media-time markers),
 *   `out-of-range` (the marker's times exceed the real timeline extent),
 *   `render-unknown` (the render reference does not exist),
 *   `render-lookup-unavailable`, `marker-unknown`, `invalid-input`.
 *
 * THE REAL BACKING SOURCES (what makes a marker honest):
 * - the session timeline extent is the media platform's ORIGINAL-reality
 *   artifact → its durable hash-verified SourceAsset's REAL `durationMs`
 *   (captured by the R101 ffmpeg normalization) — never a guessed extent;
 * - a render-backed marker's existence check is the control plane's real
 *   render list for the session;
 * - persistence is the composition's `annotationStore` (durable sqlite
 *   under Bun, the honest in-memory fallback under Node).
 *
 * THE ASYNC→SYNC BRIDGE (the J009 pattern, same discipline): the domain
 * service's lookups (`ownerIdOf`, `sessionTimelines`, `renderOutputs`) are
 * synchronous ports over async app stores. Each request PRE-RESOLVES the
 * real values through the real stores, then constructs the domain service
 * with closures answering those values. The domain seam still makes every
 * gate decision and every backing check; a pre-read that races a
 * concurrent write fails CLOSED (an unresolved owner denies
 * unknown-resource; an unresolved marker refuses marker-unknown), never
 * open.
 */
import { createAnalystAnnotationService } from "@sporta/session";
import type {
  AnalystAnnotationResult,
  AnalystAnnotationService,
  AnalystMarker,
  AnalystNote,
  RenderOutputLookup,
  SessionTimelineLookup,
} from "@sporta/session";
import type { Account } from "@sporta/identity";
import { AuthFlowError } from "./auth-service";
import type { SportaServer } from "./composition";

// ---------------------------------------------------------------------------
// The route-facing models
// ---------------------------------------------------------------------------

/** One saved marker, as the API answers it (time ranges + backing — never bytes). */
export type AnalystMarkerView = AnalystMarker;

/** One attached note, as the API answers it. */
export type AnalystNoteView = AnalystNote;

/** The honest state of a session's REAL media timeline (the backing source). */
export type SessionTimelineState =
  | { available: true; durationMs: number }
  | { available: false; reason: "session-unknown" | "no-timeline" };

/** The per-session markers document (the revisit seam's answer). */
export interface SessionMarkersModel {
  sessionId: string;
  label: string;
  /** The REAL timeline state (honest when no media backs the session). */
  timeline: SessionTimelineState;
  markers: AnalystMarkerView[];
}

/** One marker with its attached notes (the drill-down answer). */
export interface MarkerWithNotesModel {
  marker: AnalystMarkerView;
  notes: AnalystNoteView[];
}

/** The typed refusal the routes answer (the domain's closed vocabulary). */
export type AnnotationRefusalReason =
  | "session-unknown"
  | "no-timeline"
  | "out-of-range"
  | "render-unknown"
  | "render-lookup-unavailable"
  | "marker-unknown"
  | "invalid-input";

/** One honest refusal carrying the closed vocabulary + the next action. */
export class AnnotationRefusedError extends Error {
  readonly reason: AnnotationRefusalReason;
  readonly httpStatus: number;

  constructor(reason: AnnotationRefusalReason, httpStatus: number, message: string) {
    super(message);
    this.name = "AnnotationRefusedError";
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

/** The useful next action per refusal reason (one wording, every surface). */
export function refusalNextAction(reason: AnnotationRefusalReason): string {
  switch (reason) {
    case "session-unknown":
      return "Pick a session that exists (the picker lists the real catalog; ids come from Watch, Library or Jobs).";
    case "no-timeline":
      return "This session has no real media timeline yet — upload authorized footage through the Create Studio first; a story-only session cannot host media-time markers.";
    case "out-of-range":
      return "Bring the marker's times inside the session's real timeline extent (shown above the form).";
    case "render-unknown":
      return "Reference a render that exists on this session (the Watch surface lists the real renders).";
    case "render-lookup-unavailable":
      return "Render-backed markers are unavailable in this composition — the session-timeline backing works today.";
    case "marker-unknown":
      return "The marker no longer exists (or never did) — reload the session's markers.";
    case "invalid-input":
      return "Fix the input (a note is non-empty text of at most 4000 characters).";
  }
}

// ---------------------------------------------------------------------------
// The per-request domain composition
// ---------------------------------------------------------------------------

/** Resolves the caller's account (`null` = anonymous — the seam's own 401). */
async function resolveAccount(server: SportaServer, token: string): Promise<Account | null> {
  const resolved = await server.auth.resolve(token);
  return resolved === null ? null : resolved.account;
}

/**
 * Resolves the session's REAL timeline state: the control plane's existence
 * answer + the media platform's original-reality artifact → its durable
 * SourceAsset's `durationMs`. A session with no stored original artifact
 * has NO real media timeline (honest `no-timeline` — never a guessed
 * extent).
 */
async function resolveTimelineState(
  server: SportaServer,
  sessionId: string,
): Promise<SessionTimelineState> {
  const { sessions } = await server.control.listSessions();
  const known = sessions.some((entry) => entry.id === sessionId);
  if (!known) return { available: false, reason: "session-unknown" };
  const artifact = server.media
    .artifactsOfSession(sessionId)
    .find((entry) => entry.reality === "original");
  const assetId = artifact?.sourceAssetId ?? null;
  const asset = assetId === null ? null : server.media.asset(assetId);
  if (asset === null || !(asset.durationMs > 0)) {
    return { available: false, reason: "no-timeline" };
  }
  return { available: true, durationMs: asset.durationMs };
}

/** The domain `SessionTimelineLookup` for one pre-resolved session. */
function timelineLookupOf(state: SessionTimelineState): SessionTimelineLookup {
  return () =>
    state.available
      ? { exists: true, durationMs: state.durationMs }
      : state.reason === "session-unknown"
        ? null
        : { exists: false };
}

/** The domain `RenderOutputLookup` for one pre-resolved render-id set. */
async function renderLookupOf(
  server: SportaServer,
  sessionId: string,
): Promise<RenderOutputLookup> {
  // An unknown session has no renders to reference: the empty set lets the
  // DOMAIN seam answer first (its own session-unknown refusal, through the
  // timeline lookup — the closed vocabulary, never a leaked 404 here).
  let renderIds = new Set<string>();
  try {
    const { renders } = await server.control.listRenders(sessionId);
    renderIds = new Set(renders.map((render) => render.renderId));
  } catch {
    renderIds = new Set();
  }
  return (id, renderId) => id === sessionId && renderIds.has(renderId);
}

/**
 * Constructs the domain service for one request over the SHARED durable
 * store, with the caller's account + the session's pre-resolved REAL
 * ownership context (the domain seam's authorize input).
 */
function serviceFor(
  server: SportaServer,
  account: Account | null,
  resolvedOwnerId: string | null,
): AnalystAnnotationService {
  return createAnalystAnnotationService({
    store: server.annotationStore,
    sessionTimelines: () => null, // per-call pre-resolution overrides this
    ownerIdOf: () => resolvedOwnerId,
    renderOutputs: () => false, // per-call pre-resolution overrides this
    nowMs: server.nowMs,
  });
}

/** Maps one domain denial onto the app's typed error convention (verbatim status). */
function throwIfDenied<T>(result: AnalystAnnotationResult<T>): T {
  if (result.kind === "allowed") return result.value;
  if (result.kind === "denied") {
    const status = result.httpStatus;
    throw new AuthFlowError(
      status,
      status === 401 ? "unauthenticated" : "permission-denied",
      status === 401
        ? "analyst annotations require a signed-in account"
        : "this account may not annotate this session (the session's owner, an operator, or the analyst grant is required)",
      { seam: "analyst-annotations", reason: result.reason },
    );
  }
  throw new AnnotationRefusedError(
    result.reason,
    result.reason === "marker-unknown" ? 404 : 422,
    `${result.reason}: ${refusalNextAction(result.reason)}`,
  );
}

// ---------------------------------------------------------------------------
// The route-facing operations
// ---------------------------------------------------------------------------

/**
 * Lists a session's saved markers + the session's REAL timeline state (the
 * /clips and /notes surfaces' revisit seam). Anonymous → 401; callers
 * without the owner/operator/analyst standing → the uniform 403 (whether or
 * not the session exists — no oracle); authorized callers get the honest
 * model (an unavailable timeline is a real state, never a hidden one).
 */
export async function listSessionMarkers(
  server: SportaServer,
  token: string,
  sessionId: string,
): Promise<SessionMarkersModel> {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new AuthFlowError(400, "validation", "sessionId must be a non-empty string");
  }
  const account = await resolveAccount(server, token);
  const ownerId = await server.ownership.ownerIdOf(sessionId);
  const service = serviceFor(server, account, ownerId);
  const markers = throwIfDenied(
    service.listMarkers(
      account === null ? null : { userId: account.userId, roles: [...account.roles] },
      sessionId,
    ),
  );
  const { sessions } = await server.control.listSessions();
  const label = sessions.find((entry) => entry.id === sessionId)?.sourceLabel ?? sessionId;
  return {
    sessionId,
    label,
    timeline: await resolveTimelineState(server, sessionId),
    markers,
  };
}

/**
 * Saves one media-time marker (a moment or a clip interval) where a REAL
 * timeline backs it. The domain seam performs the backing checks
 * (session-unknown / no-timeline / out-of-range / render-unknown — the
 * closed vocabulary) and never stores bytes: the marker is a time range +
 * a backing reference.
 */
export async function saveMarker(
  server: SportaServer,
  token: string,
  input: unknown,
): Promise<AnalystMarkerView> {
  const record = parseMarkerInput(input);
  const account = await resolveAccount(server, token);
  const ownerId = await server.ownership.ownerIdOf(record.sessionId);
  const timelineState = await resolveTimelineState(server, record.sessionId);
  const renderOutputs = await renderLookupOf(server, record.sessionId);
  const service = createAnalystAnnotationService({
    store: server.annotationStore,
    sessionTimelines: timelineLookupOf(timelineState),
    ownerIdOf: () => ownerId,
    renderOutputs,
    nowMs: server.nowMs,
  });
  return throwIfDenied(
    service.saveMarker(
      account === null ? null : { userId: account.userId, roles: [...account.roles] },
      record,
    ),
  );
}

/**
 * Attaches one note to a saved marker (first-class, persisted, revisitable).
 */
export async function attachNote(
  server: SportaServer,
  token: string,
  input: unknown,
): Promise<AnalystNoteView> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new AuthFlowError(400, "validation", "the request body must be { markerId, text }");
  }
  const record = input as Record<string, unknown>;
  if (typeof record.markerId !== "string" || record.markerId.length === 0) {
    throw new AuthFlowError(400, "validation", "markerId must be a non-empty string");
  }
  if (typeof record.text !== "string" || record.text.trim().length === 0) {
    throw new AuthFlowError(400, "validation", "text must be a non-empty string");
  }
  const account = await resolveAccount(server, token);
  // Pre-read the marker from the SHARED store (the same store the domain
  // service reads) to pre-resolve its session's ownership — the domain seam
  // still makes the marker-unknown / gate decisions itself.
  const marker = server.annotationStore.markerOf(record.markerId);
  const ownerId = marker === null ? null : await server.ownership.ownerIdOf(marker.sessionId);
  const service = serviceFor(server, account, ownerId);
  return throwIfDenied(
    service.attachNote(
      account === null ? null : { userId: account.userId, roles: [...account.roles] },
      { markerId: record.markerId, text: record.text },
    ),
  );
}

/**
 * One marker with its attached notes (the revisit drill-down).
 */
export async function getMarker(
  server: SportaServer,
  token: string,
  markerId: string,
): Promise<MarkerWithNotesModel> {
  if (typeof markerId !== "string" || markerId.length === 0) {
    throw new AuthFlowError(400, "validation", "markerId must be a non-empty string");
  }
  const account = await resolveAccount(server, token);
  const marker = server.annotationStore.markerOf(markerId);
  const ownerId = marker === null ? null : await server.ownership.ownerIdOf(marker.sessionId);
  const service = serviceFor(server, account, ownerId);
  return throwIfDenied(
    service.getMarker(
      account === null ? null : { userId: account.userId, roles: [...account.roles] },
      markerId,
    ),
  );
}

// ---------------------------------------------------------------------------
// Input parsing (fail-loud, before any gate or store touch)
// ---------------------------------------------------------------------------

/** The parsed marker-save input (the domain service's own input shape). */
interface MarkerSaveInput {
  sessionId: string;
  kind: "moment" | "clip";
  atMs?: number;
  startMs?: number;
  endMs?: number;
  label?: string;
  backing?: "session-timeline" | { kind: "render-output"; renderId: string; durationMs: number };
}

/** Parses + sanity-checks the marker-save body (the 400-shaped refusals). */
function parseMarkerInput(input: unknown): MarkerSaveInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new AuthFlowError(400, "validation", "the request body must be a marker document");
  }
  const record = input as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof record.sessionId !== "string" || record.sessionId.length === 0) {
    issues.push("sessionId must be a non-empty string");
  }
  if (record.kind !== "moment" && record.kind !== "clip") {
    issues.push("kind must be 'moment' or 'clip'");
  }
  if (
    record.label !== undefined &&
    (typeof record.label !== "string" || record.label.length > 200)
  ) {
    issues.push("label must be a string of at most 200 characters");
  }
  if (issues.length > 0) {
    throw new AuthFlowError(400, "validation", issues.join("; "));
  }
  const parsed: MarkerSaveInput = {
    sessionId: record.sessionId as string,
    kind: record.kind as "moment" | "clip",
  };
  if (parsed.kind === "moment") {
    if (typeof record.atMs !== "number" || !Number.isFinite(record.atMs)) {
      throw new AuthFlowError(400, "validation", "a moment marker requires a finite atMs");
    }
    parsed.atMs = record.atMs;
  } else {
    if (
      typeof record.startMs !== "number" ||
      typeof record.endMs !== "number" ||
      !Number.isFinite(record.startMs) ||
      !Number.isFinite(record.endMs) ||
      record.startMs < 0 ||
      record.endMs < record.startMs
    ) {
      throw new AuthFlowError(
        400,
        "validation",
        "a clip marker requires finite startMs/endMs with 0 <= startMs <= endMs",
      );
    }
    parsed.startMs = record.startMs;
    parsed.endMs = record.endMs;
  }
  if (typeof record.label === "string" && record.label.length > 0) {
    parsed.label = record.label;
  }
  if (record.backing !== undefined && record.backing !== null) {
    if (record.backing === "session-timeline") {
      parsed.backing = "session-timeline";
    } else if (
      typeof record.backing === "object" &&
      !Array.isArray(record.backing) &&
      (record.backing as Record<string, unknown>).kind === "render-output" &&
      typeof (record.backing as Record<string, unknown>).renderId === "string" &&
      typeof (record.backing as Record<string, unknown>).durationMs === "number"
    ) {
      parsed.backing = record.backing as {
        kind: "render-output";
        renderId: string;
        durationMs: number;
      };
    } else {
      throw new AuthFlowError(
        400,
        "validation",
        'backing must be "session-timeline" or { kind: "render-output", renderId, durationMs }',
      );
    }
  }
  return parsed;
}
