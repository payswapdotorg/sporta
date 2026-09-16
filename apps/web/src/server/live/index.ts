/**
 * The W915 live network transport lane (apps/web server side).
 *
 * - `./transport.ts` — the SSE transport port + implementation (channels,
 *   subscribers, bounded buffers, close semantics);
 * - `./producer.ts` — the REAL per-tick frame generation (the W502 anime
 *   renderer over the dev-seed story timeline);
 * - `./env.ts` — the env contract (composition-root reads only).
 *
 * The browser side consumes the same wire through the app's `/api/live/*`
 * routes and the shared grammar in `@/lib/live-sse.ts`.
 */
export {
  createSseLiveTransport,
  type LiveChannelStatus,
  type LiveScheduler,
  type LiveSourceRegistration,
  type LiveSubscriber,
  type LiveTransport,
  type LiveTransportState,
} from "./transport";
export { createStoryFrameProducer, type StoryFrameProducerOptions } from "./producer";
export { liveCadenceMs, liveTransportActive } from "./env";
