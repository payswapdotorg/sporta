/**
 * @sporta/timeline — timeline synchronization (W103).
 *
 * The third boundary of the Sporta pipeline: decoded track timing summaries
 * in (W102 output); a canonical, time-aligned session timeline out — the
 * `SessionTimeline` contract the `MediaSession` carries, plus the affine
 * track clocks that map every decoded sample onto it. Consumes the W002
 * contracts (`SessionTimeline`, zod-validated before returning), the W007
 * observability seams, and the W003 testing harness. Module map:
 *
 * - `clock`: the per-track affine clock model — `TrackClock`,
 *   `toSessionMs`, `toSourceMs` (exact inverse), `identityClock`;
 * - `anchors`: `TrackTiming` (caller-derived from decoded samples),
 *   `extractTrackTiming`, `AnchorPair`;
 * - `sync`: `TimelineSynchronizer.align` — canonical zero (earliest
 *   first-sample), two-anchor drift measurement with the +/-1000 ppm clamp
 *   and anomaly flag, single-anchor fallback (`driftMeasured: false`),
 *   `durationMs` as the max corrected end; plus `mapSample` /
 *   `ensureMonotonic` for bounded-monotonic stream mapping;
 * - `errors`: `InvalidTimelineError` (`media-invalid`) with structured
 *   details, in the W101/W102 typed-error style.
 */
export { identityClock, toSessionMs, toSourceMs } from "./clock";
export type { TrackClock } from "./clock";
export { extractTrackTiming } from "./anchors";
export type { AnchorPair, TimingSample, TrackKind, TrackTiming } from "./anchors";
export {
  DRIFT_CLAMP_PPM,
  TIMELINE_METRIC_NAMES,
  TimelineSynchronizer,
  ensureMonotonic,
  mapSample,
  noopObservability,
} from "./sync";
export type {
  AlignInput,
  SyncResult,
  TimelineObservability,
  TimelineSynchronizerOptions,
} from "./sync";
export { InvalidTimelineError, isTimelineError } from "./errors";
export type { TimelineError, TimelineErrorDetails } from "./errors";
