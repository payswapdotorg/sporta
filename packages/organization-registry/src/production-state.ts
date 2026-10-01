/**
 * Production-state capture and restoration proof (REL-033).
 *
 * THE LAW BEING PROVED (REL-A4): when an automatically rolled-back
 * organization leaves production, the PREVIOUS production state is what
 * remains — the rollback restores it. The registry keeps every version and
 * never mutates other organizations, so "restoration" here is a PROVABLE
 * read-model equality: the set of production organizations (id + version)
 * after the rollback equals the set captured before the rolled-back
 * organization was promoted.
 *
 * This module is a pure read model over the delivered registry — no new
 * mutation path, no new state. `captureProductionState` snapshots the
 * production set (optionally scoped by the same eligibility matching rule
 * the registry and the choice surface share — one truth); `diffProductionState`
 * names what was added/removed between two snapshots;
 * `productionStateRestored` is the boolean the proof battery asserts.
 */
import type { EligibilityQuery, OrganizationRecord } from "./domain";
import { matchesQuery } from "./domain";
import type { OrganizationRegistry } from "./registry";

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

/** One production organization, identified to the exact version. */
export interface ProductionOrganizationRef {
  organizationId: string;
  version: number;
}

/** An immutable snapshot of the production set (optionally query-scoped). */
export interface ProductionStateSnapshot {
  /** The scope the snapshot was captured under (undefined = all domains). */
  query?: EligibilityQuery;
  /** Production organizations, sorted by organizationId (deterministic). */
  organizations: readonly ProductionOrganizationRef[];
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * Captures the current production state: every organization whose LATEST
 * version stands in `production`, optionally narrowed by an eligibility
 * query (the registry's own `matchesQuery` rule — one truth, three read
 * models: registry, choice, production state).
 */
export async function captureProductionState(
  registry: OrganizationRegistry,
  query?: EligibilityQuery,
): Promise<ProductionStateSnapshot> {
  const latest = await registry.list();
  const production = latest
    .filter((record: OrganizationRecord) => record.status === "production")
    .filter((record: OrganizationRecord) => query === undefined || matchesQuery(record, query))
    .map((record: OrganizationRecord) => ({
      organizationId: record.organizationId,
      version: record.version,
    }))
    .sort((a, b) =>
      a.organizationId < b.organizationId ? -1 : a.organizationId > b.organizationId ? 1 : 0,
    );
  return Object.freeze({
    ...(query !== undefined ? { query } : {}),
    organizations: Object.freeze(production),
  }) as ProductionStateSnapshot;
}

// ---------------------------------------------------------------------------
// Diff + restoration
// ---------------------------------------------------------------------------

/** What changed between two production-state snapshots. */
export interface ProductionStateDiff {
  /** Organizations in `after` but not in `before` (by id + version). */
  added: readonly ProductionOrganizationRef[];
  /** Organizations in `before` but not in `after` (by id + version). */
  removed: readonly ProductionOrganizationRef[];
}

function keyOf(ref: ProductionOrganizationRef): string {
  return `${ref.organizationId}@v${ref.version}`;
}

/**
 * Diffs two snapshots by (organizationId, version). A version bump of a
 * still-production organization therefore counts as remove+add — the diff
 * names exactly what changed, never silently equates versions.
 */
export function diffProductionState(
  before: ProductionStateSnapshot,
  after: ProductionStateSnapshot,
): ProductionStateDiff {
  const beforeKeys = new Set(before.organizations.map(keyOf));
  const afterKeys = new Set(after.organizations.map(keyOf));
  return {
    added: after.organizations.filter((ref) => !beforeKeys.has(keyOf(ref))),
    removed: before.organizations.filter((ref) => !afterKeys.has(keyOf(ref))),
  };
}

/**
 * Is `after` exactly the `before` production state? The REL-A4 restoration
 * proof: after an automatic rollback, nothing was added and nothing (else)
 * was removed — the previous production state is what serves again.
 */
export function productionStateRestored(
  before: ProductionStateSnapshot,
  after: ProductionStateSnapshot,
): boolean {
  const diff = diffProductionState(before, after);
  return diff.added.length === 0 && diff.removed.length === 0;
}
