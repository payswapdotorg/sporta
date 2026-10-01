/**
 * REL-033 — the PRODUCTION ORGANIZATION CHOICE PROOF BATTERY.
 *
 * Proves the delivered organization-registry surface end to end, at
 * acceptance grade, against the frozen laws:
 *
 * - REL-A4 (docs/testing/reality-engineering-lab-acceptance.md): a
 *   candidate cannot become Production unless reproducibility, benchmark,
 *   robustness, rights/security/policy, cost/latency, canary and complete
 *   lineage ALL pass — proved by (a) two candidates with complete
 *   INDEPENDENT evidence walking draft -> production through the gates and
 *   (b) the fail-closed sweep: a candidate missing ANY ONE gate input is
 *   refused typed with the missing evidence named, for EVERY gate class.
 * - REL-A4's rollback law: "Rollback must be automatic for configured hard
 *   SLO/policy failures" — proved through the canary monitor (the new
 *   src/canary-feed.ts wire over the delivered requestRollback): a
 *   production organization whose configured hard SLO or policy canary
 *   check fails rolls back automatically, the previous production state is
 *   restored (src/production-state.ts), with the trigger + failed checks
 *   recorded in the hash-chained audit log — deterministically, for both
 *   breach kinds.
 * - REL-A5: the choice surface exposes version / evidence / limits for
 *   every eligible candidate (>= 2 here), ordered only by DECLARED
 *   criteria, with the A5 visibility view (src/choice-evidence.ts) fully
 *   gap-free for the promoted candidates.
 *
 * Everything is deterministic: the registry's default clock and id sources
 * are injected and sequential, so identical journeys produce identical
 * records, logs and hashes — which the determinism tests assert directly.
 */
import { describe, expect, test } from "bun:test";
import {
  PROMOTION_GATES_BY_TARGET,
  captureProductionState,
  choiceEvidenceFor,
  choiceForRequest,
  createCanaryFeed,
  createCanaryMonitor,
  createOrganizationRegistry,
  diffProductionState,
  evaluateCanaryObservations,
  productionStateRestored,
  requestPromotion,
} from "../src";
import type {
  AdditionalEvidence,
  ActorRef,
  CanaryObservation,
  ChoiceCandidate,
  GateId,
  NewOrganizationInput,
  OrganizationRegistry,
  PromotionOutcome,
  PromotionPolicy,
} from "../src";

// ---------------------------------------------------------------------------
// The proof policy (versioned, fail-closed validated by the promotion layer)
// ---------------------------------------------------------------------------

const POLICY: PromotionPolicy = {
  policyId: "rel033-proof-policy",
  version: 3,
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

/** The configured hard checks whose failure trips the automatic wire (REL-A4). */
const HARD_CHECKS = {
  hardSloChecks: ["slo-p95", "slo-quality"],
  hardPolicyChecks: ["content-policy"],
} as const;

const REGISTRAR: ActorRef = { actorType: "user", actorId: "rel033-proof-harness" };

// ---------------------------------------------------------------------------
// The two candidates — COMPLETE, INDEPENDENT evidence
// ---------------------------------------------------------------------------

/**
 * Candidate 1: a HAND-ENGINEERED organization (createdFrom: null). The
 * promotion invariant's other half — it passes the SAME gates a lab
 * discovery passes.
 */
function atlasInput(): NewOrganizationInput {
  return {
    organizationId: "org-atlas",
    displayName: "Atlas Tactical Collective",
    domain: {
      domains: ["football"],
      eventTypes: ["match", "clip"],
      modes: ["live", "batch"],
      renderers: ["tactical"],
    },
    capabilities: [
      { capabilityId: "perception.fusion", capabilityVersion: "3.2.0" },
      {
        capabilityId: "render.tactical",
        capabilityVersion: "5.0.1",
        modelRuntime: { modelId: "tactical-board-v9", runtimeId: "onnx" },
      },
    ],
    profile: {
      latency: { p50Ms: 700, p95Ms: 1400, p99Ms: 2000 },
      cost: { perRunUsd: 0.9 },
    },
    provenance: {
      owner: "team-atlas",
      lineage: ["lineage-atlas-seed", "lineage-atlas-bench"],
      rightsRequirements: [
        {
          requirementId: "rr-atlas-licensed",
          description: "licensed league footage only",
          scope: "source-media",
        },
      ],
      createdFrom: null,
    },
  };
}

/** Atlas's full, independent evidence bundle (every artifact ref its own). */
function atlasEvidence(): AdditionalEvidence {
  return {
    reproducibility: {
      labRunId: "run-atlas-repro",
      configurationVersion: "cfg-atlas-2",
      seed: "seed-atlas-11",
      reproductionRuns: 3,
      identicalRuns: 3,
      artifactRefs: ["art-atlas-repro-1", "art-atlas-repro-2", "art-atlas-repro-3"],
    },
    benchmark: {
      corpusVersion: "corpus-v3",
      evaluatorVersion: "eval-2025-06",
      metrics: [
        { axis: "fidelity", value: 8.1 },
        { axis: "stylization", value: 7.8 },
        { axis: "temporal", value: 7.6 },
      ],
      uncertainty: [
        { axis: "fidelity", ciLow: 7.7, ciHigh: 8.5 },
        { axis: "stylization", ciLow: 7.4, ciHigh: 8.2 },
        { axis: "temporal", ciLow: 7.2, ciHigh: 8.0 },
      ],
      artifactRefs: ["art-atlas-bench-1"],
    },
    robustness: {
      seedsTested: 6,
      seedsPassed: 6,
      outOfDistributionScore: 7.4,
      simulatorModelAgreement: 0.93,
      benchmarkCorpusCoverage: 0.88,
      knownFailureEnvelope: [
        "degrades on heavy rain occlusion",
        "crowd scan noise above 60fps sources",
      ],
      artifactRefs: ["art-atlas-robust-1"],
    },
    rightsProvenance: {
      basisType: "licensed",
      rightsBasisId: "rb-atlas-1",
      licenses: [{ licenseId: "lic-league-a", scope: "match-rendering" }],
      provenanceLineage: ["lin-atlas-r-1", "lin-atlas-r-2"],
      artifactRefs: ["art-atlas-rights-1"],
    },
    securityPolicy: {
      policyVersion: "sec-2025-06",
      checks: [
        { checkId: "content-policy", passed: true },
        { checkId: "secret-scan", passed: true },
        { checkId: "rights-basis-audit", passed: true },
      ],
      artifactRefs: ["art-atlas-sec-1"],
    },
    costLatency: {
      sampleCount: 64,
      artifactRefs: ["art-atlas-cost-1"],
    },
    canary: {
      canaryWindowMs: 7_200_000,
      observations: 412,
      sloChecks: [
        { checkId: "slo-p95", passed: true },
        { checkId: "slo-quality", passed: true },
        { checkId: "content-policy", passed: true },
      ],
      rollbackTriggersObserved: 0,
      artifactRefs: ["art-atlas-canary-1"],
    },
  };
}

/**
 * Candidate 2: a LAB-DISCOVERED organization (createdFrom run-borealis-7).
 * Independent evidence throughout: different lab run, different corpus
 * artifacts, different scores, different failure envelope, higher cost,
 * plus the simulator reward the lab search measured (never a gate).
 */
function borealisInput(): NewOrganizationInput {
  return {
    organizationId: "org-borealis",
    displayName: "Borealis Anime Network",
    domain: {
      domains: ["football"],
      eventTypes: ["match", "highlight"],
      modes: ["batch"],
      renderers: ["anime"],
    },
    capabilities: [
      { capabilityId: "perception.fusion", capabilityVersion: "3.2.0" },
      {
        capabilityId: "render.anime",
        capabilityVersion: "2.4.0",
        modelRuntime: { modelId: "npr-anime-v4", runtimeId: "onnx" },
      },
      { capabilityId: "style.transfer", capabilityVersion: "1.1.0" },
    ],
    profile: {
      latency: { p50Ms: 950, p95Ms: 1850, p99Ms: 2700 },
      cost: { perRunUsd: 1.6 },
    },
    provenance: {
      owner: "team-borealis",
      lineage: ["lineage-borealis-run-7-a", "lineage-borealis-run-7-b"],
      rightsRequirements: [
        {
          requirementId: "rr-borealis-upload",
          description: "user-uploaded footage with a recorded rights basis",
          scope: "source-media",
        },
      ],
      createdFrom: { labRunId: "run-borealis-7" },
    },
  };
}

/** Borealis's full, independent evidence bundle (+ the never-a-gate reward). */
function borealisEvidence(): AdditionalEvidence {
  return {
    reproducibility: {
      labRunId: "run-borealis-7",
      configurationVersion: "cfg-borealis-1",
      seed: "seed-borealis-42",
      reproductionRuns: 2,
      identicalRuns: 2,
      artifactRefs: ["art-borealis-repro-1", "art-borealis-repro-2"],
    },
    benchmark: {
      corpusVersion: "corpus-v3",
      evaluatorVersion: "eval-2025-06",
      metrics: [
        { axis: "fidelity", value: 8.9 },
        { axis: "stylization", value: 8.3 },
        { axis: "temporal", value: 8.0 },
      ],
      uncertainty: [
        { axis: "fidelity", ciLow: 8.5, ciHigh: 9.2 },
        { axis: "stylization", ciLow: 7.9, ciHigh: 8.6 },
        { axis: "temporal", ciLow: 7.6, ciHigh: 8.4 },
      ],
      artifactRefs: ["art-borealis-bench-1"],
    },
    robustness: {
      seedsTested: 8,
      seedsPassed: 8,
      outOfDistributionScore: 6.9,
      simulatorModelAgreement: 0.87,
      benchmarkCorpusCoverage: 0.81,
      knownFailureEnvelope: ["sustained occlusion above 40% breaks tracker continuity"],
      artifactRefs: ["art-borealis-robust-1"],
    },
    rightsProvenance: {
      basisType: "user-upload",
      rightsBasisId: "rb-borealis-2",
      licenses: [{ licenseId: "lic-upload-b", scope: "transformation" }],
      provenanceLineage: ["lin-borealis-r-1"],
      artifactRefs: ["art-borealis-rights-1"],
    },
    securityPolicy: {
      policyVersion: "sec-2025-06",
      checks: [
        { checkId: "content-policy", passed: true },
        { checkId: "secret-scan", passed: true },
        { checkId: "rights-basis-audit", passed: true },
      ],
      artifactRefs: ["art-borealis-sec-1"],
    },
    costLatency: {
      sampleCount: 72,
      artifactRefs: ["art-borealis-cost-1"],
    },
    canary: {
      canaryWindowMs: 10_800_000,
      observations: 288,
      sloChecks: [
        { checkId: "slo-p95", passed: true },
        { checkId: "slo-quality", passed: true },
        { checkId: "content-policy", passed: true },
      ],
      rollbackTriggersObserved: 0,
      artifactRefs: ["art-borealis-canary-1"],
    },
    simulatorReward: {
      score: 91.3,
      rewardVersion: "reward-borealis-v2",
      labRunId: "run-borealis-7",
      artifactRefs: ["art-borealis-reward-1"],
    },
  };
}

// ---------------------------------------------------------------------------
// Stage slicing + the walk helpers
// ---------------------------------------------------------------------------

type Stage = "draft" | "benchmarked" | "validated" | "canary" | "production";

interface CandidateSpec {
  input: NewOrganizationInput;
  full: AdditionalEvidence;
}

function compact(evidence: AdditionalEvidence): AdditionalEvidence {
  return Object.fromEntries(
    Object.entries(evidence).filter(([, value]) => value !== undefined),
  ) as AdditionalEvidence;
}

/** Slices a full bundle into the per-promotion-step submissions. */
function stagesOf(spec: CandidateSpec): {
  benchmarkStage: AdditionalEvidence;
  validationStage: AdditionalEvidence;
  canaryStage: AdditionalEvidence;
} {
  return {
    benchmarkStage: compact({
      reproducibility: spec.full.reproducibility,
      benchmark: spec.full.benchmark,
    }),
    validationStage: compact({
      robustness: spec.full.robustness,
      rightsProvenance: spec.full.rightsProvenance,
      securityPolicy: spec.full.securityPolicy,
      costLatency: spec.full.costLatency,
    }),
    canaryStage: compact({
      canary: spec.full.canary,
      simulatorReward: spec.full.simulatorReward,
    }),
  };
}

const ATLAS: CandidateSpec = { input: atlasInput(), full: atlasEvidence() };
const BOREALIS: CandidateSpec = { input: borealisInput(), full: borealisEvidence() };

function expectGranted(outcome: PromotionOutcome, target: Stage): void {
  expect(outcome.outcome).toBe("granted");
  if (outcome.outcome !== "granted") throw new Error("unreachable: not granted");
  expect(outcome.toStatus).toBe(target);
}

function expectRefused(
  outcome: PromotionOutcome,
): Exclude<PromotionOutcome, { outcome: "granted" }> {
  expect(outcome.outcome).toBe("refused");
  if (outcome.outcome !== "refused") throw new Error("unreachable: not refused");
  return outcome;
}

async function promote(
  registry: OrganizationRegistry,
  organizationId: string,
  additional?: AdditionalEvidence,
): Promise<PromotionOutcome> {
  return requestPromotion(registry, {
    organizationId,
    policy: POLICY,
    ...(additional !== undefined ? { additionalEvidence: additional } : {}),
  });
}

async function register(registry: OrganizationRegistry, spec: CandidateSpec): Promise<void> {
  await registry.register(spec.input, REGISTRAR);
}

/** Walks a registered candidate to `stage`, every step granted under POLICY. */
async function walkTo(
  registry: OrganizationRegistry,
  spec: CandidateSpec,
  stage: Stage,
): Promise<void> {
  const stages = stagesOf(spec);
  const id = spec.input.organizationId;
  if (stage === "draft") return;
  expectGranted(await promote(registry, id, stages.benchmarkStage), "benchmarked");
  if (stage === "benchmarked") return;
  expectGranted(await promote(registry, id, stages.validationStage), "validated");
  if (stage === "validated") return;
  expectGranted(await promote(registry, id), "canary");
  if (stage === "canary") return;
  expectGranted(await promote(registry, id, stages.canaryStage), "production");
}

/** Registers + walks one candidate to production in its own registry. */
async function candidateAtProduction(
  registry: OrganizationRegistry,
  spec: CandidateSpec,
): Promise<void> {
  await register(registry, spec);
  await walkTo(registry, spec, "production");
}

// ---------------------------------------------------------------------------
// 1 — the production choice journey (REL-A4 + REL-A5)
// ---------------------------------------------------------------------------

describe("REL-033: the production choice journey", () => {
  test("two candidates with complete independent evidence reach production through every gate", async () => {
    const registry = createOrganizationRegistry();
    await register(registry, ATLAS);
    await register(registry, BOREALIS);

    // The A5 checkpoint: at `validated` the choice surface already shows
    // BOTH eligible organizations (>= 2 — the law's own number).
    await walkTo(registry, ATLAS, "validated");
    await walkTo(registry, BOREALIS, "validated");
    const validatedChoice = await choiceForRequest(registry, { domain: "football", task: "match" });
    expect(validatedChoice.candidates.length).toBe(2);
    expect(validatedChoice.candidates.map((c) => c.status)).toEqual(["validated", "validated"]);

    // The final steps: validated -> canary -> production for both.
    const atlasStages = stagesOf(ATLAS);
    const borealisStages = stagesOf(BOREALIS);
    expectGranted(await promote(registry, "org-atlas"), "canary");
    expectGranted(await promote(registry, "org-atlas", atlasStages.canaryStage), "production");
    expectGranted(await promote(registry, "org-borealis"), "canary");
    expectGranted(
      await promote(registry, "org-borealis", borealisStages.canaryStage),
      "production",
    );

    const atlas = await registry.get("org-atlas");
    const borealis = await registry.get("org-borealis");
    expect(atlas.status).toBe("production");
    expect(borealis.status).toBe("production");
    // Every mutation is a version: v1 registration, then evidence+transition
    // pairs per stage — fully deterministic (asserted below by re-running).
    expect(atlas.version).toBe(8);
    expect(borealis.version).toBe(8);

    // The promotion invariant, visibly: the hand-engineered organization
    // (createdFrom null) and the lab discovery (run-borealis-7) passed the
    // SAME seven gates for production — recorded on the transition log.
    const log = await registry.transitionLog();
    const productionEntries = log.filter(
      (entry) => entry.toStatus === "production" && entry.operation === "promotion",
    );
    expect(productionEntries.length).toBe(2);
    for (const entry of productionEntries) {
      expect(entry.gateResults.map((g) => g.gate)).toEqual([
        ...PROMOTION_GATES_BY_TARGET.production,
      ]);
      expect(entry.gateResults.every((g) => g.status === "pass")).toBe(true);
      expect(entry.detail).toContain("rel033-proof-policy:v3");
      expect(entry.detail).toContain("7/7 gates passed");
    }
    // The whole proof is tamper-evident.
    expect(await registry.verifyTransitionLog()).toBe(true);
  });

  test("the choice surface exposes version/evidence/limits for each candidate (REL-A5)", async () => {
    const registry = createOrganizationRegistry();
    await candidateAtProduction(registry, ATLAS);
    await candidateAtProduction(registry, BOREALIS);

    const result = await choiceForRequest(registry, { domain: "football", task: "match" });
    expect(result.candidates.length).toBe(2);
    expect(result.orderedBy).toBe("registry order (registration sequence; no ranking applied)");

    const byId = new Map(result.candidates.map((c: ChoiceCandidate) => [c.organizationId, c]));
    const atlas = byId.get("org-atlas");
    const borealis = byId.get("org-borealis");
    expect(atlas).toBeDefined();
    expect(borealis).toBeDefined();
    if (atlas === undefined || borealis === undefined) throw new Error("unreachable: missing");

    // Version + identity visible.
    expect(atlas.version).toBe(8);
    expect(borealis.version).toBe(8);
    expect(atlas.displayName).toBe("Atlas Tactical Collective");
    expect(borealis.displayName).toBe("Borealis Anime Network");

    // Benchmark evidence visible: metrics AND uncertainty, per axis.
    expect(atlas.evidence.benchmark?.metrics).toEqual([
      { axis: "fidelity", value: 8.1 },
      { axis: "stylization", value: 7.8 },
      { axis: "temporal", value: 7.6 },
    ]);
    expect(atlas.evidence.benchmark?.uncertainty).toEqual([
      { axis: "fidelity", ciLow: 7.7, ciHigh: 8.5 },
      { axis: "stylization", ciLow: 7.4, ciHigh: 8.2 },
      { axis: "temporal", ciLow: 7.2, ciHigh: 8.0 },
    ]);
    expect(borealis.evidence.benchmark?.metrics).toEqual([
      { axis: "fidelity", value: 8.9 },
      { axis: "stylization", value: 8.3 },
      { axis: "temporal", value: 8.0 },
    ]);

    // Robustness evidence visible.
    expect(borealis.evidence.robustness).toEqual({
      seedsTested: 8,
      seedsPassed: 8,
      outOfDistributionScore: 6.9,
      simulatorModelAgreement: 0.87,
      benchmarkCorpusCoverage: 0.81,
    });

    // Limits visible: the declared known-failure envelope, verbatim.
    expect(atlas.knownLimitations).toEqual([
      "degrades on heavy rain occlusion",
      "crowd scan noise above 60fps sources",
    ]);
    expect(borealis.knownLimitations).toEqual([
      "sustained occlusion above 40% breaks tracker continuity",
    ]);

    // Cost/latency envelope + domain support + rights requirements visible.
    expect(atlas.profile.latency).toEqual({ p50Ms: 700, p95Ms: 1400, p99Ms: 2000 });
    expect(atlas.profile.cost).toEqual({ perRunUsd: 0.9 });
    expect(borealis.profile.cost).toEqual({ perRunUsd: 1.6 });
    expect(atlas.evidence.rightsRequirements).toEqual([
      {
        requirementId: "rr-atlas-licensed",
        description: "licensed league footage only",
        scope: "source-media",
      },
    ]);
    expect(borealis.evidence.provenance.createdFrom).toEqual({ labRunId: "run-borealis-7" });
    expect(atlas.evidence.provenance.createdFrom).toBeNull();
    expect(atlas.evidence.provenance.owner).toBe("team-atlas");

    // The simulator reward is shown as what it is — a lab measurement,
    // never merged into the benchmark evidence.
    expect(borealis.evidence.simulatorReward).toEqual({
      score: 91.3,
      rewardVersion: "reward-borealis-v2",
    });
    expect(atlas.evidence.simulatorReward).toBeNull();

    // No hidden ranking fields on the candidate — honesty by construction.
    for (const candidate of result.candidates) {
      const keys = Object.keys(candidate);
      expect(keys.includes("rank")).toBe(false);
      expect(keys.includes("score")).toBe(false);
      expect(keys.includes("weight")).toBe(false);
    }

    // The A5 visibility view is fully gap-free for both candidates.
    const atlasView = choiceEvidenceFor(atlas);
    const borealisView = choiceEvidenceFor(borealis);
    expect(atlasView.visibilityGaps).toEqual([]);
    expect(borealisView.visibilityGaps).toEqual([]);
    expect(atlasView.costLatency).toEqual({
      p50Ms: 700,
      p95Ms: 1400,
      p99Ms: 2000,
      perRunUsd: 0.9,
    });
    expect(borealisView.knownLimitations).toEqual([
      "sustained occlusion above 40% breaks tracker continuity",
    ]);
  });

  test("selection changes only the declared ordering, never the membership", async () => {
    const registry = createOrganizationRegistry();
    await candidateAtProduction(registry, ATLAS);
    await candidateAtProduction(registry, BOREALIS);
    const request = { domain: "football", task: "match" };

    const registryOrder = await choiceForRequest(registry, request);
    const byCost = await choiceForRequest(registry, request, { kind: "cost-ascending" });
    const byLatency = await choiceForRequest(registry, request, { kind: "latency-ascending" });
    const byFidelity = await choiceForRequest(registry, request, {
      kind: "quality-descending",
      axis: "fidelity",
    });

    // Membership is stable across orderings (the user may change selection;
    // the surface never silently hides or adds candidates).
    const ids = (result: typeof registryOrder) =>
      result.candidates.map((c) => c.organizationId).sort();
    expect(ids(byCost)).toEqual(ids(registryOrder));
    expect(ids(byLatency)).toEqual(ids(registryOrder));
    expect(ids(byFidelity)).toEqual(ids(registryOrder));

    // The declared orderings actually order, and say so in words.
    expect(byCost.candidates.map((c) => c.organizationId)).toEqual(["org-atlas", "org-borealis"]);
    expect(byCost.orderedBy).toBe("cost ascending (per-run USD, ties broken by organization id)");
    expect(byLatency.candidates.map((c) => c.organizationId)).toEqual([
      "org-atlas",
      "org-borealis",
    ]);
    expect(byFidelity.candidates.map((c) => c.organizationId)).toEqual([
      "org-borealis",
      "org-atlas",
    ]);
    expect(byFidelity.orderedBy).toContain("quality descending (benchmark axis 'fidelity'");
  });

  test("the whole journey is deterministic: identical runs, identical records, logs and choices", async () => {
    async function runJourney() {
      const registry = createOrganizationRegistry();
      await candidateAtProduction(registry, ATLAS);
      await candidateAtProduction(registry, BOREALIS);
      return {
        records: await registry.list(),
        log: await registry.transitionLog(),
        verified: await registry.verifyTransitionLog(),
        choice: await choiceForRequest(registry, { domain: "football", task: "match" }),
        views: (
          await choiceForRequest(registry, { domain: "football", task: "match" })
        ).candidates.map(choiceEvidenceFor),
      };
    }
    const first = await runJourney();
    const second = await runJourney();
    expect(first.verified).toBe(true);
    expect(second.records).toEqual(first.records);
    expect(second.log).toEqual(first.log); // entry ids, timestamps AND hashes
    expect(second.choice).toEqual(first.choice);
    expect(second.views).toEqual(first.views);
  });
});

// ---------------------------------------------------------------------------
// 2 — the fail-closed sweep (every gate class refuses when its input is missing)
// ---------------------------------------------------------------------------

/** The evidence-bundle key each gate reads. */
const GATE_TO_EVIDENCE_KEY = {
  reproducibility: "reproducibility",
  benchmark: "benchmark",
  robustness: "robustness",
  "rights-provenance": "rightsProvenance",
  "cost-latency": "costLatency",
  "security-policy": "securityPolicy",
  canary: "canary",
} as const;

type Stage2 = "draft" | "benchmarked" | "canary";
type Target = "benchmarked" | "validated" | "production";

interface SweepCase {
  gate: GateId;
  from: Stage2;
  target: Target;
  /** What the refusing attempt submits (undefined = nothing). */
  attempt: AdditionalEvidence | undefined;
  /** The substring naming the missing evidence in the gate's detail. */
  named: string;
}

/** The full bundle minus exactly ONE gate's evidence object. */
function evidenceOmitting(gate: GateId): AdditionalEvidence {
  const full = borealisEvidence();
  const key = GATE_TO_EVIDENCE_KEY[gate];
  const rest = { ...full };
  delete rest[key];
  return rest;
}

function sweepCases(): SweepCase[] {
  const omit = (gate: GateId, from: Stage2, target: Target, named: string): SweepCase => ({
    gate,
    from,
    target,
    attempt: evidenceOmitting(gate),
    named,
  });
  return [
    omit("reproducibility", "draft", "benchmarked", "no reproducibility evidence"),
    omit("benchmark", "draft", "benchmarked", "no benchmark evidence"),
    omit("robustness", "benchmarked", "validated", "no robustness evidence"),
    omit("rights-provenance", "benchmarked", "validated", "no rights/provenance evidence"),
    omit("cost-latency", "benchmarked", "validated", "no cost/latency measurement evidence"),
    omit("security-policy", "benchmarked", "validated", "no security/policy evidence"),
    // The canary step: positioned at canary with all six, attempting
    // production with the canary evidence never submitted.
    {
      gate: "canary",
      from: "canary",
      target: "production",
      attempt: undefined,
      named: "no canary evidence",
    },
  ];
}

describe("REL-033: the fail-closed sweep — a candidate missing ANY mandatory gate input is refused typed, the evidence named", () => {
  for (const sweepCase of sweepCases()) {
    test(`gate '${sweepCase.gate}' missing -> ${sweepCase.from} -> ${sweepCase.target} refused`, async () => {
      const registry = createOrganizationRegistry();
      await register(registry, BOREALIS);
      // Position at `from` using COMPLETE evidence (the sweep isolates the
      // one missing input; everything else must pass).
      if (sweepCase.from === "benchmarked") {
        await walkTo(registry, BOREALIS, "benchmarked");
      } else if (sweepCase.from === "canary") {
        await walkTo(registry, BOREALIS, "canary");
      }

      const refusal = expectRefused(await promote(registry, "org-borealis", sweepCase.attempt));
      expect(refusal.reason).toBe("gate-failure");
      expect(refusal.attemptedTarget).toBe(sweepCase.target);
      expect(refusal.message).toContain(`${sweepCase.gate}=missing`);

      // The missing gate: status `missing`, the evidence named in words.
      const missing = refusal.gateResults.find((g) => g.gate === sweepCase.gate);
      expect(missing).toBeDefined();
      if (missing === undefined) throw new Error("unreachable: no gate result");
      expect(missing.status).toBe("missing");
      expect(missing.detail).toContain(sweepCase.named);

      // Every OTHER required gate passes — the refusal names exactly the
      // one missing input, nothing else.
      const required = [...PROMOTION_GATES_BY_TARGET[sweepCase.target]];
      expect(refusal.gateResults.map((g) => g.gate)).toEqual(required);
      const others = refusal.gateResults.filter((g) => g.gate !== sweepCase.gate);
      expect(others.length).toBe(required.length - 1);
      expect(others.every((g) => g.status === "pass")).toBe(true);

      // The refusal is AUDITED (refused attempts append to the log), and
      // the organization did not move.
      const log = await registry.transitionLog("org-borealis");
      const audited = log.filter((entry) => entry.refusalReason === "gate-failure");
      expect(audited.length).toBe(1);
      expect(audited[0]?.detail).toContain(`${sweepCase.gate}=missing`);
      const record = await registry.get("org-borealis");
      expect(record.status).toBe(sweepCase.from);
    });
  }

  test("complete evidence but EMPTY lineage -> validated refused typed (complete lineage is mandatory)", async () => {
    const registry = createOrganizationRegistry();
    const spec: CandidateSpec = {
      input: { ...borealisInput(), provenance: { ...borealisInput().provenance, lineage: [] } },
      full: borealisEvidence(),
    };
    await register(registry, spec);
    await walkTo(registry, spec, "benchmarked");

    const refusal = expectRefused(
      await promote(registry, "org-borealis", stagesOf(spec).validationStage),
    );
    // All six gates pass — the lineage check is what refuses.
    expect(refusal.gateResults.every((g) => g.status === "pass")).toBe(true);
    expect(refusal.reason).toBe("incomplete-lineage");
    expect(refusal.message).toContain("provenance lineage is empty");
    const record = await registry.get("org-borealis");
    expect(record.status).toBe("benchmarked");
    const log = await registry.transitionLog("org-borealis");
    expect(log.some((entry) => entry.refusalReason === "incomplete-lineage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3 — automatic rollback (REL-A4): SLO breach + policy breach, deterministic
// ---------------------------------------------------------------------------

/** The shared prologue: atlas stands in production, borealis joins it. */
async function productionPair(): Promise<{
  registry: OrganizationRegistry;
  before: Awaited<ReturnType<typeof captureProductionState>>;
  during: Awaited<ReturnType<typeof captureProductionState>>;
}> {
  const registry = createOrganizationRegistry();
  await candidateAtProduction(registry, ATLAS);
  const before = await captureProductionState(registry, { domain: "football" });
  await candidateAtProduction(registry, BOREALIS);
  const during = await captureProductionState(registry, { domain: "football" });
  return { registry, before, during };
}

describe("REL-033: automatic rollback on a configured hard SLO breach", () => {
  test("a failing hard SLO check rolls the promoted organization back automatically and restores the previous production state", async () => {
    const { registry, before, during } = await productionPair();
    expect(before.organizations).toEqual([{ organizationId: "org-atlas", version: 8 }]);
    expect(during.organizations).toEqual([
      { organizationId: "org-atlas", version: 8 },
      { organizationId: "org-borealis", version: 8 },
    ]);

    const monitor = createCanaryMonitor({ registry, policy: POLICY, checks: HARD_CHECKS });

    // Healthy canary traffic does nothing.
    const healthy = await monitor.ingest("org-borealis", {
      checkId: "slo-p95",
      checkKind: "slo",
      passed: true,
      detail: "p95 1740ms within the 3000ms budget",
    });
    expect(healthy.assessment).toBe("healthy");
    expect((await registry.get("org-borealis")).status).toBe("production");

    // The hard SLO breach: the wire trips automatically.
    const breach = await monitor.ingest("org-borealis", {
      checkId: "slo-p95",
      checkKind: "slo",
      passed: false,
      detail: "p95 4100ms exceeded the 3000ms hard budget",
    });
    expect(breach.assessment).toBe("rolled-back");
    if (breach.assessment !== "rolled-back") throw new Error("unreachable: not rolled back");
    expect(breach.verdict.trigger).toBe("hard-slo-failure");
    expect(breach.verdict.failedConfiguredChecks.map((c) => c.checkId)).toEqual(["slo-p95"]);
    expect(breach.rollback.outcome).toBe("granted");
    // The policy demotes an SLO breach: production -> canary.
    expect(breach.rollback.fromStatus).toBe("production");
    expect(breach.rollback.toStatus).toBe("canary");
    expect(breach.rollback.trigger).toBe("hard-slo-failure");

    // THE RESTORATION LAW: the previous production state serves again.
    const after = await captureProductionState(registry, { domain: "football" });
    expect(productionStateRestored(before, after)).toBe(true);
    expect(diffProductionState(before, after)).toEqual({ added: [], removed: [] });
    expect(after.organizations).toEqual([{ organizationId: "org-atlas", version: 8 }]);

    // The recorded reason: trigger + failed check on the audited transition.
    const borealisLog = await registry.transitionLog("org-borealis");
    const rollbackEntry = borealisLog[borealisLog.length - 1];
    expect(rollbackEntry?.operation).toBe("rollback");
    expect(rollbackEntry?.rollbackTrigger).toBe("hard-slo-failure");
    expect(rollbackEntry?.toStatus).toBe("canary");
    expect(rollbackEntry?.detail).toContain("slo-p95");
    expect(rollbackEntry?.detail).toContain("p95 4100ms exceeded the 3000ms hard budget");
    expect(rollbackEntry?.detail).toContain("automatic canary rollback");

    // Lineage is preserved: the exact production version stays readable.
    const versions = await registry.listVersions("org-borealis");
    expect(versions.some((v) => v.version === 8 && v.status === "production")).toBe(true);
    expect((await registry.get("org-borealis")).status).toBe("canary");

    // The choice surface tells the truth: atlas still production, borealis
    // honestly downgraded to canary (still selectable, visibly so).
    const choice = await choiceForRequest(registry, { domain: "football", task: "match" });
    const byId = new Map(choice.candidates.map((c) => [c.organizationId, c]));
    expect(byId.get("org-atlas")?.status).toBe("production");
    expect(byId.get("org-borealis")?.status).toBe("canary");

    // The wire trips once: further observations are typed, not silent.
    const handled = await monitor.ingest("org-borealis", {
      checkId: "slo-quality",
      checkKind: "slo",
      passed: false,
      detail: "quality dipped below the hard floor",
    });
    expect(handled.assessment).toBe("breach-already-handled");
    expect(monitor.firedRollbacks().length).toBe(1);
    expect(monitor.firedRollbacks()[0]?.trigger).toBe("hard-slo-failure");

    expect(await registry.verifyTransitionLog()).toBe(true);
  });

  test("the SLO-breach rollback journey is deterministic", async () => {
    async function journey() {
      const { registry, before } = await productionPair();
      const monitor = createCanaryMonitor({ registry, policy: POLICY, checks: HARD_CHECKS });
      await monitor.ingest("org-borealis", {
        checkId: "slo-p95",
        checkKind: "slo",
        passed: true,
        detail: "p95 1740ms within the 3000ms budget",
      });
      await monitor.ingest("org-borealis", {
        checkId: "slo-p95",
        checkKind: "slo",
        passed: false,
        detail: "p95 4100ms exceeded the 3000ms hard budget",
      });
      return {
        record: await registry.get("org-borealis"),
        log: await registry.transitionLog("org-borealis"),
        after: await captureProductionState(registry, { domain: "football" }),
        fired: monitor.firedRollbacks(),
        before,
      };
    }
    const first = await journey();
    const second = await journey();
    expect(first.after.organizations).toEqual(first.before.organizations);
    expect(second.record).toEqual(first.record);
    expect(second.log).toEqual(first.log);
    expect(second.after).toEqual(first.after);
    expect(second.fired).toEqual(first.fired);
  });
});

describe("REL-033: automatic rollback on a configured hard policy breach", () => {
  test("a failing hard policy check retires the promoted organization automatically and restores the previous production state", async () => {
    const { registry, before, during } = await productionPair();
    expect(during.organizations.length).toBe(2);

    const monitor = createCanaryMonitor({ registry, policy: POLICY, checks: HARD_CHECKS });

    // A PASSING policy check does not trip the wire.
    const healthy = await monitor.ingest("org-borealis", {
      checkId: "content-policy",
      checkKind: "policy",
      passed: true,
      detail: "output scanned clean",
    });
    expect(healthy.assessment).toBe("healthy");

    // The policy breach: `policy-violation` is not a demotion trigger under
    // this policy, so the rollback RETIRES the organization.
    const breach = await monitor.ingest("org-borealis", {
      checkId: "content-policy",
      checkKind: "policy",
      passed: false,
      detail: "copyrighted audio detected in the rendered output",
    });
    expect(breach.assessment).toBe("rolled-back");
    if (breach.assessment !== "rolled-back") throw new Error("unreachable: not rolled back");
    expect(breach.verdict.trigger).toBe("policy-violation");
    expect(breach.rollback.toStatus).toBe("retired");
    expect(breach.rollback.trigger).toBe("policy-violation");

    // The previous production state is restored.
    const after = await captureProductionState(registry, { domain: "football" });
    expect(productionStateRestored(before, after)).toBe(true);
    expect(after.organizations).toEqual([{ organizationId: "org-atlas", version: 8 }]);

    // The recorded reason names the policy check and what failed.
    const borealisLog = await registry.transitionLog("org-borealis");
    const rollbackEntry = borealisLog[borealisLog.length - 1];
    expect(rollbackEntry?.rollbackTrigger).toBe("policy-violation");
    expect(rollbackEntry?.toStatus).toBe("retired");
    expect(rollbackEntry?.detail).toContain("content-policy");
    expect(rollbackEntry?.detail).toContain("copyrighted audio detected in the rendered output");

    // Retired is terminal: no forward step, ever — and the choice surface
    // no longer offers the organization (retired is not selectable).
    const promotion = await promote(registry, "org-borealis");
    expect(promotion.outcome).toBe("refused");
    if (promotion.outcome === "refused") {
      expect(promotion.reason).toBe("no-forward-step");
      expect(promotion.message).toContain("terminal");
    }
    const choice = await choiceForRequest(registry, { domain: "football", task: "match" });
    expect(choice.candidates.map((c) => c.organizationId)).toEqual(["org-atlas"]);

    // Lineage preserved: the production version stays readable.
    const versions = await registry.listVersions("org-borealis");
    expect(versions.some((v) => v.version === 8 && v.status === "production")).toBe(true);
    expect(await registry.verifyTransitionLog()).toBe(true);
  });

  test("the policy-breach rollback journey is deterministic", async () => {
    async function journey() {
      const { registry, before } = await productionPair();
      const monitor = createCanaryMonitor({ registry, policy: POLICY, checks: HARD_CHECKS });
      await monitor.ingest("org-borealis", {
        checkId: "content-policy",
        checkKind: "policy",
        passed: false,
        detail: "copyrighted audio detected in the rendered output",
      });
      return {
        record: await registry.get("org-borealis"),
        log: await registry.transitionLog("org-borealis"),
        after: await captureProductionState(registry, { domain: "football" }),
        fired: monitor.firedRollbacks(),
        before,
      };
    }
    const first = await journey();
    const second = await journey();
    expect(first.after.organizations).toEqual(first.before.organizations);
    expect(second.record).toEqual(first.record);
    expect(second.log).toEqual(first.log);
    expect(second.after).toEqual(first.after);
    expect(second.fired).toEqual(first.fired);
  });
});

// ---------------------------------------------------------------------------
// 4 — negative controls: the wire trips ONLY for configured hard failures
// ---------------------------------------------------------------------------

describe("REL-033: the automatic wire trips only for CONFIGURED hard failures", () => {
  test("an UNCONFIGURED failing check never rolls back (visible, non-triggering)", async () => {
    const { registry } = await productionPair();
    const monitor = createCanaryMonitor({ registry, policy: POLICY, checks: HARD_CHECKS });
    const assessment = await monitor.ingest("org-borealis", {
      checkId: "slo-uptime",
      checkKind: "slo",
      passed: false,
      detail: "uptime 99.1% (not a configured hard check)",
    });
    expect(assessment.assessment).toBe("healthy");
    if (assessment.assessment !== "healthy") throw new Error("unreachable: not healthy");
    expect(assessment.verdict.unconfiguredFailedChecks).toEqual(["slo-uptime"]);
    expect((await registry.get("org-borealis")).status).toBe("production");
    expect(monitor.firedRollbacks()).toEqual([]);
  });

  test("a breach on a non-rollback-eligible organization refuses typed, nothing moves", async () => {
    const registry = createOrganizationRegistry();
    await register(registry, BOREALIS);
    await walkTo(registry, BOREALIS, "validated");
    const monitor = createCanaryMonitor({ registry, policy: POLICY, checks: HARD_CHECKS });
    const assessment = await monitor.ingest("org-borealis", {
      checkId: "slo-p95",
      checkKind: "slo",
      passed: false,
      detail: "p95 4300ms exceeded the 3000ms hard budget",
    });
    expect(assessment.assessment).toBe("rollback-refused");
    if (assessment.assessment !== "rollback-refused") {
      throw new Error("unreachable: not rollback-refused");
    }
    // The delivered rollback laws refuse — the monitor never bypasses them.
    expect(assessment.rollback.reason).toBe("not-rollback-eligible");
    expect(assessment.rollback.message).toContain(
      "only canary/production organizations can roll back",
    );
    expect((await registry.get("org-borealis")).status).toBe("validated");
    expect(monitor.firedRollbacks()).toEqual([]);
  });

  test("the pure verdict: latest failed configured check decides the trigger; the feed stamps time", async () => {
    const observations: CanaryObservation[] = [
      {
        observedAt: "2025-01-06T12:00:01.000Z",
        checkId: "slo-p95",
        checkKind: "slo",
        passed: false,
      },
      {
        observedAt: "2025-01-06T12:00:02.000Z",
        checkId: "content-policy",
        checkKind: "policy",
        passed: false,
      },
    ];
    const verdict = evaluateCanaryObservations(observations, HARD_CHECKS);
    expect(verdict.verdict).toBe("breach");
    if (verdict.verdict !== "breach") throw new Error("unreachable: not breach");
    expect(verdict.trigger).toBe("policy-violation");
    expect(verdict.failedConfiguredChecks.map((c) => c.checkId)).toEqual([
      "slo-p95",
      "content-policy",
    ]);

    expect(evaluateCanaryObservations([], HARD_CHECKS)).toEqual({
      verdict: "healthy",
      observationsEvaluated: 0,
      unconfiguredFailedChecks: [],
    });

    // The feed stamps observations from its injected (deterministic) clock
    // (the registry default clock: epoch + 1ms on the first tick).
    const feed = createCanaryFeed();
    const stamped = await feed.record("org-atlas", {
      checkId: "slo-p95",
      checkKind: "slo",
      passed: true,
    });
    expect(stamped.observedAt).toBe("2025-01-06T12:00:00.001Z");
    expect((await feed.observationsFor("org-atlas")).length).toBe(1);
    expect((await feed.observationsFor("org-borealis")).length).toBe(0);
  });
});
