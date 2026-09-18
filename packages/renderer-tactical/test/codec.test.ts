import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FfmpegH264Codec,
  TacticalCodecError,
  TACTICAL_CONTAINER,
  TACTICAL_VIDEO_CODEC,
  createFfmpegH264Codec,
} from "../src/codec";

const ffmpegAvailable = createFfmpegH264Codec() !== null;

/** Builds a deterministic raw RGB24 sequence (gradients + per-frame offset). */
function rawSequence(frameCount: number, width: number, height: number): Buffer {
  const bytes = Buffer.alloc(frameCount * width * height * 3);
  let offset = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        bytes[offset] = (x * 4 + frame * 10) % 256;
        bytes[offset + 1] = (y * 7 + frame * 3) % 256;
        bytes[offset + 2] = (x * 2 + y + frame * 30) % 256;
        offset += 3;
      }
    }
  }
  return bytes;
}

function ffprobeJson(path: string): Record<string, unknown> {
  const run = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,profile,width,height,avg_frame_rate,nb_frames",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf8" },
  );
  expect(run.status).toBe(0);
  return JSON.parse(run.stdout) as Record<string, unknown>;
}

describe("FfmpegH264Codec (the typed encode wrapper)", () => {
  test("probes the real ffmpeg and reports a version", () => {
    const codec = new FfmpegH264Codec();
    expect(codec.available()).toBe(true);
    expect(codec.version()).toMatch(/^\S+/);
    expect(codec.kind).toBe("ffmpeg-h264");
  });

  test.skipIf(!ffmpegAvailable)(
    "encodes a REAL playable MP4: h264, right dims, right frame count, decodes clean",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "tactical-codec-"));
      try {
        const width = 96;
        const height = 54;
        const frameCount = 7;
        const rawPath = join(dir, "frames.rgb24");
        writeFileSync(rawPath, rawSequence(frameCount, width, height));
        const codec = new FfmpegH264Codec();
        const mp4 = codec.encode({
          rawFrameSequencePath: rawPath,
          frameCount,
          width,
          height,
          fps: 12.5,
        });
        expect(mp4.length).toBeGreaterThan(1000);
        const outPath = join(dir, "out.mp4");
        writeFileSync(outPath, mp4);

        const stream = (ffprobeJson(outPath).streams as Array<Record<string, unknown>>)[0]!;
        expect(stream.codec_name).toBe("h264");
        expect(stream.profile).toBe("Constrained Baseline");
        expect(Number(stream.width)).toBe(width);
        expect(Number(stream.height)).toBe(height);
        expect(stream.avg_frame_rate).toBe("25/2");
        expect(Number(stream.nb_frames)).toBe(frameCount);

        // Playability: a full decode must produce zero errors.
        const decode = spawnSync("ffmpeg", ["-v", "error", "-i", outPath, "-f", "null", "-"], {
          encoding: "utf8",
        });
        expect(decode.status).toBe(0);
        expect(decode.stderr).toBe("");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(!ffmpegAvailable)("encode is deterministic: three runs, one sha-256", () => {
    const dir = mkdtempSync(join(tmpdir(), "tactical-codec-det-"));
    try {
      const width = 80;
      const height = 44;
      const frameCount = 5;
      const rawPath = join(dir, "frames.rgb24");
      writeFileSync(rawPath, rawSequence(frameCount, width, height));
      const codec = new FfmpegH264Codec();
      const a = codec.encode({ rawFrameSequencePath: rawPath, frameCount, width, height, fps: 10 });
      const b = codec.encode({ rawFrameSequencePath: rawPath, frameCount, width, height, fps: 10 });
      const c = codec.encode({ rawFrameSequencePath: rawPath, frameCount, width, height, fps: 10 });
      expect(Buffer.compare(a, b)).toBe(0);
      expect(Buffer.compare(b, c)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the declared codec identity matches the produced stream profile", () => {
    // avc1.42E01E = Constrained Baseline @ Level 3.0 — what ffprobe reports
    // for the wrapper's pinned flags (verified by the encode test above).
    expect(TACTICAL_VIDEO_CODEC).toBe("avc1.42E01E");
    expect(TACTICAL_CONTAINER).toBe("mp4");
  });

  test("fails loud on invalid encode requests (typed)", () => {
    const codec = new FfmpegH264Codec();
    expect(() =>
      codec.encode({
        rawFrameSequencePath: "/nonexistent",
        frameCount: 1,
        width: 8,
        height: 8,
        fps: 10,
      }),
    ).toThrow(TacticalCodecError);
    expect(() =>
      codec.encode({
        rawFrameSequencePath: "/nonexistent",
        frameCount: 1,
        width: 640,
        height: 360,
        fps: 0,
      }),
    ).toThrow(/fps/);
    expect(() =>
      codec.encode({
        rawFrameSequencePath: "/nonexistent",
        frameCount: 0,
        width: 640,
        height: 360,
        fps: 10,
      }),
    ).toThrow(/frameCount/);
  });

  test("a missing encoder binary is unavailable (never fabricated)", () => {
    expect(createFfmpegH264Codec("/nonexistent/ffmpeg-binary")).toBeNull();
  });
});
