/**
 * W403 comparison-math tests — the tolerance arithmetic of
 * {@link compareSnapshots}, pinned at the documented boundaries.
 *
 * Every epsilon class is exercised at its EXACT boundary: a delta AT the
 * epsilon passes (`<=`), a delta at 2x the epsilon fails. The exact-zero
 * bases from `makeSnapshot` make the deltas EXACT (e.g. `positionX: 1e-9`
 * differs from 0 by exactly the double `1e-9`, which IS the tolerance —
 * no rounding noise at the boundary).
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIDENCE_EPSILON,
  DEFAULT_POSITION_EPSILON_M,
  compareSnapshots,
  valuesEqual,
} from "../src/index";
import type { FieldDiff, ToleranceSpec } from "../src/index";
import { DEFAULT_TOLERANCE } from "../src/index";
import { BASE_ENTITY_ID, makeSnapshot } from "./helpers";

/** The non-excluded diffs (the only ones that can fail comparability). */
function nonExcluded(diffs: readonly FieldDiff[]): FieldDiff[] {
  return diffs.filter((entry) => entry.kind !== "excluded");
}

/** Finds one diff entry by path (fail loud when missing). */
function pin(diffs: readonly FieldDiff[], path: string): FieldDiff {
  const entry = diffs.find((candidate) => candidate.path === path);
  if (entry === undefined) throw new Error(`no diff entry at path "${path}"`);
  return entry;
}

describe("comparison math — position epsilon (1e-9 m)", () => {
  test("identical snapshots: comparable, only the always-recorded excluded entries", () => {
    const a = makeSnapshot();
    const b = makeSnapshot();
    const diff = compareSnapshots(a, b);
    expect(diff.comparable).toBe(true);
    // Recording semantics: excluded-by-rule fields are recorded ALWAYS
    // (equal or not); everything equal is not recorded.
    expect(diff.diffs.map((entry) => entry.path)).toEqual(["watermark.sequence", "generatedAtMs"]);
    expect(diff.diffs.every((entry) => entry.kind === "excluded")).toBe(true);
  });

  test("AT the epsilon passes (delta === positionM)", () => {
    const a = makeSnapshot({ positionX: 0 });
    const b = makeSnapshot({ positionX: DEFAULT_POSITION_EPSILON_M });
    const diff = compareSnapshots(a, b);
    expect(diff.comparable).toBe(true);
    const entry = pin(diff.diffs, `entities[${BASE_ENTITY_ID}].state.position.value.x`);
    expect(entry.kind).toBe("numeric");
    expect(entry.delta).toBe(DEFAULT_POSITION_EPSILON_M);
    expect(entry.tolerance).toBe(DEFAULT_POSITION_EPSILON_M);
  });

  test("2x the epsilon fails", () => {
    const a = makeSnapshot({ positionX: 0 });
    const b = makeSnapshot({ positionX: 2 * DEFAULT_POSITION_EPSILON_M });
    const diff = compareSnapshots(a, b);
    expect(diff.comparable).toBe(false);
    const entry = pin(diff.diffs, `entities[${BASE_ENTITY_ID}].state.position.value.x`);
    expect(entry.delta).toBeGreaterThan(DEFAULT_POSITION_EPSILON_M);
    // The ONLY failing entry is the position (a single-field difference).
    expect(nonExcluded(diff.diffs)).toHaveLength(1);
  });

  test("y axis and nested slot values use the same position class", () => {
    const a = makeSnapshot({ positionY: 0 });
    const b = makeSnapshot({ positionY: 0.75 });
    const diff = compareSnapshots(a, b);
    expect(diff.comparable).toBe(false);
    expect(pin(diff.diffs, `entities[${BASE_ENTITY_ID}].state.position.value.y`).delta).toBe(0.75);
  });
});

describe("comparison math — confidence epsilon (1e-12)", () => {
  test("AT the epsilon passes; 2x fails", () => {
    const at = compareSnapshots(
      makeSnapshot({ positionConfidence: 0 }),
      makeSnapshot({ positionConfidence: DEFAULT_CONFIDENCE_EPSILON }),
    );
    expect(at.comparable).toBe(true);
    expect(pin(at.diffs, `entities[${BASE_ENTITY_ID}].state.position.confidence`).delta).toBe(
      DEFAULT_CONFIDENCE_EPSILON,
    );

    const beyond = compareSnapshots(
      makeSnapshot({ positionConfidence: 0 }),
      makeSnapshot({ positionConfidence: 2 * DEFAULT_CONFIDENCE_EPSILON }),
    );
    expect(beyond.comparable).toBe(false);
    expect(nonExcluded(beyond.diffs)).toHaveLength(1);
  });

  test("possession.confidence uses the confidence class (football extension)", () => {
    const diff = compareSnapshots(
      makeSnapshot({ possessionConfidence: 0 }),
      makeSnapshot({ possessionConfidence: 1 }),
    );
    expect(diff.comparable).toBe(false);
    const entry = pin(diff.diffs, "football.possession.confidence");
    expect(entry.kind).toBe("numeric");
    expect(entry.tolerance).toBe(DEFAULT_CONFIDENCE_EPSILON);
  });

  test("a missing-vs-present confidence is structural (never coerced)", () => {
    // status "unknown" slots carry no confidence: present-vs-absent is a
    // structural difference, not a numeric one.
    const a = makeSnapshot({ positionStatus: "unknown" });
    a.entities[0]!.state.position = { status: "unknown" };
    const b = makeSnapshot({ positionStatus: "unknown" });
    const diff = compareSnapshots(a, b);
    expect(diff.comparable).toBe(false);
    expect(pin(diff.diffs, `entities[${BASE_ENTITY_ID}].state.position.confidence`).kind).toBe(
      "structural",
    );
  });
});

describe("comparison math — time fields are EXACT (timeMs default 0)", () => {
  test("a 1 ms lastEventTimeMs difference fails", () => {
    const diff = compareSnapshots(
      makeSnapshot({ lastEventTimeMs: 1_000 }),
      makeSnapshot({ lastEventTimeMs: 1_001 }),
    );
    expect(diff.comparable).toBe(false);
    expect(pin(diff.diffs, `entities[${BASE_ENTITY_ID}].lastEventTimeMs`).tolerance).toBe(0);
  });

  test("lastSeenMs slot values use the timeMs class; clockMs and watermarkMs too", () => {
    const lastSeen = compareSnapshots(
      makeSnapshot({ lastSeenMs: 1_000 }),
      makeSnapshot({ lastSeenMs: 1_001 }),
    );
    expect(
      pin(lastSeen.diffs, `entities[${BASE_ENTITY_ID}].state.lastSeenMs.value`).tolerance,
    ).toBe(0);
    expect(lastSeen.comparable).toBe(false);

    const clock = compareSnapshots(
      makeSnapshot({ clockMs: 1_000 }),
      makeSnapshot({ clockMs: 2_000 }),
    );
    expect(pin(clock.diffs, "football.clock.clockMs").tolerance).toBe(0);

    const watermark = compareSnapshots(
      makeSnapshot({ watermarkMs: 1_000 }),
      makeSnapshot({ watermarkMs: 1_000.5 }),
    );
    expect(pin(watermark.diffs, "watermark.watermarkMs").tolerance).toBe(0);
  });
});

describe("comparison math — integers are EXACT", () => {
  test("an entity version difference fails with the exact sentinel", () => {
    const diff = compareSnapshots(
      makeSnapshot({ entityVersion: 2 }),
      makeSnapshot({ entityVersion: 3 }),
    );
    expect(diff.comparable).toBe(false);
    const entry = pin(diff.diffs, `entities[${BASE_ENTITY_ID}].version`);
    expect(entry.kind).toBe("numeric");
    expect(entry.tolerance).toBe("exact");
  });

  test("score integers are exact", () => {
    const diff = compareSnapshots(makeSnapshot({ scoreHome: 1 }), makeSnapshot({ scoreHome: 2 }));
    expect(diff.comparable).toBe(false);
    expect(pin(diff.diffs, "football.score.home").tolerance).toBe("exact");
  });
});

describe("comparison math — structural equality (everything else)", () => {
  test("entity union: an entity present in only one snapshot is one structural diff", () => {
    const missing = compareSnapshots(makeSnapshot(), makeSnapshot({ dropEntity: true }));
    expect(missing.comparable).toBe(false);
    expect(pin(missing.diffs, `entities[${BASE_ENTITY_ID}]`).kind).toBe("structural");

    const extra = compareSnapshots(makeSnapshot(), makeSnapshot({ extraEntityId: "t9" }));
    expect(extra.comparable).toBe(false);
    expect(pin(extra.diffs, "entities[t9]").kind).toBe("structural");
  });

  test("enums and ids are structural: period, statuses, sessionId", () => {
    const period = compareSnapshots(
      makeSnapshot({ clockPeriod: "first-half" }),
      makeSnapshot({ clockPeriod: "post-match" }),
    );
    expect(pin(period.diffs, "football.clock.period").kind).toBe("structural");
    expect(period.comparable).toBe(false);

    const status = compareSnapshots(
      makeSnapshot({ positionStatus: "uncertain" }),
      makeSnapshot({ positionStatus: "known" }),
    );
    expect(pin(status.diffs, `entities[${BASE_ENTITY_ID}].state.position.status`).kind).toBe(
      "structural",
    );

    const session = compareSnapshots(
      makeSnapshot({ sessionId: "s-one" }),
      makeSnapshot({ sessionId: "s-two" }),
    );
    expect(pin(session.diffs, "sessionId").kind).toBe("structural");
  });

  test("football presence mismatch is one structural diff at the subtree root", () => {
    const diff = compareSnapshots(makeSnapshot(), makeSnapshot({ dropFootball: true }));
    expect(diff.comparable).toBe(false);
    expect(pin(diff.diffs, "football").kind).toBe("structural");
    expect(nonExcluded(diff.diffs)).toHaveLength(1);
  });

  test("a slot present on only one entity is a structural presence diff", () => {
    const a = makeSnapshot();
    const b = makeSnapshot();
    // b's entity loses its lastSeenMs slot entirely (key-set mismatch).
    delete b.entities[0]!.state.lastSeenMs;
    const diff = compareSnapshots(a, b);
    expect(diff.comparable).toBe(false);
    expect(pin(diff.diffs, `entities[${BASE_ENTITY_ID}].state.lastSeenMs`).kind).toBe("structural");
  });

  test("deep differences NEVER throw — every difference is reported", () => {
    const a = makeSnapshot();
    const b = makeSnapshot({
      sessionId: "other-session",
      dropFootball: true,
      dropEntity: true,
      watermarkMs: 9_999,
    });
    expect(() => compareSnapshots(a, b)).not.toThrow();
    const diff = compareSnapshots(a, b);
    expect(diff.comparable).toBe(false);
    expect(nonExcluded(diff.diffs).length).toBeGreaterThan(0);
  });

  test("malformed input throws RangeError (fail loud, repo style)", () => {
    expect(() => compareSnapshots(null as never, makeSnapshot())).toThrow(RangeError);
    expect(() => compareSnapshots(makeSnapshot(), { bad: true } as never)).toThrow(RangeError);
  });
});

describe("comparison math — custom tolerance specs are honored", () => {
  test("a loosened position epsilon absorbs a 0.5 m difference", () => {
    const loose: ToleranceSpec = { ...DEFAULT_TOLERANCE, positionM: 1 };
    const diff = compareSnapshots(
      makeSnapshot({ positionX: 10 }),
      makeSnapshot({ positionX: 10.5 }),
      loose,
    );
    expect(diff.comparable).toBe(true);
    // The within-tolerance difference is still RECORDED (visible info).
    expect(pin(diff.diffs, `entities[${BASE_ENTITY_ID}].state.position.value.x`).delta).toBe(0.5);
  });

  test("a zero position epsilon rejects any position difference", () => {
    const strict: ToleranceSpec = { ...DEFAULT_TOLERANCE, positionM: 0 };
    const diff = compareSnapshots(
      makeSnapshot({ positionX: 0 }),
      makeSnapshot({ positionX: DEFAULT_POSITION_EPSILON_M }),
      strict,
    );
    expect(diff.comparable).toBe(false);
  });
});

describe("valuesEqual — the structural-equality primitive", () => {
  test("primitives, arrays, objects, key sets", () => {
    expect(valuesEqual(1, 1)).toBe(true);
    expect(valuesEqual("a", "a")).toBe(true);
    expect(valuesEqual(1, 2)).toBe(false);
    expect(valuesEqual([1, 2], [1, 2])).toBe(true);
    expect(valuesEqual([1, 2], [2, 1])).toBe(false);
    expect(valuesEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(valuesEqual(null, null)).toBe(true);
    expect(valuesEqual(null, {})).toBe(false);
    expect(valuesEqual(undefined, undefined)).toBe(true);
  });
});
