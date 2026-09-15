/**
 * The W802 SLO DEFINITIONS — the formalization of W306's measured evidence
 * into explicit latency objectives (see SLOs.md, the normative document; the
 * table below is the executable mirror, pinned row-for-row by
 * `test/slos.test.ts`).
 *
 * ## What one row states
 *
 * Each SLO is an **indicator objective** over one compliance window: "the
 * nearest-rank `metric` of `stage`, measured over the window, must be
 * `<= targetMs` (injected-clock milliseconds)". The error budget is the
 * percentile semantics stated exactly: a pN target holds iff **at most
 * (100 − N)% of the window's samples exceed `targetMs`** — for p95 that is
 * at most 5% of samples; for p50, at most 50%. The compliance window is ONE
 * benchmark run (the stage table's `count` samples) — honestly scoped to the
 * W306 injected-clock benchmark domain (SLOs.md §Scope): there is no rolling
 * real-time window because there is no production telemetry pipeline yet
 * (W805's gap, documented).
 *
 * ## Where every number comes from (never invented)
 *
 * - **Batch-stage rows (12)**: the W306 SLO candidate table, ADOPTED VERBATIM
 *   (`@sporta/latency-benchmark` `SLO_CANDIDATES` — pinned equal by
 *   `test/slos.test.ts`, so the eval-harness case's candidate-breach FAIL is
 *   an SLO-objective breach by construction). Their derivation is W306's own
 *   (SLOs.md §Candidate targets + §Reasoning): measured medians/burst tails
 *   with explicit headroom so tuning shifts do not breach while regressions
 *   fail loud.
 * - **Frame-stage rows (4)**: W802-derived from W306's MEASURED frame-stage
 *   evidence (SLOs.md §Evidence, frame table) by the documented
 *   {@link FRAME_HEADROOM_RULE} — the same headroom philosophy as the batch
 *   candidates, stated as a deterministic formula so the derivation is
 *   reproducible, not judgment re-applied after the fact.
 *
 * Every `baselineMs` is a reading of the checked-in fixture run
 * (`w306-live-fixture` v1, seed `w306-live-fixture-v1`, report tag
 * `sporta/latency-benchmark/report@1`, nearest-rank, injected-virtual clock);
 * `test/benchmark-integration.test.ts` pins the LIVE benchmark's stage table
 * to these baselines, so the benchmark and the SLO table cannot drift apart
 * silently.
 */
import { SloTableInconsistentError } from "./errors";
import type { BatchStageKey, FrameStageKey } from "./input";

/** The SLO set's identity (echoed by every compliance evaluation). */
export const SLO_SET_ID = "w802-slo-v1";

/** The one measured-evidence source every baseline below is a reading of. */
export const BASELINE_SOURCE =
  "w306-live-fixture v1 (seed w306-live-fixture-v1) — one checked-in run of the " +
  "real W304 pipeline over the W303 gpu-worker protocol through the real W502 anime " +
  "executor, report tag sporta/latency-benchmark/report@1, nearest-rank percentiles " +
  "on the injected-virtual clock (n = 140 batches, n = 240 frames)";

/** One latency SLO (an indicator objective; see the module doc). */
export interface SloDefinition {
  /** Stable machine-readable id, e.g. `"batch.swm-to-batch.p95"`. */
  readonly sloId: string;
  /** Which stage table the indicator reads. */
  readonly scope: "batch" | "frame";
  /** The stage (the report's own vocabulary). */
  readonly stage: BatchStageKey | FrameStageKey;
  /** The percentile indicator. */
  readonly metric: "p50" | "p95";
  /** The unit of every number (the honest domain, everywhere). */
  readonly unit: "injected-clock-ms";
  /** The W306 measured evidence the objective is derived from. */
  readonly baselineMs: number;
  /** The objective: window `metric` must be `<=` this. */
  readonly targetMs: number;
  /** Error budget: the fraction of window samples permitted to exceed the target. */
  readonly allowedExceedanceFraction: number;
  /** The documented derivation (SLOs.md mirrors it; the doc test pins it). */
  readonly derivation: string;
}

/**
 * The frame-stage headroom rule (the W802 derivation for the 4 frame rows):
 * `target =` the smallest multiple of `roundUpToMs` that is `>=` the measured
 * baseline × the metric multiplier — p50 ≥ 1.25×, p95 ≥ 1.35× (the same
 * philosophy the W306 batch candidates document: slack for tuning shifts,
 * loud failure for regressions).
 */
export const FRAME_HEADROOM_RULE = {
  p50Multiplier: 1.25,
  p95Multiplier: 1.35,
  roundUpToMs: 500,
} as const;

/** The error-budget fraction implied by a percentile (p95 → 5%, p50 → 50%). */
export function budgetFractionForMetric(metric: "p50" | "p95"): number {
  return metric === "p95" ? 0.05 : 0.5;
}

/** Computes a frame-stage target by the documented {@link FRAME_HEADROOM_RULE}. */
export function frameTargetByRule(metric: "p50" | "p95", baselineMs: number): number {
  const multiplier =
    metric === "p95" ? FRAME_HEADROOM_RULE.p95Multiplier : FRAME_HEADROOM_RULE.p50Multiplier;
  const product = baselineMs * multiplier;
  const multiple = FRAME_HEADROOM_RULE.roundUpToMs;
  return Math.ceil(product / multiple) * multiple;
}

/** The 12 batch-stage SLO objectives (the W306 candidates, adopted verbatim). */
const BATCH_SLOS: readonly SloDefinition[] = [
  {
    sloId: "batch.swm-to-batch.p50",
    scope: "batch",
    stage: "swm-to-batch",
    metric: "p50",
    unit: "injected-clock-ms",
    baselineMs: 102,
    targetMs: 250,
    allowedExceedanceFraction: 0.5,
    derivation:
      "W306 candidate, adopted verbatim: measured p50 102 ms, target 250 ms (~2.5× headroom) — " +
      "the normal-phase floor is 0–100 ms (the watermark-grid wait), so slack keeps a tuning " +
      "shift from breaching while sustained queueing regresses loud (W306 SLOs.md §Reasoning)",
  },
  {
    sloId: "batch.swm-to-batch.p95",
    scope: "batch",
    stage: "swm-to-batch",
    metric: "p95",
    unit: "injected-clock-ms",
    baselineMs: 4478,
    targetMs: 6000,
    allowedExceedanceFraction: 0.05,
    derivation:
      "W306 candidate, adopted verbatim: measured p95 4478 ms (the authored burst tail), " +
      "target 6000 ms (~1.35× headroom) — a somewhat deeper burst passes, a structural " +
      "queueing regression fails loud (W306 SLOs.md §Reasoning)",
  },
  {
    sloId: "batch.batch-queue.p50",
    scope: "batch",
    stage: "batch-queue",
    metric: "p50",
    unit: "injected-clock-ms",
    baselineMs: 0,
    targetMs: 50,
    allowedExceedanceFraction: 0.5,
    derivation:
      "W306 candidate, adopted verbatim: measured p50 0 ms (the floor stage — the channel " +
      "sojourn is zero when the consumer keeps up), target 50 ms — pure slack that makes a " +
      "REGRESSION to sustained queueing visible (W306 SLOs.md §Reasoning)",
  },
  {
    sloId: "batch.batch-queue.p95",
    scope: "batch",
    stage: "batch-queue",
    metric: "p95",
    unit: "injected-clock-ms",
    baselineMs: 400,
    targetMs: 1000,
    allowedExceedanceFraction: 0.05,
    derivation:
      "W306 candidate, adopted verbatim: measured p95 400 ms, target 1000 ms (2.5× headroom) — " +
      "the channel is NOT the congestion point in the measured configuration (peakQueuedNow " +
      "stayed 0); a p95 here means the consumer stopped draining (W306 SLOs.md §Interpretation)",
  },
  {
    sloId: "batch.w303-schedule.p50",
    scope: "batch",
    stage: "w303-schedule",
    metric: "p50",
    unit: "injected-clock-ms",
    baselineMs: 0,
    targetMs: 50,
    allowedExceedanceFraction: 0.5,
    derivation:
      "W306 candidate, adopted verbatim: measured p50 0 ms (the floor stage — the W303 " +
      "dispatch wait is zero outside the burst), target 50 ms — pure slack for regression " +
      "visibility (W306 SLOs.md §Reasoning)",
  },
  {
    sloId: "batch.w303-schedule.p95",
    scope: "batch",
    stage: "w303-schedule",
    metric: "p95",
    unit: "injected-clock-ms",
    baselineMs: 4000,
    targetMs: 6000,
    allowedExceedanceFraction: 0.05,
    derivation:
      "W306 candidate, adopted verbatim: measured p95 4000 ms — the W303 ready queue IS the " +
      "measured congestion point under these bounds, target 6000 ms (1.5× headroom) so a " +
      "deeper burst passes while a throughput regression fails loud (W306 SLOs.md §Interpretation)",
  },
  {
    sloId: "batch.render-execution.p50",
    scope: "batch",
    stage: "render-execution",
    metric: "p50",
    unit: "injected-clock-ms",
    baselineMs: 400,
    targetMs: 750,
    allowedExceedanceFraction: 0.5,
    derivation:
      "W306 candidate, adopted verbatim: measured p50 400 ms — exactly the authored " +
      "render-duration model (renderDurationMs, echoed in every report), target 750 ms " +
      "(~1.9× headroom): a slower real render or a changed model must cross it (W306 SLOs.md)",
  },
  {
    sloId: "batch.render-execution.p95",
    scope: "batch",
    stage: "render-execution",
    metric: "p95",
    unit: "injected-clock-ms",
    baselineMs: 400,
    targetMs: 1000,
    allowedExceedanceFraction: 0.05,
    derivation:
      "W306 candidate, adopted verbatim: measured p95 400 ms (the authored model — nothing " +
      "else advances the clock inside a solo render's window), target 1000 ms (2.5× " +
      "headroom; the elapsed-window semantics are documented in W306 SLOs.md §Interpretation)",
  },
  {
    sloId: "batch.finish-to-emit.p50",
    scope: "batch",
    stage: "finish-to-emit",
    metric: "p50",
    unit: "injected-clock-ms",
    baselineMs: 0,
    targetMs: 50,
    allowedExceedanceFraction: 0.5,
    derivation:
      "W306 candidate, adopted verbatim: measured p50 0 ms (the floor stage — the reorder " +
      "hold releases immediately when outputs arrive in order), target 50 ms — pure slack " +
      "for regression visibility (W306 SLOs.md §Reasoning)",
  },
  {
    sloId: "batch.finish-to-emit.p95",
    scope: "batch",
    stage: "finish-to-emit",
    metric: "p95",
    unit: "injected-clock-ms",
    baselineMs: 400,
    targetMs: 1000,
    allowedExceedanceFraction: 0.05,
    derivation:
      "W306 candidate, adopted verbatim: measured p95 400 ms (the reorder hold under the " +
      "burst), target 1000 ms (2.5× headroom) — growth here means out-of-order completions " +
      "are stacking behind the reorder bound (W306 SLOs.md §Interpretation)",
  },
  {
    sloId: "batch.end-to-end.p50",
    scope: "batch",
    stage: "end-to-end",
    metric: "p50",
    unit: "injected-clock-ms",
    baselineMs: 2029,
    targetMs: 3000,
    allowedExceedanceFraction: 0.5,
    derivation:
      "W306 candidate, adopted verbatim: measured p50 2029 ms (first input visible → output " +
      "emitted), target 3000 ms (~1.5× headroom) — the normal-phase composition floor is " +
      "render duration + sub-boundary arrival offset (W306 SLOs.md §Interpretation)",
  },
  {
    sloId: "batch.end-to-end.p95",
    scope: "batch",
    stage: "end-to-end",
    metric: "p95",
    unit: "injected-clock-ms",
    baselineMs: 8849,
    targetMs: 12000,
    allowedExceedanceFraction: 0.05,
    derivation:
      "W306 candidate, adopted verbatim: measured p95 8849 ms (the burst tail), target " +
      "12000 ms (~1.35× headroom) — architecture-lock §8: end-to-end latency is a measurable " +
      "SLO, not a UI promise; this is the batch-unit objective in the injected-clock domain",
  },
];

/** The 4 frame-stage SLO objectives (W802-derived from W306's measured frame evidence). */
const FRAME_SLOS: readonly SloDefinition[] = [
  {
    sloId: "frame.swm-store-sojourn.p50",
    scope: "frame",
    stage: "swm-store-sojourn",
    metric: "p50",
    unit: "injected-clock-ms",
    baselineMs: 2121,
    targetMs: 3000,
    allowedExceedanceFraction: 0.5,
    derivation:
      "W802 derivation from W306's measured frame evidence (SLOs.md §Evidence, frame table): " +
      "measured p50 2121 ms × 1.25 = 2651.25 → 3000 ms (the ≥1.25× p50 headroom rule, rounded " +
      "up to the next 500 ms multiple — the W306 batch-candidate philosophy, as a formula)",
  },
  {
    sloId: "frame.swm-store-sojourn.p95",
    scope: "frame",
    stage: "swm-store-sojourn",
    metric: "p95",
    unit: "injected-clock-ms",
    baselineMs: 4680,
    targetMs: 6500,
    allowedExceedanceFraction: 0.05,
    derivation:
      "W802 derivation from W306's measured frame evidence: measured p95 4680 ms × 1.35 = " +
      "6318 → 6500 ms (the ≥1.35× p95 headroom rule, rounded up to the next 500 ms multiple)",
  },
  {
    sloId: "frame.end-to-end.p50",
    scope: "frame",
    stage: "end-to-end",
    metric: "p50",
    unit: "injected-clock-ms",
    baselineMs: 3968,
    targetMs: 5000,
    allowedExceedanceFraction: 0.5,
    derivation:
      "W802 derivation from W306's measured frame evidence: measured p50 3968 ms × 1.25 = " +
      "4960 → 5000 ms (the ≥1.25× p50 headroom rule, rounded up to the next 500 ms multiple) " +
      "— the per-update visibility→emission median (the user-visible latency indicator)",
  },
  {
    sloId: "frame.end-to-end.p95",
    scope: "frame",
    stage: "end-to-end",
    metric: "p95",
    unit: "injected-clock-ms",
    baselineMs: 9080,
    targetMs: 12500,
    allowedExceedanceFraction: 0.05,
    derivation:
      "W802 derivation from W306's measured frame evidence: measured p95 9080 ms × 1.35 = " +
      "12258 → 12500 ms (the ≥1.35× p95 headroom rule, rounded up to the next 500 ms multiple) " +
      "— the per-update burst tail objective",
  },
];

/** The full SLO table (batch rows first, then frame rows — the doc's order). */
export const SLO_DEFINITIONS: readonly SloDefinition[] = [...BATCH_SLOS, ...FRAME_SLOS];

/** Looks one SLO up by id (fail-loud on an unknown id). */
export function sloById(sloId: string): SloDefinition {
  const slo = SLO_DEFINITIONS.find((candidate) => candidate.sloId === sloId);
  if (slo === undefined) {
    throw new SloTableInconsistentError(`no SLO named "${sloId}" in the W802 table`);
  }
  return slo;
}

/**
 * Asserts the table's structural invariants (called by every evaluation and
 * pinned by tests): unique ids, scope-consistent stage vocabularies, budgets
 * derived from the metric, targets strictly above the baselines (headroom),
 * and frame targets equal to the documented derivation rule.
 */
export function assertSloTableInvariants(): void {
  const seen = new Set<string>();
  for (const slo of SLO_DEFINITIONS) {
    if (seen.has(slo.sloId)) {
      throw new SloTableInconsistentError(`duplicate sloId "${slo.sloId}"`);
    }
    seen.add(slo.sloId);
    if (slo.unit !== "injected-clock-ms") {
      throw new SloTableInconsistentError(`SLO "${slo.sloId}" left the injected-clock domain`);
    }
    if (slo.allowedExceedanceFraction !== budgetFractionForMetric(slo.metric)) {
      throw new SloTableInconsistentError(
        `SLO "${slo.sloId}" budget does not match its percentile semantics`,
      );
    }
    if (!(slo.targetMs > slo.baselineMs)) {
      throw new SloTableInconsistentError(
        `SLO "${slo.sloId}" target ${String(slo.targetMs)} ms does not sit above the measured ` +
          `baseline ${String(slo.baselineMs)} ms — headroom is required, knife-edge targets are not SLOs`,
      );
    }
    if (slo.scope === "frame" && slo.targetMs !== frameTargetByRule(slo.metric, slo.baselineMs)) {
      throw new SloTableInconsistentError(
        `frame SLO "${slo.sloId}" target does not equal the documented headroom rule`,
      );
    }
  }
}
