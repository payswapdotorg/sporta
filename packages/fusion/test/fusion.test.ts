/**
 * W401 §3.4 tests: the deterministic fusion pass — the e2e accept criterion
 * (versioned SWM state with provenance), conflict explicitness (the accept
 * criterion: conflicting evidence remains explicit), dedup idempotency,
 * possession math with exact numbers, and the provenance audit.
 */
import { describe, expect, test } from "bun:test";
import { WorldSnapshot } from "@sporta/contracts";
import type { Observation } from "@sporta/contracts";
import { MISSING_CONFIDENCE_DEFAULT } from "@sporta/observation";
import { buildObservation } from "@sporta/testing";
import { auditTrail, describeProvenance } from "@sporta/world-model";
import { runWorldFusion } from "../src/index";
import {
  SESSION_ID,
  buildE2EObservations,
  makeCandidateObservation,
  makeEngine,
  makeFootballState,
  makeStore,
  makeTrackObservation,
} from "./helpers";

function fuse(
  observations: readonly Observation[],
  init: Parameters<typeof makeEngine>[0] = {},
  options: { trackFrame?: "image" | "pitch"; possessionRadiusM?: number } = {},
) {
  const store = makeStore(observations);
  const engine = makeEngine(init);
  const report = runWorldFusion({
    store,
    engine,
    sessionId: SESSION_ID,
    ...(options.trackFrame !== undefined ? { trackFrame: options.trackFrame } : {}),
    ...(options.possessionRadiusM !== undefined
      ? { possessionRadiusM: options.possessionRadiusM }
      : {}),
  });
  return { store, engine, report };
}

describe("fusion e2e (accept criterion: versioned SWM state with provenance)", () => {
  const observations = buildE2EObservations();

  test("running twice on fresh engine+store copies is deep-equal (report AND snapshot)", () => {
    const first = fuse(observations, { football: makeFootballState() });
    const second = fuse(observations, { football: makeFootballState() });
    expect(first.report).toEqual(second.report);
    expect(first.engine.snapshot()).toEqual(second.engine.snapshot());
  });

  test("the report counts every pass phase exactly", () => {
    const { report } = fuse(observations, { football: makeFootballState() });
    expect(report.entitiesUpserted).toBe(40);
    expect(report.eventsApplied).toBe(3);
    expect(report.eventsDeduplicated).toBe(0);
    expect(report.clockPatches).toBe(1);
    expect(report.possessionUpdates).toBe(1);
    expect(report.conflicts).toEqual([]);
    // 1 (genesis) + 40 upserts + 3 events + 1 clock patch + 1 possession.
    expect(report.snapshotVersionAfter).toBe(46);
    expect(report.warnings).toEqual([
      'dropped 1 "other" commentary candidate(s) (insufficient specificity — they remain in ' +
        "the observation stream)",
    ]);
  });

  test("every applied event is in eventsSince(0) with evidence that resolves in the store", () => {
    const { store, engine } = fuse(observations, { football: makeFootballState() });
    const entries = engine.eventsSince(0);
    expect(entries.map((entry) => entry.event.eventId)).toEqual([
      "fe-ceu-ec-1",
      "fe-ceu-ec-2",
      "fe-ceu-ec-3",
    ]);
    expect(entries.map((entry) => entry.event.eventTypeRef)).toEqual([
      "football/v1/kickoff",
      "football/v1/pass",
      "football/v1/goal",
    ]);
    for (const entry of entries) {
      for (const observationId of entry.event.evidence.observationIds) {
        expect(store.byId(observationId)).toBeDefined();
      }
    }
  });

  test("the snapshot parses against the WorldSnapshot contract", () => {
    const { engine } = fuse(observations, { football: makeFootballState() });
    const snapshot = engine.snapshot();
    expect(WorldSnapshot.safeParse(snapshot).success).toBe(true);
    expect(snapshot.sessionId).toBe(SESSION_ID);
    expect(snapshot.football?.clock.period).toBe("post-match");
  });

  test("fulltime applied a clock patch: period post-match, stoppage cleared", () => {
    const { engine } = fuse(observations, { football: makeFootballState() });
    expect(engine.snapshot().football?.clock).toEqual({
      period: "post-match",
      clockMs: 0,
      stoppage: false,
    });
  });

  test("entities are queryable via entityAt at an eventTimeMs (W006 semantics)", () => {
    const { engine } = fuse(observations, { football: makeFootballState() });
    // Not yet seen at t=9_999 (the entity's lastEventTimeMs is 10_000).
    expect(engine.entityAt("p2", 9_999)).toBeUndefined();
    const p2 = engine.entityAt("p2", 10_000);
    expect(p2).toBeDefined();
    expect(p2!.kind).toBe("participant");
    expect(p2!.state.position).toEqual({
      status: "uncertain",
      value: { x: 49, y: 34 },
      confidence: 0.8,
    });
    expect(p2!.state.spatialFrame).toEqual({ status: "known", value: "pitch" });
    const ball = engine.entityAt("b1", 10_000);
    expect(ball!.kind).toBe("ball");
    expect(ball!.state.position).toEqual({
      status: "uncertain",
      value: { x: 50, y: 34 },
      confidence: 0.9,
    });
  });

  test("possession is set to the nearest participant with the exact product confidence", () => {
    const { engine } = fuse(observations, { football: makeFootballState() });
    // Ball (50,34) conf 0.9; nearest p2 at (49,34) conf 0.8 → distance 1,
    // radius 2: 0.9 * 0.8 * (1 - 1/2).
    expect(engine.snapshot().football?.possession).toEqual({
      status: "uncertain",
      value: { entityId: "p2" },
      confidence: 0.9 * 0.8 * (1 - 1 / 2),
    });
  });

  test("'other' is counted in warnings and NOT applied as an event", () => {
    const { engine, report } = fuse(observations, { football: makeFootballState() });
    const appliedIds = engine.eventsSince(0).map((entry) => entry.event.eventId);
    expect(appliedIds).not.toContain("fe-ceu-ec-5");
    expect(report.warnings[0]).toContain('"other"');
    expect(report.eventsApplied).toBe(3);
  });

  test("non-fusion inputs (detections, non-candidate commentary) are ignored", () => {
    const detection = buildObservation({ sessionId: SESSION_ID, eventTimeMs: 1_000 });
    const malformed: Observation = {
      ...makeCandidateObservation({ candidateId: "ec-9", eventType: "goal", t: 2_000 }),
      payload: { kind: "generic", data: { notACandidate: true } },
    };
    const { report } = fuse([...observations, detection, malformed], {
      football: makeFootballState(),
    });
    expect(report.entitiesUpserted).toBe(40);
    expect(report.eventsApplied).toBe(3);
  });
});

describe("conflict explicitness (accept criterion: no silent winner)", () => {
  function equidistantFixture() {
    return [
      makeTrackObservation({
        trackId: "p1",
        kind: "participant",
        t: 10_000,
        x: 49,
        y: 34,
        confidence: 0.8,
      }),
      makeTrackObservation({
        trackId: "p2",
        kind: "participant",
        t: 10_000,
        x: 51,
        y: 34,
        confidence: 0.7,
      }),
      makeTrackObservation({
        trackId: "b1",
        kind: "ball",
        t: 10_000,
        x: 50,
        y: 34,
        confidence: 0.9,
      }),
    ];
  }

  test("two equidistant participants → ONE possession conflict listing BOTH ids", () => {
    const { engine, report } = fuse(equidistantFixture(), { football: makeFootballState() });
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]).toEqual({
      conflictId: "cf-1",
      slotKey: "possession",
      observationIds: ["sp-f10-p1", "sp-f10-p2"],
      values: [
        { value: "p1", confidence: 0.8 },
        { value: "p2", confidence: 0.7 },
      ],
      resolution: "none",
      detectedAtMs: 10_000,
    });
    // No silent winner: the engine slot stays untouched (unknown).
    expect(report.possessionUpdates).toBe(0);
    expect(engine.snapshot().football?.possession).toEqual({ status: "unknown" });
  });

  test("rerunning on the same engine+store reproduces the identical ledger", () => {
    const store = makeStore(equidistantFixture());
    const engine = makeEngine({ football: makeFootballState() });
    const first = runWorldFusion({ store, engine, sessionId: SESSION_ID });
    const second = runWorldFusion({ store, engine, sessionId: SESSION_ID });
    expect(second.conflicts).toEqual(first.conflicts);
    expect(engine.snapshot().football?.possession).toEqual({ status: "unknown" });
    // Entities were already current — the rerun only re-detected the tie.
    expect(second.entitiesUpserted).toBe(0);
  });

  test("conflicting-clock: two fulltimes within the window AGREE (no conflict) — pinned honesty", () => {
    // The delivered W209 vocabulary derives exactly one period from
    // commentary ("post-match" via fulltime), so two fulltime candidates are
    // AGREEING evidence, not a conflict. The clock-period mechanism itself is
    // unit-pinned in conflicts.test.ts with a period-bearing valueOf.
    const observations = [
      makeCandidateObservation({
        candidateId: "ec-1",
        eventType: "fulltime",
        t: 5_400_000,
        confidence: 0.99,
      }),
      makeCandidateObservation({
        candidateId: "ec-2",
        eventType: "fulltime",
        t: 5_402_000,
        confidence: 0.98,
      }),
    ];
    const { report, engine } = fuse(observations, { football: makeFootballState() });
    expect(report.conflicts).toEqual([]);
    // The first patch installs post-match; the second is a re-application
    // no-op (period + stoppage already installed, clock monotone).
    expect(report.clockPatches).toBe(1);
    expect(engine.snapshot().football?.clock.period).toBe("post-match");
  });

  test("LateEvent warning path: a late candidate is rejected with a warning, never silent", () => {
    const goal = makeCandidateObservation({
      candidateId: "ec-1",
      eventType: "goal",
      t: 6_000_000,
      confidence: 0.9,
    });
    const store = makeStore([goal]);
    const engine = makeEngine({ football: makeFootballState() });
    const first = runWorldFusion({ store, engine, sessionId: SESSION_ID });
    expect(first.eventsApplied).toBe(1);

    // A pass candidate arrives LATE: 1_000 < high-water 6_000_000 - 5_000.
    const latePass = makeCandidateObservation({
      candidateId: "ec-2",
      eventType: "pass",
      t: 1_000,
      confidence: 0.8,
    });
    store.append(latePass);
    const second = runWorldFusion({ store, engine, sessionId: SESSION_ID });
    expect(second.eventsApplied).toBe(0);
    expect(second.eventsDeduplicated).toBe(1);
    expect(second.warnings).toEqual([
      "late event fe-ceu-ec-2 at 1000ms rejected by the engine (log high-water 6000000ms, " +
        "maxReorderMs 5000ms) — not applied",
    ]);
  });

  test("clock warning path: no football state → fulltime patch skipped with a warning", () => {
    const observations = [
      makeTrackObservation({
        trackId: "p1",
        kind: "participant",
        t: 1_000,
        x: 50,
        y: 34,
        confidence: 0.8,
      }),
      makeTrackObservation({
        trackId: "b1",
        kind: "ball",
        t: 1_000,
        x: 50,
        y: 34,
        confidence: 0.9,
      }),
      makeCandidateObservation({
        candidateId: "ec-1",
        eventType: "fulltime",
        t: 2_000,
        confidence: 0.99,
      }),
    ];
    const { report } = fuse(observations, {}); // engine WITHOUT football state
    expect(report.clockPatches).toBe(0);
    expect(report.warnings).toContain(
      "skipped 1 fulltime clock patch(es): engine carries no football state",
    );
    expect(report.warnings).toContain("possession skipped: engine carries no football state");
  });

  test("clock warning path: ClockRegressionError is caught and warned (observed W006 semantics)", () => {
    // An engine already post-match with a REAL clock (5_400_000ms): the
    // fulltime patch pins clockMs to the engine's football timeline position
    // (0), which regresses WITHIN "post-match" — W006 rejects it. The fusion
    // warns instead of silently dropping or crashing.
    const observations = [
      makeCandidateObservation({
        candidateId: "ec-1",
        eventType: "fulltime",
        t: 5_400_000,
        confidence: 0.99,
      }),
    ];
    const football = makeFootballState({
      clock: { period: "post-match", clockMs: 5_400_000, stoppage: false },
    });
    const { report, engine } = fuse(observations, { football });
    expect(report.clockPatches).toBe(0);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain("clock patch at 5400000ms rejected by the engine");
    expect(report.warnings[0]).toContain('clock cannot move backwards within period "post-match"');
    expect(engine.snapshot().football?.clock.clockMs).toBe(5_400_000);
  });
});

describe("dedup idempotency (idempotence proof)", () => {
  function idempotenceFixture() {
    return [
      makeTrackObservation({
        trackId: "p1",
        kind: "participant",
        t: 1_000,
        x: 50.65,
        y: 34,
        confidence: 0.75,
      }),
      makeTrackObservation({
        trackId: "p1",
        kind: "participant",
        t: 2_000,
        x: 50.55,
        y: 34,
        confidence: 0.75,
      }),
      makeTrackObservation({
        trackId: "p1",
        kind: "participant",
        t: 3_000,
        x: 50.5,
        y: 34,
        confidence: 0.75,
      }),
      makeTrackObservation({
        trackId: "p2",
        kind: "participant",
        t: 1_000,
        x: 58,
        y: 34,
        confidence: 0.6,
      }),
      makeTrackObservation({
        trackId: "p2",
        kind: "participant",
        t: 3_000,
        x: 58,
        y: 34,
        confidence: 0.6,
      }),
      makeTrackObservation({
        trackId: "b1",
        kind: "ball",
        t: 3_000,
        x: 50,
        y: 34,
        confidence: 0.9,
      }),
      makeCandidateObservation({
        candidateId: "ec-1",
        eventType: "kickoff",
        t: 500,
        confidence: 0.9,
      }),
      makeCandidateObservation({
        candidateId: "ec-2",
        eventType: "pass",
        t: 1_500,
        confidence: 0.8,
      }),
      makeCandidateObservation({
        candidateId: "ec-3",
        eventType: "goal",
        t: 2_500,
        confidence: 0.95,
      }),
      makeCandidateObservation({
        candidateId: "ec-4",
        eventType: "fulltime",
        t: 3_500,
        confidence: 0.99,
      }),
    ];
  }

  test("re-running on the SAME engine+store changes nothing", () => {
    const store = makeStore(idempotenceFixture());
    const engine = makeEngine({ football: makeFootballState() });
    const first = runWorldFusion({ store, engine, sessionId: SESSION_ID });
    expect(first.entitiesUpserted).toBe(6);
    expect(first.eventsApplied).toBe(3);
    expect(first.clockPatches).toBe(1);
    expect(first.possessionUpdates).toBe(1);

    const second = runWorldFusion({ store, engine, sessionId: SESSION_ID });
    expect(second.eventsDeduplicated).toBe(first.eventsApplied);
    expect(second.entitiesUpserted).toBe(0);
    expect(second.eventsApplied).toBe(0);
    expect(second.clockPatches).toBe(0);
    expect(second.possessionUpdates).toBe(0);
    expect(second.conflicts).toEqual([]); // zero new conflicts
    expect(second.snapshotVersionAfter).toBe(first.snapshotVersionAfter); // UNCHANGED
    expect(second.warnings).toEqual([]);
  });

  test("the fused state is the honest product of one pass (possession math included)", () => {
    const { engine } = fuse(idempotenceFixture(), { football: makeFootballState() });
    // Latest ball (50,34) conf 0.9; p1's latest (50.5,34) conf 0.75 → d 0.5;
    // p2 at (58,34) → d 8 (outside). Winner p1: 0.9 * 0.75 * (1 - 0.5/2).
    expect(engine.snapshot().football?.possession).toEqual({
      status: "uncertain",
      value: { entityId: "p1" },
      confidence: 0.9 * 0.75 * (1 - 0.5 / 2),
    });
  });
});

describe("possession math (exact, hand-computed)", () => {
  function possessionFixture(
    participant: { x: number; y: number; confidence?: number },
    ballConfidence?: number,
  ) {
    return [
      makeTrackObservation({
        trackId: "p1",
        kind: "participant",
        t: 1_000,
        x: participant.x,
        y: participant.y,
        ...(participant.confidence !== undefined ? { confidence: participant.confidence } : {}),
      }),
      makeTrackObservation({
        trackId: "b1",
        kind: "ball",
        t: 1_000,
        x: 50,
        y: 34,
        ...(ballConfidence !== undefined ? { confidence: ballConfidence } : {}),
      }),
    ];
  }

  test("distance 0 → the full product", () => {
    const { engine, report } = fuse(possessionFixture({ x: 50, y: 34, confidence: 0.5 }, 0.8), {
      football: makeFootballState(),
    });
    expect(report.possessionUpdates).toBe(1);
    expect(engine.snapshot().football?.possession).toEqual({
      status: "uncertain",
      value: { entityId: "p1" },
      confidence: 0.8 * 0.5 * (1 - 0 / 2),
    });
  });

  test("exactly at the radius → confidence 0", () => {
    const { engine, report } = fuse(possessionFixture({ x: 52, y: 34, confidence: 0.5 }, 0.8), {
      football: makeFootballState(),
    });
    expect(report.possessionUpdates).toBe(1);
    expect(engine.snapshot().football?.possession).toEqual({
      status: "uncertain",
      value: { entityId: "p1" },
      confidence: 0.8 * 0.5 * (1 - 2 / 2),
    });
    expect(engine.snapshot().football?.possession?.confidence).toBe(0);
  });

  test("outside the radius → no possession update at all", () => {
    const { engine, report } = fuse(possessionFixture({ x: 52.5, y: 34, confidence: 0.5 }, 0.8), {
      football: makeFootballState(),
    });
    expect(report.possessionUpdates).toBe(0);
    expect(engine.snapshot().football?.possession).toEqual({ status: "unknown" });
  });

  test("a custom radius is honored", () => {
    const { report } = fuse(
      possessionFixture({ x: 54, y: 34, confidence: 0.5 }, 0.8),
      { football: makeFootballState() },
      { possessionRadiusM: 4 },
    );
    expect(report.possessionUpdates).toBe(1);
  });

  test("missing ball/track confidences contribute W005's MISSING_CONFIDENCE_DEFAULT", () => {
    const { engine, report } = fuse(
      possessionFixture({ x: 49, y: 34 }), // no confidences anywhere
      { football: makeFootballState() },
    );
    expect(report.possessionUpdates).toBe(1);
    // distance 1, radius 2: 0.5 * 0.5 * (1 - 1/2).
    expect(engine.snapshot().football?.possession).toEqual({
      status: "uncertain",
      value: { entityId: "p1" },
      confidence: MISSING_CONFIDENCE_DEFAULT * MISSING_CONFIDENCE_DEFAULT * (1 - 1 / 2),
    });
  });

  test("image-frame ball → possession skipped with a warning", () => {
    const observations = [
      makeTrackObservation({
        trackId: "p1",
        kind: "participant",
        t: 1_000,
        x: 0.5,
        y: 0.5,
        confidence: 0.9,
      }),
      makeTrackObservation({
        trackId: "b1",
        kind: "ball",
        t: 1_000,
        x: 0.52,
        y: 0.5,
        confidence: 0.9,
      }),
    ];
    const { engine, report } = fuse(
      observations,
      { football: makeFootballState() },
      { trackFrame: "image" },
    );
    expect(report.possessionUpdates).toBe(0);
    expect(report.warnings).toEqual([
      'possession skipped: track frame is "image" (possession requires pitch meters)',
    ]);
    expect(engine.snapshot().football?.possession).toEqual({ status: "unknown" });
    // Entities are still projected — with the caller-declared image frame.
    expect(engine.entityAt("b1")?.state.spatialFrame).toEqual({ status: "known", value: "image" });
  });

  test("no ball track or no participant track → the slot stays untouched", () => {
    const onlyParticipants = fuse(
      [
        makeTrackObservation({
          trackId: "p1",
          kind: "participant",
          t: 1_000,
          x: 50,
          y: 34,
          confidence: 0.9,
        }),
      ],
      { football: makeFootballState() },
    );
    expect(onlyParticipants.report.possessionUpdates).toBe(0);
    expect(onlyParticipants.report.warnings).toEqual([]);

    const onlyBall = fuse(
      [
        makeTrackObservation({
          trackId: "b1",
          kind: "ball",
          t: 1_000,
          x: 50,
          y: 34,
          confidence: 0.9,
        }),
      ],
      { football: makeFootballState() },
    );
    expect(onlyBall.report.possessionUpdates).toBe(0);
    expect(onlyBall.report.warnings).toEqual([]);
  });
});

describe("provenance audit (W006 seam)", () => {
  test("auditTrail references every event the fusion applied", () => {
    const { engine, report } = fuse(buildE2EObservations(), { football: makeFootballState() });
    const trail = auditTrail(engine);
    expect(trail.events).toBe(report.eventsApplied);
    expect(trail.snapshotVersion).toBe(report.snapshotVersionAfter);
    expect(trail.entities.map((entity) => entity.entityId).sort()).toEqual([
      "b1",
      "p1",
      "p2",
      "p3",
    ]);
  });

  test("describeProvenance for a fused event mentions DERIVED + the evidence chain (pinned)", () => {
    const { engine } = fuse(buildE2EObservations(), { football: makeFootballState() });
    const goal = engine
      .eventsSince(0)
      .map((entry) => entry.event)
      .find((event) => event.eventId === "fe-ceu-ec-3")!;
    expect(describeProvenance(goal)).toBe(
      "event fe-ceu-ec-3 type=football/v1/goal session=sess-w401 eventTimeMs=6000 " +
        "provenance=DERIVED confidence=0.95 evidence=[ceu-ec-3] reportedBy=commentary",
    );
  });
});

describe("input validation (fail loud)", () => {
  test("a session-mismatched engine is rejected", () => {
    const store = makeStore([]);
    const engine = makeEngine();
    expect(() => runWorldFusion({ store, engine, sessionId: "sess-other" })).toThrow(RangeError);
  });

  test("a non-positive possession radius is rejected", () => {
    const store = makeStore([]);
    const engine = makeEngine();
    expect(() =>
      runWorldFusion({ store, engine, sessionId: SESSION_ID, possessionRadiusM: 0 }),
    ).toThrow(RangeError);
  });
});

describe("non-projectable tracks are skipped honestly", () => {
  test("official tracks are counted in a warning, no kind invented", () => {
    const observations = [
      makeTrackObservation({
        trackId: "p1",
        kind: "participant",
        t: 1_000,
        x: 50,
        y: 34,
        confidence: 0.9,
      }),
      makeTrackObservation({
        trackId: "ref-1",
        kind: "official",
        t: 1_000,
        x: 55,
        y: 34,
        confidence: 0.9,
      }),
    ];
    const { engine, report } = fuse(observations, { football: makeFootballState() });
    expect(report.entitiesUpserted).toBe(1);
    expect(report.warnings).toEqual([
      "skipped 1 track observation(s) without a participant/ball entity ref — no entity kind invented",
    ]);
    expect(engine.entityAt("ref-1")).toBeUndefined();
  });

  test("unmapped commentary event types are skipped with an aggregate warning", () => {
    const observations = [
      makeCandidateObservation({
        candidateId: "ec-1",
        eventType: "replay-cue",
        t: 1_000,
        confidence: 0.9,
      }),
      makeCandidateObservation({
        candidateId: "ec-2",
        eventType: "heatmap",
        t: 2_000,
        confidence: 0.9,
      }),
    ];
    const { engine, report } = fuse(observations, { football: makeFootballState() });
    expect(report.eventsApplied).toBe(0);
    expect(engine.eventsSince(0)).toEqual([]);
    expect(report.warnings).toEqual([
      "skipped 2 commentary candidate(s) with unmapped eventType: heatmap, replay-cue",
    ]);
  });
});
