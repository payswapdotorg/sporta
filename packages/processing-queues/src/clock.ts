/**
 * The processing clock seam (W302).
 *
 * Every timing decision in a processing pipeline is injectable: retry backoff
 * sleeping, dead-letter timestamps, stage-latency measurement, checkpoint cut
 * times (docs/testing/HARNESS.md — no wall-clock reads anywhere in this
 * package; architecture-lock §12 latency measurement without `Date.now`).
 *
 * `VirtualProcessingClock` is the deterministic implementation, the W301
 * `VirtualClock` pattern adapted to DURATION-based sleeping (the W104
 * `RetryClock.sleep(ms)` shape, which the retry engine consumes):
 *
 * - virtual time advances ONLY when a `sleep()` registers — never
 *   spontaneously, never during microtask-only work. A registered sleep of
 *   `d` ms advances the clock by `d` immediately (at registration) and
 *   resolves without any real timer;
 * - overlapping concurrent sleeps each advance the clock by their own
 *   duration in registration order — the clock models per-sleep elapsed
 *   time, not wall-clock simultaneity. For a fixed program the registration
 *   order is deterministic, so run-to-run outputs are deep-equal;
 * - `advance(ms)` exists for tests and callers that want to move processing
 *   time forward explicitly (it fails loud on invalid input, like everything
 *   here).
 *
 * Real deployments inject their own clock (e.g. one backed by the real
 * `Date.now`/`setTimeout`); nothing in this package assumes wall time.
 */

/**
 * The clock every processing-queue component is injected with.
 *
 * - `now()` — current processing-clock reading in milliseconds;
 * - `sleep(durationMs)` — resolves after `durationMs` of clock time.
 */
export interface ProcessingClock {
  /** Current processing-clock reading (milliseconds). */
  now(): number;
  /** Sleeps for `durationMs` milliseconds (tests advance virtual time). */
  sleep(durationMs: number): Promise<void>;
}

/**
 * The deterministic virtual processing clock. Time advances only at
 * registered sleep deadlines; there are no real timers, so tests never
 * depend on wall-clock time.
 */
export class VirtualProcessingClock implements ProcessingClock {
  private currentMs: number;

  constructor(startMs: number = 0) {
    if (!Number.isFinite(startMs)) {
      throw new RangeError(
        `VirtualProcessingClock start time must be finite (got ${String(startMs)})`,
      );
    }
    this.currentMs = startMs;
  }

  /** Current virtual time (never advances without a registered sleep). */
  now(): number {
    return this.currentMs;
  }

  sleep(durationMs: number): Promise<void> {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return Promise.reject(
        new RangeError(
          `VirtualProcessingClock.sleep requires a finite duration >= 0 ` +
            `(got ${String(durationMs)})`,
        ),
      );
    }
    // Registration-time advancement: the sleep's duration is consumed the
    // moment it registers (documented in the module doc — deterministic,
    // no real waiting, no spontaneous advancement).
    this.currentMs += durationMs;
    return Promise.resolve();
  }

  /**
   * Advances virtual time by `ms` explicitly (test/caller tool; the same
   * fail-loud validation as `sleep`).
   */
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(
        `VirtualProcessingClock.advance requires a finite duration >= 0 (got ${String(ms)})`,
      );
    }
    this.currentMs += ms;
  }
}
