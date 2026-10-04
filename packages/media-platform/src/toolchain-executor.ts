/**
 * THE MEDIA TOOLCHAIN EXECUTOR (R607 lane B — the W914 http compute adapter
 * against a REAL toolchain worker): the REAL media operations behind the
 * classified envelope, plus the in-process DEFAULT seam.
 *
 * Two roles, one module:
 *
 * 1. `executeMediaToolchainJob` — the WORKER-SIDE execution function the
 *    hosted media-toolchain worker (`@sporta/compute-adapter-hosted`'s
 *    media profile) drives: one `MediaToolchainDispatchRequest` becomes one
 *    executed REAL media operation (ffprobe admission probing / ffmpeg
 *    canonical normalization) resolved as a classified
 *    `MediaToolchainResult` envelope — NEVER a thrown error across the
 *    seam, never silence. Fail-closed budgets are enforced by MEASUREMENT
 *    against the injected clock; the dispatch's source claims are
 *    re-measured (byte length, then sha-256) and a lying claim is a typed
 *    refusal — the producer never trusts the requester's numbers.
 *
 * 2. `InProcessMediaToolchain` — the DEFAULT `MediaToolchainExecutor`
 *    (the non-degradation law): the REAL `FfmpegTool` in THIS process,
 *    resolving ffmpeg/ffprobe via `Bun.which` — byte-identical behavior to
 *    the pre-seam pipeline (the same temp-dir discipline, the same typed
 *    errors, the same measured probes; the seam is additive around the
 *    unchanged operations).
 *
 * PURITY: the executor reads no wall clock (the clock is INJECTED), no
 * randomness, no env — the only I/O is the REAL ffmpeg/ffprobe subprocess
 * wrapper and the caller-supplied temp filesystem (the same I/O the
 * pipeline always performed).
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FfmpegTool } from "./ffmpeg";
import type { MediaProbe } from "./ffmpeg";
import { FfmpegUnavailableError, MediaInvalidError, MediaRightsError } from "./errors";
import { NORMALIZATION_RENDERER_ID, NORMALIZATION_RENDERER_VERSION } from "./normalize";
import { sha256OfBytes } from "./storage";
import { MediaToolchainDispatchRequest, MediaToolchainResult } from "./toolchain";
import type {
  MediaToolchainBudgets,
  MediaToolchainDispatchRequest as MediaToolchainDispatchRequestDoc,
  MediaToolchainOperation as MediaToolchainOperationDoc,
  MediaToolchainResult as MediaToolchainResultDoc,
} from "./toolchain";
import { EncodingError, FfmpegFrameEncoder } from "@sporta/encoding";
import type { EncodeOrigin, FrameEncoderPort, FrameEncodeResult } from "@sporta/encoding";
import {
  FfmpegDecoderAdapter,
  ResourceLimitError as DecodeResourceLimitError,
  RightsDeniedError as DecodeRightsDeniedError,
  UnsupportedMediaError as DecodeUnsupportedMediaError,
} from "@sporta/decoding";
import type {
  DecodeSourceInput,
  DecodeWindow,
  NormalizedVideoFrame,
  ProbeResult,
} from "@sporta/decoding";
import type { AuthorizationPolicy } from "@sporta/contracts";

// ---------------------------------------------------------------------------
// The worker-side execution (classified envelopes — failures are values)
// ---------------------------------------------------------------------------

/** What the worker-side executor needs from its host (all injected). */
export interface MediaToolchainExecutorDeps {
  /** The REAL typed ffmpeg/ffprobe wrapper (the tool this worker resolves). */
  tool: FfmpegTool;
  /** The injected clock (epoch-ms readings; the worker injects a real one). */
  nowMs: () => number;
  /** The fail-closed budgets (./toolchain.ts — measured, never self-reported). */
  budgets: MediaToolchainBudgets;
  /**
   * The R306 REAL frame encoder (the encode-frames leg's mechanical
   * adapter — `FfmpegFrameEncoder`, the SAME adapter the local path runs,
   * so the remote encode cannot drift from the local one). ADDITIVE:
   * `undefined` (the default — every pre-extension caller) lazily
   * constructs the REAL adapter per encode dispatch; `null` = the encoder
   * was probed UNAVAILABLE at the composition (the leg refuses with the
   * honest `ffmpeg-unavailable` class, never a faked encode); an instance
   * = use it as given (the worker resolves one at boot and reuses it).
   */
  frameEncoder?: FrameEncoderPort | null;
}

/** A determinate failure under construction. */
interface FailureSpec {
  errorClass: string;
  message: string;
  terminal: "non-retryable" | "timeout" | "internal";
  failureClass: "media-invalid" | "resource-limit" | "rights-denied" | "internal";
}

/** Builds the failed envelope (never silent — always classified). */
function failedEnvelope(
  jobId: string,
  operation: MediaToolchainOperationDoc,
  failure: FailureSpec,
  metering: {
    startedAtMs: number;
    finishedAtMs: number;
    ffprobeRuns: number;
    ffmpegRuns: number;
    inputBytes: number;
    outputBytes: number;
  },
): MediaToolchainResultDoc {
  return {
    jobId,
    operation,
    status: "failed",
    failure: { ...failure, retryable: false },
    metering: {
      startedAtMs: metering.startedAtMs,
      finishedAtMs: metering.finishedAtMs,
      executionMs: Math.max(0, metering.finishedAtMs - metering.startedAtMs),
      ffprobeRuns: metering.ffprobeRuns,
      ffmpegRuns: metering.ffmpegRuns,
      inputBytes: metering.inputBytes,
      outputBytes: metering.outputBytes,
    },
  };
}

/** The mutable metering accumulator one execution tracks. */
interface MeteringState {
  startedAtMs: number;
  ffprobeRuns: number;
  ffmpegRuns: number;
  inputBytes: number;
  outputBytes: number;
}

/**
 * Executes ONE media-toolchain dispatch request end-to-end. Never throws —
 * every outcome (including malformed input and internal faults) resolves
 * as a classified {@link MediaToolchainResult} envelope (failures are
 * values; the worker's HTTP surface never throws across the wire).
 */
export async function executeMediaToolchainJob(
  request: unknown,
  deps: MediaToolchainExecutorDeps,
): Promise<MediaToolchainResultDoc> {
  const startedAtMs = deps.nowMs();
  const metering: MeteringState = {
    startedAtMs,
    ffprobeRuns: 0,
    ffmpegRuns: 0,
    inputBytes: 0,
    outputBytes: 0,
  };
  const finishAt = (): number => deps.nowMs();
  const fail = (failure: FailureSpec, jobId: string, operation: MediaToolchainOperationDoc) =>
    failedEnvelope(jobId, operation, failure, {
      startedAtMs,
      finishedAtMs: finishAt(),
      ffprobeRuns: metering.ffprobeRuns,
      ffmpegRuns: metering.ffmpegRuns,
      inputBytes: metering.inputBytes,
      outputBytes: metering.outputBytes,
    });

  // 1. Structural validation of the dispatch request (fail-closed).
  const parsedRequest = MediaToolchainDispatchRequest.safeParse(request);
  if (!parsedRequest.success) {
    const echoJobId =
      typeof request === "object" &&
      request !== null &&
      typeof (request as { job?: { jobId?: unknown } }).job?.jobId === "string"
        ? (request as { job: { jobId: string } }).job.jobId
        : "unknown";
    return fail(
      {
        errorClass: "invalid-dispatch",
        message:
          "request is not a valid MediaToolchainDispatchRequest: " +
          parsedRequest.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        terminal: "non-retryable",
        failureClass: "internal",
      },
      echoJobId,
      "probe",
    );
  }
  const dispatch: MediaToolchainDispatchRequestDoc = parsedRequest.data;
  const job = dispatch.job;

  // 2. Decode the materialized source bytes (the inline transport).
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(dispatch.source.contentBase64, "base64"));
  } catch (err) {
    return fail(
      {
        errorClass: "invalid-dispatch",
        message: `the materialized source is not decodable base64: ${err instanceof Error ? err.message : String(err)}`,
        terminal: "non-retryable",
        failureClass: "internal",
      },
      job.jobId,
      job.operation,
    );
  }
  metering.inputBytes = bytes.byteLength;

  // 3. Re-measure the claims (NEVER trusted): size, then content hash.
  if (bytes.byteLength !== job.source.byteSize) {
    return fail(
      {
        errorClass: "source-size-mismatch",
        message: `the dispatch claims ${job.source.byteSize} source bytes but ${bytes.byteLength} arrived — a lying claim is never interpreted`,
        terminal: "non-retryable",
        failureClass: "internal",
      },
      job.jobId,
      job.operation,
    );
  }
  const measuredSourceHash = sha256OfBytes(bytes);
  if (measuredSourceHash !== job.source.contentHash) {
    return fail(
      {
        errorClass: "source-hash-mismatch",
        message: `the dispatch claims source sha-256 ${job.source.contentHash} but the received bytes hash to ${measuredSourceHash} — a lying claim is never interpreted`,
        terminal: "non-retryable",
        failureClass: "internal",
      },
      job.jobId,
      job.operation,
    );
  }

  // 4. Fail-closed source-size budget.
  if (bytes.byteLength > deps.budgets.maxSourceBytes) {
    return fail(
      {
        errorClass: "source-too-large",
        message: `the source measures ${bytes.byteLength} bytes, over the fail-closed budget of ${deps.budgets.maxSourceBytes}`,
        terminal: "non-retryable",
        failureClass: "resource-limit",
      },
      job.jobId,
      job.operation,
    );
  }

  // 5. Fail-closed rights re-check at the provider (the posture travels:
  //    the media pipeline references source frames — a posture that denies
  //    them is refused before ANY tool runs).
  if (!job.rights.canReferenceSourceFrames) {
    return fail(
      {
        errorClass: "rights-denied",
        message:
          "the job's rights posture denies canReferenceSourceFrames — the media pipeline references source frames and is refused (fail-closed)",
        terminal: "non-retryable",
        failureClass: "rights-denied",
      },
      job.jobId,
      job.operation,
    );
  }

  // 6. The REAL toolchain availability (the R607 boundary class, honest:
  //    never faked, never advertised as resolvable when it is not).
  if (!(await deps.tool.available())) {
    return fail(
      {
        errorClass: "ffmpeg-unavailable",
        message: `ffmpeg is not usable at '${deps.tool.ffmpegPath}' — the media toolchain cannot execute on this worker (and is never faked)`,
        terminal: "internal",
        failureClass: "internal",
      },
      job.jobId,
      job.operation,
    );
  }

  // 6b. The DECODE legs (R607 Gap 1 — the TL-authorized decode seam): the
  //     R207 real-to-SWM decode's two operations, executed by the SAME
  //     MECHANICAL ffmpeg/ffprobe adapter the local path uses
  //     (`@sporta/decoding`'s `FfmpegDecoderAdapter` — the exact subprocess
  //     commands, the exact frame/timestamp semantics; never re-implemented
  //     here, so the remote frames cannot drift from the local ones). ALL
  //     W102 policy (rights gate, limits, output validation) stays at the
  //     dispatching side's `DecodingService` envelope — the worker executes
  //     the mechanical leg, the wire carries the classified envelope.
  if (job.operation === "decode-probe" || job.operation === "decode-frames") {
    return await executeDecodeLeg(dispatch, bytes, metering, deps, finishAt, measuredSourceHash);
  }

  // 6c. The ENCODE leg (R306 — the TL-authorized encode seam): the
  //     derived-reality plane's mechanical rgb24 frame-sequence → h264/MP4
  //     encode, executed by the SAME MECHANICAL adapter the local path runs
  //     (`@sporta/encoding`'s `FfmpegFrameEncoder` — the exact pinned argv,
  //     the exact determinism knobs; never re-implemented here, so the
  //     remote bytes cannot drift from the local encodes). The R306
  //     admission discipline (geometry bounds, the packed byte-math) is
  //     enforced BY the adapter itself; its typed refusals are classified
  //     onto the wire vocabulary below.
  if (job.operation === "encode-frames") {
    return await executeEncodeLeg(dispatch, bytes, metering, deps, finishAt);
  }

  // 7. The operation itself (REAL ffprobe / REAL ffmpeg, temp files
  //    unlinked on every path — the pipeline's own discipline).
  try {
    if (job.operation === "probe") {
      const workDir = await mkdtemp(join(tmpdir(), "sporta-toolchain-probe-"));
      let probe: MediaProbe;
      try {
        const inputPath = join(workDir, "received.mp4");
        await writeFile(inputPath, bytes);
        metering.ffprobeRuns += 1;
        probe = await deps.tool.probe(inputPath);
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
      const envelope = selfChecked(
        {
          jobId: job.jobId,
          operation: "probe",
          status: "succeeded",
          sourceProbe: probe,
          metering: meteringBlock(metering, finishAt()),
        },
        job.jobId,
        "probe",
      );
      return envelope;
    }

    // normalize: the REAL canonical transcode.
    const workDir = await mkdtemp(join(tmpdir(), "sporta-toolchain-normalize-"));
    let outputProbe: MediaProbe;
    let outputBytes: Uint8Array;
    try {
      const inputPath = join(workDir, "source.mp4");
      const outputPath = join(workDir, "normalized.mp4");
      await writeFile(inputPath, bytes);
      metering.ffmpegRuns += 1;
      // The tool's own hasAudioStream probe + the OUTPUT probe are real
      // ffprobe invocations — counted honestly.
      metering.ffprobeRuns += 2;
      outputProbe = await deps.tool.transcodeToNormalizedMp4(inputPath, outputPath);
      outputBytes = new Uint8Array(await readFile(outputPath));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
    metering.outputBytes = outputBytes.byteLength;

    // 7a. The media policy re-check against the PRODUCED media (defense in
    //     depth over the dispatching side's own admission checks).
    if (outputProbe.durationMs > job.mediaPolicy.maxDurationMs) {
      return fail(
        {
          errorClass: "duration-over-limit",
          message: `the normalized media measures ${outputProbe.durationMs}ms, over the job's ${job.mediaPolicy.maxDurationMs}ms policy bound`,
          terminal: "non-retryable",
          failureClass: "media-invalid",
        },
        job.jobId,
        "normalize",
      );
    }

    // 7b. Fail-closed artifact-size budget (outputs are NEVER handed back).
    if (outputBytes.byteLength > deps.budgets.maxArtifactBytes) {
      return fail(
        {
          errorClass: "artifact-too-large",
          message: `the normalized artifact is ${outputBytes.byteLength} bytes, over the fail-closed budget of ${deps.budgets.maxArtifactBytes} — outputs discarded`,
          terminal: "non-retryable",
          failureClass: "resource-limit",
        },
        job.jobId,
        "normalize",
      );
    }

    // 7c. The content address + the original-reality artifact block: the
    //     hash chain source → normalized, every field MEASURED (the
    //     producer re-hashes the bytes it produced — `integrity.verified`
    //     is earned by measurement, never asserted from a claim).
    const contentHash = sha256OfBytes(outputBytes);
    const primary = outputProbe.videoStreams[0]!;
    const audioStream = outputProbe.audioStreams[0];
    const finishedAtMs = finishAt();

    // 7d. Fail-closed duration budget (post-hoc: outputs are DISCARDED).
    const durationBudgetMs = Math.min(deps.budgets.maxExecutionMs, job.constraints.deadlineMs);
    const executionMs = Math.max(0, finishedAtMs - startedAtMs);
    if (executionMs > durationBudgetMs) {
      return fail(
        {
          errorClass: "budget-exceeded",
          message: `measured execution ${executionMs}ms exceeded the fail-closed budget of ${durationBudgetMs}ms (worker ${deps.budgets.maxExecutionMs}ms / job deadline ${job.constraints.deadlineMs}ms) — outputs discarded`,
          terminal: "timeout",
          failureClass: "resource-limit",
        },
        job.jobId,
        "normalize",
      );
    }

    return selfChecked(
      {
        jobId: job.jobId,
        operation: "normalize",
        status: "succeeded",
        normalized: {
          contentHash,
          byteSize: outputBytes.byteLength,
          probe: outputProbe,
          contentBase64: Buffer.from(outputBytes).toString("base64"),
        },
        artifact: {
          reality: "original",
          contentHash,
          sourceContentHash: measuredSourceHash,
          byteSize: outputBytes.byteLength,
          container: "mp4",
          videoCodec: primary.codec_name ?? "h264",
          audioCodec: audioStream?.codec_name ?? null,
          durationMs: outputProbe.durationMs,
          rendererId: NORMALIZATION_RENDERER_ID,
          rendererVersion: NORMALIZATION_RENDERER_VERSION,
          generatedAtMs: finishedAtMs,
          integrity: { algorithm: "sha256", verified: true },
        },
        metering: {
          startedAtMs,
          finishedAtMs,
          executionMs,
          ffprobeRuns: metering.ffprobeRuns,
          ffmpegRuns: metering.ffmpegRuns,
          inputBytes: metering.inputBytes,
          outputBytes: metering.outputBytes,
        },
      },
      job.jobId,
      "normalize",
    );
  } catch (err) {
    // The REAL tool refused the media (typed) or faulted (internal) —
    // classified, never thrown across the seam.
    if (err instanceof FfmpegUnavailableError) {
      return fail(
        {
          errorClass: "ffmpeg-unavailable",
          message: err.message,
          terminal: "internal",
          failureClass: "internal",
        },
        job.jobId,
        job.operation,
      );
    }
    if (err instanceof MediaRightsError) {
      return fail(
        {
          errorClass: "rights-denied",
          message: err.message,
          terminal: "non-retryable",
          failureClass: "rights-denied",
        },
        job.jobId,
        job.operation,
      );
    }
    if (err instanceof MediaInvalidError) {
      return fail(
        {
          errorClass: "media-invalid",
          message: err.message,
          terminal: "non-retryable",
          failureClass: "media-invalid",
        },
        job.jobId,
        job.operation,
      );
    }
    return fail(
      {
        errorClass: "internal",
        message: err instanceof Error ? err.message : String(err),
        terminal: "internal",
        failureClass: "internal",
      },
      job.jobId,
      job.operation,
    );
  }
}

/**
 * Executes the DECODE legs (R607 Gap 1 — `decode-probe` / `decode-frames`):
 * the R207 real-to-SWM decode's mechanical ffmpeg/ffprobe operations over
 * the wire, executed by `@sporta/decoding`'s `FfmpegDecoderAdapter` — the
 * SAME mechanical adapter the local in-process path uses (the exact
 * subprocess commands, the exact frame/timestamp semantics), so the remote
 * decode cannot drift from the local one. Never throws: every outcome
 * resolves as a classified {@link MediaToolchainResult} envelope.
 *
 * The fail-closed frame budget is `min(decodeWindow.maxTotalBytes,
 * budgets.maxDecodedFrameBytes)` — enforced DURING the iteration (the same
 * cumulative-byte semantics the dispatching side's W102 `DecodingService`
 * enforces), defense in depth on top of the client-side envelope.
 */
async function executeDecodeLeg(
  dispatch: MediaToolchainDispatchRequestDoc,
  bytes: Uint8Array,
  metering: MeteringState,
  deps: MediaToolchainExecutorDeps,
  finishAt: () => number,
  measuredSourceHash: string,
): Promise<MediaToolchainResultDoc> {
  const job = dispatch.job;
  const startedAtMs = metering.startedAtMs;
  const failLeg = (failure: FailureSpec): MediaToolchainResultDoc =>
    failedEnvelope(job.jobId, job.operation, failure, {
      startedAtMs,
      finishedAtMs: finishAt(),
      ffprobeRuns: metering.ffprobeRuns,
      ffmpegRuns: metering.ffmpegRuns,
      inputBytes: metering.inputBytes,
      outputBytes: metering.outputBytes,
    });

  try {
    // The mechanical adapter's `DecodeSourceInput`: the bytes are the
    // re-measured dispatch source (hash + size verified at steps 2-3); the
    // receipt carries the MEASURED claims (never the requester's numbers).
    // The `authorizationPolicy` field is INERT for the mechanical adapter
    // (ALL W102 policy — the rights gate, limits, output validation — lives
    // at the dispatching side's `DecodingService` envelope; the traveling
    // rights posture was already checked fail-closed at step 5).
    const workerPolicy: AuthorizationPolicy = {
      policyId: job.rights.policyRef,
      allowedOperations: ["analysis"],
      assertedBy: "media-toolchain-worker",
    };
    const input: DecodeSourceInput = {
      receipt: {
        sessionId: job.sessionId,
        sourceId: `src-${measuredSourceHash.slice(0, 12)}`,
        checksum: measuredSourceHash,
        // The decode rail's receipt container: the wire schema pairs every
        // non-encode operation with the mp4 container family (enforced on
        // the job description — the R306 additive pairing), so the
        // mechanical adapter's receipt carries "mp4" here.
        container: "mp4",
        byteLength: bytes.byteLength,
        ingestedAtMs: startedAtMs,
        sourceKind: "file",
      },
      authorizationPolicy: workerPolicy,
      openBytes: async () => bytes,
    };
    const adapter = new FfmpegDecoderAdapter();

    if (job.operation === "decode-probe") {
      // One REAL ffprobe run (the adapter's demux-level probe).
      metering.ffprobeRuns += 1;
      const probe: ProbeResult = await adapter.probe(input);
      return selfChecked(
        {
          jobId: job.jobId,
          operation: "decode-probe",
          status: "succeeded",
          decodeProbe: probe,
          metering: meteringBlock(metering, finishAt()),
        },
        job.jobId,
        "decode-probe",
      );
    }

    // decode-frames: ONE bounded window fetch.
    const window = job.decodeWindow;
    if (window === undefined) {
      // Unreachable via the schema (enforced on the job description) — the
      // fail-loud honest answer, never a guess.
      return failLeg({
        errorClass: "invalid-dispatch",
        message: "a decode-frames dispatch must carry its bounded window (decodeWindow)",
        terminal: "non-retryable",
        failureClass: "internal",
      });
    }
    const frameBudgetBytes = Math.min(window.maxTotalBytes, deps.budgets.maxDecodedFrameBytes);
    const decodeWindow: DecodeWindow = {
      ...(window.fromMs !== undefined ? { fromMs: window.fromMs } : {}),
      ...(window.toMs !== undefined ? { toMs: window.toMs } : {}),
      maxTotalBytes: frameBudgetBytes,
    };
    // The adapter's geometry resolution is one REAL targeted ffprobe run;
    // the rawvideo decode is one REAL ffmpeg run — counted honestly.
    metering.ffprobeRuns += 1;
    metering.ffmpegRuns += 1;
    const frames: NormalizedVideoFrame[] = [];
    let totalBytes = 0;
    for await (const frame of adapter.decodeVideo(input, window.streamIndex, decodeWindow)) {
      if (totalBytes + frame.bytes.byteLength > frameBudgetBytes) {
        // The frame-budget axis, fail-closed: outputs discarded, never
        // truncated silently (the same cumulative-byte semantics the local
        // W102 boundary's `DecodeWindow.maxTotalBytes` produces).
        return failLeg({
          errorClass: "frame-budget-exceeded",
          message:
            `the decoded frame batch would measure over the fail-closed frame budget of ` +
            `${frameBudgetBytes} bytes (window ${window.maxTotalBytes} / worker ${deps.budgets.maxDecodedFrameBytes}) — outputs discarded`,
          terminal: "non-retryable",
          failureClass: "resource-limit",
        });
      }
      totalBytes += frame.bytes.byteLength;
      frames.push(frame);
    }
    metering.outputBytes = totalBytes;

    // Fail-closed execution budget (post-hoc: outputs are DISCARDED).
    const finishedAtMs = finishAt();
    const executionMs = Math.max(0, finishedAtMs - startedAtMs);
    const durationBudgetMs = Math.min(deps.budgets.maxExecutionMs, job.constraints.deadlineMs);
    if (executionMs > durationBudgetMs) {
      return failLeg({
        errorClass: "budget-exceeded",
        message: `measured execution ${executionMs}ms exceeded the fail-closed budget of ${durationBudgetMs}ms (worker ${deps.budgets.maxExecutionMs}ms / job deadline ${job.constraints.deadlineMs}ms) — outputs discarded`,
        terminal: "timeout",
        failureClass: "resource-limit",
      });
    }

    return selfChecked(
      {
        jobId: job.jobId,
        operation: "decode-frames",
        status: "succeeded",
        decodedFrames: {
          frames: frames.map((frame) => ({
            frameId: frame.frameId,
            streamIndex: frame.streamIndex,
            presentationMs: frame.presentationMs,
            decodeOrder: frame.decodeOrder,
            width: frame.width,
            height: frame.height,
            pixelFormat: frame.pixelFormat,
            contentBase64: Buffer.from(frame.bytes).toString("base64"),
          })),
          totalBytes,
        },
        metering: {
          ...meteringBlock(metering, finishedAtMs),
          decodedFrames: frames.length,
          decodedFrameBytes: totalBytes,
        },
      },
      job.jobId,
      "decode-frames",
    );
  } catch (err) {
    // The mechanical adapter's TYPED refusals, classified (never thrown
    // across the seam) — the same classes the local path's callers see.
    if (err instanceof DecodeRightsDeniedError) {
      return failLeg({
        errorClass: "rights-denied",
        message: err.message,
        terminal: "non-retryable",
        failureClass: "rights-denied",
      });
    }
    if (err instanceof DecodeResourceLimitError) {
      return failLeg({
        errorClass: "frame-budget-exceeded",
        message: err.message,
        terminal: "non-retryable",
        failureClass: "resource-limit",
      });
    }
    if (err instanceof DecodeUnsupportedMediaError) {
      return failLeg({
        errorClass: "media-invalid",
        message: err.message,
        terminal: "non-retryable",
        failureClass: "media-invalid",
      });
    }
    if (err instanceof FfmpegUnavailableError) {
      return failLeg({
        errorClass: "ffmpeg-unavailable",
        message: err.message,
        terminal: "internal",
        failureClass: "internal",
      });
    }
    return failLeg({
      errorClass: "internal",
      message: err instanceof Error ? err.message : String(err),
      terminal: "internal",
      failureClass: "internal",
    });
  }
}

// ---------------------------------------------------------------------------
// The encode leg (R306 — the derived-reality plane's mechanical encode)
// ---------------------------------------------------------------------------

/**
 * The mechanical encode origin the worker-side leg records: the frames are
 * the DISPATCH's own materialized rgb24 sequence (rendered frames, never
 * user source media), so the bridge identity is the raw-frames tier. The
 * origin is a document field only — the REAL adapter ignores it (the pinned
 * argv derives from the geometry/framerate alone) — recorded honestly.
 */
const WIRE_ENCODE_ORIGIN: EncodeOrigin = {
  rendererId: "media-toolchain-worker",
  rendererVersion: "encode-frames",
  bridge: "raw-frames",
};

/**
 * Executes the ENCODE leg (R306 — `encode-frames`): the derived-reality
 * plane's mechanical rgb24 frame-sequence → h264/MP4 encode, executed by
 * `@sporta/encoding`'s REAL `FfmpegFrameEncoder` — the SAME mechanical
 * adapter the local path runs (the exact pinned argv: `-threads 1`,
 * `+bitexact`, `-map_metadata -1`, the fixed preset/tune/profile/level/
 * crf/pix_fmt/gop), so the remote bytes cannot drift from the local ones.
 * The adapter's OWN admission discipline (the geometry bounds, the packed
 * byte-math `frameCount × width × height × 3`) refuses a malformed dispatch
 * with the typed `frames-invalid` class; its encode failures are classified
 * `encode-failed` / `ffmpeg-unavailable`. Never throws: every outcome
 * resolves as a classified {@link MediaToolchainResult} envelope.
 */
async function executeEncodeLeg(
  dispatch: MediaToolchainDispatchRequestDoc,
  bytes: Uint8Array,
  metering: MeteringState,
  deps: MediaToolchainExecutorDeps,
  finishAt: () => number,
): Promise<MediaToolchainResultDoc> {
  const job = dispatch.job;
  const startedAtMs = metering.startedAtMs;
  const failLeg = (failure: FailureSpec): MediaToolchainResultDoc =>
    failedEnvelope(job.jobId, job.operation, failure, {
      startedAtMs,
      finishedAtMs: finishAt(),
      ffprobeRuns: metering.ffprobeRuns,
      ffmpegRuns: metering.ffmpegRuns,
      inputBytes: metering.inputBytes,
      outputBytes: metering.outputBytes,
    });

  // The encoder the leg runs (the SAME mechanical adapter the local path
  // uses): an explicitly-injected `null` is the honest unavailable refusal;
  // `undefined` (the pre-extension default) lazily constructs the REAL
  // adapter — the decode leg's own per-job construction precedent.
  if (deps.frameEncoder === null) {
    return failLeg({
      errorClass: "ffmpeg-unavailable",
      message:
        "the frame encoder was probed unavailable at the worker's composition (no ffmpeg/libx264) — the encode is refused, never faked",
      terminal: "internal",
      failureClass: "internal",
    });
  }
  const encoder: FrameEncoderPort = deps.frameEncoder ?? new FfmpegFrameEncoder();

  const spec = job.encodeSpec;
  if (spec === undefined) {
    // Unreachable via the schema (enforced on the job description) — the
    // fail-loud honest answer, never a guess.
    return failLeg({
      errorClass: "invalid-dispatch",
      message: "an encode-frames dispatch must carry its frame-sequence spec (encodeSpec)",
      terminal: "non-retryable",
      failureClass: "internal",
    });
  }

  // Stage the received (already re-measured: size + sha-256, steps 2-3)
  // packed frame sequence for the REAL adapter — the adapter's own
  // `admitSource` re-validates the staged file's byte-math fail-closed
  // (the LOCAL path's exact admission, never re-implemented here).
  const workDir = await mkdtemp(join(tmpdir(), "sporta-toolchain-encode-"));
  let result: FrameEncodeResult;
  try {
    const stagedPath = join(workDir, "frames.rgb24");
    await writeFile(stagedPath, bytes);
    result = encoder.encode({
      source: {
        kind: "rgb24-file",
        path: stagedPath,
        frameCount: spec.frameCount,
        width: spec.width,
        height: spec.height,
      },
      fps: spec.fps,
      origin: WIRE_ENCODE_ORIGIN,
    });
    metering.ffmpegRuns += 1; // the ONE REAL libx264 encode run (measured)
  } catch (err) {
    // The metering honesty: the adapter's PRE-SPAWN refusals (the admission
    // axis `frames-invalid`, the availability probe `encoder-unavailable`)
    // never spawned ffmpeg — 0 runs; the encode-failure axis (and unknown
    // faults) did reach the subprocess — 1 run, counted honestly.
    if (
      !(err instanceof EncodingError) ||
      err.kind === "encode-failed" ||
      err.kind === "artifact-invalid" ||
      err.kind === "verify-failed"
    ) {
      metering.ffmpegRuns += 1;
    }
    return encodeFailureOf(err, failLeg);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  metering.outputBytes = result.byteSize;

  // Fail-closed artifact-size budget (outputs are NEVER handed back).
  if (result.byteSize > deps.budgets.maxArtifactBytes) {
    return failLeg({
      errorClass: "artifact-too-large",
      message: `the encoded artifact is ${result.byteSize} bytes, over the fail-closed budget of ${deps.budgets.maxArtifactBytes} — outputs discarded`,
      terminal: "non-retryable",
      failureClass: "resource-limit",
    });
  }

  // The media policy re-check against the PRODUCED media (the clip's
  // measured duration — defense in depth over the dispatching side).
  if (result.durationMs > job.mediaPolicy.maxDurationMs) {
    return failLeg({
      errorClass: "duration-over-limit",
      message: `the encoded clip measures ${result.durationMs}ms, over the job's ${job.mediaPolicy.maxDurationMs}ms policy bound`,
      terminal: "non-retryable",
      failureClass: "media-invalid",
    });
  }

  // Fail-closed execution budget (post-hoc: outputs are DISCARDED).
  const finishedAtMs = finishAt();
  const executionMs = Math.max(0, finishedAtMs - startedAtMs);
  const durationBudgetMs = Math.min(deps.budgets.maxExecutionMs, job.constraints.deadlineMs);
  if (executionMs > durationBudgetMs) {
    return failLeg({
      errorClass: "budget-exceeded",
      message: `measured execution ${executionMs}ms exceeded the fail-closed budget of ${durationBudgetMs}ms (worker ${deps.budgets.maxExecutionMs}ms / job deadline ${job.constraints.deadlineMs}ms) — outputs discarded`,
      terminal: "timeout",
      failureClass: "resource-limit",
    });
  }

  return selfChecked(
    {
      jobId: job.jobId,
      operation: "encode-frames",
      status: "succeeded",
      encoded: {
        contentHash: result.contentHash,
        byteSize: result.byteSize,
        frameCount: result.frameCount,
        width: result.width,
        height: result.height,
        fps: result.fps,
        durationMs: result.durationMs,
        encoderKind: result.encoderKind,
        encoderVersion: result.encoderVersion,
        codec: { ...result.codec },
        contentBase64: Buffer.from(result.bytes).toString("base64"),
      },
      metering: meteringBlock(metering, finishedAtMs),
    },
    job.jobId,
    "encode-frames",
  );
}

/**
 * Classifies the encode leg's thrown failures onto the wire vocabulary: the
 * REAL adapter's TYPED `EncodingError`s (the same kinds the local path's
 * callers see) map onto the honest error classes — the admission axis
 * (`frames-invalid`), the boundary class (`ffmpeg-unavailable`), and the
 * encode-failure axis — never a re-thrown error across the seam.
 */
function encodeFailureOf(
  err: unknown,
  failLeg: (failure: FailureSpec) => MediaToolchainResultDoc,
): MediaToolchainResultDoc {
  if (err instanceof EncodingError) {
    if (err.kind === "encoder-unavailable") {
      return failLeg({
        errorClass: "ffmpeg-unavailable",
        message: err.message,
        terminal: "internal",
        failureClass: "internal",
      });
    }
    if (err.kind === "frames-invalid") {
      return failLeg({
        errorClass: "frames-invalid",
        message: err.message,
        terminal: "non-retryable",
        failureClass: "media-invalid",
      });
    }
    // encode-failed / artifact-invalid / verify-failed / store-rejected:
    // the encode-failure axis, carrying the adapter's own failure class.
    return failLeg({
      errorClass: "encode-failed",
      message: err.message,
      terminal: "internal",
      failureClass: err.failureClass,
    });
  }
  if (err instanceof FfmpegUnavailableError) {
    return failLeg({
      errorClass: "ffmpeg-unavailable",
      message: err.message,
      terminal: "internal",
      failureClass: "internal",
    });
  }
  return failLeg({
    errorClass: "encode-failed",
    message: err instanceof Error ? err.message : String(err),
    terminal: "internal",
    failureClass: "internal",
  });
}

/** Assembles the metering block from the accumulator + a finish reading. */
function meteringBlock(metering: MeteringState, finishedAtMs: number) {
  return {
    startedAtMs: metering.startedAtMs,
    finishedAtMs,
    executionMs: Math.max(0, finishedAtMs - metering.startedAtMs),
    ffprobeRuns: metering.ffprobeRuns,
    ffmpegRuns: metering.ffmpegRuns,
    inputBytes: metering.inputBytes,
    outputBytes: metering.outputBytes,
  };
}

/** The fail-loud self-check: a constructed envelope MUST parse (never hand back an invalid one). */
function selfChecked(
  envelope: unknown,
  jobId: string,
  operation: MediaToolchainOperationDoc,
): MediaToolchainResultDoc {
  const check = MediaToolchainResult.safeParse(envelope);
  if (check.success) return check.data;
  return failedEnvelope(
    jobId,
    operation,
    {
      errorClass: "invalid-envelope",
      message:
        "constructed envelope failed its own schema: " +
        check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      terminal: "internal",
      failureClass: "internal",
    },
    {
      startedAtMs: (envelope as { metering: { startedAtMs: number } }).metering.startedAtMs,
      finishedAtMs: (envelope as { metering: { finishedAtMs: number } }).metering.finishedAtMs,
      ffprobeRuns: (envelope as { metering: { ffprobeRuns: number } }).metering.ffprobeRuns,
      ffmpegRuns: (envelope as { metering: { ffmpegRuns: number } }).metering.ffmpegRuns,
      inputBytes: (envelope as { metering: { inputBytes: number } }).metering.inputBytes,
      outputBytes: (envelope as { metering: { outputBytes: number } }).metering.outputBytes,
    },
  );
}

// ---------------------------------------------------------------------------
// The in-process DEFAULT seam (the non-degradation law)
// ---------------------------------------------------------------------------

/** Options for {@link InProcessMediaToolchain}. */
export interface InProcessMediaToolchainOptions {
  /** The typed ffmpeg wrapper (default: a stock {@link FfmpegTool} — `Bun.which`). */
  tool?: FfmpegTool;
  /** The injected clock (default `Date.now` — a composition convenience). */
  nowMs?: () => number;
}

/**
 * The DEFAULT `MediaToolchainExecutor`: the REAL `FfmpegTool` in THIS
 * process — the pre-seam pipeline's own operations, byte-identical (the
 * same temp-dir discipline, the same typed errors, the same measured
 * probes). When ffmpeg/ffprobe do not resolve (`Bun.which`), every
 * operation throws the typed `FfmpegUnavailableError` — this platform
 * NEVER fakes a normalization or an admission probe.
 */
export class InProcessMediaToolchain {
  private readonly tool: FfmpegTool;
  private readonly nowMs: () => number;

  constructor(options: InProcessMediaToolchainOptions = {}) {
    this.tool = options.tool ?? new FfmpegTool();
    this.nowMs = options.nowMs ?? Date.now;
  }

  /** The REAL ffprobe on the received bytes (the R101 admission validation). */
  async probeMedia(bytes: Uint8Array): Promise<MediaProbe> {
    const workDir = await mkdtemp(join(tmpdir(), "sporta-upload-"));
    try {
      const inputPath = join(workDir, "received.mp4");
      await writeFile(inputPath, bytes);
      return await this.tool.probe(inputPath);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /** The REAL ffmpeg canonical transcode (the R102 normalization). */
  async normalizeMedia(bytes: Uint8Array): Promise<{
    outputBytes: Uint8Array;
    outputProbe: MediaProbe;
    executionMs: number;
  }> {
    const startedAtMs = this.nowMs();
    const workDir = await mkdtemp(join(tmpdir(), "sporta-normalize-"));
    let outputProbe: MediaProbe;
    let outputBytes: Uint8Array;
    try {
      const inputPath = join(workDir, "source.mp4");
      const outputPath = join(workDir, "normalized.mp4");
      await writeFile(inputPath, bytes);
      outputProbe = await this.tool.transcodeToNormalizedMp4(inputPath, outputPath);
      outputBytes = new Uint8Array(await readFile(outputPath));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
    return {
      outputBytes,
      outputProbe,
      executionMs: Math.max(0, this.nowMs() - startedAtMs),
    };
  }
}
