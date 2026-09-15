/**
 * The W803 HUMAN QUALITY CHECKS — the fail-closed review record gate
 * (deliverable 1c; the checklist and record format are documented in
 * `docs/REVIEW.md`, the normative document, pinned row-for-row by
 * `test/humanReview.test.ts`).
 *
 * Two checklists, one per record kind (REVIEW.md §1 and §2):
 *
 * - **`HUMAN_REVIEW_CHECKLIST`** — what a HUMAN reviews before a release:
 *   one rendered clip per renderer path visually inspected, the machine
 *   gate report read, and the sign-off fields. The normative checklist.
 * - **`SELF_CHECK_CHECKLIST`** — the derived, machine-verifiable analog:
 *   each renderer path RENDERED its real fixture, the gate report was
 *   produced and read back. Every item maps 1:1 to its human counterpart
 *   (REVIEW.md §2's mapping table). The checked-in demo record
 *   (`fixtures/human-review-self-check.json`) completes THIS checklist; it
 *   is the automated pipeline's honest self-check over the fixtures — NOT
 *   an attestation that a human looked at pixels (GATES.md §7).
 *
 * The record format (REVIEW.md §3): a JSON document with the schema tag,
 * the record kind, the checklist id (pinned to the kind — a stale or
 * mismatched checklist id is `record-malformed`, fail-loud), the reviewer
 * identity, an authored date (a fixed string — never read from any clock),
 * one result per checklist item (`pass` | `fail`), and bounded notes.
 *
 * Validation is TOTAL and deterministic:
 *
 * - **structurally malformed** records throw `QualityGateError`
 *   (`record-malformed`, JSON path) — wrong shapes, wrong types, unknown
 *   result values, duplicate item ids, over-bound fields, or a
 *   checklist-id/kind mismatch;
 * - **semantically incomplete** records (the results do not cover exactly
 *   the current checklist's items) are an ACCOUNTED outcome, not an
 *   error: the gate verdict is FAIL with reason `record-incomplete`;
 * - a **complete record with failing items** is a definitive human FAIL
 *   (the review happened and found problems): verdict FAIL, reason
 *   `checklist-item-failed`;
 * - a **complete, all-pass record** is the only PASS.
 *
 * Every bound below is a FORMAT bound of the record schema (REVIEW.md §3),
 * not a quality threshold: this package defines zero quality thresholds
 * (GATES.md §7 — the roadmap's rule: a number without measured evidence is
 * an aspiration, not an SLO, and not a gate).
 */
import { fail } from "./errors";

/** The record schema tag (versioned with the record shape; REVIEW.md §3). */
export const HUMAN_REVIEW_RECORD_SCHEMA_TAG = "sporta/quality-gates/human-review@1";

/** The human checklist's identity (versioned with its item set). */
export const HUMAN_REVIEW_CHECKLIST_ID = "w803-human-review-checklist@1";

/** The self-check checklist's identity (versioned with its item set). */
export const SELF_CHECK_CHECKLIST_ID = "w803-self-check-checklist@1";

/** FORMAT bound: the notes field's maximum length in characters. */
export const MAX_NOTES_LENGTH = 500;

/** FORMAT bound: the reviewer name/role fields' maximum length in characters. */
export const MAX_REVIEWER_FIELD_LENGTH = 100;

/** FORMAT bound: the maximum number of checklist results in one record. */
export const MAX_CHECKLIST_RESULTS = 16;

/** FORMAT bound: the fixture name's maximum length in a release input. */
export const MAX_FIXTURE_NAME_LENGTH = 64;

/** FORMAT bound: the maximum number of scene runs in one release input. */
export const MAX_SCENE_RUNS = 8;

/** Who completed the record: a person, or the automated pipeline self-check. */
export type RecordKind = "human-review" | "automated-pipeline-self-check";

/** One checklist item's allowed result. */
export type ChecklistItemResult = "pass" | "fail";

/** One checklist item (REVIEW.md §1/§2 rows, verbatim). */
export interface ReviewChecklistItem {
  readonly itemId: string;
  /** What satisfying the item means, in one sentence (REVIEW.md's requirement column). */
  readonly requirement: string;
}

/** One checklist: its identity, its record kind, and its ordered items. */
export interface ReviewChecklist {
  readonly checklistId: string;
  readonly kind: RecordKind;
  readonly items: readonly ReviewChecklistItem[];
}

/** The normative human review checklist (REVIEW.md §1, executable mirror). */
export const HUMAN_REVIEW_CHECKLIST: ReviewChecklist = {
  checklistId: HUMAN_REVIEW_CHECKLIST_ID,
  kind: "human-review",
  items: [
    {
      itemId: "temporal-clip-visual",
      requirement:
        "Anime clip path: the rendered fixture clip's SVG frames viewed frame-by-frame; no identity pop-out, style change, or geometry jump is visible.",
    },
    {
      itemId: "scene-match-visual",
      requirement:
        "3D match path: the rendered match fixture's frames viewed; the HUD score/clock claims are right, identities are stable, markers sit at their events.",
    },
    {
      itemId: "scene-directed-visual",
      requirement:
        "Directed rundown path: the rendered rundown's frames viewed across its live windows, camera cuts, and the review window; presentation matches the plan.",
    },
    {
      itemId: "gate-report-read",
      requirement:
        "The full machine gate report read end-to-end; every check and measured value understood; failing checks (if any) triaged to an owner.",
    },
  ],
};

/** The derived, machine-verifiable self-check checklist (REVIEW.md §2, executable mirror). */
export const SELF_CHECK_CHECKLIST: ReviewChecklist = {
  checklistId: SELF_CHECK_CHECKLIST_ID,
  kind: "automated-pipeline-self-check",
  items: [
    {
      itemId: "temporal-clip-rendered",
      requirement:
        "Anime clip path: the real W503 clean fixture clip rendered through the real renderer (frames and manifest produced).",
    },
    {
      itemId: "scene-match-rendered",
      requirement:
        "3D match path: the real W605 clean-match fixture built through the real W601-W603 seams.",
    },
    {
      itemId: "scene-directed-rendered",
      requirement:
        "Directed rundown path: the real W605 directed-review fixture built through the real W604 direction chain.",
    },
    {
      itemId: "gate-report-read",
      requirement:
        "The machine gate report produced, schema-tag verified, and read back (parsed) by the pipeline.",
    },
  ],
};

/** The checklist of a record kind (fail-closed on an unknown kind). */
export function checklistForKind(kind: RecordKind): ReviewChecklist {
  return kind === "human-review" ? HUMAN_REVIEW_CHECKLIST : SELF_CHECK_CHECKLIST;
}

/** One per-item result, as carried in the record (and echoed verbatim into reports). */
export interface ChecklistResultEntry {
  readonly itemId: string;
  readonly result: ChecklistItemResult;
}

/** The parsed human review record (the validated shape). */
export interface HumanReviewRecord {
  readonly schemaTag: string;
  readonly recordKind: RecordKind;
  readonly checklistId: string;
  readonly reviewer: { readonly name: string; readonly role: string };
  /** An authored calendar date, `YYYY-MM-DD` (never read from a clock). */
  readonly date: string;
  readonly checklistResults: readonly ChecklistResultEntry[];
  readonly notes: string;
}

/** Structural check: is it a plain JSON object? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural check: a non-empty string within a format bound. */
function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

/** Structural check: the authored-date pattern `YYYY-MM-DD` with month 01-12, day 01-31. */
function isAuthoredDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** The exact allowed keys of the record object (fail-closed on any other key). */
const RECORD_KEYS = [
  "schemaTag",
  "recordKind",
  "checklistId",
  "reviewer",
  "date",
  "checklistResults",
  "notes",
] as const;

const REVIEWER_KEYS = ["name", "role"] as const;

/**
 * Validates a human review record's STRUCTURE, fail-loud
 * (`QualityGateError` `record-malformed` with the JSON path — never a
 * silent coercion). Semantic completeness (covering exactly the current
 * checklist) is NOT checked here: it is an accounted gate outcome, see
 * {@link checkChecklistCoverage}.
 */
export function validateHumanReviewRecord(record: unknown): HumanReviewRecord {
  if (!isRecord(record)) {
    fail("record-malformed", "$", "the record must be a JSON object");
  }
  for (const key of Object.keys(record)) {
    if (!(RECORD_KEYS as readonly string[]).includes(key)) {
      fail(
        "record-malformed",
        `$.${key}`,
        `unknown record field (allowed: ${RECORD_KEYS.join(", ")})`,
      );
    }
  }
  if (record.schemaTag !== HUMAN_REVIEW_RECORD_SCHEMA_TAG) {
    fail(
      "record-malformed",
      "$.schemaTag",
      `must be "${HUMAN_REVIEW_RECORD_SCHEMA_TAG}" (got ${JSON.stringify(record.schemaTag)})`,
    );
  }
  if (
    record.recordKind !== "human-review" &&
    record.recordKind !== "automated-pipeline-self-check"
  ) {
    fail(
      "record-malformed",
      "$.recordKind",
      `must be "human-review" or "automated-pipeline-self-check" (got ${JSON.stringify(record.recordKind)})`,
    );
  }
  const kind = record.recordKind as RecordKind;
  const expectedChecklistId = checklistForKind(kind).checklistId;
  if (record.checklistId !== expectedChecklistId) {
    fail(
      "record-malformed",
      "$.checklistId",
      `a "${kind}" record must carry checklist id "${expectedChecklistId}" (got ${JSON.stringify(record.checklistId)})`,
    );
  }
  if (!isRecord(record.reviewer)) {
    fail("record-malformed", "$.reviewer", "must be an object with name and role");
  }
  for (const key of Object.keys(record.reviewer)) {
    if (!(REVIEWER_KEYS as readonly string[]).includes(key)) {
      fail(
        "record-malformed",
        `$.reviewer.${key}`,
        `unknown reviewer field (allowed: ${REVIEWER_KEYS.join(", ")})`,
      );
    }
  }
  if (!isBoundedString(record.reviewer.name, MAX_REVIEWER_FIELD_LENGTH)) {
    fail(
      "record-malformed",
      "$.reviewer.name",
      `must be a non-empty string of at most ${MAX_REVIEWER_FIELD_LENGTH} characters`,
    );
  }
  if (!isBoundedString(record.reviewer.role, MAX_REVIEWER_FIELD_LENGTH)) {
    fail(
      "record-malformed",
      "$.reviewer.role",
      `must be a non-empty string of at most ${MAX_REVIEWER_FIELD_LENGTH} characters`,
    );
  }
  if (!isAuthoredDate(record.date)) {
    fail(
      "record-malformed",
      "$.date",
      "must be an authored calendar date of the form YYYY-MM-DD (month 01-12, day 01-31)",
    );
  }
  if (!Array.isArray(record.checklistResults)) {
    fail("record-malformed", "$.checklistResults", "must be an array of per-item results");
  }
  if (record.checklistResults.length > MAX_CHECKLIST_RESULTS) {
    fail(
      "record-malformed",
      "$.checklistResults",
      `at most ${MAX_CHECKLIST_RESULTS} results are allowed (got ${record.checklistResults.length})`,
    );
  }
  const seenItems = new Set<string>();
  const results: ChecklistResultEntry[] = [];
  record.checklistResults.forEach((entry, index) => {
    const path = `$.checklistResults[${index}]`;
    if (!isRecord(entry)) {
      fail("record-malformed", path, "must be an object with itemId and result");
    }
    for (const key of Object.keys(entry)) {
      if (key !== "itemId" && key !== "result") {
        fail(
          "record-malformed",
          `${path}.${key}`,
          `unknown result field (allowed: itemId, result)`,
        );
      }
    }
    if (typeof entry.itemId !== "string" || entry.itemId.length === 0) {
      fail("record-malformed", `${path}.itemId`, "must be a non-empty string");
    }
    if (entry.result !== "pass" && entry.result !== "fail") {
      fail(
        "record-malformed",
        `${path}.result`,
        `must be "pass" or "fail" (got ${JSON.stringify(entry.result)})`,
      );
    }
    if (seenItems.has(entry.itemId)) {
      fail("record-malformed", `${path}.itemId`, `duplicate result for item "${entry.itemId}"`);
    }
    seenItems.add(entry.itemId);
    results.push({ itemId: entry.itemId, result: entry.result });
  });
  if (typeof record.notes !== "string") {
    fail("record-malformed", "$.notes", "must be a string (possibly empty)");
  }
  if (record.notes.length > MAX_NOTES_LENGTH) {
    fail(
      "record-malformed",
      "$.notes",
      `must be at most ${MAX_NOTES_LENGTH} characters (got ${record.notes.length})`,
    );
  }
  return {
    schemaTag: record.schemaTag,
    recordKind: kind,
    checklistId: record.checklistId,
    reviewer: { name: record.reviewer.name, role: record.reviewer.role },
    date: record.date,
    checklistResults: results,
    notes: record.notes,
  };
}

/** The coverage of a structurally valid record against its checklist. */
export interface ChecklistCoverage {
  /** True iff the results cover exactly the checklist's items. */
  readonly complete: boolean;
  /** Checklist items with NO result (empty iff complete). */
  readonly missingItems: readonly string[];
  /** Result item ids that are NOT in the checklist (empty iff complete). */
  readonly extraItems: readonly string[];
}

/**
 * Checks a validated record's SEMANTIC completeness: the results must
 * cover exactly the current checklist's item set — a record missing items
 * (or carrying results for items the current checklist does not define,
 * e.g. a stale record) is INCOMPLETE, which the gate accounts as FAIL
 * with reason `record-incomplete` (never an error, never a pass).
 */
export function checkChecklistCoverage(record: HumanReviewRecord): ChecklistCoverage {
  const checklist = checklistForKind(record.recordKind);
  const expected = new Set(checklist.items.map((item) => item.itemId));
  const got = new Set(record.checklistResults.map((result) => result.itemId));
  const missingItems = checklist.items
    .map((item) => item.itemId)
    .filter((itemId) => !got.has(itemId));
  const extraItems = record.checklistResults
    .map((result) => result.itemId)
    .filter((itemId) => !expected.has(itemId));
  return {
    complete: missingItems.length === 0 && extraItems.length === 0,
    missingItems,
    extraItems,
  };
}
