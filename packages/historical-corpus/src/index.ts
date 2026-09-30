/**
 * @sporta/historical-corpus — historical source records + the rights-gated
 * corpus store + content-addressed benchmark fixtures (REL-009, ADR-013).
 *
 * Source of truth: docs/contracts/historical-media-and-corpus.md (FROZEN),
 * docs/adr/ADR-013-reality-engineering-lab-and-agent-organizations.md #7
 * ("A public URL alone never proves transformation rights"),
 * docs/architecture/reality-engineering-lab.md (the Lab's historical
 * evidence seam). Module map:
 *
 * - `domain`: the record model — the acquisition states
 *   `referenced -> authorized-for-access -> acquired -> normalized ->
 *   benchmarked`, the source restrictions, the rights-basis record, the
 *   provider-neutral source metadata + discovery query, the derived
 *   feature-bundle references, the full SourceRecord (EVERY contract
 *   field), the user-upload metadata, and the normalizer port
 * - `state-machine`: the legal-edge table — typed refusal reasons for
 *   skips, backward attempts and terminal-state moves
 * - `errors`: the typed error family — the binding
 *   `corpus.rights-basis-required` plus restriction / illegal-transition /
 *   access-invalid / bytes-unavailable / fixture-mismatch codes
 * - `provider-adapter`: THE SEAM — provider-neutral discovery/reference
 *   adapters; byte retrieval only through the branded AuthorizedByteAccess
 *   token that only the store's rights gate can mint (no bypass, type
 *   level and runtime)
 * - `reference-adapter`: the v0 implementation — pure metadata discovery
 *   over INJECTED fixture metadata (tests provide the fixture store; no
 *   network, no provider SDKs in this slice)
 * - `connectors`: REL-010 — the `ConnectorAdapter` family over the
 *   ProviderAdapter seam: the user-upload connector (class 1), the
 *   authorized-feed connector (class 4, fixture feed store + the
 *   authorization hook the caller must satisfy) and the reference-only
 *   discovery connector (class 5 — metadata indexing, NO byte acquisition
 *   path at all, typed refusal)
 * - `fixtures`: content-addressed benchmark fixtures — the reproducibility
 *   contract (source ref, acquired checksum where applicable, normalized
 *   checksum, time window, feature/decoder versions)
 * - `benchmark`: REL-011 — the benchmark registrar: immutable,
 *   content-addressed, reusable registrations over normalized sources
 *   (reference-only / not-yet-normalized sources refuse typed) + the
 *   list/lookup query API (by source, window, component version)
 * - `store`: the corpus store — immutable reference-first entries, the
 *   rights gate, the user-fed upload path (bytes + declared basis), the
 *   normalization seam, the benchmark binding, reusable feature-bundle
 *   references (recorded, never fetched)
 * - `pipeline`: `acquireSourceFromAdapter` — the canonical legal order
 *   (authorize -> retrieve -> record) as one reusable driver
 * - `clock` / `hash`: the injected clock + id source (repo constitution)
 *   and the canonical-JSON + SHA-256 primitives
 *
 * THE INVARIANT (binding): a URL is a source reference, NOT proof of
 * transformation rights. Reference-only sources are indexable and usable
 * for metadata discovery without acquiring bytes, but the transition
 * `referenced -> authorized-for-access` REQUIRES an explicit rights/policy
 * basis record; without it the store refuses with the typed error
 * `corpus.rights-basis-required`. No bypass path exists: the access token
 * is branded (unforgeable outside this package), re-verified at use, and
 * the user-fed upload path pays the same basis discipline at birth.
 */
// domain
export {
  ACQUISITION_STATES,
  AVAILABILITY_STATES,
  RIGHTS_BASIS_TYPES,
  SOURCE_RESTRICTIONS,
  identityNormalizer,
} from "./domain";
export type {
  AcquisitionState,
  CanonicalSourceRef,
  DiscoveryQuery,
  FeatureBundleRef,
  FeatureBundleRefInput,
  MediaAvailability,
  NormalizationRecord,
  Normalizer,
  RightsBasis,
  RightsBasisType,
  SourceMetadata,
  SourceRecord,
  SourceRestriction,
  UserUploadMetadata,
} from "./domain";
export {
  AcquisitionStateSchema,
  DiscoveryQuerySchema,
  FeatureBundleRefSchema,
  MediaAvailabilitySchema,
  RightsBasisSchema,
  SourceMetadataSchema,
  SourceRestrictionsSchema,
  UserUploadMetadataSchema,
} from "./domain";

// state machine
export {
  ACQUISITION_EDGES,
  acquisitionEdge,
  illegalAcquisitionTransitionReason,
  isLegalAcquisitionTransition,
  isTerminalAcquisitionState,
  legalAcquisitionTargetsFrom,
} from "./state-machine";
export type { AcquisitionEdge, AcquisitionOperation } from "./state-machine";

// errors
export {
  CorpusAccessInvalidError,
  CorpusApiError,
  CorpusBenchmarkIneligibleError,
  CorpusBytesUnavailableError,
  CorpusConflictError,
  CorpusFixtureMismatchError,
  CorpusIllegalTransitionError,
  CorpusInternalError,
  CorpusNotFoundError,
  CorpusRestrictionError,
  CorpusRightsBasisRequiredError,
  CorpusValidationError,
  isCorpusError,
} from "./errors";
export type { CorpusError, CorpusFailureClass } from "./errors";

// provider adapter (THE SEAM)
export { isAuthorizedByteAccess } from "./provider-adapter";
export type { AuthorizedByteAccess, ProviderAdapter } from "./provider-adapter";

// reference adapter (v0)
export { createReferenceAdapter } from "./reference-adapter";
export type { FixtureMetadataSource, ReferenceAdapterOptions } from "./reference-adapter";

// connectors (REL-010)
export {
  CONNECTOR_BASIS_TYPES,
  CONNECTOR_SOURCE_CLASSES,
  createAuthorizedFeedConnector,
  createReferenceOnlyConnector,
  createUserUploadConnector,
} from "./connectors";
export type {
  AuthorizedFeedAcquisition,
  AuthorizedFeedConnectorOptions,
  ConnectorAcquisitionRequest,
  ConnectorAdapter,
  ConnectorCapabilities,
  ConnectorSourceClass,
  FeedAuthorizationHook,
  FeedFixtureItem,
  ReferenceOnlyAcquisition,
  ReferenceOnlyConnectorOptions,
  UserUploadAcquisition,
  UserUploadConnectorOptions,
} from "./connectors";

// fixtures
export { createBenchmarkFixture } from "./fixtures";
export type {
  BenchmarkFixture,
  BenchmarkFixtureInput,
  BenchmarkSourceRef,
  ComponentVersion,
  TimeWindow,
} from "./fixtures";
export {
  BenchmarkFixtureInputSchema,
  BenchmarkSourceRefSchema,
  ComponentVersionSchema,
  TimeWindowSchema,
} from "./fixtures";

// benchmark registration (REL-011)
export { createBenchmarkRegistrar } from "./benchmark";
export type {
  BenchmarkQuery,
  BenchmarkRegistrar,
  BenchmarkRegistrarOptions,
  BenchmarkRegistration,
  BenchmarkRegistrationRequest,
} from "./benchmark";

// store
export { createCorpusStore } from "./store";
export type { CorpusStore, CorpusStoreOptions, UserUploadInput } from "./store";

// pipeline
export { acquireSourceFromAdapter } from "./pipeline";
export type { AcquireFromAdapterOptions } from "./pipeline";

// clock + hash
export {
  CORPUS_DEFAULT_EPOCH_MS,
  createCorpusDefaultClock,
  createDefaultSourceIdSource,
  createSequentialIdSource,
  toIsoUtc,
} from "./clock";
export type { IdSource } from "./clock";
export { canonicalJson, sha256Hex, sha256HexBytes } from "./hash";
