/**
 * Typed boundary errors for the W306 latency benchmark (the W301/W302/W303
 * fail-loud posture: a malformed input, a broken accounting identity, or an
 * unvalidatable report REJECTS loudly with a typed error naming the breach —
 * never a silently-degraded benchmark result).
 */

/** The marker interface every latency-benchmark error satisfies. */
export interface LatencyBenchmarkError {
  readonly scope: "latency-benchmark";
  readonly code: LatencyErrorCode;
}

/** The closed error-code vocabulary. */
export type LatencyErrorCode =
  | "invalid-benchmark-options"
  | "invalid-fixture"
  | "incomplete-benchmark-run"
  | "latency-accounting"
  | "latency-report-validation";

/** Thrown when `runLatencyBenchmark` receives structurally invalid options. */
export class InvalidBenchmarkOptionsError extends RangeError implements LatencyBenchmarkError {
  readonly scope = "latency-benchmark";
  readonly code = "invalid-benchmark-options" as const;
  constructor(message: string) {
    super(`runLatencyBenchmark: ${message}`);
    this.name = "InvalidBenchmarkOptionsError";
  }
}

/** Thrown when a live-stream fixture is structurally invalid (W306-authored). */
export class LatencyFixtureError extends RangeError implements LatencyBenchmarkError {
  readonly scope = "latency-benchmark";
  readonly code = "invalid-fixture" as const;
  constructor(message: string) {
    super(`live fixture: ${message}`);
    this.name = "LatencyFixtureError";
  }
}

/**
 * Thrown when the W304 orchestrator did not settle `"completed"` — the
 * latency report characterizes a COMPLETE controlled run (every fixture
 * update consumed, every batch terminal). An early-terminated run
 * (`stopped`/`cancelled`/`failed`, e.g. the W303 admitted-budget terminal
 * resource-limit) has incomplete evidence and is REFUSED loudly — never a
 * partial report that silently understates the stream.
 */
export class IncompleteBenchmarkRunError extends RangeError implements LatencyBenchmarkError {
  readonly scope = "latency-benchmark";
  readonly code = "incomplete-benchmark-run" as const;
  constructor(message: string) {
    super(`runLatencyBenchmark: ${message}`);
    this.name = "IncompleteBenchmarkRunError";
  }
}

/**
 * Thrown when a never-silent accounting identity is broken: every input
 * frame/batch must land in exactly one terminal bucket (`frames in = frames
 * emitted + every loss sink`), and the W304 orchestrator's own batch
 * identities must hold over the recorded trace. An imbalance REJECTS the
 * benchmark loudly — never a lying report.
 */
export class LatencyAccountingError extends RangeError implements LatencyBenchmarkError {
  readonly scope = "latency-benchmark";
  readonly code = "latency-accounting" as const;
  constructor(message: string) {
    super(`latency accounting broken: ${message}`);
    this.name = "LatencyAccountingError";
  }
}

/**
 * Thrown when a report document fails its versioned zod schema (unknown keys,
 * wrong types, non-monotonic timestamps, unbalanced accounting fields) — the
 * machine-readable report is VALIDATED, never trusted.
 */
export class LatencyReportValidationError extends RangeError implements LatencyBenchmarkError {
  readonly scope = "latency-benchmark";
  readonly code = "latency-report-validation" as const;
  constructor(message: string) {
    super(`latency report failed schema validation: ${message}`);
    this.name = "LatencyReportValidationError";
  }
}

/** Narrows an unknown thrown value to a latency-benchmark error. */
export function isLatencyBenchmarkError(value: unknown): value is LatencyBenchmarkError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { scope?: unknown }).scope === "latency-benchmark" &&
    typeof (value as { code?: unknown }).code === "string"
  );
}
