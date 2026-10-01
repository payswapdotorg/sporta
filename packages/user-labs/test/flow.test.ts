/**
 * THE FULL USER FLOW (Gate REL-A6 subset, REL-020..023 end to end on
 * injected fixtures):
 *
 *   create a lab -> choose a domain/task -> select source data -> set a
 *   budget -> run simulation/search -> inspect candidates -> keep private or
 *   publish -> see the incentive policy -> request promotion -> export ->
 *   import into another scope.
 *
 * Green end to end, every step asserted — the same harness, the same
 * deterministic clock, no wall time, no real corpus, no real runtime.
 */
import { describe, expect, test } from "bun:test";
import {
  USER_LABS_DEFAULT_EPOCH_MS,
  exportPublication,
  importOrganization,
  requestPublication,
  requestPublicationPromotion,
  verifyExportChecksum,
} from "../src";
import type { IncentiveLedgerEntry } from "../src";
import { NewOrganizationInputSchema } from "@sporta/organization-registry";
import {
  createHarness,
  ledgerForLab,
  policyStoreWithV1,
  satisfiedScope,
  tenantA,
  tenantB,
} from "./fixtures";

describe("Gate REL-A6 (subset): the user-lab flow, end to end", () => {
  test("create -> configure -> run -> inspect -> publish -> incentives -> promotion request -> export -> import", async () => {
    const harness = createHarness();
    const policies = policyStoreWithV1();

    // 1. Create a lab.
    const lab = await harness.labs.createLab(tenantA, { name: "Alpha Lab" });
    expect(lab.status).toBe("active");
    expect(lab.selection).toBeNull();

    // 2. Choose a domain/task.
    const selection = await harness.labs.chooseDomainAndTask(tenantA, lab.labId, {
      domainPackId: "football",
      task: "match",
    });
    expect(selection.outcome).toBe("selected");

    // 3. Select source data (references into the historical corpus SEAM).
    const sources = await harness.labs.selectSourceData(tenantA, lab.labId, [
      "src-licensed-1",
      "src-licensed-2",
    ]);
    expect(sources.outcome).toBe("selected");

    // 4. Set a budget.
    const budget = await harness.labs.setBudget(tenantA, lab.labId, { totalUsd: 50 });
    expect(budget.outcome).toBe("set");

    // 5. Request a search run (the durable-run SEAM, scripted).
    harness.runFixture.queue({
      status: "completed",
      costUsd: 12,
      candidates: [
        {
          definition: {
            organizationId: "lab-org-alpha",
            displayName: "Lab Org Alpha",
            domain: {
              domains: ["football"],
              eventTypes: ["match", "clip"],
              modes: ["live", "batch"],
              renderers: ["tactical", "anime"],
            },
            capabilities: [
              { capabilityId: "perception.fusion", capabilityVersion: "1.0.0" },
              {
                capabilityId: "render.anime",
                capabilityVersion: "2.1.0",
                modelRuntime: { modelId: "npr-anime-v3", runtimeId: "onnx" },
              },
            ],
            profile: {
              latency: { p50Ms: 900, p95Ms: 1600, p99Ms: 2300 },
              cost: { perRunUsd: 1.4 },
            },
          },
          evidence: {
            benchmark: {
              corpusVersion: "corpus-v1",
              evaluatorVersion: "eval-v1",
              metrics: [
                { axis: "fidelity", value: 8.2 },
                { axis: "stylization", value: 7.9 },
              ],
              uncertainty: [
                { axis: "fidelity", ciLow: 7.8, ciHigh: 8.6 },
                { axis: "stylization", ciLow: 7.5, ciHigh: 8.3 },
              ],
              artifactRefs: ["artifact-bench-1"],
            },
            securityPolicy: {
              policyVersion: "sec-v1",
              checks: [
                { checkId: "content-policy", passed: true },
                { checkId: "secret-scan", passed: true },
              ],
              artifactRefs: ["artifact-sec-1"],
            },
          },
          provenance: {
            lineage: ["lin-run-1", "lin-run-2"],
            rightsRequirements: [
              {
                requirementId: "rr-1",
                description: "licensed match footage only",
                scope: "source-media",
              },
            ],
          },
        },
      ],
    });
    const run = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "search",
      estimatedCostUsd: 10,
      configuration: { seed: "seed-42", iterations: 5 },
    });
    expect(run.outcome).toBe("requested");
    if (run.outcome !== "requested") throw new Error("unreachable");
    expect(run.run.status).toBe("completed");
    expect(run.candidates).toHaveLength(1);
    const candidate = run.candidates[0]!;

    // 6. Inspect candidates: private by default, full provenance.
    const inspected = await harness.labs.getCandidate(tenantA, candidate.candidateId);
    expect(inspected.visibility).toBe("private");
    expect(inspected.provenance.runId).toBe(run.run.runId);
    expect(inspected.provenance.sourceRefs).toEqual(["src-licensed-1", "src-licensed-2"]);

    // 7. See the incentive policy (versioned, displayed to the user).
    const activePolicy = await policies.activePolicyAt(
      new Date(USER_LABS_DEFAULT_EPOCH_MS).toISOString(),
    );
    expect(activePolicy.version).toBe(1);
    expect(activePolicy.disclosureText).toContain("90 days");

    // 8. Publish (with the disclosure under that policy version).
    const publication = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId: candidate.candidateId,
      disclosure: {
        policyVersion: activePolicy.version,
        text: activePolicy.disclosureText,
      },
    });
    expect(publication.outcome).toBe("published");
    if (publication.outcome !== "published") throw new Error("unreachable");

    // 9. The incentive accounting: credits, private window, explicit boost.
    const ledger = ledgerForLab(harness, lab.labId, policies);
    const grant = await ledger.grantCredits(tenantA, { amount: 100 });
    expect(grant.outcome).toBe("recorded");
    const window = await ledger.startPrivateUseWindow(tenantA);
    expect(window.outcome).toBe("recorded");
    const boost = await ledger.recordDiscoveryBoost(tenantA, {
      publicationId: publication.publication.publicationId,
    });
    expect(boost.outcome).toBe("recorded");
    const entries = await ledger.entries(tenantA);
    expect(entries.map((e: IncentiveLedgerEntry) => e.kind)).toEqual([
      "credits-granted",
      "private-window-started",
      "discovery-boost",
    ]);
    expect(
      entries.every((e: IncentiveLedgerEntry) => e.policyVersion === activePolicy.version),
    ).toBe(true);

    // 10. Request promotion (REQUEST ONLY — the registry decides elsewhere).
    const promotion = await requestPublicationPromotion(harness.exchange, tenantA, {
      publicationId: publication.publication.publicationId,
    });
    expect(promotion.outcome).toBe("requested");
    if (promotion.outcome !== "requested") throw new Error("unreachable");
    expect(promotion.request.status).toBe("requested");

    // 11. Export the published organization (governed, checksummed).
    const exported = await exportPublication(harness.exchange, tenantA, {
      publicationId: publication.publication.publicationId,
    });
    expect(exported.outcome).toBe("exported");
    if (exported.outcome !== "exported") throw new Error("unreachable");
    expect(await verifyExportChecksum(exported.bundle)).toBe(true);

    // 12. Import into tenant B's scope — registry-compatible, data-only.
    const imported = await importOrganization(satisfiedScope(), exported.bundle);
    expect(imported.outcome).toBe("imported");
    if (imported.outcome !== "imported") throw new Error("unreachable");
    expect(NewOrganizationInputSchema.safeParse(imported.record).success).toBe(true);
    expect(imported.record.provenance.lineage).toEqual(["lin-run-1", "lin-run-2"]);
    expect(imported.importedBy).toEqual(tenantB);

    // And the whole trail is coherent: candidate -> publication -> bundle -> record.
    expect(imported.record.organizationId).toBe(publication.publication.snapshot.organizationId);
    expect(imported.record.displayName).toBe("Lab Org Alpha");
    expect(inspected.definition.displayName).toBe("Lab Org Alpha");
  });

  test("keeping the candidate private is simply not publishing (the default state)", async () => {
    const harness = createHarness();
    const lab = await harness.labs.createLab(tenantA, { name: "Quiet Lab" });
    await harness.labs.chooseDomainAndTask(tenantA, lab.labId, {
      domainPackId: "football",
      task: "match",
    });
    await harness.labs.selectSourceData(tenantA, lab.labId, ["src-licensed-1"]);
    await harness.labs.setBudget(tenantA, lab.labId, { totalUsd: 10 });
    harness.runFixture.queue({
      status: "completed",
      costUsd: 4,
      candidates: [
        {
          definition: { organizationId: "lab-org-quiet", displayName: "Quiet Org" },
          evidence: {},
          provenance: { lineage: ["lin-quiet"], rightsRequirements: [] },
        },
      ],
    });
    const run = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "simulation",
      estimatedCostUsd: 4,
    });
    if (run.outcome !== "requested") throw new Error("unreachable");
    // No publication exists; the candidate store stays tenant-private.
    expect(await harness.exchange.listPublications()).toEqual([]);
    const candidates = await harness.labs.listCandidates(tenantA, lab.labId);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.visibility).toBe("private");
  });
});
