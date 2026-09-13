/**
 * Ball state estimation benchmark (W205).
 *
 * Deterministic, pure evaluation of the W202-track -> W205-state pipeline
 * against W202's fixture scenarios — the "position/velocity/confidence
 * state can feed the SWM" acceptance evidence. Per scenario: generate frames
 * with `generateScenarioFrames`, track with `NearestBoxBallTracker`
 * (default options), estimate state with `estimateBallState`, and compare
 * against the EXACT ground truth (matched by frameId). No RNG, no clock, no
 * I/O: the same `(specs, options)` always produce a deep-equal report array.
 *
 * ANALYTIC VELOCITY — the scenario flight is a documented closed form
 * (W202 `scenario.ts`), so the true velocity is derivable exactly. With
 * `frameMs = 1000 / fps`, `N` frames, `totalMs = (N - 1) * frameMs`, and the
 * flight parameter `t = presentationMs / totalMs` (W202 defines
 * `t_k = k / (N - 1)` with `presentationMs = k * frameMs`, so the two are
 * the same linear relation):
 *
 * ```text
 * x(t)      = from.x + (to.x - from.x) * t                    (both flights)
 * y_lin(t)  = from.y + (to.y - from.y) * t
 * y_par(t)  = from.y + (to.y - from.y) * t + apex * sin(pi * t)
 *
 * dx/dt_ms  = (to.x - from.x) / totalMs   =>  vx = (to.x - from.x) * 1000 / totalMs
 * dy_lin    = (to.y - from.y) / totalMs   =>  vy = (to.y - from.y) * 1000 / totalMs
 * dy_par/dt = (to.y - from.y) + apex * pi * cos(pi * t)
 *            =>  vy = ((to.y - from.y) + apex * pi * cos(pi * t)) * 1000 / totalMs
 * ```
 *
 * (For the parabolic y: `d/dt [apex * sin(pi t)] = apex * pi * cos(pi t)`,
 * and `dt/dt_ms = 1 / totalMs`.) Units: image-units per SECOND, the same
 * convention as the estimator's centered difference. The comparison uses
 * the CENTER of each point's box as the position convention, matching
 * W202's center-based detection construction (ground-truth centers are the
 * pre-noise exact values).
 *
 * METRIC DEFINITIONS (documented exactly; zero-denominator conventions
 * mirror W201/W202 — a bucket with no denominator reports 0, never NaN):
 *
 * - `points`: state points in the merged series;
 * - `velocityDefined` / `velocityCoverage`: points carrying a defined
 *   velocity, and their fraction over all points;
 * - `velocityRmse`: over points with a DEFINED velocity, the root-mean-square
 *   of the Euclidean velocity-VECTOR error `sqrt((dvx)^2 + (dvy)^2)` vs the
 *   analytic velocity (image-units/s);
 * - `positionRmse`: root-mean-square Euclidean error of every state point's
 *   position (box center) against the ground-truth center, matched by
 *   frameId (normalized units). Points without a ground-truth match are
 *   excluded (defensive; cannot occur with this package's scenarios);
 * - `meanConfidence`: mean of the points' passthrough confidences;
 * - `detectedFraction`: detected points / all points;
 * - `gapCount` / `bridgedGapFraction`: the merged series' gap-union records
 *   and the bridged share of them.
 *
 * Fps convention: each spec's own `fps` is used as the estimator's nominal
 * cadence (`{ ...options, fps: spec.fps }`) — a scenario's velocity window
 * must match its own frame rate; `options` carries the remaining estimator
 * configuration (velocity span override, smoothing).
 */
import { NearestBoxBallTracker, generateScenarioFrames } from "@sporta/ball-tracking";
import type { BallScenarioSpec, FlightSpec } from "@sporta/ball-tracking";
import { estimateBallState } from "./state";
import type { BallStateEstimatorOptions, BallStateSeries } from "./state";

/** Per-scenario ball state benchmark report (see module docs for metrics). */
export interface BallStateBenchmarkReport {
  /** The scenario's label. */
  readonly scenario: string;
  /** State points in the merged series. */
  readonly points: number;
  /** Points carrying a defined velocity. */
  readonly velocityDefined: number;
  /** velocityDefined / points (0 when no points). */
  readonly velocityCoverage: number;
  /** RMSE of the velocity-vector error vs analytic (image-units/s). */
  readonly velocityRmse: number;
  /** RMSE of position vs ground-truth centers (normalized units). */
  readonly positionRmse: number;
  /** Mean passthrough confidence of the state points. */
  readonly meanConfidence: number;
  /** Detected points / all points (0 when no points). */
  readonly detectedFraction: number;
  /** Gap records in the series' merged gap union. */
  readonly gapCount: number;
  /** Bridged gaps / gapCount (0 when no gaps). */
  readonly bridgedGapFraction: number;
}

/** Root-mean-square of a squared-error array (0 for an empty array). */
function rmse(squaredErrors: readonly number[]): number {
  if (squaredErrors.length === 0) return 0;
  let sum = 0;
  for (const squared of squaredErrors) sum += squared;
  return Math.sqrt(sum / squaredErrors.length);
}

/**
 * The analytic (true) velocity of the scenario's flight at
 * `presentationMs`, in image-units per second (derivation in the module
 * docs). Requires `totalMs > 0`; with fewer than three frames no state point
 * can carry a velocity, so the benchmark never calls this then.
 */
function analyticVelocity(
  flight: FlightSpec,
  presentationMs: number,
  totalMs: number,
): { vx: number; vy: number } {
  const t = presentationMs / totalMs;
  const vx = ((flight.to.x - flight.from.x) * 1000) / totalMs;
  const vyLinear = ((flight.to.y - flight.from.y) * 1000) / totalMs;
  if (flight.kind === "parabolic") {
    const apex = flight.apex ?? 0;
    const vy =
      ((flight.to.y - flight.from.y + apex * Math.PI * Math.cos(Math.PI * t)) * 1000) / totalMs;
    return { vx, vy };
  }
  return { vx, vy: vyLinear };
}

/** Runs the W202-track -> W205-state pipeline for one scenario. */
function pipelineForSpec(
  spec: BallScenarioSpec,
  options: BallStateEstimatorOptions,
): { series: BallStateSeries; groundTruthByFrameId: Map<string, { x: number; y: number }> } {
  const { frames, groundTruth } = generateScenarioFrames(spec);
  const tracker = new NearestBoxBallTracker();
  const tracks = tracker.track(frames);
  const series = estimateBallState(tracks, { ...options, fps: spec.fps });
  const groundTruthByFrameId = new Map(
    groundTruth.map((entry) => [entry.frameId, { x: entry.center.x, y: entry.center.y }]),
  );
  return { series, groundTruthByFrameId };
}

/**
 * Runs the benchmark: per scenario — generate frames, track them, estimate
 * state, and compare against the exact ground truth (matched by frameId).
 * Reports are returned in spec order. Pure and deterministic: the same
 * `(specs, options)` always produce a deep-equal result.
 */
export function runBallStateBenchmark(
  specs: readonly BallScenarioSpec[],
  options: BallStateEstimatorOptions,
): BallStateBenchmarkReport[] {
  return specs.map((spec) => {
    const { frames } = generateScenarioFrames(spec);
    const { series, groundTruthByFrameId } = pipelineForSpec(spec, options);

    // The flight's closed form needs totalMs (see module docs); guarded for
    // the degenerate <3-frame scenario where no velocity can exist anyway.
    const frameMs = 1000 / spec.fps;
    const totalMs = (frames.length - 1) * frameMs;

    let velocityDefined = 0;
    let detected = 0;
    let bridgedGaps = 0;
    let confidenceSum = 0;
    const velocitySquaredErrors: number[] = [];
    const positionSquaredErrors: number[] = [];

    for (const point of series.points) {
      if (point.velocity !== undefined) velocityDefined += 1;
      if (point.source === "detected") detected += 1;
      confidenceSum += point.confidence;

      if (point.velocity !== undefined && totalMs > 0) {
        const truth = analyticVelocity(spec.flight, point.presentationMs, totalMs);
        const dvx = point.velocity.vx - truth.vx;
        const dvy = point.velocity.vy - truth.vy;
        velocitySquaredErrors.push(dvx * dvx + dvy * dvy);
      }

      const truthCenter = groundTruthByFrameId.get(point.frameId);
      if (truthCenter !== undefined) {
        const dx = point.position.x - truthCenter.x;
        const dy = point.position.y - truthCenter.y;
        positionSquaredErrors.push(dx * dx + dy * dy);
      }
    }

    for (const gap of series.gaps) {
      if (gap.bridged) bridgedGaps += 1;
    }

    const points = series.points.length;
    return {
      scenario: spec.label,
      points,
      velocityDefined,
      velocityCoverage: points > 0 ? velocityDefined / points : 0,
      velocityRmse: rmse(velocitySquaredErrors),
      positionRmse: rmse(positionSquaredErrors),
      meanConfidence: points > 0 ? confidenceSum / points : 0,
      detectedFraction: points > 0 ? detected / points : 0,
      gapCount: series.gaps.length,
      bridgedGapFraction: series.gaps.length > 0 ? bridgedGaps / series.gaps.length : 0,
    };
  });
}
