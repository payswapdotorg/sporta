/**
 * Deterministic W504 test fixtures (docs/testing/HARNESS.md — no Date.now,
 * no Math.random; all times are explicit milliseconds).
 *
 * The canonical fixture: a 6-step W502 anime clip (t = 1000..6000) over one
 * session with moving/uncertain participants, a no-position participant, a
 * non-renderable kind, a moving ball with confidence, a football state
 * (uncertain provisional score, possession of player-7), and a 5-event
 * caption stream (one uncaptionable). Everything is built through the
 * `@sporta/testing` builders + the REAL `renderAnimeClip`, so the fixtures
 * stay schema-valid by construction.
 */
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  renderAnimeClip,
} from "@sporta/renderer-anime";
import type { AnimeClipStep, AnimeRenderOutput } from "@sporta/renderer-anime";
import {
  buildAuthorizationPolicy,
  buildEventEnvelope,
  buildRenderRequest,
  buildWorldSnapshot,
} from "@sporta/testing";
import type {
  AuthorizationPolicy,
  RenderRequest,
  RightsCapabilities,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";

/** The canonical fixture session id (the e2e reuses the HTTP session id). */
export const SESSION_ID = "sess-w504";

/** The host-assigned render id the e2e anchors the stored segment under. */
export const RENDER_ID = "r-clip-1";

/** Full-allow rights (the happy-path capability set). */
export const ALLOW_ALL: RightsCapabilities = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** Far-future expiry used by policies that must never expire in a test. */
const FAR_FUTURE_ISO = "2099-12-31T23:59:59.000Z";

/** A full-allow authorization policy (derives every capability). */
export const fullAllowPolicy: AuthorizationPolicy = {
  policyId: "policy-w504-full-allow",
  allowedOperations: [
    "analysis",
    "transformation",
    "liveDelivery",
    "derivativeGeneration",
    "storage",
    "sharing",
  ],
  assertedBy: "sporta-test-operator",
  expiresAtIso: FAR_FUTURE_ISO,
};

/** Analysis + transformation: renders, but canStoreDerivatives is false. */
export const analysisTransformationPolicy: AuthorizationPolicy = {
  policyId: "policy-w504-analysis-transformation",
  allowedOperations: ["analysis", "transformation"],
  assertedBy: "sporta-test-operator",
  expiresAtIso: FAR_FUTURE_ISO,
};

/** A full-allow policy that expired before the test epoch. */
export const expiredPolicy: AuthorizationPolicy = {
  ...fullAllowPolicy,
  policyId: "policy-w504-expired",
  expiresAtIso: "2025-01-01T00:00:00.000Z",
};

/** A deterministic, contract-valid render request targeting the anime plugin. */
export function buildClipRequest(sessionId: string = SESSION_ID): RenderRequest {
  return buildRenderRequest({
    sessionId,
    rendererId: ANIME_RENDERER_ID,
    rendererVersion: ANIME_RENDERER_VERSION,
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: ANIME_OUTPUT_PROFILE,
    styleConfig: { styleId: "style-anime-test", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: ALLOW_ALL,
    sourceFrameRefs: [],
  });
}

/** The fixture snapshot at step `index` (0-based; atMs = (index+1)·1000). */
function buildStepSnapshot(sessionId: string, index: number): WorldSnapshot {
  const atMs = (index + 1) * 1_000;
  const player7X = 52.5 + 0.8 * index; // 52.5 → 56.5
  const player9Y = 20 + 0.6 * index; // 20 → 23
  const ballX = 50.5 + 0.5 * index; // 50.5 → 53
  return buildWorldSnapshot(
    {
      sessionId,
      watermark: { watermarkMs: atMs, sequence: 10 + index },
      entities: [
        {
          entityId: "player-7",
          kind: "participant",
          version: 2,
          lastEventTimeMs: atMs,
          state: { pitchPosition: { status: "known", value: { x: player7X, y: 34 } } },
        },
        {
          entityId: "player-9",
          kind: "participant",
          version: 3,
          lastEventTimeMs: atMs,
          state: {
            pitchPosition: { status: "uncertain", value: { x: 30, y: player9Y }, confidence: 0.7 },
          },
        },
        {
          // Present without a position slot: omitted with accounting.
          entityId: "player-11",
          kind: "participant",
          version: 1,
          lastEventTimeMs: atMs,
          state: { teamRole: { status: "known", value: "midfielder" } },
        },
        {
          // Non-renderable kind: accounted, never drawn.
          entityId: "team-1",
          kind: "team",
          version: 1,
          lastEventTimeMs: atMs,
          state: { teamName: { status: "known", value: "Team 1" } },
        },
        {
          entityId: "ball-1",
          kind: "ball",
          version: 4,
          lastEventTimeMs: atMs,
          state: {
            pitchPosition: { status: "uncertain", value: { x: ballX, y: 34.5 }, confidence: 0.9 },
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
        clock: { period: "first-half", clockMs: 60_000 + index * 1_000, stoppage: false },
        score: {
          home: 1,
          away: 0,
          status: { status: "uncertain", value: "provisional", confidence: 0.8 },
        },
        possession: { status: "uncertain", value: { entityId: "player-7" }, confidence: 0.75 },
        eventTaxonomyVersion: "v1",
      },
    },
    1234 + index,
  );
}

/** A caption event for the fixture stream (deterministic ids/sequences). */
function buildStepEvent(
  sessionId: string,
  eventId: string,
  eventTimeMs: number,
  eventTypeRef: string,
  sequence: number,
): WorldEventStreamEntry {
  const event = buildEventEnvelope(
    { eventId, sessionId, eventTimeMs, eventTypeRef, confidence: 0.9 },
    4321 + sequence,
  );
  return { sequence, snapshotVersionAfter: sequence + 20, event };
}

/**
 * The fixture caption stream: kickoff@1000, pass@2500, shot@4000, an
 * uncaptionable taxonomy@4700, goal@5500. Sequences 11..15 (continuing the
 * snapshots' watermark sequences 10..15).
 */
function fixtureEventStream(sessionId: string): WorldEventStreamEntry[] {
  return [
    buildStepEvent(sessionId, "fe-kickoff", 1_000, "football/v1/kickoff", 11),
    buildStepEvent(sessionId, "fe-pass", 2_500, "football/v1/pass", 12),
    buildStepEvent(sessionId, "fe-shot", 4_000, "football/v1/shot", 13),
    buildStepEvent(sessionId, "fe-weird", 4_700, "football/v9/variant-unknown", 14),
    buildStepEvent(sessionId, "fe-goal", 5_500, "football/v1/goal", 15),
  ];
}

/**
 * The canonical 6-step fixture clip: steps at t = 1000..6000, each step's
 * caption window = (previous atMs, this atMs] (step 0 covers [0, 1000]).
 */
export function buildFixtureSteps(sessionId: string = SESSION_ID): AnimeClipStep[] {
  const events = fixtureEventStream(sessionId);
  const steps: AnimeClipStep[] = [];
  for (let index = 0; index < 6; index += 1) {
    const atMs = (index + 1) * 1_000;
    const windowFrom = index === 0 ? 0 : index * 1_000;
    steps.push({
      atMs,
      snapshot: buildStepSnapshot(sessionId, index),
      events: events.filter(
        (entry) => entry.event.eventTimeMs > windowFrom && entry.event.eventTimeMs <= atMs,
      ),
    });
  }
  return steps;
}

/** The canonical fixture render output (the W502 clip render). */
export function buildFixtureOutput(sessionId: string = SESSION_ID): AnimeRenderOutput {
  return renderAnimeClip(buildClipRequest(sessionId), buildFixtureSteps(sessionId));
}

/** A deterministic near-future policy (expires shortly after the test epoch). */
export function nearExpiryPolicy(expiresAtIso: string): AuthorizationPolicy {
  return buildAuthorizationPolicy({
    policyId: "policy-w504-near-expiry",
    allowedOperations: [
      "analysis",
      "transformation",
      "liveDelivery",
      "derivativeGeneration",
      "storage",
      "sharing",
    ],
    expiresAtIso,
  });
}
