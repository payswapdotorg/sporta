/**
 * @sporta/eval-harness — the W801 evaluation harness.
 *
 * The work item's accept criterion made executable: "repeatable benchmark
 * suite produces machine-readable reports." ONE declarative suite config
 * runs the three existing evaluators — W403 replay comparability
 * (`@sporta/evaluation`), W503 temporal consistency
 * (`@sporta/renderer-evaluation`), W601 scene conformance
 * (`@sporta/scene-projection`) — as ONE repeatable suite, in-process against
 * the real packages, and produces ONE canonical, versioned,
 * schema-validated, machine-readable aggregate report.
 *
 * - `suite-config`: the declarative, versioned, strictly-validated suite
 *   definition (named cases with fixture inputs + policies; unknown case
 *   kinds/keys fail loud; NO defaults);
 * - `runner`: `runSuite` — per-case results (verdict, measured values
 *   VERBATIM from the evaluator, thresholds verbatim, injected-clock reads),
 *   crash containment (a crashing case is a FAILED case result with the
 *   error class + message; the suite continues; nothing is swallowed), and
 *   the STRICTLY CONJUNCTIVE aggregate (no weights, no averaging);
 * - `report` + `validate`: the versioned report shape and its fail-loud
 *   structural self-check (unknown keys, inconsistencies, non-conjunction
 *   all throw);
 * - `environment`: HONEST deterministic environment facts (runtime package
 *   versions measured from the workspace; no wall clock, no hostname, no
 *   random, no runtime version — see `src/environment.ts` for why);
 * - `clock`: the injected-clock seam (the report's only timestamps);
 * - CLI: `bun run evaluate` (exit 0 all-PASS / 1 FAIL verdict / 2
 *   usage-structural error, `--report <path>`, `--json`), with the
 *   checked-in golden report + drift-detection tests and the explicit
 *   `regen-golden` discipline (see README).
 *
 * Package boundary: runtime dependencies are `@sporta/*` only —
 * evaluation, renderer-evaluation, scene-projection, world-model, testing,
 * contracts. No external deps; no ambient clocks; no RNG anywhere.
 */
export {
  DEFAULT_CLOCK_EPOCH_MS,
  DEFAULT_CLOCK_STEP_MS,
  createDefaultClock,
  createStepClock,
} from "./clock";
export type { StepClockOptions, SuiteClock } from "./clock";
export {
  CASE_KINDS,
  DEFAULT_SUITE_PATH,
  SUITE_CONFIG_SCHEMA_TAG,
  loadSuiteConfig,
  validateSuiteConfig,
} from "./suite-config";
export type {
  CaseKind,
  LoadedSuite,
  SuiteCaseConfig,
  SuiteConfig,
  W403CaseConfig,
  W503CaseConfig,
  W601CaseConfig,
} from "./suite-config";
export { ENVIRONMENT_PACKAGE_KEYS, measurePackageVersions } from "./environment";
export { DEFAULT_GOLDEN_REPORT_PATH, REPORT_SCHEMA_TAG } from "./report";
export type {
  CaseClockReads,
  CaseError,
  SuiteAggregate,
  SuiteCaseResult,
  SuiteReport,
  W403CaseResult,
  W503CaseResult,
  W601CaseResult,
} from "./report";
export { runSuite, serializeSuiteReport } from "./runner";
export type { RunSuiteOptions } from "./runner";
export { assertSuiteReportShape } from "./validate";
export { projectEvaluationReport, runW403Case, W403_TOLERANCE_DOCUMENT } from "./cases/w403";
export type {
  W403CaseComparisonOutcome,
  W403CaseMeasured,
  W403CaseRunRecord,
  W403CaseThresholds,
} from "./cases/w403";
export { runW503Case } from "./cases/w503";
export type { W503CaseMeasured, W503CaseThresholds, W503DetectionProofEntry } from "./cases/w503";
export {
  W601_RULE_DOCUMENT,
  W601_SCENE_FIXTURE_KIND,
  loadW601SceneFixture,
  runW601Case,
} from "./cases/w601";
export type { W601CaseMeasured, W601CaseThresholds, W601SceneFixture } from "./cases/w601";
export { W601_FIXTURE_NOW_MS, W601_FIXTURE_SESSION, buildW601SceneFixture } from "./w601-fixture";
export type { W601SceneFixtureInput } from "./w601-fixture";
export type { CaseContext, CaseOutcome, CaseVerdict } from "./cases/types";
