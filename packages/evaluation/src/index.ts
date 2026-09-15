/**
 * @sporta/evaluation — the replay/evaluation harness (work item W403).
 *
 * The accept criterion made executable: "a fixed fixture produces
 * comparable world-model outputs across runs with documented tolerance."
 *
 * - `tolerance`: the DOCUMENTED tolerance spec — every default epsilon
 *   named, exported, and rationalized; the per-field-class comparison
 *   rules; and the exclusion rules (`generatedAtMs`,
 *   `watermark.sequence` — the W402-documented replay-vs-live differences),
 *   which the comparator records as visible, never-failing entries.
 * - `fixture`: the FIXED evaluation fixture — one frozen, hand-built,
 *   deterministic input (W206-shaped tracks + W209-shaped commentary
 *   candidates) plus the `mutateFixturePosition` negative-test helper.
 * - `compare`: `compareSnapshots` — the field-classified structural walk
 *   over two `WorldSnapshot`s (report, never throw; entity union; football
 *   state; excluded-by-rule fields recorded).
 * - `evaluate`: `runReplayEvaluation` — the harness that runs the whole
 *   W005→W401→W006→W402 chain repeatedly over the fixed fixture and
 *   pairwise-proves cross-run comparability (final snapshots, a mid-run
 *   checkpoint pair, and exact fusion-report equality); `evaluateFixture`
 *   drives the same chain once (the mutation tests' entry point).
 */
export {
  DEFAULT_CONFIDENCE_EPSILON,
  DEFAULT_EXCLUDED_FIELDS,
  DEFAULT_POSITION_EPSILON_M,
  DEFAULT_TIME_EPSILON_MS,
  DEFAULT_TOLERANCE,
  isExcludedField,
  validateToleranceSpec,
} from "./tolerance";
export type { ToleranceSpec } from "./tolerance";
export {
  BALL_OCCLUSION_GAP,
  CANDIDATE_EVENT_TYPES,
  CANDIDATE_GRID_STEP_MS,
  EVALUATION_ENTITY_LEXICON,
  EVALUATION_LAST_EVENT_TIME_MS,
  EVALUATION_SESSION_ID,
  TRACK_FRAME_COUNT,
  TRACK_FRAME_STEP_MS,
  TRACK_START_MS,
  buildEvaluationFixture,
  mutateFixturePosition,
} from "./fixture";
export type { EvaluationFixture } from "./fixture";
export { compareSnapshots, valuesEqual } from "./compare";
export type { FieldDiff, SnapshotDiff } from "./compare";
export {
  DEFAULT_RUNS,
  EVALUATION_ENGINE_NOW_MS,
  EVALUATION_FOOTBALL_INIT,
  evaluateFixture,
  runReplayEvaluation,
} from "./evaluate";
export type {
  EvaluationOptions,
  EvaluationReport,
  EvaluationRunResult,
  PairwiseKind,
  PairwiseRecord,
} from "./evaluate";
