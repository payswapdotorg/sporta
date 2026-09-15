/**
 * The temporal-stability gate — gate row 1 of the W803 release suite.
 *
 * This gate RUNS the real W503 evaluation: `evaluateTemporalConsistency`
 * from `@sporta/renderer-evaluation` (the `evaluateRenderOutput` /
 * `evaluateTemporalConsistency` family) over the caller-supplied clip, and
 * the gate verdict IS that report's own verdict — this package defines ZERO
 * numeric thresholds for it. Every threshold lives in and stays in the
 * source package's pinned `thresholds.ts` / `THRESHOLDS.md`; the gate row
 * carries the report's check list VERBATIM, so the thresholds the verdict
 * was measured against travel with the evidence
 * (docs/GATES.md §carried-evidence).
 *
 * Fail-closed layering (docs/GATES.md §fail-closed): a missing seam is an
 * ACCOUNTED `NOT-RUNNABLE`; an input the source package's own validation
 * rejects is an ACCOUNTED `NOT-RUNNABLE` with the typed error carried
 * verbatim — never a thrown exception out of the release evaluation, never
 * a silent skip.
 */
import { evaluateTemporalConsistency } from "@sporta/renderer-evaluation";
import type {
  TemporalConsistencyReport,
  TemporalEvaluationInput,
  ThresholdCheck,
} from "@sporta/renderer-evaluation";
import type { AccountedError, GateRowBase } from "./gateRow";
import { describeThrownError } from "./gateRow";
import { policyEntryOf } from "./gatePolicy";

/** The temporal gate's input seam: one clip (manifest + optional SVG frames). */
export interface TemporalGateInput {
  /**
   * The clip `evaluateTemporalConsistency` measures. The manifest's own
   * structural validation is the source package's fail-loud domain — a
   * malformed manifest is accounted here as `NOT-RUNNABLE`, never coerced.
   */
  readonly input: TemporalEvaluationInput;
}

/** The carried evidence when the evaluation ran. */
export interface TemporalGateEvidence {
  readonly ran: true;
  /** The source report's schema tag (e.g. `sporta/renderer-evaluation/w503@1`). */
  readonly schemaTag: string;
  /** The source report's input descriptor, verbatim. */
  readonly input: TemporalConsistencyReport["input"];
  /** Every check with its measured value and threshold, verbatim. */
  readonly checks: readonly ThresholdCheck[];
  /** The failing checks, verbatim (empty when the clip passes). */
  readonly failures: readonly ThresholdCheck[];
}

/** The accounted evidence when the evaluation could not run. */
export interface TemporalGateNotRun {
  readonly ran: false;
  /** Whether a seam was supplied at all (false = missing input). */
  readonly supplied: boolean;
  /** Why it could not run (missing input, or the source package's typed error). */
  readonly error: AccountedError;
}

export type TemporalGateMeasured = TemporalGateEvidence | TemporalGateNotRun;

/** The temporal-stability gate row. */
export interface TemporalGateRow extends GateRowBase {
  readonly gateId: "temporal-stability";
  readonly measured: TemporalGateMeasured;
}

/** Runs the temporal-stability gate over one seam. Pure; never throws. */
export function runTemporalGate(seam: TemporalGateInput | undefined): TemporalGateRow {
  const policy = policyEntryOf("temporal-stability");
  if (seam === undefined) {
    return {
      ...policy,
      gateId: "temporal-stability",
      verdict: "NOT-RUNNABLE",
      reason:
        "no temporal input supplied — the temporal-stability gate cannot run (counted FAIL: docs/GATES.md §verdicts)",
      measured: {
        ran: false,
        supplied: false,
        error: {
          name: "QualityGatesError",
          code: "gate-input-missing",
          message: "no temporal input supplied",
        },
      },
    };
  }
  let report: TemporalConsistencyReport;
  try {
    report = evaluateTemporalConsistency(seam.input);
  } catch (error) {
    const accounted = describeThrownError(error);
    return {
      ...policy,
      gateId: "temporal-stability",
      verdict: "NOT-RUNNABLE",
      reason:
        "the temporal evaluation could not run: " +
        `${accounted.name}${accounted.code === undefined ? "" : ` (${accounted.code})`}: ${accounted.message}` +
        " — counted FAIL, never skipped",
      measured: { ran: false, supplied: true, error: accounted },
    };
  }
  const pass = report.verdict.pass;
  return {
    ...policy,
    gateId: "temporal-stability",
    verdict: pass ? "PASS" : "FAIL",
    reason: pass
      ? `evaluateTemporalConsistency over the supplied clip: ${report.verdict.checks.length} check(s), all passing ` +
        "(thresholds referenced from packages/renderer-evaluation/THRESHOLDS.md)"
      : `evaluateTemporalConsistency over the supplied clip: ${report.verdict.failures.length} failing check(s): ` +
        report.verdict.failures.map((failure) => failure.metric).join(", "),
    measured: {
      ran: true,
      schemaTag: report.schemaTag,
      input: { ...report.input },
      checks: [...report.verdict.checks],
      failures: [...report.verdict.failures],
    },
  };
}
