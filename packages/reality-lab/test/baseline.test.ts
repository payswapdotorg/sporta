/**
 * The generalist baseline, end to end (REL-004's baseline seam): the
 * mandatory single-agent comparison point exists, validates, runs a full
 * lab run, and stays hard-gate clean — plus the scripted model runtime's
 * determinism and the BINDING LAW (bindings are execution metadata, never
 * domain truth).
 */
import { describe, expect, test } from "bun:test";
import {
  createFootballLabEvaluator,
  createScriptedModelRuntime,
  footballDomainPack,
  generateFootballScenario,
  runLab,
} from "../src";
import { SMALL_SCENARIO, generalistBundle } from "./fixtures";

describe("the mandatory generalist single-agent baseline", () => {
  test("is a valid organization (the comparison point exists)", () => {
    const { bundle, definition } = generalistBundle();
    expect(definition.organizationId).toBe("org-generalist-baseline");
    expect(bundle.bodies).toHaveLength(1);
    expect(bundle.runtimes.size).toBe(1);
  });

  test("runs a full lab run, hard-gate clean, with real metrics", () => {
    const { bundle } = generalistBundle();
    const record = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("baseline-seed", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    // The run is valid: no hard invalidity violations, no degradations.
    expect(record.metrics.valid).toBe(true);
    expect(record.metrics.violations).toEqual([]);
    expect(record.metrics.degradations).toEqual([]);
    // The baseline actually worked: events claimed with evidence,
    // identities asserted as inferences, one render requested.
    const canonical = record.claims.filter((c) => c.claimKind === "canonical-event");
    const identities = record.claims.filter((c) => c.claimKind === "identity-assertion");
    const renders = record.claims.filter((c) => c.claimKind === "output-claim");
    expect(canonical.length).toBeGreaterThan(0);
    expect(identities.length).toBeGreaterThan(0);
    expect(renders).toHaveLength(1);
    expect(record.metrics.overall).not.toBeNull();
    // One invocation per tick — the generalist acts on every tick.
    expect(record.metrics.budgetUsage.total.calls).toBe(record.trajectory.ticks.length);
  });
});

describe("the scripted model runtime", () => {
  test("is deterministic: same inputs, same outputs, same usage, same log", () => {
    const makeRuntime = () =>
      createScriptedModelRuntime({
        modelId: "echo-policy",
        modelVersion: "0.1.0",
        handler: (input) => ({ actions: [], sharedMemoryWrite: { seen: input.tickIndex } }),
      });
    const binding = {
      modelId: "echo-policy",
      modelVersion: "0.1.0",
      runtimeId: "scripted:echo-policy",
      runtimeVersion: "0.1.0",
    };
    const request = {
      binding,
      bodyRef: { bodyId: "generalist-1", version: "0.1.0" },
      input: {
        runId: "run-1",
        tickIndex: 3,
        clockMs: 300,
        period: 1 as const,
        observations: [],
        sharedMemory: {},
      },
      context: { runId: "run-1", tickIndex: 3, clockMs: 300, nodeId: "n1" },
    };
    const a = makeRuntime();
    const b = makeRuntime();
    const first = a.invoke(request);
    const second = b.invoke(request);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(a.invocationLog)).toBe(JSON.stringify(b.invocationLog));
  });

  test("usage is SIMULATED (modeled constants, honestly flagged)", () => {
    const runtime = createScriptedModelRuntime({
      modelId: "fixed-cost-policy",
      modelVersion: "0.1.0",
      handler: () => ({ actions: [] }),
      perCallCostUsd: 0.01,
      perCallSimulatedLatencyMs: 250,
    });
    const result = runtime.invoke({
      binding: {
        modelId: "fixed-cost-policy",
        modelVersion: "0.1.0",
        runtimeId: runtime.runtimeId,
        runtimeVersion: "0.1.0",
      },
      bodyRef: { bodyId: "b", version: "0.1.0" },
      input: {
        runId: "r",
        tickIndex: 0,
        clockMs: 0,
        period: 1,
        observations: [],
        sharedMemory: {},
      },
      context: { runId: "r", tickIndex: 0, clockMs: 0, nodeId: "n1" },
    });
    expect(result.usage.simulated).toBe(true);
    expect(result.usage.costUsd).toBe(0.01);
    expect(result.usage.simulatedLatencyMs).toBe(250);
    expect(result.usage.calls).toBe(1);
  });

  test("invocations log artifact refs (content ids), never payloads", () => {
    const runtime = createScriptedModelRuntime({
      modelId: "artifact-policy",
      modelVersion: "0.1.0",
      handler: () => ({ actions: [], sharedMemoryWrite: { secret: "sensitive-prompt" } }),
    });
    runtime.invoke({
      binding: {
        modelId: "artifact-policy",
        modelVersion: "0.1.0",
        runtimeId: runtime.runtimeId,
        runtimeVersion: "0.1.0",
      },
      bodyRef: { bodyId: "b", version: "0.1.0" },
      input: {
        runId: "r",
        tickIndex: 0,
        clockMs: 0,
        period: 1,
        observations: [],
        sharedMemory: {},
      },
      context: { runId: "r", tickIndex: 0, clockMs: 0, nodeId: "n1" },
    });
    const [record] = runtime.invocationLog;
    expect(record?.inputArtifactRef).toMatch(/^artifact-input:[0-9a-f]{16}$/);
    expect(record?.outputArtifactRef).toMatch(/^artifact-output:[0-9a-f]{16}$/);
    expect(JSON.stringify(runtime.invocationLog)).not.toContain("sensitive-prompt");
  });
});

describe("THE BINDING LAW: bindings are execution metadata, never domain truth", () => {
  test("the run record's domain sections carry NO model/runtime binding", () => {
    const { bundle } = generalistBundle();
    const record = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("binding-seed", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    // The binding IS recorded — as execution metadata.
    expect(record.execution.modelInvocations.length).toBeGreaterThan(0);
    expect(record.execution.modelInvocations[0]?.binding.modelId).toBe(
      "generalist-scripted-policy",
    );
    // And the binding NEVER appears in the domain records: claims, actions,
    // observations, events, world states.
    const domainSections = JSON.stringify({
      claims: record.claims,
      actions: record.actions,
      trajectory: record.trajectory.ticks.map((tick) => ({
        groundTruth: tick.groundTruth,
        events: tick.events,
        observations: tick.observations,
      })),
    });
    expect(domainSections).not.toContain("generalist-scripted-policy");
    expect(domainSections).not.toContain("scripted:generalist-scripted-policy");
    // The deterministic view keeps the domain + evidence and drops execution:
    // determinism comparisons never depend on the binding's invocation timing.
    const { execution, ...deterministic } = record;
    void execution;
    expect(JSON.stringify(deterministic)).not.toContain("artifact-input:");
  });
});
