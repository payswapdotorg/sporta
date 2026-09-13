/**
 * Event derivation: turns stored observations (evidence) into derived events.
 *
 * Every derived event links back to its evidence via
 * `evidence.observationIds` — an observation NEVER silently becomes fact
 * (docs/contracts/sports-world-model.md). Derivation is deterministic for
 * W005: given the same store contents and the same derivation inputs, the
 * same envelope is produced, which is what makes `replay.ts` possible.
 *
 * Confidence rules (documented, conservative):
 *
 * - `deriveEvent` without an explicit `confidence` propagates the MINIMUM of
 *   the supporting observation confidences; an observation without a
 *   `confidence` contributes `MISSING_CONFIDENCE_DEFAULT` (0.5).
 * - An explicit `confidence` input REPLACES the computed minimum: it is the
 *   derivation rule's own calibrated confidence (e.g. the commentary weight
 *   below). Callers must not use it to claim more certainty than their
 *   evidence supports — fusion stages (W401) remain responsible for capping.
 * - `deriveCommentaryEvent` sets confidence to the transcription's
 *   `asrConfidence` (0.5 when absent) multiplied by
 *   `COMMENTARY_CONFIDENCE_WEIGHT` (0.8).
 */
import { Observation, SCHEMA_VERSION } from "@sporta/contracts";
import type { EventEnvelope, Interval } from "@sporta/contracts";
import {
  COMMENTARY_CONFIDENCE_WEIGHT,
  MISSING_CONFIDENCE_DEFAULT,
  buildDerivedEnvelope,
  matchesPattern,
  minSupportingConfidence,
} from "./internal";
import type { ObservationStore } from "./store";

/**
 * Thrown when a derivation references evidence observations that cannot be
 * resolved in the store. Evidence-chain integrity is the point: an event may
 * never claim observations that are not on record.
 */
export class MissingEvidenceError extends Error {
  /** Evidence observation ids that could not be resolved (empty when the evidence list itself was empty). */
  readonly missingObservationIds: readonly string[];

  constructor(missingObservationIds: readonly string[], message?: string) {
    super(
      message ??
        (missingObservationIds.length > 0
          ? `evidence observations not found in the store: ${missingObservationIds.join(", ")}`
          : "derived events require at least one evidence observation"),
    );
    this.name = "MissingEvidenceError";
    this.missingObservationIds = missingObservationIds;
  }
}

/** Deterministic derivation input for a derived event. */
export interface DeriveEventInput {
  sessionId: string;
  eventId: string;
  /** Event type reference, e.g. `"football/v1/goal"`. */
  eventTypeRef: string;
  /** Interval on the canonical media timeline (`endTimeMs >= startTimeMs`). */
  interval: Interval;
  /** Event position on the canonical media timeline. */
  eventTimeMs: number;
  /**
   * Evidence chain: the observations this event is derived from. Every id
   * must resolve in the store (`MissingEvidenceError` otherwise).
   */
  evidence: {
    observationIds: string[];
    /** Who reported/asserted the event, where applicable (e.g. "commentary"). */
    reportedBy?: string;
  };
  /**
   * Optional explicit derivation-rule confidence that replaces the computed
   * minimum-of-evidence propagation (see module docs).
   */
  confidence?: number;
  /** When set, the derived event is a versioned correction of that event id. */
  correctionOf?: string;
}

/**
 * A commentary match rule: when `pattern` matches the transcription text, an
 * event of type `eventTypeRef` is derived (e.g. `/goal/i` →
 * `"football/v1/goal"`).
 */
export interface CommentaryMatchRule {
  pattern: RegExp;
  eventTypeRef: string;
}

/** Derives events from the observations held in a store. */
export class EventDerivationService {
  constructor(private readonly store: ObservationStore) {}

  /**
   * Derives an event from stored evidence observations.
   *
   * 1. resolves every evidence observation id in the store
   *    (`MissingEvidenceError` when any is missing),
   * 2. stamps `provenance: "DERIVED"`,
   * 3. propagates confidence (module docs),
   * 4. validates the resulting envelope against the `EventEnvelope` contract
   *    (invalid construction, e.g. a reversed interval, throws the zod error),
   * 5. returns the envelope.
   */
  deriveEvent(input: DeriveEventInput): EventEnvelope {
    const observationIds = input.evidence.observationIds;
    if (observationIds.length === 0) {
      throw new MissingEvidenceError(
        [],
        "derived events require at least one evidence observation",
      );
    }

    const resolved = [];
    const missing: string[] = [];
    for (const observationId of observationIds) {
      const found = this.store.byId(observationId);
      if (found === undefined) missing.push(observationId);
      else resolved.push(found);
    }
    if (missing.length > 0) throw new MissingEvidenceError(missing);

    const confidence = input.confidence ?? minSupportingConfidence(resolved);
    return buildDerivedEnvelope({
      schemaVersion: SCHEMA_VERSION,
      sessionId: input.sessionId,
      eventId: input.eventId,
      eventTypeRef: input.eventTypeRef,
      interval: input.interval,
      eventTimeMs: input.eventTimeMs,
      evidence: input.evidence,
      confidence,
      ...(input.correctionOf !== undefined ? { correctionOf: input.correctionOf } : {}),
    });
  }

  /**
   * Convenience: derives an event from one transcription observation and a
   * regex match rule.
   *
   * - No match → `null` (a non-matching transcript produces no event; callers
   *   scan patterns without try/catch).
   * - Match → an instantaneous event at the observation's timeline position:
   *   evidence is that single observation, `reportedBy: "commentary"`,
   *   `provenance: "DERIVED"`, and confidence `asrConfidence * 0.8`
   *   (`asrConfidence` defaults to 0.5 when absent — conservative, documented
   *   in the module docs).
   *
   * The event id is deterministic (`evt-{observationId}-{eventTypeRef}` with
   * non-id characters replaced by `-`), so re-deriving the same observation
   * under the same rule yields the same id. The observation is validated
   * against the contract first (model output is untrusted input,
   * architecture-lock §13); a non-transcription observation throws.
   *
   * Note: the observation does not need to be stored yet — the envelope links
   * evidence by id, and `replayDeterministic` will later skip the event as
   * missing-evidence until the observation is actually on record.
   */
  deriveCommentaryEvent(
    transcriptObservation: Observation,
    rule: CommentaryMatchRule,
  ): EventEnvelope | null {
    const observation = Observation.parse(transcriptObservation);
    if (observation.payload.kind !== "transcription") {
      throw new TypeError(
        `deriveCommentaryEvent requires an observation with a transcription payload, got "${observation.payload.kind}"`,
      );
    }
    if (!matchesPattern(rule.pattern, observation.payload.text)) return null;

    const asrConfidence = observation.payload.asrConfidence ?? MISSING_CONFIDENCE_DEFAULT;
    return buildDerivedEnvelope({
      schemaVersion: SCHEMA_VERSION,
      sessionId: observation.sessionId,
      eventId: `evt-${observation.observationId}-${rule.eventTypeRef.replace(/[^A-Za-z0-9_-]/g, "-")}`,
      eventTypeRef: rule.eventTypeRef,
      interval: { startTimeMs: observation.eventTimeMs, endTimeMs: observation.eventTimeMs },
      eventTimeMs: observation.eventTimeMs,
      evidence: { observationIds: [observation.observationId], reportedBy: "commentary" },
      confidence: asrConfidence * COMMENTARY_CONFIDENCE_WEIGHT,
    });
  }
}
