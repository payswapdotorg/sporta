/**
 * The W803 human quality-checks gate's data: the review CHECKLIST and the
 * review RECORD contract (docs/REVIEW.md is the canonical document — its
 * checklist table and record-field table are pinned row-for-row to this
 * module by `test/policy-doc.test.ts`, both directions).
 *
 * What this layer IS: a fail-closed record of human review HAVING HAPPENED
 * and WHAT was checked. What it is NOT (docs/GATES.md §boundaries): it
 * cannot verify review QUALITY; the checked-in demo record is a pipeline
 * self-check, not a human attestation.
 *
 * The checklist is versioned data ({@link HUMAN_REVIEW_CHECKLIST_VERSION}):
 * a record answers EXACTLY the checked-in checklist, item for item. A
 * record that answers fewer items is INCOMPLETE (never a pass); a record
 * with unknown items, wrong types, or a bad date is MALFORMED (throws,
 * with the JSON path). All string fields are BOUNDED ({@link REVIEW_BOUNDS}).
 */
import { fail } from "./errors";

/** The checklist's version (versioned with the checklist shape). */
export const HUMAN_REVIEW_CHECKLIST_VERSION = "w803-review-checklist@1";

/** The review record's schema tag (versioned with the record shape). */
export const REVIEW_RECORD_SCHEMA_TAG = "sporta/quality-gates/human-review@1";

/**
 * The reserved reviewer id of the automated pipeline self-check record.
 * A record with `isHumanAttestation: false` MUST carry exactly this
 * reviewer (a self-check record can never masquerade under a human's
 * name); a record with `isHumanAttestation: true` MUST NOT carry it.
 */
export const SELF_CHECK_REVIEWER_ID = "automated-pipeline-self-check";

/** The bounds of the review record's string fields (documented in REVIEW.md §2). */
export const REVIEW_BOUNDS = {
  /** recordId length. */
  maxRecordIdLength: 200,
  /** reviewer name length. */
  maxReviewerLength: 200,
  /** scope description length. */
  maxScopeLength: 2000,
  /** one checklist-item note length. */
  maxItemNotesLength: 500,
  /** the record-level notes length. */
  maxNotesLength: 2000,
} as const;

/** One checklist item: what a human reviews and what "pass" means. */
export interface ReviewChecklistItem {
  /** The item's stable id (referenced by record results). */
  readonly itemId: string;
  /** The requirement, mirrored verbatim in docs/REVIEW.md §1. */
  readonly requirement: string;
}

/**
 * The W803 review checklist (7 items). Every item's requirement defines
 * BOTH completion paths honestly: a HUMAN record satisfies it by the
 * human doing the thing; an automated SELF-CHECK record satisfies it only
 * by the deterministic verification named in the requirement — and the
 * record's per-item notes must state which path was taken.
 */
export const HUMAN_REVIEW_CHECKLIST: readonly ReviewChecklistItem[] = [
  {
    itemId: "rendered-clip-anime",
    requirement:
      "one rendered clip of the anime renderer path (W502) was inspected: a human viewed the clip, or — self-check record only — the pinned fixture clip was re-rendered and byte-verified deterministically; the item notes state which",
  },
  {
    itemId: "rendered-clip-3d-match",
    requirement:
      "one rendered clip of the 3D match renderer path (W603) was inspected: a human viewed the clip, or — self-check record only — the pinned fixture output was rebuilt through the real seams and byte-verified deterministically; the item notes state which",
  },
  {
    itemId: "rendered-clip-3d-directed",
    requirement:
      "one rendered rundown of the directed renderer path (W604) was inspected: a human viewed the rundown, or — self-check record only — the pinned fixture rundown was rebuilt through the real W604 chain and byte-verified deterministically; the item notes state which",
  },
  {
    itemId: "gate-report-read",
    requirement:
      "the release gate report was read end-to-end — every gate row, every key value, every accounted reason — and every unexplained row was chased to its source report",
  },
  {
    itemId: "machine-gate-evidence-reviewed",
    requirement:
      "the machine gates' failing or edge-case findings were reviewed and every failure was understood (or the release rejected)",
  },
  {
    itemId: "release-scope-verified",
    requirement:
      "the evaluated artifacts match the release scope: the right fixtures, sessions, and renderer versions — nothing extra, nothing missing",
  },
  {
    itemId: "release-signoff",
    requirement:
      "explicit sign-off: the reviewer accepts the release candidate as scoped for this verdict, under the documented boundaries (docs/GATES.md §boundaries)",
  },
];

/** One checklist item's result inside a review record. */
export interface HumanReviewChecklistResult {
  readonly itemId: string;
  readonly result: "pass" | "fail";
  readonly notes?: string;
}

/** A structurally valid, parsed review record (completeness is separate). */
export interface HumanReviewRecord {
  readonly schemaTag: string;
  readonly recordId: string;
  readonly reviewer: string;
  /** The review date, `YYYY-MM-DD` (input data — never a wall-clock read). */
  readonly reviewedAt: string;
  readonly scope: string;
  /** False iff this is the automated pipeline self-check record. */
  readonly isHumanAttestation: boolean;
  readonly checklistResults: readonly HumanReviewChecklistResult[];
  readonly notes: string;
}

/** The record's status as the gate accounts it. */
export type HumanReviewRecordStatus = "present-complete" | "absent" | "malformed" | "incomplete";

/** The record's exact key set (unknown keys are rejected). */
const RECORD_KEYS: readonly string[] = [
  "checklistResults",
  "isHumanAttestation",
  "notes",
  "recordId",
  "reviewedAt",
  "reviewer",
  "schemaTag",
  "scope",
];

/** The item-result's exact key set. */
const RESULT_KEYS: readonly string[] = ["itemId", "notes", "result"];

/** True iff `value` is a string of length 1..max. */
function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}

/** True iff `year` is a leap year (pure — no Date object, no clock). */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The number of days in one month (pure). */
function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

/**
 * Validates a `reviewedAt` date string: `YYYY-MM-DD` with a real calendar
 * date (pure arithmetic — `2025-02-30` and `2023-02-29` are rejected).
 */
function isValidDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Validates a human-review record STRUCTURE fail-closed. Throws
 * {@link QualityGateError} (`review-record-malformed`) with the JSON path
 * of the violation — never a silent coercion, never an ignored unknown
 * field. Structural validity is separate from COMPLETENESS: a valid
 * record may still miss checklist items — check
 * {@link reviewRecordCompleteness} (the incomplete case is accounted by
 * the gate as `PENDING-HUMAN-REVIEW`, not thrown: an unfinished review is
 * a release state, not a caller bug).
 */
export function validateHumanReviewRecord(record: unknown): HumanReviewRecord {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    fail("review-record-malformed", "$", "the review record must be an object");
  }
  const root = record as Record<string, unknown>;
  const keys = Object.keys(root).sort();
  if (keys.length !== RECORD_KEYS.length || !RECORD_KEYS.every((key) => keys.includes(key))) {
    fail(
      "review-record-malformed",
      "$",
      `the record's key set must be exactly {${RECORD_KEYS.join(", ")}} (found {${keys.join(", ")}})`,
    );
  }
  if (root.schemaTag !== REVIEW_RECORD_SCHEMA_TAG) {
    fail(
      "review-record-malformed",
      "$.schemaTag",
      `"${String(root.schemaTag)}" must be "${REVIEW_RECORD_SCHEMA_TAG}"`,
    );
  }
  if (!isBoundedString(root.recordId, REVIEW_BOUNDS.maxRecordIdLength)) {
    fail(
      "review-record-malformed",
      "$.recordId",
      `must be a non-empty string of at most ${REVIEW_BOUNDS.maxRecordIdLength} characters`,
    );
  }
  if (!isBoundedString(root.reviewer, REVIEW_BOUNDS.maxReviewerLength)) {
    fail(
      "review-record-malformed",
      "$.reviewer",
      `must be a non-empty string of at most ${REVIEW_BOUNDS.maxReviewerLength} characters`,
    );
  }
  if (typeof root.isHumanAttestation !== "boolean") {
    fail("review-record-malformed", "$.isHumanAttestation", "must be a boolean");
  }
  if (!root.isHumanAttestation && root.reviewer !== SELF_CHECK_REVIEWER_ID) {
    fail(
      "review-record-malformed",
      "$.reviewer",
      `a self-check record (isHumanAttestation false) must carry the reserved reviewer "${SELF_CHECK_REVIEWER_ID}" — it can never masquerade under a human name`,
    );
  }
  if (root.isHumanAttestation && root.reviewer === SELF_CHECK_REVIEWER_ID) {
    fail(
      "review-record-malformed",
      "$.reviewer",
      `"${SELF_CHECK_REVIEWER_ID}" is reserved for self-check records and cannot sign a human attestation`,
    );
  }
  if (typeof root.reviewedAt !== "string" || !isValidDateString(root.reviewedAt)) {
    fail(
      "review-record-malformed",
      "$.reviewedAt",
      `"${String(root.reviewedAt)}" must be a real calendar date in YYYY-MM-DD form`,
    );
  }
  if (!isBoundedString(root.scope, REVIEW_BOUNDS.maxScopeLength)) {
    fail(
      "review-record-malformed",
      "$.scope",
      `must be a non-empty string of at most ${REVIEW_BOUNDS.maxScopeLength} characters`,
    );
  }
  if (!isBoundedString(root.notes, REVIEW_BOUNDS.maxNotesLength)) {
    fail(
      "review-record-malformed",
      "$.notes",
      `must be a non-empty string of at most ${REVIEW_BOUNDS.maxNotesLength} characters`,
    );
  }
  if (!Array.isArray(root.checklistResults)) {
    fail("review-record-malformed", "$.checklistResults", "must be an array of item results");
  }
  if (root.checklistResults.length > HUMAN_REVIEW_CHECKLIST.length) {
    fail(
      "review-record-malformed",
      "$.checklistResults",
      `${root.checklistResults.length} results exceed the ${HUMAN_REVIEW_CHECKLIST.length}-item checklist`,
    );
  }
  const checklistIds = new Set(HUMAN_REVIEW_CHECKLIST.map((item) => item.itemId));
  const seen = new Set<string>();
  const results: HumanReviewChecklistResult[] = [];
  root.checklistResults.forEach((entry: unknown, index: number) => {
    const path = `$.checklistResults[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail("review-record-malformed", path, "an item result must be an object");
    }
    const record = entry as Record<string, unknown>;
    const entryKeys = Object.keys(record).sort();
    const hasRequired = ["itemId", "result"].every((key) => entryKeys.includes(key));
    const onlyKnown = entryKeys.every((key) => RESULT_KEYS.includes(key));
    if (!hasRequired || !onlyKnown) {
      fail(
        "review-record-malformed",
        path,
        `an item result's key set must be within {${RESULT_KEYS.join(", ")}} with itemId and result required (found {${entryKeys.join(", ")}})`,
      );
    }
    if (typeof record.itemId !== "string" || !checklistIds.has(record.itemId)) {
      fail(
        "review-record-malformed",
        `${path}.itemId`,
        `"${String(record.itemId)}" is not a checklist item (checklist: ${[...checklistIds].join(", ")})`,
      );
    }
    if (seen.has(record.itemId)) {
      fail("review-record-malformed", `${path}.itemId`, `duplicate result for "${record.itemId}"`);
    }
    seen.add(record.itemId);
    if (record.result !== "pass" && record.result !== "fail") {
      fail(
        "review-record-malformed",
        `${path}.result`,
        `"${String(record.result)}" must be "pass" or "fail"`,
      );
    }
    if (
      record.notes !== undefined &&
      !isBoundedString(record.notes, REVIEW_BOUNDS.maxItemNotesLength)
    ) {
      fail(
        "review-record-malformed",
        `${path}.notes`,
        `must be a non-empty string of at most ${REVIEW_BOUNDS.maxItemNotesLength} characters (or absent)`,
      );
    }
    results.push({
      itemId: record.itemId,
      result: record.result,
      ...(record.notes === undefined ? {} : { notes: record.notes }),
    });
  });
  return {
    schemaTag: root.schemaTag,
    recordId: root.recordId,
    reviewer: root.reviewer,
    reviewedAt: root.reviewedAt,
    scope: root.scope,
    isHumanAttestation: root.isHumanAttestation,
    checklistResults: Object.freeze(results),
    notes: root.notes,
  };
}

/** The completeness accounting of a structurally valid record. */
export interface ReviewCompleteness {
  /** True iff exactly one result exists for every checklist item. */
  readonly complete: boolean;
  /** The checklist item ids with no result (empty when complete). */
  readonly missingItemIds: readonly string[];
}

/**
 * Computes a structurally valid record's checklist completeness: the
 * record answers the checked-in checklist item-for-item. (Structural
 * validation already forbade unknown and duplicate items; only MISSING
 * items remain — the honest "review not finished" state.)
 */
export function reviewRecordCompleteness(record: HumanReviewRecord): ReviewCompleteness {
  const answered = new Set(record.checklistResults.map((result) => result.itemId));
  const missingItemIds = HUMAN_REVIEW_CHECKLIST.map((item) => item.itemId).filter(
    (itemId) => !answered.has(itemId),
  );
  return { complete: missingItemIds.length === 0, missingItemIds: Object.freeze(missingItemIds) };
}
