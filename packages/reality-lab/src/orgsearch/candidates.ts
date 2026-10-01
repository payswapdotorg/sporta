/**
 * The Agent Organization candidate space (REL-005) — the typed search space
 * over docs/architecture/reality-engineering-lab.md §5's twelve dimensions:
 *
 *   number of bodies; body roles; topology; delegation; communication;
 *   memory; capabilities; model/algorithm assignments; compute budget;
 *   latency budget; execution order; stopping conditions.
 *
 * A `CandidateSpacePoint` is ONE cell of that grid — twelve typed fields, no
 * more, no less. `materialize` turns a point into a COMPLETE, VALID
 * `AgentOrganizationDefinition` (+ the bodies and runtimes that inhabit it):
 * deterministically, so the same point always yields the same organization.
 * Invalid points are refused by a COLLECTIVE typed error
 * (`CandidateSpaceError` lists every violated dimension constraint), and the
 * materialized definition is defensively re-validated against the v0
 * organization contract before it leaves the seam.
 *
 * Three concrete candidate FAMILIES ship as fixtures (the contract §Required
 * baselines needs them all comparable in one benchmark):
 *  1. the generalist single-agent baseline (MANDATORY — §5: "a generalist
 *     single-agent organization is always a baseline");
 *  2. a hand-designed pipeline organization (perception -> fusion -> render,
 *     full-chain delegation, sequential stages);
 *  3. parameterized variants (body count / delegation depth / budget split).
 *
 * HONESTY NOTES:
 * - the specialist models are SCRIPTED deterministic policies (the same
 *   honesty rules as the generalist: evidence-backed events, identities only
 *   as inferences, declared rights basis, lineage rooted at the run); their
 *   costs and latencies are SIMULATED constants from the scripted-runtime
 *   usage table, never wall-clock measurements;
 * - "uniform-generalist" model assignment over specialist bodies is allowed
 *   in the space ON PURPOSE: the mismatch degrades honestly at run time
 *   (actions outside a body's action interface are refused and recorded as
 *   degradations) — the search DISCOVERS that the assignment is bad, the
 *   space does not hide it;
 * - every candidate organization is lab machinery: nothing here can mutate
 *   authoritative world facts (architecture §6) — the search may only CHOOSE
 *   organizations and parameters.
 */
import { LabValidationError } from "../errors";
import { contentId } from "../hash";
import { LabRng } from "../rng";
import type { AgentBodyDefinition, LabBodyInput, LabBodyOutput } from "../body/body";
import { LabBodyInputSchema, LabBodyOutputSchema } from "../body/body";
import type { ModelRuntime } from "../body/model-runtime";
import { createScriptedModelRuntime, generalistScriptedHandler } from "../body/model-runtime";
import type {
  AgentOrganizationDefinition,
  OrgEdgeDefinition,
  OrgNodeDefinition,
} from "../body/organization";
import { validateOrganization } from "../body/organization";
import type { OrganizationRuntimeBundle } from "../simulation/lab-run";

// ---------------------------------------------------------------------------
// The twelve §5 dimensions, as one typed point
// ---------------------------------------------------------------------------

/** The v0 specialist roles (the generalist is its own role). */
export const CANDIDATE_SPECIALIST_ROLES = ["perception", "fusion", "render"] as const;
export type CandidateSpecialistRole = (typeof CANDIDATE_SPECIALIST_ROLES)[number];
export type CandidateRole = "generalist" | CandidateSpecialistRole;

export type RoleMix = "single-generalist" | "specialist-roles";
export type CandidateTopology = "single" | "pipeline" | "hierarchical" | "mesh";
export type CommunicationPattern = "none" | "adjacent" | "hub" | "all-pairs";
export type MemoryPolicyKind = "private" | "shared" | "hybrid";
export type CapabilityAssignmentKind = "partitioned-by-role" | "all-to-every-node";
export type ModelAssignmentKind = "uniform-generalist" | "per-role-specialist";
export type ComputeBudgetSplitKind = "even" | "weighted-head";
export type ExecutionOrderKind = "single-stage" | "sequential-stages";
export type StoppingConditionKind = "max-ticks" | "budget-exhausted";

/** One cell of the §5 search grid — all twelve dimensions, typed. */
export interface CandidateSpacePoint {
  /** §5 number of bodies. */
  bodyCount: number;
  /** §5 body roles. */
  roleMix: RoleMix;
  /** §5 topology (node-graph shape; "single" is exactly one node). */
  topology: CandidateTopology;
  /** §5 delegation — forward-chain delegation hops from the first node. */
  delegationDepth: number;
  /** §5 communication — which communication edges exist. */
  communication: CommunicationPattern;
  /** §5 memory — shared/private memory policy over the nodes. */
  memoryPolicy: MemoryPolicyKind;
  /** §5 capabilities — how capabilities are bound to nodes. */
  capabilityAssignment: CapabilityAssignmentKind;
  /** §5 model/algorithm assignments — which scripted model inhabits each node. */
  modelAssignment: ModelAssignmentKind;
  /** §5 compute budget — how the total call/cost budget is split per node. */
  computeBudgetSplit: ComputeBudgetSplitKind;
  /** §5 latency budget — the hard latency limit every body carries (ms). */
  latencyBudgetMs: number;
  /** §5 execution order — single stage or one stage per node. */
  executionOrder: ExecutionOrderKind;
  /** §5 stopping conditions (v0 grid: only the two the lab runner enforces). */
  stoppingConditions: readonly StoppingConditionKind[];
}

/** One violated point constraint, in words (collective typed refusals). */
export interface CandidateSpaceViolation {
  dimensionId: string;
  message: string;
}

/**
 * A candidate-space point that violates the grid constraints. COLLECTIVE:
 * every violated dimension is listed in one throw, mirroring
 * `BodyContractError` / `OrganizationContractError`.
 */
export class CandidateSpaceError extends LabValidationError {
  constructor(
    message: string,
    readonly violations: readonly CandidateSpaceViolation[],
  ) {
    super(message, violations);
    this.name = "CandidateSpaceError";
  }
}

/** The space's configuration (what the grid ranges over). */
export interface CandidateSpaceConfig {
  domainPackId: string;
  evaluatorRef: { evaluatorId: string; version: string };
  /** The pack's hard invalidity rule ids (declared binding on every body). */
  hardRuleIds: readonly string[];
  /** §5 number of bodies: 1..maxBodyCount. */
  maxBodyCount: number;
  /** §5 delegation: 0..maxDelegationDepth (also capped at bodyCount-1). */
  maxDelegationDepth: number;
  /** §5 latency budget grid (ms). */
  latencyBudgetsMs: readonly number[];
  /** Total calls per run the organization may spend (split per node). */
  totalCallsBudget: number;
  /** Total simulated cost per run the organization may spend (USD). */
  totalCostBudgetUsd: number;
  /** The max-ticks termination bound when the point stops on max-ticks. */
  defaultMaxTicks: number;
}

/** One §5 dimension descriptor (what the dimension is, and its grid values). */
export interface CandidateDimensionDescriptor {
  /** The architecture §5 dimension name (e.g. "number-of-bodies"). */
  dimensionId: string;
  /** The `CandidateSpacePoint` field this dimension lives in. */
  pointField: keyof CandidateSpacePoint;
  description: string;
  values: readonly unknown[];
}

// ---------------------------------------------------------------------------
// The grid values (v0) and the cross-dimension couplings
// ---------------------------------------------------------------------------

const ROLE_MIXES: readonly RoleMix[] = ["single-generalist", "specialist-roles"];
const TOPOLOGIES: readonly CandidateTopology[] = ["single", "pipeline", "hierarchical", "mesh"];
const COMMUNICATIONS: readonly CommunicationPattern[] = ["none", "adjacent", "hub", "all-pairs"];
const MEMORY_POLICIES: readonly MemoryPolicyKind[] = ["private", "shared", "hybrid"];
const CAPABILITY_ASSIGNMENTS: readonly CapabilityAssignmentKind[] = [
  "partitioned-by-role",
  "all-to-every-node",
];
const MODEL_ASSIGNMENTS: readonly ModelAssignmentKind[] = [
  "uniform-generalist",
  "per-role-specialist",
];
const BUDGET_SPLITS: readonly ComputeBudgetSplitKind[] = ["even", "weighted-head"];
const EXECUTION_ORDERS: readonly ExecutionOrderKind[] = ["single-stage", "sequential-stages"];
const STOPPING_GRID: readonly (readonly StoppingConditionKind[])[] = [
  ["max-ticks"],
  ["max-ticks", "budget-exhausted"],
  ["budget-exhausted"],
];

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** Every constraint a point must satisfy (per-dimension + couplings). */
export function candidatePointViolations(
  point: unknown,
  config: CandidateSpaceConfig,
): CandidateSpaceViolation[] {
  const violations: CandidateSpaceViolation[] = [];
  if (typeof point !== "object" || point === null) {
    return [{ dimensionId: "point", message: "candidate-space point must be an object" }];
  }
  const p = point as Partial<CandidateSpacePoint>;
  const bodyCount = p.bodyCount;
  const bodyCountOk = isIntegerInRange(bodyCount, 1, config.maxBodyCount);
  if (!bodyCountOk) {
    violations.push({
      dimensionId: "number-of-bodies",
      message: `bodyCount must be an integer in [1, ${config.maxBodyCount}] (got ${String(p.bodyCount)})`,
    });
  }
  if (!oneOf(p.roleMix, ROLE_MIXES)) {
    violations.push({
      dimensionId: "body-roles",
      message: `roleMix must be one of ${ROLE_MIXES.join(", ")} (got ${String(p.roleMix)})`,
    });
  }
  if (!oneOf(p.topology, TOPOLOGIES)) {
    violations.push({
      dimensionId: "topology",
      message: `topology must be one of ${TOPOLOGIES.join(", ")} (got ${String(p.topology)})`,
    });
  } else if (bodyCountOk) {
    if (p.topology === "single" && p.bodyCount !== 1) {
      violations.push({
        dimensionId: "topology",
        message: `topology "single" means exactly one body (got bodyCount ${p.bodyCount})`,
      });
    }
    if (p.topology !== "single" && p.bodyCount === 1) {
      violations.push({
        dimensionId: "topology",
        message: `topology "${p.topology}" needs at least two bodies (got bodyCount 1)`,
      });
    }
  }
  const maxDepth = Math.min(config.maxDelegationDepth, (p.bodyCount ?? 1) - 1);
  if (!isIntegerInRange(p.delegationDepth, 0, Math.max(0, maxDepth))) {
    violations.push({
      dimensionId: "delegation",
      message:
        `delegationDepth must be an integer in [0, ${Math.max(0, maxDepth)}] ` +
        `(capped by maxDelegationDepth ${config.maxDelegationDepth} and bodyCount-1; ` +
        `got ${String(p.delegationDepth)})`,
    });
  }
  if (!oneOf(p.communication, COMMUNICATIONS)) {
    violations.push({
      dimensionId: "communication",
      message: `communication must be one of ${COMMUNICATIONS.join(", ")} (got ${String(p.communication)})`,
    });
  } else if (p.communication !== "none" && typeof bodyCount === "number" && bodyCount < 2) {
    violations.push({
      dimensionId: "communication",
      message: `communication "${p.communication}" needs at least two bodies`,
    });
  }
  if (!oneOf(p.memoryPolicy, MEMORY_POLICIES)) {
    violations.push({
      dimensionId: "memory",
      message: `memoryPolicy must be one of ${MEMORY_POLICIES.join(", ")} (got ${String(p.memoryPolicy)})`,
    });
  }
  if (!oneOf(p.capabilityAssignment, CAPABILITY_ASSIGNMENTS)) {
    violations.push({
      dimensionId: "capabilities",
      message:
        `capabilityAssignment must be one of ${CAPABILITY_ASSIGNMENTS.join(", ")} ` +
        `(got ${String(p.capabilityAssignment)})`,
    });
  }
  if (!oneOf(p.modelAssignment, MODEL_ASSIGNMENTS)) {
    violations.push({
      dimensionId: "model-assignments",
      message:
        `modelAssignment must be one of ${MODEL_ASSIGNMENTS.join(", ")} ` +
        `(got ${String(p.modelAssignment)})`,
    });
  }
  if (!oneOf(p.computeBudgetSplit, BUDGET_SPLITS)) {
    violations.push({
      dimensionId: "compute-budget",
      message:
        `computeBudgetSplit must be one of ${BUDGET_SPLITS.join(", ")} ` +
        `(got ${String(p.computeBudgetSplit)})`,
    });
  }
  if (
    typeof p.latencyBudgetMs !== "number" ||
    !config.latencyBudgetsMs.includes(p.latencyBudgetMs)
  ) {
    violations.push({
      dimensionId: "latency-budget",
      message:
        `latencyBudgetMs must be one of ${config.latencyBudgetsMs.join(", ")} ` +
        `(got ${String(p.latencyBudgetMs)})`,
    });
  }
  if (!oneOf(p.executionOrder, EXECUTION_ORDERS)) {
    violations.push({
      dimensionId: "execution-order",
      message:
        `executionOrder must be one of ${EXECUTION_ORDERS.join(", ")} ` +
        `(got ${String(p.executionOrder)})`,
    });
  }
  const stopping = p.stoppingConditions;
  if (
    !Array.isArray(stopping) ||
    stopping.length === 0 ||
    !stopping.every((kind) => kind === "max-ticks" || kind === "budget-exhausted") ||
    new Set(stopping).size !== stopping.length
  ) {
    violations.push({
      dimensionId: "stopping-conditions",
      message:
        "stoppingConditions must be a non-empty duplicate-free subset of " +
        "[max-ticks, budget-exhausted] (the two the v0 lab runner enforces; " +
        `got ${JSON.stringify(stopping ?? null)})`,
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The candidate space itself
// ---------------------------------------------------------------------------

/** A materialized candidate: the point, the definition, and its runtime bundle. */
export interface MaterializedCandidate {
  candidateId: string;
  familyId: string | null;
  point: CandidateSpacePoint;
  definition: AgentOrganizationDefinition;
  bundle: OrganizationRuntimeBundle;
}

/** The typed §5 candidate space (enumerate / sample / validate / materialize). */
export interface OrganizationCandidateSpace {
  readonly spaceId: string;
  readonly version: string;
  readonly config: CandidateSpaceConfig;
  /** The twelve §5 dimension descriptors with their grid values. */
  readonly dimensions: readonly CandidateDimensionDescriptor[];
  /** The MANDATORY generalist single-agent baseline point (§5). */
  generalistBaselinePoint(): CandidateSpacePoint;
  /** Validate a point; throws `CandidateSpaceError` listing every violation. */
  validatePoint(point: unknown): CandidateSpacePoint;
  /** True when the point satisfies every grid constraint. */
  contains(point: unknown): boolean;
  /** Every valid grid point, in deterministic dimension order. */
  enumerate(): readonly CandidateSpacePoint[];
  /** Lazily yield every valid grid point in the same order as `enumerate`. */
  iterate(): Iterable<CandidateSpacePoint>;
  /** How many valid grid points exist (a pure counting pass, no allocation). */
  count(): number;
  /** A seeded sample of distinct points, in grid order (deterministic). */
  sample(seed: string, count: number): readonly CandidateSpacePoint[];
  /** Deterministically materialize a point into a complete organization. */
  materialize(point: CandidateSpacePoint, options?: { familyId?: string }): MaterializedCandidate;
}

/** The default football candidate-space configuration. */
export function defaultFootballCandidateSpaceConfig(): CandidateSpaceConfig {
  return {
    domainPackId: "football",
    evaluatorRef: { evaluatorId: "football-lab-evaluator", version: "0.2.0" },
    hardRuleIds: [
      "fabricated-canonical-event",
      "fabricated-identity-as-fact",
      "rights-policy-violation",
      "impossible-output-claim",
      "provenance-bypass",
      "invalid-artifact-lineage",
    ],
    maxBodyCount: 4,
    maxDelegationDepth: 3,
    latencyBudgetsMs: [500, 1000, 2000],
    totalCallsBudget: 600,
    totalCostBudgetUsd: 3,
    defaultMaxTicks: 2000,
  };
}

/**
 * Build the football candidate space. The grid is the full §5 product below
 * `config`'s ranges, pruned by the declared couplings (a "single" topology is
 * exactly one body; communication needs peers; delegation depth is capped by
 * the body count). Enumeration order is FIXED (dimension order, values in
 * declared order) so the same config always enumerates identically.
 */
export function createFootballCandidateSpace(
  config: CandidateSpaceConfig = defaultFootballCandidateSpaceConfig(),
): OrganizationCandidateSpace {
  validateSpaceConfig(config);
  const spaceId = `football-candidate-space:${contentId({
    kind: "candidate-space/0.1",
    config,
  })}`;

  const bodyCounts: number[] = [];
  for (let n = 1; n <= config.maxBodyCount; n++) bodyCounts.push(n);
  const depths: number[] = [];
  for (let d = 0; d <= config.maxDelegationDepth; d++) depths.push(d);

  const dimensions: readonly CandidateDimensionDescriptor[] = [
    {
      dimensionId: "number-of-bodies",
      pointField: "bodyCount",
      description: "How many bodies the organization has.",
      values: bodyCounts,
    },
    {
      dimensionId: "body-roles",
      pointField: "roleMix",
      description:
        "One generalist per node, or specialist roles (perception/fusion/render) cycled by node index.",
      values: ROLE_MIXES,
    },
    {
      dimensionId: "topology",
      pointField: "topology",
      description: "Node-graph shape; 'single' is exactly one node.",
      values: TOPOLOGIES,
    },
    {
      dimensionId: "delegation",
      pointField: "delegationDepth",
      description: "Forward-chain delegation hops from the first node (acyclic by construction).",
      values: depths,
    },
    {
      dimensionId: "communication",
      pointField: "communication",
      description: "Which communication edges exist between nodes.",
      values: COMMUNICATIONS,
    },
    {
      dimensionId: "memory",
      pointField: "memoryPolicy",
      description:
        "Shared/private memory policy: private, shared, or hybrid (head read-write, workers read).",
      values: MEMORY_POLICIES,
    },
    {
      dimensionId: "capabilities",
      pointField: "capabilityAssignment",
      description: "Capabilities partitioned by role, or the whole pool bound to every node.",
      values: CAPABILITY_ASSIGNMENTS,
    },
    {
      dimensionId: "model-assignments",
      pointField: "modelAssignment",
      description:
        "Every node bound to the generalist scripted model, or each node to its role's model.",
      values: MODEL_ASSIGNMENTS,
    },
    {
      dimensionId: "compute-budget",
      pointField: "computeBudgetSplit",
      description: "The total call/cost budget split evenly, or weighted toward the head node.",
      values: BUDGET_SPLITS,
    },
    {
      dimensionId: "latency-budget",
      pointField: "latencyBudgetMs",
      description: "The hard latency limit (ms) every body in the candidate carries.",
      values: config.latencyBudgetsMs,
    },
    {
      dimensionId: "execution-order",
      pointField: "executionOrder",
      description: "All nodes in one stage, or one stage per node in declaration order.",
      values: EXECUTION_ORDERS,
    },
    {
      dimensionId: "stopping-conditions",
      pointField: "stoppingConditions",
      description:
        "Which termination conditions the organization declares (v0 grid: max-ticks and/or budget-exhausted).",
      values: STOPPING_GRID,
    },
  ];

  /** Cross-dimension coupling check for combos already on the per-dimension grids. */
  const comboValid = (
    bodyCount: number,
    topology: CandidateTopology,
    depth: number,
    communication: CommunicationPattern,
  ): boolean => {
    if ((topology === "single") !== (bodyCount === 1)) return false;
    if (communication !== "none" && bodyCount < 2) return false;
    if (depth > bodyCount - 1 || depth > config.maxDelegationDepth) return false;
    return true;
  };

  function* streamPoints(): Generator<CandidateSpacePoint> {
    for (const bodyCount of bodyCounts) {
      for (const roleMix of ROLE_MIXES) {
        for (const topology of TOPOLOGIES) {
          for (const delegationDepth of depths) {
            for (const communication of COMMUNICATIONS) {
              if (!comboValid(bodyCount, topology, delegationDepth, communication)) continue;
              for (const memoryPolicy of MEMORY_POLICIES) {
                for (const capabilityAssignment of CAPABILITY_ASSIGNMENTS) {
                  for (const modelAssignment of MODEL_ASSIGNMENTS) {
                    for (const computeBudgetSplit of BUDGET_SPLITS) {
                      for (const latencyBudgetMs of config.latencyBudgetsMs) {
                        for (const executionOrder of EXECUTION_ORDERS) {
                          for (const stoppingConditions of STOPPING_GRID) {
                            yield freezePoint({
                              bodyCount,
                              roleMix,
                              topology,
                              delegationDepth,
                              communication,
                              memoryPolicy,
                              capabilityAssignment,
                              modelAssignment,
                              computeBudgetSplit,
                              latencyBudgetMs,
                              executionOrder,
                              stoppingConditions,
                            });
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const space: OrganizationCandidateSpace = {
    spaceId,
    version: "0.1",
    config,
    dimensions,
    generalistBaselinePoint(): CandidateSpacePoint {
      // The mandatory baseline mirrors the v0 `createGeneralistOrganization`
      // shape: one generalist body, one stage, the most generous latency
      // budget in the grid, max-ticks + budget-exhausted termination.
      return freezePoint({
        bodyCount: 1,
        roleMix: "single-generalist",
        topology: "single",
        delegationDepth: 0,
        communication: "none",
        memoryPolicy: "hybrid", // head policy: shared read-write + private store — the v0 baseline node
        capabilityAssignment: "partitioned-by-role",
        modelAssignment: "uniform-generalist",
        computeBudgetSplit: "even",
        latencyBudgetMs: Math.max(...config.latencyBudgetsMs),
        executionOrder: "single-stage",
        stoppingConditions: ["max-ticks", "budget-exhausted"],
      });
    },
    validatePoint(point: unknown): CandidateSpacePoint {
      const violations = candidatePointViolations(point, config);
      if (violations.length > 0) {
        throw new CandidateSpaceError(
          `candidate-space point violates ${violations.length} constraint(s) of space ${spaceId}`,
          violations,
        );
      }
      return freezePoint({ ...(point as CandidateSpacePoint) });
    },
    contains(point: unknown): boolean {
      return candidatePointViolations(point, config).length === 0;
    },
    enumerate(): readonly CandidateSpacePoint[] {
      return [...streamPoints()];
    },
    iterate(): Iterable<CandidateSpacePoint> {
      return streamPoints();
    },
    count(): number {
      let total = 0;
      for (const bodyCount of bodyCounts) {
        for (const topology of TOPOLOGIES) {
          for (const delegationDepth of depths) {
            for (const communication of COMMUNICATIONS) {
              if (!comboValid(bodyCount, topology, delegationDepth, communication)) continue;
              // roleMix participates in no coupling, so it multiplies.
              total +=
                ROLE_MIXES.length *
                MEMORY_POLICIES.length *
                CAPABILITY_ASSIGNMENTS.length *
                MODEL_ASSIGNMENTS.length *
                BUDGET_SPLITS.length *
                config.latencyBudgetsMs.length *
                EXECUTION_ORDERS.length *
                STOPPING_GRID.length;
            }
          }
        }
      }
      return total;
    },
    sample(seed: string, count: number): readonly CandidateSpacePoint[] {
      const total = space.count();
      const n = Math.max(0, Math.min(count, total));
      if (n === 0) return [];
      // Seeded partial Fisher-Yates over [0, total): the first n indices are
      // the selected ones; the points are then picked in GRID order, so the
      // sample's order is content-stable, not draw-order-stable.
      const rng = new LabRng(`${spaceId}::sample:${seed}`);
      const indices = Array.from({ length: total }, (_, i) => i);
      for (let i = 0; i < n; i++) {
        const j = rng.int(i, total);
        const a = indices[i];
        const b = indices[j];
        if (a === undefined || b === undefined) continue;
        indices[i] = b;
        indices[j] = a;
      }
      const selected = new Set(indices.slice(0, n));
      const picked: CandidateSpacePoint[] = [];
      let index = 0;
      for (const point of streamPoints()) {
        if (selected.has(index)) picked.push(point);
        index += 1;
        if (picked.length === n) break;
      }
      return picked;
    },
    materialize(
      point: CandidateSpacePoint,
      options: { familyId?: string } = {},
    ): MaterializedCandidate {
      const valid = space.validatePoint(point);
      const candidateId = candidatePointId(spaceId, valid);
      const organizationId = `org-candidate-${candidateId}`;
      const definition = buildOrganization(valid, config, organizationId);
      const bundle = buildBundle(valid, definition, config);
      // Defensive: a materialized candidate MUST satisfy the frozen v0
      // organization contract. If this ever throws, materialization has a
      // bug — fail loud, never hand back a broken organization.
      validateOrganization(definition, { bodies: bundle.bodies });
      return {
        candidateId,
        familyId: options.familyId ?? null,
        point: valid,
        definition,
        bundle,
      };
    },
  };
  return space;
}

function validateSpaceConfig(config: CandidateSpaceConfig): void {
  const problems: string[] = [];
  if (config.maxBodyCount < 1) problems.push("maxBodyCount must be >= 1");
  if (config.maxDelegationDepth < 0) problems.push("maxDelegationDepth must be >= 0");
  if (config.latencyBudgetsMs.length === 0) problems.push("latencyBudgetsMs must be non-empty");
  else if (!config.latencyBudgetsMs.every((ms) => ms >= 1)) {
    problems.push("every latencyBudgetsMs entry must be >= 1");
  }
  if (!Number.isInteger(config.totalCallsBudget) || config.totalCallsBudget < config.maxBodyCount) {
    problems.push(
      "totalCallsBudget must be an integer >= maxBodyCount (every node needs >= 1 call)",
    );
  }
  if (config.totalCostBudgetUsd <= 0) problems.push("totalCostBudgetUsd must be > 0");
  if (!Number.isInteger(config.defaultMaxTicks) || config.defaultMaxTicks < 1) {
    problems.push("defaultMaxTicks must be an integer >= 1");
  }
  if (problems.length > 0) {
    throw new LabValidationError(
      `invalid candidate-space config: ${problems.join("; ")}`,
      problems,
    );
  }
}

function freezePoint(point: CandidateSpacePoint): CandidateSpacePoint {
  return Object.freeze({
    ...point,
    stoppingConditions: Object.freeze([...point.stoppingConditions]),
  });
}

/** A grid latency budget by preferred index, falling back to the first (the config guarantees non-empty). */
function pickLatencyBudget(budgets: readonly number[], preferredIndex: number): number {
  const value = budgets[preferredIndex] ?? budgets[0];
  if (value === undefined) {
    throw new LabValidationError("latencyBudgetsMs must be non-empty");
  }
  return value;
}

/** The stable, content-derived id of a point inside a space. */
export function candidatePointId(spaceId: string, point: CandidateSpacePoint): string {
  return contentId({ kind: "org-candidate/0.1", spaceId, point });
}

// ---------------------------------------------------------------------------
// The role catalog: bodies, bindings, and the scripted specialist policies
// ---------------------------------------------------------------------------

interface RoleSpec {
  role: CandidateRole;
  bodyId: string;
  roleId: string;
  description: string;
  tools: readonly { capabilityId: string; version: string }[];
  allowedActionIds: readonly string[];
  binding: { modelId: string; modelVersion: string; runtimeId: string; runtimeVersion: string };
  perCallCostUsd: number;
  perCallLatencyMs: number;
}

const GENERALIST_TOOLS = [
  { capabilityId: "perception.broadcast-frame-ingest", version: "0.1.0" },
  { capabilityId: "perception.tracking-ingest", version: "0.1.0" },
  { capabilityId: "event.fusion", version: "0.1.0" },
  { capabilityId: "identity.resolution", version: "0.1.0" },
  { capabilityId: "render.tactical", version: "0.1.0" },
] as const;

const ROLE_SPECS: readonly RoleSpec[] = [
  {
    role: "generalist",
    bodyId: "lab-generalist-1",
    roleId: "generalist",
    description:
      "A single body that ingests every observation kind and emits every decision " +
      "(the candidate-space generalist).",
    tools: GENERALIST_TOOLS,
    allowedActionIds: [
      "emit-canonical-event",
      "emit-identity-assertion",
      "request-render",
      "escalate-uncertainty",
    ],
    binding: {
      modelId: "generalist-scripted-policy",
      modelVersion: "0.1.0",
      runtimeId: "scripted:generalist-scripted-policy",
      runtimeVersion: "0.1.0",
    },
    perCallCostUsd: 0.001,
    perCallLatencyMs: 120,
  },
  {
    role: "perception",
    bodyId: "lab-perception-1",
    roleId: "perception-specialist",
    description:
      "A perception specialist: resolves identities from tracking samples (always as " +
      "inferences) and escalates when broadcast frames drop.",
    tools: [
      { capabilityId: "perception.broadcast-frame-ingest", version: "0.1.0" },
      { capabilityId: "perception.tracking-ingest", version: "0.1.0" },
    ],
    allowedActionIds: ["emit-identity-assertion", "escalate-uncertainty"],
    binding: {
      modelId: "perception-scripted-policy",
      modelVersion: "0.1.0",
      runtimeId: "scripted:perception-scripted-policy",
      runtimeVersion: "0.1.0",
    },
    perCallCostUsd: 0.0005,
    perCallLatencyMs: 60,
  },
  {
    role: "fusion",
    bodyId: "lab-fusion-1",
    roleId: "fusion-specialist",
    description:
      "An event-fusion specialist: emits canonical events only for event records it " +
      "actually received (evidence-backed, never fabricated).",
    tools: [
      { capabilityId: "event.fusion", version: "0.1.0" },
      { capabilityId: "identity.resolution", version: "0.1.0" },
    ],
    allowedActionIds: ["emit-canonical-event", "escalate-uncertainty"],
    binding: {
      modelId: "fusion-scripted-policy",
      modelVersion: "0.1.0",
      runtimeId: "scripted:fusion-scripted-policy",
      runtimeVersion: "0.1.0",
    },
    perCallCostUsd: 0.0012,
    perCallLatencyMs: 150,
  },
  {
    role: "render",
    bodyId: "lab-render-1",
    roleId: "render-specialist",
    description:
      "A render specialist: requests the tactical render target with a declared " +
      "lab-only rights basis.",
    tools: [{ capabilityId: "render.tactical", version: "0.1.0" }],
    allowedActionIds: ["request-render", "escalate-uncertainty"],
    binding: {
      modelId: "render-scripted-policy",
      modelVersion: "0.1.0",
      runtimeId: "scripted:render-scripted-policy",
      runtimeVersion: "0.1.0",
    },
    perCallCostUsd: 0.002,
    perCallLatencyMs: 240,
  },
];

function roleSpec(role: CandidateRole): RoleSpec {
  const spec = ROLE_SPECS.find((entry) => entry.role === role);
  if (spec === undefined) throw new LabValidationError(`unknown candidate role ${role}`);
  return spec;
}

/** The role a node with index `i` (1-based) inhabits under a point. */
export function candidateRoleForNode(
  point: CandidateSpacePoint,
  nodeIndex1Based: number,
): CandidateRole {
  if (point.roleMix === "single-generalist") return "generalist";
  const role =
    CANDIDATE_SPECIALIST_ROLES[(nodeIndex1Based - 1) % CANDIDATE_SPECIALIST_ROLES.length];
  return role ?? "perception";
}

function buildBody(
  point: CandidateSpacePoint,
  role: CandidateRole,
  config: CandidateSpaceConfig,
): AgentBodyDefinition {
  const spec = roleSpec(role);
  return {
    bodyId: spec.bodyId,
    version: "0.1.0",
    role: { roleId: spec.roleId, description: spec.description },
    domainCompatibility: {
      domainPackIds: [config.domainPackId],
      notes: `candidate-space body (${spec.roleId}); latency budget ${point.latencyBudgetMs}ms from the §5 point`,
    },
    inputSchema: LabBodyInputSchema,
    outputSchema: LabBodyOutputSchema,
    tools: spec.tools.map((tool) => ({ ...tool })),
    permissions: [{ permissionId: "lab.simulate", scope: "lab-run" }],
    memoryInterfaces: [{ storeId: "org-shared", access: "read-write" }],
    communicationInterface: { channels: [{ channelId: "org-bus", direction: "both" }] },
    actionInterface: { allowedActionIds: [...spec.allowedActionIds] },
    budget: {
      maxCallsPerRun: config.totalCallsBudget,
      maxCostUsdPerRun: config.totalCostBudgetUsd,
    },
    latencyLimits: {
      softMs: Math.round(point.latencyBudgetMs / 2),
      hardMs: point.latencyBudgetMs,
    },
    evaluatorHooks: [
      { evaluatorId: config.evaluatorRef.evaluatorId, version: config.evaluatorRef.version },
    ],
    safetyPolicy: { policyIds: ["adr-013-hard-gates"], hardRules: [...config.hardRuleIds] },
  };
}

/** A fresh scripted runtime for a role (deterministic policy, simulated usage). */
export function createCandidateRoleRuntime(role: CandidateRole): ModelRuntime {
  const spec = roleSpec(role);
  return createScriptedModelRuntime({
    modelId: spec.binding.modelId,
    modelVersion: spec.binding.modelVersion,
    runtimeId: spec.binding.runtimeId,
    handler: roleHandler(role),
    perCallCostUsd: spec.perCallCostUsd,
    perCallSimulatedLatencyMs: spec.perCallLatencyMs,
  });
}

function roleHandler(role: CandidateRole): (input: LabBodyInput) => LabBodyOutput {
  switch (role) {
    case "generalist":
      return generalistScriptedHandler;
    case "perception":
      return perceptionScriptedHandler;
    case "fusion":
      return fusionScriptedHandler;
    case "render":
      return renderScriptedHandler;
  }
}

// The specialist policies — the same honesty rules as the generalist's.

export function perceptionScriptedHandler(input: LabBodyInput): LabBodyOutput {
  const actions: LabBodyOutput["actions"] = [];
  for (const observation of input.observations) {
    if (observation.kindId === "tracking-sample") {
      const payload = payloadField<{ playerId?: unknown }>(observation.payload);
      if (payload !== null && typeof payload.playerId === "string") {
        actions.push({
          actionId: "emit-identity-assertion",
          claimId: `claim-id-${observation.observationId}`,
          entityId: payload.playerId,
          presentedAs: "inference",
          basis: "observed",
          evidenceRef: observation.observationId,
        });
      }
    }
    if (observation.kindId === "broadcast-frame") {
      const payload = payloadField<{ dropped?: unknown }>(observation.payload);
      if (payload?.dropped === true) {
        actions.push({
          actionId: "escalate-uncertainty",
          note: `broadcast frame dropped at tick ${observation.tickIndex}`,
          clockMs: observation.clockMs,
        });
      }
    }
  }
  return {
    actions,
    sharedMemoryWrite: { lastPerceptionClockMs: input.clockMs },
  };
}

export function fusionScriptedHandler(input: LabBodyInput): LabBodyOutput {
  const actions: LabBodyOutput["actions"] = [];
  for (const observation of input.observations) {
    if (observation.kindId === "event-record") {
      const payload = payloadField<{ eventId?: unknown; eventKindId?: unknown }>(
        observation.payload,
      );
      if (
        payload !== null &&
        typeof payload.eventId === "string" &&
        typeof payload.eventKindId === "string"
      ) {
        actions.push({
          actionId: "emit-canonical-event",
          claimId: `claim-evt-${payload.eventId}`,
          eventKindId: payload.eventKindId,
          evidenceRef: observation.observationId,
          clockMs: observation.clockMs,
        });
      }
    }
  }
  return { actions, sharedMemoryWrite: { lastFusedClockMs: input.clockMs } };
}

export function renderScriptedHandler(input: LabBodyInput): LabBodyOutput {
  const actions: LabBodyOutput["actions"] = [];
  if (input.tickIndex === 10) {
    actions.push({
      actionId: "request-render",
      claimId: "claim-render-tactical",
      renderTargetId: "tactical",
      rightsBasis: "lab-simulation-only",
      clockMs: input.clockMs,
    });
  }
  return { actions };
}

function payloadField<T extends object>(payload: unknown): T | null {
  if (typeof payload !== "object" || payload === null) return null;
  return payload as T;
}

// ---------------------------------------------------------------------------
// Deterministic materialization: point -> complete organization definition
// ---------------------------------------------------------------------------

function nodeId(index1Based: number): string {
  return `node-${index1Based}`;
}

function buildOrganization(
  point: CandidateSpacePoint,
  config: CandidateSpaceConfig,
  organizationId: string,
): AgentOrganizationDefinition {
  const nodeRoles: CandidateRole[] = [];
  for (let i = 1; i <= point.bodyCount; i++) nodeRoles.push(candidateRoleForNode(point, i));

  const stages =
    point.executionOrder === "single-stage"
      ? [{ stageId: "stage-1", order: 1 }]
      : nodeRoles.map((_, index) => ({ stageId: `stage-${index + 1}`, order: index + 1 }));

  const nodes: OrgNodeDefinition[] = nodeRoles.map((role, index) => {
    const i = index + 1;
    const memoryPolicy =
      point.memoryPolicy === "private"
        ? { sharedStoreAccess: "none" as const, privateStore: true }
        : point.memoryPolicy === "shared"
          ? { sharedStoreAccess: "read-write" as const, privateStore: false }
          : i === 1
            ? { sharedStoreAccess: "read-write" as const, privateStore: true }
            : { sharedStoreAccess: "read" as const, privateStore: true };
    const binding =
      point.modelAssignment === "uniform-generalist"
        ? roleSpec("generalist").binding
        : roleSpec(role).binding;
    return {
      nodeId: nodeId(i),
      bodyRef: { bodyId: roleSpec(role).bodyId, version: "0.1.0" },
      binding: { ...binding },
      stageId: point.executionOrder === "single-stage" ? "stage-1" : `stage-${i}`,
      memoryPolicy,
    };
  });

  const edges: OrgEdgeDefinition[] = [];
  if (point.communication === "adjacent") {
    for (let i = 2; i <= point.bodyCount; i++) {
      edges.push({
        edgeId: `comm-${i}`,
        from: nodeId(i),
        to: nodeId(i - 1),
        kind: "communication",
        channel: "org-bus",
      });
    }
  } else if (point.communication === "hub") {
    for (let i = 2; i <= point.bodyCount; i++) {
      edges.push({
        edgeId: `comm-${i}`,
        from: nodeId(i),
        to: nodeId(1),
        kind: "communication",
        channel: "org-bus",
      });
    }
  } else if (point.communication === "all-pairs") {
    for (let i = 1; i <= point.bodyCount; i++) {
      for (let j = 1; j <= point.bodyCount; j++) {
        if (i === j) continue;
        edges.push({
          edgeId: `comm-${i}-${j}`,
          from: nodeId(i),
          to: nodeId(j),
          kind: "communication",
          channel: "org-bus",
        });
      }
    }
  }
  // Delegation: forward-chain hops from the first node — acyclic by construction.
  for (let i = 1; i <= point.delegationDepth && i < point.bodyCount; i++) {
    edges.push({
      edgeId: `deleg-${i}`,
      from: nodeId(i),
      to: nodeId(i + 1),
      kind: "delegation",
      channel: "delegation",
    });
  }

  const capabilityBindings: { capabilityId: string; nodeId: string }[] = [];
  if (point.capabilityAssignment === "partitioned-by-role") {
    for (const [index, role] of nodeRoles.entries()) {
      for (const tool of roleSpec(role).tools) {
        capabilityBindings.push({ capabilityId: tool.capabilityId, nodeId: nodeId(index + 1) });
      }
    }
  } else {
    // The whole pool (union of the candidate's bodies' tools, first-seen
    // order) bound to every node: "everyone can do everything".
    const pool: string[] = [];
    for (const role of nodeRoles) {
      for (const tool of roleSpec(role).tools) {
        if (!pool.includes(tool.capabilityId)) pool.push(tool.capabilityId);
      }
    }
    for (let i = 1; i <= point.bodyCount; i++) {
      for (const capabilityId of pool) {
        capabilityBindings.push({ capabilityId, nodeId: nodeId(i) });
      }
    }
  }

  const total = {
    maxCallsPerRun: config.totalCallsBudget,
    maxCostUsdPerRun: config.totalCostBudgetUsd,
  };
  const perNode: { nodeId: string; maxCallsPerRun: number; maxCostUsdPerRun: number }[] = [];
  if (point.computeBudgetSplit === "even") {
    const calls = Math.ceil(total.maxCallsPerRun / point.bodyCount);
    const cost = total.maxCostUsdPerRun / point.bodyCount;
    for (let i = 1; i <= point.bodyCount; i++) {
      perNode.push({ nodeId: nodeId(i), maxCallsPerRun: calls, maxCostUsdPerRun: cost });
    }
  } else {
    const headCalls = Math.ceil(total.maxCallsPerRun / 2);
    const headCost = total.maxCostUsdPerRun / 2;
    perNode.push({ nodeId: nodeId(1), maxCallsPerRun: headCalls, maxCostUsdPerRun: headCost });
    if (point.bodyCount > 1) {
      const restCalls = Math.ceil((total.maxCallsPerRun - headCalls) / (point.bodyCount - 1));
      const restCost = (total.maxCostUsdPerRun - headCost) / (point.bodyCount - 1);
      for (let i = 2; i <= point.bodyCount; i++) {
        perNode.push({ nodeId: nodeId(i), maxCallsPerRun: restCalls, maxCostUsdPerRun: restCost });
      }
    }
  }

  const conditions = point.stoppingConditions.map((kind) =>
    kind === "max-ticks"
      ? { kind: "max-ticks" as const, maxTicks: config.defaultMaxTicks }
      : { kind: "budget-exhausted" as const },
  );

  return {
    organizationId,
    version: 1,
    nodes,
    edges,
    stages,
    sharedMemoryStores: [{ storeId: "org-shared", scope: "organization" }],
    capabilityBindings,
    budgets: { perNode, total },
    termination: { conditions },
  };
}

function buildBundle(
  point: CandidateSpacePoint,
  definition: AgentOrganizationDefinition,
  config: CandidateSpaceConfig,
): OrganizationRuntimeBundle {
  const roleSet = new Set<CandidateRole>();
  for (let i = 1; i <= point.bodyCount; i++) roleSet.add(candidateRoleForNode(point, i));
  roleSet.add("generalist"); // the uniform assignment may bind it to any node
  const bodies = [...roleSet].map((role) => buildBody(point, role, config));
  const runtimes = new Map<string, ModelRuntime>();
  for (const role of roleSet) {
    const runtime = createCandidateRoleRuntime(role);
    runtimes.set(runtime.runtimeId, runtime);
  }
  return { definition, bodies, runtimes };
}

// ---------------------------------------------------------------------------
// The three fixture families (contract §Required baselines)
// ---------------------------------------------------------------------------

/** A candidate family: a named set of points the benchmark always compares. */
export interface CandidateFamily {
  familyId: string;
  description: string;
  points(space: OrganizationCandidateSpace): readonly CandidateSpacePoint[];
}

function requireInSpace(
  space: OrganizationCandidateSpace,
  points: readonly CandidateSpacePoint[],
  familyId: string,
): readonly CandidateSpacePoint[] {
  for (const point of points) {
    if (!space.contains(point)) {
      throw new CandidateSpaceError(
        `family ${familyId} produced a point outside space ${space.spaceId}`,
        candidatePointViolations(point, space.config),
      );
    }
  }
  return points;
}

/**
 * Family 1 — the MANDATORY generalist single-agent baseline (contract
 * §Required baselines; architecture §5 "a generalist single-agent
 * organization is always a baseline").
 */
export function generalistBaselineFamily(): CandidateFamily {
  return {
    familyId: "generalist-baseline",
    description:
      "The mandatory generalist single-agent baseline: one body, one stage, " +
      "the most generous latency budget in the grid.",
    points(space: OrganizationCandidateSpace): readonly CandidateSpacePoint[] {
      return requireInSpace(space, [space.generalistBaselinePoint()], this.familyId);
    },
  };
}

/**
 * Family 2 — a hand-designed pipeline organization: perception -> fusion ->
 * render with full-chain delegation, adjacent communication, hybrid memory,
 * role-partitioned capabilities and per-role models, sequential stages.
 */
export function handDesignedPipelineFamily(): CandidateFamily {
  return {
    familyId: "hand-designed-pipeline",
    description:
      "A hand-designed three-specialist pipeline (perception -> fusion -> render) " +
      "with full-chain delegation and sequential stages.",
    points(space: OrganizationCandidateSpace): readonly CandidateSpacePoint[] {
      const latencyBudgetMs = Math.max(...space.config.latencyBudgetsMs);
      const bodyCount = Math.min(3, space.config.maxBodyCount);
      const depth = Math.min(bodyCount - 1, space.config.maxDelegationDepth);
      const point = freezePoint({
        bodyCount,
        roleMix: "specialist-roles",
        topology: "pipeline",
        delegationDepth: depth,
        communication: "adjacent",
        memoryPolicy: "hybrid",
        capabilityAssignment: "partitioned-by-role",
        modelAssignment: "per-role-specialist",
        computeBudgetSplit: "even",
        latencyBudgetMs,
        executionOrder: "sequential-stages",
        stoppingConditions: ["max-ticks", "budget-exhausted"],
      });
      return requireInSpace(space, [point], this.familyId);
    },
  };
}

/**
 * Family 3 — parameterized variants: body count x delegation depth x budget
 * split, everything else fixed — the §5 dimensions a planner sweeps first.
 */
export function parameterizedVariantsFamily(): CandidateFamily {
  return {
    familyId: "parameterized-variants",
    description:
      "Parameterized variants over body count, delegation depth, and compute " +
      "budget split (specialist pipeline shape, shared memory, per-role models).",
    points(space: OrganizationCandidateSpace): readonly CandidateSpacePoint[] {
      const latencyBudgetMs = pickLatencyBudget(space.config.latencyBudgetsMs, 1);
      const bodyCounts = [2, 3].filter((n) => n <= space.config.maxBodyCount);
      const depths = [0, 1].filter((d) => d <= space.config.maxDelegationDepth);
      const splits: readonly ComputeBudgetSplitKind[] = ["even", "weighted-head"];
      const points: CandidateSpacePoint[] = [];
      for (const bodyCount of bodyCounts) {
        for (const delegationDepth of depths) {
          if (delegationDepth > bodyCount - 1) continue;
          for (const computeBudgetSplit of splits) {
            points.push(
              freezePoint({
                bodyCount,
                roleMix: "specialist-roles",
                topology: "pipeline",
                delegationDepth,
                communication: "adjacent",
                memoryPolicy: "shared",
                capabilityAssignment: "partitioned-by-role",
                modelAssignment: "per-role-specialist",
                computeBudgetSplit,
                latencyBudgetMs,
                executionOrder: "sequential-stages",
                stoppingConditions: ["max-ticks"],
              }),
            );
          }
        }
      }
      if (points.length === 0) {
        throw new LabValidationError(
          `family parameterized-variants cannot produce points inside space ${space.spaceId} ` +
            "(maxBodyCount/maxDelegationDepth too small)",
          [],
        );
      }
      return requireInSpace(space, points, this.familyId);
    },
  };
}

/** All three fixture families at once (the §Required baselines comparison set). */
export function fixtureCandidateFamilies(): readonly CandidateFamily[] {
  return [generalistBaselineFamily(), handDesignedPipelineFamily(), parameterizedVariantsFamily()];
}
