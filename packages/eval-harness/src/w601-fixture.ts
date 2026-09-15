/**
 * The W601 scene-conformance fixture builder (W801 harness case input).
 *
 * This is a REPLICATION, in this package, of the scene-projection package's
 * golden-fixture construction (`packages/scene-projection/test/helpers.ts`) —
 * the same pattern the W503 evaluator used for the W502 clip ("the package's
 * own test helpers are NOT importable from src (test-only), so the fixture
 * construction is replicated here verbatim"). The entities, football state,
 * event log, and camera-slot selection are byte-for-byte the W601 golden
 * fixture's: one real `WorldModelEngine` (W006, injected clock TEST_EPOCH_MS)
 * accumulates the hand-authored entities and events, and the engine's own
 * snapshot + event log are the projection input.
 *
 * The suite's case input is the CHECKED-IN serialization
 * (`fixtures/w601-scene-fixture.json`, written by
 * `scripts/generate-w601-fixture.ts`); this builder is the provenance
 * authority — `test/w601-fixture.test.ts` pins the file to the builder
 * (deep-equal), so neither side can drift silently.
 *
 * Deterministic: explicit constants, injected clock, seeded builders — no
 * `Math.random`, no `Date.now` (docs/testing/HARNESS.md).
 */
import type { EventEnvelope, WorldEntity, WorldSnapshot } from "@sporta/contracts";
import type { WorldEventStreamEntry } from "@sporta/contracts";
import { WorldModelEngine } from "@sporta/world-model";
import type { FootballState } from "@sporta/world-model";
import { buildEventEnvelope } from "@sporta/testing";
import { CAMERA_SLOT_IDS } from "@sporta/scene-projection";

/** The fixture session id (the W601 golden fixture's session). */
export const W601_FIXTURE_SESSION = "sess-scene-golden";

/** The injected engine clock (identical to the W601 golden fixture). */
export const W601_FIXTURE_NOW_MS = 1_736_164_800_000; // TEST_EPOCH_MS

/** The W601 golden fixture's football extension state (canonical pitch). */
const W601_FOOTBALL: FootballState = {
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
const W601_ENTITIES: WorldEntity[] = [
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

/** A valid event envelope with deterministic overrides on this session. */
function envelope(overrides: Partial<EventEnvelope>, seed: number): EventEnvelope {
  return buildEventEnvelope(
    {
      sessionId: W601_FIXTURE_SESSION,
      ...overrides,
    },
    seed,
  );
}

/** The golden event log: kickoff, pass, goal, and a correction of the goal. */
const W601_EVENTS: Array<{ event: EventEnvelope }> = [
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

/** The full projection-input fixture the W601 case evaluates. */
export interface W601SceneFixtureInput {
  readonly snapshot: WorldSnapshot;
  readonly events: readonly WorldEventStreamEntry[];
  readonly cameraSlotIds: readonly string[];
}

/**
 * Builds the W601 scene fixture deterministically: one engine, the
 * hand-authored entities in order, the football init, the four events (the
 * correction target must exist, so the goal is applied first), then the
 * engine's own latest snapshot + full event log — the W601 golden-fixture
 * construction, byte-for-byte.
 */
export function buildW601SceneFixture(): W601SceneFixtureInput {
  const engine = WorldModelEngine.create(W601_FIXTURE_SESSION, {
    now: () => W601_FIXTURE_NOW_MS,
    football: W601_FOOTBALL,
  });
  for (const entity of W601_ENTITIES) {
    engine.upsertEntity(entity);
  }
  const events: WorldEventStreamEntry[] = [];
  for (const { event } of W601_EVENTS) {
    events.push(engine.applyEvent(event));
  }
  return {
    snapshot: engine.snapshot(),
    events,
    cameraSlotIds: [...CAMERA_SLOT_IDS],
  };
}
