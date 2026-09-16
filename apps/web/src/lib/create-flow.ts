/**
 * CREATE FLOW MODEL (W906) — the pure, client-safe state machine of the
 * Create Studio's guided flow.
 *
 * HONESTY BOUNDARY: every INPUT here is a server answer (the /api/create/*
 * routes' derivations over the real control plane); these functions only
 * MAP server state onto presentation. Rights semantics live in
 * `@sporta/contracts` (server-side); job states come from the real compute
 * ledger; progress fractions come from the real progress events only —
 * when nothing was metered, the answer is `null`, never an invented number.
 */
import type { RightsPreviewLike, StudioJobLike, StudioOptionsLike } from "./api-types";

// ---------------------------------------------------------------------------
// The guided-flow state
// ---------------------------------------------------------------------------

/** The guided steps, in order (ux-architecture: source → … → publish). */
export const CREATE_STEPS = ["source", "rights", "renderer", "recipe", "review", "render"] as const;
export type CreateStep = (typeof CREATE_STEPS)[number];

// ---------------------------------------------------------------------------
// Rights-preview presentation (server-derived capabilities only)
// ---------------------------------------------------------------------------

/** Whether a derived-capability set allows NOTHING (creation will deny). */
export function creationDeniedOf(capabilities: RightsPreviewLike["capabilities"]): boolean {
  return (
    !capabilities.canReferenceSourceFrames &&
    !capabilities.canDeliverLive &&
    !capabilities.canStoreDerivatives &&
    !capabilities.canShare
  );
}

/** The one-line product meaning of a derived capability (display only). */
export function capabilityLineOf(
  capabilities: RightsPreviewLike["capabilities"],
): { key: keyof RightsPreviewLike["capabilities"]; label: string; allowed: boolean }[] {
  return [
    {
      key: "canReferenceSourceFrames",
      label: "Render new realities",
      allowed: capabilities.canReferenceSourceFrames,
    },
    {
      key: "canDeliverLive",
      label: "Live delivery",
      allowed: capabilities.canDeliverLive,
    },
    {
      key: "canStoreDerivatives",
      label: "Store + play back outputs",
      allowed: capabilities.canStoreDerivatives,
    },
    { key: "canShare", label: "Share derivatives", allowed: capabilities.canShare },
  ];
}

/**
 * The submission verdict: a declaration that derives nothing is submitted
 * nowhere (the control plane would deny creation — surfaced as `denied`,
 * never retried or faked). A declaration that renders but cannot store
 * derivatives submits with an honest warning: the render executes, but
 * playback/preview will be denied.
 */
export function submissionVerdictOf(preview: RightsPreviewLike): {
  state: "ready" | "denied";
  warning: string | null;
} {
  if (creationDeniedOf(preview.capabilities)) {
    return { state: "denied", warning: preview.sessionCreation.reason };
  }
  if (!preview.capabilities.canStoreDerivatives) {
    return {
      state: "ready",
      warning:
        "this policy renders but does not store derivatives — the output cannot be previewed or played back (the control plane denies playback before any byte)",
    };
  }
  return { state: "ready", warning: null };
}

// ---------------------------------------------------------------------------
// Job → progress presentation (real compute states only)
// ---------------------------------------------------------------------------

/** The studio's progress presentation of one real compute job state. */
export interface JobProgressView {
  /** The UX-state contract's phase for this job. */
  phase: "processing" | "ready" | "failed";
  /** The honest label (never a fabricated percentage). */
  label: string;
  /** `true` once the job reached any terminal disposition. */
  terminal: boolean;
}

/** Maps a REAL compute job state onto the studio's progress presentation. */
export function jobProgressOf(state: string): JobProgressView {
  switch (state) {
    case "admitted":
    case "dispatched":
    case "queued":
      return { phase: "processing", label: "Queued on the compute plane", terminal: false };
    case "in-flight":
      return { phase: "processing", label: "Rendering (in flight)", terminal: false };
    case "succeeded":
      return { phase: "ready", label: "Render complete", terminal: true };
    case "failed":
      return { phase: "failed", label: "Render failed", terminal: true };
    case "cancelled":
      return { phase: "failed", label: "Render cancelled", terminal: true };
    case "dead-lettered":
      return { phase: "failed", label: "Render dead-lettered", terminal: true };
    default:
      // Unknown states are never smoothed over: they present as failed
      // with the raw state visible (fail-closed presentation).
      return { phase: "failed", label: `Unknown job state '${state}'`, terminal: true };
  }
}

/**
 * The last REAL metered progress fraction (0 < f <= 1) from the job's
 * progress events — or `null` when none was metered (never invented).
 */
export function meteredFractionOf(job: Pick<StudioJobLike, "events">): number | null {
  let fraction: number | null = null;
  for (const event of job.events) {
    if (event.type === "progress" && typeof event.fraction === "number") {
      fraction = event.fraction;
    }
  }
  return fraction;
}

/** Whether a renderer can produce a stored output through the compute path. */
export function rendererDispatchabilityOf(renderer: StudioOptionsLike["renderers"][number]): {
  state: "ready" | "unavailable";
  reason: string;
} {
  if (!renderer.artifactHandoff.supported) {
    return { state: "unavailable", reason: renderer.artifactHandoff.reason };
  }
  return { state: "ready", reason: renderer.artifactHandoff.reason };
}

// ---------------------------------------------------------------------------
// The flow's local draft (what the UI carries between steps)
// ---------------------------------------------------------------------------

/** Everything the guided flow collected before submission. */
export interface CreateDraft {
  sourceKey: string | null;
  operations: string[];
  expiresAtIso: string | null;
  sharingScope: "private" | "operator-authorized";
  rendererId: string | null;
  styleId: string | null;
  outputProfileIndex: number;
}

/** The empty draft (step 1's starting point). */
export function emptyDraft(): CreateDraft {
  return {
    sourceKey: null,
    operations: ["analysis", "transformation", "derivativeGeneration", "storage"],
    expiresAtIso: null,
    sharingScope: "private",
    rendererId: null,
    styleId: null,
    outputProfileIndex: 0,
  };
}

/** Whether the draft can advance past each step (honest gating). */
export function stepSatisfied(step: CreateStep, draft: CreateDraft): boolean {
  switch (step) {
    case "source":
      return draft.sourceKey !== null;
    case "rights":
      return draft.operations.length > 0;
    case "renderer":
      return draft.rendererId !== null;
    case "recipe":
      return draft.styleId !== null && draft.styleId.trim().length > 0;
    case "review":
    case "render":
      return true;
  }
}
