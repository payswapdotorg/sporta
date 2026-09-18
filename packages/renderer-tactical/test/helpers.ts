/**
 * Deterministic test fixtures for the tactical renderer (R301).
 *
 * SYNTHETIC-DIAGNOSTIC LABEL: every SWM document built here is SYNTHETIC,
 * built with the `@sporta/testing` deterministic builders. It is used for
 * renderer conformance and determinism evidence ONLY — it is NOT real-video
 * acceptance (real reconstructed-SWM acceptance arrives in R305-R307).
 *
 * The fixture story: one 12-entity football snapshot (10 outfield players in
 * a deterministic formation, a goalkeeper, and the ball) at a fixed
 * watermark, plus a 5-event tail (kickoff, pass, shot, goal, and a referee
 * decision correcting the goal) — the shape a real W006 engine replay would
 * produce, but fully synthetic and seed-pinned.
 */
import type {
  RenderRequest,
  RightsCapabilities,
  WorldEntity,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";

/** The synthetic fixture's label (surfaced in test names and docs). */
export const SYNTHETIC_FIXTURE_LABEL = "synthetic-diagnostic";

/** The synthetic fixture's fixed session id. */
export const TACTICAL_TEST_SESSION = "sess-tactical-synthetic";

/** The synthetic fixture's fixed seed (named, per HARNESS.md rule 4). */
export const TACTICAL_TEST_SEED = 30101;

/** Full-allow rights (the render path grants everything). */
export const FULL_ALLOW: RightsCapabilities = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/**
 * The synthetic-diagnostic snapshot: a fixed watermark, a 2-4-3-1-ish shape
 * of participants with uncertain positions (with confidences), a goalkeeper
 * with a known position and heading, the ball with a known height slot, and
 * the football extension state (clock deep in the second half, 2-1 score
 * confirmed, possession uncertain).
 */
export function buildSyntheticTacticalSnapshot(): WorldSnapshot {
  const formation: Array<[string, number, number, number]> = [
    ["striker-9", 71.5, 34, 0.83],
    ["winger-7", 60, 18.5, 0.77],
    ["winger-11", 62.5, 50, 0.74],
    ["mid-8", 52.5, 34, 0.88],
    ["mid-6", 44, 29.5, 0.81],
    ["mid-10", 47.5, 39, 0.79],
    ["back-2", 33, 20.5, 0.72],
    ["back-4", 30.5, 34, 0.76],
    ["back-5", 33, 47.5, 0.71],
    ["back-3", 42, 12.5, 0.69],
  ];
  const entities: WorldEntity[] = formation.map(([entityId, x, y, confidence]) => ({
    entityId,
    kind: "participant" as const,
    version: 2,
    lastEventTimeMs: 30_000,
    state: {
      pitchPosition: { status: "uncertain" as const, value: { x, y }, confidence },
      teamRole: { status: "known" as const, value: "outfield" },
    },
  }));
  entities.push({
    entityId: "keeper-1",
    kind: "participant",
    version: 1,
    lastEventTimeMs: 30_000,
    state: {
      pitchPosition: { status: "known" as const, value: { x: 5.25, y: 34 } },
      heading: { status: "known" as const, value: 0 },
      teamRole: { status: "known" as const, value: "goalkeeper" },
    },
  });
  return buildWorldSnapshot(
    {
      sessionId: TACTICAL_TEST_SESSION,
      watermark: { watermarkMs: 30_000, sequence: 20 },
      entities: [
        ...entities,
        {
          entityId: "ball-1",
          kind: "ball",
          version: 3,
          lastEventTimeMs: 30_000,
          state: {
            pitchPosition: {
              status: "uncertain" as const,
              value: { x: 63, y: 33 },
              confidence: 0.91,
            },
            height: { status: "known" as const, value: 0.8 },
          },
        },
        {
          // An out-of-bounds participant: TRUE coordinates kept, never clamped.
          entityId: "sub-14",
          kind: "participant",
          version: 1,
          lastEventTimeMs: 30_000,
          state: {
            pitchPosition: {
              status: "uncertain" as const,
              value: { x: 108, y: 71 },
              confidence: 0.42,
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
        clock: { period: "second-half", clockMs: 2_704_000, stoppage: false },
        score: { home: 2, away: 1, status: { status: "known", value: "confirmed" } },
        possession: { status: "uncertain", value: { entityId: "striker-9" }, confidence: 0.72 },
        eventTaxonomyVersion: "v1",
      },
    },
    TACTICAL_TEST_SEED,
  );
}

/**
 * The synthetic-diagnostic event tail: five ordered events continuing the
 * snapshot watermark (sequence 21-25), ending with a correction.
 */
export function buildSyntheticTacticalEvents(): WorldEventStreamEntry[] {
  const specs: Array<{
    id: string;
    type: string;
    time: number;
    correctionOf?: string;
    seed: number;
  }> = [
    { id: "fe-tac-1", type: "football/v1/kickoff", time: 30_500, seed: 30111 },
    { id: "fe-tac-2", type: "football/v1/pass", time: 31_200, seed: 30112 },
    { id: "fe-tac-3", type: "football/v1/shot", time: 31_900, seed: 30113 },
    { id: "fe-tac-4", type: "football/v1/goal", time: 32_400, seed: 30114 },
    {
      id: "fe-tac-5",
      type: "football/v1/referee-decision",
      time: 33_000,
      correctionOf: "fe-tac-4",
      seed: 30115,
    },
  ];
  return specs.map((spec, index) => ({
    sequence: 21 + index,
    snapshotVersionAfter: 21 + index,
    event: buildEventEnvelope(
      {
        eventId: spec.id,
        sessionId: TACTICAL_TEST_SESSION,
        eventTypeRef: spec.type,
        eventTimeMs: spec.time,
        interval: { startTimeMs: spec.time - 200, endTimeMs: spec.time },
        ...(spec.correctionOf !== undefined ? { correctionOf: spec.correctionOf } : {}),
      },
      spec.seed,
    ),
  }));
}

/** A valid tactical render request over the synthetic fixture. */
export function buildTacticalRenderRequest(overrides: Partial<RenderRequest> = {}): RenderRequest {
  return {
    sessionId: TACTICAL_TEST_SESSION,
    schemaVersion: "1.1",
    rendererId: "tactical.prototype",
    rendererVersion: "0.1.0",
    styleConfig: { styleId: "tactical-test", configSchemaVersion: "1.0", config: {} },
    snapshotVersion: 21,
    eventsSinceSequence: 20,
    outputProfile: {
      resolution: { w: 640, h: 360 },
      frameRate: 12.5,
      codec: "h264",
      container: "mp4",
      latencyClass: "offline",
    },
    rightsCapabilities: FULL_ALLOW,
    sourceFrameRefs: [],
    ...overrides,
  };
}
