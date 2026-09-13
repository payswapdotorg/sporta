/**
 * `TimelineSynchronizer` — W103 timeline synchronization.
 *
 * Aligns the video and audio track clocks of one media session onto a
 * canonical session timeline with measurable drift (work-item acceptance:
 * "audio/video clocks align to a canonical session timeline with measurable
 * drift"). Input: the per-track {@link TrackTiming} summaries the caller
 * derived from the W102 decoded samples, plus the sample durations needed
 * for the end anchors. Output: a zod-validated contracts `SessionTimeline`
 * (the exact shape the `MediaSession.timeline` field carries), the two
 * {@link TrackClock}s for mapping samples onto the timeline, the measured
 * drift, and the anchor pairs the measurement used.
 *
 * ## Model and semantics
 *
 * The W102 decoded output puts BOTH tracks' timestamps on the one shared
 * source timeline of the demuxed container (`TrackInfo.startTimeMs` per
 * stream, one source per decode input): the two tracks' clocks are
 * COMPARABLE — same reference, same nominal rate — and their first/last
 * samples mark genuinely different content instants (the streams start and
 * end at different container positions). Alignment therefore means:
 *
 * 1. **Canonical zero (§3.3.1)** — the EARLIEST first-sample across the two
 *    tracks defines session time 0. The source->session mapping is a global
 *    shift of `-min(firstSampleMs)` shared by BOTH clocks (a comparable-clock
 *    alignment preserves every real inter-track relationship), and the
 *    contracts `SessionTimeline` offset fields record each track's START
 *    POSITION on the canonical timeline — VERBATIM per the spec formula:
 *
 *    ```text
 *    videoClockOffsetMs = video.firstSampleMs - min(video.first, audio.first)
 *    audioClockOffsetMs = audio.firstSampleMs - min(...)
 *    ```
 *
 *    Both are non-negative by construction ("offsets shift both tracks
 *    non-negative"): the earliest-starting track sits at session 0 and gets
 *    offset 0; a track starting G ms later gets offset G. NOTE: these
 *    contract fields are start positions, NOT the clocks' `offsetMs` — the
 *    clocks carry the `-min` mapping shift, so `toSessionMs(clock, first)`
 *    reproduces the contract field (e.g. video first 1000 / audio first 940
 *    -> offsets 60 / 0; `toSessionMs(videoClock, 1000) === 60`).
 *
 * 2. **Drift, two-anchor method (§3.3.2)** — the video end
 *    (`video.lastSampleMs + videoFrameDurationMs`) and the audio end
 *    (`audio.lastSampleMs + audioChunkDurationMs`) are nominally the same
 *    content end; their disagreement under the offset-only mapping is the
 *    accumulated clock-rate error:
 *
 *    ```text
 *    driftPpm = (videoEndSession - audioEndSession) / overlapDurationMs * 1_000_000
 *    ```
 *
 *    where `overlapDurationMs` is the intersection of the two tracks'
 *    session spans. Sign: POSITIVE means the video end lands LATER (the
 *    video clock runs fast relative to the audio clock). Anything beyond
 *    +/-1000 ppm is a data fault: the value is clamped to the limit, a WARN
 *    line is logged, and `driftAnomaly: true` flags it.
 *
 * 3. **Single-anchor fallback (§3.3.3)** — when the end anchors are
 *    unavailable (either sample duration unknown, or the session spans do
 *    not overlap), drift is 0 and `driftMeasured` is `false` — the contract
 *    field that keeps the result HONEST: alignment exists, drift was NOT
 *    measured. Two-anchor success sets it to `true`.
 *
 * ## Rate reference
 *
 * The audio clock is the canonical RATE reference (`driftPpm: 0` — the PCM
 * sample-rate clock is the stable master in standard A/V practice, and the
 * drift formula differences the video end AGAINST the audio end). The video
 * clock carries the CORRECTIVE drift `driftPpm: -driftPpm`: a fast video
 * clock (positive measured drift) maps down onto the canonical timeline.
 * The affine model is first-order, so the corrected video end aligns with
 * the audio end to within `drift^2` (<= ~1 ppm relative at the clamp).
 *
 * ## Determinism
 *
 * Every output is a pure function of the input (no clock reads, no
 * randomness — docs/testing/HARNESS.md); the same input produces a
 * deep-equal `SyncResult` on every call (tested).
 */
import { SessionTimeline } from "@sporta/contracts";
import type { SessionTimeline as SessionTimelineDoc } from "@sporta/contracts";
import { MetricsRegistry, bindLogger, createLogger } from "@sporta/observability";
import type { CorrelationContext, Logger } from "@sporta/observability";
import { InvalidTimelineError, isTimelineError } from "./errors";
import { toSessionMs } from "./clock";
import type { TrackClock } from "./clock";
import type { AnchorPair, TrackKind, TrackTiming } from "./anchors";

/** Log/metric stage name for every record emitted by this boundary. */
const TIMELINE_STAGE = "timeline-sync";

/** Label key carrying the terminal failure class on refusal counters. */
const FAILURE_CLASS_LABEL = "failure_class";

/**
 * Drift beyond this magnitude (in ppm) is a data fault, not a clock: the
 * measured value is clamped to +/-1000, a warn line is logged, and
 * `driftAnomaly` is set. (1000 ppm = 1 ms of skew per second of overlap.)
 */
export const DRIFT_CLAMP_PPM = 1000;

/** Metric names emitted by the timeline-synchronization boundary. */
export const TIMELINE_METRIC_NAMES = {
  /** Counter bumped once per successful `align` call. */
  alignmentsTotal: "timeline_sync_alignments_total",
  /** Counter bumped once per clamped drift anomaly. */
  driftAnomaliesTotal: "timeline_sync_drift_anomalies_total",
  /** Histogram of |driftPpm| (clamped), observed once per measured alignment. */
  absDriftPpm: "timeline_sync_abs_drift_ppm",
  /** Counter bumped once per classified timeline refusal. */
  failuresTotal: "timeline_sync_failures_total",
} as const;

/**
 * Input for {@link TimelineSynchronizer.align}: the two track timing
 * summaries plus the sample durations the end anchors need. The durations
 * are OPTIONAL on purpose: a caller that does not know them gets the
 * single-anchor fallback (drift 0, `driftMeasured: false`) rather than an
 * invented measurement.
 */
export interface AlignInput {
  /** Timing summary of the decoded video track. */
  video: TrackTiming;
  /** Timing summary of the decoded audio track. */
  audio: TrackTiming;
  /** Duration of one video frame in ms (e.g. 1000/30); unknown = omit. */
  videoFrameDurationMs?: number;
  /** Duration of one audio chunk in ms (e.g. 250); unknown = omit. */
  audioChunkDurationMs?: number;
}

/** The result of one successful alignment. */
export interface SyncResult {
  /**
   * The canonical session timeline, zod-VALIDATED against the contracts
   * `SessionTimeline` schema before returning (durationMs, the two clock
   * offset fields, driftMeasured) — the exact shape `MediaSession.timeline`
   * carries.
   */
  timeline: SessionTimelineDoc;
  /** The affine clocks for mapping each track's samples onto the timeline. */
  clocks: { video: TrackClock; audio: TrackClock };
  /**
   * The measured drift in ppm (the CLAMPED value when anomalous; 0 when not
   * measured). Positive = the video clock runs fast relative to audio.
   */
  driftPpm: number;
  /** Whether the two-anchor drift measurement actually happened. */
  driftMeasured: boolean;
  /** Whether the measured drift exceeded the clamp and was clamped. */
  driftAnomaly: boolean;
  /**
   * The anchor pairs the alignment used, in session milliseconds under the
   * offset-only (drift-free) clocks: always the start pair; the end pair is
   * present iff `driftMeasured` (its difference is the measured signal).
   */
  anchors: AnchorPair[];
}

/** Observability seams for the synchronizer; every field is optional. */
export interface TimelineObservability {
  /** Structured logger from `@sporta/observability` (default: silent no-op). */
  logger?: Logger;
  /** Metrics registry (default: private silent registry). */
  metrics?: MetricsRegistry;
  /** Correlation context bound onto every log line when provided. */
  correlation?: CorrelationContext;
}

/** Options for {@link TimelineSynchronizer}. */
export interface TimelineSynchronizerOptions {
  /** Observability seams (default: silent no-ops). */
  observability?: TimelineObservability;
}

/** Validates one track timing summary; throws `InvalidTimelineError` if bad. */
function validateTrackTiming(timing: TrackTiming, expectedKind: TrackKind): void {
  if (timing.kind !== expectedKind) {
    throw new InvalidTimelineError(
      `track timing kind mismatch: expected "${expectedKind}", got "${String(timing.kind)}"`,
      { trackId: timing.trackId, expectedKind, actualKind: String(timing.kind) },
    );
  }
  if (typeof timing.trackId !== "string" || timing.trackId.length < 1) {
    throw new InvalidTimelineError(`track timing requires a non-empty trackId`, {
      expectedKind,
      trackId: String(timing.trackId),
    });
  }
  if (!Number.isFinite(timing.firstSampleMs) || !Number.isFinite(timing.lastSampleMs)) {
    throw new InvalidTimelineError(
      `track timing timestamps must be finite (first ${String(timing.firstSampleMs)}, ` +
        `last ${String(timing.lastSampleMs)})`,
      {
        trackId: timing.trackId,
        firstSampleMs: String(timing.firstSampleMs),
        lastSampleMs: String(timing.lastSampleMs),
      },
    );
  }
  if (!Number.isInteger(timing.sampleCount) || timing.sampleCount <= 0) {
    throw new InvalidTimelineError(
      `zero-length track rejected: sampleCount must be a positive integer ` +
        `(got ${String(timing.sampleCount)} for ${timing.trackId})`,
      { trackId: timing.trackId, sampleCount: String(timing.sampleCount) },
    );
  }
  if (timing.lastSampleMs < timing.firstSampleMs) {
    throw new InvalidTimelineError(
      `track timing span is inverted: lastSampleMs ${timing.lastSampleMs} < ` +
        `firstSampleMs ${timing.firstSampleMs} for ${timing.trackId}`,
      {
        trackId: timing.trackId,
        firstSampleMs: timing.firstSampleMs,
        lastSampleMs: timing.lastSampleMs,
      },
    );
  }
}

/** Validates an optional sample duration; throws when present but invalid. */
function validateSampleDuration(durationMs: number | undefined, what: string): void {
  if (durationMs === undefined) return;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new InvalidTimelineError(
      `${what} must be a positive finite number when supplied (got ${String(durationMs)})`,
      { field: what, value: String(durationMs) },
    );
  }
}

/**
 * The timeline-synchronization boundary: one `align` call per media session
 * turns the two decoded track timing summaries into the canonical session
 * timeline (`SessionTimeline`, zod-validated), the per-track affine clocks
 * (`TrackClock`), and the measured drift with its anchors.
 *
 * Observability (architecture-lock §12): one structured info log line per
 * successful align (stage `"timeline-sync"`), a warn line when the drift
 * measurement is clamped or not measurable, a warn line plus labeled
 * counters on every classified refusal, and metrics counters
 * (`timeline_sync_alignments_total`, `timeline_sync_drift_anomalies_total`,
 * `timeline_sync_failures_total`) plus the `timeline_sync_abs_drift_ppm`
 * histogram. Absent observability objects become silent no-ops.
 */
export class TimelineSynchronizer {
  private readonly logger: Logger;
  private readonly metrics: MetricsRegistry;
  private readonly correlation: CorrelationContext | undefined;

  constructor(options: TimelineSynchronizerOptions = {}) {
    const noop = noopObservability();
    this.logger = options.observability?.logger ?? noop.logger;
    this.metrics = options.observability?.metrics ?? noop.metrics;
    this.correlation = options.observability?.correlation;
  }

  /**
   * Aligns the video and audio track clocks onto the canonical session
   * timeline. Pure with respect to the input: the same `AlignInput` always
   * yields a deep-equal `SyncResult` (no clock reads, no randomness).
   *
   * Throws `InvalidTimelineError` (`media-invalid`) on corrupt timing data:
   * zero-length tracks, inverted spans, non-finite values, kind mismatches,
   * or non-positive sample durations.
   */
  align(input: AlignInput): SyncResult {
    const logger = this.stageLogger();
    try {
      return this.alignValidated(input, logger);
    } catch (err) {
      if (isTimelineError(err)) {
        logger.warn("timeline refused", {
          failureClass: err.terminalFailureClass,
          error: err.message,
          ...err.details,
        });
        this.metrics.counter(TIMELINE_METRIC_NAMES.failuresTotal).inc();
        this.metrics
          .counter(TIMELINE_METRIC_NAMES.failuresTotal, {
            [FAILURE_CLASS_LABEL]: err.terminalFailureClass,
          })
          .inc();
      }
      throw err;
    }
  }

  // --- internals ----------------------------------------------------------

  /** The alignment body, run after the caller-facing try/catch is set up. */
  private alignValidated(input: AlignInput, logger: Logger): SyncResult {
    validateTrackTiming(input.video, "video");
    validateTrackTiming(input.audio, "audio");
    const videoFrameDurationMs = input.videoFrameDurationMs;
    const audioChunkDurationMs = input.audioChunkDurationMs;
    validateSampleDuration(videoFrameDurationMs, "videoFrameDurationMs");
    validateSampleDuration(audioChunkDurationMs, "audioChunkDurationMs");

    // 1. Canonical zero: the earliest first-sample defines session time 0.
    //    Both clocks share the -min mapping shift (comparable-clock model),
    //    and the contract offset fields record each track's start position.
    const sessionZeroSourceMs = Math.min(input.video.firstSampleMs, input.audio.firstSampleMs);
    const videoClockOffsetMs = input.video.firstSampleMs - sessionZeroSourceMs;
    const audioClockOffsetMs = input.audio.firstSampleMs - sessionZeroSourceMs;
    const shiftMs = -sessionZeroSourceMs;

    // 2. Anchors under the offset-only (drift-free) clocks: the start pair
    //    is always available; the end pair needs both sample durations.
    const videoStartSession = input.video.firstSampleMs - sessionZeroSourceMs;
    const audioStartSession = input.audio.firstSampleMs - sessionZeroSourceMs;
    const anchors: AnchorPair[] = [
      { at: "start", videoSessionMs: videoStartSession, audioSessionMs: audioStartSession },
    ];

    let driftPpm = 0;
    let driftMeasured = false;
    let driftAnomaly = false;

    if (videoFrameDurationMs !== undefined && audioChunkDurationMs !== undefined) {
      const videoEndSourceMs = input.video.lastSampleMs + videoFrameDurationMs;
      const audioEndSourceMs = input.audio.lastSampleMs + audioChunkDurationMs;
      const videoEndSession = videoEndSourceMs - sessionZeroSourceMs;
      const audioEndSession = audioEndSourceMs - sessionZeroSourceMs;

      const overlapMs =
        Math.min(videoEndSession, audioEndSession) - Math.max(videoStartSession, audioStartSession);

      if (overlapMs > 0) {
        // Two-anchor drift: the end-anchor disagreement over the overlap.
        const rawDriftPpm = ((videoEndSession - audioEndSession) / overlapMs) * 1_000_000;
        driftMeasured = true;
        if (Math.abs(rawDriftPpm) > DRIFT_CLAMP_PPM) {
          driftPpm = rawDriftPpm > 0 ? DRIFT_CLAMP_PPM : -DRIFT_CLAMP_PPM;
          driftAnomaly = true;
          logger.warn("timeline drift clamped", {
            rawDriftPpm,
            driftPpm,
            limitPpm: DRIFT_CLAMP_PPM,
            overlapMs,
            videoTrackId: input.video.trackId,
            audioTrackId: input.audio.trackId,
          });
          this.metrics.counter(TIMELINE_METRIC_NAMES.driftAnomaliesTotal).inc();
        } else {
          driftPpm = rawDriftPpm;
        }
        anchors.push({
          at: "end",
          videoSessionMs: videoEndSession,
          audioSessionMs: audioEndSession,
        });
        this.metrics.histogram(TIMELINE_METRIC_NAMES.absDriftPpm).observe(Math.abs(driftPpm));
      } else {
        // Durations were supplied but the session spans do not overlap: the
        // two-anchor method has no shared content to measure drift over.
        // Honest fallback: drift not measured (driftMeasured stays false).
        logger.warn("timeline drift not measurable", {
          reason: "no-session-overlap",
          overlapMs,
          videoTrackId: input.video.trackId,
          audioTrackId: input.audio.trackId,
        });
      }
    }

    // 3. The clocks: both carry the -min mapping shift; the audio clock is
    //    the canonical rate reference (drift 0), the video clock carries the
    //    CORRECTIVE drift (a fast video clock maps down onto the timeline).
    const videoClock: TrackClock = {
      trackId: input.video.trackId,
      offsetMs: shiftMs,
      driftPpm: driftMeasured ? -driftPpm : 0,
    };
    const audioClock: TrackClock = { trackId: input.audio.trackId, offsetMs: shiftMs, driftPpm: 0 };

    // 4. Duration: max end sessionMs across the tracks, under the FINAL
    //    (drift-corrected) clocks — the canonical timeline is the aligned
    //    one. A track's end is its last sample plus its sample duration when
    //    known, else its last sample position (a lower bound). The max(0)
    //    guards the affine correction's second-order undershoot against the
    //    contracts schema's non-negative durationMs on pathological spans.
    const videoEndForDuration = input.video.lastSampleMs + (videoFrameDurationMs ?? 0);
    const audioEndForDuration = input.audio.lastSampleMs + (audioChunkDurationMs ?? 0);
    const durationMs = Math.max(
      0,
      toSessionMs(videoClock, videoEndForDuration),
      toSessionMs(audioClock, audioEndForDuration),
    );

    // 5. The contract timeline, zod-validated BEFORE returning.
    const timeline: SessionTimelineDoc = SessionTimeline.parse({
      durationMs,
      videoClockOffsetMs,
      audioClockOffsetMs,
      driftMeasured,
    });

    logger.info("timeline aligned", {
      videoTrackId: input.video.trackId,
      audioTrackId: input.audio.trackId,
      durationMs,
      videoClockOffsetMs,
      audioClockOffsetMs,
      driftPpm,
      driftMeasured,
      driftAnomaly,
      anchorCount: anchors.length,
    });
    this.metrics.counter(TIMELINE_METRIC_NAMES.alignmentsTotal).inc();

    return {
      timeline,
      clocks: { video: videoClock, audio: audioClock },
      driftPpm,
      driftMeasured,
      driftAnomaly,
      anchors,
    };
  }

  /** Binds the stage (and correlation, when provided) onto a child logger. */
  private stageLogger(): Logger {
    if (this.correlation !== undefined) {
      return bindLogger(this.logger, this.correlation, TIMELINE_STAGE);
    }
    return this.logger.child({ stage: TIMELINE_STAGE });
  }
}

/**
 * Maps one decoded sample timestamp onto the canonical session timeline via
 * the track's clock — the stream-mapping entry point for W103 consumers
 * (W104 segment transport, W207 speech-to-text timestamp retention). Pure;
 * apply {@link ensureMonotonic} afterwards for bounded-reorder stream
 * mapping (the caller logs any clamped regression).
 */
export function mapSample(clock: TrackClock, sampleMs: number): number {
  return toSessionMs(clock, sampleMs);
}

/**
 * Bounded monotonicity for stream mapping (contracts: out-of-order
 * observations are accepted within a bounded reorder window; a stream's
 * session positions must never regress). Returns `candidateMs` when it does
 * not regress (`>= previousSessionMs`) and `previousSessionMs` (the clamped
 * value) when it does. PURE: the CALLER logs the clamped regression — this
 * function never emits records.
 */
export function ensureMonotonic(previousSessionMs: number, candidateMs: number): number {
  if (
    typeof previousSessionMs !== "number" ||
    !Number.isFinite(previousSessionMs) ||
    typeof candidateMs !== "number" ||
    !Number.isFinite(candidateMs)
  ) {
    throw new RangeError(
      `ensureMonotonic requires finite millisecond values ` +
        `(got previous ${String(previousSessionMs)}, candidate ${String(candidateMs)})`,
    );
  }
  return candidateMs < previousSessionMs ? previousSessionMs : candidateMs;
}

/**
 * Silent no-op observability defaults used when a caller provides none: a
 * logger that emits nothing (level filter above warn, no-op sink) and a
 * fresh in-memory metrics registry nobody reads. Mirrors the W101/W102
 * `noopObservability` (kept local so this package owns its seams).
 */
export function noopObservability(): { logger: Logger; metrics: MetricsRegistry } {
  return {
    logger: createLogger({ minLevel: "error", sink: () => {} }),
    metrics: new MetricsRegistry(),
  };
}
