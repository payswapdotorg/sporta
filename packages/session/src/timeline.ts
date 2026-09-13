/**
 * Session timeline and processing state (W004).
 *
 * {@link SessionTimelineService} owns the canonical timeline math: the
 * measured offsets of the video and audio clocks relative to the canonical
 * session timeline, canonical-time conversion, and measured drift between the
 * clocks (W103 semantics: `driftMeasured` records whether alignment was
 * actually measured).
 *
 * {@link ProcessingStateService} owns per-session processing state: monotonic
 * watermark advancement (never backwards), error notes, and classification of
 * terminal failures.
 */
import { TerminalFailureClass } from "@sporta/contracts";
import type {
  ProcessingState,
  SessionTimeline,
  TerminalFailureClass as TerminalFailureClassType,
  Watermark,
} from "@sporta/contracts";

/** Which media clock a source time belongs to. */
export type TimelineClock = "video" | "audio";

/**
 * Input for {@link SessionTimelineService.calibrate}: measured clock offsets.
 * Calibration is a measurement, so it marks `driftMeasured`.
 */
export interface CalibrateInput {
  /** Video-clock reading at canonical timeline zero (milliseconds). */
  videoClockOffsetMs: number;
  /** Audio-clock reading at canonical timeline zero (milliseconds). */
  audioClockOffsetMs: number;
}

const DEFAULT_TIMELINE: SessionTimeline = {
  durationMs: 0,
  videoClockOffsetMs: 0,
  audioClockOffsetMs: 0,
  driftMeasured: false,
};

/**
 * Canonical timeline state and conversion math for one session.
 *
 * Offsets follow the `SessionTimeline` contract: `videoClockOffsetMs` /
 * `audioClockOffsetMs` are the respective clock readings at canonical timeline
 * zero, so `canonical = sourceTime - offset`. A source time before the
 * offset maps to a negative canonical position; consumers validate against
 * the (non-negative) `TimelinePoint` contract when persistence requires it.
 *
 * The service is seedable from a persisted `SessionTimeline` and exposes
 * `.timeline` (a deep copy) for persistence round-trips.
 */
export class SessionTimelineService {
  private state: SessionTimeline;

  constructor(initial?: SessionTimeline) {
    this.state = initial === undefined ? { ...DEFAULT_TIMELINE } : structuredClone(initial);
  }

  /** Current timeline state, as a deep copy owned by the caller. */
  get timeline(): SessionTimeline {
    return structuredClone(this.state);
  }

  /**
   * Sets the canonical timeline duration in milliseconds. Non-negative;
   * throws `RangeError` otherwise.
   */
  setDuration(durationMs: number): void {
    if (durationMs < 0) {
      throw new RangeError(`timeline durationMs must be non-negative, got ${durationMs}`);
    }
    this.state = { ...this.state, durationMs };
  }

  /**
   * Records measured clock offsets. Calibration is a measurement, so it marks
   * `driftMeasured = true`. Returns the updated timeline (deep copy).
   */
  calibrate(input: CalibrateInput): SessionTimeline {
    this.state = {
      ...this.state,
      videoClockOffsetMs: input.videoClockOffsetMs,
      audioClockOffsetMs: input.audioClockOffsetMs,
      driftMeasured: true,
    };
    return this.timeline;
  }

  /**
   * Converts a source-clock time to the canonical timeline:
   * `sourceTimeMs - offset(clock)` (milliseconds).
   */
  toCanonicalTimeline(clock: TimelineClock, sourceTimeMs: number): number {
    const offset =
      clock === "video" ? this.state.videoClockOffsetMs : this.state.audioClockOffsetMs;
    return sourceTimeMs - offset;
  }

  /**
   * Measures the current drift between the two clocks: the canonical position
   * of the video reading minus the canonical position of the audio reading
   * (positive = video ahead). Marks `driftMeasured = true` and returns the
   * drift in milliseconds.
   */
  driftBetween(videoMs: number, audioMs: number): number {
    const drift =
      this.toCanonicalTimeline("video", videoMs) - this.toCanonicalTimeline("audio", audioMs);
    this.state = { ...this.state, driftMeasured: true };
    return drift;
  }
}

/** Thrown when a watermark advances backwards (monotonicity violation). */
export class WatermarkRegressionError extends Error {
  readonly from: Watermark;
  readonly to: Watermark;

  constructor(from: Watermark, to: Watermark) {
    super(
      `watermark regression: attempted ${to.watermarkMs}ms/#${to.sequence} while at ${from.watermarkMs}ms/#${from.sequence}`,
    );
    this.name = "WatermarkRegressionError";
    this.from = from;
    this.to = to;
  }
}

/** A media/codec/container problem at the ingestion boundary (W101). */
export class MediaInvalidError extends Error {
  readonly terminalFailureClass = "media-invalid" as const;

  constructor(message: string) {
    super(message);
    this.name = "MediaInvalidError";
  }
}

/** A resource budget was exceeded (bounded buffers, GPU, time). */
export class ResourceLimitError extends Error {
  readonly terminalFailureClass = "resource-limit" as const;

  constructor(message: string) {
    super(message);
    this.name = "ResourceLimitError";
  }
}

const TERMINAL_FAILURE_CLASSES: ReadonlySet<string> = new Set(TerminalFailureClass.options);

/**
 * Processing-state logic for one session: watermark monotonicity, error
 * notes, and terminal failure classification.
 *
 * All methods are pure with respect to their input state.
 */
export class ProcessingStateService {
  /**
   * Advances the watermark. Monotonic: neither `watermarkMs` nor `sequence`
   * may move backwards; a duplicate watermark (both equal) is an idempotent
   * no-op. Throws {@link WatermarkRegressionError} on any regression.
   */
  advanceWatermark(state: ProcessingState, watermark: Watermark): ProcessingState {
    const current = state.watermark;
    if (
      current !== undefined &&
      (watermark.watermarkMs < current.watermarkMs || watermark.sequence < current.sequence)
    ) {
      throw new WatermarkRegressionError(current, watermark);
    }
    return { ...state, watermark: { ...watermark } };
  }

  /**
   * Records the message of `err` in `processingState.lastError` and returns
   * the updated state (deep-copied fields; input not mutated).
   */
  noteError(state: ProcessingState, err: unknown): ProcessingState {
    const message = err instanceof Error ? err.message : String(err);
    return { ...state, lastError: message };
  }

  /**
   * Maps an error to its terminal failure class. Any error carrying a valid
   * `terminalFailureClass` property (e.g. `RightsDeniedError`,
   * `MediaInvalidError`, `ResourceLimitError`) classifies to that class;
   * anything else is `internal`. Unknown string values are ignored
   * (fail-safe to `internal`, not fail-open).
   */
  classifyFailure(err: unknown): TerminalFailureClassType {
    const candidate = (err as { terminalFailureClass?: unknown } | null | undefined)
      ?.terminalFailureClass;
    return typeof candidate === "string" && TERMINAL_FAILURE_CLASSES.has(candidate)
      ? (candidate as TerminalFailureClassType)
      : "internal";
  }
}
