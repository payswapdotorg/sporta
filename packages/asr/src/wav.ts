/**
 * Pure 16-bit PCM WAV encoder (W207) — no dependencies.
 *
 * Produces the canonical 44-byte RIFF/WAVE header followed by signed 16-bit
 * little-endian PCM samples: the container every {@link AsrBackend} accepts.
 * Pure: no I/O, no clock, no randomness — the same arguments always produce
 * byte-identical output.
 *
 * Byte layout (all integers little-endian):
 *
 * | offset | size | field                                | value                       |
 * | ------ | ---- | ------------------------------------ | --------------------------- |
 * | 0      | 4    | chunk id                             | `"RIFF"`                    |
 * | 4      | 4    | chunk size                           | `36 + dataLen` (size − 8)   |
 * | 8      | 4    | format                               | `"WAVE"`                    |
 * | 12     | 4    | subchunk 1 id                        | `"fmt "`                    |
 * | 16     | 4    | subchunk 1 size                      | 16                          |
 * | 20     | 2    | audio format                         | 1 (PCM)                     |
 * | 22     | 2    | channel count                        | `channels` (1 or 2)         |
 * | 24     | 4    | sample rate                          | `sampleRate`                |
 * | 28     | 4    | byte rate                            | `sampleRate * channels * 2` |
 * | 32     | 2    | block align                          | `channels * 2`              |
 * | 34     | 2    | bits per sample                      | 16                          |
 * | 36     | 4    | subchunk 2 id                        | `"data"`                    |
 * | 40     | 4    | subchunk 2 size (`dataLen`)          | `samples.length * 2`        |
 * | 44     | —    | PCM data                             | s16le samples               |
 *
 * Byte math (asserted in tests): `dataLen = samples.length * 2` and the total
 * encoded length is `44 + dataLen`.
 *
 * f32 → s16 conversion (documented rule): each sample is clamped to [-1, 1],
 * scaled by 32768, rounded HALF-UP (`Math.round`: exact ties round toward
 * +Infinity), then clamped into the s16 range — so `+1.0` scales to 32768 and
 * clamps to 32767, `-1.0` maps exactly to -32768, and `0` maps to 0. A
 * non-finite sample is rejected: silently encoding NaN/Infinity as 0 would be
 * invented audio (architecture-lock §4 in spirit — no invented certainty).
 *
 * Validation failures throw `RangeError` (the repository's pure-helper
 * convention, cf. `samplesPerChunk` in W102): non-positive or non-finite
 * `sampleRate`, a `channels` other than 1 or 2, an empty `samples` array, a
 * `samples.length` that is not a whole number of interleaved sample frames,
 * or any non-finite sample value.
 */

/** s16 full-scale magnitude used for the f32 → s16 scale step. */
const S16_SCALE = 32768;

/** s16 minimum after clamping (exact for a -1.0 sample). */
const S16_MIN = -32768;

/** s16 maximum after clamping (+1.0 scales to 32768 and clamps down). */
const S16_MAX = 32767;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < 4; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Clamps a finite float32 sample into the s16 range (see module docs). */
function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  const scaled = Math.round(clamped * S16_SCALE);
  return Math.max(S16_MIN, Math.min(S16_MAX, scaled));
}

/**
 * Encodes interleaved float32 samples in [-1, 1] as a 44-byte-header
 * 16-bit PCM WAV file. See the module docs for the byte layout, the rounding
 * rule, and the validation contract.
 */
export function encodeWav(samples: Float32Array, sampleRate: number, channels: number): Uint8Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(
      `encodeWav requires a positive finite sampleRate (got ${String(sampleRate)})`,
    );
  }
  if (channels !== 1 && channels !== 2) {
    throw new RangeError(`encodeWav requires channels 1 or 2 (got ${String(channels)})`);
  }
  if (samples.length === 0) {
    throw new RangeError("encodeWav requires a non-empty samples array");
  }
  if (samples.length % channels !== 0) {
    throw new RangeError(
      `encodeWav requires a whole number of interleaved sample frames ` +
        `(got ${samples.length} samples across ${channels} channel(s))`,
    );
  }
  for (let i = 0; i < samples.length; i += 1) {
    if (!Number.isFinite(samples[i])) {
      throw new RangeError(
        `encodeWav requires finite samples (samples[${i}] is ${String(samples[i])})`,
      );
    }
  }

  const dataLen = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLen, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    // The validation pass above proved every sample finite; the `?? 0` only
    // satisfies noUncheckedIndexedAccess.
    const sample = samples[i] ?? 0;
    view.setInt16(offset, floatToInt16(sample), true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}
