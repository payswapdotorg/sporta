/**
 * The HUMAN REVIEW gate's record format: what a completed review looks
 * like, parsed fail-closed. A missing, malformed, or incomplete record
 * makes the release PENDING-HUMAN-REVIEW — never PASS, never silently
 * skipped (the W803 acceptance: "release gates include ... human/automated
 * quality checks").
 *
 * The record is a checked-in JSON document. Its shape (validated here, and
 * by the zod schema on return):
 *
 * ```json
 * {
 *   "recordVersion": "w803-review@1",
 *   "reviewer": "<who reviewed — a name or role>",
 *   "reviewedAtMs": <explicit milliseconds — no wall clock is read here>,
 *   "checklist": { "<item-id>": "pass" | "fail" | "not-checked" },
 *   "notes": "<bounded free text>"
 * }
 * ```
 *
 * COMPLETE means: schema-valid, every checklist item present, every item
 * "pass" (a "fail" item is a completed review that FAILS the gate; a
 * "not-checked" item is INCOMPLETE).
 */
import { z } from "zod";
import { HUMAN_CHECKLIST } from "./policy";
import { ReleaseGateError } from "./errors";

/** The record's schema tag. */
export const REVIEW_RECORD_TAG = "sporta/quality-gates/human-review@1";

/** The human-review record (parsed, typed). */
export interface HumanReviewRecord {
  recordVersion: string;
  reviewer: string;
  reviewedAtMs: number;
  checklist: Record<string, "pass" | "fail" | "not-checked">;
  notes: string;
}

/** The zod schema (machine-readable contract; validated on parse). */
export const HumanReviewRecordSchema = z.object({
  recordVersion: z.literal(REVIEW_RECORD_TAG),
  reviewer: z.string().min(1).max(200),
  reviewedAtMs: z.number().int().min(0),
  checklist: z.record(z.enum(["pass", "fail", "not-checked"])),
  notes: z.string().max(4096),
});

/** The parsed outcome: complete, incomplete (why), or failed (why). */
export type HumanReviewStatus =
  | { kind: "complete"; record: HumanReviewRecord }
  | { kind: "incomplete"; reason: string }
  | { kind: "failed"; reason: string };

/**
 * Parses one human-review record document (unknown JSON). Fail-closed:
 * anything that is not a COMPLETE review is reported as incomplete or
 * failed with the reason — never coerced, never silent.
 */
export function parseHumanReview(document: unknown): HumanReviewStatus {
  if (document === null || typeof document !== "object") {
    return { kind: "incomplete", reason: "no human-review record supplied" };
  }
  const parsed = HumanReviewRecordSchema.safeParse(document);
  if (!parsed.success) {
    return {
      kind: "failed",
      reason: `record malformed: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    };
  }
  const record = parsed.data;
  const missing = HUMAN_CHECKLIST.filter((item) => !(item in record.checklist));
  if (missing.length > 0) {
    return {
      kind: "incomplete",
      reason: `checklist items not recorded: ${missing.join(", ")}`,
    };
  }
  const notChecked = HUMAN_CHECKLIST.filter((item) => record.checklist[item] === "not-checked");
  if (notChecked.length > 0) {
    return {
      kind: "incomplete",
      reason: `checklist items not-checked: ${notChecked.join(", ")}`,
    };
  }
  const failed = HUMAN_CHECKLIST.filter((item) => record.checklist[item] === "fail");
  if (failed.length > 0) {
    return {
      kind: "complete",
      record: { ...record, checklist: { ...record.checklist } },
    };
  }
  return {
    kind: "complete",
    record: { ...record, checklist: { ...record.checklist } },
  };
}

/**
 * The gate verdict from a parsed record: PASS only for a complete review
 * with every item "pass"; a complete review with any "fail" item FAILS;
 * incomplete/failed records are PENDING-HUMAN-REVIEW.
 */
export function humanReviewVerdict(status: HumanReviewStatus): {
  pass: boolean;
  pending: boolean;
  reason?: string;
} {
  if (status.kind === "incomplete") {
    return { pass: false, pending: true, reason: status.reason };
  }
  if (status.kind === "failed") {
    return { pass: false, pending: true, reason: status.reason };
  }
  const failed = HUMAN_CHECKLIST.filter((item) => status.record.checklist[item] === "fail");
  if (failed.length > 0) {
    return { pass: false, pending: false, reason: `checklist items failed: ${failed.join(", ")}` };
  }
  return { pass: true, pending: false };
}

/**
 * Parses the DEMO record (the checked-in pipeline self-check record — see
 * docs/REVIEW.md: it records that the automated pipeline ran and what it
 * checked; it is NOT a claim that a human reviewed production output).
 */
export function parseDemoRecord(): HumanReviewRecord {
  const document = DEMO_RECORD;
  const status = parseHumanReview(document);
  if (status.kind !== "complete") {
    throw new ReleaseGateError(
      "record-malformed",
      "$.demoRecord",
      `the checked-in demo record must parse complete (got ${status.kind}: ${status.reason})`,
    );
  }
  return status.record;
}

/** The checked-in demo record (the automated-pipeline self-check). */
export const DEMO_RECORD: unknown = {
  recordVersion: REVIEW_RECORD_TAG,
  reviewer: "pipeline-self-check (automated — NOT a human attestation)",
  reviewedAtMs: 1_789_500_000_000,
  checklist: {
    "one-rendered-clip-per-renderer-path-inspected": "pass",
    "gate-report-read-in-full": "pass",
    "sign-off-recorded": "pass",
  },
  notes:
    "Automated pipeline self-check over the deterministic fixtures (W503 clean clip + W605 match/directed fixtures). This record proves the gate machinery reads and honors review records; it is explicitly NOT a claim that a human reviewed production output — see docs/REVIEW.md §honesty.",
};
