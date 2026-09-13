/**
 * Provenance helpers for the Sports World Model (W006 §3.3).
 *
 * `describeProvenance` renders the evidence chain of an event (event ->
 * observationIds -> provenance kind) as a single deterministic line for
 * logging and inspection. `auditTrail` summarizes an engine's state for tests
 * and observability; W007 consumes this shape conceptually.
 */
import type { EntityId, EntityKind, EventEnvelope } from "@sporta/contracts";
import type { WorldModelEngine } from "./world-model";

/**
 * Renders the evidence chain of an event: identity, type, session, event
 * time, interval (when it spans), provenance kind, confidence (when
 * present), the observation ids it was derived from, the reporter (when
 * present), and the corrected event (when this event is a correction).
 */
export function describeProvenance(event: EventEnvelope): string {
  const parts: string[] = [
    `event ${event.eventId}`,
    `type=${event.eventTypeRef}`,
    `session=${event.sessionId}`,
    `eventTimeMs=${event.eventTimeMs}`,
  ];
  if (event.interval.startTimeMs !== event.interval.endTimeMs) {
    parts.push(`interval=[${event.interval.startTimeMs}ms..${event.interval.endTimeMs}ms]`);
  }
  parts.push(`provenance=${event.provenance}`);
  if (event.confidence !== undefined) {
    parts.push(`confidence=${event.confidence}`);
  }
  parts.push(`evidence=[${event.evidence.observationIds.join(", ")}]`);
  if (event.evidence.reportedBy !== undefined) {
    parts.push(`reportedBy=${event.evidence.reportedBy}`);
  }
  if (event.correctionOf !== undefined) {
    parts.push(`corrects=${event.correctionOf}`);
  }
  return parts.join(" ");
}

/** One entity summary in an {@link AuditTrail}. */
export interface AuditTrailEntity {
  entityId: EntityId;
  kind: EntityKind;
  version: number;
  lastEventTimeMs: number;
}

/**
 * Engine state summary: the current snapshot version, the number of events
 * in the log (superseded events included), and the identity/version/time of
 * every entity.
 */
export interface AuditTrail {
  snapshotVersion: number;
  events: number;
  entities: AuditTrailEntity[];
}

/**
 * Builds an {@link AuditTrail} from an engine using only its public
 * read-only surface (snapshot version, event count, entity list).
 */
export function auditTrail(engine: WorldModelEngine): AuditTrail {
  const entities: AuditTrailEntity[] = [];
  for (const entityId of engine.entityIds) {
    const entity = engine.entityAt(entityId);
    if (entity === undefined) {
      continue; // defensive: the id came from the engine's own map
    }
    entities.push({
      entityId: entity.entityId,
      kind: entity.kind,
      version: entity.version,
      lastEventTimeMs: entity.lastEventTimeMs,
    });
  }
  return {
    snapshotVersion: engine.snapshotVersion,
    events: engine.eventCount,
    entities,
  };
}
