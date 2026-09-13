/**
 * Bounded channel with explicit backpressure (W104 §3.1).
 *
 * The transport primitive that makes the streaming contract's backpressure
 * rule enforceable in code: "Queues are bounded. When downstream processing
 * falls behind, the system must have an explicit policy... Silent unbounded
 * buffering is prohibited" (docs/contracts/streaming.md), per architecture-lock
 * §8 (bounded buffers, asynchronous workers, explicit backpressure) and §13
 * (bounded resources). A {@link BoundedChannel} holds at most `capacity`
 * messages and at most `maxBytes` payload bytes, and when it is full the
 * configured {@link BackpressurePolicy} decides — every decision observable:
 *
 * - `block`: the sender awaits space (natural backpressure). Blocked senders
 *   are admitted strictly in arrival order (FIFO); a message that could never
 *   fit the byte budget on its own is rejected immediately instead of waiting
 *   forever. Head-of-line blocking is possible under a byte budget with mixed
 *   message sizes — that is the documented price of sender fairness.
 * - `reject`: the send fails with a typed {@link ResourceLimitError}; the
 *   producer learns the queue is full and decides what to do.
 * - `drop-oldest`: bounded loss WITH explicit accounting — every dropped
 *   message increments the `dropped` counter, emits one warn log line, and
 *   increments the `transport_channel_dropped_total` counter when a metrics
 *   registry is wired. Loss is never silent. A message larger than the whole
 *   byte budget on its own is dropped (and accounted), never enqueued.
 *
 * This is the MECHANISM layer the domain-level backpressure policies of
 * `@sporta/contracts` (`wait`, `drop-nonessential`, ...) map onto — e.g.
 * `wait` → `block`, `drop-nonessential` → `drop-oldest` on non-essential
 * intermediate streams.
 *
 * Closing is orderly: already-queued messages stay receivable (no loss after
 * admission), a pending `receive()` rejects with {@link ChannelClosedError},
 * and sends after close — including senders still blocked under `block` —
 * fail the same way.
 *
 * Implementation notes: pure data structures and microtasks only — no timers,
 * no threads. The waiting queues of senders/receivers hold resolvers, not
 * data: each blocked sender keeps its own message (the caller's reference), so
 * the channel's own buffer stays bounded by `capacity`/`maxBytes`. When space
 * frees up, blocked senders are admitted from the head of the queue; when a
 * receiver waits on an empty channel, the next message is handed to it
 * directly without occupying the buffer.
 */
import { createLogger, type Logger, type MetricsRegistry } from "@sporta/observability";
import type { StageMessage } from "@sporta/contracts";

/**
 * The explicit policy applied when a bounded channel is full (the transport
 * mechanism layer; see the module doc for how the contract-level policies map
 * onto these primitives).
 *
 * - `block`: await space — natural backpressure.
 * - `reject`: throw the typed resource-limit error.
 * - `drop-oldest`: bounded loss with explicit accounting (never silent).
 */
export type BackpressurePolicy = "block" | "reject" | "drop-oldest";

/** Options for {@link BoundedChannel}. */
export interface BoundedChannelOptions<T extends StageMessage = StageMessage> {
  /** Maximum number of queued messages (integer >= 1). */
  capacity: number;
  /** Optional maximum total payload bytes across queued messages (>= 0). */
  maxBytes?: number;
  /** The explicit policy applied when the channel is full. */
  policy: BackpressurePolicy;
  /**
   * Payload-size function used to enforce `maxBytes` (default: the JSON length
   * of the message payload). Non-JSON payloads (circular references, bigint)
   * size as 0 — callers moving binary payloads must inject a sizer.
   */
  sizer?: (msg: T) => number;
}

/** Optional observability wiring for {@link BoundedChannel}. */
export interface ChannelObservability {
  /**
   * Logger for drop accounting (default: the observability package's console
   * logger — drops are never silent even when nothing is injected).
   */
  logger?: Logger;
  /** Metrics registry for the dropped-messages counter (optional). */
  metrics?: MetricsRegistry;
}

/** Counter incremented once per dropped message (drop-oldest accounting). */
export const CHANNEL_DROPPED_METRIC = "transport_channel_dropped_total";

/** The policies a {@link BoundedChannelOptions.policy} may take. */
const POLICIES: readonly BackpressurePolicy[] = ["block", "reject", "drop-oldest"];

/**
 * Terminal error for channel misuse after {@link BoundedChannel.close}: a
 * pending or new `receive()` on a closed-and-drained channel, and any send
 * after close (including senders still blocked in `block` policy).
 */
export class ChannelClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelClosedError";
  }
}

/** Structured, JSON-safe limit details carried on every {@link ResourceLimitError}. */
export interface ResourceLimitDetails {
  /** The channel's backpressure policy. */
  policy: BackpressurePolicy;
  /** The channel's message capacity. */
  capacity: number;
  /** Messages queued at the time of the refusal. */
  size: number;
  /** The channel's byte budget, when configured. */
  maxBytes?: number;
  /** Payload bytes queued at the time of the refusal. */
  byteSize: number;
  /** Payload bytes the refused message would have added. */
  attemptedBytes: number;
}

/**
 * The typed resource-limit error thrown by the `reject` policy when the
 * channel is at capacity (message count or byte budget), and by `block` /
 * `reject` when a single message can never fit the byte budget. Bounded
 * resources refuse loudly; they never buffer silently.
 */
export class ResourceLimitError extends Error {
  readonly details: ResourceLimitDetails;

  constructor(message: string, details: ResourceLimitDetails) {
    super(message);
    this.name = "ResourceLimitError";
    this.details = details;
  }
}

/** One queued message with its pre-computed payload size. */
interface QueuedMessage<T> {
  msg: T;
  bytes: number;
}

/** A receiver waiting on an empty channel. */
interface ReceiverWaiter<T> {
  resolve: (msg: T) => void;
  reject: (error: unknown) => void;
}

/** A sender waiting for space under the `block` policy. */
interface SenderWaiter<T> {
  msg: T;
  bytes: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * Default sizer: the JSON length of the message payload. `undefined` and
 * non-JSON-serializable payloads (circular references, bigint) size as 0.
 */
function defaultSizer(msg: StageMessage): number {
  try {
    const encoded = JSON.stringify(msg.payload);
    return encoded === undefined ? 0 : encoded.length;
  } catch {
    return 0;
  }
}

/**
 * A bounded FIFO channel carrying stage messages between pipeline stages.
 *
 * The buffer never exceeds `capacity` messages / `maxBytes` payload bytes;
 * producers observe backpressure through the configured policy. All waiting
 * is cooperative (promises resolved on the microtask queue) — no timers.
 */
export class BoundedChannel<T extends StageMessage = StageMessage> {
  private readonly capacity: number;
  private readonly maxBytes: number | undefined;
  private readonly policy: BackpressurePolicy;
  private readonly sizer: (msg: T) => number;
  private readonly logger: Logger;
  private readonly metrics: MetricsRegistry | undefined;

  private readonly queued: QueuedMessage<T>[] = [];
  private readonly receivers: ReceiverWaiter<T>[] = [];
  private readonly senders: SenderWaiter<T>[] = [];
  private queuedBytes = 0;
  private droppedCount = 0;
  private closed = false;

  constructor(options: BoundedChannelOptions<T>, observability: ChannelObservability = {}) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1) {
      throw new RangeError(
        `BoundedChannel requires an integer capacity >= 1 (got ${String(options.capacity)})`,
      );
    }
    if (
      options.maxBytes !== undefined &&
      (!Number.isFinite(options.maxBytes) || options.maxBytes < 0)
    ) {
      throw new RangeError(
        `BoundedChannel maxBytes must be a finite number >= 0 (got ${String(options.maxBytes)})`,
      );
    }
    if (!POLICIES.includes(options.policy)) {
      throw new RangeError(
        `BoundedChannel policy must be one of "block" | "reject" | "drop-oldest" ` +
          `(got ${String(options.policy)})`,
      );
    }
    if (options.sizer !== undefined && typeof options.sizer !== "function") {
      throw new TypeError("BoundedChannel sizer must be a function");
    }
    this.capacity = options.capacity;
    this.maxBytes = options.maxBytes;
    this.policy = options.policy;
    this.sizer = options.sizer ?? defaultSizer;
    this.logger = observability.logger ?? createLogger();
    this.metrics = observability.metrics;
  }

  /** Messages currently queued (bounded by `capacity`). */
  get size(): number {
    return this.queued.length;
  }

  /** Payload bytes currently queued (bounded by `maxBytes` when configured). */
  get byteSize(): number {
    return this.queuedBytes;
  }

  /** Messages dropped by the `drop-oldest` policy since channel creation. */
  get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Sends one message, applying the backpressure policy when the channel is
   * full (see the module doc). Under `block` the returned promise settles
   * only when the message has been admitted; under `reject` it rejects with
   * {@link ResourceLimitError}; under `drop-oldest` it resolves once the
   * message is queued (or accounted as dropped when it alone exceeds the byte
   * budget). Sends after close reject with {@link ChannelClosedError}.
   */
  async send(msg: T): Promise<void> {
    if (this.closed) {
      throw new ChannelClosedError("send() on a closed channel");
    }
    const bytes = this.sizer(msg);
    if (!Number.isFinite(bytes) || bytes < 0) {
      throw new RangeError(
        `BoundedChannel sizer must return a finite number >= 0 (got ${String(bytes)})`,
      );
    }
    if (this.maxBytes !== undefined && bytes > this.maxBytes) {
      // A single message larger than the whole byte budget can never be
      // admitted, whatever the queue state: reject loudly (block would wait
      // forever) or, under drop-oldest, drop it with full accounting.
      if (this.policy === "drop-oldest") {
        this.accountDrop(msg, "exceeds-byte-budget");
        return;
      }
      throw new ResourceLimitError(
        `message of ${bytes} payload bytes can never fit the ${this.maxBytes}-byte budget`,
        this.limitDetails(bytes),
      );
    }
    // Strict sender FIFO: when earlier senders are still waiting (block
    // policy), a new send queues behind them even if it would fit — no
    // jumping the line, at the documented cost of head-of-line blocking.
    const hasWaitingSenders = this.policy === "block" && this.senders.length > 0;
    if (!hasWaitingSenders && this.fits(bytes)) {
      this.admit(msg, bytes);
      return;
    }
    switch (this.policy) {
      case "reject":
        throw new ResourceLimitError(
          `channel is full: ${this.queued.length} of ${this.capacity} messages queued` +
            (this.maxBytes === undefined
              ? ""
              : `, ${this.queuedBytes} of ${this.maxBytes} payload bytes queued`),
          this.limitDetails(bytes),
        );
      case "drop-oldest": {
        // Evict oldest (each eviction accounted) until the message fits.
        while (!this.fits(bytes) && this.queued.length > 0) {
          const oldest = this.queued.shift();
          if (oldest === undefined) break;
          this.queuedBytes -= oldest.bytes;
          this.accountDrop(oldest.msg, "evicted-oldest");
        }
        this.admit(msg, bytes);
        return;
      }
      case "block":
        await new Promise<void>((resolve, reject) => {
          this.senders.push({ msg, bytes, resolve, reject });
        });
        return;
    }
  }

  /**
   * Receives one message (FIFO). Awaits while the channel is empty; rejects
   * with {@link ChannelClosedError} once the channel is closed AND drained.
   * Already-queued messages remain receivable after close (no loss).
   */
  async receive(): Promise<T> {
    const immediate = this.dequeue();
    if (immediate !== undefined) return immediate;
    if (this.closed) {
      throw new ChannelClosedError("receive() on a closed and drained channel");
    }
    return await new Promise<T>((resolve, reject) => {
      this.receivers.push({ resolve, reject });
    });
  }

  /**
   * Non-blocking receive: the oldest queued message, or `undefined` when the
   * channel is empty. Still pumps blocked senders when it frees space.
   */
  tryReceive(): T | undefined {
    return this.dequeue();
  }

  /**
   * Closes the channel. Pending receivers (and senders blocked under `block`)
   * reject with {@link ChannelClosedError}; already-queued messages stay
   * receivable; sends after close fail. Idempotent.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const receiver of this.receivers) {
      receiver.reject(new ChannelClosedError("channel closed while receive() was pending"));
    }
    this.receivers.length = 0;
    for (const sender of this.senders) {
      sender.reject(new ChannelClosedError("channel closed while send() was blocked"));
    }
    this.senders.length = 0;
  }

  /** `true` when the message count and byte budget both allow admission. */
  private fits(bytes: number): boolean {
    if (this.queued.length >= this.capacity) return false;
    if (this.maxBytes !== undefined && this.queuedBytes + bytes > this.maxBytes) return false;
    return true;
  }

  /**
   * Admits a message: hand it straight to the first waiting receiver when one
   * exists (the buffer is bypassed, so its capacity stays free), otherwise
   * queue it.
   */
  private admit(msg: T, bytes: number): void {
    const receiver = this.receivers.shift();
    if (receiver !== undefined) {
      receiver.resolve(msg);
      return;
    }
    this.queued.push({ msg, bytes });
    this.queuedBytes += bytes;
  }

  /** Dequeues the oldest message and pumps blocked senders into freed space. */
  private dequeue(): T | undefined {
    const entry = this.queued.shift();
    if (entry === undefined) return undefined;
    this.queuedBytes -= entry.bytes;
    this.pump();
    return entry.msg;
  }

  /**
   * Admits blocked senders from the head while they fit (strict FIFO; a head
   * that no longer fits waits for the next freed space — senders and
   * receivers never wait simultaneously, since senders only queue while the
   * buffer is non-empty).
   */
  private pump(): void {
    while (this.senders.length > 0) {
      const head = this.senders[0];
      if (head === undefined || !this.fits(head.bytes)) break;
      this.senders.shift();
      this.admit(head.msg, head.bytes);
      head.resolve();
    }
  }

  /** Counts, logs, and meters one dropped message — the never-silent rule. */
  private accountDrop(msg: T, reason: string): void {
    this.droppedCount += 1;
    this.logger.warn("bounded channel dropped message", {
      reason,
      policy: this.policy,
      dropped: this.droppedCount,
      size: this.queued.length,
      capacity: this.capacity,
      ...(this.maxBytes === undefined
        ? {}
        : { maxBytes: this.maxBytes, byteSize: this.queuedBytes }),
      sessionId: msg.sessionId,
      sequence: msg.sequence,
    });
    this.metrics?.counter(CHANNEL_DROPPED_METRIC, { policy: this.policy }).inc();
  }

  /** The structured details snapshot attached to a {@link ResourceLimitError}. */
  private limitDetails(attemptedBytes: number): ResourceLimitDetails {
    return {
      policy: this.policy,
      capacity: this.capacity,
      size: this.queued.length,
      ...(this.maxBytes === undefined ? {} : { maxBytes: this.maxBytes }),
      byteSize: this.queuedBytes,
      attemptedBytes,
    };
  }
}
