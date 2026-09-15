/**
 * The W803 detection proof (the accept criterion's teeth, the W503/W605
 * `detection.test.ts` convention): every requirement of the work order is
 * PROVEN, not asserted in prose —
 *
 * - a temporal defect injected through W503's REAL injector seam → the
 *   temporal gate FAILs with the injected metric's measured value carried
 *   verbatim → the overall verdict FAILs;
 * - a scene defect injected exactly the way W605's own tests inject → the
 *   scene gate FAILs → the overall verdict FAILs;
 * - the human review record removed → `PENDING-HUMAN-REVIEW` (never PASS,
 *   never silently skipped);
 * - a gate made not-runnable (malformed fixture input / missing case
 *   input) → counted FAIL with the accounted reason, and the accounting
 *   table still reconciles (never-silent);
 * - accounting totality — `reconcileGateRows` bites on tampered row
 *   arrays (a silently vanished gate is itself a failure).
 */
import { describe, expect, test } from "bun:test";
import { injectGeometryTeleport, renderW503CleanFixture } from "@sporta/renderer-evaluation";
import { injectSceneStateDrift, injectWrongScoreClaim } from "@sporta/scene-evaluation";
import type { SceneEvaluationInput } from "@sporta/scene-evaluation";
import { GATE_POLICY } from "../src/policy";
import { buildAccountingRow, reconcileGateRows } from "../src/gates";
import type { ReleaseGateRow } from "../src/gates";
import { evaluateReleaseReadiness } from "../src/report";
import type { ReleaseReadinessInput } from "../src/report";
import { demoInput, loadDemoRecord } from "./helpers";

describe("a temporal defect injected through the REAL W503 injector seam", () => {
  test("the release verdict is FAIL with the defect measured and carried verbatim", () => {
    const base = demoInput();
    const clean = renderW503CleanFixture();
    const perturbedManifest = injectGeometryTeleport(clean.manifest, {
      frameIndex: 2,
      entityId: "player-7",
      toMeters: { x: 90, y: 34 },
    });
    const input: ReleaseReadinessInput = {
      temporal: {
        evaluations: [
          { name: "w503-clean-clip", input: { manifest: perturbedManifest, frames: clean.frames } },
        ],
      },
      scene: base.scene,
      humanReview: loadDemoRecord(),
    };
    const report = evaluateReleaseReadiness(input);
    expect(report.verdict.outcome).toBe("FAIL");
    expect(report.verdict.reason).toContain("temporal-stability=FAIL");
    // The scene and human gates are still green — the FAIL is the temporal
    // gate's, and the report says exactly so.
    expect(report.gates.find((row) => row.gateId === "scene-correctness")!.verdict).toBe("PASS");
    expect(report.gates.find((row) => row.gateId === "human-quality-checks")!.verdict).toBe("PASS");
    const temporalSub = report.gates.find((row) => row.gateId === "temporal-stability")!
      .evaluations[0]!;
    expect(temporalSub.verdict).toBe("FAIL");
    expect(temporalSub.failedCheckCount).toBe(2);
    const jumpCount = temporalSub.failingChecks.find(
      (check) => check.metric === "geometry.jumpCount",
    )!;
    expect(jumpCount.measured).toBe(2);
    expect(jumpCount.threshold).toBe(0);
    const carried = temporalSub.keyValues.find((entry) => entry.metric === "geometry.jumpCount");
    expect(carried!.value).toBe(2);
    expect(report.accounting).toEqual({
      totalGates: 4,
      passCount: 3,
      failCount: 1,
      notRunnableCount: 0,
    });
  });
});

describe("a scene defect injected the way W605's own tests inject", () => {
  test("injectWrongScoreClaim (the corrections fixture, frame 35) → FAIL", () => {
    const base = demoInput();
    const corrections = base.scene.evaluations[1]!.input as SceneEvaluationInput;
    const perturbed = injectWrongScoreClaim(corrections, { frameIndex: 35 });
    const report = evaluateReleaseReadiness({
      temporal: base.temporal,
      scene: {
        evaluations: [
          base.scene.evaluations[0]!,
          { name: "w605-corrections-match", input: perturbed },
          base.scene.evaluations[2]!,
        ],
      },
      humanReview: loadDemoRecord(),
    });
    expect(report.verdict.outcome).toBe("FAIL");
    expect(report.verdict.reason).toContain("scene-correctness=FAIL");
    const sceneRow = report.gates.find((row) => row.gateId === "scene-correctness")!;
    expect(sceneRow.verdict).toBe("FAIL");
    const correctionsSub = sceneRow.evaluations.find(
      (sub) => sub.fixtureName === "w605-corrections-match",
    )!;
    const failing = correctionsSub.failingChecks.map((check) => check.metric);
    expect(failing).toContain("score.frameClaimMismatchCount");
    expect(failing).toContain("clock.frameClaimMismatchCount");
    // The other two scene fixtures stay green — the defect is isolated and
    // accounted where it was injected.
    expect(
      sceneRow.evaluations.find((sub) => sub.fixtureName === "w605-clean-match")!.verdict,
    ).toBe("PASS");
  });

  test("injectSceneStateDrift (the corrections fixture, striker-9) → FAIL", () => {
    const base = demoInput();
    const corrections = base.scene.evaluations[1]!.input as SceneEvaluationInput;
    const perturbed = injectSceneStateDrift(corrections, {
      frameIndex: 20,
      entityId: "striker-9",
      dxMeters: 3,
    });
    const report = evaluateReleaseReadiness({
      temporal: base.temporal,
      scene: {
        evaluations: [
          base.scene.evaluations[0]!,
          { name: "w605-corrections-match", input: perturbed },
          base.scene.evaluations[2]!,
        ],
      },
      humanReview: loadDemoRecord(),
    });
    expect(report.verdict.outcome).toBe("FAIL");
    const correctionsSub = report.gates
      .find((row) => row.gateId === "scene-correctness")!
      .evaluations.find((sub) => sub.fixtureName === "w605-corrections-match")!;
    const failing = correctionsSub.failingChecks.map((check) => check.metric);
    expect(failing).toContain("sceneState.frameEntityStateMismatchCount");
    expect(failing).toContain("sceneState.positionMismatchCount");
  });
});

describe("the human review record removed → PENDING-HUMAN-REVIEW", () => {
  test("machine gates green, record absent: the release can never pass on unfinished review", () => {
    const base = demoInput();
    const report = evaluateReleaseReadiness({
      temporal: base.temporal,
      scene: base.scene,
      humanReview: undefined,
    });
    expect(report.verdict.outcome).toBe("PENDING-HUMAN-REVIEW");
    expect(report.verdict.reason).toContain("human review required");
    expect(report.verdict.reason).toContain("no human review record supplied");
    expect(report.gates.find((row) => row.gateId === "human-quality-checks")!.verdict).toBe(
      "NOT-RUNNABLE",
    );
    // The record never silently skipped anything: it is an accounted row.
    expect(report.accounting).toEqual({
      totalGates: 4,
      passCount: 3,
      failCount: 0,
      notRunnableCount: 1,
    });
  });
});

describe("a gate made not-runnable is counted FAIL, never skipped", () => {
  test("a malformed temporal fixture input (W503's validation rejects it)", () => {
    const base = demoInput();
    const report = evaluateReleaseReadiness({
      temporal: { evaluations: [{ name: "w503-broken-clip", input: { manifest: {} } }] },
      scene: base.scene,
      humanReview: loadDemoRecord(),
    });
    expect(report.verdict.outcome).toBe("FAIL");
    const temporalRow = report.gates.find((row) => row.gateId === "temporal-stability")!;
    expect(temporalRow.verdict).toBe("NOT-RUNNABLE");
    expect(temporalRow.reason).toContain("package error");
    expect(temporalRow.reason).toContain("w503-broken-clip");
    expect(report.accounting).toEqual({
      totalGates: 4,
      passCount: 3,
      failCount: 0,
      notRunnableCount: 1,
    });
    // gates = pass + fail + not-runnable, exactly.
    expect(report.accounting.totalGates).toBe(
      report.accounting.passCount +
        report.accounting.failCount +
        report.accounting.notRunnableCount,
    );
  });

  test("a malformed scene fixture input (W605's validation rejects it)", () => {
    const base = demoInput();
    const report = evaluateReleaseReadiness({
      temporal: base.temporal,
      scene: {
        evaluations: [
          base.scene.evaluations[0]!,
          { name: "w605-broken-match", input: { snapshots: [], steps: "garbage" } },
        ],
      },
      humanReview: loadDemoRecord(),
    });
    expect(report.verdict.outcome).toBe("FAIL");
    const sceneRow = report.gates.find((row) => row.gateId === "scene-correctness")!;
    expect(sceneRow.verdict).toBe("NOT-RUNNABLE");
    expect(sceneRow.reason).toContain("package error");
    expect(sceneRow.reason).toContain("w605-broken-match");
    expect(report.accounting.notRunnableCount).toBe(1);
  });

  test("a missing case input (the fixture's input never arrived)", () => {
    const base = demoInput();
    const report = evaluateReleaseReadiness({
      temporal: { evaluations: [{ name: "w503-clean-clip", input: undefined }] },
      scene: base.scene,
      humanReview: loadDemoRecord(),
    });
    expect(report.verdict.outcome).toBe("FAIL");
    expect(report.gates.find((row) => row.gateId === "temporal-stability")!.reason).toContain(
      "missing input",
    );
    expect(report.accounting.notRunnableCount).toBe(1);
  });
});

describe("accounting totality — the never-silent ledger bites", () => {
  /** The three evaluated rows of a healthy demo report. */
  function healthyRows(): ReleaseGateRow[] {
    const report = evaluateReleaseReadiness(demoInput());
    return report.gates.filter((row) => row.gateId !== "gate-accounting");
  }

  test("the healthy rows reconcile and the accounting row is PASS", () => {
    const rows = healthyRows();
    const reconciliation = reconcileGateRows(rows, GATE_POLICY);
    expect(reconciliation.pass).toBe(true);
    expect(reconciliation.problems).toEqual([]);
    const accountingRow = buildAccountingRow(reconciliation, rows, GATE_POLICY);
    expect(accountingRow.verdict).toBe("PASS");
    const carried = new Map(accountingRow.keyValues.map((entry) => [entry.metric, entry.value]));
    expect(carried.get("accounting.totalGates")).toBe(4);
    expect(carried.get("accounting.passCount")).toBe(4);
    expect(carried.get("accounting.failCount")).toBe(0);
    expect(carried.get("accounting.notRunnableCount")).toBe(0);
  });

  test("a silently VANISHED gate is itself a failure", () => {
    const rows = healthyRows().filter((row) => row.gateId !== "scene-correctness");
    const reconciliation = reconcileGateRows(rows, GATE_POLICY);
    expect(reconciliation.pass).toBe(false);
    expect(
      reconciliation.problems.some(
        (problem) => problem.includes("scene-correctness") && problem.includes("silently vanished"),
      ),
    ).toBe(true);
    expect(buildAccountingRow(reconciliation, rows, GATE_POLICY).verdict).toBe("FAIL");
  });

  test("an EXTRA gate row is a ledger violation too (count mismatch + duplicate)", () => {
    const rows = [...healthyRows(), healthyRows()[0]!];
    const reconciliation = reconcileGateRows(rows, GATE_POLICY);
    expect(reconciliation.pass).toBe(false);
    expect(
      reconciliation.problems.some((problem) =>
        problem.includes("gate row count 4 does not match the policy's 3"),
      ),
    ).toBe(true);
    expect(reconciliation.problems.some((problem) => problem.includes("duplicate gate row"))).toBe(
      true,
    );
  });

  test("a DUPLICATE gate row is a ledger violation", () => {
    const rows = healthyRows();
    const duplicated = [...rows.slice(0, 2), rows[1]!, rows[2]!];
    const reconciliation = reconcileGateRows(duplicated, GATE_POLICY);
    expect(reconciliation.pass).toBe(false);
    expect(reconciliation.problems.some((problem) => problem.includes("duplicate gate row"))).toBe(
      true,
    );
  });

  test("an unknown verdict value has no accounting bucket", () => {
    const rows = healthyRows();
    const tampered = rows.map((row) =>
      row.gateId === "temporal-stability" ? { ...row, verdict: "MAYBE" } : row,
    ) as ReleaseGateRow[];
    const reconciliation = reconcileGateRows(tampered, GATE_POLICY);
    expect(reconciliation.pass).toBe(false);
    expect(
      reconciliation.problems.some((problem) => problem.includes('unknown verdict "MAYBE"')),
    ).toBe(true);
  });

  test("a policy-unfaithful row (blocking flipped) is a ledger violation", () => {
    const rows = healthyRows();
    const tampered = rows.map((row) =>
      row.gateId === "temporal-stability" ? { ...row, blocking: false } : row,
    );
    const reconciliation = reconcileGateRows(tampered, GATE_POLICY);
    expect(reconciliation.pass).toBe(false);
    expect(
      reconciliation.problems.some((problem) => problem.includes("claims blocking false")),
    ).toBe(true);
  });
});
