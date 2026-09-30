/**
 * Shared test fixtures for the external-platform tests (REL-014/015/016):
 * deterministic platform stacks (registry with a walked-to-production
 * organization + corpus + file-backed job store + the wired platform), the
 * example promotion policy, media/feed submission builders. Everything is
 * deterministic (manual clocks, sequential ids, scratch dirs cleaned by
 * exact name) — the parity tests depend on byte-identical envelopes across
 * two identically-seeded platforms.
 */
import { join } from "node:path";
import type {
  AdditionalEvidence,
  NewOrganizationInput,
  PromotionPolicy,
} from "@sporta/organization-registry";
import {
  createOrganizationRegistry,
  createRegistryDefaultClock,
  requestPromotion,
} from "@sporta/organization-registry";
import { createCorpusStore } from "@sporta/historical-corpus";
import type { RightsBasis, SourceMetadata, UserUploadMetadata } from "@sporta/historical-corpus";
import { createFileJobStore, createManualClock } from "@sporta/durable-jobs";
import type { ManualClock } from "@sporta/durable-jobs";
import { createExternalPlatform } from "../src";
import type { ExternalPlatform } from "../src";
import type { PlatformQualityGate } from "../src";

/** The example versioned policy (the organization-registry precedent). */
export function examplePolicy(): PromotionPolicy {
  return {
    policyId: "platform-example",
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

/** A full six-gate evidence bundle that clears the example policy. */
function fullEvidence(withCanary: boolean): AdditionalEvidence {
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
      knownFailureEnvelope: ["degrades on heavy rain occlusion"],
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
  return evidence;
}

/** A new-organization input. */
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
      { capabilityId: "render.anime", capabilityVersion: "2.1.0" },
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

const SYSTEM = { actorType: "system", actorId: "test-harness" } as const;

/** The two gates needed to reach `benchmarked` (for staged promotion tests). */
export function benchmarkStageEvidence(): AdditionalEvidence {
  const full = fullEvidence(false);
  return { reproducibility: full.reproducibility, benchmark: full.benchmark };
}

/** The four gates needed to reach `validated` (for staged promotion tests). */
export function validationStageEvidence(): AdditionalEvidence {
  const full = fullEvidence(false);
  return {
    robustness: full.robustness,
    rightsProvenance: full.rightsProvenance,
    securityPolicy: full.securityPolicy,
    costLatency: full.costLatency,
  };
}

/** Registers an org and walks it to the requested status. */
export async function walkToStatus(
  registry: ReturnType<typeof createOrganizationRegistry>,
  organizationId: string,
  status: "draft" | "benchmarked" | "validated" | "canary" | "production",
): Promise<void> {
  const policy = examplePolicy();
  if (status === "draft") return;
  await requestPromotion(registry, {
    organizationId,
    policy,
    additionalEvidence: {
      reproducibility: fullEvidence(false).reproducibility,
      benchmark: fullEvidence(false).benchmark,
    },
  });
  if (status === "benchmarked") return;
  const validation = fullEvidence(false);
  await requestPromotion(registry, {
    organizationId,
    policy,
    additionalEvidence: {
      robustness: validation.robustness,
      rightsProvenance: validation.rightsProvenance,
      securityPolicy: validation.securityPolicy,
      costLatency: validation.costLatency,
    },
  });
  if (status === "validated") return;
  await requestPromotion(registry, { organizationId, policy });
  if (status === "canary") return;
  await requestPromotion(registry, {
    organizationId,
    policy,
    additionalEvidence: { canary: fullEvidence(true).canary },
  });
}

/** One deterministic platform stack. */
export interface PlatformStack {
  readonly platform: ExternalPlatform;
  readonly clock: ManualClock;
  /** The job store the platform is wired to (the canonical long-job state). */
  readonly jobs: ReturnType<typeof createFileJobStore>;
  /** The journal path backing the job store. */
  readonly journalPath: string;
  /** A second organization in draft (never promoted). */
  readonly draftOrganizationId: string;
  /** The production organization id. */
  readonly productionOrganizationId: string;
}

/** Builds a platform stack: registry (1 production org + 1 draft org) + corpus + file jobs. */
export async function buildStack(dir: string, name: string): Promise<PlatformStack> {
  const registry = createOrganizationRegistry({ clock: createRegistryDefaultClock() });
  await registry.register(newOrgInput(), { ...SYSTEM });
  await registry.register(newOrgInput({ organizationId: "org-draft", displayName: "Org Draft" }), {
    ...SYSTEM,
  });
  await walkToStatus(registry, "org-alpha", "production");
  const clock = createManualClock(10_000);
  const journalPath = join(dir, `${name}.journal.json`);
  const jobs = createFileJobStore(journalPath, { clock });
  const corpus = createCorpusStore({ clock });
  const platform = createExternalPlatform({ registry, corpus, jobs, clock });
  return {
    platform,
    clock,
    jobs,
    journalPath,
    draftOrganizationId: "org-draft",
    productionOrganizationId: "org-alpha",
  };
}

/** A platform-declared user-ownership basis for direct media uploads. */
export function platformUploadBasis(overrides: Partial<RightsBasis> = {}): RightsBasis {
  return {
    basisType: "user-declared-ownership",
    grantRef: "declaration:platform-upload-42",
    scope: "acquisition for transformation and delivery",
    declaredBy: "platform:video-platform",
    ...overrides,
  };
}

/** A platform-declared authorized-feed basis for feed items. */
export function platformFeedBasis(overrides: Partial<RightsBasis> = {}): RightsBasis {
  return {
    basisType: "authorized-feed",
    grantRef: "agreement:platform-feed-77",
    scope: "acquisition for normalization and transformation",
    declaredBy: "platform:video-platform",
    ...overrides,
  };
}

/** Feed item metadata. */
export function feedItemMetadata(
  id: string,
  overrides: Partial<SourceMetadata> = {},
): SourceMetadata {
  return {
    provider: "platform-feed",
    providerContentId: id,
    canonicalUrl: `https://platform.example/feeds/${id}`,
    ownerRef: "platform:video-platform",
    observedAt: 1_700_000_000_000,
    availability: "publicly-listed",
    restrictions: [],
    title: `Feed item ${id}`,
    description: "platform feed item",
    ...overrides,
  };
}

/** Upload metadata for direct media submission. */
export function uploadMetadata(overrides: Partial<UserUploadMetadata> = {}): UserUploadMetadata {
  return {
    ownerRef: "platform:video-platform",
    observedAt: 1_700_000_100_000,
    restrictions: [],
    title: "Platform upload",
    description: "a video the platform holds",
    ...overrides,
  };
}

/** Deterministic fixture bytes. */
export function fixtureBytes(seed: string, length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  let hash = 0;
  for (let i = 0; i < length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i % seed.length) + i) % 256;
    bytes[i] = hash;
  }
  return bytes;
}

/** A quality gate that always fails (the fail-closed pipeline probe). */
export function failingQualityGate(reason: string): PlatformQualityGate {
  return {
    gateId: "always-failing/v0",
    async evaluate() {
      return {
        gateId: "always-failing/v0",
        passed: false,
        checks: [{ name: reason, passed: false, detail: "injected fixture failure" }],
      };
    },
  };
}
