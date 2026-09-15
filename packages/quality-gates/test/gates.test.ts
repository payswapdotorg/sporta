/**
 * The gate runner tests over the REAL fixtures: each machine gate runs
 * the source package's real evaluation and carries its values VERBATIM
 * (pinned against a source report recomputed in the test — property
 * reads, never recomputed), and every not-runnable path is an accounted
 * row, never a throw and never a silent skip.
 */
import { describe, expect, test } from "bun:test";
import { evaluateTemporalConsistency } from "@sporta/renderer-evaluation";
import type { TemporalEvaluationInput } from "@sporta/renderer-evaluation";
import { evaluateSceneOutput } from "@sporta/scene-evaluation";
import type { SceneEvaluationReport } from "@sporta/scene-evaluation";
import { injectGeometryTeleport, renderW503CleanFixture } from "@sporta/renderer-evaluation";
import { GATE_POLICY } from "../src/policy";
import { runSceneGate, runTemporalGate, runHumanReviewGate } from "../src/gates";
import { REPORT_SCHEMA_TAG, evaluateReleaseReadiness } from "../src/report";
import { buildDemoReleaseInput } from "../src/release";
import { demoInput, loadDemoRecord } from "./helpers";

describe("the temporal stability gate runs W503's real evaluation", () => {
  test("the clean fixture passes with the source report's own verdict and values verbatim", () => {
    const temporal = demoInput().temporal;
    const row = runTemporalGate(temporal, GATE_POLICY);
    expect(row.gateId).toBe("temporal-stability");
    expect(row.sourcePackage).toBe("@sporta/renderer-evaluation");
    expect(row.blocking).toBe(true);
    expect(row.verdict).toBe("PASS");
    expect(row.evaluations.length).toBe(1);
    const sub = row.evaluations[0]!;
    expect(sub.fixtureName).toBe("w503-clean-clip");
    expect(sub.reportSchemaTag).toBe("sporta/renderer-evaluation/w503@1");
    expect(sub.verdict).toBe("PASS");
    expect(sub.failingChecks).toEqual([]);
    // The carried values are the SOURCE report's own values — recomputed
    // here independently and compared one-for-one.
    const source = evaluateTemporalConsistency(temporal.evaluations[0]!.input!);
    expect(sub.checkCount).toBe(source.verdict.checks.length);
    expect(sub.checkCount).toBe(21);
    expect(sub.failedCheckCount).toBe(0);
    const carried = new Map(sub.keyValues.map((entry) => [entry.metric, entry.value]));
    expect(carried.get("identity.flickerCount")).toBe(source.identity.flickerCount);
    expect(carried.get("identity.flickerCount")).toBe(0);
    expect(carried.get("identity.styleStabilityRatio")).toBe(source.identity.styleStabilityRatio);
    expect(carried.get("geometry.jumpCount")).toBe(source.geometry.jumpCount);
    expect(carried.get("geometry.maxJumpRatio")).toBe(source.geometry.maxJumpRatio);
    expect(carried.get("styleBytes.stabilityRatio")).toBe(source.styleBytes!.stabilityRatio);
    expect(sub.evaluated!.sessionId).toBe("sess-anime-clip");
    expect(sub.evaluated!.frameCount).toBe(6);
    expect(sub.evaluated!.svgFramesMeasured).toBe(true);
  });

  test("the injected geometry teleport flips the gate to FAIL with the failing checks verbatim", () => {
    const clean = renderW503CleanFixture();
    const perturbed = injectGeometryTeleport(clean.manifest, {
      frameIndex: 2,
      entityId: "player-7",
      toMeters: { x: 90, y: 34 },
    });
    const row = runTemporalGate(
      {
        evaluations: [
          { name: "w503-clean-clip", input: { manifest: perturbed, frames: clean.frames } },
        ],
      },
      GATE_POLICY,
    );
    expect(row.verdict).toBe("FAIL");
    const sub = row.evaluations[0]!;
    expect(sub.verdict).toBe("FAIL");
    const failing = sub.failingChecks.map((check) => check.metric);
    expect(failing).toContain("geometry.jumpCount");
    expect(failing).toContain("geometry.maxJumpRatio");
    const jumpCount = sub.failingChecks.find((check) => check.metric === "geometry.jumpCount")!;
    expect(jumpCount.measured).toBe(2);
    expect(jumpCount.threshold).toBe(0);
    expect(jumpCount.pass).toBe(false);
    // The failing check's threshold IS W503's own pinned threshold — this
    // package defined none.
    const source = evaluateTemporalConsistency({
      manifest: perturbed,
      frames: clean.frames,
    });
    const sourceJump = source.verdict.failures.find((c) => c.metric === "geometry.jumpCount")!;
    expect(jumpCount.threshold).toBe(sourceJump.threshold);
    expect(jumpCount.measured).toBe(sourceJump.measured);
  });

  test("a missing case input is an accounted not-runnable sub-row", () => {
    const row = runTemporalGate(
      { evaluations: [{ name: "w503-clean-clip", input: undefined }] },
      GATE_POLICY,
    );
    expect(row.verdict).toBe("NOT-RUNNABLE");
    expect(row.reason).toContain("missing input");
    expect(row.evaluations[0]!.notRunnableReason).toContain("no W503 evaluation input supplied");
  });

  test("an empty fixture list is never a vacuous pass", () => {
    const row = runTemporalGate({ evaluations: [] }, GATE_POLICY);
    expect(row.verdict).toBe("NOT-RUNNABLE");
    expect(row.reason).toContain("no fixture evaluations supplied");
  });

  test("a malformed manifest payload is rejected by W503's own validation and accounted", () => {
    // The case payload's RUNTIME contract is "anything — the source
    // package's own fail-loud validation is the authority"; the type-level
    // promise is cast away here to exercise exactly that path.
    const malformedPayload = { manifest: {} } as unknown as TemporalEvaluationInput;
    const row = runTemporalGate(
      { evaluations: [{ name: "broken-clip", input: malformedPayload }] },
      GATE_POLICY,
    );
    expect(row.verdict).toBe("NOT-RUNNABLE");
    expect(row.evaluations[0]!.notRunnableReason).toContain("package error");
    expect(row.evaluations[0]!.notRunnableReason).toContain("TemporalEvaluationError");
  });
});

describe("the scene correctness gate runs W605's real evaluation", () => {
  test("the three demo fixtures pass with their values carried verbatim", () => {
    const scene = demoInput().scene;
    const row = runSceneGate(scene, GATE_POLICY);
    expect(row.gateId).toBe("scene-correctness");
    expect(row.sourcePackage).toBe("@sporta/scene-evaluation");
    expect(row.verdict).toBe("PASS");
    expect(row.evaluations.map((sub) => sub.fixtureName)).toEqual([
      "w605-clean-match",
      "w605-corrections-match",
      "w605-directed-review",
    ]);
    for (const sub of row.evaluations) {
      expect(sub.verdict).toBe("PASS");
      expect(sub.reportSchemaTag).toBe("sporta/scene-evaluation/w605@1");
      expect(sub.checkCount).toBe(44);
      expect(sub.failedCheckCount).toBe(0);
      expect(sub.failingChecks).toEqual([]);
      expect(sub.findings!.recorded).toBe(0);
      expect(sub.findings!.truncated).toBe(false);
      expect(sub.findings!.cap).toBe(200);
      expect(sub.dimensionVerdicts!.length).toBe(7);
      expect(sub.dimensionVerdicts!.every((dimension) => dimension.pass)).toBe(true);
    }
    // Verbatim carrying, pinned against an independently recomputed source
    // report for the corrections fixture.
    const correctionsSub = row.evaluations[1]!;
    const source: SceneEvaluationReport = evaluateSceneOutput(scene.evaluations[1]!.input!);
    const carried = new Map(correctionsSub.keyValues.map((entry) => [entry.metric, entry.value]));
    expect(carried.get("sourceTruth.stepSceneBlockMismatchCount")).toBe(
      source.sourceTruth.stepSceneBlockMismatchCount,
    );
    expect(carried.get("score.frameClaimMismatchCount")).toBe(source.score.frameClaimMismatchCount);
    expect(carried.get("identity.styleTokenDivergenceCount")).toBe(
      source.identity.styleTokenDivergenceCount,
    );
    expect(carried.get("ordering.markerUnaccountedCount")).toBe(
      source.ordering.markerUnaccountedCount,
    );
    expect(carried.get("sceneState.positionMismatchCount")).toBe(
      source.sceneState.positionMismatchCount,
    );
    expect(carried.get("direction.windowCameraBlockMismatchCount")).toBe(
      source.direction.windowCameraBlockMismatchCount,
    );
    expect(correctionsSub.evaluated!.sessionId).toBe("sess-w605-corr");
    expect(correctionsSub.evaluated!.frameCount).toBe(36);
    // The directed fixture carries its plan (planSupplied true, 4 windows).
    const directedSub = row.evaluations[2]!;
    expect(directedSub.evaluated!.planSupplied).toBe(true);
    expect(directedSub.evaluated!.windowCount).toBe(4);
    expect(carried.get("identity.entityIdentitySwapCount")).toBe(0);
  });

  test("a missing case input is an accounted not-runnable sub-row", () => {
    const scene = demoInput().scene;
    const row = runSceneGate(
      { evaluations: [scene.evaluations[0]!, { name: "w605-clean-match-copy", input: undefined }] },
      GATE_POLICY,
    );
    expect(row.verdict).toBe("NOT-RUNNABLE");
    expect(row.reason).toContain("missing input");
  });
});

describe("the human review gate is fail-closed on every record state", () => {
  test("the checked-in self-check record completes the gate", () => {
    const outcome = runHumanReviewGate(loadDemoRecord(), GATE_POLICY);
    expect(outcome.row.verdict).toBe("PASS");
    expect(outcome.row.blocking).toBe(true);
    expect(outcome.section.recordStatus).toBe("present-complete");
    expect(outcome.section.required).toBe(true);
    expect(outcome.section.problems).toEqual([]);
    expect(outcome.section.record!.isHumanAttestation).toBe(false);
    const carried = new Map(outcome.row.keyValues.map((entry) => [entry.metric, entry.value]));
    expect(carried.get("humanReview.checklistItemCount")).toBe(7);
    expect(carried.get("humanReview.checklistPassCount")).toBe(7);
    expect(carried.get("humanReview.checklistFailCount")).toBe(0);
  });

  test("an absent record is not-runnable with the accounted cause", () => {
    const outcome = runHumanReviewGate(undefined, GATE_POLICY);
    expect(outcome.row.verdict).toBe("NOT-RUNNABLE");
    expect(outcome.row.notRunnableOutcome).toBe("pending-human-review");
    expect(outcome.row.reason).toBe("no human review record supplied");
    expect(outcome.section.recordStatus).toBe("absent");
    expect(outcome.section.record).toBeUndefined();
  });

  test("a malformed record is not-runnable with the JSON path accounted", () => {
    const outcome = runHumanReviewGate({ schemaTag: "wrong" }, GATE_POLICY);
    expect(outcome.row.verdict).toBe("NOT-RUNNABLE");
    expect(outcome.row.reason).toContain("human review record malformed");
    expect(outcome.section.recordStatus).toBe("malformed");
  });

  test("an incomplete record is not-runnable with the missing items accounted", () => {
    const record = loadDemoRecord() as Record<string, unknown>;
    const results = record.checklistResults as Record<string, unknown>[];
    const incomplete = {
      ...record,
      checklistResults: results.slice(0, 5),
    };
    const outcome = runHumanReviewGate(incomplete, GATE_POLICY);
    expect(outcome.row.verdict).toBe("NOT-RUNNABLE");
    expect(outcome.row.reason).toContain("incomplete");
    expect(outcome.row.reason).toContain("release-scope-verified");
    expect(outcome.row.reason).toContain("release-signoff");
    expect(outcome.section.recordStatus).toBe("incomplete");
  });
});

describe("the demo release report (the composition over the real fixtures)", () => {
  test("the full demo run passes with all four gates accounted", () => {
    const report = evaluateReleaseReadiness(buildDemoReleaseInput(loadDemoRecord()));
    expect(report.schemaTag).toBe(REPORT_SCHEMA_TAG);
    expect(report.verdict.outcome).toBe("PASS");
    expect(report.gates.map((row) => row.gateId)).toEqual([
      "temporal-stability",
      "scene-correctness",
      "human-quality-checks",
      "gate-accounting",
    ]);
    expect(report.gates.every((row) => row.verdict === "PASS")).toBe(true);
    expect(report.accounting).toEqual({
      totalGates: 4,
      passCount: 4,
      failCount: 0,
      notRunnableCount: 0,
    });
    expect(report.humanReview.recordStatus).toBe("present-complete");
    expect(report.input).toEqual({
      temporalFixtureCount: 1,
      sceneFixtureCount: 3,
      humanReviewSupplied: true,
    });
    expect(report.policy).toEqual({
      version: "w803-gate-policy@1",
      gateCount: 4,
      blockingGateCount: 4,
      advisoryGateCount: 0,
    });
  });
});
