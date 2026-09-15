/**
 * The fail-loud error of the W803 release-gate suite.
 *
 * Two vocabularies, never conflated:
 *
 * - `"input-malformed"` — the CALLER's `ReleaseGateInput` violates THIS
 *   package's own wrapper contract (unknown keys, wrong seam shapes). A
 *   programmer error: thrown, never accounted, never coerced.
 * - `"report-inconsistent"` — the evaluator itself produced a report its
 *   own structural self-check rejects (an evaluator bug, never an input
 *   problem; the W605 `RangeError` posture).
 *
 * What this error is NEVER used for: malformed evaluation INPUTS inside the
 * seams (a malformed clip manifest, a malformed scene fixture, a malformed
 * human-review record). Those are the dependency packages' own fail-loud
 * domains — caught by the gate runners and ACCOUNTED as `NOT-RUNNABLE` gate
 * verdicts with the reason carried verbatim (docs/GATES.md §fail-closed) —
 * and the human record's issues are accounted `PENDING-HUMAN-REVIEW`, never
 * thrown (docs/REVIEW.md §discipline). A gate that cannot run is a counted
 * FAIL, never an exception out of `evaluateReleaseReadiness`.
 */
export type QualityGatesErrorCode = "input-malformed" | "report-inconsistent";

/** The typed, JSON-path-carrying error (the W503/W605 convention). */
export class QualityGatesError extends Error {
  readonly code: QualityGatesErrorCode;
  /** The JSON path of the offending value (e.g. `$.temporal.input`). */
  readonly path: string;

  constructor(code: QualityGatesErrorCode, path: string, message: string) {
    super(`${code} at ${path}: ${message}`);
    this.name = "QualityGatesError";
    this.code = code;
    this.path = path;
  }
}
