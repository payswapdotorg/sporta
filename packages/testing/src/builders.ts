/**
 * Deterministic builders for contract-valid test data (W003).
 *
 * Every builder returns a FULLY VALID document for its `@sporta/contracts`
 * zod schema — the output is `schema.parse`d on build, so an invalid result
 * (e.g. caused by overrides) throws the zod error instead of leaking an
 * invalid object into a test.
 *
 * Determinism contract:
 *
 * - `(overrides?, seed?)` — same seed plus same overrides always produces a
 *   deep-equal result (the seed drives a mulberry32 PRNG via {@link createRng};
 *   no `Math.random`, no `Date.now` — see docs/testing/HARNESS.md);
 * - no seed given means the fixed {@link DEFAULT_SEED}, so even unseeded calls
 *   are reproducible;
 * - overrides deep-merge onto the generated defaults: plain objects merge
 *   recursively, arrays and primitives REPLACE wholesale, and an explicit
 *   `undefined` removes the key (useful for dropping optional fields).
 *
 * Time values are explicit millisecond constants on the canonical media
 * timeline (or fixed wall-clock epoch constants for ISO/ingest fields) — never
 * read from the clock.
 */
import {
  AuthorizationPolicy,
  EventEnvelope,
  MediaSession,
  Observation,
  RenderRequest,
  SCHEMA_VERSION,
  StageMessage,
  WorldSnapshot,
  deriveRightsCapabilities,
} from "@sporta/contracts";
import type {
  AuthorizationPolicy as AuthorizationPolicyDoc,
  EventEnvelope as EventEnvelopeDoc,
  MediaSession as MediaSessionDoc,
  Observation as ObservationDoc,
  RenderRequest as RenderRequestDoc,
  StageMessage as StageMessageDoc,
  UncertainValue,
  WorldSnapshot as WorldSnapshotDoc,
} from "@sporta/contracts";
import { DEFAULT_SEED, createRng } from "./rng";

/**
 * A recursively-partial override: objects may be partially overridden,
 * arrays and primitives are replaced wholesale.
 */
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepPartial<U>[]
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

/**
 * Fixed wall-clock epoch for deterministic ISO timestamps and epoch-ms fields:
 * 2025-01-06T12:00:00.000Z. Tests must never call `Date.now`/`new Date`
 * (docs/testing/HARNESS.md).
 */
export const TEST_EPOCH_ISO = "2025-01-06T12:00:00.000Z";

/** `Date.parse(TEST_EPOCH_ISO)` — the same instant in epoch milliseconds. */
export const TEST_EPOCH_MS = 1_736_164_800_000;

/** Far-future ISO instant used as the default policy expiry (never expired). */
const FAR_FUTURE_ISO = "2099-12-31T23:59:59.000Z";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type Rng = () => number;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges `overrides` onto `base` (immutably): plain objects merge
 * recursively; arrays and primitives replace wholesale; an explicit
 * `undefined` value removes the key entirely.
 */
export function deepMerge<T>(base: T, overrides: unknown): T {
  if (overrides === undefined) return base;
  if (isPlainObject(base) && isPlainObject(overrides)) {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete out[key];
      } else {
        out[key] = deepMerge(out[key], value);
      }
    }
    return out as T;
  }
  return overrides as T;
}

/** Deterministic hex id fragment (e.g. `a1b2c3`) drawn from the rng. */
function hexId(rng: Rng, length = 6): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(rng() * 16).toString(16);
  }
  return out;
}

/** A directly established uncertainty slot (see `UncertainValue`). */
function knownSlot<T>(value: T): UncertainValue<T> {
  return { status: "known", value };
}

/** An explicitly unset uncertainty slot — absence of knowledge, not invented. */
function unknownSlot(): UncertainValue<never> {
  return { status: "unknown" };
}

/** A candidate uncertainty slot with confidence in [0, 1]. */
function uncertainSlot<T>(value: T, confidence: number): UncertainValue<T> {
  return { status: "uncertain", value, confidence };
}

/** An integer in [0, max) drawn from the rng. */
function intFrom(rng: Rng, max: number): number {
  return Math.floor(rng() * max);
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Builds a valid `MediaSession` in the `created` status: one file source
 * whose `declaredRightsPolicyId` references the session's own
 * `authorizationPolicyId` (the ingestion-boundary invariant from the
 * media-session contract), a zeroed unmeasured timeline, and a `created`
 * processing state.
 *
 * Rng draw order: sessionId hex, policyId hex, sourceId hex, durationMs.
 */
export function buildMediaSession(
  overrides?: DeepPartial<MediaSessionDoc>,
  seed: number = DEFAULT_SEED,
): MediaSessionDoc {
  const rng = createRng(seed);
  const sessionId = `sess-${hexId(rng)}`;
  const policyId = `policy-${hexId(rng)}`;
  const sourceId = `src-${hexId(rng)}`;
  const timelineDurationMs = 90_000 + intFrom(rng, 60_000);
  const base: MediaSessionDoc = {
    sessionId,
    schemaVersion: SCHEMA_VERSION,
    status: "created",
    authorizationPolicyId: policyId,
    sources: [
      {
        sourceId,
        kind: "file",
        container: "mp4",
        videoStreams: 1,
        audioStreams: 1,
        durationMs: 60_000,
        declaredRightsPolicyId: policyId,
      },
    ],
    timeline: {
      durationMs: timelineDurationMs,
      videoClockOffsetMs: 0,
      audioClockOffsetMs: 0,
      driftMeasured: false,
    },
    processingState: { stage: "created" },
    createdAtIso: TEST_EPOCH_ISO,
  };
  return MediaSession.parse(deepMerge(base, overrides));
}

/**
 * Builds a valid vision `Observation` with a detection payload: rng-driven
 * `confidence` in [0, 1), a normalized-image-space box kept inside [0, 1],
 * and `provenance: "OBSERVED"`.
 *
 * Rng draw order: box x, box y, observationId hex, sessionId hex,
 * eventTimeMs, confidence, box w, box h.
 */
export function buildObservation(
  overrides?: DeepPartial<ObservationDoc>,
  seed: number = DEFAULT_SEED,
): ObservationDoc {
  const rng = createRng(seed);
  const boxX = rng();
  const boxY = rng();
  const observationId = `obs-${hexId(rng)}`;
  const sessionId = `sess-${hexId(rng)}`;
  const eventTimeMs = intFrom(rng, 60_000);
  const confidence = rng();
  const boxW = rng() * (1 - boxX);
  const boxH = rng() * (1 - boxY);
  const base: ObservationDoc = {
    observationId,
    sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs,
    ingestTimeMs: TEST_EPOCH_MS,
    modality: "vision",
    componentId: "comp-detector-v1",
    modelId: "model-detector-v1",
    provenance: "OBSERVED",
    confidence,
    payload: {
      kind: "detection",
      box: { x: boxX, y: boxY, w: boxW, h: boxH },
      label: "player",
    },
    subjectEntityRefs: [],
  };
  return Observation.parse(deepMerge(base, overrides));
}

/**
 * Builds a valid derived `EventEnvelope` with an evidence chain: provenance
 * `"DERIVED"`, one evidence observation id, and an interval that ends at the
 * event time and starts up to 500 ms earlier (clamped to 0).
 *
 * Rng draw order: eventId hex, evidence observationId hex, sessionId hex,
 * eventTimeMs, confidence.
 */
export function buildEventEnvelope(
  overrides?: DeepPartial<EventEnvelopeDoc>,
  seed: number = DEFAULT_SEED,
): EventEnvelopeDoc {
  const rng = createRng(seed);
  const eventId = `evt-${hexId(rng)}`;
  const evidenceObservationId = `obs-${hexId(rng)}`;
  const sessionId = `sess-${hexId(rng)}`;
  const eventTimeMs = intFrom(rng, 60_000);
  const confidence = rng();
  const base: EventEnvelopeDoc = {
    eventId,
    sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTypeRef: "football/v1/pass",
    interval: { startTimeMs: Math.max(0, eventTimeMs - 500), endTimeMs: eventTimeMs },
    eventTimeMs,
    provenance: "DERIVED",
    confidence,
    evidence: { observationIds: [evidenceObservationId] },
  };
  return EventEnvelope.parse(deepMerge(base, overrides));
}

/**
 * Builds a valid `WorldSnapshot` including the optional football extension
 * state. The football state exercises all three uncertainty-slot shapes:
 * a `known` team role, an `unknown` player pitch position (an unset field is
 * `unknown`, never invented), and `uncertain` candidates for the ball
 * position, the score status, and possession.
 *
 * Rng draw order: ballTimeMs, playerTimeMs, ball x, ball y, ball confidence,
 * possession confidence, score home, score away, score-status confidence,
 * clockMs, sessionId hex, watermark sequence.
 */
export function buildWorldSnapshot(
  overrides?: DeepPartial<WorldSnapshotDoc>,
  seed: number = DEFAULT_SEED,
): WorldSnapshotDoc {
  const rng = createRng(seed);
  const ballTimeMs = intFrom(rng, 30_000);
  const playerTimeMs = intFrom(rng, 30_000);
  const ballX = rng() * 105;
  const ballY = rng() * 68;
  const ballConfidence = rng();
  const possessionConfidence = rng();
  const scoreHome = intFrom(rng, 4);
  const scoreAway = intFrom(rng, 4);
  const scoreConfidence = rng();
  const clockMs = intFrom(rng, 2_700_000);
  const sessionId = `sess-${hexId(rng)}`;
  const watermarkSequence = intFrom(rng, 100);
  const watermarkMs = Math.max(ballTimeMs, playerTimeMs);
  const base: WorldSnapshotDoc = {
    sessionId,
    schemaVersion: SCHEMA_VERSION,
    watermark: { watermarkMs, sequence: watermarkSequence },
    entities: [
      {
        entityId: "ball-1",
        kind: "ball",
        version: 1,
        lastEventTimeMs: ballTimeMs,
        state: {
          pitchPosition: uncertainSlot({ x: ballX, y: ballY }, ballConfidence),
        },
      },
      {
        entityId: "player-7",
        kind: "participant",
        version: 2,
        lastEventTimeMs: playerTimeMs,
        state: {
          pitchPosition: unknownSlot(),
          teamRole: knownSlot("midfielder"),
        },
      },
    ],
    football: {
      pitch: {
        lengthAxisMeters: 105,
        widthAxisMeters: 68,
        origin: "corner",
        axes: "x=touchline, y=goal-line",
      },
      clock: { period: "first-half", clockMs, stoppage: false },
      score: {
        home: scoreHome,
        away: scoreAway,
        status: uncertainSlot("provisional", scoreConfidence),
      },
      possession: uncertainSlot({ entityId: "player-7" }, possessionConfidence),
      eventTaxonomyVersion: "v1",
    },
    generatedAtMs: TEST_EPOCH_MS,
  };
  return WorldSnapshot.parse(deepMerge(base, overrides));
}

/**
 * Builds a valid `AuthorizationPolicy` that is currently in force: it always
 * allows `analysis` (so sessions can be authorized out of the box) and adds
 * `transformation`, `storage`, and `sharing` each with probability 1/2 from
 * the rng, asserted by a test operator and expiring in the far future.
 *
 * Rng draw order: policyId hex, then the three optional-operation draws.
 */
export function buildAuthorizationPolicy(
  overrides?: DeepPartial<AuthorizationPolicyDoc>,
  seed: number = DEFAULT_SEED,
): AuthorizationPolicyDoc {
  const rng = createRng(seed);
  const policyId = `policy-${hexId(rng)}`;
  const optionalOperations = ["transformation", "storage", "sharing"] as const;
  const allowedOperations: AuthorizationPolicyDoc["allowedOperations"] = ["analysis"];
  for (const operation of optionalOperations) {
    if (rng() < 0.5) allowedOperations.push(operation);
  }
  const base: AuthorizationPolicyDoc = {
    policyId,
    allowedOperations,
    assertedBy: "sporta-test-operator",
    expiresAtIso: FAR_FUTURE_ISO,
    storageDurationDays: 90,
    sharingScope: "private",
  };
  return AuthorizationPolicy.parse(deepMerge(base, overrides));
}

/**
 * Builds a valid `RenderRequest` whose `rightsCapabilities` are DERIVED
 * (fail-closed, evaluated at {@link TEST_EPOCH_MS}) from an authorization
 * policy generated from the same seed — capabilities are never invented
 * (renderer contract). The rest is a fixed offline 1080p30 AVC profile over
 * snapshot version 1.
 *
 * Rng draw order: sessionId hex, then the policy draws in
 * {@link buildAuthorizationPolicy} order.
 */
export function buildRenderRequest(
  overrides?: DeepPartial<RenderRequestDoc>,
  seed: number = DEFAULT_SEED,
): RenderRequestDoc {
  const rng = createRng(seed);
  const sessionId = `sess-${hexId(rng)}`;
  const policy = buildAuthorizationPolicy(undefined, seed);
  const base: RenderRequestDoc = {
    sessionId,
    schemaVersion: SCHEMA_VERSION,
    rendererId: "renderer-stylized-v1",
    rendererVersion: "0.1.0",
    styleConfig: {
      styleId: "style-test",
      configSchemaVersion: "1.0",
      config: { palette: "default" },
    },
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: {
      resolution: { w: 1920, h: 1080 },
      frameRate: 30,
      codec: "avc1",
      container: "mp4",
      latencyClass: "offline",
    },
    rightsCapabilities: deriveRightsCapabilities(policy, new Date(TEST_EPOCH_MS)),
    sourceFrameRefs: [],
  };
  return RenderRequest.parse(deepMerge(base, overrides));
}

/**
 * Builds a valid `StageMessage` carrying a small test payload, a correlation
 * id and a trace id (the streaming stage contract), and an explicit
 * resource budget.
 *
 * Rng draw order: sessionId hex, sequence, watermarkMs, watermark sequence,
 * correlationId hex, traceId hex.
 */
export function buildStageMessage(
  overrides?: DeepPartial<StageMessageDoc>,
  seed: number = DEFAULT_SEED,
): StageMessageDoc {
  const rng = createRng(seed);
  const sessionId = `sess-${hexId(rng)}`;
  const sequence = intFrom(rng, 1000);
  const watermarkMs = intFrom(rng, 60_000);
  const watermarkSequence = intFrom(rng, 1000);
  const correlationId = `corr-${hexId(rng)}`;
  const traceId = `trace-${hexId(rng)}`;
  const base: StageMessageDoc = {
    sessionId,
    schemaVersion: SCHEMA_VERSION,
    sequence,
    watermark: { watermarkMs, sequence: watermarkSequence },
    payload: { kind: "stage-test-payload" },
    correlationId,
    traceId,
    resourceBudget: { maxMemoryMb: 512, maxGpuMs: 16 },
  };
  return StageMessage.parse(deepMerge(base, overrides));
}
