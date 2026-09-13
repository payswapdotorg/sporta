/**
 * Sports World Model (SWM) contracts: snapshots and the event stream.
 *
 * The SWM is the canonical, time-versioned representation of the sporting
 * event (ADR-001). Renderers consume immutable snapshots plus ordered events.
 * Every canonical fact carries stable entity identity, event-time,
 * confidence/provenance, and explicit uncertainty rather than invented
 * certainty (architecture-lock §4).
 */
import { z } from "zod";
import { EventEnvelope } from "./event";
import { FootballState } from "./football";
import { EntityId, EntityKind } from "./identity";
import { Watermark } from "./timestamps";
import { UncertainValue, UncertaintyStatus, uncertainValue } from "./uncertainty";
import { schemaVersionField } from "./versioning";

// The uncertainty pattern is defined in ./uncertainty (not inline here) so the
// football extension can reuse it without a circular module dependency.
export { UncertainValue, UncertaintyStatus, uncertainValue };

/**
 * A world-model entity: stable session-scoped identity, a version that
 * increases monotonically as the entity's state evolves, the event time of the
 * last state change, and a generic per-kind state map of uncertainty values.
 *
 * `state` keys are kind-specific (e.g. "pitchPosition", "teamRole") and are
 * documented per entity kind by downstream consumers; values always use the
 * {@link UncertainValue} pattern.
 */
export const WorldEntity = z.object({
  entityId: EntityId,
  kind: EntityKind,
  version: z.number().int().min(1),
  lastEventTimeMs: z.number().min(0),
  state: z.record(z.string(), UncertainValue),
});
export type WorldEntity = z.infer<typeof WorldEntity>;

/**
 * The best-known coherent state of the world at the watermark position.
 * Snapshots are immutable once generated; progress is made by applying the
 * ordered event stream. `football` is the optional football extension state.
 */
export const WorldSnapshot = z.object({
  sessionId: z.string().min(1),
  schemaVersion: schemaVersionField,
  watermark: Watermark,
  entities: z.array(WorldEntity),
  football: FootballState.optional(),
  generatedAtMs: z.number(),
});
export type WorldSnapshot = z.infer<typeof WorldSnapshot>;

/**
 * One entry of the world-model event stream: the monotonic sequence number,
 * the snapshot version that exists after applying the event, and the event
 * envelope itself.
 */
export const WorldEventStreamEntry = z.object({
  sequence: z.number().int().min(0),
  snapshotVersionAfter: z.number().int().min(0),
  event: EventEnvelope,
});
export type WorldEventStreamEntry = z.infer<typeof WorldEventStreamEntry>;
