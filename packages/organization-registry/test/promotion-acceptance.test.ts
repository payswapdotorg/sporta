/**
 * REL-028 — Gate REL-A4 at acceptance grade: the automated
 * promotion/rollback lifecycle END TO END, as ONE deterministic scenario.
 *
 * ```
 * promote (draft -> benchmarked -> validated -> canary -> production,
 *          benchmark evidence + canary records, evidence trail queryable)
 *   -> canary FAILS in production
 *   -> automatic rollback (the demote trigger: the previous status restores)
 *   -> re-promote (canary -> production again)
 *   -> the terminal rollback (a non-demote trigger RETIRES — the
 *      retirement record is written, the lineage survives)
 * ```
 *
 * The acceptance invariants (REL-A4's own words + the registry contract's):
 * - every promotion is the AUTOMATED, policy-versioned decision with the
 *   evidence trail QUERYABLE: gate results, actor, from -> to, timestamps,
 *   the policy named — the whole hash-chained log verifies;
 * - rollback is automatic for CONFIGURED hard SLO/policy failures, the
 *   trigger RECORDED into the transition;
 * - IN-FLIGHT REFERENCES always resolve: every version ever granted is
 *   still readable (lineage preserved), and the LATEST resolves to the
 *   rollback target — never a dangling version;
 * - double-promotion and out-of-order transitions refuse TYPED (returned
 *   refusal records, audited; illegal edges re-checked at the store);
 * - the full cycle is DETERMINISTIC: the same scenario on a fresh registry
 *   produces the identical transition log.
 */
import { describe, expect, test } from "bun:test";
import { requestPromotion, requestRollback } from "../src";
import type {
  OrganizationStatus,
  PromotionGranted,
  PromotionOutcome,
  RollbackGranted,
  RollbackOutcome,
} from "../src";
import { RegistryConflictError } from "../src";
import {
  benchmarkStageEvidence,
  examplePolicy,
  fullEvidence,
  newOrgInput,
  newRegistry,
  validationStageEvidence,
} from "./fixtures";

/** Asserts the outcome is granted and returns its narrowed record. */
function granted(
  outcome: PromotionOutcome,
  from: OrganizationStatus,
  to: OrganizationStatus,
): PromotionGranted {
  if (outcome.outcome !== "granted") {
    throw new Error(`expected a granted promotion ${from} -> ${to}: ${outcome.message}`);
  }
  expect(outcome.fromStatus).toBe(from);
  expect(outcome.toStatus).toBe(to);
  expect(outcome.toVersion).toBeGreaterThan(outcome.fromVersion);
  return outcome;
}

/** Asserts the rollback outcome is granted and returns its narrowed record. */
function rolledBack(
  outcome: RollbackOutcome,
  from: OrganizationStatus,
  to: OrganizationStatus,
): RollbackGranted {
  if (outcome.outcome !== "granted") {
    throw new Error(`expected a granted rollback ${from} -> ${to}: ${outcome.message}`);
  }
  expect(outcome.fromStatus).toBe(from);
  expect(outcome.toStatus).toBe(to);
  return outcome;
}

describe("THE acceptance cycle: promote -> canary-fail -> rollback -> re-promote -> retire", () => {
  test("one deterministic scenario, swept at every transition", async () => {
    const registry = newRegistry();
    const policy = examplePolicy();
    const organizationId = "org-cycle";

    // -- registration ------------------------------------------------------
    await registry.register(newOrgInput({ organizationId, displayName: "The Cycle Org" }), {
      actorType: "system",
      actorId: "test-harness",
    });
    expect((await registry.get(organizationId)).status).toBe("draft");

    // -- the automated promotion walk (benchmark evidence + canary records) --
    const toBenchmarked = granted(
      await requestPromotion(registry, {
        organizationId,
        policy,
        additionalEvidence: benchmarkStageEvidence(),
      }),
      "draft",
      "benchmarked",
    );
    const toValidated = granted(
      await requestPromotion(registry, {
        organizationId,
        policy,
        additionalEvidence: validationStageEvidence(),
      }),
      "benchmarked",
      "validated",
    );
    const toCanary = granted(
      await requestPromotion(registry, { organizationId, policy }),
      "validated",
      "canary",
    );
    const toProduction = granted(
      await requestPromotion(registry, {
        organizationId,
        policy,
        additionalEvidence: { canary: fullEvidence(true, false).canary },
      }),
      "canary",
      "production",
    );
    const productionVersion = toProduction.toVersion;
    void toBenchmarked;
    void toValidated;
    void toCanary; // the walk's granted records, asserted via the log below
    // v1 draft registration; v2 benchmark evidence; v3 -> benchmarked;
    // v4 validation evidence; v5 -> validated; v6 -> canary; v7 canary
    // records; v8 -> production. Every evidence leg is its own audited
    // version — the walk is honest, nothing batch-edited.
    expect(productionVersion).toBe(8);
    // The hash chain verifies across the whole walk.
    expect(await registry.verifyTransitionLog()).toBe(true);

    // -- an in-flight consumer holds the production reference ---------------
    // (a job, a selection, an integration scope — {organizationId, version}.)
    const inFlight = { organizationId, version: productionVersion };
    const heldRecord = await registry.getVersion(inFlight.organizationId, inFlight.version);
    expect(heldRecord.status).toBe("production");

    // -- the canary FAILS in production: the automatic rollback -------------
    const rollback = rolledBack(
      await requestRollback(registry, {
        organizationId,
        trigger: "hard-slo-failure",
        policy,
        note: "production canary: p95 latency SLO violated",
      }),
      "production",
      "canary",
    );
    // The DEMOTE trigger: the previous status restores (production -> canary).
    expect(rollback.fromStatus).toBe("production");
    expect(rollback.toStatus).toBe("canary");
    expect(rollback.trigger).toBe("hard-slo-failure");
    expect(rollback.toVersion).toBeGreaterThan(rollback.fromVersion);
    // THE ROLLBACK TARGET RESOLVES: the latest record is the demoted target.
    const latestAfterRollback = await registry.get(organizationId);
    expect(latestAfterRollback.status).toBe("canary");
    expect(latestAfterRollback.version).toBe(rollback.toVersion);
    // And the in-flight reference STILL resolves (never a dangling version):
    // the production version is preserved history, readable forever.
    const stillHeld = await registry.getVersion(inFlight.organizationId, inFlight.version);
    expect(stillHeld.status).toBe("production");
    // The trigger is RECORDED into the audited transition.
    const rollbackEntry = rollback.transition;
    expect(rollbackEntry.operation).toBe("rollback");
    expect(rollbackEntry.rollbackTrigger).toBe("hard-slo-failure");
    expect(rollbackEntry.refusalReason).toBeUndefined();
    expect(await registry.verifyTransitionLog()).toBe(true);

    // -- double-promotion at production... after rollback we sit at canary --
    // the re-promotion: canary -> production again (the cycle's second arc).
    const rePromotion = granted(
      await requestPromotion(registry, { organizationId, policy }),
      "canary",
      "production",
    );
    expect(rePromotion.toVersion).toBe(rollback.toVersion + 1);
    expect(await registry.verifyTransitionLog()).toBe(true);

    // -- the terminal rollback: a NON-demote trigger RETIRES ----------------
    const retire = rolledBack(
      await requestRollback(registry, {
        organizationId,
        trigger: "rights-failure",
        policy,
        note: "the licensed footage basis was invalidated",
      }),
      "production",
      "retired",
    );
    expect(retire.fromStatus).toBe("production");
    expect(retire.toStatus).toBe("retired");
    // THE RETIREMENT RECORD IS WRITTEN (queryable evidence).
    const retirementEntry = retire.transition;
    expect(retirementEntry.operation).toBe("rollback");
    expect(retirementEntry.rollbackTrigger).toBe("rights-failure");
    expect(retirementEntry.toStatus).toBe("retired");

    // -- the in-flight reference sweep: EVERY version resolves ---------------
    for (let version = 1; version <= retire.toVersion; version += 1) {
      const record = await registry.getVersion(organizationId, version);
      expect(record.version).toBe(version);
      expect(record.organizationId).toBe(organizationId);
    }
    // The latest is the retirement target; the held references still resolve.
    const finalRecord = await registry.get(organizationId);
    expect(finalRecord.status).toBe("retired");
    expect(finalRecord.version).toBe(retire.toVersion);
    const heldAtTheEnd = await registry.getVersion(inFlight.organizationId, inFlight.version);
    expect(heldAtTheEnd.status).toBe("production"); // history never mutates

    // -- the evidence trail is QUERYABLE end to end --------------------------
    const log = await registry.transitionLog(organizationId);
    // 1 registration + 3 evidence-updates + 5 promotions + 2 rollbacks.
    expect(log).toHaveLength(11);
    const promotions = log.filter((entry) => entry.operation === "promotion");
    expect(promotions).toHaveLength(5);
    // Every promotion entry carries its gate results + the automated actor.
    for (const entry of promotions) {
      expect(entry.actor.actorType).toBe("system");
      expect(entry.actor.actorId).toBe("promotion-policy:rel-promotion:v1");
      expect(entry.detail).toContain("rel-promotion:v1");
      if (entry.toStatus === "production") {
        // The production step carries the FULL seven-gate evidence (REL-A4).
        expect(entry.gateResults).toHaveLength(7);
        expect(entry.gateResults.every((result) => result.status === "pass")).toBe(true);
        expect(entry.gateResults.map((result) => result.gate)).toContain("canary");
      }
    }
    // The production step's canary gate measured the canary records.
    const productionEntry = promotions.find((entry) => entry.toStatus === "production");
    expect(productionEntry).toBeDefined();
    const canaryGate = productionEntry?.gateResults.find((result) => result.gate === "canary");
    expect(canaryGate?.status).toBe("pass");
    // The rollbacks are recorded with their triggers.
    const rollbacks = log.filter((entry) => entry.operation === "rollback");
    expect(rollbacks).toHaveLength(2);
    expect(rollbacks.map((entry) => entry.rollbackTrigger)).toEqual([
      "hard-slo-failure",
      "rights-failure",
    ]);
    // The whole chain verifies: tamper-evident history, end to end.
    expect(await registry.verifyTransitionLog()).toBe(true);
  });

  test("the scenario is DETERMINISTIC: a fresh registry reproduces the identical log", async () => {
    async function runScenario(): Promise<string> {
      const registry = newRegistry();
      const policy = examplePolicy();
      const organizationId = "org-cycle";
      await registry.register(newOrgInput({ organizationId, displayName: "The Cycle Org" }), {
        actorType: "system",
        actorId: "test-harness",
      });
      await requestPromotion(registry, {
        organizationId,
        policy,
        additionalEvidence: benchmarkStageEvidence(),
      });
      await requestPromotion(registry, {
        organizationId,
        policy,
        additionalEvidence: validationStageEvidence(),
      });
      await requestPromotion(registry, { organizationId, policy });
      await requestPromotion(registry, {
        organizationId,
        policy,
        additionalEvidence: { canary: fullEvidence(true, false).canary },
      });
      await requestRollback(registry, {
        organizationId,
        trigger: "hard-slo-failure",
        policy,
        note: "production canary: p95 latency SLO violated",
      });
      await requestPromotion(registry, { organizationId, policy });
      await requestRollback(registry, {
        organizationId,
        trigger: "rights-failure",
        policy,
        note: "the licensed footage basis was invalidated",
      });
      return JSON.stringify(await registry.transitionLog(organizationId));
    }
    const first = await runScenario();
    const second = await runScenario();
    expect(second).toBe(first); // identical entry ids, versions, times, hashes
  });
});

describe("double-promotion and out-of-order transitions refuse typed", () => {
  test("a PRODUCTION organization has no forward step — the re-request refuses typed and is audited", async () => {
    const registry = newRegistry();
    const policy = examplePolicy();
    const organizationId = "org-double";
    await registry.register(newOrgInput({ organizationId }), {
      actorType: "system",
      actorId: "test-harness",
    });
    await requestPromotion(registry, {
      organizationId,
      policy,
      additionalEvidence: benchmarkStageEvidence(),
    });
    await requestPromotion(registry, {
      organizationId,
      policy,
      additionalEvidence: validationStageEvidence(),
    });
    await requestPromotion(registry, { organizationId, policy });
    const production = await requestPromotion(registry, {
      organizationId,
      policy,
      additionalEvidence: { canary: fullEvidence(true, false).canary },
    });
    expect(production.outcome).toBe("granted");
    const versionAfterProduction = production.outcome === "granted" ? production.toVersion : 0;

    // DOUBLE-PROMOTION: the second request at production refuses typed.
    const again = await requestPromotion(registry, { organizationId, policy });
    if (again.outcome !== "refused") {
      throw new Error("expected the double-promotion to refuse");
    }
    expect(again.reason).toBe("no-forward-step");
    expect(again.attemptedTarget).toBeNull();
    expect(again.message).toContain("no forward step from 'production'");
    // The refusal is AUDITED: no version bump, but a log entry exists.
    const record = await registry.get(organizationId);
    expect(record.version).toBe(versionAfterProduction);
    const log = await registry.transitionLog(organizationId);
    const refusalEntry = log.find(
      (entry) => entry.operation === "promotion" && entry.refusalReason === "no-forward-step",
    );
    expect(refusalEntry).toBeDefined();
    expect(refusalEntry?.toVersion).toBe(refusalEntry?.fromVersion);
    expect(await registry.verifyTransitionLog()).toBe(true);
  });

  test("a RETIRED organization refuses promotion typed (terminal — no resurrection)", async () => {
    const registry = newRegistry();
    const policy = examplePolicy();
    const organizationId = "org-retired";
    await registry.register(newOrgInput({ organizationId }), {
      actorType: "system",
      actorId: "test-harness",
    });
    await requestPromotion(registry, {
      organizationId,
      policy,
      additionalEvidence: benchmarkStageEvidence(),
    });
    await requestPromotion(registry, {
      organizationId,
      policy,
      additionalEvidence: validationStageEvidence(),
    });
    await requestPromotion(registry, { organizationId, policy });
    await requestPromotion(registry, {
      organizationId,
      policy,
      additionalEvidence: { canary: fullEvidence(true, false).canary },
    });
    const retired = await requestRollback(registry, {
      organizationId,
      trigger: "policy-violation",
      policy,
    });
    expect(retired.outcome).toBe("granted");
    const promotion = await requestPromotion(registry, { organizationId, policy });
    if (promotion.outcome !== "refused") {
      throw new Error("expected the retired promotion to refuse");
    }
    expect(promotion.reason).toBe("no-forward-step");
    expect(promotion.message).toContain("terminal");
    // And a further rollback refuses too (nothing left to roll back).
    const rollback = await requestRollback(registry, {
      organizationId,
      trigger: "hard-slo-failure",
      policy,
    });
    if (rollback.outcome !== "refused") {
      throw new Error("expected the retired rollback to refuse");
    }
    expect(rollback.reason).toBe("not-rollback-eligible");
    expect((rollback as { message: string }).message).toContain("nothing left to roll back");
  });

  test("OUT-OF-ORDER: full evidence from draft still advances ONE legal step (the jump is inexpressible)", async () => {
    const registry = newRegistry();
    const policy = examplePolicy();
    const organizationId = "org-jump";
    await registry.register(newOrgInput({ organizationId }), {
      actorType: "system",
      actorId: "test-harness",
    });
    // The FULL bundle (all seven legs incl. canary) submitted at draft:
    // the target is DERIVED (benchmarked), never a jump to production.
    const outcome = await requestPromotion(registry, {
      organizationId,
      policy,
      additionalEvidence: fullEvidence(true, true),
    });
    expect(outcome.outcome).toBe("granted");
    if (outcome.outcome === "granted") {
      expect(outcome.toStatus).toBe("benchmarked");
      expect(outcome.fromStatus).toBe("draft");
    }
    // The store's own defense in depth: the illegal edge draft -> production
    // refuses with the typed conflict, never a silent write.
    await expect(
      registry.applyLifecycleTransition(organizationId, {
        toStatus: "production",
        operation: "promotion",
        actor: { actorType: "system", actorId: "hostile" },
        gateResults: [],
        detail: "an illegal jump attempt",
      }),
    ).rejects.toBeInstanceOf(RegistryConflictError);
    const record = await registry.get(organizationId);
    expect(record.status).toBe("benchmarked");
  });

  test("OUT-OF-ORDER rollback: draft cannot roll back; unknown/unconfigured triggers refuse typed", async () => {
    const registry = newRegistry();
    const policy = examplePolicy();
    const organizationId = "org-order";
    await registry.register(newOrgInput({ organizationId }), {
      actorType: "system",
      actorId: "test-harness",
    });
    const draftRollback = await requestRollback(registry, {
      organizationId,
      trigger: "hard-slo-failure",
      policy,
    });
    if (draftRollback.outcome !== "refused") {
      throw new Error("expected the draft rollback to refuse");
    }
    expect(draftRollback.reason).toBe("not-rollback-eligible");
    expect((draftRollback as { message: string }).message).toContain(
      "only canary/production organizations can roll back",
    );

    // Walk to production for the trigger vocabulary sweep.
    await requestPromotion(registry, {
      organizationId,
      policy,
      additionalEvidence: benchmarkStageEvidence(),
    });
    await requestPromotion(registry, {
      organizationId,
      policy,
      additionalEvidence: validationStageEvidence(),
    });
    await requestPromotion(registry, { organizationId, policy });
    await requestPromotion(registry, {
      organizationId,
      policy,
      additionalEvidence: { canary: fullEvidence(true, false).canary },
    });
    // An UNKNOWN trigger: typed refusal naming the closed vocabulary.
    const unknown = await requestRollback(registry, {
      organizationId,
      trigger: "act-of-god",
      policy,
    });
    if (unknown.outcome !== "refused") {
      throw new Error("expected the unknown trigger to refuse");
    }
    expect(unknown.reason).toBe("unknown-trigger");
    expect((unknown as { message: string }).message).toContain("hard-slo-failure");
    // A KNOWN trigger NOT configured in the policy: typed refusal (REL-A4 —
    // rollback is automatic only for CONFIGURED hard SLO/policy failures).
    const unconfiguredPolicy = examplePolicy();
    unconfiguredPolicy.rollback = {
      allowedTriggers: ["hard-slo-failure", "policy-violation"],
      demoteTriggers: [],
    };
    const unconfigured = await requestRollback(registry, {
      organizationId,
      trigger: "cost-blowout",
      policy: unconfiguredPolicy,
    });
    if (unconfigured.outcome !== "refused") {
      throw new Error("expected the unconfigured trigger to refuse");
    }
    expect(unconfigured.reason).toBe("trigger-not-configured");
    expect((unconfigured as { message: string }).message).toContain("not configured");
    // Nothing fired: the organization is still production, version unmoved.
    const record = await registry.get(organizationId);
    expect(record.status).toBe("production");
    expect(await registry.verifyTransitionLog()).toBe(true);
  });

  test("the refusal arms are auditable records, never throws (the typed split)", async () => {
    const registry = newRegistry();
    const policy = examplePolicy();
    const organizationId = "org-audit";
    await registry.register(newOrgInput({ organizationId }), {
      actorType: "system",
      actorId: "test-harness",
    });
    await requestPromotion(registry, {
      organizationId,
      policy,
      additionalEvidence: benchmarkStageEvidence(),
    });
    // A refused promotion (validation gates missing) is a RETURNED record.
    const refused: PromotionOutcome = await requestPromotion(registry, {
      organizationId,
      policy,
      additionalEvidence: {},
    });
    expect(refused.outcome).toBe("refused");
    if (refused.outcome === "refused") {
      expect(refused.reason).toBe("gate-failure");
      expect(refused.gateResults.length).toBeGreaterThan(0);
      // The refusal is in the log with its typed reason.
      const log = await registry.transitionLog(organizationId);
      const entry = log.find((e) => e.refusalReason === "gate-failure");
      expect(entry).toBeDefined();
    }
    // A refused rollback is a returned record too (never a throw).
    const refusedRollback: RollbackOutcome = await requestRollback(registry, {
      organizationId,
      trigger: "not-a-trigger",
      policy,
    });
    expect(refusedRollback.outcome).toBe("refused");
    expect(await registry.verifyTransitionLog()).toBe(true);
  });
});
