/**
 * THE HTTP DECODE PORT (R607 Gap 1 — the TL-authorized decode seam): the
 * client-side half of the `decode-probe` / `decode-frames` wire operations.
 *
 * `createHttpDecodePort` answers the shape `RealToSwmPipeline`'s injected
 * decode-port consumes (`probe` + the bounded `decodeVideo` iteration —
 * `@sporta/real-to-swm`'s `RealToSwmDecodePort`): a `DecodingService` whose
 * MECHANICAL adapter dispatches over real HTTP to the media-toolchain
 * worker. The W102 policy envelope therefore stays EXACTLY where the local
 * path keeps it — the client-side `DecodingService` (the fail-closed rights
 * gate, the byte-math output validation, the canonical decode order, the
 * cumulative decode budget) — while the wire carries only the mechanical
 * decode result as a classified envelope. The worker executes the SAME
 * `FfmpegDecoderAdapter` the local path runs, so the remote frames cannot
 * drift from the local ones.
 *
 * ## Honesty rules (the W914 client conventions, restated for this seam)
 *
 * - the dispatch carries the source bytes INLINE (base64) with the
 *   client-measured claims (sha-256 + byte length) — the worker re-measures
 *   both and refuses lying claims fail-closed;
 * - every response envelope is validated fail-loud (a worker answering a
 *   result that is not a `MediaToolchainResult` is a LYING provider — the
 *   port refuses, never trusts), and the delivered batch's byte accounting
 *   is re-measured against the envelope's own `totalBytes`;
 * - a classified failure envelope maps onto the W102 TYPED decode errors
 *   (`RightsDeniedError` / `UnsupportedMediaError` / `ResourceLimitError`)
 *   by the envelope's carried `failureClass` — the same typed classes the
 *   local path's callers see (a worker-side `ffmpeg-unavailable` maps to
 *   the local adapter's own missing-binary class `UnsupportedMediaError`,
 *   so the refusal class is identical on both paths);
 * - a TRANSPORT fault (unreachable worker, non-JSON answer, invalid
 *   envelope) throws the typed `FfmpegUnavailableError` — the W914
 *   convention: the toolchain is unavailable, the pipeline fails closed,
 *   nothing is faked and nothing is stored;
 * - the seam serves the wire profile's container rail: the media-toolchain
 *   source claims carry `container: "mp4"` (the upload path's own accepted
 *   container), so a non-mp4 receipt is refused TYPED before any dispatch
 *   (honest boundary, never a wrong-rail decode).
 */
import { ResourceLimitError, RightsDeniedError, UnsupportedMediaError } from "@sporta/decoding";
import { DecodingService } from "@sporta/decoding";
import type {
  DecodeSourceInput,
  DecodeWindow,
  NormalizedVideoFrame,
  ProbeResult,
  TrackInfo,
} from "@sporta/decoding";
import { FfmpegUnavailableError } from "./errors";
import { randomMediaId } from "./ids";
import { sha256OfBytes } from "./storage";
import { UPLOAD_CONSTRAINTS } from "./service";
import { MediaToolchainResult } from "./toolchain";
import type {
  MediaToolchainDispatchRequest as MediaToolchainDispatchRequestDoc,
  MediaToolchainFailure as MediaToolchainFailureDoc,
  MediaToolchainResult as MediaToolchainResultDoc,
} from "./toolchain";

/** Options for {@link createHttpDecodePort}. */
export interface HttpDecodePortOptions {
  /** Override fetch (tests inject; default the global). */
  fetchFn?: typeof fetch;
  /** The whole-job deadline the decode dispatches carry (default 120 000 ms). */
  deadlineMs?: number;
  /** The media policy the dispatches carry (default: the frozen R101 bound). */
  mediaPolicy?: { maxDurationMs: number };
  /** The idempotency-key prefix for generated decode jobs (default "mtdec"). */
  jobIdPrefix?: string;
  /**
   * The rights-posture policy reference the decode dispatches carry (the
   * posture itself is fail-closed: the decode references source frames, so
   * `canReferenceSourceFrames` is always `true` — a worker that would
   * execute without it is refused by its own gate).
   */
  rightsPolicyRef?: string;
}

/** The shared error-body shape of every non-2xx answer. */
interface HttpErrorBody {
  error?: { errorClass?: string; message?: string; terminal?: string };
}

/** The http decode port: a `DecodingService` over the remote adapter. */
export type HttpDecodePort = DecodingService;

/** Maps a classified failure envelope onto the W102 typed decode errors. */
function decodeFailureToError(failure: MediaToolchainFailureDoc): Error {
  switch (failure.failureClass) {
    case "rights-denied":
      return new RightsDeniedError(failure.message, { errorClass: failure.errorClass });
    case "media-invalid":
      return new UnsupportedMediaError(failure.message, { errorClass: failure.errorClass });
    case "resource-limit":
      return new ResourceLimitError(failure.message, {
        errorClass: failure.errorClass,
        terminal: failure.terminal,
      });
    case "internal":
      // The remote analog of the LOCAL adapter's own missing-binary refusal
      // (the Gap 1 hosted finding's exact class: UnsupportedMediaError with
      // a missingBinary detail) — the refusal class is identical on both
      // paths, never a faked transform.
      if (failure.errorClass === "ffmpeg-unavailable") {
        return new UnsupportedMediaError(failure.message, {
          missingBinary: "ffmpeg/ffprobe",
          errorClass: failure.errorClass,
        });
      }
      return new UnsupportedMediaError(failure.message, { errorClass: failure.errorClass });
  }
}

/** Maps a non-2xx HTTP answer onto the W102 typed decode errors. */
function decodeHttpErrorToError(status: number, body: HttpErrorBody | null): Error {
  const errorClass = body?.error?.errorClass ?? `http-${status}`;
  const message = body?.error?.message ?? `the media toolchain worker answered HTTP ${status}`;
  switch (errorClass) {
    case "capacity":
    case "source-too-large":
    case "artifact-too-large":
    case "frame-budget-exceeded":
      return new ResourceLimitError(`${errorClass}: ${message}`, { errorClass, status });
    case "rights-denied":
      return new RightsDeniedError(`${errorClass}: ${message}`, { errorClass });
    default:
      // An unrecognized refusal class or a transport-level non-2xx: the
      // honest posture is "the toolchain is unavailable", never silence.
      return new FfmpegUnavailableError(`${errorClass}: ${message}`, { status });
  }
}

/**
 * The REMOTE mechanical decoder adapter: the W102 `DecoderAdapter` seam
 * whose probe / video-decode dispatch over real HTTP. Audio decode is an
 * honest typed refusal (the R207 pipeline consumes video only; never a
 * faked audio leg).
 */
class HttpDecoderAdapter {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly deadlineMs: number;
  private readonly maxDurationMs: number;
  private readonly jobIdPrefix: string;
  private readonly rightsPolicyRef: string;

  constructor(workerUrl: string, options: HttpDecodePortOptions) {
    this.base = workerUrl.replace(/\/+$/, "");
    this.doFetch = options.fetchFn ?? fetch;
    this.deadlineMs = options.deadlineMs ?? 120_000;
    this.maxDurationMs = options.mediaPolicy?.maxDurationMs ?? UPLOAD_CONSTRAINTS.maxDurationMs;
    this.jobIdPrefix = options.jobIdPrefix ?? "mtdec";
    this.rightsPolicyRef = options.rightsPolicyRef ?? "real-to-swm/decode-pipeline";
  }

  /** Dispatches one decode operation and resolves its validated envelope. */
  private async dispatch(
    bytes: Uint8Array,
    sessionId: string,
    operation: "decode-probe" | "decode-frames",
    window?: { streamIndex: number; fromMs?: number; toMs?: number; maxTotalBytes: number },
  ): Promise<MediaToolchainResultDoc> {
    const contentHash = sha256OfBytes(bytes);
    const request: MediaToolchainDispatchRequestDoc = {
      job: {
        schemaVersion: "1.0",
        jobId: randomMediaId(this.jobIdPrefix),
        idempotencyKey: randomMediaId(`${this.jobIdPrefix}-key`),
        sessionId,
        operation,
        source: { contentHash, byteSize: bytes.byteLength, container: "mp4" },
        rights: {
          policyRef: this.rightsPolicyRef,
          canReferenceSourceFrames: true,
        },
        constraints: { deadlineMs: this.deadlineMs, priority: 0 },
        mediaPolicy: { maxDurationMs: this.maxDurationMs },
        ...(window !== undefined
          ? {
              decodeWindow: {
                streamIndex: window.streamIndex,
                ...(window.fromMs !== undefined ? { fromMs: window.fromMs } : {}),
                ...(window.toMs !== undefined ? { toMs: window.toMs } : {}),
                maxTotalBytes: window.maxTotalBytes,
              },
            }
          : {}),
      },
      source: {
        inputId: "source-media",
        kind: "source-media",
        contentBase64: Buffer.from(bytes).toString("base64"),
      },
    };
    let response: Response;
    try {
      response = await this.doFetch(`${this.base}/v1/media/jobs/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch (err) {
      throw new FfmpegUnavailableError(
        `the media toolchain worker at '${this.base}' is unreachable: ${err instanceof Error ? err.message : String(err)}`,
        { workerUrl: this.base },
      );
    }
    if (!response.ok) {
      let body: HttpErrorBody | null = null;
      try {
        body = (await response.json()) as HttpErrorBody;
      } catch {
        // keep the generic message
      }
      throw decodeHttpErrorToError(response.status, body);
    }
    let parsed: { disposition?: string; result?: unknown } | null = null;
    try {
      parsed = (await response.json()) as { disposition?: string; result?: unknown };
    } catch (err) {
      throw new FfmpegUnavailableError(
        `the media toolchain worker at '${this.base}' answered a non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
        { workerUrl: this.base },
      );
    }
    const envelope = MediaToolchainResult.safeParse(parsed?.result);
    if (!envelope.success) {
      // A lying provider: the port dead-letters it, never trusts it.
      throw new FfmpegUnavailableError(
        "invalid-envelope: the worker answered a result that is not a MediaToolchainResult: " +
          envelope.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        { workerUrl: this.base },
      );
    }
    return envelope.data;
  }

  /** The remote demux-level probe (the decode-probe operation). */
  async probe(input: DecodeSourceInput): Promise<ProbeResult> {
    if (input.receipt.container !== "mp4") {
      // The wire profile's honest container rail: the media-toolchain source
      // claims carry "mp4" (the upload path's own accepted container). A
      // non-mp4 receipt is refused TYPED before any dispatch — never a
      // wrong-rail decode, never a faked probe.
      throw new UnsupportedMediaError(
        `the http decode seam serves the mp4 container rail (the media-toolchain wire's ` +
          `source claims); the source's container is '${input.receipt.container}' — use the ` +
          `local in-process decode path for this source`,
        { container: input.receipt.container },
      );
    }
    const bytes = await input.openBytes();
    const result = await this.dispatch(bytes, input.receipt.sessionId, "decode-probe");
    if (result.status === "failed") {
      throw decodeFailureToError(result.failure!);
    }
    if (result.decodeProbe === undefined) {
      throw new UnsupportedMediaError(
        "the worker answered a succeeded decode-probe without the measured probe document",
        { workerUrl: this.base },
      );
    }
    const decodeProbe = result.decodeProbe;
    // The provider's claims are never trusted: the wire's container must
    // equal the receipt's (the dispatching side's own honest sniff).
    if (decodeProbe.container !== input.receipt.container) {
      throw new UnsupportedMediaError(
        `the worker answered a decode probe for container '${decodeProbe.container}' but the ` +
          `dispatched source's receipt says '${input.receipt.container}' — a lying claim is never interpreted`,
        { claimed: decodeProbe.container, receipt: input.receipt.container },
      );
    }
    const tracks: TrackInfo[] = decodeProbe.tracks.map((track) => ({
      trackId: track.trackId,
      streamIndex: track.streamIndex,
      kind: track.kind,
      codec: track.codec,
      ...(track.language !== undefined ? { language: track.language } : {}),
      startTimeMs: track.startTimeMs,
      durationMs: track.durationMs,
    }));
    return { tracks, container: input.receipt.container, durationMs: decodeProbe.durationMs };
  }

  /**
   * The remote bounded video decode (the decode-frames operation): ONE
   * bounded fetch for the whole window — the single-batch semantics the
   * authorized design specifies ("the R207 pipeline's decodeVideo iteration
   * becomes a single bounded fetch").
   */
  async *decodeVideo(
    input: DecodeSourceInput,
    streamIndex: number,
    window?: DecodeWindow,
  ): AsyncGenerator<NormalizedVideoFrame> {
    if (input.receipt.container !== "mp4") {
      throw new UnsupportedMediaError(
        `the http decode seam serves the mp4 container rail (the media-toolchain wire's ` +
          `source claims); the source's container is '${input.receipt.container}' — use the ` +
          `local in-process decode path for this source`,
        { container: input.receipt.container },
      );
    }
    const bytes = await input.openBytes();
    const result = await this.dispatch(
      bytes,
      input.receipt.sessionId,
      "decode-frames",
      window === undefined
        ? undefined
        : {
            streamIndex,
            ...(window.fromMs !== undefined ? { fromMs: window.fromMs } : {}),
            ...(window.toMs !== undefined ? { toMs: window.toMs } : {}),
            // The W102 default budget discipline: an absent window budget
            // rides the service's own limits.maxTotalBytes — the caller's
            // DecodingService envelope re-enforces it on the yielded frames
            // (the bounded fetch rides the pipeline's own declared budget).
            maxTotalBytes: window.maxTotalBytes ?? Number.MAX_SAFE_INTEGER,
          },
    );
    if (result.status === "failed") {
      throw decodeFailureToError(result.failure!);
    }
    if (result.decodedFrames === undefined) {
      throw new UnsupportedMediaError(
        "the worker answered a succeeded decode-frames without the measured frame batch",
        { workerUrl: this.base },
      );
    }
    const batch = result.decodedFrames;
    let measuredTotalBytes = 0;
    for (const frame of batch.frames) {
      const frameBytes = new Uint8Array(Buffer.from(frame.contentBase64, "base64"));
      // The byte-math invariant, enforced at the RECEIVING boundary (the
      // same invariant the client-side DecodingService re-checks on yield —
      // a lying frame never reaches the pipeline).
      if (frameBytes.byteLength !== frame.width * frame.height * 3) {
        throw new UnsupportedMediaError(
          `the delivered frame '${frame.frameId}' carries ${frameBytes.byteLength} bytes for ` +
            `${frame.width}x${frame.height} rgb24 (expected ${frame.width * frame.height * 3}) — ` +
            `a lying batch is never interpreted`,
          { frameId: frame.frameId, byteLength: frameBytes.byteLength },
        );
      }
      measuredTotalBytes += frameBytes.byteLength;
      yield {
        frameId: frame.frameId,
        streamIndex: frame.streamIndex,
        presentationMs: frame.presentationMs,
        decodeOrder: frame.decodeOrder,
        width: frame.width,
        height: frame.height,
        pixelFormat: "rgb24",
        bytes: frameBytes,
      };
    }
    // The batch's own accounting, re-measured (the provider's totals are
    // never trusted).
    if (measuredTotalBytes !== batch.totalBytes) {
      throw new UnsupportedMediaError(
        `the delivered frame batch measures ${measuredTotalBytes} bytes but the envelope claims ` +
          `${batch.totalBytes} — a lying claim is never interpreted`,
        { measured: measuredTotalBytes, claimed: batch.totalBytes },
      );
    }
  }

  /** Audio decode is NOT offered over this seam — the honest typed refusal. */
  decodeAudio(): AsyncIterable<never> {
    throw new UnsupportedMediaError(
      "the http decode seam does not carry the audio decode leg (the R207 pipeline consumes " +
        "video frames only) — use the local in-process decode path for audio",
      { operation: "decode-audio" },
    );
  }
}

/**
 * Creates the HTTP decode port: a `DecodingService` (the SAME W102 policy
 * envelope the local path uses — the rights gate, the byte-math validation,
 * the canonical decode order, the cumulative budget) whose mechanical
 * adapter dispatches `decode-probe`/`decode-frames` over real HTTP to the
 * media-toolchain worker. Wire it into `RealToSwmPipeline` as the injected
 * decode-port (`new RealToSwmPipeline({ decode: port })`) — the web
 * composition does exactly this when `MEDIA_TOOLCHAIN=http`.
 */
export function createHttpDecodePort(
  workerUrl: string,
  options: HttpDecodePortOptions = {},
): HttpDecodePort {
  return new DecodingService({ adapter: new HttpDecoderAdapter(workerUrl, options) });
}
