/**
 * @sporta/streaming-ingress — live input → normalized segments (W301).
 *
 * The LIVE side of ingestion (W101/W102 own the batch path): an injectable
 * live source delivers W102-normalized segments over time; this boundary
 * applies the fail-closed rights admission, per-segment idempotency and
 * validation, VERBATIM timestamp preservation, bounded delivery through the
 * W104 channel, and honest accounting — every delivered segment lands in
 * exactly one bucket. Module map:
 *
 * - `clock`: the `LiveClock` seam + `VirtualClock` (deterministic virtual
 *   arrival time — the injected clock every live component shares);
 * - `source`: the `LiveSource` seam — push/pull-agnostic, injectable, no
 *   hard-wired vendor protocol;
 * - `fixture`: `FixtureLiveSource` — the deterministic, replayable simulated
 *   live feed (pre-authored arrival schedule, W102 payload shapes). THIS is
 *   the "supported live input" of the W301 acceptance criterion; real
 *   network protocols are later work items;
 * - `types`: live segments, receipts, accounting stats, results, limits,
 *   options, the metric vocabulary, and the balance assertion;
 * - `errors`: typed boundary errors carrying the contracts
 *   `terminalFailureClass` (`rights-denied` / `media-invalid`);
 * - `checksum`: the canonical segment checksum (idempotency substance);
 * - `registry`: the per-segment receipt registry (the W101 posture);
 * - `validate`: live-segment payload validation (the W102 invariants);
 * - `service`: `StreamingIngressService` — admission, the delivery pump,
 *   bounded emission, shutdown accounting, observability.
 */
export type { LiveClock } from "./clock";
export { VirtualClock } from "./clock";
export type { LiveMediaKind, LiveSource, LiveSourceDescription } from "./source";
export type {
  IngestedLiveAudioSegment,
  IngestedLiveSegment,
  IngestedLiveVideoSegment,
  LiveAudioSegment,
  LiveIngressLimits,
  LiveIngressStats,
  LiveSegment,
  LiveSegmentReceipt,
  LiveSessionOutcome,
  LiveSessionResult,
  LiveVideoSegment,
  RejectionRecord,
  StreamingIngressObservability,
  StreamingIngressOptions,
} from "./types";
export {
  DEFAULT_LIVE_INGRESS_LIMITS,
  STREAMING_METRIC_NAMES,
  assertAccountingBalance,
  emptyStats,
} from "./types";
export {
  InvalidLiveSessionStateError,
  MalformedSegmentError,
  RightsDeniedError,
  isStreamingIngressError,
} from "./errors";
export type { StreamingIngressError, StreamingIngressErrorDetails } from "./errors";
export { checksumLiveSegment } from "./checksum";
export { LiveSegmentRegistry } from "./registry";
export { validateLiveSegment } from "./validate";
export { FixtureLiveSource } from "./fixture";
export type { FixtureDelivery, FixtureLiveFeedSpec } from "./fixture";
export { StreamingIngressService, noopObservability } from "./service";
export type { LiveSessionPhase } from "./service";
