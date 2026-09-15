/**
 * The gate runner pins (the composition core): each machine gate runs the
 * REAL public evaluation of its source package over the real fixtures and
 * carries the source evidence VERBATIM; each defect class injected
 * through the REAL injector seams of the source packages (the way those
 * packages' own detection tests inject) must flip the gate — and the
 * release — to FAIL; and every not-runnable path (missing input, empty
 * runs, malformed documents) must be counted FAIL with the reason and the
 * source error echoed verbatim — never skipped.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  injectUnexplainedAbsence,
  renderW503CleanFixture,
  evaluateRenderOutput,
} from "@sporta/renderer-evaluation";
import {
  buildCleanMatchFixture,
  buildCorrectionsMatchFixture,
  buildDirectedReviewFixture,
  injectWrongScoreClaim,
  W605_CLEAN_SESSION_ID,
  evaluateSceneOutput,
} from "@sporta/scene-evaluation";
import {
  SCENE_FIXTURE_IDS,
  TEMPORAL_FIXTURE_ID,
  buildCanonicalReleaseInput,
  evaluateReleaseReadiness,
  type GateRow,
  type ReleaseEvaluationInput,
} from "../src/index";

const RECORD: unknown = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "fixtures", "human-review-self-check.json"), "utf8"),
);

/** The canonical release input, built once (pure runners reuse it). */
const CANONICAL: ReleaseEvaluationInput = buildCanonicalReleaseInput(RECORD);

/** The gate row of one gate id (fail-loud when absent). */
function gateRow(report: ReturnType<typeof evaluateReleaseReadiness>, gateId: string): GateRow {
  const row = report.gates.find((candidate) => candidate.gateId === gateId);
  expect(row, `no report row for gate ${gateId}`).toBeDefined();
  return row!;
}

/** Builds a release input like the canonical one with the temporal output overridden. */
function withTemporalOutput(output: unknown): ReleaseEvaluationInput {
  return {
    temporal: { fixture: TEMPORAL_FIXTURE_ID, output },
    scene: CANONICAL.scene,
    humanReview: RECORD,
  };
}

/** Builds a release input like the canonical one with the scene runs overridden. */
function withSceneRuns(scene: ReleaseEvaluationInput["scene"]): ReleaseEvaluationInput {
  return { temporal: CANONICAL.temporal, scene, humanReview: RECORD };
}

describe("the temporal stability gate — the real W503 evaluation over the real fixture", () => {
  test("carries the source report's evidence VERBATIM (checks, verdict, input echo)", () => {
    const report = evaluateReleaseReadiness(CANONICAL);
    const row = gateRow(report, "temporal-stability");
    expect(row.verdict).toBe("PASS");
    expect(row.sourcePackage).toBe("@sporta/renderer-evaluation");
    expect(row.reason).toBeNull();
    // The source evidence, recomputed through the REAL evaluator, matches field-for-field.
    const source = evaluateRenderOutput(renderW503CleanFixture());
    expect(row.runs).toHaveLength(1);
    const run = row.runs![0]!;
    expect(run.fixture).toBe(TEMPORAL_FIXTURE_ID);
    expect(run.reportSchemaTag).toBe(source.schemaTag);
    expect(run.sourceVerdictPass).toBe(source.verdict.pass);
    expect(run.sourceInput).toEqual({ ...source.input });
    expect(run.checks).toEqual(
      source.verdict.checks.map((check) => ({
        metric: check.metric,
        operator: check.operator,
        threshold: check.threshold,
        measured: check.measured,
        pass: check.pass,
      })),
    );
    expect(run.failingChecks).toEqual([]);
  });

  test("the carried evidence pins the fixture run's key measured values (upstream drift is loud)", () => {
    const row = gateRow(evaluateReleaseReadiness(CANONICAL), "temporal-stability");
    const run = row.runs![0]!;
    expect(run.checks).toHaveLength(21);
    const measured = (metric: string): number => {
      const check = run.checks.find((candidate) => candidate.metric === metric);
      expect(check, `missing carried check ${metric}`).toBeDefined();
      return check!.measured;
    };
    expect(measured("identity.unexplainedAbsenceCount")).toBe(0);
    expect(measured("identity.flickerCount")).toBe(0);
    expect(measured("identity.styleStabilityRatio")).toBe(1);
    expect(measured("styleBytes.stabilityRatio")).toBe(1);
    expect(measured("geometry.jumpCount")).toBe(0);
    // The clean fixture's fastest legal motion: the 0.8 m/s player step (0.8 m)
    // against the player drift bound (12.5 m/s × 1 s + 0.01 m) — the exact
    // deterministic ratio the W503 fixture pins.
    expect(measured("geometry.maxJumpRatio")).toBe(0.06394884092725854);
    expect(run.sourceInput.rendererId).toBe("anime.prototype");
    expect(run.sourceInput.frameCount).toBe(6);
    expect(run.sourceInput.svgFramesMeasured).toBe(true);
  });

  test("a temporal defect injected through the REAL injector seam flips the gate and the release to FAIL", () => {
    const output = renderW503CleanFixture();
    const perturbed = injectUnexplainedAbsence(output.manifest, {
      frameIndex: 2,
      entityId: "player-7",
    });
    const report = evaluateReleaseReadiness(withTemporalOutput({ ...output, manifest: perturbed }));
    expect(report.verdict).toBe("FAIL");
    const row = gateRow(report, "temporal-stability");
    expect(row.verdict).toBe("FAIL");
    expect(row.reason?.code).toBe("checks-failed");
    // The failing checks are the source report's own failures, carried verbatim.
    const failing = row.runs![0]!.failingChecks.map((check) => check.metric);
    expect(failing).toContain("identity.unexplainedAbsenceCount");
    expect(failing).toContain("identity.flickerCount");
    expect(
      row.runs![0]!.failingChecks.find((check) => check.metric === "identity.flickerCount")!
        .measured,
    ).toBe(1);
  });

  test("a malformed manifest makes the gate NOT_RUNNABLE with the source typed error echoed verbatim (counted FAIL)", () => {
    const report = evaluateReleaseReadiness(
      withTemporalOutput({ manifest: { frames: [] }, frames: [] }),
    );
    expect(report.verdict).toBe("FAIL");
    const row = gateRow(report, "temporal-stability");
    expect(row.verdict).toBe("NOT_RUNNABLE");
    expect(row.reason?.code).toBe("evaluation-error");
    expect(row.reason?.sourceError?.className).toBe("TemporalEvaluationError");
    expect(row.reason?.sourceError?.code).toBe("manifest-malformed");
    expect(row.reason?.sourceError?.path).toBe("$.renderer");
    expect(row.reason?.sourceError?.message).toBe(
      "temporal evaluation: $.renderer: must be an object (got undefined)",
    );
    expect(report.accounting.counts.notRunnable).toBe(1);
    expect(report.accounting.reconciles).toBe(true);
  });

  test("a missing temporal input is NOT_RUNNABLE (input-missing), never skipped", () => {
    const report = evaluateReleaseReadiness({ scene: CANONICAL.scene, humanReview: RECORD });
    const row = gateRow(report, "temporal-stability");
    expect(row.verdict).toBe("NOT_RUNNABLE");
    expect(row.reason?.code).toBe("input-missing");
    expect(report.verdict).toBe("FAIL");
    expect(report.accounting.counts).toEqual({ pass: 3, fail: 0, notRunnable: 1 });
  });
});

describe("the scene correctness gate — the real W605 evaluation over the real fixtures", () => {
  test("carries all three real fixtures' evidence VERBATIM", () => {
    const report = evaluateReleaseReadiness(CANONICAL);
    const row = gateRow(report, "scene-correctness");
    expect(row.verdict).toBe("PASS");
    expect(row.sourcePackage).toBe("@sporta/scene-evaluation");
    expect(row.runs).toHaveLength(3);
    const fixtures = row.runs!.map((run) => run.fixture);
    expect(fixtures).toEqual([
      SCENE_FIXTURE_IDS.cleanMatch,
      SCENE_FIXTURE_IDS.correctionsMatch,
      SCENE_FIXTURE_IDS.directedReview,
    ]);
    for (const run of row.runs!) {
      expect(run.reportSchemaTag).toBe("sporta/scene-evaluation/w605@1");
      expect(run.sourceVerdictPass).toBe(true);
      expect(run.checks).toHaveLength(44);
      expect(run.failingChecks).toEqual([]);
    }
    // One verbatim input echo per fixture, cross-checked against the source session ids.
    expect(row.runs![0]!.sourceInput.sessionId).toBe(W605_CLEAN_SESSION_ID);
    expect(row.runs![2]!.sourceInput.mode).toBe("directed");
    expect(row.runs![2]!.sourceInput.planSupplied).toBe(true);
  });

  test("the carried checks equal the REAL evaluator's own checks field-for-field", () => {
    const source = evaluateSceneOutput(buildCleanMatchFixture());
    const row = gateRow(evaluateReleaseReadiness(CANONICAL), "scene-correctness");
    const run = row.runs!.find((candidate) => candidate.fixture === SCENE_FIXTURE_IDS.cleanMatch)!;
    expect(run.checks).toEqual(
      source.verdict.checks.map((check) => ({
        metric: check.metric,
        operator: check.operator,
        threshold: check.threshold,
        measured: check.measured,
        pass: check.pass,
      })),
    );
    expect(run.sourceInput).toEqual({ ...source.input });
  });

  test("a scene defect injected the way the scene package's own tests inject flips the gate and the release to FAIL", () => {
    const corrections = buildCorrectionsMatchFixture();
    const report = evaluateReleaseReadiness(
      withSceneRuns([
        { fixture: SCENE_FIXTURE_IDS.cleanMatch, input: buildCleanMatchFixture() },
        {
          fixture: SCENE_FIXTURE_IDS.correctionsMatch,
          input: injectWrongScoreClaim(corrections, { frameIndex: 35 }),
        },
        { fixture: SCENE_FIXTURE_IDS.directedReview, input: buildDirectedReviewFixture().input },
      ]),
    );
    expect(report.verdict).toBe("FAIL");
    const row = gateRow(report, "scene-correctness");
    expect(row.verdict).toBe("FAIL");
    expect(row.reason?.code).toBe("checks-failed");
    expect(row.reason?.message).toContain(SCENE_FIXTURE_IDS.correctionsMatch);
    const failingRun = row.runs!.find((run) => !run.sourceVerdictPass)!;
    expect(failingRun.fixture).toBe(SCENE_FIXTURE_IDS.correctionsMatch);
    const failing = failingRun.failingChecks.map((check) => check.metric);
    expect(failing).toContain("score.frameClaimMismatchCount");
    expect(failing).toContain("clock.frameClaimMismatchCount");
    // The other two fixtures still passed — the gate is per-fixture honest.
    expect(row.runs!.filter((run) => run.sourceVerdictPass)).toHaveLength(2);
  });

  test("a malformed scene document makes the gate NOT_RUNNABLE with the source typed error echoed (counted FAIL)", () => {
    const report = evaluateReleaseReadiness(
      withSceneRuns([
        {
          fixture: "w605-malformed",
          input: { snapshots: [], eventStream: [], steps: [], output: {} },
        },
      ]),
    );
    expect(report.verdict).toBe("FAIL");
    const row = gateRow(report, "scene-correctness");
    expect(row.verdict).toBe("NOT_RUNNABLE");
    expect(row.reason?.code).toBe("evaluation-error");
    expect(row.reason?.sourceError?.className).toBe("SceneEvaluationError");
    expect(row.reason?.sourceError?.code).toBe("snapshot-malformed");
    expect(row.reason?.sourceError?.path).toBe("$.snapshots");
    expect(report.accounting.counts.notRunnable).toBe(1);
  });

  test("an empty scene run list is NOT_RUNNABLE — a gate with nothing measured is never a vacuous pass", () => {
    const report = evaluateReleaseReadiness(withSceneRuns([]));
    const row = gateRow(report, "scene-correctness");
    expect(row.verdict).toBe("NOT_RUNNABLE");
    expect(row.reason?.code).toBe("runs-empty");
    expect(report.verdict).toBe("FAIL");
  });

  test("a missing scene input is NOT_RUNNABLE (input-missing)", () => {
    const report = evaluateReleaseReadiness({ temporal: CANONICAL.temporal, humanReview: RECORD });
    const row = gateRow(report, "scene-correctness");
    expect(row.verdict).toBe("NOT_RUNNABLE");
    expect(row.reason?.code).toBe("input-missing");
  });
});

describe("the human quality checks gate — fail-closed review outcomes", () => {
  /** Evaluates with the human review record overridden. */
  function withRecord(humanReview: unknown): ReleaseEvaluationInput {
    return { temporal: CANONICAL.temporal, scene: CANONICAL.scene, humanReview };
  }

  test("the checked-in self-check record passes, echoed verbatim in the section", () => {
    const report = evaluateReleaseReadiness(CANONICAL);
    const row = gateRow(report, "human-quality-checks");
    expect(row.verdict).toBe("PASS");
    expect(row.reason).toBeNull();
    expect(row.runs).toBeUndefined(); // the human gate carries a section, not runs
    expect(report.humanReview.gateVerdict).toBe("PASS");
    expect(report.humanReview.failureClass).toBeNull();
    expect(report.humanReview.recordKind).toBe("automated-pipeline-self-check");
    expect(report.humanReview.checklistId).toBe("w803-self-check-checklist@1");
    expect(report.humanReview.reviewer?.name).toBe("sporta quality-gates pipeline");
    expect(report.humanReview.date).toBe("2026-09-16");
    expect(report.humanReview.results).toHaveLength(4);
    expect(report.humanReview.failingItems).toEqual([]);
    expect(report.humanReview.notes).toContain("NOT a human attestation");
  });

  test("a removed record fails the gate with class record-missing", () => {
    const report = evaluateReleaseReadiness({
      temporal: CANONICAL.temporal,
      scene: CANONICAL.scene,
    });
    const row = gateRow(report, "human-quality-checks");
    expect(row.verdict).toBe("FAIL");
    expect(row.reason?.code).toBe("record-missing");
    expect(report.humanReview.failureClass).toBe("record-missing");
    expect(report.humanReview.recordKind).toBeNull();
  });

  test("a malformed record fails the gate with class record-malformed and the problem echoed", () => {
    const report = evaluateReleaseReadiness(withRecord({ schemaTag: "wrong" }));
    const row = gateRow(report, "human-quality-checks");
    expect(row.verdict).toBe("FAIL");
    expect(row.reason?.code).toBe("record-malformed");
    expect(report.humanReview.failureClass).toBe("record-malformed");
    expect(report.humanReview.problem?.code).toBe("record-malformed");
    expect(report.humanReview.problem?.path).toBe("$.schemaTag");
  });

  test("an incomplete record fails the gate with class record-incomplete and the missing items accounted", () => {
    const raw = JSON.parse(JSON.stringify(RECORD)) as { checklistResults: unknown[] };
    raw.checklistResults = raw.checklistResults.slice(0, 3);
    const report = evaluateReleaseReadiness(withRecord(raw));
    const row = gateRow(report, "human-quality-checks");
    expect(row.verdict).toBe("FAIL");
    expect(row.reason?.code).toBe("record-incomplete");
    expect(report.humanReview.failureClass).toBe("record-incomplete");
    expect(report.humanReview.missingItems).toEqual([{ itemId: "gate-report-read" }]);
  });

  test("a completed record with a failing item is a definitive human FAIL", () => {
    const raw = JSON.parse(JSON.stringify(RECORD)) as {
      checklistResults: Array<{ itemId: string; result: string }>;
    };
    raw.checklistResults[0]!.result = "fail";
    const report = evaluateReleaseReadiness(withRecord(raw));
    const row = gateRow(report, "human-quality-checks");
    expect(row.verdict).toBe("FAIL");
    expect(row.reason?.code).toBe("checklist-item-failed");
    expect(report.humanReview.failingItems).toEqual([{ itemId: "temporal-clip-rendered" }]);
  });
});

describe("input purity — the evaluation never mutates its input", () => {
  test("the canonical input is byte-identical before and after the evaluation", () => {
    const before = JSON.stringify(CANONICAL);
    evaluateReleaseReadiness(CANONICAL);
    expect(JSON.stringify(CANONICAL)).toBe(before);
  });
});
