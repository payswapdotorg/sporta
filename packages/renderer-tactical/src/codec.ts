/**
 * The typed codec wrapper for the tactical renderer (R301): raw RGB24 frame
 * sequences become REAL h264/MP4 bytes via ffmpeg's libx264.
 *
 * Determinism contract (verified by tests, and by the render determinism
 * proof): the same raw frame file, the same dimensions/framerate, and the
 * same ffmpeg build always produce byte-identical MP4 output. The wrapper
 * pins every knob that could introduce nondeterminism:
 *
 * - `-threads 1` — x264 frame threading is deterministic only for a fixed
 *   thread count, so the count is pinned;
 * - `-fflags +bitexact -flags:v +bitexact -map_metadata -1` — no encoder
 *   strings, no `creation_time`, no wall-clock atoms in the MP4;
 * - fixed `-preset/-tune/-profile/-level/-crf/-pix_fmt/-g` — no defaults
 *   drifting with environment;
 * - `-profile:v baseline -level 3.0 -pix_fmt yuv420p` — the maximal
 *   HTML5 `<video>` compatibility profile (Constrained Baseline L3.0).
 *
 * Honest failure: a missing ffmpeg, a failed spawn, or a non-zero exit is a
 * typed {@link TacticalCodecError} — never a fabricated or empty artifact.
 * The wrapper NEVER claims video that was not produced.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

/** The h264 codec identity the wrapper produces (verified by tests). */
export const TACTICAL_VIDEO_CODEC = "avc1.42E01E";

/** The container the wrapper produces. */
export const TACTICAL_CONTAINER = "mp4";

/** The error of the tactical codec wrapper (fail-loud, typed). */
export class TacticalCodecError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "TacticalCodecError";
  }
}

/** One raw-frame encode request. */
export interface EncodeFramesRequest {
  /** The staged raw RGB24 frame sequence file (frameCount × w × h × 3 bytes). */
  rawFrameSequencePath: string;
  frameCount: number;
  width: number;
  height: number;
  /** Frames per second (may be fractional, e.g. 12.5). */
  fps: number;
}

/** The typed video codec the tactical renderer delegates encoding to. */
export interface TacticalVideoCodec {
  /** The codec identity (e.g. "ffmpeg-h264"). */
  readonly kind: string;
  /** True when the encoder binary was probed and responded. */
  available(): boolean;
  /** The probed encoder version string (null before a successful probe). */
  version(): string | null;
  /**
   * Encodes the staged raw RGB24 frame sequence into MP4 bytes. Throws
   * {@link TacticalCodecError} on any failure — never returns partial video.
   */
  encode(request: EncodeFramesRequest): Buffer;
}

/** The fixed, deterministic ffmpeg arguments for one encode. */
function ffmpegArgs(request: EncodeFramesRequest & { outputPath: string }): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "rawvideo",
    "-pixel_format",
    "rgb24",
    "-video_size",
    `${request.width}x${request.height}`,
    "-framerate",
    String(request.fps),
    "-i",
    request.rawFrameSequencePath,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "stillimage",
    "-profile:v",
    "baseline",
    "-level",
    "3.0",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "25",
    "-threads",
    "1",
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
    "-map_metadata",
    "-1",
    "-f",
    "mp4",
    request.outputPath,
  ];
}

/**
 * The ffmpeg/libx264 implementation of {@link TacticalVideoCodec}.
 * Synchronous by design: the W501 renderer-contract conformance harness is
 * synchronous, and the encoded clips are small.
 */
export class FfmpegH264Codec implements TacticalVideoCodec {
  readonly kind = "ffmpeg-h264";
  private readonly ffmpegPath: string;
  private probedVersion: string | null = null;
  private probedAvailable = false;
  private probed = false;

  constructor(ffmpegPath = "ffmpeg") {
    this.ffmpegPath = ffmpegPath;
  }

  available(): boolean {
    this.probe();
    return this.probedAvailable;
  }

  version(): string | null {
    this.probe();
    return this.probedVersion;
  }

  encode(request: EncodeFramesRequest): Buffer {
    if (!this.available()) {
      throw new TacticalCodecError(
        `the tactical renderer's ffmpeg codec is unavailable (${this.ffmpegPath})`,
        { ffmpegPath: this.ffmpegPath },
      );
    }
    if (
      !Number.isInteger(request.width) ||
      request.width < 16 ||
      !Number.isInteger(request.height) ||
      request.height < 16
    ) {
      throw new TacticalCodecError(
        `encode dimensions must be integers >= 16 (got ${request.width}x${request.height})`,
        { width: request.width, height: request.height },
      );
    }
    if (request.width % 2 !== 0 || request.height % 2 !== 0) {
      throw new TacticalCodecError(
        `encode dimensions must be even (yuv420p chroma subsampling; got ${request.width}x${request.height})`,
        { width: request.width, height: request.height },
      );
    }
    if (!Number.isFinite(request.fps) || request.fps <= 0) {
      throw new TacticalCodecError(`encode fps must be finite > 0 (got ${String(request.fps)})`, {
        fps: request.fps,
      });
    }
    if (!Number.isInteger(request.frameCount) || request.frameCount < 1) {
      throw new TacticalCodecError(
        `encode frameCount must be an integer >= 1 (got ${String(request.frameCount)})`,
        { frameCount: request.frameCount },
      );
    }
    // The MP4 muxer needs a seekable output (a pipe cannot carry a classic
    // mp4), so the encode targets a sibling file of the raw input and the
    // bytes are read back — the returned Buffer IS the artifact.
    const outputPath = `${request.rawFrameSequencePath}.mp4`;
    rmSync(outputPath, { force: true });
    const run = spawnSync(this.ffmpegPath, ffmpegArgs({ ...request, outputPath }), {
      encoding: "buffer",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (run.error !== undefined) {
      throw new TacticalCodecError(`ffmpeg spawn failed: ${run.error.message}`, {
        ffmpegPath: this.ffmpegPath,
        cause: String(run.error),
      });
    }
    if (run.status !== 0) {
      throw new TacticalCodecError(
        `ffmpeg exited with status ${String(run.status)} — no artifact was produced`,
        {
          ffmpegPath: this.ffmpegPath,
          status: run.status,
          stderr: run.stderr?.toString("utf8").slice(0, 500),
        },
      );
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(outputPath);
    } catch (cause) {
      throw new TacticalCodecError(
        "ffmpeg reported success but produced no output file — no artifact was produced",
        { ffmpegPath: this.ffmpegPath, outputPath, cause: String(cause) },
      );
    } finally {
      rmSync(outputPath, { force: true });
    }
    if (bytes.length === 0) {
      throw new TacticalCodecError("ffmpeg produced no MP4 bytes — no artifact was produced", {
        ffmpegPath: this.ffmpegPath,
      });
    }
    return bytes;
  }

  /** Probes the binary once (`ffmpeg -version`), caching the result. */
  private probe(): void {
    if (this.probed) return;
    this.probed = true;
    const run = spawnSync(this.ffmpegPath, ["-version"], { encoding: "utf8" });
    if (run.error !== undefined || run.status !== 0) {
      this.probedAvailable = false;
      return;
    }
    const match = /ffmpeg version (\S+)/.exec(run.stdout);
    this.probedVersion = match?.[1] ?? "unknown";
    this.probedAvailable = true;
  }
}

/**
 * Creates the ffmpeg h264 codec, or `null` when the encoder binary is not
 * available on this machine (the caller decides how to fail — the tactical
 * renderer fails loud with a typed error rather than fabricating video).
 */
export function createFfmpegH264Codec(ffmpegPath = "ffmpeg"): FfmpegH264Codec | null {
  const codec = new FfmpegH264Codec(ffmpegPath);
  return codec.available() ? codec : null;
}
