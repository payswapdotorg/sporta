import { describe, expect, test } from "bun:test";
import { Observation, SCHEMA_VERSION } from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import type { FixtureTrackSpec } from "@sporta/perception-tracking";
import { emitSpatialObservations, validateObservation } from "../src/observe";
import type { SpatialStateSeries } from "../src/state";
import { fuseFixtureScenario, pointWith } from "./helpers";

/**
 * Emission tests (the brief's §3.6 group): every observation parses with the
 * contracts Observation zod schema; eventTimeMs is the point's SESSION time
 * (NOT the frame-native presentationMs); provenance is DERIVED (projection is
 * inference from OBSERVED corners + OBSERVED tracks); entityId = trackId;
 * NO velocity key; observationId uniqueness; subjectEntityRefs kinds correct
 * for the player label. Constants only — no clock reads, no RNG.
 */

const AFFINE = { trackId: "t-0-video", offsetMs: 50, driftPpm: 1000 };

const HAND_BUILT: SpatialStateSeries = {
  frames: 2,
  points: [
    {
      trackId: "t1",
      frameId: "f-0-0",
      sessionMs: 150,
      pitch: { x: 52.5, y: 34 },
      inBounds: true,
      confidence: 0.9,
      sourceConfidences: { track: 0.9, corners: 0.9 },
      label: "player",
    },
    {
      trackId: "t2",
      frameId: "f-0-1",
      sessionMs: 190,
      pitch: { x: 60, y: 30 },
      inBounds: true,
      confidence: 0.9,
      sourceConfidences: { track: 0.9, corners: 0.9 },
      label: "player",
    },
  ],
  outOfBounds: 0,
};

function emit(series: SpatialStateSeries) {
  return emitSpatialObservations({
    sessionId: "sess-spatial",
    componentId: "spatial-state-w206",
    series,
  });
}

describe("emitSpatialObservations — contract shape", () => {
  const observations = emit(HAND_BUILT);

  test("one observation per point, every record parses with the contracts zod schema", () => {
    expect(observations).toHaveLength(2);
    for (const observation of observations) {
      expect(validateObservation(observation)).toBe(true);
      expect(Observation.safeParse(observation).success).toBe(true);
    }
  });

  test('observationId = "sp-<frameId>-<trackId>", unique across the stream', () => {
    expect(observations[0]!.observationId).toBe("sp-f-0-0-t1");
    expect(observations[1]!.observationId).toBe("sp-f-0-1-t2");
    expect(new Set(observations.map((o) => o.observationId)).size).toBe(observations.length);
  });

  test("eventTimeMs is the point's sessionMs — the SESSION timeline, not presentationMs", () => {
    // These hand-built points carry sessionMs 150/190; the frames they came
    // from had presentationMs 100/140 under the +50-offset clock (the
    // pipeline case below proves the distinction on fused data).
    expect(observations[0]!.eventTimeMs).toBe(150);
    expect(observations[1]!.eventTimeMs).toBe(190);
    expect(observations[0]!.sessionId).toBe("sess-spatial");
    expect(observations[0]!.componentId).toBe("spatial-state-w206");
    expect(observations[0]!.schemaVersion).toBe(SCHEMA_VERSION);
    // Deterministic package: no wall-clock ingestion time is ever invented.
    expect(observations[0]!.ingestTimeMs).toBeUndefined();
    expect(observations[0]!.modelId).toBeUndefined();
  });

  test("provenance DERIVED, modality vision, confidence passthrough", () => {
    for (const observation of observations) {
      expect(observation.provenance).toBe("DERIVED"); // honesty rule (module docs)
      expect(observation.modality).toBe("vision");
      expect(observation.confidence).toBe(0.9);
    }
  });

  test("payload: track kind, entityId = trackId, pitch METERS, NO velocity key", () => {
    const payload = observations[0]!.payload;
    expect(payload.kind).toBe("track");
    if (payload.kind === "track") {
      expect(payload.entityId).toBe("t1");
      expect(payload.position).toEqual({ x: 52.5, y: 34 }); // meters, canonical pitch frame
      expect("velocity" in payload).toBe(false); // W205/later-fusion scope boundary
      expect(payload.velocity).toBeUndefined();
      // Emitted positions are fresh copies — records never alias the series.
      expect(payload.position).not.toBe(HAND_BUILT.points[0]!.pitch);
    }
  });

  test("subjectEntityRefs: player label maps to participant, EXACT LocalEntityRef shape", () => {
    expect(observations[0]!.subjectEntityRefs).toEqual([{ entityId: "t1", kind: "participant" }]);
    // The exact contracts shape: entityId + kind ONLY (no label field).
    expect(Object.keys(observations[0]!.subjectEntityRefs[0]!).sort()).toEqual([
      "entityId",
      "kind",
    ]);
  });

  test("unmapped label gets NO ref; a label-less point gets the participant default", () => {
    const unmapped = emit({
      frames: 1,
      points: [{ ...pointWith(100, "t9", "f-0-9"), label: "coach" }],
      outOfBounds: 0,
    });
    expect(unmapped[0]!.subjectEntityRefs).toEqual([]); // identity is never guessed

    const unlabeled = emit({
      frames: 1,
      points: [{ ...pointWith(100, "t8", "f-0-8"), label: undefined }],
      outOfBounds: 0,
    });
    expect(unlabeled[0]!.subjectEntityRefs).toEqual([{ entityId: "t8", kind: "participant" }]);
  });

  test("a repeated (frameId, trackId) pair gets a collision suffix; ids stay unique", () => {
    const duplicated = emit({
      frames: 1,
      points: [pointWith(100, "t1", "f-0-0"), pointWith(140, "t1", "f-0-0")],
      outOfBounds: 0,
    });
    expect(duplicated.map((o) => o.observationId)).toEqual(["sp-f-0-0-t1", "sp-f-0-0-t1-1"]);
    expect(new Set(duplicated.map((o) => o.observationId)).size).toBe(2);
  });
});

describe("emitSpatialObservations — fused pipeline with a non-identity clock", () => {
  const SPECS: FixtureTrackSpec[] = [
    {
      gtId: "emit-p1",
      label: "player",
      motion: { kind: "linear", from: { x: 0.4, y: 0.5 }, to: { x: 0.5, y: 0.5 } },
      size: { w: 0.2, h: 0.2 },
    },
  ];
  const series = fuseFixtureScenario({
    specs: SPECS,
    frames: 10,
    cameraAt: () => ({ pan: 0.5, zoom: 1, jitter: 0 }),
    options: { clock: AFFINE },
  });
  const observations = emit(series);

  test("every fused point emits a contract-valid observation", () => {
    expect(series.points).toHaveLength(10);
    expect(observations).toHaveLength(10);
    for (const observation of observations) {
      expect(validateObservation(observation)).toBe(true);
    }
  });

  test("eventTimeMs is the W103-mapped session time, never the presentationMs", () => {
    // presentationMs = 40d; sessionMs = 40d + 50 + (40d * 1000) / 1_000_000
    // (the SAME expression W103 computes — bit-exact here).
    expect(series.points[0]!.sessionMs).toBe(50); // d = 0
    expect(series.points[1]!.sessionMs).toBe(40 + 50 + (40 * 1000) / 1_000_000); // d = 1
    expect(series.points[1]!.sessionMs).toBeCloseTo(90.04, 10);
    for (const [index, observation] of observations.entries()) {
      const presentationMs = 40 * index;
      expect(observation.eventTimeMs).toBe(series.points[index]!.sessionMs);
      expect(observation.eventTimeMs).toBe(
        presentationMs + 50 + (presentationMs * 1000) / 1_000_000,
      );
      if (index > 0) {
        expect(observation.eventTimeMs).not.toBe(presentationMs); // session, not source
      }
    }
  });

  test("emitted records append cleanly to the W005 observation store", () => {
    const store = new InMemoryObservationStore();
    for (const observation of observations) {
      expect(store.append(observation)).toBe("appended");
    }
    expect(store.count()).toBe(10);
    const queried = store.query({ sessionId: "sess-spatial" });
    expect(queried).toHaveLength(10);
    // Canonical eventTimeMs order — the SWM-facing stream is time-aligned.
    for (let i = 1; i < queried.length; i += 1) {
      expect(queried[i]!.eventTimeMs).toBeGreaterThan(queried[i - 1]!.eventTimeMs);
    }
  });
});

describe("emitSpatialObservations — fail-loud validation", () => {
  test("negative sessionMs cannot emit (the session timeline is non-negative)", () => {
    expect(() => emit({ frames: 1, points: [pointWith(-10)], outOfBounds: 0 })).toThrow(RangeError);
  });

  test("empty sessionId / componentId fail loud", () => {
    expect(() =>
      emitSpatialObservations({ sessionId: "", componentId: "c", series: HAND_BUILT }),
    ).toThrow(RangeError);
    expect(() =>
      emitSpatialObservations({ sessionId: "s", componentId: "", series: HAND_BUILT }),
    ).toThrow(RangeError);
  });

  test("a trackId that cannot be an EntityId fails loud (the record would not parse)", () => {
    expect(() =>
      emit({
        frames: 1,
        points: [{ ...pointWith(100, "bad id!"), trackId: "bad id!" }],
        outOfBounds: 0,
      }),
    ).toThrow(RangeError);
  });

  test("out-of-range confidence fails loud", () => {
    expect(() =>
      emit({
        frames: 1,
        points: [{ ...pointWith(100), confidence: 1.5 }],
        outOfBounds: 0,
      }),
    ).toThrow(RangeError);
  });
});
