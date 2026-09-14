/**
 * W401 §3.2 tests: track observations → versioned SWM entities, plus the
 * engine's upsert versioning semantics the projection relies on.
 */
import { describe, expect, test } from "bun:test";
import { WorldModelEngine } from "@sporta/world-model";
import { projectTrackEntity, trackSubjectKind, upsertWouldBeNoOp } from "../src/index";
import { SESSION_ID, makeEngine, makeTrackObservation } from "./helpers";

describe("trackSubjectKind", () => {
  test("resolves participant and ball refs", () => {
    expect(
      trackSubjectKind(
        makeTrackObservation({ trackId: "p1", kind: "participant", t: 1_000, x: 10, y: 20 }),
      ),
    ).toBe("participant");
    expect(
      trackSubjectKind(
        makeTrackObservation({ trackId: "b1", kind: "ball", t: 1_000, x: 10, y: 20 }),
      ),
    ).toBe("ball");
  });

  test("uses the FIRST participant-or-ball ref; other kinds never win", () => {
    const firstWinsBall = makeTrackObservation({
      trackId: "b1",
      kind: "ball",
      t: 1_000,
      x: 0,
      y: 0,
    });
    firstWinsBall.subjectEntityRefs.push({ entityId: "p1", kind: "participant" });
    expect(trackSubjectKind(firstWinsBall)).toBe("ball");

    const officialThenParticipant = makeTrackObservation({
      trackId: "p1",
      kind: "participant",
      t: 1_000,
      x: 0,
      y: 0,
    });
    officialThenParticipant.subjectEntityRefs.unshift({ entityId: "ref-1", kind: "official" });
    expect(trackSubjectKind(officialThenParticipant)).toBe("participant");
  });

  test("official-only and empty refs resolve to undefined — no kind invented", () => {
    const official = makeTrackObservation({
      trackId: "ref-1",
      kind: "official",
      t: 1_000,
      x: 0,
      y: 0,
    });
    expect(trackSubjectKind(official)).toBeUndefined();
    const empty = makeTrackObservation({
      trackId: "p1",
      kind: "participant",
      t: 1_000,
      x: 0,
      y: 0,
    });
    empty.subjectEntityRefs = [];
    expect(trackSubjectKind(empty)).toBeUndefined();
  });
});

describe("projectTrackEntity", () => {
  test("a W206-style pitch track becomes an upsert-ready participant entity", () => {
    const track = makeTrackObservation({
      trackId: "p2",
      kind: "participant",
      t: 10_000,
      x: 49,
      y: 34,
      confidence: 0.8,
    });
    const projection = projectTrackEntity(track, "pitch");
    expect(projection.fromObservationId).toBe(track.observationId);
    expect(projection.entity).toEqual({
      entityId: "p2",
      kind: "participant",
      version: 1,
      lastEventTimeMs: 10_000,
      state: {
        position: { status: "uncertain", value: { x: 49, y: 34 }, confidence: 0.8 },
        spatialFrame: { status: "known", value: "pitch" },
        lastSeenMs: { status: "known", value: 10_000 },
      },
    });
  });

  test("a confidence-absent observation stays uncertain WITHOUT confidence", () => {
    const track = makeTrackObservation({
      trackId: "p1",
      kind: "participant",
      t: 1_000,
      x: 1,
      y: 2,
    });
    const { state } = projectTrackEntity(track, "pitch").entity;
    const position = state.position as { status: string; value?: unknown; confidence?: number };
    expect(position).toEqual({ status: "uncertain", value: { x: 1, y: 2 } });
    expect("confidence" in position).toBe(false);
  });

  test("a ball-kind ref projects a ball entity; the caller states the frame", () => {
    const ball = makeTrackObservation({
      trackId: "b1",
      kind: "ball",
      t: 5_000,
      x: 50,
      y: 34,
      confidence: 0.9,
    });
    const pitchBall = projectTrackEntity(ball, "pitch");
    expect(pitchBall.entity.kind).toBe("ball");
    expect(pitchBall.entity.state.spatialFrame).toEqual({ status: "known", value: "pitch" });

    const imageBall = projectTrackEntity(ball, "image");
    expect(imageBall.entity.state.spatialFrame).toEqual({ status: "known", value: "image" });
  });

  test("a velocity payload key is IGNORED (later fusion stages own velocity)", () => {
    const track = makeTrackObservation({
      trackId: "p1",
      kind: "participant",
      t: 1_000,
      x: 3,
      y: 4,
      confidence: 0.5,
    });
    track.payload = {
      kind: "track",
      entityId: "p1",
      position: { x: 3, y: 4 },
      velocity: { vx: 1, vy: 2 },
    };
    const { state } = projectTrackEntity(track, "pitch").entity;
    expect(Object.keys(state).sort()).toEqual(["lastSeenMs", "position", "spatialFrame"]);
  });

  test("lastSeenMs is the SESSION-timeline eventTimeMs (known)", () => {
    const track = makeTrackObservation({
      trackId: "p1",
      kind: "participant",
      t: 42_000,
      x: 0,
      y: 0,
    });
    expect(projectTrackEntity(track, "pitch").entity.state.lastSeenMs).toEqual({
      status: "known",
      value: 42_000,
    });
  });

  test("throws on non-track payloads and non-projectable subject kinds", () => {
    const nonTrack = makeTrackObservation({
      trackId: "p1",
      kind: "participant",
      t: 1_000,
      x: 0,
      y: 0,
    });
    nonTrack.payload = {
      kind: "detection",
      box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      label: "player",
    };
    expect(() => projectTrackEntity(nonTrack, "pitch")).toThrow(RangeError);

    const official = makeTrackObservation({
      trackId: "ref-1",
      kind: "official",
      t: 1_000,
      x: 0,
      y: 0,
    });
    expect(() => projectTrackEntity(official, "pitch")).toThrow(RangeError);
  });
});

describe("engine upsert versioning (W006 semantics the projection relies on)", () => {
  test("the engine owns versions: insert at 1, update bumps; time stays monotonic", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    const first = projectTrackEntity(
      makeTrackObservation({
        trackId: "p1",
        kind: "participant",
        t: 1_000,
        x: 10,
        y: 10,
        confidence: 0.9,
      }),
      "pitch",
    ).entity;
    const stored = engine.upsertEntity(first);
    expect(stored.version).toBe(1);

    const second = projectTrackEntity(
      makeTrackObservation({
        trackId: "p1",
        kind: "participant",
        t: 2_000,
        x: 11,
        y: 10,
        confidence: 0.9,
      }),
      "pitch",
    ).entity;
    const updated = engine.upsertEntity(second);
    expect(updated.version).toBe(2);
    expect(updated.lastEventTimeMs).toBe(2_000);

    // A regressing projection is clamped by the engine — never moved back.
    const regressing = projectTrackEntity(
      makeTrackObservation({
        trackId: "p1",
        kind: "participant",
        t: 1_500,
        x: 10.5,
        y: 10,
        confidence: 0.9,
      }),
      "pitch",
    ).entity;
    const clamped = engine.upsertEntity(regressing);
    expect(clamped.version).toBe(3);
    expect(clamped.lastEventTimeMs).toBe(2_000);
  });
});

describe("upsertWouldBeNoOp (the fusion's re-fusion guard)", () => {
  const base = projectTrackEntity(
    makeTrackObservation({
      trackId: "p1",
      kind: "participant",
      t: 2_000,
      x: 11,
      y: 10,
      confidence: 0.9,
    }),
    "pitch",
  ).entity;

  test("no existing entity is always an upsert", () => {
    expect(upsertWouldBeNoOp(undefined, base)).toBe(false);
  });

  test("a strictly LATER installed state is never rewound", () => {
    const later = { ...base, lastEventTimeMs: 3_000, version: 4 };
    expect(upsertWouldBeNoOp(later, base)).toBe(true);
  });

  test("the same time and identical state is a re-application no-op", () => {
    expect(upsertWouldBeNoOp({ ...base, version: 7 }, base)).toBe(true);
  });

  test("the same time with different state is applied (last writer wins in order)", () => {
    const different = {
      ...base,
      state: { ...base.state, position: { status: "uncertain" as const, value: { x: 99, y: 10 } } },
    };
    expect(upsertWouldBeNoOp(different, base)).toBe(false);
  });

  test("an EARLIER installed state is updated", () => {
    const earlier = { ...base, lastEventTimeMs: 1_000, version: 1 };
    expect(upsertWouldBeNoOp(earlier, base)).toBe(false);
  });
});

describe("makeEngine fixture sanity", () => {
  test("engines carry the fixed wall clock (deterministic generatedAtMs)", () => {
    const engine = makeEngine();
    expect(engine.sessionId).toBe(SESSION_ID);
    expect(engine.snapshot().generatedAtMs).toBe(1_736_164_800_000);
  });
});
