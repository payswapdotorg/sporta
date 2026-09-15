/**
 * `createViewerCore` — the headless viewer state machine (W702).
 *
 * The entire viewer UX as ONE pure, fully tested state machine:
 *
 * ```
 * disconnected → connecting → browsing-sessions ⇄ session-detail
 *                                   session-detail → renderer-selection
 *                                   renderer-selection → render-queued
 *                                   render-queued → loading-output
 *                                   loading-output → ready → playing ⇄ paused
 *                                   loading-output → outputs-pending (W705)
 *                                   outputs-pending → loading-output (re-select)
 *                                   playing → ended
 *                                   session-detail → live-connecting (W704)
 *                                   live-connecting → live-playing
 *                                   live-playing → live-reconnecting (W704)
 *                                   live-reconnecting → live-playing (attempt fired)
 *                                   live-playing → live-ended (completed/stopped)
 * ANY state → error (classified, retryability-flagged) → retry | dismiss
 * ```
 *
 * LIVE PLAYBACK (W704): `openLive` requests the session's live output
 * through the injected {@link ViewerCoreOptions.live} client — the offer is
 * validated + decided by W305's answer-side zod grammar inside the adapter
 * (`./live-client.ts`), a typed reject or rights denial lands in the error
 * state (fail-closed, never a retry storm), and an accepted offer attaches
 * the consuming stream: the core mounts the live player
 * (`./live-player.ts`), pulls delivery events (viewer-driven
 * backpressure — one pull at a time), and reconnects through the PURE
 * deterministic backoff schedule (`./live-backoff.ts`: 500 → 1000 → 2000 →
 * 4000 ms, capped at 4 attempts; only `connection-lost`/`transport-failed`
 * reconnect — rights and protocol verdicts are terminal) driven by the
 * host-issued `tick` on the injected clock (no timers). The live statuses
 * are first-class machine states (`live-connecting`, `live-playing`,
 * `live-reconnecting`, `live-ended`) — every transition is a W706
 * state-transition event, each reconnect attempt is visible as a
 * `live-reconnecting → live-playing` transition, and every live failure
 * surfaces through the typed error model (the W305 class verbatim in
 * `details.liveFailureClass`).
 *
 * `outputs-pending` (W705): the render EXISTS on the control plane (the
 * `getRender` gate passed) but its stored output segments are not there yet
 * — W504's encode→store step runs HOST-side after the render completes, so
 * an empty outputs list is a real, observable processing state. It is a
 * RESTING state (never an error, never a fake player): the view-model names
 * the pending render (`pendingRenderId`) and the user re-selects it to
 * re-check. When the host step has stored segments, the same flow lands in
 * `ready` directly.
 *
 * Properties (constitution):
 *
 * - **Determinism**: no wall-clock reads. The time source is injected
 *   (default: the deterministic `VIEWER_DEFAULT_EPOCH_MS` counter — a LOCAL
 *   mirror of `@sporta/testing`'s epoch, kept local so the browser module
 *   graph stays free of bare `@sporta/*` specifiers; the browser bootstrap
 *   injects `performance.now`). The same command script over the same ports
 *   and clock yields a deep-equal view-model trace.
 * - **Clear state over silent**: EVERY port failure transitions to the
 *   `error` status with a structured {@link ErrorView} (failureClass, human
 *   label, message, retryability, operation). Nothing is swallowed; a
 *   failing operation never leaves partially-mutated NEW state behind (the
 *   pre-operation data stays; e.g. a render that was created but whose
 *   output failed to load remains listed — that part SUCCEEDED).
 * - **Fail-closed client posture**: rights-denied operations surface as
 *   `rights-denied` error views and never leak partial data (a session
 *   whose render list is denied opens into the error state, not a session
 *   view silently missing its renders).
 * - **Typed events**: the machine is driven by the {@link ViewerCommand}
 *   union; the view is observed through {@link ViewerCore.view} /
 *   {@link ViewerCore.subscribe}.
 *
 * Playback (W705): the core owns one player per loaded output — the W502
 * frame player (`{ frames, manifest }` outputs, the stand-in path) or the
 * W705 SMIL segment player (the REAL W504 stored segment) — created through
 * the injectable factories with the core's clock, and forwards the playback
 * commands (`play`/`pause`/`seek`/`step*`/`setLoop`/`replay`/`tick`) to the
 * active one; the player's view-model (a discriminated union) is embedded
 * in the viewer view-model, and while a playback is mounted the viewer
 * status mirrors the player's playback state (`ready`/`playing`/
 * `paused`/`ended`).
 *
 * Live output is HONESTLY unavailable when NO live client is injected (the
 * browser bootstrap today: W305's transport is an in-process seam — no real
 * RTCPeerConnection exists in this monorepo, and the dev server does not
 * bridge live over HTTP): the view-model carries the constant `live:`
 * section stating that. With a live client wired (tests, dev composition),
 * `live.available` is `true` and the section carries the live stream state.
 * (W705 delivered the real BATCH playback path — stored W504 segments —
 * which is what this machine plays otherwise.)
 *
 * Renderer selection (W703): `beginRender` lists the renderers through the
 * control port and the view-model carries the DERIVED options (capability
 * documents verbatim + the `./selection-plan.ts` affordances — selectable or
 * blocked with a machine reason + a human note, derived from the capability
 * data and the open session's fail-closed rights; never from renderer
 * identity). `createRender` carries the selection payload through VERBATIM —
 * renderer identity, an optional capability-declared `outputProfile`, and an
 * opaque style choice (`styleId`/`config`) whose schema knowledge stays
 * behind the plugin; a capability-violating selection surfaces the server's
 * real typed error (media-invalid / rights-denied), never a viewer-side
 * substitute.
 *
 * Telemetry (W706): when a {@link ViewerCoreOptions.telemetrySink} is
 * injected, the core emits the typed, privacy-scoped events of
 * `./telemetry-events.ts` at the REAL lifecycle moments — state
 * transitions (every actual status change), startup timings measured on
 * the injected clock (connect, output load), surfaced failures (the typed
 * error model, verbatim class/message + remediation hint), playback
 * health from the players' honest seams (one rebuffer-stall event per
 * playing-while-buffering episode of the frame player; the integrity
 * result of the real W504 playback seam), and the structured user
 * feedback command (`sendFeedback`). Telemetry is strictly best-effort:
 * the emitter counts its own drops/failures and can never break the
 * viewer (the W007 logger principle). The view-model carries a constant
 * `telemetry: { enabled }` marker the pure `./telemetry-plan.ts` derives
 * the feedback affordance from.
 *
 * KNOWN LIMITATIONS (W702 + W705 + W704, deliberate):
 *
 * - one in-flight control operation at a time — async commands issued while
 *   an operation is pending are DROPPED (the pending state is visible in the
 *   view-model and the UI disables controls; single-user shell, documented);
 * - no user authentication (the caller-supplied authorization policy is the
 *   trust boundary — inherited W701 limitation);
 * - `dismissError`/`retry` return to the last STABLE status
 *   (`browsing-sessions`, `session-detail`, `renderer-selection`, a playback
 *   status, or `disconnected`) — never back into an in-flight status;
 * - ONE presentation at a time: opening live tears down a mounted batch
 *   playback and selecting a render tears down a mounted live stream (the
 *   single status vocabulary is the machine's honest shape);
 * - a live presentation has no pause/seek — live content is consumed at the
 *   live edge (the batch players own pause/seek); closing the live view is
 *   the live equivalent;
 * - the live reconnect wait is TICK-DRIVEN (host ticks against the injected
 *   clock — no timers by constitution), so a host that stops ticking stops
 *   the schedule too.
 */
import { createViewerDefaultClock } from "./default-clock.ts";
import { deriveRendererOptions } from "./selection-plan.ts";
import type { RendererOptionView } from "./selection-plan.ts";
import type {
  AuthorizationPolicy,
  OutputProfile as OutputProfileDoc,
  RightsCapabilities,
} from "@sporta/contracts";
import type { RenderEnvelope, RenderSummary, SessionSummary } from "@sporta/control-api";
import { errorViewFrom } from "./errors.ts";
import { ViewerControlError } from "./errors.ts";
import { isViewerControlError } from "./errors.ts";
import { toErrorView } from "./errors.ts";
import type { ErrorView } from "./errors.ts";
import { createFramePlayer } from "./player.ts";
import type { FramePlayer, PlayerViewModel } from "./player.ts";
import { createSegmentPlayer } from "./segment-player.ts";
import type { SegmentPlayer, SegmentPlayerViewModel } from "./segment-player.ts";
import { createLivePlayer } from "./live-player.ts";
import type { LivePlayer, LivePlayerViewModel } from "./live-player.ts";
import { LIVE_FAILURE_CLASS_MAP } from "./live-ports.ts";
import type {
  LiveAccountingView,
  LiveClient,
  LiveDeliveryEvent,
  LiveOfferView,
  LiveOutputFailureClass,
  LiveStreamHandle,
} from "./live-ports.ts";
import { LIVE_RECONNECT_MAX_ATTEMPTS } from "./live-backoff.ts";
import { isLiveRetryableFailureClass } from "./live-backoff.ts";
import { liveReconnectDecision } from "./live-backoff.ts";
import { createViewerTelemetry } from "./telemetry.ts";
import type { TelemetrySink } from "./telemetry-sink.ts";
import type { UserFeedbackKind } from "./telemetry-events.ts";
import type { ControlClient, RenderOutputPort } from "./ports.ts";

/** The viewer state-machine status (the brief's state vocabulary). */
export type ViewerStatus =
  | "disconnected"
  | "connecting"
  | "browsing-sessions"
  | "session-detail"
  | "renderer-selection"
  | "render-queued"
  | "loading-output"
  | "outputs-pending"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "live-connecting"
  | "live-playing"
  | "live-reconnecting"
  | "live-ended"
  | "error";

/** Connection state (independent of the flow status). */
export type ConnectionState = "disconnected" | "connecting" | "connected";

/** One render entry in the session detail (the W701 `RenderSummary` shape). */
export type RenderEntryView = RenderSummary;

/** Session detail view: the session's identity, rights, and renders. */
export interface SessionDetailView {
  sessionId: string;
  status: string;
  createdAt: string;
  /** The fail-closed derived rights capabilities, verbatim. */
  rights: RightsCapabilities;
  renders: RenderEntryView[];
}

/**
 * Renderer selection view: capability-driven (W703), never hard-coded. Each
 * entry is the listed capability VERBATIM plus the derived affordance
 * (`selectable`, and when blocked the machine `blockedReason` + the human
 * `blockedNote` — rights-required / no-output-profiles / unsupported-output
 * / no-session; see `./selection-plan.ts`, which owns the derivation). The
 * plan layer derives everything from capability data + the session's rights;
 * no renderer id is ever matched here.
 */
export interface RendererSelectionView {
  renderers: RendererOptionView[];
}

/** The honest live-output section when no live client is wired (constant). */
export interface LiveUnavailableView {
  available: false;
  note: string;
}

/** The live section's own state (drives the panes; see `./live-plan.ts`). */
export type LiveSectionState = "idle" | "connecting" | "playing" | "reconnecting" | "ended";

/** The live-output section with a live client wired (W704). */
export interface LiveAttachedSection {
  available: true;
  /** The live section's own state (coarse; the pane headline). */
  state: LiveSectionState;
  /** The session the live stream belongs to (null while idle). */
  sessionId: string | null;
  /** The attached stream's id (from the validated offer). */
  streamId: string | null;
  /** The validated offer, summarized verbatim (null while idle/connecting-before-offer). */
  offer: LiveOfferView | null;
  /** The viewer endpoint id that answered the offer. */
  viewerId: string | null;
  /** The live presentation view-model (mounted while a stream is attached). */
  player: LivePlayerViewModel | null;
  /** The consumer-side delivery accounting (W305's verbatim receipts). */
  accounting: LiveAccountingView | null;
  /** Why the W305 session is degraded (verbatim reasons; empty when established). */
  degradationReasons: readonly string[];
  /** Reconnect bookkeeping (non-null while/after a reconnect window). */
  reconnect: {
    /** Attempts FIRED so far. */
    attempts: number;
    maxAttempts: number;
    /** When the next attempt fires (injected clock domain; null when idle). */
    nextAttemptAtMs: number | null;
    /** The failure class that started the current reconnect window. */
    lastFailureClass: string;
    /** The last fired attempt's report (evidence). */
    lastReport: { resumeFromOrdinal: number; replayCount: number; gapSkipped: number } | null;
  } | null;
  /** The terminal session outcome, once the stream ended (`completed`/`stopped`/`failed`). */
  outcome: { outcome: "completed" | "stopped" | "failed"; failureClass?: string } | null;
}

/** The live-output section (W704): unavailable with the honest note, or the live stream state. */
export type LiveView = LiveUnavailableView | LiveAttachedSection;

/**
 * The telemetry marker (constant after construction): whether the core was
 * given a sink and is emitting the W706 event vocabulary. The pure
 * `./telemetry-plan.ts` derives the feedback affordance from it.
 */
export interface TelemetryView {
  enabled: boolean;
}

/** The mounted playback view-model (discriminated union — W705). */
export type PlaybackView = PlayerViewModel | SegmentPlayerViewModel;

/** The full viewer view-model — a JSON-safe snapshot of the machine. */
export interface ViewerViewModel {
  status: ViewerStatus;
  connection: ConnectionState;
  /** The in-flight control operation (drives UI disable states), or null. */
  pendingOperation: string | null;
  sessions: SessionSummary[];
  session: SessionDetailView | null;
  rendererSelection: RendererSelectionView | null;
  playback: PlaybackView | null;
  /**
   * The render whose stored outputs are pending (non-null exactly while
   * `status === "outputs-pending"`). Drives the "check again" affordance;
   * null otherwise.
   */
  pendingRenderId: string | null;
  live: LiveView;
  /** Whether telemetry events are being emitted (W706; see `./telemetry-plan.ts`). */
  telemetry: TelemetryView;
  error: ErrorView | null;
  /** When the connection was established (from the injected clock). */
  connectedAtMs: number | null;
}

/**
 * The typed command union driving the machine. Playback commands are
 * forwarded to the active player; flow commands drive the port calls.
 */
export type ViewerCommand =
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "refreshSessions" }
  | { type: "createSession"; policy: AuthorizationPolicy; sourceLabel?: string }
  | { type: "openSession"; sessionId: string }
  | { type: "closeSession" }
  | { type: "terminateSession"; sessionId: string }
  | { type: "beginRender" }
  | { type: "cancelRenderSelection" }
  | {
      type: "createRender";
      rendererId: string;
      rendererVersion?: string;
      /**
       * Output profile for the render, passed through VERBATIM to the control
       * plane when provided (a capability-declared `OutputProfile`; omitting
       * it lets the control plane default to the plugin's first supported
       * profile — the W703 selection seam carries the choice honestly; a
       * violating profile surfaces the server's real `media-invalid` error).
       */
      outputProfile?: OutputProfileDoc;
      styleId?: string;
      /**
       * Opaque style config passed through VERBATIM to the control plane
       * (W703 boundary: the core holds NO renderer-specific style keys —
       * any schema knowledge lives behind the renderer plugin).
       */
      config?: unknown;
    }
  | { type: "selectRender"; renderId: string }
  | { type: "closePlayback" }
  | {
      /** Opens the session's live output (W704): offer → validate → attach. */
      type: "openLive";
    }
  | {
      /** Closes the live view: disconnects the stream, back to the session. */
      type: "closeLive";
    }
  | { type: "play" }
  | { type: "pause" }
  | { type: "replay" }
  | { type: "seek"; positionMs: number }
  | { type: "stepForward" }
  | { type: "stepBackward" }
  | { type: "setLoop"; loop: boolean }
  | { type: "tick" }
  | {
      /** Structured user feedback (W706): recorded as a telemetry event. */
      type: "sendFeedback";
      /** One of the closed feedback kinds (see `./telemetry-events.ts`). */
      feedback: UserFeedbackKind;
    }
  | { type: "retry" }
  | { type: "dismissError" };

/** Frame player factory seam (tests inject fakes; default: the real player). */
export type PlayerFactory = (options: { clock: () => number }) => FramePlayer;

/** Segment player factory seam (tests inject fakes; default: the real player). */
export type SegmentPlayerFactory = (options: { clock: () => number }) => SegmentPlayer;

/** Options for {@link createViewerCore}. */
export interface ViewerCoreOptions {
  /** The control-plane client port (see `./ports.ts`). */
  client: ControlClient;
  /** The render-output port (see `./ports.ts`). */
  output: RenderOutputPort;
  /**
   * Injected time source in milliseconds (default: deterministic
   * `VIEWER_DEFAULT_EPOCH_MS + ticks` counter — a LOCAL mirror of the
   * testing epoch; see `./default-clock.ts`). The browser bootstrap injects
   * the `performance.now` clock; production must never rely on the default.
   */
  nowMs?: () => number;
  /** Frame player factory (default: {@link createFramePlayer}). */
  playerFactory?: PlayerFactory;
  /** Segment player factory (default: {@link createSegmentPlayer}). */
  segmentPlayerFactory?: SegmentPlayerFactory;
  /**
   * Injectable telemetry sink (W706). When provided, the core emits the
   * typed, privacy-scoped events of `./telemetry-events.ts` at the real
   * lifecycle moments (state transitions, startup timings, typed errors,
   * playback health, structured user feedback). Omitted → telemetry off
   * (the view-model's `telemetry.enabled` is false and nothing is emitted).
   */
  telemetrySink?: TelemetrySink;
  /**
   * Injectable live client (W704). When provided, the view-model's `live`
   * section becomes available and `openLive` runs the full live dance
   * (offer → W305-grammar validation → attach). Omitted → live honestly
   * unavailable (the constant note; the command is a no-op).
   */
  live?: LiveClient;
}

/** The viewer core surface. */
export interface ViewerCore {
  /** Dispatches one typed command (see {@link ViewerCommand}). */
  dispatch(command: ViewerCommand): void;
  /** The current view-model snapshot (pure, JSON-safe). */
  view(): ViewerViewModel;
  /** Subscribes to view-model changes; returns an unsubscribe function. */
  subscribe(listener: (view: ViewerViewModel) => void): () => void;
}

/** The honest live-output note when no live client is wired (W704 delivered; the seam is the boundary). */
export const LIVE_UNAVAILABLE_NOTE =
  "Live output is wired (W704) but requires a live transport seam: W305's live output is an in-process contract (no real RTCPeerConnection exists in this monorepo — the documented W305 boundary), and this viewer build has no live client connected. The dev server does not bridge live output over HTTP. Stored batch outputs (W504 segments) play through the real path.";

const PLAYBACK_STATUSES: readonly ViewerStatus[] = ["ready", "playing", "paused", "ended"];

function isPlaybackStatus(status: ViewerStatus): boolean {
  return PLAYBACK_STATUSES.includes(status);
}

const STABLE_STATUSES: readonly ViewerStatus[] = [
  "disconnected",
  "browsing-sessions",
  "session-detail",
  "renderer-selection",
  "outputs-pending",
  "ready",
  "playing",
  "paused",
  "ended",
  "live-playing",
  "live-ended",
];

function isStableStatus(status: ViewerStatus): boolean {
  return STABLE_STATUSES.includes(status);
}

/**
 * Creates the viewer core. See the module docs for the state machine, the
 * error model, and the honest limitations.
 */
export function createViewerCore(options: ViewerCoreOptions): ViewerCore {
  const client = options.client;
  const outputPort = options.output;
  const nowMs = options.nowMs ?? createViewerDefaultClock();
  const playerFactory = options.playerFactory ?? createFramePlayer;
  const segmentPlayerFactory = options.segmentPlayerFactory ?? createSegmentPlayer;
  // W706: telemetry is best-effort by construction — the emitter validates
  // its own events and guards every sink call (drops are counted, never
  // thrown), so a failing sink can never break the state machine.
  const telemetry =
    options.telemetrySink !== undefined
      ? createViewerTelemetry({ sink: options.telemetrySink, nowMs })
      : null;

  const listeners = new Set<(view: ViewerViewModel) => void>();

  // Machine state.
  let status: ViewerStatus = "disconnected";
  let lastStableStatus: ViewerStatus = "disconnected";
  let connection: ConnectionState = "disconnected";
  let connectedAtMs: number | null = null;
  let pendingOperation: string | null = null;
  let inFlight = false;
  let sessions: SessionSummary[] = [];
  let session: SessionDetailView | null = null;
  let rendererSelection: RendererSelectionView | null = null;
  let playback: PlaybackView | null = null;
  let pendingRenderId: string | null = null;
  let error: ErrorView | null = null;
  let retryCommand: ViewerCommand | null = null;

  let activePlayer: FramePlayer | SegmentPlayer | null = null;
  let unsubscribePlayer: (() => void) | null = null;
  // W706 rebuffer-stall episode tracking: `true` while the mounted FRAME
  // player is playing AND buffering (one event per episode — reset when the
  // frame arrives, playback pauses, or the player is torn down/replaced).
  let stallActive = false;
  // Operation epoch: bumped by `disconnect` so a resolution landing after a
  // hard reset is dropped instead of mutating a reset machine (zombie guard).
  let epoch = 0;

  // Live state (W704). `liveClient === null` → the constant honest note.
  const liveClient = options.live ?? null;
  let liveStream: LiveStreamHandle | null = null;
  let livePlayer: LivePlayer | null = null;
  let liveSection: LiveSectionState = "idle";
  let liveSessionId: string | null = null;
  let liveStreamId: string | null = null;
  let liveOffer: LiveOfferView | null = null;
  let liveViewerId: string | null = null;
  let liveAccounting: LiveAccountingView | null = null;
  let liveDegradationReasons: readonly string[] = [];
  let liveReconnect: {
    attempts: number;
    nextAttemptAtMs: number | null;
    lastFailureClass: string;
    lastReport: { resumeFromOrdinal: number; replayCount: number; gapSkipped: number } | null;
  } | null = null;
  let liveOutcome: { outcome: "completed" | "stopped" | "failed"; failureClass?: string } | null =
    null;
  // W706 live stall episode tracking (the frame-player seam's live analog).
  let liveStallActive = false;

  function setStatus(next: ViewerStatus): void {
    // W706: every ACTUAL transition is a lifecycle event (from !== to;
    // no-op setStatus calls emit nothing).
    if (status !== next) telemetry?.stateTransition(status, next);
    status = next;
    if (isStableStatus(next)) lastStableStatus = next;
  }

  function emit(): void {
    const view = buildView();
    for (const listener of listeners) listener(view);
  }

  function buildView(): ViewerViewModel {
    return {
      status,
      connection,
      pendingOperation,
      sessions: sessions.map((entry) => ({ ...entry })),
      session:
        session === null
          ? null
          : {
              ...session,
              rights: { ...session.rights },
              renders: session.renders.map((render) => ({ ...render })),
            },
      rendererSelection:
        rendererSelection === null
          ? null
          : {
              renderers: rendererSelection.renderers.map((option) => ({
                ...option,
                capability: { ...option.capability },
              })),
            },
      playback: playback === null ? null : { ...playback },
      pendingRenderId: status === "outputs-pending" ? pendingRenderId : null,
      live: liveClient === null ? { available: false, note: LIVE_UNAVAILABLE_NOTE } : liveView(),
      telemetry: { enabled: telemetry !== null },
      error,
      connectedAtMs,
    };
  }

  /** The live section of the view-model (a JSON-safe snapshot). */
  function liveView(): LiveAttachedSection {
    return {
      available: true,
      state: liveSection,
      sessionId: liveSessionId,
      streamId: liveStreamId,
      offer: liveOffer === null ? null : { ...liveOffer },
      viewerId: liveViewerId,
      player: livePlayer === null ? null : { ...livePlayer.view() },
      accounting: liveAccounting === null ? null : { ...liveAccounting },
      degradationReasons: [...liveDegradationReasons],
      reconnect:
        liveReconnect === null
          ? null
          : {
              attempts: liveReconnect.attempts,
              maxAttempts: LIVE_RECONNECT_MAX_ATTEMPTS,
              nextAttemptAtMs: liveReconnect.nextAttemptAtMs,
              lastFailureClass: liveReconnect.lastFailureClass,
              lastReport:
                liveReconnect.lastReport === null ? null : { ...liveReconnect.lastReport },
            },
      outcome: liveOutcome === null ? null : { ...liveOutcome },
    };
  }

  /** Tears down the live section: disconnect the stream, forget everything. */
  function teardownLive(): void {
    if (liveStream !== null) {
      // Idempotent by W305's design; the host keeps its transport (the
      // in-process seam's ownership boundary — the wiring draws a fresh one
      // per open). The stream-identity guard in `consumeLive` invalidates
      // any in-flight pull (the zombie guard's live twin).
      liveStream.disconnect();
      liveStream = null;
    }
    livePlayer = null;
    liveSection = "idle";
    liveSessionId = null;
    liveStreamId = null;
    liveOffer = null;
    liveViewerId = null;
    liveAccounting = null;
    liveDegradationReasons = [];
    liveReconnect = null;
    liveOutcome = null;
    liveStallActive = false;
  }

  /**
   * Refreshes the live accounting + degradation snapshot from the stream's
   * honest status (W305's never-silent receipts, verbatim).
   */
  function refreshLiveAccounting(): void {
    if (liveStream === null) return;
    try {
      const status = liveStream.status();
      liveAccounting = { ...status.accounting };
      liveDegradationReasons = [...status.degradationReasons];
    } catch (err) {
      liveFail(err);
    }
  }

  /** W706 stall-episode edge for the live player (one event per episode). */
  function liveStallCheck(): void {
    if (livePlayer === null) return;
    const view = livePlayer.view();
    if (liveSection === "playing" && view.buffering) {
      if (!liveStallActive) {
        liveStallActive = true;
        telemetry?.rebufferStall({
          // The live analog of the frame-player seam: the stall's frame facts
          // from the presentation buffer (the last displayed frame, the
          // frames applied, all of them available — the missing one is the
          // not-yet-arrived live edge).
          frameIndex: view.lastDisplayedFrame ?? 0,
          frameCount: view.frameCount,
          availableFrames: view.frameCount,
        });
      }
    } else {
      liveStallActive = false;
    }
  }

  /**
   * The live consumption loop: pulls delivery events one at a time
   * (viewer-driven backpressure), applying each to the live player and the
   * accounting surface. Exits on a terminal/consuming-end event (the
   * reconnect path restarts it) and is invalidated by any live teardown
   * through the stream-identity guard (the zombie guard's live twin).
   *
   * A THROWN failure from the stream (integrity violation, transport death,
   * …) is classified here and NEVER becomes an unhandled rejection (the
   * W706 poisoned-dispatch-chain lesson): a retryable class opens the next
   * reconnect window; every other class lands the terminal error state.
   */
  async function consumeLive(stream: LiveStreamHandle): Promise<void> {
    for (;;) {
      let event: LiveDeliveryEvent | null;
      try {
        event = await stream.nextEvent();
      } catch (err) {
        if (liveStream !== stream) return; // torn down or replaced mid-flight
        handleLiveStreamError(err);
        return;
      }
      if (liveStream !== stream) return; // torn down or replaced mid-flight
      if (event === null) return; // not consumable now (handled by the events)
      applyLiveEvent(event);
      if (liveStream !== stream) return; // a terminal event tore it down
    }
  }

  /**
   * The W305 failure class of a thrown live error, when it carries one (the
   * adapters map `LiveOutputError`s onto the viewer model with the class
   * verbatim in `details.liveFailureClass`); `null` for classless failures.
   */
  function liveFailureClassOf(err: unknown): string | null {
    if (isViewerControlError(err)) {
      const w305Class = err.details.liveFailureClass;
      return typeof w305Class === "string" ? w305Class : null;
    }
    return null;
  }

  /**
   * Classifies a THROWN live failure: the retryable classes (`transport-failed`;
   * see `./live-backoff.ts`) open the next reconnect window — every other
   * class (and any classless failure) is the terminal `liveFail` path.
   */
  function handleLiveStreamError(err: unknown): void {
    const failureClass = liveFailureClassOf(err);
    if (failureClass !== null && isLiveRetryableFailureClass(failureClass)) {
      openReconnectWindow(failureClass);
      return;
    }
    liveFail(err);
  }

  /** Applies ONE delivery event to the live section (never silent). */
  function applyLiveEvent(event: LiveDeliveryEvent): void {
    switch (event.kind) {
      case "window": {
        if (livePlayer === null) return;
        const result = livePlayer.applyWindow(event.window, event.payload);
        if (!result.ok) {
          liveFail(
            new ViewerControlError(
              result.error.failureClass,
              result.error.message,
              result.error.details,
            ),
          );
          return;
        }
        refreshLiveAccounting();
        liveStallCheck();
        emit();
        return;
      }
      case "window-skipped":
      case "reconnect-gap": {
        // The session already accounted the skip/gap into its own counts —
        // the accounting snapshot is the honest source; nothing is invented
        // here. (The event itself is never swallowed: the counts moved.)
        refreshLiveAccounting();
        emit();
        return;
      }
      case "connection-lost": {
        openReconnectWindow("connection-lost");
        return;
      }
      case "session-closed": {
        const outcome = event.outcome;
        if (outcome === "failed") {
          const w305Class: LiveOutputFailureClass = event.failureClass ?? "protocol-violation";
          liveFail(
            new ViewerControlError(
              LIVE_FAILURE_CLASS_MAP[w305Class],
              `live output session failed: ${w305Class}`,
              {
                liveFailureClass: w305Class,
                outcome,
              },
            ),
          );
          return;
        }
        // Completed/stopped: an honest end — the presentation holds the last
        // frame; the outcome is carried verbatim for the pane.
        liveOutcome = {
          outcome,
          ...(event.failureClass === undefined ? {} : { failureClass: event.failureClass }),
        };
        liveReconnect = null;
        liveSection = "ended";
        setStatus("live-ended");
        refreshLiveAccounting();
        emit();
        return;
      }
    }
  }

  /**
   * The live terminal failure path: classified error view (W706 event),
   * honest teardown, and the error landing with `openLive` as the retry
   * command (a retryable live failure re-opens the live stream; a rights
   * denial is not retryable — never a retry storm).
   */
  function liveFail(err: unknown): void {
    const liveError = errorViewFrom("openLive", err);
    teardownLive();
    telemetry?.errorOccurred(liveError);
    error = liveError;
    retryCommand = { type: "openLive" };
    // The stable landing context after a live failure: the session detail
    // (the stream is torn down — never back into a live status).
    setStatus("session-detail");
    setStatus("error");
    emit();
  }

  /**
   * Opens the NEXT reconnect window for a retryable failure class (or the
   * classless `connection-lost` event): the PURE backoff decision over the
   * fired-attempt count. At the cap the failure is terminal (named
   * honestly — the schedule's own reason, never a retry storm); otherwise the
   * attempt is scheduled at `now + delay` in the injected clock domain and
   * the machine enters `live-reconnecting` (the presentation holds its
   * frame — the honest wait; `liveTick` fires the attempt when due).
   */
  function openReconnectWindow(failureClass: string): void {
    const attemptsSoFar = liveReconnect?.attempts ?? 0;
    const decision = liveReconnectDecision(failureClass, attemptsSoFar);
    if (decision.action === "terminal") {
      liveFail(
        new ViewerControlError(
          "network",
          `live output stopped: ${decision.reason} after ${String(attemptsSoFar)} reconnect attempt${attemptsSoFar === 1 ? "" : "s"}`,
          {
            // The W305-family class standing in for the classless
            // connection loss (the retryable family), the class that
            // actually triggered this window, and the fired count.
            liveFailureClass: "transport-failed",
            triggeringFailureClass: failureClass,
            attempts: attemptsSoFar,
          },
        ),
      );
      return;
    }
    liveReconnect = {
      attempts: decision.attempt,
      nextAttemptAtMs: nowMs() + decision.delayMs,
      lastFailureClass: failureClass,
      lastReport: null,
    };
    liveSection = "reconnecting";
    setStatus("live-reconnecting");
    refreshLiveAccounting();
    emit();
  }

  /**
   * The live tick: advances the presentation playhead while playing, and —
   * the reconnect driver — fires the scheduled attempt when the injected
   * clock reaches it (no timers by constitution; the host's `tick` IS the
   * clock's heartbeat). While reconnecting the playhead is HELD (content is
   * not flowing — the honest presentation of a dropped connection).
   */
  function liveTick(): void {
    if (livePlayer === null) return;
    if (liveSection === "reconnecting") {
      const reconnect = liveReconnect;
      const stream = liveStream;
      if (
        reconnect !== null &&
        reconnect.nextAttemptAtMs !== null &&
        nowMs() >= reconnect.nextAttemptAtMs &&
        stream !== null
      ) {
        fireReconnectAttempt(stream);
        return;
      }
      emit(); // the countdown line derives from (now, nextAttemptAtMs)
      return;
    }
    if (liveSection !== "playing") return; // idle/connecting/ended: nothing advances
    livePlayer.tick();
    refreshLiveAccounting();
    liveStallCheck();
    emit();
  }

  /** Fires the due reconnect attempt (see `liveTick`). */
  function fireReconnectAttempt(stream: LiveStreamHandle): void {
    // Resume AFTER the last applied ordinal: retained windows at or after
    // the resume point are re-delivered (idempotent — counted duplicates),
    // and a resume point older than the retention covers surfaces a counted
    // reconnect-gap (never a silent skip).
    const resumeFromOrdinal = (liveAccounting?.lastAppliedOrdinal ?? -1) + 1;
    try {
      const report = stream.reconnect(resumeFromOrdinal);
      if (liveReconnect !== null) {
        liveReconnect = { ...liveReconnect, nextAttemptAtMs: null, lastReport: report };
      }
      liveSection = "playing";
      setStatus("live-playing");
      refreshLiveAccounting();
      emit();
      void consumeLive(stream);
    } catch (err) {
      // The attempt FIRED and failed: a retryable class consumes the
      // attempt and opens the NEXT window (the schedule's whole point — a
      // capped count of attempts, each absorbing a failure); every other
      // class is the terminal verdict it always was.
      handleLiveStreamError(err);
    }
  }

  /** Tears down the active player (unsubscribe + forget). */
  function teardownPlayer(): void {
    if (unsubscribePlayer !== null) {
      unsubscribePlayer();
      unsubscribePlayer = null;
    }
    activePlayer = null;
    playback = null;
    pendingRenderId = null;
    stallActive = false;
  }

  /** Wires ONE mounted player's view-model into the machine (shared for both kinds). */
  function wirePlayer(player: FramePlayer | SegmentPlayer, initial: PlaybackView): void {
    teardownPlayer();
    activePlayer = player;
    const unsubscribe = player.subscribe((view) => {
      playback = { ...view };
      // W706 playback health, from the players' HONEST seams: the frame
      // player STALLS at a missing frame (it never drops one) — each
      // playing-while-buffering EPISODE emits exactly one rebuffer-stall
      // event with the seam's own counts. The segment player's document is
      // complete at load (buffering constantly false) — nothing is invented
      // for it; a dropped-frame signal does not exist at either seam.
      if (view.kind === "frames") {
        if (view.playback === "playing" && view.buffering) {
          if (!stallActive) {
            stallActive = true;
            telemetry?.rebufferStall({
              frameIndex: view.frameIndex,
              frameCount: view.frameCount,
              availableFrames: view.availableFrames,
            });
          }
        } else {
          stallActive = false;
        }
      } else {
        stallActive = false;
      }
      if (isPlaybackStatus(status)) {
        setStatus(view.playback);
      }
      emit();
    });
    unsubscribePlayer = unsubscribe;
    playback = { ...initial };
  }

  /** Mounts a fresh FRAME player for a frame-sequence output. */
  function mountFramePlayer(): FramePlayer {
    const player = playerFactory({ clock: nowMs });
    wirePlayer(player, player.view());
    return player;
  }

  /** Mounts a fresh SEGMENT player for an animated-segment output. */
  function mountSegmentPlayer(): SegmentPlayer {
    const player = segmentPlayerFactory({ clock: nowMs });
    wirePlayer(player, player.view());
    return player;
  }

  /** The shared failure transition: classified, never swallowed. */
  function fail(operation: string, command: ViewerCommand, err: unknown): void {
    inFlight = false;
    pendingOperation = null;
    error = errorViewFrom(operation, err);
    // W706: the surfaced failure is a telemetry event (the typed error
    // model, verbatim class/message + the viewer-owned remediation hint).
    telemetry?.errorOccurred(error);
    retryCommand = command;
    if (operation === "connect") {
      connection = "disconnected";
      connectedAtMs = null;
    }
    setStatus("error");
    emit();
  }

  /**
   * Runs one async operation: `begin` applies the in-flight status mutation
   * (only when the operation actually starts — a dropped command mutates
   * nothing), the await is fully guarded, `onSuccess` continues the flow
   * INSIDE the guard (its own failures are classified too), and any throw
   * lands in {@link fail}.
   */
  async function run<T>(
    operation: string,
    command: ViewerCommand,
    parts: {
      begin?: () => void;
      operation: () => Promise<T>;
      onSuccess: (value: T) => void | Promise<void>;
    },
  ): Promise<void> {
    if (inFlight) return; // dropped: one in-flight control operation (documented)
    inFlight = true;
    const opEpoch = epoch;
    pendingOperation = operation;
    parts.begin?.();
    emit();
    try {
      const value = await parts.operation();
      if (opEpoch !== epoch) return; // reset happened mid-flight
      await parts.onSuccess(value);
      inFlight = false;
      pendingOperation = null;
      emit();
    } catch (err) {
      if (opEpoch !== epoch) return; // reset happened mid-flight
      fail(operation, command, err);
    }
  }

  /** The render summary derived from an envelope (the `listRenders` shape). */
  function renderSummaryOf(envelope: RenderEnvelope): RenderSummary {
    return {
      renderId: envelope.renderId,
      rendererId: envelope.result.rendererId,
      segmentCount: envelope.result.outputSegments.length,
      provenance: envelope.result.provenance,
      watermarkAfter: envelope.result.watermarkAfter,
    };
  }

  /** Loads a render's output through the ports and mounts the player. */
  async function loadRenderOutput(sessionId: string, renderId: string): Promise<void> {
    // W706: the output load is a TIMED operation (the playback startup
    // timing) — measured on the injected clock from this entry to the
    // mounted/pending landing (failures surface as error-occurred events
    // instead; a failed load emits no timing).
    const startedAtMs = nowMs();
    // 1. The W701 playback gate, live: getRender re-derives rights at now.
    await client.getRender(sessionId, renderId);
    // 2. The playable output through the port (W705: the real W504 playback
    //    provider — list + segment fetch — or the W702 stand-in seam).
    const result = await outputPort.loadOutput(sessionId, renderId);
    if (result.kind === "outputs-pending") {
      // Honest processing state: the render exists, no stored outputs yet
      // (the host-side encode→store step has not run). No player mounts —
      // never a fake one.
      teardownPlayer();
      pendingRenderId = renderId;
      setStatus("outputs-pending");
      telemetry?.operationTiming("load-output", nowMs() - startedAtMs);
      return;
    }
    if (result.kind === "animated-segment") {
      // W706 quality feedback, from the REAL seam: the provider's
      // client-side integrity check (sha-256 re-hash + byte length) passed
      // — the segment reaching the core IS the verified one (a failure
      // would have thrown media-invalid before this point).
      telemetry?.integrityVerified({
        byteLength: result.segment.byteLength,
        frameCount: result.segment.manifest.frameCount,
      });
      // 3a. The real W504 path: mount the SMIL segment player; a malformed
      //     segment/manifest is a classified error (wrapped so the failure
      //     class survives the throw).
      const player = mountSegmentPlayer();
      const loadResult = player.load({
        segment: result.segment,
        manifest: result.segment.manifest,
      });
      if (!loadResult.ok) {
        teardownPlayer();
        throw new ViewerControlError(
          loadResult.error.failureClass,
          loadResult.error.message,
          loadResult.error.details,
        );
      }
      setStatus(player.view().playback);
      telemetry?.operationTiming("load-output", nowMs() - startedAtMs);
      return;
    }
    // 3b. The W502 stand-in path: mount the frame player.
    const player = mountFramePlayer();
    const loadResult = player.load({
      manifest: result.output.manifest,
      frames: result.output.frames,
    });
    if (!loadResult.ok) {
      teardownPlayer();
      throw new ViewerControlError(
        loadResult.error.failureClass,
        loadResult.error.message,
        loadResult.error.details,
      );
    }
    setStatus(player.view().playback);
    telemetry?.operationTiming("load-output", nowMs() - startedAtMs);
  }

  function dispatch(command: ViewerCommand): void {
    switch (command.type) {
      // --- connection / session list ---------------------------------------
      case "connect": {
        // W706: the connect startup is timed on the injected clock
        // (begin → success); the failure path emits error-occurred instead.
        let startedAtMs = 0;
        void run("connect", command, {
          begin: () => {
            startedAtMs = nowMs();
            setStatus("connecting");
            connection = "connecting";
          },
          operation: () => client.listSessions(),
          onSuccess: (result) => {
            sessions = result.sessions.map((entry) => ({ ...entry }));
            connection = "connected";
            const endedAtMs = nowMs();
            connectedAtMs = endedAtMs;
            error = null;
            telemetry?.operationTiming("connect", endedAtMs - startedAtMs);
            setStatus("browsing-sessions");
          },
        });
        return;
      }
      case "disconnect": {
        teardownPlayer();
        teardownLive();
        epoch += 1; // invalidate in-flight resolutions (zombie guard)
        inFlight = false;
        pendingOperation = null;
        sessions = [];
        session = null;
        rendererSelection = null;
        error = null;
        retryCommand = null;
        connection = "disconnected";
        connectedAtMs = null;
        telemetry?.setSessionId(null);
        setStatus("disconnected");
        emit();
        return;
      }
      case "refreshSessions": {
        void run("refreshSessions", command, {
          operation: () => client.listSessions(),
          onSuccess: (result) => {
            sessions = result.sessions.map((entry) => ({ ...entry }));
            error = null;
          },
        });
        return;
      }
      case "createSession": {
        void run("createSession", command, {
          operation: () =>
            client.createSession({
              // The policy is the trust boundary (W701: no user auth yet);
              // the control plane zod-validates the document on arrival.
              authorizationPolicy: command.policy,
              ...(command.sourceLabel !== undefined ? { sourceLabel: command.sourceLabel } : {}),
            }),
          onSuccess: async () => {
            // Refresh the list from the source of truth (the new session is
            // listed by the control plane, not synthesized locally).
            const result = await client.listSessions();
            sessions = result.sessions.map((entry) => ({ ...entry }));
            error = null;
          },
        });
        return;
      }

      // --- session detail ----------------------------------------------------
      case "openSession": {
        void run("openSession", command, {
          operation: async () => {
            // Both reads must succeed — a denied render list fails the whole
            // open (fail-closed: no partial session view).
            const [detail, renders] = await Promise.all([
              client.getSession(command.sessionId),
              client.listRenders(command.sessionId),
            ]);
            return { detail, renders };
          },
          onSuccess: (value) => {
            session = {
              sessionId: value.detail.session.sessionId,
              status: value.detail.session.status,
              createdAt: value.detail.session.createdAtIso,
              rights: value.detail.rightsCapabilities,
              renders: value.renders.renders.map((render) => ({ ...render })),
            };
            // W706: correlation with the viewer's opaque session-id
            // convention — every event from here on carries it.
            telemetry?.setSessionId(value.detail.session.sessionId);
            rendererSelection = null;
            teardownPlayer();
            teardownLive();
            error = null;
            setStatus("session-detail");
          },
        });
        return;
      }
      case "closeSession": {
        session = null;
        rendererSelection = null;
        teardownPlayer();
        teardownLive();
        error = null;
        telemetry?.setSessionId(null);
        setStatus("browsing-sessions");
        emit();
        return;
      }
      case "terminateSession": {
        void run("terminateSession", command, {
          operation: () => client.terminateSession(command.sessionId),
          onSuccess: async () => {
            if (session !== null && session.sessionId === command.sessionId) {
              session = null;
              rendererSelection = null;
              teardownPlayer();
              teardownLive();
              telemetry?.setSessionId(null);
            }
            const result = await client.listSessions();
            sessions = result.sessions.map((entry) => ({ ...entry }));
            error = null;
            setStatus(session === null ? "browsing-sessions" : "session-detail");
          },
        });
        return;
      }

      // --- renderer selection / render creation ------------------------------
      case "beginRender": {
        void run("beginRender", command, {
          operation: () => client.listRenderers(),
          onSuccess: (result) => {
            // W703: the selection view carries the DERIVED options (pure
            // `./selection-plan.ts`): each listed capability plus its
            // affordance against the open session's fail-closed rights.
            // `session` is non-null on the real path (selection is entered
            // from session-detail); `null` rights fail closed in the plan.
            rendererSelection = {
              renderers: deriveRendererOptions(result.renderers, session?.rights ?? null),
            };
            error = null;
            setStatus("renderer-selection");
          },
        });
        return;
      }
      case "cancelRenderSelection": {
        rendererSelection = null;
        error = null;
        setStatus("session-detail");
        emit();
        return;
      }
      case "createRender": {
        const sessionId = session?.sessionId;
        if (sessionId === undefined) return;
        const input = {
          rendererId: command.rendererId,
          ...(command.rendererVersion !== undefined
            ? { rendererVersion: command.rendererVersion }
            : {}),
          ...(command.outputProfile !== undefined ? { outputProfile: command.outputProfile } : {}),
          styleConfig: {
            ...(command.styleId !== undefined ? { styleId: command.styleId } : {}),
            ...(command.config !== undefined ? { config: command.config } : {}),
          },
        };
        void run("createRender", command, {
          begin: () => {
            rendererSelection = null;
            // The stable landing context while the render flow runs: the
            // session detail (selection was consumed by this command).
            setStatus("session-detail");
            setStatus("render-queued");
          },
          operation: async () => {
            const envelope = await client.createRender(sessionId, input);
            // The render WAS created: list it (same shape `listRenders`
            // produces) even if the output load below fails — that part
            // succeeded and the view stays honest about it.
            if (session !== null) {
              session = { ...session, renders: [...session.renders, renderSummaryOf(envelope)] };
            }
            setStatus("loading-output");
            emit();
            await loadRenderOutput(sessionId, envelope.renderId);
          },
          onSuccess: () => {
            error = null;
          },
        });
        return;
      }
      case "selectRender": {
        const sessionId = session?.sessionId;
        if (sessionId === undefined) return;
        void run("selectRender", command, {
          begin: () => {
            teardownPlayer();
            teardownLive(); // one presentation at a time (documented)
            // Stable landing context if the load fails: the session detail.
            setStatus("session-detail");
            setStatus("loading-output");
          },
          operation: async () => {
            await loadRenderOutput(sessionId, command.renderId);
          },
          onSuccess: () => {
            error = null;
          },
        });
        return;
      }
      case "closePlayback": {
        teardownPlayer();
        error = null;
        setStatus("session-detail");
        emit();
        return;
      }

      // --- live output (W704) -----------------------------------------------
      case "openLive": {
        const sessionId = session?.sessionId;
        if (session === null || sessionId === undefined || liveClient === null) return; // dropped
        // FAIL-CLOSED RIGHTS PRE-CHECK (the W701-derived surface): live
        // delivery requires the `liveDelivery` capability — a session
        // without it never sends a request (the live host's own W305 gate
        // re-derives at the offer; both sides hold, defense in depth).
        if (session.rights.canDeliverLive !== true) {
          const rightsError = toErrorView(
            "openLive",
            "rights-denied",
            "this session's authorization policy does not grant live delivery (canDeliverLive is false) — the live output was never requested",
          );
          telemetry?.errorOccurred(rightsError);
          error = rightsError;
          retryCommand = command; // not retryable: the Retry button never shows
          setStatus("error");
          emit();
          return;
        }
        let liveStartedAtMs = 0;
        void run("openLive", command, {
          begin: () => {
            liveStartedAtMs = nowMs();
            teardownPlayer(); // one presentation at a time (documented)
            teardownLive();
            // Stable landing context if the open fails: the session detail.
            setStatus("session-detail");
            setStatus("live-connecting");
            liveSection = "connecting";
            liveSessionId = sessionId;
            liveStreamId = null;
            liveOffer = null;
            liveViewerId = null;
            liveAccounting = null;
            liveDegradationReasons = [];
            liveReconnect = null;
            liveOutcome = null;
          },
          operation: async () => {
            try {
              return await liveClient.requestLive(sessionId);
            } catch (err) {
              // The open FAILED (rights denial, typed reject, transport
              // death…): the connecting section never existed — reset it,
              // or the live pane would keep claiming "Requesting the live
              // offer…" forever (a dishonest state after a terminal
              // failure). The error itself lands in `run`'s `fail` path.
              teardownLive();
              throw err;
            }
          },
          onSuccess: (attached) => {
            liveStream = attached.stream;
            liveOffer = attached.offer;
            liveViewerId = attached.viewerId;
            liveStreamId = attached.offer.streamId;
            livePlayer = createLivePlayer({ clock: nowMs });
            liveSection = "playing";
            liveAccounting = null;
            liveDegradationReasons = [];
            liveReconnect = null;
            liveOutcome = null;
            error = null;
            setStatus("live-playing");
            // W706: the live open dance is a TIMED operation (offer →
            // validate → attach), measured on the injected clock — the
            // same startup-timing posture as `connect` / `load-output`.
            telemetry?.operationTiming("openLive", nowMs() - liveStartedAtMs);
            void consumeLive(attached.stream);
          },
        });
        return;
      }
      case "closeLive": {
        teardownLive();
        error = null;
        setStatus("session-detail");
        emit();
        return;
      }

      // --- playback (forwarded to the active player) ---------------------------
      case "play": {
        activePlayer?.play();
        return;
      }
      case "pause": {
        activePlayer?.pause();
        return;
      }
      case "replay": {
        activePlayer?.replay();
        return;
      }
      case "seek": {
        activePlayer?.seekToMs(command.positionMs);
        return;
      }
      case "stepForward": {
        activePlayer?.stepForward();
        return;
      }
      case "stepBackward": {
        activePlayer?.stepBackward();
        return;
      }
      case "setLoop": {
        activePlayer?.setLoop(command.loop);
        return;
      }
      case "tick": {
        activePlayer?.tick();
        liveTick();
        return;
      }

      // --- telemetry (W706) -----------------------------------------------------
      case "sendFeedback": {
        // Structured user feedback: recorded through the telemetry emitter
        // (the closed vocabulary validates the kind; an invalid kind is
        // counted as a drop — never thrown, never a viewer error). The view
        // does not change — the affordance is fire-and-forget by design.
        telemetry?.userFeedback(command.feedback);
        return;
      }

      // --- error recovery -------------------------------------------------------
      case "retry": {
        if (error === null || retryCommand === null || !error.retryable) return;
        const commandToRetry = retryCommand;
        error = null;
        retryCommand = null;
        setStatus(lastStableStatus);
        emit();
        dispatch(commandToRetry);
        return;
      }
      case "dismissError": {
        if (error === null) return;
        error = null;
        retryCommand = null;
        setStatus(lastStableStatus);
        emit();
        return;
      }
    }
  }

  const core: ViewerCore = {
    dispatch,
    view: buildView,
    subscribe(listener: (view: ViewerViewModel) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return core;
}
