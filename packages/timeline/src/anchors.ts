/**
 * Anchor extraction (W103 §3.2): the per-track timing summary the
 * two-anchor synchronization method measures.
 *
 * A {@link TrackTiming} is DERIVED BY THE CALLER from the W102 decoded
 * samples — video: first/last frame `presentationMs`; audio: first/last
 * chunk `startMs` (`NormalizedVideoFrame` / `NormalizedAudioChunk` in
 * `@sporta/decoding`). {@link extractTrackTiming} is the convenience helper
 * that derives it mechanically; callers with their own bookkeeping may
 * construct the summary directly (it is a plain value).
 *
 * `firstSampleMs` / `lastSampleMs` are the EARLIEST and LATEST sample
 * positions (min and max over the samples), NOT the array's first and last
 * elements — decode order and presentation order differ for reordered
 * streams, and the anchors must be order-independent to stay deterministic.
 */
import { InvalidTimelineError } from "./errors";

/** The two first-class media track kinds (video and audio only). */
export type TrackKind = "video" | "audio";

/**
 * The timing summary of one decoded track, derived from its samples: the
 * earliest and latest sample positions plus the sample count. `sampleCount`
 * of a real track is at least 1 (a track with no samples is zero-length and
 * rejected by the synchronizer).
 */
export interface TrackTiming {
  /** Stable track id (`TrackInfo.trackId`: `t-<streamIndex>-<kind>`). */
  trackId: string;
  kind: TrackKind;
  /** Earliest sample position on the track's source clock (milliseconds). */
  firstSampleMs: number;
  /** Latest sample position on the track's source clock (milliseconds). */
  lastSampleMs: number;
  /** Number of samples the summary was derived from (at least 1). */
  sampleCount: number;
}

/**
 * Structural supertype of the W102 normalized samples: a video frame carries
 * `presentationMs`, an audio chunk carries `startMs`. Passing an array of
 * either to {@link extractTrackTiming} works because the helper reads only
 * the field its `kind` selects.
 */
export interface TimingSample {
  presentationMs?: number;
  startMs?: number;
}

/**
 * One pair of measured anchors — the same nominal content instant seen by
 * both tracks, expressed in session milliseconds: `at: "start"` is the
 * content start (each track's first sample), `at: "end"` is the content end
 * (each track's last sample plus its sample duration). The session positions
 * are computed under the offset-only (drift-free) clocks, so the END pair's
 * difference is exactly the misalignment the drift measurement divides by
 * the overlap.
 */
export interface AnchorPair {
  at: "start" | "end";
  videoSessionMs: number;
  audioSessionMs: number;
}

/**
 * Derives a {@link TrackTiming} from decoded samples: `kind: "video"` reads
 * each sample's `presentationMs`, `kind: "audio"` reads its `startMs`.
 *
 * - EMPTY input returns `undefined` (a caller that decoded nothing has no
 *   timing to summarize; it is the caller's decision what that means — the
 *   synchronizer never sees a zero-length track).
 * - A sample MISSING the kind's field, or carrying a non-finite one, throws
 *   `InvalidTimelineError` (`media-invalid`): decoded output is untrusted
 *   (architecture-lock §13) and corrupt timing fails loud, never silently.
 * - `firstSampleMs`/`lastSampleMs` are min/max over the samples
 *   (order-independent, see module doc); `sampleCount` is the array length.
 *
 * @param kind which field to read from every sample.
 * @param samples the decoded samples (video frames or audio chunks).
 * @param trackId the stable track id carried into the result
 *   (`TrackInfo.trackId` — the caller always knows it; it is never invented).
 */
export function extractTrackTiming(
  kind: TrackKind,
  samples: readonly TimingSample[],
  trackId: string,
): TrackTiming | undefined {
  if (typeof trackId !== "string" || trackId.length < 1) {
    throw new InvalidTimelineError(
      `extractTrackTiming requires a non-empty trackId (got ${String(trackId)})`,
      { trackId: String(trackId) },
    );
  }
  if (samples.length === 0) return undefined;

  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    const raw = kind === "video" ? sample?.presentationMs : sample?.startMs;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new InvalidTimelineError(
        `a ${kind} sample is missing a finite ${kind === "video" ? "presentationMs" : "startMs"} ` +
          `(got ${String(raw)}) — decoded output is untrusted, corrupt timing fails loud`,
        { trackId, kind, value: String(raw) },
      );
    }
    if (raw < first) first = raw;
    if (raw > last) last = raw;
  }
  return { trackId, kind, firstSampleMs: first, lastSampleMs: last, sampleCount: samples.length };
}
