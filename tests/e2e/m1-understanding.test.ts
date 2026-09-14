/**
 * M1 understanding e2e — the G2 EXIT DEMO (harness template: W003's
 * `tests/e2e/m0-pipeline.test.ts`, see docs/testing/HARNESS.md).
 *
 * Gate G2 (docs/roadmap/roadmap.md): "Complete M1. An authorized football
 * clip can be ingested, decoded, time-aligned, tracked, and semantically
 * interpreted." The exit demo this file IS: "a fixture produces synchronized
 * player/ball observations plus commentary-derived event candidates."
 *
 * ONE deterministic walk through the delivered public package seams:
 *
 *   1. rights + session lifecycle: created -> authorized -> ingesting
 *      (`@sporta/session`, seeded `@sporta/testing` builders, fail-closed
 *      rights check at the ingestion boundary);
 *   2. VISION players: W204 fixture frames -> greedy-IoU tracks -> W203
 *      fixture-camera corner sets -> W206 spatial state (identity clock) ->
 *      player observations in canonical pitch METERS, DERIVED, on the
 *      session timeline;
 *   3. VISION ball: W202 scenario frames -> nearest-box tracks (occlusion
 *      bridged with discounted confidence) -> W205 ball state -> ball
 *      observations (position + velocity where defined) on the SAME session
 *      timeline as the players;
 *   4. COMMENTARY: a fixed transcript as W207-shaped windows -> W208
 *      sentence units -> W209 event candidates (goal / save / pass / ...,
 *      subjects from a known-entity lexicon) -> candidate observations;
 *   5. THE GATE EVIDENCE: every observation lands in ONE
 *      InMemoryObservationStore; ONE time window resolves BOTH the players'
 *      AND the ball's vision tracks; the commentary window resolves the
 *      generic candidates in the same store, same sessionId; and the WHOLE
 *      story is re-run with fresh objects — deep-equal (JSON) observations
 *      and equal store-query counts.
 *
 * HARNESS RULES (docs/testing/HARNESS.md — this file follows the template):
 *
 * - every random value comes from `@sporta/testing` seeded builders —
 *   no `Math.random`, no `Date.now`; every time is an explicit ms constant;
 * - only PUBLIC package APIs are exercised (each M1 seam's exported surface,
 *   imported by name through the root devDependencies);
 * - the slice is ONE linear story — `runM1Story()` chains each section's
 *   output into the next the way the real pipeline would. The story function
 *   runs TWICE (fresh objects on every call); the second run exists purely
 *   as the Section-5 determinism proof.
 */
import { describe, expect, test } from "bun:test";
import type {
  AuthorizationPolicy,
  MediaSession,
  Observation,
  TrackPayload,
} from "@sporta/contracts";
import { Observation as ObservationSchema } from "@sporta/contracts";
import type { TranscriptionUnit } from "@sporta/asr";
import {
  BALL_DETECTION_CONFIDENCE,
  NearestBoxBallTracker,
  generateScenarioFrames,
} from "@sporta/ball-tracking";
import type { BallScenarioSpec } from "@sporta/ball-tracking";
import { emitBallStateObservations, estimateBallState } from "@sporta/ball-state";
import type { BallStateSeries } from "@sporta/ball-state";
import { segmentCommentary } from "@sporta/commentary-segmentation";
import type { CommentaryUnit } from "@sporta/commentary-segmentation";
import {
  emitEventCandidateObservations,
  extractEventCandidates,
} from "@sporta/commentary-understanding";
import type { EventCandidate, KnownEntityLexicon } from "@sporta/commentary-understanding";
import { FixtureFieldCalibrator } from "@sporta/field-mapping";
import type { FixtureCameraSpec } from "@sporta/field-mapping";
import {
  GreedyIouTracker,
  detectionsFromGroundTruth,
  generateFixtureFrames,
} from "@sporta/perception-tracking";
import type { FixtureTrackSpec } from "@sporta/perception-tracking";
import { emitSpatialObservations, estimateSpatialState } from "@sporta/spatial-state";
import type { SpatialFrame, SpatialStateSeries } from "@sporta/spatial-state";
import { identityClock } from "@sporta/timeline";
import { InMemoryObservationStore } from "@sporta/observation";
import { RightsDeniedError, SessionLifecycle } from "@sporta/session";
import {
  TEST_EPOCH_MS,
  buildAuthorizationPolicy,
  buildMediaSession,
  seedFromString,
} from "@sporta/testing";

// --- Fixed slice constants -------------------------------------------------

/** Named seed: every builder below draws from this one reproducible seed. */
const E2E_SEED = seedFromString("m1-e2e");
const SESSION_ID = "sess-m1-e2e";
const POLICY_ID = "policy-m1-e2e";
const SOURCE_ID = "src-m1-cam-1";

// --- Section 2 — vision: tracked + projected players (W204 -> W203 -> W206)

/** 40 frames at the documented fixture cadence (40 ms = 25 fps). */
const PLAYER_FRAME_COUNT = 40;
const PLAYER_FRAME_MS = 40;
/** Last player frame's session time (identity clock): (40 - 1) * 40 ms. */
const PLAYER_LAST_TIME_MS = (PLAYER_FRAME_COUNT - 1) * PLAYER_FRAME_MS;

/**
 * Three fixture players on linear motions in distinct, non-crossing lanes.
 * Spec order fixes first-frame detection order, hence the t1/t2/t3 ids the
 * greedy-IoU tracker assigns (and one fused point per player per frame).
 */
const PLAYER_SPECS: readonly FixtureTrackSpec[] = [
  {
    gtId: "m1-striker",
    label: "player",
    motion: { kind: "linear", from: { x: 0.25, y: 0.4 }, to: { x: 0.45, y: 0.45 } },
    size: { w: 0.2, h: 0.1 },
  },
  {
    gtId: "m1-winger",
    label: "player",
    motion: { kind: "linear", from: { x: 0.55, y: 0.55 }, to: { x: 0.65, y: 0.6 } },
    size: { w: 0.2, h: 0.1 },
  },
  {
    gtId: "m1-defender",
    label: "player",
    motion: { kind: "linear", from: { x: 0.35, y: 0.7 }, to: { x: 0.4, y: 0.62 } },
    size: { w: 0.2, h: 0.1 },
  },
];

/** Track ids the tracker assigns in spec order on frame 0. */
const PLAYER_TRACK_IDS: readonly string[] = ["t1", "t2", "t3"];
const PLAYER_OBSERVATION_COUNT = PLAYER_FRAME_COUNT * PLAYER_SPECS.length;

/**
 * The documented W203 fixture camera — pan 0.5, zoom 1, jitter 0 (the camera
 * model's own doc example): the visible window is 52.5 x 34 m centered on
 * the pitch (x0 = 26.25, y0 = 17), so the image -> pitch map is exactly
 *
 *   X = 26.25 + 52.5u        Y = 17 + 34v
 *
 * and every hand-derived expectation below uses this closed form.
 */
const CAMERA: FixtureCameraSpec = { pan: 0.5, zoom: 1, jitter: 0 };
const CALIBRATOR_ID = "m1-fixture-calibrator";
const TRACKER_ID = "m1-greedy-iou";
const SPATIAL_COMPONENT_ID = "m1-spatial-state";

/** Pixel volume offered to the fixture calibrator (it ignores content). */
const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 90;

/** Fused player confidence: min(track 0.9, corner set 0.9). */
const PLAYER_CONFIDENCE = 0.9;

// --- Section 3 — ball: tracked + state (W202 -> W205)

/**
 * 25 fps, 2 s: 50 frames (k = 0..49, presentationMs = 40k, 0..1960 ms) on a
 * linear flight (0.3, 0.45) -> (0.7, 0.5). The 400-600 ms occlusion (frames
 * 10..14) is BRIDGED by the tracker (gap 5 <= 12 frames) with exponentially
 * discounted confidence; detectionNoise 0 keeps every position exactly on
 * the documented flight formula so velocities are hand-derivable.
 */
const BALL_SCENARIO: BallScenarioSpec = {
  label: "m1-e2e-ball",
  fps: 25,
  durationMs: 2_000,
  flight: { kind: "linear", from: { x: 0.3, y: 0.45 }, to: { x: 0.7, y: 0.5 } },
  occlusions: [{ fromMs: 400, toMs: 600 }],
  detectionNoise: 0,
  dropRate: 0,
};
const BALL_FRAME_COUNT = 50; // ceil(2000 / 40)
const BALL_LAST_TIME_MS = 1_960;
/** Frames 10..14 (presentationMs 400..560) fall inside the occlusion window. */
const BALL_INTERPOLATED_FRAMES = [10, 11, 12, 13, 14] as const;
const BALL_COMPONENT_ID = "m1-ball-state";

// --- Section 4 — commentary: segmented + understood (W208 -> W209)

/** W207 transcription-window length (milliseconds). */
const COMMENTARY_WINDOW_MS = 5_000;

/**
 * The fixed match transcript (~10 sentences, one per 5 s STT window). It
 * contains a pass phrase ("a lovely pass"), a save phrase ("brilliant save"),
 * a goal phrase ("scores"), plus shot / corner / card / substitution /
 * fulltime calls, and named player/team mentions for the W209 lexicon.
 */
const COMMENTARY_TRANSCRIPT: string =
  "We're underway here at the stadium. " +
  "Salah picks it up on the right wing. " +
  "Salah plays a lovely pass to Mane. " +
  "Mane shoots from distance. " +
  "What a brilliant save by Alisson! " +
  "It's a corner to the home side. " +
  "Salah scores for Liverpool! " +
  "The referee books the striker for the challenge. " +
  "Firmino comes on for the tired midfielder. " +
  "And it's all over here at the stadium.";

/** The fixture-scoped entity vocabulary W209 matches subjects against. */
const COMMENTARY_LEXICON: KnownEntityLexicon = {
  players: ["Salah", "Mane", "Alisson", "Firmino"],
  teams: ["Liverpool"],
};
const COMMENTARY_COMPONENT_ID = "m1-commentary-understanding";

/** The expected candidate sequence, in the transcript's own order. */
const EXPECTED_CANDIDATE_TYPES = [
  "pass",
  "shot",
  "save",
  "corner",
  "goal",
  "card",
  "substitution",
  "fulltime",
] as const;

// --- Section 5 — the G2 exit-demo gate evidence

/**
 * The synchronized-coexistence window: frames 10..30 of the shared 40 ms
 * grid (400..1200 ms) — inside BOTH the player span (0..1560 ms) and the
 * ball span (0..1960 ms), occlusion bridging included.
 */
const VISION_WINDOW_FROM_MS = 400;
const VISION_WINDOW_TO_MS = 1_200;
/** Frame times in the window: (1200 - 400) / 40 + 1 = 21. */
const VISION_WINDOW_FRAME_COUNT =
  (VISION_WINDOW_TO_MS - VISION_WINDOW_FROM_MS) / PLAYER_FRAME_MS + 1;
const VISION_WINDOW_PLAYER_COUNT = VISION_WINDOW_FRAME_COUNT * PLAYER_SPECS.length;
const VISION_WINDOW_BALL_COUNT = VISION_WINDOW_FRAME_COUNT;

/** The commentary window (first..last candidate unit start, fixed constants). */
const COMMENTARY_WINDOW_FROM_MS = 10_000;
const COMMENTARY_WINDOW_TO_MS = 45_000;

/** 120 player + 50 ball + 8 candidate observations in the ONE store. */
const TOTAL_OBSERVATION_COUNT =
  PLAYER_OBSERVATION_COUNT + BALL_FRAME_COUNT + EXPECTED_CANDIDATE_TYPES.length;

// --- Helpers ----------------------------------------------------------------

/** Narrows an observation's payload to the track variant (fail-loud). */
function trackPayload(observation: Observation): TrackPayload {
  if (observation.payload.kind !== "track") {
    throw new Error(`observation ${observation.observationId} is not a track payload`);
  }
  return observation.payload;
}

/** Finds one observation by id (fail-loud, the m0 `observationAt` style). */
function byObservationId(observations: readonly Observation[], observationId: string): Observation {
  const observation = observations.find((candidate) => candidate.observationId === observationId);
  if (observation === undefined) {
    throw new Error(`observation ${observationId} missing from the emitted stream`);
  }
  return observation;
}

/**
 * Slices the fixed transcript into W207-shaped 5-second windows: one
 * sentence per window (the greedy `[^.!?]*[.!?]+` sentence slice), window i
 * spanning [i*5000, (i+1)*5000) on the session timeline — fixed constants
 * only, so W208's segmentation sees exactly the documented window grid.
 */
function transcriptWindows(): TranscriptionUnit[] {
  const sentences = COMMENTARY_TRANSCRIPT.match(/[^.!?]*[.!?]+/g);
  if (sentences === null || sentences.some((sentence) => sentence.trim() === "")) {
    throw new Error("commentary transcript must slice into non-empty sentences");
  }
  return sentences.map((sentence, index) => ({
    unitId: `tu-${index}`,
    startMs: index * COMMENTARY_WINDOW_MS,
    endMs: (index + 1) * COMMENTARY_WINDOW_MS,
    text: sentence.trim(),
    speakerLabel: "lead",
    channel: "main",
    asrConfidence: 0.95,
  }));
}

/** Everything the linear M1 story produces (consumed by the assertions). */
interface M1StoryArtifacts {
  readonly policy: AuthorizationPolicy;
  readonly created: MediaSession;
  readonly authorized: MediaSession;
  readonly ingesting: MediaSession;
  readonly playerSeries: SpatialStateSeries;
  readonly playerObservations: Observation[];
  readonly ballSeries: BallStateSeries;
  readonly ballObservations: Observation[];
  readonly commentaryUnits: CommentaryUnit[];
  readonly candidates: EventCandidate[];
  readonly candidateObservations: Observation[];
  readonly store: InMemoryObservationStore;
}

/**
 * The whole M1 story — fresh objects on every call. Sections 1-4 are
 * chained linearly (each stage consumes the previous stage's output, the way
 * the real pipeline would), then Section 5 appends everything into ONE
 * store. Pure pipeline code: no assertions, no RNG, no clock reads. Called
 * twice by the test; the second call exists ONLY for the determinism proof.
 */
function runM1Story(): M1StoryArtifacts {
  // -----------------------------------------------------------------------
  // Section 1 — rights + session lifecycle (fail-closed authorization).
  // -----------------------------------------------------------------------
  const policy = buildAuthorizationPolicy(
    { policyId: POLICY_ID, allowedOperations: ["analysis", "transformation", "storage"] },
    E2E_SEED,
  );
  const created = buildMediaSession(
    {
      sessionId: SESSION_ID,
      authorizationPolicyId: POLICY_ID,
      sources: [
        {
          sourceId: SOURCE_ID,
          kind: "file",
          container: "mp4",
          videoStreams: 1,
          audioStreams: 1,
          durationMs: 60_000,
          declaredRightsPolicyId: POLICY_ID,
        },
      ],
    },
    E2E_SEED,
  );
  const lifecycle = new SessionLifecycle({ now: () => new Date(TEST_EPOCH_MS) });
  const authorized = lifecycle.transition(created, "authorized", { policy });
  const ingesting = lifecycle.transition(authorized, "ingesting");

  // -----------------------------------------------------------------------
  // Section 2 — vision: tracked + projected players (W204 -> W203 -> W206).
  // -----------------------------------------------------------------------
  const fixtureFrames = generateFixtureFrames(PLAYER_SPECS, {
    frames: PLAYER_FRAME_COUNT,
    frameMs: PLAYER_FRAME_MS,
  });
  const calibrator = new FixtureFieldCalibrator(CAMERA, CALIBRATOR_ID);
  const tracker = new GreedyIouTracker({}, TRACKER_ID);
  const frameBytes = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT * 3);
  const spatialFrames: SpatialFrame[] = fixtureFrames.map((gtFrame) => ({
    frame: gtFrame.frame,
    cornerSet: calibrator.calibrate({
      frameId: gtFrame.frame.frameId,
      presentationMs: gtFrame.frame.presentationMs,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      bytes: frameBytes,
      decodeOrder: gtFrame.frame.decodeOrder,
    }),
    tracks: tracker.assign(gtFrame.frame, detectionsFromGroundTruth(gtFrame)),
  }));
  const playerSeries = estimateSpatialState(spatialFrames, {
    clock: identityClock("video"),
  });
  const playerObservations = emitSpatialObservations({
    sessionId: SESSION_ID,
    componentId: SPATIAL_COMPONENT_ID,
    series: playerSeries,
  });

  // -----------------------------------------------------------------------
  // Section 3 — ball: tracked + state (W202 -> W205).
  // -----------------------------------------------------------------------
  const scenario = generateScenarioFrames(BALL_SCENARIO);
  const ballTracks = new NearestBoxBallTracker({ trackerId: "m1-nearest-box" }).track(
    scenario.frames,
  );
  const ballSeries = estimateBallState(ballTracks, { fps: BALL_SCENARIO.fps });
  const ballObservations = emitBallStateObservations({
    sessionId: SESSION_ID,
    componentId: BALL_COMPONENT_ID,
    series: ballSeries,
  });

  // -----------------------------------------------------------------------
  // Section 4 — commentary: segmented + understood (W208 -> W209).
  // -----------------------------------------------------------------------
  const commentaryUnits = segmentCommentary(transcriptWindows());
  const candidates = extractEventCandidates({
    units: commentaryUnits,
    lexicon: COMMENTARY_LEXICON,
  });
  const candidateObservations = emitEventCandidateObservations({
    sessionId: SESSION_ID,
    componentId: COMMENTARY_COMPONENT_ID,
    candidates,
  });

  // -----------------------------------------------------------------------
  // Section 5 — ONE store for the whole synchronized evidence stream.
  // -----------------------------------------------------------------------
  const store = new InMemoryObservationStore();
  for (const observation of [
    ...playerObservations,
    ...ballObservations,
    ...candidateObservations,
  ]) {
    store.append(observation);
  }

  return {
    policy,
    created,
    authorized,
    ingesting,
    playerSeries,
    playerObservations,
    ballSeries,
    ballObservations,
    commentaryUnits,
    candidates,
    candidateObservations,
    store,
  };
}

describe("M1 understanding e2e: authorized clip -> tracked players + ball + commentary -> one synchronized store", () => {
  test("the G2 exit demo: synchronized player/ball observations + commentary-derived event candidates", () => {
    const run1 = runM1Story();

    // -----------------------------------------------------------------------
    // Section 1 — rights + session lifecycle (fail-closed authorization).
    // -----------------------------------------------------------------------

    // An explicit, currently-valid policy: analysis authorizes the session;
    // transformation/storage are the operations later stages rely on.
    expect(run1.policy.policyId).toBe(POLICY_ID);
    expect(run1.policy.allowedOperations).toEqual(["analysis", "transformation", "storage"]);

    // Fail-closed first: with no policy presented, authorization DENIES and
    // the session is not advanced (architecture-lock §11). The lifecycle is
    // non-mutating (`structuredClone`), so the `created` document is intact.
    const NOW = new Date(TEST_EPOCH_MS);
    expect(() =>
      new SessionLifecycle({ now: () => NOW }).transition(run1.created, "authorized"),
    ).toThrow(RightsDeniedError);
    expect(run1.created.status).toBe("created");

    // Rights ok: the declared policy authorizes `analysis`; ingestion begins.
    expect(run1.authorized.status).toBe("authorized");
    expect(run1.authorized.processingState.stage).toBe("authorized");
    expect(run1.ingesting.status).toBe("ingesting");
    expect(run1.ingesting.processingState.stage).toBe("ingesting");
    expect(run1.ingesting.sessionId).toBe(SESSION_ID);

    // -----------------------------------------------------------------------
    // Section 2 — vision: tracked + projected players (W204 -> W203 -> W206).
    // -----------------------------------------------------------------------

    // Fusion shape: every visible ground-truth entry of the 3 players across
    // the 40 frames became exactly one fused point — none out of pitch bounds.
    expect(run1.playerSeries.frames).toBe(PLAYER_FRAME_COUNT);
    expect(run1.playerSeries.points).toHaveLength(PLAYER_OBSERVATION_COUNT);
    expect(run1.playerSeries.outOfBounds).toBe(0);

    const playerObservations = run1.playerObservations;
    expect(playerObservations).toHaveLength(PLAYER_OBSERVATION_COUNT);

    // Every player observation: zod-valid, session-scoped, vision/DERIVED
    // (a projected position is inference from OBSERVED corners + tracks),
    // min-fused confidence, PITCH-METER positions, participant entity refs.
    for (const observation of playerObservations) {
      expect(ObservationSchema.safeParse(observation).success).toBe(true);
      expect(observation.sessionId).toBe(SESSION_ID);
      expect(observation.modality).toBe("vision");
      expect(observation.provenance).toBe("DERIVED");
      expect(observation.confidence).toBe(PLAYER_CONFIDENCE);
      const payload = trackPayload(observation);
      // Canonical 105 x 68 pitch frame, in meters (W203 semantics).
      expect(payload.position.x).toBeGreaterThanOrEqual(0);
      expect(payload.position.x).toBeLessThanOrEqual(105);
      expect(payload.position.y).toBeGreaterThanOrEqual(0);
      expect(payload.position.y).toBeLessThanOrEqual(68);
      // Identity: one ref whose kind comes from W204's player label mapping.
      expect(observation.subjectEntityRefs).toEqual([
        { entityId: payload.entityId, kind: "participant" },
      ]);
    }

    // The tracker assigned the three persistent ids in spec order.
    expect([...new Set(playerObservations.map((o) => trackPayload(o).entityId))]).toEqual([
      ...PLAYER_TRACK_IDS,
    ]);

    // Time-aligned on the session timeline (identity clock). The series is
    // (sessionMs, trackId)-sorted, so frame times never regress; the
    // DEDUPLICATED times strictly increase and are exactly the 40 ms fixture
    // cadence 0, 40, ..., 1560; and every track's own times strictly increase
    // (three players share each frame's sessionMs by construction).
    const playerTimes = playerObservations.map((observation) => observation.eventTimeMs);
    for (let index = 1; index < playerTimes.length; index += 1) {
      expect(playerTimes[index]).toBeGreaterThanOrEqual(playerTimes[index - 1]!);
    }
    const distinctTimes: number[] = [];
    for (const time of playerTimes) {
      if (distinctTimes[distinctTimes.length - 1] !== time) distinctTimes.push(time);
    }
    expect(distinctTimes).toEqual(
      Array.from({ length: PLAYER_FRAME_COUNT }, (_, frame) => frame * PLAYER_FRAME_MS),
    );
    for (let index = 1; index < distinctTimes.length; index += 1) {
      expect(distinctTimes[index]).toBeGreaterThan(distinctTimes[index - 1]!);
    }
    const perTrackTimes = new Map<string, number[]>();
    for (const observation of playerObservations) {
      const trackId = trackPayload(observation).entityId;
      const times = perTrackTimes.get(trackId);
      if (times === undefined) perTrackTimes.set(trackId, [observation.eventTimeMs]);
      else times.push(observation.eventTimeMs);
    }
    for (const times of perTrackTimes.values()) {
      expect(times).toEqual(distinctTimes); // every track covers every frame
      for (let index = 1; index < times.length; index += 1) {
        expect(times[index]).toBeGreaterThan(times[index - 1]!);
      }
    }

    // One hand-derived projection pins the geometry to the documented W203
    // camera model: X = 26.25 + 52.5u, Y = 17 + 34v, and t1's frame-0 box
    // center is (0.25, 0.40) -> (39.375, 30.6) meters.
    const strikerAtOrigin = byObservationId(playerObservations, "sp-f-0-0-t1");
    expect(trackPayload(strikerAtOrigin).position.x).toBeCloseTo(39.375, 9);
    expect(trackPayload(strikerAtOrigin).position.y).toBeCloseTo(30.6, 9);

    // -----------------------------------------------------------------------
    // Section 3 — ball: tracked + state (W202 -> W205).
    // -----------------------------------------------------------------------

    // One continuous ball track: the occlusion is bridged, not split.
    expect(run1.ballSeries.entityId).toBe("ball");
    expect(run1.ballSeries.points).toHaveLength(BALL_FRAME_COUNT);
    expect(run1.ballSeries.gaps).toEqual([{ fromMs: 400, toMs: 560, bridged: true }]);

    const ballObservations = run1.ballObservations;
    expect(ballObservations).toHaveLength(BALL_FRAME_COUNT);

    let observedCount = 0;
    let derivedCount = 0;
    let velocityCount = 0;
    for (const observation of ballObservations) {
      expect(ObservationSchema.safeParse(observation).success).toBe(true);
      expect(observation.sessionId).toBe(SESSION_ID);
      expect(observation.modality).toBe("vision");
      // Identity: exactly the canonical session ball entity ref.
      expect(observation.subjectEntityRefs).toEqual([{ entityId: "ball", kind: "ball" }]);
      const payload = trackPayload(observation);
      expect(payload.entityId).toBe("ball");
      if (payload.velocity !== undefined) {
        velocityCount += 1;
        expect(Number.isFinite(payload.velocity.vx)).toBe(true);
        expect(Number.isFinite(payload.velocity.vy)).toBe(true);
      }
      if (observation.provenance === "OBSERVED") observedCount += 1;
      else derivedCount += 1;
    }
    // 45 detected frames OBSERVED; the 5 occlusion-bridged frames honestly
    // DERIVED (interpolation is inference, never sensor evidence).
    expect(observedCount).toBe(BALL_FRAME_COUNT - BALL_INTERPOLATED_FRAMES.length);
    expect(derivedCount).toBe(BALL_INTERPOLATED_FRAMES.length);

    // The SAME session timeline as Section 2: strictly increasing event
    // times on the shared 40 ms grid, 0..1960 — overlapping the player span
    // 0..1560 (frames 0..39 coexist on one timeline with the players').
    for (let index = 1; index < ballObservations.length; index += 1) {
      expect(ballObservations[index]!.eventTimeMs).toBeGreaterThan(
        ballObservations[index - 1]!.eventTimeMs,
      );
    }
    expect(ballObservations[0]!.eventTimeMs).toBe(0);
    expect(ballObservations[BALL_FRAME_COUNT - 1]!.eventTimeMs).toBe(BALL_LAST_TIME_MS);
    for (const observation of ballObservations) {
      expect(observation.eventTimeMs % PLAYER_FRAME_MS).toBe(0);
    }
    const ballTimesInPlayerSpan = ballObservations.filter(
      (observation) => observation.eventTimeMs <= PLAYER_LAST_TIME_MS,
    );
    expect(ballTimesInPlayerSpan).toHaveLength(PLAYER_FRAME_COUNT);

    // Velocity where defined: the series ends omit it entirely (never
    // zero-filled); interior frames carry the centered difference of the
    // documented linear flight — hand-derived: per frame the center advances
    // (0.8/49, 0.1/49) image units over 80 ms, so vx = (0.8/49)/0.08 and
    // vy = (0.1/49)/0.08 image-units per second.
    expect(velocityCount).toBe(BALL_FRAME_COUNT - 2);
    expect(trackPayload(ballObservations[0]!).velocity).toBeUndefined();
    expect(trackPayload(ballObservations[BALL_FRAME_COUNT - 1]!).velocity).toBeUndefined();
    const interior = byObservationId(ballObservations, "bs-f-0-5");
    const interiorVelocity = trackPayload(interior).velocity;
    if (interiorVelocity === undefined) {
      throw new Error("expected a defined velocity on the interior ball point");
    }
    expect(interiorVelocity.vx).toBeCloseTo(0.8 / 49 / 0.08, 9);
    expect(interiorVelocity.vy).toBeCloseTo(0.1 / 49 / 0.08, 9);

    // Honest occlusion bridging: the deepest interpolated frame's confidence
    // is the anchor confidence halved twice (0.85 * 0.5^2 — the documented
    // W202 decay at gapElapsed 5, i.e. ceil(5/4) = 2 halvings).
    const deepest = byObservationId(ballObservations, "bs-f-0-14");
    expect(deepest.provenance).toBe("DERIVED");
    expect(deepest.confidence).toBe(BALL_DETECTION_CONFIDENCE * Math.pow(0.5, 2));

    // -----------------------------------------------------------------------
    // Section 4 — commentary: segmented + understood (W208 -> W209).
    // -----------------------------------------------------------------------

    // W208: one sentence-level unit per 5 s window, `startMs` a passthrough
    // of the fixed window grid on the session timeline, no text lost.
    const commentaryUnits = run1.commentaryUnits;
    expect(commentaryUnits).toHaveLength(10);
    commentaryUnits.forEach((unit, index) => {
      expect(unit.unitId).toBe(`cu-${index + 1}`);
      expect(unit.startMs).toBe(index * COMMENTARY_WINDOW_MS);
      expect(unit.endMs).toBe((index + 1) * COMMENTARY_WINDOW_MS);
      expect(unit.text).not.toBe("");
      // Every surviving character is traceable to the fixed transcript.
      expect(COMMENTARY_TRANSCRIPT.includes(unit.text)).toBe(true);
    });

    // W209: the deterministic candidate sequence — the three headline types
    // (pass, save, goal) plus five more, in the transcript's own order.
    const candidates = run1.candidates;
    const typeSequence = candidates.map((candidate) => candidate.eventType);
    expect(typeSequence).toEqual([...EXPECTED_CANDIDATE_TYPES]);
    expect(typeSequence.indexOf("pass")).toBeLessThan(typeSequence.indexOf("save"));
    expect(typeSequence.indexOf("save")).toBeLessThan(typeSequence.indexOf("goal"));

    // Candidate-level honesty: unit-grid times, verbatim event phrases,
    // confidence present and within [0, 1].
    for (const candidate of candidates) {
      expect(candidate.eventTimeMs % COMMENTARY_WINDOW_MS).toBe(0);
      expect(COMMENTARY_TRANSCRIPT.includes(candidate.eventPhrase)).toBe(true);
      expect(candidate.confidence).toBeGreaterThanOrEqual(0);
      expect(candidate.confidence).toBeLessThanOrEqual(1);
    }

    const candidateAt = (index: number): EventCandidate => {
      const candidate = candidates[index];
      if (candidate === undefined) throw new Error(`candidate ${index} missing`);
      return candidate;
    };

    // The pass: Salah (agent) -> Mane (patient), phrase verbatim.
    const passCandidate = candidateAt(0);
    expect(passCandidate.eventType).toBe("pass");
    expect(passCandidate.eventPhrase).toBe("pass");
    expect(passCandidate.subjects).toEqual([
      { name: "Salah", role: "agent", nameConfidence: 1 },
      { name: "Mane", role: "patient", nameConfidence: 1 },
    ]);

    // The save: Alisson is the patient of "save" (after the phrase; the
    // save type carries the patient slot).
    const saveCandidate = candidateAt(2);
    expect(saveCandidate.eventType).toBe("save");
    expect(saveCandidate.eventPhrase).toBe("save");
    expect(saveCandidate.subjects).toEqual([
      { name: "Alisson", role: "patient", nameConfidence: 1 },
    ]);

    // The goal: Salah the agent, Liverpool an unspecified team mention. Its
    // confidence is hand-derived from the documented W209 formula
    // 0.5 * 0.9 (pattern) + 0.3 * 1 (subjects) + 0.2 * (1 - 0.4/2) = 0.91 —
    // the sentence's emphasis is exactly the exclamation weight 0.4.
    const goalCandidate = candidateAt(4);
    expect(goalCandidate.eventType).toBe("goal");
    expect(goalCandidate.eventPhrase).toBe("scores");
    expect(goalCandidate.subjects).toEqual([
      { name: "Salah", role: "agent", nameConfidence: 1 },
      { name: "Liverpool", role: "unspecified", nameConfidence: 1 },
    ]);
    expect(goalCandidate.emphasis).toBe(0.4);
    expect(goalCandidate.confidence).toBeCloseTo(0.91, 10);

    // W209 emission: one contract observation per candidate — commentary
    // modality, DERIVED provenance, generic payload, NO entity claims
    // (mapping spoken names to entities is W401's fusion job).
    const candidateObservations = run1.candidateObservations;
    expect(candidateObservations).toHaveLength(candidates.length);
    candidates.forEach((candidate, index) => {
      const observation = candidateObservations[index]!;
      expect(observation.observationId).toBe(`ceu-${candidate.candidateId}`);
      expect(observation.eventTimeMs).toBe(candidate.eventTimeMs);
      expect(ObservationSchema.safeParse(observation).success).toBe(true);
      expect(observation.sessionId).toBe(SESSION_ID);
      expect(observation.modality).toBe("commentary");
      expect(observation.provenance).toBe("DERIVED");
      expect(observation.subjectEntityRefs).toEqual([]);
      // Confidence is ALWAYS present on candidate observations, within [0, 1].
      expect(observation.confidence).toBe(candidate.confidence);
      expect(observation.confidence).toBeGreaterThanOrEqual(0);
      expect(observation.confidence).toBeLessThanOrEqual(1);
      expect(observation.payload.kind).toBe("generic");
    });
    // The generic payload's eventPhrase is a verbatim substring of the
    // transcript (the payload mirrors the candidate it was emitted from).
    for (const observation of candidateObservations) {
      if (observation.payload.kind !== "generic") {
        throw new Error(`observation ${observation.observationId} is not a generic payload`);
      }
      const data = observation.payload.data as { eventPhrase?: unknown };
      expect(typeof data.eventPhrase).toBe("string");
      expect(COMMENTARY_TRANSCRIPT.includes(data.eventPhrase as string)).toBe(true);
    }

    // -----------------------------------------------------------------------
    // Section 5 — the G2 exit-demo assertions (the gate evidence).
    // -----------------------------------------------------------------------

    const store = run1.store;

    // ONE store holds the whole synchronized evidence stream: 120 player
    // observations + 50 ball observations + 8 commentary candidates.
    expect(store.count()).toBe(TOTAL_OBSERVATION_COUNT);
    expect(store.query({ sessionId: SESSION_ID })).toHaveLength(TOTAL_OBSERVATION_COUNT);

    // Re-delivering any of the three streams is the idempotent duplicate
    // NO-OP (duplicate tolerance per the streaming contract).
    expect(store.append(byObservationId(playerObservations, "sp-f-0-0-t1"))).toBe("duplicate");
    expect(store.append(byObservationId(ballObservations, "bs-f-0-0"))).toBe("duplicate");
    expect(store.append(byObservationId(candidateObservations, "ceu-ec-1"))).toBe("duplicate");
    expect(store.count()).toBe(TOTAL_OBSERVATION_COUNT);

    // Synchronized coexistence: ONE time window (frames 10..30 of the shared
    // 40 ms grid) resolves BOTH the players' vision tracks AND the ball's
    // vision track — same store, same sessionId, same canonical timeline.
    const visionWindow = store.query({
      sessionId: SESSION_ID,
      fromMs: VISION_WINDOW_FROM_MS,
      toMs: VISION_WINDOW_TO_MS,
      modality: "vision",
      kind: "track",
    });
    expect(visionWindow).toHaveLength(VISION_WINDOW_PLAYER_COUNT + VISION_WINDOW_BALL_COUNT);
    const windowPlayers = visionWindow.filter((observation) =>
      PLAYER_TRACK_IDS.includes(trackPayload(observation).entityId),
    );
    const windowBall = visionWindow.filter(
      (observation) => trackPayload(observation).entityId === "ball",
    );
    expect(windowPlayers).toHaveLength(VISION_WINDOW_PLAYER_COUNT);
    expect(windowBall).toHaveLength(VISION_WINDOW_BALL_COUNT);
    for (const observation of visionWindow) {
      expect(observation.sessionId).toBe(SESSION_ID);
      expect(observation.eventTimeMs).toBeGreaterThanOrEqual(VISION_WINDOW_FROM_MS);
      expect(observation.eventTimeMs).toBeLessThanOrEqual(VISION_WINDOW_TO_MS);
    }
    // Players AND ball sit on ONE shared 40 ms grid inside the window.
    const windowTimes = [...new Set(visionWindow.map((observation) => observation.eventTimeMs))];
    expect(windowTimes).toEqual(
      Array.from(
        { length: VISION_WINDOW_FRAME_COUNT },
        (_, index) => VISION_WINDOW_FROM_MS + index * PLAYER_FRAME_MS,
      ),
    );
    // The window's ball observations include the occlusion-bridged frames
    // (400..560 ms): interpolated DERIVED points coexist with the players'
    // OBSERVED tracks on the very same window.
    const windowBallDerived = windowBall.filter(
      (observation) => observation.provenance === "DERIVED",
    );
    expect(windowBallDerived).toHaveLength(BALL_INTERPOLATED_FRAMES.length);

    // The commentary window resolves the generic candidates in the SAME
    // store, same sessionId — the semantic-interpretation half of the demo.
    const commentaryWindow = store.query({
      sessionId: SESSION_ID,
      fromMs: COMMENTARY_WINDOW_FROM_MS,
      toMs: COMMENTARY_WINDOW_TO_MS,
      modality: "commentary",
      kind: "generic",
    });
    expect(commentaryWindow.map((observation) => observation.observationId)).toEqual(
      EXPECTED_CANDIDATE_TYPES.map((_, index) => `ceu-ec-${index + 1}`),
    );
    for (const observation of commentaryWindow) {
      expect(observation.sessionId).toBe(SESSION_ID);
    }

    // Determinism: the WHOLE story re-run with fresh objects is deep-equal —
    // the observation arrays compared as JSON, and the store queries behind
    // the gate evidence return equal counts. No seed, clock, or RNG input
    // differs between the two runs; nothing else may.
    const run2 = runM1Story();
    expect(run2.playerObservations.map((observation) => JSON.stringify(observation))).toEqual(
      run1.playerObservations.map((observation) => JSON.stringify(observation)),
    );
    expect(run2.ballObservations.map((observation) => JSON.stringify(observation))).toEqual(
      run1.ballObservations.map((observation) => JSON.stringify(observation)),
    );
    expect(run2.candidateObservations.map((observation) => JSON.stringify(observation))).toEqual(
      run1.candidateObservations.map((observation) => JSON.stringify(observation)),
    );
    expect(run2.store.count()).toBe(store.count());
    expect(
      run2.store
        .query({
          sessionId: SESSION_ID,
          fromMs: VISION_WINDOW_FROM_MS,
          toMs: VISION_WINDOW_TO_MS,
          modality: "vision",
          kind: "track",
        })
        .filter((observation) => trackPayload(observation).entityId === "ball").length,
    ).toBe(VISION_WINDOW_BALL_COUNT);
    expect(
      run2.store.query({
        sessionId: SESSION_ID,
        fromMs: COMMENTARY_WINDOW_FROM_MS,
        toMs: COMMENTARY_WINDOW_TO_MS,
        modality: "commentary",
        kind: "generic",
      }),
    ).toHaveLength(commentaryWindow.length);
  });
});
