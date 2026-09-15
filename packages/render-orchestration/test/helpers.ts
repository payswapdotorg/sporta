/**
 * Shared deterministic fixtures for the W304 test suite.
 *
 * Harness rules (docs/testing/HARNESS.md): no `Math.random`, no `Date.now`,
 * no `new Date` — every time is an explicit constant (TEST_EPOCH_MS for log
 * timestamps via the injected logger clock, the W303 `VirtualGpuClock` for
 * protocol time); async waiting is microtask draining and the virtual clock
 * only (no real timers). The SWM fixture is a REAL W006 engine observed
 * through the REAL W402 consumer seams (`stateAt` + `eventWindow`) — the
 * exact construction the W502 renderer integration tests drive — so the
 * orchestrator consumes genuine `WorldSnapshot`/`WorldEventStreamEntry`
 * documents with verbatim watermarks.
 */
import {
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
  SCHEMA_VERSION,
} from "@sporta/contracts";
import type { RenderRequest, Watermark } from "@sporta/contracts";
import type { GpuClock } from "@sporta/gpu-worker";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { CorrelationContext, Logger, LogRecord, LoggerOptions } from "@sporta/observability";
import type { AnimeRenderOutput } from "@sporta/renderer-anime";
import { TEST_EPOCH_MS, buildRenderRequest } from "@sporta/testing";
import { eventWindow, stateAt } from "@sporta/temporal";
import { WorldModelEngine } from "@sporta/world-model";
import type { FootballState } from "@sporta/world-model";
import { expect } from "bun:test";
import { createAnimeRenderBatchExecutor } from "../src/executor";
import { RenderOrchestrator } from "../src/orchestrator";
import type {
  DegradationPolicy,
  RenderBatch,
  RenderBatchExecutor,
  RenderBatchOutcome,
  RenderOrchestrationLimits,
  RenderOrchestrationResult,
  RenderOutputRecord,
  SwmUpdate,
  SwmUpdateStore,
} from "../src/types";

// ---------------------------------------------------------------------------
// Observability capture (the W303 helper pattern, verbatim posture)
// ---------------------------------------------------------------------------

/** Captured logger + metrics: every line and series recorded for asserts. */
export function capturedObservability(): {
  logger: Logger;
  metrics: MetricsRegistry;
  records: () => LogRecord[];
  lines: () => string[];
  correlation: CorrelationContext;
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
    correlation: {
      sessionId: "sess-render-story",
      correlationId: "corr-render-story",
      traceId: "trace-render-story",
    },
  };
}

// ---------------------------------------------------------------------------
// The SWM story (a REAL W006 engine through the W402 seams)
// ---------------------------------------------------------------------------

/** Options for the deterministic moving fixture (p1 advances, b1 trails). */
export interface SwmStoryOptions {
  /** Seconds of story — one update per second (default 6). */
  seconds?: number;
  /** Session id for the engine and every derived document. */
  sessionId?: string;
  /** Declared payload bytes per update (default 2_048). */
  byteSize?: number;
  /** Extra update to append with an authored byteSize (the never-fits knob). */
  extra?: { watermarkMs: number; byteSize: number };
}

/** The authored story: the engine plus its derived incremental updates. */
export interface SwmStory {
  engine: WorldModelEngine;
  updates: SwmUpdate[];
}

/** Builds the deterministic story and its per-second SWM updates. */
export function buildSwmStory(options: SwmStoryOptions = {}): SwmStory {
  const seconds = options.seconds ?? 6;
  const sessionId = options.sessionId ?? "sess-render-story";
  const byteSize = options.byteSize ?? 2_048;
  const football: FootballState = {
    pitch: {
      lengthAxisMeters: PITCH_LENGTH_AXIS_METERS,
      widthAxisMeters: PITCH_WIDTH_AXIS_METERS,
      origin: PITCH_ORIGIN,
      axes: PITCH_AXES,
    },
    clock: { period: "first-half", clockMs: 0, stoppage: false },
    score: {
      home: 0,
      away: 0,
      status: { status: "uncertain", value: "provisional", confidence: 0.6 },
    },
    possession: { status: "uncertain", value: { entityId: "p1" }, confidence: 0.7 },
    eventTaxonomyVersion: "v1",
  };
  const engine = WorldModelEngine.create(sessionId, { now: () => TEST_EPOCH_MS, football });
  const updates: SwmUpdate[] = [];
  for (let second = 1; second <= seconds; second += 1) {
    const t = second * 1_000;
    engine.upsertEntity({
      entityId: "p1",
      kind: "participant",
      version: 1,
      lastEventTimeMs: t,
      state: { pitchPosition: { status: "known", value: { x: 50 + second, y: 34 } } },
    });
    engine.upsertEntity({
      entityId: "b1",
      kind: "ball",
      version: 1,
      lastEventTimeMs: t,
      state: {
        pitchPosition: {
          status: "uncertain",
          value: { x: 50 + second - 0.5, y: 34.2 },
          confidence: 0.9,
        },
      },
    });
    if (t === 2_000) {
      engine.applyEvent({
        eventId: "evt-pass",
        sessionId,
        schemaVersion: SCHEMA_VERSION,
        eventTypeRef: "football/v1/pass",
        interval: { startTimeMs: 1_500, endTimeMs: 1_500 },
        eventTimeMs: 1_500,
        provenance: "DERIVED",
        evidence: { observationIds: ["obs-1"] },
      });
    }
    if (t === 6_000) {
      engine.applyEvent({
        eventId: "evt-goal",
        sessionId,
        schemaVersion: SCHEMA_VERSION,
        eventTypeRef: "football/v1/goal",
        interval: { startTimeMs: 5_500, endTimeMs: 5_500 },
        eventTimeMs: 5_500,
        provenance: "DERIVED",
        confidence: 0.95,
        evidence: { observationIds: ["obs-2"] },
      });
    }
    // The W402 consumer seams, exactly as a real store author would drive
    // them: the at-T snapshot (verbatim watermark) plus the events of the
    // update's own window (input order preserved).
    const snapshot = stateAt(engine, t).snapshot;
    const events = eventWindow(engine.eventsSince(0), {
      fromMs: t === 1_000 ? 0 : (second - 1) * 1_000,
      toMs: t,
    });
    updates.push({
      sequence: updates.length,
      watermark: { ...snapshot.watermark },
      snapshot,
      events: [...events],
      byteSize,
    });
  }
  if (options.extra !== undefined && seconds >= 1) {
    // One authored EXTRA update at a far-future watermark: its snapshot is
    // the story's final state re-observed at the authored time (the engine
    // has no more upserts — the snapshot is genuinely the best-known state
    // at that position, exactly what a real store would serve).
    const t = options.extra.watermarkMs;
    const snapshot = stateAt(engine, seconds * 1_000).snapshot;
    updates.push({
      sequence: updates.length,
      watermark: { watermarkMs: t, sequence: snapshot.watermark.sequence },
      snapshot,
      events: [],
      byteSize: options.extra.byteSize,
    });
  }
  return { engine, updates };
}

/**
 * One authored growth step: once the clock reaches `atMs`, the updates
 * through index `upToIndex` (inclusive) are visible.
 */
export interface GrowthStep {
  atMs: number;
  upToIndex: number;
}

/**
 * The fixture store: a growing, sequence-anchored `SwmUpdateStore` over
 * authored updates. WITHOUT a growth schedule every update is visible and
 * the stream is complete (the burst fixtures). WITH a schedule, updates
 * reveal LAZILY as the (shared, injected) clock crosses each step's time —
 * every query first reveals, so the consumer's `waitUntil`-then-query cycle
 * observes growth deterministically.
 *
 * `stalled: true` authorizes a schedule whose final step does NOT reveal the
 * whole stream (the deliberately-stalled posture: neither complete nor
 * growing — the honest-`stopped` fixtures). Default `false`: an incomplete
 * schedule is a test-authoring mistake and refuses loudly.
 *
 * The store COUNTS every `updatesAfter` invocation and the total entries it
 * materialized across all queries — the incremental-consumption evidence:
 * each query returns a bounded slice (`limit` at most), and the per-query
 * sums total exactly the entries the consumer actually consumed.
 */
export class FixtureSwmStore implements SwmUpdateStore {
  private readonly all: readonly SwmUpdate[];
  private readonly growth: readonly GrowthStep[];
  private readonly clock: GpuClock | undefined;
  private revealed: number;
  queryCount = 0;
  materializedEntries = 0;

  constructor(
    updates: readonly SwmUpdate[],
    growth?: readonly GrowthStep[],
    clock?: GpuClock,
    options: { stalled?: boolean } = {},
  ) {
    this.all = [...updates];
    this.growth = growth ?? [];
    this.clock = clock;
    this.revealed = this.growth.length === 0 ? this.all.length : 0;
    for (const step of this.growth) {
      if (!Number.isFinite(step.atMs) || step.upToIndex < 0 || step.upToIndex >= this.all.length) {
        throw new RangeError(`invalid growth step: ${JSON.stringify(step)}`);
      }
    }
    for (let i = 1; i < this.growth.length; i += 1) {
      if (this.growth[i]!.atMs <= this.growth[i - 1]!.atMs) {
        throw new RangeError("growth steps must have strictly increasing atMs");
      }
      if (this.growth[i]!.upToIndex <= this.growth[i - 1]!.upToIndex) {
        throw new RangeError("growth steps must reveal strictly more updates");
      }
    }
    const last = this.growth[this.growth.length - 1];
    if (!options.stalled && last !== undefined && last.upToIndex !== this.all.length - 1) {
      throw new RangeError(
        "the final growth step must reveal the whole stream " +
          "(pass { stalled: true } to author a deliberately-stalled store)",
      );
    }
  }

  /** Reveals every growth step whose time the clock has reached (lazy). */
  private revealUpToNow(): void {
    if (this.clock === undefined || this.growth.length === 0) return;
    const now = this.clock.now();
    while (this.nextStepIndex() < this.growth.length) {
      const step = this.growth[this.nextStepIndex()]!;
      if (step.atMs > now) break;
      this.revealed = step.upToIndex + 1;
    }
  }

  private nextStepIndex(): number {
    for (let i = 0; i < this.growth.length; i += 1) {
      if (this.growth[i]!.upToIndex + 1 > this.revealed) return i;
    }
    return this.growth.length;
  }

  /** Number of updates currently revealed (test observability). */
  get revealedCount(): number {
    this.revealUpToNow();
    return this.revealed;
  }

  availableWatermark(): Watermark {
    this.revealUpToNow();
    if (this.revealed === 0) return { watermarkMs: 0, sequence: 0 };
    return this.all[this.revealed - 1]!.watermark;
  }

  isComplete(): boolean {
    this.revealUpToNow();
    return this.revealed >= this.all.length;
  }

  updatesAfter(
    afterSequence: number,
    toMs: number,
    limit: number,
  ): { updates: SwmUpdate[]; more: boolean } {
    this.revealUpToNow();
    this.queryCount += 1;
    const updates: SwmUpdate[] = [];
    let more = false;
    for (let i = 0; i < this.revealed; i += 1) {
      const update = this.all[i]!;
      if (update.sequence > afterSequence && update.watermark.watermarkMs <= toMs) {
        if (updates.length >= limit) {
          more = true;
          break;
        }
        updates.push(update);
        this.materializedEntries += 1;
      }
    }
    return { updates, more };
  }

  hasUpdatesAfter(afterSequence: number): boolean {
    this.revealUpToNow();
    for (let i = 0; i < this.revealed; i += 1) {
      if (this.all[i]!.sequence > afterSequence) return true;
    }
    return false;
  }

  nextGrowthAtMs(): number | undefined {
    this.revealUpToNow();
    const index = this.nextStepIndex();
    if (index >= this.growth.length) return undefined;
    return this.growth[index]!.atMs;
  }
}

// ---------------------------------------------------------------------------
// Request template (the real @sporta/testing builder, anime-shaped)
// ---------------------------------------------------------------------------

/** The deterministic render request template for the anime plugin. */
export function animeRequest(sessionId: string): RenderRequest {
  return buildRenderRequest({
    sessionId,
    rendererId: "anime.prototype",
    rendererVersion: "0.1.0",
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: {
      resolution: { w: 1170, h: 880 },
      frameRate: 1,
      codec: "svg",
      container: "svg",
      latencyClass: "offline",
    },
    styleConfig: { styleId: "style-render-story", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: {
      canReferenceSourceFrames: true,
      canDeliverLive: false,
      canStoreDerivatives: true,
      canShare: false,
    },
    sourceFrameRefs: [],
  });
}

// ---------------------------------------------------------------------------
// Scripted render executors (deterministic failure/ordering fixtures)
// ---------------------------------------------------------------------------

/** One scripted executor step for one batch ordinal. */
export interface RenderScriptStep {
  /** Protocol-clock time the invocation consumes (default 0). */
  sleepMs?: number;
  /** `"succeed"` (render via the REAL anime plugin), a classified failure, or `"throw"`. */
  result: "succeed" | "throw" | { errorClass: string; message: string; retryable: boolean };
  /**
   * When `"succeed"`: the output to return (default: the REAL anime render
   * for the batch — the honest default; tests inject garbage here to pin the
   * output-validation path).
   */
  output?: unknown;
}

/**
 * A `RenderBatchExecutor` whose behavior per BATCH ORDINAL is an authored
 * step list: each invocation consumes the step's clock time, then produces
 * the step's result. Ordinals with NO authored steps (or after their steps
 * are exhausted in reprocess fixtures where the caller expects the real
 * render) fall through to the REAL anime render — the honest default; step
 * exhaustion only throws when steps WERE authored for the ordinal.
 */
export function scriptedRenderExecutor(
  clock: GpuClock,
  script: Record<number, RenderScriptStep[]>,
): { executor: RenderBatchExecutor; invocations: (ordinal: number) => number } {
  const calls = new Map<number, number>();
  const real = createAnimeRenderBatchExecutor();
  return {
    executor: {
      async execute(
        batch: RenderBatch,
        request: RenderRequest,
        context: { clock: GpuClock },
      ): Promise<RenderBatchOutcome> {
        const seen = calls.get(batch.ordinal) ?? 0;
        calls.set(batch.ordinal, seen + 1);
        const steps = script[batch.ordinal];
        if (steps !== undefined && seen >= steps.length) {
          throw new Error(
            `scriptedRenderExecutor exhausted its steps for batch ordinal ${batch.ordinal} ` +
              `(step ${seen}) — the test script is wrong`,
          );
        }
        const step = steps?.[seen];
        if (step === undefined) {
          return await real.execute(batch, request, context);
        }
        if ((step.sleepMs ?? 0) > 0) {
          await clock.sleep(step.sleepMs!);
        }
        if (step.result === "throw") {
          throw new Error(`scripted render fault for batch ${batch.batchId} (step ${seen})`);
        }
        if (step.result === "succeed") {
          if (step.output !== undefined) {
            // The orchestrator's assertAnimeRenderOutputShape is the trust
            // boundary over executor outputs BY DESIGN — a scripted garbage
            // output is how the tests simulate a LYING executor, so the seam's
            // declared type is asserted here (never trusted).
            return { status: "succeeded", output: step.output as AnimeRenderOutput };
          }
          return await real.execute(batch, request, context);
        }
        return { status: "failed", ...step.result };
      },
    },
    invocations: (ordinal: number): number => calls.get(ordinal) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Whole-orchestrator wiring (the per-test knobs, all explicit)
// ---------------------------------------------------------------------------

/** The knobs `wiredOrchestrator` passes through (everything else defaulted). */
export interface WiringOverrides {
  store: SwmUpdateStore;
  executor: RenderBatchExecutor;
  clock: GpuClock;
  limits?: Partial<RenderOrchestrationLimits>;
  degradation?: DegradationPolicy;
  backpressure?: "block" | "reject" | "drop-oldest";
  workers?: Array<{ workerId: string; maxConcurrentJobs: number }>;
  renderDeadlineMs?: number;
  leaseMs?: number;
  staleAfterMs?: number;
  executorRetry?: { maxAttempts: number; baseDelayMs: number; backoffMultiplier: number };
  onOutput?: (record: RenderOutputRecord) => Promise<void> | void;
  startMs?: number;
  sessionId?: string;
}

/** The default session id every helper wires (override per test). */
export const STORY_SESSION = "sess-render-story";

/**
 * Builds one orchestrator over the given wiring — every knob explicit, the
 * observability seams shared (captured lines + one metrics registry). The
 * caller invokes `start()` (some tests inspect the pre-start state first).
 */
export function wiredOrchestrator(
  overrides: WiringOverrides,
  observability: {
    logger: Logger;
    metrics: MetricsRegistry;
    correlation: CorrelationContext;
  },
): RenderOrchestrator {
  const sessionId = overrides.sessionId ?? STORY_SESSION;
  return new RenderOrchestrator({
    sessionId,
    store: overrides.store,
    renderExecutor: overrides.executor,
    renderRequest: animeRequest(sessionId),
    clock: overrides.clock,
    ...(overrides.limits === undefined ? {} : { limits: overrides.limits }),
    ...(overrides.degradation === undefined ? {} : { degradation: overrides.degradation }),
    ...(overrides.backpressure === undefined ? {} : { backpressure: overrides.backpressure }),
    ...(overrides.workers === undefined ? {} : { workers: overrides.workers }),
    ...(overrides.renderDeadlineMs === undefined
      ? {}
      : { renderDeadlineMs: overrides.renderDeadlineMs }),
    ...(overrides.leaseMs === undefined ? {} : { leaseMs: overrides.leaseMs }),
    ...(overrides.staleAfterMs === undefined ? {} : { staleAfterMs: overrides.staleAfterMs }),
    ...(overrides.executorRetry === undefined ? {} : { executorRetry: overrides.executorRetry }),
    ...(overrides.onOutput === undefined ? {} : { onOutput: overrides.onOutput }),
    ...(overrides.startMs === undefined ? {} : { startMs: overrides.startMs }),
    observability: {
      logger: observability.logger,
      metrics: observability.metrics,
      correlation: observability.correlation,
    },
  });
}

/** The settle-time invariants every result must satisfy (fail-loud proof). */
export function expectBalanced(result: RenderOrchestrationResult): void {
  expect(result.balanced).toBe(true);
  expect(result.stats.batchesInFlight).toBe(0);
  expect(result.stats.renderJobsInFlight).toBe(0);
  expect(result.stats.queuedNow).toBe(0);
}

// ---------------------------------------------------------------------------
// Microtask draining (deterministic async waiting, no real timers)
// ---------------------------------------------------------------------------

/** Yields to the microtask queue `ticks` times. */
export function drainMicrotasks(ticks: number): Promise<void> {
  let remaining = ticks;
  return new Promise<void>((resolve) => {
    const step = (): void => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      remaining -= 1;
      queueMicrotask(step);
    };
    queueMicrotask(step);
  });
}

/**
 * Drains microtasks until `predicate` holds (bounded, fail-loud): the
 * deterministic "wait for the async wiring to reach a state" helper. Throws
 * when the bound is exhausted — a broken fixture, never a hang.
 */
export async function until(
  predicate: () => boolean,
  options: { ticks?: number; label?: string } = {},
): Promise<void> {
  const ticks = options.ticks ?? 2_000;
  for (let i = 0; i < ticks; i += 1) {
    if (predicate()) return;
    await drainMicrotasks(1);
  }
  if (!predicate()) {
    throw new Error(
      `until() predicate never held${options.label === undefined ? "" : ` (${options.label})`} ` +
        "— the fixture's deterministic wiring is broken",
    );
  }
}
