/**
 * Error taxonomy for @sporta/world-model.
 *
 * Two of these are named by the W006 specification —
 * {@link EntityKindChangeError} (identity stability) and
 * {@link LateEventError} (bounded reorder). The rest make the engine's other
 * fail-loud guarantees explicit instead of silently degrading state
 * (docs/contracts/sports-world-model.md, temporal semantics).
 */
import type { EntityId, EntityKind, MatchPeriod } from "@sporta/contracts";

/** Base class for every error the world-model engine throws. */
export class WorldModelError extends Error {}

/** An existing entity was upserted with a different `kind` (identity stability). */
export class EntityKindChangeError extends WorldModelError {
  readonly entityId: EntityId;
  readonly previousKind: EntityKind;
  readonly attemptedKind: EntityKind;

  constructor(entityId: EntityId, previousKind: EntityKind, attemptedKind: EntityKind) {
    super(
      `entity "${entityId}" cannot change kind from "${previousKind}" to ` +
        `"${attemptedKind}": entity identity is stable within a session`,
    );
    this.entityId = entityId;
    this.previousKind = previousKind;
    this.attemptedKind = attemptedKind;
  }
}

/** An event arrived later than the bounded reorder window allows. */
export class LateEventError extends WorldModelError {
  readonly eventTimeMs: number;
  readonly logHighWaterMs: number;
  readonly maxReorderMs: number;

  constructor(eventTimeMs: number, logHighWaterMs: number, maxReorderMs: number) {
    super(
      `event at ${eventTimeMs}ms is older than the bounded reorder window allows: ` +
        `log high-water is ${logHighWaterMs}ms, maxReorderMs is ${maxReorderMs} ` +
        `(events older than high-water - ${maxReorderMs}ms are rejected)`,
    );
    this.eventTimeMs = eventTimeMs;
    this.logHighWaterMs = logHighWaterMs;
    this.maxReorderMs = maxReorderMs;
  }
}

/** A record handed to the engine failed its @sporta/contracts schema. */
export class InvalidEntityError extends WorldModelError {
  constructor(readonly issues: readonly string[]) {
    super(`entity failed WorldEntity validation: ${issues.join("; ")}`);
  }
}

/** An event envelope handed to the engine failed the EventEnvelope schema. */
export class InvalidEventError extends WorldModelError {
  constructor(readonly issues: readonly string[]) {
    super(`event failed EventEnvelope validation: ${issues.join("; ")}`);
  }
}

/** Football extension state or patch failed FootballState validation. */
export class InvalidFootballStateError extends WorldModelError {
  constructor(readonly issues: readonly string[]) {
    super(`football state failed contract validation: ${issues.join("; ")}`);
  }
}

/** An uncertainty value could not be constructed under the contract rules. */
export class InvalidUncertainValueError extends WorldModelError {
  constructor(readonly issues: readonly string[]) {
    super(`uncertain value is invalid: ${issues.join("; ")}`);
  }
}

/** An entity id failed the session-scoped identity pattern. */
export class InvalidEntityIdError extends WorldModelError {
  constructor(readonly entityId: string) {
    super(
      `"${entityId}" is not a valid session-scoped entity id ` +
        "(1-64 characters of [A-Za-z0-9_-])",
    );
  }
}

/** Engine construction parameters were invalid. */
export class InvalidEngineConfigError extends WorldModelError {}

/** An at-T query (snapshot/entityAt) used a malformed timeline position. */
export class InvalidTimelineQueryError extends WorldModelError {}

/**
 * A football operation was invoked while the engine carries no football state
 * (the engine holds ONE optional FootballState, initialized at creation).
 */
export class FootballStateMissingError extends WorldModelError {
  constructor(readonly operation: string) {
    super(
      `football state is not present: "${operation}" requires the engine to be ` +
        "created with an initial football state (WorldModelEngine.create)",
    );
  }
}

/** The match clock moved backwards within the same period. */
export class ClockRegressionError extends WorldModelError {
  readonly period: MatchPeriod;
  readonly currentClockMs: number;
  readonly attemptedClockMs: number;

  constructor(period: MatchPeriod, currentClockMs: number, attemptedClockMs: number) {
    super(
      `clock cannot move backwards within period "${period}": current ` +
        `${currentClockMs}ms, attempted ${attemptedClockMs}ms (a period change resets the clock)`,
    );
    this.period = period;
    this.currentClockMs = currentClockMs;
    this.attemptedClockMs = attemptedClockMs;
  }
}

/** An event id was applied twice; event ids are unique within the log. */
export class DuplicateEventError extends WorldModelError {
  constructor(readonly eventId: string) {
    super(`event "${eventId}" already exists in the log: event ids must be unique`);
  }
}

/** An event belongs to a different media session than the engine. */
export class EventSessionMismatchError extends WorldModelError {
  readonly eventId: string;
  readonly eventSessionId: string;
  readonly engineSessionId: string;

  constructor(eventId: string, eventSessionId: string, engineSessionId: string) {
    super(`event "${eventId}" belongs to session "${eventSessionId}", not "${engineSessionId}"`);
    this.eventId = eventId;
    this.eventSessionId = eventSessionId;
    this.engineSessionId = engineSessionId;
  }
}

/** A correction targets an event the engine has never applied. */
export class CorrectionTargetNotFoundError extends WorldModelError {
  constructor(readonly correctionOf: string) {
    super(`correction targets unknown event "${correctionOf}"`);
  }
}

/** Internal guard: the engine produced a snapshot that fails its own contract. */
export class SnapshotIntegrityError extends WorldModelError {
  constructor(readonly issues: readonly string[]) {
    super(`engine produced an invalid WorldSnapshot: ${issues.join("; ")}`);
  }
}
