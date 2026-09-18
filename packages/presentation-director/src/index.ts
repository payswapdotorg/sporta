/**
 * @sporta/presentation-director — the R305 event/camera presentation
 * director: the deterministic, IMPORTANCE-TRACEABLE presentation layer
 * that WRAPS the W604 camera director.
 *
 * Work item R305: "Deliver deterministic camera/presentation behavior
 * driven by event importance and commentary semantics." The W604 camera
 * director already directs WHICH window frames from WHICH canonical slot;
 * this package wraps it (never replaces it — the W604 `direct` runs
 * inside `present`, its `CameraPlan` rides in every presentation plan
 * VERBATIM) and adds the presentation layer:
 *
 * - `policy`: the presentation policy — a versioned, typed DATA document
 *   (the embedded W604 `DirectorPolicy` camera layer + the
 *   event-importance table + the commentary-semantic blend + the framing
 *   classes) and the canonical `DEFAULT_PRESENTATION_POLICY`
 *   (`broadcast-classic-presentation`)
 * - `validate`: `validatePresentationPolicy` — fail-closed structural
 *   validation (config, not code: unknown keys ignored, every value rule
 *   test-pinned, the camera layer delegated to the wrapped seam)
 * - `types`: the `PresentationPlan` — the wrapped `CameraPlan` VERBATIM
 *   plus per-window importance traces, presentation-kind decisions, and
 *   total candidate scoring — the evaluation surface
 * - `present`: `present(policy, steps, candidates)` — the pure,
 *   deterministic director function (same inputs → byte-identical plan),
 *   and the `PresentationDirector` class wrapper carrying one validated
 *   policy
 * - `selfcheck`: `checkPresentationPlan(plan, steps, policy?)` — the
 *   invariant harness (camera-plan-wrapped, one-selection-per-window,
 *   every-window-traced, accounting-reconciled, policy-consistency) with
 *   stable violation ids
 * - `errors`: `PresentationError` — the fail-loud admission error
 *
 * Honest boundaries: a rule-table presenter, not cinematography AI; the
 * camera direction itself is 100% the W604 seam's (wrapped, verbatim);
 * commentary influence is W209's deterministic candidates only (quoted
 * verbatim, never re-scored); the combined score is a documented linear
 * blend of the policy's importance weights and the candidate's verbatim
 * emphasis/confidence — every number in every trace traces to a policy
 * row or a verbatim candidate field, never to a hidden constant.
 */
export {
  DEFAULT_PRESENTATION_POLICY,
  PRESENTATION_DIRECTOR_VERSION,
  PRESENTATION_POLICY_VERSION,
  W209_EVENT_TYPES,
} from "./policy";
export type {
  EventImportanceRow,
  FramingClass,
  FramingRule,
  PresentationKindClass,
  PresentationPolicy,
  PresentationRuleId,
  SemanticBlendWeights,
} from "./policy";
export { validatePresentationPolicy } from "./validate";
export type { PresentationPolicyValidation } from "./validate";
export type {
  CandidatePresentationEntry,
  ImportanceContribution,
  PresentationKindDecision,
  PresentationPlan,
  PresentationPlanSummary,
  PresentationWindow,
  SemanticContribution,
  WindowImportanceTrace,
} from "./types";
export { present, PresentationDirector } from "./present";
export type { MatchTimelineStep, PresentationDirectorOptions } from "./present";
export { checkPresentationPlan } from "./selfcheck";
export type { PresentationCheckResult } from "./selfcheck";
export { PresentationError } from "./errors";
export type { PresentationErrorKind } from "./errors";
