import { describe, expect, test } from "bun:test";
import { Observation, SCHEMA_VERSION } from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import { buildObservation } from "@sporta/testing";
import { CANONICAL_CORNER_ORDER } from "@sporta/field-mapping";
import type { FieldCornerSet } from "@sporta/field-mapping";
import type { TrackClock } from "@sporta/timeline";
import { emitSpatialObservations, validateObservation } from "../src/observe";
import type { SpatialStateSeries } from "../src/state";
import { alignSessionMs } from "../src/align";
import { estimateSpatialState } from "../src/state";
import type { SpatialFrame } from "../src/state";

/**
 * W206 emission tests: every observation parses against the contracts
 * `Observation` zod schema; eventTimeMs is the point's SESSION time (not
 * the frame-native presentationMs); provenance is DERIVED (projection is
 * inference from OBSERVED corners + tracks); entityId is the track id; NO
 * velocity key; observationIds follow "sp-<frameId>-<trackId>" and are
 * unique; subjectEntityRefs kinds follow W204's label map. An affine clock
 * (offset +50, drift 1000 ppm) makes session time visibly DIFFERENT from
 * presentation time. Constants only.
 */

const SESSION_ID = "sess-w206-emission";
const COMPONENT_ID = "spatial-state-w206";

/** Affine clock: sessionMs = presentationMs + 50 + presentationMs / 1000. */
const CLOCK: TrackClock = { trackId: "video", offsetMs: 50, driftPpm: 1000 };

const IDENTITY_CORNER_SET: FieldCornerSet = {
  corners: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  cornerOrder: CANONICAL_CORNER_ORDER,
  confidence: 0.9,
};

// Identity camera: X = 105u, Y = 68v — all expected positions bit-exact.
// player t1 center (0.5, 0.5) -> (52.5, 34); ball t2 center (0.75, 0.1875)
// -> (78.75, 12.75); unmapped-label t3 center (0.25, 0.5) -> (26.25, 34).
const TRACKS = [
  { box: { x: 0.25, y: 0.375, w: 0.5, h: 0.25 }, label: "player", confidence: 0.8, trackId: "t1" },
  {
    box: { x: 0.6875, y: 0.125, w: 0.125, h: 0.125 },
    label: "ball",
    confidence: 0.75,
    trackId: "t2",
  },
  { box: { x: 0, y: 0.375, w: 0.5, h: 0.25 }, label: "coach", confidence: 0.5, trackId: "t3" },
];

const FRAMES: SpatialFrame[] = [0, 1, 2].map((d) => ({
  frame: { frameId: `f-0-${d}`, presentationMs: d * 40, decodeOrder: d },
  cornerSet: IDENTITY_CORNER_SET,
  tracks: TRACKS,
}));

const SERIES = estimateSpatialState(FRAMES, { clock: CLOCK });

describe("emitSpatialObservations — SWM-facing emission", () => {
  const observations = emitSpatialObservations({
    sessionId: SESSION_ID,
    componentId: COMPONENT_ID,
    series: SERIES,
  });

  test("one zod-valid Observation per point, first record exact", () => {
    expect(observations).toHaveLength(9); // 3 frames x 3 tracks
    for (const observation of observations) {
      expect(() => Observation.parse(observation)).not.toThrow();
      expect(validateObservation(observation)).toBe(true);
    }
    expect(observations[0]).toEqual({
      observationId: "sp-f-0-0-t1", // "sp-<frameId>-<trackId>"
      sessionId: SESSION_ID,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: 50, // SESSION time: presentationMs 0 + offset 50
      modality: "vision",
      componentId: COMPONENT_ID,
      provenance: "DERIVED", // projection is inference, not observation
      confidence: 0.8, // fused min(0.8, 0.9)
      payload: {
        kind: "track",
        entityId: "t1", // the track id IS the payload entityId
        position: { x: 52.5, y: 34 }, // PITCH METERS (exact, identity camera)
      },
      subjectEntityRefs: [{ entityId: "t1", kind: "participant" }],
    });
  });

  test("eventTimeMs equals the point's sessionMs — NOT the presentationMs", () => {
    observations.forEach((observation, i) => {
      const point = SERIES.points[i]!;
      expect(observation.eventTimeMs).toBe(point.sessionMs);
    });
    // The frame-native convention difference, made visible: frame 1's
    // presentationMs is 40, its session time is 40 + 50 + 0.04 = 90.04.
    expect(observations[3]!.eventTimeMs).toBe(alignSessionMs(CLOCK, 40));
    expect(observations[3]!.eventTimeMs).toBeCloseTo(90.04, 9);
    expect(observations[3]!.eventTimeMs).not.toBe(40);
    expect(observations[6]!.eventTimeMs).toBe(alignSessionMs(CLOCK, 80));
  });

  test("provenance DERIVED, modality vision, on every record", () => {
    for (const observation of observations) {
      expect(observation.provenance).toBe("DERIVED");
      expect(observation.modality).toBe("vision");
      expect(observation.componentId).toBe(COMPONENT_ID);
      expect(observation.schemaVersion).toBe(SCHEMA_VERSION);
    }
  });

  test("payload: entityId = trackId, pitch meters exact, NO velocity key", () => {
    const byId = new Map(observations.map((o) => [o.observationId, o]));
    const player = byId.get("sp-f-0-0-t1")!;
    expect(player.payload.kind).toBe("track");
    if (player.payload.kind === "track") {
      expect(player.payload.entityId).toBe("t1");
      expect(player.payload.position).toEqual({ x: 52.5, y: 34 });
      expect("velocity" in player.payload).toBe(false); // W205/later fusion owns velocity
      expect(player.payload.velocity).toBeUndefined();
    }
    const ball = byId.get("sp-f-0-1-t2")!;
    expect(ball.payload.kind).toBe("track");
    if (ball.payload.kind === "track") {
      expect(ball.payload.entityId).toBe("t2");
      expect(ball.payload.position).toEqual({ x: 78.75, y: 12.75 });
      expect("velocity" in ball.payload).toBe(false);
    }
  });

  test("subjectEntityRefs kinds follow W204's FOOTBALL_LABEL_KINDS; unmapped -> []", () => {
    const byId = new Map(observations.map((o) => [o.observationId, o]));
    // player -> participant (exact LocalEntityRef shape: entityId + kind only)
    expect(byId.get("sp-f-0-0-t1")!.subjectEntityRefs).toEqual([
      { entityId: "t1", kind: "participant" },
    ]);
    // ball -> ball
    expect(byId.get("sp-f-0-0-t2")!.subjectEntityRefs).toEqual([{ entityId: "t2", kind: "ball" }]);
    // "coach" has NO mapping: no ref rather than an invented kind
    expect(byId.get("sp-f-0-0-t3")!.subjectEntityRefs).toEqual([]);
    expect(validateObservation(byId.get("sp-f-0-0-t3"))).toBe(true);
  });

  test("observationIds follow sp-<frameId>-<trackId> and are unique across the series", () => {
    expect(observations.map((o) => o.observationId)).toEqual([
      "sp-f-0-0-t1",
      "sp-f-0-0-t2",
      "sp-f-0-0-t3",
      "sp-f-0-1-t1",
      "sp-f-0-1-t2",
      "sp-f-0-1-t3",
      "sp-f-0-2-t1",
      "sp-f-0-2-t2",
      "sp-f-0-2-t3",
    ]);
    expect(new Set(observations.map((o) => o.observationId)).size).toBe(9);
  });

  test("confidence passthrough of the fused value", () => {
    const byId = new Map(observations.map((o) => [o.observationId, o]));
    expect(byId.get("sp-f-0-0-t1")!.confidence).toBe(0.8); // min(0.8, 0.9)
    expect(byId.get("sp-f-0-0-t2")!.confidence).toBe(0.75); // min(0.75, 0.9)
    expect(byId.get("sp-f-0-0-t3")!.confidence).toBe(0.5); // min(0.5, 0.9)
  });

  test("a hand-built point WITHOUT a label defaults to the participant kind", () => {
    // W206 is the player-position stream: label-less points (hand-built
    // input — estimator output always carries the W204 label) default to
    // "participant" per the work-item spec.
    const series: SpatialStateSeries = {
      frames: 1,
      points: [
        {
          trackId: "t9",
          frameId: "f-0-0",
          sessionMs: 120,
          pitch: { x: 52.5, y: 34 },
          inBounds: true,
          confidence: 0.9,
          sourceConfidences: { track: 0.9, corners: 0.9 },
        },
      ],
      outOfBounds: 0,
    };
    const [observation] = emitSpatialObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      series,
    });
    expect(observation).toBeDefined();
    expect(observation!.subjectEntityRefs).toEqual([{ entityId: "t9", kind: "participant" }]);
    expect(validateObservation(observation)).toBe(true);
  });

  test("validateObservation rejects contract-invalid records", () => {
    const [valid] = observations;
    expect(valid).toBeDefined();
    expect(validateObservation(valid)).toBe(true);
    expect(validateObservation({ ...valid!, confidence: 1.5 })).toBe(false);
    expect(validateObservation({ ...valid!, eventTimeMs: -1 })).toBe(false);
    expect(validateObservation({ ...valid!, modality: "haptic" })).toBe(false);
    expect(validateObservation({ ...valid!, provenance: "GUESSED" })).toBe(false);
    expect(validateObservation("not-an-object")).toBe(false);
  });

  test("emission input fails loud: empty ids, negative sessionMs", () => {
    expect(() =>
      emitSpatialObservations({ sessionId: "", componentId: COMPONENT_ID, series: SERIES }),
    ).toThrow(RangeError);
    expect(() =>
      emitSpatialObservations({ sessionId: SESSION_ID, componentId: "", series: SERIES }),
    ).toThrow(RangeError);
    const negative: SpatialStateSeries = {
      frames: 1,
      points: [
        {
          trackId: "t1",
          frameId: "f-0-0",
          sessionMs: -5, // a hand-built clock can map before session zero
          pitch: { x: 52.5, y: 34 },
          inBounds: true,
          confidence: 0.9,
          sourceConfidences: { track: 0.9, corners: 0.9 },
        },
      ],
      outOfBounds: 0,
    };
    expect(() =>
      emitSpatialObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        series: negative,
      }),
    ).toThrow(RangeError);
  });

  test("store-compatible and interop with @sporta/testing builders", () => {
    const store = new InMemoryObservationStore();
    for (const observation of observations) {
      expect(store.append(observation)).toBe("appended");
      // Idempotent on observationId (streaming-contract duplicate tolerance).
      expect(store.append(observation)).toBe("duplicate");
    }
    expect(store.count()).toBe(9);
    const queried = store.query({ sessionId: SESSION_ID, kind: "track" });
    expect(queried).toHaveLength(9);
    // Canonical session-time order: frame 0 (50 ms) first, frame 2 last.
    expect(queried[0]!.eventTimeMs).toBe(50);
    expect(queried[8]!.eventTimeMs).toBeCloseTo(130.08, 9);
    expect(store.byId("sp-f-0-1-t2")).toBeDefined();

    // A builder-made observation from the shared test harness (payload
    // overridden to a track; zod strips the detection leftovers) appends
    // alongside the emitted ones — same schema, same store.
    const builderMade = buildObservation(
      {
        sessionId: SESSION_ID,
        eventTimeMs: 500,
        payload: {
          kind: "track",
          entityId: "t1",
          position: { x: 42, y: 21 },
        },
      },
      42,
    );
    expect(store.append(builderMade)).toBe("appended");
    expect(store.count()).toBe(10);
  });
});
