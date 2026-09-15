/**
 * Structured, fail-loud errors of the W803 release gate suite.
 *
 * The gate suite NEVER silently skips, defaults, coerces, or repairs input
 * it cannot trust: a release-readiness input, gate policy document, or
 * human-review record that does not satisfy its structural contract
 * aborts with a {@link QualityGateError} carrying the JSON path of the
 * offending field. This mirrors the repo-wide fail-loud convention
 * (W503's `TemporalEvaluationError`, W605's `SceneEvaluationError`).
 *
 * The distinction that matters for release semantics:
 *
 * - a MALFORMED *container* (the release input's own structure, a policy
 *   document, a structurally broken review record) THROWS — the caller
 *   authored the document and must fix it (a test-authoring or
 *   pipeline-authoring bug, never an evaluation result);
 * - a gate whose *measurement input* is missing or is rejected by the
 *   source evaluation package is NOT a throw at this layer: it is an
 *   ACCOUNTED not-runnable gate that counts as FAIL for the release
 *   verdict (see `./gates.ts`). The difference is documented in
 *   docs/GATES.md §2 and pinned by tests.
 */

/** Why the gate suite aborted (fail-loud, never a silent skip). */
export type QualityGateErrorCode =
  /** The release-readiness input's own structure is malformed. */
  | "release-input-malformed"
  /** The gate policy document is malformed or semantically illegal. */
  | "gate-policy-malformed"
  /** The human-review record is structurally malformed. */
  | "review-record-malformed"
  /** The report contains a value with no canonical form (evaluator bug). */
  | "report-volatile";

/**
 * A structured gate-suite error. `path` is a JSON path into the rejected
 * document (`$.gates[2].notRunnableOutcome`); `reason` describes the
 * violated invariant. Deterministic message: always
 * `"release gate: <path>: <reason>"`.
 */
export class QualityGateError extends Error {
  readonly code: QualityGateErrorCode;
  readonly path: string;
  readonly reason: string;

  constructor(code: QualityGateErrorCode, path: string, reason: string) {
    super(`release gate: ${path}: ${reason}`);
    this.name = "QualityGateError";
    this.code = code;
    this.path = path;
    this.reason = reason;
  }
}

/** Throws a {@link QualityGateError} (internal validation helper). */
export function fail(code: QualityGateErrorCode, path: string, reason: string): never {
  throw new QualityGateError(code, path, reason);
}
