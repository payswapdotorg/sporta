/**
 * The document pin tests (the W503 THRESHOLDS.md / W802 SLOs.md
 * convention, both directions — a change to either side without the other
 * fails the suite; no silent drift):
 *
 * - docs/GATES.md §1's gate policy table ↔ `src/policy.ts` `GATE_POLICY`
 *   (gateId, sourcePackage, blocking, notRunnableOutcome, description —
 *   row-for-row, order preserving);
 * - docs/REVIEW.md §1's checklist table ↔ `src/review.ts`
 *   `HUMAN_REVIEW_CHECKLIST` (itemId, requirement — row-for-row);
 * - docs/REVIEW.md §2's bounds table ↔ `REVIEW_BOUNDS` (row-for-row);
 * - docs/GATES.md must carry the §boundaries section (the honesty
 *   boundaries are part of the contract, not optional prose).
 *
 * Plus the gate policy's fail-closed validation teeth: every illegal
 * policy shape is rejected with the typed error and JSON path.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GATE_POLICY, validateGatePolicy } from "../src/policy";
import type { GatePolicy } from "../src/policy";
import { HUMAN_REVIEW_CHECKLIST, REVIEW_BOUNDS } from "../src/review";
import { QualityGateError } from "../src/errors";

/** One markdown document (read once, synchronously — a test fixture). */
const GATES_DOC: string = readFileSync(join(import.meta.dir, "..", "docs", "GATES.md"), "utf8");
const REVIEW_DOC: string = readFileSync(join(import.meta.dir, "..", "docs", "REVIEW.md"), "utf8");

/** Parses one table row line into its trimmed cells (null when not a row). */
function rowCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  const cells = trimmed
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

/** True iff the row is a markdown table separator (`| --- | --- |`). */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length >= 2 && cells.every((cell) => /^-+$/.test(cell) || cell === "");
}

/**
 * Extracts the data rows of the FIRST table whose header cells equal
 * `headerCells` (compared joined) — robust to prettier's cell padding.
 */
function tableAfter(doc: string, headerCells: readonly string[]): string[][] {
  const lines = doc.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const cells = rowCells(lines[i]!);
    if (cells === null) continue;
    if (cells.join("|") !== headerCells.join("|")) continue;
    const data: string[][] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = rowCells(lines[j]!);
      if (next === null) break;
      if (isSeparatorRow(next)) continue;
      data.push(next);
    }
    return data;
  }
  return [];
}

describe("GATES.md §1 ↔ GATE_POLICY (code) pin", () => {
  const rows = tableAfter(GATES_DOC, [
    "gateId",
    "source package",
    "blocking",
    "not-runnable outcome",
    "description",
  ]);

  test("the policy table is present and complete (4 rows, 5 columns)", () => {
    expect(rows.length).toBe(4);
    for (const row of rows) expect(row.length).toBe(5);
  });

  test("every document row matches the code policy (row-for-row, order preserving)", () => {
    expect(GATE_POLICY.gates.length).toBe(4);
    for (let i = 0; i < 4; i += 1) {
      const docRow = rows[i]!;
      const codeRow = GATE_POLICY.gates[i]!;
      expect(docRow[0]).toBe(codeRow.gateId);
      expect(docRow[1]).toBe(codeRow.sourcePackage);
      expect(docRow[2]).toBe(codeRow.blocking ? "yes" : "no");
      expect(docRow[3]).toBe(codeRow.notRunnableOutcome);
      expect(docRow[4]).toBe(codeRow.description);
    }
  });

  test("every code policy row appears in the document (both directions)", () => {
    const documentedGateIds = rows.map((row) => row[0]);
    for (const entry of GATE_POLICY.gates) {
      expect(documentedGateIds.includes(entry.gateId)).toBe(true);
    }
  });

  test("the policy version is documented", () => {
    expect(GATES_DOC).toContain("w803-gate-policy@1");
    expect(GATE_POLICY.version).toBe("w803-gate-policy@1");
  });
});

describe("REVIEW.md ↔ src/review.ts pin", () => {
  const checklistRows = tableAfter(REVIEW_DOC, ["itemId", "requirement"]);
  const boundsRows = tableAfter(REVIEW_DOC, ["bound", "value"]);

  test("the checklist table is present and complete (7 rows)", () => {
    expect(checklistRows.length).toBe(7);
    for (const row of checklistRows) expect(row.length).toBe(2);
  });

  test("every checklist row matches the code checklist (row-for-row, order preserving)", () => {
    expect(HUMAN_REVIEW_CHECKLIST.length).toBe(7);
    for (let i = 0; i < 7; i += 1) {
      expect(checklistRows[i]![0]).toBe(HUMAN_REVIEW_CHECKLIST[i]!.itemId);
      expect(checklistRows[i]![1]).toBe(HUMAN_REVIEW_CHECKLIST[i]!.requirement);
    }
  });

  test("every code checklist item appears in the document (both directions)", () => {
    const documented = new Set(checklistRows.map((row) => row[0]));
    for (const item of HUMAN_REVIEW_CHECKLIST) {
      expect(documented.has(item.itemId)).toBe(true);
    }
  });

  test("the bounds table matches REVIEW_BOUNDS (row-for-row)", () => {
    expect(boundsRows.length).toBe(5);
    const codeEntries = Object.entries(REVIEW_BOUNDS);
    expect(codeEntries.length).toBe(5);
    for (let i = 0; i < codeEntries.length; i += 1) {
      const [bound, value] = codeEntries[i]!;
      expect(boundsRows[i]![0]).toBe(bound);
      expect(boundsRows[i]![1]).toBe(String(value));
    }
  });

  test("the checklist version and record schema tag are documented", () => {
    expect(REVIEW_DOC).toContain("w803-review-checklist@1");
    expect(REVIEW_DOC).toContain("sporta/quality-gates/human-review@1");
  });
});

describe("the honesty boundaries are part of the contract", () => {
  test("GATES.md carries the §boundaries section with the four boundary rules", () => {
    expect(/^## boundaries\b/m.test(GATES_DOC)).toBe(true);
    expect(GATES_DOC).toContain("nothing more");
    expect(GATES_DOC).toContain("cannot verify review QUALITY");
    expect(GATES_DOC).toContain("No new thresholds anywhere");
    expect(GATES_DOC).toContain("fixtures, not production traffic");
  });

  test("REVIEW.md restates the self-check-record boundary", () => {
    expect(REVIEW_DOC).toContain("NOT a claim that a human reviewed");
    expect(REVIEW_DOC).toContain("automated-pipeline-self-check");
    expect(REVIEW_DOC).toContain("isHumanAttestation");
  });
});

describe("validateGatePolicy — the fail-closed admission teeth", () => {
  test("the canonical policy validates and is returned verbatim", () => {
    const validated = validateGatePolicy(GATE_POLICY);
    expect(validated.version).toBe(GATE_POLICY.version);
    expect(validated.gates).toEqual(GATE_POLICY.gates);
  });

  /** Clones the canonical policy with one row overridden. */
  function withGate(gateId: string, patch: Partial<Record<string, unknown>>): GatePolicy {
    return {
      ...GATE_POLICY,
      gates: GATE_POLICY.gates.map((entry) =>
        entry.gateId === gateId ? { ...entry, ...patch } : entry,
      ),
    };
  }

  /** Asserts that validating `policy` throws a QualityGateError. */
  function expectRejected(policy: unknown, fragment: string): void {
    try {
      validateGatePolicy(policy);
      throw new Error("expected validateGatePolicy to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(QualityGateError);
      const qualityGateError = error as QualityGateError;
      expect(qualityGateError.code).toBe("gate-policy-malformed");
      expect(qualityGateError.path.length).toBeGreaterThan(0);
      expect(qualityGateError.reason).toContain(fragment);
    }
  }

  test("rejects a non-object policy", () => {
    expectRejected("not a policy", "must be an object");
  });

  test("rejects a wrong root key set", () => {
    expectRejected({ ...GATE_POLICY, extra: true }, "key set");
  });

  test("rejects a missing version", () => {
    expectRejected({ gates: GATE_POLICY.gates }, "key set");
  });

  test("rejects a gate row count that breaks totality", () => {
    expectRejected({ version: "x@1", gates: GATE_POLICY.gates.slice(0, 3) }, "exactly 4 gate rows");
  });

  test("rejects an unknown gate id (closed vocabulary)", () => {
    expectRejected(
      {
        version: "x@1",
        gates: [
          ...GATE_POLICY.gates.slice(0, 3),
          { ...GATE_POLICY.gates[3]!, gateId: "vibe-check" },
        ],
      },
      "not a known gate id",
    );
  });

  test("rejects a duplicate gate id", () => {
    expectRejected(
      {
        version: "x@1",
        gates: [
          ...GATE_POLICY.gates.slice(0, 3),
          { ...GATE_POLICY.gates[3]!, gateId: "temporal-stability" },
        ],
      },
      "duplicate gate id",
    );
  });

  test("rejects a row with an unknown key", () => {
    expectRejected(withGate("temporal-stability", { weight: 3 }), "key set");
  });

  test("rejects a non-boolean blocking flag", () => {
    expectRejected(withGate("temporal-stability", { blocking: "yes" }), "must be a boolean");
  });

  test("rejects an illegal not-runnable outcome", () => {
    expectRejected(
      withGate("temporal-stability", { notRunnableOutcome: "ignore" }),
      'must be "fail" or "pending-human-review"',
    );
  });

  test("rejects a non-blocking human gate (never PASS without review)", () => {
    expectRejected(withGate("human-quality-checks", { blocking: false }), "human-quality-checks");
  });

  test("rejects a human gate that counts not-runnable as fail", () => {
    expectRejected(
      withGate("human-quality-checks", { notRunnableOutcome: "fail" }),
      "human-quality-checks",
    );
  });

  test("rejects an advisory accounting gate", () => {
    expectRejected(withGate("gate-accounting", { blocking: false }), "gate-accounting");
  });

  test("rejects a machine gate that maps not-runnable to pending", () => {
    expectRejected(
      withGate("scene-correctness", { notRunnableOutcome: "pending-human-review" }),
      "scene-correctness",
    );
  });
});
