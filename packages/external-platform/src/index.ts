/**
 * @sporta/external-platform — the provider-neutral external integration
 * surface (REL-014, REL-015, REL-016, ADR-013 #13/#15/#16,
 * docs/contracts/external-platform-and-mcp.md FROZEN).
 *
 * THE PRINCIPLE (the contract's first sentence): "API and MCP expose the
 * same Sporta application capabilities. Neither adapter creates a second
 * job, rights, artifact or promotion authority." Module map:
 *
 * - `domain`: the logical resources — PlatformConnection (tenant/platform
 *   isolation), the versioned service vocabulary (EXTERNAL_SERVICES +
 *   EXTERNAL_SERVICE_VERSION), the request schemas and the result records:
 *   OrganizationCatalogQuery/OrganizationSelection (search/inspect),
 *   LabRunRequest, MediaProcessingJob (submitMedia), FeedProcessingJob
 *   (submitFeed), OutputArtifact, EvidenceBundle,
 *   OrganizationPromotionRequest (+ the integration-scope import)
 * - `errors`: the typed platform error family (`platform.*`) + the
 *   transport-neutral TypedErrorRecord every surface maps the four typed
 *   families (platform/corpus/registry/jobs) into
 * - `services`: THE ONE TRUTH — the ten versioned application services.
 *   Long jobs return a durable job identifier immediately (the real
 *   @sporta/durable-jobs store); idempotency keys deduplicate mutations;
 *   reads are tenant-scoped (a foreign job is a typed not-found, never a
 *   leak); rights/policy enforcement is delegated to the corpus state
 *   machine and the registry's promotion gates; output/evidence refuse
 *   typed until completion (fail-closed)
 * - `processing`: the media + feed job executors over the durable-jobs
 *   runtime — the contract's pipeline (source validation through the
 *   corpus -> organization selection -> transform -> quality gate ->
 *   artifact + evidence published ATOMICALLY WITH COMPLETION), the
 *   transformer/quality-gate ports (honest v0 defaults), and the
 *   in-memory artifact/evidence stores
 * - `platform`: createExternalPlatform — the wiring (services + executors
 *   over one set of shared stores) + `connect` (the PlatformConnection)
 * - `http-surface`: the HTTP-style surface (REL-014) — versioned resource
 *   routes over the SAME services, in-memory dispatch, typed status
 *   mapping, fail-closed 404/405/version refusals
 * - `mcp-surface`: the MCP tool surface (REL-015) — the contract's ten
 *   tool families mapping 1:1 onto the SAME services; no business logic
 *   lives in the tool layer (the parity tests prove it per family)
 * - `clock` / `hash`: the injected clock + id source constitution and the
 *   canonical-JSON + SHA-256 primitives (the repo precedents)
 *
 * THE INVARIANTS (binding, tested):
 * - HTTP and MCP resolve to IDENTICAL application semantics: same input ->
 *   same service call -> same result record (deep-compared per family).
 * - A cancelled feed job leaves NO partial authoritative output; a crashed
 *   worker resumes from the durable checkpoints and completes exactly once.
 * - No declared rights basis -> the corpus's typed
 *   `corpus.rights-basis-required` refusal propagates through BOTH
 *   surfaces unchanged. Nothing bypasses rights, provenance, quality or
 *   promotion gates. OpenMuse/CopilotKit/AG-UI-style harnesses attach
 *   through @sporta/durable-jobs' read-only HarnessPort — their state is
 *   never authoritative.
 */
// domain
export { EXTERNAL_SERVICE_VERSION, EXTERNAL_SERVICES } from "./domain";
export type {
  CancelJobResult,
  ChoiceOrderingInput,
  EvidenceBundleRecord,
  ExternalServiceEnvelope,
  ExternalServiceName,
  ExternalServiceVersion,
  GetEvidenceResult,
  GetJobResult,
  GetOutputResult,
  InspectOrganizationResult,
  IntegrationScopeRecord,
  LaunchLabRunResult,
  OutputArtifactRecord,
  PlatformConnection,
  PromoteOrganizationResult,
  SearchOrganizationsResult,
  SubmitFeedResult,
  SubmitMediaResult,
  TenantScope,
} from "./domain";
export {
  ChoiceOrderingInputSchema,
  ConnectRequestSchema,
  FeedItemSubmissionSchema,
  FeedOrganizationSelectionSchema,
  InspectOrganizationRequestSchema,
  JobScopedRequestSchema,
  LabRunRequestSchema,
  LaunchLabRunRequestSchema,
  PromoteOrganizationRequestSchema,
  SearchOrganizationsRequestSchema,
  SubmitFeedRequestSchema,
  SubmitMediaRequestSchema,
} from "./domain";

// errors
export {
  PlatformApiError,
  PlatformConflictError,
  PlatformInternalError,
  PlatformJobStateError,
  PlatformNotFoundError,
  PlatformOrganizationPolicyError,
  PlatformValidationError,
  isPlatformError,
  toTypedErrorRecord,
} from "./errors";
export type { PlatformError, PlatformFailureClass, TypedErrorRecord } from "./errors";

// services (THE ONE TRUTH)
export { createExternalPlatformServices } from "./services";
export type { ExternalPlatformServices, ServicesDeps } from "./services";

// processing (the executors + the ports)
export {
  createChecksumQualityGate,
  createFeedProcessingExecutor,
  createHeaderTransformer,
  createMediaProcessingExecutor,
  createPlatformStores,
} from "./processing";
export type {
  FeedJobInput,
  MediaJobInput,
  PlatformQualityGate,
  PlatformStores,
  PlatformTransformer,
  ProcessingDeps,
  QualityGateResult,
} from "./processing";

// platform (the wiring)
export { createExternalPlatform } from "./platform";
export type { ExternalPlatform, ExternalPlatformDeps } from "./platform";

// http surface (REL-014)
export { createHttpSurface, httpStatusForFailureClass } from "./http-surface";
export type {
  HttpSurfaceFailure,
  HttpSurfaceRequest,
  HttpSurfaceResponse,
  HttpSurfaceSuccess,
} from "./http-surface";

// mcp surface (REL-015)
export { MCP_TOOLS, createMcpToolSurface } from "./mcp-surface";
export type {
  McpToolCallFailure,
  McpToolCallOutcome,
  McpToolCallRequest,
  McpToolCallSuccess,
  McpToolDefinition,
  McpToolSurface,
} from "./mcp-surface";

// clock + hash
export {
  PLATFORM_DEFAULT_EPOCH_MS,
  createDefaultConnectionIdSource,
  createPlatformDefaultClock,
  createSequentialIdSource,
  toIsoUtc,
} from "./clock";
export type { IdSource } from "./clock";
export { canonicalJson, sha256Hex, sha256HexBytes } from "./hash";
