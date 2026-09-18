/**
 * The degradation ledger (R207 hard rule): a typed, append-only
 * {@link PipelineStageRecord} per pipeline stage — decode, detect, track,
 * ball, calibrate, team, bridge, fuse, emit — carrying frame counts in/out,
 * confidence summaries, and EVERY degradation (dropped frames, fallbacks,
 * candidate-unavailable events, refusals). NO silent skips: a stage that
 * degrades says so in its record, and the pipeline result carries the full
 * ledger.
 *
 * DETERMINISM: records are plain JSON-safe data with no clock and no
 * randomness; every list is either in deterministic production order or
 * explicitly sorted. The ledger serializes canonically (see `canonical.ts`)
 * and is part of the replayable reconstruction artifact.
 */

/** The pipeline stages, in the documented execution order. */
export const PIPELINE_STAGE_IDS = [
  "decode",
  "detect",
  "track",
  "ball",
  "calibrate",
  "team",
  "bridge",
  "fuse",
  "emit",
] as const;
export type PipelineStageId = (typeof PIPELINE_STAGE_IDS)[number];

/**
 * The degradation kinds the ledger records. Each is a typed, honest
 * statement about what the pipeline did NOT get — never a silent skip.
 */
export const DEGRADATION_KINDS = [
  /** A configured candidate could not run (weights/backend missing). */
  "candidate-unavailable",
  /** The pipeline fell back to a later candidate in the chain. */
  "candidate-fallback",
  /** A candidate refused the input with a documented failure class. */
  "candidate-refused",
  /** Frames that produced no output at this stage. */
  "frame-without-output",
  /** Tracks dropped by the minimum-lifetime gate. */
  "short-track-dropped",
  /** Calibration unavailable: every candidate in the chain refused. */
  "calibration-unavailable",
  /** Detection density outside the plausible-player envelope (off-envelope). */
  "off-envelope-detection",
  /** Ball points interpolated across occlusion (not observed). */
  "interpolated-ball-point",
  /** A projected point was off-pitch (out of the canonical pitch bounds). */
  "off-pitch-projection",
  /** Raw detection observations not bridged (config default; summarized). */
  "detection-observations-not-bridged",
  /** Football state initialized with no-evidence defaults. */
  "football-state-defaults",
  /** Event-candidate semantics unavailable (e.g. possession needs pitch). */
  "event-semantics-unavailable",
] as const;
export type DegradationKind = (typeof DEGRADATION_KINDS)[number];

/** One degradation entry: what kind, how much, and the deterministic why. */
export interface DegradationEntry {
  readonly kind: DegradationKind;
  /** How many frames/items the degradation covers (>= 1). */
  readonly count: number;
  /** Deterministic human-readable explanation (no timestamps, no rng). */
  readonly detail: string;
  /**
   * Bounded evidence list (frame ids, track ids, or observation ids) —
   * capped by the stage writer, always in deterministic order.
   */
  readonly evidence?: readonly string[];
}

/** Min/mean/max confidence summary over one stage's outputs. */
export interface ConfidenceSummary {
  /** Number of confidence-carrying outputs summarized. */
  readonly count: number;
  readonly min: number;
  readonly mean: number;
  readonly max: number;
}

/** One candidate the stage attempted, and how that attempt ended. */
export interface AttemptedCandidate {
  /** The candidate's stable technology id (adapter plane). */
  readonly technologyId: string;
  /** The candidate's adapter version. */
  readonly adapterVersion: string;
  /** `used` — the candidate produced this stage's output. */
  readonly outcome: "used" | "unavailable" | "refused";
  /**
   * For `unavailable`/`refused`: the candidate's own documented failure
   * class id (e.g. `model-backed.inference-backend-not-wired`,
   * `line-based.no-pitch-visible`) — verbatim, never paraphrased.
   */
  readonly failureClassId?: string;
}

/** The typed, append-only record of one pipeline stage. */
export interface PipelineStageRecord {
  /** The stage id (execution order = array order in the ledger). */
  readonly stage: PipelineStageId;
  /** 1-based execution order of this stage. */
  readonly order: number;
  /** Frames that entered the stage. */
  readonly framesIn: number;
  /** Frames the stage produced output for. */
  readonly framesOut: number;
  /** Non-frame items the stage emitted (observations, events, snapshots). */
  readonly itemsOut: number;
  /** The ordered candidate chain this stage attempted (perception stages). */
  readonly attempted: readonly AttemptedCandidate[];
  /** Confidence summary over the stage's outputs (omitted when none). */
  readonly confidence?: ConfidenceSummary;
  /** Every degradation this stage recorded (append-only, in order). */
  readonly degradations: readonly DegradationEntry[];
  /** Deterministic stage notes (documented behavior, not warnings). */
  readonly notes: readonly string[];
}

/** Aggregate degradation counts by kind (sorted by kind for determinism). */
export interface DegradationCount {
  readonly kind: DegradationKind;
  readonly count: number;
}

/** The full ledger carried by the pipeline result and the artifact. */
export interface DegradationLedger {
  /** One record per stage, in execution order. */
  readonly stages: readonly PipelineStageRecord[];
  /** Total degradations per kind, sorted by kind. */
  readonly summary: readonly DegradationCount[];
  /** Total degradation entries across all stages. */
  readonly totalEntries: number;
}

/** Maximum length of a degradation entry's evidence list. */
export const DEGRADATION_EVIDENCE_LIMIT = 20;

/**
 * Computes a confidence summary over `values` (in the caller's deterministic
 * production order). Returns `undefined` for an empty list — a stage with no
 * confidence-carrying outputs carries no summary rather than an invented 0.
 */
export function summarizeConfidence(values: readonly number[]): ConfidenceSummary | undefined {
  if (values.length === 0) return undefined;
  let min = values[0]!;
  let max = values[0]!;
  let sum = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return { count: values.length, min, mean: sum / values.length, max };
}

/**
 * Builds the ledger summary from stage records: per-kind entry counts
 * (an entry's `count` field aggregates frames/items; the summary counts
 * ENTRIES per kind, plus a separate `totalEntries`).
 */
export function buildLedgerSummary(stages: readonly PipelineStageRecord[]): {
  summary: DegradationCount[];
  totalEntries: number;
} {
  const byKind = new Map<DegradationKind, number>();
  let totalEntries = 0;
  for (const stage of stages) {
    for (const entry of stage.degradations) {
      totalEntries += 1;
      byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
    }
  }
  const summary: DegradationCount[] = [...byKind.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  return { summary, totalEntries };
}

/**
 * Assembles the final ledger from stage records (execution order preserved;
 * summary derived). Pure function of the records.
 */
export function buildLedger(stages: readonly PipelineStageRecord[]): DegradationLedger {
  const { summary, totalEntries } = buildLedgerSummary(stages);
  return { stages: [...stages], summary, totalEntries };
}

/**
 * Mutable stage-record builder used inside the pipeline: append-only by
 * construction (no removal, no mutation of appended entries), frozen into a
 * `PipelineStageRecord` on completion.
 */
export class StageRecordBuilder {
  private readonly degradations: DegradationEntry[] = [];
  private readonly notes: string[] = [];
  private readonly attempted: AttemptedCandidate[] = [];

  constructor(
    readonly stage: PipelineStageId,
    readonly order: number,
  ) {}

  /** Records one attempted candidate outcome (append-only). */
  attempt(entry: AttemptedCandidate): void {
    this.attempted.push(entry);
  }

  /** Records one degradation entry (append-only). */
  degrade(
    kind: DegradationKind,
    count: number,
    detail: string,
    evidence?: readonly string[],
  ): void {
    this.degradations.push({
      kind,
      count,
      detail,
      ...(evidence !== undefined && evidence.length > 0
        ? { evidence: evidence.slice(0, DEGRADATION_EVIDENCE_LIMIT) }
        : {}),
    });
  }

  /** Records one deterministic note (append-only). */
  note(text: string): void {
    this.notes.push(text);
  }

  /** Freezes the record. */
  build(
    framesIn: number,
    framesOut: number,
    itemsOut: number,
    confidence?: ConfidenceSummary,
  ): PipelineStageRecord {
    return Object.freeze({
      stage: this.stage,
      order: this.order,
      framesIn,
      framesOut,
      itemsOut,
      attempted: Object.freeze([...this.attempted]),
      ...(confidence !== undefined ? { confidence } : {}),
      degradations: Object.freeze([...this.degradations]),
      notes: Object.freeze([...this.notes]),
    });
  }
}
