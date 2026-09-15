/**
 * The W306 controlled live-stream fixture: a deterministic, seeded, checked-in
 * script of incremental SWM updates whose arrivals advance the INJECTED clock
 * (never a wall clock).
 *
 * ## What is authored vs measured (the honesty split)
 *
 * AUTHORED (the fixture is the input model — deterministic constants + the
 * seeded `@sporta/testing` mulberry32 PRNG, never `Math.random`):
 *
 * - the match story: a REAL W006 `WorldModelEngine` driven exactly the way
 *   the W304 fixtures drive it (per-second `upsertEntity` for a moving
 *   participant and a trailing uncertain ball, `applyEvent` at authored event
 *   times), observed through the REAL W402 consumer seams (`stateAt` +
 *   `eventWindow`) — the update documents are genuine
 *   `WorldSnapshot`/`WorldEventStreamEntry` values with verbatim watermarks;
 * - the live-source schedule: per update, `observedAtMs` (when the live
 *   evidence existed — the ingestion input boundary) and `visibleAtMs` (when
 *   the world-model update completed and the update entered the store),
 *   with `deriveMs = visibleAt − observed` modelling the world-model update
 *   derivation cost (perception → fusion work on the same injected clock).
 *
 * MEASURED (never authored — see `trace.ts`): every downstream boundary is a
 * clock read taken by the instrumented seams while the REAL W304 orchestrator
 * runs.
 *
 * ## The burst (why the fixture has one)
 *
 * A latency benchmark with a uniformly paced stream measures only the
 * pipeline's floor. The fixture therefore embeds one 10-second dense-action
 * window (event time 30s–40s, per `burstEventFromMs`/`burstEventToMs`) where
 * the source emits sixteen finer-grained updates per event second at a
 * compressed arrival cadence — arrivals then exceed the modeled render
 * capacity, the W303 ready queue backs up (nothing is dropped: degradation
 * is disabled and backpressure is `block`), and the queue drains afterwards.
 * This is what gives p95 its honest tail: the burst exercises the W304
 * bounded-queue machinery (peak-batches-in-system plateau, reorder hold)
 * exactly as the W304 acceptance intended, on the injected clock.
 *
 * Adapted from the W304 fixture construction (`render-orchestration/test/
 * helpers.ts` `buildSwmStory` — test-local there, so the construction is
 * re-implemented here against the same public packages and seams, never
 * imported across a test boundary).
 */
import {
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
  SCHEMA_VERSION,
} from "@sporta/contracts";
import type { SwmUpdate } from "@sporta/render-orchestration";
import { createRng, seedFromString } from "@sporta/testing";
import { eventWindow, stateAt } from "@sporta/temporal";
import { WorldModelEngine } from "@sporta/world-model";
import type { FootballState } from "@sporta/world-model";
import { LatencyFixtureError } from "./errors";

/**
 * The checked-in fixture profile (frozen; the report echoes it verbatim so a
 * report is always interpretable against the exact fixture that produced it).
 */
export interface LiveFixtureProfile {
  /** The profile's identity (echoed into reports and the eval-harness case). */
  readonly profileId: string;
  /** Bump when any authored constant changes (reports record the version). */
  readonly profileVersion: number;
  /** The PRNG seed string (same seed → byte-identical schedule). */
  readonly seed: string;
  /** Event-time span of the story, in whole seconds (>= 2). */
  readonly seconds: number;
  /** Clock gap between consecutive updates in the NORMAL phase (ms). */
  readonly normalGapMs: number;
  /** Clock gap between consecutive updates in the BURST phase (ms). */
  readonly burstGapMs: number;
  /** Event-time window [fromMs, toMs) of the dense-action burst. */
  readonly burstEventFromMs: number;
  readonly burstEventToMs: number;
  /** Updates per event second inside the burst (>= 2; 1 outside). */
  readonly burstUpdatesPerSecond: number;
  /** Max seeded arrival jitter per update (ms, uniform [0, max]). */
  readonly maxArrivalJitterMs: number;
  /** World-model-update derivation cost range per update (ms, inclusive). */
  readonly deriveMinMs: number;
  readonly deriveMaxMs: number;
  /** Declared payload bytes per update (the W104 sizer evidence). */
  readonly byteSize: number;
  /** First update's nominal observation time on the injected clock (ms). */
  readonly firstObservationAtMs: number;
}

/** The W306 default live-stream fixture profile (the benchmark's input). */
export const LIVE_FIXTURE_PROFILE: LiveFixtureProfile = Object.freeze({
  profileId: "w306-live-fixture",
  profileVersion: 1,
  seed: "w306-live-fixture-v1",
  seconds: 90,
  normalGapMs: 1_000,
  burstGapMs: 10,
  burstEventFromMs: 30_000,
  burstEventToMs: 40_000,
  burstUpdatesPerSecond: 16,
  maxArrivalJitterMs: 20,
  deriveMinMs: 40,
  deriveMaxMs: 120,
  byteSize: 2_048,
  firstObservationAtMs: 1_000,
});

/** One authored live-source step: the update plus its clock schedule. */
export interface LiveSourceStep {
  /** The update's store sequence (0-based, strictly increasing). */
  readonly sequence: number;
  /** The incremental SWM update (real W006/W402 documents, verbatim). */
  readonly update: SwmUpdate;
  /** When the live evidence existed (the ingestion input boundary). */
  readonly observedAtMs: number;
  /** When the world-model update completed (`observedAtMs + deriveMs`). */
  readonly visibleAtMs: number;
  /** The authored derivation cost (`visibleAtMs − observedAtMs`). */
  readonly deriveMs: number;
}

/** The built fixture: the authored schedule plus the story's session id. */
export interface LiveFixture {
  readonly profile: LiveFixtureProfile;
  readonly sessionId: string;
  readonly steps: readonly LiveSourceStep[];
}

/** The authored match events (event-time ms → applied before that second's snapshot). */
const STORY_EVENTS: ReadonlyArray<{
  eventId: string;
  atMs: number;
  typeRef: string;
  confidence?: number;
  evidenceId: string;
}> = [
  { eventId: "evt-pass-1", atMs: 1_500, typeRef: "football/v1/pass", evidenceId: "obs-1" },
  {
    eventId: "evt-goal-1",
    atMs: 5_500,
    typeRef: "football/v1/goal",
    confidence: 0.95,
    evidenceId: "obs-2",
  },
  { eventId: "evt-card-1", atMs: 15_500, typeRef: "football/v1/foul", evidenceId: "obs-3" },
  { eventId: "evt-pass-2", atMs: 25_500, typeRef: "football/v1/pass", evidenceId: "obs-4" },
  {
    eventId: "evt-goal-2",
    atMs: 50_500,
    typeRef: "football/v1/goal",
    confidence: 0.9,
    evidenceId: "obs-5",
  },
  { eventId: "evt-sub-1", atMs: 60_500, typeRef: "football/v1/substitution", evidenceId: "obs-6" },
  { eventId: "evt-pass-3", atMs: 75_500, typeRef: "football/v1/pass", evidenceId: "obs-7" },
  {
    eventId: "evt-goal-3",
    atMs: 85_500,
    typeRef: "football/v1/goal",
    confidence: 0.92,
    evidenceId: "obs-8",
  },
];

/**
 * Whether event-time `watermarkMs` sits inside the burst window (the
 * owning-second test: a second is burst-dense iff its END boundary is inside
 * `[burstEventFromMs, burstEventToMs)` — `watermarksForSecond` uses this to
 * decide sub-stepping, and the arrival schedule uses it to pick the cadence).
 */
function inBurst(profile: LiveFixtureProfile, watermarkMs: number): boolean {
  return watermarkMs >= profile.burstEventFromMs && watermarkMs < profile.burstEventToMs;
}

/** One authored story tick: the watermark plus its owning-second burst flag. */
interface StoryMark {
  readonly watermarkMs: number;
  /** Whether this tick belongs to a burst-dense event second. */
  readonly burst: boolean;
}

/**
 * The event-time watermarks for one event second (sub-stepped in bursts).
 * A burst second's window `((second-1)*1000, second*1000]` is cut into
 * `burstUpdatesPerSecond` equal sub-windows, each closed at its own watermark
 * (the dense-action finer granularity); a normal second carries exactly one
 * watermark at its end.
 */
function marksForSecond(profile: LiveFixtureProfile, second: number): StoryMark[] {
  const endMs = second * 1_000;
  if (!inBurst(profile, endMs)) {
    return [{ watermarkMs: endMs, burst: false }];
  }
  const sub = profile.burstUpdatesPerSecond;
  const marks: StoryMark[] = [];
  for (let i = sub; i >= 1; i -= 1) {
    marks.push({ watermarkMs: endMs - ((i - 1) * 1_000) / sub, burst: true });
  }
  return marks;
}

/** Validates the profile's authored constants (fail loud, no silent clamps). */
function assertProfile(profile: LiveFixtureProfile): void {
  const requirePositive = (value: number, label: string): void => {
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new LatencyFixtureError(`${label} must be a positive integer (got ${String(value)})`);
    }
  };
  if (typeof profile.profileId !== "string" || profile.profileId.length < 1) {
    throw new LatencyFixtureError("profileId must be a non-empty string");
  }
  if (!Number.isInteger(profile.profileVersion) || profile.profileVersion < 1) {
    throw new LatencyFixtureError("profileVersion must be an integer >= 1");
  }
  if (typeof profile.seed !== "string" || profile.seed.length < 1) {
    throw new LatencyFixtureError("seed must be a non-empty string");
  }
  requirePositive(profile.seconds, "seconds");
  requirePositive(profile.normalGapMs, "normalGapMs");
  requirePositive(profile.burstGapMs, "burstGapMs");
  requirePositive(profile.maxArrivalJitterMs + 1, "maxArrivalJitterMs");
  if (
    !Number.isFinite(profile.burstEventFromMs) ||
    !Number.isFinite(profile.burstEventToMs) ||
    profile.burstEventFromMs < 1_000 ||
    profile.burstEventToMs <= profile.burstEventFromMs ||
    profile.burstEventToMs > profile.seconds * 1_000
  ) {
    throw new LatencyFixtureError(
      "the burst window must satisfy 1000 <= fromMs < toMs <= seconds*1000 " +
        `(got [${String(profile.burstEventFromMs)}, ${String(profile.burstEventToMs)}))`,
    );
  }
  if (!Number.isInteger(profile.burstUpdatesPerSecond) || profile.burstUpdatesPerSecond < 2) {
    throw new LatencyFixtureError("burstUpdatesPerSecond must be an integer >= 2");
  }
  if (
    !Number.isInteger(profile.deriveMinMs) ||
    !Number.isInteger(profile.deriveMaxMs) ||
    profile.deriveMinMs < 0 ||
    profile.deriveMaxMs < profile.deriveMinMs
  ) {
    throw new LatencyFixtureError(
      `derive range must be integers with 0 <= min <= max (got [${String(profile.deriveMinMs)}, ${String(profile.deriveMaxMs)}])`,
    );
  }
  if (!Number.isInteger(profile.byteSize) || profile.byteSize <= 0) {
    throw new LatencyFixtureError("byteSize must be a positive integer");
  }
  if (!Number.isFinite(profile.firstObservationAtMs) || profile.firstObservationAtMs < 0) {
    throw new LatencyFixtureError("firstObservationAtMs must be a finite number >= 0");
  }
}

/**
 * Builds the live fixture: the real W006 story, its per-update derived
 * documents, and the seeded arrival schedule. PURE: the same profile builds
 * the byte-identical fixture every call (the PRNG is seeded from the
 * profile's own seed string).
 */
export function buildLiveFixture(profile: LiveFixtureProfile = LIVE_FIXTURE_PROFILE): LiveFixture {
  assertProfile(profile);
  const sessionId = `sess-${profile.profileId}`;
  const football: FootballState = {
    pitch: {
      lengthAxisMeters: PITCH_LENGTH_AXIS_METERS,
      widthAxisMeters: PITCH_WIDTH_AXIS_METERS,
      origin: PITCH_ORIGIN,
      axes: PITCH_AXES,
    },
    clock: { period: "first-half", clockMs: 0, stoppage: false },
    score: {
      home: 0,
      away: 0,
      status: { status: "uncertain", value: "provisional", confidence: 0.6 },
    },
    possession: { status: "uncertain", value: { entityId: "p1" }, confidence: 0.7 },
    eventTaxonomyVersion: "v1",
  };
  const engine = WorldModelEngine.create(sessionId, { now: () => 0, football });
  const rng = createRng(seedFromString(profile.seed));
  const deriveSpan = profile.deriveMaxMs - profile.deriveMinMs + 1;

  // The story's participant trajectory: a deterministic 40-second triangle
  // sweep across the pitch (30 m → 50 m → 30 m on x), in-bounds for the
  // whole 90-second story (the W304 story's monotone walk would leave the
  // drawable pitch long before second 90 — the renderer would honestly
  // omit the participant, and a latency fixture wants every render
  // well-formed).
  const participantX = (atMs: number): number => {
    const phase = (atMs / 1_000) % 40;
    return 30 + (phase < 20 ? phase : 40 - phase);
  };

  const steps: LiveSourceStep[] = [];
  let previousVisibleAtMs = profile.firstObservationAtMs - profile.normalGapMs;
  let lastEventWindowEndMs = 0;
  const appliedEvents = new Set<string>();

  for (let second = 1; second <= profile.seconds; second += 1) {
    for (const mark of marksForSecond(profile, second)) {
      const watermarkMs = mark.watermarkMs;
      // The per-tick story progress (the W304 construction, time-parameterized
      // to the tick's own watermark): a moving participant and a trailing
      // uncertain ball. Upserting AT the watermark keeps the engine's
      // at-watermark snapshot population complete (an entity upserted past
      // the query time is absent from the at-T state — the sub-second burst
      // ticks would otherwise observe an empty pitch).
      engine.upsertEntity({
        entityId: "p1",
        kind: "participant",
        version: 1,
        lastEventTimeMs: watermarkMs,
        state: {
          pitchPosition: { status: "known", value: { x: participantX(watermarkMs), y: 34 } },
        },
      });
      engine.upsertEntity({
        entityId: "b1",
        kind: "ball",
        version: 1,
        lastEventTimeMs: watermarkMs,
        state: {
          pitchPosition: {
            status: "uncertain",
            value: { x: participantX(watermarkMs) - 0.5, y: 34.2 },
            confidence: 0.9,
          },
        },
      });
      for (const authored of STORY_EVENTS) {
        if (!appliedEvents.has(authored.eventId) && authored.atMs <= watermarkMs) {
          appliedEvents.add(authored.eventId);
          engine.applyEvent({
            eventId: authored.eventId,
            sessionId,
            schemaVersion: SCHEMA_VERSION,
            eventTypeRef: authored.typeRef,
            interval: { startTimeMs: authored.atMs, endTimeMs: authored.atMs },
            eventTimeMs: authored.atMs,
            provenance: "DERIVED",
            ...(authored.confidence === undefined ? {} : { confidence: authored.confidence }),
            evidence: { observationIds: [authored.evidenceId] },
          });
        }
      }
      // The live-source schedule: observe (gap + seeded jitter after the
      // previous update became visible), then derive (seeded cost), then the
      // update is visible in the store.
      const gap = mark.burst ? profile.burstGapMs : profile.normalGapMs;
      const jitter = Math.floor(rng() * (profile.maxArrivalJitterMs + 1));
      const deriveMs = profile.deriveMinMs + Math.floor(rng() * deriveSpan);
      const observedAtMs = previousVisibleAtMs + gap + jitter;
      const visibleAtMs = observedAtMs + deriveMs;
      previousVisibleAtMs = visibleAtMs;
      const snapshot = stateAt(engine, watermarkMs).snapshot;
      const events = eventWindow(engine.eventsSince(0), {
        fromMs: lastEventWindowEndMs,
        toMs: watermarkMs,
      });
      lastEventWindowEndMs = watermarkMs;
      steps.push({
        sequence: steps.length,
        update: {
          sequence: steps.length,
          watermark: { ...snapshot.watermark },
          snapshot,
          events: [...events],
          byteSize: profile.byteSize,
        },
        observedAtMs,
        visibleAtMs,
        deriveMs,
      });
    }
  }

  // Structural invariants (fail loud — a broken fixture is never run):
  // strictly increasing visibility, strictly increasing watermarks, and
  // matching sequences.
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    if (step.sequence !== i) {
      throw new LatencyFixtureError(`step ${i} carries sequence ${String(step.sequence)}`);
    }
    if (step.visibleAtMs !== step.observedAtMs + step.deriveMs) {
      throw new LatencyFixtureError(`step ${i} schedule arithmetic is inconsistent`);
    }
    if (i > 0) {
      const previous = steps[i - 1]!;
      if (step.visibleAtMs <= previous.visibleAtMs) {
        throw new LatencyFixtureError(
          `step ${i} becomes visible at ${String(step.visibleAtMs)} not after the previous ` +
            `step's ${String(previous.visibleAtMs)} — visibility must strictly increase`,
        );
      }
      if (step.update.watermark.watermarkMs <= previous.update.watermark.watermarkMs) {
        throw new LatencyFixtureError(
          `step ${i} watermark ${String(step.update.watermark.watermarkMs)} does not strictly ` +
            "increase (the W502 clip-step invariant)",
        );
      }
      if (step.observedAtMs <= previous.visibleAtMs - previous.deriveMs) {
        throw new LatencyFixtureError(
          `step ${i} is observed before the previous step's observation — the source is sequential`,
        );
      }
    }
  }
  return { profile, sessionId, steps };
}
