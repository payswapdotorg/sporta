/**
 * THE W804 PRODUCT FUNNEL — the normative definition (see `../FUNNEL.md` for
 * the full specification, metric catalog, and privacy scope).
 *
 * The funnel is a PURE DERIVATION from the recorded W706 viewer telemetry
 * stream (`@sporta/viewer-shell`'s `ViewerTelemetryEvent`, schema version 1).
 * Every stage below names its evidence: a `state-transition` target status
 * from the REAL viewer state machine (`viewer-core.ts`), which in turn is
 * driven by the REAL W701 control-plane operations. Nothing in this module
 * invents a product step the codebase does not actually have — the funnel is
 * exactly what the seams can honestly evidence.
 *
 * The funnel's UNIT is the SESSION COHORT: the set of recorded events that
 * carry the same opaque control-plane session id (`sess-<n>`). A cohort
 * EVIDENCES a stage when any of its events matches the stage's evidence
 * rule. Cohorts whose establishment (the `browsing-sessions → session-detail`
 * transition) is not observed in the window are counted as PARTIAL (flagged,
 * never dropped — the window was truncated or started mid-session).
 *
 * BATCH SPINE (the render path):
 *
 *     session-engaged → renderer-selection → render-requested
 *                     → output-ready → batch-playing
 *
 * LIVE BRANCH (the W704 path — joins at the session, bypasses rendering):
 *
 *     session-engaged → live-requested → live-playing
 *
 * The viewer-level CONNECTION stage (the `connect` operation) is reported in
 * its own `connection` block, deliberately OUTSIDE the session funnel: its
 * unit is the viewer run, not the session (one connect can precede many
 * sessions — a connect→session "conversion" would be a unit mismatch, and
 * inventing one would be dishonest).
 *
 * Constitution: pure data + pure functions. No clocks, no randomness — the
 * module is a constant table a report is derived from.
 */
import type { ViewerFailureClass, ViewerOperation, ViewerStatus } from "@sporta/viewer-shell";
import { VIEWER_FAILURE_CLASSES } from "@sporta/viewer-shell";

/**
 * The funnel definition schema version. Bumped when the funnel definition
 * (stages, boundaries, attribution rules) changes; the report schema
 * (`./schema.ts`) carries its own version.
 */
export const FUNNEL_SPEC_VERSION = 1;

/** Every funnel stage id (the closed set — the zod report schema's enum). */
export const FUNNEL_STAGE_IDS = [
  "session-engaged",
  "renderer-selection",
  "render-requested",
  "output-ready",
  "batch-playing",
  "live-requested",
  "live-playing",
] as const;

/** One funnel stage id (see the module docs for the two paths). */
export type FunnelStageId = (typeof FUNNEL_STAGE_IDS)[number];

/** The ordered batch-spine stages (conversion runs along this order). */
export const BATCH_STAGES: readonly FunnelStageId[] = [
  "session-engaged",
  "renderer-selection",
  "render-requested",
  "output-ready",
  "batch-playing",
];

/** The ordered live-branch stages (conversion runs along this order). */
export const LIVE_STAGES: readonly FunnelStageId[] = [
  "session-engaged",
  "live-requested",
  "live-playing",
];

/**
 * The evidence rule per stage: the `state-transition` TARGET STATUS that
 * evidences the stage (the viewer state machine's real transitions — see
 * `viewer-core.ts`; every status below is reached exactly when the named
 * control-plane seam succeeded).
 */
export const STAGE_EVIDENCE_TARGET: Readonly<Record<FunnelStageId, ViewerStatus>> = {
  /**
   * `openSession` succeeded (W701: `getSession` + `listRenders` both passed
   * the fail-closed rights gate; the emitter stamps the session id BEFORE
   * this transition, so the event carries the cohort id).
   */
  "session-engaged": "session-detail",
  /** `beginRender` succeeded (W703: `listRenderers` returned capabilities). */
  "renderer-selection": "renderer-selection",
  /** The `createRender` command was accepted for dispatch (W701 request). */
  "render-requested": "render-queued",
  /** The render's playable output loaded (W705: `selectRender`/load landed). */
  "output-ready": "ready",
  /** The batch player started (the W502/W705 presentation is playing). */
  "batch-playing": "playing",
  /** The `openLive` command was dispatched (W704 rights pre-check passed). */
  "live-requested": "live-connecting",
  /** The W305 offer was validated and the live stream attached + playing. */
  "live-playing": "live-playing",
};

/** The transition target that evidences each stage, keyed by target status. */
const STAGE_BY_TARGET_STATUS: Readonly<Record<string, FunnelStageId>> = {
  "session-detail": "session-engaged",
  "renderer-selection": "renderer-selection",
  "render-queued": "render-requested",
  ready: "output-ready",
  playing: "batch-playing",
  "live-connecting": "live-requested",
  "live-playing": "live-playing",
};

/**
 * The stage a `state-transition` event's `to` status evidences, or `null` for
 * every non-stage status (`connecting`, `browsing-sessions`, `loading-output`,
 * `outputs-pending`, `paused`, `ended`, `live-reconnecting`, `live-ended`,
 * `error`, `disconnected` — navigation, processing, and terminal statuses that
 * are NOT funnel advances; they are still CLASSIFIED, and several are
 * attribution signals, see {@link BOUNDARIES}).
 */
export function stageOfTransitionTarget(to: ViewerStatus): FunnelStageId | null {
  return STAGE_BY_TARGET_STATUS[to] ?? null;
}

/**
 * A session cohort's establishment evidence: the `openSession` success
 * transition (`browsing-sessions → session-detail`). A cohort with events
 * but no such transition is PARTIAL (its window is truncated or began
 * mid-session) — counted, flagged, never dropped.
 */
export function isEstablishmentEvidence(from: ViewerStatus, to: ViewerStatus): boolean {
  return from === "browsing-sessions" && to === "session-detail";
}

/** One drop-off attribution category (see FUNNEL.md §4 for the rules). */
export type DropOffAttributionKind =
  /** A terminal failure class at the boundary's operations (verbatim class). */
  | "error"
  /** The session evidenced the OTHER path instead (not a drop-off in intent). */
  | "live-path-taken"
  | "batch-path-taken"
  /** The render exists but its output was not stored in the window (W705). */
  | "outputs-pending"
  /** The output load was in flight when the window ended. */
  | "load-in-progress"
  /** The user backed out of renderer selection (`cancelRenderSelection`). */
  | "selection-cancelled"
  /** No failure observed — the session simply did not proceed (honest). */
  | "no-error-observed";

/**
 * One funnel boundary: `fromStage → toStage`, the viewer operations whose
 * `error-occurred` events can fail that advance, and the non-error
 * attribution categories applicable there (in priority order — errors first,
 * then signals, then the honest catch-all).
 */
export interface FunnelBoundary {
  /** The boundary's stable id (report rows carry it verbatim). */
  readonly id: string;
  readonly fromStage: FunnelStageId | "viewer" | "connected";
  readonly toStage: FunnelStageId | "viewer" | "connected";
  /** `session` boundaries count cohorts; `viewer` boundaries count attempts. */
  readonly scope: "session" | "viewer";
  /** The W706 operation vocabulary entries whose errors fail this advance. */
  readonly boundaryOperations: readonly ViewerOperation[];
  /** The non-error attribution categories applicable at this boundary. */
  readonly namedAttributions: readonly DropOffAttributionKind[];
}

/**
 * The complete, ordered boundary table (the normative attribution rules).
 * Viewer-scope boundaries live first (the pre-session seam), then the batch
 * spine, then the live branch.
 */
export const BOUNDARIES: readonly FunnelBoundary[] = [
  {
    id: "viewer→connected",
    fromStage: "viewer",
    toStage: "connected",
    scope: "viewer",
    boundaryOperations: ["connect"],
    namedAttributions: [],
  },
  {
    id: "connected→session-engaged",
    fromStage: "connected",
    toStage: "session-engaged",
    scope: "viewer",
    // A failed createSession/openSession never set a session id — the error
    // is viewer-scoped (sessionId null) by construction.
    boundaryOperations: ["createSession", "openSession"],
    namedAttributions: [],
  },
  {
    id: "session-engaged→renderer-selection",
    fromStage: "session-engaged",
    toStage: "renderer-selection",
    scope: "session",
    boundaryOperations: ["beginRender"],
    // `batch-path-taken` covers the selectRender ENTRY POINT on a session
    // with pre-existing renders (session-detail → loading-output → ready):
    // the session took the batch path without ever entering the selection
    // screen — a skip, not a drop-off in intent.
    namedAttributions: ["live-path-taken", "batch-path-taken", "no-error-observed"],
  },
  {
    id: "renderer-selection→render-requested",
    fromStage: "renderer-selection",
    toStage: "render-requested",
    scope: "session",
    // The createRender dispatch cannot observably fail before `render-queued`
    // (the machine sets it synchronously at dispatch begin).
    boundaryOperations: [],
    namedAttributions: ["selection-cancelled", "no-error-observed"],
  },
  {
    id: "render-requested→output-ready",
    fromStage: "render-requested",
    toStage: "output-ready",
    scope: "session",
    // The render-then-load flow (createRender) and every re-select load
    // (selectRender) fail here — including segment-integrity failures, which
    // the core classifies under these operations.
    boundaryOperations: ["createRender", "selectRender"],
    namedAttributions: ["outputs-pending", "load-in-progress", "no-error-observed"],
  },
  {
    id: "output-ready→batch-playing",
    fromStage: "output-ready",
    toStage: "batch-playing",
    scope: "session",
    // `play` is a local player command with no failing seam — no operation
    // can observably fail between ready and playing.
    boundaryOperations: [],
    namedAttributions: ["no-error-observed"],
  },
  {
    id: "session-engaged→live-requested",
    fromStage: "session-engaged",
    toStage: "live-requested",
    scope: "session",
    boundaryOperations: ["openLive"],
    namedAttributions: ["batch-path-taken", "no-error-observed"],
  },
  {
    id: "live-requested→live-playing",
    fromStage: "live-requested",
    toStage: "live-playing",
    scope: "session",
    // The whole offer dance (request → validate → answer → attach) and every
    // live teardown verdict fail under `openLive`.
    boundaryOperations: ["openLive"],
    namedAttributions: ["no-error-observed"],
  },
];

/**
 * The remediation/ownership notes per failure class — the ACTIONABLE half of
 * the failure metrics (the W706 `REMEDIATION_HINTS` precedent: guidance
 * travels with the class, derived from one table, never free text). The
 * user-facing remediation hint itself is imported VERBATIM from W706's
 * `REMEDIATION_HINTS` at report time; this table adds the OWNER pointer for
 * the operator reading the report.
 */
export const OWNER_NOTES: Readonly<Record<ViewerFailureClass, string>> = {
  "rights-denied":
    "Owner: product/policy (W701 authorization). The deny is fail-closed by design — review the session policy's allowed operations.",
  "media-invalid":
    "Owner: renderer/output pipeline (W503/W504). Check the request profile against the renderer capability, or the stored artifact.",
  validation:
    "Owner: viewer client (W702 request build). The request shape was rejected — a client-side construction bug, not a server fault.",
  "resource-limit":
    "Owner: platform capacity (W701/W802). Usually transient — correlate with load; retry is the designed recovery.",
  internal:
    "Owner: platform server (W701). Inspect the control-plane logs; retry may clear a transient fault.",
  "unknown-session":
    "Owner: session lifecycle (W701). The session was terminated or expired under the viewer — refresh and reopen.",
  "unknown-render":
    "Owner: render lifecycle (W701). The render no longer exists — refresh the session detail and select an existing render.",
  "unknown-segment":
    "Owner: playback store (W504). A stored output segment vanished mid-playback — reload the render; check the store's retention.",
  "unknown-route":
    "Owner: viewer/server version skew. The viewer requested a route this server does not serve — reload the viewer.",
  "method-not-allowed":
    "Owner: viewer/server version skew. Wrong HTTP method for the route — reload the viewer.",
  network:
    "Owner: deployment/network. The control plane was unreachable — check reachability and the browser HTTP bridge posture.",
  "unsupported-output":
    "Owner: viewer playback surface (W705). The render's output kind is not presentable by this viewer — pick a supported renderer.",
};

/** The complete failure-class vocabulary, verbatim from the viewer model. */
export const FAILURE_CLASSES: readonly ViewerFailureClass[] = VIEWER_FAILURE_CLASSES;

/**
 * The session-outcome classification (the terminal failure metrics): what
 * ultimately happened to a session cohort in the window.
 */
export type SessionOutcomeKind =
  /** The funnel's goal was reached (batch playing or live playing). */
  | "playback-started"
  /** The last observed failure ended the session (never recovered past it). */
  | "error-terminal"
  /** No failure ended the session — it simply did not (or not yet) proceed. */
  | "no-terminal-error";
