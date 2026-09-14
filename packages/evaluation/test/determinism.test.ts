/**
 * W403 determinism tests — the mandatory deep-equal RERUN evidence, one level
 * beyond the double-run: three complete pipeline runs, every PAIR compared
 * through the field-classified comparator (0 diffs, 0 deviation) and
 * byte-identical canonical serializations; the serializer itself is
 * idempotent (serialize ∘ parse ∘ serialize = serialize).
 *
 * No `Math.random`, no `Date.now` anywhere in the evaluated path — the
 * pipeline injects the clock (`now: () => TEST_EPOCH_MS`) and the replay
 * forces `REPLAY_GENERATED_AT_MS`; both are asserted by the pipeline.
 */
import { describe, expect, test } from "bun:test";
import { runFixtureEvaluation } from "../src/pipeline";
import { compareWorldModelArtifacts } from "../src/compare";
import { serializeArtifact } from "../src/serialize";

describe("determinism — rerun deep-equal (three complete runs)", () => {
  const runs = [runFixtureEvaluation(), runFixtureEvaluation(), runFixtureEvaluation()];

  test("every run PAIR passes the classified comparator with zero diffs", () => {
    for (let i = 0; i < runs.length; i += 1) {
      for (let j = i + 1; j < runs.length; j += 1) {
        const report = compareWorldModelArtifacts(runs[i]!.artifact, runs[j]!.artifact);
        expect(report.passed).toBe(true);
        expect(report.diffCount).toBe(0);
        expect(report.summary.maxAbsDeviation).toBe(0);
      }
    }
  });

  test("every run PAIR is byte-identical at the canonical serialization", () => {
    for (let i = 0; i < runs.length; i += 1) {
      for (let j = i + 1; j < runs.length; j += 1) {
        expect(runs[i]!.canonical).toBe(runs[j]!.canonical);
      }
    }
  });

  test("the artifacts are deep-equal (bun's structural equality, independent check)", () => {
    expect(runs[0]!.artifact).toEqual(runs[1]!.artifact);
    expect(runs[1]!.artifact).toEqual(runs[2]!.artifact);
    expect(runs[0]!.artifact).toEqual(runs[2]!.artifact);
  });

  test("serialization is idempotent: serialize(parse(bytes)) reproduces the bytes", () => {
    for (const run of runs) {
      expect(serializeArtifact(JSON.parse(run.canonical))).toBe(run.canonical);
    }
  });
});
