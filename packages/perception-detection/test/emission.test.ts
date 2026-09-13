import { describe, expect, test } from "bun:test";
import { Observation, SCHEMA_VERSION } from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import { buildObservation } from "@sporta/testing";
import type { DetectedBox, DetectorFrameInput } from "../src/detector";
import { FixtureDetectorAdapter } from "../src/fixture-detector";
import { emitDetectionObservations, validateObservation } from "../src/observe";

const SESSION_ID = "sess-w201-emission";

function makeFrame(decodeOrder: number): DetectorFrameInput {
  return {
    frameId: `f-0-${decodeOrder}`,
    presentationMs: decodeOrder * 40,
    width: 4,
    height: 4,
    bytes: new Uint8Array(4 * 4 * 3),
    decodeOrder,
    streamIndex: 0,
  };
}

const SPEC = {
  detectorId: "fixture-det-emission",
  frames: 8,
  labels: [
    {
      label: "player",
      confidence: 0.9,
      // Binary-exact center/size so the expected box below is exact:
      // center (0.375, 0.625), size 0.25 -> box (0.25, 0.5, 0.25, 0.25).
      motion: { kind: "static", at: { x: 0.375, y: 0.625 } },
      size: { w: 0.25, h: 0.25 },
    },
    {
      label: "ball",
      confidence: 0.75,
      motion: { kind: "static", at: { x: 0.75, y: 0.25 } },
      size: { w: 0.125, h: 0.125 },
    },
  ],
} as const;

describe("emitDetectionObservations", () => {
  test("emits one zod-valid Observation per detection, with exact fields", () => {
    const frame = makeFrame(3);
    const detections = new FixtureDetectorAdapter(SPEC).detect(frame);
    expect(detections).toHaveLength(2);

    const observations = emitDetectionObservations({
      sessionId: SESSION_ID,
      componentId: SPEC.detectorId,
      frame,
      detections,
    });
    expect(observations).toHaveLength(2);

    // Parse ALL emitted records with the contracts Observation schema.
    for (const observation of observations) {
      expect(() => Observation.parse(observation)).not.toThrow();
      expect(validateObservation(observation)).toBe(true);
    }

    expect(observations[0]).toEqual({
      observationId: "det-f-0-3-0",
      sessionId: SESSION_ID,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: 120, // frame-native time: presentationMs of the frame
      modality: "vision",
      componentId: "fixture-det-emission",
      provenance: "OBSERVED",
      confidence: 0.9, // passthrough, no collapse
      payload: {
        kind: "detection",
        box: { x: 0.25, y: 0.5, w: 0.25, h: 0.25 },
        label: "player",
      },
      subjectEntityRefs: [], // detection carries no identity (W204's job)
    });
    const second = observations[1];
    expect(second?.payload.kind).toBe("detection");
    if (second?.payload.kind === "detection") {
      expect(second.payload.label).toBe("ball");
      expect(second.confidence).toBe(0.75);
      expect(second.observationId).toBe("det-f-0-3-1");
    }
  });

  test("observationIds are unique per frame and across frames", () => {
    const frames = [0, 1, 2, 3, 4].map(makeFrame);
    const detector = new FixtureDetectorAdapter(SPEC);
    const all = frames.flatMap((frame) =>
      emitDetectionObservations({
        sessionId: SESSION_ID,
        componentId: SPEC.detectorId,
        frame,
        detections: detector.detect(frame),
      }),
    );
    expect(all).toHaveLength(10);
    expect(new Set(all.map((o) => o.observationId)).size).toBe(10);
    // Pattern: "det-<frameId>-<index>".
    expect(all[0]?.observationId).toBe("det-f-0-0-0");
    expect(all[9]?.observationId).toBe("det-f-0-4-1");
  });

  test("payload boxes are copied, not aliased to detector-owned objects", () => {
    const frame = makeFrame(1);
    const detections: DetectedBox[] = new FixtureDetectorAdapter(SPEC).detect(frame);
    const source = detections[0];
    expect(source).toBeDefined();
    const [observation] = emitDetectionObservations({
      sessionId: SESSION_ID,
      componentId: SPEC.detectorId,
      frame,
      detections,
    });
    expect(observation?.payload.kind).toBe("detection");
    if (source && observation?.payload.kind === "detection") {
      expect(observation.payload.box).toEqual(source.box);
      expect(observation.payload.box).not.toBe(source.box);
    }
  });

  test("empty detections -> empty array (no clock, no ids minted)", () => {
    const observations = emitDetectionObservations({
      sessionId: SESSION_ID,
      componentId: SPEC.detectorId,
      frame: makeFrame(0),
      detections: [],
    });
    expect(observations).toEqual([]);
  });

  test("validateObservation rejects contract-invalid records", () => {
    const frame = makeFrame(0);
    const [valid] = emitDetectionObservations({
      sessionId: SESSION_ID,
      componentId: SPEC.detectorId,
      frame,
      detections: new FixtureDetectorAdapter(SPEC).detect(frame),
    });
    expect(validateObservation(valid)).toBe(true);
    expect(validateObservation({ ...valid, confidence: 1.5 })).toBe(false);
    expect(validateObservation({ ...valid, eventTimeMs: -1 })).toBe(false);
    // "commentary"/"DERIVED" are LEGAL enum values; these are not:
    expect(validateObservation({ ...valid, modality: "haptic" })).toBe(false);
    expect(validateObservation({ ...valid, provenance: "GUESSED" })).toBe(false);
    expect(validateObservation("not-an-object")).toBe(false);
  });

  test("emitted records are store-compatible and interop with @sporta/testing", () => {
    const store = new InMemoryObservationStore();
    const frames = [0, 1, 2].map(makeFrame);
    const detector = new FixtureDetectorAdapter(SPEC);
    const emitted = frames.flatMap((frame) =>
      emitDetectionObservations({
        sessionId: SESSION_ID,
        componentId: SPEC.detectorId,
        frame,
        detections: detector.detect(frame),
      }),
    );
    for (const observation of emitted) {
      expect(store.append(observation)).toBe("appended");
    }
    expect(store.count()).toBe(6);

    // A builder-made observation from the shared test harness appends
    // alongside the emitted ones (same schema, same store).
    const builderMade = buildObservation({ sessionId: SESSION_ID, eventTimeMs: 200 }, 42);
    expect(store.append(builderMade)).toBe("appended");
    expect(store.count()).toBe(7);

    const detectionsForSession = store.query({
      sessionId: SESSION_ID,
      kind: "detection",
      modality: "vision",
    });
    expect(detectionsForSession).toHaveLength(7);
    expect(store.byId("det-f-0-1-0")).toBeDefined();
    // Store order is canonical: ascending eventTimeMs (emitted frames at
    // 0/40/80 ms, the builder-made record last at 200 ms).
    expect(detectionsForSession[0]?.eventTimeMs).toBe(0);
    expect(detectionsForSession[6]?.eventTimeMs).toBe(200);
  });
});
