/**
 * THE W305 END-TO-END DELIVERY (the acceptance evidence): "live rendered
 * output is viewable end-to-end in supported browsers" — delivered at the
 * W301 honest-seam posture as a REAL W304 render stream driving the REAL
 * W305 transport driving a REAL viewer session:
 *
 * ```
 * W006 WorldModelEngine (a genuine moving story, 1 update/second)
 *   └─ W402 consumer seams (stateAt + eventWindow) → SwmUpdateStore
 *       └─ W304 RenderOrchestrator (the real one)
 *           └─ createAnimeRenderBatchExecutor (the REAL W502 plugin)
 *               └─ onOutput → transport.sendWindow (the W305 intake seam —
 *                  the awaited receipt propagates the bounded link's
 *                  backpressure UPSTREAM into the render emission chain)
 *                   └─ LoopbackLiveOutputTransport (W104 bounded link,
 *                      integrity verification, accounting)
 *                      └─ LiveViewerSession (idempotent application,
 *                         verbatim payloads, the W704 presentation surface)
 * ```
 *
 * ONE shared `VirtualGpuClock` drives every stage (the W306 comparable-clock
 * domain): render durations, emission timestamps, admission and delivery
 * measurements are all readings of the same injected clock — the
 * emission-to-delivery latencies are directly comparable with the render
 * stage's own timings.
 *
 * HONEST PROFILE NOTE: the render stream's declared output profile is the
 * W502 anime prototype's own (`identity.ts`: 1170×880, 1 fps, svg/svg,
 * latency class `offline` — the ONLY real renderer in the monorepo today,
 * and the plugin deep-equal-refuses any other profile). The live transport
 * is profile-agnostic: it carries the renderer's declared profile VERBATIM
 * into the negotiated track (the streaming contract's "delivery format must
 * not change the canonical SWM or renderer API" rule) — the LIVE-ness here
 * is the DELIVERY (windows streamed as rendered, in watermark order, with
 * measured lag, skip-stale degradation in media time, bounded link,
 * reconnect), not a rewritten profile. The live-class negotiation paths are
 * unit-pinned in negotiation.test.ts with a live-class profile fixture.
 *
 * Harness rules (docs/testing/HARNESS.md): no `Math.random`, no `Date.now`,
 * no real timers — the virtual clock advances only through the executor's
 * own `sleep` calls; async waiting is microtask draining.
 */
import { describe, expect, test } from "bun:test";
import {
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
} from "@sporta/contracts";
import type { Watermark } from "@sporta/contracts";
import { VirtualGpuClock } from "@sporta/gpu-worker";
import { RenderOrchestrator, createAnimeRenderBatchExecutor } from "@sporta/render-orchestration";
import type { RenderOutputRecord, SwmUpdate, SwmUpdateStore } from "@sporta/render-orchestration";
import { buildRenderRequest } from "@sporta/testing";
import { eventWindow, stateAt } from "@sporta/temporal";
import { WorldModelEngine } from "@sporta/world-model";
import type { FootballState } from "@sporta/world-model";
import { LoopbackLiveOutputTransport } from "../src/transport";
import type { LiveSessionResult } from "../src/types";
import { TEST_EPOCH_MS, capturedObservability, consumeAll, liveDeliveryPolicy } from "./helpers";

/** The e2e session identity (one id across engine, request, transport). */
const SESSION = "sess-live-e2e";

/**
 * The W502 anime prototype's declared output profile, VERBATIM
 * (`@sporta/renderer-anime` identity.ts — the plugin deep-equal-refuses any
 * other). The live transport negotiates and carries it unchanged.
 */
const ANIME_PROFILE = {
  resolution: { w: 1170, h: 880 },
  frameRate: 1,
  codec: "svg",
  container: "svg",
  latencyClass: "offline",
} as const;

// ---------------------------------------------------------------------------
// The SWM story (a REAL W006 engine through the W402 seams — the W304
// fixture posture, compact form)
// ---------------------------------------------------------------------------

/** Six seconds of genuinely moving state: one update per second. */
function liveStory(sessionId: string): SwmUpdate[] {
  const football: FootballState = {
    pitch: {
      lengthAxisMeters: PITCH_LENGTH_AXIS_METERS,
      widthAxisMeters: PITCH_WIDTH_AXIS_METERS,
      origin: PITCH_ORIGIN,
      axes: PITCH_AXES,
    },
    clock: { period: "first-half", clockMs: 0, stoppage: false },
    score: {
      home: 0,
      away: 0,
      status: { status: "uncertain", value: "provisional", confidence: 0.6 },
    },
    possession: { status: "uncertain", value: { entityId: "p1" }, confidence: 0.7 },
    eventTaxonomyVersion: "v1",
  };
  const engine = WorldModelEngine.create(sessionId, { now: () => TEST_EPOCH_MS, football });
  const updates: SwmUpdate[] = [];
  for (let second = 1; second <= 6; second += 1) {
    const t = second * 1_000;
    engine.upsertEntity({
      entityId: "p1",
      kind: "participant",
      version: 1,
      lastEventTimeMs: t,
      state: { pitchPosition: { status: "known", value: { x: 50 + second, y: 34 } } },
    });
    engine.upsertEntity({
      entityId: "b1",
      kind: "ball",
      version: 1,
      lastEventTimeMs: t,
      state: {
        pitchPosition: {
          status: "uncertain",
          value: { x: 50 + second - 0.5, y: 34.2 },
          confidence: 0.9,
        },
      },
    });
    const snapshot = stateAt(engine, t).snapshot;
    const events = eventWindow(engine.eventsSince(0), {
      fromMs: t === 1_000 ? 0 : (second - 1) * 1_000,
      toMs: t,
    });
    updates.push({
      sequence: updates.length,
      watermark: { ...snapshot.watermark },
      snapshot,
      events: [...events],
      byteSize: 2_048,
    });
  }
  return updates;
}

/** A complete, fully-visible store (the whole story available immediately). */
class CompleteStoryStore implements SwmUpdateStore {
  private readonly updates: readonly SwmUpdate[];

  constructor(updates: readonly SwmUpdate[]) {
    this.updates = [...updates];
  }

  availableWatermark(): Watermark {
    return this.updates.length === 0
      ? { watermarkMs: 0, sequence: 0 }
      : this.updates[this.updates.length - 1]!.watermark;
  }

  isComplete(): boolean {
    return true;
  }

  updatesAfter(
    afterSequence: number,
    toMs: number,
    limit: number,
  ): { updates: SwmUpdate[]; more: boolean } {
    const matching = this.updates.filter(
      (update) => update.sequence > afterSequence && update.watermark.watermarkMs <= toMs,
    );
    return { updates: matching.slice(0, limit), more: matching.length > limit };
  }

  hasUpdatesAfter(afterSequence: number): boolean {
    return this.updates.some((update) => update.sequence > afterSequence);
  }

  nextGrowthAtMs(): number | undefined {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// The W304→W305 wiring (one shared clock, one awaited onOutput seam)
// ---------------------------------------------------------------------------

/** Everything the e2e wires, over one shared virtual clock. */
interface LiveStreamWiring {
  transport: LoopbackLiveOutputTransport;
  orchestrator: RenderOrchestrator;
  consume: () => Promise<import("../src/types").LiveDeliveryEvent[]>;
  close: () => Promise<LiveSessionResult>;
}

/** The render request every e2e wiring uses (the renderer's own profile). */
function liveRenderRequest() {
  return buildRenderRequest({
    sessionId: SESSION,
    rendererId: "anime.prototype",
    rendererVersion: "0.1.0",
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: ANIME_PROFILE,
    styleConfig: { styleId: "style-live-e2e", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: {
      canReferenceSourceFrames: false,
      canDeliverLive: true,
      canStoreDerivatives: true,
      canShare: false,
    },
    sourceFrameRefs: [],
  });
}

/** Wires the full live stream: engine → store → orchestrator → transport → viewer. */
function wiredLiveStream(options: { linkCapacity?: number; maxWatermarkLagMs?: number } = {}): {
  wiring: LiveStreamWiring;
  session: import("../src/viewer").LiveViewerSession;
} {
  const clock = new VirtualGpuClock(0);
  const obs = capturedObservability();
  const transport = new LoopbackLiveOutputTransport({
    sessionId: SESSION,
    clock, // THE one shared clock domain (W306 comparability)
    outputProfile: ANIME_PROFILE, // the renderer's declared profile, verbatim
    rightsPolicy: liveDeliveryPolicy(),
    limits: {
      ...(options.linkCapacity === undefined ? {} : { linkCapacity: options.linkCapacity }),
      ...(options.maxWatermarkLagMs === undefined
        ? {}
        : { maxWatermarkLagMs: options.maxWatermarkLagMs }),
    },
    observability: { logger: obs.logger, metrics: obs.metrics, correlation: obs.correlation },
  });
  const endpoint = transport.viewerEndpoint({ viewerId: "viewer-live-1" });
  const offer = transport.createOffer();
  const answer = endpoint.answer(offer);
  if (answer.kind !== "accept") {
    throw new Error(`the e2e viewer rejected the live offer (${answer.reason})`);
  }
  transport.acceptAnswer(answer);
  const session = endpoint.connect();

  const orchestrator = new RenderOrchestrator({
    sessionId: SESSION,
    store: new CompleteStoryStore(liveStory(SESSION)),
    renderExecutor: createAnimeRenderBatchExecutor({ renderDurationMs: 100 }),
    renderRequest: liveRenderRequest(),
    clock,
    observability: { logger: obs.logger, metrics: obs.metrics, correlation: obs.correlation },
    // THE LIVE SEAM: every rendered output goes straight into the live
    // transport. The awaited receipt means the W104 bounded link's
    // backpressure propagates upstream into the render emission chain.
    onOutput: async (record: RenderOutputRecord) => {
      await transport.sendWindow(record);
    },
  });
  return {
    wiring: {
      transport,
      orchestrator,
      consume: () => consumeAll(session),
      close: () => transport.close({ mode: "drain", reason: "stream-complete" }),
    },
    session,
  };
}

// ---------------------------------------------------------------------------
// The end-to-end run
// ---------------------------------------------------------------------------

describe("the W304 → W305 → viewer live stream (the acceptance run)", () => {
  test("every rendered output is viewable at the viewer, verbatim and accounted", async () => {
    const { wiring: wired } = wiredLiveStream();

    // The viewer consumes from the very start (the live posture).
    const consuming = wired.consume();
    await wired.orchestrator.start();
    const renderResult = await wired.orchestrator.done();
    const settle = await wired.close();
    const events = await consuming;

    // --- the render side completed and balanced (W304's own contract) ---
    expect(renderResult.outcome).toBe("completed");
    expect(renderResult.balanced).toBe(true);
    expect(renderResult.stats.outputsEmitted).toBe(6);

    // --- the transport delivered every output, exactly, balanced ---
    expect(settle.outcome).toBe("completed");
    expect(settle.balanced).toBe(true);
    expect(settle.stats.windowsIn).toBe(6);
    expect(settle.stats.windowsDelivered).toBe(6);
    expect(settle.stats.windowsInFlight).toBe(0);
    expect(settle.stats.windowsSkippedStale).toBe(0);
    expect(settle.stats.windowsDroppedByPolicy).toBe(0);
    expect(settle.stats.windowsFailed).toBe(0);
    expect(settle.stats.windowsAbandoned).toBe(0);

    // --- the viewer's stream: six windows in ordinal order, then closed ---
    expect(events.map((event) => event.kind)).toEqual([
      "window",
      "window",
      "window",
      "window",
      "window",
      "window",
      "session-closed",
    ]);
    const windows = events.filter(
      (event): event is Extract<(typeof events)[number], { kind: "window" }> =>
        event.kind === "window",
    );
    expect(windows.map((event) => event.window.ordinal)).toEqual([0, 1, 2, 3, 4, 5]);

    // --- VERBATIM END-TO-END: the applied payload IS the rendered output
    //     object (by reference — never rebuilt, never re-stamped) ---
    const applied = windows.map((event) => event.payload);
    for (let i = 0; i < renderResult.outputs.length; i += 1) {
      expect(applied[i]).toBe(renderResult.outputs[i]!.output);
    }

    // --- provenance survives the whole pipeline, field-for-field ---
    for (let i = 0; i < renderResult.outputs.length; i += 1) {
      const record = renderResult.outputs[i]!;
      const window = windows[i]!.window;
      expect(window.provenance.batchId).toBe(record.provenance.batchId);
      expect(window.provenance.batchOrdinal).toBe(record.provenance.batchOrdinal);
      expect(window.provenance.jobId).toBe(record.provenance.jobId);
      expect(window.provenance.rendererId).toBe(record.provenance.rendererId);
      expect(window.provenance.rendererVersion).toBe(record.provenance.rendererVersion);
      expect(window.watermark).toEqual(record.provenance.sourceWatermark);
    }

    // --- the content is viewable: every frame is a complete SVG document ---
    for (const payload of applied) {
      expect(payload.frames.length).toBeGreaterThan(0);
      for (const frame of payload.frames) {
        expect(frame.svg.startsWith("<svg")).toBe(true);
      }
    }

    // --- the frame/byte accounting is exact across the boundary ---
    const framesRendered = renderResult.outputs.reduce(
      (sum, record) => sum + record.output.frames.length,
      0,
    );
    expect(settle.stats.framesDelivered).toBe(framesRendered);
    expect(settle.stats.bytesDelivered).toBe(
      windows.reduce((sum, event) => sum + event.window.byteSize, 0),
    );

    // --- the shared-clock telemetry (the W306 seam) is measured, coherent ---
    const timing = wired.transport.telemetry();
    expect(timing).toHaveLength(6);
    for (const record of timing) {
      expect(record.disposition).toBe("delivered");
      expect(record.emittedAtMs).toBeGreaterThanOrEqual(0);
      expect(record.admittedAtMs).not.toBeNull();
      expect(record.deliveredAtMs).not.toBeNull();
      expect(record.admittedAtMs!).toBeGreaterThanOrEqual(record.emittedAtMs);
      expect(record.deliveredAtMs!).toBeGreaterThanOrEqual(record.admittedAtMs!);
    }
    expect(settle.stats.maxDeliveryLagMs).toBe(
      Math.max(...timing.map((record) => record.deliveryLagMs ?? 0)),
    );
  });

  test("a tight link keeps the whole pipeline bounded (backpressure propagates upstream)", async () => {
    // linkCapacity 2 with 6 outputs: the render emission chain parks on the
    // awaited sendWindow receipt whenever the link is full — the pipeline's
    // buffers stay at the configured bound end-to-end, and everything still
    // completes and balances.
    const { wiring: wired } = wiredLiveStream({ linkCapacity: 2 });
    const consuming = wired.consume();
    await wired.orchestrator.start();
    const renderResult = await wired.orchestrator.done();
    const settle = await wired.close();
    await consuming;

    expect(renderResult.outcome).toBe("completed");
    expect(renderResult.stats.outputsEmitted).toBe(6);
    expect(settle.stats.windowsDelivered).toBe(6);
    // The never-exceeded bound (the acceptance-adjacent "no unbounded
    // backlog" evidence at the output boundary).
    expect(settle.stats.maxLinkDepth).toBeLessThanOrEqual(2);
    expect(wired.transport.linkDropped()).toBe(0);
  });

  test("a late-joining viewer is served the fresh windows, with the stale ones accounted INLINE", async () => {
    // The viewer does NOT consume during the run: by the time it joins, the
    // head has advanced to 6000ms and the skip-stale policy (1500ms) marks
    // the trailing windows stale AT DEQUEUE — measured, accounted in the
    // stream, never silently skipped; the fresh windows still apply.
    const { wiring: wired, session } = wiredLiveStream({ maxWatermarkLagMs: 1_500 });

    await wired.orchestrator.start();
    const renderResult = await wired.orchestrator.done();
    expect(renderResult.stats.outputsEmitted).toBe(6);

    // The late join: everything is in the link, the head is at 6000ms.
    const consuming = wired.consume();
    const settle = await wired.close();
    const events = await consuming;

    // Windows at watermarks 1000..4000 trail the 6000ms head by more than
    // 1500ms: four accounted INLINE skips; 5000 and 6000 are fresh.
    const skips = events.filter((event) => event.kind === "window-skipped");
    const windows = events.filter((event) => event.kind === "window");
    expect(skips.map((event) => (event.kind === "window-skipped" ? event.ordinal : -1))).toEqual([
      0, 1, 2, 3,
    ]);
    expect(windows.map((event) => (event.kind === "window" ? event.window.ordinal : -1))).toEqual([
      4, 5,
    ]);
    for (const skip of skips) {
      if (skip.kind === "window-skipped") {
        expect(skip.reason).toBe("skipped-stale");
        expect(skip.lagMs).toBeGreaterThan(1_500);
      }
    }

    expect(settle.stats.windowsSkippedStaleAtDequeue).toBe(4);
    expect(settle.stats.windowsDelivered).toBe(2);
    expect(settle.balanced).toBe(true);

    // The consumer identity: every admitted ordinal accounted exactly once.
    const status = session.status();
    expect(status.appliedWindows).toBe(2);
    expect(status.skippedWindows).toBe(4);
    expect(status.accountedOrdinals).toBe(6);
    // The freshest window is the last applied one — a late joiner lands on
    // live content, not on the stale past.
    const lastApplied = session.applied()[1]!;
    expect(lastApplied.window.watermark.watermarkMs).toBe(6_000);
    expect(status.mediaLagMs).toBe(0);
  });
});
