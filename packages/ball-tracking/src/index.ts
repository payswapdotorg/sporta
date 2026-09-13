/**
 * @sporta/ball-tracking — image-space ball tracking (work item W202).
 *
 * Continuity of the ball object across frames with occlusion handling,
 * CONSUMING W201's detection output (it never re-detects). Scope boundary:
 * this is IMAGE-SPACE tracking only — SWM-facing ball STATE (pitch
 * coordinates, velocity, the confidence feed) is W205's state estimator,
 * which consumes this package's tracks. No `TrackPayload` and no entity ids
 * are emitted into the SWM: W202 emits per-frame ball DETECTIONS plus honest
 * track structure. Module map:
 *
 * - `tracker`: the provider-neutral seam — `BallTrackerAdapter` (vendor
 *   neutrality, architecture-lock §9), `BallObservationFrame` (the W102
 *   normalized-frame fields a tracker needs), `BallTrackPoint` /
 *   `BallTrack` / `BallOcclusionGap` (honest track structure: detected vs
 *   interpolated sources, occlusion gaps)
 * - `nearest-box`: `NearestBoxBallTracker` — a PURE deterministic greedy
 *   tracker (documented algorithm): nearest-unclaimed-box association with
 *   a per-frame `maxStep` gate, occlusion gaps kept OPEN and bridged by
 *   linear interpolation with exponentially DISCOUNTED confidence
 *   (`base * 0.5^ceil(gapElapsed/4)`), gap > `maxGapFrames` closes the
 *   track (an id switch by construction), and extrapolation at the edges
 *   NEVER happens
 * - `scenario`: `BallScenarioSpec` + `generateScenarioFrames` — deterministic
 *   fixture scenarios (linear/parabolic flight with documented math,
 *   occlusion windows, pseudo-noise, drop pattern) with exact ground truth
 * - `benchmark`: `runTrackingBenchmark` — coverage, id switches, gap
 *   recovery, position/interpolated RMSE per scenario (pure and
 *   deterministic)
 * - `observe`: `emitBallDetectionObservations` — turns a track's DETECTED
 *   points into contract `Observation` records (vision / OBSERVED, the
 *   detection payload and confidence passed through verbatim, no identity
 *   refs). INTERPOLATED points are NOT emitted — they live in the track
 *   structure with discounted confidence for W205 (explicit uncertainty
 *   rather than invented certainty, architecture-lock §4)
 *
 * Note on dependencies: the seam consumes `@sporta/perception-detection`'s
 * delivered `DetectedBox`/`NormalizedBox` types directly (consume-only; no
 * drift) in addition to the contracts/observation/testing workspace deps —
 * all `workspace:*`, no external dependencies.
 */
export type {
  BallObservationFrame,
  BallOcclusionGap,
  BallTrack,
  BallTrackPoint,
  BallTrackerAdapter,
} from "./tracker";
export {
  DEFAULT_MAX_GAP_FRAMES,
  DEFAULT_MAX_STEP,
  DEFAULT_TRACKER_ID,
  NearestBoxBallTracker,
} from "./nearest-box";
export type { NearestBoxTrackerOptions } from "./nearest-box";
export {
  BALL_BOX_SIZE,
  BALL_DETECTION_CONFIDENCE,
  BALL_LABEL,
  generateScenarioFrames,
} from "./scenario";
export type {
  BallScenarioSpec,
  FlightSpec,
  LinearFlightSpec,
  OcclusionSpec,
  ParabolicFlightSpec,
  ScenarioFrames,
  ScenarioGroundTruth,
  ScenarioPoint,
} from "./scenario";
export { runTrackingBenchmark } from "./benchmark";
export type { TrackingBenchmarkReport } from "./benchmark";
export { emitBallDetectionObservations, validateBallObservation } from "./observe";
export type { EmitBallDetectionInput } from "./observe";
