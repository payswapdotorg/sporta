/**
 * THE HTTP ENCODE PORT PAIR (R306 — the TL-authorized encode seam): the
 * client-side half of the `encode-frames` wire operation, answering BOTH
 * encode surfaces the derived-reality plane probes locally today:
 *
 * - the R306 `FrameEncoderPort` (`@sporta/encoding` — the game-3d /
 *   anime-npr bridges' encoder, `FrameEncodeRequest` → `FrameEncodeResult`);
 * - the R301 `TacticalVideoCodec` (`@sporta/renderer-tactical` — the
 *   tactical renderer's own codec, `EncodeFramesRequest` → MP4 `Buffer`).
 *
 * Both interfaces are SYNCHRONOUS by frozen contract (the W501 conformance
 * harness / tactical precedent), so the remote dispatch is bridged through
 * a BOUNDED SYNCHRONOUS subprocess transport: one `spawnSync` child of the
 * CURRENT runtime (`process.execPath` — bun under bun, node under node)
 * that reads the request JSON off stdin, performs the fetch, and prints
 * `STATUS <n>\n<body>` on stdout — the exact subprocess discipline the real
 * ffmpeg adapters use (`maxBuffer` capped at 256 MiB, a `timeout` bound
 * with `SIGKILL`, honest exit codes). MEASURED LIMITATION (bun 1.3.14, the
 * r306 evidence `runtimeKillDiscipline`): bun's `spawnSync` timeout does
 * NOT kill the child — a child that outlives the bound is reaped only at
 * its own exit (the typed `encode-failed` refusal still surfaces; the wall
 * clock is the child's lifetime), while under node v24 the bound holds
 * exactly (SIGKILL at the bound). The seam's fail-closed contract — typed
 * refusals, no interpreted answer, no fabricated artifact — holds under
 * BOTH runtimes; only the wall-clock sub-contract is runtime-dependent
 * (reported, never laundered). Tests inject the
 * `transport` seam (the `fetchFn` precedent of the decode seam); the REAL
 * worker round trip lives in `@sporta/compute-adapter-hosted`'s battery,
 * which drives this pair against ITS worker executing real ffmpeg.
 *
 * ## Honesty rules (the W914 client conventions, restated for this seam)
 *
 * - the dispatch carries the packed rgb24 frame sequence INLINE (base64)
 *   with the client-measured claims (sha-256 + byte length) — the worker
 *   re-measures both and refuses lying claims fail-closed;
 * - the mechanical encode executes at the worker through the SAME
 *   `FfmpegFrameEncoder` the local path runs (the exact pinned argv, the
 *   exact determinism knobs), so the remote bytes cannot drift from the
 *   local encodes — the client NEVER re-implements the encode;
 * - every response envelope is validated fail-loud (a worker answering a
 *   result that is not a `MediaToolchainResult` is a LYING provider — the
 *   port refuses, never trusts);
 * - the delivered bytes are RE-HASHED and RE-MEASURED at the receiving
 *   boundary: the sha-256, the byte length, the geometry, the frame count,
 *   the fps, and the MP4 container magic (`ftyp`) are re-measured against
 *   the envelope's own claims — a lying claim is a typed refusal, never a
 *   fabricated artifact (the manifest builder re-verifies the hash AGAIN
 *   downstream — belt and suspenders);
 * - a classified failure envelope maps onto the ENCODING plane's TYPED
 *   errors (`EncodingError`) by the envelope's carried `failureClass`
 *   (the tactical codec maps the same failures onto its own
 *   `TacticalCodecError` — its frozen error family);
 * - a TRANSPORT fault (unreachable worker, non-JSON answer, invalid
 *   envelope, a killed child) is the typed `encoder-unavailable` class
 *   (`EncodingError` with kind `encoder-unavailable` — the SAME class the
 *   local adapter's missing-binary refusal produces) or the bounded-kill
 *   `encode-failed` class: the toolchain is unavailable, the pipeline
 *   fails closed, nothing is faked and nothing is stored;
 * - `available()`/`version()` answer the WORKER'S OWN honest descriptor
 *   (one bounded sync probe, cached): the pair is available iff the worker
 *   resolved its toolchain AND advertises the `encode-frames` operation —
 *   the same resolution-honesty posture the local factories'
 *   null-returning probes encode.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { EncodingError } from "@sporta/encoding";
import type {
  EncodedCodecParams,
  FrameEncodeRequest,
  FrameEncodeResult,
  FrameEncoderPort,
} from "@sporta/encoding";
import { TacticalCodecError } from "@sporta/renderer-tactical";
import type { EncodeFramesRequest, TacticalVideoCodec } from "@sporta/renderer-tactical";
import { randomMediaId } from "./ids";
import { sha256OfBytes } from "./storage";
import { UPLOAD_CONSTRAINTS } from "./service";
import { MediaToolchainDescriptor, MediaToolchainResult } from "./toolchain";
import type {
  MediaToolchainDescriptor as MediaToolchainDescriptorDoc,
  MediaToolchainDispatchRequest as MediaToolchainDispatchRequestDoc,
  MediaToolchainFailure as MediaToolchainFailureDoc,
} from "./toolchain";

// ---------------------------------------------------------------------------
// The synchronous transport (the frozen sync interfaces' async-wire bridge)
// ---------------------------------------------------------------------------

/** One synchronous HTTP answer: the status line + the raw body text. */
export interface SyncHttpAnswer {
  /** The HTTP status code the worker answered. */
  status: number;
  /** The raw response body text (JSON for this profile's routes). */
  body: string;
}

/** The request intent of one synchronous transport call. */
export interface SyncHttpInit {
  /** The HTTP method (the two methods this profile's routes serve). */
  method: "GET" | "POST";
  /** The request body (POST only; the JSON wire documents). */
  body?: string;
}

/**
 * The synchronous transport seam: performs ONE HTTP request per call. The
 * default is the bounded `spawnSync` child bridge (see module docs); tests
 * inject a controlled fake (the `fetchFn` precedent).
 */
export type SyncHttpTransport = (
  url: string,
  init: SyncHttpInit,
  bounds: { timeoutMs: number },
) => SyncHttpAnswer;

/** The bounded stdio capture cap (the ffmpeg adapters' own 256 MiB). */
const MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/**
 * The child transport script: reads the request body off stdin (iff any),
 * performs the HTTP request (method + URL from `argv[1]`/`argv[2]` — the
 * `-e` evaluation contract both runtimes share), and prints
 * `STATUS <n>\n` + the response body on stdout. Runtime-agnostic (bun and
 * node both: global `fetch`, stdin/stdout streams).
 */
const TRANSPORT_CHILD_SCRIPT = `
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const body = Buffer.concat(chunks);
  fetch(process.argv[2], {
    method: process.argv[1],
    headers: body.length === 0 ? {} : { "content-type": "application/json" },
    body: body.length === 0 ? undefined : body.toString("utf8"),
  })
    .then(async (r) => {
      const text = await r.text();
      process.stdout.write("STATUS " + r.status + "\\n" + text);
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(String(err && err.message ? err.message : err));
      process.exit(3);
    });
});
`;

/**
 * The DEFAULT synchronous transport: one bounded child of the CURRENT
 * runtime binary performing the fetch (the module docs' bridge). The child
 * reads the whole request off stdin BEFORE writing any stdout (no
 * pipe deadlock possible); the parent's `maxBuffer` caps the captured
 * answer; the `timeout` + `SIGKILL` bound reaps a hung child by the
 * synchronous contract — EXACTLY under node (measured), while under bun
 * 1.3.14 the kill defers to the child's own exit and the typed refusal
 * still surfaces (the module docs' MEASURED LIMITATION; the fail-closed
 * contract is runtime-independent).
 */
export function childProcessSyncTransport(
  url: string,
  init: SyncHttpInit,
  bounds: { timeoutMs: number },
): SyncHttpAnswer {
  const run = spawnSync(process.execPath, ["-e", TRANSPORT_CHILD_SCRIPT, init.method, url], {
    input: init.body ?? "",
    encoding: "utf8",
    maxBuffer: MAX_BUFFER_BYTES,
    timeout: bounds.timeoutMs,
    killSignal: "SIGKILL",
  });
  if (run.error !== undefined) {
    const timedOut = /ETIMEDOUT/.test(run.error.message);
    throw new EncodingError(
      timedOut ? "internal" : "resource-limit",
      timedOut ? "encode-failed" : "encoder-unavailable",
      timedOut
        ? `the http dispatch to '${url}' exceeded its ${bounds.timeoutMs} ms bound — the dispatch is refused, no artifact was produced (under node the child is SIGKILLed at the bound; under bun 1.3.14 the refusal surfaces at the child's own exit — the measured limitation, module docs)`
        : `the http transport child could not run: ${run.error.message}`,
      { url, timeoutMs: bounds.timeoutMs, cause: String(run.error) },
    );
  }
  if (run.signal !== null && run.signal !== undefined) {
    throw new EncodingError(
      "internal",
      "encode-failed",
      `the http transport child was killed by signal ${String(run.signal)} (bound: timeout ${bounds.timeoutMs} ms) — no artifact was produced`,
      { url, signal: String(run.signal), timeoutMs: bounds.timeoutMs },
    );
  }
  if (run.status === 3) {
    throw new EncodingError(
      "resource-limit",
      "encoder-unavailable",
      `the media toolchain worker at '${url}' is unreachable: ${(run.stderr ?? "").slice(0, 300)}`,
      { url, childExit: run.status },
    );
  }
  if (run.status !== 0) {
    throw new EncodingError(
      "internal",
      "encode-failed",
      `the http transport child exited with status ${String(run.status)} — no artifact was produced`,
      { url, childExit: run.status, stderr: (run.stderr ?? "").slice(0, 300) },
    );
  }
  const out = run.stdout ?? "";
  const newline = out.indexOf("\n");
  const header = newline === -1 ? out : out.slice(0, newline);
  const statusMatch = /^STATUS (\d+)$/.exec(header.trim());
  if (statusMatch === null) {
    throw new EncodingError(
      "internal",
      "encode-failed",
      `the http transport child answered a malformed transport header '${header.slice(0, 40)}' — no artifact was produced`,
      { url, header: header.slice(0, 80) },
    );
  }
  return { status: Number(statusMatch[1]), body: newline === -1 ? "" : out.slice(newline + 1) };
}

// ---------------------------------------------------------------------------
// Options + the typed error mapping
// ---------------------------------------------------------------------------

/** Options for {@link createHttpEncodePair}. */
export interface HttpEncodePairOptions {
  /**
   * The synchronous transport (tests inject; default: the bounded
   * `spawnSync` child bridge — see module docs).
   */
  transport?: SyncHttpTransport;
  /** The whole-job deadline the encode dispatches carry (default 120 000 ms). */
  deadlineMs?: number;
  /** The media policy the encode dispatches carry (default: the frozen R101 bound). */
  mediaPolicy?: { maxDurationMs: number };
  /** The idempotency-key prefix for generated encode jobs (default "mtenc"). */
  jobIdPrefix?: string;
  /** The bounded timeout of the availability descriptor probe (default 10 000 ms). */
  probeTimeoutMs?: number;
  /**
   * The rights-posture policy reference the encode dispatches carry (the
   * posture itself is fail-closed: the encode references the dispatch's own
   * carried frames, so `canReferenceSourceFrames` is always `true` — a
   * worker that would execute without it is refused by its own gate).
   */
  rightsPolicyRef?: string;
}

/** The shared error-body shape of every non-2xx answer. */
interface HttpErrorBody {
  error?: { errorClass?: string; message?: string; terminal?: string };
}

/** The identity of the http frame encoder's seam (logs/manifests never use it for the produced bytes). */
const HTTP_FRAME_ENCODER_KIND = "http-toolchain-frame-encoder";

/** The identity of the http tactical codec's seam. */
const HTTP_TACTICAL_CODEC_KIND = "http-toolchain-h264-codec";

/**
 * Maps a classified failure envelope onto the ENCODING plane's typed
 * errors (the same classes the local path's callers see):
 * - the admission axis (`frames-invalid`) → `media-invalid`/`frames-invalid`
 *   (the LOCAL adapter's own admission class);
 * - the boundary class (`ffmpeg-unavailable`) → `resource-limit`/
 *   `encoder-unavailable` (the LOCAL adapter's own missing-binary class);
 * - the budget axis (resource-limit) → `resource-limit`/`encode-failed`;
 * - everything else → the encode-failure axis, carrying the envelope's
 *   own failureClass honestly.
 */
function encodeFailureToError(failure: MediaToolchainFailureDoc): EncodingError {
  if (failure.errorClass === "ffmpeg-unavailable" || failure.errorClass === "capacity") {
    return new EncodingError("resource-limit", "encoder-unavailable", failure.message, {
      errorClass: failure.errorClass,
      terminal: failure.terminal,
    });
  }
  if (failure.errorClass === "frames-invalid" || failure.errorClass === "duration-over-limit") {
    return new EncodingError("media-invalid", "frames-invalid", failure.message, {
      errorClass: failure.errorClass,
    });
  }
  const failureClass =
    failure.failureClass === "media-invalid" || failure.failureClass === "resource-limit"
      ? failure.failureClass
      : "internal";
  return new EncodingError(failureClass, "encode-failed", failure.message, {
    errorClass: failure.errorClass,
    terminal: failure.terminal,
  });
}

/** Maps a non-2xx HTTP answer (the worker's classified refusal body) onto the typed errors. */
function httpErrorToEncodingError(status: number, body: HttpErrorBody | null): EncodingError {
  const errorClass = body?.error?.errorClass ?? `http-${status}`;
  const message = body?.error?.message ?? `the media toolchain worker answered HTTP ${status}`;
  if (errorClass === "capacity") {
    // The honest transient-unavailable posture (the local adapter's own
    // unavailable class): the caller learns the worker is at capacity,
    // never a faked encode.
    return new EncodingError("resource-limit", "encoder-unavailable", `${errorClass}: ${message}`, {
      errorClass,
      status,
    });
  }
  return new EncodingError("internal", "encode-failed", `${errorClass}: ${message}`, {
    errorClass,
    status,
  });
}

// ---------------------------------------------------------------------------
// The shared dispatch core (one encode-frames job per encode call)
// ---------------------------------------------------------------------------

/** The verified outcome of one dispatched encode. */
interface DispatchedEncode {
  /** The re-measured (client-hashed) encoded MP4 bytes. */
  bytes: Uint8Array;
  /** The worker's MEASURED result document (every claim re-verified). */
  output: {
    contentHash: string;
    byteSize: number;
    frameCount: number;
    width: number;
    height: number;
    fps: number;
    durationMs: number;
    encoderKind: string;
    encoderVersion: string | null;
    codec: EncodedCodecParams;
  };
}

/** The shared client state both port halves close over. */
interface EncodeClientState {
  base: string;
  transport: SyncHttpTransport;
  deadlineMs: number;
  maxDurationMs: number;
  jobIdPrefix: string;
  rightsPolicyRef: string;
}

/** Builds one encode-frames dispatch request over the packed frame bytes. */
function encodeDispatchOf(
  state: EncodeClientState,
  bytes: Uint8Array,
  spec: { frameCount: number; width: number; height: number; fps: number },
  sessionId: string,
): MediaToolchainDispatchRequestDoc {
  const contentHash = sha256OfBytes(bytes);
  const request: MediaToolchainDispatchRequestDoc = {
    job: {
      schemaVersion: "1.0",
      jobId: randomMediaId(state.jobIdPrefix),
      idempotencyKey: randomMediaId(`${state.jobIdPrefix}-key`),
      sessionId,
      operation: "encode-frames",
      source: { contentHash, byteSize: bytes.byteLength, container: "rgb24" },
      rights: {
        policyRef: state.rightsPolicyRef,
        canReferenceSourceFrames: true,
      },
      constraints: { deadlineMs: state.deadlineMs, priority: 0 },
      mediaPolicy: { maxDurationMs: state.maxDurationMs },
      encodeSpec: {
        frameCount: spec.frameCount,
        width: spec.width,
        height: spec.height,
        fps: spec.fps,
      },
    },
    source: {
      inputId: "frame-sequence",
      kind: "rgb24-frames",
      contentBase64: Buffer.from(bytes).toString("base64"),
    },
  };
  return request;
}

/** Dispatches one encode-frames job and resolves its VERIFIED outcome. */
function dispatchEncode(
  state: EncodeClientState,
  bytes: Uint8Array,
  spec: { frameCount: number; width: number; height: number; fps: number },
  sessionId: string,
): DispatchedEncode {
  const url = `${state.base}/v1/media/jobs/execute`;
  const request = encodeDispatchOf(state, bytes, spec, sessionId);
  let answer;
  try {
    answer = state.transport(
      url,
      { method: "POST", body: JSON.stringify(request) },
      {
        timeoutMs: state.deadlineMs,
      },
    );
  } catch (err) {
    // The transport's own typed refusals (unreachable worker, killed child)
    // pass through; an unexpected transport fault is the honest
    // unavailable posture, never silence.
    if (err instanceof EncodingError) throw err;
    throw new EncodingError(
      "resource-limit",
      "encoder-unavailable",
      `the media toolchain worker at '${state.base}' is unreachable: ${err instanceof Error ? err.message : String(err)}`,
      { workerUrl: state.base },
    );
  }
  if (answer.status !== 200) {
    let body: HttpErrorBody | null = null;
    try {
      body = JSON.parse(answer.body) as HttpErrorBody;
    } catch {
      // keep the generic message
    }
    throw httpErrorToEncodingError(answer.status, body);
  }
  let parsed: { disposition?: string; result?: unknown } | null = null;
  try {
    parsed = JSON.parse(answer.body) as { disposition?: string; result?: unknown };
  } catch (err) {
    throw new EncodingError(
      "internal",
      "encode-failed",
      `the media toolchain worker at '${state.base}' answered a non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
      { workerUrl: state.base },
    );
  }
  const envelope = MediaToolchainResult.safeParse(parsed?.result);
  if (!envelope.success) {
    // A lying provider: the port dead-letters it, never trusts it.
    throw new EncodingError(
      "internal",
      "encode-failed",
      "invalid-envelope: the worker answered a result that is not a MediaToolchainResult: " +
        envelope.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      { workerUrl: state.base },
    );
  }
  const result = envelope.data;
  if (result.status === "failed") {
    throw encodeFailureToError(result.failure!);
  }
  const encoded = result.encoded;
  if (encoded === undefined) {
    throw new EncodingError(
      "internal",
      "encode-failed",
      "the worker answered a succeeded encode-frames without the measured encoded output",
      { workerUrl: state.base },
    );
  }
  // The receiving boundary: every claim re-measured (the provider's
  // numbers are never trusted — a lying claim is never interpreted).
  const outBytes = new Uint8Array(Buffer.from(encoded.contentBase64, "base64"));
  const measuredHash = sha256OfBytes(outBytes);
  if (measuredHash !== encoded.contentHash) {
    throw new EncodingError(
      "internal",
      "artifact-invalid",
      `the delivered bytes hash to ${measuredHash}, the envelope claims ${encoded.contentHash}`,
      { workerUrl: state.base, measured: measuredHash, claimed: encoded.contentHash },
    );
  }
  if (outBytes.byteLength !== encoded.byteSize) {
    throw new EncodingError(
      "internal",
      "artifact-invalid",
      `the delivered bytes measure ${outBytes.byteLength}, the envelope claims ${encoded.byteSize}`,
      { workerUrl: state.base, measured: outBytes.byteLength, claimed: encoded.byteSize },
    );
  }
  if (
    encoded.frameCount !== spec.frameCount ||
    encoded.width !== spec.width ||
    encoded.height !== spec.height ||
    encoded.fps !== spec.fps
  ) {
    throw new EncodingError(
      "internal",
      "artifact-invalid",
      `the encoded output's geometry (${encoded.frameCount} frames, ${encoded.width}x${encoded.height} @ ${encoded.fps}fps) disagrees with the dispatched spec (${spec.frameCount} frames, ${spec.width}x${spec.height} @ ${spec.fps}fps) — a lying claim is never interpreted`,
      {
        workerUrl: state.base,
        claimed: {
          frameCount: encoded.frameCount,
          width: encoded.width,
          height: encoded.height,
          fps: encoded.fps,
        },
        dispatched: spec,
      },
    );
  }
  // The playable-container magic (the decode seam's verification
  // discipline): an MP4 container starts with the ftyp box.
  if (
    encoded.codec.container === "mp4" &&
    (outBytes.byteLength < 8 || String.fromCharCode(...outBytes.subarray(4, 8)) !== "ftyp")
  ) {
    throw new EncodingError(
      "internal",
      "artifact-invalid",
      "the delivered bytes do not carry the MP4 ftyp box magic — a non-playable payload is never presented as video",
      { workerUrl: state.base, byteLength: outBytes.byteLength },
    );
  }
  return {
    bytes: outBytes,
    output: {
      contentHash: encoded.contentHash,
      byteSize: encoded.byteSize,
      frameCount: encoded.frameCount,
      width: encoded.width,
      height: encoded.height,
      fps: encoded.fps,
      durationMs: encoded.durationMs,
      encoderKind: encoded.encoderKind,
      encoderVersion: encoded.encoderVersion,
      codec: { ...encoded.codec },
    },
  };
}

// ---------------------------------------------------------------------------
// The R306 FrameEncoderPort implementation
// ---------------------------------------------------------------------------

/** The R306 `FrameEncodeRequest`'s source resolved to its packed bytes. */
interface AdmittedFrameSource {
  bytes: Uint8Array;
  frameCount: number;
  width: number;
  height: number;
}

/**
 * Admits a frame-sequence source client-side — the LOCAL adapter's own
 * checks (geometry bounds + the packed byte-math), mirrored at THIS
 * boundary so a malformed request refuses BEFORE any bytes cross the wire
 * (the same typed `frames-invalid` classes; the worker's REAL adapter
 * re-enforces them — defense in depth).
 */
function admitFrameSource(request: FrameEncodeRequest): AdmittedFrameSource {
  const { width, height, frameCount } =
    request.source.kind === "rgb24-file"
      ? {
          width: request.source.width,
          height: request.source.height,
          frameCount: request.source.frameCount,
        }
      : {
          width: request.source.width,
          height: request.source.height,
          frameCount: request.source.frames.length,
        };
  const fps = request.fps;
  if (!Number.isInteger(width) || width < 16 || !Number.isInteger(height) || height < 16) {
    throw new EncodingError(
      "media-invalid",
      "frames-invalid",
      "encode dimensions must be integers >= 16",
      {
        width,
        height,
      },
    );
  }
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new EncodingError(
      "media-invalid",
      "frames-invalid",
      "encode dimensions must be even (yuv420p chroma subsampling)",
      { width, height },
    );
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new EncodingError("media-invalid", "frames-invalid", "encode fps must be finite > 0", {
      fps,
    });
  }
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new EncodingError(
      "media-invalid",
      "frames-invalid",
      "encode frameCount must be an integer >= 1",
      {
        frameCount,
      },
    );
  }
  const frameBytes = width * height * 3;
  if (request.source.kind === "rgb24-file") {
    let bytes: Buffer;
    try {
      bytes = readFileSync(request.source.path);
    } catch (cause) {
      throw new EncodingError(
        "media-invalid",
        "frames-invalid",
        "the staged frame file does not exist",
        {
          path: request.source.path,
          cause: String(cause),
        },
      );
    }
    if (bytes.length !== frameCount * frameBytes) {
      throw new EncodingError(
        "media-invalid",
        "frames-invalid",
        `the staged frame file's size must be exactly frameCount × width × height × 3 = ${frameCount * frameBytes} bytes (got ${bytes.length})`,
        {
          path: request.source.path,
          expectedBytes: frameCount * frameBytes,
          actualBytes: bytes.length,
        },
      );
    }
    return { bytes: new Uint8Array(bytes), frameCount, width, height };
  }
  const frames: Buffer[] = [];
  for (let i = 0; i < request.source.frames.length; i += 1) {
    const frame = request.source.frames[i];
    if (!(frame instanceof Uint8Array) || frame.length !== frameBytes) {
      throw new EncodingError(
        "media-invalid",
        "frames-invalid",
        `frames[${i}] must be a Uint8Array of exactly width × height × 3 = ${frameBytes} bytes (got ${frame?.length ?? "not a Uint8Array"})`,
        { index: i, expectedBytes: frameBytes, actualBytes: frame?.length ?? -1 },
      );
    }
    frames.push(Buffer.from(frame));
  }
  return { bytes: new Uint8Array(Buffer.concat(frames)), frameCount, width, height };
}

/** The R306 `FrameEncoderPort` over the toolchain worker's http wire. */
class HttpFrameEncoder implements FrameEncoderPort {
  readonly kind = HTTP_FRAME_ENCODER_KIND;

  constructor(
    private readonly state: EncodeClientState,
    private readonly probeDescriptor: () => MediaToolchainDescriptorDoc | null,
  ) {}

  available(): boolean {
    const descriptor = this.probeDescriptor();
    return descriptor !== null && descriptor.operations.includes("encode-frames");
  }

  version(): string | null {
    const descriptor = this.probeDescriptor();
    if (descriptor === null || !descriptor.operations.includes("encode-frames")) return null;
    return descriptor.toolchain.ffmpegVersion;
  }

  encode(request: FrameEncodeRequest): FrameEncodeResult {
    const admitted = admitFrameSource(request);
    const dispatched = dispatchEncode(
      this.state,
      admitted.bytes,
      {
        frameCount: admitted.frameCount,
        width: admitted.width,
        height: admitted.height,
        fps: request.fps,
      },
      request.origin.rendererId,
    );
    return {
      bytes: dispatched.bytes,
      byteSize: dispatched.output.byteSize,
      contentHash: dispatched.output.contentHash,
      frameCount: dispatched.output.frameCount,
      width: dispatched.output.width,
      height: dispatched.output.height,
      fps: dispatched.output.fps,
      durationMs: dispatched.output.durationMs,
      // The PRODUCER's identity (the worker's own REAL adapter — the kind
      // + the REMOTE build's measured version): the manifest records who
      // ENCODED the bytes, never this client-side seam.
      encoderKind: dispatched.output.encoderKind,
      encoderVersion: dispatched.output.encoderVersion,
      codec: dispatched.output.codec,
    };
  }
}

// ---------------------------------------------------------------------------
// The R301 TacticalVideoCodec implementation
// ---------------------------------------------------------------------------

/** The R301 `TacticalVideoCodec` over the SAME encode-frames wire operation. */
class HttpTacticalCodec implements TacticalVideoCodec {
  readonly kind = HTTP_TACTICAL_CODEC_KIND;

  constructor(
    private readonly state: EncodeClientState,
    private readonly probeDescriptor: () => MediaToolchainDescriptorDoc | null,
  ) {}

  available(): boolean {
    const descriptor = this.probeDescriptor();
    return descriptor !== null && descriptor.operations.includes("encode-frames");
  }

  version(): string | null {
    const descriptor = this.probeDescriptor();
    if (descriptor === null || !descriptor.operations.includes("encode-frames")) return null;
    return descriptor.toolchain.ffmpegVersion;
  }

  encode(request: EncodeFramesRequest): Buffer {
    // The staged raw-frame sequence's byte-math, admitted client-side (the
    // frame encoder's own discipline — the LOCAL codec lets ffmpeg surface
    // size errors; over the wire the honest client refuses BEFORE shipping
    // megabytes of a malformed sequence, with the codec's own typed error).
    const frameBytes = request.width * request.height * 3;
    let bytes: Buffer;
    try {
      bytes = readFileSync(request.rawFrameSequencePath);
    } catch (cause) {
      throw new TacticalCodecError(
        `the staged raw frame sequence could not be read: ${String(cause)}`,
        {
          path: request.rawFrameSequencePath,
        },
      );
    }
    if (bytes.length !== request.frameCount * frameBytes) {
      throw new TacticalCodecError(
        `the staged raw frame sequence's size must be exactly frameCount × width × height × 3 = ${request.frameCount * frameBytes} bytes (got ${bytes.length})`,
        {
          path: request.rawFrameSequencePath,
          expectedBytes: request.frameCount * frameBytes,
          actualBytes: bytes.length,
        },
      );
    }
    try {
      const dispatched = dispatchEncode(
        this.state,
        new Uint8Array(bytes),
        {
          frameCount: request.frameCount,
          width: request.width,
          height: request.height,
          fps: request.fps,
        },
        "tactical.prototype",
      );
      return Buffer.from(dispatched.bytes);
    } catch (err) {
      if (err instanceof EncodingError) {
        // The codec's OWN frozen error family (its callers' contract):
        // the underlying typed refusal is carried in the details, never lost.
        throw new TacticalCodecError(err.message, {
          failureClass: err.failureClass,
          kind: err.kind,
          details: err.details,
        });
      }
      throw err instanceof TacticalCodecError ? err : new TacticalCodecError(String(err));
    }
  }
}

// ---------------------------------------------------------------------------
// The pair factory (the composition's injection shape)
// ---------------------------------------------------------------------------

/** The injected encode pair: BOTH encode surfaces over the one wire operation. */
export interface HttpEncodePair {
  /** The R306 `FrameEncoderPort` (the game-3d/anime-npr bridges' encoder). */
  frameEncoder: FrameEncoderPort;
  /** The R301 `TacticalVideoCodec` (the tactical renderer's own codec). */
  tacticalCodec: TacticalVideoCodec;
}

/**
 * Creates the HTTP ENCODE PAIR against a media-toolchain worker's base URL
 * (e.g. `http://127.0.0.1:3971`): BOTH encode surfaces (the R306
 * `FrameEncoderPort` AND the R301 `TacticalVideoCodec`) over the ONE
 * `encode-frames` wire operation, the worker executing the SAME REAL
 * `FfmpegFrameEncoder` the local path runs. Wire it into
 * `createDerivedRealityPlane` as the injected encode pair
 * (`{ encode: pair }`) — the web composition does exactly this when
 * `MEDIA_TOOLCHAIN=http`.
 */
export function createHttpEncodePair(
  workerUrl: string,
  options: HttpEncodePairOptions = {},
): HttpEncodePair {
  const state: EncodeClientState = {
    base: workerUrl.replace(/\/+$/, ""),
    transport: options.transport ?? childProcessSyncTransport,
    deadlineMs: options.deadlineMs ?? 120_000,
    maxDurationMs: options.mediaPolicy?.maxDurationMs ?? UPLOAD_CONSTRAINTS.maxDurationMs,
    jobIdPrefix: options.jobIdPrefix ?? "mtenc",
    rightsPolicyRef: options.rightsPolicyRef ?? "derived-reality/encode-seam",
  };
  // The ONE shared, cached descriptor probe both halves' available()/
  // version() answer (the worker's OWN honest resolution — a bounded sync
  // fetch, cached per pair; unreachable workers answer null, never throw).
  let cachedDescriptor: MediaToolchainDescriptorDoc | null | undefined;
  const probeDescriptor = (): MediaToolchainDescriptorDoc | null => {
    if (cachedDescriptor !== undefined) return cachedDescriptor;
    try {
      const answer = state.transport(
        `${state.base}/v1/media/adapter`,
        { method: "GET" },
        {
          timeoutMs: options.probeTimeoutMs ?? 10_000,
        },
      );
      if (answer.status !== 200) {
        cachedDescriptor = null;
        return null;
      }
      const parsed = MediaToolchainDescriptor.safeParse(JSON.parse(answer.body));
      cachedDescriptor = parsed.success ? parsed.data : null;
    } catch {
      cachedDescriptor = null;
    }
    return cachedDescriptor;
  };
  return {
    frameEncoder: new HttpFrameEncoder(state, probeDescriptor),
    tacticalCodec: new HttpTacticalCodec(state, probeDescriptor),
  };
}
