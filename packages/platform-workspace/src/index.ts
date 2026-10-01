/**
 * @sporta/platform-workspace — the tenant-scoped platform processing
 * workspace (REL-024, ADR-013 #15/#16) — Gate REL-A10 as a real, tested
 * composition:
 *
 * ```
 * upload video -> choose/auto-select organization -> process
 *   -> quality gate -> retrieve transformed video + evidence chain
 * ```
 *
 * THE COMPOSITION LAW (binding): this package is a typed client and
 * composer over the imported authorities — it is NEVER a second job,
 * rights, artifact, promotion or quality authority. Module map:
 *
 * - `domain`: the journey's request schemas + result records — the upload
 *   outcome (real corpus digests), the selection outcome (the choice
 *   candidate + the DECLARED ordering statement, never a hidden ranking),
 *   the processing outcome (the durable job identifier), and the FULL
 *   EVIDENCE CHAIN record (job + upload provenance + selection +
 *   organization record version + output digests + evidence bundle)
 * - `quality`: `createOrganizationQualityGate` — the output gate that
 *   rides the organization record's DECLARED quality policy (benchmark
 *   metrics + uncertainty): the imported checksum gate's output checks +
 *   presence/consistency/floor checks derived from the record at execution
 *   time; typed refusals, never silent passes
 * - `workspace`: `createPlatformWorkspace` — the wiring. The imported
 *   external-platform services + executors over the shared
 *   registry/corpus/job-store, an embedded @sporta/durable-jobs
 *   WorkerRuntime, and `connect` -> the tenant-scoped session whose stage
 *   operations each ride the imported surfaces (submitMedia,
 *   searchOrganizations, inspectOrganization, the durable enqueue, the
 *   runtime attempt, getJob/getOutput/getEvidence)
 * - `errors`: the typed workspace error family (`workspace.*`) — the
 *   staging-discipline failures only; the underlying authorities' typed
 *   errors (`corpus.*`, `platform.*`, `registry.*`) propagate unchanged
 * - `clock`: the injected clock + id source constitution (repo precedent)
 *
 * THE DESIGN FREEDOM (REL-A10's own sentence): the composition permits
 * future YouTube-like integrations WITHOUT coupling Sporta to any single
 * external platform — the session surface is provider-neutral, the
 * simulated external platform of the tests sits exactly where a real
 * platform adapter would, and no provider name exists in this package.
 */
// domain
export {
  AutoSelectionRequestSchema,
  ExplicitSelectionRequestSchema,
  JobScopedRequestSchema,
  OrganizationCatalogRequestSchema,
  ProcessVideoRequestSchema,
  UploadVideoRequestSchema,
} from "./domain";
export type {
  CatalogOutcome,
  JourneyEvidenceChain,
  OrganizationVersionRef,
  ProcessingOutcome,
  SelectionMode,
  SelectionOutcome,
  UploadOutcome,
  UploadProvenance,
  UploadVideoRequest,
  ExplicitSelectionRequest,
  AutoSelectionRequest,
  OrganizationCatalogRequest,
  ProcessVideoRequest,
  JobScopedRequest,
} from "./domain";

// quality (the declared-quality gate)
export { DECLARED_QUALITY_GATE_ID, createOrganizationQualityGate } from "./quality";
export type { DeclaredQualityGateOptions } from "./quality";

// workspace (the composition)
export { DEFAULT_AUTO_ORDERING, createPlatformWorkspace } from "./workspace";
export type { PlatformWorkspace, PlatformWorkspaceOptions, WorkspaceSession } from "./workspace";

// clock + errors
export {
  WORKSPACE_DEFAULT_EPOCH_MS,
  createDefaultConnectionIdSource,
  createSequentialIdSource,
  createWorkspaceDefaultClock,
  toIsoUtc,
} from "./clock";
export type { IdSource } from "./clock";
export {
  WorkspaceApiError,
  WorkspaceConflictError,
  WorkspaceInternalError,
  WorkspaceJobStateError,
  WorkspaceNotFoundError,
  WorkspaceOrganizationSelectionError,
  WorkspaceValidationError,
  isWorkspaceError,
} from "./errors";
export type { WorkspaceError, WorkspaceFailureClass } from "./errors";
