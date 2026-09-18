/**
 * @sporta/perception-adapters — the perception adapter plane (R201-R206).
 *
 * The stable per-family adapter interfaces behind the frozen Wave-0
 * `PerceptionAdapterDescriptor` binding, plus at least two materially
 * different conforming candidate implementations per family, every
 * candidate carrying an honest `TechnologyLicenseRecord`, documented
 * failure classes, resource requirements, and a deterministic benchmark
 * module over committed synthetic-diagnostic fixtures. Module map:
 *
 * - `adapter`: the R201 family interfaces (`PlayerDetectionAdapter`,
 *   `BallDetectionAdapter`, `PlayerTrackingAdapter`,
 *   `PitchCalibrationAdapter`, `TeamIdentityAdapter`) + the re-exported
 *   W201/W202/W203/W204 input/output shapes (consume-only, never
 *   re-declared) + `TechnologyBoundedAdapter` (the evaluation metadata
 *   every candidate carries)
 * - `errors`: typed refusals + the fail-closed descriptor validation
 *   (`assertDescriptorBinding`, `perceptionDescriptor`)
 * - `licenses`: the honest per-component license records
 * - `registry-bindings`: `TechnologyCandidate`-shaped binding-readiness
 *   records + `describeAdapters()` (the runtime registry is another
 *   lane's Wave-1 deliverable)
 * - `detection/heuristic-color`: R202 candidate 1 (real pixel-space
 *   CPU-only detector)
 * - `detection/model-backed`: R202 candidate 2 (real open-source detector
 *   when weights + backend are present; the exact W303 integration point)
 * - `tracking/greedy-iou-adapter`: R203 candidate 1 (W204 baseline wrap)
 * - `tracking/hungarian`: R203 candidate 2 (own O(n^3) Hungarian over an
 *   IoU+centroid cost) + `tracking/hungarian-algorithm` (the solver)
 * - `tracking/apparent-switches`: the shared honest adapter-level
 *   identity-switch proxy
 * - `ball/nearest-box-adapter`: R204 candidate 1 (W202 baseline wrap)
 * - `ball/color-blob`: R204 candidate 2 (pixel-space ball evidence)
 * - `calibration/homography-adapter`: R205 candidate 1 (W203 DLT wrap)
 * - `calibration/line-based`: R205 candidate 2 (projection-histogram line
 *   detection feeding the W203 solver)
 * - `team/jersey-color`: R206 (k=2 jersey-color clustering with explicit
 *   uncertainty)
 * - `benchmark/*`: deterministic family benchmarks emitting frozen-contract
 *   `BenchmarkRun` records over committed synthetic-diagnostic fixtures
 * - `pixels` / `synth`: shared pixel utilities + the synthetic-diagnostic
 *   frame painter
 *
 * Architecture-lock conformance: vendor-neutral seams (§9), confidence
 * preserved with no silent collapse (§6), untrusted-input validation
 * (§13), and NO SWM/observation-contract change to conform (the ONE
 * additive exception is R206's `TeamAssignmentPayload`, recorded in the
 * contracts package and the wave report).
 */
// R201 framework + family interfaces.
export type {
  BallDetectionAdapter,
  BallTrackingAdapter,
  CalibrationCorrespondence,
  CalibrationResult,
  DetectionSequenceFrame,
  PitchCalibrationAdapter,
  PitchCalibrationInput,
  PlayerDetectionAdapter,
  PlayerTrackingAdapter,
  PlayerTrackingResult,
  TeamAssignment,
  TeamId,
  TeamIdentityAdapter,
  TechnologyBoundedAdapter,
  TrackSequenceFrame,
} from "./adapter";
export { BALL_DETECTION_LABEL, PLAYER_TRACKING_SWITCH_IOU } from "./adapter";
export type {
  BallTrack,
  DetectedBox,
  DetectorFrameInput,
  FieldCornerSet,
  Homography,
  NormalizedBox,
  PitchPoint,
  Point2D,
  TrackedBox,
} from "./adapter";
// Typed errors + fail-closed descriptor validation.
export {
  AdapterBindingError,
  CandidateFailureError,
  InvalidAdapterInputError,
  PerceptionAdapterError,
  assertDescriptorBinding,
  isPerceptionAdapterError,
  perceptionDescriptor,
} from "./errors";
export type { PerceptionAdapterErrorDetails, PerceptionAdapterErrorUnion } from "./errors";
// License records.
export {
  COLOR_BLOB_BALL_TRACKER_LICENSE,
  GREEDY_IOU_TRACKER_LICENSE,
  HEURISTIC_COLOR_DETECTOR_LICENSE,
  HOMOGRAPHY_FIELD_CALIBRATOR_LICENSE,
  HUNGARIAN_TRACKER_LICENSE,
  JERSEY_COLOR_TEAM_ASSIGNER_LICENSE,
  LINE_BASED_FIELD_CALIBRATOR_LICENSE,
  MODEL_BACKED_DETECTOR_LICENSE,
  NEAREST_BOX_BALL_TRACKER_LICENSE,
  REPO_CODE_LICENSE,
  pureCodeLicense,
} from "./licenses";
// Registry bindings + describeAdapters.
export {
  PERCEPTION_ADAPTERS_REGISTRATION_EPOCH_MS,
  candidateBindingFor,
  defaultCandidateBindings,
  describeAdapters,
} from "./registry-bindings";
export type { AdapterFamilySummary, CandidateBinding, CandidateSummary } from "./registry-bindings";
// R202 candidates.
export {
  HEURISTIC_COLOR_DETECTOR_ADAPTER_VERSION,
  HEURISTIC_COLOR_DETECTOR_FAILURE_CLASSES,
  HEURISTIC_COLOR_DETECTOR_ID,
  HEURISTIC_COLOR_DETECTOR_RESOURCES,
  HEURISTIC_COLOR_DETECTOR_VERSION,
  HeuristicColorDetector,
} from "./detection/heuristic-color";
export type { HeuristicColorDetectorOptions } from "./detection/heuristic-color";
export {
  MODEL_BACKED_DETECTOR_ADAPTER_VERSION,
  MODEL_BACKED_DETECTOR_FAILURE_CLASSES,
  MODEL_BACKED_DETECTOR_ID,
  MODEL_BACKED_DETECTOR_RESOURCES,
  MODEL_BACKED_DETECTOR_VERSION,
  MODEL_WEIGHT_FILE_NAMES,
  ModelBackedDetector,
  resolveWeightsPath,
} from "./detection/model-backed";
export type {
  ModelBackedDetectorOptions,
  ModelInferenceBackend,
  WeightsStatus,
} from "./detection/model-backed";
// R203 candidates + machinery.
export {
  GREEDY_IOU_TRACKER_ADAPTER_VERSION,
  GREEDY_IOU_TRACKER_FAILURE_CLASSES,
  GREEDY_IOU_TRACKER_ID,
  GREEDY_IOU_TRACKER_RESOURCES,
  GREEDY_IOU_TRACKER_VERSION,
  GreedyIouTrackerAdapter,
} from "./tracking/greedy-iou-adapter";
export type { GreedyIouTrackerAdapterOptions } from "./tracking/greedy-iou-adapter";
export {
  HUNGARIAN_TRACKER_ADAPTER_VERSION,
  HUNGARIAN_TRACKER_FAILURE_CLASSES,
  HUNGARIAN_TRACKER_ID,
  HUNGARIAN_TRACKER_RESOURCES,
  HUNGARIAN_TRACKER_VERSION,
  TwoStageHungarianTracker,
} from "./tracking/hungarian";
export type { TwoStageHungarianTrackerOptions } from "./tracking/hungarian";
export {
  FORBIDDEN_COST,
  assignmentTotalCost,
  solveHungarianAssignment,
} from "./tracking/hungarian-algorithm";
export { countApparentIdentitySwitches } from "./tracking/apparent-switches";
// R204 candidates.
export {
  COLOR_BLOB_BALL_TRACKER_ADAPTER_VERSION,
  COLOR_BLOB_BALL_TRACKER_FAILURE_CLASSES,
  COLOR_BLOB_BALL_TRACKER_ID,
  COLOR_BLOB_BALL_TRACKER_RESOURCES,
  COLOR_BLOB_BALL_TRACKER_VERSION,
  ColorBlobBallTracker,
  extractBallBlobDetections,
} from "./ball/color-blob";
export type { BallBlobGates, ColorBlobBallTrackerOptions } from "./ball/color-blob";
export {
  BALL_BLOB_DETECTOR_ADAPTER_VERSION,
  BALL_BLOB_DETECTOR_FAILURE_CLASSES,
  BALL_BLOB_DETECTOR_ID,
  BALL_BLOB_DETECTOR_RESOURCES,
  BALL_BLOB_DETECTOR_VERSION,
  BallBlobDetector,
  MODEL_BACKED_BALL_DETECTOR_ADAPTER_VERSION,
  MODEL_BACKED_BALL_DETECTOR_FAILURE_CLASSES,
  MODEL_BACKED_BALL_DETECTOR_ID,
  MODEL_BACKED_BALL_DETECTOR_RESOURCES,
  MODEL_BACKED_BALL_DETECTOR_VERSION,
  ModelBackedBallDetector,
} from "./ball/ball-blob-detector";
export type {
  BallBlobDetectorOptions,
  BallModelInferenceBackend,
  ModelBackedBallDetectorOptions,
} from "./ball/ball-blob-detector";
export {
  NEAREST_BOX_BALL_TRACKER_ADAPTER_VERSION,
  NEAREST_BOX_BALL_TRACKER_FAILURE_CLASSES,
  NEAREST_BOX_BALL_TRACKER_ID,
  NEAREST_BOX_BALL_TRACKER_RESOURCES,
  NEAREST_BOX_BALL_TRACKER_VERSION,
  NearestBoxBallTrackerAdapter,
} from "./ball/nearest-box-adapter";
export type { NearestBoxBallTrackerAdapterOptions } from "./ball/nearest-box-adapter";
// R205 candidates.
export {
  HOMOGRAPHY_FIELD_CALIBRATOR_ADAPTER_VERSION,
  HOMOGRAPHY_FIELD_CALIBRATOR_FAILURE_CLASSES,
  HOMOGRAPHY_FIELD_CALIBRATOR_ID,
  HOMOGRAPHY_FIELD_CALIBRATOR_RESOURCES,
  HOMOGRAPHY_FIELD_CALIBRATOR_VERSION,
  HomographyFieldCalibratorAdapter,
} from "./calibration/homography-adapter";
export type { HomographyFieldCalibratorOptions } from "./calibration/homography-adapter";
export {
  LINE_BASED_FIELD_CALIBRATOR_ADAPTER_VERSION,
  LINE_BASED_FIELD_CALIBRATOR_FAILURE_CLASSES,
  LINE_BASED_FIELD_CALIBRATOR_ID,
  LINE_BASED_FIELD_CALIBRATOR_RESOURCES,
  LINE_BASED_FIELD_CALIBRATOR_VERSION,
  LineBasedFieldCalibrator,
} from "./calibration/line-based";
export type { LineBasedFieldCalibratorOptions } from "./calibration/line-based";
// R206 candidate.
export {
  JERSEY_COLOR_TEAM_ASSIGNER_ADAPTER_VERSION,
  JERSEY_COLOR_TEAM_ASSIGNER_FAILURE_CLASSES,
  JERSEY_COLOR_TEAM_ASSIGNER_ID,
  JERSEY_COLOR_TEAM_ASSIGNER_RESOURCES,
  JERSEY_COLOR_TEAM_ASSIGNER_VERSION,
  JERSEY_COLOR_METHOD,
  JerseyColorTeamAssigner,
} from "./team/jersey-color";
export type { JerseyColorTeamAssignerOptions } from "./team/jersey-color";
// Benchmarks + fixtures.
export {
  FIXTURE_SET_VERSION,
  generateBallFixture,
  generateCalibrationFixture,
  generateDetectionFixture,
  generateTeamFixture,
} from "./benchmark/fixtures";
export type {
  BallFixtureFrame,
  BallFixtureSpec,
  CalibrationFixtureFrame,
  CalibrationFixtureSpec,
  DetectionFixtureFrame,
  DetectionFixtureSpec,
  FixturePlayerSpec,
  TeamFixtureFrame,
  TeamFixtureSpec,
  TeamPlayerSpec,
  TrackingDegradeSpec,
  TrackingFixtureSpec,
} from "./benchmark/fixtures";
export { detectionSequenceFromFixture } from "./benchmark/fixtures";
export {
  DEFAULT_BENCHMARK_CLOCK,
  buildBenchmarkRun,
  constantClock,
  loadSpecFile,
  metricDeltaPct,
  realClock,
} from "./benchmark/run";
export type { BenchmarkClock } from "./benchmark/run";
export { runDetectionFamilyBenchmark } from "./benchmark/detection";
export type { DetectionFamilyBenchmarkOptions } from "./benchmark/detection";
export { runTrackingFamilyBenchmark } from "./benchmark/tracking";
export type { TrackingFamilyBenchmarkOptions, TrackingScenarioSpec } from "./benchmark/tracking";
export { runBallFamilyBenchmark, runBallDetectionFamilyBenchmark } from "./benchmark/ball";
export type {
  BallDetectionFamilyBenchmarkOptions,
  BallFamilyBenchmarkOptions,
} from "./benchmark/ball";
export { runCalibrationFamilyBenchmark } from "./benchmark/calibration";
export type { CalibrationFamilyBenchmarkOptions } from "./benchmark/calibration";
export { runTeamFamilyBenchmark } from "./benchmark/team";
export type { TeamFamilyBenchmarkOptions } from "./benchmark/team";
// Shared pixel utilities + the synthetic painter (public for downstream
// fixture authors).
export {
  blobAspectRatio,
  blobCompactness,
  brightness,
  connectedComponents,
  cropMeanColor,
  isBrightWhite,
  isPitchGreen,
  normalizedBoxCenter,
  pixelAt,
  pixelBoundsToNormalizedBox,
} from "./pixels";
export type { PixelBlob, Rgb } from "./pixels";
export {
  SYNTH_BACKGROUND,
  SYNTH_LINE_WHITE,
  SYNTH_PITCH_GREEN,
  SYNTH_WHITE,
  SyntheticFrame,
  makeDetectorFrameInput,
} from "./synth";
// Input validation helpers (public for pipeline adapters).
export { validateDetectionSequence, validatePresentationOrderedSequence } from "./validate";
