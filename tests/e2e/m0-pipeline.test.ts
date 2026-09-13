/**
 * M0 pipeline e2e — the vertical contract slice (W003 harness template).
 *
 * One deterministic walk through the public package APIs, from an authorized
 * media session to a replayed event stream:
 *
 *   1. rights + session lifecycle:  created -> authorized -> ingesting
 *   2. deterministic observations -> ObservationStore
 *   3. EventDerivationService: derived event with evidence links
 *   4. WorldModelEngine: entities, event application, snapshots
 *   5. assertions: watermarks, versions, provenance, uncertainty, replay
 *
 * HARNESS RULES (docs/testing/HARNESS.md — this file is the template):
 *
 * - every random value comes from `@sporta/testing` seeded builders —
 *   no `Math.random`, no `Date.now`; every time is an explicit ms constant;
 * - only PUBLIC package APIs are exercised (`@sporta/testing`,
 *   `@sporta/session`, `@sporta/observation`, `@sporta/world-model`);
 * - the whole slice is one linear story: each section consumes the previous
 *   section's output, the way the real pipeline would.
 */
import { describe, expect, test } from "bun:test";
import {
  EventDerivationService,
  InMemoryObservationStore,
  MISSING_CONFIDENCE_DEFAULT,
  ReplayLog,
  replayDeterministic,
} from "@sporta/observation";
import { RightsDeniedError, SessionLifecycle } from "@sporta/session";
import { WorldModelEngine, auditTrail, uncertain, unknownValue } from "@sporta/world-model";
import {
  TEST_EPOCH_MS,
  buildAuthorizationPolicy,
  buildMediaSession,
  buildWorldSnapshot,
  observationTimeline,
  seedFromString,
} from "@sporta/testing";
import type { Observation, WorldEntity } from "@sporta/contracts";

// --- Fixed slice constants -------------------------------------------------

/** Named seed: every builder below draws from this one reproducible seed. */
const E2E_SEED = seedFromString("m0-e2e");
const SESSION_ID = "sess-m0-e2e";
const POLICY_ID = "policy-m0-e2e";
const SOURCE_ID = "src-m0-cam-1";

/** Deterministic observation timeline: 12 observations, one per second. */
const TIMELINE_COUNT = 12;
const TIMELINE_STEP_MS = 1_000;

/** Mid-timeline snapshot position (between the player and ball updates). */
const T_SNAPSHOT_MS = 2_000;

/** The goal under test: seen between 2.0s and 2.5s on the canonical timeline. */
const GOAL_START_MS = 2_000;
const GOAL_END_MS = 2_500;

describe("M0 pipeline e2e: session -> observations -> derived event -> world model", () => {
  test("full deterministic slice through the public package APIs", () => {
    // -----------------------------------------------------------------------
    // Section 1 — rights + session lifecycle (fail-closed authorization).
    // -----------------------------------------------------------------------

    // An explicit, currently-valid policy: analysis authorizes the session,
    // transformation/storage are the operations later stages rely on.
    const policy = buildAuthorizationPolicy(
      {
        policyId: POLICY_ID,
        allowedOperations: ["analysis", "transformation", "storage"],
      },
      E2E_SEED,
    );

    // A fresh session in `created`, whose declared source references the same
    // policy at the ingestion boundary (rights metadata travels with media).
    const created = buildMediaSession(
      {
        sessionId: SESSION_ID,
        authorizationPolicyId: POLICY_ID,
        sources: [
          {
            sourceId: SOURCE_ID,
            kind: "file",
            container: "mp4",
            videoStreams: 1,
            audioStreams: 1,
            durationMs: 60_000,
            declaredRightsPolicyId: POLICY_ID,
          },
        ],
      },
      E2E_SEED,
    );
    expect(created.status).toBe("created");

    // Fixed wall clock: expiry checks and transition timestamps are explicit.
    const NOW = new Date(TEST_EPOCH_MS);
    const lifecycle = new SessionLifecycle({ now: () => NOW });

    // Fail-closed first: with no policy presented, authorization DENIES and
    // the session is not advanced (architecture-lock §11).
    expect(() =>
      new SessionLifecycle({ now: () => NOW }).transition(created, "authorized"),
    ).toThrow(RightsDeniedError);
    expect(created.status).toBe("created");

    // Rights ok: the declared policy authorizes `analysis`.
    const authorized = lifecycle.transition(created, "authorized", { policy });
    expect(authorized.status).toBe("authorized");
    expect(authorized.processingState.stage).toBe("authorized");

    // Ingestion begins.
    const ingesting = lifecycle.transition(authorized, "ingesting");
    expect(ingesting.status).toBe("ingesting");
    expect(ingesting.sessionId).toBe(SESSION_ID);

    // -----------------------------------------------------------------------
    // Section 2 — deterministic observation timeline -> ObservationStore.
    // -----------------------------------------------------------------------

    const observations = observationTimeline({
      count: TIMELINE_COUNT,
      fromMs: 0,
      stepMs: TIMELINE_STEP_MS,
      sessionId: SESSION_ID,
      seed: E2E_SEED,
    });
    expect(observations).toHaveLength(TIMELINE_COUNT);

    const observationAt = (index: number): Observation => {
      const observation = observations[index];
      if (observation === undefined) {
        throw new Error(`fixture observation ${index} missing from the timeline`);
      }
      return observation;
    };

    const store = new InMemoryObservationStore();
    for (const observation of observations) {
      expect(store.append(observation)).toBe("appended");
    }
    expect(store.count()).toBe(TIMELINE_COUNT);

    // Re-delivering a known observation is an idempotent no-op (duplicate
    // tolerance per the streaming contract).
    expect(store.append(observationAt(0))).toBe("duplicate");
    expect(store.count()).toBe(TIMELINE_COUNT);

    // -----------------------------------------------------------------------
    // Section 3 — derived event with evidence links (EventDerivationService).
    // -----------------------------------------------------------------------

    const derivation = new EventDerivationService(store);

    // The goal is evidenced by the metadata observation at 2.0s and the
    // vision observation at 3.0s.
    const evidenceIds = [observationAt(2).observationId, observationAt(3).observationId];
    const goalDerivation = {
      sessionId: SESSION_ID,
      eventId: "evt-m0-goal",
      eventTypeRef: "football/v1/goal",
      interval: { startTimeMs: GOAL_START_MS, endTimeMs: GOAL_END_MS },
      eventTimeMs: GOAL_END_MS,
      evidence: { observationIds: evidenceIds },
    };

    const goalEvent = derivation.deriveEvent(goalDerivation);
    expect(goalEvent.provenance).toBe("DERIVED");
    expect(goalEvent.evidence.observationIds).toEqual(evidenceIds);
    expect(goalEvent.sessionId).toBe(SESSION_ID);

    // Min-confidence propagation: the derived event carries the MINIMUM of
    // its supporting observation confidences (absent counts as 0.5).
    const expectedConfidence = Math.min(
      ...evidenceIds.map((id) => store.byId(id)?.confidence ?? MISSING_CONFIDENCE_DEFAULT),
    );
    expect(goalEvent.confidence).toBe(expectedConfidence);

    // A versioned correction of the goal: an explicit derivation-rule
    // confidence REPLACES the computed minimum (documented W005 semantics).
    const goalCorrection = derivation.deriveEvent({
      ...goalDerivation,
      eventId: "evt-m0-goal-v2",
      correctionOf: "evt-m0-goal",
      confidence: 0.95,
    });
    expect(goalCorrection.correctionOf).toBe("evt-m0-goal");
    expect(goalCorrection.confidence).toBe(0.95);

    // -----------------------------------------------------------------------
    // Section 4 — apply observations/events into the WorldModelEngine.
    // -----------------------------------------------------------------------

    // Fixed `now` for snapshot generation (no wall clock reads).
    const FIXED_NOW = (): number => TEST_EPOCH_MS;

    // The initial football extension state comes from the same seeded
    // snapshot fixture (the football state carries no session binding).
    const snapshotFixture = buildWorldSnapshot(undefined, E2E_SEED);
    const initialFootball = snapshotFixture.football;
    if (initialFootball === undefined) {
      throw new Error("fixture snapshot is missing its football state");
    }

    const engine = WorldModelEngine.create(SESSION_ID, {
      now: FIXED_NOW,
      football: initialFootball,
    });

    // 4a. Entities from the observation timeline. The engine owns versioning:
    // a first insert stores version 1 whatever the incoming version says.
    const ball: WorldEntity = {
      entityId: "ball-1",
      kind: "ball",
      version: 1,
      lastEventTimeMs: 1_000,
      state: { pitchPosition: uncertain({ x: 52.5, y: 34 }, 0.8) },
    };
    expect(engine.upsertEntity(ball).version).toBe(1);

    // An update increments the entity version (1 -> 2).
    const ballV2 = engine.upsertEntity({
      ...ball,
      lastEventTimeMs: 4_000,
      state: { pitchPosition: uncertain({ x: 60, y: 30 }, 0.75) },
    });
    expect(ballV2.version).toBe(2);
    expect(ballV2.lastEventTimeMs).toBe(4_000);

    // The tracked player's position is NOT established yet: the unset field
    // is `unknown`, never an invented position (architecture-lock §4).
    engine.upsertEntity({
      entityId: "player-7",
      kind: "participant",
      version: 1,
      lastEventTimeMs: 1_500,
      state: { pitchPosition: unknownValue() },
    });

    // 4b. Snapshot at T=2s: the ball's 4s update is in the future, so only
    // the player is included; the watermark reflects exactly what is in.
    const atT = engine.snapshot(T_SNAPSHOT_MS);
    expect(atT.entities.map((entity) => entity.entityId)).toEqual(["player-7"]);
    expect(atT.entities[0]?.state.pitchPosition?.status).toBe("unknown");
    expect(atT.watermark).toEqual({ watermarkMs: 1_500, sequence: 0 });

    // 4c. Apply the derived event, then its correction (versioned supersession
    // bumps the affected entity's version 2 -> 3, history stays queryable).
    const goalEntry = engine.applyEvent(goalEvent, { affectedEntityIds: ["ball-1"] });
    expect(goalEntry.sequence).toBe(1);
    expect(goalEntry.event.eventId).toBe("evt-m0-goal");

    const correctionEntry = engine.applyEvent(goalCorrection, {
      affectedEntityIds: ["ball-1"],
    });
    expect(correctionEntry.sequence).toBe(2);
    expect(correctionEntry.event.correctionOf).toBe("evt-m0-goal");
    expect(engine.entityAt("ball-1")?.version).toBe(3);

    // 4d. Football state updates keep uncertainty explicit: a score change
    // without confidence stays `unknown` (the engine never fabricates
    // certainty); possession is a candidate with confidence.
    engine.setScore(1, 0);
    engine.setPossession("player-7", 0.7);

    // 4e. Final snapshot: everything is in; the watermark is the max included
    // event time and the log's sequence high-water.
    const finalSnapshot = engine.snapshot();
    expect(finalSnapshot.sessionId).toBe(SESSION_ID);
    expect(finalSnapshot.watermark).toEqual({ watermarkMs: 4_000, sequence: 2 });

    const finalEntities = new Map(
      finalSnapshot.entities.map((entity) => [entity.entityId, entity]),
    );
    expect(finalEntities.get("ball-1")?.version).toBe(3);
    expect(finalEntities.get("player-7")?.state.pitchPosition?.status).toBe("unknown");
    expect(finalSnapshot.football?.score).toEqual({
      home: 1,
      away: 0,
      status: { status: "unknown" },
    });
    expect(finalSnapshot.football?.possession.status).toBe("uncertain");
    expect(finalSnapshot.generatedAtMs).toBe(TEST_EPOCH_MS);

    // The audit trail summarizes engine state for observability (W007 hook).
    const trail = auditTrail(engine);
    expect(trail.events).toBe(2);
    expect(trail.entities.find((entity) => entity.entityId === "ball-1")?.version).toBe(3);

    // -----------------------------------------------------------------------
    // Section 5 — replay determinism (re-derive yields identical events).
    // -----------------------------------------------------------------------

    const replayLog = new ReplayLog();
    replayLog.append(goalEvent);
    replayLog.append(goalCorrection);

    const replay = replayDeterministic(replayLog, store);
    expect(replay.deterministic).toBe(true);
    expect(replay.skipped).toEqual([]);

    // The correction supersedes the original in the effective sequence; the
    // superseded envelope is preserved, never dropped silently.
    expect(replay.events).toEqual([goalCorrection]);
    expect(replay.superseded).toEqual([goalEvent]);

    // Re-deriving from the same inputs yields the identical envelope:
    // derivation is a pure function of (store, inputs).
    expect(derivation.deriveEvent(goalDerivation)).toEqual(goalEvent);
    expect(derivation.deriveEvent(goalDerivation)).toEqual(goalEvent);
  });
});
