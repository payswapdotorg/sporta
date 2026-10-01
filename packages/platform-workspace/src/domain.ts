/**
 * The platform-workspace domain (REL-024) — the tenant-scoped VIDEO JOURNEY
 * of Gate REL-A10, as request schemas + result records:
 *
 * ```
 * upload video -> choose/auto-select organization -> process
 *   -> quality gate -> retrieve transformed video + evidence chain
 * ```
 *
 * THE PRINCIPLE (ADR-013 #15/#16 + the REL-A10 gate): a simulated external
 * video platform composes Sporta's capabilities WITHOUT coupling Sporta to
 * any single platform. The workspace is a thin, typed composition over the
 * imported authorities — nothing here is a second job, rights, artifact or
 * promotion authority:
 *
 * - the CORPUS owns upload validation (rights basis at birth, digests);
 * - the REGISTRY + choice model own organization eligibility (the
 *   auto-selection ordering is the choice model's own DECLARED ordering —
 *   recorded in every outcome, never a hidden ranking);
 * - the EXTERNAL-PLATFORM services + executors own the durable job surface
 *   (submitMedia/searchOrganizations/getJob/getOutput/getEvidence are
 *   called, never re-implemented);
 * - the ORGANIZATION RECORD's declared benchmark metrics + uncertainty ARE
 *   the declared quality policy the output must satisfy
 *   (src/quality.ts — typed refusals, never silent passes).
 *
 * Requests are zod-validated at every stage boundary (fail-closed typed
 * validation, the repo pattern); results are deeply frozen on the way out.
 */
import { z } from "zod";
import type { ChoiceCandidate, OrganizationStatus } from "@sporta/organization-registry";
import { EligibilityQuerySchema } from "@sporta/organization-registry";
import type { EvidenceBundleRecord, TenantScope } from "@sporta/external-platform";
import { ChoiceOrderingInputSchema } from "@sporta/external-platform";
import type { JobState } from "@sporta/durable-jobs";
import type { AcquisitionState, RightsBasis } from "@sporta/historical-corpus";
import { RightsBasisSchema, UserUploadMetadataSchema } from "@sporta/historical-corpus";

// ---------------------------------------------------------------------------
// Stage 1 — upload (the corpus gate rides underneath)
// ---------------------------------------------------------------------------

/** The upload request: the platform-held bytes + the declared basis. */
export const UploadVideoRequestSchema = z.object({
  /** The video bytes (fixture bytes in this slice; real digests regardless). */
  bytes: z.instanceof(Uint8Array),
  /** The declared rights/policy basis — REQUIRED (the corpus gate). */
  declaredBasis: RightsBasisSchema,
  /** The declared metadata for the upload. */
  metadata: UserUploadMetadataSchema,
});

export type UploadVideoRequest = z.infer<typeof UploadVideoRequestSchema>;

/** The upload outcome: the corpus-born source with its real digests. */
export interface UploadOutcome {
  readonly sourceId: string;
  /** The corpus acquisition state (`acquired` — user uploads are born acquired). */
  readonly sourceState: AcquisitionState | string;
  readonly canonicalUrl: string;
  /** SHA-256 hex of the acquired bytes — computed by the corpus, not asserted. */
  readonly acquiredChecksum: string | null;
  /** SHA-256 hex of the canonical metadata serialization. */
  readonly metadataDigest: string;
  readonly rightsBasis: {
    readonly basisType: RightsBasis["basisType"];
    readonly grantRef: string;
    readonly declaredBy: string;
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — organization selection (the choice read model, declared ordering)
// ---------------------------------------------------------------------------

/** The catalog request: the eligibility query + the DECLARED ordering. */
export const OrganizationCatalogRequestSchema = z.object({
  query: EligibilityQuerySchema,
  ordering: ChoiceOrderingInputSchema.optional(),
});

export type OrganizationCatalogRequest = z.infer<typeof OrganizationCatalogRequestSchema>;

/** The catalog outcome: every eligible organization with visible evidence. */
export interface CatalogOutcome {
  readonly candidates: readonly ChoiceCandidate[];
  readonly orderedBy: string;
}

/** The explicit selection request. */
export const ExplicitSelectionRequestSchema = z.object({
  organizationId: z.string().min(1),
});

export type ExplicitSelectionRequest = z.infer<typeof ExplicitSelectionRequestSchema>;

/** The auto-selection request: the query + the ordering (default documented). */
export const AutoSelectionRequestSchema = z.object({
  query: EligibilityQuerySchema,
  ordering: ChoiceOrderingInputSchema.optional(),
});

export type AutoSelectionRequest = z.infer<typeof AutoSelectionRequestSchema>;

/** How a selection was made — recorded with every journey, never hidden. */
export type SelectionMode = "explicit" | "auto" | "direct";

/** The selection outcome: the chosen organization + the ordering statement. */
export interface SelectionOutcome {
  /** The chosen organization as the choice model sees it (visible evidence). */
  readonly organization: ChoiceCandidate;
  readonly organizationId: string;
  readonly mode: SelectionMode;
  /**
   * The ordering statement actually applied (auto) or null (explicit) — the
   * choice model's own human-readable `orderedBy`, recorded verbatim.
   */
  readonly orderedBy: string | null;
  /** How many eligible candidates the selection considered. */
  readonly candidatesConsidered: number;
}

// ---------------------------------------------------------------------------
// Stage 3 — processing (the durable job surface)
// ---------------------------------------------------------------------------

/** The processing request: an uploaded source + a selected organization. */
export const ProcessVideoRequestSchema = z.object({
  sourceId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type ProcessVideoRequest = z.infer<typeof ProcessVideoRequestSchema>;

/** The processing outcome: the durable job identifier, returned immediately. */
export interface ProcessingOutcome {
  readonly jobId: string;
  readonly kind: "external.media-processing";
  readonly state: JobState;
  readonly sourceId: string;
  readonly organizationId: string;
  /** The selection record carried into the journey (mode + ordering statement). */
  readonly selection: {
    readonly mode: SelectionMode;
    readonly orderedBy: string | null;
  };
}

/** The job-scoped read request (job/output/evidence/chain). */
export const JobScopedRequestSchema = z.object({
  jobId: z.string().min(1),
});

export type JobScopedRequest = z.infer<typeof JobScopedRequestSchema>;

// ---------------------------------------------------------------------------
// Stage 4 — retrieval (output + the full evidence chain)
// ---------------------------------------------------------------------------

/** The organization record version leg of the evidence chain. */
export interface OrganizationVersionRef {
  readonly organizationId: string;
  /** The registry record version that produced the output (pinned at completion). */
  readonly version: number;
  readonly status: OrganizationStatus;
  readonly displayName: string;
  /**
   * The DECLARED quality policy the output was gated against: benchmark
   * metrics with their uncertainty intervals, null when the organization
   * declared none (which the quality gate itself refuses).
   */
  readonly declaredQuality:
    | readonly {
        readonly axis: string;
        readonly value: number;
        readonly ciLow: number;
        readonly ciHigh: number;
      }[]
    | null;
}

/** The upload provenance leg of the evidence chain (corpus authority). */
export interface UploadProvenance {
  readonly sourceId: string;
  readonly canonicalUrl: string;
  readonly provider: string;
  readonly sourceState: AcquisitionState | string;
  readonly rightsBasis: {
    readonly basisType: RightsBasis["basisType"];
    readonly grantRef: string;
    readonly declaredBy: string;
  } | null;
  readonly acquiredChecksum: string | null;
  readonly normalizedChecksum: string | null;
  readonly metadataDigest: string;
  readonly restrictions: readonly string[];
}

/**
 * THE FULL EVIDENCE CHAIN of one journey: the job (durable canonical
 * state), the upload provenance + digests (corpus), the selection record
 * (documented ordering), the organization record version (registry), the
 * output artifact digests, and the platform evidence bundle (source
 * lineage + the quality-gate verdict). Assembled from the authorities'
 * own records — the workspace computes nothing it does not own.
 */
export interface JourneyEvidenceChain {
  readonly jobId: string;
  readonly scope: TenantScope;
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
  readonly upload: UploadProvenance;
  readonly selection: {
    readonly organizationId: string;
    readonly mode: SelectionMode;
    readonly orderedBy: string | null;
  };
  readonly organization: OrganizationVersionRef;
  readonly output: {
    readonly artifactId: string;
    readonly artifactRef: string;
    readonly checksum: string;
    readonly byteLength: number;
    readonly kind: "transformed-media" | "feed-output";
    readonly items: readonly {
      readonly sourceId: string;
      readonly canonicalUrl: string;
      readonly checksum: string;
    }[];
    readonly organizationId: string | null;
  };
  readonly evidence: EvidenceBundleRecord;
}
