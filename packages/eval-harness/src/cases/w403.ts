/**
 * The W403 case executor: replay comparability (W801 harness).
 *
 * Runs the REAL W403 evaluator — `runCrossRunEvaluation` from
 * `@sporta/evaluation` — over the frozen fixture and golden declared by the
 * suite config. The W403 methodology is inherently cross-RUN: the evaluator
 * itself spawns `runs` separate bun subprocesses (each one full
 * store → fusion → temporal walk) and compares every pair (plus the golden)
 * through the field-classified tolerance comparator. Running "the case
 * in-process" means the harness calls the evaluator's public API in its own
 * process; the evaluator's internal subprocess fan-out is its documented
 * method, not a harness implementation detail.
 *
 * MEASURED VALUES — the honest projection (documented, never silent):
 * the case's `measured` carries the evaluator's `EvaluationReport`
 * VERBATIM **except** the per-run `canonical` artifact bytes and parsed
 * `artifact` payloads, which are dropped. The dropped payloads are the
 * evaluated DATA (multi-KB each), already byte-pinned by the evaluator's own
 * checked-in golden and sha256-pinned fixture; the comparison summaries kept
 * here are the measured comparability evidence. A test pins the projection:
 * the case's measured deep-equals a hand-trimmed copy of the evaluator's
 * direct output, so nothing else is altered.
 */
import { runCrossRunEvaluation } from "@sporta/evaluation";
import type { ComparisonReport, EvaluationReport, RunnerOptions } from "@sporta/evaluation";
import { DEFAULT_EPSILON } from "@sporta/evaluation";
import type { CaseContext, CaseOutcome } from "./types";
import type { W403CaseConfig } from "../suite-config";

/** One subprocess run's status (the canonical/artifact payloads are dropped). */
export interface W403CaseRunRecord {
  /** 1-based run index. */
  readonly runIndex: number;
  /** The subprocess exit code (0 = success). */
  readonly exitCode: number;
  /** The subprocess stderr (empty on success). */
  readonly stderr: string;
}

/** One pairwise (or golden) comparison verdict, verbatim. */
export interface W403CaseComparisonOutcome {
  /** Human-identifying label, e.g. `"run 1 ↔ run 2"`. */
  readonly label: string;
  /** Whether the two canonical serializations are byte-identical. */
  readonly byteIdentical: boolean;
  /** The field-classified comparison report, verbatim. */
  readonly report: ComparisonReport;
}

/** The W403 case's measured values (the honest projection of the report). */
export interface W403CaseMeasured {
  /** Number of subprocess runs completed successfully. */
  readonly runsCompleted: number;
  /** The subprocess run statuses. */
  readonly runs: readonly W403CaseRunRecord[];
  /** Pairwise comparisons (run i ↔ run j, i < j), verbatim. */
  readonly pairwise: readonly W403CaseComparisonOutcome[];
  /** The golden comparison, verbatim (null when disabled or unavailable). */
  readonly golden: W403CaseComparisonOutcome | null;
  /** The evaluator's machine-readable failure reasons, verbatim. */
  readonly failureReasons: readonly string[];
}

/** The W403 case's thresholds (verbatim from the evaluator's exports). */
export interface W403CaseThresholds {
  /** The comparator's default epsilon (`DEFAULT_EPSILON`), verbatim. */
  readonly defaultEpsilon: number;
  /** Where every field's tolerance class and rationale is documented. */
  readonly toleranceDocument: string;
}

/** The tolerance contract document of the W403 evaluator (a reference, not data). */
export const W403_TOLERANCE_DOCUMENT = "packages/evaluation/TOLERANCE.md";

/** Runs the W403 case: the real cross-run evaluator, in-process. */
export function runW403Case(
  caseConfig: W403CaseConfig,
  context: CaseContext,
): CaseOutcome<W403CaseMeasured, W403CaseThresholds> {
  const runnerOptions: RunnerOptions = {
    runs: caseConfig.policy.runs,
    fixturePath: context.resolvePath(caseConfig.fixture.fixturePath),
    ...(caseConfig.fixture.goldenPath === null
      ? { goldenPath: null }
      : { goldenPath: context.resolvePath(caseConfig.fixture.goldenPath) }),
  };
  const evaluation = runCrossRunEvaluation(runnerOptions);

  const measured: W403CaseMeasured = projectEvaluationReport(evaluation);
  const thresholds: W403CaseThresholds = {
    defaultEpsilon: DEFAULT_EPSILON,
    toleranceDocument: W403_TOLERANCE_DOCUMENT,
  };
  return {
    verdict: evaluation.passed ? "PASS" : "FAIL",
    measured,
    thresholds,
    failureReasons: [...evaluation.failureReasons],
  };
}

/** Projects the evaluator's report onto the harness's measured shape. */
export function projectEvaluationReport(evaluation: EvaluationReport): W403CaseMeasured {
  return {
    runsCompleted: evaluation.runsCompleted,
    runs: evaluation.runs.map((run) => ({
      runIndex: run.runIndex,
      exitCode: run.exitCode,
      stderr: run.stderr,
    })),
    pairwise: evaluation.pairwise.map(projectComparisonOutcome),
    golden: evaluation.golden === null ? null : projectComparisonOutcome(evaluation.golden),
    failureReasons: [...evaluation.failureReasons],
  };
}

/** Projects one comparison outcome (drops nothing — carried verbatim). */
function projectComparisonOutcome(outcome: {
  label: string;
  report: ComparisonReport;
  byteIdentical: boolean;
}): W403CaseComparisonOutcome {
  return {
    label: outcome.label,
    byteIdentical: outcome.byteIdentical,
    report: outcome.report,
  };
}
