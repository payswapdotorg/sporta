/**
 * `FixtureAsrBackend` — the deterministic test substrate (W207).
 *
 * Constructed from either a map `windowStartMs -> AsrBackendResult` (results
 * for specific transcription windows) or a `defaultResult` returned for every
 * window — or both, in which case the map wins for the windows it covers and
 * the default catches the rest. A window the backend can resolve NEITHER way
 * is either a typed `AsrError` (`onUnknownWindow: "error"`, the default) or
 * an empty-text result (`onUnknownWindow: "empty"`).
 *
 * Window positions — how the backend knows which window a call is for: it
 * infers each call's SOURCE-TIME window start by accumulating the durations
 * of the WAV windows it has already transcribed. `ChunkedAsrAdapter` emits
 * contiguous windows that tile the source timeline from 0 (window N covers
 * `[N * windowMs, (N + 1) * windowMs)`), so the cumulative duration of the
 * preceding windows IS the current window's start. Consequence (documented):
 * an instance is positioned by its own call history — construct a FRESH
 * instance per audio stream.
 *
 * Deterministic and synchronous: no I/O, no clock, no randomness — two fresh
 * instances fed the same WAV windows return identical results (tested), and
 * `transcribe` returns the result directly, never a promise.
 */
import type { AsrBackend } from "./backend";
import { AsrError } from "./errors";
import type { AsrBackendResult } from "./types";

/** How an unmapped, default-less window is handled. */
export type FixtureUnknownWindowMode = "error" | "empty";

/** Options for {@link FixtureAsrBackend}. */
export interface FixtureAsrBackendOptions {
  /**
   * Results keyed by the source-time START of the transcription window
   * (milliseconds; e.g. `0`, `5000`, `10000` for 5s windows). Takes
   * precedence over {@link defaultResult} for the windows it covers.
   */
  readonly results?: ReadonlyMap<number, AsrBackendResult>;
  /** Result returned for every window not covered by {@link results}. */
  readonly defaultResult?: AsrBackendResult;
  /** Behavior for windows resolved by neither {@link results} nor {@link defaultResult}. */
  readonly onUnknownWindow?: FixtureUnknownWindowMode;
}

/**
 * Reads a 44-byte-header 16-bit PCM WAV's duration in milliseconds, rounded
 * to the nearest millisecond (window positions are integer-millisecond in
 * every supported configuration). Bytes that are not such a WAV throw an
 * `AsrError` (`"media-invalid"`) — the fixture's input contract is `encodeWav`
 * output.
 */
function wavDurationMs(wav: Uint8Array): number {
  // The `?? 0` on each byte only satisfies noUncheckedIndexedAccess — every
  // read below is preceded by the length/magic checks.
  const byte = (offset: number): number => wav[offset] ?? 0;
  const ascii = (offset: number): string =>
    String.fromCharCode(byte(offset), byte(offset + 1), byte(offset + 2), byte(offset + 3));
  if (wav.length < 44 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE" || ascii(36) !== "data") {
    throw new AsrError("media-invalid", "fixture ASR backend requires a 44-byte-header PCM WAV", {
      byteLength: wav.length,
    });
  }
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const sampleRate = view.getUint32(24, true);
  const channels = view.getUint16(22, true);
  const byteRate = sampleRate * channels * 2;
  if (byteRate <= 0) {
    throw new AsrError("media-invalid", "fixture ASR backend WAV header has a zero byte rate", {
      sampleRate,
      channels,
    });
  }
  // A lying data-length is clamped to the bytes actually present.
  const dataLen = Math.min(view.getUint32(40, true), wav.length - 44);
  return Math.round((dataLen / byteRate) * 1000);
}

/**
 * The deterministic fixture backend (see module docs). Result objects are
 * returned as shallow copies so callers can never mutate the fixture's
 * configured results through a transcribed window.
 */
export class FixtureAsrBackend implements AsrBackend {
  readonly backendId = "fixture-asr";

  private readonly results: ReadonlyMap<number, AsrBackendResult>;
  private readonly defaultResult: AsrBackendResult | undefined;
  private readonly onUnknownWindow: FixtureUnknownWindowMode;

  /** Source-time start of the NEXT window this instance will transcribe. */
  private nextWindowStartMs = 0;

  constructor(options: FixtureAsrBackendOptions = {}) {
    this.results = options.results ?? new Map();
    this.defaultResult = options.defaultResult;
    this.onUnknownWindow = options.onUnknownWindow ?? "error";
  }

  transcribe(wav: Uint8Array): AsrBackendResult {
    const windowStartMs = this.nextWindowStartMs;
    const durationMs = wavDurationMs(wav);
    this.nextWindowStartMs = windowStartMs + durationMs;

    const mapped = this.results.get(windowStartMs);
    if (mapped !== undefined) return { ...mapped };
    if (this.defaultResult !== undefined) return { ...this.defaultResult };

    if (this.onUnknownWindow === "empty") return { text: "" };
    throw new AsrError(
      "internal",
      `fixture ASR backend has no result mapped for the window starting at ${windowStartMs}ms`,
      { backendId: this.backendId, windowStartMs },
    );
  }
}
