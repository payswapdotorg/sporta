/**
 * The W306 SLO CANDIDATES — measured evidence, honestly scoped (see SLOs.md
 * for the derivation and the reasoning; W802 formalizes SLOs/alerting).
 *
 * Every number below is a reading from the ONE checked-in fixture run
 * (`LIVE_FIXTURE_PROFILE` + `BENCHMARK_PIPELINE`, report tag
 * `sporta/latency-benchmark/report@1`) in the INJECTED clock domain, with
 * explicit headroom applied so a deterministic rerun (which reproduces the
 * exact numbers) never sits on a knife-edge target. They are CANDIDATES for
 * W802 to formalize — never claims about real-network or wall-clock latency.
 */
import type { LatencyBenchmarkReport } from "./schema";

/** The SLO-candidate table's identity (echoed by the eval-harness case). */
export const SLO_CANDIDATE_PROFILE_ID = "w306-candidate-v1" as const;

/** One stage's candidate targets (injected-clock milliseconds). */
export interface SloCandidate {
  readonly stage: string;
  readonly p50TargetMs: number;
  readonly p95TargetMs: number;
}

/**
 * The candidate table (per-stage p50/p95 targets, injected-clock ms). Derived
 * from the measured evidence (SLOs.md §Evidence) with headroom:
 *
 * | stage             | measured p50 | measured p95 | p50 target | p95 target |
 * |-------------------|--------------|--------------|------------|------------|
 * | swm-to-batch      |          102 |         4478 |        250 |       6000 |
 * | batch-queue       |            0 |          400 |         50 |       1000 |
 * | w303-schedule     |            0 |         4000 |         50 |       6000 |
 * | render-execution  |          400 |          400 |        750 |       1000 |
 * | finish-to-emit    |            0 |          400 |         50 |       1000 |
 * | end-to-end        |         2029 |         8849 |       3000 |      12000 |
 *
 * The headroom reasoning (SLOs.md §Reasoning): p50 targets sit ~25-50% above
 * the measured medians, p95 targets ~35% above the measured burst tail —
 * enough slack that a future fixture or pipeline tuning which shifts the
 * distribution slightly does not instantly breach, while a REGRESSION (an
 * order-of-magnitude growth, a stage going pathological) still fails loud
 * through {@link checkSloCandidates}.
 */
export const SLO_CANDIDATES: readonly SloCandidate[] = [
  { stage: "swm-to-batch", p50TargetMs: 250, p95TargetMs: 6_000 },
  { stage: "batch-queue", p50TargetMs: 50, p95TargetMs: 1_000 },
  { stage: "w303-schedule", p50TargetMs: 50, p95TargetMs: 6_000 },
  { stage: "render-execution", p50TargetMs: 750, p95TargetMs: 1_000 },
  { stage: "finish-to-emit", p50TargetMs: 50, p95TargetMs: 1_000 },
  { stage: "end-to-end", p50TargetMs: 3_000, p95TargetMs: 12_000 },
];

/** One stage's candidate-check result (machine-readable, never silent). */
export interface SloCandidateVerdict {
  readonly stage: string;
  readonly metric: "p50" | "p95";
  readonly targetMs: number;
  readonly measuredMs: number;
  readonly pass: boolean;
}

/**
 * Checks a report's batch stages against the candidate table. PURE; returns
 * one verdict per (stage, metric) — every breach is a `pass: false` entry,
 * never a swallowed check. Unknown stages in the report fail loud (typed
 * error) — the table and the report vocabulary must stay in lockstep.
 */
export function checkSloCandidates(report: LatencyBenchmarkReport): SloCandidateVerdict[] {
  const verdicts: SloCandidateVerdict[] = [];
  for (const candidate of SLO_CANDIDATES) {
    const stats = (report.stages.batch as Record<string, { p50Ms: number; p95Ms: number }>)[
      candidate.stage
    ];
    if (stats === undefined) {
      throw new RangeError(
        `checkSloCandidates: report carries no stats for stage "${candidate.stage}" — the SLO ` +
          "candidate table and the report's stage vocabulary diverged",
      );
    }
    verdicts.push({
      stage: candidate.stage,
      metric: "p50",
      targetMs: candidate.p50TargetMs,
      measuredMs: stats.p50Ms,
      pass: stats.p50Ms <= candidate.p50TargetMs,
    });
    verdicts.push({
      stage: candidate.stage,
      metric: "p95",
      targetMs: candidate.p95TargetMs,
      measuredMs: stats.p95Ms,
      pass: stats.p95Ms <= candidate.p95TargetMs,
    });
  }
  return verdicts;
}
