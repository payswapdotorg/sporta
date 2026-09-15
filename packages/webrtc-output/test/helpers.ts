/**
 * Shared deterministic fixtures for the W305 test suite.
 *
 * Harness rules (docs/testing/HARNESS.md, the W301/W304 posture): no
 * `Math.random`, no `Date.now`, no bare `new Date` — every time is an
 * explicit constant or a reading of the injected clock; async waiting is
 * microtask draining only (no real timers); log capture goes through the
 * observability package's injected sink at a fixed epoch.
 */
import type { AuthorizationPolicy, OutputProfile, Watermark } from "@sporta/contracts";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { CorrelationContext, Logger, LogRecord, LoggerOptions } from "@sporta/observability";
import { ManualLiveClock } from "../src/types";
import type { LiveOutputEmission, LiveOutputPayload } from "../src/types";
import { LoopbackLiveOutputTransport } from "../src/transport";
import type { LoopbackLiveOutputTransportOptions } from "../src/transport";
import type { LiveOutputEndpoint, LiveViewerSession } from "../src/viewer";

// ---------------------------------------------------------------------------
// Observability capture (the W303/W304 helper pattern, verbatim posture)
// ---------------------------------------------------------------------------

/** The fixed log epoch (no wall clock anywhere in the fixtures). */
export const TEST_EPOCH_MS = 1_736_164_800_000;

/** Captured logger + metrics: every line and series recorded for asserts. */
export function capturedObservability(): {
  logger: Logger;
  metrics: MetricsRegistry;
  records: () => LogRecord[];
  lines: () => string[];
  correlation: CorrelationContext;
} {
  const lines: string[] = [];
  const loggerOptions: LoggerOptions = {
    sink: (line) => lines.push(line),
    now: () => TEST_EPOCH_MS,
  };
  const logger = createLogger(loggerOptions);
  const metrics = new MetricsRegistry();
  return {
    logger,
    metrics,
    records: () => lines.map((line) => JSON.parse(line) as LogRecord),
    lines: () => [...lines],
    correlation: {
      sessionId: "sess-live-out",
      correlationId: "corr-live-out",
      traceId: "trace-live-out",
    },
  };
}

// ---------------------------------------------------------------------------
// The protocol fixtures (profiles, rights, emissions)
// ---------------------------------------------------------------------------

/** The deterministic output profile every fixture negotiates. */
export const LIVE_PROFILE: OutputProfile = {
  resolution: { w: 1170, h: 880 },
  frameRate: 1,
  codec: "svg",
  container: "svg",
  latencyClass: "live",
};

/** A fail-closed-valid policy that allows live delivery. */
export function liveDeliveryPolicy(): AuthorizationPolicy {
  return {
    policyId: "policy-live-out",
    allowedOperations: ["analysis", "transformation", "liveDelivery"],
    assertedBy: "sporta-test-operator",
  };
}

/** A policy WITHOUT `liveDelivery` (the fail-closed denial fixture). */
export function noLiveDeliveryPolicy(): AuthorizationPolicy {
  return {
    policyId: "policy-no-live",
    allowedOperations: ["analysis", "transformation"],
    assertedBy: "sporta-test-operator",
  };
}

/** A policy whose expiry is in the past at the fixture epoch. */
export function expiredLiveDeliveryPolicy(nowMs: number): AuthorizationPolicy {
  return {
    policyId: "policy-expired-live",
    allowedOperations: ["analysis", "liveDelivery"],
    assertedBy: "sporta-test-operator",
    expiresAtIso: new Date(nowMs - 1).toISOString(),
  };
}

/**
 * One deterministic frame document: the index and timestamp derive from the
 * parameters — the SVG bytes are a pure function of both (byte-stable).
 */
export function fixtureFrame(frameIndex: number, outputTimestampMs: number): {
  frameIndex: number;
  outputTimestampMs: number;
  svg: string;
} {
  return {
    frameIndex,
    outputTimestampMs,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1170 880"><text x="10" y="20">frame ${frameIndex} @ ${outputTimestampMs}ms</text></svg>`,
  };
}

/** The frame cadence every fixture uses (1 fps — one frame per second). */
export const FRAME_INTERVAL_MS = 1_000;

/**
 * One W304-shaped emission: `frameCount` frames at the cadence from
 * `startMs`, a manifest carrying the profile VERBATIM, and the emission
 * provenance a W304 `RenderOutputRecord` would carry. Pure and
 * deterministic: the same inputs build the deep-equal emission.
 */
export function fixtureEmission(options: {
  ordinal: number;
  watermarkMs: number;
  frameCount?: number;
  startMs?: number;
  frameIntervalMs?: number;
  rendererId?: string;
}): LiveOutputEmission {
  const frameCount = options.frameCount ?? 2;
  const startMs = options.startMs ?? options.watermarkMs - FRAME_INTERVAL_MS;
  const interval = options.frameIntervalMs ?? FRAME_INTERVAL_MS;
  const frames = Array.from({ length: frameCount }, (_, i) =>
    fixtureFrame(i, startMs + i * interval),
  );
  const rendererId = options.rendererId ?? "anime.prototype";
  const payload: LiveOutputPayload = {
    frames,
    manifest: {
      renderer: { rendererId, rendererVersion: "0.1.0" },
      output: {
        profile: LIVE_PROFILE,
        startMs,
        frameIntervalMs: interval,
        durationMs: Math.max(0, (frameCount - 1) * interval),
      },
      // Extra manifest fields (the real W502 shape) are carried VERBATIM —
      // the structural payload seam passes them through untouched.
      session: { sessionId: "sess-live-out", snapshotVersion: 1, eventsSinceSequence: 0 },
      provenance: { snapshotVersion: 1, lastEventSequence: 0 },
      watermarkAfter: { watermarkMs: options.watermarkMs, sequence: options.ordinal },
      frames: [],
      skippedEvents: [],
      degradation: { degraded: false, reasons: [] },
    },
  };
  const watermark: Watermark = {
    watermarkMs: options.watermarkMs,
    sequence: options.ordinal * 10 + 1,
  };
  return {
    output: payload,
    provenance: {
      sessionId: "sess-live-out",
      batchId: `batch-${options.ordinal}`,
      batchOrdinal: options.ordinal,
      sourceWatermark: watermark,
      jobId: `render-job-sess-live-out-${options.ordinal}`,
      rendererId,
      rendererVersion: "0.1.0",
    },
  };
}

/** An emission whose payload profile mismatches the negotiated track. */
export function mismatchedProfileEmission(ordinal: number, watermarkMs: number): LiveOutputEmission {
  const emission = fixtureEmission({ ordinal, watermarkMs });
  return {
    ...emission,
    output: {
      ...emission.output,
      manifest: {
        ...emission.output.manifest,
        output: {
          ...emission.output.manifest.output,
          profile: { ...LIVE_PROFILE, codec: "vp9", container: "webm" },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Transport wiring
// ---------------------------------------------------------------------------

/** Everything a wired live output fixture needs (one object, all explicit). */
export interface WiredLiveOutput {
  transport: LoopbackLiveOutputTransport;
  endpoint: LiveOutputEndpoint;
  session: LiveViewerSession;
  clock: ManualLiveClock;
  obs: ReturnType<typeof capturedObservability>;
}

/**
 * Wires one fully-negotiated live output session: transport (manual clock,
 * captured observability, the given limits/policy), offer → endpoint answer
 * → host accept → viewer connect. Sends remain the test's to drive.
 */
export function wiredLiveOutput(
  options: {
    clock?: ManualLiveClock;
    limits?: Partial<import("../src/types").LiveOutputLimits>;
    backpressure?: import("../src/types").LiveBackpressurePolicy;
    rightsPolicy?: AuthorizationPolicy;
    viewerId?: string;
    streamId?: string;
  } = {},
): WiredLiveOutput {
  const clock = options.clock ?? new ManualLiveClock(TEST_EPOCH_MS);
  const obs = capturedObservability();
  const transportOptions: LoopbackLiveOutputTransportOptions = {
    sessionId: "sess-live-out",
    clock,
    outputProfile: LIVE_PROFILE,
    rightsPolicy: options.rightsPolicy ?? liveDeliveryPolicy(),
    observability: { logger: obs.logger, metrics: obs.metrics, correlation: obs.correlation },
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.backpressure === undefined ? {} : { backpressure: options.backpressure }),
    ...(options.streamId === undefined ? {} : { streamId: options.streamId }),
  };
  const transport = new LoopbackLiveOutputTransport(transportOptions);
  const endpoint = transport.viewerEndpoint(
    options.viewerId === undefined ? {} : { viewerId: options.viewerId },
  );
  const offer = transport.createOffer();
  const answer = endpoint.answer(offer);
  if (answer.kind !== "accept") {
    throw new Error(`fixture wiring failed: the viewer rejected the offer (${answer.reason})`);
  }
  transport.acceptAnswer(answer);
  const session = endpoint.connect();
  return { transport, endpoint, session, clock, obs };
}

// ---------------------------------------------------------------------------
// Microtask draining (deterministic async waiting, no real timers)
// ---------------------------------------------------------------------------

/** Yields to the microtask queue `ticks` times. */
export function drainMicrotasks(ticks: number): Promise<void> {
  let remaining = ticks;
  return new Promise<void>((resolve) => {
    const step = (): void => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      remaining -= 1;
      queueMicrotask(step);
    };
    queueMicrotask(step);
  });
}

/**
 * Drains microtasks until `predicate` holds (bounded, fail-loud): the
 * deterministic "wait for the async wiring to reach a state" helper. Throws
 * when the bound is exhausted — a broken fixture, never a hang.
 */
export async function until(
  predicate: () => boolean,
  options: { ticks?: number; label?: string } = {},
): Promise<void> {
  const ticks = options.ticks ?? 2_000;
  for (let i = 0; i < ticks; i += 1) {
    if (predicate()) return;
    await drainMicrotasks(1);
  }
  if (!predicate()) {
    throw new Error(
      `until() predicate never held${options.label === undefined ? "" : ` (${options.label})`} ` +
        "— the fixture's deterministic wiring is broken",
    );
  }
}

/** Consumes the session stream until it ends, collecting every event. */
export async function consumeAll(
  session: LiveViewerSession,
): Promise<import("../src/types").LiveDeliveryEvent[]> {
  const events: import("../src/types").LiveDeliveryEvent[] = [];
  for await (const event of session.events()) {
    events.push(event);
  }
  return events;
}
