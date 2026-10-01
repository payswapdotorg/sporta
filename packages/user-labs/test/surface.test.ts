/**
 * The public-surface tests: every runtime export the behavior tests reach
 * only indirectly — the zod schemas (the package's boundary validators),
 * the closed vocabularies, the typed error family, the clock/id helpers and
 * the data-only checker — pinned here so nothing ships untested.
 */
import { describe, expect, test } from "bun:test";
import {
  CANDIDATE_VISIBILITY,
  EXPORT_FORMAT_VERSION,
  LAB_STATUSES,
  LEDGER_ENTRY_KINDS,
  MAX_PRIVATE_USE_WINDOW_DAYS,
  PROMOTION_REQUEST_STATUSES,
  PUBLICATION_STATUSES,
  RUN_PURPOSES,
  RUN_STATUSES,
  SOURCE_RIGHTS_BASIS_TYPES,
  USER_LABS_DEFAULT_EPOCH_MS,
  LabApiError,
  LabConflictError,
  LabInternalError,
  LabIsolationError,
  LabNotFoundError,
  LabValidationError,
  IncentivePolicySchema,
  ImportScopeSchema,
  OrganizationExportSchema,
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
  checksumOf,
  createSequentialIdSource,
  createUserLabsDefaultClock,
  exportChecksumPreimage,
  findExecutableValues,
  isLabError,
  requireTenantRef,
  toIsoUtc,
} from "../src";
import {
  completeCandidateDefinition,
  completeCandidatePayload,
  fixtureBenchmarkEvidence,
  fixtureSecurityEvidence,
  policyV1,
  policyV2,
} from "./fixtures";

// ---------------------------------------------------------------------------
// The value schemas (valid accepts + invalid rejects, sample per schema)
// ---------------------------------------------------------------------------

describe("the tenant and lab schemas", () => {
  test("TenantRefSchema accepts a tenant id and rejects emptiness", () => {
    expect(TenantRefSchema.safeParse({ tenantId: "tenant-a" }).success).toBe(true);
    expect(TenantRefSchema.safeParse({ tenantId: "" }).success).toBe(false);
    expect(TenantRefSchema.safeParse({ tenantId: "a", extra: 1 }).success).toBe(false);
  });

  test("NewLabInputSchema requires a non-empty name", () => {
    expect(NewLabInputSchema.safeParse({ name: "Lab" }).success).toBe(true);
    expect(NewLabInputSchema.safeParse({ name: "" }).success).toBe(false);
  });

  test("LabBudgetSchema requires a positive finite total", () => {
    expect(LabBudgetSchema.safeParse({ totalUsd: 50 }).success).toBe(true);
    expect(LabBudgetSchema.safeParse({ totalUsd: 0 }).success).toBe(false);
    expect(LabBudgetSchema.safeParse({ totalUsd: -1 }).success).toBe(false);
    expect(LabBudgetSchema.safeParse({ totalUsd: Number.NaN }).success).toBe(false);
  });

  test("LabRunConfigurationSchema requires a seed and positive iterations", () => {
    expect(LabRunConfigurationSchema.safeParse({ seed: "s", iterations: 1 }).success).toBe(true);
    expect(LabRunConfigurationSchema.safeParse({ seed: "", iterations: 1 }).success).toBe(false);
    expect(LabRunConfigurationSchema.safeParse({ seed: "s", iterations: 0 }).success).toBe(false);
  });
});

describe("the candidate schemas (complete + draft)", () => {
  test("CandidateDefinitionSchema accepts the complete definition, rejects gaps and bad ids", () => {
    expect(CandidateDefinitionSchema.safeParse(completeCandidateDefinition()).success).toBe(true);
    expect(
      CandidateDefinitionSchema.safeParse({
        ...completeCandidateDefinition(),
        organizationId: "Bad_ID",
      }).success,
    ).toBe(false);
    expect(
      CandidateDefinitionSchema.safeParse({ ...completeCandidateDefinition(), capabilities: [] })
        .success,
    ).toBe(false);
  });

  test("CandidateDefinitionDraftSchema accepts partial drafts with well-formed present fields", () => {
    expect(CandidateDefinitionDraftSchema.safeParse({ displayName: "X" }).success).toBe(true);
    expect(CandidateDefinitionDraftSchema.safeParse({}).success).toBe(true);
    expect(
      CandidateDefinitionDraftSchema.safeParse({ domain: { modes: ["whenever"] } }).success,
    ).toBe(false);
  });

  test("LabRunCandidatePayloadSchema accepts the complete payload and rejects malformed provenance", () => {
    expect(LabRunCandidatePayloadSchema.safeParse(completeCandidatePayload()).success).toBe(true);
    expect(
      LabRunCandidatePayloadSchema.safeParse({
        definition: {},
        evidence: {},
        provenance: { lineage: [""], rightsRequirements: [] },
      }).success,
    ).toBe(false);
  });

  test("the evidence summary schemas mirror the registry's evidence shapes", () => {
    const benchmark = completeCandidatePayload().evidence.benchmark!;
    const security = completeCandidatePayload().evidence.securityPolicy!;
    expect(BenchmarkEvidenceSummarySchema.safeParse(benchmark).success).toBe(true);
    expect(BenchmarkEvidenceSummarySchema.safeParse({ ...benchmark, metrics: [] }).success).toBe(
      false,
    );
    expect(SecurityPolicyEvidenceSummarySchema.safeParse(security).success).toBe(true);
    expect(
      SecurityPolicyEvidenceSummarySchema.safeParse({ ...security, artifactRefs: [] }).success,
    ).toBe(false);
    expect(CandidateEvidenceSchema.safeParse({}).success).toBe(true);
    expect(CandidateEvidenceSchema.safeParse({ benchmark }).success).toBe(true);
  });
});

describe("the definition sub-schemas", () => {
  test("CapabilityBindingSchema", () => {
    expect(
      CapabilityBindingSchema.safeParse({ capabilityId: "c", capabilityVersion: "1.0.0" }).success,
    ).toBe(true);
    expect(
      CapabilityBindingSchema.safeParse({
        capabilityId: "c",
        capabilityVersion: "1.0.0",
        modelRuntime: { modelId: "m", runtimeId: "r" },
      }).success,
    ).toBe(true);
    expect(CapabilityBindingSchema.safeParse({ capabilityId: "" }).success).toBe(false);
  });

  test("DomainCompatibilitySchema requires every axis non-empty", () => {
    const domain = completeCandidateDefinition().domain;
    expect(DomainCompatibilitySchema.safeParse(domain).success).toBe(true);
    expect(DomainCompatibilitySchema.safeParse({ ...domain, domains: [] }).success).toBe(false);
    expect(DomainCompatibilitySchema.safeParse({ ...domain, modes: ["rt"] }).success).toBe(false);
  });

  test("LatencyDistributionSchema enforces the percentile order", () => {
    expect(LatencyDistributionSchema.safeParse({ p50Ms: 1, p95Ms: 2, p99Ms: 3 }).success).toBe(
      true,
    );
    expect(LatencyDistributionSchema.safeParse({ p50Ms: 2, p95Ms: 1, p99Ms: 3 }).success).toBe(
      false,
    );
    expect(LatencyDistributionSchema.safeParse({ p50Ms: -1, p95Ms: 1, p99Ms: 3 }).success).toBe(
      false,
    );
  });

  test("CostEnvelopeSchema and OperatingProfileSchema", () => {
    expect(CostEnvelopeSchema.safeParse({ perRunUsd: 1.5 }).success).toBe(true);
    expect(CostEnvelopeSchema.safeParse({ perRunUsd: -1 }).success).toBe(false);
    expect(
      OperatingProfileSchema.safeParse({
        latency: { p50Ms: 1, p95Ms: 2, p99Ms: 3 },
        cost: { perRunUsd: 1 },
      }).success,
    ).toBe(true);
  });

  test("RightsRequirementSchema", () => {
    expect(
      RightsRequirementSchema.safeParse({ requirementId: "rr", description: "d" }).success,
    ).toBe(true);
    expect(
      RightsRequirementSchema.safeParse({ requirementId: "rr", description: "" }).success,
    ).toBe(false);
    expect(
      RightsRequirementSchema.safeParse({ requirementId: "rr", description: "d", scope: "s" })
        .success,
    ).toBe(true);
  });
});

describe("the incentive + exchange schemas", () => {
  test("IncentivePolicySchema validates the fixtures and refuses junk", () => {
    expect(IncentivePolicySchema.safeParse(policyV1()).success).toBe(true);
    expect(IncentivePolicySchema.safeParse(policyV2()).success).toBe(true);
    expect(IncentivePolicySchema.safeParse({ ...policyV1(), version: 0 }).success).toBe(false);
    expect(
      IncentivePolicySchema.safeParse({ ...policyV1(), effectiveFrom: "not-a-date" }).success,
    ).toBe(false);
    expect(IncentivePolicySchema.safeParse({ ...policyV1(), disclosureText: "" }).success).toBe(
      false,
    );
  });

  test("ImportScopeSchema", () => {
    expect(
      ImportScopeSchema.safeParse({
        tenant: { tenantId: "t" },
        satisfiedRightsRequirements: ["rr"],
      }).success,
    ).toBe(true);
    expect(
      ImportScopeSchema.safeParse({ tenant: { tenantId: "t" }, satisfiedRightsRequirements: [""] })
        .success,
    ).toBe(false);
  });

  test("OrganizationExportSchema rejects non-hex checksums and wrong format versions", () => {
    const base = {
      exportFormatVersion: 1,
      organization: {
        organizationId: "org",
        displayName: "Org",
        domain: completeCandidateDefinition().domain,
        capabilities: completeCandidateDefinition().capabilities,
        profile: completeCandidateDefinition().profile,
        provenance: { runId: "run-1", sourceRefs: ["s"], lineage: ["l"] },
        policyDependencies: [],
        benchmarkEvidence: null,
        securityPolicyEvidence: null,
      },
      exportedBy: { tenantId: "t" },
      exportedAt: "2025-01-06T12:00:00.000Z",
      checksum: "0".repeat(64),
    };
    expect(OrganizationExportSchema.safeParse(base).success).toBe(true);
    expect(OrganizationExportSchema.safeParse({ ...base, exportFormatVersion: 2 }).success).toBe(
      false,
    );
    expect(OrganizationExportSchema.safeParse({ ...base, checksum: "nothex" }).success).toBe(false);
    expect(
      OrganizationExportSchema.safeParse({
        ...base,
        organization: { ...base.organization, stowaway: 1 },
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The closed vocabularies
// ---------------------------------------------------------------------------

describe("the closed vocabularies", () => {
  test("are the frozen lists the contracts name", () => {
    expect(LAB_STATUSES).toEqual(["active", "archived"]);
    expect(RUN_PURPOSES).toEqual(["simulation", "search"]);
    expect(RUN_STATUSES).toEqual(["completed", "failed"]);
    expect(CANDIDATE_VISIBILITY).toEqual(["private"]); // the one-member law
    expect(SOURCE_RIGHTS_BASIS_TYPES).toEqual([
      "licensed",
      "user-upload",
      "authorized-feed",
      "unverified",
    ]);
    expect(PUBLICATION_STATUSES).toEqual(["published", "withdrawn"]);
    expect(PROMOTION_REQUEST_STATUSES).toEqual(["requested", "withdrawn"]);
    expect(LEDGER_ENTRY_KINDS).toEqual([
      "credits-granted",
      "credits-used",
      "private-window-started",
      "private-window-expired",
      "discovery-boost",
    ]);
    expect(MAX_PRIVATE_USE_WINDOW_DAYS).toBe(180); // six months
    expect(EXPORT_FORMAT_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The typed error family
// ---------------------------------------------------------------------------

describe("the typed error family", () => {
  test("every constructor classifies and carries details", () => {
    const validation = new LabValidationError("bad input", [{ path: "x", message: "nope" }]);
    expect(validation.failureClass).toBe("validation");
    expect(validation.details).toEqual({ issues: [{ path: "x", message: "nope" }] });

    const notFound = new LabNotFoundError("missing", { labId: "lab-1" });
    expect(notFound.failureClass).toBe("not-found");

    const conflict = new LabConflictError("already there", { version: 1 });
    expect(conflict.failureClass).toBe("conflict");

    const isolation = new LabIsolationError("no you don't", {
      attemptingTenantId: "b",
      owningTenantId: "a",
      resourceType: "candidate",
      resourceId: "cand-1",
    });
    expect(isolation.failureClass).toBe("isolation");
    expect(isolation.details).toEqual({
      attemptingTenantId: "b",
      owningTenantId: "a",
      resourceType: "candidate",
      resourceId: "cand-1",
    });

    const internal = new LabInternalError("invariant blew up");
    expect(internal.failureClass).toBe("internal");
    expect(internal.details).toEqual({});

    const base = new LabApiError("validation", "plain", { a: 1 });
    expect(base.failureClass).toBe("validation");
  });

  test("isLabError recognizes the family and rejects outsiders", () => {
    for (const error of [
      new LabApiError("validation", "x"),
      new LabValidationError("x"),
      new LabNotFoundError("x"),
      new LabConflictError("x"),
      new LabIsolationError("x", {
        attemptingTenantId: "a",
        owningTenantId: "b",
        resourceType: "lab",
        resourceId: "lab-1",
      }),
      new LabInternalError("x"),
    ]) {
      expect(isLabError(error)).toBe(true);
    }
    expect(isLabError(new Error("plain"))).toBe(false);
    expect(isLabError(undefined)).toBe(false);
    expect(isLabError("nope")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The clock + id helpers
// ---------------------------------------------------------------------------

describe("the clock + id helpers", () => {
  test("the deterministic default clock ticks from the shared epoch", () => {
    expect(USER_LABS_DEFAULT_EPOCH_MS).toBe(1_736_164_800_000); // 2025-01-06T12:00Z
    const clock = createUserLabsDefaultClock();
    expect(clock()).toBe(USER_LABS_DEFAULT_EPOCH_MS + 1);
    expect(clock()).toBe(USER_LABS_DEFAULT_EPOCH_MS + 2);
  });

  test("createSequentialIdSource prefixes and counts", () => {
    const ids = createSequentialIdSource("thing");
    expect(ids.nextId()).toBe("thing-1");
    expect(ids.nextId()).toBe("thing-2");
  });

  test("toIsoUtc formats the epoch", () => {
    expect(toIsoUtc(USER_LABS_DEFAULT_EPOCH_MS)).toBe("2025-01-06T12:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// The remaining exported helpers
// ---------------------------------------------------------------------------

describe("the exported helpers", () => {
  test("requireTenantRef passes valid tenants and refuses invalid ones", () => {
    expect(() => requireTenantRef({ tenantId: "t" })).not.toThrow();
    expect(() => requireTenantRef({ tenantId: "" })).toThrow(LabValidationError);
  });

  test("exportChecksumPreimage + checksumOf agree with the canonical JSON form", async () => {
    const definition = completeCandidateDefinition();
    const preimage = {
      exportFormatVersion: EXPORT_FORMAT_VERSION,
      organization: {
        organizationId: definition.organizationId,
        displayName: definition.displayName,
        domain: definition.domain,
        capabilities: definition.capabilities,
        profile: definition.profile,
        provenance: { runId: "run-1", sourceRefs: ["s"], lineage: ["l"] },
        policyDependencies: [],
        benchmarkEvidence: fixtureBenchmarkEvidence(),
        securityPolicyEvidence: fixtureSecurityEvidence(),
      },
      exportedBy: { tenantId: "t" },
      exportedAt: "2025-01-06T12:00:00.000Z",
    };
    const text = exportChecksumPreimage(preimage);
    // Key-sorted canonical JSON (the registry's own canonicalize rule).
    expect(text).toContain('"exportedAt":"2025-01-06T12:00:00.000Z"');
    expect(text.indexOf('"exportedAt"')).toBeLessThan(text.indexOf('"exportedBy"'));
    expect(text.indexOf('"exportedBy"')).toBeLessThan(text.indexOf('"organization"'));
    expect(text).toContain('"capabilities":[');
    expect(await checksumOf(text)).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic.
    expect(await checksumOf(text)).toBe(await checksumOf(text));
  });

  test("findExecutableValues is the data-only checker (empty on data, precise on functions)", () => {
    expect(findExecutableValues({ a: 1, b: [{ c: "x" }], d: null })).toEqual([]);
    expect(findExecutableValues(undefined)).toEqual([]);
    expect(findExecutableValues(42)).toEqual([]);
  });
});
