/**
 * W102 FfmpegDecoderAdapter integration tests (CONDITIONAL: skipped with a
 * console warning when ffmpeg is unavailable on PATH). Synthesizes a fixed
 * 2-second test source via the ffmpeg CLI (`testsrc2` 160x120 @ 10 fps +
 * 1 kHz sine, libx264 + aac into a temp mp4), ingests it through the REAL
 * W101 boundary (`ingestSource`), then exercises probe, video decode, audio
 * decode, and a windowed decode through the full `DecodingService` envelope.
 *
 * Tolerances absorb encoder variance (AAC priming, container rounding);
 * media parameters are fixed constants — no clock or rng reads.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { TEST_EPOCH_MS, buildAuthorizationPolicy } from "@sporta/testing";
import { SourceRegistry, ingestSource } from "@sporta/ingestion";
import {
  DEFAULT_AUDIO_TARGET,
  DecodingService,
  FfmpegDecoderAdapter,
  stderrTail,
} from "../src/index";
import type { DecodeSourceInput, NormalizedAudioChunk, NormalizedVideoFrame } from "../src/index";

const availability = await FfmpegDecoderAdapter.detect();
if (!availability.available) {
  // The documented skip signal for environments without ffmpeg.
  console.warn("ffmpeg unavailable — skipping integration");
}

/** Fixed synthesized-source parameters (2 s, 160x120 @ 10 fps, 1 kHz sine). */
const TEST_WIDTH = 160;
const TEST_HEIGHT = 120;
const TEST_FPS = 10;
const TEST_DURATION_MS = 2000;
const SINE_HZ = 1000;

/** Path of the synthesized test mp4 (created in beforeAll, removed in afterAll). */
const synthesizedPath = `${tmpdir()}/sporta-w102-integration-${TEST_DURATION_MS}.mp4`;

/** The synthesized bytes, read once in beforeAll. */
let mp4Bytes: Uint8Array = new Uint8Array(0);

/** A rights policy that allows analysis (valid at TEST_EPOCH). */
const policy = buildAuthorizationPolicy();

/** Ingestion registry shared by the test inputs (idempotent receipts). */
const registry = new SourceRegistry();

/** Builds a decode input for the synthesized source via the real W101 boundary. */
function makeInput(): DecodeSourceInput {
  const receipt = ingestSource({
    sessionId: "sess-w102-ffmpeg",
    bytes: mp4Bytes,
    sourceKind: "file",
    filename: "w102-integration.mp4",
    authorizationPolicy: policy,
    nowMs: TEST_EPOCH_MS,
    registry,
  });
  return {
    receipt,
    authorizationPolicy: policy,
    openBytes: async () => mp4Bytes,
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

/** Collects an async iterable, capturing an error thrown mid-iteration. */
async function collectWithError<T>(
  iterable: AsyncIterable<T>,
): Promise<{ items: T[]; error?: unknown }> {
  const items: T[] = [];
  try {
    for await (const item of iterable) {
      items.push(item);
    }
  } catch (err) {
    return { items, error: err };
  }
  return { items, error: undefined };
}

describe.skipIf(!availability.available)("FfmpegDecoderAdapter integration", () => {
  beforeAll(async () => {
    // Synthesize the 2 s test mp4: testsrc2 video + 1 kHz sine audio,
    // libx264 + aac, exactly as the work item prescribes.
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=${TEST_WIDTH}x${TEST_HEIGHT}:rate=${TEST_FPS}`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${SINE_HZ}:sample_rate=48000`,
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-t",
        "2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        synthesizedPath,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`ffmpeg synthesis failed (exit ${exitCode}): ${stderrTail(stderr)}`);
    }
    mp4Bytes = new Uint8Array(await Bun.file(synthesizedPath).arrayBuffer());
    expect(mp4Bytes.byteLength).toBeGreaterThan(0);
  });

  afterAll(async () => {
    // Cleanup temp files (the adapter's own temp files are unlinked by the
    // adapter in finally blocks on every path).
    await unlink(synthesizedPath).catch(() => undefined);
  });

  test("detect() reports availability and a version banner", async () => {
    const detected = await FfmpegDecoderAdapter.detect();
    expect(detected.available).toBe(true);
    expect(detected.version).toBeDefined();
    expect(detected.version ?? "").toMatch(/ffmpeg version/i);
  });

  test("probe: one video + one audio track, duration ≈ 2000 ms (±200)", async () => {
    const adapter = new FfmpegDecoderAdapter();
    const result = await adapter.probe(makeInput());

    expect(result.container).toBe("mp4");
    expect(result.tracks).toHaveLength(2);
    const video = result.tracks.find((track) => track.kind === "video");
    const audio = result.tracks.find((track) => track.kind === "audio");
    expect(video).toBeDefined();
    expect(audio).toBeDefined();
    expect(video?.codec).toBe("h264");
    expect(audio?.codec).toBe("aac");
    expect(video?.streamIndex).toBe(0);
    expect(audio?.streamIndex).toBe(1);
    expect(Math.abs(result.durationMs - TEST_DURATION_MS)).toBeLessThanOrEqual(200);
    for (const track of result.tracks) {
      expect(track.startTimeMs).toBeGreaterThanOrEqual(0);
      expect(track.durationMs).toBeGreaterThan(0);
      expect(track.trackId).toMatch(/^t-\d+-(video|audio)$/);
    }
  });

  test("decodeVideo: 160x120x3 frames, count 20 ± 2, presentationMs ≈ 100 ms steps", async () => {
    const adapter = new FfmpegDecoderAdapter();
    const frames: NormalizedVideoFrame[] = await collect(adapter.decodeVideo(makeInput(), 0));

    expect(frames.length).toBeGreaterThanOrEqual(18);
    expect(frames.length).toBeLessThanOrEqual(22);
    expect(frames[0]?.presentationMs).toBeGreaterThanOrEqual(0);
    for (const [index, frame] of frames.entries()) {
      expect(frame.width).toBe(TEST_WIDTH);
      expect(frame.height).toBe(TEST_HEIGHT);
      expect(frame.pixelFormat).toBe("rgb24");
      expect(frame.bytes.byteLength).toBe(TEST_WIDTH * TEST_HEIGHT * 3);
      expect(frame.streamIndex).toBe(0);
      expect(frame.decodeOrder).toBe(index);
      expect(frame.frameId).toBe(`f-0-${index}`);
    }
    // Monotonic presentation timestamps with ~100 ms steps (CFR tolerance).
    for (let i = 1; i < frames.length; i += 1) {
      const step = (frames[i]?.presentationMs ?? 0) - (frames[i - 1]?.presentationMs ?? 0);
      expect(step).toBeGreaterThan(0);
      expect(Math.abs(step - 1000 / TEST_FPS)).toBeLessThanOrEqual(2);
    }
  });

  test("decodeAudio: 48 kHz stereo chunks of ≤ 24000 samples, count ≈ 8", async () => {
    const adapter = new FfmpegDecoderAdapter();
    const chunks: NormalizedAudioChunk[] = await collect(adapter.decodeAudio(makeInput(), 1));

    expect(chunks.length).toBeGreaterThanOrEqual(7);
    expect(chunks.length).toBeLessThanOrEqual(9);
    let totalSamples = 0;
    for (const [index, chunk] of chunks.entries()) {
      expect(chunk.sampleRate).toBe(DEFAULT_AUDIO_TARGET.sampleRate);
      expect(chunk.channels).toBe(DEFAULT_AUDIO_TARGET.channels);
      expect(chunk.chunkId).toBe(`a-1-${index}`);
      expect(chunk.startMs).toBe(index * DEFAULT_AUDIO_TARGET.chunkMs);
      expect(chunk.samples.length).toBeGreaterThan(0);
      expect(chunk.samples.length).toBeLessThanOrEqual(
        DEFAULT_AUDIO_TARGET.sampleRate * DEFAULT_AUDIO_TARGET.channels * 0.25,
      );
      expect(chunk.samples.length % 2).toBe(0);
      totalSamples += chunk.samples.length;
    }
    // ~2 s of interleaved stereo samples (AAC priming tolerance).
    expect(Math.abs(totalSamples - 2 * 48_000 * 2)).toBeLessThanOrEqual(2000);
    // A 1 kHz sine at 48 kHz must produce non-silent audio.
    expect(chunks[0]?.samples.some((value) => value !== 0)).toBe(true);
  });

  test("windowed decode through the service: fromMs 500 / toMs 1000 → roughly half the frames", async () => {
    const adapter = new FfmpegDecoderAdapter();
    const service = new DecodingService({ adapter, nowMs: TEST_EPOCH_MS });
    const { items, error } = await collectWithError(
      service.decodeVideo(makeInput(), 0, { fromMs: 500, toMs: 1000 }),
    );

    expect(error).toBeUndefined();
    // ~20 total frames → the 500 ms window holds ~5 (roughly half of half).
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeLessThanOrEqual(7);
    for (const [index, frame] of items.entries()) {
      expect(frame.decodeOrder).toBe(index);
      expect(frame.presentationMs).toBeGreaterThanOrEqual(500);
      expect(frame.bytes.byteLength).toBe(TEST_WIDTH * TEST_HEIGHT * 3);
    }
  });

  test("rights denial at the service boundary skips ffmpeg entirely", async () => {
    const noAnalysis = buildAuthorizationPolicy({
      allowedOperations: ["transformation"],
    });
    const input: DecodeSourceInput = {
      ...makeInput(),
      authorizationPolicy: noAnalysis,
    };
    const adapter = new FfmpegDecoderAdapter();
    const service = new DecodingService({ adapter, nowMs: TEST_EPOCH_MS });
    const { items, error } = await collectWithError(service.decodeVideo(input, 0));

    expect(items).toHaveLength(0);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("RightsDeniedError");
  });
});
