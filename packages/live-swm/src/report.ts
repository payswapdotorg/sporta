/**
 * THE LIVE UPDATE REPORT (L003 design D5) — the honest per-batch accounting:
 * JSON-safe, deterministic (no clock, no RNG), the §9 telemetry source for
 * ingest-to-SWM latency (paired with the batch's dual clocks) and the
 * operator-visible honesty surface.
 *
 * The D5 shape is implemented verbatim (sessionId, sourceId,
 * appliedSequence, watermarkAfter, entitiesUpserted, entitiesSkippedNoOp,
 * lateUpdatesInWindow, extrapolatedObservations, possessionUpdates,
 * conflicts, snapshotVersionAfter) with the ADDITIVE honesty members the
 * design's own rules require (the live-layer additive precedent — L002's
 * `recovery` member; never a frozen-contract change):
 *
 * - `outcome` — idempotent re-delivery is a no-op, never an error (D7);
 * - `lateUpdateDropped` — the D2 beyond-window drop counter;
 * - `nonProjectableRows` — REFEREE/OTHER rows honestly skipped (no kind
 *   invented — the batch pass's rule);
 * - `warnings` — deterministic human-readable notes (the FusionReport
 *   convention).
 */
import type { Watermark } from "@sporta/contracts";
import type { ConflictRecord } from "@sporta/fusion";

/** The per-batch honest accounting (the D5 report + additive members). */
export interface LiveUpdateReport {
  /** `applied` or `duplicate` (idempotent re-delivery — a no-op, never an error). */
  outcome: "applied" | "duplicate";
  sessionId: string;
  sourceId: string;
  /** The batch's own sequence (gaps visible — never renumbered). */
  appliedSequence: number;
  /** min(source watermark, L004 engine watermark when provided) — frozen shape. */
  watermarkAfter: Watermark;
  /** Applied entity observations (engine-versioned upserts). */
  entitiesUpserted: number;
  /** Identical-state re-applications skipped (idempotence). */
  entitiesSkippedNoOp: number;
  /** Applied late updates (within the L004 reorder window). */
  lateUpdatesInWindow: number;
  /** Beyond-window late updates dropped (never a position rewind). */
  lateUpdateDropped: number;
  /** `detected: false` applications — the §9 extrapolation counter. */
  extrapolatedObservations: number;
  /** Rows without SWM participant/ball semantics (REFEREE/OTHER — no kind invented). */
  nonProjectableRows: number;
  /** Possession recomputes that SET a winner (the tie/empty clears are `possessionCleared`). */
  possessionUpdates: number;
  /** Memoryless clears: a tie or an empty ball neighborhood returning the slot to unknown. */
  possessionCleared: number;
  /** The explicit conflict ledger (the fusion shape — possession ties). */
  conflicts: readonly ConflictRecord[];
  /** The engine's snapshot version after the batch. */
  snapshotVersionAfter: number;
  /** Deterministic, human-readable honesty notes (the FusionReport convention). */
  warnings: readonly string[];
}

/** The aggregate updater accounting (the D7 refusal counters live here). */
export interface LiveUpdaterStats {
  /** Batches refused for contract validation (never partially applied). */
  invalidBatches: number;
  /** Batches refused for a session mismatch. */
  wrongSession: number;
  /** Batches refused as duplicate/replayed sequences (idempotent no-ops). */
  duplicateSequence: number;
  /** Batches applied (outcome "applied"). */
  appliedBatches: number;
  /** Entity rows upserted across the session. */
  entitiesUpserted: number;
  /** Entity rows skipped as identical re-applications. */
  entitiesSkippedNoOp: number;
  /** Beyond-window late entity updates dropped. */
  lateUpdateDropped: number;
  /** `detected: false` applications (the §9 counter, session aggregate). */
  extrapolatedObservations: number;
  /** Possession recomputes that set a winner, across the session. */
  possessionUpdates: number;
  /** Memoryless possession clears (tie / empty neighborhood → unknown). */
  possessionCleared: number;
  /** Bridge appends refused as duplicates (idempotent re-ingestion). */
  duplicateBridgeObservations: number;
  /** The engine's current snapshot version. */
  snapshotVersion: number;
}

/** The initial aggregate accounting for a fresh updater. */
export function emptyLiveUpdaterStats(): LiveUpdaterStats {
  return {
    invalidBatches: 0,
    wrongSession: 0,
    duplicateSequence: 0,
    appliedBatches: 0,
    entitiesUpserted: 0,
    entitiesSkippedNoOp: 0,
    lateUpdateDropped: 0,
    extrapolatedObservations: 0,
    possessionUpdates: 0,
    possessionCleared: 0,
    duplicateBridgeObservations: 0,
    snapshotVersion: 1,
  };
}

/**
 * Canonical serialization of one report (key-sorted JSON — the deterministic
 * evidence form; mirrors the repo's canonical-serializer convention).
 */
export function canonicalReportJson(report: LiveUpdateReport): string {
  return canonicalJson(report);
}

/** Canonical serialization of the aggregate stats. */
export function canonicalUpdaterStatsJson(stats: LiveUpdaterStats): string {
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
