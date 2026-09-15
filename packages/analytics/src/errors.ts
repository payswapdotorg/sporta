/**
 * The analytics error model (W804): fail-loud, typed errors for the two
 * boundaries where analytics refuses to guess —
 *
 * 1. {@link AnalyticsInputError} — an input value is NOT a valid W706 viewer
 *    telemetry event. This is the PRIVACY BOUNDARY: the W706 validator
 *    (`@sporta/viewer-shell`'s `parseTelemetryEvent`) is the ONE gate through
 *    which recorded events enter analytics, and anything it rejects (an
 *    unknown key, a wider shape, an out-of-vocabulary value) is rejected here
 *    with the W706 reason verbatim. Analytics never computes over a partial
 *    or widened stream.
 * 2. {@link AnalyticsReportValidationError} — a report document does not match
 *    the versioned zod report schema. Reports are VALIDATED, never trusted
 *    (the W306 report posture).
 * 3. {@link AnalyticsAccountingError} — the never-silent accounting identity
 *    (`eventsIn === classified + unclassifiable`) does not hold in a computed
 *    report. This is an internal-consistency failure and can only mean an
 *    implementation defect; it is thrown, never logged away.
 */

/** Thrown when a recorded input value is not a valid W706 telemetry event. */
export class AnalyticsInputError extends Error {
  /** The 0-based index of the offending value in the input array (or line). */
  readonly index: number;
  /** The W706 validator's rejection reason, verbatim. */
  readonly reason: string;

  constructor(message: string, index: number, reason: string) {
    super(message);
    this.name = "AnalyticsInputError";
    this.index = index;
    this.reason = reason;
  }
}

/** Thrown when a report document fails the versioned zod schema. */
export class AnalyticsReportValidationError extends Error {
  /** The zod issues, stringified deterministically (one per line). */
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[]) {
    super(message);
    this.name = "AnalyticsReportValidationError";
    this.issues = issues;
  }
}

/** Thrown when a computed report violates the accounting identity. */
export class AnalyticsAccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsAccountingError";
  }
}
