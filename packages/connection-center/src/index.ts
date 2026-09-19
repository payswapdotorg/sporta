/**
 * @sporta/connection-center — the product-plane compute experience
 * (R406-R409) over the FROZEN compute seams:
 *
 * - **R406** `connections` — the compute connection center: provider
 *   connect/verify/disconnect/status with the master-password refusal
 *   (fail-closed, audited) and credential REFERENCES only (sha-256
 *   fingerprints — values never stored, logged, or reported);
 *
 * The package reads NO environment (test/boundary pins it): composition
 * is explicit (providers, facts, stores, clocks all injected) — env
 * resolution belongs to the app's composition root, which composes the
 * `@sporta/compute-provider-adapters` env seam when it needs it.
 */
// R406 — the connection center + its substrate
export {
  ACCEPTED_CREDENTIAL_KINDS,
  CREDENTIAL_FINGERPRINT_HEX_LENGTH,
  CREDENTIAL_PRESENTATION_KINDS,
  CredentialPresentation,
  MASTER_PASSWORD_KINDS,
  MASTER_PASSWORD_REFUSAL_MESSAGES,
  MasterPasswordPresentation,
  MasterPasswordRefusalError,
  AcceptedCredentialPresentation,
  credentialDisplayLabel,
  credentialFingerprint,
  isMasterPasswordRefusalError,
} from "./credentials";
export type {
  AcceptedCredentialKind,
  AcceptedCredentialPresentation,
  CredentialPresentationKind,
  CredentialReference,
  MasterPasswordKind,
  MasterPasswordRefusalSurface,
} from "./credentials";
export {
  CONNECTION_AUDIT_OUTCOMES,
  ConnectionAuditEntry,
  ConnectionConflictError,
  ConnectionRecordAbsentError,
  ConnectionScopeInvalidError,
  ConnectionStoreError,
  ConnectionStoreIntegrityError,
  ConnectionStoreLimitError,
  ConnectionStaleWriteError,
  DEFAULT_MAX_AUDIT_ENTRIES,
  DEFAULT_MAX_HISTORY_ENTRIES,
  DEFAULT_MAX_RECORDS,
  InMemoryConnectionStore,
  SqliteConnectionStore,
  assertScopeValid,
  createDeterministicStoreClock,
} from "./store";
export type {
  ConnectionAuditOutcome,
  ConnectionStore,
  ConnectionStoreOptions,
  ConnectionStoreStats,
  InsertOutcome,
  UpdateOutcome,
} from "./store";
export {
  ConnectionCenter,
  ConnectionBindingAbsentError,
  ConnectionCenterError,
  ConnectionValidationError,
  CredentialKindUnsupportedError,
  UnknownConnectionError,
  UnknownConnectionProviderError,
} from "./connections";
export type {
  AccountId,
  ConnectionCenterOptions,
  ConnectionPlaneProvider,
  CredentialVerifiableAdapter,
} from "./connections";
// The shared versioned documents
export {
  CONNECTION_EVENT_TYPES,
  CONNECTION_POSTURES,
  CONNECTION_SCHEMA_VERSION,
  CONNECTION_STATES,
  ConnectionEvent,
  ConnectionRecordSchema,
  ConnectionStatusReport,
} from "./schema";
export type {
  ConnectionEvent as ConnectionEventDoc,
  ConnectionState,
  ConnectionEventType,
  ConnectionPosture,
  ConnectionRecord,
  ConnectionStatusReport as ConnectionStatusReportDoc,
} from "./schema";
// The policy (versioned DATA + the golden-pinned default)
export {
  CONNECTION_POLICY_VERSION,
  DEFAULT_CONNECTION_POLICY,
  PROVIDER_FACT_ZONES,
  SELECTION_EXCLUSION_AXES,
  SELECTION_PRIVACY_POSTURES,
  ConnectionCenterPolicy,
  validateConnectionPolicy,
} from "./policy";
export type {
  ConnectionCenterPolicy as ConnectionCenterPolicyDoc,
  ProviderFactZone,
  SelectionExclusionAxis,
  SelectionPrivacyPosture,
} from "./policy";
// R407 — the selection director
export {
  SELECTION_DIRECTIVE_MODES,
  SELECTION_REASONS,
  SelectionDirector,
  SelectionPreference,
  SelectionRefusedError,
  SelectionValidationError,
  UserSelectionDirective,
  canonicalSelectionExplanation,
} from "./selection";
export type {
  ConsideredProvider,
  PreferenceExclusion,
  ProviderSelectionFacts,
  SelectionDirectiveMode,
  SelectionExplanation,
  SelectionOutcome,
  SelectionRefusalRecord,
  SelectionReasonKey,
} from "./selection";
// R408 — the BYOC usage ledger
export {
  ByocLedgerConflictError,
  ByocLedgerError,
  ByocLedgerIntegrityError,
  ByocLedgerLimitError,
  ByocLedgerScopeInvalidError,
  ByocUsageRecord,
  DEFAULT_MAX_LEDGER_RECORDS,
  EXECUTION_OWNERSHIPS,
  InMemoryByocLedgerStore,
  SqliteByocLedgerStore,
  UsageLedger,
} from "./ledger";
export type {
  ByocLedgerStore,
  ByocLedgerStoreOptions,
  ByocLedgerStoreStats,
  ByocUsageRecord as ByocUsageRecordDoc,
  ExecutionOwnership,
  LedgerPutOutcome,
  RecordOutcome,
  UsageSummary,
  UsageLedgerOptions,
} from "./ledger";
// R409 — the managed compute seam
export {
  DEFAULT_MAX_ENTITLEMENTS,
  MANAGED_REFUSAL_BOUNDS,
  ManagedAdmissionRefusalError,
  ManagedComputeEntitlement,
  ManagedComputeSeam,
  ManagedSequenceError,
  EntitlementConflictError,
  EntitlementStoreError,
  InMemoryEntitlementStore,
  SqliteEntitlementStore,
} from "./managed";
export type {
  EntitlementStore,
  EntitlementStoreOptions,
  EntitlementStoreStats,
  ManagedAdmission,
  ManagedAlarmEvent,
  ManagedComputeEntitlement as ManagedComputeEntitlementDoc,
  ManagedComputeSeamOptions,
  ManagedRefusalBound,
  ManagedStatus,
  SettlementOutcome,
} from "./managed";
