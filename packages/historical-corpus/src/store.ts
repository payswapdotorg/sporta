/**
 * The corpus store (REL-009): immutable, reference-first entries + THE
 * RIGHTS GATE.
 *
 * Source of truth: docs/contracts/historical-media-and-corpus.md (FROZEN).
 *
 * THE INVARIANT (binding, tested explicitly): a URL is a source reference,
 * NOT proof of transformation rights. Reference-only sources can be
 * indexed and used for metadata discovery without acquiring bytes, but
 * the transition `referenced -> authorized-for-access` REQUIRES an
 * explicit rights/policy basis record; without it the store refuses with
 * the typed error `corpus.rights-basis-required` (failureClass "rights").
 * No bypass path exists:
 * - `authorizeAccess` is the ONLY minter of {@link AuthorizedByteAccess}
 *   tokens, and it mints only with a validated basis and only for sources
 *   whose restrictions do not forbid access;
 * - `recordAcquiredBytes` re-verifies the brand and the scope of the token
 *   it is shown, so forged or mis-scoped tokens are refused;
 * - `ingestUserUpload` applies the SAME law to the user-fed path — no
 *   declared basis, no record (the bytes and the basis arrive together or
 *   not at all).
 *
 * Corpus design (§Corpus design): entries are reference-first with derived
 * feature bundles; the bundles are recorded as REFERENCES, never fetched;
 * repeated simulation reuses them instead of re-fetching source media.
 * Entries are IMMUTABLE: records are deeply frozen on the way out, updates
 * are copy-on-write, and a conflicting re-write (same canonical reference,
 * different metadata digest) is a typed conflict.
 *
 * Constitution: no wall time, no randomness — clock + ids are injected
 * (src/clock.ts). In-memory this wave; the interface is the port-friendly
 * seam for the durable corpus/feature pipeline (REL-011).
 */
import type {
  AcquisitionState,
  DiscoveryQuery,
  FeatureBundleRefInput,
  Normalizer,
  RightsBasis,
  SourceMetadata,
  SourceRecord,
  UserUploadMetadata,
} from "./domain";
import {
  DiscoveryQuerySchema,
  FeatureBundleRefSchema,
  RightsBasisSchema,
  SourceMetadataSchema,
  UserUploadMetadataSchema,
  identityNormalizer,
} from "./domain";
import { createDefaultSourceIdSource, createCorpusDefaultClock } from "./clock";
import type { IdSource } from "./clock";
import { canonicalJson, sha256Hex, sha256HexBytes } from "./hash";
import {
  CorpusAccessInvalidError,
  CorpusConflictError,
  CorpusFixtureMismatchError,
  CorpusIllegalTransitionError,
  CorpusNotFoundError,
  CorpusRestrictionError,
  CorpusRightsBasisRequiredError,
  CorpusValidationError,
} from "./errors";
import {
  acquisitionEdge,
  illegalAcquisitionTransitionReason,
  isLegalAcquisitionTransition,
} from "./state-machine";
import type { AuthorizedByteAccess } from "./provider-adapter";
import { isAuthorizedByteAccess, mintAuthorizedByteAccess } from "./provider-adapter";
import type { BenchmarkFixture } from "./fixtures";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CorpusStoreOptions {
  /** Injected clock (default: the deterministic corpus clock). */
  readonly clock?: () => number;
  /** Injected source-id source (default: `source-1`, `source-2`, ...). */
  readonly idSource?: IdSource;
}

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

/** The user-fed upload input: bytes + the declared rights/policy basis. */
export interface UserUploadInput {
  /** The uploaded bytes (test fixtures in this slice). */
  readonly bytes: Uint8Array;
  /**
   * The declared rights/policy basis — REQUIRED. Absent or malformed, the
   * store refuses with `corpus.rights-basis-required`: the user-fed path
   * and the provider path share one law.
   */
  readonly declaredBasis?: RightsBasis;
  /** The declared metadata attached to the upload. */
  readonly metadata: UserUploadMetadata;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** The corpus store port. */
export interface CorpusStore {
  /** Registers a discovered reference (state `referenced`; metadata only, never bytes). */
  registerReference(metadata: SourceMetadata): Promise<SourceRecord>;
  /** Looks a record up by source id (typed not-found). */
  get(sourceId: string): Promise<SourceRecord>;
  /** Looks a record up by canonical reference, or null. */
  getByCanonicalUrl(canonicalUrl: string): Promise<SourceRecord | null>;
  /** Lists records, optionally filtered by state and/or provider. */
  list(filter?: {
    readonly state?: AcquisitionState;
    readonly provider?: string;
  }): Promise<readonly SourceRecord[]>;
  /** Metadata discovery over REGISTERED records (reference-only sources included). */
  searchMetadata(query: DiscoveryQuery): Promise<readonly SourceRecord[]>;
  /**
   * THE GATE: authorizes byte access for a `referenced` source. Requires
   * an explicit rights/policy basis record; refuses with
   * `corpus.rights-basis-required` without one, and refuses sources whose
   * restrictions forbid access. Returns the branded access token.
   */
  authorizeAccess(sourceId: string, basis?: RightsBasis): Promise<AuthorizedByteAccess>;
  /**
   * Records acquired bytes against an `authorized-for-access` source. The
   * token is re-verified (brand + scope); the acquired checksum is computed
   * from the bytes actually handed over.
   */
  recordAcquiredBytes(
    sourceId: string,
    access: AuthorizedByteAccess,
    bytes: Uint8Array,
    options?: { readonly acquisitionMethod?: string },
  ): Promise<SourceRecord>;
  /**
   * The user-fed upload path (contract §User-fed historical matches):
   * bytes + declared basis arrive together from the owner, so the record
   * is BORN in `acquired` — no transition is traversed. The declared basis
   * is REQUIRED under the same typed refusal.
   */
  ingestUserUpload(upload: UserUploadInput): Promise<SourceRecord>;
  /**
   * Normalizes an `acquired` source through the injected normalizer
   * (default: the honest identity pipeline). Refuses sources restricted
   * `no-transformation`. Records the normalized-byte checksum.
   */
  normalizeSource(
    sourceId: string,
    options?: { readonly normalizer?: Normalizer },
  ): Promise<SourceRecord>;
  /**
   * Binds a content-addressed benchmark fixture to a `normalized` source
   * (state `benchmarked`). The fixture's checksums must MATCH the record's
   * — the reproducibility bar is verified, not assumed.
   */
  markBenchmarked(sourceId: string, fixture: BenchmarkFixture): Promise<SourceRecord>;
  /**
   * Registers a derived feature bundle REFERENCE against a source (any
   * state — metadata-derived bundles exist for reference-only sources too).
   * Idempotent for identical bundles; a conflicting re-registration of the
   * same bundleId is a typed conflict. Never fetches anything.
   */
  registerFeatureBundle(sourceId: string, bundle: FeatureBundleRefInput): Promise<SourceRecord>;
  /** Reads the retained bytes (test fixtures in this slice) for the pipeline. */
  getBytes(sourceId: string, which: "acquired" | "normalized"): Promise<Uint8Array>;
}

/** Creates the in-memory corpus store. */
export function createCorpusStore(options: CorpusStoreOptions = {}): CorpusStore {
  const clock = options.clock ?? createCorpusDefaultClock();
  const idSource = options.idSource ?? createDefaultSourceIdSource();
  const records = new Map<string, SourceRecord>();
  const byCanonicalUrl = new Map<string, string>();
  const acquiredBytes = new Map<string, Uint8Array>();
  const normalizedBytes = new Map<string, Uint8Array>();

  // -- helpers --------------------------------------------------------------

  function mustGet(sourceId: string): SourceRecord {
    const record = records.get(sourceId);
    if (record === undefined) {
      throw new CorpusNotFoundError(`no corpus source with id ${sourceId}`, { sourceId });
    }
    return record;
  }

  /**
   * The transition law: legal edges only, typed refusal with the
   * machine-auditable reason. Every state advance goes through here.
   */
  function advance(record: SourceRecord, to: AcquisitionState): SourceRecord {
    if (!isLegalAcquisitionTransition(record.state, to)) {
      const reason = illegalAcquisitionTransitionReason(record.state, to);
      throw new CorpusIllegalTransitionError(
        `refusing ${record.state} -> ${to} for source ${record.sourceId}: ${reason}`,
        { from: record.state, to, reason: reason ?? "unknown" },
      );
    }
    const edge = acquisitionEdge(record.state, to);
    if (edge === null) {
      // Unreachable (legality was just checked) — fail closed regardless.
      throw new CorpusIllegalTransitionError(
        `refusing ${record.state} -> ${to} for source ${record.sourceId}: no legal edge`,
        { from: record.state, to, reason: "no legal edge" },
      );
    }
    const next: SourceRecord = { ...record, state: to, updatedAt: clock() };
    records.set(record.sourceId, deepFreeze(next));
    return next;
  }

  function validateMetadata(metadata: SourceMetadata): SourceMetadata {
    const parsed = SourceMetadataSchema.safeParse(metadata);
    if (!parsed.success) {
      throw new CorpusValidationError(
        "the source metadata violates the contract shape",
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  async function metadataDigestOf(metadata: SourceMetadata): Promise<string> {
    return sha256Hex(canonicalJson(metadata));
  }

  function parseBasis(basis: RightsBasis | undefined): RightsBasis {
    const parsed = RightsBasisSchema.safeParse(basis);
    if (!parsed.success) {
      throw new CorpusRightsBasisRequiredError(
        "a URL is a source reference, not proof of transformation rights: an explicit rights/policy basis record is required to authorize access (and the presented one is absent or malformed)",
        { issues: parsed.success ? [] : parsed.error.issues },
      );
    }
    return parsed.data;
  }

  // -- the store ------------------------------------------------------------

  const store: CorpusStore = {
    async registerReference(metadata) {
      const clean = validateMetadata(metadata);
      const digest = await metadataDigestOf(clean);
      const existingId = byCanonicalUrl.get(clean.canonicalUrl);
      if (existingId !== undefined) {
        const existing = mustGet(existingId);
        if (existing.metadataDigest === digest) {
          return existing; // idempotent re-registration of the same reference
        }
        throw new CorpusConflictError(
          `canonical reference ${clean.canonicalUrl} is already registered with different metadata (corpus entries are immutable)`,
          {
            canonicalUrl: clean.canonicalUrl,
            existingDigest: existing.metadataDigest,
            newDigest: digest,
          },
        );
      }
      const now = clock();
      const record: SourceRecord = deepFreeze({
        sourceId: idSource.nextId(),
        provider: clean.provider,
        providerContentId: clean.providerContentId,
        canonicalUrl: clean.canonicalUrl,
        ownerRef: clean.ownerRef,
        observedAt: clean.observedAt,
        acquiredAt: null,
        rightsBasis: null,
        acquisitionMethod: null,
        availability: clean.availability,
        acquiredChecksum: null,
        metadataDigest: digest,
        featureBundles: [],
        restrictions: [...clean.restrictions],
        state: "referenced",
        normalized: null,
        benchmarkedWith: null,
        createdAt: now,
        updatedAt: now,
      });
      records.set(record.sourceId, record);
      byCanonicalUrl.set(record.canonicalUrl, record.sourceId);
      return record;
    },

    async get(sourceId) {
      return mustGet(sourceId);
    },

    async getByCanonicalUrl(canonicalUrl) {
      const id = byCanonicalUrl.get(canonicalUrl);
      return id === undefined ? null : mustGet(id);
    },

    async list(filter) {
      return [...records.values()]
        .filter((record) => {
          if (filter?.state !== undefined && record.state !== filter.state) return false;
          if (filter?.provider !== undefined && record.provider !== filter.provider) return false;
          return true;
        })
        .sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
    },

    async searchMetadata(query) {
      const parsed = DiscoveryQuerySchema.safeParse(query);
      if (!parsed.success) {
        throw new CorpusValidationError(
          "the discovery query violates the contract shape",
          parsed.error.issues,
        );
      }
      const clean = parsed.data;
      const limit = clean.limit ?? 50;
      const needle = clean.text?.toLowerCase() ?? null;
      return store
        .list()
        .then((all) =>
          all.filter((record) => {
            if (clean.provider !== undefined && record.provider !== clean.provider) return false;
            if (
              clean.providerContentId !== undefined &&
              record.providerContentId !== clean.providerContentId
            ) {
              return false;
            }
            if (clean.canonicalUrl !== undefined && record.canonicalUrl !== clean.canonicalUrl) {
              return false;
            }
            if (needle !== null) {
              const registered = registeredDisplayText(record);
              if (!registered.includes(needle)) return false;
            }
            return true;
          }),
        )
        .then((hits) => hits.slice(0, limit));
    },

    async authorizeAccess(sourceId, basis) {
      const record = mustGet(sourceId);
      // THE INVARIANT, part 1: no explicit rights/policy basis record ->
      // typed refusal, fail-closed, state untouched.
      const cleanBasis = parseBasis(basis);
      // THE INVARIANT, part 2: the source's own declared restrictions are
      // law — a basis cannot lift them.
      if (record.restrictions.includes("reference-only")) {
        throw new CorpusRestrictionError(
          `source ${sourceId} is declared reference-only: byte access can never be authorized (the canonical URL is a reference, full stop)`,
          { sourceId, restriction: "reference-only", operation: "authorize-access" },
        );
      }
      if (record.state !== "referenced") {
        const reason = illegalAcquisitionTransitionReason(record.state, "authorized-for-access");
        throw new CorpusIllegalTransitionError(
          `refusing ${record.state} -> authorized-for-access for source ${sourceId}: ${reason}`,
          { from: record.state, to: "authorized-for-access", reason: reason ?? "unknown" },
        );
      }
      const basisDigest = await sha256Hex(canonicalJson(cleanBasis));
      const withBasis: SourceRecord = deepFreeze({
        ...record,
        rightsBasis: cleanBasis,
      });
      advance(withBasis, "authorized-for-access");
      return mintAuthorizedByteAccess({
        sourceId,
        provider: withBasis.provider,
        providerContentId: withBasis.providerContentId,
        canonicalUrl: withBasis.canonicalUrl,
        basisDigest,
        grantedAt: clock(),
      });
    },

    async recordAcquiredBytes(sourceId, access, bytes, options) {
      const record = mustGet(sourceId);
      // THE INVARIANT, part 3: the token must be a real store-minted grant
      // for THIS source — brand + scope re-verified.
      if (!isAuthorizedByteAccess(access)) {
        throw new CorpusAccessInvalidError(
          "the presented byte-access token was not minted by the corpus rights gate",
          { sourceId },
        );
      }
      if (access.sourceId !== sourceId) {
        throw new CorpusAccessInvalidError(
          "the byte-access token is scoped to a different source than the one bytes are recorded against",
          { sourceId, tokenSourceId: access.sourceId },
        );
      }
      const checksum = await sha256HexBytes(bytes);
      const advanced = advance(record, "acquired");
      const updated: SourceRecord = deepFreeze({
        ...advanced,
        acquiredChecksum: checksum,
        acquiredAt: clock(),
        acquisitionMethod: options?.acquisitionMethod ?? "authorized-acquisition",
        updatedAt: clock(),
      });
      records.set(sourceId, updated);
      acquiredBytes.set(sourceId, bytes);
      return updated;
    },

    async ingestUserUpload(upload) {
      const parsed = UserUploadMetadataSchema.safeParse(upload.metadata);
      if (!parsed.success) {
        throw new CorpusValidationError(
          "the user-upload metadata violates the contract shape",
          parsed.error.issues,
        );
      }
      const metadata = parsed.data;
      // THE INVARIANT, part 4: the user-fed path shares the one law — no
      // declared basis, no record, and the refusal is the SAME typed error.
      const cleanBasis = parseBasis(upload.declaredBasis);
      const checksum = await sha256HexBytes(upload.bytes);
      const canonicalUrl = `corpus://user-upload/${checksum}`;
      const digest = await metadataDigestOf({
        provider: "user-upload",
        providerContentId: null,
        canonicalUrl,
        ownerRef: metadata.ownerRef,
        observedAt: metadata.observedAt,
        availability: "user-held",
        restrictions: metadata.restrictions,
        title: metadata.title,
        description: metadata.description,
      });
      const existingId = byCanonicalUrl.get(canonicalUrl);
      if (existingId !== undefined) {
        const existing = mustGet(existingId);
        if (existing.metadataDigest === digest) {
          return existing; // idempotent re-ingestion of identical bytes + metadata
        }
        throw new CorpusConflictError(
          "identical bytes were already ingested with different declared metadata (corpus entries are immutable)",
          { canonicalUrl, existingDigest: existing.metadataDigest, newDigest: digest },
        );
      }
      const now = clock();
      const record: SourceRecord = deepFreeze({
        sourceId: idSource.nextId(),
        provider: "user-upload",
        providerContentId: null,
        canonicalUrl,
        ownerRef: metadata.ownerRef,
        observedAt: metadata.observedAt,
        acquiredAt: now,
        rightsBasis: cleanBasis,
        acquisitionMethod: "user-upload:v0",
        availability: "user-held",
        acquiredChecksum: checksum,
        metadataDigest: digest,
        featureBundles: [],
        restrictions: [...metadata.restrictions],
        // Born acquired: the bytes and the declared basis arrived together
        // from the owner — no transition is traversed (the machine governs
        // transitions of EXISTING records). The rights discipline is the
        // same one the provider path pays at the gate.
        state: "acquired",
        normalized: null,
        benchmarkedWith: null,
        createdAt: now,
        updatedAt: now,
      });
      records.set(record.sourceId, record);
      byCanonicalUrl.set(record.canonicalUrl, record.sourceId);
      acquiredBytes.set(record.sourceId, upload.bytes);
      return record;
    },

    async normalizeSource(sourceId, options) {
      const record = mustGet(sourceId);
      // The state machine is the outermost law: only `acquired` may
      // normalize — a referenced/authorized source refuses as an illegal
      // jump, never as a missing-bytes situation.
      if (record.state !== "acquired") {
        const reason = illegalAcquisitionTransitionReason(record.state, "normalized");
        throw new CorpusIllegalTransitionError(
          `refusing ${record.state} -> normalized for source ${sourceId}: ${reason}`,
          { from: record.state, to: "normalized", reason: reason ?? "unknown" },
        );
      }
      if (record.restrictions.includes("no-transformation")) {
        throw new CorpusRestrictionError(
          `source ${sourceId} is restricted no-transformation: normalization is a transformation and is refused (access and transformation are separate rights)`,
          { sourceId, restriction: "no-transformation", operation: "normalize" },
        );
      }
      const normalizer = options?.normalizer ?? identityNormalizer;
      const bytes = acquiredBytes.get(sourceId);
      if (bytes === undefined) {
        throw new CorpusNotFoundError(
          `no acquired bytes retained for source ${sourceId} (cannot normalize what was never acquired)`,
          { sourceId },
        );
      }
      const acquiredChecksum = record.acquiredChecksum;
      if (acquiredChecksum === null) {
        throw new CorpusNotFoundError(
          `source ${sourceId} carries no acquired checksum (cannot normalize)`,
          { sourceId },
        );
      }
      const result = normalizer.normalize(bytes, { acquiredChecksum });
      const normalizedChecksum = await sha256HexBytes(result.bytes);
      const advanced = advance(record, "normalized");
      const updated: SourceRecord = deepFreeze({
        ...advanced,
        normalized: {
          normalizedChecksum,
          pipeline: result.pipeline,
          pipelineVersion: result.pipelineVersion,
          at: clock(),
        },
        updatedAt: clock(),
      });
      records.set(sourceId, updated);
      normalizedBytes.set(sourceId, result.bytes);
      return updated;
    },

    async markBenchmarked(sourceId, fixture) {
      const record = mustGet(sourceId);
      // The state machine first: only `normalized` may be benchmarked —
      // an earlier state refuses as an illegal jump before any fixture
      // comparison runs.
      if (record.state !== "normalized") {
        const reason = illegalAcquisitionTransitionReason(record.state, "benchmarked");
        throw new CorpusIllegalTransitionError(
          `refusing ${record.state} -> benchmarked for source ${sourceId}: ${reason}`,
          { from: record.state, to: "benchmarked", reason: reason ?? "unknown" },
        );
      }
      // The reproducibility bar is verified, not assumed: the fixture must
      // be FOR this source and its checksums must MATCH the record.
      if (fixture.sourceRef.canonicalUrl !== record.canonicalUrl) {
        throw new CorpusFixtureMismatchError(
          `the fixture's source reference (${fixture.sourceRef.canonicalUrl}) is not this source (${record.canonicalUrl})`,
          { sourceId, fixtureId: fixture.fixtureId },
        );
      }
      if (
        fixture.acquiredByteChecksum !== null &&
        fixture.acquiredByteChecksum !== record.acquiredChecksum
      ) {
        throw new CorpusFixtureMismatchError(
          `the fixture's acquired-byte checksum does not match source ${sourceId}`,
          {
            sourceId,
            fixtureId: fixture.fixtureId,
            fixtureChecksum: fixture.acquiredByteChecksum,
            recordChecksum: record.acquiredChecksum,
          },
        );
      }
      if (
        record.normalized === null ||
        fixture.normalizedByteChecksum !== record.normalized.normalizedChecksum
      ) {
        throw new CorpusFixtureMismatchError(
          `the fixture's normalized-byte checksum does not match source ${sourceId}`,
          {
            sourceId,
            fixtureId: fixture.fixtureId,
            fixtureChecksum: fixture.normalizedByteChecksum,
            recordChecksum: record.normalized?.normalizedChecksum ?? null,
          },
        );
      }
      const advanced = advance(record, "benchmarked");
      const updated: SourceRecord = deepFreeze({
        ...advanced,
        benchmarkedWith: fixture.fixtureId,
        updatedAt: clock(),
      });
      records.set(sourceId, updated);
      return updated;
    },

    async registerFeatureBundle(sourceId, bundle) {
      const record = mustGet(sourceId);
      const parsed = FeatureBundleRefSchema.safeParse(bundle);
      if (!parsed.success) {
        throw new CorpusValidationError(
          "the feature bundle reference violates the contract shape",
          parsed.error.issues,
        );
      }
      const clean = parsed.data;
      const existing = record.featureBundles.find(
        (candidate) => candidate.bundleId === clean.bundleId,
      );
      if (existing !== undefined) {
        if (
          existing.kind === clean.kind &&
          existing.producer === clean.producer &&
          existing.producerVersion === clean.producerVersion &&
          existing.artifactRef === clean.artifactRef
        ) {
          return record; // idempotent registration of the same reference
        }
        throw new CorpusConflictError(
          `feature bundle ${clean.bundleId} is already registered differently for source ${sourceId} (entries are immutable)`,
          { sourceId, bundleId: clean.bundleId },
        );
      }
      const updated: SourceRecord = deepFreeze({
        ...record,
        // Recorded as a REFERENCE, never fetched: the artifactRef is data.
        featureBundles: [
          ...record.featureBundles,
          {
            ...clean,
            registeredAt: clock(),
          },
        ],
        updatedAt: clock(),
      });
      records.set(sourceId, updated);
      return updated;
    },

    async getBytes(sourceId, which) {
      mustGet(sourceId);
      const bytes =
        which === "acquired" ? acquiredBytes.get(sourceId) : normalizedBytes.get(sourceId);
      if (bytes === undefined) {
        throw new CorpusNotFoundError(`no ${which} bytes retained for source ${sourceId}`, {
          sourceId,
          which,
        });
      }
      return bytes;
    },
  };

  return store;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Display text of a registered record for metadata search. */
function registeredDisplayText(record: SourceRecord): string {
  // Registered references keep their display metadata in the digest
  // preimage; for search purposes the provider + canonicalUrl + bundle
  // kinds are the honest searchable surface.
  const bundles = record.featureBundles.map((bundle) => bundle.kind).join("\n");
  return `${record.provider}\n${record.canonicalUrl}\n${bundles}`.toLowerCase();
}

/**
 * Deep freeze (the organization-registry precedent): records handed out are
 * immutable — arrays, nested objects, the whole tree.
 */
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
