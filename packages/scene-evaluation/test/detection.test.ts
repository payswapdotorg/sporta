/**
 * The W605 detection proof (the accept criterion's teeth): every defect
 * class is INJECTED into a real fixture's output, and every injection must
 * (a) flip the verdict to FAIL, (b) trip its PRIMARY metric with the exact
 * expected value, and (c) appear in the verdict's failure list. No injection
 * is silently swallowed (every failure entry carries threshold 0 and a
 * measured value > 0), and the injectors never mutate their inputs.
 */
import { describe, expect, test } from "bun:test";
import {
  buildCorrectionsMatchFixture,
  buildDirectedReviewFixture,
  evaluateSceneOutput,
  injectCameraBlockDrift,
  injectDroppedMarker,
  injectHeldWithoutDeclaredCut,
  injectMisDirectedWindow,
  injectOutOfOrderMarkers,
  injectSceneStateDrift,
  injectStuckClock,
  injectSwappedStyleTokens,
  injectWrongScoreClaim,
} from "../src/index";
import type { SceneEvaluationInput } from "../src/index";

const corrections = buildCorrectionsMatchFixture();
const directed = buildDirectedReviewFixture();

/** Evaluates a perturbed input (fresh fixture, never the shared one). */
function evaluate(input: SceneEvaluationInput) {
  return evaluateSceneOutput(input);
}

/** The failing metric paths of a report. */
function failingMetrics(report: ReturnType<typeof evaluate>): string[] {
  return report.verdict.failures.map((failure) => failure.metric);
}

describe("the injected-defect teeth", () => {
  test("a wrong score claim flips the verdict (score + clock claims)", () => {
    const report = evaluate(injectWrongScoreClaim(corrections, { frameIndex: 35 }));
    expect(report.verdict.pass).toBe(false);
    expect(report.score.frameClaimMismatchCount).toBe(1);
    expect(report.clock.frameClaimMismatchCount).toBe(1);
    expect(failingMetrics(report)).toContain("score.frameClaimMismatchCount");
    expect(failingMetrics(report)).toContain("clock.frameClaimMismatchCount");
  });

  test("a stuck clock flips the verdict (31 stale claims)", () => {
    const report = evaluate(injectStuckClock(corrections));
    expect(report.verdict.pass).toBe(false);
    // 36 frames; the 5 frames of the first segment still match the stuck
    // line — the other 31 claim a state the timeline has left behind.
    expect(report.clock.frameClaimMismatchCount).toBe(31);
    expect(report.score.frameClaimMismatchCount).toBe(31);
    expect(failingMetrics(report)).toContain("clock.frameClaimMismatchCount");
  });

  test("swapped style tokens flip the verdict (the swap signature fires)", () => {
    const report = evaluate(
      injectSwappedStyleTokens(corrections, { entityA: "striker-9", entityB: "teleport-3" }),
    );
    expect(report.verdict.pass).toBe(false);
    // 36 frames × 2 swap parties: each token matches the OTHER's expectation.
    expect(report.identity.entityIdentitySwapCount).toBe(72);
    expect(report.identity.styleTokenDivergenceCount).toBe(72);
    expect(failingMetrics(report)).toContain("identity.entityIdentitySwapCount");
    expect(failingMetrics(report)).toContain("identity.styleTokenDivergenceCount");
    // The findings exceed the cap (216 = 72 divergence + 72 swaps + 72
    // scene-state full-entry mismatches) and the truncation is accounted:
    // recorded + dropped = the total defect findings.
    expect(report.findings.truncated).toBe(true);
    expect(report.findings.entries).toHaveLength(200);
    expect(report.findings.dropped).toBe(16);
    expect(report.findings.entries.length + report.findings.dropped).toBe(216);
  });

  test("out-of-order markers flip the verdict (source order violated)", () => {
    const report = evaluate(injectOutOfOrderMarkers(corrections, { frameIndex: 17 }));
    expect(report.verdict.pass).toBe(false);
    expect(report.ordering.frameMarkerOrderViolationCount).toBe(1);
    expect(failingMetrics(report)).toContain("ordering.frameMarkerOrderViolationCount");
    // The display accounting itself stays consistent (the injector re-derived
    // it) — ONLY the order defect fires in the ordering dimension.
    expect(report.ordering.markerDisplayAccountingMismatchCount).toBe(0);
  });

  test("a scene-state mismatch flips the verdict (a position is invented)", () => {
    const report = evaluate(
      injectSceneStateDrift(corrections, {
        frameIndex: 20,
        entityId: "striker-9",
        dxMeters: 3,
      }),
    );
    expect(report.verdict.pass).toBe(false);
    expect(report.sceneState.frameEntityStateMismatchCount).toBe(1);
    expect(report.sceneState.positionMismatchCount).toBe(1);
    expect(failingMetrics(report)).toContain("sceneState.positionMismatchCount");
  });

  test("a mis-directed window flips the verdict (every window-scoped metric)", () => {
    const report = evaluate(
      injectMisDirectedWindow(directed.input, { windowIndex: 2, toSlotId: "aerial-tactical" }),
    );
    expect(report.verdict.pass).toBe(false);
    expect(report.direction.frameSlotMismatchCount).toBe(21);
    expect(report.direction.frameCameraLabelMismatchCount).toBe(21);
    expect(report.direction.windowCameraBlockMismatchCount).toBe(1);
    expect(report.direction.planWindowMismatchCount).toBe(1);
    expect(failingMetrics(report)).toContain("direction.frameSlotMismatchCount");
    expect(failingMetrics(report)).toContain("direction.planWindowMismatchCount");
  });

  test("a held claim without a declared cut flips the verdict (claim justification)", () => {
    const report = evaluate(injectHeldWithoutDeclaredCut(corrections, { frameIndex: 11 }));
    expect(report.verdict.pass).toBe(false);
    expect(report.sceneState.frameInterpolationMismatchCount).toBe(1);
    expect(failingMetrics(report)).toContain("sceneState.frameInterpolationMismatchCount");
  });

  test("a camera block drift flips the verdict (focal length tampered)", () => {
    const report = evaluate(
      injectCameraBlockDrift(directed.input, { windowIndex: 1, focalPx: 256 }),
    );
    expect(report.verdict.pass).toBe(false);
    expect(report.direction.windowCameraBlockMismatchCount).toBe(1);
    expect(failingMetrics(report)).toContain("direction.windowCameraBlockMismatchCount");
  });

  test("a silently dropped mid-window marker flips the verdict (unaccounted)", () => {
    const report = evaluate(injectDroppedMarker(directed.input, { sequence: 6 }));
    expect(report.verdict.pass).toBe(false);
    // The carry marker vanishes from window 2 AND the review — both unions
    // lose their accounting.
    expect(report.ordering.markerUnaccountedCount).toBe(2);
    expect(failingMetrics(report)).toContain("ordering.markerUnaccountedCount");
  });

  test("a dropped boundary-transferred marker flips the verdict (transfer debt)", () => {
    const report = evaluate(injectDroppedMarker(directed.input, { sequence: 4 }));
    expect(report.verdict.pass).toBe(false);
    // The restart@4000 rode window 1's dropped tail frame; with every later
    // presentation removed, the transfer is unaccounted — and window 2 and
    // the review each lose their own accounting for it.
    expect(report.ordering.boundaryTransferUnaccountedCount).toBe(1);
    expect(report.ordering.markerUnaccountedCount).toBe(2);
    expect(failingMetrics(report)).toContain("ordering.boundaryTransferUnaccountedCount");
  });
});

describe("no injection is silently swallowed", () => {
  const injections: Array<[string, SceneEvaluationInput]> = [
    ["wrong score claim", injectWrongScoreClaim(corrections, { frameIndex: 35 })],
    ["stuck clock", injectStuckClock(corrections)],
    [
      "swapped style tokens",
      injectSwappedStyleTokens(corrections, { entityA: "striker-9", entityB: "teleport-3" }),
    ],
    ["out-of-order markers", injectOutOfOrderMarkers(corrections, { frameIndex: 17 })],
    [
      "scene-state drift",
      injectSceneStateDrift(corrections, { frameIndex: 20, entityId: "striker-9", dxMeters: 3 }),
    ],
    [
      "mis-directed window",
      injectMisDirectedWindow(directed.input, { windowIndex: 2, toSlotId: "aerial-tactical" }),
    ],
    ["held without declared cut", injectHeldWithoutDeclaredCut(corrections, { frameIndex: 11 })],
    [
      "camera block drift",
      injectCameraBlockDrift(directed.input, { windowIndex: 1, focalPx: 256 }),
    ],
    ["dropped marker", injectDroppedMarker(directed.input, { sequence: 6 })],
    ["dropped transferred marker", injectDroppedMarker(directed.input, { sequence: 4 })],
  ];

  test("every injection FAILS with threshold-0, measured>0 failure entries", () => {
    for (const [name, input] of injections) {
      const report = evaluate(input);
      expect(report.verdict.pass, name).toBe(false);
      expect(report.verdict.failures.length, name).toBeGreaterThan(0);
      for (const failure of report.verdict.failures) {
        expect(failure.threshold, name).toBe(0);
        expect(failure.measured, name).toBeGreaterThan(0);
        expect(failure.operator, name).toBe("max");
        expect(failure.pass, name).toBe(false);
      }
    }
  });

  test("every injection leaves evidence (findings counted, truncation accounted)", () => {
    // The scene-state sub-counts (disposition/position/provenance/ball-height)
    // are FIELD CLASSIFIERS of the per-entity-frame finding — the evidence
    // for those checks lives in the parent finding's mismatched-field record.
    const findingParent: Record<string, string> = {
      "sceneState.dispositionMismatchCount": "sceneState.frameEntityStateMismatchCount",
      "sceneState.positionMismatchCount": "sceneState.frameEntityStateMismatchCount",
      "sceneState.provenanceMismatchCount": "sceneState.frameEntityStateMismatchCount",
      "sceneState.ballHeightMismatchCount": "sceneState.frameEntityStateMismatchCount",
    };
    for (const [name, input] of injections) {
      const report = evaluate(input);
      expect(report.findings.entries.length, name).toBeGreaterThan(0);
      if (!report.findings.truncated) {
        // Below the cap: every failing check has its finding evidence.
        expect(report.findings.dropped, name).toBe(0);
        for (const failure of report.verdict.failures) {
          const metric = findingParent[failure.metric] ?? failure.metric;
          expect(
            report.findings.entries.some((finding) => finding.metric === metric),
            `${name}: no finding for ${failure.metric}`,
          ).toBe(true);
        }
      } else {
        // Beyond the cap: the truncation is ACCOUNTED, never silent — the
        // recorded list is exactly the cap and the drop count is positive.
        expect(report.findings.entries, name).toHaveLength(report.findings.cap);
        expect(report.findings.dropped, name).toBeGreaterThan(0);
      }
    }
  });

  test("the injectors never mutate their inputs", () => {
    const before = JSON.stringify(corrections);
    const beforeDirected = JSON.stringify(directed);
    injectWrongScoreClaim(corrections, { frameIndex: 35 });
    injectStuckClock(corrections);
    injectSwappedStyleTokens(corrections, { entityA: "striker-9", entityB: "teleport-3" });
    injectOutOfOrderMarkers(corrections, { frameIndex: 17 });
    injectSceneStateDrift(corrections, { frameIndex: 20, entityId: "striker-9", dxMeters: 3 });
    injectHeldWithoutDeclaredCut(corrections, { frameIndex: 11 });
    injectMisDirectedWindow(directed.input, { windowIndex: 2, toSlotId: "aerial-tactical" });
    injectCameraBlockDrift(directed.input, { windowIndex: 1, focalPx: 256 });
    injectDroppedMarker(directed.input, { sequence: 6 });
    injectDroppedMarker(directed.input, { sequence: 4 });
    expect(JSON.stringify(corrections)).toBe(before);
    expect(JSON.stringify(directed)).toBe(beforeDirected);
    // And the pristine fixtures still evaluate PASS after all injections.
    expect(evaluateSceneOutput(corrections).verdict.pass).toBe(true);
    expect(evaluateSceneOutput(directed.input).verdict.pass).toBe(true);
  });

  test("the swap injector refuses a no-op (same-token entities)", () => {
    // striker-9 and winger-7 hash to the SAME palette entry — swapping them
    // changes nothing, and the injector says so instead of injecting a no-op.
    expect(() =>
      injectSwappedStyleTokens(corrections, { entityA: "striker-9", entityB: "winger-7" }),
    ).toThrow(RangeError);
  });
});
