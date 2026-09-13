/**
 * `ChunkedAsrAdapter` — the timestamp-bearing STT pipeline entry point (W207).
 *
 * Turns a stream of normalized audio chunks (W102 `NormalizedAudioChunk`)
 * into timeline-synchronized {@link TranscriptionUnit}s (architecture-lock
 * §3: STT output must be timeline-synchronized transcription units):
 *
 * 1. VALIDATES the chunk stream: strictly monotonic (increasing) `startMs`,
 *    one consistent `sampleRate`, one consistent `channels` (1 or 2), whole
 *    interleaved sample frames, non-empty non-NaN samples — a violation is a
 *    typed `AsrError` (`"media-invalid"`): decoded output is untrusted
 *    (architecture-lock §13).
 * 2. GROUPS the samples into contiguous transcription windows of `windowMs`:
 *    window N covers `[N * windowMs, (N + 1) * windowMs)` in SOURCE time
 *    (the grid is anchored at source time 0). Chunks are concatenated in
 *    chunk order; a chunk that straddles a window boundary is SPLIT at the
 *    boundary (a sample frame belongs to the window containing the frame's
 *    START instant). A window shorter than `windowMs` at the stream end still
 *    transcribes, and a gap between chunks leaves the affected windows
 *    covering only the audio that is actually there — window spans never
 *    claim audio that does not exist.
 * 3. Per window: encode the concatenated interleaved samples with `encodeWav`
 *    and call `backend.transcribe`.
 * 4. MAPS the result onto the session timeline via `timeline.toSessionMs`
 *    when a mapper is supplied (both endpoints of the span are mapped
 *    independently). Otherwise SOURCE time passes through unchanged — the
 *    W103 synchronizer owns the canonical source-to-session mapping; this
 *    adapter only applies what it is handed.
 * 5. Emits `unitId = "tu-<windowIndex>"` (the window's grid position N) with
 *    `startMs`/`endMs` at the window's ACTUAL covered span, plus
 *    channel/speakerLabel metadata passthrough. The backend's
 *    `asrConfidence` passes through verbatim; when the backend provides none
 *    it stays `undefined` (never invented).
 *
 * Empty input yields `[]`. Deterministic: no clock, no randomness — the same
 * chunks, backend, and options always produce the same units.
 */
import type { AsrBackend } from "./backend";
import { AsrError } from "./errors";
import type { AsrBackendResult, AsrWindow, TranscriptionUnit } from "./types";
import { encodeWav } from "./wav";

/**
 * One decoded audio chunk offered to the adapter, shaped after the W102
 * `NormalizedAudioChunk` (the fields an ASR adapter needs; the full decoding
 * type — `chunkId`, `streamIndex`, `startMs`, `sampleRate`, `channels`,
 * `samples` — is assignable to this input, mirroring the W201
 * `DetectorFrameInput` pattern; `@sporta/decoding` is deliberately NOT a
 * dependency of this package).
 */
export interface AsrChunkInput {
  /** Timeline position of the chunk's first sample, SOURCE time (milliseconds). */
  readonly startMs: number;
  /** Sample rate in hertz (consistent across the chunk stream). */
  readonly sampleRate: number;
  /** Channel count, 1 or 2 (consistent across the chunk stream). */
  readonly channels: number;
  /** Interleaved float32 samples in [-1, 1] (whole sample frames). */
  readonly samples: Float32Array;
}

/**
 * A session-timeline mapper: `toSessionMs(sourceMs)` maps ONE source-timeline
 * millisecond position onto the canonical session timeline. Structurally
 * satisfied by closing over the W103 timeline package's `toSessionMs` —
 * `{ toSessionMs: (ms) => toSessionMs(trackClock, ms) }`.
 */
export interface AsrTimelineMapper {
  /** Maps one source-timeline position onto the session timeline. */
  readonly toSessionMs: (sourceMs: number) => number;
}

/** Default transcription window length (milliseconds) — 5 seconds. */
export const DEFAULT_WINDOW_MS = 5000;

/** Options for {@link ChunkedAsrAdapter}. */
export interface ChunkedAsrAdapterOptions {
  /** The provider-neutral backend that transcribes each window. */
  readonly backend: AsrBackend;
  /** Transcription window length in milliseconds (default: {@link DEFAULT_WINDOW_MS}). */
  readonly windowMs?: number;
  /** Channel label stamped on every emitted unit (non-empty string). */
  readonly channel?: string;
  /** Speaker label stamped on every emitted unit (non-empty string; W208 owns real diarization). */
  readonly speakerLabel?: string;
  /** Optional session-timeline mapper (see {@link AsrTimelineMapper}). */
  readonly timeline?: AsrTimelineMapper;
}

/** An `AsrWindow` plus the window's grid index (the `N` of `tu-<N>`/`w-<N>` ids). */
interface IndexedAsrWindow extends AsrWindow {
  readonly windowIndex: number;
}

/** Accumulated per-window state while walking the chunk stream. */
interface WindowAccumulator {
  readonly pieces: Float32Array[];
  firstMs: number;
  lastMs: number;
  readonly sampleRate: number;
  readonly channels: number;
}

function assertWindowMs(windowMs: number): void {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError(
      `ChunkedAsrAdapter requires a positive finite windowMs (got ${String(windowMs)})`,
    );
  }
}

/**
 * First frame index at/after the window `boundaryMs`, measured from the chunk
 * start — the exclusive upper bound of the frames belonging to the window
 * BEFORE the boundary.
 *
 * Rule: a sample frame belongs to the window containing the frame's START
 * instant, so a frame that straddles the boundary stays in the earlier
 * window: the bound is `ceil((boundary - chunkStart) * rate / 1000)`, with
 * near-integers snapped (float dust must never misplace a frame) and a floor
 * of `fromFrame + 1` so the walk always progresses.
 */
function frameLimitAtOrAfter(
  boundaryMs: number,
  chunkStartMs: number,
  sampleRate: number,
  fromFrame: number,
  totalFrames: number,
): number {
  const exact = ((boundaryMs - chunkStartMs) * sampleRate) / 1000;
  const snapped = Math.round(exact);
  const bound = Math.abs(exact - snapped) < 1e-6 ? snapped : Math.ceil(exact);
  return Math.min(Math.max(bound, fromFrame + 1), totalFrames);
}

function concatSamples(pieces: readonly Float32Array[]): Float32Array {
  let length = 0;
  for (const piece of pieces) length += piece.length;
  const merged = new Float32Array(length);
  let offset = 0;
  for (const piece of pieces) {
    merged.set(piece, offset);
    offset += piece.length;
  }
  return merged;
}

/**
 * Validates the chunk stream (see module docs §1) and throws a typed
 * `AsrError` (`"media-invalid"`) naming the offending chunk on any violation.
 */
function validateChunkStream(chunks: readonly AsrChunkInput[]): void {
  if (!Array.isArray(chunks)) {
    throw new AsrError("media-invalid", "transcribeAudioChunks requires an array of audio chunks");
  }
  let previous: AsrChunkInput | undefined;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (chunk === null || typeof chunk !== "object") {
      throw new AsrError("media-invalid", `audio chunk ${index} is not an object`);
    }
    if (!Number.isFinite(chunk.startMs) || chunk.startMs < 0) {
      throw new AsrError(
        "media-invalid",
        `audio chunk ${index} requires a finite non-negative startMs (got ${String(chunk.startMs)})`,
        { index, startMs: chunk.startMs },
      );
    }
    if (!Number.isFinite(chunk.sampleRate) || chunk.sampleRate <= 0) {
      throw new AsrError(
        "media-invalid",
        `audio chunk ${index} requires a positive finite sampleRate (got ${String(chunk.sampleRate)})`,
        { index, sampleRate: chunk.sampleRate },
      );
    }
    if (chunk.channels !== 1 && chunk.channels !== 2) {
      throw new AsrError(
        "media-invalid",
        `audio chunk ${index} requires channels 1 or 2 (got ${String(chunk.channels)})`,
        { index, channels: chunk.channels },
      );
    }
    if (!(chunk.samples instanceof Float32Array)) {
      throw new AsrError("media-invalid", `audio chunk ${index} samples must be a Float32Array`);
    }
    if (chunk.samples.length === 0) {
      throw new AsrError("media-invalid", `audio chunk ${index} carries zero samples`, { index });
    }
    if (chunk.samples.length % chunk.channels !== 0) {
      throw new AsrError(
        "media-invalid",
        `audio chunk ${index} samples are not whole interleaved sample frames ` +
          `(${chunk.samples.length} samples across ${chunk.channels} channel(s))`,
        { index },
      );
    }
    if (
      previous !== undefined &&
      (chunk.sampleRate !== previous.sampleRate || chunk.channels !== previous.channels)
    ) {
      throw new AsrError(
        "media-invalid",
        `audio chunk ${index} mixes sampleRate/channels with chunk ${index - 1} ` +
          `(${previous.sampleRate} Hz / ${previous.channels} ch then ${chunk.sampleRate} Hz / ${chunk.channels} ch)`,
        { index },
      );
    }
    if (previous !== undefined && chunk.startMs <= previous.startMs) {
      throw new AsrError(
        "media-invalid",
        `audio chunk ${index} startMs must be strictly after chunk ${index - 1} ` +
          `(${chunk.startMs} <= ${previous.startMs})`,
        { index, startMs: chunk.startMs },
      );
    }
    previous = chunk;
  }
}

/**
 * Validates the chunk stream (see module docs §1, thrown as `AsrError`
 * `"media-invalid"` naming the offending chunk) and groups it into contiguous
 * transcription windows (module docs §2). Windows are keyed by their grid
 * index and returned in ascending index order; each window's
 * `startMs`/`endMs` is its ACTUAL covered source-time span.
 */
function collectWindows(chunks: readonly AsrChunkInput[], windowMs: number): IndexedAsrWindow[] {
  validateChunkStream(chunks);
  const windows = new Map<number, WindowAccumulator>();

  for (const chunk of chunks) {
    const { startMs, sampleRate, channels, samples } = chunk;
    const totalFrames = samples.length / channels;
    let frame = 0;

    while (frame < totalFrames) {
      // (frame * 1000) / sampleRate keeps the millisecond math exact for
      // integer frame indices and rates (no accumulated float drift).
      const frameStartMs = startMs + (frame * 1000) / sampleRate;
      const windowIndex = Math.floor(frameStartMs / windowMs);
      const boundaryMs = (windowIndex + 1) * windowMs;
      const limit = frameLimitAtOrAfter(boundaryMs, startMs, sampleRate, frame, totalFrames);
      const pieceEndMs = startMs + (limit * 1000) / sampleRate;

      let window = windows.get(windowIndex);
      if (window === undefined) {
        window = {
          pieces: [],
          firstMs: frameStartMs,
          lastMs: pieceEndMs,
          sampleRate,
          channels,
        };
        windows.set(windowIndex, window);
      } else {
        window.lastMs = pieceEndMs;
      }
      window.pieces.push(samples.subarray(frame * channels, limit * channels));
      frame = limit;
    }
  }

  return [...windows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([windowIndex, acc]) => ({
      windowIndex,
      windowId: `w-${windowIndex}`,
      startMs: acc.firstMs,
      endMs: acc.lastMs,
      sampleRate: acc.sampleRate,
      channels: acc.channels,
      samples: concatSamples(acc.pieces),
    }));
}

/**
 * Groups a normalized audio chunk stream into transcription windows WITHOUT
 * transcribing: the pure windowing half of {@link ChunkedAsrAdapter}, exposed
 * so the boundary math is directly testable. Validates exactly like
 * `transcribeAudioChunks` (`AsrError` `"media-invalid"` on a corrupt stream;
 * `RangeError` on a non-positive `windowMs`); empty input yields `[]`.
 */
export function buildAsrWindows(
  chunks: readonly AsrChunkInput[],
  windowMs: number = DEFAULT_WINDOW_MS,
): AsrWindow[] {
  assertWindowMs(windowMs);
  // Project the internal indexed window onto the public AsrWindow shape
  // (dropping windowIndex — the unit id derivation keeps it privately).
  return collectWindows(chunks, windowMs).map((window) => ({
    windowId: window.windowId,
    startMs: window.startMs,
    endMs: window.endMs,
    samples: window.samples,
    sampleRate: window.sampleRate,
    channels: window.channels,
  }));
}

/** Validates a backend result's shape; a malformed result is an internal fault. */
function assertBackendResult(result: unknown, backendId: string): AsrBackendResult {
  if (result === null || typeof result !== "object") {
    throw new AsrError(
      "internal",
      `ASR backend "${backendId}" returned a malformed result (text must be a string)`,
      { backendId },
    );
  }
  const candidate = result as AsrBackendResult;
  if (typeof candidate.text !== "string") {
    throw new AsrError(
      "internal",
      `ASR backend "${backendId}" returned a malformed result (text must be a string)`,
      { backendId },
    );
  }
  if (candidate.asrConfidence !== undefined && typeof candidate.asrConfidence !== "number") {
    throw new AsrError(
      "internal",
      `ASR backend "${backendId}" returned a non-number asrConfidence`,
      { backendId },
    );
  }
  return candidate;
}

/**
 * The chunked, timestamp-bearing speech-to-text adapter (see module docs for
 * the five-step contract). Construct once per (backend, options) and call
 * `transcribeAudioChunks` per chunk batch.
 */
export class ChunkedAsrAdapter {
  private readonly backend: AsrBackend;
  private readonly windowMs: number;
  private readonly channel: string | undefined;
  private readonly speakerLabel: string | undefined;
  private readonly timeline: AsrTimelineMapper | undefined;

  constructor(options: ChunkedAsrAdapterOptions) {
    const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    assertWindowMs(windowMs);
    // The contracts TranscriptionPayload requires min(1) strings for
    // speakerLabel/channel; reject empty labels at construction instead of
    // letting emission produce contract-invalid records downstream.
    for (const [name, value] of [
      ["channel", options.channel],
      ["speakerLabel", options.speakerLabel],
    ] as const) {
      if (value !== undefined && (typeof value !== "string" || value.length < 1)) {
        throw new RangeError(`ChunkedAsrAdapter requires a non-empty ${name} string`);
      }
    }

    this.backend = options.backend;
    this.windowMs = windowMs;
    this.channel = options.channel;
    this.speakerLabel = options.speakerLabel;
    this.timeline = options.timeline;
  }

  /**
   * Transcribes a normalized audio chunk stream into timestamped
   * {@link TranscriptionUnit}s, one per non-empty transcription window, in
   * ascending window order. Empty input yields `[]`.
   */
  async transcribeAudioChunks(chunks: readonly AsrChunkInput[]): Promise<TranscriptionUnit[]> {
    const windows = collectWindows(chunks, this.windowMs);
    if (windows.length === 0) return [];

    const units: TranscriptionUnit[] = [];
    for (const window of windows) {
      const wav = encodeWav(window.samples, window.sampleRate, window.channels);
      const result = assertBackendResult(
        await this.backend.transcribe(wav),
        this.backend.backendId,
      );
      units.push(this.toUnit(window, result));
    }
    return units;
  }

  private toUnit(window: IndexedAsrWindow, result: AsrBackendResult): TranscriptionUnit {
    return {
      unitId: `tu-${window.windowIndex}`,
      startMs: this.toSessionMs(window.startMs),
      endMs: this.toSessionMs(window.endMs),
      text: result.text,
      ...(result.asrConfidence !== undefined ? { asrConfidence: result.asrConfidence } : {}),
      ...(this.speakerLabel !== undefined ? { speakerLabel: this.speakerLabel } : {}),
      ...(this.channel !== undefined ? { channel: this.channel } : {}),
    };
  }

  /** Maps one source-timeline position; unmapped (no timeline) passes through. */
  private toSessionMs(sourceMs: number): number {
    if (this.timeline === undefined) return sourceMs;
    const sessionMs = this.timeline.toSessionMs(sourceMs);
    if (!Number.isFinite(sessionMs)) {
      throw new RangeError(
        `timeline.toSessionMs returned a non-finite session position for source ${sourceMs}ms`,
      );
    }
    return sessionMs;
  }
}
