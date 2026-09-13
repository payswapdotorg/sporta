/**
 * Internal shared helpers for `@sporta/observation`.
 *
 * Not part of the public package API (see `src/index.ts`); they exist so the
 * derivation and replay modules share one deterministic envelope-construction
 * path and one confidence-propagation rule.
 */
import { EventEnvelope } from "@sporta/contracts";
import type { EventEvidence, Interval, Observation } from "@sporta/contracts";

/**
 * Confidence contributed by a supporting observation that carries no
 * `confidence` field. Conservative default: absent evidence strength is never
 * treated as certainty (architecture-lock §4 — explicit uncertainty rather
 * than invented certainty).
 */
export const MISSING_CONFIDENCE_DEFAULT = 0.5;

/**
 * Commentary weight: a commentary-derived event's confidence is the
 * transcription confidence multiplied by this factor, reflecting that spoken
 * commentary is an indirect signal about what happened on the pitch
 * (architecture-lock §7 — commentary may influence confidence, not overwrite
 * higher-confidence evidence).
 */
export const COMMENTARY_CONFIDENCE_WEIGHT = 0.8;

/**
 * Default bounded reorder window for the event log, in milliseconds on the
 * canonical media timeline. Events arriving later than this behind the log's
 * high-water mark are rejected (`LateEventError`) instead of silently
 * rewriting history (docs/contracts/sports-world-model.md, temporal
 * semantics).
 */
export const DEFAULT_MAX_REORDER_MS = 5000;

/**
 * Confidence propagated from supporting observations: the MINIMUM of their
 * confidences, where an observation without `confidence` contributes
 * {@link MISSING_CONFIDENCE_DEFAULT}.
 */
export function minSupportingConfidence(observations: Observation[]): number {
  return Math.min(
    ...observations.map((observation) => observation.confidence ?? MISSING_CONFIDENCE_DEFAULT),
  );
}

/**
 * Deterministic regex match that is immune to a `global` flag's `lastIndex`
 * state, so rules can safely be reused across observations.
 */
export function matchesPattern(pattern: RegExp, text: string): boolean {
  if (!pattern.global) return pattern.test(text);
  return new RegExp(pattern.source, pattern.flags.replace("g", "")).test(text);
}

/**
 * Constructs a derived event envelope and validates it against the
 * `EventEnvelope` contract. Every event produced by this package goes through
 * this single path, so derivation and replay stay structurally identical.
 *
 * Throws the contracts' zod error when the constructed envelope is invalid
 * (for example an interval whose `endTimeMs` precedes its `startTimeMs`).
 */
export function buildDerivedEnvelope(input: {
  schemaVersion: string;
  sessionId: string;
  eventId: string;
  eventTypeRef: string;
  interval: Interval;
  eventTimeMs: number;
  evidence: EventEvidence;
  confidence?: number;
  correctionOf?: string;
}): EventEnvelope {
  return EventEnvelope.parse({
    eventId: input.eventId,
    sessionId: input.sessionId,
    schemaVersion: input.schemaVersion,
    eventTypeRef: input.eventTypeRef,
    interval: input.interval,
    eventTimeMs: input.eventTimeMs,
    provenance: "DERIVED",
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    evidence: input.evidence,
    ...(input.correctionOf !== undefined ? { correctionOf: input.correctionOf } : {}),
  });
}
