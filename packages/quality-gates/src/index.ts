/**
 * @sporta/quality-gates — the W803 visual quality gates: the release gate
 * suite that composes the REAL evaluations of the two completed evaluation
 * packages into one release verdict (work item W803: "release gates
 * include temporal stability, scene correctness, and human/automated
 * quality checks").
 *
 * Four accounted gates, one report:
 *
 * - **temporal stability** — `@sporta/renderer-evaluation`'s real
 *   `evaluateTemporalConsistency` (the `evaluateRenderOutput` /
 *   `evaluateTemporalConsistency` family) over its real fixture clip; the
 *   gate verdict IS that report's own verdict, and every threshold stays
 *   in (is referenced from) that package's pinned `thresholds.ts` /
 *   THRESHOLDS.md — this package defines ZERO new numeric thresholds;
 * - **scene correctness** — `@sporta/scene-evaluation`'s real
 *   `evaluateSceneOutput` over its real fixtures, verdict likewise;
 * - **human quality checks** — fail-closed human review: a documented
 *   checklist (docs/REVIEW.md), a checked-in JSON record format, and gate
 *   logic where a missing/malformed/incomplete record makes the release
 *   verdict `PENDING-HUMAN-REVIEW` — never `PASS`, never silently
 *   skipped;
 * - **gate accounting** — the never-silent ledger: every gate has its
 *   row, every `NOT-RUNNABLE` has its accounted reason, and the counts
 *   reconcile (`gates = pass + fail + not-runnable`); a gate that could
 *   not run (missing input, package error) counts as `FAIL`.
 *
 * {@link evaluateReleaseReadiness} is pure and deterministic — the same
 * input yields a byte-identical canonical JSON report (in-process and
 * across subprocesses, SHA-256-compared by tests). The overall verdict:
 * `PASS` only when every blocking gate passes AND the human record is
 * complete; `PENDING-HUMAN-REVIEW` when the machine gates pass but the
 * record is absent/incomplete; `FAIL` otherwise. Which gates exist and
 * how failures propagate is versioned POLICY DATA
 * (`src/gatePolicy.ts` ↔ docs/GATES.md, pinned both directions by
 * tests) — no gate privileges in scattered `if`s.
 *
 * CLI: `bun run gate` (scripts/gate.ts) — evaluates the fixture demo,
 * writes the deterministic report, and prints the literal marker line
 * `SPORTA-RELEASE-GATE <verdict>`.
 *
 * Package boundary: runtime dependencies are
 * `@sporta/renderer-evaluation` and `@sporta/scene-evaluation` only —
 * this package REIMPLEMENTs nothing and MEASUREs nothing new (the machine
 * gates measure exactly what W503/W605 measure); no clock reads, no RNG,
 * no I/O in the evaluation core.
 */
// The fail-loud error + its code vocabulary.
export { QualityGatesError } from "./errors";
export type { QualityGatesErrorCode } from "./errors";
// The versioned gate policy (data, not ifs) + its self-check.
export {
  ACCOUNTING_GATE_ID,
  GATE_POLICY,
  GATE_POLICY_ID,
  HUMAN_GATE_ID,
  assertGatePolicyWellFormed,
  policyEntryOf,
} from "./gatePolicy";
export type { GatePolicyEntry, NotRunnableOutcome } from "./gatePolicy";
// The structural bounds (the only numeric constants — not quality thresholds).
export { STRUCTURAL_BOUNDS, STRUCTURAL_BOUNDS_ID, structuralBound } from "./bounds";
export type { StructuralBound } from "./bounds";
// The canonical JSON serializer (the byte-determinism contract).
export { canonicalJsonStringify } from "./canonicalJson";
// The human-review checklist + the fail-closed record inspector.
export {
  CHECKLIST_VERSION,
  HUMAN_RECORD_SCHEMA_TAG,
  REVIEW_CHECKLIST,
  inspectHumanReviewRecord,
} from "./humanReview";
export type {
  ChecklistItem,
  HumanRecordKind,
  HumanReviewInspection,
  HumanReviewStatus,
  ParsedHumanReviewRecord,
  ParsedRecordItem,
  RecordIssue,
} from "./humanReview";
// The shared gate-row vocabulary.
export type { AccountedError, GateRowBase, GateVerdict } from "./gateRow";
export { describeThrownError } from "./gateRow";
// The individual gates (pure runners; each returns its accounted row).
export { runTemporalGate } from "./temporalGate";
export type {
  TemporalGateEvidence,
  TemporalGateInput,
  TemporalGateMeasured,
  TemporalGateNotRun,
  TemporalGateRow,
} from "./temporalGate";
export { runSceneGate } from "./sceneGate";
export type {
  SceneFixtureCase,
  SceneFixtureError,
  SceneFixtureEvidence,
  SceneGateEvidence,
  SceneGateMeasured,
  SceneGateNotRun,
  SceneGateRow,
} from "./sceneGate";
export { runHumanGate } from "./humanGate";
export type {
  HumanGateMeasured,
  HumanGateRow,
  HumanReviewItemRow,
  HumanReviewRecordSummary,
} from "./humanGate";
export {
  buildAccountingRow,
  computeLedger,
  evaluateAccountingGate,
  subjectGateIds,
} from "./accountingGate";
export type {
  AccountableRow,
  AccountingCheck,
  AccountingGateMeasured,
  AccountingGateRow,
  GateLedger,
} from "./accountingGate";
// The composition core.
export { REPORT_SCHEMA_TAG, deriveOverallVerdict, evaluateReleaseReadiness } from "./report";
export type {
  BlockingGateResult,
  GateRow,
  OverallVerdict,
  ReleaseGateInput,
  ReleaseReadinessReport,
  VerdictSection,
} from "./report";
// The fixture-demo default inputs (the human record stays caller-supplied).
export { TEMPORAL_FIXTURE_CASE_NAME, buildDefaultReleaseInputs } from "./defaultInputs";
