/**
 * @sporta/reality-lab — the Reality Engineering Lab core (REL-001..004,
 * ADR-013): the domain pack seam, the world simulator + lab run, fault
 * injection + ensembles, and the agent body / model runtime / organization
 * contracts.
 *
 * Source of truth: docs/adr/ADR-013-reality-engineering-lab-and-agent-
 * organizations.md, docs/architecture/reality-engineering-lab.md (FROZEN),
 * docs/contracts/agent-body-and-organization.md (FROZEN). Module map:
 *
 * - `provenance`: the ADR-013 §8 provenance classes — real-observation /
 *   historical-replay / lab-simulation, explicitly distinct; every
 *   simulator-produced record carries `lab-simulation` and lab world state
 *   is NEVER production truth
 * - `errors`: the typed error family (`failureClass` + details); body and
 *   organization contract violations are COLLECTIVE typed errors; hard
 *   invalidity gates are typed REFUSAL RECORDS, never thrown
 * - `rng` / `hash`: the seeded deterministic PRNG (mulberry32 + FNV-1a
 *   forks) and content-derived stable ids/hashes — the determinism law's
 *   machinery
 * - `domain/domain-pack`: the generic §3 DomainPack seam (entity types +
 *   identity semantics, world-state schema, observation/event taxonomy,
 *   action space, capabilities, render targets, evaluator refs, hard
 *   invalidity rules, reward dimensions, scenario/fault generators,
 *   replay/calibration adapters)
 * - `domain/football`: FootballDomainPack v0 — the first real instance
 *   with the six ADR-013 §8 hard invalidity rules as pure checks
 * - `domain/scenario`: the seeded deterministic scenario generator (same
 *   seed ⇒ byte-identical record)
 * - `simulation/world-simulator`: World Simulator v0 (clock, players/ball,
 *   spatial geometry, event progression, confidence/missingness, source
 *   timing, dropped frames, fault hooks) — deterministic from
 *   (seed, config)
 * - `simulation/lab-run`: the immutable LabRun record + deterministic
 *   replay API (`runLab` twice ⇒ deep-equal after
 *   `deterministicLabRun` strips the wall-clock execution section)
 * - `robustness/faults`: deterministic-from-seed typed fault schedules
 *   (compute/provider failure, source disagreement, occlusion, processing
 *   latency, dropped frames), replayable in the simulator
 * - `robustness/ensemble`: the EnsembleRunner — N seeded runs + the §9
 *   aggregate (expected score, variance/uncertainty, seed robustness) with
 *   a PURE `aggregateLabRuns`
 * - `body/body`: the Agent Body contract — ALL fifteen frozen-contract
 *   fields, validated collectively, + the generalist body
 * - `body/model-runtime`: the provider-neutral Model Runtime seam (NO
 *   provider SDK imports as domain code; the binding is execution
 *   metadata, never domain truth) + ONE deterministic scripted model
 * - `body/organization`: Agent Organization v0 — versioned directed graph
 *   (nodes/edges, memory policy, capability bindings, stages, budgets,
 *   termination), the deterministic execution-order walk, and the
 *   generalist single-agent baseline constructor
 * - `evaluation/evaluator`: the evaluator hook (v0.2 — REL-007 upgraded it
 *   to delegate to the full reward engine; `result.reward` carries the
 *   per-run RewardRecord, `overall` stays the plain mean for compatibility)
 * - `orgsearch/candidates` (REL-005): the typed §5 candidate space — the
 *   twelve search dimensions as one point, deterministic materialization
 *   into complete valid organizations, and the three fixture families
 *   (generalist baseline / hand-designed pipeline / parameterized variants)
 * - `orgsearch/search` (REL-006): the deterministic, BOUNDED search driver
 *   over the candidate space — per-candidate REL-A3 metrics (quality,
 *   hard-gate validity, cost, latency), ranking, winner, the mandatory
 *   baseline comparison, and honest bound-truncation records
 * - `reward/engine` (REL-007): the full §8 reward engine — composable
 *   dimensions, weighted aggregation with VERSIONED weight sets, per-run
 *   RewardRecords, and hard invalidity as TYPED REFUSALS (HardInvalid)
 * - `calibration/calibration` (REL-008): prediction-vs-observation records
 *   per reward dimension (with the observation source class), the
 *   CalibrationPort adapter interface with configured drift detection (a
 *   recorded state, never an exception), and the deterministic driver with
 *   known injected perturbations
 *
 * BOUNDARY DISCIPLINE: the organization lifecycle/promotion authority is
 * `@sporta/organization-registry` (REL-017..019); this package carries no
 * status field and cannot promote anything. A lab run produces EVIDENCE,
 * not production state.
 */
// provenance
export { LAB_SIMULATION_PROVENANCE, LabProvenanceClass, isLabProvenanceClass } from "./provenance";

// errors
export {
  BodyContractError,
  LabApiError,
  LabConflictError,
  LabInternalError,
  LabNotFoundError,
  LabValidationError,
  OrganizationContractError,
  isLabError,
} from "./errors";
export type { LabError, LabFailureClass, OrganizationInvariantViolation } from "./errors";

// rng + hash
export { LabRng, hashSeedToUint32 } from "./rng";
export { contentHash, contentId, stableStringify } from "./hash";

// domain pack (the §3 seam)
export { LabSimulationProvenanceLiteral } from "./domain/domain-pack";
export type {
  ActionDescriptor,
  AnyWorldState,
  CalibrationAdapter,
  CalibrationPairs,
  CapabilityDescriptor,
  DomainObservationBase,
  DomainPack,
  EntityTypeDescriptor,
  EventKindDescriptor,
  FaultKind,
  FaultParams,
  FaultProfile,
  HardInvalidityContext,
  HardInvalidityRule,
  HardInvalidityViolation,
  IdentitySemantics,
  LabClaim,
  ObservationKindDescriptor,
  QualityEvaluatorRef,
  RenderTargetDescriptor,
  ReplayAdapter,
  ReplayStream,
  RewardDimension,
  ScenarioConfigBase,
  ScenarioGenerator,
  ScenarioRecordBase,
  WorldStateBase,
} from "./domain/domain-pack";
export { createListReplayAdapter, createMeanErrorCalibrationAdapter } from "./domain/adapters";

// football pack
export {
  FOOTBALL_ACTION_SPACE,
  FOOTBALL_CAPABILITIES,
  FOOTBALL_ENTITY_TYPES,
  FOOTBALL_EVENT_TAXONOMY,
  FOOTBALL_FAULT_PROFILES,
  FOOTBALL_HARD_INVALIDITY_RULES,
  FOOTBALL_OBSERVATION_TAXONOMY,
  FOOTBALL_QUALITY_EVALUATORS,
  FOOTBALL_RENDER_TARGETS,
  FOOTBALL_REWARD_DIMENSIONS,
  FootballBallStateSchema,
  FootballOfficialStateSchema,
  FootballPitchFrameSchema,
  FootballPlayerStateSchema,
  FootballWorldStateSchema,
  checkFootballClaims,
  footballDomainPack,
} from "./domain/football";
export type {
  FootballBallState,
  FootballBroadcastFrameObservation,
  FootballBroadcastVisiblePlayer,
  FootballDomainPack,
  FootballEventRecordObservation,
  FootballOfficialState,
  FootballObservation,
  FootballPlayerState,
  FootballSimEvent,
  FootballTrackingSampleObservation,
  FootballWorldState,
} from "./domain/football";
export {
  FOOTBALL_DOMAIN_PACK_ID,
  FOOTBALL_DOMAIN_PACK_VERSION,
  FOOTBALL_LAB_EVALUATOR_ID,
  FOOTBALL_LAB_EVALUATOR_VERSION,
} from "./domain/football-ids";

// scenario
export {
  FootballScenarioConfigSchema,
  footballScenarioGenerator,
  generateFootballScenario,
} from "./domain/scenario";
export type {
  FootballScenarioConfig,
  FootballScenarioPlayer,
  FootballScenarioRecord,
} from "./domain/scenario";

// world simulator
export { createFootballWorldSimulator } from "./simulation/world-simulator";
export type {
  AppliedFault,
  FootballSimulatorOptions,
  FootballWorldSimulator,
  SimulatedTick,
  SourceTiming,
} from "./simulation/world-simulator";

// lab run
export {
  assertLabRunReproduces,
  deterministicLabRun,
  replayLabRun,
  runLab,
} from "./simulation/lab-run";
export type {
  DegradationRecord,
  DeterministicLabRun,
  LabExecutionMetadata,
  LabRunMetrics,
  LabRunOptions,
  LabRunRecord,
  OrganizationRuntimeBundle,
  RecordedAction,
} from "./simulation/lab-run";

// faults
export {
  FAULT_KINDS,
  activeFaultsAt,
  generateFaultSchedule,
  hasActiveFault,
} from "./robustness/faults";
export type { FaultSchedule, FaultScheduleEntry } from "./robustness/faults";

// ensemble
export { aggregateLabRuns, runEnsemble } from "./robustness/ensemble";
export type {
  EnsembleAggregate,
  EnsembleOptions,
  EnsembleRecord,
  ScoreStats,
} from "./robustness/ensemble";

// body
export {
  REQUIRED_BODY_FIELDS,
  LabBodyActionSchema,
  LabBodyInputSchema,
  LabBodyOutputSchema,
  createGeneralistBody,
  validateAgentBody,
} from "./body/body";
export type {
  AgentBodyDefinition,
  AgentBudgetSpec,
  AgentLatencyLimits,
  AgentRoleDescriptor,
  CommunicationChannelRef,
  EvaluatorHookRef,
  LabBodyAction,
  LabBodyInput,
  LabBodyOutput,
  MemoryInterfaceRef,
  PermissionGrant,
  SafetyPolicyConstraints,
  ToolRef,
} from "./body/body";

// model runtime
export {
  createGeneralistScriptedRuntime,
  createScriptedModelRuntime,
  generalistScriptedHandler,
} from "./body/model-runtime";
export type {
  ModelInvocationRecord,
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelRuntime,
  ModelRuntimeBinding,
  ModelUsage,
  ScriptedModelHandler,
  ScriptedModelRuntimeOptions,
} from "./body/model-runtime";

// organization
export {
  createGeneralistOrganization,
  executionOrderWalk,
  validateOrganization,
} from "./body/organization";
export type {
  AgentOrganizationDefinition,
  ExecutionStageDefinition,
  OrgEdgeDefinition,
  OrgNodeDefinition,
  TerminationCondition,
  ValidateOrganizationOptions,
} from "./body/organization";

// evaluator
export {
  createFootballLabEvaluator,
  footballEvaluatorRewardDimensions,
} from "./evaluation/evaluator";
export type {
  LabDimensionScore,
  LabEvaluator,
  LabEvaluatorEvidence,
  LabEvaluatorResult,
} from "./evaluation/evaluator";

// organization candidate space (REL-005)
export {
  CANDIDATE_SPECIALIST_ROLES,
  CandidateSpaceError,
  candidatePointId,
  candidatePointViolations,
  candidateRoleForNode,
  createCandidateRoleRuntime,
  createFootballCandidateSpace,
  defaultFootballCandidateSpaceConfig,
  fixtureCandidateFamilies,
  fusionScriptedHandler,
  generalistBaselineFamily,
  handDesignedPipelineFamily,
  parameterizedVariantsFamily,
  perceptionScriptedHandler,
  renderScriptedHandler,
} from "./orgsearch/candidates";
export type {
  CandidateDimensionDescriptor,
  CandidateFamily,
  CandidateRole,
  CandidateSpaceConfig,
  CandidateSpacePoint,
  CandidateSpaceViolation,
  CandidateSpecialistRole,
  CandidateTopology,
  CapabilityAssignmentKind,
  CommunicationPattern,
  ComputeBudgetSplitKind,
  ExecutionOrderKind,
  MaterializedCandidate,
  MemoryPolicyKind,
  ModelAssignmentKind,
  OrganizationCandidateSpace,
  RoleMix,
  StoppingConditionKind,
} from "./orgsearch/candidates";

// organization search (REL-006)
export { deepFreeze, rankCandidateEvaluations, runOrganizationSearch } from "./orgsearch/search";
export type {
  BaselineComparison,
  CandidateEvaluation,
  CandidateMetrics,
  OrganizationSearchMode,
  OrganizationSearchOptions,
  SearchTruncationRecord,
  SearchResultRecord,
} from "./orgsearch/search";

// reward engine (REL-007)
export {
  FOOTBALL_REWARD_WEIGHT_SETS,
  REWARD_ENGINE_ID,
  REWARD_ENGINE_VERSION,
  createFootballRewardEngine,
  createRewardEngine,
  footballRewardWeightSets,
  isHardInvalid,
} from "./reward/engine";
export type {
  HardInvalidRefusal,
  RewardDimensionContribution,
  RewardDimensionScoreInput,
  RewardEngine,
  RewardEngineInput,
  RewardRecord,
  RewardWeightSet,
} from "./reward/engine";

// calibration (REL-008)
export {
  createCalibrationPort,
  detectCalibrationDrift,
  runCalibration,
} from "./calibration/calibration";
export type {
  CalibrationDimensionComparison,
  CalibrationDimensionDrift,
  CalibrationDriftState,
  CalibrationDriftSummary,
  CalibrationObservationSource,
  CalibrationPerturbations,
  CalibrationPort,
  CalibrationRecord,
  CalibrationRunOptions,
  CalibrationRunResult,
  CalibrationTimestampWindow,
  ObservationSourceClass,
} from "./calibration/calibration";
