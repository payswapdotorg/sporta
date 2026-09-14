/**
 * Time alignment for spatial state (W206) — a thin, documented seam over W103.
 *
 * W103 owns the clock model; W206 owns the fusion. This module keeps the two
 * concerns honest by NAMING the mapping instead of inlining it:
 *
 * - {@link alignSessionMs} maps one presentation timestamp onto the session
 *   timeline via the W103 affine `TrackClock`;
 * - {@link ensureSpatialMonotonic} re-stamps a non-monotonic point series
 *   using W103's `ensureMonotonic` semantics.
 *
 * `estimateSpatialState` already applies the clock to every frame it fuses;
 * these helpers exist for callers that need the SAME mapping on the side
 * (pre-checking a timestamp, repairing a multi-source series after the fact).
 */
import { ensureMonotonic, toSessionMs } from "@sporta/timeline";
import type { TrackClock } from "@sporta/timeline";
import type { SpatialStatePoint } from "./state";

/**
 * Maps one presentation timestamp onto the canonical session timeline.
 *
 * `presentationMs` is SOURCE time on the video track's OWN clock (the W102
 * normalized media timeline); the W103 affine model
 * `sessionMs = sourceMs + offsetMs + sourceMs * driftPpm / 1_000_000` maps it
 * onto the session canonical timeline — with the drift MEASURED by W103's
 * two-anchor method where possible, or the identity fallback (offset 0, drift
 * 0) when it was not. This function is a pure wrapper over W103's
 * `toSessionMs` (which validates the clock and the timestamp, fail-loud) —
 * W206 never re-implements clock math.
 */
export function alignSessionMs(clock: TrackClock, presentationMs: number): number {
  return toSessionMs(clock, presentationMs);
}

/**
 * Re-stamps a point series so its `sessionMs` never regresses, using W103's
 * `ensureMonotonic` semantics: walking the points in INPUT ARRAY order, the
 * first point is emitted verbatim (nothing precedes it) and every subsequent
 * point keeps its `sessionMs` when it does not regress (`>=` the running
 * maximum) or is CLAMPED UP to the running maximum when it does.
 *
 * WHEN this matters (documented): a SINGLE-VIDEO series is already monotonic
 * — decode-order presentation timestamps are strictly increasing and the
 * affine map has a positive rate, so `estimateSpatialState` output needs no
 * repair. A series fused from MULTIPLE sources (or hand-built/concatenated
 * without re-sorting) can regress; this function re-stamps it the W103 way
 * (bounded-reorder stream mapping — the caller logs the clamped regressions;
 * this pure function never emits records).
 *
 * Pure: the input array and its points are never mutated — the returned
 * points are fresh copies (only `sessionMs` can change; every other field is
 * carried through untouched).
 */
export function ensureSpatialMonotonic(points: readonly SpatialStatePoint[]): SpatialStatePoint[] {
  if (!Array.isArray(points)) {
    throw new RangeError("spatial state: ensureSpatialMonotonic requires an array of points");
  }
  const restamped: SpatialStatePoint[] = [];
  let previous: number | undefined;
  for (const [index, point] of points.entries()) {
    if (point === null || typeof point !== "object") {
      throw new RangeError(
        `spatial state: ensureSpatialMonotonic points[${index}] is not an object`,
      );
    }
    if (typeof point.sessionMs !== "number" || !Number.isFinite(point.sessionMs)) {
      throw new RangeError(
        `spatial state: ensureSpatialMonotonic points[${index}].sessionMs must be finite ` +
          `(got ${String(point.sessionMs)})`,
      );
    }
    const sessionMs =
      previous === undefined ? point.sessionMs : ensureMonotonic(previous, point.sessionMs);
    restamped.push({ ...point, sessionMs });
    previous = sessionMs;
  }
  return restamped;
}
