import { describe, expect, test } from "bun:test";
import { Observation, SCHEMA_VERSION } from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import { buildObservation } from "@sporta/testing";
import {
  CANONICAL_CORNER_ORDER,
  FixtureFieldCalibrator,
  type CalibratorFrameInput,
  type FieldCornerSet,
} from "../src/calibrator";
import { createPitchProjector } from "../src/project";
import { emitFieldMappingObservation, validateFieldMappingObservation } from "../src/observe";

const SESSION_ID = "sess-w203-emission";
const CALIBRATOR_ID = "fixture-field-cal-emission";

function makeFrame(decodeOrder: number): CalibratorFrameInput {
  return {
    frameId: `f-0-${decodeOrder}`,
    presentationMs: decodeOrder * 40,
    width: 160,
    height: 90,
    bytes: new Uint8Array(160 * 90 * 3),
    decodeOrder,
  };
}

function cornerSet(decodeOrder: number): FieldCornerSet {
  return new FixtureFieldCalibrator({ pan: 0.5, zoom: 1, jitter: 0 }, CALIBRATOR_ID).calibrate(
    makeFrame(decodeOrder),
  );
}

describe("emitFieldMappingObservation", () => {
  test("emits a zod-valid Observation with the exact contract fields", () => {
    const frame = makeFrame(3);
    const corners = cornerSet(3);
    const observation = emitFieldMappingObservation({
      sessionId: SESSION_ID,
      componentId: CALIBRATOR_ID,
      frame,
      cornerSet: corners,
    });

    expect(() => Observation.parse(observation)).not.toThrow();
    expect(validateFieldMappingObservation(observation)).toBe(true);

    expect(observation).toEqual({
      observationId: "fm-f-0-3", // "fm-<frameId>"
      sessionId: SESSION_ID,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: 120, // frame-native time: presentationMs of the frame
      modality: "vision",
      componentId: CALIBRATOR_ID,
      provenance: "OBSERVED",
      confidence: 0.9, // cornerSet.confidence passthrough, no collapse
      payload: {
        kind: "field-mapping",
        pitchCorners: corners.corners.map((c) => ({ ...c })),
        cameraHomographyRef: `homography-${SESSION_ID}-f-0-3`,
      },
      subjectEntityRefs: [], // no subject at field-mapping level (W204/W206's job)
    });
    // Deterministic emission: no wall-clock ingest time is invented here.
    expect("ingestTimeMs" in observation).toBe(false);
    expect(observation.payload.kind).toBe("field-mapping");
    if (observation.payload.kind === "field-mapping") {
      expect(observation.payload.pitchCorners).toHaveLength(4);
      expect(observation.payload.cameraHomographyRef).toBe(`homography-${SESSION_ID}-f-0-3`);
    }
  });

  test("stable ids: same inputs -> deep-equal records; ids unique per frame", () => {
    const emitted = [0, 1, 2, 3].map((d) =>
      emitFieldMappingObservation({
        sessionId: SESSION_ID,
        componentId: CALIBRATOR_ID,
        frame: makeFrame(d),
        cornerSet: cornerSet(d),
      }),
    );
    // Same emission twice -> identical record (deterministic, no clock).
    const again = emitFieldMappingObservation({
      sessionId: SESSION_ID,
      componentId: CALIBRATOR_ID,
      frame: makeFrame(2),
      cornerSet: cornerSet(2),
    });
    expect(again).toEqual(emitted[2]!);
    expect(new Set(emitted.map((o) => o.observationId)).size).toBe(4);
    expect(emitted.map((o) => o.observationId)).toEqual([
      "fm-f-0-0",
      "fm-f-0-1",
      "fm-f-0-2",
      "fm-f-0-3",
    ]);
    // cameraHomographyRef pattern: "homography-<sessionId>-<frameId>".
    for (const observation of emitted) {
      expect(observation.payload.kind).toBe("field-mapping");
      if (observation.payload.kind === "field-mapping") {
        const expectedFrameId = observation.observationId.slice("fm-".length);
        expect(observation.payload.cameraHomographyRef).toBe(
          `homography-${SESSION_ID}-${expectedFrameId}`,
        );
      }
    }
  });

  test("confidence passes through verbatim (hand-built corner set, 0.5)", () => {
    const handBuilt: FieldCornerSet = {
      corners: [
        { x: -0.5, y: -0.5 },
        { x: 1.5, y: -0.5 },
        { x: 1.5, y: 1.5 },
        { x: -0.5, y: 1.5 },
      ],
      cornerOrder: CANONICAL_CORNER_ORDER,
      confidence: 0.5,
    };
    const observation = emitFieldMappingObservation({
      sessionId: SESSION_ID,
      componentId: "hand-built-cal",
      frame: { frameId: "f-2-9", presentationMs: 360 },
      cornerSet: handBuilt,
    });
    expect(observation.confidence).toBe(0.5);
    expect(validateFieldMappingObservation(observation)).toBe(true);
  });

  test("payload corners are copies, not aliases of calibrator-owned objects", () => {
    const corners = cornerSet(1);
    const observation = emitFieldMappingObservation({
      sessionId: SESSION_ID,
      componentId: CALIBRATOR_ID,
      frame: makeFrame(1),
      cornerSet: corners,
    });
    expect(observation.payload.kind).toBe("field-mapping");
    if (observation.payload.kind === "field-mapping") {
      observation.payload.pitchCorners.forEach((corner, i) => {
        expect(corner).toEqual(corners.corners[i]!);
        expect(corner).not.toBe(corners.corners[i]!);
      });
    }
  });

  test("cameraHomographyRef is recoverable: the payload corners re-solve the homography", () => {
    // The ref documents that the solved homography is recoverable from the
    // corner set — prove it: rebuild a projector from the PAYLOAD corners
    // (plus the documented producer order) and project the image center.
    const observation = emitFieldMappingObservation({
      sessionId: SESSION_ID,
      componentId: CALIBRATOR_ID,
      frame: makeFrame(4),
      cornerSet: cornerSet(4),
    });
    expect(observation.payload.kind).toBe("field-mapping");
    if (observation.payload.kind !== "field-mapping") return;
    const recovered: FieldCornerSet = {
      corners: [
        { ...observation.payload.pitchCorners[0]! },
        { ...observation.payload.pitchCorners[1]! },
        { ...observation.payload.pitchCorners[2]! },
        { ...observation.payload.pitchCorners[3]! },
      ],
      cornerOrder: CANONICAL_CORNER_ORDER,
      confidence: observation.confidence ?? 0.9,
    };
    const projector = createPitchProjector(recovered);
    const center = projector.project({ x: 0.5, y: 0.5 });
    expect(center.x).toBeCloseTo(52.5, 10);
    expect(center.y).toBeCloseTo(34, 10);
    expect(center.inBounds).toBe(true);
  });

  test("validateFieldMappingObservation rejects contract-invalid records", () => {
    const observation = emitFieldMappingObservation({
      sessionId: SESSION_ID,
      componentId: CALIBRATOR_ID,
      frame: makeFrame(0),
      cornerSet: cornerSet(0),
    });
    expect(validateFieldMappingObservation(observation)).toBe(true);
    expect(validateFieldMappingObservation({ ...observation, confidence: 1.5 })).toBe(false);
    expect(validateFieldMappingObservation({ ...observation, eventTimeMs: -1 })).toBe(false);
    expect(
      validateFieldMappingObservation({
        ...observation,
        payload: {
          kind: "field-mapping",
          pitchCorners:
            observation.payload.kind === "field-mapping"
              ? observation.payload.pitchCorners.slice(0, 3)
              : [],
          cameraHomographyRef: "homography-x",
        },
      }),
    ).toBe(false); // exactly 4 corners required
    expect(validateFieldMappingObservation({ ...observation, modality: "haptic" })).toBe(false);
    expect(validateFieldMappingObservation({ ...observation, provenance: "GUESSED" })).toBe(false);
    expect(validateFieldMappingObservation("not-an-object")).toBe(false);
  });

  test("store-compatible and interop with @sporta/testing builders", () => {
    const store = new InMemoryObservationStore();
    const emitted = [0, 1, 2].map((d) =>
      emitFieldMappingObservation({
        sessionId: SESSION_ID,
        componentId: CALIBRATOR_ID,
        frame: makeFrame(d),
        cornerSet: cornerSet(d),
      }),
    );
    for (const observation of emitted) {
      expect(store.append(observation)).toBe("appended");
      // Idempotent on observationId (streaming-contract duplicate tolerance).
      expect(store.append(observation)).toBe("duplicate");
    }
    expect(store.count()).toBe(3);
    const queried = store.query({ sessionId: SESSION_ID, kind: "field-mapping" });
    expect(queried).toHaveLength(3);
    // Canonical eventTimeMs order: frames at 0/40/80 ms.
    expect(queried.map((o) => o.eventTimeMs)).toEqual([0, 40, 80]);
    expect(store.byId("fm-f-0-1")).toBeDefined();

    // A builder-made observation from the shared test harness (payload
    // overridden to a field-mapping; zod strips the detection leftovers)
    // appends alongside the emitted ones — same schema, same store.
    const builderMade = buildObservation(
      {
        sessionId: SESSION_ID,
        eventTimeMs: 200,
        payload: {
          kind: "field-mapping",
          pitchCorners: cornerSet(5).corners.map((c) => ({ ...c })),
          cameraHomographyRef: `homography-${SESSION_ID}-f-0-5`,
        },
      },
      42,
    );
    expect(store.append(builderMade)).toBe("appended");
    expect(store.count()).toBe(4);
    expect(store.query({ sessionId: SESSION_ID, kind: "field-mapping" })).toHaveLength(4);
  });
});
