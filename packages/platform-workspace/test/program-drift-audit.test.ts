/**
 * REL-036 — THE DRIFT AUDIT (the M11 finale, part 2): what main CLAIMS vs
 * what main DELIVERS.
 *
 * The audit pins, per program package, the AUDITABLE surface — a frozen
 * snapshot of the public export inventory every program package serves
 * (the export names the program relies on; a rename/removal that breaks
 * the program FAILS this audit), the BATTERY FLOOR per package (each
 * package's own `bun test` case count, RE-MEASURED by spawning the real
 * runner, must be >= the count the delivering worker's report claimed —
 * drift = silently deleted tests), the six ADR-013 §8 hard-invalidity
 * gate classes firing as TYPED REFUSALS in BOTH domain packs, and the
 * determinism spot pins on the seeds the prior workers' delivered tests
 * named (reality-lab's `chain-seed` / `bb-chain-seed`, platform-workspace's
 * `journey-seed` — each re-run twice, deep-equal).
 *
 * WHERE THE CLAIMS COME FROM (the repo is the source of truth): the merge
 * commits on main at 3b96943 carry the TL-gated battery numbers each
 * delivering worker reported — the floors below quote those messages. An
 * audit that fails honestly is a finding: a genuine gap is recorded as a
 * DEVIATION with the exact failing expectation, never patched around
 * (the audit may READ everything but MUTATE nothing authoritative).
 *
 * THE SPAWNED RE-MEASUREMENT: the battery floor is not a static count —
 * `bun test` is spawned per package (this package's own new REL-036 files
 * excluded by an explicit frozen file list, so the audit never recurses)
 * and the runner's own summary lines are parsed. A deleted file, a
 * deleted case or a failing suite all fail the floor.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

// --- the seven program packages, read-only --------------------------------
import * as realityLab from "../../reality-lab/src/index";
import * as userLabs from "../../user-labs/src/index";
import * as organizationRegistry from "@sporta/organization-registry";
import * as externalPlatform from "@sporta/external-platform";
import * as platformWorkspace from "../src";
import * as historicalCorpus from "@sporta/historical-corpus";
import * as durableJobs from "@sporta/durable-jobs";
import {
  BASKETBALL_HARD_INVALIDITY_RULES,
  FOOTBALL_HARD_INVALIDITY_RULES,
  LAB_SIMULATION_PROVENANCE,
  basketballDomainPack,
  basketballDomainSimulationProfile,
  checkLabClaims,
  createBasketballCandidateSpace,
  createFootballCandidateSpace,
  createFootballRewardEngine,
  defaultBasketballCandidateSpaceConfig,
  defaultFootballCandidateSpaceConfig,
  footballDomainPack,
  runCalibration,
  runDomainOrganizationSearch,
  runEnsemble,
  runOrganizationSearch,
} from "../../reality-lab/src/index";
import type { LabClaim, HardInvalidityContext } from "../../reality-lab/src/index";

// the delivered platform-workspace fixtures (read-only reuse — the twin
// stacks the feed determinism pin re-runs)
import { buildWorkspaceStack, cleanupScratch, SIMULATED_PLATFORM } from "./fixtures";
import { createExternalFeed, createSimulatedExternalFeedSource } from "../src";

afterAll(() => {
  cleanupScratch();
});

// ---------------------------------------------------------------------------
// Part 1 — the frozen EXPORT INVENTORY per program package
// ---------------------------------------------------------------------------

/** The frozen value-export inventory of @sporta/reality-lab (REL-001..008, 025, 032). */
const REALITY_LAB_EXPORTS: readonly string[] = [
  "BASKETBALL_ACTION_SPACE",
  "BASKETBALL_CAPABILITIES",
  "BASKETBALL_DOMAIN_PACK_ID",
  "BASKETBALL_DOMAIN_PACK_VERSION",
  "BASKETBALL_ENTITY_TYPES",
  "BASKETBALL_EVENT_TAXONOMY",
  "BASKETBALL_FAULT_PROFILES",
  "BASKETBALL_HARD_INVALIDITY_RULES",
  "BASKETBALL_LAB_EVALUATOR_ID",
  "BASKETBALL_LAB_EVALUATOR_VERSION",
  "BASKETBALL_OBSERVATION_TAXONOMY",
  "BASKETBALL_QUALITY_EVALUATORS",
  "BASKETBALL_RENDER_TARGETS",
  "BASKETBALL_REWARD_DIMENSIONS",
  "BASKETBALL_REWARD_WEIGHT_SETS",
  "BasketballBallStateSchema",
  "BasketballCourtFrameSchema",
  "BasketballOfficialStateSchema",
  "BasketballPlayerStateSchema",
  "BasketballWorldStateSchema",
  "BodyContractError",
  "CANDIDATE_SPECIALIST_ROLES",
  "CandidateSpaceError",
  "FAULT_KINDS",
  "FOOTBALL_ACTION_SPACE",
  "FOOTBALL_CAPABILITIES",
  "FOOTBALL_DOMAIN_PACK_ID",
  "FOOTBALL_DOMAIN_PACK_VERSION",
  "FOOTBALL_ENTITY_TYPES",
  "FOOTBALL_EVENT_TAXONOMY",
  "FOOTBALL_FAULT_PROFILES",
  "FOOTBALL_HARD_INVALIDITY_RULES",
  "FOOTBALL_LAB_EVALUATOR_ID",
  "FOOTBALL_LAB_EVALUATOR_VERSION",
  "FOOTBALL_OBSERVATION_TAXONOMY",
  "FOOTBALL_QUALITY_EVALUATORS",
  "FOOTBALL_RENDER_TARGETS",
  "FOOTBALL_REWARD_DIMENSIONS",
  "FOOTBALL_REWARD_WEIGHT_SETS",
  "FootballBallStateSchema",
  "FootballOfficialStateSchema",
  "FootballPitchFrameSchema",
  "FootballPlayerStateSchema",
  "FootballScenarioConfigSchema",
  "FootballWorldStateSchema",
  "LAB_SIMULATION_PROVENANCE",
  "LabApiError",
  "LabBodyActionSchema",
  "LabBodyInputSchema",
  "LabBodyOutputSchema",
  "LabConflictError",
  "LabInternalError",
  "LabNotFoundError",
  "LabProvenanceClass",
  "LabRng",
  "LabSimulationProvenanceLiteral",
  "LabValidationError",
  "OrganizationContractError",
  "REQUIRED_BODY_FIELDS",
  "REWARD_ENGINE_ID",
  "REWARD_ENGINE_VERSION",
  "activeFaultsAt",
  "aggregateLabRuns",
  "assertDomainLabRunReproduces",
  "assertLabRunReproduces",
  "assertProfileMatchesPack",
  "basketballDomainPack",
  "basketballDomainSimulationProfile",
  "basketballRewardWeightSets",
  "basketballScenarioGenerator",
  "candidatePointId",
  "candidatePointViolations",
  "candidateRoleForNode",
  "checkBasketballClaims",
  "checkFootballClaims",
  "checkLabClaims",
  "contentHash",
  "contentId",
  "createBasketballCandidateSpace",
  "createBasketballLabEvaluator",
  "createBasketballRewardEngine",
  "createBasketballWorldSimulator",
  "createCalibrationPort",
  "createCandidateRoleRuntime",
  "createDomainCandidateSpace",
  "createFootballCandidateSpace",
  "createFootballLabEvaluator",
  "createFootballRewardEngine",
  "createFootballWorldSimulator",
  "createGeneralistBody",
  "createGeneralistOrganization",
  "createGeneralistScriptedRuntime",
  "createLabEvaluator",
  "createListReplayAdapter",
  "createMeanErrorCalibrationAdapter",
  "createRewardEngine",
  "createScriptedModelRuntime",
  "createStandardHardInvalidityRules",
  "deepFreeze",
  "defaultBasketballCandidateSpaceConfig",
  "defaultFootballCandidateSpaceConfig",
  "detectCalibrationDrift",
  "deterministicDomainLabRun",
  "deterministicLabRun",
  "executionOrderWalk",
  "fixtureCandidateFamilies",
  "footballDomainPack",
  "footballDomainSimulationProfile",
  "footballEvaluatorRewardDimensions",
  "footballRewardWeightSets",
  "footballScenarioGenerator",
  "fusionScriptedHandler",
  "generalistBaselineFamily",
  "generalistScriptedHandler",
  "generateBasketballScenario",
  "generateFaultSchedule",
  "generateFootballScenario",
  "handDesignedPipelineFamily",
  "hasActiveFault",
  "hashSeedToUint32",
  "isHardInvalid",
  "isLabError",
  "isLabProvenanceClass",
  "parameterizedVariantsFamily",
  "perceptionScriptedHandler",
  "rankCandidateEvaluations",
  "renderScriptedHandler",
  "replayDomainLabRun",
  "replayLabRun",
  "runCalibration",
  "runDomainCalibration",
  "runDomainEnsemble",
  "runDomainLab",
  "runDomainOrganizationSearch",
  "runEnsemble",
  "runLab",
  "runOrganizationSearch",
  "runRobustnessBenchmark",
  "stableStringify",
  "standardRewardWeightSets",
  "validateAgentBody",
  "validateOrganization",
];

/** The frozen value-export inventory of @sporta/user-labs (REL-020..023, 034). */
const USER_LABS_EXPORTS: readonly string[] = [
  "BenchmarkEvidenceSummarySchema",
  "CANDIDATE_VISIBILITY",
  "CandidateDefinitionDraftSchema",
  "CandidateDefinitionSchema",
  "CandidateEvidenceSchema",
  "CapabilityBindingSchema",
  "CostEnvelopeSchema",
  "DomainCompatibilitySchema",
  "EXPORT_FORMAT_VERSION",
  "ImportScopeSchema",
  "IncentivePolicySchema",
  "LAB_STATUSES",
  "LEDGER_ENTRY_KINDS",
  "LabApiError",
  "LabBudgetSchema",
  "LabConflictError",
  "LabInternalError",
  "LabIsolationError",
  "LabNotFoundError",
  "LabRunCandidatePayloadSchema",
  "LabRunConfigurationSchema",
  "LabValidationError",
  "LatencyDistributionSchema",
  "MAX_PRIVATE_USE_WINDOW_DAYS",
  "NewLabInputSchema",
  "OperatingProfileSchema",
  "OrganizationExportSchema",
  "PROMOTION_REQUEST_STATUSES",
  "PUBLICATION_STATUSES",
  "RUN_PURPOSES",
  "RUN_STATUSES",
  "RightsRequirementSchema",
  "SOURCE_RIGHTS_BASIS_TYPES",
  "SecurityPolicyEvidenceSummarySchema",
  "TenantRefSchema",
  "USER_LABS_DEFAULT_EPOCH_MS",
  "checksumOf",
  "createExchange",
  "createIncentiveLedger",
  "createIncentivePolicyStore",
  "createPublicationIncentiveAccrual",
  "createSequentialIdSource",
  "createUserLabs",
  "createUserLabsDefaultClock",
  "exchangeEligibilityGaps",
  "exportChecksumPreimage",
  "exportPublication",
  "findExecutableValues",
  "importOrganization",
  "incentivePolicyView",
  "isLabError",
  "listPromotionRequests",
  "publicationGaps",
  "requestPublication",
  "requestPublicationPromotion",
  "requireTenantRef",
  "toIsoUtc",
  "verifyExportChecksum",
  "withdrawPromotionRequest",
  "withdrawPublication",
];

/** The frozen value-export inventory of @sporta/organization-registry (REL-017..019, 033). */
const ORGANIZATION_REGISTRY_EXPORTS: readonly string[] = [
  "AdditionalEvidenceSchema",
  "DomainCompatibilitySchema",
  "EligibilityQuerySchema",
  "GATE_IDS",
  "GENESIS_HASH",
  "LIFECYCLE_EDGES",
  "NewOrganizationInputSchema",
  "ORGANIZATION_STATUSES",
  "OrganizationStatusSchema",
  "PROMOTION_GATES_BY_TARGET",
  "REGISTRY_DEFAULT_EPOCH_MS",
  "ROLLBACK_TRIGGERS",
  "RegistryApiError",
  "RegistryConflictError",
  "RegistryInternalError",
  "RegistryNotFoundError",
  "RegistryValidationError",
  "SELECTABLE_STATUSES",
  "allGatesPassed",
  "applyChoiceOrdering",
  "canonicalJson",
  "captureProductionState",
  "choiceEvidenceFor",
  "choiceForRequest",
  "createCanaryFeed",
  "createCanaryMonitor",
  "createDefaultEntryIdSource",
  "createOrganizationRegistry",
  "createRegistryDefaultClock",
  "createSequentialIdSource",
  "describeChoiceOrdering",
  "diffProductionState",
  "evaluateBenchmarkGate",
  "evaluateCanaryGate",
  "evaluateCanaryObservations",
  "evaluateCostLatencyGate",
  "evaluateGate",
  "evaluateGates",
  "evaluateReproducibilityGate",
  "evaluateRightsProvenanceGate",
  "evaluateRobustnessGate",
  "evaluateSecurityPolicyGate",
  "forwardTargetFrom",
  "illegalTransitionReason",
  "isGateId",
  "isLegalTransition",
  "isRegistryError",
  "isRollbackTrigger",
  "isSelectableStatus",
  "isTerminalStatus",
  "legalTargetsFrom",
  "lifecycleEdge",
  "matchesQuery",
  "productionStateRestored",
  "requestPromotion",
  "requestRollback",
  "sha256Hex",
  "systemActor",
  "toChoiceCandidate",
  "toIsoUtc",
  "validatePromotionPolicy",
];

/** The frozen value-export inventory of @sporta/external-platform (REL-010..016, 030). */
const EXTERNAL_PLATFORM_EXPORTS: readonly string[] = [
  "BenchmarkQuerySchema",
  "ChoiceOrderingInputSchema",
  "ConnectRequestSchema",
  "EXTERNAL_SERVICES",
  "EXTERNAL_SERVICE_VERSION",
  "FeedItemSubmissionSchema",
  "FeedOrganizationSelectionSchema",
  "GetBenchmarkRequestSchema",
  "InspectOrganizationRequestSchema",
  "JobScopedRequestSchema",
  "LabRunRequestSchema",
  "LaunchLabRunRequestSchema",
  "MCP_TOOLS",
  "PLATFORM_DEFAULT_EPOCH_MS",
  "PlatformApiError",
  "PlatformConflictError",
  "PlatformInternalError",
  "PlatformJobStateError",
  "PlatformNotFoundError",
  "PlatformOrganizationPolicyError",
  "PlatformValidationError",
  "PromoteOrganizationRequestSchema",
  "SearchOrganizationsRequestSchema",
  "SubmitFeedRequestSchema",
  "SubmitMediaRequestSchema",
  "canonicalJson",
  "createChecksumQualityGate",
  "createDefaultConnectionIdSource",
  "createExternalPlatform",
  "createExternalPlatformServices",
  "createFeedProcessingExecutor",
  "createHeaderTransformer",
  "createHttpSurface",
  "createMcpToolSurface",
  "createMediaProcessingExecutor",
  "createPlatformDefaultClock",
  "createPlatformStores",
  "createSequentialIdSource",
  "httpStatusForFailureClass",
  "isPlatformError",
  "sha256Hex",
  "sha256HexBytes",
  "toTypedErrorRecord",
  "toIsoUtc",
];

/** The frozen value-export inventory of @sporta/platform-workspace (REL-024, 031). */
const PLATFORM_WORKSPACE_EXPORTS: readonly string[] = [
  "AutoSelectionRequestSchema",
  "DECLARED_QUALITY_GATE_ID",
  "DEFAULT_AUTO_ORDERING",
  "DEFAULT_FEED_BOUNDS",
  "ExplicitSelectionRequestSchema",
  "FEED_SOURCE_KIND",
  "FeedApiError",
  "FeedBoundsError",
  "FeedBoundsSchema",
  "FeedConflictError",
  "FeedSelectionSpecSchema",
  "FeedValidationError",
  "JobScopedRequestSchema",
  "OrganizationCatalogRequestSchema",
  "ProcessVideoRequestSchema",
  "UploadVideoRequestSchema",
  "WORKSPACE_DEFAULT_EPOCH_MS",
  "WorkspaceApiError",
  "WorkspaceConflictError",
  "WorkspaceInternalError",
  "WorkspaceJobStateError",
  "WorkspaceNotFoundError",
  "WorkspaceOrganizationSelectionError",
  "WorkspaceValidationError",
  "createDefaultConnectionIdSource",
  "createExternalFeed",
  "createOrganizationQualityGate",
  "createPlatformWorkspace",
  "createSequentialIdSource",
  "createSimulatedExternalFeedSource",
  "createWorkspaceDefaultClock",
  "feedSubmissionKey",
  "isFeedError",
  "isWorkspaceError",
  "toIsoUtc",
];

/** The frozen value-export inventory of @sporta/historical-corpus (REL-009..011, 026). */
const HISTORICAL_CORPUS_EXPORTS: readonly string[] = [
  "ACQUISITION_EDGES",
  "ACQUISITION_STATES",
  "AVAILABILITY_STATES",
  "AcquisitionStateSchema",
  "BenchmarkFixtureInputSchema",
  "BenchmarkSourceRefSchema",
  "CONNECTOR_BASIS_TYPES",
  "CONNECTOR_SOURCE_CLASSES",
  "CORPUS_DEFAULT_EPOCH_MS",
  "ComponentVersionSchema",
  "CorpusAccessInvalidError",
  "CorpusApiError",
  "CorpusBenchmarkIneligibleError",
  "CorpusBytesUnavailableError",
  "CorpusConflictError",
  "CorpusFixtureMismatchError",
  "CorpusIllegalTransitionError",
  "CorpusInternalError",
  "CorpusNotFoundError",
  "CorpusRestrictionError",
  "CorpusRightsBasisRequiredError",
  "CorpusValidationError",
  "DiscoveryQuerySchema",
  "FeatureBundleRefSchema",
  "MediaAvailabilitySchema",
  "RIGHTS_BASIS_TYPES",
  "RightsBasisSchema",
  "SOURCE_RESTRICTIONS",
  "SourceMetadataSchema",
  "SourceRestrictionsSchema",
  "TimeWindowSchema",
  "UserUploadMetadataSchema",
  "acquireSourceFromAdapter",
  "acquisitionEdge",
  "canonicalJson",
  "createAuthorizedFeedConnector",
  "createBenchmarkFixture",
  "createBenchmarkRegistrar",
  "createCorpusDefaultClock",
  "createCorpusStore",
  "createDefaultSourceIdSource",
  "createReferenceAdapter",
  "createReferenceOnlyConnector",
  "createRefusalLedger",
  "createSequentialIdSource",
  "createUserUploadConnector",
  "identityNormalizer",
  "illegalAcquisitionTransitionReason",
  "isAuthorizedByteAccess",
  "isCorpusError",
  "isLegalAcquisitionTransition",
  "isTerminalAcquisitionState",
  "legalAcquisitionTargetsFrom",
  "provenanceOf",
  "runAcquisitionJourney",
  "sha256Hex",
  "sha256HexBytes",
  "toIsoUtc",
];

/** The frozen value-export inventory of @sporta/durable-jobs (REL-012..013, 029). */
const DURABLE_JOBS_EXPORTS: readonly string[] = [
  "DEFAULT_RETRY_POLICY",
  "EnqueueJobInputSchema",
  "JOBS_DEFAULT_EPOCH_MS",
  "JOB_EDGES",
  "JOB_STATES",
  "JOURNAL_FORMAT",
  "JobStateSchema",
  "JobsApiError",
  "JobsCancellationSignal",
  "JobsConflictError",
  "JobsIllegalTransitionError",
  "JobsLeaseError",
  "JobsNotFoundError",
  "JobsStoreError",
  "JobsValidationError",
  "LEASED_STATES",
  "RetryPolicySchema",
  "TERMINAL_JOB_STATES",
  "canonicalJson",
  "computeBackoffMs",
  "createDefaultJobIdSource",
  "createFileJobStore",
  "createHarnessPort",
  "createJobsDefaultClock",
  "createManualClock",
  "createSequentialIdSource",
  "createWorkerRuntime",
  "foldJournal",
  "illegalJobTransitionReason",
  "isJobsError",
  "isLegalJobTransition",
  "isTerminalJobState",
  "isTerminalState",
  "jobEdge",
  "legalJobTargetsFrom",
  "lineageEquals",
  "lineageOf",
  "parseJournal",
  "readJournalFile",
  "serializeJournal",
  "sha256Hex",
  "toIsoUtc",
  "writeJournalAtomic",
];

// ---------------------------------------------------------------------------
// Part 2 — the BATTERY FLOOR per package (spawned re-measurement)
// ---------------------------------------------------------------------------

/** The repo root (the spawned batteries run there, one package at a time). */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/** One package's battery floor claim (quoting main's merge messages). */
interface BatteryFloor {
  readonly pkg: string;
  readonly cwd: string;
  /**
   * The frozen test-file list (null = the package's whole suite). This
   * package's own new REL-036 files are EXCLUDED so the spawned run never
   * recurses into this audit.
   */
  readonly files: readonly string[] | null;
  readonly claimedBy: string;
  readonly claimed: number;
}

/** The frozen pre-REL-036 test files of THIS package (the audited surface). */
const PLATFORM_WORKSPACE_FILES: readonly string[] = [
  "test/durability.test.ts",
  "test/failures.test.ts",
  "test/feed-boundary.test.ts",
  "test/feed-journey.test.ts",
  "test/feed-recovery.test.ts",
  "test/journey.test.ts",
  "test/platform-proof.test.ts",
];

/**
 * The battery floors: each delivering worker's claimed case count, quoted
 * from the TL-gated merge messages on main at 3b96943 (the repo's own
 * record of the chat reports — the source of truth for what was claimed).
 */
const BATTERY_FLOORS: readonly BatteryFloor[] = [
  {
    pkg: "@sporta/reality-lab",
    cwd: "packages/reality-lab",
    files: null,
    claimedBy:
      "Worker 65-a, REL-025/032 (merge 3b96943): 'TL-gated at the integration station: 270/270 (83,700 expects)'",
    claimed: 270,
  },
  {
    pkg: "@sporta/user-labs",
    cwd: "packages/user-labs",
    files: null,
    claimedBy:
      "Worker 66-a, REL-031 regression (merge 081156a): 'regression: external-platform 85/85 green, user-labs 137/137 green — both unchanged and untouched'",
    claimed: 137,
  },
  {
    pkg: "@sporta/organization-registry",
    cwd: "packages/organization-registry",
    files: null,
    claimedBy:
      "Worker 65-b, REL-033/034 (merge 34411dd): 'Batteries reproduced exactly: registry 165/165' (later merges are additive)",
    claimed: 165,
  },
  {
    pkg: "@sporta/external-platform",
    cwd: "packages/external-platform",
    files: null,
    claimedBy:
      "Worker C REL-035 proof (commit 2024705): 'TL gates: external-platform 87/87 ... — EXACT match'",
    claimed: 87,
  },
  {
    pkg: "@sporta/platform-workspace",
    cwd: "packages/platform-workspace",
    files: PLATFORM_WORKSPACE_FILES,
    claimedBy:
      "Worker 66-a, REL-031 (merge 081156a): 'platform-workspace: 48/48 (25 pre-existing green UNMODIFIED + 23 new)'",
    claimed: 48,
  },
  {
    pkg: "@sporta/historical-corpus",
    cwd: "packages/historical-corpus",
    files: null,
    claimedBy:
      "Worker 64-a, REL-026/029/030 (merge 472448b): 'Batteries reproduced exactly at the integration station: corpus 135/135'",
    claimed: 135,
  },
  {
    pkg: "@sporta/durable-jobs",
    cwd: "packages/durable-jobs",
    files: null,
    claimedBy:
      "Worker 64-a, REL-026/029/030 (merge 472448b): 'Batteries reproduced exactly at the integration station: jobs 84/84'",
    claimed: 84,
  },
];

/** The spawned battery run's parsed summary (the runner's own numbers). */
interface BatteryRunSummary {
  readonly ran: number;
  readonly passed: number;
  readonly failed: number;
  readonly raw: string;
}

/** Spawns `bun test` in one package and parses the runner's own summary. */
async function spawnBattery(floor: BatteryFloor): Promise<BatteryRunSummary> {
  const cwd = join(REPO_ROOT, floor.cwd);
  const args = ["bun", "test", ...(floor.files ?? [])];
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const killTimer = setTimeout(() => proc.kill(), 300_000);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  clearTimeout(killTimer);
  const raw = `${stdout}\n${stderr}`;
  // The runner's own summary lines (the LAST match wins — per-file noise above).
  const ranMatches = [...raw.matchAll(/Ran (\d+) tests?/g)];
  const passMatches = [...raw.matchAll(/(\d+) pass/g)];
  const failMatches = [...raw.matchAll(/(\d+) fail/g)];
  const ran = ranMatches.length > 0 ? Number(ranMatches.at(-1)?.[1]) : -1;
  const passed = passMatches.length > 0 ? Number(passMatches.at(-1)?.[1]) : -1;
  const failed = failMatches.length > 0 ? Number(failMatches.at(-1)?.[1]) : -1;
  return { ran, passed, failed, raw };
}

// ---------------------------------------------------------------------------
// Part 3 — the six ADR-013 §8 gate classes as typed refusals in BOTH packs
// ---------------------------------------------------------------------------

/** The six §8 hard-invalidity classes (architecture §8, ADR-013 §8). */
const SIX_GATE_CLASSES: readonly string[] = [
  "fabricated-canonical-event",
  "fabricated-identity-as-fact",
  "rights-policy-violation",
  "impossible-output-claim",
  "provenance-bypass",
  "invalid-artifact-lineage",
];

/**
 * One violating claim per §8 class — each crafted to trip EXACTLY its own
 * rule (the context is otherwise clean), so the audit proves per class
 * that the gate exists AND fires as a typed refusal record.
 */
function violatingClaims(pack: "football" | "basketball"): readonly LabClaim[] {
  const declaredTarget =
    pack === "football"
      ? (footballDomainPack.renderTargets[0]?.targetId ?? "tactical-2d")
      : (basketballDomainPack.renderTargets[0]?.targetId ?? "tactical-2d");
  return [
    {
      claimKind: "canonical-event",
      claimId: "audit-claim-fabricated-event",
      eventKindId: "kickoff",
      clockMs: 1_000,
      evidenceRefs: ["obs-never-provided"],
      provenanceClass: LAB_SIMULATION_PROVENANCE,
    },
    {
      claimKind: "identity-assertion",
      claimId: "audit-claim-fabricated-identity",
      entityId: "player-home-1",
      presentedAs: "fact",
      basis: "inferred",
      evidenceRefs: ["obs-1"],
      provenanceClass: LAB_SIMULATION_PROVENANCE,
    },
    {
      claimKind: "output-claim",
      claimId: "audit-claim-rights-violation",
      renderTargetId: declaredTarget,
      rightsBasis: null,
      artifactLineage: ["audit-run-1", "artifact-1"],
      clockMs: 1_000,
      provenanceClass: LAB_SIMULATION_PROVENANCE,
    },
    {
      claimKind: "output-claim",
      claimId: "audit-claim-impossible-output",
      renderTargetId: "hologram-reality-3d",
      rightsBasis: "basis-audit-1",
      artifactLineage: ["audit-run-1", "artifact-1"],
      clockMs: 1_000,
      provenanceClass: LAB_SIMULATION_PROVENANCE,
    },
    {
      claimKind: "canonical-event",
      claimId: "audit-claim-provenance-bypass",
      eventKindId: "kickoff",
      clockMs: 1_000,
      evidenceRefs: ["obs-1"],
      provenanceClass: "real-observation",
    },
    {
      claimKind: "output-claim",
      claimId: "audit-claim-invalid-lineage",
      renderTargetId: declaredTarget,
      rightsBasis: "basis-audit-1",
      artifactLineage: ["some-other-run", "artifact-1"],
      clockMs: 1_000,
      provenanceClass: LAB_SIMULATION_PROVENANCE,
    },
  ];
}

/** The clean audit context (one known observation, the pack's own targets). */
function auditContext(pack: "football" | "basketball"): HardInvalidityContext {
  const targets =
    pack === "football"
      ? footballDomainPack.renderTargets.map((target) => target.targetId)
      : basketballDomainPack.renderTargets.map((target) => target.targetId);
  return {
    runId: "audit-run-1",
    knownEvidenceRefs: new Set(["obs-1"]),
    renderTargetIds: targets,
    scenarioDurationMs: 90_000,
  };
}

// ---------------------------------------------------------------------------
// Part 4 — the determinism spot pins (the delivered tests' named seeds)
// ---------------------------------------------------------------------------

const CHAIN_SCENARIO = { matchDurationMs: 20_000, tickMs: 100 } as const;

/**
 * The football search -> reward -> calibration chain at the DELIVERED seed
 * `chain-seed` (the seed the REL-005..008 delivering test names — the
 * delivered evidence's own reproduction point).
 */
function footballChainAtChainSeed(): {
  search: ReturnType<typeof runOrganizationSearch>;
  rewardAggregates: readonly (number | null)[];
  calibration: ReturnType<typeof runCalibration>;
} {
  const space = createFootballCandidateSpace({
    ...defaultFootballCandidateSpaceConfig(),
    maxBodyCount: 3,
    maxDelegationDepth: 2,
    latencyBudgetsMs: [1000, 2000],
  });
  const search = runOrganizationSearch({
    domainPack: footballDomainPack,
    space,
    seed: "chain-seed",
    mode: "exhaustive-bounded",
    maxCandidates: 4,
    ensembleSize: 2,
    budgetCeilingUsd: 100,
    latencyCeilingMs: 10_000,
    scenarioConfig: CHAIN_SCENARIO,
  });
  const winnerEvaluation = search.candidates.find(
    (candidate) => candidate.candidateId === search.winner?.candidateId,
  );
  if (winnerEvaluation === undefined) {
    throw new Error("audit invariant broken: chain-seed search has no winner");
  }
  const winnerCandidate = space.materialize(winnerEvaluation.point, {
    familyId: winnerEvaluation.familyId ?? undefined,
  });
  const engine = createFootballRewardEngine();
  const winnerEnsemble = runEnsemble({
    domainPack: footballDomainPack,
    organization: winnerCandidate.bundle,
    baseSeed: winnerEvaluation.ensembleRef.baseSeed,
    size: winnerEvaluation.ensembleRef.size,
    scenarioConfig: CHAIN_SCENARIO,
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
  const calibration = runCalibration({
    domainPack: footballDomainPack,
    organization: winnerCandidate.bundle,
    seed: `${search.seed}::winner`,
    ensembleSize: 2,
    scenarioConfig: CHAIN_SCENARIO,
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

/** The basketball chain at the delivered seed `bb-chain-seed` (65-a's seam proof). */
function basketballSearchAtBbChainSeed(): ReturnType<typeof runDomainOrganizationSearch> {
  const space = createBasketballCandidateSpace({
    ...defaultBasketballCandidateSpaceConfig(),
    maxBodyCount: 3,
    maxDelegationDepth: 2,
    latencyBudgetsMs: [1000, 2000],
  });
  // The GENERIC seam driver (the REL-032 form) — the same entry point a
  // third domain would use, exactly as the delivered seam proof drives it.
  return runDomainOrganizationSearch({
    domainPack: basketballDomainPack,
    simulationProfile: basketballDomainSimulationProfile,
    space,
    seed: "bb-chain-seed",
    mode: "exhaustive-bounded",
    maxCandidates: 3,
    ensembleSize: 1,
    budgetCeilingUsd: 100,
    latencyCeilingMs: 10_000,
    scenarioConfig: CHAIN_SCENARIO,
  });
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------
describe("REL-036: the drift audit — the public export inventory (claims vs delivery)", () => {
  test("every program package serves EXACTLY the frozen export inventory the program relies on (a rename/removal fails the audit)", () => {
    const inventories: readonly [string, readonly string[], Record<string, unknown>][] = [
      ["@sporta/reality-lab", REALITY_LAB_EXPORTS, realityLab],
      ["@sporta/user-labs", USER_LABS_EXPORTS, userLabs],
      ["@sporta/organization-registry", ORGANIZATION_REGISTRY_EXPORTS, organizationRegistry],
      ["@sporta/external-platform", EXTERNAL_PLATFORM_EXPORTS, externalPlatform],
      ["@sporta/platform-workspace", PLATFORM_WORKSPACE_EXPORTS, platformWorkspace],
      ["@sporta/historical-corpus", HISTORICAL_CORPUS_EXPORTS, historicalCorpus],
      ["@sporta/durable-jobs", DURABLE_JOBS_EXPORTS, durableJobs],
    ];
    for (const [pkg, frozen, namespace] of inventories) {
      const served = Object.keys(namespace).sort();
      const expected = [...frozen].sort();
      // The exact frozen inventory — additions are visible (reported),
      // removals/renames FAIL (they break the program's imports).
      expect(served, `${pkg}: the export inventory drifted from the frozen snapshot`).toEqual(
        expected,
      );
      expect(served.length, `${pkg}: inventory size`).toBe(expected.length);
    }
  });

  test("the program-critical exports are the surfaces the batteries drive (type-level drift caught at typecheck, value-level pinned here)", () => {
    const criticalFunctions: readonly [string, unknown][] = [
      ["reality-lab.runDomainOrganizationSearch", realityLab.runDomainOrganizationSearch],
      ["reality-lab.runDomainCalibration", realityLab.runDomainCalibration],
      ["reality-lab.runRobustnessBenchmark", realityLab.runRobustnessBenchmark],
      ["user-labs.createUserLabs", userLabs.createUserLabs],
      ["user-labs.createPublicationIncentiveAccrual", userLabs.createPublicationIncentiveAccrual],
      ["registry.createOrganizationRegistry", organizationRegistry.createOrganizationRegistry],
      ["registry.requestPromotion", organizationRegistry.requestPromotion],
      ["registry.choiceForRequest", organizationRegistry.choiceForRequest],
      ["external-platform.createHttpSurface", externalPlatform.createHttpSurface],
      ["external-platform.createMcpToolSurface", externalPlatform.createMcpToolSurface],
      ["platform-workspace.createPlatformWorkspace", platformWorkspace.createPlatformWorkspace],
      ["platform-workspace.createExternalFeed", platformWorkspace.createExternalFeed],
      [
        "platform-workspace.createSimulatedExternalFeedSource",
        platformWorkspace.createSimulatedExternalFeedSource,
      ],
    ];
    for (const [name, value] of criticalFunctions) {
      expect(typeof value, `${name} must remain a function`).toBe("function");
    }
    // The two domain packs (§3 seam instances) remain the typed pack objects.
    expect(realityLab.footballDomainPack.domainPackId).toBe("football");
    expect(realityLab.basketballDomainPack.domainPackId).toBe("basketball");
    expect(typeof realityLab.footballDomainPack.hardInvalidityRules.length).toBe("number");
  });
});

describe("REL-036: the drift audit — the battery floor per package (silently deleted tests fail the audit)", () => {
  for (const floor of BATTERY_FLOORS) {
    test(`${floor.pkg}: its own bun test re-measured this run is >= the claimed ${floor.claimed} cases and green — claimed by: ${floor.claimedBy}`, async () => {
      const summary = await spawnBattery(floor);
      // DEVIATION SURFACE: an honest failure here records the exact gap
      // (ran < claimed = deleted tests; failed > 0 = a broken battery).
      expect(
        summary.ran,
        `${floor.pkg}: the runner's own "Ran N tests" count`,
      ).toBeGreaterThanOrEqual(floor.claimed);
      expect(summary.failed, `${floor.pkg}: the runner's own fail count`).toBe(0);
      expect(summary.ran).toBe(summary.passed);
    }, 360_000);
  }
});

describe("REL-036: the drift audit — the six §8 gate classes as typed refusals in BOTH domain packs", () => {
  test("both packs declare exactly the six ADR-013 §8 hard-invalidity rule classes", () => {
    expect(FOOTBALL_HARD_INVALIDITY_RULES.map((rule) => rule.ruleId).sort()).toEqual(
      [...SIX_GATE_CLASSES].sort(),
    );
    expect(BASKETBALL_HARD_INVALIDITY_RULES.map((rule) => rule.ruleId).sort()).toEqual(
      [...SIX_GATE_CLASSES].sort(),
    );
  });

  for (const pack of ["football", "basketball"] as const) {
    test(`${pack}: every §8 class FIRES as a typed refusal record over a violating claim`, () => {
      const rules =
        pack === "football" ? FOOTBALL_HARD_INVALIDITY_RULES : BASKETBALL_HARD_INVALIDITY_RULES;
      const context = auditContext(pack);
      const packId = pack === "football" ? footballDomainPack : basketballDomainPack;
      for (const claim of violatingClaims(pack)) {
        const violations = checkLabClaims([claim], rules, context);
        expect(
          violations,
          `${pack}: claim ${claim.claimId} must produce exactly one typed violation`,
        ).toHaveLength(1);
        const violation = violations[0];
        expect(violation).toBeDefined();
        if (violation === undefined) continue;
        // The TYPED REFUSAL RECORD: rule id + claim id + reason + evidence.
        expect(SIX_GATE_CLASSES).toContain(violation.ruleId);
        expect(violation.claimId).toBe(claim.claimId);
        expect(violation.reason.length).toBeGreaterThan(0);
        expect(typeof violation.evidence).toBe("object");
        // And the pack's OWN checker (the exported surface the program uses)
        // produces the same typed refusals over the same claims.
        const viaPack =
          pack === "football"
            ? realityLab.checkFootballClaims([claim], context)
            : realityLab.checkBasketballClaims([claim], context);
        expect(viaPack).toEqual(violations);
      }
      // A CLEAN claim set produces ZERO violations (the gates never false-fire).
      const cleanTarget =
        pack === "football"
          ? (footballDomainPack.renderTargets[0]?.targetId ?? "tactical-2d")
          : (basketballDomainPack.renderTargets[0]?.targetId ?? "tactical-2d");
      const cleanClaims: readonly LabClaim[] = [
        {
          claimKind: "canonical-event",
          claimId: "audit-claim-clean-event",
          eventKindId: "kickoff",
          clockMs: 1_000,
          evidenceRefs: ["obs-1"],
          provenanceClass: LAB_SIMULATION_PROVENANCE,
        },
        {
          claimKind: "identity-assertion",
          claimId: "audit-claim-clean-identity",
          entityId: "player-home-1",
          presentedAs: "inference",
          basis: "inferred",
          evidenceRefs: ["obs-1"],
          provenanceClass: LAB_SIMULATION_PROVENANCE,
        },
        {
          claimKind: "output-claim",
          claimId: "audit-claim-clean-output",
          renderTargetId: cleanTarget,
          rightsBasis: "basis-audit-1",
          artifactLineage: ["audit-run-1", "artifact-1"],
          clockMs: 1_000,
          provenanceClass: LAB_SIMULATION_PROVENANCE,
        },
      ];
      expect(checkLabClaims(cleanClaims, rules, context)).toEqual([]);
      expect(packId.hardInvalidityRules.length).toBe(6);
    });
  }
});

describe("REL-036: the drift audit — the determinism spot pins (the delivered seeds re-run)", () => {
  test("reality-lab at the delivered seed 'chain-seed': the search -> reward -> calibration chain re-runs deep-equal", () => {
    const first = footballChainAtChainSeed();
    const second = footballChainAtChainSeed();
    expect(JSON.stringify(first.search)).toBe(JSON.stringify(second.search));
    expect(first.rewardAggregates).toEqual(second.rewardAggregates);
    expect(JSON.stringify(first.calibration.record)).toBe(
      JSON.stringify(second.calibration.record),
    );
    expect(JSON.stringify(first.calibration.drift)).toBe(JSON.stringify(second.calibration.drift));
    expect(first.search.searchId).toBe(second.search.searchId);
    expect(first.calibration.record.calibrationId).toBe(second.calibration.record.calibrationId);
  }, 120_000);

  test("reality-lab (basketball, the second pack through the seam) at the delivered seed 'bb-chain-seed': the search re-runs deep-equal", () => {
    const first = basketballSearchAtBbChainSeed();
    const second = basketballSearchAtBbChainSeed();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.searchId).toBe(second.searchId);
    expect(first.provenance.versions.domainPackId).toBe("basketball");
  }, 120_000);

  test("platform-workspace at the delivered seed 'journey-seed': the external feed record re-runs deep-equal on identically-seeded stacks", async () => {
    const runFeedOnce = async (name: string) => {
      const stack = await buildWorkspaceStack(name);
      const source = await createSimulatedExternalFeedSource({
        seed: "journey-seed",
        plan: ["clean", "clean", "clean"],
      });
      const feed = createExternalFeed({
        workspace: stack.workspace,
        platform: {
          platformId: SIMULATED_PLATFORM.platformId,
          tenantId: SIMULATED_PLATFORM.tenantId,
        },
        source,
        selection: { mode: "auto", query: { domain: "football", task: "match" } },
      });
      const record = await feed.open().run();
      expect(record.outcome).toBe("completed");
      return record;
    };
    const first = await runFeedOnce("audit-journey-a");
    const second = await runFeedOnce("audit-journey-b");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.feedSessionId).toBe(second.feedSessionId);
    expect(first.provenance.seed).toBe("journey-seed");
    expect(first.totals.itemsProcessed).toBe(9);
  }, 120_000);
});
