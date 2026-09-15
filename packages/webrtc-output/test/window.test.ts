/**
 * Frame-window construction and integrity verification (W305): pure,
 * deterministic, byte-stable — the same emission yields the deep-equal
 * window; every descriptor field is derived from the payload's OWN bytes and
 * timestamps (never re-stamped, never invented); every corruption the
 * verifier can catch is caught with a typed reason.
 */
import { describe, expect, test } from "bun:test";
import {
  buildLiveFrameWindow,
  frameWindowId,
  sha256Hex,
  utf8ByteLength,
  validateLiveOutputPayload,
  verifyFrameWindowIntegrity,
} from "../src/window";
import type { LiveFrameWindowEnvelope } from "../src/types";
import { FRAME_INTERVAL_MS, LIVE_PROFILE, fixtureEmission, fixtureFrame } from "./helpers";

describe("hashing primitives (the W504/W101 sha-256 posture)", () => {
  test("sha256Hex matches the known empty-string vector", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("sha256Hex matches the known 'abc' vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("sha256Hex is deterministic across calls", () => {
    expect(sha256Hex("<svg>frame 1</svg>")).toBe(sha256Hex("<svg>frame 1</svg>"));
  });

  test("utf8ByteLength counts multi-byte characters in UTF-8 bytes", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("ä")).toBe(2);
    expect(utf8ByteLength("⚽")).toBe(3);
    expect(utf8ByteLength("aä⚽")).toBe(6);
  });
});

describe("frameWindowId (the idempotency key)", () => {
  test("the id derives from the stream and the source watermark", () => {
    expect(frameWindowId("live-s", { watermarkMs: 1_500, sequence: 7 })).toBe(
      "liveout-live-s-wm-1500-seq-7",
    );
  });

  test("the same watermark yields the same id (Recovery rule)", () => {
    expect(frameWindowId("live-s", { watermarkMs: 1_500, sequence: 7 })).toBe(
      frameWindowId("live-s", { watermarkMs: 1_500, sequence: 7 }),
    );
  });

  test("a different watermark yields a different id", () => {
    expect(frameWindowId("live-s", { watermarkMs: 1_501, sequence: 7 })).not.toBe(
      frameWindowId("live-s", { watermarkMs: 1_500, sequence: 7 }),
    );
  });
});

describe("validateLiveOutputPayload (the structural intake seam)", () => {
  test("a W502-shaped payload with extra manifest fields is valid", () => {
    const check = validateLiveOutputPayload(
      fixtureEmission({ ordinal: 0, watermarkMs: 1_000 }).output,
    );
    expect(check).toEqual({ ok: true });
  });

  test("a non-object payload is rejected", () => {
    expect(validateLiveOutputPayload(null)).toMatchObject({ ok: false });
    expect(validateLiveOutputPayload("nope")).toMatchObject({ ok: false });
    expect(validateLiveOutputPayload([1, 2])).toMatchObject({ ok: false });
  });

  test("an empty frames array is rejected", () => {
    const emission = fixtureEmission({ ordinal: 0, watermarkMs: 1_000, frameCount: 0 });
    const check = validateLiveOutputPayload(emission.output);
    expect(check).toMatchObject({ ok: false, reason: expect.stringContaining("frames") });
  });

  test("a frame missing its svg is rejected", () => {
    const check = validateLiveOutputPayload({
      frames: [{ frameIndex: 0, outputTimestampMs: 0 }],
      manifest: fixtureEmission({ ordinal: 0, watermarkMs: 1_000 }).output.manifest,
    });
    expect(check).toMatchObject({ ok: false });
  });

  test("a manifest without renderer identity is rejected", () => {
    const emission = fixtureEmission({ ordinal: 0, watermarkMs: 1_000 });
    const check = validateLiveOutputPayload({
      frames: emission.output.frames,
      manifest: { output: emission.output.manifest.output },
    });
    expect(check).toMatchObject({ ok: false, reason: expect.stringContaining("renderer") });
  });

  test("a manifest without output timing is rejected", () => {
    const emission = fixtureEmission({ ordinal: 0, watermarkMs: 1_000 });
    const check = validateLiveOutputPayload({
      frames: emission.output.frames,
      manifest: { renderer: emission.output.manifest.renderer },
    });
    expect(check).toMatchObject({ ok: false, reason: expect.stringContaining("manifest") });
  });
});

describe("buildLiveFrameWindow (deterministic construction)", () => {
  const emission = fixtureEmission({ ordinal: 3, watermarkMs: 4_000, frameCount: 3 });

  function built(): LiveFrameWindowEnvelope {
    return buildLiveFrameWindow(emission, { streamId: "live-s", ordinal: 7, emittedAtMs: 123_456 });
  }

  test("the same inputs build the deep-equal window, twice", () => {
    expect(built()).toEqual(built());
  });

  test("descriptors derive from the payload's OWN timestamps (verbatim)", () => {
    const { window } = built();
    expect(window.frames.map((f) => f.presentationTimestampMs)).toEqual([3_000, 4_000, 5_000]);
    expect(window.frames.map((f) => f.frameIndex)).toEqual([0, 1, 2]);
  });

  test("byte sizes are the UTF-8 byte lengths of the frame documents", () => {
    const { window } = built();
    window.frames.forEach((descriptor, i) => {
      expect(descriptor.byteSize).toBe(utf8ByteLength(emission.output.frames[i]!.svg));
    });
    expect(window.byteSize).toBe(
      emission.output.frames.reduce((sum, frame) => sum + utf8ByteLength(frame.svg), 0),
    );
  });

  test("content hashes match an independent recomputation", () => {
    const { window } = built();
    window.frames.forEach((descriptor, i) => {
      expect(descriptor.contentHash).toBe(sha256Hex(emission.output.frames[i]!.svg));
    });
    expect(window.contentHash).toBe(
      sha256Hex(emission.output.frames.map((frame) => frame.svg).join("")),
    );
  });

  test("the profile is carried VERBATIM (same reference, same value)", () => {
    const { window } = built();
    expect(window.profile).toBe(emission.output.manifest.output.profile);
    expect(window.profile).toEqual(LIVE_PROFILE);
  });

  test("the W304 emission provenance is copied field-for-field", () => {
    const { window } = built();
    expect(window.provenance).toEqual(emission.provenance);
    expect(window.watermark).toEqual(emission.provenance.sourceWatermark);
    expect(window.windowId).toBe(frameWindowId("live-s", emission.provenance.sourceWatermark));
    expect(window.ordinal).toBe(7);
    expect(window.frameCount).toBe(3);
    expect(window.emittedAtMs).toBe(123_456);
    expect(window.streamId).toBe("live-s");
    expect(window.sessionId).toBe(emission.provenance.sessionId);
  });

  test("a malformed emission throws (fail-closed at the door)", () => {
    expect(() =>
      buildLiveFrameWindow(
        {
          output: { frames: [] } as unknown as import("../src/types").LiveOutputPayload,
          provenance: emission.provenance,
        },
        { streamId: "live-s", ordinal: 0, emittedAtMs: 0 },
      ),
    ).toThrow(TypeError);
  });
});

describe("verifyFrameWindowIntegrity (the fail-closed delivery boundary)", () => {
  function envelope(): LiveFrameWindowEnvelope {
    const emission = fixtureEmission({ ordinal: 1, watermarkMs: 2_000, frameCount: 2 });
    return buildLiveFrameWindow(emission, { streamId: "live-s", ordinal: 1, emittedAtMs: 500 });
  }

  /** Deep-copies the envelope (mutating the copy, never the original). */
  function corrupted(mutate: (env: LiveFrameWindowEnvelope) => void): LiveFrameWindowEnvelope {
    const copy: LiveFrameWindowEnvelope = {
      window: structuredClone(envelope().window),
      payload: { ...envelope().payload, frames: [...envelope().payload.frames] },
    };
    mutate(copy);
    return copy;
  }

  test("an untouched envelope verifies", () => {
    expect(verifyFrameWindowIntegrity(envelope())).toEqual({ ok: true });
  });

  test("a mutated frame document fails its per-frame hash", () => {
    const env = corrupted((copy) => {
      copy.payload.frames[0]!.svg = "<svg>tampered</svg>";
    });
    const result = verifyFrameWindowIntegrity(env);
    expect(result).toMatchObject({ ok: false, frameIndex: 0 });
    expect(result.ok === false && result.reason).toContain("content hash mismatch");
  });

  test("a frame count mismatch fails", () => {
    const env = corrupted((copy) => {
      copy.window.frameCount = 3;
    });
    const result = verifyFrameWindowIntegrity(env);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toContain("frame count mismatch");
  });

  test("a re-stamped presentation timestamp fails (timestamps are verbatim)", () => {
    const env = corrupted((copy) => {
      copy.window.frames[0]!.presentationTimestampMs += 1;
    });
    const result = verifyFrameWindowIntegrity(env);
    expect(result).toMatchObject({ ok: false, frameIndex: 0 });
    expect(result.ok === false && result.reason).toContain("timestamp mismatch");
  });

  test("a lying byte size fails", () => {
    const env = corrupted((copy) => {
      copy.window.frames[1]!.byteSize += 8;
    });
    const result = verifyFrameWindowIntegrity(env);
    expect(result).toMatchObject({ ok: false, frameIndex: 1 });
    expect(result.ok === false && result.reason).toContain("byte size mismatch");
  });

  test("a window-level hash mismatch fails (concatenated bytes)", () => {
    const env = corrupted((copy) => {
      copy.window.contentHash = sha256Hex("not the concatenated payload");
    });
    const result = verifyFrameWindowIntegrity(env);
    expect(result.ok === false && result.reason).toContain("window content hash mismatch");
  });

  test("a window byte-size total mismatch fails", () => {
    const env = corrupted((copy) => {
      copy.window.byteSize += 1;
    });
    const result = verifyFrameWindowIntegrity(env);
    expect(result.ok === false && result.reason).toContain("window byte size mismatch");
  });

  test("a dropped descriptor fails with its index", () => {
    const env = corrupted((copy) => {
      copy.window.frames = [copy.window.frames[0]!];
    });
    const result = verifyFrameWindowIntegrity(env);
    expect(result).toMatchObject({ ok: false, frameIndex: 1 });
  });

  test("an extra descriptor beyond the payload fails (never silently ignored)", () => {
    const env = corrupted((copy) => {
      copy.window.frames = [...copy.window.frames, structuredClone(copy.window.frames[0]!)];
    });
    const result = verifyFrameWindowIntegrity(env);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toContain("descriptor table mismatch");
  });

  test("tampered content diagnoses as a hash mismatch even when the length changes", () => {
    // The diagnostic contract pinned from the OTHER side: a byte-length
    // change is NOT sufficient to mislabel content tampering as a
    // descriptor-size problem — the hash check runs first, always.
    const env = corrupted((copy) => {
      const frame = copy.payload.frames[0]!;
      frame.svg = `${frame.svg}!`;
    });
    const result = verifyFrameWindowIntegrity(env);
    expect(result.ok === false && result.reason).toContain("content hash mismatch");
  });
});

describe("payload timestamps (the presentation clock source)", () => {
  test("frame timestamps are pure arithmetic over the manifest cadence", () => {
    const emission = fixtureEmission({
      ordinal: 0,
      watermarkMs: 9_000,
      frameCount: 4,
      startMs: 6_000,
      frameIntervalMs: FRAME_INTERVAL_MS,
    });
    expect(emission.output.frames.map((f) => f.outputTimestampMs)).toEqual([
      6_000, 7_000, 8_000, 9_000,
    ]);
  });

  test("fixture frames are byte-stable", () => {
    expect(fixtureFrame(2, 3_000)).toEqual(fixtureFrame(2, 3_000));
    expect(fixtureFrame(2, 3_000)).not.toEqual(fixtureFrame(3, 3_000));
  });
});
