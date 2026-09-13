/**
 * The provider-neutral ASR backend seam (W207).
 *
 * Architecture-lock §7 (speech-to-text is a first-class service) and §9
 * (vendor neutrality: no core contract may hard-code a single AI-model
 * provider): every transcription backend — the deterministic fixture used by
 * tests, or the functioning z-ai backend used in production — sits behind
 * this one-method interface, and the chunked adapter (plus everything
 * downstream of it) is written against the seam only. This mirrors the W201
 * `DetectorAdapter` pattern for vision.
 *
 * The input is one COMPLETE WAV-encoded transcription window (16-bit PCM,
 * 44-byte header — `encodeWav` output). The output is the window's text plus,
 * only when the backend genuinely provides one, an ASR confidence.
 * Implementations may be synchronous (fixture) or asynchronous (remote
 * providers); the return union lets callers `await` both uniformly.
 */
import type { AsrBackendResult } from "./types";

export interface AsrBackend {
  /**
   * Backend id: a stable, vendor-neutral identifier used in error details and
   * observability (doubles as the `componentId` stamped on observations
   * emitted from this backend's output).
   */
  readonly backendId: string;

  /**
   * Transcribes one complete WAV window (see module docs). MUST NOT invent an
   * `asrConfidence`: a backend that provides no confidence leaves it
   * `undefined` — architecture-lock §4 forbids invented certainty.
   */
  transcribe(wav: Uint8Array): Promise<AsrBackendResult> | AsrBackendResult;
}
