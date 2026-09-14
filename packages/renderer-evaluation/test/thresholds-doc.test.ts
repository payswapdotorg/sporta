/**
 * The threshold-document pin test (W503): THRESHOLDS.md §4's table is
 * pinned row-for-row to `src/thresholds.ts` (both directions, order
 * preserving — the W403 TOLERANCE.md convention). A change to either side
 * without the other fails the suite: no silent threshold drift.
 *
 * Additionally, every check row in the document is pinned to the report's
 * actual check construction (metric name, operator, threshold value), so
 * the documented thresholds and the executed verdict checks cannot diverge.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THRESHOLDS, evaluateRenderOutput, renderW503CleanFixture } from "../src/index";

/** The THRESHOLDS.md document (read once, synchronously — a test fixture). */
const DOC: string = readFileSync(join(import.meta.dir, "..", "THRESHOLDS.md"), "utf8");

/** One row of the §4 table. */
interface DocRow {
  constant: string;
  value: string;
  check: string;
  line: string;
}

/** Parses the §4 threshold table rows from THRESHOLDS.md. */
function parseDocRows(doc: string): DocRow[] {
  const rows: DocRow[] = [];
  for (const line of doc.split("\n")) {
    // Rows look like: `| CONSTANT_NAME | value | check | rationale |`
    const match = /^\|\s*([A-Z][A-Z_0-9]*)\s*\|([^|]+)\|([^|]+)\|/.exec(line);
    if (match === null) continue;
    rows.push({
      constant: match[1]!,
      value: match[2]!.trim(),
      check: match[3]!.trim(),
      line,
    });
  }
  return rows;
}

describe("THRESHOLDS.md ↔ THRESHOLDS (code) pin", () => {
  const rows = parseDocRows(DOC);

  test("the document table is present and complete (24 rows)", () => {
    expect(rows.length).toBe(24);
  });

  test("every document row matches the code constant (value, order)", () => {
    const keys = Object.keys(THRESHOLDS);
    expect(keys).toHaveLength(24);
    expect(rows.map((row) => row.constant)).toEqual(keys);
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
});

describe("THRESHOLDS.md ↔ the executed verdict checks pin", () => {
  const rows = parseDocRows(DOC);
  const report = evaluateRenderOutput(renderW503CleanFixture());
  const checksByMetric = new Map(report.verdict.checks.map((check) => [check.metric, check]));

  test("every check row matches an executed check (metric, operator, threshold)", () => {
    let checkRows = 0;
    for (const row of rows) {
      if (row.check === "bound parameter") continue;
      checkRows += 1;
      const match = /^(.+?)\s(<=|>=)\s(.+)$/.exec(row.check);
      expect(match).not.toBeNull();
      const metric = match![1]!;
      const operator = match![2] === "<=" ? "max" : "min";
      const threshold = Number(match![3]!);
      const check = checksByMetric.get(metric);
      expect(check).toBeDefined();
      expect(check!.operator).toBe(operator);
      expect(check!.threshold).toBe(threshold);
    }
    // 21 checks: 20 unconditional + the conditional styleBytes check.
    expect(checkRows).toBe(21);
    expect(report.verdict.checks).toHaveLength(21);
  });

  test("the three bound parameters are exactly the drift bound inputs", () => {
    expect(THRESHOLDS.PLAYER_MAX_SPEED_MPS).toBe(12.5);
    expect(THRESHOLDS.BALL_MAX_SPEED_MPS).toBe(40);
    expect(THRESHOLDS.POSITION_EPSILON_METERS).toBe(0.01);
    // The bound the geometry metrics actually applied (echoed in the report).
    const player = report.geometry.perEntity.find((entity) => entity.entityId === "player-7")!;
    expect(player.bound.maxSpeedMps).toBe(THRESHOLDS.PLAYER_MAX_SPEED_MPS);
    expect(player.bound.epsilonMeters).toBe(THRESHOLDS.POSITION_EPSILON_METERS);
    const ball = report.geometry.perEntity.find((entity) => entity.entityId === "ball-1")!;
    expect(ball.bound.maxSpeedMps).toBe(THRESHOLDS.BALL_MAX_SPEED_MPS);
  });

  test("the §4 rows keep the machine-parseable 4-column shape (no pipes inside cells)", () => {
    for (const row of rows) {
      // 4 cells means split("|") has 6 elements (leading + trailing).
      expect(row.line.split("|")).toHaveLength(6);
    }
  });
});
