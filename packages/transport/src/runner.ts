/**
 * StageRunner (W104 §3.3) — wiring bounded channels and deterministic retries
 * into one pipeline stage.
 *
 * A runner consumes {@link StageMessage}s from a bounded input channel, runs
 * them through the stage's handler under {@link withRetries}, and enqueues one
 * result message on the bounded output channel — the payload is the
 * `StageResult` document (extended with `attempts`/`retriesUsed`), the
 * sequence carries over from the input message, and the message watermark is
 * the result's `watermarkAfter` (docs/contracts/streaming.md stage contract).
 * Backpressure is inherited from the channels themselves: a full `block`
 * output stops the runner mid-send, so memory stays bounded end to end
 * (architecture-lock §8/§13).
 *
 * Observability (architecture-lock §12): exactly ONE info log line per message
 * (stage, sequence, status, attempts, retries used, and the summed handler
 * latency measured with the injected `spec.nowMs` clock — never `Date.now`),
 * plus the `transport_*` metric counters. A handler that THROWS is a bug: it
 * is caught and converted to a terminal `failed`/non-retryable/`internal`
 * StageResult — never retried blindly — so one buggy message cannot take the
 * pipeline down with it.
 *
 * Concurrency > 1 runs N independent receive→process→send workers; the ORDER
 * of outputs is then NOT guaranteed — each output message carries its own
 * per-message watermarkAfter, and consumers do bounded reordering themselves.
 *
 * Shutdown is orderly: when the input channel closes, every worker drains the
 * messages it already received (no loss after receive), and only then does
 * `run()` close the output channel and resolve. `run()` settles ONLY on that
 * orderly shutdown, or rejects on a terminal input error / a failed output
 * send (e.g. a `reject`-policy output at capacity, or a closed output) —
 * silent hangs and silent losses are both out of contract.
 */
import type { StageMessage, StageResult } from "@sporta/contracts";
import {
  MetricsRegistry,
  bindLogger,
  createLogger,
  fromStageMessage,
  type Logger,
} from "@sporta/observability";
import { ChannelClosedError, type BoundedChannel } from "./channel";
import { validateRetryOptions, withRetries, type RetryOptions } from "./retry";

/** The wiring specification of one pipeline stage. */
export interface StageSpec {
  /** Stage name — used on results, logs, and metric labels. */
  stage: string;
  /** The stage's message handler. Returning a `StageResult` is the contract;
   * throwing is a bug (converted to an internal failure, never retried). */
  handler: (msg: StageMessage) => Promise<StageResult>;
  /** Independent in-flight workers (default 1 = FIFO outputs). > 1 makes the
   * output order non-deterministic; watermarks stay per-message. */
  concurrency?: number;
  /** Retry semantics for this stage. Absent means NO retries: retries are an
   * explicit, deterministic/idempotent-only policy choice (streaming contract). */
  retry?: RetryOptions;
  /**
   * Injectable clock for handler-latency measurement (default: `Date.now`).
   * Tests inject a deterministic stepping clock — the runner itself never
   * calls `Date.now` directly.
   */
  nowMs?: () => number;
}

/** Optional observability wiring for {@link StageRunner}. */
export interface StageRunnerObservability {
  /**
   * Logger for the one-info-line-per-message contract (default: the
   * observability package's console logger — instrumentation is unconditional).
   */
  logger?: Logger;
  /** Metrics registry for the `transport_*` counters (default: an internal
   * registry; inject one to read the counters back). */
  metrics?: MetricsRegistry;
}

/** The metric vocabulary emitted by {@link StageRunner}. */
export const TRANSPORT_METRIC_NAMES = {
  /** Messages processed, labeled `stage` + `status`. */
  messagesTotal: "transport_messages_total",
  /** Retries consumed (summed `retriesUsed`), labeled `stage`. */
  retriesTotal: "transport_retries_total",
  /** Failed messages, labeled `stage` + `errorClass`. */
  failuresTotal: "transport_failures_total",
} as const;

/**
 * A stage that declared no retry semantics gets NO retries — retries are an
 * explicit policy choice, not a default (docs/contracts/streaming.md).
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 1,
  baseDelayMs: 0,
  backoffMultiplier: 1,
};

/** Default latency clock (the standard repo injection pattern; see LoggerOptions.now). */
const defaultNowMs: () => number = Date.now;

/** Error class label used when a failed result carries no `errorClass`. */
const UNCLASSIFIED = "unclassified";

/**
 * Runs one pipeline stage between two bounded channels. Construct with the
 * input channel, the output channel, the {@link StageSpec}, and optional
 * observability; call {@link StageRunner.run} once (the returned promise
 * settles only on orderly shutdown or a terminal error).
 */
export class StageRunner {
  private readonly input: BoundedChannel<StageMessage>;
  private readonly output: BoundedChannel<StageMessage>;
  private readonly spec: StageSpec;
  private readonly logger: Logger;
  private readonly metrics: MetricsRegistry;
  private readonly retryOptions: RetryOptions;
  private readonly nowMs: () => number;

  constructor(
    input: BoundedChannel<StageMessage>,
    output: BoundedChannel<StageMessage>,
    spec: StageSpec,
    observability: StageRunnerObservability = {},
  ) {
    if (typeof spec.stage !== "string" || spec.stage.length < 1) {
      throw new RangeError(
        `StageSpec.stage must be a non-empty string (got ${String(spec.stage)})`,
      );
    }
    if (typeof spec.handler !== "function") {
      throw new TypeError("StageSpec.handler must be a function");
    }
    if (
      spec.concurrency !== undefined &&
      (!Number.isInteger(spec.concurrency) || spec.concurrency < 1)
    ) {
      throw new RangeError(
        `StageSpec.concurrency must be an integer >= 1 (got ${String(spec.concurrency)})`,
      );
    }
    if (spec.nowMs !== undefined && typeof spec.nowMs !== "function") {
      throw new TypeError("StageSpec.nowMs must be a function");
    }
    if (spec.retry !== undefined) validateRetryOptions(spec.retry);

    this.input = input;
    this.output = output;
    this.spec = spec;
    this.logger = observability.logger ?? createLogger();
    this.metrics = observability.metrics ?? new MetricsRegistry();
    this.retryOptions = spec.retry ?? DEFAULT_RETRY_OPTIONS;
    this.nowMs = spec.nowMs ?? defaultNowMs;
  }

  /**
   * Runs the stage until orderly shutdown: every worker loops
   * receive → retry-wrapped handler → result message on the output channel.
   * When the input channel closes and drains, in-flight messages are sent,
   * the output channel is closed, and `run()` resolves. A terminal input
   * error or a failed output send rejects `run()` instead (the output channel
   * is left open — its owner decides the recovery).
   */
  async run(): Promise<void> {
    const concurrency = this.spec.concurrency ?? 1;
    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i += 1) {
      workers.push(this.worker());
    }
    await Promise.all(workers);
    // All workers exited: the input is closed and drained and every in-flight
    // message has been sent — the orderly-shutdown point to close the output.
    this.output.close();
  }

  /** One receive→process→send loop; exits on the input's orderly end. */
  private async worker(): Promise<void> {
    for (;;) {
      let msg: StageMessage;
      try {
        msg = await this.input.receive();
      } catch (error) {
        if (error instanceof ChannelClosedError) return; // orderly end of input
        throw error; // terminal input error: run() rejects, output stays open
      }
      await this.process(msg);
    }
  }

  /**
   * Processes one message: retry-wrapped handler (with throw conversion and
   * injected-clock latency accounting), one info log line, the metric
   * counters, and the result message on the output channel.
   */
  private async process(msg: StageMessage): Promise<void> {
    let handlerLatencyMs = 0;
    const timedHandler = async (m: StageMessage): Promise<StageResult> => {
      const startedAt = this.nowMs();
      try {
        const result = await this.spec.handler(m);
        const elapsed = this.nowMs() - startedAt;
        handlerLatencyMs += elapsed;
        return result;
      } catch {
        // A handler that THROWS (vs returning `failed`) is a bug: classify as
        // a terminal internal failure — retryable false, so it is never
        // retried blindly — and claim no watermark progress. The pipeline
        // continues with the next message.
        const elapsed = this.nowMs() - startedAt;
        handlerLatencyMs += elapsed;
        return {
          sessionId: m.sessionId,
          stage: this.spec.stage,
          status: "failed",
          watermarkAfter: m.watermark,
          latencyMs: elapsed,
          retryable: false,
          errorClass: "internal",
        };
      }
    };

    const outcome = await withRetries(msg, timedHandler, this.retryOptions);

    // ONE info line per message, correlated to the message's session/trace.
    const line = bindLogger(this.logger, fromStageMessage(msg), this.spec.stage);
    line.info("stage message processed", {
      sequence: msg.sequence,
      status: outcome.status,
      attempts: outcome.attempts,
      retriesUsed: outcome.retriesUsed,
      latencyMs: handlerLatencyMs,
      ...(outcome.errorClass === undefined ? {} : { errorClass: outcome.errorClass }),
    });

    this.metrics
      .counter(TRANSPORT_METRIC_NAMES.messagesTotal, {
        stage: this.spec.stage,
        status: outcome.status,
      })
      .inc();
    if (outcome.retriesUsed > 0) {
      this.metrics
        .counter(TRANSPORT_METRIC_NAMES.retriesTotal, { stage: this.spec.stage })
        .inc(outcome.retriesUsed);
    }
    if (outcome.status === "failed") {
      this.metrics
        .counter(TRANSPORT_METRIC_NAMES.failuresTotal, {
          stage: this.spec.stage,
          errorClass: outcome.errorClass ?? UNCLASSIFIED,
        })
        .inc();
    }

    const outputMessage: StageMessage = {
      sessionId: msg.sessionId,
      schemaVersion: msg.schemaVersion,
      sequence: msg.sequence,
      watermark: outcome.watermarkAfter,
      payload: outcome,
      correlationId: msg.correlationId,
      traceId: msg.traceId,
      ...(msg.resourceBudget === undefined ? {} : { resourceBudget: msg.resourceBudget }),
    };
    await this.output.send(outputMessage);
  }
}
