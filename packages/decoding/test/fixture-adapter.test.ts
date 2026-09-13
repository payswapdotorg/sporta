/**
 * W102 FixtureDecoderAdapter tests: frame math (fps x duration), audio
 * chunk math at the canonical target, deterministic bytes (two decodes
 * deep-equal), window slicing semantics ([fromMs, toMs) — inclusive start,
 * exclusive end), distinct patterns, and probe derivation from the spec.
 *
 * Deterministic per docs/testing/HARNESS.md: no clock reads, no randomness,
 * input bytes ignored by the adapter (proved by decoding different bytes).
 */
import { describe, expect, test } from "bun:test";
import { buildAuthorizationPolicy } from "@sporta/testing";
import type { IngestionReceipt } from "@sporta/ingestion";
import { DEFAULT_AUDIO_TARGET } from "../src/index";
import { FixtureDecoderAdapter } from "../src/index";
import type { DecodeSourceInput, NormalizedAudioChunk, NormalizedVideoFrame } from "../src/index";

// --- fixtures & helpers ----------------------------------------------------

/** A deterministic receipt (the fixture adapter only echoes its fields). */
function makeReceipt(): IngestionReceipt {
  return {
    sessionId: "sess-fixture",
    sourceId: "src-000000000000",
    checksum: "ab".repeat(32),
    container: "mp4",
    byteLength: 32,
    ingestedAtMs: 0,
    sourceKind: "file",
  };
}

/** A decode input whose openBytes yields the given (ignored) bytes. */
function makeInput(bytes: Uint8Array = new Uint8Array([1, 2, 3])): DecodeSourceInput {
  return {
    receipt: makeReceipt(),
    authorizationPolicy: buildAuthorizationPolicy(),
    openBytes: async () => bytes,
  };
}

/** Standard spec: 25 fps gradient video (track 0) + sine audio (track 1). */
function standardSpec() {
  return {
    tracks: [
      {
        kind: "video" as const,
        codec: "fixture-v",
        width: 4,
        height: 4,
        fps: 25,
        durationMs: 1000,
        pattern: "gradient" as const,
      },
      {
        kind: "audio" as const,
        codec: "fixture-a",
        sampleRate: 48_000,
        channels: 2,
        durationMs: 1000,
        pattern: "sine" as const,
      },
    ],
  };
}

/** Collects an async iterable into an array. */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

// --- tests -----------------------------------------------------------------

describe("FixtureDecoderAdapter — probe", () => {
  test("derives TrackInfo from the spec (video + audio, spec order)", async () => {
    const adapter = new FixtureDecoderAdapter(standardSpec());
    const result = await adapter.probe(makeInput());

    expect(result.tracks).toHaveLength(2);
    const [video, audio] = result.tracks;
    expect(video).toMatchObject({
      trackId: "t-0-video",
      streamIndex: 0,
      kind: "video",
      codec: "fixture-v",
      startTimeMs: 0,
      durationMs: 1000,
    });
    expect(video?.language).toBeUndefined();
    expect(audio).toMatchObject({
      trackId: "t-1-audio",
      streamIndex: 1,
      kind: "audio",
      codec: "fixture-a",
      startTimeMs: 0,
      durationMs: 1000,
    });
    expect(result.container).toBe("mp4");
    expect(result.durationMs).toBe(1000);
  });

  test("ignores the input bytes entirely (deterministic)", async () => {
    const adapter = new FixtureDecoderAdapter(standardSpec());
    const first = await adapter.probe(makeInput(new Uint8Array([9, 9, 9])));
    const second = await adapter.probe(makeInput(new Uint8Array([1, 1, 1])));
    expect(first).toEqual(second);
  });

  test("probe duration is the maximum track duration", async () => {
    const adapter = new FixtureDecoderAdapter({
      tracks: [
        {
          kind: "video",
          codec: "fixture-v",
          width: 4,
          height: 4,
          fps: 10,
          durationMs: 1500,
          pattern: "gradient",
        },
        {
          kind: "audio",
          codec: "fixture-a",
          sampleRate: 48_000,
          channels: 2,
          durationMs: 500,
          pattern: "silence",
        },
      ],
    });
    const result = await adapter.probe(makeInput());
    expect(result.durationMs).toBe(1500);
  });
});

describe("FixtureDecoderAdapter — decodeVideo frame math", () => {
  test("25 fps over 1000 ms yields exactly 25 frames with exact presentationMs", async () => {
    const adapter = new FixtureDecoderAdapter(standardSpec());
    const frames: NormalizedVideoFrame[] = await collect(adapter.decodeVideo(makeInput(), 0));

    expect(frames).toHaveLength(25);
    frames.forEach((frame, index) => {
      expect(frame.frameId).toBe(`f-0-${index}`);
      expect(frame.streamIndex).toBe(0);
      expect(frame.decodeOrder).toBe(index);
      expect(frame.presentationMs).toBe((index * 1000) / 25);
      expect(frame.width).toBe(4);
      expect(frame.height).toBe(4);
      expect(frame.pixelFormat).toBe("rgb24");
      expect(frame.bytes.byteLength).toBe(4 * 4 * 3);
    });
  });

  test("two decodes are deep-equal (determinism)", async () => {
    const adapter = new FixtureDecoderAdapter(standardSpec());
    const first = await collect(adapter.decodeVideo(makeInput(), 0));
    const second = await collect(adapter.decodeVideo(makeInput(), 0));
    expect(first).toEqual(second);
  });

  test("window [200, 600): inclusive start, exclusive end", async () => {
    const adapter = new FixtureDecoderAdapter(standardSpec());
    const frames = await collect(adapter.decodeVideo(makeInput(), 0, { fromMs: 200, toMs: 600 }));

    // 25 fps = 40 ms steps: 200, 240, ..., 560 — ten frames; the frame at
    // exactly 600 ms (frame 15) is EXCLUDED by the exclusive end.
    expect(frames).toHaveLength(10);
    expect(frames[0]?.presentationMs).toBe(200);
    expect(frames[9]?.presentationMs).toBe(560);
    frames.forEach((frame, index) => {
      expect(frame.presentationMs).toBe(200 + index * 40);
      // decodeOrder restarts at 0 within the windowed call.
      expect(frame.decodeOrder).toBe(index);
      expect(frame.frameId).toBe(`f-0-${index}`);
    });
  });

  test("gradient and solid patterns produce distinct bytes", async () => {
    const gradient = new FixtureDecoderAdapter({
      tracks: [
        {
          kind: "video",
          codec: "fixture-v",
          width: 8,
          height: 8,
          fps: 2,
          durationMs: 500,
          pattern: "gradient",
        },
      ],
    });
    const solid = new FixtureDecoderAdapter({
      tracks: [
        {
          kind: "video",
          codec: "fixture-v",
          width: 8,
          height: 8,
          fps: 2,
          durationMs: 500,
          pattern: "solid",
        },
      ],
    });
    const gradientFrames = await collect(gradient.decodeVideo(makeInput(), 0));
    const solidFrames = await collect(solid.decodeVideo(makeInput(), 0));
    expect(gradientFrames).toHaveLength(1);
    expect(solidFrames).toHaveLength(1);
    expect(gradientFrames[0]?.bytes).not.toEqual(solidFrames[0]?.bytes);
  });

  test("gradient byte math: bytes[i] = (x + y + frameIndex + channel) % 256", async () => {
    const adapter = new FixtureDecoderAdapter(standardSpec());
    const frames = await collect(adapter.decodeVideo(makeInput(), 0));
    const frame = frames[7]; // frameIndex 7
    expect(frame).toBeDefined();
    if (frame === undefined) return;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        for (let c = 0; c < 3; c += 1) {
          expect(frame.bytes[(y * 4 + x) * 3 + c]).toBe((x + y + 7 + c) % 256);
        }
      }
    }
  });
});

describe("FixtureDecoderAdapter — decodeAudio chunk math", () => {
  test("48 kHz stereo 250 ms target over 1000 ms yields 4 chunks of 24000 samples", async () => {
    const adapter = new FixtureDecoderAdapter(standardSpec());
    const chunks: NormalizedAudioChunk[] = await collect(adapter.decodeAudio(makeInput(), 1));

    expect(chunks).toHaveLength(4);
    chunks.forEach((chunk, index) => {
      expect(chunk.chunkId).toBe(`a-1-${index}`);
      expect(chunk.streamIndex).toBe(1);
      expect(chunk.startMs).toBe(index * 250);
      expect(chunk.sampleRate).toBe(48_000);
      expect(chunk.channels).toBe(2);
      expect(chunk.samples.length).toBe(24_000);
    });
  });

  test("sine values follow sin(2*pi*440*t)*0.5 at absolute sample positions", async () => {
    const adapter = new FixtureDecoderAdapter(standardSpec());
    const chunks = await collect(adapter.decodeAudio(makeInput(), 1));
    const first = chunks[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    // Absolute sample frame 0 → t = 0 → sin(0) = 0 (all channels).
    expect(first.samples[0]).toBe(0);
    expect(first.samples[1]).toBe(0);
    // Absolute sample frame 1 → t = 1/48000.
    const expected = Math.sin((2 * Math.PI * 440) / 48_000) * 0.5;
    expect(first.samples[2]).toBeCloseTo(expected, 6);
    expect(first.samples[3]).toBeCloseTo(expected, 6);
  });

  test("silence pattern yields all-zero samples, distinct from sine", async () => {
    const silence = new FixtureDecoderAdapter({
      tracks: [
        {
          kind: "audio",
          codec: "fixture-a",
          sampleRate: 48_000,
          channels: 2,
          durationMs: 250,
          pattern: "silence",
        },
      ],
    });
    const sine = new FixtureDecoderAdapter({
      tracks: [
        {
          kind: "audio",
          codec: "fixture-a",
          sampleRate: 48_000,
          channels: 2,
          durationMs: 250,
          pattern: "sine",
        },
      ],
    });
    const silentChunks = await collect(silence.decodeAudio(makeInput(), 0));
    const sineChunks = await collect(sine.decodeAudio(makeInput(), 0));

    expect(silentChunks).toHaveLength(1);
    const silent = silentChunks[0]?.samples;
    expect(silent).toBeDefined();
    if (silent === undefined) return;
    for (let i = 0; i < silent.length; i += 1) {
      expect(silent[i]).toBe(0);
    }
    // The sine chunk is not silent (and therefore distinct).
    const sineSamples = sineChunks[0]?.samples;
    expect(sineSamples).toBeDefined();
    expect(sineSamples?.some((value) => value !== 0)).toBe(true);
  });

  test("windowed audio reproduces the full decode's absolute sample values", async () => {
    const adapter = new FixtureDecoderAdapter(standardSpec());
    // Window [200, 600): chunks start at 200 and 450 (atomic, never
    // truncated by toMs); the first chunk covers absolute sample frames
    // [9600, 21600).
    const windowed = await collect(adapter.decodeAudio(makeInput(), 1, { fromMs: 200, toMs: 600 }));
    expect(windowed).toHaveLength(2);
    expect(windowed[0]?.startMs).toBe(200);
    expect(windowed[1]?.startMs).toBe(450);

    const full = await collect(adapter.decodeAudio(makeInput(), 1));
    // Full chunk 0 covers absolute frames [0, 12000); the windowed chunk's
    // first samples must equal the full stream's samples at frames 9600+.
    const windowedSamples = windowed[0]?.samples;
    const fullSamples = full[0]?.samples;
    expect(windowedSamples).toBeDefined();
    expect(fullSamples).toBeDefined();
    if (windowedSamples === undefined || fullSamples === undefined) return;
    expect(windowedSamples[0]).toBe(fullSamples[9600 * 2]);
    expect(windowedSamples[1]).toBe(fullSamples[9600 * 2 + 1]);
    expect(windowedSamples[2]).toBe(fullSamples[9601 * 2]);
  });

  test("a custom AudioTarget changes chunk size and timeline math", async () => {
    const adapter = new FixtureDecoderAdapter(standardSpec());
    const target = { sampleRate: 16_000, channels: 1, chunkMs: 100 };
    const chunks = await collect(adapter.decodeAudio(makeInput(), 1, undefined, target));
    expect(chunks).toHaveLength(10);
    chunks.forEach((chunk, index) => {
      expect(chunk.startMs).toBe(index * 100);
      expect(chunk.sampleRate).toBe(16_000);
      expect(chunk.channels).toBe(1);
      expect(chunk.samples.length).toBe(1600); // 16000 * 1 * 0.1
    });
  });
});

describe("FixtureDecoderAdapter — default target & stream selection", () => {
  test("decodeAudio without a target uses the canonical 48 kHz stereo / 250 ms target", async () => {
    const adapter = new FixtureDecoderAdapter(standardSpec());
    const chunks = await collect(adapter.decodeAudio(makeInput(), 1));
    expect(chunks[0]?.sampleRate).toBe(DEFAULT_AUDIO_TARGET.sampleRate);
    expect(chunks[0]?.channels).toBe(DEFAULT_AUDIO_TARGET.channels);
    expect(chunks[0]?.samples.length).toBe(
      DEFAULT_AUDIO_TARGET.sampleRate * DEFAULT_AUDIO_TARGET.channels * 0.25,
    );
  });

  test("selecting a video stream as audio (and vice versa) is a RangeError", async () => {
    const adapter = new FixtureDecoderAdapter(standardSpec());
    const audioIterator = adapter.decodeAudio(makeInput(), 0);
    await expect(collect(audioIterator)).rejects.toThrow(RangeError);
    const videoIterator = adapter.decodeVideo(makeInput(), 1);
    await expect(collect(videoIterator)).rejects.toThrow(RangeError);
  });
});
