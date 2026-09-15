/**
 * The fail-loud error of the W803 release gate suite.
 *
 * The quality-gates package COMPOSES the real W503/W605 evaluations; it
 * defines no metrics and no thresholds of its own. Its own fail-loud
 * surface covers exactly the three documents this package OWNS:
 *
 * - the GATE POLICY table (`policy-malformed` — an inconsistent policy is
 *   a construction bug, never a silently-degraded release evaluation);
 * - the RELEASE EVALUATION INPUT envelope (`input-malformed` — the caller
 *   supplied a structurally invalid input document);
 * - the HUMAN REVIEW RECORD (`record-malformed` — a structurally invalid
 *   record; a missing or semantically incomplete record is NOT an error,
 *   it is an accounted gate outcome: `PENDING-HUMAN-REVIEW`).
 *
 * Errors thrown by the COMPOSED packages (`TemporalEvaluationError`,
 * `SceneEvaluationError`) are NOT wrapped or coerced: the gate runners
 * catch them, echo their class/code/path verbatim into the gate row's
 * accounted reason, and count the gate `NOT_RUNNABLE` (which counts as
 * FAIL) — never a silent skip. Exactly the W503/W605 error convention
 * (`code` + JSON `path`), so one tooling surface handles all three.
 */
/** The closed error-code vocabulary (one per structural failure class). */
export type QualityGateErrorCode =
  /** The gate policy table is structurally or semantically inconsistent. */
  | "policy-malformed"
  /** The release evaluation input envelope is structurally malformed. */
  | "input-malformed"
  /** The human review record is structurally malformed (fail-loud, with the JSON path). */
  | "record-malformed";

/** A structural quality-gates problem (never a measured gate outcome). */
export class QualityGateError extends Error {
  readonly code: QualityGateErrorCode;
  /** The JSON path of the offending value (e.g. `$.humanReview.reviewer.name`). */
  readonly path: string;
  /** Machine-readable details (JSON-safe, never free-form text). */
  readonly details: Record<string, unknown>;

  constructor(
    code: QualityGateErrorCode,
    path: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(`quality gates: ${path}: ${message} (${code})`);
    this.name = "QualityGateError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

/** Throws a {@link QualityGateError} (internal validation helper). */
export function fail(
  code: QualityGateErrorCode,
  path: string,
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new QualityGateError(code, path, message, details);
}
