/**
 * THE CO-OBSERVATION GROUPING + TOLERANCE CHECKS (L012 design D3) — pure
 * functions over the drain's applied batches: which rows from DIFFERENT
 * sources observe the SAME entity at comparable times, and whether those
 * rows agree within the movement-plausibility tolerance.
 *
 * MIRRORS the batch `detectSlotConflicts` comparability rule: on
 * event-time-sorted rows, comparability is the connected-component relation
 * "consecutive gaps ≤ conflictWindowMs" — rows farther apart are sequential
 * updates, not conflicting evidence. The tolerance check adds the LIVE
 * nuance the batch pass does not need: positions are continuous, so
 * agreement is measured in METERS with a movement-plausibility basis —
 * `distance ≤ toleranceM + maxSpeedMps · Δt/1000` (D3).
 *
 * PURITY: no clock, no env, no RNG, no mutation of the inputs.
 */
import type { LiveEntityObservation, LiveObservation } from "@sporta/live-source";
import type { LiveFusionPolicy } from "./policy";

/** One drain row lifted with its source identity (the grouping unit). */
export interface DrainRow {
  /** The source the row's batch came from (the drain's sourceId). */
  sourceId: string;
  /** The batch's sequence (the row's identity within the source stream). */
  sequence: number;
  /** The row VERBATIM (position/confidence/observedAtMs untouched). */
  row: LiveEntityObservation;
}

/** One co-observation group: window-comparable rows, ≥2 DISTINCT sources. */
export interface CoObservationGroup {
  entityRef: string;
  /** The group's rows, sorted by `(observedAtMs, sourceId)` (deterministic). */
  rows: readonly DrainRow[];
  /** The distinct sources in the group, sorted lexicographically. */
  sources: readonly string[];
}

/**
 * Lifts a drain's applied batches into {@link DrainRow}s, in the drain's
 * own event-time order (batches are already sorted by
 * `(eventTimeMs, sequence, sourceId)`; within a batch, rows keep their
 * array order — the updater's canonical order re-sorts them itself).
 */
export function drainRowsOf(applied: readonly { sourceId: string; batch: LiveObservation }[]): DrainRow[] {
  const rows: DrainRow[] = [];
  for (const entry of applied) {
    for (const row of entry.batch.entityObservations) {
      rows.push({ sourceId: entry.sourceId, sequence: entry.batch.sequence, row });
    }
  }
  return rows;
}

/**
 * Groups one entity's rows into co-observation groups (connected components
 * over the `conflictWindowMs` comparability relation on `observedAtMs`),
 * keeping ONLY groups whose rows come from ≥2 DISTINCT sources — a group
 * with a single source is one source's own sequential updates, never a
 * cross-source co-observation.
 */
export function coObservationGroupsOf(
  entityRef: string,
  rows: readonly DrainRow[],
  policy: LiveFusionPolicy,
): CoObservationGroup[] {
  const sorted = [...rows].sort(
    (a, b) =>
      a.row.observedAtMs - b.row.observedAtMs || (a.sourceId < b.sourceId ? -1 : 1),
  );
  const groups: CoObservationGroup[] = [];
  let index = 0;
  while (index < sorted.length) {
    let runEnd = index + 1;
    while (
      runEnd < sorted.length &&
      sorted[runEnd]!.row.observedAtMs - sorted[runEnd - 1]!.row.observedAtMs <=
        policy.conflictWindowMs
    ) {
      runEnd += 1;
    }
    const group = sorted.slice(index, runEnd);
    const sources = [...new Set(group.map((entry) => entry.sourceId))].sort();
    if (sources.length >= 2) {
      groups.push({ entityRef, rows: group, sources });
    }
    index = runEnd;
  }
  return groups;
}

/** The pitch-plane distance between two rows' positions (meters). */
export function distanceM(a: LiveEntityObservation, b: LiveEntityObservation): number {
  const dx = a.position.xMeters - b.position.xMeters;
  const dy = a.position.yMeters - b.position.yMeters;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * The movement-plausibility speed basis for a pair of rows (m/s): the
 * BALL basis when either row is a ball (a struck ball legitimately flies at
 * 25-35 m/s — the foot basis would flag every fast ball movement as a
 * conflict), else the foot basis (players/referees).
 */
function speedBasisOf(
  a: LiveEntityObservation,
  b: LiveEntityObservation,
  policy: LiveFusionPolicy,
): number {
  return a.kind === "BALL" || b.kind === "BALL" ? policy.ballMaxSpeedMps : policy.maxSpeedMps;
}

/**
 * Whether two rows AGREE within the movement-plausibility tolerance (D3):
 * `distance ≤ toleranceM + basis · Δt/1000` with the pair's kind-based speed
 * basis. Δt uses the ABSOLUTE event-time gap (symmetric); same-time rows
 * compare at the bare tolerance.
 */
export function agreeWithinTolerance(
  a: LiveEntityObservation,
  b: LiveEntityObservation,
  policy: LiveFusionPolicy,
): boolean {
  const gapMs = Math.abs(a.observedAtMs - b.observedAtMs);
  const plausibleM = speedBasisOf(a, b, policy) * (gapMs / 1000);
  return distanceM(a, b) <= policy.conflictToleranceM + plausibleM;
}

/**
 * Whether a co-observation group CONFLICTS (D3): ANY pair of its rows
 * disagrees beyond the movement-plausibility tolerance. All pairs, not just
 * adjacent ones — a group whose endpoints cannot be reconciled by any
 * plausible motion disagrees as a whole (documented; stricter and honest).
 */
export function groupConflicts(
  group: CoObservationGroup,
  policy: LiveFusionPolicy,
): boolean {
  for (let i = 0; i < group.rows.length; i += 1) {
    for (let j = i + 1; j < group.rows.length; j += 1) {
      if (!agreeWithinTolerance(group.rows[i]!.row, group.rows[j]!.row, policy)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The same-time tie sets of a group: maximal sets of rows sharing the
 * IDENTICAL `observedAtMs` (the D5 rule 2 cases). Rows at distinct times are
 * sequential updates (both apply — event-time authority); only identical-time
 * rows can collide in the updater's canonical application order.
 */
export function sameTimeTiesOf(group: CoObservationGroup): DrainRow[][] {
  const ties: DrainRow[][] = [];
  let index = 0;
  const rows = group.rows;
  while (index < rows.length) {
    let runEnd = index + 1;
    while (
      runEnd < rows.length &&
      rows[runEnd]!.row.observedAtMs === rows[index]!.row.observedAtMs
    ) {
      runEnd += 1;
    }
    if (runEnd - index >= 2) ties.push(rows.slice(index, runEnd));
    index = runEnd;
  }
  return ties;
}
