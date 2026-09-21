/**
 * THE WATERMARK/LAG STATE MACHINE (L004 design D3) — the five explicit,
 * honest, operator-visible per-source states, with PURE transitions.
 *
 * ```text
 *                ┌────────────────────────────────────────────────┐
 *                v                                                │
 *   BOOT ──first obs──> NOMINAL ──hole/delay──> REORDERING ──hole filled──> NOMINAL
 *                         │                          │
 *                         │ watermark lag >          │ buffer full OR
 *                         │ lagBudgetMs              │ no progress for
 *                         v                          │ stallBudgetMs
 *                      DEGRADED  <──recovery──  STALLED
 *                         │                          │
 *                         └──── source recovery accounting ──────────┘
 * ```
 *
 * EVALUATION RULE (pure function of injected facts — no wall clock inside
 * the engine): the states are evaluated with the documented priority
 *
 *   STALLED > DEGRADED > REORDERING > NOMINAL   (BOOT before any arrival)
 *
 * - `STALLED` is a LATCH set by the engine when no in-window progress has
 *   happened for `stallBudgetMs` (the latch is cleared by the next
 *   observation arrival — the post-reconnect recovery path).
 * - `DEGRADED` is the frozen §4 rule surfaced: `renderClockMs − watermarkMs
 *   > lagBudgetMs` — the source is behind the renderer beyond the budget;
 *   the state is exposed rather than pretending the feed is current.
 * - `REORDERING` is an open sequence hole or an out-of-order arrival still
 *   inside the bounded window.
 * - `NOMINAL` is everything quiet; `BOOT` is "no observations yet".
 *
 * A stall recovery with NO lag (a short gap the render clock did not outrun)
 * re-evaluates straight to `NOMINAL`/`REORDERING` — the honest degenerate
 * case of the same pure function (the design's `STALLED → DEGRADED →
 * NOMINAL` path assumes the reconnect actually created lag, which the
 * acceptance test drives explicitly).
 */

/** The closed five-state vocabulary (the D3 machine). */
export const TEMPORAL_SOURCE_STATES = [
  "BOOT",
  "NOMINAL",
  "REORDERING",
  "DEGRADED",
  "STALLED",
] as const;
export type TemporalSourceState = (typeof TEMPORAL_SOURCE_STATES)[number];

/** The pure inputs the state is a function of (all injected, all DATA). */
export interface SourceStateFacts {
  /** Whether any observation has ever arrived from this source. */
  hasObserved: boolean;
  /** Whether the stall latch is set (no in-window progress for the budget). */
  stalled: boolean;
  /** The number of currently OPEN (unfilled, unclosed) sequence holes. */
  openHoles: number;
  /** The honest watermark lag: `renderClockMs − watermarkMs` (>= 0). */
  watermarkLagMs: number;
  /** The lag budget (ms) beyond which the source is DEGRADED. */
  lagBudgetMs: number;
}

/**
 * Evaluates the per-source state as a PURE function of the facts, with the
 * documented priority `STALLED > DEGRADED > REORDERING > NOMINAL` (`BOOT`
 * before any arrival). The STALLED latch wins because a source that stopped
 * making progress is the strongest honest statement; DEGRADED outranks
 * REORDERING because the frozen §4 rule makes source-behind-renderer the
 * operator-facing alarm, while routine hole buffering is internal.
 */
export function evaluateSourceState(facts: SourceStateFacts): TemporalSourceState {
  if (facts.stalled) return "STALLED";
  if (!facts.hasObserved) return "BOOT";
  if (facts.watermarkLagMs > facts.lagBudgetMs) return "DEGRADED";
  if (facts.openHoles > 0) return "REORDERING";
  return "NOMINAL";
}
