/**
 * Internal shared helpers for @sporta/observability.
 *
 * Not exported from the package barrel: these are the numeric primitives both
 * `metrics` (histogram `stats()`) and `trace` (summary percentiles) build on,
 * kept in one place so the percentile definition is singular and testable.
 */
import type { HistogramStats } from "./metrics";

/**
 * Nearest-rank percentile of a NON-EMPTY, ASCENDING-sorted sample: the
 * ceil(p/100 * n)-th smallest value (1-indexed). This is the classic
 * nearest-rank method — no interpolation, no dependencies.
 *
 * Examples: p50 of [1..100] is 50; p95 of [1..100] is 95; p95 of a 4-value
 * sample is the 4th (ceil(3.8) = 4) smallest value.
 */
export function nearestRankPercentile(sortedValues: readonly number[], percentile: number): number {
  const count = sortedValues.length;
  if (count === 0) {
    throw new RangeError("nearestRankPercentile requires a non-empty sorted sample");
  }
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 100) {
    throw new RangeError(`percentile must be in (0, 100] (got ${String(percentile)})`);
  }
  const rank = Math.ceil((percentile / 100) * count);
  const index = Math.min(Math.max(rank, 1), count) - 1;
  const value = sortedValues[index];
  if (value === undefined) {
    // Defensive: index was clamped into [0, count - 1].
    throw new RangeError("nearestRankPercentile index out of bounds");
  }
  return value;
}

/**
 * Summarizes a numeric sample: count, min, max, mean, p50, p95 — all computed
 * from an ascending sort with nearest-rank percentiles (no dependencies).
 *
 * An EMPTY sample is reported as all-zero stats with `count: 0` (an honest
 * histogram of nothing; observability primitives must not throw on empty).
 */
export function summarizeNumbers(values: readonly number[]): HistogramStats {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) {
    // Defensive: length was checked above.
    throw new RangeError("summarizeNumbers failed to read sample bounds");
  }
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    min: first,
    max: last,
    mean: sum / sorted.length,
    p50: nearestRankPercentile(sorted, 50),
    p95: nearestRankPercentile(sorted, 95),
  };
}

/** Asserts a finite number (fail-loud guard shared by metrics and trace). */
export function assertFiniteNumber(value: number, operation: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${operation} requires a finite number (got ${String(value)})`);
  }
}
