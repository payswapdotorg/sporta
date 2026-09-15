/**
 * SURFACE-STATE DERIVATIONS (W904/W905) — the UX state contract, executable.
 *
 * Pure functions from (capability response + catalog/watch data) to the
 * per-surface UX state, with a human reason for every non-ready state. This
 * module is `docs/testing/ux-operational-simulation.md` made executable: the
 * W901 fixtures are run through these derivations in
 * `test/surface-state.test.ts` so every degraded/denied/unavailable path a
 * real capability response can produce has a pinned UI behavior.
 *
 * HONESTY RULES baked in:
 * - live is a capability verdict, never a session property (Simulation F);
 * - a playback-denied session reveals nothing about its renders;
 * - a renderer with no output for a session shows WHY (requires render /
 *   no stored output / rights / renderer unavailable) — never a fake
 *   "coming soon";
 * - the same match session stays CONSTANT across reality switches.
 */
import type {
  CapabilityLike,
  RenderOutputLike,
  SessionCardLike,
  UxState,
  WatchModelLike,
} from "./api-types";
import { UX_STATES } from "./api-types";

/** A derived surface verdict: the UX state + why (human words). */
export interface SurfaceVerdict {
  state: UxState;
  reason: string;
}

/** Asserts membership in the canonical vocabulary (test seam). */
export function isUxState(value: string): value is UxState {
  return (UX_STATES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Live (Simulation F — evidence-driven, never a session property)
// ---------------------------------------------------------------------------

/** The Live surface's verdict from the capability response alone. */
export function deriveLiveState(capability: CapabilityLike): SurfaceVerdict {
  const live = capability.modes.live;
  if (live.availability === "available") {
    // Only reachable with live-network transport evidence (Simulation F).
    return { state: "ready", reason: "live network transport is available" };
  }
  if (live.reasonCode === "in-process-transport-not-live") {
    return {
      state: "unavailable",
      reason:
        "Sporta runs an in-process control plane in this deployment, which is not a live network transport — nothing may be labelled live (Simulation F).",
    };
  }
  if (live.reasonCode === "live-transport-not-configured") {
    return { state: "unavailable", reason: "no live transport is configured for this deployment" };
  }
  if (live.reasonCode === "rights-denied") {
    return { state: "denied", reason: "live delivery is not permitted by the current rights" };
  }
  return { state: "unavailable", reason: `live is unavailable (${live.reasonCode})` };
}

// ---------------------------------------------------------------------------
// Surface visibility (the role-experience matrix, from the capability response)
// ---------------------------------------------------------------------------

/** One catalog surface's visibility verdict. */
export function deriveSurfaceVisibility(
  capability: CapabilityLike,
  surfaceId: string,
): SurfaceVerdict {
  const surface = capability.content.catalogSurfaces.find((entry) => entry.surfaceId === surfaceId);
  if (surface === undefined) {
    return { state: "unavailable", reason: "this surface is not part of the capability response" };
  }
  if (surface.visibility === "visible")
    return { state: "ready", reason: "visible to this account" };
  if (surface.reasonCode === "authentication-required") {
    return { state: "denied", reason: "signing in is required for this surface" };
  }
  if (surface.reasonCode === "role-not-granted") {
    return {
      state: "denied",
      reason: "your account does not hold a role grant that opens this surface",
    };
  }
  return {
    state: "unavailable",
    reason: `the surface request was invalid (${surface.reasonCode})`,
  };
}

// ---------------------------------------------------------------------------
// Watchability (what a card/page can actually play)
// ---------------------------------------------------------------------------

/** A session is watchable when playback is authorized AND an output exists. */
export function isWatchable(card: SessionCardLike): boolean {
  return card.playback.state === "authorized" && (card.outputCount ?? 0) > 0;
}

/** The card's playback chip verdict. */
export function deriveCardPlayback(card: SessionCardLike): SurfaceVerdict {
  if (card.playback.state === "denied") {
    return {
      state: "denied",
      reason: "this content's rights do not permit stored playback",
    };
  }
  if ((card.outputCount ?? 0) > 0) {
    return { state: "ready", reason: "a stored output is available to watch" };
  }
  return {
    state: "unavailable",
    reason:
      card.renders !== null && card.renders.length > 0
        ? "renders exist but no stored output has been produced yet"
        : "no render has been produced for this session yet",
  };
}

// ---------------------------------------------------------------------------
// Home shelves (the ux-architecture three simultaneous messages)
// ---------------------------------------------------------------------------

/** The three home shelves' verdicts. */
export interface HomeShelves {
  live: SurfaceVerdict;
  watchNow: SurfaceVerdict;
  realities: SurfaceVerdict;
}

/** Derives the home shelves: watch-now cards, the live verdict, reality cards. */
export function deriveHomeShelves(
  capability: CapabilityLike,
  catalog: readonly SessionCardLike[],
): HomeShelves {
  const live = deriveLiveState(capability);
  const watchable = catalog.filter(isWatchable);
  const denied = catalog.filter((card) => card.playback.state === "denied");

  const watchNow: SurfaceVerdict =
    watchable.length > 0
      ? { state: "ready", reason: `${watchable.length} watchable session(s)` }
      : catalog.length > 0 && denied.length === catalog.length
        ? {
            state: "denied",
            reason: "every seeded session's rights deny stored playback",
          }
        : {
            state: "unavailable",
            reason:
              catalog.length === 0
                ? "the control plane has no sessions yet"
                : "no session has a stored output yet",
          };

  // Reality cards: one per (renderer, watchable session) pair that has an output.
  const realities = collectRealityCards(capability, catalog);
  const realitiesVerdict: SurfaceVerdict =
    realities.length > 0
      ? { state: "ready", reason: `${realities.length} rendered reality card(s)` }
      : { state: "unavailable", reason: "no rendered alternate reality exists yet" };

  return { live, watchNow, realities: realitiesVerdict };
}

/** One alternate-reality card: a renderer output on a watchable session. */
export interface RealityCard {
  sessionId: string;
  sessionLabel: string;
  rendererId: string;
  renderId: string;
}

/** Collects the reality cards (renderer × watchable session, with an output). */
export function collectRealityCards(
  capability: CapabilityLike,
  catalog: readonly SessionCardLike[],
): RealityCard[] {
  const cards: RealityCard[] = [];
  for (const session of catalog) {
    if (!isWatchable(session) || session.renders === null) continue;
    for (const render of session.renders) {
      if (!render.hasStoredOutputs) continue;
      const renderer = capability.renderers.find((entry) => entry.rendererId === render.rendererId);
      if (renderer === undefined || renderer.availability !== "available") continue;
      cards.push({
        sessionId: session.sessionId,
        sessionLabel: session.label,
        rendererId: render.rendererId,
        renderId: render.renderId,
      });
    }
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Explore / Library
// ---------------------------------------------------------------------------

/** The Explore surface's verdict. */
export function deriveExploreState(
  capability: CapabilityLike,
  catalog: readonly SessionCardLike[],
): SurfaceVerdict {
  if (catalog.length === 0) {
    return { state: "unavailable", reason: "the catalog is empty" };
  }
  if (capability.overall.state === "degraded") {
    return {
      state: "degraded",
      reason: `the platform is degraded (${capability.overall.reasonCodes.join(", ")}) — listings remain real`,
    };
  }
  if (capability.overall.state === "unavailable") {
    return {
      state: "degraded",
      reason: `no renderer is currently available (${capability.overall.reasonCodes.join(", ")}) — listings remain real`,
    };
  }
  return { state: "ready", reason: `${catalog.length} session(s) in the catalog` };
}

/** The Library surface's verdict (auth-gated per the capability response). */
export function deriveLibraryState(
  capability: CapabilityLike,
  sessions: readonly SessionCardLike[] | null,
): SurfaceVerdict {
  if (capability.auth.state === "anonymous") {
    return { state: "denied", reason: "signing in is required to open your library" };
  }
  if (capability.auth.state === "invalid-session") {
    return { state: "denied", reason: "your session is no longer valid — sign in again" };
  }
  if (sessions === null) {
    return { state: "unavailable", reason: "your library could not be read" };
  }
  const visibility = deriveSurfaceVisibility(capability, "library");
  if (visibility.state !== "ready") return visibility;
  return {
    state: "ready",
    reason:
      sessions.length === 0
        ? "you have not created any sessions yet (Create Studio arrives with W906)"
        : `${sessions.length} session(s) you created`,
  };
}

// ---------------------------------------------------------------------------
// THE REALITY SWITCHER (Simulation G — the session stays constant)
// ---------------------------------------------------------------------------

/** Why a reality option is not ready (closed vocabulary, surfaced to users). */
export type RealityUnavailableReason =
  "renderer-unavailable" | "rights-denied" | "requires-render" | "no-stored-output";

/** One Reality Switcher option. */
export interface RealityOption {
  /** The renderer this option switches to (constant per registry). */
  rendererId: string;
  rendererVersion?: string;
  rendererClass?: string;
  /** `ready` iff a stored output exists for THIS session under this renderer. */
  state: "ready" | RealityUnavailableReason;
  /** Human words for every non-ready state — never a fake "coming soon". */
  reason: string;
  /** The render backing this option (when one exists). */
  renderId?: string;
  /** The first stored output segment (when one exists). */
  segmentId?: string;
}

/**
 * Derives the Reality Switcher's options for ONE session (constant across
 * switches): every renderer in the capability response, each with its REAL
 * per-session availability. The match session never changes here — switching
 * is client state + fetching the new renderer's output, never navigation.
 */
export function deriveRealityOptions(
  capability: CapabilityLike,
  watch: WatchModelLike,
): RealityOption[] {
  const playbackDenied = watch.playback.state === "denied";
  return capability.renderers.map((renderer) => {
    const base = {
      rendererId: renderer.rendererId,
      ...(renderer.rendererVersion !== undefined
        ? { rendererVersion: renderer.rendererVersion }
        : {}),
      ...(renderer.rendererClass !== undefined ? { rendererClass: renderer.rendererClass } : {}),
    };
    if (renderer.availability !== "available") {
      return {
        ...base,
        state: "renderer-unavailable" as const,
        reason: `the renderer is ${renderer.availability} (${renderer.reasonCode})`,
      };
    }
    if (playbackDenied) {
      return {
        ...base,
        state: "rights-denied" as const,
        reason: "this content's rights do not permit stored playback",
      };
    }
    const renders = (watch.renders ?? []).filter(
      (render) => render.rendererId === renderer.rendererId,
    );
    if (renders.length === 0) {
      return {
        ...base,
        state: "requires-render" as const,
        reason: "no render has been requested for this match with this renderer yet",
      };
    }
    const withOutput = renders.find((render) => render.outputs.length > 0);
    if (withOutput === undefined) {
      return {
        ...base,
        renderId: renders[0]!.renderId,
        state: "no-stored-output" as const,
        reason: `a render exists (${renders[0]!.renderId}) but no stored output is available for it in this format yet`,
      };
    }
    return {
      ...base,
      renderId: withOutput.renderId,
      segmentId: withOutput.outputs[0]!.segmentId,
      state: "ready" as const,
      reason: "a stored output is available for this match",
    };
  });
}

/** The watch page's primary player verdict. */
export function deriveWatchState(
  capability: CapabilityLike,
  watch: WatchModelLike,
): SurfaceVerdict {
  if (watch.playback.state === "denied") {
    return {
      state: "denied",
      reason: "this content's rights do not permit stored playback",
    };
  }
  const options = deriveRealityOptions(capability, watch);
  const ready = options.find((option) => option.state === "ready");
  if (ready !== undefined) {
    return { state: "ready", reason: `playing the ${ready.rendererId} reality` };
  }
  if (options.length > 0 && options.every((option) => option.state === "requires-render")) {
    return { state: "unavailable", reason: "no render has been produced for this match yet" };
  }
  return { state: "unavailable", reason: "no stored output is available for this match yet" };
}

// ---------------------------------------------------------------------------
// Output rendering model (the stored artifact → player data)
// ---------------------------------------------------------------------------

/** One timeline marker: a real captioned event from the stored output. */
export interface TimelineMarker {
  /** Position on the output timeline (ms from segment start). */
  atMs: number;
  phrase: string;
  sequence: number;
  eventId: string;
}

/** One rendered frame's tactical summary (real manifest data). */
export interface FrameSummary {
  frameIndex: number;
  atMs: number;
  endMs: number;
  clockText: string | null;
  statusLine: string | null;
  scoreText: string | null;
  marker: TimelineMarker | null;
  entities: {
    entityId: string;
    kind: string;
    disposition: string;
    positionMeters?: { x: number; y: number };
    svgPosition?: { x: number; y: number };
    confidence?: number;
  }[];
}

/** The player view model derived from ONE real stored output document. */
export interface OutputViewModel {
  totalDurationMs: number;
  frameCount: number;
  frames: FrameSummary[];
  markers: TimelineMarker[];
  rendererId: string;
  rendererVersion: string;
  styleId: string;
  degraded: boolean;
  degradationReasons: string[];
}

/**
 * Maps a real stored-output document (the playback-gate read) onto the
 * player's view model: the frame windows, the captioned event markers, the
 * per-frame tactical entity positions, and the renderer identity — every
 * number copied from the artifact's manifest, nothing invented.
 */
export function mapOutputToViewModel(output: {
  contentType: string;
  manifest: RenderOutputLike["manifest"];
}): OutputViewModel {
  const manifest = output.manifest;
  const source = manifest.sourceManifest;
  const frames: FrameSummary[] = source.frames.map((frame) => {
    const caption = frame.captions.events[0];
    return {
      frameIndex: frame.frameIndex,
      atMs: frame.windowMs.startMs,
      endMs: frame.windowMs.endMs,
      clockText: frame.captions.clockText,
      statusLine: frame.captions.statusLine,
      scoreText:
        frame.captions.score !== null &&
        frame.captions.score.displayed &&
        frame.captions.score.text !== undefined
          ? frame.captions.score.text
          : null,
      marker:
        caption === undefined
          ? null
          : {
              atMs: frame.windowMs.startMs,
              phrase: caption.phrase,
              sequence: caption.sequence,
              eventId: caption.eventId,
            },
      entities: frame.entities.map((entity) => ({
        entityId: entity.entityId,
        kind: entity.kind,
        disposition: entity.disposition,
        ...(entity.positionMeters !== undefined ? { positionMeters: entity.positionMeters } : {}),
        ...(entity.svgPosition !== undefined ? { svgPosition: entity.svgPosition } : {}),
        ...(entity.confidence !== undefined ? { confidence: entity.confidence } : {}),
      })),
    };
  });
  return {
    totalDurationMs: manifest.totalDurationMs,
    frameCount: manifest.frameCount,
    frames,
    markers: frames
      .map((frame) => frame.marker)
      .filter((marker): marker is TimelineMarker => marker !== null),
    rendererId: source.renderer.rendererId,
    rendererVersion: source.renderer.rendererVersion,
    styleId: source.renderer.styleId,
    degraded: source.degradation.degraded,
    degradationReasons: [...source.degradation.reasons],
  };
}

/** Formats a match-timeline position as `M:SS`. */
export function formatTimelineMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
