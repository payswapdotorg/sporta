/**
 * THE LIVE CONFLICT LEDGER MINTING (L012 design D4) — cross-source
 * disagreements recorded as `ConflictRecord`s, the BATCH `@sporta/fusion`
 * shape reused VERBATIM (the same shape `LiveUpdateReport.conflicts`
 * carries — one conflict vocabulary across batch and live, never a forked
 * ledger shape).
 *
 * HONEST ID SCHEME: the observation ids are the D6 bridge scheme
 * `lo-<sourceId>-<zero-padded sequence>-<entityRef>` — the SAME ids the
 * W005 bridge stores for applied rows, so the ledger's evidence ids and the
 * SWM evidence chain address the same rows (a withheld row's id names the
 * row the ledger retained when the arbiter withheld it from the engine).
 *
 * NEVER a resolution here: `resolution: "none"` — the conflict STANDS in
 * the ledger (the W401 rule). The arbiter's deterministic decision is
 * carried separately and explicitly in the fusion report (D5).
 */
import type { ConflictRecord } from "@sporta/fusion";
import type { LiveEntityObservation } from "@sporta/live-source";
import type { CoObservationGroup, DrainRow } from "./groups";

/** The zero-padded sequence (the bridge's own scheme — mirrored, not forked). */
function paddedSequence(sequence: number): string {
  return String(sequence).padStart(12, "0");
}

/**
 * The bridge-scheme observation id of one drain row
 * (`lo-<sourceId>-<paddedSequence>-<entityRef>`).
 */
export function liveObservationIdOf(entry: DrainRow): string {
  return `lo-${entry.sourceId}-${paddedSequence(entry.sequence)}-${entry.row.entityRef}`;
}

/** The conflict value of one row: its pitch position (+ z when present). */
function positionValueOf(row: LiveEntityObservation): unknown {
  const position: Record<string, number> = {
    xMeters: row.position.xMeters,
    yMeters: row.position.yMeters,
  };
  if (row.position.zMeters !== undefined) position.zMeters = row.position.zMeters;
  return position;
}

/**
 * Mints one {@link ConflictRecord} for a conflicting co-observation group:
 * every row's observation id, every row's position value with its
 * confidence (in the same order), `resolution: "none"`, `detectedAtMs` =
 * the group's max event time. `seq` is the ledger sequence
 * (`cf-<seq>`, gap-free across a drain — the caller assigns increasing
 * offsets).
 */
export function conflictRecordOf(group: CoObservationGroup, seq: number): ConflictRecord {
  const rows = [...group.rows].sort(
    (a, b) =>
      a.row.observedAtMs - b.row.observedAtMs ||
      (liveObservationIdOf(a) < liveObservationIdOf(b) ? -1 : 1),
  );
  return {
    conflictId: `cf-${seq}`,
    slotKey: `live-position:${group.entityRef}`,
    observationIds: rows.map((entry) => liveObservationIdOf(entry)),
    values: rows.map((entry) => ({
      value: positionValueOf(entry.row),
      ...(entry.row.confidence !== undefined ? { confidence: entry.row.confidence } : {}),
    })),
    resolution: "none",
    detectedAtMs: rows.reduce((max, entry) => Math.max(max, entry.row.observedAtMs), 0),
  };
}
