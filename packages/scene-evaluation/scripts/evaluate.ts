/**
 * The W605 evaluation CLI: rebuilds every checked-in fixture through the
 * real W601–W604 seams, measures it, prints each axis and every check with
 * its measured value, and prints a VERDICT line per fixture. Also runs the
 * detection proof (every injected defect must flip the verdict to FAIL) —
 * exit 0 = all fixtures PASS + all injections detected, 1 = a clean fixture
 * FAILED, 2 = some injection went undetected. The stdout is a pure function
 * of the fixtures: the same input yields byte-identical output.
 */
import {
  buildCleanMatchFixture,
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

/** One fixture to evaluate. */
interface FixtureCase {
  readonly name: string;
  readonly input: SceneEvaluationInput;
}

const fixtures: FixtureCase[] = [
  { name: "clean-match", input: buildCleanMatchFixture() },
  { name: "corrections-match", input: buildCorrectionsMatchFixture() },
  { name: "directed-review", input: buildDirectedReviewFixture().input },
];

let failures = 0;
for (const fixture of fixtures) {
  const report = evaluateSceneOutput(fixture.input);
  if (!report.verdict.pass) failures += 1;
  console.log(
    `\n== fixture ${fixture.name} — ${report.input.rendererId}@${report.input.rendererVersion} (${report.input.mode}) ==`,
  );
  console.log(
    `  session ${report.input.sessionId} · ${report.input.stepCount} steps · ${report.input.frameCount} frames · ${report.input.windowCount} windows · ${report.input.markerCount} markers · planSupplied ${report.input.planSupplied}`,
  );
  console.log(
    `  source-truth: score ${report.sourceTruth.stepScoreMismatchCount} clock ${report.sourceTruth.stepClockMismatchCount} possession ${report.sourceTruth.stepPossessionMismatchCount} entities ${report.sourceTruth.stepEntityStateMismatchCount} blocks ${report.sourceTruth.stepSceneBlockMismatchCount}`,
  );
  console.log(
    `  score: claims ${report.score.frameClaimMismatchCount} steps ${report.score.stepScoreMismatchCount} · clock: claims ${report.clock.frameClaimMismatchCount} steps ${report.clock.stepClockMismatchCount} mid-segment ${report.clock.midSegmentClaimChangeCount} boundary-changes ${report.clock.boundaryClaimAdvanceCount}`,
  );
  console.log(
    `  identity: styled ${report.identity.identityStyledEntityCount} token-frames ${report.identity.tokenFrameCount} divergence ${report.identity.styleTokenDivergenceCount} instability ${report.identity.styleTokenInstabilityCount} swaps ${report.identity.entityIdentitySwapCount} kind-changes ${report.identity.entityKindChangeCount}`,
  );
  console.log(
    `  ordering: step-order ${report.ordering.stepMarkerLogOrderViolationCount} frame-order ${report.ordering.frameMarkerOrderViolationCount} fields ${report.ordering.markerFieldMismatchCount} containment ${report.ordering.markerWindowContainmentViolationCount} duplicates ${report.ordering.markerDuplicateDisplayCount} cross-window ${report.ordering.markerCrossWindowDuplicateCount} unaccounted ${report.ordering.markerUnaccountedCount} transfers ${report.ordering.boundaryTransferUnaccountedCount} novel ${report.ordering.reviewNovelMarkerCount}`,
  );
  console.log(
    `  scene-state: interpolation ${report.sceneState.frameInterpolationMismatchCount} indexes ${report.sceneState.interpolationIndexMismatchCount} entity-sets ${report.sceneState.frameEntitySetMismatchCount} entity-states ${report.sceneState.frameEntityStateMismatchCount} dispositions ${report.sceneState.dispositionMismatchCount} positions ${report.sceneState.positionMismatchCount} provenance ${report.sceneState.provenanceMismatchCount} ball-height ${report.sceneState.ballHeightMismatchCount} possession ${report.sceneState.possessionMismatchCount} (${report.sceneState.entityFrameCount} entity-frames)`,
  );
  console.log(
    `  direction: frame-slots ${report.direction.frameSlotMismatchCount} labels ${report.direction.frameCameraLabelMismatchCount} slots-carried ${report.direction.windowSlotNotCarriedCount} camera-blocks ${report.direction.windowCameraBlockMismatchCount} review-profiles ${report.direction.reviewProfileMismatchCount} plan-windows ${report.direction.planWindowMismatchCount} plan-provenance ${report.direction.planProvenanceMismatchCount}`,
  );
  console.log(
    `  findings: ${report.findings.entries.length} recorded, ${report.findings.dropped} dropped beyond cap ${report.findings.cap}, truncated ${report.findings.truncated}`,
  );
  for (const check of report.verdict.checks) {
    const mark = check.pass ? "PASS" : "FAIL";
    console.log(
      `  [${mark}] ${check.metric} = ${check.measured} (threshold <= ${check.threshold})`,
    );
  }
  console.log(`VERDICT ${fixture.name}: ${report.verdict.pass ? "PASS" : "FAIL"}`);
}

// --- The detection proof (the accept criterion's teeth) -------------------
console.log("\n== detection proof (each injected defect must FAIL) ==");

/** One injection to prove detected. */
interface InjectionCase {
  readonly name: string;
  readonly input: SceneEvaluationInput;
}

const corrections = buildCorrectionsMatchFixture();
const directed = buildDirectedReviewFixture();
const injections: InjectionCase[] = [
  {
    name: "wrong score claim (one frame's status line replaced)",
    input: injectWrongScoreClaim(corrections, { frameIndex: 35 }),
  },
  {
    name: "stuck clock (the claim never advances past the first snapshot)",
    input: injectStuckClock(corrections),
  },
  {
    name: "swapped style tokens (two entities exchange styles everywhere)",
    input: injectSwappedStyleTokens(corrections, { entityA: "striker-9", entityB: "teleport-3" }),
  },
  {
    name: "out-of-order markers (one frame's markers reversed)",
    input: injectOutOfOrderMarkers(corrections, { frameIndex: 17 }),
  },
  {
    name: "scene-state mismatch (one entity's position drifts on one frame)",
    input: injectSceneStateDrift(corrections, {
      frameIndex: 20,
      entityId: "striker-9",
      dxMeters: 3,
    }),
  },
  {
    name: "mis-directed window (a live window's slot rewritten)",
    input: injectMisDirectedWindow(directed.input, {
      windowIndex: 2,
      toSlotId: "aerial-tactical",
    }),
  },
  {
    name: "held claim without a declared cut",
    input: injectHeldWithoutDeclaredCut(corrections, { frameIndex: 11 }),
  },
  {
    name: "camera block drift (a window's focal length tampered)",
    input: injectCameraBlockDrift(directed.input, { windowIndex: 1, focalPx: 256 }),
  },
  {
    name: "silently dropped marker (mid-window sequence vanishes)",
    input: injectDroppedMarker(directed.input, { sequence: 6 }),
  },
  {
    name: "silently dropped boundary-transferred marker (restart at 4000)",
    input: injectDroppedMarker(directed.input, { sequence: 4 }),
  },
];

let undetected = 0;
for (const injection of injections) {
  const perturbedReport = evaluateSceneOutput(injection.input);
  const failing = perturbedReport.verdict.failures.map((failure) => failure.metric);
  const detected = !perturbedReport.verdict.pass;
  if (!detected) undetected += 1;
  console.log(
    `  [${detected ? "DETECTED" : "MISSED"}] ${injection.name} — failing checks: ${failing.join(", ") || "none"}`,
  );
}

if (failures > 0) process.exit(1);
if (undetected > 0) process.exit(2);
