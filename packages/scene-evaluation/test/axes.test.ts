/**
 * The six accept-criterion axes on the clean fixtures: every dimension's
 * verdict PASSES with every defect count exactly 0, the measurement BASES
 * are non-vacuous (frames checked, entity-frame pairs, token frames,
 * boundary crossings — the metrics actually measured something), and the
 * fixtures' specific stories show up as the documented evidence (the clock
 * advanced at boundaries, the review re-presented, the boundary transfer
 * was accounted).
 */
import { describe, expect, test } from "bun:test";
import {
  buildCleanMatchFixture,
  buildCorrectionsMatchFixture,
  buildDirectedReviewFixture,
  evaluateSceneOutput,
} from "../src/index";
import type { SceneEvaluationReport } from "../src/index";

const cleanReport = evaluateSceneOutput(buildCleanMatchFixture());
const correctionsReport = evaluateSceneOutput(buildCorrectionsMatchFixture());
const directedReport = evaluateSceneOutput(buildDirectedReviewFixture().input);

const reports: Array<[string, SceneEvaluationReport]> = [
  ["clean-match", cleanReport],
  ["corrections-match", correctionsReport],
  ["directed-review", directedReport],
];

describe("the clean verdicts", () => {
  for (const [name, report] of reports) {
    test(`${name}: every dimension passes, the verdict is PASS, zero findings`, () => {
      expect(report.verdict.pass).toBe(true);
      expect(report.verdict.failures).toHaveLength(0);
      expect(report.findings.entries).toHaveLength(0);
      expect(report.findings.truncated).toBe(false);
      expect(report.findings.dropped).toBe(0);
      for (const [dimension, verdict] of Object.entries(report.dimensions)) {
        expect(verdict.pass, `${name}/${dimension}`).toBe(true);
        expect(verdict.failures, `${name}/${dimension}`).toHaveLength(0);
      }
    });

    test(`${name}: every defect count is exactly 0`, () => {
      expect(report.sourceTruth.stepScoreMismatchCount).toBe(0);
      expect(report.sourceTruth.stepClockMismatchCount).toBe(0);
      expect(report.sourceTruth.stepPossessionMismatchCount).toBe(0);
      expect(report.sourceTruth.stepEntityStateMismatchCount).toBe(0);
      expect(report.sourceTruth.stepSceneBlockMismatchCount).toBe(0);
      expect(report.score.frameClaimMismatchCount).toBe(0);
      expect(report.score.stepScoreMismatchCount).toBe(0);
      expect(report.clock.frameClaimMismatchCount).toBe(0);
      expect(report.clock.stepClockMismatchCount).toBe(0);
      expect(report.clock.midSegmentClaimChangeCount).toBe(0);
      expect(report.identity.styleTokenDivergenceCount).toBe(0);
      expect(report.identity.styleTokenInstabilityCount).toBe(0);
      expect(report.identity.entityIdentitySwapCount).toBe(0);
      expect(report.identity.entityKindChangeCount).toBe(0);
      expect(report.identity.entityStyleKindChangeCount).toBe(0);
      expect(report.identity.sanctionedRestyleCount).toBe(0);
      expect(report.ordering.stepMarkerLogOrderViolationCount).toBe(0);
      expect(report.ordering.frameMarkerOrderViolationCount).toBe(0);
      expect(report.ordering.markerFieldMismatchCount).toBe(0);
      expect(report.ordering.markerWindowContainmentViolationCount).toBe(0);
      expect(report.ordering.markerDuplicateDisplayCount).toBe(0);
      expect(report.ordering.markerCrossWindowDuplicateCount).toBe(0);
      expect(report.ordering.markerUnaccountedCount).toBe(0);
      expect(report.ordering.boundaryTransferUnaccountedCount).toBe(0);
      expect(report.ordering.reviewNovelMarkerCount).toBe(0);
      expect(report.ordering.markerNotInUnionDisplayCount).toBe(0);
      expect(report.ordering.markerDisplayAccountingMismatchCount).toBe(0);
      expect(report.ordering.markerSkipAccountingMismatchCount).toBe(0);
      expect(report.sceneState.frameInterpolationMismatchCount).toBe(0);
      expect(report.sceneState.interpolationIndexMismatchCount).toBe(0);
      expect(report.sceneState.frameEntitySetMismatchCount).toBe(0);
      expect(report.sceneState.frameEntityStateMismatchCount).toBe(0);
      expect(report.sceneState.dispositionMismatchCount).toBe(0);
      expect(report.sceneState.positionMismatchCount).toBe(0);
      expect(report.sceneState.provenanceMismatchCount).toBe(0);
      expect(report.sceneState.ballHeightMismatchCount).toBe(0);
      expect(report.sceneState.possessionMismatchCount).toBe(0);
      expect(report.direction.frameSlotMismatchCount).toBe(0);
      expect(report.direction.frameCameraLabelMismatchCount).toBe(0);
      expect(report.direction.windowSlotNotCarriedCount).toBe(0);
      expect(report.direction.windowCameraBlockMismatchCount).toBe(0);
      expect(report.direction.reviewProfileMismatchCount).toBe(0);
      expect(report.direction.planWindowMismatchCount).toBe(0);
      expect(report.direction.planProvenanceMismatchCount).toBe(0);
    });

    test(`${name}: the measurement bases are non-vacuous`, () => {
      expect(report.input.stepCount).toBeGreaterThan(0);
      expect(report.input.frameCount).toBeGreaterThan(0);
      expect(report.sourceTruth.stepCount).toBe(report.input.stepCount);
      expect(report.score.frameCount).toBe(report.input.frameCount);
      expect(report.clock.frameCount).toBe(report.input.frameCount);
      expect(report.identity.entityCount).toBeGreaterThan(0);
      expect(report.identity.tokenFrameCount).toBeGreaterThan(0);
      expect(report.identity.identityStyledEntityCount).toBeGreaterThan(0);
      expect(report.ordering.markerCount).toBeGreaterThan(0);
      expect(report.sceneState.entityFrameCount).toBeGreaterThan(0);
      expect(report.sceneState.frameCount).toBe(report.input.frameCount);
      expect(report.verdict.checks.length).toBe(44);
    });
  }
});

describe("the score and clock axes (evidence)", () => {
  test("clean-match: 4 steps, 16 frames, 3 markers, no windows, no plan", () => {
    expect(cleanReport.input.mode).toBe("match");
    expect(cleanReport.input.stepCount).toBe(4);
    expect(cleanReport.input.frameCount).toBe(16);
    expect(cleanReport.input.windowCount).toBe(0);
    expect(cleanReport.input.markerCount).toBe(3);
    expect(cleanReport.input.planSupplied).toBe(false);
    expect(cleanReport.input.rendererId).toBe("avatar-field.prototype");
    expect(cleanReport.input.rendererVersion).toBe("0.2.0");
    expect(cleanReport.input.sessionId).toBe("sess-w605-clean");
  });

  test("corrections-match: the clock advanced at exactly 7 snapshot boundaries", () => {
    expect(correctionsReport.input.mode).toBe("match");
    expect(correctionsReport.input.frameCount).toBe(36);
    expect(correctionsReport.input.markerCount).toBe(9);
    expect(correctionsReport.clock.boundaryClaimAdvanceCount).toBe(7);
  });

  test("directed-review: 62 frames, 4 windows, the plan supplied", () => {
    expect(directedReport.input.mode).toBe("directed");
    expect(directedReport.input.frameCount).toBe(62);
    expect(directedReport.input.windowCount).toBe(4);
    expect(directedReport.input.markerCount).toBe(9);
    expect(directedReport.input.planSupplied).toBe(true);
    expect(directedReport.direction.windowCount).toBe(4);
  });

  test("directed-review: boundary changes include the review's re-presentation jumps", () => {
    // Live play advances across snapshot boundaries; the review transition
    // re-presents earlier match time (a claim CHANGE at a window boundary —
    // evidence, never a defect).
    expect(directedReport.clock.boundaryClaimAdvanceCount).toBeGreaterThanOrEqual(7);
  });
});

describe("the identity axis (evidence)", () => {
  test("corrections-match: five identity-styled entities across 165 token frames", () => {
    expect(correctionsReport.identity.identityStyledEntityCount).toBe(5);
    expect(correctionsReport.identity.entityCount).toBe(8);
    expect(correctionsReport.identity.tokenFrameCount).toBe(165);
  });
});

describe("the ordering axis (evidence)", () => {
  test("directed-review: every marker accounted — displayed, skipped, or transferred", () => {
    // The accounting base: 9 markers over the whole timeline. The pass says
    // unaccounted = 0 AND boundary-transfer-unaccounted = 0 — the
    // boundary-exact marker (restart@4000) was transferred and re-presented.
    expect(directedReport.ordering.markerCount).toBe(9);
    expect(directedReport.ordering.markerUnaccountedCount).toBe(0);
    expect(directedReport.ordering.boundaryTransferUnaccountedCount).toBe(0);
    expect(directedReport.ordering.reviewNovelMarkerCount).toBe(0);
    expect(directedReport.ordering.markerCrossWindowDuplicateCount).toBe(0);
  });
});

describe("the scene-state axis (evidence)", () => {
  test("corrections-match: entity-frame comparisons cover the whole fixture", () => {
    // Frames 0-14 carry 7 entities; frames 15-35 carry 8 (sub-15 appears).
    expect(correctionsReport.sceneState.entityFrameCount).toBe(15 * 7 + 21 * 8);
  });

  test("directed-review: entity-frame comparisons cover the whole rundown", () => {
    // Window 0: 10 frames × 7 entities; window 1: 5 × 7; window 2: 21 × 8
    // (sub-15 is present from step 4000 on). The review covers steps
    // 2000..7000: its first 10 frames derive from steps 2000/3000 (7
    // entities), the remaining 16 from steps 4000+ (8 entities).
    expect(directedReport.sceneState.entityFrameCount).toBe(
      10 * 7 + 5 * 7 + 21 * 8 + 10 * 7 + 16 * 8,
    );
    expect(directedReport.sceneState.entityFrameCount).toBe(471);
  });
});

describe("the direction axis (evidence)", () => {
  test("a directed input without the plan evaluates vacuously and honestly", () => {
    const fixture = buildDirectedReviewFixture();
    const stripped = { ...fixture.input, plan: undefined };
    const report = evaluateSceneOutput(stripped);
    expect(report.input.planSupplied).toBe(false);
    expect(report.direction.planWindowMismatchCount).toBe(0);
    expect(report.direction.planProvenanceMismatchCount).toBe(0);
    expect(report.verdict.pass).toBe(true);
  });
});
