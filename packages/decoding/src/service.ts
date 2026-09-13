/**
 * `DecodingService` — the adapter-agnostic policy envelope for W102.
 *
 * EVERY policy decision at the decode boundary lives here, never in the
 * adapters (they stay mechanical):
 *
 * 1. **Rights gate first, fail closed** (architecture-lock §11): every
 *    method re-asserts `analysis` authorization via the session package's
 *    canonical `assertAuthorized` — defense in depth, since ingestion
 *    already gated the same policy. A denial throws `RightsDeniedError`
 *    BEFORE any adapter call, so an unauthorized caller learns nothing about
 *    the media.
 * 2. **Track bound** (§13): `probe` refuses more than `maxTracks` tracks.
 * 3. **Output validation**: decoder output is attacker-controlled (§13), so
 *    the service enforces the normalized-representation invariants — frame
 *    `bytes.byteLength === width * height * 3` (and `pixelFormat ===
 *    "rgb24"`, integer positive geometry), audio chunks matching the
 *    requested target with a sample count that is a whole number of
 *    interleaved sample frames and at most one full chunk. A violation means
 *    the adapter/decoder lied or the media is corrupt → `media-invalid`.
 * 4. **Resource bounds**: per-item limits (`maxFrameBytes`,
 *    `maxChunkSamples`) and the running per-call byte budget
 *    (`window.maxTotalBytes ?? limits.maxTotalBytes`) → `resource-limit`,
 *    thrown INSIDE the wrapper generator so the iteration terminates.
 * 5. **Canonical decode order**: the service re-assigns `decodeOrder`
 *    monotonically from 0 on every video decode call, whatever the adapter
 *    produced.
 * 6. **Observability** (§12): one structured info log line per call at
 *    completion (stage `"decode"`, sessionId + streamIndex + item count), a
 *    warn line on every classified refusal, and metrics counters
 *    (`decode_frames_total`, `decode_audio_chunks_total`,
 *    `decode_bytes_total`, `decode_failures_total` with a per-failure-class
 *    label). Absent observability objects become silent no-ops.
 *
 * Clock injection: `nowMs` (constructor option, default 0 — the repo-wide
 * deterministic-test rule) is the evaluation time for the rights-expiry
 * leg. With the default 0 the expiry leg is inert, exactly as in W101
 * ingestion; production callers MUST inject a real clock.
 */
import type { CorrelationContext, Logger } from "@sporta/observability";
import { MetricsRegistry, bindLogger, createLogger } from "@sporta/observability";
import { assertAuthorized, RightsDeniedError as SessionRightsDeniedError } from "@sporta/session";
import type { AuthorizationPolicy } from "@sporta/contracts";
import { DEFAULT_DECODE_LIMITS } from "./limits";
import type { DecodeLimits } from "./limits";
import {
  isDecodeError,
  ResourceLimitError,
  RightsDeniedError,
  UnsupportedMediaError,
} from "./errors";
import type { DecodeError } from "./errors";
import type { DecoderAdapter } from "./decoder";
import { DEFAULT_AUDIO_TARGET, samplesPerChunk } from "./types";
import type {
  AudioTarget,
  DecodeSourceInput,
  DecodeWindow,
  NormalizedAudioChunk,
  NormalizedVideoFrame,
  ProbeResult,
} from "./types";

/** Log/metric stage name for every record emitted by this boundary. */
const DECODE_STAGE = "decode";

/** Label key carrying the terminal failure class on refusal counters. */
const FAILURE_CLASS_LABEL = "failure_class";

/** Metric names emitted by the decoding boundary (see METRIC_NAMES pattern). */
export const DECODE_METRIC_NAMES = {
  /** Counter bumped once per yielded normalized video frame. */
  framesTotal: "decode_frames_total",
  /** Counter bumped once per yielded normalized audio chunk. */
  audioChunksTotal: "decode_audio_chunks_total",
  /** Counter bumped by the byte size of every yielded item (video + audio). */
  bytesTotal: "decode_bytes_total",
  /** Counter bumped once per classified decode refusal (probe or decode). */
  failuresTotal: "decode_failures_total",
} as const;

/** Observability seams for the service; every field is optional. */
export interface DecodingObservability {
  /** Structured logger from `@sporta/observability` (default: silent no-op). */
  logger?: Logger;
  /** Metrics registry (default: private silent registry). */
  metrics?: MetricsRegistry;
  /** Correlation context bound onto every log line when provided. */
  correlation?: CorrelationContext;
}

/** Options for {@link DecodingService}. */
export interface DecodingServiceOptions {
  /** The mechanical decoder adapter this service wraps. */
  adapter: DecoderAdapter;
  /** Decode resource bounds (default: {@link DEFAULT_DECODE_LIMITS}). */
  limits?: DecodeLimits;
  /** Observability seams (default: silent no-ops). */
  observability?: DecodingObservability;
  /**
   * Evaluation time (epoch milliseconds) for the rights-expiry check.
   * Defaults to 0 so tests stay deterministic (the repo-wide
   * clock-injection rule); production callers MUST inject a real clock.
   */
  nowMs?: number;
}

/**
 * The decoding boundary service: wraps a {@link DecoderAdapter} with the
 * fail-closed rights gate, resource bounds, normalized-output validation,
 * canonical decode order, and the observability contract. Adapter-agnostic
 * — the ffmpeg adapter and the pure-TS fixture adapter are interchangeable
 * behind it.
 */
export class DecodingService {
  private readonly adapter: DecoderAdapter;
  private readonly limits: DecodeLimits;
  private readonly logger: Logger;
  private readonly metrics: MetricsRegistry;
  private readonly correlation: CorrelationContext | undefined;
  private readonly nowMs: number;

  constructor(options: DecodingServiceOptions) {
    this.adapter = options.adapter;
    this.limits = options.limits ?? DEFAULT_DECODE_LIMITS;
    const noop = noopObservability();
    this.logger = options.observability?.logger ?? noop.logger;
    this.metrics = options.observability?.metrics ?? noop.metrics;
    this.correlation = options.observability?.correlation;
    this.nowMs = options.nowMs ?? 0;
  }

  /**
   * Demux-level probe: rights gate first (fail closed, before any adapter
   * call), then the adapter probe, then the `maxTracks` bound.
   */
  async probe(input: DecodeSourceInput): Promise<ProbeResult> {
    const logger = this.stageLogger(input);
    try {
      this.gateRights(input.authorizationPolicy);
      const result = await this.adapter.probe(input);
      if (result.tracks.length > this.limits.maxTracks) {
        throw new ResourceLimitError(
          `probe reported more tracks than the decode limit allows: ` +
            `${result.tracks.length} > maxTracks ${this.limits.maxTracks}`,
          { trackCount: result.tracks.length, maxTracks: this.limits.maxTracks },
        );
      }
      logger.info("decode probed", {
        trackCount: result.tracks.length,
        durationMs: result.durationMs,
        container: result.container,
      });
      return result;
    } catch (err) {
      this.reportFailureIfClassified(logger, err);
      throw err;
    }
  }

  /**
   * Decodes one video stream: rights gate first, then the adapter iterable
   * wrapped with byte-math validation, per-item and budget limits, and
   * canonical `decodeOrder` reassignment (monotonic from 0). One info line
   * at completion; a warn line + failure counters on any classified refusal.
   */
  decodeVideo(
    input: DecodeSourceInput,
    streamIndex: number,
    window?: DecodeWindow,
  ): AsyncGenerator<NormalizedVideoFrame> {
    return this.runVideoDecode(input, streamIndex, window);
  }

  /**
   * Decodes one audio stream to `target` (default: the canonical 48 kHz
   * stereo / 250 ms target): rights gate first, then the adapter iterable
   * wrapped with target/sample-math validation, per-item and budget limits.
   * One info line at completion; a warn line + failure counters on any
   * classified refusal.
   */
  decodeAudio(
    input: DecodeSourceInput,
    streamIndex: number,
    window?: DecodeWindow,
    target?: AudioTarget,
  ): AsyncGenerator<NormalizedAudioChunk> {
    return this.runAudioDecode(input, streamIndex, window, target);
  }

  // --- internals ----------------------------------------------------------

  /**
   * Video wrapper generator. The rights gate runs inside the generator body,
   * i.e. on the first `next()` — BEFORE the adapter iterable is even
   * created. (`async` generators only execute when consumed, so constructing
   * the return value is free and side-effect free.)
   */
  private async *runVideoDecode(
    input: DecodeSourceInput,
    streamIndex: number,
    window: DecodeWindow | undefined,
  ): AsyncGenerator<NormalizedVideoFrame> {
    const logger = this.stageLogger(input);
    let items = 0;
    let totalBytes = 0;
    try {
      this.gateRights(input.authorizationPolicy);

      const budget = window?.maxTotalBytes ?? this.limits.maxTotalBytes;
      for await (const frame of this.adapter.decodeVideo(input, streamIndex, window)) {
        const frameBytes = this.validateVideoFrame(frame, streamIndex);
        totalBytes += frameBytes;
        this.enforceBudget(totalBytes, budget);
        items += 1;
        this.countItem(DECODE_METRIC_NAMES.framesTotal, frameBytes);
        yield { ...frame, decodeOrder: items - 1 };
      }

      logger.info("decode video complete", {
        streamIndex,
        items,
        bytes: totalBytes,
        ...(window !== undefined ? { window } : {}),
      });
    } catch (err) {
      this.reportFailureIfClassified(logger, err);
      throw err;
    }
  }

  /** Audio wrapper generator — same structure as the video one. */
  private async *runAudioDecode(
    input: DecodeSourceInput,
    streamIndex: number,
    window: DecodeWindow | undefined,
    target: AudioTarget | undefined,
  ): AsyncGenerator<NormalizedAudioChunk> {
    const logger = this.stageLogger(input);
    let items = 0;
    let totalBytes = 0;
    try {
      this.gateRights(input.authorizationPolicy);

      const audioTarget = target ?? DEFAULT_AUDIO_TARGET;
      const budget = window?.maxTotalBytes ?? this.limits.maxTotalBytes;
      for await (const chunk of this.adapter.decodeAudio(input, streamIndex, window, audioTarget)) {
        const chunkBytes = this.validateAudioChunk(chunk, streamIndex, audioTarget);
        totalBytes += chunkBytes;
        this.enforceBudget(totalBytes, budget);
        items += 1;
        this.countItem(DECODE_METRIC_NAMES.audioChunksTotal, chunkBytes);
        yield chunk;
      }

      logger.info("decode audio complete", {
        streamIndex,
        items,
        bytes: totalBytes,
        ...(window !== undefined ? { window } : {}),
      });
    } catch (err) {
      this.reportFailureIfClassified(logger, err);
      throw err;
    }
  }

  /** Fail-closed rights gate: deny → `RightsDeniedError`, before any adapter work. */
  private gateRights(policy: AuthorizationPolicy): void {
    try {
      assertAuthorized(policy, "analysis", new Date(this.nowMs));
    } catch (err) {
      if (err instanceof SessionRightsDeniedError) {
        throw new RightsDeniedError(err.message, {
          reason: err.reason,
          requiredOperation: err.requiredOperation,
          ...(err.policyId !== undefined ? { policyId: err.policyId } : {}),
        });
      }
      throw err;
    }
  }

  /**
   * Validates one normalized video frame against the rgb24 byte-math
   * invariant (a corrupt/lying decoder output is `media-invalid`), then the
   * per-frame byte limit (`resource-limit`). Returns the frame byte count.
   */
  private validateVideoFrame(frame: NormalizedVideoFrame, streamIndex: number): number {
    const { width, height, bytes, pixelFormat } = frame;
    if (
      pixelFormat !== "rgb24" ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new UnsupportedMediaError(
        "decoded frame does not carry valid rgb24 geometry (width/height/pixelFormat)",
        { streamIndex, width, height, pixelFormat },
      );
    }
    const expected = width * height * 3;
    if (bytes.byteLength !== expected) {
      throw new UnsupportedMediaError(
        `decoded frame byte count does not match rgb24 geometry: ` +
          `${bytes.byteLength} bytes for ${width}x${height} (expected ${expected})`,
        { streamIndex, width, height, byteLength: bytes.byteLength, expected },
      );
    }
    if (bytes.byteLength > this.limits.maxFrameBytes) {
      throw new ResourceLimitError(
        `decoded frame exceeds the per-frame byte limit: ${bytes.byteLength} > ` +
          `maxFrameBytes ${this.limits.maxFrameBytes}`,
        { streamIndex, byteLength: bytes.byteLength, maxFrameBytes: this.limits.maxFrameBytes },
      );
    }
    return bytes.byteLength;
  }

  /**
   * Validates one normalized audio chunk against the requested target and
   * the interleaved sample-math invariant (a corrupt/lying decoder output is
   * `media-invalid`), then the per-chunk sample limit (`resource-limit`).
   * The FINAL chunk of a stream may legitimately be shorter than a full
   * chunk, so the invariant enforced is: `0 < samples.length <= full chunk`
   * and a whole number of sample frames. Returns the chunk byte count.
   */
  private validateAudioChunk(
    chunk: NormalizedAudioChunk,
    streamIndex: number,
    target: AudioTarget,
  ): number {
    if (chunk.sampleRate !== target.sampleRate || chunk.channels !== target.channels) {
      throw new UnsupportedMediaError("decoded audio chunk does not match the requested target", {
        streamIndex,
        chunkSampleRate: chunk.sampleRate,
        chunkChannels: chunk.channels,
        targetSampleRate: target.sampleRate,
        targetChannels: target.channels,
      });
    }
    const full = samplesPerChunk(target);
    const length = chunk.samples.length;
    if (length <= 0 || length > full || length % target.channels !== 0) {
      throw new UnsupportedMediaError(
        `decoded audio chunk sample count is not a whole number of interleaved ` +
          `sample frames within one chunk: ${length} samples (full chunk: ${full}, ` +
          `channels: ${target.channels})`,
        { streamIndex, sampleCount: length, fullChunkSamples: full, channels: target.channels },
      );
    }
    if (length > this.limits.maxChunkSamples) {
      throw new ResourceLimitError(
        `decoded audio chunk exceeds the per-chunk sample limit: ${length} > ` +
          `maxChunkSamples ${this.limits.maxChunkSamples}`,
        { streamIndex, sampleCount: length, maxChunkSamples: this.limits.maxChunkSamples },
      );
    }
    return chunk.samples.byteLength;
  }

  /** Throws `ResourceLimitError` when the running budget is exhausted. */
  private enforceBudget(totalBytes: number, budget: number): void {
    if (totalBytes > budget) {
      throw new ResourceLimitError(
        `decode exceeded the cumulative byte budget: ${totalBytes} > ${budget} bytes ` +
          `(decoder output volume is attacker-controlled — terminating)`,
        { totalBytes, budget },
      );
    }
  }

  /** Bumps the item counter and the shared byte counter by `byteLength`. */
  private countItem(counterName: string, byteLength: number): void {
    this.metrics.counter(counterName).inc();
    this.metrics.counter(DECODE_METRIC_NAMES.bytesTotal).inc(byteLength);
  }

  /** Binds sessionId + stage (and correlation, when provided) onto a child logger. */
  private stageLogger(input: DecodeSourceInput): Logger {
    if (this.correlation !== undefined) {
      return bindLogger(this.logger, this.correlation, DECODE_STAGE);
    }
    return this.logger.child({ sessionId: input.receipt.sessionId, stage: DECODE_STAGE });
  }

  /**
   * One structured warn line + refusal counters per classified decode error.
   * Non-decoding errors (internal faults) propagate untouched — they are not
   * decode decisions and classify as `internal` downstream.
   */
  private reportFailureIfClassified(logger: Logger, err: unknown): void {
    if (!isDecodeError(err)) return;
    const decodeError = err as DecodeError;
    logger.warn("decode refused", {
      failureClass: decodeError.terminalFailureClass,
      error: decodeError.message,
      ...decodeError.details,
    });
    this.metrics.counter(DECODE_METRIC_NAMES.failuresTotal).inc();
    this.metrics
      .counter(DECODE_METRIC_NAMES.failuresTotal, {
        [FAILURE_CLASS_LABEL]: decodeError.terminalFailureClass,
      })
      .inc();
  }
}

/**
 * Silent no-op observability defaults used when a caller provides none: a
 * logger that emits nothing (level filter above warn, no-op sink) and a
 * fresh in-memory metrics registry nobody reads. Mirrors the W101 ingestion
 * `noopObservability` (kept local so this package owns its seams).
 */
export function noopObservability(): { logger: Logger; metrics: MetricsRegistry } {
  return {
    logger: createLogger({ minLevel: "error", sink: () => {} }),
    metrics: new MetricsRegistry(),
  };
}
