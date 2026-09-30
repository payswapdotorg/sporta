/**
 * LabRun tests (REL-002): the immutable record, the deterministic replay
 * API (run twice ⇒ deep-equal after stripping the wall-clock execution
 * section), divergence across seeds, budget enforcement, degradation
 * records, run-level hard gates (fabrication and provenance bypass produce
 * TYPED REFUSALS, not exceptions), and the replay adapter round trip.
 */
import { describe, expect, test } from "bun:test";
import {
  assertLabRunReproduces,
  createScriptedModelRuntime,
  createFootballLabEvaluator,
  deterministicLabRun,
  footballDomainPack,
  generateFootballScenario,
  replayLabRun,
  runLab,
  type LabBodyInput,
  type LabBodyOutput,
} from "../src";
import { SMALL_SCENARIO, generalistBundle } from "./fixtures";

describe("deterministic replay (the REL-002 core promise)", () => {
  test("runLab twice ⇒ deep-equal AND byte-equal deterministic views", () => {
    const { bundle } = generalistBundle();
    const scenario = generateFootballScenario("run-seed-1", SMALL_SCENARIO);
    const options = {
      domainPack: footballDomainPack,
      organization: bundle,
      scenario,
      evaluator: createFootballLabEvaluator(),
    };
    const first = deterministicLabRun(runLab(options));
    const second = deterministicLabRun(runLab(options));
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("deterministicLabRun strips exactly the execution section", () => {
    const { bundle } = generalistBundle();
    const record = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("run-seed-1", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(record.execution.startedAtEpochMs).toBeGreaterThan(0);
    const view = deterministicLabRun(record);
    expect("execution" in view).toBe(false);
    // Everything else survives verbatim.
    expect(view.runId).toBe(record.runId);
    expect(view.trajectoryHash).toBe(record.trajectoryHash);
    expect(view.metrics).toEqual(record.metrics);
  });

  test("different seed ⇒ different record and trajectory", () => {
    const { bundle } = generalistBundle();
    const a = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("run-seed-1", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    const b = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("run-seed-2", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(a.runId).not.toBe(b.runId);
    expect(a.trajectoryHash).not.toBe(b.trajectoryHash);
    expect(JSON.stringify(deterministicLabRun(a))).not.toBe(JSON.stringify(deterministicLabRun(b)));
  });

  test("assertLabRunReproduces confirms reproduction", () => {
    const { bundle } = generalistBundle();
    const result = assertLabRunReproduces({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("run-seed-1", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(result.reproduced).toBe(true);
  });

  test("the record's identity section is complete and deterministic", () => {
    const { bundle } = generalistBundle();
    const record = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("run-seed-1", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(record.schemaVersion).toBe("lab-run/0.1");
    expect(record.seeds.master).toBe("run-seed-1");
    expect(record.seeds.streams.simulator).toBe("run-seed-1::simulator");
    expect(record.organization.organizationId).toBe("org-generalist-baseline");
    expect(record.organization.version).toBe(1);
    expect(record.evaluator.evaluatorId).toBe("football-lab-evaluator");
    expect(record.provenance.provenanceClass).toBe("lab-simulation");
    expect(record.provenance.lineage).toEqual([record.runId]);
    // The runId is content-derived: same inputs reproduce it.
    const again = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("run-seed-1", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(again.runId).toBe(record.runId);
  });
});

describe("run-level hard gates are typed refusals, never exceptions", () => {
  function bundleWithHandler(handler: (input: LabBodyInput) => LabBodyOutput) {
    const { bundle, body } = generalistBundle();
    const runtime = createScriptedModelRuntime({
      modelId: "test-policy",
      modelVersion: "0.1.0",
      handler,
    });
    // Rebind the definition's nodes to the new runtime (the binding is the
    // node's execution metadata — the test swaps it like a real re-binding).
    const definition = {
      ...bundle.definition,
      nodes: bundle.definition.nodes.map((node) => ({
        ...node,
        binding: {
          ...node.binding,
          modelId: "test-policy",
          modelVersion: "0.1.0",
          runtimeId: runtime.runtimeId,
        },
      })),
    };
    return {
      bundle: {
        definition,
        bodies: bundle.bodies,
        runtimes: new Map([[runtime.runtimeId, runtime]]),
      },
      body,
    };
  }

  test("a fabricating body hard-invalidates the run (fabricated-canonical-event)", () => {
    const { bundle } = bundleWithHandler((input) => ({
      actions: [
        {
          actionId: "emit-canonical-event",
          claimId: "claim-fabricated",
          eventKindId: "goal",
          evidenceRef: "obs-bogus-never-received",
          clockMs: input.clockMs,
        },
      ],
    }));
    const record = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("fabricate-seed", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(record.metrics.valid).toBe(false);
    // The policy fabricates on EVERY tick — every tick's claim is refused.
    expect(record.metrics.violations.length).toBe(record.trajectory.ticks.length);
    expect(record.metrics.violations.every((v) => v.ruleId === "fabricated-canonical-event")).toBe(
      true,
    );
    expect(record.metrics.violations[0]?.claimId).toBe("claim-fabricated");
    // The refusals are recorded evidence on the run, not a thrown error —
    // the run completes and carries them.
    expect(record.claims.some((c) => c.claimId === "claim-fabricated")).toBe(true);
  });

  test("a provenance-laundering body hard-invalidates the run (provenance-bypass)", () => {
    const { bundle } = bundleWithHandler((input) => ({
      actions: [
        {
          actionId: "emit-canonical-event",
          claimId: "claim-laundered",
          eventKindId: "kickoff",
          evidenceRef: "obs-evt-ev-0-0", // the kickoff record (published at tick 2)
          clockMs: input.clockMs,
          provenanceClass: "real-observation" as const,
        },
      ],
    }));
    const record = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("launder-seed", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(record.metrics.valid).toBe(false);
    expect(record.metrics.violations.some((v) => v.ruleId === "provenance-bypass")).toBe(true);
  });
});

describe("budgets and degradations", () => {
  test("a per-node call budget stops invocations with a typed degradation", () => {
    const { bundle, body, definition } = generalistBundle();
    const capped = {
      ...definition,
      budgets: {
        perNode: [{ nodeId: "generalist", maxCallsPerRun: 5, maxCostUsdPerRun: 100 }],
        total: { maxCallsPerRun: 5, maxCostUsdPerRun: 100 },
      },
    };
    const record = runLab({
      domainPack: footballDomainPack,
      organization: { ...bundle, definition: capped },
      scenario: generateFootballScenario("budget-seed", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(record.metrics.budgetUsage.perNode[0]?.calls).toBe(5);
    expect(record.metrics.degradations.some((d) => d.code === "budget-exhausted")).toBe(true);
    // The budget-exhausted termination stopped the run before the full window.
    expect(record.metrics.budgetUsage.perNode[0]!.calls).toBeLessThanOrEqual(5);
    expect(body.budget.maxCallsPerRun).toBeGreaterThan(5); // the cap was the org's
  });

  test("an action outside the body's action interface is refused with a degradation", () => {
    const { bundle, body } = generalistBundle();
    const restricted = { ...body, actionInterface: { allowedActionIds: [] } };
    const runtime = createScriptedModelRuntime({
      modelId: "test-policy",
      modelVersion: "0.1.0",
      handler: (input) => ({
        actions: [
          {
            actionId: "emit-canonical-event",
            claimId: "claim-x",
            eventKindId: "kickoff",
            evidenceRef: "obs-evt-ev-0-0",
            clockMs: input.clockMs,
          },
        ],
      }),
    });
    const definition = {
      ...bundle.definition,
      nodes: bundle.definition.nodes.map((node) => ({
        ...node,
        binding: {
          ...node.binding,
          runtimeId: runtime.runtimeId,
          modelId: "test-policy",
          modelVersion: "0.1.0",
        },
      })),
    };
    const record = runLab({
      domainPack: footballDomainPack,
      organization: {
        definition,
        bodies: [restricted],
        runtimes: new Map([[runtime.runtimeId, runtime]]),
      },
      scenario: generateFootballScenario("restrict-seed", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(record.actions).toHaveLength(0);
    expect(record.metrics.degradations.some((d) => d.code === "action-not-allowed")).toBe(true);
  });

  test("a body whose input schema rejects the lab input records a degradation", () => {
    const { bundle, body } = generalistBundle();
    const picky = { ...body, inputSchema: body.outputSchema }; // wrong schema on purpose
    const runtime = createScriptedModelRuntime({
      modelId: "test-policy",
      modelVersion: "0.1.0",
      handler: () => ({ actions: [] }),
    });
    const definition = {
      ...bundle.definition,
      nodes: bundle.definition.nodes.map((node) => ({
        ...node,
        binding: {
          ...node.binding,
          runtimeId: runtime.runtimeId,
          modelId: "test-policy",
          modelVersion: "0.1.0",
        },
      })),
    };
    const record = runLab({
      domainPack: footballDomainPack,
      organization: {
        definition,
        bodies: [picky],
        runtimes: new Map([[runtime.runtimeId, runtime]]),
      },
      scenario: generateFootballScenario("picky-seed", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    expect(record.metrics.degradations.length).toBeGreaterThan(0);
    expect(record.metrics.degradations.some((d) => d.code === "input-schema-violation")).toBe(true);
  });

  test("a missing runtime is a typed not-found error at the boundary", () => {
    const { bundle } = generalistBundle();
    expect(() =>
      runLab({
        domainPack: footballDomainPack,
        organization: { ...bundle, runtimes: new Map() },
        scenario: generateFootballScenario("missing-seed", SMALL_SCENARIO),
        evaluator: createFootballLabEvaluator(),
      }),
    ).toThrow(/runtime .* is not provided/);
  });
});

describe("the replay adapter round trip", () => {
  test("replayLabRun returns the recorded observation stream, grouped by kind", () => {
    const { bundle } = generalistBundle();
    const record = runLab({
      domainPack: footballDomainPack,
      organization: bundle,
      scenario: generateFootballScenario("replay-run-seed", SMALL_SCENARIO),
      evaluator: createFootballLabEvaluator(),
    });
    const stream = replayLabRun(footballDomainPack, record);
    const total = record.trajectory.ticks.reduce((sum, tick) => sum + tick.observations.length, 0);
    expect(stream.observations).toHaveLength(total);
    const eventRecords = stream.byKind("event-record");
    expect(eventRecords.length).toBeGreaterThan(0);
    expect(eventRecords.every((o) => o.kindId === "event-record")).toBe(true);
  });
});
