/**
 * The fail-loud error of the W605 scene-correctness evaluation.
 *
 * Structural malformation (a malformed input document, an unknown
 * disposition value, a non-monotone frame index) is NEVER measured — it
 * throws {@link SceneEvaluationError} with a machine-readable JSON path,
 * exactly like the W503 `TemporalEvaluationError` convention. Measured
 * DEFECTS (a wrong score claim, a swapped identity token) never throw:
 * they are counted into the report and drive the verdict.
 */
/** The closed error-code vocabulary (one per structural failure class). */
export type SceneEvaluationErrorCode =
  | "input-malformed"
  | "snapshot-malformed"
  | "event-stream-malformed"
  | "step-malformed"
  | "output-malformed"
  | "frame-malformed"
  | "window-malformed"
  | "alignment-malformed";

/** A structural evaluation-input problem (never a measured defect). */
export class SceneEvaluationError extends Error {
  readonly code: SceneEvaluationErrorCode;
  /** The JSON path of the offending value (e.g. `$.frames[3].entities[0]`). */
  readonly path: string;
  /** Machine-readable details (JSON-safe, never free-form text). */
  readonly details: Record<string, unknown>;

  constructor(
    code: SceneEvaluationErrorCode,
    path: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(`SceneEvaluationError (${code}) at ${path}: ${message}`);
    this.name = "SceneEvaluationError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}
