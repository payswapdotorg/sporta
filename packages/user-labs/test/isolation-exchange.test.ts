/**
 * REL-027 — cross-tenant imports/exports at the EXCHANGE boundary, typed:
 *
 * The publication snapshot is the ONE sanctioned cross-tenant surface
 * (REL-022): once tenant A publishes, tenant B may READ the snapshot,
 * export it, and import it into B's own scope. Everything ELSE refuses
 * typed at the boundary:
 *
 * - B cannot PUBLISH tenant A's private candidate (the candidate store's
 *   own isolation door — the publish operation reads through it);
 * - B cannot WITHDRAW A's publication, cannot request promotion of it,
 *   cannot withdraw A's promotion request (publisher-only operations);
 * - B's promotion-request list only ever shows B's own requests;
 * - the exchange path CLOSES typed when A withdraws the publication
 *   (export refuses "publication-withdrawn"; lineage stays readable);
 * - the import boundary refuses typed on every tampered/unsatisfiable
 *   shape (checksum mismatch, unsatisfiable dependency) — and the granted
 *   import is DATA-ONLY (no executable values, nothing from A's private
 *   lab state beyond the published snapshot A itself chose to expose).
 */
import { describe, expect, test } from "bun:test";
import {
  LabIsolationError,
  exportPublication,
  findExecutableValues,
  importOrganization,
  requestPublication,
  requestPublicationPromotion,
  verifyExportChecksum,
  withdrawPublication,
  withdrawPromotionRequest,
} from "../src";
import type { OrganizationExport } from "../src";
import { listPromotionRequests } from "../src";
import { createHarness, createLabWithCandidate, completeCandidatePayload } from "./fixtures";
import { satisfiedScope, tenantA, tenantB } from "./fixtures";

/** Publishes A's complete candidate and returns the harness + publication. */
async function publishedByA() {
  const harness = createHarness();
  const { candidateId } = await createLabWithCandidate(harness, tenantA);
  const outcome = await requestPublication(harness.exchange, harness.labs, tenantA, {
    candidateId,
    disclosure: {
      policyVersion: 1,
      text: "published for the exchange under the v1 incentive policy",
    },
  });
  if (outcome.outcome !== "published") {
    throw new Error("fixture invariant broken: the complete candidate refused publication");
  }
  return { harness, candidateId, publication: outcome.publication };
}

describe("publishing another tenant's private candidate refuses typed", () => {
  test("tenant B cannot publish tenant A's candidate (the store's own door)", async () => {
    const { harness, candidateId } = await publishedByA();
    try {
      await requestPublication(harness.exchange, harness.labs, tenantB, {
        candidateId,
        disclosure: { policyVersion: 1, text: "hostile publish attempt" },
      });
      throw new Error("expected a typed isolation refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(LabIsolationError);
      const isolation = error as LabIsolationError;
      expect(isolation.details).toMatchObject({
        attemptingTenantId: "tenant-b",
        owningTenantId: "tenant-a",
        resourceType: "candidate",
        resourceId: candidateId,
      });
    }
  });

  test("an UNPUBLISHED candidate is invisible to the exchange", async () => {
    // The exchange's only entry to a candidate is a publication id; a
    // private candidate has none. The isolation invariant: B cannot READ
    // the candidate (swept in the battery), so the export surface never
    // sees foreign private data.
    const harness = createHarness();
    await createLabWithCandidate(harness, tenantA);
    const publications = await harness.exchange.listPublications();
    expect(publications).toHaveLength(0);
  });
});

describe("the sanctioned cross-tenant surface (read/export/import) stays open", () => {
  test("tenant B can export A's ACTIVE publication and import it into B's scope, data-only", async () => {
    const { harness } = await publishedByA();
    const publicationId = (await harness.exchange.listActivePublications())[0]!.publicationId;
    const exportOutcome = await exportPublication(harness.exchange, tenantB, { publicationId });
    if (exportOutcome.outcome !== "exported") {
      throw new Error("expected the sanctioned export to be granted");
    }
    const bundle = exportOutcome.bundle;
    // The bundle is checksummed and verifiable; the exporter is recorded.
    expect(await verifyExportChecksum(bundle)).toBe(true);
    expect(bundle.exportedBy.tenantId).toBe("tenant-b");
    // The import into B's scope: granted (B satisfies the dependencies).
    const importOutcome = await importOrganization(satisfiedScope(), bundle);
    if (importOutcome.outcome !== "imported") {
      throw new Error(`expected the sanctioned import to be granted: ${importOutcome.message}`);
    }
    // THE DATA-ONLY LAW: no executable values anywhere in the record.
    expect(findExecutableValues(importOutcome.record)).toEqual([]);
    // The importing tenant owns the record; the lineage rides verbatim.
    expect(importOutcome.importedBy.tenantId).toBe("tenant-b");
    expect(importOutcome.record.provenance.lineage).toEqual(["lin-run-1", "lin-run-2"]);
    // The record never carries A's private lab state — only the snapshot.
    expect(importOutcome.record.organizationId).toBe("lab-org-alpha");
  });
});

describe("publisher-only operations refuse typed for the foreign tenant", () => {
  test("tenant B cannot withdraw A's publication", async () => {
    const { harness } = await publishedByA();
    const publicationId = (await harness.exchange.listActivePublications())[0]!.publicationId;
    try {
      await withdrawPublication(harness.exchange, tenantB, publicationId);
      throw new Error("expected a typed isolation refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(LabIsolationError);
      expect((error as LabIsolationError).details).toMatchObject({
        attemptingTenantId: "tenant-b",
        owningTenantId: "tenant-a",
        resourceType: "publication",
        resourceId: publicationId,
      });
    }
  });

  test("tenant B cannot request promotion of A's publication nor withdraw A's request", async () => {
    const { harness } = await publishedByA();
    const publicationId = (await harness.exchange.listActivePublications())[0]!.publicationId;
    await requestPublicationPromotion(harness.exchange, tenantA, { publicationId });
    const requests = await harness.exchange.promotionRequests();
    expect(requests).toHaveLength(1);
    const requestId = requests[0]!.requestId;
    // B's promotion request on A's publication: typed isolation refusal.
    await expect(
      requestPublicationPromotion(harness.exchange, tenantB, { publicationId }),
    ).rejects.toBeInstanceOf(LabIsolationError);
    // B withdrawing A's promotion request: typed isolation refusal.
    await expect(
      withdrawPromotionRequest(harness.exchange, tenantB, requestId),
    ).rejects.toBeInstanceOf(LabIsolationError);
    // The request list is caller-filtered: B sees none of A's requests.
    const forB = await listPromotionRequests(harness.exchange, tenantB);
    expect(forB).toHaveLength(0);
    const forA = await listPromotionRequests(harness.exchange, tenantA);
    expect(forA.map((request) => request.requestId)).toEqual([requestId]);
    // A's request is untouched (still "requested").
    expect(forA[0]!.status).toBe("requested");
  });
});

describe("the exchange path closes typed on withdrawal", () => {
  test("after A withdraws, B's export refuses typed (lineage stays readable)", async () => {
    const { harness } = await publishedByA();
    const publicationId = (await harness.exchange.listActivePublications())[0]!.publicationId;
    await withdrawPublication(harness.exchange, tenantA, publicationId);
    const exportOutcome = await exportPublication(harness.exchange, tenantB, { publicationId });
    expect(exportOutcome.outcome).toBe("refused");
    if (exportOutcome.outcome === "refused") {
      expect(exportOutcome.reason).toBe("publication-withdrawn");
      expect(exportOutcome.message).toContain("lineage");
    }
    // The withdrawn publication stays READABLE (lineage preservation) but
    // leaves the active surface.
    const active = await harness.exchange.listActivePublications();
    expect(active).toHaveLength(0);
    const all = await harness.exchange.listPublications();
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("withdrawn");
  });
});

describe("the import boundary refuses typed on every bad shape", () => {
  test("a tampered bundle refuses on the checksum (never a silent strip)", async () => {
    const { harness } = await publishedByA();
    const publicationId = (await harness.exchange.listActivePublications())[0]!.publicationId;
    const exportOutcome = await exportPublication(harness.exchange, tenantA, { publicationId });
    if (exportOutcome.outcome !== "exported") {
      throw new Error("fixture invariant broken");
    }
    const tampered = {
      ...exportOutcome.bundle,
      organization: { ...exportOutcome.bundle.organization, displayName: "Evil Clone" },
    } as OrganizationExport;
    const outcome = await importOrganization(satisfiedScope(), tampered);
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome === "refused") {
      expect(outcome.reason).toBe("checksum-mismatch");
    }
  });

  test("an unsatisfiable scope refuses with the missing dependency ids", async () => {
    const { harness } = await publishedByA();
    const publicationId = (await harness.exchange.listActivePublications())[0]!.publicationId;
    const exportOutcome = await exportPublication(harness.exchange, tenantA, { publicationId });
    if (exportOutcome.outcome !== "exported") {
      throw new Error("fixture invariant broken");
    }
    const outcome = await importOrganization(
      { tenant: tenantB, satisfiedRightsRequirements: [] },
      exportOutcome.bundle,
    );
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome === "refused") {
      expect(outcome.reason).toBe("unsatisfiable-dependency");
      expect(outcome.missing).toContain("rr-1");
    }
  });

  test("the source door stays fail-closed: only a complete candidate publishes", async () => {
    // A restrictive-but-complete candidate publishes; the exchange's
    // dependency surface is what the import re-checks (previous tests).
    // Here: the incomplete candidate refuses with the gap list.
    const harness = createHarness();
    const lab = await harness.labs.createLab(tenantA, { name: "Alpha Lab" });
    await harness.labs.chooseDomainAndTask(tenantA, lab.labId, {
      domainPackId: "football",
      task: "match",
    });
    await harness.labs.selectSourceData(tenantA, lab.labId, ["src-licensed-1"]);
    await harness.labs.setBudget(tenantA, lab.labId, { totalUsd: 30 });
    harness.runFixture.queue({
      status: "completed",
      costUsd: 5,
      candidates: [completeCandidatePayload()],
    });
    const run = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "search",
      estimatedCostUsd: 5,
      configuration: { seed: "seed-9", iterations: 3 },
    });
    if (run.outcome !== "requested" || run.candidates.length !== 1) {
      throw new Error("fixture invariant broken");
    }
    const candidateId = run.candidates[0]!.candidateId;
    const publication = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "for the exchange" },
    });
    expect(publication.outcome).toBe("published");
  });
});
