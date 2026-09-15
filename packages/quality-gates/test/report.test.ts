/**
 * The release report tests: determinism (byte-identical, twice in one
 * process — same input object AND two fresh builds through the real
 * fixture pipelines), the verdict matrix (PASS / PENDING-HUMAN-REVIEW /
 * FAIL with every documented routing), the report-level invariants (the
 * accounting table always reconciles; the gate rows are exactly the
 * policy's gates in policy order), and the fail-closed release-input
 * validation.
 */
import { describe, expect, test } from "bun:test";
import { injectGeometryTeleport, renderW503CleanFixture } from "@sporta/renderer-evaluation";
import { QualityGateError } from "../src/errors";
import { GATE_POLICY } from "../src/policy";
import { evaluateReleaseReadiness, serializeReleaseReport } from "../src/report";
import type { ReleaseReadinessInput } from "../src/report";
import { buildDemoReleaseInput } from "../src/release";
import { demoInput, incompleteDemoRecord, loadDemoRecord, rejectingDemoRecord } from "./helpers";

/** The verdict-invariant helper: the accounting table must always reconcile. */
function expectReconciled(report: ReturnType<typeof evaluateReleaseReadiness>): void {
  expect(report.accounting.totalGates).toBe(report.gates.length);
  expect(report.accounting.totalGates).toBe(
    report.accounting.passCount + report.accounting.failCount + report.accounting.notRunnableCount,
  );
  expect(report.accounting.totalGates).toBe(GATE_POLICY.gates.length);
  expect(report.gates.map((row) => row.gateId)).toEqual(
    GATE_POLICY.gates.map((entry) => entry.gateId),
  );
}

describe("determinism — the same input yields byte-identical reports", () => {
  test("two evaluations of the same input object are byte-identical", () => {
    const input = demoInput();
    const first = serializeReleaseReport(evaluateReleaseReadiness(input));
    const second = serializeReleaseReport(evaluateReleaseReadiness(input));
    expect(first).toBe(second);
  });

  test("two FRESH builds through the real fixture pipelines are byte-identical", () => {
    const first = serializeReleaseReport(
      evaluateReleaseReadiness(buildDemoReleaseInput(loadDemoRecord())),
    );
    const second = serializeReleaseReport(
      evaluateReleaseReadiness(buildDemoReleaseInput(loadDemoRecord())),
    );
    expect(first).toBe(second);
  });

  test("the reports are deep-equal and the serialization is canonical (sorted keys, trailing newline)", () => {
    const first = evaluateReleaseReadiness(buildDemoReleaseInput(loadDemoRecord()));
    const second = evaluateReleaseReadiness(buildDemoReleaseInput(loadDemoRecord()));
    expect(first).toEqual(second);
    const serialized = serializeReleaseReport(first);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized.includes("\n\n")).toBe(false);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.keys(parsed).slice().sort()).toEqual(Object.keys(parsed));
  });

  test("a different input yields a different report (the determinism is not a constant)", () => {
    const base = serializeReleaseReport(evaluateReleaseReadiness(demoInput()));
    const withoutRecord = serializeReleaseReport(
      evaluateReleaseReadiness({ ...demoInput(), humanReview: undefined }),
    );
    expect(base).not.toBe(withoutRecord);
  });
});

describe("the verdict matrix", () => {
  test("PASS: every blocking gate passes and the human record is complete", () => {
    const report = evaluateReleaseReadiness(demoInput());
    expect(report.verdict.outcome).toBe("PASS");
    expect(report.verdict.reason).toContain("every blocking gate passed");
    expectReconciled(report);
  });

  test("PENDING-HUMAN-REVIEW: the record is absent (machine gates green)", () => {
    const report = evaluateReleaseReadiness({ ...demoInput(), humanReview: undefined });
    expect(report.verdict.outcome).toBe("PENDING-HUMAN-REVIEW");
    expect(report.verdict.reason).toContain("human review required");
    expect(report.humanReview.recordStatus).toBe("absent");
    expect(report.humanReview.problems).toEqual(["no human review record supplied"]);
    expect(report.gates.find((row) => row.gateId === "human-quality-checks")!.verdict).toBe(
      "NOT-RUNNABLE",
    );
    expectReconciled(report);
    expect(report.accounting).toEqual({
      totalGates: 4,
      passCount: 3,
      failCount: 0,
      notRunnableCount: 1,
    });
  });

  test("PENDING-HUMAN-REVIEW: the record is malformed", () => {
    const report = evaluateReleaseReadiness({ ...demoInput(), humanReview: { nope: true } });
    expect(report.verdict.outcome).toBe("PENDING-HUMAN-REVIEW");
    expect(report.humanReview.recordStatus).toBe("malformed");
    expect(report.humanReview.problems[0]).toContain("malformed");
  });

  test("PENDING-HUMAN-REVIEW: the record is incomplete (missing item accounted)", () => {
    const report = evaluateReleaseReadiness({
      ...demoInput(),
      humanReview: incompleteDemoRecord(),
    });
    expect(report.verdict.outcome).toBe("PENDING-HUMAN-REVIEW");
    expect(report.humanReview.recordStatus).toBe("incomplete");
    expect(report.humanReview.problems[0]).toContain("release-signoff");
    // The incomplete record is echoed verbatim — its content is shown,
    // not hidden.
    expect(report.humanReview.record!.recordId).toBe("w803-fixture-demo-self-check");
  });

  test("FAIL: a completed record that rejects the release (explicit checklist fail)", () => {
    const report = evaluateReleaseReadiness({ ...demoInput(), humanReview: rejectingDemoRecord() });
    expect(report.verdict.outcome).toBe("FAIL");
    expect(report.verdict.reason).toContain("human review rejected");
    expect(report.verdict.reason).toContain("release-signoff");
    expect(report.humanReview.recordStatus).toBe("present-complete");
    expect(report.gates.find((row) => row.gateId === "human-quality-checks")!.verdict).toBe("FAIL");
    expectReconciled(report);
  });

  test("FAIL dominates PENDING: a machine failure with a missing record is FAIL, not PENDING", () => {
    const base = demoInput();
    const report = evaluateReleaseReadiness({
      temporal: { evaluations: [{ name: "w503-clean-clip", input: undefined }] },
      scene: base.scene,
      humanReview: undefined,
    });
    expect(report.verdict.outcome).toBe("FAIL");
    expect(report.verdict.reason).toContain("temporal-stability=NOT-RUNNABLE");
    expect(report.humanReview.recordStatus).toBe("absent");
    expectReconciled(report);
  });
});

describe("fail-closed release-input validation (malformed containers throw)", () => {
  /** Asserts that evaluating `input` throws with the code and path. */
  function expectMalformed(input: unknown, path: string, fragment: string): void {
    try {
      evaluateReleaseReadiness(input);
      throw new Error("expected evaluateReleaseReadiness to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(QualityGateError);
      const qualityGateError = error as QualityGateError;
      expect(qualityGateError.code).toBe("release-input-malformed");
      expect(qualityGateError.path).toBe(path);
      expect(qualityGateError.reason).toContain(fragment);
    }
  }

  test("rejects a non-object input", () => {
    expectMalformed(42, "$", "must be an object");
  });

  test("rejects an unknown root key", () => {
    expectMalformed({ ...demoInput(), latency: {} }, "$.latency", "unknown key");
  });

  test("rejects a missing temporal section", () => {
    const { scene, humanReview } = demoInput();
    expectMalformed({ scene, humanReview }, "$.temporal", "required");
  });

  test("rejects a missing scene section", () => {
    const { temporal, humanReview } = demoInput();
    expectMalformed({ temporal, humanReview }, "$.scene", "required");
  });

  test("rejects a non-array evaluations list", () => {
    expectMalformed(
      { ...demoInput(), temporal: { evaluations: "the clip" } },
      "$.temporal.evaluations",
      "must be an array",
    );
  });

  test("rejects a case object with an unknown key", () => {
    const input = demoInput();
    expectMalformed(
      { ...input, temporal: { evaluations: [{ ...input.temporal.evaluations[0]!, weight: 2 }] } },
      "$.temporal.evaluations[0]",
      "key set",
    );
  });

  test("rejects an empty fixture name", () => {
    expectMalformed(
      { ...demoInput(), temporal: { evaluations: [{ name: "", input: undefined }] } },
      "$.temporal.evaluations[0].name",
      "non-empty",
    );
  });

  test("rejects a duplicate fixture name (accounting ambiguity)", () => {
    const input = demoInput();
    const duplicated: ReleaseReadinessInput = {
      ...input,
      temporal: {
        evaluations: [...input.temporal.evaluations, input.temporal.evaluations[0]!],
      },
    };
    expectMalformed(duplicated, "$.temporal.evaluations[1].name", "duplicate fixture name");
  });

  test("an EMPTY evaluations list is not a throw — it is an accounted not-runnable gate", () => {
    const report = evaluateReleaseReadiness({
      temporal: { evaluations: [] },
      scene: demoInput().scene,
      humanReview: loadDemoRecord(),
    });
    const temporalRow = report.gates.find((row) => row.gateId === "temporal-stability")!;
    expect(temporalRow.verdict).toBe("NOT-RUNNABLE");
    expect(temporalRow.reason).toContain("no fixture evaluations supplied");
    expect(report.verdict.outcome).toBe("FAIL");
    expectReconciled(report);
  });
});

describe("report-level invariants on every path", () => {
  /** Inputs exercising every verdict and accounting bucket. */
  const inputs: readonly unknown[] = [
    demoInput(),
    { ...demoInput(), humanReview: undefined },
    { ...demoInput(), humanReview: incompleteDemoRecord() },
    { ...demoInput(), humanReview: rejectingDemoRecord() },
    { ...demoInput(), temporal: { evaluations: [{ name: "x", input: undefined }] } },
    {
      ...demoInput(),
      scene: { evaluations: [{ name: "x", input: { snapshots: "garbage" } }] },
    },
  ];

  test("the accounting table reconciles and rows equal the policy gates on every path", () => {
    for (const input of inputs) {
      const report = evaluateReleaseReadiness(input);
      expectReconciled(report);
      for (const row of report.gates) {
        const policyEntry = GATE_POLICY.gates.find((entry) => entry.gateId === row.gateId)!;
        expect(row.sourcePackage).toBe(policyEntry.sourcePackage);
        expect(row.blocking).toBe(policyEntry.blocking);
        expect(row.notRunnableOutcome).toBe(policyEntry.notRunnableOutcome);
      }
    }
  });
});

describe("advisory gates are real policy data (never silent, never blocking)", () => {
  test("a failing ADVISORY temporal gate does not block the release — but is accounted in the reason", () => {
    const base = demoInput();
    const clean = renderW503CleanFixture();
    const perturbedManifest = injectGeometryTeleport(clean.manifest, {
      frameIndex: 2,
      entityId: "player-7",
      toMeters: { x: 90, y: 34 },
    });
    const advisoryPolicy = {
      ...GATE_POLICY,
      version: "test-advisory-policy@1",
      gates: GATE_POLICY.gates.map((entry) =>
        entry.gateId === "temporal-stability" ? { ...entry, blocking: false } : entry,
      ),
    };
    const report = evaluateReleaseReadiness(
      {
        temporal: {
          evaluations: [
            {
              name: "w503-clean-clip",
              input: { manifest: perturbedManifest, frames: clean.frames },
            },
          ],
        },
        scene: base.scene,
        humanReview: loadDemoRecord(),
      },
      advisoryPolicy,
    );
    const temporalRow = report.gates.find((row) => row.gateId === "temporal-stability")!;
    expect(temporalRow.verdict).toBe("FAIL");
    expect(temporalRow.blocking).toBe(false);
    expect(report.policy.advisoryGateCount).toBe(1);
    expect(report.verdict.outcome).toBe("PASS");
    expect(report.verdict.reason).toContain("advisory gate(s) reported without release effect");
    expect(report.verdict.reason).toContain("temporal-stability=FAIL");
    expectReconciled(report);
  });
});
