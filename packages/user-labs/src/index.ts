/**
 * @sporta/user-labs — user labs, incentives and organization exchange
 * (REL-020..023, ADR-013) — the Worker C product-surface lane, continuing
 * from `@sporta/organization-registry` (REL-017..019).
 *
 * Source of truth: docs/contracts/organization-registry-and-promotion.md
 * §User labs / §Incentive policy / §Retirement (FROZEN), ADR-013 #11-12,
 * docs/testing/reality-engineering-lab-acceptance.md Gate REL-A6. Module
 * map:
 *
 * - `domain`: the record model — tenants (THE isolation boundary), the
 *   domain catalog, the source-data SEAM (`SourceDataPort`), budgets, labs,
 *   runs + the durable-run SEAM (`LabRunPort`), the candidate definition
 *   (complete + draft forms), registry-shaped evidence summaries, the
 *   private-by-default `LabCandidate`
 * - `lab/store`: `createUserLabs` — the REL-020 typed user flow (create ->
 *   choose domain/task -> select source data -> set budget -> request run ->
 *   inspect candidates -> revise), with typed refusals for every path
 *   (unknown-domain, missing-source-basis, budget-exceeded, lab-not-ready,
 *   lab-archived, empty-revision) and the hard tenant-isolation boundary
 * - `lab/promotion`: promotion REQUESTS — `requestPublicationPromotion` and
 *   friends. REQUEST ONLY: the DECISION stays with the registry's promotion
 *   pipeline; there is no decision field on a request record, ever
 * - `incentives/policy`: `createIncentivePolicyStore` — the versioned,
 *   displayed-to-user incentive policy (window <= 180 days, disclosed
 *   discovery boost, plan-governed credits); new versions apply
 *   PROSPECTIVELY
 * - `incentives/ledger`: `createIncentiveLedger` — the auditable per-lab
 *   accounting (credits granted/used, private-use window start/expiry,
 *   discovery boosts). INVARIANT: boosts are explicit, auditable events
 *   (policy version + human-visible disclosure on the entry) and are never
 *   silently mixed into quality evidence
 * - `exchange/publish`: REL-022 — `createExchange` + `requestPublication` /
 *   `withdrawPublication` / `publicationGaps`. A candidate becomes visible
 *   outside its tenant ONLY through the publication snapshot; incomplete
 *   candidates refuse with the typed gap list; withdrawal preserves lineage
 * - `exchange/export`: REL-023 — `exportPublication` + the versioned,
 *   checksummed `OrganizationExport` format (complete definition + lineage +
 *   benchmark evidence summary + policy dependencies; data-only by
 *   construction)
 * - `exchange/import`: REL-023 — `importOrganization` + `ImportScope`.
 *   Eligibility re-check at import time (rights/policy dependencies
 *   satisfiable, security/policy pass), producing a REGISTRY-COMPATIBLE
 *   record validated against `@sporta/organization-registry`'s own exported
 *   `NewOrganizationInputSchema` — with NO registry mutation from this
 *   package (registration is the registry pipeline's job). THE DATA-ONLY
 *   LAW: the import surface never injects executable organization code —
 *   strict schemas refuse anything undeclared; executable bindings are
 *   resolved by the runtime seam, never by the import
 * - `clock` / `errors`: the injected clock + id sources (repo constitution)
 *   and the typed error family, including `LabIsolationError` — the typed
 *   refusal every cross-tenant path throws
 *
 * THE TENANT LAW (binding): every record here is tenant-scoped; the
 * candidate store's visibility vocabulary has one member ("private"); the
 * ONLY cross-tenant surface is the REL-022 publication snapshot. Every
 * cross-tenant path is a typed refusal, tested.
 */
// domain
export {
  CANDIDATE_VISIBILITY,
  LAB_STATUSES,
  RUN_PURPOSES,
  RUN_STATUSES,
  SOURCE_RIGHTS_BASIS_TYPES,
  requireTenantRef,
} from "./domain";
export type {
  BenchmarkEvidenceSummary,
  CandidateDefinition,
  CandidateDefinitionDraft,
  CandidateEvidence,
  CandidateProvenance,
  CandidateRevision,
  CandidateVisibility,
  CapabilityBinding,
  CostEnvelope,
  DomainCatalog,
  DomainCatalogEntry,
  DomainCompatibility,
  LabCandidate,
  LabBudget,
  LabRunCandidatePayload,
  LabRunConfiguration,
  LabRunPort,
  LabRunRecord,
  LabRunRequest,
  LabSelection,
  LabStatus,
  NewLabInput,
  OperatingProfile,
  RightsRequirement,
  RunPurpose,
  RunStatus,
  SecurityPolicyEvidenceSummary,
  SourceDataPort,
  SourceDataRecord,
  SourceRightsBasis,
  SourceRightsBasisType,
  TenantRef,
  UserLab,
} from "./domain";
export {
  BenchmarkEvidenceSummarySchema,
  CapabilityBindingSchema,
  CandidateDefinitionDraftSchema,
  CandidateDefinitionSchema,
  CandidateEvidenceSchema,
  CostEnvelopeSchema,
  DomainCompatibilitySchema,
  LabBudgetSchema,
  LabRunCandidatePayloadSchema,
  LabRunConfigurationSchema,
  LatencyDistributionSchema,
  NewLabInputSchema,
  OperatingProfileSchema,
  RightsRequirementSchema,
  SecurityPolicyEvidenceSummarySchema,
  TenantRefSchema,
} from "./domain";

// lab store (REL-020)
export { createUserLabs } from "./lab/store";
export type {
  BudgetOutcome,
  DomainSelectionOutcome,
  LabRunOutcome,
  LabRunRefusalReason,
  LabRunRequestInput,
  RevisionOutcome,
  SourceSelectionOutcome,
  UserLabs,
  UserLabsOptions,
} from "./lab/store";

// lab promotion requests (REL-020 — REQUEST only, the registry decides)
export {
  listPromotionRequests,
  requestPublicationPromotion,
  withdrawPromotionRequest,
} from "./lab/promotion";
export type {
  PromotionRequestGranted,
  PromotionRequestOutcome,
  PromotionRequestRecord,
  PromotionRequestRefused,
  PromotionRequestStatus,
} from "./lab/promotion";
export { PROMOTION_REQUEST_STATUSES } from "./lab/promotion";

// incentive policy + ledger (REL-021)
export { MAX_PRIVATE_USE_WINDOW_DAYS, createIncentivePolicyStore } from "./incentives/policy";
export type {
  CapabilityCreditsBenefit,
  DiscoveryBoostBenefit,
  IncentivePolicy,
  IncentivePolicyBenefits,
  IncentivePolicyStore,
} from "./incentives/policy";
export { IncentivePolicySchema } from "./incentives/policy";
export { LEDGER_ENTRY_KINDS, createIncentiveLedger } from "./incentives/ledger";
export type {
  CreditsGrantedEntry,
  CreditsUsedEntry,
  DiscoveryBoostEntry,
  IncentiveLedger,
  IncentiveLedgerEntry,
  IncentiveLedgerOptions,
  LedgerBalance,
  LedgerEntryKind,
  LedgerEntryOutcome,
  LedgerRefusalReason,
  LedgerRefused,
  LedgerRecorded,
  PrivateWindowExpiredEntry,
  PrivateWindowStartedEntry,
} from "./incentives/ledger";

// exchange: publishing (REL-022)
export {
  PUBLICATION_STATUSES,
  createExchange,
  publicationGaps,
  requestPublication,
  withdrawPublication,
} from "./exchange/publish";
export type {
  Exchange,
  ExchangeOptions,
  NewPublication,
  PublicationDisclosure,
  PublicationGranted,
  PublicationOutcome,
  PublicationRefused,
  PublicationSnapshot,
  PublicationSource,
  PublicationStatus,
  PublishedOrganization,
  PublishRequest,
} from "./exchange/publish";

// exchange: export (REL-023)
export {
  EXPORT_FORMAT_VERSION,
  checksumOf,
  exportChecksumPreimage,
  exportPublication,
  verifyExportChecksum,
} from "./exchange/export";
export type {
  ExportGranted,
  ExportOutcome,
  ExportRefused,
  OrganizationExport,
} from "./exchange/export";
export { OrganizationExportSchema } from "./exchange/export";

// exchange: import (REL-023)
export { findExecutableValues, importOrganization } from "./exchange/import";
export type {
  ImportGranted,
  ImportOptions,
  ImportOutcome,
  ImportRefusalReason,
  ImportRefused,
  ImportScope,
} from "./exchange/import";
export { ImportScopeSchema } from "./exchange/import";

// clock + errors
export {
  USER_LABS_DEFAULT_EPOCH_MS,
  createSequentialIdSource,
  createUserLabsDefaultClock,
  toIsoUtc,
} from "./clock";
export type { IdSource } from "./clock";
export {
  LabApiError,
  LabConflictError,
  LabInternalError,
  LabIsolationError,
  LabNotFoundError,
  LabValidationError,
  isLabError,
} from "./errors";
export type { LabError, LabFailureClass } from "./errors";
