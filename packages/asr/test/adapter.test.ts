import { describe, expect, test } from "bun:test";
import { DEFAULT_WINDOW_MS, ChunkedAsrAdapter, buildAsrWindows } from "../src/adapter";
import type { AsrChunkInput } from "../src/adapter";
import type { AsrBackend } from "../src/backend";
import { AsrError } from "../src/errors";
import { FixtureAsrBackend } from "../src/fixture-backend";
import type { AsrBackendResult } from "../src/types";
import { makeChunk, makeChunks } from "./helpers";

/** 250 ms silence chunks at 8 kHz mono: 2000 samples per chunk (exact math). */
const CHUNKS_250MS = { chunkMs: 250, sampleRate: 8000, channels: 1 } as const;

describe("ChunkedAsrAdapter window math", () => {
  test("250ms chunks x 20 at windowMs 1000 -> exactly 5 full 1000ms windows", async () => {
    const chunks = makeChunks({ count: 20, ...CHUNKS_250MS });
    const adapter = new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({ defaultResult: { text: "t" } }),
      windowMs: 1000,
    });

    const units = await adapter.transcribeAudioChunks(chunks);
    expect(units).toHaveLength(5);
    expect(units.map((unit) => unit.unitId)).toEqual(["tu-0", "tu-1", "tu-2", "tu-3", "tu-4"]);
    expect(units.map((unit) => [unit.startMs, unit.endMs])).toEqual([
      [0, 1000],
      [1000, 2000],
      [2000, 3000],
      [3000, 4000],
      [4000, 5000],
    ]);
  });

  test("the 21st chunk still transcribes as a partial final window", async () => {
    const chunks = makeChunks({ count: 21, ...CHUNKS_250MS });
    const adapter = new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({ defaultResult: { text: "t" } }),
      windowMs: 1000,
    });

    const units = await adapter.transcribeAudioChunks(chunks);
    expect(units).toHaveLength(6);
    const last = units[5];
    expect(last?.unitId).toBe("tu-5");
    expect(last?.startMs).toBe(5000);
    expect(last?.endMs).toBe(5250); // actual covered span, not the nominal 6000
  });

  test(`default windowMs is ${DEFAULT_WINDOW_MS}ms: 20 chunks -> 1 window; 21 -> 2`, async () => {
    const adapter = new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({ defaultResult: { text: "t" } }),
    });

    const twenty = await adapter.transcribeAudioChunks(makeChunks({ count: 20, ...CHUNKS_250MS }));
    expect(twenty).toHaveLength(1);
    expect(twenty[0]?.startMs).toBe(0);
    expect(twenty[0]?.endMs).toBe(5000);

    const twentyOne = await adapter.transcribeAudioChunks(
      makeChunks({ count: 21, ...CHUNKS_250MS }),
    );
    expect(twentyOne).toHaveLength(2);
    expect(twentyOne[1]?.startMs).toBe(5000);
    expect(twentyOne[1]?.endMs).toBe(5250);
  });

  test("a chunk straddling a window boundary is split at the boundary", async () => {
    // One 6000 ms chunk, 5000 ms windows: [0,5000) keeps 40000 samples,
    // [5000,6000) keeps the remaining 8000.
    const chunks = [makeChunk(6000, 0, { sampleRate: 8000, channels: 1 })];
    const windows = buildAsrWindows(chunks, 5000);
    expect(windows.map((w) => [w.windowId, w.startMs, w.endMs, w.samples.length])).toEqual([
      ["w-0", 0, 5000, 40000],
      ["w-1", 5000, 6000, 8000],
    ]);

    // And the fixture backend routes per window start: 0 then 5000.
    const adapter = new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({
        results: new Map<number, AsrBackendResult>([
          [0, { text: "first half" }],
          [5000, { text: "second half" }],
        ]),
      }),
      windowMs: 5000,
    });
    const units = await adapter.transcribeAudioChunks(chunks);
    expect(units.map((unit) => unit.text)).toEqual(["first half", "second half"]);
  });

  test("a gap between chunks leaves windows covering only the audio that exists", async () => {
    const chunks = [
      makeChunk(250, 0, { sampleRate: 8000, channels: 1 }),
      makeChunk(250, 6000, { sampleRate: 8000, channels: 1 }),
    ];
    const windows = buildAsrWindows(chunks, 5000);
    expect(windows.map((w) => [w.windowId, w.startMs, w.endMs, w.samples.length])).toEqual([
      ["w-0", 0, 250, 2000],
      ["w-1", 6000, 6250, 2000],
    ]);
  });

  test("buildAsrWindows: window ids, spans, and sample volumes for the canonical grid", () => {
    const chunks = makeChunks({ count: 20, ...CHUNKS_250MS });
    const windows = buildAsrWindows(chunks, 1000);
    expect(windows).toHaveLength(5);
    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index];
      expect(window?.windowId).toBe(`w-${index}`);
      expect(window?.startMs).toBe(index * 1000);
      expect(window?.endMs).toBe((index + 1) * 1000);
      expect(window?.samples.length).toBe(8000); // 1000ms * 8000Hz mono
      expect(window?.sampleRate).toBe(8000);
      expect(window?.channels).toBe(1);
    }
    expect(buildAsrWindows([], 1000)).toEqual([]);
    expect(() => buildAsrWindows(chunks, 0)).toThrow(RangeError);
  });
});

describe("ChunkedAsrAdapter timestamp preservation", () => {
  test("unit startMs/endMs sit exactly on source time (no mapper)", async () => {
    const chunks = makeChunks({ count: 21, ...CHUNKS_250MS });
    const adapter = new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({ defaultResult: { text: "t" } }),
      windowMs: 1000,
    });
    const units = await adapter.transcribeAudioChunks(chunks);
    // Exact equality (toBe, not toBeCloseTo): 250ms @ 8kHz is frame-exact.
    expect(units.map((unit) => unit.startMs)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(units.map((unit) => unit.endMs)).toEqual([1000, 2000, 3000, 4000, 5000, 5250]);
  });

  test("a timeline mapper shifts both span endpoints by exactly 1000ms", async () => {
    const chunks = makeChunks({ count: 21, ...CHUNKS_250MS });
    const adapter = new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({ defaultResult: { text: "t" } }),
      windowMs: 1000,
      timeline: { toSessionMs: (sourceMs) => sourceMs + 1000 },
    });
    const units = await adapter.transcribeAudioChunks(chunks);
    expect(units.map((unit) => unit.startMs)).toEqual([1000, 2000, 3000, 4000, 5000, 6000]);
    expect(units.map((unit) => unit.endMs)).toEqual([2000, 3000, 4000, 5000, 6000, 6250]);
  });

  test("a W103-shaped affine mapper (offset + drift) maps both endpoints", async () => {
    // sessionMs = sourceMs + offsetMs + sourceMs * driftPpm / 1_000_000
    // (the timeline package's TrackClock formula, closed over structurally).
    const offsetMs = 250;
    const driftPpm = 500;
    const chunks = makeChunks({ count: 2, ...CHUNKS_250MS });
    const adapter = new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({ defaultResult: { text: "t" } }),
      windowMs: 250,
      timeline: {
        toSessionMs: (sourceMs) => sourceMs + offsetMs + (sourceMs * driftPpm) / 1_000_000,
      },
    });
    const units = await adapter.transcribeAudioChunks(chunks);
    expect(units.map((unit) => [unit.startMs, unit.endMs])).toEqual([
      [250, 500.125],
      [500.125, 750.25],
    ]);
  });
});

describe("ChunkedAsrAdapter chunk validation (typed AsrError, media-invalid)", () => {
  const adapter = () =>
    new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({ defaultResult: { text: "t" } }),
      windowMs: 1000,
    });

  test("rejects non-monotonic startMs", async () => {
    const chunks = makeChunks({ count: 2, ...CHUNKS_250MS });
    await expect(adapter().transcribeAudioChunks(chunks.slice().reverse())).rejects.toBeInstanceOf(
      AsrError,
    );
  });

  test("rejects duplicate startMs (strictly increasing is required)", async () => {
    const a = makeChunk(250, 0);
    const b = makeChunk(250, 0);
    await expect(adapter().transcribeAudioChunks([a, b])).rejects.toBeInstanceOf(AsrError);
  });

  test("rejects mixed sample rates", async () => {
    const a = makeChunk(250, 0, { sampleRate: 8000 });
    const b = makeChunk(250, 250, { sampleRate: 16000 });
    const error = await adapter()
      .transcribeAudioChunks([a, b])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AsrError);
    expect((error as AsrError).failureClass).toBe("media-invalid");
  });

  test("rejects mixed channel counts", async () => {
    const a = makeChunk(250, 0, { channels: 1 });
    const b = makeChunk(250, 250, { channels: 2 });
    await expect(adapter().transcribeAudioChunks([a, b])).rejects.toBeInstanceOf(AsrError);
  });

  test("rejects zero-sample chunks, negative startMs, and truncated frames", async () => {
    await expect(adapter().transcribeAudioChunks([makeChunk(0, 0)])).rejects.toBeInstanceOf(
      AsrError,
    );
    await expect(adapter().transcribeAudioChunks([makeChunk(250, -100)])).rejects.toBeInstanceOf(
      AsrError,
    );
    const truncated: AsrChunkInput = {
      startMs: 0,
      sampleRate: 8000,
      channels: 2,
      samples: new Float32Array([0, 0, 0]), // one and a half frames
    };
    await expect(adapter().transcribeAudioChunks([truncated])).rejects.toBeInstanceOf(AsrError);
  });

  test("rejects non-Float32Array samples and non-array input", async () => {
    const fake: AsrChunkInput = {
      startMs: 0,
      sampleRate: 8000,
      channels: 1,
      samples: new Uint8Array(8) as unknown as Float32Array,
    };
    await expect(adapter().transcribeAudioChunks([fake])).rejects.toBeInstanceOf(AsrError);
    await expect(
      adapter().transcribeAudioChunks(null as unknown as readonly AsrChunkInput[]),
    ).rejects.toBeInstanceOf(AsrError);
  });

  test("constructor rejects non-positive windowMs and empty metadata labels", () => {
    const backend = new FixtureAsrBackend();
    expect(() => new ChunkedAsrAdapter({ backend, windowMs: 0 })).toThrow(RangeError);
    expect(() => new ChunkedAsrAdapter({ backend, windowMs: -1 })).toThrow(RangeError);
    expect(() => new ChunkedAsrAdapter({ backend, windowMs: Number.NaN })).toThrow(RangeError);
    expect(() => new ChunkedAsrAdapter({ backend, channel: "" })).toThrow(RangeError);
    expect(() => new ChunkedAsrAdapter({ backend, speakerLabel: "" })).toThrow(RangeError);
  });

  test("validation errors name the offending chunk index", async () => {
    const a = makeChunk(250, 0);
    const b = makeChunk(250, 250);
    const c = makeChunk(250, 200); // regresses below b: chunk 2 is the offender
    const error = await adapter()
      .transcribeAudioChunks([a, b, c])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AsrError);
    expect((error as AsrError).details.index).toBe(2);
  });
});

describe("ChunkedAsrAdapter result shaping", () => {
  test("empty input yields [] (no windows, no backend calls)", async () => {
    const adapter = new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({ onUnknownWindow: "error" }),
    });
    expect(await adapter.transcribeAudioChunks([])).toEqual([]);
  });

  test("text and confidence pass through verbatim; no confidence is invented", async () => {
    const withConfidence = new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({
        defaultResult: { text: "hello world", asrConfidence: 0.87 },
      }),
      windowMs: 250, // one chunk per window -> two units
    });
    const units = await withConfidence.transcribeAudioChunks(
      makeChunks({ count: 2, ...CHUNKS_250MS }),
    );
    expect(units.map((unit) => unit.text)).toEqual(["hello world", "hello world"]);
    expect(units.map((unit) => unit.asrConfidence)).toEqual([0.87, 0.87]);

    const withoutConfidence = new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({ defaultResult: { text: "plain" } }),
      windowMs: 250,
    });
    const bare = await withoutConfidence.transcribeAudioChunks(
      makeChunks({ count: 2, ...CHUNKS_250MS }),
    );
    expect(bare.map((unit) => unit.asrConfidence)).toEqual([undefined, undefined]);
    expect("asrConfidence" in (bare[0] ?? {})).toBe(false);
  });

  test("channel/speakerLabel metadata passes through to every unit", async () => {
    const adapter = new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({ defaultResult: { text: "t" } }),
      windowMs: 1000,
      channel: "commentary-1",
      speakerLabel: "play-by-play",
    });
    const units = await adapter.transcribeAudioChunks(makeChunks({ count: 3, ...CHUNKS_250MS }));
    for (const unit of units) {
      expect(unit.channel).toBe("commentary-1");
      expect(unit.speakerLabel).toBe("play-by-play");
    }

    const plain = new ChunkedAsrAdapter({
      backend: new FixtureAsrBackend({ defaultResult: { text: "t" } }),
      windowMs: 1000,
    });
    const bareUnits = await plain.transcribeAudioChunks(makeChunks({ count: 1, ...CHUNKS_250MS }));
    expect("channel" in (bareUnits[0] ?? {})).toBe(false);
    expect("speakerLabel" in (bareUnits[0] ?? {})).toBe(false);
  });

  test("async backends (Promise results) are awaited uniformly", async () => {
    const asyncBackend: AsrBackend = {
      backendId: "async-echo",
      transcribe: async () => ({ text: "async" }),
    };
    const adapter = new ChunkedAsrAdapter({ backend: asyncBackend, windowMs: 250 });
    const units = await adapter.transcribeAudioChunks(makeChunks({ count: 2, ...CHUNKS_250MS }));
    expect(units.map((unit) => unit.text)).toEqual(["async", "async"]);
  });

  test("a malformed backend result is a typed internal AsrError", async () => {
    const badText: AsrBackend = {
      backendId: "bad-text",
      transcribe: () => ({ text: 42 }) as unknown as AsrBackendResult,
    };
    await expect(
      new ChunkedAsrAdapter({ backend: badText, windowMs: 250 }).transcribeAudioChunks(
        makeChunks({ count: 1, ...CHUNKS_250MS }),
      ),
    ).rejects.toBeInstanceOf(AsrError);

    const nullResult: AsrBackend = {
      backendId: "null-result",
      transcribe: () => null as unknown as AsrBackendResult,
    };
    const error = await new ChunkedAsrAdapter({
      backend: nullResult,
      windowMs: 250,
    })
      .transcribeAudioChunks(makeChunks({ count: 1, ...CHUNKS_250MS }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AsrError);
    expect((error as AsrError).failureClass).toBe("internal");
  });

  test("deterministic: same chunks, backend, and options -> deep-equal units", async () => {
    const chunks = makeChunks({ count: 21, ...CHUNKS_250MS });
    const run = async (): Promise<unknown> =>
      await new ChunkedAsrAdapter({
        backend: new FixtureAsrBackend({
          results: new Map<number, AsrBackendResult>([
            [0, { text: "zero" }],
            [4000, { text: "four" }],
          ]),
          defaultResult: { text: "middle" },
        }),
        windowMs: 1000,
        channel: "c",
      }).transcribeAudioChunks(chunks);
    expect(await run()).toEqual(await run());
  });
});
