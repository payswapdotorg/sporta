/**
 * THE MULTI-SOURCE FUSION ENGINE (L012) — the DRIVER that composes the
 * existing live seams for CONCURRENT sources:
 *
 * ```text
 * sources (2+) → LiveFusionEngine.admit()/tick()/finalize()
 *                 ├─ admissions/ticks delegate → TemporalBufferEngine (L004,
 *                 │  per-source state — never contaminated)
 *                 ├─ each DrainResult is FUSED: co-observation grouping,
 *                 │  cross-source conflict detection (the batch ledger
 *                 │  shape), deterministic arbitration, withholding
 *                 └─ the fused batches apply → LiveSwmUpdater (L003)
 *                       → WorldModelEngine (the ONE canonical SWM)
 * ```
 *
 * Like L003, this engine holds NO world state of its own: positions,
 * versions, events and football state live in the canonical engine. Its own
 * state is the arbitration MEMORY — the last APPLIED row per
 * (entity, source), bounded by entities × sources — plus the fusion-layer
 * accounting.
 *
 * THE RULES (the design's D1-D9, each enforced here):
 *
 * - D1 COEXISTENCE: a drain with no cross-source co-observation passes
 *   every batch VERBATIM (identity, provenance, confidence, clocks,
 *   watermarks untouched) — single-source behavior is the Wave 2 behavior.
 * - D2 PROVENANCE VERBATIM: the fusion layer NEVER rewrites a batch field
 *   except `entityObservations` (arbitration filtering). The updater's D3
 *   projection + D6 bridge carry per-source provenance into the SWM.
 * - D3/D4 CONFLICTS: cross-source disagreement beyond the
 *   movement-plausibility tolerance mints a `ConflictRecord` (the batch
 *   `@sporta/fusion` shape — one conflict vocabulary across batch and
 *   live; observation ids use the bridge scheme so the ledger and the SWM
 *   evidence chain address the same rows). `resolution: "none"` — the
 *   conflict STANDS.
 * - D5 ARBITRATION (deterministic, documented, tested — never a silent
 *   winner, never a silent average): rows at DIFFERENT event times are
 *   sequential updates (both apply; event-time authority — the frozen
 *   temporal rule; the engine's own no-op guard makes rewinds impossible).
 *   A SAME-TIME tie inside a CONFLICTING group is decided by the CANONICAL
 *   REPLAY ORDER: the survivor is the tie's max row by `(sourceId,
 *   sequence)` — the exact row the W005 store's batch replay applies LAST
 *   (the zero-padded bridge id scheme makes the lexicographic observation
 *   id order = the (sourceId, sequence) order), so the frozen §8
 *   live-to-replay equality holds BY CONSTRUCTION for EVERY arrival order
 *   (a late-arriving canonical-max applies on top; a late-arriving
 *   non-max is WITHHELD — the engine converges to the canonical-max of
 *   arrived tied rows, arrival-order-free). The other tied rows are
 *   WITHHELD from the updater (counted, ledger-recorded, never bridged —
 *   D8); the survivor's row applies VERBATIM (never averaged). The
 *   OPERATOR'S PRECEDENCE PREFERENCE (the policy's `sourcePrecedence`) is
 *   REPORTED on every decision (preferred source + whether it matches the
 *   survivor) and governs the fallback reporting — it can NEVER override
 *   the canonical survivor (that would break the frozen §8 equality for
 *   late arrivals; a precedence override is a contract-change REQUEST,
 *   never a silent patch).
 * - D5 CANONICAL APPLICATION ORDER: within a drain the fused batches apply
 *   sorted by `(eventTimeMs, sourceId, sequence)` — the batch-level
 *   projection of the same canonical replay order — so agreeing tied rows
 *   (both applied) also end on the canonical-last row, exactly like the
 *   replay.
 * - D6 SOURCE LOSS: the L004 per-source state machine consumed VERBATIM —
 *   entering STALLED (a previously-seen stream that dropped) is a
 *   `source-lost` event; leaving it is `source-recovered`. While any
 *   previously-seen source is lost, `fallbackActive` is true: the
 *   surviving sources carry the world, VISIBLE (event-time authority
 *   continues — the deterministic fallback).
 * - D7 ACCOUNTING: per-batch L003 reports VERBATIM, per-source L004
 *   counters VERBATIM (never double-counted — the fusion layer adds only
 *   its own counters), the §9 snapshot sums, the arbitration decisions,
 *   the source events.
 * - D8 REPLAY EQUALITY: withheld rows never reach the updater — never the
 *   W005 bridge — so a batch `runWorldFusion` pass over the same store
 *   replays exactly the arbitrated stream (pinned by the integration
 *   test). The withheld evidence lives in the conflict ledger.
 * - D9 NO INVALID DOCUMENTS: a fused batch whose rows were ALL withheld is
 *   SUPPRESSED (counted `suppressedBatches` — the frozen contract requires
 *   ≥1 entity row; the L004 sequence accounting already resolved that
 *   batch upstream, so the stream's hole accounting stays honest).
 *
 * DETERMINISM: no wall clock, no env, no RNG. The render clock is INJECTED
 * per tick (evidence time only — admissions are clockless at L004; the
 * fusion report's `renderClockMs` carries the last injected clock). The
 * same (admissions, ticks, policy) sequence always produces the same
 * reports and the same engine state.
 */
import type { LiveObservation } from "@sporta/live-source";
import { parseLiveObservation } from "@sporta/live-source";
import type { LiveSwmUpdater, LiveUpdateReport } from "@sporta/live-swm";
import type { DrainResult, TemporalBufferEngine } from "@sporta/live-temporal";
import type { ConflictRecord } from "@sporta/fusion";
import { parseFusionPolicy, type LiveFusionPolicy } from "./policy";
import {
  agreeWithinTolerance,
  coObservationGroupsOf,
  distanceM,
  drainRowsOf,
  sameTimeTiesOf,
  type CoObservationGroup,
  type DrainRow,
} from "./groups";
import { conflictRecordOf, liveObservationIdOf } from "./conflicts";
import {
  emptyFusionStats,
  type FusionArbitrationDecision,
  type FusionReport,
  type FusionSourceEvent,
  type FusionSourceState,
  type FusionSourceSummary,
  type FusionStats,
} from "./report";
/** Options for {@link createLiveFusionEngine}. */
export interface LiveFusionEngineOptions {
  /** The session this engine serves (must match both injected seams). */
  sessionId: string;
  /** The L004 temporal engine (INJECTED — per-source state, never owned here). */
  temporal: TemporalBufferEngine;
  /** The L003 incremental updater (INJECTED — the ONE canonical driver). */
  updater: LiveSwmUpdater;
  /** The deterministic arbitration/tie/fallback policy (defaults: {@link parseFusionPolicy}). */
  policy?: Partial<LiveFusionPolicy>;
}

/** A malformed fusion engine configuration (fail-loud). */
export class LiveFusionEngineValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`live fusion engine refused the input: ${issues.join("; ")}`);
    this.name = "LiveFusionEngineValidationError";
  }
}

/** The per-source fusion-layer accounting (cumulative across the run). */
interface SourceFusionCounters {
  batchesApplied: number;
  rowsApplied: number;
  rowsWithheld: number;
  rowsCorroborating: number;
  conflictsInvolved: number;
}

/** One entity's arbitration memory: the last APPLIED row per source. */
type EntityMemory = Map<string, DrainRow>;

/**
 * The multi-source fusion engine (L012). Created through
 * {@link createLiveFusionEngine}; session-scoped, seam-injected (a driver,
 * never a model).
 */
export class LiveFusionEngine {
  readonly sessionId: string;
  private readonly temporal: TemporalBufferEngine;
  private readonly updater: LiveSwmUpdater;
  private readonly policy: LiveFusionPolicy;
  private readonly memory = new Map<string, EntityMemory>();
  private readonly perSource = new Map<string, SourceFusionCounters>();
  private readonly previousTemporalState = new Map<string, string>();
  private readonly statsState: FusionStats = emptyFusionStats();
  private lastRenderClockMs = 0;
  private finalized = false;

  constructor(options: LiveFusionEngineOptions) {
    const issues: string[] = [];
    if (typeof options.sessionId !== "string" || options.sessionId.length === 0) {
      issues.push("sessionId must be a non-empty string");
    }
    if (options.temporal === null || typeof options.temporal?.admit !== "function") {
      issues.push("temporal must be a TemporalBufferEngine");
    } else if (options.temporal.sessionId !== options.sessionId) {
      issues.push(
        `temporal engine session "${options.temporal.sessionId}" does not match fusion session "${options.sessionId}"`,
      );
    }
    if (options.updater === null || typeof options.updater?.apply !== "function") {
      issues.push("updater must be a LiveSwmUpdater");
    } else if (options.updater.sessionId !== options.sessionId) {
      issues.push(
        `updater session "${options.updater.sessionId}" does not match fusion session "${options.sessionId}"`,
      );
    }
    if (issues.length > 0) throw new LiveFusionEngineValidationError(issues);
    this.sessionId = options.sessionId;
    this.temporal = options.temporal;
    this.updater = options.updater;
    this.policy = parseFusionPolicy(options.policy);
  }

  /** The engine's policy (echoed for reports — DATA). */
  get fusionPolicy(): LiveFusionPolicy {
    return this.policy;
  }

  /** The fusion-run aggregate accounting (the honesty surface). */
  stats(): FusionStats {
    return { ...this.statsState, snapshotVersion: this.updater.worldEngine.snapshotVersion };
  }

  /**
   * Admits one observation batch (any source) and fuses the drain it
   * causes. Invalid/wrong-session batches throw the L004 typed errors
   * VERBATIM (propagated, never caught-and-guessed — the D7 pattern).
   */
  admit(document: LiveObservation): FusionReport {
    if (this.finalized) {
      throw new LiveFusionEngineValidationError([
        "the live window is finalized — no further admissions",
      ]);
    }
    // Validate against the frozen contract BEFORE delegating (fail-loud at
    // this seam too — a malformed document never reaches the engine state).
    const parsed = parseLiveObservation(document);
    if (parsed.sessionId !== this.sessionId) {
      throw new LiveFusionEngineValidationError([
        `sessionId "${parsed.sessionId}" does not match the fusion session "${this.sessionId}" (wrongSession — never partially applied)`,
      ]);
    }
    const drain = this.temporal.admit(parsed);
    return this.fuse(drain, "admit", this.lastRenderClockMs);
  }

  /** One render-clock tick: delegates to L004 and fuses the drain. */
  tick(renderClockMs: number): FusionReport {
    if (this.finalized) {
      throw new LiveFusionEngineValidationError([
        "the live window is finalized — no further ticks",
      ]);
    }
    this.lastRenderClockMs = renderClockMs;
    const drain = this.temporal.tick(renderClockMs);
    return this.fuse(drain, "tick", renderClockMs);
  }

  /** The end-of-live-window drain (flushes L004; no further admissions). */
  finalize(): FusionReport {
    if (this.finalized) {
      throw new LiveFusionEngineValidationError(["the live window is already finalized"]);
    }
    const drain = this.temporal.finalize();
    this.finalized = true;
    return this.fuse(drain, "finalize", this.lastRenderClockMs);
  }

  // -- The fusion core ---------------------------------------------------------

  /**
   * Fuses one drain: groups co-observations (drain rows + the arbitration
   * memory), mints conflict records, arbitrates same-time conflicting ties,
   * rebuilds the affected batches, applies the stream through the updater,
   * and accounts per source (L004 state transitions → loss/recovery events).
   */
  private fuse(drain: DrainResult, origin: FusionReport["origin"], renderClockMs: number): FusionReport {
    this.statsState.drainsFired += 1;

    // -- 1. The arbitration pass (D5) ------------------------------------------
    const rows = drainRowsOf(drain.applied);
    const rowsByEntity = new Map<string, DrainRow[]>();
    for (const entry of rows) {
      const list = rowsByEntity.get(entry.row.entityRef);
      if (list === undefined) rowsByEntity.set(entry.row.entityRef, [entry]);
      else list.push(entry);
    }

    const withheldIds = new Set<string>();
    const conflicts: ConflictRecord[] = [];
    const decisions: FusionArbitrationDecision[] = [];
    let conflictRowsWithheld = 0;
    let corroborationRows = 0;

    for (const [entityRef, drainRowsForEntity] of rowsByEntity) {
      // The comparable candidate set: this drain's rows + the entity's
      // arbitration memory (the last APPLIED row per source — bounded by
      // entities × sources; the comparability window filters old rows).
      const memory = this.memory.get(entityRef);
      const candidates: DrainRow[] = [...drainRowsForEntity];
      if (memory !== undefined) {
        for (const stored of memory.values()) candidates.push(stored);
      }
      const drainRowIds = new Set(drainRowsForEntity.map((entry) => liveObservationIdOf(entry)));
      for (const group of coObservationGroupsOf(entityRef, candidates, this.policy)) {
        const groupHasDrainRow = group.rows.some((entry) => drainRowIds.has(liveObservationIdOf(entry)));
        if (!groupHasDrainRow) continue; // stored-only group: already accounted
        if (groupConflictsCrossSource(group, this.policy)) {
          // -- D4: the conflict record (every conflicting value listed) ----
          const conflict = conflictRecordOf(
            group,
            this.statsState.conflicts + conflicts.length + 1,
          );
          conflicts.push(conflict);
          for (const source of group.sources) {
            this.countersOf(source).conflictsInvolved += 1;
          }
          // -- D5: same-time tie arbitration (the canonical replay order) --
          for (const tie of sameTimeTiesOf(group)) {
            const drainTieRows = tie.filter((entry) =>
              drainRowIds.has(liveObservationIdOf(entry)),
            );
            if (drainTieRows.length === 0) continue; // a stored-only tie: no decision to make
            const survivor = canonicalMaxOf(tie);
            const survivorIsDrainRow = drainRowIds.has(liveObservationIdOf(survivor));
            const withheldRows = survivorIsDrainRow
              ? drainTieRows.filter((entry) => entry !== survivor)
              : drainTieRows;
            const preferred = preferredSourceOf(tie, this.policy);
            decisions.push({
              entityRef,
              eventTimeMs: tie[0]!.row.observedAtMs,
              survivorSourceId: survivor.sourceId,
              withheldSourceIds: withheldRows.map((entry) => entry.sourceId),
              conflictId: conflict.conflictId,
              rule:
                tie.some((entry) => entry.sourceId !== survivor.sourceId)
                  ? "canonical-source-order"
                  : "canonical-sequence-order",
              precedencePreferredSourceId: preferred,
              precedenceMatchesSurvivor: preferred === survivor.sourceId,
            });
            for (const entry of withheldRows) {
              withheldIds.add(liveObservationIdOf(entry));
              conflictRowsWithheld += 1;
              this.countersOf(entry.sourceId).rowsWithheld += 1;
            }
          }
        } else {
          // Agreement within tolerance: corroboration (counted, no record).
          for (const entry of group.rows) {
            if (!drainRowIds.has(liveObservationIdOf(entry))) continue;
            corroborationRows += 1;
            this.countersOf(entry.sourceId).rowsCorroborating += 1;
          }
        }
      }
    }

    // -- 2. Rebuild the affected batches (D2/D9) --------------------------------
    const fusedBatches: { sourceId: string; batch: LiveObservation }[] = [];
    let suppressedBatches = 0;
    for (const entry of drain.applied) {
      const filtered = entry.batch.entityObservations.filter(
        (row) => !withheldIds.has(liveObservationIdOf({ sourceId: entry.sourceId, sequence: entry.batch.sequence, row })),
      );
      if (filtered.length === 0) {
        suppressedBatches += 1;
        this.statsState.batchesSuppressed += 1;
        continue;
      }
      if (filtered.length === entry.batch.entityObservations.length) {
        fusedBatches.push({ sourceId: entry.sourceId, batch: entry.batch }); // VERBATIM (D1)
      } else {
        const { entityObservations: _omitted, ...rest } = entry.batch;
        fusedBatches.push({ sourceId: entry.sourceId, batch: { ...rest, entityObservations: filtered } });
      }
    }

    // -- 3. Apply through the updater (the canonical application order) -------
    // The drain's batches arrive sorted (eventTimeMs, sequence, sourceId);
    // the fusion layer re-sorts them to (eventTimeMs, sourceId, sequence) —
    // the batch-level projection of the CANONICAL REPLAY ORDER (the row
    // order the W005 store's batch pass applies) — so the live final state
    // per entity is the canonical-last applied row, exactly like the
    // replay (the frozen §8 equality, by construction).
    fusedBatches.sort(
      (a, b) =>
        a.batch.eventTimeMs - b.batch.eventTimeMs ||
        (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0) ||
        a.batch.sequence - b.batch.sequence,
    );
    const batchReports: LiveUpdateReport[] = [];
    for (const entry of fusedBatches) {
      const sourceStats = drain.sources.find((stats) => stats.sourceId === entry.sourceId);
      batchReports.push(
        this.updater.apply(
          entry.batch,
          sourceStats !== undefined ? { engineWatermark: sourceStats.watermark } : undefined,
        ),
      );
      this.countersOf(entry.sourceId).batchesApplied += 1;
      this.statsState.batchesApplied += 1;
    }
    // Per-source applied rows (the rows that actually reached the updater).
    for (const entry of fusedBatches) {
      this.countersOf(entry.sourceId).rowsApplied += entry.batch.entityObservations.length;
    }

    // -- 4. Update the arbitration memory (applied rows only — D8) --------------
    for (const entry of drain.applied) {
      for (const row of entry.batch.entityObservations) {
        if (withheldIds.has(liveObservationIdOf({ sourceId: entry.sourceId, sequence: entry.batch.sequence, row }))) {
          continue; // withheld rows never enter the memory (never the store)
        }
        const memory = this.memory.get(row.entityRef);
        if (memory === undefined) this.memory.set(row.entityRef, new Map([[entry.sourceId, { sourceId: entry.sourceId, sequence: entry.batch.sequence, row }]]));
        else memory.set(entry.sourceId, { sourceId: entry.sourceId, sequence: entry.batch.sequence, row });
      }
    }

    // -- 5. Source summaries + loss/recovery events (D6 — L004 states verbatim) -
    const sourceEvents: FusionSourceEvent[] = [];
    const sourceSummary: FusionSourceSummary[] = [];
    let fallbackActive = false;
    for (const sourceStats of drain.sources) {
      const counters = this.countersOf(sourceStats.sourceId);
      const state = fusionSourceStateOf(sourceStats.stats.state);
      const previous = this.previousTemporalState.get(sourceStats.sourceId);
      if (previous !== undefined && previous !== "STALLED" && state === "lost") {
        sourceEvents.push({
          sourceId: sourceStats.sourceId,
          kind: "source-lost",
          atRenderClockMs: renderClockMs,
          watermark: { ...sourceStats.watermark },
        });
        this.statsState.sourcesLost += 1;
      }
      if (previous !== undefined && previous === "STALLED" && state !== "lost") {
        sourceEvents.push({
          sourceId: sourceStats.sourceId,
          kind: "source-recovered",
          atRenderClockMs: renderClockMs,
          watermark: { ...sourceStats.watermark },
        });
        this.statsState.sourceRecoveries += 1;
      }
      this.previousTemporalState.set(sourceStats.sourceId, sourceStats.stats.state);
      if (state === "lost") fallbackActive = true;
      sourceSummary.push({
        sourceId: sourceStats.sourceId,
        state,
        batchesApplied: counters.batchesApplied,
        rowsApplied: counters.rowsApplied,
        rowsWithheld: counters.rowsWithheld,
        rowsCorroborating: counters.rowsCorroborating,
        conflictsInvolved: counters.conflictsInvolved,
        watermark: { ...sourceStats.watermark },
        temporal: { ...sourceStats.stats },
      });
    }

    // -- 6. The fusion-layer aggregate + §9 snapshot sums (D7) ------------------
    this.statsState.conflicts += conflicts.length;
    this.statsState.conflictRowsWithheld += conflictRowsWithheld;
    this.statsState.corroborationRows += corroborationRows;
    const engine = this.updater.worldEngine;
    return {
      sessionId: this.sessionId,
      origin,
      renderClockMs,
      batchReports,
      suppressedBatches,
      conflicts,
      conflictRowsWithheld,
      corroborationRows,
      arbitrationDecisions: decisions,
      sourceSummary,
      sourceEvents,
      fallbackActive,
      snapshotVersionAfter: engine.snapshotVersion,
    };
  }

  /** The cumulative per-source counters (created on first sight). */
  private countersOf(sourceId: string): SourceFusionCounters {
    let counters = this.perSource.get(sourceId);
    if (counters === undefined) {
      counters = {
        batchesApplied: 0,
        rowsApplied: 0,
        rowsWithheld: 0,
        rowsCorroborating: 0,
        conflictsInvolved: 0,
      };
      this.perSource.set(sourceId, counters);
    }
    return counters;
  }
}

/**
 * Whether a co-observation group CONFLICTS: any CROSS-SOURCE pair beyond the
 * movement-plausibility tolerance (D3 — same-source corrections are the
 * source's own sequential updates, never a cross-source conflict).
 */
function groupConflictsCrossSource(group: CoObservationGroup, policy: LiveFusionPolicy): boolean {
  for (let i = 0; i < group.rows.length; i += 1) {
    for (let j = i + 1; j < group.rows.length; j += 1) {
      const a = group.rows[i]!;
      const b = group.rows[j]!;
      if (a.sourceId === b.sourceId) continue;
      if (!agreeWithinTolerance(a.row, b.row, policy)) return true;
    }
  }
  return false;
}

/**
 * The CANONICAL-MAX row of a tie (D5): the tie's max by `(sourceId,
 * sequence)` — the row the W005 store's batch replay applies LAST (the
 * zero-padded bridge id scheme makes the lexicographic observation id
 * order = the (sourceId, sequence) order). Total, deterministic,
 * arrival-order-free.
 */
function canonicalMaxOf(tie: readonly DrainRow[]): DrainRow {
  let best = tie[0]!;
  for (let i = 1; i < tie.length; i += 1) {
    const entry = tie[i]!;
    if (
      entry.sourceId > best.sourceId ||
      (entry.sourceId === best.sourceId && entry.sequence > best.sequence)
    ) {
      best = entry;
    }
  }
  return best;
}

/**
 * The operator's precedence preference for a tie (REPORTED, never
 * overriding the canonical survivor — see the module docs): the
 * highest-precedence source among the tie's sources that is actually
 * LISTED in the precedence, `null` when no tie source is listed (no
 * preference configured — an unlisted preference is never invented).
 */
function preferredSourceOf(tie: readonly DrainRow[], policy: LiveFusionPolicy): string | null {
  let preferred: string | null = null;
  let preferredRank = Number.POSITIVE_INFINITY;
  for (const entry of tie) {
    if (!policy.sourcePrecedence.includes(entry.sourceId)) continue; // unlisted = no preference signal
    const rank = policy.sourcePrecedence.indexOf(entry.sourceId);
    if (rank < preferredRank) {
      preferred = entry.sourceId;
      preferredRank = rank;
    }
  }
  return preferred;
}

/** Maps the L004 per-source state onto the fusion-layer state (D6). */
function fusionSourceStateOf(temporalState: string): FusionSourceState {
  return temporalState === "STALLED" ? "lost" : "active";
}

// Re-exported for the batch-comparability contract doc (distance semantics).
export { distanceM };

/** Creates the multi-source fusion engine (L012). */
export function createLiveFusionEngine(options: LiveFusionEngineOptions): LiveFusionEngine {
  return new LiveFusionEngine(options);
}
