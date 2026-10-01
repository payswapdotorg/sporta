/**
 * REL-027 — the isolation invariants hold UNDER THE PROMOTION/ROLLBACK
 * TRANSITIONS: no cross-tenant leakage through the promotion path.
 *
 * The full cross-tenant journey, driven as ONE scenario:
 *
 *   tenant A: lab -> run -> PRIVATE candidate -> publication (REL-022)
 *             -> promotion REQUEST (REL-020's request-only surface)
 *   tenant B: export of the PUBLISHED snapshot -> import into B's scope
 *             -> REGISTRATION + automated promotion/rollback in the
 *                organization registry (the promotion authority)
 *
 * The registry is a global catalog (organizations are not tenant-scoped —
 * that is the design), but the TENANT-OWNED lab state behind the
 * publication must never leak: through publish, promotion request,
 * import, promotion, canary failure, rollback, re-promotion and
 * retirement, tenant B still cannot read tenant A's labs, runs,
 * candidates or incentives; A's candidate stays private; the publication
 * snapshot stays the ONLY visible surface; and the imported organization's
 * version chain resolves at every step (never a dangling version).
 */
import { describe, expect, test } from "bun:test";
import {
  createOrganizationRegistry,
  createRegistryDefaultClock,
  requestPromotion,
  requestRollback,
} from "@sporta/organization-registry";
import type { ActorRef, AdditionalEvidence, PromotionPolicy } from "@sporta/organization-registry";
import {
  LabIsolationError,
  exportPublication,
  importOrganization,
  listPromotionRequests,
  requestPublication,
  requestPublicationPromotion,
} from "../src";
import {
  createHarness,
  createLabWithCandidate,
  ledgerForLab,
  policyStoreWithV1,
  satisfiedScope,
  tenantA,
  tenantB,
} from "./fixtures";

/** The versioned policy the importing pipeline promotes under. */
function importPipelinePolicy(): PromotionPolicy {
  return {
    policyId: "import-pipeline",
    version: 1,
    gates: {
      reproducibility: { minReproductionRuns: 2 },
      benchmark: { minimumScores: { fidelity: 7.5, stylization: 7.0 } },
      robustness: {
        minSeedsTested: 3,
        minOutOfDistributionScore: 6.0,
        minSimulatorModelAgreement: 0.8,
        minBenchmarkCorpusCoverage: 0.7,
      },
      "rights-provenance": {},
      "cost-latency": { maxP95LatencyMs: 3000, maxPerRunUsd: 2.0, minSampleCount: 20 },
      "security-policy": {
        // The importing pipeline's OWN bars: exactly the checks a governed
        // REL-023 export carries (the published security evidence).
        requiredChecks: ["content-policy", "secret-scan"],
      },
      canary: { minCanaryObservations: 100 },
    },
    rollback: {
      allowedTriggers: ["hard-slo-failure", "policy-violation", "rights-failure", "cost-blowout"],
      demoteTriggers: ["hard-slo-failure"],
    },
  };
}

/** The evidence legs the import itself does NOT carry (the pipeline's own). */
function pipelineEvidence(labRunId: string): AdditionalEvidence {
  return {
    reproducibility: {
      labRunId,
      configurationVersion: "cfg-import-1",
      seed: "seed-import-42",
      reproductionRuns: 2,
      identicalRuns: 2,
      artifactRefs: ["artifact-import-repro-1"],
    },
    robustness: {
      seedsTested: 4,
      seedsPassed: 4,
      outOfDistributionScore: 7.0,
      simulatorModelAgreement: 0.9,
      benchmarkCorpusCoverage: 0.8,
      knownFailureEnvelope: ["none observed on the imported corpus"],
      artifactRefs: ["artifact-import-robust-1"],
    },
    rightsProvenance: {
      basisType: "licensed",
      rightsBasisId: "rb-import-1",
      licenses: [{ licenseId: "l-import-1", scope: "match-rendering" }],
      provenanceLineage: ["lin-import-1"],
      artifactRefs: ["artifact-import-rights-1"],
    },
    costLatency: {
      sampleCount: 40,
      artifactRefs: ["artifact-import-cost-1"],
    },
  };
}

function canaryEvidence(): AdditionalEvidence["canary"] {
  return {
    canaryWindowMs: 1_800_000,
    observations: 150,
    sloChecks: [
      { checkId: "slo-p95", passed: true },
      { checkId: "slo-quality", passed: true },
    ],
    rollbackTriggersObserved: 0,
    artifactRefs: ["artifact-import-canary-1"],
  };
}

/** Sweeps the full isolation invariant set at any transition point. */
async function assertNoLeak(
  harness: ReturnType<typeof createHarness>,
  context: { labId: string; runId: string; candidateId: string },
): Promise<void> {
  await expect(harness.labs.getLab(tenantB, context.labId)).rejects.toBeInstanceOf(
    LabIsolationError,
  );
  await expect(harness.labs.getRun(tenantB, context.runId)).rejects.toBeInstanceOf(
    LabIsolationError,
  );
  await expect(harness.labs.getCandidate(tenantB, context.candidateId)).rejects.toBeInstanceOf(
    LabIsolationError,
  );
  await expect(harness.labs.listCandidates(tenantB, context.labId)).rejects.toBeInstanceOf(
    LabIsolationError,
  );
  const forB = await listPromotionRequests(harness.exchange, tenantB);
  expect(forB).toHaveLength(0);
}

describe("the promotion/rollback transitions leak nothing cross-tenant", () => {
  test("publish -> import -> promote -> canary-fail -> rollback -> re-promote -> retire, swept at every step", async () => {
    const harness = createHarness();
    const PIPELINE: ActorRef = { actorType: "system", actorId: "import-pipeline" };

    // -- tenant A's private world ----------------------------------------
    const { labId, runId, candidateId } = await createLabWithCandidate(harness, tenantA);
    const ledger = ledgerForLab(harness, labId, policyStoreWithV1(), tenantA);
    // The on-policy grant: EXACTLY the policy's creditsPerGrant (100 in
    // v1 — off-policy amounts are typed refusals, never hidden rewards).
    const granted = await ledger.grantCredits(tenantA, { amount: 100, note: "seed" });
    expect(granted.outcome).toBe("recorded");
    await assertNoLeak(harness, { labId, runId, candidateId });

    // -- the publication + promotion REQUEST (A's own surfaces) ------------
    const publication = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "published for the exchange" },
    });
    expect(publication.outcome).toBe("published");
    const publicationId =
      publication.outcome === "published" ? publication.publication.publicationId : "";
    const promotionRequest = await requestPublicationPromotion(harness.exchange, tenantA, {
      publicationId,
    });
    expect(promotionRequest.outcome).toBe("requested"); // REQUEST only — the registry decides
    await assertNoLeak(harness, { labId, runId, candidateId });

    // -- tenant B consumes the SANCTIONED surface: export + import ---------
    const exportOutcome = await exportPublication(harness.exchange, tenantB, { publicationId });
    if (exportOutcome.outcome !== "exported") {
      throw new Error("fixture invariant broken: the sanctioned export refused");
    }
    const importOutcome = await importOrganization(satisfiedScope(), exportOutcome.bundle);
    if (importOutcome.outcome !== "imported") {
      throw new Error(`fixture invariant broken: the import refused: ${importOutcome.message}`);
    }
    expect(importOutcome.importedBy.tenantId).toBe("tenant-b");
    await assertNoLeak(harness, { labId, runId, candidateId });

    // -- B's imported organization rides the REAL promotion machinery ------
    const registry = createOrganizationRegistry({ clock: createRegistryDefaultClock() });
    const policy = importPipelinePolicy();
    const orgId = importOutcome.record.organizationId;
    await registry.register(importOutcome.record, PIPELINE);
    const importedVersion1 = await registry.get(orgId);
    expect(importedVersion1.status).toBe("draft");
    expect(importedVersion1.version).toBe(1);
    await assertNoLeak(harness, { labId, runId, candidateId });

    // Automated promotion: draft -> benchmarked -> validated -> canary.
    const toBenchmarked = await requestPromotion(registry, {
      organizationId: orgId,
      policy,
      additionalEvidence: {
        reproducibility: pipelineEvidence(runId).reproducibility,
      },
    });
    expect(toBenchmarked.outcome).toBe("granted");
    const toValidated = await requestPromotion(registry, {
      organizationId: orgId,
      policy,
      additionalEvidence: {
        robustness: pipelineEvidence(runId).robustness,
        rightsProvenance: pipelineEvidence(runId).rightsProvenance,
        costLatency: pipelineEvidence(runId).costLatency,
      },
    });
    expect(toValidated.outcome).toBe("granted");
    const toCanary = await requestPromotion(registry, { organizationId: orgId, policy });
    expect(toCanary.outcome).toBe("granted");
    const toProduction = await requestPromotion(registry, {
      organizationId: orgId,
      policy,
      additionalEvidence: { canary: canaryEvidence() },
    });
    if (toProduction.outcome !== "granted") {
      throw new Error("fixture invariant broken: production promotion refused");
    }
    const productionVersion = toProduction.record.version;
    await assertNoLeak(harness, { labId, runId, candidateId });

    // -- the failing canary: AUTOMATIC rollback (the demote trigger) -------
    const rollback = await requestRollback(registry, {
      organizationId: orgId,
      trigger: "hard-slo-failure",
      policy,
      note: "canary p95 SLO violated in production",
    });
    if (rollback.outcome !== "granted") {
      throw new Error("fixture invariant broken: the rollback refused");
    }
    expect(rollback.toStatus).toBe("canary"); // the demote: previous status restores
    // The rollback target resolves; the production version still resolves
    // (lineage preserved — never a dangling version).
    const afterRollback = await registry.get(orgId);
    expect(afterRollback.status).toBe("canary");
    const productionRecord = await registry.getVersion(orgId, productionVersion);
    expect(productionRecord.status).toBe("production");
    await assertNoLeak(harness, { labId, runId, candidateId });

    // -- the re-promotion: canary -> production again -----------------------
    const rePromotion = await requestPromotion(registry, { organizationId: orgId, policy });
    if (rePromotion.outcome !== "granted") {
      throw new Error("fixture invariant broken: the re-promotion refused");
    }
    expect(rePromotion.toStatus).toBe("production");
    const rePromotedVersion = rePromotion.record.version;
    await assertNoLeak(harness, { labId, runId, candidateId });

    // -- the terminal rollback: a non-demote trigger RETIRES ----------------
    const retire = await requestRollback(registry, {
      organizationId: orgId,
      trigger: "rights-failure",
      policy,
      note: "rights basis invalidated",
    });
    if (retire.outcome !== "granted") {
      throw new Error("fixture invariant broken: the retiring rollback refused");
    }
    expect(retire.toStatus).toBe("retired");
    // EVERY prior version still resolves (the retirement preserves lineage).
    for (let version = 1; version <= retire.toVersion; version += 1) {
      const record = await registry.getVersion(orgId, version);
      expect(record.version).toBe(version);
    }
    const latest = await registry.get(orgId);
    expect(latest.status).toBe("retired");
    // The retirement record is queryable evidence (trigger recorded).
    const log = await registry.transitionLog(orgId);
    const retirementEntry = log.find(
      (entry) => entry.operation === "rollback" && entry.rollbackTrigger === "rights-failure",
    );
    expect(retirementEntry).toBeDefined();
    expect(retirementEntry?.toStatus).toBe("retired");
    void rePromotedVersion;

    // -- the final sweep: nothing leaked through the whole path -------------
    await assertNoLeak(harness, { labId, runId, candidateId });
    // A's private candidate is STILL private and unchanged.
    const candidate = await harness.labs.getCandidate(tenantA, candidateId);
    expect(candidate.visibility).toBe("private");
    expect(candidate.owner.tenantId).toBe("tenant-a");
    // A's incentives remain A's, untouched by every transition.
    const balance = await ledger.balance(tenantA);
    expect(balance.creditsGranted).toBe(100);
    await expect(ledger.balance(tenantB)).rejects.toBeInstanceOf(LabIsolationError);
    // The publication snapshot remains the ONLY cross-tenant surface, and
    // A can still withdraw it (the publisher's own door never moved).
    const publications = await harness.exchange.listActivePublications();
    expect(publications.map((publication) => publication.publicationId)).toEqual([publicationId]);
  });
});
