/**
 * @sporta/spatial-state — spatial state estimation (work item W206).
 *
 * FUSES the three delivered seams — W204's image-space player TRACKS, W203's
 * per-frame camera CALIBRATION, and W103's timeline CLOCKS — into the
 * SWM-facing spatial observation stream: per-frame, per-track PITCH-SPACE
 * player positions in canonical meters, stamped in SESSION milliseconds,
 * with honest confidence fusion and out-of-pitch positions flagged (never
 * clamped). No velocity (W205's ball-state concern / later fusion); no new
 * detection, calibration, or synchronization. Module map:
 *
 * - `state`: `estimateSpatialState` — the pure fusion core (W203 projector
 *   per frame, W204 track-id passthrough, W103 clock alignment, `"min"` /
 *   `"product"` confidence fusion with raw `sourceConfidences` preserved,
 *   deterministic (sessionMs, trackId, frameId) point ordering), plus the
 *   `SpatialFrame` / `SpatialStatePoint` / `SpatialStateSeries` contracts and
 *   typed option/input errors
 * - `align`: `alignSessionMs` (documented W103 `toSessionMs` wrapper) and
 *   `ensureSpatialMonotonic` (W103 `ensureMonotonic` semantics, pure
 *   re-stamping for multi-source series)
 * - `observe`: `emitSpatialObservations` — one contract `Observation` per
 *   fused point (`kind: "track"`, `entityId = trackId`, pitch METERS in the
 *   `Point2D` slot, `eventTimeMs = sessionMs`, provenance `DERIVED`, NO
 *   velocity, `subjectEntityRefs` from W204's `FOOTBALL_LABEL_KINDS`), plus
 *   the `validateObservation` zod-parse helper
 * - `benchmark`: `runSpatialBenchmark` — the deterministic spatial
 *   consistency benchmark over W204 fixture scenarios (max per-frame pitch
 *   jump, identity switches via W204's metric, coverage, mean confidence)
 *
 * Architecture-lock conformance: §4 (explicit uncertainty — out-of-pitch
 * projections are flagged, never clamped; confidence is never inflated), §6
 * (perception emits observations; provenance/confidence preserved — the
 * projection is honestly DERIVED from OBSERVED corners + OBSERVED tracks),
 * §9 (vendor-neutral seams only; no new external dependencies).
 */
export type {
  ConfidenceCombination,
  SpatialFrame,
  SpatialStateOptions,
  SpatialStatePoint,
  SpatialStateSeries,
} from "./state";
export { SpatialStateInputError, SpatialStateOptionsError, estimateSpatialState } from "./state";
export { alignSessionMs, ensureSpatialMonotonic } from "./align";
export type { EmitSpatialInput } from "./observe";
export {
  DEFAULT_SPATIAL_ENTITY_KIND,
  emitSpatialObservations,
  validateObservation,
} from "./observe";
export type {
  SpatialBenchmarkReport,
  SpatialBenchmarkScenario,
  SpatialBenchmarkScenarioPlayer,
} from "./benchmark";
export { DEFAULT_SPATIAL_BENCHMARK_PLAYER_SIZE, runSpatialBenchmark } from "./benchmark";
