/**
 * Source connectors (REL-010) — `ConnectorAdapter` v0 implementations OVER
 * the provider-neutral `ProviderAdapter` seam (src/provider-adapter.ts).
 *
 * Source of truth: docs/contracts/historical-media-and-corpus.md §Source
 * classes (FROZEN) and ADR-013 #7 ("Historical media can enter through user
 * upload, permitted provider/source connectors, authorized feeds, or
 * reference-only URLs. A public URL alone never proves transformation
 * rights."). The three v0 connectors serve contract source classes 1, 4 and
 * 5 (classes 2/3 — user-authorized and permitted provider connectors — ride
 * the REL-009 `ProviderAdapter` + `acquireSourceFromAdapter` path directly):
 *
 * - `createUserUploadConnector` (class 1, user-fed uploads): bytes + the
 *   DECLARED basis arrive together from the owner -> the store's
 *   `ingestUserUpload` path (born `acquired`). No declared basis -> the
 *   store's own typed `corpus.rights-basis-required` refusal surfaces
 *   unchanged: the connector never improvises a basis.
 * - `createAuthorizedFeedConnector` (class 4, authorized live/tracking/
 *   statistical feeds): a FIXTURE feed metadata store + an AUTHORIZATION
 *   HOOK the caller must satisfy. Acquisition routes through the full v0
 *   state machine in the canonical order (registerReference ->
 *   authorizeAccess -> adapter.retrieveBytes -> recordAcquiredBytes via
 *   `acquireSourceFromAdapter`); the hook's basis must be an
 *   `authorized-feed` basis (the contract's own class -> type mapping) and
 *   the feed's own restrictions stay law.
 * - `createReferenceOnlyConnector` (class 5, reference-only URLs): metadata
 *   discovery + indexing ONLY — there is NO byte acquisition path AT ALL
 *   (the underlying adapter is built without a byte store, every reference
 *   it registers is forced `reference-only`, and `acquire` is a guaranteed
 *   typed refusal). A URL is a source reference, not proof of
 *   transformation rights.
 *
 * THE RIGHTS-BASIS INVARIANT IS UNCHANGED (re-tested through every
 * connector): the transition `referenced -> authorized-for-access` still
 * happens only inside the corpus store's rights gate, the branded access
 * token is still the only byte key, and a reference-only connector CANNOT
 * produce acquired bytes — typed refusal, twice over (the connector's own
 * refusal, and the store's independent refusal of a `reference-only`
 * source).
 */
import type {
  DiscoveryQuery,
  RightsBasis,
  SourceMetadata,
  SourceRecord,
  SourceRestriction,
  UserUploadMetadata,
} from "./domain";
import { RightsBasisSchema } from "./domain";
import {
  CorpusNotFoundError,
  CorpusRestrictionError,
  CorpusRightsBasisRequiredError,
  CorpusValidationError,
} from "./errors";
import type { ProviderAdapter } from "./provider-adapter";
import { createReferenceAdapter } from "./reference-adapter";
import { acquireSourceFromAdapter } from "./pipeline";
import type { CorpusStore } from "./store";

// ---------------------------------------------------------------------------
// The connector vocabulary
// ---------------------------------------------------------------------------

/**
 * The contract source classes a connector may serve
 * (docs/contracts/historical-media-and-corpus.md §Source classes):
 * 1. user-fed uploads -> `user-fed-upload`;
 * 4. authorized live/tracking/statistical feeds -> `authorized-feed`;
 * 5. reference-only URLs -> `reference-only`.
 */
export const CONNECTOR_SOURCE_CLASSES = [
  "user-fed-upload",
  "authorized-feed",
  "reference-only",
] as const;

export type ConnectorSourceClass = (typeof CONNECTOR_SOURCE_CLASSES)[number];

/** What a connector can do (honest capability flags, checked in tests). */
export interface ConnectorCapabilities {
  /** Byte acquisition through the corpus rights gate (false: reference-only). */
  readonly byteAcquisition: boolean;
  /** Metadata discovery over an injected fixture store. */
  readonly discovery: boolean;
}

// ---------------------------------------------------------------------------
// The acquisition request family
// ---------------------------------------------------------------------------

/** Class 1 acquisition: the owner's bytes + the owner's declared basis. */
export interface UserUploadAcquisition {
  readonly kind: "user-upload";
  readonly bytes: Uint8Array;
  /**
   * The declared rights/policy basis — REQUIRED (the store refuses without
   * it, with the same typed error as the provider path). Must be a
   * `user-declared-ownership` basis: that is the class 1 -> basis mapping.
   */
  readonly declaredBasis?: RightsBasis;
  readonly metadata: UserUploadMetadata;
}

/** Class 4 acquisition: an item of the connector's feed, hook-authorized. */
export interface AuthorizedFeedAcquisition {
  readonly kind: "authorized-feed";
  readonly canonicalUrl: string;
}

/**
 * Class 5 "acquisition": structurally inexpressible — the reference-only
 * connector refuses every instance with the typed restriction error. The
 * shape exists so the refusal is reachable (and testable) through the SAME
 * uniform `acquire` surface every connector exposes.
 */
export interface ReferenceOnlyAcquisition {
  readonly kind: "reference-only";
  readonly canonicalUrl: string;
}

export type ConnectorAcquisitionRequest =
  UserUploadAcquisition | AuthorizedFeedAcquisition | ReferenceOnlyAcquisition;

// ---------------------------------------------------------------------------
// The connector port
// ---------------------------------------------------------------------------

/**
 * A source connector: the class-aware front door to the corpus. Every
 * connector indexes references (`registerReference`) and exposes the uniform
 * acquisition surface (`acquire`) — for the reference-only connector that
 * surface is a guaranteed typed refusal (there is no byte path at all).
 */
export interface ConnectorAdapter {
  /** The connector identity, e.g. "authorized-feed:v0". */
  readonly connectorId: string;
  /** The contract source class this connector serves. */
  readonly sourceClass: ConnectorSourceClass;
  /** The honest capability flags. */
  readonly capabilities: ConnectorCapabilities;
  /**
   * Registers a discovered reference into the corpus (state `referenced`).
   * Metadata only, always — this method never touches bytes.
   */
  registerReference(store: CorpusStore, metadata: SourceMetadata): Promise<SourceRecord>;
  /**
   * The acquisition path, routed through the v0 acquisition state machine.
   * Refuses typed when the connector has no byte path (reference-only) or
   * when the request kind does not match the connector's source class.
   */
  acquire(store: CorpusStore, request: ConnectorAcquisitionRequest): Promise<SourceRecord>;
  /** Metadata discovery (present iff `capabilities.discovery`). */
  discover?(query: DiscoveryQuery): Promise<readonly SourceMetadata[]>;
}

// ---------------------------------------------------------------------------
// The class -> basis mapping (fail-closed, typed)
// ---------------------------------------------------------------------------

/** The basis type each source class must ride (the contract's own mapping). */
export const CONNECTOR_BASIS_TYPES: Readonly<Record<ConnectorSourceClass, string>> = {
  "user-fed-upload": "user-declared-ownership",
  "authorized-feed": "authorized-feed",
  "reference-only": "", // no basis can ever authorize bytes for class 5
};

/**
 * Validates that a basis belongs to the connector's source class. A basis of
 * the wrong type is a caller error: it would blur the source classes the
 * contract keeps distinct (e.g. riding an `authorized-feed` grant into the
 * user-fed upload path).
 */
function requireClassBasis(sourceClass: ConnectorSourceClass, basis: RightsBasis): RightsBasis {
  const expected = CONNECTOR_BASIS_TYPES[sourceClass];
  if (basis.basisType !== expected) {
    throw new CorpusValidationError(
      `the ${sourceClass} connector only accepts a ${expected} rights basis (a ${basis.basisType} basis belongs to a different source class; the contract's class -> basis mapping is law)`,
      [{ sourceClass, expected, actual: basis.basisType }],
    );
  }
  return basis;
}

// ---------------------------------------------------------------------------
// Connector 1: user-fed uploads (contract class 1)
// ---------------------------------------------------------------------------

export interface UserUploadConnectorOptions {
  /** The connector identity (default "user-upload:v0"). */
  readonly connectorId?: string;
}

/**
 * The user-fed upload connector: the owner's bytes + the owner's declared
 * basis, routed through the store's `ingestUserUpload` (born `acquired` —
 * the contract's §User-fed historical matches path). The connector adds the
 * class -> basis law on top: the declared basis must be a
 * `user-declared-ownership` basis, or the refusal is typed.
 */
export function createUserUploadConnector(
  options: UserUploadConnectorOptions = {},
): ConnectorAdapter {
  const connectorId = options.connectorId ?? "user-upload:v0";
  return {
    connectorId,
    sourceClass: "user-fed-upload",
    capabilities: { byteAcquisition: true, discovery: false },

    async registerReference(store, metadata) {
      if (metadata.provider !== "user-upload") {
        throw new CorpusValidationError(
          `the user-upload connector only registers user-upload references (provider "${metadata.provider}" belongs to a provider connector)`,
          [{ connectorId, provider: metadata.provider }],
        );
      }
      return store.registerReference(metadata);
    },

    async acquire(store, request) {
      if (request.kind !== "user-upload") {
        throw new CorpusValidationError(
          `the user-upload connector acquires user-upload requests (got kind "${request.kind}")`,
          [{ connectorId, requestKind: request.kind }],
        );
      }
      if (request.declaredBasis !== undefined) {
        requireClassBasis("user-fed-upload", request.declaredBasis);
      }
      // No declared basis -> the STORE's typed rights refusal surfaces
      // unchanged. The connector never improvises one.
      return store.ingestUserUpload({
        bytes: request.bytes,
        declaredBasis: request.declaredBasis,
        metadata: request.metadata,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Connector 4: authorized feeds (contract class 4)
// ---------------------------------------------------------------------------

/** One item of the fixture feed store the tests inject. */
export interface FeedFixtureItem {
  /** The feed item's discovered metadata (the canonical reference). */
  readonly metadata: SourceMetadata;
  /**
   * The fixture bytes for the item. Absent bytes are an honest
   * `corpus.bytes-unavailable` refusal at retrieval time — availability is
   * never fabricated.
   */
  readonly bytes?: Uint8Array;
}

/**
 * The authorization hook the caller must satisfy: given the feed and the
 * item's canonical reference, produce the explicit rights/policy basis the
 * acquisition will ride (an `authorized-feed` basis). Returning `null` is
 * the honest "the caller cannot satisfy authorization" answer — the
 * connector converts it into the typed rights refusal.
 */
export type FeedAuthorizationHook = (request: {
  readonly feedId: string;
  readonly canonicalUrl: string;
}) => Promise<RightsBasis | null>;

export interface AuthorizedFeedConnectorOptions {
  /** The feed's identity, e.g. "feed:tracking-stats". */
  readonly feedId: string;
  /** The fixture feed items (metadata + optional bytes). */
  readonly items: readonly FeedFixtureItem[];
  /** The authorization hook — REQUIRED (there is no unauthenticated path). */
  readonly authorizationHook: FeedAuthorizationHook;
  /** The connector identity (default "authorized-feed:v0"). */
  readonly connectorId?: string;
}

/**
 * The authorized-feed connector: discovery + indexing over an injected
 * fixture feed store, and acquisition that satisfies the authorization hook
 * BEFORE the corpus rights gate, then routes through the canonical order
 * (`acquireSourceFromAdapter`): authorize -> retrieve -> record. The bytes
 * ride the REL-009 `ProviderAdapter` seam (the fixture adapter over the
 * feed's items) — retrieval still requires the store-minted access token,
 * exactly as for provider connectors.
 */
export function createAuthorizedFeedConnector(
  options: AuthorizedFeedConnectorOptions,
): ConnectorAdapter {
  const connectorId = options.connectorId ?? "authorized-feed:v0";
  const items = [...options.items];
  const byCanonicalUrl = new Map<string, FeedFixtureItem>(
    items.map((item) => [item.metadata.canonicalUrl, item]),
  );
  // The underlying ProviderAdapter over the seam: metadata + bytes, no
  // provider SDKs, no network — the tests inject the fixture store.
  const adapter: ProviderAdapter = createReferenceAdapter(
    {
      metadata: items.map((item) => item.metadata),
      bytes: Object.fromEntries(
        items
          .filter((item) => item.bytes !== undefined)
          .map((item) => [item.metadata.canonicalUrl, item.bytes as Uint8Array]),
      ),
    },
    { provider: options.feedId },
  );

  function mustItem(canonicalUrl: string): FeedFixtureItem {
    const item = byCanonicalUrl.get(canonicalUrl);
    if (item === undefined) {
      throw new CorpusNotFoundError(
        `canonical reference ${canonicalUrl} is not an item of feed ${options.feedId}`,
        { feedId: options.feedId, canonicalUrl },
      );
    }
    return item;
  }

  return {
    connectorId,
    sourceClass: "authorized-feed",
    capabilities: { byteAcquisition: true, discovery: true },

    async registerReference(store, metadata) {
      // A feed connector registers only its OWN feed's items.
      mustItem(metadata.canonicalUrl);
      return store.registerReference(metadata);
    },

    discover(query: DiscoveryQuery): Promise<readonly SourceMetadata[]> {
      return adapter.discoverMetadata(query);
    },

    async acquire(store, request) {
      if (request.kind !== "authorized-feed") {
        throw new CorpusValidationError(
          `the authorized-feed connector acquires authorized-feed requests (got kind "${request.kind}")`,
          [{ connectorId, requestKind: request.kind }],
        );
      }
      const item = mustItem(request.canonicalUrl);
      // Register (idempotent) if the reference is not in the corpus yet.
      let record = await store.getByCanonicalUrl(item.metadata.canonicalUrl);
      if (record === null) {
        record = await store.registerReference(item.metadata);
      }
      // THE HOOK: the caller must satisfy authorization. `null` is the
      // honest "cannot satisfy" — the typed rights refusal follows.
      const basis = await options.authorizationHook({
        feedId: options.feedId,
        canonicalUrl: item.metadata.canonicalUrl,
      });
      if (basis === null || basis === undefined) {
        throw new CorpusRightsBasisRequiredError(
          `the authorization hook produced no rights basis for ${item.metadata.canonicalUrl} of feed ${options.feedId} (an authorized feed acquisition requires an explicit authorized-feed basis; the connector refuses, fail-closed)`,
          { feedId: options.feedId, canonicalUrl: item.metadata.canonicalUrl },
        );
      }
      const parsed = RightsBasisSchema.safeParse(basis);
      if (!parsed.success) {
        throw new CorpusRightsBasisRequiredError(
          `the authorization hook produced a malformed rights basis for ${item.metadata.canonicalUrl} of feed ${options.feedId}`,
          { issues: parsed.error.issues },
        );
      }
      requireClassBasis("authorized-feed", parsed.data);
      // The canonical order, over the ProviderAdapter seam: the store's
      // rights gate mints the token, the adapter serves the bytes, the
      // store records them (re-verifying the token).
      return acquireSourceFromAdapter(store, record.sourceId, adapter, {
        basis: parsed.data,
        acquisitionMethod: connectorId,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Connector 5: reference-only discovery (contract class 5)
// ---------------------------------------------------------------------------

export interface ReferenceOnlyConnectorOptions {
  /** The fixture metadata the connector discovers over (no bytes, ever). */
  readonly metadata: readonly SourceMetadata[];
  /** The connector identity (default "reference-only:v0"). */
  readonly connectorId?: string;
}

/**
 * The reference-only discovery connector: metadata indexing with NO byte
 * acquisition path at all. Every source it registers is declared
 * `reference-only` BY CONSTRUCTION (the connector's class law — the store
 * then independently refuses any later authorization attempt), its adapter
 * is built without a byte store, and `acquire` is a guaranteed typed
 * refusal: a URL is a source reference, not proof of transformation
 * rights.
 */
export function createReferenceOnlyConnector(
  options: ReferenceOnlyConnectorOptions,
): ConnectorAdapter {
  const connectorId = options.connectorId ?? "reference-only:v0";
  const metadata = [...options.metadata];
  // The underlying ProviderAdapter: metadata only — no bytes map exists.
  const adapter: ProviderAdapter = createReferenceAdapter({ metadata }, { provider: connectorId });

  return {
    connectorId,
    sourceClass: "reference-only",
    capabilities: { byteAcquisition: false, discovery: true },

    async registerReference(store, sourceMetadata) {
      // The class law: everything this connector indexes is reference-only.
      // Forcing the restriction (not silently rewriting the caller's other
      // facts) is what makes the STORE's independent refusal possible.
      const restrictions: SourceRestriction[] = sourceMetadata.restrictions.includes(
        "reference-only",
      )
        ? [...sourceMetadata.restrictions]
        : ["reference-only", ...sourceMetadata.restrictions];
      return store.registerReference({ ...sourceMetadata, restrictions });
    },

    discover(query: DiscoveryQuery): Promise<readonly SourceMetadata[]> {
      return adapter.discoverMetadata(query);
    },

    async acquire(store, request) {
      // THE TYPED REFUSAL — the connector has no byte acquisition path AT
      // ALL, regardless of the request kind or the store's state.
      throw new CorpusRestrictionError(
        `the reference-only connector ${connectorId} has no byte-acquisition path at all (a URL is a source reference, not proof of transformation rights); refusing the ${request.kind} acquisition of ${"canonicalUrl" in request ? request.canonicalUrl : "(no reference)"} fail-closed`,
        {
          connectorId,
          sourceClass: "reference-only",
          operation: "connector-acquire",
        },
      );
    },
  };
}
