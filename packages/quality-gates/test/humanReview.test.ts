/**
 * The REVIEW.md pin, both directions (the THRESHOLDS.md convention): §1's
 * human checklist table and §2's self-check checklist table mirror the
 * code checklists row-for-row (itemId AND requirement, order-preserving);
 * §3's identity table mirrors the record format constants and bounds.
 * The record VALIDATION is then proven fail-closed: every malformation
 * class throws the typed error with the JSON path, and the two accounted
 * semantic outcomes (incomplete coverage; failing items) are structured
 * results — never passes, never silently skipped.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HUMAN_REVIEW_CHECKLIST,
  HUMAN_REVIEW_CHECKLIST_ID,
  HUMAN_REVIEW_RECORD_SCHEMA_TAG,
  MAX_CHECKLIST_RESULTS,
  MAX_FIXTURE_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_REVIEWER_FIELD_LENGTH,
  MAX_SCENE_RUNS,
  QualityGateError,
  SELF_CHECK_CHECKLIST,
  SELF_CHECK_CHECKLIST_ID,
  checkChecklistCoverage,
  checklistForKind,
  validateHumanReviewRecord,
  type HumanReviewRecord,
} from "../src/index";

const DOC: string = readFileSync(join(import.meta.dir, "..", "docs", "REVIEW.md"), "utf8");

/** One section of the document (split on the `## ` headers). */
function section(header: string): string {
  const start = DOC.indexOf(header);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = DOC.slice(start);
  const next = rest.indexOf("\n## ");
  return next === -1 ? rest : rest.slice(0, next);
}

/** One parsed checklist table row (2 columns: itemId | requirement). */
interface DocChecklistRow {
  readonly itemId: string;
  readonly requirement: string;
}

/** Parses the checklist rows of one section's 2-column table. */
function checklistRowsOf(header: string): DocChecklistRow[] {
  const rows: DocChecklistRow[] = [];
  for (const line of section(header).split("\n")) {
    const match = /^\|\s*([a-z][a-z0-9-]*)\s*\|\s*([^|]+?)\s*\|\s*$/.exec(line);
    if (match === null) continue;
    if (match[1] === "itemId" || match[1] === "field") continue; // the header row
    rows.push({ itemId: match[1]!, requirement: match[2]! });
  }
  return rows;
}

/** The §3 identity table's values (field → value). */
const identityRows = new Map<string, string>();
for (const line of section("## 3. The review record format").split("\n")) {
  const match = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/.exec(line);
  if (match === null) continue;
  identityRows.set(match[1]!.trim(), match[2]!.trim());
}

/** The checked-in demo record (the automated pipeline self-check). */
const DEMO_RECORD: unknown = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "fixtures", "human-review-self-check.json"), "utf8"),
);

/** A minimal valid self-check record, overridable per test. */
function selfCheckRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaTag: HUMAN_REVIEW_RECORD_SCHEMA_TAG,
    recordKind: "automated-pipeline-self-check",
    checklistId: SELF_CHECK_CHECKLIST_ID,
    reviewer: { name: "test reviewer", role: "test role" },
    date: "2026-09-16",
    checklistResults: SELF_CHECK_CHECKLIST.items.map((item) => ({
      itemId: item.itemId,
      result: "pass",
    })),
    notes: "",
    ...overrides,
  };
}

/** Expects validateHumanReviewRecord to throw with code + path prefix. */
function expectMalformed(record: unknown, path: string): void {
  let thrown: unknown;
  try {
    validateHumanReviewRecord(record);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(QualityGateError);
  const error = thrown as QualityGateError;
  expect(error.code).toBe("record-malformed");
  expect(error.path).toBe(path);
}

describe("REVIEW.md mirrors the code checklists (row-for-row, order-preserving, both directions)", () => {
  test("§1's table mirrors HUMAN_REVIEW_CHECKLIST exactly", () => {
    expect(checklistRowsOf("## 1. The human-review checklist")).toEqual(
      HUMAN_REVIEW_CHECKLIST.items.map((item) => ({
        itemId: item.itemId,
        requirement: item.requirement,
      })),
    );
  });

  test("§2's table mirrors SELF_CHECK_CHECKLIST exactly", () => {
    expect(checklistRowsOf("## 2. The automated pipeline self-check checklist")).toEqual(
      SELF_CHECK_CHECKLIST.items.map((item) => ({
        itemId: item.itemId,
        requirement: item.requirement,
      })),
    );
  });

  test("§3's identity table mirrors the record format constants and bounds", () => {
    expect(identityRows.get("record schema tag")).toBe(HUMAN_REVIEW_RECORD_SCHEMA_TAG);
    expect(identityRows.get("human checklist id")).toBe(HUMAN_REVIEW_CHECKLIST_ID);
    expect(identityRows.get("self-check checklist id")).toBe(SELF_CHECK_CHECKLIST_ID);
    expect(identityRows.get("notes bound (characters)")).toBe(String(MAX_NOTES_LENGTH));
    expect(identityRows.get("reviewer name bound (characters)")).toBe(
      String(MAX_REVIEWER_FIELD_LENGTH),
    );
    expect(identityRows.get("reviewer role bound (characters)")).toBe(
      String(MAX_REVIEWER_FIELD_LENGTH),
    );
    expect(identityRows.get("checklist results bound (entries)")).toBe(
      String(MAX_CHECKLIST_RESULTS),
    );
    expect(identityRows.get("release-input fixture name bound (characters)")).toBe(
      String(MAX_FIXTURE_NAME_LENGTH),
    );
    expect(identityRows.get("release-input scene runs bound (fixtures)")).toBe(
      String(MAX_SCENE_RUNS),
    );
  });

  test("the two checklists map 1:1 by position (the doc's §2 mapping table is positional)", () => {
    expect(HUMAN_REVIEW_CHECKLIST.items).toHaveLength(4);
    expect(SELF_CHECK_CHECKLIST.items).toHaveLength(4);
    for (let index = 0; index < 4; index += 1) {
      const human = HUMAN_REVIEW_CHECKLIST.items[index]!;
      const selfCheck = SELF_CHECK_CHECKLIST.items[index]!;
      const sameHead = human.itemId.split("-").slice(0, 2).join("-");
      expect(selfCheck.itemId.startsWith(sameHead)).toBe(true);
    }
    // The report-read item is shared verbatim by both kinds.
    expect(HUMAN_REVIEW_CHECKLIST.items[3]!.itemId).toBe("gate-report-read");
    expect(SELF_CHECK_CHECKLIST.items[3]!.itemId).toBe("gate-report-read");
    expect(checklistForKind("human-review")).toBe(HUMAN_REVIEW_CHECKLIST);
    expect(checklistForKind("automated-pipeline-self-check")).toBe(SELF_CHECK_CHECKLIST);
  });
});

describe("the checked-in demo record — the honestly-completed self-check", () => {
  test("validates, completes the self-check checklist, and passes every item", () => {
    const record = validateHumanReviewRecord(DEMO_RECORD);
    expect(record.recordKind).toBe("automated-pipeline-self-check");
    expect(record.checklistId).toBe(SELF_CHECK_CHECKLIST_ID);
    const coverage = checkChecklistCoverage(record);
    expect(coverage.complete).toBe(true);
    expect(coverage.missingItems).toEqual([]);
    expect(coverage.extraItems).toEqual([]);
    expect(record.checklistResults.every((result) => result.result === "pass")).toBe(true);
    expect(record.notes.length).toBeLessThanOrEqual(MAX_NOTES_LENGTH);
  });

  test("is clearly marked as the automated pipeline self-check — never a human attestation", () => {
    const record = validateHumanReviewRecord(DEMO_RECORD);
    expect(record.recordKind).not.toBe("human-review");
    expect(record.reviewer.role).toContain("automated");
    expect(record.notes).toContain("NOT a human attestation");
  });
});

describe("record validation is fail-closed (typed errors with JSON paths)", () => {
  test("a non-object record is malformed at the root", () => {
    expectMalformed("not an object", "$");
    expectMalformed([1, 2, 3], "$");
    expectMalformed(null, "$");
  });

  test("unknown record fields are malformed (no silent extras)", () => {
    expectMalformed(selfCheckRecord({ extra: 1 }), "$.extra");
  });

  test("a wrong schema tag is malformed", () => {
    expectMalformed(selfCheckRecord({ schemaTag: "sporta/other@1" }), "$.schemaTag");
  });

  test("an unknown record kind is malformed", () => {
    expectMalformed(selfCheckRecord({ recordKind: "robot-overlord" }), "$.recordKind");
  });

  test("a checklist id that does not match the record kind is malformed (stale records rejected)", () => {
    expectMalformed(selfCheckRecord({ checklistId: HUMAN_REVIEW_CHECKLIST_ID }), "$.checklistId");
    const humanRecord = selfCheckRecord({
      recordKind: "human-review",
      checklistId: HUMAN_REVIEW_CHECKLIST_ID,
    });
    // The results still cover the SELF-CHECK item ids, so the ids are foreign
    // to the human checklist — but that is an ACCOUNTED incomplete coverage,
    // not malformation; the shape itself is valid. Only the id pairing is
    // structural. (Covered below under coverage.)
    expect(() => validateHumanReviewRecord(humanRecord)).not.toThrow();
  });

  test("reviewer shape violations are malformed at the reviewer path", () => {
    expectMalformed(selfCheckRecord({ reviewer: "nope" }), "$.reviewer");
    expectMalformed(selfCheckRecord({ reviewer: { name: "", role: "x" } }), "$.reviewer.name");
    expectMalformed(selfCheckRecord({ reviewer: { name: "x", role: 7 } }), "$.reviewer.role");
    expectMalformed(
      selfCheckRecord({ reviewer: { name: "x", role: "y", extra: 1 } }),
      "$.reviewer.extra",
    );
  });

  test("reviewer field bounds are enforced", () => {
    expectMalformed(
      selfCheckRecord({ reviewer: { name: "x".repeat(101), role: "y" } }),
      "$.reviewer.name",
    );
    expectMalformed(
      selfCheckRecord({ reviewer: { name: "x", role: "y".repeat(101) } }),
      "$.reviewer.role",
    );
  });

  test("the date must be an authored YYYY-MM-DD string", () => {
    expectMalformed(selfCheckRecord({ date: "2026-9-16" }), "$.date");
    expectMalformed(selfCheckRecord({ date: "2026-13-01" }), "$.date");
    expectMalformed(selfCheckRecord({ date: "2026-09-32" }), "$.date");
    expectMalformed(selfCheckRecord({ date: 20260916 }), "$.date");
    expectMalformed(selfCheckRecord({ date: "16.09.2026" }), "$.date");
  });

  test("checklistResults shape violations are malformed at their paths", () => {
    expectMalformed(selfCheckRecord({ checklistResults: "nope" }), "$.checklistResults");
    expectMalformed(selfCheckRecord({ checklistResults: ["nope"] }), "$.checklistResults[0]");
    expectMalformed(
      selfCheckRecord({ checklistResults: [{ itemId: "x", result: "maybe" }] }),
      "$.checklistResults[0].result",
    );
    expectMalformed(
      selfCheckRecord({ checklistResults: [{ itemId: 7, result: "pass" }] }),
      "$.checklistResults[0].itemId",
    );
    expectMalformed(
      selfCheckRecord({ checklistResults: [{ itemId: "x", result: "pass", extra: 1 }] }),
      "$.checklistResults[0].extra",
    );
  });

  test("duplicate item results are malformed", () => {
    const results = SELF_CHECK_CHECKLIST.items.map((item) => ({
      itemId: item.itemId,
      result: "pass",
    }));
    expectMalformed(
      selfCheckRecord({ checklistResults: [...results, results[0]!] }),
      `$.checklistResults[${results.length}].itemId`,
    );
  });

  test("the results count bound is enforced", () => {
    const filler = Array.from({ length: MAX_CHECKLIST_RESULTS + 1 }, (_, index) => ({
      itemId: `item-${index}`,
      result: "pass" as const,
    }));
    expectMalformed(selfCheckRecord({ checklistResults: filler }), "$.checklistResults");
  });

  test("notes must be a string within the bound", () => {
    expectMalformed(selfCheckRecord({ notes: 42 }), "$.notes");
    const tooLong = "x".repeat(MAX_NOTES_LENGTH + 1);
    expectMalformed(selfCheckRecord({ notes: tooLong }), "$.notes");
  });
});

describe("semantic completeness is an accounted outcome (never an error, never a pass)", () => {
  /** A validated self-check record missing the item at `dropIndex`. */
  function recordMissingItem(dropIndex: number): HumanReviewRecord {
    const raw = selfCheckRecord();
    raw.checklistResults = SELF_CHECK_CHECKLIST.items
      .filter((_, index) => index !== dropIndex)
      .map((item) => ({ itemId: item.itemId, result: "pass" }));
    return validateHumanReviewRecord(raw);
  }

  test("a record missing one checklist item is incomplete, with the missing item accounted", () => {
    const coverage = checkChecklistCoverage(recordMissingItem(3));
    expect(coverage.complete).toBe(false);
    expect(coverage.missingItems).toEqual(["gate-report-read"]);
    expect(coverage.extraItems).toEqual([]);
  });

  test("a record carrying results for items outside the current checklist is incomplete", () => {
    const raw = selfCheckRecord();
    raw.checklistResults = [
      ...SELF_CHECK_CHECKLIST.items.map((item) => ({ itemId: item.itemId, result: "pass" })),
      { itemId: "temporal-clip-visual", result: "pass" },
    ];
    const coverage = checkChecklistCoverage(validateHumanReviewRecord(raw));
    expect(coverage.complete).toBe(false);
    expect(coverage.extraItems).toEqual(["temporal-clip-visual"]);
  });

  test("a human-review record completing the HUMAN checklist validates and covers it", () => {
    const raw = selfCheckRecord({
      recordKind: "human-review",
      checklistId: HUMAN_REVIEW_CHECKLIST_ID,
    });
    raw.checklistResults = HUMAN_REVIEW_CHECKLIST.items.map((item) => ({
      itemId: item.itemId,
      result: "pass",
    }));
    const record = validateHumanReviewRecord(raw);
    expect(record.recordKind).toBe("human-review");
    expect(checkChecklistCoverage(record).complete).toBe(true);
  });
});
