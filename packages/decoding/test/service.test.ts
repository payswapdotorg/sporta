/**
 * W102 DecodingService tests: fail-closed rights gate ordering (spy adapter
 * proves NO adapter call happens on denial), resource bounds (maxTracks,
 * per-frame bytes, per-chunk samples, mid-stream window byte budget),
 * corrupt-output detection (rgb24 byte math, audio sample math), canonical
 * decodeOrder reassignment, and the observability contract (one structured
 * JSON log line per call at completion + a warn line and labeled counters on
 * refusal).
 *
 * Deterministic per docs/testing/HARNESS.md: policies from @sporta/testing
 * builders, an explicit nowMs, stub/evil adapters with fixed outputs — no
 * clock reads, no randomness.
 */
import { describe, expect, test } from "bun:test";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { Logger } from "@sporta/observability";
import { TEST_EPOCH_MS, buildAuthorizationPolicy } from "@sporta/testing";
import type { IngestionReceipt } from "@sporta/ingestion";
import type { AuthorizationPolicy } from "@sporta/contracts";
import { DECODE_METRIC_NAMES, DEFAULT_AUDIO_TARGET, DecodingService } from "../src/index";
import { ResourceLimitError, RightsDeniedError, UnsupportedMediaError } from "../src/index";
import type {
  AudioTarget,
  DecodeSourceInput,
  DecodeWindow,
  NormalizedAudioChunk,
  NormalizedVideoFrame,
  ProbeResult,
  TrackInfo,
} from "../src/index";
import type { DecoderAdapter } from "../src/index";

// --- helpers ---------------------------------------------------------------

/** A policy valid at TEST_EPOCH (analysis allowed, far-future expiry). */
const validPolicy = buildAuthorizationPolicy();

/** A policy that does NOT allow analysis (missing-operation denial). */
const noAnalysisPolicy = buildAuthorizationPolicy({
  allowedOperations: ["transformation"],
});

/** A deterministic receipt. */
function makeReceipt(): IngestionReceipt {
  return {
    sessionId: "sess-decode",
    sourceId: "src-000000000000",
    checksum: "cd".repeat(32),
    container: "mp4",
    byteLength: 32,
    ingestedAtMs: 0,
    sourceKind: "file",
  };
}

/** A decode input (lazy bytes are irrelevant for the stub adapter). */
function makeInput(authorizationPolicy: AuthorizationPolicy = validPolicy): DecodeSourceInput {
  return {
    receipt: makeReceipt(),
    authorizationPolicy,
    openBytes: async () => new Uint8Array([1, 2, 3]),
  };
}

/** A well-formed 4x4 rgb24 frame with deterministic per-index bytes. */
function makeFrame(
  index: number,
  overrides: Partial<NormalizedVideoFrame> = {},
): NormalizedVideoFrame {
  const bytes = new Uint8Array(4 * 4 * 3);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = (index * 7 + i) % 256;
  }
  return {
    frameId: `f-0-${index}`,
    streamIndex: 0,
    presentationMs: index * 100,
    decodeOrder: index,
    width: 4,
    height: 4,
    pixelFormat: "rgb24",
    bytes,
    ...overrides,
  };
}

/** A well-formed canonical-target audio chunk (24000 interleaved samples). */
function makeChunk(
  index: number,
  overrides: Partial<NormalizedAudioChunk> = {},
): NormalizedAudioChunk {
  const samples = new Float32Array(
    DEFAULT_AUDIO_TARGET.sampleRate * DEFAULT_AUDIO_TARGET.channels * 0.25,
  );
  samples.fill((index % 100) / 100);
  return {
    chunkId: `a-1-${index}`,
    streamIndex: 1,
    startMs: index * 250,
    sampleRate: DEFAULT_AUDIO_TARGET.sampleRate,
    channels: DEFAULT_AUDIO_TARGET.channels,
    samples,
    ...overrides,
  };
}

/**
 * A fully instrumented stub adapter: counts every method call (calls to the
 * generator-returning methods are counted when iteration STARTS), records
 * the arguments, and yields the configured items.
 */
class StubAdapter implements DecoderAdapter {
  probeCalls = 0;
  decodeVideoCalls = 0;
  decodeAudioCalls = 0;
  lastVideoWindow: DecodeWindow | undefined;
  lastAudioWindow: DecodeWindow | undefined;
  lastAudioTarget: AudioTarget | undefined;
  probeResult: ProbeResult = { tracks: [], container: "mp4", durationMs: 1000 };
  videoFrames: NormalizedVideoFrame[] = [];
  audioChunks: NormalizedAudioChunk[] = [];

  async probe(): Promise<ProbeResult> {
    this.probeCalls += 1;
    return this.probeResult;
  }

  async *decodeVideo(
    _input: DecodeSourceInput,
    _streamIndex: number,
    window?: DecodeWindow,
  ): AsyncGenerator<NormalizedVideoFrame> {
    this.decodeVideoCalls += 1;
    this.lastVideoWindow = window;
    for (const frame of this.videoFrames) {
      yield frame;
    }
  }

  async *decodeAudio(
    _input: DecodeSourceInput,
    _streamIndex: number,
    window?: DecodeWindow,
    target?: AudioTarget,
  ): AsyncGenerator<NormalizedAudioChunk> {
    this.decodeAudioCalls += 1;
    this.lastAudioWindow = window;
    this.lastAudioTarget = target;
    for (const chunk of this.audioChunks) {
      yield chunk;
    }
  }
}

/** Collects an async iterable; captures an error thrown mid-iteration. */
async function collectWithPossibleError<T>(
  iterable: AsyncIterable<T>,
): Promise<{ items: T[]; error?: unknown }> {
  const items: T[] = [];
  try {
    for await (const item of iterable) {
      items.push(item);
    }
  } catch (err) {
    return { items, error: err };
  }
  return { items, error: undefined };
}

/** Reads a counter series value (0 when the series does not exist yet). */
function counterValue(
  metrics: MetricsRegistry,
  name: string,
  labels: Record<string, string> = {},
): number {
  const canonical = (record: Record<string, string>): string =>
    Object.keys(record)
      .sort()
      .map((key) => `${key}=${record[key] ?? ""}`)
      .join(",");
  const want = canonical(labels);
  return (
    metrics
      .snapshot()
      .counters.filter((series) => series.name === name)
      .find((series) => canonical(series.labels) === want)?.value ?? 0
  );
}

/** A logger collecting every emitted line (deterministic ts). */
function collectorLogger(lines: string[]): Logger {
  return createLogger({
    sink: (line) => {
      lines.push(line);
    },
    now: () => TEST_EPOCH_MS,
  });
}

/** Builds N video TrackInfo entries. */
function videoTracks(count: number): TrackInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    trackId: `t-${index}-video`,
    streamIndex: index,
    kind: "video" as const,
    codec: "stub",
    startTimeMs: 0,
    durationMs: 1000,
  }));
}

// --- tests -----------------------------------------------------------------

describe("DecodingService — probe", () => {
  test("returns the adapter's probe result unchanged", async () => {
    const adapter = new StubAdapter();
    adapter.probeResult = { tracks: videoTracks(1), container: "mp4", durationMs: 2000 };
    const service = new DecodingService({ adapter });
    const result = await service.probe(makeInput());
    expect(result).toEqual(adapter.probeResult);
    expect(adapter.probeCalls).toBe(1);
  });

  test("rights denial happens BEFORE any adapter call (fail closed, first)", async () => {
    const adapter = new StubAdapter();
    const service = new DecodingService({ adapter });
    let thrown: unknown;
    try {
      await service.probe(makeInput(noAnalysisPolicy));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RightsDeniedError);
    const rights = thrown as RightsDeniedError;
    expect(rights.terminalFailureClass).toBe("rights-denied");
    expect(rights.failureClass).toBe("rights-denied");
    expect(rights.details.reason).toBe("missing-operation");
    expect(rights.details.requiredOperation).toBe("analysis");
    expect(rights.details.policyId).toBe(noAnalysisPolicy.policyId);
    // THE spy proof: the adapter was never invoked.
    expect(adapter.probeCalls).toBe(0);
  });

  test("an expired policy denies at the injected nowMs", async () => {
    const adapter = new StubAdapter();
    const service = new DecodingService({ adapter, nowMs: TEST_EPOCH_MS });
    const expired = buildAuthorizationPolicy({
      expiresAtIso: "2024-06-01T00:00:00.000Z",
    });
    let thrown: unknown;
    try {
      await service.probe(makeInput(expired));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RightsDeniedError);
    expect((thrown as RightsDeniedError).details.reason).toBe("expired-policy");
    expect(adapter.probeCalls).toBe(0);
  });

  test("more tracks than maxTracks is a resource-limit refusal", async () => {
    const adapter = new StubAdapter();
    adapter.probeResult = { tracks: videoTracks(17), container: "mp4", durationMs: 1000 };
    const service = new DecodingService({ adapter });
    let thrown: unknown;
    try {
      await service.probe(makeInput());
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ResourceLimitError);
    const limit = thrown as ResourceLimitError;
    expect(limit.failureClass).toBe("resource-limit");
    expect(limit.details.trackCount).toBe(17);
    expect(limit.details.maxTracks).toBe(16);
    expect(adapter.probeCalls).toBe(1);
  });

  test("exactly maxTracks tracks is accepted", async () => {
    const adapter = new StubAdapter();
    adapter.probeResult = { tracks: videoTracks(16), container: "mp4", durationMs: 1000 };
    const service = new DecodingService({ adapter });
    const result = await service.probe(makeInput());
    expect(result.tracks).toHaveLength(16);
  });
});

describe("DecodingService — decodeVideo envelope", () => {
  test("yields validated frames and re-assigns decodeOrder monotonically from 0", async () => {
    const adapter = new StubAdapter();
    // Evil adapter: scrambled decodeOrder values; the service must own them.
    adapter.videoFrames = [
      makeFrame(0, { decodeOrder: 7 }),
      makeFrame(1, { decodeOrder: 3 }),
      makeFrame(2, { decodeOrder: 9 }),
    ];
    const service = new DecodingService({ adapter });
    const { items, error } = await collectWithPossibleError(service.decodeVideo(makeInput(), 0));
    expect(error).toBeUndefined();
    expect(items.map((frame) => frame.decodeOrder)).toEqual([0, 1, 2]);
    // Adapter-provided frameIds are preserved (ids are adapter-owned).
    expect(items.map((frame) => frame.frameId)).toEqual(["f-0-0", "f-0-1", "f-0-2"]);
    expect(adapter.decodeVideoCalls).toBe(1);
  });

  test("rights denial rejects on first next() with no adapter decode call", async () => {
    const adapter = new StubAdapter();
    adapter.videoFrames = [makeFrame(0)];
    const service = new DecodingService({ adapter });
    const { items, error } = await collectWithPossibleError(
      service.decodeVideo(makeInput(noAnalysisPolicy), 0),
    );
    expect(items).toHaveLength(0);
    expect(error).toBeInstanceOf(RightsDeniedError);
    expect((error as RightsDeniedError).failureClass).toBe("rights-denied");
    expect(adapter.decodeVideoCalls).toBe(0);
  });

  test("frame byte-math violation (w*h*3 + 1 bytes) is media-invalid", async () => {
    const adapter = new StubAdapter();
    const evilBytes = new Uint8Array(4 * 4 * 3 + 1);
    adapter.videoFrames = [makeFrame(0), makeFrame(1, { bytes: evilBytes }), makeFrame(2)];
    const service = new DecodingService({ adapter });
    const { items, error } = await collectWithPossibleError(service.decodeVideo(makeInput(), 0));
    expect(items).toHaveLength(1); // the valid frame was yielded first
    expect(error).toBeInstanceOf(UnsupportedMediaError);
    const media = error as UnsupportedMediaError;
    expect(media.failureClass).toBe("media-invalid");
    expect(media.details.width).toBe(4);
    expect(media.details.height).toBe(4);
    expect(media.details.expected).toBe(48);
    expect(media.details.byteLength).toBe(49);
  });

  test("a lying pixelFormat is media-invalid", async () => {
    const adapter = new StubAdapter();
    adapter.videoFrames = [
      makeFrame(0, { pixelFormat: "rgba" } as unknown as NormalizedVideoFrame),
    ];
    const service = new DecodingService({ adapter });
    const { error } = await collectWithPossibleError(service.decodeVideo(makeInput(), 0));
    expect(error).toBeInstanceOf(UnsupportedMediaError);
    expect((error as UnsupportedMediaError).details.pixelFormat).toBe("rgba");
  });

  test("per-frame byte limit is a resource-limit refusal", async () => {
    const adapter = new StubAdapter();
    adapter.videoFrames = [makeFrame(0)]; // 48 bytes each
    const service = new DecodingService({
      adapter,
      limits: {
        maxFrameBytes: 47,
        maxChunkSamples: 96_000,
        maxTracks: 16,
        maxTotalBytes: 268_435_456,
      },
    });
    const { items, error } = await collectWithPossibleError(service.decodeVideo(makeInput(), 0));
    expect(items).toHaveLength(0);
    expect(error).toBeInstanceOf(ResourceLimitError);
    expect((error as ResourceLimitError).details.maxFrameBytes).toBe(47);
  });

  test("window byte budget terminates the iteration mid-stream", async () => {
    const adapter = new StubAdapter();
    adapter.videoFrames = [makeFrame(0), makeFrame(1), makeFrame(2), makeFrame(3)];
    const service = new DecodingService({ adapter });
    // Budget of 120 bytes = 2.5 frames of 48: frames 0 and 1 are yielded;
    // frame 2 pushes the running total to 144 > 120 → terminate.
    const { items, error } = await collectWithPossibleError(
      service.decodeVideo(makeInput(), 0, { maxTotalBytes: 120 }),
    );
    expect(items).toHaveLength(2);
    expect(error).toBeInstanceOf(ResourceLimitError);
    const limit = error as ResourceLimitError;
    expect(limit.failureClass).toBe("resource-limit");
    expect(limit.details.totalBytes).toBe(144);
    expect(limit.details.budget).toBe(120);
  });

  test("the window is passed through to the adapter", async () => {
    const adapter = new StubAdapter();
    adapter.videoFrames = [makeFrame(0)];
    const service = new DecodingService({ adapter });
    await collectWithPossibleError(service.decodeVideo(makeInput(), 0, { fromMs: 100, toMs: 400 }));
    expect(adapter.lastVideoWindow).toEqual({ fromMs: 100, toMs: 400 });
  });
});

describe("DecodingService — decodeAudio envelope", () => {
  test("yields validated chunks and passes the canonical target by default", async () => {
    const adapter = new StubAdapter();
    adapter.audioChunks = [makeChunk(0), makeChunk(1)];
    const service = new DecodingService({ adapter });
    const { items, error } = await collectWithPossibleError(service.decodeAudio(makeInput(), 1));
    expect(error).toBeUndefined();
    expect(items.map((chunk) => chunk.chunkId)).toEqual(["a-1-0", "a-1-1"]);
    expect(adapter.decodeAudioCalls).toBe(1);
    expect(adapter.lastAudioTarget).toEqual(DEFAULT_AUDIO_TARGET);
  });

  test("a custom target is passed through to the adapter", async () => {
    const adapter = new StubAdapter();
    adapter.audioChunks = [
      makeChunk(0, {
        sampleRate: 16_000,
        channels: 1,
        samples: new Float32Array(1600),
      }),
    ];
    const service = new DecodingService({ adapter });
    const target: AudioTarget = { sampleRate: 16_000, channels: 1, chunkMs: 100 };
    await collectWithPossibleError(service.decodeAudio(makeInput(), 1, undefined, target));
    expect(adapter.lastAudioTarget).toEqual(target);
  });

  test("chunk sample-math violation (more samples than a full chunk) is media-invalid", async () => {
    const adapter = new StubAdapter();
    adapter.audioChunks = [makeChunk(0, { samples: new Float32Array(24_001) })];
    const service = new DecodingService({ adapter });
    const { items, error } = await collectWithPossibleError(service.decodeAudio(makeInput(), 1));
    expect(items).toHaveLength(0);
    expect(error).toBeInstanceOf(UnsupportedMediaError);
    const media = error as UnsupportedMediaError;
    expect(media.failureClass).toBe("media-invalid");
    expect(media.details.sampleCount).toBe(24_001);
    expect(media.details.fullChunkSamples).toBe(24_000);
  });

  test("chunk samples not aligned to whole sample frames is media-invalid", async () => {
    const adapter = new StubAdapter();
    // 23999 samples: within the full-chunk bound but not divisible by 2
    // channels — a corrupt interleaved tail.
    adapter.audioChunks = [makeChunk(0, { samples: new Float32Array(23_999) })];
    const service = new DecodingService({ adapter });
    const { error } = await collectWithPossibleError(service.decodeAudio(makeInput(), 1));
    expect(error).toBeInstanceOf(UnsupportedMediaError);
    expect((error as UnsupportedMediaError).details.sampleCount).toBe(23_999);
  });

  test("a chunk not matching the requested target is media-invalid", async () => {
    const adapter = new StubAdapter();
    adapter.audioChunks = [makeChunk(0, { sampleRate: 44_100 })];
    const service = new DecodingService({ adapter });
    const { error } = await collectWithPossibleError(service.decodeAudio(makeInput(), 1));
    expect(error).toBeInstanceOf(UnsupportedMediaError);
    expect((error as UnsupportedMediaError).details.chunkSampleRate).toBe(44_100);
  });

  test("per-chunk sample limit is a resource-limit refusal", async () => {
    const adapter = new StubAdapter();
    adapter.audioChunks = [makeChunk(0)]; // 24000 samples
    const service = new DecodingService({
      adapter,
      limits: {
        maxFrameBytes: 6_220_800,
        maxChunkSamples: 100,
        maxTracks: 16,
        maxTotalBytes: 268_435_456,
      },
    });
    const { items, error } = await collectWithPossibleError(service.decodeAudio(makeInput(), 1));
    expect(items).toHaveLength(0);
    expect(error).toBeInstanceOf(ResourceLimitError);
    expect((error as ResourceLimitError).details.maxChunkSamples).toBe(100);
  });

  test("window byte budget also terminates audio mid-stream", async () => {
    const adapter = new StubAdapter();
    adapter.audioChunks = [makeChunk(0), makeChunk(1), makeChunk(2)];
    const service = new DecodingService({ adapter });
    // 96000 bytes per chunk: budget 200000 → one chunk (96000) fits, the
    // second pushes the total to 192000... third would be 288000. Use a
    // budget where chunk 2 trips: 200000 → chunk0 (96000) ok, chunk1
    // (192000) ok, chunk2 (288000) trips.
    const { items, error } = await collectWithPossibleError(
      service.decodeAudio(makeInput(), 1, { maxTotalBytes: 200_000 }),
    );
    expect(items).toHaveLength(2);
    expect(error).toBeInstanceOf(ResourceLimitError);
    expect((error as ResourceLimitError).details.budget).toBe(200_000);
  });
});

describe("DecodingService — observability contract", () => {
  test("video decode: exactly one info line (valid JSON, stage decode) + counters", async () => {
    const lines: string[] = [];
    const metrics = new MetricsRegistry();
    const adapter = new StubAdapter();
    adapter.videoFrames = [makeFrame(0), makeFrame(1), makeFrame(2)];
    const service = new DecodingService({
      adapter,
      observability: {
        logger: collectorLogger(lines),
        metrics,
        correlation: {
          sessionId: "sess-decode",
          correlationId: "corr-42",
          traceId: "trace-42",
        },
      },
    });
    await collectWithPossibleError(service.decodeVideo(makeInput(), 0));

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "info",
      msg: "decode video complete",
      sessionId: "sess-decode",
      stage: "decode",
      correlationId: "corr-42",
      traceId: "trace-42",
      ts: TEST_EPOCH_MS,
    });
    const fields = record.fields as Record<string, unknown>;
    expect(fields.streamIndex).toBe(0);
    expect(fields.items).toBe(3);
    expect(fields.bytes).toBe(3 * 48);

    expect(counterValue(metrics, DECODE_METRIC_NAMES.framesTotal)).toBe(3);
    expect(counterValue(metrics, DECODE_METRIC_NAMES.bytesTotal)).toBe(3 * 48);
    expect(counterValue(metrics, DECODE_METRIC_NAMES.audioChunksTotal)).toBe(0);
    expect(counterValue(metrics, DECODE_METRIC_NAMES.failuresTotal)).toBe(0);
  });

  test("audio decode: one info line + chunk/byte counters", async () => {
    const lines: string[] = [];
    const metrics = new MetricsRegistry();
    const adapter = new StubAdapter();
    adapter.audioChunks = [makeChunk(0), makeChunk(1)];
    const service = new DecodingService({
      adapter,
      observability: { logger: collectorLogger(lines), metrics },
    });
    await collectWithPossibleError(service.decodeAudio(makeInput(), 1, { fromMs: 250, toMs: 750 }));

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "info",
      msg: "decode audio complete",
      sessionId: "sess-decode",
      stage: "decode",
    });
    const fields = record.fields as Record<string, unknown>;
    expect(fields.streamIndex).toBe(1);
    expect(fields.items).toBe(2);
    expect(fields.window).toEqual({ fromMs: 250, toMs: 750 });

    expect(counterValue(metrics, DECODE_METRIC_NAMES.audioChunksTotal)).toBe(2);
    expect(counterValue(metrics, DECODE_METRIC_NAMES.bytesTotal)).toBe(2 * 24_000 * 4);
  });

  test("probe: one info line carrying the track count", async () => {
    const lines: string[] = [];
    const adapter = new StubAdapter();
    adapter.probeResult = { tracks: videoTracks(2), container: "mp4", durationMs: 1500 };
    const service = new DecodingService({
      adapter,
      observability: { logger: collectorLogger(lines) },
    });
    await service.probe(makeInput());
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "info",
      msg: "decode probed",
      sessionId: "sess-decode",
      stage: "decode",
    });
    const fields = record.fields as Record<string, unknown>;
    expect(fields.trackCount).toBe(2);
    expect(fields.durationMs).toBe(1500);
    expect(fields.container).toBe("mp4");
  });

  test("refusal: one warn line + total and per-class failure counters", async () => {
    const lines: string[] = [];
    const metrics = new MetricsRegistry();
    const adapter = new StubAdapter();
    const service = new DecodingService({
      adapter,
      observability: { logger: collectorLogger(lines), metrics },
    });
    await collectWithPossibleError(service.decodeVideo(makeInput(noAnalysisPolicy), 0));
    // A resource-limit refusal on a second call bumps the labeled series.
    adapter.videoFrames = [makeFrame(0)];
    await collectWithPossibleError(service.decodeVideo(makeInput(), 0, { maxTotalBytes: 10 }));

    expect(lines).toHaveLength(2);
    const rightsLine = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(rightsLine).toMatchObject({ level: "warn", msg: "decode refused", stage: "decode" });
    const rightsFields = rightsLine.fields as Record<string, unknown>;
    expect(rightsFields.failureClass).toBe("rights-denied");
    expect(rightsFields.reason).toBe("missing-operation");

    const limitLine = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(limitLine.level).toBe("warn");
    expect((limitLine.fields as Record<string, unknown>).failureClass).toBe("resource-limit");

    expect(counterValue(metrics, DECODE_METRIC_NAMES.failuresTotal)).toBe(2);
    expect(
      counterValue(metrics, DECODE_METRIC_NAMES.failuresTotal, {
        failure_class: "rights-denied",
      }),
    ).toBe(1);
    expect(
      counterValue(metrics, DECODE_METRIC_NAMES.failuresTotal, {
        failure_class: "resource-limit",
      }),
    ).toBe(1);
    // The refused calls yielded nothing, so item counters stayed flat.
    expect(counterValue(metrics, DECODE_METRIC_NAMES.framesTotal)).toBe(0);
  });

  test("absent observability is a silent no-op (no throw, no output)", async () => {
    const adapter = new StubAdapter();
    adapter.videoFrames = [makeFrame(0)];
    const service = new DecodingService({ adapter });
    const { items, error } = await collectWithPossibleError(service.decodeVideo(makeInput(), 0));
    expect(error).toBeUndefined();
    expect(items).toHaveLength(1);
    await service.probe(makeInput());
  });
});
