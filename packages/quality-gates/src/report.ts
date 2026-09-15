/**
 * The W803 RELEASE READINESS REPORT — `evaluateReleaseReadiness` and the
 * machine-readable report (deliverable 2).
 *
 * ONE pure, deterministic function composes the accounted gates into one
 * release verdict:
 *
 * - the gate rows: one row per policy gate (name, source package, role,
 *   blocking, verdict, the accounted reason when it did not pass, and —
 *   for machine gates — one run row per evaluated fixture with the source
 *   report's evidence carried VERBATIM: schema tag, source verdict, the
 *   source `input` echo, the FULL check list, the failing checks);
 * - the human-review section: the record's echo (kind, checklist,
 *   reviewer, authored date, per-item results, failing items, notes) and
 *   the failure class;
 * - the accounting table: total gates, per-bucket counts, and the four
 *   reconciliation checks — `gates = pass + fail + not-runnable` exactly,
 *   every policy gate present as exactly one row (a gate that silently
 *   vanishes fails the release);
 * - the overall verdict (GATES.md §2, the normative composition):
 *   - `PASS` — every blocking gate passed AND the human record is
 *     complete;
 *   - `PENDING-HUMAN-REVIEW` — the machine gates passed but the human
 *     record is absent, malformed, or incomplete (never PASS, never
 *     silently skipped);
 *   - `FAIL` — otherwise (any blocking machine/accounting gate FAIL or
 *     NOT_RUNNABLE, or a completed review with failing items).
 *
 * Determinism: no clock, no RNG, no I/O; the same input yields a
 * byte-identical canonical serialization ({@link canonicalReportBytes})
 * on every call — pinned twice in one process AND across two subprocess
 * invocations with compared stdout hashes (`test/cli.test.ts`), plus a
 * checked-in golden copy of the canonical report
 * (`fixtures/golden/release-readiness-report.json`) so any drift in the
 * composed evaluations' measured values is a loud, reviewed diff.
 */
import { reconcileGateLedger, type AccountingCheck } from "./accounting";
import { runSubjectGates, type GateRow, type GateVerdict, type HumanReviewDetail } from "./gates";
import { validateReleaseInputShape, type ReleaseEvaluationInput } from "./input";
import { GATE_POLICY, assertGatePolicyInvariants, type GatePolicyDocument } from "./policy";

/** The release report's schema tag (versioned with the report shape). */
export const RELEASE_REPORT_SCHEMA_TAG = "sporta/quality-gates/w803@1";

/** The release verdict vocabulary (GATES.md §2, the normative composition). */
export type ReleaseVerdict = "PASS" | "PENDING-HUMAN-REVIEW" | "FAIL";

/**
 * The human failure classes that yield `PENDING-HUMAN-REVIEW` when the
 * machine gates pass (GATES.md §2): the record is absent, structurally
 * malformed, or does not cover the current checklist. A completed review
 * with failing items is NOT pending — it is a definitive FAIL.
 */
const PENDING_HUMAN_REVIEW_CLASSES: ReadonlySet<string> = new Set([
  "record-missing",
  "record-malformed",
  "record-incomplete",
]);

/** The report's human-review section (the work order's structure: the record echo + the failure class). */
export interface HumanReviewSection extends HumanReviewDetail {
  /** The human gate row's verdict (echoed; the row itself is in `gates`). */
  readonly gateVerdict: GateVerdict;
}

/** The report's accounting table (the never-silent ledger, GATES.md §3). */
export interface AccountingSection {
  /** The accounting gate row's verdict (echoed; the row itself is in `gates`). */
  readonly gateVerdict: GateVerdict;
  /** The policy's gate count (the ledger's total). */
  readonly totalGates: number;
  /** The report's actual gate row count (must equal `totalGates`). */
  readonly rowCount: number;
  /** The reconciled buckets: `totalGates = pass + fail + notRunnable`, always. */
  readonly counts: { readonly pass: number; readonly fail: number; readonly notRunnable: number };
  /** The four reconciliation checks, in fixed order, with their evidence. */
  readonly checks: readonly AccountingCheck[];
  /** True iff the accounting gate passed (every check) and the table reconciles. */
  readonly reconciles: boolean;
}

/** The full W803 release readiness report. */
export interface ReleaseReadinessReport {
  /** Report schema tag: `"sporta/quality-gates/w803@1"`. */
  readonly schemaTag: string;
  /** The gate policy's identity (which policy produced this report). */
  readonly policyId: string;
  /** One row per policy gate, in policy order (the accounted ledger). */
  readonly gates: readonly GateRow[];
  /** The human-review section (the record echo + failure class). */
  readonly humanReview: HumanReviewSection;
  /** The accounting table (counts + the reconciliation checks). */
  readonly accounting: AccountingSection;
  /** The overall release verdict (GATES.md §2). */
  readonly verdict: ReleaseVerdict;
}

/** The evaluation options (the policy is overridable for composition tests; the CLI always uses the canonical policy). */
export interface ReleaseEvaluationOptions {
  /** The gate policy (defaults to the canonical {@link GATE_POLICY}; validated fail-loud). */
  readonly policy?: GatePolicyDocument;
}

/**
 * Composes the overall release verdict (GATES.md §2, the one documented
 * composition — no gate decisions in scattered ifs; blocking flags and
 * roles come from the policy data):
 *
 * 1. any BLOCKING machine or accounting gate that is not PASS → `FAIL`
 *    (`NOT_RUNNABLE` included — a gate that could not run fails the
 *    release);
 * 2. otherwise (the machine side passed), the human gate decides:
 *    PASS → `PASS`; an incomplete-class failure (record absent, malformed,
 *    or not covering the current checklist) → `PENDING-HUMAN-REVIEW`; a
 *    completed review with failing items → `FAIL`;
 * 3. any other human-gate failure (an unknown failure class) → `FAIL`
 *    (fail-closed: an unclassifiable failure is never a pending, never a
 *    pass).
 */
function composeOverallVerdict(rows: readonly GateRow[]): ReleaseVerdict {
  const machineSideFailed = rows.some(
    (row) => row.blocking && row.role !== "human" && row.verdict !== "PASS",
  );
  if (machineSideFailed) {
    return "FAIL";
  }
  const humanRow = rows.find((row) => row.role === "human");
  if (humanRow === undefined) {
    return "FAIL"; // the policy invariants guarantee a human gate; fail-closed regardless
  }
  if (humanRow.verdict === "PASS") {
    return "PASS";
  }
  const failureCode = humanRow.reason?.code;
  if (failureCode !== undefined && PENDING_HUMAN_REVIEW_CLASSES.has(failureCode)) {
    return "PENDING-HUMAN-REVIEW";
  }
  return "FAIL";
}

/**
 * Evaluates the release readiness of one release evaluation input: runs
 * every policy gate (the real W503/W605 evaluations and the fail-closed
 * human review), reconciles the ledger, and composes the overall verdict.
 *
 * PURE and deterministic: the same input (and options) yields a
 * byte-identical canonical report on every call — no clock, no RNG, no
 * I/O, and the input is never mutated. Throws `QualityGateError`
 * (`policy-malformed` / `input-malformed`) on a malformed policy or input
 * ENVELOPE, fail-loud — never a silently-degraded evaluation. Everything
 * that goes wrong INSIDE a gate is an accounted row, never a throw.
 */
export function evaluateReleaseReadiness(
  input: ReleaseEvaluationInput,
  options: ReleaseEvaluationOptions = {},
): ReleaseReadinessReport {
  const policy = options.policy ?? GATE_POLICY;
  assertGatePolicyInvariants(policy);
  const validatedInput = validateReleaseInputShape(input);
  const subject = runSubjectGates(validatedInput, policy);
  const reconciliation = reconcileGateLedger(subject.rows, policy.gates);
  const accountingEntryIndex = policy.gates.findIndex((entry) => entry.role === "accounting");
  const accountingEntry = policy.gates[accountingEntryIndex];
  if (accountingEntry === undefined) {
    // Unreachable (the policy invariants require exactly one accounting gate); fail-closed regardless.
    throw new Error(
      "quality gates: the policy invariants require exactly one accounting-role gate",
    );
  }
  const accountingRow: GateRow = {
    gateId: accountingEntry.gateId,
    name: accountingEntry.name,
    sourcePackage: accountingEntry.sourcePackage,
    role: "accounting",
    blocking: accountingEntry.blocking,
    verdict: reconciliation.verdict,
    reason:
      reconciliation.verdict === "PASS"
        ? null
        : {
            code: "ledger-unreconciled",
            message: `the ledger did not reconcile: ${reconciliation.checks
              .filter((check) => !check.pass)
              .map((check) => check.checkId)
              .join(", ")} failed`,
          },
  };
  const rows: readonly GateRow[] = [...subject.rows, accountingRow];
  const humanRow = rows.find((row) => row.role === "human");
  const humanReviewSection: HumanReviewSection = {
    gateVerdict: humanRow === undefined ? "NOT_RUNNABLE" : humanRow.verdict,
    ...subject.humanReview,
  };
  const accountingRowCount = rows.length;
  const counts = {
    pass: reconciliation.subjectCounts.pass + (reconciliation.verdict === "PASS" ? 1 : 0),
    fail: reconciliation.subjectCounts.fail + (reconciliation.verdict === "FAIL" ? 1 : 0),
    notRunnable:
      reconciliation.subjectCounts.notRunnable +
      (reconciliation.verdict === "NOT_RUNNABLE" ? 1 : 0),
  };
  const accountingSection: AccountingSection = {
    gateVerdict: reconciliation.verdict,
    totalGates: policy.gates.length,
    rowCount: accountingRowCount,
    counts,
    checks: reconciliation.checks,
    reconciles:
      reconciliation.verdict === "PASS" &&
      accountingRowCount === policy.gates.length &&
      policy.gates.length === counts.pass + counts.fail + counts.notRunnable,
  };
  return {
    schemaTag: RELEASE_REPORT_SCHEMA_TAG,
    policyId: policy.policyId,
    gates: rows,
    humanReview: humanReviewSection,
    accounting: accountingSection,
    verdict: composeOverallVerdict(rows),
  };
}

/**
 * The canonical serialization of a release report: 2-space JSON + a
 * trailing newline. Byte-stable by construction (the report contains no
 * primitive arrays — every list is a list of objects — so the
 * serialization is also prettier-stable; pinned by `test/cli.test.ts`).
 */
export function canonicalReportBytes(report: ReleaseReadinessReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
