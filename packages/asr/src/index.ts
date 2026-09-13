/**
 * @sporta/asr — speech-to-text adapter (work item W207).
 *
 * The commentary-chain entry point (architecture-lock §3 and §7, ADR-002):
 * normalized audio chunks (W102) in; timeline-synchronized transcription
 * units out, emitted as contract observations. Module map:
 *
 * - `types`: `TranscriptionUnit` (timestamped unit on the session/source
 *   timeline), `AsrWindow` (one transcription window's PCM + span),
 *   `AsrBackendResult`
 * - `errors`: `AsrError` — the typed, classified ASR boundary error
 *   (`"media-invalid"` for corrupt normalized audio, `"internal"` for backend
 *   failures), plus `boundedCause` for bounded failure details
 * - `wav`: `encodeWav` — the pure 44-byte-header 16-bit PCM WAV encoder
 * - `backend`: `AsrBackend` — the provider-neutral one-method seam
 *   (architecture-lock §9)
 * - `zai-backend`: `ZaiAsrBackend` — the functioning backend wrapping
 *   `z-ai-web-dev-sdk` behind a LAZY dynamic import (loads offline; no
 *   invented confidence; failures are typed `AsrError`s with bounded causes)
 * - `fixture-backend`: `FixtureAsrBackend` — the deterministic,
 *   synchronous test substrate (window-keyed results, default results,
 *   configurable unknown-window behavior)
 * - `adapter`: `ChunkedAsrAdapter` — validates the chunk stream, groups it
 *   into contiguous `windowMs` windows (boundary-splitting chunks),
 *   concatenates + encodes + transcribes per window, maps the spans onto the
 *   session timeline when a mapper is supplied, and stamps
 *   `tu-<windowIndex>` ids with metadata passthrough; `buildAsrWindows`
 *   exposes the pure windowing half
 * - `observe`: `emitTranscriptionObservations` — one contract `Observation`
 *   per unit (audio / OBSERVED, confidence only when the backend provided
 *   one), plus the `validateTranscriptionObservation` zod-parse helper
 *
 * Architecture-lock conformance: vendor-neutral seam (§9), timestamps
 * preserved with no invented certainty (§3/§4/§6), W207 emits in source time
 * unless the caller supplies the W103-owned session-timeline mapping.
 */
export type { AsrBackendResult, AsrWindow, TranscriptionUnit } from "./types";
export type { AsrTimelineMapper, AsrChunkInput, ChunkedAsrAdapterOptions } from "./adapter";
export { DEFAULT_WINDOW_MS, ChunkedAsrAdapter, buildAsrWindows } from "./adapter";
export type { AsrBackend } from "./backend";
export { ZaiAsrBackend } from "./zai-backend";
export type { FixtureAsrBackendOptions, FixtureUnknownWindowMode } from "./fixture-backend";
export { FixtureAsrBackend } from "./fixture-backend";
export { encodeWav } from "./wav";
export { ASR_CAUSE_LIMIT, AsrError, boundedCause, isAsrError } from "./errors";
export type { AsrErrorDetails, AsrFailure } from "./errors";
export { emitTranscriptionObservations, validateTranscriptionObservation } from "./observe";
export type { EmitTranscriptionInput } from "./observe";
