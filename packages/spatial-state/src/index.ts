/**
 * @sporta/spatial-state — spatial state estimation (work item W206).
 *
 * Projects W204's image-space player tracks into PITCH space through W203's
 * per-frame camera calibration, time-aligned to the W103 session timeline,
 * and emits the result as the SWM-facing spatial observation stream.
 * Owner: AI. Dependencies: W203 (`@sporta/field-mapping`) ✓, W204
 * (`@sporta/perception-tracking`) ✓, W103 (`@sporta/timeline`) ✓.
 *
 * Module map:
 *
 * - `state`: `estimateSpatialState(frames, options): SpatialStateSeries` —
 *   the fusion core (box centers through per-frame homographies, session
 *   time stamping, explicit `min`/`product` confidence fusion with raw
 *   sources preserved, `inBounds` flagged never clamped);
 * - `align`: `alignSessionMs(clock, presentationMs)` (the W103 seam) and
 *   `ensureSpatialMonotonic(points)` (bounded-reorder re-stamping for
 *   multi-source fusions);
 * - `observe`: `emitSpatialObservations(input): Observation[]` (SESSION
 *   timeline `eventTimeMs`, `DERIVED` provenance, pitch meters in the
 *   `TrackPayload` position, NO velocity) plus the `validateObservation`
 *   zod-parse helper;
 * - `benchmark`: `runSpatialBenchmark(scenarios): SpatialBenchmarkReport[]`
 *   and `buildSpatialScenarioFrames(scenario)` — the end-to-end fixture
 *   benchmark (W204 fixtures + tracker, W203 fixture camera, the fusion
 *   under test; identity metrics delegated to W204's benchmark).
 *
 * Architecture-lock conformance: §4 (explicit uncertainty — out-of-pitch
 * projections stay out-of-pitch: flagged, never clamped; fused confidence
 * never inflated; raw sources preserved), §6 (perception emits
 * observations; confidence and provenance preserved — pitch positions are
 * DERIVED, not OBSERVED), §9 (vendor-neutral seams consumed, never
 * re-implemented). Deterministic throughout: no RNG, no clock reads, no
 * `Date.now`.
 */
export { estimateSpatialState } from "./state";
export type {
  SpatialFrame,
  SpatialStateOptions,
  SpatialStatePoint,
  SpatialStateSeries,
} from "./state";
export { alignSessionMs, ensureSpatialMonotonic } from "./align";
export { emitSpatialObservations, validateObservation } from "./observe";
export type { EmitSpatialInput } from "./observe";
export {
  BENCHMARK_PLAYER_SIZE,
  buildSpatialScenarioFrames,
  runSpatialBenchmark,
} from "./benchmark";
export type {
  MotionSpec,
  SpatialBenchmarkReport,
  SpatialBenchmarkScenario,
  SpatialScenarioFrames,
} from "./benchmark";
