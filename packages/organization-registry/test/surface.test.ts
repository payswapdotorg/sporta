/**
 * The public-surface tests: every runtime export the behavior tests reach
 * only indirectly — the zod schemas (the registry boundary's validators),
 * the rollback-trigger vocabulary + guard, and the typed error family
 * constructors — pinned here so nothing ships untested.
 */
import { describe, expect, test } from "bun:test";
import {
  AdditionalEvidenceSchema,
  DomainCompatibilitySchema,
  EligibilityQuerySchema,
  NewOrganizationInputSchema,
  OrganizationStatusSchema,
  ROLLBACK_TRIGGERS,
  RegistryApiError,
  RegistryInternalError,
  isRollbackTrigger,
  isRegistryError,
} from "../src";
import { fullEvidence, newOrgInput, simulatorRewardOnly } from "./fixtures";

describe("the zod schemas (the registry boundary's validators)", () => {
  test("OrganizationStatusSchema accepts the six statuses and rejects typos", () => {
    for (const status of ["draft", "benchmarked", "validated", "canary", "production", "retired"]) {
      expect(OrganizationStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(OrganizationStatusSchema.safeParse("Draft").success).toBe(false);
    expect(OrganizationStatusSchema.safeParse("shipped").success).toBe(false);
    expect(OrganizationStatusSchema.safeParse(1).success).toBe(false);
  });

  test("DomainCompatibilitySchema requires every axis (domains/events/modes/renderers)", () => {
    expect(DomainCompatibilitySchema.safeParse(newOrgInput().domain).success).toBe(true);
    expect(
      DomainCompatibilitySchema.safeParse({ ...newOrgInput().domain, domains: [] }).success,
    ).toBe(false);
    expect(
      DomainCompatibilitySchema.safeParse({
        ...newOrgInput().domain,
        modes: ["batch", "live", "rt"],
      }).success,
    ).toBe(false);
  });

  test("NewOrganizationInputSchema validates the full input and rejects bad ids", () => {
    expect(NewOrganizationInputSchema.safeParse(newOrgInput()).success).toBe(true);
    expect(
      NewOrganizationInputSchema.safeParse({ ...newOrgInput(), organizationId: "Bad_ID" }).success,
    ).toBe(false);
    expect(
      NewOrganizationInputSchema.safeParse({ ...newOrgInput(), capabilities: [] }).success,
    ).toBe(false);
    // Out-of-order latency percentiles are rejected at the shape level too.
    expect(
      NewOrganizationInputSchema.safeParse({
        ...newOrgInput(),
        profile: { ...newOrgInput().profile, latency: { p50Ms: 5, p95Ms: 4, p99Ms: 6 } },
      }).success,
    ).toBe(false);
  });

  test("EligibilityQuerySchema accepts each constraint and rejects nonsense", () => {
    expect(EligibilityQuerySchema.safeParse({}).success).toBe(true);
    expect(EligibilityQuerySchema.safeParse({ domain: "football", task: "match" }).success).toBe(
      true,
    );
    expect(
      EligibilityQuerySchema.safeParse({
        mode: "live",
        maxP95LatencyMs: 100,
        maxBudgetPerRunUsd: 2,
      }).success,
    ).toBe(true);
    expect(EligibilityQuerySchema.safeParse({ mode: "whenever" }).success).toBe(false);
    expect(EligibilityQuerySchema.safeParse({ maxP95LatencyMs: -1 }).success).toBe(false);
    expect(EligibilityQuerySchema.safeParse({ task: "" }).success).toBe(false);
  });

  test("AdditionalEvidenceSchema accepts full and partial bundles, rejects bad evidence", () => {
    expect(AdditionalEvidenceSchema.safeParse(fullEvidence(true, true)).success).toBe(true);
    expect(AdditionalEvidenceSchema.safeParse(simulatorRewardOnly()).success).toBe(true);
    expect(AdditionalEvidenceSchema.safeParse({}).success).toBe(true);
    // An unverified rights basis is VALID SHAPE (the GATE refuses it, not the schema).
    const withUnverified = {
      ...fullEvidence(false, false),
      rightsProvenance: {
        ...fullEvidence(false, false).rightsProvenance!,
        basisType: "unverified",
      },
    };
    expect(AdditionalEvidenceSchema.safeParse(withUnverified).success).toBe(true);
    // But a malformed one (empty artifact refs) is invalid shape.
    expect(AdditionalEvidenceSchema.safeParse({ robustness: { seedsTested: 1 } }).success).toBe(
      false,
    );
  });
});

describe("the rollback-trigger vocabulary", () => {
  test("is the closed four-trigger list", () => {
    expect(ROLLBACK_TRIGGERS).toEqual([
      "hard-slo-failure",
      "policy-violation",
      "rights-failure",
      "cost-blowout",
    ]);
  });

  test("isRollbackTrigger accepts members and rejects everything else", () => {
    for (const trigger of ROLLBACK_TRIGGERS) {
      expect(isRollbackTrigger(trigger)).toBe(true);
    }
    expect(isRollbackTrigger("vibes")).toBe(false);
    expect(isRollbackTrigger("")).toBe(false);
    expect(isRollbackTrigger(42)).toBe(false);
    expect(isRollbackTrigger(null)).toBe(false);
  });
});

describe("the typed error family", () => {
  test("RegistryApiError carries class + details", () => {
    const error = new RegistryApiError("conflict", "boom", { organizationId: "x" });
    expect(error.failureClass).toBe("conflict");
    expect(error.details).toEqual({ organizationId: "x" });
    expect(error.message).toBe("boom");
    expect(isRegistryError(error)).toBe(true);
  });

  test("RegistryInternalError defaults to empty details", () => {
    const error = new RegistryInternalError("invariant blew up");
    expect(error.failureClass).toBe("internal");
    expect(error.details).toEqual({});
    expect(isRegistryError(error)).toBe(true);
  });

  test("plain errors are not registry errors", () => {
    expect(isRegistryError(new Error("plain"))).toBe(false);
    expect(isRegistryError(undefined)).toBe(false);
  });
});
