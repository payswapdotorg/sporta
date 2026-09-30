/**
 * The Agent Organization contract v0 (REL-004) — a VERSIONED DIRECTED
 * GRAPH per docs/contracts/agent-body-and-organization.md §Organization:
 * nodes = Agent Bodies/instances; edges = communication/delegation; shared/
 * private memory policy; capability bindings; execution stages; budget
 * allocations; termination conditions.
 *
 * Plus the two deterministic services over the graph:
 * - `validateOrganization` — the collective typed invariant check
 *   (versioned, unique ids, edges resolve, every node staged exactly once,
 *   every node budgeted, delegation ACYCLIC — the walk must terminate);
 * - `executionOrderWalk` — the deterministic execution order (stages by
 *   `order` ascending, nodes in declaration order within a stage).
 *
 * Plus the BASELINE SEAM: `createGeneralistOrganization` — the mandatory
 * generalist single-agent comparison point (contract §Required baselines:
 * every benchmark scenario compares one generalist body, one hand-designed
 * organization, and searched candidates — the generalist is THIS slice's
 * seam; search and the hand-designed org are later slices).
 *
 * Status note (boundary discipline): the organization LIFECYCLE
 * (draft -> benchmarked -> ... -> retired) and promotion authority belong
 * to `@sporta/organization-registry` (Worker C's REL-017..019 package) —
 * this module deliberately carries NO status field so no second promotion
 * authority can exist.
 */
import { OrganizationContractError, type OrganizationInvariantViolation } from "../errors";
import type { AgentBodyDefinition } from "./body";

// ---------------------------------------------------------------------------
// The definition (the frozen §Organization shape)
// ---------------------------------------------------------------------------

export interface OrgNodeDefinition {
  nodeId: string;
  bodyRef: { bodyId: string; version: string };
  /** The model/runtime binding inhabiting the body — EXECUTION METADATA. */
  binding: { modelId: string; modelVersion: string; runtimeId: string; runtimeVersion: string };
  stageId: string;
  memoryPolicy: {
    sharedStoreAccess: "read" | "write" | "read-write" | "none";
    privateStore: boolean;
  };
}

export interface OrgEdgeDefinition {
  edgeId: string;
  from: string;
  to: string;
  kind: "communication" | "delegation";
  channel: string;
}

export interface ExecutionStageDefinition {
  stageId: string;
  order: number;
}

export type TerminationCondition =
  | { kind: "max-ticks"; maxTicks: number }
  | { kind: "budget-exhausted" }
  | { kind: "all-stages-complete" };

/** The Agent Organization definition — a versioned directed graph. */
export interface AgentOrganizationDefinition {
  organizationId: string;
  /** Monotonic definition version — organizations are VERSIONED records. */
  version: number;
  nodes: readonly OrgNodeDefinition[];
  edges: readonly OrgEdgeDefinition[];
  stages: readonly ExecutionStageDefinition[];
  sharedMemoryStores: readonly { storeId: string; scope: "organization" }[];
  capabilityBindings: readonly { capabilityId: string; nodeId: string }[];
  budgets: {
    perNode: readonly { nodeId: string; maxCallsPerRun: number; maxCostUsdPerRun: number }[];
    total: { maxCallsPerRun: number; maxCostUsdPerRun: number };
  };
  termination: { conditions: readonly TerminationCondition[] };
}

// ---------------------------------------------------------------------------
// Validation — every invariant, in words, collectively
// ---------------------------------------------------------------------------

export interface ValidateOrganizationOptions {
  /** When provided, bodyRefs must resolve against these bodies. */
  bodies?: readonly AgentBodyDefinition[];
}

/**
 * Validate an organization definition. Throws `OrganizationContractError`
 * listing EVERY violated invariant; returns the definition (typed) when
 * clean.
 */
export function validateOrganization(
  candidate: unknown,
  options: ValidateOrganizationOptions = {},
): AgentOrganizationDefinition {
  const violations: OrganizationInvariantViolation[] = [];
  if (typeof candidate !== "object" || candidate === null) {
    throw new OrganizationContractError("organization definition must be an object", [
      { code: "not-versioned", message: "definition is not an object" },
    ]);
  }
  const def = candidate as Partial<AgentOrganizationDefinition>;
  if (typeof def.organizationId !== "string" || def.organizationId.length === 0) {
    violations.push({
      code: "not-versioned",
      message: "organizationId must be a non-empty string",
    });
  }
  if (typeof def.version !== "number" || !Number.isInteger(def.version) || def.version < 1) {
    violations.push({
      code: "not-versioned",
      message: "version must be an integer >= 1 (organizations are versioned records)",
    });
  }
  const nodes = Array.isArray(def.nodes) ? def.nodes : [];
  const edges = Array.isArray(def.edges) ? def.edges : [];
  const stages = Array.isArray(def.stages) ? def.stages : [];
  const budgets = def.budgets;
  const termination = def.termination;

  if (nodes.length === 0) {
    violations.push({
      code: "unassigned-node",
      message: "an organization needs at least one node",
    });
  }
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.nodeId)) {
      violations.push({
        code: "duplicate-node",
        message: `duplicate node id ${node.nodeId}`,
        nodeId: node.nodeId,
      });
    }
    nodeIds.add(node.nodeId);
  }
  const stageIds = new Set<string>();
  for (const stage of stages) {
    if (stageIds.has(stage.stageId)) {
      violations.push({
        code: "duplicate-stage",
        message: `duplicate stage id ${stage.stageId}`,
        stageId: stage.stageId,
      });
    }
    stageIds.add(stage.stageId);
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.edgeId)) {
      violations.push({
        code: "duplicate-edge",
        message: `duplicate edge id ${edge.edgeId}`,
        edgeId: edge.edgeId,
      });
    }
    edgeIds.add(edge.edgeId);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      violations.push({
        code: "unknown-edge-endpoint",
        message: `edge ${edge.edgeId} references a node that does not exist (${edge.from} -> ${edge.to})`,
        edgeId: edge.edgeId,
      });
    }
  }
  // Every node is staged exactly once, with an existing stage.
  const stagedNodes = new Map<string, number>();
  for (const node of nodes) {
    if (!stageIds.has(node.stageId)) {
      violations.push({
        code: "unknown-stage",
        message: `node ${node.nodeId} references unknown stage ${node.stageId}`,
        nodeId: node.nodeId,
        stageId: node.stageId,
      });
    } else {
      stagedNodes.set(node.nodeId, (stagedNodes.get(node.nodeId) ?? 0) + 1);
    }
  }
  for (const [nodeId, count] of stagedNodes) {
    if (count > 1) {
      violations.push({
        code: "node-multi-stage",
        message: `node ${nodeId} is assigned more than once`,
        nodeId,
      });
    }
  }
  // Budgets: every node must have a per-node budget.
  const budgetByNode = new Map<string, { maxCallsPerRun: number; maxCostUsdPerRun: number }>();
  if (
    budgets === undefined ||
    !Array.isArray(budgets.perNode) ||
    typeof budgets.total !== "object" ||
    budgets.total === null
  ) {
    violations.push({
      code: "missing-node-budget",
      message: "budgets (perNode + total) must be present",
    });
  } else {
    for (const entry of budgets.perNode) {
      budgetByNode.set(entry.nodeId, entry);
    }
    for (const node of nodes) {
      if (!budgetByNode.has(node.nodeId)) {
        violations.push({
          code: "missing-node-budget",
          message: `node ${node.nodeId} has NO budget allocation`,
          nodeId: node.nodeId,
        });
      }
    }
  }
  // Capability bindings reference existing nodes (and known capabilities when bodies given).
  const capabilityBindings = Array.isArray(def.capabilityBindings) ? def.capabilityBindings : [];
  const knownCapabilities = new Set<string>();
  for (const body of options.bodies ?? []) {
    for (const tool of body.tools) knownCapabilities.add(tool.capabilityId);
  }
  for (const binding of capabilityBindings) {
    if (!nodeIds.has(binding.nodeId)) {
      violations.push({
        code: "unknown-capability-node",
        message: `capability binding ${binding.capabilityId} references unknown node ${binding.nodeId}`,
        capabilityId: binding.capabilityId,
        nodeId: binding.nodeId,
      });
    } else if (knownCapabilities.size > 0 && !knownCapabilities.has(binding.capabilityId)) {
      violations.push({
        code: "unknown-capability-node",
        message: `capability ${binding.capabilityId} is not declared by any bound body's tools`,
        capabilityId: binding.capabilityId,
        nodeId: binding.nodeId,
      });
    }
  }
  // Body refs resolve (when bodies are provided).
  if (options.bodies !== undefined) {
    const bodyIndex = new Set(options.bodies.map((body) => `${body.bodyId}@${body.version}`));
    for (const node of nodes) {
      if (!bodyIndex.has(`${node.bodyRef.bodyId}@${node.bodyRef.version}`)) {
        violations.push({
          code: "unknown-body",
          message: `node ${node.nodeId} references body ${node.bodyRef.bodyId}@${node.bodyRef.version} which is not provided`,
          nodeId: node.nodeId,
        });
      }
    }
  }
  // Delegation edges are acyclic (the delegation walk must terminate).
  violations.push(...findDelegationCycles(nodes, edges));
  // Termination conditions present.
  if (
    termination === undefined ||
    !Array.isArray(termination.conditions) ||
    termination.conditions.length === 0
  ) {
    violations.push({
      code: "missing-termination",
      message: "termination conditions must be present and non-empty",
    });
  }

  if (violations.length > 0) {
    throw new OrganizationContractError(
      `organization definition violates ${violations.length} invariant(s)`,
      violations,
    );
  }
  return candidate as AgentOrganizationDefinition;
}

/** DFS over DELEGATION edges only — communication edges may legitimately cycle. */
function findDelegationCycles(
  nodes: readonly OrgNodeDefinition[],
  edges: readonly OrgEdgeDefinition[],
): OrganizationInvariantViolation[] {
  const violations: OrganizationInvariantViolation[] = [];
  const delegation = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== "delegation") continue;
    const list = delegation.get(edge.from) ?? [];
    list.push(edge.to);
    delegation.set(edge.from, list);
  }
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (nodeId: string): void => {
    state.set(nodeId, "visiting");
    stack.push(nodeId);
    for (const next of delegation.get(nodeId) ?? []) {
      const nextState = state.get(next);
      if (nextState === "visiting") {
        const cycleStart = stack.indexOf(next);
        const cycle = [...stack.slice(cycleStart), next].join(" -> ");
        violations.push({
          code: "delegation-cycle",
          message: `delegation cycle detected: ${cycle} (the delegation walk must terminate)`,
          nodeId: next,
        });
      } else if (nextState === undefined) {
        visit(next);
      }
    }
    stack.pop();
    state.set(nodeId, "done");
  };
  for (const node of nodes) {
    if (!state.has(node.nodeId)) visit(node.nodeId);
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The deterministic execution-order walk
// ---------------------------------------------------------------------------

/**
 * The deterministic execution order: stages sorted by `order` ascending
 * (stable), nodes within a stage in declaration order. The same
 * definition ALWAYS yields the same order — organization execution is a
 * deterministic function of its graph.
 */
export function executionOrderWalk(definition: AgentOrganizationDefinition): readonly string[] {
  const stages = [...definition.stages].sort((a, b) => a.order - b.order);
  const order: string[] = [];
  for (const stage of stages) {
    for (const node of definition.nodes) {
      if (node.stageId === stage.stageId) order.push(node.nodeId);
    }
  }
  return order;
}

// ---------------------------------------------------------------------------
// The baseline seam — the generalist single-agent organization
// ---------------------------------------------------------------------------

/**
 * The MANDATORY generalist single-agent organization baseline: one node,
 * one stage, the generalist body, the provided runtime binding, the body's
 * own budget lifted to the organization, and max-ticks + budget-exhausted
 * termination. Every benchmark scenario must be able to run THIS and
 * compare against it (contract §Required baselines).
 */
export function createGeneralistOrganization(options: {
  organizationId?: string;
  body: AgentBodyDefinition;
  binding: { modelId: string; modelVersion: string; runtimeId: string; runtimeVersion: string };
  maxTicks?: number;
}): AgentOrganizationDefinition {
  const body = options.body;
  return {
    organizationId: options.organizationId ?? "org-generalist-baseline",
    version: 1,
    nodes: [
      {
        nodeId: "generalist",
        bodyRef: { bodyId: body.bodyId, version: body.version },
        binding: options.binding,
        stageId: "s1",
        memoryPolicy: { sharedStoreAccess: "read-write", privateStore: true },
      },
    ],
    edges: [],
    stages: [{ stageId: "s1", order: 1 }],
    sharedMemoryStores: [{ storeId: "org-shared", scope: "organization" }],
    capabilityBindings: body.tools.map((tool) => ({
      capabilityId: tool.capabilityId,
      nodeId: "generalist",
    })),
    budgets: {
      perNode: [
        {
          nodeId: "generalist",
          maxCallsPerRun: body.budget.maxCallsPerRun,
          maxCostUsdPerRun: body.budget.maxCostUsdPerRun,
        },
      ],
      total: {
        maxCallsPerRun: body.budget.maxCallsPerRun,
        maxCostUsdPerRun: body.budget.maxCostUsdPerRun,
      },
    },
    termination: {
      conditions: [
        { kind: "max-ticks", maxTicks: options.maxTicks ?? 100_000 },
        { kind: "budget-exhausted" },
      ],
    },
  };
}
