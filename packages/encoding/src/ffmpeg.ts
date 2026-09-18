/**
 * THE real ffmpeg adapter (R306): staged/in-memory rgb24 frame sequences
 * become REAL h264/MP4 bytes via ffmpeg's libx264, as a bounded,
 * fail-loud subprocess — following `packages/renderer-tactical/src/codec.ts`
 * (the deterministic-ffmpeg precedent) EXACTLY on every determinism knob.
 *
 * ## The pinned argv (identical knobs to the tactical codec)
 *
 * ```text
 * ffmpeg -hide_banner -loglevel error
 *   -f rawvideo -pixel_format rgb24 -video_size <WxH> -framerate <fps>
 *   -i <staged-frames>
 *   -an -c:v libx264 -preset veryfast -tune stillimage
 *   -profile:v baseline -level 3.0 -crf 18 -pix_fmt yuv420p -g 25
 *   -threads 1 -fflags +bitexact -flags:v +bitexact -map_metadata -1
 *   -f mp4 <out.mp4>
 * ```
 *
 * Determinism contract (the tactical codec's, verbatim): the same raw
 * frame file, the same dimensions/framerate, and the same ffmpeg build
 * always produce byte-identical MP4 output:
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
 * HONEST BOUND (documented, per the renderer-3d game codec's precedent):
 * ffmpeg 7.x REMOVED `-movflags +bitexact` from the mp4 muxer (it errors;
 * the option list above deliberately does not carry it), and the x264
 * bitstream still embeds the core-version SEI, which is constant for a
 * given build but varies ACROSS builds — byte-determinism is therefore
 * PER BUILD (the tests prove it empirically per run: three runs, one
 * sha-256). Cross-build byte-stability is NOT claimed.
 *
 * Bounded subprocess discipline (beyond the tactical precedent, per the
 * R306 brief): every spawn is `spawnSync` with a bounded `maxBuffer`
 * (256 MiB), a bounded `timeout` (default 60 s) and `killSignal:
 * "SIGKILL"` — a timed-out child is KILLED and reaped by the synchronous
 * contract (no zombies possible), and the timeout surfaces as a typed
 * `EncodingError("encode-failed")` with the signal recorded, never a
 * hang. Exit codes are surfaced honestly (status + a 500-char stderr
 * excerpt in the error details).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncodingError } from "./errors";
import { sha256Of } from "./internal";
import type {
  EncodedCodecParams,
  FrameEncodeRequest,
  FrameEncodeResult,
  FrameEncoderPort,
} from "./types";

/** The h264 codec identity the adapter produces (Constrained Baseline @ L3.0). */
export const ENCODED_VIDEO_CODEC = "avc1.42E01E";

/** The container the adapter produces. */
export const ENCODED_CONTAINER = "mp4";

/** The adapter identity. */
export const FFMPEG_ENCODER_KIND = "ffmpeg-libx264";

/** The default subprocess timeout (milliseconds) — a bound, never a hang. */
export const DEFAULT_ENCODE_TIMEOUT_MS = 60_000;

/** The bounded stdio capture cap (the tactical codec's 256 MiB). */
const MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/** The argv summary recorded in every manifest (deterministic, human-readable). */
const ARGV_SUMMARY =
  "ffmpeg -hide_banner -loglevel error -f rawvideo -pixel_format rgb24 " +
  "-video_size <WxH> -framerate <fps> -i <staged> -an -c:v libx264 -preset veryfast " +
  "-tune stillimage -profile:v baseline -level 3.0 -crf 18 -pix_fmt yuv420p -g 25 " +
  "-threads 1 -fflags +bitexact -flags:v +bitexact -map_metadata -1 -f mp4 <out>";

/** The pinned codec parameters of every real encode. */
export const REAL_ENCODE_CODEC_PARAMS: EncodedCodecParams = {
  container: ENCODED_CONTAINER,
  videoCodec: ENCODED_VIDEO_CODEC,
  encoder: ARGV_SUMMARY,
  preset: "veryfast",
  tune: "stillimage",
  profile: "baseline",
  level: "3.0",
  crf: 18,
  pixFmt: "yuv420p",
  gop: 25,
  threads: 1,
  bitexact: true,
};

/** The fixed, deterministic ffmpeg arguments for one encode (the tactical argv, verbatim). */
function ffmpegArgs(request: {
  rawFrameSequencePath: string;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
}): string[] {
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

/** Admits the geometry/fps/frame-count (the tactical codec's checks, verbatim). */
function admitGeometry(width: number, height: number, fps: number, frameCount: number): void {
  if (!Number.isInteger(width) || width < 16 || !Number.isInteger(height) || height < 16) {
    throw new EncodingError("media-invalid", "frames-invalid", "encode dimensions must be integers >= 16", {
      width,
      height,
    });
  }
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new EncodingError(
      "media-invalid",
      "frames-invalid",
      "encode dimensions must be even (yuv420p chroma subsampling)",
      { width, height },
    );
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new EncodingError("media-invalid", "frames-invalid", "encode fps must be finite > 0", {
      fps,
    });
  }
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new EncodingError("media-invalid", "frames-invalid", "encode frameCount must be an integer >= 1", {
      frameCount,
    });
  }
}

/** The geometry/frame-count read off one source shape. */
function geometryOf(source: FrameEncodeRequest["source"]): {
  width: number;
  height: number;
  frameCount: number;
} {
  return source.kind === "rgb24-file"
    ? { width: source.width, height: source.height, frameCount: source.frameCount }
    : { width: source.width, height: source.height, frameCount: source.frames.length };
}

/** The result of admitting a frame source (a staged file this encode owns or not). */
interface AdmittedSource {
  stagedPath: string;
  stagingDir: string | null;
  frameCount: number;
}

/** Admits the frame SOURCE (fail-closed: the byte lengths must be exact). */
function admitSource(
  source: FrameEncodeRequest["source"],
  width: number,
  height: number,
): AdmittedSource {
  const frameBytes = width * height * 3;
  if (source.kind === "rgb24-file") {
    if (!existsSync(source.path)) {
      throw new EncodingError("media-invalid", "frames-invalid", "the staged frame file does not exist", {
        path: source.path,
      });
    }
    const size = statSync(source.path).size;
    if (size !== source.frameCount * frameBytes) {
      throw new EncodingError(
        "media-invalid",
        "frames-invalid",
        `the staged frame file's size must be exactly frameCount × width × height × 3 = ${source.frameCount * frameBytes} bytes (got ${size})`,
        { path: source.path, expectedBytes: source.frameCount * frameBytes, actualBytes: size },
      );
    }
    return { stagedPath: source.path, stagingDir: null, frameCount: source.frameCount };
  }
  for (let i = 0; i < source.frames.length; i += 1) {
    const frame = source.frames[i];
    if (!(frame instanceof Uint8Array) || frame.length !== frameBytes) {
      throw new EncodingError(
        "media-invalid",
        "frames-invalid",
        `frames[${i}] must be a Uint8Array of exactly width × height × 3 = ${frameBytes} bytes (got ${frame?.length ?? "not a Uint8Array"})`,
        { index: i, expectedBytes: frameBytes, actualBytes: frame?.length ?? -1 },
      );
    }
  }
  // Stage the in-memory frames to the adapter's OWN temp dir (the renderer
  // staging convention: ffmpeg reads raw frames from a file).
  const stagingDir = mkdtempSync(join(tmpdir(), "sporta-encoding-"));
  const stagedPath = join(stagingDir, "frames.rgb24");
  try {
    writeFileSync(stagedPath, Buffer.concat(source.frames.map((frame) => Buffer.from(frame))));
  } catch (cause) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw new EncodingError("internal", "encode-failed", "staging the in-memory frames failed", {
      cause: String(cause),
    });
  }
  return { stagedPath, stagingDir, frameCount: source.frames.length };
}

/** The availability probe result (the typed skip guard for tests). */
export interface FfmpegEncoderAvailability {
  available: boolean;
  /** The first line of `ffmpeg -version` when available. */
  version?: string;
  /** Why the adapter is unavailable. */
  reason?: string;
  /** True when the libx264 encoder is compiled in. */
  hasLibx264?: boolean;
}

/** The probe subprocess bound (a probe must never hang the adapter). */
const PROBE_TIMEOUT_MS = 10_000;

/** Probes ffmpeg availability + the libx264 encoder (never throws; bounded). */
export function probeFfmpegEncoder(ffmpegPath = "ffmpeg"): FfmpegEncoderAvailability {
  const resolved = Bun.which(ffmpegPath) ?? ffmpegPath;
  const version = spawnSync(resolved, ["-version"], {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER_BYTES,
    timeout: PROBE_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  if (version.error !== undefined || version.status !== 0) {
    return { available: false, reason: `ffmpeg -version failed: ${String(version.error?.message ?? version.status)}` };
  }
  const banner = (version.stdout.split("\n", 1)[0] ?? "").trim();
  const encoders = spawnSync(resolved, ["-hide_banner", "-encoders"], {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER_BYTES,
    timeout: PROBE_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const hasLibx264 = typeof encoders.stdout === "string" && /libx264\b/.test(encoders.stdout);
  if (!hasLibx264) {
    return { available: false, version: banner, reason: "this ffmpeg build has no libx264 encoder" };
  }
  return { available: true, version: banner, hasLibx264: true };
}

/** Options for {@link FfmpegFrameEncoder}. */
export interface FfmpegFrameEncoderOptions {
  /** The ffmpeg binary (default "ffmpeg"; override for tests). */
  ffmpegPath?: string;
  /** The subprocess timeout in ms (default 60 000 — a bound, never a hang). */
  timeoutMs?: number;
}

/**
 * THE real ffmpeg/libx264 implementation of `FrameEncoderPort`.
 * Synchronous by design (the W501 conformance harness / tactical codec
 * precedent); every spawn bounded (`maxBuffer` + `timeout` + SIGKILL).
 */
export class FfmpegFrameEncoder implements FrameEncoderPort {
  readonly kind = FFMPEG_ENCODER_KIND;
  private readonly ffmpegPath: string;
  private readonly timeoutMs: number;
  private probedVersion: string | null = null;
  private probedAvailable = false;
  private probed = false;

  constructor(options: FfmpegFrameEncoderOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_ENCODE_TIMEOUT_MS;
  }

  available(): boolean {
    this.probe();
    return this.probedAvailable;
  }

  version(): string | null {
    this.probe();
    return this.probedVersion;
  }

  encode(request: FrameEncodeRequest): FrameEncodeResult {
    if (!this.available()) {
      throw new EncodingError("resource-limit", "encoder-unavailable", "the ffmpeg/libx264 encoder is unavailable", {
        ffmpegPath: this.ffmpegPath,
      });
    }
    const { width, height, frameCount } = geometryOf(request.source);
    const fps = request.fps;
    admitGeometry(width, height, fps, frameCount);
    const { stagedPath, stagingDir, frameCount: admittedFrames } = admitSource(request.source, width, height);

    // The MP4 muxer needs a seekable output (a pipe cannot carry a classic
    // mp4), so the encode targets a file in the adapter's OWN staging dir —
    // never a directory this adapter does not own — and the bytes are read
    // back: the returned bytes ARE the artifact.
    const outputDir = mkdtempSync(join(tmpdir(), "sporta-encoding-out-"));
    const outputPath = join(outputDir, "artifact.mp4");
    try {
      const run = spawnSync(
        this.ffmpegPath,
        ffmpegArgs({ rawFrameSequencePath: stagedPath, width, height, fps, outputPath }),
        {
          encoding: "buffer",
          maxBuffer: MAX_BUFFER_BYTES,
          timeout: this.timeoutMs,
          killSignal: "SIGKILL",
        },
      );
      if (run.error !== undefined) {
        // Node's spawnSync contract: an error means the operation failed —
        // for a timeout this is the BOUND firing (Bun reports ETIMEDOUT;
        // the child was killed at the bound and reaped by the synchronous
        // contract — no zombie possible; the signal is recorded when the
        // runtime reports it).
        const timedOut = /ETIMEDOUT/.test(run.error.message);
        throw new EncodingError(
          "internal",
          "encode-failed",
          timedOut
            ? `ffmpeg exceeded its ${this.timeoutMs} ms bound — no artifact was produced`
            : `ffmpeg spawn failed: ${run.error.message}`,
          {
            ffmpegPath: this.ffmpegPath,
            timeoutMs: this.timeoutMs,
            ...(run.signal === null || run.signal === undefined
              ? {}
              : { signal: String(run.signal) }),
            cause: String(run.error),
          },
        );
      }
      if (run.signal !== null && run.signal !== undefined) {
        // Killed by signal without a spawn error: the bound (or an external
        // kill) — surfaced honestly with the signal.
        throw new EncodingError(
          "internal",
          "encode-failed",
          `ffmpeg was killed by signal ${String(run.signal)} (bound: timeout ${this.timeoutMs} ms) — no artifact was produced`,
          { ffmpegPath: this.ffmpegPath, signal: String(run.signal), timeoutMs: this.timeoutMs },
        );
      }
      if (run.status !== 0) {
        throw new EncodingError(
          "internal",
          "encode-failed",
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
        throw new EncodingError(
          "internal",
          "encode-failed",
          "ffmpeg reported success but produced no output file — no artifact was produced",
          { ffmpegPath: this.ffmpegPath, outputPath, cause: String(cause) },
        );
      }
      if (bytes.length === 0) {
        throw new EncodingError("internal", "encode-failed", "ffmpeg produced no MP4 bytes — no artifact was produced", {
          ffmpegPath: this.ffmpegPath,
        });
      }
      const contentHash = sha256Of(bytes);
      const durationMs = Math.round((admittedFrames * 1_000) / fps);
      return {
        bytes,
        byteSize: bytes.length,
        contentHash,
        frameCount: admittedFrames,
        width,
        height,
        fps,
        durationMs,
        encoderKind: this.kind,
        encoderVersion: this.version(),
        codec: { ...REAL_ENCODE_CODEC_PARAMS },
      };
    } finally {
      if (stagingDir !== null) {
        rmSync(stagingDir, { recursive: true, force: true });
      }
      rmSync(outputDir, { recursive: true, force: true });
    }
  }

  /** Probes the binary once (`ffmpeg -version` + `-encoders`), caching the result. */
  private probe(): void {
    if (this.probed) return;
    this.probed = true;
    const availability = probeFfmpegEncoder(this.ffmpegPath);
    this.probedAvailable = availability.available;
    this.probedVersion = availability.available ? (availability.version ?? "unknown") : null;
  }
}

/**
 * Creates the real ffmpeg/libx264 encoder, or `null` when unavailable (the
 * caller decides how to fail — the tactical codec convention).
 */
export function createFfmpegFrameEncoder(
  options: FfmpegFrameEncoderOptions = {},
): FfmpegFrameEncoder | null {
  const encoder = new FfmpegFrameEncoder(options);
  return encoder.available() ? encoder : null;
}
