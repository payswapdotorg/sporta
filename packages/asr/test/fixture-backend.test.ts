import { describe, expect, test } from "bun:test";
import { AsrError } from "../src/errors";
import { FixtureAsrBackend } from "../src/fixture-backend";
import type { AsrBackendResult } from "../src/types";
import { encodeWav } from "../src/wav";

/** One 5000 ms silence window: 8000 Hz mono, 40000 samples. */
function windowWav(durationMs: number, sampleRate = 8000, channels = 1): Uint8Array {
  const frames = Math.round((durationMs * sampleRate) / 1000);
  return encodeWav(new Float32Array(frames * channels), sampleRate, channels);
}

describe("FixtureAsrBackend", () => {
  test("returns the result mapped for each window start (cumulative WAV durations)", () => {
    const backend = new FixtureAsrBackend({
      results: new Map<number, AsrBackendResult>([
        [0, { text: "hello" }],
        [5000, { text: "world", asrConfidence: 0.9 }],
      ]),
    });

    const first = backend.transcribe(windowWav(5000));
    const second = backend.transcribe(windowWav(5000));

    expect(first).toEqual({ text: "hello" });
    expect(second).toEqual({ text: "world", asrConfidence: 0.9 });
  });

  test("unknown windows throw the typed AsrError by default", () => {
    const backend = new FixtureAsrBackend({
      results: new Map<number, AsrBackendResult>([[0, { text: "hello" }]]),
    });

    expect(backend.transcribe(windowWav(5000))).toEqual({ text: "hello" });

    let thrown: unknown;
    try {
      backend.transcribe(windowWav(5000));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AsrError);
    const asrError = thrown as AsrError;
    expect(asrError.failureClass).toBe("internal");
    expect(asrError.details.windowStartMs).toBe(5000);
    expect(asrError.message).toContain("5000");
  });

  test('unknown windows return empty text with onUnknownWindow: "empty"', () => {
    const backend = new FixtureAsrBackend({
      results: new Map<number, AsrBackendResult>([[0, { text: "hello" }]]),
      onUnknownWindow: "empty",
    });

    expect(backend.transcribe(windowWav(5000))).toEqual({ text: "hello" });
    expect(backend.transcribe(windowWav(5000))).toEqual({ text: "" });
    // Empty text still has no invented confidence.
    expect(backend.transcribe(windowWav(5000)).asrConfidence).toBeUndefined();
  });

  test("defaultResult covers every window when no map is given", () => {
    const backend = new FixtureAsrBackend({ defaultResult: { text: "fallback" } });
    expect(backend.transcribe(windowWav(5000))).toEqual({ text: "fallback" });
    expect(backend.transcribe(windowWav(5000))).toEqual({ text: "fallback" });
    expect(backend.transcribe(windowWav(1000))).toEqual({ text: "fallback" });
  });

  test("the map wins where a window is mapped; the default catches the rest", () => {
    const backend = new FixtureAsrBackend({
      results: new Map<number, AsrBackendResult>([[0, { text: "first" }]]),
      defaultResult: { text: "fallback" },
    });
    expect(backend.transcribe(windowWav(5000))).toEqual({ text: "first" });
    expect(backend.transcribe(windowWav(5000))).toEqual({ text: "fallback" });
  });

  test("deterministic: fresh instances fed the same windows return identical results", () => {
    const results = new Map<number, AsrBackendResult>([
      [0, { text: "a" }],
      [5000, { text: "b" }],
    ]);
    const runA = new FixtureAsrBackend({ results });
    const runB = new FixtureAsrBackend({ results });

    const wavA = windowWav(5000);
    const wavB = windowWav(5000);
    const outA = [runA.transcribe(wavA), runA.transcribe(wavB)];
    const outB = [runB.transcribe(wavA), runB.transcribe(wavB)];
    expect(outA).toEqual(outB);
    expect(outA).toEqual([{ text: "a" }, { text: "b" }]);
  });

  test("transcribe is synchronous (returns the result, not a promise)", () => {
    const backend = new FixtureAsrBackend({ defaultResult: { text: "sync" } });
    const result = backend.transcribe(windowWav(1000));
    expect(result instanceof Promise).toBe(false);
    expect(result.text).toBe("sync");
  });

  test("partial final windows advance the position by their actual duration", () => {
    const backend = new FixtureAsrBackend({
      results: new Map<number, AsrBackendResult>([
        [0, { text: "full" }],
        [5000, { text: "partial" }],
      ]),
    });
    // Full 5000 ms window, then a 250 ms partial: the next start is 5250.
    expect(backend.transcribe(windowWav(5000))).toEqual({ text: "full" });
    expect(backend.transcribe(windowWav(250))).toEqual({ text: "partial" });
  });

  test("bytes that are not a 44-byte-header WAV throw the typed AsrError", () => {
    const backend = new FixtureAsrBackend({ defaultResult: { text: "x" } });
    expect(() => backend.transcribe(new Uint8Array(10))).toThrow(AsrError);
    expect(() => backend.transcribe(new Uint8Array(100))).toThrow(AsrError);
    expect(() => backend.transcribe(new Uint8Array([0, 1, 2]))).toThrow(AsrError);
  });

  test("returned results are shallow copies (fixture state cannot be mutated through them)", () => {
    const backend = new FixtureAsrBackend({ defaultResult: { text: "original" } });
    const result = backend.transcribe(windowWav(1000)) as { text: string };
    result.text = "mutated";
    expect(backend.transcribe(windowWav(1000)).text).toBe("original");
  });
});
