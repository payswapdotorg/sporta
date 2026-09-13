/**
 * Observation storage: the evidence side of the W005 observation/event model.
 *
 * An `ObservationStore` holds raw observations keyed by `observationId`.
 * Appends are validated against the `Observation` contract and are
 * idempotent on `observationId` (duplicate tolerance per the streaming
 * contract): re-delivering a known observation is a NO-OP that returns
 * `"duplicate"` rather than an error, and the first stored copy wins.
 *
 * The W005 implementation is in-memory; persistence interfaces arrive with
 * later platform work, so the exported `ObservationStore` interface is the
 * stable seam a persistent implementation can replace.
 */
import { Observation } from "@sporta/contracts";
import type { ObservationPayload, SourceModality } from "@sporta/contracts";

/** Filter for observation queries. All present bounds/filters are ANDed. */
export interface ObservationQuery {
  /** Session whose observations are returned (observations are session-scoped). */
  sessionId: string;
  /** Inclusive lower bound on `eventTimeMs` (canonical media timeline). */
  fromMs?: number;
  /** Inclusive upper bound on `eventTimeMs` (canonical media timeline). */
  toMs?: number;
  /** Restrict results to one producing modality. */
  modality?: SourceModality;
  /** Restrict results to one observation payload kind. */
  kind?: ObservationPayload["kind"];
}

/** Outcome of an append: a fresh insert, or an idempotent duplicate NO-OP. */
export type ObservationAppendResult = "appended" | "duplicate";

/**
 * Storage abstraction over observations, consumed by the derivation and
 * replay services. Re-linking evidence by `observationId` is the core
 * operation (`byId`); queries return the canonical `eventTimeMs` order.
 */
export interface ObservationStore {
  /**
   * Validates the observation against the `Observation` zod schema (invalid
   * input throws) and stores it.
   *
   * A duplicate `observationId` is an idempotent NO-OP: the observation is
   * NOT appended, the originally stored copy is kept, and `"duplicate"` is
   * returned instead of an error.
   */
  append(observation: Observation): ObservationAppendResult;
  /**
   * Returns observations of `sessionId` that satisfy all provided bounds and
   * filters, sorted by `eventTimeMs` (ties broken by append order, so the
   * result order is deterministic).
   */
  query(filter: ObservationQuery): Observation[];
  /** Looks an observation up by its stable `observationId`. */
  byId(observationId: string): Observation | undefined;
  /** Number of stored observations. */
  count(): number;
  /** All stored observations in canonical `eventTimeMs` order. */
  all(): Observation[];
}

interface StoredObservation {
  observation: Observation;
  /** Append sequence used as a deterministic tie-break for equal `eventTimeMs`. */
  sequence: number;
}

/** In-memory `ObservationStore` implementation (sufficient for W005). */
export class InMemoryObservationStore implements ObservationStore {
  private readonly stored = new Map<string, StoredObservation>();
  private nextSequence = 0;

  append(observation: Observation): ObservationAppendResult {
    const parsed = Observation.parse(observation);
    if (this.stored.has(parsed.observationId)) return "duplicate";
    this.stored.set(parsed.observationId, { observation: parsed, sequence: this.nextSequence });
    this.nextSequence += 1;
    return "appended";
  }

  query(filter: ObservationQuery): Observation[] {
    return this.canonicalOrder()
      .map((entry) => entry.observation)
      .filter((observation) => observation.sessionId === filter.sessionId)
      .filter(
        (observation) => filter.fromMs === undefined || observation.eventTimeMs >= filter.fromMs,
      )
      .filter((observation) => filter.toMs === undefined || observation.eventTimeMs <= filter.toMs)
      .filter(
        (observation) => filter.modality === undefined || observation.modality === filter.modality,
      )
      .filter(
        (observation) => filter.kind === undefined || observation.payload.kind === filter.kind,
      );
  }

  byId(observationId: string): Observation | undefined {
    return this.stored.get(observationId)?.observation;
  }

  count(): number {
    return this.stored.size;
  }

  all(): Observation[] {
    return this.canonicalOrder().map((entry) => entry.observation);
  }

  /** Copy of the stored entries in canonical order (non-mutating). */
  private canonicalOrder(): StoredObservation[] {
    return [...this.stored.values()].sort(
      (a, b) => a.observation.eventTimeMs - b.observation.eventTimeMs || a.sequence - b.sequence,
    );
  }
}
