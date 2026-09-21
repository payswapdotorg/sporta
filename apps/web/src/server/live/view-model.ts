/**
 * THE LIVE TACTICAL VIEW-MODEL (L005) — the apps/web server-side seam that
 * projects live world state to the browser through the EXISTING W915 SSE
 * live transport.
 *
 * WHAT THIS IS (the scaffold's honest scope):
 *
 * - It consumes Worker B's L002 `@sporta/live-source` package (READ-ONLY —
 *   the deterministic synthetic TRACKING source over the frozen
 *   LiveObservation semantics) and projects each observation batch into ONE
 *   `LiveWorldFrameDoc` — the browser tactical renderer's input.
 * - It implements the frozen live-reality.md §5 `LiveRenderInput` semantics
 *   as delivered to the browser: `worldState` (the entity projection +
 *   worldVersion + watermark), `eventsSincePreviousFrame` (the honest
 *   accounting kinds — recovery gaps, quality transitions, entity
 *   appear/disappear — never fabricated match events) and the render clock
 *   (`generatedAtMs` after the projection; the transport's cadence is the
 *   tick clock).
 * - ENTITY IDENTITY CONTINUITY: the projection keys every entity by its
 *   canonical `entityRef` — the SAME entity keeps its identity across
 *   frames while its position updates. A tracking miss is DATA: an
 *   undetected entity is carried at its LAST KNOWN position, marked
 *   `detected: false` with a growing `staleForMs` and its reduced
 *   confidence — NEVER fabricated certainty and never a silent removal.
 * - DROPOUT/DEGRADED HONESTY: the source's reconnect `recovery` accounting
 *   rides the frame's `eventsSincePreviousFrame` (the missed window is
 *   accounted, never smoothed over); the post-reconnect `degraded` quality
 *   state rides the frame's own `quality` field; the watermark lag is
 *   carried per frame (§9 telemetry).
 * - NO RENDERER-OWNED WORLD TRUTH: this module never creates world truth —
 *   it is a VIEW projection of the live observations (the canonical SWM
 *   seam, Worker A's L003, will re-point the transport's producer at the
 *   real incremental updater when it lands; this scaffold's projection is
 *   the seam that gets re-pointed, not a second source of truth).
 * - CYCLING (labeled): the deterministic source's scripted window is
 *   finite; when it exhausts, a fresh source is created (the same
 *   seed/scenario — the same labeled deterministic replay) and the frame's
 *   `telemetry.replayCycle` marks the boundary honestly. Same precedent as
 *   the story producer's labeled timeline cycling.
 *
 * PURITY: no wall-clock reads (`nowMs` injected), no env, no I/O — the only
 * inputs are the deterministic source's observations.
 */
import { createDeterministicLiveSource } from "@sporta/live-source";
import type { LiveScenarioKind, LiveSourcePort } from "@sporta/live-source";
import type { LiveObservation } from "@sporta/live-source";
import type { LiveWorldFrameDoc } from "@/lib/live-sse";

/** The honest label of the L002 adapter (verbatim from its metadata). */
const SYNTHETIC_SOURCE_NOTE = "L002 deterministic synthetic tracking source";

/** The tactical view-model's configuration (DATA — the transport's producer). */
export interface LiveTacticalRegistration {
  /**
   * The L005 view-model config: everything the deterministic source needs
   * (seed/scenario/rate/tickCount/roster) — the registration IS the data
   * the transport re-creates the producer from.
   */
  config: {
    /** The deterministic replay key: same seed + scenario → same sequence. */
    seed: number;
    /** The delivery scenario (normal / jitter / delay / drop / out-of-order / reconnect). */
    scenario: LiveScenarioKind;
    /** How many ticks the scripted window spans. */
    tickCount: number;
    /** The nominal inter-tick event-time distance (ms). */
    rateMs: number;
    /** Players per team. */
    playersPerTeam: number;
    /** Referees. */
    referees: number;
  };
  /** The source's honest metadata line (rides the hello + the UI). */
  sourceNote: string;
  /**
   * L014 (additive, presentation side): when `true` the scripted window
   * runs ONCE — the producer answers `null` at exhaustion and the transport
   * ends the channel with the `live-window-complete` close reason, retaining
   * the RECORDED world frames for replay through the same views. Default
   * (`false`/absent): the labeled CYCLING behavior of the six L005 scenario
   * sessions is preserved verbatim.
   */
  finiteWindow?: boolean;
}

/** One projected entity's carried state (identity-continuous by entityRef). */
interface CarriedEntity {
  entityRef: string;
  kind: LiveWorldFrameDoc["entities"][number]["kind"];
  teamRef?: string;
  xMeters: number;
  yMeters: number;
  detected: boolean;
  confidence: number;
  /** The event time of the last DETECTED observation (ms). */
  lastDetectedAtMs: number;
}

/** Options for {@link createTacticalFrameProducer}. */
export interface TacticalFrameProducerOptions extends LiveTacticalRegistration {
  /** The live session's id (rides every frame). */
  sessionId: string;
  /** The injected clock (epoch ms — the transport injects the real one). */
  nowMs: () => number;
}

/** The producer's frame answer (the transport wraps it on the SSE wire). */
export interface TacticalFrameResult {
  frame: LiveWorldFrameDoc;
  /** Whether this frame opened a fresh replay cycle (labeled). */
  replayCycle: boolean;
}

/**
 * Creates the live tactical frame producer: `next()` pulls the NEXT
 * observation from the deterministic source (arrival order — the scenario's
 * honest delivery plan), projects it into one world frame, and returns it
 * with its telemetry.
 *
 * WINDOW SEMANTICS (the L005/L014 split):
 *
 * - cycling (the default, the six L005 scenario sessions): when the scripted
 *   window exhausts, a fresh labeled replay cycle starts (the same
 *   deterministic sequence — the boundary is DATA, never a fabricated
 *   continuity);
 * - finite (L014, `finiteWindow: true`): when the scripted window exhausts,
 *   `next()` answers `null` — the live window is OVER, and the transport ends
 *   the channel with the `live-window-complete` close reason (the recorded
 *   frames are then replayable through the same views).
 */
export function createTacticalFrameProducer(options: TacticalFrameProducerOptions): {
  next: (meta: { sessionId: string; ordinal: number }) => TacticalFrameResult | null;
  /** How many observations the current window has delivered. */
  readonly delivered: number;
} {
  const config = options.config;
  const finite = options.finiteWindow === true;
  let source = freshSource();
  const carried = new Map<string, CarriedEntity>();
  let worldVersion = 0;
  let lastQuality: "nominal" | "degraded" | null = null;
  let deliveredCount = 0;

  function freshSource(): LiveSourcePort {
    return createDeterministicLiveSource({
      sessionId: options.sessionId,
      seed: config.seed,
      scenario: config.scenario,
      tickCount: config.tickCount,
      rateMs: config.rateMs,
      playersPerTeam: config.playersPerTeam,
      referees: config.referees,
    });
  }

  return {
    get delivered(): number {
      return deliveredCount;
    },
    next(meta: { sessionId: string; ordinal: number }): TacticalFrameResult | null {
      const startedAtMs = options.nowMs();
      let observation: LiveObservation | null = source.next();
      let replayCycle = false;
      if (observation === null) {
        // The scripted window exhausted. Cycling (the default): a fresh
        // labeled replay cycle (the same deterministic sequence — the
        // boundary is DATA, never a fabricated continuity). Finite (L014):
        // the live window is OVER — `null` (the transport ends the channel
        // honestly; never a fabricated extra frame).
        if (finite) {
          return null;
        }
        source.close();
        source = freshSource();
        observation = source.next();
        replayCycle = observation !== null;
        if (observation === null) {
          throw new Error(
            "the tactical view-model's fresh replay cycle produced no observation (impossible)",
          );
        }
        lastQuality = null; // the new window's quality state starts fresh
      }
      deliveredCount += 1;
      const events: LiveWorldFrameDoc["eventsSincePreviousFrame"] = [];

      // The honest recovery accounting: the missed window rides the frame's
      // own event list — accounted, never smoothed over.
      if (observation.recovery !== undefined) {
        events.push({
          type: "source-recovery",
          atMs: observation.eventTimeMs,
          detail: {
            missedUpdates: observation.recovery.missedUpdates,
            gapDurationMs: observation.recovery.gapDurationMs,
          },
        });
      }
      // The quality transitions (degraded ⇄ nominal) — the honest state
      // changes, never a hidden flip.
      if (observation.quality !== lastQuality) {
        events.push({
          type: observation.quality === "degraded" ? "quality-degraded" : "quality-nominal",
          atMs: observation.eventTimeMs,
        });
        lastQuality = observation.quality;
      }

      // The entity projection: identity-continuous by entityRef; an
      // undetected entity carries its last-known position (marked, with a
      // growing staleness — never fabricated, never silently removed).
      const seen = new Set<string>();
      for (const row of observation.entityObservations) {
        seen.add(row.entityRef);
        const previous = carried.get(row.entityRef);
        if (row.detected) {
          carried.set(row.entityRef, {
            entityRef: row.entityRef,
            kind: row.kind,
            ...(row.teamRef !== undefined ? { teamRef: row.teamRef } : {}),
            xMeters: row.position.xMeters,
            yMeters: row.position.yMeters,
            detected: true,
            confidence: row.confidence,
            lastDetectedAtMs: row.observedAtMs,
          });
          if (previous === undefined) {
            events.push({
              type: "entity-appeared",
              atMs: observation.eventTimeMs,
              detail: { entityRef: row.entityRef },
            });
          } else if (!previous.detected) {
            events.push({
              type: "entity-regained",
              atMs: observation.eventTimeMs,
              detail: { entityRef: row.entityRef },
            });
          }
        } else {
          // A tracking miss: the LAST KNOWN position rides with the honest
          // undetected marker (the source itself already carries the
          // last-known row with reduced confidence).
          const base =
            previous ??
            ({
              entityRef: row.entityRef,
              kind: row.kind,
              ...(row.teamRef !== undefined ? { teamRef: row.teamRef } : {}),
              xMeters: row.position.xMeters,
              yMeters: row.position.yMeters,
              detected: false,
              confidence: row.confidence,
              lastDetectedAtMs: row.observedAtMs,
            } satisfies CarriedEntity);
          carried.set(row.entityRef, {
            ...base,
            detected: false,
            confidence: row.confidence,
          });
        }
      }
      // Entities absent from the batch entirely (a full disappearance):
      // carried as last-known with `detected: false` — visible, accounted.
      for (const entity of carried.values()) {
        if (!seen.has(entity.entityRef) && entity.detected) {
          carried.set(entity.entityRef, { ...entity, detected: false });
        }
      }

      worldVersion += 1;
      const confidences = [...carried.values()].map((entity) => entity.confidence);
      const undetectedEntities = [...carried.values()].filter((entity) => !entity.detected).length;
      const generatedAtMs = options.nowMs();
      const frame: LiveWorldFrameDoc = {
        schemaVersion: "sporta.live-tactical/1",
        sessionId: meta.sessionId,
        ordinal: meta.ordinal,
        worldVersion,
        eventTimeMs: observation.eventTimeMs,
        watermark: {
          watermarkMs: observation.watermark.watermarkMs,
          sequence: observation.watermark.sequence,
        },
        sourceSequence: observation.sequence,
        quality: observation.quality,
        confidence: {
          min: confidences.length > 0 ? Math.min(...confidences) : 0,
          mean:
            confidences.length > 0
              ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
              : 0,
        },
        entities: [...carried.values()].map((entity) => ({
          entityRef: entity.entityRef,
          kind: entity.kind,
          ...(entity.teamRef !== undefined ? { teamRef: entity.teamRef } : {}),
          xMeters: entity.xMeters,
          yMeters: entity.yMeters,
          detected: entity.detected,
          confidence: entity.confidence,
          staleForMs: entity.detected
            ? 0
            : Math.max(0, observation.eventTimeMs - entity.lastDetectedAtMs),
        })),
        eventsSincePreviousFrame: events,
        generatedAtMs,
        renderDurationMs: Math.max(0, generatedAtMs - startedAtMs),
        telemetry: {
          watermarkLagMs: Math.max(0, observation.eventTimeMs - observation.watermark.watermarkMs),
          undetectedEntities,
          replayCycle,
        },
      };
      return { frame, replayCycle };
    },
  };
}

/** The view-model's honest registration note (rides the sources listing). */
export function tacticalSourceNote(registration: LiveTacticalRegistration): string {
  const windowNote =
    registration.finiteWindow === true
      ? `; finite window — ends after ${registration.config.tickCount} ticks, then replays (L014)`
      : "";
  return `${SYNTHETIC_SOURCE_NOTE} — scenario '${registration.config.scenario}', ${registration.config.tickCount} ticks @ ${registration.config.rateMs}ms (${registration.sourceNote})${windowNote}`;
}
