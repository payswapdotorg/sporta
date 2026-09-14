/**
 * Deterministic W502 test fixtures (docs/testing/HARNESS.md — no Date.now,
 * no Math.random; all times are explicit milliseconds).
 *
 * The canonical fixture: a 6-step clip (t = 1000..6000) over one session
 * with 3 positioned participants (one moving, one uncertain-moving, one
 * static), a no-position participant, near/off-canvas out-of-play
 * participants, a non-renderable kind, a moving ball with confidence, a
 * football state (uncertain provisional score, possession of player-7),
 * and a 5-event caption stream (one uncaptionable).
 */
import { ANIME_OUTPUT_PROFILE, ANIME_RENDERER_ID, ANIME_RENDERER_VERSION } from "../src/index";
import type { AnimeClipStep } from "../src/index";
import { buildEventEnvelope, buildRenderRequest, buildWorldSnapshot } from "@sporta/testing";
import type { DeepPartial } from "@sporta/testing";
import type {
  RenderRequest,
  RightsCapabilities,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";

export const SESSION_ID = "sess-anime-clip";

/** Full-allow rights (the happy-path capability set). */
export const ALLOW_ALL: RightsCapabilities = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** Full-deny rights (fail-closed probes). */
export const DENY_ALL: RightsCapabilities = {
  canReferenceSourceFrames: false,
  canDeliverLive: false,
  canStoreDerivatives: false,
  canShare: false,
};

/** A deterministic, contract-valid render request targeting the plugin. */
export function buildAnimeRequest(overrides: DeepPartial<RenderRequest> = {}): RenderRequest {
  return buildRenderRequest({
    sessionId: SESSION_ID,
    rendererId: ANIME_RENDERER_ID,
    rendererVersion: ANIME_RENDERER_VERSION,
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: ANIME_OUTPUT_PROFILE,
    styleConfig: { styleId: "style-anime-test", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: ALLOW_ALL,
    sourceFrameRefs: [],
    ...overrides,
  });
}

/** The fixture snapshot at step `index` (0-based; atMs = (index+1)·1000). */
export function buildFixtureSnapshot(index: number): WorldSnapshot {
  const atMs = (index + 1) * 1_000;
  const player7X = 52.5 + 0.8 * index; // 52.5 → 56.5
  const player9Y = 20 + 0.6 * index; // 20 → 23
  const ballX = 50.5 + 0.5 * index; // 50.5 → 53
  return buildWorldSnapshot(
    {
      sessionId: SESSION_ID,
      watermark: { watermarkMs: atMs, sequence: 10 + index },
      generatedAtMs: 1_736_164_800_000,
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
          // Present in the snapshot WITHOUT a position slot: omitted with
          // accounting (the degradation deliverable).
          entityId: "player-11",
          kind: "participant",
          version: 1,
          lastEventTimeMs: atMs,
          state: { teamRole: { status: "known", value: "midfielder" } },
        },
        {
          // Out-of-play near: (-3, 34) projects to canvas x 30 (in margin).
          entityId: "player-out",
          kind: "participant",
          version: 1,
          lastEventTimeMs: atMs,
          state: { pitchPosition: { status: "known", value: { x: -3, y: 34 } } },
        },
        {
          // Out-of-play off-canvas: (120, 34) projects beyond the canvas.
          entityId: "player-far",
          kind: "participant",
          version: 1,
          lastEventTimeMs: atMs,
          state: { pitchPosition: { status: "known", value: { x: 120, y: 34 } } },
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
export function buildFixtureEvent(
  eventId: string,
  eventTimeMs: number,
  eventTypeRef: string,
  sequence: number,
): WorldEventStreamEntry {
  const event = buildEventEnvelope(
    { eventId, sessionId: SESSION_ID, eventTimeMs, eventTypeRef, confidence: 0.9 },
    4321 + sequence,
  );
  return { sequence, snapshotVersionAfter: sequence + 20, event };
}

/**
 * The fixture caption stream: kickoff@1000, pass@2500, shot@4000, an
 * uncaptionable taxonomy@4700, goal@5500. Sequences 11..15 (continuing the
 * snapshots' watermark sequence 10..15).
 */
export function fixtureEventStream() {
  return [
    buildFixtureEvent("fe-kickoff", 1_000, "football/v1/kickoff", 11),
    buildFixtureEvent("fe-pass", 2_500, "football/v1/pass", 12),
    buildFixtureEvent("fe-shot", 4_000, "football/v1/shot", 13),
    buildFixtureEvent("fe-weird", 4_700, "football/v9/variant-unknown", 14),
    buildFixtureEvent("fe-goal", 5_500, "football/v1/goal", 15),
  ];
}

/**
 * The canonical 6-step fixture clip: steps at t = 1000..6000, each step's
 * caption window = (previous atMs, this atMs] (step 0 covers [0, 1000]).
 */
export function buildFixtureClip(): AnimeClipStep[] {
  const events = fixtureEventStream();
  const steps: AnimeClipStep[] = [];
  for (let index = 0; index < 6; index += 1) {
    const atMs = (index + 1) * 1_000;
    const windowFrom = index === 0 ? 0 : index * 1_000;
    steps.push({
      atMs,
      snapshot: buildFixtureSnapshot(index),
      events: events.filter(
        (entry) => entry.event.eventTimeMs > windowFrom && entry.event.eventTimeMs <= atMs,
      ),
    });
  }
  return steps;
}
