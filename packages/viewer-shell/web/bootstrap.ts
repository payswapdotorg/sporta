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
 *   form keeps its focus and text (the bug the signatures fix).
 *
 * Honest testing boundary: this module is DOM glue — it is compile-checked
 * but not unit-tested (no DOM-testing dependency by constitution); the
 * logic behind every state it renders is covered by the `src/` tests, and
 * the real-provider data path is covered headlessly by
 * `test/playback-e2e.test.ts`. Real-browser E2E arrives with W706.
 */
import type { AuthorizationPolicy } from "@sporta/contracts";
import { createHttpControlClient } from "../src/http-client.ts";
import { createHttpPlaybackProvider } from "../src/playback-provider.ts";
import { mountPlayer } from "../src/dom-adapter.ts";
import type { PlayerDom } from "../src/dom-adapter.ts";
import { detailPanePlan } from "../src/detail-plan.ts";
import type { DetailMode } from "../src/detail-plan.ts";
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

const core = createViewerCore({
  client,
  output: outputProvider,
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
  const liveNote = text("p", "muted", view.live.note);
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
  // player).
  const plan = detailPanePlan(view.status, playbackSectionEl !== null);
  switch (plan.kind) {
    case "mount-playback": {
      teardownPlaybackDom();
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
    case "render-static": {
      if (plan.teardownPlayback) teardownPlaybackDom();
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
  section.append(actions);
  return section;
}

function renderRendererSelection(view: ViewerViewModel): HTMLElement {
  const section = document.createElement("div");
  section.append(heading("Choose a renderer"));
  const selection = view.rendererSelection;
  const busy = view.pendingOperation !== null;
  const list = document.createElement("ul");
  list.className = "plain";
  const renderers = selection?.renderers ?? [];
  if (renderers.length === 0) {
    const item = document.createElement("li");
    item.append(text("span", "muted", "No renderers registered."));
    list.append(item);
  }
  for (const renderer of renderers) {
    const item = document.createElement("li");
    const left = text("span", undefined, `${renderer.rendererId}@${renderer.rendererVersion}`);
    const profile = renderer.supportedOutputProfiles[0];
    left.append(
      text(
        "span",
        "muted",
        ` · ${renderer.rendererClass} · ${
          profile !== undefined
            ? `${String(profile.resolution.w)}×${String(profile.resolution.h)} @ ${String(profile.frameRate)} fps (${profile.codec}/${profile.container}, ${profile.latencyClass})`
            : "no profile"
        } · requiresSourceFrames: ${String(renderer.requiresSourceFrames)}`,
      ),
    );
    item.append(
      left,
      button(
        "Render",
        () =>
          core.dispatch({
            type: "createRender",
            rendererId: renderer.rendererId,
            ...(renderer.rendererVersion !== undefined
              ? { rendererVersion: renderer.rendererVersion }
              : {}),
          }),
        { disabled: busy },
      ),
    );
    list.append(item);
  }
  section.append(list);
  const note = text(
    "p",
    "muted",
    "Renderer selection is capability-driven (W703 posture): the list comes from the control plane's registry, never hard-coded here.",
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
