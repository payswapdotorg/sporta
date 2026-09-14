/**
 * W403 e2e tests — the SUBPROCESS cross-run evaluation on the fixed fixture:
 *
 * - `runCrossRunEvaluation` (default: 2 separate bun subprocesses + the
 *   checked-in golden) passes with byte-identical runs;
 * - the evaluation result itself: pairwise + golden comparisons, zero diffs,
 *   zero measured deviation, byte-identity;
 * - GOLDEN ENFORCEMENT: a drifted golden (mutated value) fails the runner;
 *   a missing/unparsable golden fails the runner;
 * - MUTATION-DETECTION negatives: a mutated run artifact fails the classified
 *   comparator with the expected class at the expected path (EPSILON, EXACT,
 *   COUNT, UNCLASSIFIED).
 */
import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { DEFAULT_GOLDEN_PATH, runCrossRunEvaluation } from "../src/runner";
import { compareWorldModelArtifacts } from "../src/compare";
import { serializeArtifact } from "../src/serialize";
import { runFixtureEvaluation } from "../src/pipeline";
import type { WorldModelArtifact } from "../src/artifact";
import { scratchPath } from "./helpers";

describe("e2e: cross-run evaluation (separate bun subprocesses, fixed fixture)", () => {
  test("runs < 2 fails loud (a pairwise comparison needs two)", () => {
    expect(() => runCrossRunEvaluation({ runs: 1 })).toThrow(RangeError);
    expect(() => runCrossRunEvaluation({ runs: 1 })).toThrow(/runs must be an integer >= 2/);
  });

  test("the default evaluation passes: 2 runs, pairwise + golden, byte-identical", () => {
    const report = runCrossRunEvaluation();
    expect(report.runsCompleted).toBe(2);
    expect(report.runs).toHaveLength(2);
    expect(report.passed).toBe(true);
    expect(report.failureReasons).toEqual([]);

    // Every subprocess succeeded cleanly and printed pure canonical JSON.
    for (const run of report.runs) {
      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe("");
      expect(run.canonical).not.toBeNull();
      expect((run.artifact as WorldModelArtifact).artifactSchema).toBe("w403-artifact/1");
    }

    // Pairwise: comparable within the documented tolerance AND byte-identical
    // (same binary — the stronger evidence, measured, not assumed).
    expect(report.pairwise).toHaveLength(1);
    const pair = report.pairwise[0]!;
    expect(pair.label).toBe("run 1 ↔ run 2");
    expect(pair.report.passed).toBe(true);
    expect(pair.report.diffCount).toBe(0);
    expect(pair.report.summary.maxAbsDeviation).toBe(0);
    expect(pair.report.summary.exactFieldsCompared).toBeGreaterThan(0);
    expect(pair.report.summary.countFieldsCompared).toBeGreaterThan(0);
    expect(pair.report.summary.epsilonFieldsCompared).toBeGreaterThan(0);
    expect(pair.report.summary.setArraysCompared).toBeGreaterThan(0);
    expect(pair.byteIdentical).toBe(true);

    // Golden: the checked-in baseline matches run 1 byte-for-byte.
    expect(report.golden).not.toBeNull();
    expect(report.golden!.report.passed).toBe(true);
    expect(report.golden!.byteIdentical).toBe(true);
    expect(report.golden!.label).toBe("run 1 ↔ golden");
  });

  test("the runs' stdout is EXACTLY the canonical artifact (nothing else)", () => {
    const report = runCrossRunEvaluation({ goldenPath: null });
    const [run] = report.runs;
    expect(run!.exitCode).toBe(0);
    // Re-serializing the parsed stdout reproduces the bytes verbatim.
    const canonical = run!.canonical;
    expect(canonical).not.toBeNull();
    expect(serializeArtifact(run!.artifact)).toBe(canonical!);
    expect(report.passed).toBe(true);
    expect(report.golden).toBeNull();
  });
});

describe("e2e: golden enforcement (the checked-in baseline is the gate)", () => {
  test("a DRIFTED golden fails the evaluation with the diffing path", () => {
    const fresh = runFixtureEvaluation();
    const drifted = JSON.parse(fresh.canonical) as WorldModelArtifact;
    // A one-ulp-class mutation: one EPSILON field moved beyond epsilon.
    const ball = drifted.stateAt["11800"]!.entities.find((e) => e.entityId === "b1")!;
    const position = ball.state.position!.value as { x: number; y: number };
    position.x += 1e-6;
    const path = scratchPath("drifted-golden.json");
    writeFileSync(path, serializeArtifact(drifted));

    const report = runCrossRunEvaluation({ goldenPath: path });
    expect(report.passed).toBe(false);
    expect(report.failureReasons.length).toBeGreaterThan(0);
    expect(report.failureReasons.some((reason) => reason.includes("golden"))).toBe(true);
    const golden = report.golden!;
    expect(golden.report.passed).toBe(false);
    expect(
      golden.report.diffs.some(
        (diff) =>
          diff.path === "$.stateAt.11800.entities[b1].state.position.value.x" &&
          diff.fieldClass === "EPSILON",
      ),
    ).toBe(true);
    rmSync(path);
  });

  test("a MISSING golden fails the evaluation (never silently skipped)", () => {
    const path = scratchPath("missing-golden.json");
    rmSync(path, { force: true });
    const report = runCrossRunEvaluation({ goldenPath: path });
    expect(report.passed).toBe(false);
    expect(report.golden).toBeNull();
    expect(report.failureReasons.some((reason) => reason.includes("missing or unparsable"))).toBe(
      true,
    );
  });

  test("the default golden path is the checked-in file", () => {
    expect(DEFAULT_GOLDEN_PATH).toContain("fixtures/golden/w403-golden.json");
  });
});

describe("e2e: mutation-detection negatives (comparator on a real run artifact)", () => {
  // One in-process run provides the artifact; the comparator is the gate the
  // runner applies, so these mutations prove drift CANNOT pass silently.
  const expected = runFixtureEvaluation().artifact;

  const mutate = (mutator: (artifact: WorldModelArtifact) => void): WorldModelArtifact => {
    const actual = JSON.parse(JSON.stringify(expected)) as WorldModelArtifact;
    mutator(actual);
    return actual;
  };

  test("an EPSILON breach (position moved 1e-6 m) fails with deviation", () => {
    const actual = mutate((artifact) => {
      const ball = artifact.stateAt["11800"]!.entities.find((e) => e.entityId === "b1")!;
      const position = ball.state.position!.value as { x: number; y: number };
      position.x += 1e-6;
    });
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    const diff = report.diffs.find(
      (d) => d.path === "$.stateAt.11800.entities[b1].state.position.value.x",
    );
    expect(diff).toBeDefined();
    expect(diff!.fieldClass).toBe("EPSILON");
    // Double arithmetic: |50 − (50 + 1e-6)| is 9.999999974752427e-7.
    expect(diff!.deviation).toBeCloseTo(1e-6, 12);
    expect(diff!.deviation).toBeGreaterThan(1e-9);
  });

  test("an EXACT breach (event id rewritten) fails", () => {
    const actual = mutate((artifact) => {
      artifact.eventWindow.entries[0]!.event.eventId = "fe-ceu-ec-99";
    });
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(
      report.diffs.some(
        (d) => d.path === "$.eventWindow.entries[0].event.eventId" && d.fieldClass === "EXACT",
      ),
    ).toBe(true);
  });

  test("a COUNT breach (an observability counter bumped) fails", () => {
    const actual = mutate((artifact) => {
      artifact.fusion.first.entitiesUpserted += 1;
    });
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(
      report.diffs.some(
        (d) => d.path === "$.fusion.first.entitiesUpserted" && d.fieldClass === "COUNT",
      ),
    ).toBe(true);
  });

  test("an UNCLASSIFIED field (brand-new key) fails loud with its path", () => {
    const actual = mutate((artifact) => {
      (artifact as unknown as Record<string, unknown>).newTopLevelKey = true;
    });
    const report = compareWorldModelArtifacts(expected, actual);
    expect(report.passed).toBe(false);
    expect(report.diffs[0]!.path).toBe("$.newTopLevelKey");
    expect(report.diffs[0]!.fieldClass).toBe("UNCLASSIFIED");
  });
});
