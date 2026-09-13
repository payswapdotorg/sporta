import { describe, expect, test } from "bun:test";
import { encodeWav } from "../src/wav";

/**
 * Tiny in-test WAV parser: reads the 44-byte header fields (little-endian)
 * and decodes s16 samples, so the encoder's byte math is asserted against an
 * independent read-back rather than against the encoder's own constants.
 */
function parseWav(wav: Uint8Array) {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (offset: number): string =>
    String.fromCharCode(
      wav[offset] ?? 0,
      wav[offset + 1] ?? 0,
      wav[offset + 2] ?? 0,
      wav[offset + 3] ?? 0,
    );
  return {
    riff: ascii(0),
    riffSize: view.getUint32(4, true),
    wave: ascii(8),
    fmt: ascii(12),
    fmtSize: view.getUint32(16, true),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    data: ascii(36),
    dataLen: view.getUint32(40, true),
    sampleAt: (index: number): number => view.getInt16(44 + index * 2, true),
    byteAt: (offset: number): number => wav[offset] ?? 0,
  };
}

describe("encodeWav", () => {
  test("writes the canonical 44-byte RIFF/WAVE header (mono 8 kHz)", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 8000, 1);
    const header = parseWav(wav);

    expect(header.riff).toBe("RIFF");
    expect(header.wave).toBe("WAVE");
    expect(header.fmt).toBe("fmt ");
    expect(header.data).toBe("data");
    expect(header.fmtSize).toBe(16);
    expect(header.audioFormat).toBe(1); // PCM
    expect(header.channels).toBe(1);
    expect(header.sampleRate).toBe(8000);
    expect(header.byteRate).toBe(8000 * 1 * 2); // sampleRate * channels * 2
    expect(header.blockAlign).toBe(1 * 2); // channels * 2
    expect(header.bitsPerSample).toBe(16);
  });

  test("writes the canonical header for stereo 48 kHz (the W102 default target)", () => {
    const wav = encodeWav(new Float32Array(4), 48000, 2);
    const header = parseWav(wav);

    expect(header.channels).toBe(2);
    expect(header.sampleRate).toBe(48000);
    expect(header.byteRate).toBe(48000 * 2 * 2);
    expect(header.blockAlign).toBe(2 * 2);
    expect(header.bitsPerSample).toBe(16);
  });

  test("byte-length math: dataLen = samples * 2, total = 44 + dataLen, riffSize = total - 8", () => {
    const samples = new Float32Array(1000);
    const wav = encodeWav(samples, 8000, 1);
    const header = parseWav(wav);

    expect(header.dataLen).toBe(samples.length * 2);
    expect(wav.length).toBe(44 + samples.length * 2);
    expect(header.riffSize).toBe(36 + samples.length * 2); // total - 8
    expect(wav.length - 8).toBe(header.riffSize);
  });

  test("f32 -> s16 clamping and exact edge values", () => {
    const wav = encodeWav(new Float32Array([1.0, -1.0, 0]), 8000, 1);
    const header = parseWav(wav);

    expect(header.sampleAt(0)).toBe(32767); // +1.0 scales to 32768, clamps to 32767
    expect(header.sampleAt(1)).toBe(-32768); // -1.0 maps exactly to -32768
    expect(header.sampleAt(2)).toBe(0);
  });

  test("f32 -> s16 rounding and out-of-range clamping", () => {
    const wav = encodeWav(new Float32Array([0.5, -0.5, 2.0, -2.0, 0.25]), 8000, 1);
    const header = parseWav(wav);

    expect(header.sampleAt(0)).toBe(16384); // 0.5 * 32768
    expect(header.sampleAt(1)).toBe(-16384); // -0.5 * 32768
    expect(header.sampleAt(2)).toBe(32767); // above +1.0 clamps
    expect(header.sampleAt(3)).toBe(-32768); // below -1.0 clamps
    expect(header.sampleAt(4)).toBe(8192); // 0.25 * 32768
  });

  test("samples are little-endian s16 on the wire", () => {
    const wav = encodeWav(new Float32Array([0.5, -1.0]), 8000, 1);
    // 16384 = 0x4000 -> bytes [0x00, 0x40]; -32768 = 0x8000 -> bytes [0x00, 0x80].
    expect(wav[44]).toBe(0x00);
    expect(wav[45]).toBe(0x40);
    expect(wav[46]).toBe(0x00);
    expect(wav[47]).toBe(0x80);
  });

  test("deterministic: same arguments produce byte-identical output", () => {
    const samples = new Float32Array([0.1, -0.9, 0.333, 1.0]);
    expect(encodeWav(samples, 8000, 1)).toEqual(encodeWav(samples, 8000, 1));
  });

  test("validation: rejects non-positive/non-finite sampleRate", () => {
    expect(() => encodeWav(new Float32Array(1), 0, 1)).toThrow(RangeError);
    expect(() => encodeWav(new Float32Array(1), -8000, 1)).toThrow(RangeError);
    expect(() => encodeWav(new Float32Array(1), Number.NaN, 1)).toThrow(RangeError);
  });

  test("validation: rejects channels other than 1 or 2", () => {
    expect(() => encodeWav(new Float32Array(2), 8000, 0)).toThrow(RangeError);
    expect(() => encodeWav(new Float32Array(6), 8000, 3)).toThrow(RangeError);
  });

  test("validation: rejects empty samples", () => {
    expect(() => encodeWav(new Float32Array(0), 8000, 1)).toThrow(RangeError);
  });

  test("validation: rejects truncated sample frames and non-finite samples", () => {
    // 3 samples across 2 channels is one and a half frames.
    expect(() => encodeWav(new Float32Array([0, 0, 0]), 8000, 2)).toThrow(RangeError);
    expect(() => encodeWav(new Float32Array([Number.NaN]), 8000, 1)).toThrow(RangeError);
    expect(() => encodeWav(new Float32Array([Infinity]), 8000, 1)).toThrow(RangeError);
  });
});
