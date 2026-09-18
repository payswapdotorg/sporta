/**
 * The report-shape and determinism tests: the clean baseline PASSes, the
 * report carries the documented shape (validated against its own zod
 * schema), the accounting always reconciles, and the same input produces
 * byte-identical reports (in-process ×2; cross-subprocess is pinned by
 * test/subprocess.test.ts).
 */
import { describe, expect, test } from "bun:test";
import {
  evaluateReleaseReadiness,
  parseDemoRecord,
  ReleaseReadinessReportSchema,
  REPORT_SCHEMA_TAG,
  GATE_POLICY_VERSION,
} from "../src/index";
import type { ReleaseReadinessReport } from "../src/index";

describe("the clean baseline", () => {
  test("PASS with every gate green and the accounting reconciled", () => {
    const report = evaluateReleaseReadiness({ humanRecord: parseDemoRecord() });
    expect(report.verdict.outcome).toBe("PASS");
    expect(report.gates.every((g) => g.status === "PASS")).toBe(true);
    expect(report.accounting.reconciles).toBe(true);
    expect(report.accounting.gateCount).toBe(4);
    expect(report.accounting.passCount).toBe(4);
  }, 120_000);
});

describe("the report shape", () => {
  const report: ReleaseReadinessReport = evaluateReleaseReadiness({
    humanRecord: parseDemoRecord(),
  });

  test("carries the versioned schema tag and policy version", () => {
    expect(report.schemaTag).toBe(REPORT_SCHEMA_TAG);
    expect(report.policyVersion).toBe(GATE_POLICY_VERSION);
  }, 120_000);

  test("validates against its own zod schema", () => {
    expect(() => ReleaseReadinessReportSchema.parse(report)).not.toThrow();
  }, 120_000);

  test("the gate rows carry their source packages and measured summaries", () => {
    expect(report.gates.map((g) => g.id)).toEqual([
      "temporal-stability",
      "scene-correctness",
      "visual-correctness",
      "human-review",
    ]);
    const temporal = report.gates[0]!;
    expect(temporal.source).toBe("@sporta/renderer-evaluation");
    expect(temporal.summary.checkCount).toBeGreaterThan(0);
    const scene = report.gates[1]!;
    expect(scene.source).toBe("@sporta/scene-evaluation");
    expect(scene.summary.matchCheckCount).toBeGreaterThan(0);
    expect(scene.summary.directedCheckCount).toBeGreaterThan(0);
  }, 120_000);

  test("the accounting reconciles exactly (never silent)", () => {
    const a = report.accounting;
    expect(a.gateCount).toBe(
      a.passCount + a.failCount + a.notRunnableCount + a.pendingHumanReviewCount,
    );
  }, 120_000);

  test("the blocking gates are recorded behind the verdict", () => {
    expect(report.verdict.blockingGates).toEqual([
      "temporal-stability",
      "scene-correctness",
      "visual-correctness",
      "human-review",
    ]);
  }, 120_000);
});

describe("determinism", () => {
  test("two evaluations of the same input are byte-identical", () => {
    const a = JSON.stringify(evaluateReleaseReadiness({ humanRecord: parseDemoRecord() }));
    const b = JSON.stringify(evaluateReleaseReadiness({ humanRecord: parseDemoRecord() }));
    expect(a).toBe(b);
  }, 120_000);

  test("the pending path is deterministic too", () => {
    const a = JSON.stringify(evaluateReleaseReadiness({}));
    const b = JSON.stringify(evaluateReleaseReadiness({}));
    expect(a).toBe(b);
    expect(JSON.parse(a!).verdict.outcome).toBe("PENDING-HUMAN-REVIEW");
  }, 120_000);
});
