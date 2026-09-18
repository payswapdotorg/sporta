/**
 * The policy-document pin test (the W503/W403 convention): docs/GATES.md's
 * §2 policy table is pinned row-for-row to `src/policy.ts` GATE_POLICY
 * (both directions, order-preserving), and the §3 checklist is pinned to
 * HUMAN_CHECKLIST. A change to either side without the other fails the
 * suite: no silent policy drift.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GATE_POLICY, GATE_POLICY_VERSION, HUMAN_CHECKLIST } from "../src/index";

/** The GATES.md document. */
const DOC: string = readFileSync(join(import.meta.dir, "..", "docs", "GATES.md"), "utf8");

/** One policy row parsed from §2. */
interface DocRow {
  id: string;
  source: string;
  blocking: string;
}

/** Parses the §2 table rows (| id | source | blocking |). */
function parsePolicyRows(doc: string): DocRow[] {
  const rows: DocRow[] = [];
  for (const line of doc.split("\n")) {
    const match = /^\|\s*([a-z-]+)\s*\|\s*(@[^|]+?)\s*\|\s*(blocking|advisory)\s*\|/.exec(line);
    if (match === null) continue;
    rows.push({ id: match[1]!, source: match[2]!.trim(), blocking: match[3]! });
  }
  return rows;
}

describe("GATES.md §2 ↔ GATE_POLICY pin", () => {
  const rows = parsePolicyRows(DOC);

  test("the document table is present and complete", () => {
    expect(rows.length).toBe(GATE_POLICY.length);
    expect(rows.length).toBe(4);
  });

  test("row-for-row, order-preserving, both directions", () => {
    expect(rows.map((r) => r.id)).toEqual(GATE_POLICY.map((p) => p.id));
    for (let i = 0; i < rows.length; i += 1) {
      expect(rows[i]!.source).toBe(GATE_POLICY[i]!.source);
      expect(rows[i]!.blocking).toBe(GATE_POLICY[i]!.blocking ? "blocking" : "advisory");
    }
  });

  test("the version string appears in the document", () => {
    expect(DOC).toContain(GATE_POLICY_VERSION);
  });

  test("teeth: a missing row fails the pin (not vacuous)", () => {
    const stripped = parsePolicyRows(DOC.replace(/^\| human-review.*$/m, ""));
    expect(stripped.length).toBe(rows.length - 1);
  });
});

describe("REVIEW.md checklist ↔ HUMAN_CHECKLIST pin", () => {
  test("every checklist item appears in the review document", () => {
    const review = readFileSync(join(import.meta.dir, "..", "docs", "REVIEW.md"), "utf8");
    for (const item of HUMAN_CHECKLIST) {
      expect(review).toContain(item);
    }
  });
});
