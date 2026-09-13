import { describe, expect, test } from "bun:test";
import { Observation, SCHEMA_VERSION } from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import { buildObservation } from "@sporta/testing";
import { NearestBoxBallTracker, generateScenarioFrames } from "@sporta/ball-tracking";
import type { BallScenarioSpec } from "@sporta/ball-tracking";
import { emitBallStateObservations, validateObservation } from "../src/observe";
import { estimateBallState } from "../src/state";
import type { BallStateSeries } from "../src/state";

const SESSION_ID = "sess-w205-emission";
const COMPONENT_ID = "ball-state-v1";

/**
 * The 400 ms bridged-occlusion scenario: 50 state points (40 detected +
 * 10 interpolated at frames 5..14), 48 of which carry velocity (all but
 * the two series ends).
 */
const BRIDGED_400: BallScenarioSpec = {
  label: "emission-bridged-400",
  fps: 25,
  durationMs: 2000,
  flight: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [{ fromMs: 200, toMs: 600 }],
  detectionNoise: 0,
  dropRate: 0,
};

function fixtureSeries(): BallStateSeries {
  const { frames } = generateScenarioFrames(BRIDGED_400);
  const tracks = new NearestBoxBallTracker().track(frames);
  return estimateBallState(tracks, { fps: 25 });
}

describe("emitBallStateObservations", () => {
  const series = fixtureSeries();
  const observations = emitBallStateObservations({
    sessionId: SESSION_ID,
    componentId: COMPONENT_ID,
    series,
  });

  test("one observation per state point (50), in series order", () => {
    expect(observations).toHaveLength(50);
    expect(observations[0]?.eventTimeMs).toBe(0);
    expect(observations[49]?.eventTimeMs).toBe(1960);
  });

  test("every emitted record parses with the contracts Observation zod schema", () => {
    for (const observation of observations) {
      expect(() => Observation.parse(observation)).not.toThrow();
      expect(validateObservation(observation)).toBe(true);
    }
  });

  test("provenance maps detected→OBSERVED, interpolated→DERIVED (interpolated state is inference, not observation)", () => {
    expect(observations.filter((o) => o.provenance === "OBSERVED")).toHaveLength(40);
    expect(observations.filter((o) => o.provenance === "DERIVED")).toHaveLength(10);
    for (const [index, observation] of observations.entries()) {
      const point = series.points[index];
      if (point === undefined) throw new Error("point missing");
      expect(observation.provenance).toBe(point.source === "detected" ? "OBSERVED" : "DERIVED");
    }
    // The interpolated window is exactly frames 5..14.
    for (const k of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      expect(observations[k]?.provenance).toBe("DERIVED");
    }
  });

  test("payload: kind track, entityId 'ball', positions copied (not aliased)", () => {
    for (const [index, observation] of observations.entries()) {
      if (observation.payload.kind !== "track") {
        throw new Error(`payload ${index} is not a track payload`);
      }
      expect(observation.payload.entityId).toBe("ball");
      const point = series.points[index];
      if (point === undefined) throw new Error("point missing");
      expect(observation.payload.position).toEqual(point.position);
      expect(observation.payload.position).not.toBe(point.position);
    }
  });

  test("velocity key is ABSENT (not zero) when undefined; present and copied when defined", () => {
    // Series ends (frames 0 and 49) have no velocity: the key must be
    // absent from the payload entirely, never zero-filled.
    const first = observations[0]?.payload;
    const last = observations[49]?.payload;
    if (first?.kind !== "track" || last?.kind !== "track") throw new Error("not track payloads");
    expect("velocity" in first).toBe(false);
    expect(first.velocity).toBeUndefined();
    expect("velocity" in last).toBe(false);
    expect(last.velocity).toBeUndefined();

    // Interior points (48 of them) carry a velocity equal to the state
    // point's (copied, not aliased).
    let interior = 0;
    for (const [index, observation] of observations.entries()) {
      if (observation.payload.kind !== "track") throw new Error("not a track payload");
      const point = series.points[index];
      if (point === undefined) throw new Error("point missing");
      if (point.velocity === undefined) continue;
      interior += 1;
      expect(observation.payload.velocity).toEqual(point.velocity);
      expect(observation.payload.velocity).not.toBe(point.velocity);
    }
    expect(interior).toBe(48);
  });

  test("subjectEntityRefs matches the LocalEntityRef shape exactly (entityId + kind only)", () => {
    for (const observation of observations) {
      expect(observation.subjectEntityRefs).toEqual([{ entityId: "ball", kind: "ball" }]);
      const ref = observation.subjectEntityRefs[0];
      if (ref === undefined) throw new Error("ref missing");
      expect(Object.keys(ref).sort()).toEqual(["entityId", "kind"]);
    }
  });

  test("observationIds are unique with the documented bs-<frameId> shape", () => {
    expect(new Set(observations.map((o) => o.observationId)).size).toBe(50);
    expect(observations[0]?.observationId).toBe("bs-f-0-0");
    expect(observations[7]?.observationId).toBe("bs-f-0-7");
    expect(observations[49]?.observationId).toBe("bs-f-0-49");
  });

  test("confidence and scalar fields pass through verbatim", () => {
    for (const [index, observation] of observations.entries()) {
      const point = series.points[index];
      if (point === undefined) throw new Error("point missing");
      expect(observation.confidence).toBe(point.confidence);
      expect(observation.eventTimeMs).toBe(point.presentationMs);
      expect(observation.sessionId).toBe(SESSION_ID);
      expect(observation.componentId).toBe(COMPONENT_ID);
      expect(observation.schemaVersion).toBe(SCHEMA_VERSION);
      expect(observation.modality).toBe("vision");
      expect(observation.ingestTimeMs).toBeUndefined(); // no clock in this package
    }
    // Detected frames keep 0.85; interpolated frames keep the decay.
    expect(observations[0]?.confidence).toBe(0.85);
    expect(observations[5]?.confidence).toBe(0.85 * Math.pow(0.5, 1));
  });

  test("a repeated frameId in a hand-built series appends -<index> (ids never collide)", () => {
    const handBuilt: BallStateSeries = {
      entityId: "ball",
      points: [
        {
          frameId: "f-x",
          presentationMs: 100,
          trackId: "bt-0-1",
          position: { x: 0.5, y: 0.5 },
          confidence: 0.85,
          source: "detected",
        },
        {
          frameId: "f-x",
          presentationMs: 140,
          trackId: "bt-0-2",
          position: { x: 0.52, y: 0.5 },
          confidence: 0.4,
          source: "interpolated",
        },
      ],
      gaps: [],
    };
    const emitted = emitBallStateObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      series: handBuilt,
    });
    expect(emitted.map((o) => o.observationId)).toEqual(["bs-f-x", "bs-f-x-1"]);
    expect(emitted[0]?.provenance).toBe("OBSERVED");
    expect(emitted[1]?.provenance).toBe("DERIVED");
    expect(validateObservation(emitted[0])).toBe(true);
    expect(validateObservation(emitted[1])).toBe(true);
  });

  test("emitted records are store-compatible (the SWM evidence path) and interop with @sporta/testing", () => {
    const store = new InMemoryObservationStore();
    for (const observation of observations) {
      expect(store.append(observation)).toBe("appended");
    }
    expect(store.count()).toBe(50);

    // A builder-made observation from the shared harness appends alongside
    // the emitted ones (same schema, same store).
    const builderMade = buildObservation({ sessionId: SESSION_ID }, 42);
    expect(store.append(builderMade)).toBe("appended");
    expect(store.count()).toBe(51);

    const ballTracks = store.query({
      sessionId: SESSION_ID,
      kind: "track",
      modality: "vision",
    });
    expect(ballTracks).toHaveLength(50);
    expect(store.byId("bs-f-0-7")).toBeDefined();
    // Store order is canonical: ascending eventTimeMs.
    expect(ballTracks[0]?.eventTimeMs).toBe(0);
    expect(ballTracks[49]?.eventTimeMs).toBe(1960);
  });

  test("empty series -> no observations", () => {
    expect(
      emitBallStateObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        series: { entityId: "ball", points: [], gaps: [] },
      }),
    ).toEqual([]);
  });

  test("validateObservation rejects contract-invalid records", () => {
    const [valid] = observations;
    expect(valid).toBeDefined();
    if (valid === undefined) throw new Error("missing");
    expect(validateObservation(valid)).toBe(true);
    expect(validateObservation({ ...valid, confidence: 1.5 })).toBe(false);
    expect(validateObservation({ ...valid, eventTimeMs: -1 })).toBe(false);
    expect(validateObservation({ ...valid, modality: "haptic" })).toBe(false);
    expect(validateObservation({ ...valid, provenance: "GUESSED" })).toBe(false);
    expect(validateObservation({ ...valid, payload: { kind: "track", entityId: "ball" } })).toBe(
      false,
    );
    expect(validateObservation("not-an-object")).toBe(false);
  });

  test("fails loud on malformed emission input (nothing is fabricated)", () => {
    expect(() =>
      emitBallStateObservations({ sessionId: "", componentId: COMPONENT_ID, series }),
    ).toThrow(RangeError);
    expect(() =>
      emitBallStateObservations({ sessionId: SESSION_ID, componentId: "", series }),
    ).toThrow(RangeError);
    // A non-ball series is not this emitter's domain.
    const alien = { ...series, entityId: "shoe" as unknown as "ball" };
    expect(() =>
      emitBallStateObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        series: alien,
      }),
    ).toThrow(RangeError);
    // A point with an out-of-range confidence would fabricate an invalid
    // observation — refuse instead.
    const badConfidence: BallStateSeries = {
      entityId: "ball",
      points: [
        {
          frameId: "f-0-0",
          presentationMs: 0,
          trackId: "bt-0-1",
          position: { x: 0.5, y: 0.5 },
          confidence: 1.5,
          source: "detected",
        },
      ],
      gaps: [],
    };
    expect(() =>
      emitBallStateObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        series: badConfidence,
      }),
    ).toThrow(RangeError);
  });
});
