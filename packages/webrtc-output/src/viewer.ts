/**
 * The viewer-side consumption seam (W305, deliverable 3 — the port W704
 * wires): the endpoint that answers offers, and the `LiveViewerSession`
 * that consumes the delivery stream.
 *
 * WHAT THIS IS (the honest boundary, W301 posture): a typed, browser-facing
 * consumption surface over the transport binding — frame-window records in
 * delivery order, presentation timing derived from the PAYLOAD's own
 * timestamps (never a clock), idempotent application keyed by the
 * watermark-derived window id (the streaming contract's Recovery rule: a
 * re-delivery is a counted duplicate, never a double-applied frame), an
 * honest live-state surface (phase, degradation reasons, buffer depth,
 * measured lags on the injected clock), and the W306 arrival telemetry.
 * A real WebRTC player (W704) satisfies this same surface behind a network.
 *
 * WHAT THIS IS NOT: a browser API, a media element, or a network stack.
 * The session is transport-agnostic: it is constructed over the
 * `LiveViewerTransportBinding` interface (the loopback transport provides
 * one; any implementation that satisfies the interface — a real WebRTC data
 * channel, a WebSocket relay — plugs in unchanged).
 *
 * NEVER-SILENT AT THE CONSUMER TOO: the transport promises every admitted
 * ordinal appears EXACTLY ONCE in the stream (as a `window` or an accounted
 * `window-skipped`; skip events may INTERLEAVE with later windows — an
 * eviction's fate can only be decided after those windows were delivered —
 * while the WINDOW stream itself stays strictly ordinal-increasing); the
 * session VERIFIES that promise as it consumes — a double-accounted ordinal
 * or an out-of-order window is a typed `protocol-violation`, never a
 * silently skipped frame (the consumer-side identity `appliedWindows +
 * skippedWindows === accountedOrdinals` is test-pinned; re-deliveries under
 * a stable id are counted duplicates, never re-accounted).
 */
import type { Logger, MetricsRegistry } from "@sporta/observability";
import { createLogger } from "@sporta/observability";
import { LiveOutputIntegrityError, LiveOutputProtocolError } from "./errors";
import { answerLiveOutputOffer } from "./negotiation";
import type { LiveSessionPhase } from "./state";
import type { LiveViewerArrivalRecord } from "./telemetry";
import type { LiveViewerTransportBinding, LiveReconnectReport } from "./transport";
import {
  LIVE_OUTPUT_METRIC_NAMES,
  type LiveDeliveryEvent,
  type LiveDeliveryTiming,
  type LiveOutputAnswer,
} from "./types";
import type { Watermark } from "@sporta/contracts";
import type { LiveFrameWindow, LiveOutputPayload } from "./types";
import { verifyFrameWindowIntegrity } from "./window";

// ---------------------------------------------------------------------------
// The endpoint (the viewer-side negotiation peer)
// ---------------------------------------------------------------------------

/**
 * The minimal host wiring the loopback endpoint drives (satisfied by
 * `LoopbackLiveOutputTransport.viewerEndpoint()`; kept structural so the
 * seam stays transport-agnostic).
 */
export interface LiveOutputHostWiring {
  readonly streamId: string;
  readonly sessionId: string;
  /** Attaches the viewer connection (the endpoint-accept path). */
  attachViewer(): void;
}

/** Options for the viewer endpoint's offer decision (the policy knobs). */
export interface LiveEndpointAnswerOptions {
  /** When set, offers with other protocol versions are rejected. */
  supportedProtocolVersion?: string;
  /** When set, only these codecs are served (typed reject otherwise). */
  supportedCodecs?: readonly string[];
  /** When set, only these latency classes are served. */
  supportedLatencyClasses?: readonly string[];
}

/**
 * The viewer-side endpoint: answers offers (typed accept/reject — the
 * WebRTC answer shape, vendor-neutral) and connects the consuming session.
 * One endpoint per transport; documents cross the "network" as plain
 * zod-validated documents.
 */
export interface LiveOutputEndpoint {
  readonly viewerId: string;
  readonly streamId: string;
  readonly sessionId: string;
  /**
   * The typed decision over an offer document: validates it, applies this
   * endpoint's policy (protocol version, video track, codec/latency-class
   * allow-lists), and returns the answer document for the host. Malformed
   * offers throw the typed protocol error; policy mismatches are typed
   * REJECT answers (negotiation, not fault). Pure — no side effects.
   */
  answer(offerDocument: unknown, options?: LiveEndpointAnswerOptions): LiveOutputAnswer;
  /**
   * Connects the viewer session (requires the host to have accepted an
   * answer — the session must be established). One live connection at a
   * time; reconnect through the session, not by connecting twice.
   */
  connect(): LiveViewerSession;
}

/** Builds one endpoint over the loopback host wiring + transport binding. */
export function createEndpoint(
  host: LiveOutputHostWiring,
  binding: LiveViewerTransportBinding,
  viewerId: string,
): LiveOutputEndpoint {
  let session: LiveViewerSession | null = null;
  return {
    viewerId,
    streamId: host.streamId,
    sessionId: host.sessionId,
    answer: (offerDocument: unknown, options: LiveEndpointAnswerOptions = {}) =>
      answerLiveOutputOffer(offerDocument, {
        viewerId,
        nowMs: binding.clock().now(),
        ...(options.supportedProtocolVersion === undefined
          ? {}
          : { supportedProtocolVersion: options.supportedProtocolVersion }),
        ...(options.supportedCodecs === undefined ? {} : { supportedCodecs: options.supportedCodecs }),
        ...(options.supportedLatencyClasses === undefined
          ? {}
          : { supportedLatencyClasses: options.supportedLatencyClasses }),
      }),
    connect: (): LiveViewerSession => {
      const phase = binding.phase();
      if (phase !== "established" && phase !== "degraded") {
        throw new LiveOutputProtocolError(
          `cannot connect a viewer before the session is established (phase: ${phase})`,
          { streamId: host.streamId, failureClass: "protocol-violation", phase },
        );
      }
      const terminal = binding.terminal();
      if (terminal !== null) {
        throw new LiveOutputProtocolError(
          `cannot connect a viewer to a closed session (${terminal.outcome})`,
          { streamId: host.streamId, failureClass: "protocol-violation", outcome: terminal.outcome },
        );
      }
      if (session !== null && session.connected && !session.terminated) {
        throw new LiveOutputProtocolError(
          "this endpoint already has a live viewer connection (reconnect through the session)",
          { streamId: host.streamId, failureClass: "protocol-violation" },
        );
      }
      if (session !== null && session.terminated) {
        throw new LiveOutputProtocolError(
          "the session is terminally closed — no further connections",
          { streamId: host.streamId, failureClass: "protocol-violation" },
        );
      }
      host.attachViewer();
      if (session === null) {
        session = new LiveViewerSession(binding, {
          viewerId,
          streamId: host.streamId,
          sessionId: host.sessionId,
        });
      } else {
        session.markReconnected();
      }
      return session;
    },
  };
}

// ---------------------------------------------------------------------------
// The applied-window surface (what W704 presents)
// ---------------------------------------------------------------------------

/**
 * One applied frame window: the protocol document, the payload VERBATIM, and
 * the presentation plan derived from the payload frames' OWN
 * `outputTimestampMs` values (media timeline — presentation timing NEVER
 * comes from a clock; the W301 timestamps-verbatim rule at the viewer).
 */
export interface AppliedLiveWindow {
  window: LiveFrameWindow;
  payload: LiveOutputPayload;
  /** The presentation plan: payload frame indices + timestamps, verbatim. */
  presentation: ReadonlyArray<{ frameIndex: number; outputTimestampMs: number }>;
  /** Protocol-clock reading when the session applied this window. */
  appliedAtMs: number;
  /** `true` when this application came from a reconnect replay. */
  redelivered: boolean;
  /** The transport-measured timing of the delivery (verbatim). */
  deliveryTiming: LiveDeliveryTiming;
}

/** The honest live-state surface (what W704 renders as player status). */
export interface LiveViewerStatus {
  viewerId: string;
  streamId: string;
  sessionId: string;
  /** The transport-side session phase (negotiating/established/degraded/closed). */
  phase: LiveSessionPhase;
  /** Whether THIS viewer connection is currently live. */
  connected: boolean;
  /** Why the session is degraded (empty when established). */
  degradationReasons: readonly string[];
  /** The newest watermark the transport has observed (verbatim). */
  latestObservedWatermark: Watermark | null;
  /** Link depth right now (queued frame windows — the buffer-depth seam). */
  bufferDepth: number;
  /**
   * Protocol-clock latency of the newest applied window:
   * `now − window.emittedAtMs` (emission→presentation, the shared injected
   * clock domain — comparable with W306's stage latencies). `null` before
   * the first application.
   */
  latencyToLatestWindowMs: number | null;
  /**
   * Media-time lag of the newest applied window: newest observed watermark
   * − applied watermark (media milliseconds, clock-independent). `null`
   * before the first application.
   */
  mediaLagMs: number | null;
  /** Windows applied exactly once (idempotent application). */
  appliedWindows: number;
  /** Re-deliveries suppressed by the idempotency key (counted, logged). */
  duplicateWindows: number;
  /** Ordinals the stream accounted as skipped (stale/evicted/reconnect-gap). */
  skippedWindows: number;
  /** The last applied delivery ordinal (`null` before the first). */
  lastAppliedOrdinal: number | null;
  /**
   * Ordinals the stream has accounted for THIS viewer (applied windows +
   * accounted skips + reconnect-gap ordinals never seen). The consumer-side
   * never-silent identity: `appliedWindows + skippedWindows ===
   * accountedOrdinals` (duplicates re-delivered under a stable id are
   * suppressed and counted separately — they never re-account an ordinal).
   */
  accountedOrdinals: number;
  /** The terminal session outcome, when the session has ended. */
  terminal: { outcome: "completed" | "stopped" | "failed"; failureClass?: string } | null;
}

/** Options for {@link LiveViewerSession}. */
export interface LiveViewerSessionOptions {
  viewerId: string;
  streamId: string;
  sessionId: string;
  logger?: Logger;
  metrics?: MetricsRegistry;
}

// ---------------------------------------------------------------------------
// The viewer session
// ---------------------------------------------------------------------------

/**
 * The consuming viewer session: pulls delivery events from the transport
 * binding (viewer-driven backpressure — the pull is the only thing that
 * drains the bounded link), applies frame windows idempotently, verifies
 * integrity at the application boundary, and exposes the live-state surface
 * plus the arrival telemetry.
 *
 * One pull stream at a time (`events()`), one live connection per endpoint
 * (`connect()`), reconnects through {@link LiveViewerSession.reconnect}.
 */
export class LiveViewerSession {
  readonly viewerId: string;
  readonly streamId: string;
  readonly sessionId: string;

  private readonly binding: LiveViewerTransportBinding;
  private readonly logger: Logger;
  private readonly metrics: MetricsRegistry | undefined;

  private readonly appliedRecords: AppliedLiveWindow[] = [];
  private readonly arrivalRecords: LiveViewerArrivalRecord[] = [];
  private readonly appliedWindowIds = new Set<string>();
  /** Every ordinal the stream has accounted for THIS viewer (window or skip). */
  private readonly seenOrdinals = new Set<number>();
  /** The highest ordinal of any APPLIED window (-1 before the first). */
  private lastWindowOrdinal = -1;
  private lastAppliedOrdinal: number | null = null;
  private appliedCount = 0;
  private duplicateCount = 0;
  private skippedCount = 0;
  private connectedState = true;
  /** Latched ONLY on the terminal `session-closed` event (never on a reconnectable connection-lost). */
  private closedEvent: LiveDeliveryEvent & { kind: "session-closed" } | null = null;
  private pulling = false;

  constructor(binding: LiveViewerTransportBinding, options: LiveViewerSessionOptions) {
    this.binding = binding;
    this.viewerId = options.viewerId;
    this.streamId = options.streamId;
    this.sessionId = options.sessionId;
    this.logger = options.logger ?? createLogger();
    this.metrics = options.metrics;
  }

  /** Whether this viewer connection is currently live. */
  get connected(): boolean {
    return this.connectedState;
  }

  /** Whether the session has terminally ended (no further consumption). */
  get terminated(): boolean {
    return this.closedEvent !== null;
  }

  /**
   * The delivery stream: one event per pull, in delivery order, applied
   * (windows) and accounted (skips/gaps) as they surface. Ends after
   * `connection-lost` (reconnectable — a later `events()` resumes after a
   * reconnect) or `session-closed` (terminal — the session never consumes
   * again). Only ONE pull stream may be active at a time — a second
   * `events()` iteration while one is active is a typed protocol error.
   */
  async *events(): AsyncGenerator<LiveDeliveryEvent, void, void> {
    if (this.closedEvent !== null) {
      yield this.closedEvent;
      return;
    }
    if (this.pulling) {
      throw new LiveOutputProtocolError(
        "a delivery stream is already being consumed from this viewer session",
        { streamId: this.streamId, failureClass: "protocol-violation" },
      );
    }
    this.pulling = true;
    try {
      for (;;) {
        const event = await this.binding.pullNext();
        if (event.kind === "connection-lost") {
          this.connectedState = false;
          yield event;
          return;
        }
        if (event.kind === "session-closed") {
          this.connectedState = false;
          this.closedEvent = event;
          yield event;
          return;
        }
        this.consumeEvent(event);
        yield event;
      }
    } finally {
      this.pulling = false;
    }
  }

  /** The honest live-state surface (see {@link LiveViewerStatus}). */
  status(): LiveViewerStatus {
    const latest = this.appliedRecords[this.appliedRecords.length - 1];
    const nowMs = this.binding.clock().now();
    const head = this.binding.latestObservedWatermark();
    return {
      viewerId: this.viewerId,
      streamId: this.streamId,
      sessionId: this.sessionId,
      phase: this.binding.phase(),
      connected: this.connectedState,
      degradationReasons: this.binding.degradationReasons(),
      latestObservedWatermark: head,
      bufferDepth: this.binding.linkDepth(),
      latencyToLatestWindowMs:
        latest === undefined ? null : nowMs - latest.window.emittedAtMs,
      mediaLagMs:
        latest === undefined || head === null
          ? null
          : head.watermarkMs - latest.window.watermark.watermarkMs,
      appliedWindows: this.appliedCount,
      duplicateWindows: this.duplicateCount,
      skippedWindows: this.skippedCount,
      lastAppliedOrdinal: this.lastAppliedOrdinal,
      accountedOrdinals: this.seenOrdinals.size,
      terminal: this.binding.terminal(),
    };
  }

  /** The idempotently-applied frame windows, in application order. */
  applied(): readonly AppliedLiveWindow[] {
    return [...this.appliedRecords];
  }

  /** The per-applied-window arrival records (the W306 viewer-side seam). */
  telemetry(): LiveViewerArrivalRecord[] {
    return this.arrivalRecords.map((record) => ({ ...record }));
  }

  /**
   * Disconnects this viewer connection (the transport surfaces
   * `connection-lost` on the active pull; the session becomes
   * reconnectable). Idempotent.
   */
  disconnect(): void {
    if (!this.connectedState) return;
    this.binding.disconnect();
    this.connectedState = false;
    this.logger.info("live output viewer session disconnected by the consumer", {
      streamId: this.streamId,
      viewerId: this.viewerId,
    });
  }

  /**
   * Reconnects from a resume ordinal: retained windows at or after the
   * resume point are re-delivered (idempotent re-application — counted
   * duplicates for anything already applied); a resume point older than the
   * retention covers surfaces a counted `reconnect-gap`. Delegates the
   * report; typed protocol violations propagate (a resume point ahead of
   * delivery, a closed session).
   */
  reconnect(resumeFromOrdinal: number): LiveReconnectReport {
    if (this.closedEvent !== null) {
      throw new LiveOutputProtocolError(
        "cannot reconnect a terminally closed viewer session",
        { streamId: this.streamId, failureClass: "protocol-violation" },
      );
    }
    const report = this.binding.reconnect(resumeFromOrdinal);
    this.connectedState = true;
    return report;
  }

  /** Endpoint-internal: marks the connection live again (connect() path). */
  markReconnected(): void {
    this.connectedState = true;
  }

  // -------------------------------------------------------------------------
  // Event application (idempotent, in-order, integrity-checked)
  // -------------------------------------------------------------------------

  /** Consumes one non-terminal delivery event (apply + account + verify). */
  private consumeEvent(event: LiveDeliveryEvent): void {
    switch (event.kind) {
      case "window":
        this.applyWindow(event);
        return;
      case "window-skipped": {
        if (this.seenOrdinals.has(event.ordinal)) {
          throw new LiveOutputProtocolError(
            `viewer double-accounting violation: ordinal ${event.ordinal} skipped twice ` +
              `(the stream must account every admitted ordinal EXACTLY once)`,
            {
              streamId: this.streamId,
              failureClass: "protocol-violation",
              ordinal: event.ordinal,
            },
          );
        }
        this.seenOrdinals.add(event.ordinal);
        this.skippedCount += 1;
        this.logger.warn("live output viewer window skipped (accounted)", {
          streamId: this.streamId,
          viewerId: this.viewerId,
          ordinal: event.ordinal,
          windowId: event.windowId,
          reason: event.reason,
          ...(event.lagMs === undefined ? {} : { lagMs: event.lagMs }),
        });
        this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.viewerWindowsSkipped).inc();
        return;
      }
      case "reconnect-gap": {
        // Ordinals [fromOrdinal, toOrdinal) will never ARRIVE again. Those
        // this viewer never saw are counted as skipped; those already
        // accounted (seen before the disconnect) are no-ops — never a silent
        // skip, never a double count.
        let unseen = 0;
        for (let ordinal = event.fromOrdinal; ordinal < event.toOrdinal; ordinal += 1) {
          if (!this.seenOrdinals.has(ordinal)) {
            unseen += 1;
            this.seenOrdinals.add(ordinal);
          }
        }
        this.skippedCount += unseen;
        this.logger.warn("live output viewer reconnect gap accounted", {
          streamId: this.streamId,
          viewerId: this.viewerId,
          fromOrdinal: event.fromOrdinal,
          toOrdinal: event.toOrdinal,
          transportSkipped: event.skippedCount,
          unseenHere: unseen,
        });
        if (unseen > 0) {
          this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.viewerWindowsSkipped).inc(unseen);
        }
        return;
      }
      case "connection-lost":
      case "session-closed":
        // Handled by the pull loop (terminal events).
        return;
    }
  }

  /** Applies one window event: idempotency, integrity, in-order, telemetry. */
  private applyWindow(
    event: LiveDeliveryEvent & { kind: "window"; window: LiveFrameWindow; payload: LiveOutputPayload },
  ): void {
    const { window, payload } = event;
    const nowMs = this.binding.clock().now();

    // Integrity at the application boundary (defense in depth over the
    // transport's own delivery-boundary check — a mismatch is reported to
    // the transport AND fails the session loud, never a presented
    // corrupted frame).
    const integrity = verifyFrameWindowIntegrity({ window, payload });
    if (!integrity.ok) {
      this.binding.reportIntegrityConflict(window);
      throw new LiveOutputIntegrityError(
        `viewer-side integrity verification failed for ${window.windowId}: ${integrity.reason}`,
        {
          streamId: this.streamId,
          failureClass: "integrity-violation",
          windowId: window.windowId,
          ordinal: window.ordinal,
          ...(integrity.frameIndex === undefined ? {} : { frameIndex: integrity.frameIndex }),
        },
      );
    }

    if (this.appliedWindowIds.has(window.windowId)) {
      // The Recovery rule: a re-delivery under a stable id is a counted
      // duplicate — never a double-applied frame.
      this.duplicateCount += 1;
      this.logger.info("live output viewer duplicate window suppressed (idempotent)", {
        streamId: this.streamId,
        viewerId: this.viewerId,
        windowId: window.windowId,
        ordinal: window.ordinal,
        redelivered: event.redelivered,
      });
      this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.viewerWindowsDuplicate).inc();
      return;
    }

    // Never-silent accounting at the consumer: the ordinal must be fresh
    // (an already-accounted ordinal re-arriving as a NON-duplicate window
    // is a lying transport) and the WINDOW stream must be ordinal-increasing
    // (skip events may interleave — an eviction's fate can only be decided
    // after later windows were already delivered).
    if (this.seenOrdinals.has(window.ordinal)) {
      throw new LiveOutputProtocolError(
        `viewer double-accounting violation: ordinal ${window.ordinal} arrived as a window ` +
          `after being accounted (the stream must account every admitted ordinal EXACTLY once)`,
        {
          streamId: this.streamId,
          failureClass: "protocol-violation",
          ordinal: window.ordinal,
        },
      );
    }
    if (window.ordinal <= this.lastWindowOrdinal) {
      throw new LiveOutputProtocolError(
        `viewer in-order violation: window ordinal ${window.ordinal} is not above the last ` +
          `applied window ordinal ${this.lastWindowOrdinal}`,
        {
          streamId: this.streamId,
          failureClass: "protocol-violation",
          ordinal: window.ordinal,
          lastWindowOrdinal: this.lastWindowOrdinal,
        },
      );
    }

    // Apply: record, account the ordinal, mint the arrival record.
    const record: AppliedLiveWindow = {
      window,
      payload,
      presentation: payload.frames.map((frame) => ({
        frameIndex: frame.frameIndex,
        outputTimestampMs: frame.outputTimestampMs,
      })),
      appliedAtMs: nowMs,
      redelivered: event.redelivered,
      deliveryTiming: event.timing,
    };
    this.appliedRecords.push(record);
    this.appliedWindowIds.add(window.windowId);
    this.seenOrdinals.add(window.ordinal);
    this.appliedCount += 1;
    this.lastAppliedOrdinal = window.ordinal;
    this.lastWindowOrdinal = window.ordinal;
    const head = this.binding.latestObservedWatermark();
    this.arrivalRecords.push({
      windowId: window.windowId,
      ordinal: window.ordinal,
      watermark: { ...window.watermark },
      appliedAtMs: nowMs,
      bufferDepthAtApply: this.binding.linkDepth(),
      mediaLagAtApplyMs:
        head === null ? 0 : head.watermarkMs - window.watermark.watermarkMs,
      deliveryLatencyMs: nowMs - window.emittedAtMs,
    });
    this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.viewerWindowsApplied).inc();
    this.logger.info("live output viewer window applied", {
      streamId: this.streamId,
      viewerId: this.viewerId,
      windowId: window.windowId,
      ordinal: window.ordinal,
      frameCount: window.frameCount,
      redelivered: event.redelivered,
    });
  }
}
