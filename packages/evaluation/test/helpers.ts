/**
 * W403 test helpers: a hand-built, contract-shaped MINIMAL world-model
 * artifact (fast — no pipeline run) for comparator/serializer/shape unit
 * tests, plus deterministic temp-path helpers for subprocess e2e tests
 * (docs/testing/HARNESS.md — synthetic, rights-free fixtures only; no
 * `Date.now`, no `Math.random`, no `new Date`).
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
  SCHEMA_VERSION,
} from "@sporta/contracts";
import type { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import type { ConflictRecord, FusionReport } from "@sporta/fusion";
import { REPLAY_GENERATED_AT_MS } from "@sporta/temporal";
import { TEST_EPOCH_MS } from "@sporta/testing";
import type { FootballState } from "@sporta/world-model";
import { ARTIFACT_SCHEMA } from "../src/artifact";
import type { WorldModelArtifact } from "../src/artifact";

/** The minimal artifact's session id (echoed everywhere it must appear). */
export const MINI_SESSION_ID = "sess-w403-mini";

/** A deterministic absolute scratch path (repo-clean, collision-free). */
export function scratchPath(name: string): string {
  return join(tmpdir(), `sporta-w403-${name}`);
}

/** Deep clone via JSON round-trip (artifacts are plain JSON data). */
export function cloneArtifact(artifact: WorldModelArtifact): WorldModelArtifact {
  return JSON.parse(JSON.stringify(artifact)) as WorldModelArtifact;
}

/** One fusion report, all counters explicit (no invention, no defaults). */
function report(overrides: Partial<FusionReport>): FusionReport {
  return {
    entitiesUpserted: 0,
    eventsApplied: 0,
    eventsDeduplicated: 0,
    clockPatches: 0,
    possessionUpdates: 0,
    conflicts: [],
    snapshotVersionAfter: 1,
    warnings: [],
    ...overrides,
  };
}

/** One possession conflict (the ledger shape the real fixture produces). */
function possessionConflict(): ConflictRecord {
  return {
    conflictId: "cf-1",
    slotKey: "possession",
    observationIds: ["sp-f0-pA", "sp-f0-pB"],
    values: [
      { value: "pA", confidence: 0.8 },
      { value: "pB", confidence: 0.75 },
    ],
    resolution: "none",
    detectedAtMs: 1_000,
  };
}

/**
 * A minimal, FULLY-shaped world-model artifact: one pinned snapshot with one
 * participant entity (all three state slots), the football extension (score
 * status + possession slots carrying values and confidences), one conflict,
 * one event-window entry, and a replay with one checkpoint + final. Every
 * class of the tolerance table is reachable from this root.
 */
export function minimalArtifact(): WorldModelArtifact {
  const entity = {
    entityId: "pA",
    kind: "participant" as const,
    version: 1,
    lastEventTimeMs: 0,
    state: {
      position: { status: "uncertain" as const, value: { x: 1.5, y: 2.5 }, confidence: 0.8 },
      spatialFrame: { status: "known" as const, value: "pitch" as const },
      lastSeenMs: { status: "known" as const, value: 0 },
    },
  };
  const football: FootballState = {
    pitch: {
      lengthAxisMeters: PITCH_LENGTH_AXIS_METERS,
      widthAxisMeters: PITCH_WIDTH_AXIS_METERS,
      origin: PITCH_ORIGIN,
      axes: PITCH_AXES,
    },
    clock: { period: "first-half" as const, clockMs: 0, stoppage: false },
    score: {
      home: 0,
      away: 0,
      status: { status: "uncertain" as const, value: "provisional", confidence: 0.6 },
    },
    possession: { status: "uncertain" as const, value: { entityId: "pA" }, confidence: 0.5 },
    eventTaxonomyVersion: "1",
  };
  const liveSnapshot: WorldSnapshot = {
    sessionId: MINI_SESSION_ID,
    schemaVersion: SCHEMA_VERSION,
    watermark: { watermarkMs: 1_000, sequence: 1 },
    entities: [entity],
    football,
    generatedAtMs: TEST_EPOCH_MS,
  };
  const replaySnapshot: WorldSnapshot = {
    sessionId: MINI_SESSION_ID,
    schemaVersion: SCHEMA_VERSION,
    watermark: { watermarkMs: 1_000, sequence: 1 },
    entities: [entity],
    football,
    generatedAtMs: REPLAY_GENERATED_AT_MS,
  };
  const event = {
    eventId: "fe-ceu-ec-1",
    sessionId: MINI_SESSION_ID,
    schemaVersion: SCHEMA_VERSION,
    eventTypeRef: "football/v1/pass",
    interval: { startTimeMs: 1_000, endTimeMs: 1_000 },
    eventTimeMs: 1_000,
    provenance: "DERIVED" as const,
    confidence: 0.9,
    evidence: { observationIds: ["ceu-ec-1"], reportedBy: "commentary" },
  };
  const entry: WorldEventStreamEntry = {
    sequence: 1,
    snapshotVersionAfter: 2,
    event,
  };
  return {
    artifactSchema: ARTIFACT_SCHEMA,
    fixtureId: "w403-mini-fixture",
    fixtureSha256: "ab".repeat(32),
    fusion: {
      first: report({
        entitiesUpserted: 1,
        eventsApplied: 1,
        clockPatches: 1,
        conflicts: [possessionConflict()],
        snapshotVersionAfter: 3,
        warnings: ['dropped 1 "other" commentary candidate(s)'],
      }),
      refusion: report({ eventsDeduplicated: 1, snapshotVersionAfter: 3 }),
    },
    stateAt: { "1000": liveSnapshot },
    eventWindow: { fromMs: 0, toMs: 2_000, entries: [entry] },
    replay: {
      eventsApplied: 1,
      correctionsApplied: 0,
      supersededSkipped: 0,
      correctionsOrphaned: 0,
      duplicatesSkipped: 0,
      limits: { maxEvents: 10, maxSpanMs: 2_000, checkpointEveryMs: 1_000 },
      checkpoints: [replaySnapshot],
      final: replaySnapshot,
    },
  };
}
