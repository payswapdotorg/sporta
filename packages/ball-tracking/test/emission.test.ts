import { describe, expect, test } from "bun:test";
import { Observation, SCHEMA_VERSION } from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import { buildObservation } from "@sporta/testing";
import type { DetectedBox } from "@sporta/perception-detection";
import { NearestBoxBallTracker } from "../src/nearest-box";
import { generateScenarioFrames } from "../src/scenario";
import type { BallScenarioSpec } from "../src/scenario";
import { emitBallDetectionObservations, validateBallObservation } from "../src/observe";
import type { BallTrackPoint } from "../src/tracker";

const SESSION_ID = "sess-w202-emission";
const COMPONENT_ID = "nearest-box-v1";

const SPEC: BallScenarioSpec = {
  label: "emission-occluded-bridged",
  fps: 25,
  durationMs: 2000, // 50 frames, ms 0..1960
  flight: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [{ fromMs: 200, toMs: 600 }], // frames 5..14 occluded
  detectionNoise: 0,
  dropRate: 0,
};

describe("emitBallDetectionObservations", () => {
  // Shared fixture: one bridged track over 50 frames (40 detected points).
  const { frames } = generateScenarioFrames(SPEC);
  const tracks = new NearestBoxBallTracker().track(frames);
  const [track] = tracks;
  if (track === undefined) throw new Error("track missing");
  const points: readonly BallTrackPoint[] = track.points;

  const boxes = new Map<string, DetectedBox>();
  for (const frame of frames) {
    for (const detection of frame.detections) {
      boxes.set(frame.frameId, detection);
    }
  }
  expect(boxes.size).toBe(40); // the visible frames
  expect(points).toHaveLength(50); // 40 detected + 10 interpolated

  test("emits ONLY detected points — interpolated positions are not observations (W205 boundary)", () => {
    const observations = emitBallDetectionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      points,
      boxes,
    });
    // 40 detected points -> 40 observations; the 10 interpolated points
    // (frames 5..14) are skipped by design.
    expect(observations).toHaveLength(40);
    const occludedIds = new Set(Array.from({ length: 10 }, (_, i) => `btd-f-0-${5 + i}`));
    for (const observation of observations) {
      expect(occludedIds.has(observation.observationId)).toBe(false);
    }
  });

  test("every emitted record is zod-valid and carries the exact contract fields", () => {
    const observations = emitBallDetectionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      points,
      boxes,
    });
    for (const observation of observations) {
      expect(() => Observation.parse(observation)).not.toThrow();
      expect(validateBallObservation(observation)).toBe(true);
    }

    // The first record, field by field (frame 0: center 0.2/0.5, ms 0).
    const [first] = observations;
    if (first === undefined) throw new Error("observation missing");
    expect(first.observationId).toBe("btd-f-0-0");
    expect(first.sessionId).toBe(SESSION_ID);
    expect(first.schemaVersion).toBe(SCHEMA_VERSION);
    expect(first.eventTimeMs).toBe(0); // frame-native time: the point's presentationMs
    expect(first.modality).toBe("vision");
    expect(first.componentId).toBe(COMPONENT_ID);
    expect(first.provenance).toBe("OBSERVED");
    expect(first.confidence).toBe(0.85); // passthrough from the DetectedBox, verbatim
    expect(first.subjectEntityRefs).toEqual([]); // no identity: W204/W205 own it
    if (first.payload.kind !== "detection") throw new Error("not a detection payload");
    expect(first.payload.label).toBe("ball");
    // The box is the frame's detection box verbatim (copied, not aliased).
    const sourceBox = boxes.get("f-0-0")?.box;
    if (sourceBox === undefined) throw new Error("source box missing");
    expect(first.payload.box).toEqual(sourceBox);
    // Nominal geometry: the 0.04x0.04 square around (0.2, 0.5) (the exact
    // floats carry center-based-construction dust, hence closeness).
    expect(first.payload.box.x).toBeCloseTo(0.18, 12);
    expect(first.payload.box.y).toBeCloseTo(0.48, 12);
    expect(first.payload.box.w).toBeCloseTo(0.04, 12);
    expect(first.payload.box.h).toBeCloseTo(0.04, 12);

    // A detected point around the gap: frame 15 at ms 600.
    const gapAnchor = observations.find(
      (observation) => observation.observationId === "btd-f-0-15",
    );
    expect(gapAnchor?.eventTimeMs).toBe(600);
    expect(gapAnchor?.confidence).toBe(0.85);
  });

  test("observationIds are unique (one per detected frame)", () => {
    const observations = emitBallDetectionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      points,
      boxes,
    });
    expect(new Set(observations.map((observation) => observation.observationId)).size).toBe(40);
  });

  test("confidence passthrough: the detector's confidence, not tracker arithmetic", () => {
    // A detection with an unusual confidence flows through verbatim.
    const detection: DetectedBox = {
      box: { x: 0.48, y: 0.48, w: 0.04, h: 0.04 },
      label: "ball",
      confidence: 0.42,
    };
    const handPoints: readonly BallTrackPoint[] = [
      {
        frameId: "f-0-0",
        presentationMs: 0,
        box: detection.box,
        source: "detected",
        confidence: 0.42,
      },
    ];
    const handBoxes = new Map<string, DetectedBox>([["f-0-0", detection]]);
    const [observation] = emitBallDetectionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      points: handPoints,
      boxes: handBoxes,
    });
    expect(observation?.confidence).toBe(0.42);
  });

  test("payload boxes are copied, not aliased to caller-owned objects", () => {
    const observations = emitBallDetectionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      points,
      boxes,
    });
    const source = boxes.get("f-0-0");
    const [first] = observations;
    if (source === undefined || first === undefined) throw new Error("missing");
    if (first.payload.kind !== "detection") throw new Error("not a detection payload");
    expect(first.payload.box).toEqual(source.box);
    expect(first.payload.box).not.toBe(source.box);
  });

  test("empty input -> no observations, no ids minted", () => {
    expect(
      emitBallDetectionObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        points: [],
        boxes: new Map(),
      }),
    ).toEqual([]);
    // Interpolated-only points emit nothing either.
    expect(
      emitBallDetectionObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        points: [
          {
            frameId: "f-0-5",
            presentationMs: 200,
            box: { x: 0.2, y: 0.48, w: 0.04, h: 0.04 },
            source: "interpolated",
            confidence: 0.425,
          },
        ],
        boxes: new Map(),
      }),
    ).toEqual([]);
  });

  test("fails loud: detected point without a provided box, or duplicate frames", () => {
    const detectedPoint: BallTrackPoint = {
      frameId: "f-0-99",
      presentationMs: 3960,
      source: "detected",
      confidence: 0.85,
    };
    expect(() =>
      emitBallDetectionObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        points: [detectedPoint],
        boxes,
      }),
    ).toThrow(RangeError);

    const firstPoint = points[0];
    if (firstPoint === undefined) throw new Error("point missing");
    const duplicatePoints: readonly BallTrackPoint[] = [firstPoint, firstPoint];
    expect(() =>
      emitBallDetectionObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        points: duplicatePoints,
        boxes,
      }),
    ).toThrow(RangeError);
  });

  test("emitted records are store-compatible and interop with @sporta/testing", () => {
    const store = new InMemoryObservationStore();
    const observations = emitBallDetectionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      points,
      boxes,
    });
    for (const observation of observations) {
      expect(store.append(observation)).toBe("appended");
    }
    expect(store.count()).toBe(40);

    // A builder-made observation from the shared harness appends alongside
    // the emitted ones (same schema, same store).
    const builderMade = buildObservation({ sessionId: SESSION_ID, eventTimeMs: 200 }, 42);
    expect(store.append(builderMade)).toBe("appended");
    expect(store.count()).toBe(41);

    const ballDetections = store.query({
      sessionId: SESSION_ID,
      kind: "detection",
      modality: "vision",
    });
    expect(ballDetections).toHaveLength(41);
    expect(store.byId("btd-f-0-0")).toBeDefined();
    // Store order is canonical: ascending eventTimeMs (frames at 0..1960,
    // the builder-made record at 200 ms among them).
    expect(ballDetections[0]?.eventTimeMs).toBe(0);
    expect(ballDetections[40]?.eventTimeMs).toBe(1960);
  });

  test("validateBallObservation rejects contract-invalid records", () => {
    const [valid] = emitBallDetectionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      points,
      boxes,
    });
    expect(valid).toBeDefined();
    if (valid === undefined) throw new Error("missing");
    expect(validateBallObservation(valid)).toBe(true);
    expect(validateBallObservation({ ...valid, confidence: 1.5 })).toBe(false);
    expect(validateBallObservation({ ...valid, eventTimeMs: -1 })).toBe(false);
    expect(validateBallObservation({ ...valid, modality: "haptic" })).toBe(false);
    expect(validateBallObservation({ ...valid, provenance: "GUESSED" })).toBe(false);
    expect(validateBallObservation("not-an-object")).toBe(false);
  });
});
