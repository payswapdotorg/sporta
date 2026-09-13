/**
 * StageRunner end-to-end tests (W104 §3.5) — the ACCEPTANCE fixture: segments
 * flow between stages with bounded memory and retry semantics.
 *
 * The fixture pipeline mirrors the decoding stage's real shape: 20 synthetic
 * stage messages whose payloads are `NormalizedVideoFrame`-like objects
 * (frame ids, `presentationMs` on the canonical media timeline, 2x2 rgb24
 * byte volumes — see packages/decoding/src/types.ts). They flow
 * input channel → StageRunner → output channel with output capacity 5 < 20
 * messages, which PROVES blocking backpressure: with no consumer yet, the
 * runner parks at the channel bound instead of buffering ahead.
 *
 * Determinism per docs/testing/HARNESS.md: builders with fixed seeds, an
 * injected stepping clock for handler latency, an injected recording clock
 * for retry sleeps, collected log lines, and microtask draining only — no
 * real timers, no Date.now, no Math.random anywhere.
 */
import { describe, expect, test } from "bun:test";
import { TEST_EPOCH_MS, buildStageMessage } from "@sporta/testing";
import {
  MetricsRegistry,
  createLogger,
  type CounterSnapshot,
  type LogRecord,
  type LoggerOptions,
} from "@sporta/observability";
import type { StageMessage, StageResult } from "@sporta/contracts";
import { BoundedChannel, ChannelClosedError } from "../src/channel";
import { StageRunner, TRANSPORT_METRIC_NAMES } from "../src/runner";
import type { RetryClock } from "../src/retry";

const SEED = 2_025_010_620;
const SESSION_ID = "sess-w104-runner";
const STAGE = "decoding-fixture";
const TOTAL = 20;
const OUTPUT_CAPACITY = 5; // < TOTAL: the bounded-memory proof

/** A decoding-shaped payload: one normalized video frame (2x2 rgb24). */
interface FakeFrame {
  frameId: string;
  streamIndex: number;
  presentationMs: number;
  decodeOrder: number;
  width: number;
  height: number;
  pixelFormat: "rgb24";
  bytes: Uint8Array;
}

function framePayload(sequence: number): FakeFrame {
  return {
    frameId: `f-0-${sequence}`,
    streamIndex: 0,
    presentationMs: sequence * 40, // 25 fps fixture on the canonical timeline
    decodeOrder: sequence,
    width: 2,
    height: 2,
    pixelFormat: "rgb24",
    bytes: new Uint8Array(12), // width * height * 3 — the decoding byte invariant
  };
}

function fixtureMessage(sequence: number): StageMessage {
  return buildStageMessage(
    {
      sessionId: SESSION_ID,
      sequence,
      watermark: { watermarkMs: sequence * 40, sequence },
      payload: framePayload(sequence),
      correlationId: `corr-w104-${sequence}`,
      traceId: "trace-w104-e2e",
    },
    SEED + sequence,
  );
}

/**
 * The fixture handler's watermark rule: watermarkAfter advances by the
 * payload count (one frame per message here) — timeline position of the NEXT
 * frame, sequence + 1.
 */
function expectedWatermarkAfter(sequence: number): { watermarkMs: number; sequence: number } {
  return { watermarkMs: (sequence + 1) * 40, sequence: sequence + 1 };
}

type RunnerOutcome = StageResult & { attempts: number; retriesUsed: number };

/** The healthy fixture handler: every message succeeds. */
function okHandler(msg: StageMessage): Promise<StageResult> {
  const frame = msg.payload as FakeFrame;
  return Promise.resolve({
    sessionId: msg.sessionId,
    stage: STAGE,
    status: "ok",
    watermarkAfter: {
      watermarkMs: frame.presentationMs + 40,
      sequence: msg.sequence + 1,
    },
    latencyMs: 1,
    retryable: false,
  });
}

/** A transient, retryable failure shaped like a decode hiccup. */
function transientFailure(msg: StageMessage): StageResult {
  return {
    sessionId: msg.sessionId,
    stage: STAGE,
    status: "failed",
    watermarkAfter: msg.watermark,
    latencyMs: 1,
    retryable: true,
    errorClass: "transient",
  };
}

/** Injected latency clock: every read advances the fake time by `stepMs`. */
function steppingClock(stepMs: number): () => number {
  let value = 0;
  return () => {
    value += stepMs;
    return value;
  };
}

/** Recording fake retry clock — the sleep sequence is asserted exactly. */
function recordingRetryClock(): { clock: RetryClock; sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    clock: {
      sleep: (ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    },
    sleeps,
  };
}

/** Observability wiring with collected log lines and a readable registry. */
function runnerObservability(): {
  options: { logger: ReturnType<typeof createLogger>; metrics: MetricsRegistry };
  metrics: MetricsRegistry;
  records: () => LogRecord[];
} {
  const lines: string[] = [];
  const loggerOptions: LoggerOptions = {
    sink: (line) => lines.push(line),
    now: () => TEST_EPOCH_MS,
  };
  const metrics = new MetricsRegistry();
  return {
    options: { logger: createLogger(loggerOptions), metrics },
    metrics,
    records: () => lines.map((line) => JSON.parse(line) as LogRecord),
  };
}

/** A silent channel logger — channel drops are not under test here. */
function silentChannelLogger(): ReturnType<typeof createLogger> {
  return createLogger({ sink: () => {}, minLevel: "error" });
}

/** Yields to the microtask queue `ticks` times — deterministic draining. */
async function drainMicrotasks(ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
  }
}

function findCounter(
  metrics: MetricsRegistry,
  name: string,
  labels: Record<string, string>,
): CounterSnapshot | undefined {
  return metrics.snapshot().counters.find((entry: CounterSnapshot) => {
    if (entry.name !== name) return false;
    const keys = new Set([...Object.keys(entry.labels), ...Object.keys(labels)]);
    return [...keys].every((key) => entry.labels[key] === labels[key]);
  });
}

/** Preloads a fresh input channel with the 20 fixture messages. */
async function loadedInput(): Promise<BoundedChannel> {
  const input = new BoundedChannel(
    { capacity: TOTAL, policy: "block" },
    { logger: silentChannelLogger() },
  );
  for (let sequence = 0; sequence < TOTAL; sequence += 1) {
    await input.send(fixtureMessage(sequence));
  }
  return input;
}

function freshOutput(): BoundedChannel {
  return new BoundedChannel(
    { capacity: OUTPUT_CAPACITY, policy: "block" },
    { logger: silentChannelLogger() },
  );
}

describe("StageRunner (E2E — W104 acceptance)", () => {
  test("20 decoding-shaped messages flow input -> runner -> output, bounded, in order, observable", async () => {
    const input = await loadedInput();
    const output = freshOutput();
    const obs = runnerObservability();
    let handlerCalls = 0;
    const runner = new StageRunner(
      input,
      output,
      {
        stage: STAGE,
        handler: (msg) => {
          handlerCalls += 1;
          return okHandler(msg);
        },
        nowMs: steppingClock(3),
      },
      obs.options,
    );

    const running = runner.run();
    await drainMicrotasks(500);

    // BOUNDED-MEMORY PROOF: output capacity 5 < 20 messages and nothing is
    // consuming yet — the runner is parked at the channel bound (5 result
    // messages queued, the 6th send blocked mid-flight), not buffered ahead.
    expect(output.size).toBe(OUTPUT_CAPACITY);
    expect(handlerCalls).toBe(OUTPUT_CAPACITY + 1);
    expect(input.size).toBe(TOTAL - OUTPUT_CAPACITY - 1);

    // Orderly close of the input MID-FLIGHT (the runner is blocked on the
    // output send): already-received messages are not lost.
    input.close();

    const received: StageMessage[] = [];
    for (let i = 0; i < TOTAL; i += 1) {
      received.push(await output.receive());
    }
    await running; // resolves: input closed+drained -> in-flight drained -> output closed

    // All 20 arrived, in order (concurrency 1).
    expect(received.map((m) => m.sequence)).toEqual(Array.from({ length: TOTAL }, (_, i) => i));
    // Watermarks advance per message; payloads are the StageResult documents.
    for (const [i, out] of received.entries()) {
      expect(out.watermark).toEqual(expectedWatermarkAfter(i));
      expect(out.sequence).toBe(i);
      expect(out.sessionId).toBe(SESSION_ID);
      expect(out.correlationId).toBe(`corr-w104-${i}`);
      const payload = out.payload as RunnerOutcome;
      expect(payload.status).toBe("ok");
      expect(payload.attempts).toBe(1);
      expect(payload.retriesUsed).toBe(0);
      expect(payload.watermarkAfter).toEqual(expectedWatermarkAfter(i));
      expect(payload.stage).toBe(STAGE);
    }
    // Exactly ONE info line per message (20), with the required shape.
    const records = obs.records();
    expect(records).toHaveLength(TOTAL);
    for (const [i, record] of records.entries()) {
      expect(record.level).toBe("info");
      expect(record.msg).toBe("stage message processed");
      expect(record.stage).toBe(STAGE);
      expect(record.sessionId).toBe(SESSION_ID);
      expect(record.correlationId).toBe(`corr-w104-${i}`);
      expect(record.traceId).toBe("trace-w104-e2e");
      expect(record.ts).toBe(TEST_EPOCH_MS);
      expect(record.fields).toEqual({
        sequence: i,
        status: "ok",
        attempts: 1,
        retriesUsed: 0,
        latencyMs: 3, // stepping clock: one handler attempt, 3 ms per read pair
      });
    }
    // Metrics: 20 messages ok, no retries, no failures.
    expect(
      findCounter(obs.metrics, TRANSPORT_METRIC_NAMES.messagesTotal, {
        stage: STAGE,
        status: "ok",
      })?.value,
    ).toBe(TOTAL);
    expect(
      findCounter(obs.metrics, TRANSPORT_METRIC_NAMES.retriesTotal, { stage: STAGE }),
    ).toBeUndefined();
    expect(
      findCounter(obs.metrics, TRANSPORT_METRIC_NAMES.failuresTotal, {
        stage: STAGE,
        errorClass: "internal",
      }),
    ).toBeUndefined();
    // The runner closed the output after draining (orderly shutdown).
    await expect(output.receive()).rejects.toThrow(ChannelClosedError);
    expect(output.size).toBe(0);
  });

  test("fault injection: 2 retryable failures per message, then success — every message still arrives", async () => {
    const input = await loadedInput();
    input.close(); // queued messages stay receivable
    const output = freshOutput();
    const obs = runnerObservability();
    const { clock, sleeps } = recordingRetryClock();
    const attemptsBySequence = new Map<number, number>();
    const handler = (msg: StageMessage): Promise<StageResult> => {
      const seen = (attemptsBySequence.get(msg.sequence) ?? 0) + 1;
      attemptsBySequence.set(msg.sequence, seen);
      if (seen <= 2) return Promise.resolve(transientFailure(msg));
      return okHandler(msg);
    };
    const runner = new StageRunner(
      input,
      output,
      {
        stage: STAGE,
        handler,
        retry: { maxAttempts: 3, baseDelayMs: 5, backoffMultiplier: 2, clock },
        nowMs: steppingClock(3),
      },
      obs.options,
    );

    const running = runner.run();
    const received: StageMessage[] = [];
    for (let i = 0; i < TOTAL; i += 1) {
      received.push(await output.receive());
    }
    await running;

    // All 20 arrived in order; each took 3 attempts / 2 retries and recovered.
    expect(received.map((m) => m.sequence)).toEqual(Array.from({ length: TOTAL }, (_, i) => i));
    for (const out of received) {
      const payload = out.payload as RunnerOutcome;
      expect(payload.status).toBe("ok");
      expect(payload.attempts).toBe(3);
      expect(payload.retriesUsed).toBe(2);
      expect(out.watermark).toEqual(expectedWatermarkAfter(out.sequence));
    }
    // The deterministic sleep sequence: [base, base*multiplier] per message.
    expect(sleeps).toEqual(Array.from({ length: TOTAL }, () => [5, 10]).flat());
    // Retries metric: 2 per message, 40 total; no failures.
    expect(
      findCounter(obs.metrics, TRANSPORT_METRIC_NAMES.retriesTotal, { stage: STAGE })?.value,
    ).toBe(2 * TOTAL);
    expect(
      findCounter(obs.metrics, TRANSPORT_METRIC_NAMES.messagesTotal, {
        stage: STAGE,
        status: "ok",
      })?.value,
    ).toBe(TOTAL);
    // Still exactly one log line per message, attempts recorded, latency summed
    // across the 3 handler calls (3 ms each on the stepping clock).
    const records = obs.records();
    expect(records).toHaveLength(TOTAL);
    expect(records[0]?.fields).toEqual({
      sequence: 0,
      status: "ok",
      attempts: 3,
      retriesUsed: 2,
      latencyMs: 9,
    });
  });

  test("a throwing handler becomes a single-attempt internal failure; the pipeline continues", async () => {
    const input = await loadedInput();
    input.close();
    const output = freshOutput();
    const obs = runnerObservability();
    const { clock, sleeps } = recordingRetryClock();
    const THROW_AT = 7;
    const handler = (msg: StageMessage): Promise<StageResult> => {
      if (msg.sequence === THROW_AT) return Promise.reject(new Error("handler bug"));
      return okHandler(msg);
    };
    const runner = new StageRunner(
      input,
      output,
      {
        stage: STAGE,
        handler,
        // Retries ARE allowed here — proving internal failures are never retried blindly.
        retry: { maxAttempts: 3, baseDelayMs: 5, backoffMultiplier: 2, clock },
        nowMs: steppingClock(3),
      },
      obs.options,
    );

    const running = runner.run();
    const received: StageMessage[] = [];
    for (let i = 0; i < TOTAL; i += 1) {
      received.push(await output.receive());
    }
    await running;

    // All 20 arrived in order; the pipeline did NOT stop at the bug.
    expect(received.map((m) => m.sequence)).toEqual(Array.from({ length: TOTAL }, (_, i) => i));
    // The thrown message: one attempt, terminal internal failure, no progress.
    const failed = received[THROW_AT];
    expect(failed?.payload).toMatchObject({
      status: "failed",
      retryable: false,
      errorClass: "internal",
      attempts: 1,
      retriesUsed: 0,
      stage: STAGE,
    });
    expect(failed?.watermark).toEqual(fixtureMessage(THROW_AT).watermark);
    // The messages after the bug still flowed and succeeded.
    for (const out of received.slice(THROW_AT + 1)) {
      expect((out.payload as RunnerOutcome).status).toBe("ok");
      expect(out.watermark).toEqual(expectedWatermarkAfter(out.sequence));
    }
    // Nothing was retryable-slept: the throwing handler is never retried.
    expect(sleeps).toEqual([]);
    // Metrics: 19 ok, 1 failed, 1 internal failure, zero retries.
    expect(
      findCounter(obs.metrics, TRANSPORT_METRIC_NAMES.messagesTotal, {
        stage: STAGE,
        status: "ok",
      })?.value,
    ).toBe(TOTAL - 1);
    expect(
      findCounter(obs.metrics, TRANSPORT_METRIC_NAMES.messagesTotal, {
        stage: STAGE,
        status: "failed",
      })?.value,
    ).toBe(1);
    expect(
      findCounter(obs.metrics, TRANSPORT_METRIC_NAMES.failuresTotal, {
        stage: STAGE,
        errorClass: "internal",
      })?.value,
    ).toBe(1);
    expect(
      findCounter(obs.metrics, TRANSPORT_METRIC_NAMES.retriesTotal, { stage: STAGE }),
    ).toBeUndefined();
    // One log line per message still; the failed line carries errorClass.
    const records = obs.records();
    expect(records).toHaveLength(TOTAL);
    const failedRecord = records.find((record) => record.fields?.sequence === THROW_AT);
    expect(failedRecord?.fields).toEqual({
      sequence: THROW_AT,
      status: "failed",
      attempts: 1,
      retriesUsed: 0,
      latencyMs: 3,
      errorClass: "internal",
    });
  });

  test("concurrency 3: every message arrives (order NOT asserted) with per-message watermarks", async () => {
    const input = await loadedInput();
    input.close();
    const output = freshOutput();
    const obs = runnerObservability();
    let handlerCalls = 0;
    const runner = new StageRunner(
      input,
      output,
      {
        stage: STAGE,
        handler: (msg) => {
          handlerCalls += 1;
          return okHandler(msg);
        },
        concurrency: 3,
        nowMs: steppingClock(3),
      },
      obs.options,
    );

    const running = runner.run();
    const received: StageMessage[] = [];
    for (let i = 0; i < TOTAL; i += 1) {
      received.push(await output.receive());
    }
    await running;

    // All 20 arrived exactly once — arrival order is intentionally not asserted.
    const sequences = received.map((m) => m.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: TOTAL }, (_, i) => i));
    expect(handlerCalls).toBe(TOTAL);
    // Each output message carries ITS OWN watermarkAfter, whatever the order.
    for (const out of received) {
      expect(out.watermark).toEqual(expectedWatermarkAfter(out.sequence));
      expect((out.payload as RunnerOutcome).attempts).toBe(1);
    }
    // One log line per message, still exactly.
    expect(obs.records()).toHaveLength(TOTAL);
    // In-flight drain under concurrency: orderly shutdown closes the output.
    await expect(output.receive()).rejects.toThrow(ChannelClosedError);
  });

  test("invalid StageSpec fails loud at construction", () => {
    const input = new BoundedChannel(
      { capacity: 1, policy: "block" },
      { logger: silentChannelLogger() },
    );
    const output = new BoundedChannel(
      { capacity: 1, policy: "block" },
      { logger: silentChannelLogger() },
    );
    expect(
      () =>
        new StageRunner(input, output, {
          stage: "",
          handler: okHandler,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new StageRunner(input, output, {
          stage: STAGE,
          handler: okHandler,
          concurrency: 0,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new StageRunner(input, output, {
          stage: STAGE,
          handler: okHandler,
          retry: { maxAttempts: 0, baseDelayMs: 1, backoffMultiplier: 1 },
        }),
    ).toThrow(RangeError);
  });
});
