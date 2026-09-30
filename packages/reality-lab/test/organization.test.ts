/**
 * Agent Organization tests (REL-004): the versioned directed graph's
 * invariants (every violation typed and in words), the deterministic
 * execution-order walk, and the generalist baseline constructor.
 */
import { describe, expect, test } from "bun:test";
import { OrganizationContractError, executionOrderWalk, validateOrganization } from "../src";
import { baseOrganizationInput, generalistBundle } from "./fixtures";
import type { MutableOrganization } from "./fixtures";

function expectViolations(mutate: (definition: MutableOrganization) => void): string[] {
  const definition = baseOrganizationInput();
  mutate(definition);
  try {
    validateOrganization(definition);
    throw new Error("expected validateOrganization to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(OrganizationContractError);
    const typed = error as OrganizationContractError;
    return typed.violations.map((violation) => violation.code);
  }
}

describe("graph invariants (typed, collective, in words)", () => {
  test("the clean base definition validates and is returned as-is", () => {
    const definition = baseOrganizationInput();
    expect(validateOrganization(definition)).toBe(definition);
  });

  test("not-versioned: version 0 / missing version", () => {
    expect(expectViolations((d) => (d.version = 0))).toContain("not-versioned");
    expect(expectViolations((d) => (d.version = undefined as unknown as number))).toContain(
      "not-versioned",
    );
  });

  test("duplicate node ids", () => {
    expect(expectViolations((d) => d.nodes.push({ ...d.nodes[0]! }))).toContain("duplicate-node");
  });

  test("edges must reference existing nodes", () => {
    expect(
      expectViolations((d) =>
        d.edges.push({
          edgeId: "e2",
          from: "ghost",
          to: "n1",
          kind: "communication",
          channel: "bus",
        }),
      ),
    ).toContain("unknown-edge-endpoint");
  });

  test("nodes must reference declared stages", () => {
    expect(expectViolations((d) => (d.nodes[0]!.stageId = "nope"))).toContain("unknown-stage");
  });

  test("every node must carry a per-node budget", () => {
    expect(
      expectViolations((d) => (d.budgets = { perNode: [], total: d.budgets.total })),
    ).toContain("missing-node-budget");
  });

  test("delegation cycles are refused (the delegation walk must terminate)", () => {
    // n1 -> n2 -> n3 -> n1, ALL delegation edges (n3 added on a valid stage).
    const codes = expectViolations((d) => {
      d.nodes.push({
        nodeId: "n3",
        bodyRef: { bodyId: "generalist-1", version: "0.1.0" },
        binding: { modelId: "m", modelVersion: "0", runtimeId: "r", runtimeVersion: "0" },
        stageId: "s2",
        memoryPolicy: { sharedStoreAccess: "read", privateStore: false },
      });
      d.budgets.perNode.push({ nodeId: "n3", maxCallsPerRun: 10, maxCostUsdPerRun: 1 });
      d.edges.push({
        edgeId: "e-d1",
        from: "n1",
        to: "n2",
        kind: "delegation",
        channel: "delegation",
      });
      d.edges.push({
        edgeId: "e-d2",
        from: "n2",
        to: "n3",
        kind: "delegation",
        channel: "delegation",
      });
      d.edges.push({
        edgeId: "e-d3",
        from: "n3",
        to: "n1",
        kind: "delegation",
        channel: "delegation",
      });
    });
    expect(codes).toContain("delegation-cycle");
  });

  test("communication cycles are LEGAL (only delegation must be acyclic)", () => {
    const definition = baseOrganizationInput();
    definition.edges.push({
      edgeId: "e-back",
      from: "n2",
      to: "n1",
      kind: "communication",
      channel: "org-bus",
    });
    expect(() => validateOrganization(definition)).not.toThrow();
  });

  test("termination conditions must be present", () => {
    expect(expectViolations((d) => (d.termination = { conditions: [] }))).toContain(
      "missing-termination",
    );
  });

  test("body refs must resolve when bodies are provided", () => {
    const { body } = generalistBundle();
    const definition = baseOrganizationInput();
    definition.nodes[0]!.bodyRef = { bodyId: "ghost-body", version: "9.9.9" };
    let caught: unknown;
    try {
      validateOrganization(definition, { bodies: [body] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OrganizationContractError);
    expect((caught as OrganizationContractError).violations.map((v) => v.code)).toContain(
      "unknown-body",
    );
  });

  test("a definition that is not an object is refused typed", () => {
    expect(() => validateOrganization("org")).toThrow(OrganizationContractError);
  });
});

describe("the deterministic execution-order walk", () => {
  test("stages execute in `order` ascending regardless of declaration order", () => {
    const definition = baseOrganizationInput();
    // Declare s2 BEFORE s1 in the array; order (2 before 1 in array, 1 < 2 in order).
    definition.stages = [
      { stageId: "s2", order: 2 },
      { stageId: "s1", order: 1 },
    ];
    expect(executionOrderWalk(definition)).toEqual(["n1", "n2"]);
  });

  test("within a stage, nodes run in declaration order (stable tie-break)", () => {
    const definition = baseOrganizationInput();
    definition.nodes[0]!.stageId = "s2";
    definition.nodes[1]!.stageId = "s2";
    expect(executionOrderWalk(definition)).toEqual(["n1", "n2"]);
    // Swapping declaration order swaps execution order — deterministic.
    definition.nodes = [definition.nodes[1]!, definition.nodes[0]!];
    expect(executionOrderWalk(definition)).toEqual(["n2", "n1"]);
  });

  test("the walk is pure: same definition, same order, every call", () => {
    const definition = baseOrganizationInput();
    expect(executionOrderWalk(definition)).toEqual(executionOrderWalk(definition));
  });
});

describe("the generalist baseline constructor", () => {
  test("produces a valid single-node organization bound to the generalist body", () => {
    const { body, definition } = generalistBundle();
    expect(validateOrganization(definition, { bodies: [body] })).toBe(definition);
    expect(definition.version).toBe(1);
    expect(definition.nodes).toHaveLength(1);
    expect(definition.nodes[0]?.bodyRef.bodyId).toBe(body.bodyId);
    expect(definition.edges).toEqual([]);
    expect(executionOrderWalk(definition)).toEqual(["generalist"]);
    // Budgets present for the single node, lifted from the body's own budget.
    expect(definition.budgets.perNode[0]?.maxCallsPerRun).toBe(body.budget.maxCallsPerRun);
    // Termination: max-ticks + budget-exhausted.
    const kinds = definition.termination.conditions.map((c) => c.kind).sort();
    expect(kinds).toEqual(["budget-exhausted", "max-ticks"]);
  });

  test("a hand-built multi-body organization also validates (the graph is general)", () => {
    const { body } = generalistBundle();
    const definition = baseOrganizationInput();
    definition.edges.push({
      edgeId: "e-delegate",
      from: "n1",
      to: "n2",
      kind: "delegation",
      channel: "delegation",
    });
    expect(() => validateOrganization(definition, { bodies: [body] })).not.toThrow();
  });
});
