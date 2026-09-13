import { describe, expect, test } from "bun:test";
import { Observation, SCHEMA_VERSION } from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import { buildObservation } from "@sporta/testing";
import { emitTranscriptionObservations, validateTranscriptionObservation } from "../src/observe";
import type { TranscriptionUnit } from "../src/types";

const SESSION_ID = "sess-w207-emission";
const COMPONENT_ID = "fixture-asr";

function makeUnit(overrides: Partial<TranscriptionUnit> = {}): TranscriptionUnit {
  return {
    unitId: "tu-0",
    startMs: 0,
    endMs: 5000,
    text: "what a strike",
    ...overrides,
  };
}

describe("emitTranscriptionObservations", () => {
  test("emits one zod-valid Observation per unit, with exact fields", () => {
    const units = [
      makeUnit(),
      makeUnit({ unitId: "tu-1", startMs: 5000, endMs: 10000, text: "and the crowd rises" }),
    ];
    const observations = emitTranscriptionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      units,
    });
    expect(observations).toHaveLength(2);

    // Parse ALL emitted records with the contracts Observation schema.
    for (const observation of observations) {
      expect(() => Observation.parse(observation)).not.toThrow();
      expect(validateTranscriptionObservation(observation)).toBe(true);
    }

    expect(observations[0]).toEqual({
      observationId: "stt-tu-0", // "stt-<unitId>"
      sessionId: SESSION_ID,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: 0, // unit.startMs
      modality: "audio", // raw STT output — "commentary" is W209's modality
      componentId: COMPONENT_ID,
      provenance: "OBSERVED",
      payload: {
        kind: "transcription",
        text: "what a strike",
      },
      subjectEntityRefs: [], // speaker identity is W208's territory
    });
    expect(observations[1]?.eventTimeMs).toBe(5000);
    expect(observations[1]?.payload.kind).toBe("transcription");
  });

  test("speakerLabel/channel metadata passes through into the payload", () => {
    const observations = emitTranscriptionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      units: [makeUnit({ speakerLabel: "play-by-play", channel: "commentary-1" })],
    });
    const payload = observations[0]?.payload;
    expect(payload).toEqual({
      kind: "transcription",
      text: "what a strike",
      speakerLabel: "play-by-play",
      channel: "commentary-1",
    });
    expect(() => Observation.parse(observations[0])).not.toThrow();
  });

  test("confidence is set ONLY when the backend provided one — never invented", () => {
    const withConfidence = emitTranscriptionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      units: [makeUnit({ asrConfidence: 0.91 })],
    });
    expect(withConfidence[0]?.confidence).toBe(0.91);
    const payload = withConfidence[0]?.payload;
    expect(payload?.kind === "transcription" && payload.asrConfidence).toBe(0.91);

    const withoutConfidence = emitTranscriptionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      units: [makeUnit()],
    });
    const bare = withoutConfidence[0];
    expect(bare?.confidence).toBeUndefined();
    expect("confidence" in (bare ?? {})).toBe(false); // OMITTED, not zero, not defaulted
    expect(bare?.payload.kind === "transcription" && "asrConfidence" in bare.payload).toBe(false);
  });

  test("observationIds are stable and follow the stt-<unitId> pattern", () => {
    const units = [
      makeUnit({ unitId: "tu-0" }),
      makeUnit({ unitId: "tu-5", startMs: 5000, endMs: 5250 }),
    ];
    const first = emitTranscriptionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      units,
    });
    const second = emitTranscriptionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      units,
    });
    expect(first.map((observation) => observation.observationId)).toEqual(["stt-tu-0", "stt-tu-5"]);
    // Re-emitting the same units mints the same ids (no clock, no randomness).
    expect(second.map((observation) => observation.observationId)).toEqual(
      first.map((observation) => observation.observationId),
    );
  });

  test("empty units -> empty array (no ids minted)", () => {
    expect(
      emitTranscriptionObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        units: [],
      }),
    ).toEqual([]);
  });

  test("emitted records carry no ingestTimeMs (the pipeline owns wall-clock time)", () => {
    const observations = emitTranscriptionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      units: [makeUnit()],
    });
    expect("ingestTimeMs" in (observations[0] ?? {})).toBe(false);
  });

  test("validateTranscriptionObservation rejects contract-invalid records", () => {
    const [valid] = emitTranscriptionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      units: [makeUnit({ asrConfidence: 0.9 })],
    });
    expect(validateTranscriptionObservation(valid)).toBe(true);
    expect(validateTranscriptionObservation({ ...valid, confidence: 1.5 })).toBe(false);
    expect(validateTranscriptionObservation({ ...valid, eventTimeMs: -1 })).toBe(false);
    expect(validateTranscriptionObservation({ ...valid, modality: "haptic" })).toBe(false);
    expect(validateTranscriptionObservation({ ...valid, provenance: "GUESSED" })).toBe(false);
    expect(validateTranscriptionObservation({ ...valid, payload: { kind: "detection" } })).toBe(
      false,
    );
    expect(validateTranscriptionObservation("not-an-object")).toBe(false);
  });

  test("emitted records are store-compatible and interop with @sporta/testing", () => {
    const store = new InMemoryObservationStore();
    const units = [
      makeUnit({ unitId: "tu-0", startMs: 0 }),
      makeUnit({ unitId: "tu-1", startMs: 5000, endMs: 5250, text: "off the post" }),
    ];
    const emitted = emitTranscriptionObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      units,
    });
    for (const observation of emitted) {
      expect(store.append(observation)).toBe("appended");
    }
    expect(store.count()).toBe(2);

    // A builder-made observation from the shared test harness appends
    // alongside the emitted ones (same schema, same store).
    const builderMade = buildObservation({ sessionId: SESSION_ID, eventTimeMs: 10000 }, 42);
    expect(store.append(builderMade)).toBe("appended");
    expect(store.count()).toBe(3);

    const transcriptions = store.query({
      sessionId: SESSION_ID,
      kind: "transcription",
      modality: "audio",
    });
    expect(transcriptions).toHaveLength(2);
    expect(store.byId("stt-tu-0")).toBeDefined();
    // Store order is canonical: ascending eventTimeMs.
    expect(transcriptions[0]?.eventTimeMs).toBe(0);
    expect(transcriptions[1]?.eventTimeMs).toBe(5000);
  });
});
