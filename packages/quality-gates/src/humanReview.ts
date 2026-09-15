/**
 * The W803 human-review checklist and the fail-closed review-record
 * inspector (docs/REVIEW.md is the normative mirror of the checklist,
 * pinned row-for-row in both directions by `test/policyDoc.test.ts`).
 *
 * What the human gate is: a HONEST ACCOUNTING that review HAPPENED and
 * WHAT was checked — never a verification of review QUALITY (that boundary
 * is documented, not papered over). The record format is a checked-in JSON
 * document (`fixtures/human-review/self-check-record.json` carries the
 * fixture-demo run's record, clearly marked `recordKind:
 * "pipeline-self-check"` — the automated pipeline's own execution of the
 * checklist over the deterministic fixtures, NOT a claim that a human
 * reviewed production output; no production output exists).
 *
 * The inspection is fail-closed in the release direction: a record that is
 * missing, malformed, or incomplete NEVER yields a passing human gate — it
 * leaves the release at `PENDING-HUMAN-REVIEW` with every issue accounted
 * (typed code + JSON path + message), and nothing is ever silently coerced
 * or auto-passed. A structurally complete record whose items carry a
 * `"fail"` result is an honest FAILED review (the gate verdict is FAIL,
 * which fails the release) — recording a failure is a completed review,
 * not a broken one.
 *
 * Purity: no clock (the record's `reviewedAt` is authored data, validated
 * as a calendar date by pure arithmetic — no `Date` is constructed
 * anywhere), no RNG, no I/O.
 */
import { structuralBound } from "./bounds";

/** The checklist document's identity (versioned with the item set). */
export const CHECKLIST_VERSION = "w803-review-checklist-v1";

/** The review-record schema tag (versioned with the record shape). */
export const HUMAN_RECORD_SCHEMA_TAG = "sporta/quality-gates/human-review@1";

/** One checklist item: what a reviewer must do, stated as a requirement. */
export interface ChecklistItem {
  /** The stable item id (the record's items key on this). */
  readonly itemId: string;
  /** The requirement text, verbatim from docs/REVIEW.md §checklist. */
  readonly requirement: string;
}

/**
 * The W803 review checklist. One rendered clip per renderer path, the gate
 * reports read, the release accounting read, and the scope confirmed —
 * docs/REVIEW.md §checklist documents each item's discipline.
 */
export const REVIEW_CHECKLIST: readonly ChecklistItem[] = [
  {
    itemId: "clips.w503-anime-fixture",
    requirement:
      "One rendered clip per renderer path, visually inspected — the anime-renderer path: the W503 fixture clip's frames are inspected (as the authored SVG markup they deterministically are): every manifest entity drawn where its manifest entry says, caption windows positioned inside their windows, the watermark line present, no visual artifact the machine gates cannot see (unreadable text, wrong palette harmony, clipped markers).",
  },
  {
    itemId: "clips.w603-match-fixture",
    requirement:
      "One rendered clip per renderer path, visually inspected — the 3D match-renderer path: the W605 corrections-match fixture's manifest frames are inspected: entities at their recorded positions, the HUD score/clock line matching the timeline state, event chips legible and inside their windows, no visual artifact the machine gates cannot see.",
  },
  {
    itemId: "clips.w604-directed-fixture",
    requirement:
      "One rendered clip per renderer path, visually inspected — the directed-rundown path: the W605 directed-review fixture's manifest is inspected: each window's camera block and slot as the plan declares, the review window's replay profile, markers presented once and inside their windows, no visual artifact the machine gates cannot see.",
  },
  {
    itemId: "reports.temporal-gate",
    requirement:
      "The temporal-stability gate's source report is read in full — the verdict line AND every check with its measured value and threshold; the failing checks (if any) are understood, not just counted.",
  },
  {
    itemId: "reports.scene-gate",
    requirement:
      "The scene-correctness gate's source reports are read in full — one per fixture: per-dimension verdicts, every check with its measured value, and the findings accounting (recorded vs dropped beyond the cap).",
  },
  {
    itemId: "reports.release-accounting",
    requirement:
      "The release report's own gate table and accounting are read: every declared gate has its row, every NOT-RUNNABLE row carries its accounted reason, and the ledger reconciles (gates = pass + fail + not-runnable).",
  },
  {
    itemId: "scope.fixture-demo-confirmed",
    requirement:
      "The run under review is confirmed to be the fixture-based demo scope (deterministic checked-in fixtures, no production traffic), and the honesty boundaries of docs/GATES.md §boundaries have been read and understood.",
  },
] as const;

/** The record kinds. `"human-review"` is a person's attestation; `"pipeline-self-check"` is the automated pipeline executing the checklist itself over the deterministic fixtures — both are honest records of WHAT happened, and the kind travels verbatim into the release report so no consumer can mistake one for the other. */
export type HumanRecordKind = "human-review" | "pipeline-self-check";

/** The inspection status of a review record. */
export type HumanReviewStatus = "complete" | "missing" | "malformed" | "incomplete";

/** One accounted issue (typed code + JSON path + message; never just a string). */
export interface RecordIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/** The structurally parsed record (present iff the record is well-formed). */
export interface ParsedHumanReviewRecord {
  readonly schemaTag: string;
  readonly recordKind: HumanRecordKind;
  readonly checklistVersion: string;
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly scope: string;
  readonly notes?: string;
  readonly items: readonly ParsedRecordItem[];
}

/** One parsed checklist-item result (verbatim from the record). */
export interface ParsedRecordItem {
  readonly checklistItemId: string;
  readonly result: "pass" | "fail";
  readonly notes?: string;
}

/** The inspection result (all evidence, never a bare verdict). */
export interface HumanReviewInspection {
  readonly status: HumanReviewStatus;
  /** Every accounted issue (empty iff status is "complete" or "missing"). */
  readonly issues: readonly RecordIssue[];
  /** Checklist item ids with no record entry (nonempty iff status is "incomplete"). */
  readonly missingItemIds: readonly string[];
  /** The parsed record (present iff structurally well-formed). */
  readonly record?: ParsedHumanReviewRecord;
  /** Item ids whose recorded result is "fail" (present iff status is "complete"). */
  readonly failedItemIds?: readonly string[];
  /** Whether the record is a person's attestation (vs the pipeline self-check). */
  readonly humanAttested: boolean;
}

/** The record's allowed top-level keys. */
const RECORD_KEYS: readonly string[] = [
  "schemaTag",
  "recordKind",
  "checklistVersion",
  "reviewer",
  "reviewedAt",
  "scope",
  "items",
  "notes",
];

/** The item entry's allowed keys. */
const ITEM_KEYS: readonly string[] = ["checklistItemId", "result", "notes"];

/** Whether a value is a plain object (not null, not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether `yyyy-mm-dd` is a real calendar date (pure arithmetic — no `Date`
 * is constructed; the constitution scan forbids it and the honesty is the
 * same: an impossible date is rejected, not rounded).
 */
function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
}

/** A bounded, non-empty string field check (returns the issue or null). */
function boundedStringIssue(
  value: unknown,
  path: string,
  code: string,
  what: string,
  maxLength: number,
): RecordIssue | null {
  if (typeof value !== "string") {
    return { path, code, message: `${what} must be a string` };
  }
  if (value.length === 0) {
    return { path, code, message: `${what} must not be empty` };
  }
  if (value.length > maxLength) {
    return {
      path,
      code,
      message: `${what} exceeds the structural bound (${value.length} > ${maxLength} characters — docs/GATES.md §structural-bounds)`,
    };
  }
  return null;
}

/**
 * Inspects one review record (fail-closed, never throws, never coerces):
 * `undefined` is "missing"; anything else is structurally validated and
 * classified. ALL issues are collected (never just the first), each with a
 * typed code and JSON path.
 */
export function inspectHumanReviewRecord(record: unknown): HumanReviewInspection {
  if (record === undefined) {
    return { status: "missing", issues: [], missingItemIds: [], humanAttested: false };
  }
  const issues: RecordIssue[] = [];
  if (!isPlainObject(record)) {
    return {
      status: "malformed",
      issues: [
        {
          path: "$",
          code: "not-an-object",
          message: "a human review record must be a JSON object",
        },
      ],
      missingItemIds: [],
      humanAttested: false,
    };
  }

  // --- unknown keys (fail-closed: a record shape this version does not
  // know is rejected, never partially interpreted) -------------------------
  for (const key of Object.keys(record).sort()) {
    if (!RECORD_KEYS.includes(key)) {
      issues.push({
        path: `$.${key}`,
        code: "unknown-key",
        message: `unknown record key "${key}" (allowed: ${RECORD_KEYS.join(", ")})`,
      });
    }
  }

  // --- the fixed fields ----------------------------------------------------
  if (record.schemaTag !== HUMAN_RECORD_SCHEMA_TAG) {
    issues.push({
      path: "$.schemaTag",
      code: "schema-tag",
      message: `expected "${HUMAN_RECORD_SCHEMA_TAG}", got ${JSON.stringify(record.schemaTag)}`,
    });
  }
  if (record.recordKind !== "human-review" && record.recordKind !== "pipeline-self-check") {
    issues.push({
      path: "$.recordKind",
      code: "record-kind",
      message: `expected "human-review" or "pipeline-self-check", got ${JSON.stringify(record.recordKind)}`,
    });
  }
  if (record.checklistVersion !== CHECKLIST_VERSION) {
    issues.push({
      path: "$.checklistVersion",
      code: "checklist-version",
      message: `expected "${CHECKLIST_VERSION}", got ${JSON.stringify(record.checklistVersion)}`,
    });
  }
  const reviewerIssue = boundedStringIssue(
    record.reviewer,
    "$.reviewer",
    "reviewer",
    "the reviewer identity",
    structuralBound("MAX_REVIEWER_LENGTH"),
  );
  if (reviewerIssue !== null) issues.push(reviewerIssue);
  if (typeof record.reviewedAt !== "string" || !isCalendarDate(record.reviewedAt)) {
    issues.push({
      path: "$.reviewedAt",
      code: "reviewed-at",
      message: `expected a real calendar date "YYYY-MM-DD", got ${JSON.stringify(record.reviewedAt)}`,
    });
  }
  const scopeIssue = boundedStringIssue(
    record.scope,
    "$.scope",
    "scope",
    "the review scope",
    structuralBound("MAX_SCOPE_LENGTH"),
  );
  if (scopeIssue !== null) issues.push(scopeIssue);
  if (record.notes !== undefined) {
    const notesIssue = boundedStringIssue(
      record.notes,
      "$.notes",
      "notes",
      "the record notes",
      structuralBound("MAX_RECORD_NOTES_LENGTH"),
    );
    if (notesIssue !== null) issues.push(notesIssue);
  }

  // --- the per-checklist-item results ---------------------------------------
  const parsedItems: ParsedRecordItem[] = [];
  const seenItemIds = new Set<string>();
  if (!Array.isArray(record.items) || record.items.length === 0) {
    issues.push({
      path: "$.items",
      code: "items",
      message: "the record must carry a non-empty array of checklist-item results",
    });
  } else {
    record.items.forEach((entry, index) => {
      const path = `$.items[${index}]`;
      if (!isPlainObject(entry)) {
        issues.push({
          path,
          code: "item",
          message: "a checklist-item result must be a JSON object",
        });
        return;
      }
      for (const key of Object.keys(entry).sort()) {
        if (!ITEM_KEYS.includes(key)) {
          issues.push({
            path: `${path}.${key}`,
            code: "unknown-key",
            message: `unknown item key "${key}" (allowed: ${ITEM_KEYS.join(", ")})`,
          });
        }
      }
      if (typeof entry.checklistItemId !== "string") {
        issues.push({
          path: `${path}.checklistItemId`,
          code: "checklist-item-id",
          message: "the checklist item id must be a string",
        });
        return;
      }
      const known = REVIEW_CHECKLIST.some((item) => item.itemId === entry.checklistItemId);
      if (!known) {
        issues.push({
          path: `${path}.checklistItemId`,
          code: "unknown-checklist-item",
          message: `"${entry.checklistItemId}" is not an item of checklist ${CHECKLIST_VERSION}`,
        });
      }
      if (seenItemIds.has(entry.checklistItemId)) {
        issues.push({
          path: `${path}.checklistItemId`,
          code: "duplicate-checklist-item",
          message: `checklist item "${entry.checklistItemId}" is recorded more than once`,
        });
      }
      seenItemIds.add(entry.checklistItemId);
      if (entry.result !== "pass" && entry.result !== "fail") {
        issues.push({
          path: `${path}.result`,
          code: "item-result",
          message: `expected "pass" or "fail", got ${JSON.stringify(entry.result)}`,
        });
        return;
      }
      if (entry.notes !== undefined) {
        const itemNotesIssue = boundedStringIssue(
          entry.notes,
          `${path}.notes`,
          "item-notes",
          "the item notes",
          structuralBound("MAX_ITEM_NOTES_LENGTH"),
        );
        if (itemNotesIssue !== null) issues.push(itemNotesIssue);
      }
      parsedItems.push(
        entry.notes === undefined
          ? { checklistItemId: entry.checklistItemId, result: entry.result }
          : {
              checklistItemId: entry.checklistItemId,
              result: entry.result,
              notes: entry.notes as string,
            },
      );
    });
  }

  if (issues.length > 0) {
    return { status: "malformed", issues, missingItemIds: [], humanAttested: false };
  }

  // --- structurally valid: is every checklist item covered? -----------------
  const knownIds = REVIEW_CHECKLIST.map((item) => item.itemId);
  const missingItemIds = knownIds.filter((itemId) => !seenItemIds.has(itemId));
  if (missingItemIds.length > 0) {
    return {
      status: "incomplete",
      issues: [
        {
          path: "$.items",
          code: "missing-checklist-item",
          message: `no result recorded for checklist item(s): ${missingItemIds.join(", ")}`,
        },
      ],
      missingItemIds,
      humanAttested: false,
    };
  }

  const recordKind = record.recordKind as HumanRecordKind;
  const failedItemIds = parsedItems
    .filter((item) => item.result === "fail")
    .map((item) => item.checklistItemId);
  const parsed: ParsedHumanReviewRecord = {
    schemaTag: record.schemaTag as string,
    recordKind,
    checklistVersion: record.checklistVersion as string,
    reviewer: record.reviewer as string,
    reviewedAt: record.reviewedAt as string,
    scope: record.scope as string,
    ...(record.notes === undefined ? {} : { notes: record.notes as string }),
    items: parsedItems,
  };
  return {
    status: "complete",
    issues: [],
    missingItemIds: [],
    record: parsed,
    failedItemIds,
    humanAttested: recordKind === "human-review",
  };
}
