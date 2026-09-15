/**
 * @sporta/camera-director — the W604 camera director / event presentation.
 *
 * Work item W604: "event importance and commentary can influence
 * camera/replay emphasis deterministically enough to evaluate." This
 * package owns the DIRECTION side of the M6 chain (W601 projected the
 * scene and named the canonical camera slots; W602/W603 render from ONE
 * carried slot and leave the choosing to "W604"):
 *
 * - `policy`: the direction policy — a versioned, typed DATA document
 *   (possession-following default with zones + hysteresis, the pinned
 *   event-importance table, replay-emphasis configs) and the canonical
 *   `DEFAULT_DIRECTOR_POLICY` ("broadcast-classic")
 * - `validate`: `validatePolicy` — fail-closed structural validation of
 *   policy documents (config, not code: unknown keys ignored, every
 *   value rule test-pinned)
 * - `types`: the `CameraPlan` — the rundown of directed windows (source
 *   ranges, canonical slots, presentation kinds) with per-window DECISION
 *   RECORDS (rule + verbatim W209 candidate) and total candidate
 *   accounting — the W605 evaluation surface
 * - `direct`: `direct(policy, matchTimeline, events)` — the pure
 *   deterministic director function (same inputs → byte-identical plan)
 * - `selfcheck`: `checkCameraPlan(plan, steps)` — the invariant harness
 *   (one-selection-per-window, boundaries-respected, live-tiling-total,
 *   review-within-timeline, decision records, summary + accounting
 *   consistency) with stable violation ids; run by the tests AND by the
 *   composition's fail-closed admission
 * - `compose`: `render3dDirectedMatch(req, steps, plan)` — the
 *   composition with renderer-3d's match path: one `render3dMatch` call
 *   per directed window through the renderer's own
 *   `styleConfig.config.cameraSlotId` seam, stitched into one rundown
 *   (frames renumbered, reviews at the W603 review profile, manifest
 *   carrying the directed slots + plan provenance)
 * - `evaluate`: `planDecisionRecords(plan)` — the per-window decision
 *   records flattened for W605 scoring (which rule fired, which W209
 *   candidate drove it with confidence/emphasis verbatim), isolated from
 *   the plan document
 * - `errors`: `DirectorError` — the fail-loud admission error
 *
 * Honest boundaries (POLICY.md §7): a rule-table policy, not
 * cinematography AI; slot CUTS only (the slots are fixed W601 geometry —
 * no camera motion, no interpolation of camera positions); commentary
 * influence is W209's deterministic candidates only (no live STT); replay
 * emphasis re-presents existing match time at the W603 review profile and
 * authors no new content; the director is offline/hindsight (batch
 * direction for deterministic evaluation), never a live one.
 *
 * The normative decision record — the policy model, the direction
 * algorithm, the priority table, the composition contract, and the honest
 * boundaries — lives in POLICY.md next to this package's sources.
 */
export {
  DIRECTOR_POLICY_VERSION,
  DIRECTOR_VERSION,
  DEFAULT_DIRECTOR_POLICY,
  GOAL_SIDE_SPLIT_X_METERS,
  STATIC_SLOT_SELECTORS,
  FOCUS_SLOT_SELECTORS,
} from "./policy";
export type {
  DirectorPolicy,
  EventFocusRule,
  FocusSlotSelector,
  PossessionFollowConfig,
  ReplayConfig,
} from "./policy";
export { validatePolicy } from "./validate";
export type { PolicyValidation } from "./validate";
export type {
  CameraPlan,
  CameraPlanSummary,
  DirectedWindow,
  DirectorRuleId,
  EventAccountingEntry,
  EventCandidateOutcome,
  EventDecisionRef,
  PossessionDecisionInputs,
  PresentationKind,
  SuppressedCut,
  WindowDecision,
} from "./types";
export { direct } from "./direct";
export { checkCameraPlan } from "./selfcheck";
export type { PlanCheckResult } from "./selfcheck";
export { planDecisionRecords } from "./evaluate";
export type { PlanDecisionRecord } from "./evaluate";
export { REVIEW_OUTPUT_PROFILE, render3dDirectedMatch } from "./compose";
export type {
  DirectedFrameEntry,
  DirectedRenderManifest,
  DirectedRenderOutput,
  DirectedSkippedMarker,
  DirectedWindowEntry,
} from "./compose";
export { DirectorError } from "./errors";
export type { DirectorErrorKind } from "./errors";
