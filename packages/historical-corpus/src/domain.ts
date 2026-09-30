/**
 * The historical-corpus domain model (REL-009, ADR-013).
 *
 * Source of truth:
 * - docs/contracts/historical-media-and-corpus.md (FROZEN) — the source
 *   record field list, the source classes, the acquisition states, the
 *   corpus design ("reference-first with derived feature bundles") and the
 *   reproducibility contract ("Every benchmark fixture is content-addressed
 *   by: source identifier/reference; acquired-byte checksum where
 *   applicable; normalized-byte checksum; time window; feature/decoder
 *   versions").
 * - docs/adr/ADR-013-reality-engineering-lab-and-agent-organizations.md #7:
 *   "Historical media can enter through user upload, permitted
 *   provider/source connectors, authorized feeds, or reference-only URLs.
 *   A public URL alone never proves transformation rights."
 * - docs/architecture/reality-engineering-lab.md — the Lab consumes
 *   historical evidence through this seam.
 *
 * Everything here is DATA, not policy: records carry what was observed and
 * declared; the store (src/store.ts) enforces the acquisition state machine
 * and the rights gate. The zod schemas are SHAPE validation only.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Acquisition states (the frozen vocabulary)
// ---------------------------------------------------------------------------

/**
 * The acquisition state machine of a source record
 * (docs/contracts/historical-media-and-corpus.md §Acquisition states):
 *
 * ```
 * referenced -> authorized-for-access -> acquired -> normalized -> benchmarked
 * ```
 *
 * `referenced` means: a canonical reference is known and indexed — a URL is
 * a source reference, NOT proof of transformation rights. Byte acquisition
 * is only reachable through `authorized-for-access`, which only the store's
 * rights gate can grant (see src/store.ts).
 */
export const ACQUISITION_STATES = [
  "referenced",
  "authorized-for-access",
  "acquired",
  "normalized",
  "benchmarked",
] as const;

export type AcquisitionState = (typeof ACQUISITION_STATES)[number];

/** Zod schema for {@link AcquisitionState}. */
export const AcquisitionStateSchema = z.enum(ACQUISITION_STATES);

// ---------------------------------------------------------------------------
// Media availability (the provider-side fact about the bytes)
// ---------------------------------------------------------------------------

/**
 * The media availability state of a source. `withdrawn`/`deleted` describe
 * provider-side removal of the content; the adapter refuses bytes for
 * them. This slice RECORDS availability; enforcement of withdrawn/deleted
 * lives in the provider adapters (REL-010).
 */
export const AVAILABILITY_STATES = [
  "unknown",
  "user-held",
  "publicly-listed",
  "restricted",
  "geoblocked",
  "withdrawn",
  "deleted",
] as const;

export type MediaAvailability = (typeof AVAILABILITY_STATES)[number];

/** Zod schema for {@link MediaAvailability}. */
export const MediaAvailabilitySchema = z.enum(AVAILABILITY_STATES);

// ---------------------------------------------------------------------------
// Source restrictions (the declared restriction vocabulary)
// ---------------------------------------------------------------------------

/**
 * The closed restriction vocabulary a source may declare. Enforcement in
 * this slice (fail-closed, in src/store.ts):
 * - `reference-only` — byte access can NEVER be authorized (the URL is a
 *   reference, full stop);
 * - `no-transformation` — bytes may be acquired but never normalized
 *   (transformation is a separate right from access).
 *
 * The remaining entries are recorded declarations; REL-010 (permitted
 * provider adapters) and REL-011 (corpus/feature pipeline) extend
 * enforcement. A restriction outside this vocabulary is a caller error.
 */
export const SOURCE_RESTRICTIONS = [
  "reference-only",
  "no-transformation",
  "private",
  "rights-reserved",
  "tos-restricted",
] as const;

export type SourceRestriction = (typeof SOURCE_RESTRICTIONS)[number];

/** Zod schema for a restriction list (declared on discovery/registration). */
export const SourceRestrictionsSchema = z.array(z.enum(SOURCE_RESTRICTIONS));

// ---------------------------------------------------------------------------
// The rights/policy basis (THE gate record)
// ---------------------------------------------------------------------------

/**
 * How the basis maps to the contract's source classes
 * (docs/contracts/historical-media-and-corpus.md §Source classes):
 * 1. user-fed uploads -> `user-declared-ownership`;
 * 2. user-authorized account/provider connectors -> `user-authorized-connector`;
 * 3. permitted public/source provider adapters -> `provider-permitted-terms`;
 * 4. authorized live/tracking/statistical feeds -> `authorized-feed`;
 * 5. reference-only URLs -> NO basis type grants acquisition — that is the
 *    point of class 5.
 */
export const RIGHTS_BASIS_TYPES = [
  "user-declared-ownership",
  "user-authorized-connector",
  "provider-permitted-terms",
  "authorized-feed",
  "other-recorded-basis",
] as const;

export type RightsBasisType = (typeof RIGHTS_BASIS_TYPES)[number];

/**
 * The explicit rights/policy basis record. THE INVARIANT
 * (docs/contracts/historical-media-and-corpus.md: "A URL is a source
 * reference, not proof of transformation rights"): the transition
 * `referenced -> authorized-for-access` REQUIRES one of these — without it
 * the store refuses with the typed error `corpus.rights-basis-required`.
 * No bypass path exists (see src/store.ts and the branded access token in
 * src/provider-adapter.ts).
 */
export const RightsBasisSchema = z.object({
  /** Which source class the basis belongs to (the frozen vocabulary). */
  basisType: z.enum(RIGHTS_BASIS_TYPES),
  /**
   * The explicit grant/declaration reference — a license id, a declaration
   * receipt, a connector grant id, a feed agreement id. Non-empty: a basis
   * without a recorded reference is not a basis.
   */
  grantRef: z.string().min(1),
  /** What the basis permits (free text scope, e.g. "acquisition for private analysis"). */
  scope: z.string().min(1),
  /** Who declared the basis (account id, connector id, system actor). */
  declaredBy: z.string().min(1),
});

export type RightsBasis = z.infer<typeof RightsBasisSchema>;

// ---------------------------------------------------------------------------
// Source metadata (the discovery shape — provider-neutral)
// ---------------------------------------------------------------------------

/**
 * What a provider adapter may discover about a source WITHOUT touching
 * bytes: metadata only, always. This is also the registration input for
 * `registerReference`.
 */
export const SourceMetadataSchema = z.object({
  /** The provider identity, e.g. "youtube", "internal", "user-upload". */
  provider: z.string().min(1),
  /** The provider's own content id when available. */
  providerContentId: z.string().min(1).nullable(),
  /** The canonical reference for the source (a URL for web providers). */
  canonicalUrl: z.string().min(1),
  /** The owner/creator reference when available. */
  ownerRef: z.string().min(1).nullable(),
  /** The observed/publication time (epoch ms) when available. */
  observedAt: z.number().int().nonnegative().nullable(),
  /** The media availability state. */
  availability: MediaAvailabilitySchema,
  /** The declared restrictions. */
  restrictions: SourceRestrictionsSchema,
  /** Free-form display metadata (indexed for discovery). */
  title: z.string().nullable(),
  description: z.string().nullable(),
});

export type SourceMetadata = z.infer<typeof SourceMetadataSchema>;

/** Zod schema for a metadata discovery query (the adapter search seam). */
export const DiscoveryQuerySchema = z.object({
  /** Free-text search over title/description (case-insensitive substring). */
  text: z.string().optional(),
  /** Filter by provider. */
  provider: z.string().min(1).optional(),
  /** Filter by provider content id. */
  providerContentId: z.string().min(1).optional(),
  /** Exact canonical URL lookup. */
  canonicalUrl: z.string().min(1).optional(),
  /** Maximum number of results (default 50). */
  limit: z.number().int().positive().optional(),
});

export type DiscoveryQuery = z.infer<typeof DiscoveryQuerySchema>;

// ---------------------------------------------------------------------------
// The canonical reference (what adapters retain — never bytes)
// ---------------------------------------------------------------------------

/**
 * The canonical reference a provider adapter retains for a discovered
 * source: identity + declared facts, no bytes, no display fluff.
 */
export interface CanonicalSourceRef {
  readonly provider: string;
  readonly providerContentId: string | null;
  readonly canonicalUrl: string;
  readonly ownerRef: string | null;
  readonly availability: MediaAvailability;
  readonly restrictions: readonly SourceRestriction[];
}

// ---------------------------------------------------------------------------
// Derived feature bundles (recorded as references, never fetched)
// ---------------------------------------------------------------------------

/**
 * A derived feature bundle registered against a source. The corpus design
 * (docs/contracts/historical-media-and-corpus.md §Corpus design): "Corpus
 * entries are reference-first with derived feature bundles. Repeated
 * simulation should reuse durable derived features rather than repeatedly
 * fetching source media." The `artifactRef` is a REFERENCE (e.g. a
 * content-addressed store URI) — this package records it, it never
 * fetches it.
 */
export const FeatureBundleRefSchema = z.object({
  /** The bundle's own id (unique per source). */
  bundleId: z.string().min(1),
  /** What kind of features this bundle carries (e.g. "optical-flow-vectors"). */
  kind: z.string().min(1),
  /** Which producer created it (e.g. "feature-pipeline"). */
  producer: z.string().min(1),
  /** The producer's version. */
  producerVersion: z.string().min(1),
  /** The reference to the durable artifacts (never fetched here). */
  artifactRef: z.string().min(1),
});

export type FeatureBundleRefInput = z.infer<typeof FeatureBundleRefSchema>;

/** The stored bundle reference (the input plus the registration time). */
export interface FeatureBundleRef {
  readonly bundleId: string;
  readonly kind: string;
  readonly producer: string;
  readonly producerVersion: string;
  readonly artifactRef: string;
  readonly registeredAt: number;
}

// ---------------------------------------------------------------------------
// The source record (EVERY contract field)
// ---------------------------------------------------------------------------

/** The recorded normalization of an acquired source. */
export interface NormalizationRecord {
  /** SHA-256 hex of the normalized bytes. */
  readonly normalizedChecksum: string;
  /** The normalization pipeline identity, e.g. "identity". */
  readonly pipeline: string;
  /** The pipeline version, e.g. "0". */
  readonly pipelineVersion: string;
  /** When the normalization ran (epoch ms). */
  readonly at: number;
}

/**
 * The source record — every field of
 * docs/contracts/historical-media-and-corpus.md §Source record:
 * sourceId; provider; providerContentId when available; canonical URL;
 * owner/creator reference when available; observed/publication time;
 * acquisition time; rights/policy basis; acquisition method/version;
 * media availability state; checksum for acquired bytes; metadata digest;
 * feature bundle/version; source restrictions — plus the acquisition
 * state, the normalization record and the benchmark fixture binding.
 *
 * Entries are IMMUTABLE: fields are filled at most once; the store hands
 * out deeply frozen records and refuses conflicting re-writes.
 */
export interface SourceRecord {
  /** The corpus-side id (minted by the store's id source). */
  readonly sourceId: string;
  /** The provider identity. */
  readonly provider: string;
  /** The provider's own content id when available, else null. */
  readonly providerContentId: string | null;
  /** The canonical reference (URL or the store-minted content address for user uploads). */
  readonly canonicalUrl: string;
  /** The owner/creator reference when available, else null. */
  readonly ownerRef: string | null;
  /** The observed/publication time (epoch ms) when available, else null. */
  readonly observedAt: number | null;
  /** The acquisition time (epoch ms) — null until the `acquired` state. */
  readonly acquiredAt: number | null;
  /** The rights/policy basis — THE gate field; null until authorized/user-declared. */
  readonly rightsBasis: RightsBasis | null;
  /** The acquisition method/version (e.g. "reference-adapter:v0", "user-upload:v0"). */
  readonly acquisitionMethod: string | null;
  /** The media availability state. */
  readonly availability: MediaAvailability;
  /** SHA-256 hex of the acquired bytes — null until `acquired`. */
  readonly acquiredChecksum: string | null;
  /** SHA-256 hex of the canonical metadata serialization (the digest of record-ness). */
  readonly metadataDigest: string;
  /** The derived feature bundle references (reusable, never fetched). */
  readonly featureBundles: readonly FeatureBundleRef[];
  /** The declared restrictions. */
  readonly restrictions: readonly SourceRestriction[];
  /** The acquisition state. */
  readonly state: AcquisitionState;
  /** The normalization record — null until `normalized`. */
  readonly normalized: NormalizationRecord | null;
  /** The content-addressed benchmark fixture id bound at `benchmarked`, else null. */
  readonly benchmarkedWith: string | null;
  /** When the record was created (epoch ms). */
  readonly createdAt: number;
  /** When the record was last advanced (epoch ms). */
  readonly updatedAt: number;
}

// ---------------------------------------------------------------------------
// The user-fed upload path (contract §User-fed historical matches)
// ---------------------------------------------------------------------------

/**
 * The declared metadata a user attaches to a direct upload. The same
 * normalization, provenance, SWM and evaluation pipeline is used as for
 * provider-acquired sources — the upload path only differs in HOW the
 * bytes and the declared basis arrive (together, from the owner).
 */
export const UserUploadMetadataSchema = z.object({
  ownerRef: z.string().min(1).nullable(),
  observedAt: z.number().int().nonnegative().nullable(),
  restrictions: SourceRestrictionsSchema,
  title: z.string().nullable(),
  description: z.string().nullable(),
});

export type UserUploadMetadata = z.infer<typeof UserUploadMetadataSchema>;

// ---------------------------------------------------------------------------
// The normalizer port (the normalization seam)
// ---------------------------------------------------------------------------

/**
 * The normalization seam: maps acquired bytes to normalized bytes and
 * names the pipeline that did it. The default is the honest identity
 * normalizer (pipeline "identity", version "0") — real media normalization
 * (the existing media-platform toolchain) plugs in behind this port; the
 * corpus only records the checksums and the pipeline identity.
 */
export interface Normalizer {
  normalize(
    bytes: Uint8Array,
    context: { readonly acquiredChecksum: string },
  ): { readonly bytes: Uint8Array; readonly pipeline: string; readonly pipelineVersion: string };
}

/** The identity normalizer: bytes pass through, recorded as pipeline "identity" v0. */
export const identityNormalizer: Normalizer = {
  normalize(bytes) {
    return { bytes, pipeline: "identity", pipelineVersion: "0" };
  },
};
