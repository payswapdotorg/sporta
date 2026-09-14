/**
 * Geometry drift metrics over a W502 clip manifest (W503, deliverable 1b).
 *
 * **What is measured:** per entity, the sequence of TRUE pitch positions the
 * manifest records verbatim (`positionMeters` — never the 2-decimal
 * `svgPosition` serialization). For every pair of CONSECUTIVE RECORDED
 * positions (frame i → next recorded frame j) the displacement is
 *
 * ```
 * d = hypot(xj − xi, yj − yi)          (meters)
 * Δt = outputTimestampMs[j] − outputTimestampMs[i]   (milliseconds)
 * bound = maxSpeed(kind) × (Δt / 1000) + POSITION_EPSILON_METERS
 * ```
 *
 * and `d > bound` is a JUMP (geometry drift): the entity covered a distance
 * no entity of its kind could cover in that time.
 *
 * **The bound derivation (THRESHOLDS.md §3 is the authority):**
 *
 * - `PLAYER_MAX_SPEED_MPS = 12.5` — the peak human sprint. The fastest
 *   verified 100 m sprint average is 10.44 m/s (Bolt, Berlin 2009) with a
 *   peak split around 12.4 m/s; no footballer has ever been timed faster.
 *   A participant whose AVERAGE speed over an interval exceeds 12.5 m/s is
 *   physically impossible, not merely unusual.
 * - `BALL_MAX_SPEED_MPS = 40` — reliably measured match shots peak around
 *   130-140 km/h (36.1-38.9 m/s). 40 m/s (144 km/h) covers every
 *   reliably-measured struck-ball speed with headroom. (Disputed
 *   extreme-speed claims exist above this; they are not reliably measured
 *   and are documented as an accepted limitation.)
 * - `POSITION_EPSILON_METERS = 0.01` — numerical-safety headroom, not a
 *   semantic tolerance: it absorbs double rounding in the position
 *   pipeline (the renderer's own serialization rounds canvas coordinates to
 *   2 decimals = 1 cm; the true meters are verbatim). It is 3 orders of
 *   magnitude below any plausible motion and can never mask a real jump.
 *
 * **Honest gaps, never interpolation:** a frame without a recorded position
 * (justified omission: `omitted-no-position`,
 * `omitted-invalid-position` — or an entity absent from the frame) BREAKS
 * the series. The next recorded position is compared over the FULL elapsed
 * time with the bound scaled to that full time (endpoint measurement, no
 * invented intermediate position); the pair is flagged `spansGap: true` and
 * the missing frames are counted as `gapFrameCount`. Nothing is ever
 * interpolated across a gap.
 *
 * Pure functions: no clock, no RNG, no I/O; deep-equal reruns.
 */
import type { AnimeClipManifest } from "@sporta/renderer-anime";
import { THRESHOLDS } from "./thresholds";
import { validateManifest } from "./validate";

/** One measured consecutive-position step. */
export interface GeometryStep {
  fromFrameIndex: number;
  toFrameIndex: number;
  /** Elapsed output time between the two frames (milliseconds, > 0). */
  dtMs: number;
  fromMeters: { x: number; y: number };
  toMeters: { x: number; y: number };
  /** Euclidean displacement in meters. */
  displacementMeters: number;
  /** The plausibility bound for this pair (meters). */
  boundMeters: number;
  /** displacement / bound (> 1 exceeds the bound). */
  jumpRatio: number;
  exceedsBound: boolean;
  /** True when at least one frame between from and to lacks a recorded position. */
  spansGap: boolean;
}

/** Per-entity geometry series. */
export interface GeometryEntitySeries {
  entityId: string;
  kind: string;
  /** The bound parameters applied to this entity (echoed evidence). */
  bound: { maxSpeedMps: number; epsilonMeters: number };
  /** Frames carrying a recorded position. */
  measuredFrameCount: number;
  /** Frames between the first and last recorded position WITHOUT one (gaps). */
  gapFrameCount: number;
  /** Measured steps spanning at least one gap frame. */
  gapSpanCount: number;
  jumpCount: number;
  maxDisplacementMeters: number;
  /** Max displacement among this entity's JUMP steps (0 when it has none). */
  maxJumpMeters: number;
  maxJumpRatio: number;
  series: GeometryStep[];
}

/** The geometry drift metrics of one manifest. */
export interface GeometryDriftMetrics {
  frameCount: number;
  /** The drift bound parameters (echoed evidence). */
  playerMaxSpeedMps: number;
  ballMaxSpeedMps: number;
  positionEpsilonMeters: number;
  /** Entities with at least one recorded position, first-appearance order. */
  measuredEntityIds: string[];
  /** Entities never recorded with a position (informational: not measurable). */
  notMeasuredEntityIds: string[];
  /** Total consecutive-position pairs measured across all entities. */
  measuredPairCount: number;
  /** Total pairs exceeding the plausibility bound. */
  jumpCount: number;
  /** Max displacement/bound ratio over all measured pairs (0 when none). */
  maxJumpRatio: number;
  /** Max displacement in meters over all measured pairs (0 when none). */
  maxDisplacementMeters: number;
  /** Max displacement in meters among JUMP steps — the maxJump (0 when none). */
  maxJumpMeters: number;
  /** Total gap frames inside measured spans (honest gap accounting). */
  gapFrameCount: number;
  /** Total measured steps spanning at least one gap frame. */
  gapSpanCount: number;
  perEntity: GeometryEntitySeries[];
}

/**
 * The drift bound for one entity kind and one elapsed time. Pure; the
 * documented derivation lives in THRESHOLDS.md §3.
 */
export function driftBoundFor(kind: string, dtMs: number): number {
  const maxSpeed =
    kind === "ball" ? THRESHOLDS.BALL_MAX_SPEED_MPS : THRESHOLDS.PLAYER_MAX_SPEED_MPS;
  return maxSpeed * (dtMs / 1000) + THRESHOLDS.POSITION_EPSILON_METERS;
}

/**
 * Measures geometry drift over a validated clip manifest. Throws
 * `TemporalEvaluationError` (`manifest-malformed`) on structurally invalid
 * input.
 */
export function measureGeometryDrift(manifest: AnimeClipManifest): GeometryDriftMetrics {
  validateManifest(manifest);
  const frames = manifest.frames;

  // Per entity: the frames (indices + positions) with a recorded position.
  interface PositionPoint {
    frameIndex: number;
    timestampMs: number;
    meters: { x: number; y: number };
  }
  const order: string[] = [];
  const pointsById = new Map<string, { kind: string; points: PositionPoint[] }>();
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex]!;
    for (const entity of frame.entities) {
      if (entity.positionMeters === undefined) continue;
      let record = pointsById.get(entity.entityId);
      if (record === undefined) {
        record = { kind: entity.kind, points: [] };
        pointsById.set(entity.entityId, record);
        order.push(entity.entityId);
      }
      record.points.push({
        frameIndex,
        timestampMs: frame.outputTimestampMs,
        meters: entity.positionMeters,
      });
    }
  }

  let totalPairs = 0;
  let totalJumps = 0;
  let totalGapFrames = 0;
  let totalGapSpans = 0;
  let maxRatio = 0;
  let maxDisplacement = 0;
  let maxJumpMeters = 0;
  const perEntity: GeometryEntitySeries[] = [];
  for (const entityId of order) {
    const { kind, points } = pointsById.get(entityId)!;
    const maxSpeed =
      kind === "ball" ? THRESHOLDS.BALL_MAX_SPEED_MPS : THRESHOLDS.PLAYER_MAX_SPEED_MPS;
    const series: GeometryStep[] = [];
    let entityJumps = 0;
    let entityGapSpans = 0;
    let entityMaxDisplacement = 0;
    let entityMaxJump = 0;
    let entityMaxRatio = 0;
    for (let p = 1; p < points.length; p += 1) {
      const from = points[p - 1]!;
      const to = points[p]!;
      const dtMs = to.timestampMs - from.timestampMs;
      const displacementMeters = Math.hypot(
        to.meters.x - from.meters.x,
        to.meters.y - from.meters.y,
      );
      const boundMeters = driftBoundFor(kind, dtMs);
      const jumpRatio = displacementMeters / boundMeters;
      const exceedsBound = displacementMeters > boundMeters;
      const spansGap = to.frameIndex > from.frameIndex + 1;
      series.push({
        fromFrameIndex: from.frameIndex,
        toFrameIndex: to.frameIndex,
        dtMs,
        fromMeters: from.meters,
        toMeters: to.meters,
        displacementMeters,
        boundMeters,
        jumpRatio,
        exceedsBound,
        spansGap,
      });
      if (exceedsBound) {
        entityJumps += 1;
        if (displacementMeters > entityMaxJump) entityMaxJump = displacementMeters;
      }
      if (spansGap) entityGapSpans += 1;
      if (displacementMeters > entityMaxDisplacement) entityMaxDisplacement = displacementMeters;
      if (jumpRatio > entityMaxRatio) entityMaxRatio = jumpRatio;
    }
    const first = points[0]!.frameIndex;
    const last = points[points.length - 1]!.frameIndex;
    const gapFrames = last - first + 1 - points.length;
    totalPairs += series.length;
    totalJumps += entityJumps;
    totalGapFrames += gapFrames;
    totalGapSpans += entityGapSpans;
    if (entityMaxRatio > maxRatio) maxRatio = entityMaxRatio;
    if (entityMaxDisplacement > maxDisplacement) maxDisplacement = entityMaxDisplacement;
    if (entityMaxJump > maxJumpMeters) maxJumpMeters = entityMaxJump;
    perEntity.push({
      entityId,
      kind,
      bound: { maxSpeedMps: maxSpeed, epsilonMeters: THRESHOLDS.POSITION_EPSILON_METERS },
      measuredFrameCount: points.length,
      gapFrameCount: gapFrames,
      gapSpanCount: entityGapSpans,
      jumpCount: entityJumps,
      maxDisplacementMeters: entityMaxDisplacement,
      maxJumpMeters: entityMaxJump,
      maxJumpRatio: entityMaxRatio,
      series,
    });
  }

  // Entities never recorded with a position (first-appearance order).
  const recordedIds = new Set(order);
  const notMeasured: string[] = [];
  for (const frame of frames) {
    for (const entity of frame.entities) {
      if (entity.positionMeters === undefined && !recordedIds.has(entity.entityId)) {
        recordedIds.add(entity.entityId);
        notMeasured.push(entity.entityId);
      }
    }
  }

  return {
    frameCount: frames.length,
    playerMaxSpeedMps: THRESHOLDS.PLAYER_MAX_SPEED_MPS,
    ballMaxSpeedMps: THRESHOLDS.BALL_MAX_SPEED_MPS,
    positionEpsilonMeters: THRESHOLDS.POSITION_EPSILON_METERS,
    measuredEntityIds: order,
    notMeasuredEntityIds: notMeasured,
    measuredPairCount: totalPairs,
    jumpCount: totalJumps,
    maxJumpRatio: maxRatio,
    maxDisplacementMeters: maxDisplacement,
    maxJumpMeters,
    gapFrameCount: totalGapFrames,
    gapSpanCount: totalGapSpans,
    perEntity,
  };
}
