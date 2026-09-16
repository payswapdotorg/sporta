/**
 * The admission-guard errors + subject helpers (W913).
 *
 * Two honest refusal shapes, both carrying the machine-readable state that
 * produced them (never a bare "no"):
 *
 * - `RateLimitedError` (HTTP 429): a per-subject QUOTA was exhausted (auth
 *   attempt limits, per-user render requests). The body carries the W901
 *   `QuotaState` verbatim + `retryAfterSeconds`; the response carries the
 *   standard `Retry-After` header.
 * - `QueueFullError` (HTTP 503): the PLATFORM's bounded job queue is at its
 *   hard depth bound (capacity, not the caller's fault). Fail-closed
 *   admission per Simulation E — the expensive job is refused BEFORE the
 *   provider is asked to run it.
 *
 * Subjects are sanitized before they ever reach a counter key: the counter
 * key namespace is `quota:<quotaId>:<subject>:<windowIndex>`, so a subject
 * must be a closed charset (never free-form user input).
 */
import type { PlatformQuotaState } from "./quotas";

/** The sanitized-attempt subject for a per-account/per-identity quota. */
export const UNKNOWN_SUBJECT = "unknown";

/**
 * Normalizes an attempted identity handle into a safe counter subject.
 * Mirrors the identity transport's username charset (`[a-z0-9][a-z0-9._-]{2,31}`);
 * anything else (including absent/non-string input) buckets to `invalid`.
 */
export function attemptSubject(raw: unknown): string {
  if (typeof raw !== "string") return "invalid";
  const normalized = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalized) ? normalized : "invalid";
}

/** Seconds until the current fixed window rolls over (min 1 — an honest hint). */
export function retryAfterSeconds(nowMs: number, windowSeconds: number): number {
  const windowMs = windowSeconds * 1000;
  const intoWindow = ((nowMs % windowMs) + windowMs) % windowMs;
  return Math.max(1, Math.ceil((windowMs - intoWindow) / 1000));
}

/** A per-subject quota refusal (HTTP 429 + Retry-After). */
export class RateLimitedError extends Error {
  readonly status = 429;
  readonly failureClass = "rate-limited";
  readonly quota: PlatformQuotaState;
  readonly retryAfterSeconds: number;

  constructor(quota: PlatformQuotaState, retryAfter: number) {
    super(
      quota.reasonCode === "quota-counter-invalid"
        ? "too many attempts: the attempt counter is unreadable, so admission is refused until it recovers"
        : `too many attempts: quota '${quota.quotaId}' is exhausted for this window`,
    );
    this.name = "RateLimitedError";
    this.quota = quota;
    this.retryAfterSeconds = retryAfter;
  }
}

/** The platform-capacity refusal (HTTP 503 + Retry-After). */
export class QueueFullError extends Error {
  readonly status = 503;
  readonly failureClass = "capacity-exceeded";
  readonly depth: number;
  readonly maxDepth: number;
  readonly retryAfterSeconds: number;

  constructor(depth: number, maxDepth: number, retryAfter: number) {
    super(
      `the render queue is at its capacity bound (${depth}/${maxDepth}); admission is refused until running jobs settle`,
    );
    this.name = "QueueFullError";
    this.depth = depth;
    this.maxDepth = maxDepth;
    this.retryAfterSeconds = retryAfter;
  }
}
