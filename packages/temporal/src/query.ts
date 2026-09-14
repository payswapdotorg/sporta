/**
 * Time-windowed consumer queries over the Sports World Model (W402 §3.1,
 * pure).
 *
 * The W006 engine is sequence-indexed: `eventsSince(sequence)` returns log
 * entries strictly after a sequence checkpoint, and its at-T queries
 * (`snapshot(atMs)`, `entityAt(entityId, atMs)`) live directly on the engine
 * class. W402 is the CONSUMER-FACING temporal API on top of those seams —
 * this module contributes:
 *
 * - {@link eventWindow}: the time-windowed event query the engine does not
 *   have (an inclusive `[fromMs, toMs]` filter over the event stream, keyed
 *   to `event.eventTimeMs` on the canonical media timeline);
 * - {@link stateAt}: the validated at-T state query (a thin wrapper over
 *   `engine.snapshot(atMs)`).
 *
 * Both functions are pure: no engine mutation, no clock reads, no RNG — the
 * same inputs always produce deep-equal outputs.
 */
import type { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import type { WorldModelEngine } from "@sporta/world-model";

/**
 * An inclusive event-time window on the canonical media timeline. Both bounds
 * are INCLUSIVE: an entry whose `event.eventTimeMs` equals `fromMs` or `toMs`
 * is inside the window.
 */
export interface EventWindow {
  /** Inclusive lower bound on `event.eventTimeMs` (non-negative, finite). */
  fromMs: number;
  /** Inclusive upper bound on `event.eventTimeMs` (non-negative, finite). */
  toMs: number;
}

/**
 * Validates an {@link EventWindow}: both bounds must be finite numbers >= 0
 * and `fromMs <= toMs`. Throws a `RangeError` otherwise (fail loud, repo
 * style) — a malformed window must never silently become an empty or
 * full-log result.
 */
function validateWindow(window: EventWindow): void {
  if (window === null || typeof window !== "object") {
    throw new RangeError("eventWindow: window must be an object with fromMs and toMs");
  }
  for (const bound of ["fromMs", "toMs"] as const) {
    const value = window[bound];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new RangeError(
        `eventWindow: ${bound} must be a finite number >= 0 (got ${String(value)})`,
      );
    }
  }
  if (window.fromMs > window.toMs) {
    throw new RangeError(`eventWindow: fromMs (${window.fromMs}) must be <= toMs (${window.toMs})`);
  }
}

/**
 * Validates the per-entry shape this module itself reads (`event.eventTimeMs`
 * is the filter key). Full envelope validation stays owned by the W006 engine
 * (`applyEvent` → `InvalidEventError`); a malformed `eventTimeMs` would
 * otherwise be SILENTLY excluded by the comparison — fail loud instead.
 */
function validateEntries(entries: readonly WorldEventStreamEntry[]): void {
  if (!Array.isArray(entries)) {
    throw new RangeError("eventWindow: entries must be an array of WorldEventStreamEntry");
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (
      entry === null ||
      typeof entry !== "object" ||
      entry.event === null ||
      typeof entry.event !== "object"
    ) {
      throw new RangeError(
        `eventWindow: entries[${index}] must be a WorldEventStreamEntry with an event object`,
      );
    }
    const eventTimeMs = entry.event.eventTimeMs;
    if (typeof eventTimeMs !== "number" || !Number.isFinite(eventTimeMs) || eventTimeMs < 0) {
      throw new RangeError(
        `eventWindow: entries[${index}].event.eventTimeMs must be a finite number >= 0 ` +
          `(got ${String(eventTimeMs)})`,
      );
    }
  }
}

/**
 * Filters `entries` to those whose `event.eventTimeMs` lies within the
 * INCLUSIVE window `[fromMs, toMs]`.
 *
 * ORDER (documented, pinned by tests): the output preserves the input's order
 * EXACTLY as passed — no re-sorting. The canonical caller passes
 * `engine.eventsSince(0)`, which returns the log in the engine's own order;
 * the window keeps that order. Event-time re-sorting would LIE about the
 * engine's actual application order: `sequence` is the arrival/application
 * order the engine assigned, and only that order reproduces the engine's
 * supersession and versioning effects (see `replayForward`, which applies
 * window entries IN SEQUENCE ORDER).
 *
 * HONESTY: superseded events are INCLUDED. The window is the full evidence
 * record exactly as the engine recorded it — consumers see `correctionOf`
 * chains verbatim; dropping superseded entries here would silently destroy
 * evidence (versioned corrections, never silent rewrites —
 * docs/contracts/sports-world-model.md, temporal semantics).
 *
 * The returned array is a fresh array of the SAME entry references (engine
 * entries are already deep-frozen clones; filtering copies references, never
 * state).
 */
export function eventWindow(
  entries: readonly WorldEventStreamEntry[],
  window: EventWindow,
): WorldEventStreamEntry[] {
  validateWindow(window);
  validateEntries(entries);
  return entries.filter(
    (entry) => entry.event.eventTimeMs >= window.fromMs && entry.event.eventTimeMs <= window.toMs,
  );
}

/**
 * The result of a state-at-T query: the engine's snapshot verbatim, with no
 * added fields (the wrapper adds no state — it is a validated surface, not a
 * projection).
 */
export interface StateAtResult {
  /** `engine.snapshot(atMs)` verbatim (deep-frozen by the engine). */
  snapshot: WorldSnapshot;
}

/**
 * The state of the world at timeline position `atMs`.
 *
 * This is a THIN, VALIDATED wrapper: it calls `engine.snapshot(atMs)` and
 * returns it verbatim inside {@link StateAtResult}. The engine's own
 * validation and error surface map through UNCHANGED — a malformed `atMs`
 * (non-number / NaN) throws the engine's `InvalidTimelineQueryError`, and a
 * snapshot that fails its own contract throws the engine's
 * `SnapshotIntegrityError`.
 *
 * WHY the wrapper exists (documented per the W402 brief): it is the one
 * consumer surface for the at-T contract — the place §3.2's replay
 * compatibility checks read state from (a replay seeded at a boundary is
 * compared against this surface), and the place the at-T contract is pinned
 * in tests (`stateAt(engine, T).snapshot` equals `engine.snapshot(T)`
 * field-for-field, forever). It also fails loud on a non-engine argument
 * (repo style — the same guard `runWorldFusion` applies).
 *
 * At-T semantics are the engine's, verbatim: only entities whose
 * `lastEventTimeMs <= atMs` are included, the football state appears when its
 * timeline position is `<= atMs` (future state is excluded, not back-dated),
 * and the watermark is the maximum event time/sequence included.
 */
export function stateAt(engine: WorldModelEngine, atMs: number): StateAtResult {
  if (engine === null || typeof engine !== "object" || typeof engine.snapshot !== "function") {
    throw new RangeError("stateAt: engine must be a WorldModelEngine");
  }
  return { snapshot: engine.snapshot(atMs) };
}
