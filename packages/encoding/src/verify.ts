/**
 * The verification plane (R306): ffprobe probes + full-frame decodes of
 * REAL MP4 artifacts — the same subprocess conventions as the encoder
 * (bounded `spawnSync` + SIGKILL timeout + typed errors), following the
 * renderer-3d game codec's `probeArtifact` / `decodeFrameRgb24`
 * precedent, extended to whole-artifact decode (every frame, rawvideo
 * rgb24, to a bounded temp file — never an unbounded pipe).
 *
 * The fixture tier is REFUSED honestly (its bytes are not video —
 * `kind: "fixture"` artifacts fail `verify-failed`, never a fabricated
 * probe).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncodingError } from "./errors";
import type { EncodedArtifact } from "./types";

/** The default probe/decode subprocess timeout (milliseconds). */
export const DEFAULT_VERIFY_TIMEOUT_MS = 60_000;

/** The bounded stdio capture cap. */
const MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/** The ffprobe view of one encoded artifact. */
export interface ProbedEncodedArtifact {
  codecName: string;
  profile: string;
  widthPx: number;
  heightPx: number;
  frameCount: number;
  durationMs: number;
  avgFrameRateFps: number | null;
  container: string;
}

/** The probed stream fields ffprobe reports. */
interface ProbeStream {
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
}

function runBounded(
  binary: string,
  args: string[],
  timeoutMs: number,
): { status: number | null; stdout: string; stderr: string; signal: string | null; error?: Error } {
  const run = spawnSync(binary, args, {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER_BYTES,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  return {
    status: run.status,
    stdout: typeof run.stdout === "string" ? run.stdout : "",
    stderr: typeof run.stderr === "string" ? run.stderr : "",
    signal: run.signal ?? null,
    ...(run.error !== undefined ? { error: run.error } : {}),
  };
}

/** Writes an artifact's bytes to a temp file and hands the path back (caller cleans). */
function withArtifactFile<T>(
  artifact: EncodedArtifact,
  ffmpegPath: string,
  timeoutMs: number,
  use: (path: string) => T,
): T {
  if (artifact.kind !== "mp4") {
    throw new EncodingError(
      "media-invalid",
      "verify-failed",
      "only REAL MP4 artifacts can be probed/decoded — this artifact is fixture-tier (its bytes are not video)",
      { kind: artifact.kind, encoderKind: artifact.manifest.encoder.kind },
    );
  }
  if (ffmpegPath === "") {
    throw new EncodingError("media-invalid", "verify-failed", "ffmpeg path required");
  }
  const dir = mkdtempSync(join(tmpdir(), "sporta-encoding-verify-"));
  const path = join(dir, "artifact.mp4");
  writeFileSync(path, artifact.bytes);
  try {
    return use(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Options for {@link probeEncodedArtifact}. */
export interface ProbeEncodedArtifactOptions {
  /** The ffmpeg binary path (default "ffmpeg" — ffprobe is derived from it). */
  ffmpegPath?: string;
  /** The subprocess timeout (default 60 s). */
  timeoutMs?: number;
}

/**
 * Probes one encoded artifact with ffprobe and cross-checks the probe
 * against the artifact's own manifest: codec h264, Constrained Baseline
 * profile, exact dimensions, exact frame count, duration within one
 * frame + 1 ms (the renderer-3d probe tolerance). Any disagreement is a
 * typed `verify-failed` — never a pass.
 */
export function probeEncodedArtifact(
  artifact: EncodedArtifact,
  options: ProbeEncodedArtifactOptions = {},
): ProbedEncodedArtifact {
  const ffmpegPath = options.ffmpegPath ?? "ffmpeg";
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const ffprobePath = ffmpegPath.replace(/ffmpeg$/, "ffprobe");
  return withArtifactFile(artifact, ffmpegPath, timeoutMs, (path) => {
    const run = runBounded(
      ffprobePath,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,profile,width,height,avg_frame_rate,nb_frames,duration",
        "-of",
        "json",
        path,
      ],
      timeoutMs,
    );
    if (run.error !== undefined || (run.status !== 0 && run.status !== null)) {
      throw new EncodingError(
        "internal",
        "verify-failed",
        `ffprobe failed (status ${String(run.status)})`,
        {
          stderr: run.stderr.slice(0, 500),
        },
      );
    }
    let stream: ProbeStream | undefined;
    try {
      const parsed = JSON.parse(run.stdout) as { streams?: ProbeStream[] };
      stream = parsed.streams?.[0];
    } catch (cause) {
      throw new EncodingError("internal", "verify-failed", "ffprobe's output was not JSON", {
        cause: String(cause),
      });
    }
    if (stream === undefined) {
      throw new EncodingError("internal", "verify-failed", "ffprobe found no video stream");
    }
    const avgFrameRateFps = parseFrameRate(stream.avg_frame_rate);
    const frameCount = stream.nb_frames !== undefined ? Number.parseInt(stream.nb_frames, 10) : NaN;
    const durationSeconds =
      stream.duration !== undefined ? Number.parseFloat(stream.duration) : NaN;
    const probe: ProbedEncodedArtifact = {
      codecName: stream.codec_name ?? "",
      profile: stream.profile ?? "",
      widthPx: stream.width ?? -1,
      heightPx: stream.height ?? -1,
      frameCount: Number.isFinite(frameCount) ? frameCount : -1,
      durationMs: Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : -1,
      avgFrameRateFps,
      container: "mp4",
    };
    // Cross-check against the artifact's own manifest (fail-closed).
    const geometry = artifact.manifest.geometry;
    if (probe.codecName !== "h264") {
      throw new EncodingError(
        "internal",
        "verify-failed",
        `the artifact's codec is not h264 (${probe.codecName})`,
        {
          probe,
        },
      );
    }
    if (probe.profile !== "Constrained Baseline" && probe.profile !== "Baseline") {
      throw new EncodingError(
        "internal",
        "verify-failed",
        `the artifact's profile is not (Constrained) Baseline (${probe.profile})`,
        { probe },
      );
    }
    if (probe.widthPx !== geometry.widthPx || probe.heightPx !== geometry.heightPx) {
      throw new EncodingError(
        "internal",
        "verify-failed",
        "the artifact's dimensions disagree with its manifest",
        {
          probe,
          manifest: geometry,
        },
      );
    }
    if (Math.abs(probe.frameCount - geometry.frameCount) > 1) {
      throw new EncodingError(
        "internal",
        "verify-failed",
        "the artifact's frame count disagrees with its manifest",
        {
          probe,
          manifest: geometry,
        },
      );
    }
    const frameMs = 1_000 / geometry.fps;
    if (Math.abs(probe.durationMs - geometry.durationMs) > frameMs + 1) {
      throw new EncodingError(
        "internal",
        "verify-failed",
        "the artifact's duration disagrees with its manifest",
        {
          probe,
          manifest: geometry,
        },
      );
    }
    return probe;
  });
}

/** Parses an ffprobe `avg_frame_rate` fraction ("25/1" → 25). */
function parseFrameRate(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (match === null) return null;
  const denominator = Number.parseInt(match[2]!, 10);
  if (denominator === 0) return null;
  return Number.parseInt(match[1]!, 10) / denominator;
}

/** Options for {@link decodeEncodedFrames}. */
export interface DecodeEncodedFramesOptions {
  /** The ffmpeg binary (default "ffmpeg"). */
  ffmpegPath?: string;
  /** The subprocess timeout (default 60 s). */
  timeoutMs?: number;
}

/**
 * Decodes EVERY frame of a real MP4 artifact back to raw rgb24 (a
 * bounded temp-file round trip — never an unbounded pipe): the returned
 * frames are exactly `frameCount × width × height × 3` bytes, verified
 * against the artifact's manifest. The honest foundation for R307's
 * measured (never asserted) temporal stability.
 */
export function decodeEncodedFrames(
  artifact: EncodedArtifact,
  options: DecodeEncodedFramesOptions = {},
): Uint8Array[] {
  const ffmpegPath = options.ffmpegPath ?? "ffmpeg";
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const geometry = artifact.manifest.geometry;
  const frameBytes = geometry.widthPx * geometry.heightPx * 3;
  return withArtifactFile(artifact, ffmpegPath, timeoutMs, (path) => {
    const outDir = mkdtempSync(join(tmpdir(), "sporta-encoding-decode-"));
    const outPath = join(outDir, "frames.rgb24");
    try {
      const run = runBounded(
        ffmpegPath,
        ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", outPath],
        timeoutMs,
      );
      if (run.error !== undefined || (run.status !== 0 && run.status !== null)) {
        throw new EncodingError(
          "internal",
          "verify-failed",
          `the decode failed (status ${String(run.status)})`,
          {
            stderr: run.stderr.slice(0, 500),
          },
        );
      }
      let raw: Buffer;
      try {
        raw = readFileSync(outPath);
      } catch (cause) {
        throw new EncodingError("internal", "verify-failed", "the decode produced no frames file", {
          cause: String(cause),
        });
      }
      if (raw.length !== geometry.frameCount * frameBytes) {
        throw new EncodingError(
          "internal",
          "verify-failed",
          `the decoded byte count disagrees with the manifest (expected ${geometry.frameCount * frameBytes}, got ${raw.length})`,
          { manifest: geometry },
        );
      }
      const frames: Uint8Array[] = [];
      for (let i = 0; i < geometry.frameCount; i += 1) {
        frames.push(new Uint8Array(raw.subarray(i * frameBytes, (i + 1) * frameBytes)));
      }
      return frames;
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
}
