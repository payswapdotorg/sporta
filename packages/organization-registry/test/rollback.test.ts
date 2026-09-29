/**
 * REL-018 rollback tests: automatic rollback on a recorded trigger, the
 * policy-gated production -> canary demotion, the closed trigger
 * vocabulary, eligibility refusals, retired-terminal, and the audited
 * version bump on every rollback.
 */
import { describe, expect, test } from "bun:test";
import { requestPromotion, requestRollback } from "../src";
import type { RollbackOutcome } from "../src";
import { examplePolicy, orgAtStatus } from "./fixtures";

const policy = examplePolicy(); // demoteTriggers: ["hard-slo-failure"]

function granted(outcome: RollbackOutcome) {
  expect(outcome.outcome).toBe("granted");
  if (outcome.outcome !== "granted") throw new Error("unreachable: not granted");
  return outcome;
}

function refused(outcome: RollbackOutcome) {
  expect(outcome.outcome).toBe("refused");
  if (outcome.outcome !== "refused") throw new Error("unreachable: not refused");
  return outcome;
}

describe("automatic rollback paths", () => {
  test("canary -> retired on a hard SLO failure", async () => {
    const { registry } = await orgAtStatus("canary");
    const outcome = granted(
      await requestRollback(registry, {
        organizationId: "org-alpha",
        trigger: "hard-slo-failure",
        policy,
      }),
    );
    expect(outcome.fromStatus).toBe("canary");
    expect(outcome.toStatus).toBe("retired");
    expect(outcome.trigger).toBe("hard-slo-failure");
    expect(outcome.transition.rollbackTrigger).toBe("hard-slo-failure");
    expect(outcome.transition.detail).toContain("canary -> retired");
    expect(outcome.transition.detail).toContain("trigger 'hard-slo-failure'");
    // Versioned: the retirement is a new immutable version.
    expect(outcome.toVersion).toBe(outcome.fromVersion + 1);
    expect(outcome.record.version).toBe(outcome.toVersion);
  });

  test("production -> retired on a non-demotion trigger (cost blowout)", async () => {
    const { registry } = await orgAtStatus("production");
    const outcome = granted(
      await requestRollback(registry, {
        organizationId: "org-alpha",
        trigger: "cost-blowout",
        policy,
      }),
    );
    expect(outcome.fromStatus).toBe("production");
    expect(outcome.toStatus).toBe("retired");
    expect(outcome.transition.rollbackTrigger).toBe("cost-blowout");
  });

  test("production -> canary on a demotion trigger (where policy says so)", async () => {
    const { registry } = await orgAtStatus("production");
    const outcome = granted(
      await requestRollback(registry, {
        organizationId: "org-alpha",
        trigger: "hard-slo-failure",
        policy,
      }),
    );
    expect(outcome.toStatus).toBe("canary");
    expect(outcome.transition.rollbackTrigger).toBe("hard-slo-failure");
    expect(outcome.transition.detail).toContain("production -> canary");
    // A demoted org is still SELECTABLE (canary is a selectable status).
    const eligible = await registry.queryEligible({});
    expect(eligible.map((r) => r.organizationId)).toContain("org-alpha");
  });

  test("a demoted-to-canary org can be retired by a second trigger", async () => {
    const { registry } = await orgAtStatus("production");
    await requestRollback(registry, {
      organizationId: "org-alpha",
      trigger: "hard-slo-failure",
      policy,
    });
    const outcome = granted(
      await requestRollback(registry, {
        organizationId: "org-alpha",
        trigger: "rights-failure",
        policy,
      }),
    );
    expect(outcome.fromStatus).toBe("canary");
    expect(outcome.toStatus).toBe("retired");
  });

  test("the default actor is the automated policy engine", async () => {
    const { registry } = await orgAtStatus("production");
    const outcome = granted(
      await requestRollback(registry, {
        organizationId: "org-alpha",
        trigger: "policy-violation",
        policy,
      }),
    );
    expect(outcome.transition.actor).toEqual({
      actorType: "system",
      actorId: "promotion-policy:rel-promotion:v1",
    });
  });

  test("an operator note is recorded into the audit detail", async () => {
    const { registry } = await orgAtStatus("production");
    const outcome = granted(
      await requestRollback(registry, {
        organizationId: "org-alpha",
        trigger: "policy-violation",
        policy,
        note: "SLO monitor fired at 2025-01-06T13:00Z",
      }),
    );
    expect(outcome.transition.detail).toContain("SLO monitor fired at 2025-01-06T13:00Z");
  });
});

describe("the closed trigger vocabulary", () => {
  test("an unknown trigger refuses with the typed reason (never an improvised retirement)", async () => {
    const { registry } = await orgAtStatus("production");
    const outcome = refused(
      await requestRollback(registry, { organizationId: "org-alpha", trigger: "vibes", policy }),
    );
    expect(outcome.reason).toBe("unknown-trigger");
    expect(outcome.attemptedTrigger).toBe("vibes");
    expect(outcome.message).toContain("'vibes' is not a rollback trigger");
    expect(outcome.message).toContain(
      "'hard-slo-failure', 'policy-violation', 'rights-failure', 'cost-blowout'",
    );
    // Nothing changed.
    expect((await registry.get("org-alpha")).status).toBe("production");
  });

  test("a trigger not configured in the policy refuses (rollback is for CONFIGURED failures)", async () => {
    const narrow = examplePolicy();
    narrow.rollback = { allowedTriggers: ["hard-slo-failure"], demoteTriggers: [] };
    const { registry } = await orgAtStatus("production");
    const outcome = refused(
      await requestRollback(registry, {
        organizationId: "org-alpha",
        trigger: "rights-failure",
        policy: narrow,
      }),
    );
    expect(outcome.reason).toBe("trigger-not-configured");
    expect(outcome.message).toContain("not configured in policy rel-promotion:v1");
    expect((await registry.get("org-alpha")).status).toBe("production");
  });
});

describe("rollback eligibility", () => {
  test("draft cannot roll back (nothing shipped)", async () => {
    const { registry } = await orgAtStatus("draft");
    const outcome = refused(
      await requestRollback(registry, {
        organizationId: "org-alpha",
        trigger: "hard-slo-failure",
        policy,
      }),
    );
    expect(outcome.reason).toBe("not-rollback-eligible");
    expect(outcome.message).toContain("current status is 'draft'");
  });

  test("validated cannot roll back (no traffic exposed yet)", async () => {
    const { registry } = await orgAtStatus("validated");
    const outcome = refused(
      await requestRollback(registry, {
        organizationId: "org-alpha",
        trigger: "hard-slo-failure",
        policy,
      }),
    );
    expect(outcome.reason).toBe("not-rollback-eligible");
  });

  test("retired is terminal — a second rollback refuses with the terminal message", async () => {
    const { registry } = await orgAtStatus("canary");
    await requestRollback(registry, {
      organizationId: "org-alpha",
      trigger: "hard-slo-failure",
      policy,
    });
    const outcome = refused(
      await requestRollback(registry, {
        organizationId: "org-alpha",
        trigger: "hard-slo-failure",
        policy,
      }),
    );
    expect(outcome.reason).toBe("not-rollback-eligible");
    expect(outcome.message).toContain("'retired' is terminal");
    // And promotion cannot resurrect it either.
    const promo = await requestPromotion(registry, { organizationId: "org-alpha", policy });
    expect(promo.outcome).toBe("refused");
    if (promo.outcome === "refused") {
      expect(promo.reason).toBe("no-forward-step");
      expect(promo.message).toContain("'retired' is terminal");
    }
  });
});

describe("retirement preserves lineage (the contract's own sentence)", () => {
  test("a retired organization keeps every version and its full lineage", async () => {
    const { registry } = await orgAtStatus("production");
    await requestRollback(registry, {
      organizationId: "org-alpha",
      trigger: "rights-failure",
      policy,
    });
    const versions = await registry.listVersions("org-alpha");
    expect(versions.length).toBe(9); // v1..v8 walk + v9 retirement
    expect(versions[0]?.status).toBe("draft");
    expect(versions[8]?.status).toBe("retired");
    const retired = await registry.get("org-alpha");
    expect(retired.provenance.lineage.length).toBeGreaterThan(0);
    expect(retired.evidence.benchmark?.corpusVersion).toBe("corpus-v1");
    // Historical runs keep the exact organization version: getVersion still works.
    const v8 = await registry.getVersion("org-alpha", 8);
    expect(v8.status).toBe("production");
  });
});
