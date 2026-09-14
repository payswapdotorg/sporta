/**
 * Spatial consistency benchmark (W206).
 *
 * Deterministic, pure end-to-end evaluation of the fused pipeline
 * W204-tracks + W203-calibration + W103-clock -> W206 spatial state — the
 * "player locations/projected coordinates are time-aligned" acceptance
 * evidence. Per scenario:
 *
 * ```text
 * generateFixtureFrames (W204)                 // image-space GT + frames
 *   -> detectionsFromGroundTruth (W204)        // identity-stripped detector view
 *   -> GreedyIouTracker (W204, default options)// persistent track ids
 *   -> FixtureFieldCalibrator (W203)           // per-frame corner set
 *   -> estimateSpatialState (W206)             // fused pitch-space series
 *   -> runTrackingBenchmark (W204)             // identity-continuity metric
 * ```
 *
 * Accept-criterion THRESHOLDS live in the tests (the brief's §3.6); this
 * module computes the numbers. No RNG, no clock, no I/O — the same specs
 * always produce a deep-equal report array.
 *
 * METRIC DEFINITIONS (documented exactly; zero-denominator conventions mirror
 * W201/W204/W205 — a bucket with no denominator reports 0, never NaN):
 *
 * - `frames`: the scenario's frame count (spec.frames);
 * - `points` / `outOfBounds`: the fused series' point count and its
 *   `inBounds === false` count (out-of-play positions, flagged not clamped);
 * - `maxPerFrameJump`: the maximum pitch-space distance (meters) ANY track
 *   moves between its CONSECUTIVE points in session order — normally
 *   consecutive frames; across an occlusion the track's adjacent points span
 *   the gap and the jump honestly spans it too. 0 when no track has two
 *   points;
 * - `meanConfidence`: mean of the fused point confidences;
 * - `identitySwitches`: W204's identity-continuity metric
 *   (`runTrackingBenchmark`), reused VERBATIM from the delivered W204 seam:
 *   per ground-truth object, the walk over its matched detections in frame
 *   order, counting consecutive pairs whose track id changed. For these
 *   fixtures (no id flip-flops) that equals the sum over objects of
 *   (distinct track ids matched - 1) — one cut means one switch per object;
 * - `coverage`: fused points / ground-truth entries visible across the
 *   scenario (1 = the fusion dropped nothing — every visible GT entry became
 *   exactly one spatial point).
 *
 * DOCUMENTED DEVIATIONS from the brief's type sketch (each mirrors W204's
 * own documented `size` deviation — fields the sketch omits but the delivered
 * seams require; all optional, all documented here and in the README):
 *
 * - `players[].size` (optional, default `{w: 0.2, h: 0.2}`): W204's
 *   `FixtureTrackSpec` REQUIRES box extents — boxes cannot be constructed
 *   without them;
 * - `panSweep` (optional `{from, to}`): the W206 accept scenario is a slow
 *   PAN SWEEP (0.4 -> 0.6), which a single fixed `FixtureCameraSpec` cannot
 *   express. When present, the per-frame pan interpolates linearly
 *   `pan(d) = from + (to - from) * d / max(frames - 1, 1)` (the same
 *   interpolation law as W204's fixture motion); `zoom`/`jitter` still come
 *   from `camera`;
 * - `sceneCutFrames` (optional): the W206 scene-cut accept scenario needs a
 *   camera cut at a chosen frame — passed straight through to W204's
 *   `generateFixtureFrames` (fresh ids after the cut, W204 semantics);
 * - `motion` is typed `FixtureTrackSpec["motion"]` — W204's delivered motion
 *   spec (W204 does not re-export `MotionSpec` from its barrel; the indexed
 *   access is the identical type, avoiding an unsanctioned dependency on
 *   `@sporta/perception-detection`).
 */
import { FixtureFieldCalibrator } from "@sporta/field-mapping";
import type { FieldCornerSet, FixtureCameraSpec } from "@sporta/field-mapping";
import {
  GreedyIouTracker,
  detectionsFromGroundTruth,
  generateFixtureFrames,
  runTrackingBenchmark,
} from "@sporta/perception-tracking";
import type { FixtureTrackSpec, GroundTruthFrame, TrackedBox } from "@sporta/perception-tracking";
import type { TrackClock } from "@sporta/timeline";
import { estimateSpatialState } from "./state";
import type { SpatialFrame, SpatialStatePoint, SpatialStateSeries } from "./state";

/**
 * Default player box size for benchmark scenarios (normalized units,
 * center-based — mirrors the W204 occlusion fixture's player boxes).
 */
export const DEFAULT_SPATIAL_BENCHMARK_PLAYER_SIZE = { w: 0.2, h: 0.2 } as const;

/** Frame pixel volume offered to the fixture calibrator (it ignores content). */
const FIXTURE_FRAME_WIDTH = 160;
const FIXTURE_FRAME_HEIGHT = 90;

/** One benchmark player: label + motion (+ optional box size). */
export interface SpatialBenchmarkScenarioPlayer {
  /** Class label (must match what a detector would emit for this object). */
  readonly label: string;
  /** Box-center motion across the scenario's frames (W204 fixture motion spec). */
  readonly motion: FixtureTrackSpec["motion"];
  /** Box size in normalized coordinates around the moving center (default 0.2 x 0.2). */
  readonly size?: { readonly w: number; readonly h: number };
}

/** One benchmark scenario (see module docs for every field's semantics). */
export interface SpatialBenchmarkScenario {
  /** The scenario's label (report key). */
  readonly name: string;
  /** The fixture camera (W203): pan/zoom/jitter; pan is superseded by panSweep. */
  readonly camera: FixtureCameraSpec;
  /** The scenario's players. */
  readonly players: ReadonlyArray<SpatialBenchmarkScenarioPlayer>;
  /** Number of frames (integer >= 1; W204 fixture convention, 25 fps default). */
  readonly frames: number;
  /** Optional W103 clock for timeline alignment (default: identity clock). */
  readonly clock?: TrackClock;
  /**
   * Optional linear pan sweep: per-frame pan interpolates from -> to over the
   * frame span (the W206 accept scenario's slow sweep). When present it
   * supersedes `camera.pan`.
   */
  readonly panSweep?: { readonly from: number; readonly to: number };
  /** Decode orders to mark as a camera cut (passed to W204's generator). */
  readonly sceneCutFrames?: ReadonlySet<number>;
}

/** Per-scenario spatial consistency report (see module docs for metrics). */
export interface SpatialBenchmarkReport {
  /** The scenario's label. */
  readonly scenario: string;
  /** The scenario's frame count. */
  readonly frames: number;
  /** Fused spatial points in the series. */
  readonly points: number;
  /** Points flagged `inBounds === false` (out-of-play, never clamped). */
  readonly outOfBounds: number;
  /** Max pitch-space distance (meters) any track moves between consecutive points. */
  readonly maxPerFrameJump: number;
  /** Mean fused confidence of the points. */
  readonly meanConfidence: number;
  /** W204 identity switches (see module docs for the exact semantics). */
  readonly identitySwitches: number;
  /** Fused points / visible ground-truth entries (1 = nothing dropped). */
  readonly coverage: number;
}

// ---------------------------------------------------------------------------
// Validation (fail loud)
// ---------------------------------------------------------------------------

/** Validates one scenario's surface; deeper shapes fail loud in W203/W204. */
function validateScenario(scenario: SpatialBenchmarkScenario): void {
  if (scenario === null || typeof scenario !== "object") {
    throw new RangeError("spatial benchmark: every scenario must be an object");
  }
  if (typeof scenario.name !== "string" || scenario.name.length < 1) {
    throw new RangeError(
      `spatial benchmark: scenario.name must be a non-empty string (got ${String(scenario.name)})`,
    );
  }
  if (!Array.isArray(scenario.players)) {
    throw new RangeError(`spatial benchmark: scenario "${scenario.name}" players must be an array`);
  }
  for (const [index, player] of scenario.players.entries()) {
    if (player === null || typeof player !== "object") {
      throw new RangeError(
        `spatial benchmark: scenario "${scenario.name}" players[${index}] must be an object`,
      );
    }
    if (typeof player.label !== "string" || player.label.length < 1) {
      throw new RangeError(
        `spatial benchmark: scenario "${scenario.name}" players[${index}].label must be a ` +
          `non-empty string`,
      );
    }
    if (player.motion === null || typeof player.motion !== "object") {
      throw new RangeError(
        `spatial benchmark: scenario "${scenario.name}" players[${index}].motion must be a ` +
          `W204 fixture motion spec`,
      );
    }
    if (player.size !== undefined) {
      const size = player.size;
      if (
        size === null ||
        typeof size !== "object" ||
        !Number.isFinite(size.w) ||
        !Number.isFinite(size.h)
      ) {
        throw new RangeError(
          `spatial benchmark: scenario "${scenario.name}" players[${index}].size must carry ` +
            `finite w/h when provided`,
        );
      }
    }
  }
  if (!Number.isInteger(scenario.frames) || scenario.frames < 1) {
    throw new RangeError(
      `spatial benchmark: scenario "${scenario.name}" frames must be an integer >= 1 ` +
        `(got ${String(scenario.frames)})`,
    );
  }
  const sweep = scenario.panSweep;
  if (sweep !== undefined) {
    if (sweep === null || typeof sweep !== "object") {
      throw new RangeError(
        `spatial benchmark: scenario "${scenario.name}" panSweep must be an object when provided`,
      );
    }
    for (const bound of [sweep.from, sweep.to] as const) {
      if (typeof bound !== "number" || !Number.isFinite(bound) || bound < 0 || bound > 1) {
        throw new RangeError(
          `spatial benchmark: scenario "${scenario.name}" panSweep bounds must be finite in ` +
            `[0, 1] (got ${String(bound)})`,
        );
      }
    }
  }
  const clock = scenario.clock;
  if (clock !== undefined) {
    if (
      clock === null ||
      typeof clock !== "object" ||
      typeof clock.trackId !== "string" ||
      clock.trackId.length < 1 ||
      !Number.isFinite(clock.offsetMs) ||
      !Number.isFinite(clock.driftPpm)
    ) {
      throw new RangeError(
        `spatial benchmark: scenario "${scenario.name}" clock must be a W103 TrackClock ` +
          `when provided`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Scenario pipeline
// ---------------------------------------------------------------------------

/** Per-frame pan: the sweep interpolation when present, else the fixed pan. */
function panAt(scenario: SpatialBenchmarkScenario, decodeOrder: number): number {
  const sweep = scenario.panSweep;
  if (sweep === undefined) return scenario.camera.pan;
  const t = decodeOrder / Math.max(scenario.frames - 1, 1);
  return sweep.from + (sweep.to - sweep.from) * t;
}

/**
 * Runs the fused pipeline for one scenario (module docs) and returns the
 * series plus the predicted-tracks map the identity metric needs.
 */
function runScenario(scenario: SpatialBenchmarkScenario): {
  series: SpatialStateSeries;
  groundTruth: readonly GroundTruthFrame[];
  predicted: Map<string, readonly TrackedBox[]>;
} {
  const specs: FixtureTrackSpec[] = scenario.players.map((player, index) => ({
    gtId: `p${index + 1}`,
    label: player.label,
    motion: player.motion,
    size: player.size ?? DEFAULT_SPATIAL_BENCHMARK_PLAYER_SIZE,
  }));

  const groundTruth = generateFixtureFrames(specs, {
    frames: scenario.frames,
    ...(scenario.sceneCutFrames !== undefined ? { sceneCutFrames: scenario.sceneCutFrames } : {}),
  });

  // The fixture calibrator ignores pixel content — one shared zeroed buffer
  // documents that honestly (a real CV calibrator would not ignore it).
  const bytes = new Uint8Array(FIXTURE_FRAME_WIDTH * FIXTURE_FRAME_HEIGHT * 3);
  const tracker = new GreedyIouTracker({}, "spatial-benchmark-tracker");
  const predicted = new Map<string, readonly TrackedBox[]>();
  const spatialFrames: SpatialFrame[] = [];

  for (const gtFrame of groundTruth) {
    const cornerSet: FieldCornerSet = new FixtureFieldCalibrator(
      {
        pan: panAt(scenario, gtFrame.frame.decodeOrder),
        zoom: scenario.camera.zoom,
        jitter: scenario.camera.jitter,
      },
      "spatial-benchmark-calibrator",
    ).calibrate({
      frameId: gtFrame.frame.frameId,
      presentationMs: gtFrame.frame.presentationMs,
      width: FIXTURE_FRAME_WIDTH,
      height: FIXTURE_FRAME_HEIGHT,
      bytes,
      decodeOrder: gtFrame.frame.decodeOrder,
    });

    const tracks = tracker.assign(gtFrame.frame, detectionsFromGroundTruth(gtFrame));
    predicted.set(gtFrame.frame.frameId, tracks);
    spatialFrames.push({ frame: gtFrame.frame, cornerSet, tracks });
  }

  const series = estimateSpatialState(spatialFrames, { clock: scenario.clock });
  return { series, groundTruth, predicted };
}

/** Max pitch-space distance between any track's consecutive points (meters). */
function maxJumpBetweenConsecutivePoints(points: readonly SpatialStatePoint[]): number {
  const byTrack = new Map<string, SpatialStatePoint[]>();
  for (const point of points) {
    const trackPoints = byTrack.get(point.trackId);
    if (trackPoints === undefined) {
      byTrack.set(point.trackId, [point]);
    } else {
      trackPoints.push(point);
    }
  }
  let maxJump = 0;
  for (const trackPoints of byTrack.values()) {
    for (let index = 1; index < trackPoints.length; index += 1) {
      const before = trackPoints[index - 1]!;
      const after = trackPoints[index]!;
      const dx = after.pitch.x - before.pitch.x;
      const dy = after.pitch.y - before.pitch.y;
      const jump = Math.sqrt(dx * dx + dy * dy);
      if (jump > maxJump) maxJump = jump;
    }
  }
  return maxJump;
}

/**
 * Runs the benchmark: one {@link SpatialBenchmarkReport} per scenario, in
 * spec order. Pure and deterministic — the same specs always produce a
 * deep-equal result.
 */
export function runSpatialBenchmark(
  specs: readonly SpatialBenchmarkScenario[],
): SpatialBenchmarkReport[] {
  if (!Array.isArray(specs)) {
    throw new RangeError("spatial benchmark: specs must be an array of scenarios");
  }
  return specs.map((scenario) => {
    validateScenario(scenario);
    const { series, groundTruth, predicted } = runScenario(scenario);

    const points = series.points.length;
    let confidenceSum = 0;
    for (const point of series.points) confidenceSum += point.confidence;
    const totalGroundTruth = groundTruth.reduce(
      (sum, gtFrame) => sum + gtFrame.groundTruth.length,
      0,
    );
    const identity = runTrackingBenchmark({ groundTruth, predicted });

    return {
      scenario: scenario.name,
      frames: scenario.frames,
      points,
      outOfBounds: series.outOfBounds,
      maxPerFrameJump: maxJumpBetweenConsecutivePoints(series.points),
      meanConfidence: points > 0 ? confidenceSum / points : 0,
      identitySwitches: identity.identitySwitches,
      coverage: totalGroundTruth > 0 ? points / totalGroundTruth : 0,
    };
  });
}
