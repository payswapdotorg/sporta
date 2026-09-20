/**
 * THE LIVE OBSERVATION SHAPES (L002) — the TypeScript implementation of the
 * FROZEN logical contract `docs/contracts/live-reality.md` §1 (LiveObservation)
 * and §2 (Entity observation).
 *
 * `packages/contracts` is FROZEN — this module implements the live-layer
 * shapes ADDITIVELY outside it (the Wave 0 mapping decision: the logical
 * LiveObservation maps onto the existing dual-clock envelope patterns
 * `eventTimeMs`/`ingestTimeMs` + provenance/confidence plus the ADDITIVE
 * live entity-observation payload). Everything here re-uses the frozen
 * primitives where they exist (`EntityId`, `Watermark`, `ProvenanceKind`),
 * and the one deliberate addition beyond the frozen field list is the
 * OPTIONAL `recovery` member — the explicit reconnect gap accounting the
 * frozen temporal rules require ("reconnect + recovery … resume with
 * explicit gap accounting"); it is present ONLY on the first observation
 * after a reconnect and carries only counted facts. Any further shape need
 * is a contract-change REQUEST, never a silent patch.
 *
 * PURITY: this module is schema DATA only — no clock, no env, no I/O.
 */
import { z } from "zod";
import { EntityId, ProvenanceKind, Watermark } from "@sporta/contracts";

// ---------------------------------------------------------------------------
// The closed vocabularies (the frozen contract's members, verbatim)
// ---------------------------------------------------------------------------

/** The frozen §1 source-type vocabulary. */
export const LIVE_SOURCE_TYPES = [
  "TRACKING",
  "BROADCAST_PERCEPTION",
  "EVENT_FEED",
  "COMMENTARY",
] as const;
export type LiveSourceType = (typeof LIVE_SOURCE_TYPES)[number];

/** The frozen §2 entity-kind vocabulary. */
export const LIVE_ENTITY_KINDS = ["PLAYER", "BALL", "REFEREE", "OTHER"] as const;
export type LiveEntityKind = (typeof LIVE_ENTITY_KINDS)[number];

/**
 * The honest per-observation quality vocabulary (L002's own additive
 * vocabulary — the frozen contract names the `quality` field without a
 * member list; these two members are the honest closure: a source either
 * observes at its nominal quality or it knows it is degraded. Never
 * fabricated certainty).
 */
export const LIVE_OBSERVATION_QUALITIES = ["nominal", "degraded"] as const;
export type LiveObservationQuality = (typeof LIVE_OBSERVATION_QUALITIES)[number];

// ---------------------------------------------------------------------------
// Entity observation (frozen §2)
// ---------------------------------------------------------------------------

/** A position in the Sporta canonical pitch frame (meters, 105 x 68). */
export const PitchPosition = z
  .object({
    /** Meters along the touchline axis (0..105 in the canonical frame). */
    xMeters: z.number().finite(),
    /** Meters along the goal-line axis (0..68 in the canonical frame). */
    yMeters: z.number().finite(),
    /** Meters above the pitch plane (optional — ground entities omit it). */
    zMeters: z.number().finite().min(0).optional(),
  })
  .strict();
export type PitchPosition = z.infer<typeof PitchPosition>;

/** A velocity in pitch-frame meters per second. */
export const PitchVelocity = z
  .object({
    vxMps: z.number().finite(),
    vyMps: z.number().finite(),
    /** Vertical velocity (m/s); present only when the entity is airborne. */
    vzMps: z.number().finite().optional(),
  })
  .strict();
export type PitchVelocity = z.infer<typeof PitchVelocity>;

/**
 * One entity's observation in one live observation batch (frozen §2): the
 * entity ref + kind, the pitch-frame position (canonical meters), an
 * optional velocity, the honest `detected` flag (a tracking miss is DATA,
 * never a silent gap), the tracker's local id, the per-entity confidence,
 * and the observation's own event time.
 */
export const LiveEntityObservation = z
  .object({
    /** The session-scoped entity id (the frozen EntityId pattern). */
    entityRef: EntityId,
    kind: z.enum(LIVE_ENTITY_KINDS),
    /** The entity's team (players only; the ball/referees omit it). */
    teamRef: EntityId.optional(),
    position: PitchPosition,
    velocity: PitchVelocity.optional(),
    /**
     * Whether the source detected this entity at `observedAtMs`. `false`
     * means the position is the LAST KNOWN position (carried honestly with
     * reduced confidence and NO velocity — never fabricated certainty).
     */
    detected: z.boolean(),
    /** The source's own track id (provider-local, opaque). */
    sourceLocalTrackId: z.string().min(1).max(64).optional(),
    confidence: z.number().min(0).max(1),
    /** This entity observation's event time (ms on the session timeline). */
    observedAtMs: z.number().min(0),
  })
  .strict();
export type LiveEntityObservation = z.infer<typeof LiveEntityObservation>;

// ---------------------------------------------------------------------------
// LiveObservation (frozen §1)
// ---------------------------------------------------------------------------

/**
 * The explicit reconnect gap accounting (the additive `recovery` member):
 * present ONLY on the FIRST observation delivered after a reconnect, and
 * carrying only counted facts — the missed tick window and its duration.
 * The gap is accounted, never smoothed over.
 */
export const LiveRecoveryAccounting = z
  .object({
    /** Why the source dropped ("reconnect" — closed, honest). */
    reason: z.literal("reconnect"),
    /** The first missed sequence (inclusive, 1-based). */
    fromSequence: z.number().int().min(1),
    /** The last missed sequence (INCLUSIVE — the window really missed). */
    toSequence: z.number().int().min(1),
    /** How many updates the window missed (toSequence - fromSequence + 1). */
    missedUpdates: z.number().int().min(1),
    /** The window's event-time span (ms). */
    gapDurationMs: z.number().min(0),
  })
  .strict();
export type LiveRecoveryAccounting = z.infer<typeof LiveRecoveryAccounting>;

/**
 * One timestamped live observation batch (frozen §1): the session + source
 * identity, the source type (L002 emits `TRACKING`), the monotonically
 * increasing sequence (GAPS ARE VISIBLE — a dropped update is a hole in the
 * sequence, never a renumbering), the dual clocks (event time is
 * authoritative for match chronology; ingest time is retained for latency
 * accounting), the source's watermark at emission, the entity observations,
 * the batch confidence, the provenance kind, and the honest quality.
 */
export const LiveObservation = z
  .object({
    schemaVersion: z.literal("sporta.live-observation/1"),
    sessionId: z.string().min(1).max(128),
    sourceId: z.string().min(1).max(128),
    sourceType: z.enum(LIVE_SOURCE_TYPES),
    /** 1-based emission tick (gaps visible on drop/reconnect scenarios). */
    sequence: z.number().int().min(1),
    /** Event time (ms on the session's canonical timeline; authoritative). */
    eventTimeMs: z.number().min(0),
    /** Ingest time (ms — when this batch entered the pipeline). */
    ingestTimeMs: z.number().min(0),
    /**
     * The source's watermark AT EMISSION: the conservative contiguous
     * frontier — the largest event time for which the source guarantees no
     * further observation will arrive (the frozen temporal rules: bounded
     * reorder, explicit out-of-order handling).
     */
    watermark: Watermark,
    entityObservations: z.array(LiveEntityObservation).min(1),
    confidence: z.number().min(0).max(1),
    provenance: ProvenanceKind,
    quality: z.enum(LIVE_OBSERVATION_QUALITIES),
    /** Present only on the first post-reconnect observation (gap accounting). */
    recovery: LiveRecoveryAccounting.optional(),
  })
  .strict();
export type LiveObservation = z.infer<typeof LiveObservation>;

// ---------------------------------------------------------------------------
// Validation helper (parse-or-throw, the repo convention)
// ---------------------------------------------------------------------------

/** A live observation failed its own contract validation (never partial data). */
export class LiveObservationValidationError extends Error {
  constructor(issues: string) {
    super(`live observation failed contract validation: ${issues}`);
    this.name = "LiveObservationValidationError";
  }
}

/** Parses one document as a {@link LiveObservation} (fail-loud). */
export function parseLiveObservation(document: unknown): LiveObservation {
  const parsed = LiveObservation.safeParse(document);
  if (!parsed.success) {
    throw new LiveObservationValidationError(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
  }
  return parsed.data;
}
