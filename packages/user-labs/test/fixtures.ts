/**
 * Shared test fixtures for the user-labs tests: a fully-wired harness
 * (labs + exchange on one controllable clock), the injected source-data port
 * (the historical-corpus seam), the scripted run port (the durable-run
 * seam), candidate payloads (complete + incomplete), incentive policies
 * (v1/v2) and import scopes. Deterministic clocks everywhere — no wall time.
 */
import type {
  BenchmarkEvidenceSummary,
  CandidateDefinition,
  DomainCatalog,
  LabRunCandidatePayload,
  LabRunRecord,
  LabRunRequest,
  LabRunPort,
  RightsRequirement,
  SecurityPolicyEvidenceSummary,
  SourceDataPort,
  SourceDataRecord,
  SourceRightsBasisType,
  TenantRef,
} from "../src";
import {
  USER_LABS_DEFAULT_EPOCH_MS,
  createExchange,
  createIncentiveLedger,
  createIncentivePolicyStore,
  createUserLabs,
  toIsoUtc,
} from "../src";
import type { Exchange, IncentiveLedger, IncentivePolicy, IncentivePolicyStore } from "../src";
import type { UserLabs } from "../src";
import { LabInternalError } from "../src";

export const DAY_MS = 86_400_000;

/** The deterministic epoch the fixtures' clocks start from. */
export const TEST_EPOCH_MS = USER_LABS_DEFAULT_EPOCH_MS; // 2025-01-06T12:00:00.000Z

export const tenantA: TenantRef = { tenantId: "tenant-a" };
export const tenantB: TenantRef = { tenantId: "tenant-b" };

// ---------------------------------------------------------------------------
// The controllable clock (tests cross policy-version boundaries with it)
// ---------------------------------------------------------------------------

export interface MutableClock {
  clock: () => number;
  advance: (ms: number) => number;
  set: (ms: number) => void;
  nowMs: () => number;
}

export function createMutableClock(startMs: number = TEST_EPOCH_MS): MutableClock {
  let now = startMs;
  return {
    clock: () => now,
    advance: (ms) => (now += ms),
    set: (ms) => {
      now = ms;
    },
    nowMs: () => now,
  };
}

// ---------------------------------------------------------------------------
// The domain catalog
// ---------------------------------------------------------------------------

export function fixtureDomainCatalog(): DomainCatalog {
  return [
    { domainPackId: "football", tasks: ["match", "clip"] },
    { domainPackId: "basketball", tasks: ["match"] },
  ];
}

// ---------------------------------------------------------------------------
// The source-data port fixture (the historical corpus seam)
// ---------------------------------------------------------------------------

export interface SourceDataFixture {
  port: SourceDataPort;
  /** Flips a known ref's rights basis (the run-time fail-closed re-check test). */
  setRightsBasis: (ref: string, basisType: SourceRightsBasisType) => void;
}

export function createFixtureSourceDataPort(): SourceDataFixture {
  const records = new Map<string, SourceDataRecord>(
    (
      [
        ["src-licensed-1", { basisType: "licensed", rightsBasisId: "rb-1" }],
        ["src-licensed-2", { basisType: "licensed", rightsBasisId: "rb-2" }],
        ["src-upload-1", { basisType: "user-upload", rightsBasisId: "rb-3" }],
        ["src-unverified-1", { basisType: "unverified", rightsBasisId: "rb-4" }],
      ] as const
    ).map(([sourceRef, rightsBasis]) => [
      sourceRef,
      { sourceRef, domainPackId: "football", rightsBasis: { ...rightsBasis } },
    ]),
  );
  return {
    port: {
      async resolve(refs) {
        return refs
          .filter((ref) => records.has(ref))
          .map((ref) => {
            const record = records.get(ref);
            if (record === undefined) {
              throw new LabInternalError("fixture invariant broken: known ref missing");
            }
            return { ...record, rightsBasis: { ...record.rightsBasis } };
          });
      },
    },
    setRightsBasis(ref, basisType) {
      const record = records.get(ref);
      if (record === undefined) return;
      records.set(ref, { ...record, rightsBasis: { ...record.rightsBasis, basisType } });
    },
  };
}

// ---------------------------------------------------------------------------
// The scripted run port fixture (the durable-run seam)
// ---------------------------------------------------------------------------

export interface ScriptedRunResponse {
  status: "completed" | "failed";
  costUsd: number;
  candidates?: LabRunCandidatePayload[];
  failureReason?: string;
}

export interface RunPortFixture {
  port: LabRunPort;
  queue: (response: ScriptedRunResponse) => void;
  pending: () => number;
}

export function createScriptedRunPort(): RunPortFixture {
  const script: ScriptedRunResponse[] = [];
  return {
    port: {
      async requestRun(request: LabRunRequest): Promise<LabRunRecord> {
        const response = script.shift();
        if (response === undefined) {
          throw new LabInternalError(
            "scripted run port has no queued response — the test forgot to script the run",
          );
        }
        return {
          runId: request.runId,
          labId: request.labId,
          requestedBy: { ...request.requestedBy },
          purpose: request.purpose,
          configuration: request.configuration === null ? null : { ...request.configuration },
          estimatedCostUsd: request.estimatedCostUsd,
          status: response.status,
          costUsd: response.costUsd,
          candidates: (response.candidates ?? []).map((candidate) => ({
            definition: structuredClone(candidate.definition),
            evidence: structuredClone(candidate.evidence),
            provenance: {
              lineage: [...candidate.provenance.lineage],
              rightsRequirements: candidate.provenance.rightsRequirements.map((r) => ({ ...r })),
            },
          })),
          requestedAt: request.requestedAt,
          completedAt: request.requestedAt,
          ...(response.failureReason !== undefined
            ? { failureReason: response.failureReason }
            : {}),
        };
      },
    },
    queue(response) {
      script.push(response);
    },
    pending: () => script.length,
  };
}

// ---------------------------------------------------------------------------
// Candidate payloads
// ---------------------------------------------------------------------------

export function fixtureRightsRequirements(): RightsRequirement[] {
  return [
    {
      requirementId: "rr-1",
      description: "licensed match footage only",
      scope: "source-media",
    },
  ];
}

export function fixtureBenchmarkEvidence(): BenchmarkEvidenceSummary {
  return {
    corpusVersion: "corpus-v1",
    evaluatorVersion: "eval-v1",
    metrics: [
      { axis: "fidelity", value: 8.2 },
      { axis: "stylization", value: 7.9 },
    ],
    uncertainty: [
      { axis: "fidelity", ciLow: 7.8, ciHigh: 8.6 },
      { axis: "stylization", ciLow: 7.5, ciHigh: 8.3 },
    ],
    artifactRefs: ["artifact-bench-1"],
  };
}

export function fixtureSecurityEvidence(): SecurityPolicyEvidenceSummary {
  return {
    policyVersion: "sec-v1",
    checks: [
      { checkId: "content-policy", passed: true },
      { checkId: "secret-scan", passed: true },
    ],
    artifactRefs: ["artifact-sec-1"],
  };
}

export function completeCandidateDefinition(): CandidateDefinition {
  return {
    organizationId: "lab-org-alpha",
    displayName: "Lab Org Alpha",
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
      latency: { p50Ms: 900, p95Ms: 1600, p99Ms: 2300 },
      cost: { perRunUsd: 1.4 },
    },
  };
}

/** A complete, publication-ready payload (definition + evidence + lineage). */
export function completeCandidatePayload(): LabRunCandidatePayload {
  return {
    definition: completeCandidateDefinition(),
    evidence: {
      benchmark: fixtureBenchmarkEvidence(),
      securityPolicy: fixtureSecurityEvidence(),
    },
    provenance: {
      lineage: ["lin-run-1", "lin-run-2"],
      rightsRequirements: fixtureRightsRequirements(),
    },
  };
}

/** A partial payload: no capabilities/profile, no lineage — publish refuses it. */
export function incompleteCandidatePayload(): LabRunCandidatePayload {
  return {
    definition: {
      organizationId: "lab-org-incomplete",
      displayName: "Incomplete Org",
    },
    evidence: {},
    provenance: { lineage: [], rightsRequirements: [] },
  };
}

// ---------------------------------------------------------------------------
// The full harness
// ---------------------------------------------------------------------------

export interface Harness {
  clockFixture: MutableClock;
  sourceFixture: SourceDataFixture;
  runFixture: RunPortFixture;
  labs: UserLabs;
  exchange: Exchange;
}

export function createHarness(): Harness {
  const clockFixture = createMutableClock();
  const sourceFixture = createFixtureSourceDataPort();
  const runFixture = createScriptedRunPort();
  const labs = createUserLabs({
    clock: clockFixture.clock,
    domainCatalog: fixtureDomainCatalog(),
    sourceData: sourceFixture.port,
    runPort: runFixture.port,
  });
  const exchange = createExchange({ clock: clockFixture.clock });
  return { clockFixture, sourceFixture, runFixture, labs, exchange };
}

/** Configures a fresh lab to ready state (domain + source data + budget). */
export async function configureLab(
  labs: UserLabs,
  tenant: TenantRef,
  labId: string,
): Promise<void> {
  await labs.chooseDomainAndTask(tenant, labId, { domainPackId: "football", task: "match" });
  await labs.selectSourceData(tenant, labId, ["src-licensed-1", "src-licensed-2"]);
  await labs.setBudget(tenant, labId, { totalUsd: 50 });
}

/**
 * Creates a lab, configures it, runs one scripted search that produces one
 * COMPLETE candidate — the common starting point of the exchange tests.
 */
export async function createLabWithCandidate(
  harness: Harness,
  tenant: TenantRef = tenantA,
): Promise<{ labId: string; runId: string; candidateId: string }> {
  const lab = await harness.labs.createLab(tenant, { name: "Alpha Lab" });
  await configureLab(harness.labs, tenant, lab.labId);
  harness.runFixture.queue({
    status: "completed",
    costUsd: 12,
    candidates: [completeCandidatePayload()],
  });
  const outcome = await harness.labs.requestRun(tenant, lab.labId, {
    purpose: "search",
    estimatedCostUsd: 10,
    configuration: { seed: "seed-42", iterations: 5 },
  });
  if (outcome.outcome !== "requested" || outcome.candidates.length !== 1) {
    throw new LabInternalError(
      "fixture invariant broken: scripted run did not complete as scripted",
    );
  }
  return {
    labId: lab.labId,
    runId: outcome.run.runId,
    candidateId: outcome.candidates[0]!.candidateId,
  };
}

// ---------------------------------------------------------------------------
// Incentive policies (v1 in force from the epoch; v2 from epoch + 5 days)
// ---------------------------------------------------------------------------

export function policyV1(): IncentivePolicy {
  return {
    policyId: "user-lab-incentives",
    version: 1,
    effectiveFrom: toIsoUtc(TEST_EPOCH_MS),
    benefits: {
      privateUseWindowDays: 90,
      discoveryBoost: {
        disclosed: true,
        description: "featured placement in the organization directory for 14 days",
      },
      capabilityCredits: { creditsPerGrant: 100, planGoverned: true },
    },
    disclosureText:
      "You keep private use of organizations from your lab for up to 90 days, may receive a " +
      "disclosed discovery boost (14 days featured placement), and 100 capability credits per " +
      "grant under your plan.",
  };
}

export function policyV2(): IncentivePolicy {
  return {
    policyId: "user-lab-incentives",
    version: 2,
    effectiveFrom: toIsoUtc(TEST_EPOCH_MS + 5 * DAY_MS),
    benefits: {
      privateUseWindowDays: 180,
      discoveryBoost: {
        disclosed: true,
        description: "featured placement in the organization directory for 30 days",
      },
      capabilityCredits: { creditsPerGrant: 200, planGoverned: true },
    },
    disclosureText:
      "You keep private use of organizations from your lab for up to 180 days, may receive a " +
      "disclosed discovery boost (30 days featured placement), and 200 capability credits per " +
      "grant under your plan.",
  };
}

/** A policy store with v1 in force (v2 added by the test when needed). */
export function policyStoreWithV1(): IncentivePolicyStore {
  const policies = createIncentivePolicyStore();
  void policies.addPolicy(policyV1());
  return policies;
}

/** A ledger for one lab, wired to the harness clock. */
export function ledgerForLab(
  harness: Harness,
  labId: string,
  policies: IncentivePolicyStore,
  owner: TenantRef = tenantA,
): IncentiveLedger {
  return createIncentiveLedger({
    labId,
    owner,
    policies,
    clock: harness.clockFixture.clock,
  });
}

// ---------------------------------------------------------------------------
// Import scopes
// ---------------------------------------------------------------------------

export function satisfiedScope(): { tenant: TenantRef; satisfiedRightsRequirements: string[] } {
  return { tenant: tenantB, satisfiedRightsRequirements: ["rr-1"] };
}

export function unsatisfiedScope(): { tenant: TenantRef; satisfiedRightsRequirements: string[] } {
  return { tenant: tenantB, satisfiedRightsRequirements: [] };
}
