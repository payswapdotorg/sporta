/**
 * CREATE FLOW MODEL (W906 → R502) — the pure, client-safe state machine of
 * the Create Studio's guided flow.
 *
 * HONESTY BOUNDARY: every INPUT here is a server answer (the /api/create/*
 * routes' derivations over the real control plane); these functions only
 * MAP server state onto presentation. Rights semantics live in
 * `@sporta/contracts` (server-side); job states come from the real compute
 * ledger; progress fractions come from the real progress events only —
 * when nothing was metered, the answer is `null`, never an invented number.
 *
 * R502: the job-state presentation DELEGATES to the pinned
 * {@link ./honest-job-state} module (the ONE derived, deterministic mapping
 * — cancellation is a first-class phase there, and the typed failure
 * reasons ride verbatim).
 */
import type { RightsPreviewLike, StudioJobLike, StudioOptionsLike } from "./api-types";
import { honestComputePresentationOf, honestComputeProgressOf } from "./honest-job-state";

// ---------------------------------------------------------------------------
// The guided-flow state
// ---------------------------------------------------------------------------

/**
 * The guided steps, in order (ux-architecture: source → … → publish). R501
 * adds the COMPUTE step (the real SelectionDirector's decision surface)
 * between the recipe and the review.
 */
export const CREATE_STEPS = [
  "source",
  "rights",
  "renderer",
  "recipe",
  "compute",
  "review",
  "render",
] as const;
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

/**
 * The studio's progress presentation of one real compute job state (R502:
 * delegates to the pinned honest mapping — `cancelled` is a first-class
 * phase, `unreadable` the honest boundary marker).
 */
export interface JobProgressView {
  /** The UX-state contract's phase for this job. */
  phase: "processing" | "ready" | "failed" | "cancelled" | "unreadable";
  /** The honest label (never a fabricated percentage). */
  label: string;
  /** `true` once the job reached any terminal disposition. */
  terminal: boolean;
}

/** Maps a REAL compute job state onto the studio's progress presentation. */
export function jobProgressOf(state: string): JobProgressView {
  const presentation = honestComputePresentationOf(state);
  return { phase: presentation.phase, label: presentation.label, terminal: presentation.terminal };
}

/**
 * The last REAL metered progress fraction (0 < f <= 1) from the job's
 * progress events — or `null` when none was metered (never invented).
 */
export function meteredFractionOf(job: Pick<StudioJobLike, "events">): number | null {
  return honestComputeProgressOf(job);
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

/** Which real source path the flow runs (R501 + W6 Worker B): a browser
 * upload, the fixture library, or the operator's URL source (the
 * real-source acquisition machine). */
export type CreateSourceKind = "upload" | "fixture" | "url";

/** The derived reality kinds the ONE-submission plan can select (J004). */
export type DerivedRealitySelection = "tactical" | "three-d-game" | "anime-npr";

/** Product labels for the derived reality kinds (display only). */
export const DERIVED_REALITY_LABELS: Record<DerivedRealitySelection, string> = {
  tactical: "Tactical",
  "three-d-game": "3D Game",
  "anime-npr": "Anime / NPR",
};

/**
 * Whether a derived reality is selectable in the multi-select (J004): only
 * kinds the server's honest capability states marked offered — the UI never
 * invents a reality this control plane cannot render.
 */
export function realityOffered(
  options: StudioOptionsLike | null,
  reality: DerivedRealitySelection,
): boolean {
  if (options === null) return false;
  const row = options.derivedRealities?.find((entry) => entry.reality === reality);
  return row?.offered === true;
}

/** Everything the guided flow collected before submission. */
export interface CreateDraft {
  /** The source path (R501 + W6 Worker B): a real browser upload, the fixture
   * library, or the operator's URL source. */
  sourceKind: CreateSourceKind;
  /** The picked upload file (upload path; held client-side until submission). */
  file: File | null;
  /** The fixture source key (fixture path). */
  sourceKey: string | null;
  /** The pasted source URL (url path — the EXACT location, verbatim). */
  sourceUrl: string | null;
  operations: string[];
  expiresAtIso: string | null;
  sharingScope: "private" | "operator-authorized";
  rendererId: string | null;
  /**
   * J004: the DERIVED realities selected for the ONE-submission plan (the
   * upload path's multi-select; "original" is NOT a selection — the
   * admitted media job always produces the original-reality artifact). An
   * empty selection means upload + original only.
   */
  derivedRealities: DerivedRealitySelection[];
  styleId: string | null;
  outputProfileIndex: number;
  /** The compute directive (R501): auto or an explicit provider choice. */
  computeMode: "sporta-auto" | "user-explicit";
  /** The explicitly chosen provider id (user-explicit mode). */
  computeProviderId: string | null;
}

/** The empty draft (step 1's starting point). */
export function emptyDraft(): CreateDraft {
  return {
    sourceKind: "upload",
    file: null,
    sourceKey: null,
    sourceUrl: null,
    operations: ["analysis", "transformation", "derivativeGeneration", "storage"],
    expiresAtIso: null,
    sharingScope: "private",
    rendererId: null,
    derivedRealities: [],
    styleId: null,
    outputProfileIndex: 0,
    computeMode: "sporta-auto",
    computeProviderId: null,
  };
}

/** Whether the draft can advance past each step (honest gating). */
export function stepSatisfied(step: CreateStep, draft: CreateDraft): boolean {
  switch (step) {
    case "source":
      return urlShapeSatisfied(draft)
        ? true
        : draft.sourceKind === "upload"
          ? draft.file !== null
          : draft.sourceKey !== null;
    case "rights":
      return draft.operations.length > 0;
    case "renderer":
      // J004: the upload/URL paths select DERIVED realities for the
      // ONE-submission plan — zero selections is a valid choice (upload +
      // original only, the legacy behavior); the fixture path still
      // requires one renderer.
      return draft.sourceKind === "fixture" ? draft.rendererId !== null : true;
    case "recipe":
      return draft.styleId !== null && draft.styleId.trim().length > 0;
    case "compute":
      return (
        draft.computeMode === "sporta-auto" ||
        (draft.computeMode === "user-explicit" && draft.computeProviderId !== null)
      );
    case "review":
    case "render":
      return true;
  }
}

/** Human-readable byte size for the upload constraint copy (display only). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/**
 * Whether the URL path's draft shape is satisfied (W6 Worker B): the
 * sourceKind is `url` AND a non-empty pasted URL exists. The server's
 * fail-closed parse is the real gate — this is only the Continue button's
 * honest enablement (an unparsable URL is refused by the server, typed).
 */
export function urlShapeSatisfied(draft: CreateDraft): boolean {
  return (
    draft.sourceKind === "url" && draft.sourceUrl !== null && draft.sourceUrl.trim().length > 0
  );
}
