/**
 * The typed ffmpeg codec tests — REAL round-trips (every test in this
 * file is skipped with a typed guard when the codec is unavailable; the
 * plugin's render-time availability gate is covered in the plugin tests):
 *
 * - encode determinism: the same staged frames encode to BYTE-IDENTICAL
 *   MP4s across two independent runs (sha-256 compared — the empirical
 *   determinism proof for the pinned flag set; see codec.ts for the
 *   documented `-movflags +bitexact` removal in ffmpeg 7.x);
 * - ffprobe validation: the produced artifacts probe as h264 at the
 *   requested geometry, and mismatches fail loud;
 * - frame decode: one frame decodes to exactly W×H×3 rgb24 bytes.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodecError,
  decodeFrameRgb24,
  encodeFramesToMp4,
  probeArtifact,
} from "../../src/game/codec";
import { CODEC } from "./helpers";

/** Builds a deterministic rgb24 frame stream (a moving gradient ramp). */
function buildFrames(width: number, height: number, frameCount: number): Uint8Array {
  const bytes = new Uint8Array(width * height * 3 * frameCount);
  let o = 0;
  for (let f = 0; f < frameCount; f += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        bytes[o] = (x * 3 + f * 7) % 256;
        bytes[o + 1] = (y * 5 + f * 3) % 256;
        bytes[o + 2] = (128 + ((x + y + f) % 128)) % 256;
        o += 3;
      }
    }
  }
  return bytes;
}

describe.skipIf(!CODEC.available)("the typed ffmpeg codec wrapper (real round-trips)", () => {
  test(`probed codec: ${CODEC.version ?? "unknown"} with libx264`, () => {
    expect(CODEC.available).toBe(true);
    expect(CODEC.hasLibx264).toBe(true);
  });

  test("encode determinism: two runs produce byte-identical MP4s", () => {
    const dir = mkdtempSync(join(tmpdir(), "sporta-codec-test-"));
    const frames = buildFrames(160, 90, 12);
    const stagingRef = join(dir, "frames.rgb24");
    writeFileSync(stagingRef, frames);
    const digests: string[] = [];
    for (const run of ["a", "b"]) {
      const out = join(dir, `out-${run}.mp4`);
      const result = encodeFramesToMp4({
        stagingRef,
        widthPx: 160,
        heightPx: 90,
        fps: 12,
        frameCount: 12,
        outputPath: out,
      });
      expect(result.frameCount).toBe(12);
      expect(result.byteSize).toBeGreaterThan(0);
      digests.push(createHash("sha256").update(readFileSync(out)).digest("hex"));
    }
    expect(digests[0]).toBe(digests[1]);
  });

  test("ffprobe validates the produced artifact (h264, geometry, duration)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sporta-codec-test-"));
    const frames = buildFrames(200, 100, 10);
    const stagingRef = join(dir, "frames.rgb24");
    writeFileSync(stagingRef, frames);
    const out = join(dir, "probe.mp4");
    encodeFramesToMp4({
      stagingRef,
      widthPx: 200,
      heightPx: 100,
      fps: 10,
      frameCount: 10,
      outputPath: out,
    });
    const probe = probeArtifact({
      path: out,
      widthPx: 200,
      heightPx: 100,
      frameCount: 10,
      fps: 10,
    });
    expect(probe.codecName).toBe("h264");
    expect(probe.widthPx).toBe(200);
    expect(probe.heightPx).toBe(100);
    expect(Math.abs(probe.durationMs - 1_000)).toBeLessThanOrEqual(101); // ±1 frame
    expect(probe.avgFrameRateFps).toBeCloseTo(10, 5);
    expect(probe.container).toContain("mp4");
  });

  test("probeArtifact fails loud on geometry mismatch (never a false pass)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sporta-codec-test-"));
    const frames = buildFrames(200, 100, 10);
    const stagingRef = join(dir, "frames.rgb24");
    writeFileSync(stagingRef, frames);
    const out = join(dir, "mismatch.mp4");
    encodeFramesToMp4({
      stagingRef,
      widthPx: 200,
      heightPx: 100,
      fps: 10,
      frameCount: 10,
      outputPath: out,
    });
    expect(() =>
      probeArtifact({ path: out, widthPx: 320, heightPx: 180, frameCount: 10, fps: 10 }),
    ).toThrow(CodecError);
    expect(() =>
      probeArtifact({ path: out, widthPx: 200, heightPx: 100, frameCount: 999, fps: 10 }),
    ).toThrow(CodecError);
  });

  test("decodeFrameRgb24 returns exactly W×H×3 bytes of the requested frame", () => {
    const dir = mkdtempSync(join(tmpdir(), "sporta-codec-test-"));
    const frames = buildFrames(120, 60, 8);
    const stagingRef = join(dir, "frames.rgb24");
    writeFileSync(stagingRef, frames);
    const out = join(dir, "decode.mp4");
    encodeFramesToMp4({
      stagingRef,
      widthPx: 120,
      heightPx: 60,
      fps: 8,
      frameCount: 8,
      outputPath: out,
    });
    const frame5 = decodeFrameRgb24({ path: out, frameIndex: 5, widthPx: 120, heightPx: 60 });
    expect(frame5.length).toBe(120 * 60 * 3);
    // The decoded frame is real content, not a flat placeholder: the ramp
    // guarantees substantial per-channel variance.
    const distinct = new Set<number>();
    for (let i = 0; i < frame5.length; i += 97) distinct.add(frame5[i] ?? 0);
    expect(distinct.size).toBeGreaterThan(8);
  });

  test("encodeFramesToMp4 fails loud on a missing staging file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sporta-codec-test-"));
    expect(() =>
      encodeFramesToMp4({
        stagingRef: join(dir, "nope.rgb24"),
        widthPx: 64,
        heightPx: 48,
        fps: 10,
        frameCount: 5,
        outputPath: join(dir, "never.mp4"),
      }),
    ).toThrow(CodecError);
  });
});
