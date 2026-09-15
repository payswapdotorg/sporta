/**
 * The W803 ACCOUNTING GATE — the never-silent ledger (deliverable 1d).
 *
 * A release evaluation where a gate silently vanishes is itself a failure.
 * This module reconciles the report's own ledger against the gate policy
 * (GATES.md §3, the normative contract, pinned by `test/report.test.ts`):
 *
 * - **row-count** — every policy gate produced exactly one report row
 *   (the accounting row itself is appended by the report assembly, so the
 *   subject rows must cover exactly the policy minus accounting);
 * - **gate-set** — the subject rows' gate ids equal the policy's
 *   non-accounting gate ids, in order (no vanished gate, no duplicated
 *   gate, no invented gate);
 * - **verdict-vocabulary** — every row's verdict is from the closed
 *   vocabulary `PASS | FAIL | NOT_RUNNABLE` (a row that is none of these
 *   cannot be counted, and is therefore a ledger failure);
 * - **count-reconciliation** — every subject row lands in exactly one
 *   bucket: subject rows = pass + fail + not-runnable.
 *
 * The accounting verdict is the conjunction of the four checks. The final
 * report table (assembled by `./report.ts`) adds the accounting row itself
 * to the counts, so the published identity is:
 *
 *     total gates = pass + fail + not-runnable   (and rowCount = total)
 *
 * A `NOT_RUNNABLE` row (missing input, source-package error) counts as
 * FAIL for the release verdict — a gate that could not run is never a
 * skip, never a pass (GATES.md §2).
 */
import type { GateRow, GateVerdict } from "./gates";
import { GATE_VERDICTS } from "./gates";
import { ACCOUNTING_CHECK_IDS } from "./policy";

/** One accounting check with its evidence (all four, in fixed order). */
export interface AccountingCheck {
  /** One of the closed vocabulary {@link ACCOUNTING_CHECK_IDS}. */
  readonly checkId: string;
  readonly pass: boolean;
  /** The measured evidence, in one deterministic line. */
  readonly detail: string;
}

/** The reconciliation of the subject rows against the policy. */
export interface AccountingReconciliation {
  /** The accounting gate's verdict: PASS iff every check passes. */
  readonly verdict: GateVerdict;
  readonly checks: readonly AccountingCheck[];
  /** The subject rows' bucket counts (the accounting row is added by the report assembly). */
  readonly subjectCounts: {
    readonly pass: number;
    readonly fail: number;
    readonly notRunnable: number;
  };
  readonly subjectRowCount: number;
}

/**
 * Reconciles the subject gate rows against the policy. PURE and total:
 * it never throws on ledger inconsistencies — inconsistencies are the
 * MEASURED outcome (the accounting verdict FAILs on them, with each
 * failing check's evidence in `checks`). The closed check-id vocabulary is
 * pinned to {@link ACCOUNTING_CHECK_IDS}.
 */
export function reconcileGateLedger(
  subjectRows: readonly GateRow[],
  policyGates: readonly { gateId: string; role: string }[],
): AccountingReconciliation {
  const expectedSubjectGates = policyGates.filter((gate) => gate.role !== "accounting");
  const rowGateIds = subjectRows.map((row) => row.gateId);
  const expectedGateIds = expectedSubjectGates.map((gate) => gate.gateId);
  const rowCountPass =
    subjectRows.length === expectedSubjectGates.length &&
    policyGates.length === expectedSubjectGates.length + 1;
  const gateSetPass =
    rowGateIds.length === expectedGateIds.length &&
    rowGateIds.every((gateId, index) => gateId === expectedGateIds[index]);
  const vocabularyOffenders = subjectRows
    .filter((row) => !(GATE_VERDICTS as readonly string[]).includes(row.verdict))
    .map((row) => `${row.gateId}:${String(row.verdict)}`);
  const vocabularyPass = vocabularyOffenders.length === 0;
  const pass = subjectRows.filter((row) => row.verdict === "PASS").length;
  const fail = subjectRows.filter((row) => row.verdict === "FAIL").length;
  const notRunnable = subjectRows.filter((row) => row.verdict === "NOT_RUNNABLE").length;
  const arithmeticPass = subjectRows.length === pass + fail + notRunnable;
  const checks: AccountingCheck[] = [
    {
      checkId: ACCOUNTING_CHECK_IDS[0],
      pass: rowCountPass,
      detail: `${subjectRows.length} subject rows for ${expectedSubjectGates.length} expected subject gates (${policyGates.length} policy gates including accounting)`,
    },
    {
      checkId: ACCOUNTING_CHECK_IDS[1],
      pass: gateSetPass,
      detail: `row gate ids [${rowGateIds.join(", ")}] vs policy gate ids [${expectedGateIds.join(", ")}]`,
    },
    {
      checkId: ACCOUNTING_CHECK_IDS[2],
      pass: vocabularyPass,
      detail:
        vocabularyOffenders.length === 0
          ? `every row verdict is from the closed vocabulary (${GATE_VERDICTS.join(" | ")})`
          : `rows outside the closed vocabulary: ${vocabularyOffenders.join(", ")}`,
    },
    {
      checkId: ACCOUNTING_CHECK_IDS[3],
      pass: arithmeticPass,
      detail: `${subjectRows.length} subject rows = ${pass} pass + ${fail} fail + ${notRunnable} not-runnable`,
    },
  ];
  return {
    verdict: checks.every((check) => check.pass) ? "PASS" : "FAIL",
    checks,
    subjectCounts: { pass, fail, notRunnable },
    subjectRowCount: subjectRows.length,
  };
}
