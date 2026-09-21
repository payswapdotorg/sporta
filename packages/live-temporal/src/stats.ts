/**
 * THE HONEST COUNTERS (L004 design D6) — the per-source accounting the engine
 * emits on every {@link DrainResult}: every §9 telemetry counter the frozen
 * live contract names for this stage, plus the additive honesty counters
 * (why each observation drained) that make the accounting complete.
 *
 * §9 mapping (docs/contracts/live-reality.md §9 — minimum operational
 * telemetry; asserted by test/scenarios.test.ts):
 *
 * | §9 counter | Engine stat |
 * | --- | --- |
 * | watermark lag | `watermarkLagMs` |
 * | dropped observations | `lateDropped` + `droppedObservations` |
 * | extrapolated observations | `extrapolatedObservations` |
 * | reconnects | `reconnects` |
 * | effective update rate | `effectiveUpdateRate` |
 * | source-to-ingest latency | `meanSourceToIngestMs` (from the observation dual clocks — the ingest clock minus the event clock of APPLIED batches) |
 *
 * `SWM-to-render` latency is the L005/L006 lane; `ingest-to-SWM` comes from
 * the L003 report timestamps paired with the dual clocks. The engine
 * exports these counters for the L006 aggregation.
 */
import type { TemporalSourceState } from "./states";

/** The per-source counted accounting (never a silent anything). */
export interface TemporalEngineStats {
  // -- The design-D6 counters (the §9 surface) --------------------------------
  /** Beyond-window arrivals (counted, never silent). */
  lateDropped: number;
  /** Sequence-hole members closed by the watermark / recovery accounting. */
  droppedObservations: number;
  /** Buffer-fullness flushes (the never-block-the-source rule). */
  bufferOverflows: number;
  /** Carried (`detected: false`) entity rows in APPLIED batches (the §9 counter). */
  extrapolatedObservations: number;
  /** Recovery-accounted reconnects (the §9 counter). */
  reconnects: number;
  /** The honest watermark lag: `renderClockMs − watermarkMs` (>= 0). */
  watermarkLagMs: number;
  /** Applied observations per second of elapsed session time (null before measurable). */
  effectiveUpdateRate: number | null;
  /** The explicit, operator-visible state (the D3 machine). */
  state: TemporalSourceState;

  // -- Additive honesty counters (why each observation drained) ---------------
  /** Batches applied to the drain stream (all drain reasons). */
  appliedBatches: number;
  /** Entity rows inside applied batches (context for the extrapolated count). */
  appliedEntityRows: number;
  /** Batches flushed by the STALLED entry (in-order, honest event times). */
  stallFlushes: number;
  /** Batches flushed by the session FINALIZE (the end-of-live-window drain). */
  finalFlushes: number;
  /** Exact-sequence duplicates dropped at admission (the updater owns the D7 rule too). */
  duplicateDropped: number;
  /** Sequence holes closed (each emits a gap marker). */
  holesClosed: number;
  /** The mean `ingestTimeMs − eventTimeMs` over APPLIED batches (the dual-clock latency). */
  meanSourceToIngestMs: number | null;
  /** Batches currently held in the bounded reorder buffer. */
  bufferedBatches: number;
  /** Whether the source's stream has been finalized (no further admissions). */
  finalized: boolean;
}

/** The initial all-zero stats for a fresh source. */
export function emptyTemporalEngineStats(state: TemporalSourceState): TemporalEngineStats {
  return {
    lateDropped: 0,
    droppedObservations: 0,
    bufferOverflows: 0,
    extrapolatedObservations: 0,
    reconnects: 0,
    watermarkLagMs: 0,
    effectiveUpdateRate: null,
    state,
    appliedBatches: 0,
    appliedEntityRows: 0,
    stallFlushes: 0,
    finalFlushes: 0,
    duplicateDropped: 0,
    holesClosed: 0,
    meanSourceToIngestMs: null,
    bufferedBatches: 0,
    finalized: false,
  };
}

/**
 * Canonical serialization of one stats record (key-sorted JSON — the
 * deterministic evidence form; mirrors the repo's canonical-serializer
 * convention).
 */
export function canonicalStatsJson(stats: TemporalEngineStats): string {
  const keys = Object.keys(stats).sort() as (keyof TemporalEngineStats)[];
  const parts: string[] = [];
  for (const key of keys) {
    const value = stats[key];
    parts.push(`${JSON.stringify(key)}:${JSON.stringify(value === undefined ? null : value)}`);
  }
  return `{${parts.join(",")}}`;
}
