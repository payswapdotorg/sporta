/**
 * THE typed ffmpeg codec wrapper of the R303/R304 renderers — the ONLY
 * place the renderers touch a media toolchain. Following the repo's codec
 * precedent (`@sporta/decoding`'s ffmpeg adapter): ffmpeg/ffprobe are used
 * ONLY as SUBPROCESSES (never an npm dependency — architecture-lock §9
 * vendor neutrality; zero new package dependencies).
 *
 * This module is SYNCHRONOUS by design (`Bun.spawnSync`): the W501
 * conformance harness is synchronous, so the whole plugin render path
 * (engine raster → encode → verify) runs synchronously end to end. Every
 * spawn is bounded (input from a staged file, output to a file — no
 * unbounded pipes).
 *
 * ## Determinism (the documented flag set — verified empirically, pinned
 * by tests: same staged frames → byte-identical MP4, two runs, sha-256):
 *
 * ```text
 * ffmpeg -nostdin -y -v error
 *   -f rawvideo -pix_fmt rgb24 -s <WxH> -r <fps> -i <staged-frames>
 *   -an -c:v libx264 -preset veryfast -profile:v baseline -level 3.0
 *   -crf 23 -pix_fmt yuv420p -threads 1
 *   -fflags +bitexact -flags:v +bitexact
 *   -map_metadata -1 -metadata encoder=
 *   <out.mp4>
 * ```
 *
 * - `-threads 1` pins the x264 thread count (the one knob that changes
 *   output between machines/runs of the same build);
 * - `-fflags/-flags:v +bitexact` suppress muxer/codec version markers;
 * - `-map_metadata -1 -metadata encoder=` strips container metadata;
 * - NOTE (documented honestly): ffmpeg 7.x REMOVED `-movflags +bitexact`
 *   from the mp4 muxer (it errors; the option list no longer carries it),
 *   and the x264 bitstream still embeds the core-version SEI, which is
 *   constant for a given build but varies across builds — byte-determinism
 *   is therefore PER BUILD, and the tests prove it empirically per run.
 *
 * The profile (h264 Constrained Baseline + yuv420p, 25 fps, mp4) is the
 * HTML5 `<video>`-safe combination the acceptance contract §D requires.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

/** The typed failure of the codec wrapper (never a raw spawn error). */
export class CodecError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CodecError";
  }
}

/** The availability probe result (tests use it for typed skip guards). */
export interface CodecAvailability {
  available: boolean;
  /** The first line of `ffmpeg -version` when available. */
  version?: string;
  /** Why the codec is unavailable (binary missing / spawn failure). */
  reason?: string;
  /** True when the libx264 encoder is compiled in. */
  hasLibx264?: boolean;
}

/** Probes ffmpeg availability + the libx264 encoder (never throws). */
export function probeCodec(): CodecAvailability {
  const ffmpegPath = Bun.which("ffmpeg");
  if (ffmpegPath === null) {
    return { available: false, reason: "ffmpeg binary not found on PATH" };
  }
  const version = spawnSync(ffmpegPath, ["-version"], { encoding: "utf8" });
  if (version.status !== 0 || typeof version.stdout !== "string") {
    return {
      available: false,
      reason: `ffmpeg -version exited with ${String(version.status)}`,
    };
  }
  const banner = version.stdout.split("\n", 1)[0] ?? "";
  const encoders = spawnSync(ffmpegPath, ["-hide_banner", "-encoders"], { encoding: "utf8" });
  const hasLibx264 = typeof encoders.stdout === "string" && /libx264\b/.test(encoders.stdout);
  if (!hasLibx264) {
    return {
      available: false,
      version: banner.trim(),
      reason: "this ffmpeg build has no libx264 encoder",
    };
  }
  return { available: true, version: banner.trim(), hasLibx264: true };
}

/** The encode request (staged rgb24 frames → one MP4 file). */
export interface EncodeFramesRequest {
  /** The staged frame-sequence file (the engine's `stagingRef`). */
  stagingRef: string;
  widthPx: number;
  heightPx: number;
  fps: number;
  frameCount: number;
  /** The MP4 output path (written atomically? no — direct write, caller owns the path). */
  outputPath: string;
}

/** The encode result (the produced file's geometry, echoed honestly). */
export interface EncodeFramesResult {
  outputPath: string;
  byteSize: number;
  frameCount: number;
}

/**
 * Encodes one staged rgb24 frame sequence into an MP4 (h264 Constrained
 * Baseline, yuv420p). Synchronous, deterministic (see the module docs).
 * Throws {@link CodecError} on any nonzero exit or size mismatch.
 */
export function encodeFramesToMp4(request: EncodeFramesRequest): EncodeFramesResult {
  const { stagingRef, widthPx, heightPx, fps, frameCount, outputPath } = request;
  if (frameCount < 1) {
    throw new CodecError("encodeFramesToMp4: frameCount must be >= 1", { frameCount });
  }
  const ffmpegPath = Bun.which("ffmpeg");
  if (ffmpegPath === null) {
    throw new CodecError("encodeFramesToMp4: ffmpeg binary not found on PATH");
  }
  const args = [
    "-nostdin",
    "-y",
    "-v",
    "error",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${widthPx}x${heightPx}`,
    "-r",
    String(fps),
    "-i",
    stagingRef,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "baseline",
    "-level",
    "3.0",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "1",
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
    "-map_metadata",
    "-1",
    "-metadata",
    "encoder=",
    outputPath,
  ];
  const run = spawnSync(ffmpegPath, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (run.status !== 0) {
    throw new CodecError(
      `encodeFramesToMp4: ffmpeg exited with ${String(run.status)} while encoding ${frameCount} frames`,
      {
        exitCode: run.status,
        stderrTail: (run.stderr ?? "").slice(-2000),
        args: args.join(" "),
      },
    );
  }
  const size = fileSizeOf(outputPath);
  if (size <= 0) {
    throw new CodecError("encodeFramesToMp4: ffmpeg wrote an empty file", { outputPath });
  }
  return { outputPath, byteSize: size, frameCount };
}

/** The ffprobe view of one encoded artifact (the validated subset). */
export interface ProbedArtifact {
  codecName: string;
  profile: string;
  widthPx: number;
  heightPx: number;
  frameCount: number;
  durationMs: number;
  avgFrameRateFps: number | null;
  container: string;
}

/**
 * Probes one MP4 with ffprobe and validates it against the expected
 * geometry: h264, exact dimensions, frame count (±1 for muxer rounding),
 * duration within ±1 frame. Throws {@link CodecError} on any mismatch —
 * an artifact that does not probe is NEVER claimed playable.
 */
export function probeArtifact(options: {
  path: string;
  widthPx: number;
  heightPx: number;
  frameCount: number;
  fps: number;
}): ProbedArtifact {
  const { path, widthPx, heightPx, frameCount, fps } = options;
  const ffprobePath = Bun.which("ffprobe");
  if (ffprobePath === null) {
    throw new CodecError("probeArtifact: ffprobe binary not found on PATH");
  }
  const run = spawnSync(
    ffprobePath,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (run.status !== 0 || typeof run.stdout !== "string") {
    throw new CodecError(`probeArtifact: ffprobe exited with ${String(run.status)} on "${path}"`, {
      stderrTail: (run.stderr ?? "").slice(-2000),
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout);
  } catch (cause) {
    throw new CodecError("probeArtifact: ffprobe output was not parseable JSON", {
      cause: (cause as Error).message,
    });
  }
  const probe = parseFfprobeJson(parsed);
  if (probe.codecName !== "h264") {
    throw new CodecError(
      `probeArtifact: expected the video codec "h264", found "${probe.codecName}"`,
      { path },
    );
  }
  if (probe.widthPx !== widthPx || probe.heightPx !== heightPx) {
    throw new CodecError(
      `probeArtifact: expected ${widthPx}x${heightPx}, found ${probe.widthPx}x${probe.heightPx}`,
      { path },
    );
  }
  if (Math.abs(probe.frameCount - frameCount) > 1) {
    throw new CodecError(
      `probeArtifact: expected ~${frameCount} frames, found ${probe.frameCount}`,
      { path },
    );
  }
  const expectedDurationMs = (frameCount / fps) * 1000;
  if (Math.abs(probe.durationMs - expectedDurationMs) > 1000 / fps + 1) {
    throw new CodecError(
      `probeArtifact: expected ~${Math.round(expectedDurationMs)} ms, found ${Math.round(probe.durationMs)} ms`,
      { path },
    );
  }
  return probe;
}

/** The raw decoder request (one frame of an MP4 → rgb24 bytes). */
export interface DecodeFrameRequest {
  path: string;
  frameIndex: number;
  widthPx: number;
  heightPx: number;
}

/**
 * Decodes ONE frame of an MP4 into raw rgb24 bytes (the pixel-statistics
 * path the ADR-009 difference test uses — real decoded output pixels,
 * never fabricated statistics). Synchronous via a temp output file.
 */
export function decodeFrameRgb24(request: DecodeFrameRequest): Uint8Array {
  const { path, frameIndex, widthPx, heightPx } = request;
  const ffmpegPath = Bun.which("ffmpeg");
  if (ffmpegPath === null) {
    throw new CodecError("decodeFrameRgb24: ffmpeg binary not found on PATH");
  }
  const outFile = `${path}.frame-${frameIndex}.rgb24`;
  const run = spawnSync(
    ffmpegPath,
    [
      "-nostdin",
      "-y",
      "-v",
      "error",
      "-i",
      path,
      "-vf",
      `select=eq(n\\,${frameIndex})`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      outFile,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (run.status !== 0) {
    throw new CodecError(
      `decodeFrameRgb24: ffmpeg exited with ${String(run.status)} decoding frame ${frameIndex}`,
      { stderrTail: (run.stderr ?? "").slice(-2000) },
    );
  }
  const expectedBytes = widthPx * heightPx * 3;
  const bytes = readFileSyncBytes(outFile);
  if (bytes.length !== expectedBytes) {
    throw new CodecError(
      `decodeFrameRgb24: expected ${expectedBytes} bytes for one ${widthPx}x${heightPx} rgb24 frame, found ${bytes.length}`,
    );
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The ffprobe JSON subset this wrapper understands (fail-closed parse). */
interface FfprobeJson {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    profile?: string;
    width?: number;
    height?: number;
    nb_frames?: string;
    avg_frame_rate?: string;
    duration?: string;
  }>;
  format?: {
    format_name?: string;
    duration?: string;
  };
}

/** Parses the first video stream + container of an ffprobe JSON payload. */
function parseFfprobeJson(value: unknown): ProbedArtifact {
  if (typeof value !== "object" || value === null) {
    throw new CodecError("parseFfprobeJson: payload is not an object");
  }
  const payload = value as FfprobeJson;
  const stream = (payload.streams ?? []).find((s) => s.codec_type === "video");
  if (stream === undefined) {
    throw new CodecError("parseFfprobeJson: no video stream in the probe payload");
  }
  const rational = parseRational(stream.avg_frame_rate);
  const durationSeconds = Number.parseFloat(stream.duration ?? payload.format?.duration ?? "0");
  const frameCount = Number.parseInt(stream.nb_frames ?? "0", 10);
  if (
    typeof stream.width !== "number" ||
    typeof stream.height !== "number" ||
    !Number.isFinite(durationSeconds)
  ) {
    throw new CodecError("parseFfprobeJson: video stream is missing geometry/duration", {
      stream,
    });
  }
  return {
    codecName: stream.codec_name ?? "unknown",
    profile: stream.profile ?? "unknown",
    widthPx: stream.width,
    heightPx: stream.height,
    frameCount: Number.isFinite(frameCount) ? frameCount : 0,
    durationMs: Math.round(durationSeconds * 1000),
    avgFrameRateFps: rational,
    container: payload.format?.format_name ?? "unknown",
  };
}

/** Parses an ffprobe rational (`"25/1"`, `"30000/1001"`) or null. */
function parseRational(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (match !== null) {
    const denominator = Number.parseInt(match[2]!, 10);
    if (denominator > 0) return Number.parseInt(match[1]!, 10) / denominator;
    return null;
  }
  const single = Number.parseFloat(value);
  return Number.isFinite(single) && single > 0 ? single : null;
}

function fileSizeOf(path: string): number {
  return statSync(path).size;
}

function readFileSyncBytes(path: string): Uint8Array {
  // node:fs readFileSync returns a Buffer (a Uint8Array subclass) — the
  // synchronous byte read the codec path needs.
  return readFileSync(path);
}
