/**
 * ReferenceAdapter v0 (REL-009): pure metadata discovery against INJECTED
 * fixture metadata — the tests provide the fixture store.
 *
 * This is the only ProviderAdapter implementation in the slice, and it is
 * deliberately boring: no provider SDKs, no network, no environment reads.
 * Discovery filters the injected fixtures; canonical references are
 * reductions of discovered metadata; byte retrieval serves fixture bytes
 * ONLY to a store-minted, scope-matching {@link AuthorizedByteAccess}
 * token. Real permitted provider adapters (REL-010) implement the same
 * seam over real provider APIs behind the same authorization law.
 */
import type { CanonicalSourceRef, DiscoveryQuery, SourceMetadata } from "./domain";
import { CorpusAccessInvalidError, CorpusBytesUnavailableError } from "./errors";
import type { AuthorizedByteAccess, ProviderAdapter } from "./provider-adapter";
import { isAuthorizedByteAccess } from "./provider-adapter";

/**
 * The fixture source the tests inject: discovered metadata plus (optionally)
 * fixture bytes keyed by canonical URL. Absent bytes are an honest
 * `corpus.bytes-unavailable` refusal — the adapter never fabricates media.
 */
export interface FixtureMetadataSource {
  readonly metadata: readonly SourceMetadata[];
  readonly bytes?: Readonly<Record<string, Uint8Array>>;
}

export interface ReferenceAdapterOptions {
  /** The provider identity reported by the adapter (default "reference-fixture-v0"). */
  readonly provider?: string;
  /** Default discovery limit when the query sets none (default 50). */
  readonly defaultLimit?: number;
}

/** Creates the fixture-backed reference adapter. */
export function createReferenceAdapter(
  fixtures: FixtureMetadataSource,
  options: ReferenceAdapterOptions = {},
): ProviderAdapter {
  const provider = options.provider ?? "reference-fixture-v0";
  const defaultLimit = options.defaultLimit ?? 50;
  return {
    provider,

    async discoverMetadata(query: DiscoveryQuery): Promise<readonly SourceMetadata[]> {
      const limit = query.limit ?? defaultLimit;
      const needle = query.text?.toLowerCase() ?? null;
      return (
        fixtures.metadata
          .filter((entry) => {
            if (query.provider !== undefined && entry.provider !== query.provider) return false;
            if (
              query.providerContentId !== undefined &&
              entry.providerContentId !== query.providerContentId
            ) {
              return false;
            }
            if (query.canonicalUrl !== undefined && entry.canonicalUrl !== query.canonicalUrl) {
              return false;
            }
            if (needle !== null) {
              const haystack = `${entry.title ?? ""}\n${entry.description ?? ""}`.toLowerCase();
              if (!haystack.includes(needle)) return false;
            }
            return true;
          })
          // Deterministic order regardless of fixture insertion order.
          .sort((a, b) =>
            a.canonicalUrl < b.canonicalUrl ? -1 : a.canonicalUrl > b.canonicalUrl ? 1 : 0,
          )
          .slice(0, limit)
      );
    },

    async toCanonicalReference(metadata: SourceMetadata): Promise<CanonicalSourceRef> {
      return {
        provider: metadata.provider,
        providerContentId: metadata.providerContentId,
        canonicalUrl: metadata.canonicalUrl,
        ownerRef: metadata.ownerRef,
        availability: metadata.availability,
        restrictions: [...metadata.restrictions],
      };
    },

    async retrieveBytes(
      ref: CanonicalSourceRef,
      access: AuthorizedByteAccess,
    ): Promise<Uint8Array> {
      // The no-bypass law, enforced twice: brand first (forged tokens are
      // impossible by construction, but we verify anyway), then scope.
      if (!isAuthorizedByteAccess(access)) {
        throw new CorpusAccessInvalidError(
          "the presented byte-access token was not minted by the corpus rights gate",
          { refCanonicalUrl: ref.canonicalUrl },
        );
      }
      if (access.provider !== ref.provider || access.canonicalUrl !== ref.canonicalUrl) {
        throw new CorpusAccessInvalidError(
          "the byte-access token is scoped to a different source than the reference it was presented for",
          {
            tokenProvider: access.provider,
            tokenCanonicalUrl: access.canonicalUrl,
            refProvider: ref.provider,
            refCanonicalUrl: ref.canonicalUrl,
          },
        );
      }
      const bytes = fixtures.bytes?.[ref.canonicalUrl];
      if (bytes === undefined) {
        throw new CorpusBytesUnavailableError(
          "the fixture store holds no bytes for this canonical reference (availability is honest, never fabricated)",
          { refCanonicalUrl: ref.canonicalUrl },
        );
      }
      return bytes;
    },
  };
}
