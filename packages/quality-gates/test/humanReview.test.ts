/**
 * The fail-closed record-inspector tests: every status class (missing,
 * malformed, incomplete, complete) and every rejection rule (unknown keys,
 * unknown checklist ids, unknown result values, impossible dates,
 * over-bound fields, duplicates) with its typed issue (code + JSON path).
 * Nothing is ever coerced; nothing throws; the checked-in demo record is
 * pinned as complete.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECKLIST_VERSION, HUMAN_RECORD_SCHEMA_TAG, inspectHumanReviewRecord } from "../src/index";

const RECORD_PATH = join(
  import.meta.dir,
  "..",
  "fixtures",
  "human-review",
  "self-check-record.json",
);
const demoRecord: Record<string, unknown> = JSON.parse(readFileSync(RECORD_PATH, "utf8"));

/** A structurally valid record template (per-test perturbations on top). */
function validRecord(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(demoRecord));
}

describe("the missing and non-object classes", () => {
  test("undefined is missing (the absent-record case)", () => {
    const inspection = inspectHumanReviewRecord(undefined);
    expect(inspection.status).toBe("missing");
    expect(inspection.issues).toEqual([]);
    expect(inspection.humanAttested).toBe(false);
  });

  test("non-objects are malformed at the root path", () => {
    for (const garbage of ["looks fine", 42, null, true, ["array"]]) {
      const inspection = inspectHumanReviewRecord(garbage);
      expect(inspection.status, String(garbage)).toBe("malformed");
      expect(inspection.issues[0]?.path, String(garbage)).toBe("$");
      expect(inspection.issues[0]?.code).toBe("not-an-object");
    }
  });
});

describe("the fixed-field rejections (typed code + JSON path each)", () => {
  test("an unknown top-level key is rejected, never partially interpreted", () => {
    const inspection = inspectHumanReviewRecord({ ...validRecord(), extra: "field" });
    expect(inspection.status).toBe("malformed");
    expect(inspection.issues.some((issue) => issue.path === "$.extra")).toBe(true);
    expect(inspection.issues.some((issue) => issue.code === "unknown-key")).toBe(true);
  });

  test("a wrong schema tag is rejected at $.schemaTag", () => {
    const inspection = inspectHumanReviewRecord({ ...validRecord(), schemaTag: "other@9" });
    expect(inspection.status).toBe("malformed");
    expect(inspection.issues.some((issue) => issue.path === "$.schemaTag")).toBe(true);
  });

  test("a wrong record kind is rejected at $.recordKind", () => {
    const inspection = inspectHumanReviewRecord({ ...validRecord(), recordKind: "robot-overlord" });
    expect(inspection.status).toBe("malformed");
    expect(inspection.issues.some((issue) => issue.path === "$.recordKind")).toBe(true);
  });

  test("a wrong checklist version is rejected at $.checklistVersion", () => {
    const inspection = inspectHumanReviewRecord({
      ...validRecord(),
      checklistVersion: "w799-review-checklist-v1",
    });
    expect(inspection.status).toBe("malformed");
    expect(inspection.issues.some((issue) => issue.path === "$.checklistVersion")).toBe(true);
  });

  test("an empty, over-bound, or non-string reviewer is rejected at $.reviewer", () => {
    for (const reviewer of ["", "x".repeat(201), 7]) {
      const inspection = inspectHumanReviewRecord({ ...validRecord(), reviewer });
      expect(inspection.status, String(reviewer)).toBe("malformed");
      expect(inspection.issues.some((issue) => issue.path === "$.reviewer")).toBe(true);
    }
    const bounded = inspectHumanReviewRecord({ ...validRecord(), reviewer: "x".repeat(200) });
    expect(bounded.status).toBe("complete"); // the bound itself is inclusive
  });

  test("impossible dates are rejected at $.reviewedAt (pure arithmetic, no Date)", () => {
    for (const bad of ["not-a-date", "2026-13-01", "2026-02-30", "2100-02-29", "2026-1-1"]) {
      const inspection = inspectHumanReviewRecord({ ...validRecord(), reviewedAt: bad });
      expect(inspection.status, bad).toBe("malformed");
      expect(
        inspection.issues.some((issue) => issue.path === "$.reviewedAt"),
        bad,
      ).toBe(true);
    }
    for (const good of ["2024-02-29", "2000-02-29", "2026-09-15"]) {
      const inspection = inspectHumanReviewRecord({ ...validRecord(), reviewedAt: good });
      expect(inspection.status, good).toBe("complete");
    }
  });

  test("an over-bound scope or notes is rejected at its path", () => {
    const scope = inspectHumanReviewRecord({ ...validRecord(), scope: "s".repeat(2001) });
    expect(scope.status).toBe("malformed");
    expect(scope.issues.some((issue) => issue.path === "$.scope")).toBe(true);
    const notes = inspectHumanReviewRecord({ ...validRecord(), notes: "n".repeat(4001) });
    expect(notes.status).toBe("malformed");
    expect(notes.issues.some((issue) => issue.path === "$.notes")).toBe(true);
  });
});

describe("the per-item rejections", () => {
  test("a non-array or empty items field is rejected at $.items", () => {
    for (const items of ["nope", []]) {
      const inspection = inspectHumanReviewRecord({ ...validRecord(), items });
      expect(inspection.status, String(items)).toBe("malformed");
      expect(inspection.issues.some((issue) => issue.path === "$.items")).toBe(true);
    }
  });

  test("an unknown checklist item id is rejected at the item's path", () => {
    const record = validRecord();
    (record.items as Record<string, unknown>[])[0]!.checklistItemId = "clips.does-not-exist";
    const inspection = inspectHumanReviewRecord(record);
    expect(inspection.status).toBe("malformed");
    expect(inspection.issues.some((issue) => issue.code === "unknown-checklist-item")).toBe(true);
  });

  test("a duplicate checklist item id is rejected", () => {
    const record = validRecord();
    const items = record.items as Record<string, unknown>[];
    items[1]!.checklistItemId = items[0]!.checklistItemId;
    const inspection = inspectHumanReviewRecord(record);
    expect(inspection.status).toBe("malformed");
    expect(inspection.issues.some((issue) => issue.code === "duplicate-checklist-item")).toBe(true);
  });

  test("an unknown result value is rejected at $.items[i].result", () => {
    const record = validRecord();
    (record.items as Record<string, unknown>[])[0]!.result = "mostly-fine";
    const inspection = inspectHumanReviewRecord(record);
    expect(inspection.status).toBe("malformed");
    expect(inspection.issues.some((issue) => issue.path === "$.items[0].result")).toBe(true);
  });

  test("an unknown item key and an over-bound item note are rejected", () => {
    const record = validRecord();
    (record.items as Record<string, unknown>[])[0]!.extra = "field";
    expect(
      inspectHumanReviewRecord(record).issues.some((issue) => issue.code === "unknown-key"),
    ).toBe(true);
    const long = validRecord();
    (long.items as Record<string, unknown>[])[0]!.notes = "n".repeat(2001);
    expect(
      inspectHumanReviewRecord(long).issues.some((issue) => issue.path === "$.items[0].notes"),
    ).toBe(true);
  });

  test("a structurally valid record missing an item is INCOMPLETE with the ids accounted", () => {
    const record = validRecord();
    (record.items as unknown[]).splice(2, 1); // drop clips.w604-directed-fixture
    const inspection = inspectHumanReviewRecord(record);
    expect(inspection.status).toBe("incomplete");
    expect(inspection.missingItemIds).toEqual(["clips.w604-directed-fixture"]);
    expect(inspection.issues[0]?.code).toBe("missing-checklist-item");
  });
});

describe("the complete class (both record kinds are honest records)", () => {
  test("the checked-in demo record is complete, all pass, a pipeline self-check", () => {
    const inspection = inspectHumanReviewRecord(demoRecord);
    expect(inspection.status).toBe("complete");
    expect(inspection.issues).toEqual([]);
    expect(inspection.missingItemIds).toEqual([]);
    expect(inspection.failedItemIds).toEqual([]);
    expect(inspection.record?.schemaTag).toBe(HUMAN_RECORD_SCHEMA_TAG);
    expect(inspection.record?.checklistVersion).toBe(CHECKLIST_VERSION);
    expect(inspection.record?.recordKind).toBe("pipeline-self-check");
    expect(inspection.humanAttested).toBe(false);
  });

  test("a human-review kind record is complete and humanAttested", () => {
    const inspection = inspectHumanReviewRecord({ ...validRecord(), recordKind: "human-review" });
    expect(inspection.status).toBe("complete");
    expect(inspection.humanAttested).toBe(true);
  });

  test("a failed item is a completed review with the failed ids accounted", () => {
    const record = validRecord();
    (record.items as Record<string, unknown>[])[3]!.result = "fail";
    const inspection = inspectHumanReviewRecord(record);
    expect(inspection.status).toBe("complete");
    expect(inspection.failedItemIds).toEqual(["reports.temporal-gate"]);
  });
});
