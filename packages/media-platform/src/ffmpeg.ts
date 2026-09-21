/**
 * The ffmpeg/ffprobe TYPED WRAPPER (R102) — the real normalization tool.
 *
 * ffmpeg is used ONLY as a subprocess via `Bun.spawn` (never an npm
 * package — the repo's vendor-neutrality rule, exactly the
 * `@sporta/decoding` `FfmpegDecoderAdapter` precedent). This module is
 * MECHANICAL by design: all policy (duration bounds, size bounds, rights)
 * lives in the services that call it.
 *
 * Honesty rules:
 *
 * - {@link FfmpegTool.detect} probes availability ONCE (an `ffmpeg
 *   -version` run within a bounded timeout); an absent/unusable ffmpeg
 *   makes every operation throw the typed `FfmpegUnavailableError` — this
 *   platform NEVER fakes a normalization;
 * - `probe` measures duration/streams/dimensions/frame-rate from the ACTUAL
 *   media (ffprobe JSON), never from any caller-declared metadata;
 * - `transcodeToNormalizedMp4` produces the canonical encoding (H.264
 *   yuv420p video + AAC 48 kHz stereo audio when a source audio track
 *   exists, `+faststart` MP4 so HTML5 `<video>` can stream it) and returns
 *   the OUTPUT's measured probe — the caller builds the `MediaManifest`
 *   from what was PRODUCED, not from what was requested.
 */
import { MediaInvalidError } from "./errors";
import { FfmpegUnavailableError } from "./errors";

/** Options for {@link FfmpegTool}; paths default to a `Bun.which` lookup. */
export interface FfmpegToolOptions {
  /** Path to the ffmpeg binary (default: `Bun.which("ffmpeg")`). */
  ffmpegPath?: string;
  /** Path to the ffprobe binary (default: `Bun.which("ffprobe")`). */
  ffprobePath?: string;
  /** Subprocess timeout in ms (default: 120_000 — the 120s duration bound's scale). */
  timeoutMs?: number;
}

/** ffprobe JSON stream entry (only the fields this wrapper reads). */
export interface FfprobeStreamJson {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  nb_frames?: string;
  duration?: number | string;
  bit_rate?: string;
  channels?: number;
  sample_rate?: string;
  sample_rate_hz?: number;
}

/** ffprobe JSON document (only the fields this wrapper reads). */
export interface FfprobeJson {
  streams?: FfprobeStreamJson[];
  format?: { duration?: number | string; format_name?: string };
}

/** A measured media probe (all fields derived from ffprobe output). */
export interface MediaProbe {
  /** Container duration in ms (rounded; > 0 enforced by callers). */
  durationMs: number;
  /** Video streams (>= 1 for a valid upload). */
  videoStreams: FfprobeStreamJson[];
  /** Audio streams (may be empty — audio is optional). */
  audioStreams: FfprobeStreamJson[];
  /** The primary (first) video stream's measured average frame rate (fps). */
  frameRateFps: number;
  /** The primary video stream's measured frame count (>= 1). */
  frameCount: number;
  /** The raw ffprobe document (bounded evidence for error paths). */
  raw: FfprobeJson;
}

/** A completed subprocess run (both pipes drained). */
interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** The ffmpeg/ffprobe subprocess wrapper. */
export class FfmpegTool {
  /** The resolved ffmpeg binary path (tests and operators may inspect it). */
  readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly timeoutMs: number;
  private availability: Promise<boolean> | undefined;

  constructor(options: FfmpegToolOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? Bun.which("ffmpeg") ?? "ffmpeg";
    this.ffprobePath = options.ffprobePath ?? Bun.which("ffprobe") ?? "ffprobe";
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  /**
   * Probes whether the ffmpeg binary is usable (`ffmpeg -version` exits 0
   * within the timeout). Cached per tool instance.
   */
  available(): Promise<boolean> {
    this.availability ??= (async () => {
      try {
        const result = await this.run([this.ffmpegPath, "-version"]);
        return result.exitCode === 0;
      } catch {
        return false;
      }
    })();
    return this.availability;
  }

  /** Fails loud when ffmpeg is not usable (the R102 honesty rule). */
  private async assertAvailable(): Promise<void> {
    if (!(await this.available())) {
      throw new FfmpegUnavailableError(
        `ffmpeg is not available at '${this.ffmpegPath}' — media normalization cannot run (and is never faked)`,
        { ffmpegPath: this.ffmpegPath },
      );
    }
  }

  /** Runs one subprocess to completion with both pipes drained. */
  private async run(argv: readonly string[]): Promise<SpawnResult> {
    const proc = Bun.spawn([...argv], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), this.timeoutMs);
    try {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Probes one media file: duration, stream inventory, the primary video
   * stream's measured frame rate and frame count. All values are MEASURED
   * (ffprobe `-show_format -show_streams` JSON); a nonzero exit or
   * unparseable output is the typed `MediaInvalidError` with bounded stderr.
   */
  async probe(filePath: string): Promise<MediaProbe> {
    await this.assertAvailable();
    const result = await this.run([
      this.ffprobePath,
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    if (result.exitCode !== 0) {
      throw new MediaInvalidError(`ffprobe could not read the media`, {
        filePath,
        stderrTail: stderrTailOf(result.stderr),
      });
    }
    let json: FfprobeJson;
    try {
      json = JSON.parse(result.stdout) as FfprobeJson;
    } catch (err) {
      throw new MediaInvalidError("ffprobe emitted unparseable output", {
        filePath,
        parseError: err instanceof Error ? err.message : String(err),
      });
    }
    const streams = json.streams ?? [];
    const videoStreams = streams.filter((stream) => stream.codec_type === "video");
    const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
    if (videoStreams.length === 0) {
      throw new MediaInvalidError("the media carries no video stream", {
        filePath,
        streamCount: streams.length,
      });
    }
    const primary = videoStreams[0]!;
    const durationMs = durationMsOf(json, primary);
    if (!(durationMs > 0)) {
      throw new MediaInvalidError("the media reports no positive duration", {
        filePath,
        formatDuration: json.format?.duration,
        streamDuration: primary.duration,
      });
    }
    const frameRateFps = frameRateOf(primary);
    if (!(frameRateFps > 0)) {
      throw new MediaInvalidError("the primary video stream reports no usable frame rate", {
        filePath,
        avgFrameRate: primary.avg_frame_rate,
        rFrameRate: primary.r_frame_rate,
      });
    }
    const frameCount = frameCountOf(primary, durationMs, frameRateFps);
    if (!(frameCount >= 1)) {
      throw new MediaInvalidError("the primary video stream reports no positive frame count", {
        filePath,
        nbFrames: primary.nb_frames,
        durationMs,
        frameRateFps,
      });
    }
    return {
      durationMs,
      videoStreams,
      audioStreams,
      frameRateFps,
      frameCount,
      raw: json,
    };
  }

  /**
   * Transcodes one media file to the canonical normalized MP4:
   *
   * - video: H.264 (`libx264`), `yuv420p`, even dimensions (a 1px crop on
   *   odd-sized sources — `yuv420p` cannot encode odd dimensions), the
   *   source's frame rate preserved;
   * - audio: AAC, 48 kHz, stereo, when the source carries an audio track
   *   (a source without audio produces a video-only canonical file);
   * - container: MP4 with `+faststart` (the moov atom up front — the
   *   HTML5 `<video>` Range-streaming requirement).
   *
   * Returns the OUTPUT's measured {@link MediaProbe} — callers derive the
   * `MediaManifest` from the produced bytes, never from the request.
   */
  async transcodeToNormalizedMp4(inputPath: string, outputPath: string): Promise<MediaProbe> {
    await this.assertAvailable();
    const hasAudio = await this.hasAudioStream(inputPath);
    const argv = [
      this.ffmpegPath,
      "-v",
      "error",
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "crop=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:a",
      hasAudio ? "aac" : "an",
    ];
    if (hasAudio) {
      argv.push("-ar", "48000", "-ac", "2");
    }
    argv.push("-movflags", "+faststart", "-f", "mp4", outputPath);
    const result = await this.run(argv);
    if (result.exitCode !== 0) {
      throw new MediaInvalidError("ffmpeg could not normalize the media", {
        inputPath,
        stderrTail: stderrTailOf(result.stderr),
        exitCode: result.exitCode,
      });
    }
    return this.probe(outputPath);
  }

  /** Whether the file carries at least one audio stream (a quick probe). */
  private async hasAudioStream(filePath: string): Promise<boolean> {
    const result = await this.run([
      this.ffprobePath,
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  }
}

/** Bounded stderr tail (the repo-wide 2000-char convention). */
function stderrTailOf(stderr: string): string {
  return stderr.length > 2000 ? stderr.slice(-2000) : stderr;
}

/** Container/stream duration in ms (rounded), stream-preferred. */
function durationMsOf(json: FfprobeJson, primary: FfprobeStreamJson): number {
  const candidates = [primary.duration, json.format?.duration];
  for (const candidate of candidates) {
    const seconds = typeof candidate === "string" ? Number.parseFloat(candidate) : candidate;
    if (seconds !== undefined && Number.isFinite(seconds) && seconds > 0) {
      return Math.round(seconds * 1000);
    }
  }
  return 0;
}

/** A stream's measured average frame rate (fps), rational-aware. */
function frameRateOf(stream: FfprobeStreamJson): number {
  for (const candidate of [stream.avg_frame_rate, stream.r_frame_rate]) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    const [num, den] = candidate.split("/");
    const numerator = Number.parseFloat(num ?? "");
    const denominator = den === undefined ? 1 : Number.parseFloat(den);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
      const fps = numerator / denominator;
      if (fps > 0) return fps;
    }
  }
  return 0;
}

/** A stream's frame count: nb_frames, else duration x fps (rounded, >= 0). */
function frameCountOf(stream: FfprobeStreamJson, durationMs: number, frameRateFps: number): number {
  const declared = Number.parseInt(stream.nb_frames ?? "", 10);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return Math.max(0, Math.round((durationMs / 1000) * frameRateFps));
}

/**
 * A deterministic tiny-MP4 generator for tests and evidence runs —
 * real H.264 MP4 bytes produced by the real ffmpeg (never a committed
 * binary fixture; no license provenance beyond the ffmpeg binary itself).
 * Returns the output path.
 *
 * Scenes:
 * - `"bars"` (default): the legacy `lavfi testsrc` SMPTE color-bars
 *   pattern — real bytes, no committed fixture; the perception chain
 *   HONESTLY finds no players on it (uniform bars with thin edge lines:
 *   surface blocks dominate, aspect gates reject the lines).
 * - `"pitch"`: a uniform green field with three moving high-contrast
 *   player rectangles (distinct kit colors, disjoint sin-based motion
 *   lanes) — the scene the J012 contrast-context production path DETECTS
 *   (local-contrast outliers standing on a dominant surface, ring-context
 *   clean); used by the tests that assert real entity continuity. NOT
 *   calibratable: the uniform field carries no pitch markings, so
 *   positions stay image-frame (the honest J013 finding).
 * - `"pitch-marked"`: the pitch scene's players ON a marked pitch — a
 *   grass apron with the white line family (goal lines, halfway line,
 *   touchlines) painted INTERIOR to the green region, the geometry the
 *   line-based calibrator's documented envelope expects. The players
 *   detect (same contrast discipline) AND the calibration establishes
 *   the pitch frame (the lines are the correspondences), so tracked
 *   positions project to canonical pitch meters — the media the J013
 *   derived-reality sensitivity battery renders from.
 */
export async function generateTestMp4(
  outputPath: string,
  options: {
    durationSeconds?: number;
    withAudio?: boolean;
    width?: number;
    height?: number;
    frameRate?: number;
    /**
     * Visual scene:
     * - `"bars"` (default): the legacy `lavfi testsrc` SMPTE color-bars
     *   pattern;
     * - `"pitch"`: a uniform green field with three moving high-contrast
     *   players (detectable, NOT calibratable — no pitch markings);
     * - `"pitch-marked"`: the pitch scene PLUS the calibratable white line
     *   family (goal lines, halfway line, touchlines) painted INSIDE a
     *   grass apron — the J013 sensitivity media: players detect AND the
     *   line-based calibrator establishes the pitch frame, so positions
     *   project to canonical pitch meters.
     */
    scene?: "bars" | "pitch" | "pitch-marked";
  } = {},
): Promise<string> {
  const duration = options.durationSeconds ?? 2;
  const width = options.width ?? 320;
  const height = options.height ?? 240;
  const frameRate = options.frameRate ?? 24;
  const scene = options.scene ?? "bars";
  const tool = new FfmpegTool();
  if (!(await tool.available())) {
    throw new FfmpegUnavailableError(
      "cannot generate a test MP4 without ffmpeg (the in-test generator requires the real binary)",
    );
  }
  let argv: string[];
  if (scene === "pitch" || scene === "pitch-marked") {
    // Three moving kit-colored rectangles on a uniform green field. Player
    // size scales with the frame (14x34 at the 320x240 default); motion
    // lanes are disjoint in x so blobs never merge; every ring stays on
    // the surface (>= a block of green around each player, well inside
    // the frame edges).
    const playerW = Math.max(8, Math.round(width * 0.045));
    const playerH = Math.max(16, Math.round(height * 0.14));
    const kits = ["0xC62828", "0xF9A825", "0x212121"]; // dark red / amber / near-black
    argv = [tool.ffmpegPath, "-v", "error", "-y"];
    for (const kit of kits) {
      argv.push(
        "-f",
        "lavfi",
        "-i",
        `color=c=${kit}:s=${playerW}x${playerH}:r=${frameRate}:d=${duration}`,
      );
    }
    argv.push(
      "-f",
      "lavfi",
      "-i",
      `color=c=${scene === "pitch-marked" ? "0x1a1a2e" : "0x2E8B57"}:s=${width}x${height}:r=${frameRate}:d=${duration}`,
    );
    if (options.withAudio !== false) {
      argv.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${duration}`);
    }
    // Motion centers/amplitudes in frame fractions: p1 left-lane low,
    // p2 right-lane low, p3 mid-lane high — x-ranges disjoint.
    const lanes = [
      { cx: 0.2, ax: 0.08, cy: 0.45, ay: 0.15, fx: 1.5, fy: 0.9, px: 0, py: 0 },
      { cx: 0.65, ax: 0.08, cy: 0.55, ay: 0.12, fx: 1.1, fy: 1.3, px: 2, py: 1 },
      { cx: 0.45, ax: 0.1, cy: 0.3, ay: 0.1, fx: 0.8, fy: 1.7, px: 4, py: 3 },
    ];
    const px = (v: number) => Math.round(width * v);
    const py = (v: number) => Math.round(height * v);
    const overlayExpr = (lane: (typeof lanes)[number]) =>
      `x=${px(lane.cx)}+${px(lane.ax)}*sin(t*${lane.fx}+${lane.px}):` +
      `y=${py(lane.cy)}+${py(lane.ay)}*sin(t*${lane.fy}+${lane.py})`;
    // pitch-marked: the grass apron + the interior white line family —
    // the geometry the line-based calibrator's envelope documents (green
    // beyond every line, so each line is interior to the pitch region).
    const markedBase =
      scene === "pitch-marked"
        ? (() => {
            const gx0 = Math.round(width * 0.05);
            const gx1 = Math.round(width * 0.95);
            const gy0 = Math.round(height * 0.042);
            const gy1 = Math.round(height * 0.958);
            const px0 = Math.round(width * 0.075);
            const px1 = Math.round(width * 0.928);
            const py0 = Math.round(height * 0.075);
            const py1 = Math.round(height * 0.929);
            const lineThickness = Math.max(2, Math.round(width * 0.009));
            const line = (x: number, y: number, w: number, h: number) =>
              `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=0xF8F8F8:t=fill`;
            return [
              // The grass apron (green beyond every line).
              `drawbox=x=${gx0}:y=${gy0}:w=${gx1 - gx0}:h=${gy1 - gy0}:color=0x2E8B57:t=fill`,
              // The vertical family: goal line, halfway line, goal line.
              line(px0, py0, lineThickness, py1 - py0),
              line(Math.round((px0 + px1) / 2) - 1, py0, lineThickness, py1 - py0),
              line(px1 - lineThickness, py0, lineThickness, py1 - py0),
              // The horizontal family: the two touchlines.
              line(px0, py0, px1 - px0, lineThickness),
              line(px0, py1 - lineThickness, px1 - px0, lineThickness),
            ].join(",");
          })()
        : null;
    const filter =
      (markedBase === null ? "[3:v]" : `[3:v]${markedBase}[bg];[bg]`) +
      `[0:v]overlay=${overlayExpr(lanes[0]!)}[a1];` +
      `[a1][1:v]overlay=${overlayExpr(lanes[1]!)}[a2];` +
      `[a2][2:v]overlay=${overlayExpr(lanes[2]!)}[vout]`;
    argv.push(
      "-filter_complex",
      filter,
      "-map",
      "[vout]",
      ...(options.withAudio !== false ? ["-map", "4:a"] : []),
    );
  } else {
    argv = [
      tool.ffmpegPath,
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=duration=${duration}:size=${width}x${height}:rate=${frameRate}`,
    ];
    if (options.withAudio !== false) {
      argv.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${duration}`);
    }
  }
  argv.push(
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    ...(options.withAudio !== false ? ["-c:a", "aac", "-ar", "48000", "-ac", "2"] : ["-an"]),
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outputPath,
  );
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new MediaInvalidError("the in-test MP4 generator failed", {
      stderrTail: stderrTailOf(stderr),
      exitCode,
    });
  }
  return outputPath;
}
