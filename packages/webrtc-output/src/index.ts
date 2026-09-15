/**
 * @sporta/webrtc-output — the live output transport contract (W305).
 *
 * THE M4 delivery stage (acceptance: "live rendered output is viewable
 * end-to-end in supported browsers"), delivered at the W301 honest-seam
 * posture: a typed, versioned, zod-validated protocol (negotiation
 * offer/answer, frame-window delivery records, failure classes, integrity
 * metadata) PLUS a deterministic in-process implementation
 * (`LoopbackLiveOutputTransport`) that actually moves frame-window payloads
 * from a W304-style orchestrated render stream to a viewer-side port in
 * delivery order with exact never-silent accounting — the vendor-neutral
 * seam a real WebRTC stack (SDP/ICE/DTLS/SRTP + a browser) satisfies behind
 * the same `sendWindow` / `viewerEndpoint` / `close` interfaces. NO real
 * network, NO SDP/ICE, NO browser — documented honestly in README.md; a
 * real implementation is future work behind this contract.
 *
 * Module map:
 *
 * - `types`: the protocol documents (zod-validated), the receipt/ledger/
 *   stats vocabulary, the master accounting identity
 *   (`windowsIn === delivered + skippedStale + droppedByPolicy + refused +
 *   abandoned + failed (+ in-flight during a run)`, runtime-asserted at
 *   every settle), the injectable clock, the limits, the metric names;
 * - `errors`: the typed boundary errors (`LiveOutputError` subclasses, one
 *   per failure class callers discriminate on);
 * - `negotiation`: offer/answer construction + fail-loud parse, the
 *   fail-closed rights gate (`canDeliverLive`), the viewer-side decision;
 * - `state`: the session phase machine
 *   (negotiating → established → degraded ↔ established → closed);
 * - `window`: frame-window construction (content hashes, verbatim
 *   timestamps, W304 emission provenance) + integrity verification;
 * - `transport`: `LoopbackLiveOutputTransport` — the bounded link (W104
 *   BoundedChannel verbatim), serialized sends, viewer-driven pulls,
 *   degradation (skip-stale at admission AND dequeue), the retention ring,
 *   reconnect resume with idempotency keys, drain/cancel close;
 * - `viewer`: the viewer-side consumption seam (the W704 port) — the
 *   endpoint (typed offer answers) + `LiveViewerSession` (idempotent
 *   application, in-order verification, presentation timing from payload
 *   timestamps, the honest live-state surface, arrival telemetry);
 * - `telemetry`: the W306 latency-measurement seams (per-receipt timing
 *   records, arrival records, lag summaries).
 *
 * Constitution: ZERO wall-clock reads (the only clock is the injected
 * `LiveOutputClock`; every `new Date` is an explicit-millisecond derivation
 * for the contracts' rights expiry), zero `Math.random`, zero external
 * runtime dependencies beyond the sanctioned zod (the @sporta/contracts
 * schema precedent). Everything bounded, everything counted, everything
 * logged: a dropped window is a typed receipt or an accounted stream event
 * — never a silent loss.
 */
// Re-exports below carry both the schema (value) and inferred-type meanings
// of each name; type-only names use `export type`.
export {
  DEFAULT_LIVE_OUTPUT_LIMITS,
  LIVE_OUTPUT_METRIC_NAMES,
  LIVE_OUTPUT_PROTOCOL_VERSION,
  LiveBackpressurePolicy,
  LiveFrameDescriptor,
  LiveFrameDocument,
  LiveFrameWindow,
  LiveOutputAnswer,
  LiveOutputFailureClass,
  LiveOutputOffer,
  LiveOutputPayload,
  LiveOutputProtocolVersion,
  LiveOutputRejectionReason,
  LiveOutputSessionControls,
  LiveOutputTrackDescriptor,
  LiveSessionOutcomeKind,
  LiveTrackKind,
  ManualLiveClock,
  assertLiveOutputAccounting,
  emptyLiveStats,
} from "./types";
export type {
  LiveDeliveryEvent,
  LiveDeliveryTiming,
  LiveFrameWindowEnvelope,
  LiveOutputClock,
  LiveOutputEmission,
  LiveOutputLimits,
  LiveOutputStats,
  LiveSessionResult,
  LiveSendRefusalClass,
  LiveSendRefusalDetails,
  LiveWindowDisposition,
  LiveWindowSendReceipt,
} from "./types";

export {
  LiveOutputError,
  LiveOutputIntegrityError,
  LiveOutputNegotiationError,
  LiveOutputProfileMismatchError,
  LiveOutputProtocolError,
  LiveOutputRightsError,
  isLiveOutputError,
} from "./errors";
export type { LiveOutputErrorDetails } from "./errors";

export {
  answerLiveOutputOffer,
  assertLiveDeliveryRights,
  buildLiveOutputOffer,
  parseLiveOutputAnswer,
  parseLiveOutputOffer,
  trackFromProfile,
} from "./negotiation";
export type { DocumentParse } from "./negotiation";

export { LIVE_SESSION_PHASES, LiveSessionPhaseMachine } from "./state";
export type { LiveDegradationReason, LiveSessionPhase } from "./state";

export {
  buildLiveFrameWindow,
  frameWindowId,
  sha256Hex,
  utf8ByteLength,
  validateLiveOutputPayload,
  verifyFrameWindowIntegrity,
} from "./window";

export { LoopbackLiveOutputTransport } from "./transport";
export type {
  LiveLinkMessage,
  LiveOutputObservability,
  LiveOutputEndpoint,
  LiveReconnectReport,
  LiveViewerSession,
  LiveViewerTransportBinding,
  LoopbackLiveOutputTransportOptions,
} from "./transport";

export { createEndpoint } from "./viewer";
export type {
  AppliedLiveWindow,
  LiveEndpointAnswerOptions,
  LiveOutputHostWiring,
  LiveViewerSessionOptions,
  LiveViewerStatus,
} from "./viewer";

export { summarizeLag } from "./telemetry";
export type { LiveLagSummary, LiveViewerArrivalRecord, LiveWindowTimingRecord } from "./telemetry";
