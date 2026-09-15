/**
 * @sporta/quality-gates — the W803 release gate suite.
 *
 * Work item W803 (M7): *"release gates include temporal stability, scene
 * correctness, and human/automated quality checks."* This package is the
 * COMPOSITION layer: it imports and runs the REAL public evaluations of
 * the two completed evaluation packages — W503 `@sporta/renderer-evaluation`
 * (temporal stability) and W605 `@sporta/scene-evaluation` (scene
 * correctness) — adds the fail-closed human review gate and the
 * never-silent accounting gate, and produces ONE deterministic release
 * verdict. It re-implements nothing and defines ZERO new numeric quality
 * thresholds: every machine-gate threshold belongs to (and is carried
 * verbatim from) the source packages' own pinned threshold documents.
 *
 * Canonical documents:
 *
 * - `docs/GATES.md` — the versioned gate policy (blocking/advisory,
 *   not-runnable semantics, verdict rules, report shape, §boundaries),
 *   pinned row-for-row to `src/policy.ts` both directions;
 * - `docs/REVIEW.md` — the human review checklist and record contract,
 *   pinned to `src/review.ts` both directions.
 *
 * Public surface:
 *
 * - {@link evaluateReleaseReadiness} — the release evaluation (pure,
 *   deterministic, byte-identical reports);
 * - {@link serializeReleaseReport} — the canonical serialization;
 * - the gate runners and the ledger reconciliation (exported for the
 *   detection teeth — see `test/detection.test.ts`);
 * - {@link buildDemoReleaseInput} — the fixture demo run over the repo's
 *   real fixtures (the CLI, `bun run gate`, is the entry point).
 *
 * Package boundary: runtime dependencies are `@sporta/renderer-evaluation`
 * and `@sporta/scene-evaluation` only — no clock reads, no RNG, no I/O in
 * the measurement core (pinned by `test/boundary.test.ts`).
 */
export { QualityGateError } from "./errors";
export type { QualityGateErrorCode } from "./errors";
export { GATE_IDS, GATE_POLICY, GATE_POLICY_VERSION, validateGatePolicy } from "./policy";
export type { GateId, GatePolicy, GatePolicyEntry, NotRunnableOutcome } from "./policy";
export {
  HUMAN_REVIEW_CHECKLIST,
  HUMAN_REVIEW_CHECKLIST_VERSION,
  REVIEW_BOUNDS,
  REVIEW_RECORD_SCHEMA_TAG,
  SELF_CHECK_REVIEWER_ID,
  reviewRecordCompleteness,
  validateHumanReviewRecord,
} from "./review";
export type {
  HumanReviewChecklistResult,
  HumanReviewRecord,
  HumanReviewRecordStatus,
  ReviewChecklistItem,
  ReviewCompleteness,
} from "./review";
export {
  GATE_VERDICTS,
  buildAccountingRow,
  countGateVerdicts,
  reconcileGateRows,
  runHumanReviewGate,
  runSceneGate,
  runTemporalGate,
} from "./gates";
export type {
  CarriedCheck,
  GateKeyValue,
  GateReconciliation,
  GateSubEvaluation,
  GateVerdict,
  HumanReviewSection,
  ReleaseGateRow,
  SceneFixtureCase,
  SceneGateInput,
  TemporalFixtureCase,
  TemporalGateInput,
} from "./gates";
export { REPORT_SCHEMA_TAG, evaluateReleaseReadiness, serializeReleaseReport } from "./report";
export type { ReleaseOutcome, ReleaseReadinessInput, ReleaseReadinessReport } from "./report";
export {
  DEMO_HUMAN_REVIEW_RECORD_PATH,
  DEMO_SCENE_FIXTURES,
  DEMO_TEMPORAL_FIXTURE,
  buildDemoReleaseInput,
} from "./release";
