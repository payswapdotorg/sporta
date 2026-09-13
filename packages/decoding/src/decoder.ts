/**
 * The decoder adapter seam (W102).
 *
 * A `DecoderAdapter` is the MECHANICAL bridge to demux/decode technology
 * (ffmpeg subprocess, in-process fixture, …). It contains NO policy: no
 * rights gate, no resource bounds, no validation of normalized output. ALL
 * policy lives in `DecodingService`, which wraps every adapter — adapters
 * stay dumb and swappable (vendor-neutrality, architecture-lock §9: provider
 * adapters behind stable interfaces).
 */
import type {
  AudioTarget,
  DecodeSourceInput,
  DecodeWindow,
  NormalizedAudioChunk,
  NormalizedVideoFrame,
  ProbeResult,
} from "./types";

/**
 * The demux/decode seam. Implementations MUST be side-effect-bounded to
 * their input (temp files, subprocesses) and MUST NOT enforce policy — the
 * `DecodingService` envelope owns rights, limits, and output validation.
 */
export interface DecoderAdapter {
  /**
   * Demux-level inspection: list the video/audio tracks, container, and
   * duration. Data/subtitle/attachment streams are skipped. Does not decode
   * sample data.
   */
  probe(input: DecodeSourceInput): Promise<ProbeResult>;

  /**
   * Decode one video stream into normalized rgb24 frames, honoring the
   * `[fromMs, toMs)` window. Items are yielded in decode order; the service
   * assigns the canonical `decodeOrder` on top.
   */
  decodeVideo(
    input: DecodeSourceInput,
    streamIndex: number,
    window?: DecodeWindow,
  ): AsyncIterable<NormalizedVideoFrame>;

  /**
   * Decode one audio stream into normalized interleaved float32 chunks at
   * `target` (default: the canonical 48 kHz stereo / 250 ms target), honoring
   * the `[fromMs, toMs)` window.
   */
  decodeAudio(
    input: DecodeSourceInput,
    streamIndex: number,
    window?: DecodeWindow,
    target?: AudioTarget,
  ): AsyncIterable<NormalizedAudioChunk>;
}
