/**
 * Structured, fail-loud errors of the W503 temporal consistency evaluation.
 *
 * The measurement core NEVER silently skips, defaults, or repairs malformed
 * input: a render manifest that does not satisfy the structural contract the
 * metrics rely on (see `./validate.ts`) aborts the evaluation with a
 * {@link TemporalEvaluationError} carrying the JSON path of the offending
 * field. This mirrors the repo-wide fail-loud convention (W403's comparator
 * errors, W502's `RendererContractError` admissions).
 */

/** Why an evaluation aborted (fail-loud, never a silent skip). */
export type TemporalEvaluationErrorCode =
  /** The clip manifest (or a frame/entity/caption entry) is structurally malformed. */
  | "manifest-malformed"
  /** The SVG frame documents supplied for style-byte measurement are malformed. */
  | "frames-malformed";

/**
 * A structured evaluation error. `path` is a JSON path into the evaluated
 * document (`$.frames[3].entities[2].positionMeters.x`); `reason` describes
 * the violated invariant. Deterministic message: always
 * `"temporal evaluation: <path>: <reason>"`.
 */
export class TemporalEvaluationError extends Error {
  readonly code: TemporalEvaluationErrorCode;
  readonly path: string;
  readonly reason: string;

  constructor(code: TemporalEvaluationErrorCode, path: string, reason: string) {
    super(`temporal evaluation: ${path}: ${reason}`);
    this.name = "TemporalEvaluationError";
    this.code = code;
    this.path = path;
    this.reason = reason;
  }
}

/** Throws a {@link TemporalEvaluationError} (internal validation helper). */
export function fail(code: TemporalEvaluationErrorCode, path: string, reason: string): never {
  throw new TemporalEvaluationError(code, path, reason);
}
