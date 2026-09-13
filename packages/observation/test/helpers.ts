/**
 * Typed inline fixtures for the W005 tests: valid observations built from
 * `@sporta/contracts` types, with only the fields under test varied.
 */
import { SCHEMA_VERSION } from "@sporta/contracts";
import type { EventEnvelope, Interval, Observation } from "@sporta/contracts";
import { InMemoryObservationStore } from "../src/store";

/** Closed interval on the canonical media timeline; `end` defaults to `start`. */
export function makeInterval(startTimeMs: number, endTimeMs?: number): Interval {
  return { startTimeMs, endTimeMs: endTimeMs ?? startTimeMs };
}

/** A valid derived event envelope, without needing a store to derive from. */
export function makeEventEnvelope(fields: {
  eventId: string;
  sessionId?: string;
  eventTimeMs: number;
  eventTypeRef?: string;
  observationIds?: string[];
  correctionOf?: string;
}): EventEnvelope {
  return {
    eventId: fields.eventId,
    sessionId: fields.sessionId ?? "sess-1",
    schemaVersion: SCHEMA_VERSION,
    eventTypeRef: fields.eventTypeRef ?? "football/v1/pass",
    interval: makeInterval(Math.max(0, fields.eventTimeMs - 500), fields.eventTimeMs),
    eventTimeMs: fields.eventTimeMs,
    provenance: "DERIVED",
    confidence: 0.8,
    evidence: { observationIds: fields.observationIds ?? [`${fields.eventId}-evidence`] },
    ...(fields.correctionOf !== undefined ? { correctionOf: fields.correctionOf } : {}),
  };
}

/** A valid vision detection observation. */
export function makeDetectionObservation(fields: {
  observationId: string;
  sessionId: string;
  eventTimeMs: number;
  /** Omitted entirely when not provided (missing-confidence cases). */
  confidence?: number;
  componentId?: string;
  provenance?: Observation["provenance"];
}): Observation {
  return {
    observationId: fields.observationId,
    sessionId: fields.sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs: fields.eventTimeMs,
    modality: "vision",
    componentId: fields.componentId ?? "comp-test-detector",
    modelId: "model-test-detector-v1",
    provenance: fields.provenance ?? "OBSERVED",
    ...(fields.confidence !== undefined ? { confidence: fields.confidence } : {}),
    payload: {
      kind: "detection",
      box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      label: "player",
    },
    subjectEntityRefs: [],
  };
}

/** A valid commentary transcription observation. */
export function makeTranscriptObservation(fields: {
  observationId: string;
  sessionId: string;
  eventTimeMs: number;
  text: string;
  /** ASR confidence inside the payload; omitted entirely when not provided. */
  asrConfidence?: number;
  confidence?: number;
  speakerLabel?: string;
}): Observation {
  return {
    observationId: fields.observationId,
    sessionId: fields.sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs: fields.eventTimeMs,
    modality: "commentary",
    componentId: "comp-test-asr",
    modelId: "model-test-asr-v1",
    provenance: "OBSERVED",
    ...(fields.confidence !== undefined ? { confidence: fields.confidence } : {}),
    payload: {
      kind: "transcription",
      text: fields.text,
      ...(fields.speakerLabel !== undefined ? { speakerLabel: fields.speakerLabel } : {}),
      ...(fields.asrConfidence !== undefined ? { asrConfidence: fields.asrConfidence } : {}),
    },
    subjectEntityRefs: [],
  };
}

/** A store pre-loaded with the given observations. */
export function storeWith(...observations: Observation[]): InMemoryObservationStore {
  const store = new InMemoryObservationStore();
  for (const observation of observations) store.append(observation);
  return store;
}
