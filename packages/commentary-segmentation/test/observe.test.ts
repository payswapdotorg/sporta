import { describe, expect, test } from "bun:test";
import { Observation, SCHEMA_VERSION } from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import { buildObservation } from "@sporta/testing";
import { segmentCommentary } from "../src/index";
import { emitCommentaryObservations, validateObservation } from "../src/observe";
import type { CommentaryUnit } from "../src/types";
import { makeUnit } from "./fixtures";
import type { TranscriptionUnit } from "@sporta/asr";

const SESSION_ID = "sess-w208-emission";
const COMPONENT_ID = "commentary-segmenter-v1";

/**
 * Segments one batch of units in ONE `segmentCommentary` call — the `cu-<seq>`
 * sequence is global per call, so combining separately-segmented batches
 * would collide ids exactly like separately-transcribed W207 streams would.
 */
function segmentAll(units: TranscriptionUnit[]): CommentaryUnit[] {
  return segmentCommentary(units);
}

describe("emitCommentaryObservations", () => {
  test("emits one zod-valid Observation per commentary unit, with exact fields", () => {
    const commentary = segmentAll([
      makeUnit({ text: "What a pass. What a finish!" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "The crowd is on its feet",
        speakerLabel: "lead",
        channel: "main",
      }),
    ]);
    const observations = emitCommentaryObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      commentary,
    });
    expect(observations).toHaveLength(3);

    // Parse ALL emitted records with the contracts Observation schema.
    for (const observation of observations) {
      expect(() => Observation.parse(observation)).not.toThrow();
      expect(validateObservation(observation)).toBe(true);
    }

    expect(observations[0]).toEqual({
      observationId: "seg-cu-1", // "seg-<unitId>"
      sessionId: SESSION_ID,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: 0, // unit.startMs (session-timeline passthrough)
      modality: "commentary", // segmented stream is commentary-domain
      componentId: COMPONENT_ID,
      provenance: "DERIVED", // segmentation is inference over observations
      payload: {
        kind: "transcription",
        text: "What a pass.",
      },
      subjectEntityRefs: [], // W209 extracts subjects — none claimed here
    });
    const second = observations[1];
    expect(
      second?.payload.kind === "transcription" && second.payload.text === "What a finish!",
    ).toBe(true);
    expect(observations[2]?.payload).toEqual({
      kind: "transcription",
      text: "The crowd is on its feet",
      speakerLabel: "lead",
      channel: "main",
    });
  });

  test("observationIds are unique and follow the seg-<unitId> pattern", () => {
    const observations = emitCommentaryObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      commentary: segmentAll([
        makeUnit({ text: "One." }),
        makeUnit({ unitId: "tu-1", startMs: 5000, endMs: 10000, text: "Two." }),
        makeUnit({ unitId: "tu-2", startMs: 10000, endMs: 15000, text: "Three." }),
      ]),
    });
    const ids = observations.map((observation) => observation.observationId);
    expect(ids).toEqual(["seg-cu-1", "seg-cu-2", "seg-cu-3"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("confidence is set ONLY when the unit carried one — never invented", () => {
    const withConfidence = emitCommentaryObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      commentary: segmentAll([makeUnit({ text: "A certain goal!", asrConfidence: 0.91 })]),
    });
    expect(withConfidence[0]?.confidence).toBe(0.91);
    const payload = withConfidence[0]?.payload;
    expect(payload?.kind === "transcription" && payload.asrConfidence).toBe(0.91);

    const withoutConfidence = emitCommentaryObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      commentary: segmentAll([makeUnit({ text: "A mystery goal!" })]),
    });
    const bare = withoutConfidence[0];
    expect(bare?.confidence).toBeUndefined();
    expect("confidence" in (bare ?? {})).toBe(false); // OMITTED, not defaulted
    expect(bare?.payload.kind === "transcription" && "asrConfidence" in bare.payload).toBe(false);
  });

  test("payload keys are present ONLY when the unit carries them", () => {
    const bare = emitCommentaryObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      commentary: segmentAll([makeUnit({ text: "Plain text." })]),
    })[0]?.payload;
    expect(bare).toEqual({ kind: "transcription", text: "Plain text." });

    const full = emitCommentaryObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      commentary: segmentAll([
        makeUnit({
          text: "Full metadata.",
          speakerLabel: "co-analyst",
          channel: "intl",
          asrConfidence: 0.8,
        }),
      ]),
    })[0]?.payload;
    expect(full).toEqual({
      kind: "transcription",
      text: "Full metadata.",
      speakerLabel: "co-analyst",
      channel: "intl",
      asrConfidence: 0.8,
    });
  });

  test("emitted records carry no ingestTimeMs (the pipeline owns wall-clock time)", () => {
    const observations = emitCommentaryObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      commentary: segmentAll([makeUnit({ text: "Timed." })]),
    });
    expect("ingestTimeMs" in (observations[0] ?? {})).toBe(false);
  });

  test("empty commentary -> empty array (no ids minted)", () => {
    expect(
      emitCommentaryObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        commentary: [],
      }),
    ).toEqual([]);
  });

  test("validateObservation rejects contract-invalid records", () => {
    const [valid] = emitCommentaryObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      commentary: segmentAll([makeUnit({ text: "A valid one.", asrConfidence: 0.9 })]),
    });
    expect(validateObservation(valid)).toBe(true);
    expect(validateObservation({ ...valid, confidence: 1.5 })).toBe(false);
    expect(validateObservation({ ...valid, eventTimeMs: -1 })).toBe(false);
    expect(validateObservation({ ...valid, modality: "haptic" })).toBe(false);
    expect(validateObservation({ ...valid, provenance: "GUESSED" })).toBe(false);
    expect(validateObservation({ ...valid, payload: { kind: "detection" } })).toBe(false);
    expect(validateObservation("not-an-object")).toBe(false);
  });

  test("emitted records are store-compatible and interop with @sporta/testing", () => {
    const store = new InMemoryObservationStore();
    const commentary = segmentAll([
      makeUnit({ text: "What a pass. What a finish!" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "The crowd is on its feet",
        speakerLabel: "lead",
        channel: "main",
      }),
    ]);
    const emitted = emitCommentaryObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      commentary,
    });
    for (const observation of emitted) {
      expect(store.append(observation)).toBe("appended");
    }
    expect(store.count()).toBe(3); // 3 commentary units -> 3 observations

    // A builder-made observation from the shared test harness appends
    // alongside the emitted ones (same schema, same store).
    const builderMade = buildObservation({ sessionId: SESSION_ID, eventTimeMs: 20000 }, 42);
    expect(store.append(builderMade)).toBe("appended");

    const transcriptions = store.query({
      sessionId: SESSION_ID,
      kind: "transcription",
      modality: "commentary",
    });
    expect(transcriptions).toHaveLength(3);
    // Store order is canonical: ascending eventTimeMs (ties by append order —
    // cu-1 and cu-2 share the window, so both start at 0).
    expect(transcriptions.map((observation) => observation.eventTimeMs)).toEqual([0, 0, 5000]);
    expect(store.byId("seg-cu-1")).toBeDefined();
  });
});
