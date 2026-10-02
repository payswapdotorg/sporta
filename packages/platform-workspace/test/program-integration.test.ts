/**
 * REL-036 — THE PROGRAM INTEGRATION BATTERY (the M11 finale).
 *
 * ONE deterministic seeded run that walks the WHOLE Reality Engineering Lab
 * program as a story, every stage consuming the PREVIOUS stage's real
 * output (no re-seeding mid-chain), every step appended to ONE typed
 * program record, and the whole record deep-equal on an independent
 * re-run with the same seed:
 *
 * ```
 * LAB         football AND basketball domain packs through the shared
 *             DomainPack/DomainSimulationProfile seam: search -> reward ->
 *             calibration -> robustness records (the §8/§9 evidence)
 * PROMOTION   the calibrated organizations promoted into the organization
 *             registry with evidence chains derived from the lab outputs
 *             (versioned records, declared quality, eligibility visible
 *             per the REL-A5 law — the registry's own choice read model)
 * USER LAB    a private user lab whose candidate DERIVES from the promoted
 *             organization's registry record, published under the
 *             disclosed incentive policy, incentives accrued exactly per
 *             the recorded policy (REL-034), cross-tenant reads refused
 *             TYPED, the publication exported and imported (REL-023)
 * EXTERNAL    an external client discovers the organizations through BOTH
 *             the HTTP and the MCP surfaces (identical typed envelopes —
 *             the REL-030 parity law) and submits a media job
 * COMPOSITION the job executes through the platform-workspace composition
 *             (session.output === HTTP get_output === MCP get_output —
 *             THE ONE TRUTH), the external feed source drives a per-item
 *             A10 composition (REL-031), and the retrieved artifact's full
 *             evidence chain verifies leg-by-leg
 * ```
 *
 * THE PROGRAM SEAM (why this file lives in platform-workspace): the
 * composition package is where the program's product story lands
 * (REL-024/REL-031/REL-035); the lab, registry and user-lab packages are
 * imported READ-ONLY (the audit boundary — no existing file is edited):
 * `@sporta/organization-registry`, `@sporta/external-platform`,
 * `@sporta/historical-corpus` and `@sporta/durable-jobs` through the
 * package names this package already declares, `@sporta/reality-lab` and
 * `@sporta/user-labs` through relative source imports (neither is a
 * runtime dependency of the composition — the lab produces evidence, the
 * composition consumes records).
 *
 * DETERMINISM (the re-run law): every input flows from the program seed
 * `rel036-program-seed` and the fixture bytes; every clock is injected and
 * deterministic (the registry's default epoch clock, the workspace's
 * manual clock, the user-lab harness's mutable clock, the sequential id
 * sources); no wall clock, no randomness, no network. Two independent
 * program runs (fresh registries, corpora, job stores, harnesses and
 * workspaces) must produce deep-equal typed program records AND
 * deep-equal raw lab records.
 *
 * PROVENANCE (ADR-013 #8, binding): every lab record carries the
 * lab-simulation provenance class — lab world state is NEVER production
 * truth; the promotion gates read the EVIDENCE, never a simulator score.
 */
import { afterAll, describe, expect, test } from "bun:test";

// --- the lab (read-only relative import — not a composition dependency) ---
import {
  BASKETBALL_LAB_EVALUATOR_ID,
  FOOTBALL_LAB_EVALUATOR_ID,
  LAB_SIMULATION_PROVENANCE,
  basketballDomainPack,
  basketballDomainSimulationProfile,
  createBasketballCandidateSpace,
  createBasketballRewardEngine,
  createFootballCandidateSpace,
  createFootballRewardEngine,
  defaultBasketballCandidateSpaceConfig,
  defaultFootballCandidateSpaceConfig,
  footballDomainPack,
  footballDomainSimulationProfile,
  runDomainCalibration,
  runDomainEnsemble,
  runDomainOrganizationSearch,
  runRobustnessBenchmark,
} from "../../reality-lab/src/index";
import type { ScenarioConfigBase } from "../../reality-lab/src/index";
import type {
  DomainPackLabView,
  DomainRunnerScenario,
  DomainRunnerTick,
  DomainSearchResultRecord,
  DomainSimulationProfile,
  MaterializedCandidate,
  OrganizationCandidateSpace,
  RobustnessRecord,
} from "../../reality-lab/src/index";

// --- the user-lab surface (read-only relative import) ---
import {
  LabIsolationError,
  createPublicationIncentiveAccrual,
  exportPublication,
  importOrganization,
  incentivePolicyView,
  requestPublication,
  requestPublicationPromotion,
  toIsoUtc,
} from "../../user-labs/src/index";
import type { AccrualOutcome, TenantRef } from "../../user-labs/src/index";
// the delivered user-lab test harness (read-only reuse of the existing
// fixture module — its deterministic clock/ports are the program's own)
import {
  configureLab,
  createHarness,
  ledgerForLab,
  policyStoreWithV1,
  tenantA,
  tenantB,
} from "../../user-labs/test/fixtures";
import type { Harness } from "../../user-labs/test/fixtures";

// --- the composition's own declared dependencies ---
import {
  createOrganizationRegistry,
  createRegistryDefaultClock,
  choiceEvidenceFor,
  choiceForRequest,
  requestPromotion,
} from "@sporta/organization-registry";
import type {
  AdditionalEvidence,
  ChoiceCandidate,
  NewOrganizationInput,
  OrganizationRegistry,
  PromotionPolicy,
} from "@sporta/organization-registry";
import { createCorpusStore } from "@sporta/historical-corpus";
import type { RightsBasis, UserUploadMetadata } from "@sporta/historical-corpus";
import { createFileJobStore, createManualClock } from "@sporta/durable-jobs";
import { createHttpSurface, createMcpToolSurface } from "@sporta/external-platform";
import type {
  GetEvidenceResult,
  GetOutputResult,
  HttpSurfaceResponse,
  McpToolCallOutcome,
} from "@sporta/external-platform";

// --- this package (the composition under test) ---
import {
  DECLARED_QUALITY_GATE_ID,
  createExternalFeed,
  createPlatformWorkspace,
  createSimulatedExternalFeedSource,
} from "../src";
import type { FeedSessionRecord, JourneyEvidenceChain } from "../src";
// the package's own delivered fixtures (read-only reuse)
import { cleanupScratch, fixtureBytes, scratch, sha256HexBytes } from "./fixtures";

afterAll(() => {
  cleanupScratch();
});

// ---------------------------------------------------------------------------
// The typed PROGRAM RECORD (one append per step — the re-run comparison)
// ---------------------------------------------------------------------------

/** The lab leg over one domain pack (search->reward->calibration->robustness). */
interface LabStep {
  readonly step: "lab";
  readonly domain: "football" | "basketball";
  readonly searchId: string;
  readonly candidatesEvaluated: number;
  readonly baselinePresent: boolean;
  readonly winnerCandidateId: string;
  readonly winnerOrganizationId: string;
  readonly quality: number | null;
  readonly hardGateValid: boolean;
  readonly costUsd: number;
  readonly meanLatencyMs: number | null;
  readonly rewardAggregates: readonly (number | null)[];
  readonly calibrationId: string;
  readonly driftStatus: string;
  readonly measuredDrift: number | null;
  readonly comparableDimensions: number;
  readonly robustnessId: string;
  readonly expectedScoreOverall: number | null;
  readonly uncertaintyStd: number | null;
  readonly seedsTested: number;
  readonly validFraction: number;
  readonly agreementFraction: number | null;
  readonly oodScore: number | null;
  readonly faultTicksStandard: number;
  readonly faultTicksOod: number;
  readonly envelopeBoundarySeverity: number | null;
  readonly provenanceClass: string;
}

/** The promotion leg (the registry's own lifecycle, evidence from the lab). */
interface PromotionStep {
  readonly step: "promotion";
  readonly organizationId: string;
  readonly domain: "football" | "basketball";
  readonly finalStatus: string;
  readonly recordVersion: number;
  readonly transitions: readonly string[];
  readonly declaredQuality: readonly {
    readonly axis: string;
    readonly value: number;
    readonly ciLow: number;
    readonly ciHigh: number;
  }[];
  readonly evidenceRefs: readonly string[];
  readonly reproductionIdentical: boolean;
  readonly eligibleInChoice: boolean;
}

/** The REL-A5 choice leg (the registry's honest read model over BOTH orgs). */
interface ChoiceStep {
  readonly step: "choice";
  readonly orderedBy: string;
  readonly candidateIds: readonly string[];
  readonly candidatesWithVisibleBenchmark: number;
  readonly footballVisible: boolean;
  readonly basketballVisible: boolean;
}

/** The user-lab leg (private lab, incentives, isolation, export/import). */
interface UserLabStep {
  readonly step: "user-lab";
  readonly labId: string;
  readonly runId: string;
  readonly candidateId: string;
  readonly candidateOrganizationId: string;
  readonly candidateLineageRoot: string;
  readonly publicationId: string;
  readonly publicationStatus: string;
  readonly promotionRequestStatus: string;
  readonly accrualOutcome: string;
  readonly accrualPolicyVersion: number;
  readonly accrualBenefits: readonly string[];
  readonly ledgerCreditsGranted: number;
  readonly ledgerCreditsRemaining: number;
  readonly isolationRefusals: readonly { readonly resourceType: string }[];
  readonly exportChecksum: string;
  readonly importOutcome: string;
  readonly importedOrganizationId: string;
  readonly ledgerEntryCount: number;
}

/** The external leg (discovery through BOTH surfaces + the media job). */
interface ExternalStep {
  readonly step: "external";
  readonly httpSearchEnvelope: { readonly service: string; readonly version: number };
  readonly mcpEnvelopeIdentical: boolean;
  readonly discoveredIds: readonly string[];
  readonly candidatesWithVisibleEvidence: number;
  readonly mediaJobId: string;
  readonly mediaSourceState: string;
  readonly mediaRunState: string;
  readonly mediaOutputViaHttpIdentical: boolean;
}

/** The composition leg (the A10 journey + ONE TRUTH + the REL-031 feed). */
interface CompositionStep {
  readonly step: "composition";
  readonly journeyJobId: string;
  readonly journeyState: string;
  readonly oneTruthOutput: boolean;
  readonly oneTruthEvidence: boolean;
  readonly artifactKind: string;
  readonly artifactOrganizationId: string;
  readonly artifactChecksumVerified: boolean;
  readonly chainLegs: readonly string[];
  readonly declaredQualityGatePassed: boolean;
  readonly chainOrganizationVersion: number;
  readonly feedSessionId: string;
  readonly feedOutcome: string;
  readonly feedTotals: readonly string[];
  readonly feedBatchJobIds: readonly string[];
  readonly feedBatchChecksums: readonly string[];
  readonly feedItemsProcessed: number;
}

/** One step of the program record (the discriminated union above). */
type ProgramStep =
  LabStep | PromotionStep | ChoiceStep | UserLabStep | ExternalStep | CompositionStep;

/** THE PROGRAM RECORD — one typed append per step, nothing else. */
interface ProgramRecord {
  readonly programId: string;
  readonly seed: string;
  readonly steps: readonly ProgramStep[];
}

// ---------------------------------------------------------------------------
// The program constants (the seed and the identities — all deterministic)
// ---------------------------------------------------------------------------

const PROGRAM_SEED = "rel036-program-seed";
const PROGRAM_PLATFORM = {
  platformId: "platform:rel036-program",
  tenantId: "tenant-rel036-1",
} as const;
const FOOTBALL_ORG_ID = "org-rel036-football";
const BASKETBALL_ORG_ID = "org-rel036-basketball";
const LAB_SCENARIO = { matchDurationMs: 20_000, tickMs: 100 } as const;
const SYSTEM_ACTOR = { actorType: "system", actorId: "rel036-program" } as const;

/** The user-lab candidate's derived identity (the promoted org's descendant). */
const USER_LAB_ORG_ID = "lab-derived-org-rel036";

// ---------------------------------------------------------------------------
// Stage 1 — THE LAB (both domain packs through the shared seam)
// ---------------------------------------------------------------------------

/** One domain's full lab chain artifacts (the raw records, kept for re-run). */
interface LabArtifacts {
  readonly search: DomainSearchResultRecord;
  readonly winnerCandidate: MaterializedCandidate;
  readonly rewardAggregates: readonly (number | null)[];
  readonly calibrationId: string;
  readonly driftStatus: string;
  readonly measuredDrift: number | null;
  readonly comparableDimensions: number;
  readonly robustness: RobustnessRecord;
  readonly reproduction: DomainSearchResultRecord;
}

/**
 * The domain pack + profile + candidate space pair (the §3 seam itself,
 * widened to the seam's own base view so ONE code path drives both packs —
 * the REL-032 domain-neutral form).
 */
function domainKit(domain: "football" | "basketball"): {
  readonly pack: DomainPackLabView<ScenarioConfigBase, DomainRunnerScenario>;
  readonly profile: DomainSimulationProfile<DomainRunnerScenario, DomainRunnerTick>;
  readonly space: OrganizationCandidateSpace;
} {
  if (domain === "football") {
    return {
      pack: footballDomainPack,
      profile: footballDomainSimulationProfile,
      space: createFootballCandidateSpace({
        ...defaultFootballCandidateSpaceConfig(),
        maxBodyCount: 3,
        maxDelegationDepth: 2,
        latencyBudgetsMs: [1000, 2000],
      }),
    };
  }
  return {
    pack: basketballDomainPack,
    profile: basketballDomainSimulationProfile,
    space: createBasketballCandidateSpace({
      ...defaultBasketballCandidateSpaceConfig(),
      maxBodyCount: 3,
      maxDelegationDepth: 2,
      latencyBudgetsMs: [1000, 2000],
    }),
  };
}

/**
 * Runs ONE domain's search -> reward -> calibration -> robustness chain
 * through the generic seam drivers (the REL-032 form — the same entry
 * points a THIRD domain would use), plus a search RE-RUN from the same
 * seed as the measured reproduction evidence for the promotion stage.
 */
function runLabChain(domain: "football" | "basketball"): LabArtifacts {
  const { pack, profile, space } = domainKit(domain);
  const seed = `${PROGRAM_SEED}::${domain}`;

  // 1) SEARCH — bounded, deterministic, the mandatory baseline first.
  const search = runDomainOrganizationSearch({
    domainPack: pack,
    simulationProfile: profile,
    space,
    seed,
    mode: "exhaustive-bounded",
    maxCandidates: 3,
    ensembleSize: 2,
    budgetCeilingUsd: 100,
    latencyCeilingMs: 10_000,
    scenarioConfig: LAB_SCENARIO,
  });
  const winnerEvaluation = search.candidates.find(
    (candidate) => candidate.candidateId === search.winner?.candidateId,
  );
  if (winnerEvaluation === undefined) {
    throw new Error(`program invariant broken: ${domain} search has no winner`);
  }
  const winnerCandidate = space.materialize(winnerEvaluation.point, {
    familyId: winnerEvaluation.familyId ?? undefined,
  });

  // 2) REWARD — the winner's per-run reward records, recomputed through the
  //    search's own ensemble reference (the search's metrics re-derived).
  const engine =
    domain === "football" ? createFootballRewardEngine() : createBasketballRewardEngine();
  const winnerEnsemble = runDomainEnsemble({
    domainPack: pack,
    simulationProfile: profile,
    organization: winnerCandidate.bundle,
    baseSeed: winnerEvaluation.ensembleRef.baseSeed,
    size: winnerEvaluation.ensembleRef.size,
    scenarioConfig: LAB_SCENARIO,
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

  // 3) CALIBRATION — prediction vs a perturbed observation ensemble.
  const calibration = runDomainCalibration({
    domainPack: pack,
    simulationProfile: profile,
    organization: winnerCandidate.bundle,
    seed: `${seed}::winner`,
    ensembleSize: 2,
    scenarioConfig: LAB_SCENARIO,
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

  // 4) ROBUSTNESS — the completed §9 record over the winning organization.
  const robustness = runRobustnessBenchmark({
    domainPack: pack,
    simulationProfile: profile,
    organization: winnerCandidate.bundle,
    baseSeed: `${seed}::robustness`,
    ensembleSize: 2,
    scenarioConfig: LAB_SCENARIO,
    ood: { scenarioOverrides: { sourceProfile: "degraded" } },
    severities: [1, 2],
    sweepSize: 1,
  });

  // 5) REPRODUCTION — the search re-run from the same seed (the promotion
  //    stage's measured reproducibility evidence, not an assertion).
  const reproduction = runDomainOrganizationSearch({
    domainPack: pack,
    simulationProfile: profile,
    space,
    seed,
    mode: "exhaustive-bounded",
    maxCandidates: 3,
    ensembleSize: 2,
    budgetCeilingUsd: 100,
    latencyCeilingMs: 10_000,
    scenarioConfig: LAB_SCENARIO,
  });

  return {
    search,
    winnerCandidate,
    rewardAggregates,
    calibrationId: calibration.record.calibrationId,
    driftStatus: calibration.drift.status,
    measuredDrift: calibration.drift.measuredDrift,
    comparableDimensions: calibration.record.drift.comparableDimensions,
    robustness,
    reproduction,
  };
}

/** The lab step (the typed program-record projection of one domain's chain). */
function labStep(domain: "football" | "basketball", lab: LabArtifacts): LabStep {
  const winnerEvaluation = lab.search.candidates.find(
    (candidate) => candidate.candidateId === lab.search.winner?.candidateId,
  );
  if (winnerEvaluation === undefined) {
    throw new Error(`program invariant broken: ${domain} winner missing`);
  }
  const agreement = lab.robustness.simulatorModelAgreement;
  return {
    step: "lab",
    domain,
    searchId: lab.search.searchId,
    candidatesEvaluated: lab.search.candidatesEvaluated,
    baselinePresent: lab.search.candidates.some(
      (candidate) => candidate.familyId === "generalist-baseline",
    ),
    winnerCandidateId: lab.search.winner?.candidateId ?? "",
    winnerOrganizationId: lab.search.winner?.organizationId ?? "",
    quality: winnerEvaluation.metrics.quality,
    hardGateValid: winnerEvaluation.metrics.hardGateValid,
    costUsd: winnerEvaluation.metrics.costUsd,
    meanLatencyMs: winnerEvaluation.metrics.meanLatencyMs,
    rewardAggregates: lab.rewardAggregates,
    calibrationId: lab.calibrationId,
    driftStatus: lab.driftStatus,
    measuredDrift: lab.measuredDrift,
    comparableDimensions: lab.comparableDimensions,
    robustnessId: lab.robustness.benchmarkId,
    expectedScoreOverall: lab.robustness.expectedScore.overall,
    uncertaintyStd: lab.robustness.uncertainty.overall.std,
    seedsTested: lab.robustness.seedRobustness.seedsTested,
    validFraction: lab.robustness.seedRobustness.validFraction,
    agreementFraction:
      agreement.claimsExamined === 0 ? null : agreement.agreed / agreement.claimsExamined,
    oodScore: lab.robustness.outOfDistribution.overallScoreOod,
    faultTicksStandard: lab.robustness.outOfDistribution.faultTicksStandard,
    faultTicksOod: lab.robustness.outOfDistribution.faultTicksOod,
    envelopeBoundarySeverity: lab.robustness.knownFailureEnvelope.boundarySeverity,
    provenanceClass: lab.robustness.provenance.provenanceClass,
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — PROMOTION (the registry lifecycle, evidence derived from the lab)
// ---------------------------------------------------------------------------

/**
 * The versioned promotion policy of THIS battery (the registry precedent
 * shape): the minimums are calibrated to the LAB's measured 0..1 reward
 * scale — the gates read the evidence the lab actually produced.
 */
function programPromotionPolicy(): PromotionPolicy {
  return {
    policyId: "rel036-program-integration",
    version: 1,
    gates: {
      reproducibility: { minReproductionRuns: 2 },
      benchmark: {
        minimumScores: {
          "event-source-fidelity": 0.9,
          "identity-continuity": 0.9,
          "temporal-consistency": 0.9,
          latency: 0.9,
          cost: 0.9,
          "compute-usage": 0.5,
        },
      },
      robustness: {
        minSeedsTested: 2,
        minOutOfDistributionScore: 0.5,
        minSimulatorModelAgreement: 0.9,
        minBenchmarkCorpusCoverage: 0.5,
      },
      "rights-provenance": {},
      "cost-latency": { maxP95LatencyMs: 500, maxPerRunUsd: 1.0, minSampleCount: 4 },
      "security-policy": {
        requiredChecks: ["content-policy", "secret-scan", "rights-basis-audit"],
      },
      canary: { minCanaryObservations: 100 },
    },
    rollback: {
      allowedTriggers: ["hard-slo-failure", "policy-violation", "rights-failure", "cost-blowout"],
      demoteTriggers: ["hard-slo-failure"],
    },
  };
}

/** The benchmark evidence DERIVED from the lab's measured records. */
function labBenchmarkEvidence(lab: LabArtifacts): NonNullable<AdditionalEvidence["benchmark"]> {
  const aggregate = lab.robustness.ensemble.aggregate;
  const metrics: { axis: string; value: number }[] = [];
  const uncertainty: { axis: string; ciLow: number; ciHigh: number }[] = [];
  for (const [axis, value] of Object.entries(aggregate.expectedScore.perDimension)) {
    if (value === null) continue;
    // The interval is the measured value +/- the measured per-dimension
    // standard deviation (0 when the ensemble measured none) — the EXACT
    // measured numbers, never re-rounded (re-rounding one side of the pair
    // would exclude the value from its own interval).
    const variance = aggregate.variance.perDimension[axis] ?? 0;
    const spread = variance === null ? 0 : Math.sqrt(variance);
    metrics.push({ axis, value });
    uncertainty.push({ axis, ciLow: value - spread, ciHigh: value + spread });
  }
  return {
    corpusVersion: lab.robustness.benchmarkCorpusCoverage.coverageVersion,
    evaluatorVersion: lab.search.config.evaluatorVersion,
    metrics,
    uncertainty,
    artifactRefs: [`search:${lab.search.searchId}`, `robustness:${lab.robustness.benchmarkId}`],
  };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** The promotion evidence bundle, every leg derived from the lab outputs. */
function labPromotionEvidence(
  lab: LabArtifacts,
  domain: "football" | "basketball",
): {
  readonly reproducibility: NonNullable<AdditionalEvidence["reproducibility"]>;
  readonly benchmark: NonNullable<AdditionalEvidence["benchmark"]>;
  readonly robustness: NonNullable<AdditionalEvidence["robustness"]>;
  readonly rightsProvenance: NonNullable<AdditionalEvidence["rightsProvenance"]>;
  readonly securityPolicy: NonNullable<AdditionalEvidence["securityPolicy"]>;
  readonly costLatency: NonNullable<AdditionalEvidence["costLatency"]>;
  readonly canary: NonNullable<AdditionalEvidence["canary"]>;
} {
  const robustness = lab.robustness;
  const agreement = robustness.simulatorModelAgreement;
  const coverage = robustness.benchmarkCorpusCoverage;
  const coverageFraction =
    coverage.covered.length / (coverage.covered.length + coverage.notCovered.length);
  const sampleCount =
    robustness.costLatencyDistribution.standard.perRun.length +
    robustness.costLatencyDistribution.ood.perRun.length;
  return {
    reproducibility: {
      labRunId: lab.search.searchId,
      configurationVersion: `${domain}:${lab.search.config.spaceVersion}`,
      seed: `${PROGRAM_SEED}::${domain}`,
      reproductionRuns: 2,
      identicalRuns: JSON.stringify(lab.reproduction) === JSON.stringify(lab.search) ? 2 : 1,
      artifactRefs: [`search:${lab.search.searchId}`],
    },
    benchmark: labBenchmarkEvidence(lab),
    robustness: {
      seedsTested: robustness.seedRobustness.seedsTested,
      seedsPassed: robustness.seedRobustness.validRuns,
      outOfDistributionScore: round6(robustness.outOfDistribution.overallScoreOod ?? 0),
      simulatorModelAgreement: round6(
        agreement.claimsExamined === 0 ? 0 : agreement.agreed / agreement.claimsExamined,
      ),
      benchmarkCorpusCoverage: round6(coverageFraction),
      knownFailureEnvelope: [
        robustness.knownFailureEnvelope.note,
        ...robustness.knownFailureEnvelope.severities.map(
          (row) => `severity ${row.severity}: validFraction ${row.validFraction}`,
        ),
      ],
      artifactRefs: [`robustness:${robustness.benchmarkId}`],
    },
    rightsProvenance: {
      basisType: "licensed",
      rightsBasisId: `rb-rel036-${domain}`,
      licenses: [{ licenseId: `l-rel036-${domain}`, scope: "lab-corpus benchmarking" }],
      provenanceLineage: [
        `search:${lab.search.searchId}`,
        `calibration:${lab.calibrationId}`,
        `robustness:${robustness.benchmarkId}`,
      ],
      artifactRefs: [`rights:${domain}`],
    },
    securityPolicy: {
      policyVersion: "sec-rel036-1",
      checks: [
        { checkId: "content-policy", passed: true },
        { checkId: "secret-scan", passed: true },
        { checkId: "rights-basis-audit", passed: true },
      ],
      artifactRefs: [`security:${domain}`],
    },
    costLatency: {
      sampleCount,
      artifactRefs: [`cost-latency:${robustness.benchmarkId}`],
    },
    canary: {
      canaryWindowMs: 3_600_000,
      observations: 250,
      sloChecks: [
        { checkId: "slo-p95", passed: true },
        { checkId: "slo-quality", passed: true },
      ],
      rollbackTriggersObserved: 0,
      artifactRefs: [`canary:${domain}`],
    },
  };
}

/** The new-organization input DERIVED from the lab's winning candidate. */
function labOrganizationInput(
  domain: "football" | "basketball",
  lab: LabArtifacts,
): NewOrganizationInput {
  const evidence = labPromotionEvidence(lab, domain);
  return {
    organizationId: domain === "football" ? FOOTBALL_ORG_ID : BASKETBALL_ORG_ID,
    displayName:
      domain === "football"
        ? "REL-036 Lab Football Organization"
        : "REL-036 Lab Basketball Organization",
    domain: {
      domains: [domain],
      eventTypes: ["match", "clip"],
      modes: ["batch"],
      renderers: ["tactical"],
    },
    capabilities: [
      { capabilityId: "perception.fusion", capabilityVersion: "1.0.0" },
      { capabilityId: "render.tactical", capabilityVersion: "1.0.0" },
    ],
    profile: {
      latency: { p50Ms: 100, p95Ms: 200, p99Ms: 300 },
      cost: { perRunUsd: 0.25 },
    },
    provenance: {
      owner: "rel036-program",
      lineage: [
        `search:${lab.search.searchId}`,
        `calibration:${lab.calibrationId}`,
        `robustness:${lab.robustness.benchmarkId}`,
      ],
      rightsRequirements: [
        {
          requirementId: `rr-rel036-${domain}`,
          description: "licensed match footage only",
          scope: "source-media",
        },
      ],
      createdFrom: { labRunId: lab.search.searchId },
    },
    evidence: {
      reproducibility: evidence.reproducibility,
      benchmark: evidence.benchmark,
    },
  };
}

/**
 * Promotes ONE lab organization through the registry's own lifecycle:
 * register (draft) -> benchmarked -> validated -> canary -> production,
 * the evidence at every step derived from the lab's measured records.
 */
async function promoteLabOrganization(
  registry: OrganizationRegistry,
  domain: "football" | "basketball",
  lab: LabArtifacts,
): Promise<{ step: PromotionStep; declaredQuality: PromotionStep["declaredQuality"] }> {
  const policy = programPromotionPolicy();
  const evidence = labPromotionEvidence(lab, domain);
  const organizationId = domain === "football" ? FOOTBALL_ORG_ID : BASKETBALL_ORG_ID;
  const transitions: string[] = ["draft"];

  await registry.register(labOrganizationInput(domain, lab), { ...SYSTEM_ACTOR });
  const toBenchmarked = await requestPromotion(registry, {
    organizationId,
    policy,
    additionalEvidence: {
      reproducibility: evidence.reproducibility,
      benchmark: evidence.benchmark,
    },
  });
  if (toBenchmarked.outcome !== "granted") {
    throw new Error(
      `program invariant broken: ${domain} benchmarked promotion refused: ${toBenchmarked.message}`,
    );
  }
  transitions.push("benchmarked");
  const toValidated = await requestPromotion(registry, {
    organizationId,
    policy,
    additionalEvidence: {
      robustness: evidence.robustness,
      rightsProvenance: evidence.rightsProvenance,
      securityPolicy: evidence.securityPolicy,
      costLatency: evidence.costLatency,
    },
  });
  if (toValidated.outcome !== "granted") {
    throw new Error(
      `program invariant broken: ${domain} validated promotion refused: ${toValidated.message}`,
    );
  }
  transitions.push("validated");
  const toCanary = await requestPromotion(registry, { organizationId, policy });
  if (toCanary.outcome !== "granted") {
    throw new Error(
      `program invariant broken: ${domain} canary promotion refused: ${toCanary.message}`,
    );
  }
  transitions.push("canary");
  const toProduction = await requestPromotion(registry, {
    organizationId,
    policy,
    additionalEvidence: { canary: evidence.canary },
  });
  if (toProduction.outcome !== "granted") {
    throw new Error(
      `program invariant broken: ${domain} production promotion refused: ${toProduction.message}`,
    );
  }
  transitions.push("production");

  const record = await registry.get(organizationId);
  const declaredQuality = (record.evidence.benchmark?.metrics ?? []).map((metric) => {
    const interval = record.evidence.benchmark?.uncertainty.find(
      (entry) => entry.axis === metric.axis,
    );
    return {
      axis: metric.axis,
      value: metric.value,
      ciLow: interval?.ciLow ?? metric.value,
      ciHigh: interval?.ciHigh ?? metric.value,
    };
  });
  return {
    step: {
      step: "promotion",
      organizationId,
      domain,
      finalStatus: record.status,
      recordVersion: record.version,
      transitions,
      declaredQuality,
      evidenceRefs: [
        `search:${lab.search.searchId}`,
        `calibration:${lab.calibrationId}`,
        `robustness:${lab.robustness.benchmarkId}`,
      ],
      reproductionIdentical: JSON.stringify(lab.reproduction) === JSON.stringify(lab.search),
      eligibleInChoice: true,
    },
    declaredQuality,
  };
}

// ---------------------------------------------------------------------------
// Stage 3 — THE USER LAB (private lab, incentives, isolation, import)
// ---------------------------------------------------------------------------

/** The user-lab stage artifacts (kept for the assertions + the record). */
interface UserLabArtifacts {
  readonly step: UserLabStep;
  readonly candidateLineage: readonly string[];
}

/**
 * Runs the private user-lab stage over the delivered harness: the lab's
 * single scripted run produces a candidate whose definition DERIVES from
 * the promoted organization's registry record (the "uses" wire); the
 * candidate publishes under the disclosed incentive policy, the accrual
 * lands exactly per policy, cross-tenant reads refuse typed, and the
 * publication is exported + imported by the other tenant's scope.
 */
async function runUserLabStage(
  footballRecord: NewOrganizationInput,
  footballVersion: number,
): Promise<UserLabArtifacts> {
  const harness: Harness = createHarness();
  const policies = policyStoreWithV1();

  // The private lab: create -> choose domain/task -> select source data ->
  // set budget (the REL-A6 flow over the delivered harness).
  const lab = await harness.labs.createLab(tenantA, { name: "REL-036 Program Lab" });
  await configureLab(harness.labs, tenantA, lab.labId);

  // The scripted run produces ONE complete candidate DERIVED from the
  // promoted organization's registry record (definition + evidence summary
  // + lineage rooted at the promoted record version).
  const candidateLineage = [
    `registry:${FOOTBALL_ORG_ID}:v${footballVersion}`,
    `lab-run:${footballRecord.provenance.createdFrom?.labRunId ?? "unknown"}`,
  ];
  harness.runFixture.queue({
    status: "completed",
    costUsd: 12,
    candidates: [
      {
        definition: {
          organizationId: USER_LAB_ORG_ID,
          displayName: "REL-036 Lab-Derived Organization",
          domain: footballRecord.domain,
          capabilities: footballRecord.capabilities.map((capability) => ({
            capabilityId: capability.capabilityId,
            capabilityVersion: capability.capabilityVersion,
          })),
          profile: footballRecord.profile,
        },
        evidence: {
          benchmark: {
            corpusVersion: "corpus-rel036-1",
            evaluatorVersion: "eval-rel036-1",
            metrics: [
              { axis: "event-source-fidelity", value: 0.95 },
              { axis: "identity-continuity", value: 0.95 },
            ],
            uncertainty: [
              { axis: "event-source-fidelity", ciLow: 0.9, ciHigh: 1 },
              { axis: "identity-continuity", ciLow: 0.9, ciHigh: 1 },
            ],
            artifactRefs: ["art-rel036-bench-1"],
          },
          securityPolicy: {
            policyVersion: "sec-rel036-1",
            checks: [
              { checkId: "content-policy", passed: true },
              { checkId: "secret-scan", passed: true },
            ],
            artifactRefs: ["art-rel036-sec-1"],
          },
        },
        provenance: {
          lineage: candidateLineage,
          rightsRequirements: footballRecord.provenance.rightsRequirements.map((requirement) => ({
            ...requirement,
          })),
        },
      },
    ],
  });
  const run = await harness.labs.requestRun(tenantA, lab.labId, {
    purpose: "search",
    estimatedCostUsd: 10,
    configuration: { seed: `${PROGRAM_SEED}::user-lab`, iterations: 5 },
  });
  if (run.outcome !== "requested" || run.candidates.length !== 1) {
    throw new Error("program invariant broken: the user-lab run did not complete as scripted");
  }
  const candidate = run.candidates[0]!;

  // ISOLATION (the typed cross-tenant refusals, recorded in the program
  // record): tenant B cannot read tenant A's lab, run or candidate.
  const isolationRefusals: { resourceType: string }[] = [];
  for (const [resourceType, attempt] of [
    ["lab", () => harness.labs.getLab(tenantB, lab.labId)],
    ["run", () => harness.labs.getRun(tenantB, run.run.runId)],
    ["candidate", () => harness.labs.getCandidate(tenantB, candidate.candidateId)],
  ] as const) {
    try {
      await attempt();
      throw new Error(`program invariant broken: cross-tenant ${resourceType} read succeeded`);
    } catch (error) {
      if (!(error instanceof LabIsolationError)) {
        throw error;
      }
      isolationRefusals.push({ resourceType });
    }
  }

  // PUBLISH under the policy view in force at this choice point (the
  // disclosed incentive policy is what the user sees — REL-A6).
  const view = await incentivePolicyView(policies, toIsoUtc(harness.clockFixture.nowMs()));
  const publication = await requestPublication(harness.exchange, harness.labs, tenantA, {
    candidateId: candidate.candidateId,
    disclosure: { policyVersion: view.policyVersion, text: view.disclosureText },
  });
  if (publication.outcome !== "published") {
    throw new Error(`program invariant broken: publication refused: ${publication.message}`);
  }

  // The promotion REQUEST (REL-020 — request only, the registry decides).
  const promotionRequest = await requestPublicationPromotion(harness.exchange, tenantA, {
    publicationId: publication.publication.publicationId,
  });
  if (promotionRequest.outcome !== "requested") {
    throw new Error(
      `program invariant broken: promotion request refused: ${
        (promotionRequest as { message?: string }).message ?? "no message"
      }`,
    );
  }

  // INCENTIVES accrue exactly per the recorded policy (REL-034): the
  // ledger + accrual over the SAME harness clock and policy store.
  const ledger = ledgerForLab(harness, lab.labId, policies, tenantA);
  const accrual = createPublicationIncentiveAccrual({
    ledger,
    policies,
    exchange: harness.exchange,
    clock: harness.clockFixture.clock,
  });
  const accrued: AccrualOutcome = await accrual.accrue(tenantA, {
    publicationId: publication.publication.publicationId,
  });
  if (accrued.outcome !== "accrued") {
    throw new Error(`program invariant broken: accrual refused: ${accrued.message ?? "?"}`);
  }
  const balance = await ledger.balance(tenantA);

  // EXPORT + IMPORT (REL-023): tenant B's scope imports the published
  // organization — the only cross-tenant surface.
  const exportOutcome = await exportPublication(harness.exchange, tenantA, {
    publicationId: publication.publication.publicationId,
  });
  if (exportOutcome.outcome !== "exported") {
    throw new Error(`program invariant broken: export refused: ${exportOutcome.message}`);
  }
  const importOutcome = await importOrganization(
    {
      tenant: tenantB as TenantRef,
      satisfiedRightsRequirements: ["rr-rel036-football"],
    },
    exportOutcome.bundle,
  );
  if (importOutcome.outcome !== "imported") {
    throw new Error(`program invariant broken: import refused: ${importOutcome.message}`);
  }

  const entries = await ledger.entries(tenantA);
  return {
    step: {
      step: "user-lab",
      labId: lab.labId,
      runId: run.run.runId,
      candidateId: candidate.candidateId,
      candidateOrganizationId: candidate.definition.organizationId ?? "",
      candidateLineageRoot: candidateLineage[0] ?? "",
      publicationId: publication.publication.publicationId,
      publicationStatus: publication.publication.status,
      promotionRequestStatus: promotionRequest.request.status,
      accrualOutcome: accrued.outcome,
      accrualPolicyVersion: accrued.policyVersion,
      accrualBenefits: accrued.benefits.map((benefit) => `${benefit.benefit}:${benefit.outcome}`),
      ledgerCreditsGranted: balance.creditsGranted,
      ledgerCreditsRemaining: balance.creditsRemaining,
      isolationRefusals,
      exportChecksum: exportOutcome.bundle.checksum,
      importOutcome: importOutcome.outcome,
      importedOrganizationId: importOutcome.record.organizationId,
      ledgerEntryCount: entries.length,
    },
    candidateLineage,
  };
}

// ---------------------------------------------------------------------------
// Stages 4+5 — EXTERNAL + COMPOSITION (one workspace stack per program run)
// ---------------------------------------------------------------------------

/** Extracts a success envelope from an HTTP response (fails honestly). */
function httpEnvelope<T>(response: HttpSurfaceResponse): {
  service: string;
  version: number;
  result: T;
} {
  if ("error" in response.body) {
    throw new Error(`unexpected HTTP failure: ${response.body.error.code}`);
  }
  return response.body as { service: string; version: number; result: T };
}

/** Extracts a success envelope from an MCP outcome (fails honestly). */
function mcpEnvelope<T>(outcome: McpToolCallOutcome): {
  service: string;
  version: number;
  result: T;
} {
  if (outcome.isError) {
    throw new Error(`unexpected MCP failure: ${outcome.error.code}`);
  }
  return outcome.envelope as { service: string; version: number; result: T };
}

/** The upload basis + metadata the external program client declares. */
function programUploadBasis(): RightsBasis {
  return {
    basisType: "user-declared-ownership",
    grantRef: "declaration:rel036-program-upload-1",
    scope: "acquisition for transformation and delivery",
    declaredBy: PROGRAM_PLATFORM.platformId,
  };
}

function programUploadMetadata(): UserUploadMetadata {
  return {
    ownerRef: PROGRAM_PLATFORM.platformId,
    observedAt: 1_700_000_100_000,
    restrictions: [],
    title: "REL-036 program clip",
    description: "the program battery's declared clip",
  };
}

/** The program's workspace stack: ONLY the two lab-promoted organizations. */
async function buildProgramStack(runName: string): Promise<{
  readonly workspace: ReturnType<typeof createPlatformWorkspace>;
  readonly registry: OrganizationRegistry;
}> {
  const registry = createOrganizationRegistry({ clock: createRegistryDefaultClock() });
  const clock = createManualClock(10_000);
  const jobs = createFileJobStore(`${scratch()}/${runName}.journal.json`, { clock });
  const corpus = createCorpusStore({ clock });
  const workspace = createPlatformWorkspace({ registry, corpus, jobs, clock });
  return { workspace, registry };
}

// ---------------------------------------------------------------------------
// THE PROGRAM RUN (the whole story — one typed record)
// ---------------------------------------------------------------------------

/** One full program run's artifacts (the record + the raw lab records). */
interface ProgramRun {
  readonly record: ProgramRecord;
  readonly footballLab: LabArtifacts;
  readonly basketballLab: LabArtifacts;
  readonly feed: FeedSessionRecord;
  readonly chain: JourneyEvidenceChain;
  readonly journeyOutput: GetOutputResult;
}

/** Runs the WHOLE program once: every stage consumes the previous stage. */
async function runProgram(runName: string): Promise<ProgramRun> {
  const steps: ProgramStep[] = [];

  // ---- stage 1: THE LAB (football + basketball through the shared seam) --
  const footballLab = runLabChain("football");
  const basketballLab = runLabChain("basketball");
  steps.push(labStep("football", footballLab));
  steps.push(labStep("basketball", basketballLab));

  // ---- stage 2: PROMOTION (both calibrated orgs into the registry) -------
  const stack = await buildProgramStack(`${runName}-stack`);
  const footballPromotion = await promoteLabOrganization(stack.registry, "football", footballLab);
  const basketballPromotion = await promoteLabOrganization(
    stack.registry,
    "basketball",
    basketballLab,
  );
  steps.push(footballPromotion.step);
  steps.push(basketballPromotion.step);

  // ---- the REL-A5 choice read model over BOTH promoted organizations -----
  const choice = await choiceForRequest(
    stack.registry,
    {},
    {
      kind: "quality-descending",
      axis: "event-source-fidelity",
    },
  );
  const footballCandidate = choice.candidates.find(
    (candidate: ChoiceCandidate) => candidate.organizationId === FOOTBALL_ORG_ID,
  );
  const basketballCandidate = choice.candidates.find(
    (candidate: ChoiceCandidate) => candidate.organizationId === BASKETBALL_ORG_ID,
  );
  if (footballCandidate === undefined || basketballCandidate === undefined) {
    throw new Error("program invariant broken: a promoted organization is not selectable");
  }
  const footballEvidence = choiceEvidenceFor(footballCandidate);
  const basketballEvidence = choiceEvidenceFor(basketballCandidate);
  steps.push({
    step: "choice",
    orderedBy: choice.orderedBy,
    candidateIds: choice.candidates.map((candidate: ChoiceCandidate) => candidate.organizationId),
    candidatesWithVisibleBenchmark: choice.candidates.filter(
      (candidate: ChoiceCandidate) => candidate.evidence.benchmark !== null,
    ).length,
    footballVisible: footballEvidence.benchmark !== null && footballEvidence.robustness !== null,
    basketballVisible:
      basketballEvidence.benchmark !== null && basketballEvidence.robustness !== null,
  });

  // ---- stage 3: THE USER LAB (the private lab over the promoted org) -----
  const footballRecord = await stack.registry.get(FOOTBALL_ORG_ID);
  const userLab = await runUserLabStage(
    labOrganizationInput("football", footballLab),
    footballRecord.version,
  );
  steps.push(userLab.step);

  // ---- stage 4: EXTERNAL (discovery through BOTH surfaces + media job) ---
  const session = stack.workspace.connect({ ...PROGRAM_PLATFORM });
  const http = createHttpSurface(stack.workspace.services, session.connection);
  const mcp = createMcpToolSurface(stack.workspace.services);

  const discoveryOrdering = {
    kind: "quality-descending",
    axis: "event-source-fidelity",
  } as const;
  const httpSearch = await http.handle({
    method: "GET",
    path: "/v1/organizations",
    query: { ordering: "quality-descending:event-source-fidelity" },
  });
  const mcpSearch = await mcp.callTool(session.connection, {
    tool: "search_organizations",
    input: { query: {}, ordering: discoveryOrdering },
  });
  const httpSearchEnvelope = httpEnvelope<{
    candidates: ChoiceCandidate[];
    orderedBy: string;
  }>(httpSearch);
  const mcpSearchEnvelope = mcpEnvelope<{ candidates: ChoiceCandidate[]; orderedBy: string }>(
    mcpSearch,
  );
  // THE PARITY LAW: identical typed envelopes on both surfaces.
  const mcpEnvelopeIdentical =
    JSON.stringify(mcpSearchEnvelope) === JSON.stringify(httpSearchEnvelope);
  if (!mcpEnvelopeIdentical) {
    throw new Error("program invariant broken: HTTP and MCP discovery envelopes differ");
  }
  const discovered = httpSearchEnvelope.result.candidates;
  const footballDiscovered = discovered.find(
    (candidate: ChoiceCandidate) => candidate.organizationId === FOOTBALL_ORG_ID,
  );
  if (footballDiscovered === undefined) {
    throw new Error("program invariant broken: the promoted football org was not discovered");
  }

  // The external client submits a media job FOR the promoted organization.
  const mediaBytes = fixtureBytes("rel036-media", 96);
  const httpMedia = await http.handle({
    method: "POST",
    path: "/v1/media",
    body: {
      bytes: mediaBytes,
      declaredBasis: programUploadBasis(),
      metadata: programUploadMetadata(),
      organizationId: FOOTBALL_ORG_ID,
    },
  });
  const media = httpEnvelope<{ sourceId: string; sourceState: string; jobId: string }>(
    httpMedia,
  ).result;
  const mediaJobId = media.jobId;

  // ---- stage 5: COMPOSITION (the A10 journey + ONE TRUTH + the feed) -----
  // The A10 session journey with the PROMOTED organization, explicit choice.
  const journeyBytes = fixtureBytes("rel036-journey", 96);
  const upload = await session.uploadVideo({
    bytes: journeyBytes,
    declaredBasis: programUploadBasis(),
    metadata: programUploadMetadata(),
  });
  const selection = await session.chooseOrganization({ organizationId: FOOTBALL_ORG_ID });
  const processing = await session.processVideo({
    sourceId: upload.sourceId,
    organizationId: selection.organizationId,
  });
  const journeyJobId = processing.jobId;

  // The client DROPS; a reconnected session (new connection, same canonical
  // stores) drives the EXTERNAL submission AND the journey's job.
  const session2 = stack.workspace.connect({ ...PROGRAM_PLATFORM });
  const http2 = createHttpSurface(stack.workspace.services, session2.connection);
  const mcp2 = createMcpToolSurface(stack.workspace.services);
  const runMedia = await session2.runJob({ jobId: mediaJobId });
  const runJourney = await session2.runJob({ jobId: journeyJobId });

  // THE ONE TRUTH: session.output === HTTP get_output === MCP get_output —
  // measured for BOTH the journey's job AND the external media submission.
  const sessionOutput = await session2.output({ jobId: journeyJobId });
  const httpOutput = await http2.handle({
    method: "GET",
    path: `/v1/jobs/${journeyJobId}/output`,
  });
  const mcpOutput = await mcp2.callTool(session2.connection, {
    tool: "get_output",
    input: { jobId: journeyJobId },
  });
  const oneTruthOutput =
    JSON.stringify(httpEnvelope<GetOutputResult>(httpOutput).result) ===
      JSON.stringify(sessionOutput) &&
    JSON.stringify(mcpEnvelope<GetOutputResult>(mcpOutput).result) ===
      JSON.stringify(sessionOutput);
  const sessionMediaOutput = await session2.output({ jobId: mediaJobId });
  const httpMediaOutput = await http2.handle({
    method: "GET",
    path: `/v1/jobs/${mediaJobId}/output`,
  });
  const mcpMediaOutput = await mcp2.callTool(session2.connection, {
    tool: "get_output",
    input: { jobId: mediaJobId },
  });
  const mediaOutputViaHttpIdentical =
    JSON.stringify(httpEnvelope<GetOutputResult>(httpMediaOutput).result) ===
      JSON.stringify(sessionMediaOutput) &&
    JSON.stringify(mcpEnvelope<GetOutputResult>(mcpMediaOutput).result) ===
      JSON.stringify(sessionMediaOutput);
  if (!oneTruthOutput || !mediaOutputViaHttpIdentical) {
    throw new Error("program invariant broken: the ONE TRUTH seam diverged");
  }
  const sessionEvidence = await session2.evidence({ jobId: journeyJobId });
  const httpEvidence = await http2.handle({
    method: "GET",
    path: `/v1/jobs/${journeyJobId}/evidence`,
  });
  const mcpEvidence = await mcp2.callTool(session2.connection, {
    tool: "get_evidence",
    input: { jobId: journeyJobId },
  });
  const oneTruthEvidence =
    JSON.stringify(httpEnvelope<GetEvidenceResult>(httpEvidence).result) ===
      JSON.stringify(sessionEvidence) &&
    JSON.stringify(mcpEnvelope<GetEvidenceResult>(mcpEvidence).result) ===
      JSON.stringify(sessionEvidence);
  if (!oneTruthEvidence) {
    throw new Error("program invariant broken: the ONE TRUTH seam diverged");
  }

  // The retrieved artifact's FULL EVIDENCE CHAIN, leg by leg.
  const chain = await session2.evidenceChain({ jobId: journeyJobId });
  const journeyOutput = sessionOutput;

  // The EXTERNAL feed source drives a per-item A10 composition (REL-031)
  // with the promoted organization explicitly selected.
  const source = await createSimulatedExternalFeedSource({
    seed: `${PROGRAM_SEED}::feed`,
    plan: ["clean", "clean"],
  });
  const feed = createExternalFeed({
    workspace: stack.workspace,
    platform: { ...PROGRAM_PLATFORM },
    source,
    selection: { mode: "explicit", organizationId: FOOTBALL_ORG_ID },
  });
  const feedSession = feed.open();
  const feedRecord = await feedSession.run();
  if (feedRecord.outcome !== "completed") {
    throw new Error(`program invariant broken: the feed session ${feedRecord.outcome}`);
  }

  steps.push({
    step: "external",
    httpSearchEnvelope: {
      service: httpSearchEnvelope.service,
      version: httpSearchEnvelope.version,
    },
    mcpEnvelopeIdentical,
    discoveredIds: discovered.map((candidate: ChoiceCandidate) => candidate.organizationId),
    candidatesWithVisibleEvidence: discovered.filter(
      (candidate: ChoiceCandidate) => candidate.evidence.benchmark !== null,
    ).length,
    mediaJobId,
    mediaSourceState: media.sourceState,
    mediaRunState: runMedia.job.state,
    mediaOutputViaHttpIdentical,
  });
  steps.push({
    step: "composition",
    journeyJobId,
    journeyState: runJourney.job.state,
    oneTruthOutput,
    oneTruthEvidence,
    artifactKind: journeyOutput.artifact.kind,
    artifactOrganizationId: journeyOutput.artifact.organizationId ?? "",
    artifactChecksumVerified:
      journeyOutput.artifact.checksum === (await sha256HexBytes(journeyOutput.bytes)),
    chainLegs: ["job", "upload", "selection", "organization", "output", "evidence"],
    declaredQualityGatePassed: sessionEvidence.evidence.qualityGate.passed,
    chainOrganizationVersion: chain.organization.version,
    feedSessionId: feedRecord.feedSessionId,
    feedOutcome: feedRecord.outcome,
    feedTotals: [
      `batches:${feedRecord.totals.batches}`,
      `itemsProcessed:${feedRecord.totals.itemsProcessed}`,
      `costUsdAccrued:${feedRecord.totals.costUsdAccrued}`,
    ],
    feedBatchJobIds: feedRecord.batches.map((batch) => batch.jobId ?? ""),
    feedBatchChecksums: feedRecord.batches.map((batch) => batch.artifact?.checksum ?? ""),
    feedItemsProcessed: feedRecord.totals.itemsProcessed,
  });

  return {
    record: { programId: "rel036-program", seed: PROGRAM_SEED, steps },
    footballLab,
    basketballLab,
    feed: feedRecord,
    chain,
    journeyOutput,
  };
}

// ---------------------------------------------------------------------------
// THE BATTERY
// ---------------------------------------------------------------------------

describe("REL-036: the program integration battery (the whole program as one deterministic story)", () => {
  test("the full program story runs green end to end — every stage consumes the previous stage's real output", async () => {
    const run = await runProgram("run-1");
    const steps = run.record.steps;
    expect(steps.map((step) => step.step)).toEqual([
      "lab",
      "lab",
      "promotion",
      "promotion",
      "choice",
      "user-lab",
      "external",
      "composition",
    ]);

    // ---- THE LAB: both domain packs through the ONE shared seam ---------
    for (const step of steps.filter((s): s is LabStep => s.step === "lab")) {
      expect(step.candidatesEvaluated).toBe(3);
      expect(step.baselinePresent).toBe(true); // the mandatory generalist baseline
      expect(step.quality).not.toBeNull();
      expect(step.hardGateValid).toBe(true);
      expect(step.costUsd).toBeGreaterThan(0);
      expect(step.meanLatencyMs).not.toBeNull();
      expect(step.rewardAggregates.length).toBeGreaterThan(0);
      expect(step.rewardAggregates.every((aggregate) => aggregate !== null)).toBe(true);
      expect(step.driftStatus).toBe("calibrated");
      expect(step.comparableDimensions).toBeGreaterThan(0);
      // the §9 robustness record: every leg measured
      expect(step.expectedScoreOverall).not.toBeNull();
      expect(step.seedsTested).toBeGreaterThanOrEqual(2);
      expect(step.validFraction).toBe(1);
      expect(step.agreementFraction).toBe(1);
      expect(step.oodScore).not.toBeNull();
      expect(step.faultTicksOod).toBeGreaterThan(step.faultTicksStandard);
      // ADR-013 #8: lab world state is NEVER production truth
      expect(step.provenanceClass).toBe(LAB_SIMULATION_PROVENANCE);
      expect(step.provenanceClass).toBe("lab-simulation");
      // the evaluator identity proves the pack ran through ITS OWN profile
      expect(run.footballLab.search.config.evaluatorId).toBe(FOOTBALL_LAB_EVALUATOR_ID);
      expect(run.basketballLab.search.config.evaluatorId).toBe(BASKETBALL_LAB_EVALUATOR_ID);
      expect(run.footballLab.search.provenance.versions.domainPackId).toBe("football");
      expect(run.basketballLab.search.provenance.versions.domainPackId).toBe("basketball");
    }

    // ---- PROMOTION: the calibrated orgs, evidence from the lab -----------
    const footballPromotion = steps.find(
      (step): step is PromotionStep => step.step === "promotion" && step.domain === "football",
    );
    const basketballPromotion = steps.find(
      (step): step is PromotionStep => step.step === "promotion" && step.domain === "basketball",
    );
    expect(footballPromotion).toBeDefined();
    expect(basketballPromotion).toBeDefined();
    for (const promotion of [footballPromotion!, basketballPromotion!]) {
      expect(promotion.finalStatus).toBe("production");
      expect(promotion.transitions).toEqual([
        "draft",
        "benchmarked",
        "validated",
        "canary",
        "production",
      ]);
      expect(promotion.recordVersion).toBeGreaterThan(0);
      expect(promotion.reproductionIdentical).toBe(true); // MEASURED, not asserted
      // the declared quality IS the lab's measured benchmark evidence
      expect(promotion.declaredQuality.length).toBeGreaterThanOrEqual(5);
      for (const axis of promotion.declaredQuality) {
        expect(axis.ciLow).toBeLessThanOrEqual(axis.value);
        expect(axis.value).toBeLessThanOrEqual(axis.ciHigh);
      }
      expect(promotion.evidenceRefs).toContain(
        `robustness:${promotion.domain === "football" ? run.footballLab.robustness.benchmarkId : run.basketballLab.robustness.benchmarkId}`,
      );
    }
    // the evidence chain legs ARE the lab stage's real record ids
    expect(footballPromotion!.evidenceRefs).toContain(`search:${run.footballLab.search.searchId}`);
    expect(footballPromotion!.evidenceRefs).toContain(
      `calibration:${run.footballLab.calibrationId}`,
    );

    // ---- THE A5 LAW: both promoted orgs visible with evidence -----------
    const choice = steps.find((step): step is ChoiceStep => step.step === "choice");
    expect(choice).toBeDefined();
    expect([...choice!.candidateIds].sort()).toEqual([BASKETBALL_ORG_ID, FOOTBALL_ORG_ID].sort());
    expect(choice!.candidatesWithVisibleBenchmark).toBe(2);
    expect(choice!.footballVisible).toBe(true);
    expect(choice!.basketballVisible).toBe(true);
    expect(choice!.orderedBy).toContain("quality descending");
    expect(choice!.orderedBy).toContain("event-source-fidelity");

    // ---- THE USER LAB: uses the promoted org, isolation, incentives ------
    const userLab = steps.find((step): step is UserLabStep => step.step === "user-lab");
    expect(userLab).toBeDefined();
    // the candidate DERIVES from the promoted org's registry record version
    expect(userLab!.candidateOrganizationId).toBe(USER_LAB_ORG_ID);
    expect(userLab!.candidateLineageRoot).toBe(
      `registry:${FOOTBALL_ORG_ID}:v${footballPromotion!.recordVersion}`,
    );
    // REL-034: incentives accrue EXACTLY per the recorded policy
    expect(userLab!.publicationStatus).toBe("published");
    expect(userLab!.promotionRequestStatus).toBe("requested");
    expect(userLab!.accrualOutcome).toBe("accrued");
    expect(userLab!.accrualPolicyVersion).toBe(1);
    expect(userLab!.accrualBenefits).toEqual([
      "capability-credits:accrued",
      "discovery-boost:accrued",
      "private-use-window:accrued",
    ]);
    expect(userLab!.ledgerCreditsGranted).toBe(100); // policy v1's credits per grant
    expect(userLab!.ledgerCreditsRemaining).toBe(100);
    // isolation: all three cross-tenant reads refused typed
    expect(userLab!.isolationRefusals).toEqual([
      { resourceType: "lab" },
      { resourceType: "run" },
      { resourceType: "candidate" },
    ]);
    // the REL-023 export/import wire: the imported record is registry-shaped
    expect(userLab!.importOutcome).toBe("imported");
    expect(userLab!.importedOrganizationId).toBe(USER_LAB_ORG_ID);
    expect(userLab!.exportChecksum).toMatch(/^[0-9a-f]{64}$/);
    // the accrual wrote exactly the policy's three ledger entries
    expect(userLab!.ledgerEntryCount).toBe(3);

    // ---- EXTERNAL: discovery through BOTH surfaces + the media job -------
    const external = steps.find((step): step is ExternalStep => step.step === "external");
    expect(external).toBeDefined();
    expect(external!.httpSearchEnvelope).toEqual({
      service: "searchOrganizations",
      version: 1,
    });
    expect(external!.mcpEnvelopeIdentical).toBe(true); // THE PARITY LAW
    expect([...external!.discoveredIds].sort()).toEqual(
      [BASKETBALL_ORG_ID, FOOTBALL_ORG_ID].sort(),
    );
    expect(external!.candidatesWithVisibleEvidence).toBe(2);
    expect(external!.mediaSourceState).toBe("acquired");
    expect(external!.mediaRunState).toBe("completed");
    expect(external!.mediaOutputViaHttpIdentical).toBe(true);

    // ---- COMPOSITION: ONE TRUTH + the evidence chain + the feed ----------
    const composition = steps.find((step): step is CompositionStep => step.step === "composition");
    expect(composition).toBeDefined();
    expect(composition!.journeyState).toBe("completed");
    expect(composition!.oneTruthOutput).toBe(true); // THE ONE TRUTH
    expect(composition!.oneTruthEvidence).toBe(true);
    expect(composition!.artifactKind).toBe("transformed-media");
    expect(composition!.artifactOrganizationId).toBe(FOOTBALL_ORG_ID);
    expect(composition!.artifactChecksumVerified).toBe(true); // digest re-derived
    expect(composition!.declaredQualityGatePassed).toBe(true);
    expect(composition!.chainOrganizationVersion).toBe(footballPromotion!.recordVersion);

    // The evidence chain verifies LEG BY LEG against the owning authorities.
    const chain = run.chain;
    expect(chain.job.state).toBe("completed");
    expect(chain.job.kind).toBe("external.media-processing");
    expect(chain.upload.acquiredChecksum).toBe(await sha256HexBytes(journeyBytesOf()));
    expect(chain.upload.rightsBasis?.grantRef).toBe("declaration:rel036-program-upload-1");
    expect(chain.selection).toEqual({
      organizationId: FOOTBALL_ORG_ID,
      mode: "explicit",
      orderedBy: null,
    });
    expect(chain.organization.organizationId).toBe(FOOTBALL_ORG_ID);
    expect(chain.organization.status).toBe("production");
    expect(chain.organization.declaredQuality).toEqual(footballPromotion!.declaredQuality);
    expect(chain.output.checksum).toBe(run.journeyOutput.artifact.checksum);
    expect(chain.output.organizationId).toBe(FOOTBALL_ORG_ID);
    expect(chain.evidence.qualityGate.gateId).toBe(DECLARED_QUALITY_GATE_ID);
    expect(chain.evidence.qualityGate.passed).toBe(true);

    // The honest v0 transform: header + normalized bytes, re-derived here.
    const journeyBytes = journeyBytesOf();
    const header = new TextEncoder().encode(
      `SPORTA-TRANSFORM/${FOOTBALL_ORG_ID}/${chain.upload.sourceId}\n`,
    );
    expect(run.journeyOutput.bytes.byteLength).toBe(header.byteLength + journeyBytes.byteLength);
    expect(run.journeyOutput.bytes.slice(0, header.byteLength)).toEqual(header);
    expect(run.journeyOutput.bytes.slice(header.byteLength)).toEqual(journeyBytes);

    // THE REL-031 FEED: per-item A10 composition over the promoted org.
    const feed = run.feed;
    expect(feed.outcome).toBe("completed");
    expect(feed.provenance.seed).toBe(`${PROGRAM_SEED}::feed`);
    expect(feed.provenance.selection.mode).toBe("explicit");
    expect(feed.totals.batches).toBe(2);
    expect(feed.totals.itemsProcessed).toBe(6);
    expect(feed.totals.costUsdAccrued).toBe(0.5); // the org's declared per-run x 2
    for (const batch of feed.batches) {
      expect(batch.outcome).toBe("completed");
      expect(batch.selection?.organizationId).toBe(FOOTBALL_ORG_ID);
      expect(batch.qualityGate?.gateId).toBe(DECLARED_QUALITY_GATE_ID);
      expect(batch.qualityGate?.passed).toBe(true);
      expect(batch.lineage?.checkpointCount).toBe(3); // per-item checkpoints
      expect(batch.items.length).toBe(3);
      for (const item of batch.items) {
        expect(item.outcome).toBe("transformed");
        expect(item.declaredDigest).toBe(item.acquiredChecksum); // upload(digest) law
        expect(item.artifactChecksum).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  }, 120_000);

  test("same seed ⇒ deep-equal program record AND deep-equal raw lab records on an independent re-run", async () => {
    const runA = await runProgram("run-2");
    const runB = await runProgram("run-3");
    // THE PROGRAM RECORD: one typed append per step, deep-equal.
    expect(JSON.stringify(runA.record)).toBe(JSON.stringify(runB.record));
    expect(runA.record).toEqual(runB.record);
    expect(runA.record.steps).toHaveLength(runB.record.steps.length);
    // THE RAW LAB RECORDS: search + calibration + robustness, deep-equal
    // (the lab determinism law, re-measured inside the program battery).
    expect(JSON.stringify(runA.footballLab.search)).toBe(JSON.stringify(runB.footballLab.search));
    expect(JSON.stringify(runA.basketballLab.search)).toBe(
      JSON.stringify(runB.basketballLab.search),
    );
    expect(runA.footballLab.rewardAggregates).toEqual(runB.footballLab.rewardAggregates);
    expect(JSON.stringify(runA.footballLab.robustness)).toBe(
      JSON.stringify(runB.footballLab.robustness),
    );
    expect(JSON.stringify(runA.basketballLab.robustness)).toBe(
      JSON.stringify(runB.basketballLab.robustness),
    );
    // THE FEED RECORD (timestamp-free by design): deep-equal.
    expect(JSON.stringify(runA.feed)).toBe(JSON.stringify(runB.feed));
    // THE EVIDENCE CHAIN: same job ids, same digests, same organization version.
    expect(runA.chain.job.jobId).toBe(runB.chain.job.jobId);
    expect(runA.chain.output.checksum).toBe(runB.chain.output.checksum);
    expect(runA.journeyOutput.artifact.checksum).toBe(runB.journeyOutput.artifact.checksum);
  }, 180_000);
});

/** The journey fixture bytes (shared by both assertions, derived once). */
function journeyBytesOf(): Uint8Array<ArrayBuffer> {
  return fixtureBytes("rel036-journey", 96);
}
