/**
 * @sporta/live-fusion — THE MULTI-SOURCE EVIDENCE FUSION ENGINE (L012).
 *
 * Fuses two or more concurrent LiveObservation sources (L002 synthetic
 * tracking, L011 broadcast-perception, L007 open-data replay — any mix)
 * through the SAME canonical composition into the ONE canonical
 * `WorldModelEngine`:
 *
 * ```text
 * sources (2+) → LiveFusionEngine → TemporalBufferEngine (L004, per-source)
 *                                   → LiveSwmUpdater (L003)
 *                                     → WorldModelEngine (the ONE canonical SWM)
 * ```
 *
 * CONSTITUTION (pinned by tests; see docs/designs/l012-multi-source-fusion.md):
 * - ONE canonical engine, injected TWICE over (the fusion engine owns NO
 *   world state — it is a driver, like L003);
 * - COEXISTENCE: sources never contaminate each other's L004 temporal state
 *   and never rewrite each other's batches — a drain with no cross-source
 *   co-observation passes VERBATIM (Wave 2 behavior preserved);
 * - PROVENANCE/CONFIDENCE VERBATIM: the fusion layer never rewrites a
 *   batch field except arbitration-filtered `entityObservations`; the
 *   updater's projection + bridge carry per-source provenance into the SWM;
 * - CONFLICTS EXPLICIT: cross-source disagreement beyond the
 *   movement-plausibility tolerance mints `ConflictRecord`s (the BATCH
 *   `@sporta/fusion` shape — one conflict vocabulary; observation ids use
 *   the bridge scheme so the ledger and the SWM evidence chain address the
 *   same rows); `resolution: "none"` — the conflict stands;
 * - NEVER a silent winner, NEVER a silent average: same-time conflicting
 *   ties are arbitrated by the DETERMINISTIC canonical replay order (the
 *   (sourceId, sequence) total order — the exact row a W005 store replay
 *   would end on, so the frozen §8 live-to-replay equality holds by
 *   construction); losers are WITHHELD (counted, ledger-recorded, never
 *   bridged); the decision is recorded in every report (survivor,
 *   withheld sources, the operator's precedence preference REPORTED
 *   alongside — never overriding the survivor); the survivor's row applies
 *   VERBATIM;
 * - DETERMINISTIC FALLBACK: event-time authority continues while a source
 *   is lost; the loss is the L004 STALLED latch consumed VERBATIM
 *   (source-lost/source-recovered events + `fallbackActive` — visible,
 *   never silent);
 * - HONEST §9 ACCOUNTING: per-batch L003 reports VERBATIM + per-source L004
 *   counters VERBATIM (never double-counted) + the fusion-layer counters;
 * - REPLAY EQUALITY: withheld rows never reach the updater — never the W005
 *   bridge — so the arbitrated stream IS the stored stream (a batch
 *   `runWorldFusion` replay reproduces the live final state);
 * - NO wall clock, NO env, NO RNG (the render clock is injected per tick).
 */
// The fusion policy (the frozen §7 precedence-as-configuration rule)
export {
  arbitratesOver,
  DEFAULT_BALL_MAX_SPEED_MPS,
  DEFAULT_CONFLICT_TOLERANCE_M,
  DEFAULT_MAX_SPEED_MPS,
  defaultFusionPolicy,
  FusionPolicyValidationError,
  parseFusionPolicy,
  precedenceRankOf,
} from "./policy";
export type { LiveFusionPolicy } from "./policy";
// The co-observation grouping + tolerance checks (pure)
export {
  agreeWithinTolerance,
  coObservationGroupsOf,
  distanceM,
  drainRowsOf,
  sameTimeTiesOf,
} from "./groups";
export type { CoObservationGroup, DrainRow } from "./groups";
// The conflict ledger minting (the batch ConflictRecord shape, live ids)
export { conflictRecordOf, liveObservationIdOf } from "./conflicts";
// The report + aggregate accounting
export { canonicalFusionReportJson, canonicalFusionStatsJson, emptyFusionStats } from "./report";
export type {
  FusionArbitrationDecision,
  FusionReport,
  FusionSourceEvent,
  FusionSourceState,
  FusionSourceSummary,
  FusionStats,
} from "./report";
// The engine
export {
  createLiveFusionEngine,
  LiveFusionEngine,
  LiveFusionEngineValidationError,
} from "./engine";
export type { LiveFusionEngineOptions } from "./engine";
