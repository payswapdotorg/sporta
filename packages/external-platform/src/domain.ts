/**
 * The external-platform domain (REL-014) — the contract's LOGICAL RESOURCES
 * as versioned, provider-neutral records:
 * docs/contracts/external-platform-and-mcp.md (FROZEN):
 * PlatformConnection, OrganizationCatalogQuery, OrganizationSelection,
 * LabRunRequest, MediaProcessingJob, FeedProcessingJob, OutputArtifact,
 * EvidenceBundle, OrganizationPromotionRequest.
 *
 * THE PRINCIPLE (the contract's own first sentence): "API and MCP expose
 * the same Sporta application capabilities. Neither adapter creates a
 * second job, rights, artifact or promotion authority." Every request here
 * maps 1:1 onto a versioned application service (src/services.ts); the
 * HTTP surface (src/http-surface.ts) and the MCP tool surface
 * (src/mcp-surface.ts) are two transports over the ONE truth.
 *
 * In THIS slice the services are in-memory (no network server, no new
 * native dependencies) but the SHAPE is the contract: long jobs return a
 * durable job identifier immediately (backed by the real @sporta/durable-jobs
 * store), idempotency keys deduplicate mutations, tenant/platform isolation
 * rides on the connection, and rights/policy enforcement is delegated to
 * the corpus state machine (@sporta/historical-corpus) and the promotion
 * gates (@sporta/organization-registry).
 */
import { z } from "zod";
import {
  EligibilityQuerySchema,
  type ChoiceCandidate,
  type ChoiceOrdering,
  type OrganizationStatus,
  type PromotionOutcome,
  type PromotionPolicy,
} from "@sporta/organization-registry";
import {
  RightsBasisSchema,
  SourceMetadataSchema,
  UserUploadMetadataSchema,
} from "@sporta/historical-corpus";
import type { JobState } from "@sporta/durable-jobs";

// ---------------------------------------------------------------------------
// The versioned service surface
// ---------------------------------------------------------------------------

/** The version of the external application-service surface (every result carries it). */
export const EXTERNAL_SERVICE_VERSION = 1 as const;

/** The version carried by every service result record. */
export type ExternalServiceVersion = typeof EXTERNAL_SERVICE_VERSION;

/** The ten versioned application services (the contract's tool families, service-named). */
export const EXTERNAL_SERVICES = [
  "searchOrganizations",
  "inspectOrganization",
  "launchLabRun",
  "submitMedia",
  "submitFeed",
  "getJob",
  "cancelJob",
  "getOutput",
  "getEvidence",
  "promoteOrganization",
] as const;

export type ExternalServiceName = (typeof EXTERNAL_SERVICES)[number];

// ---------------------------------------------------------------------------
// PlatformConnection (tenant/platform isolation carrier)
// ---------------------------------------------------------------------------

/**
 * The connection a platform opens: the isolation scope every operation
 * rides on. State NEVER lives here — the connection is a scope carrier, so
 * a reconnect is simply a new connection over the same canonical stores.
 */
export interface PlatformConnection {
  readonly connectionId: string;
  readonly platformId: string;
  readonly tenantId: string;
  readonly createdAt: number;
}

/** The tenant scope the services stamp into every job they enqueue. */
export interface TenantScope {
  readonly platformId: string;
  readonly tenantId: string;
}

export const ConnectRequestSchema = z.object({
  platformId: z.string().min(1),
  tenantId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Organization catalog query + selection
// ---------------------------------------------------------------------------

/** The declared ordering (mirrors the registry's ChoiceOrdering, wire-valid). */
export const ChoiceOrderingInputSchema = z.union([
  z.object({ kind: z.literal("registry-order") }),
  z.object({ kind: z.literal("cost-ascending") }),
  z.object({ kind: z.literal("latency-ascending") }),
  z.object({ kind: z.literal("quality-descending"), axis: z.string().min(1) }),
]);

export type ChoiceOrderingInput = z.infer<typeof ChoiceOrderingInputSchema>;

export const SearchOrganizationsRequestSchema = z.object({
  query: EligibilityQuerySchema,
  ordering: ChoiceOrderingInputSchema.optional(),
});

export const InspectOrganizationRequestSchema = z.object({
  organizationId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Lab run request
// ---------------------------------------------------------------------------

export const LabRunRequestSchema = z.object({
  /** The lab domain pack, e.g. "football". */
  domain: z.string().min(1),
  /** The task/event type, e.g. "match". */
  task: z.string().min(1).optional(),
  /** An organization the lab run should evaluate (optional). */
  organizationId: z.string().min(1).optional(),
  /** The compute budget ceiling (USD). */
  budgetUsd: z.number().positive().optional(),
  /** The wall-clock ceiling (ms). */
  maxDurationMs: z.number().int().positive().optional(),
  /** Free-form lab configuration (recorded verbatim on the job input). */
  configuration: z.record(z.string(), z.unknown()).optional(),
});

export const LaunchLabRunRequestSchema = z.object({
  labRun: LabRunRequestSchema,
  idempotencyKey: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Media processing job (submit_video)
// ---------------------------------------------------------------------------

export const SubmitMediaRequestSchema = z
  .object({
    /** The platform-held bytes to ingest (the user-fed path; requires declaredBasis). */
    bytes: z.instanceof(Uint8Array).optional(),
    /** The declared rights/policy basis — REQUIRED with bytes (the corpus gate). */
    declaredBasis: RightsBasisSchema.optional(),
    /** The declared metadata for the upload. */
    metadata: UserUploadMetadataSchema.optional(),
    /** Alternatively: a source REFERENCE (metadata only, never bytes). */
    reference: SourceMetadataSchema.optional(),
    /** The organization to process with (selected from the eligible catalog). */
    organizationId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .refine(
    (request) =>
      (request.bytes !== undefined && request.metadata !== undefined) !==
      (request.reference !== undefined),
    {
      message:
        "submit exactly one of bytes+metadata (the upload path) or reference (the reference path)",
    },
  );

// ---------------------------------------------------------------------------
// Feed processing job (submit_feed)
// ---------------------------------------------------------------------------

export const FeedItemSubmissionSchema = z.object({
  metadata: SourceMetadataSchema,
  /** The feed item's bytes; absent bytes submit the item as a REFERENCE. */
  bytes: z.instanceof(Uint8Array).optional(),
  /** The declared basis for THIS item's acquisition (required with bytes). */
  declaredBasis: RightsBasisSchema.optional(),
});

export const FeedOrganizationSelectionSchema = z.union([
  z.object({ organizationId: z.string().min(1) }),
  z.object({
    query: EligibilityQuerySchema,
    ordering: ChoiceOrderingInputSchema.optional(),
  }),
]);

export const SubmitFeedRequestSchema = z.object({
  items: z.array(FeedItemSubmissionSchema).min(1),
  organization: FeedOrganizationSelectionSchema,
  /**
   * Must every item be transformable? When true (the default) a
   * reference-submitted item fails the feed job fail-closed; when false,
   * reference items are indexed and recorded as skipped in the evidence.
   */
  requireTransformation: z.boolean().optional(),
  idempotencyKey: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Job reads, cancellation, output, evidence
// ---------------------------------------------------------------------------

export const JobScopedRequestSchema = z.object({
  jobId: z.string().min(1),
});

export const PromoteOrganizationRequestSchema = z.object({
  organizationId: z.string().min(1),
  /**
   * The versioned promotion policy. The SHAPE is validated by the
   * registry's own `validatePromotionPolicy` (fail-closed) — the platform
   * only checks it is an object and forwards it. There is NO silent
   * default policy: the platform names its bars.
   */
  policy: z.custom<PromotionPolicy>((value) => typeof value === "object" && value !== null, {
    message: "policy must be the versioned promotion policy object",
  }),
  /**
   * Evidence submitted (as its own audited version) before the gates
   * evaluate — forwarded verbatim to the registry; the registry validates
   * the evidence shape.
   */
  additionalEvidence: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// The service result records
// ---------------------------------------------------------------------------

/** The envelope every service returns: the versioned truth both surfaces carry. */
export interface ExternalServiceEnvelope<T> {
  readonly service: ExternalServiceName;
  readonly version: ExternalServiceVersion;
  readonly result: T;
}

/** searchOrganizations: the honest choice read model, verbatim. */
export interface SearchOrganizationsResult {
  readonly candidates: readonly ChoiceCandidate[];
  readonly ordering: ChoiceOrdering;
  readonly orderedBy: string;
}

/** inspectOrganization: one organization's visible evidence. */
export interface InspectOrganizationResult {
  readonly organization: ChoiceCandidate;
}

/** launchLabRun: the durable job identifier, returned immediately. */
export interface LaunchLabRunResult {
  readonly jobId: string;
  readonly kind: "external.lab-run";
  readonly state: JobState;
  readonly acceptedAt: number;
}

/** submitMedia: the source (through the corpus gate) + the processing job. */
export interface SubmitMediaResult {
  readonly sourceId: string;
  readonly sourceState: string;
  readonly canonicalUrl: string;
  /** Present when processing was requested (organizationId given). */
  readonly jobId: string | null;
  readonly jobKind: "external.media-processing" | null;
}

/** submitFeed: the durable feed job identifier, returned immediately. */
export interface SubmitFeedResult {
  readonly jobId: string;
  readonly kind: "external.feed-processing";
  readonly itemCount: number;
  readonly transformableItemCount: number;
  readonly organizationId: string;
  /** The declared ordering statement when selection ran (no hidden ranking). */
  readonly orderedBy: string | null;
}

/** getJob: the tenant-safe projection of the canonical job record. */
export interface GetJobResult {
  readonly job: {
    readonly jobId: string;
    readonly kind: string;
    readonly state: JobState;
    readonly attempts: number;
    readonly checkpointCount: number;
    readonly cancellationRequested: boolean;
    readonly outputArtifactRefs: readonly string[];
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly completedAt: number | null;
  };
}

/** cancelJob: the cancellation state after the request. */
export interface CancelJobResult {
  readonly jobId: string;
  readonly state: JobState;
  readonly cancellationRequested: boolean;
  readonly cancelled: boolean;
}

/** getOutput: the authoritative output artifact (published only at completion). */
export interface GetOutputResult {
  readonly artifact: OutputArtifactRecord;
  readonly bytes: Uint8Array;
}

/** getEvidence: the evidence bundle (lineage + quality gate). */
export interface GetEvidenceResult {
  readonly evidence: EvidenceBundleRecord;
}

/** promoteOrganization: the registry's outcome + the integration-scope import. */
export interface PromoteOrganizationResult {
  readonly outcome: PromotionOutcome;
  /** True iff the organization's latest status is selectable (imported into scope). */
  readonly imported: boolean;
  readonly integrationScope: IntegrationScopeRecord | null;
}

// ---------------------------------------------------------------------------
// OutputArtifact + EvidenceBundle (the contract's logical resources)
// ---------------------------------------------------------------------------

/** The authoritative output artifact record (immutable once published). */
export interface OutputArtifactRecord {
  readonly artifactId: string;
  readonly jobId: string;
  readonly scope: TenantScope;
  readonly kind: "transformed-media" | "feed-output";
  /** The content address: `artifact://<sha256 of the bytes>`. */
  readonly artifactRef: string;
  readonly checksum: string;
  readonly byteLength: number;
  /** The per-source items the artifact covers (the lineage index). */
  readonly items: readonly {
    readonly sourceId: string;
    readonly canonicalUrl: string;
    readonly checksum: string;
  }[];
  readonly organizationId: string | null;
  readonly createdAt: number;
}

/** The evidence bundle: source lineage + the quality-gate verdict. */
export interface EvidenceBundleRecord {
  readonly evidenceId: string;
  readonly jobId: string;
  readonly scope: TenantScope;
  readonly sourceLineage: readonly {
    readonly sourceId: string;
    readonly canonicalUrl: string;
    readonly provider: string;
    readonly acquiredChecksum: string | null;
    readonly normalizedChecksum: string | null;
    readonly outcome: "transformed" | "skipped-reference";
  }[];
  readonly qualityGate: {
    readonly gateId: string;
    readonly passed: boolean;
    readonly checks: readonly {
      readonly name: string;
      readonly passed: boolean;
      readonly detail: string;
    }[];
  };
  readonly organizationId: string | null;
  readonly createdAt: number;
}

/** The platform's integration-scope import of a validated organization. */
export interface IntegrationScopeRecord {
  readonly platformId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly status: OrganizationStatus;
  readonly importedAt: number;
}
