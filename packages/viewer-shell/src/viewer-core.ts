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
 * ANY state → error (classified, retryability-flagged) → retry | dismiss
 * ```
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
 * Live output is HONESTLY unavailable (W704): the view-model carries a
 * constant `live` section stating that; the shell never fakes a live state.
 * (W705 delivered the real BATCH playback path — stored W504 segments —
 * which is what this machine plays; live remains W704's.)
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
 * KNOWN LIMITATIONS (W702 + W705, deliberate):
 *
 * - one in-flight control operation at a time — async commands issued while
 *   an operation is pending are DROPPED (the pending state is visible in the
 *   view-model and the UI disables controls; single-user shell, documented);
 * - no user authentication (the caller-supplied authorization policy is the
 *   trust boundary — inherited W701 limitation);
 * - `dismissError`/`retry` return to the last STABLE status
 *   (`browsing-sessions`, `session-detail`, `renderer-selection`, a playback
 *   status, or `disconnected`) — never back into an in-flight status.
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
import type { ErrorView } from "./errors.ts";
import { createFramePlayer } from "./player.ts";
import type { FramePlayer, PlayerViewModel } from "./player.ts";
import { createSegmentPlayer } from "./segment-player.ts";
import type { SegmentPlayer, SegmentPlayerViewModel } from "./segment-player.ts";
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

/** The honest live-output section (constant until W704). */
export interface LiveView {
  available: false;
  note: string;
}

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
   * `performance.now()`; production must never rely on the default.
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

/** The honest live-output note (W704 pending — never faked). */
export const LIVE_UNAVAILABLE_NOTE =
  "Live output is not yet available: live delivery arrives with W704 (live playback integration) and W305 (delivery). This viewer plays stored batch outputs only (W504 segments, wired in W705).";

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
      live: { available: false, note: LIVE_UNAVAILABLE_NOTE },
      telemetry: { enabled: telemetry !== null },
      error,
      connectedAtMs,
    };
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
