/**
 * Time-windowed consumer queries over the W006 engine's event stream (W402
 * §3.1, pure).
 *
 * The engine's event log is SEQUENCE-indexed only (`eventsSince(sequence)`);
 * consumers need EVENT-TIME windows. This module is that bridge — pure
 * functions over the engine's own immutable stream entries, adding no state,
 * no re-sorting, and no interpretation:
 *
 * - {@link eventWindow}: the entries whose `event.eventTimeMs` falls in an
 *   inclusive `[fromMs, toMs]` window, in the INPUT's order;
 * - {@link stateAt}: the validated at-T snapshot (the engine's own
 *   `snapshot(atMs)`, verbatim).
 */
import { WorldEventStreamEntry } from "@sporta/contracts";
import type { WorldSnapshot } from "@sporta/contracts";
import type { WorldModelEngine } from "@sporta/world-model";

/**
 * Formats a zod error's issues as `path: message; ...` (structural — no zod
 * import; the same shape the W006 engine's error taxonomy reports).
 */
function issuesOf(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

/** An inclusive event-time window on the canonical media timeline. */
export interface EventWindow {
  /** Inclusive lower bound in milliseconds. */
  fromMs: number;
  /** Inclusive upper bound in milliseconds. */
  toMs: number;
}

/**
 * The event-stream entries whose `event.eventTimeMs` lies within
 * `[fromMs, toMs]` (inclusive on both ends).
 *
 * Order semantics (documented, test-pinned): the OUTPUT preserves the INPUT's
 * order verbatim. The intended caller passes `engine.eventsSince(0)`, whose
 * order is the engine's log order — event time ascending, arrival sequence
 * ascending within equal times — which IS the engine's actual application
 * order. Re-sorting by event time here would LIE about that order: the engine
 * inserts near-order events at their event-time position, so a log that
 * accepted a bounded-late event is deliberately NOT in pure arrival order,
 * and the consumer must see the log as the engine recorded it.
 *
 * Honesty semantics: SUPERSEDED events are INCLUDED. The window is a slice of
 * the full evidence record — the consumer sees `correctionOf` chains exactly
 * as the engine recorded them (corrections are versioned supersession, never
 * in-place rewrites; the original stays queryable).
 *
 * Fail loud (repo style): a malformed window or a malformed entry throws
 * `RangeError` — the filter never silently drops malformed input.
 *
 * @param entries the engine's stream entries (e.g. `engine.eventsSince(0)`);
 *   passed through verbatim (same object references, no cloning, no freezing)
 * @param window the inclusive event-time window
 * @returns the in-window entries, input order preserved
 */
export function eventWindow(
  entries: readonly WorldEventStreamEntry[],
  window: EventWindow,
): WorldEventStreamEntry[] {
  if (window === null || typeof window !== "object") {
    throw new RangeError("eventWindow: window must be an EventWindow object");
  }
  const { fromMs, toMs } = window;
  if (typeof fromMs !== "number" || !Number.isFinite(fromMs) || fromMs < 0) {
    throw new RangeError(
      `eventWindow: fromMs must be a finite number >= 0 (got ${String(fromMs)})`,
    );
  }
  if (typeof toMs !== "number" || !Number.isFinite(toMs) || toMs < 0) {
    throw new RangeError(`eventWindow: toMs must be a finite number >= 0 (got ${String(toMs)})`);
  }
  if (fromMs > toMs) {
    throw new RangeError(`eventWindow: fromMs (${fromMs}) must be <= toMs (${toMs})`);
  }
  if (!Array.isArray(entries)) {
    throw new RangeError("eventWindow: entries must be an array of WorldEventStreamEntry");
  }
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const check = WorldEventStreamEntry.safeParse(entry);
    if (!check.success) {
      throw new RangeError(
        `eventWindow: entries[${i}] is not a valid WorldEventStreamEntry: ${issuesOf(check.error)}`,
      );
    }
  }
  return entries.filter(
    (entry) => entry.event.eventTimeMs >= fromMs && entry.event.eventTimeMs <= toMs,
  );
}

/** The result of a state-at-T query: the engine's snapshot, verbatim. */
export interface StateAtResult {
  /** `engine.snapshot(atMs)` — a deep-frozen clone (W006 semantics). */
  snapshot: WorldSnapshot;
}

/**
 * The best-known coherent state at timeline position `atMs`.
 *
 * This is a THIN, VALIDATED wrapper: `engine.snapshot(atMs)` verbatim — the
 * engine owns the at-T contract, so its `InvalidTimelineQueryError` (a
 * malformed timeline position) passes through UNCHANGED and no additional
 * validation shadows it. The wrapper exists because §3.2's replay produces
 * snapshots through the same contract surface, and consumers need ONE
 * at-T entry point whose compatibility with replay output is pinned by tests
 * (same `WorldSnapshot` shape, same watermark semantics) rather than
 * re-discovered per call site. It adds no state.
 *
 * @param engine the W006 engine to query
 * @param atMs the timeline position (engine-validated: a `number`, not `NaN`)
 */
export function stateAt(engine: WorldModelEngine, atMs: number): StateAtResult {
  if (engine === null || typeof engine !== "object" || typeof engine.snapshot !== "function") {
    throw new RangeError("stateAt: engine must be a WorldModelEngine");
  }
  return { snapshot: engine.snapshot(atMs) };
}
