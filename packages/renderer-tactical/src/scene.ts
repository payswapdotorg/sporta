/**
 * The tactical view-model (R301): the canonical W601
 * `SceneSpecification` re-expressed for the 2D tactical painter.
 *
 * The scene is built by `@sporta/scene-projection/projectScene` — the
 * deterministic, conformance-checked projection of the SWM snapshot + event
 * tail. This module NEVER re-reads the SWM: everything the painter draws
 * comes from the scene document (verbatim positions, dispositions, the score
 * clock, the verbatim event markers). No renderer-specific truth exists.
 *
 * Honesty constraints (mirroring the scene contract's rules S1-S8):
 * - entity positions are the scene's verbatim meter coordinates; entities
 *   with dispositions other than `projected`/`projected-out-of-bounds` are
 *   not placed (they are counted in `omitted` for the render log);
 * - event markers carry no scene position — the tactical view anchors event
 *   badges on the TIMELINE strip (a presentation choice that invents no
 *   spatial data; the badge shows the verbatim event type and time);
 * - the clock/score panel renders the verbatim `scoreClock` state; an
 *   uncertain score status is displayed as "provisional", never silently
 *   promoted to confirmed.
 */
import type { SceneSpecification } from "@sporta/scene-projection";
import type { SceneEntity, SceneEventMarker } from "@sporta/scene-projection";

/** A placed entity on the tactical plane (meters). */
export interface TacticalEntity {
  entityId: string;
  kind: string;
  /** True when the entity is outside the pitch bounds (kept, never clamped). */
  outOfBounds: boolean;
  /** The verbatim position (meters). */
  x: number;
  y: number;
  /** The verbatim position-slot uncertainty status. */
  status: "known" | "unknown" | "uncertain";
  /** The verbatim confidence when the slot carried one. */
  confidence?: number;
  /** The verbatim heading (radians from +x toward +y) when known/uncertain. */
  headingRadians?: number;
}

/** The label of one event badge (from the verbatim event marker). */
export interface TacticalEventBadge {
  /** The event's own id (verbatim). */
  eventId: string;
  /** The verbatim eventTypeRef (e.g. "football/v1/goal"). */
  eventTypeRef: string;
  /** The short label drawn in the ticker (the taxonomy tail, uppercased). */
  label: string;
  /** The verbatim event time (ms). */
  eventTimeMs: number;
  /** True when the event corrects an earlier one (correctionOf present). */
  isCorrection: boolean;
}

/** The tactical view-model of one scene. */
export interface TacticalSceneView {
  /** The scene's session id (verbatim). */
  sessionId: string;
  /** Placed entities in scene order (projected + projected-out-of-bounds). */
  entities: TacticalEntity[];
  /** How many scene entities were not placed, by disposition (accounting). */
  unplacedByDisposition: Record<string, number>;
  /** The ball entity, when one is placed (kind "ball"). */
  ball?: TacticalEntity;
  /** Event badges from the verbatim markers, in input order. */
  eventBadges: TacticalEventBadge[];
  /** The verbatim score/clock block presence flags and values. */
  scoreClock: {
    footballState: boolean;
    home?: number;
    away?: number;
    scoreStatus?: "known" | "unknown" | "uncertain";
    scoreStatusValue?: string;
    scoreStatusConfidence?: number;
    clockPeriod?: string;
    clockMs?: number;
    stoppage?: boolean;
    possessionEntityId?: string;
    possessionConfidence?: number;
  };
}

/** Dispositions that place an entity on the plane. */
function isPlaced(disposition: string): boolean {
  return disposition === "projected" || disposition === "projected-out-of-bounds";
}

/** Maps a scene entity to a placed tactical entity (or null when unplaced). */
function placeEntity(entity: SceneEntity): TacticalEntity | null {
  if (!isPlaced(entity.disposition) || entity.position === undefined) return null;
  const out: TacticalEntity = {
    entityId: entity.entityId,
    kind: entity.kind,
    outOfBounds: entity.disposition === "projected-out-of-bounds",
    x: entity.position.x,
    y: entity.position.y,
    status: entity.positionStatus ?? "known",
  };
  if (entity.positionConfidence !== undefined) out.confidence = entity.positionConfidence;
  const heading = entity.heading;
  if (heading !== undefined && heading.status !== "unknown" && heading.radians !== undefined) {
    out.headingRadians = heading.radians;
  }
  return out;
}

/** The ticker label of one event marker (the taxonomy tail, uppercased). */
function badgeLabelOf(marker: SceneEventMarker): string {
  const ref = marker.event.eventTypeRef;
  const tail = ref.includes("/") ? ref.slice(ref.lastIndexOf("/") + 1) : ref;
  return tail.toUpperCase();
}

/**
 * Builds the tactical view-model of a scene specification. Pure: the same
 * scene yields a deep-equal view.
 */
export function buildTacticalView(scene: SceneSpecification): TacticalSceneView {
  const entities: TacticalEntity[] = [];
  const unplacedByDisposition: Record<string, number> = {};
  let ball: TacticalEntity | undefined;
  for (const entity of scene.entities) {
    const placed = placeEntity(entity);
    if (placed === null) {
      unplacedByDisposition[entity.disposition] =
        (unplacedByDisposition[entity.disposition] ?? 0) + 1;
      continue;
    }
    entities.push(placed);
    if (entity.kind === "ball" && ball === undefined) ball = placed;
  }

  const eventBadges: TacticalEventBadge[] = scene.eventMarkers.map((marker) => ({
    eventId: marker.event.eventId,
    eventTypeRef: marker.event.eventTypeRef,
    label: badgeLabelOf(marker),
    eventTimeMs: marker.event.eventTimeMs,
    isCorrection: marker.event.correctionOf !== undefined,
  }));

  const scoreClock: TacticalSceneView["scoreClock"] = {
    footballState: scene.scoreClock.footballState,
  };
  if (scene.scoreClock.score !== undefined) {
    scoreClock.home = scene.scoreClock.score.home;
    scoreClock.away = scene.scoreClock.score.away;
    scoreClock.scoreStatus = scene.scoreClock.score.status.status;
    if (scene.scoreClock.score.status.value !== undefined) {
      scoreClock.scoreStatusValue = scene.scoreClock.score.status.value;
    }
    if (scene.scoreClock.score.status.confidence !== undefined) {
      scoreClock.scoreStatusConfidence = scene.scoreClock.score.status.confidence;
    }
  }
  if (scene.scoreClock.clock !== undefined) {
    scoreClock.clockPeriod = scene.scoreClock.clock.period;
    scoreClock.clockMs = scene.scoreClock.clock.clockMs;
    scoreClock.stoppage = scene.scoreClock.clock.stoppage;
  }
  if (scene.scoreClock.possession?.value !== undefined) {
    scoreClock.possessionEntityId = scene.scoreClock.possession.value.entityId;
    if (scene.scoreClock.possession.confidence !== undefined) {
      scoreClock.possessionConfidence = scene.scoreClock.possession.confidence;
    }
  }

  return {
    sessionId: scene.sessionId,
    entities,
    unplacedByDisposition,
    eventBadges,
    ...(ball !== undefined ? { ball } : {}),
    scoreClock,
  };
}
