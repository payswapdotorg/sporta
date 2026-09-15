/**
 * The release report pins (deliverable 2): the verdict composition matrix
 * (PASS / PENDING-HUMAN-REVIEW / FAIL, exactly as GATES.md §2 documents),
 * the accounting totality (counts reconcile exactly, and the ledger's
 * teeth bite on hand-built inconsistent ledgers), the data-driven
 * blocking semantics (the same defective input FAILs under the canonical
 * policy and passes with the defect accounted as ADVISORY under a policy
 * that demotes that gate — blocking is data, not ifs), the byte
 * determinism (twice in one process), and the fail-loud input envelope.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { injectUnexplainedAbsence, renderW503CleanFixture } from "@sporta/renderer-evaluation";
import { buildCorrectionsMatchFixture, injectWrongScoreClaim } from "@sporta/scene-evaluation";
import {
  GATE_POLICY,
  QualityGateError,
  RELEASE_REPORT_SCHEMA_TAG,
  SCENE_FIXTURE_IDS,
  TEMPORAL_FIXTURE_ID,
  buildCanonicalReleaseInput,
  canonicalReportBytes,
  evaluateReleaseReadiness,
  reconcileGateLedger,
  type GatePolicyDocument,
  type GateRow,
  type ReleaseEvaluationInput,
} from "../src/index";

const RECORD: unknown = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "fixtures", "human-review-self-check.json"), "utf8"),
);

const CANONICAL: ReleaseEvaluationInput = buildCanonicalReleaseInput(RECORD);

/** The gate row of one gate id (fail-loud when absent). */
function rowOf(gateId: string, report: ReturnType<typeof evaluateReleaseReadiness>): GateRow {
  const row = report.gates.find((candidate) => candidate.gateId === gateId);
  expect(row, `no report row for gate ${gateId}`).toBeDefined();
  return row!;
}

/** The canonical input with the temporal output defect-injected through the real seam. */
function temporalDefectInput(): ReleaseEvaluationInput {
  const output = renderW503CleanFixture();
  const perturbed = injectUnexplainedAbsence(output.manifest, {
    frameIndex: 2,
    entityId: "player-7",
  });
  return {
    temporal: { fixture: TEMPORAL_FIXTURE_ID, output: { ...output, manifest: perturbed } },
    scene: CANONICAL.scene,
    humanReview: RECORD,
  };
}

/** The canonical input with one scene fixture defect-injected the way the scene package's own tests do. */
function sceneDefectInput(): ReleaseEvaluationInput {
  const corrections = buildCorrectionsMatchFixture();
  return {
    temporal: CANONICAL.temporal,
    scene: [
      ...CANONICAL.scene!.filter((run) => run.fixture !== SCENE_FIXTURE_IDS.correctionsMatch),
      {
        fixture: SCENE_FIXTURE_IDS.correctionsMatch,
        input: injectWrongScoreClaim(corrections, { frameIndex: 35 }),
      },
    ],
    humanReview: RECORD,
  };
}

/** The canonical input with the human review record overridden. */
function withRecord(humanReview: unknown): ReleaseEvaluationInput {
  return { temporal: CANONICAL.temporal, scene: CANONICAL.scene, humanReview };
}

describe("the canonical fixture run — the full green report", () => {
  const report = evaluateReleaseReadiness(CANONICAL);

  test("the report's identity and policy echo", () => {
    expect(report.schemaTag).toBe(RELEASE_REPORT_SCHEMA_TAG);
    expect(report.policyId).toBe(GATE_POLICY.policyId);
    expect(report.policyId).toBe("w803-gate-policy@1");
  });

  test("one row per policy gate, in policy order, policy fields carried verbatim", () => {
    expect(report.gates).toHaveLength(4);
    expect(report.gates.map((row) => row.gateId)).toEqual(
      GATE_POLICY.gates.map((entry) => entry.gateId),
    );
    for (const row of report.gates) {
      const entry = GATE_POLICY.gates.find((candidate) => candidate.gateId === row.gateId)!;
      expect(row.name).toBe(entry.name);
      expect(row.sourcePackage).toBe(entry.sourcePackage);
      expect(row.role).toBe(entry.role);
      expect(row.blocking).toBe(entry.blocking);
    }
  });

  test("every gate passes and the overall verdict is PASS (machine gates + complete record)", () => {
    expect(report.verdict).toBe("PASS");
    expect(report.gates.every((row) => row.verdict === "PASS")).toBe(true);
    expect(report.gates.every((row) => row.reason === null)).toBe(true);
  });

  test("the accounting table reconciles exactly: gates = pass + fail + not-runnable", () => {
    expect(report.accounting.totalGates).toBe(4);
    expect(report.accounting.rowCount).toBe(4);
    expect(report.accounting.counts).toEqual({ pass: 4, fail: 0, notRunnable: 0 });
    expect(
      report.accounting.totalGates ===
        report.accounting.counts.pass +
          report.accounting.counts.fail +
          report.accounting.counts.notRunnable,
    ).toBe(true);
    expect(report.accounting.reconciles).toBe(true);
    expect(report.accounting.gateVerdict).toBe("PASS");
    for (const check of report.accounting.checks) {
      expect(check.pass).toBe(true);
    }
  });

  test("the human-review section echoes the self-check record verbatim", () => {
    expect(report.humanReview.gateVerdict).toBe("PASS");
    expect(report.humanReview.recordKind).toBe("automated-pipeline-self-check");
    expect(report.humanReview.reviewer?.name).toBe("sporta quality-gates pipeline");
    expect(report.humanReview.results).toHaveLength(4);
  });
});

describe("the verdict composition matrix (GATES.md §2, the normative rule)", () => {
  test("a temporal defect injected through the real injector seam → overall FAIL", () => {
    const report = evaluateReleaseReadiness(temporalDefectInput());
    expect(report.verdict).toBe("FAIL");
    expect(rowOf("temporal-stability", report).verdict).toBe("FAIL");
  });

  test("a scene defect injected the way the scene package's own tests inject → overall FAIL", () => {
    const report = evaluateReleaseReadiness(sceneDefectInput());
    expect(report.verdict).toBe("FAIL");
    expect(rowOf("scene-correctness", report).verdict).toBe("FAIL");
  });

  test("the human record removed → PENDING-HUMAN-REVIEW (machine gates still pass)", () => {
    const report = evaluateReleaseReadiness({
      temporal: CANONICAL.temporal,
      scene: CANONICAL.scene,
    });
    expect(report.verdict).toBe("PENDING-HUMAN-REVIEW");
    expect(rowOf("temporal-stability", report).verdict).toBe("PASS");
    expect(rowOf("scene-correctness", report).verdict).toBe("PASS");
    expect(rowOf("human-quality-checks", report).verdict).toBe("FAIL");
    expect(rowOf("human-quality-checks", report).reason?.code).toBe("record-missing");
    // The ledger still reconciles: the human failure is an accounted row.
    expect(report.accounting.counts).toEqual({ pass: 3, fail: 1, notRunnable: 0 });
    expect(report.accounting.reconciles).toBe(true);
  });

  test("a malformed human record → PENDING-HUMAN-REVIEW", () => {
    const report = evaluateReleaseReadiness(withRecord({ nope: true }));
    expect(report.verdict).toBe("PENDING-HUMAN-REVIEW");
    expect(report.humanReview.failureClass).toBe("record-malformed");
  });

  test("an incomplete human record → PENDING-HUMAN-REVIEW", () => {
    const raw = JSON.parse(JSON.stringify(RECORD)) as { checklistResults: unknown[] };
    raw.checklistResults = raw.checklistResults.slice(0, 2);
    const report = evaluateReleaseReadiness(withRecord(raw));
    expect(report.verdict).toBe("PENDING-HUMAN-REVIEW");
    expect(report.humanReview.failureClass).toBe("record-incomplete");
    expect(report.humanReview.missingItems).toHaveLength(2);
  });

  test("machine gates failing AND the record missing → FAIL (the 'otherwise' rule)", () => {
    const report = evaluateReleaseReadiness({
      temporal: temporalDefectInput().temporal,
      scene: CANONICAL.scene,
    });
    expect(report.verdict).toBe("FAIL");
  });

  test("a completed record with failing checklist items → FAIL (a definitive human FAIL)", () => {
    const raw = JSON.parse(JSON.stringify(RECORD)) as {
      checklistResults: Array<{ itemId: string; result: string }>;
    };
    raw.checklistResults[3]!.result = "fail";
    const report = evaluateReleaseReadiness(withRecord(raw));
    expect(report.verdict).toBe("FAIL");
    expect(rowOf("human-quality-checks", report).reason?.code).toBe("checklist-item-failed");
  });

  test("a not-runnable gate (malformed fixture input) is counted FAIL with the reason, never skipped", () => {
    const report = evaluateReleaseReadiness({
      temporal: { fixture: "malformed", output: { manifest: { frames: [] }, frames: [] } },
      scene: CANONICAL.scene,
      humanReview: RECORD,
    });
    expect(report.verdict).toBe("FAIL");
    const row = rowOf("temporal-stability", report);
    expect(row.verdict).toBe("NOT_RUNNABLE");
    expect(row.reason?.code).toBe("evaluation-error");
    // Accounting totality: the not-runnable gate is counted, and the table still reconciles.
    expect(report.accounting.counts).toEqual({ pass: 3, fail: 0, notRunnable: 1 });
    expect(report.accounting.totalGates).toBe(4);
    expect(report.accounting.reconciles).toBe(true);
  });
});

describe("the blocking semantics are DATA (a demoted gate is advisory, not skipped)", () => {
  /** The canonical policy with one gate demoted to advisory. */
  function policyWithAdvisory(gateId: string): GatePolicyDocument {
    return {
      policyId: "test-advisory-policy@1",
      gates: GATE_POLICY.gates.map((entry) =>
        entry.gateId === gateId ? { ...entry, blocking: false } : entry,
      ),
    };
  }

  test("the same scene defect is FAIL under the canonical policy", () => {
    expect(evaluateReleaseReadiness(sceneDefectInput()).verdict).toBe("FAIL");
  });

  test("under a policy that demotes the scene gate, the defect is ADVISORY: reported, never blocking", () => {
    const report = evaluateReleaseReadiness(sceneDefectInput(), {
      policy: policyWithAdvisory("scene-correctness"),
    });
    expect(report.policyId).toBe("test-advisory-policy@1");
    expect(report.verdict).toBe("PASS");
    const row = rowOf("scene-correctness", report);
    expect(row.blocking).toBe(false);
    expect(row.verdict).toBe("FAIL");
    expect(row.reason?.code).toBe("checks-failed");
    // The advisory failure is fully accounted in the ledger (a FAIL bucket row).
    expect(report.accounting.counts).toEqual({ pass: 3, fail: 1, notRunnable: 0 });
    expect(report.accounting.reconciles).toBe(true);
  });

  test("under a policy that demotes the temporal gate, a not-runnable temporal gate stays advisory", () => {
    const report = evaluateReleaseReadiness(
      {
        temporal: { fixture: "malformed", output: { manifest: {}, frames: [] } },
        scene: CANONICAL.scene,
        humanReview: RECORD,
      },
      { policy: policyWithAdvisory("temporal-stability") },
    );
    expect(report.verdict).toBe("PASS");
    expect(rowOf("temporal-stability", report).verdict).toBe("NOT_RUNNABLE");
    expect(report.accounting.counts.notRunnable).toBe(1);
  });

  test("a custom policy naming an unknown gate fails closed: the gate is NOT_RUNNABLE (no-runner)", () => {
    const policy: GatePolicyDocument = {
      policyId: "test-unknown-gate-policy@1",
      gates: [
        ...GATE_POLICY.gates,
        {
          gateId: "mystery-gate",
          name: "Mystery gate",
          sourcePackage: "@sporta/quality-gates",
          role: "machine",
          blocking: true,
          description: "a custom policy gate with no runner",
          seams: [],
        },
      ],
    };
    const report = evaluateReleaseReadiness(CANONICAL, { policy });
    expect(report.verdict).toBe("FAIL");
    const row = rowOf("mystery-gate", report);
    expect(row.verdict).toBe("NOT_RUNNABLE");
    expect(row.reason?.code).toBe("no-runner");
    expect(report.accounting.totalGates).toBe(5);
    expect(report.accounting.counts).toEqual({ pass: 4, fail: 0, notRunnable: 1 });
    expect(report.accounting.reconciles).toBe(true);
  });
});

describe("the accounting gate's teeth (hand-built inconsistent ledgers)", () => {
  /** Builds a minimal row for the ledger tests. */
  function row(gateId: string, verdict: GateRow["verdict"]): GateRow {
    return {
      gateId,
      name: gateId,
      sourcePackage: "@sporta/quality-gates",
      role: "machine",
      blocking: true,
      verdict,
      reason: null,
    };
  }

  test("a vanished gate (a missing row) fails row-count AND gate-set", () => {
    const reconciliation = reconcileGateLedger(
      [row("temporal-stability", "PASS"), row("human-quality-checks", "PASS")],
      GATE_POLICY.gates,
    );
    expect(reconciliation.verdict).toBe("FAIL");
    const failing = reconciliation.checks
      .filter((check) => !check.pass)
      .map((check) => check.checkId);
    expect(failing).toContain("row-count");
    expect(failing).toContain("gate-set");
  });

  test("a duplicated gate row fails gate-set (an invented extra row)", () => {
    const reconciliation = reconcileGateLedger(
      [
        row("temporal-stability", "PASS"),
        row("temporal-stability", "PASS"),
        row("scene-correctness", "PASS"),
        row("human-quality-checks", "PASS"),
      ],
      GATE_POLICY.gates,
    );
    expect(reconciliation.verdict).toBe("FAIL");
    expect(reconciliation.checks.find((check) => check.checkId === "gate-set")?.pass).toBe(false);
  });

  test("a verdict outside the closed vocabulary fails verdict-vocabulary AND count-reconciliation", () => {
    const reconciliation = reconcileGateLedger(
      [
        row("temporal-stability", "PASS"),
        row("scene-correctness", "SKIPPED" as GateRow["verdict"]),
        row("human-quality-checks", "PASS"),
      ],
      GATE_POLICY.gates,
    );
    expect(reconciliation.verdict).toBe("FAIL");
    expect(
      reconciliation.checks.find((check) => check.checkId === "verdict-vocabulary")?.pass,
    ).toBe(false);
    expect(
      reconciliation.checks.find((check) => check.checkId === "count-reconciliation")?.pass,
    ).toBe(false);
  });

  test("the canonical subject rows reconcile (all four checks pass)", () => {
    const canonicalRows: GateRow[] = [
      row("temporal-stability", "PASS"),
      row("scene-correctness", "PASS"),
      row("human-quality-checks", "PASS"),
    ];
    const reconciliation = reconcileGateLedger(canonicalRows, GATE_POLICY.gates);
    expect(reconciliation.verdict).toBe("PASS");
    expect(reconciliation.subjectCounts).toEqual({ pass: 3, fail: 0, notRunnable: 0 });
    expect(reconciliation.checks.every((check) => check.pass)).toBe(true);
  });
});

describe("determinism — same input, byte-identical report (twice in one process)", () => {
  test("two evaluations of the same input serialize byte-identically", () => {
    const first = canonicalReportBytes(evaluateReleaseReadiness(CANONICAL));
    const second = canonicalReportBytes(evaluateReleaseReadiness(CANONICAL));
    expect(second).toBe(first);
  });

  test("two evaluations of FRESH input builds serialize byte-identically", () => {
    const first = canonicalReportBytes(evaluateReleaseReadiness(CANONICAL));
    const fresh = canonicalReportBytes(
      evaluateReleaseReadiness(buildCanonicalReleaseInput(RECORD)),
    );
    expect(fresh).toBe(first);
  });

  test("the canonical bytes contain no primitive arrays (the serialization is structurally uniform)", () => {
    const document = JSON.parse(canonicalReportBytes(evaluateReleaseReadiness(CANONICAL)));
    /** Walks the document; every array's elements must all be objects (or the array empty). */
    function assertNoPrimitiveArrays(value: unknown, path: string): void {
      if (Array.isArray(value)) {
        for (const element of value) {
          expect(
            typeof element === "object" && element !== null,
            `${path} contains a primitive array element (${typeof element})`,
          ).toBe(true);
        }
        value.forEach((element, index) => assertNoPrimitiveArrays(element, `${path}[${index}]`));
      } else if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          assertNoPrimitiveArrays(child, `${path}.${key}`);
        }
      }
    }
    assertNoPrimitiveArrays(document, "$");
  });
});

describe("the input envelope is validated fail-loud (never silently coerced)", () => {
  test("a non-object input throws input-malformed", () => {
    expect(() => evaluateReleaseReadiness("nope" as unknown as ReleaseEvaluationInput)).toThrow(
      QualityGateError,
    );
    try {
      evaluateReleaseReadiness("nope" as unknown as ReleaseEvaluationInput);
    } catch (error) {
      expect((error as QualityGateError).code).toBe("input-malformed");
    }
  });

  test("unknown input fields throw with their JSON path", () => {
    const input = { ...CANONICAL, mystery: 1 } as Record<string, unknown>;
    expect(() => evaluateReleaseReadiness(input as unknown as ReleaseEvaluationInput)).toThrow(
      QualityGateError,
    );
    try {
      evaluateReleaseReadiness(input as unknown as ReleaseEvaluationInput);
    } catch (error) {
      expect((error as QualityGateError).path).toBe("$.mystery");
    }
  });

  test("a wrong-shaped temporal entry throws with its JSON path", () => {
    expect(() =>
      evaluateReleaseReadiness({
        temporal: { fixture: "x", output: {}, extra: 1 },
        scene: CANONICAL.scene,
      } as unknown as ReleaseEvaluationInput),
    ).toThrow(QualityGateError);
    try {
      evaluateReleaseReadiness({
        temporal: { fixture: "x", output: {}, extra: 1 },
        scene: CANONICAL.scene,
      } as unknown as ReleaseEvaluationInput);
    } catch (error) {
      expect((error as QualityGateError).path).toBe("$.temporal");
    }
  });

  test("the scene run count bound throws input-malformed", () => {
    const runs = Array.from({ length: 9 }, (_, index) => ({
      fixture: `run-${index}`,
      input: CANONICAL.scene![0]!.input,
    }));
    expect(() =>
      evaluateReleaseReadiness({
        temporal: CANONICAL.temporal,
        scene: runs,
        humanReview: RECORD,
      }),
    ).toThrow(QualityGateError);
  });
});
