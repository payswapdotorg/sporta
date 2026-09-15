/**
 * The W803 release-readiness report — the composition core
 * (docs/GATES.md is the normative policy mirror).
 *
 * {@link evaluateReleaseReadiness} runs the four accounted gates —
 * temporal stability (the REAL `evaluateTemporalConsistency` of
 * `@sporta/renderer-evaluation`), scene correctness (the REAL
 * `evaluateSceneOutput` of `@sporta/scene-evaluation`), the fail-closed
 * human review gate, and the never-silent accounting gate — and assembles
 * ONE release verdict:
 *
 * - `PASS` only when every blocking gate passes AND the human review
 *   record is complete (every item pass);
 * - `PENDING-HUMAN-REVIEW` when every machine gate passes but the human
 *   record is missing, malformed, or incomplete;
 * - `FAIL` otherwise (a failing gate, or a gate that could not run —
 *   missing input or a package error — counts as FAIL, never a skip).
 *
 * Which gates exist, what they run, and how each failure propagates is
 * POLICY DATA (`src/gatePolicy.ts`, pinned both directions to
 * docs/GATES.md §gates by `test/policyDoc.test.ts`) — there are no
 * gate-privilege `if`s in the code.
 *
 * Determinism: the evaluation is a pure function of its input (no clock,
 * no RNG, no I/O; the only randomness-or-time anywhere in the package is
 * nowhere), and the report serializes byte-identically through
 * `canonicalJsonStringify` — pinned twice in-process and across two CLI
 * subprocess invocations with compared SHA-256 hashes
 * (`test/determinism.test.ts`).
 */
import type { AccountableRow } from "./accountingGate";
import { buildAccountingRow, computeLedger, evaluateAccountingGate } from "./accountingGate";
import type { AccountingGateRow, GateLedger } from "./accountingGate";
import type { GateVerdict } from "./gateRow";
import { GATE_POLICY, GATE_POLICY_ID, assertGatePolicyWellFormed } from "./gatePolicy";
import type { GatePolicyEntry } from "./gatePolicy";
import type { HumanGateMeasured, HumanGateRow } from "./humanGate";
import { runHumanGate } from "./humanGate";
import type { SceneFixtureCase, SceneGateRow } from "./sceneGate";
import { runSceneGate } from "./sceneGate";
import type { TemporalGateInput, TemporalGateRow } from "./temporalGate";
import { runTemporalGate } from "./temporalGate";
import { QualityGatesError } from "./errors";
import { validateReleaseGateInput } from "./validateInput";

/** The release report's schema tag (versioned with the report shape). */
export const REPORT_SCHEMA_TAG = "sporta/quality-gates/w803@1";

/** The overall release verdict. */
export type OverallVerdict = "PASS" | "PENDING-HUMAN-REVIEW" | "FAIL";

/** The release-gate input: the three seams (the accounting gate needs none). */
export interface ReleaseGateInput {
  /**
   * The temporal-stability seam. Absent → the gate is ACCOUNTED
   * `NOT-RUNNABLE` (counted FAIL). Present → its `input` is measured by
   * the real `evaluateTemporalConsistency`.
   */
  readonly temporal?: TemporalGateInput;
  /**
   * The scene-correctness seam: the fixture cases to evaluate. Absent or
   * empty → `NOT-RUNNABLE` (counted FAIL). Each case's content is
   * validated by the real `evaluateSceneOutput`.
   */
  readonly scene?: readonly SceneFixtureCase[];
  /**
   * The raw human-review record (usually parsed JSON of a checked-in
   * record — see `fixtures/human-review/self-check-record.json`). Unknown
   * by contract: missing/malformed/incomplete → `PENDING-HUMAN-REVIEW`
   * (when the machine gates pass), never a pass, never a throw.
   */
  readonly humanReview?: unknown;
}

/** One gate row of the report (the union of the four row types). */
export type GateRow = TemporalGateRow | SceneGateRow | HumanGateRow | AccountingGateRow;

/** One blocking gate's contribution to the overall verdict. */
export interface BlockingGateResult {
  readonly gateId: string;
  readonly verdict: GateVerdict;
  /** What this gate's verdict contributes to the release verdict. */
  readonly outcome: "pass" | "release-fail" | "pending-human-review";
}

/** The verdict section: the overall verdict, its accounted reason, the contributions. */
export interface VerdictSection {
  readonly overall: OverallVerdict;
  /** The accounted reason (deterministic; names the deciding gates). */
  readonly reason: string;
  /** Every blocking gate's contribution, in policy order. */
  readonly blockingGateResults: readonly BlockingGateResult[];
}

/** The full W803 release-readiness report. */
export interface ReleaseReadinessReport {
  /** Report schema tag: `"sporta/quality-gates/w803@1"`. */
  readonly schemaTag: string;
  /** The gate policy this release was evaluated under (referenced, not embedded). */
  readonly gatePolicy: {
    readonly policyId: string;
    readonly gateCount: number;
  };
  /** The gate rows, in policy order — one row per declared gate, never fewer. */
  readonly gates: readonly GateRow[];
  /** The human-review section (the human gate's full measured evidence). */
  readonly humanReview: HumanGateMeasured;
  /** The accounting table (counts reconcile: gates = pass + fail + not-runnable). */
  readonly accounting: GateLedger;
  /** The overall release verdict. */
  readonly verdict: VerdictSection;
}

/**
 * Evaluates the release readiness over the supplied seams. Pure and
 * deterministic: the same input yields a byte-identical canonical JSON
 * report on every call, in-process and across processes. Never throws for
 * evaluation-domain problems (a gate that cannot run is an ACCOUNTED
 * `NOT-RUNNABLE` row); throws `QualityGatesError("input-malformed")` only
 * for caller-side wrapper-contract violations, and
 * `QualityGatesError("report-inconsistent")` only if the evaluator itself
 * produced a report its own self-check rejects (an evaluator bug).
 */
export function evaluateReleaseReadiness(input: ReleaseGateInput): ReleaseReadinessReport {
  validateReleaseGateInput(input);
  assertGatePolicyWellFormed(GATE_POLICY);

  const temporal = runTemporalGate(input.temporal);
  const scene = runSceneGate(input.scene);
  const human = runHumanGate(input.humanReview);
  const subjects: readonly AccountableRow[] = [temporal, scene, human];

  const accountingCheck = evaluateAccountingGate(subjects, GATE_POLICY);
  const accounting = buildAccountingRow(accountingCheck, subjects, GATE_POLICY);

  const gates: readonly GateRow[] = [temporal, scene, human, accounting];
  const ledger = computeLedger(gates, GATE_POLICY);
  const verdict = deriveOverallVerdict(gates, GATE_POLICY);

  const report: ReleaseReadinessReport = {
    schemaTag: REPORT_SCHEMA_TAG,
    gatePolicy: { policyId: GATE_POLICY_ID, gateCount: GATE_POLICY.length },
    gates,
    humanReview: human.measured,
    accounting: ledger,
    verdict,
  };
  assertReportWellFormed(report);
  return report;
}

/**
 * Derives the overall release verdict from the gate rows under one policy
 * (the docs/GATES.md §verdicts table, executable). Exported because the
 * verdict MECHANISM is public and testable — including with test-only
 * policy variants (e.g. an advisory gate) that the canonical policy does
 * not use; `evaluateReleaseReadiness` itself always evaluates under
 * `GATE_POLICY` (no caller-supplied policy — a gate suite that lets its
 * caller weaken its own policy is not a gate suite).
 */
export function deriveOverallVerdict(
  gates: readonly GateRow[],
  policy: readonly GatePolicyEntry[],
): VerdictSection {
  const contributions: BlockingGateResult[] = [];
  const advisoryNotes: string[] = [];
  for (const gate of gates) {
    const entry = policy.find((candidate) => candidate.gateId === gate.gateId);
    if (entry === undefined) {
      throw new QualityGatesError(
        "report-inconsistent",
        "$.gates",
        `gate "${gate.gateId}" is not declared in the policy`,
      );
    }
    const outcome: BlockingGateResult["outcome"] =
      gate.verdict === "PASS"
        ? "pass"
        : entry.notRunnableOutcome === "pending-human-review" && gate.verdict === "NOT-RUNNABLE"
          ? "pending-human-review"
          : "release-fail";
    if (entry.blocking) {
      contributions.push({ gateId: gate.gateId, verdict: gate.verdict, outcome });
    } else if (gate.verdict !== "PASS") {
      advisoryNotes.push(`${gate.gateId} (${gate.verdict})`);
    }
  }
  const releaseFails = contributions.filter((result) => result.outcome === "release-fail");
  const pendings = contributions.filter((result) => result.outcome === "pending-human-review");

  let overall: OverallVerdict;
  let reason: string;
  if (releaseFails.length > 0) {
    overall = "FAIL";
    reason =
      "blocking gate(s) failed or could not run: " +
      releaseFails.map((result) => `${result.gateId} (${result.verdict})`).join(", ");
  } else if (pendings.length > 0) {
    overall = "PENDING-HUMAN-REVIEW";
    reason =
      "every machine gate passed, but the human review record is not satisfied: " +
      pendings.map((result) => `${result.gateId} (${result.verdict})`).join(", ");
  } else {
    overall = "PASS";
    reason =
      advisoryNotes.length === 0
        ? "every blocking gate passed and the human review record is complete"
        : "every blocking gate passed (advisory gate(s) recorded non-pass verdicts: " +
          advisoryNotes.join(", ") +
          ")";
  }
  return { overall, reason, blockingGateResults: contributions };
}

/**
 * The evaluator's own structural self-check (the W605 posture: a report the
 * evaluator cannot stand behind is an evaluator BUG and throws — never a
 * silently degraded document). Checks: schema tags, gate totality and
 * order against the policy, verdict vocabulary, accounted reasons for
 * every non-PASS row, ledger reconciliation, human-review status
 * vocabulary, and the verdict's agreement with its own derivation.
 */
function assertReportWellFormed(report: ReleaseReadinessReport): void {
  const path = "$";
  if (report.schemaTag !== REPORT_SCHEMA_TAG) {
    throw new QualityGatesError("report-inconsistent", `${path}.schemaTag`, "wrong schema tag");
  }
  if (
    report.gatePolicy.policyId !== GATE_POLICY_ID ||
    report.gatePolicy.gateCount !== GATE_POLICY.length
  ) {
    throw new QualityGatesError(
      "report-inconsistent",
      `${path}.gatePolicy`,
      "the report does not reference the canonical gate policy",
    );
  }
  if (report.gates.length !== GATE_POLICY.length) {
    throw new QualityGatesError(
      "report-inconsistent",
      `${path}.gates`,
      `expected ${GATE_POLICY.length} gate rows, got ${report.gates.length}`,
    );
  }
  GATE_POLICY.forEach((entry, index) => {
    const gate = report.gates[index]!;
    if (gate.gateId !== entry.gateId) {
      throw new QualityGatesError(
        "report-inconsistent",
        `${path}.gates[${index}].gateId`,
        `expected "${entry.gateId}", got "${gate.gateId}"`,
      );
    }
    if (gate.name !== entry.name || gate.sourcePackage !== entry.sourcePackage) {
      throw new QualityGatesError(
        "report-inconsistent",
        `${path}.gates[${index}]`,
        `gate "${entry.gateId}" does not carry its policy identity verbatim`,
      );
    }
    if (gate.blocking !== entry.blocking || gate.notRunnableOutcome !== entry.notRunnableOutcome) {
      throw new QualityGatesError(
        "report-inconsistent",
        `${path}.gates[${index}]`,
        `gate "${entry.gateId}" does not carry its policy privileges verbatim`,
      );
    }
    if (gate.verdict !== "PASS" && gate.verdict !== "FAIL" && gate.verdict !== "NOT-RUNNABLE") {
      throw new QualityGatesError(
        "report-inconsistent",
        `${path}.gates[${index}].verdict`,
        `unknown verdict "${String(gate.verdict)}"`,
      );
    }
    if (gate.verdict !== "PASS" && gate.reason.trim().length === 0) {
      throw new QualityGatesError(
        "report-inconsistent",
        `${path}.gates[${index}].reason`,
        `gate "${entry.gateId}" is ${gate.verdict} with no accounted reason`,
      );
    }
  });
  if (
    report.accounting.totalGates !== report.gates.length ||
    !report.accounting.reconciles ||
    report.accounting.totalGates !==
      report.accounting.pass + report.accounting.fail + report.accounting.notRunnable
  ) {
    throw new QualityGatesError(
      "report-inconsistent",
      `${path}.accounting`,
      "the ledger does not reconcile (gates != pass + fail + not-runnable)",
    );
  }
  const status = report.humanReview.status;
  if (
    status !== "complete" &&
    status !== "missing" &&
    status !== "malformed" &&
    status !== "incomplete"
  ) {
    throw new QualityGatesError(
      "report-inconsistent",
      `${path}.humanReview.status`,
      `unknown status "${String(status)}"`,
    );
  }
  const rederived = deriveOverallVerdict(report.gates, GATE_POLICY);
  if (
    rederived.overall !== report.verdict.overall ||
    rederived.reason !== report.verdict.reason ||
    canonicalEqual(rederived.blockingGateResults, report.verdict.blockingGateResults) === false
  ) {
    throw new QualityGatesError(
      "report-inconsistent",
      `${path}.verdict`,
      "the recorded verdict disagrees with its own derivation",
    );
  }
}

/** Deep equality for the self-check's re-derivation comparison. */
function canonicalEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  const leftKeys = Object.keys(left as Record<string, unknown>).sort();
  const rightKeys = Object.keys(right as Record<string, unknown>).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, i) => key !== rightKeys[i])) {
    return false;
  }
  return leftKeys.every((key) =>
    canonicalEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}
