/**
 * The user lab lifecycle (REL-020): create -> choose domain/task -> select
 * source data -> set budget -> request a run -> inspect candidates -> revise
 * — plus EVERY typed-refusal path: unknown domain, missing source basis
 * (selection-time AND run-time re-check), budget exceeded, lab-not-ready,
 * lab-archived, empty revision.
 */
import { describe, expect, test } from "bun:test";
import { LabIsolationError, LabNotFoundError, LabValidationError, createUserLabs } from "../src";
import {
  completeCandidatePayload,
  configureLab,
  createHarness,
  createScriptedRunPort,
  createFixtureSourceDataPort,
  fixtureDomainCatalog,
  incompleteCandidatePayload,
  tenantA,
  tenantB,
} from "./fixtures";

describe("lab creation", () => {
  test("creates an active, unconfigured lab with zero spend", async () => {
    const { labs } = createHarness();
    const lab = await labs.createLab(tenantA, { name: "My Lab" });
    expect(lab.labId).toBe("lab-1");
    expect(lab.owner).toEqual(tenantA);
    expect(lab.name).toBe("My Lab");
    expect(lab.status).toBe("active");
    expect(lab.selection).toBeNull();
    expect(lab.sourceDataRefs).toEqual([]);
    expect(lab.budget).toBeNull();
    expect(lab.spentUsd).toBe(0);
    expect(lab.createdAt).toBe("2025-01-06T12:00:00.000Z");
    expect(Object.isFrozen(lab)).toBe(true);
  });

  test("refuses an empty name at the boundary (typed validation error)", async () => {
    const { labs } = createHarness();
    await expect(labs.createLab(tenantA, { name: "" })).rejects.toBeInstanceOf(LabValidationError);
  });

  test("unknown lab ids are typed not-found", async () => {
    const { labs } = createHarness();
    await expect(labs.getLab(tenantA, "lab-404")).rejects.toBeInstanceOf(LabNotFoundError);
  });
});

describe("domain/task selection", () => {
  test("selects a cataloged domain and task", async () => {
    const { labs } = createHarness();
    const lab = await labs.createLab(tenantA, { name: "Lab" });
    const outcome = await labs.chooseDomainAndTask(tenantA, lab.labId, {
      domainPackId: "football",
      task: "match",
    });
    expect(outcome.outcome).toBe("selected");
    if (outcome.outcome !== "selected") throw new Error("unreachable");
    expect(outcome.lab.selection).toEqual({ domainPackId: "football", task: "match" });
  });

  test("refuses an unknown domain, naming the catalog (typed refusal)", async () => {
    const { labs } = createHarness();
    const lab = await labs.createLab(tenantA, { name: "Lab" });
    const outcome = await labs.chooseDomainAndTask(tenantA, lab.labId, {
      domainPackId: "cricket",
      task: "match",
    });
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("unknown-domain");
    expect(outcome.message).toContain("cricket");
    expect(outcome.message).toContain("football");
  });

  test("refuses a known domain with an unknown task", async () => {
    const { labs } = createHarness();
    const lab = await labs.createLab(tenantA, { name: "Lab" });
    const outcome = await labs.chooseDomainAndTask(tenantA, lab.labId, {
      domainPackId: "football",
      task: "tournament",
    });
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("unknown-domain");
  });
});

describe("source-data selection (the fail-closed rights check)", () => {
  test("selects licensed source data and returns the resolved records", async () => {
    const { labs } = createHarness();
    const lab = await labs.createLab(tenantA, { name: "Lab" });
    const outcome = await labs.selectSourceData(tenantA, lab.labId, [
      "src-licensed-1",
      "src-licensed-2",
    ]);
    expect(outcome.outcome).toBe("selected");
    if (outcome.outcome !== "selected") throw new Error("unreachable");
    expect(outcome.lab.sourceDataRefs).toEqual(["src-licensed-1", "src-licensed-2"]);
    expect(outcome.resolved.map((r) => r.rightsBasis.basisType)).toEqual(["licensed", "licensed"]);
  });

  test("refuses unknown refs with the typed missing-source-basis record", async () => {
    const { labs } = createHarness();
    const lab = await labs.createLab(tenantA, { name: "Lab" });
    const outcome = await labs.selectSourceData(tenantA, lab.labId, [
      "src-licensed-1",
      "src-does-not-exist",
    ]);
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("missing-source-basis");
    expect(outcome.unknownRefs).toEqual(["src-does-not-exist"]);
    expect(outcome.message).toContain("src-does-not-exist");
  });

  test("refuses an unverified rights basis (a URL is not a rights basis)", async () => {
    const { labs } = createHarness();
    const lab = await labs.createLab(tenantA, { name: "Lab" });
    const outcome = await labs.selectSourceData(tenantA, lab.labId, ["src-unverified-1"]);
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("missing-source-basis");
    expect(outcome.unverifiedRefs).toEqual(["src-unverified-1"]);
    expect(outcome.message).toContain("public URL alone never proves transformation rights");
  });

  test("refuses an empty ref list at the boundary", async () => {
    const { labs } = createHarness();
    const lab = await labs.createLab(tenantA, { name: "Lab" });
    await expect(labs.selectSourceData(tenantA, lab.labId, [])).rejects.toBeInstanceOf(
      LabValidationError,
    );
  });
});

describe("budget", () => {
  test("sets the budget", async () => {
    const { labs } = createHarness();
    const lab = await labs.createLab(tenantA, { name: "Lab" });
    const outcome = await labs.setBudget(tenantA, lab.labId, { totalUsd: 50 });
    expect(outcome.outcome).toBe("set");
    if (outcome.outcome !== "set") throw new Error("unreachable");
    expect(outcome.lab.budget).toEqual({ totalUsd: 50 });
  });

  test("refuses a non-positive budget at the boundary", async () => {
    const { labs } = createHarness();
    const lab = await labs.createLab(tenantA, { name: "Lab" });
    await expect(labs.setBudget(tenantA, lab.labId, { totalUsd: 0 })).rejects.toBeInstanceOf(
      LabValidationError,
    );
  });
});

describe("run requests", () => {
  test("refuses to run an unconfigured lab, listing every missing piece", async () => {
    const { labs } = createHarness();
    const lab = await labs.createLab(tenantA, { name: "Lab" });
    const outcome = await labs.requestRun(tenantA, lab.labId, {
      purpose: "search",
      estimatedCostUsd: 10,
    });
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("lab-not-ready");
    expect(outcome.missingPieces).toEqual([
      "domain/task selection",
      "source-data selection",
      "budget",
    ]);
  });

  test("requests a run, records actual cost and ingests private candidates", async () => {
    const harness = createHarness();
    const lab = await harness.labs.createLab(tenantA, { name: "Lab" });
    await configureLab(harness.labs, tenantA, lab.labId);
    harness.runFixture.queue({
      status: "completed",
      costUsd: 12,
      candidates: [completeCandidatePayload()],
    });
    const outcome = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "search",
      estimatedCostUsd: 10,
      configuration: { seed: "seed-42", iterations: 5 },
    });
    expect(outcome.outcome).toBe("requested");
    if (outcome.outcome !== "requested") throw new Error("unreachable");
    expect(outcome.run.runId).toBe("run-1");
    expect(outcome.run.status).toBe("completed");
    expect(outcome.run.costUsd).toBe(12);
    expect(outcome.run.configuration).toEqual({ seed: "seed-42", iterations: 5 });
    expect(outcome.candidates).toHaveLength(1);
    const candidate = outcome.candidates[0]!;
    expect(candidate.candidateId).toBe("cand-1");
    expect(candidate.version).toBe(1);
    expect(candidate.visibility).toBe("private");
    expect(candidate.provenance.runId).toBe("run-1");
    expect(candidate.provenance.sourceRefs).toEqual(["src-licensed-1", "src-licensed-2"]);
    expect(candidate.provenance.lineage).toEqual(["lin-run-1", "lin-run-2"]);
    const after = await harness.labs.getLab(tenantA, lab.labId);
    expect(after.spentUsd).toBe(12); // ACTUAL cost charged, not the estimate
  });

  test("refuses on budget with the numbers in the message", async () => {
    const harness = createHarness();
    const lab = await harness.labs.createLab(tenantA, { name: "Lab" });
    await configureLab(harness.labs, tenantA, lab.labId);
    harness.runFixture.queue({ status: "completed", costUsd: 12, candidates: [] });
    await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "simulation",
      estimatedCostUsd: 10,
    });
    // spent 12 of 50 -> remaining 38; a 39 estimate must refuse.
    const refused = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "simulation",
      estimatedCostUsd: 39,
    });
    expect(refused.outcome).toBe("refused");
    if (refused.outcome !== "refused") throw new Error("unreachable");
    expect(refused.reason).toBe("budget-exceeded");
    expect(refused.message).toContain("39.00 USD");
    expect(refused.message).toContain("38.00 USD");
    // ...but exactly-remaining is allowed (the ceiling, not below it).
    harness.runFixture.queue({ status: "completed", costUsd: 38, candidates: [] });
    const boundary = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "simulation",
      estimatedCostUsd: 38,
    });
    expect(boundary.outcome).toBe("requested");
  });

  test("re-checks the source basis at run time (fail closed on a flipped basis)", async () => {
    const harness = createHarness();
    const lab = await harness.labs.createLab(tenantA, { name: "Lab" });
    await configureLab(harness.labs, tenantA, lab.labId);
    // The corpus revokes src-licensed-1's basis between selection and run.
    harness.sourceFixture.setRightsBasis("src-licensed-1", "unverified");
    const outcome = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "search",
      estimatedCostUsd: 10,
    });
    expect(outcome.outcome).toBe("refused");
    if (outcome.outcome !== "refused") throw new Error("unreachable");
    expect(outcome.reason).toBe("missing-source-basis");
    expect(outcome.unverifiedRefs).toEqual(["src-licensed-1"]);
    expect(harness.runFixture.pending()).toBe(0); // the port was never called
  });

  test("records failed runs with their reason and no candidates", async () => {
    const harness = createHarness();
    const lab = await harness.labs.createLab(tenantA, { name: "Lab" });
    await configureLab(harness.labs, tenantA, lab.labId);
    harness.runFixture.queue({ status: "failed", costUsd: 3, failureReason: "diverged" });
    const outcome = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "search",
      estimatedCostUsd: 10,
    });
    expect(outcome.outcome).toBe("requested");
    if (outcome.outcome !== "requested") throw new Error("unreachable");
    expect(outcome.run.status).toBe("failed");
    expect(outcome.run.failureReason).toBe("diverged");
    expect(outcome.candidates).toEqual([]);
    const after = await harness.labs.getLab(tenantA, lab.labId);
    expect(after.spentUsd).toBe(3);
  });

  test("refuses a malformed run request at the boundary", async () => {
    const harness = createHarness();
    const lab = await harness.labs.createLab(tenantA, { name: "Lab" });
    await configureLab(harness.labs, tenantA, lab.labId);
    await expect(
      harness.labs.requestRun(tenantA, lab.labId, {
        purpose: "vibes" as "search",
        estimatedCostUsd: 10,
      }),
    ).rejects.toBeInstanceOf(LabValidationError);
    await expect(
      harness.labs.requestRun(tenantA, lab.labId, { purpose: "search", estimatedCostUsd: -1 }),
    ).rejects.toBeInstanceOf(LabValidationError);
  });
});

describe("candidates and revisions", () => {
  test("lists candidates, keeps every version, refuses empty revisions", async () => {
    const harness = createHarness();
    const lab = await harness.labs.createLab(tenantA, { name: "Lab" });
    await configureLab(harness.labs, tenantA, lab.labId);
    harness.runFixture.queue({
      status: "completed",
      costUsd: 12,
      candidates: [completeCandidatePayload()],
    });
    const run = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "search",
      estimatedCostUsd: 10,
    });
    if (run.outcome !== "requested") throw new Error("unreachable");
    const candidateId = run.candidates[0]!.candidateId;

    const listed = await harness.labs.listCandidates(tenantA, lab.labId);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.candidateId).toBe(candidateId);

    // An empty revision is a typed refusal, not a no-op version bump.
    const empty = await harness.labs.reviseCandidate(tenantA, candidateId, {});
    expect(empty.outcome).toBe("refused");
    if (empty.outcome !== "refused") throw new Error("unreachable");
    expect(empty.reason).toBe("empty-revision");

    // A real revision bumps the version, merges, and extends the lineage.
    const revised = await harness.labs.reviseCandidate(tenantA, candidateId, {
      definition: { displayName: "Lab Org Alpha v2" },
      lineageAdditions: ["lin-rev-1"],
    });
    expect(revised.outcome).toBe("revised");
    if (revised.outcome !== "revised") throw new Error("unreachable");
    expect(revised.candidate.version).toBe(2);
    expect(revised.candidate.definition.displayName).toBe("Lab Org Alpha v2");
    expect(revised.candidate.definition.capabilities).toHaveLength(2); // merged, not replaced
    expect(revised.candidate.provenance.lineage).toEqual(["lin-run-1", "lin-run-2", "lin-rev-1"]);

    // The old version is preserved untouched.
    const v1 = await harness.labs.getCandidateVersion(tenantA, candidateId, 1);
    expect(v1.definition.displayName).toBe("Lab Org Alpha");
    await expect(harness.labs.getCandidateVersion(tenantA, candidateId, 99)).rejects.toBeInstanceOf(
      LabNotFoundError,
    );
  });

  test("a partial run candidate is ingestible (the publication gate refuses it later)", async () => {
    const harness = createHarness();
    const lab = await harness.labs.createLab(tenantA, { name: "Lab" });
    await configureLab(harness.labs, tenantA, lab.labId);
    harness.runFixture.queue({
      status: "completed",
      costUsd: 12,
      candidates: [incompleteCandidatePayload()],
    });
    const outcome = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "search",
      estimatedCostUsd: 10,
    });
    expect(outcome.outcome).toBe("requested");
    if (outcome.outcome !== "requested") throw new Error("unreachable");
    expect(outcome.candidates[0]!.definition.capabilities).toBeUndefined();
    expect(outcome.candidates[0]!.provenance.lineage).toEqual([]);
  });
});

describe("runs and archiving", () => {
  test("lists runs per lab and resolves runs by id", async () => {
    const harness = createHarness();
    const lab = await harness.labs.createLab(tenantA, { name: "Lab" });
    await configureLab(harness.labs, tenantA, lab.labId);
    harness.runFixture.queue({ status: "completed", costUsd: 12, candidates: [] });
    const run = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "simulation",
      estimatedCostUsd: 10,
    });
    if (run.outcome !== "requested") throw new Error("unreachable");
    const listed = await harness.labs.listRuns(tenantA, lab.labId);
    expect(listed.map((r) => r.runId)).toEqual([run.run.runId]);
    const fetched = await harness.labs.getRun(tenantA, run.run.runId);
    expect(fetched.runId).toBe(run.run.runId);
    await expect(harness.labs.getRun(tenantA, "run-404")).rejects.toBeInstanceOf(LabNotFoundError);
  });

  test("archiving closes configuration and run requests (typed refusals)", async () => {
    const harness = createHarness();
    const lab = await harness.labs.createLab(tenantA, { name: "Lab" });
    await configureLab(harness.labs, tenantA, lab.labId);
    const archived = await harness.labs.archiveLab(tenantA, lab.labId);
    expect(archived.status).toBe("archived");
    // Idempotent.
    expect((await harness.labs.archiveLab(tenantA, lab.labId)).status).toBe("archived");

    const selection = await harness.labs.chooseDomainAndTask(tenantA, lab.labId, {
      domainPackId: "football",
      task: "match",
    });
    expect(selection.outcome).toBe("refused");
    const budget = await harness.labs.setBudget(tenantA, lab.labId, { totalUsd: 10 });
    expect(budget.outcome).toBe("refused");
    const run = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "search",
      estimatedCostUsd: 1,
    });
    expect(run.outcome).toBe("refused");
    if (run.outcome !== "refused") throw new Error("unreachable");
    expect(run.reason).toBe("lab-archived");
  });

  test("a malformed caller tenant is refused before any state is touched", async () => {
    const labs = createUserLabs({
      domainCatalog: fixtureDomainCatalog(),
      sourceData: createFixtureSourceDataPort().port,
      runPort: createScriptedRunPort().port,
    });
    await expect(labs.createLab({ tenantId: "" }, { name: "Lab" })).rejects.toBeInstanceOf(
      LabValidationError,
    );
  });

  test("tenant B never sees tenant A's labs in a listing", async () => {
    const harness = createHarness();
    await harness.labs.createLab(tenantA, { name: "A's Lab" });
    await harness.labs.createLab(tenantB, { name: "B's Lab" });
    expect((await harness.labs.listLabs(tenantA)).map((l) => l.name)).toEqual(["A's Lab"]);
    expect((await harness.labs.listLabs(tenantB)).map((l) => l.name)).toEqual(["B's Lab"]);
    // (cross-tenant direct reads are the isolation suite's subject)
    await expect(harness.labs.getLab(tenantB, "lab-1")).rejects.toBeInstanceOf(LabIsolationError);
  });
});
