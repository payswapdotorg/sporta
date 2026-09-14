import { describe, expect, test } from "bun:test";
import { ChunkedAsrAdapter, FixtureAsrBackend } from "@sporta/asr";
import { Observation } from "@sporta/contracts";
import { segmentCommentary } from "../src/index";
import { emitCommentaryObservations, validateObservation } from "../src/observe";

/**
 * W207 -> W208 seam integration: consume the ACTUAL delivered W207 exports
 * (`ChunkedAsrAdapter` + `FixtureAsrBackend` producing `TranscriptionUnit`s)
 * and segment their real output — the vertical slice behind the W208
 * acceptance criterion "speech is segmented into synchronized commentary
 * units with speaker/channel metadata where available".
 */

/** One 5-second mono 8kHz silence chunk starting at `startMs`. */
function silenceChunk(startMs: number) {
  return {
    chunkId: `a-0-${startMs / 5000}`,
    streamIndex: 0,
    startMs,
    sampleRate: 8000,
    channels: 1,
    samples: new Float32Array(40000), // 5000ms * 8000Hz * 1ch
  };
}

describe("W207 seam: ChunkedAsrAdapter output segments into commentary units", () => {
  test("three transcribed windows become one synchronized commentary unit", async () => {
    const backend = new FixtureAsrBackend({
      results: new Map([
        [0, { text: "he takes the" }],
        [5000, { text: "corner kick now" }],
        [10000, { text: "towards the far post." }],
      ]),
    });
    const adapter = new ChunkedAsrAdapter({
      backend,
      channel: "commentary-1",
    });

    const units = await adapter.transcribeAudioChunks([
      silenceChunk(0),
      silenceChunk(5000),
      silenceChunk(10000),
    ]);
    expect(units).toHaveLength(3);
    expect(units.map((unit) => unit.unitId)).toEqual(["tu-0", "tu-1", "tu-2"]);
    expect(units.map((unit) => unit.channel)).toEqual([
      "commentary-1",
      "commentary-1",
      "commentary-1",
    ]);

    const commentary = segmentCommentary(units);
    expect(commentary).toHaveLength(1);
    const unit = commentary[0];
    expect(unit?.unitId).toBe("cu-1");
    expect(unit?.text).toBe("he takes the corner kick now towards the far post.");
    expect(unit?.startMs).toBe(0); // first W207 window's start
    expect(unit?.endMs).toBe(15000); // third W207 window's end
    expect(unit?.channel).toBe("commentary-1"); // W207 metadata passthrough
    expect(unit?.sourceWindowIds).toEqual(["tu-0", "tu-1", "tu-2"]);

    // And the segmented unit emits as a contract-valid commentary observation.
    const observations = emitCommentaryObservations({
      sessionId: "sess-w208-integration",
      componentId: "commentary-segmenter-v1",
      commentary,
    });
    expect(observations).toHaveLength(1);
    expect(() => Observation.parse(observations[0])).not.toThrow();
    expect(validateObservation(observations[0])).toBe(true);
    expect(observations[0]?.modality).toBe("commentary");
    expect(observations[0]?.provenance).toBe("DERIVED");
  });

  test("backend confidence flows through W207, segmentation, and emission", async () => {
    const backend = new FixtureAsrBackend({
      results: new Map([
        [0, { text: "A certain goal!", asrConfidence: 0.9 }],
        [5000, { text: "and a certain miss.", asrConfidence: 0.6 }],
      ]),
    });
    const adapter = new ChunkedAsrAdapter({ backend });
    const units = await adapter.transcribeAudioChunks([silenceChunk(0), silenceChunk(5000)]);

    // Two windows, both ending in terminators: two single-window units.
    const commentary = segmentCommentary(units);
    expect(commentary.map((unit) => unit.text)).toEqual(["A certain goal!", "and a certain miss."]);
    // Passthrough: each unit carries its own window's confidence verbatim.
    expect(commentary[0]?.asrConfidence).toBe(0.9);
    expect(commentary[1]?.asrConfidence).toBe(0.6);

    const observations = emitCommentaryObservations({
      sessionId: "sess-w208-integration",
      componentId: "commentary-segmenter-v1",
      commentary,
    });
    expect(observations.map((observation) => observation.confidence)).toEqual([0.9, 0.6]);
    for (const observation of observations) {
      expect(validateObservation(observation)).toBe(true);
    }
  });
});
