/**
 * THE source-truth layer (layer 1): pins the rendered TIMELINE'S INPUT — the
 * steps — to the SWM's own at-T documents.
 *
 * Every step's scene is compared block-by-block against the REAL W601
 * projection of the step's ground-truth snapshot
 * (`projectScene(snapshot)`, the same pure function the render pipeline
 * uses — this package re-implements nothing):
 *
 * - the `scoreClock` block: score, clock, and possession — the SWM's
 *   verbatim football state (the score/clock ground truth of dimension 1/2);
 * - the `entities` array: every entity, kind, version, disposition,
 *   position — the player-identity and scene-state ground truth;
 * - the `source` watermark block, the `world` furniture, the schema version,
 *   the session id, and the camera slots (the constants).
 *
 * The event-marker TAIL is deliberately NOT compared here: which events a
 * step's spec carries is a construction choice (the event window bounds);
 * markers are evaluated against the SWM's event log by the ordering
 * dimension (`./ordering.ts`).
 *
 * Why per-step snapshot documents and not a live engine: the W006 engine's
 * football state has NO history (its documented at-T semantics — the state
 * is current, and `snapshot(t)` for `t < footballTimelineMs` carries no
 * football at all), so the ground-truth documents for a multi-step
 * timeline are the per-step snapshots CAPTURED at construction time
 * through the real `stateAt` seam. They are genuine SWM output (verbatim,
 * watermark-tagged), and the fixture is checked-in and deterministic.
 */
import type { WorldSnapshot } from "@sporta/contracts";
import { projectScene } from "@sporta/scene-projection";
import type { SceneSpecification } from "@sporta/scene-projection";
import type { AvatarField3dMatchStep } from "@sporta/renderer-3d";
import { deepEqualJson, describeValue } from "./internal";
import type { FindingSink, SceneEvaluationFinding } from "./findings";

/** The measured source-truth metrics (all counts; every mismatch a finding). */
export interface SourceTruthMetrics {
  /** Steps whose scene's score block ≠ the SWM projection's. */
  stepScoreMismatchCount: number;
  /** Steps whose scene's clock block ≠ the SWM projection's. */
  stepClockMismatchCount: number;
  /** Steps whose scene's possession block ≠ the SWM projection's. */
  stepPossessionMismatchCount: number;
  /** Steps whose scene's entities ≠ the SWM projection's (identity/position/disposition ground truth). */
  stepEntityStateMismatchCount: number;
  /** Steps whose scene's source/world/schema/session/slots blocks ≠ the SWM projection's. */
  stepSceneBlockMismatchCount: number;
  /** Total steps checked (evidence). */
  stepCount: number;
}

/** One block comparator result (the shared finding shape for layer 1). */
function compareBlock(
  steps: readonly AvatarField3dMatchStep[],
  expected: readonly SceneSpecification[],
  select: (scene: SceneSpecification) => unknown,
  label: string,
  metric: string,
  findings: FindingSink,
): number {
  let mismatches = 0;
  for (let k = 0; k < steps.length; k += 1) {
    const actual = select(steps[k]!.scene);
    const truth = select(expected[k]!);
    if (!deepEqualJson(actual, truth)) {
      mismatches += 1;
      findings.push({
        dimension: "source-truth",
        metric,
        stepIndex: k,
        path: `$.steps[${k}].scene.${label}`,
        expected: describeValue(truth),
        actual: describeValue(actual),
      });
    }
  }
  return mismatches;
}

/**
 * Measures the source-truth layer: every step's scene vs the REAL W601
 * projection of its ground-truth snapshot. Pure.
 */
export function measureSourceTruth(options: {
  snapshots: readonly WorldSnapshot[];
  steps: readonly AvatarField3dMatchStep[];
  findings: FindingSink;
}): SourceTruthMetrics {
  const { snapshots, steps, findings } = options;
  const expected = snapshots.map((snapshot) => projectScene(snapshot));
  return {
    stepScoreMismatchCount: compareBlock(
      steps,
      expected,
      (scene) => scene.scoreClock.score,
      "scoreClock.score",
      "sourceTruth.stepScoreMismatchCount",
      findings,
    ),
    stepClockMismatchCount: compareBlock(
      steps,
      expected,
      (scene) => scene.scoreClock.clock,
      "scoreClock.clock",
      "sourceTruth.stepClockMismatchCount",
      findings,
    ),
    stepPossessionMismatchCount: compareBlock(
      steps,
      expected,
      (scene) => scene.scoreClock.possession,
      "scoreClock.possession",
      "sourceTruth.stepPossessionMismatchCount",
      findings,
    ),
    stepEntityStateMismatchCount: compareBlock(
      steps,
      expected,
      (scene) => scene.entities,
      "entities",
      "sourceTruth.stepEntityStateMismatchCount",
      findings,
    ),
    stepSceneBlockMismatchCount:
      compareBlock(
        steps,
        expected,
        (scene) => scene.source,
        "source",
        "sourceTruth.stepSceneBlockMismatchCount",
        findings,
      ) +
      compareBlock(
        steps,
        expected,
        (scene) => scene.world,
        "world",
        "sourceTruth.stepSceneBlockMismatchCount",
        findings,
      ) +
      compareBlock(
        steps,
        expected,
        (scene) => scene.sessionId,
        "sessionId",
        "sourceTruth.stepSceneBlockMismatchCount",
        findings,
      ) +
      compareBlock(
        steps,
        expected,
        (scene) => scene.sceneSchemaVersion,
        "sceneSchemaVersion",
        "sourceTruth.stepSceneBlockMismatchCount",
        findings,
      ) +
      compareBlock(
        steps,
        expected,
        (scene) => scene.cameraSlots,
        "cameraSlots",
        "sourceTruth.stepSceneBlockMismatchCount",
        findings,
      ),
    stepCount: steps.length,
  };
}
