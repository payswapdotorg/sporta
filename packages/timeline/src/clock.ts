/**
 * Per-track affine clock model (W103 §3.1).
 *
 * A {@link TrackClock} is the affine map from ONE track's source timestamps
 * (the W102 normalized output: `presentationMs` for video frames, `startMs`
 * for audio chunks) onto the canonical session timeline:
 *
 * ```text
 * sessionMs = sourceMs + offsetMs + sourceMs * driftPpm / 1_000_000
 * ```
 *
 * The model is affine in the source position: a constant `offsetMs` (where
 * the track's clock sits relative to the session timeline) plus a
 * proportional drift term (how much faster or slower the track's clock runs,
 * in parts per million of the source position). All math is pure: no clock
 * reads, no state, no side effects — every function is a total function of
 * its arguments, so the same inputs always produce the same outputs
 * (docs/testing/HARNESS.md determinism).
 *
 * Sign conventions (tested in `test/clock.test.ts`):
 *
 * - `offsetMs` is ADDED: a positive offset moves the track's content LATER
 *   on the session timeline, a negative offset moves it earlier;
 * - `driftPpm` is the RATE of the map minus 1, in ppm: positive means the
 *   session position grows faster than the source position (each source
 *   millisecond spans more than one session millisecond), negative means it
 *   grows slower;
 * - `toSourceMs` is the EXACT algebraic inverse (see below).
 */

/** The affine clock of one track: source timestamps -> session timeline. */
export interface TrackClock {
  /** Stable track id this clock maps (`TrackInfo.trackId`). */
  trackId: string;
  /** Constant term of the affine map, in session milliseconds. */
  offsetMs: number;
  /** Proportional term of the affine map, in parts per million. */
  driftPpm: number;
}

/**
 * The drift rate at which the affine map degenerates: `driftPpm === -1_000_000`
 * makes the session rate exactly zero (the map collapses to the constant
 * `offsetMs`), and anything below makes it negative (session time runs
 * backwards). Both are non-invertible or nonsensical clocks, so both map and
 * inverse reject them with a `RangeError`.
 */
export const MIN_DRIFT_PPM = -1_000_000;

/** Guard: rejects non-finite numbers and degenerate clocks, fail-loud. */
function assertClockArgs(clock: TrackClock, ms: number, operation: string): void {
  if (typeof clock.offsetMs !== "number" || !Number.isFinite(clock.offsetMs)) {
    throw new RangeError(
      `${operation} requires a finite clock.offsetMs (got ${String(clock.offsetMs)})`,
    );
  }
  if (typeof clock.driftPpm !== "number" || !Number.isFinite(clock.driftPpm)) {
    throw new RangeError(
      `${operation} requires a finite clock.driftPpm (got ${String(clock.driftPpm)})`,
    );
  }
  if (clock.driftPpm <= MIN_DRIFT_PPM) {
    throw new RangeError(
      `${operation} requires clock.driftPpm > ${MIN_DRIFT_PPM} ` +
        `(got ${String(clock.driftPpm)}: a clock whose session rate is zero or negative ` +
        `cannot map or be inverted)`,
    );
  }
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    throw new RangeError(`${operation} requires a finite millisecond value (got ${String(ms)})`);
  }
}

/**
 * Maps one source timestamp of the clock's track onto the canonical session
 * timeline:
 *
 * ```text
 * sessionMs = sourceMs + clock.offsetMs + sourceMs * clock.driftPpm / 1_000_000
 * ```
 */
export function toSessionMs(clock: TrackClock, sourceMs: number): number {
  assertClockArgs(clock, sourceMs, "toSessionMs");
  return sourceMs + clock.offsetMs + (sourceMs * clock.driftPpm) / 1_000_000;
}

/**
 * The EXACT inverse of {@link toSessionMs}: recovers the source timestamp
 * that maps to `sessionMs`.
 *
 * Algebra: with `o = clock.offsetMs` and `d = clock.driftPpm / 1_000_000`,
 * the forward map is `s = x * (1 + d) + o`. Solving for `x`:
 *
 * ```text
 * x = (s - o) / (1 + d)
 * ```
 *
 * `1 + d` is strictly positive (enforced by {@link MIN_DRIFT_PPM}), so the
 * division is always safe. In IEEE-754 double arithmetic the round trip
 * `toSourceMs(toSessionMs(x))` reproduces `x` to well within 1e-9 for
 * broadcast-scale positions (tested).
 */
export function toSourceMs(clock: TrackClock, sessionMs: number): number {
  assertClockArgs(clock, sessionMs, "toSourceMs");
  const rate = 1 + clock.driftPpm / 1_000_000;
  return (sessionMs - clock.offsetMs) / rate;
}

/**
 * The identity clock for a track: zero offset, zero drift — source
 * timestamps ARE session timestamps. Useful as a neutral default and as the
 * baseline in clock-math tests.
 */
export function identityClock(trackId: string): TrackClock {
  if (typeof trackId !== "string" || trackId.length < 1) {
    throw new RangeError(`identityClock requires a non-empty trackId (got ${String(trackId)})`);
  }
  return { trackId, offsetMs: 0, driftPpm: 0 };
}
