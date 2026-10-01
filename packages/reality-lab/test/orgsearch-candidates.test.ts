/**
 * Candidate-space tests (REL-005): the typed §5 grid, collective typed
 * refusals for invalid points, deterministic materialization into COMPLETE
 * VALID organizations (exhaustively over a reduced grid, sampled over the
 * default grid), and the three fixture families — with the generalist
 * baseline satisfying the mandatory-baseline contract and actually running
 * a clean lab run.
 */
import { describe, expect, test } from "bun:test";
import {
  CandidateSpaceError,
  createFootballCandidateSpace,
  defaultFootballCandidateSpaceConfig,
  executionOrderWalk,
  fixtureCandidateFamilies,
  generateFootballScenario,
  footballDomainPack,
  createFootballLabEvaluator,
  runLab,
  validateOrganization,
  type CandidateSpaceConfig,
  type CandidateSpacePoint,
} from "../src";
import { SMALL_SCENARIO } from "./fixtures";

/** A reduced grid so EVERY point can be materialized exhaustively in-test. */
function smallSpaceConfig(): CandidateSpaceConfig {
  return {
    ...defaultFootballCandidateSpaceConfig(),
    maxBodyCount: 2,
    maxDelegationDepth: 1,
    latencyBudgetsMs: [1000, 2000],
  };
}

const SECTION5_DIMENSION_IDS = [
  "number-of-bodies",
  "body-roles",
  "topology",
  "delegation",
  "communication",
  "memory",
  "capabilities",
  "model-assignments",
  "compute-budget",
  "latency-budget",
  "execution-order",
  "stopping-conditions",
] as const;

describe("the §5 candidate space", () => {
  test("declares exactly the twelve architecture §5 search dimensions", () => {
    const space = createFootballCandidateSpace();
    expect(space.dimensions.map((dimension) => dimension.dimensionId)).toEqual([
      ...SECTION5_DIMENSION_IDS,
    ]);
    for (const dimension of space.dimensions) {
      expect(dimension.values.length).toBeGreaterThan(0);
      expect(dimension.description.length).toBeGreaterThan(0);
    }
  });

  test("count() equals enumerate().length and the grid is non-trivial", () => {
    const space = createFootballCandidateSpace(smallSpaceConfig());
    const enumerated = space.enumerate();
    expect(space.count()).toBe(enumerated.length);
    expect(enumerated.length).toBeGreaterThan(1000);
    // Enumeration is deterministic: same config, same order, same content.
    expect(JSON.stringify(space.enumerate())).toBe(JSON.stringify(enumerated));
  });

  test("every enumerated point is in-space and enumerated points are distinct", () => {
    const space = createFootballCandidateSpace(smallSpaceConfig());
    const enumerated = space.enumerate();
    expect(enumerated.every((point) => space.contains(point))).toBe(true);
    expect(new Set(enumerated.map((point) => JSON.stringify(point))).size).toBe(enumerated.length);
  });

  test("invalid configs are refused with typed errors", () => {
    expect(() => createFootballCandidateSpace({ ...smallSpaceConfig(), maxBodyCount: 0 })).toThrow(
      /maxBodyCount/,
    );
    expect(() =>
      createFootballCandidateSpace({ ...smallSpaceConfig(), latencyBudgetsMs: [] }),
    ).toThrow(/latencyBudgetsMs/);
    expect(() =>
      createFootballCandidateSpace({ ...smallSpaceConfig(), totalCallsBudget: 1 }),
    ).toThrow(/totalCallsBudget/);
    expect(() =>
      createFootballCandidateSpace({ ...smallSpaceConfig(), totalCostBudgetUsd: 0 }),
    ).toThrow(/totalCostBudgetUsd/);
  });
});

describe("point validation — collective typed refusals", () => {
  const space = createFootballCandidateSpace();

  test("the baseline point validates", () => {
    expect(space.validatePoint(space.generalistBaselinePoint())).toEqual(
      space.generalistBaselinePoint(),
    );
  });

  test("a kitchen-sink invalid point lists EVERY violated dimension at once", () => {
    const badPoint = {
      bodyCount: 99,
      roleMix: "bogus-mix",
      topology: "single",
      delegationDepth: 9,
      communication: "hub",
      memoryPolicy: "telepathic",
      capabilityAssignment: "partitioned-by-role",
      modelAssignment: "uniform-generalist",
      computeBudgetSplit: "even",
      latencyBudgetMs: 12345,
      executionOrder: "quantum",
      stoppingConditions: [],
    };
    expect(() => space.validatePoint(badPoint)).toThrow(CandidateSpaceError);
    try {
      space.validatePoint(badPoint);
      expect.unreachable();
    } catch (error) {
      const typed = error as CandidateSpaceError;
      expect(typed.violations.length).toBeGreaterThanOrEqual(7);
      const dimensionIds = typed.violations.map((violation) => violation.dimensionId);
      expect(dimensionIds).toContain("number-of-bodies");
      expect(dimensionIds).toContain("body-roles");
      expect(dimensionIds).toContain("delegation");
      expect(dimensionIds).toContain("memory");
      expect(dimensionIds).toContain("latency-budget");
      expect(dimensionIds).toContain("execution-order");
      expect(dimensionIds).toContain("stopping-conditions");
      // Every violation is JSON-safe evidence.
      expect(() => JSON.stringify(typed.violations)).not.toThrow();
    }
  });

  test("non-objects are refused with one clear violation", () => {
    for (const garbage of [null, 42, "point"]) {
      try {
        space.validatePoint(garbage);
        expect.unreachable();
      } catch (error) {
        const typed = error as CandidateSpaceError;
        expect(typed.violations).toHaveLength(1);
        expect(typed.violations[0]?.message).toContain("must be an object");
      }
    }
    expect(space.contains(42)).toBe(false);
    // An empty array is an object with NO fields: every dimension refuses it.
    try {
      space.validatePoint([]);
      expect.unreachable();
    } catch (error) {
      expect((error as CandidateSpaceError).violations.length).toBeGreaterThanOrEqual(10);
    }
  });

  test("the topology/communication/delegation couplings, both directions", () => {
    const baseline = space.generalistBaselinePoint();
    expect(space.contains({ ...baseline, topology: "pipeline" })).toBe(false); // pipeline needs >= 2 bodies
    expect(
      space.contains({
        ...baseline,
        bodyCount: 3,
        topology: "single",
        roleMix: "specialist-roles",
        communication: "none",
      }),
    ).toBe(false); // single means exactly one body
    expect(
      space.contains({
        ...baseline,
        communication: "adjacent",
      }),
    ).toBe(false); // adjacent needs peers
    expect(
      space.contains({
        ...baseline,
        bodyCount: 2,
        topology: "pipeline",
        roleMix: "specialist-roles",
        communication: "adjacent",
        delegationDepth: 1,
      }),
    ).toBe(true);
  });
});

describe("materialization — every point becomes a complete valid organization", () => {
  test("EXHAUSTIVE over the reduced grid: all fields present, contract-valid, walkable", () => {
    const space = createFootballCandidateSpace(smallSpaceConfig());
    let materialized = 0;
    for (const point of space.enumerate()) {
      const candidate = space.materialize(point);
      const definition = candidate.definition;
      // All contract fields present.
      expect(Object.keys(definition).sort()).toEqual(
        [
          "budgets",
          "capabilityBindings",
          "edges",
          "nodes",
          "organizationId",
          "sharedMemoryStores",
          "stages",
          "termination",
          "version",
        ].sort(),
      );
      // The v0 graph contract holds (collectively, with bodies).
      expect(() =>
        validateOrganization(definition, { bodies: candidate.bundle.bodies }),
      ).not.toThrow();
      // The deterministic walk covers every node exactly once.
      expect(executionOrderWalk(definition)).toHaveLength(definition.nodes.length);
      expect(definition.organizationId).toMatch(/^org-candidate-/);
      materialized += 1;
    }
    expect(materialized).toBe(space.count());
    expect(materialized).toBeGreaterThan(1000);
  });

  test("sampled over the DEFAULT grid: 30 seeded points all materialize valid", () => {
    const space = createFootballCandidateSpace();
    for (const point of space.sample("materialize-sample", 30)) {
      const candidate = space.materialize(point);
      expect(() =>
        validateOrganization(candidate.definition, { bodies: candidate.bundle.bodies }),
      ).not.toThrow();
    }
  });

  test("materialization is deterministic; distinct points give distinct organizations", () => {
    const space = createFootballCandidateSpace();
    const [first, second] = space.sample("determinism", 5);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const a1 = space.materialize(first as CandidateSpacePoint);
    const a2 = space.materialize(first as CandidateSpacePoint);
    expect(a1.candidateId).toBe(a2.candidateId);
    expect(JSON.stringify(a1.definition)).toBe(JSON.stringify(a2.definition));
    const b = space.materialize(second as CandidateSpacePoint);
    expect(b.candidateId).not.toBe(a1.candidateId);
    expect(b.definition.organizationId).not.toBe(a1.definition.organizationId);
  });

  test("the §5 dimensions are honestly reflected in the materialized graph", () => {
    const space = createFootballCandidateSpace();
    const point = space.validatePoint({
      bodyCount: 3,
      roleMix: "specialist-roles",
      topology: "pipeline",
      delegationDepth: 2,
      communication: "all-pairs",
      memoryPolicy: "hybrid",
      capabilityAssignment: "all-to-every-node",
      modelAssignment: "per-role-specialist",
      computeBudgetSplit: "even",
      latencyBudgetMs: 2000,
      executionOrder: "sequential-stages",
      stoppingConditions: ["max-ticks", "budget-exhausted"],
    });
    const { definition, bundle } = space.materialize(point);
    expect(definition.nodes).toHaveLength(3);
    expect(definition.stages).toHaveLength(3); // sequential-stages: one stage per node
    expect(definition.stages.map((stage) => stage.order)).toEqual([1, 2, 3]);
    // Communication: all ordered pairs (6 edges for 3 nodes) + delegation chain (2).
    expect(definition.edges.filter((edge) => edge.kind === "communication")).toHaveLength(6);
    expect(definition.edges.filter((edge) => edge.kind === "delegation")).toHaveLength(2);
    // Memory: hybrid — head read-write + private, workers read + private.
    const head = definition.nodes[0];
    const worker = definition.nodes[1];
    expect(head?.memoryPolicy).toEqual({ sharedStoreAccess: "read-write", privateStore: true });
    expect(worker?.memoryPolicy).toEqual({ sharedStoreAccess: "read", privateStore: true });
    // Capabilities: the whole pool on every node (2 tools x 3 roles = 6 bindings).
    expect(definition.capabilityBindings.length).toBe(
      new Set(definition.capabilityBindings.map((binding) => binding.capabilityId)).size *
        definition.nodes.length,
    );
    // Latency budget rides every body's hard limit.
    expect(bundle.bodies.every((body) => body.latencyLimits.hardMs === 2000)).toBe(true);
    // Budget split: even — every node can spend the same share.
    expect(new Set(definition.budgets.perNode.map((budget) => budget.maxCallsPerRun))).toEqual(
      new Set([200]),
    );
    // Termination conditions declared by the point, in order.
    expect(definition.termination.conditions).toEqual([
      { kind: "max-ticks", maxTicks: 2000 },
      { kind: "budget-exhausted" },
    ]);
  });

  test("a mismatched model assignment degrades HONESTLY at run time (not hidden)", () => {
    const space = createFootballCandidateSpace(smallSpaceConfig());
    const point = space.validatePoint({
      bodyCount: 2,
      roleMix: "specialist-roles",
      topology: "pipeline",
      delegationDepth: 0,
      communication: "adjacent",
      memoryPolicy: "shared",
      capabilityAssignment: "partitioned-by-role",
      modelAssignment: "uniform-generalist", // generalist policy inside specialist bodies
      computeBudgetSplit: "even",
      latencyBudgetMs: 2000,
      executionOrder: "sequential-stages",
      stoppingConditions: ["max-ticks"],
    });
    const candidate = space.materialize(point);
    const record = runLab({
      domainPack: footballDomainPack,
      organization: candidate.bundle,
      scenario: generateFootballScenario("mismatch-seed", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    // The run stays hard-gate clean (no fabricated claims), but the actions
    // outside the specialist action interfaces are REFUSED and recorded.
    expect(record.metrics.valid).toBe(true);
    expect(record.metrics.violations).toEqual([]);
    expect(
      record.metrics.degradations.filter((degradation) => degradation.code === "action-not-allowed")
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("the three fixture families (contract §Required baselines)", () => {
  const space = createFootballCandidateSpace();

  test("all families produce in-space points and DISTINCT valid organizations", () => {
    const families = fixtureCandidateFamilies();
    expect(families.map((family) => family.familyId)).toEqual([
      "generalist-baseline",
      "hand-designed-pipeline",
      "parameterized-variants",
    ]);
    const organizationIds = new Set<string>();
    for (const family of families) {
      for (const point of family.points(space)) {
        expect(space.contains(point)).toBe(true);
        const candidate = space.materialize(point, { familyId: family.familyId });
        expect(candidate.familyId).toBe(family.familyId);
        expect(() =>
          validateOrganization(candidate.definition, { bodies: candidate.bundle.bodies }),
        ).not.toThrow();
        organizationIds.add(candidate.definition.organizationId);
      }
    }
    expect(organizationIds.size).toBeGreaterThan(3);
  });

  test("the generalist baseline satisfies the MANDATORY baseline contract", () => {
    const candidate = space.materialize(space.generalistBaselinePoint(), {
      familyId: "generalist-baseline",
    });
    const definition = candidate.definition;
    expect(definition.nodes).toHaveLength(1);
    expect(definition.nodes[0]?.bodyRef.bodyId).toBe("lab-generalist-1");
    expect(definition.stages).toHaveLength(1);
    expect(definition.edges).toEqual([]);
    expect(definition.termination.conditions).toEqual([
      { kind: "max-ticks", maxTicks: 2000 },
      { kind: "budget-exhausted" },
    ]);
    expect(definition.budgets.perNode).toHaveLength(1);
  });

  test("the generalist baseline RUNS a lab run, hard-gate clean", () => {
    const candidate = space.materialize(space.generalistBaselinePoint());
    const record = runLab({
      domainPack: footballDomainPack,
      organization: candidate.bundle,
      scenario: generateFootballScenario("family-baseline", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(record.metrics.valid).toBe(true);
    expect(record.metrics.violations).toEqual([]);
    expect(record.metrics.degradations).toEqual([]);
    expect(record.claims.length).toBeGreaterThan(0);
  });

  test("the hand-designed pipeline: perception -> fusion -> render, delegated and staged", () => {
    const families = fixtureCandidateFamilies();
    const pipelineFamily = families[1];
    expect(pipelineFamily).toBeDefined();
    const point = pipelineFamily!.points(space)[0];
    expect(point).toBeDefined();
    const candidate = space.materialize(point!, { familyId: "hand-designed-pipeline" });
    expect(candidate.definition.nodes.map((node) => node.bodyRef.bodyId)).toEqual([
      "lab-perception-1",
      "lab-fusion-1",
      "lab-render-1",
    ]);
    // Full-chain delegation: node-1 -> node-2 -> node-3 (acyclic).
    expect(
      candidate.definition.edges
        .filter((edge) => edge.kind === "delegation")
        .map((edge) => `${edge.from}->${edge.to}`),
    ).toEqual(["node-1->node-2", "node-2->node-3"]);
    expect(candidate.definition.stages).toHaveLength(3);
    // It runs clean: valid, no degradations (the even split covers all ticks).
    const record = runLab({
      domainPack: footballDomainPack,
      organization: candidate.bundle,
      scenario: generateFootballScenario("family-pipeline", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(record.metrics.valid).toBe(true);
    expect(record.metrics.violations).toEqual([]);
    expect(record.metrics.degradations).toEqual([]);
    // All three specialists actually contributed claims.
    const claimKinds = new Set(record.claims.map((claim) => claim.claimKind));
    expect(claimKinds.has("identity-assertion")).toBe(true);
    expect(claimKinds.has("canonical-event")).toBe(true);
    expect(claimKinds.has("output-claim")).toBe(true);
  });

  test("parameterized variants vary body count / delegation depth / budget split", () => {
    const families = fixtureCandidateFamilies();
    const variantFamily = families[2];
    expect(variantFamily).toBeDefined();
    const points = variantFamily!.points(space);
    expect(points.length).toBe(8); // 2 body counts x 2 depths x 2 splits
    const signatures = new Set(
      points.map(
        (point) => `${point.bodyCount}:${point.delegationDepth}:${point.computeBudgetSplit}`,
      ),
    );
    expect(signatures.size).toBe(8);
    // A 3-body weighted-head split measurably differs from the even split.
    const even = space.materialize(
      points.find(
        (point) =>
          point.bodyCount === 3 &&
          point.computeBudgetSplit === "even" &&
          point.delegationDepth === 0,
      ) as CandidateSpacePoint,
    );
    const weighted = space.materialize(
      points.find(
        (point) =>
          point.bodyCount === 3 &&
          point.computeBudgetSplit === "weighted-head" &&
          point.delegationDepth === 0,
      ) as CandidateSpacePoint,
    );
    expect(even.definition.budgets.perNode.map((budget) => budget.maxCallsPerRun)).toEqual([
      200, 200, 200,
    ]);
    expect(weighted.definition.budgets.perNode.map((budget) => budget.maxCallsPerRun)).toEqual([
      300, 150, 150,
    ]);
  });
});

describe("seeded sampling", () => {
  test("same seed ⇒ identical sample; different seed ⇒ different sample", () => {
    const space = createFootballCandidateSpace(smallSpaceConfig());
    const first = space.sample("sample-seed", 12);
    const again = space.sample("sample-seed", 12);
    const other = space.sample("sample-seed-2", 12);
    expect(first).toHaveLength(12);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(first));
    // Distinct points, all in-space, in grid order.
    expect(new Set(first.map((point) => JSON.stringify(point))).size).toBe(12);
    expect(first.every((point) => space.contains(point))).toBe(true);
  });

  test("the sample count is capped at the grid size; zero is zero", () => {
    const space = createFootballCandidateSpace(smallSpaceConfig());
    expect(space.sample("cap", 0)).toEqual([]);
    expect(space.sample("cap", 10_000_000)).toHaveLength(space.count());
  });
});
