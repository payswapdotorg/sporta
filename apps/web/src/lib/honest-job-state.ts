/**
 * HONEST JOB-STATE PRESENTATION (R502) — the ONE derived, deterministic,
 * test-pinned mapping from the control plane's REAL job projections onto
 * what the UI may display.
 *
 * HONESTY CONTRACT (every rule test-pinned):
 * - every visible state maps 1:1 to a server state — the closed W914
 *   vocabulary (`admitted/dispatched/queued/in-flight/succeeded/failed/
 *   cancelled/dead-lettered`) plus the studio's own honest boundary marker
 *   `unreadable` (a compute read that refused — never a guessed state);
 * - no interpolated/fake progress: the only fraction any surface may show
 *   is the last METERED fraction (the compute ledger's progress events, the
 *   media job's stage table) — `null` when nothing was metered;
 * - failure and cancellation are FIRST-CLASS visible states: `cancelled`
 *   is its own phase (never a generic spinner, never "failed"), and the
 *   typed reasons (error class + message + terminal disposition) are
 *   carried VERBATIM from the server;
 * - an unknown state is NEVER displayed as a known one (fail-closed
 *   presentation: the raw state stays visible inside an explicit
 *   unknown-state label).
 *
 * This module maps server-projected state onto presentation ONLY — the UI
 * components render what these functions derive, nothing else.
 */

// ---------------------------------------------------------------------------
// The closed vocabularies (structural mirrors of the server's own)
// ---------------------------------------------------------------------------

/**
 * The closed W914 compute-job state vocabulary — verbatim the control
 * plane's own (`@sporta/compute-adapter` COMPUTE_JOB_STATES), which the
 * media pipeline's job ledger shares (R103). The ONLY states a server
 * projection may report as live/terminal dispositions.
 */
export const HONEST_COMPUTE_STATES = [
  "admitted",
  "dispatched",
  "queued",
  "in-flight",
  "succeeded",
  "failed",
  "cancelled",
  "dead-lettered",
] as const;
export type HonestComputeState = (typeof HONEST_COMPUTE_STATES)[number];

/** The terminal dispositions (no outgoing edges — exactly one per job). */
export const HONEST_TERMINAL_STATES = [
  "succeeded",
  "failed",
  "cancelled",
  "dead-lettered",
] as const;

/** The studio's honest boundary marker (a compute read that refused). */
export const HONEST_UNREADABLE_STATE = "unreadable" as const;

// ---------------------------------------------------------------------------
// The presentation (deterministic, total, fail-closed)
// ---------------------------------------------------------------------------

/** The honest phases a surface may display. */
export type HonestJobPhase = "processing" | "ready" | "failed" | "cancelled" | "unreadable";

/** One job state's pinned presentation. */
export interface HonestJobPresentation {
  /** The honest phase (cancelled is first-class — never folded into failed). */
  phase: HonestJobPhase;
  /** The deterministic label (carries the server's state verbatim). */
  label: string;
  /** The server's state VERBATIM (the raw projection string). */
  state: string;
  /** `true` once the job reached any terminal disposition (or the boundary). */
  terminal: boolean;
  /** Whether the state is inside the closed vocabulary (never smoothed). */
  known: boolean;
}

/**
 * Maps ONE real compute-job state (the `getComputeJob` projection) onto the
 * pinned presentation. Total and deterministic: the same state always
 * yields the same presentation, and every member of the closed vocabulary
 * has its own entry (pinned by tests).
 */
export function honestComputePresentationOf(state: string): HonestJobPresentation {
  switch (state) {
    case "admitted":
    case "dispatched":
    case "queued":
      return {
        phase: "processing",
        label: `Queued on the compute plane (${state})`,
        state,
        terminal: false,
        known: true,
      };
    case "in-flight":
      return {
        phase: "processing",
        label: "Rendering (in flight)",
        state,
        terminal: false,
        known: true,
      };
    case "succeeded":
      return {
        phase: "ready",
        label: "Render complete",
        state,
        terminal: true,
        known: true,
      };
    case "failed":
      return {
        phase: "failed",
        label: "Render failed",
        state,
        terminal: true,
        known: true,
      };
    case "cancelled":
      return {
        phase: "cancelled",
        label: "Render cancelled",
        state,
        terminal: true,
        known: true,
      };
    case "dead-lettered":
      return {
        phase: "failed",
        label: "Render dead-lettered",
        state,
        terminal: true,
        known: true,
      };
    case HONEST_UNREADABLE_STATE:
      return {
        phase: "unreadable",
        label:
          "The compute ledger could not be read (the state is unknown — never claimed as anything)",
        state,
        terminal: true,
        known: true,
      };
    default:
      // An unknown state fails closed into the presentation: the raw state
      // stays visible, never displayed as a known state, never spun over.
      return {
        phase: "failed",
        label: `Unknown job state '${state}' (fail-closed presentation)`,
        state,
        terminal: true,
        known: false,
      };
  }
}

/**
 * Maps ONE real media-job state (the `MediaJobView` projection — the same
 * W914 vocabulary the media pipeline's ledger reports) onto the pinned
 * presentation, with the media pipeline's own labels (the normalization +
 * original-artifact stages).
 */
export function honestMediaPresentationOf(state: string): HonestJobPresentation {
  const compute = honestComputePresentationOf(state);
  if (!compute.known) return compute; // the fail-closed unknown presentation
  switch (state) {
    case "admitted":
    case "dispatched":
    case "queued":
      return { ...compute, label: `Media job queued (${state})` };
    case "in-flight":
      return { ...compute, label: "Normalizing the upload (in flight)" };
    case "succeeded":
      return { ...compute, label: "Original artifact stored" };
    case "failed":
      return { ...compute, label: "The media job failed" };
    case "cancelled":
      return { ...compute, label: "The media job was cancelled" };
    case "dead-lettered":
      return { ...compute, label: "The media job was dead-lettered" };
    default:
      return compute;
  }
}

// ---------------------------------------------------------------------------
// Progress (metered fractions ONLY — never interpolated)
// ---------------------------------------------------------------------------

/** The compute job's metered progress events (the studio's own view shape). */
export interface HonestComputeJobLike {
  events: readonly { type: string; fraction?: number }[];
}

/** The media job's stage table (the media pipeline's own view shape). */
export interface HonestMediaJobLike {
  stages: readonly { stage: string; atMs: number; fraction: number }[];
}

/**
 * The last REAL metered progress fraction (0 < f ≤ 1) from a compute job's
 * progress events — or `null` when none was metered. NEVER interpolated,
 * never invented: a state the server has not reported is never displayed
 * as if it had.
 */
export function honestComputeProgressOf(job: HonestComputeJobLike): number | null {
  let fraction: number | null = null;
  for (const event of job.events) {
    if (event.type === "progress" && typeof event.fraction === "number") {
      fraction = event.fraction;
    }
  }
  return fraction;
}

/**
 * The media job's honest stage-derived fraction (the stage table the media
 * pipeline itself derives from ACTUAL stage completions — callers cannot
 * claim numbers), or `null` when the table carries no fraction.
 */
export function honestMediaProgressOf(job: HonestMediaJobLike): number | null {
  const last = job.stages.at(-1);
  return last === undefined ? null : last.fraction;
}

// ---------------------------------------------------------------------------
// Typed failure reasons (carried VERBATIM — never a generic message)
// ---------------------------------------------------------------------------

/** The control plane's typed failure record (the completion view's shape). */
export interface HonestTypedFailure {
  errorClass: string;
  message: string;
  terminal: string;
}

/** The media pipeline's typed failure record (the job view's shape). */
export interface HonestMediaFailure {
  failureClass: string;
  message: string;
}

/**
 * One line carrying the control plane's typed failure VERBATIM:
 * `"<errorClass>: <message> (terminal: <terminal>)"` — the classes and
 * dispositions come from the server's own projection, never re-phrased
 * into a generic spinner message.
 */
export function honestFailureLineOf(failure: HonestTypedFailure): string {
  return `${failure.errorClass}: ${failure.message} (terminal: ${failure.terminal})`;
}

/** The media pipeline's typed failure, carried verbatim. */
export function honestMediaFailureLineOf(failure: HonestMediaFailure): string {
  return `${failure.failureClass}: ${failure.message}`;
}

/** The CSS state the state chip renders for a presentation (cancelled first-class). */
export type HonestChipState = "ready" | "processing" | "cancelled" | "unavailable" | "failed";

/** The state chip's CSS state for a presentation (cancelled is first-class). */
export function chipStateOf(presentation: HonestJobPresentation): HonestChipState {
  switch (presentation.phase) {
    case "ready":
      return "ready";
    case "processing":
      return "processing";
    case "cancelled":
      return "cancelled";
    case "unreadable":
      return "unavailable";
    case "failed":
      return presentation.known ? "failed" : "unavailable";
  }
}
