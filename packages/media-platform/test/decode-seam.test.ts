/**
 * THE R607 GAP 1 DECODE SEAM TESTS (the TL-authorized additive extension):
 * the wire shapes (the `decode-probe`/`decode-frames` enum extension, the
 * bounded window, the base64 frame batch, the frame-budget axis — probe and
 * normalize untouched), and the HTTP DECODE PORT against a controlled stub
 * worker speaking the wire schema (the W102-typed error mapping, the
 * lying-provider and transport-fault postures, the client-side budget
 * enforcement — the REAL worker round trip lives in
 * `@sporta/compute-adapter-hosted`'s battery, which drives this package's
 * port against ITS worker executing real ffmpeg).
 *
 * Honesty note: the stub tests use a controlled `Bun.serve` answering
 * schema-valid envelopes over the bytes it actually receives — the port's
 * validation, verification, and error-mapping logic runs for real; the
 * media semantics (real ffprobe/ffmpeg) are proven by the real-worker
 * integration tests there.
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MEDIA_TOOLCHAIN_BUDGETS,
  FfmpegUnavailableError,
  MediaToolchainDecodeProbe,
  MediaToolchainDispatchRequest,
  MediaToolchainJobDescription,
  MediaToolchainMetering,
  MediaToolchainOperation,
  MediaToolchainResult,
  createHttpDecodePort,
  resolveMediaToolchainBudgets,
  resolveMediaToolchainFromEnv,
  sha256OfBytes,
} from "../src/index";
import { ResourceLimitError, RightsDeniedError, UnsupportedMediaError } from "@sporta/decoding";
import { DecodingService } from "@sporta/decoding";
import type { DecodeSourceInput, DecodeWindow, NormalizedVideoFrame } from "@sporta/decoding";
import type { MediaToolchainDispatchRequest as DispatchDoc } from "../src/index";
import type { AuthorizationPolicy } from "@sporta/contracts";

/** A full-rights policy fixture (the W102 rights gate allows analysis). */
const FULL_POLICY: AuthorizationPolicy = {
  policyId: "policy-decode-seam-test-full",
  allowedOperations: ["analysis", "transformation", "storage", "derivativeGeneration"],
  assertedBy: "test",
};

/** Builds a W102 `DecodeSourceInput` over the given mp4 bytes. */
function decodeInputOf(bytes: Uint8Array, sessionId = "sess-decode-seam"): DecodeSourceInput {
  return {
    receipt: {
      sessionId,
      sourceId: `src-${sha256OfBytes(bytes).slice(0, 12)}`,
      checksum: sha256OfBytes(bytes),
      container: "mp4",
      byteLength: bytes.byteLength,
      ingestedAtMs: 0,
      sourceKind: "file",
    },
    authorizationPolicy: FULL_POLICY,
    openBytes: async () => bytes,
  };
}

/** One 2x2 rgb24 frame (12 bytes — the byte-math invariant holds exactly). */
function tinyFrame(presentationMs: number, decodeOrder: number): NormalizedVideoFrame {
  return {
    frameId: `f-0-${decodeOrder}`,
    streamIndex: 0,
    presentationMs,
    decodeOrder,
    width: 2,
    height: 2,
    pixelFormat: "rgb24",
    bytes: new Uint8Array(12).fill(decodeOrder),
  };
}

/** The wire form of a frame batch. */
function wireFrames(frames: NormalizedVideoFrame[], totalBytes: number) {
  return {
    frames: frames.map((frame) => ({
      frameId: frame.frameId,
      streamIndex: frame.streamIndex,
      presentationMs: frame.presentationMs,
      decodeOrder: frame.decodeOrder,
      width: frame.width,
      height: frame.height,
      pixelFormat: "rgb24",
      contentBase64: Buffer.from(frame.bytes).toString("base64"),
    })),
    totalBytes,
  };
}

/** A schema-valid base metering block (the stub worker's answer). */
function stubMetering(overrides: Record<string, unknown> = {}) {
  return {
    startedAtMs: 1700000000000,
    finishedAtMs: 1700000000050,
    executionMs: 50,
    ffprobeRuns: 1,
    ffmpegRuns: 0,
    inputBytes: 100,
    outputBytes: 0,
    ...overrides,
  };
}

/** Consumes an async iterable to completion (for rejection assertions). */
async function consume(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const item of iterable) {
    void item;
  }
}

/** The dispatch bodies the stub received (asserted by the tests). */
const received: DispatchDoc[] = [];

/**
 * The controlled stub worker: answers decode-probe/decode-frames envelopes
 * over the bytes it actually receives. Modes:
 * - "ok" — the honest worker (probe doc + frame batch);
 * - "frame-budget-exceeded" — the worker's fail-closed frame-budget refusal;
 * - "ffmpeg-unavailable" — the worker's typed unavailable refusal;
 * - "garbage" — a lying provider (non-envelope answer);
 * - "lie-total" — a lying batch (the claimed totalBytes disagrees).
 */
function startDecodeStubWorker(mode: string): { url: string; server: Bun.Server<undefined> } {
  const server = Bun.serve({
    port: 0,
    fetch: async (request: Request): Promise<Response> => {
      const parsed = MediaToolchainDispatchRequest.parse(await request.json());
      received.push(parsed);
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (mode === "garbage") {
        return json({ disposition: "executed", result: { nope: true } });
      }
      if (mode === "ffmpeg-unavailable") {
        return json({
          disposition: "executed",
          result: {
            jobId: parsed.job.jobId,
            operation: parsed.job.operation,
            status: "failed",
            failure: {
              errorClass: "ffmpeg-unavailable",
              message: "ffmpeg is not usable at '/nonexistent/ffmpeg' — never faked",
              terminal: "internal",
              failureClass: "internal",
              retryable: false,
            },
            metering: stubMetering(),
          },
        });
      }
      if (mode === "frame-budget-exceeded") {
        return json({
          disposition: "executed",
          result: {
            jobId: parsed.job.jobId,
            operation: "decode-frames",
            status: "failed",
            failure: {
              errorClass: "frame-budget-exceeded",
              message: "the decoded frame batch would measure over the budget — outputs discarded",
              terminal: "non-retryable",
              failureClass: "resource-limit",
              retryable: false,
            },
            metering: stubMetering({ ffmpegRuns: 1, outputBytes: 0 }),
          },
        });
      }
      if (parsed.job.operation === "decode-probe") {
        return json({
          disposition: "executed",
          result: {
            jobId: parsed.job.jobId,
            operation: "decode-probe",
            status: "succeeded",
            decodeProbe: {
              tracks: [
                {
                  trackId: "t-0-video",
                  streamIndex: 0,
                  kind: "video",
                  codec: "h264",
                  startTimeMs: 0,
                  durationMs: 2000,
                },
                {
                  trackId: "t-1-audio",
                  streamIndex: 1,
                  kind: "audio",
                  codec: "aac",
                  startTimeMs: 0,
                  durationMs: 2000,
                },
              ],
              container: "mp4",
              durationMs: 2000,
            },
            metering: stubMetering(),
          },
        });
      }
      // decode-frames: three 12-byte frames over the received window.
      const frames = [tinyFrame(0, 0), tinyFrame(40, 1), tinyFrame(80, 2)];
      const totalBytes = mode === "lie-total" ? 999 : 36;
      return json({
        disposition: "executed",
        result: {
          jobId: parsed.job.jobId,
          operation: "decode-frames",
          status: "succeeded",
          decodedFrames: wireFrames(frames, totalBytes),
          metering: stubMetering({
            ffmpegRuns: 1,
            outputBytes: totalBytes,
            decodedFrames: frames.length,
            decodedFrameBytes: totalBytes,
          }),
        },
      });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, server };
}

// ---------------------------------------------------------------------------
// 1. The wire shapes (ADDITIVE — probe/normalize untouched)
// ---------------------------------------------------------------------------

describe("the decode seam's wire shapes (the authorized enum extension)", () => {
  test("the operation enum carries the two decode operations alongside probe/normalize", () => {
    expect(MediaToolchainOperation.options).toEqual([
      "probe",
      "normalize",
      "decode-probe",
      "decode-frames",
    ]);
  });

  test("a pre-extension probe envelope still parses (the additive law)", () => {
    const legacy = MediaToolchainResult.safeParse({
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
      metering: {
        startedAtMs: 1,
        finishedAtMs: 2,
        executionMs: 1,
        ffprobeRuns: 1,
        ffmpegRuns: 0,
        inputBytes: 10,
        outputBytes: 0,
      },
    });
    expect(legacy.success).toBe(true);
    // The optional decode metering fields are absent on the legacy envelope.
    expect(legacy.success && legacy.data.metering.decodedFrames).toBeUndefined();
    expect(
      MediaToolchainMetering.safeParse(legacy.success ? legacy.data.metering : null).success,
    ).toBe(true);
  });

  test("a decode-frames dispatch REQUIRES its bounded window; other operations must not carry one", () => {
    const base = {
      schemaVersion: "1.0",
      jobId: "decode-window-job",
      idempotencyKey: "decode-window-key",
      sessionId: "sess-wire",
      source: { contentHash: sha256OfBytes(new Uint8Array([1])), byteSize: 1, container: "mp4" },
      rights: { policyRef: "wire-test", canReferenceSourceFrames: true },
      constraints: { deadlineMs: 120_000, priority: 0 },
      mediaPolicy: { maxDurationMs: 120_000 },
    };
    expect(
      MediaToolchainJobDescription.safeParse({
        ...base,
        operation: "decode-frames",
        decodeWindow: { streamIndex: 0, maxTotalBytes: 1024 },
      }).success,
    ).toBe(true);
    expect(
      MediaToolchainJobDescription.safeParse({
        ...base,
        jobId: "decode-window-job-2",
        operation: "decode-frames",
      }).success,
    ).toBe(false);
    expect(
      MediaToolchainJobDescription.safeParse({
        ...base,
        jobId: "decode-window-job-3",
        operation: "probe",
        decodeWindow: { streamIndex: 0, maxTotalBytes: 1024 },
      }).success,
    ).toBe(false);
    expect(MediaToolchainJobDescription.safeParse({ ...base, operation: "probe" }).success).toBe(
      true,
    );
  });

  test("a succeeded decode-probe envelope carries ONLY its probe document", () => {
    const ok = MediaToolchainResult.safeParse({
      jobId: "decode-probe-ok",
      operation: "decode-probe",
      status: "succeeded",
      decodeProbe: {
        tracks: [
          {
            trackId: "t-0-video",
            streamIndex: 0,
            kind: "video",
            codec: "h264",
            startTimeMs: 0,
            durationMs: 2000,
          },
        ],
        container: "mp4",
        durationMs: 2000,
      },
      metering: stubMetering(),
    });
    expect(ok.success).toBe(true);
    // A decode-probe envelope without the document is refused.
    const missing = MediaToolchainResult.safeParse({
      jobId: "decode-probe-missing",
      operation: "decode-probe",
      status: "succeeded",
      metering: stubMetering(),
    });
    expect(missing.success).toBe(false);
    // The decode-probe document schema itself is strict.
    expect(MediaToolchainDecodeProbe.safeParse({ tracks: [] }).success).toBe(false);
  });

  test("a succeeded decode-frames envelope carries its batch, metered consistently", () => {
    const frames = wireFrames([tinyFrame(0, 0), tinyFrame(40, 1)], 24);
    const ok = MediaToolchainResult.safeParse({
      jobId: "decode-frames-ok",
      operation: "decode-frames",
      status: "succeeded",
      decodedFrames: frames,
      metering: stubMetering({
        ffmpegRuns: 1,
        outputBytes: 24,
        decodedFrames: 2,
        decodedFrameBytes: 24,
      }),
    });
    expect(ok.success).toBe(true);
    // A metering/batch disagreement is refused (the lying-provider guard).
    const disagree = MediaToolchainResult.safeParse({
      jobId: "decode-frames-disagree",
      operation: "decode-frames",
      status: "succeeded",
      decodedFrames: frames,
      metering: stubMetering({
        ffmpegRuns: 1,
        outputBytes: 24,
        decodedFrames: 7,
        decodedFrameBytes: 24,
      }),
    });
    expect(disagree.success).toBe(false);
  });

  test("the frame-budget axis rides the budgets (default + overrides)", () => {
    expect(DEFAULT_MEDIA_TOOLCHAIN_BUDGETS.maxDecodedFrameBytes).toBe(1024 * 1024 * 1024);
    const resolved = resolveMediaToolchainBudgets({ maxDecodedFrameBytes: 2048 });
    expect(resolved.maxDecodedFrameBytes).toBe(2048);
    expect(resolved.maxSourceBytes).toBe(DEFAULT_MEDIA_TOOLCHAIN_BUDGETS.maxSourceBytes);
  });
});

// ---------------------------------------------------------------------------
// 2. The http decode port (the client half of the seam)
// ---------------------------------------------------------------------------

describe("the http decode port (controlled stub — the real worker round trip is in compute-adapter-hosted)", () => {
  test("probe answers the W102 ProbeResult the R207 pipeline consumes; the window rides the decode-frames dispatch", async () => {
    received.length = 0;
    const { url, server } = startDecodeStubWorker("ok");
    try {
      const port = createHttpDecodePort(url);
      const bytes = new TextEncoder().encode("decode-seam-source-bytes");
      const input = decodeInputOf(bytes);
      const probe = await port.probe(input);
      // The W102 ProbeResult shape (the pipeline's track selection surface).
      expect(probe.container).toBe("mp4");
      expect(probe.durationMs).toBe(2000);
      expect(probe.tracks.map((track) => track.kind)).toEqual(["video", "audio"]);
      expect(probe.tracks[0]!.trackId).toBe("t-0-video");
      expect(probe.tracks[0]!.streamIndex).toBe(0);

      // The bounded window fetch: the pipeline's ONE decodeVideo call.
      const window: DecodeWindow = { fromMs: 0, toMs: 2000, maxTotalBytes: 1024 };
      const frames: NormalizedVideoFrame[] = [];
      for await (const frame of port.decodeVideo(input, 0, window)) {
        frames.push(frame);
      }
      expect(frames.length).toBe(3);
      expect(frames[0]!.bytes.byteLength).toBe(12);
      expect(frames[2]!.decodeOrder).toBe(2);
      // The dispatch carried the bounded window verbatim.
      expect(received.length).toBe(2);
      expect(received[1]!.job.operation).toBe("decode-frames");
      expect(received[1]!.job.decodeWindow).toEqual({
        streamIndex: 0,
        fromMs: 0,
        toMs: 2000,
        maxTotalBytes: 1024,
      });
      // The dispatch's source claims are the CLIENT's measured claims.
      expect(received[1]!.job.source.contentHash).toBe(sha256OfBytes(bytes));
    } finally {
      server.stop(true);
    }
  });

  test("the client-side W102 budget envelope refuses an over-budget batch (fail-closed)", async () => {
    const { url, server } = startDecodeStubWorker("ok");
    try {
      const port = createHttpDecodePort(url);
      const bytes = new TextEncoder().encode("decode-seam-budget-bytes");
      const input = decodeInputOf(bytes);
      // The window's budget admits ONE 12-byte frame; the stub answers three.
      const iter = port.decodeVideo(input, 0, { maxTotalBytes: 12 });
      let count = 0;
      await expect(
        (async () => {
          for await (const frame of iter) {
            void frame;
            count += 1;
          }
        })(),
      ).rejects.toBeInstanceOf(ResourceLimitError);
      expect(count).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("the worker's fail-closed frame-budget refusal maps to the typed resource-limit error", async () => {
    const { url, server } = startDecodeStubWorker("frame-budget-exceeded");
    try {
      const port = createHttpDecodePort(url);
      const bytes = new TextEncoder().encode("decode-seam-frame-budget-bytes");
      const iter = port.decodeVideo(decodeInputOf(bytes), 0, { maxTotalBytes: 1024 });
      await expect(consume(iter)).rejects.toBeInstanceOf(ResourceLimitError);
    } finally {
      server.stop(true);
    }
  });

  test("a worker-side ffmpeg-unavailable refusal maps to the LOCAL path's missing-binary class", async () => {
    const { url, server } = startDecodeStubWorker("ffmpeg-unavailable");
    try {
      const port = createHttpDecodePort(url);
      const bytes = new TextEncoder().encode("decode-seam-unavailable-bytes");
      const input = decodeInputOf(bytes);
      await expect(port.probe(input)).rejects.toBeInstanceOf(UnsupportedMediaError);
      const err = (await port.probe(input).catch((e: unknown) => e)) as UnsupportedMediaError;
      expect(err.details).toMatchObject({ missingBinary: "ffmpeg/ffprobe" });
    } finally {
      server.stop(true);
    }
  });

  test("an unreachable worker is the TYPED FfmpegUnavailableError (never a faked transform)", async () => {
    const port = createHttpDecodePort("http://127.0.0.1:1");
    const bytes = new TextEncoder().encode("decode-seam-unreachable-bytes");
    const input = decodeInputOf(bytes);
    await expect(port.probe(input)).rejects.toBeInstanceOf(FfmpegUnavailableError);
    const iter = port.decodeVideo(input, 0, { maxTotalBytes: 1024 });
    await expect(consume(iter)).rejects.toBeInstanceOf(FfmpegUnavailableError);
  });

  test("a lying provider (invalid envelope) is the typed unavailable error", async () => {
    const { url, server } = startDecodeStubWorker("garbage");
    try {
      const port = createHttpDecodePort(url);
      await expect(
        port.probe(decodeInputOf(new TextEncoder().encode("garbage"))),
      ).rejects.toBeInstanceOf(FfmpegUnavailableError);
    } finally {
      server.stop(true);
    }
  });

  test("a lying batch (the claimed totalBytes disagrees) is never interpreted", async () => {
    const { url, server } = startDecodeStubWorker("lie-total");
    try {
      const port = createHttpDecodePort(url);
      const iter = port.decodeVideo(decodeInputOf(new TextEncoder().encode("lie-total")), 0, {
        maxTotalBytes: 1024,
      });
      await expect(consume(iter)).rejects.toBeInstanceOf(UnsupportedMediaError);
    } finally {
      server.stop(true);
    }
  });

  test("the seam serves the mp4 container rail — a non-mp4 receipt is refused typed", async () => {
    const { url, server } = startDecodeStubWorker("ok");
    try {
      const port = createHttpDecodePort(url);
      const input = decodeInputOf(new TextEncoder().encode("webm-shaped"));
      const webmInput: DecodeSourceInput = {
        ...input,
        receipt: { ...input.receipt, container: "webm" },
      };
      await expect(port.probe(webmInput)).rejects.toBeInstanceOf(UnsupportedMediaError);
      const iter = port.decodeVideo(webmInput, 0, { maxTotalBytes: 1024 });
      await expect(consume(iter)).rejects.toBeInstanceOf(UnsupportedMediaError);
    } finally {
      server.stop(true);
    }
  });

  test("the W102 rights gate still refuses a policy that denies analysis (client-side)", async () => {
    const { url, server } = startDecodeStubWorker("ok");
    try {
      const port = createHttpDecodePort(url);
      const denied: AuthorizationPolicy = {
        policyId: "policy-decode-seam-denied",
        allowedOperations: ["storage"],
        assertedBy: "test",
      };
      const bytes = new TextEncoder().encode("decode-seam-denied-bytes");
      const input: DecodeSourceInput = {
        receipt: {
          sessionId: "sess-decode-seam-denied",
          sourceId: "src-denied",
          checksum: sha256OfBytes(bytes),
          container: "mp4",
          byteLength: bytes.byteLength,
          ingestedAtMs: 0,
          sourceKind: "file",
        },
        authorizationPolicy: denied,
        openBytes: async () => bytes,
      };
      await expect(port.probe(input)).rejects.toBeInstanceOf(RightsDeniedError);
    } finally {
      server.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The env-driven composition root (the decode port's selection)
// ---------------------------------------------------------------------------

describe("the env-driven decode-port selection (composition root)", () => {
  test("in-process (the default) wires NO decode port — the pipeline's own LOCAL path", () => {
    const resolved = resolveMediaToolchainFromEnv({ env: {} });
    expect(resolved.toolchain).toBe("in-process");
    expect(resolved.decodePort).toBeUndefined();
  });

  test("http wires the http decode port against the same worker URL", () => {
    const resolved = resolveMediaToolchainFromEnv({
      env: { MEDIA_TOOLCHAIN: "http", MEDIA_TOOLCHAIN_URL: "http://127.0.0.1:3971" },
    });
    expect(resolved.toolchain).toBe("http");
    expect(resolved.workerUrl).toBe("http://127.0.0.1:3971");
    expect(resolved.decodePort).toBeInstanceOf(DecodingService);
  });
});
