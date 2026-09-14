/**
 * The EXPLICIT conflict ledger (W401 §3.3, pure).
 *
 * This module is the W401 accept criterion made concrete: "conflicting
 * evidence remains explicit" (architecture-lock §4: conflicting evidence is
 * never silently collapsed). A conflict record lists EVERY conflicting
 * observation, both values with their evidence confidences, and an explicit
 * `resolution: "none"` — W401 NEVER auto-resolves, NEVER drops a conflicting
 * observation, NEVER averages values, and NEVER picks a winner silently.
 * Resolution (deferred or otherwise) belongs to a later, authoritative stage.
 */
import type { Observation } from "@sporta/contracts";
import { byTimeThenObservationId, jsonDeepEqual } from "./internal";

/** One explicitly recorded conflict over a world-model state slot. */
export interface ConflictRecord {
  /**
   * Global gap-free ledger sequence: `"cf-<seq>"` starting at `cf-1` in the
   * order records are merged into a report. Callers minting records from
   * several `detectSlotConflicts` invocations pass increasing `startSeq`
   * offsets so the combined ledger stays gap-free and unique.
   */
  conflictId: string;
  /** The slot the conflict is over, e.g. "possession", "clock-period". */
  slotKey: string;
  /** EVERY conflicting record, order-stable (eventTimeMs, observationId). */
  observationIds: readonly string[];
  /**
   * The conflicting values, in the same order as {@link observationIds};
   * each entry carries its source observation's confidence when present.
   */
  values: ReadonlyArray<{ value: unknown; confidence?: number }>;
  /**
   * W401 never auto-resolves. `"none"` records that the conflict stands;
   * `"deferred"` is reserved for a future authoritative resolution stage.
   */
  resolution: "none" | "deferred";
  /** The conflict's detection time: max `eventTimeMs` among the records. */
  detectedAtMs: number;
}

/**
 * Detects slot conflicts among observations.
 *
 * A conflict is a GROUP of observations that are temporally comparable —
 * within `windowMs` of each other (the fusion passes the engine's
 * `maxReorderMs`; records farther apart are sequential updates, not
 * conflicting evidence) — whose `valueOf` results are NOT structurally
 * JSON-deep-equal. On time-sorted records, window comparability is the
 * connected-component relation "some chain of records with consecutive gaps
 * `<= windowMs`", computed by growing maximal runs of consecutive gaps
 * within the window.
 *
 * ONE record is emitted per conflicting group:
 *
 * - `observationIds`: every record in the group, sorted by (eventTimeMs,
 *   observationId) — the canonical fusion ordering;
 * - `values`: `valueOf` of each record in the same order, each carrying the
 *   observation's own confidence when present;
 * - `resolution: "none"` and `detectedAtMs` = the group's max eventTimeMs.
 *
 * Groups whose records all agree (deep-equal values) emit nothing: agreeing
 * evidence is corroboration, not conflict.
 */
export function detectSlotConflicts(
  records: ReadonlyArray<Observation>,
  slotKey: string,
  valueOf: (obs: Observation) => unknown,
  windowMs: number = Number.POSITIVE_INFINITY,
  startSeq: number = 1,
): ConflictRecord[] {
  const sorted = [...records].sort(byTimeThenObservationId);
  const conflicts: ConflictRecord[] = [];

  let index = 0;
  while (index < sorted.length) {
    // Grow one window-comparable run starting at `index`.
    let runEnd = index + 1;
    while (
      runEnd < sorted.length &&
      sorted[runEnd]!.eventTimeMs - sorted[runEnd - 1]!.eventTimeMs <= windowMs
    ) {
      runEnd += 1;
    }
    const group = sorted.slice(index, runEnd);

    if (groupHasDifferingValues(group, valueOf)) {
      conflicts.push(buildConflictRecord(slotKey, group, valueOf, startSeq + conflicts.length));
    }
    index = runEnd;
  }

  return conflicts;
}

/** Whether any two records in the (time-sorted) group carry different values. */
function groupHasDifferingValues(
  group: ReadonlyArray<Observation>,
  valueOf: (obs: Observation) => unknown,
): boolean {
  const first = valueOf(group[0]!);
  for (let i = 1; i < group.length; i += 1) {
    if (!jsonDeepEqual(first, valueOf(group[i]!))) return true;
  }
  return false;
}

/**
 * Builds one conflict record from a conflicting group (the shape shared by
 * {@link detectSlotConflicts} and the fusion pass's direct constructions):
 * ids sorted by (eventTimeMs, observationId), values in the same order with
 * each observation's confidence when present, `resolution: "none"`,
 * `detectedAtMs` = the group's max eventTimeMs.
 */
export function buildConflictRecord(
  slotKey: string,
  group: ReadonlyArray<Observation>,
  valueOf: (obs: Observation) => unknown,
  seq: number,
): ConflictRecord {
  const sorted = [...group].sort(byTimeThenObservationId);
  return {
    conflictId: `cf-${seq}`,
    slotKey,
    observationIds: sorted.map((obs) => obs.observationId),
    values: sorted.map((obs) => ({
      value: valueOf(obs),
      ...(obs.confidence !== undefined ? { confidence: obs.confidence } : {}),
    })),
    resolution: "none",
    detectedAtMs: sorted.reduce((max, obs) => Math.max(max, obs.eventTimeMs), 0),
  };
}
