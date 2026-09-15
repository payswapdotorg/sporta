/**
 * The THRESHOLDS.md pin, both directions (the W503 convention):
 *
 * - every §4 doc row matches the code constant (value AND order);
 * - every code constant appears in the doc (no undocumented thresholds);
 * - every doc row's check cell lists REAL executed checks — the metrics
 *   exist in the evaluated report with the doc's threshold value;
 * - every executed check appears in exactly one doc row (no orphan checks,
 *   no silently skipped measurements).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCleanMatchFixture,
  buildCorrectionsMatchFixture,
  buildDirectedReviewFixture,
  evaluateSceneOutput,
  THRESHOLDS,
} from "../src/index";

const DOC: string = readFileSync(join(import.meta.dir, "..", "THRESHOLDS.md"), "utf8");

/** One parsed §4 row. */
interface DocRow {
  readonly constant: string;
  readonly value: string;
  readonly check: string;
  readonly line: string;
}

/** The §4 rows (the machine-parseable 4-column table). */
const rows: DocRow[] = [];
for (const line of DOC.split("\n")) {
  const match = /^\|\s*([A-Z][A-Z_0-9]*)\s*\|([^|]+)\|([^|]+)\|/.exec(line);
  if (match === null) continue;
  rows.push({
    constant: match[1]!,
    value: match[2]!.trim(),
    check: match[3]!.trim(),
    line,
  });
}

/** The executed checks of all three fixtures (metric -> threshold). */
const executedChecks = new Map<string, number>();
{
  const inputs = [
    buildCleanMatchFixture(),
    buildCorrectionsMatchFixture(),
    buildDirectedReviewFixture().input,
  ];
  for (const input of inputs) {
    const report = evaluateSceneOutput(input);
    expect(report.verdict.checks.length).toBe(44);
    for (const check of report.verdict.checks) {
      if (!executedChecks.has(check.metric)) {
        executedChecks.set(check.metric, check.threshold);
      }
    }
  }
}

describe("the doc mirrors the code (row-for-row, order-preserving)", () => {
  test("the row count and order match Object.keys(THRESHOLDS) exactly", () => {
    const keys = Object.keys(THRESHOLDS);
    expect(keys).toHaveLength(41);
    expect(rows.map((row) => row.constant)).toEqual(keys);
  });

  test("every document row's value is the code constant's value", () => {
    for (const row of rows) {
      expect(String(THRESHOLDS[row.constant as keyof typeof THRESHOLDS])).toBe(row.value);
    }
  });

  test("every code constant appears in the document (both directions)", () => {
    const documented = new Set(rows.map((row) => row.constant));
    for (const key of Object.keys(THRESHOLDS)) {
      expect(documented.has(key)).toBe(true);
    }
  });

  test("every row line is a machine-parseable 4-column table row", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.line.split("|")).toHaveLength(6);
    }
  });
});

describe("the doc mirrors the EXECUTED checks (both directions)", () => {
  /** The metric paths mentioned across all check cells. */
  const docMetrics = new Map<string, number>();
  for (const row of rows) {
    const checkMatch = /^(.+?)\s<=\s(\d+)$/.exec(row.check);
    expect(checkMatch, `row ${row.constant}: unparsable check cell "${row.check}"`).not.toBeNull();
    const metrics = checkMatch![1]!.split(", ").map((metric) => metric.trim());
    expect(metrics.length).toBeGreaterThan(0);
    for (const metric of metrics) {
      expect(metric.length).toBeGreaterThan(0);
      expect(docMetrics.has(metric), `metric "${metric}" appears in more than one row`).toBe(false);
      docMetrics.set(metric, Number(checkMatch![2]));
    }
  }

  test("the doc's 44 metric mentions are exactly the 44 executed checks", () => {
    expect(docMetrics.size).toBe(44);
    expect(executedChecks.size).toBe(44);
    for (const [metric, threshold] of docMetrics) {
      expect(executedChecks.has(metric), `doc metric "${metric}" is not an executed check`).toBe(
        true,
      );
      expect(executedChecks.get(metric)).toBe(threshold);
    }
    for (const [metric, threshold] of executedChecks) {
      expect(docMetrics.has(metric), `executed check "${metric}" is not in the doc`).toBe(true);
      expect(docMetrics.get(metric)).toBe(threshold);
    }
  });

  test("the shared constants cover both their dimensions (the combined claim)", () => {
    // Three constants are shared by two metrics each — the doc's check cells
    // must carry BOTH metric paths, never just one.
    const row = (constant: string) => rows.find((candidate) => candidate.constant === constant)!;
    expect(row("MAX_STEP_SCORE_MISMATCH_COUNT").check).toContain(
      "sourceTruth.stepScoreMismatchCount",
    );
    expect(row("MAX_STEP_SCORE_MISMATCH_COUNT").check).toContain("score.stepScoreMismatchCount");
    expect(row("MAX_STEP_CLOCK_MISMATCH_COUNT").check).toContain(
      "sourceTruth.stepClockMismatchCount",
    );
    expect(row("MAX_STEP_CLOCK_MISMATCH_COUNT").check).toContain("clock.stepClockMismatchCount");
    expect(row("MAX_FRAME_CLAIM_MISMATCH_COUNT").check).toContain("score.frameClaimMismatchCount");
    expect(row("MAX_FRAME_CLAIM_MISMATCH_COUNT").check).toContain("clock.frameClaimMismatchCount");
  });

  test("every threshold value is 0 (the zero-thresholds design)", () => {
    for (const key of Object.keys(THRESHOLDS)) {
      expect(THRESHOLDS[key as keyof typeof THRESHOLDS]).toBe(0);
    }
    for (const row of rows) {
      expect(row.value).toBe("0");
    }
  });
});

describe("the doc documents the design essentials", () => {
  test("the mirroring statement, the policy, and the honest limitations exist", () => {
    expect(DOC).toContain("pinned row-for-row");
    expect(DOC).toContain("## §1 Policy");
    expect(DOC).toContain("## §3 The zero-threshold derivation");
    expect(DOC).toContain("## §4 The threshold table");
    expect(DOC).toContain("## §5 Evaluation flow and exit codes");
    expect(DOC).toContain("## §6 Honest limitations");
    expect(DOC).toContain("MAX_FINDINGS");
    expect(DOC).toContain("INTERPOLATION_TIME_EPSILON_MS");
  });
});
