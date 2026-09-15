/**
 * Shared inline typed fixtures for the W403 unit tests (HARNESS.md: "small
 * helpers.ts factories next to the tests they serve, with only the fields
 * under test varied"). Every factory returns a CONTRACT-VALID
 * `WorldSnapshot` (validated through the `WorldSnapshot` zod schema, so an
 * invalid variation fails loud) with hand-computable constants — no RNG,
 * no clock reads. `makeSnapshot` takes targeted variations and builds a
 * FRESH object per call (tests never share mutable state).
 */
import { SCHEMA_VERSION, WorldSnapshot } from "@sporta/contracts";
import type { WorldSnapshot as WorldSnapshotDoc } from "@sporta/contracts";

/** The base snapshot's single tracked entity id. */
export const BASE_ENTITY_ID = "t1";

/** Base clock position used by every hand-built snapshot (an explicit ms constant). */
export const BASE_TIME_MS = 1_000;

/** Base generatedAtMs (an explicit constant, NOT a clock read). */
export const BASE_GENERATED_AT_MS = 1_736_164_800_000;

/** Targeted variations over the base snapshot (all optional). */
export interface SnapshotVariation {
  sessionId?: string;
  watermarkMs?: number;
  watermarkSequence?: number;
  entityVersion?: number;
  lastEventTimeMs?: number;
  positionX?: number;
  positionY?: number;
  positionStatus?: "known" | "unknown" | "uncertain";
  positionConfidence?: number;
  lastSeenMs?: number;
  extraEntityId?: string;
  dropEntity?: boolean;
  dropFootball?: boolean;
  clockPeriod?: "first-half" | "second-half" | "post-match";
  clockMs?: number;
  scoreHome?: number;
  possessionConfidence?: number;
  generatedAtMs?: number;
}

/**
 * Builds a fresh contract-valid snapshot with the given variations applied.
 * The base entity's position starts at (0, 0) with confidence 0 and its
 * `lastSeenMs`/times at {@link BASE_TIME_MS} — exact-zero bases so
 * epsilon-boundary tests can add EXACT deltas (e.g. `positionX: 1e-9`
 * differs from 0 by exactly the default position epsilon).
 */
export function makeSnapshot(variation: SnapshotVariation = {}): WorldSnapshotDoc {
  const entities = [
    {
      entityId: BASE_ENTITY_ID,
      kind: "participant",
      version: variation.entityVersion ?? 2,
      lastEventTimeMs: variation.lastEventTimeMs ?? BASE_TIME_MS,
      state: {
        position: {
          status: variation.positionStatus ?? "uncertain",
          value: { x: variation.positionX ?? 0, y: variation.positionY ?? 0 },
          confidence: variation.positionConfidence ?? 0,
        },
        lastSeenMs: { status: "known", value: variation.lastSeenMs ?? BASE_TIME_MS },
      },
    },
    ...(variation.extraEntityId !== undefined
      ? [
          {
            entityId: variation.extraEntityId,
            kind: "ball",
            version: 1,
            lastEventTimeMs: BASE_TIME_MS,
            state: { position: { status: "uncertain", value: { x: 1, y: 1 } } },
          },
        ]
      : []),
  ];
  return WorldSnapshot.parse({
    sessionId: variation.sessionId ?? "w403-compare-test",
    schemaVersion: SCHEMA_VERSION,
    watermark: {
      watermarkMs: variation.watermarkMs ?? BASE_TIME_MS,
      sequence: variation.watermarkSequence ?? 2,
    },
    ...(variation.dropEntity ? { entities: [] } : { entities }),
    ...(variation.dropFootball
      ? {}
      : {
          football: {
            pitch: {
              lengthAxisMeters: 105,
              widthAxisMeters: 68,
              origin: "corner",
              axes: "x=touchline, y=goal-line",
            },
            clock: {
              period: variation.clockPeriod ?? "first-half",
              clockMs: variation.clockMs ?? BASE_TIME_MS,
              stoppage: false,
            },
            score: {
              home: variation.scoreHome ?? 1,
              away: 0,
              status: { status: "uncertain", value: "provisional", confidence: 0 },
            },
            possession: {
              status: "uncertain",
              value: { entityId: BASE_ENTITY_ID },
              confidence: variation.possessionConfidence ?? 0,
            },
            eventTaxonomyVersion: "v1",
          },
        }),
    generatedAtMs: variation.generatedAtMs ?? BASE_GENERATED_AT_MS,
  });
}
