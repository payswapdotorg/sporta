/**
 * Ensemble tests (REL-003): the PURE aggregate's arithmetic hand-checked on
 * fixed synthetic scores, plus the EnsembleRunner's determinism, size,
 * seed-robustness fields, and fault-aware aggregation.
 *
 * HAND CHECK (the numbers the aggregate must reproduce):
 *   scores 0.5, 0.5, 1.0 → mean = 2/3 ≈ 0.6667
 *   sample variance = ((0.5−2/3)² + (0.5−2/3)² + (1−2/3)²) / (n−1)
 *                   = (1/36 + 1/36 + 1/9) / 2 = (6/36)/2 = 1/12 ≈ 0.08333
 *   std = sqrt(1/12) ≈ 0.28868
 */
import { describe, expect, test } from "bun:test";
import {
  FOOTBALL_FAULT_PROFILES,
  aggregateLabRuns,
  createFootballLabEvaluator,
  footballDomainPack,
  runEnsemble,
} from "../src";
import { SMALL_SCENARIO, generalistBundle, syntheticRun } from "./fixtures";

describe("aggregateLabRuns — pure arithmetic, hand-checked", () => {
  test("mean/variance/std on fixed scores 0.5, 0.5, 1.0", () => {
    const runs = [syntheticRun(0.5, "h1"), syntheticRun(0.5, "h2"), syntheticRun(1.0, "h3")];
    const aggregate = aggregateLabRuns(runs);
    expect(aggregate.expectedScore.overall).toBeCloseTo(2 / 3, 12);
    expect(aggregate.variance.overall).toBeCloseTo(1 / 12, 12);
    expect(aggregate.uncertainty.overall.std).toBeCloseTo(Math.sqrt(1 / 12), 12);
    expect(aggregate.uncertainty.overall.mean).toBeCloseTo(2 / 3, 12);
    expect(aggregate.uncertainty.overall.min).toBe(0.5);
    expect(aggregate.uncertainty.overall.max).toBe(1.0);
    expect(aggregate.seedRobustness).toEqual({
      seedsTested: 3,
      validRuns: 3,
      validFraction: 1,
      overallScoreSpread: { min: 0.5, max: 1.0 },
      distinctTrajectoryHashes: 3,
    });
  });

  test("a single run has zero sample variance", () => {
    const aggregate = aggregateLabRuns([syntheticRun(0.75, "only")]);
    expect(aggregate.expectedScore.overall).toBe(0.75);
    expect(aggregate.variance.overall).toBe(0);
    expect(aggregate.uncertainty.overall.std).toBe(0);
  });

  test("an empty ensemble is honestly null (no fake zeros)", () => {
    const aggregate = aggregateLabRuns([]);
    expect(aggregate.expectedScore.overall).toBeNull();
    expect(aggregate.variance.overall).toBeNull();
    expect(aggregate.uncertainty.overall.mean).toBeNull();
    expect(aggregate.seedRobustness.seedsTested).toBe(0);
    expect(aggregate.seedRobustness.validFraction).toBe(0);
  });

  test("per-dimension means skip unmeasured runs (hand-checked)", () => {
    // d1: (0.5 + 1.0)/2 = 0.75 measured on both; d2 only measured on run 2.
    const runs = [
      syntheticRun(0.5, "d1", {
        dimensions: [
          { dimensionId: "d1", score: 0.5, measured: true },
          { dimensionId: "d2", score: 0, measured: false },
        ],
      }),
      syntheticRun(1.0, "d2", {
        dimensions: [
          { dimensionId: "d1", score: 1.0, measured: true },
          { dimensionId: "d2", score: 1.0, measured: true },
        ],
      }),
    ];
    const aggregate = aggregateLabRuns(runs);
    expect(aggregate.expectedScore.perDimension["d1"]).toBeCloseTo(0.75, 12);
    expect(aggregate.variance.perDimension["d1"]).toBeCloseTo(0.125, 12); // ((−0.25)²+(0.25)²)/1
    expect(aggregate.expectedScore.perDimension["d2"]).toBe(1.0);
  });

  test("invalid runs count against seed robustness", () => {
    const runs = [
      syntheticRun(0.9, "v1", { valid: true }),
      syntheticRun(0.9, "v2", { valid: false }),
    ];
    const aggregate = aggregateLabRuns(runs);
    expect(aggregate.seedRobustness.validRuns).toBe(1);
    expect(aggregate.seedRobustness.validFraction).toBe(0.5);
  });
});

describe("runEnsemble — N seeded runs, deterministically", () => {
  test("size N ⇒ N runs with distinct seeds/trajectories, all valid (baseline)", () => {
    const { bundle } = generalistBundle();
    const ensemble = runEnsemble({
      domainPack: footballDomainPack,
      organization: bundle,
      baseSeed: "ens-seed-1",
      size: 3,
      scenarioConfig: SMALL_SCENARIO,
      evaluator: createFootballLabEvaluator(),
    });
    expect(ensemble.runs).toHaveLength(3);
    expect(ensemble.runs.every((run) => run.metrics.valid)).toBe(true);
    expect(new Set(ensemble.runs.map((run) => run.runId)).size).toBe(3);
    expect(ensemble.aggregate.seedRobustness.distinctTrajectoryHashes).toBe(3);
    expect(ensemble.aggregate.seedRobustness.validFraction).toBe(1);
    // Runs are embedded as deterministic views (no execution section).
    expect(ensemble.runs.every((run) => !("execution" in run))).toBe(true);
  });

  test("same (baseSeed, size, config, organization) ⇒ byte-identical ensemble record", () => {
    const { bundle } = generalistBundle();
    const options = {
      domainPack: footballDomainPack,
      organization: bundle,
      baseSeed: "ens-seed-1",
      size: 3,
      scenarioConfig: SMALL_SCENARIO,
      evaluator: createFootballLabEvaluator(),
    } as const;
    const first = runEnsemble(options);
    const second = runEnsemble(options);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.ensembleId).toBe(second.ensembleId);
  });

  test("different baseSeed ⇒ different ensemble", () => {
    const { bundle } = generalistBundle();
    const first = runEnsemble({
      domainPack: footballDomainPack,
      organization: bundle,
      baseSeed: "ens-seed-1",
      size: 2,
      scenarioConfig: SMALL_SCENARIO,
    });
    const second = runEnsemble({
      domainPack: footballDomainPack,
      organization: bundle,
      baseSeed: "ens-seed-2",
      size: 2,
      scenarioConfig: SMALL_SCENARIO,
    });
    expect(first.ensembleId).not.toBe(second.ensembleId);
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });

  test("with the adversarial fault profile, reliability is measured (faults present)", () => {
    const { bundle } = generalistBundle();
    const adversarial = FOOTBALL_FAULT_PROFILES.find(
      (p) => p.profileId === "football-adversarial",
    )!;
    const ensemble = runEnsemble({
      domainPack: footballDomainPack,
      organization: bundle,
      baseSeed: "ens-fault",
      size: 3,
      scenarioConfig: SMALL_SCENARIO,
      faultProfile: adversarial,
    });
    expect(ensemble.faultProfileId).toBe("football-adversarial");
    for (const run of ensemble.runs) {
      expect(run.metrics.faultSummary.faultTicks).toBeGreaterThan(0);
      const reliability = run.metrics.dimensions.find((d) => d.dimensionId === "reliability");
      expect(reliability?.measured).toBe(true);
    }
  });

  test("the ensemble record's provenance is lab-simulation, never production truth", () => {
    const { bundle } = generalistBundle();
    const ensemble = runEnsemble({
      domainPack: footballDomainPack,
      organization: bundle,
      baseSeed: "ens-seed-1",
      size: 2,
      scenarioConfig: SMALL_SCENARIO,
    });
    expect(ensemble.schemaVersion).toBe("lab-ensemble/0.1");
    expect(ensemble.provenance.provenanceClass).toBe("lab-simulation");
    expect(ensemble.provenance.note).toContain("never production truth");
  });
});
