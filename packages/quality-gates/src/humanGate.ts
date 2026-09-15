/**
 * The human quality-checks gate — gate row 3 of the W803 release suite.
 *
 * Fail-closed human review (docs/REVIEW.md is the checklist's normative
 * document): the gate consumes a review RECORD (a checked-in JSON document
 * whose format `src/humanReview.ts` defines and inspects) and classifies
 * it:
 *
 * - complete, every item `pass`        → gate verdict `PASS`;
 * - complete, at least one item `fail` → gate verdict `FAIL` (an honest
 *   failed review fails the release — recording a failure is a completed
 *   review, not a broken record);
 * - missing / malformed / incomplete   → gate verdict `NOT-RUNNABLE` with
 *   every issue accounted — which maps (policy data) to
 *   `PENDING-HUMAN-REVIEW` for the overall release when every machine gate
 *   passes. NEVER `PASS`, never silently skipped.
 *
 * Honesty boundary (docs/GATES.md §boundaries): the record accounts that
 * review HAPPENED and WHAT was checked — it cannot verify review QUALITY.
 * The fixture-demo record is `recordKind: "pipeline-self-check"` — the
 * automated pipeline's own execution of the checklist over the
 * deterministic checked-in fixtures — and that fact travels verbatim into
 * this row's measured evidence and reason, so a PASSing release report can
 * never be mistaken for a human attestation.
 */
import type { GateRowBase } from "./gateRow";
import { policyEntryOf } from "./gatePolicy";
import { CHECKLIST_VERSION, REVIEW_CHECKLIST, inspectHumanReviewRecord } from "./humanReview";
import type { HumanReviewInspection, HumanReviewStatus, RecordIssue } from "./humanReview";

/** The record's fixed fields, carried verbatim (present iff structurally valid). */
export interface HumanReviewRecordSummary {
  readonly recordKind: string;
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly scope: string;
  readonly notes?: string;
}

/** One checklist item joined with its requirement (the report is self-describing). */
export interface HumanReviewItemRow {
  readonly checklistItemId: string;
  /** The requirement text, verbatim from the checklist definition. */
  readonly requirement: string;
  readonly result: "pass" | "fail";
  readonly notes?: string;
}

/**
 * The full human-review section — the gate row's measured evidence AND the
 * report's `humanReview` section (one source of truth, no drift).
 */
export interface HumanGateMeasured {
  /** The inspection status. */
  readonly status: HumanReviewStatus;
  readonly checklistVersion: string;
  /** Every accounted issue (typed code + JSON path + message). */
  readonly issues: readonly RecordIssue[];
  /** Checklist item ids with no recorded result (nonempty iff "incomplete"). */
  readonly missingItemIds: readonly string[];
  /** The record's fixed fields, verbatim (present iff structurally valid). */
  readonly record?: HumanReviewRecordSummary;
  /** The per-item results joined with requirements (present iff "complete"). */
  readonly items?: readonly HumanReviewItemRow[];
  /** Item ids whose recorded result is "fail" (present iff "complete"). */
  readonly failedItemIds?: readonly string[];
  /** Whether the record is a person's attestation (vs the pipeline self-check). */
  readonly humanAttested: boolean;
}

/** The human quality-checks gate row. */
export interface HumanGateRow extends GateRowBase {
  readonly gateId: "human-quality-checks";
  readonly measured: HumanGateMeasured;
}

/** Runs the human quality-checks gate over one raw record value. Pure; never throws. */
export function runHumanGate(record: unknown): HumanGateRow {
  const policy = policyEntryOf("human-quality-checks");
  const inspection = inspectHumanReviewRecord(record);
  const row = humanRowOf(inspection, policy);
  return row;
}

/** Builds the row (and its measured section) from one inspection. */
function humanRowOf(
  inspection: HumanReviewInspection,
  policy: ReturnType<typeof policyEntryOf>,
): HumanGateRow {
  const measured = measuredOf(inspection);
  return {
    ...policy,
    gateId: "human-quality-checks",
    verdict: verdictOf(inspection),
    reason: reasonOf(inspection),
    measured,
  };
}

/** The gate verdict for one inspection (fail-closed in the release direction). */
function verdictOf(inspection: HumanReviewInspection): "PASS" | "FAIL" | "NOT-RUNNABLE" {
  if (inspection.status === "complete") {
    return (inspection.failedItemIds ?? []).length === 0 ? "PASS" : "FAIL";
  }
  return "NOT-RUNNABLE";
}

/** The accounted reason (deterministic; honest about the record's kind). */
function reasonOf(inspection: HumanReviewInspection): string {
  if (inspection.status === "missing") {
    return (
      "no human review record supplied — the release can never pass without one " +
      "(PENDING-HUMAN-REVIEW when every machine gate passes)"
    );
  }
  if (inspection.status === "malformed") {
    const accounted = inspection.issues.map((issue) => `${issue.path}: ${issue.code}`).join(", ");
    return `human review record malformed (${inspection.issues.length} issue(s): ${accounted}) — PENDING-HUMAN-REVIEW when every machine gate passes`;
  }
  if (inspection.status === "incomplete") {
    return (
      `human review record incomplete — no result recorded for: ${inspection.missingItemIds.join(", ")}` +
      " — PENDING-HUMAN-REVIEW when every machine gate passes"
    );
  }
  const failed = inspection.failedItemIds ?? [];
  if (failed.length > 0) {
    return `human review recorded a failed checklist item: ${failed.join(", ")}`;
  }
  const record = inspection.record!;
  return (
    `human review record complete — all ${REVIEW_CHECKLIST.length} checklist item(s) pass ` +
    `(recordKind: ${record.recordKind}, reviewer: ${record.reviewer}, ` +
    `humanAttested: ${inspection.humanAttested})`
  );
}

/** Assembles the measured section (the report's humanReview section). */
function measuredOf(inspection: HumanReviewInspection): HumanGateMeasured {
  const record = inspection.record;
  const base: HumanGateMeasured = {
    status: inspection.status,
    checklistVersion: CHECKLIST_VERSION,
    issues: [...inspection.issues],
    missingItemIds: [...inspection.missingItemIds],
    humanAttested: inspection.humanAttested,
  };
  if (record === undefined) {
    return base;
  }
  const summary: HumanReviewRecordSummary = {
    recordKind: record.recordKind,
    reviewer: record.reviewer,
    reviewedAt: record.reviewedAt,
    scope: record.scope,
    ...(record.notes === undefined ? {} : { notes: record.notes }),
  };
  const joined: HumanReviewItemRow[] =
    inspection.status === "complete"
      ? REVIEW_CHECKLIST.map((item) => {
          const recorded = record.items.find((entry) => entry.checklistItemId === item.itemId)!;
          return {
            checklistItemId: item.itemId,
            requirement: item.requirement,
            result: recorded.result,
            ...(recorded.notes === undefined ? {} : { notes: recorded.notes }),
          };
        })
      : [];
  return {
    ...base,
    record: summary,
    ...(joined.length === 0 ? {} : { items: joined }),
    ...(inspection.failedItemIds === undefined
      ? {}
      : { failedItemIds: [...inspection.failedItemIds] }),
  };
}
