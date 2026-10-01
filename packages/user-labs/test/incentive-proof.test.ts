/**
 * REL-034 — the USER-LAB INCENTIVE PROOF BATTERY.
 *
 * Proves the delivered user-labs surface end to end, at acceptance grade,
 * against the frozen laws:
 *
 * - REL-A6 (docs/testing/reality-engineering-lab-acceptance.md): a user can
 *   create a lab -> choose a domain/task -> select source data -> set a
 *   budget -> run simulation/search -> inspect candidates -> keep private or
 *   publish -> request promotion — and the INCENTIVE POLICY IS VISIBLE at
 *   the choice points (the "see incentive policy" clause), through the new
 *   `incentivePolicyView` read model (src/incentives/accrual.ts).
 * - Honest enforcement (docs/contracts/organization-registry-and-promotion.md
 *   §Incentive policy, FROZEN): publication accrues incentives EXACTLY per
 *   the recorded policy — the ledger's arithmetic hand-checked entry by
 *   entry on a fixed journey, across a policy-version boundary — and every
 *   off-policy attempt (wrong actor, double-claim, revoked publication,
 *   incomplete exchange eligibility) refuses TYPED and RECORDED, never
 *   silently adjusted.
 * - The publication -> exchange boundary: a published organization that
 *   fails exchange eligibility (incomplete evidence, wrong state) refuses
 *   typed, and the incentive ledger reflects only eligible publications.
 *
 * Everything is deterministic: the harness clock is mutable and every id
 * source is sequential, so identical journeys produce identical
 * publications, ledger entries and accrual attempts — asserted directly.
 */
import { describe, expect, test } from "bun:test";
import {
  DAY_MS,
  TEST_EPOCH_MS,
  createHarness,
  ledgerForLab,
  policyStoreWithV1,
  policyV1,
  policyV2,
  tenantA,
  tenantB,
} from "./fixtures";
import {
  LabIsolationError,
  LabNotFoundError,
  createPublicationIncentiveAccrual,
  exportPublication,
  importOrganization,
  incentivePolicyView,
  requestPublication,
  requestPublicationPromotion,
  toIsoUtc,
  withdrawPublication,
} from "../src";
import type {
  AccrualOutcome,
  IncentiveLedger,
  IncentivePolicyStore,
  IncentivePolicyView,
  PublicationIncentiveAccrual,
  PublishedOrganization,
} from "../src";
import { LabInternalError as LabInternalErrorClass } from "../src";
import type { Harness } from "./fixtures";
import type {
  BenchmarkEvidenceSummary,
  LabRunCandidatePayload,
  SecurityPolicyEvidenceSummary,
  TenantRef,
} from "../src";

// ---------------------------------------------------------------------------
// The journey's two candidates (complete + exchange-ineligible)
// ---------------------------------------------------------------------------

function proofBenchmarkEvidence(): BenchmarkEvidenceSummary {
  return {
    corpusVersion: "corpus-proof-1",
    evaluatorVersion: "eval-proof-1",
    metrics: [
      { axis: "fidelity", value: 8.4 },
      { axis: "stylization", value: 8.0 },
    ],
    uncertainty: [
      { axis: "fidelity", ciLow: 8.0, ciHigh: 8.8 },
      { axis: "stylization", ciLow: 7.6, ciHigh: 8.4 },
    ],
    artifactRefs: ["art-proof-bench-1"],
  };
}

function proofSecurityEvidence(): SecurityPolicyEvidenceSummary {
  return {
    policyVersion: "sec-proof-1",
    checks: [
      { checkId: "content-policy", passed: true },
      { checkId: "secret-scan", passed: true },
    ],
    artifactRefs: ["art-proof-sec-1"],
  };
}

function proofRightsRequirements() {
  return [
    {
      requirementId: "rr-proof-1",
      description: "licensed proof footage only",
      scope: "source-media",
    },
  ];
}

/** Candidate 1: COMPLETE — publishes, passes exchange eligibility, accrues. */
function completeProofPayload(): LabRunCandidatePayload {
  return {
    definition: {
      organizationId: "proof-org-one",
      displayName: "Proof Org One",
      domain: {
        domains: ["football"],
        eventTypes: ["match"],
        modes: ["batch"],
        renderers: ["anime"],
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
      benchmark: proofBenchmarkEvidence(),
      securityPolicy: proofSecurityEvidence(),
    },
    provenance: {
      lineage: ["lin-proof-run-1", "lin-proof-run-2"],
      rightsRequirements: proofRightsRequirements(),
    },
  };
}

/**
 * Candidate 2: complete definition but NO security/policy evidence — it
 * publishes (evidence is optional at the publication gate) yet FAILS the
 * exchange boundary's eligibility re-check (absence of evidence is not a
 * pass) and therefore never accrues.
 */
function exchangeIneligibleProofPayload(): LabRunCandidatePayload {
  return {
    definition: {
      ...completeProofPayload().definition,
      organizationId: "proof-org-raw",
      displayName: "Proof Org Raw",
    },
    evidence: {
      benchmark: proofBenchmarkEvidence(),
    },
    provenance: {
      lineage: ["lin-proof-run-3"],
      rightsRequirements: proofRightsRequirements(),
    },
  };
}

// ---------------------------------------------------------------------------
// The journey scaffolding
// ---------------------------------------------------------------------------

/** The fully wired proof state: lab configured, run done, ledger + accrual ready. */
interface ProofState {
  harness: Harness;
  policies: IncentivePolicyStore;
  labId: string;
  candidateCompleteId: string;
  candidateIneligibleId: string;
  ledger: IncentiveLedger;
  accrual: PublicationIncentiveAccrual;
}

function invariant(condition: unknown, message: string): void {
  if (!condition) {
    throw new LabInternalErrorClass(`fixture invariant broken: ${message}`);
  }
}

/**
 * Runs the REL-A6 spine — create -> domain/task -> sources -> budget ->
 * search -> inspect — producing two private candidates, and wires the
 * per-lab ledger + the publication accrual to the SAME policy store and
 * clock (the wiring contract of src/incentives/accrual.ts).
 */
async function startProofJourney(withV2 = true): Promise<ProofState> {
  const harness = createHarness();
  const policies = policyStoreWithV1();
  if (withV2) {
    await policies.addPolicy(policyV2());
  }
  const lab = await harness.labs.createLab(tenantA, { name: "Incentive Proof Lab" });
  const domain = await harness.labs.chooseDomainAndTask(tenantA, lab.labId, {
    domainPackId: "football",
    task: "match",
  });
  invariant(domain.outcome === "selected", "domain selection refused");
  const sources = await harness.labs.selectSourceData(tenantA, lab.labId, [
    "src-licensed-1",
    "src-licensed-2",
  ]);
  invariant(sources.outcome === "selected", "source selection refused");
  const budget = await harness.labs.setBudget(tenantA, lab.labId, { totalUsd: 100 });
  invariant(budget.outcome === "set", "budget refused");
  harness.runFixture.queue({
    status: "completed",
    costUsd: 12,
    candidates: [completeProofPayload(), exchangeIneligibleProofPayload()],
  });
  const run = await harness.labs.requestRun(tenantA, lab.labId, {
    purpose: "search",
    estimatedCostUsd: 10,
    configuration: { seed: "seed-proof-7", iterations: 8 },
  });
  if (run.outcome !== "requested") {
    throw new LabInternalErrorClass("fixture invariant broken: run refused");
  }
  invariant(run.candidates.length === 2, "expected two ingested candidates");
  const ledger = ledgerForLab(harness, lab.labId, policies, tenantA);
  const accrual = createPublicationIncentiveAccrual({
    ledger,
    policies,
    exchange: harness.exchange,
    clock: harness.clockFixture.clock,
  });
  return {
    harness,
    policies,
    labId: lab.labId,
    candidateCompleteId: run.candidates[0]!.candidateId,
    candidateIneligibleId: run.candidates[1]!.candidateId,
    ledger,
    accrual,
  };
}

/**
 * Publishes a candidate UNDER THE POLICY VIEW in force at this choice point
 * — the disclosure recorded with the publication is the policy's own.
 */
async function publishUnderView(
  state: ProofState,
  caller: TenantRef,
  candidateId: string,
): Promise<{ publication: PublishedOrganization; view: IncentivePolicyView }> {
  const view = await incentivePolicyView(
    state.policies,
    toIsoUtc(state.harness.clockFixture.nowMs()),
  );
  const outcome = await requestPublication(state.harness.exchange, state.harness.labs, caller, {
    candidateId,
    disclosure: { policyVersion: view.policyVersion, text: view.disclosureText },
  });
  if (outcome.outcome !== "published") {
    throw new LabInternalErrorClass("fixture invariant broken: publication refused");
  }
  return { publication: outcome.publication, view };
}

function accrued(outcome: AccrualOutcome): string {
  expect(outcome.outcome).toBe("accrued");
  if (outcome.outcome !== "accrued") throw new Error("unreachable: not accrued");
  return outcome.publicationId;
}

function refusedAccrual(outcome: AccrualOutcome): Exclude<AccrualOutcome, { outcome: "accrued" }> {
  expect(outcome.outcome).toBe("refused");
  if (outcome.outcome !== "refused") throw new Error("unreachable: not refused");
  return outcome;
}

// ---------------------------------------------------------------------------
// 1 — the REL-A6 spine, with the incentive policy visible at the choice points
// ---------------------------------------------------------------------------

describe("REL-034: the user-lab journey (create -> ... -> publish), policy visible", () => {
  test("every REL-A6 step is selectable, fail-closed where it must be, and the policy is visible", async () => {
    const harness = createHarness();
    const policies = policyStoreWithV1();

    // CHOICE POINT (before anything): the policy in force is visible.
    const view = await incentivePolicyView(policies, toIsoUtc(harness.clockFixture.nowMs()));
    expect(view.policyVersion).toBe(1);
    expect(view.policyId).toBe("user-lab-incentives");
    expect(view.benefits.privateUseWindowDays).toBe(90);
    expect(view.benefits.capabilityCredits).toEqual({ creditsPerGrant: 100, planGoverned: true });
    expect(view.benefits.discoveryBoost).toEqual({
      disclosed: true,
      description: "featured placement in the organization directory for 14 days",
    });
    expect(view.disclosureText).toBe(policyV1().disclosureText);

    // Fail closed: before v1 is in force there is NO policy to show.
    await expect(incentivePolicyView(policies, toIsoUtc(TEST_EPOCH_MS - 1))).rejects.toBeInstanceOf(
      LabNotFoundError,
    );

    // create
    const lab = await harness.labs.createLab(tenantA, { name: "Incentive Proof Lab" });
    expect(lab.status).toBe("active");
    expect(lab.selection).toBeNull();

    // domain/task (unknown selections refuse typed)
    const domain = await harness.labs.chooseDomainAndTask(tenantA, lab.labId, {
      domainPackId: "football",
      task: "match",
    });
    expect(domain.outcome).toBe("selected");
    const unknownDomain = await harness.labs.chooseDomainAndTask(tenantA, lab.labId, {
      domainPackId: "esports",
      task: "match",
    });
    expect(unknownDomain.outcome).toBe("refused");
    if (unknownDomain.outcome === "refused") {
      expect(unknownDomain.reason).toBe("unknown-domain");
    }

    // sources (rights-verified only — an unverified basis refuses typed)
    const sources = await harness.labs.selectSourceData(tenantA, lab.labId, [
      "src-licensed-1",
      "src-licensed-2",
    ]);
    expect(sources.outcome).toBe("selected");
    const unverified = await harness.labs.selectSourceData(tenantA, lab.labId, [
      "src-unverified-1",
    ]);
    expect(unverified.outcome).toBe("refused");
    if (unverified.outcome === "refused") {
      expect(unverified.reason).toBe("missing-source-basis");
      expect(unverified.unverifiedRefs).toEqual(["src-unverified-1"]);
    }

    // budget
    const budget = await harness.labs.setBudget(tenantA, lab.labId, { totalUsd: 100 });
    expect(budget.outcome).toBe("set");

    // simulation/search
    harness.runFixture.queue({
      status: "completed",
      costUsd: 12,
      candidates: [completeProofPayload(), exchangeIneligibleProofPayload()],
    });
    const run = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "search",
      estimatedCostUsd: 10,
      configuration: { seed: "seed-proof-7", iterations: 8 },
    });
    expect(run.outcome).toBe("requested");
    if (run.outcome !== "requested") throw new Error("unreachable: not requested");
    expect(run.run.status).toBe("completed");
    expect(run.candidates.length).toBe(2);

    // inspect: candidates are PRIVATE by default and stay private here.
    const candidates = await harness.labs.listCandidates(tenantA, lab.labId);
    expect(candidates.length).toBe(2);
    expect(candidates.every((candidate) => candidate.visibility === "private")).toBe(true);
    const labAfter = await harness.labs.getLab(tenantA, lab.labId);
    expect(labAfter.spentUsd).toBe(12);

    // the budget gate: an estimate beyond the remaining budget refuses typed
    harness.runFixture.queue({ status: "completed", costUsd: 1, candidates: [] });
    const overBudget = await harness.labs.requestRun(tenantA, lab.labId, {
      purpose: "simulation",
      estimatedCostUsd: 10_000,
    });
    expect(overBudget.outcome).toBe("refused");
    if (overBudget.outcome === "refused") {
      expect(overBudget.reason).toBe("budget-exceeded");
    }
  });

  test("keep private or publish: the disclosure recorded is the policy in force; private stays private", async () => {
    const state = await startProofJourney(false);

    // CHOICE POINT (keep-private-vs-publish): the view drives the disclosure.
    const { publication, view } = await publishUnderView(state, tenantA, state.candidateCompleteId);
    expect(publication.status).toBe("published");
    expect(publication.disclosure).toEqual({
      policyVersion: view.policyVersion,
      text: view.disclosureText,
    });
    expect(publication.disclosure.policyVersion).toBe(1);
    expect(publication.source.candidateId).toBe(state.candidateCompleteId);
    expect(publication.snapshot.evidence.securityPolicy).toBeDefined();

    // The other candidate stays PRIVATE: absent from the exchange, present
    // in the owning tenant's private store only.
    const publications = await state.harness.exchange.listPublications();
    expect(publications.length).toBe(1);
    const privateCandidates = await state.harness.labs.listCandidates(tenantA, state.labId);
    expect(privateCandidates.map((c) => c.candidateId).sort()).toEqual(
      [state.candidateCompleteId, state.candidateIneligibleId].sort(),
    );
    // A cross-tenant read of the private candidate is the typed isolation refusal.
    await expect(
      state.harness.labs.getCandidate(tenantB, state.candidateIneligibleId),
    ).rejects.toBeInstanceOf(LabIsolationError);
  });
});

// ---------------------------------------------------------------------------
// 2 — honest enforcement: the accrual's arithmetic, hand-checked
// ---------------------------------------------------------------------------

describe("REL-034: publication accrues exactly the on-policy incentives", () => {
  test("the fixed journey's ledger, entry by entry, against the recorded policy", async () => {
    const state = await startProofJourney(false);
    const { publication } = await publishUnderView(state, tenantA, state.candidateCompleteId);

    const outcome = await state.accrual.accrue(tenantA, {
      publicationId: publication.publicationId,
    });
    expect(outcome.outcome).toBe("accrued");
    if (outcome.outcome !== "accrued") throw new Error("unreachable: not accrued");
    expect(outcome.policyVersion).toBe(1);
    expect(outcome.benefits.map((b) => `${b.benefit}:${b.outcome}`)).toEqual([
      "capability-credits:accrued",
      "discovery-boost:accrued",
      "private-use-window:accrued",
    ]);

    // HAND-CHECKED ARITHMETIC (policy v1: 100 credits / disclosed boost /
    // 90-day window). Exactly three entries, in accrual order:
    const entries = await state.ledger.entries(tenantA);
    expect(entries.length).toBe(3);
    const [credits, boost, window] = entries;
    expect(credits?.kind).toBe("credits-granted");
    if (credits?.kind === "credits-granted") {
      expect(credits.amount).toBe(100); // v1's creditsPerGrant, exactly
      expect(credits.balanceAfter).toBe(100);
      expect(credits.policyVersion).toBe(1);
      expect(credits.note).toContain(publication.publicationId);
    }
    expect(boost?.kind).toBe("discovery-boost");
    if (boost?.kind === "discovery-boost") {
      expect(boost.subject.publicationId).toBe(publication.publicationId);
      expect(boost.disclosureText).toBe(
        "featured placement in the organization directory for 14 days",
      );
      expect(boost.policyVersion).toBe(1);
    }
    expect(window?.kind).toBe("private-window-started");
    if (window?.kind === "private-window-started") {
      expect(window.windowDays).toBe(90); // v1's window, exactly
      expect(window.policyVersion).toBe(1);
      // The expiry arithmetic, hand-checkable: startedAt + 90 days.
      expect(Date.parse(window.expiresAt) - Date.parse(window.startedAt)).toBe(90 * DAY_MS);
    }

    // The balance is the audited sum of the entries.
    expect(await state.ledger.balance(tenantA)).toEqual({
      creditsGranted: 100,
      creditsUsed: 0,
      creditsRemaining: 100,
    });

    // The attempt log records the grant.
    const attempts = await state.accrual.attempts();
    expect(attempts.length).toBe(1);
    expect(attempts[0]?.outcome).toBe("accrued");
    expect(attempts[0]?.policyVersion).toBe(1);
    expect(attempts[0]?.publicationId).toBe(publication.publicationId);

    // The boost wrote exactly ONE ledger entry and nothing else anywhere:
    // quality evidence on the publication is untouched (snapshot deep-equal).
    const after = await state.harness.exchange.getPublication(publication.publicationId);
    expect(after.snapshot.evidence.benchmark).toEqual(proofBenchmarkEvidence());
  });

  test("across the policy-version boundary: v1 then v2, each entry keeps its version; the window refusal is recorded per benefit", async () => {
    const state = await startProofJourney(true);
    // Phase one: publish + accrue under v1 (100 credits, 90-day window).
    const first = await publishUnderView(state, tenantA, state.candidateCompleteId);
    accrued(
      await state.accrual.accrue(tenantA, { publicationId: first.publication.publicationId }),
    );

    // The boundary: v2 is in force from epoch + 5 days.
    state.harness.clockFixture.set(TEST_EPOCH_MS + 5 * DAY_MS + 3_600_000);
    const viewAtBoundary = await incentivePolicyView(
      state.policies,
      toIsoUtc(state.harness.clockFixture.nowMs()),
    );
    expect(viewAtBoundary.policyVersion).toBe(2);
    expect(viewAtBoundary.benefits.capabilityCredits).toEqual({
      creditsPerGrant: 200,
      planGoverned: true,
    });
    expect(viewAtBoundary.benefits.privateUseWindowDays).toBe(180);

    // Revise the candidate (a new immutable version) and publish THAT under v2.
    const revision = await state.harness.labs.reviseCandidate(tenantA, state.candidateCompleteId, {
      lineageAdditions: ["lin-proof-revision-1"],
    });
    expect(revision.outcome).toBe("revised");
    const second = await publishUnderView(state, tenantA, state.candidateCompleteId);
    expect(second.publication.disclosure.policyVersion).toBe(2);
    expect(second.publication.disclosure.text).toBe(policyV2().disclosureText);
    expect(second.publication.source.candidateVersion).toBe(2);

    const outcome = await state.accrual.accrue(tenantA, {
      publicationId: second.publication.publicationId,
    });
    expect(outcome.outcome).toBe("accrued");
    if (outcome.outcome !== "accrued") throw new Error("unreachable: not accrued");
    expect(outcome.policyVersion).toBe(2);
    // The window benefit REFUSES (one window at a time) — typed, recorded
    // per benefit, never silently adjusted; credits + boost still accrue.
    expect(outcome.benefits.map((b) => `${b.benefit}:${b.outcome}`)).toEqual([
      "capability-credits:accrued",
      "discovery-boost:accrued",
      "private-use-window:refused",
    ]);
    const windowBenefit = outcome.benefits.find((b) => b.benefit === "private-use-window");
    expect(windowBenefit?.reason).toBe("window-already-active");

    // HAND-CHECKED ARITHMETIC across the boundary: 100 (v1) + 200 (v2) = 300.
    const entries = await state.ledger.entries(tenantA);
    expect(entries.length).toBe(5); // 3 from v1 + credits + boost from v2
    const v2Credits = entries[3];
    expect(v2Credits?.kind).toBe("credits-granted");
    if (v2Credits?.kind === "credits-granted") {
      expect(v2Credits.amount).toBe(200); // v2's creditsPerGrant, exactly
      expect(v2Credits.balanceAfter).toBe(300);
      expect(v2Credits.policyVersion).toBe(2);
    }
    const v2Boost = entries[4];
    expect(v2Boost?.kind).toBe("discovery-boost");
    if (v2Boost?.kind === "discovery-boost") {
      expect(v2Boost.subject.publicationId).toBe(second.publication.publicationId);
      expect(v2Boost.disclosureText).toBe(
        "featured placement in the organization directory for 30 days",
      );
      expect(v2Boost.policyVersion).toBe(2);
    }
    expect(await state.ledger.balance(tenantA)).toEqual({
      creditsGranted: 300,
      creditsUsed: 0,
      creditsRemaining: 300,
    });

    // No v1 entry was rewritten by the v2 policy (prospective semantics).
    expect(entries[0]?.policyVersion).toBe(1);
    expect(entries[1]?.policyVersion).toBe(1);
    expect(entries[2]?.policyVersion).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3 — every off-policy accrual attempt refuses TYPED and RECORDED
// ---------------------------------------------------------------------------

describe("REL-034: off-policy accrual attempts refuse typed and are recorded", () => {
  test("double claim: a second accrual of the same publication refuses, the ledger untouched", async () => {
    const state = await startProofJourney(false);
    const { publication } = await publishUnderView(state, tenantA, state.candidateCompleteId);
    accrued(await state.accrual.accrue(tenantA, { publicationId: publication.publicationId }));

    const entriesBefore = await state.ledger.entries(tenantA);
    const balanceBefore = await state.ledger.balance(tenantA);

    const refusal = refusedAccrual(
      await state.accrual.accrue(tenantA, { publicationId: publication.publicationId }),
    );
    expect(refusal.reason).toBe("already-accrued");
    expect(refusal.message).toContain("hidden reward");

    // Never silently adjusted: the ledger is byte-identical.
    expect(await state.ledger.entries(tenantA)).toEqual(entriesBefore);
    expect(await state.ledger.balance(tenantA)).toEqual(balanceBefore);

    // ... and the attempt is recorded.
    const attempts = await state.accrual.attempts();
    expect(attempts.length).toBe(2);
    expect(attempts[1]?.outcome).toBe("refused");
    expect(attempts[1]?.reason).toBe("already-accrued");
    expect(attempts[1]?.caller).toEqual(tenantA);
  });

  test("wrong actor: another tenant's accrual attempt is a typed, recorded refusal — not a throw, not a grant", async () => {
    const state = await startProofJourney(false);
    const { publication } = await publishUnderView(state, tenantA, state.candidateCompleteId);
    accrued(await state.accrual.accrue(tenantA, { publicationId: publication.publicationId }));
    const entriesBefore = await state.ledger.entries(tenantA);

    const refusal = refusedAccrual(
      await state.accrual.accrue(tenantB, { publicationId: publication.publicationId }),
    );
    expect(refusal.reason).toBe("wrong-actor");
    expect(refusal.message).toContain("tenant-b");
    expect(refusal.message).toContain("tenant-a");

    // The wrong actor is recorded AS ITSELF, and the ledger is untouched.
    const attempts = await state.accrual.attempts();
    expect(attempts.length).toBe(2);
    expect(attempts[1]?.caller).toEqual(tenantB);
    expect(attempts[1]?.reason).toBe("wrong-actor");
    expect(await state.ledger.entries(tenantA)).toEqual(entriesBefore);
    expect((await state.ledger.balance(tenantA)).creditsRemaining).toBe(100);
  });

  test("revoked publication: a withdrawn publication's accrual refuses typed", async () => {
    const state = await startProofJourney(false);
    const { publication } = await publishUnderView(state, tenantA, state.candidateCompleteId);
    accrued(await state.accrual.accrue(tenantA, { publicationId: publication.publicationId }));
    const entriesBefore = await state.ledger.entries(tenantA);

    // Withdraw, then attempt to accrue the REVOKED publication.
    const withdrawn = await withdrawPublication(
      state.harness.exchange,
      tenantA,
      publication.publicationId,
    );
    expect(withdrawn.status).toBe("withdrawn");
    const refusal = refusedAccrual(
      await state.accrual.accrue(tenantA, { publicationId: publication.publicationId }),
    );
    // The double-claim guard fires first for an ALREADY-accrued publication;
    // the revoked shape needs its own never-accrued publication (below).
    expect(refusal.reason).toBe("already-accrued");

    // The clean revoked shape: publish the ineligible candidate, withdraw
    // BEFORE any accrual, then attempt.
    const second = await publishUnderView(state, tenantA, state.candidateIneligibleId);
    await withdrawPublication(state.harness.exchange, tenantA, second.publication.publicationId);
    const revokedRefusal = refusedAccrual(
      await state.accrual.accrue(tenantA, { publicationId: second.publication.publicationId }),
    );
    expect(revokedRefusal.reason).toBe("publication-withdrawn");
    expect(revokedRefusal.message).toContain("withdrawn");
    expect(await state.ledger.entries(tenantA)).toEqual(entriesBefore);
  });

  test("incomplete exchange eligibility: a publication without security evidence never accrues", async () => {
    const state = await startProofJourney(false);
    const { publication } = await publishUnderView(state, tenantA, state.candidateIneligibleId);
    // It published (evidence is optional at the publication gate)...
    expect(publication.status).toBe("published");
    // ...but it is NOT eligible at the exchange boundary, so it never accrues.
    const refusal = refusedAccrual(
      await state.accrual.accrue(tenantA, { publicationId: publication.publicationId }),
    );
    expect(refusal.reason).toBe("evidence-ineligible");
    expect(refusal.gaps).toEqual([
      "evidence: no security/policy evidence on the publication — absence of evidence is not a pass",
    ]);
    // The ledger reflects only eligible publications: NOTHING was written.
    expect(await state.ledger.entries(tenantA)).toEqual([]);
    expect(await state.ledger.balance(tenantA)).toEqual({
      creditsGranted: 0,
      creditsUsed: 0,
      creditsRemaining: 0,
    });
    const attempts = await state.accrual.attempts();
    expect(attempts.length).toBe(1);
    expect(attempts[0]?.reason).toBe("evidence-ineligible");
  });
});

// ---------------------------------------------------------------------------
// 4 — the publication -> exchange boundary
// ---------------------------------------------------------------------------

describe("REL-034: the exchange boundary refuses typed, the ledger reflects only eligible publications", () => {
  test("complete evidence flows: export verifies, import grants a registry-compatible record", async () => {
    const state = await startProofJourney(false);
    const { publication } = await publishUnderView(state, tenantA, state.candidateCompleteId);

    const exportOutcome = await exportPublication(state.harness.exchange, tenantB, {
      publicationId: publication.publicationId,
    });
    expect(exportOutcome.outcome).toBe("exported");
    if (exportOutcome.outcome !== "exported") throw new Error("unreachable: not exported");
    expect(exportOutcome.bundle.organization.organizationId).toBe("proof-org-one");
    expect(exportOutcome.bundle.organization.securityPolicyEvidence).not.toBeNull();

    const importOutcome = await importOrganization(
      { tenant: tenantB, satisfiedRightsRequirements: ["rr-proof-1"] },
      exportOutcome.bundle,
    );
    expect(importOutcome.outcome).toBe("imported");
    if (importOutcome.outcome !== "imported") throw new Error("unreachable: not imported");
    expect(importOutcome.record.organizationId).toBe("proof-org-one");
    expect(importOutcome.record.provenance.createdFrom).toEqual({
      labRunId: publication.snapshot.provenance.runId,
    });
  });

  test("incomplete evidence refuses typed at import (absence of evidence is not a pass)", async () => {
    const state = await startProofJourney(false);
    const { publication } = await publishUnderView(state, tenantA, state.candidateIneligibleId);

    const exportOutcome = await exportPublication(state.harness.exchange, tenantB, {
      publicationId: publication.publicationId,
    });
    expect(exportOutcome.outcome).toBe("exported");
    if (exportOutcome.outcome !== "exported") throw new Error("unreachable: not exported");
    expect(exportOutcome.bundle.organization.securityPolicyEvidence).toBeNull();

    const importOutcome = await importOrganization(
      { tenant: tenantB, satisfiedRightsRequirements: ["rr-proof-1"] },
      exportOutcome.bundle,
    );
    expect(importOutcome.outcome).toBe("refused");
    if (importOutcome.outcome !== "refused") throw new Error("unreachable: not refused");
    expect(importOutcome.reason).toBe("security-policy-failed");
    expect(importOutcome.message).toContain("absence of evidence is not a pass");
  });

  test("unsatisfiable dependency and wrong state refuse typed", async () => {
    const state = await startProofJourney(false);
    const eligible = await publishUnderView(state, tenantA, state.candidateCompleteId);
    const ineligible = await publishUnderView(state, tenantA, state.candidateIneligibleId);

    // Unsatisfiable rights dependency at import time.
    const exportOutcome = await exportPublication(state.harness.exchange, tenantB, {
      publicationId: eligible.publication.publicationId,
    });
    if (exportOutcome.outcome !== "exported") throw new Error("unreachable: not exported");
    const refusedDependency = await importOrganization(
      { tenant: tenantB, satisfiedRightsRequirements: [] },
      exportOutcome.bundle,
    );
    expect(refusedDependency.outcome).toBe("refused");
    if (refusedDependency.outcome !== "refused") throw new Error("unreachable: not refused");
    expect(refusedDependency.reason).toBe("unsatisfiable-dependency");
    expect(refusedDependency.missing).toEqual(["rr-proof-1"]);

    // Wrong state: withdrawal preserves lineage but closes the exchange path.
    await withdrawPublication(
      state.harness.exchange,
      tenantA,
      ineligible.publication.publicationId,
    );
    const refusedExport = await exportPublication(state.harness.exchange, tenantB, {
      publicationId: ineligible.publication.publicationId,
    });
    expect(refusedExport.outcome).toBe("refused");
    if (refusedExport.outcome !== "refused") throw new Error("unreachable: not refused");
    expect(refusedExport.reason).toBe("publication-withdrawn");

    // The withdrawn publication is still READABLE (lineage preserved)...
    const readable = await state.harness.exchange.getPublication(
      ineligible.publication.publicationId,
    );
    expect(readable.status).toBe("withdrawn");
    expect(readable.snapshot.organizationId).toBe("proof-org-raw");
    // ...and the active exchange surface excludes it.
    const active = await state.harness.exchange.listActivePublications();
    expect(active.map((p) => p.publicationId)).toEqual([eligible.publication.publicationId]);
  });
});

// ---------------------------------------------------------------------------
// 5 — promotion REQUESTS (A6's last step) + whole-journey determinism
// ---------------------------------------------------------------------------

describe("REL-034: promotion requests and the deterministic journey", () => {
  test("the lab can REQUEST promotion — a request, nothing more; duplicates and cross-tenant attempts refuse", async () => {
    const state = await startProofJourney(false);
    const { publication } = await publishUnderView(state, tenantA, state.candidateCompleteId);
    accrued(await state.accrual.accrue(tenantA, { publicationId: publication.publicationId }));

    const request = await requestPublicationPromotion(state.harness.exchange, tenantA, {
      publicationId: publication.publicationId,
    });
    expect(request.outcome).toBe("requested");
    if (request.outcome !== "requested") throw new Error("unreachable: not requested");
    expect(request.request.status).toBe("requested");
    // REQUEST ONLY: there is no decision on the record, ever.
    const keys = Object.keys(request.request);
    expect(keys.includes("decision")).toBe(false);
    expect(keys.includes("granted")).toBe(false);
    expect(keys.includes("outcome")).toBe(false);

    // Duplicate active requests refuse instead of double-queueing.
    const duplicate = await requestPublicationPromotion(state.harness.exchange, tenantA, {
      publicationId: publication.publicationId,
    });
    expect(duplicate.outcome).toBe("refused");
    if (duplicate.outcome === "refused") {
      expect(duplicate.reason).toBe("already-requested");
    }

    // Cross-tenant promotion requests are the typed isolation refusal.
    await expect(
      requestPublicationPromotion(state.harness.exchange, tenantB, {
        publicationId: publication.publicationId,
      }),
    ).rejects.toBeInstanceOf(LabIsolationError);
  });

  test("the whole fixed journey is deterministic: identical runs, identical publications, ledger and attempts", async () => {
    async function journeyDigest() {
      const state = await startProofJourney(true);
      const first = await publishUnderView(state, tenantA, state.candidateCompleteId);
      accrued(
        await state.accrual.accrue(tenantA, { publicationId: first.publication.publicationId }),
      );
      // double claim
      await state.accrual.accrue(tenantA, { publicationId: first.publication.publicationId });
      // wrong actor
      await state.accrual.accrue(tenantB, { publicationId: first.publication.publicationId });
      // ineligible publication + accrual attempt
      const second = await publishUnderView(state, tenantA, state.candidateIneligibleId);
      await state.accrual.accrue(tenantA, { publicationId: second.publication.publicationId });
      // the v2 boundary: revise, publish, accrue
      state.harness.clockFixture.set(TEST_EPOCH_MS + 5 * DAY_MS + 3_600_000);
      await state.harness.labs.reviseCandidate(tenantA, state.candidateCompleteId, {
        lineageAdditions: ["lin-proof-revision-1"],
      });
      const third = await publishUnderView(state, tenantA, state.candidateCompleteId);
      await state.accrual.accrue(tenantA, { publicationId: third.publication.publicationId });
      return {
        publications: await state.harness.exchange.listPublications(),
        ledgerEntries: await state.ledger.entries(tenantA),
        balance: await state.ledger.balance(tenantA),
        attempts: await state.accrual.attempts(),
      };
    }
    const first = await journeyDigest();
    const second = await journeyDigest();
    expect(first.ledgerEntries.length).toBe(5);
    expect(first.balance.creditsRemaining).toBe(300);
    expect(first.attempts.length).toBe(5); // 2 granted + 3 refused
    expect(second.publications).toEqual(first.publications);
    expect(second.ledgerEntries).toEqual(first.ledgerEntries);
    expect(second.balance).toEqual(first.balance);
    expect(second.attempts).toEqual(first.attempts);
  });
});
