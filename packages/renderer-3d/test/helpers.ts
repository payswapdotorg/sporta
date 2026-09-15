/**
 * Deterministic W602 test fixtures (docs/testing/HARNESS.md — no Date.now,
 * no Math.random; all times are explicit milliseconds).
 *
 * The canonical benchmark fixture: a 6-step clip (t = 1000..6000) over one
 * session with a moving striker (KNOWN position + a carried heading, whose
 * SWM version BUMPS every step — proving style stability is independent of
 * the entity version), an uncertain moving winger, a no-position
 * participant, an official, an out-of-bounds participant (drawn at its
 * TRUE position), an in-pitch participant that projects OFF-CANVAS from
 * the main-touchline slot (the honest camera-omission case), a
 * non-renderable kind, and a moving ball WITH a carried height (elevated
 * render with shadow + drop line) whose height slot is ABSENT on the last
 * step (the honest height-unknown case). Football state throughout
 * (possession of the striker). A 5-marker stream (one unknown-type ref).
 */
import {
  AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
  AVATAR_FIELD_OUTPUT_PROFILE,
  AVATAR_FIELD_RENDERER_ID,
  AVATAR_FIELD_RENDERER_VERSION,
} from "../src/index";
import type { AvatarField3dClipStep, AvatarField3dMatchStep } from "../src/index";
import { buildEventEnvelope, buildRenderRequest, buildWorldSnapshot } from "@sporta/testing";
import type { DeepPartial } from "@sporta/testing";
import { projectScene } from "@sporta/scene-projection";
import type {
  RenderRequest,
  RightsCapabilities,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";

export const SESSION_ID = "sess-3d-clip";

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
export function build3dRequest(overrides: DeepPartial<RenderRequest> = {}): RenderRequest {
  return buildRenderRequest({
    sessionId: SESSION_ID,
    rendererId: AVATAR_FIELD_RENDERER_ID,
    rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: AVATAR_FIELD_OUTPUT_PROFILE,
    styleConfig: { styleId: "style-3d-test", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: ALLOW_ALL,
    sourceFrameRefs: [],
    ...overrides,
  });
}

/** The fixture snapshot at step `index` (0-based; atMs = (index+1)·1000). */
export function buildFixtureSnapshot(index: number): WorldSnapshot {
  const atMs = (index + 1) * 1_000;
  const strikerX = 60 + 0.8 * index; // 60 → 64
  const wingerY = 20 + 0.5 * index; // 20 → 22.5
  const ballX = 58 + 0.6 * index; // 58 → 61
  // The ball's height: carried (known) on steps 0..4, ABSENT on step 5 —
  // the honest height-unknown case (never a faked z).
  const carriedHeight =
    index < 5 ? { height: { status: "known" as const, value: 1.2 + 0.2 * index } } : {};
  return buildWorldSnapshot(
    {
      sessionId: SESSION_ID,
      watermark: { watermarkMs: atMs, sequence: 10 + index },
      generatedAtMs: 1_736_164_800_000,
      entities: [
        {
          // The moving striker: KNOWN position + a carried heading; the SWM
          // version BUMPS every step (an upsert per frame) to prove that
          // identity-stable styling never depends on the entity version.
          entityId: "striker-9",
          kind: "participant",
          version: 3 + index,
          lastEventTimeMs: atMs,
          state: {
            pitchPosition: { status: "known", value: { x: strikerX, y: 30 } },
            heading: { status: "known", value: 0.6 },
          },
        },
        {
          // An uncertain moving winger (dashed halo styling).
          entityId: "winger-7",
          kind: "participant",
          version: 2,
          lastEventTimeMs: atMs,
          state: {
            pitchPosition: { status: "uncertain", value: { x: 40, y: wingerY }, confidence: 0.7 },
          },
        },
        {
          // Present in the snapshot WITHOUT a position slot: omitted with
          // accounting (the degradation deliverable).
          entityId: "bench-12",
          kind: "participant",
          version: 1,
          lastEventTimeMs: atMs,
          state: { teamRole: { status: "known", value: "midfielder" } },
        },
        {
          // An official on the pitch (the fixed official marker style).
          entityId: "official-1",
          kind: "official",
          version: 1,
          lastEventTimeMs: atMs,
          state: { pitchPosition: { status: "known", value: { x: 52.5, y: 42 } } },
        },
        {
          // Out of bounds: TRUE coordinates kept (drawn at the projected
          // TRUE position with the out-of-play marker posture).
          entityId: "outlier-8",
          kind: "participant",
          version: 1,
          lastEventTimeMs: atMs,
          state: { pitchPosition: { status: "known", value: { x: 112.5, y: 34 } } },
        },
        {
          // IN PITCH (corner, boundary-inclusive) but projecting off-canvas
          // from the main-touchline slot: the honest camera omission.
          entityId: "corner-player",
          kind: "participant",
          version: 1,
          lastEventTimeMs: atMs,
          state: { pitchPosition: { status: "known", value: { x: 0, y: 0 } } },
        },
        {
          // Non-renderable kind: accounted, never drawn.
          entityId: "team-home",
          kind: "team",
          version: 1,
          lastEventTimeMs: atMs,
          state: { teamName: { status: "known", value: "Team Home" } },
        },
        {
          // THE ball: moving, uncertain position, height carried (steps
          // 0..4) then absent (step 5).
          entityId: "ball-1",
          kind: "ball",
          version: 4,
          lastEventTimeMs: atMs,
          state: {
            pitchPosition: { status: "uncertain", value: { x: ballX, y: 30.5 }, confidence: 0.9 },
            ...carriedHeight,
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
 * The fixture marker stream: kickoff@1000, pass@2500, shot@4000, an
 * unknown-taxonomy@4700, goal@5500. Sequences 11..15 (continuing the
 * snapshots' watermark sequence 10..15).
 */
export function fixtureMarkerStream() {
  return [
    buildFixtureEvent("fe-kickoff", 1_000, "football/v1/kickoff", 11),
    buildFixtureEvent("fe-pass", 2_500, "football/v1/pass", 12),
    buildFixtureEvent("fe-shot", 4_000, "football/v1/shot", 13),
    buildFixtureEvent("fe-weird", 4_700, "football/v9/variant-unknown", 14),
    buildFixtureEvent("fe-goal", 5_500, "football/v1/goal", 15),
  ];
}

/**
 * The canonical 6-step benchmark clip: steps at t = 1000..6000, each step's
 * marker window = (previous atMs, this atMs] (step 0 covers [0, 1000]).
 * Each step's scene is the W601 projection of that step's snapshot with
 * its windowed markers (the renderer's clip path consumes scene specs).
 */
export function buildFixtureClip(): AvatarField3dClipStep[] {
  const markers = fixtureMarkerStream();
  const steps: AvatarField3dClipStep[] = [];
  for (let index = 0; index < 6; index += 1) {
    const atMs = (index + 1) * 1_000;
    const windowFrom = index === 0 ? 0 : index * 1_000;
    const windowed = markers.filter(
      (entry) => entry.event.eventTimeMs > windowFrom && entry.event.eventTimeMs <= atMs,
    );
    steps.push({
      atMs,
      scene: projectScene(buildFixtureSnapshot(index), { events: windowed }),
    });
  }
  return steps;
}

/**
 * A deterministic match-path request targeting the W603 ANIMATED profile
 * (1280×720 SVG at 5 fps — 200 ms frames; fractions land on 0.2 steps
 * between the fixture's 1 s snapshots, hand-verifiable).
 */
export function build3dMatchRequest(overrides: DeepPartial<RenderRequest> = {}): RenderRequest {
  return build3dRequest({
    outputProfile: AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
    ...overrides,
  });
}

/**
 * The canonical 6-step match timeline (W603): the fixture clip steps as
 * MATCH steps (no declared cuts — the clean interpolation fixture). At the
 * 5 fps profile this plans 26 frames: 5 per 1 s segment (1 observed + 4
 * interpolated) plus the last step's observed tail frame.
 */
export function buildFixtureMatch(): AvatarField3dMatchStep[] {
  const steps: AvatarField3dMatchStep[] = buildFixtureClip().map((step) => ({ ...step }));
  return steps;
}
