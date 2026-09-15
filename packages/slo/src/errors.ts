/**
 * The typed error surface of @sporta/slo (the repo's fail-loud convention —
 * `LatencyReportValidationError` in @sporta/latency-benchmark and
 * `TemporalEvaluationError` in @sporta/renderer-evaluation are the
 * precedents).
 *
 * Every failure in this package is a typed {@link SloError} carrying a
 * machine-readable code + the JSON path / context — never a partial result,
 * never a silently-swallowed check.
 */

/** The machine-readable failure codes (a controlled vocabulary). */
export const SLO_ERROR_CODES = [
  "slo-input-invalid",
  "slo-stage-missing",
  "slo-table-inconsistent",
  "slo-report-invalid",
] as const;

export type SloErrorCode = (typeof SLO_ERROR_CODES)[number];

/** The base error of every @sporta/slo failure. */
export class SloError extends Error {
  readonly code: SloErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: SloErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(`[${code}] ${message}`);
    this.name = "SloError";
    this.code = code;
    this.details = details;
  }
}

/** An input document failed schema validation (zod issues included). */
export class SloInputValidationError extends SloError {
  readonly issues: string;

  constructor(issues: string) {
    super("slo-input-invalid", `the latency SLO input failed validation: ${issues}`);
    this.name = "SloInputValidationError";
    this.issues = issues;
  }
}

/** A referenced stage is absent from the input (vocabulary lockstep). */
export class SloStageMissingError extends SloError {
  constructor(stage: string, scope: string) {
    super(
      "slo-stage-missing",
      `the ${scope} stage "${stage}" is absent from the input — the SLO table and ` +
        "the measurement vocabulary diverged (fail loud, never a silently-skipped SLO)",
      { stage, scope },
    );
    this.name = "SloStageMissingError";
  }
}

/** The SLO/policy table itself is inconsistent (a construction bug). */
export class SloTableInconsistentError extends SloError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("slo-table-inconsistent", message, details);
    this.name = "SloTableInconsistentError";
  }
}

/** Type guard for every {@link SloError} in this package. */
export function isSloError(value: unknown): value is SloError {
  return value instanceof SloError;
}
