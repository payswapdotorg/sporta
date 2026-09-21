/**
 * THE FUSION REPORT (L012 design D7) — the honest per-drain multi-source
 * accounting: JSON-safe, deterministic (no clock reads, no RNG — the render
 * clock is INJECTED per call), the §9 telemetry surface for the multi-source
 * stage.
 *
 * LAYERS NEVER DOUBLE-COUNTED: the per-source L004 counters ride VERBATIM
 * (they are that engine's own accounting); the L003 per-batch reports ride
 * VERBATIM; the fusion layer adds ONLY its own counters on top (withheld
 * rows, conflicts, corroborations, suppressed batches, source
 * losses/recoveries) — each counted exactly once, at the layer that owns it.
 *
 * IDENTITY SWITCHES and RENDERER FRAME DROPS are consciously NOT here: they
 * are measured at the L005/L013 render seams (the live view owns identity
 * continuity). The report notes the boundary in its module docs — it never
 * fabricates a counter it cannot measure.
 */
import type { Watermark } from "@sporta/contracts";
import type { ConflictRecord } from "@sporta/fusion";
import type { LiveUpdateReport } from "@sporta/live-swm";
import type { TemporalEngineStats } from "@sporta/live-temporal";

/**
 * One arbitration decision (D5) — the EXPLICIT record that a same-time
 * conflicting tie was decided (never a silent winner): which entity, at
 * which event time, which source's row SURVIVED (the canonical replay
 * order's last row — the frozen §8 rule), which sources' rows were
 * withheld, which conflict record carries the evidence, and the operator's
 * precedence preference REPORTED alongside (it never overrides the
 * survivor — see the engine module docs).
 */
export interface FusionArbitrationDecision {
  entityRef: string;
  eventTimeMs: number;
  /** The source whose row survived (the canonical replay order's last row). */
  survivorSourceId: string;
  /** The sources whose rows were withheld (ledger-recorded, never bridged). */
  withheldSourceIds: readonly string[];
  /** The conflict record backing this decision (`cf-<seq>`). */
  conflictId: string;
  /** Which canonical key decided: cross-source (the source order) or same-source (the newer sequence). */
  rule: "canonical-source-order" | "canonical-sequence-order";
  /** The operator's precedence preference for this tie (null = no precedence configured). */
  precedencePreferredSourceId: string | null;
  /** Whether the operator's preference matches the survivor. */
  precedenceMatchesSurvivor: boolean;
}

/** One fusion-level source lifecycle event (D6 — loss/recovery transitions). */
export interface FusionSourceEvent {
  sourceId: string;
  kind: "source-lost" | "source-recovered";
  /** The render clock at which the transition was observed (injected). */
  atRenderClockMs: number;
  /** The source's watermark at the transition (the L004 per-source state). */
  watermark: Watermark;
}

/** The fusion-layer state of one source, derived from the L004 state machine. */
export type FusionSourceState = "active" | "lost" | "stalled-flush-pending";

/**
 * The per-source summary (D2/D6): the fusion-layer counters plus the L004
 * per-source accounting VERBATIM (its own §9 counters — never re-counted).
 */
export interface FusionSourceSummary {
  sourceId: string;
  /**
   * `"lost"` when L004 has latched STALLED (a previously-seen stream that
   * dropped — honest source-loss); `"stalled-flush-pending"` during the
   * flush; otherwise `"active"`.
   */
  state: FusionSourceState;
  /** Batches of this source passed to the updater (fusion-cumulative). */
  batchesApplied: number;
  /** Entity rows of this source applied (fusion-cumulative). */
  rowsApplied: number;
  /** Entity rows of this source withheld by arbitration (ledger-recorded). */
  rowsWithheld: number;
  /** Co-observed rows of this source that AGREED within tolerance (corroboration). */
  rowsCorroborating: number;
  /** Conflict records whose group involves this source (fusion-cumulative). */
  conflictsInvolved: number;
  /** The L004 per-source watermark (VERBATIM, frozen shape). */
  watermark: Watermark;
  /** The L004 per-source counters + state (VERBATIM — that engine's own §9 surface). */
  temporal: TemporalEngineStats;
}

/** The per-drain fusion report (JSON-safe, deterministic). */
export interface FusionReport {
  sessionId: string;
  /** Which engine call produced this drain (`admit` / `tick` / `finalize`). */
  origin: "admit" | "tick" | "finalize";
  /** The injected render clock at the call (deterministic evidence time). */
  renderClockMs: number;
  /** The L003 per-batch reports, VERBATIM, in application order. */
  batchReports: readonly LiveUpdateReport[];
  /** Batches suppressed because arbitration withheld ALL their rows (D9). */
  suppressedBatches: number;
  /** The drain's conflict ledger (the batch `ConflictRecord` shape). */
  conflicts: readonly ConflictRecord[];
  /** Rows withheld by arbitration this drain (counted, ledger-recorded). */
  conflictRowsWithheld: number;
  /** Co-observed rows that agreed within tolerance this drain (corroboration — counted, no record). */
  corroborationRows: number;
  /** The explicit arbitration decisions this drain (never a silent winner). */
  arbitrationDecisions: readonly FusionArbitrationDecision[];
  /** The per-source summaries (all sources with L004 state, sorted by sourceId). */
  sourceSummary: readonly FusionSourceSummary[];
  /** Source lifecycle events this drain (loss/recovery transitions — D6). */
  sourceEvents: readonly FusionSourceEvent[];
  /** Whether any previously-seen source is currently lost (the surviving sources carry the world — visible). */
  fallbackActive: boolean;
  /** The engine's snapshot version after this drain (the frozen worldVersion). */
  snapshotVersionAfter: number;
}

/** The fusion-run cumulative accounting (the aggregate honesty surface). */
export interface FusionStats {
  /** Engine calls that produced drains. */
  drainsFired: number;
  /** Batches passed to the updater (applied + duplicate outcomes). */
  batchesApplied: number;
  /** Batches suppressed (all rows withheld). */
  batchesSuppressed: number;
  /** Conflict records minted (the ledger size). */
  conflicts: number;
  /** Rows withheld by arbitration (all drains). */
  conflictRowsWithheld: number;
  /** Corroborating rows observed (all drains). */
  corroborationRows: number;
  /** Source-loss transitions recorded. */
  sourcesLost: number;
  /** Source-recovery transitions recorded. */
  sourceRecoveries: number;
  /** The engine's current snapshot version. */
  snapshotVersion: number;
}

/** The initial aggregate accounting for a fresh fusion engine. */
export function emptyFusionStats(): FusionStats {
  return {
    drainsFired: 0,
    batchesApplied: 0,
    batchesSuppressed: 0,
    conflicts: 0,
    conflictRowsWithheld: 0,
    corroborationRows: 0,
    sourcesLost: 0,
    sourceRecoveries: 0,
    snapshotVersion: 1,
  };
}

/**
 * Canonical serialization of one report (key-sorted JSON — the deterministic
 * evidence form; mirrors the repo's canonical-serializer convention).
 */
export function canonicalFusionReportJson(report: FusionReport): string {
  return canonicalJson(report);
}

/** Canonical serialization of the aggregate stats. */
export function canonicalFusionStatsJson(stats: FusionStats): string {
  return canonicalJson(stats);
}

/** Key-sorted recursive JSON (deterministic across key insertion orders). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
