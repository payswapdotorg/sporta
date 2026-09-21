/**
 * Shared deterministic test harness for the L004 battery — the TIME-DRIVEN
 * bridge pattern the wave-2 SSE lane will use, driven purely by the plan's
 * own ingest stamps (no wall clock anywhere):
 *
 * ```text
 * clock = 0; while (clock <= horizon) { admit every arrival whose planned
 * ingest <= clock; engine.tick(clock); clock += step; } engine.finalize();
 * ```
 *
 * Everything the run observes is collected (drains, applied batches, gap
 * markers, every per-source state ever surfaced, the max §9 watermark lag,
 * the arrival order) so the scenario tests can assert the D4 matrix against
 * the ENGINE's accounting AND cross-check it against the SOURCE's own
 * accounting (the two independent books must agree — that is the honesty
 * pin).
 */

import {
  createDeterministicLiveSource,
  drainSource,
  type LiveObservation,
  type LiveScenarioConfig,
  type LiveScenarioKind,
  type LiveSourceStats,
} from "@sporta/live-source";
import {
  createTemporalBufferEngine,
  type AppliedBatch,
  type DrainResult,
  type GapMarker,
  type SourceDrainStats,
  type TemporalBufferEngine,
  type TemporalBufferEngineConfig,
} from "../src/index";
import type { TemporalSourceState } from "../src/index";

/** The session id the harness runs (DATA). */
export const HARNESS_SESSION_ID = "s-live-harness";

/** Everything one scenario run observed (deterministic, JSON-safe). */
export interface ScenarioRun {
  readonly engine: TemporalBufferEngine;
  readonly drains: readonly DrainResult[];
  readonly applied: readonly AppliedBatch[];
  readonly gaps: readonly GapMarker[];
  /** Every per-source state ever surfaced, in observation order, deduped. */
  readonly statesVisited: readonly TemporalSourceState[];
  /** The max §9 watermark lag observed across all drains (ms). */
  readonly maxLagMs: number;
  /** The final per-source accounting (post-finalize). */
  readonly finalStats: readonly SourceDrainStats[];
  /** The source's own accounting (the cross-check book). */
  readonly sourceStats: LiveSourceStats;
  /** The arrival order's sequences (inversion checks for out-of-order). */
  readonly arrivalSequences: readonly number[];
  /** Applied batches whose source quality was honestly "degraded". */
  readonly degradedQualityApplied: number;
  /** `detected: false` entity rows across applied batches (the carry count). */
  readonly undetectedRowsInApplied: number;
}

/** Options for {@link runLiveScenario}. */
export interface ScenarioRunOptions {
  readonly scenario: LiveScenarioKind | LiveScenarioConfig;
  readonly seed?: number;
  readonly tickCount?: number;
  readonly rateMs?: number;
  readonly playersPerTeam?: number;
  /** Render-clock step in ms (default: the rate). */
  readonly stepMs?: number;
  /** Clock horizon past the last planned ingest (default: two steps). */
  readonly clockHorizonMs?: number;
  /** Engine config overrides (the session id is the harness's own). */
  readonly engine?: Omit<TemporalBufferEngineConfig, "sessionId">;
  /** The base delivery latency the source applies (default 120). */
  readonly baseLatencyMs?: number;
}

/**
 * Runs one L002 scenario through the engine with the time-driven bridge
 * pattern and collects everything (see the module doc).
 */
export function runLiveScenario(options: ScenarioRunOptions): ScenarioRun {
  const rateMs = options.rateMs ?? 100;
  const stepMs = options.stepMs ?? rateMs;
  const source = createDeterministicLiveSource({
    sessionId: HARNESS_SESSION_ID,
    seed: options.seed ?? 20260921,
    scenario: options.scenario,
    tickCount: options.tickCount ?? 600,
    rateMs,
    playersPerTeam: options.playersPerTeam ?? 11,
    ...(options.baseLatencyMs !== undefined ? { baseLatencyMs: options.baseLatencyMs } : {}),
  });
  const arrivals = drainSource(source);
  if (arrivals.length === 0) throw new Error("harness: the scenario plan emitted zero arrivals");
  const lastIngestMs = arrivals[arrivals.length - 1]!.ingestTimeMs;
  const horizonMs = lastIngestMs + (options.clockHorizonMs ?? 2 * stepMs);

  const engine = createTemporalBufferEngine({
    ...(options.engine ?? {}),
    sessionId: HARNESS_SESSION_ID,
  });

  const drains: DrainResult[] = [];
  const applied: AppliedBatch[] = [];
  const gaps: GapMarker[] = [];
  const statesVisited: TemporalSourceState[] = [];
  let maxLagMs = 0;
  let nextArrival = 0;

  const collect = (drain: DrainResult): void => {
    drains.push(drain);
    applied.push(...drain.applied);
    gaps.push(...drain.gaps);
    for (const source_ of drain.sources) {
      if (!statesVisited.includes(source_.stats.state)) statesVisited.push(source_.stats.state);
      if (source_.stats.watermarkLagMs > maxLagMs) maxLagMs = source_.stats.watermarkLagMs;
    }
  };

  let clock = 0;
  while (clock <= horizonMs) {
    while (nextArrival < arrivals.length && arrivals[nextArrival]!.ingestTimeMs <= clock) {
      collect(engine.admit(arrivals[nextArrival]!));
      nextArrival += 1;
    }
    collect(engine.tick(clock));
    clock += stepMs;
  }
  // Any arrival the clock never caught (a pathological plan): admitted and
  // accounted by the finalize drain — never silently lost.
  while (nextArrival < arrivals.length) {
    collect(engine.admit(arrivals[nextArrival]!));
    nextArrival += 1;
  }
  collect(engine.finalize());

  return {
    engine,
    drains,
    applied,
    gaps,
    statesVisited,
    maxLagMs,
    finalStats: engine.stats(),
    sourceStats: source.stats(),
    arrivalSequences: arrivals.map((arrival) => arrival.sequence),
    degradedQualityApplied: applied.filter((entry) => entry.batch.quality === "degraded").length,
    undetectedRowsInApplied: applied.reduce((acc, entry) => acc + entry.extrapolatedRows, 0),
  };
}

/**
 * Builds one contract-valid observation batch by hand (the D2 admission and
 * D3 transition unit tests need precise control the scenario knobs cannot
 * give). All fields default honestly; every field is overridable.
 */
export function buildBatch(input: {
  sequence: number;
  eventTimeMs: number;
  ingestTimeMs?: number;
  sourceId?: string;
  watermark?: { watermarkMs: number; sequence: number };
  entityRefs?: readonly string[];
  detected?: boolean;
  confidence?: number;
  quality?: "nominal" | "degraded";
  recovery?: LiveObservation["recovery"];
}): LiveObservation {
  const eventTimeMs = input.eventTimeMs;
  const refs = input.entityRefs ?? ["e-1"];
  return {
    schemaVersion: "sporta.live-observation/1",
    sessionId: HARNESS_SESSION_ID,
    sourceId: input.sourceId ?? "synthetic-tracking-1",
    sourceType: "TRACKING",
    sequence: input.sequence,
    eventTimeMs,
    ingestTimeMs: input.ingestTimeMs ?? eventTimeMs + 120,
    watermark: input.watermark ?? { watermarkMs: eventTimeMs, sequence: input.sequence },
    entityObservations: refs.map((entityRef) => ({
      entityRef,
      kind: "PLAYER" as const,
      position: { xMeters: 52.5, yMeters: 34 },
      detected: input.detected ?? true,
      confidence: input.confidence ?? 0.9,
      observedAtMs: eventTimeMs,
    })),
    confidence: input.confidence ?? 0.9,
    provenance: "DERIVED",
    quality: input.quality ?? "nominal",
    ...(input.recovery !== undefined ? { recovery: input.recovery } : {}),
  };
}

/** The stats record of one source (fail-loud when absent). */
export function statsOf(
  run: { readonly finalStats: readonly SourceDrainStats[] },
  sourceId: string,
): SourceDrainStats {
  const found = run.finalStats.find((entry) => entry.sourceId === sourceId);
  if (found === undefined) throw new Error(`harness: no stats for source "${sourceId}"`);
  return found;
}
