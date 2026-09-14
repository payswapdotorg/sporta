/**
 * Deterministic fixture builders for the scene-projection tests (W601).
 *
 * The GOLDEN fixture story: a real `WorldModelEngine` (W006, injected clock
 * `TEST_EPOCH_MS`) accumulates entities + football state + events, exactly
 * like the m1/m2 demo posture — the engine's own snapshot + event log are
 * the projection input. Every value is an explicit constant; entity ids and
 * time positions are hand-authored for legibility (the engine owns
 * versioning); events are built with the `@sporta/testing`
 * `buildEventEnvelope` builder (seeded, deterministic). No `Math.random`, no
 * `Date.now` (docs/testing/HARNESS.md).
 *
 * `buildGoldenFixture()` returns the full projection input triple
 * (snapshot, events, options) so every test file can re-derive the exact
 * same scene.
 */
import { EventEnvelope, WorldEntity, type WorldSnapshot } from "@sporta/contracts";
import type { WorldEventStreamEntry } from "@sporta/contracts";
import { WorldModelEngine } from "@sporta/world-model";
import type { FootballState } from "@sporta/world-model";
import { buildEventEnvelope } from "@sporta/testing";
import { CAMERA_SLOT_IDS } from "../src/constants";
import { projectScene } from "../src/project";
import type { ProjectionOptions } from "../src/project";
import type { SceneSpecification } from "../src/schema";

/** The golden fixture's session id (hand-authored, like the m2/m3 demos). */
export const GOLDEN_SESSION = "sess-scene-golden";

/** The injected engine clock (docs/testing/HARNESS.md — never a real clock). */
export const GOLDEN_NOW_MS = 1_736_164_800_000; // TEST_EPOCH_MS

/** A valid event envelope with deterministic overrides on this session. */
function envelope(overrides: Partial<EventEnvelope>, seed: number): EventEnvelope {
  return buildEventEnvelope(
    {
      sessionId: GOLDEN_SESSION,
      ...overrides,
    },
    seed,
  );
}

/** The golden fixture's football extension state (canonical pitch). */
const GOLDEN_FOOTBALL: FootballState = {
  pitch: {
    lengthAxisMeters: 105,
    widthAxisMeters: 68,
    origin: "corner",
    axes: "x=touchline, y=goal-line",
  },
  clock: { period: "second-half", clockMs: 2_704_000, stoppage: false },
  score: { home: 2, away: 1, status: { status: "known", value: "confirmed" } },
  possession: { status: "uncertain", value: { entityId: "striker-9" }, confidence: 0.72 },
  eventTaxonomyVersion: "v1",
};

/** The golden entity upserts, in insertion order (ids hand-authored). */
const GOLDEN_ENTITIES: WorldEntity[] = [
  {
    // A canonical builder-shaped participant: pitchPosition (uncertain, conf).
    entityId: "striker-9",
    kind: "participant",
    version: 1,
    lastEventTimeMs: 10_000,
    state: {
      pitchPosition: { status: "uncertain", value: { x: 47.5, y: 30.25 }, confidence: 0.83 },
      heading: { status: "known", value: 1.25 },
    },
  },
  {
    // A participant at the pitch boundary edge (x = 105 inclusive → projected).
    entityId: "winger-7",
    kind: "participant",
    version: 1,
    lastEventTimeMs: 10_000,
    state: {
      pitchPosition: { status: "uncertain", value: { x: 105, y: 61.75 }, confidence: 0.77 },
    },
  },
  {
    // A fusion-shaped participant (W401): position + spatialFrame "pitch".
    entityId: "keeper-1",
    kind: "participant",
    version: 1,
    lastEventTimeMs: 9_500,
    state: {
      position: { status: "uncertain", value: { x: 5.25, y: 34 }, confidence: 0.64 },
      spatialFrame: { status: "known", value: "pitch" },
      lastSeenMs: { status: "known", value: 9_500 },
    },
  },
  {
    // An official on the pitch (projectable kind, position known, no confidence).
    entityId: "ref-1",
    kind: "official",
    version: 1,
    lastEventTimeMs: 10_000,
    state: {
      pitchPosition: { status: "known", value: { x: 52.5, y: 42.5 } },
    },
  },
  {
    // A participant with NO position slots at all (only a team role).
    entityId: "bench-12",
    kind: "participant",
    version: 1,
    lastEventTimeMs: 10_000,
    state: { teamRole: { status: "known", value: "goalkeeper" } },
  },
  {
    // A participant whose pitchPosition slot is unknown (unset, never invented).
    entityId: "injured-3",
    kind: "participant",
    version: 1,
    lastEventTimeMs: 4_000,
    state: { pitchPosition: { status: "unknown" } },
  },
  {
    // A participant whose pitchPosition value is not a finite {x, y} pair.
    entityId: "lost-4",
    kind: "participant",
    version: 1,
    lastEventTimeMs: 10_000,
    state: { pitchPosition: { status: "uncertain", value: "somewhere", confidence: 0.4 } },
  },
  {
    // A participant with an image-framed fusion position (honest non-projection).
    entityId: "img-5",
    kind: "participant",
    version: 1,
    lastEventTimeMs: 10_000,
    state: {
      position: { status: "uncertain", value: { x: 0.42, y: 0.67 }, confidence: 0.5 },
      spatialFrame: { status: "known", value: "image" },
    },
  },
  {
    // A participant OUT of bounds: TRUE coordinates kept, never clamped.
    entityId: "outlier-8",
    kind: "participant",
    version: 1,
    lastEventTimeMs: 10_000,
    state: {
      pitchPosition: { status: "uncertain", value: { x: 112.5, y: 34 }, confidence: 0.55 },
    },
  },
  {
    // THE ball: pitchPosition + a known height (z = 1.5) + heading candidate.
    entityId: "ball-1",
    kind: "ball",
    version: 1,
    lastEventTimeMs: 10_000,
    state: {
      pitchPosition: { status: "uncertain", value: { x: 52.5, y: 33.5 }, confidence: 0.91 },
      height: { status: "known", value: 1.5 },
      heading: { status: "uncertain", value: 3.9269908169872414, confidence: 0.3 },
    },
  },
  {
    // A camera entity (not-projected-kind: a source position is not pitch-plane data).
    entityId: "camera-a",
    kind: "camera",
    version: 1,
    lastEventTimeMs: 10_000,
    state: { position: { status: "known", value: { x: -20, y: 34 } } },
  },
  {
    // A team entity (not-projected-kind, empty state).
    entityId: "team-home",
    kind: "team",
    version: 1,
    lastEventTimeMs: 0,
    state: {},
  },
];

/** The golden event log: kickoff, pass, goal, and a correction of the goal. */
const GOLDEN_EVENTS: Array<{ event: EventEnvelope; affected?: string[] }> = [
  {
    event: envelope(
      {
        eventId: "fe-golden-1",
        eventTypeRef: "football/v1/kickoff",
        eventTimeMs: 1_000,
        interval: { startTimeMs: 900, endTimeMs: 1_000 },
        confidence: 0.9,
      },
      11,
    ),
  },
  {
    event: envelope(
      {
        eventId: "fe-golden-2",
        eventTypeRef: "football/v1/pass",
        eventTimeMs: 2_500,
        interval: { startTimeMs: 2_400, endTimeMs: 2_500 },
        confidence: 0.85,
      },
      12,
    ),
  },
  {
    event: envelope(
      {
        eventId: "fe-golden-3",
        eventTypeRef: "football/v1/goal",
        eventTimeMs: 5_500,
        interval: { startTimeMs: 5_300, endTimeMs: 5_500 },
        confidence: 0.91,
      },
      13,
    ),
  },
  {
    event: envelope(
      {
        eventId: "fe-golden-4",
        eventTypeRef: "football/v1/referee-decision",
        eventTimeMs: 9_000,
        interval: { startTimeMs: 8_900, endTimeMs: 9_000 },
        confidence: 0.97,
        correctionOf: "fe-golden-3",
      },
      14,
    ),
  },
];

/** The full projection-input fixture: snapshot + events + options (+ engine). */
export interface GoldenFixture {
  snapshot: WorldSnapshot;
  events: WorldEventStreamEntry[];
  options: ProjectionOptions;
  /** The live engine the snapshot/events came from (the W402 caller path). */
  engine: WorldModelEngine;
}

/**
 * Builds the golden fixture deterministically: one engine, entities in the
 * documented order, football init, the four events (the correction
 * target-must-exist, so the goal is applied first), then the engine's own
 * latest snapshot + full event log.
 */
export function buildGoldenFixture(): GoldenFixture {
  const engine = WorldModelEngine.create(GOLDEN_SESSION, {
    now: () => GOLDEN_NOW_MS,
    football: GOLDEN_FOOTBALL,
  });
  for (const entity of GOLDEN_ENTITIES) {
    engine.upsertEntity(entity);
  }
  const events: WorldEventStreamEntry[] = [];
  for (const { event, affected } of GOLDEN_EVENTS) {
    events.push(engine.applyEvent(event, { affectedEntityIds: affected }));
  }
  return {
    snapshot: engine.snapshot(),
    events,
    options: { events, cameraSlotIds: CAMERA_SLOT_IDS },
    engine,
  };
}

/** The canonical order of camera slot ids (re-exported for assertions). */
export const ALL_CAMERA_SLOTS = CAMERA_SLOT_IDS;

/** The golden scene: the projection of the golden fixture (deterministic). */
export function buildGoldenScene(): SceneSpecification {
  const { snapshot, options } = buildGoldenFixture();
  return projectScene(snapshot, options);
}
