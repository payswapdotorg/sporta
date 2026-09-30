/**
 * The external-platform clock + ids (REL-014) — the repo constitution
 * (identity's / corpus's / jobs's clock.ts precedents): library code never
 * reads wall time or randomness directly; a CLOCK and an ID SOURCE are
 * injected. Tests drive deterministic scenarios through them.
 */

/**
 * The default epoch — the same instant as `@sporta/testing`'s TEST_EPOCH_MS,
 * identity's, the corpus's and the jobs's (`Date.parse("2025-01-06T12:00:00.000Z")`),
 * carried locally so this package adds no runtime dependency for a constant.
 */
export const PLATFORM_DEFAULT_EPOCH_MS = 1_736_164_800_000;

/** Deterministic default clock: `PLATFORM_DEFAULT_EPOCH_MS + ticks`. */
export function createPlatformDefaultClock(): () => number {
  let ticks = 0;
  return (): number => PLATFORM_DEFAULT_EPOCH_MS + (ticks += 1);
}

/** The id source port: opaque unique ids for connections/artifacts/evidence. */
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

/** The default platform id source (deterministic: `conn-1`, `conn-2`, ...). */
export function createDefaultConnectionIdSource(): IdSource {
  return createSequentialIdSource("conn");
}

/** Formats an epoch-ms clock reading as ISO-8601 UTC. */
export function toIsoUtc(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
