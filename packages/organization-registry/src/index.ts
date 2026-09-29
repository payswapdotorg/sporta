/**
 * @sporta/organization-registry — the canonical catalog of
 * production-eligible organizations + automated promotion/rollback +
 * the honest user-choice read model (REL-017..019, ADR-013).
 *
 * Source of truth: docs/contracts/organization-registry-and-promotion.md
 * (FROZEN), docs/contracts/agent-body-and-organization.md §Organization
 * status (FROZEN), docs/architecture/reality-engineering-lab.md §10 (the
 * lab-to-production boundary). Module map:
 *
 * - `domain`: the record model — statuses, domain compatibility, capability
 *   bindings, evidence objects (reproducibility/benchmark/robustness/
 *   rights/security/cost-latency/canary + the never-a-gate simulator
 *   reward), provenance/rights requirements, created-from (lab run or null
 *   for hand-engineered), operating profile, the eligibility query
 * - `state-machine`: the lifecycle `draft -> benchmarked -> validated ->
 *   canary -> production -> retired` — legal edges only, retired terminal,
 *   typed reasons for illegal jumps
 * - `gates`: the seven evidence-requiring eligibility checks (pure
 *   evaluators over (record, policy thresholds)); THE HARD RULE lives here —
 *   no gate reads `simulatorReward`
 * - `registry`: the versioned record store + the append-only hash-chained
 *   transition log (actor, gate results, from -> to, timestamp on every
 *   entry; refusals logged too) + the eligibility query
 * - `promotion`: `requestPromotion` / `requestRollback` — the AUTOMATED,
 *   policy-versioned decisions; typed refusal records (never thrown), each
 *   attempt audited into the log; rollback triggers are recorded
 * - `choice`: `choiceForRequest` — the REL-019 read model: all eligible
 *   organizations, each with VISIBLE evidence (benchmark + uncertainty,
 *   robustness, cost/latency, provenance/rights, version), ordered only by
 *   declared criteria — no hidden ranking fields
 * - `clock` / `errors`: the injected clock + id source (repo constitution)
 *   and the typed storage-boundary error family
 *
 * THE PROMOTION INVARIANT (binding): a lab breakthrough is not a product
 * feature until it passes the same promotion/evidence gates as a
 * hand-engineered organization. No gate may be bypassed — a record carrying
 * only a simulator-reward score is refused promotion, in words, by name.
 */
// domain
export {
  ORGANIZATION_STATUSES,
  ROLLBACK_TRIGGERS,
  SELECTABLE_STATUSES,
  isRollbackTrigger,
  isSelectableStatus,
  matchesQuery,
  systemActor,
} from "./domain";
export type {
  ActorRef,
  AdditionalEvidence,
  BenchmarkEvidence,
  CanaryEvidence,
  CapabilityBinding,
  CostEnvelope,
  CostLatencyEvidence,
  DomainCompatibility,
  EligibilityQuery,
  EvidenceBundle,
  LabRunRef,
  LatencyDistribution,
  NewOrganizationInput,
  OrganizationProvenance,
  OrganizationRecord,
  OrganizationStatus,
  RightsProvenanceEvidence,
  RightsRequirement,
  RobustnessEvidence,
  RollbackTrigger,
  SecurityPolicyEvidence,
  SimulatorReward,
} from "./domain";
export {
  AdditionalEvidenceSchema,
  DomainCompatibilitySchema,
  EligibilityQuerySchema,
  NewOrganizationInputSchema,
  OrganizationStatusSchema,
} from "./domain";

// state machine
export {
  LIFECYCLE_EDGES,
  forwardTargetFrom,
  illegalTransitionReason,
  isLegalTransition,
  isTerminalStatus,
  legalTargetsFrom,
  lifecycleEdge,
} from "./state-machine";
export type { ForwardTarget, LifecycleEdge, TransitionOperation } from "./state-machine";

// gates
export {
  GATE_IDS,
  allGatesPassed,
  evaluateBenchmarkGate,
  evaluateCanaryGate,
  evaluateCostLatencyGate,
  evaluateGate,
  evaluateGates,
  evaluateReproducibilityGate,
  evaluateRightsProvenanceGate,
  evaluateRobustnessGate,
  evaluateSecurityPolicyGate,
  isGateId,
} from "./gates";
export type { GateId, GatePolicy, GateResult } from "./gates";

// registry
export { GENESIS_HASH, canonicalJson, createOrganizationRegistry, sha256Hex } from "./registry";
export type {
  LifecycleTransitionRequest,
  LifecycleTransitionResult,
  LogOperation,
  OrganizationRegistry,
  OrganizationRegistryOptions,
  RefusalLogRequest,
  TransitionLogEntry,
} from "./registry";

// promotion
export {
  PROMOTION_GATES_BY_TARGET,
  requestPromotion,
  requestRollback,
  validatePromotionPolicy,
} from "./promotion";
export type {
  PolicyRef,
  PromotionGranted,
  PromotionOutcome,
  PromotionPolicy,
  PromotionRefusalReason,
  PromotionRefused,
  PromotionRequest,
  RollbackGranted,
  RollbackOutcome,
  RollbackRefusalReason,
  RollbackRefused,
  RollbackRequest,
} from "./promotion";

// choice
export {
  applyChoiceOrdering,
  choiceForRequest,
  describeChoiceOrdering,
  toChoiceCandidate,
} from "./choice";
export type {
  BenchmarkSummary,
  ChoiceCandidate,
  ChoiceOrdering,
  ChoiceResult,
  ProvenanceSummary,
  RobustnessSummary,
  SimulatorRewardSummary,
} from "./choice";

// clock + errors
export {
  REGISTRY_DEFAULT_EPOCH_MS,
  createDefaultEntryIdSource,
  createRegistryDefaultClock,
  createSequentialIdSource,
  toIsoUtc,
} from "./clock";
export type { IdSource } from "./clock";
export {
  RegistryApiError,
  RegistryConflictError,
  RegistryInternalError,
  RegistryNotFoundError,
  RegistryValidationError,
  isRegistryError,
} from "./errors";
export type { RegistryError, RegistryFailureClass } from "./errors";
