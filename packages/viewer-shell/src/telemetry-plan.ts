/**
 * The W706 telemetry affordance plan — the PURE decision layer for what the
 * shell's playback-feedback UI shows. Same architecture rule as
 * `./dom-plan.ts` / `./selection-plan.ts`: every decision is a pure
 * function over the view-model, test-pinned headlessly; the bootstrap only
 * renders what the plan says.
 *
 * The affordance (the W706 accept-criterion "quality feedback is
 * observable" leg's user-facing surface):
 *
 * - the structured FEEDBACK buttons appear exactly while a PRESENTATION
 *   is mounted — a batch playback OR the W704 live stream (the user has
 *   something to rate) — offering the CLOSED vocabulary kinds with their
 *   human labels, in fixed order;
 * - the PRIVACY NOTE is a constant disclosure rendered alongside the
 *   buttons: what telemetry collects and what it can never carry;
 * - `status` mirrors whether a sink is wired (`not-configured` when the
 *   core runs without telemetry — the buttons are still offered? NO: with
 *   no sink, feedback dispatches into nothing; the affordance hides the
 *   buttons and shows only the honest status note).
 */
import type { ViewerViewModel } from "./viewer-core.ts";
import { USER_FEEDBACK_KINDS } from "./telemetry-events.ts";
import type { UserFeedbackKind } from "./telemetry-events.ts";

/** One offered feedback choice: the closed kind + its human label. */
export interface FeedbackChoice {
  kind: UserFeedbackKind;
  label: string;
}

/** The honest privacy disclosure (constant — pinned by test). */
export const TELEMETRY_PRIVACY_NOTE =
  "Viewer telemetry records playback lifecycle moments, errors, playback health, and the structured feedback you choose here — keyed only by the opaque session id. It never records user identities, free-form text, media content, source frames, or renderer payloads.";

/** The button labels for the closed feedback vocabulary (fixed order). */
const FEEDBACK_LABELS: Readonly<Record<UserFeedbackKind, string>> = {
  "playback-good": "Good",
  "playback-stalled": "Stalled",
  "playback-poor": "Poor",
};

/** The telemetry affordance the bootstrap renders (see the module docs). */
export interface TelemetryAffordance {
  /** Whether the feedback row is visible (a presentation is mounted AND a sink is wired). */
  visible: boolean;
  /** The offered feedback kinds + labels (fixed order; empty iff not visible). */
  feedbackChoices: FeedbackChoice[];
  /** Whether the viewer core was constructed with a telemetry sink. */
  status: "recording" | "not-configured";
  /** The privacy disclosure (always defined; rendered with the affordance). */
  privacyNote: string;
}

/** A presentation the feedback row may rate: a batch playback, or a live stream. */
function presentationMounted(view: ViewerViewModel): boolean {
  // The batch players own `view.playback`; the live player owns the live
  // section's `player` view-model (W704). Either one means the user is
  // watching something rateable.
  if (view.playback !== null) return true;
  return view.live.available && view.live.player !== null;
}

/**
 * Derives the telemetry affordance. Deterministic pure function — the same
 * view-model yields a deep-equal affordance (pinned by tests).
 */
export function telemetryAffordance(view: ViewerViewModel): TelemetryAffordance {
  const enabled = view.telemetry.enabled;
  const visible = enabled && presentationMounted(view);
  return {
    visible,
    feedbackChoices: visible
      ? USER_FEEDBACK_KINDS.map((kind) => ({ kind, label: FEEDBACK_LABELS[kind] }))
      : [],
    status: enabled ? "recording" : "not-configured",
    privacyNote: TELEMETRY_PRIVACY_NOTE,
  };
}
