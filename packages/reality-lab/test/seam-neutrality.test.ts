/**
 * Seam neutrality tests (REL-032): the DomainPack + DomainSimulationProfile
 * seam generalization — (a) FOOTBALL REGRESSION: the football facades
 * delegate byte-identically (runLab ≡ runDomainLab, runEnsemble default ≡
 * derived ≡ explicit, with MEASURED runId/ensembleId pins that catch any
 * seam change); (b) DOMAIN NEUTRALITY: the generalist baseline and a small
 * seeded search → reward → calibration → robustness chain run GREEN over
 * the BASKETBALL pack end-to-end, twice, with deep-equal records; (c) the
 * seam refuses a pack/profile mismatch with a typed error.
 */
import { describe, expect, test } from "bun:test";
import {
  SMALL_SCENARIO,
  generalistBundle,
  basketballGeneralistBundle,
  BASKETBALL_SMALL_SCENARIO,
} from "./fixtures";
import {
  assertProfileMatchesPack,
  basketballDomainPack,
  createBasketballCandidateSpace,
  createBasketballRewardEngine,
  createFootballCandidateSpace,
  createFootballLabEvaluator,
  createScriptedModelRuntime,
  defaultBasketballCandidateSpaceConfig,
  defaultFootballCandidateSpaceConfig,
  deterministicDomainLabRun,
  deterministicLabRun,
  footballDomainPack,
  footballDomainSimulationProfile,
  generateBasketballScenario,
  generateFootballScenario,
  runDomainCalibration,
  runDomainEnsemble,
  runDomainLab,
  runDomainOrganizationSearch,
  runEnsemble,
  runLab,
  runOrganizationSearch,
  runRobustnessBenchmark,
  type LabBodyInput,
  type LabBodyOutput,
  type DomainSimulationProfile,
  type SimulatedTick,
  type FootballScenarioRecord,
} from "../src";
import { basketballDomainSimulationProfile } from "../src/simulation/basketball-simulator";

// ---------------------------------------------------------------------------
// (a) Football regression — the facades delegate byte-identically
// ---------------------------------------------------------------------------

describe("football regression: the facades delegate through the seam byte-identically", () => {
  test("runLab ≡ runDomainLab (derived evaluator path) — deep-equal records", () => {
    const { bundle } = generalistBundle();
    const scenario = generateFootballScenario("seam-pin-1", SMALL_SCENARIO);
    const viaFacade = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario,
      evaluator: createFootballLabEvaluator(),
    });
    const viaSeam = runDomainLab({
      domainPack: footballDomainPack,
      simulationProfile: footballDomainSimulationProfile,
      organization: bundle,
      scenario,
    });
    expect(JSON.stringify(deterministicLabRun(viaSeam))).toBe(
      JSON.stringify(deterministicLabRun(viaFacade)),
    );
    expect(viaSeam.runId).toBe(viaFacade.runId);
    expect(viaSeam.trajectoryHash).toBe(viaFacade.trajectoryHash);
  });

  test("MEASURED PIN: the football runId is stable through the seam (seam-pin-1)", () => {
    const { bundle } = generalistBundle();
    const record = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("seam-pin-1", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    // The measured value on this seed/organization/config — any seam change
    // that alters record identity breaks this pin.
    expect(record.runId).toBe("98c080508f0789c1");
  });

  test("runEnsemble default ≡ derived ≡ explicit (evaluator equivalence)", () => {
    const { bundle } = generalistBundle();
    const defaults = runEnsemble({
      domainPack: footballDomainPack,
      organization: bundle,
      baseSeed: "seam-ens-1",
      size: 2,
      scenarioConfig: SMALL_SCENARIO,
    });
    const explicit = runEnsemble({
      domainPack: footballDomainPack,
      organization: bundle,
      baseSeed: "seam-ens-1",
      size: 2,
      scenarioConfig: SMALL_SCENARIO,
      evaluator: createFootballLabEvaluator(),
    });
    const viaSeam = runDomainEnsemble({
      domainPack: footballDomainPack,
      simulationProfile: footballDomainSimulationProfile,
      organization: bundle,
      baseSeed: "seam-ens-1",
      size: 2,
      scenarioConfig: SMALL_SCENARIO,
    });
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(defaults));
    expect(JSON.stringify(viaSeam)).toBe(JSON.stringify(defaults));
    // MEASURED PIN: the football ensembleId through the seam.
    expect(defaults.ensembleId).toBe("e53b1007ccd1e748");
  });

  test("runOrganizationSearch ≡ runDomainOrganizationSearch (derived engine + evaluator)", () => {
    const space = createFootballCandidateSpace({
      ...defaultFootballCandidateSpaceConfig(),
      maxBodyCount: 2,
      maxDelegationDepth: 1,
      latencyBudgetsMs: [1000, 2000],
    });
    const options = {
      domainPack: footballDomainPack,
      space,
      seed: "seam-search-1",
      mode: "exhaustive-bounded" as const,
      maxCandidates: 2,
      ensembleSize: 1,
      budgetCeilingUsd: 100,
      latencyCeilingMs: 10_000,
      scenarioConfig: SMALL_SCENARIO,
    };
    const viaFacade = runOrganizationSearch(options);
    const viaSeam = runDomainOrganizationSearch({
      domainPack: options.domainPack,
      simulationProfile: footballDomainSimulationProfile,
      space: options.space,
      seed: options.seed,
      mode: options.mode,
      maxCandidates: options.maxCandidates,
      ensembleSize: options.ensembleSize,
      budgetCeilingUsd: options.budgetCeilingUsd,
      latencyCeilingMs: options.latencyCeilingMs,
      scenarioConfig: options.scenarioConfig,
    });
    expect(JSON.stringify(viaSeam)).toBe(JSON.stringify(viaFacade));
    expect(viaSeam.searchId).toBe(viaFacade.searchId);
  });
});

// ---------------------------------------------------------------------------
// (b) Domain neutrality — the basketball substrate proof
// ---------------------------------------------------------------------------

describe("the generalist baseline over basketball (the mandatory-baseline contract)", () => {
  test("the domain-neutral generalist body runs GREEN over the basketball pack", () => {
    const record = runDomainLab({
      domainPack: basketballDomainPack,
      simulationProfile: basketballDomainSimulationProfile,
      organization: basketballGeneralistBundle().bundle,
      scenario: generateBasketballScenario("seam-bb-1", BASKETBALL_SMALL_SCENARIO),
    });
    // Mandatory-baseline contract: valid, measurable, deterministic.
    expect(record.metrics.valid).toBe(true);
    expect(record.metrics.violations).toHaveLength(0);
    expect(record.metrics.overall).not.toBeNull();
    expect(record.metrics.evaluatorId).toBe("basketball-lab-evaluator");
    expect(record.claims.length).toBeGreaterThan(0);
    // FOUR quarters flow through the widened generic body input (period 1..4).
    const periods = new Set(record.trajectory.ticks.map((tick) => tick.period));
    expect([...periods].sort()).toEqual([1, 2, 3, 4]);
    // Deterministic: twice ⇒ deep-equal deterministic views.
    const second = runDomainLab({
      domainPack: basketballDomainPack,
      simulationProfile: basketballDomainSimulationProfile,
      organization: basketballGeneralistBundle().bundle,
      scenario: generateBasketballScenario("seam-bb-1", BASKETBALL_SMALL_SCENARIO),
    });
    expect(JSON.stringify(deterministicDomainLabRun(second))).toBe(
      JSON.stringify(deterministicDomainLabRun(record)),
    );
  });

  test("a fabricating body over basketball hard-invalidates through the same gates", () => {
    // The shared hard-gate machinery fires over the second pack identically.
    const { bundle, body } = basketballGeneralistBundle();
    const fabricating = createScriptedModelRuntime({
      modelId: "fabricating-policy",
      modelVersion: "0.1.0",
      handler: (input: LabBodyInput): LabBodyOutput => ({
        actions:
          input.tickIndex === 5
            ? [
                {
                  actionId: "emit-canonical-event",
                  claimId: "claim-fabricated",
                  eventKindId: "pass",
                  evidenceRef: "obs-evt-never-received",
                  clockMs: input.clockMs,
                },
              ]
            : [],
      }),
    });
    // Rebind the definition's node to the fabricating runtime (the binding
    // is execution metadata — the swap mirrors a real re-binding).
    const definition = {
      ...bundle.definition,
      nodes: bundle.definition.nodes.map((node) => ({
        ...node,
        binding: {
          ...node.binding,
          modelId: "fabricating-policy",
          modelVersion: "0.1.0",
          runtimeId: fabricating.runtimeId,
        },
      })),
    };
    const record = runDomainLab({
      domainPack: basketballDomainPack,
      simulationProfile: basketballDomainSimulationProfile,
      organization: {
        definition,
        bodies: [body],
        runtimes: new Map([[fabricating.runtimeId, fabricating]]),
      },
      scenario: generateBasketballScenario("seam-bb-2", BASKETBALL_SMALL_SCENARIO),
    });
    expect(record.metrics.valid).toBe(false);
    expect(record.metrics.violations[0]?.ruleId).toBe("fabricated-canonical-event");
  });
});

describe("the seam refuses a pack/profile mismatch (typed, never silent)", () => {
  test("a basketball profile under a football pack is refused", () => {
    expect(() =>
      assertProfileMatchesPack(basketballDomainSimulationProfile, footballDomainPack),
    ).toThrow(/must match/);
  });

  test("runDomainLab refuses the cross-domain pairing at the boundary", () => {
    // The deliberate mismatch is the test: the basketball profile typed
    // through the football parameterization purely to prove the RUNTIME
    // refusal (the type system would normally prevent the pairing).
    const mismatchedProfile =
      basketballDomainSimulationProfile as unknown as DomainSimulationProfile<
        FootballScenarioRecord,
        SimulatedTick
      >;
    expect(() =>
      runDomainLab({
        domainPack: footballDomainPack,
        simulationProfile: mismatchedProfile,
        organization: basketballGeneralistBundle().bundle,
        scenario: generateFootballScenario("mismatch-1", SMALL_SCENARIO),
      }),
    ).toThrow(/must match/);
  });
});

// ---------------------------------------------------------------------------
// (c) The basketball chain: search → reward → calibration → robustness, twice
// ---------------------------------------------------------------------------

interface BasketballChainArtifacts {
  search: ReturnType<typeof runDomainOrganizationSearch>;
  winnerRewardAggregates: readonly (number | null)[];
  calibration: ReturnType<typeof runDomainCalibration>;
  robustness: ReturnType<typeof runRobustnessBenchmark>;
}

function runBasketballChain(): BasketballChainArtifacts {
  const space = createBasketballCandidateSpace({
    ...defaultBasketballCandidateSpaceConfig(),
    maxBodyCount: 3,
    maxDelegationDepth: 2,
    latencyBudgetsMs: [1000, 2000],
  });

  // 1) SEARCH over the basketball pack (generic driver, basketball profile).
  const search = runDomainOrganizationSearch({
    domainPack: basketballDomainPack,
    simulationProfile: basketballDomainSimulationProfile,
    space,
    seed: "bb-chain-seed",
    mode: "exhaustive-bounded",
    maxCandidates: 3,
    ensembleSize: 1,
    budgetCeilingUsd: 100,
    latencyCeilingMs: 10_000,
    scenarioConfig: BASKETBALL_SMALL_SCENARIO,
  });

  // 2) REWARD: the winner's per-run reward records through the basketball engine.
  expect(search.winner).not.toBeNull();
  const winnerEvaluation = search.candidates.find(
    (candidate) => candidate.candidateId === search.winner?.candidateId,
  );
  expect(winnerEvaluation).toBeDefined();
  const winnerCandidate = space.materialize(winnerEvaluation!.point, {
    familyId: winnerEvaluation!.familyId ?? undefined,
  });
  const engine = createBasketballRewardEngine();
  const winnerEnsemble = runDomainEnsemble({
    domainPack: basketballDomainPack,
    simulationProfile: basketballDomainSimulationProfile,
    organization: winnerCandidate.bundle,
    baseSeed: winnerEvaluation!.ensembleRef.baseSeed,
    size: winnerEvaluation!.ensembleRef.size,
    scenarioConfig: BASKETBALL_SMALL_SCENARIO,
  });
  const winnerRewardAggregates = winnerEnsemble.runs.map(
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

  // 3) CALIBRATION of the winning basketball organization (perturbed ensemble).
  const calibration = runDomainCalibration({
    domainPack: basketballDomainPack,
    simulationProfile: basketballDomainSimulationProfile,
    organization: winnerCandidate.bundle,
    seed: `${search.seed}::winner`,
    ensembleSize: 1,
    scenarioConfig: BASKETBALL_SMALL_SCENARIO,
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

  // 4) ROBUSTNESS record over the winning basketball organization.
  const robustness = runRobustnessBenchmark({
    domainPack: basketballDomainPack,
    simulationProfile: basketballDomainSimulationProfile,
    organization: winnerCandidate.bundle,
    baseSeed: `${search.seed}::robustness`,
    ensembleSize: 2,
    scenarioConfig: BASKETBALL_SMALL_SCENARIO,
    ood: { scenarioOverrides: { sourceProfile: "degraded" } },
    severities: [1, 2],
    sweepSize: 1,
  });

  return { search, winnerRewardAggregates, calibration, robustness };
}

describe("the basketball search → reward → calibration → robustness chain (REL-A9)", () => {
  test("runs GREEN end to end over the second domain with real metrics at every stage", () => {
    const { search, winnerRewardAggregates, calibration, robustness } = runBasketballChain();

    // Search: the mandatory generalist baseline is present and FIRST.
    expect(
      search.candidates.some((candidate) => candidate.familyId === "generalist-baseline"),
    ).toBe(true);
    expect(search.candidatesEvaluated).toBe(3);
    for (const candidate of search.candidates) {
      expect(candidate.metrics.quality).not.toBeNull();
      expect(candidate.metrics.hardGateValid).toBe(true);
      expect(candidate.metrics.costUsd).toBeGreaterThan(0);
      expect(candidate.metrics.meanLatencyMs).not.toBeNull();
    }
    expect(search.config.evaluatorId).toBe("basketball-lab-evaluator");
    expect(search.provenance.versions.domainPackId).toBe("basketball");

    // Reward: measurable aggregates for the winner.
    expect(winnerRewardAggregates.length).toBeGreaterThan(0);
    expect(winnerRewardAggregates.every((aggregate) => aggregate !== null)).toBe(true);

    // Calibration: comparable dimensions measured, drift state consistent.
    expect(calibration.record.drift.comparableDimensions).toBeGreaterThan(0);
    expect(calibration.record.domainPack.domainPackId).toBe("basketball");
    expect(calibration.drift.status).toBe("calibrated");

    // Robustness: the §9 record over basketball is complete.
    expect(robustness.domainPack.domainPackId).toBe("basketball");
    expect(robustness.expectedScore.overall).not.toBeNull();
    expect(robustness.simulatorModelAgreement.claimsExamined).toBeGreaterThan(0);
    expect(robustness.outOfDistribution.faultTicksOod).toBeGreaterThan(
      robustness.outOfDistribution.faultTicksStandard,
    );
  }, 60_000);

  test("the WHOLE chain twice ⇒ deep-equal records at every stage (the lab determinism law, cross-domain)", () => {
    const first = runBasketballChain();
    const second = runBasketballChain();
    expect(JSON.stringify(first.search)).toBe(JSON.stringify(second.search));
    expect(first.winnerRewardAggregates).toEqual(second.winnerRewardAggregates);
    expect(JSON.stringify(first.calibration.record)).toBe(
      JSON.stringify(second.calibration.record),
    );
    expect(JSON.stringify(first.robustness)).toBe(JSON.stringify(second.robustness));
    expect(first.search.searchId).toBe(second.search.searchId);
    expect(first.calibration.record.calibrationId).toBe(second.calibration.record.calibrationId);
    expect(first.robustness.benchmarkId).toBe(second.robustness.benchmarkId);
  }, 60_000);
});
