/**
 * `FfmpegDecoderAdapter` — the ffmpeg/ffprobe SUBPROCESS adapter (W102).
 *
 * ffmpeg is used ONLY as a subprocess via `Bun.spawn` (never an npm
 * package — no new dependencies, architecture-lock §9 vendor neutrality).
 * This file is MECHANICAL by design: all policy (rights, limits, output
 * validation) lives in `DecodingService`, which wraps this adapter.
 *
 * Behavior contract:
 *
 * - Every method materializes the source bytes into a temp file
 *   (`<tmpdir>/sporta-decode-<sessionId>-<checksum8>.<container>`) and
 *   UNLINKS it in a `finally` on every path, including errors and early
 *   consumer termination.
 * - `probe`: `ffprobe -v error -print_format json -show_format -show_streams`
 *   → video/audio `TrackInfo` (data/subtitle/attachment streams skipped);
 *   times are `start_time`/`duration` seconds × 1000, ROUNDED to the nearest
 *   millisecond; a stream's `durationMs` falls back to the container format
 *   duration. Nonzero exit or unparseable JSON → `UnsupportedMediaError`
 *   with a bounded `details.stderrTail` (last 2000 chars, never full stderr).
 * - `decodeVideo`: `ffmpeg -v error [-ss fromSec] [-t durSec] -i <file>
 *   -map 0:<streamIndex> -f rawvideo -pix_fmt rgb24 -`. stdout is read as a
 *   STREAM; frame boundaries are the fixed `width*height*3` byte size.
 *   KNOWN LIMITATION (documented per the work item): timestamps assume
 *   constant frame rate — `presentationMs = streamStartMs + decodeIndex ×
 *   (1000 / avgFrameRate)` with `avg_frame_rate` parsed as a rational
 *   (`"30000/1001"`); VFR content is approximated at the container rate.
 *   `frameId = "f-<streamIndex>-<decodeOrder>"`. Stream dimensions/frame
 *   rate come from the adapter's probe cache, or — when a decode call
 *   arrives without a prior probe on this source — from a targeted
 *   `ffprobe -select_streams v -show_entries stream=index,codec_type,width,
 *   height,avg_frame_rate,start_time` run (cached per source checksum +
 *   stream; matched by the ABSOLUTE stream `index` because ffprobe's
 *   `v:<n>` selects the n-th video stream, not absolute index n).
 * - `decodeAudio`: `ffmpeg -v error [-ss] [-t] -i <file> -map 0:<streamIndex>
 *   -ar <sampleRate> -ac <channels> -f f32le -acodec pcm_f32le -`; chunk
 *   boundaries are `target.chunkMs` worth of interleaved samples;
 *   `startMs = fromMs + chunkIndex * chunkMs` (re-based after the seek);
 *   `chunkId = "a-<streamIndex>-<chunkIndex>"`. A trailing PARTIAL final
 *   chunk is legitimate audio (durations rarely divide evenly) and is
 *   emitted whole-number-of-sample-frames or rejected as media-invalid.
 *   Raw f32le is little-endian; the float32 view assumes a little-endian
 *   host (all supported targets).
 */
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { UnsupportedMediaError, stderrTail } from "../errors";
import type { Container } from "@sporta/ingestion";

/** Constructor options; both paths default to a PATH lookup via `Bun.which`. */
export interface FfmpegDecoderAdapterOptions {
  /** Path to the ffmpeg binary (default: `Bun.which("ffmpeg")`). */
  ffmpegPath?: string;
  /** Path to the ffprobe binary (default: `Bun.which("ffprobe")`). */
  ffprobePath?: string;
}

/** Result of the static availability probe. */
export interface FfmpegAvailability {
  /** Whether an `ffmpeg -version` run exited 0 within the timeout. */
  available: boolean;
  /** First stdout line of `ffmpeg -version` (the version banner). */
  version?: string;
}

/** `ffmpeg -version` timeout for {@link FfmpegDecoderAdapter.detect}. */
const DETECT_TIMEOUT_MS = 5_000;

/** File extension per ingestion container family. */
const CONTAINER_EXTENSIONS: Readonly<Record<Container, string>> = Object.freeze({
  mp4: "mp4",
  webm: "webm",
  mkv: "mkv",
  mpegts: "ts",
  avi: "avi",
  unknown: "bin",
});

/** ffprobe JSON stream entry (only the fields this adapter reads). */
interface FfprobeStreamJson {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  start_time?: number | string;
  duration?: number | string;
  tags?: Record<string, string>;
}

/** ffprobe JSON document (only the fields this adapter reads). */
interface FfprobeJson {
  streams?: FfprobeStreamJson[];
  format?: { duration?: number | string };
}

/** Video decode geometry for one (source, stream), cached per adapter. */
interface VideoGeometry {
  width: number;
  height: number;
  /** Average frame rate in fps; `null` when no usable rate was reported. */
  frameRate: number | null;
  /** Stream start offset in milliseconds (rounded). */
  startTimeMs: number;
}

/** Result of a subprocess run to completion (both pipes drained). */
interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * The ffmpeg/ffprobe subprocess adapter. Stateless between calls except for
 * the per-source video-geometry cache keyed by `<checksum>:<streamIndex>`
 * (never shared across different sources).
 */
export class FfmpegDecoderAdapter implements DecoderAdapter {
  private readonly ffmpegPath: string | null;
  private readonly ffprobePath: string | null;
  private readonly videoGeometryCache = new Map<string, VideoGeometry>();

  constructor(options: FfmpegDecoderAdapterOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? Bun.which("ffmpeg") ?? null;
    this.ffprobePath = options.ffprobePath ?? Bun.which("ffprobe") ?? null;
  }

  /**
   * Availability probe: spawns `ffmpeg -version` with a 5-second timeout and
   * reports whether it exited 0. Used by tests to skip integration and by
   * callers to choose an adapter. Always resolves — never throws.
   */
  static async detect(): Promise<FfmpegAvailability> {
    const ffmpegPath = Bun.which("ffmpeg");
    if (ffmpegPath === null) return { available: false };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const proc = Bun.spawn([ffmpegPath, "-version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      timeout = setTimeout(() => {
        proc.kill();
      }, DETECT_TIMEOUT_MS);
      timeout.unref?.();
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
      if (exitCode === 0) {
        const banner = stdout.split("\n", 1)[0] ?? "";
        return { available: true, version: banner.trim() };
      }
      return { available: false };
    } catch {
      return { available: false };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  /** Demux-level probe via ffprobe JSON; see the module doc for semantics. */
  async probe(input: DecodeSourceInput): Promise<ProbeResult> {
    this.requireBinary(this.ffprobePath, "ffprobe");
    const temp = await materializeTempFile(input);
    try {
      const result = await runToCompletion(this.ffprobePath as string, [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        temp.path,
      ]);

      if (result.exitCode !== 0) {
        throw new UnsupportedMediaError(
          `ffprobe exited with code ${result.exitCode} on the provided source`,
          { exitCode: result.exitCode, stderrTail: stderrTail(result.stderr) },
        );
      }

      let parsed: FfprobeJson;
      try {
        parsed = JSON.parse(result.stdout) as FfprobeJson;
      } catch {
        throw new UnsupportedMediaError("ffprobe output was not parseable JSON", {
          stderrTail: stderrTail(result.stderr),
        });
      }

      const tracks: TrackInfo[] = [];
      let maxTrackDurationMs = 0;
      for (const stream of parsed.streams ?? []) {
        const kind =
          stream.codec_type === "video" ? "video" : stream.codec_type === "audio" ? "audio" : null;
        // data / subtitle / attachment streams are not media inputs (§3):
        // skip them entirely.
        if (kind === null || typeof stream.index !== "number") continue;

        const track: TrackInfo = {
          trackId: `t-${stream.index}-${kind}`,
          streamIndex: stream.index,
          kind,
          codec: stream.codec_name ?? "unknown",
          ...(stream.tags?.language !== undefined ? { language: stream.tags.language } : {}),
          startTimeMs: secondsToMs(stream.start_time),
          // Stream duration, falling back to the container format duration.
          durationMs: secondsToMs(stream.duration ?? parsed.format?.duration),
        };
        tracks.push(track);
        maxTrackDurationMs = Math.max(maxTrackDurationMs, track.durationMs);

        if (kind === "video") {
          this.videoGeometryCache.set(geometryCacheKey(input, stream.index), {
            width: stream.width ?? 0,
            height: stream.height ?? 0,
            frameRate: parseFrameRate(stream.avg_frame_rate),
            startTimeMs: track.startTimeMs,
          });
        }
      }

      return {
        tracks,
        container: input.receipt.container,
        durationMs: Math.max(secondsToMs(parsed.format?.duration), maxTrackDurationMs),
      };
    } finally {
      await temp.cleanup();
    }
  }

  /** Video decode; see the module doc for command shape and CFR timestamps. */
  async *decodeVideo(
    input: DecodeSourceInput,
    streamIndex: number,
    window?: DecodeWindow,
  ): AsyncGenerator<NormalizedVideoFrame> {
    this.requireBinary(this.ffmpegPath, "ffmpeg");
    const geometry = await this.resolveVideoGeometry(input, streamIndex);
    if (geometry.width <= 0 || geometry.height <= 0) {
      throw new UnsupportedMediaError(`video stream ${streamIndex} reports no usable dimensions`, {
        streamIndex,
      });
    }
    if (geometry.frameRate === null || geometry.frameRate <= 0) {
      throw new UnsupportedMediaError(`video stream ${streamIndex} reports no usable frame rate`, {
        streamIndex,
      });
    }
    const frameBytes = geometry.width * geometry.height * 3;
    const frameDurationMs = 1000 / geometry.frameRate;

    const temp = await materializeTempFile(input);
    try {
      const seek = seekArguments(window);
      if (seek === null) return; // degenerate window (toMs <= fromMs): no frames
      const proc = Bun.spawn(
        [
          this.ffmpegPath as string,
          "-v",
          "error",
          ...seek,
          "-i",
          temp.path,
          "-map",
          `0:${streamIndex}`,
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );

      const assembler = new ByteAssembler(frameBytes);
      const reader = proc.stdout.getReader();
      // Drain stderr concurrently (bounded: `-v error` output) so a chatty
      // failure can never deadlock the stdout pipe.
      const stderrPromise = new Response(proc.stderr).text();
      let decodeOrder = 0;
      let observedExit = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (value !== undefined && value.byteLength > 0) assembler.push(value);
          if (done) break;
          for (let frame = assembler.take(); frame !== undefined; frame = assembler.take()) {
            yield {
              frameId: `f-${streamIndex}-${decodeOrder}`,
              streamIndex,
              // KNOWN LIMITATION: constant-frame-rate assumption — VFR
              // content is approximated at the container avg rate. The
              // formula is exact (unrounded); consumers round as needed.
              // fromMs re-bases the decode window onto the ABSOLUTE media
              // timeline (the same "after seek" semantics as the audio
              // startMs = fromMs + chunkIndex*chunkMs), so a windowed
              // decode keeps canonical timeline positions.
              presentationMs:
                geometry.startTimeMs + (window?.fromMs ?? 0) + decodeOrder * frameDurationMs,
              decodeOrder,
              width: geometry.width,
              height: geometry.height,
              pixelFormat: "rgb24",
              bytes: frame,
            };
            decodeOrder += 1;
          }
        }

        const [exitCode, stderr] = await Promise.all([proc.exited, stderrPromise]);
        observedExit = true;
        if (exitCode !== 0) {
          throw new UnsupportedMediaError(
            `ffmpeg exited with code ${exitCode} while decoding video stream ${streamIndex}`,
            { exitCode, streamIndex, stderrTail: stderrTail(stderr) },
          );
        }
        if (assembler.remaining > 0) {
          // A rawvideo frame is atomic: trailing partial bytes mean the
          // decode output is corrupt (attacker-controlled, §13).
          throw new UnsupportedMediaError(
            `rawvideo output ended with a partial frame: ${assembler.remaining} trailing bytes ` +
              `do not form a ${frameBytes}-byte frame`,
            { streamIndex, frameBytes, trailingBytes: assembler.remaining },
          );
        }
      } finally {
        // Early consumer termination (break) dispatches a return completion
        // through here: kill the still-running child so it cannot outlive
        // the consumer, then release the stdout lock. After an observed
        // natural exit there is nothing to kill.
        if (!observedExit) {
          try {
            proc.kill();
          } catch {
            // already exited — nothing to do
          }
        }
        try {
          await reader.cancel();
        } catch {
          // stream already closed — nothing to do
        }
      }
    } finally {
      await temp.cleanup();
    }
  }

  /** Audio decode; see the module doc for command shape and chunking. */
  async *decodeAudio(
    input: DecodeSourceInput,
    streamIndex: number,
    window?: DecodeWindow,
    target?: AudioTarget,
  ): AsyncGenerator<NormalizedAudioChunk> {
    this.requireBinary(this.ffmpegPath, "ffmpeg");
    const audioTarget = target ?? DEFAULT_AUDIO_TARGET;
    const chunkSamples = samplesPerChunk(audioTarget); // throws on fractional
    const chunkBytes = chunkSamples * 4; // f32le: 4 bytes per sample
    const fromMs = window?.fromMs ?? 0;

    const temp = await materializeTempFile(input);
    try {
      const seek = seekArguments(window);
      if (seek === null) return; // degenerate window: no audio
      const proc = Bun.spawn(
        [
          this.ffmpegPath as string,
          "-v",
          "error",
          ...seek,
          "-i",
          temp.path,
          "-map",
          `0:${streamIndex}`,
          "-ar",
          String(audioTarget.sampleRate),
          "-ac",
          String(audioTarget.channels),
          "-f",
          "f32le",
          "-acodec",
          "pcm_f32le",
          "-",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );

      const assembler = new ByteAssembler(chunkBytes);
      const reader = proc.stdout.getReader();
      // Drain stderr concurrently (bounded: `-v error` output).
      const stderrPromise = new Response(proc.stderr).text();
      let chunkIndex = 0;
      let observedExit = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (value !== undefined && value.byteLength > 0) assembler.push(value);
          if (done) break;
          for (let bytes = assembler.take(); bytes !== undefined; bytes = assembler.take()) {
            yield {
              chunkId: `a-${streamIndex}-${chunkIndex}`,
              streamIndex,
              // Re-based after the seek: the first chunk starts at fromMs.
              startMs: fromMs + chunkIndex * audioTarget.chunkMs,
              sampleRate: audioTarget.sampleRate,
              channels: audioTarget.channels,
              samples: bytesAsFloat32(bytes),
            };
            chunkIndex += 1;
          }
        }

        const [exitCode, stderr] = await Promise.all([proc.exited, stderrPromise]);
        observedExit = true;
        if (exitCode !== 0) {
          throw new UnsupportedMediaError(
            `ffmpeg exited with code ${exitCode} while decoding audio stream ${streamIndex}`,
            { exitCode, streamIndex, stderrTail: stderrTail(stderr) },
          );
        }
        // A trailing PARTIAL final chunk is legitimate audio (durations
        // rarely divide evenly): emit it as a whole number of sample frames,
        // or reject a misaligned tail as corrupt output.
        if (assembler.remaining > 0) {
          if (assembler.remaining % (4 * audioTarget.channels) !== 0) {
            throw new UnsupportedMediaError(
              `f32le output ended mid-sample-frame: ${assembler.remaining} trailing bytes ` +
                `do not form whole ${audioTarget.channels}-channel sample frames`,
              { streamIndex, trailingBytes: assembler.remaining, channels: audioTarget.channels },
            );
          }
          const samples = bytesAsFloat32(assembler.takeRemaining());
          yield {
            chunkId: `a-${streamIndex}-${chunkIndex}`,
            streamIndex,
            startMs: fromMs + chunkIndex * audioTarget.chunkMs,
            sampleRate: audioTarget.sampleRate,
            channels: audioTarget.channels,
            samples,
          };
        }
      } finally {
        // Early consumer termination (break) dispatches a return completion
        // through here: kill the still-running child, then release the
        // stdout lock. After an observed natural exit there is nothing to
        // kill.
        if (!observedExit) {
          try {
            proc.kill();
          } catch {
            // already exited — nothing to do
          }
        }
        try {
          await reader.cancel();
        } catch {
          // stream already closed — nothing to do
        }
      }
    } finally {
      await temp.cleanup();
    }
  }

  // --- internals ----------------------------------------------------------

  /** Resolves video geometry from the cache or a targeted ffprobe run. */
  private async resolveVideoGeometry(
    input: DecodeSourceInput,
    streamIndex: number,
  ): Promise<VideoGeometry> {
    const key = geometryCacheKey(input, streamIndex);
    const cached = this.videoGeometryCache.get(key);
    if (cached !== undefined) return cached;

    this.requireBinary(this.ffprobePath, "ffprobe");
    const temp = await materializeTempFile(input);
    try {
      // NOTE: `-select_streams v:<idx>` in ffprobe means the idx-th VIDEO
      // stream, not the stream at absolute index idx — for streams whose
      // absolute index differs (audio-first files), that command would
      // select the wrong stream or none. Selecting every video stream and
      // matching the ABSOLUTE `index` field is correct in all cases.
      const result = await runToCompletion(this.ffprobePath as string, [
        "-v",
        "error",
        "-select_streams",
        "v",
        "-show_entries",
        "stream=index,codec_type,width,height,avg_frame_rate,start_time",
        "-print_format",
        "json",
        temp.path,
      ]);
      if (result.exitCode !== 0) {
        throw new UnsupportedMediaError(
          `ffprobe exited with code ${result.exitCode} while inspecting video stream ${streamIndex}`,
          { exitCode: result.exitCode, streamIndex, stderrTail: stderrTail(result.stderr) },
        );
      }
      let parsed: FfprobeJson;
      try {
        parsed = JSON.parse(result.stdout) as FfprobeJson;
      } catch {
        throw new UnsupportedMediaError(
          `ffprobe output was not parseable JSON for video stream ${streamIndex}`,
          { streamIndex, stderrTail: stderrTail(result.stderr) },
        );
      }
      const stream = parsed.streams?.find(
        (candidate) => candidate.index === streamIndex && candidate.codec_type === "video",
      );
      if (stream === undefined) {
        throw new UnsupportedMediaError(`no video stream found at index ${streamIndex}`, {
          streamIndex,
        });
      }
      const geometry: VideoGeometry = {
        width: stream.width ?? 0,
        height: stream.height ?? 0,
        frameRate: parseFrameRate(stream.avg_frame_rate),
        startTimeMs: secondsToMs(stream.start_time),
      };
      this.videoGeometryCache.set(key, geometry);
      return geometry;
    } finally {
      await temp.cleanup();
    }
  }

  /** Throws `UnsupportedMediaError` when a required binary is missing. */
  private requireBinary(path: string | null, name: string): void {
    if (path === null) {
      throw new UnsupportedMediaError(
        `${name} executable not found on PATH; the ffmpeg adapter requires ffmpeg/ffprobe`,
        { missingBinary: name },
      );
    }
  }
}

// --- module-level helpers ---------------------------------------------------

/** Cache key: source checksum + stream index (never shared across sources). */
function geometryCacheKey(input: DecodeSourceInput, streamIndex: number): string {
  return `${input.receipt.checksum}:${streamIndex}`;
}

/** Seconds (ffprobe JSON number or numeric string) → rounded milliseconds. */
function secondsToMs(seconds: number | string | undefined): number {
  if (seconds === undefined) return 0;
  const value = typeof seconds === "number" ? seconds : Number.parseFloat(seconds);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 1000);
}

/**
 * Parses an ffprobe rational frame rate (`"30000/1001"`, `"25"`, `"0/0"`).
 * Returns `null` for missing, zero, or unusable values.
 */
function parseFrameRate(rate: string | undefined): number | null {
  if (rate === undefined) return null;
  const parts = rate.split("/");
  const numerator = Number.parseFloat(parts[0] ?? "");
  if (!Number.isFinite(numerator)) return null;
  const denominator = parts.length > 1 ? Number.parseFloat(parts[1] ?? "") : 1;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const fps = numerator / denominator;
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

/**
 * Seek window → ffmpeg input arguments. Returns `null` for a degenerate
 * window (`toMs <= fromMs`): nothing can be decoded, so the caller skips
 * the subprocess entirely.
 */
function seekArguments(window: DecodeWindow | undefined): string[] | null {
  const fromMs = window?.fromMs;
  const toMs = window?.toMs;
  if (fromMs === undefined && toMs === undefined) return [];
  if (fromMs !== undefined && toMs !== undefined && toMs <= fromMs) return null;
  const args: string[] = [];
  if (fromMs !== undefined) args.push("-ss", String(fromMs / 1000));
  if (toMs !== undefined) {
    const durationSec = (toMs - (fromMs ?? 0)) / 1000;
    if (durationSec > 0) args.push("-t", String(durationSec));
  }
  return args;
}

/** Interprets a fresh f32le byte buffer as an interleaved Float32Array. */
function bytesAsFloat32(bytes: Uint8Array): Float32Array {
  if (bytes.byteOffset !== 0 || bytes.byteLength % 4 !== 0) {
    // Assembler slices always produce offset-0, 4-aligned buffers; this is
    // a defensive invariant, not an expected path.
    throw new UnsupportedMediaError("f32le buffer is not 4-byte aligned", {
      byteOffset: bytes.byteOffset,
      byteLength: bytes.byteLength,
    });
  }
  return new Float32Array(bytes.buffer, 0, bytes.byteLength / 4);
}

/** Writes the source bytes to a temp file; `cleanup` unlinks it (idempotent). */
async function materializeTempFile(
  input: DecodeSourceInput,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const bytes = await input.openBytes();
  // Session ids are platform-generated but never trusted as path material:
  // strip everything outside [A-Za-z0-9_-] and bound the length.
  const safeSessionId = input.receipt.sessionId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
  const checksum8 = input.receipt.checksum.slice(0, 8);
  const extension = CONTAINER_EXTENSIONS[input.receipt.container] ?? "bin";
  const path = `${tmpdir()}/sporta-decode-${safeSessionId}-${checksum8}.${extension}`;
  await Bun.write(path, bytes);
  let cleaned = false;
  return {
    path,
    cleanup: async (): Promise<void> => {
      if (cleaned) return;
      cleaned = true;
      try {
        await unlink(path);
      } catch {
        // already gone (or never fully written) — cleanup must never mask
        // the original failure path
      }
    },
  };
}

/** Runs one subprocess to completion with both pipes drained. */
async function runToCompletion(command: string, args: string[]): Promise<SpawnResult> {
  const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

/**
 * Byte assembler for fixed-size item framing over a pipe: absorbs arbitrary
 * chunks, hands out consecutive `itemBytes`-sized slices (each a private
 * copy), and reports trailing bytes. Grows geometrically and compacts
 * internally, so piping N frames costs O(N) copies, not O(N²) concatenation.
 */
class ByteAssembler {
  private buffer: Uint8Array;
  private start = 0;
  private end = 0;
  private readonly itemBytes: number;

  constructor(itemBytes: number) {
    this.itemBytes = itemBytes;
    this.buffer = new Uint8Array(Math.max(itemBytes * 2, 64 * 1024));
  }

  /** Bytes buffered but not yet consumed. */
  get remaining(): number {
    return this.end - this.start;
  }

  /** Absorbs one pipe chunk. */
  push(chunk: Uint8Array): void {
    const needed = this.remaining + chunk.byteLength;
    if (needed > this.buffer.byteLength) {
      // Grow (geometrically, at least to fit) and compact into the new buffer.
      let capacity = this.buffer.byteLength;
      while (capacity < needed) capacity *= 2;
      const next = new Uint8Array(capacity);
      next.set(this.buffer.subarray(this.start, this.end), 0);
      this.end -= this.start;
      this.start = 0;
      this.buffer = next;
    } else if (this.end + chunk.byteLength > this.buffer.byteLength) {
      // Fits after compaction (move live bytes to the front).
      this.buffer.copyWithin(0, this.start, this.end);
      this.end -= this.start;
      this.start = 0;
    }
    this.buffer.set(chunk, this.end);
    this.end += chunk.byteLength;
  }

  /** Takes the next complete item as a private copy, or `undefined`. */
  take(): Uint8Array | undefined {
    if (this.remaining < this.itemBytes) return undefined;
    const out = this.buffer.slice(this.start, this.start + this.itemBytes);
    this.start += this.itemBytes;
    return out;
  }

  /** Takes ALL buffered bytes as a private copy (trailing partial item). */
  takeRemaining(): Uint8Array {
    const out = this.buffer.slice(this.start, this.end);
    this.start = this.end;
    return out;
  }
}
