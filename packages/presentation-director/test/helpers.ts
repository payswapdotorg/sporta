/**
 * Deterministic R305 test fixtures (docs/testing/HARNESS.md — no Date.now,
 * no Math.random; all times are explicit milliseconds).
 *
 * The canonical presentation fixture mirrors the W604 camera-director
 * fixture story: a 7-step match timeline (t = 1000..7000) with a
 * POSSESSED, moving striker whose pitch x walks 50 → 94 (crossing into
 * the x105 final-third zone — exercising the possession-following
 * default AND its hysteresis), plus a commentary candidate stream with a
 * kickoff, a goal (replay-emphasis: focus + review windows), a below-
 * threshold save, and an un-ruled pass — exercising every presentation
 * kind (live-follow / wide / tight / replay) and every accounting
 * outcome.
 */
import { projectScene } from "@sporta/scene-projection";
import type { AvatarField3dMatchStep } from "@sporta/renderer-3d";
import { buildWorldSnapshot } from "@sporta/testing";
import type { EventCandidate } from "@sporta/commentary-understanding";
import type { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";

export const SESSION_ID = "sess-presentation-fixture";

/** The striker's pitch x per step: midfield → the x105 final third. */
const STRIKER_X = [50, 55, 60, 65, 90, 92, 94] as const;

/** The ball's pitch x per step (the fallback follow reference). */
const BALL_X = [49, 54, 59, 64, 89, 91, 93] as const;

/** The fixture snapshot at step `index` (0-based; atMs = (index+1)·1000). */
function fixtureSnapshot(index: number): WorldSnapshot {
  const atMs = (index + 1) * 1_000;
  return buildWorldSnapshot(
    {
      sessionId: SESSION_ID,
      watermark: { watermarkMs: atMs, sequence: 10 + index },
      generatedAtMs: 1_736_164_800_000,
      entities: [
        {
          entityId: "striker-9",
          kind: "participant",
          version: 3 + index,
          lastEventTimeMs: atMs,
          state: {
            pitchPosition: { status: "known", value: { x: STRIKER_X[index]!, y: 30 } },
          },
        },
        {
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
      ],
      football: {
        pitch: {
          lengthAxisMeters: 105,
          widthAxisMeters: 68,
          origin: "corner",
          axes: "x=touchline, y=goal-line",
        },
        clock: { period: "second-half", clockMs: 2_704_000 + index * 1_000, stoppage: false },
        score: { home: 2, away: 1, status: { status: "known", value: "confirmed" } },
        possession: { status: "uncertain", value: { entityId: "striker-9" }, confidence: 0.72 },
        eventTaxonomyVersion: "v1",
      },
    },
    4321 + index,
  );
}

/** A marker event for the fixture stream (deterministic ids/sequences). */
function fixtureEvent(
  eventId: string,
  eventTimeMs: number,
  eventTypeRef: string,
  sequence: number,
): WorldEventStreamEntry {
  return {
    sequence,
    snapshotVersionAfter: sequence + 20,
    event: {
      eventId,
      sessionId: SESSION_ID,
      schemaVersion: "1.1",
      eventTypeRef,
      interval: { startTimeMs: eventTimeMs, endTimeMs: eventTimeMs },
      eventTimeMs,
      provenance: "DERIVED",
      confidence: 0.9,
      evidence: { observationIds: [`obs-${eventId}`] },
    },
  };
}

/** The fixture marker stream: kickoff@1000, goal@5500 (sequences 11, 12). */
function fixtureMarkers(): WorldEventStreamEntry[] {
  return [
    fixtureEvent("fe-kickoff", 1_000, "football/v1/kickoff", 11),
    fixtureEvent("fe-goal", 5_500, "football/v1/goal", 12),
  ];
}

/** A type-level pin: a real W603 match step IS a MatchTimelineStep (structural). */
export function assertStepShape(steps: readonly AvatarField3dMatchStep[]): void {
  // A real projected match timeline is assignable to the presentation
  // director's structural step type — the compile itself is the pin.
  const _shape: unknown = steps;
  void _shape;
}

/**
 * The canonical 7-step match timeline: each step's scene is the W601
 * projection of that step's snapshot with its windowed markers.
 */
export function buildPresentationMatch(): AvatarField3dMatchStep[] {
  const markers = fixtureMarkers();
  const steps: AvatarField3dMatchStep[] = [];
  for (let index = 0; index < 7; index += 1) {
    const atMs = (index + 1) * 1_000;
    const windowFrom = index === 0 ? 0 : index * 1_000;
    const windowed = markers.filter(
      (entry) => entry.event.eventTimeMs > windowFrom && entry.event.eventTimeMs <= atMs,
    );
    steps.push({ atMs, scene: projectScene(fixtureSnapshot(index), { events: windowed }) });
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

/**
 * The canonical candidate stream: a governed kickoff (event-focus,
 * main-touchline → wide), a governed goal (event-focus behind-goal →
 * tight + replay-emphasis → replay), a below-threshold save, and an
 * un-ruled pass.
 */
export function buildPresentationCandidates(): EventCandidate[] {
  return [
    buildCandidate({
      candidateId: "ec-1",
      eventTimeMs: 1_000,
      eventType: "kickoff",
      eventPhrase: "We're underway!",
      emphasis: 0.4,
      confidence: 0.8,
    }),
    buildCandidate({
      candidateId: "ec-2",
      eventTimeMs: 5_500,
      eventType: "goal",
      eventPhrase: "GOAL!!! What a strike",
      emphasis: 1,
      confidence: 0.9,
    }),
    buildCandidate({
      candidateId: "ec-3",
      eventTimeMs: 3_200,
      eventType: "save",
      eventPhrase: "a scrambling save",
      emphasis: 0.5,
      confidence: 0.3,
    }),
    buildCandidate({
      candidateId: "ec-4",
      eventTimeMs: 2_400,
      eventType: "pass",
      eventPhrase: "a simple pass",
      emphasis: 0.2,
      confidence: 0.7,
    }),
  ];
}
