/**
 * @sporta/decoding — demux/decode normalization (W102).
 *
 * The second boundary of the Sporta pipeline: ingested, authorized sources
 * in; normalized video frames and audio chunks on the canonical media
 * timeline out. Consumes the W101 ingestion receipts, the W004 session
 * rights gate (fail-closed `assertAuthorized`, re-checked as defense in
 * depth), and the W007 observability seams. Module map:
 *
 * - `types`: the normalized representations (`NormalizedVideoFrame`,
 *   `NormalizedAudioChunk`, `ProbeResult`, …) plus the canonical
 *   `DEFAULT_AUDIO_TARGET` (48 kHz stereo / 250 ms);
 * - `limits`: the `DecodeLimits` resource bounds + frozen defaults
 *   (architecture-lock §13 — decoder output byte volume is
 *   attacker-controlled);
 * - `errors`: typed decode errors carrying the contracts
 *   `terminalFailureClass` (`rights-denied` / `media-invalid` /
 *   `resource-limit`) plus structured `details` (stderr excerpts are bounded
 *   to the last 2000 chars);
 * - `decoder`: the `DecoderAdapter` seam — mechanical adapters only;
 * - `service`: `DecodingService` — the adapter-agnostic envelope where ALL
 *   policy lives (rights gate, track/byte/sample limits, output validation,
 *   canonical decode order, log line + metrics counters per call);
 * - `fixture/adapter`: `FixtureDecoderAdapter` — pure-TS, deterministic,
 *   zero-I/O test substrate;
 * - `ffmpeg/adapter`: `FfmpegDecoderAdapter` — ffmpeg/ffprobe via
 *   `Bun.spawn` subprocess only (never an npm dependency).
 */
export { DEFAULT_AUDIO_TARGET, samplesPerChunk } from "./types";
export type {
  AudioTarget,
  DecodeSourceInput,
  DecodeWindow,
  MediaTrackKind,
  NormalizedAudioChunk,
  NormalizedVideoFrame,
  ProbeResult,
  TrackInfo,
} from "./types";
export { DEFAULT_DECODE_LIMITS } from "./limits";
export type { DecodeLimits } from "./limits";
export {
  STDERR_TAIL_LIMIT,
  isDecodeError,
  ResourceLimitError,
  RightsDeniedError,
  stderrTail,
  UnsupportedMediaError,
} from "./errors";
export type { DecodeError, DecodeErrorDetails } from "./errors";
export type { DecoderAdapter } from "./decoder";
export { DECODE_METRIC_NAMES, DecodingService, noopObservability } from "./service";
export type { DecodingObservability, DecodingServiceOptions } from "./service";
export { FixtureDecoderAdapter } from "./fixture/adapter";
export type { FixtureAudioSpec, FixtureMediaSpec, FixtureVideoSpec } from "./fixture/adapter";
export { FfmpegDecoderAdapter } from "./ffmpeg/adapter";
export type { FfmpegAvailability, FfmpegDecoderAdapterOptions } from "./ffmpeg/adapter";
