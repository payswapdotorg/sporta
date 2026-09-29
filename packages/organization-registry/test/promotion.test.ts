/**
 * REL-018 automated-promotion tests: the full pipeline walk, the cumulative
 * gate requirements per target, typed refusals (missing evidence, failed
 * gates, empty lineage, no forward step), the version bump on every
 * transition, and fail-closed policy validation.
 */
import { describe, expect, test } from "bun:test";
import {
  requestPromotion,
  PROMOTION_GATES_BY_TARGET,
  RegistryValidationError,
  isRegistryError,
  validatePromotionPolicy,
} from "../src";
import type { OrganizationStatus, PromotionOutcome } from "../src";
import {
  benchmarkStageEvidence,
  examplePolicy,
  fullEvidence,
  newOrgInput,
  orgAtStatus,
  registerOrg,
  validationStageEvidence,
} from "./fixtures";

const policy = examplePolicy();

function refused(outcome: PromotionOutcome) {
  expect(outcome.outcome).toBe("refused");
  if (outcome.outcome !== "refused") throw new Error("unreachable: not refused");
  return outcome;
}

function granted(outcome: PromotionOutcome) {
  expect(outcome.outcome).toBe("granted");
  if (outcome.outcome !== "granted") throw new Error("unreachable: not granted");
  return outcome;
}

describe("the gate requirements per promotion target (cumulative)", () => {
  test("benchmarked requires reproducibility + benchmark", () => {
    expect(PROMOTION_GATES_BY_TARGET.benchmarked).toEqual(["reproducibility", "benchmark"]);
  });

  test("validated requires the full six-gate non-canary eligibility", () => {
    expect(PROMOTION_GATES_BY_TARGET.validated).toEqual([
      "reproducibility",
      "benchmark",
      "robustness",
      "rights-provenance",
      "cost-latency",
      "security-policy",
    ]);
  });

  test("canary re-proves the six on the current version", () => {
    expect(PROMOTION_GATES_BY_TARGET.canary).toEqual(PROMOTION_GATES_BY_TARGET.validated);
  });

  test("production adds the canary pass to the six", () => {
    expect(PROMOTION_GATES_BY_TARGET.production).toEqual([
      ...PROMOTION_GATES_BY_TARGET.validated,
      "canary",
    ]);
  });
});

describe("the full automated pipeline walk (draft -> production)", () => {
  test("each step grants exactly one status and bumps the version", async () => {
    const { registry } = await registerOrg();
    // fromVersion is the post-evidence version (evidence is its own audited
    // version bump before the transition is evaluated on it).
    const steps: Array<{
      evidence?: object;
      to: OrganizationStatus;
      fromVersion: number;
      version: number;
    }> = [
      { evidence: benchmarkStageEvidence(), to: "benchmarked", fromVersion: 2, version: 3 },
      { evidence: validationStageEvidence(), to: "validated", fromVersion: 4, version: 5 },
      { to: "canary", fromVersion: 5, version: 6 },
      {
        evidence: { canary: fullEvidence(true, false).canary },
        to: "production",
        fromVersion: 7,
        version: 8,
      },
    ];
    for (const step of steps) {
      const outcome = granted(
        await requestPromotion(registry, {
          organizationId: "org-alpha",
          policy,
          ...(step.evidence !== undefined ? { additionalEvidence: step.evidence as never } : {}),
        }),
      );
      expect(outcome.toStatus).toBe(step.to);
      expect(outcome.record.version).toBe(step.version);
      expect(outcome.fromVersion).toBe(step.fromVersion);
      // The transition entry carries the gate results it was granted on.
      expect(outcome.transition.gateResults.length).toBeGreaterThan(0);
      expect(outcome.transition.operation).toBe("promotion");
      expect(outcome.transition.refusalReason).toBeUndefined();
    }
    expect((await registry.get("org-alpha")).status).toBe("production");
  });

  test("the granted transitions are all in the audit log, in order", async () => {
    const { registry } = await orgAtStatus("production");
    const log = await registry.transitionLog("org-alpha");
    const promotions = log.filter((entry) => entry.operation === "promotion");
    expect(promotions.map((entry) => `${entry.fromStatus}->${entry.toStatus}`)).toEqual([
      "draft->benchmarked",
      "benchmarked->validated",
      "validated->canary",
      "canary->production",
    ]);
    // Four promotions + one registration + three evidence updates
    // (benchmark stage, validation stage, canary evidence).
    expect(log.length).toBe(8);
    expect(log.filter((entry) => entry.operation === "registration").length).toBe(1);
    expect(log.filter((entry) => entry.operation === "evidence-update").length).toBe(3);
  });
});

describe("typed refusals", () => {
  test("draft with NO evidence refuses: every required gate is 'missing'", async () => {
    const { registry } = await registerOrg();
    const outcome = refused(
      await requestPromotion(registry, { organizationId: "org-alpha", policy }),
    );
    expect(outcome.reason).toBe("gate-failure");
    expect(outcome.gateResults.every((r) => r.status === "missing")).toBe(true);
    expect(outcome.message).toContain("draft -> benchmarked");
    expect(outcome.policy).toEqual({ policyId: "rel-promotion", version: 1 });
  });

  test("a FAILED gate (not just missing) refuses with 'fail'", async () => {
    const { registry } = await registerOrg();
    const weak = benchmarkStageEvidence();
    weak.benchmark!.metrics = weak.benchmark!.metrics.map((m) =>
      m.axis === "fidelity" ? { ...m, value: 5.0 } : m,
    );
    const outcome = refused(
      await requestPromotion(registry, {
        organizationId: "org-alpha",
        policy,
        additionalEvidence: weak,
      }),
    );
    expect(outcome.gateResults.find((r) => r.gate === "benchmark")?.status).toBe("fail");
    expect(outcome.gateResults.find((r) => r.gate === "benchmark")?.detail).toContain("fidelity=5");
  });

  test("canary -> production without canary evidence refuses on the canary gate", async () => {
    const { registry } = await orgAtStatus("canary");
    const outcome = refused(
      await requestPromotion(registry, { organizationId: "org-alpha", policy }),
    );
    expect(outcome.attemptedTarget).toBe("production");
    const canary = outcome.gateResults.find((r) => r.gate === "canary");
    expect(canary?.status).toBe("missing");
    expect(canary?.detail).toContain("isolated, observable canary window");
  });

  test("a canary window with an SLO failure refuses production", async () => {
    const { registry } = await orgAtStatus("canary");
    const canary = fullEvidence(true, false).canary!;
    const dirty = {
      canary: {
        ...canary,
        sloChecks: canary.sloChecks.map((c) =>
          c.checkId === "slo-p95" ? { ...c, passed: false } : c,
        ),
      },
    };
    const outcome = refused(
      await requestPromotion(registry, {
        organizationId: "org-alpha",
        policy,
        additionalEvidence: dirty,
      }),
    );
    expect(outcome.gateResults.find((r) => r.gate === "canary")?.status).toBe("fail");
  });

  test("empty provenance lineage refuses validated/canary/production (REL-A4)", async () => {
    const { registry } = await registerOrg({
      provenance: { ...newOrgInput().provenance, lineage: [] },
    });
    await requestPromotion(registry, {
      organizationId: "org-alpha",
      policy,
      additionalEvidence: benchmarkStageEvidence(),
    });
    const outcome = refused(
      await requestPromotion(registry, {
        organizationId: "org-alpha",
        policy,
        additionalEvidence: validationStageEvidence(),
      }),
    );
    expect(outcome.reason).toBe("incomplete-lineage");
    expect(outcome.message).toContain("complete lineage is required before 'validated'");
    // The gates themselves passed — the lineage is the separate refusal.
    expect(outcome.gateResults.every((r) => r.status === "pass")).toBe(true);
  });

  test("production has no forward step — promotion refuses, never improvises", async () => {
    const { registry } = await orgAtStatus("production");
    const outcome = refused(
      await requestPromotion(registry, { organizationId: "org-alpha", policy }),
    );
    expect(outcome.reason).toBe("no-forward-step");
    expect(outcome.attemptedTarget).toBeNull();
    expect(outcome.message).toContain("there is no forward step from 'production'");
    expect(outcome.gateResults).toEqual([]);
  });
});

describe("illegal jumps are structurally inexpressible + the store re-checks", () => {
  test("requestPromotion derives the target itself — full evidence still only reaches 'benchmarked' from draft", async () => {
    // There is no caller-supplied target: even an organization holding the
    // COMPLETE evidence bundle is promoted exactly one step (draft ->
    // benchmarked), never jumped to validated/canary/production.
    const { registry } = await registerOrg();
    const outcome = granted(
      await requestPromotion(registry, {
        organizationId: "org-alpha",
        policy,
        additionalEvidence: { ...fullEvidence(false, false) },
      }),
    );
    expect(outcome.toStatus).toBe("benchmarked");
    expect(outcome.fromStatus).toBe("draft");
  });

  test("applyLifecycleTransition throws a typed conflict on an illegal edge (defense in depth)", async () => {
    const { registry } = await registerOrg();
    let thrown: unknown;
    try {
      await registry.applyLifecycleTransition("org-alpha", {
        toStatus: "validated", // skip!
        operation: "promotion",
        actor: { actorType: "system", actorId: "test" },
        gateResults: [],
        detail: "illegal direct jump attempt",
      });
    } catch (error) {
      thrown = error;
    }
    expect(isRegistryError(thrown)).toBe(true);
    expect((thrown as { failureClass?: string }).failureClass).toBe("conflict");
    // The record is untouched — no version, no status change.
    const record = await registry.get("org-alpha");
    expect(record.version).toBe(1);
    expect(record.status).toBe("draft");
  });
});

describe("fail-closed policy validation", () => {
  test("the example policy is valid", () => {
    expect(validatePromotionPolicy(examplePolicy())).toEqual([]);
  });

  test("an incomplete policy is reported, never silently defaulted", () => {
    const broken = examplePolicy();
    (broken.gates.benchmark as { minimumScores?: unknown }).minimumScores = {};
    const problems = validatePromotionPolicy(broken);
    expect(problems).toContain("gates.benchmark.minimumScores must be a non-empty axis -> bar map");
  });

  test("out-of-range thresholds are reported", () => {
    const broken = examplePolicy();
    broken.gates.robustness.minSimulatorModelAgreement = 1.5;
    const problems = validatePromotionPolicy(broken);
    expect(problems).toContain("gates.robustness.minSimulatorModelAgreement must be in [0, 1]");
  });

  test("demoteTriggers outside allowedTriggers are reported", () => {
    const broken = examplePolicy();
    broken.rollback = { allowedTriggers: ["hard-slo-failure"], demoteTriggers: ["cost-blowout"] };
    expect(validatePromotionPolicy(broken)).toEqual([
      "rollback.demoteTriggers must be a subset of allowedTriggers",
    ]);
  });

  test("requestPromotion with a malformed policy throws the typed validation error", async () => {
    const { registry } = await registerOrg();
    const broken = examplePolicy();
    broken.version = 0;
    expect(validatePromotionPolicy(broken)).toContain("version must be an integer >= 1");
    let thrown: unknown;
    try {
      await requestPromotion(registry, { organizationId: "org-alpha", policy: broken });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RegistryValidationError);
    const details = (thrown as { details?: { issues?: unknown[] } }).details ?? {};
    expect(details.issues).toContain("version must be an integer >= 1");
  });
});

describe("the automated actor", () => {
  test("granted transitions record the policy-engine system actor by default", async () => {
    const { registry } = await registerOrg();
    const outcome = granted(
      await requestPromotion(registry, {
        organizationId: "org-alpha",
        policy,
        additionalEvidence: benchmarkStageEvidence(),
      }),
    );
    expect(outcome.transition.actor).toEqual({
      actorType: "system",
      actorId: "promotion-policy:rel-promotion:v1",
    });
  });

  test("a caller-supplied actor is recorded verbatim (user-initiated promotion)", async () => {
    const { registry } = await registerOrg();
    const outcome = granted(
      await requestPromotion(registry, {
        organizationId: "org-alpha",
        policy,
        actor: { actorType: "user", actorId: "user-7" },
        additionalEvidence: benchmarkStageEvidence(),
      }),
    );
    expect(outcome.transition.actor).toEqual({ actorType: "user", actorId: "user-7" });
  });
});
