/**
 * @sporta/slo — the W802 latency SLO machinery (M7): SLO definitions, alert
 * thresholds, and failure/degradation policies, formalized from W306's
 * measured evidence.
 *
 * THE WORK ITEM, MADE EXECUTABLE: "SLOs, alert thresholds, and
 * failure/degradation policies exist."
 *
 * ## What this package is (and is not)
 *
 * - **It IS the normative formalization** of `@sporta/latency-benchmark`'s
 *   measured evidence: 16 latency objectives (12 batch-stage — the W306 SLO
 *   candidates ADOPTED VERBATIM, pinned equal by test — plus 4 frame-stage
 *   objectives derived from W306's measured frame evidence by a documented
 *   formula), a 33-entry alert catalog with severity tiers and documented
 *   derivations (32 latency alerts + the loss-integrity alert), and a
 *   4-entry degradation policy table whose triggers PARTITION the catalog —
 *   every alert (warnings included) is answered by exactly one policy naming
 *   the real machinery that exists in this repository — `test/policies.test.ts`
 *   fails if any named seam stops existing (fail-closed, no dangling
 *   references).
 * - **It is NOT a monitoring daemon.** Nothing here watches a live system:
 *   the compliance window is ONE benchmark run (the injected-clock domain —
 *   SLOs.md §Scope carries W306's boundary verbatim: algorithmic latency
 *   structure, never wall-clock or real-network SLOs). Evaluation is a PURE
 *   function over one window; W805 owns production dashboards, W804 owns
 *   analytics.
 * - **Zero wall-clock reads, zero RNG** anywhere in src (the constitution);
 *   runtime dependencies are exactly `zod` (the @sporta/contracts
 *   precedent). The real packages named by the policy table are dev
 *   dependencies, consumed ONLY by the consistency tests that prove the
 *   machinery exists.
 *
 * ## The honest SLO semantics (SLOs.md is the normative document)
 *
 * One SLO = "the nearest-rank `metric` of `stage` over one compliance window
 * must be <= `targetMs` (injected-clock ms)". The error budget is the exact
 * percentile semantics: a p95 target holds iff at most 5% of the window's
 * samples exceed the target; a p50 target, at most 50%. There is no rolling
 * multi-window compliance — that requires production telemetry this
 * repository does not have yet (the documented operational gap; W805).
 *
 * ## Module map
 *
 * - `errors`: the typed fail-loud error surface;
 * - `input`: the versioned, strict zod input schema + the structural
 *   projector from a W306 benchmark report;
 * - `slos`: `SLO_DEFINITIONS` — the formalized objectives, every number
 *   traceable to the W306 evidence;
 * - `alerts`: `ALERT_CATALOG` — the threshold definitions with severity
 *   tiers + the pure alert evaluation;
 * - `policies`: `DEGRADATION_POLICIES` — the alert→machinery mapping, honest
 *   about automatic vs operator-decision;
 * - `evaluate`: `evaluateSloCompliance` — the window verdict + the
 *   deterministic human summary.
 *
 * SLOs.md (this package) is the normative document; its tables are pinned
 * row-for-row to the code by tests (the W503 THRESHOLDS.md convention, both
 * directions — code and docs never drift apart silently). README.md is the
 * honest boundary index (package boundary, usage, module map).
 */
export {
  SLO_ERROR_CODES,
  SloError,
  SloInputValidationError,
  SloStageMissingError,
  SloTableInconsistentError,
  isSloError,
} from "./errors";
export type { SloErrorCode } from "./errors";

export {
  LATENCY_SLO_INPUT_SCHEMA_TAG,
  BATCH_STAGE_KEYS,
  FRAME_STAGE_KEYS,
  parseLatencySloInput,
  projectBenchmarkReport,
} from "./input";
export type {
  LatencySloInput,
  LatencyBenchmarkReportSubset,
  LatencyStatsSubset,
  BatchStageKey,
  FrameStageKey,
} from "./input";

export {
  SLO_SET_ID,
  BASELINE_SOURCE,
  FRAME_HEADROOM_RULE,
  SLO_DEFINITIONS,
  budgetFractionForMetric,
  frameTargetByRule,
  sloById,
  assertSloTableInvariants,
} from "./slos";
export type { SloDefinition } from "./slos";

export {
  ALERT_CATALOG_ID,
  LATENCY_ALERTS,
  LOSS_ALERT,
  ALERT_CATALOG,
  warnThresholdMs,
  evaluateLatencyAlerts,
  evaluateLossAlert,
  evaluateAlerts,
} from "./alerts";
export type {
  AlertSeverity,
  AlertKind,
  LatencyAlertDefinition,
  LossAlertDefinition,
  FiredLatencyAlert,
  FiredLossAlert,
  FiredAlert,
} from "./alerts";

export {
  POLICY_TABLE_ID,
  DEGRADATION_POLICIES,
  policyById,
  assertPolicyTableInvariants,
} from "./policies";
export type { AutomationLevel, MachinerySeam, DegradationPolicy } from "./policies";

export {
  evaluateSloCompliance,
  evaluateSloComplianceFromValue,
  renderComplianceSummary,
} from "./evaluate";
export type { SloVerdict, SloComplianceWindow, SloComplianceReport } from "./evaluate";
