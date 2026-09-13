/**
 * Decode resource bounds (W102), per architecture-lock §13: "treat uploaded
 * media and model outputs as untrusted data … bound resource usage".
 *
 * Decoder OUTPUT byte volume is attacker-controlled — a hostile file can
 * declare huge dimensions or endless samples — so `DecodingService` enforces
 * every bound in this module on the normalized output BEFORE items are
 * yielded downstream. Violations raise `ResourceLimitError` (failure class
 * `resource-limit`).
 */

/** The resource bounds applied to one decode call / probe. */
export interface DecodeLimits {
  /**
   * Maximum bytes in one normalized video frame (`width * height * 3`).
   * Default: one 1920x1080 rgb24 frame (6,220,800 bytes).
   */
  maxFrameBytes: number;
  /**
   * Maximum samples in one normalized audio chunk (interleaved sample
   * count). Default: 96,000 samples — one second of canonical 48 kHz stereo.
   */
  maxChunkSamples: number;
  /** Maximum tracks reported by one probe. Default: 16. */
  maxTracks: number;
  /**
   * Maximum cumulative decoded bytes per decode call (the running window
   * budget; a per-call `window.maxTotalBytes` overrides it downward only in
   * the sense that the call uses the provided value when present).
   * Default: 268,435,456 bytes (256 MiB).
   */
  maxTotalBytes: number;
}

/** 1920 x 1080 rgb24 — one full-HD frame. */
const MAX_FRAME_BYTES_DEFAULT = 1920 * 1080 * 3;

/** 48,000 Hz x 2 channels — one second of canonical stereo audio. */
const MAX_CHUNK_SAMPLES_DEFAULT = 48_000 * 2;

/** 256 MiB — the default cumulative per-call decode budget. */
const MAX_TOTAL_BYTES_DEFAULT = 268_435_456;

/**
 * The default decode limits. Frozen so the shared module default cannot be
 * mutated by callers; pass an explicit `limits` to `DecodingService` to
 * tighten (or relax, at your own risk) any bound.
 */
export const DEFAULT_DECODE_LIMITS: DecodeLimits = Object.freeze({
  maxFrameBytes: MAX_FRAME_BYTES_DEFAULT,
  maxChunkSamples: MAX_CHUNK_SAMPLES_DEFAULT,
  maxTracks: 16,
  maxTotalBytes: MAX_TOTAL_BYTES_DEFAULT,
}) as DecodeLimits;
