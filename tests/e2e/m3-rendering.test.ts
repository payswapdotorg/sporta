/**
 * M3 rendering e2e — the G4 EXIT DEMO (harness template: the G2/G3 demos
 * `tests/e2e/m1-understanding.test.ts` and `tests/e2e/m2-world-model.test.ts`;
 * see docs/testing/HARNESS.md).
 *
 * Gate G4 (docs/roadmap/roadmap.md): "Complete M3. Offline authorized clips
 * render in an anime/stylized mode with measurable temporal consistency."
 * The exit demo this file IS: "one clip -> original reference + transformed
 * output, with fixture metrics and playback."
 *
 * ONE deterministic authorized clip through the delivered public package
 * seams — the WHOLE M3 chain in one story:
 *
 *   1. RIGHTS + SESSIONS (fail-closed, both planes): an authorized policy
 *      (analysis + transformation + derivativeGeneration + storage — the
 *      exact operations `deriveRightsCapabilities` needs for
 *      `canStoreDerivatives`) creates a REAL control-plane session over
 *      HTTP; an expired policy is refused 403 at the same boundary; and the
 *      local W004 lifecycle posture (created -> authorized -> ingesting,
 *      no-policy -> `RightsDeniedError`) mirrors the m1/m2 demos.
 *   2. CLIP -> SWM (the M1/M2 seams, one 0..6000 ms timeline): three players
 *      and the ball ride the W204 fixture tracker -> W203 fixture camera ->
 *      W206 pitch-meter spatial state; the transcript goes W207 -> W208 ->
 *      W209 candidates (kickoff 0.77 / pass 0.85 / goal 0.91 — the documented
 *      confidence formula, hand-derived below). SIX fusion waves — one per
 *      1000 ms clip step — stream the observations into ONE `WorldModelEngine`
 *      (injected clock `TEST_EPOCH_MS`), and each wave's `stateAt` snapshot +
 *      `eventWindow` caption window (EXCLUSIVE lower bound `(prev, at]`, the
 *      W502/W503 fixture convention, so boundary events attribute exactly
 *      once) become one `AnimeClipStep`. An idempotent re-fusion over the
 *      unchanged store applies nothing (the W401 evidence, re-proven here).
 *   3. ORIGINAL REFERENCE LEG: the W501 reference renderer
 *      (`sporta.testcard@0.1.0`, the deterministic test-card plugin that
 *      PROVES the renderer contract) renders THE SAME request surface — the
 *      same session, the same fused engine snapshot, the same
 *      `POST /v1/sessions/:id/renders` route — through the REAL
 *      `RendererRegistry`, the app's `validateRequest` + `render` gates, and
 *      the fail-closed rights derivation. HONEST ABOUT WHAT IT IS: the test
 *      card is the contract-reference BASELINE (a deterministic synthetic
 *      timeline of `testcard://` segment refs), NOT a pixel-true reproduction
 *      of the source broadcast — no renderer in the repo consumes source
 *      frames (`requiresSourceFrames: false` everywhere); the stylized-video
 *      renderer class that would is documented future work (W502 identity).
 *   4. TRANSFORMED OUTPUT LEG (the W502 conformance path): the REAL anime
 *      plugin (`anime.prototype@0.1.0`) is registered in the same registry
 *      and renders through the same HTTP route (the single-snapshot contract
 *      path over the story's final engine snapshot — deep-equal-proven
 *      against the host-side `renderAnimeFromSnapshot` with the app's exact
 *      request parameters, the W504 e2e equivalence pattern); the 13-check
 *      W501 `runConformance` harness passes on a fresh plugin instance; and
 *      the CLIP path renders the six captured steps into the stylized moving
 *      clip (`renderAnimeClip`) with per-frame provenance.
 *   5. FIXTURE METRICS: `evaluateRenderOutput` (W503) over the clip — PASS
 *      with pinned exact numbers: flicker 0, unexplainedAbsence 0,
 *      styleStability 18/18 = 1.0, styleBytes 24/24 = 1.0, 20 measured
 *      geometry pairs, jumpCount 0, maxJumpRatio = hypot(2.625, 3.4/6)/12.51
 *      (the striker's 2.6855 m/s sprint step against the 12.5 m/s player
 *      bound + 0.01 epsilon — hand-derived from the lane geometry below),
 *      and all 15 temporal-artifact counts 0 (21/21 checks).
 *   6. PLAYBACK (W504, end to end): `encodeAnimeClip` turns the clip into
 *      ONE self-contained animated-SVG segment (SMIL timings derived exactly
 *      from the W502 windows); `createAnimeOutputPipeline` encodes + stores
 *      it (scope-keyed segment store + content-addressed artifact store)
 *      under the control plane's anime render id; every `anime://` artifact
 *      ref resolves through `locateAnimeRef`; and the REAL playback routes
 *      (`GET /v1/sessions/:id/renders/:renderId/outputs[/:segmentId]`,
 *      rights-gated fail-closed) serve the byte-identical document — the
 *      served content re-hashes to the artifact id and the container
 *      manifest is carried verbatim. A second session under a
 *      no-storage-rights policy renders fine (compute) but is REFUSED 403
 *      on both playback routes before any byte is revealed.
 *   7. DETERMINISM: the WHOLE demo (fresh control server, fresh pipeline,
 *      fresh story objects) runs twice; every artifact — observations, wave
 *      reports, pins, both render results, the clip, the evaluation report,
 *      the encoded segment, the store results, the served playback
 *      documents — is deep-equal as JSON.
 *
 * HARNESS RULES (docs/testing/HARNESS.md): no `Math.random`, no `Date.now`;
 * every time is an explicit ms constant; the engine clock is INJECTED
 * (`now: () => TEST_EPOCH_MS`), the control plane runs on the frozen
 * `nowMs: () => TEST_EPOCH_MS` injection, and the output pipeline's default
 * stores carry their own deterministic `TEST_EPOCH_MS + ticks` clocks. Only
 * PUBLIC package APIs are exercised.
 *
 * IMPORT NOTE (documented deviation from HARNESS.md's letter — the G3 demo
 * precedent, widened): `@sporta/fusion`, `@sporta/temporal`,
 * `@sporta/renderer-anime`, `@sporta/renderer-contract`,
 * `@sporta/renderer-evaluation`, `@sporta/output-pipeline`, and
 * `@sporta/control-api` are not root `package.json` devDependencies (the
 * root lists the M0/M1 seam packages), and this brief forbids root-file and
 * bun.lock changes — so those seven M2/M3 packages are imported by RELATIVE
 * path to their public entry modules (the `src/index.ts` files their export
 * maps point at). The exercised surface is the packages' public API either
 * way; the permanent fix (adding the workspace deps to the root
 * devDependencies) is a seven-line root change for the TL.
 *
 * SEAM GAP FOUND AND BRIDGED — W401 fusion vs the W502 renderer entity-state
 * slot name (documented, never papered over): the world-model contract says
 * entity `state` keys are kind-specific and its own example — like the
 * `@sporta/testing` builders, the contracts fixtures, and the W502/W503
 * fixtures — is `pitchPosition`, which is the slot the anime renderer reads
 * (`POSITION_SLOT_KEY`). The W401 fusion, however, projects track
 * observations into a slot named `position` (plus `spatialFrame`/`lastSeenMs`
 * — see `packages/fusion/src/entities.ts`). A raw fused snapshot therefore
 * renders with EVERY entity accounted as `omitted-no-position` (the renderer
 * never invents positions — asserted below as measured evidence, not just a
 * comment). This demo bridges the gap with a small AUTHORED adapter at the
 * public seams (the G3 demo's authored-correction-linkage posture):
 * `adaptSnapshotForRenderer` copies the `position` slot VERBATIM (same
 * status, value, and confidence) under `pitchPosition` for the clip steps,
 * and ONE `engine.upsertEntity` pass does the same on the engine itself so
 * the control plane's renders see real markers. Both applications are
 * asserted to be value-identical, and the adapter's version cost is pinned
 * (+4 snapshot-version, +1 entity version). The one-line real fixes belong
 * to the TL: rename the fusion slot to `pitchPosition`, or teach the
 * renderer to read both keys.
 *
 * Second documented wiring choice: the control plane's render record r-2
 * (the contract-path render from the story's final snapshot) and the STORED
 * output segment under r-2 (the clip-path render this demo measures and
 * plays back) are the two W502 render paths over the SAME SWM story. The
 * host assigns stored outputs to render ids (the documented W504 pattern —
 * `PipelineStoreInput.renderId` is host-assigned, "e.g. the control plane's
 * `r-<seq>`"); the control plane gates playback access, it does not
 * interpret manifest contents (control-api `playback.ts`).
 */
import { describe, expect, test } from "bun:test";
import {
  Observation as ObservationSchema,
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
  SCHEMA_VERSION,
  WorldSnapshot as WorldSnapshotSchema,
  deriveRightsCapabilities,
} from "@sporta/contracts";
import type {
  AuthorizationPolicy,
  MediaSession,
  Observation,
  RenderRequest,
  RenderResult,
  WorldSnapshot,
} from "@sporta/contracts";
import { emitTranscriptionObservations } from "@sporta/asr";
import type { TranscriptionUnit } from "@sporta/asr";
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
import type { TrackPayload } from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import { RightsDeniedError, SessionLifecycle } from "@sporta/session";
import { WorldModelEngine } from "@sporta/world-model";
import type { FootballState } from "@sporta/world-model";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import {
  TEST_EPOCH_MS,
  buildAuthorizationPolicy,
  buildMediaSession,
  seedFromString,
} from "@sporta/testing";
import { runWorldFusion } from "../../packages/fusion/src/index";
import type { FusionReport } from "../../packages/fusion/src/index";
import { eventWindow, stateAt } from "../../packages/temporal/src/index";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  createAnimePrototypeRenderer,
  renderAnimeClip,
  renderAnimeFromSnapshot,
} from "../../packages/renderer-anime/src/index";
import type {
  AnimeClipManifest,
  AnimeClipStep,
  AnimeRenderOutput,
} from "../../packages/renderer-anime/src/index";
import {
  RendererRegistry,
  createTestCardRenderer,
  runConformance,
} from "../../packages/renderer-contract/src/index";
import type { ConformanceReport } from "../../packages/renderer-contract/src/index";
import { evaluateRenderOutput } from "../../packages/renderer-evaluation/src/index";
import type { TemporalConsistencyReport } from "../../packages/renderer-evaluation/src/index";
import {
  contentHashOf,
  createAnimeOutputPipeline,
  encodeAnimeClip,
  segmentIdOf,
} from "../../packages/output-pipeline/src/index";
import type {
  EncodedAnimeSegment,
  PipelineStoreResult,
  PipelineStats,
} from "../../packages/output-pipeline/src/index";
import type { AnimeRefLocation } from "../../packages/output-pipeline/src/index";
import { createControlServer } from "../../packages/control-api/src/index";

// --- Fixed slice constants -------------------------------------------------

/** Named seed: every builder below draws from this one reproducible seed. */
const E2E_SEED = seedFromString("m3-e2e");

/**
 * The control plane's deterministic session id: a fresh app assigns
 * `sess-<seq>` starting at 1 (W701), so the FIRST session created on the
 * demo's fresh server is `sess-1` — pinned, and the whole story runs under it.
 */
const SESSION_ID = "sess-1";
const POLICY_ID = "policy-m3-e2e";
const SOURCE_ID = "src-m3-cam-1";

/** The operations that derive every capability the demo needs. */
const AUTHORIZED_OPERATIONS: readonly AuthorizationPolicy["allowedOperations"] = [
  "analysis",
  "transformation",
  "derivativeGeneration",
  "storage",
];

/** The 6-step clip timeline: one step per second, 1000..6000 ms. */
const WAVE_BOUNDARIES_MS: readonly number[] = [1_000, 2_000, 3_000, 4_000, 5_000, 6_000];

// --- Section 2 — the observation stream (real W2xx seams, one timeline) ----

/**
 * The W203 fixture camera — pan 0.5, zoom 1, jitter 0 (the camera model's
 * own doc example, the same one the G2/G3 demos pinned): the visible window
 * is 52.5 x 34 m centered on the pitch, so image (u, v) -> pitch is exactly
 *
 *     X = 26.25 + 52.5 * u        Y = 17 + 34 * v
 *
 * and every hand-derived expectation below uses this closed form.
 */
const CAMERA: FixtureCameraSpec = { pan: 0.5, zoom: 1, jitter: 0 };
const CALIBRATOR_ID = "m3-fixture-calibrator";
const TRACKER_ID = "m3-greedy-iou";
const SPATIAL_COMPONENT_ID = "m3-spatial-state";
const ASR_COMPONENT_ID = "m3-fixture-backend";
const COMMENTARY_COMPONENT_ID = "m3-commentary-understanding";

/** 31 frames at 200 ms — one vision frame every 200 ms from 0 to 6000 ms. */
const FRAME_COUNT = 31;
const FRAME_MS = 200;

/**
 * Four fixture objects on linear, non-crossing lanes (the G3 demo's posture,
 * re-derived for a 6-second clip). Spec order fixes the first-frame detection
 * order, hence the t1/t2/t3/t4 ids the greedy-IoU tracker assigns. The lane
 * geometry (image centers, interpolation law t = frame / 30):
 *
 *     t1: (0.30 + 0.30t, 0.40 + 0.10t) -> pitch (42 + 15.75t, 30.6 + 3.4t)
 *     t2: (0.40 + 0.10t, 0.5 + (1.5 - 0.5t) / 34)
 *     t3: (0.32 + 0.02t, 0.60 + 0.04t) -> pitch (43.05 + 1.05t, 37.4 + 1.36t)
 *     t4 (ball): (0.40 + 0.10t, 0.5)   -> pitch (47.25 + 5.25t, 34)
 *
 * t2's v is pinned so the projected Y gap to the ball is EXACTLY
 * 34 * ((1.5 - 0.5t) / 34) = 1.5 - 0.5t meters: 1.5 m at frame 0 shrinking to
 * 1.0 m at frame 30, always inside the 2 m possession radius and always
 * strictly closer than t1/t3 (t1 ends 5.25 m from the ball, t3 ~9.7 m).
 */
const SPECS: readonly FixtureTrackSpec[] = [
  {
    gtId: "m3-striker",
    label: "player",
    motion: { kind: "linear", from: { x: 0.3, y: 0.4 }, to: { x: 0.6, y: 0.5 } },
    size: { w: 0.2, h: 0.1 },
  },
  {
    gtId: "m3-winger",
    label: "player",
    motion: {
      kind: "linear",
      from: { x: 0.4, y: 0.5 + 1.5 / 34 },
      to: { x: 0.5, y: 0.5 + 1 / 34 },
    },
    size: { w: 0.2, h: 0.1 },
  },
  {
    gtId: "m3-defender",
    label: "player",
    motion: { kind: "linear", from: { x: 0.32, y: 0.6 }, to: { x: 0.34, y: 0.64 } },
    size: { w: 0.2, h: 0.1 },
  },
  {
    gtId: "m3-ball",
    label: "ball",
    motion: { kind: "linear", from: { x: 0.4, y: 0.5 }, to: { x: 0.5, y: 0.5 } },
    size: { w: 0.04, h: 0.04 },
  },
];

/** Track ids the tracker assigns in spec order on frame 0. */
const TRACK_IDS: readonly string[] = ["t1", "t2", "t3", "t4"];
const ENTITY_KINDS: readonly string[] = ["participant", "participant", "participant", "ball"];
const VISION_OBSERVATION_COUNT = FRAME_COUNT * SPECS.length; // 124

/** Fused track confidence: min(fixture detection 0.9, fixture corners 0.9). */
const TRACK_CONFIDENCE = 0.9;

/** Pixel volume offered to the fixture calibrator (it ignores content). */
const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 90;

/**
 * The fixed match transcript — three sentences, each one W207 window, with
 * pinned window starts so every event time is a constant: kickoff 500,
 * pass 3000, goal 5500. Every sentence matches exactly one W209 lexicon
 * pattern; the goal sentence's exclamation is the emphasis-0.4 evidence.
 */
const COMMENTARY_WINDOWS: ReadonlyArray<{ startMs: number; endMs: number; text: string }> = [
  { startMs: 500, endMs: 1_000, text: "And we kick off here at the stadium." },
  { startMs: 3_000, endMs: 3_500, text: "Mane plays a lovely pass to Salah." },
  { startMs: 5_500, endMs: 6_000, text: "Salah scores for Liverpool!" },
];
/** The asrConfidence carried on every transcription unit. */
const ASR_CONFIDENCE = 0.95;

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
 * kickoff (pattern strength 0.9, no subject, emphasis 0):
 * 0.45 + 0.12 + 0.2 = 0.77; pass (strength 0.7, two subjects, emphasis 0):
 * 0.35 + 0.3 + 0.2 = 0.85; goal (strength 0.9, two subjects, emphasis 0.4
 * from the exclamation): 0.45 + 0.3 + 0.16 = 0.91.
 */
const EXPECTED_CANDIDATES: ReadonlyArray<{
  type: string;
  phrase: string;
  confidence: number;
  timeMs: number;
}> = [
  { type: "kickoff", phrase: "kick off", confidence: 0.77, timeMs: 500 },
  { type: "pass", phrase: "pass", confidence: 0.85, timeMs: 3_000 },
  { type: "goal", phrase: "scores", confidence: 0.91, timeMs: 5_500 },
];

// --- Section 3 — the fusion waves + the slot-adapter cost ------------------

/** Vision frames per wave: 6 (0..1000 ms), then 5 x 5. */
const WAVE_UPSERTS: readonly number[] = [24, 20, 20, 20, 20, 20];
/** Per-wave applied events: kickoff; —; pass; —; —; goal. */
const WAVE_EVENTS: readonly number[] = [1, 0, 1, 0, 0, 1];
/** Per-wave dedups: re-deriving the earlier candidates throws DuplicateEventError. */
const WAVE_DEDUPS: readonly number[] = [0, 1, 1, 2, 2, 2];
/** Per-wave clock patches: no fulltime candidate exists in this story. */
const WAVE_CLOCK_PATCHES: readonly number[] = [0, 0, 0, 0, 0, 0];
/** Per-wave possession updates: the confidence moves every wave (gap shrinks). */
const WAVE_POSSESSIONS: readonly number[] = [1, 1, 1, 1, 1, 1];
/**
 * Per-wave snapshot version (genesis 1; +1 per fusion upsert, event, and
 * possession set) — the FUSION-only arithmetic, before any adapter upsert:
 * 1+24+1+1=27; +20+1=48; +20+1+1=70; +20+1=91; +20+1=112; +20+1+1=134.
 */
const WAVE_REPORT_VERSIONS: readonly number[] = [27, 48, 70, 91, 112, 134];
/** Snapshot version after the WHOLE story + the one-time slot-adapter pass. */
const FINAL_SNAPSHOT_VERSION = 134 + 4; // 138
/** Entity version at the last pin (31 frame upserts) + one adapter upsert. */
const FINAL_ENTITY_VERSION = 31 + 1; // 32

/** Entity versions at each pin: frames-so-far upserts per entity. */
const PIN_ENTITY_VERSIONS: readonly number[] = [6, 11, 16, 21, 26, 31];

/** Watermarks at each pin: the boundary time and the event-log high-water. */
const PIN_WATERMARKS: ReadonlyArray<{ watermarkMs: number; sequence: number }> = [
  { watermarkMs: 1_000, sequence: 1 },
  { watermarkMs: 2_000, sequence: 1 },
  { watermarkMs: 3_000, sequence: 2 },
  { watermarkMs: 4_000, sequence: 2 },
  { watermarkMs: 5_000, sequence: 2 },
  { watermarkMs: 6_000, sequence: 3 },
];

/**
 * HAND-DERIVED possession confidences: the ball track confidence 0.9 times
 * the winner t2's track confidence 0.9 times (1 - distance / 2) with the
 * distance 1.5 - 0.5t at the step interpolation parameters t = 1/6 .. 1:
 * 0.81 * (1 - (1.5 - 0.5t) / 2) = 0.23625, 0.27, 0.30375, 0.3375, 0.37125,
 * 0.405.
 */
const PIN_POSSESSION_CONFIDENCES: readonly number[] = WAVE_BOUNDARIES_MS.map(
  (_, index) => 0.81 * (1 - (1.5 - (0.5 * (index + 1)) / 6) / 2),
);

/** The striker's hand-derived pitch position at each pin (the lane law). */
const STRIKER_PIN_POSITIONS: ReadonlyArray<{ x: number; y: number }> = WAVE_BOUNDARIES_MS.map(
  (_, index) => ({
    x: 42 + (15.75 * (index + 1)) / 6,
    y: 30.6 + (3.4 * (index + 1)) / 6,
  }),
);
/** The winger's and the ball's hand-derived positions (same X, gap above). */
const WINGER_PIN_POSITIONS: ReadonlyArray<{ x: number; y: number }> = WAVE_BOUNDARIES_MS.map(
  (_, index) => ({
    x: 47.25 + (5.25 * (index + 1)) / 6,
    y: 35.5 - (0.5 * (index + 1)) / 6,
  }),
);
const BALL_PIN_POSITIONS: ReadonlyArray<{ x: number; y: number }> = WAVE_BOUNDARIES_MS.map(
  (_, index) => ({ x: 47.25 + (5.25 * (index + 1)) / 6, y: 34 }),
);

// --- Totals -----------------------------------------------------------------

const AUDIO_OBSERVATION_COUNT = COMMENTARY_WINDOWS.length; // 3
const CANDIDATE_OBSERVATION_COUNT = EXPECTED_CANDIDATES.length; // 3
const TOTAL_OBSERVATION_COUNT =
  VISION_OBSERVATION_COUNT + AUDIO_OBSERVATION_COUNT + CANDIDATE_OBSERVATION_COUNT; // 130

// --- Section 5 — clip + metrics pins ----------------------------------------

/** The clip style identity (flows into the manifest and the segment id). */
const CLIP_STYLE_ID = "style-m3-e2e";
const CLIP_CONFIG_SCHEMA_VERSION = "1.0";
/** The clip spans the six steps: start 1000, 1 fps, duration 6000 ms. */
const CLIP_START_MS = 1_000;
const CLIP_FRAME_INTERVAL_MS = 1_000;
const CLIP_DURATION_MS = 6_000;
const CLIP_FRAME_COUNT = 6;
/** The final event-log watermark after the whole story. */
const FINAL_EVENT_SEQUENCE = 3;

/**
 * HAND-DERIVED SVG positions (canvas = MARGIN 60 + SCALE 10 x meters, then
 * the renderer's round2 serialization): the striker's X 480 + 26.25i and Y
 * 366 + 17i/3; the ball/winger X 532.5 + 8.75i; the winger Y 415 - 5i/6.
 */
const STRIKER_SVG_X: readonly number[] = [506.25, 532.5, 558.75, 585, 611.25, 637.5];
const STRIKER_SVG_Y: readonly number[] = [371.67, 377.33, 383, 388.67, 394.33, 400];
const BALL_SVG_X: readonly number[] = [541.25, 550, 558.75, 567.5, 576.25, 585];
const WINGER_SVG_Y: readonly number[] = [414.17, 413.33, 412.5, 411.67, 410.83, 410];

/**
 * The W503 geometry pins, hand-derived from the lane law: the striker's
 * per-second displacement is hypot(15.75/6, 3.4/6) = hypot(2.625, 0.5667)
 * = 2.6854675777 m (a 2.6855 m/s sprint — comfortably below the 12.5 m/s
 * player ceiling); the bound is 12.5 * 1 + 0.01 = 12.51, so the ratio is
 * hypot(2.625, 3.4 / 6) / 12.51 = 0.21466567... The ball's 0.875 m/s step
 * over the 40.01 m/s bound gives 0.875 / 40.01 = 0.02186953...
 */
const STRIKER_STEP_DISPLACEMENT = Math.hypot(2.625, 3.4 / 6);
const STRIKER_STEP_RATIO = STRIKER_STEP_DISPLACEMENT / 12.51;
const BALL_STEP_RATIO = 0.875 / 40.01;

/** W502 caption phrases for the story's three events (the fixed table). */
const KICKOFF_CAPTION = { sequence: 1, eventId: "fe-ceu-ec-1", phrase: "Kick-off" };
const PASS_CAPTION = { sequence: 2, eventId: "fe-ceu-ec-2", phrase: "Pass" };
const GOAL_CAPTION = { sequence: 3, eventId: "fe-ceu-ec-3", phrase: "GOAL!" };

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
    asrConfidence: ASR_CONFIDENCE,
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
    score: { home: 0, away: 0, status: { status: "unknown" } },
    possession: { status: "unknown" },
    eventTaxonomyVersion: "v1",
  };
}

/**
 * THE DEMO-AUTHORED SLOT ADAPTER (see the header's seam-gap note): copies
 * the fusion-written `position` slot VERBATIM — same status, value, and
 * confidence — under the renderer-documented `pitchPosition` key. Pure.
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

/** One HTTP call, parsed as JSON. */
async function callJson<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T; headers: Headers }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as T;
  return { status: response.status, body, headers: response.headers };
}

/** POST-JSON helper. */
function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  };
}

/** Error body shape returned by every non-2xx response. */
interface ErrorBody {
  error: { failureClass: string; message: string; details?: Record<string, unknown> };
}

/** A render envelope answered by POST /v1/sessions/:id/renders. */
interface RenderResponse {
  renderId: string;
  result: RenderResult;
}

/** The playback document shape answered by GET …/outputs/:segmentId. */
interface PlaybackDocument {
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentType: string;
  byteLength: number;
  contentHash: string;
  content: string;
  /** The encoded-segment container manifest (the W504 `AnimeSegmentManifest`). */
  manifest: EncodedAnimeSegment["manifest"];
}

/** The playback list shape answered by GET …/outputs. */
interface PlaybackList {
  sessionId: string;
  renderId: string;
  segments: Array<{
    segmentId: string;
    contentType: string;
    byteLength: number;
    contentHash: string;
  }>;
}

/** The renderer capability projection of GET /v1/renderers. */
interface RendererList {
  renderers: Array<{ rendererId: string; rendererVersion: string; rendererClass: string }>;
}

/** Everything the G4 story produces (consumed by the assertions). */
interface G4DemoArtifacts {
  readonly authorizedPolicy: AuthorizationPolicy;
  readonly deniedPolicy: AuthorizationPolicy;
  readonly expiredPolicy: AuthorizationPolicy;
  readonly authorizedSession: MediaSession;
  readonly ingestingSession: MediaSession;
  readonly sessionId: string;
  readonly expiredStatus: number;
  readonly expiredFailureClass: string;
  readonly renderers: RendererList["renderers"];
  readonly units: CommentaryUnit[];
  readonly candidates: EventCandidate[];
  readonly visionObservations: Observation[];
  readonly audioObservations: Observation[];
  readonly candidateObservations: Observation[];
  readonly storeCount: number;
  readonly duplicateAppend: string;
  readonly waveReports: readonly FusionReport[];
  readonly refusion: FusionReport;
  readonly pins: readonly WorldSnapshot[];
  readonly rawPins: readonly WorldSnapshot[];
  readonly engineSnapshotVersion: number;
  readonly engineEntityVersions: number[];
  readonly engineSlotKeys: string[];
  readonly conformance: ConformanceReport;
  readonly referenceRender: RenderResponse;
  readonly animeRender: RenderResponse;
  readonly equivalentOutput: AnimeRenderOutput;
  readonly rawClipManifest: AnimeClipManifest;
  readonly clip: AnimeRenderOutput;
  readonly report: TemporalConsistencyReport;
  readonly segment: EncodedAnimeSegment;
  readonly stored: PipelineStoreResult;
  readonly duplicateStore: PipelineStoreResult;
  readonly stats: PipelineStats;
  readonly locations: AnimeRefLocation[][];
  readonly listOutputs: PlaybackList;
  readonly playback: PlaybackDocument;
  readonly secondPlaybackContent: string;
  readonly denial: {
    deniedSessionId: string;
    renderStatus: number;
    renderId: string;
    listStatus: number;
    listFailureClass: string;
    getStatus: number;
    getFailureClass: string;
  };
}

/**
 * The whole G4 demo — a fresh control server (real `Bun.serve` on port 0,
 * REAL `fetch`), a fresh output pipeline, and fresh story objects on every
 * call. Pure pipeline code: no assertions, no RNG, no clock reads. Called
 * twice by the test; the second call exists ONLY for the determinism proof.
 */
async function runG4Demo(): Promise<G4DemoArtifacts> {
  const pipeline = createAnimeOutputPipeline();
  const worldModel: { sessionId?: string; engine?: WorldModelEngine } = {};
  const lines: string[] = [];
  const registry = new RendererRegistry();
  registry.register(createTestCardRenderer()); // the W501 reference renderer
  registry.register(createAnimePrototypeRenderer()); // the REAL W502 plugin
  const server = createControlServer({
    port: 0,
    observability: {
      logger: createLogger({ sink: (line) => lines.push(line), now: () => TEST_EPOCH_MS }),
      metrics: new MetricsRegistry(),
    },
    nowMs: () => TEST_EPOCH_MS,
    rendererRegistry: registry,
    renderOutputStore: pipeline,
    // The story engine is injected through the documented W701 factory seam
    // for THE story session; any other session gets the app's default fresh
    // engine (the denied session's render renders an empty genesis world).
    worldModelFactory: (sessionId: string) => {
      if (worldModel.sessionId === sessionId && worldModel.engine !== undefined) {
        return worldModel.engine;
      }
      return WorldModelEngine.create(sessionId, { now: () => TEST_EPOCH_MS });
    },
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    // -----------------------------------------------------------------------
    // Section 1 — rights + sessions (fail-closed on both planes).
    // -----------------------------------------------------------------------
    const authorizedPolicy = buildAuthorizationPolicy(
      { policyId: POLICY_ID, allowedOperations: [...AUTHORIZED_OPERATIONS] },
      E2E_SEED,
    );
    const deniedPolicy = buildAuthorizationPolicy(
      { policyId: "policy-m3-e2e-denied", allowedOperations: ["analysis", "transformation"] },
      E2E_SEED,
    );
    const expiredPolicy = buildAuthorizationPolicy(
      {
        policyId: "policy-m3-e2e-expired",
        allowedOperations: [...AUTHORIZED_OPERATIONS],
        expiresAtIso: "2025-01-06T12:00:00.000Z", // exactly the test epoch
      },
      E2E_SEED,
    );

    const created = await callJson<{
      session: MediaSession;
      rightsCapabilities: { canStoreDerivatives: boolean };
    }>(baseUrl, "/v1/sessions", postJson({ authorizationPolicy: authorizedPolicy }));
    if (created.status !== 200) throw new Error("authorized createSession failed");
    const sessionId = created.body.session.sessionId;
    worldModel.sessionId = sessionId;

    const expired = await callJson<ErrorBody>(
      baseUrl,
      "/v1/sessions",
      postJson({ authorizationPolicy: expiredPolicy }),
    );

    // The local W004 lifecycle posture for the same session id (the m1/m2
    // demo pattern): created -> authorized -> ingesting.
    const localSession = buildMediaSession(
      {
        sessionId,
        authorizationPolicyId: authorizedPolicy.policyId,
        sources: [
          {
            sourceId: SOURCE_ID,
            kind: "file",
            container: "mp4",
            videoStreams: 1,
            audioStreams: 1,
            durationMs: 60_000,
            declaredRightsPolicyId: authorizedPolicy.policyId,
          },
        ],
      },
      E2E_SEED,
    );
    const lifecycle = new SessionLifecycle({ now: () => new Date(TEST_EPOCH_MS) });
    const authorizedSession = lifecycle.transition(localSession, "authorized", {
      policy: authorizedPolicy,
    });
    const ingestingSession = lifecycle.transition(authorizedSession, "ingesting");

    // -----------------------------------------------------------------------
    // Section 2 — the observation stream (real M1 seams, one timeline).
    // -----------------------------------------------------------------------
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
      sessionId,
      componentId: SPATIAL_COMPONENT_ID,
      series: spatialSeries,
    });

    const units = transcriptUnits();
    const audioObservations = emitTranscriptionObservations({
      sessionId,
      componentId: ASR_COMPONENT_ID,
      units,
    });
    const commentaryUnits = segmentCommentary(units);
    const candidates = extractEventCandidates({
      units: commentaryUnits,
      lexicon: COMMENTARY_LEXICON,
    });
    const candidateObservations = emitEventCandidateObservations({
      sessionId,
      componentId: COMMENTARY_COMPONENT_ID,
      candidates,
    });

    // -----------------------------------------------------------------------
    // Section 3 — six fusion waves over ONE store into ONE engine, with the
    // per-step stateAt/eventWindow captures (the streaming posture).
    // -----------------------------------------------------------------------
    const store = new InMemoryObservationStore();
    const engine = WorldModelEngine.create(sessionId, {
      football: makeFootballInit(),
      now: () => TEST_EPOCH_MS,
    });
    worldModel.engine = engine;

    const allObservations = [...visionObservations, ...audioObservations, ...candidateObservations];
    const waveReports: FusionReport[] = [];
    const pins: WorldSnapshot[] = [];
    const rawPins: WorldSnapshot[] = [];
    const steps: AnimeClipStep[] = [];
    const rawSteps: AnimeClipStep[] = [];
    for (let wave = 0; wave < WAVE_BOUNDARIES_MS.length; wave += 1) {
      const throughMs = WAVE_BOUNDARIES_MS[wave]!;
      const afterMs = wave === 0 ? -1 : WAVE_BOUNDARIES_MS[wave - 1]!;
      for (const observation of allObservations) {
        if (observation.eventTimeMs > afterMs && observation.eventTimeMs <= throughMs) {
          store.append(observation);
        }
      }
      waveReports.push(runWorldFusion({ store, engine, sessionId }));

      // The step's snapshot, captured WHILE the stream is only fused that
      // far: raw (gap evidence) and adapted (renderer-consumable).
      const rawSnapshot = stateAt(engine, throughMs).snapshot;
      rawPins.push(rawSnapshot);
      pins.push(adaptSnapshotForRenderer(rawSnapshot));

      // The step's caption window (prev, at] — EXCLUSIVE lower bound so a
      // boundary event attributes to exactly one step (the W502/W503
      // fixture convention; eventWindow itself is inclusive, hence +1).
      const fromMs = wave === 0 ? 0 : WAVE_BOUNDARIES_MS[wave - 1]! + 1;
      const events = eventWindow(engine.eventsSince(0), { fromMs, toMs: throughMs });
      steps.push({ atMs: throughMs, snapshot: pins[pins.length - 1]!, events });
      rawSteps.push({ atMs: throughMs, snapshot: rawSnapshot, events });
    }
    const storeCount = store.count();
    const duplicateAppend = store.append(
      byObservationId(visionObservations, "sp-f-0-0-t1"),
    ) as string;

    // The idempotent re-fusion over the unchanged store (the W401 evidence).
    const refusion = runWorldFusion({ store, engine, sessionId });

    // The one-time ENGINE slot adapter (the seam-gap bridge for the control
    // plane's own renders): re-upsert every entity with `pitchPosition`
    // copied verbatim from `position`, through the PUBLIC upsert seam.
    for (const entity of engine.snapshot().entities) {
      const position = entity.state.position;
      if (position === undefined) continue;
      engine.upsertEntity({
        ...entity,
        state: { ...entity.state, pitchPosition: position },
      });
    }
    const engineSnapshot = engine.snapshot();
    const engineEntityVersions = engineSnapshot.entities.map((entity) => entity.version);
    const engineSlotKeys = Object.keys(engineSnapshot.entities[0]!.state);

    // -----------------------------------------------------------------------
    // Section 4 — the two renders through the REAL control plane.
    // -----------------------------------------------------------------------
    const renderers = await callJson<RendererList>(baseUrl, "/v1/renderers");
    const referenceRender = await callJson<RenderResponse>(
      baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard" }),
    );
    if (referenceRender.status !== 200) throw new Error("reference render failed");
    const animeRender = await callJson<RenderResponse>(
      baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: ANIME_RENDERER_ID }),
    );
    if (animeRender.status !== 200) throw new Error("anime render failed");

    // The host-side EQUIVALENT of the app's r-2 render — the app's exact
    // request parameters (style `default`, the plugin's first supported
    // profile, the engine's snapshot version, the snapshot watermark's
    // sequence as the event tail, the derived capabilities, the frozen
    // clock) — for the deep-equal proof (the W504 e2e pattern).
    const equivalentRequest: RenderRequest = {
      sessionId,
      schemaVersion: SCHEMA_VERSION,
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: ANIME_RENDERER_VERSION,
      styleConfig: { styleId: "default", configSchemaVersion: SCHEMA_VERSION, config: {} },
      snapshotVersion: engine.snapshotVersion,
      eventsSinceSequence: engineSnapshot.watermark.sequence,
      outputProfile: ANIME_OUTPUT_PROFILE,
      rightsCapabilities: deriveRightsCapabilities(authorizedPolicy, new Date(TEST_EPOCH_MS)),
      sourceFrameRefs: [],
    };
    const equivalentOutput = renderAnimeFromSnapshot(equivalentRequest, {
      snapshot: engineSnapshot,
      events: engine.eventsSince(engineSnapshot.watermark.sequence),
    });

    // The 13-check W501 conformance harness on a FRESH plugin instance.
    const conformance = runConformance(createAnimePrototypeRenderer());

    // -----------------------------------------------------------------------
    // Section 5 — the clip renders (gap evidence + the story clip).
    // -----------------------------------------------------------------------
    const clipRequest: RenderRequest = {
      sessionId,
      schemaVersion: SCHEMA_VERSION,
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: ANIME_RENDERER_VERSION,
      styleConfig: {
        styleId: CLIP_STYLE_ID,
        configSchemaVersion: CLIP_CONFIG_SCHEMA_VERSION,
        config: {},
      },
      snapshotVersion: engine.snapshotVersion,
      eventsSinceSequence: engineSnapshot.watermark.sequence,
      outputProfile: ANIME_OUTPUT_PROFILE,
      rightsCapabilities: deriveRightsCapabilities(authorizedPolicy, new Date(TEST_EPOCH_MS)),
      sourceFrameRefs: [],
    };
    // The RAW steps first: the un-bridged fusion snapshots (the seam gap,
    // measured — the renderer accounts every entity as omitted, never
    // inventing a position).
    const rawClip = renderAnimeClip(clipRequest, rawSteps);
    // The story clip: the six adapted steps through the real W502 clip path.
    const clip = renderAnimeClip(clipRequest, steps);

    // -----------------------------------------------------------------------
    // Section 6 — the fixture metrics (W503 over the clip + frames).
    // -----------------------------------------------------------------------
    const report = evaluateRenderOutput(clip);

    // -----------------------------------------------------------------------
    // Section 7 — encode -> store -> locate -> playback (W504, end to end).
    // -----------------------------------------------------------------------
    const segment = encodeAnimeClip(clip);
    const stored = pipeline.encodeAndStore({
      sessionId,
      renderId: animeRender.body.renderId,
      output: clip,
    });
    const duplicateStore = pipeline.encodeAndStore({
      sessionId,
      renderId: animeRender.body.renderId,
      output: clip,
    });
    const stats = pipeline.stats();
    const locations = clip.result.outputSegments.map((seg) =>
      pipeline.locateAnimeRef({
        ref: seg.artifactRef,
        policy: authorizedPolicy,
        nowMs: TEST_EPOCH_MS,
        renderId: animeRender.body.renderId,
      }),
    );
    const listOutputs = await callJson<PlaybackList>(
      baseUrl,
      `/v1/sessions/${sessionId}/renders/${animeRender.body.renderId}/outputs`,
    );
    if (listOutputs.status !== 200) throw new Error("outputs list failed");
    const playback = await callJson<PlaybackDocument>(
      baseUrl,
      `/v1/sessions/${sessionId}/renders/${animeRender.body.renderId}/outputs/${stored.segmentId}`,
    );
    if (playback.status !== 200) throw new Error("playback fetch failed");
    const secondPlayback = await callJson<PlaybackDocument>(
      baseUrl,
      `/v1/sessions/${sessionId}/renders/${animeRender.body.renderId}/outputs/${stored.segmentId}`,
    );

    // The rights-denial leg: rendering is compute (allowed without storage
    // rights); playback denies on BOTH routes before any byte is revealed.
    const deniedSession = await callJson<{ session: MediaSession }>(
      baseUrl,
      "/v1/sessions",
      postJson({ authorizationPolicy: deniedPolicy }),
    );
    if (deniedSession.status !== 200) throw new Error("denied createSession failed");
    const deniedRender = await callJson<RenderResponse>(
      baseUrl,
      `/v1/sessions/${deniedSession.body.session.sessionId}/renders`,
      postJson({ rendererId: ANIME_RENDERER_ID }),
    );
    if (deniedRender.status !== 200) throw new Error("denied render failed");
    const deniedList = await callJson<ErrorBody>(
      baseUrl,
      `/v1/sessions/${deniedSession.body.session.sessionId}/renders/${deniedRender.body.renderId}/outputs`,
    );
    const deniedGet = await callJson<ErrorBody>(
      baseUrl,
      `/v1/sessions/${deniedSession.body.session.sessionId}/renders/${deniedRender.body.renderId}/outputs/${stored.segmentId}`,
    );

    return {
      authorizedPolicy,
      deniedPolicy,
      expiredPolicy,
      authorizedSession,
      ingestingSession,
      sessionId,
      expiredStatus: expired.status,
      expiredFailureClass: expired.body.error.failureClass,
      renderers: renderers.body.renderers,
      units: commentaryUnits,
      candidates,
      visionObservations,
      audioObservations,
      candidateObservations,
      storeCount,
      duplicateAppend,
      waveReports,
      refusion,
      pins,
      rawPins,
      engineSnapshotVersion: engine.snapshotVersion,
      engineEntityVersions,
      engineSlotKeys,
      conformance,
      referenceRender: referenceRender.body,
      animeRender: animeRender.body,
      equivalentOutput,
      rawClipManifest: rawClip.manifest,
      clip,
      report,
      segment,
      stored,
      duplicateStore,
      stats,
      locations,
      listOutputs: listOutputs.body,
      playback: playback.body,
      secondPlaybackContent: secondPlayback.body.content,
      denial: {
        deniedSessionId: deniedSession.body.session.sessionId,
        renderStatus: deniedRender.status,
        renderId: deniedRender.body.renderId,
        listStatus: deniedList.status,
        listFailureClass: deniedList.body.error.failureClass,
        getStatus: deniedGet.status,
        getFailureClass: deniedGet.body.error.failureClass,
      },
    };
  } finally {
    server.stop(true);
  }
}

/** Serializes every data artifact of one run (the determinism comparison). */
function serializeRun(run: G4DemoArtifacts): string {
  return JSON.stringify({
    sessionId: run.sessionId,
    authorizedSession: run.authorizedSession,
    ingestingSession: run.ingestingSession,
    expiredStatus: run.expiredStatus,
    expiredFailureClass: run.expiredFailureClass,
    renderers: run.renderers,
    units: run.units,
    candidates: run.candidates,
    visionObservations: run.visionObservations,
    audioObservations: run.audioObservations,
    candidateObservations: run.candidateObservations,
    storeCount: run.storeCount,
    duplicateAppend: run.duplicateAppend,
    waveReports: run.waveReports,
    refusion: run.refusion,
    pins: run.pins,
    rawPins: run.rawPins,
    engineSnapshotVersion: run.engineSnapshotVersion,
    engineEntityVersions: run.engineEntityVersions,
    engineSlotKeys: run.engineSlotKeys,
    conformance: run.conformance,
    referenceRender: run.referenceRender,
    animeRender: run.animeRender,
    equivalentOutput: run.equivalentOutput,
    rawClipManifest: run.rawClipManifest,
    clip: run.clip,
    report: run.report,
    segment: run.segment,
    stored: run.stored,
    duplicateStore: run.duplicateStore,
    stats: run.stats,
    locations: run.locations,
    listOutputs: run.listOutputs,
    playback: run.playback,
    secondPlaybackContent: run.secondPlaybackContent,
    denial: run.denial,
  });
}

describe("M3 rendering e2e: authorized clip -> SWM -> reference + anime renders -> metrics -> playback", () => {
  test("the G4 exit demo: one clip through the full M3 chain with measurable temporal consistency", async () => {
    const run1 = await runG4Demo();

    // -----------------------------------------------------------------------
    // Section 1 — rights + sessions (fail-closed on both planes).
    // -----------------------------------------------------------------------

    expect(run1.authorizedPolicy.policyId).toBe(POLICY_ID);
    expect(run1.authorizedPolicy.allowedOperations).toEqual([...AUTHORIZED_OPERATIONS]);

    // The fail-closed derivation: storage capabilities need BOTH
    // derivativeGeneration AND storage (contracts rights.ts).
    const caps = deriveRightsCapabilities(run1.authorizedPolicy, new Date(TEST_EPOCH_MS));
    expect(caps.canStoreDerivatives).toBe(true);
    expect(caps.canReferenceSourceFrames).toBe(true);
    expect(caps.canDeliverLive).toBe(false);
    expect(caps.canShare).toBe(false);
    // The denied policy renders but can never store derivatives.
    expect(
      deriveRightsCapabilities(run1.deniedPolicy, new Date(TEST_EPOCH_MS)).canStoreDerivatives,
    ).toBe(false);

    // The control plane session (the deterministic first id on a fresh app).
    expect(run1.sessionId).toBe(SESSION_ID);
    expect(run1.authorizedSession.status).toBe("authorized");
    expect(run1.ingestingSession.status).toBe("ingesting");
    expect(run1.ingestingSession.processingState.stage).toBe("ingesting");
    expect(run1.ingestingSession.sessionId).toBe(SESSION_ID);

    // Fail-closed at the control plane: an expired policy derives NOTHING,
    // so session creation itself is refused (deny, never a crippled session).
    expect(run1.expiredStatus).toBe(403);
    expect(run1.expiredFailureClass).toBe("rights-denied");

    // Fail-closed at the W004 lifecycle boundary (the m1/m2 posture): with
    // no policy presented, authorization DENIES and the session is not
    // advanced (architecture-lock §11).
    expect(() =>
      new SessionLifecycle({ now: () => new Date(TEST_EPOCH_MS) }).transition(
        buildMediaSession(
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
        ),
        "authorized",
      ),
    ).toThrow(RightsDeniedError);

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
      // participants and the BALL (the ball rides the same chain so the
      // whole stream is pitch-framed for W401 fusion).
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

    // The shared 200 ms grid: 31 distinct times 0, 200, ..., 6000.
    const visionTimes = run1.visionObservations.map((o) => o.eventTimeMs);
    const distinctTimes: number[] = [];
    for (const time of visionTimes) {
      if (distinctTimes[distinctTimes.length - 1] !== time) distinctTimes.push(time);
    }
    expect(distinctTimes).toEqual(
      Array.from({ length: FRAME_COUNT }, (_, frame) => frame * FRAME_MS),
    );

    // Hand-derived projections pin the geometry to the documented W203
    // camera model (X = 26.25 + 52.5u, Y = 17 + 34v): the striker's frame-0
    // center (0.30, 0.40) -> (42, 30.6); its frame-30 center (0.60, 0.50)
    // -> (57.75, 34); the ball and the winger at frame 30 share X = 52.5
    // and sit EXACTLY 1 meter apart in Y (the possession-gap design).
    const strikerOrigin = byObservationId(run1.visionObservations, "sp-f-0-0-t1");
    expect(trackPayloadOf(strikerOrigin).position.x).toBeCloseTo(42, 9);
    expect(trackPayloadOf(strikerOrigin).position.y).toBeCloseTo(30.6, 9);
    const strikerEnd = byObservationId(run1.visionObservations, "sp-f-0-30-t1");
    expect(trackPayloadOf(strikerEnd).position.x).toBeCloseTo(57.75, 9);
    expect(trackPayloadOf(strikerEnd).position.y).toBeCloseTo(34, 9);
    const ballEnd = byObservationId(run1.visionObservations, "sp-f-0-30-t4");
    const wingerEnd = byObservationId(run1.visionObservations, "sp-f-0-30-t2");
    expect(trackPayloadOf(ballEnd).position.x).toBeCloseTo(52.5, 9);
    expect(trackPayloadOf(ballEnd).position.y).toBeCloseTo(34, 9);
    expect(trackPayloadOf(wingerEnd).position.x).toBeCloseTo(52.5, 9);
    expect(trackPayloadOf(wingerEnd).position.y).toBeCloseTo(35, 9);
    expect(trackPayloadOf(wingerEnd).position.y - trackPayloadOf(ballEnd).position.y).toBeCloseTo(
      1,
      9,
    );

    // AUDIO: the raw STT stream — OBSERVED provenance (W207), one unit each.
    expect(run1.audioObservations).toHaveLength(AUDIO_OBSERVATION_COUNT);
    run1.audioObservations.forEach((observation, index) => {
      expect(ObservationSchema.safeParse(observation).success).toBe(true);
      expect(observation.observationId).toBe(`stt-tu-${index}`);
      expect(observation.sessionId).toBe(SESSION_ID);
      expect(observation.modality).toBe("audio");
      expect(observation.provenance).toBe("OBSERVED");
      expect(observation.confidence).toBe(ASR_CONFIDENCE);
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
      expect(candidate.candidateId).toBe(`ec-${index + 1}`);
      expect(candidate.eventPhrase).toBe(expected.phrase);
      expect(candidate.eventTimeMs).toBe(expected.timeMs);
      // The hand-derived W209 formula value (see EXPECTED_CANDIDATES).
      expect(candidate.confidence).toBeCloseTo(expected.confidence, 10);
    });

    // The goal candidate: Salah the agent, Liverpool an unspecified team
    // mention, emphasis exactly the exclamation weight 0.4.
    const goalCandidate = candidates[2]!;
    expect(goalCandidate.subjects).toEqual([
      { name: "Salah", role: "agent", nameConfidence: 1 },
      { name: "Liverpool", role: "unspecified", nameConfidence: 1 },
    ]);
    expect(goalCandidate.emphasis).toBe(0.4);
    // The kickoff sentence named NO lexicon entity (the 0.4 subject factor).
    expect(candidates[0]!.subjects).toEqual([]);

    // W209 emission: one contract observation per candidate — commentary
    // modality, DERIVED, no entity claims, confidence = the candidate's.
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

    // ONE store holds the whole evidence stream: 124 vision + 3 audio + 3
    // candidate observations; re-delivering any record is the idempotent
    // duplicate no-op (duplicate tolerance per the streaming contract).
    expect(run1.storeCount).toBe(TOTAL_OBSERVATION_COUNT);
    expect(run1.duplicateAppend).toBe("duplicate");

    // -----------------------------------------------------------------------
    // Section 3 — six fusion waves: report counters + stateAt pins.
    // -----------------------------------------------------------------------

    const reports = run1.waveReports;
    expect(reports).toHaveLength(WAVE_BOUNDARIES_MS.length);
    expect(reports.map((report) => report.entitiesUpserted)).toEqual([...WAVE_UPSERTS]);
    expect(reports.map((report) => report.eventsApplied)).toEqual([...WAVE_EVENTS]);
    expect(reports.map((report) => report.eventsDeduplicated)).toEqual([...WAVE_DEDUPS]);
    expect(reports.map((report) => report.clockPatches)).toEqual([...WAVE_CLOCK_PATCHES]);
    expect(reports.map((report) => report.possessionUpdates)).toEqual([...WAVE_POSSESSIONS]);
    // The conflict ledger stays EMPTY in this fixture: one clear possession
    // winner per wave, and no period-establishing candidate exists.
    expect(reports.every((report) => report.conflicts.length === 0)).toBe(true);
    expect(reports.every((report) => report.warnings.length === 0)).toBe(true);
    // The engine's snapshot version after each wave (fusion-only arithmetic).
    expect(reports.map((report) => report.snapshotVersionAfter)).toEqual([...WAVE_REPORT_VERSIONS]);

    // The idempotent re-fusion (the W401 evidence): NOTHING is re-applied —
    // 0 upserts, 0 events, the 3 candidates counted as dedups, 0 possession
    // updates (the same value is a no-op), and the version is untouched.
    expect(run1.refusion.entitiesUpserted).toBe(0);
    expect(run1.refusion.eventsApplied).toBe(0);
    expect(run1.refusion.eventsDeduplicated).toBe(3);
    expect(run1.refusion.clockPatches).toBe(0);
    expect(run1.refusion.possessionUpdates).toBe(0);
    expect(run1.refusion.snapshotVersionAfter).toBe(WAVE_REPORT_VERSIONS[5]);

    // THE SEAM GAP, MEASURED (not just documented): the raw fused snapshots
    // carry the fusion slot `position` (+ spatialFrame/lastSeenMs) and NO
    // `pitchPosition` key — the slot the anime renderer documents and reads.
    for (const rawPin of run1.rawPins) {
      expect(rawPin.entities).toHaveLength(SPECS.length);
      for (const entity of rawPin.entities) {
        expect(entity.state.position?.status).toBe("uncertain");
        expect("pitchPosition" in entity.state).toBe(false);
      }
    }

    const pins = run1.pins;
    expect(pins).toHaveLength(WAVE_BOUNDARIES_MS.length);
    pins.forEach((pin, wave) => {
      expect(WorldSnapshotSchema.safeParse(pin).success).toBe(true);
      expect(pin.sessionId).toBe(SESSION_ID);
      // Injected clock — never a wall-clock read.
      expect(pin.generatedAtMs).toBe(TEST_EPOCH_MS);
      expect(pin.entities.map((entity) => entity.entityId)).toEqual([...TRACK_IDS]);
      // Entity VERSION evolution: one upsert per frame per entity.
      expect(pin.entities.map((entity) => entity.version)).toEqual(
        Array.from({ length: SPECS.length }, () => PIN_ENTITY_VERSIONS[wave]!),
      );
      // The watermark: the entities' frame time and the event log's
      // sequence high-water (1 after kickoff; 2 after the pass; 3 at the end).
      expect(pin.watermark).toEqual(PIN_WATERMARKS[wave]);
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
        expect(entity.lastEventTimeMs).toBe(WAVE_BOUNDARIES_MS[wave]);
        expect(entity.kind).toBe(ENTITY_KINDS[TRACK_IDS.indexOf(entity.entityId)]);
        // THE ADAPTER IS VALUE-IDENTICAL: the pitchPosition slot the renderer
        // reads carries the fusion position verbatim (status, value,
        // confidence) — the bridge copies, it never invents.
        expect(entity.state.pitchPosition).toEqual(entity.state.position);
      }
      // The striker's and the ball's hand-derived positions at each pin.
      const striker = pinEntity(pin, "t1");
      const strikerPosition = striker.state.position?.value as { x: number; y: number };
      expect(strikerPosition.x).toBeCloseTo(STRIKER_PIN_POSITIONS[wave]!.x, 9);
      expect(strikerPosition.y).toBeCloseTo(STRIKER_PIN_POSITIONS[wave]!.y, 9);
      const ball = pinEntity(pin, "t4");
      const ballPosition = ball.state.position?.value as { x: number; y: number };
      expect(ballPosition.x).toBeCloseTo(BALL_PIN_POSITIONS[wave]!.x, 9);
      expect(ballPosition.y).toBeCloseTo(BALL_PIN_POSITIONS[wave]!.y, 9);
      const winger = pinEntity(pin, "t2");
      const wingerPosition = winger.state.position?.value as { x: number; y: number };
      expect(wingerPosition.x).toBeCloseTo(WINGER_PIN_POSITIONS[wave]!.x, 9);
      expect(wingerPosition.y).toBeCloseTo(WINGER_PIN_POSITIONS[wave]!.y, 9);
      // Possession evolution: the nearest participant (t2, always) with the
      // hand-derived product confidence that GROWS as the gap shrinks.
      expect(pin.football).toBeDefined();
      expect(pin.football?.possession?.status).toBe("uncertain");
      expect(pin.football?.possession?.value).toEqual({ entityId: "t2" });
      expect(pin.football?.possession?.confidence).toBeCloseTo(
        PIN_POSSESSION_CONFIDENCES[wave]!,
        9,
      );
      // Score honesty: untouched by this fixture, it stays UNKNOWN.
      expect(pin.football?.score).toEqual({
        home: 0,
        away: 0,
        status: { status: "unknown" },
      });
      // The football clock: first-half throughout (no fulltime candidate).
      expect(pin.football?.clock).toEqual({
        period: "first-half",
        clockMs: 0,
        stoppage: false,
      });
    });

    // The engine after the one-time slot adapter: version 134 + 4 adapter
    // upserts, every entity at 32 (31 frame upserts + 1 adapter upsert), and
    // the renderer-consumable slot present — copied verbatim.
    expect(run1.engineSnapshotVersion).toBe(FINAL_SNAPSHOT_VERSION);
    expect(run1.engineEntityVersions).toEqual(
      Array.from({ length: SPECS.length }, () => FINAL_ENTITY_VERSION),
    );
    expect(run1.engineSlotKeys).toContain("position");
    expect(run1.engineSlotKeys).toContain("pitchPosition");

    // -----------------------------------------------------------------------
    // Section 4 — the two renders through the REAL control plane.
    // -----------------------------------------------------------------------

    // The registry surface: BOTH plugins are listed, capability-driven.
    expect(run1.renderers).toHaveLength(2);
    expect(
      run1.renderers.map((r) => `${r.rendererId}@${r.rendererVersion}:${r.rendererClass}`),
    ).toEqual(["anime.prototype@0.1.0:procedural-3d", "sporta.testcard@0.1.0:tactical"]);

    // The ORIGINAL REFERENCE leg — the W501 test-card renderer over the SAME
    // request surface (same session, same fused engine snapshot, same HTTP
    // route, same validateRequest + render gates). Its result is pinned
    // exactly: a deterministic synthetic timeline of five 2 s segments
    // starting at the snapshot watermark (durationMs 10000 / segmentMs 2000
    // style defaults), opaque testcard:// refs, the R6 watermark, and the
    // reference renderer's declared temporal-consistency quality score.
    // HONESTY: this is the contract-reference BASELINE, not source pixels.
    expect(run1.referenceRender.renderId).toBe("r-1");
    expect(run1.referenceRender.result).toEqual({
      sessionId: SESSION_ID,
      rendererId: "sporta.testcard",
      outputSegments: [0, 1, 2, 3, 4].map((index) => ({
        segmentId: `tc-${index}`,
        startMs: 6_000 + index * 2_000,
        endMs: 6_000 + (index + 1) * 2_000,
        artifactRef: `testcard://${SESSION_ID}/${FINAL_SNAPSHOT_VERSION}/${index}`,
      })),
      watermarkAfter: { watermarkMs: 16_000, sequence: 3 },
      rendererHealth: { lagMs: 0, degraded: false },
      quality: { temporalConsistencyScore: 1 },
      provenance: { snapshotVersion: FINAL_SNAPSHOT_VERSION, lastEventSequence: 0 },
    });

    // The TRANSFORMED leg's control-plane record — the REAL anime plugin
    // through the same route: the contract-path render of the story's final
    // engine snapshot (6 x 1 s segments from the 6000 ms watermark, the
    // W502 opaque anime:// refs, the R6 watermark at 6000 + 6000).
    expect(run1.animeRender.renderId).toBe("r-2");
    expect(run1.animeRender.result).toEqual({
      sessionId: SESSION_ID,
      rendererId: ANIME_RENDERER_ID,
      outputSegments: [0, 1, 2, 3, 4, 5].map((index) => ({
        segmentId: `anime-${index}`,
        startMs: 6_000 + index * 1_000,
        endMs: 6_000 + (index + 1) * 1_000,
        artifactRef: `anime://${SESSION_ID}/${FINAL_SNAPSHOT_VERSION}/${index}`,
      })),
      watermarkAfter: { watermarkMs: 12_000, sequence: 3 },
      rendererHealth: { lagMs: 0, degraded: false },
      provenance: { snapshotVersion: FINAL_SNAPSHOT_VERSION, lastEventSequence: 0 },
    });

    // The deep-equal equivalence proof (the W504 e2e pattern): the host-side
    // render with the app's EXACT request parameters reproduces the HTTP
    // result — the app's request surface is fully reconstructible, and the
    // r-2 record is a real render of the SAME engine state. Its manifest
    // proves the control-plane path draws real markers (the slot bridge).
    expect(run1.equivalentOutput.result).toEqual(run1.animeRender.result);
    expect(run1.equivalentOutput.frames).toHaveLength(CLIP_FRAME_COUNT);
    expect(
      run1.equivalentOutput.manifest.frames.every((frame) =>
        frame.entities.every((entity) => entity.disposition === "rendered"),
      ),
    ).toBe(true);

    // The 13-check W501 conformance harness passes on a fresh plugin
    // instance (the rights probe honestly n/a — requiresSourceFrames false).
    expect(run1.conformance.passed).toBe(true);
    expect(run1.conformance.checks).toHaveLength(13);
    expect(run1.conformance.checks.every((check) => check.passed)).toBe(true);

    // -----------------------------------------------------------------------
    // Section 5 — the clip renders: the seam gap, then the story clip.
    // -----------------------------------------------------------------------

    // THE GAP, MEASURED: rendering the RAW fusion snapshots accounts every
    // entity as `omitted-no-position` (the renderer never invents a
    // position) and the possession ring is NOT drawn — the un-bridged M3
    // chain renders an empty pitch, honestly.
    expect(
      run1.rawClipManifest.frames.every((frame) =>
        frame.entities.every((entity) => entity.disposition === "omitted-no-position"),
      ),
    ).toBe(true);
    expect(
      run1.rawClipManifest.frames.every((frame) => frame.possession?.displayed === false),
    ).toBe(true);

    // The story clip: six frames over the six steps.
    const clip = run1.clip;
    expect(clip.frames).toHaveLength(CLIP_FRAME_COUNT);
    expect(clip.manifest.frames).toHaveLength(CLIP_FRAME_COUNT);
    expect(clip.manifest.output).toEqual({
      profile: ANIME_OUTPUT_PROFILE,
      startMs: CLIP_START_MS,
      frameIntervalMs: CLIP_FRAME_INTERVAL_MS,
      durationMs: CLIP_DURATION_MS,
    });
    expect(clip.manifest.renderer).toEqual({
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: ANIME_RENDERER_VERSION,
      styleId: CLIP_STYLE_ID,
      configSchemaVersion: CLIP_CONFIG_SCHEMA_VERSION,
    });
    expect(clip.manifest.session).toEqual({
      sessionId: SESSION_ID,
      snapshotVersion: FINAL_SNAPSHOT_VERSION,
      eventsSinceSequence: FINAL_EVENT_SEQUENCE,
    });
    expect(clip.manifest.provenance).toEqual({
      snapshotVersion: FINAL_SNAPSHOT_VERSION,
      lastEventSequence: FINAL_EVENT_SEQUENCE,
    });
    // The clip path consumes every step event; nothing is skipped; the R6
    // watermark analog is the last step + one interval at sequence 3.
    expect(clip.manifest.skippedEvents).toEqual([]);
    expect(clip.manifest.watermarkAfter).toEqual({
      watermarkMs: 7_000,
      sequence: FINAL_EVENT_SEQUENCE,
    });
    expect(clip.manifest.degradation).toEqual({ degraded: false, reasons: [] });

    // Tiled windows: [1000, 2000) ... [6000, 7000) — each frame's window
    // starts at its own output timestamp.
    expect(clip.manifest.frames.map((frame) => frame.windowMs)).toEqual(
      WAVE_BOUNDARIES_MS.map((atMs) => ({
        startMs: atMs,
        endMs: atMs + CLIP_FRAME_INTERVAL_MS,
      })),
    );

    // Per-frame provenance: each step's snapshot watermark advances with
    // the story's event log (PIN_WATERMARKS), generatedAtMs is the injected
    // clock, and every frame's football state is present.
    expect(clip.manifest.frames.map((frame) => frame.source.watermark)).toEqual([
      ...PIN_WATERMARKS,
    ]);
    expect(
      clip.manifest.frames.every((frame) => frame.source.generatedAtMs === TEST_EPOCH_MS),
    ).toBe(true);
    expect(clip.manifest.frames.every((frame) => frame.source.footballState === true)).toBe(true);

    // Event attribution: the caption windows are (prev, at] — the kickoff
    // (500) lands in step 1, the pass (3000) in step 3, the goal (5500) in
    // step 6; each event is applied and captioned EXACTLY once.
    expect(clip.manifest.frames.map((frame) => frame.appliedEventSequences)).toEqual([
      [1],
      [],
      [2],
      [],
      [],
      [3],
    ]);
    expect(clip.manifest.frames.map((frame) => frame.captions.events)).toEqual([
      [KICKOFF_CAPTION],
      [],
      [PASS_CAPTION],
      [],
      [],
      [GOAL_CAPTION],
    ]);
    expect(clip.manifest.frames.map((frame) => frame.captions.uncaptionedEvents)).toEqual(
      Array.from({ length: CLIP_FRAME_COUNT }, () => []),
    );

    // The verbatim caption band: fixed-table phrases only; the status line
    // is the period phrase + the zeroed clock (the score stays unestablished
    // — never invented).
    expect(clip.manifest.frames.map((frame) => frame.captions.statusLine)).toEqual(
      Array.from({ length: CLIP_FRAME_COUNT }, () => "First half · 00:00"),
    );
    expect(clip.manifest.frames[0]!.captions.score).toEqual({
      displayed: false,
      status: "unknown",
    });
    expect(clip.manifest.frames[0]!.captions.clockText).toBe("00:00");

    // Possession accounting per frame: the honest uncertain candidate t2,
    // the ring DISPLAYED (t2 is drawn), and the wave confidence verbatim
    // (the closed-form value; float-safe at 9 digits, the m2 convention).
    clip.manifest.frames.forEach((frame, index) => {
      expect(frame.possession?.status).toBe("uncertain");
      expect(frame.possession?.entityId).toBe("t2");
      expect(frame.possession?.displayed).toBe(true);
      expect(frame.possession?.confidence).toBeCloseTo(PIN_POSSESSION_CONFIDENCES[index]!, 9);
    });

    // EVERY snapshot entity is accounted in every frame with disposition
    // `rendered` (all four lanes stay in play), the verbatim position status
    // and confidence, and the 2-decimal canvas serialization — the visible
    // motion of the clip (the striker's 26.25 canvas units/second).
    clip.manifest.frames.forEach((frame, index) => {
      expect(frame.entities.map((entity) => entity.entityId)).toEqual([...TRACK_IDS]);
      expect(frame.entities.map((entity) => entity.disposition)).toEqual([
        "rendered",
        "rendered",
        "rendered",
        "rendered",
      ]);
      for (const entity of frame.entities) {
        expect(entity.positionStatus).toBe("uncertain");
        expect(entity.confidence).toBe(TRACK_CONFIDENCE);
        expect(entity.positionMeters).toBeDefined();
        expect(entity.svgPosition).toBeDefined();
      }
      const striker = frame.entities.find((entity) => entity.entityId === "t1")!;
      expect(striker.svgPosition!.x).toBe(STRIKER_SVG_X[index]!);
      expect(striker.svgPosition!.y).toBe(STRIKER_SVG_Y[index]!);
      expect(striker.positionMeters!.x).toBeCloseTo(STRIKER_PIN_POSITIONS[index]!.x, 9);
      expect(striker.positionMeters!.y).toBeCloseTo(STRIKER_PIN_POSITIONS[index]!.y, 9);
      const ball = frame.entities.find((entity) => entity.entityId === "t4")!;
      expect(ball.svgPosition!.x).toBe(BALL_SVG_X[index]!);
      expect(ball.svgPosition!.y).toBe(400);
      const winger = frame.entities.find((entity) => entity.entityId === "t2")!;
      expect(winger.svgPosition!.x).toBe(BALL_SVG_X[index]!);
      expect(winger.svgPosition!.y).toBe(WINGER_SVG_Y[index]!);
    });

    // The contract result's own segments: the clip path's anime-0..5 refs.
    expect(clip.result.outputSegments).toEqual(
      WAVE_BOUNDARIES_MS.map((atMs, index) => ({
        segmentId: `anime-${index}`,
        startMs: atMs,
        endMs: atMs + CLIP_FRAME_INTERVAL_MS,
        artifactRef: `anime://${SESSION_ID}/${FINAL_SNAPSHOT_VERSION}/${index}`,
      })),
    );
    expect(clip.result.watermarkAfter).toEqual({
      watermarkMs: 7_000,
      sequence: FINAL_EVENT_SEQUENCE,
    });
    expect(clip.result.provenance).toEqual({
      snapshotVersion: FINAL_SNAPSHOT_VERSION,
      lastEventSequence: FINAL_EVENT_SEQUENCE,
    });
    expect(clip.result.rendererHealth).toEqual({ lagMs: 0, degraded: false });

    // The SVG documents: the fixed W502 root tag and title, one marker
    // group per entity, the caption phrases in the band, and the possession
    // ring around t2 — deterministic serialization, pinned structurally.
    for (const [index, frame] of clip.frames.entries()) {
      expect(frame.frameIndex).toBe(index);
      expect(frame.outputTimestampMs).toBe(WAVE_BOUNDARIES_MS[index]!);
      expect(
        frame.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1170 880">'),
      ).toBe(true);
      expect(frame.svg.endsWith("</svg>")).toBe(true);
      expect(frame.svg).toContain(`<title>anime.prototype frame ${index}</title>`);
      for (const trackId of TRACK_IDS) {
        expect(frame.svg).toContain(`<g data-entity="${trackId}">`);
      }
      expect(frame.svg).toContain('r="20"'); // the possession ring
    }
    expect(clip.frames[0]!.svg).toContain(">Kick-off<");
    expect(clip.frames[2]!.svg).toContain(">Pass<");
    expect(clip.frames[5]!.svg).toContain(">GOAL!<");

    // -----------------------------------------------------------------------
    // Section 6 — the fixture metrics (W503 over the clip + its frames).
    // -----------------------------------------------------------------------

    const report = run1.report;
    expect(report.schemaTag).toBe("sporta/renderer-evaluation/w503@1");
    expect(report.input).toEqual({
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: ANIME_RENDERER_VERSION,
      styleId: CLIP_STYLE_ID,
      sessionId: SESSION_ID,
      snapshotVersion: FINAL_SNAPSHOT_VERSION,
      frameCount: CLIP_FRAME_COUNT,
      frameIntervalMs: CLIP_FRAME_INTERVAL_MS,
      svgFramesMeasured: true,
    });

    // IDENTITY FLICKER: none. Every entity is recorded in every frame (the
    // W502 accounting contract), nothing vanishes, nothing reappears, and
    // the style tokens are perfectly stable: 3 participants x 6 frames = 18
    // token frames, all equal to their modal token.
    expect(report.identity.frameCount).toBe(CLIP_FRAME_COUNT);
    expect(report.identity.entityIds).toEqual([...TRACK_IDS]);
    expect(report.identity.unexplainedAbsenceCount).toBe(0);
    expect(report.identity.flickerCount).toBe(0);
    expect(report.identity.reappearanceCount).toBe(0);
    expect(report.identity.styleTokenFrames).toBe(18);
    expect(report.identity.styleStableFrames).toBe(18);
    expect(report.identity.styleInstabilityFrames).toBe(0);
    expect(report.identity.styleStabilityRatio).toBe(1);
    expect(report.identity.perEntity).toEqual([
      {
        entityId: "t1",
        kind: "participant",
        firstFrameIndex: 0,
        flickerCount: 0,
        unexplainedAbsenceCount: 0,
        reappearanceCount: 0,
        presence: ["rendered", "rendered", "rendered", "rendered", "rendered", "rendered"],
        styleTokenFrames: 6,
        styleStableFrames: 6,
        distinctStyleTokens: 1,
      },
      {
        entityId: "t2",
        kind: "participant",
        firstFrameIndex: 0,
        flickerCount: 0,
        unexplainedAbsenceCount: 0,
        reappearanceCount: 0,
        presence: ["rendered", "rendered", "rendered", "rendered", "rendered", "rendered"],
        styleTokenFrames: 6,
        styleStableFrames: 6,
        distinctStyleTokens: 1,
      },
      {
        entityId: "t3",
        kind: "participant",
        firstFrameIndex: 0,
        flickerCount: 0,
        unexplainedAbsenceCount: 0,
        reappearanceCount: 0,
        presence: ["rendered", "rendered", "rendered", "rendered", "rendered", "rendered"],
        styleTokenFrames: 6,
        styleStableFrames: 6,
        distinctStyleTokens: 1,
      },
      {
        entityId: "t4",
        kind: "ball",
        firstFrameIndex: 0,
        flickerCount: 0,
        unexplainedAbsenceCount: 0,
        reappearanceCount: 0,
        presence: ["rendered", "rendered", "rendered", "rendered", "rendered", "rendered"],
        styleTokenFrames: 0,
        styleStableFrames: 0,
        distinctStyleTokens: 0,
      },
    ]);

    // BYTE-LEVEL STYLE STABILITY: every entity's normalized marker group
    // (geometry + confidence-opacity stripped) is byte-identical across all
    // six frames — 4 groups x 6 frames = 24, zero unstable.
    expect(report.styleBytes).toEqual({
      perEntity: TRACK_IDS.map((entityId) => ({
        entityId,
        groupFrames: 6,
        distinctGroups: 1,
        unstableFrames: 0,
      })),
      groupFrames: 24,
      stableFrames: 24,
      unstableFrames: 0,
      stabilityRatio: 1,
    });

    // GEOMETRY DRIFT: 4 entities x 5 consecutive pairs = 20 measured pairs
    // (full series, no gaps), ZERO jumps, and the max ratio is the striker's
    // 2.6855 m sprint step against the 12.51 m bound (hand-derived above).
    // The ball's 0.875 m step against the 40.01 bound is the smallest.
    expect(report.geometry.frameCount).toBe(CLIP_FRAME_COUNT);
    expect(report.geometry.playerMaxSpeedMps).toBe(12.5);
    expect(report.geometry.ballMaxSpeedMps).toBe(40);
    expect(report.geometry.positionEpsilonMeters).toBe(0.01);
    expect(report.geometry.measuredEntityIds).toEqual([...TRACK_IDS]);
    expect(report.geometry.notMeasuredEntityIds).toEqual([]);
    expect(report.geometry.measuredPairCount).toBe(20);
    expect(report.geometry.jumpCount).toBe(0);
    expect(report.geometry.maxJumpRatio).toBeCloseTo(STRIKER_STEP_RATIO, 12);
    expect(report.geometry.maxDisplacementMeters).toBeCloseTo(STRIKER_STEP_DISPLACEMENT, 12);
    expect(report.geometry.maxJumpMeters).toBe(0);
    expect(report.geometry.gapFrameCount).toBe(0);
    expect(report.geometry.gapSpanCount).toBe(0);
    const geometryByEntity = new Map(
      report.geometry.perEntity.map((entity) => [entity.entityId, entity]),
    );
    for (const [entityId, series] of geometryByEntity) {
      expect(series.measuredFrameCount).toBe(CLIP_FRAME_COUNT);
      expect(series.jumpCount).toBe(0);
      expect(series.maxJumpMeters).toBe(0);
      expect(series.gapFrameCount).toBe(0);
      expect(series.gapSpanCount).toBe(0);
      expect(series.series).toHaveLength(5);
      for (const step of series.series) {
        expect(step.dtMs).toBe(CLIP_FRAME_INTERVAL_MS);
        expect(step.spansGap).toBe(false);
        expect(step.exceedsBound).toBe(false);
      }
      expect(series.bound).toEqual(
        entityId === "t4"
          ? { maxSpeedMps: 40, epsilonMeters: 0.01 }
          : { maxSpeedMps: 12.5, epsilonMeters: 0.01 },
      );
    }
    expect(geometryByEntity.get("t1")!.maxDisplacementMeters).toBeCloseTo(
      STRIKER_STEP_DISPLACEMENT,
      12,
    );
    expect(geometryByEntity.get("t1")!.maxJumpRatio).toBeCloseTo(STRIKER_STEP_RATIO, 12);
    expect(geometryByEntity.get("t4")!.maxDisplacementMeters).toBeCloseTo(0.875, 12);
    expect(geometryByEntity.get("t4")!.maxJumpRatio).toBeCloseTo(BALL_STEP_RATIO, 12);

    // TEMPORAL ARTIFACTS: all fifteen counts are ZERO (clean accounting all
    // the way down), with the anomaly list empty.
    expect(report.artifacts).toEqual({
      frameCount: CLIP_FRAME_COUNT,
      windowOverlapCount: 0,
      invertedWindowCount: 0,
      windowTimestampMismatchCount: 0,
      captionDuplicateCount: 0,
      captionUnappliedCount: 0,
      appliedDuplicateCount: 0,
      appliedUnsortedCount: 0,
      appliedGapCount: 0,
      appliedUnaccountedCount: 0,
      watermarkSequenceRegressionCount: 0,
      watermarkTimeRegressionCount: 0,
      watermarkBelowEventsCount: 0,
      dispositionFlapCount: 0,
      dispositionTransitionCount: 0,
      kindChangeCount: 0,
      possessionDisplayMismatchCount: 0,
      anomalies: [],
    });

    // THE VERDICT: PASS — 21/21 checks (20 + the conditional styleBytes
    // check), zero failures, every check carrying its measured evidence.
    expect(report.verdict.pass).toBe(true);
    expect(report.verdict.failures).toEqual([]);
    expect(report.verdict.checks).toHaveLength(21);
    expect(report.verdict.checks.every((check) => check.pass)).toBe(true);
    expect(report.verdict.checks.map((check) => `${check.metric}:${check.operator}`)).toEqual([
      "identity.unexplainedAbsenceCount:max",
      "identity.flickerCount:max",
      "identity.styleStabilityRatio:min",
      "geometry.jumpCount:max",
      "geometry.maxJumpRatio:max",
      "artifacts.windowOverlapCount:max",
      "artifacts.invertedWindowCount:max",
      "artifacts.windowTimestampMismatchCount:max",
      "artifacts.captionDuplicateCount:max",
      "artifacts.captionUnappliedCount:max",
      "artifacts.appliedDuplicateCount:max",
      "artifacts.appliedUnsortedCount:max",
      "artifacts.appliedGapCount:max",
      "artifacts.appliedUnaccountedCount:max",
      "artifacts.watermarkSequenceRegressionCount:max",
      "artifacts.watermarkTimeRegressionCount:max",
      "artifacts.watermarkBelowEventsCount:max",
      "artifacts.dispositionFlapCount:max",
      "artifacts.kindChangeCount:max",
      "artifacts.possessionDisplayMismatchCount:max",
      "styleBytes.stabilityRatio:min",
    ]);
    // The measured evidence on the checks themselves: every count check
    // measures 0; every ratio check measures 1 — EXCEPT the geometry
    // maxJumpRatio, which measures the striker's hand-derived sprint ratio.
    for (const check of report.verdict.checks) {
      if (check.metric === "geometry.maxJumpRatio") continue;
      expect(check.measured).toBe(check.operator === "min" ? 1 : 0);
    }
    const maxJumpRatioCheck = report.verdict.checks.find(
      (check) => check.metric === "geometry.maxJumpRatio",
    )!;
    expect(maxJumpRatioCheck.operator).toBe("max");
    expect(maxJumpRatioCheck.threshold).toBe(1);
    expect(maxJumpRatioCheck.measured).toBeCloseTo(STRIKER_STEP_RATIO, 12);

    // -----------------------------------------------------------------------
    // Section 7 — encode -> store -> locate -> playback (W504, end to end).
    // -----------------------------------------------------------------------

    const segment = run1.segment;
    // The encoded segment: ONE self-contained animated-SVG document whose
    // segment id is the deterministic fnv1a32 of the render identity (the
    // exported pure function — the identity string is all pinned fields),
    // whose content hash is the sha-256 of its own bytes (content
    // addressing), and whose container manifest carries the W502 render
    // manifest VERBATIM.
    expect(segment.segmentId).toBe(segmentIdOf(clip.manifest));
    expect(segment.segmentId).toMatch(/^anime-clip-[0-9a-f]{8}$/);
    expect(segment.contentType).toBe("image/svg+xml");
    expect(segment.contentHash).toBe(contentHashOf(segment.content));
    expect(segment.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(segment.byteLength).toBe(new TextEncoder().encode(segment.content).length);
    expect(segment.manifest.format).toEqual({ kind: "animated-svg", version: 1 });
    expect(segment.manifest.segmentId).toBe(segment.segmentId);
    expect(segment.manifest.sessionId).toBe(SESSION_ID);
    expect(segment.manifest.frameCount).toBe(CLIP_FRAME_COUNT);
    expect(segment.manifest.totalDurationMs).toBe(CLIP_DURATION_MS);
    expect(segment.manifest.contentHash).toBe(segment.contentHash);
    expect(segment.manifest.sourceManifest).toEqual(clip.manifest);
    // SMIL timings derived EXACTLY from the W502 windows: begin = the
    // frame's timestamp relative to the first frame, dur = 1000 each.
    expect(segment.manifest.frames).toEqual(
      WAVE_BOUNDARIES_MS.map((atMs, index) => ({
        frameIndex: index,
        outputTimestampMs: atMs,
        beginMs: index * CLIP_FRAME_INTERVAL_MS,
        durMs: CLIP_FRAME_INTERVAL_MS,
      })),
    );
    // The composed document: the container root, the pinned title/desc, one
    // display-none group per frame with its <set> visibility timing (the
    // LAST frame freezes), no scripts, and the frame content inside.
    expect(
      segment.content.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1170 880" width="1170" height="880">',
      ),
    ).toBe(true);
    expect(segment.content).toContain("<title>anime.prototype@0.1.0 animated clip</title>");
    expect(segment.content).toContain(
      `<desc>segmentId=${segment.segmentId} frameCount=${CLIP_FRAME_COUNT} totalDurationMs=${CLIP_DURATION_MS}</desc>`,
    );
    expect(segment.content.split("<g data-frame-index=").length - 1).toBe(CLIP_FRAME_COUNT);
    expect(segment.content).toContain(
      '<set attributeName="display" to="inline" begin="0s" dur="1s" fill="remove"/>',
    );
    expect(segment.content).toContain(
      '<set attributeName="display" to="inline" begin="5s" dur="1s" fill="freeze"/>',
    );
    expect(segment.content).not.toContain("<script");
    expect(segment.content).toContain('<g data-entity="t1">');

    // Encode -> store through the REAL pipeline (both layers), host-assigned
    // to the control plane's anime render id (the documented W504 pattern).
    const stored = run1.stored;
    expect(stored).toEqual({
      sessionId: SESSION_ID,
      renderId: "r-2",
      segmentId: segment.segmentId,
      artifactId: segment.contentHash,
      contentType: "image/svg+xml",
      byteLength: segment.byteLength,
      frameCount: CLIP_FRAME_COUNT,
      outcome: "stored",
      artifactOutcome: "stored",
    });
    // Idempotence on BOTH layers: re-encoding the same clip is a counted
    // duplicate, never a re-write (the W504 store evidence).
    expect(run1.duplicateStore.outcome).toBe("duplicate");
    expect(run1.duplicateStore.artifactOutcome).toBe("duplicate");
    expect(run1.stats).toEqual({
      segments: 1,
      segmentBytes: segment.byteLength,
      duplicateSegmentStores: 1,
      artifacts: 1,
      artifactBytes: segment.byteLength,
      duplicateArtifactPuts: 1,
    });

    // Every W502 anime:// artifactRef resolves to the served coordinates.
    expect(run1.locations).toHaveLength(CLIP_FRAME_COUNT);
    run1.locations.forEach((locations, index) => {
      expect(locations).toHaveLength(1);
      expect(locations[0]!).toEqual({
        ref: `anime://${SESSION_ID}/${FINAL_SNAPSHOT_VERSION}/${index}`,
        sessionId: SESSION_ID,
        snapshotVersion: FINAL_SNAPSHOT_VERSION,
        frameIndex: index,
        renderId: "r-2",
        segmentId: segment.segmentId,
        artifactId: segment.contentHash,
        contentType: "image/svg+xml",
        byteLength: segment.byteLength,
        contentHash: segment.contentHash,
      });
    });

    // The outputs list route: the stored segment summary, rights-gated.
    expect(run1.listOutputs).toEqual({
      sessionId: SESSION_ID,
      renderId: "r-2",
      segments: [
        {
          segmentId: segment.segmentId,
          contentType: "image/svg+xml",
          byteLength: segment.byteLength,
          contentHash: segment.contentHash,
        },
      ],
    });

    // The playback fetch: the BYTE-IDENTICAL artifact. The served content
    // equals the canonical encoding verbatim, re-hashes to the artifact id
    // (content addressing — integrity by construction), and the container
    // manifest is carried verbatim; a second fetch is identical.
    const playback = run1.playback;
    expect(playback.sessionId).toBe(SESSION_ID);
    expect(playback.renderId).toBe("r-2");
    expect(playback.segmentId).toBe(segment.segmentId);
    expect(playback.contentType).toBe("image/svg+xml");
    expect(playback.content).toBe(segment.content);
    expect(playback.byteLength).toBe(segment.byteLength);
    expect(playback.contentHash).toBe(segment.contentHash);
    expect(contentHashOf(playback.content)).toBe(stored.artifactId);
    expect(playback.manifest).toEqual(segment.manifest);
    expect(run1.secondPlaybackContent).toBe(playback.content);

    // The rights-denial leg: the no-storage-rights session renders fine
    // (compute is not gated on canStoreDerivatives) but BOTH playback
    // routes deny 403 BEFORE any existence or byte is revealed.
    expect(run1.denial.deniedSessionId).toBe("sess-2");
    expect(run1.denial.renderStatus).toBe(200);
    expect(run1.denial.renderId).toBe("r-3");
    expect(run1.denial.listStatus).toBe(403);
    expect(run1.denial.listFailureClass).toBe("rights-denied");
    expect(run1.denial.getStatus).toBe(403);
    expect(run1.denial.getFailureClass).toBe("rights-denied");

    // -----------------------------------------------------------------------
    // Section 8 — determinism: the whole demo re-run, deep-equal.
    // -----------------------------------------------------------------------

    // The WHOLE demo with a fresh server, a fresh pipeline, and fresh story
    // objects produces the identical artifacts — sessions, both render
    // results, observations, wave reports, pins, the clip (result + manifest
    // + SVG frames), the evaluation report, the encoded segment, both store
    // results, the located refs, and the served playback documents —
    // compared as JSON. No seed, clock, or RNG input differs between the two
    // runs; nothing else may.
    const run2 = await runG4Demo();
    expect(serializeRun(run2)).toBe(serializeRun(run1));
    expect(run2.sessionId).toBe(SESSION_ID);
    expect(run2.report.verdict.pass).toBe(true);
    expect(run2.segment.content).toBe(run1.segment.content);
    expect(run2.playback.content).toBe(run1.playback.content);
    expect(run2.denial.listStatus).toBe(403);
  });
});
