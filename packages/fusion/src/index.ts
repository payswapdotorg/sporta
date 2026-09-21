/**
 * @sporta/fusion — multimodal world-model fusion (work item W401).
 *
 * The FUSION LAYER between the observation streams (W204 image-space tracks,
 * W206 pitch-space tracks, W209 commentary event candidates — all stored by
 * W005) and the versioned Sports World Model engine (W006). It drives the
 * engine deterministically from a store — entities, events, football state —
 * never inventing values, never collapsing conflicts, and keeping an
 * explicit, queryable conflict ledger. No new perception, no new
 * understanding, no new storage.
 *
 * Module map:
 *
 * - `events`: the DATA-PURE commentary → football mapping
 *   (`FOOTBALL_EVENT_MAP`), the W209 candidate payload parser, the candidate
 *   → `EventEnvelope` builder (point events, DERIVED provenance, evidence
 *   chain), and the fulltime → `FootballStatePatch` clock builder
 * - `entities`: `projectTrackEntity` — one track observation → one
 *   upsert-ready versioned `WorldEntity` (honest uncertainty slots; the
 *   engine owns version bumps), plus the track subject-kind resolver and the
 *   re-fusion no-op guard
 * - `conflicts`: the EXPLICIT conflict ledger — `ConflictRecord` and
 *   `detectSlotConflicts` (structural JSON deep-equality within a reorder
 *   window; one record per conflicting group; resolution stays `"none"`)
 * - `fusion`: `runWorldFusion` — the deterministic pass over a store into an
 *   engine, producing a `FusionReport` with the conflict ledger, warnings,
 *   and idempotent re-fusion semantics
 */
export {
  FOOTBALL_EVENT_MAP,
  buildClockPatch,
  buildEventEnvelope,
  parseCandidatePayload,
} from "./events";
export type { BuildEventEnvelopeInput, CandidatePayload } from "./events";
export { projectTrackEntity, trackSubjectKind, upsertWouldBeNoOp } from "./entities";
export type { EntityProjection, TrackFrame } from "./entities";
export { buildConflictRecord, detectSlotConflicts } from "./conflicts";
export type { ConflictRecord } from "./conflicts";
export {
  DEFAULT_POSSESSION_RADIUS_M,
  POSSESSION_AMBIGUITY_EPSILON,
  runWorldFusion,
} from "./fusion";
export type { FusionInput, FusionReport } from "./fusion";
// Additive (L003, Wave 2): the shared structural deep-equality, exported so
// the live incremental updater (@sporta/live-swm) reuses THE ONE definition
// for its possession-idempotence guard instead of forking a second one (the
// "live package imports the helper" option in the L003 design's D4).
export { jsonDeepEqual } from "./internal";
