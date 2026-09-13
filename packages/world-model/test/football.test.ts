import { describe, expect, test } from "bun:test";
import {
  ClockRegressionError,
  FootballStateMissingError,
  InvalidEntityIdError,
  InvalidFootballStateError,
  InvalidUncertainValueError,
  WorldModelEngine,
  auditTrail,
  known,
} from "../src/index";
import { SESSION_ID, makeFootballState } from "./helpers";

describe("football extension presence", () => {
  test("football operations require an initialized football state", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    expect(() => engine.advanceClock(0)).toThrow(FootballStateMissingError);
    expect(() => engine.setScore(1, 0)).toThrow(FootballStateMissingError);
    expect(() => engine.setPossession(null, 0.5)).toThrow(FootballStateMissingError);
    expect(() => engine.applyFootballState({ atMs: 1_000 })).toThrow(FootballStateMissingError);
  });

  test("an engine can carry only the generic world state", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    expect(engine.snapshot().football).toBeUndefined();
  });
});

describe("unset football fields are never fabricated", () => {
  test("fresh football state reads unknown for score status and possession", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    const football = engine.snapshot().football;
    expect(football?.score.status).toEqual({ status: "unknown" });
    expect(football?.possession).toEqual({ status: "unknown" });
  });
});

describe("clock (period-aware monotonicity)", () => {
  test("the clock advances forward within a period", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.advanceClock(1_800_000);
    engine.advanceClock(1_800_000); // equal is allowed
    expect(engine.snapshot().football?.clock.clockMs).toBe(1_800_000);
  });

  test("a backwards clock within the same period throws", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.advanceClock(1_800_000);
    let caught: unknown;
    try {
      engine.advanceClock(1_799_999);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ClockRegressionError);
    const clockError = caught as ClockRegressionError;
    expect(clockError.period).toBe("first-half");
    expect(clockError.currentClockMs).toBe(1_800_000);
    expect(clockError.attemptedClockMs).toBe(1_799_999);
    expect(engine.snapshot().football?.clock.clockMs).toBe(1_800_000);
  });

  test("a period change resets the clock", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.advanceClock(1_800_000, "first-half");
    engine.advanceClock(0, "second-half");
    expect(engine.snapshot().football?.clock).toEqual({
      period: "second-half",
      clockMs: 0,
      stoppage: false,
    });
    engine.advanceClock(500_000, "second-half");
    expect(() => engine.advanceClock(499_999)).toThrow(ClockRegressionError);
  });

  test("an invalid clock value is rejected by the contract", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    expect(() => engine.advanceClock(-1)).toThrow(InvalidFootballStateError);
    expect(() => engine.advanceClock(0, "third-half" as never)).toThrow(InvalidFootballStateError);
  });

  test("stoppage toggling via an applyFootballState clock patch", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.advanceClock(1_800_000);
    engine.applyFootballState({
      clock: { period: "first-half", clockMs: 1_800_000, stoppage: true },
      atMs: 30_000,
    });
    expect(engine.snapshot().football?.clock).toEqual({
      period: "first-half",
      clockMs: 1_800_000,
      stoppage: true,
    });
  });

  test("a backwards clock within the same period throws via patch", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.advanceClock(2_000);
    expect(() =>
      engine.applyFootballState({
        clock: { period: "first-half", clockMs: 1_000, stoppage: false },
        atMs: 5_000,
      }),
    ).toThrow(ClockRegressionError);
  });

  test("a period change via patch resets the clock", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.advanceClock(2_700_000);
    engine.applyFootballState({
      clock: { period: "second-half", clockMs: 0, stoppage: false },
      atMs: 45_000,
    });
    expect(engine.snapshot().football?.clock.clockMs).toBe(0);
  });
});

describe("applyFootballState patching", () => {
  test("patch fields replace only the provided keys", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.applyFootballState({
      score: { home: 1, away: 0, status: known("confirmed") },
      atMs: 10_000,
    });
    const football = engine.snapshot().football;
    expect(football?.score).toEqual({
      home: 1,
      away: 0,
      status: { status: "known", value: "confirmed" },
    });
    // untouched keys keep their values
    expect(football?.clock).toEqual({ period: "first-half", clockMs: 0, stoppage: false });
    expect(football?.possession).toEqual({ status: "unknown" });
    expect(football?.eventTaxonomyVersion).toBe("1");
  });

  test("the timeline marker moves forward monotonically", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.applyFootballState({ atMs: 30_000 });
    engine.applyFootballState({ atMs: 10_000 }); // late patch: marker stays
    expect(engine.footballTimelineMs).toBe(30_000);
  });

  test("invalid patches are rejected", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    expect(() =>
      engine.applyFootballState({
        score: { home: -1, away: 0, status: { status: "unknown" } },
        atMs: 1,
      }),
    ).toThrow(InvalidFootballStateError);
    expect(() =>
      engine.applyFootballState({
        possession: { status: "uncertain", value: { entityId: "bad id!" }, confidence: 0.5 },
        atMs: 1,
      }),
    ).toThrow(InvalidFootballStateError);
    expect(() =>
      engine.applyFootballState({
        eventTaxonomyVersion: "",
        atMs: 1,
      }),
    ).toThrow(InvalidFootballStateError);
    expect(() => engine.applyFootballState({ atMs: -1 })).toThrow(InvalidFootballStateError);
    expect(engine.snapshot().football?.score.home).toBe(0);
  });

  test("the initial state is validated at create", () => {
    expect(() =>
      WorldModelEngine.create(SESSION_ID, {
        football: makeFootballState({
          score: { home: -1, away: 0, status: { status: "unknown" } },
        }),
      }),
    ).toThrow(InvalidFootballStateError);
  });
});

describe("score", () => {
  test("setScore with confidence stores a provisional candidate", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.setScore(1, 0, { confidence: 0.7 });
    expect(engine.snapshot().football?.score).toEqual({
      home: 1,
      away: 0,
      status: { status: "uncertain", value: "provisional", confidence: 0.7 },
    });
  });

  test("setScore without confidence never fabricates a status", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.setScore(2, 1);
    expect(engine.snapshot().football?.score).toEqual({
      home: 2,
      away: 1,
      status: { status: "unknown" },
    });
  });

  test("a confirmed score is asserted explicitly via applyFootballState", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.applyFootballState({
      score: { home: 2, away: 1, status: known("confirmed") },
      atMs: 5_000,
    });
    expect(engine.snapshot().football?.score.status).toEqual({
      status: "known",
      value: "confirmed",
    });
  });

  test("every score change bumps the snapshot version (implicit scoreVersion)", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    const before = engine.snapshotVersion;
    engine.setScore(1, 0, { confidence: 0.9 });
    expect(engine.snapshotVersion).toBe(before + 1);
    expect(auditTrail(engine).snapshotVersion).toBe(before + 1);
  });

  test("invalid scores are rejected", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    expect(() => engine.setScore(-1, 0)).toThrow(InvalidFootballStateError);
    expect(() => engine.setScore(1.5, 0)).toThrow(InvalidFootballStateError);
    expect(() => engine.setScore(1, 0, { confidence: 1.2 })).toThrow(InvalidUncertainValueError);
  });
});

describe("possession", () => {
  test("null possession is valid and stored as unknown", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.setPossession("ent_001", 0.62);
    engine.setPossession(null, 0.5);
    expect(engine.snapshot().football?.possession).toEqual({ status: "unknown" });
  });

  test("a possession candidate is stored as uncertain with confidence", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    engine.setPossession("ent_001", 0.62);
    expect(engine.snapshot().football?.possession).toEqual({
      status: "uncertain",
      value: { entityId: "ent_001" },
      confidence: 0.62,
    });
  });

  test("invalid possession inputs are rejected", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { football: makeFootballState() });
    expect(() => engine.setPossession("bad id!", 0.5)).toThrow(InvalidEntityIdError);
    expect(() => engine.setPossession("ent_001", 1.5)).toThrow(InvalidUncertainValueError);
    expect(engine.snapshot().football?.possession).toEqual({ status: "unknown" });
  });
});
