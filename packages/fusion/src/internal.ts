/**
 * Internal shared helpers for `@sporta/fusion`.
 *
 * Not part of the public package API (see `src/index.ts`); they exist so the
 * events/entities/conflicts/fusion modules share one deterministic
 * deep-equality definition and one canonical observation ordering.
 *
 * Determinism contract (docs/testing/HARNESS.md): no `Date.now`, no
 * `Math.random`, no module-level mutable state — every helper is a pure
 * function of its arguments.
 */
import type { Observation } from "@sporta/contracts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural JSON deep-equality: two values are equal when they have the same
 * JSON structure — objects compare key sets and per-key values (key ORDER is
 * irrelevant), arrays compare element-wise, primitives compare with `===`
 * (`NaN` therefore never equals `NaN`; contract values are finite numbers, so
 * this never arises in practice).
 *
 * This is the documented equality for conflict detection (W401 §3.3: "NOT
 * deep-equal (documented equality: structural JSON deep-equal)") and for the
 * fusion pass's idempotence guards.
 */
export function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.hasOwn(b, key)) return false;
      if (!jsonDeepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!jsonDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Canonical fusion ordering: by `eventTimeMs`, ties broken by
 * `observationId` (lexicographic).
 *
 * The observationId tiebreak matters because the W005 store's query order
 * breaks event-time ties by APPEND order — an ingestion artifact that is not
 * a function of record content. Sorting by (eventTimeMs, observationId)
 * instead makes the fusion pass a pure function of the SET of stored
 * observations: re-delivering the same observations in a different append
 * order (duplicate-tolerant re-ingestion) yields the exact same pass.
 */
export function byTimeThenObservationId(a: Observation, b: Observation): number {
  return a.eventTimeMs - b.eventTimeMs || (a.observationId < b.observationId ? -1 : 1);
}

/** Returns a new array sorted by (eventTimeMs, observationId). Pure. */
export function sortedByTimeThenObservationId(records: ReadonlyArray<Observation>): Observation[] {
  return [...records].sort(byTimeThenObservationId);
}
