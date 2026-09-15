/**
 * DEV SEED STORY FIXTURES (W904/W905) — the checked-in fixture content the
 * dev seed drives through the REAL engine.
 *
 * ⚠️ THIS IS A DEV SEED. Nothing in this module fabricates product state: it
 * authors real ENGINE INPUTS (fixture vision lanes + a fixture commentary
 * transcript — the same checked-in fixture patterns as `tests/e2e/m3-rendering.test.ts`)
 * and hands them to the REAL W2xx→W4xx chain. The sessions, renders, outputs,
 * positions, events and confidences it yields are all computed by the real
 * packages; this module never invents any of them.
 *
 * The 6-second, six-wave story shape (one wave per second, 31 fixture frames
 * at 200 ms, one `stateAt`+`eventWindow` capture per wave) is the m3 e2e
 * demo's streaming posture, reused verbatim. Per-story variation is confined
 * to the REAL input parameters: the fixture camera pan and the commentary
 * transcript — every downstream number is recomputed by the real chain.
 *
 * Seam-gap bridge (the m3-documented one): the W401 fusion projects track
 * observations into an entity state slot named `position`, while the W502
 * anime renderer reads `pitchPosition`. `runFixtureStory` bridges the gap at
 * the PUBLIC seams — the captured per-step snapshots get `position` copied
 * verbatim under `pitchPosition`, and one `engine.upsertEntity` pass does the
 * same on the engine so the control plane's own renders see real markers.
 * (The one-line real fixes belong to the TL; see m3's header note.)
 */
import type { AuthorizationPolicy } from "@sporta/contracts";
import {
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
} from "@sporta/contracts";
import type { WorldSnapshot } from "@sporta/contracts";
import type { FootballState } from "@sporta/world-model";
import type { TranscriptionUnit } from "@sporta/asr";
import { emitTranscriptionObservations } from "@sporta/asr";
import { segmentCommentary } from "@sporta/commentary-segmentation";
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
import { InMemoryObservationStore } from "@sporta/observation";
import { runWorldFusion } from "@sporta/fusion";
import { WorldModelEngine } from "@sporta/world-model";
import { eventWindow, stateAt } from "@sporta/temporal";
import type { AnimeClipStep } from "@sporta/renderer-anime";

// ---------------------------------------------------------------------------
// The fixed story shape (the m3 demo constants)
// ---------------------------------------------------------------------------

/** 31 frames at 200 ms — one vision frame every 200 ms from 0 to 6000 ms. */
const FRAME_COUNT = 31;
const FRAME_MS = 200;
/** Pixel volume offered to the fixture calibrator (it ignores content). */
const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 90;

/** The 6-step timeline: one step per second, 1000..6000 ms. */
export const STORY_WAVE_BOUNDARIES_MS: readonly number[] = [1_000, 2_000, 3_000, 4_000, 5_000, 6_000];

/**
 * Four fixture objects on linear, non-crossing lanes (the m3 lane geometry —
 * striker / winger / defender / ball). The spec order fixes the tracker's
 * t1..t4 ids; the winger's v is pinned so the projected Y gap to the ball
 * stays inside the 2 m possession radius the whole clip.
 */
const SPECS: readonly FixtureTrackSpec[] = [
  {
    gtId: "seed-striker",
    label: "player",
    motion: { kind: "linear", from: { x: 0.3, y: 0.4 }, to: { x: 0.6, y: 0.5 } },
    size: { w: 0.2, h: 0.1 },
  },
  {
    gtId: "seed-winger",
    label: "player",
    motion: {
      kind: "linear",
      from: { x: 0.4, y: 0.5 + 1.5 / 34 },
      to: { x: 0.5, y: 0.5 + 1 / 34 },
    },
    size: { w: 0.2, h: 0.1 },
  },
  {
    gtId: "seed-defender",
    label: "player",
    motion: { kind: "linear", from: { x: 0.32, y: 0.6 }, to: { x: 0.34, y: 0.64 } },
    size: { w: 0.2, h: 0.1 },
  },
  {
    gtId: "seed-ball",
    label: "ball",
    motion: { kind: "linear", from: { x: 0.4, y: 0.5 }, to: { x: 0.5, y: 0.5 } },
    size: { w: 0.04, h: 0.04 },
  },
];

/** The asrConfidence carried on every fixture transcription unit. */
const ASR_CONFIDENCE = 0.95;

/** One commentary window of the fixture transcript. */
export interface StoryCommentaryWindow {
  startMs: number;
  endMs: number;
  text: string;
}

/** A dev-seed story: the real fixture inputs for one media session. */
export interface FixtureStorySpec {
  /** Stable story key (used in component ids and labels). */
  key: string;
  /** The fixture camera (a REAL W203 fixture-camera parameter). */
  camera: FixtureCameraSpec;
  /** The fixture commentary transcript (REAL W207/W209 input). */
  commentary: readonly StoryCommentaryWindow[];
  /** The fixture-scoped entity vocabulary W209 matches subjects against. */
  lexicon: KnownEntityLexicon;
}

/** One extracted event, as the real W209 chain reported it. */
export interface StoryEvent {
  sequence: number;
  timeMs: number;
  type: string;
  phrase: string;
  confidence: number;
}

/** Everything one story run really produced (all real engine output). */
export interface StoryRun {
  /** The fused engine (post slot-adapter — renderer-consumable). */
  engine: WorldModelEngine;
  /** The six adapted clip steps for the host-side clip render. */
  steps: readonly AnimeClipStep[];
  /** The fixture transcript, verbatim (real W207 units). */
  transcript: readonly { startMs: number; endMs: number; text: string; asrConfidence: number }[];
  /** The events the real W209 extraction found, in order. */
  events: readonly StoryEvent[];
  /** Fusion waves executed. */
  waveCount: number;
}

// ---------------------------------------------------------------------------
// The three seeded stories (varied REAL inputs; every output recomputed)
// ---------------------------------------------------------------------------

/**
 * Story A — "Derby night at Kings Park": the fully-authorized watchable match.
 * The m3 camera (pan 0.5) and the full kickoff/pass/goal transcript.
 */
export const DERBY_STORY: FixtureStorySpec = {
  key: "derby",
  camera: { pan: 0.5, zoom: 1, jitter: 0 },
  commentary: [
    { startMs: 500, endMs: 1_000, text: "And we kick off here at the stadium." },
    { startMs: 3_000, endMs: 3_500, text: "Mane plays a lovely pass to Salah." },
    { startMs: 5_500, endMs: 6_000, text: "Salah scores for Liverpool!" },
  ],
  lexicon: { players: ["Salah", "Mane"], teams: ["Liverpool"] },
};

/**
 * Story B — "Friendly under the lights": authorized, but rendered only with
 * the reference test-card renderer, so the Anime reality genuinely requires
 * a render for this match (a real "requires render" state, not a fake one).
 */
export const FRIENDLY_STORY: FixtureStorySpec = {
  key: "friendly",
  camera: { pan: 0.35, zoom: 1, jitter: 0 },
  commentary: [
    { startMs: 500, endMs: 1_000, text: "The friendly is under way here tonight." },
    { startMs: 4_000, endMs: 4_500, text: "Foden finishes a fine move!" },
  ],
  lexicon: { players: ["Foden"], teams: [] },
};

/**
 * Story C — "Training ground": a REAL rights-denied session. The policy allows
 * analysis + transformation only — rendering is compute (it runs), but stored
 * playback is denied before any byte (Simulation D, the control-gate property).
 */
export const TRAINING_STORY: FixtureStorySpec = {
  key: "training",
  camera: { pan: 0.5, zoom: 1, jitter: 0 },
  commentary: [
    { startMs: 500, endMs: 1_000, text: "Training resumes after the warm-down." },
    { startMs: 2_500, endMs: 3_000, text: "A sharp passing drill ends the session." },
  ],
  lexicon: { players: [], teams: [] },
};

/** The dev-seed authorization policies (REAL control-plane inputs). */
export const SEED_POLICIES: Readonly<
  Record<"derby" | "friendly" | "training", AuthorizationPolicy>
> = {
  derby: {
    policyId: "policy-dev-seed-derby",
    allowedOperations: ["analysis", "transformation", "derivativeGeneration", "storage", "sharing"],
    assertedBy: "dev-seed",
    sharingScope: "operator-authorized",
  },
  friendly: {
    policyId: "policy-dev-seed-friendly",
    allowedOperations: ["analysis", "transformation", "derivativeGeneration", "storage", "sharing"],
    assertedBy: "dev-seed",
    sharingScope: "operator-authorized",
  },
  training: {
    policyId: "policy-dev-seed-training",
    allowedOperations: ["analysis", "transformation"],
    assertedBy: "dev-seed",
    sharingScope: "private",
  },
};

// ---------------------------------------------------------------------------
// The story runner — the real M1→M3 chain, in process
// ---------------------------------------------------------------------------

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
    score: { home: 0, away: 0, status: { status: "unknown" } },
    possession: { status: "unknown" },
    eventTaxonomyVersion: "v1",
  };
}

/**
 * THE m3 SLOT ADAPTER (documented seam bridge): copies the fusion-written
 * `position` slot VERBATIM — same status, value, confidence — under the
 * renderer-documented `pitchPosition` key. Pure.
 */
function adaptSnapshotForRenderer(snapshot: WorldSnapshot): WorldSnapshot {
  return {
    ...snapshot,
    entities: snapshot.entities.map((entity) => {
      const position = entity.state.position;
      if (position === undefined) return entity;
      return { ...entity, state: { ...entity.state, pitchPosition: position } };
    }),
  };
}

/**
 * Runs one story through the REAL chain: fixture frames → W203 fixture camera
 * calibration → W204 greedy-IoU tracking → W206 pitch-meter spatial state →
 * real observation emission (vision + W207 transcript + W209 candidates) →
 * SIX W401 fusion waves into ONE `WorldModelEngine` → per-wave
 * `stateAt`/`eventWindow` captures → the one-time engine slot adapter.
 *
 * Deterministic given (spec, nowMs): the fixture generators are seeded by
 * their own constants and the engine clock is the injected `nowMs`.
 */
export function runFixtureStory(
  sessionId: string,
  spec: FixtureStorySpec,
  nowMs: () => number,
): StoryRun {
  // 1. Vision: fixture frames → calibrated corners + tracked detections.
  const fixtureFrames = generateFixtureFrames(SPECS, { frames: FRAME_COUNT, frameMs: FRAME_MS });
  const calibrator = new FixtureFieldCalibrator(spec.camera, `dev-seed-${spec.key}-calibrator`);
  const tracker = new GreedyIouTracker({}, `dev-seed-${spec.key}-tracker`);
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
  const spatialSeries = estimateSpatialState(spatialFrames, { clock: identityClock("video") });
  const visionObservations = emitSpatialObservations({
    sessionId,
    componentId: `dev-seed-${spec.key}-spatial`,
    series: spatialSeries,
  });

  // 2. Commentary: transcript → W207 units → W208 segmentation → W209 candidates.
  const units: TranscriptionUnit[] = spec.commentary.map((window, index) => ({
    unitId: `tu-${index}`,
    startMs: window.startMs,
    endMs: window.endMs,
    text: window.text,
    speakerLabel: "lead",
    channel: "main",
    asrConfidence: ASR_CONFIDENCE,
  }));
  const audioObservations = emitTranscriptionObservations({
    sessionId,
    componentId: `dev-seed-${spec.key}-asr`,
    units,
  });
  const commentaryUnits = segmentCommentary(units);
  const candidates: EventCandidate[] = extractEventCandidates({
    units: commentaryUnits,
    lexicon: spec.lexicon,
  });
  const candidateObservations = emitEventCandidateObservations({
    sessionId,
    componentId: `dev-seed-${spec.key}-understanding`,
    candidates,
  });

  // 3. Six fusion waves over one store into one engine (the streaming posture).
  const store = new InMemoryObservationStore();
  const engine = WorldModelEngine.create(sessionId, {
    football: makeFootballInit(),
    now: nowMs,
  });
  const allObservations = [...visionObservations, ...audioObservations, ...candidateObservations];
  const steps: AnimeClipStep[] = [];
  for (let wave = 0; wave < STORY_WAVE_BOUNDARIES_MS.length; wave += 1) {
    const throughMs = STORY_WAVE_BOUNDARIES_MS[wave]!;
    const afterMs = wave === 0 ? -1 : STORY_WAVE_BOUNDARIES_MS[wave - 1]!;
    for (const observation of allObservations) {
      if (observation.eventTimeMs > afterMs && observation.eventTimeMs <= throughMs) {
        store.append(observation);
      }
    }
    runWorldFusion({ store, engine, sessionId });

    // The step's snapshot (adapted — renderer-consumable) and its caption
    // window (prev, at] — EXCLUSIVE lower bound so a boundary event
    // attributes to exactly one step (the W502/W503 convention).
    const rawSnapshot = stateAt(engine, throughMs).snapshot;
    const snapshot = adaptSnapshotForRenderer(rawSnapshot);
    const fromMs = wave === 0 ? 0 : STORY_WAVE_BOUNDARIES_MS[wave - 1]! + 1;
    const events = eventWindow(engine.eventsSince(0), { fromMs, toMs: throughMs });
    steps.push({ atMs: throughMs, snapshot, events });
  }

  // 4. The one-time ENGINE slot adapter (the seam-gap bridge for the control
  //    plane's own renders): re-upsert every entity with `pitchPosition`
  //    copied verbatim from `position`, through the PUBLIC upsert seam.
  for (const entity of engine.snapshot().entities) {
    const position = entity.state.position;
    if (position === undefined) continue;
    engine.upsertEntity({
      ...entity,
      state: { ...entity.state, pitchPosition: position },
    });
  }

  // 5. The story's event list — the REAL W209 extraction output, ordered.
  const events: StoryEvent[] = candidates.map((candidate, index) => ({
    sequence: index + 1,
    timeMs: candidate.eventTimeMs,
    type: candidate.eventType,
    phrase: candidate.eventPhrase,
    confidence: candidate.confidence,
  }));

  return {
    engine,
    steps,
    transcript: units.map((unit) => ({
      startMs: unit.startMs,
      endMs: unit.endMs,
      text: unit.text,
      asrConfidence: unit.asrConfidence ?? ASR_CONFIDENCE,
    })),
    events,
    waveCount: STORY_WAVE_BOUNDARIES_MS.length,
  };
}
