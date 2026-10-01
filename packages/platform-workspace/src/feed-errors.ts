/**
 * Typed external-feed errors (REL-031) — the repo conventions (identity's /
 * corpus's / jobs's / registry's / external-platform's / the workspace's own
 * errors.ts): a classified `failureClass`, a stable machine-readable `code`,
 * JSON-safe details.
 *
 * THE DIVISION (the feed session is a COMPOSITION over the REL-024
 * workspace, never a second authority): this family covers only the
 * FEED-SESSION staging failures — a feed/selection/options request that
 * violates the session contract shape, a bounds breach the session refuses
 * (max items per batch), and the convergence invariant guard (a re-submitted
 * batch that resolved to a different job than the one the session recorded).
 * The underlying authorities' typed errors (`corpus.*`,
 * `platform.*`, `registry.*`, `jobs.*`, `workspace.*`) propagate UNCHANGED
 * through the session — recorded per batch in the feed record and re-thrown
 * verbatim by the submission-wave surface; nothing is re-wrapped, nothing is
 * swallowed (the workspace errors.ts precedent, carried to the feed lane).
 */

/** Failure classification for external-feed session rejections. */
export type FeedFailureClass = "validation" | "bounds" | "conflict" | "internal";

/** The base of the external-feed error family. */
export class FeedApiError extends Error {
  readonly failureClass: FeedFailureClass;
  /** The stable machine-readable error code, e.g. "feed.bounds". */
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: FeedFailureClass,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "FeedApiError";
    this.failureClass = failureClass;
    this.code = code;
    this.details = details;
  }
}

/** Malformed feed-session input (options, source access, request shapes). */
export class FeedValidationError extends FeedApiError {
  constructor(message: string, issues: readonly unknown[] = []) {
    super("validation", "feed.validation", message, { issues });
    this.name = "FeedValidationError";
  }
}

/**
 * A bounds breach the feed session refuses: a batch that exceeds the
 * per-batch item ceiling (enforced, never advisory — the session STOPS and
 * records the truncation honestly rather than submit an oversized batch).
 */
export class FeedBoundsError extends FeedApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("bounds", "feed.bounds", message, details);
    this.name = "FeedBoundsError";
  }
}

/**
 * The at-least-once convergence guard: a re-submitted batch (the same
 * idempotency key, the identical request) resolved to a DIFFERENT durable
 * job than the one the session already recorded — an impossibility under
 * REL-029's convergence law, refused typed rather than silently accepted.
 */
export class FeedConflictError extends FeedApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("conflict", "feed.conflict", message, details);
    this.name = "FeedConflictError";
  }
}

/** Union of the typed external-feed errors. */
export type FeedError = FeedApiError | FeedValidationError | FeedBoundsError | FeedConflictError;

/** Type guard: `true` when `value` is a typed external-feed error. */
export function isFeedError(value: unknown): value is FeedApiError {
  return value instanceof FeedApiError;
}
