/**
 * Normalized decode types (W102) — the internal representations that video
 * and audio are decoded into on the canonical media timeline.
 *
 * Architecture-lock §3: video and audio are separate first-class inputs, so
 * the normalized forms stay separate (`NormalizedVideoFrame` vs
 * `NormalizedAudioChunk`) and every item carries its timeline position.
 * Architecture-lock §13: media (and therefore decoder output) is UNTRUSTED —
 * the byte-volume invariants documented here (frame `bytes.byteLength ===
 * width * height * 3`, chunk `samples.length` bounded by the audio target)
 * are ENFORCED by `DecodingService`, not assumed.
 */
import type { AuthorizationPolicy } from "@sporta/contracts";
import type { Container, IngestionReceipt } from "@sporta/ingestion";

/** The two first-class media track kinds (video and audio only). */
export type MediaTrackKind = "video" | "audio";

/**
 * One demuxed track as reported by `probe`. `streamIndex` is the demuxer's
 * stream number (ffmpeg `-show_streams` `index`); `trackId` is a stable,
 * adapter-documented id of the form `t-<streamIndex>-<kind>`.
 */
export interface TrackInfo {
  /** Stable track id: `t-<streamIndex>-<kind>`. */
  trackId: string;
  /** Demuxer stream index (the same index decode methods select). */
  streamIndex: number;
  kind: MediaTrackKind;
  /** Codec short name as reported by the demuxer (e.g. `h264`, `aac`). */
  codec: string;
  /** ISO 639 language tag when the container declares one. */
  language?: string;
  /** Stream start offset on the media timeline (milliseconds). */
  startTimeMs: number;
  /** Stream duration in milliseconds. */
  durationMs: number;
}

/**
 * One decoded video frame in the normalized internal representation.
 *
 * INVARIANT (enforced by `DecodingService`): `bytes.byteLength` MUST equal
 * `width * height * 3` — `rgb24` packs 3 bytes per pixel, so the decoded
 * byte volume is fully determined by the frame geometry and any deviation is
 * corrupt (attacker-controlled) output, not media.
 */
export interface NormalizedVideoFrame {
  /** Frame id: `f-<streamIndex>-<decodeOrder>`. */
  frameId: string;
  /** Stream the frame was decoded from. */
  streamIndex: number;
  /** Presentation position on the media timeline (milliseconds). */
  presentationMs: number;
  /** Decode-order position within one decode call, starting at 0. */
  decodeOrder: number;
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
  /** Fixed normalized pixel format (packed RGB, 3 bytes per pixel). */
  pixelFormat: "rgb24";
  /** Frame pixels; `byteLength === width * height * 3` (enforced). */
  bytes: Uint8Array;
}

/**
 * One decoded audio chunk in the normalized internal representation.
 *
 * `samples` is INTERLEAVED (frame-major: `samples[frame * channels + c]`)
 * IEEE-754 float32 in [-1, 1]. A full chunk holds exactly
 * `sampleRate * channels * (chunkMs / 1000)` samples; the FINAL chunk of a
 * stream may be shorter when the duration does not divide evenly (but is
 * always a whole number of interleaved sample frames).
 */
export interface NormalizedAudioChunk {
  /** Chunk id: `a-<streamIndex>-<chunkIndex>`. */
  chunkId: string;
  /** Stream the chunk was decoded from. */
  streamIndex: number;
  /** Timeline position of the chunk's first sample (milliseconds). */
  startMs: number;
  /** Output sample rate in hertz. */
  sampleRate: number;
  /** Output channel count. */
  channels: number;
  /** Interleaved float32 samples (see interface doc for the length rule). */
  samples: Float32Array;
}

/** Result of demuxing-level inspection of one source. */
export interface ProbeResult {
  /** Every video/audio track; data/subtitle/attachment streams are skipped. */
  tracks: TrackInfo[];
  /** Container family (carried over from the ingestion receipt). */
  container: Container;
  /** Whole-source duration in milliseconds. */
  durationMs: number;
}

/**
 * Time/byte window for a decode call.
 *
 * - `fromMs`/`toMs` slice the media timeline: a video frame is included iff
 *   its `presentationMs` is in `[fromMs, toMs)`; an audio chunk is included
 *   iff its `startMs` is in `[fromMs, toMs)` (chunks are atomic — a chunk
 *   that starts inside the window is emitted whole).
 * - `maxTotalBytes` bounds the cumulative decoded bytes for the call;
 *   exceeding it terminates the iteration with a `resource-limit` error.
 */
export interface DecodeWindow {
  /** Inclusive window start (milliseconds; default 0). */
  fromMs?: number;
  /** Exclusive window end (milliseconds; default: end of stream). */
  toMs?: number;
  /** Per-call byte budget override (default: limits.maxTotalBytes). */
  maxTotalBytes?: number;
}

/**
 * The canonical audio decode target: output is resampled to `sampleRate`,
 * remixed to `channels`, and chunked at `chunkMs` granularity.
 */
export interface AudioTarget {
  /** Output sample rate in hertz. */
  sampleRate: number;
  /** Output channel count. */
  channels: number;
  /** Chunk duration in milliseconds. */
  chunkMs: number;
}

/**
 * The canonical default audio target: 48 kHz stereo, 250 ms chunks (6000
 * sample frames, 24000 interleaved samples per chunk). Frozen.
 */
export const DEFAULT_AUDIO_TARGET: AudioTarget = Object.freeze({
  sampleRate: 48_000,
  channels: 2,
  chunkMs: 250,
}) as AudioTarget;

/**
 * Samples per FULL chunk for `target` (interleaved sample count). Throws a
 * `RangeError` when `sampleRate * channels * chunkMs / 1000` is not an
 * integer — a chunk target that cannot produce whole samples is a caller
 * configuration error, not a media property.
 */
export function samplesPerChunk(target: AudioTarget): number {
  const total = (target.sampleRate * target.channels * target.chunkMs) / 1000;
  if (!Number.isInteger(total) || total <= 0) {
    throw new RangeError(
      `audio target must yield a positive whole sample count per chunk ` +
        `(got ${total} for ${target.sampleRate} Hz x ${target.channels} ch x ${target.chunkMs} ms)`,
    );
  }
  return total;
}

/**
 * Input for every decode boundary call. The bytes are provided LAZILY via
 * `openBytes` so callers keep control of materialization; adapters may spawn
 * subprocesses against a temp file built from the provider (the bytes are
 * re-read on every call — decode calls are independent).
 */
export interface DecodeSourceInput {
  /** The ingestion receipt for the source (identity + checksum + container). */
  receipt: IngestionReceipt;
  /** The session's authorization policy (the rights gate input). */
  authorizationPolicy: AuthorizationPolicy;
  /** Lazy provider for the raw source bytes (UNTRUSTED, architecture-lock §13). */
  openBytes(): Promise<Uint8Array>;
}
