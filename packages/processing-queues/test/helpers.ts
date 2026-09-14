/**
 * Shared deterministic fixtures for the W302 test suite.
 *
 * Harness rules (docs/testing/HARNESS.md): no `Math.random`, no `Date.now`,
 * no `new Date` — every time is an explicit constant (TEST_EPOCH_MS for log
 * timestamps via the injected logger clock, VirtualProcessingClock for
 * processing time); async waiting is microtask draining only (no real
 * timers). Payloads are plain deterministic objects; byte sizes are
 * explicit and deterministic.
 */
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { LogRecord, LoggerOptions } from "@sporta/observability";
import type { StageMessage } from "@sporta/contracts";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { expect } from "bun:test";
import { ProcessingPipeline } from "../src/pipeline";
import { VirtualProcessingClock } from "../src/clock";
import type { ProcessingClock } from "../src/clock";
import type { PipelineSegment } from "../src/segment";
import type {
  PipelineStageSpec,
  ProcessingObservability,
  StageOutcome,
  StageQueueSpec,
  StageStats,
  PipelineResult,
} from "../src/types";
import type { RetryOptions } from "@sporta/transport";
import type { BoundedChannel } from "@sporta/transport";

/** One deterministic segment: payload `{ value: n }`, byteSize explicit. */
export function segment(
  key: string,
  watermarkMs: number,
  value: number = 0,
  byteSize: number = 12,
): PipelineSegment {
  return {
    idempotencyKey: key,
    watermark: { watermarkMs, sequence: 0 },
    byteSize,
    payload: { value },
  };
}

/** A segment whose payload is fully caller-authored. */
export function payloadSegment(
  key: string,
  watermarkMs: number,
  payload: unknown,
  byteSize: number,
): PipelineSegment {
  return {
    idempotencyKey: key,
    watermark: { watermarkMs, sequence: 0 },
    byteSize,
    payload,
  };
}

// ---------------------------------------------------------------------------
// Stage builders
// ---------------------------------------------------------------------------

/** An identity stage: the segment passes through untouched (same object). */
export function identityStage(stage: string, retry?: RetryOptions): PipelineStageSpec {
  return {
    stage,
    transform: async (seg: PipelineSegment): Promise<StageOutcome> => ({
      status: "emitted",
      segment: seg,
    }),
    ...(retry === undefined ? {} : { retry }),
  };
}

/** An identity stage that yields to the microtask queue `ticks` times. */
export function slowIdentityStage(
  stage: string,
  ticks: number,
  retry?: RetryOptions,
): PipelineStageSpec {
  return {
    stage,
    transform: async (seg: PipelineSegment): Promise<StageOutcome> => {
      await drainMicrotasks(ticks);
      return { status: "emitted", segment: seg };
    },
    ...(retry === undefined ? {} : { retry }),
  };
}

/**
 * A transforming stage: maps the payload (`{ ...payload, [marker]: true }`)
 * while carrying the idempotency key + watermark VERBATIM — the verbatim
 * proof shape (payload transforms, timing does not).
 */
export function markingStage(stage: string, marker: string): PipelineStageSpec {
  return {
    stage,
    transform: async (seg: PipelineSegment): Promise<StageOutcome> => {
      const payload = seg.payload as Record<string, unknown>;
      return {
        status: "emitted",
        segment: {
          idempotencyKey: seg.idempotencyKey,
          watermark: seg.watermark,
          byteSize: seg.byteSize,
          payload: { ...payload, [marker]: true },
        },
      };
    },
  };
}

/** A scripted failure: fail `times` invocations, then succeed. */
export interface ScriptedFailure {
  retryable: boolean;
  errorClass: string;
  message: string;
  times: number;
}

/**
 * A stage whose transform fails the first `times` invocations for the keyed
 * segments (with the scripted classification), then emits the segment
 * verbatim. Every invocation is counted, observable via `calls(key)`.
 */
export function scriptedStage(
  stage: string,
  failures: Record<string, ScriptedFailure>,
  retry?: RetryOptions,
): { spec: PipelineStageSpec; calls: (key: string) => number } {
  const counts = new Map<string, number>();
  return {
    spec: {
      stage,
      transform: async (seg: PipelineSegment): Promise<StageOutcome> => {
        const seen = counts.get(seg.idempotencyKey) ?? 0;
        counts.set(seg.idempotencyKey, seen + 1);
        const script = failures[seg.idempotencyKey];
        if (script !== undefined && seen < script.times) {
          return {
            status: "failed",
            retryable: script.retryable,
            errorClass: script.errorClass,
            message: script.message,
          };
        }
        return { status: "emitted", segment: seg };
      },
      ...(retry === undefined ? {} : { retry }),
    },
    calls: (key: string) => counts.get(key) ?? 0,
  };
}

/** A stage that always fails (classification caller-chosen). */
export function alwaysFailingStage(
  stage: string,
  failure: { retryable: boolean; errorClass: string; message: string },
  retry?: RetryOptions,
): PipelineStageSpec {
  return {
    stage,
    transform: async (): Promise<StageOutcome> => ({
      status: "failed",
      retryable: failure.retryable,
      errorClass: failure.errorClass,
      message: failure.message,
    }),
    ...(retry === undefined ? {} : { retry }),
  };
}

// ---------------------------------------------------------------------------
// Wiring helpers
// ---------------------------------------------------------------------------

/** Captured observability: collected log lines + a readable metrics registry. */
export function capturedObservability(): {
  options: ProcessingObservability;
  metrics: MetricsRegistry;
  records: () => LogRecord[];
  lines: () => string[];
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
    lines: () => [...lines],
  };
}

/**
 * A clock wrapper that RECORDS every sleep duration it is asked to sleep —
 * the deterministic-backoff evidence (W104 pure arithmetic pinned exactly).
 */
export class RecordingClock implements ProcessingClock {
  readonly sleeps: number[] = [];

  constructor(private readonly inner: VirtualProcessingClock) {}

  now(): number {
    return this.inner.now();
  }

  async sleep(durationMs: number): Promise<void> {
    this.sleeps.push(durationMs);
    await this.inner.sleep(durationMs);
  }
}

/** The full pipeline wiring (fresh objects per call). */
export function wiredPipeline(input: {
  sessionId?: string;
  stages: PipelineStageSpec[];
  queue?: { capacity?: number; policy?: "block" | "reject" | "drop-oldest"; maxBytes?: number };
  queues?: Array<{
    capacity?: number;
    policy?: "block" | "reject" | "drop-oldest";
    maxBytes?: number;
  }>;
  clock?: ProcessingClock;
  checkpointEveryMs?: number;
  observability?: ProcessingObservability;
  limits?: { maxDeadLetterEntries?: number; maxAdmittedSegments?: number };
  resourceBudget?: { maxMemoryMb?: number; maxGpuMs?: number };
}): {
  pipeline: ProcessingPipeline;
  clock: ProcessingClock;
  output: BoundedChannel<StageMessage>;
} {
  const clock: ProcessingClock = input.clock ?? new VirtualProcessingClock(0);
  const defaults = { capacity: 16, policy: "block" } as const;
  const uniform = input.queue ?? {};
  const perQueue: Array<{
    capacity?: number;
    policy?: "block" | "reject" | "drop-oldest";
    maxBytes?: number;
  }> = input.queues ?? Array.from({ length: input.stages.length + 1 }, () => ({}));
  const queues: StageQueueSpec[] = perQueue.map((q) => ({
    capacity: q.capacity ?? uniform.capacity ?? defaults.capacity,
    policy: q.policy ?? uniform.policy ?? defaults.policy,
    ...((q.maxBytes ?? uniform.maxBytes) === undefined
      ? {}
      : { maxBytes: q.maxBytes ?? uniform.maxBytes }),
  }));
  const pipeline = new ProcessingPipeline({
    sessionId: input.sessionId ?? "sess-w302",
    stages: input.stages,
    queues,
    clock,
    ...(input.checkpointEveryMs === undefined
      ? {}
      : { checkpointEveryMs: input.checkpointEveryMs }),
    ...(input.observability === undefined ? {} : { observability: input.observability }),
    ...(input.limits === undefined
      ? {}
      : {
          limits: {
            maxDeadLetterEntries: input.limits.maxDeadLetterEntries ?? 1_000,
            maxAdmittedSegments: input.limits.maxAdmittedSegments ?? 1_000_000,
          },
        }),
    ...(input.resourceBudget === undefined ? {} : { resourceBudget: input.resourceBudget }),
  });
  return { pipeline, clock, output: pipeline.outputChannel() };
}

// ---------------------------------------------------------------------------
// Async draining helpers (microtask-only, deterministic)
// ---------------------------------------------------------------------------

/** Yields to the microtask queue `ticks` times. */
export async function drainMicrotasks(ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
  }
}

/**
 * Polls `condition` on the microtask queue until true (bounded by `maxTicks`
 * — returns whether the condition held, so tests fail loudly instead of
 * hanging when the expected state never settles).
 */
export async function until(condition: () => boolean, maxTicks: number = 50_000): Promise<boolean> {
  let ticks = 0;
  while (!condition() && ticks < maxTicks) {
    await Promise.resolve();
    ticks += 1;
  }
  return condition();
}

/**
 * Consumes the output channel until closed and drained, optionally slowly
 * (microtask pauses between receives). Returns the received messages.
 */
export async function drainOutput(
  channel: BoundedChannel<StageMessage>,
  slowTicks: number = 0,
  onEach?: (message: StageMessage) => void,
): Promise<StageMessage[]> {
  const received: StageMessage[] = [];
  for (;;) {
    try {
      const message = await channel.receive();
      received.push(message);
      onEach?.(message);
      if (slowTicks > 0) await drainMicrotasks(slowTicks);
    } catch {
      return received; // ChannelClosedError: closed and drained
    }
  }
}

/** Starts a background consumer collecting into `into` until closed+drained. */
export function backgroundConsumer(
  channel: BoundedChannel<StageMessage>,
  into: StageMessage[],
): { done: Promise<StageMessage[]>; count: () => number } {
  const done = (async () => {
    for (;;) {
      try {
        into.push(await channel.receive());
      } catch {
        return into;
      }
    }
  })();
  return { done, count: () => into.length };
}

/** The segment payload of a received stage message. */
export function payloadOf(message: StageMessage): PipelineSegment {
  return message.payload as PipelineSegment;
}

// ---------------------------------------------------------------------------
// Balance assertions (the per-test exact-accounting proof)
// ---------------------------------------------------------------------------

/**
 * The per-test EXACT balance assertion: every bucket spelled out, the main
 * identity re-derived from the result, and `balanced === true`. The numbers
 * are the test's own expectations — the pipeline's runtime assertion is the
 * same check, this pins it.
 */
export function expectBalanced(
  result: PipelineResult,
  expected: {
    segmentsIn: number;
    segmentsOut: number;
    rejected?: number;
    duplicates?: number;
    deadLettered?: number;
    abandoned?: number;
    dropped?: number;
  },
): void {
  const rejected = expected.rejected ?? 0;
  const duplicates = expected.duplicates ?? 0;
  const deadLettered = expected.deadLettered ?? 0;
  const abandoned = expected.abandoned ?? 0;
  const dropped = expected.dropped ?? 0;
  expect(result.balanced).toBe(true);
  expect(result.stats.segmentsIn).toBe(expected.segmentsIn);
  expect(result.stats.segmentsOut).toBe(expected.segmentsOut);
  expect(result.stats.rejected).toBe(rejected);
  expect(result.stats.duplicates).toBe(duplicates);
  expect(result.stats.deadLettered).toBe(deadLettered);
  expect(result.stats.abandoned).toBe(abandoned);
  expect(result.stats.dropped).toBe(dropped);
  // The identity, re-derived from the test's own numbers:
  expect(expected.segmentsOut + rejected + duplicates + deadLettered + abandoned + dropped).toBe(
    expected.segmentsIn,
  );
  // …and from the pipeline's own counters:
  expect(
    result.stats.segmentsOut +
      result.stats.rejected +
      result.stats.duplicates +
      result.stats.deadLettered +
      result.stats.abandoned +
      result.stats.dropped,
  ).toBe(result.stats.segmentsIn);
}

/** Sum of a stage-stats field across stages (small evidence helper). */
export function sumStages(stages: StageStats[], field: keyof StageStats): number {
  return stages.reduce((sum, stage) => sum + (stage[field] as number), 0);
}
