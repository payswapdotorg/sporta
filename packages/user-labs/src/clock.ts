/**
 * The user-labs default clock + ids (REL-020).
 *
 * The repo-wide constitution (identity's clock.ts and the organization
 * registry's clock.ts are the direct precedents): library code never reads
 * wall time or randomness directly — a CLOCK and ID SOURCES are injected.
 * Production callers inject the real thing; the deterministic defaults exist
 * so unseeded runs stay reproducible (docs/testing/HARNESS.md).
 */

/**
 * The default epoch — the same instant as `@sporta/testing`'s TEST_EPOCH_MS,
 * identity's IDENTITY_DEFAULT_EPOCH_MS and the registry's
 * REGISTRY_DEFAULT_EPOCH_MS (`Date.parse("2025-01-06T12:00:00.000Z")`),
 * carried locally so this package adds no new runtime dependencies for time.
 */
export const USER_LABS_DEFAULT_EPOCH_MS = 1_736_164_800_000;

/** Deterministic default clock: `USER_LABS_DEFAULT_EPOCH_MS + ticks`. */
export function createUserLabsDefaultClock(): () => number {
  let ticks = 0;
  return (): number => USER_LABS_DEFAULT_EPOCH_MS + (ticks += 1);
}

/**
 * The id source port: opaque unique ids for labs, runs, candidates,
 * publications, promotion requests and ledger entries. The default is a
 * deterministic sequential source (tests pin exact behavior); production
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

/** Formats an epoch-ms clock reading as ISO-8601 UTC. */
export function toIsoUtc(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
