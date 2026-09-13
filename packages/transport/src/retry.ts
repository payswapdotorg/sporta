/**
 * Deterministic retry engine (W104 §3.2).
 *
 * Implements the streaming contract's recovery rule: "Processing stages
 * support retries where deterministic/idempotent" (docs/contracts/streaming.md)
 * — the opposite is enforced too: a failure the stage classified as
 * NON-retryable is returned immediately, never blindly retried. `degraded` is
 * a SUCCESS-class status (explicitly degraded work is still delivered), so it
 * never triggers a retry.
 *
 * Determinism contract (docs/testing/HARNESS.md): backoff delays are PURE
 * ARITHMETIC (`baseDelayMs * backoffMultiplier^(attempt - 1)`) and all
 * sleeping goes through an injectable {@link RetryClock} — the default wraps
 * the real `setTimeout`, unit tests inject a recording fake, so no test ever
 * depends on wall-clock time. The engine never swallows the final failure:
 * the LAST `StageResult` is returned verbatim, extended only with the attempt
 * counters.
 */
import type { StageMessage, StageResult } from "@sporta/contracts";

/** Injectable sleep function — the only timing dependency of the engine. */
export interface RetryClock {
  /** Sleeps for `ms` milliseconds (tests record instead of sleeping). */
  sleep: (ms: number) => Promise<void>;
}

/** Options for {@link withRetries}. */
export interface RetryOptions {
  /** Total attempts (>= 1), including the first one. */
  maxAttempts: number;
  /** Delay before the second attempt (>= 0). */
  baseDelayMs: number;
  /** Exponential backoff factor (>= 1). */
  backoffMultiplier: number;
  /**
   * Retryability predicate (default: the result's own `retryable` flag).
   * Overrides are for callers that know more than the stage did.
   */
  retryable?: (result: StageResult) => boolean;
  /** Injectable clock (default: real `setTimeout`; tests inject a fake). */
  clock?: RetryClock;
}

/** A {@link StageResult} extended with the engine's attempt accounting. */
export type RetryOutcome = StageResult & {
  /** Attempts made, including the first (>= 1). */
  attempts: number;
  /** Retries consumed (`attempts - 1`). */
  retriesUsed: number;
};

/** The real clock: default sleep via `setTimeout` (never used by unit tests). */
const defaultClock: RetryClock = {
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/**
 * Fail-loud validation of {@link RetryOptions} (also run by {@link withRetries}
 * on every call, so stage owners can pre-validate at wiring time).
 */
export function validateRetryOptions(opts: RetryOptions): void {
  if (!Number.isInteger(opts.maxAttempts) || opts.maxAttempts < 1) {
    throw new RangeError(
      `RetryOptions.maxAttempts must be an integer >= 1 (got ${String(opts.maxAttempts)})`,
    );
  }
  if (!Number.isFinite(opts.baseDelayMs) || opts.baseDelayMs < 0) {
    throw new RangeError(
      `RetryOptions.baseDelayMs must be a finite number >= 0 (got ${String(opts.baseDelayMs)})`,
    );
  }
  if (!Number.isFinite(opts.backoffMultiplier) || opts.backoffMultiplier < 1) {
    throw new RangeError(
      `RetryOptions.backoffMultiplier must be a finite number >= 1 ` +
        `(got ${String(opts.backoffMultiplier)})`,
    );
  }
  if (opts.retryable !== undefined && typeof opts.retryable !== "function") {
    throw new TypeError("RetryOptions.retryable must be a function");
  }
  if (opts.clock !== undefined && typeof opts.clock.sleep !== "function") {
    throw new TypeError("RetryOptions.clock.sleep must be a function");
  }
}

/**
 * Runs `stage(msg)` with deterministic retry semantics:
 *
 * - `ok` or `degraded` → returned immediately (success class, no retry);
 * - `failed` AND retryable AND attempts left → sleep
 *   `baseDelayMs * backoffMultiplier^(attempt - 1)` and retry;
 * - `failed` non-retryable, or the attempt budget exhausted → the LAST
 *   `StageResult` is returned verbatim (the final error is never swallowed).
 *
 * The returned outcome extends the stage's result with `attempts` and
 * `retriesUsed`. A `stage` function that THROWS propagates the exception to
 * the caller — converting thrown bugs into classified failures is the stage
 * boundary's job (see `StageRunner`), not the retry engine's.
 */
export async function withRetries(
  msg: StageMessage,
  stage: (msg: StageMessage) => Promise<StageResult>,
  opts: RetryOptions,
): Promise<RetryOutcome> {
  validateRetryOptions(opts);
  if (typeof stage !== "function") {
    throw new TypeError("withRetries requires a stage function");
  }
  const retryable = opts.retryable ?? ((result: StageResult) => result.retryable);
  const clock = opts.clock ?? defaultClock;

  let attempts = 0;
  for (;;) {
    attempts += 1;
    const result = await stage(msg);
    if (result.status !== "failed") {
      // "ok" and "degraded" are both success class: degraded work is
      // delivered as-is, never retried.
      return { ...result, attempts, retriesUsed: attempts - 1 };
    }
    if (attempts >= opts.maxAttempts || !retryable(result)) {
      // Non-retryable failure or exhausted budget: the LAST StageResult goes
      // back verbatim — the engine never swallows the final error.
      return { ...result, attempts, retriesUsed: attempts - 1 };
    }
    // Pure arithmetic delay; sleeping goes through the injected clock only.
    const delayMs = opts.baseDelayMs * Math.pow(opts.backoffMultiplier, attempts - 1);
    await clock.sleep(delayMs);
  }
}
