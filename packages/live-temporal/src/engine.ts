/**
 * THE TEMPORAL BUFFER / WATERMARK ENGINE (L004 design D2/D3/D4/D5) — the
 * engine between the live source and the L003 updater: it buffers, reorders,
 * watermarks, accounts lag, and hands the updater a deterministic, in-order,
 * honestly-accounted observation stream.
 *
 * CONSUMPTION SEAM: `LiveSource → TemporalBufferEngine → LiveSwmUpdater →
 * WorldModelEngine` (the L003 design's composition). Both `admit` and `tick`
 * return a {@link DrainResult} — the batches applied, the gap markers emitted
 * and the per-source accounting AFTER the call — so every call's effects are
 * observable and the updater can consume the stream incrementally. Within one
 * result the `applied` batches are sorted by `(eventTimeMs, sequence,
 * sourceId)`; gap markers carry their sequence ranges so a consumer can
 * position each marker between its bracketing batches per source.
 *
 * THE RULES (each mapped to its design element):
 *
 * - ADMISSION (D2): a duplicate/replayed sequence (`<= ` the resolved
 *   frontier, or an exact re-arrival) is counted (`duplicateDropped`) and
 *   never re-applied — the L003 D7 rule owned at the engine seam too. An
 *   arriving observation with `eventTimeMs >= watermarkMs` is ADMITTED to the
 *   bounded buffer (sorted by `(eventTimeMs, sequence)`); an observation with
 *   `eventTimeMs < watermarkMs` is LATE — counted (`lateDropped`) and DROPPED
 *   (the window has already closed; a bounded window means drops beyond it
 *   are honest). The late check runs against the watermark AS IT STOOD when
 *   the batch arrived (before absorbing the batch's own contribution).
 * - THE BUFFER IS BOUNDED (D2.3): `maxBufferedBatches` (default 64); when an
 *   admission exceeds the bound the OLDEST buffered batch is FLUSHED to the
 *   updater ahead of watermark closure (applied in order with its honest event
 *   time; counted in `bufferOverflows`) — the engine never blocks the source
 *   and never drops in-window data due to fullness without accounting.
 * - THE WATERMARK (D1): per source, `watermarkMs = min(maxEmissionWatermark,
 *   maxEventTimeMs - reorderWindowMs)` clamped `>= 0` and MONOTONIC; the
 *   `sequence` member is the largest CONTIGUOUS RESOLVED sequence (applied by
 *   any drain reason, or accounted-dropped) — an unfilled hole or an in-flight
 *   buffered sequence holds it back; source sequence numbers are NEVER
 *   renumbered (a missed window stays a visible hole).
 * - HOLE MODEL (D4 drop): after every admission the open holes are recomputed
 *   as the maximal runs of NOT-YET-ARRIVED sequences inside
 *   `(lastContiguousSequence, maxSeenSequence]` — seen-but-buffered sequences
 *   split runs (an in-flight sequence is not a hole), so an out-of-order
 *   arrival FILLS exactly the range it covers. A hole closes when the
 *   watermark reaches its revealing event time (the event time of the first
 *   arrival that jumped past it — `holeClosedByWatermark`); its members are
 *   counted in `droppedObservations` and a `sequence-hole` {@link GapMarker}
 *   is emitted. Younger observations are HELD (state `REORDERING`) until the
 *   hole fills or closes.
 * - STALLED (D3): when a tick observes no in-window progress for
 *   `stallBudgetMs` of RENDER-CLOCK time, the engine latches `STALLED`,
 *   flushes the whole buffer in-order (honest event times, counted in
 *   `stallFlushes`) and holds. An in-window arrival clears the latch (the
 *   post-reconnect recovery path); a late-only arrival does not (an
 *   out-of-window arrival is not recovery).
 * - RECONNECT ACCOUNTING (D4 reconnect): the first post-reconnect observation
 *   carries the L002 `recovery` member — the engine consumes it VERBATIM: a
 *   `reconnect` {@link GapMarker} with the source's own `fromSequence` /
 *   `toSequence` / `missedUpdates` / `gapDurationMs` (never smoothed), the
 *   `reconnects` counter, and the missed members counted in
 *   `droppedObservations`.
 * - EXTRAPOLATION MARKING (D5): the engine NEVER interpolates positions. It
 *   counts the source's own honest carries — `detected: false` entity rows in
 *   APPLIED batches — as `extrapolatedObservations` (the §9 counter), and it
 *   emits gap markers. No position is ever invented.
 * - FINALIZE: the end-of-live-window drain flushes the remaining buffer
 *   (counted in `finalFlushes`) and closes any still-open holes with the same
 *   honest accounting (no further arrivals exist — the accounting is the
 *   guarantee). Admissions after finalize are refused fail-loud.
 *
 * DETERMINISM (the design's core promise): the engine reads NO wall clock, no
 * env, no RNG — every state transition is a pure function of the injected
 * (observation arrivals, render-clock ticks) sequence. The render clock MUST
 * be non-decreasing across ticks (a regressing render clock is a caller bug —
 * fail-loud, never silently absorbed).
 */
import type { Watermark } from "@sporta/contracts";
import type { LiveObservation } from "@sporta/live-source";
import { parseLiveObservation } from "@sporta/live-source";
import {
  DEFAULT_LAG_BUDGET_MS,
  DEFAULT_MAX_BUFFERED_BATCHES,
  DEFAULT_REORDER_WINDOW_MS,
  DEFAULT_STALL_BUDGET_MS,
  nextWatermarkMs,
  watermarkLagMs,
} from "./watermark";
import { evaluateSourceState } from "./states";
import { canonicalStatsJson, emptyTemporalEngineStats, type TemporalEngineStats } from "./stats";

// ---------------------------------------------------------------------------
// Configuration + typed errors
// ---------------------------------------------------------------------------

/** Configuration for {@link TemporalBufferEngine} (all DATA, all bounded). */
export interface TemporalBufferEngineConfig {
  /** The session this engine serves (admissions are session-checked). */
  sessionId: string;
  /** The bounded reorder window in ms (default 250; MUST be > 0). */
  reorderWindowMs?: number;
  /** The watermark-lag budget in ms beyond which a source is DEGRADED. */
  lagBudgetMs?: number;
  /** The no-progress budget in ms of render-clock time beyond which STALLED. */
  stallBudgetMs?: number;
  /** The bound on concurrently buffered batches per source (default 64). */
  maxBufferedBatches?: number;
}

/** A malformed engine configuration or admission (fail-loud, never silent). */
export class TemporalEngineValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`temporal buffer engine refused the input: ${issues.join("; ")}`);
    this.name = "TemporalEngineValidationError";
  }
}

// ---------------------------------------------------------------------------
// The drain stream (the L003 updater's input)
// ---------------------------------------------------------------------------

/** Why one buffered batch drained when it did (additive honesty accounting). */
export type DrainReason = "watermark" | "overflow" | "stall" | "final";

/** One applied observation batch, with its drain accounting. */
export interface AppliedBatch {
  /** The source the batch came from. */
  sourceId: string;
  /** The batch, VERBATIM as admitted (the frozen LiveObservation shape). */
  batch: LiveObservation;
  /** Why it drained now (the honest accounting). */
  drainReason: DrainReason;
  /** Entity rows in the batch (`entityObservations.length`). */
  entityRows: number;
  /** Carried (`detected: false`) entity rows — the §9 extrapolation counter. */
  extrapolatedRows: number;
}

/**
 * One accounted gap in the observation stream (D5): a closed sequence hole or
 * a consumed reconnect recovery. Live-layer data (outside the frozen
 * contracts); positions are NEVER interpolated across a gap.
 */
export interface GapMarker {
  sourceId: string;
  /** `sequence-hole`: engine-detected; `reconnect`: the L002 recovery member. */
  kind: "sequence-hole" | "reconnect";
  /** The first missed sequence (inclusive, source numbering — never renumbered). */
  fromSequence: number;
  /** The last missed sequence (INCLUSIVE). */
  toSequence: number;
  /** The gap's event-time span (ms), from the observed bracket or the source accounting. */
  gapDurationMs: number;
  /** Present on `reconnect` markers only: the VERBATIM source accounting. */
  missedUpdates?: number;
}

/** The per-source accounting snapshot carried on every {@link DrainResult}. */
export interface SourceDrainStats {
  sourceId: string;
  /** The source's watermark AFTER this drain (frozen shape, monotonic). */
  watermark: Watermark;
  /** The D6 counters (the §9 telemetry surface) AFTER this drain. */
  stats: TemporalEngineStats;
}

/**
 * The drain stream: the in-order applied batches (event-time ascending), the
 * gap markers, and the per-source accounting. JSON-safe, deterministic.
 */
export interface DrainResult {
  applied: readonly AppliedBatch[];
  gaps: readonly GapMarker[];
  /** Per-source accounting, sorted by sourceId (deterministic order). */
  sources: readonly SourceDrainStats[];
}

// ---------------------------------------------------------------------------
// Per-source engine state (DATA — one per admitted sourceId)
// ---------------------------------------------------------------------------

/** One open (unfilled, unclosed) sequence hole. */
export interface OpenHole {
  from: number;
  to: number;
  /** The event time of the first arrival that jumped past the hole (closure bound). */
  revealingEventTimeMs: number;
  /** The event time of the latest arrival BELOW the hole (the span bracket). */
  prevEventTimeMs: number;
}

/**
 * The mutable engine-side accounting for the effective-update-rate and
 * dual-clock latency counters (sums, not just means, so snapshots stay pure).
 */
interface AppliedSums {
  batches: number;
  entityRows: number;
  extrapolatedRows: number;
  ingestMinusEventSumMs: number;
  firstEventTimeMs: number | null;
  lastEventTimeMs: number | null;
}

interface SourceState {
  sourceId: string;
  hasObserved: boolean;
  watermark: Watermark;
  maxEventTimeMs: number;
  /** The largest EMISSION watermark ever seen (a guarantee is never retracted). */
  maxEmissionWatermarkMs: number;
  /** The largest contiguous RESOLVED sequence (applied by any drain, or accounted). */
  lastContiguousSequence: number;
  /** Sequences released to the updater or accounted-dropped (the resolved set). */
  resolved: Set<number>;
  /** Every admitted arrival's event time, by sequence (the hole bookkeeping). */
  seenEventTimes: Map<number, number>;
  /** The largest sequence ever admitted from this source. */
  maxSeenSequence: number;
  /** The bounded reorder buffer, sorted by (eventTimeMs, sequence). */
  buffered: LiveObservation[];
  openHoles: OpenHole[];
  stallLatched: boolean;
  /** The render clock of the last tick that observed progress (null pre-tick). */
  lastProgressRenderClockMs: number | null;
  /** Admissions that landed in-window since the previous tick (progress evidence). */
  admittedSinceLastTick: number;
  finalized: boolean;
  stats: TemporalEngineStats;
  sums: AppliedSums;
}

function emptySums(): AppliedSums {
  return {
    batches: 0,
    entityRows: 0,
    extrapolatedRows: 0,
    ingestMinusEventSumMs: 0,
    firstEventTimeMs: null,
    lastEventTimeMs: null,
  };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * The temporal buffer / watermark engine (L004). Created through
 * {@link createTemporalBufferEngine}; session-scoped, multi-source (per-source
 * watermarks, buffers and accounting — multiple sources NEVER contaminate
 * each other's temporal state; the fusion of their evidence is the L012
 * updater lane's concern, not the engine's).
 */
export class TemporalBufferEngine {
  readonly sessionId: string;
  private readonly reorderWindowMs: number;
  private readonly lagBudgetMs: number;
  private readonly stallBudgetMs: number;
  private readonly maxBufferedBatches: number;
  private readonly sources = new Map<string, SourceState>();
  private lastRenderClockMs: number | null = null;
  private finalized = false;

  constructor(config: TemporalBufferEngineConfig) {
    const issues: string[] = [];
    if (typeof config.sessionId !== "string" || config.sessionId.length === 0) {
      issues.push("sessionId must be a non-empty string");
    }
    const reorderWindowMs = config.reorderWindowMs ?? DEFAULT_REORDER_WINDOW_MS;
    if (!(reorderWindowMs > 0) || !Number.isFinite(reorderWindowMs)) {
      issues.push(
        `reorderWindowMs (${reorderWindowMs}) must be a finite number > 0 (default ${DEFAULT_REORDER_WINDOW_MS})`,
      );
    }
    const lagBudgetMs = config.lagBudgetMs ?? DEFAULT_LAG_BUDGET_MS;
    if (!(lagBudgetMs > 0) || !Number.isFinite(lagBudgetMs)) {
      issues.push(`lagBudgetMs (${lagBudgetMs}) must be a finite number > 0`);
    }
    const stallBudgetMs = config.stallBudgetMs ?? DEFAULT_STALL_BUDGET_MS;
    if (!(stallBudgetMs > 0) || !Number.isFinite(stallBudgetMs)) {
      issues.push(`stallBudgetMs (${stallBudgetMs}) must be a finite number > 0`);
    }
    const maxBufferedBatches = config.maxBufferedBatches ?? DEFAULT_MAX_BUFFERED_BATCHES;
    if (!Number.isInteger(maxBufferedBatches) || maxBufferedBatches < 1) {
      issues.push(`maxBufferedBatches (${maxBufferedBatches}) must be an integer >= 1`);
    }
    if (issues.length > 0) throw new TemporalEngineValidationError(issues);
    this.sessionId = config.sessionId;
    this.reorderWindowMs = reorderWindowMs;
    this.lagBudgetMs = lagBudgetMs;
    this.stallBudgetMs = stallBudgetMs;
    this.maxBufferedBatches = maxBufferedBatches;
  }

  // -- Public read surface ---------------------------------------------------

  /** The engine's configuration, echoed for reports (DATA). */
  get configuration(): Readonly<
    Pick<
      TemporalBufferEngineConfig,
      "sessionId" | "reorderWindowMs" | "lagBudgetMs" | "stallBudgetMs" | "maxBufferedBatches"
    >
  > {
    return Object.freeze({
      sessionId: this.sessionId,
      reorderWindowMs: this.reorderWindowMs,
      lagBudgetMs: this.lagBudgetMs,
      stallBudgetMs: this.stallBudgetMs,
      maxBufferedBatches: this.maxBufferedBatches,
    });
  }

  /** Whether the live window has been finalized (the session drain is done). */
  get isFinalized(): boolean {
    return this.finalized;
  }

  /**
   * The per-source accounting snapshot (all sources, sorted by sourceId) —
   * the §9 telemetry surface for the L006 aggregation.
   */
  stats(): readonly SourceDrainStats[] {
    return this.snapshotSources();
  }

  // -- Admission (D2) ---------------------------------------------------------

  /**
   * Admits one observation batch. Validates it against the frozen
   * LiveObservation contract (fail-loud — the L003 D7 rule applied at the
   * engine seam too), then applies the admission rules and returns the drain
   * stream this admission caused (late drops and duplicates are COUNTED; an
   * overflow flush or a watermark-driven release/hole-closure may apply
   * batches and emit gap markers).
   */
  admit(document: LiveObservation): DrainResult {
    if (this.finalized) {
      throw new TemporalEngineValidationError([
        "the live window is finalized — no further admissions (the finalize drain is the end of the session)",
      ]);
    }
    const parsed = parseLiveObservation(document);
    if (parsed.sessionId !== this.sessionId) {
      throw new TemporalEngineValidationError([
        `sessionId "${parsed.sessionId}" does not match the engine session "${this.sessionId}" (wrongSession — never partially applied)`,
      ]);
    }

    const source = this.sourceFor(parsed.sourceId);
    const { applied, gaps } = emptyDrain();

    // Duplicate/replay first (identity-level refusal): a sequence at or below
    // the resolved frontier, or an exact re-arrival, is counted and never
    // re-applied (L003's D7 rule).
    if (
      parsed.sequence <= source.lastContiguousSequence ||
      source.seenEventTimes.has(parsed.sequence)
    ) {
      source.stats.duplicateDropped += 1;
      return this.endDrain(applied, gaps);
    }
    // The late check runs against the watermark AS IT STOOD when this batch
    // arrived (before absorbing the batch's own contribution) — documented.
    if (parsed.eventTimeMs < source.watermark.watermarkMs) {
      source.stats.lateDropped += 1;
      return this.endDrain(applied, gaps);
    }

    source.hasObserved = true;
    source.seenEventTimes.set(parsed.sequence, parsed.eventTimeMs);
    source.maxSeenSequence = Math.max(source.maxSeenSequence, parsed.sequence);
    source.maxEventTimeMs = Math.max(source.maxEventTimeMs, parsed.eventTimeMs);
    source.maxEmissionWatermarkMs = Math.max(
      source.maxEmissionWatermarkMs,
      parsed.watermark.watermarkMs,
    );
    source.admittedSinceLastTick += 1;
    // An in-window arrival is recovery evidence: the stall latch clears here
    // (the tick refreshes the progress clock; a late-only arrival never does).
    source.stallLatched = false;

    // The reconnect recovery accounting is consumed VERBATIM on the first
    // post-reconnect arrival (before the batch joins the buffer — the marker
    // precedes the recovery batch in the stream).
    if (parsed.recovery !== undefined) {
      const recovery = parsed.recovery;
      source.stats.reconnects += 1;
      let newlyAccounted = 0;
      for (let seq = recovery.fromSequence; seq <= recovery.toSequence; seq += 1) {
        if (!source.resolved.has(seq)) {
          source.resolved.add(seq);
          newlyAccounted += 1;
        }
      }
      source.stats.droppedObservations += newlyAccounted;
      gaps.push({
        sourceId: source.sourceId,
        kind: "reconnect",
        fromSequence: recovery.fromSequence,
        toSequence: recovery.toSequence,
        gapDurationMs: recovery.gapDurationMs,
        missedUpdates: recovery.missedUpdates,
      });
      // The accounted gap members are resolved: the frontier walks past
      // them (the recovery batch itself is still in flight below the walk's
      // stop — the hole stays visible in the sequence numbering).
      this.advanceContiguous(source);
    }

    // Buffered in (eventTimeMs, sequence) order — the reorder core — then
    // the hole bookkeeping recomputed from the seen map.
    insertSorted(source.buffered, parsed);
    recomputeHoles(source);

    // The bounded-buffer rule (D2.3): an admission past the bound flushes the
    // OLDEST buffered batch ahead of watermark closure (never a silent drop).
    if (source.buffered.length > this.maxBufferedBatches) {
      const oldest = source.buffered.shift();
      if (oldest !== undefined) {
        this.applyBatch(applied, source, oldest, "overflow");
        source.stats.bufferOverflows += 1;
      }
    }

    // The watermark may advance from this arrival's own emission guarantee
    // (a hole may close, ready batches may release) — all accounted here.
    this.advanceWatermark(source);
    this.closeHoles(gaps, source);
    this.releaseReady(applied, source);
    return this.endDrain(applied, gaps);
  }

  // -- The render-clock tick (D3) ---------------------------------------------

  /**
   * One render-clock tick: advances every source's watermark, closes holes
   * the window has passed, releases ready batches, evaluates the stall latch
   * (flushing the buffer when it trips) and re-evaluates the honest state
   * machine. The render clock MUST be non-decreasing (fail-loud).
   */
  tick(renderClockMs: number): DrainResult {
    if (typeof renderClockMs !== "number" || !Number.isFinite(renderClockMs) || renderClockMs < 0) {
      throw new TemporalEngineValidationError([
        `renderClockMs (${renderClockMs}) must be a finite number >= 0`,
      ]);
    }
    if (this.lastRenderClockMs !== null && renderClockMs < this.lastRenderClockMs) {
      throw new TemporalEngineValidationError([
        `renderClockMs (${renderClockMs}) regressed below the previous tick (${this.lastRenderClockMs}) — a render clock cannot move backwards`,
      ]);
    }
    this.lastRenderClockMs = renderClockMs;
    const { applied, gaps } = emptyDrain();

    for (const source of this.sortedSources()) {
      const before = {
        watermarkMs: source.watermark.watermarkMs,
        sequence: source.watermark.sequence,
        buffered: source.buffered.length,
        holes: source.openHoles.length,
      };
      this.advanceWatermark(source);
      this.closeHoles(gaps, source);
      this.releaseReady(applied, source);

      // -- stall accounting (D3): progress since the previous tick? ----------
      const progressed =
        source.admittedSinceLastTick > 0 ||
        source.watermark.watermarkMs !== before.watermarkMs ||
        source.watermark.sequence !== before.sequence ||
        source.buffered.length !== before.buffered ||
        source.openHoles.length !== before.holes;
      source.admittedSinceLastTick = 0;
      if (progressed) {
        source.stallLatched = false;
        source.lastProgressRenderClockMs = renderClockMs;
      } else if (
        source.lastProgressRenderClockMs !== null &&
        renderClockMs - source.lastProgressRenderClockMs > this.stallBudgetMs
      ) {
        // No in-window progress for the budget: latch STALLED and flush the
        // buffer in-order with honest event times (never a silent hold).
        source.stallLatched = true;
        const held = [...source.buffered];
        source.buffered.length = 0;
        for (const batch of held) {
          this.applyBatch(applied, source, batch, "stall");
          source.stats.stallFlushes += 1;
        }
      }
    }
    return this.endDrain(applied, gaps);
  }

  // -- Finalize (the end-of-live-window drain) --------------------------------

  /**
   * Closes the live window: flushes every source's remaining buffer in-order
   * (counted in `finalFlushes`) and closes still-open holes with the same
   * honest accounting (no further arrivals exist — the accounting is the
   * guarantee). Subsequent admissions are refused fail-loud.
   */
  finalize(): DrainResult {
    if (this.finalized) {
      throw new TemporalEngineValidationError([
        "the live window is already finalized (finalize is once per session)",
      ]);
    }
    const { applied, gaps } = emptyDrain();
    for (const source of this.sortedSources()) {
      const held = [...source.buffered];
      source.buffered.length = 0;
      for (const batch of held) {
        this.applyBatch(applied, source, batch, "final");
        source.stats.finalFlushes += 1;
      }
      // Still-open holes at the end of the window are accounted gaps (there
      // will be no further arrivals to fill them).
      for (const hole of source.openHoles) {
        this.accountHole(gaps, source, hole);
      }
      source.openHoles = [];
      source.finalized = true;
      source.stats.finalized = true;
    }
    this.finalized = true;
    return this.endDrain(applied, gaps);
  }

  // -- Internal machinery ------------------------------------------------------

  private sourceFor(sourceId: string): SourceState {
    const existing = this.sources.get(sourceId);
    if (existing !== undefined) return existing;
    const created: SourceState = {
      sourceId,
      hasObserved: false,
      watermark: { watermarkMs: 0, sequence: 0 },
      maxEventTimeMs: 0,
      maxEmissionWatermarkMs: 0,
      lastContiguousSequence: 0,
      resolved: new Set<number>(),
      seenEventTimes: new Map<number, number>(),
      maxSeenSequence: 0,
      buffered: [],
      openHoles: [],
      stallLatched: false,
      lastProgressRenderClockMs: null,
      admittedSinceLastTick: 0,
      finalized: false,
      stats: emptyTemporalEngineStats("BOOT"),
      sums: emptySums(),
    };
    this.sources.set(sourceId, created);
    return created;
  }

  private sortedSources(): SourceState[] {
    return [...this.sources.values()].sort((a, b) =>
      a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
    );
  }

  /** Recomputes the conservative monotonic watermark (D1). */
  private advanceWatermark(source: SourceState): void {
    const candidate = nextWatermarkMs({
      sourceEmissionWatermarkMs: source.maxEmissionWatermarkMs,
      maxEventTimeMs: source.maxEventTimeMs,
      reorderWindowMs: this.reorderWindowMs,
      previousMs: source.watermark.watermarkMs,
    });
    if (candidate !== source.watermark.watermarkMs) {
      source.watermark = { watermarkMs: candidate, sequence: source.watermark.sequence };
    }
  }

  /** Closes holes the watermark has passed (the D4 drop rule). */
  private closeHoles(gaps: GapMarker[], source: SourceState): void {
    if (source.openHoles.length === 0) return;
    const remaining: OpenHole[] = [];
    for (const hole of source.openHoles) {
      if (source.watermark.watermarkMs >= hole.revealingEventTimeMs) {
        this.accountHole(gaps, source, hole);
      } else {
        remaining.push(hole);
      }
    }
    source.openHoles = remaining;
  }

  /** Accounts one closed hole: resolved members + the gap marker (D5). */
  private accountHole(gaps: GapMarker[], source: SourceState, hole: OpenHole): void {
    let members = 0;
    for (let seq = hole.from; seq <= hole.to; seq += 1) {
      if (!source.resolved.has(seq)) {
        source.resolved.add(seq);
        members += 1;
      }
    }
    source.stats.droppedObservations += members;
    source.stats.holesClosed += 1;
    gaps.push({
      sourceId: source.sourceId,
      kind: "sequence-hole",
      fromSequence: hole.from,
      toSequence: hole.to,
      // The observed event-time span of the hole window: the bracketing
      // arrivals' event times (honest measurement from arrived data).
      gapDurationMs: Math.max(0, hole.revealingEventTimeMs - hole.prevEventTimeMs),
    });
    this.advanceContiguous(source);
  }

  /** Walks the resolved set forward (holes visible: the walk stops at gaps). */
  private advanceContiguous(source: SourceState): void {
    let next = source.lastContiguousSequence + 1;
    while (source.resolved.has(next)) next += 1;
    source.lastContiguousSequence = next - 1;
    if (source.lastContiguousSequence !== source.watermark.sequence) {
      source.watermark = {
        watermarkMs: source.watermark.watermarkMs,
        sequence: source.lastContiguousSequence,
      };
    }
  }

  /** Releases every buffered batch the watermark has passed, in order (D2). */
  private releaseReady(applied: AppliedBatch[], source: SourceState): void {
    // The buffer is (eventTimeMs, sequence)-sorted: releasing the head in a
    // loop keeps the applied stream in order; the first not-yet-passed batch
    // stops the drain (the bounded window holds it back).
    while (source.buffered.length > 0) {
      const batch = source.buffered[0]!;
      if (batch.eventTimeMs >= source.watermark.watermarkMs) break;
      source.buffered.splice(0, 1);
      this.applyBatch(applied, source, batch, "watermark");
    }
  }

  /** Applies one batch to the drain stream + the accounting (all reasons). */
  private applyBatch(
    applied: AppliedBatch[],
    source: SourceState,
    batch: LiveObservation,
    reason: DrainReason,
  ): void {
    const extrapolatedRows = batch.entityObservations.filter((row) => !row.detected).length;
    source.resolved.add(batch.sequence);
    source.stats.appliedBatches += 1;
    source.stats.appliedEntityRows += batch.entityObservations.length;
    source.stats.extrapolatedObservations += extrapolatedRows;
    source.sums.batches += 1;
    source.sums.entityRows += batch.entityObservations.length;
    source.sums.extrapolatedRows += extrapolatedRows;
    source.sums.ingestMinusEventSumMs += batch.ingestTimeMs - batch.eventTimeMs;
    if (source.sums.firstEventTimeMs === null) source.sums.firstEventTimeMs = batch.eventTimeMs;
    source.sums.lastEventTimeMs = batch.eventTimeMs;
    applied.push({
      sourceId: source.sourceId,
      batch,
      drainReason: reason,
      entityRows: batch.entityObservations.length,
      extrapolatedRows,
    });
    this.advanceContiguous(source);
  }

  // -- Drain-result construction ----------------------------------------------

  private endDrain(applied: AppliedBatch[], gaps: GapMarker[]): DrainResult {
    applied.sort(
      (a, b) =>
        a.batch.eventTimeMs - b.batch.eventTimeMs ||
        a.batch.sequence - b.batch.sequence ||
        (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0),
    );
    return Object.freeze({
      applied: Object.freeze(applied),
      gaps: Object.freeze(gaps),
      sources: Object.freeze(this.snapshotSources()),
    }) as DrainResult;
  }

  /** The per-source stats snapshot (fresh objects; deterministic order). */
  private snapshotSources(): SourceDrainStats[] {
    const out: SourceDrainStats[] = [];
    for (const source of this.sortedSources()) {
      out.push({
        sourceId: source.sourceId,
        watermark: { ...source.watermark },
        stats: this.statsSnapshotOf(source),
      });
    }
    return out;
  }

  /** Materializes the D6 counters for one source at snapshot time. */
  private statsSnapshotOf(source: SourceState): TemporalEngineStats {
    const lagMs =
      this.lastRenderClockMs === null
        ? 0
        : watermarkLagMs(this.lastRenderClockMs, source.watermark.watermarkMs);
    const { sums } = source;
    const spanMs =
      sums.firstEventTimeMs !== null &&
      sums.lastEventTimeMs !== null &&
      sums.lastEventTimeMs > sums.firstEventTimeMs
        ? sums.lastEventTimeMs - sums.firstEventTimeMs
        : null;
    return {
      ...source.stats,
      watermarkLagMs: lagMs,
      effectiveUpdateRate:
        sums.batches > 1 && spanMs !== null && spanMs > 0
          ? Math.round(((sums.batches - 1) / (spanMs / 1000)) * 1000) / 1000
          : null,
      meanSourceToIngestMs:
        sums.batches > 0
          ? Math.round((sums.ingestMinusEventSumMs / sums.batches) * 1000) / 1000
          : null,
      bufferedBatches: source.buffered.length,
      finalized: source.finalized,
      state: evaluateSourceState({
        hasObserved: source.hasObserved,
        stalled: source.stallLatched,
        openHoles: source.openHoles.length,
        watermarkLagMs: lagMs,
        lagBudgetMs: this.lagBudgetMs,
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function emptyDrain(): { applied: AppliedBatch[]; gaps: GapMarker[] } {
  return { applied: [], gaps: [] };
}

/** The stable total order of one source's buffered batches. */
function batchBefore(a: LiveObservation, b: LiveObservation): boolean {
  return (
    a.eventTimeMs < b.eventTimeMs || (a.eventTimeMs === b.eventTimeMs && a.sequence < b.sequence)
  );
}

/** Inserts one batch into the (eventTimeMs, sequence)-sorted buffer. */
function insertSorted(buffer: LiveObservation[], batch: LiveObservation): void {
  let index = buffer.length;
  while (index > 0 && batchBefore(batch, buffer[index - 1]!)) {
    index -= 1;
  }
  buffer.splice(index, 0, batch);
}

/**
 * Recomputes the open holes from the seen/resolved maps (pure — the model is
 * rebuilt from scratch on every arrival regardless of arrival order, which
 * keeps it obviously correct for interleaved drop/reconnect patterns):
 *
 * - the ARRIVED sequences above the frontier, in sequence order, bracket the
 *   candidate runs: every un-arrived sequence between two consecutive
 *   arrivals is a candidate hole member;
 * - ACCOUNTED sequences (resolved without ever arriving — closed by the
 *   watermark or by recovery accounting) are CLOSED gaps: they never
 *   re-open, and they SPLIT a candidate run (only the un-accounted sub-runs
 *   are open holes);
 * - the revealing event time of an open hole is the event time of the first
 *   arrival ABOVE its candidate run (the arrival that jumped past it — the
 *   watermark must reach it to close the hole); the bracket below is the
 *   event time of the last arrival UNDER the run (the frontier batch's event
 *   time when the run sits directly above the resolved frontier).
 */
function recomputeHoles(source: SourceState): void {
  const holes: OpenHole[] = [];
  const arrived: Array<{ seq: number; eventTimeMs: number }> = [];
  for (let seq = source.lastContiguousSequence + 1; seq <= source.maxSeenSequence; seq += 1) {
    const eventTime = source.seenEventTimes.get(seq);
    if (eventTime !== undefined) arrived.push({ seq, eventTimeMs: eventTime });
  }
  // The honest lower bracket for a run sitting directly above the frontier:
  // the latest APPLIED batch's event time (per source, batches apply in
  // event-time ascending order across every drain reason, so this is the
  // frontier batch's own event time when the frontier is an applied batch;
  // 0 before any application — the session-start bracket).
  const frontierBracketMs = source.sums.lastEventTimeMs !== null ? source.sums.lastEventTimeMs : 0;

  let prevArrived: { seq: number; eventTimeMs: number } | null = null;
  for (const current of arrived) {
    if (prevArrived !== null && current.seq > prevArrived.seq + 1) {
      pushHoleRuns(
        holes,
        source,
        prevArrived.seq + 1,
        current.seq - 1,
        current.eventTimeMs,
        prevArrived.eventTimeMs,
      );
    }
    prevArrived = current;
  }
  // A run still open above the LAST arrival is impossible: maxSeenSequence is
  // by definition an ARRIVED sequence, so every candidate run is bracketed
  // above by an arrival. A run between the frontier and the FIRST arrival is
  // bracketed by the frontier bracket below.
  if (arrived.length > 0 && arrived[0]!.seq > source.lastContiguousSequence + 1) {
    pushHoleRuns(
      holes,
      source,
      source.lastContiguousSequence + 1,
      arrived[0]!.seq - 1,
      arrived[0]!.eventTimeMs,
      frontierBracketMs,
    );
  }
  source.openHoles = holes;
}

/**
 * Splits one candidate run `[from, to]` on its ACCOUNTED sequences and pushes
 * each maximal un-accounted sub-run as an open hole (revealing event time =
 * the first arrival above the whole candidate run; bracket below = the last
 * arrival under it).
 */
function pushHoleRuns(
  holes: OpenHole[],
  source: SourceState,
  from: number,
  to: number,
  revealingEventTimeMs: number,
  prevEventTimeMs: number,
): void {
  let runFrom: number | null = null;
  for (let seq = from; seq <= to; seq += 1) {
    if (source.resolved.has(seq)) {
      // A closed gap splits the run (it is accounted — never re-opened).
      if (runFrom !== null) {
        holes.push({ from: runFrom, to: seq - 1, revealingEventTimeMs, prevEventTimeMs });
        runFrom = null;
      }
      continue;
    }
    if (runFrom === null) runFrom = seq;
  }
  if (runFrom !== null) {
    holes.push({ from: runFrom, to, revealingEventTimeMs, prevEventTimeMs });
  }
}

/** Creates the temporal buffer / watermark engine (L004). */
export function createTemporalBufferEngine(
  config: TemporalBufferEngineConfig,
): TemporalBufferEngine {
  return new TemporalBufferEngine(config);
}

export { canonicalStatsJson };
