/**
 * THE R306 ENCODE SEAM TESTS (the TL-authorized encode seam — the G12 walk's
 * named next gap, the same seam-class the R207 decode seam closed): the wire
 * shapes (the `encode-frames` operation + its frame-sequence spec + the
 * rgb24 source family, the additive law over the pre-extension envelopes and
 * dispatches), and the HTTP ENCODE PAIR against a controlled stub transport
 * speaking the wire schema (the lying-provider and transport-fault
 * postures, the delivered-bytes re-measurement, the classified-failure
 * mapping onto the ENCODING plane's typed errors, the shared cached
 * descriptor probe) — plus the seam's TWO OTHER halves the pair's module
 * docs name: the bounded `spawnSync` subprocess transport's own contract
 * (driven against a helper worker in a SEPARATE process — the sync
 * transport blocks this process's event loop, so the HTTP server it talks
 * to cannot live in-process), and the worker-side encode leg (the
 * executor's claim re-measurement + the REAL ffmpeg encode).
 *
 * Honesty note: the stub tests use a controlled `SyncHttpTransport`
 * answering schema-valid envelopes over the bytes it actually receives —
 * the pair's dispatch, validation, verification, and error-mapping logic
 * runs for real; the REAL worker round trip (a served worker executing
 * real ffmpeg behind real HTTP) is the hosted package's battery's ground.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FfmpegTool,
  MediaToolchainDispatchRequest,
  MediaToolchainJobDescription,
  MediaToolchainResult,
  childProcessSyncTransport,
  createHttpEncodePair,
  executeMediaToolchainJob,
  resolveMediaToolchainBudgets,
  resolveMediaToolchainFromEnv,
  sha256OfBytes,
} from "../src/index";
import type { MediaToolchainDispatchRequest as DispatchDoc } from "../src/index";
import type { SyncHttpAnswer, SyncHttpInit, SyncHttpTransport } from "../src/index";
import { EncodingError } from "@sporta/encoding";
import { createFfmpegFrameEncoder } from "@sporta/encoding";
import type { FrameEncodeRequest } from "@sporta/encoding";
import { TacticalCodecError } from "@sporta/renderer-tactical";

/** Whether the REAL ffmpeg is usable in this environment (the live legs). */
const tool = new FfmpegTool();
const hasFfmpeg = await tool.available();

/** The tiny honest geometry: 16×16 rgb24 frames (768 bytes each — the byte-math holds exactly). */
const W = 16;
const H = 16;
const FRAME_BYTES = W * H * 3;

/** Builds N deterministic 16×16 rgb24 frames (the packed sequence under test). */
function tinyFrames(count: number): Uint8Array[] {
  return Array.from({ length: count }, (_, index) =>
    new Uint8Array(FRAME_BYTES).fill(0x40 + index * 8),
  );
}

/** A valid R306 encode request over in-memory frames (the game-3d bridge's shape). */
function frameEncodeRequest(frames: Uint8Array[], fps = 12.5): FrameEncodeRequest {
  return {
    source: { kind: "rgb24-frames", frames, width: W, height: H },
    fps,
    origin: { rendererId: "renderer-encode-seam-test", rendererVersion: "1.0", bridge: "game-3d" },
  };
}

/** The stub worker's encoded MP4-shaped payload over the bytes it received. */
function stubEncodedBytes(input: Uint8Array): Uint8Array {
  // A minimal ftyp-carrying payload (the client's playable-container magic
  // check reads bytes 4..8) whose body derives from the received bytes —
  // the stub's answer is a real function of its input, never a constant.
  const digest = Buffer.from(sha256OfBytes(input), "ascii");
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + digest.length, 0);
  head.write("ftyp", 4, "ascii");
  return new Uint8Array(Buffer.concat([head, digest]));
}

/** The stub worker's pinned codec parameters (mirroring the real adapter's vocabulary). */
const STUB_CODEC = {
  container: "mp4",
  videoCodec: "avc1.42E01E",
  encoder: "stub: rawvideo → libx264 (the pinned argv family)",
  preset: "medium",
  tune: null,
  profile: "Main",
  level: "3.1",
  crf: 18,
  pixFmt: "yuv420p",
  gop: null,
  threads: 1,
  bitexact: true,
} as const;

/** The stub worker's own adapter identity (the PRODUCER's, never the client seam's). */
const STUB_ENCODER_KIND = "stub-toolchain-frame-encoder";
const STUB_ENCODER_VERSION = "ffmpeg version stub-7.1.5 (the worker's own measured line)";

/** A schema-valid base metering block (the stub worker's answer). */
function stubMetering(overrides: Record<string, unknown> = {}) {
  return {
    startedAtMs: 1700000000000,
    finishedAtMs: 1700000000150,
    executionMs: 150,
    ffprobeRuns: 0,
    ffmpegRuns: 1,
    inputBytes: 100,
    outputBytes: 72,
    ...overrides,
  };
}

/** The worker's own honest descriptor (the pair's available()/version() source). */
function stubDescriptor(withEncode: boolean) {
  return {
    schemaVersion: "1.0",
    adapterId: "stub.compute.hosted.media",
    adapterVersion: "0.1",
    providerId: "stub-media-toolchain-worker-1",
    providerKind: "cpu-worker",
    operations: withEncode
      ? ["probe", "normalize", "decode-probe", "decode-frames", "encode-frames"]
      : ["probe", "normalize", "decode-probe", "decode-frames"],
    toolchain: {
      ffmpegPath: "/usr/bin/ffmpeg",
      ffprobePath: "/usr/bin/ffprobe",
      ffmpegVersion: STUB_ENCODER_VERSION,
      resolved: true,
    },
    budgets: {
      maxExecutionMs: 600_000,
      maxSourceBytes: 268_435_456,
      maxArtifactBytes: 268_435_456,
      maxConcurrentJobs: 1,
      maxDecodedFrameBytes: 1_073_741_824,
    },
    costUnits: [{ unitId: "cpu-ms", unitKind: "time-ms", description: "cpu milliseconds" }],
  };
}

/** One recorded transport call (the seam's own wire observations). */
interface TransportCall {
  url: string;
  init: SyncHttpInit;
  timeoutMs: number;
}

/** The dispatch bodies the stub received (asserted by the tests). */
const received: DispatchDoc[] = [];

/**
 * The controlled stub transport (the `fetchFn` precedent of the decode seam,
 * at the SYNC seam the pair injects): answers the descriptor route (GET) and
 * the execute route (POST) over the dispatch it actually receives. Modes:
 * - "ok" — the honest worker (descriptor + verified encoded envelope);
 * - "no-encode" — an honest worker whose resolution does NOT cover encode;
 * - "unreachable" — the transport fault (the unreachable-worker posture);
 * - "garbage" — a lying provider (a non-envelope result answer);
 * - "lie-hash" / "lie-size" / "lie-magic" / "lie-geometry" — lying claims
 *   over the delivered bytes (the receiving-boundary re-measure);
 * - "ffmpeg-unavailable" / "capacity" / "frames-invalid" /
 *   "duration-over-limit" / "encode-failed" — classified failure envelopes;
 * - "http-503" — the worker's refused-envelope capacity posture (non-2xx);
 * - "http-500" — a non-2xx non-JSON answer (the generic refusal).
 */
function startEncodePairStub(mode: string): {
  transport: SyncHttpTransport;
  calls: TransportCall[];
} {
  const calls: TransportCall[] = [];
  const transport: SyncHttpTransport = (url, init, bounds) => {
    calls.push({ url, init, timeoutMs: bounds.timeoutMs });
    if (mode === "unreachable") {
      throw new Error(`connect ECONNREFUSED 127.0.0.1:1 — ${url}`);
    }
    const answer = (status: number, body: unknown): SyncHttpAnswer => ({
      status,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    if (init.method === "GET") {
      return answer(200, stubDescriptor(mode !== "no-encode"));
    }
    // The execute route: answer over the dispatch actually received.
    const dispatch = MediaToolchainDispatchRequest.parse(JSON.parse(init.body ?? "{}"));
    received.push(dispatch);
    if (mode === "garbage") {
      return answer(200, { disposition: "executed", result: { nope: true } });
    }
    if (mode === "http-503") {
      return answer(503, {
        error: {
          errorClass: "capacity",
          message: "worker is at capacity — retry later",
          terminal: "resource-limit",
        },
      });
    }
    if (mode === "http-500") {
      return answer(500, "not-json-at-all");
    }
    if (mode.startsWith("lie-") === false && FAILURE_MODES[mode] !== undefined) {
      const failure = FAILURE_MODES[mode]!;
      return answer(200, {
        disposition: "executed",
        result: {
          jobId: dispatch.job.jobId,
          operation: "encode-frames",
          status: "failed",
          failure: {
            errorClass: failure.errorClass,
            message: failure.message,
            terminal: failure.terminal,
            failureClass: failure.failureClass,
            retryable: false,
          },
          metering: stubMetering({ ffmpegRuns: failure.ffmpegRuns }),
        },
      });
    }
    return answer(200, { disposition: "executed", result: encodedEnvelope(dispatch, mode) });
  };
  return { transport, calls };
}

/** The classified failure envelopes the stub answers (by mode). */
const FAILURE_MODES: Record<
  string,
  {
    errorClass: string;
    message: string;
    terminal: "non-retryable" | "timeout" | "internal";
    failureClass: string;
    ffmpegRuns: number;
  }
> = {
  "ffmpeg-unavailable": {
    errorClass: "ffmpeg-unavailable",
    message: "ffmpeg is not usable at '/nonexistent/ffmpeg' — never faked",
    terminal: "internal",
    failureClass: "internal",
    ffmpegRuns: 0,
  },
  capacity: {
    errorClass: "capacity",
    message: "the worker is executing its bounded concurrent jobs — retry later",
    terminal: "timeout",
    failureClass: "internal",
    ffmpegRuns: 0,
  },
  "frames-invalid": {
    errorClass: "frames-invalid",
    message: "the packed frame sequence's byte-math disagrees with its spec",
    terminal: "non-retryable",
    failureClass: "media-invalid",
    ffmpegRuns: 0,
  },
  "duration-over-limit": {
    errorClass: "duration-over-limit",
    message: "the encoded clip measures over the job's policy bound",
    terminal: "non-retryable",
    failureClass: "media-invalid",
    ffmpegRuns: 1,
  },
  "encode-failed": {
    errorClass: "encode-failed",
    message: "the libx264 encode subprocess failed — no artifact was produced",
    terminal: "internal",
    failureClass: "internal",
    ffmpegRuns: 1,
  },
};

/** Builds the stub's succeeded encoded envelope over the received dispatch. */
function encodedEnvelope(dispatch: DispatchDoc, mode: string) {
  const spec = dispatch.job.encodeSpec!;
  const input = new Uint8Array(Buffer.from(dispatch.source.contentBase64, "base64"));
  let bytes = stubEncodedBytes(input);
  if (mode === "lie-magic") {
    // A payload without the ftyp box magic (the claims stay honest).
    bytes = new Uint8Array(Buffer.from("not-an-mp4-container-payload-xxxxxxxxxxxxxxxxxxxx"));
  }
  const contentHash = mode === "lie-hash" ? "0".repeat(64) : sha256OfBytes(bytes);
  const byteSize = mode === "lie-size" ? bytes.byteLength + 1 : bytes.byteLength;
  const frameCount = mode === "lie-geometry" ? spec.frameCount + 1 : spec.frameCount;
  return {
    jobId: dispatch.job.jobId,
    operation: "encode-frames",
    status: "succeeded",
    encoded: {
      contentHash,
      byteSize,
      frameCount,
      width: mode === "lie-geometry" ? spec.width + 2 : spec.width,
      height: spec.height,
      fps: spec.fps,
      // The schema-enforced duration identity (over the CLAIMED frameCount).
      durationMs: Math.round((frameCount * 1000) / spec.fps),
      encoderKind: STUB_ENCODER_KIND,
      encoderVersion: STUB_ENCODER_VERSION,
      codec: STUB_CODEC,
      contentBase64: Buffer.from(bytes).toString("base64"),
    },
    metering: stubMetering({ inputBytes: input.byteLength, outputBytes: byteSize, ffmpegRuns: 1 }),
  };
}

/** Captures the pair's synchronous refusal as a typed instance (never a raw throw). */
function refusalOf(call: () => unknown): unknown {
  try {
    return { answered: call() };
  } catch (err) {
    return { refused: err };
  }
}

// ---------------------------------------------------------------------------
// 1. The wire shapes (ADDITIVE — probe/normalize/decode untouched)
// ---------------------------------------------------------------------------

describe("the encode seam's wire shapes (the authorized enum extension)", () => {
  test("an encode-frames dispatch carries its spec + the rgb24 family; the pairing laws refuse the mismatches", () => {
    const frames = tinyFrames(2);
    const packed = new Uint8Array(Buffer.concat(frames.map((frame) => Buffer.from(frame))));
    const base = {
      schemaVersion: "1.0",
      jobId: "encode-wire-job",
      idempotencyKey: "encode-wire-key",
      sessionId: "sess-encode-wire",
      source: {
        contentHash: sha256OfBytes(packed),
        byteSize: packed.byteLength,
        container: "rgb24",
      },
      rights: { policyRef: "wire-test", canReferenceSourceFrames: true },
      constraints: { deadlineMs: 120_000, priority: 0 },
      mediaPolicy: { maxDurationMs: 120_000 },
      encodeSpec: { frameCount: 2, width: W, height: H, fps: 12.5 },
    };
    // The legal shape parses (the spec rides the job, the frames ride the source).
    const legal = MediaToolchainJobDescription.safeParse({ ...base, operation: "encode-frames" });
    expect(legal.success).toBe(true);
    expect(
      MediaToolchainDispatchRequest.safeParse({
        job: legal.success ? legal.data : null,
        source: {
          inputId: "frame-sequence",
          kind: "rgb24-frames",
          contentBase64: Buffer.from(packed).toString("base64"),
        },
      }).success,
    ).toBe(true);
    // An encode-frames dispatch WITHOUT its spec is refused.
    const specOmitted = { ...base };
    delete (specOmitted as { encodeSpec?: unknown }).encodeSpec;
    expect(
      MediaToolchainJobDescription.safeParse({ ...specOmitted, operation: "encode-frames" })
        .success,
    ).toBe(false);
    // The spec is only legal on the encode rail (a probe carrying one refuses).
    expect(
      MediaToolchainJobDescription.safeParse({
        ...base,
        operation: "probe",
        source: { ...base.source, container: "mp4" },
      }).success,
    ).toBe(false);
    // The source family is paired to the operation (mp4 on encode, rgb24 on probe).
    expect(
      MediaToolchainJobDescription.safeParse({
        ...base,
        operation: "encode-frames",
        source: { ...base.source, container: "mp4" },
      }).success,
    ).toBe(false);
    // The materialized input kind is paired fail-closed (source-media on encode refuses).
    expect(
      MediaToolchainDispatchRequest.safeParse({
        job: legal.success ? legal.data : null,
        source: {
          inputId: "frame-sequence",
          kind: "source-media",
          contentBase64: Buffer.from(packed).toString("base64"),
        },
      }).success,
    ).toBe(false);
  });

  test("a succeeded encode-frames envelope carries ONLY its encoded output, metered consistently", () => {
    const payload = stubEncodedBytes(new Uint8Array([1, 2, 3]));
    const encoded = {
      contentHash: sha256OfBytes(payload),
      byteSize: payload.byteLength,
      frameCount: 2,
      width: W,
      height: H,
      fps: 12.5,
      durationMs: 160,
      encoderKind: STUB_ENCODER_KIND,
      encoderVersion: STUB_ENCODER_VERSION,
      codec: STUB_CODEC,
      contentBase64: Buffer.from(payload).toString("base64"),
    };
    const ok = MediaToolchainResult.safeParse({
      jobId: "encode-frames-ok",
      operation: "encode-frames",
      status: "succeeded",
      encoded,
      metering: stubMetering({ outputBytes: payload.byteLength }),
    });
    expect(ok.success).toBe(true);
    // A succeeded encode without its measured output is refused.
    const missing = MediaToolchainResult.safeParse({
      jobId: "encode-frames-missing",
      operation: "encode-frames",
      status: "succeeded",
      metering: stubMetering({ outputBytes: payload.byteLength }),
    });
    expect(missing.success).toBe(false);
    // A metering/output disagreement is refused (the lying-provider guard).
    const disagree = MediaToolchainResult.safeParse({
      jobId: "encode-frames-disagree",
      operation: "encode-frames",
      status: "succeeded",
      encoded,
      metering: stubMetering({ outputBytes: payload.byteLength + 1 }),
    });
    expect(disagree.success).toBe(false);
    // An encode envelope carrying a foreign operation's results is refused.
    const mixed = MediaToolchainResult.safeParse({
      jobId: "encode-frames-mixed",
      operation: "encode-frames",
      status: "succeeded",
      encoded,
      decodedFrames: { frames: [], totalBytes: 0 },
      metering: stubMetering({ outputBytes: payload.byteLength }),
    });
    expect(mixed.success).toBe(false);
  });

  test("the encoded output's duration identity is round(frameCount · 1000 / fps) — a disagreement is refused", () => {
    const payload = stubEncodedBytes(new Uint8Array([4, 5, 6]));
    const build = (durationMs: number) =>
      MediaToolchainResult.safeParse({
        jobId: "encode-duration-job",
        operation: "encode-frames",
        status: "succeeded",
        encoded: {
          contentHash: sha256OfBytes(payload),
          byteSize: payload.byteLength,
          frameCount: 2,
          width: W,
          height: H,
          fps: 12.5,
          durationMs,
          encoderKind: STUB_ENCODER_KIND,
          encoderVersion: STUB_ENCODER_VERSION,
          codec: STUB_CODEC,
          contentBase64: Buffer.from(payload).toString("base64"),
        },
        metering: stubMetering({ outputBytes: payload.byteLength }),
      });
    // 2 frames at 12.5 fps → 160 ms exactly.
    expect(build(160).success).toBe(true);
    expect(build(161).success).toBe(false);
    expect(build(200).success).toBe(false);
  });

  test("the additive law: pre-extension envelopes and dispatches still parse (the optional encode fields)", () => {
    // A legacy probe envelope (no encode fields anywhere).
    const legacyProbe = MediaToolchainResult.safeParse({
      jobId: "legacy-probe",
      operation: "probe",
      status: "succeeded",
      sourceProbe: {
        durationMs: 2000,
        videoStreams: [{ index: 0, codec_type: "video", codec_name: "h264" }],
        audioStreams: [],
        frameRateFps: 25,
        frameCount: 50,
        raw: {},
      },
      metering: stubMetering({ ffmpegRuns: 0, outputBytes: 0 }),
    });
    expect(legacyProbe.success).toBe(true);
    expect(legacyProbe.success && legacyProbe.data.encoded).toBeUndefined();
    // A legacy decode-frames envelope (the pre-extension seam's own shape).
    const legacyDecode = MediaToolchainResult.safeParse({
      jobId: "legacy-decode-frames",
      operation: "decode-frames",
      status: "succeeded",
      decodedFrames: { frames: [], totalBytes: 0 },
      metering: stubMetering({
        ffmpegRuns: 1,
        outputBytes: 0,
        decodedFrames: 0,
        decodedFrameBytes: 0,
      }),
    });
    expect(legacyDecode.success).toBe(true);
    expect(legacyDecode.success && legacyDecode.data.encoded).toBeUndefined();
    // A legacy probe dispatch (the mp4 source family, the source-media input kind).
    const legacyDispatch = MediaToolchainDispatchRequest.safeParse({
      job: {
        schemaVersion: "1.0",
        jobId: "legacy-dispatch",
        idempotencyKey: "legacy-dispatch-key",
        sessionId: "sess-legacy",
        operation: "probe",
        source: { contentHash: sha256OfBytes(new Uint8Array([7])), byteSize: 1, container: "mp4" },
        rights: { policyRef: "legacy-test", canReferenceSourceFrames: true },
        constraints: { deadlineMs: 120_000, priority: 0 },
        mediaPolicy: { maxDurationMs: 120_000 },
      },
      source: {
        inputId: "source-media",
        kind: "source-media",
        contentBase64: Buffer.from([7]).toString("base64"),
      },
    });
    expect(legacyDispatch.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. The http encode pair (the client half of the seam — the TWO surfaces)
// ---------------------------------------------------------------------------

describe("the http encode pair (controlled stub — the client half of the seam)", () => {
  test("the R306 FrameEncoderPort: ONE encode-frames job per encode, the claims CLIENT-measured, the identity PRODUCER-owned", () => {
    received.length = 0;
    const { transport, calls } = startEncodePairStub("ok");
    const pair = createHttpEncodePair("http://stub-worker.example", { transport });
    const frames = tinyFrames(2);
    const packed = new Uint8Array(Buffer.concat(frames.map((frame) => Buffer.from(frame))));
    const result = pair.frameEncoder.encode(frameEncodeRequest(frames));

    // The result is the R306 FrameEncodeResult over the re-verified delivery.
    expect(result.byteSize).toBe(result.bytes.byteLength);
    expect(result.contentHash).toBe(sha256OfBytes(result.bytes));
    expect(result.frameCount).toBe(2);
    expect(result.width).toBe(W);
    expect(result.height).toBe(H);
    expect(result.fps).toBe(12.5);
    expect(result.durationMs).toBe(160);
    // The PRODUCER's identity (the worker's own adapter — never this seam).
    expect(result.encoderKind).toBe(STUB_ENCODER_KIND);
    expect(result.encoderVersion).toBe(STUB_ENCODER_VERSION);
    expect(result.codec).toEqual(STUB_CODEC);
    // The seam's own identity (the port surface, not the produced bytes').
    expect(pair.frameEncoder.kind).toBe("http-toolchain-frame-encoder");

    // The dispatch: exactly ONE execute POST, carrying the client's OWN
    // measured claims over the packed frames (the worker re-measures both).
    expect(received.length).toBe(1);
    const dispatch = received[0]!;
    expect(dispatch.job.operation).toBe("encode-frames");
    expect(dispatch.job.encodeSpec).toEqual({ frameCount: 2, width: W, height: H, fps: 12.5 });
    expect(dispatch.job.source.contentHash).toBe(sha256OfBytes(packed));
    expect(dispatch.job.source.byteSize).toBe(packed.byteLength);
    expect(dispatch.job.source.container).toBe("rgb24");
    expect(dispatch.source.kind).toBe("rgb24-frames");
    expect(dispatch.source.inputId).toBe("frame-sequence");
    expect(dispatch.source.contentBase64).toBe(Buffer.from(packed).toString("base64"));
    // The frame stream's provenance rides the session linkage.
    expect(dispatch.job.sessionId).toBe("renderer-encode-seam-test");
    // The rights posture: the encode references the dispatch's own frames.
    expect(dispatch.job.rights.canReferenceSourceFrames).toBe(true);
    // Generated job identity (the idempotence pair, distinct).
    expect(dispatch.job.jobId).toMatch(/^mtenc-[0-9a-f]{32}$/);
    expect(dispatch.job.idempotencyKey).toMatch(/^mtenc-key-[0-9a-f]{32}$/);
    expect(dispatch.job.jobId).not.toBe(dispatch.job.idempotencyKey);
    // The dispatch's own bounds (the deadline the transport received).
    const executeCalls = calls.filter((call) => call.init.method === "POST");
    expect(executeCalls.length).toBe(1);
    expect(executeCalls[0]!.url).toBe("http://stub-worker.example/v1/media/jobs/execute");
    expect(executeCalls[0]!.timeoutMs).toBe(120_000);
  });

  test("the R301 TacticalVideoCodec rides the SAME wire operation (the one-operation law)", async () => {
    received.length = 0;
    const { transport, calls } = startEncodePairStub("ok");
    const pair = createHttpEncodePair("http://stub-worker.example", { transport });
    const frames = tinyFrames(3);
    const packed = new Uint8Array(Buffer.concat(frames.map((frame) => Buffer.from(frame))));
    const scratch = await mkdtemp(join(tmpdir(), "sporta-encode-seam-"));
    try {
      const staged = join(scratch, "frames.rgb24");
      await writeFile(staged, packed);
      const buffer = pair.tacticalCodec.encode({
        rawFrameSequencePath: staged,
        frameCount: 3,
        width: W,
        height: H,
        fps: 12.5,
      });
      // The codec's frozen contract: MP4 Buffer, never partial video.
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.subarray(4, 8).toString("ascii")).toBe("ftyp");
      expect(buffer.byteLength).toBe(stubEncodedBytes(packed).byteLength);
      // The SAME wire operation (one encode-frames dispatch, the codec's
      // session linkage — the tactical prototype's own renderer id).
      expect(received.length).toBe(1);
      expect(received[0]!.job.operation).toBe("encode-frames");
      expect(received[0]!.job.encodeSpec).toEqual({
        frameCount: 3,
        width: W,
        height: H,
        fps: 12.5,
      });
      expect(received[0]!.job.source.contentHash).toBe(sha256OfBytes(packed));
      expect(received[0]!.job.sessionId).toBe("tactical.prototype");
      expect(received[0]!.source.contentBase64).toBe(Buffer.from(packed).toString("base64"));
      // The codec's seam identity (its own surface, not the encoder's).
      expect(pair.tacticalCodec.kind).toBe("http-toolchain-h264-codec");
      expect(calls.filter((call) => call.init.method === "POST").length).toBe(1);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  test("available()/version() answer the worker's OWN descriptor — ONE cached probe for both surfaces", () => {
    const { transport, calls } = startEncodePairStub("ok");
    const pair = createHttpEncodePair("http://stub-worker.example", { transport });
    expect(pair.frameEncoder.available()).toBe(true);
    expect(pair.tacticalCodec.available()).toBe(true);
    // The version is the WORKER's own measured line (never the seam's).
    expect(pair.frameEncoder.version()).toBe(STUB_ENCODER_VERSION);
    expect(pair.tacticalCodec.version()).toBe(STUB_ENCODER_VERSION);
    // The probe is cached per pair: both surfaces, repeated calls — ONE GET.
    const gets = calls.filter((call) => call.init.method === "GET");
    expect(gets.length).toBe(1);
    expect(gets[0]!.url).toBe("http://stub-worker.example/v1/media/adapter");
    expect(gets[0]!.timeoutMs).toBe(10_000);
  });

  test("a worker whose resolution does not cover the encode operation is honestly unavailable", () => {
    const { transport } = startEncodePairStub("no-encode");
    const pair = createHttpEncodePair("http://stub-worker.example", { transport });
    // The descriptor parses, advertises its four operations — but NOT the
    // encode rail: the pair answers the honest resolution, never a fake yes.
    expect(pair.frameEncoder.available()).toBe(false);
    expect(pair.tacticalCodec.available()).toBe(false);
    expect(pair.frameEncoder.version()).toBeNull();
    expect(pair.tacticalCodec.version()).toBeNull();
  });

  test("an unreachable worker answers available()=false / version()=null — the cached null probe, never a throw", () => {
    const { transport, calls } = startEncodePairStub("unreachable");
    const pair = createHttpEncodePair("http://stub-worker.example", { transport });
    expect(pair.frameEncoder.available()).toBe(false);
    expect(pair.tacticalCodec.available()).toBe(false);
    expect(pair.frameEncoder.version()).toBeNull();
    // The failed probe is cached too (repeated asks, no second transport call).
    expect(pair.tacticalCodec.version()).toBeNull();
    expect(calls.length).toBe(1);
  });

  test("a lying provider (a non-MediaToolchainResult answer) is the typed refusal, never trusted", () => {
    const { transport } = startEncodePairStub("garbage");
    const pair = createHttpEncodePair("http://stub-worker.example", { transport });
    const outcome = refusalOf(() =>
      pair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2))),
    ) as {
      refused?: unknown;
    };
    const refusal = outcome.refused as EncodingError;
    expect(refusal).toBeInstanceOf(EncodingError);
    expect(refusal.failureClass).toBe("internal");
    expect(refusal.kind).toBe("encode-failed");
    expect(refusal.message).toContain("not a MediaToolchainResult");
  });

  test("the delivered bytes are re-hashed and re-measured at the receiving boundary (sha-256, byte length, ftyp magic)", () => {
    for (const mode of ["lie-hash", "lie-size", "lie-magic"]) {
      const { transport } = startEncodePairStub(mode);
      const pair = createHttpEncodePair("http://stub-worker.example", { transport });
      const outcome = refusalOf(() =>
        pair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2))),
      ) as {
        refused?: unknown;
      };
      const refusal = outcome.refused as EncodingError;
      expect(refusal).toBeInstanceOf(EncodingError);
      // The artifact axis (never interpreted, never stored).
      expect(refusal.kind).toBe("artifact-invalid");
      expect(refusal.failureClass).toBe("internal");
      if (mode === "lie-hash") {
        expect(refusal.message).toContain("hash to");
        expect(refusal.message).toContain(refusal.details["claimed"] as string);
      }
      if (mode === "lie-size") {
        expect(refusal.message).toContain("measure");
        expect(refusal.message).toContain("claims");
      }
      if (mode === "lie-magic") {
        expect(refusal.message).toContain("ftyp");
      }
    }
  });

  test("the encoded geometry is re-measured against the dispatched spec (a lying claim is never interpreted)", () => {
    const { transport } = startEncodePairStub("lie-geometry");
    const pair = createHttpEncodePair("http://stub-worker.example", { transport });
    const outcome = refusalOf(() =>
      pair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2))),
    ) as {
      refused?: unknown;
    };
    const refusal = outcome.refused as EncodingError;
    expect(refusal).toBeInstanceOf(EncodingError);
    expect(refusal.kind).toBe("artifact-invalid");
    expect(refusal.message).toContain("disagrees with the dispatched spec");
  });

  test("classified failures map onto the ENCODING plane's typed errors by the envelope's own classes", () => {
    // The boundary class (the local adapter's own missing-binary class).
    const unavailable = startEncodePairStub("ffmpeg-unavailable");
    const unavailablePair = createHttpEncodePair("http://stub-worker.example", {
      transport: unavailable.transport,
    });
    const unavailableRefusal = (
      refusalOf(() => unavailablePair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2)))) as {
        refused?: unknown;
      }
    ).refused as EncodingError;
    expect(unavailableRefusal).toBeInstanceOf(EncodingError);
    expect(unavailableRefusal.failureClass).toBe("resource-limit");
    expect(unavailableRefusal.kind).toBe("encoder-unavailable");
    expect(unavailableRefusal.message).toContain("never faked");

    // The honest transient-unavailable posture (the worker at capacity).
    const capacity = startEncodePairStub("capacity");
    const capacityPair = createHttpEncodePair("http://stub-worker.example", {
      transport: capacity.transport,
    });
    const capacityRefusal = (
      refusalOf(() => capacityPair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2)))) as {
        refused?: unknown;
      }
    ).refused as EncodingError;
    expect(capacityRefusal).toBeInstanceOf(EncodingError);
    expect(capacityRefusal.failureClass).toBe("resource-limit");
    expect(capacityRefusal.kind).toBe("encoder-unavailable");
    // The classified failure carries the envelope's own message (the
    // errorClass rides the details — the non-2xx path prefixes it instead).
    expect(capacityRefusal.message).toContain("bounded concurrent jobs");
    expect(capacityRefusal.details).toMatchObject({ errorClass: "capacity", terminal: "timeout" });

    // The admission axis (the LOCAL adapter's own frames-invalid class).
    const framesInvalid = startEncodePairStub("frames-invalid");
    const framesPair = createHttpEncodePair("http://stub-worker.example", {
      transport: framesInvalid.transport,
    });
    const framesRefusal = (
      refusalOf(() => framesPair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2)))) as {
        refused?: unknown;
      }
    ).refused as EncodingError;
    expect(framesRefusal).toBeInstanceOf(EncodingError);
    expect(framesRefusal.failureClass).toBe("media-invalid");
    expect(framesRefusal.kind).toBe("frames-invalid");

    // The duration-policy axis (the media-invalid admission family).
    const duration = startEncodePairStub("duration-over-limit");
    const durationPair = createHttpEncodePair("http://stub-worker.example", {
      transport: duration.transport,
    });
    const durationRefusal = (
      refusalOf(() => durationPair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2)))) as {
        refused?: unknown;
      }
    ).refused as EncodingError;
    expect(durationRefusal).toBeInstanceOf(EncodingError);
    expect(durationRefusal.failureClass).toBe("media-invalid");
    expect(durationRefusal.kind).toBe("frames-invalid");

    // The encode-failure axis (everything else, carrying the envelope's class).
    const failed = startEncodePairStub("encode-failed");
    const failedPair = createHttpEncodePair("http://stub-worker.example", {
      transport: failed.transport,
    });
    const failedRefusal = (
      refusalOf(() => failedPair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2)))) as {
        refused?: unknown;
      }
    ).refused as EncodingError;
    expect(failedRefusal).toBeInstanceOf(EncodingError);
    expect(failedRefusal.failureClass).toBe("internal");
    expect(failedRefusal.kind).toBe("encode-failed");
    expect(failedRefusal.message).toContain("encode-failed");
  });

  test("non-2xx answers map onto the typed errors (the worker's classified refusal body)", () => {
    // The refused-envelope capacity posture (the real worker's 503 shape).
    const capacity = startEncodePairStub("http-503");
    const capacityPair = createHttpEncodePair("http://stub-worker.example", {
      transport: capacity.transport,
    });
    const capacityRefusal = (
      refusalOf(() => capacityPair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2)))) as {
        refused?: unknown;
      }
    ).refused as EncodingError;
    expect(capacityRefusal).toBeInstanceOf(EncodingError);
    expect(capacityRefusal.failureClass).toBe("resource-limit");
    expect(capacityRefusal.kind).toBe("encoder-unavailable");
    expect(capacityRefusal.message).toContain("capacity");

    // A non-JSON 500 answer: the generic refusal, honestly carried.
    const server = startEncodePairStub("http-500");
    const serverPair = createHttpEncodePair("http://stub-worker.example", {
      transport: server.transport,
    });
    const serverRefusal = (
      refusalOf(() => serverPair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2)))) as {
        refused?: unknown;
      }
    ).refused as EncodingError;
    expect(serverRefusal).toBeInstanceOf(EncodingError);
    expect(serverRefusal.failureClass).toBe("internal");
    expect(serverRefusal.kind).toBe("encode-failed");
    expect(serverRefusal.message).toContain("http-500");
    expect(serverRefusal.message).toContain("HTTP 500");
  });

  test("transport faults are the typed encoder-unavailable class; a typed transport refusal passes through unchanged", () => {
    // An unexpected transport fault (the unreachable-worker posture, never silence).
    const { transport } = startEncodePairStub("unreachable");
    const pair = createHttpEncodePair("http://stub-worker.example", { transport });
    const outcome = refusalOf(() =>
      pair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2))),
    ) as {
      refused?: unknown;
    };
    const refusal = outcome.refused as EncodingError;
    expect(refusal).toBeInstanceOf(EncodingError);
    expect(refusal.failureClass).toBe("resource-limit");
    expect(refusal.kind).toBe("encoder-unavailable");
    expect(refusal.message).toContain("unreachable");

    // A TYPED transport refusal (the default transport's own kill/unreachable
    // classes) passes through verbatim — the same instance, never re-wrapped.
    const marker = new EncodingError(
      "internal",
      "encode-failed",
      "the typed transport refusal (the passthrough marker)",
    );
    const passthrough: SyncHttpTransport = () => {
      throw marker;
    };
    const passthroughPair = createHttpEncodePair("http://stub-worker.example", {
      transport: passthrough,
    });
    const passthroughOutcome = refusalOf(() =>
      passthroughPair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2))),
    ) as { refused?: unknown };
    expect(passthroughOutcome.refused).toBe(marker);
  });

  test("the client-side admission refuses a malformed frame sequence BEFORE any bytes cross the wire", () => {
    const { transport, calls } = startEncodePairStub("ok");
    const pair = createHttpEncodePair("http://stub-worker.example", { transport });
    // Dimensions below the adapter's own bound.
    const small = refusalOf(() =>
      pair.frameEncoder.encode({
        ...frameEncodeRequest(tinyFrames(2)),
        source: { kind: "rgb24-frames", frames: tinyFrames(2), width: 15, height: 15 },
      }),
    ) as { refused?: unknown };
    expect(small.refused as EncodingError).toBeInstanceOf(EncodingError);
    expect((small.refused as EncodingError).failureClass).toBe("media-invalid");
    expect((small.refused as EncodingError).kind).toBe("frames-invalid");
    // Odd dimensions (yuv420p chroma subsampling).
    const odd = refusalOf(() =>
      pair.frameEncoder.encode({
        ...frameEncodeRequest(tinyFrames(2)),
        source: { kind: "rgb24-frames", frames: tinyFrames(2), width: 17, height: 16 },
      }),
    ) as { refused?: unknown };
    expect((odd.refused as EncodingError).kind).toBe("frames-invalid");
    // A frame of the wrong byte length (the packed byte-math).
    const shortFrames = [new Uint8Array(FRAME_BYTES), new Uint8Array(FRAME_BYTES - 1)];
    const shortBytes = refusalOf(() =>
      pair.frameEncoder.encode({
        ...frameEncodeRequest(shortFrames),
        source: { kind: "rgb24-frames", frames: shortFrames, width: W, height: H },
      }),
    ) as { refused?: unknown };
    expect((shortBytes.refused as EncodingError).kind).toBe("frames-invalid");
    // A zero-frame sequence (frameCount >= 1).
    const empty = refusalOf(() => pair.frameEncoder.encode(frameEncodeRequest([]))) as {
      refused?: unknown;
    };
    expect((empty.refused as EncodingError).kind).toBe("frames-invalid");
    // An fps at or below zero.
    const zeroFps = refusalOf(() =>
      pair.frameEncoder.encode(frameEncodeRequest(tinyFrames(2), 0)),
    ) as {
      refused?: unknown;
    };
    expect((zeroFps.refused as EncodingError).kind).toBe("frames-invalid");
    // NOTHING crossed the wire (the fail-before-transport law).
    expect(calls.length).toBe(0);
  });

  test("the tactical codec's own frozen error family: the typed refusal is carried, never lost", async () => {
    // A staged file that does not exist (the codec's own admission).
    const { transport } = startEncodePairStub("ok");
    const pair = createHttpEncodePair("http://stub-worker.example", { transport });
    const missing = refusalOf(() =>
      pair.tacticalCodec.encode({
        rawFrameSequencePath: "/nonexistent/staged-frames.rgb24",
        frameCount: 2,
        width: W,
        height: H,
        fps: 12.5,
      }),
    ) as { refused?: unknown };
    expect(missing.refused).toBeInstanceOf(TacticalCodecError);
    expect((missing.refused as TacticalCodecError).message).toContain("could not be read");

    // A staged file whose size disagrees with the spec's byte-math.
    const scratch = await mkdtemp(join(tmpdir(), "sporta-encode-seam-"));
    try {
      const staged = join(scratch, "short.rgb24");
      await writeFile(staged, new Uint8Array(FRAME_BYTES));
      const mismatched = refusalOf(() =>
        pair.tacticalCodec.encode({
          rawFrameSequencePath: staged,
          frameCount: 2,
          width: W,
          height: H,
          fps: 12.5,
        }),
      ) as { refused?: unknown };
      expect(mismatched.refused).toBeInstanceOf(TacticalCodecError);
      expect((mismatched.refused as TacticalCodecError).message).toContain("exactly frameCount");

      // The underlying ENCODING refusal re-mapped onto the codec's family:
      // the failureClass/kind ride the details, never lost.
      const lying = startEncodePairStub("lie-hash");
      const lyingPair = createHttpEncodePair("http://stub-worker.example", {
        transport: lying.transport,
      });
      const full = join(scratch, "frames.rgb24");
      const frames = tinyFrames(2);
      await writeFile(full, Buffer.concat(frames.map((frame) => Buffer.from(frame))));
      const remapped = refusalOf(() =>
        lyingPair.tacticalCodec.encode({
          rawFrameSequencePath: full,
          frameCount: 2,
          width: W,
          height: H,
          fps: 12.5,
        }),
      ) as { refused?: unknown };
      const codecRefusal = remapped.refused as TacticalCodecError;
      expect(codecRefusal).toBeInstanceOf(TacticalCodecError);
      expect(codecRefusal).not.toBeInstanceOf(EncodingError);
      expect(codecRefusal.details).toMatchObject({
        failureClass: "internal",
        kind: "artifact-invalid",
      });
      expect(codecRefusal.message).toContain("hash to");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The bounded sync subprocess transport (the spawnSync default — the
//    frozen-SYNC surfaces' async-wire bridge, measured against a helper
//    worker in a SEPARATE process)
// ---------------------------------------------------------------------------

/**
 * The helper worker script (a SEPARATE bun child): the sync transport
 * blocks THIS process's event loop, so the HTTP server it talks to cannot
 * live in-process — the helper serves on an ephemeral port and prints
 * `PORT <n>` on stdout before serving.
 */
const HELPER_WORKER_SCRIPT = `
const server = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/slow") {
      await Bun.sleep(1500);
      return new Response("late-but-never-interpreted");
    }
    if (path === "/teapot") {
      return Response.json({ error: { errorClass: "teapot" } }, { status: 418 });
    }
    if (request.method === "GET") {
      return Response.json({ adapter: "helper", route: path });
    }
    const body = await request.text();
    return Response.json({ route: path, method: request.method, receivedBytes: body.length });
  },
});
process.stdout.write("PORT " + server.port + "\\n");
`;

/** Starts the helper worker child; resolves its base URL once reachable. */
async function startHelperWorker(): Promise<{ url: string; stop: () => Promise<void> }> {
  const child = Bun.spawn({
    cmd: [process.execPath, "-e", HELPER_WORKER_SCRIPT],
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const reader = child.stdout.getReader();
  const { value } = await reader.read();
  const portLine = new TextDecoder().decode(value ?? new Uint8Array());
  const port = Number(/^PORT (\d+)$/.exec(portLine.trim())?.[1]);
  expect(Number.isInteger(port) && port > 0).toBe(true);
  const url = `http://127.0.0.1:${port}`;
  // Bounded readiness (the child boots in tens of ms; never hang forever).
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
    try {
      const probe = await fetch(`${url}/v1/media/adapter`);
      ready = probe.status === 200;
    } catch {
      await Bun.sleep(50);
    }
  }
  expect(ready).toBe(true);
  return {
    url,
    stop: async () => {
      child.kill();
      await child.exited;
    },
  };
}

describe("the bounded sync subprocess transport (the spawnSync default — the script's contract)", () => {
  test("the child's contract: the request body rides stdin, the answer is the STATUS line + body", async () => {
    const { url, stop } = await startHelperWorker();
    try {
      // A GET (the descriptor probe's shape): status + JSON body parsed.
      const get = childProcessSyncTransport(
        `${url}/v1/media/adapter`,
        { method: "GET" },
        { timeoutMs: 10_000 },
      );
      expect(get.status).toBe(200);
      expect(JSON.parse(get.body)).toEqual({ adapter: "helper", route: "/v1/media/adapter" });

      // A POST (the dispatch's shape): the body crosses stdin VERBATIM and
      // the method rides the child's argv (the -e evaluation contract).
      const body = JSON.stringify({ job: { jobId: "j-contract" }, pad: "x".repeat(64) });
      const post = childProcessSyncTransport(
        `${url}/v1/media/jobs/execute`,
        { method: "POST", body },
        { timeoutMs: 10_000 },
      );
      expect(post.status).toBe(200);
      const parsed = JSON.parse(post.body) as {
        route: string;
        method: string;
        receivedBytes: number;
      };
      expect(parsed.route).toBe("/v1/media/jobs/execute");
      expect(parsed.method).toBe("POST");
      expect(parsed.receivedBytes).toBe(body.length);

      // A non-2xx status rides the SAME STATUS line (parsed honestly — the
      // status is never laundered to 200).
      const teapot = childProcessSyncTransport(
        `${url}/teapot`,
        { method: "GET" },
        { timeoutMs: 10_000 },
      );
      expect(teapot.status).toBe(418);
      expect(JSON.parse(teapot.body)).toEqual({ error: { errorClass: "teapot" } });
    } finally {
      await stop();
    }
  });

  test("an unreachable worker is the typed encoder-unavailable refusal (the child's honest exit 3)", () => {
    const outcome = refusalOf(() =>
      childProcessSyncTransport(
        "http://127.0.0.1:1/v1/media/adapter",
        { method: "GET" },
        { timeoutMs: 10_000 },
      ),
    ) as { refused?: unknown };
    const refusal = outcome.refused as EncodingError;
    expect(refusal).toBeInstanceOf(EncodingError);
    expect(refusal.failureClass).toBe("resource-limit");
    expect(refusal.kind).toBe("encoder-unavailable");
    expect(refusal.message).toContain("unreachable");
  });

  test("a child that outlives its bound is refused typed (the bounded-kill discipline)", async () => {
    const { url, stop } = await startHelperWorker();
    try {
      const boundMs = 400;
      const startedAt = Date.now();
      const outcome = refusalOf(() =>
        childProcessSyncTransport(`${url}/slow`, { method: "GET" }, { timeoutMs: boundMs }),
      ) as { refused?: unknown };
      const refusal = outcome.refused as EncodingError;
      // The typed refusal: the bound is named, nothing was produced.
      expect(refusal).toBeInstanceOf(EncodingError);
      expect(refusal.failureClass).toBe("internal");
      expect(refusal.kind).toBe("encode-failed");
      expect(refusal.message).toContain(`exceeded its ${boundMs} ms bound`);
      // Measured honesty (bun 1.3.14): the child's fetch resolved at ~1.5 s
      // (the helper's slow route) and the refusal surfaced THEN — bun's
      // spawnSync defers the kill to the child's own exit, so the wall is
      // the CHILD's lifetime, not the bound. The refusal is still typed, the
      // child is still reaped synchronously, and no answer is interpreted.
      // (Under node the bound holds exactly: the child is SIGKILLed at the
      // bound — measured in the evidence battery; the never-exiting-child
      // case is recorded there too.)
      const wallMs = Date.now() - startedAt;
      expect(wallMs).toBeLessThan(10_000);
    } finally {
      await stop();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The worker-side encode leg (the executor — the seam's receiving boundary)
// ---------------------------------------------------------------------------

/** Builds one honest encode-frames dispatch over the packed frames. */
function encodeDispatchOf(frames: Uint8Array[], jobId: string): DispatchDoc {
  const packed = new Uint8Array(Buffer.concat(frames.map((frame) => Buffer.from(frame))));
  return MediaToolchainDispatchRequest.parse({
    job: {
      schemaVersion: "1.0",
      jobId,
      idempotencyKey: `${jobId}-key`,
      sessionId: "sess-encode-seam-executor",
      operation: "encode-frames",
      source: {
        contentHash: sha256OfBytes(packed),
        byteSize: packed.byteLength,
        container: "rgb24",
      },
      rights: { policyRef: "derived-reality/encode-seam", canReferenceSourceFrames: true },
      constraints: { deadlineMs: 120_000, priority: 0 },
      mediaPolicy: { maxDurationMs: 120_000 },
      encodeSpec: { frameCount: frames.length, width: W, height: H, fps: 12.5 },
    },
    source: {
      inputId: "frame-sequence",
      kind: "rgb24-frames",
      contentBase64: Buffer.from(packed).toString("base64"),
    },
  });
}

/** The executor deps over the REAL resolved tool (a real clock injected). */
function executorDeps(): {
  tool: FfmpegTool;
  nowMs: () => number;
  budgets: ReturnType<typeof resolveMediaToolchainBudgets>;
} {
  return { tool, nowMs: Date.now, budgets: resolveMediaToolchainBudgets({}) };
}

describe("the worker-side encode leg (the executor — the receiving boundary of the seam)", () => {
  test.skipIf(!hasFfmpeg)(
    "the REAL encode leg: the envelope's claims re-verify against the delivered bytes",
    async () => {
      const result = await executeMediaToolchainJob(
        encodeDispatchOf(tinyFrames(2), "exec-encode-real-001"),
        executorDeps(),
      );
      expect(result.status).toBe("succeeded");
      expect(result.operation).toBe("encode-frames");
      const encoded = result.encoded!;
      const delivered = new Uint8Array(Buffer.from(encoded.contentBase64, "base64"));
      // Every claim re-measured (the same discipline the client applies).
      expect(sha256OfBytes(delivered)).toBe(encoded.contentHash);
      expect(delivered.byteLength).toBe(encoded.byteSize);
      expect(String.fromCharCode(...delivered.subarray(4, 8))).toBe("ftyp");
      expect(encoded.frameCount).toBe(2);
      expect(encoded.width).toBe(W);
      expect(encoded.height).toBe(H);
      expect(encoded.fps).toBe(12.5);
      expect(encoded.durationMs).toBe(160);
      // The REAL producer's identity (the local path's own adapter kind).
      expect(encoded.encoderKind).toBe("ffmpeg-libx264");
      expect(encoded.encoderVersion).toContain("ffmpeg version");
      // The metering: the ONE real encode run + the honest byte accounting.
      expect(result.metering.ffmpegRuns).toBe(1);
      expect(result.metering.inputBytes).toBe(2 * FRAME_BYTES);
      expect(result.metering.outputBytes).toBe(encoded.byteSize);
      // The envelope itself parses (the fail-loud self-check).
      expect(MediaToolchainResult.safeParse(result).success).toBe(true);
    },
  );

  test.skipIf(!hasFfmpeg)(
    "the byte-drift law: the executor's encode is byte-identical to the LOCAL adapter's",
    async () => {
      // The SAME mechanical adapter the local path runs — the remote bytes
      // cannot drift (measured, not asserted by construction). The honest
      // factory answers `null` when ffmpeg is unavailable — unreachable
      // under the skip guard, but never assumed away: the fail-loud refusal.
      const localEncoder = createFfmpegFrameEncoder();
      if (localEncoder === null) {
        throw new Error(
          "the local ffmpeg frame encoder was probed unavailable despite hasFfmpeg — the drift-law measurement is refused, never faked",
        );
      }
      const frames = tinyFrames(2);
      const local = localEncoder.encode({
        source: { kind: "rgb24-frames", frames, width: W, height: H },
        fps: 12.5,
        origin: { rendererId: "drift-law-probe", rendererVersion: "1.0", bridge: "game-3d" },
      });
      const result = await executeMediaToolchainJob(
        encodeDispatchOf(frames, "exec-encode-drift-001"),
        executorDeps(),
      );
      expect(result.status).toBe("succeeded");
      expect(result.encoded!.contentHash).toBe(local.contentHash);
      expect(result.encoded!.byteSize).toBe(local.byteSize);
      expect(result.encoded!.codec).toEqual(local.codec);
    },
  );

  test("lying client claims are refused fail-closed (size, then hash — never interpreted)", async () => {
    const dispatch = encodeDispatchOf(tinyFrames(2), "exec-encode-lie-001");
    // A lying byte-size claim: the re-measure refuses BEFORE any tool runs.
    const lieSize = MediaToolchainDispatchRequest.parse({
      ...dispatch,
      job: {
        ...dispatch.job,
        source: { ...dispatch.job.source, byteSize: dispatch.job.source.byteSize + 1 },
      },
    });
    const sizeRefusal = await executeMediaToolchainJob(lieSize, executorDeps());
    expect(sizeRefusal.status).toBe("failed");
    expect(sizeRefusal.failure!.errorClass).toBe("source-size-mismatch");
    expect(sizeRefusal.failure!.failureClass).toBe("internal");
    expect(sizeRefusal.metering.ffmpegRuns).toBe(0);
    // A lying content-hash claim: same fail-closed axis.
    const lieHash = MediaToolchainDispatchRequest.parse({
      ...dispatch,
      job: {
        ...dispatch.job,
        source: { ...dispatch.job.source, contentHash: "0".repeat(64) },
      },
    });
    const hashRefusal = await executeMediaToolchainJob(lieHash, executorDeps());
    expect(hashRefusal.status).toBe("failed");
    expect(hashRefusal.failure!.errorClass).toBe("source-hash-mismatch");
    expect(hashRefusal.metering.ffmpegRuns).toBe(0);
  });

  test("a null-resolved encoder refuses with the honest ffmpeg-unavailable class (never faked)", async () => {
    const dispatch = encodeDispatchOf(tinyFrames(2), "exec-encode-null-001");
    const result = await executeMediaToolchainJob(dispatch, {
      ...executorDeps(),
      frameEncoder: null,
    });
    expect(result.status).toBe("failed");
    expect(result.failure!.errorClass).toBe("ffmpeg-unavailable");
    expect(result.failure!.failureClass).toBe("internal");
    expect(result.failure!.message).toContain("never faked");
    // No encode ran (the honest metering).
    expect(result.metering.ffmpegRuns).toBe(0);
  });

  test.skipIf(!hasFfmpeg)(
    "the adapter's byte-math admission refuses a spec that disagrees with the bytes",
    async () => {
      const dispatch = encodeDispatchOf(tinyFrames(2), "exec-encode-spec-001");
      // The claims stay honest (size + hash over the real bytes); the SPEC
      // lies about the frame count: 1536 bytes cannot be 3 frames of 16×16.
      const lyingSpec = MediaToolchainDispatchRequest.parse({
        ...dispatch,
        job: { ...dispatch.job, encodeSpec: { ...dispatch.job.encodeSpec!, frameCount: 3 } },
      });
      const result = await executeMediaToolchainJob(lyingSpec, executorDeps());
      expect(result.status).toBe("failed");
      expect(result.failure!.errorClass).toBe("frames-invalid");
      expect(result.failure!.failureClass).toBe("media-invalid");
    },
  );
});

// ---------------------------------------------------------------------------
// 5. The env-driven encode-pair selection (the composition root)
// ---------------------------------------------------------------------------

describe("the env-driven encode-pair selection (composition root)", () => {
  test("in-process (the default) wires NO encode pair — the plane's own LOCAL path", () => {
    const resolved = resolveMediaToolchainFromEnv({ env: {} });
    expect(resolved.toolchain).toBe("in-process");
    expect(resolved.encodePair).toBeUndefined();
  });

  test("http wires BOTH encode surfaces against the same worker URL (the injected transport rides)", () => {
    const { transport, calls } = startEncodePairStub("ok");
    const resolved = resolveMediaToolchainFromEnv({
      env: { MEDIA_TOOLCHAIN: "http", MEDIA_TOOLCHAIN_URL: "http://stub-worker.example" },
      encodeTransport: transport,
    });
    expect(resolved.toolchain).toBe("http");
    expect(resolved.workerUrl).toBe("http://stub-worker.example");
    expect(resolved.encodePair).toBeDefined();
    // BOTH surfaces over the one pair — and the injected transport answers
    // the shared descriptor probe (the wiring is live, not just typed).
    expect(resolved.encodePair!.frameEncoder.available()).toBe(true);
    expect(resolved.encodePair!.tacticalCodec.available()).toBe(true);
    expect(calls.filter((call) => call.init.method === "GET").length).toBe(1);
  });
});
