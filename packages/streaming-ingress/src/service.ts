/**
 * `StreamingIngestService` (W301) — the streaming ingest boundary: a live
 * source in, W102-normalized segments out, every segment accounted.
 *
 * Pipeline per the work-item spec, strictly in this order:
 *
 * 1. **Admission, fail closed** (architecture-lock §11, the W101 posture):
 *    `start()` asserts `analysis` authorization BEFORE the source is even
 *    opened — an unauthorized stream is rejected at admission and learns
 *    nothing about the feed. A missing/expired/insufficient policy DENIES.
 *    The gate is re-asserted per segment (the W102 defense-in-depth posture):
 *    a policy that becomes invalid mid-stream terminates the session LOUDLY
 *    with the `rights-denied` class — never a silent mid-stream drop.
 * 2. **Per-segment validation** (architecture-lock §13, live input is
 *    UNTRUSTED): each delivery must satisfy the W102 normalized-representation
 *    invariants (rgb24 byte math, audio sample math, non-negative upstream
 *    timestamps). A violation is a classified `media-invalid` refusal:
 *    counted, logged, recorded in the rejection ledger — the stream
 *    CONTINUES (one corrupt segment never kills a live match); nothing is
 *    silently skipped.
 * 3. **Idempotent receipts** (the W101 posture, per segment): the upstream
 *    `segmentId` is the idempotency key. First delivery mints a frozen
 *    receipt (checksum + measured arrival relationship); re-delivery of the
 *    same id + same content is an idempotent duplicate — counted and logged,
 *    NOT re-emitted downstream; the same id with DIFFERENT content is an
 *    idempotency-key conflict (`media-invalid`, fail-loud).
 * 4. **VERBATIM timestamp preservation** (THE acceptance criterion): the
 *    normalized payload passes through untouched — no field is rewritten,
 *    re-stamped, or clamped. The service MEASURES the arrival-clock vs
 *    upstream-timestamp relationship (`arrivalLagMs` on the receipt, the
 *    `streaming_arrival_lag_ms` histogram) and REPORTS it; W103 timeline
 *    correlation is downstream, not here.
 * 5. **Bounded delivery** (architecture-lock §8/§13, W104): every accepted
 *    segment is emitted as one `StageMessage` on the caller-owned bounded
 *    output channel. Backpressure is the channel's explicit policy: `block`
 *    parks the pump (natural backpressure, bounded memory end to end);
 *    `reject` refuses the send — the segment is accounted as a
 *    `rejectedBackpressure` refusal and the stream continues. NEVER a silent
 *    drop: `drop-oldest` channels account their own evictions (W104
 *    channel-owned accounting).
 * 6. **Honest accounting**: every delivered segment lands in EXACTLY one
 *    bucket — `segmentsIn === segmentsOut + rejected + duplicates + abandoned`
 *    — asserted at every session end before the result settles (an imbalance
 *    THROWS rather than returning a lying result).
 *
 * Shutdown (`stop()`): idempotent; requests the source to end, closes the
 * output channel to guarantee termination of any in-flight send, and settles
 * the final result. A send that had already been admitted completed
 * (`segmentsOut`); a send still pending at close is rejected by the channel
 * and its segment is accounted as **abandoned** — explicit, logged, metered,
 * never silent loss. Segments already queued in the channel at close remain
 * receivable (the W104 no-loss-after-admission contract).
 *
 * Observability (architecture-lock §12, W007 seams): one structured log line
 * per decision (accepted / duplicate / rejected / abandoned), one per session
 * event (admitted / ended), all carrying the correlation ids and the
 * `streaming-ingress` stage name; counters for in/out/rejected (labeled by
 * failure class)/duplicate/abandoned/backpressure and histograms for the
 * measured arrival lag and output-send wait. Absent observability objects
 * become silent no-ops.
 *
 * Determinism: the ONLY clocks are injected (`clock` for arrivals; a static
 * or function `rightsNowMs` epoch for the rights gate, default 0 exactly like
 * W101/W102 — production callers MUST inject a real epoch). No `Date.now`,
 * no `Math.random`, no real timers anywhere in this package.
 */
import { SCHEMA_VERSION } from "@sporta/contracts";
import type { StageMessage } from "@sporta/contracts";
import { MetricsRegistry, bindLogger, createLogger } from "@sporta/observability";
import type { CorrelationContext, Logger } from "@sporta/observability";
import { assertAuthorized, RightsDeniedError as SessionRightsDeniedError } from "@sporta/session";
import {
  ChannelClosedError,
  ResourceLimitError as ChannelResourceLimitError,
} from "@sporta/transport";
import type { BoundedChannel } from "@sporta/transport";
import { checksumLiveSegment } from "./checksum";
import { InvalidLiveSessionStateError, MalformedSegmentError, RightsDeniedError } from "./errors";
import { LiveSegmentRegistry } from "./registry";
import type {
  IngestedLiveSegment,
  LiveIngressLimits,
  LiveIngressStats,
  LiveSegment,
  LiveSegmentReceipt,
  LiveSessionResult,
  RejectionRecord,
  StreamingIngressOptions,
} from "./types";
import {
  DEFAULT_LIVE_INGRESS_LIMITS,
  STREAMING_METRIC_NAMES as METRICS,
  assertAccountingBalance,
  emptyStats,
} from "./types";
import { validateLiveSegment } from "./validate";

/** Log/metric stage name for every record emitted by this boundary. */
const INGRESS_STAGE = "streaming-ingress";

/** Label key carrying the failure class on the rejection counter. */
const FAILURE_CLASS_LABEL = "failure_class";

/** Lifecycle phase of one live ingest session. */
export type LiveSessionPhase = "created" | "streaming" | "ended";

/**
 * The streaming ingest boundary service. Construct with the wiring (session,
 * source, policy, output channel, clock); `start()` admits; `stop()` ends
 * orderly; `done()` settles; `stats()`, `receipt()`, `rejections()` observe.
 */
export class StreamingIngressService {
  private readonly sessionId: string;
  private readonly source: StreamingIngressOptions["source"];
  private readonly authorizationPolicy: StreamingIngressOptions["authorizationPolicy"];
  private readonly output: BoundedChannel<StageMessage>;
  private readonly clock: StreamingIngressOptions["clock"];
  private readonly limits: LiveIngressLimits;
  private readonly rightsNowMs: number | (() => number);
  private readonly resourceBudget: StreamingIngressOptions["resourceBudget"];
  private readonly logger: Logger;
  private readonly metrics: MetricsRegistry;
  private readonly correlation: CorrelationContext;
  private readonly registry = new LiveSegmentRegistry();
  private readonly rejectionLedger: RejectionRecord[] = [];
  private readonly accounting: LiveIngressStats = emptyStats();

  private phase: LiveSessionPhase = "created";
  private pumpPromise: Promise<LiveSessionResult> | undefined;
  private iterator: AsyncIterator<LiveSegment> | undefined;
  private outputSequence = 0;
  private stopRequested = false;
  private channelClosed = false;
  private naturalEnd = false;
  private terminal:
    | { failureClass: NonNullable<LiveSessionResult["terminalFailureClass"]>; message: string }
    | undefined;
  private settledResult: LiveSessionResult | undefined;

  constructor(options: StreamingIngressOptions) {
    if (typeof options.sessionId !== "string" || options.sessionId.length < 1) {
      throw new RangeError("StreamingIngressService requires a non-empty sessionId");
    }
    if (options.source === null || options.source === undefined) {
      throw new TypeError("StreamingIngressService requires a LiveSource");
    }
    if (options.output === null || options.output === undefined) {
      throw new TypeError("StreamingIngressService requires an output BoundedChannel");
    }
    if (
      options.clock === null ||
      typeof options.clock !== "object" ||
      typeof options.clock.now !== "function"
    ) {
      throw new TypeError("StreamingIngressService requires an injected LiveClock (now())");
    }
    if (options.limits !== undefined) {
      if (!Number.isInteger(options.limits.maxSegments) || options.limits.maxSegments < 1) {
        throw new RangeError(
          `LiveIngressLimits.maxSegments must be an integer >= 1 (got ${String(options.limits.maxSegments)})`,
        );
      }
    }
    this.sessionId = options.sessionId;
    this.source = options.source;
    this.authorizationPolicy = options.authorizationPolicy;
    this.output = options.output;
    this.clock = options.clock;
    this.limits = options.limits ?? DEFAULT_LIVE_INGRESS_LIMITS;
    this.rightsNowMs = options.rightsNowMs ?? 0;
    this.resourceBudget = options.resourceBudget;

    const noop = noopObservability();
    this.logger = options.observability?.logger ?? noop.logger;
    this.metrics = options.observability?.metrics ?? noop.metrics;
    this.correlation = options.observability?.correlation ?? {
      sessionId: this.sessionId,
      correlationId: `corr-live-${this.sessionId}`,
      traceId: `trace-live-${this.sessionId}`,
    };
  }

  // --- lifecycle -----------------------------------------------------------

  /** Current lifecycle phase (`created` until `start()`, `ended` after settle). */
  get currentPhase(): LiveSessionPhase {
    return this.phase;
  }

  /**
   * Admits the live session and begins streaming. Runs the fail-closed rights
   * gate FIRST (before the source is opened — an unauthorized caller learns
   * nothing about the feed) and throws {@link RightsDeniedError} on denial:
   * the stream never begins and nothing is accounted. Streaming then proceeds
   * in the background; observe via the output channel, `stats()`, `done()`.
   *
   * Throws {@link InvalidLiveSessionStateError} when already started or
   * called after the session ended.
   */
  start(): void {
    if (this.phase === "streaming") {
      throw new InvalidLiveSessionStateError("live session is already streaming");
    }
    if (this.phase === "ended") {
      throw new InvalidLiveSessionStateError("live session has already ended");
    }
    const logger = this.stageLogger();
    try {
      this.gateRights();
    } catch (err) {
      this.reportAdmissionDenial(logger, err);
      throw err;
    }

    this.iterator = this.source.segments()[Symbol.asyncIterator]();
    this.phase = "streaming";
    logger.info("live session admitted", {
      sourceLabel: this.source.description.label,
      mediaKinds: [...this.source.description.mediaKinds],
      policyId: this.authorizationPolicy?.policyId ?? null,
      maxSegments: this.limits.maxSegments,
    });
    this.pumpPromise = this.pump();
  }

  /**
   * Requests orderly shutdown (idempotent): the source is asked to end, the
   * output channel is closed (guaranteeing termination of any in-flight
   * send — a pending send's segment is accounted as ABANDONED, explicitly,
   * never silently lost), and the settled {@link LiveSessionResult} is
   * returned once the pump ends. Calling `stop()` after a naturally completed
   * session returns the settled result unchanged. Throws when called before
   * `start()`.
   */
  async stop(): Promise<LiveSessionResult> {
    if (this.phase === "created") {
      throw new InvalidLiveSessionStateError("cannot stop a live session before start()");
    }
    if (this.phase === "ended" && this.settledResult !== undefined) {
      return this.settledResult;
    }
    this.stopRequested = true;
    try {
      this.source.stop();
    } catch (err) {
      // A throwing source.stop() is a source-contract violation; the orderly
      // stop itself proceeds (the session result still settles) — but the
      // violation is LOUD, never swallowed.
      this.stageLogger().error("live source stop() threw", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.closeOutput();
    return await this.done();
  }

  /**
   * Resolves with the settled {@link LiveSessionResult} when the live session
   * ends (natural end-of-feed, `stop()`, or terminal failure). Rejects only
   * on an accounting-imbalance bug (the balance assertion — a result that
   * cannot be trusted is never returned). Throws when called before `start()`.
   */
  done(): Promise<LiveSessionResult> {
    if (this.pumpPromise === undefined) {
      throw new InvalidLiveSessionStateError("live session has not been started");
    }
    return this.pumpPromise;
  }

  // --- observation ---------------------------------------------------------

  /** Fresh snapshot of the accounting counters (see {@link LiveIngressStats}). */
  stats(): LiveIngressStats {
    return this.statsSnapshot();
  }

  /** The receipt minted for `segmentId` (copy), or `undefined` when none. */
  receipt(segmentId: string): LiveSegmentReceipt | undefined {
    const found = this.registry.get(segmentId);
    return found === undefined ? undefined : { ...found };
  }

  /** All minted receipts in mint order (fresh copies). */
  receipts(): LiveSegmentReceipt[] {
    return this.registry.receipts();
  }

  /** The fail-loud refusal ledger (fresh copies, order of occurrence). */
  rejections(): RejectionRecord[] {
    return this.rejectionLedger.map((record) => ({ ...record, details: { ...record.details } }));
  }

  // --- the pump ------------------------------------------------------------

  /**
   * The single delivery loop: pull → segment budget → rights re-check →
   * validate → dedupe/receipt → bounded send. Every path accounts the
   * in-flight segment in exactly ONE bucket; the balance invariants are
   * asserted before the result settles (a violation throws — this promise
   * then rejects instead of returning a lying result).
   */
  private async pump(): Promise<LiveSessionResult> {
    const logger = this.stageLogger();
    const iterator = this.iterator;
    if (iterator === undefined) {
      throw new InvalidLiveSessionStateError("pump started without an opened source iterator");
    }
    try {
      for (;;) {
        if (this.stopRequested) break;

        // --- pull (arrival measured the moment the segment lands) --------
        let next: IteratorResult<LiveSegment>;
        try {
          next = await iterator.next();
        } catch (err) {
          // The live source itself failed (transport loss): terminal,
          // classified `internal` — the input died loudly, nothing silent.
          this.terminal = {
            failureClass: "internal",
            message: `live source failed: ${err instanceof Error ? err.message : String(err)}`,
          };
          break;
        }
        if (next.done) {
          this.naturalEnd = !this.stopRequested;
          break;
        }
        const segment = next.value;
        this.accounting.segmentsIn += 1;
        this.metrics.counter(METRICS.segmentsIn).inc();
        const arrivalMs = this.clock.now();

        // --- segment budget (fail-loud, the W102 byte-budget posture) ----
        if (this.accounting.segmentsIn > this.limits.maxSegments) {
          this.accounting.rejected += 1;
          this.accounting.rejectedLimit += 1;
          this.recordRejection(
            segment,
            "resource-limit",
            "segment-budget-exhausted",
            `live session exceeded its segment budget: ${this.accounting.segmentsIn} > ${this.limits.maxSegments}`,
            { segmentsIn: this.accounting.segmentsIn, maxSegments: this.limits.maxSegments },
          );
          this.terminal = {
            failureClass: "resource-limit",
            message: `live session exceeded its segment budget: ${this.accounting.segmentsIn} > ${this.limits.maxSegments}`,
          };
          break;
        }

        // --- per-segment rights re-check (defense in depth) --------------
        try {
          this.gateRights();
        } catch (err) {
          this.accounting.rejected += 1;
          this.accounting.rejectedRights += 1;
          this.recordRejection(
            segment,
            "rights-denied",
            "rights-recheck-denied",
            err instanceof Error ? err.message : String(err),
            err instanceof RightsDeniedError ? err.details : {},
          );
          this.terminal = {
            failureClass: "rights-denied",
            message: `live session terminated by the rights gate: ${err instanceof Error ? err.message : String(err)}`,
          };
          break;
        }

        // --- validation (fail-loud; the stream continues) ----------------
        let upstreamMs: number;
        try {
          upstreamMs = validateLiveSegment(segment);
        } catch (err) {
          if (err instanceof MalformedSegmentError) {
            this.accounting.rejected += 1;
            this.accounting.rejectedMalformed += 1;
            this.recordRejection(
              segment,
              "media-invalid",
              typeof err.details.reason === "string" ? err.details.reason : "malformed-segment",
              err.message,
              err.details,
            );
            continue;
          }
          throw err;
        }

        // --- idempotency (the W101 posture, per segment) -----------------
        const checksum = checksumLiveSegment(segment);
        const existing = this.registry.get(segment.segmentId);
        if (existing !== undefined) {
          if (existing.checksum !== checksum) {
            this.accounting.rejected += 1;
            this.accounting.rejectedMalformed += 1;
            this.recordRejection(
              segment,
              "media-invalid",
              "idempotency-key-conflict",
              `segment id '${segment.segmentId}' re-delivered with different content ` +
                `(first checksum ${existing.checksum.slice(0, 12)}, now ${checksum.slice(0, 12)})`,
              { segmentId: segment.segmentId, firstChecksum: existing.checksum, checksum },
            );
            continue;
          }
          this.accounting.duplicates += 1;
          this.metrics.counter(METRICS.duplicatesTotal).inc();
          logger.info("live segment re-delivered (idempotent duplicate)", {
            segmentId: segment.segmentId,
            kind: segment.kind,
            checksum,
            arrivalMs,
            duplicate: true,
          });
          continue;
        }

        // --- receipt (measured relationship, VERBATIM upstream time) ----
        const receipt: LiveSegmentReceipt = Object.freeze({
          sessionId: this.sessionId,
          segmentId: segment.segmentId,
          checksum,
          arrivalMs,
          upstreamMs,
          arrivalLagMs: arrivalMs - upstreamMs,
        });
        this.registry.put(receipt);
        this.metrics.histogram(METRICS.arrivalLagMs).observe(receipt.arrivalLagMs);

        // --- bounded delivery (the W104 channel owns the policy) ---------
        const message = this.buildMessage(segment, receipt);
        const sendStartedAt = this.clock.now();
        let sendError: unknown;
        try {
          await this.output.send(message);
        } catch (err) {
          sendError = err;
        }
        this.metrics.histogram(METRICS.sendWaitMs).observe(this.clock.now() - sendStartedAt);

        if (sendError === undefined) {
          this.accounting.segmentsOut += 1;
          this.metrics.counter(METRICS.segmentsOut).inc();
          logger.info("live segment accepted", {
            segmentId: segment.segmentId,
            kind: segment.kind,
            checksum,
            arrivalMs,
            upstreamMs,
            arrivalLagMs: receipt.arrivalLagMs,
            sequence: message.sequence,
          });
          continue;
        }
        if (sendError instanceof ChannelClosedError) {
          this.accountAbandoned(
            segment,
            receipt,
            this.channelClosed ? "stop-closed-output" : "output-closed-externally",
          );
          if (!this.channelClosed && !this.stopRequested) {
            this.terminal = {
              failureClass: "internal",
              message: `output channel closed while the live session was streaming: ${sendError.message}`,
            };
          }
          break;
        }
        if (sendError instanceof ChannelResourceLimitError) {
          this.accounting.rejected += 1;
          this.accounting.rejectedBackpressure += 1;
          this.metrics.counter(METRICS.backpressureTotal).inc();
          this.recordRejection(
            segment,
            "resource-limit",
            "output-channel-full",
            `output channel refused the segment under its backpressure policy: ${sendError.message}`,
            { ...sendError.details, segmentId: segment.segmentId },
          );
          continue;
        }
        // Unexpected send failure: account the in-flight segment (never a
        // silent loss) and terminate with an internal failure.
        this.accountAbandoned(segment, receipt, "send-failed");
        this.terminal = {
          failureClass: "internal",
          message: `output send failed unexpectedly: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
        };
        break;
      }
    } catch (err) {
      // Internal bug (not a classified boundary decision): the session ends
      // failed/internal and the in-flight accounting is verified below — the
      // error is recorded in the result, never swallowed.
      this.terminal = {
        failureClass: "internal",
        message: `live session crashed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // --- end of session: close output, stop the source, verify, settle ---
    this.closeOutput();
    this.phase = "ended";
    try {
      this.source.stop();
    } catch {
      // stop() already logged a caller-initiated violation; a source that
      // also throws here cannot prevent settlement.
    }
    assertAccountingBalance(this.statsSnapshot()); // imbalance ⇒ rejects, never lies
    const result = this.buildResult();
    this.settledResult = result;
    logger.info("live session ended", {
      outcome: result.outcome,
      ...(result.terminalFailureClass === undefined
        ? {}
        : { terminalFailureClass: result.terminalFailureClass, error: result.error }),
      stats: this.statsSnapshot(),
    });
    return result;
  }

  // --- internals -----------------------------------------------------------

  /** Closes the output channel exactly once (queued messages stay receivable). */
  private closeOutput(): void {
    if (this.channelClosed) return;
    this.channelClosed = true;
    this.output.close();
  }

  /** Accounts one accepted segment as abandoned at shutdown (never silent). */
  private accountAbandoned(
    segment: LiveSegment,
    receipt: LiveSegmentReceipt,
    reason: string,
  ): void {
    this.accounting.abandoned += 1;
    this.rejectionLedger.push({
      segmentId: segment.segmentId,
      failureClass: "internal",
      reason: `abandoned-${reason}`,
      message: `segment '${segment.segmentId}' abandoned (${reason}): accepted, receipted, never delivered downstream`,
      atMs: this.clock.now(),
      details: {
        segmentId: segment.segmentId,
        checksum: receipt.checksum,
        arrivalMs: receipt.arrivalMs,
      },
    });
    this.metrics.counter(METRICS.abandonedTotal).inc();
    this.metrics.counter(METRICS.abandonedTotal, { reason }).inc();
    this.stageLogger().warn("live segment abandoned at shutdown", {
      segmentId: segment.segmentId,
      reason,
      checksum: receipt.checksum,
    });
  }

  /** Builds the stage message for one accepted segment. */
  private buildMessage(segment: LiveSegment, receipt: LiveSegmentReceipt): StageMessage {
    const sequence = this.outputSequence;
    this.outputSequence += 1;
    const payload: IngestedLiveSegment =
      segment.kind === "video"
        ? { segmentId: segment.segmentId, kind: "video", frame: segment.frame, receipt }
        : { segmentId: segment.segmentId, kind: "audio", chunk: segment.chunk, receipt };
    return {
      sessionId: this.sessionId,
      schemaVersion: SCHEMA_VERSION,
      sequence,
      // The payload's OWN upstream position, VERBATIM (never re-stamped;
      // multi-track feeds are not forced monotone — the stage message reports
      // the payload's timeline position; session-level watermark monotonicity
      // is the W004 ProcessingStateService's, downstream).
      watermark: { watermarkMs: receipt.upstreamMs, sequence },
      payload,
      correlationId: this.correlation.correlationId,
      traceId: this.correlation.traceId,
      ...(this.resourceBudget === undefined ? {} : { resourceBudget: this.resourceBudget }),
    };
  }

  /** The settled end-of-session result (balance already asserted). */
  private buildResult(): LiveSessionResult {
    const outcome =
      this.terminal !== undefined ? "failed" : this.naturalEnd ? "completed" : "stopped";
    return {
      sessionId: this.sessionId,
      outcome,
      ...(this.terminal === undefined
        ? {}
        : { terminalFailureClass: this.terminal.failureClass, error: this.terminal.message }),
      stats: this.statsSnapshot(),
      balanced: true,
    };
  }

  /** Internal stats snapshot with the registry size projected in. */
  private statsSnapshot(): LiveIngressStats {
    return { ...this.accounting, distinctSegments: this.registry.size };
  }

  /** Appends one structured record to the fail-loud rejection ledger. */
  private recordRejection(
    segment: LiveSegment,
    failureClass: RejectionRecord["failureClass"],
    reason: string,
    message: string,
    details: Record<string, unknown>,
  ): void {
    this.rejectionLedger.push({
      segmentId: typeof segment.segmentId === "string" ? segment.segmentId : null,
      failureClass,
      reason,
      message,
      atMs: this.clock.now(),
      details,
    });
    this.metrics.counter(METRICS.rejectedTotal).inc();
    this.metrics.counter(METRICS.rejectedTotal, { [FAILURE_CLASS_LABEL]: failureClass }).inc();
    this.stageLogger().warn("live segment rejected", {
      failureClass,
      reason,
      error: message,
      ...details,
    });
  }

  /**
   * The fail-closed rights gate: `analysis` must be authorized by a
   * currently-valid policy at the rights-evaluation time. Denials are mapped
   * to the streaming-ingress typed error with the session package's
   * structured reason.
   */
  private gateRights(): void {
    const nowEpochMs =
      typeof this.rightsNowMs === "function" ? this.rightsNowMs() : this.rightsNowMs;
    try {
      assertAuthorized(this.authorizationPolicy, "analysis", new Date(nowEpochMs));
    } catch (err) {
      if (err instanceof SessionRightsDeniedError) {
        throw new RightsDeniedError(err.message, {
          reason: err.reason,
          requiredOperation: err.requiredOperation,
          ...(err.policyId !== undefined ? { policyId: err.policyId } : {}),
        });
      }
      throw err;
    }
  }

  /** One warn line + rejection counters for an admission denial. */
  private reportAdmissionDenial(logger: Logger, err: unknown): void {
    if (err instanceof RightsDeniedError) {
      logger.warn("live session admission denied", {
        failureClass: "rights-denied",
        error: err.message,
        ...err.details,
      });
      this.metrics.counter(METRICS.rejectedTotal).inc();
      this.metrics.counter(METRICS.rejectedTotal, { [FAILURE_CLASS_LABEL]: "rights-denied" }).inc();
    }
  }

  /** Binds correlation + stage onto a child logger for this session. */
  private stageLogger(): Logger {
    return bindLogger(this.logger, this.correlation, INGRESS_STAGE);
  }
}

/**
 * Silent no-op observability defaults (the W101/W102 pattern, kept local so
 * this package owns its seams): a logger that emits nothing and a fresh
 * in-memory metrics registry nobody reads.
 */
export function noopObservability(): { logger: Logger; metrics: MetricsRegistry } {
  return {
    logger: createLogger({ minLevel: "error", sink: () => {} }),
    metrics: new MetricsRegistry(),
  };
}
