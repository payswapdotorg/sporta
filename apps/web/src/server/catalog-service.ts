/**
 * The catalog + watch model service (W904/W905 → W916) — real control-plane
 * data, projected to the JSON shapes the client surfaces consume.
 *
 * HONESTY RULES (the W901/W902 posture, enforced here):
 * - Playback availability is the REAL fail-closed rights derivation of the
 *   session's stored policy (`canStoreDerivatives` at request time).
 * - A playback-denied session reveals NOTHING about its renders: the
 *   control plane's own `listRenders` gate denies before existence is
 *   revealed, so the card/watch model answers `renders: null` — and W916
 *   extends the same fail-closure to the REALITY groups (`realities: null`:
 *   a denied session does not disclose how it was rendered).
 * - The story metadata a seeded session carries is labeled `"dev-seed"` —
 *   it is the real fixture-transcript/events data the real chain produced.
 *
 * W916 — the content model, on top of the W906 publication store:
 * - REQUESTER-SCOPED DISCOVERABILITY: `buildCatalogFor` lists what THIS
 *   requester is authorized to discover (anonymous → public only;
 *   authenticated → public + their own; rights holders → public + owned +
 *   policy-scoped sessions they attested; operators → the full operational
 *   view; role-scoped content additionally reaches the named grants).
 *   Fail-closed: an unknown visibility is discoverable by NOBODY.
 * - NO EXISTENCE ORACLE: non-discoverable sessions are simply absent from
 *   listings/search — never 403-vs-404 distinguished — and the watch gate
 *   answers them with the byte-identical unknown-session 404.
 * - REALITY LINKAGE: every card carries its REALITY GROUPS — the renders of
 *   the SAME match session grouped per renderer (`realities`), so the UI can
 *   say "this match in N realities" from real data. Denied sessions carry
 *   `null` (no render existence revealed).
 * - SEARCH: real text matching over real fields (labels, story keys,
 *   renderer ids) with status/renderer/rights filters — over the
 *   requester-scoped discoverable set only.
 */
import type { SportaServer } from "./composition";
import type { SeedStoryMeta } from "./dev-seed";
import type { ContentVisibilityRecord } from "./publication";
import { tokenFromRequest } from "./auth-service";
import { authorize } from "@sporta/identity";
import { SessionStatus } from "@sporta/contracts";
import type { Role } from "@sporta/capability";

// ---------------------------------------------------------------------------
// The requester model (W916)
// ---------------------------------------------------------------------------

/** Who is asking the catalog for content (anonymous by default). */
export interface CatalogRequester {
  state: "anonymous" | "authenticated";
  /** The authenticated account's id (`null` when anonymous). */
  userId: string | null;
  /** The account's REAL grants (never the presentation `activeRole`). */
  grants: readonly Role[];
}

/** The anonymous requester (the catalog's default view). */
export const ANONYMOUS_REQUESTER: CatalogRequester = {
  state: "anonymous",
  userId: null,
  grants: [],
};

/** The requester-view summary the catalog answers carry (self-data only). */
export interface CatalogViewerSummary {
  state: "anonymous" | "authenticated";
  userId: string | null;
  grants: readonly Role[];
}

/** Resolves the catalog requester from a request (anonymous when unauthenticated). */
export async function resolveCatalogRequester(
  server: SportaServer,
  request?: Request,
): Promise<CatalogRequester> {
  const token = request === undefined ? "" : tokenFromRequest(request);
  if (token === "") return ANONYMOUS_REQUESTER;
  const resolved = await server.auth.resolve(token);
  if (resolved === null) return ANONYMOUS_REQUESTER;
  return {
    state: "authenticated",
    userId: resolved.account.userId,
    grants: [...resolved.account.roles],
  };
}

/** `true` when the requester holds the operator grant. */
function isOperator(requester: CatalogRequester): boolean {
  return requester.grants.includes("operator");
}

// ---------------------------------------------------------------------------
// The typed query error (search/filter validation — strict, closed vocab)
// ---------------------------------------------------------------------------

/** A malformed catalog query (400 `validation` — never a silent empty answer). */
export class CatalogQueryError extends Error {
  readonly status = 400 as const;
  readonly failureClass = "validation" as const;

  constructor(message: string) {
    super(message);
    this.name = "CatalogQueryError";
  }
}

// ---------------------------------------------------------------------------
// Discoverability (W916 — the content-model decision, fail-closed)
// ---------------------------------------------------------------------------

/** What the catalog needs to know about one session to decide discoverability. */
export interface SessionAccessFacts {
  sessionId: string;
  /** The session's real source label (fallback: the id). */
  label: string;
  /** The account that owns the session, when one is recorded. */
  ownerId: string | null;
  /** Who attested the session's rights policy (`assertedBy`, when present). */
  policyAssertedBy: string | null;
  /** The parsed visibility record (`null` = unknown → NOT discoverable). */
  visibility: ContentVisibilityRecord | null;
}

/**
 * Decides whether `requester` may discover a session — PURE, fail-closed.
 *
 * - `public` → everyone (anonymous included).
 * - `private` / `unlisted` → the owner and operators (unlisted is additionally
 *   watchable by link — see {@link assertWatchable} — but never listed).
 * - `role-scoped` → the named grants, the owner, and operators.
 * - the rights-holder policy scope: a rights holder also discovers sessions
 *   whose rights policy THEY attested (`assertedBy` — real policy data).
 * - UNKNOWN (`visibility === null`) → NOBODY (fail-closed: unknown means
 *   hidden, never public — not even the operator's listing shows it).
 */
export function sessionDiscoverableBy(
  requester: CatalogRequester,
  facts: SessionAccessFacts,
): boolean {
  const record = facts.visibility;
  if (record === null) return false; // fail-closed: unknown visibility
  if (record.kind === "public") return true;
  if (requester.state !== "authenticated") return false;
  if (isOperator(requester)) return true;
  if (requester.userId !== null && facts.ownerId === requester.userId) return true;
  if (
    record.kind === "role-scoped" &&
    requester.grants.some((role) => record.roles.includes(role))
  ) {
    return true;
  }
  if (
    requester.grants.includes("rights-holder") &&
    requester.userId !== null &&
    facts.policyAssertedBy === requester.userId
  ) {
    return true; // the rights-holder policy scope (they attested these rights)
  }
  return false;
}

// ---------------------------------------------------------------------------
// The card model (extended W916: realities + viewer-scoped fields)
// ---------------------------------------------------------------------------

/** One reality of a match session — one renderer's rendering of it. */
export interface RealityGroupModel {
  /** The renderer that produced this reality (the Reality Switcher's key). */
  rendererId: string;
  /** The render that materialized it. */
  renderId: string;
  /**
   * The reality's real availability:
   * - `ready` — stored outputs exist for this renderer;
   * - `no-stored-output` — the render ran but nothing is stored;
   * - `renderer-unavailable` — the renderer is no longer registered.
   */
  state: "ready" | "no-stored-output" | "renderer-unavailable";
  segmentCount: number;
  hasStoredOutputs: boolean;
}

/** One catalog card (the client-facing session summary). */
export interface SessionCardModel {
  sessionId: string;
  label: string;
  /** The REAL session lifecycle status (created/authorized/ingesting/...). */
  status: string;
  createdAtIso: string;
  /** The real playback-rights decision for this session. */
  playback: { state: "authorized" | "denied"; reasonCode: "ok" | "rights-denied" };
  /**
   * The session's renders — `null` when playback is denied (fail-closed:
   * the control plane's render listing is rights-gated before existence).
   */
  renders:
    | {
        renderId: string;
        rendererId: string;
        segmentCount: number;
        hasStoredOutputs: boolean;
      }[]
    | null;
  /** Stored output segments across all renders (`null` when denied). */
  outputCount: number | null;
  /**
   * W916 REALITY LINKAGE — the same match session's renderings grouped per
   * renderer (alternate realities of one match). `null` when playback is
   * denied: a denied session reveals nothing about how it was rendered.
   */
  realities: RealityGroupModel[] | null;
  /** How many realities this match exists in (`null` when denied). */
  realityCount: number | null;
  /**
   * The session's visibility — exposed ONLY to its owner or an operator
   * (`null` for everyone else; `kind: "unknown"` is the honest broken-store
   * state owners/operators can see and act on).
   */
  visibility: {
    kind: "public" | "private" | "unlisted" | "role-scoped" | "unknown";
    roles: readonly string[];
  } | null;
  /**
   * Operator-only operational fields (`null` for everyone else). Honest by
   * construction: render/output counts obey the same rights gates everyone
   * else's cards obey — the operator's extra view is WHICH sessions exist
   * and their publication state, not denied sessions' render interiors.
   */
  operational: { ownerRecorded: boolean } | null;
  /** The dev-seed story this session carries, when it has one (labeled). */
  story: { source: "dev-seed"; storyKey: string; eventCount: number } | null;
}

/** One render in the watch model (fuller than the card entry). */
export interface WatchRenderModel {
  renderId: string;
  rendererId: string;
  /** The render result's real watermark + provenance (the SWM evidence). */
  watermarkAfter: { watermarkMs: number; sequence: number };
  provenance: { snapshotVersion: number; lastEventSequence: number };
  rendererHealth: { lagMs: number; degraded: boolean; degradationReason?: string };
  segmentCount: number;
  /** The stored output segments (empty when the render produced none). */
  outputs: { segmentId: string; contentType: string; byteLength: number; contentHash: string }[];
}

/** One entry of the session's real SWM event tail (world-model events). */
export interface WatchEventTailModel {
  sequence: number;
  eventId: string;
  /** The event's real time on the session (match) timeline. */
  eventTimeMs: number;
  /** The taxonomy reference (e.g. `football/v1/pass`). */
  eventTypeRef: string;
  /** The event's real confidence, when the envelope carries one. */
  confidence?: number;
}

/** The watch model (the playback-session acquisition document). */
export interface WatchModel {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  playback: { state: "authorized" | "denied"; reasonCode: "ok" | "rights-denied" };
  renders: WatchRenderModel[] | null;
  /**
   * The session's REAL SWM event tail (`engine.eventsSince(0)` — the
   * world-model events the control plane's snapshot consumed), `null` when
   * playback is denied (fail-closed: session internals are not revealed).
   */
  eventTail: WatchEventTailModel[] | null;
  /** The dev-seed story (transcript + extracted events), when one exists. */
  story:
    | (SeedStoryMeta & {/** Where to watch: the render+segment pairs that have stored outputs. */})
    | null;
}

// ---------------------------------------------------------------------------
// The card builders
// ---------------------------------------------------------------------------

/** The viewer-scoped fields a card builder needs (anonymous = no exposure). */
interface CardViewer {
  requester: CatalogRequester;
  ownerId: string | null;
}

/** Gathers one session's real access facts (ownership, attestation, visibility). */
async function accessFactsOf(
  server: SportaServer,
  sessionId: string,
  label: string,
): Promise<SessionAccessFacts> {
  const ownerId = await server.ownership.ownerIdOf(sessionId);
  await server.control.getSession(sessionId); // presence check (denies unknown ids here)
  return {
    sessionId,
    label,
    ownerId,
    policyAssertedBy: server.attestations.attestedByOf(sessionId),
    visibility: server.publication.contentOf(sessionId),
  };
}

/** The real renderer ids currently registered (for reality availability). */
async function registeredRendererIds(server: SportaServer): Promise<ReadonlySet<string>> {
  const { renderers } = await server.control.listRenderers();
  return new Set(renderers.map((renderer) => renderer.rendererId));
}

/**
 * Maps one session's real renders onto its reality groups (fail-closed).
 * Exported for the route layer's tests (a pure mapping over real render
 * data — the registry membership that decides `renderer-unavailable`).
 */
export function realityGroupsOf(
  renders: readonly {
    renderId: string;
    rendererId: string;
    hasStoredOutputs: boolean;
    segmentCount: number;
  }[],
  registered: ReadonlySet<string>,
): RealityGroupModel[] {
  return renders.map((render) => ({
    rendererId: render.rendererId,
    renderId: render.renderId,
    state: render.hasStoredOutputs
      ? "ready"
      : registered.has(render.rendererId)
        ? "no-stored-output"
        : "renderer-unavailable",
    segmentCount: render.segmentCount,
    hasStoredOutputs: render.hasStoredOutputs,
  }));
}

/** Builds one session's card from the REAL control-plane state. */
async function buildCard(
  server: SportaServer,
  sessionId: string,
  label: string | undefined,
  viewer: CardViewer = { requester: ANONYMOUS_REQUESTER, ownerId: null },
): Promise<SessionCardModel> {
  const { session, rightsCapabilities } = await server.control.getSession(sessionId);
  const authorized = rightsCapabilities.canStoreDerivatives === true;
  const story = server.storyIndex.get(sessionId) ?? null;
  const cardLabel = label ?? sessionId;

  // Viewer-scoped exposure: the visibility flag goes to the owner/operator;
  // the operational block goes to operators only.
  const viewerMaySeeVisibility =
    (viewer.requester.userId !== null && viewer.ownerId === viewer.requester.userId) ||
    isOperator(viewer.requester);
  const visibilityField: SessionCardModel["visibility"] = viewerMaySeeVisibility
    ? {
        kind: server.publication.contentOf(sessionId)?.kind ?? "unknown",
        roles: server.publication.contentOf(sessionId)?.roles ?? [],
      }
    : null;
  const operational: SessionCardModel["operational"] = isOperator(viewer.requester)
    ? { ownerRecorded: viewer.ownerId !== null }
    : null;

  if (!authorized) {
    // Fail-closed: render existence is not revealed for denied sessions —
    // neither as renders nor as reality groups.
    return {
      sessionId,
      label: cardLabel,
      status: session.status,
      createdAtIso: session.createdAtIso,
      playback: { state: "denied", reasonCode: "rights-denied" },
      renders: null,
      outputCount: null,
      realities: null,
      realityCount: null,
      visibility: visibilityField,
      operational,
      story:
        story === null
          ? null
          : { source: "dev-seed", storyKey: story.storyKey, eventCount: story.events.length },
    };
  }

  const { renders } = await server.control.listRenders(sessionId);
  const registered = await registeredRendererIds(server);
  let outputCount = 0;
  const renderModels: NonNullable<SessionCardModel["renders"]> = [];
  for (const render of renders) {
    const outputs = await server.control.listRenderOutputs(sessionId, render.renderId);
    outputCount += outputs.segments.length;
    renderModels.push({
      renderId: render.renderId,
      rendererId: render.rendererId,
      segmentCount: render.segmentCount,
      hasStoredOutputs: outputs.segments.length > 0,
    });
  }
  return {
    sessionId,
    label: cardLabel,
    status: session.status,
    createdAtIso: session.createdAtIso,
    playback: { state: "authorized", reasonCode: "ok" },
    renders: renderModels,
    outputCount,
    realities: realityGroupsOf(renderModels, registered),
    realityCount: renderModels.length,
    visibility: visibilityField,
    operational,
    story:
      story === null
        ? null
        : { source: "dev-seed", storyKey: story.storyKey, eventCount: story.events.length },
  };
}

/**
 * The W904 catalog builder — the PUBLIC (anonymous) view. Kept for the
 * surfaces that answer anonymous callers; W916 listings use
 * {@link buildCatalogFor} with the resolved requester.
 */
export async function buildCatalog(server: SportaServer): Promise<SessionCardModel[]> {
  return (await buildCatalogFor(server, ANONYMOUS_REQUESTER)).sessions;
}

/** A listing result with its honest degraded-state report, when one occurred. */
export interface CatalogListing {
  sessions: SessionCardModel[];
  /** `null` when the listing was complete; the honest reason when it wasn't. */
  degraded: { reasonCode: "session-terminated"; skippedSessions: number } | null;
}

/**
 * W916: builds the REQUESTER-SCOPED catalog listing — every session THIS
 * requester is authorized to discover (see {@link sessionDiscoverableBy}).
 * A session that disappears between listing and card-building (terminated
 * mid-flight) is skipped and honestly reported as degraded — never a 500.
 */
export async function buildCatalogFor(
  server: SportaServer,
  requester: CatalogRequester,
): Promise<CatalogListing> {
  const { sessions } = await server.control.listSessions();
  const cards: SessionCardModel[] = [];
  let skipped = 0;
  for (const summary of sessions) {
    const facts = await accessFactsOf(server, summary.id, summary.sourceLabel ?? summary.id);
    if (!sessionDiscoverableBy(requester, facts)) continue;
    try {
      cards.push(
        await buildCard(server, summary.id, summary.sourceLabel, {
          requester,
          ownerId: facts.ownerId,
        }),
      );
    } catch (err) {
      // A session terminated between the listing and the card read is an
      // honest partial listing, not a server failure. Anything else throws.
      const { ControlUnknownSessionError } = await import("@sporta/control-api");
      if (err instanceof ControlUnknownSessionError) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }
  return {
    sessions: cards,
    degraded: skipped > 0 ? { reasonCode: "session-terminated", skippedSessions: skipped } : null,
  };
}

/** The requester-view summary for a catalog answer (self-data only). */
export function viewerSummaryOf(requester: CatalogRequester): CatalogViewerSummary {
  return { state: requester.state, userId: requester.userId, grants: requester.grants };
}

/**
 * Builds the signed-in user's library (their OWN sessions, by ownership).
 * W916: the library stays the ownership axis — the owner sees their sessions
 * regardless of visibility (including an unknown one, so a broken flag is
 * always visible to the one account that can fix it).
 */
export async function buildLibrary(
  server: SportaServer,
  userId: string,
): Promise<SessionCardModel[]> {
  const { sessions } = await server.control.listSessions();
  const cards: SessionCardModel[] = [];
  for (const summary of sessions) {
    const id = summary.id;
    const ownerId = await server.ownership.ownerIdOf(id);
    if (ownerId !== userId) continue;
    cards.push(
      await buildCard(server, id, summary.sourceLabel, {
        requester: { state: "authenticated", userId, grants: [] },
        ownerId,
      }),
    );
  }
  return cards;
}

// ---------------------------------------------------------------------------
// The reality-grouped view (W916 — the Reality Switcher's catalog data model)
// ---------------------------------------------------------------------------

/** One match entry in the reality-grouped catalog view. */
export interface RealityMatchModel {
  /** The match session — CONSTANT across all its realities (Simulation G). */
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  playback: { state: "authorized" | "denied"; reasonCode: "ok" | "rights-denied" };
  /** How many realities this match exists in (`null` when denied). */
  realityCount: number | null;
  /** The realities, grouped per renderer (`null` when denied). */
  realities: RealityGroupModel[] | null;
  story: { source: "dev-seed"; storyKey: string; eventCount: number } | null;
}

/**
 * W916: builds the reality-grouped catalog view — one match entry per
 * discoverable session, carrying that session's reality groups (the same
 * renderer-linked data the cards carry, in the shape the Reality Switcher's
 * "this match in N realities" rendering consumes).
 */
export async function buildRealityGroups(
  server: SportaServer,
  requester: CatalogRequester,
): Promise<CatalogListing & { matches: RealityMatchModel[] }> {
  const listing = await buildCatalogFor(server, requester);
  const matches: RealityMatchModel[] = listing.sessions.map((card) => ({
    sessionId: card.sessionId,
    label: card.label,
    status: card.status,
    createdAtIso: card.createdAtIso,
    playback: card.playback,
    realityCount: card.realityCount,
    realities: card.realities,
    story: card.story,
  }));
  return { ...listing, matches };
}

// ---------------------------------------------------------------------------
// Search (W916 — the Search surface's data layer)
// ---------------------------------------------------------------------------

/** The closed search-filter vocabularies. */
export const SEARCH_RIGHTS_FILTERS = ["authorized", "denied"] as const;
export type SearchRightsFilter = (typeof SEARCH_RIGHTS_FILTERS)[number];

/** A parsed, validated catalog search query. */
export interface CatalogSearchQuery {
  /** Free-text match (case-insensitive substring over the real fields). */
  q: string | null;
  /** Exact session-status filter (the frozen `SessionStatus` vocabulary). */
  status: (typeof SessionStatus)["options"][number] | null;
  /** Exact renderer-id filter (matched against the session's real renders). */
  renderer: string | null;
  /** Playback-rights filter (the card's real playback decision). */
  rights: SearchRightsFilter | null;
}

/** The search fields a match hit (reported honestly, from the real data). */
export type SearchMatchedOn = "label" | "story" | "renderer";

/** One search result: the card plus which real fields matched. */
export type CatalogSearchMatch = SessionCardModel & { matchedOn: SearchMatchedOn[] };

/** Parses + validates the raw query params (strict: unknown values are 400s). */
export function parseSearchQuery(params: URLSearchParams): CatalogSearchQuery {
  const raw = {
    q: params.get("q"),
    status: params.get("status"),
    renderer: params.get("renderer"),
    rights: params.get("rights"),
  };
  const query: CatalogSearchQuery = { q: null, status: null, renderer: null, rights: null };

  if (raw.q !== null && raw.q.trim() !== "") {
    query.q = raw.q.trim();
  }
  if (raw.status !== null) {
    if (!(SessionStatus.options as readonly string[]).includes(raw.status)) {
      throw new CatalogQueryError(
        `unknown status filter "${raw.status}" (closed vocabulary: ${SessionStatus.options.join(", ")})`,
      );
    }
    query.status = raw.status as CatalogSearchQuery["status"];
  }
  if (raw.renderer !== null && raw.renderer !== "") {
    query.renderer = raw.renderer;
  }
  if (raw.rights !== null) {
    if (!(SEARCH_RIGHTS_FILTERS as readonly string[]).includes(raw.rights)) {
      throw new CatalogQueryError(
        `unknown rights filter "${raw.rights}" (closed vocabulary: ${SEARCH_RIGHTS_FILTERS.join(", ")})`,
      );
    }
    query.rights = raw.rights as SearchRightsFilter;
  }
  if (
    query.q === null &&
    query.status === null &&
    query.renderer === null &&
    query.rights === null
  ) {
    throw new CatalogQueryError(
      "empty search: provide q (text), status, renderer, or rights — a search must search something",
    );
  }
  return query;
}

/**
 * W916: runs a real search over the requester-scoped discoverable catalog.
 *
 * Text matching is over REAL fields only — the session label, the story key
 * (the labeled dev-seed metadata), and the renderer ids of the session's
 * renders (never revealed for playback-denied sessions: a denied session can
 * never match on renderer — fail-closed). Filters are exact over the same
 * card fields. Non-discoverable sessions are filtered out BEFORE matching:
 * a search can never reveal what a listing would not.
 */
export async function searchCatalog(
  server: SportaServer,
  requester: CatalogRequester,
  query: CatalogSearchQuery,
): Promise<{ matches: CatalogSearchMatch[]; degraded: CatalogListing["degraded"] }> {
  const listing = await buildCatalogFor(server, requester);
  const needle = query.q === null ? null : query.q.toLowerCase();
  const matches: CatalogSearchMatch[] = [];
  for (const card of listing.sessions) {
    // Filters first (exact, typed), then the text match.
    if (query.status !== null && card.status !== query.status) continue;
    if (query.rights !== null && card.playback.state !== query.rights) continue;
    if (
      query.renderer !== null &&
      !(card.realities ?? []).some((reality) => reality.rendererId === query.renderer)
    ) {
      continue;
    }
    if (needle === null) {
      matches.push({ ...card, matchedOn: [] });
      continue;
    }
    const matchedOn: SearchMatchedOn[] = [];
    if (card.label.toLowerCase().includes(needle)) matchedOn.push("label");
    if (card.story !== null && card.story.storyKey.toLowerCase().includes(needle)) {
      matchedOn.push("story");
    }
    if (
      (card.realities ?? []).some((reality) => reality.rendererId.toLowerCase().includes(needle))
    ) {
      matchedOn.push("renderer");
    }
    if (matchedOn.length === 0) continue;
    matches.push({ ...card, matchedOn });
  }
  return { matches, degraded: listing.degraded };
}

// ---------------------------------------------------------------------------
// The watch model + the watch-visibility gate
// ---------------------------------------------------------------------------

/**
 * Reads the session's REAL SWM event tail from its world-model engine —
 * the world events the control plane's render snapshot consumed, verbatim
 * (sequence, identity, real times, taxonomy). No engine → the honest empty
 * tail (nothing has fed the session's world model yet — the W701 posture).
 */
function buildEventTail(server: SportaServer, sessionId: string): WatchEventTailModel[] {
  const engine = server.engines.get(sessionId);
  if (engine === undefined) return [];
  return engine.eventsSince(0).map((entry) => ({
    sequence: entry.sequence,
    eventId: entry.event.eventId,
    eventTimeMs: entry.event.eventTimeMs,
    eventTypeRef: entry.event.eventTypeRef,
    ...(entry.event.confidence !== undefined ? { confidence: entry.event.confidence } : {}),
  }));
}

/** Builds one session's watch model (the playback-session acquisition). */
export async function buildWatchModel(
  server: SportaServer,
  sessionId: string,
): Promise<WatchModel> {
  const { session, rightsCapabilities } = await server.control.getSession(sessionId);
  const { sessions } = await server.control.listSessions();
  const summary = sessions.find((entry) => entry.id === sessionId);
  const label = summary?.sourceLabel ?? sessionId;
  const authorized = rightsCapabilities.canStoreDerivatives === true;
  const story = server.storyIndex.get(sessionId) ?? null;

  if (!authorized) {
    return {
      sessionId,
      label,
      status: session.status,
      createdAtIso: session.createdAtIso,
      playback: { state: "denied", reasonCode: "rights-denied" },
      renders: null,
      eventTail: null,
      story,
    };
  }

  const { renders } = await server.control.listRenders(sessionId);
  const renderModels: WatchRenderModel[] = [];
  for (const render of renders) {
    const envelope = await server.control.getRender(sessionId, render.renderId);
    const outputs = await server.control.listRenderOutputs(sessionId, render.renderId);
    renderModels.push({
      renderId: envelope.renderId,
      rendererId: envelope.result.rendererId,
      watermarkAfter: envelope.result.watermarkAfter,
      provenance: envelope.result.provenance,
      rendererHealth: envelope.result.rendererHealth,
      segmentCount: envelope.result.outputSegments.length,
      outputs: outputs.segments.map((segment) => ({
        segmentId: segment.segmentId,
        contentType: segment.contentType,
        byteLength: segment.byteLength,
        contentHash: segment.contentHash,
      })),
    });
  }

  return {
    sessionId,
    label,
    status: session.status,
    createdAtIso: session.createdAtIso,
    playback: { state: "authorized", reasonCode: "ok" },
    renders: renderModels,
    eventTail: buildEventTail(server, sessionId),
    story,
  };
}

/**
 * The W906→W916 watch-visibility gate — the CONTENT MODEL's access rule:
 *
 * - `public` → served to everyone (unchanged);
 * - `unlisted` → served to everyone who holds the id (the link is the
 *   capability — unlisted is a listing decision, never a playback denial);
 * - `private` → the owner or an operator (unchanged, W906);
 * - `role-scoped` → the owner, an operator, or any account holding one of
 *   the record's grants;
 * - UNKNOWN visibility → the owner or an operator only (fail-closed: an
 *   undefined decision can never widen access).
 *
 * Every other caller receives the SAME answer as for an unknown session
 * (the control plane's `unknown-session` 404, byte-identical: no existence
 * oracle).
 */
export async function assertWatchable(
  server: SportaServer,
  request: Request,
  sessionId: string,
): Promise<void> {
  // W921: ensure the session is live in-process BEFORE the publication
  // record is read. Without this, a COLD instance's in-process publication
  // store has no entry for a durable session — and the store's documented
  // default for absence is PUBLIC, which would let a private studio session
  // be watchable by anyone until its first reconstruction seeded the flag.
  // Reconstruction seeds the recorded decision; a non-durable unknown
  // session answers the control plane's own unknown-session 404 here
  // (byte-identical to what the later getSession would have answered).
  // The sync afterwards re-reads the record: a publication flip made on
  // ANOTHER instance (the record is the source of truth) must be honored by
  // this WARM instance too — never a stale private flag after a distant
  // publish, never a stale public one after a distant privatize.
  if (server.durable !== null) {
    const live = await server.durable.ensureSessionLive(sessionId);
    if (!live) {
      const { ControlUnknownSessionError } = await import("@sporta/control-api");
      throw new ControlUnknownSessionError(sessionId);
    }
    await server.durable.syncVisibility(sessionId);
  }
  const record = server.publication.contentOf(sessionId);
  if (record !== null && (record.kind === "public" || record.kind === "unlisted")) {
    return;
  }
  // private / role-scoped / unknown: resolve the caller, then fail closed.
  const token = tokenFromRequest(request);
  if (token !== "") {
    try {
      const account = await server.gate.requireAccount(token);
      if (
        record?.kind === "role-scoped" &&
        account.roles.some((role) => record.roles.includes(role))
      ) {
        return; // the scoped grant path (server-side grants, never activeRole)
      }
      const ownerId = (await server.ownership.ownerIdOf(sessionId)) ?? "\u0000not-a-user";
      if (authorize(account, "media-session.read", { ownerId }).allowed) {
        return; // owner or operator
      }
    } catch {
      // An unresolvable token is just an unauthenticated caller here.
    }
  }
  const { ControlUnknownSessionError } = await import("@sporta/control-api");
  throw new ControlUnknownSessionError(sessionId);
}
