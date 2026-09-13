/**
 * Inline typed fixtures for the W207 tests (the docs/testing/HARNESS.md
 * pattern: small local factories, only the fields under test varied, no
 * `Math.random`, no clock reads — every value is a fixed function of the
 * arguments).
 */

/**
 * The full W102 `NormalizedAudioChunk` field set, declared locally so the
 * tests build EXACT decoding-shaped chunks without a dependency on
 * `@sporta/decoding` (the adapter input `AsrChunkInput` is structural — see
 * its docs; this superset is assignable to it).
 */
export interface NormalizedAudioChunkLike {
  readonly chunkId: string;
  readonly streamIndex: number;
  readonly startMs: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly samples: Float32Array;
}

/** Reference sine frequency (hertz) for the `sine` chunk pattern. */
export const SINE_HZ = 440;

/** Reference sine amplitude (linear float32 scale). */
export const SINE_AMPLITUDE = 0.5;

/** Options for {@link makeChunks}. */
export interface MakeChunksOptions {
  /** Number of chunks to generate. */
  readonly count: number;
  /** Duration of each chunk in milliseconds. */
  readonly chunkMs: number;
  /** Sample rate in hertz (default 8000 — keeps all frame math exact). */
  readonly sampleRate?: number;
  /** Channel count (default 1). */
  readonly channels?: number;
  /** Source-time start of the FIRST chunk (default 0). */
  readonly startMs?: number;
  /** Sample pattern: `silence` (zeros) or `sine` (see module docs). */
  readonly pattern?: "silence" | "sine";
}

/**
 * Builds a contiguous run of decoding-shaped audio chunks: chunk i starts at
 * `startMs + i * chunkMs` and holds exactly `chunkMs * sampleRate / 1000`
 * sample frames per channel. `sine` samples are `sin(2*pi*440*t) * 0.5` at
 * the sample's ABSOLUTE source-timeline time (the W102 fixture convention),
 * so chunks concatenate into a seamless reference tone.
 */
export function makeChunks(options: MakeChunksOptions): NormalizedAudioChunkLike[] {
  const {
    count,
    chunkMs,
    sampleRate = 8000,
    channels = 1,
    startMs = 0,
    pattern = "silence",
  } = options;
  const framesPerChunk = Math.round((chunkMs * sampleRate) / 1000);
  const samplesPerChunk = framesPerChunk * channels;

  return Array.from({ length: count }, (_, index) => {
    const chunkStartMs = startMs + index * chunkMs;
    const samples = new Float32Array(samplesPerChunk);
    if (pattern === "sine") {
      const firstFrame = Math.round((chunkStartMs * sampleRate) / 1000);
      for (let frame = 0; frame < framesPerChunk; frame += 1) {
        const t = (firstFrame + frame) / sampleRate;
        const value = Math.sin(2 * Math.PI * SINE_HZ * t) * SINE_AMPLITUDE;
        for (let c = 0; c < channels; c += 1) {
          samples[frame * channels + c] = value;
        }
      }
    }
    return {
      chunkId: `a-0-${index}`,
      streamIndex: 0,
      startMs: chunkStartMs,
      sampleRate,
      channels,
      samples,
    };
  });
}

/**
 * Builds ONE decoding-shaped chunk of `durationMs` starting at `startMs`
 * (for straddle/gap cases that do not fit the fixed-chunk grid).
 */
export function makeChunk(
  durationMs: number,
  startMs = 0,
  options: Pick<MakeChunksOptions, "sampleRate" | "channels" | "pattern"> = {},
): NormalizedAudioChunkLike {
  const chunks = makeChunks({ count: 1, chunkMs: durationMs, startMs, ...options });
  const chunk = chunks[0];
  if (chunk === undefined) throw new Error("makeChunks produced no chunk");
  return chunk;
}
