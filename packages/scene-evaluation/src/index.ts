/**
 * @sporta/scene-evaluation — the W605 3D-output correctness benchmark.
 *
 * A STANDALONE benchmark (the W503 posture): six axes over the REAL
 * W601–W604 seams — score, clock, player identity continuity, event
 * ordering, scene state, and direction consistency — with zero-threshold
 * verdicts (the renderer under evaluation is a deterministic pure function
 * of its input documents, so any nonzero defect count is a real defect),
 * byte-deterministic machine-readable reports, and injected-defect teeth.
 *
 * Package boundary: runtime dependencies are `@sporta/contracts`,
 * `@sporta/scene-projection`, `@sporta/renderer-3d`,
 * `@sporta/camera-director`, `@sporta/commentary-understanding`,
 * `@sporta/temporal`, `@sporta/world-model`, `@sporta/testing` (fixtures),
 * and `zod` — no clock reads, no RNG, no I/O in the measurement core.
 *
 * Public surface:
 *
 * - {@link evaluateSceneOutput} — the evaluation entry point (validate,
 *   measure, verdict, findings);
 * - the report types ({@link SceneEvaluationReport}, {@link
 *   SceneEvaluationCheck}, {@link DimensionVerdict}) and the findings model
 *   ({@link SceneEvaluationFinding}, {@link FindingCollector});
 * - the per-axis measurement functions (pure, over the validated view);
 * - the deterministic fixtures ({@link buildCleanMatchFixture}, {@link
 *   buildCorrectionsMatchFixture}, {@link buildDirectedReviewFixture}) and
 *   the injected-defect teeth (the `inject*` functions);
 * - {@link THRESHOLDS} (mirrored row-for-row by THRESHOLDS.md, pinned both
 *   directions by `test/thresholds-doc.test.ts`).
 */
// The fail-loud error + its code vocabulary.
export { SceneEvaluationError } from "./errors";
export type { SceneEvaluationErrorCode } from "./errors";
// The findings model (bounded, accounted evidence).
export { FindingCollector, frameFinding } from "./findings";
export type { FindingSink, SceneEvaluationFinding } from "./findings";
// The input validator (fail-loud structural checks; the trusted view).
export { validateEvaluationInput } from "./validate";
export type { EvalFrame, ValidatedSceneEvaluationInput } from "./validate";
// The frame-expectation core (the renderer's own seams).
export { frameExpectation, expectedStyleKind, expectedStyleToken } from "./expected";
export type { FrameExpectation } from "./expected";
// The six axes + the source-truth layer.
export { measureSourceTruth } from "./truth";
export type { SourceTruthMetrics } from "./truth";
export { measureScore, measureClock } from "./scoreClock";
export type { ClockMetrics, ScoreMetrics } from "./scoreClock";
export { measureIdentity } from "./identity";
export type { IdentityMetrics } from "./identity";
export { measureOrdering } from "./ordering";
export type { OrderingMetrics } from "./ordering";
export { INTERPOLATION_TIME_EPSILON_MS, measureSceneState } from "./sceneState";
export type { SceneStateMetrics } from "./sceneState";
export { measureDirection } from "./direction";
export type { DirectionMetrics } from "./direction";
// The report: thresholds, verdict core, machine-readable contract.
export {
  evaluateSceneOutput,
  MAX_FINDINGS,
  REPORT_SCHEMA_TAG,
  SceneEvaluationReportSchema,
  THRESHOLDS,
} from "./report";
export type {
  DimensionVerdict,
  SceneEvaluationCheck,
  SceneEvaluationInput,
  SceneEvaluationReport,
  Thresholds,
} from "./report";
// The fixtures (deterministic, through the real seams).
export {
  buildCleanMatchFixture,
  buildCleanTimeline,
  buildCorrectionsMatchFixture,
  buildCorrectionsTimeline,
  buildDirectedReviewFixture,
  W605_CLEAN_SESSION_ID,
  W605_CORRECTIONS_SESSION_ID,
  W605_FIXTURE_NOW_MS,
} from "./fixture";
export type { DirectedReviewFixture, SceneEvaluationFixture } from "./fixture";
// The injected-defect teeth.
export {
  injectCameraBlockDrift,
  injectDroppedMarker,
  injectHeldWithoutDeclaredCut,
  injectMisDirectedWindow,
  injectOutOfOrderMarkers,
  injectSceneStateDrift,
  injectStuckClock,
  injectSwappedStyleTokens,
  injectWrongScoreClaim,
} from "./inject";
