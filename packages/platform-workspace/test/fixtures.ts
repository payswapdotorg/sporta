/**
 * Shared test fixtures for the platform-workspace tests (REL-024): the
 * simulated external video platform stack — a registry carrying the
 * declared-quality fixture organizations (strong / weak / lying / draft /
 * second-strong), the corpus, the FILE-BACKED durable job store (real
 * journal, real checkpoints), and the wired workspace. Deterministic
 * clocks everywhere; scratch dirs are mkdtemp'd in /tmp and removed by
 * exact name after the run.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
import type { RightsBasis, UserUploadMetadata } from "@sporta/historical-corpus";
import { createFileJobStore, createManualClock } from "@sporta/durable-jobs";
import type { ManualClock } from "@sporta/durable-jobs";
import { createPlatformWorkspace } from "../src";
import type { PlatformWorkspace } from "../src";

// ---------------------------------------------------------------------------
// The scratch directory (mkdtemp'd; removed by exact name after the run)
// ---------------------------------------------------------------------------

let scratchDir = "";

/** The shared scratch dir (created once per test file run). */
export function scratch(): string {
  if (scratchDir === "") {
    scratchDir = mkdtempSync(join(tmpdir(), "sporta-platform-workspace-"));
  }
  return scratchDir;
}

/** Removes the scratch dir BY EXACT NAME (never a wildcard). */
export function cleanupScratch(): void {
  if (scratchDir !== "") {
    rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = "";
  }
}

// ---------------------------------------------------------------------------
// The example versioned promotion policy (the registry precedent)
// ---------------------------------------------------------------------------

export function examplePolicy(): PromotionPolicy {
  return {
    policyId: "workspace-example",
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
// The declared-quality fixture organizations
// ---------------------------------------------------------------------------

/** Benchmark evidence with EXPLICIT declared metrics + uncertainty. */
function declaredBenchmark(
  metrics: readonly { axis: string; value: number; ciLow: number; ciHigh: number }[],
): AdditionalEvidence["benchmark"] {
  return {
    corpusVersion: "corpus-v1",
    evaluatorVersion: "eval-v1",
    metrics: metrics.map((metric) => ({ axis: metric.axis, value: metric.value })),
    uncertainty: metrics.map((metric) => ({
      axis: metric.axis,
      ciLow: metric.ciLow,
      ciHigh: metric.ciHigh,
    })),
    artifactRefs: ["artifact-bench-1"],
  };
}

/** The strong org: fidelity 8.4 [8.0, 8.8], stylization 8.1 [7.6, 8.5], temporal 7.9 [7.4, 8.3]. */
const STRONG_QUALITY = [
  { axis: "fidelity", value: 8.4, ciLow: 8.0, ciHigh: 8.8 },
  { axis: "stylization", value: 8.1, ciLow: 7.6, ciHigh: 8.5 },
  { axis: "temporal", value: 7.9, ciLow: 7.4, ciHigh: 8.3 },
] as const;

/**
 * The lying org: the POLICY axes (fidelity/stylization/temporal) are
 * consistent and clear the registry's benchmark gate — but the record ALSO
 * declares an extra axis whose interval does NOT contain its value. The
 * registry gate sweeps only the policy's axes; the declared-quality gate
 * sweeps EVERY declared axis — the typed refusal fires at the output.
 */
const LYING_QUALITY = [
  { axis: "fidelity", value: 8.4, ciLow: 8.0, ciHigh: 8.8 },
  { axis: "stylization", value: 8.1, ciLow: 7.6, ciHigh: 8.5 },
  { axis: "temporal", value: 7.9, ciLow: 7.4, ciHigh: 8.3 },
  { axis: "sharpness", value: 5.0, ciLow: 9.0, ciHigh: 9.5 },
] as const;

/**
 * The premium org (the floor stack): every axis's conservative bound
 * clears an 8.0 floor — the declared-quality-floor PASS side.
 */
const PREMIUM_QUALITY = [
  { axis: "fidelity", value: 9.1, ciLow: 8.8, ciHigh: 9.4 },
  { axis: "stylization", value: 8.8, ciLow: 8.5, ciHigh: 9.1 },
  { axis: "temporal", value: 8.7, ciLow: 8.4, ciHigh: 9.0 },
] as const;

/**
 * The low-bound org (the floor stack): every VALUE clears the registry's
 * benchmark minimums (7.5/7.0/7.0) and every interval is self-consistent —
 * the organization legally reaches `validated` — but every conservative
 * ciLow sits BELOW an 8.0 workspace floor: the typed gate refusal fixture.
 */
const LOWBOUND_QUALITY = [
  { axis: "fidelity", value: 7.6, ciLow: 6.9, ciHigh: 8.2 },
  { axis: "stylization", value: 7.8, ciLow: 7.2, ciHigh: 8.3 },
  { axis: "temporal", value: 7.7, ciLow: 7.1, ciHigh: 8.2 },
] as const;

/** A new-organization input (the registry precedent). */
export function newOrgInput(overrides: Partial<NewOrganizationInput> = {}): NewOrganizationInput {
  return {
    organizationId: "org-strong",
    displayName: "Org Strong",
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

/** The non-benchmark evidence legs (identical for every fixture org). */
function fullNonBenchmarkEvidence(): AdditionalEvidence {
  return {
    reproducibility: {
      labRunId: "run-1",
      configurationVersion: "cfg-1",
      seed: "seed-42",
      reproductionRuns: 2,
      identicalRuns: 2,
      artifactRefs: ["artifact-repro-1", "artifact-repro-2"],
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
}

/** The canary evidence (the production step's extra leg). */
function canaryEvidence(): AdditionalEvidence["canary"] {
  return {
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

/**
 * Registers an organization and walks it to `validated` (selectable, all
 * six gates passed) with the GIVEN declared benchmark quality — the
 * declared-policy fixture axis for the quality-gate tests.
 */
async function orgWithDeclaredQuality(
  registry: ReturnType<typeof createOrganizationRegistry>,
  input: NewOrganizationInput,
  quality: readonly { axis: string; value: number; ciLow: number; ciHigh: number }[],
): Promise<void> {
  const policy = examplePolicy();
  await registry.register(input, { ...SYSTEM });
  await requestPromotion(registry, {
    organizationId: input.organizationId,
    policy,
    additionalEvidence: {
      reproducibility: fullNonBenchmarkEvidence().reproducibility,
      benchmark: declaredBenchmark(quality),
    },
  });
  await requestPromotion(registry, {
    organizationId: input.organizationId,
    policy,
    additionalEvidence: {
      robustness: fullNonBenchmarkEvidence().robustness,
      rightsProvenance: fullNonBenchmarkEvidence().rightsProvenance,
      securityPolicy: fullNonBenchmarkEvidence().securityPolicy,
      costLatency: fullNonBenchmarkEvidence().costLatency,
    },
  });
}

// ---------------------------------------------------------------------------
// The workspace stack
// ---------------------------------------------------------------------------

/** One deterministic workspace stack. */
export interface WorkspaceStack {
  readonly workspace: PlatformWorkspace;
  readonly clock: ManualClock;
  /** The job store the composition rides (canonical long-job state). */
  readonly jobs: ReturnType<typeof createFileJobStore>;
  readonly registry: ReturnType<typeof createOrganizationRegistry>;
  readonly corpus: ReturnType<typeof createCorpusStore>;
  /** The journal path backing the job store. */
  readonly journalPath: string;
  readonly strongOrganizationId: string;
  readonly secondStrongOrganizationId: string;
  readonly lyingOrganizationId: string;
  readonly draftOrganizationId: string;
}

/**
 * Builds the simulated external video platform stack: the fixture
 * organizations (strong x2 — fidelity 8.4 / 8.9, lying, draft), the
 * corpus, the file-backed job store, and the workspace wired with the
 * declared-quality gate's default floor (presence + consistency).
 */
export async function buildWorkspaceStack(
  name: string,
  options: { qualityFloor?: number } = {},
): Promise<WorkspaceStack> {
  const registry = createOrganizationRegistry({ clock: createRegistryDefaultClock() });

  // The strong production organization (auto-select's top fidelity pick
  // after beta exists; explicit-selection journeys use it).
  await orgWithDeclaredQuality(
    registry,
    newOrgInput({ organizationId: "org-strong", displayName: "Org Strong" }),
    STRONG_QUALITY,
  );
  // The second strong org — HIGHER declared fidelity: the auto-selection's
  // documented quality-descending ordering must pick it first.
  await orgWithDeclaredQuality(
    registry,
    newOrgInput({
      organizationId: "org-beta-strong",
      displayName: "Org Beta Strong",
      profile: {
        latency: { p50Ms: 900, p95Ms: 1700, p99Ms: 2400 },
        cost: { perRunUsd: 1.1 },
      },
    }),
    [
      { axis: "fidelity", value: 8.9, ciLow: 8.5, ciHigh: 9.2 },
      { axis: "stylization", value: 7.8, ciLow: 7.4, ciHigh: 8.1 },
      { axis: "temporal", value: 7.6, ciLow: 7.1, ciHigh: 8.0 },
    ],
  );
  // The lying org — validated on consistent policy axes, but carrying an
  // extra declared axis whose interval excludes its value (the gate refuses).
  await orgWithDeclaredQuality(
    registry,
    newOrgInput({
      organizationId: "org-lying",
      displayName: "Org Lying",
      profile: {
        latency: { p50Ms: 850, p95Ms: 1600, p99Ms: 2300 },
        cost: { perRunUsd: 1.3 },
      },
    }),
    LYING_QUALITY,
  );
  // The draft org — never promoted, never selectable (the typed boundary).
  await registry.register(newOrgInput({ organizationId: "org-draft", displayName: "Org Draft" }), {
    ...SYSTEM,
  });
  // The strong org also walks to PRODUCTION (the realistic pick).
  const policy = examplePolicy();
  await requestPromotion(registry, { organizationId: "org-strong", policy });
  await requestPromotion(registry, {
    organizationId: "org-strong",
    policy,
    additionalEvidence: { canary: canaryEvidence() },
  });

  const clock = createManualClock(10_000);
  const journalPath = join(scratch(), `${name}.journal.json`);
  const jobs = createFileJobStore(journalPath, { clock });
  const corpus = createCorpusStore({ clock });
  const workspace = createPlatformWorkspace({
    registry,
    corpus,
    jobs,
    clock,
    ...(options.qualityFloor !== undefined ? { qualityFloor: options.qualityFloor } : {}),
  });
  return {
    workspace,
    clock,
    jobs,
    registry,
    corpus,
    journalPath,
    strongOrganizationId: "org-strong",
    secondStrongOrganizationId: "org-beta-strong",
    lyingOrganizationId: "org-lying",
    draftOrganizationId: "org-draft",
  };
}

// ---------------------------------------------------------------------------
// The declared-quality-floor stack (the typed gate-failure fixture)
// ---------------------------------------------------------------------------

/** The floor stack's organizations: premium (passes 8.0) + low-bound (refuses). */
export interface QualityFloorStack {
  readonly workspace: PlatformWorkspace;
  readonly jobs: ReturnType<typeof createFileJobStore>;
  readonly registry: ReturnType<typeof createOrganizationRegistry>;
  readonly corpus: ReturnType<typeof createCorpusStore>;
  readonly premiumOrganizationId: string;
  readonly lowBoundOrganizationId: string;
}

/**
 * Builds the declared-quality-floor stack: a premium organization (every
 * ciLow clears 8.0) and a low-bound organization (legally validated, but
 * every ciLow below 8.0) under a workspace that DECLARES the 8.0 floor.
 */
export async function buildQualityFloorStack(name: string): Promise<QualityFloorStack> {
  const registry = createOrganizationRegistry({ clock: createRegistryDefaultClock() });
  await orgWithDeclaredQuality(
    registry,
    newOrgInput({ organizationId: "org-premium", displayName: "Org Premium" }),
    PREMIUM_QUALITY,
  );
  await orgWithDeclaredQuality(
    registry,
    newOrgInput({ organizationId: "org-lowbound", displayName: "Org Low Bound" }),
    LOWBOUND_QUALITY,
  );
  const clock = createManualClock(10_000);
  const journalPath = join(scratch(), `${name}.journal.json`);
  const jobs = createFileJobStore(journalPath, { clock });
  const corpus = createCorpusStore({ clock });
  const workspace = createPlatformWorkspace({
    registry,
    corpus,
    jobs,
    clock,
    qualityFloor: 8.0,
  });
  return {
    workspace,
    jobs,
    registry,
    corpus,
    premiumOrganizationId: "org-premium",
    lowBoundOrganizationId: "org-lowbound",
  };
}

// ---------------------------------------------------------------------------
// Upload builders (the simulated platform's declared basis + metadata)
// ---------------------------------------------------------------------------

/** The simulated external platform's user-ownership basis. */
export function platformUploadBasis(overrides: Partial<RightsBasis> = {}): RightsBasis {
  return {
    basisType: "user-declared-ownership",
    grantRef: "declaration:platform-upload-42",
    scope: "acquisition for transformation and delivery",
    declaredBy: "platform:video-platform",
    ...overrides,
  };
}

/** The simulated platform's upload metadata. */
export function uploadMetadata(overrides: Partial<UserUploadMetadata> = {}): UserUploadMetadata {
  return {
    ownerRef: "platform:video-platform",
    observedAt: 1_700_000_100_000,
    restrictions: [],
    title: "Match clip 42",
    description: "a football clip the platform holds",
    ...overrides,
  };
}

/** Deterministic fixture bytes (real digests regardless of content). */
export function fixtureBytes(seed: string, length = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  let hash = 0;
  for (let i = 0; i < length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i % seed.length) + i) % 256;
    bytes[i] = hash;
  }
  return bytes;
}

/** SHA-256 hex of bytes (re-derived by tests to verify the real digests). */
export async function sha256HexBytes(bytes: Uint8Array<ArrayBufferLike>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The simulated external video platform's connection identity. */
export const SIMULATED_PLATFORM = {
  platformId: "platform:video-platform",
  tenantId: "tenant-platform-1",
} as const;

/** A second platform/tenant (the isolation sweep). */
export const OTHER_PLATFORM = {
  platformId: "platform:other-platform",
  tenantId: "tenant-other-1",
} as const;
