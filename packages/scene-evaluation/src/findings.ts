/**
 * The shared finding record: every measured mismatch, any dimension —
 * the report's evidence (never silent, bounded and accounted).
 */
import type { EvalFrame } from "./validate";

/**
 * One measured defect: the dimension, the metric it counted into, where it
 * happened (frame/step/window/entity coordinates), the JSON path, and the
 * expected vs actual values (bounded strings — evidence, not payload).
 */
export interface SceneEvaluationFinding {
  /** The dimension the finding counts into (`"score"`, `"identity"`, …). */
  dimension:
    "source-truth" | "score" | "clock" | "identity" | "ordering" | "scene-state" | "direction";
  /** The metric's report path (e.g. `identity.styleTokenDivergenceCount`). */
  metric: string;
  /** The finding's step index (source-truth findings only). */
  stepIndex?: number;
  /** The finding's frame index (frame-level findings). */
  frameIndex?: number;
  /** The finding's directed window index (directed findings). */
  windowIndex?: number;
  /** The finding's entity id (entity-level findings). */
  entityId?: string;
  /** The JSON path of the offending value. */
  path: string;
  /** The ground-truth value (bounded serialization). */
  expected: string;
  /** The rendered value (bounded serialization). */
  actual: string;
}

/** The bounded finding collector (never silent: truncation is accounted). */
export class FindingCollector implements FindingSink {
  private readonly findings: SceneEvaluationFinding[] = [];
  private truncated = false;
  private dropped = 0;

  constructor(private readonly max: number) {}

  /** Records one finding (accounted truncation beyond the cap). */
  push(finding: SceneEvaluationFinding): void {
    if (this.findings.length >= this.max) {
      this.truncated = true;
      this.dropped += 1;
      return;
    }
    this.findings.push(finding);
  }

  /** The recorded findings (in recording order — deterministic). */
  list(): readonly SceneEvaluationFinding[] {
    return this.findings;
  }

  /** Whether findings beyond the cap were dropped (never silent). */
  wasTruncated(): boolean {
    return this.truncated;
  }

  /** How many findings were dropped beyond the cap (0 when not truncated). */
  droppedCount(): number {
    return this.dropped;
  }
}

/**
 * Where measurements record their findings: a plain array satisfies this,
 * and so does {@link FindingCollector} (the report's bounded sink).
 */
export interface FindingSink {
  push(finding: SceneEvaluationFinding): void;
}

/** Builds a frame-level finding path with the frame's coordinates prefilled. */
export function frameFinding(
  frame: EvalFrame,
  fields: Omit<SceneEvaluationFinding, "frameIndex" | "windowIndex">,
): SceneEvaluationFinding {
  return {
    frameIndex: frame.frameIndex,
    ...(frame.windowIndex === null ? {} : { windowIndex: frame.windowIndex }),
    ...fields,
  };
}
