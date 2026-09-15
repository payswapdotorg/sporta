/**
 * The policy-document pin tests (the W503 THRESHOLDS.md convention, both
 * directions): GATES.md §gates ↔ src/gatePolicy.ts GATE_POLICY, GATES.md
 * §structural-bounds ↔ src/bounds.ts STRUCTURAL_BOUNDS, and REVIEW.md
 * §checklist ↔ src/humanReview.ts REVIEW_CHECKLIST. A change to either
 * side without the other fails the suite — no silent policy drift.
 *
 * Plus the no-new-thresholds pins: the public surface exports no
 * THRESHOLDS, and the gate document references (not redefines) the source
 * packages' pinned threshold documents.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECKLIST_VERSION, GATE_POLICY, REVIEW_CHECKLIST, STRUCTURAL_BOUNDS } from "../src/index";
import * as qualityGates from "../src/index";

const GATES_DOC: string = readFileSync(join(import.meta.dir, "..", "GATES.md"), "utf8");
const REVIEW_DOC: string = readFileSync(join(import.meta.dir, "..", "REVIEW.md"), "utf8");

/** One row of the GATES.md §gates table. */
interface GateDocRow {
  gateId: string;
  name: string;
  sourcePackage: string;
  blocking: boolean;
  notRunnableOutcome: string;
}

/** Parses the §gates table (5-column shape; lowercase-dashed ids only — headers excluded). */
function parseGateRows(doc: string): GateDocRow[] {
  const rows: GateDocRow[] = [];
  for (const line of doc.split("\n")) {
    const match =
      /^\|\s*([a-z0-9-]+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*(blocking|advisory)\s*\|\s*(release-fail|pending-human-review)\s*\|/.exec(
        line,
      );
    if (match === null) continue;
    rows.push({
      gateId: match[1]!,
      name: match[2]!.trim(),
      sourcePackage: match[3]!.trim(),
      blocking: match[4]! === "blocking",
      notRunnableOutcome: match[5]!,
    });
  }
  return rows;
}

/** One row of the GATES.md §structural-bounds table. */
interface BoundDocRow {
  name: string;
  value: number;
  purpose: string;
}

/** Parses the §structural-bounds table. */
function parseBoundRows(doc: string): BoundDocRow[] {
  const rows: BoundDocRow[] = [];
  for (const line of doc.split("\n")) {
    const match = /^\|\s*(MAX_[A-Z_]+)\s*\|\s*(\d+)\s*\|\s*([^|]+)\|/.exec(line);
    if (match === null) continue;
    rows.push({ name: match[1]!, value: Number(match[2]!), purpose: match[3]!.trim() });
  }
  return rows;
}

/** One row of the REVIEW.md §checklist table. */
interface ChecklistDocRow {
  itemId: string;
  requirement: string;
}

/** Parses the §checklist table (dotted lowercase ids only — headers and field tables excluded). */
function parseChecklistRows(doc: string): ChecklistDocRow[] {
  const rows: ChecklistDocRow[] = [];
  for (const line of doc.split("\n")) {
    const match = /^\|\s*([a-z0-9-]+\.[a-z0-9.-]+)\s*\|\s*([^|]+)\|/.exec(line);
    if (match === null) continue;
    rows.push({ itemId: match[1]!, requirement: match[2]!.trim() });
  }
  return rows;
}

describe("GATES.md §gates ↔ GATE_POLICY (code) pin", () => {
  const rows = parseGateRows(GATES_DOC);

  test("the document table is present and complete (4 rows)", () => {
    expect(rows.length).toBe(4);
  });

  test("every document row matches the code constant (id, name, package, blocking, outcome, order)", () => {
    expect(GATE_POLICY).toHaveLength(4);
    expect(rows.map((row) => row.gateId)).toEqual(GATE_POLICY.map((entry) => entry.gateId));
    for (const row of rows) {
      const entry = GATE_POLICY.find((candidate) => candidate.gateId === row.gateId)!;
      expect(row.name).toBe(entry.name);
      expect(row.sourcePackage).toBe(entry.sourcePackage);
      expect(row.blocking).toBe(entry.blocking);
      expect(row.notRunnableOutcome).toBe(entry.notRunnableOutcome);
    }
  });

  test("every code constant appears in the document (both directions)", () => {
    const documented = new Set(rows.map((row) => row.gateId));
    for (const entry of GATE_POLICY) {
      expect(documented.has(entry.gateId), `GATE_POLICY gate ${entry.gateId} is undocumented`).toBe(
        true,
      );
    }
  });

  test("the human gate is the only pending-outcome gate in the document", () => {
    const pending = rows.filter((row) => row.notRunnableOutcome === "pending-human-review");
    expect(pending.map((row) => row.gateId)).toEqual(["human-quality-checks"]);
  });
});

describe("GATES.md §structural-bounds ↔ STRUCTURAL_BOUNDS (code) pin", () => {
  const rows = parseBoundRows(GATES_DOC);

  test("the document table is present and complete (5 rows)", () => {
    expect(rows.length).toBe(5);
  });

  test("every document row matches the code constant (name, value, purpose, order)", () => {
    expect(STRUCTURAL_BOUNDS).toHaveLength(5);
    expect(rows.map((row) => row.name)).toEqual(STRUCTURAL_BOUNDS.map((bound) => bound.name));
    for (const row of rows) {
      const bound = STRUCTURAL_BOUNDS.find((candidate) => candidate.name === row.name)!;
      expect(row.value).toBe(bound.value);
      expect(row.purpose).toBe(bound.purpose);
    }
  });

  test("every code constant appears in the document (both directions)", () => {
    const documented = new Set(rows.map((row) => row.name));
    for (const bound of STRUCTURAL_BOUNDS) {
      expect(documented.has(bound.name), `STRUCTURAL_BOUNDS ${bound.name} is undocumented`).toBe(
        true,
      );
    }
  });
});

describe("REVIEW.md §checklist ↔ REVIEW_CHECKLIST (code) pin", () => {
  const rows = parseChecklistRows(REVIEW_DOC);

  test("the document table is present and complete (7 rows)", () => {
    expect(rows.length).toBe(7);
  });

  test("every document row matches the code constant (itemId, requirement, order)", () => {
    expect(REVIEW_CHECKLIST).toHaveLength(7);
    expect(rows.map((row) => row.itemId)).toEqual(REVIEW_CHECKLIST.map((item) => item.itemId));
    for (const row of rows) {
      const item = REVIEW_CHECKLIST.find((candidate) => candidate.itemId === row.itemId)!;
      expect(row.requirement).toBe(item.requirement);
    }
  });

  test("every code constant appears in the document (both directions)", () => {
    const documented = new Set(rows.map((row) => row.itemId));
    for (const item of REVIEW_CHECKLIST) {
      expect(
        documented.has(item.itemId),
        `REVIEW_CHECKLIST item ${item.itemId} is undocumented`,
      ).toBe(true);
    }
  });

  test("the document names the checklist version the code enforces", () => {
    expect(REVIEW_DOC).toContain(CHECKLIST_VERSION);
  });
});

describe("no new thresholds anywhere (the roadmap rule, pinned)", () => {
  test("the public surface exports no THRESHOLDS object", () => {
    expect(Object.keys(qualityGates)).not.toContain("THRESHOLDS");
  });

  test("no src module declares a THRESHOLDS constant", () => {
    const srcIndex = readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8");
    expect(/export\s+\{[^}]*THRESHOLDS/.test(srcIndex)).toBe(false);
  });

  test("GATES.md references the source packages' pinned threshold documents, not its own", () => {
    expect(GATES_DOC).toContain("packages/renderer-evaluation/THRESHOLDS.md");
    expect(GATES_DOC).toContain("packages/scene-evaluation/THRESHOLDS.md");
    // The no-new-thresholds declaration (whitespace-tolerant: the document
    // wraps prose at 100 columns).
    expect(/ZERO\s+new\s+numeric\s+thresholds/.test(GATES_DOC)).toBe(true);
    expect(/No\s+new\s+thresholds\s+anywhere/.test(GATES_DOC)).toBe(true);
  });
});
