/**
 * Deterministic percentile math (W306): PURE functions over arrays of
 * non-negative millisecond latencies, computed by the NEAREST-RANK method.
 *
 * ## The method (pinned, documented, test-pinned)
 *
 * Nearest-rank (the classic, interpolation-free definition — NIST "Engineering
 * Statistics Handbook" §1.3.5 / the P^2-free baseline): for `n` samples sorted
 * ascending (1-based indexing), the p-th percentile is the sample at rank
 *
 *     rank(p) = ceil(p / 100 * n),  clamped to [1, n]
 *
 * - `p50` of [1..100] is the 50th sample (50); `p95` is the 95th sample (95).
 * - There is NO interpolation between samples: every reported percentile is a
 *   value that ACTUALLY occurred in the trace (an honest measured latency,
 *   never a synthetic blend). This is deliberately chosen over
 *   linear-interpolation percentiles because a latency SLO claim ("p95 is at
 *   most X") must be checkable against a real observed sample.
 * - `ceil` (not `round`/`floor`): with 20 samples, `rank(95) = ceil(19) = 19`
 *   → the 19th of 20 sorted samples (the second-largest); with 1 sample,
 *   every percentile is that sample. The clamp only fires for `p = 0`
 *   (never requested here) or empty inputs (rejected below).
 *
 * Determinism: sorting is `Array.prototype.sort` on numbers (a total order —
 * no tie-breaking nondeterminism), and every output is a pure function of the
 * input array. Same trace in, same numbers out, byte-identical reports.
 */
import { InvalidBenchmarkOptionsError } from "./errors";

/** The fixed percentile set the W306 report computes (the work item's ask). */
export const PERCENTILE_POINTS = [50, 95] as const;

/** One stage's latency summary (all fields measured milliseconds). */
export interface LatencyStats {
  /** Number of samples the summary was computed over. */
  count: number;
  /** The smallest observed sample. */
  minMs: number;
  /** The largest observed sample. */
  maxMs: number;
  /** Nearest-rank p50 (the median sample). */
  p50Ms: number;
  /** Nearest-rank p95. */
  p95Ms: number;
}

/**
 * Computes the nearest-rank p-th percentile of a NON-EMPTY array of finite
 * numbers >= 0. Does not mutate the input. Throws `InvalidBenchmarkOptionsError`
 * on an empty array or a malformed sample (fail loud — a stage with no samples
 * is a wiring bug, never a silent 0).
 */
export function nearestRankPercentile(samples: readonly number[], p: number): number {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new InvalidBenchmarkOptionsError(
      `nearestRankPercentile requires a non-empty samples array (got length ${String(samples?.length)})`,
    );
  }
  if (typeof p !== "number" || !Number.isFinite(p) || p <= 0 || p > 100) {
    throw new InvalidBenchmarkOptionsError(
      `nearestRankPercentile requires 0 < p <= 100 (got ${String(p)})`,
    );
  }
  const sorted = [...samples].sort((a, b) => a - b);
  for (const sample of sorted) {
    if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0) {
      throw new InvalidBenchmarkOptionsError(
        `nearestRankPercentile samples must be finite numbers >= 0 (got ${String(sample)})`,
      );
    }
  }
  const n = sorted.length;
  const rank = Math.min(Math.max(Math.ceil((p / 100) * n), 1), n);
  return sorted[rank - 1] as number;
}

/**
 * Summarizes one stage's latencies: count, min, max, nearest-rank p50 and p95.
 * Pure; fails loud on empty or malformed input (see
 * {@link nearestRankPercentile}).
 */
export function latencyStats(samples: readonly number[]): LatencyStats {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new InvalidBenchmarkOptionsError(
      `latencyStats requires a non-empty samples array (got length ${String(samples?.length)})`,
    );
  }
  for (const sample of samples) {
    if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0) {
      throw new InvalidBenchmarkOptionsError(
        `latencyStats samples must be finite numbers >= 0 (got ${String(sample)})`,
      );
    }
  }
  return {
    count: samples.length,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    p50Ms: nearestRankPercentile(samples, 50),
    p95Ms: nearestRankPercentile(samples, 95),
  };
}
