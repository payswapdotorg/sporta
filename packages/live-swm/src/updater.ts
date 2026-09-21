/**
 * THE INCREMENTAL SWM UPDATER (L003) — a DRIVER over the SAME canonical
 * `WorldModelEngine` the batch pipeline uses (D1: one canonical SWM; the
 * updater holds NO world state of its own — positions, versions, events and
 * football state live in the engine exactly as in batch; the engine's
 * `snapshotVersion` monotonicity IS the frozen `LiveWorldState.worldVersion`).
 *
 * COMPOSITION (the L003/L004 seam): `LiveSource → TemporalBufferEngine →
 * LiveSwmUpdater → WorldModelEngine` — the bridge feeds each
 * `DrainResult.applied[].batch` here with the drain's per-source watermark
 * (the `watermarkAfter` min rule); the updater also runs standalone on raw
 * batches (its own D7 defenses fire regardless of the upstream engine).
 *
 * THE RULES:
 *
 * - D2 APPLICATION: per batch, the entity observations are applied in the
 *   canonical `(observedAtMs, entityRef)` order through the batch pass's
 *   OWN no-op guard (`upsertWouldBeNoOp`, imported from `@sporta/fusion` —
 *   idempotent upserts, no rewinds; identical re-applications skip, rewind
 *   attempts skip) plus the per-entity replay frontier: an observation
 *   EARLIER than the entity's frontier is LATE — beyond the reorder window
 *   it is DROPPED with the explicit `lateUpdateDropped` counter (never a
 *   position rewind); within the window it falls through to the no-op guard
 *   (applied when it does not rewind — a new entity or a same-time
 *   correction — and counted in `lateUpdatesInWindow`). This is the honest
 *   reconciliation of the design's D2 with its own authority line
 *   ("fusion.ts pass 2: idempotent upserts, no rewinds"): a within-window
 *   late that would rewind the engine state is skipped as a no-op (counted),
 *   never position-rewound.
 * - D3 HONESTY: confidence VERBATIM from the row (never floored, never
 *   averaged), provenance = the batch's `ProvenanceKind`, position status
 *   "uncertain" with the row's confidence (the frozen UncertaintyStatus is
 *   NOT extended); `detected: false` rows apply the source's own carry
 *   (last-known position, reduced confidence, no velocity — velocity is
 *   never projected at this seam) and count in `extrapolatedObservations`
 *   (the §9 counter).
 * - D4 POSSESSION: recomputed INCREMENTALLY per ball-bearing batch over the
 *   CURRENT engine state (the same radius/formula/tie rule as the batch
 *   pass — see ./possession) — MEMORYLESS: the slot always mirrors the
 *   current ball evidence (a winner sets it; a tie or an empty neighborhood
 *   clears it to unknown — never a stale fabricated possessor; the frozen
 *   "missing data must never become fabricated certainty" rule). The
 *   memoryless rule is exactly what makes the D6 replay equality hold: the
 *   live session's final slot equals the batch pass's single end-state
 *   computation. A batch without a ball row leaves the slot untouched. The
 *   event path stays DORMANT (the L002 stream carries no event candidates;
 *   the updater never invents events — L007/L012 feed candidates later).
 * - D5 REPORT: every applied batch produces a `LiveUpdateReport` (JSON-safe,
 *   deterministic — no clock, no RNG).
 * - D6 CONTINUITY: when a W005 `ObservationStore` is injected, every
 *   projectable row of an applied batch is bridged additively into it (the
 *   real-to-swm bridge pattern — never a second store), so a batch
 *   `runWorldFusion` pass over the same store after the live window
 *   reproduces the updater's final engine state (the replay-equality
 *   acceptance test).
 * - D7 FAILURE SEMANTICS: a batch that fails `parseLiveObservation` is
 *   REFUSED with the typed validation error and counted (`invalidBatches`)
 *   — never partially applied; a wrong-session batch is refused
 *   (`wrongSession`); a sequence at or below the source's applied frontier
 *   is a duplicate/replay: counted (`duplicateSequence`), not applied
 *   (idempotence — the no-op report, never an error); engine errors
 *   propagate typed (the updater never catches-and-guesses).
 */
import type { Watermark } from "@sporta/contracts";
import type { LiveObservation } from "@sporta/live-source";
import { parseLiveObservation } from "@sporta/live-source";
import type { ObservationStore } from "@sporta/observation";
import type { WorldModelEngine } from "@sporta/world-model";
import { jsonDeepEqual, upsertWouldBeNoOp } from "@sporta/fusion";
import { bridgeLiveEntity, projectLiveEntity, sortedByTimeThenEntityRef } from "./projection";
import { computeIncrementalPossession, participantPositionsOf } from "./possession";
import type { ConflictRecord } from "@sporta/fusion";
import { emptyLiveUpdaterStats, type LiveUpdateReport, type LiveUpdaterStats } from "./report";

/** Options for {@link createLiveSwmUpdater}. */
export interface LiveSwmUpdaterOptions {
  /** The session this updater serves (must match the engine's). */
  sessionId: string;
  /** The SAME canonical engine the batch pipeline uses (D1 — injected, never owned). */
  engine: WorldModelEngine;
  /**
   * The W005 observation store for the D6 continuity bridge (optional —
   * bridging is enabled exactly when a store is injected; never a second
   * store, always the one the batch path reads).
   */
  store?: ObservationStore;
  /**
   * The reorder window shared with L004 (default 250 ms — the L004 default):
   * beyond-window late entity updates are dropped, within-window lates fall
   * through to the no-op guard.
   */
  reorderWindowMs?: number;
  /** Possession radius in canonical pitch meters (the batch pass's default 2). */
  possessionRadiusM?: number;
}

/** A malformed updater configuration or a refused batch (fail-loud). */
export class LiveUpdaterValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`live SWM updater refused the input: ${issues.join("; ")}`);
    this.name = "LiveUpdaterValidationError";
  }
}

/** The default reorder window (mirrors the L004 engine default). */
export const DEFAULT_LIVE_REORDER_WINDOW_MS = 250;

/**
 * The incremental SWM updater (L003). Created through
 * {@link createLiveSwmUpdater}; session-scoped, engine-injected (a driver,
 * never a model).
 */
export class LiveSwmUpdater {
  readonly sessionId: string;
  private readonly engine: WorldModelEngine;
  private readonly store: ObservationStore | undefined;
  private readonly reorderWindowMs: number;
  private readonly possessionRadiusM: number | undefined;
  private readonly frontiers = new Map<string, number>();
  private readonly appliedSequences = new Map<string, number>();
  private readonly statsState: LiveUpdaterStats = emptyLiveUpdaterStats();

  constructor(options: LiveSwmUpdaterOptions) {
    const issues: string[] = [];
    if (typeof options.sessionId !== "string" || options.sessionId.length === 0) {
      issues.push("sessionId must be a non-empty string");
    }
    if (options.engine === null || typeof options.engine?.upsertEntity !== "function") {
      issues.push("engine must be a WorldModelEngine");
    } else if (options.engine.sessionId !== options.sessionId) {
      // A session-mismatched engine would silently collect another session's
      // entities — fail loud instead (the batch pass's own rule).
      issues.push(
        `engine session "${options.engine.sessionId}" does not match updater session "${options.sessionId}"`,
      );
    }
    const reorderWindowMs = options.reorderWindowMs ?? DEFAULT_LIVE_REORDER_WINDOW_MS;
    if (!(reorderWindowMs > 0) || !Number.isFinite(reorderWindowMs)) {
      issues.push(`reorderWindowMs (${reorderWindowMs}) must be a finite number > 0`);
    }
    if (
      options.possessionRadiusM !== undefined &&
      (!(options.possessionRadiusM > 0) || !Number.isFinite(options.possessionRadiusM))
    ) {
      issues.push(`possessionRadiusM (${options.possessionRadiusM}) must be a finite number > 0`);
    }
    if (issues.length > 0) throw new LiveUpdaterValidationError(issues);
    this.sessionId = options.sessionId;
    this.engine = options.engine;
    this.store = options.store;
    this.reorderWindowMs = reorderWindowMs;
    this.possessionRadiusM = options.possessionRadiusM;
  }

  /** The injected engine (D1 — the same canonical engine the batch uses). */
  get worldEngine(): WorldModelEngine {
    return this.engine;
  }

  /** The aggregate accounting (the D7 refusal counters + the report sums). */
  stats(): LiveUpdaterStats {
    return { ...this.statsState, snapshotVersion: this.engine.snapshotVersion };
  }

  /**
   * Applies one live observation batch and returns the honest per-batch
   * report. Refuses invalid / wrong-session batches with the typed error
   * (counted, never partially applied); treats duplicate sequences as
   * idempotent no-ops (counted, a report with `outcome: "duplicate"`).
   *
   * `options.engineWatermark` is the L004 engine's watermark for this source
   * at drain time — the report's `watermarkAfter` is the min of it and the
   * batch's own source watermark (the D5 rule).
   */
  apply(batch: LiveObservation, options?: { engineWatermark?: Watermark }): LiveUpdateReport {
    // -- D7: the fail-closed admission rules --------------------------------
    let parsed: LiveObservation;
    try {
      parsed = parseLiveObservation(batch);
    } catch (error) {
      this.statsState.invalidBatches += 1;
      throw error;
    }
    if (parsed.sessionId !== this.sessionId) {
      this.statsState.wrongSession += 1;
      throw new LiveUpdaterValidationError([
        `sessionId "${parsed.sessionId}" does not match the updater session "${this.sessionId}" (wrongSession — never partially applied)`,
      ]);
    }
    const frontierSequence = this.appliedSequences.get(parsed.sourceId) ?? 0;
    if (parsed.sequence <= frontierSequence) {
      // Idempotent re-delivery: counted, not applied (D7) — a no-op report.
      this.statsState.duplicateSequence += 1;
      return this.report(parsed, {
        outcome: "duplicate",
        entitiesUpserted: 0,
        entitiesSkippedNoOp: 0,
        lateUpdatesInWindow: 0,
        lateUpdateDropped: 0,
        extrapolatedObservations: 0,
        nonProjectableRows: 0,
        possessionUpdates: 0,
        possessionCleared: 0,
        conflicts: [],
        warnings: [
          `duplicate/replayed sequence ${parsed.sequence} (frontier ${frontierSequence}) — not applied`,
        ],
        engineWatermark: options?.engineWatermark,
      });
    }

    // -- D2/D3: the entity application pass ----------------------------------
    const warnings: string[] = [];
    const conflicts: ConflictRecord[] = [];
    let entitiesUpserted = 0;
    let entitiesSkippedNoOp = 0;
    let lateUpdatesInWindow = 0;
    let lateUpdateDropped = 0;
    let extrapolatedObservations = 0;
    let nonProjectableRows = 0;
    let lastBallRow: LiveObservation["entityObservations"][number] | undefined;

    for (const row of sortedByTimeThenEntityRef(parsed.entityObservations)) {
      if (row.kind === "BALL") lastBallRow = row; // the last ball row in canonical order
      const projection = projectLiveEntity(row);
      if (projection === undefined) {
        nonProjectableRows += 1;
        continue;
      }
      const frontierTime = this.frontiers.get(row.entityRef);
      const isLate = frontierTime !== undefined && row.observedAtMs < frontierTime;
      if (isLate && frontierTime! - row.observedAtMs > this.reorderWindowMs) {
        // Beyond-window late: dropped with the explicit counter — never a
        // position rewind (D2).
        lateUpdateDropped += 1;
        continue;
      }
      const existing = this.engine.entityAt(projection.entity.entityId);
      if (upsertWouldBeNoOp(existing, projection.entity)) {
        entitiesSkippedNoOp += 1;
        continue;
      }
      this.engine.upsertEntity(projection.entity);
      entitiesUpserted += 1;
      if (isLate) lateUpdatesInWindow += 1;
      if (projection.carried) extrapolatedObservations += 1;
      this.frontiers.set(
        row.entityRef,
        Math.max(frontierTime ?? row.observedAtMs, row.observedAtMs),
      );
    }
    if (nonProjectableRows > 0) {
      warnings.push(
        `skipped ${nonProjectableRows} entity row(s) without SWM participant/ball semantics (REFEREE/OTHER) — no entity kind invented`,
      );
    }

    // -- D4: the incremental possession recompute (ball-bearing batches) ----
    let possessionUpdates = 0;
    let possessionCleared = 0;
    if (lastBallRow !== undefined) {
      const football = this.engine.snapshot().football;
      if (football === undefined) {
        warnings.push("possession skipped: engine carries no football state");
      } else {
        const outcome = computeIncrementalPossession({
          ball: lastBallRow,
          participants: participantPositionsOf(this.engine.snapshot().entities),
          ...(this.possessionRadiusM !== undefined ? { radiusM: this.possessionRadiusM } : {}),
          conflictSeq: 1,
          detectedAtMs: lastBallRow.observedAtMs,
        });
        if (outcome.kind === "tie") {
          conflicts.push(outcome.conflict);
          // A tie is an explicit conflict, never a silent winner — and the
          // memoryless rule clears any previous candidate (the slot mirrors
          // the CURRENT evidence; the replay equality depends on it).
          if (this.clearPossessionIfSet()) possessionCleared += 1;
        } else if (outcome.kind === "winner") {
          const next = {
            status: "uncertain" as const,
            value: { entityId: outcome.entityId },
            confidence: outcome.confidence,
          };
          if (!jsonDeepEqual(football.possession, next)) {
            this.engine.setPossession(outcome.entityId, outcome.confidence);
            possessionUpdates += 1;
          }
        } else {
          // The ball's neighborhood is empty: the honest slot is unknown —
          // a stale possessor would be fabricated certainty (cleared iff a
          // previous candidate exists; untouched when already unknown).
          if (this.clearPossessionIfSet()) possessionCleared += 1;
        }
      }
    }

    // -- D6: the continuity bridge (every projectable row of the batch) -----
    if (this.store !== undefined) {
      for (const row of sortedByTimeThenEntityRef(parsed.entityObservations)) {
        const bridged = bridgeLiveEntity(parsed, row);
        if (bridged === undefined) continue;
        if (this.store.append(bridged) === "duplicate") {
          this.statsState.duplicateBridgeObservations += 1;
        }
      }
    }

    this.appliedSequences.set(parsed.sourceId, parsed.sequence);
    this.statsState.appliedBatches += 1;
    this.statsState.entitiesUpserted += entitiesUpserted;
    this.statsState.entitiesSkippedNoOp += entitiesSkippedNoOp;
    this.statsState.lateUpdateDropped += lateUpdateDropped;
    this.statsState.extrapolatedObservations += extrapolatedObservations;
    this.statsState.possessionUpdates += possessionUpdates;

    return this.report(parsed, {
      outcome: "applied",
      entitiesUpserted,
      entitiesSkippedNoOp,
      lateUpdatesInWindow,
      lateUpdateDropped,
      extrapolatedObservations,
      nonProjectableRows,
      possessionUpdates,
      possessionCleared,
      conflicts,
      warnings,
      engineWatermark: options?.engineWatermark,
    });
  }

  /** Clears the possession slot iff a candidate is set (returns whether). */
  private clearPossessionIfSet(): boolean {
    const possession = this.engine.snapshot().football?.possession;
    if (possession === undefined || possession.status === "unknown") return false;
    this.engine.setPossession(null, 0);
    return true;
  }

  /** Builds one report (the watermarkAfter min rule lives here). */
  private report(
    batch: LiveObservation,
    values: {
      outcome: "applied" | "duplicate";
      entitiesUpserted: number;
      entitiesSkippedNoOp: number;
      lateUpdatesInWindow: number;
      lateUpdateDropped: number;
      extrapolatedObservations: number;
      nonProjectableRows: number;
      possessionUpdates: number;
      possessionCleared?: number;
      conflicts: readonly ConflictRecord[];
      warnings: readonly string[];
      engineWatermark?: Watermark;
    },
  ): LiveUpdateReport {
    const engineWatermark = values.engineWatermark;
    // watermarkAfter = min(source watermark, L004 engine watermark): the
    // smaller watermarkMs wins (ties → the engine's — the conservative pick).
    const watermarkAfter =
      engineWatermark !== undefined && engineWatermark.watermarkMs < batch.watermark.watermarkMs
        ? { ...engineWatermark }
        : engineWatermark !== undefined &&
            engineWatermark.watermarkMs === batch.watermark.watermarkMs
          ? { ...engineWatermark }
          : { ...batch.watermark };
    return {
      outcome: values.outcome,
      sessionId: this.sessionId,
      sourceId: batch.sourceId,
      appliedSequence: batch.sequence,
      watermarkAfter,
      entitiesUpserted: values.entitiesUpserted,
      entitiesSkippedNoOp: values.entitiesSkippedNoOp,
      lateUpdatesInWindow: values.lateUpdatesInWindow,
      lateUpdateDropped: values.lateUpdateDropped,
      extrapolatedObservations: values.extrapolatedObservations,
      nonProjectableRows: values.nonProjectableRows,
      possessionUpdates: values.possessionUpdates,
      possessionCleared: values.possessionCleared ?? 0,
      conflicts: values.conflicts,
      snapshotVersionAfter: this.engine.snapshotVersion,
      warnings: values.warnings,
    };
  }
}

/** Creates the incremental SWM updater (L003). */
export function createLiveSwmUpdater(options: LiveSwmUpdaterOptions): LiveSwmUpdater {
  return new LiveSwmUpdater(options);
}
