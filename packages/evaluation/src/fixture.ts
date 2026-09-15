/**
 * The FIXED evaluation fixture (W403, pure).
 *
 * ONE hand-built deterministic fixture — fixed constants, no RNG, no clock
 * reads — the single input every evaluation run consumes, so cross-run
 * output differences can only come from the chain, never the input. The
 * accept criterion ("a fixed fixture produces comparable world-model
 * outputs across runs") starts here.
 *
 * SHAPE (mirrors the delivered M1/M2 seams so the chain under evaluation is
 * the real one):
 *
 * - `tracks` — W206-shaped pitch-space track observations (`modality:
 *   "vision"`, `provenance: "DERIVED"`, `payload.kind: "track"` with
 *   `entityId` + pitch-meter `position`, one `subjectEntityRef` carrying
 *   the tracked subject's session-local kind — the shape
 *   `emitSpatialObservations` produces): 60 frames x 3 players + ball on
 *   LINEAR pitch motions over a 40 ms grid, with ONE occlusion gap in the
 *   ball stream (frames 30-34 absent — 200 ms of honest no-observation,
 *   what W202/W205 emit when the ball is occluded).
 * - `candidates` — W209-shaped commentary event candidate observations
 *   (`modality: "commentary"`, generic payload with
 *   `{eventType, eventPhrase, subjects, emphasis, unitId}` — the shape
 *   `emitEventCandidateObservations` produces): kickoff, pass, pass, goal,
 *   save, fulltime on a 5 s window grid (0..25000 ms) with a known entity
 *   lexicon ({@link EVALUATION_ENTITY_LEXICON}).
 *
 * TIMING LAYOUT (documented, load-bearing): the vision tracks start at
 * 20400 ms — AFTER the last log event (the save at 20000 ms) and before
 * the fulltime clock patch's timeline position (25000 ms). The commentary
 * covers the whole 25 s excerpt while the tracker delivers only its final
 * 2.36 s window; W403 evaluates cross-RUN comparability, not full-match
 * realism. This layout is what makes the W402 replay-vs-live
 * reconciliation honest: the live state AT THE EVENT HORIZON
 * (`stateAt(engine, EVALUATION_LAST_EVENT_TIME_MS)`) excludes the
 * track-derived entities and the post-fulltime football state for the same
 * documented reason the event-window replay cannot reconstruct them — so
 * the replay-vs-live comparison compares exactly the event-derived state
 * both sides can honestly hold.
 *
 * The fixture is FROZEN: `buildEvaluationFixture()` deep-freezes every
 * observation, payload, and array (and re-parses each observation through
 * the contracts `Observation` zod schema at build time, so an invalid
 * constant fails loud at construction, never inside a run).
 */
import { Observation, SCHEMA_VERSION } from "@sporta/contracts";
import type { Observation as ObservationDoc } from "@sporta/contracts";

/** The single media session every fixture observation belongs to. */
export const EVALUATION_SESSION_ID = "w403-evaluation";

// ---------------------------------------------------------------------------
// Vision track layout (W206-shaped)
// ---------------------------------------------------------------------------

/** Frames per tracked subject (the fixture's vision window length). */
export const TRACK_FRAME_COUNT = 60;

/** The 40 ms frame grid of the vision stream. */
export const TRACK_FRAME_STEP_MS = 40;

/**
 * First track frame's timeline position (20400 ms — after the last log
 * event at 20000 ms; see the module docblock's TIMING LAYOUT).
 */
export const TRACK_START_MS = 20_400;

/**
 * The ball-stream occlusion gap: ball frames 30-34 (inclusive) are absent —
 * 200 ms of honest no-observation (what W202/W205 emit when the ball is
 * occluded; the fusion simply never sees those upserts).
 */
export const BALL_OCCLUSION_GAP = { fromFrame: 30, toFrame: 34 } as const;

/** A tracked subject's linear motion: pitch-meter start plus per-frame delta. */
interface TrackSpec {
  readonly entityId: string;
  readonly kind: "participant" | "ball";
  readonly startX: number;
  readonly startY: number;
  readonly dxPerFrame: number;
  readonly dyPerFrame: number;
  readonly confidence: number;
  /** Frames this subject's stream SKIPS (the ball's occlusion gap). */
  readonly skipFrames?: readonly number[];
}

/**
 * The three players + the ball, on linear pitch motions in distinct,
 * non-crossing lanes. The ball's final position sits ~1.74 m from player
 * p1's final position (inside the W401 default 2 m possession radius,
 * with p2/p3 more than 20 m away) — the possession candidate is
 * deliberately UNAMBIGUOUS so the fusion's possession step is
 * deterministic and conflict-free.
 */
const TRACK_SPECS: readonly TrackSpec[] = [
  {
    entityId: "p1",
    kind: "participant",
    startX: 40,
    startY: 30,
    dxPerFrame: 0.06,
    dyPerFrame: 0.03,
    confidence: 0.93,
  },
  {
    entityId: "p2",
    kind: "participant",
    startX: 62,
    startY: 45,
    dxPerFrame: -0.25,
    dyPerFrame: 0.15,
    confidence: 0.9,
  },
  {
    entityId: "p3",
    kind: "participant",
    startX: 15,
    startY: 12,
    dxPerFrame: 0.12,
    dyPerFrame: 0.06,
    confidence: 0.87,
  },
  {
    entityId: "ball",
    kind: "ball",
    startX: 41,
    startY: 29,
    dxPerFrame: 0.07,
    dyPerFrame: 0.035,
    confidence: 0.86,
    skipFrames: [30, 31, 32, 33, 34],
  },
];

// ---------------------------------------------------------------------------
// Commentary candidate layout (W209-shaped)
// ---------------------------------------------------------------------------

/** The 5 s window grid the commentary candidates ride. */
export const CANDIDATE_GRID_STEP_MS = 5_000;

/**
 * The six candidates' event types, in stream order (kickoff, pass, pass,
 * goal, save, fulltime). `fulltime` is the period-establishing candidate:
 * W401 maps it to a CLOCK PATCH, not a log event.
 */
export const CANDIDATE_EVENT_TYPES = [
  "kickoff",
  "pass",
  "pass",
  "goal",
  "save",
  "fulltime",
] as const;

/**
 * The timeline position of the LAST LOG EVENT (the save at 20000 ms — the
 * event horizon of the fixture; the fulltime candidate at 25000 ms is a
 * clock patch, never a log entry). The W402 replay-vs-live comparison pins
 * the live side at exactly this horizon.
 */
export const EVALUATION_LAST_EVENT_TIME_MS = 20_000;

/**
 * The known entity lexicon the commentary candidates' subjects come from
 * (W209's `KnownEntityLexicon` shape, structural subset). Subjects are
 * NAME-level mentions — the fusion consumes candidates by `eventType`, so
 * the lexicon is fixture documentation, not engine input.
 */
export const EVALUATION_ENTITY_LEXICON = {
  players: ["Sato", "Ndiaye", "Krause"],
  teams: ["Polaris SC"],
} as const;

/** One commentary candidate's authored content (all constants). */
interface CandidateSpec {
  readonly eventType: string;
  readonly eventPhrase: string;
  readonly subjects: readonly string[];
  readonly emphasis: number;
  readonly unitId: string;
  readonly confidence: number;
}

const CANDIDATE_SPECS: readonly CandidateSpec[] = [
  {
    eventType: "kickoff",
    eventPhrase: "We are underway at Polaris Park.",
    subjects: ["Sato"],
    emphasis: 0.2,
    unitId: "w403-cu-1",
    confidence: 0.77,
  },
  {
    eventType: "pass",
    eventPhrase: "Sato slides it to Ndiaye.",
    subjects: ["Sato", "Ndiaye"],
    emphasis: 0.3,
    unitId: "w403-cu-2",
    confidence: 0.85,
  },
  {
    eventType: "pass",
    eventPhrase: "Ndiaye switches play wide.",
    subjects: ["Ndiaye"],
    emphasis: 0.35,
    unitId: "w403-cu-3",
    confidence: 0.85,
  },
  {
    eventType: "goal",
    eventPhrase: "Krause strikes — what a goal!",
    subjects: ["Krause"],
    emphasis: 0.4,
    unitId: "w403-cu-4",
    confidence: 0.91,
  },
  {
    eventType: "save",
    eventPhrase: "Sato's effort is saved!",
    subjects: ["Sato"],
    emphasis: 0.5,
    unitId: "w403-cu-5",
    confidence: 0.85,
  },
  {
    eventType: "fulltime",
    eventPhrase: "That is full time at Polaris Park.",
    subjects: [],
    emphasis: 0.1,
    unitId: "w403-cu-6",
    confidence: 0.99,
  },
];

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

/**
 * The fixed evaluation fixture: the W206-shaped pitch track observations
 * (players + ball) and the W209-shaped commentary candidates, all belonging
 * to {@link EVALUATION_SESSION_ID}, all contract-valid, all deep-frozen.
 */
export interface EvaluationFixture {
  sessionId: string;
  /** W206-shaped pitch track observations (players + ball). */
  tracks: readonly Observation[];
  /** W209-shaped commentary candidate observations. */
  candidates: readonly Observation[];
}

/** Recursively freezes a plain value (the fixture's immutability guard). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const element of value) deepFreeze(element);
    } else {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
    }
    Object.freeze(value);
  }
  return value;
}

/** Builds one W206-shaped track observation (validated, not yet frozen). */
function buildTrackObservation(spec: TrackSpec, frame: number): ObservationDoc {
  const eventTimeMs = TRACK_START_MS + frame * TRACK_FRAME_STEP_MS;
  return Observation.parse({
    observationId: `w403-trk-f${String(frame).padStart(3, "0")}-${spec.entityId}`,
    sessionId: EVALUATION_SESSION_ID,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs,
    modality: "vision",
    componentId: "w403-spatial-state",
    provenance: "DERIVED",
    confidence: spec.confidence,
    payload: {
      kind: "track",
      entityId: spec.entityId,
      position: {
        x: spec.startX + frame * spec.dxPerFrame,
        y: spec.startY + frame * spec.dyPerFrame,
      },
    },
    subjectEntityRefs: [{ entityId: spec.entityId, kind: spec.kind }],
  });
}

/** Builds one W209-shaped candidate observation (validated, not yet frozen). */
function buildCandidateObservation(spec: CandidateSpec, index: number): ObservationDoc {
  return Observation.parse({
    observationId: `w403-cand-${spec.eventType}-${index + 1}`,
    sessionId: EVALUATION_SESSION_ID,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs: index * CANDIDATE_GRID_STEP_MS,
    modality: "commentary",
    componentId: "w403-commentary-understanding",
    provenance: "DERIVED",
    confidence: spec.confidence,
    payload: {
      kind: "generic",
      data: {
        eventType: spec.eventType,
        eventPhrase: spec.eventPhrase,
        subjects: spec.subjects.map((name) => ({ name })),
        emphasis: spec.emphasis,
        unitId: spec.unitId,
      },
    },
    subjectEntityRefs: [],
  });
}

/**
 * Builds the FIXED evaluation fixture from the constants above. Pure and
 * deterministic: every call returns a fresh, deep-frozen, contract-valid,
 * deep-equal fixture. No RNG, no clock reads.
 */
export function buildEvaluationFixture(): EvaluationFixture {
  const tracks: ObservationDoc[] = [];
  for (let frame = 0; frame < TRACK_FRAME_COUNT; frame += 1) {
    for (const spec of TRACK_SPECS) {
      if (spec.skipFrames?.includes(frame)) continue;
      tracks.push(buildTrackObservation(spec, frame));
    }
  }
  const candidates = CANDIDATE_SPECS.map((spec, index) => buildCandidateObservation(spec, index));
  return deepFreeze({
    sessionId: EVALUATION_SESSION_ID,
    tracks: deepFreeze(tracks),
    candidates: deepFreeze(candidates),
  });
}

/**
 * Perturbs ONE track observation's pitch position by EXACT deltas, for the
 * negative (mutation-detected) tests: the returned fixture is a fresh
 * deep-frozen copy whose `tracks[trackIndex]` carries
 * `position.{x + dxM, y + dyM}` and everything else is untouched (same
 * observation ids, same times — only the position moves, so the mutation
 * survives the store -> fusion chain and lands in the fused entity's
 * `state.position.value`).
 *
 * The original fixture is never mutated (it is frozen; this helper is
 * pure). Throws `RangeError` (fail loud, repo style) on an out-of-range
 * index, a non-track observation, or non-finite deltas.
 */
export function mutateFixturePosition(
  fixture: EvaluationFixture,
  trackIndex: number,
  dxM: number,
  dyM: number,
): EvaluationFixture {
  if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= fixture.tracks.length) {
    throw new RangeError(
      `mutateFixturePosition: trackIndex ${String(trackIndex)} is out of range ` +
        `(fixture has ${fixture.tracks.length} tracks)`,
    );
  }
  if (typeof dxM !== "number" || !Number.isFinite(dxM)) {
    throw new RangeError(`mutateFixturePosition: dxM must be a finite number (got ${String(dxM)})`);
  }
  if (typeof dyM !== "number" || !Number.isFinite(dyM)) {
    throw new RangeError(`mutateFixturePosition: dyM must be a finite number (got ${String(dyM)})`);
  }
  const target = fixture.tracks[trackIndex]!;
  if (target.payload.kind !== "track") {
    throw new RangeError(
      `mutateFixturePosition: tracks[${trackIndex}] has payload kind "${target.payload.kind}" ` +
        '(requires "track")',
    );
  }
  const targetPosition = target.payload.position;
  const tracks = fixture.tracks.map((observation, index) => {
    if (index !== trackIndex) return observation;
    return Observation.parse({
      ...observation,
      payload: {
        ...observation.payload,
        position: {
          x: targetPosition.x + dxM,
          y: targetPosition.y + dyM,
        },
      },
    });
  });
  return deepFreeze({
    sessionId: fixture.sessionId,
    tracks: deepFreeze(tracks),
    candidates: fixture.candidates,
  });
}
