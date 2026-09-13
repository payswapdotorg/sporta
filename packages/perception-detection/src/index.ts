/**
 * @sporta/perception-detection — player/object detection (work item W201).
 *
 * DETECTION-level perception: per-frame boxes + labels + confidence. Identity
 * and tracking are W204; real ML backends arrive with the GPU worker protocol
 * (W303). Module map:
 *
 * - `detector`: the provider-neutral seam — `DetectorAdapter` (one method,
 *   per-frame, sync-or-async), `DetectorFrameInput` (the W102 normalized
 *   video-frame fields a detector needs), `DetectedBox`, `NormalizedBox`
 *   (contract-derived)
 * - `fixture-detector`: `FixtureDetectorAdapter` — a PURE deterministic
 *   detector driven by a `FixtureDetectorSpec` (linear/static motion,
 *   center-based boxes clamped into the unit square); ignores pixel content
 *   by design, which is exactly what a real detector would not do
 * - `observe`: `emitDetectionObservations` — turns a frame's detections into
 *   contract `Observation` records (vision / OBSERVED, confidence and
 *   payload passed through verbatim, no identity refs), plus the
 *   `validateObservation` zod-parse helper
 * - `benchmark`: `iou`, greedy one-to-one `matchDetections`, and
 *   `runDetectionBenchmark` (global + per-label precision/recall/F1 report,
 *   pure and deterministic)
 *
 * Architecture-lock conformance: vendor-neutral seam (§9), observations carry
 * provenance and confidence with no silent collapse (§6), W201 emits in
 * frame-native timeline time and never invents identity.
 */
export type { DetectedBox, DetectorAdapter, DetectorFrameInput, NormalizedBox } from "./detector";
export {
  FixtureDetectorAdapter,
  type FixtureDetectorSpec,
  type FixtureLabelSpec,
  type FixturePoint,
  type LinearMotionSpec,
  type MotionSpec,
  type StaticMotionSpec,
} from "./fixture-detector";
export { emitDetectionObservations, validateObservation } from "./observe";
export type { EmitDetectionInput } from "./observe";
export {
  iou,
  matchDetections,
  runDetectionBenchmark,
  type DetectionBenchmarkReport,
  type GroundTruthBox,
  type LabelMetrics,
  type LabeledGroundTruth,
  type MatchDetectionsResult,
  type MatchedPair,
} from "./benchmark";
