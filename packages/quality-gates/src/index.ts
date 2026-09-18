/**
 * @sporta/quality-gates — the W803 visual quality gates (work item W803:
 * "release gates include temporal stability, scene correctness, and
 * human/automated quality checks").
 *
 * The release-gate suite that composes the REAL evaluations of the two
 * completed evaluation packages into one release verdict. This package
 * imports and runs their real public APIs; it re-implements NOTHING and
 * defines ZERO new numeric thresholds (the roadmap rule: a number without
 * measured evidence is an aspiration — and not a gate).
 *
 * Gates (docs/GATES.md is the normative policy document):
 * - **temporal-stability** — `@sporta/renderer-evaluation` (W503) over its
 *   real clean fixture; the gate verdict is that report's own verdict;
 * - **scene-correctness** — `@sporta/scene-evaluation` (W605) over its
 *   real match AND directed fixtures (both must pass);
 * - **visual-correctness** — the R307 gate over the R306 encoding plane
 *   (`@sporta/encoding`): the per-axis visual correctness (score / clock /
 *   player-identity continuity / event ordering / ball continuity + the
 *   MEASURED temporal stability) of a REAL encoded artifact over the MVP
 *   fixture envelope (the existing clean match + W503 + R301/R303/R304
 *   conformance fixtures) — added in `w803@2`;
 * - **human-review** — the fail-closed record gate: a missing, malformed,
 *   or incomplete record makes the release PENDING-HUMAN-REVIEW — never
 *   PASS, never silently skipped.
 *
 * `evaluateReleaseReadiness` is pure and deterministic (byte-identical
 * reports; in-process ×2 + cross-subprocess SHA-256 pinned). The
 * accounting is never silent: gates = pass + fail + not-runnable +
 * pending, reconciled on every report; a gate that cannot run counts as
 * FAIL for the verdict.
 *
 * CLI: `bun run gate` — runs the suite over the fixtures with the checked-in
 * demo record and prints `SPORTA-RELEASE-GATE <verdict>` (exit 1 on FAIL,
 * exit 2 on PENDING-HUMAN-REVIEW).
 *
 * Package boundary: runtime dependencies are
 * `@sporta/renderer-evaluation`, `@sporta/scene-evaluation`,
 * `@sporta/encoding`, `@sporta/renderer-3d`, `@sporta/renderer-tactical`,
 * `@sporta/renderer-contract`, and `zod` — pinned by test/boundary.test.ts.
 */
export { ReleaseGateError, type ReleaseGateErrorCode } from "./errors";
export { GATE_POLICY, GATE_POLICY_VERSION, HUMAN_CHECKLIST, type GatePolicyRow } from "./policy";
export {
  REVIEW_RECORD_TAG,
  HumanReviewRecordSchema,
  parseHumanReview,
  parseDemoRecord,
  humanReviewVerdict,
  DEMO_RECORD,
  type HumanReviewRecord,
  type HumanReviewStatus,
} from "./human";
export {
  runTemporalGate,
  runSceneGate,
  runHumanGate,
  runVisualCorrectnessGate,
  buildTemporalDefectFixture,
  type GateResult,
} from "./gates";
export {
  VISUAL_REPORT_SCHEMA_TAG,
  SPIKE_ABS_FLOOR,
  SPIKE_DEFINITION,
  SPIKE_RATIO,
  DEFAULT_VISUAL_GEOMETRY,
  buildDefaultVisualArtifact,
  buildDefaultVisualEnvelope,
  buildVisualFlickerArtifact,
  encodeSceneThroughEngine,
  evaluateVisualCorrectness,
  type ArtifactTemporalMeasurements,
  type VisualAxisResult,
  type VisualCorrectnessOptions,
  type VisualCorrectnessReport,
  type VisualFixtureEnvelope,
} from "./visual-correctness";
export {
  REPORT_SCHEMA_TAG,
  ReleaseReadinessReportSchema,
  evaluateReleaseReadiness,
  type ReleaseReadinessReport,
  type ReleaseReadinessOptions,
  type ReleaseOutcome,
} from "./report";
