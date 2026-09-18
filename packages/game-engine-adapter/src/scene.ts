/**
 * The engine-side scene state (R302) — ONE canonical scene shared by every
 * rendering style (ADR-009: the anime/NPR path shares the game-3D scene).
 *
 * The scene is constructed from validated plain `@sporta/contracts` documents
 * only (architecture-lock §5): the SWM snapshot is projected through the
 * canonical W601 `projectScene` (`@sporta/scene-projection`) so entity
 * placement honors the same honest rules as every other consumer (verbatim
 * UncertainValue positions, out-of-bounds kept TRUE, no invented data), and
 * the event tail is applied PRESENTATION-ONLY (event badges/overlays — the
 * `EventEnvelope` carries no spatial data, so applying an event never moves
 * an entity; no invented trajectories).
 *
 * Event applicability envelope (documented, honest): an event is APPLIED when
 * its session matches the scene's session AND its `eventTypeRef` starts with
 * `"football/v1/"` (the taxonomy this engine build knows). Anything else is
 * SKIPPED, counted, and surfaces as degradation at render time — never a
 * silent drop. Replayed events (sequence <= the applied watermark) are
 * skipped as idempotent no-ops WITHOUT degradation (nothing was lost).
 */
import { projectScene } from "@sporta/scene-projection";
import type { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import type { GameSceneBuildRequest } from "@sporta/contracts";

/** One placed scene entity (meters, right-handed, z up — the W601 frame). */
export interface SceneEntityModel {
  entityId: string;
  kind: string;
  x: number;
  y: number;
  /** The carried height (meters); 0 for plane entities (a documented constant). */
  z: number;
  /** True when outside the pitch bounds (TRUE coordinates kept, never clamped). */
  outOfBounds: boolean;
  status: "known" | "unknown" | "uncertain";
  confidence?: number;
}

/** One applied event overlay (presentation-only; no spatial invention). */
export interface SceneEventOverlay {
  eventId: string;
  eventTypeRef: string;
  eventTimeMs: number;
  isCorrection: boolean;
}

/** The mutable engine-side scene state a handle refers to. */
export interface SceneState {
  sceneId: string;
  sessionId: string;
  renderingStyle: string;
  snapshotVersion: number;
  /** The snapshot's watermark, verbatim (ms) — the event-time anchor. */
  watermarkMs: number;
  /** The highest event sequence actually applied (honest watermark). */
  appliedEventSequence: number;
  entities: SceneEntityModel[];
  overlays: SceneEventOverlay[];
  /** Events skipped because they are outside the supported envelope. */
  skippedUnsupported: number;
  /** Events skipped as idempotent replays (already applied). */
  skippedReplay: number;
}

/** Whether one event is inside this engine build's supported envelope. */
function isApplicable(event: WorldEventStreamEntry, sessionId: string): boolean {
  if (event.event.sessionId !== sessionId) return false;
  return event.event.eventTypeRef.startsWith("football/v1/");
}

/** Applies events to a scene state (mutates overlays + counters). */
export function applyEventsToScene(
  state: SceneState,
  events: readonly WorldEventStreamEntry[],
): { applied: number; skippedUnsupported: number; skippedReplay: number } {
  let applied = 0;
  let skippedUnsupported = 0;
  let skippedReplay = 0;
  for (const entry of events) {
    if (entry.sequence <= state.appliedEventSequence) {
      skippedReplay += 1; // idempotent no-op, not a degradation
      continue;
    }
    if (!isApplicable(entry, state.sessionId)) {
      skippedUnsupported += 1; // outside the supported envelope
      continue;
    }
    state.overlays.push({
      eventId: entry.event.eventId,
      eventTypeRef: entry.event.eventTypeRef,
      eventTimeMs: entry.event.eventTimeMs,
      isCorrection: entry.event.correctionOf !== undefined,
    });
    state.appliedEventSequence = Math.max(state.appliedEventSequence, entry.sequence);
    applied += 1;
  }
  state.skippedUnsupported += skippedUnsupported;
  state.skippedReplay += skippedReplay;
  return { applied, skippedUnsupported, skippedReplay };
}

/**
 * Builds a fresh scene state from an SWM snapshot + the initial event tail.
 *
 * Placement honesty is delegated to the canonical W601 projection: only
 * `projected`/`projected-out-of-bounds` entities are placed (verbatim
 * positions, TRUE out-of-bounds coordinates), everything else is not placed
 * and not invented. The ball's `z` is its carried height; participants sit
 * on the plane (`z: 0`, a documented frame constant).
 */
export function buildSceneState(
  request: GameSceneBuildRequest,
  snapshot: WorldSnapshot,
  events: readonly WorldEventStreamEntry[],
  sceneId: string,
): SceneState {
  const scene = projectScene(snapshot, { events: [] });
  const entities: SceneEntityModel[] = [];
  for (const entity of scene.entities) {
    if (
      (entity.disposition !== "projected" && entity.disposition !== "projected-out-of-bounds") ||
      entity.position === undefined
    ) {
      continue;
    }
    entities.push({
      entityId: entity.entityId,
      kind: entity.kind,
      x: entity.position.x,
      y: entity.position.y,
      z: entity.kind === "ball" ? (entity.position.z ?? 0) : 0,
      outOfBounds: entity.disposition === "projected-out-of-bounds",
      status: entity.positionStatus ?? "known",
      ...(entity.positionConfidence !== undefined ? { confidence: entity.positionConfidence } : {}),
    });
  }
  const state: SceneState = {
    sceneId,
    sessionId: request.sessionId,
    renderingStyle: request.renderingStyle,
    snapshotVersion: request.snapshotVersion,
    watermarkMs: snapshot.watermark.watermarkMs,
    appliedEventSequence: snapshot.watermark.sequence,
    entities,
    overlays: [],
    skippedUnsupported: 0,
    skippedReplay: 0,
  };
  applyEventsToScene(state, events);
  return state;
}
