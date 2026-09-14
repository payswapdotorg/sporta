/**
 * W403 comparator unit tests — the mandated coverage: exact pass, epsilon
 * pass, epsilon breach fails, exact breach fails, UNCLASSIFIED field fails
 * loud with its JSON path, NaN flagged — plus SET/COUNT semantics,
 * undefined-vs-missing, structural mismatches, summary counts, deterministic
 * diff order, and spec validation. Pure: no pipeline run, no I/O.
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_EPSILON,
  W403_ARTIFACT_CLASSIFICATION,
  compareWorldModelArtifacts,
  deepCompare,
} from "../src/compare";
import type { ClassificationRule, ComparisonReport, ToleranceSpec } from "../src/compare";
import type { WorldModelArtifact } from "../src/artifact";
import { cloneArtifact, minimalArtifact } from "./helpers";

/** The minimal artifact compared against itself (the zero-diff baseline). */
function selfReport(): ComparisonReport {
  return compareWorldModelArtifacts(minimalArtifact(), minimalArtifact());
}

/**
 * A mutable view of the `stateAt["1000"]` position value of one entity
 * (test mutations; `UncertainValue.value` is statically `unknown`).
 */
function positionValue(artifact: WorldModelArtifact, entityId: string): { x: number; y: number } {
  const entity = artifact.stateAt["1000"]!.entities.find((e) => e.entityId === entityId)!;
  return entity.state.position!.value as { x: number; y: number };
}

/** A mutable record view of an artifact level (test key additions). */
function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe("deepCompare — the mandated cases", () => {
  test("EXACT pass: identical artifacts compare with zero diffs", () => {
    const report = selfReport();
    expect(report.passed).toBe(true);
    expect(report.diffCount).toBe(0);
    expect(report.diffs).toEqual([]);
  });

  test("EPSILON pass: a float-derived value within 1e-9 passes and is counted", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    // 0.8 vs 0.8 + 5e-10: within the default epsilon, still a PASS.
    actual.stateAt["1000"]!.entities[0]!.state.position!.confidence = 0.8 + 5e-10;
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(true);
    expect(report.summary.epsilonFieldsCompared).toBe(selfReport().summary.epsilonFieldsCompared);
    // Double arithmetic: |0.8 − (0.8 + 5e-10)| is 5.000000413701855e-10, so
    // assert the deviation approximately, not bit-exactly.
    expect(report.summary.maxAbsDeviation).toBeCloseTo(5e-10, 15);
    expect(report.summary.maxAbsDeviation).toBeLessThanOrEqual(DEFAULT_EPSILON);
  });

  test("EPSILON breach fails with deviation and the full JSON path", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    positionValue(actual, "pA").x = 1.5 + 1e-6;
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(report.diffCount).toBe(1);
    const diff = report.diffs[0]!;
    expect(diff.path).toBe("$.stateAt.1000.entities[pA].state.position.value.x");
    expect(diff.fieldClass).toBe("EPSILON");
    expect(diff.expected).toBe("1.5");
    expect(diff.actual).toBe(String(1.5 + 1e-6));
    expect(diff.deviation).toBeCloseTo(1e-6, 12);
    expect(diff.reason).toContain("epsilon-breach");
  });

  test("EXACT breach fails (an integer position value)", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    actual.eventWindow.entries[0]!.sequence = 2;
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    const diff = report.diffs[0]!;
    expect(diff.path).toBe("$.eventWindow.entries[0].sequence");
    expect(diff.fieldClass).toBe("EXACT");
    expect(diff.deviation).toBe(1);
  });

  test("EXACT breach fails (an enum/id string value)", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    actual.stateAt["1000"]!.entities[0]!.kind = "ball";
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(report.diffs[0]!.path).toBe("$.stateAt.1000.entities[pA].kind");
    expect(report.diffs[0]!.fieldClass).toBe("EXACT");
    expect(report.diffs[0]!.reason).toContain("exact-mismatch");
  });

  test("UNCLASSIFIED field fails LOUD with its JSON path", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    // A brand-new field no rule covers — never a silent pass.
    asRecord(actual.stateAt["1000"]).surpriseField = 42;
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    const unclassified = report.diffs.filter((diff) => diff.fieldClass === "UNCLASSIFIED");
    expect(unclassified).toHaveLength(1);
    expect(unclassified[0]!.path).toBe("$.stateAt.1000.surpriseField");
    expect(unclassified[0]!.reason).toContain("no classification rule covers this JSON path");
  });

  test("a top-level unknown key fails loud (root walk reaches it)", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    asRecord(actual).newSection = {};
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(report.diffs[0]!.path).toBe("$.newSection");
    expect(report.diffs[0]!.fieldClass).toBe("UNCLASSIFIED");
  });

  test("NaN is flagged explicitly (EXACT leaf), never coerced to equality", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    actual.eventWindow.entries[0]!.sequence = Number.NaN;
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    const diff = report.diffs[0]!;
    expect(diff.path).toBe("$.eventWindow.entries[0].sequence");
    expect(diff.reason).toContain("NaN");
    expect(diff.actual).toBe("NaN");
    expect(diff.expected).toBe("1");
  });

  test("NaN is flagged explicitly (EPSILON leaf), never within tolerance", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    actual.eventWindow.entries[0]!.event.confidence = Number.NaN;
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(report.diffs[0]!.fieldClass).toBe("EPSILON");
    expect(report.diffs[0]!.reason).toContain("NaN");
  });

  test("NaN vs NaN is still a flagged diff (NaN equals nothing, not even itself)", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    expected.fusion.first.snapshotVersionAfter = Number.NaN;
    actual.fusion.first.snapshotVersionAfter = Number.NaN;
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(report.diffs[0]!.reason).toContain("NaN");
  });
});

describe("deepCompare — undefined / missing / structural semantics", () => {
  test("undefined-vs-missing is an explicit diff, never silently equal", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    // Key present-with-undefined on one side, absent on the other: flagged.
    const expectedEvent = expected.eventWindow.entries[0]!.event as Record<string, unknown>;
    const actualEvent = actual.eventWindow.entries[0]!.event as Record<string, unknown>;
    expectedEvent.correctionOf = undefined;
    delete actualEvent.correctionOf;
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(report.diffs[0]!.path).toBe("$.eventWindow.entries[0].event.correctionOf");
    expect(report.diffs[0]!.reason).toContain("undefined-vs-missing");
    // A real value on one side, absence on the other: also a diff.
    const expected2 = minimalArtifact();
    const actual2 = cloneArtifact(expected2);
    (expected2.eventWindow.entries[0]!.event as Record<string, unknown>).correctionOf = "fe-x";
    const report2 = compareWorldModelArtifacts(expected2, actual2);
    expect(report2.passed).toBe(false);
    expect(report2.diffs[0]!.path).toBe("$.eventWindow.entries[0].event.correctionOf");
    expect(report2.diffs[0]!.reason).toContain("missing-field");
  });

  test("undefined-vs-missing with a real undefined value is flagged", () => {
    const expected = { a: undefined } as unknown;
    const actual = {} as unknown;
    const spec: ToleranceSpec = {
      epsilon: DEFAULT_EPSILON,
      rules: [{ pattern: "$", fieldClass: "EXACT", rationale: "root" }],
    };
    const report = deepCompare(expected, actual, spec);
    expect(report.passed).toBe(false);
    expect(report.diffs[0]!.path).toBe("$.a");
    expect(report.diffs[0]!.reason).toContain("undefined-vs-missing");
  });

  test("type mismatch, array length mismatch, and missing elements are diffs", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    actual.replay.limits.maxEvents = "10" as unknown as number;
    let report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(report.diffs[0]!.reason).toContain("type-mismatch");

    const actual2 = cloneArtifact(expected);
    const longer = [...expected.eventWindow.entries, expected.eventWindow.entries[0]!];
    (actual2.eventWindow as unknown as { entries: typeof longer }).entries = longer;
    report = compareWorldModelArtifacts(expected, actual2);
    expect(report.passed).toBe(false);
    expect(report.diffs.some((diff) => diff.reason.includes("array-length"))).toBe(true);
    expect(report.diffs.some((diff) => diff.reason.includes("missing-element"))).toBe(true);
  });
});

describe("deepCompare — SET semantics (snapshot entity arrays)", () => {
  test("entity order is genuinely irrelevant: a reorder passes", () => {
    const expected = minimalArtifact();
    // Two entities, so a real reorder happens.
    expected.stateAt["1000"]!.entities.push({
      entityId: "pB",
      kind: "participant",
      version: 1,
      lastEventTimeMs: 0,
      state: {
        position: { status: "uncertain", value: { x: 2.5, y: 3.5 }, confidence: 0.7 },
        spatialFrame: { status: "known", value: "pitch" },
        lastSeenMs: { status: "known", value: 0 },
      },
    });
    const actual = cloneArtifact(expected);
    actual.stateAt["1000"]!.entities.reverse();
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(true);
    expect(report.summary.setArraysCompared).toBeGreaterThan(0);
  });

  test("a SET element present on one side only fails with its key", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    actual.stateAt["1000"]!.entities[0]!.entityId = "pZ";
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    const paths = report.diffs.map((diff) => diff.path);
    expect(paths).toContain("$.stateAt.1000.entities[pA]");
    expect(paths).toContain("$.stateAt.1000.entities[pZ]");
    expect(report.diffs.every((diff) => diff.reason.includes("set-element-missing"))).toBe(true);
  });

  test("duplicate setKey inside one snapshot fails loud (never collapsed)", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    const first = actual.stateAt["1000"]!.entities[0]!;
    actual.stateAt["1000"]!.entities.push({ ...first, version: 2 });
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(report.diffs[0]!.reason).toContain("set-key-duplicate");
  });

  test("a SET element differing INSIDE (epsilon field) still fails", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    positionValue(actual, "pA").x = 2.5;
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(report.diffs[0]!.path).toBe("$.stateAt.1000.entities[pA].state.position.value.x");
  });
});

describe("deepCompare — COUNT semantics", () => {
  test("count mismatch fails with a deviation", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    actual.fusion.first.entitiesUpserted += 3;
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    const diff = report.diffs[0]!;
    expect(diff.path).toBe("$.fusion.first.entitiesUpserted");
    expect(diff.fieldClass).toBe("COUNT");
    expect(diff.deviation).toBe(3);
    expect(diff.reason).toContain("count-mismatch");
  });

  test("a non-integer count fails loud", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    (actual.replay as { eventsApplied: number }).eventsApplied = 1.5;
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(report.diffs[0]!.reason).toContain("count-not-integer");
  });

  test("a non-number count fails loud", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    (actual.replay as { eventsApplied: number }).eventsApplied = "1" as unknown as number;
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(report.diffs[0]!.reason).toContain("type-mismatch");
  });
});

describe("deepCompare — summary, determinism, and spec validation", () => {
  test("summary counts every compared field by class and is deterministic", () => {
    const first = selfReport();
    const second = selfReport();
    expect(first.summary).toEqual(second.summary);
    expect(first.summary.exactFieldsCompared).toBeGreaterThan(0);
    expect(first.summary.countFieldsCompared).toBeGreaterThan(0);
    expect(first.summary.epsilonFieldsCompared).toBeGreaterThan(0);
    expect(first.summary.setArraysCompared).toBeGreaterThan(0);
    expect(first.summary.maxAbsDeviation).toBe(0);
  });

  test("the diff list itself is deterministic (same input, same order)", () => {
    const mutate = () => {
      const expected = minimalArtifact();
      const actual = cloneArtifact(expected);
      (actual.fusion.first as { entitiesUpserted: number }).entitiesUpserted = 5;
      (actual.replay as { eventsApplied: number }).eventsApplied = 2;
      (actual.stateAt["1000"]!.watermark as { sequence: number }).sequence = 9;
      return compareWorldModelArtifacts(expected, actual);
    };
    expect(mutate().diffs.map((diff) => diff.path)).toEqual(
      mutate().diffs.map((diff) => diff.path),
    );
  });

  test("epsilon override: a custom epsilon tightens or widens the verdict", () => {
    const expected = minimalArtifact();
    const actual = cloneArtifact(expected);
    const deviation = 5e-10; // within the default 1e-9, above a tighter 1e-10
    actual.eventWindow.entries[0]!.event.confidence = 0.9 + deviation;
    expect(compareWorldModelArtifacts(expected, actual).passed).toBe(true);
    expect(compareWorldModelArtifacts(expected, actual, { epsilon: 1e-10 }).passed).toBe(false);
    expect(compareWorldModelArtifacts(expected, actual, { epsilon: 1e-7 }).passed).toBe(true);
  });

  test("spec validation fails loud: non-positive epsilon, empty rules", () => {
    const artifact = minimalArtifact();
    expect(() =>
      deepCompare(artifact, artifact, { epsilon: 0, rules: W403_ARTIFACT_CLASSIFICATION }),
    ).toThrow(RangeError);
    expect(() => deepCompare(artifact, artifact, { epsilon: DEFAULT_EPSILON, rules: [] })).toThrow(
      RangeError,
    );
  });

  test("custom rules replace the table (a two-rule world)", () => {
    const rules: ClassificationRule[] = [
      { pattern: "$", fieldClass: "EXACT", rationale: "root only" },
      { pattern: "$.hello", fieldClass: "EPSILON", rationale: "a custom epsilon leaf" },
    ];
    const report = deepCompare(
      { hello: 1 },
      { hello: 1 },
      {
        epsilon: DEFAULT_EPSILON,
        rules,
      },
    );
    expect(report.passed).toBe(true);
    // Containers are not counted; only leaves: one EPSILON leaf here.
    expect(report.summary.exactFieldsCompared).toBe(0);
    expect(report.summary.epsilonFieldsCompared).toBe(1);
    // And with the custom table, an unknown leaf fails loud as UNCLASSIFIED.
    const drifted = deepCompare(
      { hello: 1, extra: 2 },
      { hello: 1, extra: 2 },
      {
        epsilon: DEFAULT_EPSILON,
        rules,
      },
    );
    expect(drifted.passed).toBe(false);
    expect(drifted.diffs[0]!.path).toBe("$.extra");
    expect(drifted.diffs[0]!.fieldClass).toBe("UNCLASSIFIED");
  });

  test("the W403 rule table: no duplicate patterns, no stray setKey", () => {
    const patterns = W403_ARTIFACT_CLASSIFICATION.map((rule) => rule.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
    for (const rule of W403_ARTIFACT_CLASSIFICATION) {
      if (rule.fieldClass !== "SET") {
        expect(rule.setKey).toBeUndefined();
      }
    }
    expect(patterns).toContain("$.stateAt.*.entities[*].state.position.value.x");
    expect(patterns).toContain("$.replay.final.generatedAtMs");
    expect(patterns).toContain("$.fusion.*.conflicts[*].values[*].confidence");
  });
});
