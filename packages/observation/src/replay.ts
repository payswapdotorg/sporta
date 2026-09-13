/**
 * Deterministic replay: re-materializes the derived event sequence from the
 * recorded observations.
 *
 * The `ReplayLog` is an append-only log of derived event envelopes. Appends
 * accept bounded out-of-order arrival (a `maxReorderMs` window against the
 * log's high-water `eventTimeMs`); events later than that are rejected with
 * `LateEventError` — late data must never silently rewrite history
 * (docs/contracts/sports-world-model.md, temporal semantics). Corrections are
 * versioned supersession, never in-place edits.
 *
 * `replayDeterministic` is a pure function of (log, store): every event whose
 * evidence observations are ALL present in the store is re-derived through
 * the same envelope-construction path as live derivation; events with
 * missing evidence are skipped with an explicit reason; events superseded by
 * a correction are returned in `superseded` (provenance preserved, never
 * dropped silently).
 */
import { EventEnvelope } from "@sporta/contracts";
import type { Observation } from "@sporta/contracts";
import { DEFAULT_MAX_REORDER_MS, buildDerivedEnvelope, minSupportingConfidence } from "./internal";
import type { ObservationStore } from "./store";

/**
 * Thrown when appending an event whose `eventTimeMs` is earlier than the
 * log's high-water mark by more than the bounded reorder window. No silent
 * history rewrite: the event is rejected and the log is left untouched.
 */
export class LateEventError extends Error {
  readonly eventTimeMs: number;
  /** High-water `eventTimeMs` of the log at the rejected append. */
  readonly highWaterMs: number;
  /** How far behind the high-water mark the event arrived, in ms. */
  readonly latenessMs: number;
  readonly maxReorderMs: number;

  constructor(details: { eventTimeMs: number; highWaterMs: number; maxReorderMs: number }) {
    const latenessMs = details.highWaterMs - details.eventTimeMs;
    super(
      `event at ${details.eventTimeMs}ms is ${latenessMs}ms behind the log high-water mark ` +
        `${details.highWaterMs}ms, beyond the ${details.maxReorderMs}ms reorder window`,
    );
    this.name = "LateEventError";
    this.eventTimeMs = details.eventTimeMs;
    this.highWaterMs = details.highWaterMs;
    this.latenessMs = latenessMs;
    this.maxReorderMs = details.maxReorderMs;
  }
}

/** Options for constructing a `ReplayLog`. */
export interface ReplayLogOptions {
  /** Bounded reorder window in ms on the canonical media timeline (default 5000). */
  maxReorderMs?: number;
}

/** Inclusive `eventTimeMs` window when reading events from a log. */
export interface ReplayLogWindow {
  from?: number;
  to?: number;
}

/** An event that could not be re-derived, with the explicit reason. */
export interface SkippedEvent {
  event: EventEnvelope;
  reason: "missing-evidence";
}

/** Result of a deterministic replay. */
export interface ReplayResult {
  /** Effective re-derived event sequence, in canonical `eventTimeMs` order, corrections applied. */
  events: EventEnvelope[];
  /** Recorded events whose evidence observations are not all present in the store. */
  skipped: SkippedEvent[];
  /** Events superseded by a correction during replay; envelopes kept for provenance. */
  superseded: EventEnvelope[];
  /** Replay is a pure function of (log, store): asserted deterministic. */
  deterministic: true;
}

interface LoggedEvent {
  event: EventEnvelope;
  /** Append sequence used as a deterministic tie-break for equal `eventTimeMs`. */
  sequence: number;
}

/** Append-only event log with bounded out-of-order tolerance. */
export class ReplayLog {
  /** Bounded reorder window in ms (events later than this behind the high-water mark are rejected). */
  readonly maxReorderMs: number;

  private readonly logged: LoggedEvent[] = [];
  private highWaterMs: number | undefined;
  private nextSequence = 0;

  constructor(options: ReplayLogOptions = {}) {
    this.maxReorderMs = options.maxReorderMs ?? DEFAULT_MAX_REORDER_MS;
  }

  /**
   * Validates the event against the `EventEnvelope` contract and appends it.
   *
   * Out-of-order appends are accepted while the event is no more than
   * `maxReorderMs` behind the log's high-water `eventTimeMs`; beyond that a
   * `LateEventError` is thrown and the log is left untouched.
   */
  append(event: EventEnvelope): void {
    const parsed = EventEnvelope.parse(event);
    if (
      this.highWaterMs !== undefined &&
      parsed.eventTimeMs < this.highWaterMs &&
      this.highWaterMs - parsed.eventTimeMs > this.maxReorderMs
    ) {
      throw new LateEventError({
        eventTimeMs: parsed.eventTimeMs,
        highWaterMs: this.highWaterMs,
        maxReorderMs: this.maxReorderMs,
      });
    }
    if (this.highWaterMs === undefined || parsed.eventTimeMs > this.highWaterMs) {
      this.highWaterMs = parsed.eventTimeMs;
    }
    this.logged.push({ event: parsed, sequence: this.nextSequence });
    this.nextSequence += 1;
  }

  /**
   * Events within the inclusive `eventTimeMs` window, in canonical order
   * (`eventTimeMs`, ties broken by append sequence).
   */
  events(window: ReplayLogWindow = {}): EventEnvelope[] {
    return this.canonicalOrder()
      .map((entry) => entry.event)
      .filter((event) => window.from === undefined || event.eventTimeMs >= window.from)
      .filter((event) => window.to === undefined || event.eventTimeMs <= window.to);
  }

  /** All logged events in canonical order. */
  asArray(): EventEnvelope[] {
    return this.events();
  }

  /** Copy of the logged entries in canonical order (non-mutating). */
  private canonicalOrder(): LoggedEvent[] {
    return [...this.logged].sort(
      (a, b) => a.event.eventTimeMs - b.event.eventTimeMs || a.sequence - b.sequence,
    );
  }
}

/** Inclusive `eventTimeMs` window for a replay. */
export interface ReplayWindow {
  fromMs?: number;
  toMs?: number;
}

/**
 * Re-materializes the derived event sequence from the recorded observations.
 *
 * For each logged event in the window (canonical order):
 *
 * - every evidence observation id is resolved in the store; if any is
 *   missing, the recorded event is reported in `skipped` with reason
 *   `"missing-evidence"` (evidence-chain integrity — an event whose evidence
 *   is not on record is not re-derived);
 * - otherwise the event is re-derived through the same envelope-construction
 *   path as live derivation: recorded derivation parameters (ids, type,
 *   interval, time, evidence, correction reference, schema version) are
 *   preserved, `provenance` is re-stamped `"DERIVED"` (replay output is
 *   derived by construction), and `confidence` carries the recorded value —
 *   the derivation rule's own confidence (e.g. the commentary weight) is part
 *   of the recorded derivation output and is not reinvented; when the
 *   recorded event carries no confidence, the standard minimum-of-evidence
 *   propagation applies (missing observation confidence counts as 0.5).
 *
 * Corrections: re-derived events whose `correctionOf` references another
 * re-derived event supersede it — the superseded event is moved to
 * `superseded` (envelope preserved, never dropped silently) and excluded from
 * the effective `events` sequence. The correction keeps its `correctionOf`
 * reference. Chains resolve to the latest correction.
 */
export function replayDeterministic(
  log: ReplayLog,
  store: ObservationStore,
  window: ReplayWindow = {},
): ReplayResult {
  const candidates = log.events({ from: window.fromMs, to: window.toMs });

  const rederived: EventEnvelope[] = [];
  const skipped: SkippedEvent[] = [];
  for (const recorded of candidates) {
    const observations: Observation[] = [];
    const missing: string[] = [];
    for (const observationId of recorded.evidence.observationIds) {
      const found = store.byId(observationId);
      if (found === undefined) missing.push(observationId);
      else observations.push(found);
    }
    if (missing.length > 0) {
      skipped.push({ event: recorded, reason: "missing-evidence" });
      continue;
    }
    rederived.push(rederiveEvent(recorded, observations));
  }

  const supersededIds = new Set<string>();
  for (const event of rederived) {
    if (event.correctionOf !== undefined) supersededIds.add(event.correctionOf);
  }
  const events = rederived.filter((event) => !supersededIds.has(event.eventId));
  const superseded = rederived.filter((event) => supersededIds.has(event.eventId));

  return { events, skipped, superseded, deterministic: true };
}

/** Re-derives one event from its recorded derivation inputs and resolved evidence. */
function rederiveEvent(recorded: EventEnvelope, observations: Observation[]): EventEnvelope {
  return buildDerivedEnvelope({
    schemaVersion: recorded.schemaVersion,
    sessionId: recorded.sessionId,
    eventId: recorded.eventId,
    eventTypeRef: recorded.eventTypeRef,
    interval: recorded.interval,
    eventTimeMs: recorded.eventTimeMs,
    evidence: recorded.evidence,
    confidence: recorded.confidence ?? minSupportingConfidence(observations),
    ...(recorded.correctionOf !== undefined ? { correctionOf: recorded.correctionOf } : {}),
  });
}
