/**
 * Organization publishing (REL-022) + promotion REQUESTS (REL-020's last
 * step):
 * - a complete candidate publishes as an immutable snapshot;
 * - an incomplete candidate refuses with the typed gap list (fail closed,
 *   useful state);
 * - withdrawal preserves lineage (the registry's retirement rule);
 * - promotion REQUEST only — the decision is the registry pipeline's.
 */
import { describe, expect, test } from "bun:test";
import {
  LabConflictError,
  LabIsolationError,
  LabNotFoundError,
  LabValidationError,
  publicationGaps,
  requestPublication,
  requestPublicationPromotion,
  withdrawPublication,
  withdrawPromotionRequest,
  listPromotionRequests,
} from "../src";
import type { LabCandidate } from "../src";
import {
  completeCandidatePayload,
  createHarness,
  createLabWithCandidate,
  configureLab,
  tenantA,
  tenantB,
} from "./fixtures";

describe("publication of a complete candidate", () => {
  test("publishes an immutable snapshot carrying the disclosure + policy version", async () => {
    const harness = createHarness();
    const { labId, candidateId } = await createLabWithCandidate(harness, tenantA);
    const outcome = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: {
        policyVersion: 1,
        text: "You keep private use for up to 90 days; discovery boosts are disclosed.",
      },
    });
    expect(outcome.outcome).toBe("published");
    if (outcome.outcome !== "published") throw new Error("unreachable");
    const publication = outcome.publication;
    expect(publication.publicationId).toBe("pub-1");
    expect(publication.status).toBe("published");
    expect(publication.publishedBy).toEqual(tenantA);
    expect(publication.disclosure.policyVersion).toBe(1);
    expect(publication.source).toEqual({
      labId,
      candidateId,
      candidateVersion: 1,
    });
    expect(publication.snapshot.organizationId).toBe("lab-org-alpha");
    expect(publication.snapshot.provenance.lineage).toEqual(["lin-run-1", "lin-run-2"]);
    expect(publication.snapshot.evidence.benchmark?.corpusVersion).toBe("corpus-v1");
    expect(Object.isFrozen(publication)).toBe(true);
    expect(Object.isFrozen(publication.snapshot)).toBe(true);
  });

  test("refuses an empty disclosure at the boundary", async () => {
    const harness = createHarness();
    const { candidateId } = await createLabWithCandidate(harness, tenantA);
    await expect(
      requestPublication(harness.exchange, harness.labs, tenantA, {
        candidateId,
        disclosure: { policyVersion: 1, text: "" },
      }),
    ).rejects.toBeInstanceOf(LabValidationError);
  });

  test("unknown candidates are typed not-found", async () => {
    const harness = createHarness();
    await expect(
      requestPublication(harness.exchange, harness.labs, tenantA, {
        candidateId: "cand-404",
        disclosure: { policyVersion: 1, text: "x" },
      }),
    ).rejects.toBeInstanceOf(LabNotFoundError);
  });
});

describe("publication of an incomplete candidate (fail closed, useful state)", () => {
  async function labWithIncompleteCandidate() {
    const harness = createHarness();
    const lab = await harness.labs.createLab(tenantA, { name: "Lab" });
    await configureLab(harness.labs, tenantA, lab.labId);
    harness.runFixture.queue({
      status: "completed",
      costUsd: 12,
      candidates: [
        {
          definition: { organizationId: "lab-org-incomplete", displayName: "Incomplete Org" },
          evidence: {},
          provenance: { lineage: [], rightsRequirements: [] },
        },
      ],
    });
    const run = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "search",
      estimatedCostUsd: 10,
    });
    if (run.outcome !== "requested") throw new Error("unreachable");
    return { harness, candidate: run.candidates[0]! };
  }

  test("refuses with a typed record listing EVERY missing piece", async () => {
    const { harness, candidate } = await labWithIncompleteCandidate();
    const outcome = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId: candidate.candidateId,
      disclosure: { policyVersion: 1, text: "x" },
    });
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("incomplete-candidate");
    expect(outcome.gaps).toContain("definition: domain.domains is missing or empty");
    expect(outcome.gaps).toContain("definition: domain.eventTypes is missing or empty");
    expect(outcome.gaps).toContain("definition: domain.modes is missing or empty");
    expect(outcome.gaps).toContain("definition: domain.renderers is missing or empty");
    expect(outcome.gaps).toContain("definition: capabilities are missing or empty");
    expect(outcome.gaps).toContain("definition: operating profile (latency/cost) is missing");
    expect(outcome.gaps).toContain("provenance: lineage is empty");
    expect(outcome.message).toContain("7 gap(s)");
    // Nothing was published.
    expect(await harness.exchange.listPublications()).toEqual([]);
  });

  test("publicationGaps is empty for a complete candidate (the direct gate)", () => {
    const candidate: LabCandidate = {
      candidateId: "cand-x",
      labId: "lab-1",
      owner: tenantA,
      version: 1,
      visibility: "private",
      definition: completeCandidatePayload().definition,
      evidence: completeCandidatePayload().evidence,
      provenance: {
        runId: "run-1",
        sourceRefs: ["src-licensed-1"],
        lineage: ["lin-1"],
        rightsRequirements: [],
      },
      createdAt: "2025-01-06T12:00:00.000Z",
      updatedAt: "2025-01-06T12:00:00.000Z",
    };
    expect(publicationGaps(candidate)).toEqual([]);
  });
});

describe("publication immutability", () => {
  test("revising the candidate never mutates an existing publication; republishing makes a NEW one", async () => {
    const harness = createHarness();
    const { candidateId } = await createLabWithCandidate(harness, tenantA);
    const first = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "first" },
    });
    if (first.outcome !== "published") throw new Error("unreachable");

    await harness.labs.reviseCandidate(tenantA, candidateId, {
      definition: { displayName: "Lab Org Alpha v2" },
      lineageAdditions: ["lin-rev-1"],
    });

    // The first publication is untouched (immutable snapshot).
    const stillFirst = await harness.exchange.getPublication(first.publication.publicationId);
    expect(stillFirst.snapshot.displayName).toBe("Lab Org Alpha");
    expect(stillFirst.source.candidateVersion).toBe(1);

    // Publishing again snapshots the NEW version under a new publication id.
    const second = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "second" },
    });
    expect(second.outcome).toBe("published");
    if (second.outcome !== "published") throw new Error("unreachable");
    expect(second.publication.publicationId).not.toBe(first.publication.publicationId);
    expect(second.publication.snapshot.displayName).toBe("Lab Org Alpha v2");
    expect(second.publication.source.candidateVersion).toBe(2);
    expect(second.publication.snapshot.provenance.lineage).toEqual([
      "lin-run-1",
      "lin-run-2",
      "lin-rev-1",
    ]);
  });
});

describe("withdrawal preserves lineage (the registry's retirement rule)", () => {
  test("withdrawn publications stay fully readable with lineage intact", async () => {
    const harness = createHarness();
    const { candidateId } = await createLabWithCandidate(harness, tenantA);
    const published = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "x" },
    });
    if (published.outcome !== "published") throw new Error("unreachable");
    const publicationId = published.publication.publicationId;

    const withdrawn = await withdrawPublication(harness.exchange, tenantA, publicationId);
    expect(withdrawn.status).toBe("withdrawn");
    expect(typeof withdrawn.withdrawnAt).toBe("string");
    expect(withdrawn.withdrawnAt).not.toBeNull();

    // Lineage and snapshot are preserved — only the status flipped.
    const read = await harness.exchange.getPublication(publicationId);
    expect(read.snapshot.provenance.lineage).toEqual(["lin-run-1", "lin-run-2"]);
    expect(read.snapshot.organizationId).toBe("lab-org-alpha");
    expect(read.status).toBe("withdrawn");

    // Withdrawn publications are excluded from the active list but kept in the full list.
    expect((await harness.exchange.listActivePublications()).map((p) => p.publicationId)).toEqual(
      [],
    );
    expect((await harness.exchange.listPublications()).map((p) => p.publicationId)).toEqual([
      publicationId,
    ]);

    // Double withdrawal is a typed conflict.
    await expect(
      withdrawPublication(harness.exchange, tenantA, publicationId),
    ).rejects.toBeInstanceOf(LabConflictError);
  });

  test("unknown publications are typed not-found", async () => {
    const harness = createHarness();
    await expect(harness.exchange.getPublication("pub-404")).rejects.toBeInstanceOf(
      LabNotFoundError,
    );
  });
});

describe("promotion requests (REQUEST only — the registry decides)", () => {
  test("records a request for a published candidate, with NO decision anywhere on it", async () => {
    const harness = createHarness();
    const { labId, candidateId } = await createLabWithCandidate(harness, tenantA);
    const published = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "x" },
    });
    if (published.outcome !== "published") throw new Error("unreachable");
    const publicationId = published.publication.publicationId;

    const outcome = await requestPublicationPromotion(harness.exchange, tenantA, {
      publicationId,
    });
    expect(outcome.outcome).toBe("requested");
    if (outcome.outcome !== "requested") throw new Error("unreachable");
    expect(outcome.request.requestId).toBe("preq-1");
    expect(outcome.request.publicationId).toBe(publicationId);
    expect(outcome.request.candidateId).toBe(candidateId);
    expect(outcome.request.labId).toBe(labId);
    expect(outcome.request.requestedBy).toEqual(tenantA);
    expect(outcome.request.status).toBe("requested");
    // There is no decision field on a promotion request — structurally.
    expect(Object.keys(outcome.request).sort()).toEqual([
      "candidateId",
      "labId",
      "publicationId",
      "requestId",
      "requestedAt",
      "requestedBy",
      "status",
      "withdrawnAt",
    ]);
  });

  test("refuses duplicate active requests and withdrawn publications", async () => {
    const harness = createHarness();
    const { candidateId } = await createLabWithCandidate(harness, tenantA);
    const published = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "x" },
    });
    if (published.outcome !== "published") throw new Error("unreachable");
    const publicationId = published.publication.publicationId;

    await requestPublicationPromotion(harness.exchange, tenantA, { publicationId });
    const duplicate = await requestPublicationPromotion(harness.exchange, tenantA, {
      publicationId,
    });
    expect(duplicate.outcome).toBe("refused");
    if (duplicate.outcome !== "refused") throw new Error("unreachable");
    expect(duplicate.reason).toBe("already-requested");

    // Withdraw the request, then ask again: allowed (the first was withdrawn).
    const requests = await listPromotionRequests(harness.exchange, tenantA);
    const first = requests[0]!;
    const withdrawnRequest = await withdrawPromotionRequest(
      harness.exchange,
      tenantA,
      first.requestId,
    );
    expect(withdrawnRequest.status).toBe("withdrawn");
    const renewed = await requestPublicationPromotion(harness.exchange, tenantA, { publicationId });
    expect(renewed.outcome).toBe("requested");

    // Withdraw the PUBLICATION: promotion requests on it now refuse.
    await withdrawPublication(harness.exchange, tenantA, publicationId);
    const afterWithdrawal = await requestPublicationPromotion(harness.exchange, tenantA, {
      publicationId,
    });
    expect(afterWithdrawal.outcome).toBe("refused");
    if (afterWithdrawal.outcome !== "refused") throw new Error("unreachable");
    expect(afterWithdrawal.reason).toBe("publication-withdrawn");
    expect(afterWithdrawal.message).toContain("lineage is preserved");
  });

  test("listing filters by caller; unknown requests are typed not-found", async () => {
    const harness = createHarness();
    const { candidateId } = await createLabWithCandidate(harness, tenantA);
    const published = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "x" },
    });
    if (published.outcome !== "published") throw new Error("unreachable");
    await requestPublicationPromotion(harness.exchange, tenantA, {
      publicationId: published.publication.publicationId,
    });
    expect(await listPromotionRequests(harness.exchange, tenantA)).toHaveLength(1);
    expect(await listPromotionRequests(harness.exchange, tenantB)).toHaveLength(0);
    await expect(
      withdrawPromotionRequest(harness.exchange, tenantA, "preq-404"),
    ).rejects.toBeInstanceOf(LabNotFoundError);
    // Cross-tenant withdrawal of a request is the isolation suite's law too.
    const requestId = (await listPromotionRequests(harness.exchange, tenantA))[0]!.requestId;
    await expect(
      withdrawPromotionRequest(harness.exchange, tenantB, requestId),
    ).rejects.toBeInstanceOf(LabIsolationError);
  });
});
