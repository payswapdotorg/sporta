/**
 * @sporta/live-swm — THE INCREMENTAL SWM UPDATER (L003).
 *
 * A DRIVER over the SAME canonical `WorldModelEngine` the batch pipeline
 * uses (ADR-010: both feed the same canonical Sports World Model — NO second
 * live-only world model). Live observations (the frozen LiveObservation
 * shape) update the engine incrementally with the batch pass's own honesty
 * machinery (versioning, provenance, uncertainty, the conflict ledger) and
 * the per-batch `LiveUpdateReport` accounting (the D5 shape).
 *
 * CONSTITUTION (pinned by tests):
 * - ONE canonical engine, injected (the updater owns NO world state);
 * - version retained (the engine's snapshotVersion IS worldVersion);
 * - watermark retained (`watermarkAfter` = min(source, L004 engine), the
 *   frozen `Watermark` shape);
 * - provenance retained (the batch's ProvenanceKind, verbatim);
 * - uncertainty retained (position "uncertain" + the row's confidence
 *   verbatim; the frozen UncertaintyStatus is NOT extended — the Wave 0
 *   decision);
 * - extrapolation MARKED (detected:false carries count in the §9 counter;
 *   the updater never invents a position);
 * - rewind protection (the batch pass's own no-op guard + the per-entity
 *   replay frontier: beyond-window lates drop with an explicit counter,
 *   never a position rewind);
 * - live-to-replay continuity (the W005 store bridge — the same store the
 *   batch path reads; a full `runWorldFusion` replay reproduces the live
 *   final state);
 * - fail-closed admission (invalid/wrong-session batches refused typed and
 *   counted; duplicate sequences are idempotent no-ops).
 *
 * Composition: `LiveSource → TemporalBufferEngine (@sporta/live-temporal) →
 * LiveSwmUpdater → WorldModelEngine`.
 */
// The live entity projection + the W005 bridge envelopes (the batch pass's
// conventions mirrored — no duplicate semantics)
export {
  bridgeLiveEntity,
  liveKindToBridgeKind,
  liveKindToEntityKind,
  projectLiveEntity,
  sortedByTimeThenEntityRef,
} from "./projection";
export type { LiveEntityProjection } from "./projection";
// The incremental possession recompute (the batch pass's formula/tie rule)
export { computeIncrementalPossession, participantPositionsOf } from "./possession";
export type {
  ParticipantPosition,
  PossessionCandidate,
  PossessionNone,
  PossessionOutcome,
  PossessionTie,
} from "./possession";
// The report + aggregate accounting
export { canonicalReportJson, canonicalUpdaterStatsJson, emptyLiveUpdaterStats } from "./report";
export type { LiveUpdateReport, LiveUpdaterStats } from "./report";
// The updater
export {
  DEFAULT_LIVE_REORDER_WINDOW_MS,
  LiveSwmUpdater,
  LiveUpdaterValidationError,
  createLiveSwmUpdater,
} from "./updater";
export type { LiveSwmUpdaterOptions } from "./updater";
