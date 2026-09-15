/**
 * The W605 scene-correctness thresholds and the machine-readable report
 * (deliverables 3 and 4).
 *
 * Every threshold is ZERO: the renderer under evaluation is a deterministic
 * pure function of its input documents (the W602/W603/W604 posture), so any
 * nonzero defect count — one wrong score claim, one swapped style token, one
 * unaccounted marker — is a real defect, never noise. There are no ratio
 * metrics and no tolerance bands: the evidence counters (frames checked,
 * entity-frame pairs, boundary crossings) report the measurement BASE, never
 * a pass credit. Each threshold's derivation is documented in
 * `packages/scene-evaluation/THRESHOLDS.md` and pinned row-for-row to this
 * module by `test/thresholds-doc.test.ts` (the W503 THRESHOLDS.md
 * convention); the injected-defect tests (`test/detection.test.ts`) prove
 * the teeth — a metric that cannot detect its defect class is rejected.
 *
 * {@link evaluateSceneOutput} assembles the whole measurement core over the
 * validated evaluation input:
 *
 * 1. layer 1 — the source-truth layer (`./truth.ts`): every step's scene
 *    vs the REAL W601 projection of its ground-truth snapshot;
 * 2. layer 2 — the five accept-criterion dimensions over the rendered
 *    frames: score + clock (`./scoreClock.ts`), identity continuity
 *    (`./identity.ts`), event ordering (`./ordering.ts`), scene state
 *    (`./sceneState.ts`), and direction consistency (`./direction.ts`,
 *    the directed half) — each derived through the renderer's OWN public
 *    seams (`./expected.ts`), never re-implemented;
 * 3. the verdict: per-dimension verdicts + the strict conjunction, every
 *    check carrying its measured value (the W503 report posture);
 * 4. the findings: the bounded, accounted evidence list (never silent —
 *    truncation beyond the cap is counted into the report).
 *
 * The report is validated against its zod schema before it is returned (a
 * report the evaluator itself cannot parse is an evaluator bug and throws —
 * never a silently degraded document). Determinism: the report is a pure
 * function of its input — no clock, no RNG, no I/O; two evaluations of the
 * same input are deep-equal AND byte-identical under canonical serialization
 * (pinned by tests).
 */
import { z } from "zod";
import type { CameraPlan } from "@sporta/camera-director";
import { FindingCollector } from "./findings";
import { measureDirection } from "./direction";
import type { DirectionMetrics } from "./direction";
import { frameExpectation } from "./expected";
import { measureIdentity } from "./identity";
import type { IdentityMetrics } from "./identity";
import { measureOrdering } from "./ordering";
import type { OrderingMetrics } from "./ordering";
import { measureClock, measureScore } from "./scoreClock";
import type { ClockMetrics, ScoreMetrics } from "./scoreClock";
import { measureSceneState } from "./sceneState";
import type { SceneStateMetrics } from "./sceneState";
import { measureSourceTruth } from "./truth";
import type { SourceTruthMetrics } from "./truth";
import { validateEvaluationInput } from "./validate";
import type { SceneEvaluationFinding } from "./findings";

/** The report schema tag (versioned with the report shape). */
export const REPORT_SCHEMA_TAG = "sporta/scene-evaluation/w605@1";

/** The maximum recorded findings (beyond it: accounted truncation). */
export const MAX_FINDINGS = 200;

/**
 * The W605 thresholds. Every defect count is 0 (see THRESHOLDS.md); the
 * evidence counters are NOT thresholds and never appear here.
 */
export const THRESHOLDS = {
  MAX_STEP_SCORE_MISMATCH_COUNT: 0,
  MAX_STEP_CLOCK_MISMATCH_COUNT: 0,
  MAX_STEP_POSSESSION_MISMATCH_COUNT: 0,
  MAX_STEP_ENTITY_STATE_MISMATCH_COUNT: 0,
  MAX_STEP_SCENE_BLOCK_MISMATCH_COUNT: 0,
  MAX_FRAME_CLAIM_MISMATCH_COUNT: 0,
  MAX_MID_SEGMENT_CLAIM_CHANGE_COUNT: 0,
  MAX_STYLE_TOKEN_DIVERGENCE_COUNT: 0,
  MAX_STYLE_TOKEN_INSTABILITY_COUNT: 0,
  MAX_ENTITY_IDENTITY_SWAP_COUNT: 0,
  MAX_ENTITY_KIND_CHANGE_COUNT: 0,
  MAX_ENTITY_STYLE_KIND_CHANGE_COUNT: 0,
  MAX_SANCTIONED_RESTYLE_COUNT: 0,
  MAX_STEP_MARKER_LOG_ORDER_VIOLATION_COUNT: 0,
  MAX_FRAME_MARKER_ORDER_VIOLATION_COUNT: 0,
  MAX_MARKER_FIELD_MISMATCH_COUNT: 0,
  MAX_MARKER_WINDOW_CONTAINMENT_VIOLATION_COUNT: 0,
  MAX_MARKER_DUPLICATE_DISPLAY_COUNT: 0,
  MAX_MARKER_CROSS_WINDOW_DUPLICATE_COUNT: 0,
  MAX_MARKER_UNACCOUNTED_COUNT: 0,
  MAX_BOUNDARY_TRANSFER_UNACCOUNTED_COUNT: 0,
  MAX_REVIEW_NOVEL_MARKER_COUNT: 0,
  MAX_MARKER_NOT_IN_UNION_DISPLAY_COUNT: 0,
  MAX_MARKER_DISPLAY_ACCOUNTING_MISMATCH_COUNT: 0,
  MAX_MARKER_SKIP_ACCOUNTING_MISMATCH_COUNT: 0,
  MAX_FRAME_INTERPOLATION_MISMATCH_COUNT: 0,
  MAX_INTERPOLATION_INDEX_MISMATCH_COUNT: 0,
  MAX_FRAME_ENTITY_SET_MISMATCH_COUNT: 0,
  MAX_FRAME_ENTITY_STATE_MISMATCH_COUNT: 0,
  MAX_DISPOSITION_MISMATCH_COUNT: 0,
  MAX_POSITION_MISMATCH_COUNT: 0,
  MAX_PROVENANCE_MISMATCH_COUNT: 0,
  MAX_BALL_HEIGHT_MISMATCH_COUNT: 0,
  MAX_POSSESSION_MISMATCH_COUNT: 0,
  MAX_FRAME_SLOT_MISMATCH_COUNT: 0,
  MAX_FRAME_CAMERA_LABEL_MISMATCH_COUNT: 0,
  MAX_WINDOW_SLOT_NOT_CARRIED_COUNT: 0,
  MAX_WINDOW_CAMERA_BLOCK_MISMATCH_COUNT: 0,
  MAX_REVIEW_PROFILE_MISMATCH_COUNT: 0,
  MAX_PLAN_WINDOW_MISMATCH_COUNT: 0,
  MAX_PLAN_PROVENANCE_MISMATCH_COUNT: 0,
} as const;

/** The thresholds' type (verbatim). */
export type Thresholds = typeof THRESHOLDS;

// ---------------------------------------------------------------------------
// The report shape
// ---------------------------------------------------------------------------

/** One threshold check with its measured evidence (all max-semantics). */
export interface SceneEvaluationCheck {
  /** The metric's report path (e.g. `identity.styleTokenDivergenceCount`). */
  metric: string;
  /** `"max"` — measured must be <= threshold (every W605 check is a cap). */
  operator: "max";
  /** The threshold value (from {@link THRESHOLDS}, documented in THRESHOLDS.md). */
  threshold: number;
  /** The measured value. */
  measured: number;
  pass: boolean;
}

/** One dimension's verdict (its checks, in fixed order). */
export interface DimensionVerdict {
  pass: boolean;
  /** The failing checks, in check order (empty when pass). */
  failures: SceneEvaluationCheck[];
  /** Every check with its measured value (the full evidence). */
  checks: SceneEvaluationCheck[];
}

/** The full W605 scene-correctness report. */
export interface SceneEvaluationReport {
  /** Report schema tag: `"sporta/scene-evaluation/w605@1"`. */
  schemaTag: string;
  /** What was measured and where it came from. */
  input: {
    /** `"match"` (one render3dMatch run) or `"directed"` (a W604 rundown). */
    mode: "match" | "directed";
    rendererId: string;
    rendererVersion: string;
    styleId: string;
    sessionId: string;
    /** The steps checked (layer 1's base). */
    stepCount: number;
    /** The rendered frames checked (layer 2's base). */
    frameCount: number;
    /** The directed windows (0 in match mode). */
    windowCount: number;
    /** The distinct markers of the whole match timeline (evidence). */
    markerCount: number;
    /** Whether the caller supplied the CameraPlan for plan-consistency. */
    planSupplied: boolean;
  };
  sourceTruth: SourceTruthMetrics;
  score: ScoreMetrics;
  clock: ClockMetrics;
  identity: IdentityMetrics;
  ordering: OrderingMetrics;
  sceneState: SceneStateMetrics;
  direction: DirectionMetrics;
  /** Per-dimension verdicts (every accept-criterion dimension, separately). */
  dimensions: {
    sourceTruth: DimensionVerdict;
    score: DimensionVerdict;
    clock: DimensionVerdict;
    identity: DimensionVerdict;
    ordering: DimensionVerdict;
    sceneState: DimensionVerdict;
    direction: DimensionVerdict;
  };
  /** The overall verdict: the strict conjunction of every check. */
  verdict: {
    pass: boolean;
    /** The failing checks across all dimensions, in dimension order. */
    failures: SceneEvaluationCheck[];
    /** Every check across all dimensions with its measured value. */
    checks: SceneEvaluationCheck[];
  };
  /** The bounded finding evidence (never silent: truncation is accounted). */
  findings: {
    entries: SceneEvaluationFinding[];
    truncated: boolean;
    dropped: number;
    cap: number;
  };
}

// ---------------------------------------------------------------------------
// The report's zod schema (machine-readable contract; validated on return)
// ---------------------------------------------------------------------------

const count = z.number().int().min(0);

const findingSchema = z.object({
  dimension: z.enum([
    "source-truth",
    "score",
    "clock",
    "identity",
    "ordering",
    "scene-state",
    "direction",
  ]),
  metric: z.string().min(1),
  stepIndex: z.number().int().min(0).optional(),
  frameIndex: z.number().int().min(0).optional(),
  windowIndex: z.number().int().min(0).optional(),
  entityId: z.string().min(1).optional(),
  path: z.string().min(1),
  expected: z.string(),
  actual: z.string(),
});

const checkSchema = z.object({
  metric: z.string().min(1),
  operator: z.literal("max"),
  threshold: z.number(),
  measured: z.number(),
  pass: z.boolean(),
});

const dimensionVerdictSchema = z.object({
  pass: z.boolean(),
  failures: z.array(checkSchema),
  checks: z.array(checkSchema),
});

/** The zod schema of the whole report (pinned to the TypeScript shape). */
export const SceneEvaluationReportSchema = z.object({
  schemaTag: z.literal(REPORT_SCHEMA_TAG),
  input: z.object({
    mode: z.enum(["match", "directed"]),
    rendererId: z.string().min(1),
    rendererVersion: z.string().min(1),
    styleId: z.string().min(1),
    sessionId: z.string().min(1),
    stepCount: count,
    frameCount: count,
    windowCount: count,
    markerCount: count,
    planSupplied: z.boolean(),
  }),
  sourceTruth: z.object({
    stepScoreMismatchCount: count,
    stepClockMismatchCount: count,
    stepPossessionMismatchCount: count,
    stepEntityStateMismatchCount: count,
    stepSceneBlockMismatchCount: count,
    stepCount: count,
  }),
  score: z.object({
    frameClaimMismatchCount: count,
    stepScoreMismatchCount: count,
    frameCount: count,
  }),
  clock: z.object({
    frameClaimMismatchCount: count,
    stepClockMismatchCount: count,
    midSegmentClaimChangeCount: count,
    boundaryClaimAdvanceCount: count,
    frameCount: count,
  }),
  identity: z.object({
    identityStyledEntityCount: count,
    tokenFrameCount: count,
    styleTokenDivergenceCount: count,
    styleTokenInstabilityCount: count,
    entityIdentitySwapCount: count,
    entityKindChangeCount: count,
    entityStyleKindChangeCount: count,
    sanctionedRestyleCount: count,
    entityCount: count,
  }),
  ordering: z.object({
    stepMarkerLogOrderViolationCount: count,
    frameMarkerOrderViolationCount: count,
    markerFieldMismatchCount: count,
    markerWindowContainmentViolationCount: count,
    markerDuplicateDisplayCount: count,
    markerCrossWindowDuplicateCount: count,
    markerUnaccountedCount: count,
    boundaryTransferUnaccountedCount: count,
    reviewNovelMarkerCount: count,
    markerNotInUnionDisplayCount: count,
    markerDisplayAccountingMismatchCount: count,
    markerSkipAccountingMismatchCount: count,
    markerCount: count,
  }),
  sceneState: z.object({
    frameInterpolationMismatchCount: count,
    interpolationIndexMismatchCount: count,
    frameEntitySetMismatchCount: count,
    frameEntityStateMismatchCount: count,
    dispositionMismatchCount: count,
    positionMismatchCount: count,
    provenanceMismatchCount: count,
    ballHeightMismatchCount: count,
    possessionMismatchCount: count,
    entityFrameCount: count,
    frameCount: count,
  }),
  direction: z.object({
    frameSlotMismatchCount: count,
    frameCameraLabelMismatchCount: count,
    windowSlotNotCarriedCount: count,
    windowCameraBlockMismatchCount: count,
    reviewProfileMismatchCount: count,
    planWindowMismatchCount: count,
    planProvenanceMismatchCount: count,
    windowCount: count,
  }),
  dimensions: z.object({
    sourceTruth: dimensionVerdictSchema,
    score: dimensionVerdictSchema,
    clock: dimensionVerdictSchema,
    identity: dimensionVerdictSchema,
    ordering: dimensionVerdictSchema,
    sceneState: dimensionVerdictSchema,
    direction: dimensionVerdictSchema,
  }),
  verdict: z.object({
    pass: z.boolean(),
    failures: z.array(checkSchema),
    checks: z.array(checkSchema),
  }),
  findings: z.object({
    entries: z.array(findingSchema),
    truncated: z.boolean(),
    dropped: count,
    cap: count,
  }),
});

// Compile-time pins: the zod schema must accept exactly the report shape.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ReportSchemaPin = z.ZodType<SceneEvaluationReport>;

/** Builds one threshold check (max semantics: measured <= threshold). */
function maxCheck(metric: string, threshold: number, measured: number): SceneEvaluationCheck {
  return { metric, operator: "max", threshold, measured, pass: measured <= threshold };
}

/** Builds one dimension's verdict from its checks. */
function verdictOf(checks: SceneEvaluationCheck[]): DimensionVerdict {
  return {
    pass: checks.every((check) => check.pass),
    failures: checks.filter((check) => !check.pass),
    checks,
  };
}

/** The evaluator input: the ground-truth documents + the rendered output. */
export interface SceneEvaluationInput {
  /** One SWM snapshot per step (the ground truth; W402 `stateAt` output). */
  snapshots: unknown;
  /** The SWM's event log, in log order (the ordering ground truth). */
  eventStream: unknown;
  /** The render's own input steps (what `render3dMatch` consumed). */
  steps: unknown;
  /** The rendered output (`AvatarField3dRenderOutput` or `DirectedRenderOutput`). */
  output: unknown;
  /**
   * The W604 `CameraPlan` the rundown was composed from, when available.
   * When supplied, the direction dimension checks the manifest's windows +
   * director provenance against it VERBATIM; when absent those checks are
   * vacuous and the report records `planSupplied: false` (never a silent
   * claim). Match-mode outputs need no plan.
   */
  plan?: CameraPlan;
}

/**
 * Evaluates the scene correctness of one rendered 3D output. Pure and
 * deterministic: the same input yields a byte-identical report on every
 * call. Throws {@link SceneEvaluationError} on structurally malformed input
 * (fail-loud, never a silent skip) and `RangeError` if the evaluator itself
 * produced a report its own schema rejects (an evaluator bug, never an
 * input problem).
 */
export function evaluateSceneOutput(input: SceneEvaluationInput): SceneEvaluationReport {
  const validated = validateEvaluationInput(input);
  const findings = new FindingCollector(MAX_FINDINGS);
  const frames = validated.frames;
  const expectations = frames.map((frame) => frameExpectation(validated, frame));

  const sourceTruth = measureSourceTruth({
    snapshots: validated.snapshots,
    steps: validated.steps,
    findings,
  });
  const identity = measureIdentity({ input: validated, frames, expectations, findings });
  const score = measureScore({
    input: validated,
    frames,
    expectations,
    stepScoreMismatchCount: sourceTruth.stepScoreMismatchCount,
    findings,
  });
  const clock = measureClock({
    input: validated,
    frames,
    expectations,
    stepClockMismatchCount: sourceTruth.stepClockMismatchCount,
    findings,
  });
  const ordering = measureOrdering({ input: validated, findings });
  const sceneState = measureSceneState({ input: validated, frames, expectations, findings });
  const direction = measureDirection({
    input: validated,
    frames,
    expectations,
    plan: validated.plan,
    findings,
  });

  const dimensions = {
    sourceTruth: verdictOf([
      maxCheck(
        "sourceTruth.stepScoreMismatchCount",
        THRESHOLDS.MAX_STEP_SCORE_MISMATCH_COUNT,
        sourceTruth.stepScoreMismatchCount,
      ),
      maxCheck(
        "sourceTruth.stepClockMismatchCount",
        THRESHOLDS.MAX_STEP_CLOCK_MISMATCH_COUNT,
        sourceTruth.stepClockMismatchCount,
      ),
      maxCheck(
        "sourceTruth.stepPossessionMismatchCount",
        THRESHOLDS.MAX_STEP_POSSESSION_MISMATCH_COUNT,
        sourceTruth.stepPossessionMismatchCount,
      ),
      maxCheck(
        "sourceTruth.stepEntityStateMismatchCount",
        THRESHOLDS.MAX_STEP_ENTITY_STATE_MISMATCH_COUNT,
        sourceTruth.stepEntityStateMismatchCount,
      ),
      maxCheck(
        "sourceTruth.stepSceneBlockMismatchCount",
        THRESHOLDS.MAX_STEP_SCENE_BLOCK_MISMATCH_COUNT,
        sourceTruth.stepSceneBlockMismatchCount,
      ),
    ]),
    score: verdictOf([
      maxCheck(
        "score.frameClaimMismatchCount",
        THRESHOLDS.MAX_FRAME_CLAIM_MISMATCH_COUNT,
        score.frameClaimMismatchCount,
      ),
      maxCheck(
        "score.stepScoreMismatchCount",
        THRESHOLDS.MAX_STEP_SCORE_MISMATCH_COUNT,
        score.stepScoreMismatchCount,
      ),
    ]),
    clock: verdictOf([
      maxCheck(
        "clock.frameClaimMismatchCount",
        THRESHOLDS.MAX_FRAME_CLAIM_MISMATCH_COUNT,
        clock.frameClaimMismatchCount,
      ),
      maxCheck(
        "clock.stepClockMismatchCount",
        THRESHOLDS.MAX_STEP_CLOCK_MISMATCH_COUNT,
        clock.stepClockMismatchCount,
      ),
      maxCheck(
        "clock.midSegmentClaimChangeCount",
        THRESHOLDS.MAX_MID_SEGMENT_CLAIM_CHANGE_COUNT,
        clock.midSegmentClaimChangeCount,
      ),
    ]),
    identity: verdictOf([
      maxCheck(
        "identity.styleTokenDivergenceCount",
        THRESHOLDS.MAX_STYLE_TOKEN_DIVERGENCE_COUNT,
        identity.styleTokenDivergenceCount,
      ),
      maxCheck(
        "identity.styleTokenInstabilityCount",
        THRESHOLDS.MAX_STYLE_TOKEN_INSTABILITY_COUNT,
        identity.styleTokenInstabilityCount,
      ),
      maxCheck(
        "identity.entityIdentitySwapCount",
        THRESHOLDS.MAX_ENTITY_IDENTITY_SWAP_COUNT,
        identity.entityIdentitySwapCount,
      ),
      maxCheck(
        "identity.entityKindChangeCount",
        THRESHOLDS.MAX_ENTITY_KIND_CHANGE_COUNT,
        identity.entityKindChangeCount,
      ),
      maxCheck(
        "identity.entityStyleKindChangeCount",
        THRESHOLDS.MAX_ENTITY_STYLE_KIND_CHANGE_COUNT,
        identity.entityStyleKindChangeCount,
      ),
      maxCheck(
        "identity.sanctionedRestyleCount",
        THRESHOLDS.MAX_SANCTIONED_RESTYLE_COUNT,
        identity.sanctionedRestyleCount,
      ),
    ]),
    ordering: verdictOf([
      maxCheck(
        "ordering.stepMarkerLogOrderViolationCount",
        THRESHOLDS.MAX_STEP_MARKER_LOG_ORDER_VIOLATION_COUNT,
        ordering.stepMarkerLogOrderViolationCount,
      ),
      maxCheck(
        "ordering.frameMarkerOrderViolationCount",
        THRESHOLDS.MAX_FRAME_MARKER_ORDER_VIOLATION_COUNT,
        ordering.frameMarkerOrderViolationCount,
      ),
      maxCheck(
        "ordering.markerFieldMismatchCount",
        THRESHOLDS.MAX_MARKER_FIELD_MISMATCH_COUNT,
        ordering.markerFieldMismatchCount,
      ),
      maxCheck(
        "ordering.markerWindowContainmentViolationCount",
        THRESHOLDS.MAX_MARKER_WINDOW_CONTAINMENT_VIOLATION_COUNT,
        ordering.markerWindowContainmentViolationCount,
      ),
      maxCheck(
        "ordering.markerDuplicateDisplayCount",
        THRESHOLDS.MAX_MARKER_DUPLICATE_DISPLAY_COUNT,
        ordering.markerDuplicateDisplayCount,
      ),
      maxCheck(
        "ordering.markerCrossWindowDuplicateCount",
        THRESHOLDS.MAX_MARKER_CROSS_WINDOW_DUPLICATE_COUNT,
        ordering.markerCrossWindowDuplicateCount,
      ),
      maxCheck(
        "ordering.markerUnaccountedCount",
        THRESHOLDS.MAX_MARKER_UNACCOUNTED_COUNT,
        ordering.markerUnaccountedCount,
      ),
      maxCheck(
        "ordering.boundaryTransferUnaccountedCount",
        THRESHOLDS.MAX_BOUNDARY_TRANSFER_UNACCOUNTED_COUNT,
        ordering.boundaryTransferUnaccountedCount,
      ),
      maxCheck(
        "ordering.reviewNovelMarkerCount",
        THRESHOLDS.MAX_REVIEW_NOVEL_MARKER_COUNT,
        ordering.reviewNovelMarkerCount,
      ),
      maxCheck(
        "ordering.markerNotInUnionDisplayCount",
        THRESHOLDS.MAX_MARKER_NOT_IN_UNION_DISPLAY_COUNT,
        ordering.markerNotInUnionDisplayCount,
      ),
      maxCheck(
        "ordering.markerDisplayAccountingMismatchCount",
        THRESHOLDS.MAX_MARKER_DISPLAY_ACCOUNTING_MISMATCH_COUNT,
        ordering.markerDisplayAccountingMismatchCount,
      ),
      maxCheck(
        "ordering.markerSkipAccountingMismatchCount",
        THRESHOLDS.MAX_MARKER_SKIP_ACCOUNTING_MISMATCH_COUNT,
        ordering.markerSkipAccountingMismatchCount,
      ),
    ]),
    sceneState: verdictOf([
      maxCheck(
        "sceneState.frameInterpolationMismatchCount",
        THRESHOLDS.MAX_FRAME_INTERPOLATION_MISMATCH_COUNT,
        sceneState.frameInterpolationMismatchCount,
      ),
      maxCheck(
        "sceneState.interpolationIndexMismatchCount",
        THRESHOLDS.MAX_INTERPOLATION_INDEX_MISMATCH_COUNT,
        sceneState.interpolationIndexMismatchCount,
      ),
      maxCheck(
        "sceneState.frameEntitySetMismatchCount",
        THRESHOLDS.MAX_FRAME_ENTITY_SET_MISMATCH_COUNT,
        sceneState.frameEntitySetMismatchCount,
      ),
      maxCheck(
        "sceneState.frameEntityStateMismatchCount",
        THRESHOLDS.MAX_FRAME_ENTITY_STATE_MISMATCH_COUNT,
        sceneState.frameEntityStateMismatchCount,
      ),
      maxCheck(
        "sceneState.dispositionMismatchCount",
        THRESHOLDS.MAX_DISPOSITION_MISMATCH_COUNT,
        sceneState.dispositionMismatchCount,
      ),
      maxCheck(
        "sceneState.positionMismatchCount",
        THRESHOLDS.MAX_POSITION_MISMATCH_COUNT,
        sceneState.positionMismatchCount,
      ),
      maxCheck(
        "sceneState.provenanceMismatchCount",
        THRESHOLDS.MAX_PROVENANCE_MISMATCH_COUNT,
        sceneState.provenanceMismatchCount,
      ),
      maxCheck(
        "sceneState.ballHeightMismatchCount",
        THRESHOLDS.MAX_BALL_HEIGHT_MISMATCH_COUNT,
        sceneState.ballHeightMismatchCount,
      ),
      maxCheck(
        "sceneState.possessionMismatchCount",
        THRESHOLDS.MAX_POSSESSION_MISMATCH_COUNT,
        sceneState.possessionMismatchCount,
      ),
    ]),
    direction: verdictOf([
      maxCheck(
        "direction.frameSlotMismatchCount",
        THRESHOLDS.MAX_FRAME_SLOT_MISMATCH_COUNT,
        direction.frameSlotMismatchCount,
      ),
      maxCheck(
        "direction.frameCameraLabelMismatchCount",
        THRESHOLDS.MAX_FRAME_CAMERA_LABEL_MISMATCH_COUNT,
        direction.frameCameraLabelMismatchCount,
      ),
      maxCheck(
        "direction.windowSlotNotCarriedCount",
        THRESHOLDS.MAX_WINDOW_SLOT_NOT_CARRIED_COUNT,
        direction.windowSlotNotCarriedCount,
      ),
      maxCheck(
        "direction.windowCameraBlockMismatchCount",
        THRESHOLDS.MAX_WINDOW_CAMERA_BLOCK_MISMATCH_COUNT,
        direction.windowCameraBlockMismatchCount,
      ),
      maxCheck(
        "direction.reviewProfileMismatchCount",
        THRESHOLDS.MAX_REVIEW_PROFILE_MISMATCH_COUNT,
        direction.reviewProfileMismatchCount,
      ),
      maxCheck(
        "direction.planWindowMismatchCount",
        THRESHOLDS.MAX_PLAN_WINDOW_MISMATCH_COUNT,
        direction.planWindowMismatchCount,
      ),
      maxCheck(
        "direction.planProvenanceMismatchCount",
        THRESHOLDS.MAX_PLAN_PROVENANCE_MISMATCH_COUNT,
        direction.planProvenanceMismatchCount,
      ),
    ]),
  };

  const checks = [
    ...dimensions.sourceTruth.checks,
    ...dimensions.score.checks,
    ...dimensions.clock.checks,
    ...dimensions.identity.checks,
    ...dimensions.ordering.checks,
    ...dimensions.sceneState.checks,
    ...dimensions.direction.checks,
  ];

  const renderer = validated.manifest.renderer;
  const report: SceneEvaluationReport = {
    schemaTag: REPORT_SCHEMA_TAG,
    input: {
      mode: validated.mode,
      rendererId: renderer.rendererId,
      rendererVersion: renderer.rendererVersion,
      styleId: renderer.styleId,
      sessionId: validated.snapshots[0]!.sessionId,
      stepCount: validated.steps.length,
      frameCount: frames.length,
      windowCount:
        validated.mode === "directed"
          ? (validated.manifest as { windows: unknown[] }).windows.length
          : 0,
      markerCount: ordering.markerCount,
      planSupplied: validated.plan !== undefined,
    },
    sourceTruth,
    score,
    clock,
    identity,
    ordering,
    sceneState,
    direction,
    dimensions,
    verdict: {
      pass: checks.every((check) => check.pass),
      failures: checks.filter((check) => !check.pass),
      checks,
    },
    findings: {
      entries: [...findings.list()],
      truncated: findings.wasTruncated(),
      dropped: findings.droppedCount(),
      cap: MAX_FINDINGS,
    },
  };

  const parsed = SceneEvaluationReportSchema.safeParse(report);
  if (!parsed.success) {
    // An evaluator bug: the report it just built does not satisfy its own
    // machine-readable contract. Never returned, never degraded.
    throw new RangeError(
      `evaluateSceneOutput: the assembled report failed its own schema — ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return report;
}
