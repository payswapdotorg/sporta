/**
 * R003 — evaluation runner: determinism (two runs -> identical metrics),
 * honest cost aggregation, fail-closed outcome validation, rerun delta
 * computation, and the EvaluationReport comparison outputs (manual builder
 * + deterministic policy).
 */
import { describe, expect, test } from "bun:test";
import type { BenchmarkRun } from "@sporta/contracts";
import {
  EvaluationValidationError,
  buildEvaluationReport,
  candidateKeyOf,
  computeRerunDeltaPct,
  metricDeltaPct,
  recommendFromRuns,
  rerunBenchmark,
  runBenchmark,
  type AdapterRunner,
  type FixtureExecutionOutcome,
} from "../src/index";
import {
  buildBenchmarkRun,
  buildFixtureEntry,
  buildFixtureSet,
  buildTechnologyProfile,
  TEST_EPOCH_MS,
} from "./builders";

/** A deterministic fake clock: advances by `stepMs` per call. */
function fakeClock(startMs: number, stepMs: number): () => number {
  let now = startMs;
  return () => {
    const value = now;
    now += stepMs;
    return value;
  };
}

/** A fully deterministic synthetic runner: metrics are pure functions of seed + fixture. */
function deterministicRunner(
  metrics: (fixtureId: string, seed: string) => Record<string, number>,
): AdapterRunner {
  return (ctx): FixtureExecutionOutcome => ({
    metrics: metrics(ctx.fixtureId, ctx.seed),
    resourceUsage: { cpuMs: 100 },
    runtimeSeconds: 2,
    costEstimateUsd: 0.1,
    failures: 0,
    failureExamples: [],
    licenseCheck: "pass",
    artifactRefs: [`artifact://${ctx.runId}/${ctx.fixtureId}`],
  });
}

describe("runBenchmark (R003)", () => {
  const profile = buildTechnologyProfile({
    technologyId: "yolo-detector",
    technologyVersion: "1.0.0",
    adapterVersion: "1.0.0",
    status: "candidate",
  });
  const fixtureSet = buildFixtureSet({
    fixtureSetVersion: "fixtures-test-v1",
    entries: [
      buildFixtureEntry({ fixtureId: "fx-1", mediaRef: "a.mp4", scenarioTags: ["open-play"] }),
      buildFixtureEntry({ fixtureId: "fx-2", mediaRef: "b.mp4", scenarioTags: ["occlusion"] }),
    ],
  });

  test("produces a valid frozen BenchmarkRun with aggregated values", async () => {
    const run = await runBenchmark({
      profile,
      fixtureSet,
      runner: deterministicRunner((fixtureId) => ({
        precision: fixtureId === "fx-1" ? 0.9 : 0.8,
        recall: 0.5,
      })),
      runId: "run-agg-1",
      clock: fakeClock(TEST_EPOCH_MS, 1000),
    });
    expect(run.runId).toBe("run-agg-1");
    expect(run.technologyId).toBe("yolo-detector");
    expect(run.fixtureSetVersion).toBe("fixtures-test-v1");
    expect(run.metrics.precision).toBeCloseTo(0.85, 12); // mean(0.9, 0.8)
    expect(run.metrics.recall).toBeCloseTo(0.5, 12);
    expect(run.resourceUsage.cpuMs).toBeCloseTo(100, 12);
    expect(run.runtimeSeconds).toBeCloseTo(4, 12); // 2s x 2 fixtures
    expect(run.costEstimateUsd).toBeCloseTo(0.2, 12); // 0.1 x 2
    expect(run.failureSummary.failures).toBe(0);
    expect(run.licenseCheck).toBe("pass");
    expect(run.artifactRefs).toEqual(["artifact://run-agg-1/fx-1", "artifact://run-agg-1/fx-2"]);
    expect(run.reproducibility.seed).toBe(run.reproducibility.seed); // pinned
    expect(run.reproducibility.deterministic).toBe(false); // unproven claim by default
  });

  test("deterministic: same inputs -> identical metrics across two runs", async () => {
    const runner = deterministicRunner((fixtureId, seed) => ({
      precision: seed.length + fixtureId.length * 0.01,
    }));
    const first = await runBenchmark({
      profile,
      fixtureSet,
      runner,
      runId: "run-det-1",
      clock: fakeClock(TEST_EPOCH_MS, 500),
    });
    const second = await runBenchmark({
      profile,
      fixtureSet,
      runner,
      runId: "run-det-2",
      clock: fakeClock(TEST_EPOCH_MS, 500),
    });
    expect(second.metrics).toEqual(first.metrics);
    expect(second.reproducibility.seed).toBe(first.reproducibility.seed);
    // startedAtMs/completedAtMs come from the injected clock (no Date.now).
    expect(first.startedAtMs).toBe(TEST_EPOCH_MS);
    expect(first.completedAtMs).toBe(TEST_EPOCH_MS + 500);
  });

  test("costEstimateUsd is null when any fixture is unmetered (honest cost)", async () => {
    let call = 0;
    const run = await runBenchmark({
      profile,
      fixtureSet,
      runner: () => ({
        metrics: { precision: 0.9 },
        runtimeSeconds: 1,
        costEstimateUsd: call++ === 0 ? 0.1 : null,
      }),
      runId: "run-cost-1",
      clock: fakeClock(TEST_EPOCH_MS, 100),
    });
    expect(run.costEstimateUsd).toBeNull();
  });

  test("failures are summed and examples collected; licenseCheck fail dominates", async () => {
    const run = await runBenchmark({
      profile,
      fixtureSet,
      runner: (ctx) => ({
        metrics: { precision: 0.9 },
        runtimeSeconds: 1,
        failures: ctx.fixtureId === "fx-1" ? 2 : 0,
        failureExamples: ctx.fixtureId === "fx-1" ? ["decode-error:frame-3"] : [],
        licenseCheck: ctx.fixtureId === "fx-2" ? "fail" : "pass",
      }),
      runId: "run-fail-1",
      clock: fakeClock(TEST_EPOCH_MS, 100),
    });
    expect(run.failureSummary.failures).toBe(2);
    expect(run.failureSummary.failureExamples).toEqual(["decode-error:frame-3"]);
    expect(run.licenseCheck).toBe("fail");
  });

  test("metric keys must be identical across fixtures (fail-closed)", async () => {
    let call = 0;
    await expect(
      runBenchmark({
        profile,
        fixtureSet,
        runner: (): FixtureExecutionOutcome => ({
          metrics: call++ === 0 ? { precision: 0.9, recall: 0.8 } : { precision: 0.9 },
          runtimeSeconds: 1,
        }),
        runId: "run-keys-1",
        clock: fakeClock(TEST_EPOCH_MS, 100),
      }),
    ).rejects.toThrow(EvaluationValidationError);
  });

  test("failures without examples are refused", async () => {
    await expect(
      runBenchmark({
        profile,
        fixtureSet: buildFixtureSet({
          entries: [buildFixtureEntry({ fixtureId: "fx-1", mediaRef: "a.mp4" })],
        }),
        runner: () => ({ metrics: { precision: 0.9 }, runtimeSeconds: 1, failures: 3 }),
        runId: "run-noex-1",
        clock: fakeClock(TEST_EPOCH_MS, 100),
      }),
    ).rejects.toThrow(/failure example/);
  });

  test("non-finite metrics are refused", async () => {
    await expect(
      runBenchmark({
        profile,
        fixtureSet: buildFixtureSet({
          entries: [buildFixtureEntry({ fixtureId: "fx-1", mediaRef: "a.mp4" })],
        }),
        runner: () => ({ metrics: { precision: Number.NaN }, runtimeSeconds: 1 }),
        runId: "run-nan-1",
        clock: fakeClock(TEST_EPOCH_MS, 100),
      }),
    ).rejects.toThrow(EvaluationValidationError);
  });

  test("non-positive runtimeSeconds is refused", async () => {
    await expect(
      runBenchmark({
        profile,
        fixtureSet: buildFixtureSet({
          entries: [buildFixtureEntry({ fixtureId: "fx-1", mediaRef: "a.mp4" })],
        }),
        runner: () => ({ metrics: { precision: 0.9 }, runtimeSeconds: 0 }),
        runId: "run-zero-1",
        clock: fakeClock(TEST_EPOCH_MS, 100),
      }),
    ).rejects.toThrow(/runtimeSeconds/);
  });
});

describe("rerunBenchmark (R003)", () => {
  const profile = buildTechnologyProfile({ technologyId: "rerun-tech" });
  const fixtureSet = buildFixtureSet({
    entries: [buildFixtureEntry({ fixtureId: "fx-1", mediaRef: "a.mp4" })],
  });

  test("two deterministic runs -> delta 0, deterministic flag backed by evidence", async () => {
    const runner = deterministicRunner((_fixtureId, seed) => ({ precision: seed.length / 100 }));
    const { first, second, rerunDeltaPct } = await rerunBenchmark({
      profile,
      fixtureSet,
      runner,
      runId: "run-rr-1",
      clock: fakeClock(TEST_EPOCH_MS, 100),
    });
    expect(rerunDeltaPct).toBe(0);
    expect(first.reproducibility.deterministic).toBe(true);
    expect(first.reproducibility.rerunDeltaPct).toBe(0);
    expect(second.reproducibility.deterministic).toBe(true);
    expect(second.runId).toBe("run-rr-1#rerun");
    expect(second.metrics).toEqual(first.metrics);
  });

  test("a nondeterministic runner produces a measured delta > 0", async () => {
    let call = 0;
    const runner: AdapterRunner = () => ({
      metrics: { precision: call++ === 0 ? 0.9 : 0.8 },
      runtimeSeconds: 1,
    });
    const { first, second, rerunDeltaPct } = await rerunBenchmark({
      profile,
      fixtureSet,
      runner,
      runId: "run-rr-2",
      clock: fakeClock(TEST_EPOCH_MS, 100),
    });
    expect(rerunDeltaPct).toBeCloseTo((0.1 / 0.9) * 100, 9);
    expect(first.reproducibility.deterministic).toBe(false);
    expect(second.reproducibility.deterministic).toBe(false);
  });
});

describe("computeRerunDeltaPct / metricDeltaPct", () => {
  test("identical metrics -> 0", () => {
    const a = buildBenchmarkRun({ metrics: { precision: 0.9, recall: 0.8 } });
    const b = buildBenchmarkRun({ metrics: { precision: 0.9, recall: 0.8 } });
    expect(computeRerunDeltaPct(a, b)).toBe(0);
  });

  test("relative delta per shared key, maximum across keys", () => {
    expect(
      metricDeltaPct({ precision: 0.9, recall: 0.5 }, { precision: 0.8, recall: 0.5 }),
    ).toBeCloseTo((0.1 / 0.9) * 100, 9);
    expect(metricDeltaPct({ m: 10, x: 1 }, { m: 5, x: 1 })).toBeCloseTo(50, 9);
  });

  test("a metric present in only one run is a 100% delta", () => {
    expect(metricDeltaPct({ precision: 0.9 }, { precision: 0.9, recall: 0.5 })).toBe(100);
  });

  test("both zero -> 0", () => {
    expect(metricDeltaPct({ m: 0 }, { m: 0 })).toBe(0);
  });
});

describe("buildEvaluationReport (R003)", () => {
  const runA = buildBenchmarkRun({
    runId: "run-a",
    technologyId: "tech-a",
    metrics: { precision: 0.91 },
  });
  const runB = buildBenchmarkRun({
    runId: "run-b",
    technologyId: "tech-b",
    metrics: { precision: 0.85 },
  });

  test("assembles the comparison keyed by candidate with benchmark meta-values", () => {
    const report = buildEvaluationReport({
      reportId: "report-1",
      runs: [runA, runB],
      recommendation: "promote",
      recommendedCandidate: candidateKeyOf(runA),
      rationale: "tech-a leads precision 0.91 vs 0.85",
      decidedAtMs: TEST_EPOCH_MS,
    });
    expect(report.comparison[candidateKeyOf(runA)]?.precision).toBeCloseTo(0.91, 12);
    expect(report.comparison[candidateKeyOf(runA)]?.["benchmark.failures"]).toBe(0);
    expect(report.comparison[candidateKeyOf(runB)]?.["benchmark.runtimeSeconds"]).toBeCloseTo(
      42.5,
      12,
    );
    expect(report.recommendedCandidate).toBe(candidateKeyOf(runA));
    expect(report.benchmarkRunIds).toEqual(["run-a", "run-b"]);
  });

  test("refuses runs with mixed fixture-set versions", () => {
    const otherSet = buildBenchmarkRun({ runId: "run-c", fixtureSetVersion: "fixtures-OTHER-v1" });
    expect(() =>
      buildEvaluationReport({
        reportId: "report-2",
        runs: [runA, otherSet],
        recommendation: "hold",
        rationale: "x",
        decidedAtMs: TEST_EPOCH_MS,
      }),
    ).toThrow(EvaluationValidationError);
  });

  test("refuses two runs of the same candidate", () => {
    const runA2 = buildBenchmarkRun({ runId: "run-a2", technologyId: "tech-a" });
    expect(() =>
      buildEvaluationReport({
        reportId: "report-3",
        runs: [runA, runA2],
        recommendation: "hold",
        rationale: "x",
        decidedAtMs: TEST_EPOCH_MS,
      }),
    ).toThrow(/multiple runs for candidate/);
  });

  test("promote requires a recommended candidate that matches a run", () => {
    expect(() =>
      buildEvaluationReport({
        reportId: "report-4",
        runs: [runA],
        recommendation: "promote",
        rationale: "x",
        decidedAtMs: TEST_EPOCH_MS,
      }),
    ).toThrow(/recommendedCandidate/);
    expect(() =>
      buildEvaluationReport({
        reportId: "report-5",
        runs: [runA],
        recommendation: "promote",
        recommendedCandidate: "someone-else@1.0.0+1.0.0",
        rationale: "x",
        decidedAtMs: TEST_EPOCH_MS,
      }),
    ).toThrow(/does not match any compared run/);
  });

  test("hold/reject must not name a candidate", () => {
    expect(() =>
      buildEvaluationReport({
        reportId: "report-6",
        runs: [runA],
        recommendation: "hold",
        recommendedCandidate: candidateKeyOf(runA),
        rationale: "x",
        decidedAtMs: TEST_EPOCH_MS,
      }),
    ).toThrow(/only meaningful/);
  });
});

describe("recommendFromRuns (policy path)", () => {
  const policy = { primaryMetric: "precision", direction: "higher-is-better" } as const;

  test("promotes the leader when the lead clears the threshold", () => {
    const report = recommendFromRuns({
      reportId: "report-p1",
      runs: [
        buildBenchmarkRun({ runId: "run-a", technologyId: "tech-a", metrics: { precision: 0.91 } }),
        buildBenchmarkRun({ runId: "run-b", technologyId: "tech-b", metrics: { precision: 0.85 } }),
      ],
      policy,
      decidedAtMs: TEST_EPOCH_MS,
    });
    expect(report.recommendation).toBe("promote");
    expect(report.recommendedCandidate).toBe("tech-a@1.0.0+1.0.0");
    expect(report.rationale).toContain("0.91");
  });

  test("holds on an exact tie (never promote without separation)", () => {
    const report = recommendFromRuns({
      reportId: "report-p2",
      runs: [
        buildBenchmarkRun({ runId: "run-a", technologyId: "tech-a", metrics: { precision: 0.9 } }),
        buildBenchmarkRun({ runId: "run-b", technologyId: "tech-b", metrics: { precision: 0.9 } }),
      ],
      policy,
      decidedAtMs: TEST_EPOCH_MS,
    });
    expect(report.recommendation).toBe("hold");
    expect(report.recommendedCandidate).toBeUndefined();
  });

  test("holds when the lead does not clear minLeadPct", () => {
    const report = recommendFromRuns({
      reportId: "report-p3",
      runs: [
        buildBenchmarkRun({ runId: "run-a", technologyId: "tech-a", metrics: { precision: 0.9 } }),
        buildBenchmarkRun({
          runId: "run-b",
          technologyId: "tech-b",
          metrics: { precision: 0.895 },
        }),
      ],
      policy: { ...policy, minLeadPct: 1 },
      decidedAtMs: TEST_EPOCH_MS,
    });
    expect(report.recommendation).toBe("hold");
  });

  test("respects direction: lower-is-better", () => {
    const report = recommendFromRuns({
      reportId: "report-p4",
      runs: [
        buildBenchmarkRun({ runId: "run-a", technologyId: "tech-a", metrics: { latencyMs: 120 } }),
        buildBenchmarkRun({ runId: "run-b", technologyId: "tech-b", metrics: { latencyMs: 150 } }),
      ],
      policy: { primaryMetric: "latencyMs", direction: "lower-is-better" },
      decidedAtMs: TEST_EPOCH_MS,
    });
    expect(report.recommendation).toBe("promote");
    expect(report.recommendedCandidate).toBe("tech-a@1.0.0+1.0.0");
  });

  test("fail-closed: any failure disqualifies by default (maxFailures 0)", () => {
    const report = recommendFromRuns({
      reportId: "report-p5",
      runs: [
        buildBenchmarkRun({
          runId: "run-a",
          technologyId: "tech-a",
          metrics: { precision: 0.99 },
          failureSummary: { failures: 1, failureExamples: ["decode-error"] },
        }),
        buildBenchmarkRun({ runId: "run-b", technologyId: "tech-b", metrics: { precision: 0.85 } }),
      ],
      policy,
      decidedAtMs: TEST_EPOCH_MS,
    });
    expect(report.recommendation).toBe("promote");
    expect(report.recommendedCandidate).toBe("tech-b@1.0.0+1.0.0");
    expect(report.rationale).toContain("Ineligible");
  });

  test("rejects when no candidate is eligible", () => {
    const report = recommendFromRuns({
      reportId: "report-p6",
      runs: [
        buildBenchmarkRun({
          runId: "run-a",
          technologyId: "tech-a",
          // deepMerge removes keys on explicit undefined: the run reports
          // recall but NOT the policy's primary metric (precision).
          metrics: { precision: undefined, recall: 0.9 },
        }),
      ],
      policy,
      decidedAtMs: TEST_EPOCH_MS,
    });
    expect(report.recommendation).toBe("reject");
    expect(report.recommendedCandidate).toBeUndefined();
  });

  test("promotes a sole eligible candidate", () => {
    const report = recommendFromRuns({
      reportId: "report-p7",
      runs: [
        buildBenchmarkRun({ runId: "run-a", technologyId: "tech-a", metrics: { precision: 0.9 } }),
      ],
      policy,
      decidedAtMs: TEST_EPOCH_MS,
    });
    expect(report.recommendation).toBe("promote");
    expect(report.recommendedCandidate).toBe("tech-a@1.0.0+1.0.0");
  });
});

describe("candidateKeyOf", () => {
  test("is the stable identity key", () => {
    const run: Pick<BenchmarkRun, "technologyId" | "technologyVersion" | "adapterVersion"> = {
      technologyId: "t",
      technologyVersion: "1.2.3",
      adapterVersion: "4.5.6",
    };
    expect(candidateKeyOf(run)).toBe("t@1.2.3+4.5.6");
  });
});
