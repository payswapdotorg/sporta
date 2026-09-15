/**
 * Deterministic W704 live test fixtures (the W305-test-helper posture:
 * docs/testing/HARNESS.md — no `Math.random`, no `Date.now`, no bare
 * `new Date()`; every time is an explicit constant or a reading of the
 * injected clock; async waiting is microtask draining only).
 *
 * Everything here drives the REAL `@sporta/webrtc-output` seams: the
 * loopback transport, its offer/answer dance, and the W304-shaped emissions
 * a live host would send. The viewer-shell's own control-plane fixtures
 * (`./helpers.ts`) cover the session side (rights via `fullAllowPolicy`).
 */
import type { AuthorizationPolicy, OutputProfile, Watermark } from "@sporta/contracts";
import { ManualLiveClock, LoopbackLiveOutputTransport } from "@sporta/webrtc-output";
import type { LiveOutputEmission, LiveOutputPayload } from "@sporta/webrtc-output";
import type { LiveOutputEndpoint, LiveViewerSession } from "@sporta/webrtc-output";

/** The deterministic output profile every live fixture negotiates (SVG). */
export const LIVE_PROFILE: OutputProfile = {
  resolution: { w: 1170, h: 880 },
  frameRate: 1,
  codec: "svg",
  container: "svg",
  latencyClass: "live",
};

/** A live-delivery-capable policy (the default for the fixtures). */
export function liveDeliveryPolicy(): AuthorizationPolicy {
  return {
    policyId: "policy-live-w704",
    allowedOperations: ["analysis", "transformation", "liveDelivery"],
    assertedBy: "sporta-w704-test",
  };
}

/** A policy WITHOUT live delivery (the fail-closed denial fixture). */
export function noLiveDeliveryPolicy(): AuthorizationPolicy {
  return {
    policyId: "policy-no-live-w704",
    allowedOperations: ["analysis", "transformation"],
    assertedBy: "sporta-w704-test",
  };
}

/** The frame cadence every live fixture uses (1 fps). */
export const LIVE_FRAME_INTERVAL_MS = 1_000;

/**
 * One deterministic SVG frame document: the bytes are a pure function of the
 * window ordinal + frame index + timestamp (byte-stable for deep-equals).
 */
export function liveFrameSvg(ordinal: number, frameIndex: number, timestampMs: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1170 880">` +
    `<text x="10" y="20">live w${ordinal} f${frameIndex} @${timestampMs}ms</text></svg>`
  );
}

/**
 * One W304-shaped emission: `frameCount` frames at the 1 fps cadence from
 * `startMs`, a manifest carrying the SVG profile VERBATIM (the structural
 * payload seam passes the extra W502 fields through by reference).
 */
export function liveEmission(options: {
  sessionId: string;
  ordinal: number;
  watermarkMs: number;
  frameCount?: number;
  startMs?: number;
}): LiveOutputEmission {
  const frameCount = options.frameCount ?? 2;
  const startMs = options.startMs ?? options.watermarkMs - LIVE_FRAME_INTERVAL_MS;
  const frames = Array.from({ length: frameCount }, (_, i) => ({
    frameIndex: i,
    outputTimestampMs: startMs + i * LIVE_FRAME_INTERVAL_MS,
    svg: liveFrameSvg(options.ordinal, i, startMs + i * LIVE_FRAME_INTERVAL_MS),
  }));
  const manifest = {
    renderer: { rendererId: "anime.prototype", rendererVersion: "0.1.0" },
    output: {
      profile: LIVE_PROFILE,
      startMs,
      frameIntervalMs: LIVE_FRAME_INTERVAL_MS,
      durationMs: Math.max(0, (frameCount - 1) * LIVE_FRAME_INTERVAL_MS),
    },
    session: { sessionId: options.sessionId, snapshotVersion: 1, eventsSinceSequence: 0 },
    provenance: { snapshotVersion: 1, lastEventSequence: 0 },
    watermarkAfter: { watermarkMs: options.watermarkMs, sequence: options.ordinal },
    frames: [],
    skippedEvents: [],
    degradation: { degraded: false, reasons: [] },
  };
  const payload: LiveOutputPayload = { frames, manifest };
  const watermark: Watermark = {
    watermarkMs: options.watermarkMs,
    sequence: options.ordinal * 10 + 1,
  };
  return {
    output: payload,
    provenance: {
      sessionId: options.sessionId,
      batchId: `batch-${options.ordinal}`,
      batchOrdinal: options.ordinal,
      sourceWatermark: watermark,
      jobId: `render-job-${options.sessionId}-${options.ordinal}`,
      rendererId: "anime.prototype",
      rendererVersion: "0.1.0",
    },
  };
}

/**
 * Builds a REAL W305 loopback transport for one live session: the SVG
 * profile, the manual protocol clock, and the caller's rights policy.
 */
export function makeLiveTransport(options: {
  sessionId: string;
  policy?: AuthorizationPolicy;
  clock?: ManualLiveClock;
}): { transport: LoopbackLiveOutputTransport; clock: ManualLiveClock } {
  const clock = options.clock ?? new ManualLiveClock(0);
  const transport = new LoopbackLiveOutputTransport({
    sessionId: options.sessionId,
    clock,
    outputProfile: LIVE_PROFILE,
    rightsPolicy: options.policy ?? liveDeliveryPolicy(),
  });
  return { transport, clock };
}

/**
 * A thin test decorator over the REAL transport that captures the
 * `LiveViewerSession` created inside `connect()` — the only way a test can
 * simulate a transport-level connection drop (calling the raw session's
 * `disconnect()` behind the adapter's back, exactly as a real network death
 * would) and then inspect the raw session's honest status. Only the four
 * methods the live client calls are forwarded; everything else stays on the
 * real instance for the test's own use (`sendWindow`, `close`, …).
 */
export interface CapturedLiveTransport {
  /** The duck-typed transport the in-process live client consumes. */
  clientTransport: LoopbackLiveOutputTransport;
  /** The REAL underlying transport (the test's host-side handle). */
  real: LoopbackLiveOutputTransport;
  clock: ManualLiveClock;
  /** The session the live client's `connect()` created (null before open). */
  session: () => LiveViewerSession | null;
  /** The endpoint the client's `viewerEndpoint()` returned (null before open). */
  endpoint: () => LiveOutputEndpoint | null;
}

export function captureSessionTransport(options: {
  sessionId: string;
  policy?: AuthorizationPolicy;
  clock?: ManualLiveClock;
}): CapturedLiveTransport {
  const { transport: real, clock } = makeLiveTransport(options);
  let session: LiveViewerSession | null = null;
  let endpoint: LiveOutputEndpoint | null = null;
  const clientTransport = {
    createOffer: () => real.createOffer(),
    viewerEndpoint: (viewerOptions: { viewerId?: string }) => {
      const created = real.viewerEndpoint(viewerOptions);
      if (endpoint === null) endpoint = created;
      return {
        answer: created.answer.bind(created),
        connect: () => {
          const connected = created.connect();
          session = connected;
          return connected;
        },
      };
    },
    acceptAnswer: (answer: unknown) => real.acceptAnswer(answer),
  };
  return {
    clientTransport: clientTransport as unknown as LoopbackLiveOutputTransport,
    real,
    clock,
    session: () => session,
    endpoint: () => endpoint,
  };
}

/** Flushes the microtask queue enough for the pull/send chains to settle. */
export async function settleLive(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
