/**
 * Deterministic test data built inline from @sporta/contracts types (W006
 * testing strategy: synthetic, rights-free fixtures only).
 */
import {
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
  SCHEMA_VERSION,
  type EventEnvelope,
  type WorldEntity,
} from "@sporta/contracts";
import { known, unknownValue, type FootballState } from "../src/index";

export const SESSION_ID = "sess_w006";

/** A session-local participant entity with typical state slots. */
export function makeEntity(overrides: Partial<WorldEntity> = {}): WorldEntity {
  return {
    entityId: "ent_001",
    kind: "participant",
    version: 1,
    lastEventTimeMs: 1_000,
    state: {
      pitchPosition: known({ x: 52.5, y: 34 }, 0.82),
      teamRole: known("home"),
    },
    ...overrides,
  };
}

/** A derived football pass event with a two-observation evidence chain. */
export function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: "evt_001",
    sessionId: SESSION_ID,
    schemaVersion: SCHEMA_VERSION,
    eventTypeRef: "football/v1/pass",
    interval: { startTimeMs: 1_000, endTimeMs: 1_000 },
    eventTimeMs: 1_000,
    provenance: "DERIVED",
    confidence: 0.8,
    evidence: { observationIds: ["obs_001", "obs_002"] },
    ...overrides,
  };
}

/**
 * A fresh football state: canonical pitch, first-half clock at 0, unknown
 * score status, unknown possession (unset fields read as unknown — the
 * engine never fabricates certainty).
 */
export function makeFootballState(overrides: Partial<FootballState> = {}): FootballState {
  return {
    pitch: {
      lengthAxisMeters: PITCH_LENGTH_AXIS_METERS,
      widthAxisMeters: PITCH_WIDTH_AXIS_METERS,
      origin: PITCH_ORIGIN,
      axes: PITCH_AXES,
    },
    clock: { period: "first-half", clockMs: 0, stoppage: false },
    score: { home: 0, away: 0, status: unknownValue() },
    possession: unknownValue(),
    eventTaxonomyVersion: "1",
    ...overrides,
  };
}
