/**
 * @sporta/viewer-shell — the browser viewer shell (W702 + W705 + W704).
 *
 * The EXPERIENCE-plane playback slice: a browser viewer that plays the
 * supported batch output through the real control plane (W701) — the REAL
 * W504 stored segments since W705 — plus the LIVE output path (W704) through
 * W305's transport contract, with every state and error surfaced clearly.
 * Module map:
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
 *   outputs-pending/ready/playing/paused/ended, the LIVE statuses
 *   live-connecting/playing/reconnecting/ended, plus the classified error
 *   state);
 * - `player`: `createFramePlayer` — pure SVG frame playback with an
 *   injected clock; frame-index math EXACT from the manifest windows;
 *   honest buffering (missing frames stall + flag, never blank); explicit
 *   loop/replay;
 * - `segment-player`: `createSegmentPlayer` — the W705 SMIL segment player
 *   for the REAL W504 stored output: ONE self-animating document presented
 *   with its manifest metadata, declared-timeline playhead, and explicit
 *   SMIL sync instructions for the DOM edge (no faked frame supplies);
 * - `live-ports`: the W704 live ports — the `LiveClient` seam, the
 *   W305-failure-class map (verbatim evidence), and the browser-safe views
 *   (offer summary, never-silent delivery accounting, honest status);
 * - `live-player`: `createLivePlayer` — the pure live presentation model
 *   (join at the live edge, grow-as-delivered buffer, honest re-buffer
 *   stalls, injected-domain latency; absent metrics absent);
 * - `live-backoff`: the PURE deterministic reconnect schedule
 *   (500 → 1000 → 2000 → 4000 ms, 4 attempts max, retryable classes only);
 * - `live-plan`: the PURE live status-surface decision module (headline /
 *   status line / accounting / degradation / reconnect countdown / outcome);
 * - `live-client` (NODE-side): `createInProcessLiveClient` — the live
 *   adapter over a REAL W305 `LoopbackLiveOutputTransport` (the offer
 *   dance: request → exact-key + zod grammar validation → answer → attach;
 *   typed rejects, never guesses);
 * - `dom-plan` + `dom-adapter`: the pure DOM decision layer (the players'
 *   plans — batch frames, the W504 SMIL segment, and the live view-model —
 *   all tested headlessly) and the thin browser-only writer (the SMIL
 *   document's real animation controls live here);
 * - `detail-plan`: the pure detail-pane layout plan (mount / update-in-place
 *   / teardown of the playback AND live sections) consumed by the bootstrap;
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
 * W706 VIEWER TELEMETRY (see `TELEMETRY.md` for the privacy-scope decision):
 *
 * - `telemetry-events`: the versioned, typed, validated event vocabulary —
 *   CLOSED shapes (privacy by construction: policies, media content,
 *   source frames, renderer payloads, and free-form records are
 *   UNREPRESENTABLE), the remediation-hint table, the closed operation/
 *   feedback vocabularies, and the fail-loud validator;
 * - `telemetry`: `createViewerTelemetry` — the emitter (deterministic
 *   sequence ids + the injected clock; best-effort: drops counted, never
 *   thrown);
 * - `telemetry-sink`: the `TelemetrySink` port + the in-memory test sink;
 * - `telemetry-file-sink` (node-only): the structured-JSON-lines file sink
 *   under a declared path — buffered writes, EXPLICIT flush/close, no
 *   timers, no network;
 * - `telemetry-http-sink`: the browser-safe dev-grade bridge to the dev
 *   server's `/telemetry` route (ordered fire-and-forget POSTs, failures
 *   counted);
 * - `telemetry-plan`: the pure feedback-affordance plan (the structured
 *   user-feedback kinds + labels + the privacy disclosure) the bootstrap
 *   renders.
 *
 * HONEST LIMITATIONS (W702 + W705 + W706 + W704):
 *
 * - No real-browser E2E yet — it remains OPEN future work (W706 as scoped
 *   delivered viewer telemetry, not browser automation). The served module
 *   graph is smoke-tested (boots, transpiles, no bare imports), never
 *   claimed as browser-executed; the real-provider data path IS exercised
 *   headlessly end-to-end (`test/playback-e2e.test.ts`), the real telemetry
 *   chain in `test/telemetry-e2e.test.ts`, and the real live path in
 *   `test/live-e2e.test.ts`.
 * - LIVE OUTPUT BOUNDARY (W704, see `LIVE.md`): the delivered live path is
 *   the in-process seam over W305's loopback transport (no real
 *   RTCPeerConnection exists in this monorepo); the BROWSER build wires no
 *   live client (the dev server does not bridge the W305 offer dance over
 *   HTTP — no wire protocol exists to bridge), so the browser's `live`
 *   section carries the honest unavailable note while the state machine,
 *   reconnect policy, and status surface are fully exercised headlessly.
 * - The live latency shown is INJECTED-DOMAIN stream position (now − the
 *   newest applied window's emission time), never network latency (W306's
 *   measurement, W802's SLO formalization).
 * - Multi-segment renders are not presented (one segment document per
 *   render is today's W504 shape); a surplus fails loud as
 *   `unsupported-output`, never a silent first-segment-wins.
 * - No user authentication (W701 limitation inherited): the caller-supplied
 *   authorization policy is the trust boundary.
 * - No new external dependencies: runtime deps are workspace packages only
 *   (`@sporta/control-api`, `@sporta/contracts`, `@sporta/output-pipeline`,
 *   `@sporta/renderer-anime`, `@sporta/renderer-contract`,
 *   `@sporta/testing`, `@sporta/webrtc-output`).
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
  LiveAttachedSection,
  LiveSectionState,
  LiveUnavailableView,
  LiveView,
  PlaybackView,
  PlayerFactory,
  RenderEntryView,
  RendererSelectionView,
  SegmentPlayerFactory,
  SessionDetailView,
  TelemetryView,
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
export { createLivePlayer } from "./live-player.ts";
export type {
  LivePlayer,
  LivePlayerOptions,
  LivePlayerResult,
  LivePlayerViewModel,
} from "./live-player.ts";
export { LIVE_FAILURE_CLASS_MAP } from "./live-ports.ts";
export type {
  LiveAccountingView,
  LiveAttached,
  LiveClient,
  LiveDeliveryEvent,
  LiveOfferDocument,
  LiveOfferView,
  LiveOutputFailureClass,
  LiveReconnectReportView,
  LiveStreamHandle,
  LiveStreamStatusView,
} from "./live-ports.ts";
export {
  LIVE_RECONNECT_BASE_DELAY_MS,
  LIVE_RECONNECT_MAX_ATTEMPTS,
  LIVE_RECONNECT_MAX_DELAY_MS,
  LIVE_RECONNECT_SCHEDULE_MS,
  LIVE_RETRYABLE_FAILURE_CLASSES,
  isLiveRetryableFailureClass,
  liveReconnectDecision,
  liveReconnectDelayMs,
} from "./live-backoff.ts";
export type {
  LiveReconnectDecision,
  LiveReconnectTerminalReason,
  LiveRetryableFailureClass,
} from "./live-backoff.ts";
export { liveStatusPlan } from "./live-plan.ts";
export type { LiveStatusPlan } from "./live-plan.ts";
export { checkOfferExactKeys, createInProcessLiveClient, mapLiveError } from "./live-client.ts";
export type {
  InProcessLiveClientOptions,
} from "./live-client.ts";
export { playerViewToDomPlan, segmentViewToDomPlan, liveViewToDomPlan } from "./dom-plan.ts";
export type { LiveDomPlan, PlayerDomPlan, SegmentDomPlan } from "./dom-plan.ts";
export { detailModeOf, detailPanePlan } from "./detail-plan.ts";
export type { DetailMode, DetailPaneAction, DetailPaneMounted } from "./detail-plan.ts";
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
export {
  REMEDIATION_HINTS,
  TELEMETRY_EVENT_KINDS,
  TELEMETRY_EVENT_KEYS,
  TELEMETRY_MESSAGE_MAX_LENGTH,
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_TIMED_OPERATIONS,
  TELEMETRY_VIEWER_STATUSES,
  TELEMETRY_OPERATIONS,
  USER_FEEDBACK_KINDS,
  isUserFeedbackKind,
  isViewerOperation,
  parseTelemetryEvent,
  parseTelemetryLine,
  serializeTelemetryEvent,
} from "./telemetry-events.ts";
export type {
  ErrorOccurredEvent,
  IntegrityVerifiedEvent,
  OperationTimingEvent,
  RebufferStallEvent,
  StateTransitionEvent,
  TelemetryEventCommon,
  TelemetryEventKind,
  TelemetryParseResult,
  TimedOperation,
  UserFeedbackEvent,
  UserFeedbackKind,
  ViewerOperation,
  ViewerTelemetryEvent,
} from "./telemetry-events.ts";
export { createViewerTelemetry } from "./telemetry.ts";
export type {
  ViewerTelemetry,
  ViewerTelemetryOptions,
  ViewerTelemetryStatus,
} from "./telemetry.ts";
export { createInMemoryTelemetrySink } from "./telemetry-sink.ts";
export type { InMemoryTelemetrySink, TelemetrySink } from "./telemetry-sink.ts";
export { createJsonlTelemetryFileSink } from "./telemetry-file-sink.ts";
export type {
  JsonlTelemetryFileSink,
  JsonlTelemetryFileSinkOptions,
} from "./telemetry-file-sink.ts";
export { createHttpTelemetrySink } from "./telemetry-http-sink.ts";
export type {
  HttpTelemetrySink,
  HttpTelemetrySinkOptions,
  HttpTelemetrySinkStatus,
} from "./telemetry-http-sink.ts";
export { TELEMETRY_PRIVACY_NOTE, telemetryAffordance } from "./telemetry-plan.ts";
export type { FeedbackChoice, TelemetryAffordance } from "./telemetry-plan.ts";
