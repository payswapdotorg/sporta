/**
 * Sports World Model engine (W006).
 *
 * This is the domain engine over the frozen `@sporta/contracts` world-model
 * schemas: it holds session-scoped entities, an event log ordered by
 * `eventTimeMs` then sequence, one optional football extension state, and a
 * monotonic snapshot version counter that starts at 1.
 *
 * Invariants enforced here (architecture-lock §4, docs/contracts/
 * sports-world-model.md):
 *
 * - **Stable identity**: an `entityId` never changes its `kind`; updates bump
 *   the entity version and keep `lastEventTimeMs` monotonic.
 * - **Bounded reorder**: events older than the log high-water minus
 *   `maxReorderMs` (default 5000) throw; in-order and near-order events are
 *   accepted and kept sorted.
 * - **Versioned corrections**: a correction (`correctionOf`) is appended as a
 *   new log entry, bumps the affected entities' versions, and records the
 *   supersession — superseded events stay queryable, history is never
 *   silently rewritten.
 * - **Explicit uncertainty**: unset football fields stay `unknown`; the engine
 *   uses the uncertainty constructors and never fabricates certainty.
 * - **Immutability**: every record is validated and cloned at the boundary,
 *   and every returned value (snapshots, entities, stream entries) is a
 *   deep-frozen clone — callers cannot mutate engine state.
 */
import {
  EntityId,
  ENTITY_ID_PATTERN,
  EventEnvelope,
  MatchClock,
  PitchFrame,
  Score,
  UncertainValue,
  WorldEntity,
  WorldSnapshot,
  SCHEMA_VERSION,
  type MatchPeriod,
  type WorldEventStreamEntry,
} from "@sporta/contracts";
import {
  ClockRegressionError,
  CorrectionTargetNotFoundError,
  DuplicateEventError,
  EntityKindChangeError,
  EventSessionMismatchError,
  FootballStateMissingError,
  InvalidEngineConfigError,
  InvalidEntityError,
  InvalidEntityIdError,
  InvalidEventError,
  InvalidFootballStateError,
  InvalidTimelineQueryError,
  LateEventError,
  SnapshotIntegrityError,
} from "./errors";
import { cloneDeep, deepFreeze, issuesOf } from "./internal";
import { uncertain, unknownValue } from "./uncertainty";

/** Default bounded-reorder window in milliseconds (W006 specification). */
export const DEFAULT_MAX_REORDER_MS = 5000;

/**
 * The football extension state as defined by `@sporta/contracts`
 * (`WorldSnapshot.football`). Derived from the public contract surface so
 * this package consumes — never redefines — the frozen schema.
 */
export type FootballState = NonNullable<WorldSnapshot["football"]>;

/** A partial football state update keyed to a timeline position. */
export type FootballStatePatch = Partial<FootballState> & { atMs: number };

/** Options accepted by `WorldModelEngine.create`. */
export interface WorldModelEngineInit {
  /** Initial football extension state; the engine carries at most one. */
  football?: FootballState;
  /** Bounded reorder window in ms (default 5000). */
  maxReorderMs?: number;
  /**
   * Wall-clock source for `WorldSnapshot.generatedAtMs`. Defaults to
   * `Date.now`; injectable for deterministic tests.
   */
  now?: () => number;
}

/**
 * Optional per-event entity association. The `EventEnvelope` contract itself
 * carries no entity references (events reference observations, and
 * observations reference entities), so the fusion layer (W401) declares which
 * entities an event affects. A correction bumps the versions of the entities
 * associated with the event it corrects.
 */
export interface ApplyEventOptions {
  affectedEntityIds?: readonly EntityId[];
}

/** Options for `setScore`. */
export interface SetScoreOptions {
  /** Confidence in [0, 1] for the new score as a provisional candidate. */
  confidence?: number;
}

/** Internal event-log entry: the stream entry plus entity associations. */
interface LogEntry {
  readonly sequence: number;
  readonly snapshotVersionAfter: number;
  readonly event: EventEnvelope;
  readonly affectedEntityIds: readonly EntityId[];
}

/**
 * Validates a football state against the canonical contract. `FootballState`
 * is not exported as a standalone schema from `@sporta/contracts`, so the
 * state is probed through `WorldSnapshot` (whose `football` field embeds it);
 * only issues under `football` are reported.
 */
function validateFootballState(state: FootballState): FootballState {
  const probe = {
    sessionId: "football-state-probe",
    schemaVersion: SCHEMA_VERSION,
    watermark: { watermarkMs: 0, sequence: 0 },
    entities: [],
    football: state,
    generatedAtMs: 0,
  };
  const result = WorldSnapshot.safeParse(probe);
  if (result.success) {
    const parsed = result.data.football;
    if (parsed !== undefined) {
      return parsed;
    }
    throw new InvalidFootballStateError(["football state disappeared during validation"]);
  }
  const issues = result.error.issues
    .filter((issue) => issue.path[0] === "football")
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new InvalidFootballStateError(
    issues.length > 0 ? issues : ["football state failed contract validation"],
  );
}

function dedupeEntityIds(ids: readonly EntityId[]): EntityId[] {
  return [...new Set<EntityId>(ids)];
}

function assertTimelinePosition(atMs: number, operation: string): void {
  if (typeof atMs !== "number" || Number.isNaN(atMs)) {
    throw new InvalidTimelineQueryError(
      `${operation}: atMs must be a number (got ${String(atMs)})`,
    );
  }
}

/**
 * The Sports World Model engine. Create one per media session with
 * {@link WorldModelEngine.create}; the constructor is private so engines are
 * always validated on creation.
 */
export class WorldModelEngine {
  private readonly session: string;
  private readonly reorderWindowMs: number;
  private readonly nowFn: () => number;
  private readonly entityMap = new Map<EntityId, WorldEntity>();
  /** Ordered by `eventTimeMs` then sequence (unique, arrival-ordered). */
  private readonly eventLog: LogEntry[] = [];
  private readonly eventIndex = new Map<string, LogEntry>();
  /** target eventId -> correcting eventId (recorded supersessions). */
  private readonly supersededBy = new Map<string, string>();
  private footballState: FootballState | undefined;
  private footballTime = 0;
  private versionCounter = 1;
  private lastSequence = 0;

  private constructor(
    sessionId: string,
    maxReorderMs: number,
    now: () => number,
    football: FootballState | undefined,
  ) {
    this.session = sessionId;
    this.reorderWindowMs = maxReorderMs;
    this.nowFn = now;
    this.footballState = football;
  }

  /**
   * Creates an engine for one media session. The optional initial football
   * state is validated against the contract and cloned; the snapshot version
   * counter starts at 1 (the genesis state).
   */
  static create(sessionId: string, init?: WorldModelEngineInit): WorldModelEngine {
    if (typeof sessionId !== "string" || sessionId.length < 1) {
      throw new InvalidEngineConfigError("sessionId must be a non-empty string");
    }
    const maxReorderMs = init?.maxReorderMs ?? DEFAULT_MAX_REORDER_MS;
    if (typeof maxReorderMs !== "number" || !Number.isFinite(maxReorderMs) || maxReorderMs < 0) {
      throw new InvalidEngineConfigError(
        `maxReorderMs must be a finite number >= 0 (default ${DEFAULT_MAX_REORDER_MS})`,
      );
    }
    const now = init?.now ?? (() => Date.now());
    if (typeof now !== "function") {
      throw new InvalidEngineConfigError("now must be a function returning epoch milliseconds");
    }
    let football: FootballState | undefined;
    if (init?.football !== undefined) {
      football = cloneDeep(validateFootballState(init.football));
    }
    return new WorldModelEngine(sessionId, maxReorderMs, now, football);
  }

  /** The media session this engine belongs to. */
  get sessionId(): string {
    return this.session;
  }

  /** Current snapshot version (starts at 1, bumps on every state change). */
  get snapshotVersion(): number {
    return this.versionCounter;
  }

  /** Number of events in the log (including superseded ones). */
  get eventCount(): number {
    return this.eventLog.length;
  }

  /** Entity ids in insertion order. Returns a fresh array each call. */
  get entityIds(): EntityId[] {
    return [...this.entityMap.keys()];
  }

  /** The configured bounded-reorder window in milliseconds. */
  get maxReorderMs(): number {
    return this.reorderWindowMs;
  }

  /** Timeline position of the football state (0 for the initial state). */
  get footballTimelineMs(): number {
    return this.footballTime;
  }

  /**
   * Inserts or updates an entity with stable identity:
   *
   * - a new `entityId` inserts with version 1 (the caller's `version` is
   *   ignored — the engine owns versioning);
   * - an existing `entityId` updates: version becomes `existing + 1` and
   *   `lastEventTimeMs` stays monotonic (a regressing time is clamped to the
   *   current high-water value, never silently moved backwards);
   * - changing `kind` throws {@link EntityKindChangeError}.
   *
   * Returns the stored entity as a deep-frozen clone.
   */
  upsertEntity(entity: WorldEntity): WorldEntity {
    const parsed = WorldEntity.safeParse(entity);
    if (!parsed.success) {
      throw new InvalidEntityError(issuesOf(parsed.error));
    }
    const incoming = cloneDeep(parsed.data);
    const existing = this.entityMap.get(incoming.entityId);
    let stored: WorldEntity;
    if (existing === undefined) {
      stored = { ...incoming, version: 1 };
    } else {
      if (incoming.kind !== existing.kind) {
        throw new EntityKindChangeError(incoming.entityId, existing.kind, incoming.kind);
      }
      stored = {
        ...incoming,
        version: existing.version + 1,
        lastEventTimeMs: Math.max(existing.lastEventTimeMs, incoming.lastEventTimeMs),
      };
    }
    this.entityMap.set(stored.entityId, stored);
    this.versionCounter += 1;
    return deepFreeze(cloneDeep(stored));
  }

  /**
   * Appends an event to the log under the bounded-reorder rule.
   *
   * - the envelope is validated and cloned; it must belong to this session
   *   and its `eventId` must be unique in the log;
   * - events older than `logHighWaterMs - maxReorderMs` throw
   *   {@link LateEventError}; events within the window are accepted and
   *   inserted at their event-time position (the log stays sorted by
   *   `eventTimeMs` then sequence);
   * - a correction (`correctionOf`) must target an applied event; it is
   *   appended as a new entry, recorded as superseding the target, and bumps
   *   the version of the entities associated with the target (plus any
   *   associations declared on the correction itself, via
   *   `options.affectedEntityIds`). The superseded event stays in the log.
   *
   * Returns the resulting stream entry as a deep-frozen clone.
   */
  applyEvent(event: EventEnvelope, options?: ApplyEventOptions): WorldEventStreamEntry {
    const parsed = EventEnvelope.safeParse(event);
    if (!parsed.success) {
      throw new InvalidEventError(issuesOf(parsed.error));
    }
    const incoming = cloneDeep(parsed.data);
    if (incoming.sessionId !== this.session) {
      throw new EventSessionMismatchError(incoming.eventId, incoming.sessionId, this.session);
    }
    if (this.eventIndex.has(incoming.eventId)) {
      throw new DuplicateEventError(incoming.eventId);
    }
    if (options?.affectedEntityIds !== undefined) {
      for (const candidateId of options.affectedEntityIds) {
        if (!EntityId.safeParse(candidateId).success) {
          throw new InvalidEntityIdError(candidateId);
        }
      }
    }
    const lastEntry = this.eventLog.at(-1);
    const highWaterMs = lastEntry === undefined ? undefined : lastEntry.event.eventTimeMs;
    if (highWaterMs !== undefined && incoming.eventTimeMs < highWaterMs - this.reorderWindowMs) {
      throw new LateEventError(incoming.eventTimeMs, highWaterMs, this.reorderWindowMs);
    }
    const target =
      incoming.correctionOf === undefined ? undefined : this.eventIndex.get(incoming.correctionOf);
    if (incoming.correctionOf !== undefined && target === undefined) {
      throw new CorrectionTargetNotFoundError(incoming.correctionOf);
    }
    const affectedEntityIds = dedupeEntityIds([
      ...(target?.affectedEntityIds ?? []),
      ...(options?.affectedEntityIds ?? []),
    ]);

    this.lastSequence += 1;
    this.versionCounter += 1;
    const entry: LogEntry = {
      sequence: this.lastSequence,
      snapshotVersionAfter: this.versionCounter,
      event: incoming,
      affectedEntityIds,
    };
    // Insert after all entries with eventTimeMs <= incoming (the new event
    // has the highest sequence among equal-times, keeping the log ordered by
    // eventTimeMs then sequence).
    const insertAt = this.eventLog.findIndex(
      (existing) => existing.event.eventTimeMs > incoming.eventTimeMs,
    );
    if (insertAt === -1) {
      this.eventLog.push(entry);
    } else {
      this.eventLog.splice(insertAt, 0, entry);
    }
    this.eventIndex.set(incoming.eventId, entry);

    if (incoming.correctionOf !== undefined && target !== undefined) {
      this.supersededBy.set(incoming.correctionOf, incoming.eventId);
      for (const entityId of affectedEntityIds) {
        const entity = this.entityMap.get(entityId);
        if (entity === undefined) {
          // Associations may reference entities that have not been upserted
          // yet; the bump applies once the entity exists.
          continue;
        }
        this.entityMap.set(entityId, {
          ...entity,
          version: entity.version + 1,
          lastEventTimeMs: Math.max(entity.lastEventTimeMs, incoming.eventTimeMs),
        });
      }
    }
    return this.toStreamEntry(entry);
  }

  /**
   * The best-known coherent state at a timeline position:
   *
   * - without `atMs`: all current entities, the football state when present,
   *   and the current watermark;
   * - with `atMs`: only entities whose `lastEventTimeMs <= atMs` and the
   *   football state when its timeline position is `<= atMs` (future state is
   *   excluded, not back-dated);
   * - `watermark` = the maximum event time included (entities, included log
   *   events, football timeline) plus the highest sequence included (the
   *   engine's current sequence for latest snapshots);
   * - the returned snapshot is validated against the `WorldSnapshot`
   *   contract, cloned and deep-frozen — callers cannot mutate engine state.
   */
  snapshot(atMs?: number): WorldSnapshot {
    if (atMs !== undefined) {
      assertTimelinePosition(atMs, "snapshot");
    }
    const entitiesOut: WorldEntity[] = [];
    let watermarkMs = 0;
    for (const entity of this.entityMap.values()) {
      if (atMs === undefined || entity.lastEventTimeMs <= atMs) {
        entitiesOut.push(cloneDeep(entity));
        watermarkMs = Math.max(watermarkMs, entity.lastEventTimeMs);
      }
    }
    let watermarkSequence = 0;
    if (atMs === undefined) {
      watermarkSequence = this.lastSequence;
      const lastEntry = this.eventLog.at(-1);
      if (lastEntry !== undefined) {
        watermarkMs = Math.max(watermarkMs, lastEntry.event.eventTimeMs);
      }
      if (this.footballState !== undefined) {
        watermarkMs = Math.max(watermarkMs, this.footballTime);
      }
    } else {
      // The log is sorted by eventTimeMs, so inclusion is a prefix.
      for (const entry of this.eventLog) {
        if (entry.event.eventTimeMs <= atMs) {
          watermarkMs = Math.max(watermarkMs, entry.event.eventTimeMs);
          watermarkSequence = Math.max(watermarkSequence, entry.sequence);
        } else {
          break;
        }
      }
      if (this.footballState !== undefined && this.footballTime <= atMs) {
        watermarkMs = Math.max(watermarkMs, this.footballTime);
      }
    }
    const footballIncluded =
      this.footballState !== undefined && (atMs === undefined || this.footballTime <= atMs);
    const snapshot: WorldSnapshot = {
      sessionId: this.session,
      schemaVersion: SCHEMA_VERSION,
      watermark: { watermarkMs, sequence: watermarkSequence },
      entities: entitiesOut,
      ...(footballIncluded ? { football: cloneDeep(this.footballState) } : {}),
      generatedAtMs: this.nowFn(),
    };
    const selfCheck = WorldSnapshot.safeParse(snapshot);
    if (!selfCheck.success) {
      throw new SnapshotIntegrityError(issuesOf(selfCheck.error));
    }
    return deepFreeze(snapshot);
  }

  /**
   * The entity with `entityId`, or `undefined` when it does not exist or its
   * `lastEventTimeMs` is after `atMs`. Returns a deep-frozen clone.
   */
  entityAt(entityId: EntityId, atMs?: number): WorldEntity | undefined {
    if (atMs !== undefined) {
      assertTimelinePosition(atMs, "entityAt");
    }
    const entity = this.entityMap.get(entityId);
    if (entity === undefined) {
      return undefined;
    }
    if (atMs !== undefined && entity.lastEventTimeMs > atMs) {
      return undefined;
    }
    return deepFreeze(cloneDeep(entity));
  }

  /**
   * All log entries with `sequence > given` (strictly after the checkpoint),
   * in log order (event time ascending). A fresh consumer starts from
   * `eventsSince(0)`; a consumer resuming from a snapshot uses its
   * `watermark.sequence`. Superseded events remain queryable. Returns
   * deep-frozen clones.
   */
  eventsSince(sequence: number): WorldEventStreamEntry[] {
    const entries: WorldEventStreamEntry[] = [];
    for (const entry of this.eventLog) {
      if (entry.sequence > sequence) {
        entries.push(this.toStreamEntry(entry));
      }
    }
    return entries;
  }

  /**
   * Applies a partial football state update at timeline position `atMs`:
   * provided fields replace only their own keys (clock, score, possession,
   * pitch, taxonomy version), the merged state is validated against the
   * contract, and the football timeline marker moves forward monotonically
   * (`Math.max`). The clock rule is enforced across all clock updates: the
   * clock is monotonic within a period — a backwards clock within the same
   * period throws, a period change resets it.
   */
  applyFootballState(patch: FootballStatePatch): void {
    if (this.footballState === undefined) {
      throw new FootballStateMissingError("applyFootballState");
    }
    if (typeof patch.atMs !== "number" || Number.isNaN(patch.atMs) || patch.atMs < 0) {
      throw new InvalidFootballStateError(["atMs must be a number >= 0"]);
    }
    const next: FootballState = { ...this.footballState };
    if (patch.pitch !== undefined) {
      const parsed = PitchFrame.safeParse(patch.pitch);
      if (!parsed.success) {
        throw new InvalidFootballStateError(issuesOf(parsed.error));
      }
      next.pitch = parsed.data;
    }
    if (patch.clock !== undefined) {
      next.clock = this.validateClockPatch(patch.clock);
    }
    if (patch.score !== undefined) {
      const parsed = Score.safeParse(patch.score);
      if (!parsed.success) {
        throw new InvalidFootballStateError(issuesOf(parsed.error));
      }
      next.score = parsed.data;
    }
    if (patch.possession !== undefined) {
      next.possession = this.validatePossessionPatch(patch.possession);
    }
    if (patch.eventTaxonomyVersion !== undefined) {
      if (typeof patch.eventTaxonomyVersion !== "string" || patch.eventTaxonomyVersion.length < 1) {
        throw new InvalidFootballStateError(["eventTaxonomyVersion: must be a non-empty string"]);
      }
      next.eventTaxonomyVersion = patch.eventTaxonomyVersion;
    }
    this.footballState = validateFootballState(next);
    this.footballTime = Math.max(this.footballTime, patch.atMs);
    this.versionCounter += 1;
  }

  /**
   * Advances the match clock to `clockMs` (optionally switching `period`).
   * Period-aware monotonicity: within the same period the clock cannot move
   * backwards (equal is allowed); a period change resets it. Stoppage is
   * toggled via {@link applyFootballState} clock patches. The football
   * timeline marker is not moved (use `applyFootballState` with `atMs`).
   */
  advanceClock(clockMs: number, period?: MatchPeriod): void {
    if (this.footballState === undefined) {
      throw new FootballStateMissingError("advanceClock");
    }
    const current = this.footballState.clock;
    const nextPeriod = period ?? current.period;
    const parsed = MatchClock.safeParse({
      period: nextPeriod,
      clockMs,
      stoppage: current.stoppage,
    });
    if (!parsed.success) {
      throw new InvalidFootballStateError(issuesOf(parsed.error));
    }
    if (parsed.data.period === current.period && parsed.data.clockMs < current.clockMs) {
      throw new ClockRegressionError(current.period, current.clockMs, parsed.data.clockMs);
    }
    this.footballState = { ...this.footballState, clock: parsed.data };
    this.versionCounter += 1;
  }

  /**
   * Sets the score. With a `confidence`, the new score is a provisional
   * candidate (`status: "uncertain", value: "provisional"`); without one, the
   * values change but the status stays `unknown` — the engine never
   * fabricates certainty. A confirmed score is asserted explicitly through
   * {@link applyFootballState} with a `known("confirmed")` status. Every
   * score change bumps the engine's snapshot version (the score versioning
   * implicit in world state, observable via `auditTrail`).
   */
  setScore(home: number, away: number, options?: SetScoreOptions): void {
    if (this.footballState === undefined) {
      throw new FootballStateMissingError("setScore");
    }
    const confidence = options?.confidence;
    const status = confidence !== undefined ? uncertain("provisional", confidence) : unknownValue();
    const parsed = Score.safeParse({ home, away, status });
    if (!parsed.success) {
      throw new InvalidFootballStateError(issuesOf(parsed.error));
    }
    this.footballState = { ...this.footballState, score: parsed.data };
    this.versionCounter += 1;
  }

  /**
   * Sets the possession candidate. `null` is VALID: unknown possession is
   * stored as `{ status: "unknown" }` (never invented). A non-null entity id
   * is stored as an `uncertain` candidate with the given confidence.
   */
  setPossession(entityId: EntityId | null, confidence: number): void {
    if (this.footballState === undefined) {
      throw new FootballStateMissingError("setPossession");
    }
    if (entityId === null) {
      this.footballState = { ...this.footballState, possession: unknownValue() };
    } else {
      const idCheck = EntityId.safeParse(entityId);
      if (!idCheck.success) {
        throw new InvalidEntityIdError(entityId);
      }
      this.footballState = {
        ...this.footballState,
        possession: uncertain({ entityId: idCheck.data }, confidence),
      };
    }
    this.versionCounter += 1;
  }

  private validateClockPatch(clock: FootballState["clock"]): FootballState["clock"] {
    const parsed = MatchClock.safeParse(clock);
    if (!parsed.success) {
      throw new InvalidFootballStateError(issuesOf(parsed.error));
    }
    const current = this.footballState!.clock;
    if (parsed.data.period === current.period && parsed.data.clockMs < current.clockMs) {
      throw new ClockRegressionError(current.period, current.clockMs, parsed.data.clockMs);
    }
    return parsed.data;
  }

  private validatePossessionPatch(
    possession: FootballState["possession"],
  ): FootballState["possession"] {
    const slotCheck = UncertainValue.safeParse(possession);
    if (!slotCheck.success) {
      throw new InvalidFootballStateError(issuesOf(slotCheck.error));
    }
    const slot = slotCheck.data;
    if (slot.value === undefined) {
      return {
        status: slot.status,
        ...(slot.confidence !== undefined ? { confidence: slot.confidence } : {}),
      };
    }
    const entityId = (slot.value as { entityId?: unknown }).entityId;
    if (typeof entityId !== "string" || !ENTITY_ID_PATTERN.test(entityId)) {
      throw new InvalidFootballStateError([
        "possession.value.entityId: must be 1-64 characters of [A-Za-z0-9_-]",
      ]);
    }
    return {
      status: slot.status,
      value: { entityId },
      ...(slot.confidence !== undefined ? { confidence: slot.confidence } : {}),
    };
  }

  private toStreamEntry(entry: LogEntry): WorldEventStreamEntry {
    return deepFreeze({
      sequence: entry.sequence,
      snapshotVersionAfter: entry.snapshotVersionAfter,
      event: cloneDeep(entry.event),
    });
  }
}
