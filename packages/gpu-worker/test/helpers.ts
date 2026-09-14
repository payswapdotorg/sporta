/**
 * Shared deterministic fixtures for the W303 test suite.
 *
 * Harness rules (docs/testing/HARNESS.md): no `Math.random`, no `Date.now`,
 * no `new Date` — every time is an explicit constant (TEST_EPOCH_MS for log
 * timestamps via the injected logger clock, VirtualGpuClock for protocol
 * time); async waiting is microtask draining only (no real timers). Job
 * payloads are opaque deterministic strings; executor scripts are authored
 * step lists.
 */
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { LogRecord, Logger, LoggerOptions } from "@sporta/observability";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { expect } from "bun:test";
import { VirtualGpuClock } from "../src/clock";
import type { GpuClock } from "../src/clock";
import { GpuJobDispatcher } from "../src/dispatcher";
import type { GpuJobEnvelope, GpuJobRequirements } from "../src/job";
import { GpuWorker } from "../src/worker";
import type { GpuWorkerOptions } from "../src/worker";
import type {
  GpuDispatcherOptions,
  GpuDispatcherPort,
  GpuDispatchStats,
  GpuExecutorOutcome,
  GpuHeartbeat,
  GpuJobClaim,
  GpuJobExecutor,
  GpuObservability,
  GpuReportAck,
  GpuAttemptReport,
  GpuWorkerCapabilities,
} from "../src/types";

// ---------------------------------------------------------------------------
// Envelope builders
// ---------------------------------------------------------------------------

/** One deterministic job envelope (all fields explicit, no defaults hidden). */
export function job(jobId: string, overrides: Partial<GpuJobEnvelope> = {}): GpuJobEnvelope {
  return {
    jobId,
    idempotencyKey: `key-${jobId}`,
    kind: "encode",
    payloadRef: `ref-${jobId}`,
    priority: 0,
    deadlineMs: 10_000,
    ...overrides,
  };
}

/** One deterministic capabilities declaration (all fields explicit). */
export function capabilities(
  workerId: string,
  overrides: Partial<GpuWorkerCapabilities> = {},
): GpuWorkerCapabilities {
  return {
    workerId,
    maxConcurrentJobs: 2,
    memoryMb: 4_096,
    modelClasses: ["encode", "detect"],
    heartbeatIntervalMs: 100,
    ...overrides,
  };
}

/** Declared requirements (both fields explicit). */
export function requirements(overrides: Partial<GpuJobRequirements> = {}): GpuJobRequirements {
  return { memoryMb: 1_024, modelClass: "encode", ...overrides };
}

// ---------------------------------------------------------------------------
// Scripted executors (the vendor-neutral seam, deterministically driven)
// ---------------------------------------------------------------------------

/** One scripted executor step. */
export interface ScriptStep {
  /** Clock time the invocation consumes (default 0 — instantaneous). */
  sleepMs?: number;
  /** `"succeed"` with `output`, a classified failure, or `"throw"`. */
  result: "succeed" | "throw" | { errorClass: string; message: string; retryable: boolean };
  /** Present iff `result === "succeed"`. */
  output?: unknown;
}

/**
 * An executor whose behavior per JOB is an authored step list: each
 * invocation consumes the step's `sleepMs` of clock time and produces the
 * step's result. Steps run in order; exhaustion THROWS (a loud test failure
 * — the suite never silently repeats a step).
 */
export function scriptedExecutor(
  clock: GpuClock,
  script: Record<string, ScriptStep[]>,
): { executor: GpuJobExecutor; invocations: (jobId: string) => number } {
  const calls = new Map<string, number>();
  return {
    executor: {
      async execute(job: GpuJobEnvelope): Promise<GpuExecutorOutcome> {
        const seen = calls.get(job.jobId) ?? 0;
        calls.set(job.jobId, seen + 1);
        const steps = script[job.jobId];
        if (steps === undefined || seen >= steps.length) {
          throw new Error(
            `scriptedExecutor has no step ${seen} for job '${job.jobId}' — the test script is wrong`,
          );
        }
        const step = steps[seen]!;
        const sleepMs = step.sleepMs ?? 0;
        if (sleepMs > 0) await clock.sleep(sleepMs);
        if (step.result === "throw") {
          throw new Error(`scripted executor fault for job '${job.jobId}' (step ${seen})`);
        }
        if (step.result === "succeed") {
          return { status: "succeeded", output: step.output ?? { from: job.jobId } };
        }
        return { status: "failed", ...step.result };
      },
    },
    invocations: (jobId: string): number => calls.get(jobId) ?? 0,
  };
}

/**
 * An executor whose invocations park until the TEST settles them — the
 * never-settling / late-report fixture. `settle()` resolves the OLDEST
 * parked invocation; `parked()` counts unsettled invocations.
 */
export function deferredExecutor(): {
  executor: GpuJobExecutor;
  settle: (outcome: GpuExecutorOutcome) => void;
  parked: () => number;
} {
  const waiters: Array<(outcome: GpuExecutorOutcome) => void> = [];
  return {
    executor: {
      execute(): Promise<GpuExecutorOutcome> {
        return new Promise<GpuExecutorOutcome>((resolve) => {
          waiters.push(resolve);
        });
      },
    },
    settle: (outcome: GpuExecutorOutcome): void => {
      const resolve = waiters.shift();
      if (resolve === undefined) {
        throw new Error("deferredExecutor.settle() with no parked invocation");
      }
      resolve(outcome);
    },
    parked: (): number => waiters.length,
  };
}

// ---------------------------------------------------------------------------
// Observability capture
// ---------------------------------------------------------------------------

/** Captured observability: collected log lines + a readable metrics registry. */
export function capturedObservability(): {
  logger: Logger;
  metrics: MetricsRegistry;
  records: () => LogRecord[];
  lines: () => string[];
} {
  const lines: string[] = [];
  const loggerOptions: LoggerOptions = {
    sink: (line) => lines.push(line),
    now: () => TEST_EPOCH_MS,
  };
  const logger = createLogger(loggerOptions);
  const metrics = new MetricsRegistry();
  return {
    logger,
    metrics,
    records: () => lines.map((line) => JSON.parse(line) as LogRecord),
    lines: () => [...lines],
  };
}

/**
 * A clock wrapper that RECORDS every sleep duration it is asked to consume —
 * the deterministic-backoff evidence (W104 pure arithmetic pinned exactly).
 * `advance`/`advanceTo`/`pendingWaiters` delegate to the inner virtual clock
 * (the explicit fixture tools — advances are NOT sleeps and are not recorded).
 */
export class RecordingGpuClock implements GpuClock {
  readonly sleeps: number[] = [];

  constructor(private readonly inner: VirtualGpuClock) {}

  now(): number {
    return this.inner.now();
  }

  async sleep(durationMs: number): Promise<void> {
    this.sleeps.push(durationMs);
    await this.inner.sleep(durationMs);
  }

  waitUntil(untilMs: number): Promise<void> {
    return this.inner.waitUntil(untilMs);
  }

  /** Explicit fixture advance (delegates; not recorded as a sleep). */
  advance(ms: number): void {
    this.inner.advance(ms);
  }

  /** Explicit fixture advance-to (delegates; not recorded as a sleep). */
  advanceTo(untilMs: number): void {
    this.inner.advanceTo(untilMs);
  }

  /** Count of parked `waitUntil` waiters (test observability). */
  get pendingWaiters(): number {
    return this.inner.pendingWaiters;
  }
}

// ---------------------------------------------------------------------------
// Wiring helpers
// ---------------------------------------------------------------------------

/** Common dispatcher wiring (fresh objects per call). */
export function wiredDispatcher(input: {
  dispatcherId?: string;
  leaseMs?: number;
  staleAfterMs?: number;
  defaultMaxAttempts?: number;
  limits?: Partial<{ maxQueuedJobs: number; maxAdmittedJobs: number; maxDlqEntries: number }>;
  observability?: GpuObservability;
}): { dispatcher: GpuJobDispatcher; clock: VirtualGpuClock } {
  const clock = new VirtualGpuClock(0);
  const options: GpuDispatcherOptions = {
    dispatcherId: input.dispatcherId ?? "gpu-test",
    clock,
    ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
    ...(input.staleAfterMs === undefined ? {} : { staleAfterMs: input.staleAfterMs }),
    ...(input.defaultMaxAttempts === undefined
      ? {}
      : { defaultMaxAttempts: input.defaultMaxAttempts }),
    ...(input.limits === undefined ? {} : { limits: input.limits }),
    ...(input.observability === undefined ? {} : { observability: input.observability }),
  };
  const dispatcher = new GpuJobDispatcher(options);
  dispatcher.start();
  return { dispatcher, clock };
}

/** One GpuWorker wired to a dispatcher with a scripted executor. */
export function wiredWorker(input: {
  capabilities: GpuWorkerCapabilities;
  executor: GpuJobExecutor;
  port: GpuDispatcherPort;
  clock: GpuClock;
  executorRetry?: GpuWorkerOptions["executorRetry"];
}): GpuWorker {
  return new GpuWorker({
    capabilities: input.capabilities,
    executor: input.executor,
    port: input.port,
    clock: input.clock,
    ...(input.executorRetry === undefined ? {} : { executorRetry: input.executorRetry }),
  });
}

/**
 * A port proxy that records every call — worker-side protocol evidence
 * (heartbeat payloads, claim grants, report payloads) without changing
 * dispatcher behavior.
 */
export function recordingPort(dispatcher: GpuDispatcherPort): {
  port: GpuDispatcherPort;
  heartbeats: Array<{ workerId: string; heartbeat: GpuHeartbeat }>;
  claims: Array<{ workerId: string; claim: GpuJobClaim | undefined }>;
  reports: GpuAttemptReport[];
} {
  const heartbeats: Array<{ workerId: string; heartbeat: GpuHeartbeat }> = [];
  const claims: Array<{ workerId: string; claim: GpuJobClaim | undefined }> = [];
  const reports: GpuAttemptReport[] = [];
  return {
    port: {
      registerWorker: (caps: GpuWorkerCapabilities) => dispatcher.registerWorker(caps),
      heartbeat: async (workerId: string, heartbeat: GpuHeartbeat) => {
        heartbeats.push({ workerId, heartbeat });
        return await dispatcher.heartbeat(workerId, heartbeat);
      },
      claimJob: async (workerId: string) => {
        const claim = await dispatcher.claimJob(workerId);
        claims.push({ workerId, claim });
        return claim;
      },
      reportResult: async (report: GpuAttemptReport): Promise<GpuReportAck> => {
        reports.push(report);
        return await dispatcher.reportResult(report);
      },
    },
    heartbeats,
    claims,
    reports,
  };
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
export async function until(
  condition: () => boolean,
  maxTicks: number = 100_000,
): Promise<boolean> {
  let ticks = 0;
  while (!condition() && ticks < maxTicks) {
    await Promise.resolve();
    ticks += 1;
  }
  return condition();
}

// ---------------------------------------------------------------------------
// Balance assertions (the per-test exact-accounting proof)
// ---------------------------------------------------------------------------

/**
 * The per-test EXACT balance assertion: every bucket spelled out, the W303
 * identity re-derived from the test's own numbers AND from the stats — the
 * dispatcher's runtime assertion is the same check, this pins it.
 */
export function expectGpuBalanced(
  stats: GpuDispatchStats,
  expected: {
    jobsSubmitted: number;
    admitted?: number;
    duplicates?: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    deadLettered: number;
    inFlight?: number;
  },
): void {
  const duplicates = expected.duplicates ?? 0;
  const admitted = expected.admitted ?? expected.jobsSubmitted - duplicates;
  const inFlight = expected.inFlight ?? 0;
  expect(stats.jobsSubmitted).toBe(expected.jobsSubmitted);
  expect(stats.admitted).toBe(admitted);
  expect(stats.duplicates).toBe(duplicates);
  expect(stats.succeeded).toBe(expected.succeeded);
  expect(stats.failed).toBe(expected.failed);
  expect(stats.cancelled).toBe(expected.cancelled);
  expect(stats.deadLettered).toBe(expected.deadLettered);
  expect(stats.inFlight).toBe(inFlight);
  // The identity, re-derived from the test's own numbers:
  expect(
    expected.succeeded + expected.failed + expected.cancelled + expected.deadLettered + inFlight,
  ).toBe(admitted);
  // …and from the stats' own counters:
  expect(
    stats.succeeded + stats.failed + stats.cancelled + stats.deadLettered + stats.inFlight,
  ).toBe(stats.admitted);
}
