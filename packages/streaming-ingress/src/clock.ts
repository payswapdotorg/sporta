/**
 * The live arrival clock seam (W301).
 *
 * A live source delivers segments over TIME: the fixture feed's schedule
 * expresses arrivals in injected-clock milliseconds (docs/testing/HARNESS.md —
 * no wall-clock reads anywhere), and the ingest service measures each
 * segment's arrival with the same clock. One {@link LiveClock} instance is
 * shared by the fixture source (which WAITS on it) and the service (which
 * READS it), so arrival measurements equal the authored schedule times
 * exactly — the determinism contract of this package.
 *
 * `VirtualClock` is the deterministic implementation: virtual time advances
 * ONLY when a `wait()` registers a future deadline — never spontaneously,
 * never during microtask-only work (backpressure waiting advances no virtual
 * time; that is documented honestly rather than faked). Real-protocol
 * adapters arriving in later work items inject their own clock (e.g. one
 * backed by the real `Date.now`/`setTimeout`); nothing in this package
 * assumes wall time.
 */

/**
 * The clock every live-input component is injected with.
 *
 * - `now()` — current arrival-clock time in milliseconds;
 * - `wait(untilMs)` — resolves once the clock reaches `untilMs` (a no-op when
 *   that time is already in the past).
 */
export interface LiveClock {
  /** Current arrival-clock reading (milliseconds). */
  now(): number;
  /** Resolves when the clock reaches `untilMs` (immediately if already past). */
  wait(untilMs: number): Promise<void>;
}

/**
 * The deterministic virtual arrival clock.
 *
 * Time advances to the earliest pending `wait` deadline the moment that wait
 * is registered (synchronously inside `wait`), and never goes backwards. A
 * `wait` scheduled for a time at or before the current reading resolves
 * immediately without advancing anything. Because usage in this package is
 * strictly serial (one live source consumed by one pump), at most one wait is
 * pending at a time; if several are registered in one turn, each advances the
 * clock to its own deadline in registration-then-time order within a single
 * synchronous pump pass.
 */
export class VirtualClock implements LiveClock {
  private currentMs: number;
  private readonly waiters: Array<{ untilMs: number; resolve: () => void }> = [];
  private pumping = false;

  constructor(startMs: number = 0) {
    if (!Number.isFinite(startMs)) {
      throw new RangeError(`VirtualClock start time must be finite (got ${String(startMs)})`);
    }
    this.currentMs = startMs;
  }

  /** Current virtual time (never advances without a registered wait). */
  now(): number {
    return this.currentMs;
  }

  wait(untilMs: number): Promise<void> {
    if (!Number.isFinite(untilMs)) {
      return Promise.reject(
        new RangeError(`VirtualClock.wait requires a finite deadline (got ${String(untilMs)})`),
      );
    }
    if (untilMs <= this.currentMs) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push({ untilMs, resolve });
      this.schedulePump();
    });
  }

  /**
   * Runs the pump once (synchronously): advances the clock to the earliest
   * pending deadline and resolves every waiter at or before the new reading.
   * Runs again automatically when a new wait registers later.
   */
  private schedulePump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        if (this.waiters.length === 0) return;
        let earliest = Infinity;
        for (const waiter of this.waiters) {
          if (waiter.untilMs < earliest) earliest = waiter.untilMs;
        }
        if (earliest > this.currentMs) this.currentMs = earliest;
        for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
          const waiter = this.waiters[i];
          if (waiter === undefined) continue;
          if (waiter.untilMs <= this.currentMs) {
            this.waiters.splice(i, 1);
            waiter.resolve();
          }
        }
      }
    } finally {
      this.pumping = false;
    }
  }
}
