/**
 * The incentive policy + ledger (REL-021):
 * - versioned, displayed-to-user policy; fail-closed registration (window
 *   <= six months, boosts MUST be disclosed, monotonic versions);
 * - PROSPECTIVE application: entries keep the policy version they were
 *   recorded under — a new version never rewrites history;
 * - the auditable ledger: credits granted/used, private-use window
 *   start/expiry, discovery boosts;
 * - THE INVARIANT: boosts are explicit, auditable events (policy version +
 *   human-visible disclosure on the entry) and quality evidence records are
 *   UNCHANGED by boosts.
 */
import { describe, expect, test } from "bun:test";
import { requestPublication } from "../src";
import {
  LabConflictError,
  LabNotFoundError,
  LabValidationError,
  createIncentivePolicyStore,
} from "../src";
import type { IncentiveLedgerEntry } from "../src";
import {
  DAY_MS,
  TEST_EPOCH_MS,
  createLabWithCandidate,
  createHarness,
  ledgerForLab,
  policyStoreWithV1,
  policyV1,
  policyV2,
  tenantA,
} from "./fixtures";
import { toIsoUtc } from "../src";

// ---------------------------------------------------------------------------
// The versioned policy
// ---------------------------------------------------------------------------

describe("the incentive policy store", () => {
  test("registers a valid versioned policy carrying the displayed disclosure", async () => {
    const policies = createIncentivePolicyStore();
    const policy = await policies.addPolicy(policyV1());
    expect(policy.version).toBe(1);
    expect(policy.benefits.privateUseWindowDays).toBe(90);
    expect(policy.benefits.discoveryBoost?.disclosed).toBe(true);
    expect(policy.benefits.capabilityCredits).toEqual({ creditsPerGrant: 100, planGoverned: true });
    expect(policy.disclosureText).toContain("90 days"); // displayed to the user
    expect(Object.isFrozen(policy)).toBe(true);
  });

  test("refuses a private-use window longer than six months (fail closed)", async () => {
    const policies = createIncentivePolicyStore();
    const tooLong = {
      ...policyV1(),
      benefits: { ...policyV1().benefits, privateUseWindowDays: 181 },
    };
    try {
      await policies.addPolicy(tooLong);
      throw new Error("expected a typed validation refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(LabValidationError);
      const validation = error as LabValidationError;
      expect(JSON.stringify(validation.details)).toContain("180");
    }
  });

  test("cannot even express an undisclosed boost (schema-level refusal)", async () => {
    const policies = createIncentivePolicyStore();
    const undisclosed = {
      ...policyV1(),
      benefits: {
        ...policyV1().benefits,
        discoveryBoost: { disclosed: false, description: "shadow boost" },
      },
    };
    await expect(policies.addPolicy(undisclosed)).rejects.toBeInstanceOf(LabValidationError);
  });

  test("refuses non-monotonic versions and out-of-order effective dates", async () => {
    const policies = createIncentivePolicyStore();
    await policies.addPolicy(policyV1());
    await expect(policies.addPolicy(policyV1())).rejects.toBeInstanceOf(LabConflictError); // same version
    const stale = { ...policyV2(), effectiveFrom: toIsoUtc(TEST_EPOCH_MS - DAY_MS) };
    await expect(policies.addPolicy(stale)).rejects.toBeInstanceOf(LabValidationError);
  });

  test("resolves the active policy prospectively (latest effectiveFrom <= when)", async () => {
    const policies = createIncentivePolicyStore();
    await policies.addPolicy(policyV1());
    await policies.addPolicy(policyV2());
    expect((await policies.activePolicyAt(toIsoUtc(TEST_EPOCH_MS))).version).toBe(1);
    expect((await policies.activePolicyAt(toIsoUtc(TEST_EPOCH_MS + DAY_MS))).version).toBe(1);
    expect((await policies.activePolicyAt(toIsoUtc(TEST_EPOCH_MS + 5 * DAY_MS))).version).toBe(2);
    expect((await policies.activePolicyAt(toIsoUtc(TEST_EPOCH_MS + 30 * DAY_MS))).version).toBe(2);
    await expect(policies.getPolicy(99)).rejects.toBeInstanceOf(LabNotFoundError);
  });

  test("fails closed when no policy is in force yet", async () => {
    const policies = createIncentivePolicyStore();
    await expect(policies.activePolicyAt(toIsoUtc(TEST_EPOCH_MS))).rejects.toBeInstanceOf(
      LabNotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

describe("credits", () => {
  test("grants the on-policy amount and audits the running balance", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const ledger = ledgerForLab(harness, labId, policyStoreWithV1());
    const grant = await ledger.grantCredits(tenantA, { amount: 100 });
    expect(grant.outcome).toBe("recorded");
    const use = await ledger.useCredits(tenantA, { amount: 30, purpose: "extra compute" });
    expect(use.outcome).toBe("recorded");
    const balance = await ledger.balance(tenantA);
    expect(balance).toEqual({ creditsGranted: 100, creditsUsed: 30, creditsRemaining: 70 });
  });

  test("refuses off-policy amounts — incentives are policy-governed, never improvised", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const ledger = ledgerForLab(harness, labId, policyStoreWithV1());
    const refused = await ledger.grantCredits(tenantA, { amount: 50 });
    expect(refused.outcome).toBe("refused");
    if (refused.outcome !== "refused") throw new Error("unreachable");
    expect(refused.reason).toBe("off-policy-amount");
    expect(refused.message).toContain("100");
  });

  test("refuses grants when the active policy has no credits benefit", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const policies = createIncentivePolicyStore();
    await policies.addPolicy({
      ...policyV1(),
      benefits: { privateUseWindowDays: 30, discoveryBoost: null, capabilityCredits: null },
    });
    const ledger = ledgerForLab(harness, labId, policies);
    const refused = await ledger.grantCredits(tenantA, { amount: 30 });
    expect(refused.outcome).toBe("refused");
    if (refused.outcome !== "refused") throw new Error("unreachable");
    expect(refused.reason).toBe("no-capability-credits-benefit");
  });

  test("refuses using more credits than the balance holds", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const ledger = ledgerForLab(harness, labId, policyStoreWithV1());
    await ledger.grantCredits(tenantA, { amount: 100 });
    const refused = await ledger.useCredits(tenantA, { amount: 101 });
    expect(refused.outcome).toBe("refused");
    if (refused.outcome !== "refused") throw new Error("unreachable");
    expect(refused.reason).toBe("insufficient-credits");
    expect(refused.message).toContain("101");
    expect(refused.message).toContain("100");
    expect((await ledger.balance(tenantA)).creditsRemaining).toBe(100);
  });
});

describe("the private-use window", () => {
  test("starts under the policy in force, with the computed expiry", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const ledger = ledgerForLab(harness, labId, policyStoreWithV1());
    const started = await ledger.startPrivateUseWindow(tenantA);
    expect(started.outcome).toBe("recorded");
    if (started.outcome !== "recorded") throw new Error("unreachable");
    const entry = started.entry as Extract<
      IncentiveLedgerEntry,
      { kind: "private-window-started" }
    >;
    expect(entry.policyVersion).toBe(1);
    expect(entry.windowDays).toBe(90);
    expect(entry.startedAt).toBe(toIsoUtc(TEST_EPOCH_MS));
    expect(entry.expiresAt).toBe(toIsoUtc(TEST_EPOCH_MS + 90 * DAY_MS));
  });

  test("refuses a second window while one is active; expiry is an auditable event", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const ledger = ledgerForLab(harness, labId, policyStoreWithV1());
    await ledger.startPrivateUseWindow(tenantA);
    const refused = await ledger.startPrivateUseWindow(tenantA);
    expect(refused.outcome).toBe("refused");
    if (refused.outcome !== "refused") throw new Error("unreachable");
    expect(refused.reason).toBe("window-already-active");
    const expired = await ledger.expirePrivateUseWindow(tenantA);
    expect(expired.outcome).toBe("recorded");
    const again = await ledger.expirePrivateUseWindow(tenantA);
    expect(again.outcome).toBe("refused");
    if (again.outcome !== "refused") throw new Error("unreachable");
    expect(again.reason).toBe("no-active-window");
  });

  test("refuses windows when the active policy has no window benefit", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const policies = createIncentivePolicyStore();
    await policies.addPolicy({
      ...policyV1(),
      benefits: { privateUseWindowDays: null, discoveryBoost: null, capabilityCredits: null },
    });
    const ledger = ledgerForLab(harness, labId, policies);
    const refused = await ledger.startPrivateUseWindow(tenantA);
    expect(refused.outcome).toBe("refused");
    if (refused.outcome !== "refused") throw new Error("unreachable");
    expect(refused.reason).toBe("no-private-use-benefit");
  });
});

describe("policy change semantics — prospective only (tested explicitly)", () => {
  test("entries recorded under v1 keep v1 after v2 is in force — no retroactive rewrites", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const policies = policyStoreWithV1();
    const ledger = ledgerForLab(harness, labId, policies);

    // Under v1: 100 credits per grant, 90-day window.
    const underV1 = await ledger.grantCredits(tenantA, { amount: 100 });
    if (underV1.outcome !== "recorded") throw new Error("unreachable: v1 grant refused");
    const windowV1 = await ledger.startPrivateUseWindow(tenantA);
    if (windowV1.outcome !== "recorded") throw new Error("unreachable: v1 window refused");
    await ledger.expirePrivateUseWindow(tenantA);

    // v2 becomes effective 5 days later: 200 credits, 180-day window.
    await policies.addPolicy(policyV2());
    harness.clockFixture.advance(6 * DAY_MS);

    const underV2 = await ledger.grantCredits(tenantA, { amount: 200 });
    if (underV2.outcome !== "recorded") throw new Error("unreachable: v2 grant refused");
    const windowV2 = await ledger.startPrivateUseWindow(tenantA);
    if (windowV2.outcome !== "recorded") throw new Error("unreachable: v2 window refused");

    // The NEW writes use v2's terms...
    expect(underV2.outcome).toBe("recorded");
    if (underV2.outcome !== "recorded") throw new Error("unreachable");
    expect(
      (underV2.entry as Extract<IncentiveLedgerEntry, { kind: "credits-granted" }>).policyVersion,
    ).toBe(2);
    expect(windowV2.outcome).toBe("recorded");
    const w2 = windowV2.entry as Extract<IncentiveLedgerEntry, { kind: "private-window-started" }>;
    expect(w2.policyVersion).toBe(2);
    expect(w2.windowDays).toBe(180);

    // ...and the OLD entries still carry v1, exactly as recorded.
    expect(
      (underV1.entry as Extract<IncentiveLedgerEntry, { kind: "credits-granted" }>).policyVersion,
    ).toBe(1);
    const w1 = windowV1.entry as Extract<IncentiveLedgerEntry, { kind: "private-window-started" }>;
    expect(w1.policyVersion).toBe(1);
    expect(w1.windowDays).toBe(90);
    expect(w1.expiresAt).toBe(toIsoUtc(TEST_EPOCH_MS + 90 * DAY_MS));
  });
});

describe("THE INVARIANT: discovery boosts are explicit, auditable — and never touch quality evidence", () => {
  test("a boost appends exactly one entry referencing the policy version + the human-visible disclosure", async () => {
    const harness = createHarness();
    const { labId, candidateId } = await createLabWithCandidate(harness, tenantA);
    const policies = policyStoreWithV1();
    const ledger = ledgerForLab(harness, labId, policies);
    const published = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "published under the user-lab incentive policy" },
    });
    if (published.outcome !== "published") throw new Error("unreachable");

    const boost = await ledger.recordDiscoveryBoost(tenantA, {
      publicationId: published.publication.publicationId,
    });
    expect(boost.outcome).toBe("recorded");
    if (boost.outcome !== "recorded") throw new Error("unreachable");
    const entry = boost.entry as Extract<IncentiveLedgerEntry, { kind: "discovery-boost" }>;
    expect(entry.kind).toBe("discovery-boost");
    expect(entry.policyVersion).toBe(1); // references the policy version
    expect(entry.disclosureText).toBe(
      "featured placement in the organization directory for 14 days",
    ); // ...and the human-visible disclosure
    expect(entry.subject.publicationId).toBe(published.publication.publicationId);
  });

  test("quality evidence records are UNCHANGED by boosts (deep-equal before/after)", async () => {
    const harness = createHarness();
    const { labId, candidateId } = await createLabWithCandidate(harness, tenantA);
    const ledger = ledgerForLab(harness, labId, policyStoreWithV1());
    const published = await requestPublication(harness.exchange, harness.labs, tenantA, {
      candidateId,
      disclosure: { policyVersion: 1, text: "published under the user-lab incentive policy" },
    });
    if (published.outcome !== "published") throw new Error("unreachable");
    const publicationId = published.publication.publicationId;

    // Snapshot EVERY quality-evidence surface before the boost.
    const evidenceBefore = structuredClone(
      (await harness.exchange.getPublication(publicationId)).snapshot.evidence,
    );
    const candidateBefore = structuredClone(
      (await harness.labs.getCandidate(tenantA, candidateId)).evidence,
    );

    // ...boost (twice, to be sure)...
    await ledger.recordDiscoveryBoost(tenantA, { publicationId });
    await ledger.recordDiscoveryBoost(tenantA, { publicationId, note: "second boost" });

    // ...and snapshot again: NOTHING outside the ledger changed.
    const evidenceAfter = (await harness.exchange.getPublication(publicationId)).snapshot.evidence;
    const candidateAfter = (await harness.labs.getCandidate(tenantA, candidateId)).evidence;
    expect(evidenceAfter).toEqual(evidenceBefore);
    expect(candidateAfter).toEqual(candidateBefore);

    // The ledger itself carries exactly the two explicit boost events.
    const entries = await ledger.entries(tenantA);
    const boosts = entries.filter((e) => e.kind === "discovery-boost");
    expect(boosts).toHaveLength(2);
    expect(entries.map((e) => e.kind)).toEqual(["discovery-boost", "discovery-boost"]);
  });

  test("refuses boosts when the active policy configures none", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const policies = createIncentivePolicyStore();
    await policies.addPolicy({
      ...policyV1(),
      benefits: { privateUseWindowDays: 30, discoveryBoost: null, capabilityCredits: null },
    });
    const ledger = ledgerForLab(harness, labId, policies);
    const refused = await ledger.recordDiscoveryBoost(tenantA, { publicationId: "pub-1" });
    expect(refused.outcome).toBe("refused");
    if (refused.outcome !== "refused") throw new Error("unreachable");
    expect(refused.reason).toBe("no-discovery-boost-benefit");
  });

  test("the ledger fails closed when no policy is in force", async () => {
    const harness = createHarness();
    const { labId } = await createLabWithCandidate(harness, tenantA);
    const ledger = ledgerForLab(harness, labId, createIncentivePolicyStore());
    await expect(ledger.grantCredits(tenantA, { amount: 100 })).rejects.toBeInstanceOf(
      LabNotFoundError,
    );
  });
});
