/**
 * Tracking benchmark harness (W202).
 *
 * Deterministic, pure evaluation of a {@link BallTrackerAdapter} against
 * fixture scenarios — the "fixture benchmark tracks ball through
 * representative occlusion/motion cases" acceptance for W202. No RNG, no
 * clock, no I/O: the same `(specs, tracker)` always produce a deep-equal
 * report array.
 *
 * METRIC DEFINITIONS (documented exactly; zero-denominator conventions
 * mirror W201's detection benchmark — a bucket with no denominator reports
 * 0, never NaN):
 *
 * - `frames`: number of generated frames in the scenario;
 * - `occlusionGaps`: total gap records across all tracks (bridged + unbridged;
 *   a never-resolved trailing gap counts as unbridged);
 * - `idSwitches`: `max(0, tracks.length - 1)` — the greedy tracker's
 *   semantics: every additional track is, by construction, an identity
 *   switch;
 * - `trackedFrames`: total track points (detected + interpolated);
 * - `coverage`: distinct VISIBLE frames carrying a detected point / total
 *   visible frames, where a frame is VISIBLE iff the scenario emitted at
 *   least one detection for it (occluded and dropped frames are not
 *   visible). Points without boxes and points with no ground-truth match
 *   are excluded from the RMSE metrics below (defensive; neither occurs
 *   with this package's tracker + scenarios);
 * - `positionRmse`: root-mean-square Euclidean error of every track point's
 *   box center against the ground-truth center (matched by frameId), in
 *   normalized units — detected points carry the detector's noise,
 *   interpolated points add the interpolation error;
 * - `interpolatedRmse`: the same, restricted to `source: "interpolated"`
 *   points (the occlusion-bridging quality);
 * - `meanInterpolatedConfidence`: mean confidence of interpolated points
 *   (the decay schedule in action);
 * - `recoveredGaps`: bridged gaps / total gaps.
 */
import type { BallTrackerAdapter } from "./tracker";
import type { BallScenarioSpec } from "./scenario";
import { generateScenarioFrames } from "./scenario";

/** Per-scenario tracking benchmark report (see module docs for metrics). */
export interface TrackingBenchmarkReport {
  /** The scenario's label. */
  readonly scenario: string;
  /** Number of generated frames. */
  readonly frames: number;
  /** Total occlusion gap records across all tracks. */
  readonly occlusionGaps: number;
  /** Identity switches: every additional track is a switch. */
  readonly idSwitches: number;
  /** Total track points (detected + interpolated). */
  readonly trackedFrames: number;
  /** Tracked visible frames / total visible frames. */
  readonly coverage: number;
  /** RMSE of all track points vs ground truth (normalized units). */
  readonly positionRmse: number;
  /** RMSE of interpolated (occlusion-bridged) points only. */
  readonly interpolatedRmse: number;
  /** Mean confidence of interpolated points. */
  readonly meanInterpolatedConfidence: number;
  /** Bridged gaps / total gaps. */
  readonly recoveredGaps: number;
}

/** Root-mean-square of a squared-error array (0 for an empty array). */
function rmse(squaredErrors: readonly number[]): number {
  if (squaredErrors.length === 0) return 0;
  let sum = 0;
  for (const squared of squaredErrors) sum += squared;
  return Math.sqrt(sum / squaredErrors.length);
}

/**
 * Runs the benchmark: per scenario — generate frames, track them, compare
 * the tracks against the exact ground truth (matched by frameId). Reports
 * are returned in spec order. Pure and deterministic.
 */
export function runTrackingBenchmark(
  specs: readonly BallScenarioSpec[],
  tracker: BallTrackerAdapter,
): TrackingBenchmarkReport[] {
  return specs.map((spec) => {
    const { frames, groundTruth } = generateScenarioFrames(spec);
    const tracks = tracker.track(frames);

    const groundTruthByFrameId = new Map(groundTruth.map((entry) => [entry.frameId, entry]));

    // Visible frames: the scenario emitted at least one detection.
    const visibleFrameIds = new Set<string>();
    for (const frame of frames) {
      if (frame.detections.length > 0) visibleFrameIds.add(frame.frameId);
    }

    // Tracked visible frames: distinct frames carrying a DETECTED point.
    const trackedVisibleFrameIds = new Set<string>();
    let occlusionGaps = 0;
    let bridgedGaps = 0;
    let trackedFrames = 0;
    const squaredErrors: number[] = [];
    const interpolatedSquaredErrors: number[] = [];
    const interpolatedConfidences: number[] = [];

    for (const track of tracks) {
      occlusionGaps += track.occlusionGaps.length;
      for (const gap of track.occlusionGaps) {
        if (gap.bridged) bridgedGaps += 1;
      }
      trackedFrames += track.points.length;
      for (const point of track.points) {
        if (point.source === "detected") trackedVisibleFrameIds.add(point.frameId);
        if (point.box === undefined) continue;
        const truth = groundTruthByFrameId.get(point.frameId);
        if (truth === undefined) continue;
        const centerX = point.box.x + point.box.w / 2;
        const centerY = point.box.y + point.box.h / 2;
        const errorX = centerX - truth.center.x;
        const errorY = centerY - truth.center.y;
        const squared = errorX * errorX + errorY * errorY;
        squaredErrors.push(squared);
        if (point.source === "interpolated") {
          interpolatedSquaredErrors.push(squared);
          interpolatedConfidences.push(point.confidence);
        }
      }
    }

    let trackedVisible = 0;
    for (const frameId of trackedVisibleFrameIds) {
      if (visibleFrameIds.has(frameId)) trackedVisible += 1;
    }
    const coverage = visibleFrameIds.size > 0 ? trackedVisible / visibleFrameIds.size : 0;

    const meanInterpolatedConfidence =
      interpolatedConfidences.length > 0
        ? interpolatedConfidences.reduce((sum, value) => sum + value, 0) /
          interpolatedConfidences.length
        : 0;

    return {
      scenario: spec.label,
      frames: frames.length,
      occlusionGaps,
      idSwitches: Math.max(0, tracks.length - 1),
      trackedFrames,
      coverage,
      positionRmse: rmse(squaredErrors),
      interpolatedRmse: rmse(interpolatedSquaredErrors),
      meanInterpolatedConfidence,
      recoveredGaps: occlusionGaps > 0 ? bridgedGaps / occlusionGaps : 0,
    };
  });
}
