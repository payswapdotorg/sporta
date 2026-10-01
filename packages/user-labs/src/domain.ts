/**
 * The user-labs domain model (REL-020..023, ADR-013).
 *
 * Source of truth:
 * - docs/contracts/organization-registry-and-promotion.md §User labs,
 *   §Incentive policy, §Retirement (FROZEN): "A user lab creates
 *   tenant-scoped organization candidates. Candidates remain private until
 *   the user publishes/promotes them."
 * - docs/contracts/agent-body-and-organization.md (FROZEN) — the
 *   organization definition axes a lab candidate must eventually carry to be
 *   publishable (domains, event types, live/batch, renderers, capabilities,
 *   latency/cost profile).
 * - docs/testing/reality-engineering-lab-acceptance.md Gate REL-A6 (the
 *   user-lab flow this package types end to end).
 *
 * THE TENANT LAW (binding, tested in test/isolation.test.ts): every record
 * in this package is tenant-scoped; the candidate store has exactly ONE
 * visibility value ("private") — a candidate becomes visible outside the
 * owning tenant ONLY through the REL-022 publication operation, which
 * produces a separate immutable snapshot in the exchange. There is no
 * "publish candidate in place" path.
 *
 * SEAM DISCIPLINE: `SourceDataPort` and `LabRunPort` are LOCAL seam
 * interfaces (the historical corpus and the durable lab runtime are owned by
 * other packages; this package consumes them through these ports and never
 * implements them). Registry-compatibility is proven by validating against
 * `@sporta/organization-registry`'s exported `NewOrganizationInputSchema` at
 * the REL-023 import boundary — a read-only use of that package.
 */
import { z } from "zod";
import { LabValidationError } from "./errors";

// ---------------------------------------------------------------------------
// Tenants — the isolation boundary
// ---------------------------------------------------------------------------

/** The tenant identity every user-lab operation is scoped by. */
export const TenantRefSchema = z.strictObject({
  tenantId: z.string().min(1),
});

export type TenantRef = z.infer<typeof TenantRefSchema>; // zod-inferred: tenantId

/**
 * Boundary guard shared by every operation: the caller must be a well-formed
 * tenant reference or the operation refuses before touching any state
 * (fail closed, registry `register` precedent).
 */
export function requireTenantRef(caller: TenantRef): void {
  const parsed = TenantRefSchema.safeParse(caller);
  if (!parsed.success) {
    throw new LabValidationError("caller tenant reference is invalid", [
      { path: "tenantId", message: "tenantId must be a non-empty string" },
    ]);
  }
}

// ---------------------------------------------------------------------------
// The domain catalog (which domain packs / tasks a lab may select)
// ---------------------------------------------------------------------------

/** One domain pack and the tasks (event types) selectable within it. */
export interface DomainCatalogEntry {
  domainPackId: string;
  tasks: readonly string[];
}

/** The injected catalog of selectable domain packs (football is pack #1). */
export type DomainCatalog = readonly DomainCatalogEntry[];

// ---------------------------------------------------------------------------
// Source data (the historical corpus SEAM — REL-020 "select source data")
// ---------------------------------------------------------------------------

/**
 * The rights basis vocabulary mirrors the registry's rights gate exactly
 * (docs/contracts/organization-registry-and-promotion.md; ADR-013 #7: "A
 * public URL alone never proves transformation rights"). `unverified` fails
 * every source-selection check fail-closed.
 */
export const SOURCE_RIGHTS_BASIS_TYPES = [
  "licensed",
  "user-upload",
  "authorized-feed",
  "unverified",
] as const;

export type SourceRightsBasisType = (typeof SOURCE_RIGHTS_BASIS_TYPES)[number];

/** The declared rights basis of one historical source-data record. */
export interface SourceRightsBasis {
  basisType: SourceRightsBasisType;
  rightsBasisId: string;
}

/** One historical corpus record a lab may reference as source data. */
export interface SourceDataRecord {
  sourceRef: string;
  domainPackId: string;
  rightsBasis: SourceRightsBasis;
}

/**
 * The historical-corpus seam: resolves source references into records. The
 * port returns the records it KNOWS; refs it does not know are simply absent
 * from the result and the caller refuses them typed (fail closed — an
 * unknown reference never becomes silent source basis). A record whose
 * rights basis is `unverified` is returned but refused by the selection
 * checks, for the same reason.
 */
export interface SourceDataPort {
  resolve(refs: readonly string[]): Promise<SourceDataRecord[]>;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/** The lab's compute budget ceiling (the run-request gate reads this). */
export const LabBudgetSchema = z.strictObject({
  totalUsd: z.number().finite().positive(),
});

export type LabBudget = z.infer<typeof LabBudgetSchema>; // zod-inferred: totalUsd

// ---------------------------------------------------------------------------
// The user lab record (REL-020)
// ---------------------------------------------------------------------------

export const LAB_STATUSES = ["active", "archived"] as const;

export type LabStatus = (typeof LAB_STATUSES)[number];

/** The domain/task selection a lab owner makes (REL-A6 step 2). */
export interface LabSelection {
  domainPackId: string;
  task: string;
}

/** New-lab input (validated at the store boundary). */
export const NewLabInputSchema = z.strictObject({
  name: z.string().min(1),
});

export type NewLabInput = z.infer<typeof NewLabInputSchema>; // zod-inferred: name

/**
 * A tenant-scoped user lab. `spentUsd` is the audited total of COMPLETED run
 * costs charged against `budget` (the budget gate refuses requests whose
 * estimate would cross the ceiling).
 */
export interface UserLab {
  labId: string;
  owner: TenantRef;
  name: string;
  status: LabStatus;
  selection: LabSelection | null;
  sourceDataRefs: readonly string[];
  budget: LabBudget | null;
  spentUsd: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Lab runs (REL-020 "request a simulation/search run"; the durable seam)
// ---------------------------------------------------------------------------

export const RUN_PURPOSES = ["simulation", "search"] as const;

export type RunPurpose = (typeof RUN_PURPOSES)[number];

export const RUN_STATUSES = ["completed", "failed"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** The run configuration (recorded for reproducibility, registry-style). */
export const LabRunConfigurationSchema = z.strictObject({
  seed: z.string().min(1),
  iterations: z.number().int().positive(),
});

export type LabRunConfiguration = z.infer<typeof LabRunConfigurationSchema>;

/**
 * The durable-run request handed to the {@link LabRunPort}. The service
 * allocates the run id, resolves and rights-verifies the source data, and
 * passes the full context — the port never re-derives rights.
 */
export interface LabRunRequest {
  runId: string;
  labId: string;
  requestedBy: TenantRef;
  purpose: RunPurpose;
  configuration: LabRunConfiguration | null;
  estimatedCostUsd: number;
  selection: LabSelection;
  sourceData: readonly SourceDataRecord[];
  requestedAt: string;
}

/**
 * A candidate produced inside a lab run. The DEFINITION and PROVENANCE are
 * DRAFTS by design: a lab is a lab — runs may emit partial candidates, and
 * completeness is enforced fail-closed at the REL-022 publication gate, not
 * at ingest. Every field that IS present must be well-formed (validated by
 * {@link LabRunCandidatePayloadSchema} at ingest — declared alongside the
 * draft schemas below).
 */
export interface LabRunCandidatePayload {
  definition: CandidateDefinitionDraft;
  evidence: CandidateEvidence;
  provenance: {
    lineage: string[];
    rightsRequirements: RightsRequirement[];
  };
}

/**
 * One lab run record. In this wave the scripted port returns terminal
 * records synchronously; the product wires this seam to the real durable lab
 * runtime later (the shape is the port contract).
 */
export interface LabRunRecord {
  runId: string;
  labId: string;
  requestedBy: TenantRef;
  purpose: RunPurpose;
  configuration: LabRunConfiguration | null;
  estimatedCostUsd: number;
  status: RunStatus;
  costUsd: number;
  candidates: readonly LabRunCandidatePayload[];
  requestedAt: string;
  completedAt: string;
  /** Present iff the run failed. */
  failureReason?: string;
}

/**
 * The durable lab-runtime seam (REL-020 `LabRunRequest -> durable-run`).
 * The product wires this to the real runtime; tests inject a scripted
 * implementation returning deterministic run records.
 */
export interface LabRunPort {
  requestRun(request: LabRunRequest): Promise<LabRunRecord>;
}

// ---------------------------------------------------------------------------
// The candidate definition (the organization a lab run produced)
// ---------------------------------------------------------------------------

/**
 * LOCAL SEAM (recorded in DEVIATIONS): the registry does not export these
 * sub-schemas individually, so these are field-identical local mirrors of
 * `@sporta/organization-registry`'s CapabilityBinding / DomainCompatibility
 * / LatencyDistribution / CostEnvelope / RightsRequirement shapes. Final
 * compatibility is proven where it matters — the REL-023 import validates
 * the assembled record against the registry's own exported
 * `NewOrganizationInputSchema`.
 */

const KEBAB_CASE = /^[a-z0-9][a-z0-9-]*$/;

export const CapabilityBindingSchema = z.strictObject({
  capabilityId: z.string().min(1),
  capabilityVersion: z.string().min(1),
  modelRuntime: z
    .strictObject({
      modelId: z.string().min(1),
      runtimeId: z.string().min(1),
    })
    .optional(),
});

export type CapabilityBinding = z.infer<typeof CapabilityBindingSchema>; // zod-inferred

export const DomainCompatibilitySchema = z.strictObject({
  domains: z.array(z.string().min(1)).min(1),
  eventTypes: z.array(z.string().min(1)).min(1),
  modes: z.array(z.enum(["live", "batch"])).min(1),
  renderers: z.array(z.string().min(1)).min(1),
});

export type DomainCompatibility = z.infer<typeof DomainCompatibilitySchema>; // zod-inferred

export const LatencyDistributionSchema = z
  .strictObject({
    p50Ms: z.number().nonnegative(),
    p95Ms: z.number().nonnegative(),
    p99Ms: z.number().nonnegative(),
  })
  .refine((v) => v.p50Ms <= v.p95Ms && v.p95Ms <= v.p99Ms, {
    message: "latency percentiles must be ordered p50 <= p95 <= p99",
  });

export type LatencyDistribution = z.infer<typeof LatencyDistributionSchema>;

export const CostEnvelopeSchema = z.strictObject({
  perRunUsd: z.number().nonnegative(),
});

export type CostEnvelope = z.infer<typeof CostEnvelopeSchema>;

export const OperatingProfileSchema = z.strictObject({
  latency: LatencyDistributionSchema,
  cost: CostEnvelopeSchema,
});

export type OperatingProfile = z.infer<typeof OperatingProfileSchema>;

export const RightsRequirementSchema = z.strictObject({
  requirementId: z.string().min(1),
  description: z.string().min(1),
  scope: z.string().min(1).optional(),
});

export type RightsRequirement = z.infer<typeof RightsRequirementSchema>; // zod-inferred

/**
 * The COMPLETE candidate definition — what REL-022 publication requires
 * (every contract field present and well-formed).
 */
export const CandidateDefinitionSchema = z.strictObject({
  organizationId: z.string().min(1).regex(KEBAB_CASE, "organizationId must be kebab-case"),
  displayName: z.string().min(1),
  domain: DomainCompatibilitySchema,
  capabilities: z.array(CapabilityBindingSchema).min(1),
  profile: OperatingProfileSchema,
});

export type CandidateDefinition = z.infer<typeof CandidateDefinitionSchema>;

/**
 * The DRAFT definition a run may emit (every field optional; present fields
 * must be well-formed). Completeness is the publication gate's job.
 */
export const CandidateDefinitionDraftSchema = z.strictObject({
  organizationId: z.string().min(1).regex(KEBAB_CASE).optional(),
  displayName: z.string().min(1).optional(),
  domain: DomainCompatibilitySchema.partial().optional(),
  capabilities: z.array(CapabilityBindingSchema).optional(),
  profile: OperatingProfileSchema.optional(),
});

export type CandidateDefinitionDraft = z.infer<typeof CandidateDefinitionDraftSchema>;

// ---------------------------------------------------------------------------
// Candidate evidence (registry-shaped summaries the lab runtime measured)
// ---------------------------------------------------------------------------

/**
 * LOCAL SEAM (DEVIATIONS): field-identical mirrors of the registry's
 * BenchmarkEvidence / SecurityPolicyEvidence objects, so a candidate that
 * publishes and exports can be re-assembled into a registry record whose
 * evidence parses under the registry's own schemas.
 */
export const BenchmarkEvidenceSummarySchema = z.strictObject({
  corpusVersion: z.string().min(1),
  evaluatorVersion: z.string().min(1),
  metrics: z
    .array(
      z.strictObject({
        axis: z.string().min(1),
        value: z.number().min(0).max(10),
      }),
    )
    .min(1),
  uncertainty: z
    .array(
      z.strictObject({
        axis: z.string().min(1),
        ciLow: z.number().min(0).max(10),
        ciHigh: z.number().min(0).max(10),
      }),
    )
    .min(1),
  artifactRefs: z.array(z.string().min(1)).min(1),
});

export type BenchmarkEvidenceSummary = z.infer<typeof BenchmarkEvidenceSummarySchema>;

export const SecurityPolicyEvidenceSummarySchema = z.strictObject({
  policyVersion: z.string().min(1),
  checks: z
    .array(
      z.strictObject({
        checkId: z.string().min(1),
        passed: z.boolean(),
      }),
    )
    .min(1),
  artifactRefs: z.array(z.string().min(1)).min(1),
});

export type SecurityPolicyEvidenceSummary = z.infer<typeof SecurityPolicyEvidenceSummarySchema>;

/** Evidence a candidate carries; optional at publication, demanded later. */
export const CandidateEvidenceSchema = z.strictObject({
  benchmark: BenchmarkEvidenceSummarySchema.optional(),
  securityPolicy: SecurityPolicyEvidenceSummarySchema.optional(),
});

export type CandidateEvidence = z.infer<typeof CandidateEvidenceSchema>;

/** The ingest validator for a run's candidate payloads (draft-tolerant). */
export const LabRunCandidatePayloadSchema = z.strictObject({
  definition: CandidateDefinitionDraftSchema,
  evidence: CandidateEvidenceSchema,
  provenance: z.strictObject({
    lineage: z.array(z.string().min(1)),
    rightsRequirements: z.array(RightsRequirementSchema),
  }),
});

// ---------------------------------------------------------------------------
// The lab candidate record (REL-020)
// ---------------------------------------------------------------------------

/**
 * The candidate-store visibility vocabulary has exactly ONE member: the lab
 * candidate store never exposes candidates outside the owning tenant. The
 * only cross-tenant surface is the REL-022 publication snapshot.
 */
export const CANDIDATE_VISIBILITY = ["private"] as const;

export type CandidateVisibility = (typeof CANDIDATE_VISIBILITY)[number];

/** Full provenance lineage of a candidate — required complete at publish. */
export interface CandidateProvenance {
  /** The lab run that produced the candidate (registry `createdFrom`). */
  runId: string;
  /** The rights-verified source-data refs the run consumed. */
  sourceRefs: readonly string[];
  /** The lineage artifact ids (non-empty required at publication). */
  lineage: readonly string[];
  /** Rights/policy dependencies carried into export/import. */
  rightsRequirements: readonly RightsRequirement[];
}

/**
 * A candidate organization produced inside a user lab: PRIVATE by default,
 * versioned (every revision appends an immutable version; the registry's
 * own law), full provenance lineage attached.
 */
export interface LabCandidate {
  candidateId: string;
  labId: string;
  owner: TenantRef;
  /** Monotonic from 1; bumps on every revision. */
  version: number;
  visibility: CandidateVisibility;
  definition: CandidateDefinitionDraft;
  evidence: CandidateEvidence;
  provenance: CandidateProvenance;
  createdAt: string;
  updatedAt: string;
}

/** A candidate revision (any subset; at least one part or the revision is refused). */
export interface CandidateRevision {
  definition?: CandidateDefinitionDraft;
  evidence?: CandidateEvidence;
  lineageAdditions?: string[];
  rightsRequirements?: RightsRequirement[];
}

// ---------------------------------------------------------------------------
// Deep freeze (records are handed out immutable — registry precedent)
// ---------------------------------------------------------------------------

/** Recursively freezes a value; handed-out records are immutable. */
export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}
