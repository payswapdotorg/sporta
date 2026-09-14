/**
 * Error taxonomy for @sporta/temporal.
 *
 * The temporal API is a thin, fail-loud consumer surface over the W006 engine
 * (repo style: `RangeError` for malformed input, engine errors pass through
 * unchanged). The one error this package owns is the enforced replay limit —
 * replay is a BOUNDED operation by design (architecture-lock §8: bounded
 * everything): a window that would exceed a caller-declared limit is refused
 * before any application happens, never silently truncated.
 */

/** Which enforced replay limit was exceeded. */
export type TemporalLimitKind = "maxEvents" | "maxSpanMs";

/**
 * A replay window exceeded an enforced `ReplayLimits` bound.
 *
 * A `RangeError` subclass (the repo's malformed-input error): the input was
 * out of the declared operating range. The replay is refused BEFORE any event
 * is applied — partial replays are never returned for limit violations.
 */
export class TemporalLimitsError extends RangeError {
  /** The limit that was exceeded. */
  readonly limitKind: TemporalLimitKind;
  /** The configured limit value. */
  readonly limit: number;
  /** The observed value that exceeded the limit. */
  readonly actual: number;

  constructor(details: { limitKind: TemporalLimitKind; limit: number; actual: number }) {
    const subject =
      details.limitKind === "maxEvents"
        ? `${details.actual} events to apply`
        : `window span ${details.actual}ms`;
    super(
      `replayForward: ${subject} exceeds ${details.limitKind}=${details.limit} ` +
        "(replay is a bounded operation by design — narrow the window or raise the limit)",
    );
    this.name = "TemporalLimitsError";
    this.limitKind = details.limitKind;
    this.limit = details.limit;
    this.actual = details.actual;
  }
}
