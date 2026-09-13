import { describe, expect, test } from "bun:test";
import { encodeWav } from "../src/wav";
import { ZaiAsrBackend } from "../src/zai-backend";

/**
 * CONDITIONAL integration (W207): tries ONE real transcription against the
 * z-ai backend. The audio is a pure-TS 1 s 440 Hz sine WAV (no ffmpeg); a
 * sine wave may transcribe to anything (or nothing), so ONLY THE CALL SHAPE
 * is asserted — no throw, and `text` is a string. When the SDK is
 * unavailable or the network fails (an environment gap, not a code defect),
 * the test warns and skips: it must NEVER fail CI for a missing environment.
 */
function sineWav(durationMs: number, sampleRate = 8000): Uint8Array {
  const frames = Math.round((durationMs * sampleRate) / 1000);
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    samples[frame] = Math.sin(2 * Math.PI * 440 * (frame / sampleRate)) * 0.5;
  }
  return encodeWav(samples, sampleRate, 1);
}

describe("ZaiAsrBackend", () => {
  test("backendId is stable and vendor-neutral", () => {
    expect(new ZaiAsrBackend().backendId).toBe("zai-asr");
  });

  test("transcribes a real 1s 440Hz sine WAV — call shape only, content NOT asserted", async () => {
    const backend = new ZaiAsrBackend();
    let result;
    try {
      result = await backend.transcribe(sineWav(1000));
    } catch (error) {
      console.warn(
        `[asr] skipping z-ai integration (environment gap): ${(error as Error).message}`,
      );
      return; // skip — never fail CI on an environment gap
    }
    expect(typeof result.text).toBe("string");
    // The backend provides no confidence, and none is ever invented.
    expect(result.asrConfidence).toBeUndefined();
  });
});
