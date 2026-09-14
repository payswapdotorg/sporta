/**
 * The GPU worker protocol clock seam (W303).
 *
 * Every timing decision in the protocol is injectable: heartbeat periods,
 * lease expiry, staleness thresholds, job deadlines, retry backoff, latency
 * measurement (docs/testing/HARNESS.md — no wall-clock reads anywhere in
 * this package; architecture-lock §12 latency measurement without
 * `Date.now`). The dispatcher and the worker-side agents all read the SAME
 * injected clock instance, so lease/staleness/deadline arithmetic is exact.
 *
 * {@link GpuClock} deliberately exposes TWO waiting primitives, because the
 * protocol has two honest kinds of waiting:
 *
 * - `sleep(durationMs)` — the caller CONSUMES clock time (the W104/W302
 *   `RetryClock.sleep` semantics, where backoff sleeps advanced virtual time
 *   at registration). Executors model work duration with it; the worker's
 *   retry backoff sleeps through it. It advances the virtual clock by
 *   `durationMs` immediately, stepping through every pending
 *   `waitUntil` deadline it crosses (those waiters resolve, in deadline
 *   order, BEFORE the sleeper resumes) — so periodic emitters (heartbeats)
 *   keep firing while work consumes time.
 * - `waitUntil(untilMs)` — the caller WAITS passively for a future moment:
 *   the waiter parks and resolves only when some LATER `sleep`/`advance`
 *   crosses its deadline. Periodic emitters (the worker heartbeat loop) use
 *   it, so an idle protocol consumes no time and a parked loop never spins
 *   the microtask queue.
 *
 * THE RUNAWAY RULE (constitution-relevant): `sleep` self-advances, so an
 * UNBOUNDED loop of `sleep` calls would keep the microtask queue forever
 * non-empty and hang the process. This package contains no such loop —
 * periodic waits always go through `waitUntil`, and `sleep` is reserved for
 * bounded consumption (work duration, backoff). A real deployment's wall
 * clock implements both primitives with real waiting; the semantics
 * coincide.
 *
 * `VirtualGpuClock` is the deterministic implementation used by tests and
 * in-process fixtures. Virtual time moves ONLY when someone consumes it
 * (`sleep`) or a fixture advances it explicitly (`advance`/`advanceTo`);
 * passive `waitUntil` waiters fire, in deadline order, when a later
 * advance crosses them. Big jumps fire each crossed waiter exactly once
 * (the waiter's continuation re-registers from the post-jump present), so
 * heartbeat emission is one-per-crossed-deadline — a documented
 * discretization: timestamps read the clock at emission, and with stepwise
 * advances (the test convention) they are exact interval multiples.
 */

/**
 * The clock every gpu-worker component is injected with.
 *
 * - `now()` — current protocol-clock reading in milliseconds;
 * - `sleep(durationMs)` — consumes `durationMs` of clock time (resolves
 *   after advancing the clock by the duration);
 * - `waitUntil(untilMs)` — resolves once the clock reaches `untilMs`
 *   (immediately if already past).
 */
export interface GpuClock {
  /** Current protocol-clock reading (milliseconds). */
  now(): number;
  /** Consumes `durationMs` of clock time (work duration, retry backoff). */
  sleep(durationMs: number): Promise<void>;
  /** Resolves when the clock reaches `untilMs` (periodic waits). */
  waitUntil(untilMs: number): Promise<void>;
}

/** One parked `waitUntil` waiter. */
interface ClockWaiter {
  untilMs: number;
  /** Registration ordinal — same-deadline waiters resolve FIFO. */
  ordinal: number;
  resolve: () => void;
}

/**
 * The deterministic virtual protocol clock. Time advances only through
 * `sleep`/`advance`/`advanceTo`; `waitUntil` waiters park until a later
 * advance crosses their deadline. No real timers, no wall-clock reads.
 */
export class VirtualGpuClock implements GpuClock {
  private currentMs: number;
  private readonly waiters: ClockWaiter[] = [];
  private nextOrdinal = 0;

  constructor(startMs: number = 0) {
    if (!Number.isFinite(startMs)) {
      throw new RangeError(`VirtualGpuClock start time must be finite (got ${String(startMs)})`);
    }
    this.currentMs = startMs;
  }

  /** Current virtual time (never advances without a sleep/advance). */
  now(): number {
    return this.currentMs;
  }

  sleep(durationMs: number): Promise<void> {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return Promise.reject(
        new RangeError(
          `VirtualGpuClock.sleep requires a finite duration >= 0 (got ${String(durationMs)})`,
        ),
      );
    }
    this.advanceTo(this.currentMs + durationMs);
    return Promise.resolve();
  }

  waitUntil(untilMs: number): Promise<void> {
    if (!Number.isFinite(untilMs)) {
      return Promise.reject(
        new RangeError(
          `VirtualGpuClock.waitUntil requires a finite deadline (got ${String(untilMs)})`,
        ),
      );
    }
    if (untilMs <= this.currentMs) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push({ untilMs, ordinal: this.nextOrdinal, resolve });
      this.nextOrdinal += 1;
    });
  }

  /**
   * Advances virtual time by `ms` explicitly (fixture/test tool; the same
   * fail-loud validation as `sleep`).
   */
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(
        `VirtualGpuClock.advance requires a finite duration >= 0 (got ${String(ms)})`,
      );
    }
    this.advanceTo(this.currentMs + ms);
  }

  /**
   * Moves virtual time to the absolute reading `untilMs`. Every parked
   * waiter with a deadline at or before `untilMs` resolves, in deadline
   * order (same-deadline waiters in registration order); time only ever
   * moves forward (a backwards move is a loud `RangeError`).
   */
  advanceTo(untilMs: number): void {
    if (!Number.isFinite(untilMs)) {
      throw new RangeError(
        `VirtualGpuClock.advanceTo requires a finite target (got ${String(untilMs)})`,
      );
    }
    if (untilMs < this.currentMs) {
      throw new RangeError(
        `VirtualGpuClock.advanceTo cannot move time backwards ` +
          `(${String(untilMs)} < ${String(this.currentMs)})`,
      );
    }
    // Fire every crossed waiter in (deadline, registration) order.
    const crossed = this.waiters
      .filter((waiter) => waiter.untilMs <= untilMs)
      .sort((a, b) => (a.untilMs === b.untilMs ? a.ordinal - b.ordinal : a.untilMs - b.untilMs));
    if (crossed.length > 0) {
      const remaining = this.waiters.filter((waiter) => waiter.untilMs > untilMs);
      this.waiters.length = 0;
      for (const waiter of remaining) this.waiters.push(waiter);
      // Step the clock through each crossed deadline (the resolved
      // continuations observe the post-advance present — documented
      // discretization; ordering of resolution is the deadline order).
      for (const waiter of crossed) {
        if (waiter.untilMs > this.currentMs) this.currentMs = waiter.untilMs;
        waiter.resolve();
      }
    }
    if (untilMs > this.currentMs) this.currentMs = untilMs;
  }

  /** Count of parked `waitUntil` waiters (test observability). */
  get pendingWaiters(): number {
    return this.waiters.length;
  }
}
