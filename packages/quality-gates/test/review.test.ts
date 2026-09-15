/**
 * The human-review record contract tests: the fail-closed validation
 * (every malformed shape throws the typed error with the JSON path —
 * never a silent coercion), the completeness accounting, and the
 * reviewer semantics that keep a self-check record from masquerading as
 * a human attestation.
 */
import { describe, expect, test } from "bun:test";
import { QualityGateError } from "../src/errors";
import {
  HUMAN_REVIEW_CHECKLIST,
  REVIEW_BOUNDS,
  REVIEW_RECORD_SCHEMA_TAG,
  SELF_CHECK_REVIEWER_ID,
  reviewRecordCompleteness,
  validateHumanReviewRecord,
} from "../src/review";
import { incompleteDemoRecord, loadDemoRecord, rejectingDemoRecord } from "./helpers";

/** Asserts that validating `record` throws with `code` and `path`. */
function expectMalformed(record: unknown, path: string, fragment: string): void {
  try {
    validateHumanReviewRecord(record);
    throw new Error("expected validateHumanReviewRecord to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(QualityGateError);
    const qualityGateError = error as QualityGateError;
    expect(qualityGateError.code).toBe("review-record-malformed");
    expect(qualityGateError.path).toBe(path);
    expect(qualityGateError.reason).toContain(fragment);
  }
}

describe("the checked-in self-check record validates (the demo run's input)", () => {
  test("it is structurally valid and complete, and honestly marked", () => {
    const record = validateHumanReviewRecord(loadDemoRecord());
    expect(record.isHumanAttestation).toBe(false);
    expect(record.reviewer).toBe(SELF_CHECK_REVIEWER_ID);
    expect(record.reviewedAt).toBe("2025-01-06");
    expect(record.checklistResults.length).toBe(HUMAN_REVIEW_CHECKLIST.length);
    const completeness = reviewRecordCompleteness(record);
    expect(completeness.complete).toBe(true);
    expect(completeness.missingItemIds).toEqual([]);
    for (const result of record.checklistResults) {
      expect(result.result).toBe("pass");
    }
  });
});

describe("structural validation — malformed records throw with the JSON path", () => {
  test("rejects a non-object record", () => {
    expectMalformed("nope", "$", "must be an object");
  });

  test("rejects a missing field (strict key set)", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    const { scope, ...withoutScope } = record;
    expect(scope).toBeDefined();
    expectMalformed(withoutScope, "$", "key set");
  });

  test("rejects an unknown field (strict key set)", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    expectMalformed({ ...record, extra: 1 }, "$", "key set");
  });

  test("rejects a wrong schema tag", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    expectMalformed(
      { ...record, schemaTag: "sporta/other@1" },
      "$.schemaTag",
      REVIEW_RECORD_SCHEMA_TAG,
    );
  });

  test("rejects an empty and an over-long recordId", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    expectMalformed({ ...record, recordId: "" }, "$.recordId", "non-empty");
    expectMalformed(
      { ...record, recordId: "x".repeat(REVIEW_BOUNDS.maxRecordIdLength + 1) },
      "$.recordId",
      "at most",
    );
  });

  test("rejects a non-boolean isHumanAttestation", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    expectMalformed({ ...record, isHumanAttestation: "false" }, "$.isHumanAttestation", "boolean");
  });

  test("rejects a self-check record masquerading under a human name", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    expectMalformed({ ...record, reviewer: "Jane Reviewer" }, "$.reviewer", "reserved reviewer");
  });

  test("rejects a human attestation signed by the reserved self-check id", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    expectMalformed(
      { ...record, isHumanAttestation: true },
      "$.reviewer",
      "cannot sign a human attestation",
    );
  });

  test("rejects impossible calendar dates (pure arithmetic, no Date object)", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    expectMalformed({ ...record, reviewedAt: "2025-13-01" }, "$.reviewedAt", "calendar date");
    expectMalformed({ ...record, reviewedAt: "2025-02-30" }, "$.reviewedAt", "calendar date");
    expectMalformed({ ...record, reviewedAt: "2025-02-29" }, "$.reviewedAt", "calendar date");
    expectMalformed({ ...record, reviewedAt: "2025-2-3" }, "$.reviewedAt", "calendar date");
    expectMalformed({ ...record, reviewedAt: "01-01-2025" }, "$.reviewedAt", "calendar date");
  });

  test("accepts a real leap day (2024-02-29) and rejects a fake one (2023-02-29)", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    const leapDay = validateHumanReviewRecord({ ...record, reviewedAt: "2024-02-29" });
    expect(leapDay.reviewedAt).toBe("2024-02-29");
    expectMalformed({ ...record, reviewedAt: "2023-02-29" }, "$.reviewedAt", "calendar date");
  });

  test("rejects non-array checklistResults", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    expectMalformed({ ...record, checklistResults: "all pass" }, "$.checklistResults", "array");
  });

  test("rejects more results than checklist items", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    const results = record.checklistResults as Record<string, unknown>[];
    expectMalformed(
      { ...record, checklistResults: [...results, { ...results[0]! }] },
      "$.checklistResults",
      "exceed",
    );
  });

  test("rejects an unknown checklist item id", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    const results = record.checklistResults as Record<string, unknown>[];
    expectMalformed(
      { ...record, checklistResults: results.map((r) => ({ ...r, itemId: "vibes" })) },
      "$.checklistResults[0].itemId",
      "not a checklist item",
    );
  });

  test("rejects a duplicate checklist item", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    const results = record.checklistResults as Record<string, unknown>[];
    expectMalformed(
      {
        ...record,
        checklistResults: [results[0]!, { ...results[1]!, itemId: results[0]!.itemId }],
      },
      "$.checklistResults[1].itemId",
      "duplicate",
    );
  });

  test("rejects an out-of-vocabulary result value", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    const results = record.checklistResults as Record<string, unknown>[];
    expectMalformed(
      { ...record, checklistResults: results.map((r) => ({ ...r, result: "PASS" })) },
      "$.checklistResults[0].result",
      '"pass" or "fail"',
    );
  });

  test("rejects an item-result object with an unknown key", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    const results = record.checklistResults as Record<string, unknown>[];
    expectMalformed(
      { ...record, checklistResults: results.map((r) => ({ ...r, weight: 2 })) },
      "$.checklistResults[0]",
      "key set",
    );
  });

  test("rejects over-long notes (record-level and item-level bounds bite)", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    expectMalformed(
      { ...record, notes: "x".repeat(REVIEW_BOUNDS.maxNotesLength + 1) },
      "$.notes",
      "at most",
    );
    const results = record.checklistResults as Record<string, unknown>[];
    expectMalformed(
      {
        ...record,
        checklistResults: results.map((r) => ({
          ...r,
          notes: "x".repeat(REVIEW_BOUNDS.maxItemNotesLength + 1),
        })),
      },
      "$.checklistResults[0].notes",
      "at most",
    );
  });
});

describe("completeness — a valid record may still be unfinished", () => {
  test("the demo record minus one item is incomplete with exactly that item missing", () => {
    const record = validateHumanReviewRecord(incompleteDemoRecord());
    const completeness = reviewRecordCompleteness(record);
    expect(completeness.complete).toBe(false);
    expect(completeness.missingItemIds).toEqual(["release-signoff"]);
  });

  test("an empty checklistResults array answers nothing (complete: false, all missing)", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    const empty = validateHumanReviewRecord({ ...record, checklistResults: [] });
    const completeness = reviewRecordCompleteness(empty);
    expect(completeness.complete).toBe(false);
    expect(completeness.missingItemIds).toEqual(HUMAN_REVIEW_CHECKLIST.map((item) => item.itemId));
  });

  test("a completed record with one failed item is still structurally complete", () => {
    const record = validateHumanReviewRecord(rejectingDemoRecord());
    expect(reviewRecordCompleteness(record).complete).toBe(true);
    const failed = record.checklistResults.filter((result) => result.result === "fail");
    expect(failed.map((result) => result.itemId)).toEqual(["release-signoff"]);
  });
});

describe("a human attestation record is a first-class citizen of the format", () => {
  test("a complete human record (real reviewer, isHumanAttestation true) validates", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    const human = validateHumanReviewRecord({
      ...record,
      recordId: "w803-production-human-review",
      reviewer: "Jane Reviewer",
      isHumanAttestation: true,
      scope: "release candidate rc-1: the same fixture set, humanly inspected",
    });
    expect(human.isHumanAttestation).toBe(true);
    expect(human.reviewer).toBe("Jane Reviewer");
    expect(reviewRecordCompleteness(human).complete).toBe(true);
  });

  test("per-item notes are optional (a {itemId, result} entry is valid)", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    const results = record.checklistResults as Record<string, unknown>[];
    const terse = validateHumanReviewRecord({
      ...record,
      checklistResults: results.map((entry) => ({ itemId: entry.itemId, result: entry.result })),
    });
    for (const result of terse.checklistResults) {
      expect(result.notes).toBeUndefined();
    }
    expect(reviewRecordCompleteness(terse).complete).toBe(true);
  });
});
