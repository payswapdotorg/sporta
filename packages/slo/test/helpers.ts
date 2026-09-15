/**
 * Shared test helpers: the BASELINE input — the exact structural projection
 * of the W306 checked-in fixture run (the same numbers
 * `test/benchmark-integration.test.ts` pins against the LIVE benchmark) —
 * plus targeted mutation builders.
 *
 * Every number here is W306 measured evidence (SLOs.md §Evidence); nothing
 * is invented.
 */
import type {
  BatchStageKey,
  FrameStageKey,
  LatencySloInput,
  LatencyStatsSubset,
} from "../src/input";
import { LATENCY_SLO_INPUT_SCHEMA_TAG } from "../src/input";

/** The W306 measured baseline stage summaries (batch, n = 140). */
export const BASELINE_BATCH_STATS: Record<BatchStageKey, LatencyStatsSubset> = {
  "swm-to-batch": { count: 140, minMs: 0, maxMs: 5027, p50Ms: 102, p95Ms: 4478 },
  "batch-queue": { count: 140, minMs: 0, maxMs: 400, p50Ms: 0, p95Ms: 400 },
  "w303-schedule": { count: 140, minMs: 0, maxMs: 4400, p50Ms: 0, p95Ms: 4000 },
  "render-execution": { count: 140, minMs: 400, maxMs: 400, p50Ms: 400, p95Ms: 400 },
  "finish-to-emit": { count: 140, minMs: 0, maxMs: 400, p50Ms: 0, p95Ms: 400 },
  "end-to-end": { count: 140, minMs: 400, maxMs: 9762, p50Ms: 2029, p95Ms: 8849 },
};

/** The W306 measured baseline stage summaries (frame, n = 240). */
export const BASELINE_FRAME_STATS: Record<FrameStageKey, LatencyStatsSubset> = {
  "swm-store-sojourn": { count: 240, minMs: 0, maxMs: 5027, p50Ms: 2121, p95Ms: 4680 },
  "end-to-end": { count: 240, minMs: 400, maxMs: 9762, p50Ms: 3968, p95Ms: 9080 },
};

/** The W306 baseline run's frame accounting (all zero loss). */
export const BASELINE_FRAMES = {
  framesIn: 240,
  framesEmitted: 240,
  framesSkippedStale: 0,
  framesDropped: 0,
  framesCancelled: 0,
  framesDuplicate: 0,
} as const;

export interface InputOverrides {
  batch?: Partial<Record<BatchStageKey, Partial<LatencyStatsSubset>>>;
  frame?: Partial<Record<FrameStageKey, Partial<LatencyStatsSubset>>>;
  frames?: Partial<typeof BASELINE_FRAMES>;
  degradation?: LatencySloInput["pipeline"]["degradation"];
  backpressure?: LatencySloInput["pipeline"]["backpressure"];
}

/** Builds one input window from the baseline with targeted overrides. */
export function buildInput(overrides: InputOverrides = {}): LatencySloInput {
  const mergeStats = <K extends string>(
    base: Record<K, LatencyStatsSubset>,
    patch: Partial<Record<K, Partial<LatencyStatsSubset>>> | undefined,
  ): Record<K, LatencyStatsSubset> => {
    const merged = { ...base } as Record<K, LatencyStatsSubset>;
    if (patch !== undefined) {
      for (const [key, value] of Object.entries(patch) as [K, Partial<LatencyStatsSubset>][]) {
        merged[key] = { ...base[key], ...value };
      }
    }
    return merged;
  };
  const frames = { ...BASELINE_FRAMES, ...overrides.frames };
  return {
    inputSchema: LATENCY_SLO_INPUT_SCHEMA_TAG,
    domain: {
      clockDomain: "injected-virtual",
      percentileMethod: "nearest-rank",
      fixtureProfileId: "w306-live-fixture",
      fixtureProfileVersion: 1,
      fixtureSeed: "w306-live-fixture-v1",
    },
    pipeline: {
      backpressure: overrides.backpressure ?? "block",
      degradation: overrides.degradation ?? { kind: "disabled" },
    },
    stages: {
      batch: mergeStats(BASELINE_BATCH_STATS, overrides.batch),
      frame: mergeStats(BASELINE_FRAME_STATS, overrides.frame),
    },
    accounting: { frames },
  };
}

/** A minimal structural W306 REPORT document (the projector's input shape). */
export function buildStructuralReport(overrides: InputOverrides = {}): {
  benchmark: {
    clockDomain: "injected-virtual";
    percentileMethod: "nearest-rank";
    fixture: { profileId: string; profileVersion: number; seed: string };
    pipeline: LatencySloInput["pipeline"];
  };
  stages: { batch: Record<BatchStageKey, LatencyStatsSubset>; frame: Record<FrameStageKey, LatencyStatsSubset> };
  accounting: { frames: typeof BASELINE_FRAMES };
} {
  const input = buildInput(overrides);
  return {
    benchmark: {
      clockDomain: input.domain.clockDomain,
      percentileMethod: input.domain.percentileMethod,
      fixture: {
        profileId: input.domain.fixtureProfileId,
        profileVersion: input.domain.fixtureProfileVersion,
        seed: input.domain.fixtureSeed,
      },
      pipeline: input.pipeline,
    },
    stages: input.stages,
    accounting: { frames: input.accounting.frames },
  };
}

/**
 * Builds the override that sets ONE stage's ONE percentile to a value —
 * the boundary-pin helper (typed through casts because the stage name is a
 * runtime value from the SLO table).
 */
export function withStageMetric(
  scope: "batch" | "frame",
  stage: string,
  metric: "p50" | "p95",
  value: number,
): InputOverrides {
  const patch = { [metric === "p95" ? "p95Ms" : "p50Ms"]: value };
  if (scope === "batch") {
    return { batch: { [stage]: patch } as Partial<Record<BatchStageKey, Partial<LatencyStatsSubset>>> };
  }
  return { frame: { [stage]: patch } as Partial<Record<FrameStageKey, Partial<LatencyStatsSubset>>> };
}
