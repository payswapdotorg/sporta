import { describe, expect, test } from "bun:test";
import { Observation, SCHEMA_VERSION } from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import { GreedyIouTracker } from "../src/tracker";
import type { TrackerFrameInput, TrackedBox } from "../src/tracker";
import { FOOTBALL_LABEL_KINDS, emitTrackObservations, validateObservation } from "../src/observe";

/**
 * W204 emission tests: every emitted record parses against the contracts
 * `Observation` zod schema; positions are exact hand-computed box centers;
 * identity refs follow the label->kind map (never invented); NO velocity;
 * ids unique per frame; confidence passthrough. Constants only.
 */

const SESSION_ID = "sess-w204-emission";
const COMPONENT_ID = "tracker-w204-emission";

function frame(d: number): TrackerFrameInput {
  return { frameId: `f-0-${d}`, presentationMs: d * 40, decodeOrder: d };
}

// Hand-computed center: box (0.25, 0.5, 0.25, 0.25) ->
// center (0.375, 0.625) (dyadic values, binary-exact).
const PLAYER_BOX = { x: 0.25, y: 0.5, w: 0.25, h: 0.25 };
const PLAYER_CENTER = { x: 0.375, y: 0.625 };
const BALL_BOX = { x: 0.6875, y: 0.125, w: 0.125, h: 0.125 };
const BALL_CENTER = { x: 0.75, y: 0.1875 };

function tracks(): TrackedBox[] {
  return [
    { box: PLAYER_BOX, label: "player", confidence: 0.92, trackId: "t1" },
    { box: BALL_BOX, label: "ball", confidence: 0.75, trackId: "t2" },
  ];
}

describe("emitTrackObservations", () => {
  test("emits one zod-valid Observation per tracked box, with exact fields", () => {
    const observations = emitTrackObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      frame: frame(3),
      tracks: tracks(),
    });
    expect(observations).toHaveLength(2);

    // Parse ALL emitted records with the contracts Observation schema.
    for (const observation of observations) {
      expect(() => Observation.parse(observation)).not.toThrow();
      expect(validateObservation(observation)).toBe(true);
    }

    expect(observations[0]).toEqual({
      observationId: "trk-f-0-3-0", // "trk-<frameId>-<index>"
      sessionId: SESSION_ID,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: 120, // frame-native time: presentationMs of the frame
      modality: "vision",
      componentId: COMPONENT_ID,
      provenance: "OBSERVED",
      confidence: 0.92, // passthrough, no collapse
      payload: {
        kind: "track",
        entityId: "t1", // the track id IS the payload entityId
        position: PLAYER_CENTER, // exact box center, normalized image space
      },
      subjectEntityRefs: [{ entityId: "t1", kind: "participant" }], // player
    });

    const second = observations[1];
    expect(second?.payload.kind).toBe("track");
    if (second?.payload.kind === "track") {
      expect(second.payload.entityId).toBe("t2");
      expect(second.payload.position).toEqual(BALL_CENTER);
      expect(second.confidence).toBe(0.75);
      expect(second.observationId).toBe("trk-f-0-3-1");
    }
    if (second !== undefined) {
      expect(second.subjectEntityRefs).toEqual([{ entityId: "t2", kind: "ball" }]);
    }
  });

  test("NO velocity key: state estimation is W205/W206, not the tracker", () => {
    const [observation] = emitTrackObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      frame: frame(0),
      tracks: tracks(),
    });
    expect(observation?.payload.kind).toBe("track");
    if (observation?.payload.kind === "track") {
      expect("velocity" in observation.payload).toBe(false);
      expect(observation.payload.velocity).toBeUndefined();
    }
  });

  test("unmapped label -> subjectEntityRefs [] (no ref rather than an invented kind)", () => {
    const observations = emitTrackObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      frame: frame(0),
      tracks: [{ box: PLAYER_BOX, label: "coach", confidence: 0.5, trackId: "t9" }],
    });
    // "coach" has no mapping in FOOTBALL_LABEL_KINDS: no ref is invented.
    expect(observations[0]?.subjectEntityRefs).toEqual([]);
    // The record is still fully contract-valid.
    expect(validateObservation(observations[0])).toBe(true);
    if (observations[0]?.payload.kind === "track") {
      expect(observations[0].payload.entityId).toBe("t9"); // identity intact
    }
  });

  test("labelToKind FULLY overrides the default map (replacement, not merge)", () => {
    const observations = emitTrackObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      frame: frame(0),
      tracks: tracks(),
      labelToKind: { player: "official", coach: "official" },
    });
    // "player" now maps to "official" (overridden) ...
    expect(observations[0]?.subjectEntityRefs).toEqual([{ entityId: "t1", kind: "official" }]);
    // ... and "ball" is NO LONGER mapped (the override replaced the default).
    expect(observations[1]?.subjectEntityRefs).toEqual([]);
    for (const observation of observations) {
      expect(validateObservation(observation)).toBe(true);
    }
  });

  test("FOOTBALL_LABEL_KINDS default map covers the four documented labels", () => {
    expect(FOOTBALL_LABEL_KINDS).toEqual({
      player: "participant",
      ball: "ball",
      official: "official",
      referee: "official",
    });
  });

  test("observationIds are unique per frame and follow trk-<frameId>-<index>", () => {
    const all = [0, 1, 2].flatMap((d) =>
      emitTrackObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        frame: frame(d),
        tracks: tracks(),
      }),
    );
    expect(all).toHaveLength(6);
    expect(new Set(all.map((o) => o.observationId)).size).toBe(6);
    expect(all[0]?.observationId).toBe("trk-f-0-0-0");
    expect(all[5]?.observationId).toBe("trk-f-0-2-1");
  });

  test("validateObservation rejects contract-invalid records", () => {
    const [valid] = emitTrackObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      frame: frame(0),
      tracks: tracks(),
    });
    expect(validateObservation(valid)).toBe(true);
    expect(validateObservation({ ...valid, confidence: 1.5 })).toBe(false);
    expect(validateObservation({ ...valid, eventTimeMs: -1 })).toBe(false);
    expect(validateObservation({ ...valid, modality: "haptic" })).toBe(false);
    expect(validateObservation({ ...valid, provenance: "GUESSED" })).toBe(false);
    expect(validateObservation("not-an-object")).toBe(false);
  });

  test("empty tracks -> empty array (no ids minted, no clock)", () => {
    expect(
      emitTrackObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        frame: frame(0),
        tracks: [],
      }),
    ).toEqual([]);
  });

  test("end-to-end with the tracker: emitted records are store-compatible", () => {
    // Tracker over a 4-frame fixture: one drifting player + a static ball.
    const tracker = new GreedyIouTracker({}, COMPONENT_ID);
    const store = new InMemoryObservationStore();
    const observations = [];
    for (let d = 0; d < 4; d += 1) {
      const output = tracker.assign(frame(d), [
        { box: { x: 0.25 + 0.01 * d, y: 0.5, w: 0.25, h: 0.25 }, label: "player", confidence: 0.9 },
        { box: BALL_BOX, label: "ball", confidence: 0.75 },
      ]);
      observations.push(
        ...emitTrackObservations({
          sessionId: SESSION_ID,
          componentId: COMPONENT_ID,
          frame: frame(d),
          tracks: output,
        }),
      );
    }

    expect(observations).toHaveLength(8);
    for (const observation of observations) {
      expect(() => Observation.parse(observation)).not.toThrow();
      expect(store.append(observation)).toBe("appended");
    }
    expect(store.count()).toBe(8);

    // Track payloads query back by kind and stay identity-consistent: every
    // player observation carries entityId t1, every ball t2.
    const trackObservations = store.query({ sessionId: SESSION_ID, kind: "track" });
    expect(trackObservations).toHaveLength(8);
    const entityIds = trackObservations.map((o) =>
      o.payload.kind === "track" ? o.payload.entityId : "?",
    );
    expect(new Set(entityIds)).toEqual(new Set(["t1", "t2"]));
    // Canonical eventTimeMs order: frame 0 first (0 ms), frame 3 last (120 ms).
    expect(trackObservations[0]?.eventTimeMs).toBe(0);
    expect(trackObservations[7]?.eventTimeMs).toBe(120);
  });
});
