/**
 * The provider-neutral Model Runtime seam (REL-004) + ONE deterministic
 * scripted model implementation.
 *
 * THE SEAM (docs/contracts/agent-body-and-organization.md §Model
 * independence): a body must work through this seam; NO body (and no lab
 * code) may import a provider SDK as domain code. A binding
 * (model + runtime identity) is EXECUTION METADATA, never domain truth —
 * it rides the run record's execution section and the invocation log as
 * observability, and it can NEVER appear inside a domain record (claims,
 * events, observations) — the lab-run loop structurally enforces this: the
 * runner derives claims from ACTIONS, and actions carry no binding.
 *
 * THE SCRIPTED MODEL: deterministic by construction — the handler is a
 * pure function of (input, context), cost and latency are SIMULATED
 * constants from a usage table (a scripted runtime models provider
 * behavior; it never measures wall time — measured wall latency lives only
 * in the run record's execution section). A scripted model is for tests
 * and baselines; real provider runtimes attach through the same seam in
 * later slices.
 */
import { contentId } from "../hash";
import type { LabBodyInput, LabBodyOutput } from "./body";
import { LabBodyOutputSchema } from "./body";

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** Which model inhabits which runtime — execution metadata, never domain truth. */
export interface ModelRuntimeBinding {
  modelId: string;
  modelVersion: string;
  runtimeId: string;
  runtimeVersion: string;
}

export interface ModelInvocationRequest {
  binding: ModelRuntimeBinding;
  bodyRef: { bodyId: string; version: string };
  input: unknown;
  context: { runId: string; tickIndex: number; clockMs: number; nodeId?: string };
}

/**
 * Simulated usage per invocation. `simulated: true` is a HONESTY MARKER: a
 * scripted runtime's cost/latency are modeled constants, not measurements.
 */
export interface ModelUsage {
  calls: number;
  costUsd: number;
  simulatedLatencyMs: number;
  simulated: true;
}

export interface ModelInvocationResult {
  output: unknown;
  usage: ModelUsage;
  binding: ModelRuntimeBinding;
}

/**
 * One recorded invocation — observability per the contract's §Observability
 * (artifact IDs, never payloads: sensitive prompts are not persisted into
 * ordinary domain records).
 */
export interface ModelInvocationRecord {
  invocationSeq: number;
  nodeId: string;
  bodyId: string;
  bodyVersion: string;
  binding: ModelRuntimeBinding;
  inputArtifactRef: string;
  outputArtifactRef: string;
  usage: ModelUsage;
}

/** The provider-neutral model runtime seam. */
export interface ModelRuntime {
  readonly runtimeId: string;
  readonly runtimeVersion: string;
  invoke(request: ModelInvocationRequest): ModelInvocationResult;
  /** The deterministic invocation log (execution metadata). */
  readonly invocationLog: readonly ModelInvocationRecord[];
}

// ---------------------------------------------------------------------------
// The scripted implementation
// ---------------------------------------------------------------------------

export type ScriptedModelHandler = (
  input: LabBodyInput,
  context: { runId: string; tickIndex: number; clockMs: number },
) => LabBodyOutput;

export interface ScriptedModelRuntimeOptions {
  modelId: string;
  modelVersion: string;
  runtimeId?: string;
  handler: ScriptedModelHandler;
  /** Simulated per-call cost (default 0.001). */
  perCallCostUsd?: number;
  /** Simulated per-call latency in ms (default 120). */
  perCallSimulatedLatencyMs?: number;
}

/**
 * A deterministic scripted model runtime: the handler is pure, the usage is
 * a modeled constant per call, and every invocation is logged with
 * content-derived artifact refs (never payloads).
 */
export function createScriptedModelRuntime(options: ScriptedModelRuntimeOptions): ModelRuntime {
  const runtimeId = options.runtimeId ?? `scripted:${options.modelId}`;
  const perCallCostUsd = options.perCallCostUsd ?? 0.001;
  const perCallLatencyMs = options.perCallSimulatedLatencyMs ?? 120;
  const invocationLog: ModelInvocationRecord[] = [];

  return {
    runtimeId,
    runtimeVersion: "0.1.0",
    invocationLog,
    invoke(request: ModelInvocationRequest): ModelInvocationResult {
      const parsedInput = request.input as LabBodyInput;
      const output = options.handler(parsedInput, request.context);
      const usage: ModelUsage = {
        calls: 1,
        costUsd: perCallCostUsd,
        simulatedLatencyMs: perCallLatencyMs,
        simulated: true,
      };
      invocationLog.push({
        invocationSeq: invocationLog.length + 1,
        nodeId: request.context.nodeId ?? "unknown-node",
        bodyId: request.bodyRef.bodyId,
        bodyVersion: request.bodyRef.version,
        binding: request.binding,
        inputArtifactRef: `artifact-input:${contentId(request.input)}`,
        outputArtifactRef: `artifact-output:${contentId(output)}`,
        usage,
      });
      return { output, usage, binding: request.binding };
    },
  };
}

// ---------------------------------------------------------------------------
// The generalist scripted policy — the baseline's brain
// ---------------------------------------------------------------------------

/**
 * The generalist model's deterministic policy. HONESTY RULES IT FOLLOWS:
 * - it emits canonical events ONLY for event records it actually received
 *   (evidence-backed — never fabricates);
 * - it asserts identities only from received tracking samples, always as
 *   INFERENCES (never launders inference into fact);
 * - it requests exactly one render, with a declared lab-only rights basis
 *   and lineage rooted at the run;
 * - it escalates uncertainty when a broadcast frame is dropped.
 */
export function generalistScriptedHandler(input: LabBodyInput): LabBodyOutput {
  const actions: LabBodyOutput["actions"] = [];
  for (const observation of input.observations) {
    if (observation.kindId === "event-record") {
      const payload = eventRecordPayload(observation.payload);
      if (payload !== null) {
        actions.push({
          actionId: "emit-canonical-event",
          claimId: `claim-evt-${payload.eventId}`,
          eventKindId: payload.eventKindId,
          evidenceRef: observation.observationId,
          clockMs: observation.clockMs,
        });
      }
    }
    if (observation.kindId === "tracking-sample") {
      const payload = trackingPayload(observation.payload);
      if (payload !== null) {
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
      const payload = broadcastPayload(observation.payload);
      if (payload?.dropped) {
        actions.push({
          actionId: "escalate-uncertainty",
          note: `broadcast frame dropped at tick ${observation.tickIndex}`,
          clockMs: observation.clockMs,
        });
      }
    }
  }
  // One render decision per run: at tick 10, request the tactical target.
  if (input.tickIndex === 10) {
    actions.push({
      actionId: "request-render",
      claimId: "claim-render-tactical",
      renderTargetId: "tactical",
      rightsBasis: "lab-simulation-only",
      clockMs: input.clockMs,
    });
  }
  return {
    actions,
    sharedMemoryWrite: {
      lastSeenClockMs: input.clockMs,
      eventCountSeen: input.observations.filter((o) => o.kindId === "event-record").length,
    },
  };
}

function eventRecordPayload(payload: unknown): { eventId: string; eventKindId: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as { eventId?: unknown; eventKindId?: unknown };
  if (typeof record.eventId === "string" && typeof record.eventKindId === "string") {
    return { eventId: record.eventId, eventKindId: record.eventKindId };
  }
  return null;
}

function trackingPayload(payload: unknown): { playerId: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as { playerId?: unknown };
  return typeof record.playerId === "string" ? { playerId: record.playerId } : null;
}

function broadcastPayload(payload: unknown): { dropped: boolean } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as { dropped?: unknown };
  return typeof record.dropped === "boolean" ? { dropped: record.dropped } : null;
}

/**
 * Convenience: the scripted runtime for the generalist baseline, with the
 * generalist policy bound. The binding this creates is what the lab run
 * records as execution metadata.
 */
export function createGeneralistScriptedRuntime(): ModelRuntime {
  return createScriptedModelRuntime({
    modelId: "generalist-scripted-policy",
    modelVersion: "0.1.0",
    handler: generalistScriptedHandler,
    perCallCostUsd: 0.001,
    perCallSimulatedLatencyMs: 120,
  });
}

/** Re-exported for callers that want to re-validate scripted outputs. */
export { LabBodyOutputSchema };
