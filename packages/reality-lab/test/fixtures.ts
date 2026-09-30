/**
 * Shared test fixtures for the reality-lab tests: the generalist bundle
 * (body + organization + scripted runtime — the mandatory baseline), small
 * deterministic scenario configs, and a synthetic run-record builder for
 * the ensemble arithmetic hand-check. Deterministic seeds everywhere — no
 * wall time, no Math.random.
 */
import {
  FOOTBALL_HARD_INVALIDITY_RULES,
  FOOTBALL_LAB_EVALUATOR_ID,
  FOOTBALL_LAB_EVALUATOR_VERSION,
  createGeneralistBody,
  createGeneralistOrganization,
  createGeneralistScriptedRuntime,
  footballDomainPack,
  generateFootballScenario,
  type AgentOrganizationDefinition,
  type AgentBodyDefinition,
  type DeterministicLabRun,
  type ModelRuntime,
  type OrganizationRuntimeBundle,
} from "../src";

/** A small, fast scenario config (200 ticks at a 100ms tick). */
export const SMALL_SCENARIO = { matchDurationMs: 20_000, tickMs: 100 } as const;

/** A 10-minute scenario config (exercises shots/goals/restarts). */
export const LONG_SCENARIO = { matchDurationMs: 600_000, tickMs: 100 } as const;

/**
 * The generalist baseline bundle: the mandatory single-agent comparison
 * point (contract §Required baselines) with its deterministic scripted
 * policy bound through the provider-neutral runtime seam.
 */
export function generalistBundle(): {
  bundle: OrganizationRuntimeBundle;
  body: AgentBodyDefinition;
  definition: AgentOrganizationDefinition;
  runtime: ModelRuntime;
} {
  const runtime = createGeneralistScriptedRuntime();
  const body = createGeneralistBody({
    domainPackId: footballDomainPack.domainPackId,
    evaluator: {
      evaluatorId: FOOTBALL_LAB_EVALUATOR_ID,
      version: FOOTBALL_LAB_EVALUATOR_VERSION,
    },
    hardRuleIds: FOOTBALL_HARD_INVALIDITY_RULES.map((rule) => rule.ruleId),
  });
  const definition = createGeneralistOrganization({
    body,
    binding: {
      modelId: "generalist-scripted-policy",
      modelVersion: "0.1.0",
      runtimeId: runtime.runtimeId,
      runtimeVersion: "0.1.0",
    },
  });
  return {
    bundle: {
      definition,
      bodies: [body],
      runtimes: new Map([[runtime.runtimeId, runtime]]),
    },
    body,
    definition,
    runtime,
  };
}

/**
 * A SYNTHETIC minimal run record for the ensemble aggregate hand-check:
 * the scores are fixed inputs to `aggregateLabRuns` (a pure function), not
 * simulator outputs — the arithmetic is what is under test.
 */
export function syntheticRun(
  overall: number,
  trajectoryHash: string,
  options: {
    valid?: boolean;
    dimensions?: { dimensionId: string; score: number; measured: boolean }[];
  } = {},
): DeterministicLabRun {
  const scenario = generateFootballScenario("synthetic", SMALL_SCENARIO);
  return {
    schemaVersion: "lab-run/0.1",
    runId: `synthetic-${trajectoryHash}`,
    scenario,
    seeds: { master: "synthetic", streams: { simulator: "s", organization: "o" } },
    organization: { organizationId: "org-synthetic", version: 1, nodes: [], bodies: [] },
    evaluator: { evaluatorId: FOOTBALL_LAB_EVALUATOR_ID, version: FOOTBALL_LAB_EVALUATOR_VERSION },
    faultSchedule: null,
    claims: [],
    actions: [],
    metrics: {
      evaluatorId: FOOTBALL_LAB_EVALUATOR_ID,
      version: FOOTBALL_LAB_EVALUATOR_VERSION,
      dimensions: options.dimensions ?? [
        { dimensionId: "event-source-fidelity", score: overall, measured: true },
      ],
      overall,
      valid: options.valid ?? true,
      violations: [],
      budgetUsage: {
        perNode: [],
        total: { calls: 0, costUsd: 0, maxCallsPerRun: 0, maxCostUsdPerRun: 0 },
      },
      faultSummary: { faultTicks: 0, distinctFaultKinds: [], scheduleId: null },
      degradations: [],
    },
    trajectory: { ticks: [] },
    trajectoryHash,
    provenance: {
      provenanceClass: "lab-simulation",
      lineage: ["synthetic"],
      note: "synthetic fixture record — for aggregate arithmetic tests only",
    },
  };
}

/** Deep-mutable mirror of the organization definition (for tests that build violations). */
export type MutableOrganization = {
  -readonly [K in keyof AgentOrganizationDefinition]: MutableValue<AgentOrganizationDefinition[K]>;
};
type MutableValue<T> = T extends readonly (infer U)[]
  ? MutableValue<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: MutableValue<T[K]> }
    : T;

/** A clean two-node organization definition used as the validation base. */
export function baseOrganizationInput(): MutableOrganization {
  const binding = {
    modelId: "model-a",
    modelVersion: "0.1.0",
    runtimeId: "scripted:model-a",
    runtimeVersion: "0.1.0",
  };
  return {
    organizationId: "org-test",
    version: 1,
    nodes: [
      {
        nodeId: "n1",
        bodyRef: { bodyId: "generalist-1", version: "0.1.0" },
        binding,
        stageId: "s1",
        memoryPolicy: { sharedStoreAccess: "read-write", privateStore: true },
      },
      {
        nodeId: "n2",
        bodyRef: { bodyId: "generalist-1", version: "0.1.0" },
        binding,
        stageId: "s2",
        memoryPolicy: { sharedStoreAccess: "read", privateStore: false },
      },
    ],
    edges: [{ edgeId: "e1", from: "n1", to: "n2", kind: "communication", channel: "org-bus" }],
    stages: [
      { stageId: "s1", order: 1 },
      { stageId: "s2", order: 2 },
    ],
    sharedMemoryStores: [{ storeId: "org-shared", scope: "organization" }],
    capabilityBindings: [{ capabilityId: "event.fusion", nodeId: "n1" }],
    budgets: {
      perNode: [
        { nodeId: "n1", maxCallsPerRun: 100, maxCostUsdPerRun: 1 },
        { nodeId: "n2", maxCallsPerRun: 100, maxCostUsdPerRun: 1 },
      ],
      total: { maxCallsPerRun: 200, maxCostUsdPerRun: 2 },
    },
    termination: { conditions: [{ kind: "max-ticks", maxTicks: 50 }] },
  };
}
