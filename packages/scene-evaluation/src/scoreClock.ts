/**
 * The SCORE and CLOCK dimensions (W605 deliverables 1 and 2).
 *
 * What the renderer claims, per frame, is the HUD STATUS LINE — the fixed
 * template over the scene's `scoreClock` block (the only score/clock claim
 * surface in the render manifest). The expectation is derived through the
 * renderer's own exported `statusLine` over the frame's AUTHORITATIVE scene
 * (the from-step's block — interpolated frames hold the last-known state by
 * the W603 contract), which layer 1 pinned to the SWM's own documents.
 *
 * Two measured disciplines:
 *
 * - **Claim correctness**: `hud.statusLine === statusLine(authoritative
 *   scoreClock)` on EVERY frame. A wrong score, a wrong clock, a wrong
 *   period/stoppage mark, or an unestablished score shown — any divergence
 *   of the rendered claim from the source timeline's state — mismatches.
 *   The status line is a COMBINED claim: a mismatch indicts BOTH the score
 *   and the clock dimension (never a false pass; attribution to one part
 *   would require parsing the formatted string, which would re-implement
 *   the renderer's presentation — the structured attribution lives one
 *   level up, in the source-truth layer's separate score/clock block
 *   comparisons).
 * - **Advance discipline** (the W603 contract, verified not assumed): the
 *   clock/score display state advances ONLY at snapshot boundaries. Within
 *   one authority segment (consecutive frames sharing the same from-step
 *   AND the same directed window), the claim is CONSTANT — a clock ticked
 *   by frame time, or a score that changes mid-segment, is a defect even
 *   when both endpoints happen to be plausible.
 */
import type { EvalFrame, ValidatedSceneEvaluationInput } from "./validate";
import type { FrameExpectation } from "./expected";
import type { FindingSink, SceneEvaluationFinding } from "./findings";
import { frameFinding } from "./findings";
import { describeValue } from "./internal";

/** The score dimension's measured metrics. */
export interface ScoreMetrics {
  /** Frames whose status line ≠ the authoritative scene's (combined claim — see module docblock). */
  frameClaimMismatchCount: number;
  /** Steps whose score block ≠ the SWM projection's (the structured score ground truth). */
  stepScoreMismatchCount: number;
  /** Frames checked (evidence). */
  frameCount: number;
}

/** The clock dimension's measured metrics. */
export interface ClockMetrics {
  /** Frames whose status line ≠ the authoritative scene's (combined claim — see module docblock). */
  frameClaimMismatchCount: number;
  /** Steps whose clock block ≠ the SWM projection's (the structured clock ground truth). */
  stepClockMismatchCount: number;
  /** Consecutive same-segment frame pairs whose claim CHANGED mid-segment (the W603 advance discipline). */
  midSegmentClaimChangeCount: number;
  /** Boundary crossings where the claim advanced (evidence: the clock DID move, at boundaries). */
  boundaryClaimAdvanceCount: number;
  /** Frames checked (evidence). */
  frameCount: number;
}

/** Measures the per-frame claim checks shared by both dimensions. */
function measureClaims(
  frames: readonly EvalFrame[],
  expectations: readonly FrameExpectation[],
  findings: FindingSink,
  metric: string,
  dimension: "score" | "clock",
): number {
  let mismatches = 0;
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    const actual = frame.entry.hud.statusLine;
    const expected = expectations[i]!.expectedStatusLine;
    if (actual !== expected) {
      mismatches += 1;
      findings.push(
        frameFinding(frame, {
          dimension,
          metric,
          path: `$.output.manifest.frames[${frame.frameIndex}].entry.hud.statusLine`,
          expected: describeValue(expected),
          actual: describeValue(actual),
        }),
      );
    }
  }
  return mismatches;
}

/**
 * Measures the advance discipline: within one authority segment the claim
 * is constant; across boundaries it may change. Returns the mid-segment
 * change count and the boundary advance count (evidence).
 */
function measureAdvanceDiscipline(
  frames: readonly EvalFrame[],
  expectations: readonly FrameExpectation[],
  findings: FindingSink,
): { midSegmentClaimChangeCount: number; boundaryClaimAdvanceCount: number } {
  let midSegmentChanges = 0;
  let boundaryAdvances = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1]!;
    const current = frames[i]!;
    const previousExpectation = expectations[i - 1]!;
    const currentExpectation = expectations[i]!;
    const sameSegment =
      previous.windowIndex === current.windowIndex &&
      previousExpectation.fromStepIndex === currentExpectation.fromStepIndex;
    const previousClaim = previous.entry.hud.statusLine;
    const currentClaim = current.entry.hud.statusLine;
    if (previousClaim === currentClaim) continue;
    if (sameSegment) {
      midSegmentChanges += 1;
      findings.push(
        frameFinding(current, {
          dimension: "clock",
          metric: "clock.midSegmentClaimChangeCount",
          path: `$.output.manifest.frames[${current.frameIndex}].entry.hud.statusLine`,
          expected: describeValue(previousClaim),
          actual: describeValue(currentClaim),
        }),
      );
    } else {
      boundaryAdvances += 1;
    }
  }
  return { midSegmentClaimChangeCount: midSegmentChanges, boundaryClaimAdvanceCount: boundaryAdvances };
}

/** Measures the score dimension (the frame claim + the layer-1 step counts). */
export function measureScore(options: {
  input: ValidatedSceneEvaluationInput;
  frames: readonly EvalFrame[];
  expectations: readonly FrameExpectation[];
  stepScoreMismatchCount: number;
  findings: FindingSink;
}): ScoreMetrics {
  const { frames, expectations, stepScoreMismatchCount, findings } = options;
  return {
    frameClaimMismatchCount: measureClaims(
      frames,
      expectations,
      findings,
      "score.frameClaimMismatchCount",
      "score",
    ),
    stepScoreMismatchCount,
    frameCount: frames.length,
  };
}

/** Measures the clock dimension (claims + advance discipline + layer-1 counts). */
export function measureClock(options: {
  input: ValidatedSceneEvaluationInput;
  frames: readonly EvalFrame[];
  expectations: readonly FrameExpectation[];
  stepClockMismatchCount: number;
  findings: FindingSink;
}): ClockMetrics {
  const { frames, expectations, stepClockMismatchCount, findings } = options;
  const claims = measureClaims(
    frames,
    expectations,
    findings,
    "clock.frameClaimMismatchCount",
    "clock",
  );
  const advance = measureAdvanceDiscipline(frames, expectations, findings);
  return {
    frameClaimMismatchCount: claims,
    stepClockMismatchCount,
    midSegmentClaimChangeCount: advance.midSegmentClaimChangeCount,
    boundaryClaimAdvanceCount: advance.boundaryClaimAdvanceCount,
    frameCount: frames.length,
  };
}
