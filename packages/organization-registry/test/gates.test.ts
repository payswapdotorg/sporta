/**
 * REL-018 gate tests: every gate refuses on MISSING evidence, fails on
 * insufficient evidence, passes on sufficient evidence — and the dispatcher
 * fails closed on unknown gate ids. THE HARD RULE's data-level half lives
 * here too: no gate result ever depends on the simulator reward.
 */
import { describe, expect, test } from "bun:test";
import {
  GATE_IDS,
  allGatesPassed,
  evaluateBenchmarkGate,
  evaluateCanaryGate,
  evaluateCostLatencyGate,
  evaluateGate,
  evaluateGates,
  evaluateReproducibilityGate,
  evaluateRightsProvenanceGate,
  evaluateRobustnessGate,
  evaluateSecurityPolicyGate,
  isGateId,
} from "../src";
import type { OrganizationRecord } from "../src";
import { examplePolicy, fullEvidence, newOrgInput, simulatorRewardOnly } from "./fixtures";

const policy = examplePolicy();

function recordWith(evidence: object): OrganizationRecord {
  return {
    ...newOrgInput(),
    version: 1,
    status: "draft",
    evidence: evidence as never,
    createdAt: "2025-01-06T12:00:00.001Z",
    updatedAt: "2025-01-06T12:00:00.001Z",
  };
}

describe("the gate vocabulary", () => {
  test("is the seven gates in frozen pipeline order", () => {
    expect(GATE_IDS).toEqual([
      "reproducibility",
      "benchmark",
      "robustness",
      "rights-provenance",
      "cost-latency",
      "security-policy",
      "canary",
    ]);
  });

  test("isGateId accepts members and rejects everything else", () => {
    expect(isGateId("benchmark")).toBe(true);
    expect(isGateId("simulator-reward")).toBe(false);
    expect(isGateId("")).toBe(false);
    expect(isGateId(42)).toBe(false);
    expect(isGateId(null)).toBe(false);
  });

  test("evaluateGate dispatches every known gate", () => {
    const record = recordWith(fullEvidence(true, true));
    for (const gate of GATE_IDS) {
      const result = evaluateGate(gate, record, policy.gates);
      expect(result.gate).toBe(gate);
      expect(result.status).toBe("pass");
    }
  });
});

describe("reproducibility gate", () => {
  test("missing evidence -> status 'missing', never waved through", () => {
    const result = evaluateReproducibilityGate(recordWith({}), policy.gates.reproducibility);
    expect(result.status).toBe("missing");
    expect(result.detail).toContain("no reproducibility evidence");
  });

  test("too few reproduction runs -> fail", () => {
    const evidence = fullEvidence(false, false);
    const repro = evidence.reproducibility!;
    const result = evaluateReproducibilityGate(
      recordWith({
        ...evidence,
        reproducibility: { ...repro, reproductionRuns: 1, identicalRuns: 1 },
      }),
      policy.gates.reproducibility,
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("1 reproduction runs < policy minimum 2");
  });

  test("non-identical reproductions -> fail", () => {
    const evidence = fullEvidence(false, false);
    const repro = evidence.reproducibility!;
    const result = evaluateReproducibilityGate(
      recordWith({ ...evidence, reproducibility: { ...repro, identicalRuns: 1 } }),
      policy.gates.reproducibility,
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("only 1/2 runs reproduced identical trajectories");
  });

  test("reproduction evidence for a different lab run than createdFrom -> fail", () => {
    const evidence = fullEvidence(false, false);
    const repro = evidence.reproducibility!;
    const result = evaluateReproducibilityGate(
      recordWith({ ...evidence, reproducibility: { ...repro, labRunId: "run-OTHER" } }),
      policy.gates.reproducibility,
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain(
      "created from lab run run-1 but the reproduction evidence covers lab run run-OTHER",
    );
  });

  test("2/2 identical runs from the creating lab run -> pass", () => {
    const result = evaluateReproducibilityGate(
      recordWith(fullEvidence(false, false)),
      policy.gates.reproducibility,
    );
    expect(result.status).toBe("pass");
    expect(result.measured).toMatchObject({ reproductionRuns: 2, identicalRuns: 2 });
  });
});

describe("benchmark gate", () => {
  test("missing evidence -> 'missing' (a mandatory independent input)", () => {
    const result = evaluateBenchmarkGate(recordWith({}), policy.gates.benchmark);
    expect(result.status).toBe("missing");
    expect(result.detail).toContain("no benchmark evidence");
  });

  test("an axis below the bar -> fail naming the axis and the numbers", () => {
    const evidence = fullEvidence(false, false);
    const metrics = evidence.benchmark!.metrics.map((m) =>
      m.axis === "fidelity" ? { ...m, value: 7.4 } : m,
    );
    const result = evaluateBenchmarkGate(
      recordWith({ ...evidence, benchmark: { ...evidence.benchmark!, metrics } }),
      policy.gates.benchmark,
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("fidelity=7.4 (minimum 7.5");
  });

  test("a missing uncertainty interval -> fail (uncertainty is mandatory)", () => {
    const evidence = fullEvidence(false, false);
    const uncertainty = evidence.benchmark!.uncertainty.filter((u) => u.axis !== "temporal");
    const result = evaluateBenchmarkGate(
      recordWith({ ...evidence, benchmark: { ...evidence.benchmark!, uncertainty } }),
      policy.gates.benchmark,
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("temporal=7.9 (minimum 7, uncertainty absent)");
  });

  test("a value outside its own confidence interval -> fail", () => {
    const evidence = fullEvidence(false, false);
    const uncertainty = evidence.benchmark!.uncertainty.map((u) =>
      u.axis === "stylization" ? { ...u, ciLow: 8.2, ciHigh: 8.5 } : u,
    );
    const result = evaluateBenchmarkGate(
      recordWith({ ...evidence, benchmark: { ...evidence.benchmark!, uncertainty } }),
      policy.gates.benchmark,
    );
    expect(result.status).toBe("fail");
  });

  test("all axes at/above their bars inside their intervals -> pass", () => {
    const result = evaluateBenchmarkGate(
      recordWith(fullEvidence(false, false)),
      policy.gates.benchmark,
    );
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("corpus corpus-v1");
  });
});

describe("robustness gate", () => {
  test("missing evidence -> 'missing'", () => {
    const result = evaluateRobustnessGate(recordWith({}), policy.gates.robustness);
    expect(result.status).toBe("missing");
    expect(result.detail).toContain("no robustness evidence");
  });

  test("each threshold violation fails with the measured numbers", () => {
    const base = fullEvidence(false, false).robustness!;
    const cases: Array<[string, object, string]> = [
      ["seedsTested", { seedsTested: 2, seedsPassed: 2 }, "seedsTested 2 < 3"],
      ["seed failures", { seedsPassed: 4 }, "seedsPassed 4/5"],
      ["OOD", { outOfDistributionScore: 5.9 }, "OOD score 5.9 < 6"],
      ["agreement", { simulatorModelAgreement: 0.79 }, "agreement 0.79 < 0.8"],
      ["coverage", { benchmarkCorpusCoverage: 0.69 }, "coverage 0.69 < 0.7"],
    ];
    for (const [label, override, fragment] of cases) {
      const result = evaluateRobustnessGate(
        recordWith({ robustness: { ...base, ...override } }),
        policy.gates.robustness,
      );
      expect(result.status).toBe("fail");
      expect(result.detail).toContain(fragment);
      expect(label).toBeTruthy();
    }
  });

  test("a passing robustness record -> pass with the full summary", () => {
    const result = evaluateRobustnessGate(
      recordWith(fullEvidence(false, false)),
      policy.gates.robustness,
    );
    expect(result.status).toBe("pass");
    expect(result.measured).toMatchObject({
      seedsTested: 5,
      seedsPassed: 5,
      outOfDistributionScore: 7.2,
      simulatorModelAgreement: 0.91,
      benchmarkCorpusCoverage: 0.85,
    });
  });
});

describe("rights/provenance gate", () => {
  test("missing evidence -> 'missing'", () => {
    const result = evaluateRightsProvenanceGate(recordWith({}));
    expect(result.status).toBe("missing");
    expect(result.detail).toContain("no rights/provenance evidence");
  });

  test("an unverified basis -> fail (a public URL alone never proves rights)", () => {
    const evidence = fullEvidence(false, false);
    const rights = evidence.rightsProvenance!;
    const result = evaluateRightsProvenanceGate(
      recordWith({ ...evidence, rightsProvenance: { ...rights, basisType: "unverified" } }),
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("'unverified'");
    expect(result.detail).toContain("ADR-013 #7");
  });

  test("a licensed basis with lineage -> pass", () => {
    const result = evaluateRightsProvenanceGate(recordWith(fullEvidence(false, false)));
    expect(result.status).toBe("pass");
    expect(result.measured).toMatchObject({ basisType: "licensed", licenseCount: 1 });
  });
});

describe("cost/latency gate", () => {
  test("missing evidence -> 'missing'", () => {
    const result = evaluateCostLatencyGate(recordWith({}), policy.gates["cost-latency"]);
    expect(result.status).toBe("missing");
    expect(result.detail).toContain("no cost/latency measurement evidence");
  });

  test("p95 above the envelope -> fail with the numbers", () => {
    const record = recordWith(fullEvidence(false, false));
    const result = evaluateCostLatencyGate(
      {
        ...record,
        profile: { ...record.profile, latency: { ...record.profile.latency, p95Ms: 3001 } },
      },
      policy.gates["cost-latency"],
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("p95 latency 3001ms > policy max 3000ms");
  });

  test("per-run cost above the envelope -> fail", () => {
    const record = recordWith(fullEvidence(false, false));
    const result = evaluateCostLatencyGate(
      { ...record, profile: { ...record.profile, cost: { perRunUsd: 2.5 } } },
      policy.gates["cost-latency"],
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("per-run cost $2.5 > policy max $2");
  });

  test("too few samples -> fail", () => {
    const evidence = fullEvidence(false, false);
    const result = evaluateCostLatencyGate(
      recordWith({ ...evidence, costLatency: { ...evidence.costLatency!, sampleCount: 19 } }),
      policy.gates["cost-latency"],
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("sampleCount 19 < 20");
  });

  test("inside the envelope with enough samples -> pass", () => {
    const result = evaluateCostLatencyGate(
      recordWith(fullEvidence(false, false)),
      policy.gates["cost-latency"],
    );
    expect(result.status).toBe("pass");
  });
});

describe("security/policy gate", () => {
  test("missing evidence -> 'missing'", () => {
    const result = evaluateSecurityPolicyGate(recordWith({}), policy.gates["security-policy"]);
    expect(result.status).toBe("missing");
    expect(result.detail).toContain("no security/policy evidence");
  });

  test("a failed check -> fail naming it", () => {
    const evidence = fullEvidence(false, false);
    const security = evidence.securityPolicy!;
    const checks = security.checks.map((c) =>
      c.checkId === "secret-scan" ? { ...c, passed: false } : c,
    );
    const result = evaluateSecurityPolicyGate(
      recordWith({ ...evidence, securityPolicy: { ...security, checks } }),
      policy.gates["security-policy"],
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("secret-scan");
  });

  test("a required check that never ran -> fail (absence is not a pass)", () => {
    const evidence = fullEvidence(false, false);
    const security = evidence.securityPolicy!;
    const checks = security.checks.filter((c) => c.checkId !== "rights-basis-audit");
    const result = evaluateSecurityPolicyGate(
      recordWith({ ...evidence, securityPolicy: { ...security, checks } }),
      policy.gates["security-policy"],
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("required check(s) never ran (rights-basis-audit)");
  });

  test("all required checks passed -> pass", () => {
    const result = evaluateSecurityPolicyGate(
      recordWith(fullEvidence(false, false)),
      policy.gates["security-policy"],
    );
    expect(result.status).toBe("pass");
  });
});

describe("canary gate", () => {
  test("missing evidence -> 'missing'", () => {
    const result = evaluateCanaryGate(recordWith({}), policy.gates.canary);
    expect(result.status).toBe("missing");
    expect(result.detail).toContain("no canary evidence");
  });

  test("a failed SLO check -> fail", () => {
    const evidence = fullEvidence(true, false);
    const canary = evidence.canary!;
    const sloChecks = canary.sloChecks.map((c) =>
      c.checkId === "slo-p95" ? { ...c, passed: false } : c,
    );
    const result = evaluateCanaryGate(
      recordWith({ ...evidence, canary: { ...canary, sloChecks } }),
      policy.gates.canary,
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("slo-p95");
  });

  test("rollback triggers observed during canary -> fail", () => {
    const evidence = fullEvidence(true, false);
    const canary = evidence.canary!;
    const result = evaluateCanaryGate(
      recordWith({ ...evidence, canary: { ...canary, rollbackTriggersObserved: 1 } }),
      policy.gates.canary,
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("1 rollback trigger(s) observed during canary");
  });

  test("too few observations -> fail", () => {
    const evidence = fullEvidence(true, false);
    const canary = evidence.canary!;
    const result = evaluateCanaryGate(
      recordWith({ ...evidence, canary: { ...canary, observations: 99 } }),
      policy.gates.canary,
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("observations 99 < 100");
  });

  test("a clean canary window -> pass", () => {
    const result = evaluateCanaryGate(recordWith(fullEvidence(true, false)), policy.gates.canary);
    expect(result.status).toBe("pass");
  });
});

describe("THE HARD RULE at the data level: no gate reads the simulator reward", () => {
  test("a simulator-reward-only record fails EVERY gate as 'missing'", () => {
    const rewardOnly = recordWith(simulatorRewardOnly());
    const results = evaluateGates(GATE_IDS, rewardOnly, policy.gates);
    for (const result of results) {
      expect(result.status).toBe("missing");
    }
    expect(allGatesPassed(results)).toBe(false);
  });

  test("the three mandatory independent inputs name the hard rule in their refusal", () => {
    const rewardOnly = recordWith(simulatorRewardOnly());
    const benchmark = evaluateBenchmarkGate(rewardOnly, policy.gates.benchmark);
    expect(benchmark.detail).toContain("simulator reward IS present");
    expect(benchmark.detail).toContain(
      "benchmark, robustness and rights mandatory INDEPENDENT inputs",
    );
    const robustness = evaluateRobustnessGate(rewardOnly, policy.gates.robustness);
    expect(robustness.detail).toContain("simulator reward IS present");
    const rights = evaluateRightsProvenanceGate(rewardOnly);
    expect(rights.detail).toContain("simulator reward IS present");
  });

  test("identical evidence passes identically with and without a reward (reward is inert)", () => {
    const without = evaluateGates(GATE_IDS, recordWith(fullEvidence(true, false)), policy.gates);
    const withReward = evaluateGates(GATE_IDS, recordWith(fullEvidence(true, true)), policy.gates);
    expect(without.map((r) => [r.gate, r.status])).toEqual(
      withReward.map((r) => [r.gate, r.status]),
    );
    expect(allGatesPassed(withReward)).toBe(true);
  });
});

describe("allGatesPassed", () => {
  test("is true only when every gate passed", () => {
    expect(
      allGatesPassed(evaluateGates(GATE_IDS, recordWith(fullEvidence(true, false)), policy.gates)),
    ).toBe(true);
    expect(allGatesPassed(evaluateGates(GATE_IDS, recordWith({}), policy.gates))).toBe(false);
    expect(allGatesPassed([])).toBe(true);
  });
});
