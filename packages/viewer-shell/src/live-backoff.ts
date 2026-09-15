/**
 * The live reconnect policy (W704) — a PURE, deterministic backoff schedule.
 *
 * THE DOCUMENTED SCHEDULE (test-pinned in `../test/live-backoff.test.ts`):
 * the delay before reconnect attempt `n` (1-based) is
 *
 * ```text
 * delay(n) = min(BASE * 2^(n-1), CAP)      BASE = 500 ms, CAP = 4_000 ms
 * attempt:     1      2       3       4
 * delay (ms):  500   1_000   2_000   4_000
 * ```
 *
 * Properties (constitution):
 *
 * - **Deterministic**: no `Math.random`, no jitter of any kind — the same
 *   attempt count always yields the same delay. If jitter is ever wanted it
 *   must come from an injected seedable source (documented extension point;
 *   deliberately omitted: a deterministic schedule is replayable and
 *   test-pinnable, and no seam here supplies honest entropy).
 * - **No wall clock**: the delay is a NUMBER in the injected clock domain;
 *   `liveReconnectDelayMs` never reads time. The caller (the viewer core)
 *   adds the delay to its own injected clock reading and drives the attempt
 *   from its host-driven `tick` — no timers anywhere.
 * - **Bounded**: at most {@link LIVE_RECONNECT_MAX_ATTEMPTS} reconnect
 *   attempts fire per ATTACHED live stream (one `openLive`), CUMULATIVELY
 *   across separate connection losses — a stream that drops repeatedly
 *   stops honestly once its total reconnect budget is spent (a fresh
 *   `openLive` starts a fresh budget). A loss arriving when the budget is
 *   already spent is a terminal outcome, never a 5th attempt and never an
 *   infinite reconnect cycle (the cap is the retry-storm guard).
 *
 * WHICH failures reconnect (the retryability table, W305's verbatim classes
 * plus the classless connection loss): ONLY `connection-lost` (the viewer's
 * connection dropped while the session lives on) and `transport-failed`
 * (the underlying transport died — recoverable by re-establishing it) are
 * retryable. Every other W305 class is a deliberate, non-transient verdict:
 * `rights-denied`/`rights-lapsed` (fail-closed rights — repeating the
 * request cannot conjure the capability), `negotiation-failed`,
 * `negotiation-violation`, `protocol-violation`, `integrity-violation` —
 * all land in a TERMINAL user-facing state that names the failure honestly.
 */
import type { LiveOutputFailureClass } from "@sporta/webrtc-output";

/**
 * The reconnectable live failure vocabulary: the W305 classes a reconnect can
 * plausibly fix, plus the classless connection loss (the delivery stream's
 * `connection-lost` event). Everything else is terminal.
 */
export type LiveRetryableFailureClass = LiveOutputFailureClass | "connection-lost";

/**
 * The retryability table (test-pinned): `connection-lost` and `transport-failed`
 * reconnect; every other W305 failure class is terminal (see the module docs).
 */
export const LIVE_RETRYABLE_FAILURE_CLASSES: ReadonlySet<LiveRetryableFailureClass> = new Set([
  "connection-lost",
  "transport-failed",
]);

/** `true` when a reconnect may be attempted for this failure class. */
export function isLiveRetryableFailureClass(value: string): value is LiveRetryableFailureClass {
  return LIVE_RETRYABLE_FAILURE_CLASSES.has(value as LiveRetryableFailureClass);
}

/** The base delay of the schedule (ms, injected-clock domain). */
export const LIVE_RECONNECT_BASE_DELAY_MS = 500;

/** The delay ceiling of the schedule (ms, injected-clock domain). */
export const LIVE_RECONNECT_MAX_DELAY_MS = 4_000;

/** The cumulative attempt cap per ATTACHED stream (a loss past the spent budget is terminal). */
export const LIVE_RECONNECT_MAX_ATTEMPTS = 4;

/**
 * The full pinned schedule (attempt 1..cap). Exported as the single source the
 * table test deep-equals against — the schedule IS the contract.
 */
export const LIVE_RECONNECT_SCHEDULE_MS: readonly number[] = Object.freeze(
  Array.from({ length: LIVE_RECONNECT_MAX_ATTEMPTS }, (_, index) =>
    Math.min(LIVE_RECONNECT_BASE_DELAY_MS * 2 ** index, LIVE_RECONNECT_MAX_DELAY_MS),
  ),
);

/**
 * The delay before attempt `attempt` (1-based, injected-clock domain ms):
 * `min(BASE * 2^(attempt-1), CAP)`. Attempt `0` is the immediate first
 * try — no delay (a connection that never delivered a window reconnects at
 * once); an attempt beyond the cap is a caller error (the decision function
 * gates it — this function never invents a delay for a forbidden attempt).
 */
export function liveReconnectDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError(
      `liveReconnectDelayMs requires a non-negative integer attempt (got ${String(attempt)})`,
    );
  }
  if (attempt === 0) return 0;
  if (attempt > LIVE_RECONNECT_MAX_ATTEMPTS) {
    throw new RangeError(
      `liveReconnectDelayMs attempt ${String(attempt)} exceeds the cap ` +
        `${String(LIVE_RECONNECT_MAX_ATTEMPTS)} (terminal — never a delay)`,
    );
  }
  return LIVE_RECONNECT_SCHEDULE_MS[attempt - 1]!;
}

/** The terminal outcomes of {@link liveReconnectDecision} (machine reasons). */
export type LiveReconnectTerminalReason =
  /** The failure class is not in the retryability table. */
  | "non-retryable"
  /** The attempt cap was reached — the live stream stops honestly. */
  | "attempts-exhausted";

/** The decision: reconnect (with the schedule's delay) or stop terminally. */
export type LiveReconnectDecision =
  | {
      action: "reconnect";
      /** The attempt number ABOUT TO FIRE (1-based). */
      attempt: number;
      /** The delay before it (ms, injected-clock domain). */
      delayMs: number;
    }
  | {
      action: "terminal";
      reason: LiveReconnectTerminalReason;
    };

/**
 * The pure reconnect decision over `(failureClass, attemptsSoFar)` where
 * `attemptsSoFar` counts the attempts ALREADY FIRED for this attached
 * stream (cumulative across losses — see the module docs):
 *
 * - a retryable class with attempts remaining → the next attempt + its
 *   scheduled delay;
 * - a retryable class at the cap → `terminal / attempts-exhausted`;
 * - any other class → `terminal / non-retryable` (NEVER a retry storm:
 *   rights denials and protocol verdicts do not reconnect, whatever the
 *   attempt count is — the class check runs FIRST).
 */
export function liveReconnectDecision(
  failureClass: string,
  attemptsSoFar: number,
): LiveReconnectDecision {
  if (!isLiveRetryableFailureClass(failureClass)) {
    return { action: "terminal", reason: "non-retryable" };
  }
  if (!Number.isInteger(attemptsSoFar) || attemptsSoFar < 0) {
    throw new RangeError(
      `liveReconnectDecision requires a non-negative attempt count (got ${String(attemptsSoFar)})`,
    );
  }
  if (attemptsSoFar >= LIVE_RECONNECT_MAX_ATTEMPTS) {
    return { action: "terminal", reason: "attempts-exhausted" };
  }
  const attempt = attemptsSoFar + 1;
  return { action: "reconnect", attempt, delayMs: liveReconnectDelayMs(attempt) };
}
