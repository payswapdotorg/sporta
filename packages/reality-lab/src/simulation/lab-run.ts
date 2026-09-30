/**
 * The Lab Run (REL-002): an IMMUTABLE run record + the deterministic
 * replay API.
 *
 * THE DETERMINISM CONTRACT: the same (seed, configuration, organization
 * definition, fault schedule, evaluator) ⇒ deep-equal run record — with
 * wall-clock/duration fields stripped, because determinism is a property
 * of the RECORD, not of the machine. `runLab` twice on the same inputs and
 * `deterministicLabRun` both records ⇒ deep-equal (the test suite pins
 * this, byte-level, via JSON serialization). Every stochastic input flows
 * from the seed through `LabRng` forks; the ONLY wall-clock values in the
 * record live in `execution` (started/duration/invocation metadata), which
 * `deterministicLabRun` strips.
 *
 * THE PROVENANCE CONTRACT: the record's provenance is
 * `lab-simulation` — lab world state is NEVER production truth (ADR-013
 * §8). The organization's emitted domain records (claims) are derived from
 * ACTIONS; model/runtime bindings ride `execution.modelInvocations` as
 * execution metadata and can never appear inside a domain record.
 *
 * THE LOOP: receive tick observations (evidence set grows) → execute the
 * organization's nodes in the deterministic execution-order walk → each
 * body invocation goes through the provider-neutral Model Runtime seam →
 * outputs are schema-validated → actions are recorded and claims are
 * hard-gate-checked AT EMISSION TIME (a claim citing evidence the org has
 * not received yet is a fabrication, lookahead included) → budgets are
 * enforced per node → termination conditions stop the loop → the evaluator
 * scores the run and returns typed refusals for any hard-gate violation.
 */
import { contentHash, contentId } from "../hash";
import { LabNotFoundError } from "../errors";
import { LAB_SIMULATION_PROVENANCE } from "../provenance";
import type { FaultSchedule } from "../robustness/faults";
import type {
  HardInvalidityContext,
  HardInvalidityViolation,
  LabClaim,
} from "../domain/domain-pack";
import type { FootballDomainPack } from "../domain/football";
import { checkFootballClaims } from "../domain/football";
import type { FootballScenarioRecord } from "../domain/scenario";
import type { AgentBodyDefinition, LabBodyAction, LabBodyInput, LabBodyOutput } from "../body/body";
import { validateAgentBody } from "../body/body";
import type { ModelInvocationRecord, ModelRuntime } from "../body/model-runtime";
import {
  executionOrderWalk,
  validateOrganization,
  type AgentOrganizationDefinition,
} from "../body/organization";
import {
  createFootballLabEvaluator,
  type LabEvaluator,
  type LabEvaluatorResult,
} from "../evaluation/evaluator";
import { createFootballWorldSimulator, type SimulatedTick } from "./world-simulator";

// ---------------------------------------------------------------------------
// The runtime bundle handed to the runner
// ---------------------------------------------------------------------------

/** An organization definition + the bodies + the runtimes that inhabit them. */
export interface OrganizationRuntimeBundle {
  definition: AgentOrganizationDefinition;
  bodies: readonly AgentBodyDefinition[];
  /** Model runtimes by runtimeId (the seam — never a provider SDK import). */
  runtimes: ReadonlyMap<string, ModelRuntime>;
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** One recorded organization action (execution-truth, no model bindings). */
export interface RecordedAction {
  actionId: string;
  claimId: string | null;
  nodeId: string;
  bodyId: string;
  tickIndex: number;
  clockMs: number;
  artifactRef: string;
  /** Simulated latency from the runtime's usage table (never wall time). */
  simulatedLatencyMs: number;
}

/** A typed degradation record — schema/action failures and budget stops. */
export interface DegradationRecord {
  code:
    | "input-schema-violation"
    | "output-schema-violation"
    | "action-not-allowed"
    | "budget-exhausted";
  nodeId: string;
  tickIndex: number;
  detail: string;
}

/** Wall-clock + invocation metadata — the ONLY non-deterministic section. */
export interface LabExecutionMetadata {
  startedAtEpochMs: number;
  durationMs: number;
  note: string;
  modelInvocations: readonly ModelInvocationRecord[];
}

/** The run's metrics: the evaluator result + budget/fault/degradation evidence. */
export interface LabRunMetrics extends LabEvaluatorResult {
  budgetUsage: {
    perNode: readonly {
      nodeId: string;
      calls: number;
      costUsd: number;
      maxCallsPerRun: number;
      maxCostUsdPerRun: number;
    }[];
    total: { calls: number; costUsd: number; maxCallsPerRun: number; maxCostUsdPerRun: number };
  };
  faultSummary: {
    faultTicks: number;
    distinctFaultKinds: readonly string[];
    scheduleId: string | null;
  };
  degradations: readonly DegradationRecord[];
}

/** The immutable lab run record (REL-A2's reproduction unit). */
export interface LabRunRecord {
  schemaVersion: "lab-run/0.1";
  runId: string;
  scenario: FootballScenarioRecord;
  seeds: {
    master: string;
    streams: { simulator: string; organization: string };
  };
  organization: {
    organizationId: string;
    version: number;
    nodes: readonly {
      nodeId: string;
      bodyRef: { bodyId: string; version: string };
      binding: { modelId: string; modelVersion: string; runtimeId: string; runtimeVersion: string };
      stageId: string;
    }[];
    bodies: readonly { bodyId: string; version: string }[];
  };
  evaluator: { evaluatorId: string; version: string };
  faultSchedule: FaultSchedule | null;
  claims: readonly LabClaim[];
  actions: readonly RecordedAction[];
  metrics: LabRunMetrics;
  /** The full recorded trajectory (replayable through the pack's replay adapter). */
  trajectory: { ticks: readonly SimulatedTick[] };
  /** Content hash of the trajectory — cheap reproducibility comparison. */
  trajectoryHash: string;
  provenance: {
    provenanceClass: typeof LAB_SIMULATION_PROVENANCE;
    lineage: readonly string[];
    note: string;
  };
  execution: LabExecutionMetadata;
}

/** The record with wall-clock/duration execution metadata stripped. */
export type DeterministicLabRun = Omit<LabRunRecord, "execution">;

/**
 * Strip the execution section (wall-clock start, duration, invocation
 * metadata). Two runs' deterministic views are deep-equal iff the runs
 * reproduced — determinism is a property of the record.
 */
export function deterministicLabRun(record: LabRunRecord): DeterministicLabRun {
  const { execution, ...rest } = record;
  // (execution is intentionally dropped — `void` marks it read, not unused.)
  void execution;
  return rest;
}

// ---------------------------------------------------------------------------
// Options + claim derivation
// ---------------------------------------------------------------------------

export interface LabRunOptions {
  domainPack: FootballDomainPack;
  organization: OrganizationRuntimeBundle;
  scenario: FootballScenarioRecord;
  faultSchedule?: FaultSchedule;
  evaluator?: LabEvaluator;
}

function isMaxTicks(condition: {
  kind: string;
}): condition is { kind: "max-ticks"; maxTicks: number } {
  return condition.kind === "max-ticks";
}

/** Derive the domain claim from an action (the runner's single source of truth). */
function claimFromAction(action: LabBodyAction, runId: string): LabClaim | null {
  if (action.actionId === "escalate-uncertainty") return null; // no domain claim
  const provenance = action.provenanceClass ?? LAB_SIMULATION_PROVENANCE;
  if (action.actionId === "emit-canonical-event") {
    return {
      claimKind: "canonical-event",
      claimId: action.claimId,
      eventKindId: action.eventKindId,
      clockMs: action.clockMs,
      evidenceRefs: [action.evidenceRef],
      provenanceClass: provenance,
    };
  }
  if (action.actionId === "emit-identity-assertion") {
    return {
      claimKind: "identity-assertion",
      claimId: action.claimId,
      entityId: action.entityId,
      presentedAs: action.presentedAs,
      basis: action.basis,
      evidenceRefs: [action.evidenceRef],
      provenanceClass: provenance,
    };
  }
  if (action.actionId === "request-render") {
    return {
      claimKind: "output-claim",
      claimId: action.claimId,
      renderTargetId: action.renderTargetId,
      rightsBasis: action.rightsBasis,
      artifactLineage: action.artifactLineage ?? [runId],
      clockMs: action.clockMs,
      provenanceClass: provenance,
    };
  }
  return null; // unreachable after the discriminated union is exhausted
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/**
 * Run one lab run: simulate the scenario, execute the organization through
 * the model-runtime seam, hard-gate every emitted claim, score the run.
 * Deterministic from (scenario seed, config, definition, schedule).
 */
export function runLab(options: LabRunOptions): LabRunRecord {
  const { domainPack, scenario } = options;
  const evaluator = options.evaluator ?? createFootballLabEvaluator();
  const bundle = options.organization;
  const definition = bundle.definition;

  // Defensive contract validation (typed, collective).
  validateOrganization(definition, { bodies: bundle.bodies });
  for (const body of bundle.bodies) validateAgentBody(body);
  for (const node of definition.nodes) {
    if (!bundle.runtimes.has(node.binding.runtimeId)) {
      throw new LabNotFoundError(
        `runtime ${node.binding.runtimeId} (node ${node.nodeId}) is not provided`,
        { nodeId: node.nodeId, runtimeId: node.binding.runtimeId },
      );
    }
  }

  const runId = contentId({
    kind: "lab-run/0.1",
    seed: scenario.seed,
    scenarioId: scenario.scenarioId,
    organizationId: definition.organizationId,
    organizationVersion: definition.version,
    evaluatorId: evaluator.evaluatorId,
    evaluatorVersion: evaluator.version,
    scheduleId: options.faultSchedule?.scheduleId ?? null,
  });

  const startedAtEpochMs = Date.now();
  const simulator = createFootballWorldSimulator({
    scenario,
    faultSchedule: options.faultSchedule,
  });
  const executionOrder = executionOrderWalk(definition);
  const nodesById = new Map(definition.nodes.map((node) => [node.nodeId, node]));
  const bodiesByRef = new Map(
    bundle.bodies.map((body) => [`${body.bodyId}@${body.version}`, body]),
  );
  const budgetUse = new Map<string, { calls: number; costUsd: number }>(
    definition.nodes.map((node) => [node.nodeId, { calls: 0, costUsd: 0 }]),
  );
  const budgetMax = new Map(definition.budgets.perNode.map((b) => [b.nodeId, b]));
  const exhaustedNodes = new Set<string>();

  const sharedMemory: Record<string, unknown> = {};
  const claims: LabClaim[] = [];
  const actions: RecordedAction[] = [];
  const invocationRecords: ModelInvocationRecord[] = [];
  const violations: HardInvalidityViolation[] = [];
  const degradations: DegradationRecord[] = [];
  const knownEvidenceRefs = new Set<string>();
  const renderTargetIds = domainPack.renderTargets.map((target) => target.targetId);
  const maxTicksCondition = definition.termination.conditions.find(isMaxTicks);
  const budgetExhaustionStops = definition.termination.conditions.some(
    (condition) => condition.kind === "budget-exhausted",
  );

  let knownEntityIds: string[] = [];
  let eventRecordObservationCount = 0;
  let ticksWithEventRecords = 0;
  let ticksWithEventRecordsAndAction = 0;
  let faultTicks = 0;
  let faultTicksWithAction = 0;
  let simulatedCostUsd = 0;
  let invocationCount = 0;
  let latencySum = 0;
  let artifactSeq = 0;
  const ticks: SimulatedTick[] = [];

  const hardGateContext = (): HardInvalidityContext => ({
    runId,
    knownEvidenceRefs,
    renderTargetIds,
    scenarioDurationMs: scenario.config.matchDurationMs,
  });

  runLoop: for (const tick of simulator.steps()) {
    ticks.push(tick);
    if (knownEntityIds.length === 0) {
      knownEntityIds = [...tick.groundTruth.players.map((player) => player.playerId), "ball"];
    }
    let tickHasEventRecord = false;
    for (const observation of tick.observations) {
      knownEvidenceRefs.add(observation.observationId);
      if (observation.kindId === "event-record") {
        tickHasEventRecord = true;
        eventRecordObservationCount += 1;
      }
    }
    if (tickHasEventRecord) ticksWithEventRecords += 1;
    if (tick.appliedFaults.length > 0) faultTicks += 1;
    let tickActed = false;

    for (const nodeId of executionOrder) {
      const node = nodesById.get(nodeId);
      if (node === undefined) continue;
      const body = bodiesByRef.get(`${node.bodyRef.bodyId}@${node.bodyRef.version}`);
      if (body === undefined) continue; // validateOrganization already refused this
      const use = budgetUse.get(nodeId);
      const max = budgetMax.get(nodeId);
      if (use === undefined || max === undefined) continue;
      if (
        !exhaustedNodes.has(nodeId) &&
        (use.calls >= max.maxCallsPerRun || use.costUsd >= max.maxCostUsdPerRun)
      ) {
        exhaustedNodes.add(nodeId);
        degradations.push({
          code: "budget-exhausted",
          nodeId,
          tickIndex: tick.tickIndex,
          detail: `node budget exhausted after ${use.calls} calls / $${use.costUsd}`,
        });
      }
      if (exhaustedNodes.has(nodeId)) continue;

      const runtime = bundle.runtimes.get(node.binding.runtimeId);
      if (runtime === undefined) continue;
      const input: LabBodyInput = {
        runId,
        tickIndex: tick.tickIndex,
        clockMs: tick.clockMs,
        period: tick.period,
        observations: [...tick.observations],
        sharedMemory: { ...sharedMemory },
      };
      const inputParsed = body.inputSchema.safeParse(input);
      if (!inputParsed.success) {
        degradations.push({
          code: "input-schema-violation",
          nodeId,
          tickIndex: tick.tickIndex,
          detail: `body ${body.bodyId} input failed its own input schema`,
        });
        continue;
      }
      const result = runtime.invoke({
        binding: node.binding,
        bodyRef: node.bodyRef,
        input,
        context: { runId, tickIndex: tick.tickIndex, clockMs: tick.clockMs, nodeId },
      });
      use.calls += result.usage.calls;
      use.costUsd += result.usage.costUsd;
      simulatedCostUsd += result.usage.costUsd;
      invocationCount += 1;
      invocationRecords.push({
        invocationSeq: invocationRecords.length + 1,
        nodeId,
        bodyId: node.bodyRef.bodyId,
        bodyVersion: node.bodyRef.version,
        binding: node.binding,
        inputArtifactRef: `artifact-input:${contentId(input)}`,
        outputArtifactRef: `artifact-output:${contentId(result.output)}`,
        usage: result.usage,
      });

      const outputParsed = body.outputSchema.safeParse(result.output);
      if (!outputParsed.success) {
        degradations.push({
          code: "output-schema-violation",
          nodeId,
          tickIndex: tick.tickIndex,
          detail: `body ${body.bodyId} output failed its own output schema`,
        });
        continue;
      }
      const output = result.output as LabBodyOutput;
      for (const action of output.actions) {
        if (!body.actionInterface.allowedActionIds.includes(action.actionId)) {
          degradations.push({
            code: "action-not-allowed",
            nodeId,
            tickIndex: tick.tickIndex,
            detail: `action ${action.actionId} is not in body ${body.bodyId}'s action interface`,
          });
          continue;
        }
        artifactSeq += 1;
        const claim = claimFromAction(action, runId);
        actions.push({
          actionId: action.actionId,
          claimId: claim?.claimId ?? null,
          nodeId,
          bodyId: node.bodyRef.bodyId,
          tickIndex: tick.tickIndex,
          clockMs: tick.clockMs,
          artifactRef: `artifact:${runId}:${artifactSeq}`,
          simulatedLatencyMs: result.usage.simulatedLatencyMs,
        });
        tickActed = true;
        latencySum += result.usage.simulatedLatencyMs;
        if (claim !== null) {
          claims.push(claim);
          // Hard gates AT EMISSION TIME (lookahead is not received evidence).
          for (const rule of domainPack.hardInvalidityRules) {
            const violation = rule.check(claim, hardGateContext());
            if (violation !== null) violations.push(violation);
          }
        }
      }
      if (
        output.sharedMemoryWrite !== undefined &&
        (node.memoryPolicy.sharedStoreAccess === "write" ||
          node.memoryPolicy.sharedStoreAccess === "read-write")
      ) {
        Object.assign(sharedMemory, output.sharedMemoryWrite);
      }
    }

    if (tickHasEventRecord && tickActed) ticksWithEventRecordsAndAction += 1;
    if (tick.appliedFaults.length > 0 && tickActed) faultTicksWithAction += 1;

    // Termination conditions (deterministic).
    if (maxTicksCondition !== undefined && tick.tickIndex + 1 >= maxTicksCondition.maxTicks) {
      break runLoop;
    }
    if (
      budgetExhaustionStops &&
      definition.nodes.length > 0 &&
      definition.nodes.every((node) => exhaustedNodes.has(node.nodeId))
    ) {
      break runLoop;
    }
  }

  const latencyHardMs = Math.min(
    ...definition.nodes.map((node) => {
      const body = bodiesByRef.get(`${node.bodyRef.bodyId}@${node.bodyRef.version}`);
      return body?.latencyLimits.hardMs ?? Number.POSITIVE_INFINITY;
    }),
  );
  const evaluation = evaluator.evaluate({
    runId,
    tickCount: ticks.length,
    knownEvidenceRefs: [...knownEvidenceRefs],
    eventRecordObservationCount,
    ticksWithEventRecords,
    ticksWithEventRecordsAndAction,
    canonicalEventClaims: claims.filter((claim) => claim.claimKind === "canonical-event"),
    identityClaims: claims.filter((claim) => claim.claimKind === "identity-assertion"),
    knownEntityIds,
    actionCount: actions.length,
    simulatedLatencyMsMean: actions.length > 0 ? latencySum / actions.length : null,
    simulatedCostUsd,
    invocationCount,
    budgetMaxCalls: definition.budgets.total.maxCallsPerRun,
    budgetMaxCostUsd: definition.budgets.total.maxCostUsdPerRun,
    latencyHardMs: Number.isFinite(latencyHardMs) ? latencyHardMs : 1_000,
    faultTicks,
    faultTicksWithAction,
    violations,
  });

  const distinctFaultKinds = [
    ...new Set(ticks.flatMap((tick) => tick.appliedFaults.map((fault) => fault.faultKind))),
  ].sort();
  const durationMs = Date.now() - startedAtEpochMs;

  const record: LabRunRecord = {
    schemaVersion: "lab-run/0.1",
    runId,
    scenario,
    seeds: {
      master: scenario.seed,
      streams: {
        simulator: `${scenario.seed}::simulator`,
        organization: `${scenario.seed}::organization`,
      },
    },
    organization: {
      organizationId: definition.organizationId,
      version: definition.version,
      nodes: definition.nodes.map((node) => ({
        nodeId: node.nodeId,
        bodyRef: { ...node.bodyRef },
        binding: { ...node.binding },
        stageId: node.stageId,
      })),
      bodies: bundle.bodies.map((body) => ({ bodyId: body.bodyId, version: body.version })),
    },
    evaluator: { evaluatorId: evaluator.evaluatorId, version: evaluator.version },
    faultSchedule: options.faultSchedule ?? null,
    claims,
    actions,
    metrics: {
      ...evaluation,
      budgetUsage: {
        perNode: definition.nodes.map((node) => {
          const use = budgetUse.get(node.nodeId) ?? { calls: 0, costUsd: 0 };
          const max = budgetMax.get(node.nodeId) ?? { maxCallsPerRun: 0, maxCostUsdPerRun: 0 };
          return {
            nodeId: node.nodeId,
            calls: use.calls,
            costUsd: use.costUsd,
            maxCallsPerRun: max.maxCallsPerRun,
            maxCostUsdPerRun: max.maxCostUsdPerRun,
          };
        }),
        total: {
          calls: invocationCount,
          costUsd: simulatedCostUsd,
          maxCallsPerRun: definition.budgets.total.maxCallsPerRun,
          maxCostUsdPerRun: definition.budgets.total.maxCostUsdPerRun,
        },
      },
      faultSummary: {
        faultTicks,
        distinctFaultKinds,
        scheduleId: options.faultSchedule?.scheduleId ?? null,
      },
      degradations,
    },
    trajectory: { ticks },
    trajectoryHash: "",
    provenance: {
      provenanceClass: LAB_SIMULATION_PROVENANCE,
      lineage: [runId],
      note:
        "lab-simulation world state — never production truth (ADR-013 §8); " +
        "the lab-to-production boundary is the organization registry's promotion gates",
    },
    execution: {
      startedAtEpochMs,
      durationMs,
      note:
        "wall-clock execution metadata — stripped by deterministicLabRun; " +
        "model bindings are execution metadata, never domain truth",
      modelInvocations: invocationRecords,
    },
  };
  record.trajectoryHash = contentHash(record.trajectory);
  return record;
}

/**
 * Replay a lab run's observation stream through the domain pack's replay
 * adapter (REL-002's replay seam): a replay re-presents the RECORDED
 * evidence — it never re-simulates the world.
 */
export function replayLabRun(
  domainPack: FootballDomainPack,
  record: LabRunRecord | DeterministicLabRun,
) {
  const observations = record.trajectory.ticks.flatMap((tick) => [...tick.observations]);
  return domainPack.replayAdapter.replay(observations);
}

/**
 * Determinism self-check helper (used by tests and the ensemble): re-run
 * the same inputs and compare deterministic views for deep equality.
 */
export function assertLabRunReproduces(options: LabRunOptions): {
  reproduced: boolean;
  first: DeterministicLabRun;
  second: DeterministicLabRun;
} {
  const first = deterministicLabRun(runLab(options));
  const second = deterministicLabRun(runLab(options));
  return { reproduced: JSON.stringify(first) === JSON.stringify(second), first, second };
}

// Re-export the football claims checker for callers that want direct rule
// access over constructed claims (the hard-gate tests use it).
export { checkFootballClaims };
