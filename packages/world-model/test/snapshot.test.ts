import { describe, expect, test } from "bun:test";
import { SCHEMA_VERSION, WorldSnapshot } from "@sporta/contracts";
import {
  InvalidTimelineQueryError,
  WorldModelEngine,
  known,
  type FootballState,
} from "../src/index";
import { SESSION_ID, makeEntity, makeEvent, makeFootballState } from "./helpers";

describe("snapshot basics", () => {
  test("an empty engine produces a valid empty snapshot", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { now: () => 42 });
    const snap = engine.snapshot();
    expect(snap.sessionId).toBe(SESSION_ID);
    expect(snap.schemaVersion).toBe(SCHEMA_VERSION);
    expect(snap.entities).toEqual([]);
    expect(snap.football).toBeUndefined();
    expect(snap.watermark).toEqual({ watermarkMs: 0, sequence: 0 });
    expect(snap.generatedAtMs).toBe(42);
    expect(WorldSnapshot.safeParse(snap).success).toBe(true);
  });

  test("a populated snapshot validates against the contract", () => {
    const engine = WorldModelEngine.create(SESSION_ID, {
      football: makeFootballState(),
      now: () => 42,
    });
    engine.upsertEntity(makeEntity({ entityId: "ent_a", lastEventTimeMs: 1_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 1_500 }));
    engine.applyFootballState({
      score: { home: 1, away: 0, status: known("confirmed") },
      atMs: 2_500,
    });
    const snap = engine.snapshot();
    expect(WorldSnapshot.safeParse(snap).success).toBe(true);
    expect(snap.entities).toHaveLength(1);
    expect(snap.football?.score.home).toBe(1);
  });

  test("generatedAtMs uses the injected clock", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { now: () => 123_456 });
    expect(engine.snapshot().generatedAtMs).toBe(123_456);
    expect(engine.snapshot(1_000).generatedAtMs).toBe(123_456);
  });

  test("atMs must be a number when provided", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    expect(() => engine.snapshot(Number.NaN)).toThrow(InvalidTimelineQueryError);
    expect(() => engine.snapshot("1000" as unknown as number)).toThrow(InvalidTimelineQueryError);
  });
});

describe("snapshot entity selection", () => {
  test("latest includes all entities", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_a", lastEventTimeMs: 1_000 }));
    engine.upsertEntity(makeEntity({ entityId: "ent_b", lastEventTimeMs: 5_000 }));
    expect(engine.snapshot().entities.map((entity) => entity.entityId)).toEqual(["ent_a", "ent_b"]);
  });

  test("at-T excludes future entities", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_a", lastEventTimeMs: 1_000 }));
    engine.upsertEntity(makeEntity({ entityId: "ent_b", lastEventTimeMs: 5_000 }));
    const atT = engine.snapshot(2_000);
    expect(atT.entities.map((entity) => entity.entityId)).toEqual(["ent_a"]);
    expect(atT.entities[0]?.lastEventTimeMs).toBe(1_000);
  });

  test("at-T at zero includes only entities at timeline zero", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_z", lastEventTimeMs: 0 }));
    engine.upsertEntity(makeEntity({ entityId: "ent_nz", lastEventTimeMs: 1 }));
    expect(engine.snapshot(0).entities.map((entity) => entity.entityId)).toEqual(["ent_z"]);
  });
});

describe("snapshot watermark", () => {
  test("latest watermark is the max included time plus the current sequence", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 1_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 2_000 }));
    engine.upsertEntity(makeEntity({ entityId: "ent_w", lastEventTimeMs: 2_000 }));
    expect(engine.snapshot().watermark).toEqual({ watermarkMs: 2_000, sequence: 2 });
  });

  test("at-T watermark covers only included events and entities", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 1_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 2_000 }));
    engine.upsertEntity(makeEntity({ entityId: "ent_w", lastEventTimeMs: 2_000 }));
    expect(engine.snapshot(1_500).watermark).toEqual({ watermarkMs: 1_000, sequence: 1 });
  });

  test("entities alone produce a watermark without sequence", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_only", lastEventTimeMs: 3_000 }));
    expect(engine.snapshot().watermark).toEqual({ watermarkMs: 3_000, sequence: 0 });
    expect(engine.snapshot(1_000).watermark).toEqual({ watermarkMs: 0, sequence: 0 });
  });

  test("an out-of-order event yields the max included sequence at T", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 10_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 5_000 }));
    expect(engine.snapshot(6_000).watermark).toEqual({ watermarkMs: 5_000, sequence: 2 });
    expect(engine.snapshot().watermark).toEqual({ watermarkMs: 10_000, sequence: 2 });
  });
});

describe("snapshot football inclusion", () => {
  test("the initial football state sits at timeline zero", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    expect(engine.snapshot(0).football).toBeDefined();
    expect(engine.snapshot().football).toBeDefined();
  });

  test("a football patch moves the inclusion position", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.applyFootballState({
      score: { home: 1, away: 0, status: known("confirmed") },
      atMs: 30_000,
    });
    expect(engine.snapshot(29_999).football).toBeUndefined();
    expect(engine.snapshot(30_000).football).toBeDefined();
    expect(engine.snapshot(30_000).football?.score.home).toBe(1);
  });

  test("the football timeline contributes to the watermark", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.applyFootballState({
      score: { home: 1, away: 0, status: known("confirmed") },
      atMs: 30_000,
    });
    expect(engine.snapshot(30_000).watermark).toEqual({ watermarkMs: 30_000, sequence: 0 });
  });
});

describe("snapshot immutability", () => {
  test("the returned snapshot is deep-frozen", () => {
    const engine = WorldModelEngine.create(SESSION_ID, {
      football: makeFootballState(),
      now: () => 42,
    });
    engine.upsertEntity(makeEntity({ entityId: "ent_i" }));
    const snap = engine.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.entities)).toBe(true);
    expect(Object.isFrozen(snap.watermark)).toBe(true);
    expect(Object.isFrozen(snap.football)).toBe(true);
    expect(Object.isFrozen(snap.football?.clock)).toBe(true);
    const first = snap.entities[0];
    expect(first).toBeDefined();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.state)).toBe(true);
  });

  test("mutating the returned snapshot throws and never affects the engine", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { now: () => 42 });
    engine.upsertEntity(makeEntity({ entityId: "ent_m" }));
    const snap = engine.snapshot();
    expect(() => {
      snap.sessionId = "tamper";
    }).toThrow(TypeError);
    expect(() => {
      snap.entities = [];
    }).toThrow(TypeError);
    const first = snap.entities[0];
    if (first === undefined) throw new Error("entity expected");
    expect(() => {
      first.version = 99;
    }).toThrow(TypeError);
    expect(() => {
      first.state["teamRole"] = { status: "unknown" };
    }).toThrow(TypeError);
    // engine state is untouched: an identical snapshot is produced again
    expect(engine.snapshot()).toEqual(snap);
    // and the engine keeps working after snapshot reads
    engine.upsertEntity(makeEntity({ entityId: "ent_m2" }));
    expect(engine.snapshot().entities).toHaveLength(2);
  });

  test("mutating a football snapshot field throws", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    const snap = engine.snapshot();
    const football = snap.football;
    if (football === undefined) throw new Error("football expected");
    expect(() => {
      football.clock.clockMs = 5;
    }).toThrow(TypeError);
    expect(engine.snapshot().football?.clock.clockMs).toBe(0);
  });

  test("the engine clones the initial football state at create", () => {
    const initial = makeFootballState();
    const engine = WorldModelEngine.create(SESSION_ID, { football: initial });
    initial.clock.clockMs = 999_999;
    initial.score.home = 9;
    const football = engine.snapshot().football as FootballState;
    expect(football.clock.clockMs).toBe(0);
    expect(football.score.home).toBe(0);
  });
});
