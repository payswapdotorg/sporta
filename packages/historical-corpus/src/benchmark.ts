/**
 * Benchmark registration (REL-011) — immutable, content-addressed, reusable
 * benchmark entries over NORMALIZED sources, plus the corpus query API.
 *
 * Source of truth: docs/contracts/historical-media-and-corpus.md (FROZEN):
 * - §Corpus design: "Corpus entries are reference-first with derived feature
 *   bundles. Repeated simulation should reuse durable derived features
 *   rather than repeatedly fetching source media."
 * - §Reproducibility: "Every benchmark fixture is content-addressed by:
 *   source identifier/reference; acquired-byte checksum where applicable;
 *   normalized-byte checksum; time window; feature/decoder versions."
 * - docs/testing/reality-engineering-lab-acceptance.md Gate REL-A1 item 6:
 *   "register benchmark windows/features."
 *
 * THE ELIGIBILITY LAW (binding, typed): benchmarks require ACQUIRED +
 * NORMALIZED bytes. A registration from a reference-only source is refused
 * with the typed error `corpus.benchmark-ineligible` — a URL is a source
 * reference, not proof of transformation rights, and the class-5 law extends
 * to the benchmark bar: what was never acquired can never be a benchmark.
 * A source that was acquired but not yet normalized is refused with the same
 * typed error naming the state it is in (the honest "not there yet").
 *
 * THE IMMATURITY/IMMUTABILITY LAW (the v0 state machine, extended): the
 * fixture binding happens through `store.markBenchmarked` — only a
 * `normalized` source may bind, `benchmarked` is terminal, and one source
 * carries exactly ONE binding. Re-registering the same content (same
 * window/versions/checksums) is IDEMPOTENT (the entry is content-addressed,
 * so identical content is the identical entry); attempting a DIFFERENT
 * registration over an already-benchmarked source is a typed conflict — the
 * binding is immutable evidence.
 */
import type { FeatureBundleRef, FeatureBundleRefInput, SourceRecord } from "./domain";
import { createBenchmarkFixture } from "./fixtures";
import type { BenchmarkFixture, ComponentVersion, TimeWindow } from "./fixtures";
import { createCorpusDefaultClock } from "./clock";
import { CorpusBenchmarkIneligibleError, CorpusConflictError, CorpusNotFoundError } from "./errors";
import type { CorpusStore } from "./store";

// ---------------------------------------------------------------------------
// The registration record
// ---------------------------------------------------------------------------

/** The registration request: the window + the versions to pin. */
export interface BenchmarkRegistrationRequest {
  /** The corpus source to register the benchmark over (must be normalized). */
  readonly sourceId: string;
  /** The benchmark time window (epoch ms, start/end inclusive). */
  readonly timeWindow: TimeWindow;
  /** The feature/decoder versions the fixture's reproducibility pins. */
  readonly versions: readonly ComponentVersion[];
  /**
   * Derived feature bundles to record against the source (REFERENCES,
   * never fetched — the corpus design's reusable derived features).
   */
  readonly featureBundles?: readonly FeatureBundleRefInput[];
}

/**
 * One immutable, content-addressed, reusable benchmark entry. The
 * `registrationId` IS the fixture's content address (the SHA-256 of the
 * canonical reproducibility preimage): identical content is the identical
 * entry, any field change is a different one.
 */
export interface BenchmarkRegistration {
  /** The content address (=== `fixture.fixtureId`). */
  readonly registrationId: string;
  readonly fixture: BenchmarkFixture;
  /** The source lineage snapshot at registration (immutable evidence). */
  readonly source: {
    readonly sourceId: string;
    readonly provider: string;
    readonly providerContentId: string | null;
    readonly canonicalUrl: string;
    readonly acquiredChecksum: string | null;
    readonly normalizedChecksum: string;
    readonly restrictions: readonly string[];
  };
  /** The derived feature bundles recorded with the registration. */
  readonly featureBundles: readonly FeatureBundleRef[];
  readonly registeredAt: number;
}

// ---------------------------------------------------------------------------
// The query API (list/lookup by source, window, feature version)
// ---------------------------------------------------------------------------

/** The corpus benchmark query filter. */
export interface BenchmarkQuery {
  /** Only registrations over this source. */
  readonly sourceId?: string;
  /** Only registrations over this canonical reference. */
  readonly canonicalUrl?: string;
  /** Only registrations whose window OVERLAPS this window (inclusive edges). */
  readonly overlappingWindow?: TimeWindow;
  /** Only registrations pinning this exact component version. */
  readonly component?: {
    readonly name: string;
    readonly version: string;
  };
}

// ---------------------------------------------------------------------------
// The registrar
// ---------------------------------------------------------------------------

export interface BenchmarkRegistrarOptions {
  /** Injected clock (default: the deterministic corpus clock). */
  readonly clock?: () => number;
}

/** The benchmark registration + query port. */
export interface BenchmarkRegistrar {
  /**
   * Registers a benchmark over a normalized source: builds the
   * content-addressed fixture from the RECORD's checksums (never caller
   * claims), binds it through `markBenchmarked`, records the requested
   * feature-bundle references. Idempotent for identical content; typed
   * refusals for reference-only / not-yet-normalized sources and for
   * conflicting re-registrations.
   */
  register(request: BenchmarkRegistrationRequest): Promise<BenchmarkRegistration>;
  /** Looks an entry up by its content address (typed not-found). */
  get(registrationId: string): Promise<BenchmarkRegistration>;
  /** Lists entries by source, canonical reference, window, component version. */
  list(query?: BenchmarkQuery): Promise<readonly BenchmarkRegistration[]>;
}

/** Creates the in-memory benchmark registrar over the corpus store. */
export function createBenchmarkRegistrar(
  store: CorpusStore,
  options: BenchmarkRegistrarOptions = {},
): BenchmarkRegistrar {
  const clock = options.clock ?? createCorpusDefaultClock();
  const entries = new Map<string, BenchmarkRegistration>();

  /** The eligibility law: benchmarks require acquired + normalized bytes. */
  function requireEligible(record: SourceRecord): void {
    if (record.restrictions.includes("reference-only")) {
      throw new CorpusBenchmarkIneligibleError(
        `source ${record.sourceId} is declared reference-only: benchmarks require acquired+normalized bytes, and a reference-only source can never produce them (a URL is a source reference, not proof of transformation rights)`,
        { sourceId: record.sourceId, restriction: "reference-only" },
      );
    }
    if (record.normalized === null) {
      throw new CorpusBenchmarkIneligibleError(
        `source ${record.sourceId} is in state ${record.state}: benchmarks require acquired+normalized bytes (normalize the source first; the corpus state machine is the authority)`,
        { sourceId: record.sourceId, state: record.state },
      );
    }
  }

  return {
    async register(request) {
      const record = await store.get(request.sourceId); // typed not-found
      requireEligible(record);
      // Fail-closed narrowing: eligibility guarantees a normalization record,
      // but the fixture is built from verified facts or not at all.
      const normalizedChecksum = record.normalized?.normalizedChecksum;
      if (normalizedChecksum === undefined) {
        throw new CorpusBenchmarkIneligibleError(
          `source ${record.sourceId} carries no normalized-byte checksum (benchmarks require acquired+normalized bytes)`,
          { sourceId: record.sourceId, state: record.state },
        );
      }
      // The fixture is built from the RECORD's checksums — the caller never
      // claims checksums; the reproducibility bar is derived from the store.
      const fixture = await createBenchmarkFixture({
        sourceRef: {
          sourceId: record.sourceId,
          provider: record.provider,
          providerContentId: record.providerContentId,
          canonicalUrl: record.canonicalUrl,
        },
        acquiredByteChecksum: record.acquiredChecksum,
        normalizedByteChecksum: normalizedChecksum,
        timeWindow: request.timeWindow,
        versions: request.versions.map((version) => ({ ...version })),
      });
      // Idempotency: identical content is the identical entry.
      const existing = entries.get(fixture.fixtureId);
      if (existing !== undefined) {
        // The store binding must still hold (defense in depth — a benchmark
        // entry whose source moved on is corruption, not a hit).
        if (record.state !== "benchmarked" || record.benchmarkedWith !== fixture.fixtureId) {
          throw new CorpusConflictError(
            `benchmark entry ${fixture.fixtureId} exists but source ${record.sourceId} no longer carries its binding (state ${record.state}, bound to ${record.benchmarkedWith ?? "nothing"})`,
            { sourceId: record.sourceId, registrationId: fixture.fixtureId },
          );
        }
        return existing;
      }
      // The binding: through the state machine (only `normalized` may bind;
      // an already-benchmarked source with a DIFFERENT fixture conflicts).
      if (record.state === "normalized") {
        await store.markBenchmarked(record.sourceId, fixture);
      } else if (record.benchmarkedWith !== fixture.fixtureId) {
        throw new CorpusConflictError(
          `source ${record.sourceId} is already benchmarked with fixture ${record.benchmarkedWith} (the binding is immutable evidence; register a new source for window ${request.timeWindow.startMs}-${request.timeWindow.endMs})`,
          {
            sourceId: record.sourceId,
            existing: record.benchmarkedWith,
            requested: fixture.fixtureId,
          },
        );
      }
      // The reusable derived feature bundles (references, never fetched).
      let updated = record;
      for (const bundle of request.featureBundles ?? []) {
        updated = await store.registerFeatureBundle(record.sourceId, bundle);
      }
      const entry: BenchmarkRegistration = deepFreeze({
        registrationId: fixture.fixtureId,
        fixture,
        source: {
          sourceId: updated.sourceId,
          provider: updated.provider,
          providerContentId: updated.providerContentId,
          canonicalUrl: updated.canonicalUrl,
          acquiredChecksum: updated.acquiredChecksum,
          normalizedChecksum: updated.normalized?.normalizedChecksum ?? "",
          restrictions: [...updated.restrictions],
        },
        featureBundles: [...updated.featureBundles],
        registeredAt: clock(),
      });
      entries.set(entry.registrationId, entry);
      return entry;
    },

    async get(registrationId) {
      const entry = entries.get(registrationId);
      if (entry === undefined) {
        throw new CorpusNotFoundError(`no benchmark registration with id ${registrationId}`, {
          registrationId,
        });
      }
      return entry;
    },

    async list(query) {
      // Deterministic registration order (the clock is monotonic; the
      // content address breaks any tie), NOT hash order — a listing that
      // jumps around by content hash would surprise every caller.
      const all = [...entries.values()].sort((a, b) => {
        if (a.registeredAt !== b.registeredAt) return a.registeredAt - b.registeredAt;
        return a.registrationId < b.registrationId
          ? -1
          : a.registrationId > b.registrationId
            ? 1
            : 0;
      });
      if (query === undefined) return all;
      return all.filter((entry) => {
        if (query.sourceId !== undefined && entry.source.sourceId !== query.sourceId) {
          return false;
        }
        if (query.canonicalUrl !== undefined && entry.source.canonicalUrl !== query.canonicalUrl) {
          return false;
        }
        if (query.overlappingWindow !== undefined) {
          const window = query.overlappingWindow;
          const overlaps =
            entry.fixture.timeWindow.startMs <= window.endMs &&
            window.startMs <= entry.fixture.timeWindow.endMs;
          if (!overlaps) return false;
        }
        if (query.component !== undefined) {
          const pins = entry.fixture.versions.some(
            (version) =>
              version.name === query.component?.name &&
              version.version === query.component?.version,
          );
          if (!pins) return false;
        }
        return true;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Deep freeze (the store precedent): entries handed out are immutable. */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}
