/**
 * REL-027 — the REL-A6 isolation clauses as an acceptance-grade battery:
 * tenant A cannot observe tenant B's labs, runs, artifacts (candidates) or
 * incentives — EVERY query surface swept, not spot-checked.
 *
 * The existing isolation test (REL-020's own demand) covers the candidate
 * read-through; this battery sweeps the FULL user-labs surface: every lab
 * operation (get/list/choose-domain/select-source/set-budget/archive),
 * every run surface (get/list), every candidate surface
 * (get/version/list/revise — the last a WRITE), and every incentive
 * ledger surface (grant/use/window-start/window-expire/boost/entries/
 * balance). Each cross-tenant path refuses with the typed
 * `LabIsolationError` carrying the attempting tenant, the owning tenant,
 * and the resource type + id — the single law enforced at every door.
 */
import { describe, expect, test } from "bun:test";
import { LabIsolationError } from "../src";
import {
  configureLab,
  createHarness,
  createLabWithCandidate,
  ledgerForLab,
  policyStoreWithV1,
  tenantA,
  tenantB,
} from "./fixtures";
import type { Harness } from "./fixtures";

/** Asserts the cross-tenant call refuses with the typed isolation error. */
async function refusesIsolated(
  call: () => Promise<unknown>,
  expected: { resourceType: string; resourceId: string },
): Promise<void> {
  try {
    await call();
    throw new Error("expected a typed isolation refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(LabIsolationError);
    const isolation = error as LabIsolationError;
    expect(isolation.failureClass).toBe("isolation");
    expect(isolation.details).toMatchObject({
      attemptingTenantId: "tenant-b",
      owningTenantId: "tenant-a",
      ...expected,
    });
  }
}

describe("the LAB surfaces (every operation, swept)", () => {
  test("tenant B cannot read, configure, budget or archive tenant A's lab", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    await refusesIsolated(() => harness.labs.getLab(tenantB, labId), {
      resourceType: "lab",
      resourceId: labId,
    });
    await refusesIsolated(
      () =>
        harness.labs.chooseDomainAndTask(tenantB, labId, {
          domainPackId: "football",
          task: "match",
        }),
      { resourceType: "lab", resourceId: labId },
    );
    await refusesIsolated(() => harness.labs.selectSourceData(tenantB, labId, ["src-licensed-1"]), {
      resourceType: "lab",
      resourceId: labId,
    });
    await refusesIsolated(() => harness.labs.setBudget(tenantB, labId, { totalUsd: 10 }), {
      resourceType: "lab",
      resourceId: labId,
    });
    await refusesIsolated(() => harness.labs.archiveLab(tenantB, labId), {
      resourceType: "lab",
      resourceId: labId,
    });
  });

  test("listLabs only ever shows the caller's own labs (no leak, no error)", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const own = await harness.labs.createLab(tenantB, { name: "Beta Lab" });
    const listedForB = await harness.labs.listLabs(tenantB);
    expect(listedForB.map((lab) => lab.labId)).toEqual([own.labId]);
    expect(listedForB.some((lab) => lab.labId === labId)).toBe(false);
    const listedForA = await harness.labs.listLabs(tenantA);
    expect(listedForA.map((lab) => lab.labId)).toEqual([labId]);
  });
});

describe("the RUN surfaces (every operation, swept)", () => {
  test("tenant B cannot read tenant A's run or list a foreign lab's runs", async () => {
    const harness = createHarness();
    const { labId, runId } = await createLabWithCandidate(harness, tenantA);
    await refusesIsolated(() => harness.labs.getRun(tenantB, runId), {
      resourceType: "lab",
      resourceId: labId,
    });
    await refusesIsolated(() => harness.labs.listRuns(tenantB, labId), {
      resourceType: "lab",
      resourceId: labId,
    });
    // A tenant-B run request against a foreign lab refuses too (a WRITE).
    harness.runFixture.queue({ status: "completed", costUsd: 1 });
    await refusesIsolated(
      () =>
        harness.labs.requestRun(tenantB, labId, {
          purpose: "search",
          estimatedCostUsd: 1,
          configuration: { seed: "seed-1", iterations: 3 },
        }),
      { resourceType: "lab", resourceId: labId },
    );
  });
});

describe("the ARTIFACT (candidate) surfaces — read AND write, swept", () => {
  test("tenant B cannot get, version-read, list or REVISE tenant A's candidate", async () => {
    const harness = createHarness();
    const { labId, candidateId } = await createLabWithCandidate(harness, tenantA);
    await refusesIsolated(() => harness.labs.getCandidate(tenantB, candidateId), {
      resourceType: "candidate",
      resourceId: candidateId,
    });
    await refusesIsolated(() => harness.labs.getCandidateVersion(tenantB, candidateId, 1), {
      resourceType: "candidate",
      resourceId: candidateId,
    });
    await refusesIsolated(() => harness.labs.listCandidates(tenantB, labId), {
      resourceType: "lab",
      resourceId: labId,
    });
    await refusesIsolated(
      () => harness.labs.reviseCandidate(tenantB, candidateId, { lineageAdditions: ["lin-evil"] }),
      { resourceType: "candidate", resourceId: candidateId },
    );
    // Nothing was written: tenant A's candidate is unchanged (v1).
    const candidate = await harness.labs.getCandidate(tenantA, candidateId);
    expect(candidate.version).toBe(1);
    expect(candidate.provenance.lineage).not.toContain("lin-evil");
  });
});

describe("the INCENTIVE surfaces (every ledger operation, swept)", () => {
  test("tenant B cannot touch or read tenant A's incentive ledger", async () => {
    const harness: Harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const ledger = ledgerForLab(harness, labId, policyStoreWithV1(), tenantA);
    await expect(
      ledger.grantCredits(tenantB, { amount: 100, note: "hostile grant" }),
    ).rejects.toBeInstanceOf(LabIsolationError);
    await expect(
      ledger.useCredits(tenantB, { amount: 1, purpose: "hostile use" }),
    ).rejects.toBeInstanceOf(LabIsolationError);
    await expect(ledger.startPrivateUseWindow(tenantB)).rejects.toBeInstanceOf(LabIsolationError);
    await expect(ledger.expirePrivateUseWindow(tenantB)).rejects.toBeInstanceOf(LabIsolationError);
    await expect(
      ledger.recordDiscoveryBoost(tenantB, { publicationId: "pub-1" }),
    ).rejects.toBeInstanceOf(LabIsolationError);
    await expect(ledger.entries(tenantB)).rejects.toBeInstanceOf(LabIsolationError);
    await expect(ledger.balance(tenantB)).rejects.toBeInstanceOf(LabIsolationError);
    // Nothing leaked and nothing moved: A's ledger still works untouched.
    const granted = await ledger.grantCredits(tenantA, { amount: 100, note: "seed" });
    expect(granted.outcome).toBe("recorded");
    const entries = await ledger.entries(tenantA);
    expect(entries.every((entry) => entry.labId === labId)).toBe(true);
    const balance = await ledger.balance(tenantA);
    expect(balance.creditsGranted).toBe(100);
  });
});

describe("the isolation sweep holds for a SECOND tenant pair direction (B owns, A probes)", () => {
  test("tenant A cannot observe tenant B's labs, runs or candidates either", async () => {
    const harness = createHarness();
    const { labId, runId, candidateId } = await createLabWithCandidate(harness, tenantB);
    await expect(harness.labs.getLab(tenantA, labId)).rejects.toBeInstanceOf(LabIsolationError);
    await expect(harness.labs.getRun(tenantA, runId)).rejects.toBeInstanceOf(LabIsolationError);
    await expect(harness.labs.getCandidate(tenantA, candidateId)).rejects.toBeInstanceOf(
      LabIsolationError,
    );
    await expect(harness.labs.listCandidates(tenantA, labId)).rejects.toBeInstanceOf(
      LabIsolationError,
    );
    // And B's own flow keeps working (isolation never degrades capability).
    const lab = await harness.labs.createLab(tenantB, { name: "B's second lab" });
    await configureLab(harness.labs, tenantB, lab.labId);
    const budget = await harness.labs.setBudget(tenantB, lab.labId, { totalUsd: 5 });
    expect(budget.outcome).toBe("set");
  });
});
