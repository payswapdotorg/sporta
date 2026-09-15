/**
 * @sporta/quality-gates — the W803 release gate suite.
 *
 * Work item W803 (docs/work-items/work-items.md): *"release gates include
 * temporal stability, scene correctness, and human/automated quality
 * checks."* Dependencies (both COMPLETE and merged): W503
 * (`@sporta/renderer-evaluation`), W605 (`@sporta/scene-evaluation`).
 *
 * This package is the COMPOSITION layer — it re-implements nothing:
 *
 * - the **temporal stability gate** runs the real W503 evaluation
 *   (`evaluateRenderOutput` over `renderW503CleanFixture`) and adopts the
 *   source report's own verdict under the source package's pinned
 *   thresholds;
 * - the **scene correctness gate** runs the real W605 evaluation
 *   (`evaluateSceneOutput` over all three real fixtures) and adopts the
 *   conjunction of the source reports' own verdicts under the source
 *   package's pinned zero-thresholds;
 * - the **human quality checks gate** is fail-closed: a missing,
 *   malformed, or incomplete review record never passes and is never
 *   silently skipped (the release verdict becomes PENDING-HUMAN-REVIEW
 *   when the machine gates pass) — docs/REVIEW.md is the normative
 *   checklist and record format;
 * - the **accounting gate** is the never-silent ledger: every policy gate
 *   appears as exactly one report row, the buckets reconcile
 *   (`gates = pass + fail + not-runnable`), and a gate that could not run
 *   counts as FAIL with the reason — a gate that silently vanishes fails
 *   the release.
 *
 * The gate policy (which gates exist, which package owns each, which are
 * blocking vs advisory) is a versioned DATA document — `docs/GATES.md`
 * §1, mirrored by `src/policy.ts`, pinned row-for-row both directions by
 * `test/policy.test.ts` — never scattered ifs. The overall verdict:
 * `PASS` (every blocking gate passed AND the human record is complete),
 * `PENDING-HUMAN-REVIEW` (machine gates passed, human record
 * absent/malformed/incomplete), or `FAIL` (otherwise).
 *
 * {@link evaluateReleaseReadiness} is pure and deterministic: same input →
 * byte-identical canonical report ({@link canonicalReportBytes}) — pinned
 * twice in one process and across two subprocess invocations with
 * compared stdout hashes. The CLI (`bun run gate`) runs the canonical
 * fixture-based demo evaluation, writes the deterministic report, and
 * prints the verdict and the marker line `SPORTA-RELEASE-GATE <verdict>`.
 *
 * Package boundary: runtime dependencies are exactly
 * `@sporta/renderer-evaluation` and `@sporta/scene-evaluation` (the two
 * completed evaluation packages this suite composes) — no external deps,
 * no clock reads, no RNG, no I/O in src (pinned by `test/boundary.test.ts`).
 */
// The fail-loud error + its code vocabulary.
export { QualityGateError } from "./errors";
export type { QualityGateErrorCode } from "./errors";
// The versioned gate policy DATA document (docs/GATES.md §1's executable mirror).
export {
  ACCOUNTING_CHECK_IDS,
  GATE_POLICY,
  GATE_POLICY_ID,
  assertGatePolicyInvariants,
} from "./policy";
export type { GatePolicyDocument, GatePolicyEntry, GateRole, GateSeam } from "./policy";
// The human review checklists + the fail-closed record format (docs/REVIEW.md).
export {
  HUMAN_REVIEW_CHECKLIST,
  HUMAN_REVIEW_CHECKLIST_ID,
  HUMAN_REVIEW_RECORD_SCHEMA_TAG,
  MAX_CHECKLIST_RESULTS,
  MAX_FIXTURE_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_REVIEWER_FIELD_LENGTH,
  MAX_SCENE_RUNS,
  SELF_CHECK_CHECKLIST,
  SELF_CHECK_CHECKLIST_ID,
  checkChecklistCoverage,
  checklistForKind,
  validateHumanReviewRecord,
} from "./humanReview";
export type {
  ChecklistCoverage,
  ChecklistItemResult,
  ChecklistResultEntry,
  HumanReviewRecord,
  RecordKind,
  ReviewChecklist,
  ReviewChecklistItem,
} from "./humanReview";
// The release evaluation input envelope (validated fail-loud; the gate
// documents themselves are validated by the REAL downstream evaluators).
export { validateReleaseInputShape } from "./input";
export type { ReleaseEvaluationInput, SceneGateRunInput, TemporalGateInput } from "./input";
// The gate row model + the accounted reason vocabulary.
export { GATE_VERDICTS, runSubjectGates } from "./gates";
export type {
  CarriedCheck,
  ChecklistItemIdRef,
  GateReason,
  GateReasonCode,
  GateRow,
  GateRun,
  GateVerdict,
  HumanReviewDetail,
  HumanReviewFailureClass,
  HumanReviewProblem,
  SourceErrorEcho,
  SubjectGateRun,
} from "./gates";
// The never-silent ledger.
export { reconcileGateLedger } from "./accounting";
export type { AccountingCheck, AccountingReconciliation } from "./accounting";
// The canonical fixtures (the real W503/W605 fixtures assembled into one input).
export { SCENE_FIXTURE_IDS, TEMPORAL_FIXTURE_ID, buildCanonicalReleaseInput } from "./fixtures";
// The release readiness report + the evaluation entry point.
export {
  RELEASE_REPORT_SCHEMA_TAG,
  canonicalReportBytes,
  evaluateReleaseReadiness,
} from "./report";
export type {
  AccountingSection,
  HumanReviewSection,
  ReleaseEvaluationOptions,
  ReleaseReadinessReport,
  ReleaseVerdict,
} from "./report";
