/**
 * The W605 fixtures: three deterministic timelines, each built through the
 * REAL public seams end-to-end — never a hand-drawn manifest:
 *
 * 1. `buildCleanMatchFixture` — a plain 4-step `render3dMatch` render: a
 *    moving striker, an uncertain winger, a no-position bench player, an
 *    official, a ball with carried height; three events; a stable score.
 *    The clean baseline.
 * 2. `buildCorrectionsMatchFixture` — an 8-step `render3dMatch` render whose
 *    timeline deliberately carries every discontinuity class: a disposition
 *    change at a snapshot boundary (keeper in→out of bounds), a mid-timeline
 *    height gap (the ball's only z source vanishes), a velocity-bound
 *    teleport, a substitute never interpolated into existence, a score that
 *    goes 0-0 → 1-0 provisional → 1-0 confirmed, a possession change, a
 *    stoppage flag, an event CORRECTION (a referee decision superseding a
 *    card), an unknown-taxonomy event, two markers in one frame's window,
 *    a boundary-exact marker (restart at a snapshot boundary), and a
 *    declared scene cut into the last step.
 * 3. `buildDirectedReviewFixture` — the SAME 8-step timeline driven through
 *    the full W604 chain: commentary units → the real W209
 *    `extractEventCandidates` → `direct` → `render3dDirectedMatch`, yielding
 *    live windows (two camera cuts) plus a replay-emphasis REVIEW window;
 *    the evaluation input carries the plan for the direction dimension's
 *    plan-consistency measurement.
 *
 * Construction rules (all pinned by `test/fixture.test.ts`):
 *
 * - one `WorldModelEngine` per build with an INJECTED clock
 *   (`TEST_EPOCH_MS`) — no wall-clock, no RNG anywhere;
 * - the ground-truth snapshot of each step is captured AT CONSTRUCTION TIME
 *   through the real `stateAt` seam (the engine's football state has no
 *   history — its documented at-T semantics — so per-step capture is the
 *   only honest ground truth for a multi-step timeline);
 * - each step's scene is the REAL `projectScene` of that captured snapshot
 *   with the renderer-fixture event-window convention (`(prevAtMs, atMs]`,
 *   exclusive lower bound — the `renderer-3d` test-helpers' own convention);
 * - the event stream is the engine's own log (`eventsSince(0)`, log order);
 * - match outputs are real `render3dMatch` runs; the directed output is a
 *   real `render3dDirectedMatch` composition.
 *
 * Every builder is PURE and deterministic: two calls yield deep-equal
 * documents and byte-identical SVG frames (pinned).
 */
import { SCHEMA_VERSION } from "@sporta/contracts";
import type { UncertainValue, WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import { WorldModelEngine } from "@sporta/world-model";
import type { FootballState, FootballStatePatch } from "@sporta/world-model";
import { stateAt } from "@sporta/temporal";
import { projectScene } from "@sporta/scene-projection";
import {
  AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
  AVATAR_FIELD_RENDERER_ID,
  AVATAR_FIELD_RENDERER_VERSION,
  render3dMatch,
} from "@sporta/renderer-3d";
import type { AvatarField3dMatchStep } from "@sporta/renderer-3d";
import { extractEventCandidates } from "@sporta/commentary-understanding";
import { DEFAULT_DIRECTOR_POLICY, direct, render3dDirectedMatch } from "@sporta/camera-director";
import type { CameraPlan } from "@sporta/camera-director";
import { buildRenderRequest } from "@sporta/testing";
import type { AvatarField3dRenderOutput } from "@sporta/renderer-3d";
import type { DirectedRenderOutput } from "@sporta/camera-director";

/**
 * A built fixture: the evaluation input with its TRUE document types (the
 * evaluator's own {@link SceneEvaluationInput} contract is `unknown`-typed
 * because it validates; the builders know what they built).
 */
export interface SceneEvaluationFixture {
  readonly snapshots: readonly WorldSnapshot[];
  readonly eventStream: readonly WorldEventStreamEntry[];
  readonly steps: readonly AvatarField3dMatchStep[];
  readonly output: AvatarField3dRenderOutput | DirectedRenderOutput;
  /** The W604 plan, when the output is a directed rundown. */
  readonly plan?: CameraPlan;
}

/** The injected clock domain of every W605 fixture (the @sporta/testing epoch). */
export const W605_FIXTURE_NOW_MS = 1_736_164_800_000;

/** One authored story event (applied at its `atMs`, in time order). */
interface StoryEvent {
  readonly eventId: string;
  readonly atMs: number;
  readonly typeRef: string;
  readonly confidence?: number;
  readonly correctionOf?: string;
}

/** A built timeline: the ground-truth documents + the render's own steps. */
interface TimelineBuild {
  readonly snapshots: readonly WorldSnapshot[];
  readonly steps: readonly AvatarField3dMatchStep[];
  readonly eventStream: readonly WorldEventStreamEntry[];
}

/** The story shared by the corrections and directed fixtures. */
const CORRECTIONS_EVENTS: readonly StoryEvent[] = [
  { eventId: "evt-kickoff", atMs: 1_000, typeRef: "football/v1/kickoff" },
  { eventId: "evt-pass", atMs: 2_500, typeRef: "football/v1/pass" },
  { eventId: "evt-save", atMs: 3_500, typeRef: "football/v1/save" },
  // Lands EXACTLY on the snapshot boundary t=4000: in the directed fixture
  // this is a live window boundary — the marker rides the dropped observed
  // tail frame of the earlier window and must be re-presented by the next
  // (the boundary-transfer accounting path).
  { eventId: "evt-restart", atMs: 4_000, typeRef: "football/v1/restart" },
  { eventId: "evt-goal", atMs: 4_400, typeRef: "football/v1/goal", confidence: 0.95 },
  // Within the SAME 200 ms frame window as the goal: the frame at 4400 must
  // carry both markers in source order (the in-frame ordering evidence).
  { eventId: "evt-carry", atMs: 4_550, typeRef: "football/v1/carry" },
  { eventId: "evt-card", atMs: 6_200, typeRef: "football/v1/card" },
  // Unknown taxonomy: the chip text falls back to the VERBATIM type ref.
  { eventId: "evt-flare", atMs: 7_500, typeRef: "custom/v9/flare" },
  // A correction superseding the card — the engine records the supersede;
  // the stream (the ordering ground truth) carries BOTH entries.
  {
    eventId: "evt-card-fix",
    atMs: 7_600,
    typeRef: "football/v1/referee-decision",
    correctionOf: "evt-card",
  },
];

/** The clean fixture's simpler event set. */
const CLEAN_EVENTS: readonly StoryEvent[] = [
  { eventId: "evt-kickoff", atMs: 1_000, typeRef: "football/v1/kickoff" },
  { eventId: "evt-pass", atMs: 2_500, typeRef: "football/v1/pass" },
  { eventId: "evt-save", atMs: 3_500, typeRef: "football/v1/save" },
];

/** The engine's initial football state (a canonical 0-0 first half). */
function initialFootball(): FootballState {
  return {
    pitch: {
      lengthAxisMeters: 105,
      widthAxisMeters: 68,
      origin: "corner",
      axes: "x=touchline, y=goal-line",
    },
    clock: { period: "first-half", clockMs: 2_700_000, stoppage: false },
    score: { home: 0, away: 0, status: { status: "known", value: "confirmed" } },
    possession: { status: "uncertain", value: { entityId: "striker-9" }, confidence: 0.72 },
    eventTaxonomyVersion: "v1",
  };
}

/** Upserts the clean fixture's entities at one step (index, atMs). */
function upsertCleanStory(engine: WorldModelEngine, atMs: number, index: number): void {
  const strikerX = 50 + 5 * index;
  engine.upsertEntity({
    entityId: "striker-9",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: { pitchPosition: { status: "known", value: { x: strikerX, y: 30 } } },
  });
  engine.upsertEntity({
    entityId: "winger-7",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: {
      pitchPosition: {
        status: "uncertain",
        value: { x: 20 + index, y: 12 },
        confidence: 0.55,
      },
    },
  });
  engine.upsertEntity({
    entityId: "bench-12",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: { teamRole: { status: "known", value: "midfielder" } },
  });
  engine.upsertEntity({
    entityId: "official-1",
    kind: "official",
    version: 1,
    lastEventTimeMs: atMs,
    state: { pitchPosition: { status: "known", value: { x: 52.5, y: 42 } } },
  });
  engine.upsertEntity({
    entityId: "ball-1",
    kind: "ball",
    version: 1,
    lastEventTimeMs: atMs,
    state: {
      pitchPosition: {
        status: "uncertain",
        value: { x: strikerX + 1, y: 30.5 },
        confidence: 0.9,
      },
      height: { status: "known", value: 1.2 + 0.16 * index },
    },
  });
}

/** Upserts the corrections fixture's entities at one step (index, atMs). */
function upsertCorrectionsStory(engine: WorldModelEngine, atMs: number, index: number): void {
  const strikerX = 50 + 5 * index;
  engine.upsertEntity({
    entityId: "striker-9",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: { pitchPosition: { status: "known", value: { x: strikerX, y: 30 } } },
  });
  engine.upsertEntity({
    entityId: "winger-7",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: {
      pitchPosition: {
        status: "uncertain",
        value: { x: 20 + index, y: 12 },
        confidence: 0.55,
      },
    },
  });
  // keeper-1: in bounds through step 5 (index 0..4), OUT of bounds from
  // step 6 (index 5) — a disposition change at a snapshot boundary.
  const keeperX = index <= 4 ? 2.5 : -2;
  engine.upsertEntity({
    entityId: "keeper-1",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: { pitchPosition: { status: "known", value: { x: keeperX, y: 34 } } },
  });
  engine.upsertEntity({
    entityId: "bench-12",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: { teamRole: { status: "known", value: "midfielder" } },
  });
  engine.upsertEntity({
    entityId: "official-1",
    kind: "official",
    version: 1,
    lastEventTimeMs: atMs,
    state: { pitchPosition: { status: "known", value: { x: 52.5, y: 42 } } },
  });
  // ball-1: height slot carried through step 6 (index 5), ABSENT from
  // step 7 — the honest mid-timeline height gap (the SWM's height slot is
  // the ball z's only source — W601 S6).
  const ballState: Record<string, UncertainValue> = {
    pitchPosition: {
      status: "uncertain",
      value: { x: strikerX + 1, y: 30.5 },
      confidence: 0.9,
    },
    ...(index <= 5 ? { height: { status: "known", value: 1.2 + 0.16 * index } } : {}),
  };
  engine.upsertEntity({
    entityId: "ball-1",
    kind: "ball",
    version: 1,
    lastEventTimeMs: atMs,
    state: ballState,
  });
  // sub-15: first appears at t=4000 (index 3) — never interpolated into
  // existence before its own step.
  if (index >= 3) {
    engine.upsertEntity({
      entityId: "sub-15",
      kind: "participant",
      version: 1,
      lastEventTimeMs: atMs,
      state: { pitchPosition: { status: "known", value: { x: 40 + index, y: 20 } } },
    });
  }
  // teleport-3: x 10 until step 3 (index 2), then jumps to 80 — above the
  // 12.51 m/s bound → the segment interpolates nothing (velocity-bound).
  const teleportX = index <= 2 ? 10 : 80;
  engine.upsertEntity({
    entityId: "teleport-3",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: { pitchPosition: { status: "known", value: { x: teleportX, y: 55 } } },
  });
}

/** The clean fixture's per-step football patches (a stable, advancing clock). */
function cleanFootballPatches(index: number, atMs: number): FootballStatePatch[] {
  return [
    {
      atMs,
      clock: { period: "first-half", clockMs: 2_700_000 + atMs, stoppage: false },
    },
  ];
}

/** The corrections fixture's per-step football patches (the full story). */
function correctionsFootballPatches(index: number, atMs: number): FootballStatePatch[] {
  const patches: FootballStatePatch[] = [
    {
      atMs,
      clock: {
        period: "second-half",
        clockMs: 2_700_000 + atMs,
        stoppage: index >= 6,
      },
    },
  ];
  if (index === 4) {
    // Queried step 4000 already; the goal lands at 4400 → visible from
    // step 5000 as a provisional 1-0.
    patches.push({
      atMs: 4_500,
      score: {
        home: 1,
        away: 0,
        status: { status: "uncertain", value: "provisional", confidence: 0.9 },
      },
    });
  }
  if (index === 5) {
    // The score is confirmed from step 6000.
    patches.push({
      atMs: 5_500,
      score: { home: 1, away: 0, status: { status: "known", value: "confirmed" } },
    });
  }
  if (index === 6) {
    // Possession changes to the winger from step 7000.
    patches.push({
      atMs: 6_500,
      possession: { status: "uncertain", value: { entityId: "winger-7" }, confidence: 0.6 },
    });
  }
  return patches;
}

/**
 * Builds one timeline through the real seams. The per-step ground-truth
 * snapshots are captured AT CONSTRUCTION TIME (before later steps evolve
 * the engine — the engine's football state has no history), the steps'
 * scenes are real `projectScene` documents windowed with the renderer
 * fixture convention `(prevAtMs, atMs]`, and the event stream is the
 * engine's own log.
 */
function buildTimeline(options: {
  sessionId: string;
  stepCount: number;
  events: readonly StoryEvent[];
  upsertStory: (engine: WorldModelEngine, atMs: number, index: number) => void;
  footballPatches: (index: number, atMs: number) => FootballStatePatch[];
  cutBeforeLastStep: boolean;
}): TimelineBuild {
  const { sessionId, stepCount, events, upsertStory, footballPatches, cutBeforeLastStep } = options;
  const engine = WorldModelEngine.create(sessionId, {
    now: () => W605_FIXTURE_NOW_MS,
    football: initialFootball(),
  });
  const applied = new Set<string>();
  const snapshots: WorldSnapshot[] = [];
  const steps: AvatarField3dMatchStep[] = [];
  for (let index = 0; index < stepCount; index += 1) {
    const atMs = (index + 1) * 1_000;
    upsertStory(engine, atMs, index);
    for (const authored of events) {
      if (!applied.has(authored.eventId) && authored.atMs <= atMs) {
        applied.add(authored.eventId);
        engine.applyEvent({
          eventId: authored.eventId,
          sessionId,
          schemaVersion: SCHEMA_VERSION,
          eventTypeRef: authored.typeRef,
          interval: { startTimeMs: authored.atMs, endTimeMs: authored.atMs },
          eventTimeMs: authored.atMs,
          provenance: "DERIVED",
          ...(authored.confidence === undefined ? {} : { confidence: authored.confidence }),
          ...(authored.correctionOf === undefined ? {} : { correctionOf: authored.correctionOf }),
          evidence: { observationIds: [`obs-${authored.eventId}`] },
        });
      }
    }
    for (const patch of footballPatches(index, atMs)) {
      engine.applyFootballState(patch);
    }
    // The ground-truth snapshot, captured NOW (before later steps evolve
    // the engine) through the real W402 at-T seam.
    const snapshot = stateAt(engine, atMs).snapshot;
    snapshots.push(snapshot);
    // The step's scene: the REAL W601 projection of that snapshot, with the
    // renderer fixture's event-window convention (prevAtMs, atMs].
    const windowFrom = index === 0 ? 0 : index * 1_000;
    const windowed = engine
      .eventsSince(0)
      .filter((entry) => entry.event.eventTimeMs > windowFrom && entry.event.eventTimeMs <= atMs);
    steps.push({
      atMs,
      scene: projectScene(snapshot, { events: windowed }),
      ...(cutBeforeLastStep && index === stepCount - 1 ? { sceneCutBefore: true } : {}),
    });
  }
  return { snapshots, steps, eventStream: engine.eventsSince(0) };
}

/** The render request every W605 fixture renders through (deterministic). */
function fixtureRequest(sessionId: string): ReturnType<typeof buildRenderRequest> {
  return buildRenderRequest({
    sessionId,
    rendererId: AVATAR_FIELD_RENDERER_ID,
    rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
    styleConfig: { styleId: "style-3d-scene-eval", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: {
      canReferenceSourceFrames: true,
      canDeliverLive: true,
      canStoreDerivatives: true,
      canShare: true,
    },
    sourceFrameRefs: [],
  });
}

/** The clean fixture's session id. */
export const W605_CLEAN_SESSION_ID = "sess-w605-clean";

/** The corrections fixture's session id (also the directed fixture's timeline). */
export const W605_CORRECTIONS_SESSION_ID = "sess-w605-corr";

/** Builds the clean 4-step match fixture's timeline (shared by tests). */
export function buildCleanTimeline(): TimelineBuild {
  return buildTimeline({
    sessionId: W605_CLEAN_SESSION_ID,
    stepCount: 4,
    events: CLEAN_EVENTS,
    upsertStory: upsertCleanStory,
    footballPatches: cleanFootballPatches,
    cutBeforeLastStep: false,
  });
}

/** Builds the corrections 8-step match fixture's timeline (shared by tests). */
export function buildCorrectionsTimeline(): TimelineBuild {
  return buildTimeline({
    sessionId: W605_CORRECTIONS_SESSION_ID,
    stepCount: 8,
    events: CORRECTIONS_EVENTS,
    upsertStory: upsertCorrectionsStory,
    footballPatches: correctionsFootballPatches,
    cutBeforeLastStep: true,
  });
}

/**
 * The clean match fixture: a plain 4-step render through the real W603
 * match path at the animated profile (5 fps — 200 ms frames).
 */
export function buildCleanMatchFixture(): SceneEvaluationFixture {
  const timeline = buildCleanTimeline();
  const output = render3dMatch(fixtureRequest(W605_CLEAN_SESSION_ID), [...timeline.steps]);
  return {
    snapshots: [...timeline.snapshots],
    eventStream: [...timeline.eventStream],
    steps: [...timeline.steps],
    output,
  };
}

/**
 * The discontinuity/corrections match fixture: the 8-step story through the
 * real W603 match path — disposition change, height gap, teleport, appearing
 * substitute, score/clock/possession evolution, stoppage, a correction
 * event, an unknown taxonomy, a two-marker frame, and a declared scene cut.
 */
export function buildCorrectionsMatchFixture(): SceneEvaluationFixture {
  const timeline = buildCorrectionsTimeline();
  const output = render3dMatch(fixtureRequest(W605_CORRECTIONS_SESSION_ID), [...timeline.steps]);
  return {
    snapshots: [...timeline.snapshots],
    eventStream: [...timeline.eventStream],
    steps: [...timeline.steps],
    output,
  };
}

/** The directed review fixture: the evaluation input plus its W604 plan. */
export interface DirectedReviewFixture {
  readonly input: SceneEvaluationFixture;
  /** The exact `CameraPlan` the rundown was composed from. */
  readonly plan: CameraPlan;
}

/**
 * The directed review-window fixture: the SAME 8-step corrections timeline
 * driven through the full W604 chain — commentary text → the real W209
 * `extractEventCandidates` → `direct(DEFAULT_DIRECTOR_POLICY)` →
 * `render3dDirectedMatch`. The plan travels WITH the input (the direction
 * dimension's plan-consistency surface).
 */
export function buildDirectedReviewFixture(): DirectedReviewFixture {
  const timeline = buildCorrectionsTimeline();
  const steps = [...timeline.steps];
  const candidates = extractEventCandidates({
    units: [
      {
        unitId: "cu-1",
        startMs: 1_400,
        endMs: 1_800,
        text: "He shoots from the edge of the box.",
        sourceWindowIds: ["tu-1"],
      },
      {
        unitId: "cu-2",
        startMs: 4_300,
        endMs: 4_900,
        text: "GOAL!!! What a strike from Dalvio!",
        speakerLabel: "main",
        sourceWindowIds: ["tu-2"],
      },
      {
        unitId: "cu-3",
        startMs: 6_100,
        endMs: 6_600,
        text: "A rash tackle and the referee reaches for a card.",
        sourceWindowIds: ["tu-3"],
      },
    ],
    lexicon: { players: ["Dalvio"], teams: [] },
  });
  const plan = direct(DEFAULT_DIRECTOR_POLICY, steps, candidates);
  const output = render3dDirectedMatch(fixtureRequest(W605_CORRECTIONS_SESSION_ID), steps, plan);
  return {
    input: {
      snapshots: [...timeline.snapshots],
      eventStream: [...timeline.eventStream],
      steps,
      output,
      plan,
    },
    plan,
  };
}
