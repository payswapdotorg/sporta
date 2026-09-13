/**
 * Deterministic fixture scenario generator (W202).
 *
 * Generates synthetic ball-observation frames plus exact ground truth so the
 * tracking benchmark can be exercised end-to-end BEFORE any real detector or
 * media exists — the same role `FixtureDetectorAdapter` plays for W201. The
 * generator is PURE and DETERMINISTIC (no RNG, no clock — the "noise" is a
 * documented pseudo-noise formula, so a seed-free spec always reproduces
 * byte-identical frames; docs/testing/HARNESS.md).
 *
 * FORMULAS (documented exactly; the tests pin them):
 *
 * ```text
 * frameMs = 1000 / fps
 * N       = ceil(durationMs / frameMs)          frame count
 * frame k: frameId "f-0-<k>", decodeOrder k, presentationMs k * frameMs
 * t_k     = k / max(N - 1, 1)                   flight parameter
 *
 * linear:     x(t) = from.x + (to.x - from.x) * t
 *             y(t) = from.y + (to.y - from.y) * t
 * parabolic:  x(t) = from.x + (to.x - from.x) * t          (x is linear)
 *             y(t) = from.y + (to.y - from.y) * t + apex * sin(pi * t)
 * ```
 *
 * The parabolic flight reaches its apex offset EXACTLY at the parameter
 * midpoint `t = 0.5` (where `sin(pi/2) = 1`), i.e.
 * `y(0.5) = (from.y + to.y) / 2 + apex`; `apex` defaults to 0 (degenerates
 * to the linear flight's y).
 *
 * Per frame k, a detection is emitted iff the frame is VISIBLE:
 *
 * - OCCLUDED: `presentationMs` falls in a half-open occlusion window
 *   `[fromMs, toMs)` of some spec occlusion (occluded -> NO detection);
 * - DROPPED: `dropRate >= 2` and `k % dropRate === dropRate - 1` (every
 *   dropRate-th frame in 1-based order — 0-based indices dropRate-1,
 *   2*dropRate-1, ...). `dropRate` 0 keeps all visible frames.
 *
 * The emitted detection's center is the ground-truth center offset by a
 * deterministic pseudo-noise scalar that offsets BOTH coordinates:
 *
 * ```text
 * n_k = ((k * 37 + 11) % 100) / 100 * detectionNoise
 * detectedCenter = { x: truth.x + n_k, y: truth.y + n_k }
 * ```
 *
 * The detection box is `BALL_BOX_SIZE x BALL_BOX_SIZE` (0.04 x 0.04) around
 * the (noisy) center with edges clamped into the unit square — the same
 * center-based construction as W201's fixture detector. Clamping only bites
 * for flights that leave the frame; tests keep flights in range so the box
 * center equals the noisy center exactly. Ground-truth centers are EXACT
 * (pre-noise) for EVERY frame, occluded or not.
 */
import type { BallObservationFrame } from "./tracker";
import type { DetectedBox, NormalizedBox } from "@sporta/perception-detection";

/** Confidence stamped on every scenario ball detection. */
export const BALL_DETECTION_CONFIDENCE = 0.85;
/** Width/height of the scenario ball box, in normalized units. */
export const BALL_BOX_SIZE = 0.04;
/** Label stamped on every scenario ball detection. */
export const BALL_LABEL = "ball";

/** A 2D point in normalized image coordinates. */
export interface ScenarioPoint {
  readonly x: number;
  readonly y: number;
}

/** Linear flight: the center moves from `from` to `to`. */
export interface LinearFlightSpec {
  readonly kind: "linear";
  readonly from: ScenarioPoint;
  readonly to: ScenarioPoint;
}

/**
 * Parabolic flight: x moves linearly from `from.x` to `to.x`; y follows the
 * linear from/to path plus a `sin`-shaped offset of amplitude `apex` peaked
 * exactly at the parameter midpoint (see module docs).
 */
export interface ParabolicFlightSpec {
  readonly kind: "parabolic";
  readonly from: ScenarioPoint;
  readonly to: ScenarioPoint;
  /** Peak y offset at t = 0.5 (default 0). */
  readonly apex?: number;
}

/** How the ball center moves across the scenario. */
export type FlightSpec = LinearFlightSpec | ParabolicFlightSpec;

/** One occlusion window: frames with presentationMs in [fromMs, toMs). */
export interface OcclusionSpec {
  readonly fromMs: number;
  readonly toMs: number;
}

/**
 * The complete fixture scenario (all fields validated at generation — the
 * repo's fail-loud convention).
 */
export interface BallScenarioSpec {
  /** Scenario label (reported by the benchmark). */
  readonly label: string;
  /** Frame rate in hertz (drives `frameMs = 1000 / fps`). */
  readonly fps: number;
  /** Scenario duration in milliseconds (drives the frame count). */
  readonly durationMs: number;
  /** The ball's flight path. */
  readonly flight: FlightSpec;
  /** Occlusion windows (half-open [fromMs, toMs); no detections inside). */
  readonly occlusions: readonly OcclusionSpec[];
  /** Detection center jitter amplitude (0 = exact; see module docs). */
  readonly detectionNoise: number;
  /** Drop every dropRate-th visible frame (0 = keep all; see module docs). */
  readonly dropRate: number;
}

/** One scenario frame's exact ground truth: the true ball center. */
export interface ScenarioGroundTruth {
  readonly frameId: string;
  readonly presentationMs: number;
  readonly center: ScenarioPoint;
}

/** Result of {@link generateScenarioFrames}. */
export interface ScenarioFrames {
  /** Every frame of the scenario (occluded frames carry no detections). */
  readonly frames: readonly BallObservationFrame[];
  /** Exact pre-noise ground truth for every frame. */
  readonly groundTruth: readonly ScenarioGroundTruth[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`ball scenario: ${what} must be a finite number (got ${value})`);
  }
}

/** Fails loud on malformed specs (repo convention). */
function validateSpec(spec: BallScenarioSpec): void {
  if (typeof spec.label !== "string" || spec.label.length < 1) {
    throw new RangeError("ball scenario: label must be a non-empty string");
  }
  assertFinite(spec.fps, "fps");
  if (spec.fps <= 0) {
    throw new RangeError(`ball scenario: fps must be > 0 (got ${spec.fps})`);
  }
  assertFinite(spec.durationMs, "durationMs");
  if (spec.durationMs <= 0) {
    throw new RangeError(`ball scenario: durationMs must be > 0 (got ${spec.durationMs})`);
  }
  const flight = spec.flight;
  if (flight.kind !== "linear" && flight.kind !== "parabolic") {
    // Runtime guard for unvalidated (non-TS) callers; unreachable per types.
    throw new RangeError(
      `ball scenario: unknown flight kind "${String((flight as { kind: unknown }).kind)}"`,
    );
  }
  assertFinite(flight.from.x, "flight.from.x");
  assertFinite(flight.from.y, "flight.from.y");
  assertFinite(flight.to.x, "flight.to.x");
  assertFinite(flight.to.y, "flight.to.y");
  if (flight.kind === "parabolic" && flight.apex !== undefined) {
    assertFinite(flight.apex, "flight.apex");
  }
  for (const [index, occlusion] of spec.occlusions.entries()) {
    assertFinite(occlusion.fromMs, `occlusions[${index}].fromMs`);
    assertFinite(occlusion.toMs, `occlusions[${index}].toMs`);
    if (occlusion.toMs < occlusion.fromMs) {
      throw new RangeError(
        `ball scenario: occlusions[${index}].toMs (${occlusion.toMs}) must be ` +
          `>= fromMs (${occlusion.fromMs})`,
      );
    }
  }
  assertFinite(spec.detectionNoise, "detectionNoise");
  if (spec.detectionNoise < 0) {
    throw new RangeError(`ball scenario: detectionNoise must be >= 0 (got ${spec.detectionNoise})`);
  }
  if (!Number.isInteger(spec.dropRate) || (spec.dropRate !== 0 && spec.dropRate < 2)) {
    throw new RangeError(
      `ball scenario: dropRate must be 0 (keep all) or an integer >= 2 (got ${spec.dropRate})`,
    );
  }
}

/** The flight's center at interpolation parameter `t` (see module docs). */
function flightCenterAt(flight: FlightSpec, t: number): ScenarioPoint {
  const x = flight.from.x + (flight.to.x - flight.from.x) * t;
  const yLinear = flight.from.y + (flight.to.y - flight.from.y) * t;
  if (flight.kind === "parabolic") {
    const apex = flight.apex ?? 0;
    return { x, y: yLinear + apex * Math.sin(Math.PI * t) };
  }
  return { x, y: yLinear };
}

/** Deterministic pseudo-noise scalar for frame index `k` (see module docs). */
function pseudoNoise(k: number, noise: number): number {
  return (((k * 37 + 11) % 100) / 100) * noise;
}

/**
 * Center-based box construction with edge clamping (W201 fixture-detector
 * convention): `BALL_BOX_SIZE` square around `center`, every edge clamped
 * into [0, 1].
 */
function boxFromCenter(center: ScenarioPoint): NormalizedBox {
  const half = BALL_BOX_SIZE / 2;
  const left = clamp01(center.x - half);
  const right = clamp01(center.x + half);
  const top = clamp01(center.y - half);
  const bottom = clamp01(center.y + half);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Generates the scenario's frames and ground truth.
 *
 * Deterministic: the same spec always produces a deep-equal result (all
 * randomness is the documented pseudo-noise formula). Frames are emitted in
 * presentation order with decoding-convention ids (`f-0-<k>`).
 */
export function generateScenarioFrames(spec: BallScenarioSpec): ScenarioFrames {
  validateSpec(spec);

  const frameMs = 1000 / spec.fps;
  const frameCount = Math.ceil(spec.durationMs / frameMs);

  const frames: BallObservationFrame[] = [];
  const groundTruth: ScenarioGroundTruth[] = [];

  for (let k = 0; k < frameCount; k += 1) {
    const presentationMs = k * frameMs;
    const frameId = `f-0-${k}`;
    const t = k / Math.max(frameCount - 1, 1);
    const truth = flightCenterAt(spec.flight, t);

    groundTruth.push({ frameId, presentationMs, center: truth });

    const occluded = spec.occlusions.some(
      (occlusion) => presentationMs >= occlusion.fromMs && presentationMs < occlusion.toMs,
    );
    const dropped = spec.dropRate >= 2 && k % spec.dropRate === spec.dropRate - 1;

    let detections: readonly DetectedBox[] = [];
    if (!occluded && !dropped) {
      const noise = pseudoNoise(k, spec.detectionNoise);
      const detectedCenter = { x: truth.x + noise, y: truth.y + noise };
      const detection: DetectedBox = {
        box: boxFromCenter(detectedCenter),
        label: BALL_LABEL,
        confidence: BALL_DETECTION_CONFIDENCE,
      };
      detections = [detection];
    }

    frames.push({
      frameId,
      presentationMs,
      decodeOrder: k,
      detections,
    });
  }

  return { frames, groundTruth };
}
