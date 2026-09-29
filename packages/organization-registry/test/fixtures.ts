/**
 * Shared test fixtures for the organization-registry tests: builders for
 * organization inputs, evidence bundles that pass the example policy, and
 * the example policy itself. Deterministic clocks everywhere — no wall time.
 */
import type { AdditionalEvidence, NewOrganizationInput, OrganizationRecord } from "../src";
import {
  REGISTRY_DEFAULT_EPOCH_MS,
  createOrganizationRegistry,
  createRegistryDefaultClock,
  requestPromotion,
} from "../src";
import type { PromotionPolicy } from "../src";

// ---------------------------------------------------------------------------
// The example versioned policy (the bars the fixtures' evidence clears)
// ---------------------------------------------------------------------------

export function examplePolicy(): PromotionPolicy {
  return {
    policyId: "rel-promotion",
    version: 1,
    gates: {
      reproducibility: { minReproductionRuns: 2 },
      benchmark: { minimumScores: { fidelity: 7.5, stylization: 7.0, temporal: 7.0 } },
      robustness: {
        minSeedsTested: 3,
        minOutOfDistributionScore: 6.0,
        minSimulatorModelAgreement: 0.8,
        minBenchmarkCorpusCoverage: 0.7,
      },
      "rights-provenance": {},
      "cost-latency": { maxP95LatencyMs: 3000, maxPerRunUsd: 2.0, minSampleCount: 20 },
      "security-policy": {
        requiredChecks: ["content-policy", "secret-scan", "rights-basis-audit"],
      },
      canary: { minCanaryObservations: 100 },
    },
    rollback: {
      allowedTriggers: ["hard-slo-failure", "policy-violation", "rights-failure", "cost-blowout"],
      demoteTriggers: ["hard-slo-failure"],
    },
  };
}

// ---------------------------------------------------------------------------
// Organization inputs
// ---------------------------------------------------------------------------

export function newOrgInput(overrides: Partial<NewOrganizationInput> = {}): NewOrganizationInput {
  return {
    organizationId: "org-alpha",
    displayName: "Org Alpha",
    domain: {
      domains: ["football"],
      eventTypes: ["match", "clip"],
      modes: ["live", "batch"],
      renderers: ["tactical", "anime"],
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
      latency: { p50Ms: 800, p95Ms: 1500, p99Ms: 2200 },
      cost: { perRunUsd: 1.2 },
    },
    provenance: {
      owner: "team-alpha",
      lineage: ["lineage-root-1"],
      rightsRequirements: [
        {
          requirementId: "rr-1",
          description: "licensed match footage only",
          scope: "source-media",
        },
      ],
      createdFrom: { labRunId: "run-1" },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Evidence bundles (each clears the example policy's bars)
// ---------------------------------------------------------------------------

/** The full six-gate evidence bundle (+ optional canary / reward). */
export function fullEvidence(withCanary: boolean, withReward: boolean): AdditionalEvidence {
  const evidence: AdditionalEvidence = {
    reproducibility: {
      labRunId: "run-1",
      configurationVersion: "cfg-1",
      seed: "seed-42",
      reproductionRuns: 2,
      identicalRuns: 2,
      artifactRefs: ["artifact-repro-1", "artifact-repro-2"],
    },
    benchmark: {
      corpusVersion: "corpus-v1",
      evaluatorVersion: "eval-v1",
      metrics: [
        { axis: "fidelity", value: 8.4 },
        { axis: "stylization", value: 8.1 },
        { axis: "temporal", value: 7.9 },
      ],
      uncertainty: [
        { axis: "fidelity", ciLow: 8.0, ciHigh: 8.8 },
        { axis: "stylization", ciLow: 7.6, ciHigh: 8.5 },
        { axis: "temporal", ciLow: 7.4, ciHigh: 8.3 },
      ],
      artifactRefs: ["artifact-bench-1"],
    },
    robustness: {
      seedsTested: 5,
      seedsPassed: 5,
      outOfDistributionScore: 7.2,
      simulatorModelAgreement: 0.91,
      benchmarkCorpusCoverage: 0.85,
      knownFailureEnvelope: [
        "degrades on heavy rain occlusion",
        "crowd scan noise above 60fps sources",
      ],
      artifactRefs: ["artifact-robust-1"],
    },
    rightsProvenance: {
      basisType: "licensed",
      rightsBasisId: "rb-1",
      licenses: [{ licenseId: "l-1", scope: "match-rendering" }],
      provenanceLineage: ["lin-1", "lin-2"],
      artifactRefs: ["artifact-rights-1"],
    },
    securityPolicy: {
      policyVersion: "sec-v1",
      checks: [
        { checkId: "content-policy", passed: true },
        { checkId: "secret-scan", passed: true },
        { checkId: "rights-basis-audit", passed: true },
      ],
      artifactRefs: ["artifact-sec-1"],
    },
    costLatency: {
      sampleCount: 50,
      artifactRefs: ["artifact-cost-1"],
    },
  };
  if (withCanary) {
    evidence.canary = {
      canaryWindowMs: 3_600_000,
      observations: 250,
      sloChecks: [
        { checkId: "slo-p95", passed: true },
        { checkId: "slo-quality", passed: true },
      ],
      rollbackTriggersObserved: 0,
      artifactRefs: ["artifact-canary-1"],
    };
  }
  if (withReward) {
    evidence.simulatorReward = {
      score: 98.7,
      rewardVersion: "reward-v1",
      labRunId: "run-1",
      artifactRefs: ["artifact-reward-1"],
    };
  }
  return evidence;
}

/** Only the two gates needed to reach `benchmarked`. */
export function benchmarkStageEvidence(): AdditionalEvidence {
  const full = fullEvidence(false, false);
  return {
    reproducibility: full.reproducibility,
    benchmark: full.benchmark,
  };
}

/** The four gates needed to reach `validated` (on top of the benchmark stage). */
export function validationStageEvidence(): AdditionalEvidence {
  const full = fullEvidence(false, false);
  return {
    robustness: full.robustness,
    rightsProvenance: full.rightsProvenance,
    securityPolicy: full.securityPolicy,
    costLatency: full.costLatency,
  };
}

/** Only a simulator reward — THE HARD RULE's refusal fixture. */
export function simulatorRewardOnly(): AdditionalEvidence {
  const full = fullEvidence(false, true);
  return { simulatorReward: full.simulatorReward };
}

// ---------------------------------------------------------------------------
// The walk helpers (drive an organization along the lifecycle)
// ---------------------------------------------------------------------------

const SYSTEM = { actorType: "system", actorId: "test-harness" } as const;

/** A registry with the deterministic default clock (no wall time). */
export function newRegistry() {
  return createOrganizationRegistry({ clock: createRegistryDefaultClock() });
}

/** Registers an organization in draft. */
export async function registerOrg(
  overrides: Partial<NewOrganizationInput> = {},
): Promise<{ registry: ReturnType<typeof newRegistry>; record: OrganizationRecord }> {
  const registry = newRegistry();
  const record = await registry.register(newOrgInput(overrides), { ...SYSTEM });
  return { registry, record };
}

/**
 * Walks an ALREADY-REGISTERED organization from draft to the requested
 * status under the example policy, submitting stage-appropriate evidence.
 * `withReward` adds a simulator reward alongside (it must never matter).
 */
export async function walkToStatus(
  registry: ReturnType<typeof newRegistry>,
  organizationId: string,
  status: "draft" | "benchmarked" | "validated" | "canary" | "production",
  options: { withReward?: boolean } = {},
): Promise<OrganizationRecord> {
  const policy = examplePolicy();
  const withReward = options.withReward ?? false;
  if (status === "draft") return registry.get(organizationId);
  const reward = withReward ? { simulatorReward: fullEvidence(false, true).simulatorReward } : {};
  await requestPromotion(registry, {
    organizationId,
    policy,
    additionalEvidence: { ...benchmarkStageEvidence(), ...reward },
  });
  if (status === "benchmarked") return registry.get(organizationId);
  await requestPromotion(registry, {
    organizationId,
    policy,
    additionalEvidence: validationStageEvidence(),
  });
  if (status === "validated") return registry.get(organizationId);
  await requestPromotion(registry, { organizationId, policy });
  if (status === "canary") return registry.get(organizationId);
  await requestPromotion(registry, {
    organizationId,
    policy,
    additionalEvidence: { canary: fullEvidence(true, false).canary },
  });
  return registry.get(organizationId);
}

/**
 * Convenience: registers a fresh organization and walks it to the requested
 * status in its own registry.
 */
export async function orgAtStatus(
  status: "draft" | "benchmarked" | "validated" | "canary" | "production",
  options: { organizationId?: string; withReward?: boolean } = {},
): Promise<{ registry: ReturnType<typeof newRegistry>; record: OrganizationRecord }> {
  const organizationId = options.organizationId ?? "org-alpha";
  const { registry } = await registerOrg({ organizationId });
  const record = await walkToStatus(registry, organizationId, status, {
    withReward: options.withReward,
  });
  return { registry, record };
}

/** The deterministic epoch the default clock starts from (2025-01-06T12:00Z). */
export const EXPECTED_EPOCH_MS = REGISTRY_DEFAULT_EPOCH_MS;
