/**
 * The W803 gate runners: the four accounted gates that compose the REAL
 * evaluations of the two completed evaluation packages into one release
 * verdict. This module IMPORTS AND RUNS their real public APIs — it
 * re-implements NOTHING:
 *
 * - {@link runTemporalGate} — W503's real `evaluateTemporalConsistency`
 *   over each supplied fixture clip; the sub-verdict IS that report's own
 *   verdict (`report.verdict.pass`); every threshold that bites is W503's
 *   own pinned threshold, carried VERBATIM in the failing checks. This
 *   package defines ZERO new numeric thresholds for it.
 * - {@link runSceneGate} — W605's real `evaluateSceneOutput` over each
 *   supplied fixture; same verbatim-verdict rule (zero-threshold
 *   semantics are W605's own, referenced not re-stated).
 * - {@link runHumanReviewGate} — fail-closed human review over the
 *   docs/REVIEW.md record contract (`./review.ts`): a missing, malformed,
 *   or incomplete record is an ACCOUNTED not-runnable human gate → the
 *   release verdict becomes `PENDING-HUMAN-REVIEW` (via the policy's
 *   `notRunnableOutcome`), never PASS, never a silent skip.
 * - {@link reconcileGateRows} / {@link buildAccountingRow} — the
 *   never-silent ledger: every policy gate must appear exactly once, with
 *   policy-faithful fields, and the counts must reconcile
 *   (gates = pass + fail + not-runnable). A gate that silently vanishes
 *   is itself a failure.
 *
 * Never-silent accounting (docs/GATES.md §2): a gate whose measurement
 * input is missing (undefined case input, empty fixture list) or is
 * rejected by the source package (any thrown error — malformed manifest,
 * malformed scene input) becomes NOT-RUNNABLE with the accounted reason,
 * and counts as FAIL for the release verdict. The release evaluation
 * never throws from a gate runner — every failure is an accounted row
 * (a runner-internal error is itself accounted as not-runnable, which
 * blocks the release loudly rather than crashing it silently).
 *
 * Purity: no clock, no RNG, no I/O. Every value in every row is either
 * carried VERBATIM from a source report (property reads, never
 * recomputed) or derived deterministically from accounted counts.
 */
import { evaluateTemporalConsistency } from "@sporta/renderer-evaluation";
import type {
  TemporalConsistencyReport,
  TemporalEvaluationInput,
} from "@sporta/renderer-evaluation";
import { evaluateSceneOutput } from "@sporta/scene-evaluation";
import type { SceneEvaluationReport, SceneEvaluationInput } from "@sporta/scene-evaluation";
import { fail, QualityGateError } from "./errors";
import type { GateId, GatePolicy, GatePolicyEntry, NotRunnableOutcome } from "./policy";
import {
  HUMAN_REVIEW_CHECKLIST_VERSION,
  reviewRecordCompleteness,
  validateHumanReviewRecord,
} from "./review";
import type { HumanReviewRecord, HumanReviewRecordStatus } from "./review";

/** One gate's verdict (the accounting vocabulary — nothing else exists). */
export type GateVerdict = "PASS" | "FAIL" | "NOT-RUNNABLE";

/** The runtime verdict vocabulary (the accounting table's buckets). */
export const GATE_VERDICTS: readonly GateVerdict[] = ["PASS", "FAIL", "NOT-RUNNABLE"];

/** One measured value carried VERBATIM from a source report. */
export interface GateKeyValue {
  /** The value's metric path in the SOURCE report (`geometry.jumpCount`). */
  readonly metric: string;
  /** The source report's own value (a property read, never recomputed). */
  readonly value: number;
}

/** One failing check, carried VERBATIM from a source report's verdict. */
export interface CarriedCheck {
  readonly metric: string;
  readonly operator: string;
  readonly threshold: number;
  readonly measured: number;
  readonly pass: boolean;
}

/** One fixture evaluation inside a machine gate (the accounted sub-row). */
export interface GateSubEvaluation {
  /** The fixture's documented name (accounted verbatim). */
  readonly fixtureName: string;
  readonly verdict: GateVerdict;
  /** The accounted cause when this fixture could not be evaluated. */
  readonly notRunnableReason?: string;
  /** The source report's own schema tag (provenance of the carried values). */
  readonly reportSchemaTag?: string;
  /** The source report's own `input` block, echoed verbatim (all scalars). */
  readonly evaluated?: Record<string, string | number | boolean>;
  /** Every numeric top-level metric of every metrics section, verbatim. */
  readonly keyValues: readonly GateKeyValue[];
  /** The source report's total check count (its full evidence width). */
  readonly checkCount?: number;
  /** The source report's failing-check count. */
  readonly failedCheckCount?: number;
  /** The source report's `verdict.failures`, carried verbatim. */
  readonly failingChecks: readonly CarriedCheck[];
  /** Scene gates only: the source report's findings accounting, verbatim. */
  readonly findings?: {
    readonly recorded: number;
    readonly dropped: number;
    readonly truncated: boolean;
    readonly cap: number;
  };
  /** Scene gates only: the seven per-dimension verdicts, verbatim. */
  readonly dimensionVerdicts?: readonly { readonly dimension: string; readonly pass: boolean }[];
}

/** One gate row of the release report (the accounted ledger entry). */
export interface ReleaseGateRow {
  readonly gateId: GateId;
  readonly sourcePackage: string;
  readonly blocking: boolean;
  readonly notRunnableOutcome: NotRunnableOutcome;
  readonly verdict: GateVerdict;
  /**
   * The accounted reason, present when the gate is NOT-RUNNABLE (the
   * cause) or when the human gate FAILED (the rejected checklist items).
   * A machine gate's FAIL carries its reasons as the verbatim failing
   * checks — never an invented summary.
   */
  readonly reason?: string;
  /** Machine gates: one sub-row per evaluated fixture (empty otherwise). */
  readonly evaluations: readonly GateSubEvaluation[];
  /** Row-level counts (the human checklist counts / the accounting table). */
  readonly keyValues: readonly GateKeyValue[];
}

/** The report's human-review section (docs/GATES.md §4). */
export interface HumanReviewSection {
  /** True iff the human gate is blocking in the policy (it is, canonically). */
  readonly required: boolean;
  readonly recordStatus: HumanReviewRecordStatus;
  /** The checklist version the record was checked against. */
  readonly checklistVersion: string;
  /** The accounted problems (bounded; truncation is itself accounted). */
  readonly problems: readonly string[];
  /** The structurally valid record, echoed verbatim (absent when invalid). */
  readonly record?: HumanReviewRecord;
}

// ---------------------------------------------------------------------------
// Bounded-string helpers (report FORMAT bounds — documented in GATES.md §4;
// they are not quality thresholds)
// ---------------------------------------------------------------------------

/** Bound: any accounted reason string in the report. */
const MAX_REASON_LENGTH = 500;
/** Bound: the human-review section's problems list. */
const MAX_HUMAN_REVIEW_PROBLEMS = 16;
/** Bound: a fixture name in a gate input. */
const MAX_FIXTURE_NAME_LENGTH = 200;

/** Bounds an accounted reason deterministically (truncation is accounted). */
function boundReason(reason: string): string {
  if (reason.length <= MAX_REASON_LENGTH) return reason;
  const truncatedChars = reason.length - MAX_REASON_LENGTH;
  return `${reason.slice(0, MAX_REASON_LENGTH)} (+${truncatedChars} chars truncated)`;
}

/** Bounds the human-review problems list (truncation is accounted). */
function boundProblems(problems: readonly string[]): readonly string[] {
  if (problems.length <= MAX_HUMAN_REVIEW_PROBLEMS) return problems;
  const dropped = problems.length - MAX_HUMAN_REVIEW_PROBLEMS;
  return [...problems.slice(0, MAX_HUMAN_REVIEW_PROBLEMS), `(+${dropped} more problems truncated)`];
}

/** A deterministic, bounded error description (no stack traces — they vary). */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** The policy row of one gate (fail-closed: the policy is total). */
function policyRowOf(policy: GatePolicy, gateId: GateId): GatePolicyEntry {
  const entry = policy.gates.find((row) => row.gateId === gateId);
  if (entry === undefined) {
    fail("gate-policy-malformed", "$.gates", `gate "${gateId}" is missing from the policy`);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Verbatim carrying helpers
// ---------------------------------------------------------------------------

/**
 * Flattens every numeric top-level field of the given metrics sections
 * into `section.field` key values — property reads of the SOURCE report,
 * in fixed section order then alphabetical field order (deterministic;
 * non-numeric evidence lists are not scalars and are documented as
 * carried-by-the-source-report only). A non-finite number has no
 * canonical form and throws.
 */
function flattenNumericSections(sections: readonly (readonly [string, object])[]): GateKeyValue[] {
  const values: GateKeyValue[] = [];
  for (const [sectionName, section] of sections) {
    const record = section as Record<string, unknown>;
    for (const field of Object.keys(record).sort()) {
      const value = record[field];
      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          fail(
            "report-volatile",
            `${sectionName}.${field}`,
            "the source report carries a non-finite number — it has no canonical form",
          );
        }
        values.push({ metric: `${sectionName}.${field}`, value });
      }
    }
  }
  return values;
}

/**
 * Echoes a source report's `input` block as a scalar record (verbatim
 * property reads, keys sorted). A non-scalar value throws — the release
 * report's shape contract is strict, so upstream input-block drift fails
 * loud here rather than degrading silently.
 */
function scalarRecordOf(source: object, path: string): Record<string, string | number | boolean> {
  const echoed: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(source).sort()) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === "string" || typeof value === "boolean") {
      echoed[key] = value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        fail("report-volatile", `${path}.${key}`, "a non-finite number has no canonical form");
      }
      echoed[key] = value;
    } else {
      fail(
        "report-volatile",
        `${path}.${key}`,
        "the source report's input block carries a non-scalar value this suite cannot echo verbatim",
      );
    }
  }
  return echoed;
}

/** Carries one temporal threshold check verbatim. */
function carriedTemporalCheck(check: {
  metric: string;
  operator: string;
  threshold: number;
  measured: number;
  pass: boolean;
}): CarriedCheck {
  return {
    metric: check.metric,
    operator: check.operator,
    threshold: check.threshold,
    measured: check.measured,
    pass: check.pass,
  };
}

/** Carries one scene evaluation check verbatim. */
function carriedSceneCheck(check: {
  metric: string;
  operator: string;
  threshold: number;
  measured: number;
  pass: boolean;
}): CarriedCheck {
  return {
    metric: check.metric,
    operator: check.operator,
    threshold: check.threshold,
    measured: check.measured,
    pass: check.pass,
  };
}

/** Rolls sub-verdicts up: not-runnable dominates, then fail, then pass. */
function rollUpVerdicts(subs: readonly GateSubEvaluation[]): GateVerdict {
  if (subs.some((sub) => sub.verdict === "NOT-RUNNABLE")) return "NOT-RUNNABLE";
  if (subs.some((sub) => sub.verdict === "FAIL")) return "FAIL";
  return "PASS";
}

/** Joins the sub-rows' accounted reasons (bounded, deterministic). */
function joinedSubReasons(subs: readonly GateSubEvaluation[]): string | undefined {
  const reasons = subs
    .filter((sub) => sub.verdict === "NOT-RUNNABLE")
    .map((sub) => `${sub.fixtureName}: ${sub.notRunnableReason ?? "unaccounted cause"}`);
  return reasons.length === 0 ? undefined : boundReason(reasons.join("; "));
}

// ---------------------------------------------------------------------------
// The temporal stability gate (W503's real evaluation)
// ---------------------------------------------------------------------------

/** One temporal-gate fixture: a W503 evaluation input, or undefined (missing). */
export interface TemporalFixtureCase {
  /** The fixture's documented name (accounted verbatim in the report). */
  readonly name: string;
  /**
   * W503's evaluation input ({@link TemporalEvaluationInput}: the clip
   * manifest plus its SVG frames). `undefined` = the fixture's input is
   * missing — the gate becomes not-runnable with the accounted reason.
   * A payload the source package rejects is likewise accounted
   * not-runnable (its own fail-loud validation is the authority).
   */
  readonly input: TemporalEvaluationInput | undefined;
}

/** The temporal gate's input: the fixture list (empty = not runnable). */
export interface TemporalGateInput {
  readonly evaluations: readonly TemporalFixtureCase[];
}

/** Builds the accounted sub-row for one temporal fixture case. */
function runTemporalCase(fixtureCase: TemporalFixtureCase): GateSubEvaluation {
  const name = fixtureCase.name;
  if (typeof name !== "string" || name.length < 1 || name.length > MAX_FIXTURE_NAME_LENGTH) {
    fail(
      "release-input-malformed",
      "$.temporal.evaluations",
      `fixture name "${String(name)}" must be a non-empty string of at most ${MAX_FIXTURE_NAME_LENGTH} characters`,
    );
  }
  if (fixtureCase.input === undefined || fixtureCase.input === null) {
    return {
      fixtureName: name,
      verdict: "NOT-RUNNABLE",
      notRunnableReason: "missing input: no W503 evaluation input supplied for this fixture",
      keyValues: [],
      failingChecks: [],
    };
  }
  try {
    const report: TemporalConsistencyReport = evaluateTemporalConsistency(fixtureCase.input);
    const styleBytes =
      report.styleBytes === undefined ? [] : ([["styleBytes", report.styleBytes]] as const);
    return {
      fixtureName: name,
      verdict: report.verdict.pass ? "PASS" : "FAIL",
      reportSchemaTag: report.schemaTag,
      evaluated: scalarRecordOf(report.input, "$.input"),
      keyValues: flattenNumericSections([
        ["identity", report.identity],
        ...styleBytes,
        ["geometry", report.geometry],
        ["artifacts", report.artifacts],
      ]),
      checkCount: report.verdict.checks.length,
      failedCheckCount: report.verdict.failures.length,
      failingChecks: report.verdict.failures.map(carriedTemporalCheck),
    };
  } catch (error) {
    return {
      fixtureName: name,
      verdict: "NOT-RUNNABLE",
      notRunnableReason: boundReason(`package error: ${describeError(error)}`),
      keyValues: [],
      failingChecks: [],
    };
  }
}

/**
 * Runs the temporal stability gate: W503's real evaluation over every
 * supplied fixture. The gate verdict is the roll-up of the source
 * reports' own verdicts (not-runnable dominates — a gate whose evidence
 * is incomplete is never credited).
 */
export function runTemporalGate(input: TemporalGateInput, policy: GatePolicy): ReleaseGateRow {
  const entry = policyRowOf(policy, "temporal-stability");
  try {
    const evaluations = Array.isArray(input?.evaluations) ? input.evaluations : [];
    if (evaluations.length === 0) {
      return notRunnableRow(
        entry,
        "missing input: no fixture evaluations supplied — a gate that ran nothing is never a vacuous pass",
      );
    }
    const subs = evaluations.map(runTemporalCase);
    const reason = joinedSubReasons(subs);
    return {
      gateId: entry.gateId,
      sourcePackage: entry.sourcePackage,
      blocking: entry.blocking,
      notRunnableOutcome: entry.notRunnableOutcome,
      verdict: rollUpVerdicts(subs),
      ...(reason === undefined ? {} : { reason }),
      evaluations: subs,
      keyValues: [],
    };
  } catch (error) {
    return notRunnableRow(entry, `gate runner error: ${describeError(error)}`);
  }
}

/** Builds a not-runnable row for one policy entry (the accounted cause). */
function notRunnableRow(entry: GatePolicyEntry, cause: string): ReleaseGateRow {
  return {
    gateId: entry.gateId,
    sourcePackage: entry.sourcePackage,
    blocking: entry.blocking,
    notRunnableOutcome: entry.notRunnableOutcome,
    verdict: "NOT-RUNNABLE",
    reason: boundReason(cause),
    evaluations: [],
    keyValues: [],
  };
}

// ---------------------------------------------------------------------------
// The scene correctness gate (W605's real evaluation)
// ---------------------------------------------------------------------------

/** One scene-gate fixture: a W605 evaluation input, or undefined (missing). */
export interface SceneFixtureCase {
  /** The fixture's documented name (accounted verbatim in the report). */
  readonly name: string;
  /**
   * W605's evaluation input ({@link SceneEvaluationInput}: snapshots,
   * event stream, steps, output, optional plan). `undefined` = missing;
   * a payload the source package rejects is accounted not-runnable.
   */
  readonly input: SceneEvaluationInput | undefined;
}

/** The scene gate's input: the fixture list (empty = not runnable). */
export interface SceneGateInput {
  readonly evaluations: readonly SceneFixtureCase[];
}

/** Builds the accounted sub-row for one scene fixture case. */
function runSceneCase(fixtureCase: SceneFixtureCase): GateSubEvaluation {
  const name = fixtureCase.name;
  if (typeof name !== "string" || name.length < 1 || name.length > MAX_FIXTURE_NAME_LENGTH) {
    fail(
      "release-input-malformed",
      "$.scene.evaluations",
      `fixture name "${String(name)}" must be a non-empty string of at most ${MAX_FIXTURE_NAME_LENGTH} characters`,
    );
  }
  if (fixtureCase.input === undefined || fixtureCase.input === null) {
    return {
      fixtureName: name,
      verdict: "NOT-RUNNABLE",
      notRunnableReason: "missing input: no W605 evaluation input supplied for this fixture",
      keyValues: [],
      failingChecks: [],
    };
  }
  try {
    const report: SceneEvaluationReport = evaluateSceneOutput(fixtureCase.input);
    return {
      fixtureName: name,
      verdict: report.verdict.pass ? "PASS" : "FAIL",
      reportSchemaTag: report.schemaTag,
      evaluated: scalarRecordOf(report.input, "$.input"),
      keyValues: flattenNumericSections([
        ["sourceTruth", report.sourceTruth],
        ["score", report.score],
        ["clock", report.clock],
        ["identity", report.identity],
        ["ordering", report.ordering],
        ["sceneState", report.sceneState],
        ["direction", report.direction],
      ]),
      checkCount: report.verdict.checks.length,
      failedCheckCount: report.verdict.failures.length,
      failingChecks: report.verdict.failures.map(carriedSceneCheck),
      findings: {
        recorded: report.findings.entries.length,
        dropped: report.findings.dropped,
        truncated: report.findings.truncated,
        cap: report.findings.cap,
      },
      dimensionVerdicts: Object.entries(report.dimensions).map(([dimension, verdict]) => ({
        dimension,
        pass: verdict.pass,
      })),
    };
  } catch (error) {
    return {
      fixtureName: name,
      verdict: "NOT-RUNNABLE",
      notRunnableReason: boundReason(`package error: ${describeError(error)}`),
      keyValues: [],
      failingChecks: [],
    };
  }
}

/**
 * Runs the scene correctness gate: W605's real evaluation over every
 * supplied fixture (match and directed modes alike). Same roll-up rule
 * as the temporal gate.
 */
export function runSceneGate(input: SceneGateInput, policy: GatePolicy): ReleaseGateRow {
  const entry = policyRowOf(policy, "scene-correctness");
  try {
    const evaluations = Array.isArray(input?.evaluations) ? input.evaluations : [];
    if (evaluations.length === 0) {
      return notRunnableRow(
        entry,
        "missing input: no fixture evaluations supplied — a gate that ran nothing is never a vacuous pass",
      );
    }
    const subs = evaluations.map(runSceneCase);
    const reason = joinedSubReasons(subs);
    return {
      gateId: entry.gateId,
      sourcePackage: entry.sourcePackage,
      blocking: entry.blocking,
      notRunnableOutcome: entry.notRunnableOutcome,
      verdict: rollUpVerdicts(subs),
      ...(reason === undefined ? {} : { reason }),
      evaluations: subs,
      keyValues: [],
    };
  } catch (error) {
    return notRunnableRow(entry, `gate runner error: ${describeError(error)}`);
  }
}

// ---------------------------------------------------------------------------
// The human quality-checks gate (fail-closed review)
// ---------------------------------------------------------------------------

/** The human gate's accounted outcome: its row plus the report section. */
export interface HumanReviewGateOutcome {
  readonly row: ReleaseGateRow;
  readonly section: HumanReviewSection;
}

/**
 * Runs the human quality-checks gate. Fail-closed on every path:
 *
 * - record ABSENT (undefined/null) → not-runnable, "no human review
 *   record supplied";
 * - record MALFORMED (structural validation throws) → not-runnable, the
 *   violation's JSON path and reason accounted;
 * - record INCOMPLETE (valid but missing checklist results) →
 *   not-runnable, the missing item ids accounted;
 * - record COMPLETE with failed items → gate FAIL, the rejected items
 *   accounted (a review that happened and found problems);
 * - record COMPLETE, all pass → gate PASS.
 *
 * The not-runnable outcome maps to `PENDING-HUMAN-REVIEW` via the
 * policy's `notRunnableOutcome` — never PASS, never a silent skip.
 */
export function runHumanReviewGate(
  humanReview: unknown,
  policy: GatePolicy,
): HumanReviewGateOutcome {
  const entry = policyRowOf(policy, "human-quality-checks");
  if (humanReview === undefined || humanReview === null) {
    const cause = "no human review record supplied";
    return {
      row: notRunnableRow(entry, cause),
      section: {
        required: entry.blocking,
        recordStatus: "absent",
        checklistVersion: HUMAN_REVIEW_CHECKLIST_VERSION,
        problems: boundProblems([cause]),
      },
    };
  }
  let record: HumanReviewRecord;
  try {
    record = validateHumanReviewRecord(humanReview);
  } catch (error) {
    const cause =
      error instanceof QualityGateError
        ? `human review record malformed: ${error.path}: ${error.reason}`
        : `human review record malformed: ${describeError(error)}`;
    return {
      row: notRunnableRow(entry, cause),
      section: {
        required: entry.blocking,
        recordStatus: "malformed",
        checklistVersion: HUMAN_REVIEW_CHECKLIST_VERSION,
        problems: boundProblems([boundReason(cause)]),
      },
    };
  }
  const completeness = reviewRecordCompleteness(record);
  if (!completeness.complete) {
    const cause = `human review record incomplete: no result recorded for checklist item(s): ${completeness.missingItemIds.join(", ")}`;
    return {
      row: notRunnableRow(entry, cause),
      section: {
        required: entry.blocking,
        recordStatus: "incomplete",
        checklistVersion: HUMAN_REVIEW_CHECKLIST_VERSION,
        problems: boundProblems([boundReason(cause)]),
        record,
      },
    };
  }
  const failedItems = record.checklistResults.filter((result) => result.result === "fail");
  const passCount = record.checklistResults.length - failedItems.length;
  const row: ReleaseGateRow = {
    gateId: entry.gateId,
    sourcePackage: entry.sourcePackage,
    blocking: entry.blocking,
    notRunnableOutcome: entry.notRunnableOutcome,
    verdict: failedItems.length === 0 ? "PASS" : "FAIL",
    ...(failedItems.length === 0
      ? {}
      : {
          reason: boundReason(
            `human review rejected: checklist item(s) failed: ${failedItems
              .map((result) => result.itemId)
              .join(", ")}`,
          ),
        }),
    evaluations: [],
    keyValues: [
      { metric: "humanReview.checklistItemCount", value: record.checklistResults.length },
      { metric: "humanReview.checklistPassCount", value: passCount },
      { metric: "humanReview.checklistFailCount", value: failedItems.length },
    ],
  };
  const section: HumanReviewSection = {
    required: entry.blocking,
    recordStatus: "present-complete",
    checklistVersion: HUMAN_REVIEW_CHECKLIST_VERSION,
    problems:
      failedItems.length === 0
        ? []
        : boundProblems([
            boundReason(
              `checklist item(s) failed: ${failedItems.map((result) => result.itemId).join(", ")}`,
            ),
          ]),
    record,
  };
  return { row, section };
}

// ---------------------------------------------------------------------------
// The accounting gate (the never-silent ledger)
// ---------------------------------------------------------------------------

/** The ledger reconciliation outcome: pass flag plus accounted problems. */
export interface GateReconciliation {
  readonly pass: boolean;
  readonly problems: readonly string[];
}

/**
 * Reconciles the evaluated gate rows against the policy — the never-
 * silent ledger check, exported pure so tests can prove it bites:
 *
 * - every policy gate EXCEPT `gate-accounting` (whose row is derived from
 *   this very reconciliation) must have EXACTLY one row;
 * - no row may name a gate outside that set (an extra row is as much a
 *   ledger violation as a missing one);
 * - every row's verdict must be from the accounting vocabulary;
 * - every row's `sourcePackage`, `blocking`, and `notRunnableOutcome`
 *   must equal the policy's own row (the report never invents policy).
 */
export function reconcileGateRows(
  rows: readonly ReleaseGateRow[],
  policy: GatePolicy,
): GateReconciliation {
  const expected = policy.gates.filter((row) => row.gateId !== "gate-accounting");
  const problems: string[] = [];
  if (rows.length !== expected.length) {
    problems.push(
      `gate row count ${rows.length} does not match the policy's ${expected.length} accounted gates (excluding gate-accounting)`,
    );
  }
  const rowsById = new Map<string, ReleaseGateRow>();
  for (const row of rows) {
    if (!(GATE_VERDICTS as readonly string[]).includes(row.verdict)) {
      problems.push(`gate "${row.gateId}" carries the unknown verdict "${row.verdict}"`);
    }
    if (rowsById.has(row.gateId)) {
      problems.push(`duplicate gate row for "${row.gateId}"`);
    }
    rowsById.set(row.gateId, row);
    const policyEntry = expected.find((gate) => gate.gateId === row.gateId);
    if (policyEntry === undefined) {
      problems.push(`gate row "${row.gateId}" is not an accounted policy gate`);
      continue;
    }
    if (row.sourcePackage !== policyEntry.sourcePackage) {
      problems.push(
        `gate "${row.gateId}" claims source package "${row.sourcePackage}" but the policy pins "${policyEntry.sourcePackage}"`,
      );
    }
    if (row.blocking !== policyEntry.blocking) {
      problems.push(
        `gate "${row.gateId}" claims blocking ${String(row.blocking)} but the policy pins ${String(policyEntry.blocking)}`,
      );
    }
    if (row.notRunnableOutcome !== policyEntry.notRunnableOutcome) {
      problems.push(
        `gate "${row.gateId}" claims not-runnable outcome "${row.notRunnableOutcome}" but the policy pins "${policyEntry.notRunnableOutcome}"`,
      );
    }
  }
  for (const gate of expected) {
    if (!rowsById.has(gate.gateId)) {
      problems.push(
        `policy gate "${gate.gateId}" has no gate row — a gate silently vanished; the release evaluation is itself a failure`,
      );
    }
  }
  return { pass: problems.length === 0, problems };
}

/** Counts each verdict bucket over the rows (the accounting table's data). */
export function countGateVerdicts(rows: readonly ReleaseGateRow[]): {
  total: number;
  pass: number;
  fail: number;
  notRunnable: number;
} {
  let passCount = 0;
  let failCount = 0;
  let notRunnableCount = 0;
  for (const row of rows) {
    if (row.verdict === "PASS") passCount += 1;
    else if (row.verdict === "FAIL") failCount += 1;
    else if (row.verdict === "NOT-RUNNABLE") notRunnableCount += 1;
    else {
      fail(
        "report-volatile",
        "$.gates",
        `unknown verdict "${row.verdict}" has no accounting bucket`,
      );
    }
  }
  return { total: rows.length, pass: passCount, fail: failCount, notRunnable: notRunnableCount };
}

/**
 * Builds the accounting gate's own row from the reconciliation of the
 * other gates. The row's key values are the ledger counts over ALL FOUR
 * rows (including this one — its verdict is known before its counts are
 * computed, so nothing is circular). PASS iff the ledger reconciles.
 */
export function buildAccountingRow(
  reconciliation: GateReconciliation,
  precedingRows: readonly ReleaseGateRow[],
  policy: GatePolicy,
): ReleaseGateRow {
  const entry = policyRowOf(policy, "gate-accounting");
  const verdict: GateVerdict = reconciliation.pass ? "PASS" : "FAIL";
  const rowWithoutCounts: ReleaseGateRow = {
    gateId: entry.gateId,
    sourcePackage: entry.sourcePackage,
    blocking: entry.blocking,
    notRunnableOutcome: entry.notRunnableOutcome,
    verdict,
    ...(reconciliation.pass
      ? {}
      : {
          reason: boundReason(
            `ledger reconciliation failed: ${reconciliation.problems.join("; ")}`,
          ),
        }),
    evaluations: [],
    keyValues: [],
  };
  const counts = countGateVerdicts([...precedingRows, rowWithoutCounts]);
  return {
    ...rowWithoutCounts,
    keyValues: [
      { metric: "accounting.totalGates", value: counts.total },
      { metric: "accounting.passCount", value: counts.pass },
      { metric: "accounting.failCount", value: counts.fail },
      { metric: "accounting.notRunnableCount", value: counts.notRunnable },
    ],
  };
}
