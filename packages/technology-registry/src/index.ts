/**
 * @sporta/technology-registry — the Technology Registry & Evaluation Plane
 * (R001-R005, ADR-009 / docs/architecture/technology-plane.md).
 *
 * The evaluation foundation every other lane (media/compute/rendering)
 * registers through:
 *
 * - `registry/` (R001): candidate registration, versioned profile records
 *   with the fail-closed lifecycle rules, and the `resolveTaskProfile`
 *   seam later waves call at runtime;
 * - `store/` (R001): the persistence port with in-memory and SQLite
 *   (`bun:sqlite`) implementations behind one interface (the
 *   `@sporta/session` repository pattern);
 * - `fixtures/` (R002): the versioned `FixtureSet` contract, the canonical
 *   football fixture-set manifest (real, clearly-licensed footage +
 *   clearly-labeled synthetic diagnostics), and the `evaluation-only`
 *   license flag;
 * - `evaluation/` (R003): `runBenchmark` / `rerunBenchmark` (seeded,
 *   injected-clock, honest-cost) producing frozen `BenchmarkRun` records,
 *   plus machine-readable `EvaluationReport` comparison outputs (manual
 *   and deterministic-policy paths);
 * - `license/` (R004): the license review registry and the fail-closed
 *   promotion gate (`blockingLicenseIssues` non-empty => REFUSED);
 * - `promotion/` (R005): the audited promotion pipeline (legal transition +
 *   evidence + license gates) and `promotionHistory`.
 *
 * All contracts come from the frozen `@sporta/contracts` Wave-0 freeze
 * (schemaVersion 1.1); this package never redefines them.
 */
export {
  InMemoryTechnologyRegistryStore,
  type TechnologyRegistryStore,
  type TechnologyTriple,
  tripleKey,
} from "./store/store";
export { SqliteTechnologyRegistryStore } from "./store/sqlite-store";

export {
  TechnologyRegistry,
  deepEqual,
  type ProfileFilter,
  type RegistrationResult,
} from "./registry/technology-registry";
export {
  ACTIVE_TECHNOLOGY_STATUSES,
  STATUS_RANK,
  resolveTaskProfileAgainst,
  type NoCandidateResolution,
  type ResolvedTaskProfile,
  type TaskProfileRef,
  type TaskProfileResolution,
  type UnresolvablePreferenceResolution,
} from "./registry/resolution";

export {
  FixtureEntry,
  FixtureMediaKind,
  FixtureScenarioTag,
  FixtureSet,
  coveredScenarioTags,
  isEvaluationOnly,
  parseFixtureEntry,
  parseFixtureSet,
  type FixtureEntry as FixtureEntryDoc,
  type FixtureMediaKind as FixtureMediaKindDoc,
  type FixtureScenarioTag as FixtureScenarioTagDoc,
  type FixtureSet as FixtureSetDoc,
} from "./fixtures/fixture-set";
export {
  DEFAULT_FIXTURE_SET_VERSION,
  REAL_FOOTAGE_CANDIDATES,
  loadDefaultFixtureSet,
  verifyDefaultFixtureSetMedia,
  type RealFootageCandidate,
} from "./fixtures/default-fixture-set";

export {
  buildEvaluationReport,
  candidateKeyOf,
  recommendFromRuns,
  type BuildEvaluationReportParams,
  type ComparisonPolicy,
  type RecommendFromRunsParams,
} from "./evaluation/report";
export {
  computeRerunDeltaPct,
  metricDeltaPct,
  rerunBenchmark,
  runBenchmark,
  type AdapterRunner,
  type FixtureExecutionOutcome,
  type FixtureRunnerContext,
  type RerunBenchmarkResult,
  type RunBenchmarkParams,
} from "./evaluation/runner";

export {
  LicenseRegistry,
  LicenseReviewComponent,
  LicenseReviewRecord,
  assertPromotableLicense,
  licenseGateIssues,
  parseLicenseReviewDocument,
  type LicenseReviewComponent as LicenseReviewComponentDoc,
  type LicenseReviewRecord as LicenseReviewRecordDoc,
} from "./license/license-registry";

export { PromotionPipeline } from "./promotion/promotion-pipeline";

export {
  EvaluationValidationError,
  IllegalProfileStatusError,
  PromotionEvidenceError,
  PromotionLicenseError,
  PromotionTransitionError,
  RegistryConflictError,
  RegistryValidationError,
  TechnologyNotFoundError,
  TechnologyRegistryError,
  type TechnologyRegistryFailureClass,
} from "./errors";
