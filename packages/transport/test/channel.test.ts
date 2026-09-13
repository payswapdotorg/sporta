/**
 * Unit tests for the bounded channel (W104 §3.1).
 *
 * Every policy decision is asserted through its observable contract: buffer
 * bounds (`size`/`byteSize`), typed errors, the `dropped` counter, parsed warn
 * log lines, and metrics snapshots. Deterministic per docs/testing/HARNESS.md:
 * builders with fixed seeds, injected logger sinks, microtask-only waiting —
 * no timers, no clock reads, no Math.random.
 */
import { describe, expect, test } from "bun:test";
import { buildStageMessage } from "@sporta/testing";
import {
  MetricsRegistry,
  createLogger,
  type CounterSnapshot,
  type LogRecord,
  type Logger,
  type LoggerOptions,
} from "@sporta/observability";
import type { StageMessage } from "@sporta/contracts";
import {
  BoundedChannel,
  CHANNEL_DROPPED_METRIC,
  ChannelClosedError,
  ResourceLimitError,
  type BoundedChannelOptions,
} from "../src/channel";

const SEED = 2_025_010_600;

/** Fixed-seed builder wrapper: only sequence/payload vary between messages. */
function message(sequence: number, payload: unknown = { kind: "channel-test" }): StageMessage {
  return buildStageMessage(
    {
      sessionId: "sess-channel",
      sequence,
      watermark: { watermarkMs: sequence * 40, sequence },
      payload,
      correlationId: `corr-channel-${sequence}`,
      traceId: "trace-channel",
    },
    SEED + sequence,
  );
}

/** A logger that never writes anywhere (tests that do not assert on logs). */
function silentLogger(): Logger {
  return createLogger({ sink: () => {}, minLevel: "error" });
}

/** Collects raw log lines and parses them back into LogRecords. */
function logCollector(): { options: LoggerOptions; records: () => LogRecord[] } {
  const lines: string[] = [];
  return {
    options: { sink: (line) => lines.push(line) },
    records: () => lines.map((line) => JSON.parse(line) as LogRecord),
  };
}

/** Builds a channel with the silent logger (log-asserting tests override). */
function channel(
  options: BoundedChannelOptions,
  observability: { logger?: Logger; metrics?: MetricsRegistry } = {},
): BoundedChannel {
  return new BoundedChannel(options, { logger: silentLogger(), ...observability });
}

describe("BoundedChannel", () => {
  test("delivers messages in FIFO order", async () => {
    const ch = channel({ capacity: 4, policy: "block" });
    const a = message(1);
    const b = message(2);
    const c = message(3);
    await ch.send(a);
    await ch.send(b);
    await ch.send(c);
    expect(await ch.receive()).toBe(a);
    expect(await ch.receive()).toBe(b);
    expect(await ch.receive()).toBe(c);
    expect(ch.size).toBe(0);
    expect(ch.tryReceive()).toBeUndefined();
  });

  test("block policy: a full channel awaits the sender until a receive frees space", async () => {
    const ch = channel({ capacity: 1, policy: "block" });
    const first = message(1);
    const second = message(2);
    await ch.send(first);
    const blocked = ch.send(second);
    // The buffer stays bounded: the second message is NOT buffered anywhere
    // by the channel — its sender is simply waiting.
    expect(ch.size).toBe(1);
    expect(ch.byteSize).toBe(JSON.stringify(first.payload).length);
    expect(await ch.receive()).toBe(first);
    await blocked; // resolves only after the receive freed space
    expect(ch.size).toBe(1);
    expect(await ch.receive()).toBe(second);
  });

  test("block policy: blocked senders are admitted in arrival order (FIFO)", async () => {
    const ch = channel({ capacity: 1, policy: "block" });
    const a = message(1);
    const b = message(2);
    const c = message(3);
    await ch.send(a);
    const sendB = ch.send(b);
    const sendC = ch.send(c);
    expect(await ch.receive()).toBe(a);
    await sendB;
    expect(await ch.receive()).toBe(b);
    await sendC;
    expect(await ch.receive()).toBe(c);
  });

  test("block policy: a waiting receiver gets the next message directly, without buffering", async () => {
    const ch = channel({ capacity: 1, policy: "block" });
    const pending = ch.receive();
    const a = message(1);
    await ch.send(a);
    expect(ch.size).toBe(0); // handed straight to the receiver, never queued
    expect(await pending).toBe(a);
  });

  test("reject policy: sending at capacity throws the typed resource-limit error", async () => {
    const ch = channel({ capacity: 2, policy: "reject" });
    await ch.send(message(1));
    await ch.send(message(2));
    const payloadBytes = JSON.stringify({ kind: "channel-test" }).length;
    let error: unknown;
    try {
      await ch.send(message(3));
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(ResourceLimitError);
    const limit = error as ResourceLimitError;
    expect(limit.name).toBe("ResourceLimitError");
    expect(limit.details).toEqual({
      policy: "reject",
      capacity: 2,
      size: 2,
      byteSize: 2 * payloadBytes,
      attemptedBytes: payloadBytes,
    });
    expect(ch.size).toBe(2); // the refused message never entered the buffer
  });

  test("drop-oldest: evicts the OLDEST, counts/logs/meters the loss; the NEWEST stays queued", async () => {
    const logs = logCollector();
    const metrics = new MetricsRegistry();
    const ch = channel(
      { capacity: 1, policy: "drop-oldest" },
      { logger: createLogger(logs.options), metrics },
    );
    const oldest = message(1);
    const newest = message(2);
    await ch.send(oldest);
    await ch.send(newest);
    expect(ch.dropped).toBe(1);
    expect(ch.size).toBe(1);
    expect(await ch.receive()).toBe(newest);
    expect(ch.dropped).toBe(1);
    // One warn line accounting the drop, correlated to the dropped message.
    const records = logs.records();
    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe("warn");
    expect(records[0]?.fields).toMatchObject({
      reason: "evicted-oldest",
      policy: "drop-oldest",
      dropped: 1,
      sessionId: "sess-channel",
      sequence: 1,
    });
    // The dropped stat: one increment on the shared counter.
    const droppedCounter = metrics
      .snapshot()
      .counters.find((entry: CounterSnapshot) => entry.name === CHANNEL_DROPPED_METRIC);
    expect(droppedCounter?.value).toBe(1);
  });

  test("byte budget: a second 60%-of-budget message is rejected (reject policy)", async () => {
    const ch = channel({ capacity: 10, policy: "reject", maxBytes: 100 });
    const payload = "x".repeat(58); // JSON string form is exactly 60 bytes
    await ch.send(message(1, payload));
    expect(ch.byteSize).toBe(60);
    let error: unknown;
    try {
      await ch.send(message(2, payload));
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(ResourceLimitError);
    expect((error as ResourceLimitError).details).toEqual({
      policy: "reject",
      capacity: 10,
      size: 1,
      maxBytes: 100,
      byteSize: 60,
      attemptedBytes: 60,
    });
    expect(ch.size).toBe(1); // first message untouched
  });

  test("byte budget: a second 60%-of-budget message evicts the oldest (drop-oldest policy)", async () => {
    const ch = channel({ capacity: 10, policy: "drop-oldest", maxBytes: 100 });
    const payload = "x".repeat(58);
    const first = message(1, payload);
    const second = message(2, payload);
    await ch.send(first);
    await ch.send(second);
    expect(ch.dropped).toBe(1);
    expect(ch.byteSize).toBe(60);
    expect(await ch.receive()).toBe(second); // the NEWEST stays queued
  });

  test("a message larger than the whole byte budget can never be admitted", async () => {
    const oversized = "x".repeat(118); // JSON string form is exactly 120 bytes
    // reject: typed refusal
    const rejectCh = channel({ capacity: 5, policy: "reject", maxBytes: 100 });
    await expect(rejectCh.send(message(1, oversized))).rejects.toThrow(ResourceLimitError);
    // block: refusing beats waiting forever for space that can never exist
    const blockCh = channel({ capacity: 5, policy: "block", maxBytes: 100 });
    await expect(blockCh.send(message(1, oversized))).rejects.toThrow(ResourceLimitError);
    expect(blockCh.size).toBe(0);
    // drop-oldest: the incoming message itself is dropped — with accounting
    const dropCh = channel({ capacity: 5, policy: "drop-oldest", maxBytes: 100 });
    await dropCh.send(message(1, oversized));
    expect(dropCh.size).toBe(0);
    expect(dropCh.dropped).toBe(1);
  });

  test("close: queued messages are not lost; drained receives and later sends fail closed", async () => {
    const ch = channel({ capacity: 2, policy: "block" });
    const a = message(1);
    const b = message(2);
    await ch.send(a);
    await ch.send(b);
    ch.close();
    // Already-queued messages survive the close (no message loss).
    expect(await ch.receive()).toBe(a);
    expect(await ch.receive()).toBe(b);
    expect(ch.tryReceive()).toBeUndefined();
    // Closed AND drained: receive rejects with the terminal typed error.
    await expect(ch.receive()).rejects.toThrow(ChannelClosedError);
    // Sends after close fail the same way.
    await expect(ch.send(message(3))).rejects.toThrow(ChannelClosedError);
    expect(ch.size).toBe(0);
  });

  test("close: a receive pending on an empty channel rejects with ChannelClosedError", async () => {
    const ch = channel({ capacity: 1, policy: "block" });
    const pending = ch.receive();
    ch.close();
    await expect(pending).rejects.toThrow(ChannelClosedError);
  });

  test("close: a sender blocked by the block policy rejects with ChannelClosedError", async () => {
    const ch = channel({ capacity: 1, policy: "block" });
    await ch.send(message(1));
    const blocked = ch.send(message(2));
    ch.close();
    await expect(blocked).rejects.toThrow(ChannelClosedError);
  });

  test("close is idempotent", () => {
    const ch = channel({ capacity: 1, policy: "block" });
    ch.close();
    expect(() => ch.close()).not.toThrow();
  });

  test("tryReceive drains without waiting", async () => {
    const ch = channel({ capacity: 2, policy: "block" });
    expect(ch.tryReceive()).toBeUndefined();
    const a = message(1);
    await ch.send(a);
    expect(ch.tryReceive()).toBe(a);
    expect(ch.tryReceive()).toBeUndefined();
  });

  test("sizer: default measures the JSON length of the payload; a custom sizer overrides it", async () => {
    const defaultCh = channel({ capacity: 4, policy: "block" });
    // A primitive payload replaces the builder default wholesale, so the JSON
    // length is exactly controllable.
    await defaultCh.send(message(1, "sizer-probe"));
    expect(defaultCh.byteSize).toBe(JSON.stringify("sizer-probe").length);
    const customCh = channel({ capacity: 4, policy: "block", sizer: () => 42 });
    await customCh.send(message(1));
    expect(customCh.byteSize).toBe(42);
  });

  test("invalid options and sizer results fail loud", async () => {
    const asOptions = (value: Record<string, unknown>): BoundedChannelOptions =>
      value as unknown as BoundedChannelOptions;
    expect(() => new BoundedChannel(asOptions({ capacity: 0, policy: "block" }))).toThrow(
      RangeError,
    );
    expect(() => new BoundedChannel(asOptions({ capacity: 2, policy: "wait" }))).toThrow(
      RangeError,
    );
    expect(
      () => new BoundedChannel(asOptions({ capacity: 2, policy: "block", maxBytes: -1 })),
    ).toThrow(RangeError);
    const badSizer = channel({ capacity: 2, policy: "block", sizer: () => -5 });
    await expect(badSizer.send(message(1))).rejects.toThrow(RangeError);
  });
});
