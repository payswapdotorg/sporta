/**
 * Organization exchange (REL-023): the governed export format + import with
 * eligibility re-check.
 * - export: versioned, checksummed, deterministic (pure function of
 *   publication + exporter);
 * - import round-trip: deep-equal definition + lineage;
 * - eligibility refusal: unsatisfiable rights/policy dependency, failed or
 *   missing security/policy evidence;
 * - tamper-evidence: mutated bundles refuse on checksum mismatch;
 * - THE DATA-ONLY LAW: no executable binding ever imports — strict schema
 *   refusals + a function-free deep scan of the imported record;
 * - NO registry mutation from this package (a real registry stays empty).
 */
import { describe, expect, test } from "bun:test";
import {
  LabValidationError,
  exportPublication,
  findExecutableValues,
  importOrganization,
  requestPublication,
  verifyExportChecksum,
  withdrawPublication,
} from "../src";
import type { OrganizationExport } from "../src";
import { exportChecksumPreimage } from "../src";
import { sha256Hex, createOrganizationRegistry } from "@sporta/organization-registry";
import {
  createHarness,
  createLabWithCandidate,
  satisfiedScope,
  tenantA,
  tenantB,
  unsatisfiedScope,
} from "./fixtures";

async function publishedBundle(): Promise<{
  bundle: OrganizationExport;
  publicationId: string;
  candidateId: string;
}> {
  const harness = createHarness();
  const { candidateId } = await createLabWithCandidate(harness, tenantA);
  const published = await requestPublication(harness.exchange, harness.labs, tenantA, {
    candidateId,
    disclosure: { policyVersion: 1, text: "published under the user-lab incentive policy" },
  });
  if (published.outcome !== "published") throw new Error("unreachable");
  const exported = await exportPublication(harness.exchange, tenantA, {
    publicationId: published.publication.publicationId,
  });
  if (exported.outcome !== "exported") throw new Error("unreachable");
  return {
    bundle: exported.bundle,
    publicationId: published.publication.publicationId,
    candidateId,
  };
}

/** A mutable deep copy of a bundle (JSON round-trip — bundles are data-only). */
function thaw(bundle: OrganizationExport): OrganizationExport {
  return JSON.parse(JSON.stringify(bundle)) as OrganizationExport;
}

/** Re-checksums a mutated copy so the mutation reaches the LATER gates. */
async function rechecksum(bundle: OrganizationExport): Promise<OrganizationExport> {
  const { checksum, ...preimage } = bundle;
  void checksum;
  return { ...bundle, checksum: await sha256Hex(exportChecksumPreimage(preimage)) };
}

describe("the governed export", () => {
  test("carries the complete definition, lineage, evidence summary and policy dependencies, checksummed", async () => {
    const { bundle } = await publishedBundle();
    expect(bundle.exportFormatVersion).toBe(1);
    expect(bundle.organization.organizationId).toBe("lab-org-alpha");
    expect(bundle.organization.provenance.lineage).toEqual(["lin-run-1", "lin-run-2"]);
    expect(bundle.organization.provenance.sourceRefs).toEqual(["src-licensed-1", "src-licensed-2"]);
    expect(bundle.organization.policyDependencies).toEqual([
      {
        requirementId: "rr-1",
        description: "licensed match footage only",
        scope: "source-media",
      },
    ]);
    expect(bundle.organization.benchmarkEvidence?.corpusVersion).toBe("corpus-v1");
    expect(bundle.organization.securityPolicyEvidence?.checks).toHaveLength(2);
    expect(bundle.exportedBy).toEqual(tenantA);
    expect(bundle.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyExportChecksum(bundle)).toBe(true);
  });

  test("is deterministic: the same publication exported twice yields the same checksum", async () => {
    const harness = createHarness();
    const { candidateId } = await createLabWithCandidate(harness, tenantA);
    const published = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "x" },
    });
    if (published.outcome !== "published") throw new Error("unreachable");
    const first = await exportPublication(harness.exchange, tenantA, {
      publicationId: published.publication.publicationId,
    });
    const second = await exportPublication(harness.exchange, tenantA, {
      publicationId: published.publication.publicationId,
    });
    if (first.outcome !== "exported" || second.outcome !== "exported")
      throw new Error("unreachable");
    expect(second.bundle.checksum).toBe(first.bundle.checksum);
  });

  test("any tenant may export a published organization (the public surface records the exporter)", async () => {
    const harness = createHarness();
    const { candidateId } = await createLabWithCandidate(harness, tenantA);
    const published = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "x" },
    });
    if (published.outcome !== "published") throw new Error("unreachable");
    const byB = await exportPublication(harness.exchange, tenantB, {
      publicationId: published.publication.publicationId,
    });
    expect(byB.outcome).toBe("exported");
    if (byB.outcome !== "exported") throw new Error("unreachable");
    expect(byB.bundle.exportedBy).toEqual(tenantB);
    expect(await verifyExportChecksum(byB.bundle)).toBe(true);
  });

  test("refuses to export a withdrawn publication", async () => {
    const harness = createHarness();
    const { candidateId } = await createLabWithCandidate(harness, tenantA);
    const published = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "x" },
    });
    if (published.outcome !== "published") throw new Error("unreachable");
    await withdrawPublication(harness.exchange, tenantA, published.publication.publicationId);
    const refused = await exportPublication(harness.exchange, tenantA, {
      publicationId: published.publication.publicationId,
    });
    expect(refused.outcome).toBe("refused");
    if (refused.outcome !== "refused") throw new Error("unreachable");
    expect(refused.reason).toBe("publication-withdrawn");
  });
});

describe("import: the round trip", () => {
  test("imports into a satisfied scope, deep-equal on the definition + lineage, registry-compatible", async () => {
    const { bundle } = await publishedBundle();
    const outcome = await importOrganization(satisfiedScope(), bundle);
    expect(outcome.outcome).toBe("imported");
    if (outcome.outcome !== "imported") throw new Error("unreachable");
    const record = outcome.record;
    // Definition: deep-equal round trip.
    expect(record.organizationId).toBe("lab-org-alpha");
    expect(record.displayName).toBe("Lab Org Alpha");
    expect(record.domain).toEqual({
      domains: ["football"],
      eventTypes: ["match", "clip"],
      modes: ["live", "batch"],
      renderers: ["tactical", "anime"],
    });
    expect(record.capabilities).toEqual([
      { capabilityId: "perception.fusion", capabilityVersion: "1.0.0" },
      {
        capabilityId: "render.anime",
        capabilityVersion: "2.1.0",
        modelRuntime: { modelId: "npr-anime-v3", runtimeId: "onnx" },
      },
    ]);
    expect(record.profile).toEqual({
      latency: { p50Ms: 900, p95Ms: 1600, p99Ms: 2300 },
      cost: { perRunUsd: 1.4 },
    });
    // Lineage: deep-equal round trip.
    expect(record.provenance.lineage).toEqual(["lin-run-1", "lin-run-2"]);
    expect(record.provenance.createdFrom).toEqual({ labRunId: "run-1" });
    expect(record.provenance.rightsRequirements).toEqual(bundle.organization.policyDependencies);
    // Evidence carried through, registry-schema-valid.
    expect(record.evidence?.benchmark?.metrics).toHaveLength(2);
    expect(record.evidence?.securityPolicy?.checks).toHaveLength(2);
    expect(outcome.exportChecksum).toBe(bundle.checksum);
    expect(outcome.importedBy).toEqual(tenantB);
  });

  test("imported records are accepted by a REAL organization registry untouched by this package", async () => {
    const { bundle } = await publishedBundle();
    const outcome = await importOrganization(satisfiedScope(), bundle);
    if (outcome.outcome !== "imported") throw new Error("unreachable");
    // The product's next step: the registry's own pipeline registers the record.
    const registry = createOrganizationRegistry();
    const registered = await registry.register(outcome.record, {
      actorType: "system",
      actorId: "exchange-import-test",
    });
    expect(registered.status).toBe("draft");
    expect(registered.organizationId).toBe("lab-org-alpha");
    expect(registered.provenance.createdFrom).toEqual({ labRunId: "run-1" });
  });

  test("import alone mutates NO registry (the exchange imports data, it never registers)", async () => {
    const { bundle } = await publishedBundle();
    const registry = createOrganizationRegistry();
    await importOrganization(satisfiedScope(), bundle);
    expect(await registry.list()).toEqual([]);
    await expect(registry.get("lab-org-alpha")).rejects.toBeInstanceOf(Error);
  });
});

describe("import: eligibility re-check at import time", () => {
  test("refuses an unsatisfiable rights/policy dependency, naming it", async () => {
    const { bundle } = await publishedBundle();
    const outcome = await importOrganization(unsatisfiedScope(), bundle);
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("unsatisfiable-dependency");
    expect(outcome.missing).toEqual(["rr-1"]);
    expect(outcome.message).toContain("rr-1");
    expect(outcome.message).toContain("licensed match footage only");
  });

  test("refuses when the security/policy evidence has a failing check", async () => {
    const { bundle } = await publishedBundle();
    const mutated = thaw(bundle);
    mutated.organization.securityPolicyEvidence!.checks[0]!.passed = false;
    const recheck = await rechecksum(mutated);
    const outcome = await importOrganization(satisfiedScope(), recheck);
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("security-policy-failed");
    expect(outcome.message).toContain("content-policy");
  });

  test("refuses when the export carries NO security/policy evidence (absence is not a pass)", async () => {
    const { bundle } = await publishedBundle();
    const mutated = thaw(bundle);
    mutated.organization.securityPolicyEvidence = null;
    const recheck = await rechecksum(mutated);
    const outcome = await importOrganization(satisfiedScope(), recheck);
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("security-policy-failed");
    expect(outcome.message).toContain("no security/policy evidence");
  });
});

describe("import: tamper-evidence", () => {
  test("refuses a bundle mutated after export (checksum mismatch)", async () => {
    const { bundle } = await publishedBundle();
    const mutated = thaw(bundle);
    mutated.organization.displayName = "Tampered Org";
    expect(await verifyExportChecksum(mutated)).toBe(false);
    const outcome = await importOrganization(satisfiedScope(), mutated);
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("checksum-mismatch");
  });

  test("refuses a lineage mutated after export (checksum mismatch)", async () => {
    const { bundle } = await publishedBundle();
    const mutated = thaw(bundle);
    mutated.organization.provenance.lineage = ["lin-forged"];
    expect(await verifyExportChecksum(mutated)).toBe(false);
    const outcome = await importOrganization(satisfiedScope(), mutated);
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("checksum-mismatch");
    expect(outcome.message).toContain("mutated after export");
  });
});

describe("THE DATA-ONLY LAW: import never injects executable organization code", () => {
  test("an executable-binding stowaway field is REFUSED (strict schema, not stripped)", async () => {
    const { bundle } = await publishedBundle();
    const poisoned = thaw(bundle) as Record<string, unknown>;
    const organization = poisoned.organization as Record<string, unknown>;
    organization.executableBinding = () => "boom";
    const outcome = await importOrganization(satisfiedScope(), poisoned);
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("invalid-bundle");
    expect(outcome.message).toContain("data-only");
  });

  test("a function-valued known field is REFUSED", async () => {
    const { bundle } = await publishedBundle();
    const poisoned = thaw(bundle);
    (poisoned.organization as unknown as Record<string, unknown>).displayName = () => "boom";
    const outcome = await importOrganization(satisfiedScope(), poisoned);
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("invalid-bundle");
  });

  test("the imported record itself is function-free (deep scan)", async () => {
    const { bundle } = await publishedBundle();
    const outcome = await importOrganization(satisfiedScope(), bundle);
    if (outcome.outcome !== "imported") throw new Error("unreachable");
    expect(findExecutableValues(outcome.record)).toEqual([]);
    expect(findExecutableValues(bundle)).toEqual([]);
  });

  test("findExecutableValues finds what it is built to find (the checker works)", () => {
    const poisoned = {
      name: "x",
      nested: { fn: () => 1, deep: [{ boom: () => 2 }] },
    };
    expect(findExecutableValues(poisoned)).toEqual(["$.nested.fn", "$.nested.deep[0].boom"]);
    const cyclic: Record<string, unknown> = { name: "c" };
    cyclic.self = cyclic;
    cyclic.fn = () => 3;
    expect(findExecutableValues(cyclic)).toEqual(["$.fn"]);
  });
});

describe("import boundary", () => {
  test("a malformed scope throws the typed validation error at the boundary", async () => {
    const { bundle } = await publishedBundle();
    await expect(
      importOrganization({ tenant: { tenantId: "" }, satisfiedRightsRequirements: [] }, bundle),
    ).rejects.toBeInstanceOf(LabValidationError);
  });

  test("outright garbage bundles refuse with the typed invalid-bundle record", async () => {
    expect((await importOrganization(satisfiedScope(), null)).outcome).toBe("refused");
    expect((await importOrganization(satisfiedScope(), {})).outcome).toBe("refused");
    expect((await importOrganization(satisfiedScope(), "not-a-bundle")).outcome).toBe("refused");
  });
});
