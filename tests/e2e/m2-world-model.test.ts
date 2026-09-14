/**
 * M2 world-model e2e — the G3 EXIT DEMO (harness template: W003's
 * `tests/e2e/m0-pipeline.test.ts` and the G2 demo
 * `tests/e2e/m1-understanding.test.ts`; see docs/testing/HARNESS.md).
 *
 * Gate G3 (docs/roadmap/roadmap.md): "Complete M2. Sporta can reconstruct
 * and replay a coherent temporal match state." The exit demo this file IS:
 * "query state at selected timestamps and replay event sequence with
 * provenance/confidence."
 *
 * ONE deterministic story through the delivered public package seams:
 *
 *   1. RIGHTS + SESSION LIFECYCLE: created -> authorized -> ingesting
 *      (`@sporta/session`, fail-closed rights at the ingestion boundary).
 *   2. THE OBSERVATION STREAM (real M1 package seams, ONE session timeline,
 *      0..12000 ms): three players AND the ball ride the W204 fixture
 *      tracker -> W203 fixture camera -> W206 spatial-state chain, so the
 *      whole vision stream is PITCH-METER framed (W204's `FOOTBALL_LABEL_KINDS`
 *      maps the ball label to the ball entity kind; W401's `trackFrame` is
 *      caller-stated per stream, and one fusion pass takes one frame — the
 *      image-framed W202/W205 ball seam was already proven by the G2 demo).
 *      The match transcript goes W207 transcription units -> W208 sentence
 *      units -> W209 event candidates -> commentary observations, PLUS the
 *      raw W207 transcription observations (audio, OBSERVED) — one of them
 *      is the later video-review evidence the correction is derived from.
 *   3. STORE -> FUSION -> WORLD MODEL (the M2 core): the stream is fused in
 *      FIVE waves — one per match segment, the way a streaming pipeline
 *      would re-run `runWorldFusion` as observations arrive. Each wave's
 *      report is asserted exactly (upserts, events, dedup, clock patches,
 *      possession updates, snapshot version), and `stateAt` is queried at
 *      the wave boundary: entity VERSIONS, positions, watermarks and the
 *      football possession CONFIDENCE visibly evolve across the pins.
 *   4. A REAL CORRECTION: after the goal wave, the video-review
 *      transcription observation (t=9000) corrects the fused goal event
 *      through the PUBLIC W005/W006 correction seams —
 *      `EventDerivationService.deriveEvent` with `correctionOf` (evidence
 *      must resolve in the store; confidence is the honest min-of-evidence
 *      0.97) then `engine.applyEvent` declaring the affected entity. W401
 *      fusion itself derives no corrections (the documented W403 gap —
 *      supersession/orphan counters measured 0); the LINKAGE here is this
 *      demo's authored fusion policy, the same status the m0-pipeline
 *      demo's correction had. The correction is VISIBLE: the scorer's
 *      entity version bumps 49 -> 50, the log's 5th entry carries
 *      `correctionOf` + the corrected confidence 0.97, and the superseded
 *      goal (0.91) stays queryable — history is never rewritten.
 *   5. REPLAY WITH PROVENANCE: `eventWindow` over `engine.eventsSince(0)`
 *      (superseded events INCLUDED — the full evidence record, order
 *      preserved) then `replayForward`: the superseded goal is SKIPPED with
 *      counted supersession, the correction replays detached at its own
 *      position, checkpoints and the final snapshot are asserted and
 *      reconciled with the direct-query path (the documented intentional
 *      differences included). A second, NARROWER window excludes the goal:
 *      the correction is then ORPHANED — skipped and counted, never silent.
 *   6. IDEMPOTENT RE-FUSION (the W401 evidence): one more fusion pass over
 *      the unchanged store applies NOTHING (all counters 0 except the four
 *      event dedups) and leaves the snapshot version — and the full
 *      at-12000 state — untouched.
 *   7. DETERMINISM: the WHOLE story runs twice with fresh objects; every
 *      artifact (observations, wave reports, pins, log entries, both replay
 *      results, the correction envelope) is deep-equal as JSON.
 *
 * HARNESS RULES (docs/testing/HARNESS.md): every random value comes from
 * `@sporta/testing` seeded builders — no `Math.random`, no `Date.now`; every
 * time is an explicit ms constant; the engine clock is INJECTED
 * (`now: () => TEST_EPOCH_MS`) and the replay's clock is W402's forced
 * constant `REPLAY_GENERATED_AT_MS`. Only PUBLIC package APIs are exercised.
 *
 * IMPORT NOTE (documented deviation from HARNESS.md's letter):
 * `@sporta/fusion` and `@sporta/temporal` are not root `package.json`
 * devDependencies (the root lists the M0/M1 seam packages), and this brief
 * forbids root-file and bun.lock changes — so the two M2 packages are
 * imported by RELATIVE path to their public entry modules (the
 * `src/index.ts` files the `@sporta/fusion` and `@sporta/temporal` export
 * maps point at). The exercised surface is the packages' public API either
 * way; the permanent fix (adding both workspace deps to the root
 * devDependencies) is a one-line root change for the TL.
 */
import { describe, expect, test } from "bun:test";
import type {
  AuthorizationPolicy,
  EventEnvelope,
  MediaSession,
  Observation,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";
import {
  Observation as ObservationSchema,
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
  SCHEMA_VERSION,
  WorldSnapshot as WorldSnapshotSchema,
} from "@sporta/contracts";
import type { TrackPayload } from "@sporta/contracts";
import type { TranscriptionUnit } from "@sporta/asr";
import { emitTranscriptionObservations } from "@sporta/asr";
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
import { estimateSpatialState, emitSpatialObservations } from "@sporta/spatial-state";
import type { SpatialFrame } from "@sporta/spatial-state";
import { identityClock } from "@sporta/timeline";
import { EventDerivationService, InMemoryObservationStore } from "@sporta/observation";
import { RightsDeniedError, SessionLifecycle } from "@sporta/session";
import {
  WorldModelEngine,
  auditTrail,
  describeProvenance,
  unknownValue,
} from "@sporta/world-model";
import type { FootballState } from "@sporta/world-model";
import {
  TEST_EPOCH_MS,
  buildAuthorizationPolicy,
  buildMediaSession,
  seedFromString,
} from "@sporta/testing";
import { runWorldFusion } from "../../packages/fusion/src/index";
import type { FusionReport } from "../../packages/fusion/src/index";
import {
  REPLAY_GENERATED_AT_MS,
  eventWindow,
  replayForward,
  stateAt,
} from "../../packages/temporal/src/index";
import type { ReplayLimits, ReplayResult } from "../../packages/temporal/src/index";

// --- Fixed slice constants -------------------------------------------------

/** Named seed: every builder below draws from this one reproducible seed. */
const E2E_SEED = seedFromString("m2-e2e");
const SESSION_ID = "sess-m2-e2e";
const POLICY_ID = "policy-m2-e2e";
const SOURCE_ID = "src-m2-cam-1";

// --- Section 2 — the observation stream (real W2xx seams, one timeline) ----

/**
 * The W203 fixture camera — pan 0.5, zoom 1, jitter 0 (the camera model's
 * own doc example, the same one the G2 demo pinned): the visible window is
 * 52.5 x 34 m centered on the pitch, so image (u, v) -> pitch is exactly
 *
 *     X = 26.25 + 52.5 * u        Y = 17 + 34 * v
 *
 * and every hand-derived expectation below uses this closed form.
 */
const CAMERA: FixtureCameraSpec = { pan: 0.5, zoom: 1, jitter: 0 };
const CALIBRATOR_ID = "m2-fixture-calibrator";
const TRACKER_ID = "m2-greedy-iou";
const SPATIAL_COMPONENT_ID = "m2-spatial-state";
const ASR_COMPONENT_ID = "m2-fixture-backend";
const COMMENTARY_COMPONENT_ID = "m2-commentary-understanding";

/** 61 frames at 200 ms — one vision frame every 200 ms from 0 to 12000 ms. */
const FRAME_COUNT = 61;
const FRAME_MS = 200;
const LAST_FRAME_MS = (FRAME_COUNT - 1) * FRAME_MS; // 12000

/**
 * Four fixture objects on linear, non-crossing lanes. Spec order fixes the
 * first-frame detection order, hence the t1/t2/t3/t4 ids the greedy-IoU
 * tracker assigns. The striker (t1) is the goal scorer the later review
 * correction declares as affected; the winger (t2) tracks one ball-gap
 * ahead of the ball the whole clip (see POSSESSION below).
 *
 * The lane geometry (image centers, interpolated t = d / 60):
 *
 *     t1: (0.30 + 0.30t, 0.40 + 0.10t) -> pitch (42 + 15.75t, 30.6 + 3.4t)
 *     t2: (0.40 + 0.10t, 0.5 + (1.5 - 0.5t) / 34)
 *     t3: (0.32 + 0.02t, 0.60 + 0.04t) -> pitch (43.05 + 1.05t, 37.4 + 1.36t)
 *     t4 (ball): (0.40 + 0.10t, 0.5)   -> pitch (47.25 + 5.25t, 34)
 *
 * t2's v is pinned so the projected Y gap to the ball is EXACTLY
 * 34 * ((1.5 - 0.5t) / 34) = 1.5 - 0.5t meters: 1.5 m at frame 0 shrinking
 * to 1.0 m at frame 60, always inside the 2 m possession radius and always
 * strictly closer than t1/t3 (t1 ends 5.25 m from the ball, t3 ~9.7 m).
 */
const SPECS: readonly FixtureTrackSpec[] = [
  {
    gtId: "m2-striker",
    label: "player",
    motion: { kind: "linear", from: { x: 0.3, y: 0.4 }, to: { x: 0.6, y: 0.5 } },
    size: { w: 0.2, h: 0.1 },
  },
  {
    gtId: "m2-winger",
    label: "player",
    motion: {
      kind: "linear",
      from: { x: 0.4, y: 0.5 + 1.5 / 34 },
      to: { x: 0.5, y: 0.5 + 1 / 34 },
    },
    size: { w: 0.2, h: 0.1 },
  },
  {
    gtId: "m2-defender",
    label: "player",
    motion: { kind: "linear", from: { x: 0.32, y: 0.6 }, to: { x: 0.34, y: 0.64 } },
    size: { w: 0.2, h: 0.1 },
  },
  {
    gtId: "m2-ball",
    label: "ball",
    motion: { kind: "linear", from: { x: 0.4, y: 0.5 }, to: { x: 0.5, y: 0.5 } },
    size: { w: 0.04, h: 0.04 },
  },
];

/** Track ids the tracker assigns in spec order on frame 0. */
const TRACK_IDS: readonly string[] = ["t1", "t2", "t3", "t4"];
const ENTITY_KINDS: readonly string[] = ["participant", "participant", "participant", "ball"];
const VISION_OBSERVATION_COUNT = FRAME_COUNT * SPECS.length; // 244

/** Fused track confidence: min(fixture detection 0.9, fixture corners 0.9). */
const TRACK_CONFIDENCE = 0.9;

/** Pixel volume offered to the fixture calibrator (it ignores content). */
const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 90;

/**
 * The fixed match transcript — six sentences, each one W207 window, with
 * pinned window starts so every event time in the demo is a constant:
 * kickoff 500, pass 3000, shot 4600, goal 7000, the video-review sentence
 * 9000, fulltime 11000. The review sentence deliberately matches NO W209
 * lexicon pattern (no candidate is extracted from it — it stays raw STT
 * evidence), while every other sentence matches exactly one pattern.
 */
const COMMENTARY_WINDOWS: ReadonlyArray<{ startMs: number; endMs: number; text: string }> = [
  { startMs: 500, endMs: 1_000, text: "And we kick off here at the stadium." },
  { startMs: 3_000, endMs: 3_500, text: "Salah plays a lovely pass to Mane." },
  { startMs: 4_600, endMs: 5_100, text: "Mane shoots from distance." },
  { startMs: 7_000, endMs: 7_500, text: "Salah scores for Liverpool!" },
  {
    startMs: 9_000,
    endMs: 9_500,
    text: "The check is complete and the decision on the field is confirmed.",
  },
  { startMs: 11_000, endMs: 11_500, text: "And it's all over here at the stadium." },
];
/** The asrConfidence carried on every transcription unit — except the review. */
const ASR_CONFIDENCE = 0.95;
/** The review window's own, higher-confidence STT (the correction evidence). */
const REVIEW_ASR_CONFIDENCE = 0.97;
const REVIEW_UNIT_ID = "tu-4";
const REVIEW_OBSERVATION_ID = `stt-${REVIEW_UNIT_ID}`;

/** The fixture-scoped entity vocabulary W209 matches subjects against. */
const COMMENTARY_LEXICON: KnownEntityLexicon = {
  players: ["Salah", "Mane"],
  teams: ["Liverpool"],
};

/**
 * The expected candidate sequence with HAND-DERIVED confidences from the
 * documented W209 formula
 *
 *     0.5 * pattern + 0.3 * subjects(1 | 0.4) + 0.2 * (1 - emphasis / 2)
 *
 * kickoff 0.45 + 0.12 + 0.2 = 0.77; pass 0.35 + 0.3 + 0.2 = 0.85;
 * shot 0.35 + 0.3 + 0.2 = 0.85; goal (m1-proven, emphasis 0.4 from the
 * exclamation) 0.45 + 0.3 + 0.16 = 0.91; fulltime 0.35 + 0.12 + 0.2 = 0.67.
 */
const EXPECTED_CANDIDATES: ReadonlyArray<{
  type: string;
  phrase: string;
  confidence: number;
  timeMs: number;
}> = [
  { type: "kickoff", phrase: "kick off", confidence: 0.77, timeMs: 500 },
  { type: "pass", phrase: "pass", confidence: 0.85, timeMs: 3_000 },
  { type: "shot", phrase: "shoots", confidence: 0.85, timeMs: 4_600 },
  { type: "goal", phrase: "scores", confidence: 0.91, timeMs: 7_000 },
  { type: "fulltime", phrase: "all over", confidence: 0.67, timeMs: 11_000 },
];

// --- Section 3 — the fusion waves ------------------------------------------

/**
 * The five match segments. Wave i appends every observation whose
 * `eventTimeMs` falls in (previous boundary, boundary i] and re-runs
 * `runWorldFusion` — the streaming pattern the W401 dedup/no-op machinery
 * exists for. Wave 4 (through 9600) additionally carries the correction leg
 * (the review evidence arrives at 9000); wave 5 carries the fulltime clock
 * patch at 11000.
 */
const WAVE_BOUNDARIES_MS: readonly number[] = [2_400, 4_800, 7_200, 9_600, 12_000];

/** Vision frames per wave: 13, then 12 x 4. */
const WAVE_FRAME_COUNTS: readonly number[] = [13, 12, 12, 12, 12];
/** Per-wave entity upserts: frames x 4 entities. */
const WAVE_UPSERTS: readonly number[] = WAVE_FRAME_COUNTS.map((frames) => frames * SPECS.length);
/** Per-wave applied events: kickoff; pass + shot; goal; (review only); (fulltime patch). */
const WAVE_EVENTS: readonly number[] = [1, 2, 1, 0, 0];
/** Per-wave dedups: re-deriving the earlier candidates throws DuplicateEventError. */
const WAVE_DEDUPS: readonly number[] = [0, 1, 3, 4, 4];
/** Per-wave clock patches: only wave 5's fulltime candidate yields one. */
const WAVE_CLOCK_PATCHES: readonly number[] = [0, 0, 0, 0, 1];
/** Per-wave possession updates: the confidence moves every wave (gap shrinks). */
const WAVE_POSSESSIONS: readonly number[] = [1, 1, 1, 1, 1];
/**
 * Per-wave snapshot version (genesis 1; +1 per upsert, event, clock patch,
 * possession set; wave 4 then +1 for the correction's applyEvent — 205 is
 * BEFORE the correction, 206 after, carried into wave 5's baseline).
 */
const WAVE_VERSIONS: readonly number[] = [55, 106, 156, 205, 256];
/** Snapshot version right after the wave-4 correction applied. */
const VERSION_AFTER_CORRECTION = 206;

/** Entity versions at each pin: 13/25/37 wave upserts, 49 + the correction bump on t1. */
const WAVE_ENTITY_VERSIONS: readonly number[][] = [
  [13, 13, 13, 13],
  [25, 25, 25, 25],
  [37, 37, 37, 37],
  [50, 49, 49, 49],
  [62, 61, 61, 61],
];

/** Watermarks at each pin: entities' frame time vs the log's sequence high-water. */
const WAVE_WATERMARKS: ReadonlyArray<{ watermarkMs: number; sequence: number }> = [
  { watermarkMs: 2_400, sequence: 1 },
  { watermarkMs: 4_800, sequence: 3 },
  { watermarkMs: 7_200, sequence: 4 },
  { watermarkMs: 9_600, sequence: 5 },
  { watermarkMs: 12_000, sequence: 5 },
];

/**
 * HAND-DERIVED possession confidences: the ball track confidence 0.9 times
 * the winner t2's track confidence 0.9 times (1 - distance / 2) with the
 * distance 1.5 - 0.5t at the wave-end interpolation parameters
 * t = 0.2, 0.4, 0.6, 0.8, 1.0 -> distances 1.4, 1.3, 1.2, 1.1, 1.0 ->
 * 0.81 * (1 - d / 2) = 0.243, 0.2835, 0.324, 0.3645, 0.405.
 */
const WAVE_POSSESSION_CONFIDENCES: readonly number[] = [0.243, 0.2835, 0.324, 0.3645, 0.405];

/**
 * The winger's hand-derived pitch position at each pin (the ball sits
 * exactly `distance` meters below it on the same X).
 */
const WINGER_PIN_POSITIONS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 48.3, y: 35.4 },
  { x: 49.35, y: 35.3 },
  { x: 50.4, y: 35.2 },
  { x: 51.45, y: 35.1 },
  { x: 52.5, y: 35 },
];
/** The ball's hand-derived pitch position at each pin (Y constant 34). */
const BALL_PIN_POSITIONS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 48.3, y: 34 },
  { x: 49.35, y: 34 },
  { x: 50.4, y: 34 },
  { x: 51.45, y: 34 },
  { x: 52.5, y: 34 },
];

// --- Section 4 — the correction ---------------------------------------------

/** Fusion's deterministic event id for the goal candidate `ceu-ec-4`. */
const GOAL_EVENT_ID = "fe-ceu-ec-4";
const GOAL_TIME_MS = 7_000;
const GOAL_CONFIDENCE = 0.91;
/** The demo's video-review correction event id (W005 derivation input). */
const CORRECTION_EVENT_ID = "evt-review-1";
const CORRECTION_TIME_MS = 9_000;
/** The correction's honest confidence: min-of-evidence = the review STT 0.97. */
const CORRECTION_CONFIDENCE = 0.97;

// --- Section 5 — the replay -------------------------------------------------

const REPLAY_LIMITS: ReplayLimits = {
  maxEvents: 8,
  maxSpanMs: 12_000,
  checkpointEveryMs: 2_000,
};
/** The full-window replay: every event, kickoff 500 through the correction. */
const WINDOW_A: { fromMs: number; toMs: number } = { fromMs: 0, toMs: 12_000 };
/** The narrow window: starts AFTER the goal, so the correction is orphaned. */
const WINDOW_B: { fromMs: number; toMs: number } = { fromMs: 8_000, toMs: 12_000 };

// --- Totals -----------------------------------------------------------------

const AUDIO_OBSERVATION_COUNT = COMMENTARY_WINDOWS.length; // 6
const CANDIDATE_OBSERVATION_COUNT = EXPECTED_CANDIDATES.length; // 5
const TOTAL_OBSERVATION_COUNT =
  VISION_OBSERVATION_COUNT + AUDIO_OBSERVATION_COUNT + CANDIDATE_OBSERVATION_COUNT; // 255

/** The wave the correction rides in (the one ending at 9600). */
const CORRECTION_WAVE = 3;

// --- Helpers ----------------------------------------------------------------

/** Narrows an observation's payload to the track variant (fail-loud). */
function trackPayloadOf(observation: Observation): TrackPayload {
  if (observation.payload.kind !== "track") {
    throw new Error(`observation ${observation.observationId} is not a track payload`);
  }
  return observation.payload;
}

/** Finds one entity in a snapshot (fail-loud). */
function pinEntity(snapshot: WorldSnapshot, entityId: string) {
  const entity = snapshot.entities.find((candidate) => candidate.entityId === entityId);
  if (entity === undefined) {
    throw new Error(
      `entity ${entityId} missing from the snapshot at ${snapshot.watermark.watermarkMs}ms`,
    );
  }
  return entity;
}

/** Finds one observation by id (fail-loud, the m0 `observationAt` style). */
function byObservationId(observations: readonly Observation[], observationId: string): Observation {
  const observation = observations.find((candidate) => candidate.observationId === observationId);
  if (observation === undefined) {
    throw new Error(`observation ${observationId} missing from the emitted stream`);
  }
  return observation;
}

/** Builds the W207 transcription units for the fixed commentary windows. */
function transcriptUnits(): TranscriptionUnit[] {
  return COMMENTARY_WINDOWS.map((window, index) => ({
    unitId: `tu-${index}`,
    startMs: window.startMs,
    endMs: window.endMs,
    text: window.text,
    speakerLabel: "lead",
    channel: "main",
    asrConfidence: index === 4 ? REVIEW_ASR_CONFIDENCE : ASR_CONFIDENCE,
  }));
}

/** The canonical first-half football init (the W402/W403 fixture pattern). */
function makeFootballInit(): FootballState {
  return {
    pitch: {
      lengthAxisMeters: PITCH_LENGTH_AXIS_METERS,
      widthAxisMeters: PITCH_WIDTH_AXIS_METERS,
      origin: PITCH_ORIGIN,
      axes: PITCH_AXES,
    },
    clock: { period: "first-half", clockMs: 0, stoppage: false },
    score: { home: 0, away: 0, status: unknownValue() },
    possession: unknownValue(),
    eventTaxonomyVersion: "1",
  };
}

/** Everything the linear M2 story produces (consumed by the assertions). */
interface M2StoryArtifacts {
  readonly policy: AuthorizationPolicy;
  readonly created: MediaSession;
  readonly authorized: MediaSession;
  readonly ingesting: MediaSession;
  readonly units: CommentaryUnit[];
  readonly candidates: EventCandidate[];
  readonly visionObservations: Observation[];
  readonly audioObservations: Observation[];
  readonly candidateObservations: Observation[];
  readonly store: InMemoryObservationStore;
  readonly engine: WorldModelEngine;
  readonly waveReports: readonly FusionReport[];
  readonly pins: readonly WorldSnapshot[];
  readonly correction: EventEnvelope;
  readonly correctionEntry: WorldEventStreamEntry;
  readonly refusion: FusionReport;
  readonly entries: readonly WorldEventStreamEntry[];
  readonly windowA: readonly WorldEventStreamEntry[];
  readonly windowB: readonly WorldEventStreamEntry[];
  readonly replayA: ReplayResult;
  readonly replayB: ReplayResult;
}

/**
 * The whole M2 story — fresh objects on every call. Sections 1-2 build the
 * rights context and the observation stream with the REAL package seams;
 * Section 3 fuses the stream in five waves (querying `stateAt` at each wave
 * boundary); Section 4 drives the correction; Section 5 replays. Pure
 * pipeline code: no assertions, no RNG, no clock reads. Called twice by the
 * test; the second call exists ONLY for the determinism proof.
 */
function runM2Story(): M2StoryArtifacts {
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
  // Section 2 — the observation stream (real M1 seams, one timeline).
  // -----------------------------------------------------------------------

  // VISION: W204 fixture frames -> greedy-IoU tracks (players AND ball)
  // -> W203 fixture camera -> W206 pitch-meter spatial state.
  const fixtureFrames = generateFixtureFrames(SPECS, {
    frames: FRAME_COUNT,
    frameMs: FRAME_MS,
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
  const spatialSeries = estimateSpatialState(spatialFrames, {
    clock: identityClock("video"),
  });
  const visionObservations = emitSpatialObservations({
    sessionId: SESSION_ID,
    componentId: SPATIAL_COMPONENT_ID,
    series: spatialSeries,
  });

  // AUDIO: the raw W207 transcription observations (one per window).
  const units = transcriptUnits();
  const audioObservations = emitTranscriptionObservations({
    sessionId: SESSION_ID,
    componentId: ASR_COMPONENT_ID,
    units,
  });

  // COMMENTARY: W208 sentence units -> W209 event candidates -> observations.
  const commentaryUnits = segmentCommentary(units);
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
  // Section 3 — five fusion waves over ONE store into ONE engine.
  // -----------------------------------------------------------------------
  const store = new InMemoryObservationStore();
  const engine = WorldModelEngine.create(SESSION_ID, {
    football: makeFootballInit(),
    now: () => TEST_EPOCH_MS,
  });
  const derivation = new EventDerivationService(store);

  const allObservations = [...visionObservations, ...audioObservations, ...candidateObservations];
  const waveReports: FusionReport[] = [];
  const pins: WorldSnapshot[] = [];
  let correction: EventEnvelope | undefined;
  let correctionEntry: WorldEventStreamEntry | undefined;

  for (let wave = 0; wave < WAVE_BOUNDARIES_MS.length; wave += 1) {
    const throughMs = WAVE_BOUNDARIES_MS[wave]!;
    const afterMs = wave === 0 ? -1 : WAVE_BOUNDARIES_MS[wave - 1]!;
    for (const observation of allObservations) {
      if (observation.eventTimeMs > afterMs && observation.eventTimeMs <= throughMs) {
        store.append(observation);
      }
    }
    const report = runWorldFusion({ store, engine, sessionId: SESSION_ID });
    waveReports.push(report);

    // Section 4 — the correction rides the wave its evidence arrives in.
    if (wave === CORRECTION_WAVE) {
      // The video-review transcription (stt-tu-4) corrects the fused goal
      // event through the W005 derivation seam: the evidence must resolve
      // in the store, the confidence is the honest min-of-evidence (0.97),
      // and the linkage + affected entity are this demo's authored policy.
      correction = derivation.deriveEvent({
        sessionId: SESSION_ID,
        eventId: CORRECTION_EVENT_ID,
        eventTypeRef: "football/v1/goal",
        interval: { startTimeMs: GOAL_TIME_MS, endTimeMs: GOAL_TIME_MS },
        eventTimeMs: CORRECTION_TIME_MS,
        evidence: {
          observationIds: [REVIEW_OBSERVATION_ID],
          reportedBy: "commentary",
        },
        correctionOf: GOAL_EVENT_ID,
      });
      correctionEntry = engine.applyEvent(correction, { affectedEntityIds: ["t1"] });
    }

    // The gate's "query state at selected timestamps": one pin per wave
    // boundary, taken while the stream is only fused that far.
    pins.push(stateAt(engine, throughMs).snapshot);
  }

  // -----------------------------------------------------------------------
  // Section 6 — the idempotent re-fusion over the unchanged store.
  // -----------------------------------------------------------------------
  const refusion = runWorldFusion({ store, engine, sessionId: SESSION_ID });

  // -----------------------------------------------------------------------
  // Section 5 — the event stream, the windows, and the two replays.
  // -----------------------------------------------------------------------
  const entries = engine.eventsSince(0);
  const windowA = eventWindow(entries, WINDOW_A);
  const replayA = replayForward({
    entries: windowA,
    limits: REPLAY_LIMITS,
    init: { football: engine.snapshot().football },
  });
  const windowB = eventWindow(entries, WINDOW_B);
  const replayB = replayForward({ entries: windowB, limits: REPLAY_LIMITS });

  if (correction === undefined || correctionEntry === undefined) {
    throw new Error("the correction leg never ran — the wave structure is broken");
  }

  return {
    policy,
    created,
    authorized,
    ingesting,
    units: commentaryUnits,
    candidates,
    visionObservations,
    audioObservations,
    candidateObservations,
    store,
    engine,
    waveReports,
    pins,
    correction,
    correctionEntry,
    refusion,
    entries,
    windowA,
    windowB,
    replayA,
    replayB,
  };
}

/** Serializes every data artifact of one run (determinism comparison). */
function serializeRun(run: M2StoryArtifacts): string {
  return JSON.stringify({
    visionObservations: run.visionObservations,
    audioObservations: run.audioObservations,
    candidateObservations: run.candidateObservations,
    waveReports: run.waveReports,
    pins: run.pins,
    correction: run.correction,
    correctionEntry: run.correctionEntry,
    refusion: run.refusion,
    entries: run.entries,
    windowA: run.windowA,
    windowB: run.windowB,
    replayA: run.replayA,
    replayB: run.replayB,
  });
}

describe("M2 world-model e2e: observation stream -> world fusion -> at-T state -> correction-aware replay", () => {
  test("the G3 exit demo: reconstruct and replay a coherent temporal match state with provenance, confidence, and a real correction", () => {
    const run1 = runM2Story();

    // -----------------------------------------------------------------------
    // Section 1 — rights + session lifecycle (fail-closed authorization).
    // -----------------------------------------------------------------------

    expect(run1.policy.policyId).toBe(POLICY_ID);
    expect(run1.policy.allowedOperations).toEqual(["analysis", "transformation", "storage"]);

    // Fail-closed first: with no policy presented, authorization DENIES and
    // the session is not advanced (architecture-lock §11).
    const NOW = new Date(TEST_EPOCH_MS);
    expect(() =>
      new SessionLifecycle({ now: () => NOW }).transition(run1.created, "authorized"),
    ).toThrow(RightsDeniedError);
    expect(run1.created.status).toBe("created");

    // Rights ok: the declared policy authorizes `analysis`; ingestion begins.
    expect(run1.authorized.status).toBe("authorized");
    expect(run1.authorized.processingState.stage).toBe("authorized");
    expect(run1.ingesting.status).toBe("ingesting");
    expect(run1.ingesting.sessionId).toBe(SESSION_ID);

    // -----------------------------------------------------------------------
    // Section 2 — the observation stream (real W2xx seams, one timeline).
    // -----------------------------------------------------------------------

    // VISION: every frame of every spec became exactly one fused pitch-meter
    // point — none out of bounds.
    expect(run1.visionObservations).toHaveLength(VISION_OBSERVATION_COUNT);

    let participantCount = 0;
    let ballCount = 0;
    for (const observation of run1.visionObservations) {
      expect(ObservationSchema.safeParse(observation).success).toBe(true);
      expect(observation.sessionId).toBe(SESSION_ID);
      expect(observation.modality).toBe("vision");
      // A projected position is inference from OBSERVED corners + tracks —
      // W206 emits DERIVED, never OBSERVED (architecture-lock §4).
      expect(observation.provenance).toBe("DERIVED");
      // Min-fused confidence, VERBATIM on every record.
      expect(observation.confidence).toBe(TRACK_CONFIDENCE);
      const payload = trackPayloadOf(observation);
      // Canonical 105 x 68 pitch frame, in meters (W203 semantics).
      expect(payload.position.x).toBeGreaterThanOrEqual(0);
      expect(payload.position.x).toBeLessThanOrEqual(105);
      expect(payload.position.y).toBeGreaterThanOrEqual(0);
      expect(payload.position.y).toBeLessThanOrEqual(68);
      // One entity ref whose kind comes from W204's label mapping: three
      // participants and the BALL (the ball rides the same W204/W203/W206
      // chain so the whole stream is pitch-framed for W401 fusion).
      const expectedKind = ENTITY_KINDS[TRACK_IDS.indexOf(payload.entityId)];
      expect(observation.subjectEntityRefs).toEqual([
        { entityId: payload.entityId, kind: expectedKind },
      ]);
      if (payload.entityId === "t4") ballCount += 1;
      else participantCount += 1;
    }
    expect(participantCount).toBe(3 * FRAME_COUNT);
    expect(ballCount).toBe(FRAME_COUNT);
    expect([...new Set(run1.visionObservations.map((o) => trackPayloadOf(o).entityId))]).toEqual([
      ...TRACK_IDS,
    ]);

    // The shared 200 ms grid: 61 distinct times 0, 200, ..., 12000, and
    // every track covers every frame.
    const visionTimes = run1.visionObservations.map((o) => o.eventTimeMs);
    const distinctTimes: number[] = [];
    for (const time of visionTimes) {
      if (distinctTimes[distinctTimes.length - 1] !== time) distinctTimes.push(time);
    }
    expect(distinctTimes).toEqual(
      Array.from({ length: FRAME_COUNT }, (_, frame) => frame * FRAME_MS),
    );
    const perTrackTimes = new Map<string, number[]>();
    for (const observation of run1.visionObservations) {
      const trackId = trackPayloadOf(observation).entityId;
      const times = perTrackTimes.get(trackId);
      if (times === undefined) perTrackTimes.set(trackId, [observation.eventTimeMs]);
      else times.push(observation.eventTimeMs);
    }
    for (const times of perTrackTimes.values()) {
      expect(times).toEqual(distinctTimes);
    }

    // One hand-derived projection pins the geometry to the documented W203
    // camera model (X = 26.25 + 52.5u, Y = 17 + 34v): the striker's frame-0
    // box center (0.30, 0.40) -> (42, 30.6) meters, and its frame-60 center
    // (0.60, 0.50) -> (57.75, 34).
    const strikerOrigin = byObservationId(run1.visionObservations, "sp-f-0-0-t1");
    expect(trackPayloadOf(strikerOrigin).position.x).toBeCloseTo(42, 9);
    expect(trackPayloadOf(strikerOrigin).position.y).toBeCloseTo(30.6, 9);
    const strikerEnd = byObservationId(run1.visionObservations, `sp-f-0-${FRAME_COUNT - 1}-t1`);
    expect(trackPayloadOf(strikerEnd).position.x).toBeCloseTo(57.75, 9);
    expect(trackPayloadOf(strikerEnd).position.y).toBeCloseTo(34, 9);
    // The ball and the winger at frame 60: same X (52.5), exactly 1 meter
    // apart in Y (the possession-gap design, 0.5 + 1/34 image v).
    const ballEnd = byObservationId(run1.visionObservations, `sp-f-0-${FRAME_COUNT - 1}-t4`);
    expect(trackPayloadOf(ballEnd).position.x).toBeCloseTo(52.5, 9);
    expect(trackPayloadOf(ballEnd).position.y).toBeCloseTo(34, 9);
    const wingerEnd = byObservationId(run1.visionObservations, `sp-f-0-${FRAME_COUNT - 1}-t2`);
    expect(trackPayloadOf(wingerEnd).position.x).toBeCloseTo(52.5, 9);
    expect(trackPayloadOf(wingerEnd).position.y).toBeCloseTo(35, 9);

    // AUDIO: the raw STT stream — OBSERVED provenance (W207), the review
    // window carrying its own higher confidence.
    expect(run1.audioObservations).toHaveLength(AUDIO_OBSERVATION_COUNT);
    run1.audioObservations.forEach((observation, index) => {
      expect(ObservationSchema.safeParse(observation).success).toBe(true);
      expect(observation.observationId).toBe(`stt-tu-${index}`);
      expect(observation.sessionId).toBe(SESSION_ID);
      expect(observation.modality).toBe("audio");
      expect(observation.provenance).toBe("OBSERVED");
      expect(observation.confidence).toBe(index === 4 ? REVIEW_ASR_CONFIDENCE : ASR_CONFIDENCE);
      expect(observation.eventTimeMs).toBe(COMMENTARY_WINDOWS[index]!.startMs);
      expect(observation.subjectEntityRefs).toEqual([]);
    });

    // COMMENTARY: one sentence-level unit per window (startMs passthrough of
    // the pinned window grid), then the deterministic candidate sequence.
    expect(run1.units).toHaveLength(COMMENTARY_WINDOWS.length);
    run1.units.forEach((unit, index) => {
      expect(unit.unitId).toBe(`cu-${index + 1}`);
      expect(unit.startMs).toBe(COMMENTARY_WINDOWS[index]!.startMs);
      expect(unit.endMs).toBe(COMMENTARY_WINDOWS[index]!.endMs);
      expect(unit.text).toBe(COMMENTARY_WINDOWS[index]!.text);
    });

    const candidates = run1.candidates;
    expect(candidates.map((candidate) => candidate.eventType)).toEqual(
      EXPECTED_CANDIDATES.map((expected) => expected.type),
    );
    candidates.forEach((candidate, index) => {
      const expected = EXPECTED_CANDIDATES[index]!;
      expect(candidate.eventPhrase).toBe(expected.phrase);
      expect(candidate.eventTimeMs).toBe(expected.timeMs);
      // The hand-derived W209 formula value (see EXPECTED_CANDIDATES).
      expect(candidate.confidence).toBeCloseTo(expected.confidence, 10);
    });

    // The goal candidate: Salah the agent, Liverpool an unspecified team
    // mention, emphasis exactly the exclamation weight 0.4 (m1-proven).
    const goalCandidate = candidates[3]!;
    expect(goalCandidate.subjects).toEqual([
      { name: "Salah", role: "agent", nameConfidence: 1 },
      { name: "Liverpool", role: "unspecified", nameConfidence: 1 },
    ]);
    expect(goalCandidate.emphasis).toBe(0.4);

    // The review sentence produced NO candidate (no lexicon pattern matches
    // it — it stays raw STT evidence, honest about its specificity).
    expect(candidates.some((candidate) => candidate.eventTimeMs === CORRECTION_TIME_MS)).toBe(
      false,
    );

    // W209 emission: one contract observation per candidate — commentary
    // modality, DERIVED, no entity claims (mapping names to entities is
    // W401's job), confidence = the candidate's, verbatim.
    const candidateObservations = run1.candidateObservations;
    expect(candidateObservations).toHaveLength(CANDIDATE_OBSERVATION_COUNT);
    candidates.forEach((candidate, index) => {
      const observation = candidateObservations[index]!;
      expect(observation.observationId).toBe(`ceu-${candidate.candidateId}`);
      expect(ObservationSchema.safeParse(observation).success).toBe(true);
      expect(observation.sessionId).toBe(SESSION_ID);
      expect(observation.modality).toBe("commentary");
      expect(observation.provenance).toBe("DERIVED");
      expect(observation.subjectEntityRefs).toEqual([]);
      expect(observation.confidence).toBe(candidate.confidence);
      expect(observation.eventTimeMs).toBe(candidate.eventTimeMs);
      expect(observation.payload.kind).toBe("generic");
    });

    // ONE store holds the whole evidence stream: 244 vision + 6 audio + 5
    // candidate observations; re-delivering any record is the idempotent
    // duplicate no-op (duplicate tolerance per the streaming contract).
    const store = run1.store;
    expect(store.count()).toBe(TOTAL_OBSERVATION_COUNT);
    expect(store.query({ sessionId: SESSION_ID })).toHaveLength(TOTAL_OBSERVATION_COUNT);
    expect(store.append(byObservationId(run1.visionObservations, "sp-f-0-0-t1"))).toBe("duplicate");
    expect(store.append(byObservationId(run1.audioObservations, REVIEW_OBSERVATION_ID))).toBe(
      "duplicate",
    );
    expect(store.append(byObservationId(candidateObservations, "ceu-ec-4"))).toBe("duplicate");
    expect(store.count()).toBe(TOTAL_OBSERVATION_COUNT);

    // -----------------------------------------------------------------------
    // Section 3 — five fusion waves: report counters + stateAt pins.
    // -----------------------------------------------------------------------

    const reports = run1.waveReports;
    expect(reports).toHaveLength(WAVE_BOUNDARIES_MS.length);
    expect(reports.map((report) => report.entitiesUpserted)).toEqual([...WAVE_UPSERTS]);
    expect(reports.map((report) => report.eventsApplied)).toEqual([...WAVE_EVENTS]);
    expect(reports.map((report) => report.eventsDeduplicated)).toEqual([...WAVE_DEDUPS]);
    expect(reports.map((report) => report.clockPatches)).toEqual([...WAVE_CLOCK_PATCHES]);
    expect(reports.map((report) => report.possessionUpdates)).toEqual([...WAVE_POSSESSIONS]);
    // The conflict ledger stays EMPTY in this fixture: one clear possession
    // winner per wave, and only one period-establishing candidate exists.
    expect(reports.every((report) => report.conflicts.length === 0)).toBe(true);
    expect(reports.every((report) => report.warnings.length === 0)).toBe(true);
    // The engine's snapshot version after each wave (the wave-4 report is
    // taken BEFORE the correction applies — see VERSION_AFTER_CORRECTION).
    expect(reports.map((report) => report.snapshotVersionAfter)).toEqual([...WAVE_VERSIONS]);

    const pins = run1.pins;
    expect(pins).toHaveLength(WAVE_BOUNDARIES_MS.length);

    // The pins' coherent temporal match state — one per wave boundary, each
    // queried while the stream is only fused that far:
    pins.forEach((pin, wave) => {
      expect(WorldSnapshotSchema.safeParse(pin).success).toBe(true);
      expect(pin.sessionId).toBe(SESSION_ID);
      // Injected clock — never a wall-clock read.
      expect(pin.generatedAtMs).toBe(TEST_EPOCH_MS);
      // Entity VERSION evolution: 13 upserts, then 25, 37, 49 (+ the
      // correction bump on the striker at wave 4), then 61 (+ 12 more frames
      // + the earlier bump on t1 = 62).
      expect(pin.entities.map((entity) => entity.version)).toEqual([
        ...WAVE_ENTITY_VERSIONS[wave]!,
      ]);
      // The watermark: the entities' frame time and the event log's
      // sequence high-water (1, 3, 4, then 5 once the correction is in).
      expect(pin.watermark).toEqual(WAVE_WATERMARKS[wave]);
      // Honest entity state slots: an UNCERTAIN position carrying the
      // verbatim fused confidence, a KNOWN caller-declared spatial frame,
      // and a KNOWN session-timeline lastSeen.
      for (const entity of pin.entities) {
        expect(entity.state.position?.status).toBe("uncertain");
        expect(entity.state.position?.confidence).toBe(TRACK_CONFIDENCE);
        expect(entity.state.spatialFrame).toEqual({ status: "known", value: "pitch" });
        expect(entity.state.lastSeenMs).toEqual({
          status: "known",
          value: WAVE_BOUNDARIES_MS[wave],
        });
        expect(entity.kind).toBe(ENTITY_KINDS[TRACK_IDS.indexOf(entity.entityId)]);
      }
      // The winger's and the ball's hand-derived positions (X = 26.25 +
      // 52.5u; the winger exactly the shrinking gap above the ball).
      const winger = pinEntity(pin, "t2");
      expect(winger.state.position?.value).toBeDefined();
      const wingerPosition = winger.state.position?.value as { x: number; y: number };
      expect(wingerPosition.x).toBeCloseTo(WINGER_PIN_POSITIONS[wave]!.x, 9);
      expect(wingerPosition.y).toBeCloseTo(WINGER_PIN_POSITIONS[wave]!.y, 9);
      const ball = pinEntity(pin, "t4");
      const ballPosition = ball.state.position?.value as { x: number; y: number };
      expect(ballPosition.x).toBeCloseTo(BALL_PIN_POSITIONS[wave]!.x, 9);
      expect(ballPosition.y).toBeCloseTo(BALL_PIN_POSITIONS[wave]!.y, 9);
      // Possession evolution: the nearest participant (t2, always) with the
      // hand-derived product confidence that GROWS as the gap shrinks.
      expect(pin.football).toBeDefined();
      expect(pin.football?.possession?.status).toBe("uncertain");
      expect(pin.football?.possession?.value).toEqual({ entityId: "t2" });
      expect(pin.football?.possession?.confidence).toBeCloseTo(
        WAVE_POSSESSION_CONFIDENCES[wave]!,
        9,
      );
      // Score honesty: untouched by this fixture, it stays UNKNOWN.
      expect(pin.football?.score).toEqual({
        home: 0,
        away: 0,
        status: { status: "unknown" },
      });
    });

    // The football clock across the pins: first-half until the fulltime
    // candidate's W401 clock patch lands in wave 5, then post-match.
    expect(pins[3]!.football?.clock).toEqual({
      period: "first-half",
      clockMs: 0,
      stoppage: false,
    });
    expect(pins[4]!.football?.clock).toEqual({
      period: "post-match",
      clockMs: 0,
      stoppage: false,
    });

    // -----------------------------------------------------------------------
    // Section 4 — the correction (versioned supersession, made visible).
    // -----------------------------------------------------------------------

    // The correction envelope: derived through the W005 seam from the
    // review observation — evidence chain resolvable in the store, honest
    // min-of-evidence confidence 0.97, DERIVED provenance, correcting the
    // fused goal event.
    const correction = run1.correction;
    expect(correction).toEqual({
      eventId: CORRECTION_EVENT_ID,
      sessionId: SESSION_ID,
      schemaVersion: SCHEMA_VERSION,
      eventTypeRef: "football/v1/goal",
      interval: { startTimeMs: GOAL_TIME_MS, endTimeMs: GOAL_TIME_MS },
      eventTimeMs: CORRECTION_TIME_MS,
      provenance: "DERIVED",
      confidence: CORRECTION_CONFIDENCE,
      evidence: { observationIds: [REVIEW_OBSERVATION_ID], reportedBy: "commentary" },
      correctionOf: GOAL_EVENT_ID,
    });

    // The engine appended it as log entry 5, superseding the goal.
    const correctionEntry = run1.correctionEntry;
    expect(correctionEntry.sequence).toBe(5);
    expect(correctionEntry.event.eventId).toBe(CORRECTION_EVENT_ID);
    expect(correctionEntry.snapshotVersionAfter).toBe(VERSION_AFTER_CORRECTION);

    // CORRECTED STATE AT T-AFTER (pin 4, t=9600): the correction's entity
    // bump is VISIBLE — the striker's version 50 against its siblings' 49 —
    // while the watermark carries the correction's sequence 5.
    expect(pins[3]!.entities.map((entity) => entity.version)).toEqual([50, 49, 49, 49]);
    expect(pins[3]!.watermark).toEqual({ watermarkMs: 9_600, sequence: 5 });

    // The event log after the whole story: five entries, the superseded
    // goal still queryable (history never silently rewritten) with its
    // ORIGINAL confidence 0.91, the correction carrying 0.97.
    const entries = run1.entries;
    expect(run1.engine.eventCount).toBe(5);
    expect(entries.map((entry) => entry.event.eventId)).toEqual([
      "fe-ceu-ec-1",
      "fe-ceu-ec-2",
      "fe-ceu-ec-3",
      GOAL_EVENT_ID,
      CORRECTION_EVENT_ID,
    ]);
    expect(entries.map((entry) => entry.event.eventTimeMs)).toEqual([
      500, 3_000, 4_600, 7_000, 9_000,
    ]);
    const goalEntry = entries[3]!;
    expect(goalEntry.event.confidence).toBeCloseTo(GOAL_CONFIDENCE, 10);
    expect(goalEntry.event.correctionOf).toBeUndefined();
    const appliedCorrection = entries[4]!;
    expect(appliedCorrection.event.correctionOf).toBe(GOAL_EVENT_ID);
    expect(appliedCorrection.event.confidence).toBe(CORRECTION_CONFIDENCE);
    expect(appliedCorrection.event.evidence.observationIds).toEqual([REVIEW_OBSERVATION_ID]);

    // The W006 provenance renderers make the evidence chains textual and
    // exact: the corrected event corrects the goal, itself derived from the
    // candidate observation; the review correction derives from the review
    // observation with the corrected confidence.
    expect(describeProvenance(goalEntry.event)).toBe(
      "event fe-ceu-ec-4 type=football/v1/goal session=sess-m2-e2e eventTimeMs=7000 " +
        "provenance=DERIVED confidence=0.91 evidence=[ceu-ec-4] reportedBy=commentary",
    );
    expect(describeProvenance(appliedCorrection.event)).toBe(
      "event evt-review-1 type=football/v1/goal session=sess-m2-e2e eventTimeMs=9000 " +
        "provenance=DERIVED confidence=0.97 evidence=[stt-tu-4] reportedBy=commentary " +
        "corrects=fe-ceu-ec-4",
    );

    // -----------------------------------------------------------------------
    // Section 5 — eventWindow + replayForward (the replay leg).
    // -----------------------------------------------------------------------

    // The full window: sequence order preserved, superseded events INCLUDED
    // (the window is a slice of the full evidence record — corrections are
    // versioned supersession, the original stays queryable).
    const windowA = run1.windowA;
    expect(windowA.map((entry) => entry.event.eventId)).toEqual([
      "fe-ceu-ec-1",
      "fe-ceu-ec-2",
      "fe-ceu-ec-3",
      GOAL_EVENT_ID,
      CORRECTION_EVENT_ID,
    ]);
    // Every replayed event carries its id, DERIVED provenance, an evidence
    // chain into the store, and a confidence — the gate's
    // "replay event sequence with provenance/confidence".
    windowA.forEach((entry) => {
      expect(entry.event.provenance).toBe("DERIVED");
      expect(entry.event.evidence.observationIds.length).toBeGreaterThanOrEqual(1);
      expect(entry.event.confidence).toBeDefined();
    });
    // The fused events' confidence is the W209 candidate confidence,
    // VERBATIM (the derivation propagates, never re-invents); the correction
    // carries its min-of-evidence 0.97.
    expect(windowA[0]!.event.confidence).toBeCloseTo(0.77, 10);
    expect(windowA[1]!.event.confidence).toBeCloseTo(0.85, 10);
    expect(windowA[2]!.event.confidence).toBeCloseTo(0.85, 10);
    expect(windowA[3]!.event.confidence).toBeCloseTo(GOAL_CONFIDENCE, 10);
    expect(windowA[4]!.event.confidence).toBe(CORRECTION_CONFIDENCE);
    expect(windowA[0]!.event.evidence.observationIds).toEqual(["ceu-ec-1"]);
    expect(windowA[4]!.event.evidence.observationIds).toEqual([REVIEW_OBSERVATION_ID]);

    // REPLAY A (the full window): the supersession accounting is EXACTLY
    // what the engine reports — 4 events applied (the superseded goal is
    // SKIPPED, its corrected value replays at the correction's position),
    // 1 correction applied detached, 1 supersession skipped, nothing
    // orphaned, nothing duplicated.
    const replayA = run1.replayA;
    expect(replayA.eventsApplied).toBe(4);
    expect(replayA.correctionsApplied).toBe(1);
    expect(replayA.supersededSkipped).toBe(1);
    expect(replayA.correctionsOrphaned).toBe(0);
    expect(replayA.duplicatesSkipped).toBe(0);
    expect(replayA.limits).toEqual(REPLAY_LIMITS);

    // Checkpoint cadence, hand-checked: the kickoff (500) crosses no
    // 2000 ms boundary; the pass (3000) crosses 2000; the shot (4600)
    // crosses 4000; the correction (9000) crosses 6000 AND 8000 with ONE
    // checkpoint (the boundary then jumps past it) — plus the always-present
    // final snapshot.
    expect(replayA.checkpoints).toHaveLength(4);
    expect(replayA.checkpoints.map((checkpoint) => checkpoint.watermark)).toEqual([
      { watermarkMs: 3_000, sequence: 2 },
      { watermarkMs: 4_600, sequence: 3 },
      { watermarkMs: 9_000, sequence: 4 },
      { watermarkMs: 9_000, sequence: 4 },
    ]);
    expect(replayA.checkpoints.at(-1)).toEqual(replayA.final);
    // W402's forced deterministic clock: every replay snapshot carries the
    // constant, never a wall-clock read.
    for (const checkpoint of replayA.checkpoints) {
      expect(checkpoint.generatedAtMs).toBe(REPLAY_GENERATED_AT_MS);
    }

    // The replay final state, reconciled with the DIRECT-QUERY path:
    //
    // - The event-derived position MATCHES: the replay's final watermark
    //   sits at 9000 — the live log's LAST event time (the correction) —
    //   and its sequence 4 is exactly the live count 5 minus the one
    //   superseded event the replay skipped.
    // - DOCUMENTED intentional differences (W402): the live pin at 12000
    //   carries watermark 12000/5 because entity upserts and the football
    //   timeline are NOT events — an event-only replay cannot reconstruct
    //   entity state, so the replay's entities are empty while the live
    //   engine's are not.
    expect(replayA.final.watermark).toEqual({ watermarkMs: 9_000, sequence: 4 });
    expect(replayA.final.watermark.watermarkMs).toBe(
      entries[entries.length - 1]!.event.eventTimeMs,
    );
    expect(replayA.final.watermark.sequence).toBe(entries.length - replayA.supersededSkipped);
    expect(replayA.final.entities).toEqual([]);
    expect(pins[4]!.watermark).toEqual({ watermarkMs: 12_000, sequence: 5 });
    expect(pins[4]!.entities).toHaveLength(SPECS.length);
    // The football context is CALLER-PINNED replay init (the documented W402
    // consumer pattern): the replay carries the fused engine's final
    // football state verbatim — post-match clock and possession included.
    expect(replayA.final.football).toEqual(pins[4]!.football);
    expect(replayA.final.football?.clock.period).toBe("post-match");
    expect(WorldSnapshotSchema.safeParse(replayA.final).success).toBe(true);

    // REPLAY B (the narrow window, from 8000): the goal is OUTSIDE the
    // window, so the correction's target cannot resolve — the engine
    // reports the correction as ORPHANED: skipped, counted, never silent.
    // (This is the counter W403's fixture measured at 0; here it is 1.)
    const windowB = run1.windowB;
    expect(windowB.map((entry) => entry.event.eventId)).toEqual([CORRECTION_EVENT_ID]);
    const replayB = run1.replayB;
    expect(replayB.eventsApplied).toBe(0);
    expect(replayB.correctionsApplied).toBe(0);
    expect(replayB.supersededSkipped).toBe(0);
    expect(replayB.correctionsOrphaned).toBe(1);
    expect(replayB.duplicatesSkipped).toBe(0);
    // With nothing applied, the final snapshot is the empty replay state
    // (session inherited from the window's own event).
    expect(replayB.checkpoints).toHaveLength(1);
    expect(replayB.checkpoints[0]).toEqual(replayB.final);
    expect(replayB.final.watermark).toEqual({ watermarkMs: 0, sequence: 0 });
    expect(replayB.final.entities).toEqual([]);
    expect(replayB.final.sessionId).toBe(SESSION_ID);

    // -----------------------------------------------------------------------
    // Section 6 — the idempotent re-fusion (the W401 evidence).
    // -----------------------------------------------------------------------

    const engine = run1.engine;
    const refusion = run1.refusion;
    // Re-running fusion over the SAME store applies nothing: every entity
    // upsert would rewind, every event id is already in the log (the four
    // candidates are counted as dedups), the clock patch is a
    // re-application no-op, and the possession candidate is deep-equal.
    expect(refusion.entitiesUpserted).toBe(0);
    expect(refusion.eventsApplied).toBe(0);
    expect(refusion.eventsDeduplicated).toBe(4);
    expect(refusion.clockPatches).toBe(0);
    expect(refusion.possessionUpdates).toBe(0);
    expect(refusion.conflicts.length).toBe(0);
    expect(refusion.warnings.length).toBe(0);
    // The snapshot version is UNCHANGED, and so is the full at-12000 state:
    // re-querying after the re-fusion yields the identical snapshot.
    expect(refusion.snapshotVersionAfter).toBe(WAVE_VERSIONS[4]);
    expect(engine.snapshotVersion).toBe(WAVE_VERSIONS[4]);
    expect(stateAt(engine, LAST_FRAME_MS).snapshot).toEqual(pins[4]!);
    // The correction's entity bump survived untouched: the striker is at
    // 62 (61 upserts + the correction), its siblings at 61.
    expect(engine.entityAt("t1")?.version).toBe(62);
    expect(engine.entityAt("t2")?.version).toBe(61);

    // The W007-facing engine summary agrees: 5 log entries (superseded
    // included), snapshot version 256, every entity's identity/version/time.
    const trail = auditTrail(engine);
    expect(trail.snapshotVersion).toBe(WAVE_VERSIONS[4]);
    expect(trail.events).toBe(5);
    expect(trail.entities.map((entity) => entity.entityId)).toEqual([...TRACK_IDS]);
    expect(trail.entities.map((entity) => entity.version)).toEqual([62, 61, 61, 61]);
    expect(trail.entities.every((entity) => entity.lastEventTimeMs === LAST_FRAME_MS)).toBe(true);

    // -----------------------------------------------------------------------
    // Section 7 — determinism: the whole story re-run, deep-equal.
    // -----------------------------------------------------------------------

    // The WHOLE story with fresh objects produces the identical artifacts —
    // observations, wave reports, pins, log entries, windows, both replay
    // results, and the correction envelope — compared as JSON. No seed,
    // clock, or RNG input differs between the two runs; nothing else may.
    const run2 = runM2Story();
    expect(serializeRun(run2)).toBe(serializeRun(run1));
    expect(run2.store.count()).toBe(TOTAL_OBSERVATION_COUNT);
    expect(run2.engine.snapshotVersion).toBe(WAVE_VERSIONS[4]);
    expect(run2.replayA.final.watermark).toEqual(replayA.final.watermark);
    expect(run2.replayB.correctionsOrphaned).toBe(1);
  });
});
