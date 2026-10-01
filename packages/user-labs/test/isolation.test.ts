/**
 * TENANT ISOLATION — the hard boundary (REL-020's own test demand): "tenant
 * A cannot read tenant B's candidates; a read-through of the candidate store
 * by an unauthorized tenant is a typed refusal."
 *
 * Every cross-tenant path in this package must refuse with the typed
 * `LabIsolationError` (details: attempting tenant, owning tenant, resource
 * type + id). The ONLY cross-tenant-readable surface is the REL-022
 * publication snapshot — tested here as the boundary's single sanctioned
 * exception.
 */
import { describe, expect, test } from "bun:test";
import {
  LabIsolationError,
  requestPublication,
  requestPublicationPromotion,
  withdrawPublication,
} from "../src";
import {
  createLabWithCandidate,
  createHarness,
  ledgerForLab,
  policyStoreWithV1,
  tenantA,
  tenantB,
} from "./fixtures";

describe("the candidate store read-through (the typed refusal)", () => {
  test("tenant B cannot read tenant A's candidate — typed isolation refusal", async () => {
    const harness = createHarness();
    const { candidateId } = await createLabWithCandidate(harness, tenantA);
    try {
      await harness.labs.getCandidate(tenantB, candidateId);
      throw new Error("expected a typed isolation refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(LabIsolationError);
      const isolation = error as LabIsolationError;
      expect(isolation.failureClass).toBe("isolation");
      expect(isolation.details).toEqual({
        attemptingTenantId: "tenant-b",
        owningTenantId: "tenant-a",
        resourceType: "candidate",
        resourceId: candidateId,
      });
      expect(isolation.message).toContain("private to their tenant");
      expect(isolation.message).toContain("publish operation (REL-022)");
    }
  });

  test("tenant B cannot list, version-read or revise tenant A's candidates", async () => {
    const harness = createHarness();
    const { labId, candidateId } = await createLabWithCandidate(harness, tenantA);
    await expect(harness.labs.listCandidates(tenantB, labId)).rejects.toBeInstanceOf(
      LabIsolationError,
    );
    await expect(harness.labs.getCandidateVersion(tenantB, candidateId, 1)).rejects.toBeInstanceOf(
      LabIsolationError,
    );
    await expect(
      harness.labs.reviseCandidate(tenantB, candidateId, { lineageAdditions: ["lin-evil"] }),
    ).rejects.toBeInstanceOf(LabIsolationError);
  });
});

describe("labs, runs and configuration are tenant-scoped", () => {
  test("every lab operation refuses a foreign tenant", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    await expect(harness.labs.getLab(tenantB, labId)).rejects.toBeInstanceOf(LabIsolationError);
    await expect(
      harness.labs.chooseDomainAndTask(tenantB, labId, { domainPackId: "football", task: "match" }),
    ).rejects.toBeInstanceOf(LabIsolationError);
    await expect(
      harness.labs.selectSourceData(tenantB, labId, ["src-licensed-1"]),
    ).rejects.toBeInstanceOf(LabIsolationError);
    await expect(harness.labs.setBudget(tenantB, labId, { totalUsd: 1 })).rejects.toBeInstanceOf(
      LabIsolationError,
    );
    await expect(harness.labs.archiveLab(tenantB, labId)).rejects.toBeInstanceOf(LabIsolationError);
    await expect(
      harness.labs.requestRun(tenantB, labId, { purpose: "search", estimatedCostUsd: 1 }),
    ).rejects.toBeInstanceOf(LabIsolationError);
    await expect(harness.labs.listRuns(tenantB, labId)).rejects.toBeInstanceOf(LabIsolationError);
  });

  test("run records refuse foreign tenants too", async () => {
    const harness = createHarness();
    const { runId } = await createLabWithCandidate(harness, tenantA);
    await expect(harness.labs.getRun(tenantB, runId)).rejects.toBeInstanceOf(LabIsolationError);
  });
});

describe("candidates stay private by default — and stay private in the store even after publishing", () => {
  test("visibility is 'private' before and after publication; publication is the ONLY exit", async () => {
    const harness = createHarness();
    const { labId, candidateId } = await createLabWithCandidate(harness, tenantA);
    const before = await harness.labs.getCandidate(tenantA, candidateId);
    expect(before.visibility).toBe("private");

    const published = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "published under the user-lab incentive policy" },
    });
    expect(published.outcome).toBe("published");

    // The candidate STORE still refuses tenant B — publication did not open it.
    await expect(harness.labs.getCandidate(tenantB, candidateId)).rejects.toBeInstanceOf(
      LabIsolationError,
    );
    const after = await harness.labs.getCandidate(tenantA, candidateId);
    expect(after.visibility).toBe("private");
    expect((await harness.labs.listCandidates(tenantA, labId)).length).toBe(1);

    // The PUBLICATION is the cross-tenant surface — tenant B reads THAT.
    const publicationId =
      published.outcome === "published" ? published.publication.publicationId : "";
    const readByB = await harness.exchange.getPublication(publicationId);
    expect(readByB.snapshot.organizationId).toBe("lab-org-alpha");
  });
});

describe("publications are public reads but owner-only mutations", () => {
  test("tenant B reads the publication but cannot withdraw it or request promotion on it", async () => {
    const harness = createHarness();
    const { candidateId } = await createLabWithCandidate(harness, tenantA);
    const published = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "disclosed" },
    });
    if (published.outcome !== "published") throw new Error("unreachable");
    const publicationId = published.publication.publicationId;

    // Public read: fine.
    expect((await harness.exchange.getPublication(publicationId)).publishedBy).toEqual(tenantA);
    // Foreign withdraw: typed isolation refusal.
    await expect(
      withdrawPublication(harness.exchange, tenantB, publicationId),
    ).rejects.toBeInstanceOf(LabIsolationError);
    // Foreign promotion request: typed isolation refusal.
    await expect(
      requestPublicationPromotion(harness.exchange, tenantB, { publicationId }),
    ).rejects.toBeInstanceOf(LabIsolationError);
  });
});

describe("the incentive ledger is tenant-scoped", () => {
  test("tenant B cannot read or write tenant A's ledger", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const ledger = ledgerForLab(harness, labId, policyStoreWithV1());
    await expect(ledger.entries(tenantB)).rejects.toBeInstanceOf(LabIsolationError);
    await expect(ledger.balance(tenantB)).rejects.toBeInstanceOf(LabIsolationError);
    await expect(ledger.grantCredits(tenantB, { amount: 100 })).rejects.toBeInstanceOf(
      LabIsolationError,
    );
    await expect(ledger.startPrivateUseWindow(tenantB)).rejects.toBeInstanceOf(LabIsolationError);
    await expect(
      ledger.recordDiscoveryBoost(tenantB, { publicationId: "pub-1" }),
    ).rejects.toBeInstanceOf(LabIsolationError);
    // And nothing was written.
    expect(await ledger.entries(tenantA)).toEqual([]);
  });
});
