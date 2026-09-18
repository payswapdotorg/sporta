/**
 * The fixture-adapter tests (the deterministic zero-I/O tier): byte
 * determinism, content sensitivity, honest non-video labeling, admission.
 */
import { describe, expect, test } from "bun:test";
import {
  EncodingError,
  FIXTURE_ENCODE_CODEC_PARAMS,
  FIXTURE_ENCODE_MAGIC,
  FIXTURE_ENCODER_VERSION,
  FixtureFrameEncoder,
  bridgeRgbFrames,
} from "../src/index";
import { FRAME_FPS, FRAME_HEIGHT, FRAME_WIDTH, syntheticFrames } from "./helpers";

const encoder = new FixtureFrameEncoder();

describe("FixtureFrameEncoder (the deterministic fixture tier)", () => {
  test("is always available with a pinned version", () => {
    expect(encoder.available()).toBe(true);
    expect(encoder.version()).toBe(FIXTURE_ENCODER_VERSION);
  });

  test("identical inputs produce byte-identical outputs (deterministic)", () => {
    const frames = syntheticFrames(6);
    const origin = { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" as const };
    const a = encoder.encode({
      source: { kind: "rgb24-frames", frames, width: FRAME_WIDTH, height: FRAME_HEIGHT },
      fps: FRAME_FPS,
      origin,
    });
    const b = encoder.encode({
      source: { kind: "rgb24-frames", frames, width: FRAME_WIDTH, height: FRAME_HEIGHT },
      fps: FRAME_FPS,
      origin,
    });
    expect(Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes))).toBe(0);
    expect(a.contentHash).toBe(b.contentHash);
  });

  test("different frame content produces different bytes (the stream hash is in the document)", () => {
    const origin = { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" as const };
    const a = encoder.encode({
      source: {
        kind: "rgb24-frames",
        frames: syntheticFrames(6),
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
      },
      fps: FRAME_FPS,
      origin,
    });
    const different = syntheticFrames(6).map((frame, i) => {
      const copy = new Uint8Array(frame);
      copy[0] = (copy[0]! + 1 + i) % 256;
      return copy;
    });
    const b = encoder.encode({
      source: { kind: "rgb24-frames", frames: different, width: FRAME_WIDTH, height: FRAME_HEIGHT },
      fps: FRAME_FPS,
      origin,
    });
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  test("the bytes are a LABELED fixture document, never video", () => {
    const result = encoder.encode({
      source: {
        kind: "rgb24-frames",
        frames: syntheticFrames(3),
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
      },
      fps: FRAME_FPS,
      origin: { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" },
    });
    const text = new TextDecoder().decode(result.bytes);
    expect(text.startsWith(FIXTURE_ENCODE_MAGIC)).toBe(true);
    expect(text).toContain('"streamHash"');
    expect(result.codec).toEqual(FIXTURE_ENCODE_CODEC_PARAMS);
    expect(result.codec.container).toBe("fixture");
  });

  test("a fixture-tier artifact is labeled kind 'fixture' (never claimed as MP4)", () => {
    const artifact = bridgeRgbFrames({
      encoder,
      frames: syntheticFrames(3),
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fps: FRAME_FPS,
      origin: { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" },
      sessionId: "sess-fixture",
    });
    expect(artifact.kind).toBe("fixture");
    expect(artifact.manifest.encoder.codec.container).toBe("fixture");
  });

  test("admission is fail-closed (bad geometry / bad fps / empty frames)", () => {
    const origin = { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" as const };
    expect(() =>
      encoder.encode({
        source: { kind: "rgb24-frames", frames: [new Uint8Array(8 * 8 * 3)], width: 8, height: 8 },
        fps: 25,
        origin,
      }),
    ).toThrow(EncodingError);
    expect(() =>
      encoder.encode({
        source: { kind: "rgb24-frames", frames: [], width: FRAME_WIDTH, height: FRAME_HEIGHT },
        fps: 25,
        origin,
      }),
    ).toThrow(EncodingError);
    expect(() =>
      encoder.encode({
        source: {
          kind: "rgb24-frames",
          frames: syntheticFrames(2),
          width: FRAME_WIDTH,
          height: FRAME_HEIGHT,
        },
        fps: -1,
        origin,
      }),
    ).toThrow(EncodingError);
  });

  test("the staged-file tier derives its identity without reading the file (zero I/O)", () => {
    const origin = { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" as const };
    const result = encoder.encode({
      source: {
        kind: "rgb24-file",
        path: "/nonexistent/staged.rgb24",
        frameCount: 4,
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
      },
      fps: FRAME_FPS,
      origin,
    });
    expect(result.frameCount).toBe(4);
    expect(result.byteSize).toBeGreaterThan(0);
  });
});
