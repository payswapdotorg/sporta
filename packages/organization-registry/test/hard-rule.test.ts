/**
 * THE HARD RULE, end to end (REL-018's own test demand): "no organization
 * may ship based solely on simulator reward — benchmark + robustness +
 * rights gates are mandatory INDEPENDENT inputs; a record carrying only a
 * simulator-reward score is refused promotion."
 */
import { describe, expect, test } from "bun:test";
import { requestPromotion } from "../src";
import type { PromotionOutcome } from "../src";
import {
  benchmarkStageEvidence,
  examplePolicy,
  fullEvidence,
  newOrgInput,
  newRegistry,
  orgAtStatus,
  registerOrg,
  simulatorRewardOnly,
  validationStageEvidence,
} from "./fixtures";

const policy = examplePolicy();

function refused(outcome: PromotionOutcome) {
  expect(outcome.outcome).toBe("refused");
  if (outcome.outcome !== "refused") throw new Error("unreachable: not refused");
  return outcome;
}

describe("a record carrying ONLY a simulator-reward score", () => {
  test("is refused promotion from draft (nothing but the reward exists)", async () => {
    const { registry } = await orgAtStatus("draft");
    const outcome = refused(
      await requestPromotion(registry, {
        organizationId: "org-alpha",
        policy,
        additionalEvidence: simulatorRewardOnly(),
      }),
    );
    expect(outcome.reason).toBe("gate-failure");
    expect(outcome.attemptedTarget).toBe("benchmarked");
    // Both gates required even for the FIRST step refuse as missing.
    const gates = new Map(outcome.gateResults.map((r) => [r.gate, r.status]));
    expect(gates.get("reproducibility")).toBe("missing");
    expect(gates.get("benchmark")).toBe("missing");
    expect(outcome.message).toContain("reproducibility=missing");
    expect(outcome.message).toContain("benchmark=missing");
  });

  test("the refusal says IN WORDS that the reward does not count", async () => {
    const { registry } = await orgAtStatus("draft");
    const outcome = refused(
      await requestPromotion(registry, {
        organizationId: "org-alpha",
        policy,
        additionalEvidence: simulatorRewardOnly(),
      }),
    );
    const benchmark = outcome.gateResults.find((r) => r.gate === "benchmark");
    expect(benchmark?.detail).toContain("simulator reward IS present");
    expect(benchmark?.detail).toContain("rewardVersion reward-v1, score 98.7");
    expect(benchmark?.detail).toContain("mandatory INDEPENDENT inputs");
  });

  test("is refused at the validated step too — reward + benchmark is still not enough", async () => {
    const { registry } = await orgAtStatus("benchmarked");
    const outcome = refused(
      await requestPromotion(registry, {
        organizationId: "org-alpha",
        policy,
        additionalEvidence: simulatorRewardOnly(),
      }),
    );
    const gates = new Map(outcome.gateResults.map((r) => [r.gate, r.status]));
    expect(gates.get("benchmark")).toBe("pass"); // benchmarked org HAS benchmark evidence
    expect(gates.get("robustness")).toBe("missing"); // but the reward cannot buy robustness
    expect(gates.get("rights-provenance")).toBe("missing");
    expect(gates.get("cost-latency")).toBe("missing");
    expect(gates.get("security-policy")).toBe("missing");
  });

  test("the refusal is recorded in the audit log without a version bump", async () => {
    const { registry } = await orgAtStatus("draft");
    const outcome = refused(
      await requestPromotion(registry, {
        organizationId: "org-alpha",
        policy,
        additionalEvidence: simulatorRewardOnly(),
      }),
    );
    const after = await registry.get("org-alpha");
    // v1 = registration, v2 = the reward evidence itself; the refusal adds no version.
    expect(after.version).toBe(2);
    const log = await registry.transitionLog("org-alpha");
    const refusalEntry = log.find((entry) => entry.refusalReason === "gate-failure");
    expect(refusalEntry).toBeDefined();
    expect(refusalEntry?.fromVersion).toBe(refusalEntry?.toVersion);
    expect(refusalEntry?.gateResults.find((r) => r.gate === "benchmark")?.status).toBe("missing");
    expect(outcome.evaluatedVersion).toBe(2);
  });
});

describe("a lab-discovered organization WITH independent evidence", () => {
  test("a stellar reward changes nothing: full evidence + reward reaches production", async () => {
    const { record } = await orgAtStatus("production", { withReward: true });
    expect(record.status).toBe("production");
    expect(record.evidence.simulatorReward?.score).toBe(98.7);
  });

  test("a hand-engineered organization (createdFrom null) passes the SAME gates", async () => {
    const registry = newRegistry();
    const handMade = {
      ...newOrgInput(),
      organizationId: "org-hand",
      provenance: { ...newOrgInput().provenance, createdFrom: null },
    };
    await registry.register(handMade, { actorType: "user", actorId: "engineer-1" });
    // The identical pipeline the lab-discovered organizations walk:
    await requestPromotion(registry, {
      organizationId: "org-hand",
      policy,
      additionalEvidence: benchmarkStageEvidence(),
    });
    await requestPromotion(registry, {
      organizationId: "org-hand",
      policy,
      additionalEvidence: validationStageEvidence(),
    });
    await requestPromotion(registry, { organizationId: "org-hand", policy });
    await requestPromotion(registry, {
      organizationId: "org-hand",
      policy,
      additionalEvidence: { canary: fullEvidence(true, false).canary },
    });
    const final = await registry.get("org-hand");
    expect(final.provenance.createdFrom).toBeNull();
    expect(final.status).toBe("production");
    // v1 register + v2 bench evidence + v3 promote + v4 validation evidence
    // + v5 promote + v6 promote-to-canary + v7 canary evidence + v8 promote.
    expect(final.version).toBe(8);
  });

  test("the lab-discovered twin reaches the same status through the same gates", async () => {
    const { registry, record } = await registerOrg();
    expect(record.provenance.createdFrom).toEqual({ labRunId: "run-1" });
    await requestPromotion(registry, {
      organizationId: "org-alpha",
      policy,
      additionalEvidence: benchmarkStageEvidence(),
    });
    await requestPromotion(registry, {
      organizationId: "org-alpha",
      policy,
      additionalEvidence: validationStageEvidence(),
    });
    await requestPromotion(registry, { organizationId: "org-alpha", policy });
    await requestPromotion(registry, {
      organizationId: "org-alpha",
      policy,
      additionalEvidence: { canary: fullEvidence(true, false).canary },
    });
    expect((await registry.get("org-alpha")).status).toBe("production");
  });
});
