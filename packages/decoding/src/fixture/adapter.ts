/**
 * `FixtureDecoderAdapter` — the pure-TypeScript, zero-I/O decoder adapter
 * (W102). THE contract-level test substrate: `probe`/`decodeVideo`/
 * `decodeAudio` derive everything mathematically from a
 * {@link FixtureMediaSpec} and IGNORE the input bytes entirely, so tests are
 * fully deterministic (same spec in, deep-equal output out — the
 * docs/testing/HARNESS.md determinism rule).
 *
 * Semantics (documented because tests pin them):
 *
 * - `streamIndex` is the spec track's array position (0-based).
 * - `decodeVideo`: frame count = `round(durationMs / 1000 * fps)`;
 *   `presentationMs = index * 1000 / fps`; a frame is in a window iff its
 *   `presentationMs` lies in `[fromMs, toMs)` (inclusive start, exclusive
 *   end). Bytes are derived from `(pattern, frameIndex, width, height)`.
 * - `decodeAudio`: chunks follow the requested target; a chunk is emitted
 *   iff its `startMs` lies in `[fromMs, toMs)` (chunks are atomic and never
 *   truncated by `toMs`; the stream's final chunk may be short when the
 *   duration does not divide evenly). Sample values are derived from the
 *   sample's ABSOLUTE position on the media timeline, so a windowed decode
 *   reproduces exactly the corresponding slice of a full decode.
 * - Patterns: `gradient` bytes are `(x + y + frameIndex + channel) % 256`;
 *   `solid` bytes are `(BASE[channel] + frameIndex) % 256` with
 *   `BASE = [64, 128, 192]`; `sine` samples are
 *   `sin(2*pi*440*t) * 0.5` at the sample's timeline time (identical on
 *   every channel); `silence` samples are 0.
 */
import type { DecoderAdapter } from "../decoder";
import { DEFAULT_AUDIO_TARGET, samplesPerChunk } from "../types";
import type {
  AudioTarget,
  DecodeSourceInput,
  DecodeWindow,
  NormalizedAudioChunk,
  NormalizedVideoFrame,
  ProbeResult,
  TrackInfo,
} from "../types";

/** Deterministic video fixture spec. */
export interface FixtureVideoSpec {
  kind: "video";
  codec: string;
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
  /** Constant frame rate in frames per second. */
  fps: number;
  /** Stream duration in milliseconds. */
  durationMs: number;
  /** Byte pattern: spatial `gradient` or flat `solid`. */
  pattern: "gradient" | "solid";
}

/** Deterministic audio fixture spec. */
export interface FixtureAudioSpec {
  kind: "audio";
  codec: string;
  /** Source sample rate in hertz (reported by `probe`; decode follows the target). */
  sampleRate: number;
  /** Source channel count (reported by `probe`; decode follows the target). */
  channels: number;
  /** Stream duration in milliseconds. */
  durationMs: number;
  /** Sample pattern: reference `sine` or `silence`. */
  pattern: "sine" | "silence";
}

/** One deterministic media source: an ordered list of track specs. */
export interface FixtureMediaSpec {
  /** Track specs; array position is the track's `streamIndex`. */
  tracks: ReadonlyArray<FixtureVideoSpec | FixtureAudioSpec>;
}

/** Reference sine frequency (hertz) for the `sine` audio pattern. */
const SINE_HZ = 440;

/** Reference sine amplitude (linear float32 scale). */
const SINE_AMPLITUDE = 0.5;

/** Per-channel base byte values for the `solid` video pattern. */
const SOLID_BASE: readonly [number, number, number] = [64, 128, 192];

/**
 * The pure-TS fixture adapter. Constructed from a spec; every method is a
 * deterministic function of (spec, arguments) — no clock, no randomness, no
 * I/O, input bytes ignored.
 */
export class FixtureDecoderAdapter implements DecoderAdapter {
  private readonly tracks: ReadonlyArray<FixtureVideoSpec | FixtureAudioSpec>;

  constructor(spec: FixtureMediaSpec) {
    this.tracks = spec.tracks.map((track) => Object.freeze({ ...track }));
  }

  /** Deterministic probe: TrackInfo derived from the spec (bytes ignored). */
  async probe(input: DecodeSourceInput): Promise<ProbeResult> {
    const tracks = this.tracks.map((track, streamIndex) => this.trackInfo(streamIndex));
    const durationMs = tracks.reduce((max, track) => Math.max(max, track.durationMs), 0);
    return { tracks, container: input.receipt.container, durationMs };
  }

  /**
   * Yields mathematically-derived rgb24 frames; window slicing is
   * `[fromMs, toMs)` on `presentationMs`.
   */
  async *decodeVideo(
    _input: DecodeSourceInput,
    streamIndex: number,
    window?: DecodeWindow,
  ): AsyncGenerator<NormalizedVideoFrame> {
    const spec = this.videoSpec(streamIndex);
    const frameCount = Math.round((spec.durationMs / 1000) * spec.fps);
    const fromMs = window?.fromMs ?? 0;
    const toMs = window?.toMs;
    let decodeOrder = 0;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const presentationMs = (frameIndex * 1000) / spec.fps;
      if (presentationMs < fromMs) continue;
      if (toMs !== undefined && presentationMs >= toMs) continue;
      yield {
        frameId: `f-${streamIndex}-${decodeOrder}`,
        streamIndex,
        presentationMs,
        decodeOrder,
        width: spec.width,
        height: spec.height,
        pixelFormat: "rgb24",
        bytes: renderVideoFrame(spec, frameIndex),
      };
      decodeOrder += 1;
    }
  }

  /**
   * Yields mathematically-derived interleaved float32 chunks at `target`
   * (default: the canonical 48 kHz stereo / 250 ms target); a chunk is
   * emitted iff its `startMs` lies in `[fromMs, toMs)`.
   */
  async *decodeAudio(
    _input: DecodeSourceInput,
    streamIndex: number,
    window?: DecodeWindow,
    target?: AudioTarget,
  ): AsyncGenerator<NormalizedAudioChunk> {
    const spec = this.audioSpec(streamIndex);
    const audioTarget = target ?? DEFAULT_AUDIO_TARGET;
    const framesPerChunk = samplesPerChunk(audioTarget) / audioTarget.channels;
    const totalFrames = Math.round((spec.durationMs / 1000) * audioTarget.sampleRate);
    const fromMs = window?.fromMs ?? 0;
    const toMs = window?.toMs;

    // Absolute (timeline) sample-frame index where the first chunk starts;
    // rounding keeps windowed decodes aligned when fromMs is not
    // sample-exact.
    let chunkStartFrame = Math.round((fromMs * audioTarget.sampleRate) / 1000);
    let chunkIndex = 0;
    while (chunkStartFrame < totalFrames) {
      const startMs = fromMs + chunkIndex * audioTarget.chunkMs;
      if (toMs !== undefined && startMs >= toMs) break;
      const frames = Math.min(framesPerChunk, totalFrames - chunkStartFrame);
      if (frames <= 0) break;
      yield {
        chunkId: `a-${streamIndex}-${chunkIndex}`,
        streamIndex,
        startMs,
        sampleRate: audioTarget.sampleRate,
        channels: audioTarget.channels,
        samples: renderAudioChunk(spec.pattern, audioTarget, chunkStartFrame, frames),
      };
      chunkStartFrame += framesPerChunk;
      chunkIndex += 1;
    }
  }

  // --- internals ----------------------------------------------------------

  private trackInfo(streamIndex: number): TrackInfo {
    const track = this.trackAt(streamIndex);
    return {
      trackId: `t-${streamIndex}-${track.kind}`,
      streamIndex,
      kind: track.kind,
      codec: track.codec,
      startTimeMs: 0,
      durationMs: track.durationMs,
    };
  }

  private trackAt(streamIndex: number): FixtureVideoSpec | FixtureAudioSpec {
    const track = this.tracks[streamIndex];
    if (track === undefined) {
      throw new RangeError(`fixture has no track at stream index ${streamIndex}`);
    }
    return track;
  }

  private videoSpec(streamIndex: number): FixtureVideoSpec {
    const track = this.trackAt(streamIndex);
    if (track.kind !== "video") {
      throw new RangeError(`fixture track ${streamIndex} is audio, not video`);
    }
    return track;
  }

  private audioSpec(streamIndex: number): FixtureAudioSpec {
    const track = this.trackAt(streamIndex);
    if (track.kind !== "audio") {
      throw new RangeError(`fixture track ${streamIndex} is video, not audio`);
    }
    return track;
  }
}

/** Renders one deterministic rgb24 frame for `(spec, frameIndex)`. */
function renderVideoFrame(spec: FixtureVideoSpec, frameIndex: number): Uint8Array {
  const { width, height, pattern } = spec;
  const bytes = new Uint8Array(width * height * 3);
  if (pattern === "gradient") {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const base = (y * width + x) * 3;
        for (let c = 0; c < 3; c += 1) {
          bytes[base + c] = (x + y + frameIndex + c) % 256;
        }
      }
    }
  } else {
    for (let p = 0; p < width * height; p += 1) {
      for (let c = 0; c < 3; c += 1) {
        // c is always 0..2; the ?? 0 only satisfies noUncheckedIndexedAccess.
        bytes[p * 3 + c] = ((SOLID_BASE[c] ?? 0) + frameIndex) % 256;
      }
    }
  }
  return bytes;
}

/**
 * Renders one deterministic interleaved float32 chunk covering absolute
 * sample frames `[chunkStartFrame, chunkStartFrame + frames)`.
 */
function renderAudioChunk(
  pattern: "sine" | "silence",
  target: AudioTarget,
  chunkStartFrame: number,
  frames: number,
): Float32Array {
  const samples = new Float32Array(frames * target.channels);
  if (pattern === "silence") return samples;
  for (let frame = 0; frame < frames; frame += 1) {
    const absoluteFrame = chunkStartFrame + frame;
    const t = absoluteFrame / target.sampleRate;
    const value = Math.sin(2 * Math.PI * SINE_HZ * t) * SINE_AMPLITUDE;
    for (let c = 0; c < target.channels; c += 1) {
      samples[frame * target.channels + c] = value;
    }
  }
  return samples;
}
