/**
 * @sporta/evaluation — the M2 replay/evaluation harness (work item W403).
 *
 * The accept criterion made executable: "a fixed fixture produces comparable
 * world-model outputs across runs with documented tolerance."
 *
 * - `fixture`: loads the CHECKED-IN, byte-stable W403 fixture (sha256-pinned;
 *   never regenerated) — W206-shaped pitch track observations + W209-shaped
 *   commentary event candidates;
 * - `pipeline`: `runFixtureEvaluation` — one deterministic walk
 *   fixture → W005 store → W401 fusion (first + idempotent refusion) → W402
 *   temporal outputs (`stateAt`, `eventWindow`, `replayForward`) → the
 *   canonical {@link WorldModelArtifact};
 * - `serialize`: `serializeArtifact` — canonical bytes (sorted keys, full
 *   float precision, NaN/undefined rejected with the JSON path);
 * - `compare`: `compareWorldModelArtifacts` / `deepCompare` — the
 *   field-classified deep comparator (EXACT / EPSILON / COUNT / SET;
 *   unclassified paths FAIL LOUD with their JSON path; NaN and
 *   undefined-vs-missing flagged explicitly);
 * - `runner`: `runCrossRunEvaluation` — the cross-run runner (separate bun
 *   subprocesses, pairwise + checked-in-golden comparison);
 * - `shape`: `assertArtifactShape` — the structural self-check (unknown keys
 *   fail loud before serialization).
 *
 * The tolerance contract — every field's class and rationale, the policy, and
 * the golden-regeneration procedure — is `packages/evaluation/TOLERANCE.md`.
 */
export { ARTIFACT_SCHEMA, FIXTURE_KIND } from "./artifact";
export type { FixtureSpec, WorldModelArtifact } from "./artifact";
export { assertArtifactShape } from "./shape";
export { DEFAULT_FIXTURE_PATH, loadFixture } from "./fixture";
export type { LoadedFixture } from "./fixture";
export { runFixtureEvaluation } from "./pipeline";
export type { PipelineResult } from "./pipeline";
export { canonicalizeValue, serializeArtifact } from "./serialize";
export {
  DEFAULT_EPSILON,
  W403_ARTIFACT_CLASSIFICATION,
  compareWorldModelArtifacts,
  deepCompare,
} from "./compare";
export type {
  ClassificationRule,
  ComparisonReport,
  ComparisonSummary,
  FieldClass,
  FieldDiff,
  ToleranceSpec,
} from "./compare";
export {
  DEFAULT_GOLDEN_PATH,
  DEFAULT_RUNS,
  RUN_ONCE_SCRIPT,
  renderComparisonReport,
  runCrossRunEvaluation,
} from "./runner";
export type { ComparisonOutcome, EvaluationReport, RunRecord, RunnerOptions } from "./runner";
