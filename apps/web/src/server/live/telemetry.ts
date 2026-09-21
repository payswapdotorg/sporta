/**
 * THE LIVE TELEMETRY PLUMBING (L006) — the apps/web server seams that carry
 * the frozen live-reality.md §9 counters from the REAL live pipeline to the
 * operator-facing API surface.
 *
 * THE PLUMBING (whose stages report where):
 *
 * ```
 * L002 source ──(the view-model's producer pull)── the INGEST probe
 *   → probe.noteIngested(pulledAtMs → ingestedAtMs)      [source-to-ingest]
 *   → probe.noteWorldStateUpdated(swmAtMs)                [ingest-to-SWM]
 *   → probe.noteFrameRendered(renderedAtMs)               [SWM-to-render]
 * transport ──(the subscriber's delivery pull)── the DECORATOR
 *   → service.noteFramePresented(sourceSequence, atMs)    [end-to-end]
 *   → service.noteFrameDrops(count)                       [frame drops]
 * ```
 *
 * - The PROBE (`{@link LiveTelemetryProbe}`) is the additive hook the L005
 *   tactical view-model's producer calls at its three stage boundaries
 *   (absent → zero behavior change). Worker A's L003/L004 engine reports
 *   on the SAME seam when it lands (the frozen LiveObservation/LiveWorldState
 *   shapes — `noteWorldStateUpdated` is its port; no shared files).
 * - The TRANSPORT DECORATOR (`{@link withLiveTelemetry}`) wraps the real
 *   W915 SSE transport: it injects the per-session probe into tactical
 *   registrations (before the channel builds its producer), stamps the
 *   delivery boundary on every `world` frame a consumer pulls, and
 *   reconciles the channel's own counted frame drops at read time.
 * - The SERVICE (`{@link createLiveTelemetryService}`) owns one
 *   `LiveTelemetryCollector` per live session and answers the §9 snapshot
 *   the operator route serves (`GET /api/operations/live-telemetry`).
 *
 * HONESTY: story-timeline channels (the dev-seed animated-SVG path) carry
 * NO probe — their sessions answer NO snapshot (the honest absence, never
 * an invented one). The §9 counters are the frozen contract's own
 * vocabulary; nothing here invents a measurement.
 */
import type {
  LiveIngestReport,
  LiveRenderReport,
  LiveSwmUpdateReport,
  LiveTelemetrySnapshot,
} from "@sporta/live-source";
import { LiveTelemetryCollector } from "@sporta/live-source";
import type { LiveTransport, LiveSubscriber } from "./transport";
import type { LiveSourceRegistration } from "./transport";

// ---------------------------------------------------------------------------
// The probe (the stage-report port the live producer calls)
// ---------------------------------------------------------------------------

/**
 * The stage-report port the live producer (today: the L005 view-model's
 * projection; Worker A's L003/L004 engine when it lands) calls at its
 * three pipeline boundaries. Every method is a REAL-clock report — the
 * producer owns its clock seam; nothing here reads one.
 */
export interface LiveTelemetryProbe {
  /** The ingest seam: the observation entered the pipeline (source-to-ingest). */
  noteIngested(report: LiveIngestReport): void;
  /** The SWM stage: the world-state update over the observation completed. */
  noteWorldStateUpdated(observation: { sequence: number }, report: LiveSwmUpdateReport): void;
  /** The render stage: the renderer-consumable frame completed. */
  noteFrameRendered(observation: { sequence: number }, report: LiveRenderReport): void;
}

// ---------------------------------------------------------------------------
// The service (one collector per live session)
// ---------------------------------------------------------------------------

/** Options for {@link createLiveTelemetryService}. */
export interface LiveTelemetryServiceOptions {
  /** The injected clock (the composition's own `nowMs`). */
  nowMs: () => number;
}

/** The live telemetry service (the operator surface's data seam). */
export interface LiveTelemetryService {
  /** The per-session probe (created on first use; idempotent per session). */
  probeFor(sessionId: string): LiveTelemetryProbe;
  /** The delivery boundary: one frame handed to a consumer. */
  noteFramePresented(sessionId: string, sequence: number, presentedAtMs: number): void;
  /**
   * The §9 snapshot for one session (`null` when the session carries no
   * probe — the honest absence for story-timeline channels).
   */
  snapshot(sessionId: string): LiveTelemetrySnapshot | null;
  /** Every instrumented session's snapshot (the operator listing). */
  snapshots(): { sessionId: string; snapshot: LiveTelemetrySnapshot }[];
  /** Drops a session's collector (the source went away). */
  forget(sessionId: string): void;
  /**
   * The transport this service instruments (set by the decorator at
   * wiring time; the frame-drop reconciliation reads the channel's own
   * honest counters through it).
   */
  setTransport(transport: LiveTransport): void;
}

/** Creates the live telemetry service (one collector per live session). */
export function createLiveTelemetryService(
  options: LiveTelemetryServiceOptions,
): LiveTelemetryService {
  const collectors = new Map<string, LiveTelemetryCollector>();
  const seenChannelDrops = new Map<string, number>();
  let transport: LiveTransport | null = null;

  function collectorOf(sessionId: string): LiveTelemetryCollector {
    let collector = collectors.get(sessionId);
    if (collector === undefined) {
      collector = new LiveTelemetryCollector({ sessionId, nowMs: options.nowMs });
      collectors.set(sessionId, collector);
    }
    return collector;
  }

  return {
    probeFor(sessionId: string): LiveTelemetryProbe {
      const collector = collectorOf(sessionId);
      return {
        noteIngested: (report) => collector.noteIngested(report),
        noteWorldStateUpdated: (observation, report) =>
          collector.noteWorldStateUpdated(observation, report),
        noteFrameRendered: (observation, report) =>
          collector.noteFrameRendered(observation, report),
      };
    },
    noteFramePresented(sessionId, sequence, presentedAtMs) {
      collectorOf(sessionId).noteFramePresented({ sequence }, { presentedAtMs });
    },
    snapshot(sessionId) {
      const collector = collectors.get(sessionId);
      if (collector === undefined) return null;
      reconcileFrameDrops(sessionId, collector);
      return collector.snapshot();
    },
    snapshots() {
      return [...collectors.entries()].map(([sessionId, collector]) => {
        reconcileFrameDrops(sessionId, collector);
        return { sessionId, snapshot: collector.snapshot() };
      });
    },
    forget(sessionId) {
      collectors.delete(sessionId);
      seenChannelDrops.delete(sessionId);
    },
    setTransport(inner: LiveTransport) {
      transport = inner;
    },
  };

  /**
   * Reconciles the channel's OWN counted frame drops into the §9 counter
   * (the channel's drop-oldest accounting is the truth source; the delta
   * since the last read is banked — never re-counted).
   */
  function reconcileFrameDrops(sessionId: string, collector: LiveTelemetryCollector): void {
    if (transport === null) return;
    const status = transport.status(sessionId);
    if (status === null) return;
    const lastSeen = seenChannelDrops.get(sessionId) ?? 0;
    if (status.droppedFrames > lastSeen) {
      collector.noteFrameDrops(status.droppedFrames - lastSeen);
      seenChannelDrops.set(sessionId, status.droppedFrames);
    }
  }
}

// ---------------------------------------------------------------------------
// The transport decorator (delivery stamps + probe injection)
// ---------------------------------------------------------------------------

/** One wire event the decorator parsed off the SSE block (name + payload). */
interface ParsedSseEvent {
  event: string;
  data: string;
}

/** Parses one SSE block into its event name + joined data (best effort). */
function parseSseBlock(block: string): ParsedSseEvent | null {
  let event = "";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).replace(/^ /, ""));
  }
  if (event.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

/**
 * Wraps the real W915 SSE transport with the L006 telemetry seams:
 *
 * - `registerSource` injects the per-session PROBE into tactical
 *   registrations (the channel's producer is then instrumented — the
 *   transport's channels, buffers and close semantics are untouched);
 * - `subscribe` wraps every subscriber: each `world` frame a consumer
 *   pulls is stamped at the delivery boundary (the true end-to-end
 *   presentation moment);
 * - `removeSource` forgets the session's collector (its snapshot is gone
 *   with the source — never a stale accounting).
 *
 * The decorator is a pure wrapper: it never changes a byte on the wire,
 * and its only clock is the INJECTED one (the repo's constitution —
 * `Date.now` appears nowhere in this module).
 */
export function withLiveTelemetry(
  inner: LiveTransport,
  service: LiveTelemetryService,
  nowMs: () => number,
): LiveTransport {
  service.setTransport(inner);
  return {
    state: () => inner.state(),
    detail: () => inner.detail(),
    listSources: () => inner.listSources(),
    registerSource(source: LiveSourceRegistration): void {
      if (source.tactical !== undefined) {
        // The probe injection: the channel's producer is created from this
        // registration on subscribe — the probe rides it additively.
        inner.registerSource({
          ...source,
          tactical: { ...source.tactical, telemetry: service.probeFor(source.sessionId) },
        });
        return;
      }
      inner.registerSource(source);
    },
    removeSource(sessionId: string): void {
      service.forget(sessionId);
      inner.removeSource(sessionId);
    },
    subscribe(sessionId: string): LiveSubscriber | null {
      const subscriber = inner.subscribe(sessionId);
      if (subscriber === null) return null;
      return {
        sessionId: subscriber.sessionId,
        async nextEvent(): Promise<string | null> {
          const block = await subscriber.nextEvent();
          if (block === null) return null;
          // The delivery stamp: this frame just reached its consumer.
          const parsed = parseSseBlock(block);
          if (parsed !== null && parsed.event === "world") {
            try {
              const frame = JSON.parse(parsed.data) as { sourceSequence?: number };
              if (typeof frame.sourceSequence === "number") {
                service.noteFramePresented(sessionId, frame.sourceSequence, nowMs());
              }
            } catch {
              // A malformed payload is the transport's own failure class —
              // never a telemetry fabrication.
            }
          }
          return block;
        },
        close: () => subscriber.close(),
        stats: () => subscriber.stats(),
      };
    },
    status: (sessionId: string) => inner.status(sessionId),
    // L014 (additive at merge): the replay record is a pure READ of the
    // inner transport's recorded finite window — passed through verbatim
    // (the decorator never changes a byte, and telemetry stamps nothing
    // on the replay path — it is the LIVE delivery boundary only).
    replayRecord: (sessionId: string) => inner.replayRecord(sessionId),
    closeAll: () => inner.closeAll(),
  };
}
