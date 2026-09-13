/**
 * Event contracts: the versioned event envelope.
 *
 * An event is a semantically meaningful temporal occurrence derived from one
 * or more observations and/or authoritative metadata. Events are
 * interval-aware when needed, always carry their evidence chain, and are
 * corrected by versioned supersession — never silently rewritten
 * (docs/contracts/sports-world-model.md, temporal semantics).
 */
import { z } from "zod";
import { ProvenanceKind } from "./observation";
import { Interval } from "./timestamps";
import { schemaVersionField } from "./versioning";

/**
 * Evidence chain for an event: the observation ids it was derived from (at
 * least one), plus who reported/asserted the event where applicable.
 */
export const EventEvidence = z.object({
  observationIds: z.array(z.string().min(1)).min(1),
  reportedBy: z.string().min(1).optional(),
});
export type EventEvidence = z.infer<typeof EventEvidence>;

/**
 * A versioned event envelope.
 *
 * `eventTypeRef` follows the convention `"<sport>/v<taxonomy-version>/<type>"`
 * (e.g. `"football/v1/pass"`); the string form is intentionally not locked by
 * a pattern yet so the convention can evolve additively.
 *
 * `correctionOf`: when set, this event supersedes the event with that
 * `eventId`. Corrections are versioned and explicit; late data must never
 * silently rewrite history.
 */
export const EventEnvelope = z.object({
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  schemaVersion: schemaVersionField,
  eventTypeRef: z.string().min(1),
  interval: Interval,
  eventTimeMs: z.number().min(0),
  provenance: ProvenanceKind,
  confidence: z.number().min(0).max(1).optional(),
  evidence: EventEvidence,
  correctionOf: z.string().min(1).optional(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;
