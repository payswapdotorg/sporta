/**
 * The gate-accounting gate — gate row 4 of the W803 release suite: the
 * never-silent ledger.
 *
 * Two pure, exported, teeth-testable pieces:
 *
 * - {@link evaluateAccountingGate} — the gate itself: it checks the
 *   SUBJECT rows (every gate except this one) against the policy —
 *   totality (every declared gate has exactly one row; no undeclared
 *   rows), verdict vocabulary, and the never-silent rule (every
 *   NOT-RUNNABLE row carries an accounted reason). Any violation makes
 *   THIS gate FAIL, which fails the release: a release evaluation where a
 *   gate silently vanishes is itself a failure.
 * - {@link computeLedger} — the report's accounting table: per-gate
 *   verdicts in policy order and the counts that MUST reconcile
 *   (`totalGates === pass + fail + notRunnable`, carried as an explicit
 *   boolean). Fail-loud on a row set that is not exactly the policy's
 *   gates in policy order (an evaluator bug, never an input problem).
 */
import type { GateVerdict } from "./gateRow";
import { ACCOUNTING_GATE_ID } from "./gatePolicy";
import type { GatePolicyEntry } from "./gatePolicy";
import { policyEntryOf } from "./gatePolicy";
import { QualityGatesError } from "./errors";

/** The minimal row shape the ledger reasons over. */
export interface AccountableRow {
  readonly gateId: string;
  readonly verdict: GateVerdict;
  readonly reason: string;
}

/** The accounting gate's verdict plus its accounted violations. */
export interface AccountingCheck {
  readonly verdict: "PASS" | "FAIL";
  readonly violations: readonly string[];
}

/** The verdict vocabulary (closed; anything else is a violation). */
const VERDICTS: readonly GateVerdict[] = ["PASS", "FAIL", "NOT-RUNNABLE"];

/** The policy's subject-gate ids (every gate except the accounting gate itself). */
export function subjectGateIds(policy: readonly GatePolicyEntry[]): readonly string[] {
  return policy.filter((entry) => entry.gateId !== ACCOUNTING_GATE_ID).map((entry) => entry.gateId);
}

/**
 * The accounting gate: checks the subject rows against the policy. Pure;
 * never throws — problems ARE the output (violations), and the gate's
 * verdict is FAIL when any exists.
 */
export function evaluateAccountingGate(
  subjects: readonly AccountableRow[],
  policy: readonly GatePolicyEntry[],
): AccountingCheck {
  const violations: string[] = [];
  const declared = subjectGateIds(policy);
  for (const gateId of declared) {
    const rows = subjects.filter((row) => row.gateId === gateId);
    if (rows.length === 0) {
      violations.push(`gate "${gateId}" is declared in the policy but has no accounted row`);
    } else if (rows.length > 1) {
      violations.push(`gate "${gateId}" has ${rows.length} rows (exactly one required)`);
    }
  }
  for (const row of subjects) {
    if (!policy.some((entry) => entry.gateId === row.gateId)) {
      violations.push(`row "${row.gateId}" is not declared in the policy`);
    }
    if (!VERDICTS.includes(row.verdict)) {
      violations.push(`row "${row.gateId}" carries an unknown verdict "${String(row.verdict)}"`);
    } else if (row.verdict === "NOT-RUNNABLE" && row.reason.trim().length === 0) {
      violations.push(`gate "${row.gateId}" is NOT-RUNNABLE with no accounted reason`);
    }
  }
  const pass = subjects.filter((row) => row.verdict === "PASS").length;
  const fail = subjects.filter((row) => row.verdict === "FAIL").length;
  const notRunnable = subjects.filter((row) => row.verdict === "NOT-RUNNABLE").length;
  if (subjects.length !== pass + fail + notRunnable) {
    violations.push(
      `the subject ledger does not reconcile: ${subjects.length} row(s) != ${pass} pass + ${fail} fail + ${notRunnable} not-runnable`,
    );
  }
  return { verdict: violations.length === 0 ? "PASS" : "FAIL", violations };
}

/** The accounting gate row's measured evidence. */
export interface AccountingGateMeasured {
  /** The policy's subject-gate ids, in policy order. */
  readonly policySubjectGateIds: readonly string[];
  /** The subject rows' gate ids, in row order. */
  readonly accountedSubjectGateIds: readonly string[];
  /** The accounted violations (empty iff the verdict is PASS). */
  readonly violations: readonly string[];
}

/** The accounting gate row (the ledger's own row). */
export interface AccountingGateRow extends AccountableRow {
  readonly gateId: "gate-accounting";
  readonly name: string;
  readonly sourcePackage: string;
  readonly blocking: boolean;
  readonly notRunnableOutcome: GatePolicyEntry["notRunnableOutcome"];
  readonly measured: AccountingGateMeasured;
}

/** Builds the accounting gate row from its check over the subject rows. Pure. */
export function buildAccountingRow(
  check: AccountingCheck,
  subjects: readonly AccountableRow[],
  policy: readonly GatePolicyEntry[],
): AccountingGateRow {
  const entry = policyEntryOf(ACCOUNTING_GATE_ID, policy);
  return {
    gateId: "gate-accounting",
    name: entry.name,
    sourcePackage: entry.sourcePackage,
    blocking: entry.blocking,
    notRunnableOutcome: entry.notRunnableOutcome,
    verdict: check.verdict,
    reason:
      check.verdict === "PASS"
        ? `all ${subjects.length} subject gate(s) accounted; ledger reconciles (gates = pass + fail + not-runnable)`
        : `accounting violations: ${check.violations.join("; ")}`,
    measured: {
      policySubjectGateIds: subjectGateIds(policy),
      accountedSubjectGateIds: subjects.map((row) => row.gateId),
      violations: [...check.violations],
    },
  };
}

/** The report's accounting table. */
export interface GateLedger {
  readonly totalGates: number;
  readonly pass: number;
  readonly fail: number;
  readonly notRunnable: number;
  /** `totalGates === pass + fail + notRunnable` — carried explicitly, never assumed. */
  readonly reconciles: boolean;
  /** Per-gate verdicts, in policy order. */
  readonly perGate: readonly { readonly gateId: string; readonly verdict: GateVerdict }[];
  /** The policy's gate ids, in policy order. */
  readonly policyGateIds: readonly string[];
}

/**
 * Computes the ledger over the FULL row set (the accounting row included).
 * Fail-loud on a row set that is not exactly the policy's gates in policy
 * order, or on a verdict outside the vocabulary — both are evaluator bugs
 * (`report-inconsistent`), never input problems.
 */
export function computeLedger(
  rows: readonly AccountableRow[],
  policy: readonly GatePolicyEntry[],
): GateLedger {
  const policyIds = policy.map((entry) => entry.gateId);
  const rowIds = rows.map((row) => row.gateId);
  if (rows.length !== policy.length || rowIds.some((id, index) => id !== policyIds[index])) {
    throw new QualityGatesError(
      "report-inconsistent",
      "$.gates",
      `the ledger rows must be exactly the policy gates in policy order (policy: ${policyIds.join(", ")}; rows: ${rowIds.join(", ")})`,
    );
  }
  for (const row of rows) {
    if (!VERDICTS.includes(row.verdict)) {
      throw new QualityGatesError(
        "report-inconsistent",
        `$.gates[?].verdict`,
        `gate "${row.gateId}" carries an unknown verdict "${String(row.verdict)}"`,
      );
    }
  }
  const pass = rows.filter((row) => row.verdict === "PASS").length;
  const fail = rows.filter((row) => row.verdict === "FAIL").length;
  const notRunnable = rows.filter((row) => row.verdict === "NOT-RUNNABLE").length;
  return {
    totalGates: rows.length,
    pass,
    fail,
    notRunnable,
    reconciles: rows.length === pass + fail + notRunnable,
    perGate: rows.map((row) => ({ gateId: row.gateId, verdict: row.verdict })),
    policyGateIds: policyIds,
  };
}
