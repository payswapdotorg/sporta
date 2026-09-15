/**
 * Deterministic W604 test fixtures (docs/testing/HARNESS.md — no Date.now,
 * no Math.random; all times are explicit milliseconds).
 *
 * The canonical direction fixture: a 7-step match timeline
 * (t = 1000..7000) over one session with a POSSESSED, moving striker
 * (possession candidate on `striker-9`, whose pitch x walks 50 → 94,
 * crossing from the midfield zone into the x105 final-third zone at step
 * 4 — exercising the possession-following default AND its hysteresis),
 * a moving ball, an official, and a no-position participant. Football
 * state throughout. A 2-marker stream (kickoff@1000, goal@5500) rides
 * the scene specs exactly like the renderer-3d W603 fixture (marker
 * windows (prev atMs, this atMs]).
 */
import { projectScene } from "@sporta/scene-projection";
import { AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE } from "@sporta/renderer-3d";
import type { AvatarField3dMatchStep } from "@sporta/renderer-3d";
import { buildEventEnvelope, buildRenderRequest, buildWorldSnapshot } from "@sporta/testing";
import type { DeepPartial } from "@sporta/testing";
import type { EventCandidate } from "@sporta/commentary-understanding";
import type {
  RenderRequest,
  RightsCapabilities,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";
import { AVATAR_FIELD_RENDERER_ID, AVATAR_FIELD_RENDERER_VERSION } from "@sporta/renderer-3d";

export const SESSION_ID = "sess-3d-director";

/** Full-allow rights (the happy-path capability set). */
export const ALLOW_ALL: RightsCapabilities = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** The striker's pitch x per step: midfield → the x105 final third. */
const STRIKER_X = [50, 55, 60, 65, 90, 92, 94] as const;

/** The ball's pitch x per step (the fallback follow reference). */
const BALL_X = [49, 54, 59, 64, 89, 91, 93] as const;

/** The fixture snapshot at step `index` (0-based; atMs = (index+1)·1000). */
export function buildDirectorSnapshot(index: number): WorldSnapshot {
  const atMs = (index + 1) * 1_000;
  return buildWorldSnapshot(
    {
      sessionId: SESSION_ID,
      watermark: { watermarkMs: atMs, sequence: 10 + index },
      generatedAtMs: 1_736_164_800_000,
      entities: [
        {
          // The possessed striker: its pitch x is the follow reference.
          entityId: "striker-9",
          kind: "participant",
          version: 3 + index,
          lastEventTimeMs: atMs,
          state: {
            pitchPosition: { status: "known", value: { x: STRIKER_X[index]!, y: 30 } },
          },
        },
        {
          // The moving ball (the fallback follow reference).
          entityId: "ball-1",
          kind: "ball",
          version: 4,
          lastEventTimeMs: atMs,
          state: {
            pitchPosition: {
              status: "uncertain",
              value: { x: BALL_X[index]!, y: 30.5 },
              confidence: 0.9,
            },
          },
        },
        {
          // An official on the pitch.
          entityId: "official-1",
          kind: "official",
          version: 1,
          lastEventTimeMs: atMs,
          state: { pitchPosition: { status: "known", value: { x: 52.5, y: 42 } } },
        },
        {
          // Present WITHOUT a position slot (accounted, never placed).
          entityId: "bench-12",
          kind: "participant",
          version: 1,
          lastEventTimeMs: atMs,
          state: { teamRole: { status: "known", value: "midfielder" } },
        },
      ],
      football: {
        pitch: {
          lengthAxisMeters: 105,
          widthAxisMeters: 68,
          origin: "corner",
          axes: "x=touchline, y=goal-line",
        },
        clock: { period: "second-half", clockMs: 2_704_000 + index * 1_000, stoppage: false },
        score: {
          home: 2,
          away: 1,
          status: { status: "known", value: "confirmed" },
        },
        possession: { status: "uncertain", value: { entityId: "striker-9" }, confidence: 0.72 },
        eventTaxonomyVersion: "v1",
      },
    },
    1234 + index,
  );
}

/** A marker event for the fixture stream (deterministic ids/sequences). */
function fixtureEvent(
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

/** The fixture marker stream: kickoff@1000, goal@5500 (sequences 11, 12). */
function fixtureMarkers(): WorldEventStreamEntry[] {
  return [
    fixtureEvent("fe-kickoff", 1_000, "football/v1/kickoff", 11),
    fixtureEvent("fe-goal", 5_500, "football/v1/goal", 12),
  ];
}

/**
 * The canonical 7-step match timeline: each step's scene is the W601
 * projection of that step's snapshot with its windowed markers.
 */
export function buildDirectorMatch(): AvatarField3dMatchStep[] {
  const markers = fixtureMarkers();
  const steps: AvatarField3dMatchStep[] = [];
  for (let index = 0; index < 7; index += 1) {
    const atMs = (index + 1) * 1_000;
    const windowFrom = index === 0 ? 0 : index * 1_000;
    const windowed = markers.filter(
      (entry) => entry.event.eventTimeMs > windowFrom && entry.event.eventTimeMs <= atMs,
    );
    steps.push({
      atMs,
      scene: projectScene(buildDirectorSnapshot(index), { events: windowed }),
    });
  }
  return steps;
}

/**
 * A match timeline with NO football state (the possession-fallback
 * fixture): same steps, snapshots without the football extension.
 */
export function buildNoFootballMatch(): AvatarField3dMatchStep[] {
  const steps: AvatarField3dMatchStep[] = [];
  for (let index = 0; index < 5; index += 1) {
    const atMs = (index + 1) * 1_000;
    const snapshot = buildWorldSnapshot(
      {
        sessionId: SESSION_ID,
        watermark: { watermarkMs: atMs, sequence: 10 + index },
        generatedAtMs: 1_736_164_800_000,
        football: undefined,
        entities: [
          buildDirectorSnapshot(index).entities[2]!, // the official
          buildDirectorSnapshot(index).entities[3]!, // the no-position participant
        ],
      },
      1234 + index,
    );
    steps.push({ atMs, scene: projectScene(snapshot, { events: [] }) });
  }
  return steps;
}

/** A W209-style event candidate (all fields explicit, verbatim values). */
export function buildCandidate(overrides: Partial<EventCandidate> = {}): EventCandidate {
  return {
    candidateId: "ec-1",
    unitId: "cu-1",
    eventTimeMs: 5_500,
    eventType: "goal",
    eventPhrase: "GOAL",
    subjects: [],
    emphasis: 0.6,
    confidence: 0.86,
    ...overrides,
  };
}

/** A deterministic, contract-valid match request at the 5 fps review profile. */
export function buildDirectorRequest(overrides: DeepPartial<RenderRequest> = {}): RenderRequest {
  return buildRenderRequest({
    sessionId: SESSION_ID,
    rendererId: AVATAR_FIELD_RENDERER_ID,
    rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
    styleConfig: { styleId: "style-3d-director", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: ALLOW_ALL,
    sourceFrameRefs: [],
    ...overrides,
  });
}
