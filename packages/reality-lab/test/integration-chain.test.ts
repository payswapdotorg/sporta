/**
 * The REL-005..008 chain, end to end: organization search (which evaluates
 * candidates through the ensembles and the reward engine) -> the winner's
 * per-run reward records (recomputed through the search's own ensemble
 * references) -> calibration of the winning organization with known injected
 * perturbations. The whole chain runs TWICE and every record must be
 * deep-equal — the lab's determinism law, pinned across the new modules.
 */
import { describe, expect, test } from "bun:test";
import {
  createFootballCandidateSpace,
  createFootballRewardEngine,
  defaultFootballCandidateSpaceConfig,
  footballDomainPack,
  runCalibration,
  runEnsemble,
  runOrganizationSearch,
  type CandidateSpaceConfig,
} from "../src";
import { SMALL_SCENARIO } from "./fixtures";

function chainSpaceConfig(): CandidateSpaceConfig {
  return {
    ...defaultFootballCandidateSpaceConfig(),
    maxBodyCount: 3,
    maxDelegationDepth: 2,
    latencyBudgetsMs: [1000, 2000],
  };
}

interface ChainArtifacts {
  search: ReturnType<typeof runOrganizationSearch>;
  rewardAggregates: readonly (number | null)[];
  calibration: ReturnType<typeof runCalibration>;
}

function runChain(): ChainArtifacts {
  const space = createFootballCandidateSpace(chainSpaceConfig());

  // 1) SEARCH: bounded, deterministic, baseline always included.
  const search = runOrganizationSearch({
    domainPack: footballDomainPack,
    space,
    seed: "chain-seed",
    mode: "exhaustive-bounded",
    maxCandidates: 4,
    ensembleSize: 2,
    budgetCeilingUsd: 100,
    latencyCeilingMs: 10_000,
    scenarioConfig: SMALL_SCENARIO,
  });

  // 2) REWARD: the winner's per-run reward records, recomputed through the
  //    search's own ensemble reference (baseSeed + materialized winner).
  expect(search.winner).not.toBeNull();
  const winnerEvaluation = search.candidates.find(
    (candidate) => candidate.candidateId === search.winner?.candidateId,
  );
  expect(winnerEvaluation).toBeDefined();
  const winnerCandidate = space.materialize(winnerEvaluation!.point, {
    familyId: winnerEvaluation!.familyId ?? undefined,
  });
  const engine = createFootballRewardEngine();
  const winnerEnsemble = runEnsemble({
    domainPack: footballDomainPack,
    organization: winnerCandidate.bundle,
    baseSeed: winnerEvaluation!.ensembleRef.baseSeed,
    size: winnerEvaluation!.ensembleRef.size,
    scenarioConfig: SMALL_SCENARIO,
  });
  const rewardAggregates = winnerEnsemble.runs.map(
    (run) =>
      engine.score({
        dimensionScores: run.metrics.dimensions,
        hardGateViolations: run.metrics.violations,
        weightSetId: search.config.weightSetId,
        provenance: {
          runId: run.runId,
          evaluatorId: run.metrics.evaluatorId,
          evaluatorVersion: run.metrics.version,
        },
      }).aggregate,
  );

  // 3) CALIBRATION: the winning organization, prediction vs a perturbed
  //    observation ensemble, with drift detection configured.
  const calibration = runCalibration({
    domainPack: footballDomainPack,
    organization: winnerCandidate.bundle,
    seed: `${search.seed}::winner`,
    ensembleSize: 2,
    scenarioConfig: SMALL_SCENARIO,
    observation: {
      sourceClass: "lab-simulation",
      kind: "perturbed-ensemble",
      perturbations: {
        description: "observed window is twice as long (40s vs 20s)",
        scenarioOverrides: { matchDurationMs: 40_000 },
      },
    },
    driftThreshold: 0.5,
  });

  return { search, rewardAggregates, calibration };
}

describe("the search -> reward -> calibration chain (REL-005..008)", () => {
  test("runs green end to end with real metrics at every stage", () => {
    const { search, rewardAggregates, calibration } = runChain();

    // Search: baseline present, REL-A3 metrics on every candidate.
    expect(
      search.candidates.some((candidate) => candidate.familyId === "generalist-baseline"),
    ).toBe(true);
    expect(search.candidatesEvaluated).toBe(4);
    for (const candidate of search.candidates) {
      expect(candidate.metrics.quality).not.toBeNull();
      expect(candidate.metrics.hardGateValid).toBe(true);
      expect(candidate.metrics.costUsd).toBeGreaterThan(0);
      expect(candidate.metrics.meanLatencyMs).not.toBeNull();
    }
    expect(search.winner?.candidateId).toBe(search.ranking[0]);

    // Reward: the winner's ensemble produced valid, measurable rewards, and
    // the recomputed quality matches the search's metric for that candidate.
    expect(rewardAggregates).toHaveLength(2);
    expect(rewardAggregates.every((aggregate) => aggregate !== null)).toBe(true);
    const winnerEvaluation = search.candidates.find(
      (candidate) => candidate.candidateId === search.winner?.candidateId,
    );
    const recomputedQuality =
      rewardAggregates.reduce<number>((sum, aggregate) => sum + (aggregate ?? 0), 0) /
      rewardAggregates.length;
    expect(recomputedQuality).toBeCloseTo(winnerEvaluation?.metrics.quality ?? -1, 12);

    // Calibration: comparable dimensions measured, drift state consistent
    // with the configured threshold.
    expect(calibration.record.drift.comparableDimensions).toBeGreaterThan(0);
    expect(calibration.record.organization.organizationId).toBe(search.winner!.organizationId);
    expect(calibration.drift.status).toBe("calibrated"); // measured drift 1/15 < 0.5
  });

  test("the WHOLE chain twice ⇒ deep-equal records at every stage", () => {
    const first = runChain();
    const second = runChain();
    expect(JSON.stringify(first.search)).toBe(JSON.stringify(second.search));
    expect(first.rewardAggregates).toEqual(second.rewardAggregates);
    expect(JSON.stringify(first.calibration.record)).toBe(
      JSON.stringify(second.calibration.record),
    );
    expect(JSON.stringify(first.calibration.drift)).toBe(JSON.stringify(second.calibration.drift));
    expect(first.search.searchId).toBe(second.search.searchId);
    expect(first.calibration.record.calibrationId).toBe(second.calibration.record.calibrationId);
  }, 60_000);
});
