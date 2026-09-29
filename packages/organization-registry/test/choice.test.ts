/**
 * REL-019 choice tests: the honest read model — ALL eligible organizations
 * (>= 2) with VISIBLE evidence, no hidden ranking fields, ordering only by
 * declared recorded criteria, and excluded statuses never surfacing.
 */
import { describe, expect, test } from "bun:test";
import {
  applyChoiceOrdering,
  choiceForRequest,
  describeChoiceOrdering,
  requestPromotion,
  requestRollback,
  toChoiceCandidate,
} from "../src";
import type { ChoiceCandidate } from "../src";
import { examplePolicy, fullEvidence, newOrgInput, newRegistry, walkToStatus } from "./fixtures";

const SYSTEM = { actorType: "system", actorId: "test-harness" } as const;

/**
 * A registry with THREE eligible organizations (REL-A5's >= 2) plus one
 * draft and one retired — the honest choice surface:
 *  - org-fast:  production, cheap, fast, benchmark fidelity 8.4, HAS a simulator reward
 *  - org-slow:  production, pricier, slower, benchmark fidelity 9.1 (best quality), tactical-only
 *  - org-mid:   validated, mid cost/latency, fidelity 8.4 (ties org-fast), NO reward
 * plus org-draft (draft, never eligible) and org-dead (retired).
 */
async function choiceRegistry() {
  const registry = newRegistry();
  const fast = {
    ...newOrgInput(),
    organizationId: "org-fast",
    displayName: "Fast Football Org",
    profile: { latency: { p50Ms: 400, p95Ms: 700, p99Ms: 900 }, cost: { perRunUsd: 0.4 } },
    provenance: { ...newOrgInput().provenance, owner: "team-fast" },
  };
  const slow = {
    ...newOrgInput(),
    organizationId: "org-slow",
    displayName: "Quality First Org",
    domain: { ...newOrgInput().domain, renderers: ["tactical"] },
    profile: { latency: { p50Ms: 1500, p95Ms: 2800, p99Ms: 3500 }, cost: { perRunUsd: 1.8 } },
    provenance: { ...newOrgInput().provenance, owner: "team-slow" },
  };
  const mid = {
    ...newOrgInput(),
    organizationId: "org-mid",
    displayName: "Mid Tier Org",
    profile: { latency: { p50Ms: 900, p95Ms: 1600, p99Ms: 2000 }, cost: { perRunUsd: 1.0 } },
    provenance: { ...newOrgInput().provenance, owner: "team-mid" },
  };
  await registry.register(fast, { ...SYSTEM });
  await registry.register(slow, { ...SYSTEM });
  await registry.register(mid, { ...SYSTEM });
  await registry.register({ ...newOrgInput(), organizationId: "org-draft" }, { ...SYSTEM });
  await registry.register({ ...newOrgInput(), organizationId: "org-dead" }, { ...SYSTEM });

  const policy = examplePolicy();
  const reward = { simulatorReward: fullEvidence(false, true).simulatorReward };
  // org-fast: full evidence + a simulator reward (visible as what it is), to production.
  await requestPromotion(registry, {
    organizationId: "org-fast",
    policy,
    additionalEvidence: { ...fullEvidence(false, false), ...reward },
  });
  await requestPromotion(registry, { organizationId: "org-fast", policy });
  await requestPromotion(registry, {
    organizationId: "org-fast",
    policy,
    additionalEvidence: { canary: fullEvidence(true, false).canary },
  });
  await requestPromotion(registry, { organizationId: "org-fast", policy });
  // org-slow: the best fidelity, to production.
  const better = fullEvidence(false, false);
  better.benchmark!.metrics = better.benchmark!.metrics.map((m) =>
    m.axis === "fidelity" ? { ...m, value: 9.1 } : m,
  );
  better.benchmark!.uncertainty = better.benchmark!.uncertainty.map((u) =>
    u.axis === "fidelity" ? { ...u, ciLow: 8.8, ciHigh: 9.4 } : u,
  );
  await requestPromotion(registry, {
    organizationId: "org-slow",
    policy,
    additionalEvidence: better,
  });
  await requestPromotion(registry, { organizationId: "org-slow", policy });
  await requestPromotion(registry, {
    organizationId: "org-slow",
    policy,
    additionalEvidence: { canary: fullEvidence(true, false).canary },
  });
  await requestPromotion(registry, { organizationId: "org-slow", policy });
  // org-mid: validated only (eligible, never canaried).
  await requestPromotion(registry, {
    organizationId: "org-mid",
    policy,
    additionalEvidence: fullEvidence(false, false),
  });
  await requestPromotion(registry, { organizationId: "org-mid", policy });
  // org-dead: walk to production then retire.
  await walkToStatus(registry, "org-dead", "production");
  await requestRollback(registry, {
    organizationId: "org-dead",
    trigger: "rights-failure",
    policy,
  });
  return registry;
}

describe("the choice query (REL-019)", () => {
  test("returns ALL eligible organizations (3 >= 2) — never a single 'winner'", async () => {
    const registry = await choiceRegistry();
    const result = await choiceForRequest(registry, { domain: "football" });
    expect(result.candidates.length).toBe(3);
    expect(result.candidates.map((c) => c.organizationId)).toEqual([
      "org-fast",
      "org-slow",
      "org-mid",
    ]);
    // draft and retired NEVER surface.
    expect(result.candidates.some((c) => c.organizationId === "org-draft")).toBe(false);
    expect(result.candidates.some((c) => c.organizationId === "org-dead")).toBe(false);
  });

  test("each candidate carries VISIBLE evidence: benchmark, uncertainty, robustness, cost/latency, rights, version", async () => {
    const registry = await choiceRegistry();
    const result = await choiceForRequest(registry, { domain: "football" });
    const fast = result.candidates.find((c) => c.organizationId === "org-fast");
    expect(fast).toBeDefined();
    if (!fast) throw new Error("unreachable");
    // Benchmark summary with metrics + uncertainty.
    expect(fast.evidence.benchmark?.corpusVersion).toBe("corpus-v1");
    expect(fast.evidence.benchmark?.metrics.find((m) => m.axis === "fidelity")?.value).toBe(8.4);
    expect(fast.evidence.benchmark?.uncertainty.find((u) => u.axis === "stylization")).toEqual({
      axis: "stylization",
      ciLow: 7.6,
      ciHigh: 8.5,
    });
    // Robustness summary.
    expect(fast.evidence.robustness).toMatchObject({
      seedsTested: 5,
      seedsPassed: 5,
      outOfDistributionScore: 7.2,
      simulatorModelAgreement: 0.91,
      benchmarkCorpusCoverage: 0.85,
    });
    // Cost/latency profile + version + status.
    expect(fast.profile).toEqual({
      latency: { p50Ms: 400, p95Ms: 700, p99Ms: 900 },
      cost: { perRunUsd: 0.4 },
    });
    expect(fast.version).toBe(7);
    expect(fast.status).toBe("production");
    // Rights requirements + provenance.
    expect(fast.evidence.rightsRequirements[0]?.description).toContain("licensed match footage");
    expect(fast.evidence.provenance.owner).toBe("team-fast");
    expect(fast.evidence.provenance.createdFrom).toEqual({ labRunId: "run-1" });
    // Known limitations are the robustness failure envelope.
    expect(fast.knownLimitations).toContain("degrades on heavy rain occlusion");
  });

  test("a simulator reward is visible as what it is — never merged into quality", async () => {
    const registry = await choiceRegistry();
    const result = await choiceForRequest(registry, { domain: "football" });
    const fast = result.candidates.find((c) => c.organizationId === "org-fast");
    const mid = result.candidates.find((c) => c.organizationId === "org-mid");
    expect(fast?.evidence.simulatorReward).toEqual({ score: 98.7, rewardVersion: "reward-v1" });
    expect(mid?.evidence.simulatorReward).toBeNull();
  });

  test("NO hidden ranking fields: the candidate keys are exactly the read model", async () => {
    const registry = await choiceRegistry();
    const result = await choiceForRequest(registry, { domain: "football" });
    const candidate = result.candidates[0];
    if (!candidate) throw new Error("unreachable");
    expect(Object.keys(candidate).sort()).toEqual([
      "displayName",
      "domain",
      "evidence",
      "knownLimitations",
      "organizationId",
      "profile",
      "status",
      "version",
    ]);
    expect(Object.keys(candidate.evidence).sort()).toEqual([
      "benchmark",
      "provenance",
      "rightsRequirements",
      "robustness",
      "simulatorReward",
    ]);
    // No rank / weight / priority ANYWHERE in the serialized candidates.
    const serialized = JSON.stringify(result.candidates);
    expect(serialized).not.toMatch(/"(rank|ranking|weight|priority)"/);
  });
});

describe("declared, recorded ordering (no hidden criteria)", () => {
  test("registry-order (the default): registration sequence, explicitly declared", async () => {
    const registry = await choiceRegistry();
    const result = await choiceForRequest(registry, { domain: "football" });
    expect(result.ordering).toEqual({ kind: "registry-order" });
    expect(result.orderedBy).toBe("registry order (registration sequence; no ranking applied)");
    expect(result.candidates.map((c) => c.organizationId)).toEqual([
      "org-fast",
      "org-slow",
      "org-mid",
    ]);
  });

  test("cost-ascending: cheapest first", async () => {
    const registry = await choiceRegistry();
    const result = await choiceForRequest(
      registry,
      { domain: "football" },
      { kind: "cost-ascending" },
    );
    expect(result.candidates.map((c) => c.organizationId)).toEqual([
      "org-fast",
      "org-mid",
      "org-slow",
    ]);
    expect(result.orderedBy).toContain("cost ascending");
  });

  test("latency-ascending: lowest p95 first", async () => {
    const registry = await choiceRegistry();
    const result = await choiceForRequest(
      registry,
      { domain: "football" },
      { kind: "latency-ascending" },
    );
    expect(result.candidates.map((c) => c.organizationId)).toEqual([
      "org-fast",
      "org-mid",
      "org-slow",
    ]);
    expect(result.orderedBy).toContain("latency ascending");
  });

  test("quality-descending on a NAMED axis: best fidelity first; absent axis sorts last", () => {
    const candidates: ChoiceCandidate[] = [
      candidateWithFidelity("org-a", 8.0),
      candidateWithFidelity("org-b", 9.0),
      candidateWithFidelity("org-c", null), // no fidelity axis at all
    ];
    const sorted = applyChoiceOrdering(candidates, {
      kind: "quality-descending",
      axis: "fidelity",
    });
    expect(sorted.map((c) => c.organizationId)).toEqual(["org-b", "org-a", "org-c"]);
    expect(describeChoiceOrdering({ kind: "quality-descending", axis: "fidelity" })).toContain(
      "without that axis sort last",
    );
  });

  test("quality-descending through the full query: org-slow's 9.1 beats both 8.4s", async () => {
    const registry = await choiceRegistry();
    const result = await choiceForRequest(
      registry,
      { domain: "football" },
      { kind: "quality-descending", axis: "fidelity" },
    );
    expect(result.candidates.map((c) => c.organizationId)).toEqual([
      "org-slow",
      "org-fast",
      "org-mid",
    ]);
  });

  test("ties break deterministically by organization id", () => {
    const candidates = [
      candidateWithFidelity("org-z", 8.0),
      candidateWithFidelity("org-a", 8.0),
      candidateWithFidelity("org-m", 8.0),
    ];
    const sorted = applyChoiceOrdering(candidates, {
      kind: "quality-descending",
      axis: "fidelity",
    });
    expect(sorted.map((c) => c.organizationId)).toEqual(["org-a", "org-m", "org-z"]);
  });

  test("every ordering kind has an in-words description", () => {
    expect(describeChoiceOrdering({ kind: "registry-order" })).toContain("no ranking applied");
    expect(describeChoiceOrdering({ kind: "cost-ascending" })).toContain("per-run USD");
    expect(describeChoiceOrdering({ kind: "latency-ascending" })).toContain("p95 milliseconds");
  });
});

describe("the choice honors the request's constraints", () => {
  test("a latency ceiling drops the slow org (an honest narrowing, not a ranking)", async () => {
    const registry = await choiceRegistry();
    const result = await choiceForRequest(registry, { domain: "football", maxP95LatencyMs: 2000 });
    expect(result.candidates.map((c) => c.organizationId)).toEqual(["org-fast", "org-mid"]);
    expect(result.request).toEqual({ domain: "football", maxP95LatencyMs: 2000 });
  });

  test("a budget ceiling drops the expensive org", async () => {
    const registry = await choiceRegistry();
    const result = await choiceForRequest(registry, {
      domain: "football",
      maxBudgetPerRunUsd: 1.0,
    });
    expect(result.candidates.map((c) => c.organizationId)).toEqual(["org-fast", "org-mid"]);
  });

  test("a renderer requirement drops org-slow (tactical-only)", async () => {
    const registry = await choiceRegistry();
    const result = await choiceForRequest(registry, { domain: "football", renderer: "anime" });
    expect(result.candidates.map((c) => c.organizationId)).toEqual(["org-fast", "org-mid"]);
  });

  test("an over-constrained request returns an honest EMPTY list", async () => {
    const registry = await choiceRegistry();
    const result = await choiceForRequest(registry, {
      domain: "football",
      maxBudgetPerRunUsd: 0.01,
    });
    expect(result.candidates).toEqual([]);
  });
});

describe("toChoiceCandidate (the projection)", () => {
  test("projects a registry record without rank/weight fields", async () => {
    const registry = await choiceRegistry();
    const record = await registry.get("org-fast");
    const candidate = toChoiceCandidate(record);
    expect(candidate.organizationId).toBe("org-fast");
    expect(candidate.version).toBe(record.version);
    expect(candidate.evidence.benchmark?.metrics.length).toBe(3);
    expect(JSON.stringify(candidate)).not.toMatch(/"(rank|ranking|weight)"/);
  });
});

/** A minimal candidate for pure ordering tests. */
function candidateWithFidelity(organizationId: string, fidelity: number | null): ChoiceCandidate {
  const metrics =
    fidelity === null
      ? [{ axis: "stylization", value: 8.0 }]
      : [
          { axis: "fidelity", value: fidelity },
          { axis: "stylization", value: 8.0 },
        ];
  return {
    organizationId,
    version: 1,
    displayName: organizationId,
    status: "production",
    domain: {
      domains: ["football"],
      eventTypes: ["match"],
      modes: ["batch"],
      renderers: ["tactical"],
    },
    evidence: {
      benchmark: {
        corpusVersion: "corpus-v1",
        evaluatorVersion: "eval-v1",
        metrics,
        uncertainty: metrics.map((m) => ({
          axis: m.axis,
          ciLow: m.value - 0.4,
          ciHigh: m.value + 0.4,
        })),
      },
      robustness: null,
      simulatorReward: null,
      rightsRequirements: [],
      provenance: { owner: "x", lineage: [], createdFrom: null },
    },
    profile: { latency: { p50Ms: 1, p95Ms: 1, p99Ms: 1 }, cost: { perRunUsd: 1 } },
    knownLimitations: [],
  };
}
