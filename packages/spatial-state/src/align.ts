/**
 * Time alignment for the spatial state stream (W206) — the seam over W103.
 *
 * W201/W203/W204/W205 all emit in FRAME-NATIVE time: `eventTimeMs` is the
 * frame's `presentationMs` on the normalized media timeline. W206 is where
 * that changes: the spatial observation stream is stamped on the canonical
 * SESSION timeline. This module is the single place that mapping happens —
 * a thin, documented seam over W103's delivered clock model (consume only).
 *
 * Determinism: both functions are pure total functions of their arguments —
 * no clock reads, no RNG, no side effects, inputs never mutated.
 */
import { ensureMonotonic, toSessionMs } from "@sporta/timeline";
import type { TrackClock } from "@sporta/timeline";
import type { SpatialStatePoint } from "./state";

/**
 * Maps one video-frame SOURCE timestamp onto the canonical session
 * timeline.
 *
 * `presentationMs` is SOURCE time on the video track's own clock (the W102
 * normalized media timeline); the W103 affine {@link TrackClock} maps it
 * onto the session canonical timeline:
 *
 * ```text
 *   sessionMs = presentationMs + clock.offsetMs
 *             + presentationMs * clock.driftPpm / 1_000_000
 * ```
 *
 * The clock's drift was MEASURED by W103's two-anchor method when the end
 * anchors were available, or fell back to the identity model (offset shift
 * only, `driftPpm: 0`) — either way the clock is W103's delivered object
 * and this function is exactly `toSessionMs` (re-exported semantics, one
 * name, one documented meaning for the spatial stream).
 *
 * Throws W103's `RangeError` on non-finite values or a degenerate
 * (rate <= 0) clock — fail loud, never a silently invented time.
 */
export function alignSessionMs(clock: TrackClock, presentationMs: number): number {
  return toSessionMs(clock, presentationMs);
}

/**
 * Re-stamps a possibly non-monotonic point series onto a monotone session
 * sequence, using W103's `ensureMonotonic` semantics: walking the series in
 * order, a candidate `sessionMs` that REGRESSES below the previous
 * sessionMs is clamped UP to that previous value; anything equal or later
 * passes through unchanged.
 *
 * WHEN THIS IS NEEDED: single-video estimator output is ALREADY monotonic —
 * `presentationMs` arrives in decode order (non-decreasing) and the affine
 * map preserves order (W103 rejects rate <= 0), so `estimateSpatialState`
 * output from one source needs NO re-stamping. The function exists for the
 * caller who fused points from MULTIPLE sources (bounded-reorder stream
 * mapping — the contracts accept out-of-order observations within a
 * bounded window, but a stream's session positions must never regress);
 * the caller logs any clamped regression, this function never emits
 * records (W103 convention).
 *
 * Purity: the INPUT IS NEVER MUTATED — every point is shallow-copied with
 * the (possibly) re-stamped `sessionMs`; points that pass through
 * unchanged are value-deep-equal to their sources. Non-finite `sessionMs`
 * throws a `RangeError` (fail loud).
 */
export function ensureSpatialMonotonic(points: readonly SpatialStatePoint[]): SpatialStatePoint[] {
  const out: SpatialStatePoint[] = [];
  let previous: number | undefined = undefined;
  for (const point of points) {
    if (typeof point.sessionMs !== "number" || !Number.isFinite(point.sessionMs)) {
      throw new RangeError(
        `ensureSpatialMonotonic: sessionMs must be a finite number ` +
          `(got ${String(point.sessionMs)} for trackId "${point.trackId}")`,
      );
    }
    const sessionMs: number =
      previous === undefined ? point.sessionMs : ensureMonotonic(previous, point.sessionMs);
    out.push({ ...point, sessionMs });
    previous = sessionMs;
  }
  return out;
}
