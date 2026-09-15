/**
 * W403 fixture tests — the FIXED evaluation input, pinned.
 *
 * The fixture is the single input every evaluation run consumes: these
 * tests pin its SHAPE (counts, grids, occlusion gap, linear motions,
 * candidate sequence, lexicon), its VALIDITY (every observation parses
 * with the contracts `Observation` schema), its IMMUTABILITY (deep-frozen),
 * its DETERMINISM (two builds are deep-equal), and the
 * `mutateFixturePosition` helper's exact-delta/purity/fail-loud contract.
 */
import { describe, expect, test } from "bun:test";
import { Observation } from "@sporta/contracts";
import {
  BALL_OCCLUSION_GAP,
  CANDIDATE_EVENT_TYPES,
  CANDIDATE_GRID_STEP_MS,
  EVALUATION_ENTITY_LEXICON,
  EVALUATION_LAST_EVENT_TIME_MS,
  EVALUATION_SESSION_ID,
  TRACK_FRAME_COUNT,
  TRACK_FRAME_STEP_MS,
  TRACK_START_MS,
  buildEvaluationFixture,
  mutateFixturePosition,
} from "../src/index";
import type { EvaluationFixture } from "../src/index";
import type { Observation as ObservationDoc, TrackPayload } from "@sporta/contracts";

/** Narrows an observation's payload to the track variant (fail loud). */
function trackPayloadOf(observation: ObservationDoc): TrackPayload {
  if (observation.payload.kind !== "track") {
    throw new Error(`observation ${observation.observationId} is not a track payload`);
  }
  return observation.payload;
}

/** The expected per-subject observation counts (the ball skips 5 frames). */
const EXPECTED_TRACK_COUNTS: Readonly<Record<string, number>> = {
  p1: TRACK_FRAME_COUNT,
  p2: TRACK_FRAME_COUNT,
  p3: TRACK_FRAME_COUNT,
  ball: TRACK_FRAME_COUNT - (BALL_OCCLUSION_GAP.toFrame - BALL_OCCLUSION_GAP.fromFrame + 1),
};

describe("fixture — shape and grid (pinned constants)", () => {
  const fixture = buildEvaluationFixture();

  test("the session and the observation counts", () => {
    expect(fixture.sessionId).toBe(EVALUATION_SESSION_ID);
    expect(fixture.tracks).toHaveLength(
      EXPECTED_TRACK_COUNTS.p1! +
        EXPECTED_TRACK_COUNTS.p2! +
        EXPECTED_TRACK_COUNTS.p3! +
        EXPECTED_TRACK_COUNTS.ball!,
    ); // 60 + 60 + 60 + 55 = 235
    expect(fixture.candidates).toHaveLength(6);
  });

  test("every observation belongs to the fixture session and is zod-valid", () => {
    for (const observation of [...fixture.tracks, ...fixture.candidates]) {
      expect(observation.sessionId).toBe(EVALUATION_SESSION_ID);
      expect(() => Observation.parse(observation)).not.toThrow();
    }
  });

  test("tracks ride the 40 ms grid starting at 20400 ms (after the event horizon)", () => {
    const perSubject = new Map<string, number>();
    for (const observation of fixture.tracks) {
      const payload = trackPayloadOf(observation);
      const frame = Number(observation.observationId.match(/f(\d{3})-/)?.[1]);
      expect(observation.eventTimeMs).toBe(TRACK_START_MS + frame * TRACK_FRAME_STEP_MS);
      perSubject.set(payload.entityId, (perSubject.get(payload.entityId) ?? 0) + 1);
    }
    for (const [entityId, count] of perSubject) {
      expect(count).toBe(EXPECTED_TRACK_COUNTS[entityId]!);
    }
  });

  test("the ball stream carries EXACTLY one occlusion gap (frames 30-34 absent)", () => {
    const ballFrames = fixture.tracks
      .filter((observation) => trackPayloadOf(observation).entityId === "ball")
      .map((observation) => Number(observation.observationId.match(/f(\d{3})-/)?.[1]));
    for (let frame = 0; frame < TRACK_FRAME_COUNT; frame += 1) {
      const inGap = frame >= BALL_OCCLUSION_GAP.fromFrame && frame <= BALL_OCCLUSION_GAP.toFrame;
      expect(ballFrames.includes(frame)).toBe(!inGap);
    }
    // The gap is 200 ms of honest no-observation (5 frames x 40 ms).
    expect(BALL_OCCLUSION_GAP.toFrame - BALL_OCCLUSION_GAP.fromFrame).toBe(4);
  });

  test("motions are LINEAR: p3 frame 59 sits at start + 59 * delta", () => {
    const p3 = fixture.tracks.find(
      (observation) => observation.observationId === "w403-trk-f059-p3",
    )!;
    expect(trackPayloadOf(p3).position.x).toBeCloseTo(15 + 59 * 0.12, 12);
    expect(trackPayloadOf(p3).position.y).toBeCloseTo(12 + 59 * 0.06, 12);
  });

  test("candidates: the six event types on the 5 s grid, lexicon subjects", () => {
    fixture.candidates.forEach((observation, index) => {
      expect(observation.modality).toBe("commentary");
      expect(observation.payload.kind).toBe("generic");
      expect(observation.eventTimeMs).toBe(index * CANDIDATE_GRID_STEP_MS);
      const data = (observation.payload as { data: Record<string, unknown> }).data;
      expect(data.eventType).toBe(CANDIDATE_EVENT_TYPES[index]);
      for (const subject of data.subjects as ReadonlyArray<{ name: string }>) {
        expect(EVALUATION_ENTITY_LEXICON.players as readonly string[]).toContain(subject.name);
      }
    });
    // The event horizon: the save at 20000 ms is the LAST LOG EVENT; the
    // fulltime candidate at 25000 ms is a clock patch, never a log entry.
    expect(EVALUATION_LAST_EVENT_TIME_MS).toBe(20_000);
    expect(fixture.candidates[5]!.eventTimeMs).toBe(25_000);
  });
});

describe("fixture — immutability and determinism", () => {
  test("the fixture is deep-frozen (documented immutable)", () => {
    const fixture = buildEvaluationFixture();
    expect(Object.isFrozen(fixture)).toBe(true);
    expect(Object.isFrozen(fixture.tracks)).toBe(true);
    expect(Object.isFrozen(fixture.candidates)).toBe(true);
    for (const observation of fixture.tracks) {
      expect(Object.isFrozen(observation)).toBe(true);
      expect(Object.isFrozen(observation.payload)).toBe(true);
      if (observation.payload.kind === "track") {
        expect(Object.isFrozen(observation.payload.position)).toBe(true);
      }
    }
  });

  test("two builds are deep-equal (the fixture is a pure function of its constants)", () => {
    expect(buildEvaluationFixture()).toEqual(buildEvaluationFixture());
  });
});

describe("mutateFixturePosition — the negative-test helper", () => {
  const fixture = buildEvaluationFixture();
  const targetIndex = fixture.tracks.findIndex(
    (observation) => observation.observationId === "w403-trk-f059-p3",
  );

  test("perturbs ONE observation's position by EXACT deltas, nothing else", () => {
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    const mutated = mutateFixturePosition(fixture, targetIndex, 0.5, -0.25);
    const target = trackPayloadOf(mutated.tracks[targetIndex]!);
    const original = trackPayloadOf(fixture.tracks[targetIndex]!);
    expect(target.position.x).toBe(original.position.x + 0.5);
    expect(target.position.y).toBe(original.position.y - 0.25);
    // Same observation ids, same times, same counts — only the position moved.
    expect(mutated.tracks).toHaveLength(fixture.tracks.length);
    expect(mutated.tracks[targetIndex]!.observationId).toBe(
      fixture.tracks[targetIndex]!.observationId,
    );
    expect(mutated.tracks[targetIndex]!.eventTimeMs).toBe(fixture.tracks[targetIndex]!.eventTimeMs);
    // The mutated observation is still contract-valid.
    expect(() => Observation.parse(mutated.tracks[targetIndex]!)).not.toThrow();
  });

  test("is PURE: the original frozen fixture is untouched", () => {
    const before = buildEvaluationFixture();
    mutateFixturePosition(fixture, targetIndex, 1, 1);
    expect(fixture).toEqual(before);
    // And a fresh build is still equal to the untouched original.
    expect(buildEvaluationFixture()).toEqual(before);
  });

  test("fails loud on an out-of-range index or non-finite deltas (repo style)", () => {
    expect(() => mutateFixturePosition(fixture, -1, 1, 0)).toThrow(RangeError);
    expect(() => mutateFixturePosition(fixture, fixture.tracks.length, 1, 0)).toThrow(RangeError);
    expect(() => mutateFixturePosition(fixture, 0, Number.NaN, 0)).toThrow(RangeError);
    expect(() => mutateFixturePosition(fixture, 0, 1, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });

  test("accepts a zero mutation (a no-op copy is still a fresh fixture)", () => {
    const unchanged = mutateFixturePosition(fixture, targetIndex, 0, 0);
    expect(unchanged.tracks[targetIndex]).toEqual(fixture.tracks[targetIndex]);
    expect(unchanged).toEqual(fixture);
  });
});

describe("mutateFixturePosition — the mutation SURVIVES the store->fusion chain", () => {
  const fixture = buildEvaluationFixture();
  const targetIndex = fixture.tracks.findIndex(
    (observation) => observation.observationId === "w403-trk-f059-p3",
  );

  test("the chosen target is the entity's LAST observation (nothing later overwrites it)", () => {
    // The fusion upserts track observations in time order and W006 replaces
    // entity state wholesale, so only a mutation on the entity's LAST track
    // observation can survive to the fused entity. This pins the test
    // fixture choice used by the mutation tests: frame 59 is p3's last.
    const p3Observations = fixture.tracks.filter(
      (observation) => trackPayloadOf(observation).entityId === "p3",
    );
    const last = p3Observations.at(-1)!;
    expect(last.observationId).toBe("w403-trk-f059-p3");
    expect(last.eventTimeMs).toBe(TRACK_START_MS + 59 * TRACK_FRAME_STEP_MS);
  });

  test("the mutated fixture is still a valid EvaluationFixture (session preserved)", () => {
    const mutated: EvaluationFixture = mutateFixturePosition(fixture, targetIndex, 0.5, 0);
    expect(mutated.sessionId).toBe(fixture.sessionId);
    expect(mutated.candidates).toBe(fixture.candidates);
  });
});
