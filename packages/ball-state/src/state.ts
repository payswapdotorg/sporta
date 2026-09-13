/**
 * Ball state estimation (W205).
 *
 * Turns W202's per-frame ball TRACKS (image-space, occlusion-bridged with
 * discounted confidence) into a ball STATE SERIES: position + velocity +
 * confidence with HONEST gap semantics, ready to feed the Sports World Model
 * (architecture-lock §4: explicit uncertainty rather than invented certainty).
 *
 * Unit conventions (documented once, used everywhere):
 *
 * - POSITIONS stay in W202's domain: normalized IMAGE space, derived as the
 *   CENTER of each track point's box (`x + w/2`, `y + h/2` — the same
 *   center-based convention as W202's detection construction). Pitch-frame
 *   projection is W206/W401 territory; this package never touches
 *   homography.
 * - VELOCITIES are image-units per SECOND. Times are milliseconds on the
 *   canonical media timeline, so the centered difference divides the
 *   position delta by the time delta expressed in SECONDS:
 *
 *   ```text
 *   v = (p[i+1] - p[i-1]) / ((t[i+1] - t[i-1]) / 1000)
 *   ```
 *
 * Honesty rules (each is part of the contract the tests pin):
 *
 * 1. VELOCITY is only ever a centered difference over an actual bracketing
 *    pair of points within `maxSpanMs`; at series ends, across a gap jump
 *    wider than `maxSpanMs`, or over a degenerate (zero) time span it is
 *    OMITTED (undefined) — never extrapolated, never zero-filled.
 *    Consecutive interpolated points inside a bridged gap DO get velocities
 *    when the span rule holds (linear interpolation ⇒ near-constant
 *    velocity — an honest consequence of the W202 bridging model, not an
 *    invented one).
 * 2. CONFIDENCE is passthrough VERBATIM per point: detected points keep the
 *    detector's confidence, interpolated points keep W202's exponential
 *    decay (`anchorConfidence * 0.5^ceil(gapElapsed/4)`). Never averaged,
 *    never bumped, never collapsed (architecture-lock §6).
 * 3. SOURCE is passthrough: `"detected"` / `"interpolated"` survives into
 *    the state series, and W202 track fragmentation stays visible in each
 *    point's `trackId` (identity evidence is never silently collapsed).
 *
 * Determinism: no RNG, no clock, no I/O — `estimateBallState` is a pure
 * function of `(tracks, options)`; the same inputs always produce a
 * deep-equal output (docs/testing/HARNESS.md).
 */
import type { BallOcclusionGap, BallTrack, BallTrackPoint } from "@sporta/ball-tracking";

/**
 * The canonical session-scoped ball entity id (tech-lead decision, see the
 * package README): W202 track fragmentation remains visible per point via
 * `trackId`, while the SWM-facing identity of "the ball of this session" is
 * one stable entity.
 */
export const BALL_ENTITY_ID = "ball";

/**
 * The default velocity window factor: `maxSpanMs = 2.5 * (1000 / fps)` —
 * two-and-a-half nominal frame periods.
 */
export const DEFAULT_VELOCITY_SPAN_FACTOR = 2.5;

/**
 * Typed error for invalid estimator OPTIONS (fail loud, the repo
 * convention): bad `fps`, a non-positive `velocity.maxSpanMs`, an unknown
 * `smoothing`, or an `emaAlpha` outside (0, 1) / missing / NaN.
 */
export class BallStateOptionsError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "BallStateOptionsError";
  }
}

/**
 * Typed error for malformed TRACK INPUT (fail loud): track/point/gap shapes
 * that do not satisfy the W202 contract surface, or a track point without a
 * box (a position cannot be derived without one — and must not be invented).
 */
export class BallStateInputError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "BallStateInputError";
  }
}

/** One point of the ball state series (see module docs for conventions). */
export interface BallStatePoint {
  /** Frame id this point belongs to (from the track point). */
  frameId: string;
  /** Presentation position on the canonical media timeline (milliseconds). */
  presentationMs: number;
  /** The W202 track this point came from (fragmentation stays visible). */
  trackId: string;
  /** Image-space position (box center, normalized units). */
  position: { x: number; y: number };
  /** Centered-difference velocity in image-units per SECOND; omitted when
   * the span rule does not hold (see module docs — never zero-filled). */
  velocity?: { vx: number; vy: number };
  /** Passthrough confidence: detected = detector's, interpolated = decayed. */
  confidence: number;
  /** Passthrough source from W202. */
  source: "detected" | "interpolated";
}

/** Options for {@link estimateBallState}. */
export interface BallStateEstimatorOptions {
  /** Nominal frame rate (hertz) driving the velocity window default. */
  fps: number;
  /**
   * Velocity window: a centered difference is only taken when
   * `t[i+1] - t[i-1] <= maxSpanMs`. Default `2.5 * (1000 / fps)`.
   */
  velocity?: { maxSpanMs?: number };
  /** Position smoothing: `"none"` (default, pure passthrough) or `"ema"`. */
  smoothing?: "none" | "ema";
  /**
   * EMA alpha in (0, 1), REQUIRED when `smoothing === "ema"`; ignored when
   * `smoothing === "none"` (any value, including invalid ones).
   */
  emaAlpha?: number;
}

/** The estimated ball state series (see module docs for conventions). */
export interface BallStateSeries {
  /** Always {@link BALL_ENTITY_ID} — the canonical session ball entity. */
  entityId: "ball";
  /** State points ordered by `presentationMs` ascending (tie-break below). */
  points: BallStatePoint[];
  /**
   * Union of all tracks' occlusion gaps (sorted by `fromMs`; overlapping or
   * touching gaps merged — see the merge rule in the module docs).
   */
  gaps: Array<{ fromMs: number; toMs: number; bridged: boolean }>;
}

// ---------------------------------------------------------------------------
// Validation (fail loud; media and model outputs are untrusted inputs —
// architecture-lock §13)
// ---------------------------------------------------------------------------

function assertFinite(value: unknown, what: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BallStateInputError(
      `ball state: ${what} must be a finite number (got ${String(value)})`,
    );
  }
}

/** Validates estimator options; throws {@link BallStateOptionsError}. */
function validateOptions(options: BallStateEstimatorOptions): void {
  if (options === null || typeof options !== "object") {
    throw new BallStateOptionsError("ball state: options must be an object");
  }
  if (typeof options.fps !== "number" || !Number.isFinite(options.fps) || options.fps <= 0) {
    throw new BallStateOptionsError(
      `ball state: fps must be a finite number > 0 (got ${String(options.fps)})`,
    );
  }
  if (options.velocity !== undefined) {
    if (options.velocity === null || typeof options.velocity !== "object") {
      throw new BallStateOptionsError("ball state: velocity must be an object when provided");
    }
    const span = options.velocity.maxSpanMs;
    if (span !== undefined) {
      if (typeof span !== "number" || !Number.isFinite(span) || span <= 0) {
        throw new BallStateOptionsError(
          `ball state: velocity.maxSpanMs must be a finite number > 0 (got ${String(span)})`,
        );
      }
    }
  }
  const smoothing = options.smoothing ?? "none";
  if (smoothing !== "none" && smoothing !== "ema") {
    throw new BallStateOptionsError(
      `ball state: smoothing must be "none" or "ema" (got ${String(smoothing)})`,
    );
  }
  if (smoothing === "ema") {
    const alpha = options.emaAlpha;
    // `!(alpha > 0 && alpha < 1)` also rejects NaN and missing values.
    if (typeof alpha !== "number" || !(alpha > 0 && alpha < 1)) {
      throw new BallStateOptionsError(
        `ball state: emaAlpha is required when smoothing is "ema" and must be in (0, 1) ` +
          `(got ${String(alpha)})`,
      );
    }
  }
}

/** Validates one track point; throws {@link BallStateInputError}. */
function validatePoint(point: BallTrackPoint, trackId: string): void {
  if (point === null || typeof point !== "object") {
    throw new BallStateInputError(`ball state: track "${trackId}" has a non-object point`);
  }
  if (typeof point.frameId !== "string" || point.frameId.length < 1) {
    throw new BallStateInputError(
      `ball state: every track point needs a non-empty frameId (track "${trackId}")`,
    );
  }
  assertFinite(
    point.presentationMs,
    `presentationMs (track "${trackId}", frame "${point.frameId}")`,
  );
  if (point.presentationMs < 0) {
    throw new BallStateInputError(
      `ball state: presentationMs must be >= 0 (got ${point.presentationMs}, ` +
        `track "${trackId}", frame "${point.frameId}")`,
    );
  }
  if (point.source !== "detected" && point.source !== "interpolated") {
    throw new BallStateInputError(
      `ball state: source must be "detected" or "interpolated" ` +
        `(got ${String(point.source)}, track "${trackId}", frame "${point.frameId}")`,
    );
  }
  assertFinite(point.confidence, `confidence (track "${trackId}", frame "${point.frameId}")`);
  if (point.confidence < 0 || point.confidence > 1) {
    throw new BallStateInputError(
      `ball state: confidence must be in [0, 1] (got ${point.confidence}, ` +
        `track "${trackId}", frame "${point.frameId}")`,
    );
  }
  if (point.box === undefined) {
    // A position cannot be derived without a box — and must not be invented.
    throw new BallStateInputError(
      `ball state: track point without a box cannot yield a position ` +
        `(track "${trackId}", frame "${point.frameId}") — positions are never invented`,
    );
  }
  const box = point.box;
  for (const field of [box.x, box.y, box.w, box.h] as const) {
    assertFinite(field, `box field (track "${trackId}", frame "${point.frameId}")`);
    if (field < 0 || field > 1) {
      throw new BallStateInputError(
        `ball state: box fields must be in [0, 1] (got ${field}, ` +
          `track "${trackId}", frame "${point.frameId}")`,
      );
    }
  }
}

/** Validates one occlusion gap record; throws {@link BallStateInputError}. */
function validateGap(gap: BallOcclusionGap, trackId: string): void {
  if (gap === null || typeof gap !== "object") {
    throw new BallStateInputError(`ball state: track "${trackId}" has a non-object occlusion gap`);
  }
  assertFinite(gap.fromMs, `gap.fromMs (track "${trackId}")`);
  assertFinite(gap.toMs, `gap.toMs (track "${trackId}")`);
  if (gap.fromMs < 0 || gap.toMs < 0) {
    throw new BallStateInputError(
      `ball state: gap boundaries must be >= 0 (got [${gap.fromMs}, ${gap.toMs}], ` +
        `track "${trackId}")`,
    );
  }
  if (gap.toMs < gap.fromMs) {
    throw new BallStateInputError(
      `ball state: gap.toMs (${gap.toMs}) must be >= gap.fromMs (${gap.fromMs}, ` +
        `track "${trackId}")`,
    );
  }
  if (typeof gap.bridged !== "boolean") {
    throw new BallStateInputError(
      `ball state: gap.bridged must be a boolean (got ${String(gap.bridged)}, ` +
        `track "${trackId}")`,
    );
  }
}

/** Validates the track input surface; throws {@link BallStateInputError}. */
function validateTracks(tracks: readonly BallTrack[]): void {
  if (!Array.isArray(tracks)) {
    throw new BallStateInputError("ball state: tracks must be an array");
  }
  for (const track of tracks) {
    if (track === null || typeof track !== "object") {
      throw new BallStateInputError("ball state: every track must be an object");
    }
    if (typeof track.trackId !== "string" || track.trackId.length < 1) {
      throw new BallStateInputError("ball state: every track needs a non-empty trackId");
    }
    if (!Array.isArray(track.points)) {
      throw new BallStateInputError(`ball state: track "${track.trackId}" points must be an array`);
    }
    if (!Array.isArray(track.occlusionGaps)) {
      throw new BallStateInputError(
        `ball state: track "${track.trackId}" occlusionGaps must be an array`,
      );
    }
    for (const point of track.points) {
      validatePoint(point, track.trackId);
    }
    for (const gap of track.occlusionGaps) {
      validateGap(gap, track.trackId);
    }
    // Per-track point ORDER is not required: the merge sorts by
    // presentationMs (W202 tracks arrive ordered, but the merge must stay
    // well-defined regardless).
  }
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

/**
 * Merge rule for the gap union (documented, deterministic):
 *
 * 1. Collect every track's `occlusionGaps`.
 * 2. Sort by `fromMs` ascending, ties broken by `toMs` ascending, then
 *    `bridged: false` before `bridged: true`.
 * 3. Scan the sorted list; a gap MERGES into the current window when
 *    `gap.fromMs <= window.toMs` (overlapping OR touching — they share the
 *    boundary instant), extending the window to
 *    `max(window.toMs, gap.toMs)`.
 * 4. The merged window's `bridged` is the CONJUNCTION of its constituents:
 *    a merged window claims `bridged: true` only when EVERY constituent gap
 *    was bridged — one unbridged constituent means part of the union window
 *    lacks interpolation coverage, and the merged record must not overstate
 *    coverage (honest union).
 */
function mergeGaps(gaps: readonly BallOcclusionGap[]): Array<{
  fromMs: number;
  toMs: number;
  bridged: boolean;
}> {
  const sorted = [...gaps].sort((a, b) => {
    if (a.fromMs !== b.fromMs) return a.fromMs - b.fromMs;
    if (a.toMs !== b.toMs) return a.toMs - b.toMs;
    if (a.bridged !== b.bridged) return a.bridged ? 1 : -1;
    return 0;
  });

  const merged: Array<{ fromMs: number; toMs: number; bridged: boolean }> = [];
  for (const gap of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && gap.fromMs <= last.toMs) {
      last.toMs = Math.max(last.toMs, gap.toMs);
      last.bridged = last.bridged && gap.bridged;
    } else {
      merged.push({ fromMs: gap.fromMs, toMs: gap.toMs, bridged: gap.bridged });
    }
  }
  return merged;
}

/**
 * Exponential moving average over the merged point positions (per
 * coordinate), documented exactly:
 *
 * ```text
 * EMA_0 = p_0                     (seed: the first point)
 * EMA_k = alpha * p_k + (1 - alpha) * EMA_{k-1}
 * ```
 *
 * The EMA runs over the merged series in presentation order — it is NOT
 * reset at gap boundaries (a deliberate, documented simplification; the
 * point-level honesty fields — `source` and `confidence` — still disclose
 * what is observed vs inferred, so no certainty is invented).
 */
function emaSmooth(
  positions: ReadonlyArray<{ x: number; y: number }>,
  alpha: number,
): Array<{ x: number; y: number }> {
  const smoothed: Array<{ x: number; y: number }> = [];
  let previous: { x: number; y: number } | undefined;
  for (const position of positions) {
    const next =
      previous === undefined
        ? { x: position.x, y: position.y }
        : {
            x: alpha * position.x + (1 - alpha) * previous.x,
            y: alpha * position.y + (1 - alpha) * previous.y,
          };
    smoothed.push(next);
    previous = next;
  }
  return smoothed;
}

// ---------------------------------------------------------------------------
// Estimator
// ---------------------------------------------------------------------------

/**
 * Estimates the ball state series from W202 tracks.
 *
 * Merge rule for points (documented, deterministic): all tracks' points are
 * merged into ONE series ordered by `presentationMs` ascending, with the
 * tie-break `frameId` (lexicographic ascending) then `trackId` (lexicographic
 * ascending). W202 tracks are disjoint in time, so ties do not occur in
 * pipeline data — but the merge stays well-defined for any input.
 *
 * Velocity rule (deterministic, honest): for merged point index `i`,
 * velocity is defined IFF both `points[i-1]` and `points[i+1]` exist AND
 * `0 < t[i+1] - t[i-1] <= maxSpanMs` (default `2.5 * 1000 / fps`); then the
 * centered difference above is applied to the (optionally smoothed)
 * positions. At series ends, across a gap jump wider than `maxSpanMs`, or on
 * a degenerate zero span, velocity is OMITTED — never extrapolated, never
 * zero-filled. When `smoothing: "ema"`, the SAME centered rule is applied to
 * the EMA-smoothed positions; `confidence` and `source` remain verbatim
 * either way.
 */
export function estimateBallState(
  tracks: readonly BallTrack[],
  options: BallStateEstimatorOptions,
): BallStateSeries {
  validateOptions(options);
  validateTracks(tracks);

  // 1. Merge all points, carrying each point's trackId (fragmentation stays
  //    visible in the state series).
  const merged: Array<{ point: BallTrackPoint; trackId: string }> = [];
  for (const track of tracks) {
    for (const point of track.points) {
      merged.push({ point, trackId: track.trackId });
    }
  }
  merged.sort((a, b) => {
    if (a.point.presentationMs !== b.point.presentationMs) {
      return a.point.presentationMs - b.point.presentationMs;
    }
    if (a.point.frameId !== b.point.frameId) {
      return a.point.frameId < b.point.frameId ? -1 : 1;
    }
    if (a.trackId !== b.trackId) {
      return a.trackId < b.trackId ? -1 : 1;
    }
    return 0;
  });

  // 2. Positions: box centers (image space; the center-based convention
  //    matching W202's detection construction).
  const positions = merged.map(({ point }) => {
    const box = point.box;
    if (box === undefined) {
      // Unreachable: validatePoints rejected box-less points.
      throw new BallStateInputError(
        `ball state: track point without a box cannot yield a position (frame "${point.frameId}")`,
      );
    }
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  });

  // 3. Optional EMA smoothing of POSITION only (velocity is then computed on
  //    the smoothed positions by the same centered rule). After
  //    validateOptions, smoothing "ema" implies a validated alpha.
  const smoothing = options.smoothing ?? "none";
  const emaAlpha = smoothing === "ema" ? options.emaAlpha : undefined;
  const effectivePositions = emaAlpha !== undefined ? emaSmooth(positions, emaAlpha) : positions;

  // 4. Gap union (see mergeGaps for the documented rule; it copies, so the
  //    input gap records are never aliased into the output).
  const allGaps: BallOcclusionGap[] = [];
  for (const track of tracks) {
    for (const gap of track.occlusionGaps) {
      allGaps.push(gap);
    }
  }
  const gaps = mergeGaps(allGaps);

  // 5. Centered-difference velocity over the effective positions. A plain
  //    index loop keeps every access guarded (noUncheckedIndexedAccess);
  //    effectivePositions always has exactly merged.length entries.
  const maxSpanMs =
    options.velocity?.maxSpanMs ?? DEFAULT_VELOCITY_SPAN_FACTOR * (1000 / options.fps);

  const points: BallStatePoint[] = [];
  for (let index = 0; index < merged.length; index += 1) {
    const { point, trackId } = merged[index] as { point: BallTrackPoint; trackId: string };
    const position = effectivePositions[index] as { x: number; y: number };
    const statePoint: BallStatePoint = {
      frameId: point.frameId,
      presentationMs: point.presentationMs,
      trackId,
      position,
      confidence: point.confidence,
      source: point.source,
    };

    const before = merged[index - 1];
    const after = merged[index + 1];
    if (before !== undefined && after !== undefined) {
      const spanMs = after.point.presentationMs - before.point.presentationMs;
      if (spanMs > 0 && spanMs <= maxSpanMs) {
        const spanSeconds = spanMs / 1000;
        const pBefore = effectivePositions[index - 1] as { x: number; y: number };
        const pAfter = effectivePositions[index + 1] as { x: number; y: number };
        statePoint.velocity = {
          vx: (pAfter.x - pBefore.x) / spanSeconds,
          vy: (pAfter.y - pBefore.y) / spanSeconds,
        };
      }
    }
    points.push(statePoint);
  }

  return { entityId: BALL_ENTITY_ID, points, gaps };
}
