/**
 * W402 §3.1 tests: `stateAt` — equals `engine.snapshot(atMs)` field-for-field
 * on a fusion-fed engine (the at-T contract pinned), the engine's
 * `InvalidTimelineQueryError` passes through unchanged, and the wrapper adds
 * no state.
 */
import { describe, expect, test } from "bun:test";
import { InvalidTimelineQueryError } from "@sporta/world-model";
import { stateAt } from "../src/index";
import { buildE2EObservations, fuse, makeFootballState } from "./helpers";

describe("stateAt: equals engine.snapshot(atMs) field-for-field (fusion-fed engine)", () => {
  const { engine } = fuse(buildE2EObservations(), { football: makeFootballState() });

  test("the result wraps the snapshot verbatim and adds no state", () => {
    const result = stateAt(engine, 6_000);
    expect(Object.keys(result)).toEqual(["snapshot"]);
    expect(result.snapshot).toEqual(engine.snapshot(6_000));
  });

  test("field-for-field at a mid-timeline position (events applied, entities not yet)", () => {
    const expected = engine.snapshot(6_000);
    const actual = stateAt(engine, 6_000).snapshot;
    expect(actual.sessionId).toBe(expected.sessionId);
    expect(actual.schemaVersion).toBe(expected.schemaVersion);
    expect(actual.watermark).toEqual(expected.watermark);
    expect(actual.entities).toEqual(expected.entities);
    expect(actual.football).toEqual(expected.football);
    expect(actual.generatedAtMs).toBe(expected.generatedAtMs);
    // At t=6_000: the three commentary events are in (watermark 6_000/seq 3),
    // every entity's lastEventTimeMs is 10_000 (not yet), and the football
    // timeline marker is 10_500 (not yet — future state excluded).
    expect(actual.entities).toEqual([]);
    expect(actual.football).toBeUndefined();
    expect(actual.watermark).toEqual({ watermarkMs: 6_000, sequence: 3 });
  });

  test("field-for-field at the final timeline position (entities + football in)", () => {
    const expected = engine.snapshot(10_500);
    const actual = stateAt(engine, 10_500).snapshot;
    expect(actual).toEqual(expected);
    expect(actual.entities).toHaveLength(4);
    expect(actual.football?.clock.period).toBe("post-match");
  });

  test("entity positions at T are the at-T surface's own contribution (W006 semantics)", () => {
    // The at-T state query is where entity positions live — events alone
    // carry no entity state (see the replay module docs). Before the first
    // track (t < 1_000) there are no entities; at the final frame there are
    // four, with the fusion-projected pitch positions.
    expect(stateAt(engine, 999).snapshot.entities).toEqual([]);
    const finalEntities = stateAt(engine, 10_500).snapshot.entities;
    const p2 = finalEntities.find((entity) => entity.entityId === "p2");
    expect(p2?.state.position).toEqual({
      status: "uncertain",
      value: { x: 49, y: 34 },
      confidence: 0.8,
    });
  });

  test("atMs = 0 returns the empty past (no entities, no football marker yet)", () => {
    const snapshot = stateAt(engine, 0).snapshot;
    expect(snapshot.entities).toEqual([]);
    expect(snapshot.football).toBeUndefined();
    expect(snapshot.watermark).toEqual({ watermarkMs: 0, sequence: 0 });
  });
});

describe("stateAt: the engine's validation surface passes through unchanged", () => {
  const { engine } = fuse(buildE2EObservations(), { football: makeFootballState() });

  test("a NaN timeline position throws the engine's InvalidTimelineQueryError", () => {
    expect(() => stateAt(engine, Number.NaN)).toThrow(InvalidTimelineQueryError);
    expect(() => stateAt(engine, Number.NaN)).toThrow("snapshot: atMs must be a number (got NaN)");
  });

  test("a non-number timeline position throws the engine's InvalidTimelineQueryError", () => {
    expect(() => stateAt(engine, "6000" as unknown as number)).toThrow(InvalidTimelineQueryError);
  });

  test("a non-engine argument fails loud (RangeError, repo style)", () => {
    expect(() => stateAt(null as never, 1_000)).toThrow(RangeError);
    expect(() => stateAt({} as never, 1_000)).toThrow("stateAt: engine must be a WorldModelEngine");
  });
});
