/**
 * The catalog + watch model service (W904/W905) — real control-plane data,
 * projected to the JSON shapes the client surfaces consume.
 *
 * HONESTY RULES (the W901/W902 posture, enforced here):
 * - Playback availability is the REAL fail-closed rights derivation of the
 *   session's stored policy (`canStoreDerivatives` at request time).
 * - A playback-denied session reveals NOTHING about its renders: the
 *   control plane's own `listRenders` gate denies before existence is
 *   revealed, so the card/watch model answers `renders: null`.
 * - The story metadata a seeded session carries is labeled `"dev-seed"` —
 *   it is the real fixture-transcript/events data the real chain produced.
 */
import type { SportaServer } from "./composition";
import type { SeedStoryMeta } from "./dev-seed";

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

/** The watch model (the playback-session acquisition document). */
export interface WatchModel {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  playback: { state: "authorized" | "denied"; reasonCode: "ok" | "rights-denied" };
  renders: WatchRenderModel[] | null;
  /** The dev-seed story (transcript + extracted events), when one exists. */
  story:
    | (SeedStoryMeta & {
        /** Where to watch: the render+segment pairs that have stored outputs. */
      })
    | null;
}

/** Builds every catalog card (public — the catalog lists real sessions). */
export async function buildCatalog(server: SportaServer): Promise<SessionCardModel[]> {
  const { sessions } = await server.control.listSessions();
  const cards: SessionCardModel[] = [];
  for (const summary of sessions) {
    cards.push(await buildCard(server, summary.id, summary.sourceLabel));
  }
  return cards;
}

/** Builds the signed-in user's library (their OWN sessions, by ownership). */
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
    cards.push(await buildCard(server, id, summary.sourceLabel));
  }
  return cards;
}

/** Builds one session's card from the REAL control-plane state. */
async function buildCard(
  server: SportaServer,
  sessionId: string,
  label: string | undefined,
): Promise<SessionCardModel> {
  const { session, rightsCapabilities } = await server.control.getSession(sessionId);
  const authorized = rightsCapabilities.canStoreDerivatives === true;
  const story = server.storyIndex.get(sessionId) ?? null;

  if (!authorized) {
    // Fail-closed: render existence is not revealed for denied sessions.
    return {
      sessionId,
      label: label ?? sessionId,
      status: session.status,
      createdAtIso: session.createdAtIso,
      playback: { state: "denied", reasonCode: "rights-denied" },
      renders: null,
      outputCount: null,
      story: story === null ? null : { source: "dev-seed", storyKey: story.storyKey, eventCount: story.events.length },
    };
  }

  const { renders } = await server.control.listRenders(sessionId);
  let outputCount = 0;
  const renderModels = [];
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
    label: label ?? sessionId,
    status: session.status,
    createdAtIso: session.createdAtIso,
    playback: { state: "authorized", reasonCode: "ok" },
    renders: renderModels,
    outputCount,
    story: story === null ? null : { source: "dev-seed", storyKey: story.storyKey, eventCount: story.events.length },
  };
}

/** Builds one session's watch model (the playback-session acquisition). */
export async function buildWatchModel(server: SportaServer, sessionId: string): Promise<WatchModel> {
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
    story,
  };
}
