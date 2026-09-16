/**
 * LIVE LATENCY MEASUREMENT (W915) — the pure math behind the honest
 * end-to-end latency numbers the live transport surfaces.
 *
 * WHAT IS MEASURED (and what is NOT — the honesty rules):
 *
 * - `measureLiveLatencyMs(frame.generatedAtMs, receivedAtMs)` is the
 *   TRANSPORT-LAYER measurement: the SERVER's real wall clock at the moment
 *   the frame finished generating, versus the CONSUMER's real wall clock at
 *   the moment the frame was received over the real HTTP network. Both ends
 *   read REAL clocks (`Date.now()` at the edges of the transport); no
 *   simulation, no smoothing, no invented numbers.
 * - The two clocks are NOT synchronized (no NTP discipline is assumed), so
 *   the measurement carries the hosts' clock skew in addition to the true
 *   wire+generation lag. This is documented at every surface that shows it
 *   ("measured end-to-end, real clocks, unsynchronized") — it is a REAL
 *   measurement, never a promise, and never fabricated.
 * - The ENGINE's constitution is untouched: the domain (renderer, world
 *   model) keeps its injected clocks; the real-clock reads live ONLY in the
 *   transport layer (generation timestamp + receipt timestamp), which is
 *   exactly the architecture-lock §8 posture ("end-to-end latency is a
 *   measurable SLO, not a UI promise").
 *
 * Absent metrics stay absent: an empty window has NO p50/p95/max (never a
 * faked zero).
 */

/** The honest snapshot of one live stream's measured latency window. */
export interface LiveLatencySnapshot {
  /** Samples in the window. */
  count: number;
  /** Last frame's measured latency (ms) — the live number. */
  lastMs: number;
  /** Minimum observed latency (ms). */
  minMs: number;
  /** Nearest-rank median (p50) of the window (ms). */
  p50Ms: number;
  /** Nearest-rank 95th percentile of the window (ms). */
  p95Ms: number;
  /** Maximum observed latency (ms). */
  maxMs: number;
}

/**
 * One measured end-to-end latency sample: `receivedAtMs − generatedAtMs`,
 * floored at 0 only when both clocks are the SAME host (curl-on-localhost
 * evidence can measure a negative skew — the value is kept verbatim there;
 * see {@link measureLiveLatencyMs}).
 */
export function measureLiveLatencyMs(generatedAtMs: number, receivedAtMs: number): number {
  return receivedAtMs - generatedAtMs;
}

/**
 * The running latency window for one live stream. Pure accounting over
 * added samples — percentiles use the nearest-rank method over a sorted
 * copy (the insertion order is preserved for `lastMs`).
 */
export class LiveLatencyWindow {
  private readonly samples: number[] = [];

  /** Adds one measured sample (any finite number — skew can be negative). */
  add(latencyMs: number): void {
    if (!Number.isFinite(latencyMs)) {
      throw new Error(`live latency samples must be finite (got ${String(latencyMs)})`);
    }
    this.samples.push(latencyMs);
  }

  /** Number of samples in the window. */
  get size(): number {
    return this.samples.length;
  }

  /**
   * The honest snapshot — `null` when no sample was measured yet (an absent
   * metric stays absent; never a faked zero).
   */
  snapshot(): LiveLatencySnapshot | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      count: sorted.length,
      lastMs: this.samples[this.samples.length - 1]!,
      minMs: sorted[0]!,
      p50Ms: nearestRank(sorted, 0.5),
      p95Ms: nearestRank(sorted, 0.95),
      maxMs: sorted[sorted.length - 1]!,
    };
  }

  /** Clears the window (the client resets per stream). */
  reset(): void {
    this.samples.length = 0;
  }
}

/** Nearest-rank percentile: `sorted[ceil(p*n)-1]` (p in (0,1]). */
function nearestRank(sorted: readonly number[], p: number): number {
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}
