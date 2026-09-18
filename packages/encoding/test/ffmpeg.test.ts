/**
 * The real ffmpeg adapter tests: REAL encodes (h264 Constrained Baseline
 * MP4s), the determinism proof (three runs, one sha-256 — byte-identity,
 * not just hash equality), honest failures (typed errors, exit codes,
 * timeout kills), and the verify plane (probe + full decode round trip).
 * Every real-encode test carries the typed skip guard (the repo
 * convention for machines without ffmpeg/libx264).
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  EncodingError,
  FfmpegFrameEncoder,
  REAL_ENCODE_CODEC_PARAMS,
  bridgeRgbFrames,
  createFfmpegFrameEncoder,
  decodeEncodedFrames,
  probeEncodedArtifact,
  probeFfmpegEncoder,
} from "../src/index";
import {
  FRAME_FPS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  cleanDir,
  failingFfmpeg,
  syntheticFrames,
} from "./helpers";

const encoder = createFfmpegFrameEncoder();
const available = encoder !== null;
const real = encoder ?? new FfmpegFrameEncoder();

describe.skipIf(!available)("FfmpegFrameEncoder (the real encode path)", () => {
  test("probes available with a version banner", () => {
    expect(real.available()).toBe(true);
    expect(real.version()).toMatch(/ffmpeg version \S+/);
    expect(probeFfmpegEncoder().hasLibx264).toBe(true);
  });

  test("encodes a real MP4: h264 Constrained Baseline, exact geometry, pinned codec params", () => {
    const frames = syntheticFrames(10);
    const result = real.encode({
      source: { kind: "rgb24-frames", frames, width: FRAME_WIDTH, height: FRAME_HEIGHT },
      fps: FRAME_FPS,
      origin: { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" },
    });
    expect(result.frameCount).toBe(10);
    expect(result.width).toBe(FRAME_WIDTH);
    expect(result.height).toBe(FRAME_HEIGHT);
    expect(result.durationMs).toBe(400);
    expect(result.byteSize).toBeGreaterThan(0);
    expect(result.codec).toEqual(REAL_ENCODE_CODEC_PARAMS);
    // The MP4 signature (a REAL mp4 container, never a stand-in).
    expect(Array.from(result.bytes.slice(4, 8))).toEqual([0x66, 0x74, 0x79, 0x70]); // "ftyp"
  });

  test("the content hash is the sha-256 of the bytes (cross-verified with node:crypto)", () => {
    const result = real.encode({
      source: { kind: "rgb24-frames", frames: syntheticFrames(6), width: FRAME_WIDTH, height: FRAME_HEIGHT },
      fps: FRAME_FPS,
      origin: { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" },
    });
    expect(result.contentHash).toBe(createHash("sha256").update(result.bytes).digest("hex"));
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("DETERMINISM: three runs of the same frames produce byte-identical MP4s (one sha-256)", () => {
    const frames = syntheticFrames(12);
    const origin = { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" as const };
    const a = real.encode({ source: { kind: "rgb24-frames", frames, width: FRAME_WIDTH, height: FRAME_HEIGHT }, fps: FRAME_FPS, origin });
    const b = real.encode({ source: { kind: "rgb24-frames", frames, width: FRAME_WIDTH, height: FRAME_HEIGHT }, fps: FRAME_FPS, origin });
    const c = real.encode({ source: { kind: "rgb24-frames", frames, width: FRAME_WIDTH, height: FRAME_HEIGHT }, fps: FRAME_FPS, origin });
    expect(Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes))).toBe(0);
    expect(Buffer.compare(Buffer.from(b.bytes), Buffer.from(c.bytes))).toBe(0);
    expect(a.contentHash).toBe(b.contentHash);
    expect(b.contentHash).toBe(c.contentHash);
  });

  test("different frame content produces different bytes (the hash is honest)", () => {
    const origin = { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" as const };
    const a = real.encode({ source: { kind: "rgb24-frames", frames: syntheticFrames(6), width: FRAME_WIDTH, height: FRAME_HEIGHT }, fps: FRAME_FPS, origin });
    // A SUBSTANTIAL difference (a full inverted band — a one-pixel nudge can
    // vanish under lossy crf 18, which would make this test vacuous).
    const different = syntheticFrames(6).map((frame) => {
      const copy = new Uint8Array(frame);
      for (let p = 0; p < FRAME_WIDTH * 20; p += 1) {
        copy[p * 3] = 255 - copy[p * 3]!;
        copy[p * 3 + 1] = 255 - copy[p * 3 + 1]!;
        copy[p * 3 + 2] = 255 - copy[p * 3 + 2]!;
      }
      return copy;
    });
    const b = real.encode({ source: { kind: "rgb24-frames", frames: different, width: FRAME_WIDTH, height: FRAME_HEIGHT }, fps: FRAME_FPS, origin });
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});

describe.skipIf(!available)("admission (fail-closed, typed — never partial video)", () => {
  const origin = { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" as const };

  test("odd dimensions are refused (yuv420p)", () => {
    expect(() =>
      real.encode({ source: { kind: "rgb24-frames", frames: [new Uint8Array(161 * 90 * 3)], width: 161, height: 90 }, fps: 25, origin }),
    ).toThrow(EncodingError);
  });

  test("dimensions below 16 are refused", () => {
    expect(() =>
      real.encode({ source: { kind: "rgb24-frames", frames: [new Uint8Array(8 * 8 * 3)], width: 8, height: 8 }, fps: 25, origin }),
    ).toThrow(EncodingError);
  });

  test("a wrong frame byte length is refused (invalid frame stream)", () => {
    try {
      real.encode({ source: { kind: "rgb24-frames", frames: [new Uint8Array(10)], width: FRAME_WIDTH, height: FRAME_HEIGHT }, fps: 25, origin });
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).kind).toBe("frames-invalid");
    }
  });

  test("an empty frame list is refused", () => {
    expect(() =>
      real.encode({ source: { kind: "rgb24-frames", frames: [], width: FRAME_WIDTH, height: FRAME_HEIGHT }, fps: 25, origin }),
    ).toThrow(EncodingError);
  });

  test("fps <= 0 is refused", () => {
    expect(() =>
      real.encode({ source: { kind: "rgb24-frames", frames: syntheticFrames(2), width: FRAME_WIDTH, height: FRAME_HEIGHT }, fps: 0, origin }),
    ).toThrow(EncodingError);
  });
});

describe.skipIf(!available)("bounded subprocess discipline (no zombies, no hangs, honest exits)", () => {
  const origin = { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" as const };
  const frames = syntheticFrames(4);

  test("a hanging encode is killed at the bound and surfaced as a typed error", () => {
    // NOTE (Bun 1.3.14, measured): spawnSync's timeout+SIGKILL reliably kills
    // DIRECT binaries (the real ffmpeg) but NOT shebang-script targets —
    // so the bound is tested against the REAL ffmpeg with a 1 ms timeout:
    // any real encode exceeds it, the child is killed at the bound (or the
    // bound races the kill — Node's contract: error ⇒ failure, either way),
    // and the synchronous contract reaps it (no zombie possible —
    // spawnSync blocks until the child is gone).
    const bounded = new FfmpegFrameEncoder({ timeoutMs: 1 });
    try {
      bounded.encode({ source: { kind: "rgb24-frames", frames, width: FRAME_WIDTH, height: FRAME_HEIGHT }, fps: FRAME_FPS, origin });
      throw new Error("unreachable: the bounded encode should have been refused");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).kind).toBe("encode-failed");
      // The bound surfaced honestly: the timeout is recorded, and the
      // failure is attributed to the bound (the message) with the signal
      // recorded when the runtime reports it.
      expect((error as EncodingError).details.timeoutMs).toBe(1);
      expect((error as Error).message).toContain("1 ms bound");
    }
  });

  test("a failing encode surfaces the exit code + stderr honestly", () => {
    const fake = failingFfmpeg();
    try {
      const failing = new FfmpegFrameEncoder({ ffmpegPath: fake.path });
      try {
        failing.encode({ source: { kind: "rgb24-frames", frames, width: FRAME_WIDTH, height: FRAME_HEIGHT }, fps: FRAME_FPS, origin });
        throw new Error("unreachable");
      } catch (error) {
        expect(error).toBeInstanceOf(EncodingError);
        expect((error as EncodingError).kind).toBe("encode-failed");
        expect((error as EncodingError).details.status).toBe(3);
        expect(String((error as EncodingError).details.stderr)).toContain("fake encoder exploded");
      }
    } finally {
      cleanDir(fake.dir);
    }
  });

  test("a missing binary is reported unavailable (createFfmpegFrameEncoder → null)", () => {
    expect(createFfmpegFrameEncoder({ ffmpegPath: "/nonexistent/ffmpeg-binary" })).toBeNull();
    const missing = new FfmpegFrameEncoder({ ffmpegPath: "/nonexistent/ffmpeg-binary" });
    expect(missing.available()).toBe(false);
    try {
      missing.encode({ source: { kind: "rgb24-frames", frames, width: FRAME_WIDTH, height: FRAME_HEIGHT }, fps: FRAME_FPS, origin });
      throw new Error("unreachable");
    } catch (error) {
      expect((error as EncodingError).kind).toBe("encoder-unavailable");
    }
  });
});

describe.skipIf(!available)("the verify plane (probe + full decode)", () => {
  test("probeEncodedArtifact cross-checks the manifest (codec, profile, geometry)", () => {
    const artifact = bridgeRgbFrames({
      encoder: real,
      frames: syntheticFrames(8),
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fps: FRAME_FPS,
      origin: { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" },
      sessionId: "sess-verify",
    });
    const probe = probeEncodedArtifact(artifact);
    expect(probe.codecName).toBe("h264");
    expect(probe.profile).toBe("Constrained Baseline");
    expect(probe.widthPx).toBe(FRAME_WIDTH);
    expect(probe.heightPx).toBe(FRAME_HEIGHT);
    expect(probe.frameCount).toBe(8);
    expect(probe.avgFrameRateFps).toBe(FRAME_FPS);
  });

  test("decodeEncodedFrames decodes EVERY frame back to exact rgb24 byte counts", () => {
    const artifact = bridgeRgbFrames({
      encoder: real,
      frames: syntheticFrames(8),
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fps: FRAME_FPS,
      origin: { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" },
      sessionId: "sess-verify",
    });
    const decoded = decodeEncodedFrames(artifact);
    expect(decoded.length).toBe(8);
    for (const frame of decoded) {
      expect(frame.length).toBe(FRAME_WIDTH * FRAME_HEIGHT * 3);
    }
  });

  test("a container-corrupted artifact is refused by the probe (teeth)", () => {
    const artifact = bridgeRgbFrames({
      encoder: real,
      frames: syntheticFrames(8),
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fps: FRAME_FPS,
      origin: { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" },
      sessionId: "sess-verify",
    });
    // Corrupt the container header: the probe can no longer read the stream.
    const corrupted = new Uint8Array(artifact.bytes);
    corrupted.fill(0, 0, 256);
    expect(() => probeEncodedArtifact({ ...artifact, bytes: corrupted })).toThrow(EncodingError);
  });
});
