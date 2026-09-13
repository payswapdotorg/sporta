/**
 * @sporta/perception-tracking — player identity tracking (work item W204).
 *
 * IDENTITY-level perception: consumes W201's per-frame detections and
 * assigns persistent, session-scoped track ids, emits contract `Observation`
 * records with the `track` payload, and MEASURES identity continuity
 * (switches, fragmentation, track purity) against ground-truth fixtures.
 * Real ML trackers (deep association, embeddings) arrive with the GPU
 * worker protocol (W303). Module map:
 *
 * - `tracker`: `GreedyIouTracker` — the deterministic greedy-IoU association
 *   tracker (`t<seq>` ids, label-gated, gap tolerance, scene-cut policy,
 *   confidence passthrough; pure state machine, no RNG/clock)
 * - `observe`: `emitTrackObservations` — turns a frame's tracked boxes into
 *   contract `Observation` records (vision / OBSERVED, `TrackPayload` with
 *   the box center in normalized image space, NO velocity — W205/W206 own
 *   state estimation; `subjectEntityRefs` from `FOOTBALL_LABEL_KINDS` or an
 *   explicit override, never invented), plus the `validateObservation`
 *   zod-parse helper
 * - `fixture`: `FixtureTrackSpec` / `generateFixtureFrames` (W201-identical
 *   interpolation law, visibility windows + occlusions, scene-cut markers)
 *   and `detectionsFromGroundTruth` (identity-stripped detector view with
 *   deterministic degrade transforms)
 * - `benchmark`: `runTrackingBenchmark` — the identity-continuity metric
 *   (matched/missed, identity switches, continuity score, per-object
 *   fragments, per-track purity, mean purity) reusing W201's
 *   `matchDetections` for correspondence
 *
 * Architecture-lock conformance: §6 (perception emits observations;
 * confidence/provenance preserved with no silent collapse; entity identity
 * maintained WITHOUT inventing certainty — ids are hypotheses, refs are
 * never guessed for unmapped labels), §9 (vendor-neutral association seam).
 */
export {
  GreedyIouTracker,
  type GreedyIouTrackerOptions,
  type SceneCutPolicy,
  type TrackerFrameInput,
  type TrackedBox,
} from "./tracker";
export {
  FOOTBALL_LABEL_KINDS,
  emitTrackObservations,
  validateObservation,
  type EmitTrackInput,
} from "./observe";
export {
  FIXTURE_DETECTION_CONFIDENCE,
  detectionsFromGroundTruth,
  generateFixtureFrames,
  type DetectionsFromGroundTruthOptions,
  type FixtureDegrade,
  type FixtureFramesOptions,
  type FixtureTrackSpec,
  type GroundTruthEntry,
  type GroundTruthFrame,
} from "./fixture";
export {
  runTrackingBenchmark,
  type TrackingBenchmarkInput,
  type TrackingBenchmarkReport,
} from "./benchmark";
