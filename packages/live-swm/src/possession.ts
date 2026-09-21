/**
 * THE INCREMENTAL POSSESSION RECOMPUTE (L003 design D4) — the SAME semantics
 * as the batch pass's step 4, applied INCREMENTALLY per ball-bearing batch
 * over the CURRENT engine state (the design: "the nearest participant within
 * the possession radius from the CURRENT engine state — the same
 * radius/confidence formula and the same tie rule").
 *
 * Reused verbatim from `@sporta/fusion` (NO duplicate semantics):
 * - `DEFAULT_POSSESSION_RADIUS_M` (2 m canonical pitch meters);
 * - `POSSESSION_AMBIGUITY_EPSILON` (1e-9 — equidistant participants are a
 *   conflict, never a silent winner);
 * - the confidence formula `ballConfidence * trackConfidence *
 *   (1 - distance / radius)` with the deterministic `Math.sqrt(dx*dx + dy*dy)`
 *   distance (not `Math.hypot`, whose rounding is implementation-defined).
 *
 * Honest behaviors (mirrored from the batch pass, documented there):
 * - NO participant within the radius → the slot stays untouched (absence of
 *   evidence is not a state change);
 * - two or more participants tied within the epsilon → NO possession is set;
 *   the tie becomes an explicit `ConflictRecord` listing EVERY tied
 *   participant (resolution stays `"none"`);
 * - a missing ball/track confidence contributes W005's
 *   `MISSING_CONFIDENCE_DEFAULT` (0.5) — the documented absent-evidence
 *   default, never an invented 1.0.
 */
import type { WorldEntity } from "@sporta/contracts";
import {
  DEFAULT_POSSESSION_RADIUS_M,
  POSSESSION_AMBIGUITY_EPSILON,
  type ConflictRecord,
} from "@sporta/fusion";
import { MISSING_CONFIDENCE_DEFAULT } from "@sporta/observation";
import type { LiveEntityObservation } from "@sporta/live-source";

/** One participant's current position read from engine state (DATA). */
export interface ParticipantPosition {
  entityId: string;
  x: number;
  y: number;
  confidence: number;
}

/** The incremental possession candidate outcome (pure DATA). */
export interface PossessionCandidate {
  /** The winning nearest participant and its honest confidence (no tie). */
  readonly kind: "winner";
  readonly entityId: string;
  readonly confidence: number;
  readonly distance: number;
  /** The participants considered (sorted deterministic — the report context). */
  readonly considered: readonly ParticipantPosition[];
}

/** The explicit tie outcome (never a silent winner). */
export interface PossessionTie {
  readonly kind: "tie";
  readonly conflict: ConflictRecord;
}

/** No candidate: nothing within the radius — the slot stays untouched. */
export interface PossessionNone {
  readonly kind: "none";
  readonly reason: "no-ball" | "no-participants" | "outside-radius";
}

/** The union the updater acts on. */
export type PossessionOutcome = PossessionCandidate | PossessionTie | PossessionNone;

/** Reads the current participant positions from the engine's entities. */
export function participantPositionsOf(entities: readonly WorldEntity[]): ParticipantPosition[] {
  const out: ParticipantPosition[] = [];
  for (const entity of entities) {
    if (entity.kind !== "participant") continue;
    const position = entity.state.position;
    if (position === undefined || position.value === undefined) continue;
    const value = position.value as { x?: unknown; y?: unknown };
    if (typeof value.x !== "number" || typeof value.y !== "number") continue;
    out.push({
      entityId: entity.entityId,
      x: value.x,
      y: value.y,
      confidence: position.confidence ?? MISSING_CONFIDENCE_DEFAULT,
    });
  }
  return out.sort((a, b) => (a.entityId < b.entityId ? -1 : 1));
}

/**
 * Computes the incremental possession candidate: the nearest CURRENT
 * participant within the radius of the batch's ball row (the last ball row in
 * the batch's canonical order), with the batch pass's exact formula and tie
 * rule. PURE — a function of (ball row, current participant positions,
 * radius); no engine writes happen here (the updater owns the write).
 */
export function computeIncrementalPossession(input: {
  ball: LiveEntityObservation;
  participants: readonly ParticipantPosition[];
  radiusM?: number;
  conflictSeq: number;
  detectedAtMs: number;
}): PossessionOutcome {
  const radiusM = input.radiusM ?? DEFAULT_POSSESSION_RADIUS_M;
  const withinRadius = input.participants
    .map((participant) => ({
      participant,
      distance: Math.sqrt(
        (input.ball.position.xMeters - participant.x) ** 2 +
          (input.ball.position.yMeters - participant.y) ** 2,
      ),
    }))
    .filter((entry) => entry.distance <= radiusM);

  if (withinRadius.length === 0) {
    return {
      kind: "none",
      reason: input.participants.length > 0 ? "outside-radius" : "no-participants",
    };
  }
  // Deterministic order: distance, then entityId (the batch pass sorts by
  // (distance, observationId); the live layer's evidence id is the entityRef).
  withinRadius.sort(
    (a, b) => a.distance - b.distance || (a.participant.entityId < b.participant.entityId ? -1 : 1),
  );

  const minDistance = withinRadius[0]!.distance;
  const tied = withinRadius.filter(
    (entry) => entry.distance - minDistance <= POSSESSION_AMBIGUITY_EPSILON,
  );
  if (tied.length >= 2) {
    // The explicit tie: a conflict listing EVERY tied participant, resolution
    // "none", the same direct-construction pattern the batch pass uses for
    // pathological ties (the values are the tied entityIds with their
    // confidences; the "observations" are the live rows' bridge identities).
    return {
      kind: "tie",
      conflict: {
        conflictId: `cf-${input.conflictSeq}`,
        slotKey: "possession",
        observationIds: tied.map(
          (entry) => `${input.ball.entityRef}@${input.detectedAtMs}~${entry.participant.entityId}`,
        ),
        values: tied.map((entry) => ({
          value: entry.participant.entityId,
          confidence: entry.participant.confidence,
        })),
        resolution: "none",
        detectedAtMs: input.detectedAtMs,
      },
    };
  }

  const winner = withinRadius[0]!;
  const ballConfidence = input.ball.confidence;
  return {
    kind: "winner",
    entityId: winner.participant.entityId,
    confidence: ballConfidence * winner.participant.confidence * (1 - winner.distance / radiusM),
    distance: winner.distance,
    considered: withinRadius.map((entry) => entry.participant),
  };
}
