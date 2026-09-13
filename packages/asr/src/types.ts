/**
 * Core ASR types (W207): the timestamped transcription unit that leaves this
 * package, plus the window/carrier types the chunked adapter works with
 * internally.
 *
 * Timeline semantics (architecture-lock §3: commentary is a first-class
 * semantic input and STT output must be timeline-synchronized): a
 * {@link TranscriptionUnit} carries `startMs`/`endMs` on the timeline the
 * adapter was configured with — SESSION timeline milliseconds when a
 * `timeline.toSessionMs` mapper (built from the W103 `TrackClock`) was
 * supplied, otherwise SOURCE timeline milliseconds passed through unchanged.
 * The W103 synchronizer owns the canonical source-to-session mapping; this
 * package never invents one.
 */
/**
 * The raw result of one backend transcription: the text verbatim, plus the
 * backend's own ASR confidence when (and only when) it provides one.
 */
export interface AsrBackendResult {
  /** The transcribed text, verbatim from the backend. */
  readonly text: string;
  /** Backend-provided ASR confidence in [0, 1]; `undefined` when the backend provides none. */
  readonly asrConfidence?: number;
}

/**
 * One transcribed window of speech on the canonical session timeline (or on
 * the source timeline when no mapper was supplied — see module docs).
 *
 * `unitId = "tu-<windowIndex>"` where the window index is the position of the
 * window in the source-time window grid: window N covers
 * `[N * windowMs, (N + 1) * windowMs)`. `endMs` is the ACTUAL covered span
 * end, so a final window shorter than `windowMs` ends when the audio ends —
 * timestamps never claim audio that is not there (no invented certainty).
 *
 * `asrConfidence` is present ONLY when the backend provided one; a backend
 * that returns no confidence leaves it `undefined` forever.
 */
export interface TranscriptionUnit {
  /** Unit id: `tu-<windowIndex>` (the source-time window grid position). */
  readonly unitId: string;
  /** Timeline position of the window's first covered sample (milliseconds). */
  readonly startMs: number;
  /** Timeline position just past the window's last covered sample (milliseconds). */
  readonly endMs: number;
  /** The transcribed text for the window, verbatim from the backend. */
  readonly text: string;
  /** Backend-provided ASR confidence in [0, 1]; `undefined` when the backend provides none. */
  readonly asrConfidence?: number;
  /** Speaker label passthrough (W208 owns real speaker metadata). */
  readonly speakerLabel?: string;
  /** Channel label passthrough (e.g. `"commentary-1"`). */
  readonly channel?: string;
}

/**
 * The concatenated PCM for one transcription window: everything the adapter
 * will hand to an `AsrBackend` (after `encodeWav`), plus the window's
 * source-time span.
 *
 * `windowId = "w-<windowIndex>"` (same index the corresponding
 * `TranscriptionUnit`'s `tu-<windowIndex>` id uses). `startMs`/`endMs` are the
 * ACTUAL covered span in SOURCE time (a window shorter than `windowMs` at the
 * stream end, or clipped by a stream that starts mid-window, ends where the
 * audio ends).
 */
export interface AsrWindow {
  /** Window id: `w-<windowIndex>`. */
  readonly windowId: string;
  /** Source-time position of the window's first covered sample (milliseconds). */
  readonly startMs: number;
  /** Source-time position just past the window's last covered sample (milliseconds). */
  readonly endMs: number;
  /** Interleaved float32 samples in [-1, 1] covering exactly `[startMs, endMs)`. */
  readonly samples: Float32Array;
  /** Sample rate in hertz (consistent across the whole chunk stream). */
  readonly sampleRate: number;
  /** Channel count (1 or 2; consistent across the whole chunk stream). */
  readonly channels: number;
}
