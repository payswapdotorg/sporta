/**
 * The corpus default clock + ids (REL-009).
 *
 * The repo-wide constitution (identity's clock.ts is the direct precedent,
 * organization-registry carries the same law): library code never reads
 * wall time or randomness directly — a CLOCK and an ID SOURCE are injected.
 * Production callers inject the real thing; the deterministic defaults
 * exist so unseeded runs stay reproducible.
 */

/**
 * The default epoch — the same instant as `@sporta/testing`'s
 * TEST_EPOCH_MS and identity's IDENTITY_DEFAULT_EPOCH_MS
 * (`Date.parse("2025-01-06T12:00:00.000Z")`), carried locally so this
 * package has no runtime dependency on either.
 */
export const CORPUS_DEFAULT_EPOCH_MS = 1_736_164_800_000;

/** Deterministic default clock: `CORPUS_DEFAULT_EPOCH_MS + ticks`. */
export function createCorpusDefaultClock(): () => number {
  let ticks = 0;
  return (): number => CORPUS_DEFAULT_EPOCH_MS + (ticks += 1);
}

/**
 * The id source port: opaque unique ids for source records. The default is
 * a deterministic sequential source (tests pin exact ids); production
 * injects whatever unique-id mechanism the deployment has.
 */
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

/** The default source id source (deterministic: `source-1`, `source-2`, ...). */
export function createDefaultSourceIdSource(): IdSource {
  return createSequentialIdSource("source");
}

/** Formats an epoch-ms clock reading as ISO-8601 UTC. */
export function toIsoUtc(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
