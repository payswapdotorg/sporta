/**
 * @sporta/viewer-shell — the browser viewer shell (W702).
 *
 * The EXPERIENCE-plane playback slice: a browser viewer that plays the
 * supported batch output (the W502-shaped SVG frame sequence + manifest)
 * through the real control plane (W701), with every state and error
 * surfaced clearly. Module map:
 *
 * - `errors`: the viewer error model — every failure class the shell can
 *   surface (the W701 control classes verbatim + `network` +
 *   `unsupported-output`), human labels, the retryability table, and the
 *   `ErrorView` view-model;
 * - `ports`: the `ControlClient` port (typed against the W701 operation
 *   shapes) and the `RenderOutputPort` (the playable-output seam);
 * - `viewer-core`: `createViewerCore` — the headless, fully tested viewer
 *   state machine (states: disconnected → connecting → browsing-sessions →
 *   session-detail → renderer-selection → render-queued → loading-output →
 *   ready/playing/paused/ended, plus the classified error state);
 * - `player`: `createFramePlayer` — pure SVG frame playback with an
 *   injected clock; frame-index math EXACT from the manifest windows;
 *   honest buffering (missing frames stall + flag, never blank); explicit
 *   loop/replay;
 * - `dom-plan` + `dom-adapter`: the pure DOM decision layer (tested
 *   headlessly) and the thin browser-only writer;
 * - `detail-plan`: the pure detail-pane layout plan (mount / update-in-place
 *   / teardown of the playback section) consumed by the bootstrap;
 * - `pane-signature`: the pure memo keys that keep the sessions pane and
 *   error banner from re-rendering on every per-tick emission while a clip
 *   plays (the form keeps its focus and text);
 * - `default-clock`: the deterministic default clock — a LOCAL mirror of
 *   `@sporta/testing`'s epoch (pinned equal by test) so the browser module
 *   graph stays free of bare `@sporta/*` specifiers;
 * - `control-client` / `http-client`: the in-process adapter (over a real
 *   transport-free `createControlApp`) and the HTTP adapter (over a real
 *   `createControlServer`, browser-safe via type-only imports);
 * - `output-provider`: the HTTP render-output provider (browser-safe);
 * - `render-output-store`: the server-side capture store + capturing
 *   renderer — the W504-pending stand-in for stored-output retrieval;
 * - `serve`: `serveViewer` — hosts the shell (static + on-the-fly
 *   transpiled ES modules + same-origin `/control` proxy + the stand-in
 *   output route) for a real browser session.
 *
 * HONEST LIMITATIONS (W702):
 *
 * - No real-browser E2E yet — that arrives with W705/W706. The served module
 *   graph is smoke-tested (boots, transpiles, no bare imports), never
 *   claimed as browser-executed.
 * - Live output is HONESTLY unavailable (W704/W705): the view-model carries
 *   a constant `live: { available: false, note }` — never a faked live tab.
 * - Stored-output retrieval behind the control plane arrives with W504;
 *   until then the shell plays outputs captured by the server-side stand-in
 *   store wired into the control-app registry (documented invariant in
 *   `./render-output-store.ts`).
 * - No user authentication (W701 limitation inherited): the caller-supplied
 *   authorization policy is the trust boundary.
 * - No new external dependencies: runtime deps are workspace packages only
 *   (`@sporta/control-api`, `@sporta/contracts`, `@sporta/renderer-anime`,
 *   `@sporta/renderer-contract`, `@sporta/testing`).
 */
export {
  FAILURE_CLASS_LABELS,
  RETRYABLE_FAILURE_CLASSES,
  VIEWER_FAILURE_CLASSES,
  ViewerControlError,
  errorViewFrom,
  isViewerControlError,
  isViewerFailureClass,
  toErrorView,
} from "./errors.ts";
export type { ErrorView, ViewerFailureClass } from "./errors.ts";
export type { BatchRenderOutput, ControlClient, PortError, RenderOutputPort } from "./ports.ts";
export { LIVE_UNAVAILABLE_NOTE, createViewerCore } from "./viewer-core.ts";
export type {
  ConnectionState,
  LiveView,
  PlayerFactory,
  RenderEntryView,
  RendererSelectionView,
  SessionDetailView,
  ViewerCommand,
  ViewerCore,
  ViewerCoreOptions,
  ViewerStatus,
  ViewerViewModel,
} from "./viewer-core.ts";
export { createFramePlayer } from "./player.ts";
export type {
  FramePlayer,
  FramePlayerOptions,
  FramePlayerSource,
  PlayerPlayback,
  PlayerResult,
  PlayerViewModel,
} from "./player.ts";
export { playerViewToDomPlan } from "./dom-plan.ts";
export type { PlayerDomPlan } from "./dom-plan.ts";
export { detailModeOf, detailPanePlan } from "./detail-plan.ts";
export type { DetailMode, DetailPaneAction } from "./detail-plan.ts";
export { errorBannerSignature, sessionsPaneSignature } from "./pane-signature.ts";
export { VIEWER_DEFAULT_EPOCH_MS, createViewerDefaultClock } from "./default-clock.ts";
export { mountPlayer } from "./dom-adapter.ts";
export type { PlayerDom } from "./dom-adapter.ts";
export { createInProcessControlClient } from "./control-client.ts";
export type { InProcessControlClientOptions } from "./control-client.ts";
export { createHttpControlClient } from "./http-client.ts";
export type { FetchLike, HttpControlClientOptions } from "./http-client.ts";
export { createHttpRenderOutputProvider } from "./output-provider.ts";
export type { HttpRenderOutputProviderOptions } from "./output-provider.ts";
export { createCapturingRenderer, createRenderOutputCaptureStore } from "./render-output-store.ts";
export type { RenderOutputCaptureStore, RenderOutputRecord } from "./render-output-store.ts";
export { serveViewer } from "./serve.ts";
export type { ServeViewerOptions, ViewerServer } from "./serve.ts";
