/**
 * THE INJECTED DECODE-PORT SEAM (R607 Gap 1 — the TL-AUTHORIZED decode seam).
 *
 * The R207 pipeline's FIRST ffmpeg dependency is the W102 decode boundary.
 * Before this seam, `RealToSwmPipeline` constructed
 * `new FfmpegDecoderAdapter()` DIRECTLY inside `run` — a hardwired LOCAL
 * subprocess dependency with no injection point, upstream of the media
 * platform's `MEDIA_TOOLCHAIN`-wired admission seam. That hardwiring is the
 * 62-c Gap 1 measured blocker: on a runtime without a local ffmpeg (the
 * hosted serverless plane), the upload path refuses at
 * `UnsupportedMediaError: ffprobe executable not found on PATH` BEFORE the
 * remote-wired admission ever runs (see
 * `scripts/evidence/r607-e2b-media-failover/README.md`, Gap 1).
 *
 * THE AUTHORIZED DESIGN (the 62-c record, integrated here): the composition
 * change is ONE seam — `RealToSwmPipeline` accepts an injected decode-port
 * (the same options-injection discipline the repo uses everywhere else),
 * and the web composition wires the http decode executor when
 * `MEDIA_TOOLCHAIN=http`. The port's interface mirrors EXACTLY what the
 * pipeline consumes from the local `DecodingService`/`FfmpegDecoderAdapter`
 * composition: the demux-level probe document (`ProbeResult`) and the
 * bounded video-frame iteration (`AsyncIterable<NormalizedVideoFrame>` over
 * a `DecodeWindow`).
 *
 * THE NON-DEGRADATION LAW: when NO port is injected (the default — every
 * existing caller), the pipeline constructs its own
 * `new DecodingService({ adapter: new FfmpegDecoderAdapter() })` exactly as
 * before — the LOCAL in-process path stays byte-identical (the same
 * objects, the same typed refusals, the same measured probes). The remote
 * port is strictly OPT-IN via composition.
 *
 * The port implementor owns the W102 typed-error discipline: refusals
 * surface as the `@sporta/decoding` typed errors (`RightsDeniedError`,
 * `UnsupportedMediaError`, `ResourceLimitError`) or an honest typed
 * transport refusal — never a faked probe, never fake frames.
 */
import type {
  DecodeSourceInput,
  DecodeWindow,
  NormalizedVideoFrame,
  ProbeResult,
} from "@sporta/decoding";

/**
 * The decode-port seam: the EXACT surface `RealToSwmPipeline` consumes from
 * the W102 boundary. `DecodingService` satisfies this structurally (the
 * local default), and the media platform's http decode port
 * (`createHttpDecodePort`) satisfies it remotely — the pipeline's decode
 * stage code is unchanged behind either.
 */
export interface RealToSwmDecodePort {
  /**
   * Demux-level inspection of the source (the W102 probe): the
   * video/audio track inventory, the container family, and the whole-source
   * duration — the document the pipeline selects its video track from.
   */
  probe(input: DecodeSourceInput): Promise<ProbeResult>;

  /**
   * Decodes one video stream into normalized rgb24 frames honoring the
   * `[fromMs, toMs)` window and the cumulative byte budget
   * (`maxTotalBytes`) — the bounded iteration the pipeline consumes.
   */
  decodeVideo(
    input: DecodeSourceInput,
    streamIndex: number,
    window?: DecodeWindow,
  ): AsyncIterable<NormalizedVideoFrame>;
}

/** Options for {@link RealToSwmPipeline} (the options-injection discipline). */
export interface RealToSwmPipelineOptions {
  /**
   * The injected decode-port (R607 Gap 1). ABSENT (the default) → the
   * pipeline constructs its own LOCAL
   * `DecodingService` over `FfmpegDecoderAdapter` — byte-identical to the
   * pre-seam behavior (the non-degradation law). PRESENT → the pipeline
   * routes its probe + frame iteration through the port (the web
   * composition wires the http decode executor when
   * `MEDIA_TOOLCHAIN=http`).
   */
  readonly decode?: RealToSwmDecodePort;
}
