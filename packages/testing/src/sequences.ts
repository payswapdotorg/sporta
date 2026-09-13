/**
 * Deterministic sequences: timelines of observations and events spread across
 * the canonical media timeline (W003).
 *
 * Every item is placed at `fromMs + i * stepMs` — explicit millisecond
 * positions, no clock reads — and each item is validated against its
 * `@sporta/contracts` schema on construction. Ids are index-based
 * (`obs-0000`, `evt-0000`, zero-padded to 4) so they are readable, unique,
 * and stable across seeds; the rng only drives confidences and payload
 * values, so the same seed plus the same options always yields a deep-equal
 * sequence.
 *
 * Cross-linking: `observationTimeline` and `eventSequence` use the same id
 * scheme, so a `eventSequence({ count, ... })` carries evidence ids that
 * match the observations of a `observationTimeline({ count, ... })` generated
 * with the same count — handy for e2e fixtures that need events linked to a
 * stored observation timeline.
 */
import { EventEnvelope, Observation, SCHEMA_VERSION } from "@sporta/contracts";
import type {
  Observation as ObservationDoc,
  ObservationPayload,
  SourceModality,
} from "@sporta/contracts";
import { DEFAULT_SEED, createRng } from "./rng";
import { TEST_EPOCH_MS } from "./builders";

type Rng = () => number;

/** Default modality cycle for {@link observationTimeline}. */
export const DEFAULT_MODALITIES: readonly SourceModality[] = ["vision", "audio", "metadata"];

/** Default event type cycle for {@link eventSequence} (football taxonomy v1). */
export const DEFAULT_EVENT_TYPE_REFS: readonly string[] = [
  "football/v1/pass",
  "football/v1/carry",
  "football/v1/tackle",
];

/** Options for {@link observationTimeline}. */
export interface ObservationTimelineOptions {
  /** Number of observations to generate (non-negative integer). */
  count: number;
  /** Timeline position of the first observation, in ms (>= 0). */
  fromMs: number;
  /** Spacing between consecutive observations, in ms (>= 0). */
  stepMs: number;
  /**
   * Modalities cycled through in order (defaults to
   * vision/audio/metadata). The payload kind follows the modality:
   * vision -> detection, audio/commentary -> transcription, metadata ->
   * generic.
   */
  modalities?: readonly SourceModality[];
  /** Session id stamped on every observation (recommended for e2e use). */
  sessionId?: string;
  /** PRNG seed (defaults to the fixed DEFAULT_SEED — deterministic). */
  seed?: number;
}

/** Options for {@link eventSequence}. */
export interface EventSequenceOptions {
  /** Number of events to generate (non-negative integer). */
  count: number;
  /** Timeline position of the first event, in ms (>= 0). */
  fromMs: number;
  /** Spacing between consecutive events, in ms (>= 0). */
  stepMs: number;
  /** Event type refs cycled through in order (football/v1/* defaults). */
  eventTypeRefs?: readonly string[];
  /** Session id stamped on every event (recommended for e2e use). */
  sessionId?: string;
  /** PRNG seed (defaults to the fixed DEFAULT_SEED — deterministic). */
  seed?: number;
}

function assertSequenceOptions(count: number, fromMs: number, stepMs: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`count must be a non-negative integer (got ${String(count)})`);
  }
  if (!Number.isFinite(fromMs) || fromMs < 0) {
    throw new RangeError(`fromMs must be a finite number >= 0 (got ${String(fromMs)})`);
  }
  if (!Number.isFinite(stepMs) || stepMs < 0) {
    throw new RangeError(`stepMs must be a finite number >= 0 (got ${String(stepMs)})`);
  }
}

/** Zero-padded 4-digit index used for `obs-`/`evt-` ids and evidence links. */
function paddedIndex(index: number): string {
  return String(index).padStart(4, "0");
}

/** Deterministic hex id fragment drawn from the rng. */
function hexId(rng: Rng, length = 6): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(rng() * 16).toString(16);
  }
  return out;
}

/**
 * Builds the payload matching `modality`: vision observations carry detection
 * boxes (kept inside normalized [0, 1] coordinates), audio and commentary
 * observations carry transcriptions, and metadata observations carry a small
 * generic payload.
 */
function payloadForModality(modality: SourceModality, index: number, rng: Rng): ObservationPayload {
  switch (modality) {
    case "vision": {
      const x = rng();
      const y = rng();
      return {
        kind: "detection",
        box: { x, y, w: rng() * (1 - x), h: rng() * (1 - y) },
        label: "player",
      };
    }
    case "audio":
    case "commentary":
      return {
        kind: "transcription",
        text: `${modality} transcript ${paddedIndex(index)}`,
        speakerLabel: `${modality}-speaker`,
        asrConfidence: rng(),
      };
    case "metadata":
      return { kind: "generic", data: { index, source: modality } };
  }
}

/**
 * Builds `count` observations spread across the canonical media timeline at
 * `fromMs + i * stepMs`, alternating through the given modalities (default
 * vision/audio/metadata). Each observation is schema-valid, carries
 * `provenance: "OBSERVED"` and an rng-driven confidence in [0, 1), and is
 * validated against the `Observation` contract on construction.
 */
export function observationTimeline(options: ObservationTimelineOptions): ObservationDoc[] {
  const { count, fromMs, stepMs } = options;
  assertSequenceOptions(count, fromMs, stepMs);
  const rng = createRng(options.seed ?? DEFAULT_SEED);
  const modalities = options.modalities ?? DEFAULT_MODALITIES;
  if (modalities.length === 0) {
    throw new RangeError("modalities must contain at least one modality");
  }
  const sessionId = options.sessionId ?? `sess-${hexId(rng)}`;

  const observations: ObservationDoc[] = [];
  for (let i = 0; i < count; i += 1) {
    const modality = modalities[i % modalities.length]!;
    const observation: ObservationDoc = {
      observationId: `obs-${paddedIndex(i)}`,
      sessionId,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: fromMs + i * stepMs,
      ingestTimeMs: TEST_EPOCH_MS,
      modality,
      componentId: `comp-${modality}-v1`,
      modelId: `model-${modality}-v1`,
      provenance: "OBSERVED",
      confidence: rng(),
      payload: payloadForModality(modality, i, rng),
      subjectEntityRefs: [],
    };
    observations.push(Observation.parse(observation));
  }
  return observations;
}

/**
 * Builds `count` derived events spread across the canonical media timeline at
 * `fromMs + i * stepMs`, cycling through the given event type refs (football
 * v1 pass/carry/tackle by default). Events are instantaneous (interval start
 * equals end equals `eventTimeMs`), carry `provenance: "DERIVED"` and an
 * rng-driven confidence, and link evidence by the `obs-<index>` id scheme
 * shared with {@link observationTimeline} (see module docs).
 */
export function eventSequence(options: EventSequenceOptions): EventEnvelope[] {
  const { count, fromMs, stepMs } = options;
  assertSequenceOptions(count, fromMs, stepMs);
  const rng = createRng(options.seed ?? DEFAULT_SEED);
  const eventTypeRefs = options.eventTypeRefs ?? DEFAULT_EVENT_TYPE_REFS;
  if (eventTypeRefs.length === 0) {
    throw new RangeError("eventTypeRefs must contain at least one event type ref");
  }
  const sessionId = options.sessionId ?? `sess-${hexId(rng)}`;

  const events: EventEnvelope[] = [];
  for (let i = 0; i < count; i += 1) {
    const eventTimeMs = fromMs + i * stepMs;
    const event: EventEnvelope = {
      eventId: `evt-${paddedIndex(i)}`,
      sessionId,
      schemaVersion: SCHEMA_VERSION,
      eventTypeRef: eventTypeRefs[i % eventTypeRefs.length]!,
      interval: { startTimeMs: eventTimeMs, endTimeMs: eventTimeMs },
      eventTimeMs,
      provenance: "DERIVED",
      confidence: rng(),
      evidence: { observationIds: [`obs-${paddedIndex(i)}`] },
    };
    events.push(EventEnvelope.parse(event));
  }
  return events;
}
