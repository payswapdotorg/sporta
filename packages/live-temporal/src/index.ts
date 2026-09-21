/**
 * @sporta/live-temporal — THE TEMPORAL BUFFER / WATERMARK ENGINE (L004).
 *
 * The engine between the live source and the L003 incremental SWM updater:
 * per-source EVENT-TIME watermarks (the frozen `Watermark` shape, verbatim),
 * a bounded reorder window with honest late-drop accounting, sequence-hole
 * gap markers, extrapolation marking (the source's own `detected: false`
 * carries — counted, never interpolated), lag accounting and the explicit
 * five-state degraded-state machine (BOOT / NOMINAL / REORDERING / DEGRADED /
 * STALLED) — every counter the frozen live contract §9 names for this stage.
 *
 * CONSTITUTION (pinned by tests):
 * - NO wall clock inside the engine (render-clock ticks are INJECTED; the
 *   state transitions are pure functions of the arrival + tick sequence);
 * - the watermark is EVENT-TIME, per source, conservative and MONOTONIC
 *   (never advances past an unfilled hole or an in-window observation);
 * - drops are COUNTED (lateDropped / droppedObservations / duplicateDropped),
 *   never silent; gaps are VISIBLE (GapMarker + the sequence numbering never
 *   renumbered); extrapolation is MARKED (counted carries), never invented;
 * - a source behind the renderer beyond the lag budget is DEGRADED — exposed,
 *   never pretended current (the frozen §4 rule);
 * - dropped and reconnect windows survive with explicit accounting (the L002
 *   six-scenario matrix doubles as this package's acceptance matrix).
 *
 * Composition: `LiveSource → TemporalBufferEngine → LiveSwmUpdater →
 * WorldModelEngine` (the L003 design's seam; the updater consumes
 * {@link DrainResult}).
 */
// The D1 watermark arithmetic (pure, property-tested)
export {
  DEFAULT_LAG_BUDGET_MS,
  DEFAULT_MAX_BUFFERED_BATCHES,
  DEFAULT_REORDER_WINDOW_MS,
  DEFAULT_STALL_BUDGET_MS,
  holeClosedByWatermark,
  nextWatermarkMs,
  watermarkLagMs,
  windowBoundMs,
} from "./watermark";
export type { SourceWatermarkState } from "./watermark";
// The D3 state machine (pure transitions)
export { TEMPORAL_SOURCE_STATES, evaluateSourceState } from "./states";
export type { SourceStateFacts, TemporalSourceState } from "./states";
// The D6 counters + canonical serialization
export { canonicalStatsJson, emptyTemporalEngineStats } from "./stats";
export type { TemporalEngineStats } from "./stats";
// The engine
export {
  TemporalBufferEngine,
  TemporalEngineValidationError,
  createTemporalBufferEngine,
} from "./engine";
export type {
  AppliedBatch,
  DrainReason,
  DrainResult,
  GapMarker,
  OpenHole,
  SourceDrainStats,
  TemporalBufferEngineConfig,
} from "./engine";
