/**
 * The browser bootstrap (W702 + W705) — vanilla TypeScript, served as an ES
 * module (transpiled on the fly by `serveViewer`; see `src/serve.ts`).
 *
 * Wires the REAL stack against the real HTTP control server:
 *
 * - `createHttpControlClient` (same-origin `/control` proxy) for the
 *   control-plane operations;
 * - `createHttpPlaybackProvider` (same-origin `/control` proxy → the REAL
 *   W504 playback routes) for the playable stored output — the DEFAULT
 *   viewer path since W705 (the W702 stand-in `/output` route provider
 *   remains in the package for its own tests);
 * - `createViewerCore` (the headless, fully tested state machine) as the
 *   single source of UI truth — this file renders view-models, it makes no
 *   decisions (all logic lives in the tested `src/` modules);
 * - `mountPlayer` (the thin DOM adapter) for the playback stage — frame
 *   sequences (the stand-in path) AND the W504 SMIL segment document (the
 *   real path: the adapter commands the presented document's actual SMIL
 *   timeline via the view's sync instruction);
 * - memo guards over the pure pane signatures (`./src/pane-signature.ts`):
 *   the sessions pane and error banner re-render ONLY when their rendered
 *   fields change — while a clip plays (per-tick emissions) the create-session
 *   form keeps its focus and text (the bug the signatures fix);
 * - the renderer-selection pane (W703) renders the DERIVED option views
 *   from `./src/selection-plan.ts` (capability-driven: selectable or greyed
 *   out with the machine reason + note; selectable buttons dispatch the
 *   plan's renderer-only selection payload);
 * - the W706 TELEMETRY wiring: `createHttpTelemetrySink` (the browser-safe
 *   bridge, DEV-GRADE and honestly labeled — each event POSTed to the dev
 *   viewer server's own `/telemetry` route, which writes through the REAL
 *   JSONL file sink under a declared path; failures are counted, never
 *   fatal) feeds `createViewerCore`'s `telemetrySink`, and the playback
 *   section renders the pure `./src/telemetry-plan.ts` affordance (the
 *   structured feedback buttons + the privacy disclosure note).
 * - the W704 LIVE SURFACE: the live section renders the PURE
 *   `./src/live-plan.ts` status plan (headline, status line, W305 delivery
 *   accounting, degradation reasons, the reconnect countdown, the terminal
 *   outcome — every number from a real seam, absent metrics absent) plus
 *   the live stage through `mountPlayer` (`./src/dom-adapter.ts` presents
 *   the live view-model like the batch players). HONEST BOUNDARY: this
 *   BROWSER build wires NO live client — W305's live output is an
 *   in-process contract (no real RTCPeerConnection exists in this
 *   monorepo), and the dev server does not bridge the offer dance over
 *   HTTP (inventing a wire protocol is out of scope — see `LIVE.md`), so
 *   the machine's `live` section stays honestly unavailable HERE while
 *   the full live path is exercised headlessly over the REAL W305
 *   transport in `test/live-e2e.test.ts`. The glue below is complete so a
 *   future bridge needs no bootstrap surgery.
 *
 * Honest testing boundary: this module is DOM glue — it is compile-checked
 * but not unit-tested (no DOM-testing dependency by constitution); the
 * logic behind every state it renders is covered by the `src/` tests, and
 * the real-provider data path is covered headlessly by
 * `test/playback-e2e.test.ts`, while the exact telemetry composition this
 * module wires (HTTP bridge sink → dev `/telemetry` route → JSONL file) is
 * covered headlessly by `test/telemetry-e2e.test.ts`. Real-browser paint
 * E2E remains OPEN future work.
 */
import type { AuthorizationPolicy } from "@sporta/contracts";
import { createHttpControlClient } from "../src/http-client.ts";
import { createHttpPlaybackProvider } from "../src/playback-provider.ts";
import { mountPlayer } from "../src/dom-adapter.ts";
import type { PlayerDom } from "../src/dom-adapter.ts";
import { detailPanePlan } from "../src/detail-plan.ts";
import type { DetailMode } from "../src/detail-plan.ts";
import { liveStatusPlan } from "../src/live-plan.ts";
import type { LiveStatusPlan } from "../src/live-plan.ts";
import { selectionRequestOf } from "../src/selection-plan.ts";
import { createHttpTelemetrySink } from "../src/telemetry-http-sink.ts";
import { telemetryAffordance } from "../src/telemetry-plan.ts";
import { createViewerCore } from "../src/viewer-core.ts";
import type { ViewerViewModel } from "../src/viewer-core.ts";
import { errorBannerSignature, sessionsPaneSignature } from "../src/pane-signature.ts";

/**
 * Demo authorization policy (full allow, far-future expiry). W701 has no
 * user authentication yet (M7) — the caller-supplied policy IS the trust
 * boundary; the control plane zod-validates whatever arrives.
 */
const DEMO_POLICY: AuthorizationPolicy = {
  policyId: "policy-viewer-demo",
  allowedOperations: [
    "analysis",
    "transformation",
    "liveDelivery",
    "derivativeGeneration",
    "storage",
    "sharing",
  ],
  assertedBy: "sporta-viewer-demo",
  expiresAtIso: "2099-12-31T23:59:59.000Z",
};

const connectionEl = document.getElementById("connection") as HTMLElement;
const statusLabelEl = document.getElementById("status-label") as HTMLElement;
const errorBannerEl = document.getElementById("error-banner") as HTMLElement;
const sessionsPaneEl = document.getElementById("sessions-pane") as HTMLElement;
const detailPaneEl = document.getElementById("detail-pane") as HTMLElement;

const client = createHttpControlClient({ baseUrl: "/control" });
// The REAL W504 playback routes through the same-origin /control proxy
// (the default viewer path since W705 — the stand-in /output provider
// remains in the package for its own tests).
const outputProvider = createHttpPlaybackProvider({ baseUrl: "/control" });

// W706: the REAL telemetry sink for the browser — the dev-grade HTTP bridge
// to the dev viewer server's own /telemetry route (same-origin; that route
// validates every event against the closed vocabulary and writes through
// the real JSONL file sink under the declared path). Honestly labeled
// DEV-GRADE: unauthenticated + local (the W701 trust boundary inherited);
// transport failures are counted inside the sink, never fatal.
const telemetrySink = createHttpTelemetrySink({ baseUrl: "/telemetry" });

const core = createViewerCore({
  client,
  output: outputProvider,
  telemetrySink,
  nowMs: () => performance.now(),
});

// --- stable playback DOM (kept across renders; only values update) --------
/** The mounted playback section (null while no playback section is mounted). */
let playbackSectionEl: HTMLElement | null = null;
let playerDom: PlayerDom | null = null;
let playerStageEl: HTMLElement | null = null;
let seekEl: HTMLInputElement | null = null;
let playButtonEl: HTMLButtonElement | null = null;
let loopEl: HTMLInputElement | null = null;
let provenanceEl: HTMLElement | null = null;

function text(tag: string, className?: string, content?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className !== undefined) el.className = className;
  if (content !== undefined) el.textContent = content;
  return el;
}

function button(
  label: string,
  onClick: () => void,
  options: { primary?: boolean; disabled?: boolean } = {},
): HTMLButtonElement {
  const el = document.createElement("button");
  el.textContent = label;
  if (options.primary === true) el.className = "primary";
  el.disabled = options.disabled === true;
  el.addEventListener("click", onClick);
  return el;
}

function heading(title: string): HTMLElement {
  return text("h2", undefined, title);
}

// --- error banner -----------------------------------------------------------

/** Last rendered banner signature (memo guard — see ./src/pane-signature.ts). */
let lastErrorBannerSignature: string | null = null;

function renderErrorBanner(view: ViewerViewModel): void {
  const signature = errorBannerSignature(view);
  if (signature === lastErrorBannerSignature) return;
  lastErrorBannerSignature = signature;
  if (view.error === null) {
    errorBannerEl.style.display = "none";
    errorBannerEl.replaceChildren();
    return;
  }
  const error = view.error;
  errorBannerEl.style.display = "block";
  const parts: HTMLElement[] = [];
  const classTag = text("span", "failure-class", error.failureClass);
  parts.push(
    classTag,
    text("strong", undefined, error.label),
    text("span", undefined, error.message),
  );
  const actions = text("span");
  actions.style.marginLeft = "10px";
  if (error.retryable) {
    actions.append(button("Retry", () => core.dispatch({ type: "retry" })));
  }
  actions.append(
    button("Dismiss", () => core.dispatch({ type: "dismissError" })),
    text("span", "muted", ` (operation: ${error.operation})`),
  );
  parts.push(actions);
  errorBannerEl.replaceChildren(...parts);
}

// --- sessions pane (left) -----------------------------------------------------

/**
 * Last rendered pane signature (memo guard — see ./src/pane-signature.ts).
 * While a clip plays the player emits on every host tick; the pane re-render
 * is skipped unless one of its rendered fields actually changed (the form
 * keeps focus and its text).
 */
let lastSessionsPaneSignature: string | null = null;

function renderSessionsPane(view: ViewerViewModel): void {
  const signature = sessionsPaneSignature(view);
  if (signature === lastSessionsPaneSignature) return;
  lastSessionsPaneSignature = signature;
  const busy = view.pendingOperation !== null;
  const parts: HTMLElement[] = [heading("Sessions")];

  const list = document.createElement("ul");
  list.className = "plain";
  if (view.sessions.length === 0) {
    const item = document.createElement("li");
    item.append(text("span", "muted", "No sessions yet."));
    list.append(item);
  }
  for (const session of view.sessions) {
    const item = document.createElement("li");
    const left = text("span", undefined, session.id);
    const meta = text(
      "span",
      "muted",
      `${session.state}${session.sourceLabel !== undefined ? ` · ${session.sourceLabel}` : ""}`,
    );
    left.append(meta);
    item.append(
      left,
      button("Open", () => core.dispatch({ type: "openSession", sessionId: session.id }), {
        disabled: busy,
      }),
    );
    list.append(item);
  }
  parts.push(list);

  const createHeading = heading("Create session");
  const form = document.createElement("form");
  const policyLabel = text(
    "label",
    undefined,
    "Authorization policy (demo, full allow — trust boundary)",
  );
  const policyArea = document.createElement("textarea");
  policyArea.value = JSON.stringify(DEMO_POLICY, null, 2);
  const sourceLabel = text("label", undefined, "Source label (optional)");
  const sourceInput = document.createElement("input");
  sourceInput.placeholder = "e.g. fixture-clip-01";
  const submit = button(
    "Create session",
    () => {
      let policy: unknown;
      try {
        policy = JSON.parse(policyArea.value);
      } catch (err) {
        // Local JSON parse failure: surfaced honestly, never swallowed.
        window.alert(
          `Policy JSON is not valid: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      core.dispatch({
        type: "createSession",
        policy: policy as AuthorizationPolicy,
        ...(sourceInput.value.trim().length > 0 ? { sourceLabel: sourceInput.value.trim() } : {}),
      });
    },
    { primary: true, disabled: busy || view.connection !== "connected" },
  );
  form.append(policyLabel, policyArea, sourceLabel, sourceInput, submit);
  parts.push(createHeading, form);

  const actions = text("div");
  actions.style.marginTop = "10px";
  if (view.connection === "connected") {
    actions.append(
      button("Refresh", () => core.dispatch({ type: "refreshSessions" }), { disabled: busy }),
      " ",
      button("Disconnect", () => core.dispatch({ type: "disconnect" }), { disabled: busy }),
    );
  } else {
    actions.append(
      button("Connect", () => core.dispatch({ type: "connect" }), {
        primary: true,
        disabled: view.connection === "connecting",
      }),
    );
  }
  parts.push(actions);

  const liveHeading = heading("Live output");
  // The live line is honest both ways: without a live client the constant
  // note explains exactly why (the W305 in-process seam); with one wired,
  // the coarse section state (the presentation lives in the detail pane).
  const liveNote = text(
    "p",
    "muted",
    view.live.available ? `Live path available — ${view.live.state}.` : view.live.note,
  );
  parts.push(liveHeading, liveNote);

  sessionsPaneEl.replaceChildren(...parts);
}

// --- detail pane (right) --------------------------------------------------------

/** Renders a fresh NON-playback section (the playback plan handles those). */
function renderStaticSection(
  mode: Exclude<DetailMode, "playback">,
  view: ViewerViewModel,
): HTMLElement {
  const section = document.createElement("div");
  switch (mode) {
    case "disconnected":
      section.append(heading("Viewer"));
      section.append(
        text(
          "p",
          "muted",
          view.connection === "connecting"
            ? "Connecting to the control plane…"
            : "Disconnected. Connect to list sessions.",
        ),
      );
      break;
    case "browsing":
      section.append(heading("Sessions"));
      section.append(
        text("p", "muted", "Select a session on the left, or create one with a policy document."),
      );
      break;
    case "session":
      return renderSessionSection(view);
    case "renderer-selection":
      return renderRendererSelection(view);
    case "pending": {
      section.append(heading("Working"));
      const pendingNote =
        view.status === "render-queued"
          ? "Render queued on the control plane…"
          : view.status === "outputs-pending"
            ? "The render exists, but its encoded outputs are not stored yet — the host-side output pipeline (encode → store) has not run for it. Check again once encoding has run."
            : "Loading the render output…";
      section.append(text("p", "muted", pendingNote));
      if (view.status === "outputs-pending" && view.pendingRenderId !== null) {
        const pendingId = view.pendingRenderId;
        section.append(
          button("Check again", () => core.dispatch({ type: "selectRender", renderId: pendingId })),
        );
      }
      break;
    }
    case "error":
      section.append(heading("Error state"));
      section.append(
        text(
          "p",
          "muted",
          "The viewer is in the error state — see the banner above. Retry or dismiss returns to the last stable state.",
        ),
      );
      break;
  }
  return section;
}

function renderDetailPane(view: ViewerViewModel): void {
  // The layout decision is the PURE `detailPanePlan` (tested headlessly):
  // while a playback section is mounted and the status stays a playback
  // status, the plan is ALWAYS `update-playback` — the mounted section (with
  // the live player stage, seek input, and listeners) is reused in place,
  // never replaced by a fresh node (a re-render must never detach the
  // player). The same invariant holds for the LIVE section while the status
  // stays a live status (the stage and status lines update in place).
  const plan = detailPanePlan(view.status, {
    playback: playbackSectionEl !== null,
    live: liveSectionEl !== null,
  });
  switch (plan.kind) {
    case "mount-playback": {
      teardownPlaybackDom();
      teardownLiveDom();
      playbackSectionEl = buildPlaybackSection(view);
      detailPaneEl.replaceChildren(playbackSectionEl);
      return;
    }
    case "update-playback": {
      updatePlaybackSection(view);
      const mounted = playbackSectionEl;
      if (mounted !== null) detailPaneEl.replaceChildren(mounted);
      return;
    }
    case "mount-live": {
      teardownPlaybackDom();
      teardownLiveDom();
      liveSectionEl = buildLiveSection(view);
      detailPaneEl.replaceChildren(liveSectionEl);
      return;
    }
    case "update-live": {
      updateLiveSection(view);
      const mounted = liveSectionEl;
      if (mounted !== null) detailPaneEl.replaceChildren(mounted);
      return;
    }
    case "render-static": {
      if (plan.teardownPlayback) teardownPlaybackDom();
      if (plan.teardownLive) teardownLiveDom();
      detailPaneEl.replaceChildren(renderStaticSection(plan.mode, view));
      return;
    }
  }
}

/** Builds the playback section ONCE; subsequent renders only update it. */
function buildPlaybackSection(view: ViewerViewModel): HTMLElement {
  const section = document.createElement("div");
  section.append(heading("Playback"));

  playerStageEl = document.createElement("div");
  playerStageEl.className = "player-wrap";
  playerDom = mountPlayer(playerStageEl);
  section.append(playerStageEl);

  const controls = document.createElement("div");
  controls.className = "player-controls";
  playButtonEl = button("Play", () => core.dispatch({ type: "play" }));
  const pauseButton = button("Pause", () => core.dispatch({ type: "pause" }));
  const stepBack = button("Step back", () => core.dispatch({ type: "stepBackward" }));
  const stepForward = button("Step forward", () => core.dispatch({ type: "stepForward" }));
  const replayButton = button("Replay", () => core.dispatch({ type: "replay" }));

  seekEl = document.createElement("input");
  seekEl.type = "range";
  seekEl.min = "0";
  seekEl.step = "100";
  seekEl.addEventListener("input", () => {
    const positionMs = Number.parseInt(seekEl?.value ?? "0", 10);
    if (Number.isFinite(positionMs)) core.dispatch({ type: "seek", positionMs });
  });

  const loopLabel = document.createElement("label");
  loopLabel.style.display = "inline";
  loopEl = document.createElement("input");
  loopEl.type = "checkbox";
  loopEl.addEventListener("change", () => {
    core.dispatch({ type: "setLoop", loop: loopEl?.checked === true });
  });
  loopLabel.append(loopEl, " Loop");

  controls.append(
    playButtonEl,
    pauseButton,
    stepBack,
    stepForward,
    replayButton,
    seekEl,
    loopLabel,
  );
  section.append(controls);

  provenanceEl = text("p", "provenance");
  section.append(provenanceEl);

  // W706: the telemetry affordance — every decision (visibility, the offered
  // structured feedback kinds + labels, the privacy note) comes from the
  // PURE `src/telemetry-plan.ts`; this code only renders it. Fire-and-forget
  // by design (no view-model state changes on feedback).
  const telemetrySection = text("div");
  telemetrySection.className = "telemetry-affordance";
  const affordance = telemetryAffordance(view);
  if (affordance.visible) {
    const feedbackRow = text("div");
    feedbackRow.append(text("span", "muted", "Playback feedback (telemetry): "));
    for (const choice of affordance.feedbackChoices) {
      feedbackRow.append(
        button(choice.label, () => core.dispatch({ type: "sendFeedback", feedback: choice.kind })),
      );
    }
    telemetrySection.append(feedbackRow, text("p", "muted", affordance.privacyNote));
  } else {
    telemetrySection.append(
      text(
        "p",
        "muted",
        affordance.status === "recording"
          ? "Viewer telemetry is recording lifecycle/error/quality events; the feedback row appears while a playback is mounted."
          : "Viewer telemetry is not configured on this viewer (no sink wired); no events are recorded.",
      ),
    );
  }
  section.append(telemetrySection);

  const closeRow = text("div");
  closeRow.style.marginTop = "10px";
  closeRow.append(button("Back to session", () => core.dispatch({ type: "closePlayback" })));
  section.append(closeRow);

  updatePlaybackSection(view);
  return section;
}

/** Updates the stable playback section in place. */
function updatePlaybackSection(view: ViewerViewModel): void {
  if (view.playback === null) return;
  const playback = view.playback;
  if (playerDom !== null) playerDom.update(playback);
  if (seekEl !== null) {
    seekEl.max = String(playback.durationMs);
    seekEl.value = String(playback.positionMs);
    seekEl.disabled = view.pendingOperation !== null;
  }
  if (playButtonEl !== null) {
    playButtonEl.disabled = playback.playback === "playing" || playback.playback === "ended";
  }
  if (loopEl !== null) loopEl.checked = playback.loop;
  if (provenanceEl !== null) {
    provenanceEl.textContent =
      playback.kind === "segment"
        ? `${playback.renderer.rendererId}@${playback.renderer.rendererVersion} · style ${playback.renderer.styleId} · ` +
          `segment ${playback.segmentId} · sha256 ${playback.contentHash.slice(0, 12)}… · ${String(playback.frameCount)} frames · ` +
          `${String(playback.durationMs)} ms · ${String(playback.byteLength)} bytes · self-animating SMIL document (W504 stored segment)`
        : `${playback.renderer.rendererId}@${playback.renderer.rendererVersion} · style ${playback.renderer.styleId} · ` +
          `${String(playback.frameCount)} frames @ ${String(playback.output.frameIntervalMs)} ms · ` +
          `output start ${String(playback.output.startMs)} ms · render id from the control plane`;
  }
}

function teardownPlaybackDom(): void {
  playbackSectionEl = null;
  playerDom?.unmount();
  playerDom = null;
  playerStageEl = null;
  seekEl = null;
  playButtonEl = null;
  loopEl = null;
  provenanceEl = null;
}

// --- stable live DOM (kept across renders; only values update) ----------

/** The mounted live section (null while no live section is mounted). */
let liveSectionEl: HTMLElement | null = null;
let livePlayerDom: PlayerDom | null = null;
let liveStageEl: HTMLElement | null = null;
let liveHeadlineEl: HTMLElement | null = null;
let liveStatusLineEl: HTMLElement | null = null;
let liveAccountingEl: HTMLElement | null = null;
let liveDegradationEl: HTMLElement | null = null;
let liveReconnectEl: HTMLElement | null = null;
let liveOutcomeEl: HTMLElement | null = null;

/**
 * Builds the live section ONCE (W704): the stage through `mountPlayer` (the
 * same adapter as the batch players — it presents the live view-model), the
 * status surface from the PURE `liveStatusPlan`, and the close affordance.
 * Subsequent renders only update it (never a fresh node — the presented SVG
 * and the listeners survive every per-tick emission).
 */
function buildLiveSection(view: ViewerViewModel): HTMLElement {
  const section = document.createElement("div");
  liveHeadlineEl = text("h2", undefined, "Live output");
  section.append(liveHeadlineEl);

  liveStageEl = document.createElement("div");
  liveStageEl.className = "player-wrap";
  livePlayerDom = mountPlayer(liveStageEl);
  section.append(liveStageEl);

  liveStatusLineEl = text("p", undefined);
  liveAccountingEl = text("p", "muted");
  liveDegradationEl = text("p", "failure-class");
  liveReconnectEl = text("p", undefined);
  liveOutcomeEl = text("p", undefined);
  section.append(
    liveStatusLineEl,
    liveAccountingEl,
    liveDegradationEl,
    liveReconnectEl,
    liveOutcomeEl,
  );

  const closeRow = text("div");
  closeRow.style.marginTop = "10px";
  closeRow.append(
    button("Back to session", () => core.dispatch({ type: "closeLive" })),
    " ",
    button("Open the live stream", () => core.dispatch({ type: "openLive" })),
  );
  section.append(closeRow);

  updateLiveSection(view);
  return section;
}

/**
 * Updates the stable live section in place: the stage via the adapter (the
 * player's own view-model), every line from the PURE `liveStatusPlan`
 * recomputed on the view (the plan is the only text source — this function
 * renders, it decides nothing).
 */
function updateLiveSection(view: ViewerViewModel): void {
  if (!view.live.available) return; // the section only exists with a client
  const plan: LiveStatusPlan = liveStatusPlan(view.live, performance.now());
  if (livePlayerDom !== null && view.live.player !== null) livePlayerDom.update(view.live.player);
  if (liveHeadlineEl !== null) liveHeadlineEl.textContent = plan.headline;
  if (liveStatusLineEl !== null) liveStatusLineEl.textContent = plan.statusText;
  if (liveAccountingEl !== null) {
    liveAccountingEl.textContent = plan.accountingText ?? "";
    liveAccountingEl.style.display = plan.accountingText === null ? "none" : "block";
  }
  if (liveDegradationEl !== null) {
    liveDegradationEl.textContent = plan.degradationText ?? "";
    liveDegradationEl.style.display = plan.degradationText === null ? "none" : "block";
  }
  if (liveReconnectEl !== null) {
    liveReconnectEl.textContent = plan.reconnectHint ?? "";
    liveReconnectEl.style.display = plan.reconnectHint === null ? "none" : "block";
  }
  if (liveOutcomeEl !== null) {
    liveOutcomeEl.textContent = plan.outcomeText ?? "";
    liveOutcomeEl.style.display = plan.outcomeText === null ? "none" : "block";
  }
}

function teardownLiveDom(): void {
  liveSectionEl = null;
  livePlayerDom?.unmount();
  livePlayerDom = null;
  liveStageEl = null;
  liveHeadlineEl = null;
  liveStatusLineEl = null;
  liveAccountingEl = null;
  liveDegradationEl = null;
  liveReconnectEl = null;
  liveOutcomeEl = null;
}

function renderSessionSection(view: ViewerViewModel): HTMLElement {
  const section = document.createElement("div");
  const session = view.session;
  if (session === null) return section;
  const busy = view.pendingOperation !== null;
  section.append(heading("Session"));
  section.append(
    text("p", undefined, `${session.sessionId} — ${session.status}`),
    text("p", "muted", `created ${session.createdAt}`),
  );

  const rightsHeading = text("p", "muted", "Rights capabilities (fail-closed derivation):");
  const chips = text("div", "chips");
  for (const [name, value] of Object.entries(session.rights)) {
    const chip = text("span", `chip ${value ? "on" : "off"}`, `${name}: ${String(value)}`);
    chips.append(chip);
  }
  section.append(rightsHeading, chips);

  section.append(heading("Renders"));
  const list = document.createElement("ul");
  list.className = "plain";
  if (session.renders.length === 0) {
    const item = document.createElement("li");
    item.append(text("span", "muted", "No renders yet."));
    list.append(item);
  }
  for (const render of session.renders) {
    const item = document.createElement("li");
    const left = text("span", undefined, render.renderId);
    left.append(
      text("span", "muted", ` · ${render.rendererId} · ${String(render.segmentCount)} segments`),
    );
    item.append(
      left,
      button("Play", () => core.dispatch({ type: "selectRender", renderId: render.renderId }), {
        disabled: busy,
      }),
    );
    list.append(item);
  }
  section.append(list);

  const actions = text("div");
  actions.style.marginTop = "10px";
  actions.append(
    button("New render", () => core.dispatch({ type: "beginRender" }), {
      primary: true,
      disabled: busy,
    }),
    " ",
    button("Terminate session", () =>
      core.dispatch({ type: "terminateSession", sessionId: session.sessionId }),
    ),
    " ",
    button("Back to list", () => core.dispatch({ type: "closeSession" })),
  );
  // W704: the live affordance — offered exactly when a live client is wired
  // (the machine fail-closes on rights before any request leaves; the
  // honest unavailable note explains the rest).
  if (view.live.available) {
    actions.append(
      " ",
      button("Open live", () => core.dispatch({ type: "openLive" }), { disabled: busy }),
    );
  }
  section.append(actions);
  return section;
}

function renderRendererSelection(view: ViewerViewModel): HTMLElement {
  // W703: every decision here comes from the DERIVED option views (the pure,
  // headlessly tested `src/selection-plan.ts` derivation over the capability
  // documents + the session's rights). This function renders options; it
  // matches no renderer ids and holds no renderer-specific knowledge.
  const section = document.createElement("div");
  section.append(heading("Choose a renderer"));
  const selection = view.rendererSelection;
  const busy = view.pendingOperation !== null;
  const list = document.createElement("ul");
  list.className = "plain";
  const options = selection?.renderers ?? [];
  if (options.length === 0) {
    const item = document.createElement("li");
    item.append(text("span", "muted", "No renderers registered."));
    list.append(item);
  }
  for (const option of options) {
    const renderer = option.capability;
    const item = document.createElement("li");
    const left = text("span", undefined, `${renderer.rendererId}@${renderer.rendererVersion}`);
    const profile = renderer.supportedOutputProfiles[0];
    const extraProfiles = renderer.supportedOutputProfiles.length - 1;
    left.append(
      text(
        "span",
        "muted",
        ` · ${renderer.rendererClass} · ${
          profile !== undefined
            ? `${String(profile.resolution.w)}×${String(profile.resolution.h)} @ ${String(profile.frameRate)} fps (${profile.codec}/${profile.container}, ${profile.latencyClass})`
            : "no profile"
        }${extraProfiles > 0 ? ` (+${String(extraProfiles)} more profile${extraProfiles > 1 ? "s" : ""})` : ""} · requiresSourceFrames: ${String(renderer.requiresSourceFrames)}`,
      ),
    );
    item.append(left);
    if (option.selectable) {
      // The selection payload from the plan (renderer-only: exact identity
      // pair; the outputProfile default + the style extension point are
      // documented on `src/selection-plan.ts`).
      const request = selectionRequestOf(option);
      item.append(
        button(
          "Render",
          () =>
            core.dispatch({
              type: "createRender",
              rendererId: request.rendererId,
              rendererVersion: request.rendererVersion,
            }),
          { disabled: busy },
        ),
      );
    } else {
      // Capability-gated: greyed out with the plan's machine reason + note.
      const reason = text("span", "muted", ` — ${option.blockedNote}`);
      left.append(reason);
      item.append(button("Render", () => undefined, { disabled: true }));
      item.append(text("span", "failure-class", ` (${option.blockedReason})`));
    }
    list.append(item);
  }
  section.append(list);
  const note = text(
    "p",
    "muted",
    "Renderer selection is capability-driven (W703): the list and every selectable/greyed-out state derive from the control plane's registry capabilities and this session's rights — never hard-coded here. Style/variant choice is the documented extension point (no renderer declares style variants yet); the render request carries one verbatim when a caller provides it.",
  );
  const cancel = button("Cancel", () => core.dispatch({ type: "cancelRenderSelection" }));
  section.append(note, cancel);
  return section;
}

function render(view: ViewerViewModel): void {
  connectionEl.textContent = view.connection;
  connectionEl.dataset.state = view.connection;
  statusLabelEl.textContent = `status: ${view.status}${view.pendingOperation !== null ? ` (pending: ${view.pendingOperation})` : ""}`;
  renderErrorBanner(view);
  renderSessionsPane(view);
  renderDetailPane(view);
}

core.subscribe(render);
render(core.view());

// Host-driven playback clock: forward rAF ticks to the core (which forwards
// them to the active player; a no-op when no playback is mounted).
function loop(): void {
  core.dispatch({ type: "tick" });
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Auto-connect on load: the shell's entry experience.
core.dispatch({ type: "connect" });
