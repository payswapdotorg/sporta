/**
 * @sporta/ball-state — ball state estimation (work item W205).
 *
 * Turns W202's per-frame ball TRACKS (image-space, occlusion-bridged with
 * discounted confidence) into a ball STATE SERIES — position + velocity +
 * confidence with HONEST gap semantics — and emits it as the SWM-facing
 * ball observation stream (`TrackPayload` with velocity). Scope boundary:
 * positions stay in IMAGE space (pitch-frame projection is W206/W401
 * territory; this package never touches homography). Module map:
 *
 * - `state`: `estimateBallState` — the pure state estimator (deterministic
 *   merge of W202 tracks, centered-difference velocity with the
 *   `maxSpanMs` honesty window, verbatim confidence/source passthrough,
 *   optional EMA position smoothing, gap-union records), plus the
 *   `BallStatePoint` / `BallStateSeries` contracts and typed option/input
 *   errors
 * - `observe`: `emitBallStateObservations` — one contract `Observation` per
 *   state point (`kind: "track"`, `entityId: "ball"`, provenance
 *   detected→OBSERVED / interpolated→DERIVED, velocity key present only
 *   when defined, confidence passthrough), plus `validateObservation`
 * - `benchmark`: `runBallStateBenchmark` — deterministic end-to-end
 *   evaluation over W202 fixture scenarios against analytic velocities and
 *   exact ground truth (coverage, velocity/position RMSE, confidence and
 *   gap metrics)
 *
 * Note on dependencies: consumes `@sporta/ball-tracking`'s delivered track
 * seams (`BallTrack`, `BallTrackPoint`, occlusion gaps, scenario generator,
 * nearest-box tracker) and the `@sporta/contracts` observation contracts —
 * all `workspace:*`, no external dependencies, no new model vendors
 * (architecture-lock §9).
 */
export type { BallStateEstimatorOptions, BallStatePoint, BallStateSeries } from "./state";
export {
  BALL_ENTITY_ID,
  BallStateInputError,
  BallStateOptionsError,
  DEFAULT_VELOCITY_SPAN_FACTOR,
  estimateBallState,
} from "./state";
export type { EmitBallStateInput } from "./observe";
export { emitBallStateObservations, validateObservation } from "./observe";
export type { BallStateBenchmarkReport } from "./benchmark";
export { runBallStateBenchmark } from "./benchmark";
