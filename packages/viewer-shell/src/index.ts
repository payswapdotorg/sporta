/**
 * @sporta/viewer-shell — the browser viewer shell (W702 + W705).
 *
 * The EXPERIENCE-plane playback slice: a browser viewer that plays the
 * supported batch output through the real control plane (W701) — the REAL
 * W504 stored segments since W705 — with every state and error surfaced
 * clearly. Module map:
 *
 * - `errors`: the viewer error model — every failure class the shell can
 *   surface (the W701 control classes verbatim + `network` +
 *   `unsupported-output`), human labels, the retryability table, and the
 *   `ErrorView` view-model;
 * - `ports`: the `ControlClient` port (typed against the W701 operation
 *   shapes) and the `RenderOutputPort` (the playable-output seam — the W705
 *   three-kind union: frame-sequence / animated-segment / outputs-pending);
 * - `viewer-core`: `createViewerCore` — the headless, fully tested viewer
 *   state machine (states: disconnected → connecting → browsing-sessions →
 *   session-detail → renderer-selection → render-queued → loading-output →
 *   outputs-pending/ready/playing/paused/ended, plus the classified error
 *   state);
 * - `player`: `createFramePlayer` — pure SVG frame playback with an
 *   injected clock; frame-index math EXACT from the manifest windows;
 *   honest buffering (missing frames stall + flag, never blank); explicit
 *   loop/replay;
 * - `segment-player`: `createSegmentPlayer` — the W705 SMIL segment player
 *   for the REAL W504 stored output: ONE self-animating document presented
 *   with its manifest metadata, declared-timeline playhead, and explicit
 *   SMIL sync instructions for the DOM edge (no faked frame supplies);
 * - `dom-plan` + `dom-adapter`: the pure DOM decision layer (both players'
 *   plans, tested headlessly) and the thin browser-only writer (the SMIL
 *   document's real animation controls live here);
 * - `detail-plan`: the pure detail-pane layout plan (mount / update-in-place
 *   / teardown of the playback section) consumed by the bootstrap;
 * - `selection-plan`: the W703 pure renderer-selection plan — derives the
 *   selectable/blocked affordances from the listed capability documents +
 *   the session's fail-closed rights (never from renderer identity; a test
 *   pins the plan layer for renderer-id literals) and the renderer-only
 *   selection payload (the style/profile extension points documented);
 * - `pane-signature`: the pure memo keys that keep the sessions pane and
 *   error banner from re-rendering on every per-tick emission while a clip
 *   plays (the form keeps its focus and text);
 * - `default-clock`: the deterministic default clock — a LOCAL mirror of
 *   `@sporta/testing`'s epoch (pinned equal by test) so the browser module
 *   graph stays free of bare `@sporta/*` specifiers;
 * - `control-client` / `http-client`: the in-process adapter (over a real
 *   transport-free `createControlApp`) and the HTTP adapter (over a real
 *   `createControlServer`, browser-safe via type-only imports);
 * - `playback-provider`: the REAL W705 render-output provider over the W504
 *   control-plane playback routes (outputs list + segment envelope, client-
 *   side integrity, verbatim error classes);
 * - `output-provider`: the W702 stand-in provider over the viewer server's
 *   `/output` route (kept for its own tests — NOT the default path);
 * - `render-output-store`: the server-side capture store + capturing
 *   renderer — the W702 stand-in seam (its own tests);
 * - `encoding-renderer`: the W705 host-side wrapper that runs the real
 *   output pipeline step (encode → store) for every successful render in
 *   the dev-server composition;
 * - `serve`: `serveViewer` — hosts the shell (static + on-the-fly
 *   transpiled ES modules + same-origin `/control` proxy incl. the real
 *   playback routes + the stand-in output route) for a real browser
 *   session.
 *
 * HONEST LIMITATIONS (W702 + W705):
 *
 * - No real-browser E2E yet — that arrives with W706. The served module
 *   graph is smoke-tested (boots, transpiles, no bare imports), never
 *   claimed as browser-executed; the real-provider data path IS exercised
 *   headlessly end-to-end (`test/playback-e2e.test.ts`).
 * - Live output is HONESTLY unavailable (W704): the view-model carries a
 *   constant `live: { available: false, note }` — never a faked live tab.
 * - Multi-segment renders are not presented (one segment document per
 *   render is today's W504 shape); a surplus fails loud as
 *   `unsupported-output`, never a silent first-segment-wins.
 * - No user authentication (W701 limitation inherited): the caller-supplied
 *   authorization policy is the trust boundary.
 * - No new external dependencies: runtime deps are workspace packages only
 *   (`@sporta/control-api`, `@sporta/contracts`, `@sporta/output-pipeline`,
 *   `@sporta/renderer-anime`, `@sporta/renderer-contract`, `@sporta/testing`).
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
export type {
  BatchRenderOutput,
  ControlClient,
  PlaybackSegmentDocument,
  PortError,
  RenderOutputPort,
  RenderOutputResult,
} from "./ports.ts";
export { LIVE_UNAVAILABLE_NOTE, createViewerCore } from "./viewer-core.ts";
export type {
  ConnectionState,
  LiveView,
  PlaybackView,
  PlayerFactory,
  RenderEntryView,
  RendererSelectionView,
  SegmentPlayerFactory,
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
export { createSegmentPlayer } from "./segment-player.ts";
export type {
  SegmentPlayback,
  SegmentPlayer,
  SegmentPlayerOptions,
  SegmentPlayerSource,
  SegmentPlayerViewModel,
  SmilSync,
} from "./segment-player.ts";
export { playerViewToDomPlan, segmentViewToDomPlan } from "./dom-plan.ts";
export type { PlayerDomPlan, SegmentDomPlan } from "./dom-plan.ts";
export { detailModeOf, detailPanePlan } from "./detail-plan.ts";
export type { DetailMode, DetailPaneAction } from "./detail-plan.ts";
export {
  VIEWER_PRESENTABLE_OUTPUT_KINDS,
  declaredOutputKindsOf,
  deriveRendererOptions,
  selectionRequestOf,
} from "./selection-plan.ts";
export type {
  RendererBlockedReason,
  RendererOptionView,
  SelectionRequest,
} from "./selection-plan.ts";
export { errorBannerSignature, sessionsPaneSignature } from "./pane-signature.ts";
export { VIEWER_DEFAULT_EPOCH_MS, createViewerDefaultClock } from "./default-clock.ts";
export { mountPlayer } from "./dom-adapter.ts";
export type { PlaybackViewModel, PlayerDom } from "./dom-adapter.ts";
export { createInProcessControlClient } from "./control-client.ts";
export type { InProcessControlClientOptions } from "./control-client.ts";
export { createHttpControlClient } from "./http-client.ts";
export type { FetchLike, HttpControlClientOptions } from "./http-client.ts";
export { createHttpPlaybackProvider } from "./playback-provider.ts";
export type {
  HttpPlaybackProvider,
  HttpPlaybackProviderOptions,
  PlaybackSegmentSummary,
} from "./playback-provider.ts";
export { createHttpRenderOutputProvider } from "./output-provider.ts";
export type { HttpRenderOutputProviderOptions } from "./output-provider.ts";
export { createCapturingRenderer, createRenderOutputCaptureStore } from "./render-output-store.ts";
export type { RenderOutputCaptureStore, RenderOutputRecord } from "./render-output-store.ts";
export { createEncodingRenderer } from "./encoding-renderer.ts";
export type { EncodingRendererOptions } from "./encoding-renderer.ts";
export { serveViewer } from "./serve.ts";
export type { ServeViewerOptions, ViewerServer } from "./serve.ts";
