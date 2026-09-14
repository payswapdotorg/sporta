/**
 * Shared deterministic fixtures for the W301 test suite.
 *
 * Segment payloads REUSE the W102 fixture-adapter shapes AND math (see
 * `packages/decoding/src/fixture/adapter.ts`): `gradient` rgb24 bytes
 * `(x + y + frameIndex + c) % 256`, `sine` audio samples
 * `sin(2*pi*440*t) * 0.5` — so the live-feed fixtures are byte-compatible
 * with the batch-decode fixtures.
 *
 * Harness rules (docs/testing/HARNESS.md): no `Math.random`, no `Date.now`,
 * no `new Date` — every time is an explicit constant (TEST_EPOCH_MS for
 * epoch-boundary rights checks, VirtualClock for arrivals); async waiting is
 * microtask draining only (no real timers).
 */
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { LogRecord, LoggerOptions } from "@sporta/observability";
import { BoundedChannel } from "@sporta/transport";
import { TEST_EPOCH_MS, buildAuthorizationPolicy } from "@sporta/testing";
import { VirtualClock, FixtureLiveSource, StreamingIngressService } from "../src/index";
import type {
  IngestedLiveSegment,
  LiveAudioSegment,
  LiveSegment,
  LiveVideoSegment,
  StreamingIngressObservability,
} from "../src/types";
import type { FixtureDelivery, FixtureLiveFeedSpec } from "../src/fixture";
import type { StageMessage, AuthorizationPolicy } from "@sporta/contracts";

/** Fixed seed for any seeded builder (unused by the pure helpers, kept for parity). */
export const SEED = 2_025_010_630;

/** Reference sine frequency/amplitude — the W102 fixture math, verbatim. */
const SINE_HZ = 440;
const SINE_AMPLITUDE = 0.5;

// ---------------------------------------------------------------------------
// Segment builders (W102 fixture-adapter shapes + math)
// ---------------------------------------------------------------------------

/**
 * One live video segment: 2x2 `gradient` rgb24 frame (12 bytes,
 * `(x + y + decodeOrder + c) % 256`), exactly the W102 fixture formula.
 */
export function videoSegment(
  segmentId: string,
  presentationMs: number,
  decodeOrder: number,
): LiveVideoSegment {
  const width = 2;
  const height = 2;
  const bytes = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = (y * width + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        bytes[base + c] = (x + y + decodeOrder + c) % 256;
      }
    }
  }
  return {
    segmentId,
    kind: "video",
    frame: {
      frameId: `f-0-${decodeOrder}`,
      streamIndex: 0,
      presentationMs,
      decodeOrder,
      width,
      height,
      pixelFormat: "rgb24",
      bytes,
    },
  };
}

/** A deliberately-malformed variant of {@link videoSegment} (wrong byte count). */
export function malformedVideoSegment(segmentId: string, presentationMs: number): LiveVideoSegment {
  return {
    segmentId,
    kind: "video",
    frame: {
      frameId: `f-0-bad`,
      streamIndex: 0,
      presentationMs,
      decodeOrder: 0,
      width: 2,
      height: 2,
      pixelFormat: "rgb24",
      bytes: new Uint8Array(11), // 11 != 2*2*3 — the rgb24 invariant violation
    },
  };
}

/**
 * One live audio segment: 8 kHz mono `sine` chunks of 100 ms (800 samples,
 * `sin(2*pi*440*t) * 0.5` at the sample's absolute timeline position — the
 * W102 fixture formula).
 */
export function audioSegment(
  segmentId: string,
  startMs: number,
  chunkIndex: number,
): LiveAudioSegment {
  const sampleRate = 8_000;
  const channels = 1;
  const chunkMs = 100;
  const frames = Math.round((chunkMs / 1000) * sampleRate);
  const startFrame = Math.round((startMs / 1000) * sampleRate);
  const samples = new Float32Array(frames * channels);
  for (let frame = 0; frame < frames; frame += 1) {
    const absoluteFrame = startFrame + frame;
    const t = absoluteFrame / sampleRate;
    samples[frame * channels] = Math.sin(2 * Math.PI * SINE_HZ * t) * SINE_AMPLITUDE;
  }
  return {
    segmentId,
    kind: "audio",
    chunk: {
      chunkId: `a-1-${chunkIndex}`,
      streamIndex: 1,
      startMs,
      sampleRate,
      channels,
      samples,
    },
  };
}

// ---------------------------------------------------------------------------
// Feed builders
// ---------------------------------------------------------------------------

/** Builds a schedule where each segment arrives `lagMs` after its upstream time. */
export function laggedFeed(
  segments: readonly LiveSegment[],
  lagMs: number,
  upstreamTimes: readonly number[],
): FixtureDelivery[] {
  return segments.map((segment, index) => ({
    arrivalMs: upstreamTimes[index]! + lagMs,
    segment,
  }));
}

/** A one-segment-per-arrival schedule, explicit. */
export function scheduleOf(entries: readonly FixtureDelivery[]): FixtureLiveFeedSpec {
  return { label: "test-feed", schedule: entries };
}

/** A back-to-back video burst: `count` segments, arrival = upstream = i*40. */
export function burst(count: number): FixtureDelivery[] {
  return Array.from({ length: count }, (_, i) => ({
    arrivalMs: i * 40,
    segment: videoSegment(`v${i}`, i * 40, i),
  }));
}

// ---------------------------------------------------------------------------
// Wiring helpers
// ---------------------------------------------------------------------------

/** A block-policy bounded output channel for stage messages. */
export function outputChannel(
  capacity: number,
  policy: "block" | "reject" | "drop-oldest" = "block",
): BoundedChannel<StageMessage> {
  return new BoundedChannel<StageMessage>(
    { capacity, policy },
    { logger: createLogger({ minLevel: "error", sink: () => {} }) },
  );
}

/** Captured observability: collected log lines + a readable metrics registry. */
export function capturedObservability(): {
  options: StreamingIngressObservability;
  metrics: MetricsRegistry;
  records: () => LogRecord[];
  lines: () => string[];
} {
  const lines: string[] = [];
  const loggerOptions: LoggerOptions = {
    sink: (line) => lines.push(line),
    now: () => TEST_EPOCH_MS,
  };
  const metrics = new MetricsRegistry();
  return {
    options: { logger: createLogger(loggerOptions), metrics },
    metrics,
    records: () => lines.map((line) => JSON.parse(line) as LogRecord),
    lines: () => [...lines],
  };
}

/** The full service wiring over a fixture feed (fresh objects per call). */
export function wiredService(input: {
  sessionId: string;
  schedule: readonly FixtureDelivery[];
  capacity?: number;
  policy?: "block" | "reject" | "drop-oldest";
  authorizationPolicy?: AuthorizationPolicy | null;
  observability?: StreamingIngressObservability;
  rightsNowMs?: number | (() => number);
  maxSegments?: number;
}): {
  service: StreamingIngressService;
  source: FixtureLiveSource;
  channel: BoundedChannel<StageMessage>;
  clock: VirtualClock;
} {
  const clock = new VirtualClock(0);
  const source = new FixtureLiveSource(
    { label: `${input.sessionId}-feed`, schedule: input.schedule },
    clock,
  );
  const channel = outputChannel(input.capacity ?? 16, input.policy ?? "block");
  const service = new StreamingIngressService({
    sessionId: input.sessionId,
    source,
    // Default: a valid analysis policy (explicit null keeps the denial path).
    authorizationPolicy:
      input.authorizationPolicy === undefined
        ? buildAuthorizationPolicy({ policyId: `${input.sessionId}-policy` })
        : input.authorizationPolicy,
    output: channel,
    clock,
    ...(input.observability === undefined ? {} : { observability: input.observability }),
    ...(input.rightsNowMs === undefined ? {} : { rightsNowMs: input.rightsNowMs }),
    ...(input.maxSegments === undefined ? {} : { limits: { maxSegments: input.maxSegments } }),
  });
  return { service, source, channel, clock };
}

/** Yields to the microtask queue `ticks` times — deterministic draining. */
export async function drainMicrotasks(ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
  }
}

/**
 * Polls `condition` on the microtask queue until true (bounded by `maxTicks`
 * — returns whether the condition held, so tests fail loudly instead of
 * hanging when the expected state never settles).
 */
export async function until(condition: () => boolean, maxTicks: number = 20_000): Promise<boolean> {
  let ticks = 0;
  while (!condition() && ticks < maxTicks) {
    await Promise.resolve();
    ticks += 1;
  }
  return condition();
}

/** Receives until the channel is closed and drained (the consumer loop). */
export async function drainChannel(channel: BoundedChannel<StageMessage>): Promise<StageMessage[]> {
  const received: StageMessage[] = [];
  for (;;) {
    try {
      received.push(await channel.receive());
    } catch {
      return received; // ChannelClosedError: closed and drained
    }
  }
}

/** The ingested-segment payload of a received stage message. */
export function payloadOf(message: StageMessage): IngestedLiveSegment {
  return message.payload as IngestedLiveSegment;
}
