/**
 * Deterministic W402 test fixtures: W206-shaped pitch track observations,
 * W209-shaped commentary event candidate observations, W005 stores, W006
 * engines with a fixed wall-clock, precise manual event/entry builders, and
 * the full store → fusion → engine chain (docs/testing/HARNESS.md —
 * synthetic, rights-free fixtures only; no `Date.now`, no `Math.random`).
 *
 * The observation shapes mirror the W401 fusion fixtures (same W206/W209
 * payload structures) so the e2e chain exercises the ACTUAL delivered
 * `runWorldFusion` behavior.
 */
import { expect } from "bun:test";
import { EventEnvelope, SCHEMA_VERSION } from "@sporta/contracts";
import type {
  EntityKind,
  EventEnvelope as EventEnvelopeDoc,
  Observation,
  SourceModality,
  WorldEventStreamEntry,
} from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import type { ObservationStore } from "@sporta/observation";
import { runWorldFusion } from "@sporta/fusion";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { WorldModelEngine, unknownValue } from "@sporta/world-model";
import type { FootballState, WorldModelEngineInit } from "@sporta/world-model";

export const SESSION_ID = "sess-w402";

/** A fresh first-half football state with unknown score and possession. */
export function makeFootballState(overrides: Partial<FootballState> = {}): FootballState {
  return {
    pitch: {
      lengthAxisMeters: 105,
      widthAxisMeters: 68,
      origin: "corner",
      axes: "x=touchline, y=goal-line",
    },
    clock: { period: "first-half", clockMs: 0, stoppage: false },
    score: { home: 0, away: 0, status: unknownValue() },
    possession: unknownValue(),
    eventTaxonomyVersion: "1",
    ...overrides,
  };
}

/**
 * An engine for {@link SESSION_ID} with a FIXED wall-clock source
 * (`TEST_EPOCH_MS`) — deterministic, and deliberately DIFFERENT from the
 * replay's forced `REPLAY_NOW_MS` so tests can pin the generatedAtMs
 * difference between live snapshots and replay snapshots.
 */
export function makeEngine(init: WorldModelEngineInit = {}): WorldModelEngine {
  return WorldModelEngine.create(SESSION_ID, {
    now: () => TEST_EPOCH_MS,
    ...init,
  });
}

/** A store holding the given observations (appended in array order). */
export function makeStore(observations: readonly Observation[]): ObservationStore {
  const store = new InMemoryObservationStore();
  for (const observation of observations) store.append(observation);
  return store;
}

/** Options for {@link makeTrackObservation} (W206-shaped). */
export interface TrackOptions {
  /** The track (and entity) id — W204/W206 identity passthrough. */
  trackId: string;
  /** The tracked subject's entity kind (participant or ball). */
  kind: EntityKind;
  /** Session-timeline position in milliseconds. */
  t: number;
  /** Pitch-space position in canonical meters. */
  x: number;
  y: number;
  /** Frame id (W206 observation ids are `sp-<frameId>-<trackId>`). */
  frameId?: string;
  /** Honest fused confidence; omitted when absent (never invented). */
  confidence?: number;
  /** Overrides the derived observation id. */
  observationId?: string;
  /** Producing component (default: the W206 spatial-state component). */
  componentId?: string;
  /** Producing modality (default: vision). */
  modality?: SourceModality;
}

/** One W206-shaped pitch-space track observation. */
export function makeTrackObservation(options: TrackOptions): Observation {
  const frameId = options.frameId ?? `f${options.t / 1000}`;
  return {
    observationId: options.observationId ?? `sp-${frameId}-${options.trackId}`,
    sessionId: SESSION_ID,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs: options.t,
    modality: options.modality ?? "vision",
    componentId: options.componentId ?? "spatial-state-v1",
    provenance: "DERIVED",
    ...(options.confidence !== undefined ? { confidence: options.confidence } : {}),
    payload: {
      kind: "track" as const,
      entityId: options.trackId,
      position: { x: options.x, y: options.y },
    },
    subjectEntityRefs: [{ entityId: options.trackId, kind: options.kind }],
  };
}

/** Options for {@link makeCandidateObservation} (W209-shaped). */
export interface CandidateOptions {
  /** The candidate id; the observation id is `ceu-<candidateId>`. */
  candidateId: string;
  /** The extracted CommentaryEventType. */
  eventType: string;
  /** Session-timeline position in milliseconds (the unit's startMs). */
  t: number;
  /** Honest per-candidate confidence in [0, 1]. */
  confidence?: number;
  /** The matched text span, verbatim. */
  eventPhrase?: string;
  /** Subject mentions (full W209 SubjectMention shape is tolerated). */
  subjects?: ReadonlyArray<{ name: string; role?: string; nameConfidence?: number }>;
  /** Excitement of the containing sentence in [0, 1]. */
  emphasis?: number;
  /** The W208 commentary unit the candidate was extracted from. */
  unitId?: string;
}

/** One W209-shaped commentary event candidate observation. */
export function makeCandidateObservation(options: CandidateOptions): Observation {
  return {
    observationId: `ceu-${options.candidateId}`,
    sessionId: SESSION_ID,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs: options.t,
    modality: "commentary",
    componentId: "commentary-understanding-v1",
    provenance: "DERIVED",
    ...(options.confidence !== undefined ? { confidence: options.confidence } : {}),
    payload: {
      kind: "generic" as const,
      data: {
        eventType: options.eventType,
        eventPhrase: options.eventPhrase ?? "phrase",
        subjects: options.subjects ?? [{ name: "Salah", role: "agent", nameConfidence: 1 }],
        emphasis: options.emphasis ?? 0.5,
        unitId: options.unitId ?? "cu-1",
      },
    },
    subjectEntityRefs: [],
  };
}

/**
 * The synthetic multi-stream e2e fixture (mirrors the W401 shape): 40
 * pitch-space track observations (10 frames × 3 participants + 1 ball,
 * W206-shaped) plus 5 W209-shaped commentary candidates (kickoff, pass,
 * goal, fulltime, other).
 *
 * Fusion outcome (deterministic, pinned by the W401 tests and re-pinned
 * here through the temporal chain): 4 entities (last event time 10_000), 3
 * events (kickoff 500, pass 3_000, goal 6_000 — ids `fe-ceu-ec-1..3`), the
 * fulltime candidate installs the post-match clock rule at 10_500, and the
 * `other` candidate maps to no event.
 */
export function buildE2EObservations(): Observation[] {
  const observations: Observation[] = [];
  const finals: ReadonlyArray<TrackOptions & { trackId: string }> = [
    { trackId: "p1", kind: "participant", x: 54, y: 34, confidence: 0.7, t: 10_000 },
    { trackId: "p2", kind: "participant", x: 49, y: 34, confidence: 0.8, t: 10_000 },
    { trackId: "p3", kind: "participant", x: 50, y: 37, confidence: 0.6, t: 10_000 },
    { trackId: "b1", kind: "ball", x: 50, y: 34, confidence: 0.9, t: 10_000 },
  ];
  for (let frame = 1; frame <= 10; frame += 1) {
    const t = frame * 1_000;
    for (const entity of finals) {
      observations.push(
        makeTrackObservation({
          ...entity,
          t,
          frameId: `f${frame}`,
          x: entity.x - (10 - frame) * 0.05,
          y: entity.y,
        }),
      );
    }
  }
  observations.push(
    makeCandidateObservation({
      candidateId: "ec-1",
      eventType: "kickoff",
      t: 500,
      confidence: 0.9,
    }),
    makeCandidateObservation({ candidateId: "ec-2", eventType: "pass", t: 3_000, confidence: 0.8 }),
    makeCandidateObservation({
      candidateId: "ec-3",
      eventType: "goal",
      t: 6_000,
      confidence: 0.95,
    }),
    makeCandidateObservation({
      candidateId: "ec-4",
      eventType: "fulltime",
      t: 10_500,
      confidence: 0.99,
    }),
    makeCandidateObservation({
      candidateId: "ec-5",
      eventType: "other",
      t: 10_800,
      confidence: 0.5,
    }),
  );
  return observations;
}

/** Runs the full W401 chain: store → engine → `runWorldFusion`. */
export function fuse(
  observations: readonly Observation[],
  init: WorldModelEngineInit = {},
): { store: ObservationStore; engine: WorldModelEngine } {
  const store = makeStore(observations);
  const engine = makeEngine(init);
  runWorldFusion({ store, engine, sessionId: SESSION_ID });
  return { store, engine };
}

/** Spec for {@link makeEvent}: an exact, deterministic event envelope. */
export interface TestEventSpec {
  eventId: string;
  /** Session-timeline position (the event is a point event at this time). */
  eventTimeMs: number;
  /** When set, the event is a versioned correction of that event id. */
  correctionOf?: string;
  /** Defaults to {@link SESSION_ID}. */
  sessionId?: string;
  /** Defaults to `"football/v1/pass"`. */
  eventTypeRef?: string;
}

/**
 * A contract-valid `EventEnvelope` built to an exact spec (no rng — every
 * field fixed or defaulted visibly). `EventEnvelope.parse` at the boundary
 * keeps the fixture honest (an invalid spec throws the zod error).
 */
export function makeEvent(spec: TestEventSpec): EventEnvelopeDoc {
  return EventEnvelope.parse({
    eventId: spec.eventId,
    sessionId: spec.sessionId ?? SESSION_ID,
    schemaVersion: SCHEMA_VERSION,
    eventTypeRef: spec.eventTypeRef ?? "football/v1/pass",
    interval: { startTimeMs: spec.eventTimeMs, endTimeMs: spec.eventTimeMs },
    eventTimeMs: spec.eventTimeMs,
    provenance: "DERIVED",
    confidence: 0.8,
    evidence: { observationIds: [`obs-${spec.eventId}`] },
    ...(spec.correctionOf !== undefined ? { correctionOf: spec.correctionOf } : {}),
  });
}

/**
 * A `WorldEventStreamEntry` with an exact sequence (and, by default, the
 * `snapshotVersionAfter` a live engine would assign: sequence + 1).
 */
export function makeEntry(
  sequence: number,
  event: EventEnvelopeDoc,
  snapshotVersionAfter: number = sequence + 1,
): WorldEventStreamEntry {
  return { sequence, snapshotVersionAfter, event };
}

/** Asserts the action throws `errorClass` with EXACTLY `message`. */
export function expectExactThrow<T extends Error>(
  action: () => unknown,
  errorClass: new (...args: never[]) => T,
  message: string,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(errorClass);
  expect((caught as Error).message).toBe(message);
}
