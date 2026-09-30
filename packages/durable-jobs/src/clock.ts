/**
 * The durable-jobs clock + ids (REL-012) — the repo constitution (identity's
 * clock.ts precedent): library code never reads wall time or randomness
 * directly; a CLOCK and an ID SOURCE are injected. Tests use the MANUAL
 * clock (advanceable) to drive lease expiry and retry backoff
 * deterministically.
 */

/**
 * The default epoch — the same instant as `@sporta/testing`'s
 * TEST_EPOCH_MS and identity's IDENTITY_DEFAULT_EPOCH_MS
 * (`Date.parse("2025-01-06T12:00:00.000Z")`), carried locally so this
 * package has no runtime dependency on either.
 */
export const JOBS_DEFAULT_EPOCH_MS = 1_736_164_800_000;

/** Deterministic default clock: `JOBS_DEFAULT_EPOCH_MS + ticks`. */
export function createJobsDefaultClock(): () => number {
  let ticks = 0;
  return (): number => JOBS_DEFAULT_EPOCH_MS + (ticks += 1);
}

/**
 * A manual clock: callable as `now()` and advanceable via `advance(ms)`
 * (returns the new reading). The lease-expiry and retry-backoff tests
 * drive time through it — no sleeping, ever.
 */
export interface ManualClock {
  (): number;
  advance(ms: number): number;
}

/** Creates a manual clock starting at {@link startMs} (default: the epoch). */
export function createManualClock(startMs: number = JOBS_DEFAULT_EPOCH_MS): ManualClock {
  let now = startMs;
  const clock = (): number => now;
  clock.advance = (ms: number): number => {
    now += ms;
    return now;
  };
  return clock;
}

/** The id source port: opaque unique ids for jobs. */
export interface IdSource {
  nextId(): string;
}

/** A deterministic sequential id source: `<prefix>-<n>` from 1. */
export function createSequentialIdSource(prefix: string): IdSource {
  let next = 0;
  return {
    nextId(): string {
      next += 1;
      return `${prefix}-${next}`;
    },
  };
}

/** The default job id source (deterministic: `job-1`, `job-2`, ...). */
export function createDefaultJobIdSource(): IdSource {
  return createSequentialIdSource("job");
}

/** Formats an epoch-ms clock reading as ISO-8601 UTC. */
export function toIsoUtc(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
