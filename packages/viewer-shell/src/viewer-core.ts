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
 *                                   playing → ended
 * ANY state → error (classified, retryability-flagged) → retry | dismiss
 * ```
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
 * Playback: the core owns one {@link FramePlayer} per loaded output (created
 * through the injectable factory with the core's clock) and forwards the
 * playback commands (`play`/`pause`/`seek`/`step*`/`setLoop`/`replay`/`tick`)
 * to it; the player's view-model is embedded in the viewer view-model, and
 * while a playback is mounted the viewer status mirrors the player's
 * playback state (`ready`/`playing`/`paused`/`ended`).
 *
 * Live output is HONESTLY unavailable (W704/W705): the view-model carries a
 * constant `live` section stating that; the shell never fakes a live state.
 *
 * KNOWN LIMITATIONS (W702, deliberate):
 *
 * - one in-flight control operation at a time — async commands issued while
 *   an operation is pending are DROPPED (the pending state is visible in the
 *   view-model and the UI disables controls; single-user shell, documented);
 * - no user authentication (the caller-supplied authorization policy is the
 *   trust boundary — inherited W701 limitation);
 * - render OUTPUT retrieval runs through the W504-pending stand-in seam
 *   (see `./ports.ts`);
 * - `dismissError`/`retry` return to the last STABLE status
 *   (`browsing-sessions`, `session-detail`, `renderer-selection`, a playback
 *   status, or `disconnected`) — never back into an in-flight status.
 */
import { createViewerDefaultClock } from "./default-clock.ts";
import type {
  AuthorizationPolicy,
  RendererCapability,
  RightsCapabilities,
} from "@sporta/contracts";
import type { RenderEnvelope, RenderSummary, SessionSummary } from "@sporta/control-api";
import { errorViewFrom } from "./errors.ts";
import { ViewerControlError } from "./errors.ts";
import type { ErrorView } from "./errors.ts";
import { createFramePlayer } from "./player.ts";
import type { FramePlayer, PlayerViewModel } from "./player.ts";
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

/** Renderer selection view: capability-driven (W703 posture), never hard-coded. */
export interface RendererSelectionView {
  renderers: RendererCapability[];
}

/** The honest live-output section (constant until W704/W705). */
export interface LiveView {
  available: false;
  note: string;
}

/** The full viewer view-model — a JSON-safe snapshot of the machine. */
export interface ViewerViewModel {
  status: ViewerStatus;
  connection: ConnectionState;
  /** The in-flight control operation (drives UI disable states), or null. */
  pendingOperation: string | null;
  sessions: SessionSummary[];
  session: SessionDetailView | null;
  rendererSelection: RendererSelectionView | null;
  playback: PlayerViewModel | null;
  live: LiveView;
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
  | { type: "retry" }
  | { type: "dismissError" };

/** Player factory seam (tests inject fakes; default: the real player). */
export type PlayerFactory = (options: { clock: () => number }) => FramePlayer;

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
  /** Player factory (default: {@link createFramePlayer}). */
  playerFactory?: PlayerFactory;
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

/** The honest live-output note (W704/W705 pending — never faked). */
export const LIVE_UNAVAILABLE_NOTE =
  "Live output is not yet available: live delivery arrives with W704 (live playback integration) and W705/W706 (WebRTC output + real-browser E2E). This viewer plays supported batch outputs only.";

const PLAYBACK_STATUSES: readonly ViewerStatus[] = ["ready", "playing", "paused", "ended"];

function isPlaybackStatus(status: ViewerStatus): boolean {
  return PLAYBACK_STATUSES.includes(status);
}

const STABLE_STATUSES: readonly ViewerStatus[] = [
  "disconnected",
  "browsing-sessions",
  "session-detail",
  "renderer-selection",
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
  let playback: PlayerViewModel | null = null;
  let error: ErrorView | null = null;
  let retryCommand: ViewerCommand | null = null;

  let activePlayer: FramePlayer | null = null;
  let unsubscribePlayer: (() => void) | null = null;
  // Operation epoch: bumped by `disconnect` so a resolution landing after a
  // hard reset is dropped instead of mutating a reset machine (zombie guard).
  let epoch = 0;

  function setStatus(next: ViewerStatus): void {
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
          : { renderers: rendererSelection.renderers.map((renderer) => ({ ...renderer })) },
      playback: playback === null ? null : { ...playback },
      live: { available: false, note: LIVE_UNAVAILABLE_NOTE },
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
  }

  /** Mounts a fresh player for a loaded output and wires its events. */
  function mountPlayer(): FramePlayer {
    teardownPlayer();
    const player = playerFactory({ clock: nowMs });
    activePlayer = player;
    unsubscribePlayer = player.subscribe((view) => {
      playback = { ...view };
      if (isPlaybackStatus(status)) {
        setStatus(view.playback);
      }
      emit();
    });
    playback = { ...player.view() };
    return player;
  }

  /** The shared failure transition: classified, never swallowed. */
  function fail(operation: string, command: ViewerCommand, err: unknown): void {
    inFlight = false;
    pendingOperation = null;
    error = errorViewFrom(operation, err);
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
    // 1. The W701 playback gate, live: getRender re-derives rights at now.
    await client.getRender(sessionId, renderId);
    // 2. The playable output (W502 shape) through the stand-in seam.
    const output = await outputPort.loadOutput(sessionId, renderId);
    // 3. Mount the player; a malformed manifest is a classified error
    //    (wrapped so the failure class survives the throw).
    const player = mountPlayer();
    const loadResult = player.load({ manifest: output.manifest, frames: output.frames });
    if (!loadResult.ok) {
      teardownPlayer();
      throw new ViewerControlError(
        loadResult.error.failureClass,
        loadResult.error.message,
        loadResult.error.details,
      );
    }
    setStatus(player.view().playback);
  }

  function dispatch(command: ViewerCommand): void {
    switch (command.type) {
      // --- connection / session list ---------------------------------------
      case "connect": {
        void run("connect", command, {
          begin: () => {
            setStatus("connecting");
            connection = "connecting";
          },
          operation: () => client.listSessions(),
          onSuccess: (result) => {
            sessions = result.sessions.map((entry) => ({ ...entry }));
            connection = "connected";
            connectedAtMs = nowMs();
            error = null;
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
            rendererSelection = { renderers: result.renderers.map((entry) => ({ ...entry })) };
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
