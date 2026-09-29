/**
 * The organization-registry domain model (REL-017, ADR-013).
 *
 * Source of truth:
 * - docs/contracts/organization-registry-and-promotion.md (FROZEN)
 * - docs/contracts/agent-body-and-organization.md §Organization status
 *   (FROZEN): `draft -> benchmarked -> validated -> canary -> production ->
 *   retired`; "Only validated/canary/production organizations may be selected
 *   for customer production work."
 * - docs/architecture/reality-engineering-lab.md §10 Lab-to-production
 *   boundary: "A Lab Run may produce a Strategy Candidate, Agent Organization
 *   Candidate or Capability Candidate. It cannot directly become production
 *   state. Promotion must create a versioned Organization record and pass
 *   production eligibility gates."
 *
 * Everything here is DATA, not policy: the record carries what was measured
 * and declared; the gates (src/gates.ts) and the versioned promotion policy
 * (src/promotion.ts) decide what those numbers mean. The zod schemas are
 * SHAPE validation only — semantic thresholds live in the policy so the bars
 * are versioned and auditable, never hard-coded per call site.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Lifecycle status (the frozen vocabulary)
// ---------------------------------------------------------------------------

/**
 * The organization lifecycle (agent-body contract §Organization status).
 * `retired` is TERMINAL — retirement preserves lineage, it never resurrects.
 */
export const ORGANIZATION_STATUSES = [
  "draft",
  "benchmarked",
  "validated",
  "canary",
  "production",
  "retired",
] as const;

export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/** Zod schema for {@link OrganizationStatus}. */
export const OrganizationStatusSchema = z.enum(ORGANIZATION_STATUSES);

/**
 * The statuses selectable for customer production work (the agent-body
 * contract's own sentence). `draft`/`benchmarked` carry unproven evidence;
 * `retired` is dead by definition.
 */
export const SELECTABLE_STATUSES: readonly OrganizationStatus[] = [
  "validated",
  "canary",
  "production",
];

/** Type guard: is this status selectable for production work? */
export function isSelectableStatus(status: OrganizationStatus): boolean {
  return SELECTABLE_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Rollback triggers (REL-018: "a recorded rollback trigger";
// REL-A4: "Rollback must be automatic for configured hard SLO/policy
// failures")
// ---------------------------------------------------------------------------

/**
 * The closed rollback-trigger vocabulary — the recorded reason an automatic
 * rollback fired. A trigger outside this vocabulary is a caller error and
 * refuses with a typed refusal, never an improvised retirement.
 */
export const ROLLBACK_TRIGGERS = [
  "hard-slo-failure",
  "policy-violation",
  "rights-failure",
  "cost-blowout",
] as const;

export type RollbackTrigger = (typeof ROLLBACK_TRIGGERS)[number];

/** Type guard: is this value a rollback trigger? */
export function isRollbackTrigger(value: unknown): value is RollbackTrigger {
  return typeof value === "string" && (ROLLBACK_TRIGGERS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The actor (every transition is auditable: actor OR system)
// ---------------------------------------------------------------------------

/** Who performed an operation: a user/account or an automated system. */
export const ActorRefSchema = z.object({
  actorType: z.enum(["system", "user"]),
  actorId: z.string().min(1),
});

export type ActorRef = z.infer<typeof ActorRefSchema>; // zod-inferred: actorType + actorId

/** Convenience: the automated promotion engine's actor identity. */
export function systemActor(policyId: string, policyVersion: number): ActorRef {
  return { actorType: "system", actorId: `promotion-policy:${policyId}:v${policyVersion}` };
}

// ---------------------------------------------------------------------------
// Domain compatibility (REL-017: "domain compatibility")
// ---------------------------------------------------------------------------

/** Which domains / event types / modes / renderers this org version serves. */
export const DomainCompatibilitySchema = z.object({
  /** Domain pack ids (e.g. "football" — ADR-013: football is the first pack). */
  domains: z.array(z.string().min(1)).min(1),
  /** Event types within the domain (e.g. "match", "clip", "highlight"). */
  eventTypes: z.array(z.string().min(1)).min(1),
  /** Live and/or batch support (the registry contract's "live/batch"). */
  modes: z.array(z.enum(["live", "batch"])).min(1),
  /** Renderer ids this organization can drive (the renderer contract seam). */
  renderers: z.array(z.string().min(1)).min(1),
});

export type DomainCompatibility = z.infer<typeof DomainCompatibilitySchema>; // zod-inferred

// ---------------------------------------------------------------------------
// Capability bindings (REL-017: "capability bindings";
// registry contract: "required capabilities/models")
// ---------------------------------------------------------------------------

/** A capability the organization binds, optionally behind a model runtime. */
export const CapabilityBindingSchema = z.object({
  capabilityId: z.string().min(1),
  capabilityVersion: z.string().min(1),
  /** The provider-neutral model/runtime inhabiting the body, when bound. */
  modelRuntime: z
    .object({
      modelId: z.string().min(1),
      runtimeId: z.string().min(1),
    })
    .optional(),
});

export type CapabilityBinding = z.infer<typeof CapabilityBindingSchema>; // zod-inferred

// ---------------------------------------------------------------------------
// Latency + cost profile (REL-017: "latency and cost profile";
// registry contract: "latency distribution", "compute/cost envelope")
// ---------------------------------------------------------------------------

/** Measured latency distribution (ms). */
export const LatencyDistributionSchema = z
  .object({
    p50Ms: z.number().nonnegative(),
    p95Ms: z.number().nonnegative(),
    p99Ms: z.number().nonnegative(),
  })
  .refine((v) => v.p50Ms <= v.p95Ms && v.p95Ms <= v.p99Ms, {
    message: "latency percentiles must be ordered p50 <= p95 <= p99",
  });

export type LatencyDistribution = z.infer<typeof LatencyDistributionSchema>; // zod-inferred

/** The compute/cost envelope. */
export const CostEnvelopeSchema = z.object({
  perRunUsd: z.number().nonnegative(),
});

export type CostEnvelope = z.infer<typeof CostEnvelopeSchema>; // zod-inferred

/** The declared operating profile — the read-model the choice UI consumes. */
export const OperatingProfileSchema = z.object({
  latency: LatencyDistributionSchema,
  cost: CostEnvelopeSchema,
});

export type OperatingProfile = z.infer<typeof OperatingProfileSchema>; // zod-inferred

// ---------------------------------------------------------------------------
// Evidence (REL-017: "evidence references" — every gate evidence carries the
// immutable lab-artifact references backing it; §11 lab outputs)
// ---------------------------------------------------------------------------

/**
 * Reproducibility evidence (gate 1 of the frozen promotion pipeline):
 * the lab run reproduced deterministically from seed + configuration.
 */
export const ReproducibilityEvidenceSchema = z.object({
  /** The lab run the record was created from (must match createdFrom). */
  labRunId: z.string().min(1),
  configurationVersion: z.string().min(1),
  seed: z.string().min(1),
  /** Number of independent reproduction attempts. */
  reproductionRuns: z.number().int().positive(),
  /** How many of those runs reproduced identical trajectories. */
  identicalRuns: z.number().int().nonnegative(),
  artifactRefs: z.array(z.string().min(1)).min(1),
});

export type ReproducibilityEvidence = z.infer<typeof ReproducibilityEvidenceSchema>;

/**
 * Benchmark evidence (gate 2): the registry contract's "benchmark corpus
 * versions", "evaluator versions", "expected quality metrics" and
 * "uncertainty" — measured on the frozen benchmark corpus, NOT in the
 * simulator. This is one of the three inputs THE HARD RULE makes mandatory
 * and independent.
 */
export const BenchmarkEvidenceSchema = z.object({
  corpusVersion: z.string().min(1),
  evaluatorVersion: z.string().min(1),
  /** Expected quality metrics per axis (value in [0, 10]). */
  metrics: z
    .array(
      z.object({
        axis: z.string().min(1),
        value: z.number().min(0).max(10),
      }),
    )
    .min(1),
  /** Uncertainty per axis: the confidence interval containing the value. */
  uncertainty: z
    .array(
      z.object({
        axis: z.string().min(1),
        ciLow: z.number().min(0).max(10),
        ciHigh: z.number().min(0).max(10),
      }),
    )
    .min(1),
  artifactRefs: z.array(z.string().min(1)).min(1),
});

export type BenchmarkEvidence = z.infer<typeof BenchmarkEvidenceSchema>; // zod-inferred

/**
 * Robustness evidence (gate 3): the lab architecture §9 record — seed
 * robustness, simulator-model agreement, out-of-distribution score, known
 * failure envelope, benchmark corpus coverage. Mandatory independent input
 * under THE HARD RULE.
 */
export const RobustnessEvidenceSchema = z.object({
  seedsTested: z.number().int().positive(),
  seedsPassed: z.number().int().nonnegative(),
  /** Out-of-distribution score in [0, 10]. */
  outOfDistributionScore: z.number().min(0).max(10),
  /** Simulator-model agreement in [0, 1]. */
  simulatorModelAgreement: z.number().min(0).max(1),
  /** The documented known failure envelope (the honest "known limitations"). */
  knownFailureEnvelope: z.array(z.string().min(1)).min(1),
  /** Benchmark corpus coverage in [0, 1]. */
  benchmarkCorpusCoverage: z.number().min(0).max(1),
  artifactRefs: z.array(z.string().min(1)).min(1),
});

export type RobustnessEvidence = z.infer<typeof RobustnessEvidenceSchema>; // zod-inferred

/**
 * Rights / provenance evidence (gate 4): ADR-013 #7 — "A public URL alone
 * never proves transformation rights." The declared basis must be a licensed
 * / uploaded / authorized-feed basis; "unverified" fails the gate.
 */
export const RightsProvenanceEvidenceSchema = z.object({
  basisType: z.enum(["licensed", "user-upload", "authorized-feed", "unverified"]),
  /** The declared rights basis record id. */
  rightsBasisId: z.string().min(1),
  licenses: z
    .array(
      z.object({
        licenseId: z.string().min(1),
        scope: z.string().min(1),
      }),
    )
    .min(1),
  /** The provenance lineage (artifact ids) — non-empty under this gate. */
  provenanceLineage: z.array(z.string().min(1)).min(1),
  artifactRefs: z.array(z.string().min(1)).min(1),
});

export type RightsProvenanceEvidence = z.infer<typeof RightsProvenanceEvidenceSchema>;

/** Security / policy evidence (gate 5): the policy checks that ran. */
export const SecurityPolicyEvidenceSchema = z.object({
  policyVersion: z.string().min(1),
  checks: z
    .array(
      z.object({
        checkId: z.string().min(1),
        passed: z.boolean(),
      }),
    )
    .min(1),
  artifactRefs: z.array(z.string().min(1)).min(1),
});

export type SecurityPolicyEvidence = z.infer<typeof SecurityPolicyEvidenceSchema>; // zod-inferred

/**
 * Cost/latency measurement provenance (gate 6): how the record's declared
 * operating profile was measured. The gate evaluates the record profile
 * against the policy envelope and requires this evidence for the sample
 * count — the numbers themselves live on the record (single source, no
 * duplicated truth).
 */
export const CostLatencyEvidenceSchema = z.object({
  sampleCount: z.number().int().positive(),
  artifactRefs: z.array(z.string().min(1)).min(1),
});

export type CostLatencyEvidence = z.infer<typeof CostLatencyEvidenceSchema>; // zod-inferred

/**
 * Canary evidence (the canary→production step, REL-A4 "canary pass"):
 * isolated, observable canary traffic with its SLO verdicts.
 */
export const CanaryEvidenceSchema = z.object({
  canaryWindowMs: z.number().int().positive(),
  observations: z.number().int().nonnegative(),
  sloChecks: z
    .array(
      z.object({
        checkId: z.string().min(1),
        passed: z.boolean(),
      }),
    )
    .min(1),
  /** Rollback triggers observed during the canary window (must be zero). */
  rollbackTriggersObserved: z.number().int().nonnegative(),
  artifactRefs: z.array(z.string().min(1)).min(1),
});

export type CanaryEvidence = z.infer<typeof CanaryEvidenceSchema>; // zod-inferred

/**
 * Simulator reward — explicitly NOT gate evidence (THE HARD RULE):
 * "no organization may ship based solely on simulator reward — benchmark +
 * robustness + rights gates are mandatory INDEPENDENT inputs." It is carried
 * for the audit record (what the lab search measured) and can never satisfy
 * any gate: the gates read only the six evidence objects above.
 */
export const SimulatorRewardSchema = z.object({
  /** The reward score the lab search measured (any scale — never a gate). */
  score: z.number(),
  rewardVersion: z.string().min(1),
  labRunId: z.string().min(1),
  artifactRefs: z.array(z.string().min(1)).min(1),
});

export type SimulatorReward = z.infer<typeof SimulatorRewardSchema>; // zod-inferred

/**
 * The evidence bundle a record version carries. Every field is optional at
 * the DATA level — missing evidence is exactly what the gates refuse on
 * (typed `missing-evidence` refusal), never silently waved through.
 */
export const EvidenceBundleSchema = z.object({
  reproducibility: ReproducibilityEvidenceSchema.optional(),
  benchmark: BenchmarkEvidenceSchema.optional(),
  robustness: RobustnessEvidenceSchema.optional(),
  rightsProvenance: RightsProvenanceEvidenceSchema.optional(),
  securityPolicy: SecurityPolicyEvidenceSchema.optional(),
  costLatency: CostLatencyEvidenceSchema.optional(),
  canary: CanaryEvidenceSchema.optional(),
  simulatorReward: SimulatorRewardSchema.optional(),
});

export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>; // zod-inferred

/** The partial bundle a promotion request may add on top of the record. */
export const AdditionalEvidenceSchema = EvidenceBundleSchema.partial();
export type AdditionalEvidence = z.infer<typeof AdditionalEvidenceSchema>;

// ---------------------------------------------------------------------------
// Provenance / rights requirements / created-from (REL-017)
// ---------------------------------------------------------------------------

/** A rights/policy dependency the org requires (surfaced in user choice). */
export const RightsRequirementSchema = z.object({
  requirementId: z.string().min(1),
  description: z.string().min(1),
  scope: z.string().min(1).optional(),
});

export type RightsRequirement = z.infer<typeof RightsRequirementSchema>; // zod-inferred

/**
 * The lab run a candidate came from. NULL for a hand-engineered organization
 * registered directly — and that is the point of the promotion invariant:
 * both kinds pass the SAME gates ("a lab breakthrough is not a product
 * feature until it passes the same promotion/evidence gates as a
 * hand-engineered organization").
 */
export const LabRunRefSchema = z.object({
  labRunId: z.string().min(1),
});

export type LabRunRef = z.infer<typeof LabRunRefSchema>; // zod-inferred

/** Provenance: owner/publisher, lineage, rights requirements, created-from. */
export const OrganizationProvenanceSchema = z.object({
  owner: z.string().min(1),
  /** Provenance lineage artifact ids (may be empty pre-validation). */
  lineage: z.array(z.string().min(1)),
  rightsRequirements: z.array(RightsRequirementSchema),
  createdFrom: LabRunRefSchema.nullable(),
});

export type OrganizationProvenance = z.infer<typeof OrganizationProvenanceSchema>; // zod-inferred

// ---------------------------------------------------------------------------
// The organization record (versioned; every mutation = a new version)
// ---------------------------------------------------------------------------

/**
 * A single immutable version of an organization record (REL-017). The
 * registry keeps ALL versions; `get` returns the latest. Status/lifecycle
 * changes only through audited transitions.
 */
export interface OrganizationRecord {
  organizationId: string;
  /** Monotonic from 1; bumps on every registry mutation (transition/evidence). */
  version: number;
  displayName: string;
  status: OrganizationStatus;
  domain: DomainCompatibility;
  capabilities: CapabilityBinding[];
  /** Declared operating profile — read by the cost/latency gate and choice. */
  profile: OperatingProfile;
  evidence: EvidenceBundle;
  provenance: OrganizationProvenance;
  createdAt: string;
  updatedAt: string;
}

/** Registration input (zod-validated at the registry boundary). */
export const NewOrganizationInputSchema = z.object({
  organizationId: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "organizationId must be kebab-case"),
  displayName: z.string().min(1),
  domain: DomainCompatibilitySchema,
  capabilities: z.array(CapabilityBindingSchema).min(1),
  profile: OperatingProfileSchema,
  provenance: OrganizationProvenanceSchema,
  evidence: EvidenceBundleSchema.optional(),
});

export type NewOrganizationInput = z.infer<typeof NewOrganizationInputSchema>;

// ---------------------------------------------------------------------------
// The eligibility query (REL-017: "by domain / task / latency / budget")
// ---------------------------------------------------------------------------

/** Query for production-eligible organizations. */
export const EligibilityQuerySchema = z.object({
  /** Domain pack id (e.g. "football"). */
  domain: z.string().min(1).optional(),
  /** Task / event type (e.g. "match", "clip"). */
  task: z.string().min(1).optional(),
  /** Mode support requirement. */
  mode: z.enum(["live", "batch"]).optional(),
  /** Renderer support requirement. */
  renderer: z.string().min(1).optional(),
  /** Latency ceiling: the record's p95 must not exceed this. */
  maxP95LatencyMs: z.number().positive().optional(),
  /** Budget ceiling: the record's per-run cost must not exceed this. */
  maxBudgetPerRunUsd: z.number().positive().optional(),
  /** Capability ids the organization must bind. */
  requiredCapabilities: z.array(z.string().min(1)).optional(),
});

export type EligibilityQuery = z.infer<typeof EligibilityQuerySchema>;

/**
 * Does a record satisfy an {@link EligibilityQuery}? Status selectability is
 * checked by the caller (the registry query) — this predicate is purely the
 * domain/task/latency/budget/capability match, exported so the choice layer
 * can reuse the exact same matching rule (one truth, two read models).
 */
export function matchesQuery(record: OrganizationRecord, query: EligibilityQuery): boolean {
  if (query.domain !== undefined && !record.domain.domains.includes(query.domain)) {
    return false;
  }
  if (query.task !== undefined && !record.domain.eventTypes.includes(query.task)) {
    return false;
  }
  if (query.mode !== undefined && !record.domain.modes.includes(query.mode)) {
    return false;
  }
  if (query.renderer !== undefined && !record.domain.renderers.includes(query.renderer)) {
    return false;
  }
  if (query.maxP95LatencyMs !== undefined && record.profile.latency.p95Ms > query.maxP95LatencyMs) {
    return false;
  }
  if (
    query.maxBudgetPerRunUsd !== undefined &&
    record.profile.cost.perRunUsd > query.maxBudgetPerRunUsd
  ) {
    return false;
  }
  if (query.requiredCapabilities !== undefined) {
    const bound = new Set(record.capabilities.map((c) => c.capabilityId));
    for (const required of query.requiredCapabilities) {
      if (!bound.has(required)) return false;
    }
  }
  return true;
}
