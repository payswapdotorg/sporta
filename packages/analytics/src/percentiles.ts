/**
 * Deterministic timing statistics (W804) — the nearest-rank percentile method,
 * the repo's pinned precedent (`@sporta/observability` `MetricsRegistry`
 * histograms, the W306 latency benchmark): NO interpolation, every reported
 * percentile is a value that ACTUALLY occurred in the recorded stream.
 *
 * Pure functions over arrays of non-negative finite numbers. Same input in,
 * same numbers out — byte-identical reports.
 */

/** One operation's timing summary (all fields in the injected-clock domain). */
export interface TimingStats {
  /** Number of samples the summary was computed over. */
  count: number;
  /** The smallest observed sample. */
  minMs: number;
  /** The largest observed sample. */
  maxMs: number;
  /** The arithmetic mean (sum / count — deterministic IEEE division). */
  meanMs: number;
  /** Nearest-rank p50 (the median sample). */
  p50Ms: number;
  /** Nearest-rank p95. */
  p95Ms: number;
}

/** The nearest-rank p-th percentile of a NON-EMPTY ascending-sorted array. */
function nearestRank(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  const rank = Math.min(Math.max(Math.ceil((p / 100) * n), 1), n);
  return sorted[rank - 1] as number;
}

/**
 * Computes the timing summary of a NON-EMPTY array of finite numbers >= 0.
 * Does not mutate the input. Throws on an empty array or a malformed sample
 * (fail loud — a stage with no samples is absent, never a silent zero).
 */
export function timingStats(samples: readonly number[]): TimingStats {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(
      `timingStats requires a non-empty samples array (got length ${String(samples?.length)})`,
    );
  }
  let sum = 0;
  for (const sample of samples) {
    if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0) {
      throw new Error(`timingStats received a malformed sample: ${String(sample)}`);
    }
    sum += sample;
  }
  const sorted = [...samples].sort((a, b) => a - b); // numbers: a total order
  return {
    count: sorted.length,
    minMs: sorted[0] as number,
    maxMs: sorted[sorted.length - 1] as number,
    meanMs: sum / sorted.length,
    p50Ms: nearestRank(sorted, 50),
    p95Ms: nearestRank(sorted, 95),
  };
}
