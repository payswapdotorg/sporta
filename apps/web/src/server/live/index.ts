/**
 * The W915 live network transport lane (apps/web server side).
 *
 * - `./transport.ts` — the SSE transport port + implementation (channels,
 *   subscribers, bounded buffers, close semantics);
 * - `./producer.ts` — the REAL per-tick frame generation (the W502 anime
 *   renderer over the dev-seed story timeline);
 * - `./view-model.ts` — the L005 live tactical view-model (the L002
 *   deterministic tracking source projected to live world frames — the
 *   producer seam the transport re-points for tactical sources);
 * - `./env.ts` — the env contract (composition-root reads only).
 *
 * The browser side consumes the same wire through the app's `/api/live/*`
 * routes and the shared grammar in `@/lib/live-sse.ts`.
 */
export {
  createSseLiveTransport,
  type LiveChannelStatus,
  type LiveRecordedWindowSink,
  type LiveScheduler,
  type LiveSourceRegistration,
  type LiveSubscriber,
  type LiveTransport,
  type LiveTransportState,
} from "./transport";
export { createStoryFrameProducer, type StoryFrameProducerOptions } from "./producer";
export {
  createTacticalFrameProducer,
  tacticalSourceNote,
  type LiveTacticalRegistration,
  type TacticalFrameProducerOptions,
  type TacticalFrameResult,
} from "./view-model";
export {
  createLiveTelemetryService,
  withLiveTelemetry,
  type LiveTelemetryProbe,
  type LiveTelemetryService,
  type LiveTelemetryServiceOptions,
} from "./telemetry";
export {
  liveReplaySink,
  withDurableReplayRecord,
  type LiveReplayPersistence,
} from "./persistence";
export { liveCadenceMs, liveTransportActive } from "./env";
