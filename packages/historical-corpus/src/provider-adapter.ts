/**
 * The provider-adapter seam (REL-009) — provider-NEUTRAL by law.
 *
 * Source of truth: docs/contracts/historical-media-and-corpus.md §YouTube
 * and similar providers: "The provider adapter may: discover/search
 * metadata; retain canonical references; retrieve bytes only when the
 * applicable access/rights/policy path permits it. The system must not
 * bypass access controls, provider restrictions or rights requirements."
 *
 * THE DESIGN LAW (binding, per the Worker B packet's provider rule):
 * - NO provider SDK imports — an adapter is written against this interface
 *   only; provider-specific wiring arrives in REL-010 behind it.
 * - NO network in this slice — the v0 implementation
 *   (src/reference-adapter.ts) is pure metadata discovery over INJECTED
 *   fixture metadata; tests provide the fixture store.
 * - Byte retrieval (`retrieveBytes`) is reachable ONLY through an
 *   {@link AuthorizedByteAccess} token, which ONLY the corpus store's
 *   rights gate can mint (src/store.ts `authorizeAccess`). The token type
 *   is branded with a module-private unique symbol: it cannot be
 *   constructed outside this package, at the type level (the symbol is not
 *   exported) or at runtime (the mint function is not exported either).
 *   This is the no-bypass guarantee for the adapter side of the
 *   invariant; the store side re-verifies the brand on
 *   `recordAcquiredBytes`, so a forged token is refused twice.
 */
import type { CanonicalSourceRef, DiscoveryQuery, SourceMetadata } from "./domain";

/**
 * The branded byte-access capability. Construction is possible only
 * inside this package (the brand symbol and the minting function are both
 * module-private); holders can present it to a provider adapter's
 * `retrieveBytes` and to the store's `recordAcquiredBytes`.
 *
 * Honesty note: the token is an IN-PROCESS capability, not a cryptographic
 * credential — the durable authority is that the store is the only minter
 * and re-verifies brand + scope at every use. Cryptographic grants for
 * real provider adapters arrive with REL-010.
 */
const authorizedByteAccessBrand: unique symbol = Symbol("corpus.authorized-byte-access");

export interface AuthorizedByteAccess {
  readonly [authorizedByteAccessBrand]: "corpus.authorized-byte-access";
  /** The corpus source the grant was issued for. */
  readonly sourceId: string;
  /** The provider identity at authorization time. */
  readonly provider: string;
  /** The provider content id at authorization time (or null). */
  readonly providerContentId: string | null;
  /** The canonical reference at authorization time. */
  readonly canonicalUrl: string;
  /** SHA-256 hex of the canonical rights-basis record (audit trail). */
  readonly basisDigest: string;
  /** When the grant was issued (epoch ms). */
  readonly grantedAt: number;
}

/**
 * Runtime brand verification: `true` when `value` carries the
 * module-private brand — i.e. it was minted by the corpus store's rights
 * gate. A structurally identical object forged outside this package can
 * never pass (the symbol is unguessable and unexported).
 */
export function isAuthorizedByteAccess(value: unknown): value is AuthorizedByteAccess {
  return (
    typeof value === "object" &&
    value !== null &&
    authorizedByteAccessBrand in value &&
    (value as Record<symbol, unknown>)[authorizedByteAccessBrand] ===
      "corpus.authorized-byte-access"
  );
}

/** Mints an access token. Module-private: ONLY src/store.ts imports it. */
export function mintAuthorizedByteAccess(input: {
  sourceId: string;
  provider: string;
  providerContentId: string | null;
  canonicalUrl: string;
  basisDigest: string;
  grantedAt: number;
}): AuthorizedByteAccess {
  return { [authorizedByteAccessBrand]: "corpus.authorized-byte-access", ...input };
}

/**
 * The provider-neutral adapter seam. An implementation may discover and
 * search metadata, retain canonical references, and retrieve bytes ONLY
 * through a store-issued {@link AuthorizedByteAccess} token whose scope
 * matches the reference. Implementations must refuse otherwise — typed,
 * never silent.
 */
export interface ProviderAdapter {
  /** The provider identity this adapter serves (e.g. "reference-fixture-v0"). */
  readonly provider: string;
  /** Discover/search metadata. Metadata only — this method never returns bytes. */
  discoverMetadata(query: DiscoveryQuery): Promise<readonly SourceMetadata[]>;
  /** Reduce discovered metadata to the canonical reference to retain. */
  toCanonicalReference(metadata: SourceMetadata): Promise<CanonicalSourceRef>;
  /**
   * Retrieve bytes for a reference. Requires a store-issued access
   * authorization whose provider/canonical URL match the reference
   * (scope-checked, brand-checked); anything else is a typed refusal.
   */
  retrieveBytes(ref: CanonicalSourceRef, access: AuthorizedByteAccess): Promise<Uint8Array>;
}
