/**
 * The W803 GATE RUNNERS — the composition core (deliverable 1).
 *
 * Every machine gate IMPORTS AND RUNS the real public evaluation of its
 * completed source package over that package's real fixtures; NOTHING is
 * re-implemented here. The gate verdict IS the source report's own
 * verdict — this package defines no thresholds for it (GATES.md §7) and
 * never re-derives it.
 *
 * Fail-closed composition (the never-silent accounting, GATES.md §3):
 *
 * - a gate whose input is ABSENT yields `NOT_RUNNABLE` (`input-missing`);
 * - a gate whose real evaluator THROWS (a malformed document, a package
 *   error) yields `NOT_RUNNABLE` with the source error echoed VERBATIM
 *   (class, code, JSON path, message) — never a silent skip, never a
 *   pass;
 * - a scene gate with an EMPTY run list is `NOT_RUNNABLE` — a gate with
 *   nothing measured is never a vacuous pass;
 * - a policy gate with NO registered runner is `NOT_RUNNABLE`
 *   (`no-runner`) — a custom policy naming an unknown gate cannot weaken
 *   the suite, it fails it;
 * - a runner that itself throws (a construction bug) is caught and
 *   accounted as `NOT_RUNNABLE` (`runner-error`) — the release evaluation
 *   never crashes into silence.
 *
 * `NOT_RUNNABLE` counts as FAIL for the release verdict (GATES.md §2).
 *
 * The evidence carried in each machine run row is VERBATIM from the source
 * report: the schema tag, the source verdict, the full source `input`
 * echo, and the FULL check list with its measured values (completeness
 * over selection — no judgment about which values are "key"; GATES.md §5).
 *
 * Purity: no clock, no RNG, no I/O — the runners are pure functions of
 * the input document (the source evaluations are themselves pure; pinned
 * upstream and re-pinned here by the determinism tests).
 */
import { evaluateRenderOutput } from "@sporta/renderer-evaluation";
import { evaluateSceneOutput } from "@sporta/scene-evaluation";
import type { SceneEvaluationInput } from "@sporta/scene-evaluation";
import { QualityGateError } from "./errors";
import {
  checkChecklistCoverage,
  validateHumanReviewRecord,
  type ChecklistResultEntry,
  type HumanReviewRecord,
  type RecordKind,
} from "./humanReview";
import type { ReleaseEvaluationInput } from "./input";
import type { GatePolicyDocument, GateRole } from "./policy";

// ---------------------------------------------------------------------------
// The gate row model
// ---------------------------------------------------------------------------

/** The closed gate verdict vocabulary (the accounting buckets, GATES.md §3). */
export const GATE_VERDICTS = ["PASS", "FAIL", "NOT_RUNNABLE"] as const;

/** One gate's verdict. `NOT_RUNNABLE` counts as FAIL for the release verdict. */
export type GateVerdict = (typeof GATE_VERDICTS)[number];

/** Why a gate did not pass (the accounted reason; null iff PASS). */
export type GateReasonCode =
  /** The gate's input was not supplied (absent or null). */
  | "input-missing"
  /** The scene gate's run list is empty — nothing was measured. */
  | "runs-empty"
  /** The gate ran and the source evaluation's checks failed (the measured FAIL). */
  | "checks-failed"
  /** The real source evaluator threw (the source error is echoed verbatim). */
  | "evaluation-error"
  /** No runner is registered for the policy gate (custom policy naming an unknown gate). */
  | "no-runner"
  /** The runner itself threw — a construction bug, accounted, never a crash. */
  | "runner-error"
  /** The human review record is absent. */
  | "record-missing"
  /** The human review record is structurally malformed (the validator's problem is echoed). */
  | "record-malformed"
  /** The human review record does not cover the current checklist. */
  | "record-incomplete"
  /** A completed review whose checklist has failing items — a definitive human FAIL. */
  | "checklist-item-failed"
  /** The accounting ledger did not reconcile against the policy. */
  | "ledger-unreconciled";

/** A source-package error echoed VERBATIM (never wrapped, never coerced). */
export interface SourceErrorEcho {
  /** The thrown value's class name (e.g. `TemporalEvaluationError`). */
  readonly className: string;
  /** The source error's typed code, when it has one (e.g. `manifest-malformed`). */
  readonly code: string | null;
  /** The source error's JSON path, when it has one (e.g. `$.frames[2].entities`). */
  readonly path: string | null;
  /** The source error's message, verbatim. */
  readonly message: string;
}

/** The accounted reason a gate did not pass (JSON-safe; details carry primitives only). */
export interface GateReason {
  readonly code: GateReasonCode;
  readonly message: string;
  readonly sourceError?: SourceErrorEcho;
  readonly details?: Record<string, unknown>;
}

/** One threshold check carried VERBATIM from a source report (GATES.md §5). */
export interface CarriedCheck {
  /** The metric's report path (e.g. `identity.flickerCount`). */
  readonly metric: string;
  /** `"max"` (measured <= threshold) or `"min"` (measured >= threshold). */
  readonly operator: string;
  /** The threshold (the SOURCE package's pinned threshold, verbatim). */
  readonly threshold: number;
  /** The measured value, verbatim. */
  readonly measured: number;
  readonly pass: boolean;
}

/** One evaluated fixture's evidence, carried verbatim from the source report. */
export interface GateRun {
  /** The fixture's name (from the release input; the accounted identity). */
  readonly fixture: string;
  /** The source report's schema tag, verbatim (e.g. `sporta/renderer-evaluation/w503@1`). */
  readonly reportSchemaTag: string;
  /** The source report's own verdict, verbatim. */
  readonly sourceVerdictPass: boolean;
  /** The source report's `input` object, echoed verbatim (renderer, session, counts). */
  readonly sourceInput: Readonly<Record<string, unknown>>;
  /** The source report's FULL check list with measured values, verbatim. */
  readonly checks: readonly CarriedCheck[];
  /** The source report's failing checks, verbatim (empty iff the source verdict passed). */
  readonly failingChecks: readonly CarriedCheck[];
}

/** One gate's report row (the work order's gate row: name, source package, verdict, evidence, reason). */
export interface GateRow {
  readonly gateId: string;
  readonly name: string;
  readonly sourcePackage: string;
  readonly role: GateRole;
  readonly blocking: boolean;
  readonly verdict: GateVerdict;
  /** null iff PASS; the accounted reason otherwise (including NOT_RUNNABLE). */
  readonly reason: GateReason | null;
  /** Present for machine gates that ran: one row per evaluated fixture, values verbatim. */
  readonly runs?: readonly GateRun[];
}

// ---------------------------------------------------------------------------
// The human review detail (the report's human-review section model)
// ---------------------------------------------------------------------------

/** The human gate's failure class (drives the PENDING-HUMAN-REVIEW semantics, GATES.md §2). */
export type HumanReviewFailureClass =
  "record-missing" | "record-malformed" | "record-incomplete" | "checklist-item-failed";

/** The validator's problem, echoed (set iff the failure class is `record-malformed`). */
export interface HumanReviewProblem {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** A checklist item id reference (object form: the canonical serialization stays structurally uniform). */
export interface ChecklistItemIdRef {
  readonly itemId: string;
}

/** The human review detail carried into the report's human-review section. */
export interface HumanReviewDetail {
  /** null iff PASS. */
  readonly failureClass: HumanReviewFailureClass | null;
  readonly problem: HumanReviewProblem | null;
  /** Checklist items with no result (set iff `record-incomplete`). */
  readonly missingItems: readonly ChecklistItemIdRef[];
  /** Result item ids not in the current checklist (set iff `record-incomplete`). */
  readonly extraItems: readonly ChecklistItemIdRef[];
  readonly recordKind: RecordKind | null;
  readonly checklistId: string | null;
  readonly reviewer: { readonly name: string; readonly role: string } | null;
  /** An authored `YYYY-MM-DD` date, verbatim (never read from a clock). */
  readonly date: string | null;
  /** The record's per-item results, echoed verbatim (empty when the record was not parsed). */
  readonly results: readonly ChecklistResultEntry[];
  /** Items whose result is `fail` (set iff `checklist-item-failed`). */
  readonly failingItems: readonly ChecklistItemIdRef[];
  /** The record's notes, verbatim (bounded by the record format). */
  readonly notes: string | null;
}

// ---------------------------------------------------------------------------
// Source-error echo + check carrying (verbatim, never coerced)
// ---------------------------------------------------------------------------

/** Echoes a thrown value VERBATIM (class, typed code/path when present, message). */
function echoError(error: unknown): SourceErrorEcho {
  if (error instanceof Error) {
    const carrier = error as { code?: unknown; path?: unknown };
    return {
      className: error.constructor?.name ?? error.name,
      code: typeof carrier.code === "string" ? carrier.code : null,
      path: typeof carrier.path === "string" ? carrier.path : null,
      message: error.message,
    };
  }
  return { className: typeof error, code: null, path: null, message: String(error) };
}

/** Carries one source check's five documented fields, values verbatim. */
function carryCheck(check: {
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

// ---------------------------------------------------------------------------
// The gate runners
// ---------------------------------------------------------------------------

/** What one runner produces for its row (plus the human detail for the human gate). */
interface GateRunnerOutcome {
  readonly verdict: GateVerdict;
  readonly reason: GateReason | null;
  readonly runs?: readonly GateRun[];
  readonly humanReview?: HumanReviewDetail;
}

/** Builds a NOT_RUNNABLE outcome. */
function notRunnable(
  code: GateReasonCode,
  message: string,
  sourceError?: SourceErrorEcho,
): GateRunnerOutcome {
  return {
    verdict: "NOT_RUNNABLE",
    reason: sourceError === undefined ? { code, message } : { code, message, sourceError },
  };
}

/**
 * The TEMPORAL STABILITY gate: the real W503 `evaluateRenderOutput` over
 * the supplied render output. The gate verdict is the source report's own
 * verdict; the thresholds applied are the source package's pinned
 * thresholds (`@sporta/renderer-evaluation` THRESHOLDS.md) — this package
 * defines none for it.
 */
function runTemporalGate(input: ReleaseEvaluationInput): GateRunnerOutcome {
  const temporal = input.temporal;
  if (temporal === undefined || temporal === null) {
    return notRunnable(
      "input-missing",
      "the temporal gate's input was not supplied ($.temporal is absent)",
    );
  }
  let report: ReturnType<typeof evaluateRenderOutput>;
  try {
    report = evaluateRenderOutput(temporal.output as Parameters<typeof evaluateRenderOutput>[0]);
  } catch (error) {
    const echo = echoError(error);
    return notRunnable(
      "evaluation-error",
      `the real W503 evaluation threw ${echo.className} (the gate cannot run; counted FAIL)`,
      echo,
    );
  }
  const run: GateRun = {
    fixture: temporal.fixture,
    reportSchemaTag: report.schemaTag,
    sourceVerdictPass: report.verdict.pass,
    sourceInput: { ...report.input },
    checks: report.verdict.checks.map(carryCheck),
    failingChecks: report.verdict.failures.map(carryCheck),
  };
  if (report.verdict.pass) {
    return { verdict: "PASS", reason: null, runs: [run] };
  }
  const failingMetrics = report.verdict.failures.map((check) => check.metric).join(", ");
  return {
    verdict: "FAIL",
    reason: {
      code: "checks-failed",
      message: `${report.verdict.failures.length} of ${report.verdict.checks.length} source checks failed (${failingMetrics})`,
    },
    runs: [run],
  };
}

/**
 * The SCENE CORRECTNESS gate: the real W605 `evaluateSceneOutput` over
 * every supplied evaluation input. The gate verdict is the conjunction of
 * the source reports' own verdicts; the thresholds applied are the source
 * package's pinned zero-thresholds (`@sporta/scene-evaluation`
 * THRESHOLDS.md) — this package defines none for it.
 */
function runSceneGate(input: ReleaseEvaluationInput): GateRunnerOutcome {
  const scene = input.scene;
  if (scene === undefined || scene === null) {
    return notRunnable(
      "input-missing",
      "the scene gate's inputs were not supplied ($.scene is absent)",
    );
  }
  if (scene.length === 0) {
    return notRunnable(
      "runs-empty",
      "the scene gate has no runs ($.scene is an empty list) — a gate with nothing measured is never a pass",
    );
  }
  const runs: GateRun[] = [];
  const failingRuns: string[] = [];
  for (const runInput of scene) {
    let report: ReturnType<typeof evaluateSceneOutput>;
    try {
      report = evaluateSceneOutput(runInput.input as SceneEvaluationInput);
    } catch (error) {
      const echo = echoError(error);
      return notRunnable(
        "evaluation-error",
        `the real W605 evaluation threw ${echo.className} on fixture "${runInput.fixture}" (the gate cannot run; counted FAIL)`,
        echo,
      );
    }
    runs.push({
      fixture: runInput.fixture,
      reportSchemaTag: report.schemaTag,
      sourceVerdictPass: report.verdict.pass,
      sourceInput: { ...report.input },
      checks: report.verdict.checks.map(carryCheck),
      failingChecks: report.verdict.failures.map(carryCheck),
    });
    if (!report.verdict.pass) {
      failingRuns.push(runInput.fixture);
    }
  }
  if (failingRuns.length === 0) {
    return { verdict: "PASS", reason: null, runs };
  }
  return {
    verdict: "FAIL",
    reason: {
      code: "checks-failed",
      message: `the source evaluation failed on ${failingRuns.length} of ${runs.length} fixtures (${failingRuns.join(", ")})`,
    },
    runs,
  };
}

/** Builds the human review detail from a parsed record + its failure class. */
function reviewDetail(
  failureClass: HumanReviewFailureClass | null,
  record: HumanReviewRecord | null,
  problem: HumanReviewProblem | null,
  missingItems: readonly string[],
  extraItems: readonly string[],
): HumanReviewDetail {
  const failingItems =
    record === null
      ? []
      : record.checklistResults
          .filter((result) => result.result === "fail")
          .map((result) => result.itemId);
  return {
    failureClass,
    problem,
    missingItems: missingItems.map((itemId) => ({ itemId })),
    extraItems: extraItems.map((itemId) => ({ itemId })),
    recordKind: record === null ? null : record.recordKind,
    checklistId: record === null ? null : record.checklistId,
    reviewer: record === null ? null : { name: record.reviewer.name, role: record.reviewer.role },
    date: record === null ? null : record.date,
    results: record === null ? [] : record.checklistResults.map((result) => ({ ...result })),
    failingItems: failingItems.map((itemId) => ({ itemId })),
    notes: record === null ? null : record.notes,
  };
}

/**
 * The HUMAN QUALITY CHECKS gate: fail-closed review-record validation
 * (deliverable 1c; the checklist and record format are docs/REVIEW.md's).
 * A missing, malformed, or incomplete record NEVER passes and is never
 * silently skipped: the verdict is FAIL with the failure class recorded,
 * and the release verdict becomes PENDING-HUMAN-REVIEW when the machine
 * gates pass (GATES.md §2). A complete record with failing items is a
 * definitive human FAIL.
 */
function runHumanGate(input: ReleaseEvaluationInput): GateRunnerOutcome {
  const record = input.humanReview;
  if (record === undefined || record === null) {
    return {
      verdict: "FAIL",
      reason: {
        code: "record-missing",
        message: "no human review record was supplied ($.humanReview is absent)",
      },
      humanReview: reviewDetail("record-missing", null, null, [], []),
    };
  }
  let parsed: HumanReviewRecord;
  try {
    parsed = validateHumanReviewRecord(record);
  } catch (error) {
    if (error instanceof QualityGateError) {
      const problem = { code: error.code, path: error.path, message: error.message };
      return {
        verdict: "FAIL",
        reason: {
          code: "record-malformed",
          message: `the review record is malformed: ${error.message}`,
          details: { sourceCode: error.code, path: error.path },
        },
        humanReview: reviewDetail("record-malformed", null, problem, [], []),
      };
    }
    throw error;
  }
  const coverage = checkChecklistCoverage(parsed);
  if (!coverage.complete) {
    return {
      verdict: "FAIL",
      reason: {
        code: "record-incomplete",
        message: `the review record does not cover the current checklist (missing: ${coverage.missingItems.join(", ") || "none"}; extra: ${coverage.extraItems.join(", ") || "none"})`,
      },
      humanReview: reviewDetail(
        "record-incomplete",
        parsed,
        null,
        coverage.missingItems,
        coverage.extraItems,
      ),
    };
  }
  const failingItems = parsed.checklistResults
    .filter((result) => result.result === "fail")
    .map((result) => result.itemId);
  if (failingItems.length > 0) {
    return {
      verdict: "FAIL",
      reason: {
        code: "checklist-item-failed",
        message: `the completed review found failing checklist items (${failingItems.join(", ")})`,
        details: { failingCount: failingItems.length },
      },
      humanReview: reviewDetail("checklist-item-failed", parsed, null, [], []),
    };
  }
  return { verdict: "PASS", reason: null, humanReview: reviewDetail(null, parsed, null, [], []) };
}

// ---------------------------------------------------------------------------
// The runner registry + the subject-gates pass
// ---------------------------------------------------------------------------

/** One gate's runner, keyed by gate id (the policy decides which gates run). */
type GateRunner = (input: ReleaseEvaluationInput) => GateRunnerOutcome;

/**
 * The runner registry: the closed set of gate implementations this package
 * ships. A policy gate whose id has no entry here is `NOT_RUNNABLE`
 * (`no-runner`) — fail-closed: a custom policy naming an unknown gate
 * fails the release, it never weakens the suite.
 */
const RUNNERS: Readonly<Record<string, GateRunner>> = {
  "temporal-stability": runTemporalGate,
  "scene-correctness": runSceneGate,
  "human-quality-checks": runHumanGate,
};

/** The subject-gates pass: rows for every non-accounting policy gate + the human detail. */
export interface SubjectGateRun {
  /** One row per non-accounting policy gate, in policy order. */
  readonly rows: readonly GateRow[];
  /** The human gate's detail (a record-missing-shaped detail when the human gate could not run). */
  readonly humanReview: HumanReviewDetail;
}

/**
 * Runs every non-accounting policy gate over the input, fail-closed and
 * fully accounted: every policy gate produces exactly one row (the
 * accounting gate — appended by the report assembly — reconciles this
 * bijection), and no runner error escapes into a crash (it is accounted
 * as `NOT_RUNNABLE` `runner-error`).
 */
export function runSubjectGates(
  input: ReleaseEvaluationInput,
  policy: GatePolicyDocument,
): SubjectGateRun {
  /** The row under construction (mutable; published as the readonly row). */
  interface MutableRow {
    gateId: string;
    name: string;
    sourcePackage: string;
    role: GateRole;
    blocking: boolean;
    verdict: GateVerdict;
    reason: GateReason | null;
    runs?: readonly GateRun[];
  }
  const rows: GateRow[] = [];
  let humanReview: HumanReviewDetail | undefined;
  for (const entry of policy.gates) {
    if (entry.role === "accounting") {
      continue; // assembled after the reconciliation (report.ts)
    }
    const row: MutableRow = {
      gateId: entry.gateId,
      name: entry.name,
      sourcePackage: entry.sourcePackage,
      role: entry.role,
      blocking: entry.blocking,
      verdict: "NOT_RUNNABLE",
      reason: {
        code: "no-runner",
        message: `no runner is registered for gate "${entry.gateId}" (the gate cannot run; counted FAIL)`,
      },
    };
    const runner = RUNNERS[entry.gateId];
    if (runner !== undefined) {
      try {
        const outcome = runner(input);
        row.verdict = outcome.verdict;
        row.reason = outcome.reason;
        if (outcome.runs !== undefined) {
          row.runs = outcome.runs;
        }
        if (outcome.humanReview !== undefined) {
          humanReview = outcome.humanReview;
        }
      } catch (error) {
        const echo = echoError(error);
        row.verdict = "NOT_RUNNABLE";
        row.reason = {
          code: "runner-error",
          message: `the gate runner for "${entry.gateId}" threw ${echo.className} (a construction bug, accounted; counted FAIL)`,
          sourceError: echo,
        };
      }
    }
    rows.push(row);
  }
  return {
    rows,
    // The human gate's runner always produces its detail; the fallback
    // (failureClass null, nothing parsed) covers a human gate that could
    // not run at all (no-runner / runner-error) — its row carries the
    // accounted reason, and the section echoes the row's verdict.
    humanReview: humanReview ?? reviewDetail(null, null, null, [], []),
  };
}
