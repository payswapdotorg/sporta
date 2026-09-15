/**
 * `LoopbackLiveOutputTransport` (W305) — the deterministic in-process
 * implementation of the live output transport contract.
 *
 * It ACTUALLY moves frame-window payloads from a W304-style orchestrated
 * render stream to a consuming viewer-side port, in real delivery order,
 * with the full never-silent accounting: `delivered = emitted −
 * dropped-by-policy − failed`, exact, fail-loud (see `./types.ts` for the
 * master identity and its sub-identities, runtime-asserted at every settle).
 *
 * THE HONEST BOUNDARY (the W301 `LiveSource` posture, at the output side):
 * this is the SEAM a real WebRTC implementation satisfies. There is no
 * network, no SDP/ICE/DTLS/SRTP, no browser — deliberately (architecture-
 * lock §9 vendor neutrality; zero external runtime deps). The value is the
 * CONTRACT (typed, versioned, zod-validated documents) plus this
 * deterministic reference implementation: a real WebRTC stack is future work
 * behind the same `sendWindow` / `viewerEndpoint` / `close` interfaces.
 *
 * Mechanics:
 *
 * - the LINK is the W104 `BoundedChannel` VERBATIM (block / reject /
 *   drop-oldest; byte budget; counted, logged, metered drops). Sends are
 *   serialized through one chain (the W304 emission-tail pattern) so
 *   delivery ordinals — assigned ONLY to admitting windows — stay
 *   contiguous: the viewer's in-order check treats ANY hole as a protocol
 *   violation, and the pull path surfaces every non-delivered admitted
 *   ordinal INLINE as an accounted `window-skipped` event (the consumer-side
 *   never-silent rule: the stream accounts every ordinal exactly once).
 * - the PULL is viewer-driven (one `tryReceive` per wakeup, parked on a
 *   signal that every content-affecting event resolves) — backpressure stays
 *   bounded end to end, exactly like W301's service-pulls-from-source
 *   posture mirrored at the output.
 * - integrity is verified at the delivery boundary (SRTP-authenticate-at-
 *   the-stack posture): every window's hashes are recomputed before the
 *   viewer sees it; a mismatch fails the session LOUD (class
 *   `integrity-violation`), never presents corrupted frames.
 * - the RETENTION ring (bounded) retains the last delivered windows for
 *   reconnect re-delivery; a resume point older than the retention covers
 *   surfaces a counted `reconnect-gap` (never a silent skip).
 * - degradation: skip-stale at admission AND at pull (measured against the
 *   newest observed watermark, the ORIGINAL watermark preserved); the
 *   session phase degrades on the first policy loss and recovers on a
 *   fresh in-bound delivery — every transition counted + logged + metered.
 */
import {
  SCHEMA_VERSION,
  deriveRightsCapabilities,
  type AuthorizationPolicy,
  type OutputProfile,
  type Watermark,
} from "@sporta/contracts";
import { BoundedChannel, ChannelClosedError, ResourceLimitError } from "@sporta/transport";
import { createLogger, type CorrelationContext, type Logger, type MetricsRegistry } from "@sporta/observability";
import {
  LiveOutputIntegrityError,
  LiveOutputNegotiationError,
  LiveOutputProfileMismatchError,
  LiveOutputProtocolError,
} from "./errors";
import {
  answerLiveOutputOffer,
  assertLiveDeliveryRights,
  buildLiveOutputOffer,
  parseLiveOutputAnswer,
} from "./negotiation";
import { LiveSessionPhaseMachine, type LiveSessionPhase } from "./state";
import type { LiveWindowTimingRecord } from "./telemetry";
import {
  LIVE_OUTPUT_METRIC_NAMES,
  LIVE_OUTPUT_PROTOCOL_VERSION,
  LiveFrameWindow,
  assertLiveOutputAccounting,
  emptyLiveStats,
  type LiveBackpressurePolicy,
  type LiveDeliveryEvent,
  type LiveDeliveryTiming,
  type LiveFrameWindowEnvelope,
  type LiveOutputClock,
  type LiveOutputEmission,
  type LiveOutputFailureClass,
  type LiveOutputLimits,
  type LiveOutputOffer,
  type LiveOutputPayload,
  type LiveOutputStats,
  type LiveSessionResult,
  type LiveSendRefusalDetails,
  type LiveWindowSendReceipt,
} from "./types";
import { DEFAULT_LIVE_OUTPUT_LIMITS } from "./types";
import { buildLiveFrameWindow, frameWindowId, validateLiveOutputPayload, verifyFrameWindowIntegrity } from "./window";
import { createEndpoint } from "./viewer";
import type { LiveOutputEndpoint, LiveViewerSession } from "./viewer";

/** The link message: the W104 `StageMessage` shape carrying one envelope. */
export interface LiveLinkMessage {
  sessionId: string;
  schemaVersion: string;
  /** The window's delivery ordinal (the stage sequence). */
  sequence: number;
  watermark: Watermark;
  payload: LiveFrameWindowEnvelope;
  correlationId: string;
  traceId: string;
}

/** One retained-window ledger entry (the accounting join record). */
interface OrdinalEntry {
  ordinal: number;
  windowId: string;
  watermark: Watermark;
  frameCount: number;
  byteSize: number;
  /** The internal receipt key of this admission's timing record. */
  timingKey: number;
  disposition: "in-flight" | "delivered" | "skipped-stale" | "dropped-by-policy" | "abandoned" | "failed";
}

/** The internals surface handed to the viewer session (in-process wiring). */
export interface LiveViewerTransportBinding {
  pullNext(): Promise<LiveDeliveryEvent>;
  reconnect(resumeFromOrdinal: number): LiveReconnectReport;
  disconnect(): void;
  reportIntegrityConflict(window: LiveFrameWindow): void;
  linkDepth(): number;
  latestObservedWatermark(): Watermark | null;
  phase(): LiveSessionPhase;
  degradationReasons(): readonly string[];
  terminal(): { outcome: "completed" | "stopped" | "failed"; failureClass?: LiveOutputFailureClass } | null;
  liveStats(): LiveOutputStats;
  clock(): LiveOutputClock;
}

/** The report of one viewer reconnect (typed, counted). */
export interface LiveReconnectReport {
  /** The ordinal the viewer asked to resume from. */
  resumeFromOrdinal: number;
  /** Windows re-delivered from the retention buffer. */
  replayCount: number;
  /** Ordinals skipped because the resume point is older than retention. */
  gapSkipped: number;
}

/** Observability wiring for the transport. */
export interface LiveOutputObservability {
  logger?: Logger;
  metrics?: MetricsRegistry;
  correlation?: CorrelationContext;
}

/** Options for {@link LoopbackLiveOutputTransport}. */
export interface LoopbackLiveOutputTransportOptions {
  sessionId: string;
  /** Defaults to `live-<sessionId>`. */
  streamId?: string;
  /** The ONE injected protocol clock (the only time source). */
  clock: LiveOutputClock;
  /**
   * The output profile the render stream produces (carried VERBATIM into
   * the offer's track declaration; every window must match it).
   */
  outputProfile: OutputProfile;
  /**
   * The authorization policy for live delivery (fail-closed: re-derived at
   * the offer gate AND at every send — `canDeliverLive` required).
   */
  rightsPolicy: AuthorizationPolicy;
  limits?: Partial<LiveOutputLimits>;
  /** The W104 link policy (default `block` — natural backpressure). */
  backpressure?: LiveBackpressurePolicy;
  observability?: LiveOutputObservability;
}

/**
 * The deterministic loopback live output transport. One instance is one
 * live output session (`negotiating -> established -> (degraded <->
 * established) -> closed`).
 */
export class LoopbackLiveOutputTransport {
  readonly streamId: string;
  private readonly sessionId: string;
  private readonly clock: LiveOutputClock;
  private readonly profile: OutputProfile;
  private readonly rightsPolicy: AuthorizationPolicy;
  private readonly limits: LiveOutputLimits;
  private readonly backpressure: LiveBackpressurePolicy;
  private readonly logger: Logger;
  private readonly metrics: MetricsRegistry | undefined;
  private readonly correlation: CorrelationContext;

  private readonly accounting: LiveOutputStats = emptyLiveStats();
  private readonly phaseMachine: LiveSessionPhaseMachine;
  private readonly channel: BoundedChannel<LiveLinkMessage>;
  /** FIFO mirror of the channel queue (eviction attribution, W304 pattern). */
  private readonly linkLedger: number[] = [];
  /** Every admitted ordinal's accounting record. */
  private readonly ordinals = new Map<number, OrdinalEntry>();
  /** Per-RECEIPT timing records, insertion-ordered (the W306 seam). */
  private readonly timingRecords = new Map<number, LiveWindowTimingRecord>();
  /** The bounded retention ring of delivered windows (reconnect replay). */
  private readonly retention: LiveFrameWindowEnvelope[] = [];
  /** Staged stream events awaiting return to the viewer (ordinal order). */
  private pendingEmissions: LiveDeliveryEvent[] = [];

  private nextOrdinal = 0;
  /** Internal receipt counter: the unique timing-record key per `sendWindow`. */
  private nextReceiptKey = 0;
  /**
   * Messages the viewer has RECEIVED from the channel but whose ledger
   * entries are not shifted yet (the pull path may await a concurrent
   * admission between `tryReceive` and the shift). Eviction reconciliation
   * counts them as still-in-link: a held message was received, never
   * evicted — misattributing it would be a lie.
   */
  private viewerHolding = 0;
  private lastStreamedOrdinal = -1;
  private lastDeliveredOrdinal = -1;
  private latestHead: Watermark | null = null;
  private viewerDisconnected = false;
  private rightsRevoked = false;
  /** The serialized send chain (the W304 emission-tail pattern). */
  private sendChain: Promise<unknown> = Promise.resolve();
  /**
   * The admitOne task CURRENTLY executing on the chain, or `null` when the
   * chain is idle. The viewer pull awaits it when it observes a message the
   * admission's continuation has not yet booked (the channel's internal
   * state change and the ledger bookkeeping are one microtask apart — the
   * pull coordinates instead of trusting interleaving; awaiting is
   * deadlock-free because a message can only be VISIBLE once its send
   * resolved, which means the continuation is already queued).
   */
  private currentAdmitTask: Promise<unknown> | null = null;

  private linkClosed = false;
  private closingMode: "drain" | "cancel" | null = null;
  private drainOutcome: "completed" | "stopped" = "stopped";
  private terminalState: {
    outcome: "completed" | "stopped" | "failed";
    failureClass?: LiveOutputFailureClass;
    failureMessage?: string;
  } | null = null;
  private readonly settleWaiters: Array<(result: LiveSessionResult) => void> = [];

  private viewerSignal: Promise<void> | null = null;
  private viewerSignalResolve: (() => void) | null = null;

  private endpoint: LiveOutputEndpoint | null = null;
  private degradationReasons: string[] = [];

  constructor(options: LoopbackLiveOutputTransportOptions) {
    this.sessionId = options.sessionId;
    this.streamId = options.streamId ?? `live-${options.sessionId}`;
    this.clock = options.clock;
    this.profile = options.outputProfile;
    this.rightsPolicy = options.rightsPolicy;
    this.limits = { ...DEFAULT_LIVE_OUTPUT_LIMITS, ...options.limits };
    this.backpressure = options.backpressure ?? "block";
    this.logger = options.observability?.logger ?? createLogger();
    this.metrics = options.observability?.metrics;
    this.correlation =
      options.observability?.correlation ??
      ({ sessionId: this.sessionId, correlationId: `corr-${this.streamId}`, traceId: `trace-${this.streamId}` } as const);
    this.phaseMachine = new LiveSessionPhaseMachine(
      this.accounting,
      this.logger,
      this.metrics,
      this.streamId,
    );
    this.channel = new BoundedChannel<LiveLinkMessage>(
      {
        capacity: this.limits.linkCapacity,
        ...(this.limits.maxLinkBytes === null ? {} : { maxBytes: this.limits.maxLinkBytes }),
        policy: this.backpressure,
        sizer: (msg) => msg.payload.window.byteSize,
      },
      { logger: this.logger, ...(this.metrics === undefined ? {} : { metrics: this.metrics }) },
    );
  }

  // -------------------------------------------------------------------------
  // Negotiation (host side)
  // -------------------------------------------------------------------------

  /** The current session phase. */
  phase(): LiveSessionPhase {
    return this.phaseMachine.current();
  }

  /**
   * Mints the offer document. FAIL-CLOSED RIGHTS GATE (the W301 posture:
   * the gate runs BEFORE anything opens): re-derives the capabilities from
   * the authorization policy at the injected clock's reading and throws the
   * typed `LiveOutputRightsError` without `canDeliverLive` — the session is
   * marked terminally failed (`rights-denied`), no offer, no stream.
   */
  createOffer(): LiveOutputOffer {
    if (this.terminalState !== null) {
      throw new LiveOutputProtocolError(
        `cannot create an offer on a closed session (${this.terminalState.outcome})`,
        { streamId: this.streamId, failureClass: "protocol-violation" },
      );
    }
    if (this.phase() !== "negotiating") {
      throw new LiveOutputProtocolError("createOffer requires the negotiating phase", {
        streamId: this.streamId,
        failureClass: "protocol-violation",
        phase: this.phase(),
      });
    }
    try {
      assertLiveDeliveryRights(this.rightsPolicy, this.clock.now(), this.streamId);
    } catch (error) {
      // No offer, no stream: the denial settles the session terminally
      // (fail-closed — the W301 gate-before-anything posture).
      if (this.terminalState === null) {
        this.failTerminal(
          "rights-denied",
          "live delivery requires the canDeliverLive capability (fail-closed rights gate)",
        );
      }
      throw error;
    }
    return buildLiveOutputOffer({
      sessionId: this.sessionId,
      streamId: this.streamId,
      profile: this.profile,
      sessionControls: {
        backpressurePolicy: this.backpressure,
        linkCapacity: this.limits.linkCapacity,
        maxLinkBytes: this.limits.maxLinkBytes,
        maxWatermarkLagMs: this.limits.maxWatermarkLagMs,
        retransmitRetention: this.limits.retransmitRetention,
      },
      offeredAtMs: this.clock.now(),
    });
  }

  /**
   * Establishes the session on an accept answer, or fails terminally
   * (`negotiation-failed`) on a typed reject. Malformed answers fail
   * terminally with `protocol-violation`. Idempotent per state: a second
   * call is a typed protocol error.
   */
  acceptAnswer(answerDocument: unknown): void {
    if (this.terminalState !== null || this.closingMode !== null) {
      throw new LiveOutputProtocolError("cannot accept an answer on a closing/closed session", {
        streamId: this.streamId,
        failureClass: "protocol-violation",
      });
    }
    if (this.phase() !== "negotiating") {
      throw new LiveOutputProtocolError("acceptAnswer requires the negotiating phase", {
        streamId: this.streamId,
        failureClass: "protocol-violation",
        phase: this.phase(),
      });
    }
    const parsed = parseLiveOutputAnswer(answerDocument);
    if (!parsed.ok) {
      this.failTerminal("protocol-violation", `the viewer answer was malformed: ${parsed.reason}`);
      throw new LiveOutputProtocolError(parsed.reason, {
        streamId: this.streamId,
        failureClass: "protocol-violation",
      });
    }
    const answer = parsed.value;
    if (answer.kind === "reject") {
      this.failTerminal("negotiation-failed", `the viewer rejected the offer: ${answer.reason}`);
      throw new LiveOutputNegotiationError(
        `live output negotiation rejected: ${answer.reason}`,
        { streamId: this.streamId, failureClass: "negotiation-failed", reason: answer.reason },
      );
    }
    this.phaseMachine.transition("established", { viewerId: answer.viewerId });
    this.logger.info("live output session established", {
      streamId: this.streamId,
      viewerId: answer.viewerId,
      negotiationMs: answer.acceptedAtMs,
    });
    this.notifyViewer();
  }

  // -------------------------------------------------------------------------
  // The host-side send boundary
  // -------------------------------------------------------------------------

  /**
   * Sends one frame window (a W304-style emission). Every call resolves to
   * EXACTLY one typed receipt: `admitted` (in the link, ordinal assigned),
   * `skipped-stale` (degradation policy, counted — never delivered), or
   * `refused` (typed policy refusal). Malformed emissions, state misuse and
   * profile mismatches THROW typed errors (counted `windowsRejectedInvalid`,
   * never entering the ledger — fail-closed at the door).
   *
   * Sends are serialized (the W304 emission-tail pattern): under `block` a
   * full link parks the chain — natural backpressure, bounded memory, the
   * host's later calls queue behind in call order.
   */
  sendWindow(emission: LiveOutputEmission): Promise<LiveWindowSendReceipt> {
    const emittedAtMs = this.clock.now();
    const linkDepthAtEmission = this.channel.size;
    const windowId = frameWindowId(this.streamId, emission.provenance.sourceWatermark);
    const task = this.sendChain.then(() =>
      this.admitOne(emission, { emittedAtMs, linkDepthAtEmission, windowId }),
    );
    this.sendChain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  /** One serialized admission (runs exclusively on the send chain). */
  private admitOne(
    emission: LiveOutputEmission,
    context: { emittedAtMs: number; linkDepthAtEmission: number; windowId: string },
  ): Promise<LiveWindowSendReceipt> {
    const task = this.admitOneInner(emission, context);
    this.currentAdmitTask = task;
    return task.then(
      (receipt) => {
        this.clearAdmitTask(task);
        return receipt;
      },
      (error: unknown) => {
        this.clearAdmitTask(task);
        throw error;
      },
    );
  }

  /** Clears the current-admission marker (first-wins; later tasks reset it). */
  private clearAdmitTask(task: Promise<unknown>): void {
    if (this.currentAdmitTask === task) {
      this.currentAdmitTask = null;
    }
  }

  private async admitOneInner(
    emission: LiveOutputEmission,
    context: { emittedAtMs: number; linkDepthAtEmission: number; windowId: string },
  ): Promise<LiveWindowSendReceipt> {
    // --- state + rights + budget gates (typed outcomes, never silent) ---
    if (this.terminalState !== null || this.closingMode !== null || this.linkClosed) {
      this.recordReceipt("refused", context.windowId, null, context, undefined, emission.provenance.sourceWatermark);
      this.accounting.refusalsByClass["session-closed"] += 1;
      this.logger.warn("live output send refused: session closed", {
        streamId: this.streamId,
        windowId: context.windowId,
      });
      return this.refusedReceipt(context.windowId, "session-closed", undefined);
    }
    if (this.phase() !== "established" && this.phase() !== "degraded") {
      this.accounting.windowsRejectedInvalid += 1;
      throw new LiveOutputProtocolError(
        "sendWindow requires an established session (acceptAnswer first)",
        { streamId: this.streamId, failureClass: "protocol-violation", phase: this.phase() },
      );
    }
    const capabilities = deriveRightsCapabilities(
      this.rightsRevoked ? null : this.rightsPolicy,
      new Date(this.clock.now()),
    );
    if (!capabilities.canDeliverLive) {
      this.recordReceipt("refused", context.windowId, null, context, undefined, emission.provenance.sourceWatermark);
      this.accounting.refusalsByClass["rights"] += 1;
      this.logger.warn("live output send refused: rights lapsed", {
        streamId: this.streamId,
        windowId: context.windowId,
      });
      this.failTerminal("rights-lapsed", "live delivery rights lapsed mid-stream (fail-closed)");
      return this.refusedReceipt(context.windowId, "rights", undefined);
    }
    if (this.accounting.windowsIn >= this.limits.maxWindowsInSession) {
      this.recordReceipt("refused", context.windowId, null, context, undefined, emission.provenance.sourceWatermark);
      this.accounting.refusalsByClass["session-limit"] += 1;
      this.logger.warn("live output send refused: session window budget exhausted", {
        streamId: this.streamId,
        windowId: context.windowId,
        budget: this.limits.maxWindowsInSession,
      });
      return this.refusedReceipt(context.windowId, "session-limit", undefined);
    }

    // --- document validation (fail-closed at the door) ---
    const payloadCheck = validateLiveOutputPayload(emission.output);
    if (!payloadCheck.ok) {
      this.accounting.windowsRejectedInvalid += 1;
      this.logger.error("live output send rejected: malformed emission", {
        streamId: this.streamId,
        windowId: context.windowId,
        reason: payloadCheck.reason,
      });
      this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsIn, { outcome: "rejected-invalid" }).inc();
      throw new LiveOutputProtocolError(`malformed emission: ${payloadCheck.reason}`, {
        streamId: this.streamId,
        failureClass: "protocol-violation",
      });
    }
    if (!profilesEqual(emission.output.manifest.output.profile, this.profile)) {
      this.accounting.windowsRejectedInvalid += 1;
      this.logger.error("live output send rejected: profile mismatch", {
        streamId: this.streamId,
        windowId: context.windowId,
      });
      this.failTerminal(
        "negotiation-violation",
        "a frame window's profile does not match the negotiated track (renegotiation required)",
      );
      throw new LiveOutputProfileMismatchError(
        "frame window profile does not match the negotiated track",
        { streamId: this.streamId, failureClass: "negotiation-violation" },
      );
    }

    // --- observation + admission-time skip-stale (measured, dual check) ---
    this.observeHead(emission.provenance.sourceWatermark);
    const skipStale = this.staleDecisionOn(emission.provenance.sourceWatermark);
    if (skipStale.stale) {
      this.recordReceipt(
        "skipped-stale",
        context.windowId,
        null,
        context,
        skipStale.lagMs,
        emission.provenance.sourceWatermark,
      );
      this.enterDegradation("skip-stale");
      this.logger.warn("live output window skipped-stale at admission", {
        streamId: this.streamId,
        windowId: context.windowId,
        lagMs: skipStale.lagMs,
        maxWatermarkLagMs: this.limits.maxWatermarkLagMs,
        watermark: emission.provenance.sourceWatermark,
        head: skipStale.head,
      });
      this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsSkippedStale, { at: "admission" }).inc();
      return {
        kind: "skipped-stale",
        windowId: context.windowId,
        lagMs: skipStale.lagMs,
        head: { ...skipStale.head },
      };
    }

    // --- ordinal + document build (admitting windows only) ---
    const ordinal = this.nextOrdinal;
    this.nextOrdinal += 1;
    const envelope = buildLiveFrameWindow(emission, {
      streamId: this.streamId,
      ordinal,
      emittedAtMs: context.emittedAtMs,
    });
    const documentCheck = LiveFrameWindow.safeParse(envelope.window);
    if (!documentCheck.success) {
      this.accounting.windowsRejectedInvalid += 1;
      // The ordinal was tentatively consumed; roll it back (nothing was
      // admitted — the rejected document never joins the ledger).
      this.nextOrdinal = ordinal;
      throw new LiveOutputProtocolError(
        `built an invalid frame window document: ${documentCheck.error.message}`,
        { streamId: this.streamId, failureClass: "protocol-violation" },
      );
    }
    const window = envelope.window;

    // --- byte-budget pre-check (W104 verbatim: a message that can never
    //     fit is refused or dropped-with-accounting, never buffered) ---
    if (this.limits.maxLinkBytes !== null && window.byteSize > this.limits.maxLinkBytes) {
      if (this.backpressure === "drop-oldest") {
        this.recordReceipt("dropped", context.windowId, null, context, undefined, emission.provenance.sourceWatermark);
        this.accounting.windowsDroppedByPolicy += 1;
        this.enterDegradation("link-eviction");
        this.logger.warn("live output incoming window dropped: exceeds byte budget", {
          streamId: this.streamId,
          windowId: context.windowId,
          byteSize: window.byteSize,
          maxLinkBytes: this.limits.maxLinkBytes,
        });
        this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsDroppedByPolicy, { at: "incoming" }).inc();
        return { kind: "dropped", windowId: context.windowId, reason: "exceeds-byte-budget" };
      }
      this.recordReceipt("refused", context.windowId, null, context, undefined, emission.provenance.sourceWatermark);
      this.accounting.refusalsByClass["resource-limit"] += 1;
      this.logger.warn("live output send refused: window exceeds byte budget", {
        streamId: this.streamId,
        windowId: context.windowId,
        byteSize: window.byteSize,
        maxLinkBytes: this.limits.maxLinkBytes,
      });
      return this.refusedReceipt(context.windowId, "resource-limit", {
        policy: this.backpressure,
        capacity: this.limits.linkCapacity,
        size: this.channel.size,
        maxBytes: this.limits.maxLinkBytes,
        byteSize: this.channel.byteSize,
        attemptedBytes: window.byteSize,
      });
    }

    // --- the link send (block parks; reject throws typed) ---
    const message: LiveLinkMessage = {
      sessionId: this.sessionId,
      schemaVersion: SCHEMA_VERSION,
      sequence: ordinal,
      watermark: { ...window.watermark },
      payload: envelope,
      correlationId: this.correlation.correlationId,
      traceId: this.correlation.traceId,
    };
    try {
      await this.channel.send(message);
    } catch (error) {
      if (error instanceof ResourceLimitError) {
        this.recordReceipt("refused", context.windowId, null, context, undefined, emission.provenance.sourceWatermark);
        this.accounting.refusalsByClass["resource-limit"] += 1;
        this.logger.warn("live output send refused: link at capacity", {
          streamId: this.streamId,
          windowId: context.windowId,
          details: error.details,
        });
        this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsRefused).inc();
        return this.refusedReceipt(context.windowId, "resource-limit", {
          policy: error.details.policy,
          capacity: error.details.capacity,
          size: error.details.size,
          ...(error.details.maxBytes === undefined ? {} : { maxBytes: error.details.maxBytes }),
          byteSize: error.details.byteSize,
          attemptedBytes: error.details.attemptedBytes,
        });
      }
      if (error instanceof ChannelClosedError) {
        this.recordReceipt("abandoned", context.windowId, null, context, undefined, emission.provenance.sourceWatermark);
        this.logger.warn("live output parked send abandoned: closed under", {
          streamId: this.streamId,
          windowId: context.windowId,
        });
        this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsAbandoned, { reason: "closed-under" }).inc();
        return { kind: "abandoned", windowId: context.windowId, reason: "closed-under" };
      }
      throw error;
    }

    // --- admitted: ledger + timing + stats + wakeup ---
    this.linkLedger.push(ordinal);
    this.reconcileEvictions();
    const receipt = this.recordReceipt(
      "admitted",
      context.windowId,
      ordinal,
      context,
      undefined,
      emission.provenance.sourceWatermark,
    );
    this.ordinals.set(ordinal, {
      ordinal,
      windowId: window.windowId,
      watermark: { ...window.watermark },
      frameCount: window.frameCount,
      byteSize: window.byteSize,
      timingKey: receipt.key,
      disposition: "in-flight",
    });
    receipt.record.admittedAtMs = this.clock.now();
    receipt.record.ordinal = ordinal;
    this.accounting.windowsInFlight += 1;
    const depth = this.channel.size;
    this.accounting.maxLinkDepth = Math.max(this.accounting.maxLinkDepth, depth);
    this.logger.info("live output window admitted", {
      streamId: this.streamId,
      windowId: window.windowId,
      ordinal,
      watermark: window.watermark,
      frameCount: window.frameCount,
      byteSize: window.byteSize,
      linkDepth: depth,
    });
    this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsIn, { outcome: "admitted" }).inc();
    this.notifyViewer();
    return {
      kind: "admitted",
      ordinal,
      windowId: window.windowId,
      admittedAtMs: this.clock.now(),
    };
  }

  // -------------------------------------------------------------------------
  // Settlement
  // -------------------------------------------------------------------------

  /**
   * Closes the session (idempotent; the first call's outcome wins).
   *
   * - `drain`: the link closes to new sends; the viewer keeps draining the
   *   queued windows; the settle completes when everything staged/streamed
   *   is resolved. REQUIRES a receiving consumer (the W302 documented
   *   posture): a disconnected viewer that never reconnects parks the
   *   drain — call `cancel` instead.
   * - `cancel`: everything in the link and everything staged is ABANDONED
   *   (counted, ledgered, logged, metered) and the session settles
   *   immediately.
   *
   * The balance is runtime-asserted BEFORE the result is minted: an
   * imbalance REJECTS the returned promise — never a lying result.
   */
  async close(
    options: { mode?: "drain" | "cancel"; reason?: "stream-complete" | "host-stop" } = {},
  ): Promise<LiveSessionResult> {
    if (this.terminalState !== null) {
      return this.mintResult();
    }
    if (this.closingMode !== null) {
      return await new Promise<LiveSessionResult>((resolve) => {
        this.settleWaiters.push(resolve);
      });
    }
    const mode = options.mode ?? "drain";
    this.drainOutcome = options.reason === "stream-complete" ? "completed" : "stopped";
    this.closingMode = mode;
    this.linkClosed = true;
    this.channel.close();
    if (mode === "cancel") {
      this.discardRemaining("cancelled at host stop");
    } else if (this.isLinkDrained()) {
      this.settleTerminal(this.drainOutcome);
    }
    this.notifyViewer();
    // Wait for every send already on the chain to resolve before the final
    // settle decision: a send parked under `block` was rejected by the
    // channel close and resolves as an ACCOUNTED abandoned receipt — the
    // settle must include it (never a receipt after the result is minted).
    await this.sendChain;
    this.settleIfDrained();
    if (this.terminalState !== null) {
      return this.mintResult();
    }
    return await new Promise<LiveSessionResult>((resolve) => {
      this.settleWaiters.push(resolve);
    });
  }

  /**
   * Settles an orderly close when everything is resolved (the pull path and
   * `close()` both check; a `drain` settles only when the viewer drained the
   * whole link, a `cancel` when every queued send landed its receipt).
   */
  private settleIfDrained(): void {
    if (this.terminalState !== null || this.closingMode === null) return;
    if (!this.isLinkDrained()) return;
    this.settleTerminal(this.drainOutcome);
  }

  /** The live stats snapshot (a deep copy — mutation-safe for asserts). */
  stats(): LiveOutputStats {
    return structuredStatsCopy(this.accounting);
  }

  /** The per-window timing records (the W306 transport-side seam). */
  telemetry(): LiveWindowTimingRecord[] {
    return [...this.timingRecords.values()].map((record) => ({ ...record }));
  }

  /** Link depth right now (queued frame windows). */
  linkDepth(): number {
    return this.channel.size;
  }

  /**
   * Messages the link's own drop-oldest policy has dropped (the W104
   * counter, exposed for the cross-boundary identity
   * `windowsLinkEvicted === linkDropped()`).
   */
  linkDropped(): number {
    return this.channel.dropped;
  }

  /** The host/test seam for reporting underlying-transport death. */
  reportTransportFailure(message: string): void {
    this.failTerminal("transport-failed", message);
  }

  /**
   * The host/test seam for an explicit rights revocation (the operator
   * revoked the policy): terminates the session LOUD with `rights-lapsed`
   * — every in-link window is abandoned, accounted, never silently lost.
   */
  revokeDeliveryRights(reason: string): void {
    this.rightsRevoked = true;
    this.failTerminal("rights-lapsed", `live delivery rights revoked: ${reason}`);
  }

  // -------------------------------------------------------------------------
  // Viewer-side wiring (in-process; a real implementation satisfies the
  // same binding behind a network)
  // -------------------------------------------------------------------------

  /** The viewer-side endpoint for this transport (one per transport). */
  viewerEndpoint(options: { viewerId?: string } = {}): LiveOutputEndpoint {
    if (this.endpoint === null) {
      const binding = this.createBinding();
      this.endpoint = createEndpoint(
        {
          streamId: this.streamId,
          sessionId: this.sessionId,
          attachViewer: () => this.attachViewer(),
        },
        binding,
        options.viewerId ?? "viewer-1",
      );
    }
    return this.endpoint;
  }

  /** The internal binding surface (transport -> viewer session). */
  private createBinding(): LiveViewerTransportBinding {
    return {
      pullNext: () => this.pullNext(),
      reconnect: (resumeFromOrdinal) => this.reconnectViewer(resumeFromOrdinal),
      disconnect: () => this.disconnectViewer(),
      reportIntegrityConflict: (window) => {
        this.failTerminal(
          "integrity-violation",
          `window ${window.windowId} re-delivered with different content under a stable id`,
        );
      },
      linkDepth: () => this.channel.size,
      latestObservedWatermark: () => (this.latestHead === null ? null : { ...this.latestHead }),
      phase: () => this.phase(),
      degradationReasons: () => [...this.degradationReasons],
      terminal: () =>
        this.terminalState === null
          ? null
          : { outcome: this.terminalState.outcome, ...(this.terminalState.failureClass === undefined ? {} : { failureClass: this.terminalState.failureClass }) },
      liveStats: () => this.accounting,
      clock: () => this.clock,
    };
  }

  // -------------------------------------------------------------------------
  // The pull path (viewer-driven delivery; one item per wakeup)
  // -------------------------------------------------------------------------

  private async pullNext(): Promise<LiveDeliveryEvent> {
    for (;;) {
      if (this.terminalState !== null) {
        return this.sessionClosedEvent();
      }
      if (this.viewerDisconnected) {
        return { kind: "connection-lost" };
      }
      if (this.pendingEmissions.length > 0) {
        const item = this.pendingEmissions.shift()!;
        if (item.kind === "window") {
          this.finalizeDelivery(item);
        }
        return item;
      }
      const message = this.channel.tryReceive();
      if (message !== undefined) {
        this.viewerHolding += 1;
        try {
          await this.processLinkHead(message);
        } finally {
          this.viewerHolding -= 1;
        }
        continue;
      }
      if (this.linkClosed && this.isLinkDrained()) {
        if (this.closingMode === "drain") {
          this.settleTerminal(this.drainOutcome);
        }
        return this.sessionClosedEvent();
      }
      await this.awaitViewerSignal();
    }
  }

  /**
   * Stages the stream events for one received link message. Coordinates
   * with a concurrently-completing admission: the channel's internal state
   * change and the admission's ledger bookkeeping are one microtask apart,
   * so when the ledger has not booked THIS message (or an eviction below
   * it) yet, the method awaits the running admission task ONCE and retries
   * — never trusts interleaving, never guesses. A mismatch that survives
   * the coordination is a real invariant violation and throws loud.
   */
  private async processLinkHead(message: LiveLinkMessage): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const headOrdinal = this.linkLedger[0];
      const unattributed = this.firstUnattributedGapBelow(message.sequence);
      if (headOrdinal === message.sequence && unattributed === null) {
        this.linkLedger.shift();
        break;
      }
      if (attempt === 0 && this.currentAdmitTask !== null) {
        // The admission that made this message visible is still booking —
        // await its completion (a visible message means its send resolved,
        // so the task is guaranteed to settle; no deadlock is possible).
        await this.currentAdmitTask;
        continue;
      }
      if (headOrdinal !== message.sequence) {
        throw new LiveOutputProtocolError(
          `link ledger invariant violated: expected ordinal ${String(headOrdinal)}, ` +
            `received ${message.sequence}`,
          { streamId: this.streamId, failureClass: "protocol-violation" },
        );
      }
      throw new LiveOutputProtocolError(
        `unaccounted ordinal ${unattributed} below the link head — silent loss is impossible by construction`,
        { streamId: this.streamId, failureClass: "protocol-violation", ordinal: unattributed },
      );
    }
    const envelope = message.payload;
    const window = envelope.window;

    // Accounted skips for evicted ordinals below this head (in order).
    for (let ordinal = this.lastStreamedOrdinal + 1; ordinal < window.ordinal; ordinal += 1) {
      const entry = this.ordinals.get(ordinal);
      if (entry === undefined || entry.disposition !== "dropped-by-policy") {
        throw new LiveOutputProtocolError(
          `unaccounted ordinal ${ordinal} below the link head — silent loss is impossible by construction`,
          { streamId: this.streamId, failureClass: "protocol-violation", ordinal },
        );
      }
      this.lastStreamedOrdinal = ordinal;
      this.pendingEmissions.push({
        kind: "window-skipped",
        ordinal,
        windowId: entry.windowId,
        watermark: { ...entry.watermark },
        reason: "link-evicted",
      });
    }

    // Skip-stale at dequeue (measured; original watermark preserved).
    const decision = this.staleDecisionOn(window.watermark);
    if (decision.stale) {
      this.lastStreamedOrdinal = window.ordinal;
      this.terminateAdmitted(window.ordinal, "skipped-stale");
      this.accounting.windowsSkippedStaleAtDequeue += 1;
      this.accounting.windowsSkippedStale += 1;
      this.enterDegradation("skip-stale");
      const staleTiming = this.timingRecordFor(window.ordinal);
      if (staleTiming !== undefined) {
        staleTiming.disposition = "skipped-stale";
      }
      this.logger.warn("live output window skipped-stale at dequeue", {
        streamId: this.streamId,
        windowId: window.windowId,
        ordinal: window.ordinal,
        lagMs: decision.lagMs,
        maxWatermarkLagMs: this.limits.maxWatermarkLagMs,
        watermark: window.watermark,
        head: decision.head,
      });
      this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsSkippedStale, { at: "dequeue" }).inc();
      this.pendingEmissions.push({
        kind: "window-skipped",
        ordinal: window.ordinal,
        windowId: window.windowId,
        watermark: { ...window.watermark },
        reason: "skipped-stale",
        lagMs: decision.lagMs,
      });
      return;
    }

    // Integrity verification at the delivery boundary (fail-loud).
    const integrity = verifyFrameWindowIntegrity(envelope);
    if (!integrity.ok) {
      this.terminateAdmitted(window.ordinal, "failed");
      this.accounting.windowsFailed += 1;
      const failedTiming = this.timingRecordFor(window.ordinal);
      if (failedTiming !== undefined) {
        failedTiming.disposition = "failed";
      }
      this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsFailed).inc();
      this.failTerminal(
        "integrity-violation",
        `frame window ${window.windowId} failed integrity verification: ${integrity.reason}`,
      );
      throw new LiveOutputIntegrityError(
        `frame window ${window.windowId} failed integrity verification: ${integrity.reason}`,
        {
          streamId: this.streamId,
          failureClass: "integrity-violation",
          windowId: window.windowId,
          ordinal: window.ordinal,
          ...(integrity.frameIndex === undefined ? {} : { frameIndex: integrity.frameIndex }),
        },
      );
    }

    // Stage the verified window (delivered at RETURN — see finalizeDelivery).
    this.lastStreamedOrdinal = window.ordinal;
    const stagedTiming = this.timingRecordFor(window.ordinal);
    this.pendingEmissions.push({
      kind: "window",
      window,
      payload: envelope.payload,
      redelivered: false,
      timing: {
        emittedAtMs: stagedTiming?.emittedAtMs ?? window.emittedAtMs,
        admittedAtMs: stagedTiming?.admittedAtMs ?? window.emittedAtMs,
        deliveredAtMs: stagedTiming?.deliveredAtMs ?? window.emittedAtMs,
        transitLagMs: 0,
        deliveryLagMs: 0,
        linkDepthAtEmission: stagedTiming?.linkDepthAtEmission ?? 0,
        watermarkLagAtDeliveryMs: 0,
      },
    });
  }

  /** The timing record of one admitted ordinal (lookup via the receipt key). */
  private timingRecordFor(ordinal: number): LiveWindowTimingRecord | undefined {
    const entry = this.ordinals.get(ordinal);
    if (entry === undefined) return undefined;
    return this.timingRecords.get(entry.timingKey);
  }

  /**
   * The first ordinal below `headOrdinal` that is streamed neither as a
   * window nor as an attributed eviction (`null` when every gap ordinal is
   * attributed). The pre-check `processLinkHead` uses to distinguish "the
   * admission is still booking" (retry) from a real invariant violation.
   */
  private firstUnattributedGapBelow(headOrdinal: number): number | null {
    for (let ordinal = this.lastStreamedOrdinal + 1; ordinal < headOrdinal; ordinal += 1) {
      const entry = this.ordinals.get(ordinal);
      if (entry === undefined || entry.disposition !== "dropped-by-policy") {
        return ordinal;
      }
    }
    return null;
  }

  /** Marks one staged window item DELIVERED (called at return time). */
  private finalizeDelivery(item: LiveDeliveryEvent & { kind: "window" }): void {
    const window = item.window;
    const timing = this.timingRecordFor(window.ordinal);
    const nowMs = this.clock.now();
    if (item.redelivered) {
      this.accounting.windowsRedelivered += 1;
      if (timing !== undefined) {
        timing.redeliveredAtMs = nowMs;
      }
      item.timing.deliveredAtMs = nowMs;
      item.timing.admittedAtMs = timing?.admittedAtMs ?? item.timing.admittedAtMs;
      item.timing.emittedAtMs = window.emittedAtMs;
      item.timing.transitLagMs = nowMs - item.timing.admittedAtMs;
      item.timing.deliveryLagMs = nowMs - window.emittedAtMs;
      item.timing.watermarkLagAtDeliveryMs = this.watermarkLagOf(window.watermark);
      this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsRedelivered).inc();
      this.logger.info("live output window re-delivered", {
        streamId: this.streamId,
        windowId: window.windowId,
        ordinal: window.ordinal,
      });
      return;
    }
    this.accounting.windowsDelivered += 1;
    this.accounting.windowsInFlight -= 1;
    this.lastDeliveredOrdinal = window.ordinal;
    const entry = this.ordinals.get(window.ordinal);
    if (entry !== undefined) {
      entry.disposition = "delivered";
    }
    this.accounting.framesDelivered += window.frameCount;
    this.accounting.bytesDelivered += window.byteSize;
    if (timing !== undefined) {
      timing.deliveredAtMs = nowMs;
      timing.transitLagMs = nowMs - (timing.admittedAtMs ?? timing.emittedAtMs);
      timing.deliveryLagMs = nowMs - timing.emittedAtMs;
      timing.watermarkLagAtDeliveryMs = this.watermarkLagOf(window.watermark);
      timing.disposition = "delivered";
    }
    const transitLag = nowMs - item.timing.admittedAtMs;
    const deliveryLag = nowMs - window.emittedAtMs;
    const watermarkLag = this.watermarkLagOf(window.watermark);
    item.timing.deliveredAtMs = nowMs;
    item.timing.transitLagMs = transitLag;
    item.timing.deliveryLagMs = deliveryLag;
    item.timing.linkDepthAtEmission = timing?.linkDepthAtEmission ?? 0;
    item.timing.watermarkLagAtDeliveryMs = watermarkLag;
    this.accounting.maxTransitLagMs = Math.max(this.accounting.maxTransitLagMs, transitLag);
    this.accounting.maxDeliveryLagMs = Math.max(this.accounting.maxDeliveryLagMs, deliveryLag);
    this.accounting.maxWatermarkLagAtDeliveryMs = Math.max(
      this.accounting.maxWatermarkLagAtDeliveryMs,
      watermarkLag,
    );
    this.metrics?.histogram(LIVE_OUTPUT_METRIC_NAMES.transitLagMs).observe(transitLag);
    this.metrics?.histogram(LIVE_OUTPUT_METRIC_NAMES.deliveryLagMs).observe(deliveryLag);
    this.metrics?.histogram(LIVE_OUTPUT_METRIC_NAMES.watermarkLagAtDeliveryMs).observe(watermarkLag);
    this.metrics?.histogram(LIVE_OUTPUT_METRIC_NAMES.linkDepth).observe(this.channel.size);
    this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsDelivered).inc();
    this.logger.info("live output window delivered", {
      streamId: this.streamId,
      windowId: window.windowId,
      ordinal: window.ordinal,
      transitLagMs: transitLag,
      deliveryLagMs: deliveryLag,
      watermarkLagAtDeliveryMs: watermarkLag,
      linkDepth: this.channel.size,
    });
    this.pushRetention({ window, payload: item.payload });
    this.recoverIfCaughtUp(watermarkLag);
  }

  /** Retention push with the bounded-ring eviction accounting. */
  private pushRetention(envelope: LiveFrameWindowEnvelope): void {
    this.retention.push(envelope);
    while (this.retention.length > this.limits.retransmitRetention) {
      const evicted = this.retention.shift();
      this.accounting.retentionEvictions += 1;
      this.logger.info("live output retention evicted oldest delivered window", {
        streamId: this.streamId,
        windowId: evicted?.window.windowId,
        retention: this.retention.length,
        bound: this.limits.retransmitRetention,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Viewer connection lifecycle
  // -------------------------------------------------------------------------

  private disconnectViewer(): void {
    if (this.viewerDisconnected) return;
    this.viewerDisconnected = true;
    this.accounting.viewerDisconnects += 1;
    this.logger.info("live output viewer disconnected", { streamId: this.streamId });
    this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.viewerReconnects, { event: "disconnect" }).inc();
    this.notifyViewer();
  }

  /**
   * Reconnects the viewer from a resume ordinal. Re-delivers retained
   * windows >= the resume point (idempotency keys make re-application a
   * counted duplicate at the viewer); a resume point older than retention
   * surfaces a counted `reconnect-gap` — never a silent skip. A resume
   * point AHEAD of delivery is a typed protocol violation.
   */
  private reconnectViewer(resumeFromOrdinal: number): LiveReconnectReport {
    if (!Number.isInteger(resumeFromOrdinal) || resumeFromOrdinal < 0) {
      throw new LiveOutputProtocolError(
        `reconnect resume ordinal must be a non-negative integer (got ${String(resumeFromOrdinal)})`,
        { streamId: this.streamId, failureClass: "protocol-violation" },
      );
    }
    if (this.terminalState !== null) {
      throw new LiveOutputProtocolError(
        `cannot reconnect a closed session (${this.terminalState.outcome})`,
        { streamId: this.streamId, failureClass: "protocol-violation" },
      );
    }
    if (resumeFromOrdinal > this.lastDeliveredOrdinal + 1) {
      throw new LiveOutputProtocolError(
        `reconnect resume ordinal ${resumeFromOrdinal} is ahead of delivery ` +
          `(last delivered ${this.lastDeliveredOrdinal})`,
        { streamId: this.streamId, failureClass: "protocol-violation" },
      );
    }
    this.viewerDisconnected = false;
    this.accounting.viewerConnections += 1;
    const replay: LiveFrameWindowEnvelope[] = this.retention.filter(
      (envelope) => envelope.window.ordinal >= resumeFromOrdinal,
    );
    let gapSkipped = 0;
    const retentionHead = this.retention.length > 0 ? this.retention[0]!.window.ordinal : this.lastDeliveredOrdinal + 1;
    let gapEvent: LiveDeliveryEvent | null = null;
    if (resumeFromOrdinal < retentionHead) {
      gapSkipped = retentionHead - resumeFromOrdinal;
      this.accounting.windowsSkippedAtReconnect += gapSkipped;
      this.enterDegradation("reconnect-gap");
      this.logger.warn("live output reconnect gap: resume point older than retention", {
        streamId: this.streamId,
        resumeFromOrdinal,
        earliestRetained: retentionHead,
        skippedCount: gapSkipped,
      });
      this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsSkippedAtReconnect).inc();
      // The gap announcement comes FIRST (the viewer learns what it lost
      // before it sees any replay).
      gapEvent = {
        kind: "reconnect-gap",
        fromOrdinal: resumeFromOrdinal,
        toOrdinal: retentionHead,
        skippedCount: gapSkipped,
      };
    }
    const replayItems: LiveDeliveryEvent[] = replay.map((envelope) => ({
      kind: "window",
      window: envelope.window,
      payload: envelope.payload,
      redelivered: true,
      timing: {
        emittedAtMs: envelope.window.emittedAtMs,
        admittedAtMs: envelope.window.emittedAtMs,
        deliveredAtMs: envelope.window.emittedAtMs,
        transitLagMs: 0,
        deliveryLagMs: 0,
        linkDepthAtEmission: 0,
        watermarkLagAtDeliveryMs: 0,
      },
    }));
    this.pendingEmissions = [
      ...(gapEvent === null ? [] : [gapEvent]),
      ...replayItems,
      ...this.pendingEmissions,
    ];
    this.logger.info("live output viewer reconnected", {
      streamId: this.streamId,
      resumeFromOrdinal,
      replayCount: replay.length,
      gapSkipped,
    });
    this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.viewerReconnects, { event: "reconnect" }).inc();
    this.notifyViewer();
    return { resumeFromOrdinal, replayCount: replay.length, gapSkipped };
  }

  // -------------------------------------------------------------------------
  // Internal accounting helpers
  // -------------------------------------------------------------------------

  /** Records one send receipt (stats + timing record mint). */
  private recordReceipt(
    kind: "admitted" | "skipped-stale" | "refused" | "dropped" | "abandoned",
    windowId: string,
    ordinal: number | null,
    context: { emittedAtMs: number; linkDepthAtEmission: number },
    lagMs: number | undefined,
    watermark: Watermark,
  ): { key: number; record: LiveWindowTimingRecord } {
    this.accounting.windowsIn += 1;
    switch (kind) {
      case "admitted":
        this.accounting.receiptsAdmitted += 1;
        break;
      case "skipped-stale":
        this.accounting.receiptsSkippedStale += 1;
        this.accounting.windowsSkippedStale += 1;
        break;
      case "refused":
        this.accounting.receiptsRefused += 1;
        break;
      case "dropped":
        this.accounting.receiptsDropped += 1;
        break;
      case "abandoned":
        this.accounting.receiptsAbandoned += 1;
        this.accounting.windowsAbandoned += 1;
        break;
    }
    const record: LiveWindowTimingRecord = {
      windowId,
      ordinal,
      // The send's OWN watermark, VERBATIM (never invented — the receipt
      // always knows the emission's source watermark).
      watermark: { ...watermark },
      emittedAtMs: context.emittedAtMs,
      admittedAtMs: null,
      deliveredAtMs: null,
      redeliveredAtMs: null,
      linkDepthAtEmission: context.linkDepthAtEmission,
      transitLagMs: null,
      deliveryLagMs: null,
      watermarkLagAtDeliveryMs: null,
      disposition:
        kind === "admitted"
          ? "in-flight"
          : kind === "skipped-stale"
            ? "skipped-stale"
            : kind === "dropped"
              ? "dropped-by-policy"
              : kind === "abandoned"
                ? "abandoned"
                : "refused",
    };
    if (lagMs !== undefined) {
      record.watermarkLagAtDeliveryMs = lagMs;
    }
    // One timing record per RECEIPT (a re-sent watermark is its own send —
    // its record must never overwrite a prior receipt's lifecycle).
    const key = this.nextReceiptKey;
    this.nextReceiptKey += 1;
    this.timingRecords.set(key, record);
    return { key, record };
  }

  /** Refused-receipt helper (class already counted by the caller). */
  private refusedReceipt(
    windowId: string,
    refusalClass: "resource-limit" | "rights" | "session-limit" | "session-closed",
    details: LiveSendRefusalDetails | undefined,
  ): LiveWindowSendReceipt {
    return {
      kind: "refused",
      windowId,
      refusalClass,
      ...(details === undefined
        ? { details: { policy: this.backpressure, capacity: this.limits.linkCapacity, size: this.channel.size, byteSize: this.channel.byteSize } }
        : { details }),
    };
  }

  /** Updates the timing record after admission (callers adjust dispositions). */
  private observeHead(watermark: Watermark): void {
    if (this.latestHead === null || watermark.watermarkMs > this.latestHead.watermarkMs) {
      this.latestHead = { ...watermark };
    }
  }

  /** The measured stale-skip decision for one watermark (pure measurement). */
  private staleDecisionOn(watermark: Watermark): { stale: boolean; lagMs: number; head: Watermark } {
    const head = this.latestHead ?? watermark;
    const lagMs = head.watermarkMs - watermark.watermarkMs;
    const stale = this.limits.maxWatermarkLagMs !== null && lagMs > this.limits.maxWatermarkLagMs;
    return { stale, lagMs, head };
  }

  /** Media-time lag of a watermark against the newest observed head. */
  private watermarkLagOf(watermark: Watermark): number {
    return (this.latestHead?.watermarkMs ?? watermark.watermarkMs) - watermark.watermarkMs;
  }

  /**
   * Reconciles the link ledger against the channel's own drop counter: any
   * ledger entries beyond the channel's queue were evicted by the
   * drop-oldest policy — attributed to the SPECIFIC oldest windows, counted
   * + logged + metered (the W304 cross-boundary attribution pattern).
   */
  private reconcileEvictions(): void {
    while (this.linkLedger.length > this.channel.size + this.viewerHolding) {
      const ordinal = this.linkLedger.shift();
      if (ordinal === undefined) break;
      const entry = this.ordinals.get(ordinal);
      if (entry === undefined) {
        throw new LiveOutputProtocolError(
          `eviction attribution failed: ordinal ${ordinal} has no ledger entry`,
          { streamId: this.streamId, failureClass: "protocol-violation", ordinal },
        );
      }
      this.terminateAdmitted(ordinal, "dropped-by-policy");
      this.accounting.windowsLinkEvicted += 1;
      this.accounting.windowsDroppedByPolicy += 1;
      this.enterDegradation("link-eviction");
      this.logger.warn("live output window evicted from link (drop-oldest)", {
        streamId: this.streamId,
        windowId: entry.windowId,
        ordinal,
        watermark: entry.watermark,
        channelDropped: this.channel.dropped,
      });
      this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsDroppedByPolicy, { at: "eviction" }).inc();
    }
  }

  /** Moves one admitted window to a terminal lost disposition. */
  private terminateAdmitted(
    ordinal: number,
    disposition: "skipped-stale" | "dropped-by-policy" | "abandoned" | "failed",
  ): void {
    const entry = this.ordinals.get(ordinal);
    if (entry === undefined) return;
    entry.disposition = disposition;
    this.accounting.windowsInFlight -= 1;
    this.accounting.framesDropped += entry.frameCount;
    this.accounting.bytesDropped += entry.byteSize;
    if (disposition === "abandoned") {
      this.accounting.windowsAbandonedFromLink += 1;
      this.accounting.windowsAbandoned += 1;
    }
    if (disposition === "skipped-stale") {
      // windowsSkippedStaleAtDequeue is incremented by the caller (dequeue
      // path only); admission skips never reach here.
    }
  }

  /** Enters the degraded phase (idempotent while degraded). */
  private enterDegradation(reason: "skip-stale" | "link-eviction" | "reconnect-gap"): void {
    if (!this.degradationReasons.includes(reason)) {
      this.degradationReasons.push(reason);
    }
    if (this.phase() === "established") {
      this.phaseMachine.transition("degraded", { reason });
    }
  }

  /** Recovers to established when a fresh delivery is within the lag bound. */
  private recoverIfCaughtUp(watermarkLagMs: number): void {
    if (this.phase() !== "degraded") return;
    const caughtUp =
      this.limits.maxWatermarkLagMs === null ? true : watermarkLagMs <= this.limits.maxWatermarkLagMs;
    if (caughtUp) {
      this.degradationReasons = [];
      this.phaseMachine.transition("established", { recovery: true });
    }
  }

  /** `true` when the link is drained (queue + staged events all resolved). */
  private isLinkDrained(): boolean {
    return this.channel.size === 0 && this.pendingEmissions.length === 0 && this.linkLedger.length === 0;
  }

  /** Cancels everything unresolved: link residents + staged windows. */
  private discardRemaining(reason: string): void {
    let drained = 0;
    for (;;) {
      const message = this.channel.tryReceive();
      if (message === undefined) break;
      this.linkLedger.shift();
      drained += 1;
      this.terminateAdmitted(message.sequence, "abandoned");
      const timing = this.timingRecordFor(message.sequence);
      if (timing !== undefined) {
        timing.disposition = "abandoned";
      }
    }
    const stagedWindows = this.pendingEmissions.filter((item) => item.kind === "window");
    for (const item of stagedWindows) {
      if (item.kind !== "window") continue;
      this.terminateAdmitted(item.window.ordinal, "abandoned");
      const timing = this.timingRecordFor(item.window.ordinal);
      if (timing !== undefined) {
        timing.disposition = "abandoned";
      }
    }
    if (this.pendingEmissions.length > 0) {
      this.accounting.replaysDiscardedAtClose += this.pendingEmissions.length;
      this.logger.info("live output staged events discarded at cancel", {
        streamId: this.streamId,
        reason,
        discarded: this.pendingEmissions.length,
        windows: stagedWindows.length,
      });
    }
    this.pendingEmissions = [];
    if (drained > 0) {
      this.logger.warn("live output link windows abandoned at cancel", {
        streamId: this.streamId,
        reason,
        abandoned: drained,
      });
      this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.windowsAbandoned, { reason: "cancel" }).inc(drained);
    }
    this.reconcileEvictions();
  }

  /** Terminal failure: settles the session failed, loudly. */
  private failTerminal(failureClass: LiveOutputFailureClass, message: string): void {
    if (this.terminalState !== null || this.phaseMachine.isClosed) return;
    this.closingMode = "cancel";
    this.linkClosed = true;
    this.channel.close();
    this.discardRemaining(`terminal failure: ${failureClass}`);
    this.phaseMachine.closeTerminal(failureClass);
    this.terminalState = { outcome: "failed", failureClass, failureMessage: message };
    this.logger.error("live output session failed", {
      streamId: this.streamId,
      failureClass,
      message,
    });
    this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.sessionEnds, { outcome: "failed" }).inc();
    this.notifyViewer();
    this.resolveSettlers();
  }

  /** Orderly settle (drain complete or cancel). */
  private settleTerminal(outcome: "completed" | "stopped"): void {
    if (this.terminalState !== null || this.phaseMachine.isClosed) return;
    this.phaseMachine.closeTerminal();
    this.terminalState = { outcome };
    this.logger.info("live output session closed", {
      streamId: this.streamId,
      outcome,
      stats: {
        windowsIn: this.accounting.windowsIn,
        windowsDelivered: this.accounting.windowsDelivered,
        windowsSkippedStale: this.accounting.windowsSkippedStale,
        windowsDroppedByPolicy: this.accounting.windowsDroppedByPolicy,
      },
    });
    this.metrics?.counter(LIVE_OUTPUT_METRIC_NAMES.sessionEnds, { outcome }).inc();
    this.notifyViewer();
    this.resolveSettlers();
  }

  /** Resolves pending close() calls (minting asserts the balance first). */
  private resolveSettlers(): void {
    const waiters = [...this.settleWaiters];
    this.settleWaiters.length = 0;
    for (const waiter of waiters) {
      waiter(this.mintResult());
    }
  }

  /** Mints the settled result (asserts the balance — throws on imbalance). */
  private mintResult(): LiveSessionResult {
    assertLiveOutputAccounting(this.accounting);
    return {
      streamId: this.streamId,
      sessionId: this.sessionId,
      phase: "closed",
      outcome: this.terminalState?.outcome ?? "stopped",
      ...(this.terminalState?.failureClass === undefined
        ? {}
        : { failureClass: this.terminalState.failureClass }),
      ...(this.terminalState?.failureMessage === undefined
        ? {}
        : { failureMessage: this.terminalState.failureMessage }),
      stats: structuredStatsCopy(this.accounting),
      telemetry: this.telemetry(),
      balanced: true,
    };
  }

  /** Builds the terminal stream event from the terminal state. */
  private sessionClosedEvent(): LiveDeliveryEvent {
    return {
      kind: "session-closed",
      outcome: this.terminalState?.outcome ?? "stopped",
      ...(this.terminalState?.failureClass === undefined
        ? {}
        : { failureClass: this.terminalState.failureClass }),
    };
  }

  // -------------------------------------------------------------------------
  // Signal plumbing (deterministic microtask wakeups — no timers)
  // -------------------------------------------------------------------------

  private notifyViewer(): void {
    if (this.viewerSignalResolve !== null) {
      const resolve = this.viewerSignalResolve;
      this.viewerSignalResolve = null;
      this.viewerSignal = null;
      resolve();
    }
  }

  private awaitViewerSignal(): Promise<void> {
    if (this.viewerSignal === null) {
      this.viewerSignal = new Promise<void>((resolve) => {
        this.viewerSignalResolve = resolve;
      });
    }
    return this.viewerSignal;
  }

  // -------------------------------------------------------------------------
  // Viewer attach (called by the endpoint)
  // -------------------------------------------------------------------------

  /** Attaches the viewer connection (endpoint-accept path). */
  attachViewer(): void {
    this.viewerDisconnected = false;
    this.accounting.viewerConnections += 1;
    this.logger.info("live output viewer attached", { streamId: this.streamId });
    this.notifyViewer();
  }
}

/** Deep structural copy of the stats (mutation-safe snapshots for tests). */
function structuredStatsCopy(stats: LiveOutputStats): LiveOutputStats {
  return {
    ...stats,
    refusalsByClass: { ...stats.refusalsByClass },
    stateTransitions: { ...stats.stateTransitions },
  };
}

/** Value equality for output profiles (the negotiated-track check). */
function profilesEqual(a: OutputProfile, b: OutputProfile): boolean {
  return (
    a.codec === b.codec &&
    a.container === b.container &&
    a.frameRate === b.frameRate &&
    a.latencyClass === b.latencyClass &&
    a.resolution.w === b.resolution.w &&
    a.resolution.h === b.resolution.h
  );
}

// The endpoint/session factories live in ./viewer; that module imports THIS
// one with `import type` only, so the runtime dependency is one-directional
// (no load cycle) while both modules share the binding types.
export type { LiveOutputEndpoint, LiveViewerSession } from "./viewer";
